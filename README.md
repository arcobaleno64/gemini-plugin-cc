# gemini — Claude Code Plugin

> Delegate tasks and adversarial code reviews to Google Gemini / AGY directly from Claude Code.

[繁體中文說明 →](README.zh-TW.md)

Mirrors the [openai-codex](https://github.com/openai/codex) skill architecture — same slash-command UX, same background job model, same skill contract — powered by the Gemini ecosystem instead of OpenAI.

---

## Features

- **`/gemini:rescue`** — Delegate investigation, debugging, or implementation tasks to Gemini. Runs in the foreground or detached in the background.
- **`/gemini:adversarial-review`** — Adversarial code review over the current diff or branch. Returns structured findings with severity ratings.
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
| Gemini CLI | ≥ 0.40 | `npm install -g @google/generative-ai-cli` |
| AGY _(optional)_ | ≥ 1.0 | `npm install -g agy` |
| Claude Code | any | [claude.ai/code](https://claude.ai/code) |

**Authentication**: Run `gemini` once to complete OAuth. No API key is required.

---

## Installation

```
# 1. Add the marketplace
/plugin marketplace add arcobaleno64/gemini-plugin-cc

# 2. Install the plugin
/plugin install arcobaleno64/gemini-plugin-cc

# 3. Reload plugins
/plugins reload
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
| `flash` / `flash3` | `gemini-3.5-flash` | Latest stable Flash (GA) |
| `pro` / `pro3` | `gemini-3.1-pro` | Gemini 3.1 Pro |
| `flash25` | `gemini-2.5-flash` | Stable 2.5 Flash |
| `pro25` | `gemini-2.5-pro` | Stable 2.5 Pro |
| `lite` / `fast` | `gemini-2.5-flash-lite` | Cost-efficient |
| `lite3` | `gemini-3.1-flash-lite` | Gemini 3.1 cost-efficient |

---

## Engine Routing

In `auto` mode the plugin selects the first available engine in this order:

1. **`gemini` CLI** — outputs via stdout; supports stdin prompt delivery.
2. **`agy`** — fallback; note that AGY in non-interactive mode does not write to a pipe, so explicit `--engine agy` is required to use it.

Override via `--engine` flag or the `GEMINI_ENGINE` environment variable.

---

## Security

- **Stdin delivery**: Prompts are never interpolated into shell command strings. They are passed to the Gemini CLI via `stdin` (using Node's `spawnSync` `input` option), which eliminates shell-injection risk regardless of prompt content.
- **No secrets in code**: OAuth credentials live in `~/.gemini/oauth_creds.json` and are never read into process memory by this plugin.
- **Token expiry detection**: `getGeminiLoginStatus()` parses the credential file and reports expired tokens before any invocation attempt.
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
            │    input: prompt       ← fixes shell injection
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

MIT © 2026
