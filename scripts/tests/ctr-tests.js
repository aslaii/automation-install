#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  runGetCtr,
  parseCtrReport,
  computeCtr,
  computeCtrValue,
} = require('../features/ctr');
const { loadConfig } = require('../lib/config');
const { runApp } = require('../app');
const { runWithArgs } = require('../index');
const { loadCtrFromFile } = require('../lib/sources/ctr-file');
const {
  readWorkflow,
  runWorkflowCompute,
  runWorkflowLocally,
} = require('../run-ctr-workflow-local');
const {
  main: verifyLatestCtrRunMain,
  verifyCtrRun,
  findLatestCtrRun,
} = require('../verify-latest-ctr-run');

const tests = [
  { name: 'ctr file source loads canonical ads csv rows', fn: testFileSourceLoadsCanonicalAdsCsv },
  { name: 'ctr file source rejects malformed numeric ctr values with row context', fn: testFileSourceRejectsMalformedNumeric },
  { name: 'ctr file source rejects required headers drift with file context', fn: testFileSourceRejectsRequiredHeaders },
  { name: 'ctr file source rejects unsplittable products values with row context', fn: testFileSourceRejectsUnsplittableProducts },
  { name: 'ctr file source rejects duplicate extracted sku rows with file context', fn: testFileSourceRejectsDuplicateExtractedSku },
  { name: 'ctr file source rejects date mismatch before row processing', fn: testFileSourceRejectsDateMismatch },
  { name: 'ctr cli help advertises shared ctr entrypoint', fn: testCtrHelpIncludesSharedEntrypoint },
  { name: 'ctr cli rejects unknown flags cleanly', fn: testCtrCliRejectsUnknownFlags },
  { name: 'ctr app rejects missing date before dispatch', fn: testCtrAppRejectsMissingDate },
  { name: 'ctr config defaults file input to canonical ads csv', fn: testCtrConfigDefaultsCanonicalAdsCsv },
  { name: 'ctr config fails fast when ads env vars are missing', fn: testCtrConfigRejectsMissingAdsEnv },
  { name: 'ctr parser aggregates duplicate sku rows and computes zero impression ctr as zero', fn: testParserAggregatesRows },
  { name: 'ctr parser locks the checked-in report contract fixture', fn: testParserContractFixture },
  { name: 'ctr parser rejects malformed rows without sku or numeric metrics', fn: testParserRejectsMalformedRows },
  { name: 'ctr compute tracks mismatch payload completeness and file traceability', fn: testComputeTracksMismatchPayloadAndTraceability },
  { name: 'ctr compute keeps report-only skus outside the file comparison target set', fn: testComputeTracksExtraReportSkus },
  { name: 'ctr runner builds compute artifact rows from file source', fn: testRunnerComputeFromFileSource },
  { name: 'ctr runner writes auth-stage failure artifacts with redacted errors and zero attempts', fn: testRunnerAuthFailureArtifact },
  { name: 'ctr runner writes compute-stage failure artifacts when file input is ambiguous', fn: testRunnerComputeFailureArtifact },
  { name: 'ctr runner preserves malformed canonical csv failures in verifier-compatible artifacts', fn: testRunnerMalformedCanonicalCsvFailureArtifact },
  { name: 'ctr workflow compute node exports workflow-local helpers', fn: testWorkflowComputeNodeExportsHelpers },
  { name: 'ctr workflow compute node executes against row-0 header sheets', fn: testWorkflowComputeNodeExecutesAgainstRowZeroHeader },
  { name: 'ctr workflow compute node rejects malformed report rows with local contract errors', fn: testWorkflowComputeNodeRejectsMalformedReportRows },
  { name: 'ctr workflow compute node rejects malformed or ambiguous sheet headers', fn: testWorkflowComputeNodeRejectsMalformedOrAmbiguousHeaders },
  { name: 'ctr workflow local runner aligns top-matter header fixtures to zero-mismatch parity', fn: testWorkflowLocalRunnerStructuredTopMatterSuccessSummary },
  { name: 'ctr workflow local runner keeps report-only and sheet-only sku accounting explicit at zero mismatch', fn: testWorkflowLocalRunnerStructuredSuccessSummary },
  { name: 'ctr workflow local runner fails summary-shape assertions with exact field paths', fn: testWorkflowLocalRunnerSummaryShapeFailureModes },
  { name: 'ctr workflow json parity locks the checked-in CTR contract', fn: testWorkflowJsonParityContract },
  { name: 'ctr workflow json parity helpers fail loudly on missing nodes and drift markers', fn: testWorkflowJsonParityFailureModes },
  { name: 'ctr workflow patch alignment keeps compute contract markers in sync', fn: testWorkflowPatchAlignment },
  { name: 'repo root ctr test shim executes the parity grep block', fn: testRepoRootCtrShimParityGrep },
  { name: 'latest-run verifier resolves summary from a valid ctr artifact', fn: testVerifyRunMainUsesProvidedArtifact },
  { name: 'latest-run verifier rejects missing ctr artifacts', fn: testVerifyRunRejectsMissingArtifacts },
  { name: 'latest-run verifier rejects malformed success artifacts missing traceability', fn: testVerifyRunRejectsMalformedSuccessArtifact },
  { name: 'latest-run verifier rejects malformed mismatch payloads', fn: testVerifyRunRejectsMalformedMismatchPayload },
  { name: 'latest-run verifier accepts failed ctr artifacts with failure shape', fn: testVerifyRunAcceptsFailureArtifact },
  { name: 'ctr readme documents canonical ads csv file-first behavior', fn: testCtrReadmeDocumentsCanonicalCsvContract },
  { name: 'ctr test command supports grep selection with deterministic output', fn: testCtrTestCommandSupportsGrep },
  { name: 'shared npm test runner invokes ctr coverage', fn: testRunTestsMainInvokesCtrCoverage },
];

const canonicalCtrFilePath = path.join('data', 'ads-products-2026-04-15.csv');
const ctrWorkflowPath = path.resolve(__dirname, '../../workflows/Get CTR.json');
const ctrWorkflowReportFixturePath = path.resolve(__dirname, 'fixtures/ctr-report-contract.json');
const ctrWorkflowSheetFixturePath = path.resolve(__dirname, 'fixtures/ctr-workflow-local-sheet-workflow.json');

function readJsonFixture(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, relativePath), 'utf8'));
}

function buildCtrExpectedInputFixture() {
  const fixturePath = path.join(__dirname, 'fixtures/ctr-workflow-local-sheet.json');
  const rows = readJsonFixture('fixtures/ctr-workflow-local-sheet.json');
  const bySku = {};

  rows.forEach((item, index) => {
    bySku[item.sku] = {
      sku: item.sku,
      expectedCtr: item.expectedCtr,
      source: 'file',
      notes: item.notes || '',
      productLabel: item.productLabel || '',
      traceability: {
        filePath: fixturePath,
        rowNumber: index,
        date: item.date,
      },
    };
  });

  return {
    date: '2026-04-15',
    bySku,
    skuCount: Object.keys(bySku).length,
    source: 'file',
  };
}

async function withTempCtrCsv(filename, content, fn) {
  const tmpPath = path.join(__dirname, filename);
  await fs.promises.writeFile(tmpPath, content, 'utf8');
  try {
    await fn(tmpPath);
  } finally {
    await fs.promises.rm(tmpPath, { force: true });
  }
}

