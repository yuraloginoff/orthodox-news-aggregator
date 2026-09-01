import { fetchAllSources } from './src/parser.js';
import { initDb, insertNews, getNewsCount, closeDb } from './src/db.js';
import logger from './src/logger.js';
import cron from 'node-cron';
import { readFileSync } from 'fs';

const sources = JSON.parse(readFileSync('./config/sources.json', 'utf-8')).sources;

async function runParser() {
  logger.info('Starting parser run');
  logger.info(`Initial news count: ${getNewsCount()}`);

  const items = await fetchAllSources(sources);

  let inserted = 0;
  for (const item of items) {
    if (insertNews(item)) inserted++;
  }

  logger.info(`Parser run complete. Fetched ${items.length}, new: ${inserted}, total in DB: ${getNewsCount()}`);
}

async function main() {
  logger.info('Orthodox News Aggregator starting...');
  initDb();

  await runParser();

  cron.schedule('0 * * * *', async () => {
    logger.info('Scheduled parser run');
    await runParser();
  });

  logger.info('Parser scheduled to run every hour');
}

main().catch((error) => {
  logger.error(`Fatal error: ${error.message}`, { error });
  closeDb();
  process.exit(1);
});
