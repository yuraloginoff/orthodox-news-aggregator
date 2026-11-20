// src/api.js
// Общие API-роуты для публичного сервера и админки.

import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { pool } from './db.js';
import logger from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getSourceInfoById() {
  const sourcesConfigPath = path.join(__dirname, '..', 'config', 'sources.json');
  let sourceInfoById = {};
  try {
    const sourcesConfig = JSON.parse(readFileSync(sourcesConfigPath, 'utf-8'));
    sourceInfoById = Object.fromEntries(
      sourcesConfig.sources.map((s) => [
        s.id,
        {
          name: s.name,
          region: s.region || null,
          requiresProxy: Boolean(s.proxy),
          enabled: s.enabled !== false,
        },
      ])
    );
  } catch (err) {
    logger.warn('Не удалось загрузить config/sources.json', { error: err.message });
  }
  return sourceInfoById;
}

/**
 * Возвращает Express-роут GET /api/sources.
 * Принимает sourceInfoById (объект { id: { name, region, ... } }) из config/sources.json.
 */
export function getSourcesRouter(sourceInfoById) {
  return async (req, res) => {
    try {
      const { rows: sources } = await pool.query('SELECT DISTINCT source_id FROM news');

      const enriched = sources
        .map((s) => {
          const info = sourceInfoById[s.source_id] || { name: s.source_id, region: null, requiresProxy: false, enabled: true };
          return { id: s.source_id, name: info.name, region: info.region, requiresProxy: info.requiresProxy, enabled: info.enabled };
        })
        .filter((s) => s.enabled)
        .map((s) => ({ id: s.id, name: s.name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ru'));

      res.json(enriched);
    } catch (err) {
      logger.error('Error in /api/sources', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  };
}
