import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  buildEnv,
  buildEnvUnavailable,
  installFakeAgy,
  installFakeGemini,
  installUnavailableEngines,
  installUnavailableGemini,
  readFakeState,
  removeGeminiCredentials,
  writeExpiredGeminiCredentials
} from "./fake-gemini-fixture.mjs";
import { initGitRepo, makeTempDir, run } from "./helpers.mjs";
import {
  resolveStateDir,
  resolveStateFile,
  writeJobFile
} from "../plugins/gemini/scripts/lib/state.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "plugins", "gemini", "scripts", "gemini-companion.mjs");

function setupRepo(scenario = "task") {
  const repo = makeTempDir();
  const binDir = makeTempDir();
  installFakeGemini(binDir, scenario);
  initGitRepo(repo);
  return { repo, binDir };
}

function commit(repo, file, contents) {
  const target = path.join(repo, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents, "utf8");
  run("git", ["add", file], { cwd: repo });
  run("git", ["commit", "-m", `add ${file}`], { cwd: repo });
}

function seedState(workspace, jobs, config = {}) {
  const stateFile = resolveStateFile(workspace);
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, `${JSON.stringify({ version: 1, config, jobs }, null, 2)}\n`, "utf8");
  return stateFile;
}

// The host Claude session exports GEMINI_COMPANION_SESSION_ID, which would make
// the session filter hide seeded jobs that carry no sessionId. Strip it so the
// companion treats the seeded state as session-agnostic.
function envWithoutSession(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.GEMINI_COMPANION_SESSION_ID;
  return env;
}

// ---------------------------------------------------------------------------
// setup
// ---------------------------------------------------------------------------

test("setup reports ready when fake gemini is installed and authenticated", () => {
  const binDir = makeTempDir();
  installFakeGemini(binDir, "task");

  const result = run("node", [SCRIPT, "setup", "--json"], { cwd: makeTempDir(), env: buildEnv(binDir) });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ready, true);
  assert.equal(payload.gemini.available, true);
  assert.equal(payload.geminiAuth.loggedIn, true);
});

test("setup is not ready when gemini is installed but unauthenticated", () => {
  const binDir = makeTempDir();
  installFakeGemini(binDir, "task");
  removeGeminiCredentials(binDir);

  const result = run("node", [SCRIPT, "setup", "--json"], { cwd: makeTempDir(), env: buildEnv(binDir) });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  // Core P0-3 contract: an unauthenticated gemini is never "ready". (readyState
  // may be "partial" when a real AGY fallback happens to be on PATH, so it is
  // asserted deterministically in the AGY-fallback test instead.)
  assert.equal(payload.ready, false);
  assert.equal(payload.gemini.available, true);
  assert.equal(payload.geminiAuth.loggedIn, false);
  assert.ok(payload.nextSteps.some((step) => /authenticate/i.test(step)));
});

test("setup is not ready when the gemini OAuth token is expired", () => {
  const binDir = makeTempDir();
  installFakeGemini(binDir, "task");
  writeExpiredGeminiCredentials(binDir);

  const result = run("node", [SCRIPT, "setup", "--json"], { cwd: makeTempDir(), env: buildEnv(binDir) });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ready, false);
  assert.equal(payload.geminiAuth.loggedIn, false);
  assert.match(payload.geminiAuth.detail, /expired/i);
});

test("setup reports a partial AGY fallback when gemini is unavailable but agy is present", () => {
  const binDir = makeTempDir();
  installUnavailableGemini(binDir);
  installFakeAgy(binDir);

  const result = run("node", [SCRIPT, "setup", "--json"], { cwd: makeTempDir(), env: buildEnvUnavailable(binDir) });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.gemini.available, false);
  assert.equal(payload.agy.available, true);
  assert.equal(payload.ready, false);
  assert.equal(payload.readyState, "partial");
  assert.equal(payload.agyFallbackAvailable, true);
  assert.ok(payload.nextSteps.some((step) => /--engine agy/.test(step)));
});

