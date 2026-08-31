import https from 'https';
import http from 'http';
import { URL } from 'url';
import xml2js from 'xml2js';

const parser = new xml2js.Parser({ explicitCharkey: false, trim: true });

/**
 * Sanitizes raw XML by escaping unescaped ampersands
 * @param {string} xml - Raw XML string
 * @returns {string} Sanitized XML
 */
function sanitizeXml(xml) {
  return xml.replace(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/g, '&amp;');
}

/**
 * Safely parses a date string, falling back to current date if invalid
 * @param {string} dateStr - Date string to parse
 * @returns {string} ISO date string
 */
function safeParseDate(dateStr) {
  if (!dateStr) return new Date().toISOString();
  const parsed = new Date(dateStr);
  if (isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }
  return parsed.toISOString();
}

/**
 * Fetches RSS feed from a source with redirect support
 * @param {Object} source - Source configuration
 * @param {number} maxRedirects - Maximum number of redirects to follow
 * @returns {Promise<Array>} Array of parsed items
 */
async function fetchItem(source, maxRedirects = 5) {
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
      },
      timeout: 30000 // 30 seconds
    };

    // Use proxy if configured
    if (source.proxy) {
      // TODO: Implement proxy support
      console.log(`Proxy requested for ${source.id} but not implemented`);
    }

    const request = lib.get(options, (response) => {
      // Handle redirects (301, 302, 307, 308)
      if ([301, 302, 307, 308].includes(response.statusCode)) {
        const redirectUrl = response.headers.location;
        if (redirectUrl && maxRedirects > 0) {
          const resolvedUrl = new URL(redirectUrl, source.url).toString();
          console.log(`Redirecting ${source.id} to ${resolvedUrl}`);
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
        reject(new Error(`Failed to fetch ${source.url}: ${response.statusCode}`));
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

    // Set timeout
    request.setTimeout(30000, () => {
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
    pubDate: safeParseDate(pubDate),
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

export {
  fetchItem,
  fetchAllSources,
  extractItems,
  normalizeItem,
  shouldInclude
};
