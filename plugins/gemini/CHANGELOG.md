# Changelog

## Unreleased — parity-audit follow-up fixes

### Fixed (P0)
- **`/gemini:rescue` resume prompt never fired.** `handleTaskResumeCandidate` emitted `found`, but `commands/rescue.md` keys the "continue current thread?" prompt off `available` (as upstream codex does). The companion now emits `available` in all branches; a contract guard test asserts `available` is present and the legacy `found` is gone.

### Added (P1)
- **Persistent background reviews.** `/gemini:review --background` and `/gemini:adversarial-review --background` now enqueue a detached `review-worker` (mirroring `task-worker`) instead of relying on Claude-layer `run_in_background`, so a background review result survives an interrupted session and is retrievable via `/gemini:status` / `/gemini:result`. New `review-worker` subcommand; `enqueueBackgroundJob`/`spawnDetachedWorker`/`runStoredJobWorker` generalize the shared machinery.

### Fixed (P1)
- **Stop-review-gate is no longer silent on skip.** On review failure / Gemini-unavailable the gate still fails open, but now surfaces a `systemMessage` + stderr warning so the user knows the gate was skipped. It also reviews `--scope working-tree` explicitly (where `--write` task edits live) instead of relying on auto scope.
- Removed dead `renderNativeReviewResult` from `lib/render.mjs`.

### Fixed (P2)
- **Standard `/gemini:review` mislabeled its progress as "adversarial review".** `runGeminiReview` is now mode-aware (`isAdversarial`).
- **CLI noise leaked into the "Reasoning:" output.** `extractReasoningSummary` now drops DEP0190 deprecation, 256-color, and ripgrep-fallback lines before the last-N slice.
- **Preview-model drift is now visible.** `/gemini:setup` reports the model-alias count, how many resolve to `*-preview` IDs, and the `lastVerified` date.

### Documentation
- README (EN + zh-TW): clarified that `agy --print` is locked to Gemini 3.5 Flash (High) and ignores `--model`/`--effort` (was incorrectly described as interactive selection); noted the DEP0190 warning is benign; documented that AGY transcript recovery is verified on Windows/Linux only (macOS unverified).
- Added `skills/gemini-prompting/references/` (blocks, recipes, anti-patterns), matching upstream `gpt-5-4-prompting`.

## 0.6.0 — 2026-06-01 — parity audit

### Breaking
- **`/gemini:setup` readiness now requires authentication.** `ready` is `true` only when Node **and** the Gemini CLI are present **and** OAuth is valid. An installed-but-unauthenticated Gemini now reports `ready: false` (previously `true`). New JSON fields: `readyState` (`ready` | `partial` | `not-ready`), `geminiReady`, `agyFallbackAvailable`.

### Fixed (P0)
- **Review target was discarded.** `/gemini:review` and `/gemini:adversarial-review` now honour `--base <ref>` and `--scope <auto|working-tree|branch>`; `executeReviewRun` previously re-resolved the target with empty options, silently dropping the user's selection.
- **Contradictory verbatim contract.** Removed the "STOP and ask which issues to fix" instruction from `review.md` / `adversarial-review.md`, which conflicted with the "return stdout verbatim" rule.
- **AGY install was over-eager.** `setup.md` now installs Gemini CLI as the primary engine and only prompts for AGY when the user passes `--engine agy`. Auth guidance is unified on running `gemini` (there is no `gemini login` subcommand).

### Fixed (P0 — post-audit, local-verified on agy 1.0.3 / gemini 0.44.1)
- **AGY install command was wrong (4 sites).** `npm install -g agy` installs an unrelated npm package; replaced with the official installer `curl -fsSL https://antigravity.google/cli/install.sh | bash` in `README.md`, `README.zh-TW.md`, `commands/setup.md`, and the `gemini-companion.mjs` setup hint. AGY version baseline pinned to `1.0.3`.
- **AGY silent 10-minute hang.** Local verification showed `agy --print` does not deliver its response over a pipe in non-interactive (non-TTY) use — it returned empty stdout or hung to its print-timeout under the exact piped spawn the plugin uses, while `gemini -p --output-format json` piped a clean JSON envelope every time. AGY's spawn timeout is now capped at 2 min (was 10) in `runGeminiTurn`/`runGeminiReview` so it fails fast instead of hanging, and `getAgyLoginStatus` reports the limitation honestly (and no longer reads the non-existent `status.version` field).
- **engine.mjs auto-branch comment corrected, not deleted.** The note that AGY cannot pipe output non-interactively is accurate (verified), so it was made precise rather than removed; gemini stays the preferred auto engine.

