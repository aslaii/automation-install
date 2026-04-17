const axios = require('axios');
const { loadConfig } = require('./lib/config');
const { mintSpAccessToken } = require('./lib/auth/sp');
const { parseDateRange } = require('./lib/date');
const { loadProductsFromFile } = require('./lib/sources/file-products');
const { loadProductsFromGoogleSheet } = require('./lib/sources/google-sheet');
const { extractBsr } = require('./lib/extract/bsr');
const { writeReport } = require('./lib/output/write-report');
const { printBsrReport } = require('./lib/console');

async function runGetBsr(cliArgs) {
  const dateRange = parseDateRange(cliArgs.date, cliArgs.endDate);
  const config = loadConfig({ source: cliArgs.source });
  const source = cliArgs.source || 'file';
  const delayMs = Number.isFinite(cliArgs.delayMs) ? cliArgs.delayMs : 250;

  const products = source === 'sheet'
    ? await loadProductsFromGoogleSheet(config)
    : await loadProductsFromFile(config.productsFile);

  const accessToken = await mintSpAccessToken(config.amazon);
  const startedAt = new Date().toISOString();
  const items = [];

  for (let index = 0; index < products.length; index += 1) {
    const product = products[index];
    if (index > 0 && delayMs > 0) {
      await sleep(delayMs);
    }

    const result = await fetchBsrForProduct({
      accessToken,
      marketplaceId: config.amazon.marketplaceId,
      product,
      source,
    });

    items.push(result);
  }

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
    },
    summary: summarize(items),
    items,
  };

  const reportPath = await writeReport({ metric: 'bsr', report, dateRange });
  printBsrReport(report, reportPath);

  return { report, reportPath };
}

async function fetchBsrForProduct({ accessToken, marketplaceId, product, source }) {
  const { sku, asin, rowNumber } = product;
  const output = {
    sku,
    asin,
    source,
    rowNumber: rowNumber || null,
    status: 'unknown',
    bsr: null,
    ranksFound: [],
    requestUrl: `https://sellingpartnerapi-na.amazon.com/catalog/2022-04-01/items/${asin}`,
  };

  try {
    const response = await axios.get(output.requestUrl, {
      params: {
        marketplaceIds: marketplaceId,
        includedData: 'salesRanks',
      },
      headers: {
        'x-amz-access-token': accessToken,
        Accept: 'application/json',
      },
      timeout: 30000,
    });

    const extraction = extractBsr(response.data);
    output.ranksFound = extraction.ranks;
    output.bsr = extraction.bsr;
    output.status = extraction.bsr === null ? 'missing-rank' : 'success';
    output.httpStatus = response.status;
    return output;
  } catch (error) {
    output.status = 'error';
    output.error = {
      stage: 'fetch-bsr',
      message: error.response?.data?.message || error.message,
      httpStatus: error.response?.status || null,
    };
    return output;
  }
}

function summarize(items) {
  return items.reduce(
    (acc, item) => {
      acc.total += 1;
      if (item.status === 'success') acc.success += 1;
      if (item.status === 'missing-rank') acc.missingRank += 1;
      if (item.status === 'error') acc.failed += 1;
      return acc;
    },
    { total: 0, success: 0, missingRank: 0, failed: 0 },
  );
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
  summarize,
};
