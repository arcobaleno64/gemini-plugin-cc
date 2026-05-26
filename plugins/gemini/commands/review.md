---
description: Run a standard Gemini code review of recent git changes
argument-hint: '[--background|--wait] [--engine <agy|gemini>] [--model <flash|pro>] [--base <ref>] [--scope <auto|working-tree|branch>]'
context: fork
allowed-tools: Bash(node:*), AskUserQuestion
---

Run a standard Gemini code review against the current git state.

Raw user request:
$ARGUMENTS

Execution mode:

- If the request includes `--background`, run in the background.
- If the request includes `--wait`, run in the foreground.
- If neither flag is present, default to foreground.

Operating rules:

- Call `node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" review "$ARGUMENTS"` via Bash.
- Return the Gemini companion stdout verbatim to the user.
- Do not paraphrase, summarize, rewrite, or add commentary before or after it.
- After presenting review findings, STOP. Do not fix issues. You MUST explicitly ask the user which issues, if any, they want fixed before touching a single file.
- If the helper reports that Gemini/AGY is missing or unauthenticated, stop and tell the user to run `/gemini:setup`.

Note: `/gemini:review` is a pragmatic reviewer that finds real bugs, missing error handling, and incomplete code paths.
For an adversarial review that challenges design decisions, use `/gemini:adversarial-review`.
