#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(ROOT_DIR, "config.json");
const PROFILE_PATH = path.join(ROOT_DIR, "profile.json");
const EXAMPLE_PROFILE_PATH = path.join(ROOT_DIR, "profile.example.json");

const ROLE_PRESETS = {
  "1": {
    name: "Full Stack Engineering",
    keywords: ["full stack", "software engineer", "developer", "backend", "frontend", "typescript", "react", "node"]
  },
  "2": {
    name: "Frontend Engineering",
    keywords: ["frontend", "front end", "react", "vue", "ui engineer", "javascript", "typescript", "web developer"]
  },
  "3": {
    name: "Backend & Systems",
    keywords: ["backend", "distributed systems", "api", "golang", "python", "java", "rust", "node", "database"]
  },
  "4": {
    name: "Quality Assurance & SDET",
    keywords: ["qa", "quality", "test", "sdet", "automation", "playwright", "cypress", "testing", "verification"]
  },
  "5": {
    name: "DevOps / Cloud / SRE",
    keywords: ["devops", "sre", "reliability", "cloud", "infrastructure", "kubernetes", "aws", "terraform"]
  }
};

async function main() {
  const rl = readline.createInterface({ input, output });

  console.log("\n========================================================");
  console.log("💼 WORKWORK — Interactive Job Search Setup Wizard");
  console.log("Configure your target role fields and candidate profile.");
  console.log("========================================================\n");

  // 1. Choose Target Field Preset or Custom
  console.log("Select your primary job search field:");
  console.log("  [1] Full Stack Engineering");
  console.log("  [2] Frontend Engineering");
  console.log("  [3] Backend & Systems Engineering");
  console.log("  [4] Quality Assurance & SDET / Automation");
  console.log("  [5] DevOps / Cloud / SRE");
  console.log("  [6] Custom keywords (enter your own)\n");

  const fieldChoice = (await rl.question("Choice [1-6] (default: 1): ")).trim() || "1";

  let chosenKeywords = [];
  let primaryRoleName = "Software Engineer";

  if (ROLE_PRESETS[fieldChoice]) {
    chosenKeywords = ROLE_PRESETS[fieldChoice].keywords;
    primaryRoleName = ROLE_PRESETS[fieldChoice].name;
    console.log(`\n✓ Selected Preset: ${primaryRoleName}`);
  } else {
    const custom = await rl.question("\nEnter your target keywords (comma separated, e.g. python, django, backend): ");
    chosenKeywords = custom.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    if (chosenKeywords.length === 0) {
      chosenKeywords = ROLE_PRESETS["1"].keywords;
    }
    primaryRoleName = chosenKeywords[0].toUpperCase();
  }

  // 2. Location preferences
  console.log("\n--- Location & Remote Preferences ---");
  const remoteAns = (await rl.question("Require Remote only? [Y/n] (default: Y): ")).trim().toLowerCase();
  const requireRemote = remoteAns !== "n";

  const locInput = (await rl.question("Target locations/cities (comma separated, default: remote, us, united states): ")).trim();
  const locations = locInput ? locInput.split(",").map(s => s.trim().toLowerCase()).filter(Boolean) : ["remote", "us", "united states"];

  // 3. Candidate Details
  console.log("\n--- Candidate Profile & Contact Info ---");
  console.log("*(Saved locally to profile.json — gitignored so your personal data stays safe)*\n");

  const name = (await rl.question("Your Full Name: ")).trim() || "Candidate Name";
  const email = (await rl.question("Your Email: ")).trim() || "email@example.com";
  const phone = (await rl.question("Your Phone: ")).trim() || "555-555-5555";
  const city = (await rl.question("Your City, State (e.g. Austin, TX): ")).trim() || "Your City, ST";
  const linkedin = (await rl.question("LinkedIn URL (optional): ")).trim() || "";
  const skillsInput = (await rl.question("Top 4-6 Technical Skills (comma separated): ")).trim();
  const skillsList = skillsInput ? skillsInput.split(",").map(s => s.trim()).filter(Boolean) : chosenKeywords;

  rl.close();

  // Update config.json
  let config = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    } catch {}
  }

  config.search = {
    ...(config.search || {}),
    includeKeywords: chosenKeywords,
    locations,
    requireRemote
  };

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf8");
  console.log(`\n✓ Updated: ${path.relative(ROOT_DIR, CONFIG_PATH)}`);

  // Load existing profile or example as base
  let baseProfile = {};
  if (fs.existsSync(PROFILE_PATH)) {
    try {
      baseProfile = JSON.parse(fs.readFileSync(PROFILE_PATH, "utf8"));
    } catch {}
  } else if (fs.existsSync(EXAMPLE_PROFILE_PATH)) {
    try {
      baseProfile = JSON.parse(fs.readFileSync(EXAMPLE_PROFILE_PATH, "utf8"));
    } catch {}
  }

  const updatedProfile = {
    ...baseProfile,
    candidate: {
      ...(baseProfile.candidate || {}),
      name,
      email,
      phone,
      city,
      linkedin: linkedin || baseProfile.candidate?.linkedin || "",
      remoteEligible: requireRemote
    },
    targetRoles: [primaryRoleName, ...chosenKeywords.slice(0, 3)],
    skills: {
      ...(baseProfile.skills || {}),
      primary: skillsList
    }
  };

  fs.writeFileSync(PROFILE_PATH, JSON.stringify(updatedProfile, null, 2) + "\n", "utf8");
  console.log(`✓ Created: ${path.relative(ROOT_DIR, PROFILE_PATH)} (gitignored)`);

  console.log("\n========================================================");
  console.log("🎉 Setup Complete!");
  console.log("========================================================");
  console.log("You are ready to scan and apply with your custom settings:");
  console.log("  1. npm start         -> Scan 45+ ATS feeds for your target roles");
  console.log("  2. npm run match     -> Match & score active jobs against your profile");
  console.log("  3. npm run tui       -> Launch the Ratatui guided application cockpit");
  console.log("========================================================\n");
}

main().catch(err => {
  console.error("Setup error:", err);
  process.exit(1);
});
