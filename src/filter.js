/**
 * Filters jobs against search keywords, exclusion keywords, and location requirements.
 */
export function matchesSearchCriteria(job, searchConfig) {
  const {
    includeKeywords = [],
    excludeKeywords = [],
    locations = [],
    requireRemote = false,
    maxAgeDays = 21
  } = searchConfig;

  // 1. Age check (ignore listings older than maxAgeDays, default 3 weeks)
  if (maxAgeDays && job.updatedAt) {
    const jobDate = new Date(job.updatedAt).getTime();
    if (!isNaN(jobDate)) {
      const ageDays = (Date.now() - jobDate) / (1000 * 60 * 60 * 24);
      if (ageDays > maxAgeDays) {
        return { matches: false, reason: `Listing is ${Math.round(ageDays)} days old (exceeds ${maxAgeDays} days limit)` };
      }
    }
  }

  const titleLower = (job.title || "").toLowerCase();
  const deptLower = (job.department || "").toLowerCase();
  const locLower = (job.location || "").toLowerCase();
  const fullText = `${titleLower} ${deptLower} ${locLower}`;

  // 2. Exclude keywords check
  for (const ex of excludeKeywords) {
    if (!ex) continue;
    const exLower = ex.toLowerCase().trim();
    if (exLower.length <= 4 && !exLower.includes(" ") && !exLower.includes(".")) {
      const regex = new RegExp(`\\b${exLower}\\b`, "i");
      if (regex.test(titleLower)) {
        return { matches: false, reason: `Excluded keyword: "${ex}"` };
      }
    } else if (titleLower.includes(exLower)) {
      return { matches: false, reason: `Excluded keyword: "${ex}"` };
    }
  }

  // 2. Remote check
  if (requireRemote && !job.isRemote && !locLower.includes("remote")) {
    return { matches: false, reason: "Requires remote, but job is not marked remote" };
  }

  // 3. Location filter (if specified)
  if (locations.length > 0 && !job.isRemote && !locLower.includes("remote")) {
    const matchedLoc = locations.some((loc) => locLower.includes(loc.toLowerCase()));
    if (!matchedLoc) {
      return { matches: false, reason: `Location "${job.location}" outside target locations` };
    }
  }

  // 4. Include keywords check
  if (includeKeywords.length > 0) {
    const matchedKeyword = includeKeywords.find((kw) => {
      const kwLower = kw.toLowerCase();
      // Look in title first, then department
      return titleLower.includes(kwLower) || deptLower.includes(kwLower);
    });

    if (!matchedKeyword) {
      return { matches: false, reason: "No include keywords matched" };
    }
    return { matches: true, matchedKeyword };
  }

  return { matches: true, matchedKeyword: "ALL" };
}
