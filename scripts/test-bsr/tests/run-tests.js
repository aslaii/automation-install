const assert = require('assert');
const { parseDateRange } = require('../lib/date');
const { extractBsr } = require('../lib/extract/bsr');
const { extractSpreadsheetId } = require('../lib/config');

function testParseDateRange() {
  assert.deepStrictEqual(parseDateRange('2026-04-07'), {
    startDate: '2026-04-07',
    endDate: '2026-04-07',
    sameDay: true,
  });

  assert.deepStrictEqual(parseDateRange('2026-04-01', '2026-04-07'), {
    startDate: '2026-04-01',
    endDate: '2026-04-07',
    sameDay: false,
  });

  assert.throws(() => parseDateRange('2026-04-07', '2026-04-01'));
}

function testExtractBsr() {
  const payload = {
    salesRanks: [
      {
        marketplaceId: 'ATVPDKIKX0DER',
        classificationRanks: [
          { classificationId: 'abc', title: 'Subcategory', rank: 11 },
          { classificationId: 'def', title: 'Subcategory 2', rank: 48 },
        ],
        displayGroupRanks: [
          { websiteDisplayGroup: 'grocery_display_on_website', title: 'Grocery & Gourmet Food', rank: 11093 },
        ],
      },
    ],
  };

  assert.deepStrictEqual(extractBsr(payload), {
    bsr: 11093,
    preferredDisplay: {
      websiteDisplayGroup: 'grocery_display_on_website',
      title: 'Grocery & Gourmet Food',
      rank: 11093,
    },
    classificationMin: 11,
    displayGroupRanks: [
      {
        websiteDisplayGroup: 'grocery_display_on_website',
        title: 'Grocery & Gourmet Food',
        rank: 11093,
      },
    ],
    classificationRanks: [
      { classificationId: 'abc', title: 'Subcategory', rank: 11 },
      { classificationId: 'def', title: 'Subcategory 2', rank: 48 },
    ],
    allRanks: [11093, 11, 48],
  });

  assert.deepStrictEqual(extractBsr({ foo: 'bar' }), {
    bsr: null,
    preferredDisplay: null,
    classificationMin: null,
    displayGroupRanks: [],
    classificationRanks: [],
    allRanks: [],
  });
}

function testExtractSpreadsheetId() {
  assert.strictEqual(
    extractSpreadsheetId('https://docs.google.com/spreadsheets/d/1abcDEFghiJKL/edit#gid=123'),
    '1abcDEFghiJKL',
  );
  assert.strictEqual(extractSpreadsheetId('raw-sheet-id'), 'raw-sheet-id');
}

function main() {
  testParseDateRange();
  testExtractBsr();
  testExtractSpreadsheetId();
  console.log('All tests passed.');
}

main();
