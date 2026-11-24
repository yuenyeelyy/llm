# HKU & POE Provider Setup Guide

## ✅ Setup Complete

This document summarizes the provider configuration that enables seamless switching between **POE** (GPT-5.4) and **HKU** (gpt-5-mini) for evaluation testing.

---

## 1. Configuration Files Updated

### `.dev.vars` — API Keys & Models
```
# POE Configuration
POE_API_KEY=your_poe_api_key_here
POE_MODEL=GPT-5.4
JUDGE_MODEL=claude-sonnet-5.5

# HKU Configuration (gpt-5-mini for lightweight comparison)
HKU_API_KEY=your-hku-api-key-here
HKU_MODEL=gpt-5-mini
HKU_API_ENDPOINT=https://your-hku-api-endpoint.com/v1/chat/completions
```

**Action Required**: Replace `your-hku-api-key-here` and `HKU_API_ENDPOINT` with actual HKU credentials.

### `lib/model-config.ts` — Provider Detection
- **Added**: HKU provider branch with `gpt-5-mini` default model
- **Added**: `rateLimit: 13000` (ms) for HKU-only throttling
- Configures endpoint, auth header, and token field per provider

### `lib/agent.ts` — Rate Limiting & Retry Logic
- **Added**: `providerLastRequestTime` map to track request timing per provider
- **Added**: `applyProviderRateLimit()` function:
  - **POE**: No delay (unlimited requests within POE limits)
  - **HKU**: 13-14 second mandatory delay between requests (5 RPM × 60 sec = 12 sec base)
- **Added**: Automatic retry on HTTP 429 (rate limit errors):
  - Up to 3 attempts
  - Exponential backoff: waits 30-60s before retry
  - Respects `Retry-After` header if provided
  - **POE unaffected**: keeps full speed when no 429 errors

---

## 2. How It Works

### Provider Selection
You choose the provider via `--provider` CLI flag in `evaluation/run-evaluation.ts`:

```bash
--provider poe     # Uses POE gpt-5.4 (fast, 30 req/min limit)
--provider hku     # Uses HKU gpt-5-mini (lightweight, 5 req/min limit)
```

### Judge (Always POE)
Regardless of which provider you use for the main test, the judge **always** uses POE Claude Sonnet 5.5 to maintain scoring consistency:
- Prevents provider-based bias in correctness judgment
- Preserves your HKU daily quota for the main evaluation

---

## 3. Future CLI Command Reference

### Template
```bash
node --import tsx/esm --no-warnings evaluation/run-evaluation.ts \
  --variant <A|B|C> \
  --split <development|test> \
  --provider <poe|hku> \
  --limit <number> \
  --judge llm
```

### Common Commands

#### POE (GPT-5.4) — Full Test Suite
```bash
# Development split, Variant A (single draft), limit 5
node --import tsx/esm --no-warnings evaluation/run-evaluation.ts \
  --variant A \
  --split development \
  --provider poe \
  --limit 5 \
  --judge llm

# Development split, Variant B (review/revise, no acquisition), limit 25
node --import tsx/esm --no-warnings evaluation/run-evaluation.ts \
  --variant B \
  --split development \
  --provider poe \
  --limit 25 \
  --judge llm

# Development split, Variant C (full: review/revise/acquisition), limit 25
node --import tsx/esm --no-warnings evaluation/run-evaluation.ts \
  --variant C \
  --split development \
  --provider poe \
  --limit 25 \
  --judge llm
```

#### HKU (GPT-5-Mini) — Lightweight Comparison
```bash
# Development split, Variant A (single draft), limit 5
# Rate limiting: ~13 seconds between requests (no visible delays in output)
node --import tsx/esm --no-warnings evaluation/run-evaluation.ts \
  --variant A \
  --split development \
  --provider hku \
  --limit 5 \
  --judge llm

# Development split, Variant B, limit 5 (~ 65 seconds total for 5 questions)
node --import tsx/esm --no-warnings evaluation/run-evaluation.ts \
  --variant B \
  --split development \
  --provider hku \
  --limit 5 \
  --judge llm

# Development split, Variant C, limit 5 (~ 65 seconds for main + tool calls)
# IMMEDIATE: Run this next to test HKU setup
node --import tsx/esm --no-warnings evaluation/run-evaluation.ts \
  --variant C \
  --split development \
  --provider hku \
  --limit 5 \
  --judge llm
```

---

