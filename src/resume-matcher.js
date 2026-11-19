import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { scrapeGreenhouse } from "./scrapers/greenhouse.js";
import { scrapeAshby } from "./scrapers/ashby.js";
import { scrapeLever } from "./scrapers/lever.js";
import { loadProfile, getAllSkills } from "./profile-loader.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");

export const USER_RESUME_PROFILE = loadProfile();

/**
 * Scores a job against the candidate's specific profile and target roles.
 * Returns { score, tier, matchReasons, isRemoteUs }
 */
export function scoreJobAgainstResume(job, profile = loadProfile(), maxAgeDays = 21) {
  let score = 0;
  const matchReasons = [];

  // 0. Age check: ignore listings older than maxAgeDays
  if (maxAgeDays && job.updatedAt) {
    const jobDate = new Date(job.updatedAt).getTime();
    if (!isNaN(jobDate)) {
      const ageDays = (Date.now() - jobDate) / (1000 * 60 * 60 * 24);
      if (ageDays > maxAgeDays) {
        return { score: 0, tier: "EXCLUDED", matchReasons: [`Listing is ${Math.round(ageDays)} days old (> ${maxAgeDays} days)`] };
      }
    }
  }

  const title = (job.title || "").toLowerCase();
  const dept = (job.department || "").toLowerCase();
  const loc = (job.location || "").toLowerCase();
  const fullText = `${title} ${dept}`;

  // Check Location & Remote preferences
  const isRemote = job.isRemote || /remote/i.test(loc) || /remote/i.test(title);
  const isExcludedGeo = /(london|uk|united kingdom|canada|emea|latam|india|singapore|berlin|germany|mexico|taiwan|paris|argentina|brazil|uae|dubai|united arab emirates|europe|france|spain)/i.test(loc);
  const candidateCity = (profile.candidate?.city || "").toLowerCase();
  const matchesLocalCity = candidateCity && loc.includes(candidateCity.split(",")[0].trim());
  const isUS = !isExcludedGeo && (/(remote.*(us|usa)|us.*remote|united states|new york|san francisco|austin|seattle|california|remote)/i.test(loc) || isRemote || matchesLocalCity);

  // Hard penalties for non-technical sales / executive roles
  if (/(director|vice president|vp|head of|counsel|account executive|sales rep)/i.test(title)) {
    return { score: 0, tier: "EXCLUDED", matchReasons: ["Executive or Non-Technical Sales role"] };
  }
  if (isExcludedGeo) {
    return { score: 0, tier: "EXCLUDED", matchReasons: ["Outside Target Region"] };
  }

  // 1. Direct Target Role Match (from user's profile.json)
  const targetRoles = profile.targetRoles || [];
  let directRoleMatched = false;
  for (const tr of targetRoles) {
    const trLower = tr.toLowerCase();
    if (title.includes(trLower)) {
      score += 55;
      matchReasons.push(`Direct target role match: "${tr}"`);
      directRoleMatched = true;
      break;
    }
  }

  if (!directRoleMatched) {
    // Check keyword parts of target roles
    const roleKeywords = targetRoles.flatMap(r => r.toLowerCase().split(/\s+/)).filter(w => w.length > 2);
    const matchedParts = [...new Set(roleKeywords.filter(w => title.includes(w)))];
    if (matchedParts.length >= 2) {
      score += 40;
      matchReasons.push(`Role alignment match: ${matchedParts.join(", ")}`);
    } else if (matchedParts.length === 1) {
      score += 25;
      matchReasons.push(`Role keyword match: ${matchedParts[0]}`);
    }
  }

  // 2. Candidate Skills Match (from user's profile.json)
  const allSkills = getAllSkills();
  const matchedSkills = [];
  for (const skill of allSkills) {
    const sLower = skill.toLowerCase();
    if (sLower.length >= 2) {
      const regex = new RegExp(`\\b${sLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (regex.test(fullText)) {
        matchedSkills.push(skill);
      }
    }
  }

  if (matchedSkills.length > 0) {
    const skillScore = Math.min(30, matchedSkills.length * 10);
    score += skillScore;
    matchReasons.push(`Matched skills: ${matchedSkills.slice(0, 4).join(", ")}`);
  }

  // 3. Location / Remote Match Bonus
  if (isRemote && (profile.candidate?.remoteEligible ?? true)) {
    score += 15;
    matchReasons.push("Remote friendly (aligns with preferences)");
  } else if (matchesLocalCity) {
    score += 15;
    matchReasons.push(`Matches preferred local region: ${profile.candidate.city}`);
  }

  // Determine Match Tier
  let tier = "TIER_3_ADJACENT";
  if (score >= 60) {
    tier = "TIER_1_EXACT";
  } else if (score >= 40) {
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
  const profile = loadProfile();
  const companiesPath = path.join(ROOT_DIR, "companies.json");
  const companies = JSON.parse(fs.readFileSync(companiesPath, "utf8"));

  const candidateName = profile.candidate?.name || "Candidate";
  const targetRolesStr = (profile.targetRoles || []).slice(0, 4).join(", ");
  const skillsSample = getAllSkills().slice(0, 6).join(", ");

  console.log(`\n🎯 CROSS-REFERENCING FinTech Jobs against Profile: ${candidateName}`);
  console.log(`• Target Roles: ${targetRolesStr || "Configured roles"}`);
  console.log(`• Core Skills:  ${skillsSample || "Configured skills"}`);
  console.log(`• Preferred:    ${profile.candidate?.city || "Remote"}`);
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
    const analysis = scoreJobAgainstResume(job, profile);
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

  console.log(`\n✨ MATCH RESULTS FOR ${candidateName.toUpperCase()}:`);
  console.log(`  🌟 Tier 1 (Direct Target Role Matches):              ${tier1.length}`);
  console.log(`  ⚡ Tier 2 (Strong Skill & Domain Alignment):        ${tier2.length}`);
  console.log(`  🛠️ Tier 3 (High-Value Adjacent Opportunities):      ${tier3.length}`);

  // Generate Resume Matches Report
  const reportPath = path.join(ROOT_DIR, "resume_matches.md");
  let md = `# 🎯 Tailored FinTech Job Matches\n\n`;
  md += `> **Candidate**: **${candidateName}**  \n`;
  md += `> **Target Roles**: ${targetRolesStr}  \n`;
  md += `> **Generated**: ${new Date().toLocaleString()}  \n\n`;

  md += `## 🌟 Tier 1: Highest Match (Direct Target Role Alignment)\n`;
  md += `*These roles directly align with your target roles and primary skills.*\n\n`;
  for (const j of tier1) {
    const remoteStr = j.isRemote ? "🌐 Remote" : "📍 On-Site";
    md += `### [${j.title}](${j.url}) — **${j.company}**\n`;
    md += `- **Location**: \`${remoteStr}\` ${j.location}\n`;
    md += `- **Match Score**: **${j.score}/100**\n`;
    md += `- **Why it matches**: ${j.matchReasons.join("; ")}\n`;
    md += `- [ ] [**Click to Apply Directly**](${j.url})\n\n`;
  }

  md += `## ⚡ Tier 2: Strong Match (Technical & Skill Alignment)\n`;
  md += `*Roles leveraging your core technical skills, frameworks, and background.*\n\n`;
  for (const j of tier2) {
    const remoteStr = j.isRemote ? "🌐 Remote" : "📍 On-Site";
    md += `### [${j.title}](${j.url}) — **${j.company}**\n`;
    md += `- **Location**: \`${remoteStr}\` ${j.location}\n`;
    md += `- **Match Score**: **${j.score}/100**\n`;
    md += `- **Why it matches**: ${j.matchReasons.join("; ")}\n`;
    md += `- [ ] [**Click to Apply Directly**](${j.url})\n\n`;
  }

  md += `## 🛠️ Tier 3: High-Value Adjacent Roles\n`;
  md += `*Roles matching your broader experience, cross-functional capabilities, and tooling.*\n\n`;
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

if (process.argv[1] && process.argv[1].endsWith("resume-matcher.js")) {
  runResumeMatcher().catch(err => {
    console.error("Error in resume matcher:", err);
    process.exit(1);
  });
}
