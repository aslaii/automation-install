const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const zlib = require('zlib');
const { parseCliArgs } = require('../lib/cli');
const { loadConfig } = require('../lib/config');
const { runWithArgs } = require('../index');
const { runApp } = require('../app');
const { mintAmazonAdsAccessToken } = require('../lib/auth/amazon-ads');
const {
  runAmazonAdsReportLifecycle,
  decodeReportDownload,
  extractDuplicateReportId,
  parseRetryAfterMs,
  computeThrottleDelayMs,
} = require('../lib/ads/reports');
const { loadSalesPpcFromFile } = require('../lib/sources/sales-ppc-file');
const {
  runGetSalesPpc,
  parseSalesPpcReport,
  computeSalesPpc,
} = require('../features/sales-ppc');
const {
  main: verifyLatestSalesPpcRunMain,
  verifySalesPpcRun,
  findLatestSalesPpcRun,
} = require('../verify-latest-sales-ppc-run');
const {
  readWorkflow,
  runWorkflowCompute,
  runWorkflowLocally,
} = require('../run-sales-ppc-workflow-local');

const tests = [
  {
    name: 'cli parses sales-ppc as a first-class metric',
    fn: testCliParsesSalesPpc,
  },
  {
    name: 'index dispatch routes sales-ppc to the injected runner',
    fn: testIndexDispatchSalesPpc,
  },
  {
    name: 'sales-ppc boundary fails clearly when amazon ads env is missing',
    fn: testSalesPpcMissingEnvValidation,
  },
  {
    name: 'amazon ads auth redacts secrets from auth errors',
    fn: testAmazonAdsAuthRedaction,
  },
  {
    name: 'amazon ads report lifecycle reuses duplicate report ids from create errors',
    fn: testDuplicateCreateRecovery,
  },
  {
    name: 'amazon ads report lifecycle backs off on throttled poll responses and then succeeds',
    fn: testPollThrottleThenSuccess,
  },
  {
    name: 'amazon ads report lifecycle times out after bounded poll attempts',
    fn: testPollTimeout,
  },
  {
    name: 'amazon ads report lifecycle fails on terminal poll status',
    fn: testTerminalPollFailure,
  },
  {
    name: 'amazon ads report lifecycle rejects malformed binary downloads',
    fn: testMalformedDownload,
  },
  {
    name: 'amazon ads report lifecycle decodes gzip and plain text downloads',
    fn: testDownloadDecoding,
  },
  {
    name: 'sales ppc file source loads april 15 fixture',
    fn: testFileSourceLoadsFixture,
  },
  {
    name: 'sales ppc file source rejects malformed numeric values with file row context',
    fn: testFileSourceRejectsMalformedNumeric,
  },
  {
    name: 'sales ppc file source rejects blank sku rows with file row context',
    fn: testFileSourceRejectsBlankSku,
  },
  {
    name: 'sales ppc file source rejects duplicate date sku rows with file row context',
    fn: testFileSourceRejectsDuplicateDateSku,
  },
  {
    name: 'sales ppc file source rejects requested dates with zero fixture rows',
    fn: testFileSourceRejectsMissingDate,
  },
  {
    name: 'sales ppc parser aggregates duplicate sku rows with per-sku field provenance',
    fn: testParserAggregatesDuplicateSkuRows,
  },
  {
    name: 'sales ppc parser locks mixed logical and raw field provenance from the contract fixture',
    fn: testParserContractFixture,
  },
  {
    name: 'sales ppc parser falls back to attributedSales7d when sales7d is absent',
    fn: testParserFallsBackToAttributedSales,
  },
  {
    name: 'sales ppc parser rejects malformed rows without sku or sales values',
    fn: testParserRejectsMalformedRows,
  },
  {
    name: 'sales ppc compute tracks report-only skus while keeping file comparisons fixture-scoped',
    fn: testComputeTracksExtraReportSkus,
  },
  {
    name: 'sales ppc compute tracks mismatch payload completeness and tolerance boundaries',
    fn: testComputeLocksMismatchPayloadAndTolerance,
  },
  {
    name: 'sales ppc runner builds compute artifact rows from file source',
    fn: testRunnerComputeFromFileSource,
  },
  {
    name: 'sales ppc runner writes compute-stage failure artifact when file input is ambiguous',
    fn: testRunnerComputeFailureArtifactForAmbiguousFileInput,
  },
  {
    name: 'latest-run verifier resolves summary from a valid sales ppc artifact',
    fn: testVerifyRunMainUsesProvidedArtifact,
  },
  {
    name: 'latest-run verifier rejects missing sales ppc artifacts',
    fn: testVerifyRunRejectsMissingArtifacts,
  },
  {
    name: 'latest-run verifier rejects malformed success artifacts missing required fields',
    fn: testVerifyRunRejectsMalformedSuccessArtifact,
  },
  {
    name: 'latest-run verifier rejects malformed success artifacts with provenance drift',
    fn: testVerifyRunRejectsProvenanceDrift,
  },
  {
    name: 'latest-run verifier rejects malformed success artifacts with incomplete mismatch payloads',
    fn: testVerifyRunRejectsMalformedMismatchPayload,
  },
  {
    name: 'latest-run verifier accepts failed artifacts with failure shape',
    fn: testVerifyRunAcceptsFailureArtifact,
  },
  {
    name: 'workflow compute node keeps SALESPPC alias coverage in the checked-in contract',
    fn: testWorkflowComputeNodeContract,
  },
  {
    name: 'workflow json parity locks the checked-in Sales PPC contract',
    fn: testWorkflowJsonParityContract,
  },
  {
    name: 'workflow json parity helpers fail loudly on missing nodes and drift markers',
    fn: testWorkflowJsonParityFailureModes,
  },
  {
    name: 'workflow local runner exports the checked-in harness helpers',
    fn: testWorkflowLocalRunnerExports,
  },
  {
    name: 'workflow local runner surfaces structured parity mismatches for compact fixtures',
    fn: testWorkflowLocalRunnerStructuredMismatchSummary,
  },
  {
    name: 'workflow local runner fails summary-shape assertions with exact field paths',
    fn: testWorkflowLocalRunnerSummaryShapeFailureModes,
  },
  {
    name: 'repo root sales ppc test shim executes the parity grep block',
    fn: testRepoRootSalesPpcShimParityGrep,
  },
  {
    name: 'shared npm test runner invokes sales-ppc coverage',
    fn: testRunTestsMainInvokesSalesPpcCoverage,
  },
];

