const { google } = require('googleapis');

async function loadProductsFromGoogleSheet(config, deps = {}) {
  const { values } = await readSheetValues(config, deps);
  let headerRowIdx = -1;
  let skuCol = -1;
  let asinCol = -1;

  for (let i = 0; i < Math.min(values.length, 12); i += 1) {
    const row = values[i] || [];
    const foundSkuCol = row.findIndex((cell) => String(cell).trim().toUpperCase() === 'SKU');
    const foundAsinCol = row.findIndex((cell) => String(cell).trim().toUpperCase() === 'ASIN');
    if (foundSkuCol !== -1) {
      headerRowIdx = i;
      skuCol = foundSkuCol;
    }
    if (foundAsinCol !== -1) {
      asinCol = foundAsinCol;
    }
  }

  if (headerRowIdx === -1 || skuCol === -1 || asinCol === -1) {
    throw new Error('Could not find SKU and ASIN columns in the Google Sheet');
  }

  const items = [];
  for (let i = headerRowIdx + 1; i < values.length; i += 1) {
    const row = values[i] || [];
    const sku = String(row[skuCol] || '').trim();
    const asin = String(row[asinCol] || '').trim().toUpperCase();
    if (!sku || /^SKU$/i.test(sku) || /^IMG$/i.test(sku) || /_TOTALS$/i.test(sku)) continue;
    if (!/^[A-Z0-9]{10}$/i.test(asin)) continue;
    items.push({ sku, asin, rowNumber: i + 1 });
  }

  return items;
}

async function loadSalesOrganicFromGoogleSheet(config, deps = {}) {
  const { values } = await readSheetValues(config, deps);
  const headerInfo = findPrimaryHeaderRow(values, [
    ['SKU'],
    ['AD_SALES_$', 'AD SALES', 'ADSALES'],
  ]);
  const headerRow = headerInfo.row || [];
  const skuCol = findHeaderIndex(headerRow, ['SKU']);
  const adSalesCol = findHeaderIndex(headerRow, ['AD_SALES_$', 'AD SALES', 'ADSALES']);
  const salesOrganicCol = findHeaderIndex(headerRow, ['SALES_ORGANIC_$', 'SALES ORGANIC', 'SALESORGANIC']);

  if (skuCol === -1 || adSalesCol === -1) {
    throw new Error('source=sheet missing required SKU and AD_SALES_$ columns');
  }

  const bySku = {};
  for (let rowIndex = headerInfo.index + 1; rowIndex < values.length; rowIndex += 1) {
    const row = values[rowIndex] || [];
    const sku = String(row[skuCol] || '').trim();
    if (!sku || /^SKU$/i.test(sku) || /^IMG$/i.test(sku) || /_TOTALS$/i.test(sku)) continue;

    const context = `source=sheet row ${rowIndex + 1} sku ${sku}`;
    bySku[sku] = {
      sku,
      adSales: parseSheetNumber(row[adSalesCol], `adSales ${context}`),
      expectedSalesOrganic: salesOrganicCol === -1 || row[salesOrganicCol] === undefined || row[salesOrganicCol] === null || String(row[salesOrganicCol]).trim() === ''
        ? null
        : parseSheetNumber(row[salesOrganicCol], `salesOrganic ${context}`),
      expectedSalesPpc: parseSheetNumber(row[adSalesCol], `expectedSalesPpc ${context}`),
      rowNumber: rowIndex + 1,
      source: 'sheet',
    };
  }

  return {
    bySku,
    skuCount: Object.keys(bySku).length,
    source: 'sheet',
  };
}

