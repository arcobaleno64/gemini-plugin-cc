import test from "node:test";
import assert from "node:assert/strict";
import process from "node:process";

import {
  terminateProcessTree,
  binaryAvailable,
  formatCommandFailure
} from "../plugins/gemini/scripts/lib/process.mjs";

test("terminateProcessTree uses taskkill on Windows", () => {
  let captured = null;
  const outcome = terminateProcessTree(1234, {
    platform: "win32",
    runCommandImpl(command, args) {
      captured = { command, args };
      return { command, args, status: 0, signal: null, stdout: "", stderr: "", error: null };
    },
    killImpl() {
      throw new Error("kill fallback should not run");
    }
  });

  assert.deepEqual(captured, { command: "taskkill", args: ["/PID", "1234", "/T", "/F"] });
  assert.equal(outcome.delivered, true);
  assert.equal(outcome.method, "taskkill");
});

test("terminateProcessTree treats a missing Windows process as already stopped", () => {
  const outcome = terminateProcessTree(1234, {
    platform: "win32",
    runCommandImpl(command, args) {
      return {
        command,
        args,
        status: 128,
        signal: null,
        stdout: 'ERROR: The process "1234" not found.',
        stderr: "",
        error: null
      };
    }
  });

  assert.equal(outcome.attempted, true);
  assert.equal(outcome.delivered, false);
  assert.equal(outcome.method, "taskkill");
});

test("terminateProcessTree skips a non-finite pid", () => {
  const outcome = terminateProcessTree(Number.NaN);
  assert.equal(outcome.attempted, false);
  assert.equal(outcome.delivered, false);
  assert.equal(outcome.method, null);
});

test("terminateProcessTree signals the process group on POSIX", () => {
  const signals = [];
  const outcome = terminateProcessTree(4321, {
    platform: "linux",
    killImpl(pid, signal) {
      signals.push({ pid, signal });
    }
  });
  assert.deepEqual(signals, [{ pid: -4321, signal: "SIGTERM" }]);
  assert.equal(outcome.method, "process-group");
  assert.equal(outcome.delivered, true);
});

test("binaryAvailable detects an available binary", () => {
  // Use a bare command resolved via PATH (how the plugin invokes gemini/agy);
  // an absolute path with spaces would break under runCommand's win32 shell:true.
  const result = binaryAvailable("git", ["--version"]);
  assert.equal(result.available, true);
  assert.match(result.detail, /\d+\.\d+/);
});

test("binaryAvailable reports an unavailable binary", () => {
  const result = binaryAvailable("definitely-not-a-real-binary-xyz-123", ["--version"]);
  assert.equal(result.available, false);
});

test("formatCommandFailure formats exit-code and signal failures", () => {
  assert.equal(
    formatCommandFailure({ command: "git", args: ["status"], status: 1, signal: null, stderr: "boom", stdout: "" }),
    "git status: exit=1: boom"
  );
  assert.equal(
    formatCommandFailure({ command: "node", args: [], status: null, signal: "SIGKILL", stderr: "", stdout: "" }),
    "node: signal=SIGKILL"
  );
});
