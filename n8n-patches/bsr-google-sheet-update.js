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

function extractBsr(payload) {
  const ranks = [];
  const seen = new Set();

  function walk(value) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (key.toLowerCase() === 'rank') {
        const n = Number(child);
        if (Number.isFinite(n) && n > 0 && !seen.has(n)) {
          seen.add(n);
          ranks.push(n);
        }
      }
      walk(child);
    }
  }

  walk(payload);
  return ranks.length ? Math.min(...ranks) : '';
}

const originalItems = $('Build BSR Requests').all();
const sheet = $('Webhook Read Google Sheet').first().json || {};
const values = sheet.values || [];
const sheetName = $('Set Credentials').first().json['✅SHEET_NAME'];

const headerRow = values[0] || [];
const targetCol = headerRow.findIndex((cell) => normalizeHeader(cell) === 'BSR');

if (targetCol === -1) {
  throw new Error('Could not find BSR column');
}

const targetColA1 = colToA1(targetCol + 1);
const data = [];
for (const item of $input.all()) {
  const source = item.json || {};
  const originalIndex = item.pairedItem && typeof item.pairedItem.item === 'number' ? item.pairedItem.item : -1;
  const original = originalIndex >= 0 ? (originalItems[originalIndex]?.json || {}) : {};
  const rowNumber = original.rowNumber;
  if (!rowNumber) continue;
  data.push({
    range: `${sheetName}!${targetColA1}${rowNumber}`,
    values: [[extractBsr(source)]],
  });
}

return [{ json: { valueInputOption: 'USER_ENTERED', data } }];
