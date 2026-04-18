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
    units-organic/
      index.js
  lib/
  runs/
  verify-latest-sales-organic-run.js
  verify-latest-units-organic-run.js
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

Run only the Units Organic suite:

```bash
cd scripts && npm run test:units-organic
```

Run the local runners directly:

```bash
cd scripts && node index.js --bsr --date 2026-04-07
cd scripts && node index.js --bsr --date 2026-04-07 --source sheet
cd scripts && node index.js --bsr --date 2026-04-15 --source file
cd scripts && node index.js --sales-organic --date 2026-04-15 --source file --delay-ms 0
cd scripts && node index.js --sales-organic --date 2026-04-15 --source sheet --delay-ms 0
cd scripts && node index.js --units-organic --date 2026-04-07 --source file
cd scripts && node index.js --units-organic --date 2026-04-07 --source sheet --delay-ms 0
```

Verify the latest Sales Organic run artifact without re-reading older runs:

```bash
cd scripts && node verify-latest-sales-organic-run.js
# or
cd scripts && npm run verify:sales-organic-run
```

Verify the latest Units Organic run artifact without re-reading older runs:

```bash
cd scripts && node verify-latest-units-organic-run.js
# or
cd scripts && npm run verify:units-organic-run
```

## Sales Organic proof flow

File mode remains the default source, so the reproducible local proof path is:

```bash
cd scripts && node index.js --sales-organic --date 2026-04-15 --source file --delay-ms 0
cd scripts && node verify-latest-sales-organic-run.js
```

The file-first input contract now fails closed for ambiguous or malformed local fixtures. Expect the run to stop with actionable row/file context when `data/sales-organic-input.json` has duplicate `date`+`sku` rows for the requested date, malformed numeric values, missing required fields, or zero rows for the requested date.

Optional sheet parity flow (diagnostics only; does not change the default source):

```bash
cd scripts && node index.js --sales-organic --date 2026-04-15 --source sheet --delay-ms 0
cd scripts && node verify-latest-sales-organic-run.js
```

The verifier inspects only the newest `runs/sales-organic-*.json` artifact and checks the hardened contract for lifecycle phases, summary counters, per-SKU totals, comparison mismatch parity, warning semantics, and failure/error shape.

## Units Organic proof flow

Local live proof for Units Organic must use `scripts/.env`; do not prompt again for credentials or point elsewhere while reproducing the slice demo.

```bash
cd scripts && node index.js --units-organic --date 2026-04-07 --source file
cd scripts && node verify-latest-units-organic-run.js
# or
cd scripts && npm run units-organic -- --date 2026-04-07 --source file
cd scripts && npm run verify:units-organic-run
```

Optional sheet parity proof uses the same runner and verifier surfaces:

```bash
cd scripts && node index.js --units-organic --date 2026-04-07 --source sheet --delay-ms 0
cd scripts && node verify-latest-units-organic-run.js
```

Workflow-local parity diagnostics are separate from the live runner and now lock the aligned `Get Units Organic` workflow contract (`SP Create Units Organic Report` → `SP Parse Units Organic by SKU` → sheet read → compute → sheet update):

```bash
cd scripts && node tests/units-organic-tests.js --grep "workflow json parity|workflow local runner|workflow compute node"
cd scripts && node run-units-organic-workflow-local.js --json
# or
cd scripts && npm run workflow:units-organic -- --json
```

The `--json` command is the first-stop parity diagnostic surface. It emits a machine-readable summary with:

- `parser.localStatus` / `parser.workflowStatus` — parser contract health for the local extractor and checked-in workflow node
- `compute.localStatus` / `compute.workflowStatus` — compute contract health for the local implementation and checked-in workflow node
- `compute.mismatchCount` — row-targeted update mismatches between local expected writebacks and workflow-emitted writebacks
- `compute.mismatchPreview` — capped mismatch details (`sku`, expected value, actual value) for fast inspection without flooding logs
- `compute.reportOnlySkuCount` / `compute.reportOnlySkus` — SKUs present in the Amazon report but absent from the sheet target set
- `compute.sheetOnlySkuCount` / `compute.sheetOnlySkus` — SKUs present in the sheet target set but absent from the Amazon report

Interpretation after the S03 alignment:

- `localStatus === "ok"` and `workflowStatus === "ok"` with `mismatchCount === 0` means workflow/local parity is locked and any remaining SKU deltas are outside the writeback target set, not a contract regression.
- Non-zero `reportOnly` or `sheetOnly` buckets with `mismatchCount === 0` are residual business/data drift diagnostics. Investigate fixture/report freshness, sheet membership, or expected target-set scope before changing workflow logic.
- Non-empty `mismatchPreview` means the checked-in workflow and local compute contract disagree on concrete row updates. Treat that as workflow/local drift and inspect the referenced SKU rows before trusting either surface.
- Any unexpected summary shape or non-JSON output should fail the verification command immediately; do not hand-wave parse issues, because automation depends on this surface being machine-readable.

A copy-pasteable slice gate that enforces the improved baseline versus the old S02 mismatch freeze is:

```bash
cd scripts && node tests/units-organic-tests.js --grep "workflow json parity|workflow local runner|workflow compute node" && node -e "const { execSync } = require('node:child_process'); const raw = execSync('node run-units-organic-workflow-local.js --json', { encoding: 'utf8' }); const summary = JSON.parse(raw); if (summary.compute.mismatchCount >= 17) throw new Error('mismatch count did not improve from S02 baseline'); if (summary.compute.localStatus !== 'ok' || summary.compute.workflowStatus !== 'ok') throw new Error('compute parity status not ok'); console.log('mismatchCount', summary.compute.mismatchCount);" && npm test
```

