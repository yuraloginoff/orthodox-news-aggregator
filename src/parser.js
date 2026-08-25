import fetch from 'node-fetch';
import { XMLParser } from 'fast-xml-parser';
import cron from 'node-cron';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

import { initDb, insertNews, getNewsCount, closeDb } from './db.js';
import { logger, cleanHtml, parseDate, sleep } from './utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CONFIG_PATH = join(__dirname, '..', 'config', 'sources.json');

function loadConfig() {
  const configData = fs.readFileSync(CONFIG_PATH, 'utf-8');
  return JSON.parse(configData);
}

async function fetchRss(url) {
  const response = await fetch(url, {
    timeout: 10000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; OrthodoxNewsAggregator/1.0)'
    }
  });
  
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

function extractNews(items, sourceId) {
  return items
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
    
    const xml = await fetchRss(source.url);
    const items = parseRss(xml);
    const news = extractNews(items, source.id);
    
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
  
  let totalNew = 0;
  
  for (const source of config.sources) {
    const news = await parseSource(source);
    
    if (news.length > 0) {
      insertNews(db, news);
      totalNew += news.length;
    }
    
    await sleep(1000);
  }
  
  const finalCount = getNewsCount(db);
  logger.info(`Parser run complete. New items: ${totalNew}, Total in DB: ${finalCount}`);
  
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
