import test from "node:test";
import assert from "node:assert/strict";

import { scoreReview, findingMatchesPlanted, normalizeFile } from "./lib/score.mjs";
import { _internal as adapters } from "./lib/adapters.mjs";

const TRUTH = {
  planted: [
    {
      id: "sqli",
      category: "injection",
      file: "src/auth.js",
      line_start: 10,
      line_end: 12,
      severity: "critical",
      match: { keywords: ["sql injection", "parameteri"] }
    },
    {
      id: "json-parse",
      category: "error-handling",
      file: "src/auth.js",
      line_start: 40,
      line_end: 41,
      severity: "high",
      match: { keywords: ["json.parse", "unguarded"] }
    }
  ],
  allowed_extras: [
    { id: "jwt-expiry", file: "src/auth.js", match: { keywords: ["expiresin", "no expiry"] } }
  ]
};

function finding(over = {}) {
  return {
    severity: "high",
    title: "x",
    body: "y",
    file: "src/auth.js",
    line_start: 1,
    line_end: 1,
    confidence: 0.9,
    recommendation: "fix",
    ...over
  };
}

test("normalizeFile makes paths comparable across separators and ./ prefixes", () => {
  assert.equal(normalizeFile(".\\src\\Auth.js"), "src/auth.js");
  assert.equal(normalizeFile("./src/auth.js"), "src/auth.js");
});

test("findingMatchesPlanted matches on overlapping line range", () => {
  const f = finding({ line_start: 11, line_end: 11, title: "bug", body: "z" });
  assert.equal(findingMatchesPlanted(f, TRUTH.planted[0]), true);
});

test("findingMatchesPlanted matches on keyword when lines are off", () => {
  const f = finding({ line_start: 200, line_end: 201, title: "SQL injection risk", body: "use parameterized query" });
  assert.equal(findingMatchesPlanted(f, TRUTH.planted[0]), true);
});

test("findingMatchesPlanted rejects a different file", () => {
  const f = finding({ file: "src/other.js", line_start: 11, line_end: 11 });
  assert.equal(findingMatchesPlanted(f, TRUTH.planted[0]), false);
});

test("scoreReview gives full recall and clean precision when both planted defects are found", () => {
  const findings = [
    finding({ severity: "critical", title: "SQL injection", body: "not parameterized", line_start: 10, line_end: 12 }),
    finding({ severity: "high", title: "Unguarded JSON.parse", body: "may throw", line_start: 40, line_end: 41 })
  ];
  const s = scoreReview(findings, TRUTH);
  assert.equal(s.found, 2);
  assert.equal(s.recall, 1);
  assert.equal(s.falsePositives, 0);
  assert.equal(s.precision, 1);
  assert.equal(s.severity.exact, 2);
  assert.equal(s.composite, 100);
});

test("scoreReview counts a false positive for an unmatched, non-allowed finding", () => {
  const findings = [
    finding({ severity: "critical", title: "SQL injection", body: "x", line_start: 10, line_end: 12 }),
    finding({ severity: "high", title: "Made-up async bug", body: "hallucinated", file: "src/auth.js", line_start: 99, line_end: 99 })
  ];
  const s = scoreReview(findings, TRUTH);
  assert.equal(s.found, 1);
  assert.equal(s.recall, 0.5);
  assert.equal(s.falsePositives, 1);
  assert.equal(s.bonus, 0);
  assert.deepEqual(s.missed, ["json-parse"]);
});

test("scoreReview credits an allowed extra as bonus, not a false positive", () => {
  const findings = [
    finding({ title: "SQL injection", body: "x", line_start: 10, line_end: 12 }),
    finding({ title: "Unguarded JSON.parse", body: "x", line_start: 40, line_end: 41 }),
    finding({ title: "JWT issued without expiry", body: "no expiresIn set", line_start: 25, line_end: 25 })
  ];
  const s = scoreReview(findings, TRUTH);
  assert.equal(s.found, 2);
  assert.equal(s.bonus, 1);
  assert.equal(s.falsePositives, 0);
  assert.equal(s.precision, 1);
});

test("extractJsonObject pulls a balanced object out of surrounding prose and fences", () => {
  const enveloped = 'Here is the review:\n```json\n{"verdict":"approve","findings":[]}\n```\nThanks!';
  assert.deepEqual(adapters.extractJsonObject(enveloped), { verdict: "approve", findings: [] });
});

test("extractJsonObject respects braces inside strings", () => {
  const text = '{"summary":"has a } brace","findings":[]}';
  assert.deepEqual(adapters.extractJsonObject(text), { summary: "has a } brace", findings: [] });
});

test("extractJsonObject returns null when there is no JSON object", () => {
  assert.equal(adapters.extractJsonObject("no json here"), null);
  assert.equal(adapters.extractJsonObject(null), null);
});

test("geminiInnerText unwraps the gemini --output-format json envelope across shapes", () => {
  assert.equal(adapters.geminiInnerText({ response: "hi" }, "fb"), "hi");
  assert.equal(adapters.geminiInnerText({ response: { text: "nested" } }, "fb"), "nested");
  assert.equal(
    adapters.geminiInnerText({ candidates: [{ content: { parts: [{ text: "api" }] } }] }, "fb"),
    "api"
  );
  assert.equal(adapters.geminiInnerText({ text: "top" }, "fb"), "top");
  assert.equal(adapters.geminiInnerText(null, "fallback"), "fallback");
});

test("normalizeReview coerces a missing findings array to []", () => {
  assert.deepEqual(adapters.normalizeReview({ verdict: "approve" }), {
    verdict: "approve",
    summary: null,
    findings: []
  });
  assert.equal(adapters.normalizeReview(null), null);
});

test("scoreReview flags severity miscalibration without dropping the catch", () => {
  const findings = [
    finding({ severity: "low", title: "SQL injection", body: "x", line_start: 10, line_end: 12 }), // expected critical
    finding({ severity: "high", title: "Unguarded JSON.parse", body: "x", line_start: 40, line_end: 41 })
  ];
  const s = scoreReview(findings, TRUTH);
  assert.equal(s.found, 2);
  assert.equal(s.severity.mismatch, 1); // low vs critical
  assert.equal(s.severity.exact, 1); // high vs high
});
