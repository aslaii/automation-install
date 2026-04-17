const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDateRange(startDate, endDate) {
  if (!startDate) {
    throw new Error('Missing required --date YYYY-MM-DD');
  }
  if (!DATE_RE.test(startDate)) {
    throw new Error(`Invalid --date value: ${startDate}`);
  }
  const effectiveEndDate = endDate || startDate;
  if (!DATE_RE.test(effectiveEndDate)) {
    throw new Error(`Invalid --end-date value: ${effectiveEndDate}`);
  }
  if (effectiveEndDate < startDate) {
    throw new Error('--end-date cannot be earlier than --date');
  }

  return {
    startDate,
    endDate: effectiveEndDate,
    sameDay: startDate === effectiveEndDate,
  };
}

module.exports = {
  parseDateRange,
};
