function toNumber(v) {
  if (v === null || v === undefined || v === '') return 0;
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

const unitsField = reportData.find((row) => row && (row.unitsSoldClicks7d !== undefined || row.unitsSold7d !== undefined))?.unitsSoldClicks7d !== undefined
  ? 'unitsSoldClicks7d'
  : 'unitsSold7d';

const unitsBySku = new Map();
for (const row of reportData) {
  const sku = String(row.advertisedSku || '').trim();
  if (!sku) continue;
  const units = toNumber(row[unitsField]);
  unitsBySku.set(sku, Number(((unitsBySku.get(sku) || 0) + units).toFixed(2)));
}

const headerRow = values[0] || [];
const skuCol = headerRow.findIndex((cell) => normalizeHeader(cell) === 'SKU');
const targetCol = headerRow.findIndex((cell) => normalizeHeader(cell) === 'ADUNITS');

if (skuCol === -1 || targetCol === -1) {
  throw new Error('Could not find SKU and AD_UNITS columns');
}

const targetColA1 = colToA1(targetCol + 1);
const data = [];
for (let i = 1; i < values.length; i++) {
  const row = values[i] || [];
  const sku = String(row[skuCol] || '').trim();
  if (!sku || /_TOTALS$/i.test(sku)) continue;
  data.push({
    range: `${sheetName}!${targetColA1}${i + 1}`,
    values: [[Number((unitsBySku.get(sku) || 0).toFixed(2))]],
  });
}

return [{ json: { valueInputOption: 'USER_ENTERED', data } }];