test("setup reports not ready when neither gemini nor agy is available", () => {
  const binDir = makeTempDir();
  installUnavailableEngines(binDir);

  const result = run("node", [SCRIPT, "setup", "--json"], { cwd: makeTempDir(), env: buildEnvUnavailable(binDir) });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ready, false);
  assert.equal(payload.gemini.available, false);
  assert.equal(payload.agy.available, false);
});

test("setup toggles the stop-time review gate and persists the choice", () => {
  const binDir = makeTempDir();
  installFakeGemini(binDir, "task");
  const workspace = makeTempDir();

  const enabled = run("node", [SCRIPT, "setup", "--json", "--enable-review-gate"], {
    cwd: workspace,
    env: buildEnv(binDir)
  });
  assert.equal(enabled.status, 0, enabled.stderr);
  const enabledPayload = JSON.parse(enabled.stdout);
  assert.equal(enabledPayload.reviewGateEnabled, true);
  assert.ok(enabledPayload.actionsTaken.some((entry) => /enabled/i.test(entry)));

  const persisted = run("node", [SCRIPT, "setup", "--json"], { cwd: workspace, env: buildEnv(binDir) });
  assert.equal(JSON.parse(persisted.stdout).reviewGateEnabled, true);

  const disabled = run("node", [SCRIPT, "setup", "--json", "--disable-review-gate"], {
    cwd: workspace,
    env: buildEnv(binDir)
  });
  assert.equal(JSON.parse(disabled.stdout).reviewGateEnabled, false);
});

// ---------------------------------------------------------------------------
// review / adversarial-review
// ---------------------------------------------------------------------------

test("review renders a clean working-tree verdict from structured JSON", () => {
  const { repo, binDir } = setupRepo("review-clean");
  commit(repo, "src/app.js", "export const value = 1;\n");
  fs.writeFileSync(path.join(repo, "src", "app.js"), "export const value = 2;\n");

  const result = run("node", [SCRIPT, "review"], { cwd: repo, env: buildEnv(binDir) });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /# Gemini Review/);
  assert.match(result.stdout, /Target: working tree/);
  assert.match(result.stdout, /Verdict: approve/);
  assert.match(result.stdout, /No material findings\./);
});

test("review honors --base over the dirty-tree auto default", () => {
  const { repo, binDir } = setupRepo("review-clean");
  commit(repo, "src/app.js", "export const value = 1;\n");
  run("git", ["checkout", "-b", "feature"], { cwd: repo });
  commit(repo, "src/feature.js", "export const f = 1;\n");
  // Dirty the working tree so the auto scope would resolve to working-tree.
  fs.writeFileSync(path.join(repo, "src", "app.js"), "export const value = 2;\n");

  const result = run("node", [SCRIPT, "review", "--base", "main"], { cwd: repo, env: buildEnv(binDir) });

  assert.equal(result.status, 0, result.stderr);
  // The fix must route --base through to the diff target; the original bug
  // re-resolved with empty options and reported "working tree diff" instead.
  assert.match(result.stdout, /Target: branch diff against main/);
  assert.doesNotMatch(result.stdout, /Target: working tree/);
});

test("review honors --scope working-tree even when the tree is clean", () => {
  const { repo, binDir } = setupRepo("review-clean");
  commit(repo, "src/app.js", "export const value = 1;\n");
  // Clean tree: the auto scope would resolve to a branch diff, not working-tree.

  const result = run("node", [SCRIPT, "review", "--scope", "working-tree"], { cwd: repo, env: buildEnv(binDir) });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Target: working tree diff/);
});

test("review honors --scope branch even when the tree is dirty", () => {
  const { repo, binDir } = setupRepo("review-clean");
  commit(repo, "src/app.js", "export const value = 1;\n");
  // Dirty the tree: the auto scope would resolve to working-tree, not branch.
  fs.writeFileSync(path.join(repo, "src", "app.js"), "export const value = 2;\n");

  const result = run("node", [SCRIPT, "review", "--scope", "branch"], { cwd: repo, env: buildEnv(binDir) });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Target: branch diff against main/);
  assert.doesNotMatch(result.stdout, /Target: working tree/);
});