function readJsonFixture(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, relativePath), 'utf8'));
}

function testCliParsesSalesPpc() {
  const args = parseCliArgs(['--sales-ppc', '--date', '2026-04-15', '--source', 'file', '--delay-ms', '0']);
  assert.strictEqual(args.metric, 'sales-ppc');
  assert.strictEqual(args.date, '2026-04-15');
  assert.strictEqual(args.source, 'file');
  assert.strictEqual(args.delayMs, 0);
}

async function testIndexDispatchSalesPpc() {
  const calls = [];
  await runWithArgs(['--sales-ppc', '--date', '2026-04-15'], {
    runGetSalesPpc: async (args) => {
      calls.push(args);
      return { ok: true };
    },
  });

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].metric, 'sales-ppc');
  assert.strictEqual(calls[0].date, '2026-04-15');
}

async function testSalesPpcMissingEnvValidation() {
  await assert.rejects(
    () => runApp(
      { metric: 'sales-ppc', date: '2026-04-15', source: 'file', delayMs: 0 },
      {
        loadConfig: ({ source, metric }) => loadConfig({ source, metric, env: {} }),
      },
    ),
    /Missing required environment variable: AMAZON_ADS_CLIENT_ID/,
  );
}

async function testAmazonAdsAuthRedaction() {
  await assert.rejects(
    () => mintAmazonAdsAccessToken(
      {
        clientId: 'client-123',
        clientSecret: 'secret-456',
        refreshToken: 'refresh-789',
      },
      {
        axiosInstance: {
          post: async () => {
            const error = new Error('request failed for secret-456 refresh-789');
            error.response = { status: 401, data: { message: 'invalid secret-456 refresh-789' } };
            throw error;
          },
        },
      },
    ),
    (error) => {
      assert.strictEqual(error.httpStatus, 401);
      assert.strictEqual(error.message.includes('secret-456'), false);
      assert.strictEqual(error.message.includes('refresh-789'), false);
      assert.match(error.message, /\[redacted\]/);
      return true;
    },
  );
}

async function testDuplicateCreateRecovery() {
  const axiosInstance = buildAxiosStub([
    {
      method: 'post',
      match: '/reporting/reports',
      error: buildHttpError('duplicate of: report-dup-123', 425),
    },
    {
      method: 'get',
      match: '/reporting/reports/report-dup-123',
      response: {
        status: 200,
        data: {
          status: 'COMPLETED',
          reportId: 'doc-123',
          url: 'https://download.example/report-dup-123',
        },
      },
    },
    {
      method: 'get',
      match: 'https://download.example/report-dup-123',
      response: {
        status: 200,
        data: Buffer.from('[{"advertisedSku":"SKU1","sales7d":12.34}]', 'utf8'),
        headers: { 'content-type': 'application/json' },
      },
    },
  ]);

  const result = await runAmazonAdsReportLifecycle({
    accessToken: 'token',
    clientId: 'client',
    profileId: 'profile',
    dateRange: { startDate: '2026-04-15', endDate: '2026-04-15' },
    axiosInstance,
    sleep: async () => {},
    polling: { maxAttempts: 2, pollIntervalMs: 1, jitterMaxMs: 0 },
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reportId, 'report-dup-123');
  assert.strictEqual(result.reportDocumentId, 'doc-123');
  assert.strictEqual(result.lifecycle[0].status, 'duplicate-reused');
  assert.strictEqual(extractDuplicateReportId('duplicate of: abc-123'), 'abc-123');
}

async function testPollThrottleThenSuccess() {
  const sleepCalls = [];
  const axiosInstance = buildAxiosStub([
    {
      method: 'post',
      match: '/reporting/reports',
      response: { status: 202, data: { reportId: 'report-123' } },
    },
    {
      method: 'get',
      match: '/reporting/reports/report-123',
      error: buildHttpError('Too many requests for https://download.example/private-url', 429, { 'retry-after': '2' }),
    },
    {
      method: 'get',
      match: '/reporting/reports/report-123',
      response: {
        status: 200,
        data: {
          status: 'COMPLETED',
          reportId: 'doc-123',
          url: 'https://download.example/report-123',
        },
      },
    },
    {
      method: 'get',
      match: 'https://download.example/report-123',
      response: {
        status: 200,
        data: zlib.gzipSync(Buffer.from('[{"advertisedSku":"SKU1","sales7d":42}]', 'utf8')),
        headers: { 'content-type': 'application/octet-stream', 'content-encoding': 'gzip' },
      },
    },
  ]);

  const result = await runAmazonAdsReportLifecycle({
    accessToken: 'token',
    clientId: 'client',
    profileId: 'profile',
    dateRange: { startDate: '2026-04-15', endDate: '2026-04-15' },
    axiosInstance,
    sleep: async (ms) => sleepCalls.push(ms),
    random: () => 0,
    polling: {
      maxAttempts: 3,
      pollIntervalMs: 1000,
      baseRetryDelayMs: 500,
      maxRetryDelayMs: 5000,
      jitterMaxMs: 0,
    },
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.attempts.poll, 2);
  assert.deepStrictEqual(sleepCalls, [2000]);
  assert.strictEqual(result.lifecycle.some((entry) => entry.status === 'throttled'), true);
  assert.strictEqual(result.lifecycle.some((entry) => String(entry.message || '').includes('private-url')), false);
  assert.strictEqual(parseRetryAfterMs('2'), 2000);
  assert.strictEqual(
    computeThrottleDelayMs({
      attempt: 1,
      retryAfterMs: 2000,
      polling: { pollIntervalMs: 1000, baseRetryDelayMs: 500, maxRetryDelayMs: 5000, jitterMaxMs: 0 },
      random: () => 0,
    }),
    2000,
  );
}

async function testPollTimeout() {
  const axiosInstance = buildAxiosStub([
    {
      method: 'post',
      match: '/reporting/reports',
      response: { status: 202, data: { reportId: 'report-123' } },
    },
    {
      method: 'get',
      match: '/reporting/reports/report-123',
      response: { status: 200, data: { status: 'IN_PROGRESS' } },
    },
    {
      method: 'get',
      match: '/reporting/reports/report-123',
      response: { status: 200, data: { status: 'PROCESSING' } },
    },
  ]);
  const sleepCalls = [];

  const result = await runAmazonAdsReportLifecycle({
    accessToken: 'token',
    clientId: 'client',
    profileId: 'profile',
    dateRange: { startDate: '2026-04-15', endDate: '2026-04-15' },
    axiosInstance,
    sleep: async (ms) => sleepCalls.push(ms),
    polling: { maxAttempts: 2, pollIntervalMs: 7, jitterMaxMs: 0 },
  });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.stage, 'poll-report');
  assert.strictEqual(result.error.code, 'POLL_TIMEOUT');
  assert.strictEqual(result.error.timeout, true);
  assert.deepStrictEqual(sleepCalls, [7]);
}

async function testTerminalPollFailure() {
  const axiosInstance = buildAxiosStub([
    {
      method: 'post',
      match: '/reporting/reports',
      response: { status: 202, data: { reportId: 'report-123' } },
    },
    {
      method: 'get',
      match: '/reporting/reports/report-123',
      response: { status: 200, data: { status: 'FAILED', failureReason: 'No data' } },
    },
  ]);

  const result = await runAmazonAdsReportLifecycle({
    accessToken: 'token',
    clientId: 'client',
    profileId: 'profile',
    dateRange: { startDate: '2026-04-15', endDate: '2026-04-15' },
    axiosInstance,
    sleep: async () => {},
    polling: { maxAttempts: 2, pollIntervalMs: 1, jitterMaxMs: 0 },
  });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.processingStatus, 'FAILED');
  assert.strictEqual(result.error.code, 'REPORT_TERMINAL_FAILURE');
  assert.match(result.error.message, /FAILED: No data/);
}

