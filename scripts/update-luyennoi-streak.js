#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const { writeBadgeSvg } = require("./badge-svg.js");

const API_ENDPOINT = "https://luyennoi.com/api/be/databases";
const COGNITO_ENDPOINT = "https://cognito-idp.ap-southeast-1.amazonaws.com/";
const COGNITO_CLIENT_ID = process.env.LUYENNOI_COGNITO_CLIENT_ID || "156fai2f9s0mrqu7f5tt5ghm11";
const START_TAG = "<!-- LUYENNOI_STREAK_BADGE:START -->";
const END_TAG = "<!-- LUYENNOI_STREAK_BADGE:END -->";
const BADGE_PATH = "assets/luyennoi-streak.svg";
const USER_EMAIL = process.env.LUYENNOI_USER_EMAIL;
const SK_PREFIX = process.env.LUYENNOI_SK_PREFIX || "IELTS-SP1#";
const START_DATE = process.env.LUYENNOI_STREAK_START_DATE || "2026-04-01";
const REQUEST_TIMEOUT_MS = Number(process.env.LUYENNOI_REQUEST_TIMEOUT_MS || 15000);
const MAX_PAGES = Number(process.env.LUYENNOI_MAX_PAGES || 20);

function usage() {
  return [
    "Usage: LUYENNOI_REFRESH_TOKEN=<token> LUYENNOI_USER_EMAIL=<email> node scripts/update-luyennoi-streak.js",
    "",
    "Optional environment variables:",
    "  LUYENNOI_ACCESS_TOKEN    Existing access token. Used only when paired with LUYENNOI_ID_TOKEN.",
    "  LUYENNOI_ID_TOKEN        Existing ID token. Used only when paired with LUYENNOI_ACCESS_TOKEN.",
    "  LUYENNOI_COGNITO_CLIENT_ID Defaults to Luyennoi's current public Cognito app client ID.",
    "  README_PATH              Path to README file. Defaults to README.md.",
    "  LUYENNOI_SK_PREFIX       Defaults to IELTS-SP1#.",
    "  LUYENNOI_STREAK_START_DATE Defaults to 2026-04-01.",
  ].join("\n");
}

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new Error(`Missing ${name}.`);
  }
  return value;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms: ${url}`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function refreshCognitoTokens(refreshToken) {
  const response = await fetchWithTimeout(COGNITO_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
    },
    body: JSON.stringify({
      AuthFlow: "REFRESH_TOKEN_AUTH",
      ClientId: COGNITO_CLIENT_ID,
      AuthParameters: {
        REFRESH_TOKEN: refreshToken,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Cognito refresh returned ${response.status}: ${body.slice(0, 300)}`);
  }

  const payload = await response.json();
  const result = payload?.AuthenticationResult || {};

  if (!result.AccessToken || !result.IdToken) {
    throw new Error("Cognito refresh response did not include AccessToken and IdToken.");
  }

  return {
    accessToken: result.AccessToken,
    idToken: result.IdToken,
  };
}

async function resolveAuthTokens() {
  const accessToken = String(process.env.LUYENNOI_ACCESS_TOKEN || "").trim();
  const idToken = String(process.env.LUYENNOI_ID_TOKEN || "").trim();

  if (accessToken && idToken) {
    return { accessToken, idToken };
  }

  const refreshToken = requiredEnv("LUYENNOI_REFRESH_TOKEN");
  return refreshCognitoTokens(refreshToken);
}

function startIso() {
  if (/^\d{4}-\d{2}-\d{2}$/.test(START_DATE)) {
    return `${START_DATE}T00:00:00.000Z`;
  }

  const date = new Date(START_DATE);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid LUYENNOI_STREAK_START_DATE: ${START_DATE}`);
  }

  return date.toISOString();
}

function endIso() {
  return new Date().toISOString();
}

function countActiveDays(items) {
  const activeDates = new Set(
    items
      .map((item) => item?.dateGsi || String(item?.sk || "").match(/\d{4}-\d{2}-\d{2}/)?.[0])
      .filter(Boolean),
  );

  return activeDates.size;
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

async function fetchResultsPage(accessToken, idToken, nextToken) {
  const skStart = `${SK_PREFIX}${startIso()}`;
  const skEnd = `${SK_PREFIX}${endIso()}`;
  const body = {
    name: "get-result-by-range-paginated",
    body: {
      pk: `USER#${USER_EMAIL}`,
      skStart,
      skEnd,
    },
  };

  if (nextToken) {
    body.body.nextToken = nextToken;
  }

  console.log(`Fetching Luyennoi results from ${skStart} to ${skEnd}.`);

  const response = await fetchWithTimeout(API_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "text/plain;charset=UTF-8",
      Origin: "https://luyennoi.com",
      Referer: "https://luyennoi.com/",
      "x-id-token": idToken,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Luyennoi API returned ${response.status}: ${body.slice(0, 300)}`);
  }

  return response.json();
}

async function fetchResults(accessToken, idToken) {
  const items = [];
  let nextToken;
  const seenTokens = new Set();

  do {
    if (seenTokens.size >= MAX_PAGES) {
      throw new Error(`Luyennoi pagination exceeded ${MAX_PAGES} pages.`);
    }

    if (nextToken && seenTokens.has(nextToken)) {
      throw new Error("Luyennoi pagination returned a repeated nextToken.");
    }

    if (nextToken) {
      seenTokens.add(nextToken);
    }

    const data = await fetchResultsPage(accessToken, idToken, nextToken);
    items.push(...(Array.isArray(data?.items) ? data.items : []));
    nextToken = data?.nextToken || null;
  } while (nextToken);

  return items;
}

async function updateReadme() {
  const readmePath = path.resolve(process.env.README_PATH || "README.md");

  if (!USER_EMAIL) {
    throw new Error("Missing LUYENNOI_USER_EMAIL.");
  }

  const { accessToken, idToken } = await resolveAuthTokens();
  const items = await fetchResults(accessToken, idToken);
  const streak = countActiveDays(items);

  await writeBadgeSvg(path.resolve(BADGE_PATH), "🔥 Luyennoi", `${streak} days`);

  const readme = await fs.readFile(readmePath, "utf8");
  const nextReadme = replaceTaggedSection(
    readme,
    `  <img src="${BADGE_PATH}" alt="Luyennoi Streak: ${streak} days" />`,
  );

  if (nextReadme === readme) {
    console.log("Luyennoi streak badge is already up to date.");
    return;
  }

  await fs.writeFile(readmePath, nextReadme);
  console.log(`Updated Luyennoi streak badge in ${path.relative(process.cwd(), readmePath) || readmePath}.`);
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(usage());
} else {
  updateReadme().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
