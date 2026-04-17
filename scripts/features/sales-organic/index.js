const { loadConfig } = require('../../lib/config');
const { mintSpAccessToken } = require('../../lib/auth/sp');
const { parseDateRange } = require('../../lib/date');
const { fetchOrdersReport } = require('../../lib/sp/reports');
const { writeReport } = require('../../lib/output/write-report');
const { printSalesOrganicReport } = require('../../lib/console');

async function runGetSalesOrganic(cliArgs, deps = {}) {
  const parseDateRangeFn = deps.parseDateRange || parseDateRange;
  const loadConfigFn = deps.loadConfig || loadConfig;
  const mintTokenFn = deps.mintSpAccessToken || mintSpAccessToken;
  const fetchOrdersReportFn = deps.fetchOrdersReport || fetchOrdersReport;
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
    const report = buildFailureReport({
      cliArgs,
      source,
      delayMs,
      dateRange,
      startedAt,
      stage: 'auth',
      error,
      lifecycle: [{ stage: 'auth', attempt: 1, status: 'error', message: error.message }],
      attempts: { create: 0, poll: 0 },
    });
    const reportPath = await writeReportFn({ metric: 'sales-organic', report, dateRange });
    printReportFn(report, reportPath);
    const wrappedError = new Error(`Sales Organic failed at auth: ${error.message}`);
    wrappedError.reportPath = reportPath;
    throw wrappedError;
  }

  const reportLifecycleResult = await fetchOrdersReportFn({
    accessToken,
    marketplaceId: config.amazon.marketplaceId,
    dateRange,
    polling: config.salesOrganic.polling,
  });

  const report = reportLifecycleResult.ok
    ? buildSuccessReport({
      cliArgs,
      source,
      delayMs,
      dateRange,
      startedAt,
      reportLifecycleResult,
    })
    : buildFailureReport({
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
    });

  const reportPath = await writeReportFn({ metric: 'sales-organic', report, dateRange });
  printReportFn(report, reportPath);

  if (!reportLifecycleResult.ok) {
    const wrappedError = new Error(`Sales Organic failed at ${report.stage}: ${report.error.message}`);
    wrappedError.reportPath = reportPath;
    throw wrappedError;
  }

  return {
    report,
    reportPath,
    reportText: reportLifecycleResult.reportText,
  };
}

function buildSuccessReport({ cliArgs, source, delayMs, dateRange, startedAt, reportLifecycleResult }) {
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
    stage: reportLifecycleResult.stage,
    status: 'success',
    summary: {
      status: 'success',
      stage: reportLifecycleResult.stage,
      attempts: reportLifecycleResult.attempts,
      lifecyclePhases: summarizeStages(reportLifecycleResult.lifecycle),
      reportId: reportLifecycleResult.reportId,
      reportDocumentId: reportLifecycleResult.reportDocumentId,
      downloadedBytes: Buffer.byteLength(reportLifecycleResult.reportText || '', 'utf8'),
    },
    lifecycle: reportLifecycleResult.lifecycle,
    reportInfo: {
      reportType: 'GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL',
      reportId: reportLifecycleResult.reportId,
      reportDocumentId: reportLifecycleResult.reportDocumentId,
      processingStatus: reportLifecycleResult.processingStatus,
      contentType: reportLifecycleResult.contentType,
    },
    items: [],
    warnings: ['Sales Organic lifecycle completed; SKU parsing and computation are added in later tasks.'],
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
  buildSuccessReport,
  buildFailureReport,
};
