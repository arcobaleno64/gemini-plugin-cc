import process from "node:process";
import path from "node:path";

import { createFailureError } from "./failures.mjs";
import { binaryAvailable, resolveBinaryPath } from "./process.mjs";
import { EFFORT_MODEL_MAP, MODEL_ALIASES, VALID_EFFORT_LEVELS } from "./model-map.mjs";
import { resolveAgyBrainRoot } from "./agy-transcript.mjs";

export const ENGINE_ENV = "GEMINI_ENGINE";
export const AGY_POSITIONAL_PROMPT_SAFE_LIMIT = 24_000;

const AGY_EXECUTABLE_PATH_ERROR =
  "AGY could not be resolved to an executable .exe path; the plugin refuses to spawn it via the shell to avoid argv injection on Windows. Ensure agy is on PATH or use --engine gemini.";

// Model aliases and effort tiers live in model-map.mjs (single source of truth,
// verified against the README table). Re-exported here for existing importers.
export { MODEL_ALIASES, VALID_EFFORT_LEVELS };

export function mapEffortToModel(effort) {
  if (!effort) return null;
  const e = String(effort).trim().toLowerCase();
  return EFFORT_MODEL_MAP.get(e) ?? null;
}

// Model ids ride in argv, and on Windows the gemini `.cmd` shim is spawned with
// shell:true (see process.mjs), so a metacharacter-laden value could be
// reinterpreted by cmd.exe. The prompt is already hardened via stdin; constrain
// the model id to a safe charset so it can never smuggle a shell payload into
// argv. The id must also START with an alphanumeric so a value like `--yolo`
// can never be mistaken for a CLI flag by the gemini binary's own arg parser.
// Every real Gemini model id / alias fits this pattern.
const SAFE_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function normalizeRequestedModel(model) {
  if (model == null) return null;
  const normalized = String(model).trim().toLowerCase();
  if (!normalized) return null;
  const resolved = MODEL_ALIASES.get(normalized) ?? String(model).trim();
  if (!SAFE_MODEL_ID.test(resolved)) {
    throw new Error(
      `Invalid model id "${String(model).trim()}". Model ids may contain only letters, digits, dot, underscore, and hyphen.`
    );
  }
  return resolved;
}

function resolveAgyExecutablePath({ resolveBinaryPathImpl = resolveBinaryPath } = {}) {
  const resolved = resolveBinaryPathImpl("agy", { requireExe: process.platform === "win32" });
  const isAbsolute = typeof resolved === "string" && path.isAbsolute(resolved);
  const isExecutable = process.platform !== "win32" || path.extname(resolved ?? "").toLowerCase() === ".exe";
  if (!isAbsolute || !isExecutable) {
    throw new Error(AGY_EXECUTABLE_PATH_ERROR);
  }
  return resolved;
}

