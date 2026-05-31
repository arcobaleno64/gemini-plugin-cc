import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { collectReviewContext, formatUntrackedFile, getWorkingTreeState, resolveReviewTarget } from "../plugins/gemini/scripts/lib/git.mjs";
import { initGitRepo, makeTempDir, run } from "./helpers.mjs";

function commitInitial(cwd) {
  fs.writeFileSync(path.join(cwd, "app.js"), "console.log('v1');\n");
  run("git", ["add", "app.js"], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });
}

test("resolveReviewTarget prefers the working tree when the repo is dirty", () => {
  const cwd = makeTempDir();
  initGitRepo(cwd);
  commitInitial(cwd);
  fs.writeFileSync(path.join(cwd, "app.js"), "console.log('v2');\n");

  const target = resolveReviewTarget(cwd, {});
  assert.equal(target.mode, "working-tree");
});

test("resolveReviewTarget falls back to a branch diff when the repo is clean", () => {
  const cwd = makeTempDir();
  initGitRepo(cwd);
  commitInitial(cwd);
  run("git", ["checkout", "-b", "feature/test"], { cwd });
  fs.writeFileSync(path.join(cwd, "app.js"), "console.log('v2');\n");
  run("git", ["add", "app.js"], { cwd });
  run("git", ["commit", "-m", "change"], { cwd });

  const target = resolveReviewTarget(cwd, {});
  const context = collectReviewContext(cwd, target);

  assert.equal(target.mode, "branch");
  assert.match(target.label, /main/);
  assert.match(context.content, /## Branch Diff/);
  assert.match(context.content, /## Commit Log/);
});

test("resolveReviewTarget honors an explicit base override", () => {
  const cwd = makeTempDir();
  initGitRepo(cwd);
  commitInitial(cwd);

  const target = resolveReviewTarget(cwd, { base: "main" });
  assert.equal(target.mode, "branch");
  assert.equal(target.baseRef, "main");
  assert.equal(target.explicit, true);
});

test("resolveReviewTarget throws when no default branch can be inferred", () => {
  const cwd = makeTempDir();
  initGitRepo(cwd);
  commitInitial(cwd);
  run("git", ["branch", "-m", "feature-only"], { cwd });

  assert.throws(
    () => resolveReviewTarget(cwd, {}),
    /Unable to detect the repository default branch\. Pass --base <ref> or use --scope working-tree\./
  );
});

test("collectReviewContext includes untracked file content in a working-tree review", () => {
  const cwd = makeTempDir();
  initGitRepo(cwd);
  commitInitial(cwd);
  fs.writeFileSync(path.join(cwd, "new-risk.js"), "const secret = 'UNTRACKED_MARKER';\n");

  const target = resolveReviewTarget(cwd, { scope: "working-tree" });
  const context = collectReviewContext(cwd, target);

  assert.equal(context.mode, "working-tree");
  assert.match(context.content, /## Untracked Files/);
  assert.match(context.content, /UNTRACKED_MARKER/);
});

test("getWorkingTreeState reflects staged, unstaged, and untracked files", () => {
  const cwd = makeTempDir();
  initGitRepo(cwd);
  commitInitial(cwd);
  fs.writeFileSync(path.join(cwd, "app.js"), "console.log('v2');\n");
  fs.writeFileSync(path.join(cwd, "untracked.js"), "console.log('new');\n");

  const state = getWorkingTreeState(cwd);
  assert.equal(state.isDirty, true);
  assert.ok(state.unstaged.includes("app.js"));
  assert.ok(state.untracked.includes("untracked.js"));
});

test("resolveReviewTarget rejects an unsafe --base ref", () => {
  const cwd = makeTempDir();
  initGitRepo(cwd);
  commitInitial(cwd);
  assert.throws(() => resolveReviewTarget(cwd, { base: "--upload-pack=evil" }), /Invalid --base ref/);
  assert.throws(() => resolveReviewTarget(cwd, { base: "x; rm -rf /" }), /Invalid --base ref/);
});

test("formatUntrackedFile skips a directory instead of crashing", () => {
  const cwd = makeTempDir();
  fs.mkdirSync(path.join(cwd, "a-dir"));
  assert.match(formatUntrackedFile(cwd, "a-dir"), /\(skipped: directory\)/);
});

test("formatUntrackedFile inlines a small text file", () => {
  const cwd = makeTempDir();
  fs.writeFileSync(path.join(cwd, "note.txt"), "hello content\n");
  const out = formatUntrackedFile(cwd, "note.txt");
  assert.match(out, /### note\.txt/);
  assert.match(out, /hello content/);
});