async function testMalformedDownload() {
  const axiosInstance = buildAxiosStub([
    {
      method: 'post',
      match: '/reporting/reports',
      response: { status: 202, data: { reportId: 'report-123' } },
    },
    {
      method: 'get',
      match: '/reporting/reports/report-123',
      response: {
        status: 200,
        data: {
          status: 'COMPLETED',
          reportId: 'doc-123',
          url: 'https://download.example/report-123',
        },
      },
    },
    {
      method: 'get',
      match: 'https://download.example/report-123',
      response: {
        status: 200,
        data: Buffer.from([0x00, 0xff, 0x10, 0x80]),
        headers: { 'content-type': 'application/octet-stream' },
      },
    },
  ]);

  const result = await runAmazonAdsReportLifecycle({
    accessToken: 'token',
    clientId: 'client',
    profileId: 'profile',
    dateRange: { startDate: '2026-04-15', endDate: '2026-04-15' },
    axiosInstance,
    sleep: async () => {},
    polling: { maxAttempts: 1, pollIntervalMs: 1, jitterMaxMs: 0 },
  });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.stage, 'download-report');
  assert.strictEqual(result.error.code, 'MALFORMED_DOWNLOAD_CONTENT');
}

function testDownloadDecoding() {
  const textResult = decodeReportDownload({
    data: Buffer.from('[{"advertisedSku":"SKU1"}]', 'utf8'),
    headers: { 'content-type': 'application/json' },
  });
  assert.strictEqual(textResult.text.includes('SKU1'), true);
  assert.strictEqual(textResult.encoding, 'identity');

  const gzipResult = decodeReportDownload({
    data: zlib.gzipSync(Buffer.from('[{"advertisedSku":"SKU2"}]', 'utf8')),
    headers: { 'content-type': 'application/octet-stream', 'content-encoding': 'gzip' },
  });
  assert.strictEqual(gzipResult.text.includes('SKU2'), true);
  assert.strictEqual(gzipResult.encoding, 'gzip');
}

async function testFileSourceLoadsFixture() {
  const result = await loadSalesPpcFromFile('data/sales-ppc-input.json', '2026-04-15');
  assert.strictEqual(result.source, 'file');
  assert.strictEqual(result.skuCount, 25);
  assert.strictEqual(result.bySku['Dried-Kadayif-180gm'].expectedSalesPpc, 1194.09);
  assert.strictEqual(result.bySku['ORG Dell 9-Cell D620'].expectedSalesPpc, 0);
}

async function testFileSourceRejectsMalformedNumeric() {
  const tmpPath = path.join(__dirname, 'tmp-sales-ppc-invalid.json');
  await fs.promises.writeFile(tmpPath, JSON.stringify([
    { date: '2026-04-15', sku: 'SKU1', expectedSalesPpc: 'not-a-number' },
  ]), 'utf8');
  try {
    await assert.rejects(
      () => loadSalesPpcFromFile(tmpPath, '2026-04-15'),
      /Invalid numeric value for expectedSalesPpc file .*tmp-sales-ppc-invalid\.json row 0 sku SKU1/,
    );
  } finally {
    await fs.promises.rm(tmpPath, { force: true });
  }
}

async function testFileSourceRejectsBlankSku() {
  const tmpPath = path.join(__dirname, 'tmp-sales-ppc-blank-sku.json');
  await fs.promises.writeFile(tmpPath, JSON.stringify([
    { date: '2026-04-15', sku: '   ', expectedSalesPpc: 10 },
  ]), 'utf8');
  try {
    await assert.rejects(
      () => loadSalesPpcFromFile(tmpPath, '2026-04-15'),
      /Sales PPC file row 0 is missing sku .*tmp-sales-ppc-blank-sku\.json/,
    );
  } finally {
    await fs.promises.rm(tmpPath, { force: true });
  }
}

async function testFileSourceRejectsDuplicateDateSku() {
  const tmpPath = path.join(__dirname, 'tmp-sales-ppc-duplicate.json');
  await fs.promises.writeFile(tmpPath, JSON.stringify([
    { date: '2026-04-15', sku: 'SKU1', expectedSalesPpc: 10 },
    { date: '2026-04-15', sku: 'SKU1', expectedSalesPpc: 20 },
  ]), 'utf8');
  try {
    await assert.rejects(
      () => loadSalesPpcFromFile(tmpPath, '2026-04-15'),
      /Sales PPC file duplicate row for date 2026-04-15 sku SKU1 .*tmp-sales-ppc-duplicate\.json rows 0 and 1/,
    );
  } finally {
    await fs.promises.rm(tmpPath, { force: true });
  }
}

