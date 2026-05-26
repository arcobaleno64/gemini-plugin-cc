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

function tryParseJsonFromText(text) {
  // Try direct parse
  try { return JSON.parse(text.trim()); } catch {}
  // Try finding last {...} block
  const match = text.match(/\{[\s\S]*\}(?=[^}]*$)/);
  if (match) {
    try { return JSON.parse(match[0]); } catch {}
  }
  return null;
}

export async function runGeminiTurn(cwd, options = {}) {
  const { prompt, effort, write = true, resumeLast = false, engine: requestedEngine, onProgress } = options;
  let { model } = options;

  onProgress?.({ message: "Detecting engine...", phase: "starting" });

  const engineInfo = detectEngine(requestedEngine ?? null);

  if (engineInfo.engine === "agy" && model) {
    process.stderr.write(`[gemini-companion] Warning: --model is not supported by AGY engine; ignoring.\n`);
    model = null;
  }

  if (!model && effort) {
    model = mapEffortToModel(effort);
  }

  model = normalizeRequestedModel(model) ?? model;

  // Gemini CLI reads from stdin to avoid shell injection on Windows (shell:true + args array)
  const useStdin = engineInfo.engine === "gemini";
  const args = buildCliArgs(engineInfo.engine, {
    prompt,
    model,
    write,
    resumeLast,
    timeoutMs: DEFAULT_SPAWN_TIMEOUT_MS,
    useStdin,
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
  const finalMessage = rawStdout.trim();
  const reasoningSummary = extractReasoningSummary(rawStderr) ?? null;
  const touchedFiles = extractTouchedFiles(finalMessage);

  onProgress?.({ message: exitCode === 0 ? "Turn completed." : "Turn failed.", phase: exitCode === 0 ? "done" : "failed" });

  return {
    status: exitCode,
    finalMessage,
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
    approvalModePlan: useJson,
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
    // Gemini --output-format json wraps response in a JSON structure
    // Try to extract the text content from it, then parse inner JSON
    const outerParsed = tryParseJsonFromText(rawStdout);
    if (outerParsed) {
      // Gemini CLI json output: may have { response: { text: "..." } } or similar
      const innerText =
        outerParsed?.response?.text ??
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
  const credFile = path.join(os.homedir(), ".gemini", "oauth_creds.json");
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
