import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

export class JobDatabase {
  constructor(dbPath = "data/jobs.db") {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.init();
  }

  init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        company TEXT NOT NULL,
        company_slug TEXT NOT NULL,
        category TEXT,
        ats TEXT NOT NULL,
        title TEXT NOT NULL,
        location TEXT,
        department TEXT,
        url TEXT NOT NULL,
        is_remote INTEGER DEFAULT 0,
        matched_keyword TEXT,
        posted_at TEXT,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        status TEXT DEFAULT 'NEW' -- NEW, APPLIED, SKIPPED, ARCHIVED
      );

      CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company);
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
      CREATE INDEX IF NOT EXISTS idx_jobs_first_seen ON jobs(first_seen_at);

      CREATE TABLE IF NOT EXISTS applications (
        job_id TEXT PRIMARY KEY,
        company TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        applied_at TEXT NOT NULL,
        tailored_resume_path TEXT,
        confirmation_received INTEGER DEFAULT 0,
        confirmation_date TEXT,
        follow_up_due_date TEXT,
        follow_up_sent_date TEXT,
        notes TEXT,
        status TEXT DEFAULT 'APPLIED' -- APPLIED, CONFIRMED, FOLLOW_UP_DUE, FOLLOW_UP_SENT, INTERVIEW, REJECTED, OFFER
      );

      CREATE TABLE IF NOT EXISTS email_logs (
        id TEXT PRIMARY KEY,
        job_id TEXT,
        company TEXT NOT NULL,
        email_subject TEXT NOT NULL,
        email_sender TEXT NOT NULL,
        received_at TEXT NOT NULL,
        email_type TEXT NOT NULL, -- CONFIRMATION, INTERVIEW_INVITE, REJECTION, STATUS_UPDATE
        snippet TEXT
      );

      CREATE TABLE IF NOT EXISTS flagged_questions (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        company TEXT NOT NULL,
        title TEXT NOT NULL,
        question TEXT NOT NULL,
        suggested_answer TEXT NOT NULL,
        confidence_score INTEGER DEFAULT 50,
        status TEXT DEFAULT 'PENDING', -- PENDING, APPROVED, REJECTED
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS saved_answers (
        id TEXT PRIMARY KEY,
        pattern TEXT NOT NULL,
        sample_question TEXT NOT NULL,
        saved_answer TEXT NOT NULL,
        category TEXT DEFAULT 'GENERAL',
        times_used INTEGER DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS job_reviews (
        job_id TEXT PRIMARY KEY,
        company TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        base_tagline TEXT,
        tailored_tagline TEXT,
        bullet_diff TEXT,
        alignment_notes TEXT,
        tailored_resume_path TEXT,
        auto_filled_summary TEXT,
        unfilled_questions_text TEXT,
        has_unfilled INTEGER DEFAULT 0,
        evaluated_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_app_status ON applications(status);
      CREATE INDEX IF NOT EXISTS idx_email_company ON email_logs(company);
      CREATE INDEX IF NOT EXISTS idx_flagged_status ON flagged_questions(status);
      CREATE INDEX IF NOT EXISTS idx_review_job ON job_reviews(job_id);
    `);

    try {
      this.db.exec("ALTER TABLE jobs ADD COLUMN posted_at TEXT;");
    } catch {}

    this.seedDefaultAnswers();
  }

  seedDefaultAnswers() {
    const count = this.db.prepare("SELECT COUNT(*) as count FROM saved_answers").get().count;
    if (count === 0) {
      const defaults = [
        {
          id: "ans_sponsorship",
          pattern: "(require.*(sponsorship|visa)|sponsorship.*(now or in the future|to work)|will you.*require.*sponsorship)",
          sampleQuestion: "Will you now or in the future require sponsorship to work in the US?",
          savedAnswer: "No",
          category: "WORK_AUTH"
        },
        {
          id: "ans_authorized",
          pattern: "(authorized to work|legally authorized|eligible to work in the (us|united states))",
          sampleQuestion: "Are you legally authorized to work in the United States?",
          savedAnswer: "Yes",
          category: "WORK_AUTH"
        },
        {
          id: "ans_camera",
          pattern: "(camera on|video.*interview|keep your camera on)",
          sampleQuestion: "Can you confirm that you can keep your camera on for the entire duration of the interview?",
          savedAnswer: "Yes",
          category: "INTERVIEW_LOGISTICS"
        },
        {
          id: "ans_travel_onboarding",
          pattern: "(travel.*(first week|onboarding)|join us in person.*first week|first week in our (nyc|sf|hq) office)",
          sampleQuestion: "Can you join us in person for your first week for equipment and onboarding?",
          savedAnswer: "Yes, fully available to travel for onboarding week.",
          category: "LOGISTICS"
        },
        {
          id: "ans_background",
          pattern: "(background check|consent to.*background)",
          sampleQuestion: "Are you willing to undergo a background check?",
          savedAnswer: "Yes",
          category: "COMPLIANCE"
        },
        {
          id: "ans_age",
          pattern: "(18 years of age|at least 18)",
          sampleQuestion: "Are you at least 18 years of age?",
          savedAnswer: "Yes",
          category: "ELIGIBILITY"
        }
      ];

      const stmt = this.db.prepare(`
        INSERT INTO saved_answers (id, pattern, sample_question, saved_answer, category, times_used, created_at)
        VALUES (?, ?, ?, ?, ?, 0, ?)
      `);
      const now = new Date().toISOString();
      for (const d of defaults) {
        stmt.run(d.id, d.pattern, d.sampleQuestion, d.savedAnswer, d.category, now);
      }
    }
  }

  /**
   * Checks whether a job already exists in the database.
   * If it does not exist, inserts it as 'NEW' and returns { isNew: true, job }.
   * If it exists, updates last_seen_at and returns { isNew: false, job }.
   */
  upsertJob(job, matchedKeyword = "") {
    const existing = this.db.prepare("SELECT id, status, first_seen_at FROM jobs WHERE id = ?").get(job.id);
    const now = new Date().toISOString();

    if (!existing) {
      const insert = this.db.prepare(`
        INSERT INTO jobs (
          id, company, company_slug, category, ats, title, location,
          department, url, is_remote, matched_keyword, posted_at, first_seen_at, last_seen_at, status
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NEW'
        )
      `);
      insert.run(
        job.id,
        job.company,
        job.companySlug,
        job.category,
        job.ats,
        job.title,
        job.location,
        job.department,
        job.url,
        job.isRemote ? 1 : 0,
        matchedKeyword,
        job.updatedAt || null,
        now,
        now
      );
      return { isNew: true, job: { ...job, status: "NEW", first_seen_at: now } };
    } else {
      const update = this.db.prepare("UPDATE jobs SET last_seen_at = ? WHERE id = ?");
      update.run(now, job.id);
      return { isNew: false, job: { ...job, status: existing.status, first_seen_at: existing.first_seen_at } };
    }
  }

  getJobsByStatus(status = "NEW") {
    return this.db.prepare("SELECT * FROM jobs WHERE status = ? ORDER BY first_seen_at DESC").all(status);
  }

  getAllJobs() {
    return this.db.prepare("SELECT * FROM jobs ORDER BY first_seen_at DESC").all();
  }

  updateJobStatus(id, newStatus) {
    const stmt = this.db.prepare("UPDATE jobs SET status = ? WHERE id = ?");
    return stmt.run(newStatus, id);
  }

  recordApplication(jobId, tailoredResumePath = "", notes = "") {
    const job = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);

    const now = new Date();
    const appliedAt = now.toISOString();

    // Default follow-up due in 7 business days (~10 calendar days)
    const followUpDate = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000).toISOString();

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO applications (
        job_id, company, title, url, applied_at, tailored_resume_path,
        confirmation_received, confirmation_date, follow_up_due_date,
        follow_up_sent_date, notes, status
      ) VALUES (
        ?, ?, ?, ?, ?, ?, 0, NULL, ?, NULL, ?, 'APPLIED'
      )
    `);
    stmt.run(job.id, job.company, job.title, job.url, appliedAt, tailoredResumePath, followUpDate, notes);

    // Also update jobs table status
    this.updateJobStatus(job.id, "APPLIED");
    return this.getApplication(job.id);
  }

  getApplication(jobId) {
    return this.db.prepare("SELECT * FROM applications WHERE job_id = ?").get(jobId);
  }

  getApplications() {
    return this.db.prepare("SELECT * FROM applications ORDER BY applied_at DESC").all();
  }

  updateApplicationStatus(jobId, status, extra = {}) {
    const fields = ["status = ?"];
    const values = [status];

    if (extra.confirmationReceived !== undefined) {
      fields.push("confirmation_received = ?");
      values.push(extra.confirmationReceived ? 1 : 0);
    }
    if (extra.confirmationDate) {
      fields.push("confirmation_date = ?");
      values.push(extra.confirmationDate);
    }
    if (extra.followUpSentDate) {
      fields.push("follow_up_sent_date = ?");
      values.push(extra.followUpSentDate);
    }
    if (extra.notes) {
      fields.push("notes = ?");
      values.push(extra.notes);
    }

    values.push(jobId);
    const stmt = this.db.prepare(`UPDATE applications SET ${fields.join(", ")} WHERE job_id = ?`);
    return stmt.run(...values);
  }

  recordEmailLog({ id, jobId, company, subject, sender, receivedAt, emailType, snippet }) {
    const logId = id || `email_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO email_logs (
        id, job_id, company, email_subject, email_sender, received_at, email_type, snippet
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);
    stmt.run(logId, jobId || null, company, subject, sender, receivedAt, emailType, snippet || "");
    return logId;
  }

  getEmailLogs(limit = 50) {
    return this.db.prepare("SELECT * FROM email_logs ORDER BY received_at DESC LIMIT ?").all(limit);
  }

  getApplicationMetrics() {
    const totalApplied = this.db.prepare("SELECT COUNT(*) as count FROM applications").get().count;
    const confirmed = this.db.prepare("SELECT COUNT(*) as count FROM applications WHERE confirmation_received = 1").get().count;
    const interviews = this.db.prepare("SELECT COUNT(*) as count FROM applications WHERE status = 'INTERVIEW'").get().count;
    const rejected = this.db.prepare("SELECT COUNT(*) as count FROM applications WHERE status = 'REJECTED'").get().count;

    // Follow-ups due: applied_at older than 7 business days, confirmation received or not, and follow_up_sent_date is NULL
    const nowIso = new Date().toISOString();
    const followUpsDue = this.db.prepare(`
      SELECT COUNT(*) as count FROM applications 
      WHERE status IN ('APPLIED', 'CONFIRMED') 
        AND follow_up_due_date <= ? 
        AND follow_up_sent_date IS NULL
    `).get(nowIso).count;

    return {
      totalApplied,
      confirmed,
      interviews,
      rejected,
      followUpsDue
    };
  }

  addFlaggedQuestion(data) {
    const qId = data.id || `flag_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const confidenceScore = data.confidenceScore ?? 50;
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO flagged_questions (
        id, job_id, company, title, question, suggested_answer, confidence_score, status, created_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?
      )
    `);
    stmt.run(qId, data.jobId, data.company, data.title, data.question, data.suggestedAnswer, confidenceScore, now);
    return qId;
  }

  getFlaggedQuestions(status = "PENDING") {
    return this.db.prepare("SELECT * FROM flagged_questions WHERE status = ? ORDER BY created_at DESC").all(status);
  }

  updateFlaggedQuestionStatus(id, newStatus) {
    const stmt = this.db.prepare("UPDATE flagged_questions SET status = ? WHERE id = ?");
    return stmt.run(newStatus, id);
  }

  /**
   * Checks if an incoming screening question matches any previously approved/saved general answers.
   */
  findSavedAnswer(questionText) {
    const allSaved = this.db.prepare("SELECT * FROM saved_answers").all();
    for (const item of allSaved) {
      try {
        const regex = new RegExp(item.pattern, "i");
        if (regex.test(questionText)) {
          // Increment times_used
          this.db.prepare("UPDATE saved_answers SET times_used = times_used + 1 WHERE id = ?").run(item.id);
          return {
            matched: true,
            answer: item.saved_answer,
            category: item.category,
            sampleQuestion: item.sample_question
          };
        }
      } catch {}
    }
    return { matched: false };
  }

  /**
   * Approves a flagged question and learns its pattern into saved_answers
   * so it is automatically answered in all future job applications!
   */
  approveAndLearnFlaggedQuestion(flaggedId) {
    const item = this.db.prepare("SELECT * FROM flagged_questions WHERE id = ?").get(flaggedId);
    if (!item) return null;

    // 1. Mark flagged question as APPROVED
    this.updateFlaggedQuestionStatus(flaggedId, "APPROVED");

    // 2. Generate a resilient regex pattern from the question
    const cleanWords = item.question
      .replace(/[^a-zA-Z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(w => w.length > 3)
      .slice(0, 4);

    const pattern = cleanWords.length > 0 ? cleanWords.join(".*") : item.question.slice(0, 30);
    const ansId = `ans_${Date.now()}`;
    const now = new Date().toISOString();

    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO saved_answers (
        id, pattern, sample_question, saved_answer, category, times_used, created_at
      ) VALUES (
        ?, ?, ?, ?, 'LEARNED_QUESTION', 1, ?
      )
    `);
    insert.run(ansId, pattern, item.question, item.suggested_answer, now);

    return { approved: true, learnedPattern: pattern, answer: item.suggested_answer };
  }

  getSavedAnswers() {
    return this.db.prepare("SELECT * FROM saved_answers ORDER BY times_used DESC").all();
  }

  getStats() {
    const total = this.db.prepare("SELECT COUNT(*) as count FROM jobs").get().count;
    const byStatus = this.db.prepare("SELECT status, COUNT(*) as count FROM jobs GROUP BY status").all();
    const byCompany = this.db.prepare("SELECT company, COUNT(*) as count FROM jobs GROUP BY company ORDER BY count DESC LIMIT 10").all();
    const appMetrics = this.getApplicationMetrics();
    return { total, byStatus, byCompany, appMetrics };
  }

  saveJobReview(data) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO job_reviews (
        job_id, company, title, url, base_tagline, tailored_tagline,
        bullet_diff, alignment_notes, tailored_resume_path,
        auto_filled_summary, unfilled_questions_text, has_unfilled, evaluated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);
    stmt.run(
      data.jobId,
      data.company,
      data.title,
      data.url,
      data.baseTagline || "",
      data.tailoredTagline || "",
      data.bulletDiff || "",
      data.alignmentNotes || "",
      data.tailoredResumePath || "",
      data.autoFilledSummary || "",
      data.unfilledQuestionsText || "",
      data.hasUnfilled ? 1 : 0,
      new Date().toISOString()
    );
  }

  getJobReview(jobId) {
    return this.db.prepare("SELECT * FROM job_reviews WHERE job_id = ?").get(jobId);
  }

  close() {
    this.db.close();
  }
}