test("standard review ignores trailing focus text", () => {
  const { repo, binDir } = setupRepo("review-clean");
  commit(repo, "src/app.js", "export const value = 1;\n");
  fs.writeFileSync(path.join(repo, "src", "app.js"), "export const value = 2;\n");

  const result = run("node", [SCRIPT, "review", "please", "focus", "on", "auth"], { cwd: repo, env: buildEnv(binDir) });

  assert.equal(result.status, 0, result.stderr);
  const state = readFakeState(binDir);
  assert.doesNotMatch(state.lastInvocation.prompt, /please focus on auth/);
});

test("adversarial review keeps focus text out of flag parsing and forwards it", () => {
  const { repo, binDir } = setupRepo("review-findings");
  commit(repo, "src/app.js", "export const value = items[0];\n");
  fs.writeFileSync(path.join(repo, "src", "app.js"), "export const value = items[0].id;\n");

  const result = run(
    "node",
    [SCRIPT, "adversarial-review", "--base", "main", "challenge", "the", "retry", "design"],
    { cwd: repo, env: buildEnv(binDir) }
  );

  assert.equal(result.status, 0, result.stderr);
  // --base must be parsed as a flag and the trailing words must become focus text.
  assert.match(result.stdout, /Target: branch diff against main/);
  const state = readFakeState(binDir);
  assert.match(state.lastInvocation.prompt, /challenge the retry design/);
});

test("review forwards the default gemini model and JSON output flags", () => {
  const { repo, binDir } = setupRepo("review-clean");
  commit(repo, "src/app.js", "export const value = 1;\n");
  fs.writeFileSync(path.join(repo, "src", "app.js"), "export const value = 2;\n");

  const result = run("node", [SCRIPT, "review"], { cwd: repo, env: buildEnv(binDir) });
  assert.equal(result.status, 0, result.stderr);

  const state = readFakeState(binDir);
  assert.ok(state.lastInvocation.args.includes("gemini-2.5-flash"));
  assert.ok(state.lastInvocation.args.includes("--output-format"));
});

test("adversarial review renders structured findings", () => {
  const { repo, binDir } = setupRepo("review-findings");
  commit(repo, "src/app.js", "export const value = items[0];\n");
  fs.writeFileSync(path.join(repo, "src", "app.js"), "export const value = items[0].id;\n");

  const result = run("node", [SCRIPT, "adversarial-review"], { cwd: repo, env: buildEnv(binDir) });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /# Gemini Adversarial Review/);
  assert.match(result.stdout, /Verdict: needs-attention/);
  assert.match(result.stdout, /\[high\] Missing empty-state guard \(src\/app\.js:4-6\)/);
  assert.match(result.stdout, /Recommendation: Handle empty collections before indexing\./);
  assert.match(result.stdout, /Next steps:/);
});

test("review degrades gracefully when gemini returns invalid JSON", () => {
  const { repo, binDir } = setupRepo("review-invalid");
  commit(repo, "src/app.js", "export const value = 1;\n");
  fs.writeFileSync(path.join(repo, "src", "app.js"), "export const value = 2;\n");

  const result = run("node", [SCRIPT, "review"], { cwd: repo, env: buildEnv(binDir) });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /did not return valid structured JSON/i);
  assert.match(result.stdout, /Parse error:/);
});

test("review fails fast outside a git repository", () => {
  const binDir = makeTempDir();
  installFakeGemini(binDir, "review-clean");
  const notARepo = makeTempDir();

  const result = run("node", [SCRIPT, "review"], { cwd: notARepo, env: buildEnv(binDir) });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must run inside a Git repository/i);
});

// ---------------------------------------------------------------------------
// task
// ---------------------------------------------------------------------------

test("task returns the final gemini message", () => {
  const { repo, binDir } = setupRepo("task");
  commit(repo, "README.md", "hello\n");

  const result = run("node", [SCRIPT, "task", "do something useful"], { cwd: repo, env: buildEnv(binDir) });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "Handled the requested task.\nTask prompt accepted.\n");
});

