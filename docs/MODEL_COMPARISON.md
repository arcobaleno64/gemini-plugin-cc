# Model vs Harness — what actually drives the gap

> Scope: the models each plugin drives — **Gemini** (this plugin) vs **OpenAI Codex/GPT** (`codex-plugin-cc`).
> Date: 2026-06-02 ｜ Method: live single-shot runs on identical prompt + diff (model isolation), contrasted with each tool's native harness, plus web-confirmed model facts. Setting the plugin features aside.
> Honesty note: proprietary model "strength" is not precisely measurable; vendor pages were partly fetch-blocked (403) so some benchmark numbers come from independent leaderboards / reputable secondary reporting. Treat single-digit gaps as noise-adjacent.

---

## TL;DR

1. **Raw single-shot review quality is close and mixed** between the latest Gemini and OpenAI coding models — all caught the headline bugs; they differ only in the long tail.
2. **Most of the gap people attribute to "model" is actually harness.** Codex's native reviewer is *agentic* (it explores the repo); this plugin's review is *single-shot prompt over a diff*. Give Gemini the same agentic loop and most of the observed difference closes.
3. **On multi-step agentic benchmarks (Terminal-Bench), OpenAI currently leads by a real margin; on competitive/algorithmic coding (LiveCodeBench), Gemini leads.** Split, not one-sided.
4. **Model availability is a hard local constraint:** Gemini 3.5 (the current GA flagship on the API) is **not served by the gemini CLI 0.44.1** (404); it is reachable only through the **AGY** engine (fixed model, no selection).

---

## A. Controlled single-shot run (model isolated)

Same neutral review prompt, same `auth.js` diff (5 seeded defects), each model once, no agentic exploration (diff embedded in the prompt). Run locally 2026-06-02.

| Model (engine) | Real findings | Unique catch | False positives | Secret severity |
|---|:-:|---|:-:|---|
| **Gemini 3.1 Pro** (`gemini-3.1-pro-preview`) | 4 | — | **0** | critical (well-calibrated) |
| **Gemini 3 Flash** (`gemini-3-flash-preview`) | 4 | — | **1** (hallucinated an "async/await" bug not in the diff) | high |
| **Codex default** (GPT-5.x via `codex exec`) | 4 | **JWT issued without expiry** | **0** | high |

Seeded defects: SQL injection, hardcoded JWT secret, missing null-check, plaintext `==` password compare, unguarded `JSON.parse`.

Observations:
- All three caught the three headline issues (SQLi, hardcoded secret, plaintext password).
- **Codex uniquely flagged "JWT has no `expiresIn`"** — genuine security depth the Gemini models missed.
- **Both Gemini models uniquely flagged the unguarded `JSON.parse`** (crash/DoS path) — Codex missed it.
- **Gemini 3 Flash produced one false positive** (invented an async bug unsupported by the diff); Pro and Codex had none.
- Net: **the single-shot model gap is small and mixed** — different strengths, not a tier difference.

## B. Native harness contrast (model + harness)

From the earlier parity audit, run on the same repo through each tool's *native* path:
- **Codex native review is agentic**: it ran `git`/filesystem commands and additionally caught a **missing `jsonwebtoken` dependency declaration** and an **untracked `.omc/state` file that should not be committed** — issues *outside* the diff.
- **This plugin's review is single-shot over the assembled diff**: it never sees beyond the diff, so it cannot find those repo-context issues.

Crucially, in the single-shot run above **Codex did *not* catch the dependency/untracked-file issues either** — because single-shot it only had the diff, same as Gemini. **Those extra catches were the harness (agentic exploration), not the model.**

→ **Harness, not model, explains most of the observed "Codex finds more."** That deficit is on the plugin side and is improvable (see [PARITY_AUDIT](PARITY_AUDIT.md) and the agentic-review follow-up).

## C. Benchmark context (web-confirmed, mid-2026)

| Benchmark | Leader | Margin | Source (publisher, date) |
|---|---|---|---|
| SWE-bench Verified (independent) | GPT-5.5 82.6% > Gemini 3.1 Pro 78.8% | +3.8 | vals.ai leaderboard |
| Terminal-Bench 2.0 (agentic terminal) | GPT-5.5 82.7% ≫ Gemini 3.1 Pro 68.5% | **+14** | OpenAI (MarkTechPost, 2026-04-23) + Google card |
| LiveCodeBench Pro (competitive/algorithmic) | Gemini 3.1 Pro 2887 Elo > GPT-5.x | **~+200 Elo** | Google DeepMind card, 2026-02-19 |
| SWE-bench Pro | GPT-5.5 58.6% > Gemini 3.1 Pro 54.2% | +4.4 | cross-vendor — treat cautiously |

Reading: the big gap is on **multi-step agentic execution** (Terminal-Bench), which matches finding B — it is a *harness/agency* axis, not single-shot IQ. Gemini leads competitive coding.

## D. Model availability — the local reality (transparency)

Probed on this machine (gemini CLI **0.44.1**, the latest on npm), 2026-06-02:

| Model id | gemini CLI 0.44.1 | Note |
|---|:-:|---|
| `gemini-2.5-flash` / `-pro` / `-flash-lite` | ✅ served | GA, stable |
| `gemini-3-flash-preview` | ✅ served | preview |
| `gemini-3.1-pro-preview` | ✅ served | preview; gemini CLI's configured default |
| `gemini-3.1-flash-lite` | ✅ served | GA |
| **`gemini-3.5-flash`** | ❌ **404 ModelNotFound** | GA on the API, **not on the CLI**; reachable via **AGY** (fixed model) |
| **`gemini-3.5-pro`** | ❌ **404** | GA imminent; not on the CLI |

- **AGY (antigravity 1.0.4)** exposes **no `--model`/`--effort`** flag (verified via `agy --help`); its model is backend-fixed (documented as Gemini 3.5 Flash, High). So Gemini 3.5 Flash is reachable only via AGY, and not tunable.
- The plugin therefore points `flash` at `gemini-3-flash-preview` (served) and **gracefully degrades** to the GA `gemini-2.5-flash` if a requested id 404s — see the model-not-found fallback in `lib/gemini.mjs`.
- Heads-up: free/personal gemini CLI access ends **2026-06-18**; after that the gemini engine requires a paid tier, and AGY becomes the free path.

---

## What this means for the plugin

- **Don't chase raw model parity** — it is close, and the model tier is Google/OpenAI's to move (choose it with `--effort`/`--model`, not code).
- **Do close the harness gap** — giving the Gemini review path agentic repo exploration (opt-in) recovers most of the observed difference. This is the highest-leverage, in-our-control improvement.
- **Be honest about availability** — 3.5 via AGY only; graceful fallback when ids drift. Documented in the README so user expectations match reality.