async function testFileSourceRejectsMissingDate() {
  await assert.rejects(
    () => loadSalesPpcFromFile('data/sales-ppc-input.json', '2099-01-01'),
    /Sales PPC file has no rows for requested date 2099-01-01 \(data\/sales-ppc-input\.json\)/,
  );
}

function testParserAggregatesDuplicateSkuRows() {
  const parsed = parseSalesPpcReport(JSON.stringify([
    { advertisedSku: 'SKU1', sales7d: 10 },
    { advertisedSku: 'SKU1', sales7d: 5.25 },
    { advertisedSku: 'SKU2', sales7d: 8, attributedSales7d: 9 },
    { advertisedSku: 'SKU2', attributedSales7d: 2.5 },
  ]));

  assert.strictEqual(parsed.preferredSalesField, 'sales7d');
  assert.strictEqual(parsed.rawPreferredSalesField, 'sales7d');
  assert.deepStrictEqual(parsed.fieldUsage, {
    sales7d: 3,
    attributedSales7d: 1,
    attributedSalesSameSku7d: 0,
  });
  assert.strictEqual(parsed.bySku.SKU1.reportSalesPpc, 15.25);
  assert.deepStrictEqual(parsed.bySku.SKU1.provenance, {
    preferredSalesField: 'sales7d',
    rawPreferredSalesField: 'sales7d',
    chosenField: 'sales7d',
    rawChosenField: 'sales7d',
    rowCount: 2,
    fallbackRows: 0,
    sales7d: 2,
    attributedSales7d: 0,
    attributedSalesSameSku7d: 0,
  });
  assert.strictEqual(parsed.bySku.SKU2.reportSalesPpc, 10.5);
  assert.strictEqual(parsed.bySku.SKU2.provenance.chosenField, 'mixed');
  assert.strictEqual(parsed.bySku.SKU2.provenance.rawChosenField, 'mixed');
  assert.strictEqual(parsed.bySku.SKU2.provenance.fallbackRows, 1);
}

function testParserContractFixture() {
  const fixture = readJsonFixture('fixtures/sales-ppc-report-contract.json');
  const parsed = parseSalesPpcReport(JSON.stringify(fixture.reportRows));

  assert.strictEqual(parsed.preferredSalesField, fixture.expected.preferredSalesField);
  assert.strictEqual(parsed.rawPreferredSalesField, fixture.expected.rawPreferredSalesField);
  assert.deepStrictEqual(parsed.fieldUsage, fixture.expected.fieldUsage);

  for (const [sku, expectedEntry] of Object.entries(fixture.expected.bySku)) {
    assert.strictEqual(parsed.bySku[sku].reportSalesPpc, expectedEntry.reportSalesPpc, `Unexpected reportSalesPpc for ${sku}`);
    assert.deepStrictEqual(
      {
        chosenField: parsed.bySku[sku].provenance.chosenField,
        rawChosenField: parsed.bySku[sku].provenance.rawChosenField,
        rowCount: parsed.bySku[sku].provenance.rowCount,
        fallbackRows: parsed.bySku[sku].provenance.fallbackRows,
        sales7d: parsed.bySku[sku].provenance.sales7d,
        attributedSales7d: parsed.bySku[sku].provenance.attributedSales7d,
        attributedSalesSameSku7d: parsed.bySku[sku].provenance.attributedSalesSameSku7d,
      },
      expectedEntry.provenance,
      `Unexpected provenance for ${sku}`,
    );
  }
}

function testParserFallsBackToAttributedSales() {
  const parsed = parseSalesPpcReport(JSON.stringify([
    { advertisedSku: 'SKU1', attributedSalesSameSku7d: 11.11 },
    { advertisedSku: 'SKU2', attributedSalesSameSku7d: '22.22' },
  ]));

  assert.strictEqual(parsed.preferredSalesField, 'attributedSales7d');
  assert.strictEqual(parsed.rawPreferredSalesField, 'attributedSalesSameSku7d');
  assert.strictEqual(parsed.bySku.SKU1.reportSalesPpc, 11.11);
  assert.strictEqual(parsed.bySku.SKU1.provenance.chosenField, 'attributedSales7d');
  assert.strictEqual(parsed.bySku.SKU1.provenance.rawChosenField, 'attributedSalesSameSku7d');
}

function testParserRejectsMalformedRows() {
  const fixture = readJsonFixture('fixtures/sales-ppc-report-contract.json');

  assert.throws(
    () => parseSalesPpcReport(JSON.stringify(fixture.malformed.missingSkuRows)),
    /row 1 is missing advertisedSku/,
  );
  assert.throws(
    () => parseSalesPpcReport(JSON.stringify(fixture.malformed.missingSalesRows)),
    /row 1 sku NO-SALES is missing sales7d, attributedSales7d, and attributedSalesSameSku7d/,
  );
  assert.throws(
    () => parseSalesPpcReport(JSON.stringify(fixture.malformed.nonNumericSalesRows)),
    /Invalid numeric value for attributedSalesSameSku7d row 1 sku BAD-NUMERIC/,
  );
  const emptyParsed = parseSalesPpcReport(JSON.stringify(fixture.malformed.emptyRows));
  assert.strictEqual(emptyParsed.rowCount, 0);
  assert.strictEqual(emptyParsed.parseWarning, 'Sales PPC report has no data rows');
}

