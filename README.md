# gemini — Claude Code Plugin

> Delegate tasks and adversarial code reviews to Google Gemini / AGY directly from Claude Code.

[繁體中文說明 →](README.zh-TW.md)

Ported from [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc) (Apache-2.0) — same slash-command UX, same background job model, same skill contract — powered by the Gemini ecosystem instead of OpenAI.

---

## Features

- **`/gemini:rescue`** — Delegate investigation, debugging, or implementation tasks to Gemini. Runs in the foreground or detached in the background.
- **`/gemini:review`** — Standard (pragmatic) code review over the current diff or branch. Finds real bugs, missing error handling, and incomplete code paths.
- **`/gemini:adversarial-review`** — Adversarial code review that challenges design decisions over the current diff or branch. Returns structured findings with severity ratings.
- **`/gemini:setup`** — Check Gemini CLI / AGY availability and OAuth status.
- **`/gemini:status`** — Inspect active and completed background jobs.
- **`/gemini:result`** / **`/gemini:cancel`** — Retrieve or cancel a background job.
- **Engine auto-detection** — Prefers `gemini` CLI (pipe-safe); falls back to `agy`.
- **Stdin prompt delivery** — Prompts are passed via stdin on all platforms, eliminating shell injection and Windows `.cmd` wrapper issues.
- **Session lifecycle hooks** — Automatically injects `GEMINI_COMPANION_SESSION_ID`; cleans up stale jobs on session end.

---

## Prerequisites

