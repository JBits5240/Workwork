import fs from "node:fs";

export function exportMarkdownDigest(newJobs, filePath = "matches_digest.md", searchConfig = {}) {
  const dateStr = new Date().toLocaleString();
  const keywords = (searchConfig.includeKeywords || []).join(", ");

  let md = `# 💼 FinTech Job Matches Digest\n\n`;
  md += `> **Generated**: ${dateStr}  \n`;
  md += `> **New Matches Found**: ${newJobs.length}  \n`;
  md += `> **Search Keywords**: \`${keywords}\`\n\n`;

  if (newJobs.length === 0) {
    md += `_No new job listings matched your criteria during this scan._\n`;
    fs.writeFileSync(filePath, md, "utf8");
    return;
  }

  // Group by Company
  const byCompany = {};
  for (const job of newJobs) {
    if (!byCompany[job.company]) byCompany[job.company] = [];
    byCompany[job.company].push(job);
  }

  md += `## 🚀 Direct Apply Links Checklist\n\n`;

  for (const [company, jobs] of Object.entries(byCompany)) {
    md += `### ${company} (${jobs.length})\n`;
    for (const j of jobs) {
      const remoteBadge = j.is_remote || j.isRemote ? "🌐 Remote" : "📍 On-Site/Hybrid";
      const loc = j.location ? `| ${j.location}` : "";
      const dept = j.department ? `| *${j.department}*` : "";
      md += `- [ ] [**${j.title}**](${j.url}) — \`${remoteBadge}\` ${loc} ${dept}\n`;
    }
    md += `\n`;
  }

  fs.writeFileSync(filePath, md, "utf8");
}

export function exportJson(jobs, filePath = "matches.json") {
  fs.writeFileSync(filePath, JSON.stringify(jobs, null, 2), "utf8");
}
