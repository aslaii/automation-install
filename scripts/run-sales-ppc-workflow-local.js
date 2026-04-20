#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  parseSalesPpcReport,
  computeSalesPpc,
  roundCurrency,
} = require('./features/sales-ppc');
const { loadSalesPpcFromFile } = require('./lib/sources/sales-ppc-file');

const DEFAULT_WORKFLOW = path.resolve(__dirname, '..', 'workflows', 'Get Sales PPC.json');
const DEFAULT_REPORT = path.resolve(__dirname, 'tests', 'fixtures', 'sales-ppc-report-contract.json');
const DEFAULT_SHEET = path.resolve(__dirname, 'tests', 'fixtures', 'sales-ppc-workflow-local-sheet.json');
const DEFAULT_NODE_NAME = 'Code in JavaScript';
const DEFAULT_MISMATCH_PREVIEW_LIMIT = 10;
const TARGET_HEADER_ALIASES = ['AD_SALES_$', 'AD SALES', 'ADSALES', 'SALESPPC'];

function invariant(message) {
  const error = new Error(message);
  error.code = 'WORKFLOW_LOCAL_INVARIANT';
  return error;
}

function normalizeHeader(value) {
  return String(value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function hasVisibleCell(row = []) {
  return row.some((cell) => String(cell || '').trim() !== '');
}

function findHeaderIndex(headerRow, aliases) {
  const normalizedAliases = aliases.map(normalizeHeader);
  return headerRow.findIndex((cell) => normalizedAliases.includes(normalizeHeader(cell)));
}

function colToA1(colIndex1Based) {
  let n = colIndex1Based;
  let out = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    out = String.fromCharCode(65 + m) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function parseOptionalSheetNumber(value, context) {
  if (value === '' || value === null || value === undefined) {
    return null;
  }

  const parsed = Number(String(value).replace(/[\s,$]/g, ''));
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric value for ${context}`);
  }

  return roundCurrency(parsed);
}

function readJsonFile(filePath) {
  return fs.promises.readFile(filePath, 'utf8').then((raw) => JSON.parse(raw));
}

async function readWorkflow(workflowPath = DEFAULT_WORKFLOW, options = {}) {
  const resolvedPath = path.resolve(workflowPath);
  let workflow;

  try {
    workflow = await readJsonFile(resolvedPath);
  } catch (error) {
    throw invariant(`[workflow local parity] workflow read failed (${resolvedPath}): ${error.message}`);
  }

  if (!workflow || !Array.isArray(workflow.nodes) || !workflow.connections || typeof workflow.connections !== 'object') {
    throw invariant('[workflow local parity] malformed workflow shape');
  }

  const nodeName = options.nodeName || DEFAULT_NODE_NAME;
  const computeNode = workflow.nodes.find((node) => node.name === nodeName);
  if (!computeNode) {
    throw invariant(`[workflow local parity] missing node: ${nodeName}`);
  }

  const code = computeNode.parameters?.jsCode;
  if (typeof code !== 'string' || !code.trim()) {
    throw invariant(`[workflow local parity] missing jsCode on node: ${nodeName}`);
  }

  return {
    path: resolvedPath,
    workflow,
    computeNode,
    nodeName,
    code,
  };
}

function extractReportRows(reportFixture) {
  if (Array.isArray(reportFixture)) {
    return reportFixture;
  }

  if (reportFixture && Array.isArray(reportFixture.reportRows)) {
    return reportFixture.reportRows;
  }

  throw new Error('Report fixture must be an array or contain reportRows[]');
}

function extractSheetContext(sheetFixture, fallbackSheetName = 'Sheet1') {
  const values = Array.isArray(sheetFixture?.values) ? sheetFixture.values : null;
  if (!values) {
    throw new Error('Sheet fixture must contain values[]');
  }

  const sheetName = String(sheetFixture.sheetName || fallbackSheetName || 'Sheet1');
  const headerRowIndex = values.findIndex((row) => {
    if (!Array.isArray(row) || !hasVisibleCell(row)) return false;
    return findHeaderIndex(row, ['SKU']) !== -1 && findHeaderIndex(row, TARGET_HEADER_ALIASES) !== -1;
  });

  if (headerRowIndex === -1) {
    throw new Error('source=sheet missing required SKU and AD_SALES_$ columns');
  }

  const headerRow = values[headerRowIndex] || [];
  const skuCol = findHeaderIndex(headerRow, ['SKU']);
  const targetCol = findHeaderIndex(headerRow, TARGET_HEADER_ALIASES);
  const targetColA1 = colToA1(targetCol + 1);
  const targets = [];
  const seenRanges = new Map();

  for (let i = headerRowIndex + 1; i < values.length; i += 1) {
    const row = Array.isArray(values[i]) ? values[i] : [];
    const sku = String(row[skuCol] || '').trim();
    if (!sku || /^SKU$/i.test(sku) || /^IMG$/i.test(sku) || /_TOTALS$/i.test(sku)) {
      continue;
    }

    parseOptionalSheetNumber(row[targetCol], `sheet target source=sheet row ${i + 1} sku ${sku}`);

    const range = `${sheetName}!${targetColA1}${i + 1}`;
    if (seenRanges.has(range)) {
      throw new Error(`Duplicate target range ${range} for SKUs ${seenRanges.get(range)} and ${sku}`);
    }
    seenRanges.set(range, sku);
    targets.push({ sku, rowIndex: i + 1, range });
  }

  return {
    sheetName,
    values,
    headerRowIndex,
    targetCol,
    targetColA1,
    skuCol,
    targets,
    targetSkus: targets.map((target) => target.sku),
  };
}

function createNodeAccessor(nodeData) {
  return (nodeName) => {
    if (!Object.prototype.hasOwnProperty.call(nodeData, nodeName)) {
      throw invariant(`[workflow local parity] missing upstream node data: ${nodeName}`);
    }

    const json = nodeData[nodeName];
    return {
      first: () => ({ json }),
      all: () => [{ json }],
      item: { json },
      isExecuted: true,
    };
  };
}

function normalizeBatchUpdatePayload(payload, stage) {
  if (!payload || typeof payload !== 'object') {
    throw new Error(`${stage} did not return an object payload`);
  }
  if (!Array.isArray(payload.data)) {
    throw new Error(`${stage} missing batchUpdate data[] payload`);
  }

  const normalized = [];
  const seenRanges = new Map();

  payload.data.forEach((entry, index) => {
    const range = String(entry?.range || '').trim();
    if (!range) {
      throw new Error(`${stage} update ${index + 1} is missing range`);
    }
    if (seenRanges.has(range)) {
      throw new Error(`Comparator saw duplicate target ranges: ${range}`);
    }
    seenRanges.set(range, index);

    const rawValue = Array.isArray(entry?.values) && Array.isArray(entry.values[0]) ? entry.values[0][0] : undefined;
    const value = parseOptionalSheetNumber(rawValue, `${stage} range ${range}`);
    if (value === null) {
      throw new Error(`${stage} range ${range} is missing a numeric writeback value`);
    }

    normalized.push({
      range,
      value,
      values: [[value]],
    });
  });

  normalized.sort((left, right) => left.range.localeCompare(right.range));
  return normalized;
}

function buildLocalBatchUpdate({ sheetContext, computation }) {
  const itemBySku = new Map((computation.items || []).map((item) => [item.sku, item]));

  const data = sheetContext.targets.map((target) => {
    const item = itemBySku.get(target.sku);
    const value = roundCurrency(item?.reportSalesPpc || 0);
    return {
      range: target.range,
      values: [[value]],
    };
  });

  return {
    valueInputOption: 'USER_ENTERED',
    data,
  };
}

function compareWritebacks({ localUpdates, workflowUpdates, sheetContext, reportRows }) {
  const localByRange = new Map(localUpdates.map((entry) => [entry.range, entry]));
  const workflowByRange = new Map(workflowUpdates.map((entry) => [entry.range, entry]));
  const ranges = Array.from(new Set([...localByRange.keys(), ...workflowByRange.keys()])).sort();
  const mismatchPreview = [];

  for (const range of ranges) {
    const local = localByRange.get(range);
    const workflow = workflowByRange.get(range);
    if (!local || !workflow || local.value !== workflow.value) {
      mismatchPreview.push({
        range,
        sku: sheetContext.targets.find((target) => target.range === range)?.sku || null,
        localValue: local?.value ?? null,
        workflowValue: workflow?.value ?? null,
        delta: local && workflow ? roundCurrency(workflow.value - local.value) : null,
      });
    }
  }

  const reportSkus = Array.from(new Set((reportRows || []).map((row) => String(row?.advertisedSku || '').trim()).filter(Boolean))).sort();
  const sheetSkus = Array.from(new Set(sheetContext.targetSkus)).sort();
  const sheetSkuSet = new Set(sheetSkus);
  const reportSkuSet = new Set(reportSkus);

  return {
    mismatchCount: mismatchPreview.length,
    mismatchPreview,
    reportOnlySkus: reportSkus.filter((sku) => !sheetSkuSet.has(sku)),
    sheetOnlySkus: sheetSkus.filter((sku) => !reportSkuSet.has(sku)),
  };
}

async function loadExpectedInput({ sheetFixture, date, tempDirPrefix = 'sales-ppc-workflow-local-' }) {
  if (sheetFixture?.fileRows && !Array.isArray(sheetFixture.fileRows)) {
    throw new Error('Sheet fixture fileRows must be an array when provided');
  }

  if (Array.isArray(sheetFixture?.fileRows)) {
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), tempDirPrefix));
    const tempPath = path.join(tmpDir, 'sales-ppc-file-input.json');
    await fs.promises.writeFile(tempPath, JSON.stringify(sheetFixture.fileRows, null, 2), 'utf8');
    try {
      return await loadSalesPpcFromFile(tempPath, date);
    } finally {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    }
  }

  if (sheetFixture?.fileInputPath) {
    return loadSalesPpcFromFile(path.resolve(sheetFixture.fileInputPath), date);
  }

  throw new Error('Sheet fixture must provide fileRows[] or fileInputPath for local expected input');
}

function runWorkflowCompute(workflowInfo, context = {}) {
  if (!workflowInfo || typeof workflowInfo.code !== 'string') {
    throw invariant('[workflow local parity] missing workflow code payload');
  }

  const sheetValues = context.sheetValues;
  const reportRows = context.reportRows;
  const sheetName = context.sheetName || 'Sheet1';

  if (!Array.isArray(sheetValues)) {
    throw new Error('Sheet fixture must provide sheetValues[]');
  }
  if (!Array.isArray(reportRows)) {
    throw new Error('Report fixture must provide reportRows[]');
  }

  const currentJson = { values: sheetValues };
  const nodeAccessor = createNodeAccessor({
    'Extract from File': { data: reportRows },
    'Set Credentials': { '✅SHEET_NAME': sheetName },
  });
  const $input = {
    first: () => ({ json: currentJson }),
    all: () => [{ json: currentJson }],
    item: { json: currentJson },
  };

  let executionResult;
  try {
    const fn = new Function('$json', '$input', '$', `${workflowInfo.code}`);
    executionResult = fn(currentJson, $input, nodeAccessor);
  } catch (error) {
    throw new Error(error.message);
  }

  if (!Array.isArray(executionResult) || !executionResult[0] || typeof executionResult[0] !== 'object') {
    throw new Error('Workflow compute node did not return item[] output');
  }

  return executionResult[0].json;
}

async function runWorkflowLocally(options = {}) {
  const workflowPath = path.resolve(options.workflow || DEFAULT_WORKFLOW);
  const reportPath = path.resolve(options.report || DEFAULT_REPORT);
  const sheetPath = path.resolve(options.sheet || DEFAULT_SHEET);
  const mismatchPreviewLimit = Number.isInteger(options.mismatchPreviewLimit)
    ? options.mismatchPreviewLimit
    : DEFAULT_MISMATCH_PREVIEW_LIMIT;

  const summary = {
    workflow: {
      path: workflowPath,
      nodeName: DEFAULT_NODE_NAME,
    },
    inputs: {
      reportPath,
      sheetPath,
      date: options.date || null,
      sheetName: options.sheetName || null,
    },
    compute: {
      status: 'failed',
      localStatus: 'failed',
      workflowStatus: 'failed',
      localError: null,
      workflowError: null,
      mismatchCount: 0,
      mismatchPreview: [],
      reportOnlySkuCount: 0,
      reportOnlySkus: [],
      sheetOnlySkuCount: 0,
      sheetOnlySkus: [],
      updateCount: 0,
      localUpdateCount: 0,
      workflowUpdateCount: 0,
    },
  };

  let workflowInfo;
  try {
    workflowInfo = await readWorkflow(workflowPath, { nodeName: options.nodeName || DEFAULT_NODE_NAME });
    summary.workflow.nodeName = workflowInfo.nodeName;
  } catch (error) {
    summary.compute.workflowError = error.message;
  }

  let reportFixture;
  let sheetFixture;
  try {
    reportFixture = await readJsonFile(reportPath);
    sheetFixture = await readJsonFile(sheetPath);
  } catch (error) {
    const message = `Fixture read failed: ${error.message}`;
    summary.compute.localError = message;
    summary.compute.workflowError = summary.compute.workflowError || message;
    return summary;
  }

  const reportRows = extractReportRows(reportFixture);
  const date = options.date || sheetFixture.date || reportFixture.date || '2026-04-15';
  const sheetName = options.sheetName || sheetFixture.sheetName || 'Sheet1';
  summary.inputs.date = date;
  summary.inputs.sheetName = sheetName;
  summary.inputs.reportRowCount = reportRows.length;

  let sheetContext;
  try {
    sheetContext = extractSheetContext(sheetFixture, sheetName);
    summary.inputs.sheetTargetCount = sheetContext.targets.length;
  } catch (error) {
    const message = error.message;
    summary.compute.localError = message;
    summary.compute.workflowError = summary.compute.workflowError || message;
    return summary;
  }

  let parsedReport;
  let expectedInput;
  let localComputation;
  let localUpdates = [];
  try {
    parsedReport = parseSalesPpcReport(JSON.stringify(reportRows));
    expectedInput = await loadExpectedInput({ sheetFixture, date });
    localComputation = computeSalesPpc({
      parsedReport,
      expectedInput,
      source: 'file',
      tolerance: 0.01,
    });
    const localPayload = buildLocalBatchUpdate({ sheetContext, computation: localComputation });
    localUpdates = normalizeBatchUpdatePayload(localPayload, 'local compute');
    summary.compute.localStatus = 'ok';
    summary.compute.localUpdateCount = localUpdates.length;
  } catch (error) {
    summary.compute.localError = error.message;
  }

  let workflowUpdates = [];
  if (workflowInfo) {
    try {
      const workflowPayload = runWorkflowCompute(workflowInfo, {
        sheetValues: sheetContext.values,
        reportRows,
        sheetName,
      });
      workflowUpdates = normalizeBatchUpdatePayload(workflowPayload, 'workflow compute');
      summary.compute.workflowStatus = 'ok';
      summary.compute.workflowUpdateCount = workflowUpdates.length;
    } catch (error) {
      summary.compute.workflowError = error.message;
    }
  }

  if (parsedReport && sheetContext) {
    const comparison = compareWritebacks({
      localUpdates,
      workflowUpdates,
      sheetContext,
      reportRows,
    });
    summary.compute.mismatchCount = comparison.mismatchCount;
    summary.compute.mismatchPreview = comparison.mismatchPreview.slice(0, Math.max(0, mismatchPreviewLimit));
    summary.compute.reportOnlySkuCount = comparison.reportOnlySkus.length;
    summary.compute.reportOnlySkus = comparison.reportOnlySkus;
    summary.compute.sheetOnlySkuCount = comparison.sheetOnlySkus.length;
    summary.compute.sheetOnlySkus = comparison.sheetOnlySkus;
    summary.compute.updateCount = Math.max(localUpdates.length, workflowUpdates.length);
  }

  if (summary.compute.localStatus === 'ok' && summary.compute.workflowStatus === 'ok') {
    summary.compute.status = 'ok';
  }

  return summary;
}

function parseArgs(argv = []) {
  const options = {
    workflow: DEFAULT_WORKFLOW,
    report: DEFAULT_REPORT,
    sheet: DEFAULT_SHEET,
    json: false,
    mismatchPreviewLimit: DEFAULT_MISMATCH_PREVIEW_LIMIT,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    switch (token) {
      case '--workflow':
        options.workflow = argv[++index];
        break;
      case '--report':
        options.report = argv[++index];
        break;
      case '--sheet':
        options.sheet = argv[++index];
        break;
      case '--date':
        options.date = argv[++index];
        break;
      case '--sheet-name':
        options.sheetName = argv[++index];
        break;
      case '--mismatch-preview-limit':
        options.mismatchPreviewLimit = Number(argv[++index]);
        break;
      case '--json':
        options.json = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  return options;
}

function printHumanSummary(summary) {
  const { compute, workflow, inputs } = summary;
  console.log(`Workflow: ${workflow.path}`);
  console.log(`Node: ${workflow.nodeName}`);
  console.log(`Report fixture: ${inputs.reportPath}`);
  console.log(`Sheet fixture: ${inputs.sheetPath}`);
  console.log(`Date: ${inputs.date}`);
  console.log(`Sheet name: ${inputs.sheetName}`);
  console.log(`Statuses: local=${compute.localStatus} workflow=${compute.workflowStatus}`);
  console.log(`Updates: local=${compute.localUpdateCount} workflow=${compute.workflowUpdateCount}`);
  console.log(`Parity: mismatches=${compute.mismatchCount} reportOnly=${compute.reportOnlySkuCount} sheetOnly=${compute.sheetOnlySkuCount}`);
  if (compute.localError) console.log(`Local error: ${compute.localError}`);
  if (compute.workflowError) console.log(`Workflow error: ${compute.workflowError}`);
  if (compute.mismatchPreview.length > 0) {
    console.log('Mismatch preview:');
    compute.mismatchPreview.forEach((entry) => {
      console.log(`- ${entry.range} sku=${entry.sku} local=${entry.localValue} workflow=${entry.workflowValue} delta=${entry.delta}`);
    });
  }
}

async function main(argv = []) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log('Usage: node run-sales-ppc-workflow-local.js [--json] [--workflow path] [--report path] [--sheet path] [--date YYYY-MM-DD] [--sheet-name name] [--mismatch-preview-limit N]');
    return null;
  }

  const summary = await runWorkflowLocally(options);
  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    printHumanSummary(summary);
  }
  return summary;
}

if (require.main === module) {
  main(process.argv.slice(2))
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

module.exports = {
  readWorkflow,
  runWorkflowCompute,
  runWorkflowLocally,
  main,
};
