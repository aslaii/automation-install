function printBsrReport(report, reportPath) {
  console.log('\n[BSR] Summary');
  console.table([report.summary]);

  if (report.warnings?.length) {
    for (const warning of report.warnings) {
      console.warn(`[BSR] Warning: ${warning}`);
    }
  }

  const preview = report.items.map((item) => ({
    sku: item.sku,
    asin: item.asin,
    status: item.status,
    attempts: item.attempts || 1,
    bsr: item.bsr,
    displayGroup: item.preferredDisplay?.websiteDisplayGroup || '',
    classificationMin: item.classificationMin,
    error: item.error?.message || '',
  }));

  console.log('[BSR] Items');
  console.table(preview);
  console.log(`[BSR] Report saved: ${reportPath}`);
}

function printSalesOrganicReport(report, reportPath) {
  console.log('\n[Sales Organic] Summary');
  console.table([{
    status: report.status,
    stage: report.stage,
    createAttempts: report.summary?.attempts?.create || 0,
    pollAttempts: report.summary?.attempts?.poll || 0,
    parsedSkus: report.summary?.parsedSkuCount || 0,
    computedSkus: report.summary?.computedSkuCount || 0,
    mismatches: report.summary?.mismatchedSkuCount || 0,
    processingStatus: report.reportInfo?.processingStatus || '',
    reportId: report.reportInfo?.reportId || '',
    reportDocumentId: report.reportInfo?.reportDocumentId || '',
  }]);

  if (report.lifecycle?.length) {
    console.log('[Sales Organic] Lifecycle');
    console.table(report.lifecycle.map((entry) => ({
      stage: entry.stage,
      attempt: entry.attempt,
      status: entry.status,
      httpStatus: entry.httpStatus || '',
      bytes: entry.bytes || '',
      message: entry.message || '',
    })));
  }

  if (report.items?.length) {
    console.log('[Sales Organic] Items');
    console.table(report.items.map((item) => ({
      sku: item.sku,
      totalSales: item.totalSales,
      adSales: item.adSales,
      salesOrganic: item.salesOrganic,
      expected: item.expectedSalesOrganic ?? '',
      delta: item.organicDelta ?? '',
      status: item.comparisonStatus,
    })));
  }

  if (report.comparison?.mismatches?.length) {
    console.log('[Sales Organic] Mismatches');
    console.table(report.comparison.mismatches.map((item) => ({
      sku: item.sku,
      totalSales: item.totalSales,
      adSales: item.adSales,
      actual: item.salesOrganic,
      expected: item.expectedSalesOrganic,
      delta: item.organicDelta,
    })));
  }

  if (report.warnings?.length) {
    for (const warning of report.warnings) {
      console.warn(`[Sales Organic] Warning: ${warning}`);
    }
  }

  if (report.error) {
    console.error(`[Sales Organic] Error: ${report.error.message}`);
  }

  console.log(`[Sales Organic] Report saved: ${reportPath}`);
}

function printSalesPpcReport(report, reportPath) {
  console.log('\n[Sales PPC] Summary');
  console.table([{
    status: report.status,
    stage: report.stage,
    createAttempts: report.summary?.attempts?.create || 0,
    pollAttempts: report.summary?.attempts?.poll || 0,
    parsedRows: report.summary?.parsedRowCount || 0,
    parsedSkus: report.summary?.parsedSkuCount || 0,
    computedSkus: report.summary?.computedSkuCount || 0,
    mismatches: report.summary?.mismatchedSkuCount || 0,
    preferredSalesField: report.summary?.preferredSalesField || '',
    processingStatus: report.reportInfo?.processingStatus || '',
    reportId: report.reportInfo?.reportId || '',
    reportDocumentId: report.reportInfo?.reportDocumentId || '',
  }]);

  if (report.lifecycle?.length) {
    console.log('[Sales PPC] Lifecycle');
    console.table(report.lifecycle.map((entry) => ({
      stage: entry.stage,
      attempt: entry.attempt,
      status: entry.status,
      httpStatus: entry.httpStatus || '',
      bytes: entry.bytes || '',
      message: entry.message || '',
    })));
  }

  if (report.items?.length) {
    console.log('[Sales PPC] Items');
    console.table(report.items.map((item) => ({
      sku: item.sku,
      actual: item.reportSalesPpc,
      expected: item.expectedSalesPpc ?? '',
      delta: item.salesDelta ?? '',
      field: item.provenance?.chosenField || '',
      fallbackRows: item.provenance?.fallbackRows || 0,
      status: item.comparisonStatus,
    })));
  }

  if (report.comparison?.mismatches?.length) {
    console.log('[Sales PPC] Mismatches');
    console.table(report.comparison.mismatches.map((item) => ({
      sku: item.sku,
      actual: item.reportSalesPpc,
      expected: item.expectedSalesPpc,
      delta: item.salesDelta,
      field: item.chosenField || '',
      fallbackRows: item.fallbackRows,
    })));
  }

  if (report.warnings?.length) {
    for (const warning of report.warnings) {
      console.warn(`[Sales PPC] Warning: ${warning}`);
    }
  }

  if (report.error) {
    console.error(`[Sales PPC] Error: ${report.error.message}`);
  }

  console.log(`[Sales PPC] Report saved: ${reportPath}`);
}

