import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { scrapeGreenhouse } from "./scrapers/greenhouse.js";
import { scrapeAshby } from "./scrapers/ashby.js";
import { scrapeLever } from "./scrapers/lever.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");

export const USER_RESUME_PROFILE = {
  name: "YOUR NAME",
  currentRole: "Software Quality Assurance Analyst",
  tagline: "Software QA Analyst — testing, code review, AI integration, and automation infrastructure",
  location: "Your City, ST / United States (Remote Preferred)",
  experience: [
    {
      company: "TechCorp Inc.",
      title: "Software Quality Assurance Analyst",
      period: "2022–Present",
      highlights: [
        "Code review, manual and exploratory testing across web and apps",
        "Built AI pipeline tool cutting ticket completion time by ~75% and enabling simultaneous ticket testing",
        "Pushed for automation on workflow pain points; built internal tooling & infrastructure",
        "Led hands-on AI skills sessions and workshops for teams and clients"
      ]
    },
    {
      company: "Field Dynamics LLC",
      title: "Lead Field Operations Specialist",
      period: "2016–2020",
      highlights: ["Field equipment, customer service, training, team operations"]
    }
  ],
  skills: {
    qa: ["qa", "quality assurance", "quality engineer", "test", "testing", "uat", "exploratory", "regression", "sdet", "verification"],
    automation: ["automation", "playwright", "pipeline", "infrastructure", "tooling", "scripting"],
    ai: ["ai integration", "ai pipeline", "ai adoption", "prompt", "workflow", "ai tooling", "claude", "cursor"],
    supportSolutions: ["technical support", "support engineer", "solutions engineer", "customer engineering", "tier 2", "tier 3", "operations analyst"],
    languages: ["ruby", "python", "rust"]
  }
};

/**
 * Scores a job against candidate's specific resume profile.
 * Returns { score, tier, matchReasons, isRemoteUs }
 */
export function scoreJobAgainstResume(job, maxAgeDays = 21) {
  let score = 0;
  const matchReasons = [];

  // 0. Age check: ignore listings older than 3 weeks (21 days)
  if (maxAgeDays && job.updatedAt) {
    const jobDate = new Date(job.updatedAt).getTime();
    if (!isNaN(jobDate)) {
      const ageDays = (Date.now() - jobDate) / (1000 * 60 * 60 * 24);
      if (ageDays > maxAgeDays) {
        return { score: 0, tier: "EXCLUDED", matchReasons: [`Listing is ${Math.round(ageDays)} days old (> 21 days)`] };
      }
    }
  }

  const title = (job.title || "").toLowerCase();
  const dept = (job.department || "").toLowerCase();
  const loc = (job.location || "").toLowerCase();
  const fullText = `${title} ${dept}`;

  // Check Location: Remote or US based is preferred
  const isRemote = job.isRemote || /remote/i.test(loc) || /remote/i.test(title);
  const isExcludedGeo = /(london|uk|united kingdom|canada|emea|latam|india|singapore|berlin|germany|mexico|taiwan|paris|argentina|brazil|uae|dubai|united arab emirates|europe|france|spain)/i.test(loc);
  const isUS = !isExcludedGeo && (/(remote.*(us|usa)|us.*remote|united states|oklahoma|new york|san francisco|austin|seattle|california|remote)/i.test(loc) || isRemote);
  
  // Hard penalties for non-applicable regions or executive titles
  if (/(director|vice president|vp|head of|counsel|account executive|sales rep)/i.test(title)) {
    return { score: 0, tier: "EXCLUDED", matchReasons: ["Executive or Non-Technical Sales role"] };
  }
  if (isExcludedGeo) {
    return { score: 0, tier: "EXCLUDED", matchReasons: ["Outside US / Excluded Region"] };
  }

  // 1. Direct QA / Quality / Test Title (Highest Match)
  if (/\b(qa|quality|test|testing|sdet|uat)\b/i.test(title)) {
    if (/\b(analyst|specialist|coordinator|associate)\b/i.test(title)) {
      score += 60;
      matchReasons.push("Direct QA/Test Analyst title match (Matches current role)");
    } else if (/\b(engineer ii|engineer|automation engineer|automation developer)\b/i.test(title)) {
      score += 55;
      matchReasons.push("QA/Test/Automation Engineer (Matches QA + automation profile)");
    } else if (/\b(lead|senior|staff)\b/i.test(title)) {
      score += 45;
      matchReasons.push("Senior/Lead QA (Relevant domain, higher seniority)");
    } else {
      score += 50;
      matchReasons.push("Quality / Testing domain match");
    }
  }

  // 2. Technical Support / Solutions / Customer Engineering Match
  if (/\b(support engineer|technical support|solutions engineer|customer engineer|triage)\b/i.test(title)) {
    score += 35;
    matchReasons.push("Technical Support / Solutions Engineering (Matches troubleshooting, client coaching, and QA background)");
  }

  // 3. Automation & AI Workflow / Tooling
  if (/\b(automation|ai ops|workflow|internal tools|developer experience)\b/i.test(fullText)) {
    score += 20;
    matchReasons.push("Automation / Tooling / AI workflow focus");
  }

  // 4. Remote US Bonus
  if (isRemote && isUS) {
    score += 15;
    matchReasons.push("US Remote friendly");
  } else if (isRemote) {
    score += 10;
    matchReasons.push("Remote friendly");
  }

  // Determine Match Tier
  let tier = "TIER_3_ADJACENT";
  if (score >= 60) {
    tier = "TIER_1_EXACT";
  } else if (score >= 45) {
    tier = "TIER_2_STRONG";
  } else if (score < 25) {
    tier = "LOW_MATCH";
  }

  return {
    score,
    tier,
    isRemoteUs: isRemote && isUS,
    matchReasons
  };
}

