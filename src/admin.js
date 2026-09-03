// src/admin.js
// Легкий Express-сервер для админки «Глас».
// Позволяет просматривать спарсенные новости, редактировать заголовок, текст превью
// и изображение перед отправкой, отправлять новость в Telegram-канал, скрывать нерелевантные.
//
// Использует именованный экспорт `db` из src/db.js и default export `logger` из src/logger.js.

import 'dotenv/config';
import express from 'express';
import path from 'path';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { db } from './db.js';
import { sendNewsToTelegram } from './telegram.js';
import { extractImageUrl, htmlToPlainText, truncateText, decodeHtmlEntities } from './contentUtils.js';
import logger from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.ADMIN_PORT || 3001;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// --- Миграция БД для админки (идемпотентна, безопасно выполнять при каждом старте) ---
const newsColumns = db.prepare("PRAGMA table_info(news)").all().map((c) => c.name);
const migrations = [
  ['sent_to_telegram', 'ALTER TABLE news ADD COLUMN sent_to_telegram INTEGER DEFAULT 0'],
  ['sent_at', 'ALTER TABLE news ADD COLUMN sent_at TEXT'],
  ['hidden', 'ALTER TABLE news ADD COLUMN hidden INTEGER DEFAULT 0'],
  ['edited_text', 'ALTER TABLE news ADD COLUMN edited_text TEXT'],
  ['edited_image_url', 'ALTER TABLE news ADD COLUMN edited_image_url TEXT'],
];
for (const [column, sql] of migrations) {
  if (!newsColumns.includes(column)) {
    db.exec(sql);
    logger.info(`DB migration applied: added column '${column}' to news`);
  }
}

// --- Карта source_id -> человекочитаемое название источника ---
const sourcesConfigPath = path.join(__dirname, '..', 'config', 'sources.json');
let sourceNameById = {};
try {
  const sourcesConfig = JSON.parse(readFileSync(sourcesConfigPath, 'utf-8'));
  sourceNameById = Object.fromEntries(
    sourcesConfig.sources.map((s) => [s.id, s.name])
  );
} catch (err) {
  logger.warn('Не удалось загрузить config/sources.json для названий источников', {
    error: err.message,
  });
}

function getSourceName(sourceId) {
  return sourceNameById[sourceId] || sourceId;
}

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

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

/**
 * Дополняет запись новости производными полями.
 * title и preview_text прогоняются через decodeHtmlEntities, так как RSS часто
 * содержит &nbsp;/&laquo;/&raquo; и т.п. после однократной декодировки xml2js.
 */
function enrichNews(news) {
  const autoText = truncateText(htmlToPlainText(news.content));
  const autoImage = extractImageUrl(news.content);

  return {
    id: news.id,
    sourceId: news.source_id,
    title: decodeHtmlEntities(news.title),
    link: news.link,
    publishedAt: news.published_at,
    fetchedAt: news.fetched_at,
    sent_to_telegram: news.sent_to_telegram,
    sent_at: news.sent_at,
    hidden: news.hidden,
    preview_text: news.edited_text !== null && news.edited_text !== undefined && news.edited_text !== ''
      ? news.edited_text
      : autoText,
    image_url: news.edited_image_url !== null && news.edited_image_url !== undefined
      ? news.edited_image_url
      : autoImage,
    source_name: getSourceName(news.source_id),
  };
}

app.get('/api/news', (req, res) => {
  const { source, status, page = 1, limit = 30 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  let where = [];
  let params = {};

  if (source) {
    where.push('source_id = @source');
    params.source = source;
  }
  if (status === 'sent') {
    where.push('sent_to_telegram = 1');
  } else if (status === 'unsent') {
    where.push('sent_to_telegram = 0');
  }
  if (status !== 'hidden') {
    where.push('(hidden IS NULL OR hidden = 0)');
  } else {
    where = ['hidden = 1'];
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const news = db
    .prepare(
      `SELECT * FROM news ${whereClause} ORDER BY published_at DESC LIMIT @limit OFFSET @offset`
    )
    .all({ ...params, limit: Number(limit), offset });

  const total = db
    .prepare(`SELECT COUNT(*) as count FROM news ${whereClause}`)
    .get(params).count;

  res.json({ news: news.map(enrichNews), total, page: Number(page), limit: Number(limit) });
});

app.get('/api/sources', (req, res) => {
  const sources = db
    .prepare('SELECT DISTINCT source_id FROM news ORDER BY source_id')
    .all();
  res.json(sources.map((s) => s.source_id));
});

app.patch('/api/news/:id', (req, res) => {
  const { id } = req.params;
  const { title, text, imageUrl } = req.body;

  const updates = [];
  const params = {};

  if (title !== undefined) {
    updates.push('title = @title');
    params.title = title;
  }
  if (text !== undefined) {
    updates.push('edited_text = @text');
    params.text = text;
  }
  if (imageUrl !== undefined) {
    updates.push('edited_image_url = @imageUrl');
    params.imageUrl = imageUrl;
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'Нечего обновлять' });
  }

  db.prepare(`UPDATE news SET ${updates.join(', ')} WHERE id = @id`).run({ ...params, id });
  res.json({ ok: true });
});

app.post('/api/news/:id/send', async (req, res) => {
  const { id } = req.params;
  const { title, text, imageUrl } = req.body;

  const rawNews = db.prepare('SELECT * FROM news WHERE id = ?').get(id);
  if (!rawNews) return res.status(404).json({ error: 'News not found' });

  const news = enrichNews(rawNews);

  const finalTitle = title !== undefined ? title : news.title;
  const finalText = text !== undefined ? text : news.preview_text;
  const finalImageUrl = imageUrl !== undefined ? imageUrl : news.image_url;

  const result = await sendNewsToTelegram({
    id: news.id,
    title: finalTitle,
    text: finalText,
    link: news.link,
    sourceName: news.source_name,
    imageUrl: finalImageUrl || null,
  });

  if (!result.ok) {
    return res.status(502).json({ error: result.error });
  }

  db.prepare(
    `UPDATE news SET
       sent_to_telegram = 1,
       sent_at = datetime('now'),
       title = @title,
       edited_text = @text,
       edited_image_url = @imageUrl
     WHERE id = @id`
  ).run({ title: finalTitle, text: finalText, imageUrl: finalImageUrl || '', id });

  res.json({ ok: true });
});

app.post('/api/news/:id/hide', (req, res) => {
  const { id } = req.params;
  db.prepare('UPDATE news SET hidden = 1 WHERE id = ?').run(id);
  res.json({ ok: true });
});

app.post('/api/news/:id/unhide', (req, res) => {
  const { id } = req.params;
  db.prepare('UPDATE news SET hidden = 0 WHERE id = ?').run(id);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  logger.info(`Admin server started on http://localhost:${PORT}`);
});
