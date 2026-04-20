#!/usr/bin/env node

const path = require('path');
const { main } = require('./scripts/run-ctr-workflow-local');

async function run() {
  process.chdir(path.join(__dirname, 'scripts'));
  await main(process.argv.slice(2));
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  main: run,
};
