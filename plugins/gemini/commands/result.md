---
description: Show the stored final output for a finished Gemini job in this repository
argument-hint: '[job-id] [--all]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" result "$ARGUMENTS"`

By default `result` only resolves jobs from the current Claude session (matching
`/gemini:status`) — never a job tagged to another session. When no session id is
present (e.g. running the companion directly outside Claude Code), only
session-agnostic untagged jobs are in scope. Pass `--all` to look up a job that
belongs to another session in this repository.

Present the full command output to the user. Do not summarize or condense it. Preserve all details including:
- Job ID and status
- The complete result payload, including verdict, summary, findings, details, artifacts, and next steps
- File paths and line numbers exactly as reported
- Any error messages or parse errors
- Follow-up commands such as `/gemini:status <id>`, `/gemini:review --wait`, and `/gemini:adversarial-review --wait`
