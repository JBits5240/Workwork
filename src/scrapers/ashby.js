/**
 * Scraper for Ashby public posting API
 * Endpoint: https://api.ashbyhq.com/posting-api/job-board/{slug}
 */
export async function scrapeAshby(company, timeoutMs = 10000) {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${company.slug}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json"
      }
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();
    const rawJobs = data.jobs || [];

    return rawJobs.map((j) => {
      const location = j.location || (j.secondaryLocations || []).map(l => l.location).join(", ") || "";
      const isRemote = Boolean(j.isRemote) || /remote/i.test(location) || /remote/i.test(j.title);

      return {
        id: `ashby_${company.slug}_${j.id}`,
        company: company.name,
        companySlug: company.slug,
        category: company.category || "FinTech",
        ats: "ashby",
        title: (j.title || "").trim(),
        location: location.trim(),
        department: j.department || j.team || "",
        url: j.jobUrl || `https://jobs.ashbyhq.com/${company.slug}/${j.id}`,
        isRemote,
        updatedAt: j.publishedAt || null
      };
    });
  } finally {
    clearTimeout(timer);
  }
}
