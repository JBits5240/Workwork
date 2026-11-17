import fs from "node:fs";
import path from "node:path";
import tls from "node:tls";
import { fileURLToPath } from "node:url";
import { JobDatabase } from "./database.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");

export class EmailSyncService {
  constructor(db) {
    this.db = db;
  }

  /**
   * Evaluates an email message against active company applications in DB.
   */
  processEmail({ id, subject, sender, body, receivedAt }) {
    const apps = this.db.getApplications();
    const subLower = (subject || "").toLowerCase();
    const bodyLower = (body || "").toLowerCase();
    const senderLower = (sender || "").toLowerCase();
    const fullText = `${subLower} ${senderLower} ${bodyLower}`;

    // Look for matching company
    let matchedApp = null;
    for (const app of apps) {
      const compLower = app.company.toLowerCase();
      if (fullText.includes(compLower)) {
        matchedApp = app;
        break;
      }
    }

    // Classify email type
    let emailType = null;
    let newStatus = null;

    if (/(interview|schedule a call|invitation to interview|next steps|availability for a call)/i.test(fullText)) {
      emailType = "INTERVIEW_INVITE";
      newStatus = "INTERVIEW";
    } else if (/(unfortunately|other candidates|decided not to move forward|will not be moving forward|pursuing other)/i.test(fullText)) {
      emailType = "REJECTION";
      newStatus = "REJECTED";
    } else if (/(thank you for applying|application received|we have received your application|application confirmation|thanks for your interest)/i.test(fullText)) {
      emailType = "CONFIRMATION";
      newStatus = "CONFIRMED";
    } else if (/(status update|application update)/i.test(fullText)) {
      emailType = "STATUS_UPDATE";
    }

    if (!emailType) {
      return { matched: false, reason: "Not an application-related email" };
    }

    const companyName = matchedApp ? matchedApp.company : "General / Unknown";
    const snippet = (body || subject || "").slice(0, 150);

    // Record in email_logs
    this.db.recordEmailLog({
      id,
      jobId: matchedApp ? matchedApp.job_id : null,
      company: companyName,
      subject,
      sender,
      receivedAt: receivedAt || new Date().toISOString(),
      emailType,
      snippet
    });

    // Update application status if company matched
    if (matchedApp && newStatus) {
      const extra = {};
      if (newStatus === "CONFIRMED") {
        extra.confirmationReceived = true;
        extra.confirmationDate = receivedAt || new Date().toISOString();
      }
      this.db.updateApplicationStatus(matchedApp.job_id, newStatus, extra);
      return {
        matched: true,
        company: matchedApp.company,
        role: matchedApp.title,
        emailType,
        newStatus
      };
    }

    return { matched: false, company: companyName, emailType, reason: "Company not in active applications list" };
  }

  /**
   * Simulates an incoming email for testing/demo purposes.
   */
  simulateTestEmail(companyName, type = "CONFIRMATION") {
    const now = new Date().toISOString();
    let subject = "";
    let body = "";

    if (type === "CONFIRMATION") {
      subject = `Thank you for applying to ${companyName}! Application Received`;
      body = `Hi Candidate, We have received your application at ${companyName}. Our recruiting team will review your qualifications and reach out if there is a match.`;
    } else if (type === "INTERVIEW") {
      subject = `Next Steps: Interview with ${companyName}`;
      body = `Hi Candidate, We were impressed by your background and would like to schedule an introductory call to discuss the role at ${companyName}.`;
    }

    return this.processEmail({
      id: `sim_${Date.now()}`,
      subject,
      sender: `careers@${companyName.toLowerCase().replace(/[^a-z]/g, "")}.com`,
      body,
      receivedAt: now
    });
  }
}

// CLI runner
async function main() {
  const args = process.argv.slice(2);
  const isMock = args.includes("--mock");
  const testCompany = args[args.indexOf("--company") + 1] || "Sardine";

  const db = new JobDatabase(path.join(ROOT_DIR, "data/jobs.db"));
  const service = new EmailSyncService(db);

  console.log("\n📬 --- WORKWORK AUTOMATED EMAIL SYNC ---");

  if (isMock) {
    console.log(`Simulating confirmation email from "${testCompany}"...`);
    const res = service.simulateTestEmail(testCompany, "CONFIRMATION");
    console.log("Result:", JSON.stringify(res, null, 2));
  } else {
    console.log("Checking email inbox for application updates...");
    console.log("(To connect live Gmail/IMAP, configure EMAIL_USER and EMAIL_APP_PASSWORD in config.json)");
    
    // Check recent logs
    const logs = db.getEmailLogs(5);
    console.log(`\nRecent Email Events Logged (${logs.length}):`);
    for (const l of logs) {
      console.log(`• [${l.email_type}] ${l.company}: "${l.email_subject}" (${l.received_at})`);
    }
  }

  const metrics = db.getApplicationMetrics();
  console.log("\n📊 Application Status Metrics:");
  console.log(`  - Total Sent Applications: ${metrics.totalApplied}`);
  console.log(`  - Confirmations Received:   ${metrics.confirmed}`);
  console.log(`  - Interviews Scheduled:     ${metrics.interviews}`);
  console.log(`  - Follow-ups Pending:       ${metrics.followUpsDue}`);

  db.close();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(console.error);
}
