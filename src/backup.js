// src/backup.js
// Создаёт резервную копию PostgreSQL-базы в backups/, с привязкой времени в имени файла.
// Использует системный pg_dump (через DATABASE_URL) — он должен быть установлен в системе
// (пакет postgresql-client). Заменяет ранний метод db.backup() из better-sqlite3, который работал
// только с локальными SQLite-файлами.
//
// Запуск: npm run backup
// Автоматически удаляет бэкапы старше BACKUP_RETENTION_DAYS дней (по умолчанию 14),
// чтобы backups/ не росла бесконечно.

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';
import 'dotenv/config';
import logger from './logger.js';

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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
  const files = fs.readdirSync(backupsDir).filter((f) => f.endsWith('.sql'));

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
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    logger.error('Cannot backup: DATABASE_URL is not set');
    process.exit(1);
  }

  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }

  const backupPath = path.join(backupsDir, `news-${timestamp()}.sql`);

  try {
    await execFileAsync('pg_dump', ['--dbname', databaseUrl, '--file', backupPath, '--format', 'plain']);
    const sizeKb = (fs.statSync(backupPath).size / 1024).toFixed(1);
    logger.info(`Backup created: ${backupPath} (${sizeKb} KB)`);
  } catch (error) {
    logger.error(`pg_dump failed: ${error.message}`);
    throw error;
  }

  cleanupOldBackups();
}

runBackup().catch((error) => {
  logger.error(`Backup failed: ${error.message}`, { error });
  process.exit(1);
});
