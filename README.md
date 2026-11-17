# 💼 Workwork: FinTech ATS Job Scanner

> [!WARNING]
> **🚧 ALPHA VERSION — EARLY PREVIEW**:
> This project is currently in **alpha** and under active development. It is **not yet fully functional or feature-complete**. Core components (direct ATS queries, review cockpit, and matching models) are evolving and may contain breaking changes or experimental behavior.

A high-signal job discovery and deduplication pipeline that directly queries public ATS endpoints (**Greenhouse**, **Ashby**, and **Lever**) for **45+ top FinTech startups** (Ramp, Brex, Plaid, Stripe, Robinhood, Affirm, Toast, Carta, Chime, Gusto, Mercury, Monzo, etc.).

No headless browsers or CAPTCHA proxies required — scans 3,000+ active listings in under 20 seconds.

---

## ⚡ Quick Start

### 1. Launch the Ratatui Command Center
```bash
workwork
```
*(or `npm run tui` inside `projects/Workwork`)*

### 🎮 Pages & Guided Walkthrough Workflow:
* **`[1]`**: **Sent Applications Pipeline** — Tracks all sent applications, employer email confirmations (`email-sync.js`), interview status (📞), follow-up countdowns (⏰), and offers (🏆).
* **`[2]`**: **Application Review & Walkthrough Cockpit (Guided 1-by-1)** — Walks through unapplied listings one job at a time. Displays:
  - **Job Metadata & Direct ATS Portal Link**
  - **Resume Diff**: Real-time diff between your base profile and the role-tailored resume (tagline before/after, bullet prioritization, alignment points).
  - **Screening Questions & Auto-fill**: Auto-fills contact, work authorization, and sponsorship from memory, and highlights questions needing your review with AI-suggested answers.
* **`[3]`**: **Screening Questions & Memory** — Persistent memory database of approved answers.
* **`[Enter]` / `[A]`**: **Approve & Submit / Mark Applied** — Approves the tailored resume, saves application to pipeline, and advances to next job.
* **`[O]`**: **Open Application in Browser** — Launches the employer's direct application portal with pre-filled context ready.
* **`[S]` / `[X]`**: **Skip Job** — Marks job as skipped and moves forward in queue.
* **`[Y]`**: **Approve & Remember Question** — Saves suggested answer permanently into memory for all future jobs.
* **`[T]`**: **View Resume** — Opens the full tailored markdown resume.
* **`[N]` / `[P]` (or `j`/`k`)**: Next / Previous job in queue.
* **`[F]`**: **Cycle Role Filter** — Toggles between:
  1. `🎯 Junior & QA Only` (Default: QA, Test, SDET, Junior, Jr, Entry Level, Associate, Support, Solutions)
  2. `🚀 Non-Senior Roles` (Junior, QA, and mid/regular Developer roles without Senior/Staff/Lead/Manager/Architect)
  3. `🌐 All Roles` (Unfiltered, including Senior/Staff)
* **`[R]`**: Toggle Remote Only vs All Locations.
* **`[Q]`**: Quit.

### 2. Match Jobs Against Your Resume Profile
```bash
npm run match:resume
```

### 3. Sync Email Confirmations & Follow-ups
```bash
npm run sync:email
```

### 4. Run a Fresh ATS Job Scan (<= 21 Days Old)
```bash
npm start
```

### 5. View Database & Application Statistics
```bash
npm run stats
```

---

## 📂 Project Structure

```
projects/Workwork/
├── companies.json         # 45+ verified FinTech companies & ATS identifiers
├── config.json            # Keyword filters, location preferences, and settings
├── data/
│   └── jobs.db            # Local SQLite database tracking all seen jobs & status
├── matches_digest.md      # Auto-generated Markdown checklist with direct apply links
├── matches.json           # Machine-readable JSON export of all active matches
├── package.json
└── src/
    ├── index.js           # Main CLI coordinator & concurrent worker pool
    ├── database.js        # SQLite interface (upsert, status, deduplication)
    ├── filter.js          # Search keyword & location matching engine
    ├── exporter.js        # Markdown checklist & JSON exporters
    └── scrapers/
        ├── greenhouse.js  # Direct Greenhouse board JSON API consumer
        ├── ashby.js       # Direct Ashby posting API consumer
        └── lever.js       # Direct Lever postings API consumer
```

---

## ⚙️ Customizing Your Search Criteria

Edit `config.json` to change the keywords or location settings:

```json
{
  "search": {
    "includeKeywords": [
      "software",
      "engineer",
      "developer",
      "backend",
      "frontend",
      "full stack",
      "distributed systems"
    ],
    "excludeKeywords": [
      "intern",
      "director",
      "recruiter",
      "sales"
    ],
    "locations": [
      "remote",
      "us",
      "san francisco",
      "new york"
    ],
    "requireRemote": false,
    "maxAgeDays": 21
  }
}
```

* **`maxAgeDays`**: Automatically excludes stale/zombie job listings older than 3 weeks (21 days) based on the ATS posting or update timestamp.

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

## 🔄 How Deduplication Works

* Each job posting receives a deterministic unique key (e.g. `ashby_ramp_<id>` or `gh_stripe_<id>`).
* On every scan, jobs are saved into `data/jobs.db` with status `NEW`.
* Subsequent scans update `last_seen_at` without re-notifying you or duplicating entries.
* `matches_digest.md` provides an active markdown checklist of unapplied positions with direct apply links.
