#!/usr/bin/env node
"use strict";

// Fake gemini CLI used by tests/runtime.test.mjs. It is copied into a temp bin
// directory (as an extensionless `gemini`) and discovered through PATH, so the
// companion's spawnSync calls exercise the real engine-detection and
// stdin/JSON-envelope code paths without contacting the network.
//
// Contract mirrored from the real gemini CLI as consumed by lib/gemini.mjs:
//   * `gemini --version`            -> prints a version line, exit 0.
//   * `gemini ... --output-format json` (prompt on stdin)
//                                   -> prints `{ "session_id", "response" }`.
//     For task turns `response` is plain text; for reviews it is a JSON string
//     so lib/gemini.mjs can re-parse it into the structured review object.
//
// The scenario is injected via fake-gemini-config.json (written at install
// time) and every invocation is recorded to fake-gemini-state.json so tests can
// assert on the forwarded argv (model selection, --yolo, --resume, ...).

const fs = require("node:fs");
const path = require("node:path");

const CONFIG_PATH = path.join(__dirname, "fake-gemini-config.json");
const STATE_PATH = path.join(__dirname, "fake-gemini-state.json");

function readScenario() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")).scenario || "task";
  } catch {
    return "task";
  }
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch {
    return { nextThread: 1, invocations: [] };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), "utf8");
}

const argv = process.argv.slice(2);

if (argv.includes("--version")) {
  process.stdout.write("gemini-cli test 0.0.0-fake\n");
  process.exit(0);
}

const SCENARIO = readScenario();

function buildResponse() {
  switch (SCENARIO) {
    case "review-clean":
      return JSON.stringify({
        verdict: "approve",
        summary: "No material issues found.",
        findings: [],
        next_steps: []
      });
    case "review-findings":
    case "review-noisy":
      return JSON.stringify({
        verdict: "needs-attention",
        summary: "One adversarial concern surfaced.",
        findings: [
          {
            severity: "high",
            title: "Missing empty-state guard",
            body: "The change assumes data is always present.",
            file: "src/app.js",
            line_start: 4,
            line_end: 6,
            confidence: 0.87,
            recommendation: "Handle empty collections before indexing."
          }
        ],
        next_steps: ["Add an empty-state test."]
      });
    case "review-invalid":
      return "not valid json";
    default:
      if (argv.includes("--resume")) {
        return "Resumed the prior run.\nFollow-up prompt accepted.";
      }
      return "Handled the requested task.\nTask prompt accepted.";
  }
}

function respond(prompt) {
  const state = loadState();
  const sessionId = "thr_" + state.nextThread++;
  const invocation = { args: argv, prompt: prompt, sessionId: sessionId };
  state.invocations.push(invocation);
  state.lastInvocation = invocation;
  saveState(state);

  if (SCENARIO === "task-fail") {
    process.stderr.write("Gemini turn failed: simulated failure.\n");
    process.exit(1);
  }

  if (SCENARIO === "review-noisy") {
    // Reasoning/thought noise on stderr must NOT pollute the stdout JSON parse.
    process.stderr.write("Considering empty-state edge cases...\nReasoning complete.\n");
  }

  const response = buildResponse();
  process.stdout.write(JSON.stringify({ session_id: sessionId, response: response }));
  process.exit(0);
}

if (process.stdin.isTTY) {
  respond("");
} else {
  const chunks = [];
  process.stdin.on("data", (chunk) => chunks.push(chunk));
  process.stdin.on("end", () => respond(Buffer.concat(chunks).toString("utf8")));
  process.stdin.on("error", () => respond(""));
}
