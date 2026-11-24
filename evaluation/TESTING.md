# 評估系統測試指南

## 環境準備

### 1. 設置環境變數

```bash
# POE API Key（LLM Judge 用）
export POE_API_KEY="your_poe_api_key_here"
export JUDGE_MODEL="Claude-Sonnet-4"  # 可選，預設為 Claude-Sonnet-4

# API Base URL（可選，預設為 http://127.0.0.1:5173）
export API_BASE_URL="http://127.0.0.1:5173"
```

### 2. 啟動本地開發伺服器

在**另一個終端**執行：

```bash
npm run dev
```

等待看到類似以下輸出，確認 server 已在 `http://127.0.0.1:5173` 啟動：

```
✓ Ready on http://127.0.0.1:5173
```

## 測試執行

### 快速測試（使用 keyword judge，無需 POE API）

```bash
node --import tsx/esm --no-warnings evaluation/run-evaluation.ts \
  --split development \
  --variant A \
  --limit 1 \
  --judge keyword
```

### 完整測試（使用 LLM judge）

確認已設置 `POE_API_KEY` 後執行：

```bash
node --import tsx/esm --no-warnings evaluation/run-evaluation.ts \
  --split development \
  --variant A \
  --limit 2 \
  --judge llm
```

### 測試不同 Variant

```bash
# Variant B
node --import tsx/esm --no-warnings evaluation/run-evaluation.ts \
  --variant B --limit 1 --judge keyword

# Variant C
node --import tsx/esm --no-warnings evaluation/run-evaluation.ts \
  --variant C --limit 1 --judge keyword

# Variant B-wide
node --import tsx/esm --no-warnings evaluation/run-evaluation.ts \
  --variant B-wide --limit 1 --judge keyword
```

### 測試 Network Kind

```bash
node --import tsx/esm --no-warnings evaluation/run-evaluation.ts \
  --kind network \
  --variant C \
  --limit 1 \
  --judge keyword
```

## 完整評估（Development Split）

```bash
# 使用 LLM judge 評估所有 development histories
node --import tsx/esm --no-warnings evaluation/run-evaluation.ts \
  --split development \
  --variant A \
  --judge llm
```

## 預期輸出

成功執行後會看到：

```
🔬 Starting evaluation:
   Variant: A
   Kind: analysis
   Judge: keyword
   Histories: 1
   Total questions: 5

⚠️  Please ensure local dev server is running (npm run dev)
   This script will use the local API at http://localhost:3000

📁 Processing development-work-1 (Veronica)...
   ❓ fact: What is the approximate price...
      ✅ Correct (1234ms)
   ❓ distributed: How do Veronica's spending...
      ✅ Correct (2345ms)
   ...

📊 Evaluation Summary:
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Total questions:        5
   Answerable:             4
   Unanswerable:           1
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Accuracy (answerable):  75.00%
   False Positive Rate:    0.00%
   Avg Latency:            1500ms
   Coverage:               100.00%
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Results saved to: evaluation/results-2026-11-24T12-34-56-789Z.json

🧹 Cleaning up evaluation data...
✅ Cleanup complete.
```

## 疑難排解

### Server 未啟動
```
❌ API call failed (ECONNREFUSED)
```
→ 確認 `npm run dev` 正在另一個終端執行

### POE API Key 錯誤
```
❌ POE_API_KEY environment variable is required
```
→ 執行 `export POE_API_KEY="your_key"`

### Auth 錯誤
```
❌ 401 Please sign in
```
→ 檢查 `app/chatgpt-auth.ts` 是否有 mock auth 設置

### Network Permission 錯誤
```
❌ fetch failed [EPERM]
```
→ 確認 dev server 已啟動且可訪問 `http://127.0.0.1:5173`

### 自訂 API Base URL
如果你的 dev server 跑在不同的 port：
```bash
export API_BASE_URL="http://localhost:3000"
node --import tsx/esm --no-warnings evaluation/run-evaluation.ts --limit 1 --judge keyword
```

## 結果檔案

評估結果會自動儲存到 `evaluation/results-{timestamp}.json`，包含：

- **run_metadata**: 執行參數（variant, kind, split, judge_method 等）
- **per_question_results**: 每個問題的詳細結果
- **aggregate_metrics**: 聚合指標（accuracy, false_positive_rate, latency 等）

檢視結果：

```bash
# 列出所有結果檔案
ls -lht evaluation/results-*.json

# 檢視最新結果的 metrics
cat evaluation/results-*.json | tail -1 | jq '.aggregate_metrics'

# 比較不同 variant 的結果
jq '.aggregate_metrics' evaluation/results-*-variant-A-*.json
jq '.aggregate_metrics' evaluation/results-*-variant-B-*.json
```

## 注意事項

1. **LLM Judge 使用 POE API**: 為避免 self-preference bias，固定使用 POE 的 Claude-Sonnet-4 作為評判
2. **每題獨立**: 每題之間會清理 cache，確保評估獨立性
3. **自動清理**: 評估完成後會自動移除所有測試資料
4. **結果已加入 .gitignore**: 不會意外提交評估結果到 git

## 完整 Variant 比較範例

```bash
# 依序跑完四個 variant
for variant in A B C B-wide; do
  node --import tsx/esm --no-warnings evaluation/run-evaluation.ts \
    --split development \
    --variant $variant \
    --judge llm
done

# 比較結果
for f in evaluation/results-*.json; do
  echo "=== $f ==="
  jq -r '"\(.run_metadata.variant): Accuracy=\(.aggregate_metrics.accuracy*100)% FPR=\(.aggregate_metrics.false_positive_rate*100)%"' "$f"
done
```