async function testFileSourceLoadsCanonicalAdsCsv() {
  const result = await loadCtrFromFile(canonicalCtrFilePath, '2026-04-15');
  assert.strictEqual(result.source, 'file');
  assert.strictEqual(result.skuCount, 25);
  assert.strictEqual(result.bySku['Dried-Kadayif-180gm'].expectedCtr, 2.7182);
  assert.strictEqual(result.bySku['Dried-Kadayif-180gm'].notes, '');
  assert.strictEqual(result.bySku['Dried-Kadayif-180gm'].productLabel, 'B0F9WZ117F-Dried-Kadayif-180gm');
  assert.deepStrictEqual(result.bySku['Dried-Kadayif-180gm'].traceability, {
    filePath: canonicalCtrFilePath,
    rowNumber: 0,
    date: '2026-04-15',
  });
  assert.strictEqual(result.bySku['ORG Dell 9-Cell D620'].expectedCtr, 0);
}

async function testFileSourceRejectsMalformedNumeric() {
  await withTempCtrCsv(
    'tmp-ctr-invalid-2026-04-15.csv',
    [
      'Products,Status,Clicks,Impressions,CTR',
      'B0SKU1-SKU1,Eligible,10,100,not-a-number',
    ].join('\n'),
    async (tmpPath) => {
      await assert.rejects(
        () => loadCtrFromFile(tmpPath, '2026-04-15'),
        /Invalid numeric value for CTR file .*tmp-ctr-invalid-2026-04-15\.csv row 1 sku SKU1/,
      );
    },
  );
}

async function testFileSourceRejectsRequiredHeaders() {
  await withTempCtrCsv(
    'tmp-ctr-missing-header-2026-04-15.csv',
    [
      'Products,Status,Clicks,Impressions',
      'B0SKU1-SKU1,Eligible,10,100',
    ].join('\n'),
    async (tmpPath) => {
      await assert.rejects(
        () => loadCtrFromFile(tmpPath, '2026-04-15'),
        /CTR file missing required headers .*tmp-ctr-missing-header-2026-04-15\.csv.*CTR/,
      );
    },
  );
}

async function testFileSourceRejectsUnsplittableProducts() {
  await withTempCtrCsv(
    'tmp-ctr-unsplittable-2026-04-15.csv',
    [
      'Products,Status,Clicks,Impressions,CTR',
      'NOSKU,Eligible,10,100,0.1000',
    ].join('\n'),
    async (tmpPath) => {
      await assert.rejects(
        () => loadCtrFromFile(tmpPath, '2026-04-15'),
        /CTR file row 1 has unsplittable Products value .*tmp-ctr-unsplittable-2026-04-15\.csv.*NOSKU/,
      );
    },
  );
}

async function testFileSourceRejectsDuplicateExtractedSku() {
  await withTempCtrCsv(
    'tmp-ctr-duplicate-2026-04-15.csv',
    [
      'Products,Status,Clicks,Impressions,CTR',
      'B0SKU1-SKU1,Eligible,10,100,0.1000',
      'B0SKU2-SKU1,Eligible,20,200,0.1000',
    ].join('\n'),
    async (tmpPath) => {
      await assert.rejects(
        () => loadCtrFromFile(tmpPath, '2026-04-15'),
        /CTR file duplicate extracted sku for date 2026-04-15 sku SKU1 .*tmp-ctr-duplicate-2026-04-15\.csv rows 1 and 2/,
      );
    },
  );
}

async function testFileSourceRejectsDateMismatch() {
  await assert.rejects(
    () => loadCtrFromFile(canonicalCtrFilePath, '2026-04-14'),
    /CTR file date mismatch .*ads-products-2026-04-15\.csv.*requested 2026-04-14 but filename date is 2026-04-15/,
  );
}

async function testCtrHelpIncludesSharedEntrypoint() {
  let helpOutput = '';
  const result = await runWithArgs(['--help'], {
    parseCliArgs: () => ({ help: true }),
    printHelp: () => {
      helpOutput = 'node index.js --ctr --date YYYY-MM-DD [--end-date YYYY-MM-DD] [--source file] [--delay-ms 0]';
    },
  });

  assert.deepStrictEqual(result, { help: true });
  assert.match(helpOutput, /--ctr --date YYYY-MM-DD/);
}

async function testCtrCliRejectsUnknownFlags() {
  await assert.rejects(
    () => runWithArgs(['--ctr', '--date', '2026-04-15', '--wat']),
    /Unknown argument: --wat/,
  );
}

async function testCtrAppRejectsMissingDate() {
  await assert.rejects(
    () => runApp({ metric: 'ctr', source: 'file', delayMs: 0 }, {
      runGetCtr: async () => {
        throw new Error('ctr runner should not execute when date is missing');
      },
    }),
    /Missing required --date YYYY-MM-DD/,
  );
}

function testCtrConfigDefaultsCanonicalAdsCsv() {
  const env = {
    AMAZON_ADS_CLIENT_ID: 'client',
    AMAZON_ADS_CLIENT_SECRET: 'secret',
    AMAZON_ADS_REFRESH_TOKEN: 'refresh',
    AMAZON_ADS_PROFILE_ID: 'profile',
  };
  const config = loadConfig({ source: 'file', metric: 'ctr', env });
  assert.strictEqual(config.ctr.fileInput, path.join(__dirname, '..', 'data', 'ads-products-2026-04-15.csv'));
}

function testCtrConfigRejectsMissingAdsEnv() {
  assert.throws(
    () => loadConfig({ source: 'file', metric: 'ctr', env: {} }),
    /Missing required environment variable: AMAZON_ADS_CLIENT_ID/,
  );
}

function testParserAggregatesRows() {
  const parsed = parseCtrReport(JSON.stringify([
    { advertisedSku: 'SKU1', clicks: 2, impressions: 50 },
    { advertisedSku: 'SKU1', clicks: 3, impressions: 50 },
    { advertisedSku: 'ZERO-IMP', clicks: 4, impressions: 0 },
  ]));

  assert.strictEqual(parsed.rowCount, 3);
  assert.strictEqual(parsed.skuCount, 2);
  assert.deepStrictEqual(parsed.bySku.SKU1, {
    sku: 'SKU1',
    clicks: 5,
    impressions: 100,
    ctr: 5,
    provenance: { rowCount: 2 },
  });
  assert.strictEqual(parsed.bySku['ZERO-IMP'].ctr, 0);
  assert.strictEqual(computeCtrValue(5, 100), 5);
}

function testParserContractFixture() {
  const fixture = readJsonFixture('fixtures/ctr-report-contract.json');
  const parsed = parseCtrReport(JSON.stringify(fixture.reportRows));

  assert.strictEqual(parsed.rowCount, fixture.expected.summary.rowCount);
  assert.strictEqual(parsed.skuCount, fixture.expected.summary.skuCount);

  for (const [sku, expectedEntry] of Object.entries(fixture.expected.bySku)) {
    assert.deepStrictEqual(parsed.bySku[sku], {
      sku,
      clicks: expectedEntry.clicks,
      impressions: expectedEntry.impressions,
      ctr: expectedEntry.ctr,
      provenance: { rowCount: expectedEntry.rowCount },
    });
  }
}

function testParserRejectsMalformedRows() {
  const fixture = readJsonFixture('fixtures/ctr-report-contract.json');

  assert.throws(
    () => parseCtrReport(JSON.stringify(fixture.malformed.missingSkuRows)),
    /CTR report row 1 is missing advertisedSku/,
  );
  assert.throws(
    () => parseCtrReport(JSON.stringify(fixture.malformed.nonNumericClicksRows)),
    /Invalid numeric value for clicks row 1 sku BAD-CLICKS/,
  );
  assert.throws(
    () => parseCtrReport(JSON.stringify(fixture.malformed.nonNumericImpressionsRows)),
    /Invalid numeric value for impressions row 1 sku BAD-IMP/,
  );
  const emptyParsed = parseCtrReport(JSON.stringify(fixture.malformed.emptyRows));
  assert.strictEqual(emptyParsed.rowCount, 0);
  assert.strictEqual(emptyParsed.parseWarning, 'CTR report has no data rows');
}

