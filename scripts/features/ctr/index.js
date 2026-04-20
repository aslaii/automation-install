const { loadConfig } = require('../../lib/config');
const { parseDateRange } = require('../../lib/date');
const { mintAmazonAdsAccessToken, redactSensitiveText } = require('../../lib/auth/amazon-ads');
const { runAmazonAdsReportLifecycle } = require('../../lib/ads/reports');
const { writeReport } = require('../../lib/output/write-report');
const { loadCtrFromFile } = require('../../lib/sources/ctr-file');
const { printCtrReport } = require('../../lib/console');

async function runGetCtr(cliArgs, deps = {}) {
  const loadConfigFn = deps.loadConfig || loadConfig;
  const parseDateRangeFn = deps.parseDateRange || parseDateRange;
  const mintAmazonAdsAccessTokenFn = deps.mintAmazonAdsAccessToken || mintAmazonAdsAccessToken;
  const runAmazonAdsReportLifecycleFn = deps.runAmazonAdsReportLifecycle || runAmazonAdsReportLifecycle;
  const loadCtrFromFileFn = deps.loadCtrFromFile || loadCtrFromFile;
  const writeReportFn = deps.writeReport || writeReport;
  const printReportFn = deps.printCtrReport || printCtrReport;
  const source = cliArgs.source || 'file';
  const delayMs = Number.isFinite(cliArgs.delayMs) ? cliArgs.delayMs : 250;
  const dateRange = parseDateRangeFn(cliArgs.date, cliArgs.endDate);
  const config = loadConfigFn({ source, metric: 'ctr' });
  const startedAt = new Date().toISOString();
  const boundaryContext = {
    cliArgs,
    source,
    delayMs,
    dateRange,
    startedAt,
  };
  const redactionSecrets = [
    config.amazonAds?.clientId,
    config.amazonAds?.clientSecret,
    config.amazonAds?.refreshToken,
  ];

  let accessToken;
  const authLifecycle = [];
  try {
    accessToken = await mintAmazonAdsAccessTokenFn(config.amazonAds, {
      timeout: config.amazonAds.authTimeoutMs,
    });
    redactionSecrets.push(accessToken);
    authLifecycle.push({ stage: 'auth', attempt: 1, status: 'success' });
  } catch (error) {
    authLifecycle.push({
      stage: 'auth',
      attempt: 1,
      status: error.timeout ? 'timeout' : 'error',
      httpStatus: error.httpStatus || null,
      message: redactErrorMessage(error, redactionSecrets),
    });

    return handleFailure({
      ...boundaryContext,
      stage: 'auth',
      error,
      lifecycle: authLifecycle,
      attempts: { create: 0, poll: 0 },
      redactionSecrets,
      writeReportFn,
      printReportFn,
    });
  }

  const reportLifecycleResult = await runAmazonAdsReportLifecycleFn({
    accessToken,
    clientId: config.amazonAds.clientId,
    profileId: config.amazonAds.profileId,
    dateRange,
    reportConfig: config.ctr.report,
    polling: config.ctr.polling,
  });

  if (!reportLifecycleResult.ok) {
    return handleFailure({
      ...boundaryContext,
      stage: reportLifecycleResult.stage,
      error: Object.assign(new Error(reportLifecycleResult.error.message), reportLifecycleResult.error),
      lifecycle: authLifecycle.concat(reportLifecycleResult.lifecycle),
      attempts: reportLifecycleResult.attempts,
      reportId: reportLifecycleResult.reportId,
      reportDocumentId: reportLifecycleResult.reportDocumentId,
      processingStatus: reportLifecycleResult.processingStatus,
      errorDetails: reportLifecycleResult.error,
      redactionSecrets,
      writeReportFn,
      printReportFn,
    });
  }

  let parsedReport;
  try {
    parsedReport = parseCtrReport(reportLifecycleResult.reportText);
  } catch (error) {
    return handleFailure({
      ...boundaryContext,
      stage: 'parse',
      error,
      lifecycle: authLifecycle.concat(reportLifecycleResult.lifecycle, [{ stage: 'parse', attempt: 1, status: 'error', message: redactErrorMessage(error, redactionSecrets) }]),
      attempts: reportLifecycleResult.attempts,
      reportId: reportLifecycleResult.reportId,
      reportDocumentId: reportLifecycleResult.reportDocumentId,
      processingStatus: reportLifecycleResult.processingStatus,
      redactionSecrets,
      writeReportFn,
      printReportFn,
    });
  }

  let expectedInput;
  try {
    if (source !== 'file') {
      throw new Error(`CTR source=${source} is not implemented yet; use --source file`);
    }
    expectedInput = await loadCtrFromFileFn(config.ctr.fileInput, dateRange.startDate);
  } catch (error) {
    return handleFailure({
      ...boundaryContext,
      stage: 'compute',
      error,
      lifecycle: authLifecycle.concat(
        reportLifecycleResult.lifecycle,
        [{ stage: 'parse', attempt: 1, status: parsedReport.parseWarning ? 'warning' : 'success', message: parsedReport.parseWarning || '' }],
        [{ stage: 'compute', attempt: 1, status: 'error', message: redactErrorMessage(error, redactionSecrets) }],
      ),
      attempts: reportLifecycleResult.attempts,
      reportId: reportLifecycleResult.reportId,
      reportDocumentId: reportLifecycleResult.reportDocumentId,
      processingStatus: reportLifecycleResult.processingStatus,
      redactionSecrets,
      writeReportFn,
      printReportFn,
    });
  }

  const computation = computeCtr({
    parsedReport,
    expectedInput,
    source,
    tolerance: config.ctr.comparisonTolerance || 0.0001,
  });

  const report = buildSuccessReport({
    cliArgs,
    source,
    delayMs,
    dateRange,
    startedAt,
    reportLifecycleResult,
    parsedReport,
    expectedInput,
    computation,
    tolerance: config.ctr.comparisonTolerance || 0.0001,
    lifecycle: authLifecycle,
  });

  const reportPath = await writeReportFn({ metric: 'ctr', report, dateRange });
  printReportFn(report, reportPath);

  return {
    report,
    reportPath,
    reportText: reportLifecycleResult.reportText,
  };
}

