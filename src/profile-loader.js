import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");

const PROFILE_FILE = path.join(ROOT_DIR, "profile.json");
const EXAMPLE_PROFILE_FILE = path.join(ROOT_DIR, "profile.example.json");

const DEFAULT_PROFILE = {
  candidate: {
    name: "YOUR NAME",
    email: "your.email@example.com",
    phone: "555-555-5555",
    city: "Your City, ST",
    remoteEligible: true,
    linkedin: "linkedin.com/in/your-profile",
    github: "github.com/your-username",
    workAuthorization: "US Citizen (No sponsorship required)"
  },
  targetRoles: [
    "Software Engineer",
    "Full Stack Engineer",
    "Frontend Developer",
    "Backend Developer",
    "QA Engineer",
    "DevOps Engineer"
  ],
  tagline: "Software Engineer — specializing in scalable web systems, clean architecture, and automated testing.",
  roles: [
    {
      company: "TechCorp Inc.",
      title: "Software Engineer",
      period: "2022–Present · Remote",
      bullets: [
        "Architected and deployed full-stack features with high reliability and automated test coverage.",
        "Streamlined development and CI/CD pipelines, accelerating delivery cycles.",
        "Conducted thorough code reviews and collaborated closely with cross-functional product teams."
      ]
    },
    {
      company: "Solutions LLC",
      title: "Associate Developer",
      period: "2020–2022 · Hybrid",
      bullets: [
        "Built responsive web user interfaces and robust backend API endpoints.",
        "Authored repeatable test suites and defect triage documentation."
      ]
    }
  ],
  skills: {
    languages: ["JavaScript", "TypeScript", "Python", "SQL"],
    frameworks: ["React", "Node.js", "Express"],
    testing: ["Playwright", "Jest", "Automated Testing", "Regression"],
    tools: ["Git", "Docker", "CI/CD", "Linux"]
  },
  screeningAnswers: {
    sponsorship: "Yes, I am a US citizen and authorized to work in the United States without sponsorship.",
    interest: "I am excited by the company's technical vision, engineering standards, and impactful products."
  }
};

/**
 * Loads the user profile from profile.json if it exists; otherwise falls back to
 * profile.example.json or built-in defaults.
 */
export function loadProfile() {
  if (fs.existsSync(PROFILE_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(PROFILE_FILE, "utf8"));
      return { ...DEFAULT_PROFILE, ...data };
    } catch (e) {
      console.warn(`⚠️ Warning: Could not parse profile.json: ${e.message}. Using defaults.`);
    }
  }

  if (fs.existsSync(EXAMPLE_PROFILE_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(EXAMPLE_PROFILE_FILE, "utf8"));
      return { ...DEFAULT_PROFILE, ...data };
    } catch {}
  }

  return DEFAULT_PROFILE;
}

/**
 * Returns candidate contact and identity details.
 */
export function getCandidate() {
  const profile = loadProfile();
  return profile.candidate || DEFAULT_PROFILE.candidate;
}

/**
 * Returns flat array of all configured skills.
 */
export function getAllSkills() {
  const profile = loadProfile();
  const skillsObj = profile.skills || {};
  const flat = [];
  for (const list of Object.values(skillsObj)) {
    if (Array.isArray(list)) {
      flat.push(...list);
    }
  }
  return flat;
}
