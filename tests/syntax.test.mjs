import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const SCRIPTS_DIR = path.join(ROOT, "plugins", "gemini", "scripts");

function findMjsFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findMjsFiles(full));
    } else if (entry.name.endsWith(".mjs")) {
      files.push(full);
    }
  }
  return files;
}

test("all scripts pass node --check", () => {
  const files = findMjsFiles(SCRIPTS_DIR);
  assert.ok(files.length > 0, "Expected at least one .mjs file under scripts/");
  for (const file of files) {
    try {
      execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    } catch (err) {
      const detail = err.stderr?.toString().trim() ?? err.message;
      assert.fail(`Syntax error in ${path.relative(ROOT, file)}: ${detail}`);
    }
  }
});
