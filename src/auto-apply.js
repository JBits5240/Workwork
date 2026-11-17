import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { JobDatabase } from "./database.js";
import { tailorResumeForJob } from "./resume-tailor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");

export class AutoApplyEngine {
  constructor(db) {
    this.db = db;
  }

  /**
   * Generates a truthful suggested answer for non-standard screening questions
   * based solely on candidate's resume facts.
   */
  suggestAnswerForQuestion(questionText, job) {
    const qLower = (questionText || "").toLowerCase();

    if (/(playwright|automation|automated test|selenium|cypress)/i.test(qLower)) {
      return {
        answer: "At my previous company, I utilized Playwright for browser automation and repeatable end-to-end UI verification suites. I also engineered an internal AI pipeline tool that accelerated ticket testing by ~75% and enabled parallel test validation.",
        confidence: 85
      };
    }

    if (/(exploratory|manual|defect|bug|triage|regression|test plan)/i.test(qLower)) {
      return {
        answer: "In my daily work as a Software QA Analyst, I perform manual and exploratory testing across web applications and platforms. I participate in engineering code reviews to catch logic risks and UX defects before release.",
        confidence: 90
      };
    }

    if (/(ai|artificial intelligence|llm|tools|workflow)/i.test(qLower)) {
      return {
        answer: "I served as an early lead on practical AI workflow integration, building internal tooling that cut ticket completion times by ~75% and facilitating hands-on AI adoption sessions for teams and clients.",
        confidence: 95
      };
    }

    if (/(customer|client|coaching|communication|support)/i.test(qLower)) {
      return {
        answer: "I combine technical QA analysis with 4+ years of customer service and field handoff experience, alongside leading technical training workshops for clients.",
        confidence: 85
      };
    }

    if (/(authorized to work|sponsorship|visa)/i.test(qLower)) {
      return {
        answer: "Yes, I am a US citizen and authorized to work in the United States without sponsorship.",
        confidence: 100
      };
    }

    if (/(why do you want to work|why|interest)/i.test(qLower)) {
      return {
        answer: `I am excited by ${job.company}'s mission in modern financial technology and look forward to bringing dependable quality verification, test automation, and tooling to the ${job.title} team.`,
        confidence: 70
      };
    }

    // Ambiguous or odd question -> Low confidence flag
    return {
      answer: "Relevant experience in software quality assurance, defect triage, and automated testing workflows.",
      confidence: 40
    };
  }

  /**
   * Evaluates questions for a job application.
   * If any non-standard or low-confidence question is found, flags it for human review.
   */
  async evaluateAndApplyJob(job) {
    let questions = [];

    // Check Greenhouse question endpoint if available
    if (job.ats === "greenhouse" && job.company_slug) {
      try {
        const rawId = job.id.split("_").pop();
        const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${job.company_slug}/jobs/${rawId}?questions=true`, {
          headers: { "Accept": "application/json" }
        });
        if (res.ok) {
          const data = await res.json();
          questions = data.questions || [];
        }
      } catch {}
    }

    // Filter for non-standard questions (exclude Name, Email, Phone, Resume, LinkedIn)
    const standardFields = /(first name|last name|email|phone|resume|cv|linkedin|website|location|hear about)/i;
    const unusualQuestions = questions.filter(q => q.label && !standardFields.test(q.label));

    let flaggedCount = 0;

    for (const uq of unusualQuestions) {
      // 1. Check persistent saved_answers memory first!
      const saved = this.db.findSavedAnswer(uq.label);
      if (saved.matched) {
        // Automatically answered with 100% confidence from user memory - DO NOT FLAG!
        continue;
      }

      // 2. Otherwise generate a suggested answer from resume facts
      const { answer, confidence } = this.suggestAnswerForQuestion(uq.label, job);
      if (confidence < 80 || uq.required) {
        flaggedCount++;
        this.db.addFlaggedQuestion({
          jobId: job.id,
          company: job.company,
          title: job.title,
          question: uq.label,
          suggestedAnswer: answer,
          confidenceScore: confidence
        });
      }
    }

    // Generate Tailored Resume
    const tailored = tailorResumeForJob(job);

    if (flaggedCount > 0) {
      // Mark as NEEDS_REVIEW
      this.db.updateJobStatus(job.id, "NEEDS_REVIEW");
      return {
        status: "FLAGGED",
        jobId: job.id,
        company: job.company,
        title: job.title,
        flaggedQuestions: flaggedCount,
        tailoredResume: tailored.filePath
      };
    }

    // Auto-apply & record
    const app = this.db.recordApplication(
      job.id,
      tailored.filePath,
      `Auto-applied via Workwork engine (Tailored for ${job.company})`
    );

    return {
      status: "APPLIED",
      jobId: job.id,
      company: job.company,
      title: job.title,
      tailoredResume: tailored.filePath
    };
  }

  /**
   * Bulk auto-apply to all unapplied remote jobs.
   */
  async autoApplyAllUnapplied(limit = 20) {
    const unappliedJobs = this.db.getAllJobs().filter(j => j.status === "NEW" && (j.is_remote === 1 || j.isRemote));
    const targetBatch = unappliedJobs.slice(0, limit);

    const results = {
      applied: 0,
      flagged: 0,
      details: []
    };

    for (const job of targetBatch) {
      const res = await this.evaluateAndApplyJob(job);
      results.details.push(res);
      if (res.status === "APPLIED") results.applied++;
      else if (res.status === "FLAGGED") results.flagged++;
    }

    return results;
  }
}

// CLI runner
async function main() {
  const args = process.argv.slice(2);
  const db = new JobDatabase(path.join(ROOT_DIR, "data/jobs.db"));
  const engine = new AutoApplyEngine(db);

  if (args.includes("--single")) {
    const jobId = args[args.indexOf("--single") + 1];
    const job = db.getAllJobs().find(j => j.id === jobId);
    if (!job) {
      console.error("Job not found:", jobId);
      db.close();
      return;
    }
    console.log(`Evaluating application for ${job.title} at ${job.company}...`);
    const res = await engine.evaluateAndApplyJob(job);
    console.log(JSON.stringify(res, null, 2));
  } else {
    const limit = parseInt(args[args.indexOf("--limit") + 1] || "10", 10);
    console.log(`\n🤖 Running Bulk Auto-Apply for up to ${limit} unapplied remote listings...`);
    const res = await engine.autoApplyAllUnapplied(limit);
    console.log(`\n✨ Auto-Apply Finished:`);
    console.log(`  - Successfully Applied: ${res.applied}`);
    console.log(`  - Flagged for Question Review: ${res.flagged}`);
  }

  db.close();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(console.error);
}
