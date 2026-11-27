// src/app.js
// Единый процесс: парсер + публичный сайт + админка.
// Запуск: npm start

import 'dotenv/config';
import express from 'express';
import cron from 'node-cron';
import path from 'path';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { pool, initDb } from './db.js';
import { sendNewsToTelegram } from './telegram.js';
import { decodeHtmlEntities, htmlToPlainText, truncateText, extractImageUrl } from './contentUtils.js';
import { getSourcesRouter } from './api.js';
import logger from './logger.js';
import https from 'https';
import http from 'http';
import { URL } from 'url';
import xml2js from 'xml2js';
import { SocksProxyAgent } from 'socks-proxy-agent';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.ADMIN_PORT || 3001;
const ADMIN_USER = process.env.ADMIN_USER || 'glas';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const CRON_SCHEDULE = process.env.PARSER_CRON_SCHEDULE || '0 * * * *';

// ========================
// Parser helpers
// ========================

const parser = new xml2js.Parser({ explicitCharkey: false, trim: true });

function sanitizeXml(xml) {
  return xml.replace(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/g, '&amp;');
}

function safeParseDate(dateStr) {
  if (!dateStr) return new Date().toISOString();
  const parsed = new Date(dateStr);
  if (isNaN(parsed.getTime())) return new Date().toISOString();
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
    if (!proxyAgent) logger.warn(`Proxy requested for ${source.name} but RSS_PROXY_URL not set`);
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
          fetchItem({ ...source, url: resolvedUrl }, maxRedirects - 1).then(resolve).catch(reject);
          return;
        } else {
          reject(new Error(`Too many redirects for ${source.id}`));
          return;
        }
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Failed to fetch ${fetchUrl}: ${response.statusCode}`));
        return;
      }

      let data = '';
      response.on('data', (chunk) => { data += chunk; });
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

    request.on('error', (error) => reject(new Error(`Network error for ${source.id}: ${error.message}`)));
    request.setTimeout(30000, () => { request.destroy(); reject(new Error(`Timeout for ${source.id}`)); });
  });
}

function extractItems(parsed, source) {
  const items = [];
  const list = parsed.rss?.channel?.[0]?.item || parsed.feed?.entry || [];
  for (const entry of list) {
    const normalized = normalizeItem(entry, source);
    if (normalized && shouldInclude(normalized, source)) items.push(normalized);
  }
  return items;
}

function normalizeImageUrl(url, sourceUrl) {
  if (!url) return url;
  let resolved = url;
  if (!/^https?:\/\//i.test(resolved)) {
    try { resolved = new URL(resolved, sourceUrl).toString(); } catch { return url; }
  }
  resolved = resolved.replace(/-\d+x\d+(\.\w+)(\?.*)?$/i, '$1$2');
  return resolved;
}

function extractImageFromItem(item, description, sourceUrl) {
  let rawUrl = null;
  if (item.enclosure?.[0]) {
    const enclosure = item.enclosure[0];
    const attrs = enclosure.$ || enclosure;
    const url = attrs?.url;
    const type = attrs?.type;
    if (url && (!type || type.startsWith('image'))) rawUrl = url;
  }
  if (!rawUrl) rawUrl = extractImageUrl(description);
  return normalizeImageUrl(rawUrl, sourceUrl);
}

function normalizeItem(item, source) {
  const title = item.title ? item.title[0] : '';
  const link = item.link ? (item.link[0].href || item.link[0]) : '';
  const pubDate = item.pubDate || item.updated || '';
  const rawDescription = item.description ? item.description[0] : '';
  const imgUrl = extractImageFromItem(item, rawDescription, source.url);
  const plainText = truncateText(htmlToPlainText(rawDescription));
  const category = item.category
    ? (Array.isArray(item.category) ? item.category.map(c => c._ || c) : [item.category])
    : [];

  return {
    sourceId: source.id,
    sourceName: source.name,
    title: title || '',
    link: link || '',
    pubDate: safeParseDate(pubDate),
    description: plainText || '',
    imgUrl: imgUrl || null,
    jurisdiction: source.jurisdiction || null,
    country: source.country || null,
    categories: category,
    priority: source.priority || 'medium'
  };
}

function shouldInclude(item, source) {
  if (!source.filters?.categories) return true;
  return item.categories.some(cat => source.filters.categories.includes(cat));
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

// ========================
// Config
// ========================

const sourcesConfigPath = path.join(__dirname, '..', 'config', 'sources.json');
let sourceInfoById = {};
try {
  const sourcesConfig = JSON.parse(readFileSync(sourcesConfigPath, 'utf-8'));
  sourceInfoById = Object.fromEntries(
    sourcesConfig.sources.map((s) => [
      s.id,
      { name: s.name, region: s.region || null, requiresProxy: Boolean(s.proxy), enabled: s.enabled !== false }
    ])
  );
} catch (err) {
  logger.warn('Не удалось загрузить config/sources.json', { error: err.message });
}

function getSourceInfo(sourceId) {
  return sourceInfoById[sourceId] || { name: sourceId, region: null, requiresProxy: false, enabled: true };
}

// ========================
// DB migrations
// ========================

async function getNewsColumns() {
  const { rows } = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'news'");
  return rows.map((r) => r.column_name);
}

async function runMigrations() {
  await initDb();
  const newsColumns = await getNewsColumns();

  const migrations = [
    ['sent_to_telegram', 'ALTER TABLE news ADD COLUMN sent_to_telegram INTEGER DEFAULT 0'],
    ['sent_at', 'ALTER TABLE news ADD COLUMN sent_at TEXT'],
    ['img_url', 'ALTER TABLE news ADD COLUMN img_url TEXT'],
  ];
  for (const [column, sql] of migrations) {
    if (!newsColumns.includes(column)) {
      await pool.query(sql);
      logger.info(`DB migration applied: added column '${column}' to news`);
    }
  }

  const updatedColumns = await getNewsColumns();
  if (updatedColumns.includes('edited_text') || updatedColumns.includes('edited_image_url') || updatedColumns.includes('hidden')) {
    const { rows } = await pool.query('SELECT * FROM news');
    for (const row of rows) {
      const hasEditedText = updatedColumns.includes('edited_text') && row.edited_text;
      const hasEditedImage = updatedColumns.includes('edited_image_url') && row.edited_image_url;
      const newContent = hasEditedText ? row.edited_text : truncateText(htmlToPlainText(row.content || ''));
      const newImgUrl = row.img_url ? row.img_url : (hasEditedImage ? row.edited_image_url : extractImageUrl(row.content || ''));
      await pool.query('UPDATE news SET content = $1, img_url = $2 WHERE id = $3', [newContent, newImgUrl || null, row.id]);
    }
    logger.info(`Data migration: converted ${rows.length} rows to plain-text content + img_url`);
    if (updatedColumns.includes('edited_text')) await pool.query('ALTER TABLE news DROP COLUMN edited_text');
    if (updatedColumns.includes('edited_image_url')) await pool.query('ALTER TABLE news DROP COLUMN edited_image_url');
    if (updatedColumns.includes('hidden')) await pool.query('ALTER TABLE news DROP COLUMN hidden');
    logger.info('DB migration applied: dropped legacy columns edited_text/edited_image_url/hidden');
  }
}

// ========================
// Parsing cycle
// ========================

async function runParsingCycle() {
  const sources = JSON.parse(readFileSync(path.join(__dirname, '..', 'config', 'sources.json'), 'utf-8')).sources;
  logger.info(`Starting parsing cycle for ${sources.length} sources`);

  const items = await fetchAllSources(sources);
  let inserted = 0;
  let skipped = 0;
  for (const item of items) {
    const moderationStatus = item.sourceId === 'UA3' ? 'pending' : 'approved';
    const result = await pool.query(
      `INSERT INTO news (source_id, title, link, published_at, content, img_url, jurisdiction, country, fetched_at, moderation_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (link) DO NOTHING RETURNING id`,
      [item.sourceId, item.title, item.link, item.pubDate, item.description, item.imgUrl || null,
       item.jurisdiction || null, item.country || null, new Date().toISOString(), moderationStatus]
    );
    if (result.rowCount > 0) {
      inserted++;
    } else {
      skipped++;
    }
  }

  logger.info(`Parsing cycle finished: ${items.length} items fetched, ${inserted} new, ${skipped} skipped`);
}

// ========================
// Express setup
// ========================

app.use(express.json());

// --- admin.html with Basic Auth (before static) ---
app.get('/admin.html', (req, res) => {
  if (!ADMIN_PASSWORD) return res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="Glas Admin"');
    return res.status(401).send('Authentication required');
  }
  const decoded = Buffer.from(authHeader.split(' ')[1], 'base64').toString();
  const [user, password] = decoded.split(':');
  if (user !== ADMIN_USER || password !== ADMIN_PASSWORD) {
    res.set('WWW-Authenticate', 'Basic realm="Glas Admin"');
    return res.status(401).send('Invalid credentials');
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});

// Static files (CSS, JS, images)
app.use(express.static(path.join(__dirname, '..', 'public')));


// --- Auth middleware for admin API ---
app.use((req, res, next) => {
  // Публичные API — пропускаем без авторизации
  if (req.path.startsWith('/api/public/')) return next();
  if (req.path === '/api/sources') return next();


  if (!ADMIN_PASSWORD) return next();

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="Glas Admin"');
    return res.status(401).send('Authentication required');
  }

  const decoded = Buffer.from(authHeader.split(' ')[1], 'base64').toString();
  const [user, password] = decoded.split(':');

  if (user !== ADMIN_USER || password !== ADMIN_PASSWORD) {
    res.set('WWW-Authenticate', 'Basic realm="Glas Admin"');
    return res.status(401).send('Invalid credentials');
  }

  next();
});

// ========================
// Public API routes
// ========================

function enrichPublicNews(news) {
  const sourceInfo = getSourceInfo(news.source_id);
  return {
    id: news.id,
    srcid: news.source_id,
    title: decodeHtmlEntities(news.title),
    link: news.link,
    summary: news.content || '',
    publishedAt: news.published_at,
    sourceName: sourceInfo.name,
    sourceRegion: sourceInfo.region,
    jurisdiction: news.jurisdiction || null,
    country: news.country || null,
  };
}

app.get('/api/public/news', async (req, res) => {
  try {
    const { source, jurisdiction, country, date, q, page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(50, Math.max(1, Number(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    let where = [];
    let params = [];
    where.push(`moderation_status = 'approved'`);

    if (source) { params.push(source); where.push(`source_id = $${params.length}`); }
    if (jurisdiction) { params.push(jurisdiction); where.push(`jurisdiction = $${params.length}`); }
    if (country) { params.push(country); where.push(`country = $${params.length}`); }
    if (date === 'today' || date === 'yesterday') {
      const now = new Date();
      const dayOffset = date === 'yesterday' ? 1 : 0;
      const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOffset);
      const start = target.toISOString();
      const end = new Date(target.getTime() + 24 * 60 * 60 * 1000).toISOString();
      params.push(start); where.push(`published_at >= $${params.length}`);
      params.push(end); where.push(`published_at < $${params.length}`);
    }
    if (q) { params.push(`%${q}%`); where.push(`title ILIKE $${params.length}`); }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const newsParams = [...params, limitNum, offset];
    const { rows: news } = await pool.query(
      `SELECT * FROM news ${whereClause} ORDER BY published_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      newsParams
    );
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) as count FROM news ${whereClause}`, params
    );

    res.json({
      news: news.map(enrichPublicNews),
      total: Number(countRows[0].count),
      page: pageNum,
      limit: limitNum,
    });
  } catch (err) {
    logger.error('Error in /api/public/news', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/public/filters', async (req, res) => {
  try {
    const { rows: jRows } = await pool.query(
      "SELECT DISTINCT jurisdiction FROM news WHERE jurisdiction IS NOT NULL AND jurisdiction != '' ORDER BY jurisdiction"
    );
    const { rows: cRows } = await pool.query(
      "SELECT DISTINCT country FROM news WHERE country IS NOT NULL AND country != '' ORDER BY country"
    );
    res.json({
      jurisdictions: jRows.map((r) => r.jurisdiction),
      countries: cRows.map((r) => r.country),
    });
  } catch (err) {
    logger.error('Error in /api/public/filters', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sources', getSourcesRouter(sourceInfoById));

// ========================
// Admin API routes
// ========================

function enrichNews(news) {
  const sourceInfo = getSourceInfo(news.source_id);
  return {
    id: news.id,
    sourceId: news.source_id,
    title: decodeHtmlEntities(news.title),
    link: news.link,
    publishedAt: news.published_at,
    fetchedAt: news.fetched_at,
    sent_to_telegram: news.sent_to_telegram,
    sent_at: news.sent_at,
    preview_text: news.content || '',
    image_url: news.img_url || null,
    source_name: sourceInfo.name,
    source_region: sourceInfo.region,
    source_requires_proxy: sourceInfo.requiresProxy,
    moderation_status: news.moderation_status || 'approved',
  };
}

app.get('/api/news', async (req, res) => {
  try {
    const { source, status, date, page = 1, limit = 30 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let where = [];
    let params = [];

    if (source) { params.push(source); where.push(`source_id = $${params.length}`); }
    if (status === 'sent') { where.push('sent_to_telegram = 1'); }
    else if (status === 'unsent') { where.push('sent_to_telegram = 0'); }
    if (date === 'today' || date === 'yesterday') {
      const now = new Date();
      const dayOffset = date === 'yesterday' ? 1 : 0;
      const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOffset);
      const start = target.toISOString();
      const end = new Date(target.getTime() + 24 * 60 * 60 * 1000).toISOString();
      params.push(start); where.push(`published_at >= $${params.length}`);
      params.push(end); where.push(`published_at < $${params.length}`);
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const newsParams = [...params, Number(limit), offset];
    const { rows: news } = await pool.query(
      `SELECT * FROM news ${whereClause} ORDER BY published_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      newsParams
    );
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) as count FROM news ${whereClause}`, params
    );

    res.json({
      news: news.map(enrichNews),
      total: Number(countRows[0].count),
      page: Number(page),
      limit: Number(limit),
    });
  } catch (err) {
    logger.error('Error in /api/news', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/news/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, text, imageUrl } = req.body;
    const updates = [];
    const params = [];

    if (title !== undefined) { params.push(title); updates.push(`title = $${params.length}`); }
    if (text !== undefined) { params.push(text); updates.push(`content = $${params.length}`); }
    if (imageUrl !== undefined) { params.push(imageUrl || null); updates.push(`img_url = $${params.length}`); }

    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

    params.push(id);
    await pool.query(`UPDATE news SET ${updates.join(', ')} WHERE id = $${params.length}`, params);
    res.json({ ok: true });
  } catch (err) {
    logger.error('Error in PATCH /api/news/:id', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/news/:id/send', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, text, imageUrl } = req.body;
    const { rows } = await pool.query('SELECT * FROM news WHERE id = $1', [id]);
    const news = rows[0];
    if (!news) return res.status(404).json({ error: 'News not found' });

    const finalTitle = title ?? news.title;
    const finalText = text ?? news.content;
    const finalImageUrl = imageUrl ?? news.img_url;
    const sourceInfo = getSourceInfo(news.source_id);

    await sendNewsToTelegram({
      id: news.id,
      title: finalTitle,
      text: finalText,
      link: news.link,
      sourceName: sourceInfo.name,
      sourceRegion: sourceInfo.region,
      imageUrl: finalImageUrl || null,
      imageRequiresProxy: sourceInfo.requiresProxy,
    });

    await pool.query(
      'UPDATE news SET title = $1, content = $2, img_url = $3, sent_to_telegram = 1, sent_at = $4 WHERE id = $5',
      [finalTitle, finalText, finalImageUrl || null, new Date().toISOString(), id]
    );

    res.json({ ok: true });
  } catch (err) {
    logger.error('Telegram send error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/news/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM news WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    logger.error('Error in DELETE /api/news/:id', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// --- Moderation ---

app.post('/api/news/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(
      "UPDATE news SET moderation_status = 'approved', sent_to_telegram = 0, sent_at = NULL WHERE id = $1",
      [id]
    );
    res.json({ ok: true });
  } catch (err) {
    logger.error('Error in POST /api/news/:id/approve', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/news/:id/reject', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("UPDATE news SET moderation_status = 'rejected' WHERE id = $1", [id]);
    res.json({ ok: true });
  } catch (err) {
    logger.error('Error in POST /api/news/:id/reject', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ========================
// Start
// ========================

await runMigrations();

app.listen(PORT, () => {
  logger.info(`Server started on http://localhost:${PORT}`);
  logger.info(`Admin: ${ADMIN_PASSWORD ? 'enabled' : 'disabled'}`);
});

// --- Cron parser ---
logger.info(`Parser scheduled with cron: ${CRON_SCHEDULE}`);
await runParsingCycle();

cron.schedule(CRON_SCHEDULE, () => {
  runParsingCycle().catch((error) => {
    logger.error(`Scheduled parsing cycle failed: ${error.message}`, { error });
  });
});
