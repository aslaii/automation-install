#!/usr/bin/env node

const runner = require('./scripts/run-sales-ppc-workflow-local');

if (require.main === module) {
  runner.main(process.argv.slice(2))
    .then((summary) => {
      if (summary && summary.compute.status !== 'ok') {
        process.exitCode = 1;
      }
    })
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exitCode = 1;
    });
}

module.exports = runner;
