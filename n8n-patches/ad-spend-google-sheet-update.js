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

const adsBySku = new Map();
for (const row of reportData) {
  const sku = String(row.advertisedSku || '').trim();
  if (!sku) continue;
  const cost = toNumber(row.cost);
  adsBySku.set(sku, Number(((adsBySku.get(sku) || 0) + cost).toFixed(2)));
}

const headerRowIdx = 0;
const headerRow = values[headerRowIdx] || [];
const skuCol = headerRow.findIndex((cell) => normalizeHeader(cell) === 'SKU');
const targetCol = headerRow.findIndex((cell) => normalizeHeader(cell) === 'ADSPEND');

if (skuCol === -1 || targetCol === -1) {
  throw new Error('Could not find SKU and AD_SPEND columns');
}

const targetColA1 = colToA1(targetCol + 1);
const data = [];

for (let i = headerRowIdx + 1; i < values.length; i++) {
  const row = values[i] || [];
  const sku = String(row[skuCol] || '').trim();
  if (!sku || /_TOTALS$/i.test(sku)) continue;
  if (!adsBySku.has(sku)) continue;

  data.push({
    range: `${sheetName}!${targetColA1}${i + 1}`,
    values: [[Number((adsBySku.get(sku) || 0).toFixed(2))]],
  });
}

return [{
  json: {
    valueInputOption: 'USER_ENTERED',
    data,
  },
}];
