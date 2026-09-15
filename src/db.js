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
      jurisdiction TEXT,
      country TEXT,
      fetched_at TEXT
    )
  `);

  const columns = db.prepare("PRAGMA table_info(news)").all().map((c) => c.name);
  if (!columns.includes('img_url')) {
    db.exec('ALTER TABLE news ADD COLUMN img_url TEXT');
  }
  if (!columns.includes('jurisdiction')) {
    db.exec('ALTER TABLE news ADD COLUMN jurisdiction TEXT');
  }
  if (!columns.includes('country')) {
    db.exec('ALTER TABLE news ADD COLUMN country TEXT');
  }
}

function insertNews(item) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO news (source_id, title, link, published_at, content, img_url, jurisdiction, country, fetched_at)
    VALUES (@sourceId, @title, @link, @pubDate, @description, @imgUrl, @jurisdiction, @country, @fetchedAt)
  `);
  const result = stmt.run({
    sourceId: item.sourceId,
    title: item.title,
    link: item.link,
    pubDate: item.pubDate,
    description: item.description,
    imgUrl: item.imgUrl || null,
    jurisdiction: item.jurisdiction || null,
    country: item.country || null,
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
