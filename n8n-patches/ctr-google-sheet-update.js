function normalizeHeader(value) {
  return String(value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function hasVisibleCell(row) {
  return Array.isArray(row) && row.some((cell) => String(cell || '').trim() !== '');
}

function findHeaderIndex(headerRow, aliases) {
  const normalizedAliases = aliases.map(normalizeHeader);
  return headerRow.findIndex((cell) => normalizedAliases.includes(normalizeHeader(cell)));
}

function colToA1(colIndex1Based) {
  let n = colIndex1Based;
  let out = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    out = String.fromCharCode(65 + m) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function roundMetric(value) {
  const numeric = Number(value || 0);
  return Math.round((numeric + Number.EPSILON) * 10000) / 10000;
}

function roundCtr(value) {
  const numeric = Number(value || 0);
  return Math.round((numeric + Number.EPSILON) * 10000) / 10000;
}

function parseRequiredNumber(value, context) {
  const normalized = String(value === undefined || value === null ? '' : value).replace(/[\s,%]/g, '');
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric value for ${context}`);
  }
  return roundMetric(parsed);
}

function computeCtrValue(clicks, impressions) {
  return impressions > 0
    ? roundCtr((clicks / impressions) * 100)
    : 0;
}

function findHeaderRow(values) {
  const scanLimit = Math.min(values.length, 10);
  const matches = [];

  for (let index = 0; index < scanLimit; index += 1) {
    const row = Array.isArray(values[index]) ? values[index] : [];
    if (!hasVisibleCell(row)) {
      continue;
    }

    const skuCol = findHeaderIndex(row, ['SKU']);
    const targetCol = findHeaderIndex(row, ['CTR']);
    const sawRelevantHeader = skuCol !== -1 || targetCol !== -1;

    if (!sawRelevantHeader) {
      continue;
    }

    if (skuCol === -1 || targetCol === -1) {
      throw new Error(`Malformed header row ${index + 1}: expected SKU and CTR columns together`);
    }

    matches.push({
      headerRowIndex: index,
      skuCol,
      targetCol,
    });
  }

  if (matches.length === 0) {
    throw new Error(`Could not find SKU and CTR columns in first ${Math.max(scanLimit, 1)} rows`);
  }

  if (matches.length > 1) {
    throw new Error(`Ambiguous header rows for SKU and CTR within first ${scanLimit} rows`);
  }

  return matches[0];
}

const sheet = $json;
const values = Array.isArray(sheet.values) ? sheet.values : [];
const reportData = $('Extract from File').first().json.data || [];
const sheetName = $('Set Credentials').first().json['✅SHEET_NAME'];

const metricsBySku = new Map();
for (let index = 0; index < reportData.length; index += 1) {
  const row = reportData[index] || {};
  const rowNumber = index + 1;
  const sku = String(row.advertisedSku || '').trim();
  if (!sku) {
    throw new Error(`CTR report row ${rowNumber} is missing advertisedSku`);
  }

  const clicks = parseRequiredNumber(row.clicks, `clicks row ${rowNumber} sku ${sku}`);
  const impressions = parseRequiredNumber(row.impressions, `impressions row ${rowNumber} sku ${sku}`);
  const bucket = metricsBySku.get(sku) || { clicks: 0, impressions: 0 };
  bucket.clicks = roundMetric(bucket.clicks + clicks);
  bucket.impressions = roundMetric(bucket.impressions + impressions);
  metricsBySku.set(sku, bucket);
}

const { headerRowIndex, skuCol, targetCol } = findHeaderRow(values);
const targetColA1 = colToA1(targetCol + 1);
const data = [];

for (let index = headerRowIndex + 1; index < values.length; index += 1) {
  const row = Array.isArray(values[index]) ? values[index] : [];
  const sku = String(row[skuCol] || '').trim();
  if (!sku || /^SKU$/i.test(sku) || /^IMG$/i.test(sku) || /_TOTALS$/i.test(sku)) {
    continue;
  }

  const metrics = metricsBySku.get(sku);
  const ctr = metrics ? computeCtrValue(metrics.clicks, metrics.impressions) : 0;
  data.push({
    range: `${sheetName}!${targetColA1}${index + 1}` ,
    values: [[ctr]],
  });
}

return [{ json: { valueInputOption: 'USER_ENTERED', data } }];
