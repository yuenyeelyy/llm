# D1 資料庫配置修復完成

## ✅ 已修復問題

### 1. **migrate-local.mjs 錯誤輸出改進**
   - 修改 [scripts/migrate-local.mjs:2](scripts/migrate-local.mjs:2)
   - 現在會同時輸出 `stdout` 和 `stderr`，方便排錯

### 2. **hosting.json D1 配置**
   - 修改 [.openai/hosting.json](.openai/hosting.json:2) 加入 `"d1": "DB"`
   - 這是 `vite.config.ts` 讀取 D1 binding 的來源

### 3. **重新 build 生成正確的 wrangler.json**
   - `dist/server/wrangler.json` 現在包含正確的 D1 配置：
     ```json
     {
       "binding": "DB",
       "database_name": "site-creator-d1",
       "database_id": "00000000-0000-4000-8000-000000000000"
     }
     ```

## 🔧 配置機制說明

### vite.config.ts 的 D1 binding 流程：

1. **讀取 hosting.json**：
   ```typescript
   import hostingConfig from "./.openai/hosting.json";
   const { d1, r2 } = hostingConfig;
   ```

2. **生成 localBindingConfig**：
   ```typescript
   d1_databases: d1
     ? [{
         binding: d1,  // "DB"
         database_name: "site-creator-d1",
         database_id: "00000000-0000-4000-8000-000000000000"
       }]
     : []
   ```

3. **傳給 @cloudflare/vite-plugin**：
   - Dev server 啟動時會自動初始化本地 D1 資料庫
   - 資料庫檔案儲存在 `.wrangler/state/v3/d1/`
   - Runtime 環境變數透過 `configureToolEnvironment()` 設置

## 📋 下一步操作

請在你的本地終端執行：

```bash
# 1. 重啟 dev server（會自動初始化 D1）
# 先停止現有的 dev server (Ctrl+C)
npm run dev
```

**預期結果**：
- Server 啟動時會自動建立 `.wrangler/state/v3/d1/` 下的資料庫檔案
- `env.DB` 會正確綁定到本地 D1 instance
- `/api/eval-setup` 和 `/api/workspace` 不再回傳 503

```bash
# 2. 執行 migration（如果 dev server 未自動初始化）
npm run db:migrate:local
```

現在 migration 腳本的錯誤輸出已改進，如果失敗會顯示完整的 stdout/stderr。

```bash
# 3. 測試評估腳本
node --import tsx/esm --no-warnings evaluation/run-evaluation.ts \
  --split development \
  --variant A \
  --limit 1 \
  --judge keyword
```

## 🎯 關鍵修改點

1. ✅ [.openai/hosting.json](.openai/hosting.json:2) - 加入 `"d1": "DB"`
2. ✅ [scripts/migrate-local.mjs:2](scripts/migrate-local.mjs:2) - 改進錯誤輸出
3. ✅ 重新 build 生成正確的 wrangler.json
4. ✅ dist/server/wrangler.json 現在包含完整的 d1_databases 配置

現在你的本地環境應該可以正常執行評估系統了！
