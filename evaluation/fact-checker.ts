// Independent type definitions for evaluation (no cloudflare: dependencies)
export type Message = {
  id: string;
  profile_id: string;
  source_id: string;
  speaker: string;
  timestamp: string;
  body: string;
  start: number;
  end: number;
  source_version?: number;
  line_start?: number;
  line_end?: number;
  raw_header?: string;
};

export type QuestionType = 'fact' | 'temporal' | 'ambiguity' | 'distributed' | 'underdetermined' | 'network';

export interface EvaluationQuestion {
  id: string;
  question: string;
  answerable: boolean;
  essential?: string[];
  evidence_lines?: number[];
}

export interface EvaluationResult {
  question: string;
  question_id: string;
  model_answer: string;
  answerable: boolean;
  essential: string[];
  latency_ms: number;
  tokens?: {input?: number; output?: number};
  retrieval_metrics?: any;
  correct?: boolean;
  judge_reasoning?: string;
  error?: string;

  // Cost & Privacy Tracking
  model_calls?: number;
  tool_calls?: number;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;

  // Privacy Exposure
  unique_messages_read?: number;
  unique_profiles_exposed?: number;
  source_ids_accessed?: string[];
  total_source_characters?: number;

  // Process Quality
  retrieval_method?: 'single_draft' | 'review_revise' | 'with_acquisition';
  findings_generated?: number;
  verification_stages_completed?: number;
  raw_answer?: unknown;
}

/**
 * 解析 corpus txt 格式成 Message[]
 * 格式: [DD/MM/YYYY, HH:MM:SS] Sender: Message
 */
export function parseCorpusToMessages(
  corpusText: string,
  historyId: string,
  profileId: string
): Message[] {
  const lines = corpusText.split('\n');
  const messages: Message[] = [];
  let currentOffset = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track offset including newline
    const lineLength = line.length + 1; // +1 for \n

    if (!line.trim()) {
      currentOffset += lineLength;
      continue;
    }

    // Parse: [DD/MM/YYYY, HH:MM:SS] Sender: Message
    const match = line.match(/^\[(\d{2})\/(\d{2})\/(\d{4}),\s*(\d{2}):(\d{2}):(\d{2})\]\s+([^:]+):\s*(.*)$/);
    if (!match) {
      currentOffset += lineLength;
      continue;
    }

    const [fullMatch, day, month, year, hour, minute, second, speaker, bodyText] = match;

    // Convert DD/MM/YYYY HH:MM:SS to ISO 8601
    const timestamp = `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`;

    // Calculate exact positions in original text
    // Find where the body text starts in the original line
    const headerPattern = `[${day}/${month}/${year}, ${hour}:${minute}:${second}] ${speaker}: `;
    const bodyStartInLine = line.indexOf(bodyText);

    const start = currentOffset + bodyStartInLine;
    const end = start + bodyText.length;

    const messageId = `${historyId}@${i + 1}`;

    messages.push({
      id: messageId,
      profile_id: profileId,
      source_id: historyId,
      speaker: speaker.trim(),
      timestamp,
      body: bodyText, // Keep original text, DO NOT trim
      start,
      end,
      source_version: 1,
      line_start: i + 1,
      line_end: i + 1,
      raw_header: headerPattern
    });

    currentOffset += lineLength;
  }

  return messages;
}

/**
 * 呼叫本地 /api/ask endpoint
 */
