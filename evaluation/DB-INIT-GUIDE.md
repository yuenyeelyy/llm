# 本地資料庫初始化問題排查

## 問題現象

執行評估腳本時 `/api/eval-setup` 回傳 `503`，原因是 `env.DB` 未配置。

## 解決方案

### 方案 1：確認 dev server 已正確啟動（推薦）

`npm run dev` 應該會自動初始化本地 D1 資料庫。請確認：

1. **停止現有的 dev server**（如果正在運行）
2. **重新啟動 dev server**：
   ```bash
   npm run dev
   ```
3. **檢查啟動 log**，確認沒有資料庫相關錯誤
4. **再次執行評估腳本**

### 方案 2：檢查 dist/ 是否存在

如果 dev server 無法正常啟動，可能是因為缺少 build 產物：

```bash
# 確認 dist/server/wrangler.json 是否存在
ls -la dist/server/wrangler.json

# 如果不存在，執行 build
npm run build

# 再次啟動 dev server
npm run dev
```

### 方案 3：手動執行 migration（如果方案 1、2 都失敗）

在**你的本地環境**（非當前 Claude Code 環境）執行：

```bash
npm run db:migrate:local
```

這會執行以下 SQL migrations：
- `drizzle/0000_empty_darkhawk.sql` - 建立 profiles, messages, sources 等基礎表
- `drizzle/0001_many_machine_man.sql` - 加入 summary 欄位
- `drizzle/0002_calm_tusk.sql` - 建立 profile_jobs 表
- `drizzle/0003_young_viper.sql` - 建立 profile_batch_cache 表

### 方案 4：檢查 .dev.vars 配置

如果需要額外的環境變數配置，建立 `.dev.vars` 檔案：

```bash
# .dev.vars（如果需要）
# OPENAI_API_KEY=your_key_here
# POE_API_KEY=your_key_here
```

## 驗證資料庫是否已初始化

執行評估腳本應該不再回傳 503：

```bash
node --import tsx/esm --no-warnings evaluation/run-evaluation.ts \
  --split development \
  --variant A \
  --limit 1 \
  --judge keyword
```

## 預期結果

- **成功**：看到 `📁 Processing development-work-1 (Veronica)...` 並開始評估
- **仍然 503**：檢查 dev server 的 console log，查看具體的資料庫錯誤訊息

## 當前環境限制

由於 Claude Code 環境的 sandbox 限制，我無法直接執行 `npm run db:migrate:local`（需要 wrangler CLI 訪問）。請你在**本地終端**直接執行上述步驟。
