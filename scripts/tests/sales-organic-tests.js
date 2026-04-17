const assert = require('assert');
const { parseCliArgs } = require('../lib/cli');
const { loadConfig, extractSpreadsheetId } = require('../lib/config');
const { fetchOrdersReport, REPORT_TYPE } = require('../lib/sp/reports');
const { runWithArgs } = require('../index');

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
  assert.deepStrictEqual(
    result.lifecycle.map((entry) => `${entry.stage}:${entry.status}`),
    [
      'create-report:success',
      'poll-report:IN_QUEUE',
      'poll-report:DONE',
      'download-report:document-ready',
      'download-report:success',
    ],
  );
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
  assert.strictEqual(extractSpreadsheetId('https://docs.google.com/spreadsheets/d/1abcDEFghiJKL/edit#gid=123'), '1abcDEFghiJKL');
  assert.throws(
    () => loadConfig({
      source: 'file',
      env: {
        ...env,
        SP_REPORT_POLL_MAX_ATTEMPTS: '0',
      },
    }),
    /SP_REPORT_POLL_MAX_ATTEMPTS must be a positive integer/,
  );
}

async function testReportLifecycleMalformedCreate() {
  const axiosInstance = buildAxiosStub([
    {
      method: 'post',
      match: '/reports',
      response: { status: 202, data: {} },
    },
  ]);

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
  const axiosInstance = buildAxiosStub([
    {
      method: 'post',
      match: '/reports',
      error: buildHttpError('create failed', 500),
    },
  ]);

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
  assert.strictEqual(result.lifecycle[0].status, 'error');
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
  assert.strictEqual(result.error.timeout, true);
  assert.strictEqual(result.attempts.poll, 2);
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
  assert.strictEqual(result.stage, 'poll-report');
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
  assert.strictEqual(result.reportDocumentId, 'doc-123');
}

async function testReportLifecycleRejectsNonText() {
  const axiosInstance = buildAxiosStub([
    { method: 'post', match: '/reports', response: { status: 202, data: { reportId: 'report-123' } } },
    { method: 'get', match: '/reports/report-123', response: { status: 200, data: { processingStatus: 'DONE', reportDocumentId: 'doc-123' } } },
    { method: 'get', match: '/documents/doc-123', response: { status: 200, data: { url: 'https://download.example/report-123.pdf' } } },
    {
      method: 'get',
      match: 'https://download.example/report-123.pdf',
      response: {
        status: 200,
        data: Buffer.from('%PDF', 'utf8'),
        headers: { 'content-type': 'application/pdf' },
      },
    },
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
  assert.strictEqual(result.error.code, 'NON_TEXT_REPORT');
}

function buildAxiosStub(steps, requestLog = []) {
  const queue = [...steps];

  async function request(method, url, bodyOrConfig, maybeConfig) {
    const step = queue.shift();
    if (!step) {
      throw new Error(`Unexpected ${method.toUpperCase()} ${url}`);
    }
    assert.strictEqual(step.method, method);
    assert.strictEqual(String(url).includes(step.match), true, `Expected ${url} to include ${step.match}`);

    const body = method === 'post' ? bodyOrConfig : undefined;
    const config = method === 'post' ? maybeConfig || {} : bodyOrConfig || {};
    requestLog.push({ method, url, body, config });

    if (step.error) {
      throw step.error;
    }

    return {
      status: step.response.status,
      data: step.response.data,
      headers: step.response.headers || {},
    };
  }

  return {
    post: (url, body, config) => request('post', url, body, config),
    get: (url, config) => request('get', url, config),
  };
}

function buildHttpError(message, status, code = 'ERR_BAD_RESPONSE') {
  const error = new Error(message);
  error.code = code;
  error.response = {
    status,
    data: { message },
  };
  return error;
}

async function main() {
  const grepValue = parseGrep(process.argv.slice(2));
  const grepPattern = grepValue ? new RegExp(grepValue, 'i') : null;
  const selected = grepPattern
    ? tests.filter((test) => grepPattern.test(test.name))
    : tests;

  if (!selected.length) {
    throw new Error(`No tests matched --grep ${grepValue}`);
  }

  for (const test of selected) {
    await test.fn();
    console.log(`PASS ${test.name}`);
  }

  console.log(`Completed ${selected.length} test(s).`);
}

function parseGrep(argv) {
  const index = argv.indexOf('--grep');
  if (index === -1) {
    return '';
  }
  return argv[index + 1] || '';
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
