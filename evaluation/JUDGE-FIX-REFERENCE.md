// 完整版本：evaluation/fact-checker.ts 的 judgeAnswerWithLLM 函數（包含重試機制）

export async function judgeAnswerWithLLM(
  question: string,
  modelAnswer: string,
  essential: string[],
  answerable: boolean
): Promise<{correct: boolean; reasoning: string}> {
  if (!answerable) {
    // For unanswerable questions, check if model correctly refused or showed uncertainty
    const lowerAnswer = modelAnswer.toLowerCase();
    const refusalPatterns = [
      'not enough information',
      'cannot determine',
      'insufficient',
      'unclear',
      "don't know",
      'unable to',
      'not mentioned',
      'no evidence',
      'ambiguous'
    ];

    const hasRefusal = refusalPatterns.some(pattern => lowerAnswer.includes(pattern));

    return {
      correct: hasRefusal,
      reasoning: hasRefusal
        ? 'Model correctly indicated uncertainty or lack of information'
        : 'Model provided a definitive answer when information was insufficient (false positive)'
    };
  }

  // For answerable questions, use POE API with Claude-Sonnet-4 as judge
  const poeApiKey = process.env.POE_API_KEY;
  if (!poeApiKey) {
    throw new Error('POE_API_KEY environment variable is required for LLM judge');
  }

  const judgeModel = process.env.JUDGE_MODEL || 'Claude-Sonnet-4';

  const judgePrompt = `You are evaluating whether a model's answer to a question contains the essential information points.

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

      const judgeResult = await judgeResponse.json();
      const judgeText = judgeResult.choices[0].message.content;
      
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