async function handleFailure({
  cliArgs,
  source,
  delayMs,
  dateRange,
  startedAt,
  stage,
  error,
  lifecycle,
  attempts,
  reportId = null,
  reportDocumentId = null,
  processingStatus = null,
  errorDetails = null,
  redactionSecrets = [],
  writeReportFn,
  printReportFn,
}) {
  const report = buildFailureReport({
    cliArgs,
    source,
    delayMs,
    dateRange,
    startedAt,
    stage,
    error,
    lifecycle,
    attempts,
    reportId,
    reportDocumentId,
    processingStatus,
    errorDetails,
    redactionSecrets,
  });

  const reportPath = await writeReportFn({ metric: 'ctr', report, dateRange });
  printReportFn(report, reportPath);
  const wrappedError = new Error(`CTR failed at ${stage}: ${report.error.message}`);
  wrappedError.reportPath = reportPath;
  throw wrappedError;
}

function parseCtrReport(reportText) {
  const normalizedText = String(reportText || '').trim();
  if (!normalizedText) {
    return buildEmptyParsedCtrResult({ rows: [], parseWarning: 'CTR report text empty' });
  }

  let parsed;
  try {
    parsed = JSON.parse(normalizedText);
  } catch (error) {
    throw new Error(`CTR report JSON parse failed: ${error.message}`);
  }

  const rows = normalizeCtrRows(parsed);
  if (rows.length === 0) {
    return buildEmptyParsedCtrResult({ rows, parseWarning: 'CTR report has no data rows' });
  }

  const bySku = {};
  for (let index = 0; index < rows.length; index += 1) {
    const parsedRow = parseCtrRow(rows[index], index);
    const existing = bySku[parsedRow.sku] || {
      sku: parsedRow.sku,
      clicks: 0,
      impressions: 0,
      ctr: 0,
      provenance: { rowCount: 0 },
    };

    existing.clicks = roundMetric(existing.clicks + parsedRow.clicks);
    existing.impressions = roundMetric(existing.impressions + parsedRow.impressions);
    existing.provenance.rowCount += 1;
    existing.ctr = computeCtrValue(existing.clicks, existing.impressions);
    bySku[parsedRow.sku] = existing;
  }

  return {
    rows,
    rowCount: rows.length,
    bySku,
    skuCount: Object.keys(bySku).length,
    parseWarning: null,
  };
}

