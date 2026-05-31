import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { makeTempDir } from "./helpers.mjs";
import {
  resolveJobFile,
  resolveJobLogFile,
  resolveStateDir,
  resolveStateFile,
  saveState,
  generateJobId
} from "../plugins/gemini/scripts/lib/state.mjs";

test("resolveStateDir uses a temp-backed per-workspace directory", () => {
  const workspace = makeTempDir();
  const stateDir = resolveStateDir(workspace);

  assert.equal(stateDir.startsWith(os.tmpdir()), true);
  assert.match(path.basename(stateDir), /.+-[a-f0-9]{16}$/);
});

test("resolveStateDir honors GEMINI_COMPANION_DATA when provided", () => {
  const workspace = makeTempDir();
  const pluginDataDir = makeTempDir();
  const previous = process.env.GEMINI_COMPANION_DATA;
  process.env.GEMINI_COMPANION_DATA = pluginDataDir;

  try {
    const stateDir = resolveStateDir(workspace);
    assert.equal(stateDir.startsWith(path.join(pluginDataDir, "state")), true);
    assert.match(path.basename(stateDir), /.+-[a-f0-9]{16}$/);
  } finally {
    if (previous == null) {
      delete process.env.GEMINI_COMPANION_DATA;
    } else {
      process.env.GEMINI_COMPANION_DATA = previous;
    }
  }
});

test("saveState prunes dropped job artifacts when indexed jobs exceed the cap", () => {
  const workspace = makeTempDir();
  const stateFile = resolveStateFile(workspace);
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });

  const jobs = Array.from({ length: 51 }, (_, index) => {
    const jobId = `job-${index}`;
    const updatedAt = new Date(Date.UTC(2026, 0, 1, 0, index, 0)).toISOString();
    const logFile = resolveJobLogFile(workspace, jobId);
    const jobFile = resolveJobFile(workspace, jobId);
    fs.writeFileSync(logFile, `log ${jobId}\n`, "utf8");
    fs.writeFileSync(jobFile, JSON.stringify({ id: jobId, status: "completed" }, null, 2), "utf8");
    return { id: jobId, status: "completed", logFile, updatedAt, createdAt: updatedAt };
  });

  fs.writeFileSync(stateFile, `${JSON.stringify({ version: 1, config: {}, jobs }, null, 2)}\n`, "utf8");

  saveState(workspace, { version: 1, config: {}, jobs });

  const jobsDir = path.dirname(resolveJobFile(workspace, "job-0"));
  const savedState = JSON.parse(fs.readFileSync(stateFile, "utf8"));

  assert.equal(savedState.jobs.length, 50);
  assert.deepEqual(
    savedState.jobs.map((job) => job.id),
    Array.from({ length: 50 }, (_, index) => `job-${50 - index}`)
  );
  assert.equal(fs.existsSync(resolveJobFile(workspace, "job-50")), true);
  assert.equal(fs.existsSync(resolveJobFile(workspace, "job-0")), false);
  assert.equal(fs.existsSync(resolveJobLogFile(workspace, "job-0")), false);
  assert.deepEqual(
    fs.readdirSync(jobsDir).sort(),
    Array.from({ length: 50 }, (_, index) => `job-${index + 1}`)
      .flatMap((jobId) => [`${jobId}.json`, `${jobId}.log`])
      .sort()
  );
});

test("generateJobId produces a prefixed id with a crypto-random suffix", () => {
  const id = generateJobId("task");
  assert.match(id, /^task-[0-9a-z]+-[0-9a-f]{10}$/);
  assert.notEqual(generateJobId("task"), generateJobId("task"));
});
