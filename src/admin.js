// src/admin.js
// Легкий Express-сервер для админки «Glas».
// Позволяет просматривать спарсенные новости, редактировать заголовок, текст и
// картинку перед отправкой, отправлять новость в Telegram-канал, удалять ненужные.
//
// title, content и img_url редактируются и сохраняются напрямую в те же колонки,
// без отдельных edited_* полей. content в базе — это готовый plain text для Telegram
// (конвертируется из HTML в parser.js на этапе сохранения, а не при каждой отдаче через API).
//
// Использует именованный экспорт `db` из src/db.js и default export `logger` из src/logger.js.

import 'dotenv/config';
import express from 'express';
import path from 'path';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { db } from './db.js';
import { sendNewsToTelegram } from './telegram.js';
import { decodeHtmlEntities, htmlToPlainText, truncateText, extractImageUrl } from './contentUtils.js';
import logger from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.ADMIN_PORT || 3001;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const newsColumns = db.prepare("PRAGMA table_info(news)").all().map((c) => c.name);

const migrations = [
  ['sent_to_telegram', 'ALTER TABLE news ADD COLUMN sent_to_telegram INTEGER DEFAULT 0'],
  ['sent_at', 'ALTER TABLE news ADD COLUMN sent_at TEXT'],
  ['img_url', 'ALTER TABLE news ADD COLUMN img_url TEXT'],
];
for (const [column, sql] of migrations) {
  if (!newsColumns.includes(column)) {
    db.exec(sql);
    logger.info(`DB migration applied: added column '${column}' to news`);
  }
}

// --- Одноразовая миграция данных: старые записи хранили сырой HTML в content и правки
// в edited_text/edited_image_url. Переносить их в новую структуру (content = plain text, img_url
// заполнен) и убрать старые колонки (включая hidden, которая больше не используется).
if (newsColumns.includes('edited_text') || newsColumns.includes('edited_image_url') || newsColumns.includes('hidden')) {
  const rows = db.prepare('SELECT * FROM news').all();
  const update = db.prepare('UPDATE news SET content = @content, img_url = @imgUrl WHERE id = @id');

  const migrate = db.transaction((allRows) => {
    for (const row of allRows) {
      const hasEditedText = newsColumns.includes('edited_text') && row.edited_text;
      const hasEditedImage = newsColumns.includes('edited_image_url') && row.edited_image_url;

      const newContent = hasEditedText
        ? row.edited_text
        : truncateText(htmlToPlainText(row.content || ''));

      const newImgUrl = row.img_url
        ? row.img_url
        : (hasEditedImage ? row.edited_image_url : extractImageUrl(row.content || ''));

      update.run({ content: newContent, imgUrl: newImgUrl || null, id: row.id });
    }
  });

  migrate(rows);
  logger.info(`Data migration: converted ${rows.length} rows to plain-text content + img_url`);

  if (newsColumns.includes('edited_text')) db.exec('ALTER TABLE news DROP COLUMN edited_text');
  if (newsColumns.includes('edited_image_url')) db.exec('ALTER TABLE news DROP COLUMN edited_image_url');
  if (newsColumns.includes('hidden')) db.exec('ALTER TABLE news DROP COLUMN hidden');
  logger.info('DB migration applied: dropped legacy columns edited_text/edited_image_url/hidden');
}

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
    .prepare('SELECT DISTINCT source_id FROM news')
    .all();

  const enriched = sources
    .map((s) => ({ id: s.source_id, ...getSourceInfo(s.source_id) }))
    .filter((s) => s.enabled)
    .map((s) => ({ id: s.id, name: s.name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));

  res.json(enriched);
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
    updates.push('content = @text');
    params.text = text;
  }
  if (imageUrl !== undefined) {
    updates.push('img_url = @imageUrl');
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
    sourceRegion: news.source_region,
    imageUrl: finalImageUrl || null,
    imageRequiresProxy: news.source_requires_proxy,
  });

  if (!result.ok) {
    return res.status(502).json({ error: result.error });
  }

  db.prepare(
    `UPDATE news SET
       sent_to_telegram = 1,
       sent_at = datetime('now'),
       title = @title,
       content = @text,
       img_url = @imageUrl
     WHERE id = @id`
  ).run({ title: finalTitle, text: finalText, imageUrl: finalImageUrl || '', id });

  res.json({ ok: true });
});

app.delete('/api/news/:id', (req, res) => {
  const { id } = req.params;
  const result = db.prepare('DELETE FROM news WHERE id = ?').run(id);

  if (result.changes === 0) {
    return res.status(404).json({ error: 'News not found' });
  }

  logger.info('News deleted', { newsId: id });
  res.json({ ok: true });
});

app.listen(PORT, () => {
  logger.info(`Admin server started on http://localhost:${PORT}`);
});
