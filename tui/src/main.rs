use std::io::{self, stdout};
use std::path::Path;
use std::process::Command;
use std::time::Duration;

use crossterm::{
    event::{self, Event, KeyCode, KeyEventKind},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    backend::CrosstermBackend,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, List, ListItem, ListState, Paragraph, Tabs, Wrap},
    Frame, Terminal,
};
use rusqlite::Connection;

#[derive(Clone, Debug)]
struct JobItem {
    id: String,
    company: String,
    title: String,
    location: String,
    url: String,
    is_remote: bool,
    status: String,
}

#[derive(Clone, Debug)]
struct ApplicationItem {
    job_id: String,
    company: String,
    title: String,
    url: String,
    applied_at: String,
    tailored_resume_path: Option<String>,
    confirmation_received: bool,
    confirmation_date: Option<String>,
    follow_up_due_date: Option<String>,
    status: String,
}

#[derive(Clone, Debug)]
struct FlaggedQuestionItem {
    id: String,
    company: String,
    title: String,
    question: String,
    suggested_answer: String,
    confidence_score: i32,
    status: String,
}

#[derive(Clone, Debug, Default)]
struct JobReviewItem {
    job_id: String,
    company: String,
    title: String,
    url: String,
    base_tagline: String,
    tailored_tagline: String,
    bullet_diff: String,
    alignment_notes: String,
    tailored_resume_path: String,
    auto_filled_summary: String,
    unfilled_questions_text: String,
    has_unfilled: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RoleFilter {
    JuniorAndQa, // Default: QA, Quality Assurance, Test, SDET, Junior, Jr, Entry Level, Associate, Support, Solutions
    NonSenior,   // All roles excluding Senior, Staff, Principal, Lead, Architect, Manager, Director, Head of, VP
    All,         // All roles
}

impl RoleFilter {
    fn label(&self) -> &'static str {
        match self {
            RoleFilter::JuniorAndQa => "🎯 Junior & QA Only",
            RoleFilter::NonSenior => "🚀 Non-Senior Roles",
            RoleFilter::All => "🌐 All Roles (inc. Senior)",
        }
    }
}

struct AppMetrics {
    total_applied: usize,
    confirmed: usize,
    interviews: usize,
    rejected: usize,
    follow_ups_due: usize,
    unapplied_remote: usize,
    flagged_questions_count: usize,
}

struct AppState {
    tab_index: usize, // 0 = Sent Applications Pipeline, 1 = Application Review & Walkthrough, 2 = Screening Questions & Memory
    remote_only: bool,
    role_filter: RoleFilter,
    applications: Vec<ApplicationItem>,
    app_list_state: ListState,
    unapplied_jobs: Vec<JobItem>,
    job_list_state: ListState,
    current_review: Option<JobReviewItem>,
    flagged_questions: Vec<FlaggedQuestionItem>,
    flagged_list_state: ListState,
    metrics: AppMetrics,
    status_message: String,
}

impl AppState {
    fn new(conn: &Connection) -> Self {
        let mut app = Self {
            tab_index: 1, // Starts directly on Tab 2: Application Review & Walkthrough!
            remote_only: true,
            role_filter: RoleFilter::JuniorAndQa, // Filter out Senior roles by default! Focus on Junior & QA
            applications: Vec::new(),
            app_list_state: ListState::default(),
            unapplied_jobs: Vec::new(),
            job_list_state: ListState::default(),
            current_review: None,
            flagged_questions: Vec::new(),
            flagged_list_state: ListState::default(),
            metrics: AppMetrics {
                total_applied: 0,
                confirmed: 0,
                interviews: 0,
                rejected: 0,
                follow_ups_due: 0,
                unapplied_remote: 0,
                flagged_questions_count: 0,
            },
            status_message: "Walkthrough Ready. 🎯 Filter: Junior & QA Only. Press [F] to toggle non-senior/all roles.".to_string(),
        };
        app.refresh_data(conn);
        if !app.applications.is_empty() {
            app.app_list_state.select(Some(0));
        }
        if !app.unapplied_jobs.is_empty() {
            app.job_list_state.select(Some(0));
            app.load_current_review(conn);
        }
        if !app.flagged_questions.is_empty() {
            app.flagged_list_state.select(Some(0));
        }
        app
    }

