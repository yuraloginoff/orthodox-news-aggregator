import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = join(__dirname, '..', 'data', 'news.db');

export function initDb() {
  const db = new Database(DB_PATH);
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS news (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT NOT NULL,
      title TEXT NOT NULL,
      link TEXT UNIQUE NOT NULL,
      published_at DATETIME,
      content TEXT,
      fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_source_id ON news(source_id)
  `);
  
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_published_at ON news(published_at)
  `);
  
  return db;
}

export function insertNews(db, news) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO news (source_id, title, link, published_at, content)
    VALUES (?, ?, ?, ?, ?)
  `);
  
  const insertMany = db.transaction((newsItems) => {
    for (const item of newsItems) {
      stmt.run(
        item.source_id,
        item.title,
        item.link,
        item.published_at,
        item.content
      );
    }
  });
  
  insertMany(news);
}

export function getNewsCount(db) {
  const result = db.prepare('SELECT COUNT(*) as count FROM news').get();
  return result.count;
}

export function closeDb(db) {
  db.close();
}
