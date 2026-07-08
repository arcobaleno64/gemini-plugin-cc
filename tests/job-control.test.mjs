import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { makeTempDir } from "./helpers.mjs";
import { readJobFile, resolveJobFile, saveState, setConfig, writeJobFile } from "../plugins/gemini/scripts/lib/state.mjs";
import { buildStatusSnapshot } from "../plugins/gemini/scripts/lib/job-control.mjs";
import { runTrackedJob } from "../plugins/gemini/scripts/lib/tracked-jobs.mjs";

test("buildStatusSnapshot surfaces the stop-review-gate flag", () => {
  const cwd = makeTempDir();
  setConfig(cwd, "stopReviewGateEnabled", true);
  const snapshot = buildStatusSnapshot(cwd);
  assert.equal(snapshot.needsReview, true);
});

test("buildStatusSnapshot reports an empty job list for a fresh workspace", () => {
  const cwd = makeTempDir();
  const snapshot = buildStatusSnapshot(cwd);
  assert.equal(snapshot.needsReview, false);
  assert.deepEqual(snapshot.running, []);
  assert.equal(snapshot.latestFinished, null);
});

test("buildStatusSnapshot marks unreadable active job files as failed", () => {
  const cwd = makeTempDir();
  saveState(cwd, {
    version: 1,
    config: {},
    jobs: [
      {
        id: "task-corrupt",
        status: "running",
        pid: 123,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    ]
  });
  fs.writeFileSync(resolveJobFile(cwd, "task-corrupt"), "{ not-json", "utf8");

  const snapshot = buildStatusSnapshot(cwd, { isPidAlive: () => true, all: true });

  assert.deepEqual(snapshot.running, []);
  assert.equal(snapshot.latestFinished.id, "task-corrupt");
  assert.equal(snapshot.latestFinished.status, "failed");
  assert.equal(snapshot.latestFinished.failure.category, "invalid-json");
});

test("buildStatusSnapshot marks active jobs failed when their pid is gone", () => {
  const cwd = makeTempDir();
  writeJobFile(cwd, "task-stale", { id: "task-stale", status: "running", pid: 123 });
  saveState(cwd, {
    version: 1,
    config: {},
    jobs: [
      {
        id: "task-stale",
        status: "running",
        pid: 123,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    ]
  });

  const snapshot = buildStatusSnapshot(cwd, { isPidAlive: () => false, all: true });

  assert.deepEqual(snapshot.running, []);
  assert.equal(snapshot.latestFinished.id, "task-stale");
  assert.equal(snapshot.latestFinished.status, "failed");
  assert.equal(snapshot.latestFinished.failure.category, "stale-job");
  assert.match(snapshot.latestFinished.failure.nextStep, /retry|result/i);
});

test("runTrackedJob persists structured failure metadata when the runner throws", async () => {
  const cwd = makeTempDir();

  await assert.rejects(
    runTrackedJob(
      {
        id: "task-failed",
        title: "Gemini Task",
        workspaceRoot: cwd,
        jobClass: "task"
      },
      () => {
        throw new Error("429 Too Many Requests: rate limit exceeded");
      }
    )
  );

  const snapshot = buildStatusSnapshot(cwd, { all: true });
  const stored = readJobFile(resolveJobFile(cwd, "task-failed"));

  assert.equal(snapshot.latestFinished.failure.category, "rate-limit");
  assert.equal(snapshot.latestFinished.failure.retryable, true);
  assert.equal(stored.failure.category, "rate-limit");
});
