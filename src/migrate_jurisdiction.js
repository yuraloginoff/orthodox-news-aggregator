// src/migrate_jurisdiction.js
// Одноразовый скрипт: заполняет jurisdiction/country в таблице news на основе config/sources.json.
// PostgreSQL версия (раньше better-sqlite3). Запуск: node src/migrate_jurisdiction.js

import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import 'dotenv/config';
import { pool, closeDb } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(__dirname, '..', 'config', 'sources.json');

async function main() {
  const { sources } = JSON.parse(readFileSync(configPath, 'utf-8'));

  const columnsResult = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'news'"
  );
  const columns = columnsResult.rows.map((c) => c.column_name);

  if (!columns.includes('jurisdiction')) {
    await pool.query('ALTER TABLE news ADD COLUMN jurisdiction TEXT');
  }
  if (!columns.includes('country')) {
    await pool.query('ALTER TABLE news ADD COLUMN country TEXT');
  }

  let totalUpdated = 0;
  for (const source of sources) {
    if (!source.jurisdiction || !source.country) continue;
    const result = await pool.query(
      'UPDATE news SET jurisdiction = $1, country = $2 WHERE source_id = $3',
      [source.jurisdiction, source.country, source.id]
    );
    console.log(`${source.id} (${source.name}): ${result.rowCount} rows updated`);
    totalUpdated += result.rowCount;
  }

  const unmatchedResult = await pool.query(
    'SELECT source_id, COUNT(*) as cnt FROM news WHERE jurisdiction IS NULL GROUP BY source_id'
  );
  if (unmatchedResult.rows.length > 0) {
    console.log('Sources without jurisdiction/country mapping:', unmatchedResult.rows);
  }

  console.log(`Migration finished: ${totalUpdated} rows updated in total.`);
  await closeDb();
}

main().catch((error) => {
  console.error('Migration failed:', error.message);
  process.exit(1);
});
