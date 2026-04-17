const { loadConfig } = require('../../lib/config');
const { mintSpAccessToken } = require('../../lib/auth/sp');
const { parseDateRange } = require('../../lib/date');
const { fetchOrdersReport } = require('../../lib/sp/reports');
const { parseOrdersReport, roundCurrency } = require('../../lib/extract/orders-report');
const { loadAdSalesFromFile } = require('../../lib/sources/ad-sales-file');
const { loadSalesOrganicFromGoogleSheet } = require('../../lib/sources/google-sheet');
const { writeReport } = require('../../lib/output/write-report');
const { printSalesOrganicReport } = require('../../lib/console');

async function runGetSalesOrganic(cliArgs, deps = {}) {
  const parseDateRangeFn = deps.parseDateRange || parseDateRange;
  const loadConfigFn = deps.loadConfig || loadConfig;
  const mintTokenFn = deps.mintSpAccessToken || mintSpAccessToken;
  const fetchOrdersReportFn = deps.fetchOrdersReport || fetchOrdersReport;
  const parseOrdersReportFn = deps.parseOrdersReport || parseOrdersReport;
  const loadAdSalesFromFileFn = deps.loadAdSalesFromFile || loadAdSalesFromFile;
  const loadSalesOrganicFromGoogleSheetFn = deps.loadSalesOrganicFromGoogleSheet || loadSalesOrganicFromGoogleSheet;
  const writeReportFn = deps.writeReport || writeReport;
  const printReportFn = deps.printSalesOrganicReport || printSalesOrganicReport;
  const source = cliArgs.source || 'file';
  const delayMs = Number.isFinite(cliArgs.delayMs) ? cliArgs.delayMs : 250;
  const dateRange = parseDateRangeFn(cliArgs.date, cliArgs.endDate);
  const config = loadConfigFn({ source });
  const startedAt = new Date().toISOString();

  let accessToken;
  try {
    accessToken = await mintTokenFn(config.amazon, {
      timeout: config.salesOrganic.polling.createTimeoutMs,
    });
  } catch (error) {
    return handleFailure({
      cliArgs,
      source,
      delayMs,
      dateRange,
      startedAt,
      stage: 'auth',
      error,
      lifecycle: [{ stage: 'auth', attempt: 1, status: 'error', message: error.message }],
      attempts: { create: 0, poll: 0 },
      writeReportFn,
      printReportFn,
    });
  }

  const reportLifecycleResult = await fetchOrdersReportFn({
    accessToken,
    marketplaceId: config.amazon.marketplaceId,
    dateRange,
    polling: config.salesOrganic.polling,
  });

  if (!reportLifecycleResult.ok) {
    return handleFailure({
      cliArgs,
      source,
      delayMs,
      dateRange,
      startedAt,
      stage: reportLifecycleResult.stage,
      error: new Error(reportLifecycleResult.error.message),
      lifecycle: reportLifecycleResult.lifecycle,
      attempts: reportLifecycleResult.attempts,
      reportId: reportLifecycleResult.reportId,
      reportDocumentId: reportLifecycleResult.reportDocumentId,
      processingStatus: reportLifecycleResult.processingStatus,
      errorDetails: reportLifecycleResult.error,
      writeReportFn,
      printReportFn,
    });
  }

  let parsedReport;
  try {
    parsedReport = parseOrdersReportFn(reportLifecycleResult.reportText);
  } catch (error) {
    return handleFailure({
      cliArgs,
      source,
      delayMs,
      dateRange,
      startedAt,
      stage: 'parse',
      error,
      lifecycle: [...reportLifecycleResult.lifecycle, { stage: 'parse', attempt: 1, status: 'error', message: error.message }],
      attempts: reportLifecycleResult.attempts,
      reportId: reportLifecycleResult.reportId,
      reportDocumentId: reportLifecycleResult.reportDocumentId,
      processingStatus: reportLifecycleResult.processingStatus,
      writeReportFn,
      printReportFn,
    });
  }

  let adSalesInput;
  try {
    adSalesInput = source === 'sheet'
      ? await loadSalesOrganicFromGoogleSheetFn(config)
      : await loadAdSalesFromFileFn(config.salesOrganic.fileInput, dateRange.startDate);
  } catch (error) {
    return handleFailure({
      cliArgs,
      source,
      delayMs,
      dateRange,
      startedAt,
      stage: 'compute',
      error,
      lifecycle: [...reportLifecycleResult.lifecycle, { stage: 'compute', attempt: 1, status: 'error', message: error.message }],
      attempts: reportLifecycleResult.attempts,
      reportId: reportLifecycleResult.reportId,
      reportDocumentId: reportLifecycleResult.reportDocumentId,
      processingStatus: reportLifecycleResult.processingStatus,
      writeReportFn,
      printReportFn,
    });
  }

  const computation = computeSalesOrganic({
    parsedReport,
    adSalesInput,
    tolerance: config.salesOrganic.comparisonTolerance,
  });

  const report = buildSuccessReport({
    cliArgs,
    source,
    delayMs,
    dateRange,
    startedAt,
    reportLifecycleResult,
    parsedReport,
    adSalesInput,
    computation,
    tolerance: config.salesOrganic.comparisonTolerance,
  });

  const reportPath = await writeReportFn({ metric: 'sales-organic', report, dateRange });
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
  });
  const reportPath = await writeReportFn({ metric: 'sales-organic', report, dateRange });
  printReportFn(report, reportPath);
  const wrappedError = new Error(`Sales Organic failed at ${stage}: ${report.error.message}`);
  wrappedError.reportPath = reportPath;
  throw wrappedError;
}

