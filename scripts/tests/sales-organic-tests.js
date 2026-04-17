const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parseCliArgs } = require('../lib/cli');
const { loadConfig, extractSpreadsheetId } = require('../lib/config');
const { fetchOrdersReport, REPORT_TYPE } = require('../lib/sp/reports');
const { parseOrdersReport } = require('../lib/extract/orders-report');
const { loadAdSalesFromFile } = require('../lib/sources/ad-sales-file');
const { loadSalesOrganicFromGoogleSheet } = require('../lib/sources/google-sheet');
const { runWithArgs } = require('../index');
const { runGetSalesOrganic, computeSalesOrganic } = require('../features/sales-organic');

const tests = [
  {
    name: 'cli dispatch routes sales-organic to the sales organic runner',
    fn: testCliDispatchSalesOrganic,
  },
  {
    name: 'cli dispatch preserves the bsr runner path',
    fn: testCliDispatchBsr,
  },
  {
    name: 'cli dispatch rejects unknown flags and missing dates',
    fn: testCliValidation,
  },
  {
    name: 'report lifecycle completes create poll document download flow',
    fn: testReportLifecycleSuccess,
  },
  {
    name: 'report lifecycle uses bounded polling defaults from config',
    fn: testReportLifecycleConfigDefaults,
  },
  {
    name: 'report lifecycle fails malformed create response without reportId',
    fn: testReportLifecycleMalformedCreate,
  },
  {
    name: 'report lifecycle fails on create-report http errors',
    fn: testReportLifecycleCreateError,
  },
  {
    name: 'report lifecycle times out after bounded poll attempts',
    fn: testReportLifecycleTimeout,
  },
  {
    name: 'report lifecycle stops on terminal poll status',
    fn: testReportLifecycleTerminalStatus,
  },
  {
    name: 'report lifecycle fails when document download cannot be fetched',
    fn: testReportLifecycleDownloadFailure,
  },
  {
    name: 'report lifecycle rejects non-text downloads before parse',
    fn: testReportLifecycleRejectsNonText,
  },
  {
    name: 'runner auth failure records auth stage failure artifact',
    fn: testRunnerAuthFailure,
  },
  {
    name: 'parser handles escaped newline payloads',
    fn: testParserEscapedNewlines,
  },
  {
    name: 'parser handles normal newline payloads',
    fn: testParserNormalNewlines,
  },
  {
    name: 'parser excludes cancelled and unsupported order statuses',
    fn: testParserSkipsCancelledAndUnsupportedStatuses,
  },
  {
    name: 'parser rejects missing report headers',
    fn: testParserMissingHeaders,
  },
  {
    name: 'parser rejects malformed numeric currency fields',
    fn: testParserRejectsMalformedNumeric,
  },
  {
    name: 'parser aggregates duplicate sku rows',
    fn: testParserAggregatesDuplicateSkuRows,
  },
  {
    name: 'file source loads april 15 input fixture',
    fn: testFileSourceLoadsFixture,
  },
  {
    name: 'file source rejects malformed numeric values with file row context',
    fn: testFileSourceRejectsMalformedNumeric,
  },
  {
    name: 'sheet source rejects missing required columns',
    fn: testSheetSourceRejectsMissingColumns,
  },
  {
    name: 'sheet source surfaces timeout context',
    fn: testSheetSourceTimeoutContext,
  },
  {
    name: 'compute merges report totals with ad sales and flags mismatches',
    fn: testComputeMismatchDetection,
  },
  {
    name: 'compute clamps negative sales organic to zero',
    fn: testComputeClampsNegativeOrganic,
  },
  {
    name: 'compute returns empty summary for empty sku set',
    fn: testComputeHandlesEmptySkuSet,
  },
  {
    name: 'compute keeps report-only and ad-sales-only skus inspectable in sheet mode',
    fn: testComputeSheetModeIncludesJoinBoundarySkus,
  },
  {
    name: 'compute runner builds sales organic artifact rows from file source',
    fn: testRunnerComputeFromFileSource,
  },
];

