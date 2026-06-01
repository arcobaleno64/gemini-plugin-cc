import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  EFFORT_MODEL_MAP,
  MODEL_ALIASES,
  MODEL_ALIAS_ENTRIES,
  MODEL_MAP_METADATA
} from "../plugins/gemini/scripts/lib/model-map.mjs";
import {
  mapEffortToModel,
  normalizeRequestedModel,
  VALID_EFFORT_LEVELS
} from "../plugins/gemini/scripts/lib/engine.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("model aliases resolve to their canonical model id", () => {
  assert.equal(normalizeRequestedModel("flash"), "gemini-3-flash-preview");
  assert.equal(normalizeRequestedModel("pro"), "gemini-3.1-pro-preview");
  // Alias lookup is case-insensitive.
  assert.equal(normalizeRequestedModel("LITE"), "gemini-2.5-flash-lite");
  for (const { alias, model } of MODEL_ALIAS_ENTRIES) {
    assert.equal(normalizeRequestedModel(alias), model);
  }
});

test("effort tiers map to a model and define the valid set", () => {
  assert.equal(mapEffortToModel("low"), "gemini-3-flash-preview");
  assert.equal(mapEffortToModel("high"), "gemini-3.1-pro-preview");
  assert.equal(mapEffortToModel("none"), "gemini-2.5-flash-lite");
  assert.equal(mapEffortToModel(null), null);
  assert.equal(mapEffortToModel("bogus"), null);
  assert.deepEqual([...VALID_EFFORT_LEVELS].sort(), [...EFFORT_MODEL_MAP.keys()].sort());
});

test("an unknown alias passes through unchanged (trimmed)", () => {
  assert.equal(normalizeRequestedModel("gemini-9.9-experimental"), "gemini-9.9-experimental");
  assert.equal(normalizeRequestedModel("  custom-model  "), "custom-model");
  assert.equal(normalizeRequestedModel(null), null);
  assert.equal(normalizeRequestedModel(""), null);
});

test("preview entries are flagged and metadata records provenance", () => {
  const preview = MODEL_ALIAS_ENTRIES.filter((entry) => entry.preview);
  assert.ok(preview.every((entry) => entry.model.includes("preview")));
  assert.ok(MODEL_MAP_METADATA.lastVerified, "metadata must record lastVerified");
  assert.ok(MODEL_MAP_METADATA.source, "metadata must record a source");
});

function parseReadmeAliasTable(readme) {
  const afterHeading = readme.split(/^##\s+Model Aliases\s*$/m)[1];
  assert.ok(afterHeading, "README.md must have a `## Model Aliases` section");
  const body = afterHeading.split(/^---\s*$/m)[0];
  const map = new Map();
  for (const line of body.split(/\r?\n/)) {
    if (!/^\|\s*`/.test(line)) {
      continue; // only table rows that begin with a backticked alias
    }
    const cells = line.split("|").map((cell) => cell.trim()).filter(Boolean);
    if (cells.length < 2) {
      continue;
    }
    const aliases = [...cells[0].matchAll(/`([^`]+)`/g)].map((match) => match[1]);
    const models = [...cells[1].matchAll(/`([^`]+)`/g)].map((match) => match[1]);
    if (!aliases.length || models.length !== 1) {
      continue;
    }
    for (const alias of aliases) {
      map.set(alias, models[0]);
    }
  }
  return map;
}

test("README model alias table matches model-map.mjs exactly", () => {
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  const readmeMap = parseReadmeAliasTable(readme);

  for (const [alias, model] of MODEL_ALIASES) {
    assert.equal(readmeMap.get(alias), model, `README missing or mismatched alias \`${alias}\``);
  }
  for (const [alias, model] of readmeMap) {
    assert.equal(MODEL_ALIASES.get(alias), model, `README declares unknown alias \`${alias}\``);
  }
});