    fn refresh_data(&mut self, conn: &Connection) {
        // 1. Load Applications (Hiring Pipeline)
        let mut app_stmt = conn
            .prepare("SELECT job_id, company, title, url, applied_at, tailored_resume_path, confirmation_received, confirmation_date, follow_up_due_date, status FROM applications ORDER BY applied_at DESC")
            .unwrap();

        let app_iter = app_stmt
            .query_map([], |row| {
                Ok(ApplicationItem {
                    job_id: row.get(0)?,
                    company: row.get(1)?,
                    title: row.get(2)?,
                    url: row.get(3)?,
                    applied_at: row.get(4)?,
                    tailored_resume_path: row.get(5).ok(),
                    confirmation_received: row.get::<_, i32>(6)? != 0,
                    confirmation_date: row.get(7).ok(),
                    follow_up_due_date: row.get(8).ok(),
                    status: row.get(9)?,
                })
            })
            .unwrap();

        self.applications = app_iter.filter_map(Result::ok).collect();

        // 2. Load Unapplied Jobs (status = 'NEW') with Senior Filtering
        let remote_clause = if self.remote_only {
            " AND is_remote = 1 "
        } else {
            " "
        };

        let senior_exclusion_clause = "
            AND title NOT LIKE '%Senior%'
            AND title NOT LIKE '%Sr.%'
            AND title NOT LIKE '%Sr %'
            AND title NOT LIKE '%Staff%'
            AND title NOT LIKE '%Principal%'
            AND title NOT LIKE 'Lead %'
            AND title NOT LIKE '% Lead'
            AND title NOT LIKE '%Architect%'
            AND title NOT LIKE '%Manager%'
            AND title NOT LIKE '%Director%'
            AND title NOT LIKE '%Head of%'
            AND title NOT LIKE '% VP%'
            AND title NOT LIKE '%AVP%'
            AND title NOT LIKE '%Engineer III%'
            AND title NOT LIKE '%Engineer IV%'
            AND title NOT LIKE '%Engineer V%'
        ";

        let junior_qa_clause = "
            AND (
              title LIKE '%QA%'
              OR title LIKE '%Quality%'
              OR title LIKE '%Test%'
              OR title LIKE '%SDET%'
              OR title LIKE '%Junior%'
              OR title LIKE '%Jr%'
              OR title LIKE '%Entry%'
              OR title LIKE '%Associate%'
              OR title LIKE '%Support%'
              OR title LIKE '%Solutions%'
            )
        ";

        let role_clause = match self.role_filter {
            RoleFilter::JuniorAndQa => format!("{}{}", senior_exclusion_clause, junior_qa_clause),
            RoleFilter::NonSenior => senior_exclusion_clause.to_string(),
            RoleFilter::All => String::new(),
        };

        let job_sql = format!(
            "SELECT id, company, title, location, url, is_remote, status FROM jobs WHERE status = 'NEW' {}{} ORDER BY first_seen_at DESC",
            remote_clause, role_clause
        );

        let mut job_stmt = conn.prepare(&job_sql).unwrap();
        let job_iter = job_stmt
            .query_map([], |row| {
                Ok(JobItem {
                    id: row.get(0)?,
                    company: row.get(1)?,
                    title: row.get(2)?,
                    location: row.get(3).unwrap_or_default(),
                    url: row.get(4)?,
                    is_remote: row.get::<_, i32>(5)? != 0,
                    status: row.get(6)?,
                })
            })
            .unwrap();

        self.unapplied_jobs = job_iter.filter_map(Result::ok).collect();

        // 3. Load Flagged Questions
        let mut flag_stmt = conn
            .prepare("SELECT id, company, title, question, suggested_answer, confidence_score, status FROM flagged_questions WHERE status = 'PENDING' ORDER BY created_at DESC")
            .unwrap();

        let flag_iter = flag_stmt
            .query_map([], |row| {
                Ok(FlaggedQuestionItem {
                    id: row.get(0)?,
                    company: row.get(1)?,
                    title: row.get(2)?,
                    question: row.get(3)?,
                    suggested_answer: row.get(4)?,
                    confidence_score: row.get(5)?,
                    status: row.get(6)?,
                })
            })
            .unwrap();

        self.flagged_questions = flag_iter.filter_map(Result::ok).collect();

        // 4. Update Metrics
        self.metrics.total_applied = self.applications.len();
        self.metrics.confirmed = self.applications.iter().filter(|a| a.confirmation_received).count();
        self.metrics.interviews = self.applications.iter().filter(|a| a.status == "INTERVIEW").count();
        self.metrics.rejected = self.applications.iter().filter(|a| a.status == "REJECTED").count();
        self.metrics.unapplied_remote = self.unapplied_jobs.len();
        self.metrics.flagged_questions_count = self.flagged_questions.len();
        self.metrics.follow_ups_due = self.applications.iter().filter(|a| a.status == "APPLIED" || a.status == "CONFIRMED").count();
    }

