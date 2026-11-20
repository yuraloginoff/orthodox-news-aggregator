// src/server.js
// Публичный сервер — статические файлы и API ленты новостей.
// Без авторизации, доступен всем.

import 'dotenv/config';
import express from 'express';
import path from 'path';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { pool, initDb } from './db.js';
import { decodeHtmlEntities } from './contentUtils.js';
import { getSourcesRouter } from './api.js';
import logger from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.ADMIN_PORT || 3001;

// --- Карта source_id -> name/region из sources.json ---
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

// --- Публичные API-роуты ---

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

    // Публичная лента показывает только одобренные новости
    where.push(`moderation_status = 'approved'`);

    if (source) {
      params.push(source);
      where.push(`source_id = $${params.length}`);
    }

    if (jurisdiction) {
      params.push(jurisdiction);
      where.push(`jurisdiction = $${params.length}`);
    }
    if (country) {
      params.push(country);
      where.push(`country = $${params.length}`);
    }
    if (date === 'today' || date === 'yesterday') {
      const now = new Date();
      const dayOffset = date === 'yesterday' ? 1 : 0;
      const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOffset);
      const start = target.toISOString();
      const end = new Date(target.getTime() + 24 * 60 * 60 * 1000).toISOString();
      params.push(start);
      where.push(`published_at >= $${params.length}`);
      params.push(end);
      where.push(`published_at < $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      where.push(`title ILIKE $${params.length}`);
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const newsParams = [...params, limitNum, offset];
    const { rows: news } = await pool.query(
      `SELECT * FROM news ${whereClause} ORDER BY published_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      newsParams
    );

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) as count FROM news ${whereClause}`,
      params
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

app.listen(PORT, () => logger.info(`Public server started on http://localhost:${PORT}`));
