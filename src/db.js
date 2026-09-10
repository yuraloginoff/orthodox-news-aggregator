import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'news.db');

const db = new Database(dbPath);

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS news (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT NOT NULL,
      title TEXT,
      link TEXT UNIQUE,
      published_at TEXT,
      content TEXT,
      img_url TEXT,
      fetched_at TEXT
    )
  `);
}

function insertNews(item) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO news (source_id, title, link, published_at, content, img_url, fetched_at)
    VALUES (@sourceId, @title, @link, @pubDate, @description, @imgUrl, @fetchedAt)
  `);
  const result = stmt.run({
    sourceId: item.sourceId,
    title: item.title,
    link: item.link,
    pubDate: item.pubDate,
    description: item.description,
    imgUrl: item.imgUrl || null,
    fetchedAt: new Date().toISOString()
  });
  return result.changes > 0;
}

function getNewsCount() {
  const row = db.prepare('SELECT COUNT(*) as count FROM news').get();
  return row.count;
}

function getAllNews() {
  return db.prepare('SELECT * FROM news ORDER BY published_at DESC').all();
}

function closeDb() {
  db.close();
}

export { db, initDb, insertNews, getNewsCount, getAllNews, closeDb };
