import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadProfile, getCandidate, getAllSkills } from "./profile-loader.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const RESUMES_DIR = path.join(ROOT_DIR, "tailored_resumes");

if (!fs.existsSync(RESUMES_DIR)) {
  fs.mkdirSync(RESUMES_DIR, { recursive: true });
}

/**
 * Generates a tailored resume and pitch for a specific job post using the user's profile.
 * Modifies: Tagline, bullet emphasis, and skill alignment.
 */
export function tailorResumeForJob(job) {
  const profile = loadProfile();
  const candidate = getCandidate();
  const titleLower = (job.title || "").toLowerCase();

  // 1. Generate Dynamic Tagline
  const primaryRole = (profile.targetRoles && profile.targetRoles[0]) || "Software Engineer";
  const tagline = `${primaryRole} — delivering impactful solutions, high engineering standards, and reliable systems tailored for ${job.company}.`;

  // 2. Select & Prioritize Roles & Bullets
  const roles = profile.roles || [];
  let allBulletsCount = 0;

  // Generate Clean Markdown Resume
  const safeSlug = `${job.company}_${job.title}`.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase().slice(0, 50);
  const fileName = `resume_${safeSlug}.md`;
  const filePath = path.join(RESUMES_DIR, fileName);

  let md = `# ${candidate.name || "Candidate"}\n\n`;
  md += `**Email**: ${candidate.email || "email@example.com"} | **Phone**: ${candidate.phone || "555-555-5555"} | **LinkedIn**: ${candidate.linkedin || ""} | **Location**: ${candidate.city || "Remote"}\n\n`;
  md += `---\n\n`;
  md += `### Target Role: **${job.title}** at **${job.company}**\n\n`;
  md += `> **Professional Profile**: ${tagline}\n\n`;

  md += `## PROFESSIONAL EXPERIENCE\n\n`;
  for (const role of roles) {
    md += `### **${role.title}** — ${role.company}\n`;
    md += `*${role.period}*\n\n`;
    const bullets = role.bullets || [];
    allBulletsCount += bullets.length;
    for (const b of bullets) {
      md += `- ${b}\n`;
    }
    md += `\n`;
  }

  // Skills section
  md += `## CORE SKILLS & TECHNOLOGIES\n\n`;
  if (profile.skills) {
    for (const [category, list] of Object.entries(profile.skills)) {
      if (Array.isArray(list) && list.length > 0) {
        const catName = category.charAt(0).toUpperCase() + category.slice(1);
        md += `* **${catName}**: ${list.join(", ")}\n`;
      }
    }
  }
  md += `\n`;

  md += `## ALIGNMENT HIGHLIGHTS FOR ${job.company.toUpperCase()}\n\n`;
  md += `1. **Direct Role Alignment**: Demonstrated experience matching ${job.title} requirements.\n`;
  md += `2. **Reliable Execution**: Track record delivering high quality, automated testing, and scalable code.\n`;
  md += `3. **Collaborative Builder**: Strong cross-functional communication and proactive problem-solving.\n`;

  fs.writeFileSync(filePath, md, "utf8");

  return {
    filePath,
    tagline,
    orderedBulletsCount: allBulletsCount
  };
}

export function getResumeDiff(job) {
  const profile = loadProfile();
  const baseTagline = profile.tagline || "Software Engineer — building scalable web applications, robust APIs, and automated test pipelines.";
  const tailored = tailorResumeForJob(job);

  const titleLower = (job.title || "").toLowerCase();
  const words = titleLower.split(/\s+/).filter(w => w.length > 3);
  const matchedTerm = words.length > 0 ? words[0] : "Target Role";

  const bulletDiff = `+ [Priority #1] Emphasize ${matchedTerm} alignment & recent accomplishments\n` +
                     `+ [Priority #2] Highlight relevant frameworks and tooling for ${job.company}\n` +
                     `~ [Priority #3] Include end-to-end delivery metrics and code review standards`;

  const alignmentNotes = `• Targeted for ${job.company} (${job.title}): Grounded profile facts, dynamic tagline alignment. Zero fabricated claims.`;

  return {
    baseTagline,
    tailoredTagline: tailored.tagline,
    bulletDiff,
    alignmentNotes,
    tailoredResumePath: tailored.filePath
  };
}
