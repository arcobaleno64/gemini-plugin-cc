# Parity & Usability Re-Score — v0.6.1

> Target: `arcobaleno64/gemini-plugin-cc` **v0.6.1** (`git describe` = v0.6.1, commit `82e7898`)
> Baseline: the v0.6.0 audit in [`PARITY_AUDIT.md`](PARITY_AUDIT.md)
> Upstream: `openai/codex-plugin-cc` v1.0.4
> Date: 2026-06-02 ｜ Method: re-read of the actual v0.6.1 code + 159-test suite + live sampling (Gemini engine, Windows), scored by a 4-group fan-out plus an independent regression/new-issue critic.
> Same six-axis rubric as the baseline. "Usability" = mean of axes ②–⑥.

---

## Top line

| Dimension | v0.6.0 | **v0.6.1** | Δ |
|---|:-:|:-:|:-:|
| **Fidelity** (①, excl. original engine-routing row) | 3.9 | **4.0** | +0.1 |
| **Usability** (mean ②–⑥ across 14 rows) | 4.0 | **4.2** | +0.2 |

Every P0–P3 finding from the baseline was addressed in v0.6.1 (see [CHANGELOG](../plugins/gemini/CHANGELOG.md)). The lift is concentrated where the fixes landed — `/rescue` (P0 contract), the background job model (review-worker), `/setup` (drift visibility), and the review output hygiene. No row regressed.

Live-anchored on v0.6.1: `/setup` prints `model aliases: 9 (5 preview), verified 2026-05`; `task-resume-candidate` emits `{available:false}`; standard review prints `Starting review...`; 159/159 tests pass.

---

## Re-scored matrix (Δ vs v0.6.0 usability)

| # | Feature | ① | ② | ③ | ④ | ⑤ | ⑥ | Usability | Δ | What moved |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| 1 | `/setup` | 4 | 4 | 5 | 5 | 5 | 4 | **4.6** | +0.4 | model-alias provenance (count/preview/lastVerified) now shown |
| 2 | `/rescue` | 4 | 4 | 4 | 4 | 4 | 4 | **4.0** | +0.4 | **P0 fixed**: `available` field → resume prompt fires; ① 3→4, ②④ 3→4 |
| 3 | `/review` | 3 | 5 | 5 | 4 | 4 | 4 | **4.4** | +0.2 | bg persistence + label fix + noise filter (④ 3→4); still prompt-based (① cap 3) |
| 4 | `/adversarial-review` | 4 | 5 | 5 | 4 | 4 | 4 | **4.4** | +0.2 | label/noise fixed (④ 3→4); bg persistence |
| 5 | `/status` | 5 | 5 | 4 | 4 | 4 | 4 | 4.2 | = | now also surfaces persisted bg reviews |
| 6 | `/result` | 4 | 5 | 4 | 4 | 4 | 4 | 4.2 | = | returns persisted bg review results |
| 7 | `/cancel` | 4 | 4 | 4 | 4 | 4 | 4 | 4.0 | = | unchanged (OS process-tree only; no `turn/interrupt`) |
| 8 | `gemini-rescue` subagent | 4 | 4 | 4 | 3 | 4 | 4 | 3.8 | = | unchanged (still returns empty on failure) |
| 9 | skills (3) | 3 | 4 | 4 | 4 | 4 | 5 | **4.2** | +0.2 | `references/` added (⑤ 3→4); ① still 3 (prompt skill is gemini-specific) |
| 10 | hooks (lifecycle/stop-gate) | 4 | 4 | 4 | 4 | 4 | 4 | **4.0** | +0.2 | stop-gate fails open **visibly** + explicit working-tree scope (④ 3→4) |
| 11 | engine routing (stdin/AGY transcript) | — | 4 | 4 | 4 | 3 | 3 | **3.6** | +0.1 | macOS still unverified but now **documented**; AGY claim corrected |
| 12 | background job model | 4 | 5 | 4 | 4 | 4 | 4 | **4.2** | +0.6 | **review-worker closes the bg-review gap** (② 3→5) |
| 13 | model/effort (model-map) | 4 | 4 | 4 | 4 | 4 | 3 | 3.8 | = | drift now visible in setup; ⑥ still 3 (preview ids can still drift on macOS-unverified AGY) |
| 14 | manifests & tooling | 5 | 5 | 5 | 5 | 5 | 5 | 5.0 | = | tests 154→159; release workflow; CHANGELOG |

> Row 11 fidelity is `—` (original feature, no upstream counterpart) and excluded from the fidelity mean.

---

## Independent regression / new-issue critic

No regressions vs v0.6.0. The critic flagged gaps that **temper** the optimistic re-score (none block, but they shape v0.6.2):

| Sev | Concern | Note |
|---|---|---|
| Med-High | **stop-gate hook untested in the v0.6.1 release** | The gate logic is rewritten (visible fail-open, working-tree scope) but has no dedicated unit test in v0.6.1. *(A 3-test cover exists in the unmerged PR #7 / this branch.)* |
| Medium | **Background review of a clean tree passes vacuously** | `review-worker` re-resolves the diff at run time; if the tree is clean when the worker starts, the review runs on an empty diff and silently approves. Foreground shows this immediately; background hides it until `/result`. **✅ Resolved in v0.6.4** — `executeReviewRun` now short-circuits an empty target. |
| Low | **Reasoning noise filter `/\[DEP\d+\]/` is broad** | Filters before the last-N slice (genuine reasoning is preserved), but could strip legitimate bracketed tokens if the Gemini CLI ever emits them. |
| Low | **Cancel of a bg review logs "Cancelled" unconditionally** | Detached worker is `unref()`-ed; if its PID is stale, `terminateProcessTree` no-ops but the log still says cancelled. UX, not functional. |
| Low | **Multi-line focus-text in bg review untested** | JSON serialization is safe; no test covers it. |

**Overall verdict (critic):** v0.6.1 is functionally correct and more robust than v0.6.0; the most actionable gap is the stop-gate test (already written in PR #7). The clean-tree background-review edge case is the best v0.6.2 candidate.

---

## Suggested v0.6.2 candidates

1. Merge the stop-gate hook tests (PR #7) so the gate ships tested.
2. ~~Background review of a clean/empty diff: surface "nothing to review" in the persisted result instead of a vacuous approve.~~ **✅ Resolved in v0.6.4** — `executeReviewRun` short-circuits an empty review target (empty working tree or empty branch diff) with an explicit `empty:true` / `result:null` "nothing to review" payload, covering both the foreground and background (`review-worker`) paths; the stop-gate stays non-blocking on the empty result. See [CHANGELOG](../plugins/gemini/CHANGELOG.md) 0.6.4.
3. (Optional) Narrow the `[DEP\d+]` noise regex to stderr-preamble context; add a multi-line focus-text background test.

---

## What did NOT change (by design)

- `/review` stays **prompt-based** (not a native reviewer) → ① capped at 3; the native-vs-prompt feedback difference documented in the baseline still holds.
- `/cancel` still cannot interrupt a model turn (no app-server) — OS process-tree termination only.
- AGY remains locked to Gemini 3.5 Flash (High) and macOS transcript recovery is unverified — now **honestly documented** rather than fixed.
