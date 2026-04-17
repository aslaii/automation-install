#!/usr/bin/env node

const { parseCliArgs } = require('./lib/cli');
const { runGetBsr } = require('./get-bsr');

async function main() {
  const args = parseCliArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  if (!args.metric) {
    throw new Error('No metric selected. Use --bsr.');
  }

  if (args.metric === 'bsr') {
    await runGetBsr(args);
    return;
  }

  throw new Error(`Unsupported metric: ${args.metric}`);
}

function printHelp() {
  console.log(`Usage:\n  node index.js --bsr --date YYYY-MM-DD [--end-date YYYY-MM-DD] [--source file|sheet] [--delay-ms 0]\n\nExamples:\n  node index.js --bsr --date 2026-04-07\n  node index.js --bsr --date 2026-04-07 --source sheet\n  node index.js --bsr --date 2026-04-01 --end-date 2026-04-07 --delay-ms 250\n`);
}

main().catch((error) => {
  console.error(`[BSR Runner] ${error.message}`);
  process.exitCode = 1;
});
