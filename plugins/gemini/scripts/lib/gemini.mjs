import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { buildCliArgs, detectEngine, mapEffortToModel, normalizeRequestedModel } from "./engine.mjs";
import { binaryAvailable, runCommand } from "./process.mjs";

const DEFAULT_SPAWN_TIMEOUT_MS = 600_000; // 10 minutes
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
    // AGY selects its model and effort tier interactively; its non-interactive
    // CLI exposes no --model/effort flag, so both are ignored here.
    if (model || effort) {
      process.stderr.write(`[gemini-companion] Note: AGY chooses its model and effort interactively; ignoring --model/--effort for the AGY engine.\n`);
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
  const args = buildCliArgs(engineInfo.engine, {
    prompt,
    model,
    write,
    resumeLast,
    timeoutMs: DEFAULT_SPAWN_TIMEOUT_MS,
    useStdin,
    outputJson: useJson,
  });

  onProgress?.({ message: `Starting ${engineInfo.engine} turn...`, phase: "running" });

  const result = runCommand(engineInfo.binary, args, {
    cwd,
    input: useStdin ? prompt : undefined,
    maxBuffer: MAX_BUFFER,
    timeout: DEFAULT_SPAWN_TIMEOUT_MS,
  });

  const rawStdout = stripAnsi(result.stdout ?? "");
  const rawStderr = stripAnsi(result.stderr ?? "");
  const exitCode = result.status ?? (result.error ? 1 : 0);

  // For gemini engine with JSON output, extract response text and session_id
  let finalMessage = rawStdout.trim();
  let threadId = null;
  if (useJson) {
    const outer = tryParseJsonFromText(rawStdout);
    if (outer) {
      threadId = typeof outer.session_id === "string" ? outer.session_id : null;
      const responseText = (typeof outer.response === "string" ? outer.response : outer?.response?.text) ?? rawStdout;
      finalMessage = responseText.trim();
    }
  }

  const reasoningSummary = extractReasoningSummary(rawStderr) ?? null;
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
  const args = buildCliArgs(engineInfo.engine, {
    prompt,
    model,
    write: false,
    outputJson: useJson,
    // approvalModePlan requires TTY input and conflicts with stdin prompt delivery
    approvalModePlan: false,
    useStdin,
  });

  const result = runCommand(engineInfo.binary, args, {
    cwd,
    input: useStdin ? prompt : undefined,
    maxBuffer: MAX_BUFFER,
    timeout: DEFAULT_SPAWN_TIMEOUT_MS,
  });

  const rawStdout = stripAnsi(result.stdout ?? "");
  const rawStderr = stripAnsi(result.stderr ?? "");
  const exitCode = result.status ?? (result.error ? 1 : 0);
  const reasoningSummary = extractReasoningSummary(rawStderr) ?? null;

  let reviewJson = null;
  let reviewText = rawStdout.trim();

  if (useJson) {
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

export function getAgyLoginStatus() {
  const status = binaryAvailable("agy", ["--version"]);
  return {
    loggedIn: status.available,
    detail: status.available ? `AGY ${status.version ?? ""} available (system-level auth).` : "AGY binary not found.",
  };
}

export function getSessionRuntimeStatus() {
  const gemini = getGeminiAvailability();
  const agy = getAgyAvailability();
  return { gemini, agy, available: gemini.available || agy.available };
}
