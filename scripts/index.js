#!/usr/bin/env node

const { parseCliArgs } = require('./lib/cli');
const { runApp } = require('./app');

async function runWithArgs(argv, deps = {}) {
  const parse = deps.parseCliArgs || parseCliArgs;
  const helpPrinter = deps.printHelp || printHelp;
  const args = parse(argv);

  if (args.help) {
    helpPrinter();
    return { help: true };
  }

  return runApp(args, deps);
}

function printHelp() {
  console.log(`Usage:\n  node index.js --bsr --date YYYY-MM-DD [--end-date YYYY-MM-DD] [--source file|sheet] [--delay-ms 0]\n  node index.js --sales-organic --date YYYY-MM-DD [--end-date YYYY-MM-DD] [--source file|sheet] [--delay-ms 0]\n  node index.js --units-organic --date YYYY-MM-DD [--end-date YYYY-MM-DD] [--source file|sheet] [--delay-ms 0]\n  node index.js --sales-ppc --date YYYY-MM-DD [--end-date YYYY-MM-DD] [--source file|sheet] [--delay-ms 0]\n\nExamples:\n  node index.js --bsr --date 2026-04-07\n  node index.js --bsr --date 2026-04-07 --source sheet\n  node index.js --bsr --date 2026-04-01 --end-date 2026-04-07 --delay-ms 250\n  node index.js --sales-organic --date 2026-04-07\n  node index.js --sales-organic --date 2026-04-07 --source file --delay-ms 0\n  node index.js --units-organic --date 2026-04-07 --source file --delay-ms 0\n  node index.js --units-organic --date 2026-04-07 --source sheet --delay-ms 0\n  node index.js --sales-ppc --date 2026-04-15 --source file --delay-ms 0\n`);
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