test("task records the gemini session id as the resumable thread", () => {
  const { repo, binDir } = setupRepo("task");
  commit(repo, "README.md", "hello\n");

  const taskRun = run("node", [SCRIPT, "task", "investigate"], { cwd: repo, env: buildEnv(binDir) });
  assert.equal(taskRun.status, 0, taskRun.stderr);

  const result = run("node", [SCRIPT, "result", "--json"], { cwd: repo, env: buildEnv(binDir) });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).storedJob.threadId, "thr_1");
});

test("task maps a model alias to the resolved gemini model", () => {
  const { repo, binDir } = setupRepo("task");
  commit(repo, "README.md", "hello\n");

  const result = run("node", [SCRIPT, "task", "--model", "pro", "diagnose"], { cwd: repo, env: buildEnv(binDir) });
  assert.equal(result.status, 0, result.stderr);

  const args = readFakeState(binDir).lastInvocation.args;
  assert.ok(args.includes("-m"));
  assert.ok(args.includes("gemini-3.1-pro-preview"));
});

test("task maps reasoning effort to a model when no model is given", () => {
  const { repo, binDir } = setupRepo("task");
  commit(repo, "README.md", "hello\n");

  const result = run("node", [SCRIPT, "task", "--effort", "high", "diagnose"], { cwd: repo, env: buildEnv(binDir) });
  assert.equal(result.status, 0, result.stderr);

  assert.ok(readFakeState(binDir).lastInvocation.args.includes("gemini-3.1-pro-preview"));
});

test("task rejects an invalid effort level", () => {
  const { repo, binDir } = setupRepo("task");
  commit(repo, "README.md", "hello\n");

  const result = run("node", [SCRIPT, "task", "--effort", "turbo", "diagnose"], { cwd: repo, env: buildEnv(binDir) });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Invalid --effort/i);
});

test("task --write enables the gemini write mode flag", () => {
  const { repo, binDir } = setupRepo("task");
  commit(repo, "README.md", "hello\n");

  const result = run("node", [SCRIPT, "task", "--write", "apply the fix"], { cwd: repo, env: buildEnv(binDir) });
  assert.equal(result.status, 0, result.stderr);

  assert.ok(readFakeState(binDir).lastInvocation.args.includes("--yolo"));
});

test("task --resume-last continues the latest completed thread", () => {
  const { repo, binDir } = setupRepo("task");
  commit(repo, "README.md", "hello\n");

  const first = run("node", [SCRIPT, "task", "first task"], { cwd: repo, env: buildEnv(binDir) });
  assert.equal(first.status, 0, first.stderr);

  const resumed = run("node", [SCRIPT, "task", "--resume-last", "keep going"], { cwd: repo, env: buildEnv(binDir) });
  assert.equal(resumed.status, 0, resumed.stderr);
  assert.match(resumed.stdout, /Resumed the prior run\./);
  assert.ok(readFakeState(binDir).lastInvocation.args.includes("--resume"));
});

test("task --resume-last fails when there is no prior thread", () => {
  const { repo, binDir } = setupRepo("task");
  commit(repo, "README.md", "hello\n");

  const result = run("node", [SCRIPT, "task", "--resume-last", "keep going"], { cwd: repo, env: buildEnv(binDir) });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /No previous Gemini task thread found/i);
});

test("task surfaces a failed gemini turn as a non-zero exit", () => {
  const { repo, binDir } = setupRepo("task-fail");
  commit(repo, "README.md", "hello\n");

  const result = run("node", [SCRIPT, "task", "do something"], { cwd: repo, env: buildEnv(binDir) });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /simulated failure/i);

  const state = JSON.parse(fs.readFileSync(path.join(resolveStateDir(repo), "state.json"), "utf8"));
  assert.equal(state.jobs[0].status, "failed");
});

test("task rejects an unknown engine", () => {
  const { repo, binDir } = setupRepo("task");
  commit(repo, "README.md", "hello\n");

  const result = run("node", [SCRIPT, "task", "--engine", "bogus", "do something"], { cwd: repo, env: buildEnv(binDir) });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown engine/i);
});