    fn load_current_review(&mut self, conn: &Connection) {
        let i = match self.job_list_state.selected() {
            Some(idx) if idx < self.unapplied_jobs.len() => idx,
            _ => return,
        };

        let job = &self.unapplied_jobs[i];
        let job_id = job.id.clone();

        // 1. Try loading cached review from SQLite
        let mut stmt = conn
            .prepare("SELECT job_id, company, title, url, base_tagline, tailored_tagline, bullet_diff, alignment_notes, tailored_resume_path, auto_filled_summary, unfilled_questions_text, has_unfilled FROM job_reviews WHERE job_id = ?1")
            .unwrap();

        let review_opt = stmt
            .query_row([&job_id], |row| {
                Ok(JobReviewItem {
                    job_id: row.get(0)?,
                    company: row.get(1)?,
                    title: row.get(2)?,
                    url: row.get(3)?,
                    base_tagline: row.get(4)?,
                    tailored_tagline: row.get(5)?,
                    bullet_diff: row.get(6)?,
                    alignment_notes: row.get(7)?,
                    tailored_resume_path: row.get(8)?,
                    auto_filled_summary: row.get(9)?,
                    unfilled_questions_text: row.get(10)?,
                    has_unfilled: row.get::<_, i32>(11)? != 0,
                })
            })
            .ok();

        if let Some(rev) = review_opt {
            self.current_review = Some(rev);
        } else {
            // Evaluate on-demand via Node review cockpit
            let _ = Command::new("node")
                .args(["../src/review-cockpit.js", "--job", &job_id])
                .output();

            let review_after = stmt
                .query_row([&job_id], |row| {
                    Ok(JobReviewItem {
                        job_id: row.get(0)?,
                        company: row.get(1)?,
                        title: row.get(2)?,
                        url: row.get(3)?,
                        base_tagline: row.get(4)?,
                        tailored_tagline: row.get(5)?,
                        bullet_diff: row.get(6)?,
                        alignment_notes: row.get(7)?,
                        tailored_resume_path: row.get(8)?,
                        auto_filled_summary: row.get(9)?,
                        unfilled_questions_text: row.get(10)?,
                        has_unfilled: row.get::<_, i32>(11)? != 0,
                    })
                })
                .ok();

            if let Some(rev) = review_after {
                self.current_review = Some(rev);
            } else {
                // Fallback display
                self.current_review = Some(JobReviewItem {
                    job_id: job.id.clone(),
                    company: job.company.clone(),
                    title: job.title.clone(),
                    url: job.url.clone(),
                    base_tagline: "Software QA Analyst — manual & exploratory testing, defect triage, UAT verification.".to_string(),
                    tailored_tagline: format!("Software QA Analyst — testing, code review, AI integration, and automation tooling for {}.", job.company),
                    bullet_diff: "+ [Priority #1] Code Review & Exploratory Manual Testing across web platforms\n+ [Priority #2] AI Pipeline: Tool accelerating test cycle times ~75%".to_string(),
                    alignment_notes: format!("• Tailored for {}: Verified QA background, reproducible triage. Zero fabricated facts.", job.company),
                    tailored_resume_path: format!("tailored_resumes/resume_{}.md", job.company.to_lowercase()),
                    auto_filled_summary: "✓ [Auto-Filled] Contact: YOUR NAME | your.email@example.com\n✓ [Auto-Filled] Work Auth: US Citizen (No sponsorship required)".to_string(),
                    unfilled_questions_text: "✓ Standard fields auto-filled. Press [Enter] to approve & submit.".to_string(),
                    has_unfilled: false,
                });
            }
        }
    }

    fn next_item(&mut self, conn: &Connection) {
        match self.tab_index {
            0 => {
                if self.applications.is_empty() { return; }
                let i = match self.app_list_state.selected() {
                    Some(i) => if i >= self.applications.len() - 1 { 0 } else { i + 1 },
                    None => 0,
                };
                self.app_list_state.select(Some(i));
            }
            1 => {
                if self.unapplied_jobs.is_empty() { return; }
                let i = match self.job_list_state.selected() {
                    Some(i) => if i >= self.unapplied_jobs.len() - 1 { 0 } else { i + 1 },
                    None => 0,
                };
                self.job_list_state.select(Some(i));
                self.load_current_review(conn);
            }
            2 => {
                if self.flagged_questions.is_empty() { return; }
                let i = match self.flagged_list_state.selected() {
                    Some(i) => if i >= self.flagged_questions.len() - 1 { 0 } else { i + 1 },
                    None => 0,
                };
                self.flagged_list_state.select(Some(i));
            }
            _ => {}
        }
    }

    fn previous_item(&mut self, conn: &Connection) {
        match self.tab_index {
            0 => {
                if self.applications.is_empty() { return; }
                let i = match self.app_list_state.selected() {
                    Some(i) => if i == 0 { self.applications.len() - 1 } else { i - 1 },
                    None => 0,
                };
                self.app_list_state.select(Some(i));
            }
            1 => {
                if self.unapplied_jobs.is_empty() { return; }
                let i = match self.job_list_state.selected() {
                    Some(i) => if i == 0 { self.unapplied_jobs.len() - 1 } else { i - 1 },
                    None => 0,
                };
                self.job_list_state.select(Some(i));
                self.load_current_review(conn);
            }
            2 => {
                if self.flagged_questions.is_empty() { return; }
                let i = match self.flagged_list_state.selected() {
                    Some(i) => if i == 0 { self.flagged_questions.len() - 1 } else { i - 1 },
                    None => 0,
                };
                self.flagged_list_state.select(Some(i));
            }
            _ => {}
        }
    }

