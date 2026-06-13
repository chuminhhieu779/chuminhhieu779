#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");

const API_ENDPOINT = "https://api.youpass.vn/v1/answers/statistics";
const START_TAG = "<!-- YOUPASS:START -->";
const END_TAG = "<!-- YOUPASS:END -->";
const BAR_WIDTH = 25;
const ACTIVITY_PAGE_SIZE = 3;
const ACTIVITY_LIMIT = Number(process.env.YOUPASS_ACTIVITY_LIMIT || 10);
const TABLE_SEPARATOR_WIDTH = 90;

const SKILLS = [
  { id: 1, name: "Reading", icon: "📖", unit: "Passage" },
  { id: 2, name: "Listening", icon: "🎧", unit: "Section" },
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

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "");
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) {
      return number;
    }
  }

  return undefined;
}

function fitEnd(value, width) {
  return (String(value) + " ".repeat(width)).slice(0, width);
}

function fitStart(value, width) {
  return (" ".repeat(width) + String(value)).slice(-width);
}

function isRecord(value) {
  return value !== null && typeof value === "object";
}

function walkObject(value, visit, path = [], seen = new Set()) {
  if (!isRecord(value) || seen.has(value) || path.length > 6) {
    return;
  }

  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item, index) => walkObject(item, visit, path.concat(String(index)), seen));
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    const nextPath = path.concat(key);
    visit(key, child, nextPath);
    walkObject(child, visit, nextPath, seen);
  }
}

function looksLikeUsefulTitle(value) {
  const text = String(value || "").trim();
  return text.length > 1
    && !/^[-\d.:%\s]+$/.test(text)
    && !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(text)
    && !/^https?:\/\//i.test(text);
}

function titleKeyScore(path) {
  const joined = path.join(".").toLowerCase();
  const key = path.at(-1).toLowerCase();

  if (/(^|[_-])(title|name)$/.test(key) || /(title|name)$/i.test(key)) {
    if (/(test|exam|exercise|lesson|topic|passage|section|question|material|resource|book)/.test(joined)) {
      return 3;
    }

    if (!/(skill|type|level|status|category|user|student|teacher|author|id)/.test(joined)) {
      return 1;
    }
  }

  return 0;
}

function findDeepTitle(item) {
  const matches = [];

  walkObject(item, (key, value, path) => {
    if (typeof value !== "string" || !looksLikeUsefulTitle(value)) {
      return;
    }

    const score = titleKeyScore(path);
    if (score > 0) {
      matches.push({ score, depth: path.length, value: value.trim() });
    }
  });

  matches.sort((left, right) => right.score - left.score || left.depth - right.depth);
  return matches[0]?.value;
}

function cleanActivityTitle(value) {
  return String(value)
    .trim()
    .replace(/^\[[^\]]+\]\s*-\s*/, "")
    .trim();
}

function durationValue(field, value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return undefined;
  }

  if (typeof value === "string" && /[hms]/i.test(value)) {
    return value;
  }

  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return undefined;
  }

  let minutes = number;
  if (/second|sec/i.test(field) || (!/minute|min/i.test(field) && number >= 180)) {
    minutes = Math.round(number / 60);
  }

  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder > 0 ? `${hours}h ${remainder}m` : `${hours}h`;
  }

  return `${Math.round(minutes)}m`;
}

function findDeepDuration(item) {
  const matches = [];

  walkObject(item, (key, value, path) => {
    const joined = path.join(".").toLowerCase();
    if (!/(duration|spent|elapsed|learned|second|minute|total_time|time_spent|spent_time)/.test(joined)) {
      return;
    }

    if (/(created|updated|submitted|finished|date|timestamp|timezone)/.test(joined)) {
      return;
    }

    const formatted = durationValue(key, value);
    if (formatted) {
      matches.push({ depth: path.length, value: formatted });
    }
  });

  matches.sort((left, right) => left.depth - right.depth);
  return matches[0]?.value;
}

function percentFor(item) {
  const explicit = firstFiniteNumber(
    item.correct_percent,
    item.correctPercent,
    item.percent,
    item.percentage,
    item.score_percent,
    item.scorePercent,
    item.result_percent,
    item.resultPercent,
    item.accuracy,
  );

  if (explicit !== undefined) {
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

function formatDate(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);

  if (match) {
    return `${match[1].slice(2)}.${Number(match[2])}.${Number(match[3])}`;
  }

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return raw || "-";
  }

  return `${String(date.getFullYear()).slice(2)}.${date.getMonth() + 1}.${date.getDate()}`;
}

function activityTimestamp(item) {
  const value = firstValue(
    item.date_created,
    item.created_date,
    item.created_at,
    item.createdAt,
    item.updated_at,
    item.submitted_at,
    item.finished_at,
  );
  const timestamp = Date.parse(String(value || ""));

  return Number.isFinite(timestamp) ? timestamp : 0;
}

function activityTitle(item) {
  const title = String(
    firstValue(
      item.title,
      item.quiz_title,
      item.quizTitle,
      item.test_title,
      item.testTitle,
      item.exam_title,
      item.examTitle,
      item.exercise_title,
      item.exerciseTitle,
      item.topic_title,
      item.topicTitle,
      item.lesson_title,
      item.lessonTitle,
      item.passage_title,
      item.passageTitle,
      item.section_title,
      item.sectionTitle,
      item.question_group_title,
      item.questionGroupTitle,
      item.questionGroup?.title,
      item.question_group?.title,
      item.questionGroup?.name,
      item.question_group?.name,
      item.name,
      item.test_name,
      item.testName,
      item.exam_name,
      item.examName,
      item.exercise_name,
      item.exerciseName,
      item.test?.title,
      item.test?.name,
      item.exam?.title,
      item.exam?.name,
      item.exercise?.title,
      item.exercise?.name,
      item.lesson?.title,
      item.lesson?.name,
      item.answer?.title,
      item.answer?.name,
      item.topic?.title,
      item.topic?.name,
      item.resource?.title,
      item.resource?.name,
      item.material?.title,
      item.material?.name,
      item.book?.title,
      item.book?.name,
      findDeepTitle(item),
      "-",
    ),
  );

  return cleanActivityTitle(title);
}