async function testCliDispatchSalesOrganic() {
  const calls = [];
  await runWithArgs(['--sales-organic', '--date', '2026-04-07'], {
    runGetSalesOrganic: async (args) => {
      calls.push({ metric: 'sales-organic', args });
      return { ok: true };
    },
    runGetBsr: async () => {
      throw new Error('BSR runner should not be called');
    },
  });

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].args.metric, 'sales-organic');
  assert.strictEqual(calls[0].args.date, '2026-04-07');
  assert.strictEqual(calls[0].args.source, 'file');
}

async function testCliDispatchBsr() {
  const calls = [];
  await runWithArgs(['--bsr', '--date', '2026-04-07'], {
    runGetBsr: async (args) => {
      calls.push({ metric: 'bsr', args });
      return { ok: true };
    },
    runGetSalesOrganic: async () => {
      throw new Error('Sales Organic runner should not be called');
    },
  });

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].args.metric, 'bsr');
  assert.strictEqual(calls[0].args.date, '2026-04-07');
}

async function testCliValidation() {
  assert.throws(() => parseCliArgs(['--wat']), /Unknown argument/);
  assert.throws(() => parseCliArgs(['--bsr', '--sales-organic']), /Multiple metrics selected/);
  assert.throws(() => parseCliArgs(['--sales-organic', '--date']), /Missing value for --date/);
  await assert.rejects(() => runWithArgs(['--sales-organic']), /Missing required --date/);
  await assert.rejects(() => runWithArgs(['--sales-organic', '--date', '20260407']), /Invalid --date value/);
}

