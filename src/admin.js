// src/admin.js
// Легкий Express-сервер для админки «Glas».
// Позволяет просматривать спаршенные новости, редактировать заголовок, текст и
// картинку перед отправкой в Telegram-канал, удалять ненужные.
//
// title, content и img_url редактируются и сохраняются напрямую в те же колонки,
// без отдельных edited_* полей. content в базе — это готовый plain text для Telegram
// (конвертируется из HTML в parser.js на этапе сохранения, а не при каждой отдаче через API).
//
// PostgreSQL: использует именованный экспорт `pool` из src/db.js. Все запросы асинхронные.
// initDb() вызывается здесь же, поскольку admin.js может быть запущен раньше parser.js
// (например, на свежей базе, где таблицы news ещё нет).

import 'dotenv/config';
import express from 'express';
import path from 'path';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { pool, initDb } from './db.js';
import { sendNewsToTelegram } from './telegram.js';
import { decodeHtmlEntities, htmlToPlainText, truncateText, extractImageUrl } from './contentUtils.js';
import logger from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.ADMIN_PORT || 3001;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

async function getNewsColumns() {
  const { rows } = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'news'"
  );
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

  // --- Одноразовая миграция данных: старые записи хранили сырой HTML в content и правки
  // в edited_text/edited_image_url. Перенести их в новую структуру (content = plain text, img_url
  // заполнен) и убрать старые колонки (включая hidden, которая больше не используется).
  const updatedColumns = await getNewsColumns();
  if (
    updatedColumns.includes('edited_text') ||
    updatedColumns.includes('edited_image_url') ||
    updatedColumns.includes('hidden')
  ) {
    const { rows } = await pool.query('SELECT * FROM news');

    for (const row of rows) {
      const hasEditedText = updatedColumns.includes('edited_text') && row.edited_text;
      const hasEditedImage = updatedColumns.includes('edited_image_url') && row.edited_image_url;

      const newContent = hasEditedText
        ? row.edited_text
        : truncateText(htmlToPlainText(row.content || ''));

      const newImgUrl = row.img_url
        ? row.img_url
        : (hasEditedImage ? row.edited_image_url : extractImageUrl(row.content || ''));

      await pool.query('UPDATE news SET content = $1, img_url = $2 WHERE id = $3', [
        newContent,
        newImgUrl || null,
        row.id,
      ]);
    }

    logger.info(`Data migration: converted ${rows.length} rows to plain-text content + img_url`);

    if (updatedColumns.includes('edited_text')) await pool.query('ALTER TABLE news DROP COLUMN edited_text');
    if (updatedColumns.includes('edited_image_url')) await pool.query('ALTER TABLE news DROP COLUMN edited_image_url');
    if (updatedColumns.includes('hidden')) await pool.query('ALTER TABLE news DROP COLUMN hidden');
    logger.info('DB migration applied: dropped legacy columns edited_text/edited_image_url/hidden');
  }
}

await runMigrations();

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

// --- Публичные API-роуты для ленты новостей (public/index.html). Доступны всем без Basic Auth,
// потому размещены до middleware авторизации. Не отдают внутренние поля (sent_to_telegram, sent_at).
function enrichPublicNews(news) {
  const sourceInfo = getSourceInfo(news.source_id);

  return {
    id: news.id,
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
    const { jurisdiction, country, date, q, page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(50, Math.max(1, Number(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    let where = [];
    let params = [];

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

app.use((req, res, next) => {
  if (!ADMIN_PASSWORD) return next();

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
    source_name: sourceInfo.name,
    source_region: sourceInfo.region,
    source_requires_proxy: sourceInfo.requiresProxy,
  };
}

app.get('/api/news', async (req, res) => {
  try {
    const { source, status, date, page = 1, limit = 30 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let where = [];
    let params = [];

    if (source) {
      params.push(source);
      where.push(`source_id = $${params.length}`);
    }
    if (status === 'sent') {
      where.push('sent_to_telegram = 1');
    } else if (status === 'unsent') {
      where.push('sent_to_telegram = 0');
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

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const newsParams = [...params, Number(limit), offset];
    const { rows: news } = await pool.query(
      `SELECT * FROM news ${whereClause} ORDER BY published_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      newsParams
    );

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) as count FROM news ${whereClause}`,
      params
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

app.get('/api/sources', async (req, res) => {
  try {
    const { rows: sources } = await pool.query('SELECT DISTINCT source_id FROM news');

    const enriched = sources
      .map((s) => ({ id: s.source_id, ...getSourceInfo(s.source_id) }))
      .filter((s) => s.enabled)
      .map((s) => ({ id: s.id, name: s.name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));

    res.json(enriched);
  } catch (err) {
    logger.error('Error in /api/sources', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/news/:id', async (req, res) => {
  try {
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

app.listen(PORT, () => logger.info(`Admin server started on http://localhost:${PORT}`));
