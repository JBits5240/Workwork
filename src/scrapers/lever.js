/**
 * Scraper for Lever public postings API
 * Endpoint: https://api.lever.co/v0/postings/{slug}?mode=json
 */
export async function scrapeLever(company, timeoutMs = 10000) {
  const url = `https://api.lever.co/v0/postings/${company.slug}?mode=json`;
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

    const rawJobs = await res.json();
    if (!Array.isArray(rawJobs)) return [];

    return rawJobs.map((j) => {
      const location = j.categories?.location || "";
      const isRemote = /remote/i.test(location) || /remote/i.test(j.text || "");
      const department = j.categories?.department || j.categories?.team || "";

      return {
        id: `lever_${company.slug}_${j.id}`,
        company: company.name,
        companySlug: company.slug,
        category: company.category || "FinTech",
        ats: "lever",
        title: (j.text || "").trim(),
        location: location.trim(),
        department: department.trim(),
        url: j.hostedUrl || `https://jobs.lever.co/${company.slug}/${j.id}`,
        isRemote,
        updatedAt: j.createdAt ? new Date(j.createdAt).toISOString() : null
      };
    });
  } finally {
    clearTimeout(timer);
  }
}