The newest `runs/units-organic-*.json` artifact is the durable proof surface. Success runs retain lifecycle/report metadata plus per-SKU `totalUnits`, `adUnits`, and `salesOrganicQty`; auth, report, parse, and compute failures remain stage-specific in the saved artifact and surface through the verifier. Sheet-source load failures remain compute-stage failures with `source=sheet` context so verifier/debug surfaces expose credential, timeout, or row-shape drift instead of masking it.

## Sales PPC workflow-local parity flow

Sales PPC now has a workflow-local parity harness for the checked-in `Get Sales PPC` workflow compute path. Use the focused grep block first when you need invariant-specific failures, then inspect the harness JSON summary to confirm aligned zero-mismatch behavior and bounded target-set diagnostics:

```bash
cd scripts && node tests/sales-ppc-tests.js --grep "workflow json parity|workflow local runner|workflow compute node"
cd scripts && node run-sales-ppc-workflow-local.js --json
# or
cd scripts && npm run workflow:sales-ppc -- --json
```

The `--json` output is the primary machine-readable parity surface. It exposes:

- `compute.localStatus` / `compute.workflowStatus` — whether the local compute path and checked-in workflow compute node both executed cleanly
- `compute.mismatchCount` — how many sheet writeback ranges differ between local truth and workflow-emitted updates
- `compute.mismatchPreview` — capped mismatch details (`range`, `sku`, `localValue`, `workflowValue`, `delta`) for fast diagnosis
- `compute.reportOnlySkuCount` / `compute.reportOnlySkus` — SKUs present in the Amazon report fixture but absent from the sheet target set
- `compute.sheetOnlySkuCount` / `compute.sheetOnlySkus` — SKUs present in the sheet target set but absent from the report fixture
- `compute.updateCount`, `compute.localUpdateCount`, `compute.workflowUpdateCount` — expected versus workflow-emitted batch update coverage

Interpretation for the current S04 aligned contract:

- `localStatus === "ok"` and `workflowStatus === "ok"` with `mismatchCount === 0` means the checked-in workflow and local Sales PPC compute contract are aligned for the shared fixture set, so the workflow JSON can be trusted as the repo baseline.
- Non-zero `reportOnly` or `sheetOnly` buckets with `mismatchCount === 0` remain bounded target-set diagnostics, not writeback regressions by themselves. They show fixture/report coverage outside the compared sheet rows.
- Any non-empty `mismatchPreview`, non-zero `mismatchCount`, missing workflow markers, malformed code, malformed sheet/report fixtures, or malformed summary fields should fail the grep block loudly with `[workflow json parity]` or exact summary field-path assertions. Treat those as regressions.

The shared regression path remains:

```bash
cd scripts && npm test
```

## Sources

- `file` (default): `data/sales-organic-input.json` for Sales Organic, `data/units-organic-input.json` for Units Organic
- `sheet`: Google Sheet rows from `SHEET_NAME!RANGE` where supported

## Output

- console summary with lifecycle phases (`auth`, `create-report`, `poll-report`, `download-report`, `parse`, `compute`)
- JSON report under `runs/`
- per-SKU rows including `totalSales`, `adSales`, `salesOrganic`, and comparison status for Sales Organic
- per-SKU rows including `totalUnits`, `adUnits`, and `salesOrganicQty` for Units Organic

## Sales Organic rule

The local Sales Organic runner treats Amazon order-report `item-price` as total sales input, includes `Shipped` and `Pending` rows, excludes `Cancelled` and unsupported statuses, aggregates duplicate SKU rows, and clamps negative `salesOrganic` values to zero.

## Workflow parity and retained mismatch scope

Static workflow parity coverage is now available via:

```bash
cd scripts && node tests/sales-organic-tests.js --grep "workflow json parity"
```

That grep-able parity block fails loudly if `../workflows/Get Sales Organic.json` drifts on contract-critical invariants: Sales Organic node names, parser fail-closed numerics and warnings, sheet header scanning, sentinel-row filtering, `Math.max(0, totalSales - adSales)` clamping, parser-to-sheet node wiring, and target-column-only `SALES_ORGANIC_$` writeback.

Intentional retained mismatch for later live rollout: the repo-local artifact path is broader than the checked-in workflow writeback path. Local computation and run artifacts keep report-only / ad-sales-only SKU boundaries inspectable in JSON summaries and warnings, but the workflow compute node still emits only row-limited Google Sheet updates for retained sheet rows in the target `SALES_ORGANIC_$` column. It does not create extra diagnostic rows in the sheet for report-only SKUs or widen writeback beyond that target column.

Evidence pointers:

- `scripts/tests/sales-organic-tests.js`
  - `compute keeps report-only and ad-sales-only skus inspectable in sheet mode`
  - `workflow json parity locks the checked-in Sales Organic contract`
- `scripts/features/sales-organic/index.js` → `computeSalesOrganic()`
- `scripts/run-sales-organic-workflow-local.js` → `compareUpdateMaps()` and local/workflow parity summary output

## Local env

Uses `scripts/.env` for local live proof commands, including Units Organic.
cluding Units Organic.
