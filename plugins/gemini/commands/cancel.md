---
description: Cancel an active background Gemini job in this repository
argument-hint: '[job-id] [--all]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" cancel "$ARGUMENTS"`

By default `cancel` only targets jobs from the current Claude session, so it can
never terminate another session's job (including the no-argument "cancel the one
active job" shortcut). Pass `--all` to deliberately cancel a job from another
session in this repository.
