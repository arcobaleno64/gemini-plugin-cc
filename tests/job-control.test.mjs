import { test } from "node:test";
import assert from "node:assert/strict";

import { makeTempDir } from "./helpers.mjs";
import { setConfig } from "../plugins/gemini/scripts/lib/state.mjs";
import { buildStatusSnapshot } from "../plugins/gemini/scripts/lib/job-control.mjs";

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
