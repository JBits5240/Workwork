import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const RESUMES_DIR = path.join(ROOT_DIR, "tailored_resumes");

if (!fs.existsSync(RESUMES_DIR)) {
  fs.mkdirSync(RESUMES_DIR, { recursive: true });
}

// Candidate's true baseline facts (Never fabricated — fill in your own details)
const CANDIDATE = {
  name: "YOUR NAME",
  contact: {
    email: "your.email@example.com",
    phone: "555-555-5555",
    linkedin: "linkedin.com/in/your-profile",
    city: "Your City, ST"
  },
  roles: {
    leadQA: {
      title: "Software Quality Assurance Analyst",
      company: "TechCorp Inc.",
      period: "2022–Present · Your City, ST",
      allBullets: {
        codeReviewAndExploratory: "Code review, manual and exploratory testing across multiple web applications and client platforms; providing concise, reproducible findings to engineering teams prior to release.",
        aiPipeline: "Architected and built an internal AI pipeline tool that accelerated ticket completion time by ~75% and enabled parallel ticket validation; AI assisted pipeline execution under direct human review of test outputs.",
        aiLead: "Served as early lead on team-wide AI workflow integration, coaching colleagues and client teams on practical AI adoption without compromising quality standards.",
        automationInfra: "Championed automation on team workflow bottlenecks; engineered internal tooling and repeatable automation infrastructure adopted across client engagements.",
        workshops: "Designed and facilitated hands-on technical and AI skills sessions for cross-functional teams and clients; commended for high-adoption tooling."
      }
    },
    fieldOps: {
      title: "Lead Field Operations Specialist",
      company: "Field Dynamics LLC",
      period: "2016–2020 · Your City, ST",
      bullets: [
        "Installed and maintained field equipment with dependable operational handoffs and customer training.",
        "Delivered technical customer service in clear, plain language; trained new field personnel on safety protocols and procedures.",
        "Managed field inventory, logistics, and scheduling to maintain 100% on-time project execution."
      ]
    }
  },
  skills: {
    quality: [
      { name: "Software Quality Assurance", detail: "Daily verification across web and client applications before production release." },
      { name: "Code Review & Defect Triage", detail: "Collaborate with engineers to catch logic regressions, UX issues, and edge cases." },
      { name: "Exploratory & Regression Testing", detail: "Deep scenario testing beyond test scripts to uncover unexpected failure modes." }
    ],
    automation: [
      { name: "Playwright", detail: "Browser automation and repeatable end-to-end UI verification suites." },
      { name: "Automation Infrastructure", detail: "Building lightweight tooling to automate repetitive QA validation pipelines." }
    ],
    aiAndTools: [
      { name: "AI Workflow Integration", detail: "Practical adoption of AI (Claude, Cursor, custom pipelines) for accelerated QA workflows." },
      { name: "Google Cloud (gcloud)", detail: "Cloud tooling and environment verification in daily QA support." },
      { name: "Glean", detail: "Internal knowledge retrieval for rapid issue triage." }
    ],
    languages: [
      { name: "Ruby (Strongest)", detail: "Practice scripts and automation tooling with one-on-one tutoring." },
      { name: "Python", detail: "Studying toward automation scripting and data validation." },
      { name: "Rust", detail: "Introductory systems programming study." }
    ]
  }
};

/**
 * Generates a tailored resume and pitch for a specific job post.
 * Modifies: Tagline, bullet order, and emphasis based on actual skills.
 */
