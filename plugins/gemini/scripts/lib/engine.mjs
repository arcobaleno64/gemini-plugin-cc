import process from "node:process";

import { binaryAvailable, resolveBinaryPath } from "./process.mjs";
import { EFFORT_MODEL_MAP, MODEL_ALIASES, VALID_EFFORT_LEVELS } from "./model-map.mjs";

export const ENGINE_ENV = "GEMINI_ENGINE";

// Model aliases and effort tiers live in model-map.mjs (single source of truth,
// verified against the README table). Re-exported here for existing importers.
export { MODEL_ALIASES, VALID_EFFORT_LEVELS };

export function mapEffortToModel(effort) {
  if (!effort) return null;
  const e = String(effort).trim().toLowerCase();
  return EFFORT_MODEL_MAP.get(e) ?? null;
}

export function normalizeRequestedModel(model) {
  if (model == null) return null;
  const normalized = String(model).trim().toLowerCase();
  if (!normalized) return null;
  return MODEL_ALIASES.get(normalized) ?? String(model).trim();
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
    return { engine: "agy", binary: resolveBinaryPath("agy") ?? "agy", version: status.detail ?? "unknown" };
  }

  if (normalized === "gemini") {
    const status = binaryAvailable("gemini", ["--version"]);
    if (!status.available) throw new Error("Gemini engine requested but gemini binary is not available.");
    return { engine: "gemini", binary: "gemini", version: status.detail ?? "unknown" };
  }

  // auto: prefer gemini — AGY cannot output via pipe in non-interactive mode
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

export function buildCliArgs(engine, options = {}) {
  const { prompt = "", model, write = false, resumeLast = false, outputJson = false, approvalModePlan = false, timeoutMs, useStdin = false } = options;

  if (engine === "agy") {
    // AGY does not support stdin; prompt must be passed as a positional argument
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
