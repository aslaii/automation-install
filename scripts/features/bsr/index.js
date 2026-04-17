const axios = require('axios');
const { loadConfig } = require('../../lib/config');
const { mintSpAccessToken } = require('../../lib/auth/sp');
const { parseDateRange } = require('../../lib/date');
const { loadProductsFromFile } = require('../../lib/sources/file-products');
const { loadProductsFromGoogleSheet } = require('../../lib/sources/google-sheet');
const { extractBsr } = require('../../lib/extract/bsr');
const { writeReport } = require('../../lib/output/write-report');
const { printBsrReport } = require('../../lib/console');

async function runGetBsr(cliArgs, deps = {}) {
  const axiosInstance = deps.axiosInstance || axios;
  const sleeper = deps.sleep || sleep;
  const dateRange = parseDateRange(cliArgs.date, cliArgs.endDate);
  const config = loadConfig({ source: cliArgs.source });
  const source = cliArgs.source || 'file';
  const delayMs = Number.isFinite(cliArgs.delayMs) ? cliArgs.delayMs : config.bsr.delayMs;

  const products = source === 'sheet'
    ? await loadProductsFromGoogleSheet(config)
    : await loadProductsFromFile(config.productsFile);

  const accessToken = await mintSpAccessToken(config.amazon);
  const startedAt = new Date().toISOString();
  const items = [];

  for (let index = 0; index < products.length; index += 1) {
    const product = products[index];
    if (index > 0 && delayMs > 0) {
      await sleeper(delayMs);
    }

    const result = await fetchBsrForProduct({
      accessToken,
      marketplaceId: config.amazon.marketplaceId,
      product,
      source,
      axiosInstance,
      sleep: sleeper,
      bsrConfig: config.bsr,
    });

    items.push(result);
  }

  const warnings = [];
  const historicalWarning = buildHistoricalWarning(dateRange);
  if (historicalWarning) warnings.push(historicalWarning);
  const throttled = items.filter((item) => item.error?.code === 'THROTTLED').length;
  if (throttled > 0) warnings.push(`${throttled} SKU requests still hit Amazon throttling after bounded retries.`);

  const report = {
    metric: 'bsr',
    source,
    startedAt,
    completedAt: new Date().toISOString(),
    dateRange,
    request: {
      date: cliArgs.date,
      endDate: cliArgs.endDate || cliArgs.date,
      source,
      delayMs,
      productCount: products.length,
      retry: {
        maxAttempts: config.bsr.maxAttempts,
        requestTimeoutMs: config.bsr.requestTimeoutMs,
        baseRetryDelayMs: config.bsr.baseRetryDelayMs,
        maxRetryDelayMs: config.bsr.maxRetryDelayMs,
      },
    },
    summary: summarize(items),
    warnings,
    items,
  };

  const reportPath = await writeReport({ metric: 'bsr', report, dateRange });
  printBsrReport(report, reportPath);

  return { report, reportPath };
}

async function fetchBsrForProduct({ accessToken, marketplaceId, product, source, axiosInstance = axios, sleep: sleeper = sleep, bsrConfig = defaultBsrConfig() }) {
  const { sku, asin, rowNumber } = product;
  const output = {
    sku,
    asin,
    source,
    rowNumber: rowNumber || null,
    status: 'unknown',
    bsr: null,
    ranksFound: [],
    attempts: 0,
    retryHistory: [],
    requestUrl: `https://sellingpartnerapi-na.amazon.com/catalog/2022-04-01/items/${asin}`,
  };

  for (let attempt = 1; attempt <= bsrConfig.maxAttempts; attempt += 1) {
    output.attempts = attempt;

    try {
      const response = await axiosInstance.get(output.requestUrl, {
        params: {
          marketplaceIds: marketplaceId,
          includedData: 'salesRanks',
        },
        headers: {
          'x-amz-access-token': accessToken,
          Accept: 'application/json',
        },
        timeout: bsrConfig.requestTimeoutMs,
      });

      const extraction = extractBsr(response.data);
      output.ranksFound = extraction.ranks;
      output.preferredDisplay = extraction.preferredDisplay;
      output.classificationMin = extraction.classificationMin;
      output.displayGroupRanks = extraction.displayGroupRanks;
      output.classificationRanks = extraction.classificationRanks;
      output.bsr = extraction.bsr;
      output.status = extraction.bsr === null ? 'missing-rank' : 'success';
      output.httpStatus = response.status;
      return output;
    } catch (error) {
      const normalizedError = normalizeBsrError(error);
      const shouldRetry = isRetryableBsrError(normalizedError) && attempt < bsrConfig.maxAttempts;
      const retryAfterMs = shouldRetry ? computeRetryDelayMs(normalizedError, attempt, bsrConfig) : 0;

      output.retryHistory.push({
        attempt,
        code: normalizedError.code,
        httpStatus: normalizedError.httpStatus,
        retryAfterMs,
        message: normalizedError.message,
      });

      if (shouldRetry) {
        await sleeper(retryAfterMs);
        continue;
      }

      output.status = 'error';
      output.error = {
        stage: 'fetch-bsr',
        code: normalizedError.code,
        message: normalizedError.message,
        httpStatus: normalizedError.httpStatus,
        timeout: normalizedError.timeout,
        attempts: attempt,
      };
      return output;
    }
  }

  output.status = 'error';
  output.error = {
    stage: 'fetch-bsr',
    code: 'UNKNOWN_FAILURE',
    message: 'BSR request exhausted attempts without a classified result',
    httpStatus: null,
    timeout: false,
    attempts: output.attempts,
  };
  return output;
}