export async function callLocalAsk(params: {
  question: string;
  profileIds: string[];
  variant: 'A' | 'B' | 'C' | 'B-wide';
  kind: 'analysis' | 'chat' | 'draft' | 'network';
  from?: string;
  to?: string;
  sourceIds?: string[];
  independent?: boolean;
  provider?: string;
}): Promise<any> {
  const startTime = Date.now();

  const baseUrl = process.env.API_BASE_URL || 'http://127.0.0.1:5173';
  const response = await fetch(`${baseUrl}/api/ask`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': '__sites_local_auth=1'
    },
    body: JSON.stringify({
      question: params.question,
      profileIds: params.profileIds,
      variant: params.variant,
      kind: params.kind,
      from: params.from,
      to: params.to,
      sourceIds: params.sourceIds || [],
      independent: params.independent ?? false,
      provider: params.provider || 'poe-sonnet'  // Default to poe-sonnet (Claude Sonnet 5.5)
    })
  });

  const latency = Date.now() - startTime;

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API call failed (${response.status}): ${errorText}`);
  }

  const result = await response.json();
  return {result, latency};
}

/**
 * 使用 LLM judge 判斷答案是否正確
 * 固定使用 POE API (Claude-Sonnet-4) 確保客觀公平評估
 */
export async function judgeAnswerWithLLM(
  question: string,
  modelAnswer: string,
  essential: string[],
  answerable: boolean
): Promise<{correct: boolean; reasoning: string}> {
  // For both answerable and unanswerable questions, use POE API with Claude as judge
  const poeApiKey = process.env.POE_API_KEY;
  if (!poeApiKey) {
    throw new Error('POE_API_KEY environment variable is required for LLM judge');
  }

  const judgeModel = process.env.JUDGE_MODEL || 'claude-sonnet-5.5';

  let judgePrompt: string;

  if (!answerable) {
    // For unanswerable/underdetermined questions, judge if model correctly indicated uncertainty
    judgePrompt = `You are evaluating whether a model correctly handled an UNANSWERABLE question.

Question: ${question}

This question CANNOT be definitively answered based on the available information. The correct behavior is to:
- Indicate uncertainty or lack of information
- Avoid making definitive claims without evidence
- Use phrases like "not enough information", "cannot determine", "unclear", "insufficient evidence", "no direct evidence", etc.

Model's answer:
${modelAnswer}

Did the model correctly indicate uncertainty/lack of information (correct: true), or did it provide a definitive answer despite insufficient evidence (correct: false - false positive)?

Respond with a JSON object:
{
  "correct": true or false,
  "reasoning": "brief explanation of your judgment"
}`;
  } else {
    // For answerable questions, check if essential points are covered
    judgePrompt = `You are evaluating whether a model's answer to a question contains the essential information points.

Question: ${question}

Essential points that MUST be present (at least the key concepts):
${essential.map((e, i) => `${i + 1}. ${e}`).join('\n')}

Model's answer:
${modelAnswer}

