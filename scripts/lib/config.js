const path = require('path');
const dotenv = require('dotenv');

const ENV_PATH = path.join(__dirname, '..', '.env');
dotenv.config({ path: ENV_PATH });

function loadConfig({ source, env = process.env } = {}) {
  const config = {
    productsFile: path.join(__dirname, '..', 'data', 'products.json'),
    amazon: {
      clientId: requiredEnv(env, 'AMAZON_SP_CLIENT_ID'),
      clientSecret: requiredEnv(env, 'AMAZON_SP_CLIENT_SECRET'),
      refreshToken: requiredEnv(env, 'AMAZON_SP_REFRESH_TOKEN'),
      marketplaceId: requiredEnv(env, 'AMAZON_MARKETPLACE_ID'),
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
      polling: {
        maxAttempts: parsePositiveInteger(env.SP_REPORT_POLL_MAX_ATTEMPTS, 10, 'SP_REPORT_POLL_MAX_ATTEMPTS'),
        pollIntervalMs: parsePositiveInteger(env.SP_REPORT_POLL_INTERVAL_MS, 60000, 'SP_REPORT_POLL_INTERVAL_MS'),
        createTimeoutMs: parsePositiveInteger(env.SP_REPORT_CREATE_TIMEOUT_MS, 30000, 'SP_REPORT_CREATE_TIMEOUT_MS'),
        pollTimeoutMs: parsePositiveInteger(env.SP_REPORT_POLL_TIMEOUT_MS, 30000, 'SP_REPORT_POLL_TIMEOUT_MS'),
        documentTimeoutMs: parsePositiveInteger(env.SP_REPORT_DOCUMENT_TIMEOUT_MS, 30000, 'SP_REPORT_DOCUMENT_TIMEOUT_MS'),
        downloadTimeoutMs: parsePositiveInteger(env.SP_REPORT_DOWNLOAD_TIMEOUT_MS, 30000, 'SP_REPORT_DOWNLOAD_TIMEOUT_MS'),
      },
    },
  };

  if (source === 'sheet') {
    if (!config.google.serviceAccountEmail || !config.google.privateKey || !config.google.spreadsheetId) {
      throw new Error('Sheet source requires GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, and SPREADSHEET_ID or SPREADSHEET_URL_OR_ID');
    }
  }

  return config;
}

function requiredEnv(env, name) {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
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

module.exports = {
  loadConfig,
  extractSpreadsheetId,
};
