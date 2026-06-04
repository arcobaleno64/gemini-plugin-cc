import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const BENCH_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CORPUS_DIR = path.join(BENCH_DIR, "corpus");
const NEUTRAL_PROMPT = path.join(BENCH_DIR, "neutral-review-prompt.md");

// A case directory holds: base/ (committed baseline), head/ (changed working tree),
// and ground-truth.json (planted defects + allowed_extras). An optional prompt.md
// overrides the neutral single-shot prompt for the model-isolated cells.
export function listCases() {
  if (!fs.existsSync(CORPUS_DIR)) return [];
  return fs
    .readdirSync(CORPUS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(CORPUS_DIR, d.name, "ground-truth.json")))
    .map((d) => d.name)
    .sort();
}

export function loadCase(caseId) {
  const dir = path.join(CORPUS_DIR, caseId);
  const truth = JSON.parse(fs.readFileSync(path.join(dir, "ground-truth.json"), "utf8"));
  const promptFile = fs.existsSync(path.join(dir, "prompt.md")) ? path.join(dir, "prompt.md") : NEUTRAL_PROMPT;
  const promptTemplate = fs.readFileSync(promptFile, "utf8");
  return { caseId, dir, truth, promptTemplate };
}

function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyTree(from, to);
    else fs.copyFileSync(from, to);
  }
}

// Build a throwaway git repo: commit base/, then lay head/ over it as UNSTAGED
// working-tree changes. Returns the repo dir, the unified diff text (for the
// model-isolated cells), and a cleanup(). Agentic cells run inside repoDir.
export function materializeCase(caseId) {
  const dir = path.join(CORPUS_DIR, caseId);
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), `bench-${caseId}-`));
  const git = (args) => execFileSync("git", ["-C", repoDir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

  git(["init", "-b", "main"]);
  git(["config", "user.name", "bench"]);
  git(["config", "user.email", "bench@example.com"]);
  git(["config", "commit.gpgsign", "false"]);

  const baseDir = path.join(dir, "base");
  if (fs.existsSync(baseDir)) copyTree(baseDir, repoDir);
  else fs.writeFileSync(path.join(repoDir, ".gitkeep"), "");
  git(["add", "-A"]);
  git(["commit", "-m", "baseline", "--allow-empty"]);

  const headDir = path.join(dir, "head");
  if (fs.existsSync(headDir)) copyTree(headDir, repoDir);

  // Intent-to-add surfaces new files in `git diff` without staging their content,
  // so the change stays in the working tree for the agentic reviewers.
  git(["add", "-AN"]);
  const diffText = git(["diff"]);

  return {
    repoDir,
    diffText,
    cleanup() {
      try {
        fs.rmSync(repoDir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  };
}