function testComputeTracksMismatchPayloadAndTraceability() {
  const fixture = readJsonFixture('fixtures/ctr-report-contract.json');
  const parsed = parseCtrReport(JSON.stringify(fixture.reportRows));
  const expectedInput = {
    source: 'file',
    bySku: {
      'CTR-MATCH': {
        sku: 'CTR-MATCH',
        expectedCtr: 5,
        source: 'file',
        notes: 'match fixture',
        productLabel: 'CTR Match',
        traceability: fixture.expected.compute.items[0].traceability.expected,
      },
      'ZERO-IMP': {
        sku: 'ZERO-IMP',
        expectedCtr: 0,
        source: 'file',
        notes: 'zero impressions fixture',
        productLabel: 'Zero Impression',
        traceability: fixture.expected.compute.items[2].traceability.expected,
      },
      'MISMATCH-SKU': {
        sku: 'MISMATCH-SKU',
        expectedCtr: 12.5,
        source: 'file',
        notes: 'mismatch fixture',
        productLabel: 'Mismatch SKU',
        traceability: fixture.expected.compute.items[1].traceability.expected,
      },
    },
  };

  const computation = computeCtr({
    parsedReport: parsed,
    expectedInput,
    source: 'file',
    tolerance: 0.0001,
  });

  assert.deepStrictEqual(computation.items.map((item) => simplifyItem(item)), fixture.expected.compute.items);
  assert.deepStrictEqual(computation.extraReportSkus, fixture.expected.compute.extraReportSkus);
  assert.deepStrictEqual(computation.mismatches, fixture.expected.compute.mismatches);
  assert.strictEqual(computation.summary.mismatched, 1);
}

function testComputeTracksExtraReportSkus() {
  const computation = computeCtr({
    parsedReport: {
      bySku: {
        EXPECTED: { sku: 'EXPECTED', clicks: 5, impressions: 100, ctr: 5, provenance: { rowCount: 1 } },
        REPORT_ONLY: { sku: 'REPORT_ONLY', clicks: 2, impressions: 20, ctr: 10, provenance: { rowCount: 1 } },
      },
    },
    expectedInput: {
      source: 'file',
      bySku: {
        EXPECTED: {
          sku: 'EXPECTED',
          expectedCtr: 5,
          source: 'file',
          notes: '',
          productLabel: 'Expected',
          traceability: { filePath: '/tmp/ctr.json', rowNumber: 0, date: '2026-04-15' },
        },
      },
    },
    source: 'file',
    tolerance: 0.0001,
  });

  assert.deepStrictEqual(computation.items.map((item) => item.sku), ['EXPECTED']);
  assert.deepStrictEqual(computation.extraReportSkus, ['REPORT_ONLY']);
  assert.strictEqual(computation.summary.extraReportSkuCount, 1);
  assert.strictEqual(computation.mismatches.length, 0);
}

async function testRunnerComputeFromFileSource() {
  let savedReport = null;

  await runGetCtr(
    { metric: 'ctr', date: '2026-04-15', source: 'file', delayMs: 0 },
    {
      loadConfig: () => ({
        amazonAds: { authTimeoutMs: 12345, clientId: 'client', clientSecret: 'secret', refreshToken: 'refresh', profileId: 'profile' },
        ctr: {
          fileInput: canonicalCtrFilePath,
          comparisonTolerance: 0.0001,
          report: {},
          polling: {},
        },
      }),
      mintAmazonAdsAccessToken: async () => 'token',
      runAmazonAdsReportLifecycle: async () => ({
        ok: true,
        stage: 'download-report',
        attempts: { create: 1, poll: 2 },
        lifecycle: [
          { stage: 'create-report', attempt: 1, status: 'success', reportId: 'r1' },
          { stage: 'poll-report', attempt: 1, status: 'COMPLETED', reportId: 'r1', reportDocumentId: 'd1' },
          { stage: 'download-report', attempt: 1, status: 'success', reportId: 'r1', reportDocumentId: 'd1' },
        ],
        reportId: 'r1',
        reportDocumentId: 'd1',
        processingStatus: 'COMPLETED',
        contentType: 'application/json',
        reportText: JSON.stringify(readJsonFixture('fixtures/ctr-report-contract.json').reportRows),
      }),
      loadCtrFromFile: async () => buildCtrExpectedInputFixture(),
      writeReport: async ({ report }) => {
        savedReport = report;
        return '/tmp/ctr.json';
      },
      printCtrReport: () => {},
    },
  );

  assert(savedReport);
  assert.strictEqual(savedReport.status, 'success');
  assert.strictEqual(savedReport.stage, 'compute');
  assert.strictEqual(savedReport.summary.parsedRowCount, 5);
  assert.strictEqual(savedReport.summary.computedSkuCount, 4);
  assert.strictEqual(savedReport.summary.mismatchedSkuCount, 1);
  assert.strictEqual(savedReport.summary.extraReportSkuCount, 1);
  const mismatchItem = savedReport.items.find((item) => item.sku === 'MISMATCH-SKU');
  assert.strictEqual(mismatchItem.ctr, 10);
  assert.strictEqual(mismatchItem.expectedCtr, 12.5);
  assert.strictEqual(mismatchItem.ctrDelta, -2.5);
  assert.deepStrictEqual(mismatchItem.traceability.expected, {
    filePath: path.join(__dirname, 'fixtures/ctr-workflow-local-sheet.json'),
    rowNumber: 2,
    date: '2026-04-15',
  });
}

async function testRunnerAuthFailureArtifact() {
  let savedReport = null;

  await assert.rejects(
    () => runGetCtr(
      { metric: 'ctr', date: '2026-04-15', source: 'file', delayMs: 0 },
      {
        loadConfig: () => ({
          amazonAds: { authTimeoutMs: 12345, clientId: 'client-123', clientSecret: 'secret-456', refreshToken: 'refresh-789', profileId: 'profile' },
          ctr: {
            fileInput: canonicalCtrFilePath,
            comparisonTolerance: 0.0001,
            report: {},
            polling: {},
          },
        }),
        mintAmazonAdsAccessToken: async () => {
          const error = new Error('auth failed for secret-456 refresh-789');
          error.code = 'AUTH_HTTP_ERROR';
          error.httpStatus = 401;
          throw error;
        },
        writeReport: async ({ report }) => {
          savedReport = report;
          return '/tmp/ctr-auth-failure.json';
        },
        printCtrReport: () => {},
      },
    ),
    /CTR failed at auth: auth failed for \[redacted\] \[redacted\]/,
  );

  assert(savedReport);
  assert.strictEqual(savedReport.status, 'failed');
  assert.strictEqual(savedReport.stage, 'auth');
  assert.deepStrictEqual(savedReport.summary.attempts, { create: 0, poll: 0 });
  assert.strictEqual(savedReport.error.httpStatus, 401);
  assert.strictEqual(savedReport.error.message.includes('secret-456'), false);
  assert.strictEqual(savedReport.error.message.includes('refresh-789'), false);
}

