import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const SCAN_DIRS = ["n8n", "src", "convex", "scripts", "tests"];
const SKIP_DIRS = new Set([
  "_generated",
  "node_modules",
  ".next",
  "playwright-report",
  "test-results",
]);

const FORBIDDEN_PATTERNS = [
  {
    name: "Live Clerk secret key",
    regex: /sk_live_[0-9a-zA-Z]{16,}/,
  },
  {
    name: "Test Clerk secret key",
    regex: /sk_test_(?!replace_me)[0-9a-zA-Z]{16,}/,
  },
  {
    name: "Live Clerk publishable key",
    regex: /pk_live_[0-9a-zA-Z]{16,}/,
  },
  {
    name: "Webhook signing secret literal",
    regex: /whsec_[0-9a-zA-Z+/=]{16,}/,
  },
  {
    name: "Hardcoded 64-char hex secret literal",
    regex: /["'][0-9a-f]{64}["']/i,
  },
];

function walk(dir) {
  if (!existsSync(dir)) return [];
  const results = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      results.push(...walk(full));
    } else if (/\.(json|ts|tsx|js|mjs|cjs)$/.test(entry)) {
      results.push(full);
    }
  }
  return results;
}

function loadLiveSecrets() {
  const envPath = resolve(".env.local");
  if (!existsSync(envPath)) return [];
  const secretKeys = new Set([
    "CLERK_SECRET_KEY",
    "N8N_WEBHOOK_SECRET",
    "CONVEX_AUTOMATION_SECRET",
    "N8N_ENCRYPTION_KEY",
  ]);
  const liveValues = [];
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const idx = trimmed.indexOf("=");
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    if (
      secretKeys.has(key) &&
      val.length >= 16 &&
      !val.startsWith("replace_with_") &&
      !val.startsWith("replace-with-") &&
      !val.endsWith("_replace_me")
    ) {
      liveValues.push({ key, val });
    }
  }
  return liveValues;
}

let violations = 0;
const liveSecrets = loadLiveSecrets();

const FORBIDDEN_WORKSPACE_FILES = [
  "convex/.env.local",
  "LENDLOOP_MASTER_BLUEPRINT.md",
];

for (const relPath of FORBIDDEN_WORKSPACE_FILES) {
  if (existsSync(resolve(relPath))) {
    console.error(
      `[HYGIENE VIOLATION] Forbidden internal/secret file exists in repo root: ${relPath}`
    );
    violations += 1;
  }
}

for (const dir of SCAN_DIRS) {
  for (const file of walk(dir)) {
    const content = readFileSync(file, "utf8");

    if (file.endsWith(".json") && file.includes("n8n")) {
      try {
        JSON.parse(content);
      } catch (err) {
        console.error(`[INVALID JSON] ${file}: ${err.message}`);
        violations += 1;
      }
    }

    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.regex.test(content)) {
        console.error(`[SECRET LEAK DETECTED] ${file} matched ${pattern.name}`);
        violations += 1;
      }
    }

    for (const { key, val } of liveSecrets) {
      if (content.includes(val)) {
        console.error(`[SECRET LEAK DETECTED] ${file} contains live ${key} from .env.local`);
        violations += 1;
      }
    }
  }
}

if (violations > 0) {
  process.exit(1);
}

console.log(
  "Secret hygiene check passed: 0 leaked secrets in n8n/, src/, convex/, scripts/, tests/."
);