function testComputeTracksExtraReportSkus() {
  const computation = computeSalesPpc({
    parsedReport: {
      preferredSalesField: 'sales7d',
      bySku: {
        EXPECTED: {
          sku: 'EXPECTED',
          reportSalesPpc: 40,
          provenance: { preferredSalesField: 'sales7d', chosenField: 'sales7d', rowCount: 1, fallbackRows: 0, sales7d: 1, attributedSales7d: 0 },
        },
        REPORT_ONLY: {
          sku: 'REPORT_ONLY',
          reportSalesPpc: 9,
          provenance: { preferredSalesField: 'sales7d', chosenField: 'sales7d', rowCount: 1, fallbackRows: 0, sales7d: 1, attributedSales7d: 0 },
        },
      },
    },
    expectedInput: {
      source: 'file',
      bySku: {
        EXPECTED: { sku: 'EXPECTED', expectedSalesPpc: 40, source: 'file', notes: '', productLabel: '' },
      },
    },
    source: 'file',
    tolerance: 0.01,
  });

  assert.deepStrictEqual(computation.items.map((item) => item.sku), ['EXPECTED']);
  assert.deepStrictEqual(computation.extraReportSkus, ['REPORT_ONLY']);
  assert.strictEqual(computation.summary.extraReportSkuCount, 1);
  assert.strictEqual(computation.mismatches.length, 0);
}

function testComputeLocksMismatchPayloadAndTolerance() {
  const baseParsedReport = {
    preferredSalesField: 'sales7d',
    rawPreferredSalesField: 'sales7d',
    bySku: {
      ALMOST_MATCH: {
        sku: 'ALMOST_MATCH',
        reportSalesPpc: 10.01,
        provenance: {
          preferredSalesField: 'sales7d',
          rawPreferredSalesField: 'sales7d',
          chosenField: 'sales7d',
          rawChosenField: 'sales7d',
          rowCount: 1,
          fallbackRows: 0,
          sales7d: 1,
          attributedSales7d: 0,
          attributedSalesSameSku7d: 0,
        },
      },
      MISMATCHED: {
        sku: 'MISMATCHED',
        reportSalesPpc: 12.52,
        provenance: {
          preferredSalesField: 'sales7d',
          rawPreferredSalesField: 'sales7d',
          chosenField: 'mixed',
          rawChosenField: 'mixed',
          rowCount: 2,
          fallbackRows: 1,
          sales7d: 1,
          attributedSales7d: 1,
          attributedSalesSameSku7d: 0,
        },
      },
      REPORT_ONLY_B: {
        sku: 'REPORT_ONLY_B',
        reportSalesPpc: 7,
        provenance: {
          preferredSalesField: 'sales7d',
          rawPreferredSalesField: 'sales7d',
          chosenField: 'sales7d',
          rawChosenField: 'sales7d',
          rowCount: 1,
          fallbackRows: 0,
          sales7d: 1,
          attributedSales7d: 0,
          attributedSalesSameSku7d: 0,
        },
      },
      REPORT_ONLY_A: {
        sku: 'REPORT_ONLY_A',
        reportSalesPpc: 8,
        provenance: {
          preferredSalesField: 'sales7d',
          rawPreferredSalesField: 'sales7d',
          chosenField: 'sales7d',
          rawChosenField: 'sales7d',
          rowCount: 1,
          fallbackRows: 0,
          sales7d: 1,
          attributedSales7d: 0,
          attributedSalesSameSku7d: 0,
        },
      },
    },
  };

  const computation = computeSalesPpc({
    parsedReport: baseParsedReport,
    expectedInput: {
      source: 'file',
      bySku: {
        ALMOST_MATCH: { sku: 'ALMOST_MATCH', expectedSalesPpc: 10, source: 'file', notes: '', productLabel: '' },
        MISSING_IN_REPORT: { sku: 'MISSING_IN_REPORT', expectedSalesPpc: 0, source: 'file', notes: '', productLabel: '' },
        MISMATCHED: { sku: 'MISMATCHED', expectedSalesPpc: 12.5, source: 'file', notes: '', productLabel: '' },
      },
    },
    source: 'file',
    tolerance: 0.01,
  });

  assert.deepStrictEqual(computation.items.map((item) => item.sku), ['ALMOST_MATCH', 'MISMATCHED', 'MISSING_IN_REPORT']);
  assert.deepStrictEqual(computation.extraReportSkus, ['REPORT_ONLY_A', 'REPORT_ONLY_B']);
  assert.strictEqual(computation.summary.extraReportSkuCount, 2);
  assert.strictEqual(computation.items[0].comparisonStatus, 'match');
  assert.strictEqual(computation.items[0].salesDelta, 0.01);
  assert.strictEqual(computation.items[2].comparisonStatus, 'match');
  assert.strictEqual(computation.items[2].reportPresent, false);
  assert.strictEqual(computation.items[2].provenance.rawChosenField, 'sales7d');

  assert.strictEqual(computation.mismatches.length, 1);
  assert.deepStrictEqual(computation.mismatches[0], {
    sku: 'MISMATCHED',
    reportSalesPpc: 12.52,
    expectedSalesPpc: 12.5,
    salesDelta: 0.02,
    chosenField: 'mixed',
    rawChosenField: 'mixed',
    fallbackRows: 1,
  });
}

async function testRunnerComputeFromFileSource() {
  let savedReport = null;
  await runGetSalesPpc(
    { metric: 'sales-ppc', date: '2026-04-15', source: 'file', delayMs: 0 },
    {
      loadConfig: () => ({
        amazonAds: { authTimeoutMs: 12345, clientId: 'client', profileId: 'profile' },
        salesPpc: {
          fileInput: 'data/sales-ppc-input.json',
          comparisonTolerance: 0.01,
          report: {},
          polling: {},
        },
      }),
      mintAmazonAdsAccessToken: async () => 'token',
      runAmazonAdsReportLifecycle: async () => ({
        ok: true,
        stage: 'download-report',
        attempts: { create: 1, poll: 2 },
        lifecycle: [{ stage: 'create-report', attempt: 1, status: 'success', reportId: 'r1' }, { stage: 'poll-report', attempt: 1, status: 'COMPLETED', reportId: 'r1', reportDocumentId: 'd1' }, { stage: 'download-report', attempt: 1, status: 'success', reportId: 'r1', reportDocumentId: 'd1' }],
        reportId: 'r1',
        reportDocumentId: 'd1',
        processingStatus: 'COMPLETED',
        contentType: 'application/json',
        reportText: JSON.stringify([
          { advertisedSku: 'Dried-Kadayif-180gm', sales7d: 1194.09 },
          { advertisedSku: 'Choco-Milk-200g', sales7d: 100 },
          { advertisedSku: 'Choco-Milk-200g', attributedSales7d: 171.63 },
          { advertisedSku: 'EXTRA-SKU', sales7d: 10 },
        ]),
      }),
      loadSalesPpcFromFile: async () => ({
        source: 'file',
        skuCount: 2,
        bySku: {
          'Dried-Kadayif-180gm': { sku: 'Dried-Kadayif-180gm', expectedSalesPpc: 1194.09, source: 'file', notes: '', productLabel: '' },
          'Choco-Milk-200g': { sku: 'Choco-Milk-200g', expectedSalesPpc: 271.63, source: 'file', notes: '', productLabel: '' },
        },
      }),
      writeReport: async ({ report }) => {
        savedReport = report;
        return '/tmp/sales-ppc.json';
      },
      printSalesPpcReport: () => {},
    },
  );

  assert(savedReport);
  assert.strictEqual(savedReport.status, 'success');
  assert.strictEqual(savedReport.stage, 'compute');
  assert.strictEqual(savedReport.summary.preferredSalesField, 'sales7d');
  assert.strictEqual(savedReport.summary.fieldUsage.sales7d, 3);
  assert.strictEqual(savedReport.summary.fieldUsage.attributedSales7d, 1);
  assert.strictEqual(savedReport.summary.extraReportSkuCount, 1);
  assert.strictEqual(savedReport.summary.mismatchedSkuCount, 0);
  const milk = savedReport.items.find((item) => item.sku === 'Choco-Milk-200g');
  assert.strictEqual(milk.reportSalesPpc, 271.63);
  assert.strictEqual(milk.expectedSalesPpc, 271.63);
  assert.strictEqual(milk.provenance.chosenField, 'mixed');
  assert.strictEqual(milk.provenance.fallbackRows, 1);
}

