import { test } from "node:test";
import assert from "node:assert/strict";

import { tryParseJsonFromText } from "../plugins/gemini/scripts/lib/gemini.mjs";

test("parses a clean JSON payload", () => {
  const obj = tryParseJsonFromText('{"verdict":"approve","summary":"s","findings":[],"next_steps":[]}');
  assert.equal(obj.verdict, "approve");
});

test("recovers the real JSON after a non-JSON preamble and control chars", () => {
  // Mirrors the observed gemini 0.44.1 pollution: control tokens + an
  // `update_topic{...}` block emitted before the actual review JSON.
  const polluted =
    "\x1b\x1b\x1bupdate_topic{strategic_intent:Review the diff,summary:The user provided context}" +
    '\n{"verdict":"needs-attention","summary":"x",' +
    '"findings":[{"severity":"high","title":"t","body":"b","file":"f","line_start":1,"line_end":2,"confidence":0.9,"recommendation":"r"}],' +
    '"next_steps":[]}';
  const obj = tryParseJsonFromText(polluted);
  assert.ok(obj, "should recover the trailing JSON object");
  assert.equal(obj.verdict, "needs-attention");
  assert.equal(obj.findings[0].severity, "high");
  assert.equal(obj.findings[0].title, "t");
});

test("returns the LAST balanced JSON object when several appear", () => {
  const obj = tryParseJsonFromText('{"a":1} some noise {"b":2}');
  assert.equal(obj.b, 2);
});

test("ignores braces inside JSON strings", () => {
  const obj = tryParseJsonFromText('prefix {"summary":"has } and { braces","verdict":"approve"} suffix');
  assert.equal(obj.verdict, "approve");
  assert.equal(obj.summary, "has } and { braces");
});

test("returns null when no JSON object is present", () => {
  assert.equal(tryParseJsonFromText("no json here"), null);
  assert.equal(tryParseJsonFromText(""), null);
});
