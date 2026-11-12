import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const WORKFLOW_DIR = resolve("n8n/workflows");
const EXPECTED_WORKFLOWS = [
  "01-request-notification.json",
  "02-overdue-reminders.json",
  "03-error-handler.json",
];

const SCAN_DIRS = ["n8n", "src", "convex"];
const SKIP_DIRS = new Set(["_generated", "node_modules", ".next"]);

const FORBIDDEN_PATTERNS = [
  /sk_live_[0-9a-zA-Z]{16,}/,
  /sk_test_(?!replace_me)[0-9a-zA-Z]{16,}/,
  /pk_live_[0-9a-zA-Z]{16,}/,
  /whsec_[0-9a-zA-Z+/=]{16,}/,
  /["'][0-9a-f]{64}["']/i,
];

function walkSourceFiles(dirPath: string): string[] {
  if (!existsSync(dirPath)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dirPath)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dirPath, entry);
    if (statSync(full).isDirectory()) {
      files.push(...walkSourceFiles(full));
    } else if (/\.(json|ts|tsx|js|mjs)$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

describe("Phase 6: Exported n8n Workflows & Secrets Hygiene", () => {
  it("1. parses all expected n8n/workflows/*.json files as valid JSON with error handler wiring", () => {
    const files = readdirSync(WORKFLOW_DIR).sort();
    expect(files).toEqual(EXPECTED_WORKFLOWS);

    for (const file of files) {
      const raw = readFileSync(join(WORKFLOW_DIR, file), "utf8");
      const parsed = JSON.parse(raw) as {
        id?: string;
        name?: string;
        nodes?: unknown[];
        settings?: { errorWorkflow?: string };
      };
      expect(parsed.name).toBeTruthy();
      expect(Array.isArray(parsed.nodes)).toBe(true);
      expect((parsed.nodes ?? []).length).toBeGreaterThan(0);

      if (file !== "03-error-handler.json") {
        expect(parsed.settings?.errorWorkflow).toBe("lendloop-error-handler");
      }
    }
  });

  it("2. asserts zero hardcoded secrets, API keys, or live .env.local values in n8n/, src/, convex/", () => {
    const liveSecrets: string[] = [];
    const envPath = resolve(".env.local");
    if (existsSync(envPath)) {
      for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
          continue;
        }
        const eq = trimmed.indexOf("=");
        const key = trimmed.slice(0, eq).trim();
        const val = trimmed.slice(eq + 1).trim();
        if (
          [
            "CLERK_SECRET_KEY",
            "N8N_WEBHOOK_SECRET",
            "CONVEX_AUTOMATION_SECRET",
            "N8N_ENCRYPTION_KEY",
          ].includes(key) &&
          val.length >= 16 &&
          !val.startsWith("replace_with_") &&
          !val.startsWith("replace-with-") &&
          !val.endsWith("_replace_me")
        ) {
          liveSecrets.push(val);
        }
      }
    }

    for (const dir of SCAN_DIRS) {
      for (const file of walkSourceFiles(resolve(dir))) {
        const content = readFileSync(file, "utf8");
        for (const pattern of FORBIDDEN_PATTERNS) {
          expect(
            pattern.test(content),
            `${file} matched forbidden pattern ${pattern}`
          ).toBe(false);
        }
        for (const secret of liveSecrets) {
          expect(
            content.includes(secret),
            `${file} leaked a live secret from .env.local`
          ).toBe(false);
        }
      }
    }

    expect(existsSync(resolve("LENDLOOP_MASTER_BLUEPRINT.md"))).toBe(false);
    expect(existsSync(resolve("convex/.env.local"))).toBe(false);
    const gitignore = readFileSync(resolve(".gitignore"), "utf8");
    expect(gitignore).toContain("LENDLOOP_MASTER_BLUEPRINT.md");
  });
});