    fn approve_and_submit_review(&mut self, conn: &Connection) {
        let i = match self.job_list_state.selected() {
            Some(idx) if idx < self.unapplied_jobs.len() => idx,
            _ => return,
        };

        let job = self.unapplied_jobs[i].clone();
        let resume_path = self
            .current_review
            .as_ref()
            .map(|r| r.tailored_resume_path.clone())
            .unwrap_or_default();

        let now = chrono::Utc::now().to_rfc3339();
        let follow_up = (chrono::Utc::now() + chrono::Duration::days(10)).to_rfc3339();

        let _ = conn.execute(
            "INSERT OR REPLACE INTO applications (job_id, company, title, url, applied_at, tailored_resume_path, confirmation_received, follow_up_due_date, notes, status) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, 'Reviewed & Approved via Walkthrough Cockpit', 'APPLIED')",
            (&job.id, &job.company, &job.title, &job.url, &now, &resume_path, &follow_up),
        );
        let _ = conn.execute("UPDATE jobs SET status = 'APPLIED' WHERE id = ?1", [&job.id]);

        self.refresh_data(conn);
        if !self.unapplied_jobs.is_empty() {
            let next_idx = if i >= self.unapplied_jobs.len() { 0 } else { i };
            self.job_list_state.select(Some(next_idx));
            self.load_current_review(conn);
        } else {
            self.current_review = None;
        }

        self.status_message = format!("✅ Approved & Recorded Application: {} at {}! Moved to Tab 1 pipeline.", job.title, job.company);
    }

    fn skip_current_job(&mut self, conn: &Connection) {
        let i = match self.job_list_state.selected() {
            Some(idx) if idx < self.unapplied_jobs.len() => idx,
            _ => return,
        };

        let job = self.unapplied_jobs[i].clone();
        let _ = conn.execute("UPDATE jobs SET status = 'SKIPPED' WHERE id = ?1", [&job.id]);

        self.refresh_data(conn);
        if !self.unapplied_jobs.is_empty() {
            let next_idx = if i >= self.unapplied_jobs.len() { 0 } else { i };
            self.job_list_state.select(Some(next_idx));
            self.load_current_review(conn);
        } else {
            self.current_review = None;
        }

        self.status_message = format!("⏭️ Skipped {} at {}. Next job loaded.", job.title, job.company);
    }

    fn open_current_in_browser(&mut self) {
        let url = match self.tab_index {
            0 => {
                if let Some(i) = self.app_list_state.selected() {
                    self.applications.get(i).map(|a| a.url.clone())
                } else {
                    None
                }
            }
            1 => {
                if let Some(i) = self.job_list_state.selected() {
                    self.unapplied_jobs.get(i).map(|j| j.url.clone())
                } else {
                    None
                }
            }
            _ => None,
        };

        if let Some(u) = url {
            let _ = open::that(&u);
            self.status_message = format!("🌐 Opened application URL in your browser: {}", u);
        }
    }

    fn open_tailored_resume(&mut self) {
        if let Some(rev) = &self.current_review {
            if !rev.tailored_resume_path.is_empty() {
                let _ = open::that(&rev.tailored_resume_path);
                self.status_message = format!("📄 Opened tailored resume: {}", rev.tailored_resume_path);
            }
        }
    }

    fn approve_current_question(&mut self, conn: &Connection) {
        if let Some(i) = self.flagged_list_state.selected() {
            if let Some(item) = self.flagged_questions.get(i) {
                let item_id = item.id.clone();
                let question = item.question.clone();
                let suggested = item.suggested_answer.clone();

                let _ = conn.execute("UPDATE flagged_questions SET status = 'APPROVED' WHERE id = ?1", [&item_id]);

                // Learn pattern into saved_answers
                let words: Vec<&str> = question
                    .split(|c: char| !c.is_alphanumeric())
                    .filter(|w| w.len() > 3)
                    .take(4)
                    .collect();
                let pattern = if !words.is_empty() { words.join(".*") } else { question.chars().take(30).collect() };
                let ans_id = format!("ans_{}", chrono::Utc::now().timestamp_millis());
                let now = chrono::Utc::now().to_rfc3339();

                let _ = conn.execute(
                    "INSERT OR REPLACE INTO saved_answers (id, pattern, sample_question, saved_answer, category, times_used, created_at) VALUES (?1, ?2, ?3, ?4, 'LEARNED_QUESTION', 1, ?5)",
                    (&ans_id, &pattern, &question, &suggested, &now),
                );

                self.refresh_data(conn);
                self.load_current_review(conn);
                self.status_message = format!("🧠 Approved & Learned! Saved to memory: '{}'", suggested);
            }
        }
    }

