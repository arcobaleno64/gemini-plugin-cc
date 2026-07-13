# Adapter Contract

```text
ENGINE_NAME: string
DELIVERS_PROMPT_VIA: "stdin" | "argv"   // argv 者必須文件化輸入驗證前提
detect() → { engine, binary /*resolved path 優先*/, version }   // 不可用時 throw
buildArgs({ prompt?, jobId? }) → string[]
buildSpawnOptions({ cwd, timeoutMs? }) → { cwd, env, timeoutMs?, shell }
parseOutput(rawText, exitCode) → { ok, error?, raw, ... }
cancel(pid) → { signaled, confirmedTerminated?, reason? }
```

## gemini-plugin-cc 對應表

- `binaryAvailable`／`resolveBinaryPath`（`process.mjs`）對應契約 `detect()` 的組成件。
- `terminateProcessTree` 對應契約 `cancel(pid)`：語意等價為樹殺與結果物件。
- Prompt 遞送：gemini 使用 stdin；agy 使用 argv（上游限制）。輸入驗證前提為 model id 字元集白名單與長度控制。
- 不改動 CC 既有函式命名（已發布 v0.6.6，Hyrum 面）；本檔為對照文件，宣告 CC 以語意等價符合契約。
