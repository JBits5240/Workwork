import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { JobDatabase } from "./database.js";
import { getResumeDiff } from "./resume-tailor.js";
import { loadProfile, getCandidate } from "./profile-loader.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");

export class ReviewCockpitEngine {
  constructor(db) {
    this.db = db;
  }

  /**
   * Evaluates questions for a job and determines which are auto-filled vs which need human review.
   */
  async evaluateQuestions(job) {
    let rawQuestions = [];

    // Attempt to pull real questions if ATS is Greenhouse
    if (job.ats === "greenhouse" && job.company_slug) {
      try {
        const rawId = job.id.split("_").pop();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${job.company_slug}/jobs/${rawId}?questions=true`, {
          signal: controller.signal,
          headers: { "Accept": "application/json" }
        });
        clearTimeout(timeout);
        if (res.ok) {
          const data = await res.json();
          rawQuestions = data.questions || [];
        }
      } catch {}
    }

    const standardProfileFields = /(first name|last name|full name|email|phone|resume|cv|linkedin|website|location|hear about)/i;

    const autoFilled = [];
    const needsReview = [];

    const candidate = getCandidate();
    const profile = loadProfile();

    // Always include standard candidate auto-fills
    autoFilled.push({
      field: "Contact & Profile",
      question: "Full Name, Email, Phone, Location",
      answer: `${candidate.name || "YOUR NAME"} | ${candidate.email || "your.email@example.com"} | ${candidate.phone || "555-555-5555"} | ${candidate.city || "Your City, ST"}`,
      source: "Candidate Profile"
    });
    autoFilled.push({
      field: "Tailored Resume",
      question: "Resume / CV Attachment",
      answer: `tailored_resumes/resume_${job.company.toLowerCase()}.md`,
      source: "Workwork Engine"
    });

    if (rawQuestions.length === 0) {
      // Default common screening questions check
      autoFilled.push({
        field: "Work Authorization",
        question: "Are you legally authorized to work in the United States?",
        answer: candidate.workAuthorization || "Yes, US Citizen (No sponsorship required)",
        source: "Saved Memory"
      });
      autoFilled.push({
        field: "Visa Sponsorship",
        question: "Will you now or in the future require visa sponsorship?",
        answer: "No sponsorship required",
        source: "Saved Memory"
      });
    }

    for (const q of rawQuestions) {
      const label = (q.label || "").trim();
      if (!label || standardProfileFields.test(label)) {
        continue;
      }

      const saved = this.db.findSavedAnswer(label);
      if (saved.matched) {
        autoFilled.push({
          field: label.slice(0, 30),
          question: label,
          answer: saved.answer || saved.saved_answer || "Yes",
          source: "Saved Memory"
        });
        continue;
      }

      // Check common patterns
      const lLower = label.toLowerCase();
      if (/(sponsorship|visa)/i.test(lLower)) {
        autoFilled.push({
          field: "Visa Sponsorship",
          question: label,
          answer: "No, US Citizen",
          source: "Saved Memory"
        });
      } else if (/(authorized to work|legal right)/i.test(lLower)) {
        autoFilled.push({
          field: "Work Authorization",
          question: label,
          answer: "Yes, authorized without sponsorship",
          source: "Saved Memory"
        });
      } else if (/(travel|onboarding|in-person|office)/i.test(lLower)) {
        needsReview.push({
          id: `q_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          question: label,
          suggestedAnswer: "Yes, fully available for initial onboarding week travel.",
          confidence: 85,
          required: !!q.required
        });
      } else if (/(salary|compensation|expectations)/i.test(lLower)) {
        needsReview.push({
          id: `q_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          question: label,
          suggestedAnswer: "Flexible and open based on total compensation and team scope.",
          confidence: 80,
          required: !!q.required
        });
      } else if (/(experience|years|background|stack|technologies|projects)/i.test(lLower)) {
        needsReview.push({
          id: `q_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          question: label,
          suggestedAnswer: profile.screeningAnswers?.experience || `Relevant background and proven technical delivery for ${job.title} at ${job.company}.`,
          confidence: 85,
          required: !!q.required
        });
      } else {
        needsReview.push({
          id: `q_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          question: label,
          suggestedAnswer: `Relevant technical experience and problem-solving background tailored for ${job.company}.`,
          confidence: 60,
          required: !!q.required
        });
      }
    }

    return { autoFilled, needsReview };
  }

  /**
   * Generates full review data for a single job and caches it in SQLite.
   */
  async evaluateAndCacheJob(job) {
    const diff = getResumeDiff(job);
    const { autoFilled, needsReview } = await this.evaluateQuestions(job);

    // Format auto-filled summary text
    let autoSummary = "";
    for (const a of autoFilled) {
      autoSummary += `✓ [Auto-Filled] ${a.field}: "${a.answer}" (${a.source})\n`;
    }

    // Format unfilled questions text
    let questionsText = "";
    if (needsReview.length === 0) {
      questionsText = "✓ All screening questions auto-filled! No unanswered items.\nPress [Enter] to approve and record application.";
    } else {
      questionsText = `⚠️ ${needsReview.length} QUESTION(S) NEEDING YOUR REVIEW BEFORE SENDING:\n\n`;
      needsReview.forEach((q, idx) => {
        questionsText += `[Question ${idx + 1}/${needsReview.length}] (Confidence: ${q.confidence}%)\n`;
        questionsText += `  Q: "${q.question}"\n`;
        questionsText += `  ↳ Suggested Answer: "${q.suggestedAnswer}"\n`;
        questionsText += `  ↳ Actions: Press [Y] to approve suggested answer into memory\n\n`;
      });
    }

    const reviewData = {
      jobId: job.id,
      company: job.company,
      title: job.title,
      url: job.url,
      baseTagline: diff.baseTagline,
      tailoredTagline: diff.tailoredTagline,
      bulletDiff: diff.bulletDiff,
      alignmentNotes: diff.alignmentNotes,
      tailoredResumePath: diff.tailoredResumePath,
      autoFilledSummary: autoSummary.trim(),
      unfilledQuestionsText: questionsText.trim(),
      hasUnfilled: needsReview.length > 0
    };

    this.db.saveJobReview(reviewData);

    // Also populate flagged_questions if there are unfilled items so user can edit them
    for (const nr of needsReview) {
      this.db.addFlaggedQuestion({
        id: nr.id,
        jobId: job.id,
        company: job.company,
        title: job.title,
        question: nr.question,
        suggestedAnswer: nr.suggestedAnswer,
        confidenceScore: nr.confidence
      });
    }

    return reviewData;
  }

  /**
   * Pre-evaluates the first N unapplied remote jobs.
   */
  async prepareQueue(limit = 25) {
    const unapplied = this.db.getAllJobs().filter(j => j.status === "NEW" && (j.is_remote === 1 || j.isRemote));
    const batch = unapplied.slice(0, limit);
    console.log(`Preparing walkthrough data for ${batch.length} jobs...`);

    for (let i = 0; i < batch.length; i++) {
      const job = batch[i];
      const existing = this.db.getJobReview(job.id);
      if (!existing) {
        process.stdout.write(`  [${i + 1}/${batch.length}] Evaluating ${job.company} - ${job.title}... `);
        await this.evaluateAndCacheJob(job);
        console.log("✓ Done");
      }
    }
  }
}

// CLI runner
async function main() {
  const args = process.argv.slice(2);
  const db = new JobDatabase(path.join(ROOT_DIR, "data/jobs.db"));
  const engine = new ReviewCockpitEngine(db);

  if (args.includes("--job")) {
    const jobId = args[args.indexOf("--job") + 1];
    const job = db.getAllJobs().find(j => j.id === jobId);
    if (!job) {
      console.error("Job not found:", jobId);
      db.close();
      return;
    }
    const res = await engine.evaluateAndCacheJob(job);
    console.log(JSON.stringify(res, null, 2));
  } else if (args.includes("--approve-job")) {
    const jobId = args[args.indexOf("--approve-job") + 1];
    const job = db.getAllJobs().find(j => j.id === jobId);
    if (!job) {
      console.error("Job not found:", jobId);
      db.close();
      return;
    }
    const review = db.getJobReview(jobId);
    const resumePath = review?.tailored_resume_path || "";
    db.recordApplication(jobId, resumePath, `Reviewed and approved via Walkthrough Cockpit`);
    console.log(`✅ Approved application for ${job.title} at ${job.company}!`);
  } else if (args.includes("--skip-job")) {
    const jobId = args[args.indexOf("--skip-job") + 1];
    db.updateJobStatus(jobId, "SKIPPED");
    console.log(`⏭️ Skipped job: ${jobId}`);
  } else {
    let limit = 30;
    if (args.includes("--limit")) {
      limit = parseInt(args[args.indexOf("--limit") + 1] || "30", 10);
    } else if (args.includes("--prepare")) {
      const val = parseInt(args[args.indexOf("--prepare") + 1], 10);
      if (!isNaN(val)) limit = val;
    }
    await engine.prepareQueue(limit);
    console.log("✨ Walkthrough queue prepared!");
  }

  db.close();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(console.error);
}
