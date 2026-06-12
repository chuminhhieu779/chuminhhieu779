#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const { buildAuthHeaders } = require("./update-ielts.js");
const {
  ensureBadgeContainer,
  replaceTaggedSection,
} = require("./update-ielts-streak.js");

const VOCAB_ENDPOINT = "https://api.youpass.vn/v1/users/vocabs";
const VOCAB_BADGE_START_TAG = "<!-- YOUPASS_VOCAB_BADGE:START -->";
const VOCAB_BADGE_END_TAG = "<!-- YOUPASS_VOCAB_BADGE:END -->";

function badgeUrl(total) {
  const label = encodeURIComponent("Vocab Learned");
  const message = encodeURIComponent(`${total} words`);
  return `https://img.shields.io/badge/${label}-${message}-3C3489?style=flat-square&labelColor=2d3436&color=3C3489`;
}

function formatBadgeImage(total) {
  return `<img src="${badgeUrl(total)}" height="25" style="border-radius: 5px;" alt="Vocab Learned: ${total} words" />`;
}

function findTotal(payload) {
  const total = payload?.total ?? payload?.data?.total;

  if (!Number.isFinite(Number(total))) {
    throw new Error("Could not find total in Youpass vocab response.");
  }

  return Number(total);
}

async function fetchVocabTotal(authHeaders) {
  const url = new URL(VOCAB_ENDPOINT);
  url.searchParams.set("categories", process.env.YOUPASS_VOCAB_CATEGORY || "cat_1");
  url.searchParams.set("page_size", process.env.YOUPASS_VOCAB_PAGE_SIZE || "300");
  url.searchParams.set("page", "1");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      ...authHeaders,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Youpass vocab API returned ${response.status}: ${body.slice(0, 300)}`);
  }

  return findTotal(await response.json());
}

async function updateReadme() {
  const readmePath = path.resolve(process.env.README_PATH || "README.md");
  const authHeaders = buildAuthHeaders(process.env.YOUPASS_TOKEN);
  const total = await fetchVocabTotal(authHeaders);

  const readme = ensureBadgeContainer(await fs.readFile(readmePath, "utf8"));
  const nextReadme = replaceTaggedSection(
    readme,
    VOCAB_BADGE_START_TAG,
    VOCAB_BADGE_END_TAG,
    `  ${formatBadgeImage(total)}`,
  );

  if (nextReadme === readme) {
    console.log("Vocab badge is already up to date.");
    return;
  }

  await fs.writeFile(readmePath, nextReadme);
  console.log(`Updated vocab badge in ${path.relative(process.cwd(), readmePath) || readmePath}.`);
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("Usage: YOUPASS_TOKEN=<token-or-cookie> node scripts/update-vocab-badge.js");
} else if (require.main === module) {
  updateReadme().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  badgeUrl,
  findTotal,
  formatBadgeImage,
};
