import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { scrapeGreenhouse } from "./scrapers/greenhouse.js";
import { scrapeAshby } from "./scrapers/ashby.js";
import { scrapeLever } from "./scrapers/lever.js";
import { matchesSearchCriteria } from "./filter.js";
import { JobDatabase } from "./database.js";
import { exportMarkdownDigest, exportJson } from "./exporter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");

// Helper for bounded concurrency
async function mapConcurrent(items, limit, fn) {
  const results = [];
  const executing = [];
  for (const item of items) {
    const p = Promise.resolve().then(() => fn(item));
    results.push(p);
    if (limit <= items.length) {
      const e = p.then(() => executing.splice(executing.indexOf(e), 1));
      executing.push(e);
      if (executing.length >= limit) {
        await Promise.race(executing);
      }
    }
  }
  return Promise.all(results);
}

async function main() {
  const args = process.argv.slice(2);
  const showStatsOnly = args.includes("--stats");
  const showAll = args.includes("--all");
  const companyFilterIndex = args.indexOf("--company");
  const singleCompany = companyFilterIndex !== -1 ? args[companyFilterIndex + 1]?.toLowerCase() : null;

  const db = new JobDatabase(path.join(ROOT_DIR, "data/jobs.db"));

  if (showStatsOnly) {
    const stats = db.getStats();
    console.log("\n📊 --- WORKWORK DATABASE STATS ---");
    console.log(`Total Tracked Jobs in DB: ${stats.total}`);
    console.log("By Status:");
    for (const s of stats.byStatus) {
      console.log(`  - ${s.status}: ${s.count}`);
    }
    console.log("Top Companies by Listings:");
    for (const c of stats.byCompany) {
      console.log(`  - ${c.company}: ${c.count}`);
    }
    db.close();
    return;
  }

  // Load config & companies
  const configPath = path.join(ROOT_DIR, "config.json");
  const companiesPath = path.join(ROOT_DIR, "companies.json");

  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  let companies = JSON.parse(fs.readFileSync(companiesPath, "utf8"));

  if (singleCompany) {
    companies = companies.filter(c => c.name.toLowerCase().includes(singleCompany) || c.slug.toLowerCase().includes(singleCompany));
    if (companies.length === 0) {
      console.error(`❌ No company found matching "${singleCompany}"`);
      db.close();
      return;
    }
  }

  console.log(`\n🔍 Scanning ${companies.length} FinTech startups across ATS platforms...`);
  console.log(`Target keywords: ${(config.search.includeKeywords || []).slice(0, 6).join(", ")}...`);
  console.log("------------------------------------------------------------------");

  const startTime = Date.now();
  const concurrency = config.settings.concurrency || 8;
  const timeoutMs = config.settings.requestTimeoutMs || 10000;

  let totalJobsFound = 0;
  let totalMatches = 0;
  const newlyDiscoveredJobs = [];

  const scraperResults = await mapConcurrent(companies, concurrency, async (company) => {
    let jobs = [];
    try {
      if (company.ats === "greenhouse") {
        jobs = await scrapeGreenhouse(company, timeoutMs);
      } else if (company.ats === "ashby") {
        jobs = await scrapeAshby(company, timeoutMs);
      } else if (company.ats === "lever") {
        jobs = await scrapeLever(company, timeoutMs);
      }
    } catch (err) {
      return { company: company.name, status: "ERROR", error: err.message, jobs: [] };
    }

    return { company: company.name, status: "OK", jobs };
  });

  for (const res of scraperResults) {
    if (res.status === "ERROR") {
      console.log(`⚠️  ${res.company.padEnd(20)} [${res.status}] ${res.error}`);
      continue;
    }

    totalJobsFound += res.jobs.length;
    let companyMatches = 0;

    for (const job of res.jobs) {
      const matchResult = matchesSearchCriteria(job, config.search);
      if (matchResult.matches) {
        companyMatches++;
        totalMatches++;

        const { isNew, job: savedJob } = db.upsertJob(job, matchResult.matchedKeyword);
        if (isNew) {
          newlyDiscoveredJobs.push(savedJob);
        }
      }
    }

    const newLabel = newlyDiscoveredJobs.filter(j => j.company === res.company).length;
    console.log(`✅ ${res.company.padEnd(20)} | Found: ${String(res.jobs.length).padStart(3)} | Matched: ${String(companyMatches).padStart(2)} | New: ${newLabel}`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("------------------------------------------------------------------");
  console.log(`⏱️  Finished scan in ${elapsed}s`);
  console.log(`📈 Total Active Postings Inspected: ${totalJobsFound}`);
  console.log(`🎯 Postings Matching Criteria:    ${totalMatches}`);
  console.log(`✨ Newly Discovered Unique Jobs:   ${newlyDiscoveredJobs.length}`);

  // Export results: export all unapplied ('NEW') jobs so the digest is a complete checklist
  const mdPath = path.join(ROOT_DIR, config.settings.exportMarkdownPath || "matches_digest.md");
  const jsonPath = path.join(ROOT_DIR, config.settings.exportJsonPath || "matches.json");

  const unappliedJobs = db.getJobsByStatus("NEW");
  exportMarkdownDigest(unappliedJobs, mdPath, config.search);
  exportJson(unappliedJobs, jsonPath);

  console.log(`\n📄 Active apply checklist (${unappliedJobs.length} jobs): ${mdPath}`);
  console.log(`💾 Saved structured JSON output:                       ${jsonPath}`);

  if (newlyDiscoveredJobs.length > 0) {
    console.log("\n🔥 TOP BRAND NEW MATCHES FROM THIS SCAN:");
    const sample = newlyDiscoveredJobs.slice(0, 10);
    for (const j of sample) {
      console.log(`\n  • ${j.title} (${j.company})`);
      console.log(`    Location: ${j.location || "N/A"} ${j.isRemote ? "[REMOTE]" : ""}`);
      console.log(`    Link:     ${j.url}`);
    }
    if (newlyDiscoveredJobs.length > 10) {
      console.log(`\n  ... and ${newlyDiscoveredJobs.length - 10} more in matches_digest.md`);
    }
  } else {
    console.log(`\n👍 No brand new jobs since last scan. You have ${unappliedJobs.length} open unapplied jobs in matches_digest.md ready for you.`);
  }

  db.close();
}

main().catch(err => {
  console.error("Fatal Error:", err);
  process.exit(1);
});
