import { CELLS, CELL_IDS } from "./cells.mjs";

// Aggregate scored rows into a scorecard (markdown + a machine-readable summary).
// rows: [{ caseId, cell, status, score, latencyMs }]  (status: "ok" | "skipped" | "error")

function mean(nums) {
  const vals = nums.filter((n) => typeof n === "number" && Number.isFinite(n));
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

function aggregateByCell(rows) {
  const out = {};
  for (const cell of CELL_IDS) {
    const cellRows = rows.filter((r) => r.cell === cell && r.status === "ok" && r.score);
    out[cell] = {
      cell,
      cases: cellRows.length,
      composite: round1(mean(cellRows.map((r) => r.score.composite))),
      recall: round2(mean(cellRows.map((r) => r.score.recall))),
      precision: round2(mean(cellRows.map((r) => r.score.precision))),
      falsePositives: sum(cellRows.map((r) => r.score.falsePositives)),
      bonus: sum(cellRows.map((r) => r.score.bonus)),
      severityExactRate: round2(mean(cellRows.map((r) => r.score.severityExactRate))),
      latencyMs: round0(mean(cellRows.map((r) => r.latencyMs)))
    };
  }
  return out;
}

function winner(a, b, agg) {
  const sa = agg[a]?.composite;
  const sb = agg[b]?.composite;
  if (sa == null && sb == null) return { name: "—", note: "no data" };
  if (sa == null) return { name: CELLS[b].tool, note: `${a} had no data` };
  if (sb == null) return { name: CELLS[a].tool, note: `${b} had no data` };
  if (Math.abs(sa - sb) < 2) return { name: "tie", note: `within noise (${sa} vs ${sb})` };
  return sa > sb
    ? { name: CELLS[a].tool, note: `${sa} vs ${sb}` }
    : { name: CELLS[b].tool, note: `${sb} vs ${sa}` };
}

export function buildScorecard(rows, meta = {}) {
  const agg = aggregateByCell(rows);
  const modelAxis = winner("gemini.model", "codex.model", agg);
  const harnessAxis = winner("gemini.deep", "codex.native", agg);
  const geminiLift = liftOf(agg, "gemini.model", "gemini.deep");
  const codexLift = liftOf(agg, "codex.model", "codex.native");

  const lines = [];
  lines.push("# codex vs gemini — review benchmark scorecard");
  lines.push("");
  lines.push(`> Mode: **${meta.mode ?? "replay"}**${meta.repeats ? ` · repeats: ${meta.repeats}` : ""} · cases: ${meta.caseCount ?? "?"} · generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Verdicts");
  lines.push("");
  lines.push("| Axis | Winner | Detail |");
  lines.push("|---|---|---|");
  lines.push(`| **Model** (single-shot, tools off) | **${modelAxis.name}** | ${modelAxis.note} |`);
  lines.push(`| **Harness** (agentic reviewers) | **${harnessAxis.name}** | ${harnessAxis.note} |`);
  lines.push(`| Harness lift — Gemini | ${fmtLift(geminiLift)} | model→--deep composite |`);
  lines.push(`| Harness lift — Codex | ${fmtLift(codexLift)} | model→native composite |`);
  lines.push("");
  lines.push("## Per-cell aggregate");
  lines.push("");
  lines.push("| Cell | Cases | Composite | Recall | Precision | FP | Bonus | Sev-exact | Latency |");
  lines.push("|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|");
  for (const cell of CELL_IDS) {
    const a = agg[cell];
    lines.push(
      `| ${CELLS[cell].label} | ${a.cases} | ${fmt(a.composite)} | ${fmt(a.recall)} | ${fmt(a.precision)} | ${a.falsePositives} | ${a.bonus} | ${fmt(a.severityExactRate)} | ${a.latencyMs == null ? "—" : `${a.latencyMs}ms`} |`
    );
  }
  lines.push("");
  lines.push("## Per-case breakdown");
  lines.push("");
  lines.push("| Case | Cell | Status | Composite | Recall | FP | Bonus | Missed |");
  lines.push("|---|---|:-:|:-:|:-:|:-:|:-:|---|");
  for (const r of rows) {
    if (r.status !== "ok") {
      lines.push(`| ${r.caseId} | ${r.cell} | ${r.status}${r.note ? ` (${r.note})` : ""} | — | — | — | — | — |`);
      continue;
    }
    const s = r.score;
    lines.push(`| ${r.caseId} | ${r.cell} | ok | ${s.composite} | ${fmt(s.recall)} | ${s.falsePositives} | ${s.bonus} | ${s.missed.join(", ") || "—"} |`);
  }
  lines.push("");
  lines.push("## Caveats");
  lines.push("");
  lines.push("- The **model axis** isolates raw single-shot quality (diff embedded, tools forbidden); the **harness axis** is each tool's repo-exploring reviewer. Most real-world gap lives on the harness axis — see `docs/MODEL_COMPARISON.md`.");
  lines.push("- Composite = `recall*70 + precision*20 + severityExact*10` (0–100); it is a summary, not a verdict — read the columns.");
  lines.push("- In `--live` mode model output is non-deterministic; treat single-digit composite gaps as noise. Use `--repeats N` to average.");
  lines.push("- A finding outside the planted set but on the case's `allowed_extras` list counts as **bonus** (a legitimate unique catch), not a false positive.");
  lines.push("");

  const summary = {
    mode: meta.mode ?? "replay",
    caseCount: meta.caseCount ?? null,
    modelAxisWinner: modelAxis.name,
    harnessAxisWinner: harnessAxis.name,
    geminiHarnessLift: geminiLift,
    codexHarnessLift: codexLift,
    byCell: agg
  };
  return { markdown: lines.join("\n"), summary };
}

function liftOf(agg, fromCell, toCell) {
  const a = agg[fromCell]?.composite;
  const b = agg[toCell]?.composite;
  if (a == null || b == null) return null;
  return round1(b - a);
}
function fmtLift(v) {
  if (v == null) return "—";
  return v >= 0 ? `+${v}` : `${v}`;
}
function fmt(v) {
  return v == null ? "—" : String(v);
}
function sum(nums) {
  return nums.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
}
function round0(n) {
  return n == null ? null : Math.round(n);
}
function round1(n) {
  return n == null ? null : Math.round(n * 10) / 10;
}
function round2(n) {
  return n == null ? null : Math.round(n * 100) / 100;
}
