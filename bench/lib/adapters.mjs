import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Live cell invocations. Each returns a normalized result; deterministic mode
// never calls these (it replays cassettes). Cells degrade to {ok:false} with a
// reason rather than throwing, so one unavailable tool does not sink the run.
const BENCH_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(BENCH_DIR, "..");
const GEMINI_COMPANION = path.join(REPO_ROOT, "plugins", "gemini", "scripts", "gemini-companion.mjs");
const SCHEMA = path.join(BENCH_DIR, "review-output.schema.json");
const TIMEOUT_MS = Number(process.env.BENCH_TIMEOUT_MS ?? 180_000);

// codex-companion lives in the installed codex plugin; its path is environment
// specific, so it is opt-in via env. codex.model only needs the `codex` binary.
const CODEX_COMPANION = process.env.BENCH_CODEX_COMPANION || null;

function extractJsonObject(text) {
  if (text == null) return null;
  const s = String(text);
  const start = s.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i += 1) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function normalizeReview(obj) {
  if (!obj || typeof obj !== "object") return null;
  return {
    verdict: typeof obj.verdict === "string" ? obj.verdict : null,
    summary: typeof obj.summary === "string" ? obj.summary : null,
    findings: Array.isArray(obj.findings) ? obj.findings : []
  };
}

function timed(fn) {
  const start = Date.now();
  const out = fn();
  return { ...out, latencyMs: Date.now() - start };
}

function fail(reason) {
  return { ok: false, error: reason, findings: [] };
}

function runGeminiModel(promptText) {
  return timed(() => {
    const res = spawnSync("gemini", ["-p", "--output-format", "json"], {
      input: promptText,
      encoding: "utf8",
      timeout: TIMEOUT_MS,
      shell: process.platform === "win32"
    });
    if (res.error) return fail(`gemini spawn: ${res.error.message}`);
    const envelope = extractJsonObject(res.stdout);
    // gemini wraps the model text in { response: "<text>" }; the text is our JSON.
    const review = normalizeReview(extractJsonObject(envelope?.response ?? res.stdout));
    if (!review) return fail("gemini: could not parse review JSON");
    return { ok: true, ...review, raw: res.stdout?.slice(0, 4000) };
  });
}

function runCodexModel(promptText) {
  return timed(() => {
    const outFile = path.join(os.tmpdir(), `bench-codex-${Date.now()}.json`);
    const res = spawnSync(
      "codex",
      ["exec", "--skip-git-repo-check", "--sandbox", "read-only", "--output-schema", SCHEMA, "--output-last-message", outFile, "-"],
      { input: promptText, encoding: "utf8", timeout: TIMEOUT_MS, shell: process.platform === "win32" }
    );
    if (res.error) return fail(`codex spawn: ${res.error.message}`);
    let review = null;
    if (fs.existsSync(outFile)) {
      review = normalizeReview(extractJsonObject(fs.readFileSync(outFile, "utf8")));
      try { fs.rmSync(outFile, { force: true }); } catch { /* noop */ }
    }
    if (!review) review = normalizeReview(extractJsonObject(res.stdout));
    if (!review) return fail("codex: could not parse review JSON");
    return { ok: true, ...review, raw: res.stdout?.slice(0, 4000) };
  });
}

function runCompanionReview(companionPath, repoDir, extraArgs) {
  return timed(() => {
    if (!companionPath) return fail("companion path not configured");
    const res = spawnSync(
      process.execPath,
      [companionPath, "review", "--scope", "working-tree", "--json", ...extraArgs, "--cwd", repoDir],
      { cwd: repoDir, encoding: "utf8", timeout: TIMEOUT_MS }
    );
    if (res.error) return fail(`companion spawn: ${res.error.message}`);
    const payload = extractJsonObject(res.stdout);
    const review = normalizeReview(payload?.result);
    if (!review) return fail(`companion: no result in payload (${(res.stderr || "").slice(0, 200)})`);
    return { ok: true, ...review, raw: res.stdout?.slice(0, 4000) };
  });
}

export function runCell(cell, ctx) {
  switch (cell) {
    case "gemini.model":
      return runGeminiModel(ctx.promptText);
    case "codex.model":
      return runCodexModel(ctx.promptText);
    case "gemini.deep":
      return runCompanionReview(GEMINI_COMPANION, ctx.repoDir, ["--deep"]);
    case "codex.native":
      return runCompanionReview(CODEX_COMPANION, ctx.repoDir, []);
    default:
      return fail(`unknown cell ${cell}`);
  }
}

export const _internal = { extractJsonObject, normalizeReview };
