import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

// Windows shell:true builds one cmd.exe command-line string by naively
// concatenating argv with spaces (Node's own DEP0190 warning: "arguments
// are not escaped, only concatenated") -- so an argv element (or the
// binary itself) containing a space or a shell metacharacter must be
// quoted here ourselves, or cmd.exe re-splits/misinterprets it before the
// real binary ever sees it. NOT a complete cmd.exe escaper (misses %, !,
// backtick, comma, semicolon and doesn't handle embedded quotes per cmd's
// real two-phase parse) -- safe here because every argv element is a
// short fixed constant, a resolved binary path, or a validated model id;
// prompts travel via stdin for gemini and are length/NUL-validated before
// reaching agy's positional argv.
const WINDOWS_SHELL_UNSAFE = /[\s|<>&()^"]/;
function quoteForWindowsShell(arg) {
  if (typeof arg !== "string" || !WINDOWS_SHELL_UNSAFE.test(arg)) return arg;
  return `"${arg.replace(/"/g, '\\"')}"`;
}

export function runCommand(command, args = [], options = {}) {
  const shell = options.shell ?? (process.platform === "win32" && !path.isAbsolute(command));
  const safeCommand = shell ? quoteForWindowsShell(command) : command;
  const safeArgs = shell ? args.map(quoteForWindowsShell) : args;
  const result = spawnSync(safeCommand, safeArgs, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    input: options.input,
    stdio: options.stdio ?? "pipe",
    // Absolute paths are spawned directly (shell:false) so arguments are passed
    // literally and never re-parsed by the shell. Bare command names still use the
    // shell on Windows to resolve .cmd/.ps1 wrappers (npm global bins).
    shell,
    windowsHide: true,
    ...(options.maxBuffer != null && { maxBuffer: options.maxBuffer }),
    ...(options.timeout != null && { timeout: options.timeout }),
  });

  return {
    command,
    args,
    // null status means killed by signal or failed to spawn — treat as failure
    status: result.status ?? (result.signal ? 1 : (result.error ? 1 : 0)),
    signal: result.signal ?? null,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? null
  };
}

export function runCommandChecked(command, args = [], options = {}) {
  const result = runCommand(command, args, options);
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(formatCommandFailure(result));
  }
  return result;
}

export function binaryAvailable(command, versionArgs = ["--version"], options = {}) {
  const result = runCommand(command, versionArgs, options);
  if (result.error && /** @type {NodeJS.ErrnoException} */ (result.error).code === "ENOENT") {
    return { available: false, detail: "not found" };
  }
  if (result.error) {
    return { available: false, detail: result.error.message };
  }
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`;
    return { available: false, detail };
  }
  return { available: true, detail: result.stdout.trim() || result.stderr.trim() || "ok" };
}

export function resolveBinaryPath(command) {
  if (path.isAbsolute(command)) {
    return command;
  }
  const finder = process.platform === "win32" ? "where" : "which";
  const result = runCommand(finder, [command]);
  if (result.status !== 0) {
    return null;
  }
  const first = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)[0];
  return first || null;
}

function looksLikeMissingProcessMessage(text) {
  return /not found|no running instance|cannot find|does not exist|no such process/i.test(text);
}

export function terminateProcessTree(pid, options = {}) {
  if (!Number.isFinite(pid)) {
    return { attempted: false, delivered: false, method: null };
  }

  const platform = options.platform ?? process.platform;
  const runCommandImpl = options.runCommandImpl ?? runCommand;
  const killImpl = options.killImpl ?? process.kill.bind(process);

  if (platform === "win32") {
    const result = runCommandImpl("taskkill", ["/PID", String(pid), "/T", "/F"], {
      cwd: options.cwd,
      env: options.env
    });

    if (!result.error && result.status === 0) {
      return { attempted: true, delivered: true, method: "taskkill", result };
    }

    const combinedOutput = `${result.stderr}\n${result.stdout}`.trim();
    if (!result.error && looksLikeMissingProcessMessage(combinedOutput)) {
      return { attempted: true, delivered: false, method: "taskkill", result };
    }

    if (result.error?.code === "ENOENT") {
      try {
        killImpl(pid);
        return { attempted: true, delivered: true, method: "kill" };
      } catch (error) {
        if (error?.code === "ESRCH") {
          return { attempted: true, delivered: false, method: "kill" };
        }
        throw error;
      }
    }

    if (result.error) {
      throw result.error;
    }

    throw new Error(formatCommandFailure(result));
  }

  try {
    killImpl(-pid, "SIGTERM");
    return { attempted: true, delivered: true, method: "process-group" };
  } catch (error) {
    if (error?.code !== "ESRCH") {
      try {
        killImpl(pid, "SIGTERM");
        return { attempted: true, delivered: true, method: "process" };
      } catch (innerError) {
        if (innerError?.code === "ESRCH") {
          return { attempted: true, delivered: false, method: "process" };
        }
        throw innerError;
      }
    }

    return { attempted: true, delivered: false, method: "process-group" };
  }
}

export function formatCommandFailure(result) {
  const parts = [`${result.command} ${result.args.join(" ")}`.trim()];
  if (result.signal) {
    parts.push(`signal=${result.signal}`);
  } else {
    parts.push(`exit=${result.status}`);
  }
  const stderr = (result.stderr || "").trim();
  const stdout = (result.stdout || "").trim();
  if (stderr) {
    parts.push(stderr);
  } else if (stdout) {
    parts.push(stdout);
  }
  return parts.join(": ");
}