## 4. What to Expect

### POE (--provider poe)
- **Speed**: Minimal delays, respects POE's 30 req/min limit
- **Model**: GPT-5.4 (large, full reasoning)
- **Cost**: Higher per token
- **Latency**: Low (usually < 10s per question for Variant A)

### HKU (--provider hku)
- **Speed**: 13-14 second **mandatory delay** between requests (visible in logs)
  - Single question takes ~13s just for rate limit throttling
  - Variant A with limit=5 ≈ 65 seconds
  - Variant C with limit=5 ≈ 65+ seconds (+ tool call time)
- **Model**: gpt-5-mini (lightweight, optimized for speed/cost)
- **Quota**: 5 req/min limit enforced automatically
- **Retry**: Auto-retries on 429 errors (waits 30-60s, then resumes)

### Judge (Always POE Claude Sonnet 5.5)
- Runs in parallel with main evaluation
- Consumes POE quota independently
- Usually completes within 2-3 seconds per question

---

## 5. Rate Limiting Details

### HKU Request Flow
```
1. Wait for 13-14 second interval (if last request < 13s ago)
   └─ Respects 5 requests per minute = ~12 second spacing
2. Send API request
3. If HTTP 429 (rate limit hit):
   └─ Read Retry-After header (default 30-60 seconds)
   └─ Wait that duration
   └─ Retry (up to 3 total attempts)
4. Mark request time + continue to next question
```

### Why No Delays for POE?
- POE's 30 req/min limit is 1 request every 2 seconds
- Variant C is multi-stage (draft → review → revise → final_check = 4 calls)
- Evaluation adds judge calls in parallel
- POE rate-limiting is automatic at their API level
- We rely on POE's HTTP 429 responses for backoff

---

## 6. Troubleshooting

### "HKU_API_KEY environment variable is required"
→ Add valid key to `.dev.vars` and restart dev server or evaluation

### "Provider reports a rate limit (HTTP 429)"
→ **For POE**: Usually exceeding 30 req/min; wait a minute, then retry  
→ **For HKU**: Should be auto-handled by retry logic; if still failing, check quota reset time

### High latency or timeout on HKU evaluation
→ Check if 13-14 second delays are showing in console (expected behavior)  
→ Variant C is slower due to multi-stage reasoning + rate limits  
→ Consider running smaller `--limit` batches (e.g., --limit 5 instead of --limit 25)

### Results show low accuracy with HKU
→ gpt-5-mini is intentionally lightweight; expect slightly lower accuracy vs GPT-5.4  
→ This is the expected cost/accuracy tradeoff you're measuring

---

## 7. Files Modified

| File | Change |
|------|--------|
| `.dev.vars` | Added HKU_API_KEY, HKU_MODEL, HKU_API_ENDPOINT |
| `lib/model-config.ts` | Added HKU provider branch with rateLimit config |
| `lib/agent.ts` | Added `applyProviderRateLimit()` + retry logic for 429 errors |

---

## Next Steps

1. **Fill in HKU credentials** in `.dev.vars` (HKU_API_KEY, HKU_API_ENDPOINT)
2. **Test POE** (verify existing setup still works):
   ```bash
   npm run dev
   # In another terminal:
   node --import tsx/esm --no-warnings evaluation/run-evaluation.ts \
     --variant A --split development --provider poe --limit 2 --judge llm
   ```
3. **Test HKU** (verify new provider works):
   ```bash
   # Same dev server running
   node --import tsx/esm --no-warnings evaluation/run-evaluation.ts \
     --variant A --split development --provider hku --limit 2 --judge llm
   ```
4. **Run full comparison** (POE A/B/C vs HKU A/B/C):
   - Use command reference above
   - Compare accuracy, latency, token usage in `results-*.json` files
   - Both judges use POE (fair comparison)

---

## Quick Start: HKU gpt-5-mini Variant C (Immediate Test)

**Terminal 1** (dev server):
```bash
npm run dev
```

**Terminal 2** (evaluation):
```bash
node --import tsx/esm --no-warnings evaluation/run-evaluation.ts \
  --variant C \
  --split development \
  --provider hku \
  --limit 5 \
  --judge llm
```

**Expected output**: 
- 5 questions evaluated with HKU gpt-5-mini
- Visible 13-14 second delays between requests (shown in console)
- Results saved to `evaluation/results-*.json`
- Judge runs with POE (consistent scoring)