function summarize(items) {
  return items.reduce(
    (acc, item) => {
      acc.total += 1;
      if (item.status === 'success') acc.success += 1;
      if (item.status === 'missing-rank') acc.missingRank += 1;
      if (item.status === 'error') acc.failed += 1;
      acc.retried += Math.max(0, (item.attempts || 1) - 1);
      if (item.error?.code === 'THROTTLED') acc.throttled += 1;
      if (item.error?.timeout) acc.timedOut += 1;
      return acc;
    },
    { total: 0, success: 0, missingRank: 0, failed: 0, retried: 0, throttled: 0, timedOut: 0 },
  );
}

function normalizeBsrError(error) {
  const httpStatus = error.response?.status || null;
  const timeout = error.code === 'ECONNABORTED';
  const retryAfterHeader = error.response?.headers?.['retry-after'];
  const retryAfterMs = parseRetryAfterMs(retryAfterHeader);

  if (timeout) {
    return {
      code: 'TIMEOUT',
      message: error.message,
      httpStatus,
      timeout: true,
      retryAfterMs,
    };
  }

  if (httpStatus === 429) {
    return {
      code: 'THROTTLED',
      message: error.response?.data?.message || error.message,
      httpStatus,
      timeout: false,
      retryAfterMs,
    };
  }

  if (httpStatus && httpStatus >= 500) {
    return {
      code: 'SERVER_ERROR',
      message: error.response?.data?.message || error.message,
      httpStatus,
      timeout: false,
      retryAfterMs,
    };
  }

  return {
    code: 'HTTP_ERROR',
    message: error.response?.data?.message || error.message,
    httpStatus,
    timeout: false,
    retryAfterMs,
  };
}

function isRetryableBsrError(error) {
  return error.code === 'THROTTLED' || error.code === 'TIMEOUT' || error.code === 'SERVER_ERROR';
}

function computeRetryDelayMs(error, attempt, bsrConfig) {
  const exponential = Math.min(
    bsrConfig.maxRetryDelayMs,
    bsrConfig.baseRetryDelayMs * (2 ** Math.max(0, attempt - 1)),
  );
  return Math.max(error.retryAfterMs || 0, exponential);
}

function parseRetryAfterMs(value) {
  if (value === undefined || value === null || value === '') return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }
  return 0;
}

function defaultBsrConfig() {
  return {
    delayMs: 1500,
    maxAttempts: 5,
    requestTimeoutMs: 30000,
    baseRetryDelayMs: 5000,
    maxRetryDelayMs: 60000,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildHistoricalWarning(dateRange) {
  const today = new Date().toISOString().slice(0, 10);
  if (dateRange.startDate !== today || dateRange.endDate !== today) {
    return 'Catalog salesRanks is a current-state SP-API field. The --date/--end-date values are stored in the report for workflow parity, but they do not request historical BSR from Amazon.';
  }
  return null;
}

module.exports = {
  runGetBsr,
  fetchBsrForProduct,
  summarize,
  normalizeBsrError,
  computeRetryDelayMs,
  parseRetryAfterMs,
};
