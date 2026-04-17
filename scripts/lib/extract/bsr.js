function extractBsr(payload) {
  const marketplaces = Array.isArray(payload?.salesRanks) ? payload.salesRanks : [];
  const displayGroupRanks = [];
  const classificationRanks = [];
  const allRanks = [];

  for (const marketplace of marketplaces) {
    for (const entry of marketplace.displayGroupRanks || []) {
      const rank = toPositiveNumber(entry.rank);
      if (rank !== null) {
        displayGroupRanks.push({
          websiteDisplayGroup: entry.websiteDisplayGroup || '',
          title: entry.title || '',
          rank,
        });
        allRanks.push(rank);
      }
    }

    for (const entry of marketplace.classificationRanks || []) {
      const rank = toPositiveNumber(entry.rank);
      if (rank !== null) {
        classificationRanks.push({
          classificationId: entry.classificationId || '',
          title: entry.title || '',
          rank,
        });
        allRanks.push(rank);
      }
    }
  }

  const preferredDisplay = displayGroupRanks.find((entry) => entry.websiteDisplayGroup === 'grocery_display_on_website')
    || displayGroupRanks[0]
    || null;

  const classificationMin = classificationRanks.length
    ? Math.min(...classificationRanks.map((entry) => entry.rank))
    : null;

  return {
    bsr: preferredDisplay?.rank ?? null,
    preferredDisplay,
    classificationMin,
    displayGroupRanks,
    classificationRanks,
    allRanks,
  };
}

function toPositiveNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

module.exports = {
  extractBsr,
};
