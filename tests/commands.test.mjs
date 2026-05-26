import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const COMMANDS_DIR = path.join(ROOT, "plugins", "gemini", "commands");

function readCommand(name) {
  return fs.readFileSync(path.join(COMMANDS_DIR, name), "utf8");
}

test("all expected command files are present", () => {
  const expected = [
    "adversarial-review.md",
    "cancel.md",
    "rescue.md",
    "result.md",
    "review.md",
    "setup.md",
    "status.md"
  ].sort();
  const actual = fs.readdirSync(COMMANDS_DIR).filter((f) => f.endsWith(".md")).sort();
  assert.deepEqual(actual, expected);
});

test("review command calls gemini-companion review subcommand", () => {
  const source = readCommand("review.md");
  assert.match(source, /gemini-companion\.mjs.*review/);
  assert.match(source, /AskUserQuestion/);
  assert.match(source, /Do not fix issues/i);
});

test("adversarial-review command references adversarial-review", () => {
  const source = readCommand("adversarial-review.md");
  assert.match(source, /adversarial-review/);
  assert.match(source, /AskUserQuestion/);
});

test("rescue command references gemini-rescue subagent", () => {
  const source = readCommand("rescue.md");
  assert.match(source, /gemini-rescue/);
});

test("setup command exists and has description", () => {
  const source = readCommand("setup.md");
  assert.match(source, /description:/);
});

test("review and adversarial-review use different prompt templates", () => {
  const review = readCommand("review.md");
  const adversarial = readCommand("adversarial-review.md");
  assert.match(review, /review/);
  assert.match(adversarial, /adversarial-review/);
  assert.notEqual(review, adversarial);
});