export function tailorResumeForJob(job) {
  const titleLower = (job.title || "").toLowerCase();
  const deptLower = (job.department || "").toLowerCase();
  const isAutomation = /(automation|playwright|infra|developer|sdet)/i.test(titleLower);
  const isSupportOrSolutions = /(support|solutions|customer|triage|operations)/i.test(titleLower);
  const isUatOrManual = /(uat|acceptance|manual|analyst|quality analyst)/i.test(titleLower);

  // 1. Tailor Tagline
  let tagline = "";
  if (isAutomation) {
    tagline = `Software Quality Assurance Analyst — specializing in test automation infrastructure (Playwright), code review, and AI-accelerated workflows for ${job.company}.`;
  } else if (isSupportOrSolutions) {
    tagline = `Technical Support & QA Analyst — combining technical troubleshooting, client coaching, defect triage, and automated workflows for ${job.company}.`;
  } else if (isUatOrManual) {
    tagline = `Software Quality Assurance Analyst — manual and exploratory testing, defect triage, UAT verification, and cross-functional engineering collaboration for ${job.company}.`;
  } else {
    tagline = `Software Quality Assurance Analyst — testing, code review, AI integration, and automation infrastructure tailored for ${job.company}.`;
  }

  // 2. Select & Order Bullets based on relevance
  const role1 = CANDIDATE.roles.leadQA;
  let orderedBullets = [];

  if (isAutomation) {
    orderedBullets = [
      role1.allBullets.automationInfra,
      role1.allBullets.aiPipeline,
      role1.allBullets.codeReviewAndExploratory,
      role1.allBullets.aiLead,
      role1.allBullets.workshops
    ];
  } else if (isSupportOrSolutions) {
    orderedBullets = [
      role1.allBullets.workshops,
      role1.allBullets.codeReviewAndExploratory,
      role1.allBullets.aiLead,
      role1.allBullets.automationInfra,
      role1.allBullets.aiPipeline
    ];
  } else {
    orderedBullets = [
      role1.allBullets.codeReviewAndExploratory,
      role1.allBullets.aiPipeline,
      role1.allBullets.aiLead,
      role1.allBullets.automationInfra,
      role1.allBullets.workshops
    ];
  }

  // Generate Clean Markdown Resume
  const safeSlug = `${job.company}_${job.title}`.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase().slice(0, 50);
  const fileName = `resume_${safeSlug}.md`;
  const filePath = path.join(RESUMES_DIR, fileName);

  let md = `# ${CANDIDATE.name}\n\n`;
  md += `**Email**: ${CANDIDATE.contact.email} | **Phone**: ${CANDIDATE.contact.phone} | **LinkedIn**: ${CANDIDATE.contact.linkedin} | **Location**: ${CANDIDATE.contact.city} (Remote US Eligible)\n\n`;
  md += `---\n\n`;
  md += `### Target Role: **${job.title}** at **${job.company}**\n\n`;
  md += `> **Professional Profile**: ${tagline}\n\n`;

  md += `## PROFESSIONAL EXPERIENCE\n\n`;
  md += `### **${role1.title}** — ${role1.company}\n`;
  md += `*${role1.period}*\n\n`;
  for (const b of orderedBullets) {
    md += `- ${b}\n`;
  }
  md += `\n`;

  md += `### **${CANDIDATE.roles.fieldOps.title}** — ${CANDIDATE.roles.fieldOps.company}\n`;
  md += `*${CANDIDATE.roles.fieldOps.period}*\n\n`;
  for (const b of CANDIDATE.roles.fieldOps.bullets) {
    md += `- ${b}\n`;
  }
  md += `\n`;

  md += `## TECHNICAL & QA SKILLS\n\n`;
  md += `* **Quality & Verification**: Software QA, Code Review, Defect Triage, Exploratory & Regression Testing, UAT\n`;
  md += `* **Automation & Infrastructure**: Playwright (UI browser automation), Custom QA pipelines, Google Cloud (gcloud)\n`;
  md += `* **AI & Workflow Optimization**: AI pipeline construction (~75% ticket acceleration), Cursor, Claude, Glean, practical adoption workshops\n`;
  md += `* **Programming (Novice / Scripting)**: Ruby (strongest), Python, Rust\n\n`;

  md += `## ALIGNMENT HIGHLIGHTS FOR ${job.company.toUpperCase()}\n\n`;
  md += `1. **Direct Role Alignment**: Proven track record validating web platforms and complex workflows prior to production deployments.\n`;
  md += `2. **Automation & Efficiency**: Practical builder of tooling—reduced ticket cycle times by ~75% using automated pipelines.\n`;
  md += `3. **Honest & Grounded**: Transparent skill profile with proven aptitude for rapidly adopting internal frameworks and client standards.\n`;

  fs.writeFileSync(filePath, md, "utf8");

  return {
    filePath,
    tagline,
    orderedBulletsCount: orderedBullets.length
  };
}

export function getResumeDiff(job) {
  const baseTagline = "Software Quality Assurance Analyst — manual and exploratory testing, defect triage, UAT verification, and cross-functional engineering collaboration.";
  const titleLower = (job.title || "").toLowerCase();
  const isAutomation = /(automation|playwright|infra|developer|sdet)/i.test(titleLower);
  const isSupportOrSolutions = /(support|solutions|customer|triage|operations)/i.test(titleLower);

  const tailored = tailorResumeForJob(job);

  let bulletDiff = "";
  if (isAutomation) {
    bulletDiff = "+ [Priority #1] Automation Infrastructure: Engineered repeatable automation tooling\n" +
                 "+ [Priority #2] AI Pipeline: Built custom pipeline cutting ticket times ~75%\n" +
                 "~ [Priority #3] Code Review & Reproducible defect reporting prior to release\n" +
                 "- [Shifted #5] Technical workshops & coaching";
  } else if (isSupportOrSolutions) {
    bulletDiff = "+ [Priority #1] Workshops & Client Technical Sessions: Plain-language training\n" +
                 "+ [Priority #2] Code Review & Concise defect triage across web platforms\n" +
                 "~ [Priority #3] AI Workflow Coaching & Early lead on team adoption\n" +
                 "- [Shifted #5] Internal automated ticket validation";
  } else {
    bulletDiff = "+ [Priority #1] Code Review & Exploratory Manual Testing across web apps\n" +
                 "+ [Priority #2] AI Pipeline: Automated tool cutting ticket completion ~75%\n" +
                 "~ [Priority #3] Team AI adoption lead without compromising quality\n" +
                 "~ [Priority #4] Automation infrastructure for testing bottlenecks";
  }

  const alignmentNotes = `• Tailored for ${job.company}: Emphasizes verified QA platform testing, reproducible triage, and automation tooling. Zero fabricated facts.`;

  return {
    baseTagline,
    tailoredTagline: tailored.tagline,
    bulletDiff,
    alignmentNotes,
    tailoredResumePath: tailored.filePath
  };
}
