---
description: Check whether Gemini CLI / AGY is ready and optionally toggle the stop-time review gate
argument-hint: '[--engine <agy|gemini>] [--enable-review-gate|--disable-review-gate]'
allowed-tools: Bash(node:*), Bash(npm:*), Bash(curl:*), AskUserQuestion
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" setup --json "$ARGUMENTS"
```

Gemini CLI and AGY are first-class supported engines. Each is a conditional
dependency: the user only needs the binary for the engine they select. In
`auto` mode Gemini is checked first because it exposes the plugin's JSON/model
contract, then AGY is checked; that order does not make AGY an optional or
lower-tier integration. Drive the install decisions below off the setup JSON's
`requestedEngine` field, which already resolves both the `--engine` flag and
the `GEMINI_ENGINE` environment variable — do **not** branch on the raw
`$ARGUMENTS` text.

If the result says Gemini CLI is unavailable (`gemini.available` is false), npm
is available, and `requestedEngine` is **not** `agy`:
- Use `AskUserQuestion` exactly once to ask whether Claude should install Gemini CLI now.
- Put the install option first and suffix it with `(Recommended)`.
- Use these two options:
  - `Install Gemini CLI (Recommended)`
  - `Skip for now`
- If the user chooses install, run:

```bash
npm install -g @google/gemini-cli
```

- Then rerun:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" setup --json "$ARGUMENTS"
```

When `requestedEngine` is `agy` and AGY is unavailable
(`agy.available` is false):
- Use `AskUserQuestion` exactly once to ask whether Claude should install AGY now.
- Put the install option first and suffix it with `(Recommended)`.
- Use these two options:
  - `Install AGY (Recommended)`
  - `Skip for now`
- If the user chooses install, run:

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash
```

- Then rerun:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" setup --json "$ARGUMENTS"
```

Do not ask about installation when:
- the selected engine is already available (even if it still needs
  authentication), or
- Gemini CLI is the missing selected/auto candidate and npm is unavailable, or
- the only missing engine is AGY and `requestedEngine` is not `agy`. In that
  case AGY is not the selected conditional dependency, so do not push its
  installation.

When `requestedEngine` is `agy` and AGY is unavailable, the AGY install prompt
above takes precedence even if Gemini CLI is already present — the user routed
to AGY (via `--engine agy` or `GEMINI_ENGINE=agy`), so do not silently fall back
to Gemini.

Output rules:
- Present the final setup output to the user.
- If installation was skipped, present the original setup output.
- If Gemini is installed but not authenticated, preserve the guidance to run `!gemini` once to complete OAuth authentication. The plugin authenticates by running `gemini`; there is no separate login subcommand.
- If the setup output (`nextSteps` / `geminiPlanTier`) includes a 2026-06-18 EOL heads-up, surface it: personal-plan Gemini CLI free access ends then. After that date, either upgrade to Gemini Code Assist Standard/Enterprise to keep the gemini engine, or use `--engine agy` (the plugin recovers AGY responses from its on-disk transcript because `agy --print` does not pipe output — upstream google-gemini/gemini-cli#27466).
