# Judge API 修復總結

## 🐛 問題根源

Judge API 連續 3 次重試都回傳 `500 Internal Server Error`，原因是**模型名稱錯誤**。

## 🔍 對比分析

### 主程式（正常工作）
根據 [lib/model-config.ts:5](lib/model-config.ts:5)：

```typescript
provider === 'poe-sonnet' ? 
  {
    model: 'claude-sonnet-5.5',  // ✅ 正確
    endpoint: 'https://api.poe.com/v1/chat/completions',
    format: 'chat'
  }
```

### Judge 原始代碼（錯誤）

```typescript
const judgeModel = process.env.JUDGE_MODEL || 'Claude-Sonnet-4';  // ❌ 錯誤
```

**問題**：
1. ❌ `'Claude-Sonnet-4'` 不存在於 Poe API
2. ❌ 大小寫可能不符
3. ❌ 版本號錯誤（4 vs 5.5）

## ✅ 修復

### 修改後的代碼

```typescript
const judgeModel = process.env.JUDGE_MODEL || 'claude-sonnet-5.5';  // ✅ 與主程式一致
```

### 完整 Judge 請求格式

```typescript
await fetch('https://api.poe.com/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${poeApiKey}`
  },
  body: JSON.stringify({
    model: 'claude-sonnet-5.5',  // ✅ 正確模型名稱
    messages: [{role: 'user', content: judgePrompt}],
    temperature: 0,
    max_tokens: 500
  })
});
```

## 📝 環境變數配置

更新 `.dev.vars`：

```bash
POE_API_KEY=sk-xxxxxxxxxxxxxxxx
JUDGE_MODEL=claude-sonnet-5.5  # 預設值，可省略
```

## 🧪 驗證測試

```bash
# 測試完整評估流程（使用 LLM judge）
node --import tsx/esm --no-warnings evaluation/run-evaluation.ts \
  --provider poe \
  --variant A \
  --split development \
  --limit 1 \
  --judge llm
```

**預期結果**：
- ✅ Judge API 回傳 `200 OK`
- ✅ 成功解析 JSON 回應
- ✅ 顯示 `correct: true/false` 和 `reasoning`

## 🎯 可用的 Poe 模型名稱

根據主程式配置，Poe API 支援：

- `claude-sonnet-5.5` - Claude Sonnet 5.5（`poe-sonnet` provider）✅ 推薦用於 Judge
- `GPT-6-Luna` - GPT-6 Luna（`poe-luna` provider）
- `GPT-5.4` - GPT-5.4（`poe` provider 的預設模型）

## 📚 參考

- Poe API Models: `https://api.poe.com/v1/models`
- OpenAI-compatible endpoint: `/v1/chat/completions`
- Authorization: `Bearer ${POE_API_KEY}`
