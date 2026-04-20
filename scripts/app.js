const { runGetBsr } = require('./features/bsr');
const { runGetSalesOrganic } = require('./features/sales-organic');
const { runGetCtr } = require('./features/ctr');

async function runApp(cliArgs, deps = {}) {
  if (!cliArgs.metric) {
    throw new Error('No metric selected. Use --bsr, --sales-organic, --units-organic, --sales-ppc, or --ctr.');
  }

  if (!cliArgs.date) {
    throw new Error('Missing required --date YYYY-MM-DD');
  }

  const runner = resolveMetricRunner(cliArgs.metric, deps);
  return runner(cliArgs, deps);
}

function resolveMetricRunner(metric, deps = {}) {
  if (metric === 'bsr') {
    return deps.runGetBsr || runGetBsr;
  }

  if (metric === 'sales-organic') {
    return deps.runGetSalesOrganic || runGetSalesOrganic;
  }

  if (metric === 'sales-ppc') {
    if (deps.runGetSalesPpc) {
      return deps.runGetSalesPpc;
    }

    try {
      return require('./features/sales-ppc').runGetSalesPpc;
    } catch (error) {
      if (error.code === 'MODULE_NOT_FOUND' && String(error.message || '').includes('./features/sales-ppc')) {
        throw new Error('sales-ppc runner is not available in this checkout');
      }
      throw error;
    }
  }

  if (metric === 'ctr') {
    return deps.runGetCtr || runGetCtr;
  }

  if (metric === 'units-organic') {
    if (deps.runGetUnitsOrganic) {
      return deps.runGetUnitsOrganic;
    }

    try {
      return require('./features/units-organic').runGetUnitsOrganic;
    } catch (error) {
      if (error.code === 'MODULE_NOT_FOUND' && String(error.message || '').includes('./features/units-organic')) {
        throw new Error('units-organic runner is not available in this checkout');
      }
      throw error;
    }
  }

  throw new Error(`Unsupported metric: ${metric}`);
}

async function runSalesPpcBoundary(cliArgs, deps = {}) {
  const runner = deps.runGetSalesPpc || require('./features/sales-ppc').runGetSalesPpc;
  return runner(cliArgs, deps);
}

module.exports = {
  runApp,
  resolveMetricRunner,
  runSalesPpcBoundary,
};
