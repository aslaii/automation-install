function toNumber(v) {
  if (v === null || v === undefined) return 0;
  const s = String(v).replace(/[$,%\s,]/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
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

function normalizeHeader(value) {
  return String(value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

const sheet = $json;
const values = sheet.values || [];
const reportData = $('Extract from File').first().json.data || [];
const sheetName = $('Set Credentials').first().json['✅SHEET_NAME'];

const metricsBySku = new Map();
for (const row of reportData) {
  const sku = String(row.advertisedSku || '').trim();
  if (!sku) continue;
  const clicks = toNumber(row.clicks);
  const impressions = toNumber(row.impressions);
  const bucket = metricsBySku.get(sku) || { clicks: 0, impressions: 0 };
  bucket.clicks = Number((bucket.clicks + clicks).toFixed(4));
  bucket.impressions = Number((bucket.impressions + impressions).toFixed(4));
  metricsBySku.set(sku, bucket);
}

const ctrBySku = new Map();
for (const [sku, metrics] of metricsBySku.entries()) {
  const ctr = metrics.impressions > 0
    ? Number(((metrics.clicks / metrics.impressions) * 100).toFixed(4))
    : 0;
  ctrBySku.set(sku, ctr);
}

const headerRow = values[0] || [];
const skuCol = headerRow.findIndex((cell) => normalizeHeader(cell) === 'SKU');
const targetCol = headerRow.findIndex((cell) => normalizeHeader(cell) === 'CTR');

if (skuCol === -1 || targetCol === -1) {
  throw new Error('Could not find SKU and CTR columns');
}

const targetColA1 = colToA1(targetCol + 1);
const data = [];
for (let i = 1; i < values.length; i++) {
  const row = values[i] || [];
  const sku = String(row[skuCol] || '').trim();
  if (!sku || !ctrBySku.has(sku)) continue;
  data.push({
    range: `${sheetName}!${targetColA1}${i + 1}`,
    values: [[ctrBySku.get(sku)]],
  });
}

return [{ json: { valueInputOption: 'USER_ENTERED', data } }];
