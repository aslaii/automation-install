const { loadConfig } = require('../../lib/config');
const { parseDateRange } = require('../../lib/date');
const { mintAmazonAdsAccessToken } = require('../../lib/auth/amazon-ads');
const { runAmazonAdsReportLifecycle } = require('../../lib/ads/reports');
const { loadSalesPpcFromFile } = require('../../lib/sources/sales-ppc-file');
const { writeReport } = require('../../lib/output/write-report');
const { printSalesPpcReport } = require('../../lib/console');

const ATTRIBUTED_SALES_FIELDS = ['attributedSales7d', 'attributedSalesSameSku7d'];
const SALES_PPC_RAW_FIELDS = ['sales7d', ...ATTRIBUTED_SALES_FIELDS];

function createEmptyFieldUsage() {
  return {
    sales7d: 0,
    attributedSales7d: 0,
    attributedSalesSameSku7d: 0,
  };
}

function createBaseProvenance(preferredSalesFieldInfo = {}) {
  return {
    preferredSalesField: preferredSalesFieldInfo.logical || null,
    rawPreferredSalesField: preferredSalesFieldInfo.raw || null,
    chosenField: preferredSalesFieldInfo.logical || null,
    rawChosenField: preferredSalesFieldInfo.raw || null,
    rowCount: 0,
    fallbackRows: 0,
    ...createEmptyFieldUsage(),
  };
}

