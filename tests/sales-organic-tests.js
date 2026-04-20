#!/usr/bin/env node

const { runSalesOrganicTests } = require('../scripts/tests/sales-organic-tests');

function parseGrep(argv) {
  const index = argv.indexOf('--grep');
  return index === -1 ? '' : argv[index + 1] || '';
}

async function main() {
  await runSalesOrganicTests(parseGrep(process.argv.slice(2)));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  main,
};
