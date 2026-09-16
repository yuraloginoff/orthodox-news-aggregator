// src/admin.js
// Express-сервер «Глас»: админка для модерации новостей + публичный read-only API
// для сайта. Использует Postgres (Neon) через пул `pg` — все обращения к БД асинхронные.
//
// title, content и img_url редактируются и сохраняются напрямую в те же колонки.
// content в базе — готовый plain text (конвертируется из HTML в parser.js при сохранении).
//
// Публичный API (/api/public/news) отдаёт урезанный набор полей без возможности
// редактирования — это то, что читает публичный сайт (лента с фильтрами).

import 'dotenv/config';
import express from 'express';
import path from 'path';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { pool, initDb } from './db.js';
import { sendNewsToTelegram } from './telegram.js';
import { decodeHtmlEntities } from './contentUtils.js';
import logger from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.ADMIN_PORT || 3001;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

await initDb();

// --- Карта source_id -> { name, region, requiresProxy, enabled } из config/sources.json ---
const sourcesConfigPath = path.join(__dirname, '..', 'config', 'sources.json');
let sourceInfoById = {};
try {
  const sourcesConfig = JSON.parse(readFileSync(sourcesConfigPath, 'utf-8'));
  sourceInfoById = Object.fromEntries(
    sourcesConfig.sources.map((s) => [
      s.id,
      {
        name: s.name,
        region: s.region || null,
        requiresProxy: Boolean(s.proxy),
        enabled: s.enabled !== false,
      },
    ])
  );
} catch (err) {
  logger.warn('Не удалось загрузить config/sources.json для названий источников', {
    error: err.message,
  });
}

function getSourceInfo(sourceId) {
  return (
    sourceInfoById[sourceId] || {
      name: sourceId,
      region: null,
      requiresProxy: false,
      enabled: true,
    }
  );
}

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// --- Basic Auth только для админских путей (/admin.html, /api/news, /api/sources) ---
// Публичный сайт (/, /api/public/*) остаётся открытым без пароля.
app.use((req, res, next) => {
  const isAdminRoute = req.path.startsWith('/admin') || (req.path.startsWith('/api/') && !req.path.startsWith('/api/public/'));
  if (!isAdminRoute || !ADMIN_PASSWORD) return next();

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="Glas Admin"');
    return res.status(401).send('Authentication required');
  }

  const decoded = Buffer.from(authHeader.split(' ')[1], 'base64').toString();
  const [, password] = decoded.split(':');

  if (password !== ADMIN_PASSWORD) {
    res.set('WWW-Authenticate', 'Basic realm="Glas Admin"');
    return res.status(401).send('Invalid password');
  }

  next();
});

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
    jurisdiction: news.jurisdiction,
    country: news.country,
    source_name: sourceInfo.name,
    source_region: sourceInfo.region,
    source_requires_proxy: sourceInfo.requiresProxy,
  };
}

function buildDateRange(date) {
  if (date !== 'today' && date !== 'yesterday') return null;

  const now = new Date();
  const dayOffset = date === 'yesterday' ? 1 : 0;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOffset);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  return { start: start.toISOString(), end: end.toISOString() };
}

// ===================== АДМИНСКИЕ РОУТЫ =====================

