const path = require('path');
const dotenv = require('dotenv');

const ENV_PATH = path.join(__dirname, '..', '.env');
dotenv.config({ path: ENV_PATH });

function loadConfig({ source }) {
  const config = {
    productsFile: path.join(__dirname, '..', 'data', 'products.json'),
    amazon: {
      clientId: requiredEnv('AMAZON_SP_CLIENT_ID'),
      clientSecret: requiredEnv('AMAZON_SP_CLIENT_SECRET'),
      refreshToken: requiredEnv('AMAZON_SP_REFRESH_TOKEN'),
      marketplaceId: requiredEnv('AMAZON_MARKETPLACE_ID'),
    },
    google: {
      serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '',
      privateKey: normalizePem(process.env.GOOGLE_PRIVATE_KEY || ''),
      scope: process.env.GOOGLE_SCOPE || 'https://www.googleapis.com/auth/spreadsheets.readonly',
      spreadsheetId: process.env.SPREADSHEET_ID || extractSpreadsheetId(process.env.SPREADSHEET_URL_OR_ID || ''),
      spreadsheetUrlOrId: process.env.SPREADSHEET_URL_OR_ID || '',
      sheetName: process.env.SHEET_NAME || 'N8N_DOWNLOAD',
      range: process.env.RANGE || 'A:BD',
    },
  };

  if (source === 'sheet') {
    if (!config.google.serviceAccountEmail || !config.google.privateKey || !config.google.spreadsheetId) {
      throw new Error('Sheet source requires GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, and SPREADSHEET_ID or SPREADSHEET_URL_OR_ID');
    }
  }

  return config;
}

function requiredEnv(name) {
  const value = process.env[name];
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

module.exports = {
  loadConfig,
  extractSpreadsheetId,
};
