# gemini — Claude Code 外掛

> 直接從 Claude Code 將任務與對抗性程式碼審查委派給 Google Gemini / AGY。

本外掛移植自 [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc)（Apache-2.0）的技能架構——相同的斜線命令 UX、相同的背景工作模型、相同的技能合約——由 Gemini 生態系統驅動。

---

## 功能特色

- **`/gemini:rescue`** — 將調查、除錯或實作任務委派給 Gemini。可在前景執行或以背景工作方式分離執行。
- **`/gemini:review`** — 對當前 diff 或分支執行標準（務實）程式碼審查，找出真實 bug、缺漏之錯誤處理與未竟之程式路徑。
- **`/gemini:adversarial-review`** — 對當前 diff 或分支執行對抗性程式碼審查，挑戰設計決策，回傳含嚴重程度評級的結構化發現。
- **`/gemini:setup`** — 檢查 Gemini CLI / AGY 的可用性與 OAuth 狀態。
- **`/gemini:status`** — 查看作用中與已完成的背景工作。
- **`/gemini:result`** / **`/gemini:cancel`** — 取得或取消背景工作。
- **引擎自動偵測** — 優先使用 `gemini` CLI（支援 pipe 輸出）；回退至 `agy`。
- **Stdin 提示傳遞** — 提示透過 stdin 傳入，消除 Windows `.cmd` wrapper 問題與 shell injection 風險。
- **會話生命週期掛鉤** — 自動注入 `GEMINI_COMPANION_SESSION_ID`；會話結束時清理殘留工作。

---

## 系統需求