function computeCtr({ parsedReport, expectedInput, source, tolerance }) {
  const reportBySku = parsedReport.bySku || {};
  const expectedBySku = expectedInput.bySku || {};
  const expectedSkus = Object.keys(expectedBySku);
  const extraReportSkus = Object.keys(reportBySku).filter((sku) => !expectedBySku[sku]).sort();
  const allSkus = source === 'file' && expectedSkus.length > 0
    ? expectedSkus.slice().sort()
    : Array.from(new Set([...Object.keys(reportBySku), ...expectedSkus])).sort();
  const items = [];
  const mismatches = [];

  for (const sku of allSkus) {
    const reportEntry = reportBySku[sku] || {
      sku,
      clicks: 0,
      impressions: 0,
      ctr: 0,
      provenance: { rowCount: 0 },
    };
    const expectedEntry = expectedBySku[sku] || {
      sku,
      expectedCtr: null,
      source,
      notes: '',
      productLabel: '',
      traceability: null,
    };

    const ctr = computeCtrValue(reportEntry.clicks, reportEntry.impressions);
    const expectedCtr = expectedEntry.expectedCtr;
    const ctrDelta = expectedCtr === null || expectedCtr === undefined
      ? null
      : roundCtrDelta(ctr - expectedCtr);
    const comparisonStatus = ctrDelta === null
      ? 'no-expected'
      : Math.abs(ctrDelta) <= tolerance
        ? 'match'
        : 'mismatch';

    const item = {
      sku,
      clicks: roundMetric(reportEntry.clicks),
      impressions: roundMetric(reportEntry.impressions),
      ctr,
      expectedCtr,
      ctrDelta,
      comparisonStatus,
      source: expectedEntry.source || source,
      reportPresent: Boolean(reportBySku[sku]),
      fixturePresent: Boolean(expectedBySku[sku]),
      notes: expectedEntry.notes || '',
      productLabel: expectedEntry.productLabel || '',
      traceability: {
        report: {
          rowCount: reportEntry.provenance?.rowCount || 0,
        },
        expected: expectedEntry.traceability || null,
      },
    };

    if (comparisonStatus === 'mismatch') {
      mismatches.push({
        sku,
        clicks: item.clicks,
        impressions: item.impressions,
        ctr: item.ctr,
        expectedCtr: item.expectedCtr,
        ctrDelta: item.ctrDelta,
        traceability: item.traceability,
      });
    }

    items.push(item);
  }

  return {
    items,
    mismatches,
    extraReportSkus,
    summary: {
      skuCount: items.length,
      matched: items.filter((item) => item.comparisonStatus === 'match').length,
      mismatched: mismatches.length,
      missingExpected: items.filter((item) => item.comparisonStatus === 'no-expected').length,
      extraReportSkuCount: extraReportSkus.length,
    },
  };
}

function buildSuccessReport({
  cliArgs,
  source,
  delayMs,
  dateRange,
  startedAt,
  reportLifecycleResult,
  parsedReport,
  expectedInput,
  computation,
  tolerance,
  lifecycle,
}) {
  const warnings = [];
  if (parsedReport.parseWarning) warnings.push(parsedReport.parseWarning);
  if (computation.summary.extraReportSkuCount > 0) warnings.push(`${computation.summary.extraReportSkuCount} report SKUs were outside the comparison target set.`);
  if (computation.summary.mismatched > 0) warnings.push(`${computation.summary.mismatched} SKU rows differ from the expected CTR fixture.`);

  const reportLifecycle = lifecycle.concat(reportLifecycleResult.lifecycle, [
    { stage: 'parse', attempt: 1, status: parsedReport.parseWarning ? 'warning' : 'success', message: parsedReport.parseWarning || '' },
    { stage: 'compute', attempt: 1, status: 'success', message: `Computed ${computation.summary.skuCount} SKU rows` },
  ]);

  return {
    metric: 'ctr',
    source,
    startedAt,
    completedAt: new Date().toISOString(),
    dateRange,
    request: {
      date: cliArgs.date,
      endDate: cliArgs.endDate || cliArgs.date,
      source,
      delayMs,
    },
    stage: 'compute',
    status: 'success',
    summary: {
      status: 'success',
      stage: 'compute',
      attempts: reportLifecycleResult.attempts,
      lifecyclePhases: summarizeStages(reportLifecycle),
      reportId: reportLifecycleResult.reportId,
      reportDocumentId: reportLifecycleResult.reportDocumentId,
      downloadedBytes: Buffer.byteLength(reportLifecycleResult.reportText || '', 'utf8'),
      parsedRowCount: parsedReport.rowCount,
      parsedSkuCount: parsedReport.skuCount,
      expectedSkuCount: expectedInput.skuCount,
      computedSkuCount: computation.summary.skuCount,
      matchedSkuCount: computation.summary.matched,
      mismatchedSkuCount: computation.summary.mismatched,
      missingExpectedSkuCount: computation.summary.missingExpected,
      extraReportSkuCount: computation.summary.extraReportSkuCount,
    },
    lifecycle: reportLifecycle,
    reportInfo: {
      reportType: 'spAdvertisedProduct',
      reportId: reportLifecycleResult.reportId,
      reportDocumentId: reportLifecycleResult.reportDocumentId,
      processingStatus: reportLifecycleResult.processingStatus,
      contentType: reportLifecycleResult.contentType,
    },
    comparison: {
      source,
      tolerance,
      extraReportSkus: computation.extraReportSkus,
      mismatches: computation.mismatches,
    },
    items: computation.items,
    warnings,
  };
}

