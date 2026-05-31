import { test } from "node:test";
import assert from "node:assert/strict";

import {
  renderSetupReport,
  renderStatusReport,
  renderJobStatusReport,
  renderTaskResult,
  renderCancelReport,
  renderStoredJobResult
} from "../plugins/gemini/scripts/lib/render.mjs";

function setupReport(overrides = {}) {
  return {
    ready: true,
    node: { detail: "v24.0.0" },
    npm: { detail: "11.0.0" },
    gemini: { detail: "0.44.1" },
    geminiAuth: { detail: "logged in" },
    agy: { detail: "1.0.2" },
    agyAuth: { detail: "logged in" },
    sessionRuntime: { label: "gemini 0.44.1" },
    reviewGateEnabled: false,
    actionsTaken: [],
    nextSteps: [],
    ...overrides
  };
}

test("renderSetupReport lists every check and the review-gate state", () => {
  const out = renderSetupReport(setupReport({ reviewGateEnabled: true, nextSteps: ["Run `gemini`"] }));
  assert.match(out, /# Gemini Setup/);
  assert.match(out, /Status: ready/);
  assert.match(out, /- node: v24\.0\.0/);
  assert.match(out, /- gemini: 0\.44\.1/);
  assert.match(out, /- agy: 1\.0\.2/);
  assert.match(out, /- review gate: enabled/);
  assert.match(out, /Next steps:/);
});

test("renderSetupReport reports needs-attention when not ready", () => {
  const out = renderSetupReport(setupReport({ ready: false }));
  assert.match(out, /Status: needs attention/);
  assert.match(out, /- review gate: disabled/);
});

test("renderStatusReport shows empty state when there are no jobs", () => {
  const out = renderStatusReport({
    sessionRuntime: { label: "gemini 0.44.1" },
    running: [],
    latestFinished: null,
    recent: [],
    needsReview: false
  });
  assert.match(out, /# Gemini Status/);
  assert.match(out, /Session runtime: gemini 0\.44\.1/);
  assert.match(out, /No jobs recorded yet\./);
});

test("renderStatusReport announces the stop-time review gate when enabled", () => {
  const out = renderStatusReport({
    sessionRuntime: { label: "gemini 0.44.1" },
    running: [],
    latestFinished: null,
    recent: [],
    needsReview: true
  });
  assert.match(out, /stop-time review gate is enabled/);
});

test("renderJobStatusReport renders a single job's id and status", () => {
  const out = renderJobStatusReport({ id: "task-1", status: "completed", title: "Investigate flake" });
  assert.match(out, /# Gemini Job Status/);
  assert.match(out, /task-1/);
  assert.match(out, /completed/);
});

test("renderTaskResult returns the raw output verbatim with a trailing newline", () => {
  assert.equal(renderTaskResult({ rawOutput: "hello world" }, {}), "hello world\n");
  assert.equal(renderTaskResult({ rawOutput: "ends with newline\n" }, {}), "ends with newline\n");
});

test("renderTaskResult falls back to a failure message when there is no output", () => {
  assert.equal(renderTaskResult({ failureMessage: "boom" }, {}), "boom\n");
  assert.equal(renderTaskResult({}, {}), "Gemini did not return a final message.\n");
});

test("renderCancelReport confirms cancellation and points at status", () => {
  const out = renderCancelReport({ id: "task-7", title: "Big task", summary: "wip" });
  assert.match(out, /# Gemini Cancel/);
  assert.match(out, /Cancelled task-7\./);
  assert.match(out, /\/gemini:status/);
});

test("renderStoredJobResult prefers the structured rendered review output", () => {
  const out = renderStoredJobResult(
    { id: "review-1", status: "completed", title: "Gemini Review" },
    { result: { result: { verdict: "approve" } }, rendered: "RENDERED REVIEW\n" }
  );
  assert.match(out, /RENDERED REVIEW/);
});

test("renderStoredJobResult falls back to result.gemini.stdout and appends the resume hint", () => {
  const out = renderStoredJobResult(
    { id: "task-2", status: "completed", title: "Task" },
    { threadId: "sess-1", result: { gemini: { stdout: "RAW OUTPUT" } } }
  );
  assert.match(out, /RAW OUTPUT/);
  assert.match(out, /Resume in Gemini: gemini resume sess-1/);
});

test("renderStoredJobResult reports when no payload was stored", () => {
  const out = renderStoredJobResult({ id: "task-9", status: "failed", title: "X" }, {});
  assert.match(out, /No captured result payload was stored/);
});
