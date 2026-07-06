# Gemini / Antigravity Plugin Comparison

`gemini-plugin-cc` is a Claude Code-native companion bridge for developers who want Gemini CLI where it is still available, plus an explicit Antigravity CLI (`agy`) path during Google's Gemini CLI transition.

This project is not an AGY-only replacement or a multi-host plugin. It focuses on Claude Code workflows with richer review behavior and defensive handling around real CLI failure modes.

## Positioning

| Need | Best fit |
|---|---|
| Claude Code-native Gemini / AGY bridge | Use this plugin. |
| Pragmatic and adversarial review inside Claude Code | Use `/gemini:review` or `/gemini:adversarial-review`. |
| Gemini CLI model aliases, JSON output, and stdin prompt delivery | Use the Gemini engine where your account still supports Gemini CLI. |
| Antigravity CLI fallback during migration | Use `--engine agy`. |
| AGY-only, multi-host, or standalone `npx` workflows | Use an AGY-only multi-host plugin instead. |

## What This Plugin Emphasizes

- Claude Code-native `/gemini:*` slash commands.
- Standard and adversarial code review over the current diff or branch.
- Background jobs with status, result, and cancel flows.
- Gemini model aliases, graceful model fallback, and transient review retry.
- AGY transcript recovery for `agy --print` non-pipe behavior.
- Safer stdin prompt delivery on the Gemini engine.

## What This Plugin Does Not Claim

- It is not a universal multi-host Antigravity plugin.
- It does not claim full feature parity with Antigravity CLI.
- It does not implement or claim ACP support for AGY.
- It does not publish an npm / `npx` install path.

## Recommended GitHub Topics

`claude-code`, `claude-code-plugin`, `gemini-cli`, `antigravity-cli`, `agy`, `google-gemini`, `google-antigravity`, `code-review`, `adversarial-review`, `ai-code-review`, `task-delegation`, `ai-coding-agent`, `agentic-coding`, `developer-tools`, `cli`, `nodejs`, `javascript`, `llm`, `plugins`
