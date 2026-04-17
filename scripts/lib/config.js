const path = require('path');
const dotenv = require('dotenv');

const ENV_PATH = path.join(__dirname, '..', '.env');
dotenv.config({ path: ENV_PATH, quiet: true });

function loadConfig({ source, metric = null, env = process.env } = {}) {
  const config = {
    productsFile: path.join(__dirname, '..', 'data', 'products.json'),
    amazon: {
      clientId: optionalEnv(env, 'AMAZON_SP_CLIENT_ID'),
      clientSecret: optionalEnv(env, 'AMAZON_SP_CLIENT_SECRET'),
      refreshToken: optionalEnv(env, 'AMAZON_SP_REFRESH_TOKEN'),
      marketplaceId: optionalEnv(env, 'AMAZON_MARKETPLACE_ID'),
    },
    amazonAds: {
      clientId: optionalEnv(env, 'AMAZON_ADS_CLIENT_ID'),
      clientSecret: optionalEnv(env, 'AMAZON_ADS_CLIENT_SECRET'),
      refreshToken: optionalEnv(env, 'AMAZON_ADS_REFRESH_TOKEN'),
      profileId: optionalEnv(env, 'AMAZON_ADS_PROFILE_ID'),
      authTimeoutMs: parsePositiveInteger(env.AMAZON_ADS_AUTH_TIMEOUT_MS, 30000, 'AMAZON_ADS_AUTH_TIMEOUT_MS'),
    },
    google: {
      serviceAccountEmail: env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '',
      privateKey: normalizePem(env.GOOGLE_PRIVATE_KEY || ''),
      scope: env.GOOGLE_SCOPE || 'https://www.googleapis.com/auth/spreadsheets.readonly',
      spreadsheetId: env.SPREADSHEET_ID || extractSpreadsheetId(env.SPREADSHEET_URL_OR_ID || ''),
      spreadsheetUrlOrId: env.SPREADSHEET_URL_OR_ID || '',
      sheetName: env.SHEET_NAME || 'N8N_DOWNLOAD',
      range: env.RANGE || 'A:BD',
    },
    bsr: {
      delayMs: parsePositiveInteger(env.BSR_DELAY_MS, 1500, 'BSR_DELAY_MS'),
      maxAttempts: parsePositiveInteger(env.BSR_MAX_ATTEMPTS, 5, 'BSR_MAX_ATTEMPTS'),
      requestTimeoutMs: parsePositiveInteger(env.BSR_REQUEST_TIMEOUT_MS, 30000, 'BSR_REQUEST_TIMEOUT_MS'),
      baseRetryDelayMs: parsePositiveInteger(env.BSR_BASE_RETRY_DELAY_MS, 5000, 'BSR_BASE_RETRY_DELAY_MS'),
      maxRetryDelayMs: parsePositiveInteger(env.BSR_MAX_RETRY_DELAY_MS, 60000, 'BSR_MAX_RETRY_DELAY_MS'),
    },
    salesOrganic: {
      fileInput: path.join(__dirname, '..', 'data', 'sales-organic-input.json'),
      comparisonTolerance: parsePositiveNumber(env.SALES_ORGANIC_COMPARISON_TOLERANCE, 0.01, 'SALES_ORGANIC_COMPARISON_TOLERANCE'),
      polling: {
        maxAttempts: parsePositiveInteger(env.SP_REPORT_POLL_MAX_ATTEMPTS, 10, 'SP_REPORT_POLL_MAX_ATTEMPTS'),
        pollIntervalMs: parsePositiveInteger(env.SP_REPORT_POLL_INTERVAL_MS, 60000, 'SP_REPORT_POLL_INTERVAL_MS'),
        createTimeoutMs: parsePositiveInteger(env.SP_REPORT_CREATE_TIMEOUT_MS, 30000, 'SP_REPORT_CREATE_TIMEOUT_MS'),
        pollTimeoutMs: parsePositiveInteger(env.SP_REPORT_POLL_TIMEOUT_MS, 30000, 'SP_REPORT_POLL_TIMEOUT_MS'),
        documentTimeoutMs: parsePositiveInteger(env.SP_REPORT_DOCUMENT_TIMEOUT_MS, 30000, 'SP_REPORT_DOCUMENT_TIMEOUT_MS'),
        downloadTimeoutMs: parsePositiveInteger(env.SP_REPORT_DOWNLOAD_TIMEOUT_MS, 30000, 'SP_REPORT_DOWNLOAD_TIMEOUT_MS'),
      },
    },
    unitsOrganic: {
      fileInput: path.join(__dirname, '..', 'data', 'units-organic-input.json'),
      comparisonTolerance: parsePositiveNumber(env.UNITS_ORGANIC_COMPARISON_TOLERANCE, 0.01, 'UNITS_ORGANIC_COMPARISON_TOLERANCE'),
      polling: {
        maxAttempts: parsePositiveInteger(env.SP_REPORT_POLL_MAX_ATTEMPTS, 10, 'SP_REPORT_POLL_MAX_ATTEMPTS'),
        pollIntervalMs: parsePositiveInteger(env.SP_REPORT_POLL_INTERVAL_MS, 60000, 'SP_REPORT_POLL_INTERVAL_MS'),
        createTimeoutMs: parsePositiveInteger(env.SP_REPORT_CREATE_TIMEOUT_MS, 30000, 'SP_REPORT_CREATE_TIMEOUT_MS'),
        pollTimeoutMs: parsePositiveInteger(env.SP_REPORT_POLL_TIMEOUT_MS, 30000, 'SP_REPORT_POLL_TIMEOUT_MS'),
        documentTimeoutMs: parsePositiveInteger(env.SP_REPORT_DOCUMENT_TIMEOUT_MS, 30000, 'SP_REPORT_DOCUMENT_TIMEOUT_MS'),
        downloadTimeoutMs: parsePositiveInteger(env.SP_REPORT_DOWNLOAD_TIMEOUT_MS, 30000, 'SP_REPORT_DOWNLOAD_TIMEOUT_MS'),
      },
    },
    salesPpc: {
      fileInput: path.join(__dirname, '..', 'data', 'sales-ppc-input.json'),
      report: {
        namePrefix: env.SALES_PPC_REPORT_NAME_PREFIX || 'SKU_Sales_PPC',
        adProduct: env.SALES_PPC_AD_PRODUCT || 'SPONSORED_PRODUCTS',
        reportTypeId: env.SALES_PPC_REPORT_TYPE_ID || 'spAdvertisedProduct',
        format: env.SALES_PPC_REPORT_FORMAT || 'GZIP_JSON',
        timeUnit: env.SALES_PPC_TIME_UNIT || 'DAILY',
        groupBy: parseJsonStringArray(env.SALES_PPC_GROUP_BY, ['advertiser'], 'SALES_PPC_GROUP_BY'),
        columns: parseJsonStringArray(env.SALES_PPC_COLUMNS, ['advertisedSku', 'sales7d', 'attributedSales7d'], 'SALES_PPC_COLUMNS'),
      },
      polling: {
        maxAttempts: parsePositiveInteger(env.AMAZON_ADS_REPORT_POLL_MAX_ATTEMPTS, 10, 'AMAZON_ADS_REPORT_POLL_MAX_ATTEMPTS'),
        pollIntervalMs: parsePositiveInteger(env.AMAZON_ADS_REPORT_POLL_INTERVAL_MS, 60000, 'AMAZON_ADS_REPORT_POLL_INTERVAL_MS'),
        createTimeoutMs: parsePositiveInteger(env.AMAZON_ADS_REPORT_CREATE_TIMEOUT_MS, 30000, 'AMAZON_ADS_REPORT_CREATE_TIMEOUT_MS'),
        pollTimeoutMs: parsePositiveInteger(env.AMAZON_ADS_REPORT_POLL_TIMEOUT_MS, 30000, 'AMAZON_ADS_REPORT_POLL_TIMEOUT_MS'),
        downloadTimeoutMs: parsePositiveInteger(env.AMAZON_ADS_REPORT_DOWNLOAD_TIMEOUT_MS, 30000, 'AMAZON_ADS_REPORT_DOWNLOAD_TIMEOUT_MS'),
        baseRetryDelayMs: parsePositiveInteger(env.AMAZON_ADS_REPORT_BASE_RETRY_DELAY_MS, 60000, 'AMAZON_ADS_REPORT_BASE_RETRY_DELAY_MS'),
        maxRetryDelayMs: parsePositiveInteger(env.AMAZON_ADS_REPORT_MAX_RETRY_DELAY_MS, 300000, 'AMAZON_ADS_REPORT_MAX_RETRY_DELAY_MS'),
        jitterMaxMs: parsePositiveIntegerOrZero(env.AMAZON_ADS_REPORT_JITTER_MAX_MS, 30000, 'AMAZON_ADS_REPORT_JITTER_MAX_MS'),
      },
    },
  };

  validateMetricEnv(metric, config, env);

  if (source === 'sheet') {
    if (!config.google.serviceAccountEmail || !config.google.privateKey || !config.google.spreadsheetId) {
      throw new Error('Sheet source requires GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, and SPREADSHEET_ID or SPREADSHEET_URL_OR_ID');
    }
  }

  return config;
}

