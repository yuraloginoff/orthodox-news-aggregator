// src/db.js
// PostgreSQL версия слоя данных (раньше better-sqlite3). Подключение по DATABASE_URL.
// Все функции теперь асинхронные (async/await) — вызывающий код (admin.js, parser.js, backup.js,
// migrate_jurisdiction.js) должен использовать await при обращении к этим функциям.
//
// ssl: { rejectUnauthorized: false } по умолчанию — нужно для облачных провайдеров (Neon, Supabase, Render).
// для локального Postgres без SSL выставьте DATABASE_SSL=false в .env.
//
// Neon (serverless Postgres) иногда разрывает идльные/долгоживущие соединения в пуле
// (особенно через -pooler endpoint на Free-плане). pool.on('error') ловит такие события,
// чтобы они не валили весь процесс как неперехватываемое исключение; pg сам откроет новое
// соединение при следующем запросе. idleTimeoutMillis ниже таймаута Neon на простаивание,
// чтобы pg сам закрывал соединения до того, как их обрвёт сервер.

import { Pool } from 'pg';
import 'dotenv/config';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.error('Unexpected pg pool error (connection likely dropped by server):', err.message);
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS news (
      id SERIAL PRIMARY KEY,
      source_id TEXT NOT NULL,
      title TEXT,
      link TEXT UNIQUE,
      published_at TEXT,
      content TEXT,
      img_url TEXT,
      jurisdiction TEXT,
      country TEXT,
      fetched_at TEXT,
      sent_to_telegram INTEGER DEFAULT 0,
      sent_at TEXT,
      moderation_status TEXT DEFAULT 'approved'
    )
  `);

  // Миграция: добавляем колонку если таблицы уже существует
  try {
    await pool.query(`ALTER TABLE news ADD COLUMN IF NOT EXISTS moderation_status TEXT DEFAULT 'approved'`);
    // Устанавливаем approved для старых записей без moderation_status
    await pool.query(`UPDATE news SET moderation_status = 'approved' WHERE moderation_status IS NULL`);
  } catch {
    // колонка уже существует или другая ошибка — игнорируем
  }
}

async function insertNews(item, moderationStatus, retries = 2) {
  const cols = [
    'source_id', 'title', 'link', 'published_at', 'content', 'img_url',
    'jurisdiction', 'country', 'fetched_at'
  ];
  const vals = [
    item.sourceId,
    item.title,
    item.link,
    item.pubDate,
    item.description,
    item.imgUrl || null,
    item.jurisdiction || null,
    item.country || null,
    new Date().toISOString(),
  ];

  // Если передан moderation_status — добавляем в запрос, иначе используется DEFAULT ('approved')
  if (moderationStatus !== undefined) {
    cols.push('moderation_status');
    vals.push(moderationStatus);
  }

  const placeholders = vals.map((_, i) => `$${i + 1}`).join(', ');
  const colList = cols.join(', ');

  try {
    const result = await pool.query(
      `INSERT INTO news (${colList}) VALUES (${placeholders}) ON CONFLICT (link) DO NOTHING`,
      vals
    );
    return result.rowCount > 0;
  } catch (err) {
    const isConnectionError =
      err.message.includes('Connection terminated') ||
      err.message.includes('connection') ||
      err.code === 'ECONNRESET';

    if (isConnectionError && retries > 0) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return insertNews(item, moderationStatus, retries - 1);
    }
    throw err;
  }
}

async function getNewsCount() {
  const { rows } = await pool.query('SELECT COUNT(*) as count FROM news');
  return Number(rows[0].count);
}

async function getAllNews() {
  const { rows } = await pool.query('SELECT * FROM news ORDER BY published_at DESC');
  return rows;
}

async function closeDb() {
  await pool.end();
}

export { pool, initDb, insertNews, getNewsCount, getAllNews, closeDb };
