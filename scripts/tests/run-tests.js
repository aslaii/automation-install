const assert = require('assert');
const { parseDateRange } = require('../lib/date');
const { extractBsr } = require('../lib/extract/bsr');
const { extractSpreadsheetId, loadConfig } = require('../lib/config');
const { fetchBsrForProduct, normalizeBsrError, computeRetryDelayMs, parseRetryAfterMs } = require('../features/bsr');
const { runSalesOrganicTests } = require('./sales-organic-tests');

function testParseDateRange() {
  assert.deepStrictEqual(parseDateRange('2026-04-07'), {
    startDate: '2026-04-07',
    endDate: '2026-04-07',
    sameDay: true,
  });

  assert.deepStrictEqual(parseDateRange('2026-04-01', '2026-04-07'), {
    startDate: '2026-04-01',
    endDate: '2026-04-07',
    sameDay: false,
  });

  assert.throws(() => parseDateRange('2026-04-07', '2026-04-01'));
}

function testExtractBsr() {
  const payload = {
    salesRanks: [
      {
        marketplaceId: 'ATVPDKIKX0DER',
        classificationRanks: [
          { classificationId: 'abc', title: 'Subcategory', rank: 11 },
          { classificationId: 'def', title: 'Subcategory 2', rank: 48 },
        ],
        displayGroupRanks: [
          { websiteDisplayGroup: 'grocery_display_on_website', title: 'Grocery & Gourmet Food', rank: 11093 },
        ],
      },
    ],
  };

  assert.deepStrictEqual(extractBsr(payload), {
    bsr: 11093,
    preferredDisplay: {
      websiteDisplayGroup: 'grocery_display_on_website',
      title: 'Grocery & Gourmet Food',
      rank: 11093,
    },
    classificationMin: 11,
    displayGroupRanks: [
      {
        websiteDisplayGroup: 'grocery_display_on_website',
        title: 'Grocery & Gourmet Food',
        rank: 11093,
      },
    ],
    classificationRanks: [
      { classificationId: 'abc', title: 'Subcategory', rank: 11 },
      { classificationId: 'def', title: 'Subcategory 2', rank: 48 },
    ],
    allRanks: [11093, 11, 48],
  });

  assert.deepStrictEqual(extractBsr({ foo: 'bar' }), {
    bsr: null,
    preferredDisplay: null,
    classificationMin: null,
    displayGroupRanks: [],
    classificationRanks: [],
    allRanks: [],
  });
}

function testExtractSpreadsheetId() {
  assert.strictEqual(
    extractSpreadsheetId('https://docs.google.com/spreadsheets/d/1abcDEFghiJKL/edit#gid=123'),
    '1abcDEFghiJKL',
  );
  assert.strictEqual(extractSpreadsheetId('raw-sheet-id'), 'raw-sheet-id');
}

function testBsrConfigDefaults() {
  const env = {
    AMAZON_SP_CLIENT_ID: 'id',
    AMAZON_SP_CLIENT_SECRET: 'secret',
    AMAZON_SP_REFRESH_TOKEN: 'refresh',
    AMAZON_MARKETPLACE_ID: 'market',
  };

  const config = loadConfig({ source: 'file', env });
  assert.strictEqual(config.bsr.delayMs, 1500);
  assert.strictEqual(config.bsr.maxAttempts, 5);
  assert.strictEqual(config.bsr.requestTimeoutMs, 30000);
  assert.strictEqual(config.bsr.baseRetryDelayMs, 5000);
  assert.strictEqual(config.bsr.maxRetryDelayMs, 60000);
}

async function testBsrRetryAfterThrottleThenSuccess() {
  const calls = [];
  const sleepCalls = [];
  const axiosInstance = {
    get: async (url, config) => {
      calls.push({ url, config });
      if (calls.length === 1) {
        const error = new Error('Request failed with status code 429');
        error.response = { status: 429, data: { message: 'throttled' }, headers: { 'retry-after': '2' } };
        throw error;
      }
      return {
        status: 200,
        data: {
          salesRanks: [
            {
              displayGroupRanks: [{ websiteDisplayGroup: 'grocery_display_on_website', title: 'Grocery', rank: 123 }],
              classificationRanks: [],
            },
          ],
        },
      };
    },
  };

  const result = await fetchBsrForProduct({
    accessToken: 'token',
    marketplaceId: 'ATVPDKIKX0DER',
    product: { sku: 'SKU1', asin: 'B000000001' },
    source: 'file',
    axiosInstance,
    sleep: async (ms) => sleepCalls.push(ms),
    bsrConfig: {
      delayMs: 0,
      maxAttempts: 3,
      requestTimeoutMs: 1000,
      baseRetryDelayMs: 500,
      maxRetryDelayMs: 5000,
    },
  });

  assert.strictEqual(result.status, 'success');
  assert.strictEqual(result.bsr, 123);
  assert.strictEqual(result.attempts, 2);
  assert.deepStrictEqual(sleepCalls, [2000]);
  assert.strictEqual(result.retryHistory.length, 1);
  assert.strictEqual(result.retryHistory[0].code, 'THROTTLED');
}

async function testBsrTimeoutEventuallyFails() {
  const sleepCalls = [];
  const axiosInstance = {
    get: async () => {
      const error = new Error('timeout of 1000ms exceeded');
      error.code = 'ECONNABORTED';
      throw error;
    },
  };

  const result = await fetchBsrForProduct({
    accessToken: 'token',
    marketplaceId: 'ATVPDKIKX0DER',
    product: { sku: 'SKU1', asin: 'B000000001' },
    source: 'file',
    axiosInstance,
    sleep: async (ms) => sleepCalls.push(ms),
    bsrConfig: {
      delayMs: 0,
      maxAttempts: 2,
      requestTimeoutMs: 1000,
      baseRetryDelayMs: 500,
      maxRetryDelayMs: 5000,
    },
  });

  assert.strictEqual(result.status, 'error');
  assert.strictEqual(result.error.code, 'TIMEOUT');
  assert.strictEqual(result.error.timeout, true);
  assert.strictEqual(result.attempts, 2);
  assert.deepStrictEqual(sleepCalls, [500]);
}

function testRetryHelpers() {
  assert.strictEqual(parseRetryAfterMs('3'), 3000);
  const normalized = normalizeBsrError({
    response: { status: 429, data: { message: 'throttled' }, headers: { 'retry-after': '4' } },
    message: 'Request failed with status code 429',
  });
  assert.strictEqual(normalized.code, 'THROTTLED');
  assert.strictEqual(normalized.retryAfterMs, 4000);
  assert.strictEqual(
    computeRetryDelayMs(normalized, 2, {
      baseRetryDelayMs: 500,
      maxRetryDelayMs: 5000,
    }),
    4000,
  );
}

async function runBsrTests() {
  testParseDateRange();
  testExtractBsr();
  testExtractSpreadsheetId();
  testBsrConfigDefaults();
  await testBsrRetryAfterThrottleThenSuccess();
  await testBsrTimeoutEventuallyFails();
  testRetryHelpers();
  console.log('BSR tests passed.');
}

async function main() {
  const argv = process.argv.slice(2);
  const runBsrOnly = argv.includes('--bsr-only');

  await runBsrTests();

  if (!runBsrOnly) {
    await runSalesOrganicTests();
  }

  console.log(runBsrOnly ? 'BSR-only test run passed.' : 'All tests passed.');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  runBsrTests,
};
