# Changelog

## 0.2.0 — 2026-05-27

### Fixed
- **P0 Windows ENOENT**: Replaced custom `runSpawn` (`shell: false`) with `runCommand` from `process.mjs` (`shell: true` on Windows), resolving failure to execute `.cmd` wrappers installed by npm.
- **P0 Shell injection**: Gemini CLI prompts are now delivered via stdin (`input` option) instead of the `-p` CLI argument, eliminating shell metacharacter injection on Windows (`shell: true` path).
- **P0 AGY pipe output**: `auto` engine order swapped — `gemini` CLI is now preferred; `agy` is fallback. AGY cannot write to a pipe in non-interactive mode and silently returned empty output as the former default.
- **P1 `task-resume-candidate` missing**: Added `handleTaskResumeCandidate` handler and `task-resume-candidate` subcommand to `gemini-companion.mjs`; previously caused `Unknown subcommand` errors from `gemini:rescue`.
- **P2 OAuth token expiry**: `getGeminiLoginStatus()` now parses `oauth_creds.json` and reports expired tokens before any invocation attempt, rather than only checking for file existence.

### Added
- `runCommand` now accepts `maxBuffer` and `timeout` options (forwarded to `spawnSync`).
- `buildCliArgs` accepts `useStdin` flag; when set for the `gemini` engine, the prompt is omitted from the args array and must be supplied via `input`.
- `README.md` and `README.zh-TW.md` with full command reference, security notes, and architecture diagram.
- `.gitignore` excluding `.omc/` runtime state directory.

## 0.1.0 — 2026-05-26

### Added
- `gemini-companion.mjs` runtime with AGY auto-detect and Gemini CLI fallback
- `session-lifecycle-hook.mjs` for `GEMINI_COMPANION_SESSION_ID` injection on SessionStart/End
- `stop-review-gate-hook.mjs` stub (opt-in via `stopReviewGateEnabled` config)
- Slash commands: `/gemini:setup`, `/gemini:rescue`, `/gemini:result`, `/gemini:status`, `/gemini:cancel`, `/gemini:adversarial-review`
- Skills: `gemini-cli-runtime`, `gemini-prompting`, `gemini-result-handling`
- Agent: `gemini-rescue` — thin forwarder to the companion task runtime
- `hooks/hooks.json` — SessionStart, SessionEnd, Stop hooks
- Engine routing: AGY preferred, Gemini CLI fallback; `--engine agy|gemini` to force
- Model aliases: `flash` → gemini-2.5-flash, `pro` → gemini-2.5-pro, `lite` → gemini-2.5-flash-lite