### Not done (local evidence overrode the audit prompt)
- **AGY-first auto routing for personal plans was NOT implemented.** The audit asked for it, but because `agy --print` does not pipe output, defaulting delegation to AGY would make tasks silently fail or hang. Auto-detection keeps gemini first; `--engine agy` / `GEMINI_ENGINE=agy` still force AGY for callers who explicitly want it.
- **Model-id / ListModels reconciliation deferred (needs API key).** `gemini` was confirmed to pipe a valid JSON envelope and to auto-route `gemini-2.5-flash-lite` → `gemini-3.1-flash-lite`; the `flash` alias marketing-name vs API-id check still requires the Generative Language API ListModels endpoint and is left untouched, flagged in `model-map.mjs`.

### Changed (P0-E — AGY transcript mode, v4)
- **AGY recovers its response from the on-disk transcript (#27466 workaround).** `agy --print` never writes its response to stdout under a pipe (upstream bug google-gemini/gemini-cli#27466), so `runGeminiTurn`'s agy branch no longer reads stdout: it snapshots agy's conversation ("brain") dirs before the spawn, then diffs them afterwards and reads the new conversation's `transcript_full.jsonl`/`transcript.jsonl`, returning the last `PLANNER_RESPONSE` row's `content` (with `thinking` as the reasoning summary and `convDir` as the resumable conversation id). New module `scripts/lib/agy-transcript.mjs`.
- **Fail-loud, never silent-empty.** If transcript recovery yields nothing, `runGeminiTurn` throws (citing #27466) instead of returning an empty result. `detectEngine` also refuses an explicit `--engine agy` early when no transcript brain dir exists on this platform (otherwise it permits agy and the transcript path handles it).
- **TODO-3 timeout grace.** agy's own `--print-timeout` is now set ~15 s shorter than the hard spawn kill so agy self-terminates and flushes a final `status:"DONE"` transcript row before `spawnSync` SIGKILLs it; success is judged by that row, not the (often killed) exit code.
- **Local verification (agy 1.0.3, Windows):** transcript path `~/.gemini/antigravity-cli/brain/<id>/.system_generated/logs/transcript.jsonl`; `agy --conversation <fresh-uuid>` does NOT pin a self-generated id (antigravity-cli#7 open), so a set-diff is used rather than a known id. `agy --print` is hardcoded to Gemini 3.5 Flash (High) with no model/effort flag — the ignore-note now states this explicitly. End-to-end proof: `task --engine agy` returned the transcript-recovered answer with empty agy stdout.
- **`getAgyLoginStatus` now checks real auth.** AGY stores no credential of its own (verified: no oauth/token file under any `~/.antigravity*` or `~/.gemini/antigravity-cli` dir) and runs off the same Google OAuth as the gemini CLI, so login status is now gauged from that shared `~/.gemini/oauth_creds.json` (presence + expiry) instead of mere binary presence.
- **Personal-plan 2026-06-18 EOL warning.** New `getGeminiPlanTier()` reads `~/.gemini/settings.json` (`security.auth.selectedType`); `setup` now appends a heads-up for `oauth-personal` plans that gemini CLI free access ends 2026-06-18, pointing to Gemini Code Assist Standard/Enterprise or the AGY transcript path. Enterprise/unknown tiers stay silent. New JSON field `geminiPlanTier`.
- **`runGeminiReview` agy path now uses transcript recovery too.** The adversarial/standard review path mirrors `runGeminiTurn`: for agy it snapshots brain dirs, applies the timeout grace, recovers the review text from the transcript (parsing the JSON findings out of it), and fails loud if nothing is recoverable — instead of reading the always-empty stdout (#27466).
- **`model-map.mjs` states the AGY model lock explicitly.** The effort-tier comment now records that AGY's `--print` is hardcoded to Gemini 3.5 Flash (High) with no model/effort flag, so tiers apply to the gemini engine only.

### Changed (P2 — engine-aware resume display)
- **`/gemini:result` (and job status) now show the correct per-engine resume command.** gemini jobs show `Gemini session ID` + `gemini --resume <id>` (the old hint used a non-existent `gemini resume` subcommand); AGY jobs show `AGY conversation ID` + `agy --conversation <id>` (the verified resume flag). The resolved engine is persisted on each completed job (`engine` field in the job record), and `render.mjs` derives the hint from it.

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
