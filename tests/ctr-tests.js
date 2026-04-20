#!/usr/bin/env node

const path = require('path');
const { runCtrTests } = require('../scripts/tests/ctr-tests');

function parseGrep(argv) {
  const index = argv.indexOf('--grep');
  return index === -1 ? '' : argv[index + 1] || '';
}

async function main() {
  process.chdir(path.join(__dirname, '..', 'scripts'));
  await runCtrTests(parseGrep(process.argv.slice(2)));
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
