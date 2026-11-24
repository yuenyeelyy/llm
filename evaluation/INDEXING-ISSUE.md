# Evaluation Indexing Issue 解決方案

## 問題根源

[lib/retrieval.ts:20](lib/retrieval.ts:20) 的 `hybridRetrieve` 要求所有 messages 必須先被 indexed（生成 embeddings 並儲存到 `retrieval_chunks` 表）。

檢查邏輯：
```typescript
const covered = new Set(scoped.map(r => r.message_id));
if (missingIndexMessages(messages, covered).length) 
  throw new HttpError(409, 'Search preparation was interrupted...');
```

## 解決方案

### 方案 1：只測試 Variant A（無需檢索）✅ 推薦

Variant A 不使用 `hybridRetrieve`，不需要 indexing：

```bash
# 只測試 Variant A
node --import tsx/esm --no-warnings evaluation/run-evaluation.ts \
  --provider poe \
  --variant A \
  --split development \
  --judge keyword
```

根據 [app/api/ask/route.ts:17](app/api/ask/route.ts:17)：
- **Variant A**: 不使用 retrieval（直接將所有 messages 傳給 agent）
- **Variant B/C/B-wide**: 需要 `hybridRetrieve`（需要 indexing）

### 方案 2：啟動本地 embedding service（測試所有 Variant）

需要：
1. 啟動 `scripts/retrieval-service.mjs`
2. 設置環境變數：
   ```bash
   ENCODER_URL=http://localhost:8080
   ENCODER_TOKEN=your_token
   ```
3. 在 `/api/eval-setup` 的 `setup` action 完成後呼叫 `indexStep`

### 方案 3：修改 eval-setup 自動完成 indexing

在 `app/api/eval-setup/route.ts` 加入：

```typescript
// After inserting messages
if (needsIndexing) {
  const profile = await db().prepare('SELECT * FROM profiles WHERE owner=? AND id=?')
    .bind(owner, profileId).first();
  
  await indexStep(owner, profile, messages);
}
```

但這需要 embedding service 運行。

## 當前建議

**先用 Variant A 完成評估系統驗證**，因為：
1. Variant A 不需要 indexing
2. 可以立即測試完整流程
3. 驗證 accuracy、false positive rate 等核心指標

之後如需測試 Variant B/C，再啟動 embedding service。

## 測試指令

```bash
# Variant A（無需 indexing）
node --import tsx/esm --no-warnings evaluation/run-evaluation.ts \
  --provider poe \
  --variant A \
  --split development \
  --limit 2 \
  --judge keyword
```

這應該可以完整跑通整個評估流程！
