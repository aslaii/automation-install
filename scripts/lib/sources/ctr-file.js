const fs = require('fs');
const path = require('path');
const { parseDelimitedLine, normalizeHeader } = require('../extract/orders-report');

const REQUIRED_HEADERS = ['Products', 'Clicks', 'Impressions', 'CTR'];

async function loadCtrFromFile(filePath, date) {
  let raw;
  try {
    raw = await fs.promises.readFile(filePath, 'utf8');
  } catch (error) {
    throw new Error(`CTR file read failed (${filePath}): ${error.message}`);
  }

  const filenameDate = extractFilenameDate(filePath);
  if (filenameDate !== date) {
    throw new Error(`CTR file date mismatch (${filePath}): requested ${date} but filename date is ${filenameDate}`);
  }

  const normalizedText = String(raw || '').replace(/^\uFEFF/, '').trim();
  if (!normalizedText) {
    throw new Error(`CTR file is empty (${filePath})`);
  }

  const lines = normalizedText.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) {
    throw new Error(`CTR file is empty (${filePath})`);
  }

  const delimiter = lines[0].includes('\t') ? '\t' : ',';
  const headers = parseDelimitedLine(lines[0], delimiter);
  const normalizedHeaders = headers.map((header) => normalizeHeader(header));
  const headerIndexes = buildHeaderIndexes(headers, normalizedHeaders, filePath);
  const statusIndex = headerIndexes.status;

  const bySku = {};
  const seenSkus = new Map();

  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const cols = parseDelimitedLine(lines[lineIndex], delimiter);
    if (cols.length !== headers.length) {
      throw new Error(`CTR file row ${lineIndex} column count mismatch (${filePath}): expected ${headers.length} columns but found ${cols.length}`);
    }

    const productLabel = parseRequiredString(cols[headerIndexes.products], `Products file ${filePath} row ${lineIndex}`);
    const sku = extractSku(productLabel, filePath, lineIndex);

    if (seenSkus.has(sku)) {
      const firstRow = seenSkus.get(sku);
      throw new Error(`CTR file duplicate extracted sku for date ${date} sku ${sku} (${filePath} rows ${firstRow} and ${lineIndex})`);
    }
    seenSkus.set(sku, lineIndex);

    const clicks = parseRequiredNumber(cols[headerIndexes.clicks], `Clicks file ${filePath} row ${lineIndex} sku ${sku}`);
    const impressions = parseRequiredNumber(cols[headerIndexes.impressions], `Impressions file ${filePath} row ${lineIndex} sku ${sku}`);
    parseRequiredNumber(cols[headerIndexes.ctr], `CTR file ${filePath} row ${lineIndex} sku ${sku}`);

    bySku[sku] = {
      sku,
      expectedCtr: computeCtrPercentage(clicks, impressions),
      rowNumber: lineIndex - 1,
      source: 'file',
      notes: statusIndex === -1 ? '' : String(cols[statusIndex] || '').trim(),
      productLabel,
      traceability: {
        filePath,
        rowNumber: lineIndex - 1,
        date,
      },
    };
  }

  if (Object.keys(bySku).length === 0) {
    throw new Error(`CTR file has no rows for requested date ${date} (${filePath})`);
  }

  return {
    date,
    bySku,
    skuCount: Object.keys(bySku).length,
    source: 'file',
  };
}

function buildHeaderIndexes(headers, normalizedHeaders, filePath) {
  const pickHeader = (headerName) => normalizedHeaders.findIndex((header) => header === normalizeHeader(headerName));
  const indexes = {
    products: pickHeader('Products'),
    clicks: pickHeader('Clicks'),
    impressions: pickHeader('Impressions'),
    ctr: pickHeader('CTR'),
    status: pickHeader('Status'),
  };

  const missingHeaders = REQUIRED_HEADERS.filter((headerName) => indexes[normalizeHeader(headerName)] === -1);
  if (missingHeaders.length > 0) {
    throw new Error(`CTR file missing required headers (${filePath}): ${missingHeaders.join(', ')}`);
  }

  return indexes;
}

function extractFilenameDate(filePath) {
  const matches = path.basename(String(filePath || '')).match(/\d{4}-\d{2}-\d{2}/g) || [];
  if (matches.length !== 1) {
    throw new Error(`CTR file filename must contain exactly one YYYY-MM-DD date (${filePath})`);
  }
  return matches[0];
}

function extractSku(productLabel, filePath, rowNumber) {
  const hyphenIndex = productLabel.indexOf('-');
  if (hyphenIndex === -1) {
    throw new Error(`CTR file row ${rowNumber} has unsplittable Products value (${filePath}): ${productLabel}`);
  }

  const sku = productLabel.slice(hyphenIndex + 1).trim();
  if (!sku) {
    throw new Error(`CTR file row ${rowNumber} has blank extracted sku from Products (${filePath}): ${productLabel}`);
  }

  return sku;
}

function parseRequiredNumber(value, context) {
  const normalized = String(value === undefined || value === null ? '' : value).replace(/[\s,%]/g, '');
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric value for ${context}`);
  }
  return Math.round((parsed + Number.EPSILON) * 10000) / 10000;
}

function parseRequiredString(value, context) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error(`Missing required value for ${context}`);
  }
  return normalized;
}

function computeCtrPercentage(clicks, impressions) {
  if (!Number.isFinite(impressions) || impressions <= 0) {
    return 0;
  }

  return Math.round((((clicks / impressions) * 100) + Number.EPSILON) * 10000) / 10000;
}

module.exports = {
  loadCtrFromFile,
  parseRequiredNumber,
  parseRequiredString,
  extractFilenameDate,
  extractSku,
  computeCtrPercentage,
};
