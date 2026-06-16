#!/usr/bin/env node

const fs = require("node:fs/promises");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const START_TAG = "<!-- DAILY_READING:START -->";
const END_TAG = "<!-- DAILY_READING:END -->";
const DEFAULT_DATA_PATH = "assets/daily-reading.json";
const DEFAULT_LIMIT = 3;
const TABLE_SEPARATOR_WIDTH = 100;
const TIME_ZONE = process.env.DAILY_READING_TIME_ZONE || "Asia/Ho_Chi_Minh";

function usage() {
  return [
    "Usage: node scripts/update-daily-reading.js",
    "",
    "Optional environment variables:",
    "  README_PATH            Path to README file. Defaults to README.md.",
    "  DAILY_READING_PATH     Path to JSON data, a markdown file, or a markdown directory.",
    "  DAILY_READING_FILE     Markdown filename to use when DAILY_READING_PATH is a directory.",
    "  DAILY_READING_LIMIT    Number of rows to render. Defaults to 3.",
    "  DAILY_READING_TIME_ZONE Time zone for git commit dates. Defaults to Asia/Ho_Chi_Minh.",
  ].join("\n");
}

function fitEnd(value, width) {
  return (String(value) + " ".repeat(width)).slice(0, width);
}

function fitStart(value, width) {
  return (" ".repeat(width) + String(value)).slice(-width);
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

function dateFromTimestamp(timestamp) {
  const date = new Date(Number(timestamp) * 1000);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${values.year}-${values.month}-${values.day}`;
}

function rowLimit() {
  const limit = Number(process.env.DAILY_READING_LIMIT || DEFAULT_LIMIT);
  return Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_LIMIT;
}

function normalizeEntry(entry = {}) {
  const article = String(entry.article ?? entry.title ?? entry.name ?? "-");

  return {
    date: formatDate(entry.date ?? entry.created_date ?? entry.created_at),
    article,
    topic: String(entry.topic ?? entry.category ?? entry.type ?? "General"),
    vocab: Number(entry.vocab ?? entry.vocab_count ?? entry.words ?? 0),
  };
}

function normalizeEntries(data) {
  const entries = Array.isArray(data) ? data : data?.items ?? [data];
  return entries.slice(0, rowLimit()).map(normalizeEntry);
}

function titleFromMarkdownPath(filePath) {
  return path.basename(filePath, path.extname(filePath));
}

function countVocabEntries(markdown) {
  const content = markdown.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*/, "");

  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !/^(date|topic)\s*:/i.test(line) && /[:=]/.test(line))
    .length;
}

function stripYamlQuotes(value) {
  return String(value || "").trim().replace(/^['"]|['"]$/g, "");
}

function metadataValue(markdown, key) {
  const keyPattern = new RegExp(`^\\s*${key}\\s*:`, "i");
  const keyReplace = new RegExp(`^\\s*${key}\\s*:\\s*`, "i");
  const frontmatter = markdown.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);

  if (frontmatter) {
    const metadataLine = frontmatter[1]
      .split(/\r?\n/)
      .find((line) => keyPattern.test(line));

    if (metadataLine) {
      return stripYamlQuotes(metadataLine.replace(keyReplace, ""));
    }
  }

  const inlineMetadata = markdown
    .split(/\r?\n/)
    .find((line) => keyPattern.test(line));

  return inlineMetadata ? stripYamlQuotes(inlineMetadata.replace(keyReplace, "")) : "";
}

function metadataFromMarkdown(markdown) {
  return {
    date: metadataValue(markdown, "date"),
    topic: metadataValue(markdown, "topic") || "General",
  };
}

async function listMarkdownFiles(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listMarkdownFiles(entryPath));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(entryPath);
    }
  }

  return files;
}

function gitCommitInfo(filePath, cwd) {
  try {
    const relativePath = path.relative(cwd, filePath);
    const output = execFileSync("git", ["-C", cwd, "log", "-1", "--format=%ct", "--", relativePath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const timestamp = Number(output) || 0;

    return {
      date: dateFromTimestamp(timestamp),
      timestamp,
    };
  } catch {
    return {
      date: "",
      timestamp: 0,
    };
  }
}

function gitCommitCount(filePath, cwd = process.cwd()) {
  try {
    const relativePath = path.relative(cwd, filePath);
    const output = execFileSync("git", ["-C", cwd, "rev-list", "--count", "HEAD", "--", relativePath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    return Number(output) || 0;
  } catch {
    return 0;
  }
}

async function chooseMarkdownFile(sourcePath, requestedFileName = process.env.DAILY_READING_FILE) {
  const stat = await fs.stat(sourcePath);
  if (stat.isFile()) {
    return sourcePath;
  }

  const files = await listMarkdownFiles(sourcePath);
  if (files.length === 0) {
    throw new Error(`No markdown files found in ${sourcePath}.`);
  }

  if (requestedFileName) {
    const requested = files.find((file) => path.basename(file) === requestedFileName);
    if (!requested) {
      throw new Error(`Could not find ${requestedFileName} in ${sourcePath}.`);
    }

    return requested;
  }

  const ranked = await Promise.all(files.map(async (file) => {
    const stat = await fs.stat(file);
    const commit = gitCommitInfo(file, sourcePath);
    return {
      file,
      timestamp: commit.timestamp || Math.floor(stat.mtimeMs / 1000),
    };
  }));

  ranked.sort((left, right) => right.timestamp - left.timestamp || left.file.localeCompare(right.file));
  return ranked[0].file;
}

async function markdownEntry(markdownPath, sourceRoot) {
  const markdown = await fs.readFile(markdownPath, "utf8");
  const stat = await fs.stat(markdownPath);
  const commit = gitCommitInfo(markdownPath, sourceRoot);
  const metadata = metadataFromMarkdown(markdown);

  return {
    date: commit.date || metadata.date || new Date(stat.mtimeMs).toISOString().slice(0, 10),
    article: titleFromMarkdownPath(markdownPath),
    topic: metadata.topic,
    vocab: countVocabEntries(markdown),
  };
}

async function loadDailyLearningData(sourcePath, fileName = process.env.DAILY_READING_FILE) {
  const stat = await fs.stat(sourcePath);

  if (stat.isFile() && sourcePath.toLowerCase().endsWith(".json")) {
    return JSON.parse(await fs.readFile(sourcePath, "utf8"));
  }

  if (stat.isFile()) {
    return [await markdownEntry(sourcePath, path.dirname(sourcePath))];
  }

  if (fileName) {
    return [await markdownEntry(await chooseMarkdownFile(sourcePath, fileName), sourcePath)];
  }

  const files = await listMarkdownFiles(sourcePath);
  const ranked = await Promise.all(files.map(async (file) => {
    const stat = await fs.stat(file);
    const commit = gitCommitInfo(file, sourcePath);
    return {
      file,
      timestamp: commit.timestamp || Math.floor(stat.mtimeMs / 1000),
    };
  }));

  ranked.sort((left, right) => right.timestamp - left.timestamp || left.file.localeCompare(right.file));

  return Promise.all(
    ranked
      .slice(0, rowLimit())
      .map(({ file }) => markdownEntry(file, sourcePath)),
  );
}

function formatHeading(heading, streakDays) {
  const days = Number(streakDays);

  if (!Number.isFinite(days) || days <= 0) {
    return heading;
  }

  const roundedDays = Math.floor(days);
  return `${heading}  ${roundedDays} ${roundedDays === 1 ? "day" : "days"} 🔥`;
}

function formatDailyLearning(data, heading = "📰 Daily Reading", titleHeader = "Article", streakDays = 0) {
  const entries = normalizeEntries(data);
  const widths = {
    date: 9,
    topic: 13,
    article: 52,
    vocab: 10,
  };

  const header = [
    fitEnd("Date", widths.date),
    fitEnd("Topic", widths.topic),
    fitEnd(titleHeader, widths.article),
    fitStart("New Vocab", widths.vocab),
  ].join("  ");

  const rows = entries.flatMap((entry, index) => {
    const row = [
      fitEnd(entry.date, widths.date),
      fitEnd(entry.topic, widths.topic),
      fitEnd(entry.article, widths.article),
      fitStart(`${entry.vocab} ${entry.vocab === 1 ? "word" : "words"}`, widths.vocab),
    ].join("  ");

    return index > 0 ? ["", row] : [row];
  });

  return [
    "```text",
    formatHeading(heading, streakDays),
    "",
    header,
    "─".repeat(Math.max(TABLE_SEPARATOR_WIDTH, header.length)),
    ...rows,
    "```",
  ].join("\n");
}

function formatDailyReading(data, streakDays = 0) {
  return formatDailyLearning(data, "📰 Daily Reading", "Article", streakDays);
}

function replaceTaggedSection(readme, content, startTag = START_TAG, endTag = END_TAG) {
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

async function updateReadme() {
  const readmePath = path.resolve(process.env.README_PATH || "README.md");
  const dataPath = path.resolve(process.env.DAILY_READING_PATH || DEFAULT_DATA_PATH);
  const data = await loadDailyLearningData(dataPath);
  const readme = await fs.readFile(readmePath, "utf8");
  const nextReadme = replaceTaggedSection(readme, formatDailyReading(data, gitCommitCount(dataPath)));

  if (nextReadme === readme) {
    console.log("Daily Reading is already up to date.");
    return;
  }

  await fs.writeFile(readmePath, nextReadme);
  console.log(`Updated Daily Reading in ${path.relative(process.cwd(), readmePath) || readmePath}.`);
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
  gitCommitCount,
  formatDailyLearning,
  formatDailyReading,
  formatDate,
  loadDailyLearningData,
  normalizeEntry,
  normalizeEntries,
  replaceTaggedSection,
};
