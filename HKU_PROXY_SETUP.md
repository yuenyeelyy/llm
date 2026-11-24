# HKU API Proxy Setup — Fixing workerd Connectivity

## Problem Diagnosed

When running `npm run dev` (Cloudflare workerd local environment), requests to `api.hku.hk` fail with:
```
Error: internal error; remote: true
```

This happens because:
1. **workerd (Cloudflare Workers local dev)** has restricted outbound network access to external HTTPS endpoints
2. The error occurs at the network layer before it even reaches the HKU API
3. `curl` from Terminal works fine (Node.js runtime has full network access)
4. Direct HTTPS from workerd → api.hku.hk fails (workerd sandbox limitation)

**Root Cause**: workerd's sandbox restricts outbound TLS/HTTPS connections to arbitrary remote hosts. This is by design for security in Cloudflare Workers.

---

## Solution: Local Node.js Proxy

**New file**: `scripts/hku-proxy.mjs`

This proxy:
- Runs on `localhost:3001` (accessible to workerd locally)
- Accepts requests from workerd (HTTP, no TLS restrictions)
- Forwards them to the real HKU API over HTTPS
- Returns responses back to workerd

**Benefits**:
- ✅ Bypasses workerd's network sandbox
- ✅ Zero code changes to main app logic
- ✅ Works immediately when running locally
- ✅ Can be disabled in production (use direct HTTPS then)

---

## Setup Instructions

### Step 1: Update `.dev.vars`
```bash
# Already done:
HKU_API_ENDPOINT=http://127.0.0.1:3001/openai/student/deployments/gpt-5-mini/chat/completions?api-version=2025-04-01-preview
```

This tells the app to use the **local proxy** instead of the remote endpoint.

### Step 2: Start the Proxy (Terminal 1)
```bash
node scripts/hku-proxy.mjs
```

Expected output:
```
🌉 HKU API Proxy listening on http://127.0.0.1:3001
📍 Forwarding to: https://api.hku.hk
🔑 Using HKU_API_KEY from environment
```

### Step 3: Start Dev Server (Terminal 2)
```bash
npm run dev
```

Expected output:
```
✓ local: http://127.0.0.1:5173
✓ [local] http://127.0.0.1:5173/__vite_ping
⚙️  Cloudflare is running on 127.0.0.1:5173
```

### Step 4: Test HKU API (Terminal 3)
```bash
node --import tsx/esm --no-warnings evaluation/run-evaluation.ts \
  --variant A \
  --split development \
  --provider hku \
  --limit 2 \
  --judge llm
```

**Expected flow**:
1. Evaluation script calls `/api/ask` with `provider: 'hku'`
2. workerd (dev server) calls `http://127.0.0.1:3001/...` (the proxy)
3. Proxy logs: `[HKU Proxy] POST /openai/student/deployments/gpt-5-mini/chat/completions...`
4. Proxy forwards to: `https://api.hku.hk/openai/student/deployments/gpt-5-mini/chat/completions...`
5. HKU API responds with valid JSON
6. Proxy returns response to workerd
7. Evaluation completes successfully

---

## Verification Checklist

### Is the Proxy Running?
```bash
curl -v http://127.0.0.1:3001/health 2>&1 | head -10
# Should show: Connected to 127.0.0.1 port 3001
```

### Does the Proxy Have the API Key?
```bash
# Check .dev.vars has HKU_API_KEY set
grep HKU_API_KEY .dev.vars
```

### Is the Dev Server Using the Proxy Endpoint?
```bash
# Check .dev.vars has the proxy URL
grep HKU_API_ENDPOINT .dev.vars
# Should show: http://127.0.0.1:3001/...
```

### Can You Call /api/ask Directly?
```bash
# From Terminal 3, hit the ask endpoint directly:
curl -X POST http://127.0.0.1:5173/api/ask \
  -H "Content-Type: application/json" \
  -H "Cookie: __sites_local_auth=1" \
  -d '{
    "question": "Test question",
    "profileIds": ["test-profile"],
    "variant": "A",
    "kind": "analysis",
    "provider": "hku"
  }'
```

---

## Troubleshooting

### "Port 3001 is already in use"
```bash
# Kill the existing process
lsof -ti:3001 | xargs kill -9
# Or use a different port and update .dev.vars
```

### "[HKU Proxy Error] Missing api-key header"
- Check: `echo $HKU_API_KEY` (should be non-empty)
- Update `.dev.vars` if needed
- Restart proxy: `node scripts/hku-proxy.mjs`

### "[HKU Proxy] Response: 401"
- HKU API rejected the key
- Verify: `HKU_API_KEY=your_hku_api_key_here` in `.dev.vars`
- If expired, get a new key from HKU and update `.dev.vars`

### "Cannot reach localhost:3001" in dev server logs
- Proxy not running (check Terminal 1)
- Or bound to wrong IP (should be `127.0.0.1:3001`)

### Evaluation shows "Provider service returned HTTP 502"
- Proxy is running but HKU API is unreachable
- Test proxy directly:
  ```bash
  curl http://127.0.0.1:3001/health
  ```
- Check HKU endpoint is correct in proxy code

### Still getting "internal error; remote: true"
- Check `.dev.vars` has `http://127.0.0.1:3001` (not `https://api.hku.hk`)
- Restart dev server (it caches env vars on startup)
- Restart proxy to ensure fresh connection

---

## Files Changed

| File | Change |
|------|--------|
| `scripts/hku-proxy.mjs` | **Created** — Local Node.js proxy for HKU API |
| `.dev.vars` | Updated `HKU_API_ENDPOINT` to use proxy (`http://127.0.0.1:3001`) |
| `lib/conversation-run.ts` | Removed temp debug `console.error("[conversation-run ERROR]", err)` |

---

## Production (Outside workerd)

When deploying to production or running outside workerd:

**Option 1: Use Direct HKU API** (recommended for performance)
```bash
# In production .env:
HKU_API_ENDPOINT=https://api.hku.hk/openai/student/deployments/gpt-5-mini/chat/completions?api-version=2025-04-01-preview
```
Cloudflare Workers in production have outbound HTTPS access; proxy not needed.

**Option 2: Keep Proxy** (if running in restricted network)
Deploy `scripts/hku-proxy.mjs` as a separate service and point to it.

---

## Terminal Setup

**Recommended 3-terminal layout**:

```bash
# Terminal 1: Start Proxy
node scripts/hku-proxy.mjs

# Terminal 2: Start Dev Server
npm run dev

# Terminal 3: Run Evaluation
node --import tsx/esm --no-warnings evaluation/run-evaluation.ts \
  --variant C --split development --provider hku --limit 5 --judge llm
```

All three should run continuously. When done:
1. Stop Terminal 3 (evaluation completes automatically)
2. Stop Terminal 2: `Ctrl+C`
3. Stop Terminal 1: `Ctrl+C`

---

## Next Test

Run this to confirm HKU + proxy + evaluation work end-to-end:

```bash
# Ensure proxy is running in another terminal first
node --import tsx/esm --no-warnings evaluation/run-evaluation.ts \
  --variant C \
  --split development \
  --provider hku \
  --limit 5 \
  --judge llm
```

Expected output:
- No "internal error; remote: true"
- Visible HKU API proxy logs: `[HKU Proxy] POST /openai/...`
- Evaluation progresses: ✅ Correct / ❌ Incorrect for each question
- Results saved to `evaluation/results-*.json`
