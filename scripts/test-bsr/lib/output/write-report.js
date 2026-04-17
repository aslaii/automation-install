const fs = require('fs');
const path = require('path');

async function writeReport({ metric, report, dateRange }) {
  const runsDir = path.join(__dirname, '..', '..', 'runs');
  await fs.promises.mkdir(runsDir, { recursive: true });
  const safeDate = `${dateRange.startDate}_to_${dateRange.endDate}`;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(runsDir, `${metric}-${safeDate}-${timestamp}.json`);
  await fs.promises.writeFile(filePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return filePath;
}

module.exports = {
  writeReport,
};
