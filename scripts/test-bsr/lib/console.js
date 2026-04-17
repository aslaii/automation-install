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
    bsr: item.bsr,
    displayGroup: item.preferredDisplay?.websiteDisplayGroup || '',
    classificationMin: item.classificationMin,
    error: item.error?.message || '',
  }));

  console.log('[BSR] Items');
  console.table(preview);
  console.log(`[BSR] Report saved: ${reportPath}`);
}

module.exports = {
  printBsrReport,
};
