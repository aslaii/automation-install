#!/usr/bin/env node

const verifier = require('./scripts/verify-latest-units-organic-run');

if (require.main === module) {
  try {
    verifier.main();
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}

module.exports = verifier;
