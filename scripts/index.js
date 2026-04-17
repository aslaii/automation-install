#!/usr/bin/env node

const { parseCliArgs } = require('./lib/cli');
const { runGetBsr } = require('./features/bsr');
const { runGetSalesOrganic } = require('./features/sales-organic');

async function runWithArgs(argv, deps = {}) {
  const parse = deps.parseCliArgs || parseCliArgs;
  const runBsr = deps.runGetBsr || runGetBsr;
  const runSalesOrganic = deps.runGetSalesOrganic || runGetSalesOrganic;
  const helpPrinter = deps.printHelp || printHelp;

  const args = parse(argv);

  if (args.help) {
    helpPrinter();
    return { help: true };
  }

  if (!args.metric) {
    throw new Error('No metric selected. Use --bsr or --sales-organic.');
  }

  if (args.metric === 'bsr') {
    return runBsr(args);
  }

  if (args.metric === 'sales-organic') {
    return runSalesOrganic(args);
  }

  throw new Error(`Unsupported metric: ${args.metric}`);
}

function printHelp() {
  console.log(`Usage:\n  node index.js --bsr --date YYYY-MM-DD [--end-date YYYY-MM-DD] [--source file|sheet] [--delay-ms 0]\n  node index.js --sales-organic --date YYYY-MM-DD [--end-date YYYY-MM-DD] [--source file|sheet] [--delay-ms 0]\n\nExamples:\n  node index.js --bsr --date 2026-04-07\n  node index.js --bsr --date 2026-04-07 --source sheet\n  node index.js --bsr --date 2026-04-01 --end-date 2026-04-07 --delay-ms 250\n  node index.js --sales-organic --date 2026-04-07\n  node index.js --sales-organic --date 2026-04-07 --source file --delay-ms 0\n`);
}

if (require.main === module) {
  runWithArgs(process.argv.slice(2)).catch((error) => {
    console.error(`[Runner] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  runWithArgs,
  printHelp,
};