async function loadUnitsOrganicFromGoogleSheet(config, deps = {}) {
  const { values } = await readSheetValues(config, deps);
  const headerInfo = findPrimaryHeaderRow(values, [
    ['SKU'],
    ['AD_UNITS', 'AD UNITS', 'ADUNITS'],
  ]);
  const headerRow = headerInfo.row || [];
  const skuCol = findHeaderIndex(headerRow, ['SKU']);
  const adUnitsCol = findHeaderIndex(headerRow, ['AD_UNITS', 'AD UNITS', 'ADUNITS']);
  const salesOrganicQtyCol = findHeaderIndex(headerRow, [
    'SALES_ORGANIC_QTY',
    'SALES ORGANIC QTY',
    'SALESORGANICQTY',
    'SALES_ORGANIC',
    'SALES ORGANIC',
    'SALESORGANIC',
  ]);

  if (skuCol === -1 || adUnitsCol === -1) {
    throw new Error('source=sheet missing required SKU and AD_UNITS columns');
  }

  const bySku = {};
  for (let rowIndex = headerInfo.index + 1; rowIndex < values.length; rowIndex += 1) {
    const row = values[rowIndex] || [];
    const rowHasValues = row.some((cell) => String(cell ?? '').trim() !== '');
    if (!rowHasValues) continue;

    const sku = String(row[skuCol] || '').trim();
    const adUnitsValue = row[adUnitsCol];
    const expectedSalesOrganicQtyValue = salesOrganicQtyCol === -1 ? undefined : row[salesOrganicQtyCol];

    if (!sku) {
      const hasDataInTrackedColumns = String(adUnitsValue ?? '').trim() !== '' || String(expectedSalesOrganicQtyValue ?? '').trim() !== '';
      if (hasDataInTrackedColumns) {
        throw new Error(`source=sheet row ${rowIndex + 1} missing required SKU`);
      }
      continue;
    }

    if (/^SKU$/i.test(sku) || /^IMG$/i.test(sku) || /_TOTALS$/i.test(sku)) continue;

    const context = `source=sheet row ${rowIndex + 1} sku ${sku}`;
    bySku[sku] = {
      sku,
      adUnits: parseRequiredSheetNumber(adUnitsValue, `adUnits ${context}`),
      expectedSalesOrganicQty: expectedSalesOrganicQtyValue === undefined || expectedSalesOrganicQtyValue === null || String(expectedSalesOrganicQtyValue).trim() === ''
        ? null
        : parseSheetNumber(expectedSalesOrganicQtyValue, `expectedSalesOrganicQty ${context}`),
      expectedSalesPpcQty: parseRequiredSheetNumber(adUnitsValue, `expectedSalesPpcQty ${context}`),
      rowNumber: rowIndex + 1,
      source: 'sheet',
    };
  }

  return {
    bySku,
    skuCount: Object.keys(bySku).length,
    source: 'sheet',
  };
}

async function readSheetValues(config, deps = {}) {
  try {
    const auth = deps.auth || new google.auth.JWT({
      email: config.google.serviceAccountEmail,
      key: config.google.privateKey,
      scopes: [config.google.scope],
    });

    const sheets = deps.sheets || google.sheets({ version: 'v4', auth });
    const range = `${config.google.sheetName}!${config.google.range}`;
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: config.google.spreadsheetId,
      range,
    });

    return {
      values: response.data.values || [],
    };
  } catch (error) {
    throw wrapSheetError(error);
  }
}

function wrapSheetError(error) {
  const message = error?.message || 'Unknown Google Sheets error';
  const isTimeout = error?.code === 'ETIMEDOUT'
    || error?.code === 'ECONNABORTED'
    || /timeout/i.test(message);
  if (isTimeout) {
    const wrapped = new Error(`source=sheet timeout: ${message}`);
    wrapped.code = 'SHEET_TIMEOUT';
    wrapped.timeout = true;
    throw wrapped;
  }

  const wrapped = new Error(`source=sheet read failed: ${message}`);
  wrapped.code = error?.code || 'SHEET_READ_FAILED';
  throw wrapped;
}

function findPrimaryHeaderRow(values, requiredAliasGroups) {
  for (let index = 0; index < Math.min(values.length, 12); index += 1) {
    const row = values[index] || [];
    const hasAll = requiredAliasGroups.every((aliases) => findHeaderIndex(row, aliases) !== -1);
    if (hasAll) {
      return { index, row };
    }
  }

  return { index: 0, row: values[0] || [] };
}

function findHeaderIndex(headerRow, aliases) {
  const normalizedAliases = aliases.map(normalizeHeader);
  return headerRow.findIndex((cell) => normalizedAliases.includes(normalizeHeader(cell)));
}

function normalizeHeader(value) {
  return String(value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function parseSheetNumber(value, context) {
  if (value === undefined || value === null || String(value).trim() === '') return 0;
  const parsed = Number(String(value ?? '').replace(/[\s,$]/g, ''));
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric value for ${context}`);
  }
  return Number(parsed.toFixed(2));
}

function parseRequiredSheetNumber(value, context) {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new Error(`Missing numeric value for ${context}`);
  }
  return parseSheetNumber(value, context);
}

module.exports = {
  loadProductsFromGoogleSheet,
  loadSalesOrganicFromGoogleSheet,
  loadUnitsOrganicFromGoogleSheet,
  readSheetValues,
  findHeaderIndex,
  normalizeHeader,
  parseSheetNumber,
  parseRequiredSheetNumber,
};
