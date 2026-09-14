import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'data', 'news.db');
const configPath = path.join(__dirname, '..', 'config', 'sources.json');

const db = new Database(dbPath);
const { sources } = JSON.parse(readFileSync(configPath, 'utf-8'));

const columns = db.prepare("PRAGMA table_info(news)").all().map((c) => c.name);
if (!columns.includes('jurisdiction')) {
  db.exec('ALTER TABLE news ADD COLUMN jurisdiction TEXT');
}
if (!columns.includes('country')) {
  db.exec('ALTER TABLE news ADD COLUMN country TEXT');
}

const updateStmt = db.prepare('UPDATE news SET jurisdiction = ?, country = ? WHERE source_id = ?');

let totalUpdated = 0;
for (const source of sources) {
  if (!source.jurisdiction || !source.country) continue;
  const result = updateStmt.run(source.jurisdiction, source.country, source.id);
  console.log(`${source.id} (${source.name}): ${result.changes} rows updated`);
  totalUpdated += result.changes;
}

const unmatched = db.prepare('SELECT source_id, COUNT(*) as cnt FROM news WHERE jurisdiction IS NULL GROUP BY source_id').all();
if (unmatched.length > 0) {
  console.log('Sources without jurisdiction/country mapping:', unmatched);
}

console.log(`Migration finished: ${totalUpdated} rows updated in total.`);
db.close();