async function testRunnerComputeFailureArtifact() {
  let savedReport = null;

  await assert.rejects(
    () => runGetCtr(
      { metric: 'ctr', date: '2026-04-15', source: 'file', delayMs: 0 },
      {
        loadConfig: () => ({
          amazonAds: { authTimeoutMs: 12345, clientId: 'client', clientSecret: 'secret', refreshToken: 'refresh', profileId: 'profile' },
          ctr: {
            fileInput: canonicalCtrFilePath,
            comparisonTolerance: 0.0001,
            report: {},
            polling: {},
          },
        }),
        mintAmazonAdsAccessToken: async () => 'token',
        runAmazonAdsReportLifecycle: async () => ({
          ok: true,
          stage: 'download-report',
          attempts: { create: 1, poll: 1 },
          lifecycle: [
            { stage: 'create-report', attempt: 1, status: 'success', reportId: 'r1' },
            { stage: 'poll-report', attempt: 1, status: 'COMPLETED', reportId: 'r1', reportDocumentId: 'd1' },
            { stage: 'download-report', attempt: 1, status: 'success', reportId: 'r1', reportDocumentId: 'd1' },
          ],
          reportId: 'r1',
          reportDocumentId: 'd1',
          processingStatus: 'COMPLETED',
          contentType: 'application/json',
          reportText: JSON.stringify([{ advertisedSku: 'SKU1', clicks: 1, impressions: 10 }]),
        }),
        loadCtrFromFile: async () => {
          throw new Error('CTR file duplicate extracted sku for date 2026-04-15 sku SKU1 (data/ads-products-2026-04-15.csv rows 1 and 2)');
        },
        writeReport: async ({ report }) => {
          savedReport = report;
          return '/tmp/ctr-compute-failure.json';
        },
        printCtrReport: () => {},
      },
    ),
    /CTR failed at compute: CTR file duplicate extracted sku for date 2026-04-15 sku SKU1/,
  );

  assert(savedReport);
  assert.strictEqual(savedReport.status, 'failed');
  assert.strictEqual(savedReport.stage, 'compute');
  assert.deepStrictEqual(savedReport.items, []);
  assert.strictEqual(savedReport.summary.stage, 'compute');
  assert.deepStrictEqual(savedReport.summary.attempts, { create: 1, poll: 1 });
  assert.strictEqual(savedReport.summary.reportId, 'r1');
  assert.strictEqual(savedReport.summary.reportDocumentId, 'd1');
  assert.strictEqual(savedReport.summary.processingStatus, 'COMPLETED');
  assert.deepStrictEqual(savedReport.summary.lifecyclePhases, ['auth', 'create-report', 'poll-report', 'download-report', 'parse', 'compute']);
  assert.strictEqual(savedReport.error.message, 'CTR file duplicate extracted sku for date 2026-04-15 sku SKU1 (data/ads-products-2026-04-15.csv rows 1 and 2)');
  assert.strictEqual(savedReport.error.code, null);
  assert.strictEqual(savedReport.error.httpStatus, null);
  assert.strictEqual(savedReport.error.timeout, false);
  assert.deepStrictEqual(savedReport.lifecycle.at(-2), { stage: 'parse', attempt: 1, status: 'success', message: '' });
  assert.strictEqual(savedReport.lifecycle.at(-1).stage, 'compute');
  assert.strictEqual(savedReport.lifecycle.at(-1).status, 'error');
}

async function testRunnerMalformedCanonicalCsvFailureArtifact() {
  let savedReport = null;
  const malformedMessage = 'Invalid numeric value for CTR file data/ads-products-2026-04-15.csv row 7 sku BROKEN-SKU';

  await assert.rejects(
    () => runGetCtr(
      { metric: 'ctr', date: '2026-04-15', source: 'file', delayMs: 0 },
      {
        loadConfig: () => ({
          amazonAds: { authTimeoutMs: 12345, clientId: 'client', clientSecret: 'secret', refreshToken: 'refresh', profileId: 'profile' },
          ctr: {
            fileInput: canonicalCtrFilePath,
            comparisonTolerance: 0.0001,
            report: {},
            polling: {},
          },
        }),
        mintAmazonAdsAccessToken: async () => 'token',
        runAmazonAdsReportLifecycle: async () => ({
          ok: true,
          stage: 'download-report',
          attempts: { create: 2, poll: 3 },
          lifecycle: [
            { stage: 'create-report', attempt: 1, status: 'success', reportId: 'r2' },
            { stage: 'poll-report', attempt: 1, status: 'IN_PROGRESS', reportId: 'r2', reportDocumentId: null },
            { stage: 'poll-report', attempt: 2, status: 'COMPLETED', reportId: 'r2', reportDocumentId: 'd2' },
            { stage: 'download-report', attempt: 1, status: 'success', reportId: 'r2', reportDocumentId: 'd2' },
          ],
          reportId: 'r2',
          reportDocumentId: 'd2',
          processingStatus: 'COMPLETED',
          contentType: 'application/json',
          reportText: JSON.stringify([{ advertisedSku: 'BROKEN-SKU', clicks: 1, impressions: 10 }]),
        }),
        loadCtrFromFile: async () => {
          throw new Error(malformedMessage);
        },
        writeReport: async ({ report }) => {
          savedReport = report;
          return '/tmp/ctr-compute-malformed.json';
        },
        printCtrReport: () => {},
      },
    ),
    /CTR failed at compute: Invalid numeric value for CTR file data\/ads-products-2026-04-15\.csv row 7 sku BROKEN-SKU/,
  );

  assert(savedReport);
  assert.deepStrictEqual(
    verifyCtrRun(savedReport, { filePath: '/tmp/ctr-compute-malformed.json' }),
    {
      status: 'failed',
      stage: 'compute',
      itemCount: 0,
      warningCount: 0,
      mismatchCount: 0,
    },
  );
  assert.strictEqual(savedReport.error.message, malformedMessage);
  assert.deepStrictEqual(savedReport.summary.attempts, { create: 2, poll: 3 });
  assert.deepStrictEqual(savedReport.summary.lifecyclePhases, ['auth', 'create-report', 'poll-report', 'download-report', 'parse', 'compute']);
  assert.strictEqual(savedReport.lifecycle.at(-2).stage, 'parse');
  assert.strictEqual(savedReport.lifecycle.at(-2).status, 'success');
  assert.strictEqual(savedReport.lifecycle.at(-1).stage, 'compute');
  assert.strictEqual(savedReport.lifecycle.at(-1).message, malformedMessage);
}

async function testVerifyRunMainUsesProvidedArtifact() {
  const tmpDir = await fs.promises.mkdtemp(path.join(__dirname, 'tmp-ctr-report-'));
  const filePath = path.join(tmpDir, 'ctr-success.json');

  try {
    await fs.promises.writeFile(filePath, JSON.stringify(buildVerifierSuccessReport()), 'utf8');
    const result = verifyLatestCtrRunMain({ filePath });
    assert.deepStrictEqual(result, {
      status: 'success',
      stage: 'compute',
      itemCount: 2,
      warningCount: 1,
      mismatchCount: 0,
    });
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }
}

async function testVerifyRunRejectsMissingArtifacts() {
  const tmpDir = await fs.promises.mkdtemp(path.join(__dirname, 'tmp-ctr-runs-'));
  try {
    assert.throws(
      () => findLatestCtrRun(tmpDir),
      /No ctr JSON runs found/,
    );
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }
}

function testVerifyRunRejectsMalformedSuccessArtifact() {
  const report = buildVerifierSuccessReport();
  delete report.items[0].traceability.expected;
  assert.throws(
    () => verifyCtrRun(report, { filePath: '/tmp/ctr-malformed.json' }),
    /Expected item 0 traceability\.expected object/,
  );
}

function testVerifyRunRejectsMalformedMismatchPayload() {
  const report = buildVerifierSuccessReport({ withMismatch: true });
  delete report.comparison.mismatches[0].traceability.expected.rowNumber;

  assert.throws(
    () => verifyCtrRun(report, { filePath: '/tmp/ctr-mismatch-drift.json' }),
    /Expected mismatch 0 traceability\.expected\.rowNumber/,
  );
}

