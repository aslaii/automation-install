const fs = require('fs');

async function loadSalesPpcFromFile(filePath, date) {
  let raw;
  try {
    raw = await fs.promises.readFile(filePath, 'utf8');
  } catch (error) {
    throw new Error(`Sales PPC file read failed (${filePath}): ${error.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Sales PPC file JSON parse failed (${filePath}): ${error.message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`Sales PPC file must contain an array: ${filePath}`);
  }

  const bySku = {};
  const seenKeys = new Map();
  let matchedRowCount = 0;

  for (let index = 0; index < parsed.length; index += 1) {
    const item = parsed[index] || {};
    if (item.date !== date) continue;
    matchedRowCount += 1;

    const sku = String(item.sku || '').trim();
    if (!sku) {
      throw new Error(`Sales PPC file row ${index} is missing sku (${filePath})`);
    }

    const duplicateKey = `${date}::${sku}`;
    if (seenKeys.has(duplicateKey)) {
      const firstRow = seenKeys.get(duplicateKey);
      throw new Error(`Sales PPC file duplicate row for date ${date} sku ${sku} (${filePath} rows ${firstRow} and ${index})`);
    }
    seenKeys.set(duplicateKey, index);

    const context = `file ${filePath} row ${index} sku ${sku}`;
    const expectedSalesPpc = parseRequiredNumber(item.expectedSalesPpc, `expectedSalesPpc ${context}`);

    bySku[sku] = {
      sku,
      expectedSalesPpc,
      rowNumber: index + 1,
      source: 'file',
      notes: item.notes || '',
      productLabel: item.productLabel || '',
    };
  }

  if (matchedRowCount === 0) {
    throw new Error(`Sales PPC file has no rows for requested date ${date} (${filePath})`);
  }

  return {
    date,
    bySku,
    skuCount: Object.keys(bySku).length,
    source: 'file',
  };
}

function parseRequiredNumber(value, context) {
  const parsed = Number(String(value).replace(/[\s,$]/g, ''));
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric value for ${context}`);
  }
  return Number(parsed.toFixed(2));
}

module.exports = {
  loadSalesPpcFromFile,
  parseRequiredNumber,
};