test("task --background enqueues a detached worker and reports completion", async () => {
  const { repo, binDir } = setupRepo("task");
  commit(repo, "README.md", "hello\n");

  const launched = run("node", [SCRIPT, "task", "--background", "--json", "investigate the failing test"], {
    cwd: repo,
    env: buildEnv(binDir)
  });
  assert.equal(launched.status, 0, launched.stderr);
  const launchPayload = JSON.parse(launched.stdout);
  assert.equal(launchPayload.status, "queued");
  assert.match(launchPayload.jobId, /^task-/);

  const waited = run(
    "node",
    [SCRIPT, "status", launchPayload.jobId, "--wait", "--timeout-ms", "15000", "--json"],
    { cwd: repo, env: buildEnv(binDir) }
  );
  assert.equal(waited.status, 0, waited.stderr);
  const waitedPayload = JSON.parse(waited.stdout);
  assert.equal(waitedPayload.job.id, launchPayload.jobId);
  assert.equal(waitedPayload.job.status, "completed");

  const result = run("node", [SCRIPT, "result", launchPayload.jobId], { cwd: repo, env: buildEnv(binDir) });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Handled the requested task/);
});

// ---------------------------------------------------------------------------
// status / result / cancel / task-resume-candidate (seeded state)
// ---------------------------------------------------------------------------

test("status lists running and finished jobs for the current session", () => {
  const workspace = makeTempDir();
  seedState(workspace, [
    {
      id: "task-live",
      status: "running",
      jobClass: "task",
      kindLabel: "rescue",
      title: "Gemini Task",
      summary: "Investigate flaky test",
      createdAt: "2026-03-18T15:30:00.000Z",
      updatedAt: "2026-03-18T15:30:02.000Z"
    },
    {
      id: "review-done",
      status: "completed",
      jobClass: "review",
      kindLabel: "review",
      title: "Gemini Review",
      summary: "Review working tree",
      threadId: "thr_done",
      createdAt: "2026-03-18T15:10:00.000Z",
      startedAt: "2026-03-18T15:10:05.000Z",
      completedAt: "2026-03-18T15:11:10.000Z",
      updatedAt: "2026-03-18T15:11:10.000Z"
    }
  ]);

  const result = run("node", [SCRIPT, "status", "--json"], { cwd: workspace, env: envWithoutSession() });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.deepEqual(payload.running.map((job) => job.id), ["task-live"]);
  assert.equal(payload.latestFinished.id, "review-done");
});

test("status without a job id only shows jobs from the current Claude session", () => {
  const workspace = makeTempDir();
  seedState(workspace, [
    {
      id: "task-current",
      status: "running",
      jobClass: "task",
      kindLabel: "rescue",
      title: "Gemini Task",
      sessionId: "sess-current",
      summary: "Current session task",
      createdAt: "2026-03-18T15:30:00.000Z",
      updatedAt: "2026-03-18T15:30:00.000Z"
    },
    {
      id: "task-other",
      status: "running",
      jobClass: "task",
      kindLabel: "rescue",
      title: "Gemini Task",
      sessionId: "sess-other",
      summary: "Other session task",
      createdAt: "2026-03-18T15:31:00.000Z",
      updatedAt: "2026-03-18T15:31:00.000Z"
    }
  ]);

  const result = run("node", [SCRIPT, "status", "--json"], {
    cwd: workspace,
    env: { ...process.env, GEMINI_COMPANION_SESSION_ID: "sess-current" }
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).running.map((job) => job.id), ["task-current"]);
});

test("status --wait requires a job id", () => {
  const workspace = makeTempDir();
  seedState(workspace, []);

  const result = run("node", [SCRIPT, "status", "--wait"], { cwd: workspace });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requires a job id/i);
});

test("status --wait times out cleanly when a job stays active", () => {
  const workspace = makeTempDir();
  seedState(workspace, [
    {
      id: "task-live",
      status: "running",
      jobClass: "task",
      kindLabel: "rescue",
      title: "Gemini Task",
      summary: "Investigate flaky test",
      createdAt: "2026-03-18T15:30:00.000Z",
      startedAt: "2026-03-18T15:30:01.000Z",
      updatedAt: "2026-03-18T15:30:02.000Z"
    }
  ]);

  const result = run("node", [SCRIPT, "status", "task-live", "--wait", "--timeout-ms", "25", "--json"], {
    cwd: workspace
  });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.job.id, "task-live");
  assert.equal(payload.job.status, "running");
  assert.equal(payload.waitTimedOut, true);
});

