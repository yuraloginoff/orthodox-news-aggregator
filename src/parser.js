import https from 'https';
import http from 'http';
import { URL } from 'url';
import xml2js from 'xml2js';
import { SocksProxyAgent } from 'socks-proxy-agent';
import logger from './logger.js';


const parser = new xml2js.Parser({ explicitCharkey: false, trim: true });


function sanitizeXml(xml) {
  return xml.replace(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/g, '&amp;');
}


function safeParseDate(dateStr) {
  if (!dateStr) return new Date().toISOString();
  const parsed = new Date(dateStr);
  if (isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }
  return parsed.toISOString();
}


let cachedProxyAgent = null;
let proxyAgentInitialized = false;

function getProxyAgent() {
  if (proxyAgentInitialized) return cachedProxyAgent;

  proxyAgentInitialized = true;
  const proxyUrl = process.env.RSS_PROXY_URL;

  if (!proxyUrl) return null;

  try {
    cachedProxyAgent = new SocksProxyAgent(proxyUrl);
    logger.info(`SOCKS proxy agent initialized: ${proxyUrl}`);
  } catch (error) {
    logger.error(`Failed to initialize SOCKS proxy agent: ${error.message}`);
    cachedProxyAgent = null;
  }

  return cachedProxyAgent;
}


async function fetchItem(source, maxRedirects = 5) {
  if (source.enabled === false) {
    logger.info(`Skipping ${source.id} (${source.name}): disabled`);
    return [];
  }


  const fetchUrl = source.url;
  let proxyAgent = null;

  if (source.proxy) {
    proxyAgent = getProxyAgent();
    if (!proxyAgent) {
      logger.warn(`Proxy requested for ${source.name} but RSS_PROXY_URL not set`);
    }
  }


  return new Promise((resolve, reject) => {
    const urlObj = new URL(fetchUrl);
    const lib = urlObj.protocol === 'https:' ? https : http;


    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; OrthodoxNewsAggregator/1.0)',
        'Accept': 'application/rss+xml, application/xml, text/xml'
      },
      timeout: 30000,
      ...(proxyAgent ? { agent: proxyAgent } : {})
    };


    const request = lib.get(options, (response) => {
      if ([301, 302, 307, 308].includes(response.statusCode)) {
        const redirectUrl = response.headers.location;
        if (redirectUrl && maxRedirects > 0) {
          const resolvedUrl = new URL(redirectUrl, fetchUrl).toString();
          logger.info(`Redirecting ${source.id} to ${resolvedUrl}`);
          fetchItem({ ...source, url: resolvedUrl }, maxRedirects - 1)
            .then(resolve)
            .catch(reject);
          return;
        } else {
          reject(new Error(`Too many redirects for ${source.id}`));
          return;
        }
      }


      let data = '';


      if (response.statusCode !== 200) {
        reject(new Error(`Failed to fetch ${fetchUrl}: ${response.statusCode}`));
        return;
      }


      response.on('data', (chunk) => {
        data += chunk;
      });


      response.on('end', async () => {
        try {
          const sanitized = sanitizeXml(data);
          const result = await parser.parseStringPromise(sanitized);
          const items = extractItems(result, source);
          resolve(items);
        } catch (error) {
          reject(new Error(`Failed to parse XML for ${source.id}: ${error.message}`));
        }
      });
    });


    request.on('error', (error) => {
      reject(new Error(`Network error for ${source.id}: ${error.message}`));
    });


    request.setTimeout(30000, () => {
      request.destroy();
      reject(new Error(`Timeout for ${source.id}`));
    });
  });
}


function extractItems(parsed, source) {
  const items = [];


  if (parsed.rss && parsed.rss.channel && parsed.rss.channel[0].item) {
    for (const item of parsed.rss.channel[0].item) {
      const normalized = normalizeItem(item, source);
      if (normalized && shouldInclude(normalized, source)) {
        items.push(normalized);
      }
    }
  }


  if (parsed.feed && parsed.feed.entry) {
    for (const entry of parsed.feed.entry) {
      const normalized = normalizeItem(entry, source);
      if (normalized && shouldInclude(normalized, source)) {
        items.push(normalized);
      }
    }
  }


  return items;
}


function normalizeItem(item, source) {
  const title = item.title ? item.title[0] : '';
  const link = item.link ? (item.link[0].href || item.link[0]) : '';
  const pubDate = item.pubDate || item.updated || '';
  const description = item.description ? item.description[0] : '';
  const category = item.category ?
    (Array.isArray(item.category) ? item.category.map(c => c._ || c) : [item.category]) :
    [];


  return {
    sourceId: source.id,
    sourceName: source.name,
    title: title || '',
    link: link || '',
    pubDate: safeParseDate(pubDate),
    description: description || '',
    categories: category,
    priority: source.priority || 'medium'
  };
}


function shouldInclude(item, source) {
  if (!source.filters || !source.filters.categories) {
    return true;
  }


  const allowedCategories = source.filters.categories;
  return item.categories.some(cat => allowedCategories.includes(cat));
}


async function fetchAllSources(sources) {
  const allItems = [];


  for (const source of sources) {
    if (source.enabled === false) {
      logger.info(`Skipping ${source.id} (${source.name}): disabled`);
      continue;
    }


    try {
      logger.info(`Fetching ${source.name} (${source.id})`);
      const items = await fetchItem(source);
      allItems.push(...items);
      logger.info(`Parsed ${items.length} items from ${source.name}`);
    } catch (error) {
      logger.error(`Error parsing ${source.name} (${source.id}): ${error.message}`, { error });
    }
  }


  return allItems;
}


export {
  fetchItem,
  fetchAllSources,
  extractItems,
  normalizeItem,
  shouldInclude
};
