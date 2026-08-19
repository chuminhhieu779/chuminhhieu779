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
const VOCAB_BADGE_PATH = "assets/vocab-learned.svg";
const DEFAULT_PRACTICE_DAILY_PATH = path.resolve("..", "IELTS", "Practice-English-Daily");
const VOCAB_SOURCE_FOLDERS = [
  "Reading",
  "Review Listening Test",
  "Review Reading Test",
  "Watching Daily",
];

function formatBadgeImage(total) {
  return `<img src="${VOCAB_BADGE_PATH}" alt="Vocab Learned: ${total} words" />`;
}

function isVocabLine(line) {
  const trimmed = line.trim();

  return Boolean(
    trimmed
      && !trimmed.startsWith("#")
      && !/^(date|topic)\s*:/i.test(trimmed)
      && /[:=]/.test(trimmed),
  );
}

function stripFrontmatter(markdown) {
  return markdown.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*/, "");
}

function countVocabEntries(markdown) {
  return stripFrontmatter(markdown)
    .split(/\r?\n/)
    .filter(isVocabLine)
    .length;
}

async function markdownFiles(dirPath) {
  let entries;

  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      return markdownFiles(entryPath);
    }

    return entry.isFile() && entry.name.toLowerCase().endsWith(".md") ? [entryPath] : [];
  }));

  return files.flat();
}

async function countVocabFromPracticeDaily(sourcePath) {
  const totals = await Promise.all(VOCAB_SOURCE_FOLDERS.map(async (folder) => {
    const folderPath = path.join(sourcePath, folder);
    const files = await markdownFiles(folderPath);
    const counts = await Promise.all(files.map(async (filePath) => (
      countVocabEntries(await fs.readFile(filePath, "utf8"))
    )));

    return counts.reduce((sum, count) => sum + count, 0);
  }));

  return totals.reduce((sum, total) => sum + total, 0);
}

async function updateReadme() {
  const readmePath = path.resolve(process.env.README_PATH || "README.md");
  const sourcePath = path.resolve(process.env.PRACTICE_DAILY_PATH || DEFAULT_PRACTICE_DAILY_PATH);
  const total = await countVocabFromPracticeDaily(sourcePath);

  await writeBadgeSvg(path.resolve(VOCAB_BADGE_PATH), "Vocab", `${total} words`);

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
  console.log("Usage: PRACTICE_DAILY_PATH=<path-to-Practice-English-Daily> node scripts/update-vocab-badge.js");
} else if (require.main === module) {
  updateReadme().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  countVocabEntries,
  countVocabFromPracticeDaily,
  formatBadgeImage,
  isVocabLine,
};
