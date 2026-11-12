import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const EXAMPLE_PATH = resolve(".env.example");
const ENV_LOCAL_PATH = resolve(".env.local");

const SECRET_KEYS = new Set([
  "N8N_WEBHOOK_SECRET",
  "CONVEX_AUTOMATION_SECRET",
  "N8N_ENCRYPTION_KEY",
]);

function isPlaceholder(value) {
  if (!value) return true;
  const trimmed = value.trim();
  return (
    trimmed.length === 0 ||
    trimmed.startsWith("replace_with_") ||
    trimmed.startsWith("replace-with-") ||
    trimmed.endsWith("_replace_me")
  );
}

function parseEnvEntries(content) {
  const entries = new Map();
  for (const rawLine of content.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (key) entries.set(key, value);
  }
  return entries;
}

if (!existsSync(EXAMPLE_PATH)) {
  console.error("Missing .env.example in project root.");
  process.exit(1);
}

const templateText = readFileSync(EXAMPLE_PATH, "utf8");
const existingEntries = existsSync(ENV_LOCAL_PATH)
  ? parseEnvEntries(readFileSync(ENV_LOCAL_PATH, "utf8"))
  : new Map();

const renderedKeys = new Set();
const outputLines = [];

for (const rawLine of templateText.split(/\r?\n/)) {
  const trimmed = rawLine.trim();
  if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
    outputLines.push(rawLine);
    continue;
  }

  const eqIndex = trimmed.indexOf("=");
  const key = trimmed.slice(0, eqIndex).trim();
  const templateVal = trimmed.slice(eqIndex + 1).trim();
  renderedKeys.add(key);

  const existingVal = existingEntries.get(key);
  let finalVal = existingVal !== undefined ? existingVal : templateVal;

  if (SECRET_KEYS.has(key) && isPlaceholder(finalVal)) {
    finalVal = randomBytes(32).toString("hex");
    console.log(`[generated] ${key} (32-byte hex secret written to .env.local)`);
  } else if (existingVal !== undefined && !isPlaceholder(existingVal)) {
    console.log(`[kept] ${key}`);
  }

  outputLines.push(`${key}=${finalVal}`);
}

const extraLines = [];
for (const [key, value] of existingEntries.entries()) {
  if (!renderedKeys.has(key)) {
    extraLines.push(`${key}=${value}`);
  }
}

if (extraLines.length > 0) {
  outputLines.push("", "# Local CLI state preserved", ...extraLines);
}

writeFileSync(ENV_LOCAL_PATH, `${outputLines.join("\n").replace(/\n+$/, "")}\n`, "utf8");
console.log("Updated .env.local safely without overwriting existing non-placeholder values.");

