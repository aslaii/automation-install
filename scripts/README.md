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
  scripts/
    verify-sales-organic-run.js
  tests/
```

## Commands

Run all automated checks from the real project path:

```bash
cd scripts && npm test
```

Run only the existing BSR suite:

```bash
cd scripts && npm run test:bsr
```

Run only the Sales Organic suite:

```bash
cd scripts && npm run test:sales-organic
```

Run the local runners directly:

```bash
cd scripts && node index.js --bsr --date 2026-04-07
cd scripts && node index.js --bsr --date 2026-04-07 --source sheet
cd scripts && node index.js --bsr --date 2026-04-15 --source file
cd scripts && node index.js --sales-organic --date 2026-04-07
cd scripts && node index.js --sales-organic --date 2026-04-07 --source file --delay-ms 0
cd scripts && node index.js --sales-organic --date 2026-04-07 --source sheet --delay-ms 0
```

Verify the latest Sales Organic run artifact without re-reading older runs:

```bash
cd scripts && node scripts/verify-sales-organic-run.js
# or
cd scripts && npm run verify:sales-organic-run
```

## Sales Organic proof flow

File mode remains the default source, so the reproducible local proof path is:

```bash
cd scripts && node index.js --sales-organic --date YYYY-MM-DD --source file --delay-ms 0
cd scripts && node scripts/verify-sales-organic-run.js
```

Optional sheet parity flow:

```bash
cd scripts && node index.js --sales-organic --date YYYY-MM-DD --source sheet --delay-ms 0
cd scripts && node scripts/verify-sales-organic-run.js
```

The verifier inspects only the newest `runs/sales-organic-*.json` artifact and checks the contract for lifecycle phases, summary fields, per-SKU totals, ad sales, organic sales, and failure/error shape.

## Sources

- `file` (default): `data/sales-organic-input.json`
- `sheet`: Google Sheet rows from `SHEET_NAME!RANGE`

## Output

- console summary with lifecycle phases (`auth`, `create-report`, `poll-report`, `download-report`, `parse`, `compute`)
- JSON report under `runs/`
- per-SKU rows including `totalSales`, `adSales`, `salesOrganic`, and comparison status

## Sales Organic rule

The local Sales Organic runner treats Amazon order-report `item-price` as total sales input, includes `Shipped` and `Pending` rows, excludes `Cancelled` and unsupported statuses, aggregates duplicate SKU rows, and clamps negative `salesOrganic` values to zero.

## Local env

Uses `scripts/.env`.
