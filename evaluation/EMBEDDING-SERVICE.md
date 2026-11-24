# Embedding Service 設定指南

## 🚀 啟動 Embedding Service

### 1. 啟動服務

在**另一個終端**執行：

```bash
node scripts/retrieval-service.mjs
```

**預期輸出**：
```
Loading pinned local MiniLM encoder (first run downloads public model files)…
Local MiniLM service ready on 127.0.0.1:8788. Restart the app once to load its private service token.
```

### 2. 環境變數自動設定

`retrieval-service.mjs` 會自動在 `.dev.vars` 加入：

```bash
ENCODER_TOKEN="<隨機生成的 32 位 hex token>"
ENCODER_URL="http://127.0.0.1:8788"
```

### 3. 重啟 dev server

停止並重新啟動 `npm run dev`，讓它載入新的 `ENCODER_TOKEN`。

## 📊 Embedding Service 規格

- **模型**: `Xenova/paraphrase-multilingual-MiniLM-L12-v2`
- **維度**: 384
- **Port**: 8788
- **Host**: 127.0.0.1（僅本地訪問）
- **認證**: Bearer token（自動生成並寫入 `.dev.vars`）

## ✅ 自動 Indexing

[app/api/eval-setup/route.ts](app/api/eval-setup/route.ts) 現已支援自動 indexing：

1. **寫入 messages** → `INSERT INTO messages`
2. **自動 indexing** → 呼叫 `indexStep` 迴圈直到完成
   - 每批處理 48 條 messages
   - 生成 384 維 embeddings
   - 寫入 `retrieval_chunks` 表
3. **完成提示** → Console 顯示 `Indexing complete: X/Y chunks`

如果 embedding service 未啟動，setup 仍會成功但會顯示警告：
```
⚠️  Setup succeeded but indexing incomplete. Variant B/C may not work.
```

## 🧪 完整測試流程

```bash
# Terminal 1: 啟動 embedding service
node scripts/retrieval-service.mjs

# Terminal 2: 重啟 dev server
npm run dev

# Terminal 3: 執行評估（支援所有 Variant）
node --import tsx/esm --no-warnings evaluation/run-evaluation.ts \
  --provider poe \
  --variant A \
  --split development \
  --limit 1 \
  --judge keyword

# 測試 Variant B
node --import tsx/esm --no-warnings evaluation/run-evaluation.ts \
  --provider poe \
  --variant B \
  --split development \
  --limit 1 \
  --judge keyword

# 測試 Variant C
node --import tsx/esm --no-warnings evaluation/run-evaluation.ts \
  --provider poe \
  --variant C \
  --split development \
  --limit 1 \
  --judge keyword
```

## 🔍 驗證 Indexing 狀態

檢查 `retrieval_chunks` 表是否有資料：

```sql
SELECT COUNT(*) as total_chunks, 
       COUNT(DISTINCT profile_id) as profiles,
       COUNT(DISTINCT message_id) as messages
FROM retrieval_chunks 
WHERE owner='local_seedy';
```

## ⚠️ 注意事項

1. **首次啟動**: 會下載模型檔案（約 200MB），需要幾分鐘
2. **記憶體使用**: Embedding service 約需 500MB-1GB RAM
3. **啟動順序**: 必須先啟動 embedding service，再重啟 dev server
4. **Token 安全**: `ENCODER_TOKEN` 自動生成並儲存在 `.dev.vars`（已加入 `.gitignore`）

## 🐛 疑難排解

### Embedding service 無法啟動
```bash
# 檢查 port 是否被佔用
lsof -i :8788

# 清除 cache 重試
rm -rf .cache/models
node scripts/retrieval-service.mjs
```

### Indexing 失敗 (503 error)
```
Error: Local MiniLM service is not configured.
```
→ 確認 embedding service 正在運行且 dev server 已重啟

### Variant B/C 仍報 409 錯誤
```
Error: Search preparation was interrupted...
```
→ 檢查 console log 確認 indexing 是否完成
→ 重新執行評估（`eval-setup` 會重新 index）
