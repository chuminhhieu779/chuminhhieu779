#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const { writeBadgeSvg } = require("./badge-svg.js");
const {
  ensureBadgeContainer,
  replaceTaggedSection,
} = require("./update-ielts-streak.js");

const VOCAB_BADGE_START_TAG = "<!-- YOUPASS_VOCAB_BADGE:START -->";
const VOCAB_BADGE_END_TAG = "<!-- YOUPASS_VOCAB_BADGE:END -->";
const OPENQUIZ_START_TAG = "<!-- OPENQUIZ_STATS:START -->";
const OPENQUIZ_END_TAG = "<!-- OPENQUIZ_STATS:END -->";
const RANKING_BADGE_PATH = "assets/vocab-learned.svg";

function formatBadgeImage(ranking) {
  return `<img src="${RANKING_BADGE_PATH}" alt="Ranking: ${ranking}" />`;
}

/**
 * Đọc ranking level từ section OPENQUIZ_STATS trong README.
 * Format: "Mastered: 94 words | Ranking: Luyện Khí"
 */
function parseRanking(readme) {
  const startIndex = readme.indexOf(OPENQUIZ_START_TAG);
  const endIndex = readme.indexOf(OPENQUIZ_END_TAG);

  if (startIndex === -1 || endIndex === -1 || startIndex >= endIndex) {
    return null;
  }

  const section = readme.slice(startIndex + OPENQUIZ_START_TAG.length, endIndex);
  const match = section.match(/(?:Ranking|Cultivation):\s*([^\n|<>]+)/i);

  if (!match) {
    return null;
  }

  return match[1].trim() || null;
}

async function updateReadme() {
  const readmePath = path.resolve(process.env.README_PATH || "README.md");
  const readme = ensureBadgeContainer(await fs.readFile(readmePath, "utf8"));

  const ranking = parseRanking(readme);

  if (!ranking) {
    console.error(
      `Could not find ranking in ${OPENQUIZ_START_TAG}...${OPENQUIZ_END_TAG} section. ` +
      'Make sure the section exists in README.md with format: "Mastered: <number> words | Ranking: <realm>"'
    );
    process.exitCode = 1;
    return;
  }

  await writeBadgeSvg(path.resolve(RANKING_BADGE_PATH), "Ranking", ranking);

  const nextReadme = replaceTaggedSection(
    readme,
    VOCAB_BADGE_START_TAG,
    VOCAB_BADGE_END_TAG,
    `  ${formatBadgeImage(ranking)}`,
  );

  if (nextReadme === readme) {
    console.log("Ranking badge is already up to date.");
    return;
  }

  await fs.writeFile(readmePath, nextReadme);
  console.log(`Updated ranking badge: ${ranking} (from OpenQuiz ranking level).`);
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(
    "Usage: node scripts/update-vocab-badge.js\n" +
    "Reads ranking from the <!-- OPENQUIZ_STATS:START --> section in README.md."
  );
} else if (require.main === module) {
  updateReadme().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  formatBadgeImage,
  parseRanking,
};
