import { test } from "node:test";
import assert from "node:assert/strict";

import { MODEL_ALIASES, normalizeRequestedModel, mapEffortToModel, buildCliArgs } from "../plugins/gemini/scripts/lib/engine.mjs";

// These two IDs return 404 ModelNotFound on the gemini CLI (verified 0.44.1).
// No alias or effort tier may resolve to them.
const DEAD_MODEL_IDS = ["gemini-3.5-flash", "gemini-3.1-pro"];

test("model aliases resolve to verified-valid IDs", () => {
  assert.equal(normalizeRequestedModel("flash"), "gemini-3-flash-preview");
  assert.equal(normalizeRequestedModel("flash3"), "gemini-3-flash-preview");
  assert.equal(normalizeRequestedModel("pro"), "gemini-3.1-pro-preview");
  assert.equal(normalizeRequestedModel("pro3"), "gemini-3.1-pro-preview");
  assert.equal(normalizeRequestedModel("lite3"), "gemini-3.1-flash-lite");
  assert.equal(normalizeRequestedModel("flash25"), "gemini-2.5-flash");
  assert.equal(normalizeRequestedModel("pro25"), "gemini-2.5-pro");
  assert.equal(normalizeRequestedModel("lite"), "gemini-2.5-flash-lite");
  assert.equal(normalizeRequestedModel("fast"), "gemini-2.5-flash-lite");
});

test("no alias maps to a known-dead 404 model id", () => {
  for (const [alias, id] of MODEL_ALIASES) {
    assert.ok(!DEAD_MODEL_IDS.includes(id), `alias '${alias}' resolves to dead model '${id}'`);
  }
});

test("effort tiers map to verified-valid IDs", () => {
  assert.equal(mapEffortToModel("high"), "gemini-3.1-pro-preview");
  assert.equal(mapEffortToModel("xhigh"), "gemini-3.1-pro-preview");
  assert.equal(mapEffortToModel("medium"), "gemini-3-flash-preview");
  assert.equal(mapEffortToModel("low"), "gemini-3-flash-preview");
  assert.equal(mapEffortToModel("none"), "gemini-2.5-flash-lite");
  assert.equal(mapEffortToModel("minimal"), "gemini-2.5-flash-lite");
  assert.equal(mapEffortToModel(""), null);
  assert.equal(mapEffortToModel(undefined), null);
  for (const tier of ["none", "minimal", "low", "medium", "high", "xhigh"]) {
    assert.ok(!DEAD_MODEL_IDS.includes(mapEffortToModel(tier)), `effort '${tier}' maps to a dead model`);
  }
});

test("unknown / explicit model strings pass through unchanged", () => {
  assert.equal(normalizeRequestedModel("gemini-2.5-pro"), "gemini-2.5-pro");
  assert.equal(normalizeRequestedModel("some-custom-model"), "some-custom-model");
  assert.equal(normalizeRequestedModel(null), null);
  assert.equal(normalizeRequestedModel(""), null);
});

test("agy positional prompt rejects NUL bytes before argv construction", () => {
  assert.throws(
    () => buildCliArgs("agy", { prompt: "hello\0world" }),
    (error) => error.failure?.category === "prompt-too-long" && /NUL/i.test(error.message)
  );
});

test("agy positional prompt rejects prompts above the safe Windows argv limit", () => {
  assert.throws(
    () => buildCliArgs("agy", { prompt: "x".repeat(24_001) }),
    (error) => error.failure?.category === "prompt-too-long" && /24,000|24000/.test(error.message)
  );
});

test("agy write turn adds --new-project so files land in cwd, not agy's scratch dir", () => {
  const args = buildCliArgs("agy", { prompt: "hello", write: true });
  assert.ok(args.includes("--dangerously-skip-permissions"));
  assert.ok(args.includes("--new-project"));
  assert.ok(!args.includes("--continue"));
});

test("agy resumed write turn uses --continue instead of --new-project", () => {
  const args = buildCliArgs("agy", { prompt: "hello", write: true, resumeLast: true });
  assert.ok(args.includes("--continue"));
  assert.ok(!args.includes("--new-project"));
});

test("agy read-only turn adds neither --dangerously-skip-permissions nor --new-project", () => {
  const args = buildCliArgs("agy", { prompt: "hello" });
  assert.ok(!args.includes("--dangerously-skip-permissions"));
  assert.ok(!args.includes("--new-project"));
});
