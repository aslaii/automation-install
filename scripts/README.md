# scripts

Local feature-based runners for verifying Amazon workflow behavior outside n8n.

## Structure

```text
scripts/
  index.js
  .env
  .env.example
  package.json
  data/
  features/
    bsr/
      index.js
    sales-organic/
      index.js
  lib/
  runs/
  tests/
```

## Commands

```bash
node index.js --bsr --date 2026-04-07
node index.js --bsr --date 2026-04-07 --source sheet
node index.js --bsr --date 2026-04-15 --source file
node index.js --sales-organic --date 2026-04-07
node index.js --sales-organic --date 2026-04-07 --source file --delay-ms 0
npm test
```

## Sources

- `file` (default): `data/products.json`
- `sheet`: Google Sheet rows from `SHEET_NAME!RANGE`

## Output

- console summary
- JSON report under `runs/`

## Sales Organic rule

The local Sales Organic runner currently treats Amazon order-report `item-price` as total sales input, including `Shipped` and `Pending` rows and excluding `Cancelled` rows.

## Local env

Uses `scripts/.env`.
