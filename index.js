#!/usr/bin/env node

const { runWithArgs } = require('./scripts/index');

if (require.main === module) {
  runWithArgs(process.argv.slice(2)).catch((error) => {
    console.error(`[Runner] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  runWithArgs,
};