| 項目 | 版本 | 安裝方式 |
|---|---|---|
| Node.js | ≥ 18 | [nodejs.org](https://nodejs.org) |
| Gemini CLI | ≥ 0.40 | `npm install -g @google/gemini-cli` |
| AGY _(選用)_ | ≥ 1.0 | `npm install -g agy` |
| Claude Code | 任意版本 | [claude.ai/code](https://claude.ai/code) |

**認證**：執行一次 `gemini` 完成 OAuth 登入。不需要 API 金鑰。

---

## 安裝

```
# 1. 加入 marketplace
/plugin marketplace add arcobaleno64/gemini-plugin-cc

# 2. 安裝外掛
/plugin install gemini@gemini-plugin-cc

# 3. 重新載入外掛
/reload-plugins
```

接著執行 `/gemini:setup`——若 Gemini CLI 尚未安裝且 npm 可用，指令會提供自動安裝選項。

若 Gemini 已安裝但尚未完成認證，請執行：

```
!gemini
```

---

## 快速開始

```
# 將任務委派給 Gemini（前景執行）
/gemini:rescue 調查為什麼 auth middleware 對有效 token 回傳 401

# 背景執行，稍後查看結果
/gemini:rescue --background 為 UserService 類別新增單元測試
/gemini:status

# 對當前 diff 執行對抗性審查
/gemini:adversarial-review

# 聚焦特定面向的審查
/gemini:adversarial-review 重點關注工作佇列中的競態條件
```

---

## 命令說明

### `/gemini:rescue [提示]`

將任務委派給 Gemini。若未提供提示，則從 stdin 讀取。

| 旗標 | 說明 |
|---|---|
| `--background` | 分離執行；立即回傳工作 ID |
| `--write` | 允許 Gemini 修改檔案（`--yolo` / `--dangerously-skip-permissions`） |
| `--resume-last` | 繼續最近一次的 Gemini 工作階段 |
| `--fresh` | 強制開啟全新 Gemini 工作階段，忽略可接續的執行緒 |
| `--engine <gemini\|agy\|auto>` | 覆蓋引擎選擇 |
| `--model <別名\|ID>` | 指定模型（`flash`、`pro`、`lite`） |
| `--effort <low\|medium\|high\|xhigh>` | 以努力等級對應模型選擇 |

### `/gemini:review`

對當前工作樹或分支 diff 執行標準、務實之審查——真實 bug、缺漏之錯誤處理、未竟之程式路徑。不可導向、不接受焦點文字；如需挑戰特定決策請用 `/gemini:adversarial-review`。

| 旗標 | 說明 |
|---|---|
| `--wait` / `--background` | 前景或分離執行 |
| `--base <ref>` | 與特定 git ref 比較 |
| `--scope <auto\|working-tree\|branch>` | Diff 範圍 |
| `--engine <gemini\|agy\|auto>` | 覆蓋引擎 |
| `--model <別名\|ID>` | 指定模型 |

### `/gemini:adversarial-review [焦點]`

對當前工作樹或分支 diff 執行對抗性審查。

| 旗標 | 說明 |
|---|---|
| `--base <ref>` | 與特定 git ref 比較 |
| `--scope <auto\|working-tree\|branch>` | Diff 範圍 |
| `--engine <gemini\|agy\|auto>` | 覆蓋引擎 |
| `--model <別名\|ID>` | 指定模型 |

### `/gemini:setup`

印出 Node、Gemini CLI 與 AGY 的可用性及認證狀態。

### `/gemini:status [工作-ID]`

列出作用中與近期的背景工作。傳入工作 ID 以查看單一工作。

| 旗標 | 說明 |
|---|---|
| `--wait` | 阻塞直到工作完成（需提供工作 ID） |
| `--all` | 顯示所有工作，不限本次會話 |

### `/gemini:result [工作-ID]`

取得已完成工作的輸出內容。若工作帶有 Gemini session ID，輸出中會包含 `Resume in Gemini: gemini resume <session-id>`——將該命令貼到終端機即可直接在 Gemini CLI 中接續工作階段。

### `/gemini:cancel [工作-ID]`

取消執行中或佇列中的背景工作。

---

## Review Gate（可選）

可選的停止時審查閘門，當本次 session 有 `--write` 工作完成時，在 Claude Code 停止前自動執行對抗性審查。預設停用。

透過 `/gemini:setup` 啟用或停用：

```
# 啟用
/gemini:setup --enable-review-gate

# 停用
/gemini:setup --disable-review-gate
```

啟用後，若審查回傳 `needs-attention`，Claude Code 將被阻止停止並顯示發現摘要。執行 `/gemini:adversarial-review --wait` 查看完整發現，決定是否接受或修正後再繼續。

---

## 模型別名

| 別名 | 對應模型 | 說明 |
|---|---|---|
| `flash` / `flash3` | `gemini-3-flash-preview` | 最新 Gemini 3 Flash（preview） |
| `pro` / `pro3` | `gemini-3.1-pro-preview` | Gemini 3.1 Pro（preview） |
| `flash25` | `gemini-2.5-flash` | 穩定 2.5 Flash（GA） |
| `pro25` | `gemini-2.5-pro` | 穩定 2.5 Pro（GA） |
| `lite` / `fast` | `gemini-2.5-flash-lite` | 高效低成本（GA） |
| `lite3` | `gemini-3.1-flash-lite-preview` | Gemini 3.1 低成本版（preview） |

---

## 引擎路由

在 `auto` 模式下，外掛依以下優先順序選擇可用引擎：

1. **`gemini` CLI** — 透過 stdout 輸出；支援 stdin 提示傳遞。
2. **`agy`** — 備援引擎；注意 AGY 在非互動模式下無法寫入 pipe，需明確使用 `--engine agy` 才能強制啟用。

可透過 `--engine` 旗標或 `GEMINI_ENGINE` 環境變數覆蓋。

> `--model` 與 `--effort` 僅適用於 **gemini** 引擎。AGY 之模型與分級由其互動選擇，故 `--engine agy` 時外掛會忽略 `--model`/`--effort`。

---

## 安全性

- **Stdin 傳遞（gemini 引擎）**：`gemini` 引擎之提示透過 stdin（Node.js `spawnSync` 的 `input` 選項）傳遞、從不插入 shell 命令字串，故無論內容為何皆無 shell injection 風險。`agy` 引擎無 stdin 模式，提示以 CLI 引數傳入；處理不可信輸入時請優先使用預設之 `gemini` 引擎。
- **憑證處理**：`~/.gemini/oauth_creds.json` 之 OAuth 憑證僅用於 `getGeminiLoginStatus()` 檢查 token 是否過期；本外掛從不記錄、複製或傳輸之。
- **`.gitignore`**：`.omc/` 狀態目錄（工作日誌、會話狀態）已排除於版本控制之外。

---

## 運作原理

```
Claude Code
  └─ /gemini:rescue "提示"
       └─ gemini-companion.mjs task
            ├─ detectEngine()        → gemini | agy
            ├─ buildCliArgs()        → 引數（gemini 模式不含提示）
            ├─ runCommand()          → spawnSync，提示透過 stdin 傳入
            │    shell: true (Win)   ← 修復 Windows .cmd wrapper 問題
            │    input: prompt       ← gemini 引擎：提示經 stdin（不經 shell 解析）
            └─ renderTaskResult()   → Markdown 輸出至 Claude
```

背景模式會產生一個分離的 `task-worker` 子程序並立即回傳工作 ID。狀態持久化於 `.omc/state/`，可透過 `/gemini:status` 查詢。

---

## 技能

本外掛捆綁三個供 Claude Code 使用的技能：

| 技能 | 用途 |
|---|---|
| `gemini-cli-runtime` | 執行時合約 — 如何呼叫 `gemini-companion task` |
| `gemini-prompting` | 提示組合指南（XML 標籤、輸出合約） |
| `gemini-result-handling` | 結果呈現規則（嚴重程度、推理、證據邊界） |

---

## 更新日誌

詳見 [CHANGELOG.md](plugins/gemini/CHANGELOG.md)。

---

## 授權

MIT © 2026 arcobaleno64。

本專案為 [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc)（Copyright 2026 OpenAI，Apache License 2.0）之衍生作品。沿用部分仍受 Apache-2.0 規範（見 [`LICENSE-APACHE-2.0`](LICENSE-APACHE-2.0) 與 [`NOTICE`](NOTICE)）；Gemini/AGY 專屬之變更採 MIT（見 [`LICENSE`](LICENSE)）。
