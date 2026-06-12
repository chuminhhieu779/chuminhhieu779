#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");

const API_ENDPOINT = "https://api.youpass.vn/v1/answers/statistics";
const START_TAG = "<!-- YOUPASS:START -->";
const END_TAG = "<!-- YOUPASS:END -->";
const BAR_WIDTH = 25;

const SKILLS = [
  { id: 1, name: "Reading", unit: "Passage" },
  { id: 2, name: "Listening", unit: "Section" },
];

function usage() {
  return [
    "Usage: YOUPASS_TOKEN=<token-or-cookie> node scripts/update-ielts.js",
    "",
    "Optional environment variables:",
    "  README_PATH       Path to README file. Defaults to README.md.",
    "  YOUPASS_TOKEN     Authorization value, raw JWT token, or Cookie header value.",
  ].join("\n");
}

function buildAuthHeaders(rawToken) {
  const token = String(rawToken || "").trim();

  if (!token) {
    throw new Error("Missing YOUPASS_TOKEN. Add it as a GitHub Actions secret before running.");
  }

  const explicitHeader = token.match(/^(authorization|cookie)\s*:\s*(.+)$/i);
  if (explicitHeader) {
    const headerName = explicitHeader[1].toLowerCase() === "cookie" ? "Cookie" : "Authorization";
    return { [headerName]: explicitHeader[2].trim() };
  }

  if (/^(bearer|basic|token)\s+/i.test(token)) {
    return { Authorization: token };
  }

  if (token.includes("=") || token.includes(";")) {
    return { Cookie: token };
  }

  return { Authorization: `Bearer ${token}` };
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function percentFor(item) {
  const explicit = Number(item.correct_percent);
  if (Number.isFinite(explicit)) {
    return explicit;
  }

  const total = numberOrZero(item.total);
  return total > 0 ? (numberOrZero(item.success) / total) * 100 : 0;
}

function progressBar(percent) {
  const clamped = Math.max(0, Math.min(100, numberOrZero(percent)));
  const filled = Math.round((clamped / 100) * BAR_WIDTH);
  return "⣿".repeat(filled) + "⣀".repeat(BAR_WIDTH - filled);
}

function rowLabel(skill, item, index) {
  const value = item.passage ?? item.section ?? item.part ?? item.task ?? item.name ?? index + 1;
  const text = String(value).trim();

  if (!text || text.toLowerCase().startsWith(skill.unit.toLowerCase())) {
    return text || `${skill.unit} ${index + 1}`;
  }

  return `${skill.unit} ${text}`;
}

function formatSkill(skill, items) {
  const lines = [`*${skill.name}*`];

  if (items.length === 0) {
    lines.push("No data yet.");
    return lines.join("\n");
  }

  const rows = items.map((item, index) => {
    const total = numberOrZero(item.total);
    const correct = numberOrZero(item.success);
    const wrong = numberOrZero(item.failed);
    const skipped = numberOrZero(item.skipped);
    const percent = percentFor(item);

    return {
      label: rowLabel(skill, item, index),
      correct,
      wrong,
      skipped,
      total,
      bar: progressBar(percent),
      percent: `${percent.toFixed(2)}%`,
    };
  });

  const widths = {
    label: Math.max(12, ...rows.map((row) => row.label.length)),
    correct: Math.max("Correct".length, ...rows.map((row) => String(row.correct).length)),
    wrong: Math.max("Wrong".length, ...rows.map((row) => String(row.wrong).length)),
    skipped: Math.max("Skipped".length, ...rows.map((row) => String(row.skipped).length)),
    total: Math.max("Total".length, ...rows.map((row) => String(row.total).length)),
    percent: Math.max(7, ...rows.map((row) => row.percent.length)),
  };

  const header = [
    "".padEnd(widths.label),
    "Correct".padStart(widths.correct),
    "Wrong".padStart(widths.wrong),
    "Skipped".padStart(widths.skipped),
    "Total".padStart(widths.total),
    "Progress",
  ].join("  ");

  lines.push(header);
  lines.push("─".repeat(Math.max(64, header.length + BAR_WIDTH + widths.percent + 4)));

  for (const row of rows) {
    lines.push(
      [
        row.label.padEnd(widths.label),
        String(row.correct).padStart(widths.correct),
        String(row.wrong).padStart(widths.wrong),
        String(row.skipped).padStart(widths.skipped),
        String(row.total).padStart(widths.total),
        `${row.bar}  ${row.percent.padStart(widths.percent)}`,
      ].join("  "),
    );
  }

  return lines.join("\n");
}

function formatStats(skillResults) {
  return [
    "```text",
    skillResults.map(({ skill, items }) => formatSkill(skill, items)).join("\n\n"),
    "```",
  ].join("\n");
}

function replaceTaggedSection(readme, content) {
  if (!readme.includes(START_TAG) || !readme.includes(END_TAG)) {
    throw new Error(`README must contain both ${START_TAG} and ${END_TAG}.`);
  }

  const startIndex = readme.indexOf(START_TAG);
  const endIndex = readme.indexOf(END_TAG);

  if (startIndex > endIndex) {
    throw new Error(`${START_TAG} must appear before ${END_TAG}.`);
  }

  return [
    readme.slice(0, startIndex),
    START_TAG,
    "\n",
    content,
    "\n",
    END_TAG,
    readme.slice(endIndex + END_TAG.length),
  ].join("");
}

async function fetchSkillStats(skill, authHeaders) {
  const url = new URL(API_ENDPOINT);
  url.searchParams.set("skill_id", String(skill.id));
  url.searchParams.set("type", "3");
  url.searchParams.set("sort", "passage.asc");
  url.searchParams.set("page_size", "100");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      ...authHeaders,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Youpass API returned ${response.status} for ${skill.name}: ${body.slice(0, 300)}`,
    );
  }

  const payload = await response.json();
  return Array.isArray(payload?.data?.items) ? payload.data.items : [];
}

async function updateReadme() {
  const readmePath = path.resolve(process.env.README_PATH || "README.md");
  const authHeaders = buildAuthHeaders(process.env.YOUPASS_TOKEN);

  const skillResults = await Promise.all(
    SKILLS.map(async (skill) => ({
      skill,
      items: await fetchSkillStats(skill, authHeaders),
    })),
  );

  const readme = await fs.readFile(readmePath, "utf8");
  const nextReadme = replaceTaggedSection(readme, formatStats(skillResults));

  if (nextReadme === readme) {
    console.log("README is already up to date.");
    return;
  }

  await fs.writeFile(readmePath, nextReadme);
  console.log(`Updated ${path.relative(process.cwd(), readmePath) || readmePath}.`);
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(usage());
} else if (require.main === module) {
  updateReadme().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  buildAuthHeaders,
  formatSkill,
  formatStats,
  progressBar,
  replaceTaggedSection,
};
