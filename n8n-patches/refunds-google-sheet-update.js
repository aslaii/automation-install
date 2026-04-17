function toNumber(v) {
  if (v === null || v === undefined) return 0;
  const n = Number(String(v).replace(/[$,%\s,]/g, ''));
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

const sheet = $('Webhook Read Google Sheet').first().json || {};
const values = sheet.values || [];
const refundsBySku = $('SP Parse Returns by SKU').first().json.refundsBySku || {};
const sheetName = $('Set Credentials').first().json['✅SHEET_NAME'];

const headerRow = values[0] || [];
const skuCol = headerRow.findIndex((cell) => normalizeHeader(cell) === 'SKU');
const targetCol = headerRow.findIndex((cell) => normalizeHeader(cell) === 'REFUNDS');

if (skuCol === -1 || targetCol === -1) {
  throw new Error('Could not find SKU and REFUNDS columns');
}

const targetColA1 = colToA1(targetCol + 1);
const data = [];
for (let i = 1; i < values.length; i++) {
  const row = values[i] || [];
  const sku = String(row[skuCol] || '').trim();
  if (!sku) continue;
  data.push({
    range: `${sheetName}!${targetColA1}${i + 1}`,
    values: [[toNumber(refundsBySku[sku] || 0)]],
  });
}

return [{ json: { valueInputOption: 'USER_ENTERED', data } }];
