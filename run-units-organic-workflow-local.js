#!/usr/bin/env node

const runner = require('./scripts/run-units-organic-workflow-local');

if (require.main === module) {
  runner.main(process.argv.slice(2)).catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = runner;
