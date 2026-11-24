# 本地開發環境變數配置

建立 `.dev.vars` 檔案，加入以下環境變數：

```bash
# POE API Key（主系統與 LLM Judge 都需要）
POE_API_KEY=your_poe_api_key_here

# POE 模型配置（可選，預設值如下）
POE_MODEL=GPT-5.4

# LLM Judge 模型配置（可選，預設為 claude-sonnet-5.5）
JUDGE_MODEL=claude-sonnet-5.5

# API Base URL（可選，預設為 http://127.0.0.1:5173）
API_BASE_URL=http://127.0.0.1:5173
```

## 支援的 Provider

根據 [lib/provider-policy.ts:1](lib/provider-policy.ts:1) 和 [lib/model-availability.ts:20](lib/model-availability.ts:20)，`/api/ask` 接受以下 `provider` 值：

1. **`poe-sonnet`** (預設) - Claude Sonnet 5.5 via Poe
2. **`poe-luna`** - GPT-6 Luna via Poe
3. **`poe`** - Poe 通用 API（使用 `POE_MODEL` 環境變數指定模型）
4. **`openrouter-nemotron`** - Nvidia Nemotron via OpenRouter
5. **`hku`** - HKU 內部模型服務

## 評估系統配置

### 被評估模型（測試對象）
- 透過 `evaluation/fact-checker.ts` 的 `callLocalAsk` 傳給 `/api/ask`
- 預設：`poe-sonnet` (Claude Sonnet 5.5)
- 可透過 `--provider` 參數覆蓋：
  ```bash
  node --import tsx/esm evaluation/run-evaluation.ts \
    --provider poe-luna \
    --variant A --limit 1 --judge keyword
  ```

### LLM Judge（評判者）
- 在 `evaluation/fact-checker.ts` 的 `judgeAnswerWithLLM` 中使用
- 固定使用 POE API 避免 self-preference bias
- 預設模型：`Claude-Sonnet-4`
- 可透過環境變數 `JUDGE_MODEL` 自訂

## 最小配置範例

```bash
# .dev.vars
POE_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxx
```

這樣就可以執行評估了：

```bash
# 1. 啟動 dev server
npm run dev

# 2. 執行評估
node --import tsx/esm --no-warnings evaluation/run-evaluation.ts \
  --split development \
  --variant A \
  --limit 1 \
  --judge keyword
```

## 完整配置範例

```bash
# .dev.vars
# 必填
POE_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxx

# 可選（使用 HKU provider 時）
# HKU_API_KEY=your_hku_key

# 可選（使用 OpenRouter provider 時）
# OPENROUTER_API_KEY=your_openrouter_key

# 可選（自訂主系統模型）
POE_MODEL=GPT-5.4

# 可選（自訂 LLM Judge 模型）
JUDGE_MODEL=Claude-Sonnet-4

# 可選（自訂 API base URL）
API_BASE_URL=http://127.0.0.1:5173
```

## Provider 選擇建議

### 評估不同模型時

```bash
# 測試 Claude Sonnet 5.5
node --import tsx/esm evaluation/run-evaluation.ts \
  --provider poe-sonnet --variant A --limit 1

# 測試 GPT-6 Luna
node --import tsx/esm evaluation/run-evaluation.ts \
  --provider poe-luna --variant A --limit 1

# 測試 Nvidia Nemotron
node --import tsx/esm evaluation/run-evaluation.ts \
  --provider openrouter-nemotron --variant A --limit 1
```

### Judge 模型建議

為避免 self-preference bias（被評估模型與評判模型相同），建議：
- 評估 Claude Sonnet 5.5 時，Judge 使用 GPT-4 或其他非 Claude 模型
- 評估 GPT 系列時，Judge 使用 Claude-Sonnet-4

可透過環境變數切換：
```bash
export JUDGE_MODEL="GPT-4"
```

或在 `.dev.vars` 中設定。
