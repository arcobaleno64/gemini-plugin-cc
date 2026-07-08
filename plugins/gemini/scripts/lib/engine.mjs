import process from "node:process";

import { createFailureError } from "./failures.mjs";
import { binaryAvailable, resolveBinaryPath } from "./process.mjs";
import { EFFORT_MODEL_MAP, MODEL_ALIASES, VALID_EFFORT_LEVELS } from "./model-map.mjs";
import { resolveAgyBrainRoot } from "./agy-transcript.mjs";

export const ENGINE_ENV = "GEMINI_ENGINE";
export const AGY_POSITIONAL_PROMPT_SAFE_LIMIT = 24_000;

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

export function detectEngine(requestedEngine = null) {
  const envEngine = process.env[ENGINE_ENV];
  const target = requestedEngine ?? envEngine ?? "auto";
  const normalized = String(target).trim().toLowerCase();

  if (normalized !== "auto" && normalized !== "gemini" && normalized !== "agy") {
    throw new Error(`Unknown engine "${target}". Valid values: auto, gemini, agy.`);
  }

  if (normalized === "agy") {
    const status = binaryAvailable("agy", ["--version"]);
    if (!status.available) throw new Error("AGY engine requested but agy binary is not available.");
    // `agy --print` does not emit its response over a pipe in non-TTY use
    // (upstream bug google-gemini/gemini-cli#27466); the plugin recovers the
    // response from agy's on-disk transcript instead (see agy-transcript.mjs and
    // runGeminiTurn). If no transcript brain dir exists on this platform there is
    // nothing to recover from, so fail loud rather than spawn empty-handed.
    if (!resolveAgyBrainRoot()) {
      throw new Error(
        "AGY engine requested but `agy --print` cannot return output over a pipe (upstream bug google-gemini/gemini-cli#27466) and no transcript brain dir was found to recover from on this platform. Run `agy` once interactively to initialize it, or use `--engine gemini`."
      );
    }
    return { engine: "agy", binary: resolveBinaryPath("agy") ?? "agy", version: status.detail ?? "unknown" };
  }

  if (normalized === "gemini") {
    const status = binaryAvailable("gemini", ["--version"]);
    if (!status.available) throw new Error("Gemini engine requested but gemini binary is not available.");
    return { engine: "gemini", binary: "gemini", version: status.detail ?? "unknown" };
  }

  // auto: prefer gemini. AGY exposes a `--print` flag, but its response does not
  // come through a pipe in non-interactive (non-TTY) use — local verification on
  // agy 1.0.3 (2026-06) had `agy --print` return empty stdout or hang to its
  // print-timeout under the exact piped spawn this plugin uses, while
  // `gemini -p --output-format json` piped a clean JSON envelope every time.
  // gemini is therefore the only engine reliable for this spawn model; AGY stays
  // a last resort when gemini is entirely absent.
  const geminiStatus = binaryAvailable("gemini", ["--version"]);
  if (geminiStatus.available) {
    return { engine: "gemini", binary: "gemini", version: geminiStatus.detail ?? "unknown" };
  }

  const agyStatus = binaryAvailable("agy", ["--version"]);
  if (agyStatus.available) {
    return { engine: "agy", binary: resolveBinaryPath("agy") ?? "agy", version: agyStatus.detail ?? "unknown" };
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
    // AGY does not support stdin; prompt must be passed as a positional argument
    assertAgyPromptSafe(prompt);
    const args = ["--print", prompt];
    if (write) args.push("--dangerously-skip-permissions");
    if (resumeLast) args.push("--continue");
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
