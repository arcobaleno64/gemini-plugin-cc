---
description: Cancel an active background Gemini job in this repository
argument-hint: '[job-id] [--all]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" cancel "$ARGUMENTS"`

By default `cancel` only targets jobs from the current Claude session — never a
job tagged to another session, including via the no-argument "cancel the one
active job" shortcut. When no session id is present (e.g. running the companion
directly outside Claude Code), only session-agnostic untagged jobs are in scope.
Pass `--all` to deliberately cancel a job from another session in this repository.
