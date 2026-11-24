#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import {fileURLToPath} from 'url';
import {judgeAnswerWithLLM} from './fact-checker.js';

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

/**
 * 重新評分已有的評估結果
 * 只重新評分 underdetermined 問題，不重新呼叫 GPT-5.4
 */

const resultsPath = process.argv[2] || '/Users/tsehoiyi/Desktop/llm/evaluation/results-2026-11-24T05-05-51-554Z.json';

async function main() {
  console.log(`📂 Loading results from: ${resultsPath}\n`);

  // 讀取現有結果
  const results = JSON.parse(fs.readFileSync(resultsPath, 'utf-8'));

  // 找出所有 unanswerable (underdetermined) 的題目
  const undeterminedResults = results.per_question_results.filter(
    (r: any) => !r.answerable
  );

  console.log(`Found ${undeterminedResults.length} underdetermined questions\n`);

  if (undeterminedResults.length === 0) {
    console.log('No underdetermined questions to re-judge.');
    return;
  }

  // 重新評分
  let reJudged = 0;
  for (const result of undeterminedResults) {
    if (result.error || !result.model_answer) {
      console.log(`⏭️  Skipping ${result.question_id} (has error or no model_answer)`);
      continue;
    }

    console.log(`🔄 Re-judging ${result.question_id}: ${result.question.substring(0, 60)}...`);

    try {
      const judgment = await judgeAnswerWithLLM(
        result.question,
        result.model_answer,
        result.essential || [],
        result.answerable
      );

      // 更新結果
      result.correct = judgment.correct;
      result.judge_reasoning = judgment.reasoning;

      const icon = judgment.correct ? '✅' : '❌';
      console.log(`   ${icon} ${judgment.correct ? 'Correct' : 'Incorrect'}: ${judgment.reasoning.substring(0, 80)}\n`);

      reJudged++;

      // 避免 rate limit，稍微延遲
      await new Promise(resolve => setTimeout(resolve, 500));

    } catch (error: any) {
      console.error(`   ❌ Judge failed: ${error.message}\n`);
      result.judge_reasoning = `Re-judge failed: ${error.message}`;
    }
  }

  // 重新計算聚合指標
  console.log(`\n📊 Recalculating aggregate metrics...\n`);

  const answerable = results.per_question_results.filter((r: any) => r.answerable && !r.error);
  const unanswerable = results.per_question_results.filter((r: any) => !r.answerable && !r.error);

  const correctAnswerable = answerable.filter((r: any) => r.correct).length;
  const correctUnanswerable = unanswerable.filter((r: any) => r.correct).length;

  results.aggregate_metrics.correct_answerable = correctAnswerable;
  results.aggregate_metrics.correct_unanswerable = correctUnanswerable;
  results.aggregate_metrics.accuracy = answerable.length > 0 ? correctAnswerable / answerable.length : 0;
  results.aggregate_metrics.false_positive_rate = unanswerable.length > 0 ? 1 - (correctUnanswerable / unanswerable.length) : 0;

  // 儲存更新後的結果
  const outputPath = resultsPath.replace('.json', '-rejudged.json');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));

  console.log(`✅ Re-judged ${reJudged} underdetermined questions`);
  console.log(`📊 Updated metrics:`);
  console.log(`   Accuracy (answerable):  ${(results.aggregate_metrics.accuracy * 100).toFixed(2)}%`);
  console.log(`   False Positive Rate:    ${(results.aggregate_metrics.false_positive_rate * 100).toFixed(2)}%`);
  console.log(`\n💾 Saved to: ${outputPath}\n`);
}

main().catch(error => {
  console.error(`\n❌ Re-judge failed:`, error);
  process.exit(1);
});
