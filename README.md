# Orthodox News Aggregator (Глас)

RSS aggregator for Orthodox news sources.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create directories:
```bash
mkdir -p data logs
```

3. Configure proxy (optional):
```bash
cp .env.example .env
# Edit .env and add RSS_PROXY_URL for blocked sources
```

4. Run the parser:
```bash
npm start
```

## Configuration

Edit `config/sources.json` to add or remove RSS sources.

### Source options:
- `id`: Unique identifier (e.g., "R1", "UA3")
- `name`: Display name
- `url`: RSS feed URL
- `priority`: "high", "medium", or "low"
- `proxy`: true/false (use proxy for blocked sources like R16, R20, UA3)
- `parser`: "telegram" (for FetchRSS from Telegram like R16, R20)
- `filters.categories`: Array of category names to filter (e.g., R14, R26)

## Database

News are stored in `data/news.db` (SQLite).

- `fetched_at` is stored in UTC
- Convert to user's timezone on the frontend

## Logs

Logs are written to `logs/parser.log`.

## License

MIT
