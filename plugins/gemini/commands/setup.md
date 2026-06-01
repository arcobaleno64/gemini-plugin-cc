---
description: Check whether Gemini CLI / AGY is ready and optionally toggle the stop-time review gate
argument-hint: '[--engine <agy|gemini>] [--enable-review-gate|--disable-review-gate]'
allowed-tools: Bash(node:*), Bash(npm:*), AskUserQuestion
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" setup --json $ARGUMENTS
```

Gemini CLI is the primary engine. AGY is an optional fallback that is only
relevant when the user explicitly routes to it with `--engine agy`.

If the result says Gemini CLI is unavailable (`gemini.available` is false), npm
is available, and the raw `$ARGUMENTS` do **not** include `--engine agy`:
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
node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" setup --json $ARGUMENTS
```

Only if the raw `$ARGUMENTS` include `--engine agy`, AGY is unavailable
(`agy.available` is false), and npm is available:
- Use `AskUserQuestion` exactly once to ask whether Claude should install AGY now.
- Put the install option first and suffix it with `(Recommended)`.
- Use these two options:
  - `Install AGY (Recommended)`
  - `Skip for now`
- If the user chooses install, run:

```bash
npm install -g agy
```

- Then rerun:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" setup --json $ARGUMENTS
```

Do not ask about installation when:
- Gemini CLI is already available (even if it still needs authentication) **and
  the user did not pass `--engine agy`**, or
- npm is unavailable, or
- the only missing engine is AGY and the user did not pass `--engine agy`. In
  that case Gemini is the default engine; mention AGY only as an optional
  fallback, do not push its installation.

When the user passed `--engine agy` and AGY is unavailable, the AGY install
prompt above takes precedence even if Gemini CLI is already present — the user
explicitly asked to route to AGY, so do not silently fall back to Gemini.

Output rules:
- Present the final setup output to the user.
- If installation was skipped, present the original setup output.
- If Gemini is installed but not authenticated, preserve the guidance to run `!gemini` once to complete OAuth authentication. The plugin authenticates by running `gemini`; there is no separate login subcommand.
