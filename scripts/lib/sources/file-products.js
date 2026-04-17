const fs = require('fs');

async function loadProductsFromFile(filePath) {
  const raw = await fs.promises.readFile(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`Product file must contain an array: ${filePath}`);
  }

  return parsed.map((item, index) => {
    const sku = String(item.sku || '').trim();
    const asin = String(item.asin || '').trim().toUpperCase();
    if (!sku || !/^[A-Z0-9]{10}$/i.test(asin)) {
      throw new Error(`Invalid product entry at index ${index}`);
    }
    return { sku, asin, rowNumber: null };
  });
}

module.exports = {
  loadProductsFromFile,
};
