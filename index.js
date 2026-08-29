import { fetchAllSources } from './src/parser.js';
import { readFileSync } from 'fs';

const sources = JSON.parse(
  readFileSync('./config/sources.json', 'utf-8')
).sources;

console.log(`Starting parser with ${sources.length} sources...\n`);

const items = await fetchAllSources(sources);
console.log(`\nTotal items fetched: ${items.length}`);