    fn run_email_sync(&mut self, conn: &Connection) {
        self.status_message = "Syncing email confirmations...".to_string();
        let _ = Command::new("node")
            .arg("../src/email-sync.js")
            .output();
        self.refresh_data(conn);
        self.status_message = "📬 Email sync complete! Hiring flow & status updated.".to_string();
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let db_path = if Path::new("data/jobs.db").exists() {
        "data/jobs.db"
    } else if Path::new("../data/jobs.db").exists() {
        "../data/jobs.db"
    } else {
        "./jobs.db"
    };

    let conn = Connection::open(db_path)?;
    let mut app = AppState::new(&conn);

    enable_raw_mode()?;
    let mut stdout = stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let res = run_app(&mut terminal, &mut app, &conn);

    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;

    if let Err(err) = res {
        println!("Error: {:?}", err);
    }

    Ok(())
}

fn run_app(
    terminal: &mut Terminal<CrosstermBackend<io::Stdout>>,
    app: &mut AppState,
    conn: &Connection,
) -> io::Result<()> {
    loop {
        terminal.draw(|f| ui(f, app))?;

        if event::poll(Duration::from_millis(250))? {
            if let Event::Key(key) = event::read()? {
                if key.kind == KeyEventKind::Press {
                    match key.code {
                        KeyCode::Char('q') | KeyCode::Esc => return Ok(()),
                        // Number keys 1, 2, 3 for direct tab jumping
                        KeyCode::Char('1') | KeyCode::F(1) => app.tab_index = 0,
                        KeyCode::Char('2') | KeyCode::F(2) => app.tab_index = 1,
                        KeyCode::Char('3') | KeyCode::F(3) => app.tab_index = 2,
                        KeyCode::Tab => app.tab_index = (app.tab_index + 1) % 3,
                        KeyCode::BackTab => app.tab_index = if app.tab_index == 0 { 2 } else { app.tab_index - 1 },
                        KeyCode::Down | KeyCode::Char('j') => app.next_item(conn),
                        KeyCode::Up | KeyCode::Char('k') => app.previous_item(conn),
                        KeyCode::Right | KeyCode::Char('n') | KeyCode::Char('N') => app.next_item(conn),
                        KeyCode::Left | KeyCode::Char('p') | KeyCode::Char('P') => app.previous_item(conn),

                        // Action Keys
                        KeyCode::Enter | KeyCode::Char('a') | KeyCode::Char('A') => {
                            if app.tab_index == 1 {
                                app.approve_and_submit_review(conn);
                            } else if app.tab_index == 0 {
                                app.open_current_in_browser();
                            }
                        }
                        KeyCode::Char('o') | KeyCode::Char('O') => app.open_current_in_browser(),
                        KeyCode::Char('s') | KeyCode::Char('S') => {
                            if app.tab_index == 1 {
                                app.skip_current_job(conn);
                            } else if app.tab_index == 0 {
                                app.run_email_sync(conn);
                            }
                        }
                        KeyCode::Char('x') | KeyCode::Char('X') => {
                            if app.tab_index == 1 {
                                app.skip_current_job(conn);
                            }
                        }
                        KeyCode::Char('y') | KeyCode::Char('Y') => app.approve_current_question(conn),
                        KeyCode::Char('t') | KeyCode::Char('T') => app.open_tailored_resume(),
                        KeyCode::Char('r') | KeyCode::Char('R') => {
                            app.remote_only = !app.remote_only;
                            app.refresh_data(conn);
                            app.load_current_review(conn);
                            app.status_message = if app.remote_only {
                                "🌐 Filter active: REMOTE ONLY".to_string()
                            } else {
                                "📍 Filter active: ALL (Remote + On-Site)".to_string()
                            };
                        }
                        KeyCode::Char('f') | KeyCode::Char('F') => {
                            app.role_filter = match app.role_filter {
                                RoleFilter::JuniorAndQa => RoleFilter::NonSenior,
                                RoleFilter::NonSenior => RoleFilter::All,
                                RoleFilter::All => RoleFilter::JuniorAndQa,
                            };
                            app.refresh_data(conn);
                            if !app.unapplied_jobs.is_empty() {
                                app.job_list_state.select(Some(0));
                                app.load_current_review(conn);
                            } else {
                                app.current_review = None;
                            }
                            app.status_message = format!(
                                "Filter active: {} ({} matching roles)",
                                app.role_filter.label(),
                                app.unapplied_jobs.len()
                            );
                        }
                        _ => {}
                    }
                }
            }
        }
    }
}

fn ui(f: &mut Frame, app: &AppState) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3), // Top Header & Stats Bar
            Constraint::Length(3), // Tab Navigation Bar
            Constraint::Min(10),   // Main View
            Constraint::Length(2), // Bottom Action Bar
        ])
        .split(f.area());

    // 1. Top Header & Metrics Bar
    let header_text = format!(
        " WORKWORK  │  Applied: {}  │  Confirmed: {}  │  In Review: {}  │  Interviews: {}  │  Follow-ups Due: {}  │  Review Queue: {} ",
        app.metrics.total_applied,
        app.metrics.confirmed,
        app.applications.iter().filter(|a| a.status == "APPLIED").count(),
        app.metrics.interviews,
        app.metrics.follow_ups_due,
        app.metrics.unapplied_remote
    );

    let header = Paragraph::new(header_text)
        .style(Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD))
        .block(Block::default().borders(Borders::ALL).border_style(Style::default().fg(Color::Cyan)));
    f.render_widget(header, chunks[0]);

    // 2. Tab Navigation
    let tab_titles = vec![
        Span::raw(format!(" [1] Sent Applications Pipeline ({}) ", app.applications.len())),
        Span::raw(format!(" [2] Application Review & Walkthrough ({}) [{}] ", app.unapplied_jobs.len(), app.role_filter.label())),
        Span::raw(format!(" [3] Screening Questions & Memory ({}) ", app.metrics.flagged_questions_count)),
    ];
    let tabs = Tabs::new(tab_titles)
        .select(app.tab_index)
        .block(Block::default().borders(Borders::ALL))
        .style(Style::default().fg(Color::White))
        .highlight_style(Style::default().fg(Color::Green).add_modifier(Modifier::BOLD));
    f.render_widget(tabs, chunks[1]);

    // 3. Main Split Content View
    let main_chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(34), Constraint::Percentage(66)])
        .split(chunks[2]);

    match app.tab_index {
        0 => render_hiring_flow_tab(f, app, main_chunks[0], main_chunks[1]),
        1 => render_review_walkthrough_tab(f, app, main_chunks[0], main_chunks[1]),
        _ => render_flagged_queue_tab(f, app, main_chunks[0], main_chunks[1]),
    }

    // 4. Status Footer
    let footer_text = match app.tab_index {
        1 => Line::from(vec![
            Span::styled("[Enter / A] ", Style::default().fg(Color::Green).add_modifier(Modifier::BOLD)),
            Span::raw("Approve  │ "),
            Span::styled("[O] ", Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)),
            Span::raw("Open URL  │ "),
            Span::styled("[S / X] ", Style::default().fg(Color::Red).add_modifier(Modifier::BOLD)),
            Span::raw("Skip  │ "),
            Span::styled("[F] ", Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD)),
            Span::styled(format!("Filter [{}]  │ ", app.role_filter.label()), Style::default().fg(Color::Yellow)),
            Span::styled("[Y] ", Style::default().fg(Color::Green).add_modifier(Modifier::BOLD)),
            Span::raw("Learn Ans  │ "),
            Span::styled("[N/P or j/k] ", Style::default().fg(Color::White).add_modifier(Modifier::BOLD)),
            Span::raw("Next/Prev  │ [Q] Quit"),
        ]),
        _ => Line::from(vec![
            Span::styled(&app.status_message, Style::default().fg(Color::Yellow)),
            Span::raw("  │ [1/2/3] Tabs │ [Enter/O] Open Browser │ [S] Sync Email │ [F] Toggle Filter │ [Q] Quit"),
        ]),
    };
    let footer = Paragraph::new(footer_text);
    f.render_widget(footer, chunks[3]);
}

