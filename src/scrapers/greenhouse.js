/**
 * Scraper for Greenhouse public boards API
 * Endpoint: https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true
 */
export async function scrapeGreenhouse(company, timeoutMs = 10000) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${company.slug}/jobs`;
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
      const locationName = j.location?.name || "";
      const isRemote = /remote/i.test(locationName) || /remote/i.test(j.title);
      const departments = (j.departments || []).map((d) => d.name).filter(Boolean);

      return {
        id: `gh_${company.slug}_${j.id}`,
        company: company.name,
        companySlug: company.slug,
        category: company.category || "FinTech",
        ats: "greenhouse",
        title: (j.title || "").trim(),
        location: locationName.trim(),
        department: departments.join(", "),
        url: j.absolute_url || `https://boards.greenhouse.io/${company.slug}/jobs/${j.id}`,
        isRemote,
        updatedAt: j.updated_at || null
      };
    });
  } finally {
    clearTimeout(timer);
  }
}