function printCtrReport(report, reportPath) {
  console.log('\n[CTR] Summary');
  console.table([{
    status: report.status,
    stage: report.stage,
    createAttempts: report.summary?.attempts?.create || 0,
    pollAttempts: report.summary?.attempts?.poll || 0,
    parsedRows: report.summary?.parsedRowCount || 0,
    parsedSkus: report.summary?.parsedSkuCount || 0,
    computedSkus: report.summary?.computedSkuCount || 0,
    mismatches: report.summary?.mismatchedSkuCount || 0,
    processingStatus: report.reportInfo?.processingStatus || '',
    reportId: report.reportInfo?.reportId || '',
    reportDocumentId: report.reportInfo?.reportDocumentId || '',
  }]);

  if (report.lifecycle?.length) {
    console.log('[CTR] Lifecycle');
    console.table(report.lifecycle.map((entry) => ({
      stage: entry.stage,
      attempt: entry.attempt,
      status: entry.status,
      httpStatus: entry.httpStatus || '',
      bytes: entry.bytes || '',
      message: entry.message || '',
    })));
  }

  if (report.items?.length) {
    console.log('[CTR] Items');
    console.table(report.items.map((item) => ({
      sku: item.sku,
      clicks: item.clicks,
      impressions: item.impressions,
      ctr: item.ctr,
      expected: item.expectedCtr ?? '',
      delta: item.ctrDelta ?? '',
      status: item.comparisonStatus,
    })));
  }

  if (report.comparison?.mismatches?.length) {
    console.log('[CTR] Mismatches');
    console.table(report.comparison.mismatches.map((item) => ({
      sku: item.sku,
      clicks: item.clicks,
      impressions: item.impressions,
      actual: item.ctr,
      expected: item.expectedCtr,
      delta: item.ctrDelta,
    })));
  }

  if (report.warnings?.length) {
    for (const warning of report.warnings) {
      console.warn(`[CTR] Warning: ${warning}`);
    }
  }

  if (report.error) {
    console.error(`[CTR] Error: ${report.error.message}`);
  }

  console.log(`[CTR] Report saved: ${reportPath}`);
}

function printUnitsOrganicReport(report, reportPath) {
  console.log('\n[Units Organic] Summary');
  console.table([{
    status: report.status,
    stage: report.stage,
    createAttempts: report.summary?.attempts?.create || 0,
    pollAttempts: report.summary?.attempts?.poll || 0,
    parsedSkus: report.summary?.parsedSkuCount || 0,
    computedSkus: report.summary?.computedSkuCount || 0,
    mismatches: report.summary?.mismatchedSkuCount || 0,
    processingStatus: report.reportInfo?.processingStatus || '',
    reportId: report.reportInfo?.reportId || '',
    reportDocumentId: report.reportInfo?.reportDocumentId || '',
  }]);

  if (report.lifecycle?.length) {
    console.log('[Units Organic] Lifecycle');
    console.table(report.lifecycle.map((entry) => ({
      stage: entry.stage,
      attempt: entry.attempt,
      status: entry.status,
      httpStatus: entry.httpStatus || '',
      bytes: entry.bytes || '',
      message: entry.message || '',
    })));
  }

  if (report.items?.length) {
    console.log('[Units Organic] Items');
    console.table(report.items.map((item) => ({
      sku: item.sku,
      totalUnits: item.totalUnits,
      adUnits: item.adUnits,
      salesOrganicQty: item.salesOrganicQty,
      expected: item.expectedSalesOrganicQty ?? '',
      delta: item.organicQtyDelta ?? '',
      status: item.comparisonStatus,
    })));
  }

  if (report.comparison?.mismatches?.length) {
    console.log('[Units Organic] Mismatches');
    console.table(report.comparison.mismatches.map((item) => ({
      sku: item.sku,
      totalUnits: item.totalUnits,
      adUnits: item.adUnits,
      actual: item.salesOrganicQty,
      expected: item.expectedSalesOrganicQty,
      delta: item.organicQtyDelta,
    })));
  }

  if (report.warnings?.length) {
    for (const warning of report.warnings) {
      console.warn(`[Units Organic] Warning: ${warning}`);
    }
  }

  if (report.error) {
    console.error(`[Units Organic] Error: ${report.error.message}`);
  }

  console.log(`[Units Organic] Report saved: ${reportPath}`);
}

module.exports = {
  printBsrReport,
  printSalesOrganicReport,
  printSalesPpcReport,
  printCtrReport,
  printUnitsOrganicReport,
};
