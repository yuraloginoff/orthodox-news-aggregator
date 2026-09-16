// src/db.js
// Подключение к Postgres (Neon) через пул соединений `pg`.
// Раньше здесь был better-sqlite3 (синхронный, локальный файл) — теперь все функции
// асинхронные (async/await), т.к. pg работает по сети. Используем DATABASE_URL
// (pooled-соединение через pgbouncer, рекомендуется Neon для serverless и для
// долгоживущих процессов вроде парсера/админки).

import { Pool } from 'pg';
import 'dotenv/config';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS news (
      id SERIAL PRIMARY KEY,
      source_id TEXT NOT NULL,
      title TEXT,
      link TEXT UNIQUE,
      published_at TIMESTAMPTZ,
      content TEXT,
      img_url TEXT,
      jurisdiction TEXT,
      country TEXT,
      sent_to_telegram INTEGER DEFAULT 0,
      sent_at TIMESTAMPTZ,
      fetched_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  await pool.query('CREATE INDEX IF NOT EXISTS idx_news_published_at ON news (published_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_news_source_id ON news (source_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_news_jurisdiction ON news (jurisdiction)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_news_country ON news (country)');
}

async function insertNews(item) {
  const result = await pool.query(
    `INSERT INTO news (source_id, title, link, published_at, content, img_url, jurisdiction, country, fetched_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
     ON CONFLICT (link) DO NOTHING
     RETURNING id`,
    [
      item.sourceId,
      item.title,
      item.link,
      item.pubDate,
      item.description,
      item.imgUrl || null,
      item.jurisdiction || null,
      item.country || null,
    ]
  );
  return result.rowCount > 0;
}

async function getNewsCount() {
  const result = await pool.query('SELECT COUNT(*) as count FROM news');
  return Number(result.rows[0].count);
}

async function getAllNews() {
  const result = await pool.query('SELECT * FROM news ORDER BY published_at DESC');
  return result.rows;
}

async function closeDb() {
  await pool.end();
}

export { pool, initDb, insertNews, getNewsCount, getAllNews, closeDb };
