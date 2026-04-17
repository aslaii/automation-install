function parseOrdersReport(reportText) {
  let text = String(reportText || '').trim();
  if (!text) {
    return { bySku: {}, skuCount: 0, parseWarning: 'Order report text empty' };
  }

  if (!text.includes('\n') && text.includes('\\n')) {
    text = text.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\t/g, '\t');
  }

  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) {
    return { bySku: {}, skuCount: 0, parseWarning: 'Order report has no data rows' };
  }

  const delimiter = lines[0].includes('\t') ? '\t' : ',';
  const headers = parseDelimitedLine(lines[0], delimiter);
  const normalized = headers.map((header) => normalizeHeader(header));
  const pickIndex = (candidates) => normalized.findIndex((header) => candidates.includes(header));

  const skuIdx = pickIndex(['sku', 'sellersku', 'merchantsku']);
  const salesIdx = pickIndex(['itemprice', 'productsales', 'itempriceperunit']);
  const qtyIdx = pickIndex(['quantity', 'quantitypurchased', 'unitsordered']);
  const statusIdx = pickIndex(['orderstatus', 'status']);

  if (skuIdx === -1 || salesIdx === -1 || qtyIdx === -1) {
    throw new Error('Could not locate sku, sales, and quantity columns in orders report');
  }

  const skipStatuses = new Set(['CANCELLED']);
  const includeStatuses = new Set(['SHIPPED', 'PENDING']);
  const bySku = {};

  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseDelimitedLine(lines[i], delimiter);
    const sku = String(cols[skuIdx] || '').trim();
    if (!sku) continue;

    const status = statusIdx === -1 ? '' : String(cols[statusIdx] || '').trim().toUpperCase();
    if (skipStatuses.has(status)) continue;
    if (statusIdx !== -1 && status && !includeStatuses.has(status)) continue;

    const rowContext = `line ${i + 1} sku ${sku}`;
    const sales = parseRequiredNumber(cols[salesIdx], `sales ${rowContext}`);
    const units = parseRequiredNumber(cols[qtyIdx], `quantity ${rowContext}`);
    const record = bySku[sku] || { sku, totalSales: 0, totalUnits: 0 };
    record.totalSales = roundCurrency(record.totalSales + sales);
    record.totalUnits = roundCurrency(record.totalUnits + units);
    bySku[sku] = record;
  }

  const skuCount = Object.keys(bySku).length;
  return {
    bySku,
    skuCount,
    parseWarning: skuCount === 0 ? 'Order report has no qualifying SKU rows' : null,
  };
}

function parseDelimitedLine(line, delimiter) {
  const out = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === delimiter && !inQuotes) {
      out.push(current);
      current = '';
      continue;
    }

    current += ch;
  }

  out.push(current);
  return out.map((value) => String(value || '').trim());
}

function normalizeHeader(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseRequiredNumber(input, context) {
  if (input === null || input === undefined || String(input).trim() === '') return 0;
  const normalized = String(input).replace(/[\s,$]/g, '');
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric value for ${context}`);
  }
  return parsed;
}

function roundCurrency(value) {
  return Number(Number(value || 0).toFixed(2));
}

module.exports = {
  parseOrdersReport,
  parseDelimitedLine,
  normalizeHeader,
  parseRequiredNumber,
  roundCurrency,
};
