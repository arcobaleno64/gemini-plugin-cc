---
name: gemini-cli-runtime
description: Internal helper contract for calling the gemini-companion runtime from Claude Code
user-invocable: false
---

# Gemini Runtime

Use this skill only inside the `gemini:gemini-rescue` subagent.

Primary helper:
- `node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" task "<raw arguments>"`

Execution rules:
- The rescue subagent is a forwarder, not an orchestrator. Its only job is to invoke `task` once and return that stdout unchanged.
- Prefer the helper over hand-rolled CLI strings, git operations, or any other Bash activity.
- Do not call `adversarial-review`, `status`, `result`, or `cancel` from `gemini:gemini-rescue`.
- Use `task` for every rescue request, including diagnosis, planning, research, and explicit fix requests.
- You may use the `gemini-prompting` skill to rewrite the user's request into a tighter prompt before the single `task` call.
- That prompt drafting is the only Claude-side work allowed. Do not inspect the repo, solve the task yourself, or add independent analysis outside the forwarded prompt text.
- Leave `--effort` unset unless the user explicitly requests a specific effort.
- Leave model unset by default. Add `--model` only when the user explicitly asks for one.
- Model aliases: `flash` → gemini-3-flash-preview, `pro` → gemini-3.1-pro-preview, `lite` → gemini-2.5-flash-lite.
- Default to a write-capable run by adding `--write` unless the user explicitly asks for read-only behavior.

Command selection:
- Use exactly one `task` invocation per rescue handoff.
- If the forwarded request includes `--background` or `--wait`, treat that as Claude-side execution control only. Strip it before calling `task`.
- If the forwarded request includes `--model`, normalize aliases and pass it through.
- If the forwarded request includes `--effort`, pass it through to `task`.
- `--effort` accepted values: `none`, `minimal`, `low`, `medium`, `high`, `xhigh`.
- `--resume`: add `--resume-last`, even if the request text is ambiguous.
- `--fresh`: use a fresh `task` run, do not add `--resume-last`.
- `task --resume-last`: for "keep going", "resume", "apply the top fix", or "dig deeper".

Engine routing:
- Default engine: auto-detect (gemini preferred, agy fallback).
- Force AGY: add `--engine agy`.
- Force Gemini CLI: add `--engine gemini`.
- Note: `--model` and `--effort` are ignored when the AGY engine is active; AGY selects its model and tier interactively.

Safety rules:
- Default to write-capable work in `gemini:gemini-rescue` unless the user explicitly asks for read-only behavior.
- Preserve the user's task text as-is apart from stripping routing flags.
- Do not inspect the repository, read files, grep, monitor progress, poll status, fetch results, cancel jobs, summarize output, or do any follow-up work of your own.
- Return the stdout of the `task` command exactly as-is.
- If the Bash call fails or the engine cannot be invoked, return nothing.
