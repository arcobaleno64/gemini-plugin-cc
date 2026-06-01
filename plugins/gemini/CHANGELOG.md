# Changelog

## Unreleased — parity audit

### Breaking
- **`/gemini:setup` readiness now requires authentication.** `ready` is `true` only when Node **and** the Gemini CLI are present **and** OAuth is valid. An installed-but-unauthenticated Gemini now reports `ready: false` (previously `true`). New JSON fields: `readyState` (`ready` | `partial` | `not-ready`), `geminiReady`, `agyFallbackAvailable`.

### Fixed (P0)
- **Review target was discarded.** `/gemini:review` and `/gemini:adversarial-review` now honour `--base <ref>` and `--scope <auto|working-tree|branch>`; `executeReviewRun` previously re-resolved the target with empty options, silently dropping the user's selection.
- **Contradictory verbatim contract.** Removed the "STOP and ask which issues to fix" instruction from `review.md` / `adversarial-review.md`, which conflicted with the "return stdout verbatim" rule.
- **AGY install was over-eager.** `setup.md` now installs Gemini CLI as the primary engine and only prompts for AGY when the user passes `--engine agy`. Auth guidance is unified on running `gemini` (there is no `gemini login` subcommand).

### Added (P1)
- **Claude session job filtering.** `/gemini:status --all` now crosses sessions (default stays scoped to the current Claude session); resume-candidate and active-task checks respect the session boundary.
- **Single source of truth for models.** New `scripts/lib/model-map.mjs` holds aliases + effort tiers + provenance (`lastVerified`, `source`, preview flags); the README table is verified against it.
- **Contract verification.** New `scripts/verify-contracts.mjs` (`npm run verify-contracts`) and ported `scripts/bump-version.mjs` (`npm run check-version` / `bump-version`). CI now runs `npm test`, `check-version`, and `verify-contracts`.
- `getSessionRuntimeStatus` now returns a `label`/`mode` so setup/status no longer render `session runtime: undefined`.

### Tests
- 90 → 117 tests. New coverage: `--base`/`--scope` divergence, setup readiness (auth missing/expired/AGY-fallback), session filtering, stdin prompt safety (metacharacter matrix), stderr-does-not-pollute-JSON, model-map/README consistency, and contract/version verification.

### Documentation
- README (EN + zh-TW): Compatibility Matrix, Codex app server vs Gemini CLI adapter, expanded Security Notes, Setup & Auth Troubleshooting, Model Alias Notes, and Upstream Attribution.

## 0.5.0 — 2026-05-27

### Added
- `/gemini:review` — standard (non-adversarial) code review; finds real bugs, missing error handling, and incomplete paths.
- `prompts/review.md` — pragmatic reviewer prompt template (same JSON output schema as adversarial-review).
- Review Gate fully implemented: `stop-review-gate-hook.mjs` now runs `adversarial-review` before session end when any `--write` task completed; blocks with finding summary if verdict is `needs-attention`.
- `/gemini:setup --enable-review-gate` / `--disable-review-gate` flags to toggle the gate without editing config JSON.
- `setup` output now includes `review gate: enabled/disabled` status.

### Fixed
- `buildSetupReport` now reads `reviewGateEnabled` from config and passes it to `renderSetupReport` — previously always rendered as "disabled".
- `commands/result.md` now mentions `/gemini:review --wait` in follow-up suggestions.

### Documentation
- README: `/gemini:rescue` flags table now includes `--fresh` (force new session).
- README: `/gemini:result` section now explains the `Resume in Gemini: gemini resume <session-id>` output.
- README: new Review Gate section with enable/disable instructions.

## 0.4.0 — 2026-05-27

### Added
- Gemini 3.x model aliases: `flash`/`flash3` → `gemini-3.5-flash` (GA), `pro`/`pro3` → `gemini-3.1-pro`, `lite3` → `gemini-3.1-flash-lite`.
- Backward-compat aliases `flash25` → `gemini-2.5-flash`, `pro25` → `gemini-2.5-pro`.
- `effort` mapping updated: `low`/`medium` → `gemini-3.5-flash`, `high`/`xhigh` → `gemini-3.1-pro`.
- `task-resume-candidate` now guards against active/queued tasks (mirrors `resolveLatestTrackedTaskThread` guard).

### Fixed
- `renderSetupReport` was reading `report.auth.detail` (field does not exist); corrected to `report.geminiAuth.detail` and `report.agyAuth.detail`.
- `verdict ?? outcome` alias in `validateReviewResultShape` / `normalizeReviewResultData` now uses `||` — `??` failed to fall through when `verdict` was an empty string.
- `detectEngine` was reading `status.version` (field does not exist on `binaryAvailable` return); corrected to `status.detail`.
- `detectEngine` now throws on unknown engine values instead of silently falling back to auto.
- Removed `preview` alias that mapped to the non-existent `gemini-3-pro-preview`.

## 0.3.0 — 2026-05-27

### Added
- Marketplace installation support: `/plugin marketplace add arcobaleno64/gemini-plugin-cc`
- Session ID (`threadId`) extraction from Gemini CLI JSON envelope in task runs — enables `--resume-last` to work correctly.
- `GEMINI_HOME` environment variable support for non-standard credential paths.

### Fixed
- `appendReasoningSection` now accepts both `string` (from `gemini.mjs`) and `Array` — reasoning output was silently dropped before this fix.
- `runCommand` null `status` now resolves to `1` when the process was killed by a signal or failed to spawn, instead of masking failures as exit `0`.
- `marketplace.json` and `plugin.json` updated with correct owner (`arcobaleno64`), repository URL, and version `0.3.0`.
- README installation section updated with proper marketplace workflow.

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