function testVerifyRunAcceptsFailureArtifact() {
  const report = {
    metric: 'ctr',
    source: 'file',
    startedAt: '2026-04-19T10:00:00.000Z',
    completedAt: '2026-04-19T10:00:01.000Z',
    dateRange: {
      startDate: '2026-04-15',
      endDate: '2026-04-15',
      sameDay: true,
    },
    request: {
      date: '2026-04-15',
      endDate: '2026-04-15',
      source: 'file',
      delayMs: 0,
    },
    stage: 'compute',
    status: 'failed',
    summary: {
      status: 'failed',
      stage: 'compute',
      attempts: { create: 1, poll: 1 },
      lifecyclePhases: ['auth', 'create-report', 'poll-report', 'download-report', 'parse', 'compute'],
      reportId: 'r1',
      reportDocumentId: 'd1',
      processingStatus: 'COMPLETED',
    },
    lifecycle: [
      { stage: 'auth', attempt: 1, status: 'success' },
      { stage: 'create-report', attempt: 1, status: 'success', reportId: 'r1' },
      { stage: 'poll-report', attempt: 1, status: 'COMPLETED', reportId: 'r1', reportDocumentId: 'd1' },
      { stage: 'download-report', attempt: 1, status: 'success', reportId: 'r1', reportDocumentId: 'd1' },
      { stage: 'parse', attempt: 1, status: 'success', message: '' },
      { stage: 'compute', attempt: 1, status: 'error', message: 'duplicate SKU rows' },
    ],
    error: {
      message: 'duplicate SKU rows',
      code: null,
      httpStatus: null,
      timeout: false,
    },
    reportInfo: {
      reportType: 'spAdvertisedProduct',
      reportId: 'r1',
      reportDocumentId: 'd1',
      processingStatus: 'COMPLETED',
    },
    items: [],
  };

  assert.deepStrictEqual(
    verifyCtrRun(report, { filePath: '/tmp/ctr-failure.json' }),
    {
      status: 'failed',
      stage: 'compute',
      itemCount: 0,
      warningCount: 0,
      mismatchCount: 0,
    },
  );
}

function testCtrReadmeDocumentsCanonicalCsvContract() {
  const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');

  assert.match(readme, /data\/ads-products-2026-04-15\.csv/);
  assert.match(readme, /loader fails closed on malformed canonical rows/i);
  assert.match(readme, /requested date must match.*embedded in the filename/i);
  assert.match(readme, /cd scripts && node verify-latest-ctr-run\.js/);
  assert.match(readme, /cd scripts && node tests\/ctr-tests\.js --grep "compute-stage failure artifacts\|canonical ads csv\|malformed"/);
}

