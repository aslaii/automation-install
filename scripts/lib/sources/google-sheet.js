const { google } = require('googleapis');

async function loadProductsFromGoogleSheet(config) {
  const auth = new google.auth.JWT({
    email: config.google.serviceAccountEmail,
    key: config.google.privateKey,
    scopes: [config.google.scope],
  });

  const sheets = google.sheets({ version: 'v4', auth });
  const range = `${config.google.sheetName}!${config.google.range}`;
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: config.google.spreadsheetId,
    range,
  });

  const values = response.data.values || [];
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

module.exports = {
  loadProductsFromGoogleSheet,
};
