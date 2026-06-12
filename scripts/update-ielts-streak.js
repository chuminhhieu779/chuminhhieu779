#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const { writeBadgeSvg } = require("./badge-svg.js");
const { buildAuthHeaders } = require("./update-ielts.js");

const BADGES_START_TAG = "<!-- YOUPASS_BADGES:START -->";
const BADGES_END_TAG = "<!-- YOUPASS_BADGES:END -->";
const STREAK_BADGE_START_TAG = "<!-- YOUPASS_STREAK_BADGE:START -->";
const STREAK_BADGE_END_TAG = "<!-- YOUPASS_STREAK_BADGE:END -->";
const API_ENDPOINT = "https://api.youpass.vn/v1/students";
const STUDENT_ID = process.env.YOUPASS_STUDENT_ID || "7a775336-c7e7-4181-a994-386a185512c4";
const START_DATE = process.env.YOUPASS_STREAK_START_DATE || "2026-04-01";
const TIME_ZONE = process.env.YOUPASS_TIME_ZONE || "Asia/Ho_Chi_Minh";
const STREAK_BADGE_PATH = "assets/ielts-streak.svg";
const PAGE_SIZE = 100;
const ACTIVITY_FIELDS = [
  "learned_duration",
  "submitted_reading",
  "submitted_listening",
  "submitted_speaking",
  "submitted_writing",
];

function todayInTimeZone(timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function hasLearningActivity(item) {
  return ACTIVITY_FIELDS.some((field) => Number(item?.[field]) > 0);
}

function countActiveDays(items) {
  const activeDates = new Set();

  for (const item of items) {
    if (item?.created_date && hasLearningActivity(item)) {
      activeDates.add(item.created_date);
    }
  }

  return activeDates.size;
}

function formatBadgeImage(days) {
  return `<img src="${STREAK_BADGE_PATH}" alt="IELTS Streak: ${days} days" />`;
}

function replaceTaggedSection(readme, startTag, endTag, content) {
  if (!readme.includes(startTag) || !readme.includes(endTag)) {
    throw new Error(`README must contain both ${startTag} and ${endTag}.`);
  }

  const startIndex = readme.indexOf(startTag);
  const endIndex = readme.indexOf(endTag);

  if (startIndex > endIndex) {
    throw new Error(`${startTag} must appear before ${endTag}.`);
  }

  return [
    readme.slice(0, startIndex),
    startTag,
    "\n",
    content,
    "\n",
    endTag,
    readme.slice(endIndex + endTag.length),
  ].join("");
}

function ensureBadgeContainer(readme) {
  if (readme.includes(BADGES_START_TAG) && readme.includes(BADGES_END_TAG)) {
    return readme;
  }

  if (!readme.includes("<!-- YOUPASS_STREAK:START -->") || !readme.includes("<!-- YOUPASS_STREAK:END -->")) {
    throw new Error(`README must contain either ${BADGES_START_TAG}/${BADGES_END_TAG} or the old YOUPASS_STREAK tags.`);
  }

  return replaceTaggedSection(
    readme,
    "<!-- YOUPASS_STREAK:START -->",
    "<!-- YOUPASS_STREAK:END -->",
    [
      BADGES_START_TAG,
      '<p align="left">',
      `  ${STREAK_BADGE_START_TAG}`,
      `  ${STREAK_BADGE_END_TAG}`,
      `  <!-- YOUPASS_VOCAB_BADGE:START -->`,
      `  <!-- YOUPASS_VOCAB_BADGE:END -->`,
      "</p>",
      BADGES_END_TAG,
    ].join("\n"),
  );
}

async function fetchProgressPage(authHeaders, page, endedAt) {
  const url = new URL(`${API_ENDPOINT}/${encodeURIComponent(STUDENT_ID)}/progresses`);
  url.searchParams.set("started_at", START_DATE);
  url.searchParams.set("ended_at", endedAt);
  url.searchParams.set("page", String(page));
  url.searchParams.set("page_size", String(PAGE_SIZE));

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      ...authHeaders,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Youpass progress API returned ${response.status}: ${body.slice(0, 300)}`);
  }

  return response.json();
}

async function fetchAllProgressItems(authHeaders, endedAt) {
  const items = [];
  let page = 1;
  let total = Infinity;

  while (items.length < total) {
    const payload = await fetchProgressPage(authHeaders, page, endedAt);
    const pageItems = Array.isArray(payload?.data?.items) ? payload.data.items : [];

    total = Number.isFinite(Number(payload?.data?.total)) ? Number(payload.data.total) : items.length + pageItems.length;
    items.push(...pageItems);

    if (pageItems.length === 0) {
      break;
    }

    page += 1;
  }

  return items;
}

async function updateReadme() {
  const readmePath = path.resolve(process.env.README_PATH || "README.md");
  const endDate = todayInTimeZone(TIME_ZONE);
  const authHeaders = buildAuthHeaders(process.env.YOUPASS_TOKEN);
  const progressItems = await fetchAllProgressItems(authHeaders, endDate);
  const streakDays = countActiveDays(progressItems);

  await writeBadgeSvg(path.resolve(STREAK_BADGE_PATH), "🔥 IELTS Streak", `${streakDays} days`);

  const readme = ensureBadgeContainer(await fs.readFile(readmePath, "utf8"));
  const nextReadme = replaceTaggedSection(
    readme,
    STREAK_BADGE_START_TAG,
    STREAK_BADGE_END_TAG,
    `  ${formatBadgeImage(streakDays)}`,
  );

  if (nextReadme === readme) {
    console.log("IELTS streak badge is already up to date.");
    return;
  }

  await fs.writeFile(readmePath, nextReadme);
  console.log(`Updated IELTS streak badge in ${path.relative(process.cwd(), readmePath) || readmePath}.`);
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("Usage: YOUPASS_TOKEN=<token-or-cookie> node scripts/update-ielts-streak.js");
} else if (require.main === module) {
  updateReadme().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  countActiveDays,
  ensureBadgeContainer,
  formatBadgeImage,
  hasLearningActivity,
  replaceTaggedSection,
  todayInTimeZone,
};