async function runGetSalesPpc(cliArgs, deps = {}) {
  const loadConfigFn = deps.loadConfig || loadConfig;
  const parseDateRangeFn = deps.parseDateRange || parseDateRange;
  const mintAmazonAdsAccessTokenFn = deps.mintAmazonAdsAccessToken || mintAmazonAdsAccessToken;
  const runAmazonAdsReportLifecycleFn = deps.runAmazonAdsReportLifecycle || runAmazonAdsReportLifecycle;
  const loadSalesPpcFromFileFn = deps.loadSalesPpcFromFile || loadSalesPpcFromFile;
  const writeReportFn = deps.writeReport || writeReport;
  const printReportFn = deps.printSalesPpcReport || printSalesPpcReport;
  const source = cliArgs.source || 'file';
  const delayMs = Number.isFinite(cliArgs.delayMs) ? cliArgs.delayMs : 250;
  const dateRange = parseDateRangeFn(cliArgs.date, cliArgs.endDate);
  const config = loadConfigFn({ source, metric: 'sales-ppc' });
  const startedAt = new Date().toISOString();
  const boundaryContext = {
    cliArgs,
    source,
    delayMs,
    dateRange,
    startedAt,
  };

  let accessToken;
  const authLifecycle = [];
  try {
    accessToken = await mintAmazonAdsAccessTokenFn(config.amazonAds, {
      timeout: config.amazonAds.authTimeoutMs,
    });
    authLifecycle.push({ stage: 'auth', attempt: 1, status: 'success' });
  } catch (error) {
    authLifecycle.push({
      stage: 'auth',
      attempt: 1,
      status: error.timeout ? 'timeout' : 'error',
      httpStatus: error.httpStatus || null,
      message: error.message,
    });
    return handleFailure({
      ...boundaryContext,
      stage: 'auth',
      error,
      lifecycle: authLifecycle,
      attempts: { create: 0, poll: 0 },
      writeReportFn,
      printReportFn,
    });
  }

  const reportLifecycleResult = await runAmazonAdsReportLifecycleFn({
    accessToken,
    clientId: config.amazonAds.clientId,
    profileId: config.amazonAds.profileId,
    dateRange,
    reportConfig: config.salesPpc.report,
    polling: config.salesPpc.polling,
  });

  if (!reportLifecycleResult.ok) {
    return handleFailure({
      ...boundaryContext,
      stage: reportLifecycleResult.stage,
      error: new Error(reportLifecycleResult.error.message),
      lifecycle: authLifecycle.concat(reportLifecycleResult.lifecycle),
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
    parsedReport = parseSalesPpcReport(reportLifecycleResult.reportText);
  } catch (error) {
    return handleFailure({
      ...boundaryContext,
      stage: 'parse',
      error,
      lifecycle: authLifecycle.concat(reportLifecycleResult.lifecycle, [{ stage: 'parse', attempt: 1, status: 'error', message: error.message }]),
      attempts: reportLifecycleResult.attempts,
      reportId: reportLifecycleResult.reportId,
      reportDocumentId: reportLifecycleResult.reportDocumentId,
      processingStatus: reportLifecycleResult.processingStatus,
      writeReportFn,
      printReportFn,
    });
  }

  let expectedInput;
  try {
    if (source !== 'file') {
      throw new Error(`Sales PPC source=${source} is not implemented yet; use --source file`);
    }
    expectedInput = await loadSalesPpcFromFileFn(config.salesPpc.fileInput, dateRange.startDate);
  } catch (error) {
    return handleFailure({
      ...boundaryContext,
      stage: 'compute',
      error,
      lifecycle: authLifecycle.concat(reportLifecycleResult.lifecycle, [{ stage: 'parse', attempt: 1, status: parsedReport.parseWarning ? 'warning' : 'success', message: parsedReport.parseWarning || '' }, { stage: 'compute', attempt: 1, status: 'error', message: error.message }]),
      attempts: reportLifecycleResult.attempts,
      reportId: reportLifecycleResult.reportId,
      reportDocumentId: reportLifecycleResult.reportDocumentId,
      processingStatus: reportLifecycleResult.processingStatus,
      writeReportFn,
      printReportFn,
    });
  }

  const computation = computeSalesPpc({
    parsedReport,
    expectedInput,
    source,
    tolerance: config.salesPpc.comparisonTolerance || 0.01,
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
    tolerance: config.salesPpc.comparisonTolerance || 0.01,
    lifecycle: authLifecycle,
  });

  const reportPath = await writeReportFn({ metric: 'sales-ppc', report, dateRange });
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

  const reportPath = await writeReportFn({ metric: 'sales-ppc', report, dateRange });
  printReportFn(report, reportPath);
  const wrappedError = new Error(`Sales PPC failed at ${stage}: ${report.error.message}`);
  wrappedError.reportPath = reportPath;
  throw wrappedError;
}

function parseSalesPpcReport(reportText) {
  const normalizedText = String(reportText || '').trim();
  if (!normalizedText) {
    return buildEmptyParsedSalesPpcResult({ rows: [], parseWarning: 'Sales PPC report text empty' });
  }

  let parsed;
  try {
    parsed = JSON.parse(normalizedText);
  } catch (error) {
    throw new Error(`Sales PPC report JSON parse failed: ${error.message}`);
  }

  const rows = normalizeSalesRows(parsed);
  if (rows.length === 0) {
    return buildEmptyParsedSalesPpcResult({ rows, parseWarning: 'Sales PPC report has no data rows' });
  }

  const normalizedRows = rows.map((row, index) => parseSalesPpcRow(row, index));
  const preferredSalesFieldInfo = resolvePreferredSalesField(normalizedRows);
  if (!preferredSalesFieldInfo) {
    throw new Error('Sales PPC report rows did not include sales7d, attributedSales7d, or attributedSalesSameSku7d');
  }

  const bySku = {};
  const fieldUsage = createEmptyFieldUsage();

  normalizedRows.forEach((normalizedRow) => {
    const entry = bySku[normalizedRow.sku] || {
      sku: normalizedRow.sku,
      reportSalesPpc: 0,
      provenance: createBaseProvenance(preferredSalesFieldInfo),
    };

    entry.reportSalesPpc = roundCurrency(entry.reportSalesPpc + normalizedRow.sales);
    entry.provenance.rowCount += 1;
    entry.provenance[normalizedRow.chosenField.raw] += 1;
    fieldUsage[normalizedRow.chosenField.raw] += 1;
    if (normalizedRow.chosenField.logical !== preferredSalesFieldInfo.logical) {
      entry.provenance.fallbackRows += 1;
    }
    entry.provenance.chosenField = resolveLogicalChosenField(entry.provenance);
    entry.provenance.rawChosenField = resolveRawChosenField(entry.provenance);
    bySku[normalizedRow.sku] = entry;
  });

  return {
    rows,
    rowCount: rows.length,
    bySku,
    skuCount: Object.keys(bySku).length,
    preferredSalesField: preferredSalesFieldInfo.logical,
    rawPreferredSalesField: preferredSalesFieldInfo.raw,
    fieldUsage,
    parseWarning: null,
  };
}

function computeSalesPpc({ parsedReport, expectedInput, source, tolerance }) {
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
      reportSalesPpc: 0,
      provenance: createBaseProvenance({
        logical: parsedReport.preferredSalesField,
        raw: parsedReport.rawPreferredSalesField,
      }),
    };
    const expectedEntry = expectedBySku[sku] || {
      sku,
      expectedSalesPpc: null,
      source,
      notes: '',
      productLabel: '',
    };
    const reportSalesPpc = roundCurrency(reportEntry.reportSalesPpc || 0);
    const expectedSalesPpc = expectedEntry.expectedSalesPpc;
    const salesDelta = expectedSalesPpc === null || expectedSalesPpc === undefined
      ? null
      : roundCurrency(reportSalesPpc - expectedSalesPpc);
    const comparisonStatus = salesDelta === null
      ? 'no-expected'
      : Math.abs(salesDelta) <= tolerance
        ? 'match'
        : 'mismatch';

    const item = {
      sku,
      reportSalesPpc,
      expectedSalesPpc,
      salesDelta,
      comparisonStatus,
      source: expectedEntry.source || source,
      reportPresent: Boolean(reportBySku[sku]),
      fixturePresent: Boolean(expectedBySku[sku]),
      notes: expectedEntry.notes || '',
      productLabel: expectedEntry.productLabel || '',
      provenance: {
        preferredSalesField: reportEntry.provenance?.preferredSalesField || parsedReport.preferredSalesField,
        rawPreferredSalesField: reportEntry.provenance?.rawPreferredSalesField || parsedReport.rawPreferredSalesField,
        chosenField: reportEntry.provenance?.chosenField || parsedReport.preferredSalesField,
        rawChosenField: reportEntry.provenance?.rawChosenField || parsedReport.rawPreferredSalesField,
        rowCount: reportEntry.provenance?.rowCount || 0,
        fallbackRows: reportEntry.provenance?.fallbackRows || 0,
        sales7d: reportEntry.provenance?.sales7d || 0,
        attributedSales7d: reportEntry.provenance?.attributedSales7d || 0,
        attributedSalesSameSku7d: reportEntry.provenance?.attributedSalesSameSku7d || 0,
      },
    };

    if (comparisonStatus === 'mismatch') {
      mismatches.push({
        sku,
        reportSalesPpc,
        expectedSalesPpc,
        salesDelta,
        chosenField: item.provenance.chosenField,
        rawChosenField: item.provenance.rawChosenField,
        fallbackRows: item.provenance.fallbackRows,
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
  if (computation.summary.mismatched > 0) warnings.push(`${computation.summary.mismatched} SKU rows differ from the expected Sales PPC fixture.`);

  const reportLifecycle = lifecycle.concat(reportLifecycleResult.lifecycle, [
    { stage: 'parse', attempt: 1, status: parsedReport.parseWarning ? 'warning' : 'success', message: parsedReport.parseWarning || '' },
    { stage: 'compute', attempt: 1, status: 'success', message: `Computed ${computation.summary.skuCount} SKU rows` },
  ]);

  return {
    metric: 'sales-ppc',
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
      preferredSalesField: parsedReport.preferredSalesField,
      rawPreferredSalesField: parsedReport.rawPreferredSalesField,
      fieldUsage: parsedReport.fieldUsage,
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
      preferredSalesField: parsedReport.preferredSalesField,
      rawPreferredSalesField: parsedReport.rawPreferredSalesField,
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
}) {
  return {
    metric: 'sales-ppc',
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
      reportType: 'spAdvertisedProduct',
      reportId,
      reportDocumentId,
      processingStatus,
    },
    items: [],
  };
}

function buildEmptyParsedSalesPpcResult({ rows = [], parseWarning }) {
  return {
    rows,
    rowCount: rows.length,
    bySku: {},
    skuCount: 0,
    preferredSalesField: null,
    rawPreferredSalesField: null,
    fieldUsage: createEmptyFieldUsage(),
    parseWarning,
  };
}

function parseSalesPpcRow(row, index) {
  const rowNumber = index + 1;
  const sku = String(row?.advertisedSku || '').trim();
  if (!sku) {
    throw new Error(`Sales PPC report row ${rowNumber} is missing advertisedSku`);
  }

  const chosenField = resolveChosenSalesField(row);
  if (!chosenField) {
    throw new Error(`Sales PPC report row ${rowNumber} sku ${sku} is missing sales7d, attributedSales7d, and attributedSalesSameSku7d`);
  }

  return {
    row,
    rowNumber,
    sku,
    chosenField,
    sales: parseRequiredNumber(row[chosenField.raw], `${chosenField.raw} row ${rowNumber} sku ${sku}`),
  };
}

function normalizeSalesRows(parsed) {
  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (parsed && typeof parsed === 'object') {
    if (Array.isArray(parsed.data)) return parsed.data;
    if (Array.isArray(parsed.rows)) return parsed.rows;
    if (Array.isArray(parsed.reportData)) return parsed.reportData;
  }

  throw new Error('Sales PPC report JSON must be an array or contain a data array');
}

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function hasRowFieldValue(row, rawField) {
  return hasValue(row?.[rawField]) || hasValue(row?.row?.[rawField]);
}

function resolvePreferredSalesField(rows) {
  for (const rawField of SALES_PPC_RAW_FIELDS) {
    if (rows.some((row) => hasRowFieldValue(row, rawField))) {
      return buildSalesFieldInfo(rawField);
    }
  }

  return null;
}

function resolveChosenSalesField(row) {
  for (const rawField of SALES_PPC_RAW_FIELDS) {
    if (hasValue(row[rawField])) {
      return buildSalesFieldInfo(rawField);
    }
  }

  return null;
}

function buildSalesFieldInfo(rawField) {
  return {
    logical: rawField === 'sales7d' ? 'sales7d' : 'attributedSales7d',
    raw: rawField,
  };
}

function resolveLogicalChosenField(provenance) {
  const attributedCount = (provenance.attributedSales7d || 0) + (provenance.attributedSalesSameSku7d || 0);
  if ((provenance.sales7d || 0) > 0 && attributedCount > 0) {
    return 'mixed';
  }
  if ((provenance.sales7d || 0) > 0) return 'sales7d';
  if (attributedCount > 0) return 'attributedSales7d';
  return provenance.preferredSalesField || null;
}

function resolveRawChosenField(provenance) {
  const rawFields = SALES_PPC_RAW_FIELDS
    .filter((field) => (provenance[field] || 0) > 0);

  if (rawFields.length > 1) {
    return 'mixed';
  }

  return rawFields[0] || provenance.rawPreferredSalesField || null;
}

function parseRequiredNumber(value, context) {
  const parsed = Number(String(value).replace(/[\s,$]/g, ''));
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric value for ${context}`);
  }
  return roundCurrency(parsed);
}

function roundCurrency(value) {
  const numeric = Number(value || 0);
  return Math.round((numeric + Number.EPSILON) * 100) / 100;
}

function summarizeStages(lifecycle) {
  return Array.from(new Set((lifecycle || []).map((entry) => entry.stage)));
}

module.exports = {
  runGetSalesPpc,
  parseSalesPpcReport,
  computeSalesPpc,
  buildSuccessReport,
  buildFailureReport,
  normalizeSalesRows,
  resolvePreferredSalesField,
  resolveChosenSalesField,
  buildSalesFieldInfo,
  roundCurrency,
};
