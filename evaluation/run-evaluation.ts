#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import {parseArgs} from 'util';
import {fileURLToPath} from 'url';
import {parseCorpusToMessages, evaluateQuestion, type EvaluationResult, type EvaluationQuestion} from './fact-checker.js';

// ESM __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Auto-load .dev.vars from project root
const devVarsPath = path.join(__dirname, '..', '.dev.vars');
if (fs.existsSync(devVarsPath)) {
  const devVars = fs.readFileSync(devVarsPath, 'utf-8');
  devVars.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        const value = valueParts.join('=').trim();
        process.env[key.trim()] = value;
      }
    }
  });
  console.log(`✓ Loaded environment variables from .dev.vars\n`);
}

interface ManifestHistory {
  id: string;
  split: 'development' | 'test';
  setting: 'work' | 'friendship' | 'dating' | 'partnership';
  scenario_family: string;
  name: string;
  relationship: string;
  file: string;
  messages: number;
  questions: EvaluationQuestion[];
}

interface Manifest {
  schema: string;
  histories: ManifestHistory[];
}

interface AggregateMetrics {
  total_questions: number;
  answerable_questions: number;
  unanswerable_questions: number;
  correct_answerable: number;
  correct_unanswerable: number;
  accuracy: number; // correct_answerable / answerable_questions
  false_positive_rate: number; // 1 - (correct_unanswerable / unanswerable_questions)
  avg_latency_ms: number;
  avg_tokens_input?: number;
  avg_tokens_output?: number;
  coverage: number; // questions_attempted / total_questions

  // ← NEW: Cost metrics
  avg_model_calls?: number;
  avg_tool_calls?: number;
  avg_total_tokens?: number;

  // ← NEW: Privacy metrics
  avg_unique_messages_read?: number;
  avg_profiles_exposed?: number;
  total_unique_source_ids_exposed?: number;
  avg_source_characters_per_question?: number;

  // ← NEW: Efficiency metrics
  cost_per_correct_answer_tokens?: number;
  verification_depth_distribution?: {
    single_draft?: number;
    review_revise?: number;
    with_acquisition?: number;
  };
}

interface EvaluationReport {
  run_metadata: {
    timestamp: string;
    variant: string;
    kind: string;
    provider: string;
    split?: string;
    setting?: string;
    judge_method: string;
    limit?: number;
    independent?: boolean;
    names?: string;
  };
  per_question_results: Array<EvaluationResult & {history_id: string; history_name: string}>;
  aggregate_metrics: AggregateMetrics;
}

/**
 * 通過 API 設置 evaluation data
 */
async function setupEvaluationData(
  history: ManifestHistory,
  corpusText: string
): Promise<{profileId: string; sourceId: string}> {
  const baseUrl = process.env.API_BASE_URL || 'http://127.0.0.1:5173';
  const response = await fetch(`${baseUrl}/api/eval-setup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': '__sites_local_auth=1'
    },
    body: JSON.stringify({
      action: 'setup',
      historyId: history.id,
      historyName: history.name,
      relationship: history.relationship,
      corpusText
    })
  });

  if (!response.ok) {
    throw new Error(`Setup failed: ${response.status} ${await response.text()}`);
  }

  const result = await response.json() as any;
  return {profileId: result?.profileId, sourceId: result?.sourceId};
}

/**
 * 通過 API 清理 evaluation data
 */
async function cleanupEvaluationData(historyIds: string[]): Promise<void> {
  const baseUrl = process.env.API_BASE_URL || 'http://127.0.0.1:5173';
  const response = await fetch(`${baseUrl}/api/eval-setup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': '__sites_local_auth=1'
    },
    body: JSON.stringify({
      action: 'cleanup',
      historyIds
    })
  });

  if (!response.ok) {
    throw new Error(`Cleanup failed: ${response.status}`);
  }
}

/**
 * 清理 cache 確保每題獨立
 */
