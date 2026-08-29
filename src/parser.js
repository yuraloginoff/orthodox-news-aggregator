const https = require('https');
const http = require('http');
const { URL } = require('url');
const xml2js = require('xml2js');

const parser = new xml2js.Parser();

/**
 * Fetches RSS feed from a source
 * @param {Object} source - Source configuration
 * @returns {Promise<Array>} Array of parsed items
 */
async function fetchItem(source) {
  // Skip disabled sources
  if (source.enabled === false) {
    console.log(`Skipping ${source.id} (${source.name}): disabled`);
    return [];
  }

  return new Promise((resolve, reject) => {
    const urlObj = new URL(source.url);
    const lib = urlObj.protocol === 'https:' ? https : http;
    
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; OrthodoxNewsAggregator/1.0)',
        'Accept': 'application/rss+xml, application/xml, text/xml'
      }
    };

    // Use proxy if configured
    if (source.proxy) {
      // TODO: Implement proxy support
      console.log(`Proxy requested for ${source.id} but not implemented`);
    }

    const request = lib.get(options, (response) => {
      let data = '';
      
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to fetch ${source.url}: ${response.statusCode}`));
        return;
      }

      response.on('data', (chunk) => {
        data += chunk;
      });

      response.on('end', async () => {
        try {
          const result = await parser.parseStringPromise(data);
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

    // Set timeout
    request.setTimeout(10000, () => {
      request.destroy();
      reject(new Error(`Timeout for ${source.id}`));
    });
  });
}

/**
 * Extracts items from parsed RSS/Atom feed
 * @param {Object} parsed - Parsed XML
 * @param {Object} source - Source configuration
 * @returns {Array} Array of normalized items
 */
function extractItems(parsed, source) {
  const items = [];
  
  // RSS 2.0
  if (parsed.rss && parsed.rss.channel && parsed.rss.channel[0].item) {
    for (const item of parsed.rss.channel[0].item) {
      const normalized = normalizeItem(item, source);
      if (normalized && shouldInclude(normalized, source)) {
        items.push(normalized);
      }
    }
  }
  
  // Atom
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

/**
 * Normalizes RSS/Atom item to common format
 * @param {Object} item - Parsed item
 * @param {Object} source - Source configuration
 * @returns {Object} Normalized item
 */
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
    pubDate: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
    description: description || '',
    categories: category,
    priority: source.priority || 'medium'
  };
}

/**
 * Filters items based on source configuration
 * @param {Object} item - Normalized item
 * @param {Object} source - Source configuration
 * @returns {boolean} Whether to include the item
 */
function shouldInclude(item, source) {
  if (!source.filters || !source.filters.categories) {
    return true;
  }
  
  const allowedCategories = source.filters.categories;
  return item.categories.some(cat => allowedCategories.includes(cat));
}

/**
 * Fetches all sources from config
 * @param {Array} sources - Array of source configurations
 * @returns {Promise<Array>} Array of all items
 */
async function fetchAllSources(sources) {
  const allItems = [];
  
  for (const source of sources) {
    // Skip disabled sources
    if (source.enabled === false) {
      console.log(`Skipping ${source.id} (${source.name}): disabled`);
      continue;
    }
    
    try {
      console.log(`Fetching ${source.id} (${source.name})...`);
      const items = await fetchItem(source);
      allItems.push(...items);
      console.log(`Fetched ${items.length} items from ${source.id}`);
    } catch (error) {
      console.error(`Error fetching ${source.id}: ${error.message}`);
    }
  }
  
  return allItems;
}

module.exports = {
  fetchItem,
  fetchAllSources,
  extractItems,
  normalizeItem,
  shouldInclude
};
