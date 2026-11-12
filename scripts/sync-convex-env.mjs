import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ENV_FILE = resolve(".env.local");
const CONVEX_BIN = resolve("node_modules/convex/bin/main.js");

const REQUIRED_CONVEX_KEYS = [
  "CLERK_JWT_ISSUER_DOMAIN",
  "N8N_WEBHOOK_SECRET",
  "CONVEX_AUTOMATION_SECRET",
  "N8N_LOAN_EVENT_WEBHOOK_URL",
  "ADMIN_BOOTSTRAP_EMAIL",
  "ALLOW_DEMO_SEED",
];

function isPlaceholder(key, val) {
  if (!val) return true;
  if (val.startsWith("replace_with_") || val.startsWith("replace-with-")) {
    return true;
  }
  if (key === "CLERK_JWT_ISSUER_DOMAIN" && val.includes("your-clerk-domain")) {
    return true;
  }
  if (key === "ADMIN_BOOTSTRAP_EMAIL" && val === "your-verified-email@example.com") {
    return true;
  }
  return false;
}

if (!existsSync(ENV_FILE)) {
  console.error("Missing .env.local. Run `npm run secrets:generate` first.");
  process.exit(1);
}

if (!existsSync(CONVEX_BIN)) {
  console.error("Missing Convex CLI binary. Run `npm install` first.");
  process.exit(1);
}

const envText = readFileSync(ENV_FILE, "utf8");
const parsed = Object.fromEntries(
  envText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const idx = line.indexOf("=");
      return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
    })
);

for (const key of REQUIRED_CONVEX_KEYS) {
  const val = parsed[key];
  if (isPlaceholder(key, val)) {
    console.warn(`[skip] ${key} is unset or placeholder in .env.local`);
    continue;
  }
  execFileSync(process.execPath, [CONVEX_BIN, "env", "set", key, val], {
    stdio: "inherit",
    env: {
      ...process.env,
      CONVEX_AGENT_MODE: process.env.CONVEX_AGENT_MODE || "anonymous",
    },
  });
  console.log(`[synced] ${key}`);
}

