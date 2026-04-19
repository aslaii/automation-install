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
    ads-products-2026-04-15.csv
    sales-organic-input.json
    sales-ppc-input.json
  features/
    bsr/
      index.js
    ctr/
      index.js
    sales-organic/
      index.js
    sales-ppc/
      index.js
  lib/
  runs/
  verify-latest-ctr-run.js
  verify-latest-sales-organic-run.js
  verify-latest-sales-ppc-run.js
  verify-latest-units-organic-run.js
  tests/
```

## Commands

Run all automated checks:

```bash
cd scripts && npm test
```

Run focused suites:

```bash
cd scripts && npm run test:bsr
cd scripts && npm run test:sales-organic
cd scripts && npm run test:sales-ppc
cd scripts && npm run test:ctr
cd scripts && npm run test:units-organic
```

Run the local runners directly:

```bash
cd scripts && node index.js --bsr --date 2026-04-07
cd scripts && node index.js --sales-organic --date 2026-04-15 --source file --delay-ms 0
cd scripts && node index.js --sales-ppc --date 2026-04-15 --source file --delay-ms 0
cd scripts && node index.js --ctr --date 2026-04-15 --source file --delay-ms 0
```

## CTR proof flow

CTR is now a first-class shared CLI metric and uses the same runner path as the other local metrics.

```bash
cd scripts && node tests/ctr-tests.js
cd scripts && node tests/ctr-tests.js --grep "compute-stage failure artifacts|canonical ads csv|malformed"
cd scripts && node index.js --ctr --date 2026-04-15 --source file --delay-ms 0
cd scripts && node verify-latest-ctr-run.js
cd scripts && node run-ctr-workflow-local.js --json
cd scripts && npm run workflow:ctr -- --json
# or
cd scripts && npm run ctr -- --date 2026-04-15 --source file --delay-ms 0
cd scripts && npm run verify:ctr-run
```

The file-first CTR proof path reads the canonical Ads CSV at `data/ads-products-2026-04-15.csv` and persists a canonical `runs/ctr-*.json` artifact. The requested date must match the single `YYYY-MM-DD` embedded in the filename, and the loader fails closed on malformed canonical rows (missing required headers, bad numerics, unsplittable `Products`, duplicate extracted SKUs, or row column drift).

The workflow-local CTR parity harness compares the shared local CTR runner against the checked-in `workflows/Get CTR.json` compute node using fixture-backed inputs only. Its default sheet fixture is `tests/fixtures/ctr-workflow-local-sheet-workflow.json`, which includes top-matter rows above the real `SKU`/`CTR` header plus `fileRows[]` used to materialize deterministic local expected-input CSV content without mutating the existing file-first fixture.

Success artifacts include per-SKU `clicks`, `impressions`, `ctr`, `expectedCtr`, `ctrDelta`, and mismatch traceability. Failure artifacts preserve compute-stage `status`, `error`, attempts, report identifiers, lifecycle metadata, and the loader-originated contract message with file path, row context, and violated key.

The verifier inspects only the newest CTR artifact and enforces:

- lifecycle phases: `auth`, `create-report`, `poll-report`, `download-report`, `parse`, `compute`
- summary counters for parsed/computed/mismatched SKUs
- mismatch payload traceability for file-backed expectations
- redacted failure shapes without raw Ads secrets or tokens

## Sales Organic proof flow

```bash
cd scripts && node index.js --sales-organic --date 2026-04-15 --source file --delay-ms 0
cd scripts && node verify-latest-sales-organic-run.js
```

## Sales PPC proof flow

```bash
cd scripts && node index.js --sales-ppc --date 2026-04-15 --source file --delay-ms 0
cd scripts && node verify-latest-sales-ppc-run.js
```

## Units Organic proof flow

```bash
cd scripts && node index.js --units-organic --date 2026-04-07 --source file
cd scripts && node verify-latest-units-organic-run.js
```

## Sources

- `file` (default): local checked-in fixtures. CTR uses the canonical Ads CSV `data/ads-products-2026-04-15.csv`; sales-organic and sales-ppc use JSON inputs such as `data/sales-organic-input.json` and `data/sales-ppc-input.json`
- `sheet`: Google Sheet rows where supported by the metric

## Output

- console summary with lifecycle phases (`auth`, `create-report`, `poll-report`, `download-report`, `parse`, `compute`)
- JSON report under `runs/`
- per-SKU comparison rows for the selected metric
- verifier commands for the latest saved artifact

## Local env

Uses `scripts/.env` for local live proof commands.
