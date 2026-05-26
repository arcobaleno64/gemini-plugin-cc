---
description: Check whether Gemini CLI / AGY is ready and optionally toggle the stop-time review gate
argument-hint: '[--engine <agy|gemini>] [--enable-review-gate|--disable-review-gate]'
allowed-tools: Bash(node:*), AskUserQuestion
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" setup --json $ARGUMENTS
```

If the result says AGY is unavailable and npm is available:
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

If Gemini CLI is unavailable and AGY is also unavailable:
- Use `AskUserQuestion` exactly once to ask whether Claude should install Gemini CLI now.
- Put the install option first and suffix it with `(Recommended)`.
- Use these two options:
  - `Install Gemini CLI (Recommended)`
  - `Skip for now`
- If the user chooses install, run:

```bash
npm install -g @google/generative-ai-cli
```

- Then rerun:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" setup --json $ARGUMENTS
```

If both are already installed or npm is unavailable:
- Do not ask about installation.

Output rules:
- Present the final setup output to the user.
- If installation was skipped, present the original setup output.
- If Gemini is installed but not authenticated, preserve the guidance to run `!gemini login` or `!agy login`.
