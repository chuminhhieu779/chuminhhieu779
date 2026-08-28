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

function formatBadgeImage(cultivation) {
  return `<img src="${RANKING_BADGE_PATH}" alt="Ranking: ${cultivation}" />`;
}

/**
 * Đọc cultivation level từ section OPENQUIZ_STATS trong README.
 * Format: "Mastered: 94 words | Cultivation: Luyện Khí"
 */
function parseCultivation(readme) {
  const startIndex = readme.indexOf(OPENQUIZ_START_TAG);
  const endIndex = readme.indexOf(OPENQUIZ_END_TAG);

  if (startIndex === -1 || endIndex === -1 || startIndex >= endIndex) {
    return null;
  }

  const section = readme.slice(startIndex + OPENQUIZ_START_TAG.length, endIndex);
  const match = section.match(/Cultivation:\s*([^\n|<>]+)/i);

  if (!match) {
    return null;
  }

  return match[1].trim() || null;
}

async function updateReadme() {
  const readmePath = path.resolve(process.env.README_PATH || "README.md");
  const readme = ensureBadgeContainer(await fs.readFile(readmePath, "utf8"));

  const cultivation = parseCultivation(readme);

  if (!cultivation) {
    console.error(
      `Could not find cultivation in ${OPENQUIZ_START_TAG}...${OPENQUIZ_END_TAG} section. ` +
      'Make sure the section exists in README.md with format: "Mastered: <number> words | Cultivation: <realm>"'
    );
    process.exitCode = 1;
    return;
  }

  await writeBadgeSvg(path.resolve(RANKING_BADGE_PATH), "⚔️ Ranking", cultivation);

  const nextReadme = replaceTaggedSection(
    readme,
    VOCAB_BADGE_START_TAG,
    VOCAB_BADGE_END_TAG,
    `  ${formatBadgeImage(cultivation)}`,
  );

  if (nextReadme === readme) {
    console.log("Ranking badge is already up to date.");
    return;
  }

  await fs.writeFile(readmePath, nextReadme);
  console.log(`Updated ranking badge: ${cultivation} (from OpenQuiz cultivation level).`);
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(
    "Usage: node scripts/update-vocab-badge.js\n" +
    "Reads cultivation from the <!-- OPENQUIZ_STATS:START --> section in README.md."
  );
} else if (require.main === module) {
  updateReadme().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  formatBadgeImage,
  parseCultivation,
};