function buildFailureReport({
  cliArgs,
  source,
  delayMs,
  dateRange,
  startedAt,
  stage,
  error,
  lifecycle,
  attempts,
  reportId = null,
  reportDocumentId = null,
  processingStatus = null,
  errorDetails = null,
  redactionSecrets = [],
}) {
  return {
    metric: 'ctr',
    source,
    startedAt,
    completedAt: new Date().toISOString(),
    dateRange,
    request: {
      date: cliArgs.date,
      endDate: cliArgs.endDate || cliArgs.date,
      source,
      delayMs,
    },
    stage,
    status: 'failed',
    summary: {
      status: 'failed',
      stage,
      attempts,
      lifecyclePhases: summarizeStages(lifecycle),
      reportId,
      reportDocumentId,
      processingStatus,
    },
    lifecycle,
    error: {
      message: redactErrorMessage(errorDetails?.message || error.message, redactionSecrets),
      code: errorDetails?.code || error.code || null,
      httpStatus: errorDetails?.httpStatus || error.httpStatus || null,
      timeout: Boolean(errorDetails?.timeout || error.timeout),
    },
    reportInfo: {
      reportType: 'spAdvertisedProduct',
      reportId,
      reportDocumentId,
      processingStatus,
    },
    items: [],
  };
}

function buildEmptyParsedCtrResult({ rows = [], parseWarning }) {
  return {
    rows,
    rowCount: rows.length,
    bySku: {},
    skuCount: 0,
    parseWarning,
  };
}

function parseCtrRow(row, index) {
  const rowNumber = index + 1;
  const sku = String(row?.advertisedSku || '').trim();
  if (!sku) {
    throw new Error(`CTR report row ${rowNumber} is missing advertisedSku`);
  }

  return {
    row,
    rowNumber,
    sku,
    clicks: parseRequiredNumber(row?.clicks, `clicks row ${rowNumber} sku ${sku}`),
    impressions: parseRequiredNumber(row?.impressions, `impressions row ${rowNumber} sku ${sku}`),
  };
}

function normalizeCtrRows(parsed) {
  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (parsed && typeof parsed === 'object') {
    if (Array.isArray(parsed.data)) return parsed.data;
    if (Array.isArray(parsed.rows)) return parsed.rows;
    if (Array.isArray(parsed.reportData)) return parsed.reportData;
  }

  throw new Error('CTR report JSON must be an array or contain a data array');
}

function parseRequiredNumber(value, context) {
  const normalized = String(value === undefined || value === null ? '' : value).replace(/[\s,%]/g, '');
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric value for ${context}`);
  }
  return roundMetric(parsed);
}

function computeCtrValue(clicks, impressions) {
  const safeClicks = roundMetric(clicks || 0);
  const safeImpressions = roundMetric(impressions || 0);
  if (safeImpressions <= 0) {
    return 0;
  }
  return roundCtr((safeClicks / safeImpressions) * 100);
}

function roundMetric(value) {
  const numeric = Number(value || 0);
  return Math.round((numeric + Number.EPSILON) * 10000) / 10000;
}

function roundCtr(value) {
  const numeric = Number(value || 0);
  return Math.round((numeric + Number.EPSILON) * 10000) / 10000;
}

function roundCtrDelta(value) {
  const numeric = Number(value || 0);
  return Math.round((numeric + Number.EPSILON) * 10000) / 10000;
}

function summarizeStages(lifecycle) {
  return Array.from(new Set((lifecycle || []).map((entry) => entry.stage)));
}

function redactErrorMessage(errorOrMessage, secrets = []) {
  const message = typeof errorOrMessage === 'string'
    ? errorOrMessage
    : (errorOrMessage?.message || 'Unknown CTR error');
  return redactSensitiveText(message, secrets);
}

module.exports = {
  runGetCtr,
  parseCtrReport,
  computeCtr,
  buildSuccessReport,
  buildFailureReport,
  normalizeCtrRows,
  parseCtrRow,
  parseRequiredNumber,
  computeCtrValue,
  roundMetric,
  roundCtr,
  roundCtrDelta,
  redactErrorMessage,
};
