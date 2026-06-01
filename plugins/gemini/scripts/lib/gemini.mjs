import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { buildCliArgs, detectEngine, mapEffortToModel, normalizeRequestedModel } from "./engine.mjs";
import { binaryAvailable, runCommand } from "./process.mjs";
import { resolveAgyBrainRoot, listConvDirs, recoverAgyResponse } from "./agy-transcript.mjs";

const DEFAULT_SPAWN_TIMEOUT_MS = 600_000; // 10 minutes (gemini)
// AGY's `agy --print` does not stream its response over a pipe in non-interactive
// use (verified empty stdout / hang on 1.0.3), so a 10-minute spawn would simply
// hang silently. Cap AGY far shorter so the plugin fails fast instead. This also
// feeds AGY's own `--print-timeout` via buildCliArgs.
const AGY_SPAWN_TIMEOUT_MS = 120_000; // 2 minutes
const MAX_BUFFER = 50 * 1024 * 1024; // 50 MB

function stripAnsi(str) {
  return String(str ?? "").replace(/\x1B\[[0-9;]*[mGKHF]/g, "");
}

function extractTouchedFiles(text) {
  const matches = text.match(/\b[\w./\\-]+\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|php|cs|cpp|c|h|json|yaml|yml|toml|md|sh|bash)\b/g);
  if (!matches) return [];
  return [...new Set(matches)];
}

function extractReasoningSummary(stderr) {
  const lines = stripAnsi(String(stderr ?? ""))
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return null;
  return lines.slice(-5).join("\n");
}

