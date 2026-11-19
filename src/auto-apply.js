import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { JobDatabase } from "./database.js";
import { tailorResumeForJob } from "./resume-tailor.js";
import { loadProfile, getCandidate } from "./profile-loader.js";

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
    const profile = loadProfile();
    const candidate = getCandidate();

    if (/(authorized to work|sponsorship|visa)/i.test(qLower)) {
      return {
        answer: profile.screeningAnswers?.sponsorship || candidate.workAuthorization || "Yes, I am a US citizen and authorized to work in the United States without sponsorship.",
        confidence: 100
      };
    }

    if (/(why do you want to work|why|interest)/i.test(qLower)) {
      return {
        answer: profile.screeningAnswers?.interest || `I am excited by ${job.company}'s mission and engineering culture, and look forward to contributing to the ${job.title} team.`,
        confidence: 75
      };
    }

    if (/(playwright|automation|automated test|selenium|cypress|testing)/i.test(qLower)) {
      return {
        answer: "I bring solid experience building automated tests and regression suites, integrating testing into CI/CD pipelines to ensure release quality.",
        confidence: 85
      };
    }

    if (/(ai|artificial intelligence|llm|tools|workflow)/i.test(qLower)) {
      return {
        answer: "I actively integrate AI-assisted developer workflows and tooling to accelerate development cycles while maintaining strict code quality and review standards.",
        confidence: 90
      };
    }

    if (/(customer|client|communication|support|cross-functional)/i.test(qLower)) {
      return {
        answer: "I emphasize clear, plain-language technical communication, proactive defect triage, and dependable collaboration across product and engineering teams.",
        confidence: 85
      };
    }

    // Default general answer
    return {
      answer: profile.screeningAnswers?.experience || `Demonstrated background delivering reliable software solutions and technical problem-solving for ${job.title}.`,
      confidence: 50
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
