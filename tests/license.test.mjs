import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

test("root NOTICE exists and attributes the upstream copyright", () => {
  const notice = fs.readFileSync(path.join(ROOT, "NOTICE"), "utf8");
  assert.match(notice, /Copyright 2026 OpenAI/);
  assert.match(notice, /Apache License, Version 2\.0/);
  assert.match(notice, /codex-plugin-cc/);
});

test("Apache-2.0 license text is bundled at the repo root", () => {
  const apache = fs.readFileSync(path.join(ROOT, "LICENSE-APACHE-2.0"), "utf8");
  assert.match(apache, /Apache License/);
  assert.match(apache, /Version 2\.0/);
});

test("the distributed plugin subtree carries a NOTICE", () => {
  const notice = fs.readFileSync(path.join(ROOT, "plugins", "gemini", "NOTICE"), "utf8");
  assert.match(notice, /Copyright 2026 OpenAI/);
});
