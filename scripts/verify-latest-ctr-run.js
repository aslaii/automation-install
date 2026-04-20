#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const assert = require('assert');

function main(options = {}) {
  const runsDir = options.runsDir || path.join(__dirname, 'runs');
  assertDirectoryExists(runsDir);

  const latestPath = options.filePath || findLatestCtrRun(runsDir);
  const report = readJson(latestPath);
  const result = verifyCtrRun(report, { filePath: latestPath });

  console.log(`[verify-ctr-run] Verified latest run: ${latestPath}`);
  console.log(
    `[verify-ctr-run] status=${result.status} stage=${result.stage} items=${result.itemCount} warnings=${result.warningCount} mismatches=${result.mismatchCount}`,
  );

  return result;
}

function verifyCtrRun(report, { filePath = '<memory>' } = {}) {
  assert.ok(report && typeof report === 'object' && !Array.isArray(report), `Expected report object in ${filePath}`);
  assert.strictEqual(report.metric, 'ctr', 'Expected metric to be ctr');
  assert.ok(['success', 'failed'].includes(report.status), 'Expected status to be success or failed');
  assert.ok(report.stage, 'Expected stage to be present');
  assert.ok(report.startedAt, 'Expected startedAt to be present');
  assert.ok(report.completedAt, 'Expected completedAt to be present');
  assert.ok(report.dateRange && report.dateRange.startDate && report.dateRange.endDate, 'Expected dateRange start/end');
  assert.ok(report.request && report.request.source, 'Expected request source');
  assert.ok(report.summary && report.summary.status, 'Expected summary status');
  assert.strictEqual(report.summary.status, report.status, 'Expected summary status to mirror top-level status');
  assert.strictEqual(report.summary.stage, report.stage, 'Expected summary stage to mirror top-level stage');
  assert.ok(report.summary.attempts && Number.isInteger(report.summary.attempts.create), 'Expected summary attempts.create');
  assert.ok(report.summary.attempts && Number.isInteger(report.summary.attempts.poll), 'Expected summary attempts.poll');
  assert.ok(Array.isArray(report.lifecycle), 'Expected lifecycle array');
  assert.ok(Array.isArray(report.summary.lifecyclePhases), 'Expected summary lifecyclePhases array');
  assert.ok(Array.isArray(report.items), 'Expected items array');
  assert.ok(report.reportInfo && report.reportInfo.reportType, 'Expected reportInfo.reportType');

  if (report.stage !== 'auth') {
    const lifecycleSet = new Set(report.summary.lifecyclePhases);
    for (const stage of ['create-report', 'poll-report']) {
      assert.ok(lifecycleSet.has(stage), `Expected lifecycle phase ${stage}`);
    }
  }

  if (report.status === 'success') {
    verifySuccessReport(report);
  } else {
    verifyFailureReport(report);
  }

  return {
    status: report.status,
    stage: report.stage,
    itemCount: report.items.length,
    warningCount: Array.isArray(report.warnings) ? report.warnings.length : 0,
    mismatchCount: report.status === 'success' ? report.comparison.mismatches.length : 0,
  };
}

function verifySuccessReport(report) {
  assert.strictEqual(report.stage, 'compute', 'Expected successful runs to finish at compute');
  assert.ok(report.comparison && Array.isArray(report.comparison.mismatches), 'Expected comparison mismatches array');
  assert.ok(Array.isArray(report.comparison.extraReportSkus), 'Expected comparison extraReportSkus array');
  assert.ok(report.summary.lifecyclePhases.includes('auth'), 'Expected auth lifecycle phase on success');
  assert.ok(report.summary.lifecyclePhases.includes('download-report'), 'Expected download-report lifecycle phase on success');
  assert.ok(report.summary.lifecyclePhases.includes('parse'), 'Expected parse lifecycle phase on success');
  assert.ok(report.summary.lifecyclePhases.includes('compute'), 'Expected compute lifecycle phase on success');
  for (const field of ['parsedRowCount', 'parsedSkuCount', 'expectedSkuCount', 'computedSkuCount', 'matchedSkuCount', 'mismatchedSkuCount', 'missingExpectedSkuCount', 'extraReportSkuCount']) {
    assert.ok(Number.isInteger(report.summary[field]), `Expected summary ${field} to be an integer`);
  }
  assert.strictEqual(report.summary.computedSkuCount, report.items.length, 'Expected computedSkuCount to match items length');
  assert.strictEqual(
    report.summary.matchedSkuCount + report.summary.mismatchedSkuCount + report.summary.missingExpectedSkuCount,
    report.items.length,
    'Expected match/mismatch/missing counts to partition items',
  );
  assert.strictEqual(report.comparison.source, report.request.source, 'Expected comparison source to mirror request source');
  assert.ok(Number.isFinite(report.comparison.tolerance), 'Expected finite comparison tolerance');
  assert.ok(Array.isArray(report.warnings), 'Expected warnings array on success');

  if (report.summary.mismatchedSkuCount > 0) {
    assert.ok(
      report.warnings.some((warning) => warning === `${report.summary.mismatchedSkuCount} SKU rows differ from the expected CTR fixture.`),
      'Expected mismatch warning to reflect mismatchedSkuCount',
    );
  }

  if (report.summary.extraReportSkuCount > 0) {
    assert.ok(
      report.warnings.some((warning) => warning === `${report.summary.extraReportSkuCount} report SKUs were outside the comparison target set.`),
      'Expected extra report SKU warning to reflect extraReportSkuCount',
    );
  }

  assert.strictEqual(report.comparison.mismatches.length, report.summary.mismatchedSkuCount, 'Expected mismatches length to mirror summary');
  assert.strictEqual(report.comparison.extraReportSkus.length, report.summary.extraReportSkuCount, 'Expected extraReportSkus length to mirror summary');

  for (const [index, item] of report.items.entries()) {
    assertItemShape(item, index);
  }

  const itemsBySku = new Map(report.items.map((item) => [item.sku, item]));
  const mismatchSkus = new Set(report.comparison.mismatches.map((entry, index) => {
    assertMismatchShape(entry, index, itemsBySku);
    return entry.sku;
  }));
  const itemMismatchSkus = new Set(report.items.filter((item) => item.comparisonStatus === 'mismatch').map((item) => item.sku));
  assert.deepStrictEqual([...mismatchSkus].sort(), [...itemMismatchSkus].sort(), 'Expected mismatch SKU sets to align');

  const parseEntries = report.lifecycle.filter((entry) => entry.stage === 'parse');
  assert.strictEqual(parseEntries.length, 1, 'Expected one parse lifecycle entry on success');
  const computeEntries = report.lifecycle.filter((entry) => entry.stage === 'compute');
  assert.strictEqual(computeEntries.length, 1, 'Expected one compute lifecycle entry on success');
  assert.strictEqual(computeEntries[0].status, 'success', 'Expected compute lifecycle success on successful report');
}