test("result returns the stored output and resume hint for the latest finished job", () => {
  const workspace = makeTempDir();
  seedState(workspace, [
    {
      id: "task-finished",
      status: "completed",
      jobClass: "task",
      kindLabel: "rescue",
      title: "Gemini Task",
      threadId: "thr_finished",
      summary: "Investigate flaky test",
      createdAt: "2026-03-18T15:00:00.000Z",
      updatedAt: "2026-03-18T15:01:00.000Z"
    }
  ]);
  writeJobFile(workspace, "task-finished", {
    id: "task-finished",
    status: "completed",
    title: "Gemini Task",
    threadId: "thr_finished",
    result: { rawOutput: "Handled the requested task." }
  });

  const result = run("node", [SCRIPT, "result"], { cwd: workspace, env: envWithoutSession() });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Handled the requested task\./);
  assert.match(result.stdout, /Gemini session ID: thr_finished/);
  assert.match(result.stdout, /Resume in Gemini: gemini resume thr_finished/);
});

test("cancel stops an active job and marks it cancelled", async (t) => {
  const workspace = makeTempDir();

  const sleeper = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    cwd: workspace,
    detached: true,
    stdio: "ignore"
  });
  sleeper.unref();
  t.after(() => {
    try {
      process.kill(sleeper.pid);
    } catch {
      // already gone
    }
  });

  seedState(workspace, [
    {
      id: "task-live",
      status: "running",
      jobClass: "task",
      kindLabel: "rescue",
      title: "Gemini Task",
      summary: "Investigate flaky test",
      pid: sleeper.pid,
      createdAt: "2026-03-18T15:30:00.000Z",
      startedAt: "2026-03-18T15:30:01.000Z",
      updatedAt: "2026-03-18T15:30:02.000Z"
    }
  ]);
  writeJobFile(workspace, "task-live", {
    id: "task-live",
    status: "running",
    title: "Gemini Task",
    pid: sleeper.pid
  });

  const result = run("node", [SCRIPT, "cancel", "task-live", "--json"], { cwd: workspace });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, "cancelled");

  const state = JSON.parse(fs.readFileSync(path.join(resolveStateDir(workspace), "state.json"), "utf8"));
  assert.equal(state.jobs.find((job) => job.id === "task-live").status, "cancelled");
});

test("task-resume-candidate returns the latest completed task thread", () => {
  const workspace = makeTempDir();
  seedState(workspace, [
    {
      id: "task-recent",
      status: "completed",
      jobClass: "task",
      kindLabel: "rescue",
      title: "Gemini Task",
      threadId: "thr_recent",
      summary: "Investigate flaky test",
      createdAt: "2026-03-18T15:30:00.000Z",
      updatedAt: "2026-03-18T15:31:00.000Z"
    }
  ]);

  const result = run("node", [SCRIPT, "task-resume-candidate", "--json"], { cwd: workspace });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.found, true);
  assert.equal(payload.threadId, "thr_recent");
});

test("task-resume-candidate reports nothing to resume on an empty workspace", () => {
  const workspace = makeTempDir();
  seedState(workspace, []);

  const result = run("node", [SCRIPT, "task-resume-candidate", "--json"], { cwd: workspace });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).found, false);
});

test("task-resume-candidate is blocked while a task is still running", () => {
  const workspace = makeTempDir();
  seedState(workspace, [
    {
      id: "task-running",
      status: "running",
      jobClass: "task",
      kindLabel: "rescue",
      title: "Gemini Task",
      summary: "Investigate flaky test",
      createdAt: "2026-03-18T15:30:00.000Z",
      updatedAt: "2026-03-18T15:30:00.000Z"
    }
  ]);

  const result = run("node", [SCRIPT, "task-resume-candidate", "--json"], { cwd: workspace });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.found, false);
  assert.equal(payload.blocked, true);
});