function computeSalesOrganic({ parsedReport, adSalesInput, tolerance }) {
  const reportBySku = parsedReport.bySku || {};
  const adSalesBySku = adSalesInput.bySku || {};
  const expectedSkus = Object.keys(adSalesBySku);
  const extraReportSkus = Object.keys(reportBySku).filter((sku) => !adSalesBySku[sku]);
  const allSkus = (adSalesInput.source === 'file' && expectedSkus.length > 0)
    ? expectedSkus.slice().sort()
    : Array.from(new Set([...Object.keys(reportBySku), ...expectedSkus])).sort();
  const items = [];
  const mismatches = [];

  for (const sku of allSkus) {
    const reportEntry = reportBySku[sku] || { sku, totalSales: 0, totalUnits: 0 };
    const adSalesEntry = adSalesBySku[sku] || { sku, adSales: 0, expectedSalesOrganic: null, expectedSalesPpc: null, source: adSalesInput.source };
    const totalSales = roundCurrency(reportEntry.totalSales || 0);
    const totalUnits = roundCurrency(reportEntry.totalUnits || 0);
    const adSales = roundCurrency(adSalesEntry.adSales || 0);
    const salesOrganic = roundCurrency(Math.max(0, totalSales - adSales));
    const expectedSalesOrganic = adSalesEntry.expectedSalesOrganic;
    const organicDelta = expectedSalesOrganic === null || expectedSalesOrganic === undefined
      ? null
      : roundCurrency(salesOrganic - expectedSalesOrganic);
    const comparisonStatus = organicDelta === null
      ? 'no-expected'
      : Math.abs(organicDelta) <= tolerance
        ? 'match'
        : 'mismatch';

    const item = {
      sku,
      totalSales,
      totalUnits,
      adSales,
      salesOrganic,
      expectedSalesOrganic,
      expectedSalesPpc: adSalesEntry.expectedSalesPpc,
      organicDelta,
      comparisonStatus,
      source: adSalesEntry.source || adSalesInput.source,
      reportPresent: Boolean(reportBySku[sku]),
      adSalesPresent: Boolean(adSalesBySku[sku]),
    };

    if (comparisonStatus === 'mismatch') {
      mismatches.push({
        sku,
        totalSales,
        adSales,
        salesOrganic,
        expectedSalesOrganic,
        organicDelta,
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

function buildSuccessReport({ cliArgs, source, delayMs, dateRange, startedAt, reportLifecycleResult, parsedReport, adSalesInput, computation, tolerance }) {
  const warnings = [];
  if (parsedReport.parseWarning) warnings.push(parsedReport.parseWarning);
  if (computation.summary.extraReportSkuCount > 0) warnings.push(`${computation.summary.extraReportSkuCount} report SKUs were outside the comparison target set.`);
  if (computation.summary.mismatched > 0) warnings.push(`${computation.summary.mismatched} SKU rows differ from the expected Sales Organic fixture.`);

  return {
    metric: 'sales-organic',
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
      lifecyclePhases: summarizeStages(reportLifecycleResult.lifecycle.concat([{ stage: 'parse' }, { stage: 'compute' }])),
      reportId: reportLifecycleResult.reportId,
      reportDocumentId: reportLifecycleResult.reportDocumentId,
      downloadedBytes: Buffer.byteLength(reportLifecycleResult.reportText || '', 'utf8'),
      parsedSkuCount: parsedReport.skuCount,
      adSalesSkuCount: adSalesInput.skuCount,
      computedSkuCount: computation.summary.skuCount,
      matchedSkuCount: computation.summary.matched,
      mismatchedSkuCount: computation.summary.mismatched,
      missingExpectedSkuCount: computation.summary.missingExpected,
    },
    lifecycle: reportLifecycleResult.lifecycle.concat([
      { stage: 'parse', attempt: 1, status: parsedReport.parseWarning ? 'warning' : 'success', message: parsedReport.parseWarning || '' },
      { stage: 'compute', attempt: 1, status: 'success', message: `Computed ${computation.summary.skuCount} SKU rows` },
    ]),
    reportInfo: {
      reportType: 'GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL',
      reportId: reportLifecycleResult.reportId,
      reportDocumentId: reportLifecycleResult.reportDocumentId,
      processingStatus: reportLifecycleResult.processingStatus,
      contentType: reportLifecycleResult.contentType,
    },
    comparison: {
      source: adSalesInput.source,
      tolerance,
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
}) {
  return {
    metric: 'sales-organic',
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
      message: errorDetails?.message || error.message,
      code: errorDetails?.code || null,
      httpStatus: errorDetails?.httpStatus || null,
      timeout: Boolean(errorDetails?.timeout),
    },
    reportInfo: {
      reportType: 'GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL',
      reportId,
      reportDocumentId,
      processingStatus,
    },
    items: [],
  };
}

function summarizeStages(lifecycle) {
  return Array.from(new Set((lifecycle || []).map((entry) => entry.stage)));
}

module.exports = {
  runGetSalesOrganic,
  computeSalesOrganic,
  buildSuccessReport,
  buildFailureReport,
};