function validateMetricEnv(metric, config, env) {
  if (metric !== 'sales-ppc') {
    requiredEnv(env, 'AMAZON_SP_CLIENT_ID');
    requiredEnv(env, 'AMAZON_SP_CLIENT_SECRET');
    requiredEnv(env, 'AMAZON_SP_REFRESH_TOKEN');
    requiredEnv(env, 'AMAZON_MARKETPLACE_ID');
    config.amazon.clientId = env.AMAZON_SP_CLIENT_ID;
    config.amazon.clientSecret = env.AMAZON_SP_CLIENT_SECRET;
    config.amazon.refreshToken = env.AMAZON_SP_REFRESH_TOKEN;
    config.amazon.marketplaceId = env.AMAZON_MARKETPLACE_ID;
  }

  if (metric === 'sales-ppc') {
    requiredEnv(env, 'AMAZON_ADS_CLIENT_ID');
    requiredEnv(env, 'AMAZON_ADS_CLIENT_SECRET');
    requiredEnv(env, 'AMAZON_ADS_REFRESH_TOKEN');
    requiredEnv(env, 'AMAZON_ADS_PROFILE_ID');
    config.amazonAds.clientId = env.AMAZON_ADS_CLIENT_ID;
    config.amazonAds.clientSecret = env.AMAZON_ADS_CLIENT_SECRET;
    config.amazonAds.refreshToken = env.AMAZON_ADS_REFRESH_TOKEN;
    config.amazonAds.profileId = env.AMAZON_ADS_PROFILE_ID;
  }
}

function requiredEnv(env, name) {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(env, name) {
  return env[name] || '';
}

function normalizePem(value) {
  return String(value || '').replace(/\\n/g, '\n');
}

function extractSpreadsheetId(value) {
  if (!value) return '';
  const match = String(value).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : value;
}

function parsePositiveInteger(rawValue, fallback, envName) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return fallback;
  }

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${envName} must be a positive integer`);
  }

  return value;
}

function parsePositiveIntegerOrZero(rawValue, fallback, envName) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return fallback;
  }

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${envName} must be a non-negative integer`);
  }

  return value;
}

function parsePositiveNumber(rawValue, fallback, envName) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return fallback;
  }

  const value = Number(rawValue);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${envName} must be a non-negative number`);
  }

  return value;
}

function parseJsonStringArray(rawValue, fallback, envName) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return fallback;
  }

  let parsed;
  try {
    parsed = JSON.parse(rawValue);
  } catch (error) {
    throw new Error(`${envName} must be a JSON array of strings`);
  }

  if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== 'string' || !value.trim())) {
    throw new Error(`${envName} must be a JSON array of strings`);
  }

  return parsed;
}

module.exports = {
  loadConfig,
  extractSpreadsheetId,
};