app.get('/api/news', async (req, res) => {
  const { source, status, date, page = 1, limit = 30 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  const where = [];
  const params = [];

  if (source) {
    params.push(source);
    where.push(`source_id = $${params.length}`);
  }
  if (status === 'sent') {
    where.push('sent_to_telegram = 1');
  } else if (status === 'unsent') {
    where.push('sent_to_telegram = 0');
  }
  const range = buildDateRange(date);
  if (range) {
    params.push(range.start);
    where.push(`published_at >= $${params.length}`);
    params.push(range.end);
    where.push(`published_at < $${params.length}`);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const listParams = [...params, Number(limit), offset];
  const newsResult = await pool.query(
    `SELECT * FROM news ${whereClause} ORDER BY published_at DESC LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );

  const countResult = await pool.query(`SELECT COUNT(*) as count FROM news ${whereClause}`, params);

  res.json({
    news: newsResult.rows.map(enrichNews),
    total: Number(countResult.rows[0].count),
    page: Number(page),
    limit: Number(limit),
  });
});

app.get('/api/sources', async (req, res) => {
  const result = await pool.query('SELECT DISTINCT source_id FROM news');

  const enriched = result.rows
    .map((s) => ({ id: s.source_id, ...getSourceInfo(s.source_id) }))
    .filter((s) => s.enabled)
    .map((s) => ({ id: s.id, name: s.name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));

  res.json(enriched);
});

app.patch('/api/news/:id', async (req, res) => {
  const { id } = req.params;
  const { title, text, imageUrl } = req.body;

  const updates = [];
  const params = [];

  if (title !== undefined) {
    params.push(title);
    updates.push(`title = $${params.length}`);
  }
  if (text !== undefined) {
    params.push(text);
    updates.push(`content = $${params.length}`);
  }
  if (imageUrl !== undefined) {
    params.push(imageUrl || null);
    updates.push(`img_url = $${params.length}`);
  }

  if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

  params.push(id);
  await pool.query(`UPDATE news SET ${updates.join(', ')} WHERE id = $${params.length}`, params);
  res.json({ ok: true });
});

app.post('/api/news/:id/send', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, text, imageUrl } = req.body;
    const result = await pool.query('SELECT * FROM news WHERE id = $1', [id]);
    const news = result.rows[0];
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
      'UPDATE news SET title = $1, content = $2, img_url = $3, sent_to_telegram = 1, sent_at = now() WHERE id = $4',
      [finalTitle, finalText, finalImageUrl || null, id]
    );

    res.json({ ok: true });
  } catch (err) {
    logger.error('Telegram send error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/news/:id', async (req, res) => {
  const { id } = req.params;
  await pool.query('DELETE FROM news WHERE id = $1', [id]);
  res.json({ ok: true });
});

// ===================== ПУБЛИЧНЫЙ API (для сайта, без авторизации) =====================
// Только чтение. Отдаёт заголовок, краткий текст, ссылку на оригинал, источник,
// юрисдикцию/страну и дату — без служебных полей (sent_to_telegram, редактирование и т.п.)

function enrichPublicNews(news) {
  const sourceInfo = getSourceInfo(news.source_id);

  return {
    id: news.id,
    title: decodeHtmlEntities(news.title),
    summary: news.content || '',
    link: news.link,
    publishedAt: news.published_at,
    sourceName: sourceInfo.name,
    sourceRegion: sourceInfo.region,
    jurisdiction: news.jurisdiction,
    country: news.country,
  };
}

app.get('/api/public/news', async (req, res) => {
  const { jurisdiction, country, date, q, page = 1, limit = 30 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  const where = [];
  const params = [];

  if (jurisdiction) {
    params.push(jurisdiction);
    where.push(`jurisdiction = $${params.length}`);
  }
  if (country) {
    params.push(country);
    where.push(`country = $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    where.push(`title ILIKE $${params.length}`);
  }
  const range = buildDateRange(date);
  if (range) {
    params.push(range.start);
    where.push(`published_at >= $${params.length}`);
    params.push(range.end);
    where.push(`published_at < $${params.length}`);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const listParams = [...params, Number(limit), offset];
  const newsResult = await pool.query(
    `SELECT * FROM news ${whereClause} ORDER BY published_at DESC LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );

  const countResult = await pool.query(`SELECT COUNT(*) as count FROM news ${whereClause}`, params);

  res.json({
    news: newsResult.rows.map(enrichPublicNews),
    total: Number(countResult.rows[0].count),
    page: Number(page),
    limit: Number(limit),
  });
});

app.get('/api/public/filters', async (req, res) => {
  const result = await pool.query(
    'SELECT DISTINCT jurisdiction, country FROM news WHERE jurisdiction IS NOT NULL'
  );

  const jurisdictions = [...new Set(result.rows.map((r) => r.jurisdiction))].sort();
  const countries = [...new Set(result.rows.map((r) => r.country))].sort();

  res.json({ jurisdictions, countries });
});

app.listen(PORT, () => logger.info(`Admin server started on http://localhost:${PORT}`));
