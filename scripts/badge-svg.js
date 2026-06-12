const fs = require("node:fs/promises");
const path = require("node:path");

const BADGE_HEIGHT = 20;
const BORDER_RADIUS = 4;
const FONT_SIZE = 12;
const LABEL_PADDING_X = 8;
const VALUE_PADDING_X = 8;
const LABEL_COLOR = "#2d3436";
const VALUE_COLOR = "#3C3489";
const LABEL_TEXT_COLOR = "#f1f0fe";
const VALUE_TEXT_COLOR = "#ffffff";

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function textWidth(text) {
  return Array.from(String(text)).reduce((width, character) => {
    if (/\p{Emoji}/u.test(character)) {
      return width + 15;
    }

    if (/[A-Z0-9]/.test(character)) {
      return width + 8;
    }

    if (character === " ") {
      return width + 4;
    }

    return width + 7;
  }, 0);
}

function buildBadgeSvg(label, value) {
  const labelWidth = textWidth(label) + LABEL_PADDING_X * 2;
  const valueWidth = textWidth(value) + VALUE_PADDING_X * 2;
  const width = labelWidth + valueWidth;
  const textY = 14;
  const labelTextX = labelWidth / 2;
  const valueTextX = labelWidth + valueWidth / 2;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${BADGE_HEIGHT}" viewBox="0 0 ${width} ${BADGE_HEIGHT}" role="img" aria-label="${escapeXml(`${label}: ${value}`)}">`,
    `  <title>${escapeXml(`${label}: ${value}`)}</title>`,
    `  <clipPath id="badge-radius">`,
    `    <rect width="${width}" height="${BADGE_HEIGHT}" rx="${BORDER_RADIUS}" ry="${BORDER_RADIUS}" />`,
    "  </clipPath>",
    `  <g clip-path="url(#badge-radius)">`,
    `    <rect width="${labelWidth}" height="${BADGE_HEIGHT}" fill="${LABEL_COLOR}" />`,
    `    <rect x="${labelWidth}" width="${valueWidth}" height="${BADGE_HEIGHT}" fill="${VALUE_COLOR}" />`,
    "  </g>",
    `  <g fill="none" stroke="${VALUE_COLOR}">`,
    `    <rect x="0.5" y="0.5" width="${width - 1}" height="${BADGE_HEIGHT - 1}" rx="${BORDER_RADIUS - 0.5}" ry="${BORDER_RADIUS - 0.5}" />`,
    "  </g>",
    `  <g font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="${FONT_SIZE}" font-weight="600">`,
    `    <text x="${labelTextX}" y="${textY}" text-anchor="middle" fill="${LABEL_TEXT_COLOR}">${escapeXml(label)}</text>`,
    `    <text x="${valueTextX}" y="${textY}" text-anchor="middle" fill="${VALUE_TEXT_COLOR}">${escapeXml(value)}</text>`,
    "  </g>",
    "</svg>",
    "",
  ].join("\n");
}

async function writeBadgeSvg(filePath, label, value) {
  const svg = buildBadgeSvg(label, value);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, svg);
}

module.exports = {
  buildBadgeSvg,
  writeBadgeSvg,
};
