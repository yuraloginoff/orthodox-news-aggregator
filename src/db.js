// src/db.js
// PostgreSQL версия слоя данных (раньше better-sqlite3). Подключение по DATABASE_URL.
// Все функции теперь асинхронные (async/await) — вызывающий код (admin.js, parser.js, backup.js,
// migrate_jurisdiction.js) должен использовать await при обращении к этим функциям.
//
// ssl: { rejectUnauthorized: false } по умолчанию — нужно для облачных провайдеров (Neon, Supabase, Render).
// для локального Postgres без SSL выставьте DATABASE_SSL=false в .env.

import { Pool } from 'pg';
import 'dotenv/config';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
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
      sent_at TEXT
    )
  `);
}

async function insertNews(item) {
  const result = await pool.query(
    `INSERT INTO news (source_id, title, link, published_at, content, img_url, jurisdiction, country, fetched_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (link) DO NOTHING`,
    [
      item.sourceId,
      item.title,
      item.link,
      item.pubDate,
      item.description,
      item.imgUrl || null,
      item.jurisdiction || null,
      item.country || null,
      new Date().toISOString(),
    ]
  );
  return result.rowCount > 0;
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