function verifyFailureReport(report) {
  assert.ok(report.error && report.error.message, 'Expected failure report error details');
  assert.deepStrictEqual(report.items, [], 'Expected failed run items to be empty');
  assert.strictEqual(report.warnings, undefined, 'Expected failed runs to omit warnings array');
}

function assertItemShape(item, index) {
  assert.ok(item && typeof item === 'object', `Expected item ${index} to be an object`);
  assert.ok(item.sku, `Expected item ${index} sku`);
  for (const field of ['clicks', 'impressions', 'ctr']) {
    assert.ok(Number.isFinite(item[field]), `Expected item ${index} ${field} to be finite`);
  }
  assert.ok(['match', 'mismatch', 'no-expected'].includes(item.comparisonStatus), `Unexpected comparisonStatus on item ${index}`);
  assert.strictEqual(typeof item.reportPresent, 'boolean', `Expected item ${index} reportPresent boolean`);
  assert.strictEqual(typeof item.fixturePresent, 'boolean', `Expected item ${index} fixturePresent boolean`);
  assert.ok(['file', 'sheet'].includes(item.source), `Expected item ${index} source to be file or sheet`);
  if (item.expectedCtr !== null && item.expectedCtr !== undefined) {
    assert.ok(Number.isFinite(item.expectedCtr), `Expected item ${index} expectedCtr to be finite when present`);
  }
  if (item.ctrDelta !== null && item.ctrDelta !== undefined) {
    assert.ok(Number.isFinite(item.ctrDelta), `Expected item ${index} ctrDelta to be finite when present`);
  }
  assert.ok(item.traceability && typeof item.traceability === 'object', `Expected item ${index} traceability object`);
  assert.ok(item.traceability.report && Number.isInteger(item.traceability.report.rowCount), `Expected item ${index} traceability.report.rowCount integer`);
  if (item.fixturePresent) {
    assert.ok(item.traceability.expected && typeof item.traceability.expected === 'object', `Expected item ${index} traceability.expected object`);
    assert.ok(item.traceability.expected.filePath, `Expected item ${index} traceability.expected.filePath`);
    assert.ok(Number.isInteger(item.traceability.expected.rowNumber), `Expected item ${index} traceability.expected.rowNumber integer`);
    assert.ok(item.traceability.expected.date, `Expected item ${index} traceability.expected.date`);
  }
}

function assertMismatchShape(item, index, itemsBySku) {
  assert.ok(item && typeof item === 'object', `Expected mismatch ${index} to be an object`);
  assert.ok(item.sku, `Expected mismatch ${index} sku`);
  for (const field of ['clicks', 'impressions', 'ctr', 'expectedCtr', 'ctrDelta']) {
    assert.ok(Number.isFinite(item[field]), `Expected mismatch ${index} field ${field} to be finite`);
  }
  assert.ok(item.traceability && item.traceability.report && Number.isInteger(item.traceability.report.rowCount), `Expected mismatch ${index} traceability.report.rowCount`);
  assert.ok(item.traceability.expected && item.traceability.expected.filePath, `Expected mismatch ${index} traceability.expected.filePath`);
  assert.ok(Number.isInteger(item.traceability.expected.rowNumber), `Expected mismatch ${index} traceability.expected.rowNumber`);

  const matchingItem = itemsBySku.get(item.sku);
  assert.ok(matchingItem, `Expected mismatch ${index} sku to exist in items`);
  assert.strictEqual(matchingItem.comparisonStatus, 'mismatch', `Expected mismatch ${index} sku to point at mismatch item`);
  assert.deepStrictEqual(item.traceability, matchingItem.traceability, `Expected mismatch ${index} traceability to mirror item traceability`);
}

function assertDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    throw new Error(`Runs directory not found: ${dirPath}`);
  }
}

function findLatestCtrRun(runsDir) {
  const files = fs.readdirSync(runsDir)
    .filter((name) => name.startsWith('ctr-') && name.endsWith('.json'))
    .map((name) => {
      const filePath = path.join(runsDir, name);
      return {
        filePath,
        mtimeMs: fs.statSync(filePath).mtimeMs,
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  if (!files.length) {
    throw new Error(`No ctr JSON runs found in ${runsDir}`);
  }

  return files[0].filePath;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  main,
  verifyCtrRun,
  findLatestCtrRun,
  assertItemShape,
};