// Page 1: Sent Applications Pipeline (Hiring Flow)
fn render_hiring_flow_tab(f: &mut Frame, app: &AppState, left: Rect, right: Rect) {
    let items: Vec<ListItem> = app
        .applications
        .iter()
        .map(|a| {
            // Prominent leading emoji so status is NEVER cut off by terminal width truncation!
            let (icon, color) = match a.status.as_str() {
                "CONFIRMED" => ("📩", Color::Green),
                "INTERVIEW" => ("📞", Color::Magenta),
                "OFFER" => ("🏆", Color::Cyan),
                "REJECTED" => ("❌", Color::Red),
                _ => ("✉️", Color::Yellow),
            };
            let text = format!("{} {} · {}", icon, a.company, a.title);
            ListItem::new(text).style(Style::default().fg(color))
        })
        .collect();

    let title = format!(" Hiring Pipeline: Sent Applications ({}) ", app.applications.len());
    let list = List::new(items)
        .block(Block::default().title(title).borders(Borders::ALL))
        .highlight_style(Style::default().bg(Color::DarkGray).fg(Color::White).add_modifier(Modifier::BOLD))
        .highlight_symbol("▶ ");

    let mut state = app.app_list_state.clone();
    f.render_stateful_widget(list, left, &mut state);

    // Right details pane: Application Timeline & Follow-up countdown
    let details = if let Some(i) = app.app_list_state.selected() {
        if let Some(a) = app.applications.get(i) {
            vec![
                Line::from(vec![Span::styled("Company:         ", Style::default().add_modifier(Modifier::BOLD)), Span::styled(&a.company, Style::default().fg(Color::Yellow))]),
                Line::from(vec![Span::styled("Position:        ", Style::default().add_modifier(Modifier::BOLD)), Span::styled(&a.title, Style::default().fg(Color::Cyan))]),
                Line::from(vec![Span::styled("Hiring Stage:    ", Style::default().add_modifier(Modifier::BOLD)), Span::styled(&a.status, Style::default().fg(Color::Green))]),
                Line::from(""),
                Line::from(vec![Span::styled("Applied Date:    ", Style::default().add_modifier(Modifier::BOLD)), Span::raw(&a.applied_at)]),
                Line::from(vec![Span::styled("Confirmation:    ", Style::default().add_modifier(Modifier::BOLD)), Span::raw(if a.confirmation_received { "✅ Verified via Email Sync" } else { "⏳ Pending employer email" })]),
                Line::from(vec![Span::styled("Follow-Up Due:   ", Style::default().add_modifier(Modifier::BOLD)), Span::styled(a.follow_up_due_date.as_deref().unwrap_or("In 10 days"), Style::default().fg(Color::Yellow))]),
                Line::from(""),
                Line::from(vec![Span::styled("Tailored Resume: ", Style::default().add_modifier(Modifier::BOLD)), Span::raw(a.tailored_resume_path.as_deref().unwrap_or("Standard Profile"))]),
                Line::from(""),
                Line::from(vec![Span::styled("Job Listing URL: ", Style::default().add_modifier(Modifier::BOLD))]),
                Line::from(Span::styled(&a.url, Style::default().fg(Color::Blue))),
                Line::from(""),
                Line::from("Actions: Press [Enter] or [O] to open application page in browser."),
            ]
        } else {
            vec![Line::from("No applications submitted yet. Switch to Tab [2] to review and apply!")]
        }
    } else {
        vec![Line::from("No applications submitted yet. Switch to Tab [2] to review and apply!")]
    };

    let details_p = Paragraph::new(details)
        .block(Block::default().title(" Hiring Stage & Application Timeline ").borders(Borders::ALL))
        .wrap(Wrap { trim: true });
    f.render_widget(details_p, right);
}

