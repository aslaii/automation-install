# test-bsr

Local runner for verifying the Get BSR workflow outside n8n.

## Commands

```bash
node index.js --bsr --date 2026-04-07
node index.js --bsr --date 2026-04-07 --source sheet
node index.js --bsr --date 2026-04-01 --end-date 2026-04-07 --delay-ms 250
```

## Sources

- `file` (default): `data/products.json`
- `sheet`: Google Sheet rows from `SHEET_NAME!RANGE`

## Output

- console summary
- JSON report under `runs/`

## Local env

Uses `.env` in this folder.