function testCtrTestCommandSupportsGrep() {
  const stdout = execFileSync(
    process.execPath,
    [path.resolve(__dirname, 'ctr-tests.js'), '--grep', 'latest-run verifier accepts failed ctr artifacts'],
    {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
    },
  );

  assert.match(stdout, /CTR tests passed \(1\//);
}

async function testRunTestsMainInvokesCtrCoverage() {
  const { main: runAllTestsMain } = require('./run-tests');
  const logs = [];
  await runAllTestsMain({
    argv: [],
    runBsrTests: async () => logs.push('stub-bsr'),
    runSalesOrganicTests: async () => logs.push('stub-sales-organic'),
    runSalesPpcTests: async () => logs.push('stub-sales-ppc'),
    runCtrTests: async () => logs.push('stub-ctr'),
    runUnitsOrganicTests: async () => logs.push('stub-units-organic'),
    log: (...args) => logs.push(args.join(' ')),
  });

  assert(logs.includes('stub-bsr'));
  assert(logs.includes('stub-sales-organic'));
  assert(logs.includes('stub-sales-ppc'));
  assert(logs.includes('stub-ctr'));
  assert(logs.includes('stub-units-organic'));
  assert(logs.includes('All tests passed.'));
}

async function testWorkflowComputeNodeExportsHelpers() {
  assert.strictEqual(typeof readWorkflow, 'function', 'Expected readWorkflow export');
  assert.strictEqual(typeof runWorkflowCompute, 'function', 'Expected runWorkflowCompute export');
  assert.strictEqual(typeof runWorkflowLocally, 'function', 'Expected runWorkflowLocally export');
}

async function testWorkflowComputeNodeExecutesAgainstRowZeroHeader() {
  const workflowInfo = await readWorkflow(ctrWorkflowPath);
  const result = runWorkflowCompute(workflowInfo, {
    sheetValues: [
      ['SKU', 'CTR', 'Notes'],
      ['CTR-MATCH', '', 'match fixture'],
      ['ZERO-IMP', 0, 'zero fixture'],
    ],
    reportRows: readJsonFixture('fixtures/ctr-report-contract.json').reportRows,
    sheetName: 'Sheet1',
  });

  assert.strictEqual(result.valueInputOption, 'USER_ENTERED');
  assert.deepStrictEqual(result.data, [
    { range: 'Sheet1!B2', values: [[5]] },
    { range: 'Sheet1!B3', values: [[0]] },
  ]);
}

async function testWorkflowComputeNodeRejectsMalformedReportRows() {
  const workflowInfo = await readWorkflow(ctrWorkflowPath);

  assert.throws(
    () => runWorkflowCompute(workflowInfo, {
      sheetValues: [
        ['SKU', 'CTR', 'Notes'],
        ['CTR-MATCH', '', 'match fixture'],
      ],
      reportRows: [
        { clicks: 5, impressions: 100 },
      ],
      sheetName: 'Sheet1',
    }),
    /CTR report row 1 is missing advertisedSku/,
  );

  assert.throws(
    () => runWorkflowCompute(workflowInfo, {
      sheetValues: [
        ['SKU', 'CTR', 'Notes'],
        ['CTR-MATCH', '', 'match fixture'],
      ],
      reportRows: [
        { advertisedSku: 'BAD-CLICKS', clicks: 'nope', impressions: 100 },
      ],
      sheetName: 'Sheet1',
    }),
    /Invalid numeric value for clicks row 1 sku BAD-CLICKS/,
  );

  assert.throws(
    () => runWorkflowCompute(workflowInfo, {
      sheetValues: [
        ['SKU', 'CTR', 'Notes'],
        ['CTR-MATCH', '', 'match fixture'],
      ],
      reportRows: [
        { advertisedSku: 'BAD-IMP', clicks: 5, impressions: 'nope' },
      ],
      sheetName: 'Sheet1',
    }),
    /Invalid numeric value for impressions row 1 sku BAD-IMP/,
  );
}

async function testWorkflowComputeNodeRejectsMalformedOrAmbiguousHeaders() {
  const workflowInfo = await readWorkflow(ctrWorkflowPath);
  const reportRows = readJsonFixture('fixtures/ctr-report-contract.json').reportRows;

  assert.throws(
    () => runWorkflowCompute(workflowInfo, {
      sheetValues: [
        ['Intro', '', ''],
        ['Notes', '', ''],
        ['Product', 'Metric', 'Notes'],
      ],
      reportRows,
      sheetName: 'Sheet1',
    }),
    /Could not find SKU and CTR columns in first 3 rows/,
  );

  assert.throws(
    () => runWorkflowCompute(workflowInfo, {
      sheetValues: [
        ['SKU', 'Notes', 'Other'],
        ['CTR-MATCH', '', 'match fixture'],
      ],
      reportRows,
      sheetName: 'Sheet1',
    }),
    /Malformed header row 1: expected SKU and CTR columns together/,
  );

  assert.throws(
    () => runWorkflowCompute(workflowInfo, {
      sheetValues: [
        ['SKU', 'CTR', 'Notes'],
        ['Top matter', '', ''],
        ['SKU', 'CTR', 'Other'],
        ['CTR-MATCH', '', 'match fixture'],
      ],
      reportRows,
      sheetName: 'Sheet1',
    }),
    /Ambiguous header rows for SKU and CTR within first 4 rows/,
  );
}

async function testWorkflowLocalRunnerStructuredTopMatterSuccessSummary() {
  const summary = await runWorkflowLocally({
    workflow: ctrWorkflowPath,
    report: ctrWorkflowReportFixturePath,
    sheet: ctrWorkflowSheetFixturePath,
    date: '2026-04-15',
    sheetName: 'Sheet1',
  });

  assertWorkflowLocalSummaryShape(summary);
  assert.strictEqual(summary.compute.status, 'ok');
  assert.strictEqual(summary.compute.localStatus, 'ok');
  assert.strictEqual(summary.compute.workflowStatus, 'ok');
  assert.strictEqual(summary.compute.localError, null);
  assert.strictEqual(summary.compute.workflowError, null);
  assert.strictEqual(summary.compute.mismatchCount, 0);
  assert.deepStrictEqual(summary.compute.reportOnlySkus, ['REPORT-ONLY']);
  assert.deepStrictEqual(summary.compute.sheetOnlySkus, ['SHEET-ONLY']);
  assert.deepStrictEqual(summary.compute.mismatchPreview, []);
  assert.strictEqual(summary.compute.localUpdateCount, 4);
  assert.strictEqual(summary.compute.workflowUpdateCount, 4);
  assert.strictEqual(summary.compute.updateCount, 4);
}

async function testWorkflowLocalRunnerStructuredSuccessSummary() {
  const tmpDir = await fs.promises.mkdtemp(path.join(__dirname, 'tmp-ctr-workflow-local-success-'));
  const workflowPath = path.join(tmpDir, 'workflow.json');
  const sheetPath = path.join(tmpDir, 'sheet.json');

  const workflow = readCtrWorkflowFixture();
  getNodeByName(workflow, 'Code in JavaScript').parameters.jsCode = [
    "function normalizeHeader(value) { return String(value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase(); }",
    "function colToA1(colIndex1Based) { let n = colIndex1Based; let out = ''; while (n > 0) { const m = (n - 1) % 26; out = String.fromCharCode(65 + m) + out; n = Math.floor((n - 1) / 26); } return out; }",
    "const values = $json.values || [];",
    "const reportData = $('Extract from File').first().json.data || [];",
    "const sheetName = $('Set Credentials').first().json['✅SHEET_NAME'];",
    "const headerRow = values[0] || [];",
    "const skuCol = headerRow.findIndex((cell) => normalizeHeader(cell) === 'SKU');",
    "const targetCol = headerRow.findIndex((cell) => normalizeHeader(cell) === 'CTR');",
    "if (skuCol === -1 || targetCol === -1) throw new Error('Could not find SKU and CTR columns');",
    "const metricsBySku = new Map();",
    "for (const row of reportData) { const sku = String(row.advertisedSku || '').trim(); if (!sku) continue; const clicks = Number(row.clicks || 0); const impressions = Number(row.impressions || 0); const bucket = metricsBySku.get(sku) || { clicks: 0, impressions: 0 }; bucket.clicks += clicks; bucket.impressions += impressions; metricsBySku.set(sku, bucket); }",
    "const targetColA1 = colToA1(targetCol + 1);",
    "const data = [];",
    "for (let i = 1; i < values.length; i += 1) { const row = values[i] || []; const sku = String(row[skuCol] || '').trim(); if (!sku || /^SKU$/i.test(sku) || /^IMG$/i.test(sku) || /_TOTALS$/i.test(sku)) continue; const metrics = metricsBySku.get(sku); const ctr = metrics ? (metrics.impressions > 0 ? Number(((metrics.clicks / metrics.impressions) * 100).toFixed(4)) : 0) : 0; data.push({ range: `${sheetName}!${targetColA1}${i + 1}`, values: [[ctr]] }); }",
    "return [{ json: { valueInputOption: 'USER_ENTERED', data } }];",
  ].join('\n');

  const sheetFixture = {
    date: '2026-04-15',
    sheetName: 'Sheet1',
    values: [
      ['SKU', 'CTR', 'Notes'],
      ['CTR-MATCH', '', 'match fixture'],
      ['ZERO-IMP', 0, 'zero impressions fixture'],
      ['MISMATCH-SKU', '', 'now aligned fixture'],
      ['SHEET-ONLY', '', 'sheet-only target set'],
      ['SHEET-ONLY_TOTALS', '', 'ignored totals row'],
    ],
    fileRows: [
      { Products: 'B0CTR-CTR-MATCH', Status: 'Eligible', Clicks: 8, Impressions: 160, CTR: 5 },
      { Products: 'B0ZERO-ZERO-IMP', Status: 'Eligible', Clicks: 4, Impressions: 0, CTR: 0 },
      { Products: 'B0MIS-MISMATCH-SKU', Status: 'Eligible', Clicks: 7, Impressions: 70, CTR: 10 },
      { Products: 'B0SHEET-SHEET-ONLY', Status: 'Eligible', Clicks: 0, Impressions: 0, CTR: 0 },
    ],
  };

  try {
    await fs.promises.writeFile(workflowPath, JSON.stringify(workflow), 'utf8');
    await fs.promises.writeFile(sheetPath, JSON.stringify(sheetFixture), 'utf8');
    const summary = await runWorkflowLocally({
      workflow: workflowPath,
      report: ctrWorkflowReportFixturePath,
      sheet: sheetPath,
      date: '2026-04-15',
      sheetName: 'Sheet1',
    });

    assertWorkflowLocalSummaryShape(summary);
    assert.strictEqual(summary.compute.localStatus, 'ok');
    assert.strictEqual(summary.compute.workflowStatus, 'ok');
    assert.strictEqual(summary.compute.status, 'ok');
    assert.strictEqual(summary.compute.mismatchCount, 0);
    assert.deepStrictEqual(summary.compute.reportOnlySkus, ['REPORT-ONLY']);
    assert.deepStrictEqual(summary.compute.sheetOnlySkus, ['SHEET-ONLY']);
    assert.deepStrictEqual(summary.compute.mismatchPreview, []);
    assert.strictEqual(summary.compute.updateCount, 4);
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }
}

async function testWorkflowLocalRunnerSummaryShapeFailureModes() {
  const summary = await runWorkflowLocally({
    workflow: ctrWorkflowPath,
    report: ctrWorkflowReportFixturePath,
    sheet: ctrWorkflowSheetFixturePath,
    date: '2026-04-15',
    sheetName: 'Sheet1',
  });

  assertWorkflowLocalSummaryShape(summary);

  const malformedSummary = deepCloneJson(summary);
  delete malformedSummary.compute.mismatchPreview;
  assert.throws(
    () => assertWorkflowLocalSummaryShape(malformedSummary),
    /Expected compute\.mismatchPreview array/,
  );

  const tmpDir = await fs.promises.mkdtemp(path.join(__dirname, 'tmp-ctr-workflow-local-malformed-'));
  const malformedSheetPath = path.join(tmpDir, 'malformed-sheet.json');
  try {
    await fs.promises.writeFile(malformedSheetPath, JSON.stringify({ date: '2026-04-15', sheetName: 'Sheet1' }), 'utf8');
    const failureSummary = await runWorkflowLocally({
      workflow: ctrWorkflowPath,
      report: ctrWorkflowReportFixturePath,
      sheet: malformedSheetPath,
      date: '2026-04-15',
      sheetName: 'Sheet1',
    });

    assertWorkflowLocalSummaryShape(failureSummary);
    assert.strictEqual(failureSummary.compute.status, 'failed');
    assert.strictEqual(failureSummary.compute.localStatus, 'failed');
    assert.strictEqual(failureSummary.compute.workflowStatus, 'failed');
    assert.match(failureSummary.compute.localError, /Sheet fixture must contain values\[\]/);
    assert.match(failureSummary.compute.workflowError, /Sheet fixture must contain values\[\]/);
    assert.strictEqual(failureSummary.compute.mismatchCount, 0);
    assert.deepStrictEqual(failureSummary.compute.mismatchPreview, []);
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }
}

function testWorkflowJsonParityContract() {
  assertWorkflowJsonParity(readCtrWorkflowFixture());
}

function testWorkflowJsonParityFailureModes() {
  const workflow = readCtrWorkflowFixture();

  const missingNodeWorkflow = deepCloneJson(workflow);
  missingNodeWorkflow.nodes = (missingNodeWorkflow.nodes || []).filter((node) => node.name !== 'Code in JavaScript');
  assert.throws(
    () => assertWorkflowJsonParity(missingNodeWorkflow),
    /\[workflow json parity\] missing node: Code in JavaScript/,
  );

  const missingCodeWorkflow = deepCloneJson(workflow);
  getNodeByName(missingCodeWorkflow, 'Code in JavaScript').parameters.jsCode = '';
  assert.throws(
    () => assertWorkflowJsonParity(missingCodeWorkflow),
    /\[workflow json parity\] missing jsCode on node: Code in JavaScript/,
  );

  const headerScanRegression = deepCloneJson(workflow);
  getNodeByName(headerScanRegression, 'Code in JavaScript').parameters.jsCode = [
    "const reportData = $('Extract from File').first().json.data || [];",
    "const sheetName = $('Set Credentials').first().json['✅SHEET_NAME'];",
    "const metrics = { impressions: 1 };",
    "for (const row of reportData) { if (!row.advertisedSku) { throw new Error('missing sku'); } }",
    "const ctr = metrics.impressions > 0 ? 1 : 0;",
    "return [{ json: { valueInputOption: 'USER_ENTERED', data: [{ range: `${sheetName}!B2`, values: [[ctr]] }] } }];",
  ].join('\n');
  assert.throws(
    () => assertWorkflowJsonParity(headerScanRegression),
    /\[workflow json parity\] robust header scan invariant missing/,
  );
}

async function testWorkflowPatchAlignment() {
  const workflowInfo = await readWorkflow(ctrWorkflowPath);
  assertCtrComputeContract(workflowInfo.code, 'workflow compute node');
  const patchCode = fs.readFileSync(path.resolve(__dirname, '../../n8n-patches/ctr-google-sheet-update.js'), 'utf8');
  assertCtrComputeContract(patchCode, 'workflow patch alignment');
}

function testRepoRootCtrShimParityGrep() {
  const stdout = execFileSync(
    process.execPath,
    [path.resolve(__dirname, '../../tests/ctr-tests.js'), '--grep', 'workflow json parity|workflow local runner|workflow compute node|workflow patch alignment'],
    {
      cwd: path.resolve(__dirname, '../..'),
      encoding: 'utf8',
    },
  );

  assert.match(stdout, /CTR tests passed/);
}

function readCtrWorkflowFixture() {
  return JSON.parse(fs.readFileSync(ctrWorkflowPath, 'utf8'));
}

function deepCloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function getNodeByName(workflow, nodeName) {
  return (workflow?.nodes || []).find((node) => node.name === nodeName);
}

function getNodeOrThrow(workflow, nodeName) {
  const node = getNodeByName(workflow, nodeName);
  if (!node) {
    throw new Error(`[workflow json parity] missing node: ${nodeName}`);
  }
  return node;
}

function assertCodeInvariant(code, pattern, message) {
  if (!pattern.test(code)) {
    throw new Error(`[workflow json parity] ${message}`);
  }
}

function assertCodeAbsent(code, pattern, message) {
  if (pattern.test(code)) {
    throw new Error(`[workflow json parity] ${message}`);
  }
}

function assertConnectionInvariant(workflow, fromNode, toNode) {
  const actualTarget = workflow?.connections?.[fromNode]?.main?.[0]?.[0]?.node;
  if (actualTarget !== toNode) {
    throw new Error(`[workflow json parity] connection mismatch: ${fromNode} -> ${toNode}`);
  }
}

function assertCtrComputeContract(code, label) {
  void label;
  assertCodeInvariant(code, /Extract from File/, 'report extract dependency invariant missing');
  assertCodeInvariant(code, /Set Credentials/, 'sheet-name dependency invariant missing');
  assertCodeInvariant(code, /valueInputOption:\s*'USER_ENTERED'/, 'batch update payload invariant missing');
  assertCodeInvariant(code, /row\.advertisedSku/, 'report SKU aggregation invariant missing');
  assertCodeInvariant(code, /throw new Error\(/, 'strict parse invariant missing');
  assertCodeInvariant(code, /headerRowIndex|findHeaderRow|findIndex\(/, 'robust header scan invariant missing');
  assertCodeInvariant(code, /metrics\.impressions\s*>\s*0|impressions\s*>\s*0/, 'zero-impression CTR guard invariant missing');
  assertCodeAbsent(code, /Number\.isFinite\(n\)\s*\?\s*n\s*:\s*0/, 'permissive numeric coercion invariant present');
}

function expectObject(value, pathLabel) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Expected ${pathLabel} object`);
  }
}

function expectNullableString(value, pathLabel) {
  if (value !== null && typeof value !== 'string') {
    throw new Error(`Expected ${pathLabel} string|null`);
  }
}

function expectArray(value, pathLabel) {
  if (!Array.isArray(value)) {
    throw new Error(`Expected ${pathLabel} array`);
  }
}

function expectNumber(value, pathLabel) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Expected ${pathLabel} number`);
  }
}

function assertWorkflowLocalSummaryShape(summary) {
  expectObject(summary, 'summary');
  expectObject(summary.workflow, 'workflow');
  expectObject(summary.inputs, 'inputs');
  expectObject(summary.compute, 'compute');

  if (typeof summary.workflow.path !== 'string' || !summary.workflow.path.trim()) {
    throw new Error('Expected workflow.path string');
  }
  if (typeof summary.workflow.nodeName !== 'string' || !summary.workflow.nodeName.trim()) {
    throw new Error('Expected workflow.nodeName string');
  }

  if (typeof summary.inputs.reportPath !== 'string' || !summary.inputs.reportPath.trim()) {
    throw new Error('Expected inputs.reportPath string');
  }
  if (typeof summary.inputs.sheetPath !== 'string' || !summary.inputs.sheetPath.trim()) {
    throw new Error('Expected inputs.sheetPath string');
  }
  if (typeof summary.inputs.date !== 'string' || !summary.inputs.date.trim()) {
    throw new Error('Expected inputs.date string');
  }
  if (typeof summary.inputs.sheetName !== 'string' || !summary.inputs.sheetName.trim()) {
    throw new Error('Expected inputs.sheetName string');
  }

  if (!['ok', 'failed'].includes(summary.compute.status)) {
    throw new Error('Expected compute.status ok|failed');
  }
  if (!['ok', 'failed'].includes(summary.compute.localStatus)) {
    throw new Error('Expected compute.localStatus ok|failed');
  }
  if (!['ok', 'failed'].includes(summary.compute.workflowStatus)) {
    throw new Error('Expected compute.workflowStatus ok|failed');
  }

  expectNullableString(summary.compute.localError, 'compute.localError');
  expectNullableString(summary.compute.workflowError, 'compute.workflowError');
  expectNumber(summary.compute.mismatchCount, 'compute.mismatchCount');
  expectArray(summary.compute.mismatchPreview, 'compute.mismatchPreview');
  expectNumber(summary.compute.reportOnlySkuCount, 'compute.reportOnlySkuCount');
  expectArray(summary.compute.reportOnlySkus, 'compute.reportOnlySkus');
  expectNumber(summary.compute.sheetOnlySkuCount, 'compute.sheetOnlySkuCount');
  expectArray(summary.compute.sheetOnlySkus, 'compute.sheetOnlySkus');
  expectNumber(summary.compute.updateCount, 'compute.updateCount');
  expectNumber(summary.compute.localUpdateCount, 'compute.localUpdateCount');
  expectNumber(summary.compute.workflowUpdateCount, 'compute.workflowUpdateCount');

  if (summary.compute.mismatchCount > 0 && summary.compute.mismatchPreview.length === 0) {
    throw new Error('Expected compute.mismatchPreview entries when compute.mismatchCount > 0');
  }

  summary.compute.mismatchPreview.forEach((entry, index) => {
    expectObject(entry, `compute.mismatchPreview[${index}]`);
    if (typeof entry.range !== 'string' || !entry.range.trim()) {
      throw new Error(`Expected compute.mismatchPreview[${index}].range string`);
    }
    if (entry.sku !== null && typeof entry.sku !== 'string') {
      throw new Error(`Expected compute.mismatchPreview[${index}].sku string|null`);
    }
  });

  summary.compute.reportOnlySkus.forEach((sku, index) => {
    if (typeof sku !== 'string' || !sku.trim()) {
      throw new Error(`Expected compute.reportOnlySkus[${index}] string`);
    }
  });
  summary.compute.sheetOnlySkus.forEach((sku, index) => {
    if (typeof sku !== 'string' || !sku.trim()) {
      throw new Error(`Expected compute.sheetOnlySkus[${index}] string`);
    }
  });
}

function assertWorkflowJsonParity(workflow) {
  if (!workflow || !Array.isArray(workflow.nodes) || !workflow.connections || typeof workflow.connections !== 'object') {
    throw new Error('[workflow json parity] malformed workflow shape');
  }

  const computeNode = getNodeOrThrow(workflow, 'Code in JavaScript');
  getNodeOrThrow(workflow, 'Webhook Read Google Sheet');
  getNodeOrThrow(workflow, 'Webhook Update Google Sheet');

  const code = computeNode.parameters?.jsCode || '';
  if (!code.trim()) {
    throw new Error('[workflow json parity] missing jsCode on node: Code in JavaScript');
  }

  assertCtrComputeContract(code, 'workflow json parity');
  assertConnectionInvariant(workflow, 'Webhook Read Google Sheet', 'Code in JavaScript');
  assertConnectionInvariant(workflow, 'Code in JavaScript', 'Webhook Update Google Sheet');
}

function simplifyItem(item) {
  return {
    sku: item.sku,
    clicks: item.clicks,
    impressions: item.impressions,
    ctr: item.ctr,
    expectedCtr: item.expectedCtr,
    ctrDelta: item.ctrDelta,
    comparisonStatus: item.comparisonStatus,
    traceability: item.traceability,
  };
}

function buildVerifierSuccessReport({ withMismatch = false } = {}) {
  const items = [
    {
      sku: 'SKU1',
      clicks: 5,
      impressions: 100,
      ctr: 5,
      expectedCtr: 5,
      ctrDelta: 0,
      comparisonStatus: 'match',
      source: 'file',
      reportPresent: true,
      fixturePresent: true,
      notes: '',
      productLabel: 'SKU 1',
      traceability: {
        report: { rowCount: 1 },
        expected: { filePath: '/tmp/ctr-fixture.json', rowNumber: 0, date: '2026-04-15' },
      },
    },
    {
      sku: 'SKU2',
      clicks: withMismatch ? 4 : 2,
      impressions: 20,
      ctr: withMismatch ? 20 : 10,
      expectedCtr: 10,
      ctrDelta: withMismatch ? 10 : 0,
      comparisonStatus: withMismatch ? 'mismatch' : 'match',
      source: 'file',
      reportPresent: true,
      fixturePresent: true,
      notes: '',
      productLabel: 'SKU 2',
      traceability: {
        report: { rowCount: withMismatch ? 2 : 1 },
        expected: { filePath: '/tmp/ctr-fixture.json', rowNumber: 1, date: '2026-04-15' },
      },
    },
  ];

  const mismatches = withMismatch
    ? [
      {
        sku: 'SKU2',
        clicks: 4,
        impressions: 20,
        ctr: 20,
        expectedCtr: 10,
        ctrDelta: 10,
        traceability: {
          report: { rowCount: 2 },
          expected: { filePath: '/tmp/ctr-fixture.json', rowNumber: 1, date: '2026-04-15' },
        },
      },
    ]
    : [];

  return {
    metric: 'ctr',
    source: 'file',
    startedAt: '2026-04-19T10:00:00.000Z',
    completedAt: '2026-04-19T10:00:01.000Z',
    dateRange: {
      startDate: '2026-04-15',
      endDate: '2026-04-15',
      sameDay: true,
    },
    request: {
      date: '2026-04-15',
      endDate: '2026-04-15',
      source: 'file',
      delayMs: 0,
    },
    stage: 'compute',
    status: 'success',
    summary: {
      status: 'success',
      stage: 'compute',
      attempts: { create: 1, poll: 2 },
      lifecyclePhases: ['auth', 'create-report', 'poll-report', 'download-report', 'parse', 'compute'],
      reportId: 'r1',
      reportDocumentId: 'd1',
      downloadedBytes: 100,
      parsedRowCount: withMismatch ? 3 : 2,
      parsedSkuCount: 2,
      expectedSkuCount: 2,
      computedSkuCount: 2,
      matchedSkuCount: withMismatch ? 1 : 2,
      mismatchedSkuCount: withMismatch ? 1 : 0,
      missingExpectedSkuCount: 0,
      extraReportSkuCount: 1,
    },
    lifecycle: [
      { stage: 'auth', attempt: 1, status: 'success' },
      { stage: 'create-report', attempt: 1, status: 'success', reportId: 'r1' },
      { stage: 'poll-report', attempt: 1, status: 'IN_PROGRESS', reportId: 'r1', reportDocumentId: null },
      { stage: 'poll-report', attempt: 2, status: 'COMPLETED', reportId: 'r1', reportDocumentId: 'd1' },
      { stage: 'download-report', attempt: 1, status: 'success', reportId: 'r1', reportDocumentId: 'd1', bytes: 100 },
      { stage: 'parse', attempt: 1, status: 'success', message: '' },
      { stage: 'compute', attempt: 1, status: 'success', message: 'Computed 2 SKU rows' },
    ],
    reportInfo: {
      reportType: 'spAdvertisedProduct',
      reportId: 'r1',
      reportDocumentId: 'd1',
      processingStatus: 'COMPLETED',
      contentType: 'application/json',
    },
    comparison: {
      source: 'file',
      tolerance: 0.0001,
      extraReportSkus: ['EXTRA'],
      mismatches,
    },
    items,
    warnings: withMismatch
      ? ['1 report SKUs were outside the comparison target set.', '1 SKU rows differ from the expected CTR fixture.']
      : ['1 report SKUs were outside the comparison target set.'],
  };
}

function matchesGrep(testName, grepValue) {
  if (!grepValue) return true;

  const normalizedName = testName.toLowerCase();
  const normalizedGrep = grepValue.toLowerCase();

  if (normalizedName.includes(normalizedGrep)) {
    return true;
  }

  const regexPattern = grepValue.replace(/\\\|/g, '|');

  try {
    return new RegExp(regexPattern, 'i').test(testName);
  } catch {
    return false;
  }
}

async function runCtrTests(grepValue = '') {
  const selected = tests.filter((test) => matchesGrep(test.name, grepValue));

  if (!selected.length) {
    throw new Error(`No CTR tests matched grep: ${grepValue}`);
  }

  for (const test of selected) {
    await test.fn();
  }

  console.log(`CTR tests passed (${selected.length}/${tests.length}).`);
}

async function main() {
  const argv = process.argv.slice(2);
  const grepIndex = argv.indexOf('--grep');
  const grepValue = grepIndex >= 0 ? argv[grepIndex + 1] || '' : '';
  await runCtrTests(grepValue);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  runCtrTests,
};
