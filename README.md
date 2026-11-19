# 💼 Workwork: FinTech ATS Job Scanner & Cockpit

> [!WARNING]
> **🚧 ALPHA VERSION — EARLY PREVIEW**:
> This project is currently in **alpha** and under active development. It is **not yet fully functional or feature-complete**. Core components (direct ATS queries, review cockpit, and matching models) are evolving and may contain breaking changes or experimental behavior.

A high-signal job discovery, deduplication, and application pipeline that directly queries public ATS endpoints (**Greenhouse**, **Ashby**, and **Lever**) for **45+ top FinTech startups** (Ramp, Brex, Plaid, Stripe, Robinhood, Affirm, Toast, Carta, Chime, Gusto, Mercury, Monzo, etc.).

No headless browsers or CAPTCHA proxies required — scans 3,000+ active listings in under 20 seconds.

---

## ⚡ Quick Start

### 1. Configure for Your Target Role & Background
Workwork is fully customizable for **any engineering or tech role** (Full Stack, Frontend, Backend, QA/SDET, DevOps, Data, Solutions, etc.).

Run the interactive setup wizard:
```bash
npm run setup
```
This wizard will prompt you for:
* **Target Field & Keywords**: Choose a preset (Full Stack, Frontend, Backend, QA, DevOps) or enter custom keywords.
* **Location & Remote Preference**: Set remote-only requirements and preferred cities.
* **Candidate Profile**: Sets your name, contact info, and core skills into `profile.json` (*automatically gitignored to keep your personal data private*).

*(You can also configure manually by editing `config.json` and copying `profile.example.json` ➔ `profile.json`)*

---

### 2. Scan 45+ Startups for Active Listings
```bash
npm start
```
* Queries Greenhouse, Ashby, and Lever APIs directly.
* Automatically filters for listings under 21 days old and matches your configured keywords.
* Deduplicates and stores listings in local SQLite database `data/jobs.db`.

---

### 3. Launch the Ratatui Command Center
```bash
npm run tui
```
*(or run `./tui/target/release/workwork-tui`)*

#### 🎮 Interactive Keyboard Shortcuts:
* **`[1]`**: **Sent Applications Pipeline** — Tracks all sent applications, employer email confirmations (`npm run sync:email`), interview status (📞), follow-up countdowns (⏰), and offers (🏆).
* **`[2]`**: **Application Review & Cockpit (Guided 1-by-1)** — Walks through unapplied listings one job at a time. Displays:
  - **Job Metadata & Direct ATS Portal Link**
  - **Resume Diff**: Real-time diff between your base profile and the role-tailored resume (tagline before/after, bullet prioritization, alignment points).
  - **Screening Questions & Auto-fill**: Auto-fills contact, work authorization, and sponsorship from memory, and highlights questions needing your review.
* **`[3]`**: **Screening Questions & Memory** — Persistent memory database of approved answers.
* **`[Enter]` / `[A]`**: **Approve & Submit / Mark Applied** — Approves the tailored resume, saves application to pipeline, and advances to next job.
* **`[O]`**: **Open Application in Browser** — Launches the employer's direct application portal with pre-filled context ready.
* **`[S]` / `[X]`**: **Skip Job** — Marks job as skipped and moves forward in queue.
* **`[Y]`**: **Approve & Remember Question** — Saves suggested answer permanently into memory for all future jobs.
* **`[T]`**: **View Resume** — Opens the full tailored markdown resume.
* **`[N]` / `[P]` (or `j`/`k`)**: Next / Previous job in queue.
* **`[F]`**: **Cycle Role Filter** — Toggles between:
  1. `🎯 Target Matches (Configured)` (Roles matching your configured search keywords)
  2. `🚀 Non-Senior Roles` (Excludes Senior/Staff/Lead/Manager/Architect)
  3. `🌐 All Roles` (Unfiltered, including Senior/Staff)
* **`[R]`**: Toggle Remote Only vs All Locations.
* **`[Q]`**: Quit.

---

### 4. Match Jobs Against Your Custom Profile
```bash
npm run match
```
Scores all active listings against your specific skills and target roles, outputting a prioritized markdown checklist: `resume_matches.md`.

---

### 5. Sync Email Confirmations & Follow-ups
```bash
npm run sync:email
```

---

## ⚙️ Customizing Your Search Criteria

Edit `config.json` directly to change keywords, location filters, or stale posting thresholds:

```json
{
  "search": {
    "includeKeywords": [
      "software engineer",
      "frontend",
      "backend",
      "full stack",
      "developer"
    ],
    "excludeKeywords": [
      "intern",
      "director",
      "recruiter",
      "sales",
      "manager"
    ],
    "locations": [
      "remote",
      "us",
      "united states",
      "san francisco",
      "new york",
      "austin"
    ],
    "requireRemote": true,
    "maxAgeDays": 21
  },
  "settings": {
    "concurrency": 8,
    "requestTimeoutMs": 10000,
    "exportMarkdownPath": "matches_digest.md",
    "exportJsonPath": "matches.json"
  }
}
```

* **`includeKeywords`**: Filter job titles and departments for your exact target stack.
* **`excludeKeywords`**: Automatically skip senior, managerial, or non-technical roles.
* **`requireRemote`**: When `true`, only saves listings offering remote work.
* **`maxAgeDays`**: Automatically excludes stale/zombie job listings older than 3 weeks (21 days) based on the ATS posting or update timestamp.

---

## 👤 Customizing Your Candidate Profile (`profile.json`)

Copy `profile.example.json` to `profile.json` (or use `npm run setup`):

```bash
cp profile.example.json profile.json
```

```json
{
  "candidate": {
    "name": "Alex Developer",
    "email": "alex.dev@example.com",
    "phone": "555-555-5555",
    "city": "Austin, TX",
    "remoteEligible": true,
    "linkedin": "linkedin.com/in/alex-developer",
    "github": "github.com/alex-dev",
    "workAuthorization": "US Citizen (No sponsorship required)"
  },
  "targetRoles": [
    "Full Stack Engineer",
    "Frontend Developer",
    "Backend Developer"
  ],
  "tagline": "Software Engineer — specializing in scalable web systems, clean architecture, and automated testing.",
  "roles": [
    {
      "company": "TechCorp Inc.",
      "title": "Software Engineer",
      "period": "2022–Present · Remote",
      "bullets": [
        "Architected full-stack features with high reliability and automated test coverage.",
        "Streamlined CI/CD pipelines, accelerating delivery cycles."
      ]
    }
  ],
  "skills": {
    "languages": ["JavaScript", "TypeScript", "Python", "SQL"],
    "frameworks": ["React", "Node.js", "Express"],
    "tools": ["Git", "Docker", "CI/CD", "Linux"]
  }
}
```

> [!NOTE]
> `profile.json` is listed in `.gitignore` so your personal identity, contact info, and work history will **never be committed** to git or pushed to GitHub.

---

## ➕ Adding More Companies

To track any new company, add an entry to `companies.json`:

```json
{ 
  "name": "NewCompany", 
  "category": "FinTech", 
  "ats": "greenhouse", // or "ashby" or "lever"
  "slug": "newcompany_slug" 
}
```

### How to Find the ATS Slug:
1. Open the company's career page in your browser.
2. Click any job to inspect the URL:
   - If it redirects to `boards.greenhouse.io/<slug>/...` -> ATS is `greenhouse`, slug is `<slug>`
   - If it redirects to `jobs.ashbyhq.com/<slug>/...` -> ATS is `ashby`, slug is `<slug>`
   - If it redirects to `jobs.lever.co/<slug>/...` -> ATS is `lever`, slug is `<slug>`

---

## 📂 Project Structure

```text
projects/Workwork/
├── companies.json         # 45+ verified FinTech companies & ATS identifiers
├── config.json            # Keyword filters, location preferences, and settings
├── profile.example.json   # Template candidate profile & skills
├── profile.json           # Your local profile (gitignored)
├── data/
│   └── jobs.db            # Local SQLite database tracking all seen jobs & status
├── matches_digest.md      # Auto-generated Markdown checklist with direct apply links
├── matches.json           # Machine-readable JSON export of all active matches
├── package.json
├── src/
│   ├── index.js           # Main CLI coordinator & concurrent worker pool
│   ├── setup.js           # Interactive CLI setup wizard for any role/user
│   ├── profile-loader.js  # Dynamic candidate profile & skills loader
│   ├── resume-matcher.js  # Dynamic scoring engine matching jobs to your skills
│   ├── resume-tailor.js   # Dynamic role-tailored resume generator
│   ├── review-cockpit.js  # Application review & auto-fill engine
│   ├── database.js        # SQLite interface (upsert, status, deduplication)
│   ├── filter.js          # Search keyword & location matching engine
│   ├── exporter.js        # Markdown checklist & JSON exporters
│   └── scrapers/          # Direct ATS API consumers (Greenhouse, Ashby, Lever)
└── tui/
    └── src/main.rs        # Ratatui terminal application cockpit
```

---

## 📄 License

MIT