export function supportsAgyStdinPrompt(version) {
  const match = String(version ?? "").trim().match(/(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?/);
  if (!match || match[4]) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  return major > 1 || (major === 1 && (minor > 1 || (minor === 1 && patch >= 2)));
}

export function detectEngine(requestedEngine = null, options = {}) {
  const envEngine = process.env[ENGINE_ENV];
  const target = requestedEngine ?? envEngine ?? "auto";
  const normalized = String(target).trim().toLowerCase();

  if (normalized !== "auto" && normalized !== "gemini" && normalized !== "agy") {
    throw new Error(`Unknown engine "${target}". Valid values: auto, gemini, agy.`);
  }

  if (normalized === "agy") {
    const binary = resolveAgyExecutablePath(options);
    const status = binaryAvailable(binary, ["--version"]);
    if (!status.available) throw new Error("AGY engine requested but agy binary is not available.");
    // AGY 1.1.2 can accept a piped prompt and return stdout, but transcript
    // recovery remains authoritative for the response, DONE status, and
    // conversation id. Fail loud when that required recovery source is absent.
    if (!resolveAgyBrainRoot()) {
      throw new Error(
        "AGY engine requested but no transcript brain dir was found. The plugin requires AGY's on-disk transcript for the completed response and conversation id, including on AGY 1.1.2's stdin prompt path. Run `agy` once interactively to initialize it, or use `--engine gemini`."
      );
    }
    return { engine: "agy", binary, version: status.detail ?? "unknown" };
  }

  if (normalized === "gemini") {
    const status = binaryAvailable("gemini", ["--version"]);
    if (!status.available) throw new Error("Gemini engine requested but gemini binary is not available.");
    return { engine: "gemini", binary: "gemini", version: status.detail ?? "unknown" };
  }

  // auto: prefer gemini because it has the plugin's JSON/model contract. AGY
  // remains a fallback even though 1.1.2 adds stdin prompt delivery; its response
  // and conversation id still depend on transcript recovery in this adapter.
  const geminiStatus = binaryAvailable("gemini", ["--version"]);
  if (geminiStatus.available) {
    return { engine: "gemini", binary: "gemini", version: geminiStatus.detail ?? "unknown" };
  }

  const agyBinary = resolveAgyExecutablePath(options);
  const agyStatus = binaryAvailable(agyBinary, ["--version"]);
  if (agyStatus.available) {
    return { engine: "agy", binary: agyBinary, version: agyStatus.detail ?? "unknown" };
  }

  throw new Error("No Gemini or AGY engine found. Install agy or gemini CLI and retry.");
}

function formatAgyTimeout(timeoutMs) {
  if (!timeoutMs || timeoutMs <= 0) return null;
  const minutes = Math.max(1, Math.ceil(timeoutMs / 60000));
  return `${minutes}m`;
}

function assertAgyPromptSafe(prompt) {
  const value = String(prompt ?? "");
  if (value.includes("\0")) {
    throw createFailureError({
      promptNul: true,
      engine: "agy",
      summary: "AGY prompt contains a NUL byte and cannot be passed as a positional argument.",
      nextStep: "Remove NUL bytes from the prompt or use `--engine gemini`, which sends prompts over stdin."
    });
  }
  if (value.length > AGY_POSITIONAL_PROMPT_SAFE_LIMIT) {
    throw createFailureError({
      promptTooLong: true,
      engine: "agy",
      summary: `AGY positional prompt is ${value.length} characters, above the ${AGY_POSITIONAL_PROMPT_SAFE_LIMIT.toLocaleString("en-US")} character safe limit.`,
      nextStep: "Shorten the prompt or use `--engine gemini`, which sends prompts over stdin."
    });
  }
}

export function buildCliArgs(engine, options = {}) {
  const { prompt = "", model, write = false, resumeLast = false, outputJson = false, approvalModePlan = false, timeoutMs, useStdin = false } = options;

  if (engine === "agy") {
    // AGY >=1.1.2 auto-enters print mode when a prompt is piped on stdin; adding
    // --print would consume the following flag as its own prompt argument. Older
    // versions retain the positional form and its Windows argv safety checks.
    const args = [];
    if (!useStdin) {
      assertAgyPromptSafe(prompt);
      args.push("--print", prompt);
    }
    if (write) args.push("--dangerously-skip-permissions");
    if (resumeLast) {
      args.push("--continue");
    } else if (write) {
      // Without an active workspace/project, agy 1.1.0 silently writes to its
      // scratch dir (~/.gemini/antigravity-cli/scratch) instead of `cwd`
      // (machine-verified 2026-07-09). --new-project binds the session's
      // workspace to `cwd`. Only on a fresh (non-continuation) write turn —
      // a resumed conversation already has its original project association.
      args.push("--new-project");
    }
    const timeout = formatAgyTimeout(timeoutMs);
    if (timeout) args.push("--print-timeout", timeout);
    return args;
  }

  // gemini — when useStdin is true the caller passes prompt via stdin; omit -p here
  const args = useStdin ? [] : ["-p", prompt];
  if (model) args.push("-m", model);
  if (write) {
    args.push("--yolo");
  } else if (approvalModePlan) {
    args.push("--approval-mode", "plan");
  }
  if (resumeLast) args.push("--resume", "latest");
  if (outputJson) args.push("--output-format", "json");
  return args;
}