async function testRunnerComputeFailureArtifactForAmbiguousFileInput() {
  let savedReport = null;
  let printedReport = null;

  await assert.rejects(
    () => runGetSalesPpc(
      { metric: 'sales-ppc', date: '2026-04-15', source: 'file', delayMs: 0 },
      {
        loadConfig: () => ({
          amazonAds: { authTimeoutMs: 12345, clientId: 'client', profileId: 'profile' },
          salesPpc: {
            fileInput: 'data/sales-ppc-input.json',
            comparisonTolerance: 0.01,
            report: {},
            polling: {},
          },
        }),
        mintAmazonAdsAccessToken: async () => 'token',
        runAmazonAdsReportLifecycle: async () => ({
          ok: true,
          stage: 'download-report',
          attempts: { create: 1, poll: 1 },
          lifecycle: [{ stage: 'create-report', attempt: 1, status: 'success', reportId: 'r1' }, { stage: 'poll-report', attempt: 1, status: 'COMPLETED', reportId: 'r1', reportDocumentId: 'd1' }, { stage: 'download-report', attempt: 1, status: 'success', reportId: 'r1', reportDocumentId: 'd1' }],
          reportId: 'r1',
          reportDocumentId: 'd1',
          processingStatus: 'COMPLETED',
          contentType: 'application/json',
          reportText: JSON.stringify([{ advertisedSku: 'SKU1', sales7d: 10 }]),
        }),
        loadSalesPpcFromFile: async () => {
          throw new Error('Sales PPC file duplicate row for date 2026-04-15 sku SKU1 (data/sales-ppc-input.json rows 0 and 1)');
        },
        writeReport: async ({ report }) => {
          savedReport = report;
          return '/tmp/sales-ppc-compute-failure.json';
        },
        printSalesPpcReport: (report, reportPath) => {
          printedReport = { report, reportPath };
        },
      },
    ),
    /Sales PPC failed at compute: Sales PPC file duplicate row for date 2026-04-15 sku SKU1/,
  );

  assert(savedReport);
  assert.strictEqual(savedReport.status, 'failed');
  assert.strictEqual(savedReport.stage, 'compute');
  assert.strictEqual(savedReport.error.message, 'Sales PPC file duplicate row for date 2026-04-15 sku SKU1 (data/sales-ppc-input.json rows 0 and 1)');
  assert.deepStrictEqual(savedReport.items, []);
  assert.strictEqual(savedReport.lifecycle.at(-1).stage, 'compute');
  assert.strictEqual(savedReport.lifecycle.at(-1).status, 'error');
  assert.strictEqual(printedReport.reportPath, '/tmp/sales-ppc-compute-failure.json');
}

