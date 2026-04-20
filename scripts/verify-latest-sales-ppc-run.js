#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const assert = require('assert');

function main(options = {}) {
  const runsDir = options.runsDir || path.join(__dirname, 'runs');
  assertDirectoryExists(runsDir);

  const latestPath = options.filePath || findLatestSalesPpcRun(runsDir);
  const report = readJson(latestPath);
  const result = verifySalesPpcRun(report, { filePath: latestPath });

  console.log(`[verify-sales-ppc-run] Verified latest run: ${latestPath}`);
  console.log(
    `[verify-sales-ppc-run] status=${result.status} stage=${result.stage} items=${result.itemCount} warnings=${result.warningCount} mismatches=${result.mismatchCount}`,
  );

  return result;
}

function verifySalesPpcRun(report, { filePath = '<memory>' } = {}) {
  assert.ok(report && typeof report === 'object' && !Array.isArray(report), `Expected report object in ${filePath}`);
  assert.strictEqual(report.metric, 'sales-ppc', 'Expected metric to be sales-ppc');
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
  assert.ok(['sales7d', 'attributedSales7d', null].includes(report.summary.preferredSalesField), 'Expected preferredSalesField summary');
  assert.ok(['sales7d', 'attributedSales7d', 'attributedSalesSameSku7d', null].includes(report.summary.rawPreferredSalesField), 'Expected rawPreferredSalesField summary');
  assertFieldUsageShape(report.summary.fieldUsage, 'summary.fieldUsage');
  assert.strictEqual(report.reportInfo.preferredSalesField, report.summary.preferredSalesField, 'Expected reportInfo preferredSalesField to mirror summary');
  assert.strictEqual(report.reportInfo.rawPreferredSalesField, report.summary.rawPreferredSalesField, 'Expected reportInfo rawPreferredSalesField to mirror summary');
  for (const field of ['parsedRowCount', 'parsedSkuCount', 'expectedSkuCount', 'computedSkuCount', 'matchedSkuCount', 'mismatchedSkuCount', 'missingExpectedSkuCount', 'extraReportSkuCount']) {
    assert.ok(Number.isInteger(report.summary[field]), `Expected summary ${field} to be an integer`);
  }
  assert.strictEqual(report.summary.computedSkuCount, report.items.length, 'Expected computedSkuCount to match items length');
  assert.strictEqual(
    report.summary.fieldUsage.sales7d + report.summary.fieldUsage.attributedSales7d + report.summary.fieldUsage.attributedSalesSameSku7d,
    report.summary.parsedRowCount,
    'Expected fieldUsage counters to sum to parsedRowCount',
  );
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
      report.warnings.some((warning) => warning === `${report.summary.mismatchedSkuCount} SKU rows differ from the expected Sales PPC fixture.`),
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
    assertItemShape(item, index, report.summary);
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

function assertFieldUsageShape(fieldUsage, label) {
  assert.ok(fieldUsage && typeof fieldUsage === 'object', `Expected ${label} object`);
  for (const field of ['sales7d', 'attributedSales7d', 'attributedSalesSameSku7d']) {
    assert.ok(Number.isInteger(fieldUsage[field]), `Expected ${label}.${field} integer`);
  }
}

function assertItemShape(item, index, summary) {
  assert.ok(item && typeof item === 'object', `Expected item ${index} to be an object`);
  assert.ok(item.sku, `Expected item ${index} sku`);
  assert.ok(Number.isFinite(item.reportSalesPpc), `Expected item ${index} reportSalesPpc to be finite`);
  assert.ok(['match', 'mismatch', 'no-expected'].includes(item.comparisonStatus), `Unexpected comparisonStatus on item ${index}`);
  assert.strictEqual(typeof item.reportPresent, 'boolean', `Expected item ${index} reportPresent boolean`);
  assert.strictEqual(typeof item.fixturePresent, 'boolean', `Expected item ${index} fixturePresent boolean`);
  assert.ok(['file', 'sheet'].includes(item.source), `Expected item ${index} source to be file or sheet`);
  if (item.expectedSalesPpc !== null && item.expectedSalesPpc !== undefined) {
    assert.ok(Number.isFinite(item.expectedSalesPpc), `Expected item ${index} expectedSalesPpc to be finite when present`);
  }
  if (item.salesDelta !== null && item.salesDelta !== undefined) {
    assert.ok(Number.isFinite(item.salesDelta), `Expected item ${index} salesDelta to be finite when present`);
  }
  assert.ok(item.provenance && typeof item.provenance === 'object', `Expected item ${index} provenance object`);
  assert.ok(['sales7d', 'attributedSales7d', null].includes(item.provenance.preferredSalesField), `Expected item ${index} preferredSalesField`);
  assert.ok(['sales7d', 'attributedSales7d', 'attributedSalesSameSku7d', null].includes(item.provenance.rawPreferredSalesField), `Expected item ${index} rawPreferredSalesField`);
  assert.ok(['sales7d', 'attributedSales7d', 'mixed', null].includes(item.provenance.chosenField), `Expected item ${index} chosenField`);
  assert.ok(['sales7d', 'attributedSales7d', 'attributedSalesSameSku7d', 'mixed', null].includes(item.provenance.rawChosenField), `Expected item ${index} rawChosenField`);
  for (const field of ['rowCount', 'fallbackRows', 'sales7d', 'attributedSales7d', 'attributedSalesSameSku7d']) {
    assert.ok(Number.isInteger(item.provenance[field]), `Expected item ${index} provenance ${field} integer`);
  }
  assert.strictEqual(item.provenance.preferredSalesField, summary.preferredSalesField, `Expected item ${index} preferredSalesField to mirror summary`);
  assert.strictEqual(item.provenance.rawPreferredSalesField, summary.rawPreferredSalesField, `Expected item ${index} rawPreferredSalesField to mirror summary`);
  assert.strictEqual(
    item.provenance.sales7d + item.provenance.attributedSales7d + item.provenance.attributedSalesSameSku7d,
    item.provenance.rowCount,
    `Expected item ${index} provenance counters to sum to rowCount`,
  );
  assert.ok(item.provenance.fallbackRows >= 0 && item.provenance.fallbackRows <= item.provenance.rowCount, `Expected item ${index} fallbackRows within rowCount bounds`);
  if (item.provenance.fallbackRows > 0) {
    assert.notStrictEqual(item.provenance.chosenField, item.provenance.preferredSalesField, `Expected item ${index} chosenField to differ when fallbackRows > 0`);
  }
}

function assertMismatchShape(item, index, itemsBySku) {
  assert.ok(item && typeof item === 'object', `Expected mismatch ${index} to be an object`);
  assert.ok(item.sku, `Expected mismatch ${index} sku`);
  for (const field of ['reportSalesPpc', 'expectedSalesPpc', 'salesDelta', 'fallbackRows']) {
    assert.ok(Number.isFinite(item[field]), `Expected mismatch ${index} field ${field} to be finite`);
  }
  assert.ok(['sales7d', 'attributedSales7d', 'mixed', null].includes(item.chosenField), `Expected mismatch ${index} chosenField`);
  assert.ok(['sales7d', 'attributedSales7d', 'attributedSalesSameSku7d', 'mixed', null].includes(item.rawChosenField), `Expected mismatch ${index} rawChosenField`);

  const matchingItem = itemsBySku.get(item.sku);
  assert.ok(matchingItem, `Expected mismatch ${index} sku to exist in items`);
  assert.strictEqual(matchingItem.comparisonStatus, 'mismatch', `Expected mismatch ${index} sku to point at mismatch item`);
  assert.strictEqual(item.chosenField, matchingItem.provenance.chosenField, `Expected mismatch ${index} chosenField to mirror item provenance`);
  assert.strictEqual(item.rawChosenField, matchingItem.provenance.rawChosenField, `Expected mismatch ${index} rawChosenField to mirror item provenance`);
  assert.strictEqual(item.fallbackRows, matchingItem.provenance.fallbackRows, `Expected mismatch ${index} fallbackRows to mirror item provenance`);
}

function assertDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    throw new Error(`Runs directory not found: ${dirPath}`);
  }
}

function findLatestSalesPpcRun(runsDir) {
  const files = fs.readdirSync(runsDir)
    .filter((name) => name.startsWith('sales-ppc-') && name.endsWith('.json'))
    .map((name) => {
      const filePath = path.join(runsDir, name);
      return {
        filePath,
        mtimeMs: fs.statSync(filePath).mtimeMs,
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  if (!files.length) {
    throw new Error(`No sales-ppc JSON runs found in ${runsDir}`);
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
  verifySalesPpcRun,
  findLatestSalesPpcRun,
  assertItemShape,
};
