import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { writeExecutable } from "./helpers.mjs";

const FAKE_SOURCE = fileURLToPath(new URL("./fixtures/fake-gemini.cjs", import.meta.url));

// Install a fake gemini CLI into binDir and mark binDir as an authenticated
// gemini home. `scenario` selects the canned response (see fixtures/fake-gemini.cjs).
export function installFakeGemini(binDir, scenario = "task") {
  const target = path.join(binDir, "gemini");
  fs.copyFileSync(FAKE_SOURCE, target);
  if (process.platform === "win32") {
    // npm global bins resolve through a .cmd shim under shell:true on Windows.
    fs.writeFileSync(path.join(binDir, "gemini.cmd"), `@echo off\r\nnode "%~dp0gemini" %*\r\n`, "utf8");
  } else {
    fs.chmodSync(target, 0o755);
  }

  fs.writeFileSync(
    path.join(binDir, "fake-gemini-config.json"),
    JSON.stringify({ scenario }, null, 2),
    "utf8"
  );

  writeGeminiCredentials(binDir);
}

// Shadow any real gemini/agy on PATH with wrappers that fail their --version
// probe, so getGeminiAvailability/getAgyAvailability report "not available".
export function installUnavailableEngines(binDir) {
  for (const name of ["gemini", "agy"]) {
    if (process.platform === "win32") {
      fs.writeFileSync(path.join(binDir, `${name}.cmd`), `@echo off\r\nexit /b 1\r\n`, "utf8");
    } else {
      writeExecutable(path.join(binDir, name), "#!/bin/sh\nexit 1\n");
    }
  }
}

export function writeGeminiCredentials(binDir) {
  const geminiHome = path.join(binDir, "gemini-home");
  fs.mkdirSync(geminiHome, { recursive: true });
  fs.writeFileSync(
    path.join(geminiHome, "oauth_creds.json"),
    JSON.stringify({ access_token: "fake", expiry_date: Date.now() + 86_400_000 }, null, 2),
    "utf8"
  );
  return geminiHome;
}

export function removeGeminiCredentials(binDir) {
  fs.rmSync(path.join(binDir, "gemini-home", "oauth_creds.json"), { force: true });
}

// Write OAuth credentials whose expiry_date is already in the past so
// getGeminiLoginStatus() reports loggedIn:false (expired token).
export function writeExpiredGeminiCredentials(binDir) {
  const geminiHome = path.join(binDir, "gemini-home");
  fs.mkdirSync(geminiHome, { recursive: true });
  fs.writeFileSync(
    path.join(geminiHome, "oauth_creds.json"),
    JSON.stringify({ access_token: "fake", expiry_date: Date.now() - 3_600_000 }, null, 2),
    "utf8"
  );
  return geminiHome;
}

// Install a fake `agy` binary that succeeds on its --version probe so
// getAgyAvailability() reports available:true. Does not install gemini.
export function installFakeAgy(binDir) {
  if (process.platform === "win32") {
    fs.writeFileSync(path.join(binDir, "agy.cmd"), `@echo off\r\necho agy 1.0.0\r\nexit /b 0\r\n`, "utf8");
  } else {
    writeExecutable(path.join(binDir, "agy"), "#!/bin/sh\necho 'agy 1.0.0'\nexit 0\n");
  }
}

// Shadow only gemini with a wrapper that fails its --version probe, leaving any
// installed agy untouched. Pair with installFakeAgy for AGY-fallback assertions.
export function installUnavailableGemini(binDir) {
  if (process.platform === "win32") {
    fs.writeFileSync(path.join(binDir, "gemini.cmd"), `@echo off\r\nexit /b 1\r\n`, "utf8");
  } else {
    writeExecutable(path.join(binDir, "gemini"), "#!/bin/sh\nexit 1\n");
  }
}

export function buildEnv(binDir) {
  const sep = process.platform === "win32" ? ";" : ":";
  return {
    ...process.env,
    PATH: `${binDir}${sep}${process.env.PATH}`,
    GEMINI_ENGINE: "gemini",
    GEMINI_HOME: path.join(binDir, "gemini-home")
  };
}

// Like buildEnv but does not force an engine and points GEMINI_HOME at an empty
// directory; pair with installUnavailableEngines for "not ready" assertions.
export function buildEnvUnavailable(binDir) {
  const sep = process.platform === "win32" ? ";" : ":";
  return {
    ...process.env,
    PATH: `${binDir}${sep}${process.env.PATH}`,
    GEMINI_HOME: path.join(binDir, "gemini-home")
  };
}

export function readFakeState(binDir) {
  return JSON.parse(fs.readFileSync(path.join(binDir, "fake-gemini-state.json"), "utf8"));
}