Does the model's answer contain all the essential points (or their clear synonyms/equivalents)?
Respond with a JSON object:
{
  "correct": true or false,
  "reasoning": "brief explanation of your judgment"
}`;
  }

  // Retry logic: up to 3 attempts with exponential backoff
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const judgeResponse = await fetch('https://api.poe.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${poeApiKey}`
        },
        body: JSON.stringify({
          model: judgeModel,
          messages: [{role: 'user', content: judgePrompt}],
          temperature: 0,
          max_tokens: 500
        })
      });

      if (!judgeResponse.ok) {
        const errorText = await judgeResponse.text();
        throw new Error(`Judge API ${judgeResponse.status}: ${errorText.substring(0, 200)}`);
      }

      const judgeResult = await judgeResponse.json() as any;
      const judgeText = judgeResult?.choices?.[0]?.message?.content;

      // Try to parse JSON from response
      let judgment;
      try {
        judgment = JSON.parse(judgeText);
      } catch {
        // If not valid JSON, try to extract from markdown code block
        const jsonMatch = judgeText.match(/```json\s*(\{[\s\S]*?\})\s*```/);
        if (jsonMatch) {
          judgment = JSON.parse(jsonMatch[1]);
        } else {
          // Try to find JSON object in text
          const objectMatch = judgeText.match(/\{[\s\S]*?"correct"[\s\S]*?"reasoning"[\s\S]*?\}/);
          if (objectMatch) {
            judgment = JSON.parse(objectMatch[0]);
          } else {
            throw new Error(`Failed to parse judge response: ${judgeText.substring(0, 100)}`);
          }
        }
      }

      return {
        correct: judgment.correct,
        reasoning: judgment.reasoning
      };

    } catch (error: any) {
      lastError = error;
      console.error(`[Judge] Attempt ${attempt}/3 failed:`, error.message);

      // If this is not the last attempt, wait before retrying
      if (attempt < 3) {
        const delayMs = Math.pow(2, attempt) * 1000; // 2s, 4s
        console.log(`[Judge] Retrying in ${delayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  // If all retries failed, throw the last error
  throw lastError || new Error('Judge API call failed after 3 attempts');
}

/**
 * 使用關鍵字 match 判斷答案（快速備用方案）
 */
export function judgeAnswerWithKeywords(
  modelAnswer: string,
  essential: string[],
  answerable: boolean
): {correct: boolean; reasoning: string} {
  if (!answerable) {
    const lowerAnswer = modelAnswer.toLowerCase();
    const refusalPatterns = [
      'not enough information',
      'cannot determine',
      'insufficient',
      'unclear',
      'don\'t know',
      'unable to',
      'not mentioned',
      'no evidence'
    ];

    const hasRefusal = refusalPatterns.some(pattern => lowerAnswer.includes(pattern));

    return {
      correct: hasRefusal,
      reasoning: hasRefusal
        ? 'Answer indicates uncertainty (keyword match)'
        : 'Answer was definitive when it should not be'
    };
  }

  // For answerable questions, check if all essential keywords are present
  const lowerAnswer = modelAnswer.toLowerCase();
  const matchedPoints = essential.filter(point => {
    const lowerPoint = point.toLowerCase();
    return lowerAnswer.includes(lowerPoint);
  });

  const correct = matchedPoints.length === essential.length;

  return {
    correct,
    reasoning: `Matched ${matchedPoints.length}/${essential.length} essential points (keyword match)`
  };
}

/**
 * 評估單一問題
 */
export async function evaluateQuestion(
  question: EvaluationQuestion,
  profileId: string,
  variant: 'A' | 'B' | 'C' | 'B-wide',
  kind: 'analysis' | 'chat' | 'draft' | 'network',
  judgeMethod: 'llm' | 'keyword' = 'llm',
  provider: string = 'poe',
  independent: boolean = false
): Promise<EvaluationResult> {
  try {
    const {result, latency} = await callLocalAsk({
      question: question.question,
      profileIds: [profileId],
      variant,
      kind,
      independent,
      provider
    });

    // Parse answer from result
    let modelAnswer = '';
    let tokens = {};
    let retrievalMetrics = {};
    let modelCalls = 0;
    let toolCalls = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let uniqueMessagesRead = 0;
    let profilesExposed = 0;
    let sourceIdsAccessed: string[] = [];
    let totalSourceCharacters = 0;
    let retrievalMethod: 'single_draft' | 'review_revise' | 'with_acquisition' = 'single_draft';
    let findingsGenerated = 0;
    let verificationStagesCompleted = 0;

    if (result.answer) {
      const answerObj = typeof result.answer === 'string' ? JSON.parse(result.answer) : result.answer;

      // Extract text answer from various formats
      if (answerObj.overview) {
        modelAnswer = answerObj.overview;
      } else if (answerObj.draft_message) {
        modelAnswer = answerObj.draft_message;
      } else if (answerObj.findings && answerObj.findings.length > 0) {
        modelAnswer = answerObj.findings.map((f: any) => f.text).join('\n');
      } else if (answerObj.candidates && answerObj.candidates.length > 0) {
        // Network questions: extract from candidates
        modelAnswer = answerObj.candidates.map((c: any) =>
          `${c.profile_id}: ${c.fit_reason || 'No reason provided'}`
        ).join('\n');
      } else if (answerObj.next_question && answerObj.next_question.trim()) {
        // Clarification questions
        modelAnswer = `Clarification needed: ${answerObj.next_question}`;
      } else if (typeof answerObj === 'string') {
        modelAnswer = answerObj;
      } else if (answerObj.status) {
        // Fallback: use status as indicator
        modelAnswer = `Status: ${answerObj.status} (no detailed answer generated)`;
      }

      // ← NEW: Collect cost metrics
      if (answerObj.metrics) {
        tokens = answerObj.metrics.tokens || {};
        retrievalMetrics = answerObj.metrics.retrieval || {};

        modelCalls = answerObj.metrics.model_calls ?? 0;
        toolCalls = answerObj.metrics.tool_calls ?? 0;
        inputTokens = answerObj.metrics.input_tokens ?? 0;
        outputTokens = answerObj.metrics.output_tokens ?? 0;
        uniqueMessagesRead = answerObj.metrics.unique_messages ?? 0;
        profilesExposed = answerObj.metrics.people_exposed ?? 1;
        totalSourceCharacters = answerObj.metrics.source_characters ?? 0;

        // Collect all source IDs from findings
        if (answerObj.findings && Array.isArray(answerObj.findings)) {
          findingsGenerated = answerObj.findings.length;
          for (const f of answerObj.findings) {
            if (f.citations && Array.isArray(f.citations)) {
              for (const c of f.citations) {
                if (c.id && !sourceIdsAccessed.includes(c.id)) {
                  sourceIdsAccessed.push(c.id);
                }
              }
            }
          }
        }

        // Determine retrieval method from trace
        if (answerObj.trace && Array.isArray(answerObj.trace)) {
          const stageSet = new Set<string>();
          for (const t of answerObj.trace) {
            if (['draft', 'review', 'revise', 'final_check'].includes(t.stage)) {
              stageSet.add(t.stage);
            }
            if (t.stage === 'acquisition') {
              retrievalMethod = 'with_acquisition';
            }
          }
          verificationStagesCompleted = stageSet.size;

          if (verificationStagesCompleted === 0) {
            retrievalMethod = 'single_draft';
          } else if (retrievalMethod !== 'with_acquisition' && verificationStagesCompleted >= 2) {
            retrievalMethod = 'review_revise';
          }
        }
      }
    }

    // Judge correctness
    let correct = false;
    let judgeReasoning = '';

    if (judgeMethod === 'llm') {
      try {
        const judgment = await judgeAnswerWithLLM(
          question.question,
          modelAnswer,
          question.essential || [],
          question.answerable
        );
        correct = judgment.correct;
        judgeReasoning = judgment.reasoning;
      } catch (judgeError: any) {
        // If judge fails, mark as error but keep the model answer
        console.error(`[Judge Error] ${question.question.substring(0, 50)}...`, judgeError.message);
        judgeReasoning = `Judge failed: ${judgeError.message}`;
        correct = false; // Default to incorrect if judge fails
      }
    } else {
      const judgment = judgeAnswerWithKeywords(
        modelAnswer,
        question.essential || [],
        question.answerable
      );
      correct = judgment.correct;
      judgeReasoning = judgment.reasoning;
    }

    return {
      question: question.question,
      question_id: question.id,
      model_answer: modelAnswer, // Always preserve model_answer
      answerable: question.answerable,
      essential: question.essential || [],
      latency_ms: latency,
      tokens,
      retrieval_metrics: retrievalMetrics,
      correct,
      judge_reasoning: judgeReasoning,

      // ← NEW: Cost & Privacy metrics
      model_calls: modelCalls,
      tool_calls: toolCalls,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
      unique_messages_read: uniqueMessagesRead,
      unique_profiles_exposed: profilesExposed,
      source_ids_accessed: sourceIdsAccessed,
      total_source_characters: totalSourceCharacters,
      retrieval_method: retrievalMethod,
      findings_generated: findingsGenerated,
      verification_stages_completed: verificationStagesCompleted,
      raw_answer: result.answer
    };

  } catch (error: any) {
    return {
      question: question.question,
      question_id: question.id,
      model_answer: '', // Empty if API call itself failed
      answerable: question.answerable,
      essential: question.essential || [],
      latency_ms: 0,
      error: error.message
    };
  }
}
