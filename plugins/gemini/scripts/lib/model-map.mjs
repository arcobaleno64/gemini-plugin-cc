// Single source of truth for Gemini model aliases and reasoning-effort mapping.
//
// The README "Model Aliases" table is verified against this data by
// tests/model-map.test.mjs, so update aliases here and the table stays in sync.
//
// Preview model IDs (those ending in `-preview`) track Google's Gemini preview
// channel and can change without notice; override any alias with `--model <id>`.
//
//   lastVerified: model IDs last checked against gemini CLI 0.44.1.
//   source:       gemini CLI model listing / Google Gemini API model names.
export const MODEL_MAP_METADATA = {
  lastVerified: "2026-06",
  source: "gemini CLI 0.44.1 (latest) live model probe / Google Gemini API model names",
  note: "Preview model IDs (…-preview) may change; override with --model <id>. NOTE: gemini-3.5-flash/-pro are GA on the API but NOT served by gemini CLI 0.44.1 (404) — reach 3.5 Flash via the AGY engine. Unknown/unavailable model ids degrade gracefully to the GA fallback at runtime."
};

// Ordered alias entries. `preview: true` marks IDs that can change.
export const MODEL_ALIAS_ENTRIES = [
  { alias: "flash", model: "gemini-3-flash-preview", label: "Latest Gemini 3 Flash (preview)", preview: true },
  { alias: "flash3", model: "gemini-3-flash-preview", label: "Latest Gemini 3 Flash (preview)", preview: true },
  { alias: "pro", model: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (preview)", preview: true },
  { alias: "pro3", model: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (preview)", preview: true },
  { alias: "lite3", model: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite (GA, cost-efficient)", preview: false },
  { alias: "flash25", model: "gemini-2.5-flash", label: "Stable 2.5 Flash (GA)", preview: false },
  { alias: "pro25", model: "gemini-2.5-pro", label: "Stable 2.5 Pro (GA)", preview: false },
  { alias: "lite", model: "gemini-2.5-flash-lite", label: "Cost-efficient (GA)", preview: false },
  { alias: "fast", model: "gemini-2.5-flash-lite", label: "Cost-efficient (GA)", preview: false }
];

export const MODEL_ALIASES = new Map(MODEL_ALIAS_ENTRIES.map((entry) => [entry.alias, entry.model]));

// Reasoning-effort tier -> resolved model, used when --effort is supplied
// without an explicit --model. These apply to the GEMINI engine only: AGY's
// `agy --print` is hardcoded to Gemini 3.5 Flash (High) and exposes no
// --model/--effort flag (env / settings.json cannot override it), so both are
// ignored on the AGY path — higher/other tiers are reachable only via gemini.
// See lib/gemini.mjs (the agy branch nulls model and emits a note).
export const EFFORT_MODEL_MAP = new Map([
  ["none", "gemini-2.5-flash-lite"],
  ["minimal", "gemini-2.5-flash-lite"],
  ["low", "gemini-3-flash-preview"],
  ["medium", "gemini-3-flash-preview"],
  ["high", "gemini-3.1-pro-preview"],
  ["xhigh", "gemini-3.1-pro-preview"]
]);

export const VALID_EFFORT_LEVELS = new Set(EFFORT_MODEL_MAP.keys());
