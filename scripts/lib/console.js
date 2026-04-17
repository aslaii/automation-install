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

module.exports = {
  printBsrReport,
  printSalesOrganicReport,
};