async function testVerifyRunMainUsesProvidedArtifact() {
  const tmpDir = await fs.promises.mkdtemp(path.join(__dirname, 'tmp-sales-ppc-report-'));
  const filePath = path.join(tmpDir, 'sales-ppc-success.json');

  try {
    await fs.promises.writeFile(filePath, JSON.stringify(buildVerifierSuccessReport()), 'utf8');
    const result = verifyLatestSalesPpcRunMain({ filePath });
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
  const tmpDir = await fs.promises.mkdtemp(path.join(__dirname, 'tmp-sales-ppc-runs-'));
  try {
    assert.throws(
      () => findLatestSalesPpcRun(tmpDir),
      /No sales-ppc JSON runs found/,
    );
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }
}

function testVerifyRunRejectsMalformedSuccessArtifact() {
  const report = buildVerifierSuccessReport();
  delete report.summary.fieldUsage;
  assert.throws(
    () => verifySalesPpcRun(report, { filePath: '/tmp/sales-ppc-malformed.json' }),
    /Expected summary\.fieldUsage object/,
  );
}

function testVerifyRunRejectsProvenanceDrift() {
  const report = buildVerifierSuccessReport();
  report.items[1].provenance.rawPreferredSalesField = 'attributedSalesSameSku7d';
  report.items[1].provenance.sales7d = 0;

  assert.throws(
    () => verifySalesPpcRun(report, { filePath: '/tmp/sales-ppc-provenance-drift.json' }),
    /Expected item 1 rawPreferredSalesField to mirror summary/,
  );
}

function testVerifyRunRejectsMalformedMismatchPayload() {
  const report = buildVerifierSuccessReport({ withMismatch: true });
  delete report.comparison.mismatches[0].rawChosenField;

  assert.throws(
    () => verifySalesPpcRun(report, { filePath: '/tmp/sales-ppc-mismatch-drift.json' }),
    /Expected mismatch 0 rawChosenField/,
  );
}

function testVerifyRunAcceptsFailureArtifact() {
  const report = {
    metric: 'sales-ppc',
    source: 'file',
    startedAt: '2026-04-17T10:00:00.000Z',
    completedAt: '2026-04-17T10:00:01.000Z',
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
    verifySalesPpcRun(report, { filePath: '/tmp/sales-ppc-failure.json' }),
    {
      status: 'failed',
      stage: 'compute',
      itemCount: 0,
      warningCount: 0,
      mismatchCount: 0,
    },
  );
}

function testWorkflowComputeNodeContract() {
  const workflow = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../workflows/Get Sales PPC.json'), 'utf8'));
  const computeNode = (workflow.nodes || []).find((node) => node.name === 'Code in JavaScript');
  const code = computeNode?.parameters?.jsCode || '';

  assert.match(code, /SALESPPC/);
  assert.match(code, /AD_SALES_\$/);
  assert.match(code, /values\[0\]/);
  assert.match(code, /row\.advertisedSku/);
  assert.match(code, /valueInputOption: 'USER_ENTERED'/);
}

function testWorkflowJsonParityContract() {
  assertWorkflowJsonParity(readSalesPpcWorkflowFixture());
}

function testWorkflowJsonParityFailureModes() {
  const workflow = readSalesPpcWorkflowFixture();

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

  const aliasRegression = deepCloneJson(workflow);
  getNodeByName(aliasRegression, 'Code in JavaScript').parameters.jsCode = getNodeByName(aliasRegression, 'Code in JavaScript').parameters.jsCode.replace(/'SALESPPC'/, '"NOSALESALIAS"');
  assert.throws(
    () => assertWorkflowJsonParity(aliasRegression),
    /\[workflow json parity\] AD_SALES_\$ alias coverage invariant missing/,
  );
}

function testWorkflowLocalRunnerExports() {
  assert.strictEqual(typeof readWorkflow, 'function', 'Expected readWorkflow export');
  assert.strictEqual(typeof runWorkflowCompute, 'function', 'Expected runWorkflowCompute export');
  assert.strictEqual(typeof runWorkflowLocally, 'function', 'Expected runWorkflowLocally export');
}

async function testWorkflowLocalRunnerStructuredMismatchSummary() {
  const summary = await runWorkflowLocally({
    workflow: path.resolve(__dirname, '../../workflows/Get Sales PPC.json'),
    report: path.resolve(__dirname, 'fixtures/sales-ppc-report-contract.json'),
    sheet: path.resolve(__dirname, 'fixtures/sales-ppc-workflow-local-sheet.json'),
    date: '2026-04-15',
    sheetName: 'Sheet1',
  });

  assertWorkflowLocalSummaryShape(summary);
  assert.strictEqual(summary.compute.localStatus, 'ok');
  assert.strictEqual(summary.compute.workflowStatus, 'ok');
  assert.strictEqual(summary.compute.status, 'ok');
  assert.strictEqual(summary.compute.mismatchCount, 0);
  assert.deepStrictEqual(summary.compute.reportOnlySkus, ['ATTR-LOGICAL']);
  assert.deepStrictEqual(summary.compute.sheetOnlySkus, ['SHEET-ONLY']);
  assert.strictEqual(summary.compute.updateCount, 4);
  assert.deepStrictEqual(summary.compute.mismatchPreview, []);
}

async function testWorkflowLocalRunnerSummaryShapeFailureModes() {
  const summary = await runWorkflowLocally({
    workflow: path.resolve(__dirname, '../../workflows/Get Sales PPC.json'),
    report: path.resolve(__dirname, 'fixtures/sales-ppc-report-contract.json'),
    sheet: path.resolve(__dirname, 'fixtures/sales-ppc-workflow-local-sheet.json'),
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

  const malformedSheetPath = path.join(__dirname, 'tmp-sales-ppc-workflow-local-malformed-sheet.json');
  await fs.promises.writeFile(malformedSheetPath, JSON.stringify({ date: '2026-04-15', sheetName: 'Sheet1' }), 'utf8');
  try {
    const failureSummary = await runWorkflowLocally({
      workflow: path.resolve(__dirname, '../../workflows/Get Sales PPC.json'),
      report: path.resolve(__dirname, 'fixtures/sales-ppc-report-contract.json'),
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
    await fs.promises.rm(malformedSheetPath, { force: true });
  }
}

function testRepoRootSalesPpcShimParityGrep() {
  const stdout = execFileSync(
    process.execPath,
    [path.resolve(__dirname, '../../tests/sales-ppc-tests.js'), '--grep', 'workflow json parity|workflow local runner|workflow compute node'],
    {
      cwd: path.resolve(__dirname, '../..'),
      encoding: 'utf8',
    },
  );

  assert.match(stdout, /Sales PPC tests passed/);
}

function readSalesPpcWorkflowFixture() {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../workflows/Get Sales PPC.json'), 'utf8'));
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

function assertConnectionInvariant(workflow, fromNode, toNode) {
  const actualTarget = workflow?.connections?.[fromNode]?.main?.[0]?.[0]?.node;
  if (actualTarget !== toNode) {
    throw new Error(`[workflow json parity] connection mismatch: ${fromNode} -> ${toNode}`);
  }
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
  const sheetReadNode = getNodeOrThrow(workflow, 'Webhook Read Google Sheet');
  const updateNode = getNodeOrThrow(workflow, 'Webhook Update Google Sheet');
  void sheetReadNode;
  void updateNode;

  const code = computeNode.parameters?.jsCode || '';
  if (!code.trim()) {
    throw new Error('[workflow json parity] missing jsCode on node: Code in JavaScript');
  }

  assertCodeInvariant(code, /AD_SALES_\$/, 'AD_SALES_$ alias coverage invariant missing');
  assertCodeInvariant(code, /SALESPPC/, 'AD_SALES_$ alias coverage invariant missing');
  assertCodeInvariant(code, /Extract from File/, 'report extract dependency invariant missing');
  assertCodeInvariant(code, /Set Credentials/, 'sheet-name dependency invariant missing');
  assertCodeInvariant(code, /valueInputOption: 'USER_ENTERED'/, 'batch update payload invariant missing');
  assertCodeInvariant(code, /row\.advertisedSku/, 'report SKU aggregation invariant missing');

  assertConnectionInvariant(workflow, 'Webhook Read Google Sheet', 'Code in JavaScript');
  assertConnectionInvariant(workflow, 'Code in JavaScript', 'Webhook Update Google Sheet');
}

async function testRunTestsMainInvokesSalesPpcCoverage() {
  const { main: runAllTestsMain } = require('./run-tests');
  const logs = [];
  await runAllTestsMain({
    argv: [],
    runBsrTests: async () => logs.push('stub-bsr'),
    runSalesOrganicTests: async () => logs.push('stub-sales-organic'),
    runSalesPpcTests: async () => logs.push('stub-sales-ppc'),
    runUnitsOrganicTests: async () => logs.push('stub-units-organic'),
    log: (...args) => logs.push(args.join(' ')),
  });

  assert(logs.includes('stub-bsr'));
  assert(logs.includes('stub-sales-organic'));
  assert(logs.includes('stub-sales-ppc'));
  assert(logs.includes('stub-units-organic'));
  assert(logs.includes('All tests passed.'));
}

function buildVerifierSuccessReport({ withMismatch = false } = {}) {
  const items = [
    {
      sku: 'SKU1',
      reportSalesPpc: 10,
      expectedSalesPpc: 10,
      salesDelta: 0,
      comparisonStatus: 'match',
      source: 'file',
      reportPresent: true,
      fixturePresent: true,
      notes: '',
      productLabel: '',
      provenance: {
        preferredSalesField: 'sales7d',
        rawPreferredSalesField: 'sales7d',
        chosenField: 'sales7d',
        rawChosenField: 'sales7d',
        rowCount: 1,
        fallbackRows: 0,
        sales7d: 1,
        attributedSales7d: 0,
        attributedSalesSameSku7d: 0,
      },
    },
    {
      sku: 'SKU2',
      reportSalesPpc: withMismatch ? 20.5 : 20,
      expectedSalesPpc: 20,
      salesDelta: withMismatch ? 0.5 : 0,
      comparisonStatus: withMismatch ? 'mismatch' : 'match',
      source: 'file',
      reportPresent: true,
      fixturePresent: true,
      notes: '',
      productLabel: '',
      provenance: {
        preferredSalesField: 'sales7d',
        rawPreferredSalesField: 'sales7d',
        chosenField: withMismatch ? 'mixed' : 'sales7d',
        rawChosenField: withMismatch ? 'mixed' : 'sales7d',
        rowCount: withMismatch ? 2 : 1,
        fallbackRows: withMismatch ? 1 : 0,
        sales7d: 1,
        attributedSales7d: withMismatch ? 1 : 0,
        attributedSalesSameSku7d: 0,
      },
    },
  ];

  const mismatches = withMismatch
    ? [
      {
        sku: 'SKU2',
        reportSalesPpc: 20.5,
        expectedSalesPpc: 20,
        salesDelta: 0.5,
        chosenField: 'mixed',
        rawChosenField: 'mixed',
        fallbackRows: 1,
      },
    ]
    : [];

  return {
    metric: 'sales-ppc',
    source: 'file',
    startedAt: '2026-04-17T10:00:00.000Z',
    completedAt: '2026-04-17T10:00:01.000Z',
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
      preferredSalesField: 'sales7d',
      rawPreferredSalesField: 'sales7d',
      fieldUsage: withMismatch
        ? { sales7d: 2, attributedSales7d: 1, attributedSalesSameSku7d: 0 }
        : { sales7d: 2, attributedSales7d: 0, attributedSalesSameSku7d: 0 },
      downloadedBytes: 120,
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
      { stage: 'download-report', attempt: 1, status: 'success', reportId: 'r1', reportDocumentId: 'd1', bytes: 120 },
      { stage: 'parse', attempt: 1, status: 'success', message: '' },
      { stage: 'compute', attempt: 1, status: 'success', message: 'Computed 2 SKU rows' },
    ],
    reportInfo: {
      reportType: 'spAdvertisedProduct',
      reportId: 'r1',
      reportDocumentId: 'd1',
      processingStatus: 'COMPLETED',
      contentType: 'application/json',
      preferredSalesField: 'sales7d',
      rawPreferredSalesField: 'sales7d',
    },
    comparison: {
      source: 'file',
      tolerance: 0.01,
      extraReportSkus: ['EXTRA'],
      mismatches,
    },
    items,
    warnings: withMismatch
      ? ['1 report SKUs were outside the comparison target set.', '1 SKU rows differ from the expected Sales PPC fixture.']
      : ['1 report SKUs were outside the comparison target set.'],
  };
}

function buildAxiosStub(steps) {
  const queue = steps.slice();
  return {
    post: async (url, body, config) => handleAxiosCall(queue, 'post', url, body, config),
    get: async (url, config) => handleAxiosCall(queue, 'get', url, undefined, config),
  };
}

async function handleAxiosCall(queue, method, url, body, config) {
  const next = queue.shift();
  if (!next) {
    throw new Error(`Unexpected ${method.toUpperCase()} ${url}`);
  }

  assert.strictEqual(next.method, method, `Expected ${next.method} but received ${method} for ${url}`);
  if (next.match) {
    assert.strictEqual(String(url).includes(next.match), true, `Expected URL ${url} to include ${next.match}`);
  }

  if (typeof next.assert === 'function') {
    next.assert({ url, body, config });
  }

  if (next.error) {
    throw next.error;
  }

  return next.response;
}

function buildHttpError(message, status, headers = {}) {
  const error = new Error(message);
  error.response = {
    status,
    headers,
    data: {
      message,
    },
  };
  return error;
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

async function runSalesPpcTests(grepValue = '') {
  const selected = tests.filter((test) => matchesGrep(test.name, grepValue));

  if (!selected.length) {
    throw new Error(`No Sales PPC tests matched grep: ${grepValue}`);
  }

  for (const test of selected) {
    await test.fn();
  }

  console.log(`Sales PPC tests passed (${selected.length}/${tests.length}).`);
}

async function main() {
  const argv = process.argv.slice(2);
  const grepIndex = argv.indexOf('--grep');
  const grepValue = grepIndex >= 0 ? argv[grepIndex + 1] || '' : '';
  await runSalesPpcTests(grepValue);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  runSalesPpcTests,
};
