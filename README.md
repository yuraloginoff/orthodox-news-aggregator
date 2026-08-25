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

3. Run the parser:
```bash
npm start
```

## Configuration

Edit `config/sources.json` to add or remove RSS sources.

## Database

News are stored in `data/news.db` (SQLite).

## Logs

Error logs are written to `logs/error.log`.

## License

MIT
