import fetch from 'node-fetch';
import { XMLParser } from 'fast-xml-parser';
import cron from 'node-cron';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import { HttpsProxyAgent } from 'https-proxy-agent';

import { initDb, insertNews, getNewsCount, getInsertedCount, closeDb } from './db.js';
import { logger, cleanHtml, parseDate, sleep, removeEmoji } from './utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CONFIG_PATH = join(__dirname, '..', 'config', 'sources.json');

function loadConfig() {
  const configData = fs.readFileSync(CONFIG_PATH, 'utf-8');
  return JSON.parse(configData);
}

function getProxyAgent(source) {
  if (!source.proxy) return null;
  
  const proxyUrl = process.env.RSS_PROXY_URL;
  if (!proxyUrl) {
    logger.warn(`Proxy requested for ${source.name} but RSS_PROXY_URL not set`);
    return null;
  }
  
  logger.info(`Using proxy for ${source.name}`);
  return new HttpsProxyAgent(proxyUrl);
}

async function fetchRss(url, agent) {
  const fetchOptions = {
    timeout: 10000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; OrthodoxNewsAggregator/1.0)'
    }
  };
  
  if (agent) {
    fetchOptions.agent = agent;
  }
  
  const response = await fetch(url, fetchOptions);
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  
  return await response.text();
}

function parseRss(xml) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    isArray: (name, jpath, isLeafNode, isAttribute) => {
      return ['item', 'entry'].includes(name);
    }
  });
  
  const result = parser.parse(xml);
  
  let items = [];
  
  if (result.rss?.channel?.item) {
    items = result.rss.channel.item;
  } else if (result.feed?.entry) {
    items = result.feed.entry;
  }
  
  return items;
}

function filterByCategory(items, categories) {
  if (!categories || categories.length === 0) return items;
  
  return items.filter(item => {
    const itemCategories = item.category || [];
    const cats = Array.isArray(itemCategories) ? itemCategories : [itemCategories];
    
    return cats.some(cat => {
      const catValue = typeof cat === 'string' ? cat : cat['#text'];
      return categories.includes(catValue);
    });
  });
}

function parseTelegramNews(items, sourceId) {
  return items
    .map(item => {
      const description = item.description || item['description'] || item['content']?.['#text'] || '';
      const cleaned = removeEmoji(description);
      
      const paragraphs = cleaned.split(/\n\n+/).filter(p => p.trim().length > 0);
      
      if (paragraphs.length === 0) return null;
      
      const title = paragraphs[0].trim();
      const truncatedTitle = title.length > 240 ? title.substring(0, 240) : title;
      
      const link = item.link || item['link'] || item['@_rdf:about'] || '';
      const pubDate = item.pubDate || item['pubDate'] || item.published || item['published'];
      
      return {
        source_id: sourceId,
        title: truncatedTitle,
        link: typeof link === 'string' ? link.trim() : String(link),
        published_at: parseDate(pubDate),
        content: null
      };
    })
    .filter(item => item !== null && item.title && item.link);
}

function extractNews(items, sourceId, categories) {
  const filteredItems = filterByCategory(items, categories);
  
  return filteredItems
    .map(item => {
      const title = item.title || item['title'] || '';
      const link = item.link || item['link'] || item['@_rdf:about'] || '';
      const pubDate = item.pubDate || item['pubDate'] || item.published || item['published'];
      const description = item.description || item['description'] || item['content']?.['#text'] || '';
      const content = item['content:encoded'] || item['content']?.['#text'] || description;
      
      return {
        source_id: sourceId,
        title: typeof title === 'string' ? title.trim() : String(title),
        link: typeof link === 'string' ? link.trim() : String(link),
        published_at: parseDate(pubDate),
        content: cleanHtml(content)
      };
    })
    .filter(item => item.title && item.link);
}

async function parseSource(source) {
  try {
    logger.info(`Fetching ${source.name} (${source.id})`);
    
    const agent = getProxyAgent(source);
    const xml = await fetchRss(source.url, agent);
    const items = parseRss(xml);
    
    let news;
    if (source.parser === 'telegram') {
      news = parseTelegramNews(items, source.id);
    } else {
      const categories = source.filters?.categories;
      news = extractNews(items, source.id, categories);
    }
    
    logger.info(`Parsed ${news.length} items from ${source.name}`);
    
    return news;
  } catch (error) {
    logger.error(`Error parsing ${source.name} (${source.id}): ${error.message}`, { error });
    return [];
  }
}

async function runParser() {
  logger.info('Starting parser run');
  
  const config = loadConfig();
  const db = initDb();
  
  const initialCount = getNewsCount(db);
  logger.info(`Initial news count: ${initialCount}`);
  
  let totalParsed = 0;
  
  for (const source of config.sources) {
    const news = await parseSource(source);
    
    if (news.length > 0) {
      insertNews(db, news);
      totalParsed += news.length;
    }
    
    await sleep(1000);
  }
  
  const insertedCount = getInsertedCount(db, initialCount);
  const finalCount = getNewsCount(db);
  
  logger.info(`Parser run complete. Parsed: ${totalParsed}, Inserted (new): ${insertedCount}, Total in DB: ${finalCount}`);
  
  closeDb(db);
}

async function main() {
  logger.info('Orthodox News Aggregator starting...');
  
  await runParser();
  
  cron.schedule('0 * * * *', async () => {
    logger.info('Scheduled parser run');
    await runParser();
  });
  
  logger.info('Parser scheduled to run every hour');
}

main().catch(error => {
  logger.error('Fatal error:', error);
  process.exit(1);
});
