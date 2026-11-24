# Rejudge Undetermined Questions 使用指南

## ✅ 已完成修改

### 1. **修改 fact-checker.ts**
   - [evaluation/fact-checker.ts:159-213](evaluation/fact-checker.ts:159-213)
   - `!answerable` 問題現在也使用 LLM Judge (Claude-Sonnet-5.5)
   - 移除硬寫的 `refusalPatterns` 關鍵字比對
   - 新的 prompt 要求 Judge 判斷模型是否「誠實指出資訊不足」

### 2. **建立 rejudge 腳本**
   - [evaluation/rejudge-undetermined.ts](evaluation/rejudge-undetermined.ts)
   - 自動載入 `.dev.vars` 環境變數
   - 只重新評分 underdetermined 問題
   - 保留原有的 `model_answer`（不重新呼叫 GPT-5.4）
   - 重新計算 aggregate metrics

## 🚀 使用方式

### 在你的本地環境執行

```bash
# 重新評分指定的結果檔案
node --import tsx/esm --no-warnings evaluation/rejudge-undetermined.ts \
  /Users/tsehoiyi/Desktop/llm/evaluation/results-2026-11-24T05-05-51-554Z.json
```

### 預期輸出

```
✓ Loaded environment variables from .dev.vars

📂 Loading results from: results-2026-11-24T05-05-51-554Z.json

Found 5 underdetermined questions

🔄 Re-judging underdetermined: Why does Veronica specifically choose omakase...
   ✅ Correct: Model correctly indicated uncertainty with phrases like "no direct evidence"

🔄 Re-judging underdetermined: What specific financial worries...
   ❌ Incorrect: Model provided definitive answer despite insufficient evidence

📊 Recalculating aggregate metrics...

✅ Re-judged 5 underdetermined questions
📊 Updated metrics:
   Accuracy (answerable):  45.00%
   False Positive Rate:    40.00%  # 從 100% 降低

💾 Saved to: results-2026-11-24T05-05-51-554Z-rejudged.json
```

## 📊 新的 LLM Judge Prompt (Underdetermined)

```
You are evaluating whether a model correctly handled an UNANSWERABLE question.

Question: ${question}

This question CANNOT be definitively answered based on the available information. 
The correct behavior is to:
- Indicate uncertainty or lack of information
- Avoid making definitive claims without evidence
- Use phrases like "not enough information", "cannot determine", "unclear", 
  "insufficient evidence", "no direct evidence", etc.

Model's answer:
${modelAnswer}

Did the model correctly indicate uncertainty/lack of information (correct: true), 
or did it provide a definitive answer despite insufficient evidence (correct: false)?

Respond with a JSON object:
{
  "correct": true or false,
  "reasoning": "brief explanation of your judgment"
}
```

## 🔍 與舊方法的差異

### 舊方法（硬寫關鍵字）
```typescript
const refusalPatterns = [
  'not enough information',
  'cannot determine',
  // ...
];
const hasRefusal = refusalPatterns.some(pattern => 
  lowerAnswer.includes(pattern)
);
```

**問題**：
- ❌ "no direct evidence" 被誤判（因為中間有 "direct"）
- ❌ 無法理解語義，只看字面匹配
- ❌ 容易漏掉其他表達不確定性的方式

### 新方法（LLM Judge）
```typescript
// 呼叫 claude-sonnet-5.5 判斷
const judgment = await judgeAnswerWithLLM(
  question,
  modelAnswer,
  [],
  false  // answerable = false
);
```

**優勢**：
- ✅ 理解語義，不只看關鍵字
- ✅ 能判斷 "no direct evidence" 是正確的不確定性表達
- ✅ 更靈活、更準確

## 📝 輸出檔案格式

Rejudged 結果會儲存為 `{original-name}-rejudged.json`：

```json
{
  "run_metadata": { ... },
  "per_question_results": [
    {
      "question_id": "underdetermined",
      "question": "Why does Veronica...",
      "model_answer": "The messages show no direct evidence...",
      "answerable": false,
      "correct": true,  // 重新評分後的結果
      "judge_reasoning": "Model correctly indicated uncertainty..."  // 新的 reasoning
    }
  ],
  "aggregate_metrics": {
    "accuracy": 0.45,
    "false_positive_rate": 0.40  // 重新計算
  }
}
```

## ⚠️ 注意事項

1. **需要 POE_API_KEY**: 腳本會自動從 `.dev.vars` 載入
2. **保留原有答案**: 不會重新呼叫 GPT-5.4，只重新評分
3. **輸出新檔案**: 原始檔案保持不變
4. **Rate Limit**: 腳本在每個問題之間等待 500ms

## 🧪 完整測試流程

```bash
# 1. 執行完整評估（如果還沒有）
node --import tsx/esm --no-warnings evaluation/run-evaluation.ts \
  --provider poe --variant A --split development --limit 1 --judge llm

# 2. 重新評分 underdetermined 問題
node --import tsx/esm --no-warnings evaluation/rejudge-undetermined.ts \
  evaluation/results-2026-11-24T05-05-51-554Z.json

# 3. 比較結果
jq '.aggregate_metrics' evaluation/results-2026-11-24T05-05-51-554Z.json
jq '.aggregate_metrics' evaluation/results-2026-11-24T05-05-51-554Z-rejudged.json
```

預期 False Positive Rate 會顯著降低（因為使用了更智能的 LLM Judge）。