async function testReportLifecycleSuccess() {
  const requests = [];
  const axiosInstance = buildAxiosStub([
    {
      method: 'post',
      match: '/reports',
      response: { status: 202, data: { reportId: 'report-123' } },
    },
    {
      method: 'get',
      match: '/reports/report-123',
      response: { status: 200, data: { processingStatus: 'IN_QUEUE' } },
    },
    {
      method: 'get',
      match: '/reports/report-123',
      response: { status: 200, data: { processingStatus: 'DONE', reportDocumentId: 'doc-123' } },
    },
    {
      method: 'get',
      match: '/documents/doc-123',
      response: { status: 200, data: { url: 'https://download.example/report-123.txt' } },
    },
    {
      method: 'get',
      match: 'https://download.example/report-123.txt',
      response: {
        status: 200,
        data: Buffer.from('sku\titem-price\tquantity\nABC\t12.34\t1\n', 'utf8'),
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      },
    },
  ], requests);
  const sleepCalls = [];

  const result = await fetchOrdersReport({
    accessToken: 'token',
    marketplaceId: 'marketplace',
    dateRange: { startDate: '2026-04-07', endDate: '2026-04-07' },
    axiosInstance,
    sleep: async (ms) => sleepCalls.push(ms),
    polling: { maxAttempts: 4, pollIntervalMs: 5 },
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.stage, 'download-report');
  assert.strictEqual(result.reportId, 'report-123');
  assert.strictEqual(result.reportDocumentId, 'doc-123');
  assert.strictEqual(result.processingStatus, 'DONE');
  assert.strictEqual(result.attempts.create, 1);
  assert.strictEqual(result.attempts.poll, 2);
  assert.strictEqual(result.reportText.includes('ABC'), true);
  assert.deepStrictEqual(sleepCalls, [5]);
  assert.strictEqual(requests[0].body.reportType, REPORT_TYPE);
  assert.strictEqual(requests[0].body.marketplaceIds[0], 'marketplace');
  assert.strictEqual(requests[0].body.dataStartTime, '2026-04-07T00:00:00Z');
  assert.strictEqual(requests[0].body.dataEndTime, '2026-04-07T23:59:59Z');
}

function testReportLifecycleConfigDefaults() {
  const env = {
    AMAZON_SP_CLIENT_ID: 'id',
    AMAZON_SP_CLIENT_SECRET: 'secret',
    AMAZON_SP_REFRESH_TOKEN: 'refresh',
    AMAZON_MARKETPLACE_ID: 'market',
  };

  const config = loadConfig({ source: 'file', env });
  assert.strictEqual(config.salesOrganic.polling.maxAttempts, 10);
  assert.strictEqual(config.salesOrganic.polling.pollIntervalMs, 60000);
  assert.strictEqual(config.salesOrganic.polling.createTimeoutMs, 30000);
  assert.strictEqual(config.salesOrganic.polling.downloadTimeoutMs, 30000);
  assert.strictEqual(config.salesOrganic.fileInput.endsWith('sales-organic-input.json'), true);
  assert.strictEqual(extractSpreadsheetId('https://docs.google.com/spreadsheets/d/1abcDEFghiJKL/edit#gid=123'), '1abcDEFghiJKL');
}

async function testReportLifecycleMalformedCreate() {
  const axiosInstance = buildAxiosStub([{ method: 'post', match: '/reports', response: { status: 202, data: {} } }]);
  const result = await fetchOrdersReport({
    accessToken: 'token',
    marketplaceId: 'marketplace',
    dateRange: { startDate: '2026-04-07', endDate: '2026-04-07' },
    axiosInstance,
    sleep: async () => {},
    polling: { maxAttempts: 1, pollIntervalMs: 1 },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.stage, 'create-report');
  assert.strictEqual(result.error.code, 'MALFORMED_CREATE_RESPONSE');
}

async function testReportLifecycleCreateError() {
  const axiosInstance = buildAxiosStub([{ method: 'post', match: '/reports', error: buildHttpError('create failed', 500) }]);
  const result = await fetchOrdersReport({
    accessToken: 'token',
    marketplaceId: 'marketplace',
    dateRange: { startDate: '2026-04-07', endDate: '2026-04-07' },
    axiosInstance,
    sleep: async () => {},
    polling: { maxAttempts: 1, pollIntervalMs: 1 },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.stage, 'create-report');
  assert.strictEqual(result.error.httpStatus, 500);
}

async function testReportLifecycleTimeout() {
  const axiosInstance = buildAxiosStub([
    { method: 'post', match: '/reports', response: { status: 202, data: { reportId: 'report-123' } } },
    { method: 'get', match: '/reports/report-123', response: { status: 200, data: { processingStatus: 'IN_QUEUE' } } },
    { method: 'get', match: '/reports/report-123', response: { status: 200, data: { processingStatus: 'IN_PROGRESS' } } },
  ]);
  const sleepCalls = [];
  const result = await fetchOrdersReport({
    accessToken: 'token',
    marketplaceId: 'marketplace',
    dateRange: { startDate: '2026-04-07', endDate: '2026-04-07' },
    axiosInstance,
    sleep: async (ms) => sleepCalls.push(ms),
    polling: { maxAttempts: 2, pollIntervalMs: 11 },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.stage, 'poll-report');
  assert.strictEqual(result.error.code, 'POLL_TIMEOUT');
  assert.deepStrictEqual(sleepCalls, [11]);
}

async function testReportLifecycleTerminalStatus() {
  const axiosInstance = buildAxiosStub([
    { method: 'post', match: '/reports', response: { status: 202, data: { reportId: 'report-123' } } },
    { method: 'get', match: '/reports/report-123', response: { status: 200, data: { processingStatus: 'FATAL' } } },
  ]);
  const result = await fetchOrdersReport({
    accessToken: 'token',
    marketplaceId: 'marketplace',
    dateRange: { startDate: '2026-04-07', endDate: '2026-04-07' },
    axiosInstance,
    sleep: async () => {},
    polling: { maxAttempts: 2, pollIntervalMs: 1 },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.processingStatus, 'FATAL');
  assert.strictEqual(result.error.code, 'REPORT_TERMINAL_FAILURE');
}

async function testReportLifecycleDownloadFailure() {
  const axiosInstance = buildAxiosStub([
    { method: 'post', match: '/reports', response: { status: 202, data: { reportId: 'report-123' } } },
    { method: 'get', match: '/reports/report-123', response: { status: 200, data: { processingStatus: 'DONE', reportDocumentId: 'doc-123' } } },
    { method: 'get', match: '/documents/doc-123', response: { status: 200, data: { url: 'https://download.example/report-123.txt' } } },
    { method: 'get', match: 'https://download.example/report-123.txt', error: buildHttpError('download failed', 403) },
  ]);
  const result = await fetchOrdersReport({
    accessToken: 'token',
    marketplaceId: 'marketplace',
    dateRange: { startDate: '2026-04-07', endDate: '2026-04-07' },
    axiosInstance,
    sleep: async () => {},
    polling: { maxAttempts: 2, pollIntervalMs: 1 },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.stage, 'download-report');
  assert.strictEqual(result.error.httpStatus, 403);
}

async function testReportLifecycleRejectsNonText() {
  const axiosInstance = buildAxiosStub([
    { method: 'post', match: '/reports', response: { status: 202, data: { reportId: 'report-123' } } },
    { method: 'get', match: '/reports/report-123', response: { status: 200, data: { processingStatus: 'DONE', reportDocumentId: 'doc-123' } } },
    { method: 'get', match: '/documents/doc-123', response: { status: 200, data: { url: 'https://download.example/report-123.pdf' } } },
    { method: 'get', match: 'https://download.example/report-123.pdf', response: { status: 200, data: Buffer.from('%PDF', 'utf8'), headers: { 'content-type': 'application/pdf' } } },
  ]);
  const result = await fetchOrdersReport({
    accessToken: 'token',
    marketplaceId: 'marketplace',
    dateRange: { startDate: '2026-04-07', endDate: '2026-04-07' },
    axiosInstance,
    sleep: async () => {},
    polling: { maxAttempts: 2, pollIntervalMs: 1 },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error.code, 'NON_TEXT_REPORT');
}

async function testRunnerAuthFailure() {
  let savedReport = null;
  let printedReport = null;

  await assert.rejects(
    () => runGetSalesOrganic(
      { metric: 'sales-organic', date: '2026-04-15', source: 'file', delayMs: 0 },
      {
        loadConfig: () => ({
          amazon: {},
          salesOrganic: {
            polling: { createTimeoutMs: 12345 },
          },
        }),
        mintSpAccessToken: async () => {
          throw new Error('bad credentials');
        },
        writeReport: async ({ report }) => {
          savedReport = report;
          return '/tmp/sales-organic-auth-failure.json';
        },
        printSalesOrganicReport: (report, reportPath) => {
          printedReport = { report, reportPath };
        },
      },
    ),
    /Sales Organic failed at auth: bad credentials/,
  );

  assert(savedReport);
  assert.strictEqual(savedReport.status, 'failed');
  assert.strictEqual(savedReport.stage, 'auth');
  assert.strictEqual(savedReport.error.message, 'bad credentials');
  assert.deepStrictEqual(savedReport.summary.lifecyclePhases, ['auth']);
  assert.strictEqual(savedReport.summary.attempts.create, 0);
  assert.strictEqual(savedReport.summary.attempts.poll, 0);
  assert.strictEqual(printedReport.reportPath, '/tmp/sales-organic-auth-failure.json');
}

function testParserEscapedNewlines() {
  const text = 'sku\\titem-price\\tquantity\\torder-status\\nABC\\t10.00\\t1\\tShipped\\nABC\\t5.50\\t2\\tPending\\nXYZ\\t7.25\\t1\\tShipped';
  const parsed = parseOrdersReport(text);
  assert.strictEqual(parsed.skuCount, 2);
  assert.strictEqual(parsed.bySku.ABC.totalSales, 15.5);
  assert.strictEqual(parsed.bySku.ABC.totalUnits, 3);
  assert.strictEqual(parsed.bySku.XYZ.totalSales, 7.25);
}

function testParserNormalNewlines() {
  const text = [
    'sku\titem-price\tquantity\torder-status',
    'ABC\t10.00\t1\tShipped',
    'ABC\t5.50\t2\tPending',
    'XYZ\t7.25\t1\tShipped',
  ].join('\n');
  const parsed = parseOrdersReport(text);
  assert.strictEqual(parsed.skuCount, 2);
  assert.strictEqual(parsed.bySku.ABC.totalSales, 15.5);
  assert.strictEqual(parsed.bySku.XYZ.totalUnits, 1);
}

function testParserSkipsCancelledAndUnsupportedStatuses() {
  const text = [
    'sku\titem-price\tquantity\torder-status',
    'ABC\t10.00\t1\tShipped',
    'ABC\t5.00\t1\tPending',
    'ABC\t9.00\t1\tCancelled',
    'ABC\t11.00\t1\tShipping',
    'XYZ\t7.25\t1\tShipped',
  ].join('\n');
  const parsed = parseOrdersReport(text);
  assert.strictEqual(parsed.bySku.ABC.totalSales, 15);
  assert.strictEqual(parsed.bySku.ABC.totalUnits, 2);
  assert.strictEqual(parsed.bySku.XYZ.totalSales, 7.25);
}

function testParserMissingHeaders() {
  assert.throws(() => parseOrdersReport('foo,bar\n1,2'), /Could not locate sku, sales, and quantity columns/);
}

function testParserRejectsMalformedNumeric() {
  assert.throws(
    () => parseOrdersReport('sku\titem-price\tquantity\torder-status\nABC\tnope\t1\tShipped'),
    /Invalid numeric value for sales line 2 sku ABC/,
  );
}

function testParserAggregatesDuplicateSkuRows() {
  const parsed = parseOrdersReport([
    'sku\titem-price\tquantity\torder-status',
    'DUP\t10.00\t1\tShipped',
    'DUP\t11.25\t2\tPending',
    'DUP\t3.75\t1\tShipped',
  ].join('\n'));

  assert.strictEqual(parsed.skuCount, 1);
  assert.strictEqual(parsed.bySku.DUP.totalSales, 25);
  assert.strictEqual(parsed.bySku.DUP.totalUnits, 4);
}

async function testFileSourceLoadsFixture() {
  const result = await loadAdSalesFromFile('data/sales-organic-input.json', '2026-04-15');
  assert.strictEqual(result.source, 'file');
  assert.strictEqual(result.skuCount, 33);
  assert.strictEqual(result.bySku['Choco-12pack-1200g'].adSales, 126.19);
  assert.strictEqual(result.bySku['Choco-12pack-1200g'].expectedSalesOrganic, 169.32);
}

async function testFileSourceRejectsMalformedNumeric() {
  const tmpPath = path.join(__dirname, 'tmp-sales-organic-invalid.json');
  await fs.promises.writeFile(tmpPath, JSON.stringify([
    { date: '2026-04-15', sku: 'SKU1', adSales: 'not-a-number' },
  ]), 'utf8');
  try {
    await assert.rejects(
      () => loadAdSalesFromFile(tmpPath, '2026-04-15'),
      /Invalid numeric value for adSales file .*tmp-sales-organic-invalid\.json row 0 sku SKU1/,
    );
  } finally {
    await fs.promises.rm(tmpPath, { force: true });
  }
}

async function testSheetSourceRejectsMissingColumns() {
  const config = buildSheetConfig();
  await assert.rejects(
    () => loadSalesOrganicFromGoogleSheet(config, {
      sheets: buildSheetsStub([
        ['something', 'else'],
        ['SKU', 'notes'],
      ]),
      auth: {},
    }),
    /source=sheet missing required SKU and AD_SALES_\$ columns/,
  );
}

async function testSheetSourceTimeoutContext() {
  const config = buildSheetConfig();
  await assert.rejects(
    () => loadSalesOrganicFromGoogleSheet(config, {
      sheets: {
        spreadsheets: {
          values: {
            get: async () => {
              const error = new Error('deadline exceeded');
              error.code = 'ETIMEDOUT';
              throw error;
            },
          },
        },
      },
      auth: {},
    }),
    /source=sheet timeout: deadline exceeded/,
  );
}

function testComputeMismatchDetection() {
  const computation = computeSalesOrganic({
    parsedReport: {
      bySku: {
        SKU1: { sku: 'SKU1', totalSales: 150, totalUnits: 3 },
        SKU2: { sku: 'SKU2', totalSales: 50, totalUnits: 1 },
      },
    },
    adSalesInput: {
      source: 'file',
      bySku: {
        SKU1: { sku: 'SKU1', adSales: 40, expectedSalesOrganic: 110, expectedSalesPpc: 40, source: 'file' },
        SKU2: { sku: 'SKU2', adSales: 60, expectedSalesOrganic: 5, expectedSalesPpc: 60, source: 'file' },
      },
    },
    tolerance: 0.01,
  });

  assert.strictEqual(computation.summary.skuCount, 2);
  assert.strictEqual(computation.summary.matched, 1);
  assert.strictEqual(computation.summary.mismatched, 1);
  assert.strictEqual(computation.items.find((item) => item.sku === 'SKU2').salesOrganic, 0);
}

function testComputeClampsNegativeOrganic() {
  const computation = computeSalesOrganic({
    parsedReport: {
      bySku: {
        SKU1: { sku: 'SKU1', totalSales: 12.34, totalUnits: 1 },
      },
    },
    adSalesInput: {
      source: 'file',
      bySku: {
        SKU1: { sku: 'SKU1', adSales: 20, expectedSalesOrganic: 0, expectedSalesPpc: 20, source: 'file' },
      },
    },
    tolerance: 0.01,
  });

  const item = computation.items[0];
  assert.strictEqual(item.salesOrganic, 0);
  assert.strictEqual(item.organicDelta, 0);
  assert.strictEqual(item.comparisonStatus, 'match');
}

function testComputeHandlesEmptySkuSet() {
  const computation = computeSalesOrganic({
    parsedReport: { bySku: {} },
    adSalesInput: { source: 'sheet', bySku: {} },
    tolerance: 0.01,
  });

  assert.deepStrictEqual(computation.items, []);
  assert.deepStrictEqual(computation.mismatches, []);
  assert.deepStrictEqual(computation.summary, {
    skuCount: 0,
    matched: 0,
    mismatched: 0,
    missingExpected: 0,
    extraReportSkuCount: 0,
  });
}

function testComputeSheetModeIncludesJoinBoundarySkus() {
  const computation = computeSalesOrganic({
    parsedReport: {
      bySku: {
        REPORT_ONLY: { sku: 'REPORT_ONLY', totalSales: 90, totalUnits: 2 },
      },
    },
    adSalesInput: {
      source: 'sheet',
      bySku: {
        AD_ONLY: { sku: 'AD_ONLY', adSales: 15, expectedSalesOrganic: 0, expectedSalesPpc: 15, source: 'sheet' },
      },
    },
    tolerance: 0.01,
  });

  assert.deepStrictEqual(computation.items.map((item) => item.sku), ['AD_ONLY', 'REPORT_ONLY']);
  assert.strictEqual(computation.items.find((item) => item.sku === 'AD_ONLY').reportPresent, false);
  assert.strictEqual(computation.items.find((item) => item.sku === 'REPORT_ONLY').adSalesPresent, false);
}

async function testRunnerComputeFromFileSource() {
  let savedReport = null;
  await runGetSalesOrganic(
    { metric: 'sales-organic', date: '2026-04-15', source: 'file', delayMs: 0 },
    {
      mintSpAccessToken: async () => 'token',
      fetchOrdersReport: async () => ({
        ok: true,
        stage: 'download-report',
        attempts: { create: 1, poll: 1 },
        lifecycle: [{ stage: 'download-report', attempt: 1, status: 'success' }],
        reportId: 'r1',
        reportDocumentId: 'd1',
        processingStatus: 'DONE',
        contentType: 'text/plain',
        reportText: 'sku\titem-price\tquantity\torder-status\nChoco-12pack-1200g\t126.19\t1\tShipped\nChoco-12pack-1200g\t169.32\t1\tPending\nChoco-Blueberry-100g\t169.83\t1\tShipped\n',
      }),
      writeReport: async ({ report }) => {
        savedReport = report;
        return '/tmp/sales-organic.json';
      },
      printSalesOrganicReport: () => {},
    },
  );

  assert(savedReport);
  assert.strictEqual(savedReport.status, 'success');
  assert.strictEqual(savedReport.stage, 'compute');
  const first = savedReport.items.find((item) => item.sku === 'Choco-12pack-1200g');
  assert.strictEqual(first.totalSales, 295.51);
  assert.strictEqual(first.adSales, 126.19);
  assert.strictEqual(first.salesOrganic, 169.32);
  assert.strictEqual(first.comparisonStatus, 'match');
}

function buildAxiosStub(steps, requestLog = []) {
  const queue = [...steps];
  async function request(method, url, bodyOrConfig, maybeConfig) {
    const step = queue.shift();
    if (!step) throw new Error(`Unexpected ${method.toUpperCase()} ${url}`);
    assert.strictEqual(step.method, method);
    assert.strictEqual(String(url).includes(step.match), true, `Expected ${url} to include ${step.match}`);
    const body = method === 'post' ? bodyOrConfig : undefined;
    const config = method === 'post' ? maybeConfig || {} : bodyOrConfig || {};
    requestLog.push({ method, url, body, config });
    if (step.error) throw step.error;
    return { status: step.response.status, data: step.response.data, headers: step.response.headers || {} };
  }
  return {
    post: (url, body, config) => request('post', url, body, config),
    get: (url, config) => request('get', url, config),
  };
}

function buildHttpError(message, status, code = 'ERR_BAD_RESPONSE') {
  const error = new Error(message);
  error.code = code;
  error.response = { status, data: { message } };
  return error;
}

function buildSheetConfig() {
  return {
    google: {
      serviceAccountEmail: 'svc@example.com',
      privateKey: 'private-key',
      scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
      spreadsheetId: 'sheet-id',
      sheetName: 'Sheet1',
      range: 'A:Z',
    },
  };
}

function buildSheetsStub(values) {
  return {
    spreadsheets: {
      values: {
        get: async () => ({ data: { values } }),
      },
    },
  };
}

function getSelectedTests(grepValue = '') {
  const grepPattern = grepValue ? new RegExp(grepValue, 'i') : null;
  const selected = grepPattern ? tests.filter((test) => grepPattern.test(test.name)) : tests;
  if (!selected.length) throw new Error(`No tests matched --grep ${grepValue}`);
  return selected;
}

async function runSalesOrganicTests(grepValue = '') {
  const selected = getSelectedTests(grepValue);
  for (const test of selected) {
    await test.fn();
    console.log(`PASS ${test.name}`);
  }
  console.log(`Completed ${selected.length} sales-organic test(s).`);
}

function parseGrep(argv) {
  const index = argv.indexOf('--grep');
  return index === -1 ? '' : argv[index + 1] || '';
}

async function main() {
  await runSalesOrganicTests(parseGrep(process.argv.slice(2)));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  runSalesOrganicTests,
};
