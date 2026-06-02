# Gemini Prompt Anti-Patterns

Avoid these when prompting Gemini or AGY. The first six are general; the last three
are specific to this plugin's engines.

## Vague task framing

Bad:

```text
Take a look at this and let me know what you think.
```

Better:

```xml
<task>
Review this change for material correctness and regression risks.
</task>
```

## Missing output contract

Bad:

```text
Investigate and report back.
```

Better:

```xml
<structured_output_contract>
Return:
1. root cause
2. evidence
3. smallest safe next step
</structured_output_contract>
```

## No follow-through default

Bad:

```text
Debug this failure.
```

Better:

```xml
<default_follow_through_policy>
Keep going until you have enough evidence to identify the root cause confidently.
</default_follow_through_policy>
```

## Asking for more reasoning instead of a better contract

Bad:

```text
Think harder and be very smart.
```

Better:

```xml
<verification_loop>
Before finalizing, verify that the answer matches the observed evidence and task requirements.
</verification_loop>
```

## Mixing unrelated jobs into one run

Bad:

```text
Review this diff, fix the bug you find, update the docs, and suggest a roadmap.
```

Better:
- Run review first.
- Run a separate fix prompt if needed.
- Use a third run for docs or roadmap work.

## Unsupported certainty

Bad:

```text
Tell me exactly why production failed.
```

Better:

```xml
<grounding_rules>
Ground every claim in the provided context or tool outputs.
If a point is an inference, label it clearly.
</grounding_rules>
```

## Expecting `--model` / `--effort` to change AGY (AGY-specific)

Bad:

```text
Use --engine agy --model gemini-3.1-pro-preview --effort high to force the strongest model.
```

Better:
- Use the **gemini** engine when you need a specific model or effort tier — `--effort high` → `gemini-3.1-pro-preview`.
- For AGY, drop `--model`/`--effort`: `agy --print` is locked to Gemini 3.5 Flash (High) and the plugin ignores both flags (it prints a note when you pass them).

Explanation: AGY exposes no model/effort selection at invocation time. Choosing capability is a gemini-engine concern only.

## Expecting AGY to return output on stdout (AGY-specific)

Bad:

```text
Pipe `agy --print "..."` and read its stdout, or tell AGY to print only the final answer.
```

Better:
- Let the plugin recover the response from AGY's on-disk transcript — that is the only reliable channel.
- Prefer the **gemini** engine (`--output-format json`) when you need clean, pipeable structured output.

Explanation: `agy --print` does not deliver its response over a pipe in non-interactive use (upstream google-gemini/gemini-cli#27466). No prompt instruction changes that; the plugin diffs the transcript dirs to recover the answer, and this path is verified on Windows/Linux only (macOS unverified).

## Assuming Gemini/AGY behaves like Codex (parity-specific)

Bad:

```text
Treat --effort high + AGY like Codex rescue mode and expect the same multi-turn, app-server behavior.
```

Better:
- Remember this is a CLI-per-command adapter, not a persistent app-server: each run is one turn.
- Validate Gemini/AGY output quality independently; do not assume one-to-one equivalence with Codex/GPT-5.4 routing or sandboxing.

Explanation: the Gemini plugin mirrors the *interface* of `codex-plugin-cc`, but the runtime, review mechanism (prompt-based, not native), and capability profile differ. Tighten the prompt contract rather than assuming inherited behavior.