async function runResumeMatcher() {
  const companiesPath = path.join(ROOT_DIR, "companies.json");
  const companies = JSON.parse(fs.readFileSync(companiesPath, "utf8"));

  console.log(`\n🎯 CROSS-REFERENCING FinTech Jobs against Candidate's Resume:`);
  console.log(`• Profile: ${USER_RESUME_PROFILE.currentRole}`);
  console.log(`• Core Focus: QA, Test Automation (Playwright), AI Tooling, Code Review`);
  console.log(`• Preferred: Remote (US)`);
  console.log("------------------------------------------------------------------");

  const startTime = Date.now();
  let allRawJobs = [];

  // Scrape all companies
  for (const company of companies) {
    try {
      let jobs = [];
      if (company.ats === "greenhouse") {
        jobs = await scrapeGreenhouse(company, 8000);
      } else if (company.ats === "ashby") {
        jobs = await scrapeAshby(company, 8000);
      } else if (company.ats === "lever") {
        jobs = await scrapeLever(company, 8000);
      }
      allRawJobs.push(...jobs);
    } catch {}
  }

  console.log(`Scanned ${allRawJobs.length} active listings across ${companies.length} FinTech startups.`);

  // Score all jobs
  const scoredJobs = [];
  for (const job of allRawJobs) {
    const analysis = scoreJobAgainstResume(job);
    if (analysis.score >= 30) {
      scoredJobs.push({
        ...job,
        score: analysis.score,
        tier: analysis.tier,
        matchReasons: analysis.matchReasons,
        isRemoteUs: analysis.isRemoteUs
      });
    }
  }

  // Sort descending by score
  scoredJobs.sort((a, b) => b.score - a.score);

  const tier1 = scoredJobs.filter(j => j.tier === "TIER_1_EXACT");
  const tier2 = scoredJobs.filter(j => j.tier === "TIER_2_STRONG");
  const tier3 = scoredJobs.filter(j => j.tier === "TIER_3_ADJACENT");

  console.log(`\n✨ MATCH RESULTS FOR CANDIDATE:`);
  console.log(`  🌟 Tier 1 (Direct QA / Test Analyst / UAT Matches):  ${tier1.length}`);
  console.log(`  ⚡ Tier 2 (QA Automation / QA II / Testing Infra):    ${tier2.length}`);
  console.log(`  🛠️ Tier 3 (Support Engineer / Solutions / AI Ops):   ${tier3.length}`);

  // Generate Resume Matches Report
  const reportPath = path.join(ROOT_DIR, "resume_matches.md");
  let md = `# 🎯 Tailored FinTech Job Matches\n\n`;
  md += `> **Candidate**: **YOUR NAME** — Software Quality Assurance Analyst  \n`;
  md += `> **Core Background**: QA (Manual/Exploratory, Regression), Test Automation (Playwright), AI Pipeline Tooling, Client Support  \n`;
  md += `> **Generated**: ${new Date().toLocaleString()}  \n\n`;

  md += `## 🌟 Tier 1: Highest Match (Direct QA, Test Analyst, & UAT)\n`;
  md += `*These roles directly align with your day-to-day software quality engineering background.*\n\n`;
  for (const j of tier1) {
    const remoteStr = j.isRemote ? "🌐 Remote" : "📍 On-Site";
    md += `### [${j.title}](${j.url}) — **${j.company}**\n`;
    md += `- **Location**: \`${remoteStr}\` ${j.location}\n`;
    md += `- **Match Score**: **${j.score}/100**\n`;
    md += `- **Why it matches**: ${j.matchReasons.join("; ")}\n`;
    md += `- [ ] [**Click to Apply Directly**](${j.url})\n\n`;
  }

  md += `## ⚡ Tier 2: Strong Match (QA Automation & Test Infrastructure)\n`;
  md += `*Roles leveraging your automation infrastructure, Playwright, and test tooling experience.*\n\n`;
  for (const j of tier2) {
    const remoteStr = j.isRemote ? "🌐 Remote" : "📍 On-Site";
    md += `### [${j.title}](${j.url}) — **${j.company}**\n`;
    md += `- **Location**: \`${remoteStr}\` ${j.location}\n`;
    md += `- **Match Score**: **${j.score}/100**\n`;
    md += `- **Why it matches**: ${j.matchReasons.join("; ")}\n`;
    md += `- [ ] [**Click to Apply Directly**](${j.url})\n\n`;
  }

  md += `## 🛠️ Tier 3: High-Value Adjacent Roles (Support & Solutions Engineering)\n`;
  md += `*Roles valuing your technical troubleshooting, customer service background, and AI training capabilities.*\n\n`;
  for (const j of tier3.slice(0, 15)) {
    const remoteStr = j.isRemote ? "🌐 Remote" : "📍 On-Site";
    md += `### [${j.title}](${j.url}) — **${j.company}**\n`;
    md += `- **Location**: \`${remoteStr}\` ${j.location}\n`;
    md += `- **Match Score**: **${j.score}/100**\n`;
    md += `- **Why it matches**: ${j.matchReasons.join("; ")}\n`;
    md += `- [ ] [**Click to Apply Directly**](${j.url})\n\n`;
  }

  fs.writeFileSync(reportPath, md, "utf8");
  console.log(`\n📄 Complete personalized match report written to: ${reportPath}`);

  // Display top 5 directly in console
  console.log("\n🚀 TOP IMMEDIATE APPLICATION TARGETS:");
  for (const j of scoredJobs.slice(0, 6)) {
    console.log(`\n  • [${j.company}] ${j.title} (Score: ${j.score}/100)`);
    console.log(`    Location: ${j.location} ${j.isRemote ? "[REMOTE]" : ""}`);
    console.log(`    Link:     ${j.url}`);
    console.log(`    Reason:   ${j.matchReasons[0]}`);
  }
}

runResumeMatcher().catch(err => {
  console.error("Error in resume matcher:", err);
  process.exit(1);
});
