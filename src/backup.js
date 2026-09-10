// src/backup.js
// Создаёт резервную копию data/news.db в backups/, с привязкой времени в имени файла.
// Использует встроенный в better-sqlite3 метод db.backup() — он снимает корректный снимок
// даже если в базу в этот момент идёт активная запись (например, parser.js вставляет новости) —
// в отличие от простого копирования файла (cp), которое рискует сковать неконсистентный слез рядов SQLite.
//
// Запуск: npm run backup
// Автоматически удаляет бэкапы старше BACKUP_RETENTION_DAYS дней (по умолчанию 14),
// чтобы backups/ не росла бесконечно.

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import 'dotenv/config';
import logger from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'data', 'news.db');
const backupsDir = path.join(__dirname, '..', 'backups');

const RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS || 14);

function timestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function cleanupOldBackups() {
  if (!fs.existsSync(backupsDir)) return;

  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const files = fs.readdirSync(backupsDir).filter((f) => f.endsWith('.db'));

  let removed = 0;
  for (const file of files) {
    const filePath = path.join(backupsDir, file);
    const stat = fs.statSync(filePath);
    if (stat.mtimeMs < cutoff) {
      fs.unlinkSync(filePath);
      removed += 1;
    }
  }

  if (removed > 0) {
    logger.info(`Backup cleanup: removed ${removed} backup(s) older than ${RETENTION_DAYS} days`);
  }
}

async function runBackup() {
  if (!fs.existsSync(dbPath)) {
    logger.error(`Cannot backup: ${dbPath} does not exist`);
    process.exit(1);
  }

  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }

  const backupPath = path.join(backupsDir, `news-${timestamp()}.db`);
  const db = new Database(dbPath, { readonly: true });

  try {
    await db.backup(backupPath);
    const sizeKb = (fs.statSync(backupPath).size / 1024).toFixed(1);
    logger.info(`Backup created: ${backupPath} (${sizeKb} KB)`);
  } finally {
    db.close();
  }

  cleanupOldBackups();
}

runBackup().catch((error) => {
  logger.error(`Backup failed: ${error.message}`, { error });
  process.exit(1);
});