function activityDuration(item) {
  const candidates = [
    ["completed_duration", item.completed_duration],
    ["completedDuration", item.completedDuration],
    ["duration_seconds", item.duration_seconds],
    ["durationSecond", item.durationSecond],
    ["total_seconds", item.total_seconds],
    ["duration_minutes", item.duration_minutes],
    ["durationMinute", item.durationMinute],
    ["duration", item.duration],
    ["time_spent", item.time_spent],
    ["timeSpent", item.timeSpent],
    ["total_time", item.total_time],
    ["learned_duration", item.learned_duration],
    ["elapsed_time", item.elapsed_time],
    ["time", item.time],
  ];

  for (const [field, value] of candidates) {
    const formatted = durationValue(field, value);
    if (formatted) {
      return formatted;
    }
  }

  return findDeepDuration(item) || "-";
}

function formatSkill(skill, items) {
  const lines = [`${skill.icon} ${skill.name}`];

  if (items.length === 0) {
    lines.push("");
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

  lines.push("");
  lines.push(header);
  lines.push("─".repeat(Math.max(TABLE_SEPARATOR_WIDTH, header.length + BAR_WIDTH + widths.percent + 4)));

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

function normalizeActivity(skill, item) {
  const date = firstValue(
    item.date_created,
    item.created_date,
    item.created_at,
    item.createdAt,
    item.updated_at,
    item.submitted_at,
    item.finished_at,
  );

  return {
    date: formatDate(date),
    skill: skill.name,
    title: activityTitle(item),
    percent: `${percentFor(item).toFixed(2)}%`,
    time: activityDuration(item),
    timestamp: activityTimestamp(item),
  };
}

function formatActivity(activityItems) {
  const lines = ["📋 Recent Activity"];

  if (activityItems.length === 0) {
    lines.push("");
    lines.push("No activity yet.");
    return lines.join("\n");
  }

  const rows = activityItems.map(({ skill, item }) => normalizeActivity(skill, item));
  const widths = {
    date: 9,
    skill: 12,
    title: 42,
    score: 8,
    time: Math.max("Time".length, ...rows.map((row) => row.time.length)),
  };

  const header = [
    fitEnd("Date", widths.date),
    fitEnd("Skill", widths.skill),
    fitEnd("Title", widths.title),
    fitStart("Score", widths.score),
    "",
    fitStart("Time", widths.time),
  ].join("   ");

  lines.push("");
  lines.push(header);
  lines.push("─".repeat(Math.max(TABLE_SEPARATOR_WIDTH, header.length)));

  rows.forEach((row, index) => {
    if (index > 0) {
      lines.push("");
    }

    lines.push(
      [
        fitEnd(row.date, widths.date),
        fitEnd(row.skill, widths.skill),
        fitEnd(row.title, widths.title),
        fitStart(row.percent, widths.score),
        "",
        fitStart(row.time, widths.time),
      ].join("   "),
    );
  });

  return lines.join("\n");
}

function formatStats(skillResults, activityItems = []) {
  return [
    "```text",
    skillResults.map(({ skill, items }) => formatSkill(skill, items)).join("\n\n"),
    "```",
    "",
    "```text",
    formatActivity(activityItems),
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

async function fetchSkillActivity(skill, authHeaders) {
  const url = new URL(API_ENDPOINT);
  url.searchParams.set("skill_id", String(skill.id));
  url.searchParams.set("page", "1");
  url.searchParams.set("page_size", String(ACTIVITY_PAGE_SIZE));
  url.searchParams.set("type", "1");
  url.searchParams.set("sort", "date_created.desc");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      ...authHeaders,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Youpass activity API returned ${response.status} for ${skill.name}: ${body.slice(0, 300)}`,
    );
  }

  const payload = await response.json();
  return Array.isArray(payload?.data?.items) ? payload.data.items : [];
}

async function updateReadme() {
  const readmePath = path.resolve(process.env.README_PATH || "README.md");
  const authHeaders = buildAuthHeaders(process.env.YOUPASS_TOKEN);

  const [skillResults, activityResults] = await Promise.all([
    Promise.all(
      SKILLS.map(async (skill) => ({
        skill,
        items: await fetchSkillStats(skill, authHeaders),
      })),
    ),
    Promise.all(
      SKILLS.map(async (skill) => ({
        skill,
        items: await fetchSkillActivity(skill, authHeaders),
      })),
    ),
  ]);

  const activityItems = activityResults
    .flatMap(({ skill, items }) => items.map((item) => ({ skill, item })))
    .sort((left, right) => activityTimestamp(right.item) - activityTimestamp(left.item))
    .slice(0, Number.isFinite(ACTIVITY_LIMIT) && ACTIVITY_LIMIT > 0 ? ACTIVITY_LIMIT : 10);

  const readme = await fs.readFile(readmePath, "utf8");
  const nextReadme = replaceTaggedSection(readme, formatStats(skillResults, activityItems));

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
  activityDuration,
  activityTimestamp,
  activityTitle,
  buildAuthHeaders,
  formatActivity,
  formatDate,
  formatSkill,
  formatStats,
  progressBar,
  replaceTaggedSection,
};
