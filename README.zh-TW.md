# gemini — Claude Code 外掛

> 直接從 Claude Code 將任務與對抗性程式碼審查委派給 Google Gemini / AGY。

本外掛鏡像 [openai-codex](https://github.com/openai/codex) 的技能架構——相同的斜線命令 UX、相同的背景工作模型、相同的技能合約——由 Gemini 生態系統驅動。

---

## 功能特色

- **`/gemini:rescue`** — 將調查、除錯或實作任務委派給 Gemini。可在前景執行或以背景工作方式分離執行。
- **`/gemini:adversarial-review`** — 對當前 diff 或分支執行對抗性程式碼審查，回傳含嚴重程度評級的結構化發現。
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
| Gemini CLI | ≥ 0.40 | `npm install -g @google/generative-ai-cli` |
| AGY _(選用)_ | ≥ 1.0 | `npm install -g agy` |
| Claude Code | 任意版本 | [claude.ai/code](https://claude.ai/code) |

**認證**：執行一次 `gemini` 完成 OAuth 登入。不需要 API 金鑰。

---

## 安裝

```bash
# 透過 Claude Code 外掛登錄
/plugin install local-gemini

# 或本機克隆後手動註冊
git clone https://github.com/<your-user>/gemini-claude-plugin
# 在 Claude Code 設定中加入外掛路徑
```

驗證安裝：

```
/gemini:setup
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
| `--engine <gemini\|agy\|auto>` | 覆蓋引擎選擇 |
| `--model <別名\|ID>` | 指定模型（`flash`、`pro`、`lite`、`preview`） |
| `--effort <low\|medium\|high\|xhigh>` | 以努力等級對應模型選擇 |

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

取得已完成工作的輸出內容。

### `/gemini:cancel [工作-ID]`

取消執行中或佇列中的背景工作。

---

## 模型別名

| 別名 | 對應模型 |
|---|---|
| `flash` | `gemini-2.5-flash` |
| `pro` | `gemini-2.5-pro` |
| `lite` / `fast` | `gemini-2.5-flash-lite` |
| `preview` | `gemini-3-pro-preview` |

---

## 引擎路由

在 `auto` 模式下，外掛依以下優先順序選擇可用引擎：

1. **`gemini` CLI** — 透過 stdout 輸出；支援 stdin 提示傳遞。
2. **`agy`** — 備援引擎；注意 AGY 在非互動模式下無法寫入 pipe，需明確使用 `--engine agy` 才能強制啟用。

可透過 `--engine` 旗標或 `GEMINI_ENGINE` 環境變數覆蓋。

---

## 安全性

- **Stdin 傳遞**：提示從不插入 shell 命令字串，而是透過 stdin（Node.js `spawnSync` 的 `input` 選項）傳遞給 Gemini CLI，無論提示內容為何都不存在 shell injection 風險。
- **無 secrets 入碼**：OAuth 憑證保存於 `~/.gemini/oauth_creds.json`，本外掛從不將其讀入記憶體。
- **Token 有效期偵測**：`getGeminiLoginStatus()` 解析憑證檔案並在任何呼叫前回報已過期的 token。
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
            │    input: prompt       ← 修復 shell injection 風險
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

詳見 [CHANGELOG.md](gemini/CHANGELOG.md)。

---

## 授權

MIT © 2026