function stripControlChars(str) {
  // Strip C0 control chars (keep tab/newline/CR). Some gemini CLI builds emit
  // control tokens / thought markers around the JSON that break JSON.parse.
  return String(str ?? "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

function extractBalancedJsonObjects(text) {
  const objects = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}" && depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) {
        objects.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return objects;
}

export function tryParseJsonFromText(text) {
  const cleaned = stripControlChars(text);
  // 1. Direct parse of the whole payload.
  try { return JSON.parse(cleaned.trim()); } catch {}
  // 2. Some CLI versions prepend a non-JSON preamble (e.g. `update_topic{...}`)
  //    before the real object. Scan for balanced top-level {...} blocks and
  //    return the LAST one that parses.
  const candidates = extractBalancedJsonObjects(cleaned);
  for (let i = candidates.length - 1; i >= 0; i--) {
    try { return JSON.parse(candidates[i]); } catch {}
  }
  return null;
}

export async function runGeminiTurn(cwd, options = {}) {
  const { prompt, effort, write = true, resumeLast = false, engine: requestedEngine, onProgress } = options;
  let { model } = options;

  onProgress?.({ message: "Detecting engine...", phase: "starting" });

  const engineInfo = detectEngine(requestedEngine ?? null);

  if (engineInfo.engine === "agy") {
    // `agy --print` is hardcoded to Gemini 3.5 Flash (High) and exposes no
    // --model/--effort flag (env / settings.json cannot override it), so both are
    // ignored here. Other/higher tiers are only reachable via the gemini engine.
    if (model || effort) {
      process.stderr.write(`[gemini-companion] Note: AGY's --print is locked to Gemini 3.5 Flash (High) and has no model/effort flag; ignoring --model/--effort. Use --engine gemini for other models.\n`);
    }
    model = null;
  } else {
    if (!model && effort) {
      model = mapEffortToModel(effort);
    }
    model = normalizeRequestedModel(model) ?? model;
  }

  // Gemini CLI reads from stdin to avoid shell injection on Windows (shell:true + args array)
  const useStdin = engineInfo.engine === "gemini";
  const useJson = engineInfo.engine === "gemini";
  const spawnTimeoutMs = engineInfo.engine === "agy" ? AGY_SPAWN_TIMEOUT_MS : DEFAULT_SPAWN_TIMEOUT_MS;

  // agy only (#27466): the response never reaches stdout — we recover it from the
  // transcript agy writes on disk. Snapshot the conversation dirs BEFORE the spawn
  // so we can identify the new one afterwards (agy does not surface the conversation
  // id on stdout — antigravity-cli#7). TODO-3 timeout grace: give agy's own
  // --print-timeout a shorter window than the hard spawn kill so agy self-terminates
  // and flushes a final status="DONE" transcript row before spawnSync SIGKILLs it.
  let agyBrainRoot = null;
  let agyBefore = null;
  let agyPrintTimeoutMs = spawnTimeoutMs;
  if (engineInfo.engine === "agy") {
    agyBrainRoot = resolveAgyBrainRoot();
    agyBefore = listConvDirs(agyBrainRoot);
    agyPrintTimeoutMs = Math.max(30_000, AGY_SPAWN_TIMEOUT_MS - 15_000);
  }

  const args = buildCliArgs(engineInfo.engine, {
    prompt,
    model,
    write,
    resumeLast,
    timeoutMs: engineInfo.engine === "agy" ? agyPrintTimeoutMs : spawnTimeoutMs,
    useStdin,
    outputJson: useJson,
  });

  onProgress?.({ message: `Starting ${engineInfo.engine} turn...`, phase: "running" });

  const result = runCommand(engineInfo.binary, args, {
    cwd,
    input: useStdin ? prompt : undefined,
    maxBuffer: MAX_BUFFER,
    timeout: spawnTimeoutMs, // hard kill — grace-later than agy's --print-timeout
  });

  const rawStdout = stripAnsi(result.stdout ?? "");
  const rawStderr = stripAnsi(result.stderr ?? "");
  let exitCode = result.status ?? (result.error ? 1 : 0);

  let finalMessage = rawStdout.trim();
  let threadId = null;
  let reasoningSummary = extractReasoningSummary(rawStderr) ?? null;

  if (engineInfo.engine === "agy") {
    // agy wrote the response to its transcript, not stdout (#27466). Recover it
    // by diffing the conversation dirs captured before/after the spawn.
    const rec = recoverAgyResponse(agyBrainRoot, agyBefore);
    if (!rec.response) {
      throw new Error(
        `AGY produced no recoverable response (${rec.reason}). agy --print does not pipe output (google-gemini/gemini-cli#27466); transcript recovery failed.`
      );
    }
    if (!rec.confident) {
      process.stderr.write(`[gemini-companion] Warning: AGY transcript match is not certain (${rec.reason}). Verify the response corresponds to this run.\n`);
    }
    finalMessage = String(rec.response).trim();
    threadId = rec.convDir ?? null; // agy conversation id — resume via --conversation <id>
    reasoningSummary = rec.thinking ?? reasoningSummary;
    // Success is defined by a completed transcript row, not the (often killed)
    // exit code: agy frequently hangs until --print-timeout even on success.
    if (rec.done) exitCode = 0;
    else if (exitCode === 0) exitCode = 1; // recovered but truncated → signal partial
  } else if (useJson) {
    // For gemini engine with JSON output, extract response text and session_id
    const outer = tryParseJsonFromText(rawStdout);
    if (outer) {
      threadId = typeof outer.session_id === "string" ? outer.session_id : null;
      const responseText = (typeof outer.response === "string" ? outer.response : outer?.response?.text) ?? rawStdout;
      finalMessage = responseText.trim();
    }
  }

  const touchedFiles = extractTouchedFiles(finalMessage);

  onProgress?.({ message: exitCode === 0 ? "Turn completed." : "Turn failed.", phase: exitCode === 0 ? "done" : "failed" });

  return {
    status: exitCode,
    finalMessage,
    threadId,
    reasoningSummary,
    touchedFiles,
    engine: engineInfo.engine,
    stderr: rawStderr,
  };
}

export async function runGeminiReview(cwd, options = {}) {
  const { prompt, model: requestedModel, engine: requestedEngine, onProgress } = options;

  onProgress?.({ message: "Starting adversarial review...", phase: "reviewing" });

  // prefer gemini for JSON output, unless forced to agy
  let engineInfo;
  let useJson = false;
  try {
    engineInfo = detectEngine(requestedEngine ?? "gemini");
    useJson = engineInfo.engine === "gemini";
  } catch {
    engineInfo = detectEngine(requestedEngine ?? null);
    useJson = false;
  }

  const model = normalizeRequestedModel(requestedModel) ?? (engineInfo.engine === "gemini" ? "gemini-2.5-flash" : null);

  const useStdin = engineInfo.engine === "gemini";
  const spawnTimeoutMs = engineInfo.engine === "agy" ? AGY_SPAWN_TIMEOUT_MS : DEFAULT_SPAWN_TIMEOUT_MS;

  // agy only (#27466): recover the review from the transcript, not stdout (see
  // runGeminiTurn for the rationale). Snapshot the conversation dirs before the
  // spawn, and give agy's --print-timeout a grace window shorter than the hard
  // spawn kill so it flushes a final status="DONE" row before SIGKILL.
  let agyBrainRoot = null;
  let agyBefore = null;
  let agyPrintTimeoutMs = spawnTimeoutMs;
  if (engineInfo.engine === "agy") {
    agyBrainRoot = resolveAgyBrainRoot();
    agyBefore = listConvDirs(agyBrainRoot);
    agyPrintTimeoutMs = Math.max(30_000, AGY_SPAWN_TIMEOUT_MS - 15_000);
  }

  const args = buildCliArgs(engineInfo.engine, {
    prompt,
    model,
    write: false,
    outputJson: useJson,
    // approvalModePlan requires TTY input and conflicts with stdin prompt delivery
    approvalModePlan: false,
    timeoutMs: engineInfo.engine === "agy" ? agyPrintTimeoutMs : spawnTimeoutMs,
    useStdin,
  });

  const result = runCommand(engineInfo.binary, args, {
    cwd,
    input: useStdin ? prompt : undefined,
    maxBuffer: MAX_BUFFER,
    timeout: spawnTimeoutMs, // hard kill — grace-later than agy's --print-timeout
  });

  const rawStdout = stripAnsi(result.stdout ?? "");
  const rawStderr = stripAnsi(result.stderr ?? "");
  let exitCode = result.status ?? (result.error ? 1 : 0);
  let reasoningSummary = extractReasoningSummary(rawStderr) ?? null;

  let reviewJson = null;
  let reviewText = rawStdout.trim();

  if (engineInfo.engine === "agy") {
    // agy wrote the review to its transcript, not stdout (#27466). Recover it and
    // parse the JSON findings out of the recovered text.
    const rec = recoverAgyResponse(agyBrainRoot, agyBefore);
    if (!rec.response) {
      throw new Error(
        `AGY produced no recoverable review (${rec.reason}). agy --print does not pipe output (google-gemini/gemini-cli#27466); transcript recovery failed.`
      );
    }
    if (!rec.confident) {
      process.stderr.write(`[gemini-companion] Warning: AGY transcript match is not certain (${rec.reason}). Verify the review corresponds to this run.\n`);
    }
    reviewText = String(rec.response).trim();
    reviewJson = tryParseJsonFromText(reviewText);
    reasoningSummary = rec.thinking ?? reasoningSummary;
    if (rec.done) exitCode = 0;
    else if (exitCode === 0) exitCode = 1; // recovered but truncated → signal partial
  } else if (useJson) {
    // Gemini --output-format json wraps the response in an outer JSON envelope.
    // The text payload lives at different paths depending on CLI version:
    //   { response: "text..." }          — string (common with stdin delivery)
    //   { response: { text: "..." } }    — nested object (older format)
    //   { candidates[0].content... }     — raw API shape
    const outerParsed = tryParseJsonFromText(rawStdout);
    if (outerParsed) {
      const innerText =
        outerParsed?.response?.text ??
        (typeof outerParsed?.response === "string" ? outerParsed.response : null) ??
        outerParsed?.candidates?.[0]?.content?.parts?.[0]?.text ??
        outerParsed?.text ??
        rawStdout;
      reviewText = typeof innerText === "string" ? innerText.trim() : rawStdout;
      reviewJson = tryParseJsonFromText(reviewText);
    } else {
      reviewJson = tryParseJsonFromText(rawStdout);
    }
  } else {
    reviewJson = tryParseJsonFromText(rawStdout);
  }

  onProgress?.({ message: exitCode === 0 ? "Review completed." : "Review failed.", phase: exitCode === 0 ? "done" : "failed" });

  return {
    status: exitCode,
    reviewText,
    reviewJson,
    reasoningSummary,
    engine: engineInfo.engine,
    stderr: rawStderr,
  };
}

export function getGeminiAvailability() {
  return binaryAvailable("gemini", ["--version"]);
}

export function getAgyAvailability() {
  return binaryAvailable("agy", ["--version"]);
}

export function getGeminiLoginStatus() {
  const geminiHome = process.env.GEMINI_HOME ?? path.join(os.homedir(), ".gemini");
  const credFile = path.join(geminiHome, "oauth_creds.json");
  if (!fs.existsSync(credFile)) {
    return { loggedIn: false, detail: `No credentials at ${credFile}. Run \`gemini\` to authenticate.` };
  }
  try {
    const creds = JSON.parse(fs.readFileSync(credFile, "utf8"));
    const expiry = creds?.expiry_date ?? creds?.expiry ?? creds?.token?.expiry_date;
    if (expiry && Date.now() > Number(expiry)) {
      return { loggedIn: false, detail: `OAuth token expired at ${new Date(Number(expiry)).toISOString()}. Run \`gemini\` to re-authenticate.` };
    }
  } catch {
    return { loggedIn: false, detail: `Cannot read credentials at ${credFile}. Run \`gemini\` to authenticate.` };
  }
  return { loggedIn: true, detail: `OAuth credentials found at ${credFile}` };
}

// Personal (free) Gemini plans lose CLI access on 2026-06-18; Gemini Code Assist
// Standard/Enterprise do not. The selected auth type is recorded in
// ~/.gemini/settings.json as security.auth.selectedType (e.g. "oauth-personal").
export function getGeminiPlanTier() {
  const geminiHome = process.env.GEMINI_HOME ?? path.join(os.homedir(), ".gemini");
  const settingsFile = path.join(geminiHome, "settings.json");
  try {
    const settings = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
    const selectedType = settings?.security?.auth?.selectedType ?? null;
    if (typeof selectedType === "string") {
      return { tier: /personal/i.test(selectedType) ? "personal" : "other", selectedType };
    }
  } catch {
    // no settings.json / unreadable — tier unknown
  }
  return { tier: "unknown", selectedType: null };
}

export function getAgyLoginStatus() {
  const status = binaryAvailable("agy", ["--version"]);
  if (!status.available) {
    return { loggedIn: false, detail: "AGY binary not found." };
  }
  // AGY (Antigravity) stores no credential of its own — verified: no oauth/token
  // file exists under any ~/.antigravity* or ~/.gemini/antigravity-cli dir; it
  // runs off the SAME Google OAuth as the gemini CLI (~/.gemini/oauth_creds.json,
  // with per-machine state under ~/.gemini/antigravity-cli/). So gauge agy auth
  // from that shared credential — the only signal available without an
  // interactive run.
  const shared = getGeminiLoginStatus();
  const pipeNote = "Note: agy --print does not return output over a pipe (#27466); the plugin recovers responses from the transcript.";
  if (shared.loggedIn) {
    return { loggedIn: true, detail: `AGY ${status.detail ?? ""} present; shared Google OAuth valid. ${pipeNote}`.trim() };
  }
  return {
    loggedIn: false,
    detail: `AGY ${status.detail ?? ""} present, but the shared Google OAuth is missing/expired (${shared.detail}). Run \`gemini\` once to authenticate. ${pipeNote}`.trim(),
  };
}

export function getSessionRuntimeStatus() {
  // Unlike the Codex app-server (a shared persistent runtime), the Gemini plugin
  // invokes the CLI directly per command, so the runtime label describes which
  // engine the next command would use rather than a shared session endpoint.
  const gemini = getGeminiAvailability();
  const agy = getAgyAvailability();
  const available = gemini.available || agy.available;
  const label = gemini.available
    ? "gemini CLI (per-command)"
    : agy.available
      ? "agy fallback (per-command)"
      : "no engine available";
  return { mode: "direct", gemini, agy, available, label };
}
