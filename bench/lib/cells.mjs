// The four benchmark cells. Two axes fall out of these:
//   model axis   = compare the two "model-isolated" cells (same neutral prompt+diff, no tools)
//   harness axis = compare the two "agentic" cells (each tool's own repo-exploring reviewer)
// and the within-tool "single-shot -> agentic" delta is the harness lift.
export const CELLS = {
  "gemini.model": { tool: "gemini", track: "model-isolated", harness: "single-shot", label: "Gemini (model, single-shot)" },
  "codex.model": { tool: "codex", track: "model-isolated", harness: "single-shot", label: "Codex (model, single-shot)" },
  "gemini.deep": { tool: "gemini", track: "plugin-native", harness: "agentic", label: "Gemini (--deep, agentic)" },
  "codex.native": { tool: "codex", track: "plugin-native", harness: "agentic", label: "Codex (native review, agentic)" }
};

export const CELL_IDS = Object.keys(CELLS);