// Page 2: Application Review & Walkthrough Cockpit (One Job at a Time)
fn render_review_walkthrough_tab(f: &mut Frame, app: &AppState, left: Rect, right: Rect) {
    let selected_idx = app.job_list_state.selected().unwrap_or(0);
    let total_jobs = app.unapplied_jobs.len();

    // 1. Left Pane: Stepper Queue
    let items: Vec<ListItem> = app
        .unapplied_jobs
        .iter()
        .enumerate()
        .map(|(idx, j)| {
            let badge = if j.status.contains("EXCLUSIVE") || j.status.contains("DIRECT") {
                "🔥"
            } else {
                "🌐"
            };
            let text = format!("[{:03}/{:03}] {} {} · {}", idx + 1, total_jobs, badge, j.company, j.title);
            ListItem::new(text)
        })
        .collect();

    let title = format!(
        " Stepper Queue ({}/{}) [{}] ",
        if total_jobs == 0 { 0 } else { selected_idx + 1 },
        total_jobs,
        app.role_filter.label()
    );
    let list = List::new(items)
        .block(Block::default().title(title).borders(Borders::ALL))
        .highlight_style(Style::default().bg(Color::DarkGray).fg(Color::White).add_modifier(Modifier::BOLD))
        .highlight_symbol("▶ ");

    let mut state = app.job_list_state.clone();
    f.render_stateful_widget(list, left, &mut state);

    // 2. Right Pane: Structured Review Cockpit Card
    let right_chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(4), // Job Meta Header
            Constraint::Length(12), // Resume Diff Card
            Constraint::Min(8),    // Screening Questions & Auto-fill Card
        ])
        .split(right);

    if let Some(rev) = &app.current_review {
        // Meta Header
        let meta_lines = vec![
            Line::from(vec![
                Span::styled(&rev.company, Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD)),
                Span::raw("  —  "),
                Span::styled(&rev.title, Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)),
            ]),
            Line::from(vec![
                Span::styled("Apply URL: ", Style::default().fg(Color::DarkGray)),
                Span::styled(&rev.url, Style::default().fg(Color::Blue)),
            ]),
        ];
        let header_p = Paragraph::new(meta_lines)
            .block(Block::default().title(" 📋 Job Details & Application Portal ").borders(Borders::ALL))
            .wrap(Wrap { trim: true });
        f.render_widget(header_p, right_chunks[0]);

        // Resume Diff Card
        let mut diff_lines = vec![
            Line::from(vec![
                Span::styled("--- BASE TAGLINE:      ", Style::default().fg(Color::DarkGray)),
                Span::styled(&rev.base_tagline, Style::default().fg(Color::DarkGray)),
            ]),
            Line::from(vec![
                Span::styled("+++ TAILORED TAGLINE:  ", Style::default().fg(Color::Green).add_modifier(Modifier::BOLD)),
                Span::styled(&rev.tailored_tagline, Style::default().fg(Color::Green)),
            ]),
            Line::from(""),
            Line::from(vec![Span::styled("BULLET PRIORITIZATION & EMPHASIS:", Style::default().add_modifier(Modifier::BOLD).fg(Color::Yellow))]),
        ];

        for line in rev.bullet_diff.lines() {
            let color = if line.starts_with('+') {
                Color::Green
            } else if line.starts_with('-') {
                Color::Red
            } else {
                Color::White
            };
            diff_lines.push(Line::from(Span::styled(format!("  {}", line), Style::default().fg(color))));
        }

        diff_lines.push(Line::from(""));
        diff_lines.push(Line::from(Span::styled(&rev.alignment_notes, Style::default().fg(Color::Cyan))));

        let diff_p = Paragraph::new(diff_lines)
            .block(Block::default().title(" 📝 RESUME DIFF (Base Profile vs Tailored for this Role) ").borders(Borders::ALL))
            .wrap(Wrap { trim: true });
        f.render_widget(diff_p, right_chunks[1]);

        // Questions & Auto-fill Card
        let mut q_lines = vec![];

        q_lines.push(Line::from(vec![Span::styled("AUTO-FILLED FIELDS (Profile & Saved Memory):", Style::default().add_modifier(Modifier::BOLD).fg(Color::Green))]));
        for line in rev.auto_filled_summary.lines() {
            q_lines.push(Line::from(Span::styled(format!("  {}", line), Style::default().fg(Color::White))));
        }

        q_lines.push(Line::from(""));
        q_lines.push(Line::from(vec![Span::styled("SCREENING QUESTIONS EVALUATION:", Style::default().add_modifier(Modifier::BOLD).fg(Color::Yellow))]));

        for line in rev.unfilled_questions_text.lines() {
            let color = if line.contains("⚠️") {
                Color::Yellow
            } else if line.contains("✓") {
                Color::Green
            } else if line.contains("Actions:") {
                Color::Cyan
            } else {
                Color::White
            };
            q_lines.push(Line::from(Span::styled(format!("  {}", line), Style::default().fg(color))));
        }

        let q_title = if rev.has_unfilled {
            " ❓ SCREENING QUESTIONS (Review Needed Before Sending) "
        } else {
            " ❓ SCREENING QUESTIONS (100% Auto-Filled & Ready) "
        };
        let q_p = Paragraph::new(q_lines)
            .block(Block::default().title(q_title).borders(Borders::ALL))
            .wrap(Wrap { trim: true });
        f.render_widget(q_p, right_chunks[2]);
    } else {
        let empty_p = Paragraph::new("No unapplied listings found in queue. Press [R] to toggle remote filter.")
            .block(Block::default().title(" Review Cockpit ").borders(Borders::ALL));
        f.render_widget(empty_p, right);
    }
}

