#!/usr/bin/env node

import fs from "node:fs";
import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getConfig } from "./lib/state.mjs";
import { resolveWorkspaceRoot } from "./lib/workspace.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");

function readHookInput() {
  const raw = fs.readFileSync(0, "utf8").trim();
  if (!raw) {
    return {};
  }
  return JSON.parse(raw);
}

function emitDecision(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

async function main() {
  const input = readHookInput();
  const cwd = input.cwd || process.cwd();
  const workspaceRoot = resolveWorkspaceRoot(cwd);

  let config = {};
  try {
    config = getConfig(workspaceRoot) ?? {};
  } catch {
    // If state is unreadable, skip the gate silently.
    process.exit(0);
  }

  // Stop gate is opt-in. Exit 0 (no decision) unless explicitly enabled.
  if (!config.stopReviewGateEnabled) {
    process.exit(0);
  }

  // Gate is enabled but not yet fully implemented — pass through cleanly.
  emitDecision({ decision: "proceed" });
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(0);
});
