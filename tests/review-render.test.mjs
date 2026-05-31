import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderReviewResult } from "../plugins/gemini/scripts/lib/render.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const PROMPTS_DIR = path.join(ROOT, "plugins", "gemini", "prompts");

function makeParsed(finding) {
  return {
    parsed: {
      verdict: "needs-attention",
      summary: "One issue found.",
      findings: [finding],
      next_steps: []
    },
    rawOutput: "{}",
    parseError: null
  };
}

const meta = { reviewLabel: "Review", targetLabel: "working tree" };

test("renderReviewResult shows severity/title/body for schema-shaped findings", () => {
  const out = renderReviewResult(
    makeParsed({
      severity: "high",
      title: "Unvalidated input",
      body: "User input flows into a shell command.",
      file: "src/app.js",
      line_start: 10,
      line_end: 12,
      confidence: 0.9,
      recommendation: "Validate and escape input."
    }),
    meta
  );
  assert.match(out, /\[high\] Unvalidated input/);
  assert.match(out, /User input flows into a shell command\./);
  assert.match(out, /Validate and escape input\./);
  assert.doesNotMatch(out, /No details provided/);
});

test("renderReviewResult degrades for the OLD what_can_go_wrong shape (contract lock)", () => {
  const out = renderReviewResult(
    makeParsed({
      file: "src/app.js",
      line_start: 10,
      line_end: 12,
      confidence: 0.9,
      what_can_go_wrong: "x",
      why_vulnerable: "y",
      likely_impact: "z",
      recommendation: "fix"
    }),
    meta
  );
  // The renderer reads severity/title/body; with the old keys those are absent,
  // so it must fall back to placeholders. This locks prompt<->render alignment.
  assert.match(out, /No details provided/);
  assert.match(out, /\[low\] Finding 1/);
});

for (const name of ["review.md", "adversarial-review.md"]) {
  test(`${name} output contract uses schema keys (severity/title/body)`, () => {
    const src = fs.readFileSync(path.join(PROMPTS_DIR, name), "utf8");
    assert.match(src, /"severity"/);
    assert.match(src, /"title"/);
    assert.match(src, /"body"/);
    assert.doesNotMatch(src, /what_can_go_wrong/);
  });
}