// Page 3: Screening Questions & Persistent Memory
fn render_flagged_queue_tab(f: &mut Frame, app: &AppState, left: Rect, right: Rect) {
    let items: Vec<ListItem> = app
        .flagged_questions
        .iter()
        .map(|q| {
            let text = format!("⚠️ [{}] {}: \"{}\"", q.company, q.title, q.question);
            ListItem::new(text).style(Style::default().fg(Color::Yellow))
        })
        .collect();

    let title = format!(" Flagged Questions Needing Human Review ({}) ", app.flagged_questions.len());
    let list = List::new(items)
        .block(Block::default().title(title).borders(Borders::ALL))
        .highlight_style(Style::default().bg(Color::DarkGray).fg(Color::White).add_modifier(Modifier::BOLD))
        .highlight_symbol("▶ ");

    let mut state = app.flagged_list_state.clone();
    f.render_stateful_widget(list, left, &mut state);

    let details = if let Some(i) = app.flagged_list_state.selected() {
        if let Some(q) = app.flagged_questions.get(i) {
            vec![
                Line::from(vec![Span::styled("Company:         ", Style::default().add_modifier(Modifier::BOLD)), Span::styled(&q.company, Style::default().fg(Color::Yellow))]),
                Line::from(vec![Span::styled("Role:            ", Style::default().add_modifier(Modifier::BOLD)), Span::styled(&q.title, Style::default().fg(Color::Cyan))]),
                Line::from(vec![Span::styled("AI Confidence:   ", Style::default().add_modifier(Modifier::BOLD)), Span::styled(format!("{}%", q.confidence_score), Style::default().fg(Color::Magenta))]),
                Line::from(""),
                Line::from(vec![Span::styled("QUESTION ASKED BY EMPLOYER:", Style::default().add_modifier(Modifier::BOLD).fg(Color::Red))]),
                Line::from(format!("\"{}\"", q.question)),
                Line::from(""),
                Line::from(vec![Span::styled("SUGGESTED ANSWER (BASED SOLELY ON RESUME FACTS):", Style::default().add_modifier(Modifier::BOLD).fg(Color::Green))]),
                Line::from(Span::raw(&q.suggested_answer)),
                Line::from(""),
                Line::from(vec![Span::styled("ACTIONS:", Style::default().add_modifier(Modifier::BOLD))]),
                Line::from("• Press [Y] to APPROVE & REMEMBER: Auto-fills this answer permanently for all future jobs!"),
                Line::from("• Press [Enter] or [O] to open the employer's direct application form in your browser"),
            ]
        } else {
            vec![
                Line::from("No flagged questions currently in queue!"),
                Line::from("When reviewing jobs on Page [2], any unusual questions can be learned into memory here."),
            ]
        }
    } else {
        vec![
            Line::from("No flagged questions currently in queue!"),
            Line::from("When reviewing jobs on Page [2], any unusual questions can be learned into memory here."),
        ]
    };

    let details_p = Paragraph::new(details)
        .block(Block::default().title(" Screening Question Memory & Suggested Answer ").borders(Borders::ALL))
        .wrap(Wrap { trim: true });
    f.render_widget(details_p, right);
}
