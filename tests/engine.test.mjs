import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MODEL_ALIASES,
  normalizeRequestedModel,
  mapEffortToModel,
  buildCliArgs,
  detectEngine,
  supportsAgyStdinPrompt
} from "../plugins/gemini/scripts/lib/engine.mjs";

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

test("detectEngine fails closed when agy resolves only to a bare non-.exe path", () => {
  assert.throws(
    () => detectEngine("agy", { resolveBinaryPathImpl: () => "agy.cmd" }),
    /AGY could not be resolved to an executable \.exe path; the plugin refuses to spawn it via the shell to avoid argv injection on Windows\./
  );
});

test("detectEngine fails closed when agy resolves only to an absolute .cmd shim (CVE-2024-27980 angle)", () => {
  // An absolute .cmd path would still re-enter cmd.exe on pre-patch Node even
  // under shell:false, so requireExe must reject it, not just bare names.
  assert.throws(
    () => detectEngine("agy", { resolveBinaryPathImpl: () => (process.platform === "win32" ? "C:\\tools\\agy.cmd" : null) }),
    /AGY could not be resolved to an executable \.exe path/
  );
});

test("AGY stdin prompt capability begins at stable 1.1.2 and fails closed for unknown versions", () => {
  assert.equal(supportsAgyStdinPrompt("1.1.1"), false);
  assert.equal(supportsAgyStdinPrompt("agy 1.1.1"), false);
  assert.equal(supportsAgyStdinPrompt("1.1.2-beta.1"), false);
  assert.equal(supportsAgyStdinPrompt("unknown"), false);
  assert.equal(supportsAgyStdinPrompt("1.1.2"), true);
  assert.equal(supportsAgyStdinPrompt("agy version 1.2.0"), true);
  assert.equal(supportsAgyStdinPrompt("2.0.0"), true);
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

test("AGY stdin mode omits --print and prompt while preserving execution flags", () => {
  const prompt = "x".repeat(24_001);
  const args = buildCliArgs("agy", {
    prompt,
    useStdin: true,
    write: true,
    timeoutMs: 105_000
  });

  assert.ok(!args.includes("--print"));
  assert.ok(!args.includes(prompt));
  assert.ok(args.includes("--dangerously-skip-permissions"));
  assert.ok(args.includes("--new-project"));
  assert.deepEqual(args.slice(-2), ["--print-timeout", "2m"]);
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
