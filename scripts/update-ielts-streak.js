#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const { buildAuthHeaders } = require("./update-ielts.js");

const START_TAG = "<!-- YOUPASS_STREAK:START -->";
const END_TAG = "<!-- YOUPASS_STREAK:END -->";
const API_ENDPOINT = "https://api.youpass.vn/v1/students";
const STUDENT_ID = process.env.YOUPASS_STUDENT_ID || "7a775336-c7e7-4181-a994-386a185512c4";
const START_DATE = process.env.YOUPASS_STREAK_START_DATE || "2026-04-01";
const TIME_ZONE = process.env.YOUPASS_TIME_ZONE || "Asia/Ho_Chi_Minh";
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

function badgeUrl(days) {
  const label = encodeURIComponent("🔥 IELTS Streak");
  const message = encodeURIComponent(`${days} days`);
  return `https://img.shields.io/badge/${label}-${message}-3C3489?style=flat-square&labelColor=f1f0fe&color=3C3489`;
}

function formatBadge(days) {
  return [
    '<p align="center">',
    `  <img src="${badgeUrl(days)}" alt="IELTS Streak: ${days} days" />`,
    "</p>",
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

  const readme = await fs.readFile(readmePath, "utf8");
  const nextReadme = replaceTaggedSection(readme, formatBadge(streakDays));

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
  badgeUrl,
  countActiveDays,
  formatBadge,
  hasLearningActivity,
  todayInTimeZone,
};
