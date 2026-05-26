---
description: Run an adversarial code review of recent git changes using Gemini/AGY
argument-hint: '[--background|--wait] [--engine <agy|gemini>] [--model <flash|pro>] [--effort <low|medium|high>] [optional scope or focus]'
context: fork
allowed-tools: Bash(node:*), AskUserQuestion
---

Route this request to the `gemini:gemini-rescue` subagent with adversarial-review framing.

Raw user request:
$ARGUMENTS

Execution mode:

- If the request includes `--background`, run the `gemini:gemini-rescue` subagent in the background.
- If the request includes `--wait`, run it in the foreground.
- If neither flag is present, default to foreground.

Operating rules:

- Forward the request to `gemini:gemini-rescue` with the instruction to run an adversarial review of the current git diff.
- Pass `--model pro` by default unless the user specifies otherwise, because adversarial review benefits from deeper reasoning.
- Tell the subagent to use the `adversarial-review` prompt template from `${CLAUDE_PLUGIN_ROOT}/prompts/adversarial-review.md` as the review framing.
- Return the Gemini companion stdout verbatim to the user.
- Do not paraphrase, summarize, rewrite, or add commentary before or after it.
- After presenting review findings, STOP. Do not make any code changes. You MUST explicitly ask the user which issues, if any, they want fixed before touching a single file.
- If the helper reports that Gemini/AGY is missing or unauthenticated, stop and tell the user to run `/gemini:setup`.