| Requirement | Version | Install |
|---|---|---|
| Node.js | ≥ 18 | [nodejs.org](https://nodejs.org) |
| Gemini CLI | ≥ 0.40 | `npm install -g @google/gemini-cli` |
| AGY _(optional)_ | ≥ 1.0 | `npm install -g agy` |
| Claude Code | any | [claude.ai/code](https://claude.ai/code) |

**Authentication**: Run `gemini` once to complete OAuth. No API key is required.

---

## Installation

```
# 1. Add the marketplace
/plugin marketplace add arcobaleno64/gemini-plugin-cc

# 2. Install the plugin
/plugin install gemini@gemini-plugin-cc

# 3. Reload plugins
/reload-plugins
```

Then run `/gemini:setup` — it will check whether Gemini CLI is ready. If Gemini is missing and npm is available, it will offer to install it for you.

If Gemini is installed but not authenticated yet, run:

```
!gemini
```

---

## Quick Start

```
# Delegate a task to Gemini (foreground)
/gemini:rescue Investigate why the auth middleware returns 401 on valid tokens

# Run in the background and check later
/gemini:rescue --background Add unit tests for the UserService class
/gemini:status

# Adversarial review of your current diff
/gemini:adversarial-review

# Review with a specific focus
/gemini:adversarial-review Focus on race conditions in the job queue
```

---

## Commands

### `/gemini:rescue [prompt]`

Delegates a task to Gemini. Reads from stdin if no prompt is given.

| Flag | Description |
|---|---|
| `--background` | Run detached; returns a job ID immediately |
| `--write` | Allow Gemini to modify files (`--yolo` / `--dangerously-skip-permissions`) |
| `--resume-last` | Continue the most recent Gemini session |
| `--fresh` | Force a new Gemini session, ignoring any resumable thread |
| `--engine <gemini\|agy\|auto>` | Override engine selection |
| `--model <alias\|id>` | Model override (`flash`, `pro`, `lite`) |
| `--effort <low\|medium\|high\|xhigh>` | Map effort level to a model |

### `/gemini:review`

Runs a standard, pragmatic review over the current working tree or branch diff — real bugs, missing error handling, and incomplete code paths. Not steerable and takes no focus text; use `/gemini:adversarial-review` to challenge a specific decision.

| Flag | Description |
|---|---|
| `--wait` / `--background` | Run in the foreground or detached |
| `--base <ref>` | Compare against a specific git ref |
| `--scope <auto\|working-tree\|branch>` | Diff scope |
| `--engine <gemini\|agy\|auto>` | Override engine |
| `--model <alias\|id>` | Model override |

### `/gemini:adversarial-review [focus]`

Runs an adversarial review over the current working tree or branch diff.

| Flag | Description |
|---|---|
| `--base <ref>` | Compare against a specific git ref |
| `--scope <auto\|working-tree\|branch>` | Diff scope |
| `--engine <gemini\|agy\|auto>` | Override engine |
| `--model <alias\|id>` | Model override |

### `/gemini:setup`

Prints availability and auth status for Node, Gemini CLI, and AGY.

### `/gemini:status [job-id]`

Lists active and recent background jobs. Pass a job ID to inspect a single job.

| Flag | Description |
|---|---|
| `--wait` | Block until the job completes (requires a job ID) |
| `--all` | Show all jobs, not just this session's |

### `/gemini:result [job-id]`

Retrieves the output of a completed job. If the job has a Gemini session ID, the output includes `Resume in Gemini: gemini resume <session-id>` — paste that into a terminal to continue the session in Gemini CLI directly.

### `/gemini:cancel [job-id]`

Cancels a running or queued background job.

---

## Review Gate (Optional)

An optional stop-time gate that runs an adversarial review before Claude Code can stop, whenever a `--write` task completed in the session. Disabled by default.

Enable or disable via `/gemini:setup`:

```
# Enable
/gemini:setup --enable-review-gate

# Disable
/gemini:setup --disable-review-gate
```

When enabled and the review returns `needs-attention`, Claude Code is blocked from stopping and shown the finding summary. Run `/gemini:adversarial-review --wait` to review the findings and decide whether to accept or fix them before continuing.

---

## Model Aliases

| Alias | Resolved Model | Notes |
|---|---|---|
| `flash` / `flash3` | `gemini-3-flash-preview` | Latest Gemini 3 Flash (preview) |
| `pro` / `pro3` | `gemini-3.1-pro-preview` | Gemini 3.1 Pro (preview) |
| `flash25` | `gemini-2.5-flash` | Stable 2.5 Flash (GA) |
| `pro25` | `gemini-2.5-pro` | Stable 2.5 Pro (GA) |
| `lite` / `fast` | `gemini-2.5-flash-lite` | Cost-efficient (GA) |
| `lite3` | `gemini-3.1-flash-lite-preview` | Gemini 3.1 cost-efficient (preview) |

---

## Engine Routing

In `auto` mode the plugin selects the first available engine in this order:

1. **`gemini` CLI** — outputs via stdout; supports stdin prompt delivery.
2. **`agy`** — fallback; note that AGY in non-interactive mode does not write to a pipe, so explicit `--engine agy` is required to use it.

Override via `--engine` flag or the `GEMINI_ENGINE` environment variable.

> `--model` and `--effort` apply to the **gemini** engine only. AGY selects its model and tier interactively, so the plugin ignores `--model`/`--effort` when `--engine agy` is active.

---

## Security

- **Stdin delivery (gemini engine)**: For the `gemini` engine, prompts are passed via `stdin` (Node's `spawnSync` `input` option) and never interpolated into a shell string, eliminating shell-injection risk regardless of prompt content. The `agy` engine has no stdin mode and receives the prompt as a CLI argument, so prefer the default `gemini` engine for untrusted input.
- **Credential handling**: OAuth credentials in `~/.gemini/oauth_creds.json` are read only to check token expiry via `getGeminiLoginStatus()`; they are never logged, copied elsewhere, or transmitted by this plugin.
- **`.gitignore`**: The `.omc/` state directory (job logs, session state) is excluded from version control.

---

## How It Works

```
Claude Code
  └─ /gemini:rescue "prompt"
       └─ gemini-companion.mjs task
            ├─ detectEngine()        → gemini | agy
            ├─ buildCliArgs()        → args (no prompt in args for gemini)
            ├─ runCommand()          → spawnSync, prompt via stdin
            │    shell: true (Win)   ← fixes Windows .cmd wrapper
            │    input: prompt       ← gemini engine: prompt via stdin (no shell parsing)
            └─ renderTaskResult()   → Markdown output to Claude
```

Background mode spawns a detached `task-worker` child process and returns a job ID immediately. State is persisted in `.omc/state/` and polled via `/gemini:status`.

---

## Skills

Three skills are bundled for Claude Code to consume:

| Skill | Purpose |
|---|---|
| `gemini-cli-runtime` | Runtime contract — how to call `gemini-companion task` |
| `gemini-prompting` | Prompt composition guide (XML tags, output contract) |
| `gemini-result-handling` | Result presentation rules (severity, reasoning, evidence) |

---

## Changelog

See [CHANGELOG.md](plugins/gemini/CHANGELOG.md).

---

## License

MIT © 2026 arcobaleno64.

This project is a derivative work of [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc), Copyright 2026 OpenAI, licensed under the Apache License, Version 2.0. Adapted portions remain under Apache-2.0 (see [`LICENSE-APACHE-2.0`](LICENSE-APACHE-2.0) and [`NOTICE`](NOTICE)); Gemini/AGY-specific changes are MIT (see [`LICENSE`](LICENSE)).