async function clearCache(): Promise<void> {
  const baseUrl = process.env.API_BASE_URL || 'http://127.0.0.1:5173';
  await fetch(`${baseUrl}/api/eval-setup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': '__sites_local_auth=1'
    },
    body: JSON.stringify({action: 'clear-cache'})
  });
}

/**
 * 計算聚合指標
 */
function calculateAggregateMetrics(results: EvaluationResult[]): AggregateMetrics {
  const answerable = results.filter(r => r.answerable && !r.error);
  const unanswerable = results.filter(r => !r.answerable && !r.error);

  const correctAnswerable = answerable.filter(r => r.correct).length;
  const correctUnanswerable = unanswerable.filter(r => r.correct).length;

  const validResults = results.filter(r => !r.error);

  const totalTokensInput = validResults.reduce((sum, r) => sum + (r.tokens?.input || 0), 0);
  const totalTokensOutput = validResults.reduce((sum, r) => sum + (r.tokens?.output || 0), 0);
  const totalLatency = validResults.reduce((sum, r) => sum + r.latency_ms, 0);

  // ← NEW: Cost metrics
  const totalModelCalls = validResults.reduce((sum, r) => sum + (r.model_calls ?? 0), 0);
  const totalToolCalls = validResults.reduce((sum, r) => sum + (r.tool_calls ?? 0), 0);
  const totalTokens = validResults.reduce((sum, r) => sum + ((r.input_tokens ?? 0) + (r.output_tokens ?? 0)), 0);

  // ← NEW: Privacy metrics
  const totalMessagesRead = validResults.reduce((sum, r) => sum + (r.unique_messages_read ?? 0), 0);
  const totalProfilesExposed = validResults.reduce((sum, r) => sum + (r.unique_profiles_exposed ?? 0), 0);
  const allSourceIds = new Set<string>();
  for (const r of validResults) {
    if (r.source_ids_accessed && Array.isArray(r.source_ids_accessed)) {
      for (const id of r.source_ids_accessed) {
        allSourceIds.add(id);
      }
    }
  }
  const totalSourceCharacters = validResults.reduce((sum, r) => sum + (r.total_source_characters ?? 0), 0);

  // ← NEW: Verification depth distribution
  const depthDistribution: {single_draft?: number; review_revise?: number; with_acquisition?: number} = {};
  for (const r of validResults) {
    const method = r.retrieval_method ?? 'single_draft';
    depthDistribution[method as keyof typeof depthDistribution] =
      (depthDistribution[method as keyof typeof depthDistribution] ?? 0) + 1;
  }

  const correctAnswers = validResults.filter(r => r.correct).length;
  const costPerCorrectTokens =
    correctAnswers > 0 ? totalTokens / correctAnswers : undefined;

  return {
    total_questions: results.length,
    answerable_questions: answerable.length,
    unanswerable_questions: unanswerable.length,
    correct_answerable: correctAnswerable,
    correct_unanswerable: correctUnanswerable,
    accuracy: answerable.length > 0 ? correctAnswerable / answerable.length : 0,
    false_positive_rate: unanswerable.length > 0 ? 1 - (correctUnanswerable / unanswerable.length) : 0,
    avg_latency_ms: validResults.length > 0 ? totalLatency / validResults.length : 0,
    avg_tokens_input: validResults.length > 0 ? totalTokensInput / validResults.length : undefined,
    avg_tokens_output: validResults.length > 0 ? totalTokensOutput / validResults.length : undefined,
    coverage: results.length > 0 ? validResults.length / results.length : 0,

    // ← NEW: Cost metrics
    avg_model_calls: validResults.length > 0 ? totalModelCalls / validResults.length : undefined,
    avg_tool_calls: validResults.length > 0 ? totalToolCalls / validResults.length : undefined,
    avg_total_tokens: validResults.length > 0 ? totalTokens / validResults.length : undefined,

    // ← NEW: Privacy metrics
    avg_unique_messages_read: validResults.length > 0 ? totalMessagesRead / validResults.length : undefined,
    avg_profiles_exposed: validResults.length > 0 ? totalProfilesExposed / validResults.length : undefined,
    total_unique_source_ids_exposed: allSourceIds.size,
    avg_source_characters_per_question: validResults.length > 0 ? totalSourceCharacters / validResults.length : undefined,

    // ← NEW: Efficiency metrics
    cost_per_correct_answer_tokens: costPerCorrectTokens,
    verification_depth_distribution: depthDistribution
  };
}

async function main() {
  const {values} = parseArgs({
    options: {
      split: {type: 'string'},
      setting: {type: 'string'},
      variant: {type: 'string', default: 'A'},
      kind: {type: 'string', default: 'analysis'},
      limit: {type: 'string'},
      judge: {type: 'string', default: 'llm'},
      provider: {type: 'string', default: 'poe'},
      owner: {type: 'string', default: 'eval-owner'},
      'db-path': {type: 'string', default: '.wrangler/state/v3/d1/miniflare-D1DatabaseObject'},
      independent: {type: 'boolean', default: false},
      names: {type: 'string'}
    }
  });

  const variant = values.variant as 'A' | 'B' | 'C' | 'B-wide';
  const kind = values.kind as 'analysis' | 'chat' | 'draft' | 'network';
  const judgeMethod = values.judge as 'llm' | 'keyword';
  const provider = values.provider as string;
  const owner = values.owner as string;
  const limit = values.limit ? parseInt(values.limit, 10) : undefined;
  const independent = values.independent === true;
  if (independent && process.env.EVALUATION_ISOLATED_DATABASE !== '1') {
    throw new Error('Independent evaluation requires an isolated database: setup and cleanup replace or delete evaluation records, and /api/ask clears the owner retrieval cache. Set EVALUATION_ISOLATED_DATABASE=1 only after starting a server with a separate database.');
  }

  // 讀取 manifest
  const manifestPath = path.join(__dirname, 'manifest.json');
  const manifest: Manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

  // 過濾 histories
  let histories = manifest.histories;

  if (values.names) {
    const names = new Set(values.names.split(',').map(name => name.trim().toLowerCase()));
    histories = histories.filter(h => names.has(h.name.toLowerCase()));
    if (histories.length !== names.size) throw new Error('One or more requested names were not found uniquely in the manifest.');
  }

  if (values.split) {
    histories = histories.filter(h => h.split === values.split);
  }

  if (values.setting) {
    histories = histories.filter(h => h.setting === values.setting);
  }

  if (limit) {
    histories = histories.slice(0, limit);
  }

  console.log(`\n🔬 Starting evaluation:`);
  console.log(`   Variant: ${variant}`);
  console.log(`   Kind: ${kind}`);
  console.log(`   Provider: ${provider}`);
  console.log(`   Judge: ${judgeMethod}`);
  console.log(`   Histories: ${histories.length}`);
  console.log(`   Total questions: ${histories.reduce((sum, h) => sum + h.questions.length, 0)}\n`);

  const apiBaseUrl = process.env.API_BASE_URL || 'http://127.0.0.1:5173';

  console.log(`⚠️  Please ensure local dev server is running (npm run dev)`);
  console.log(`   This script will use the local API at ${apiBaseUrl}\n`);

  const allResults: Array<EvaluationResult & {history_id: string; history_name: string}> = [];
  const historyIds: string[] = [];

  try {
    for (const history of histories) {
      console.log(`\n📁 Processing ${history.id} (${history.name})...`);

      historyIds.push(history.id);

      // 讀取 corpus 檔案
      const corpusPath = path.join(__dirname, 'corpus', history.file);
      const corpusText = fs.readFileSync(corpusPath, 'utf-8');

      // 設置 evaluation data
      const {profileId} = await setupEvaluationData(history, corpusText);

      // 評估每個問題
      for (const question of history.questions) {
        console.log(`   ❓ ${question.id}: ${question.question.substring(0, 60)}...`);

        const result = await evaluateQuestion(
          question,
          profileId,
          variant,
          kind,
          judgeMethod,
          provider,
          independent
        );

        allResults.push({
          ...result,
          history_id: history.id,
          history_name: history.name
        });

        const icon = result.error ? '❌' : result.correct ? '✅' : '❌';
        console.log(`      ${icon} ${result.correct ? 'Correct' : result.error ? 'Error' : 'Incorrect'} (${result.latency_ms}ms)`);

        // 清理 cache 與 turns，確保每題獨立
        if (!independent) await clearCache();
      }
    }

    // 計算聚合指標
    const aggregateMetrics = calculateAggregateMetrics(allResults);

    // 建立報告
    const report: EvaluationReport = {
      run_metadata: {
        timestamp: new Date().toISOString(),
        variant,
        kind,
        provider,
        split: values.split as string | undefined,
        setting: values.setting as string | undefined,
        judge_method: judgeMethod,
        limit,
        independent,
        names: values.names
      },
      per_question_results: allResults,
      aggregate_metrics: aggregateMetrics
    };

    // 儲存結果
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const resultPath = path.join(__dirname, `results-${timestamp}.json`);
    fs.writeFileSync(resultPath, JSON.stringify(report, null, 2));

    // 輸出摘要
    console.log(`\n\n📊 Evaluation Summary:`);
    console.log(`   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`   Total questions:        ${aggregateMetrics.total_questions}`);
    console.log(`   Answerable:             ${aggregateMetrics.answerable_questions}`);
    console.log(`   Unanswerable:           ${aggregateMetrics.unanswerable_questions}`);
    console.log(`   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`   Accuracy (answerable):  ${(aggregateMetrics.accuracy * 100).toFixed(2)}%`);
    console.log(`   False Positive Rate:    ${(aggregateMetrics.false_positive_rate * 100).toFixed(2)}%`);
    console.log(`   Avg Latency:            ${aggregateMetrics.avg_latency_ms.toFixed(0)}ms`);
    if (aggregateMetrics.avg_tokens_input) {
      console.log(`   Avg Tokens (in/out):    ${aggregateMetrics.avg_tokens_input.toFixed(0)} / ${aggregateMetrics.avg_tokens_output?.toFixed(0)}`);
    }
    console.log(`   Coverage:               ${(aggregateMetrics.coverage * 100).toFixed(2)}%`);
    console.log(`   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    console.log(`✅ Results saved to: ${resultPath}\n`);

  } finally {
    // 清理所有 evaluation data
    console.log(`\n🧹 Cleaning up evaluation data...`);
    await cleanupEvaluationData(historyIds);
    console.log(`✅ Cleanup complete.\n`);
  }
}

main().catch(error => {
  console.error(`\n❌ Evaluation failed:`, error);
  process.exit(1);
});
