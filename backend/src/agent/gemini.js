import { GoogleGenAI } from '@google/genai';
import { env, geminiKeys } from '../config/env.js';

/**
 * Gemini client.
 *
 * Two resilience layers, in order:
 *
 *   1. Key rotation. Multiple Gemini keys may be configured; a quota or
 *      rate-limit failure moves to the next one. This is the practical answer
 *      to the free tier running out mid-demo, and it stays inside the
 *      assignment stack — every key is still Google Gemini.
 *   2. The caller's deterministic fallback, once every key is exhausted.
 *
 * A 429 does NOT get retried on the same key. Retrying a quota error just burns
 * the remaining budget and delays the fallback the user is waiting on. Only
 * transient 5xx and network faults are retried, once.
 */

const clients = geminiKeys.map((apiKey) => new GoogleGenAI({ apiKey }));

export const isGeminiConfigured = clients.length > 0;
export const configuredKeyCount = clients.length;

/** Failures where a different key might succeed. */
function isQuotaError(err) {
  const status = err?.status ?? err?.code;
  const message = String(err?.message ?? '').toLowerCase();
  return (
    status === 429 ||
    message.includes('quota') ||
    message.includes('rate limit') ||
    message.includes('resource_exhausted')
  );
}

/** Failures where the same key might succeed on a second attempt. */
function isTransientError(err) {
  const status = err?.status ?? err?.code;
  const message = String(err?.message ?? '').toLowerCase();
  return (
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    message.includes('fetch failed') ||
    message.includes('etimedout') ||
    message.includes('econnreset')
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Ask Gemini for structured JSON.
 *
 * @param {object} input
 * @param {string} input.systemInstruction
 * @param {string} input.prompt
 * @param {object} input.responseSchema  OpenAPI-subset schema.
 * @param {number} [input.temperature=0.4]
 * @returns {Promise<{ ok: true, data: unknown, keyIndex: number } | { ok: false, reason: string, detail: string }>}
 *          Never throws. The caller decides whether to fall back, and a thrown
 *          error here would make that decision harder to get right.
 */
export async function generateStructured({
  systemInstruction,
  prompt,
  responseSchema,
  temperature = 0.4,
}) {
  if (!isGeminiConfigured) {
    return { ok: false, reason: 'NOT_CONFIGURED', detail: 'No Gemini API key is configured' };
  }

  let lastError = null;

  for (let keyIndex = 0; keyIndex < clients.length; keyIndex++) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await clients[keyIndex].models.generateContent({
          model: env.GEMINI_MODEL,
          contents: prompt,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema,
            temperature,
            // Gemini 3.x reasons before answering and those thinking tokens
            // count against maxOutputTokens. At 1200 the model spent ~1150
            // thinking and truncated the JSON mid-object (finishReason
            // MAX_TOKENS). Thinking cannot be switched off on this model —
            // thinkingConfig.thinkingBudget: 0 is rejected as INVALID_ARGUMENT —
            // so the budget is sized to hold both instead. Observed usage for
            // this prompt is ~1150 thinking + ~400 output; 4096 leaves room for
            // a longer incident description without truncating.
            maxOutputTokens: 4096,
            // Keep the model from refusing an ordinary support case because a
            // customer complaint reads as "negative". These are business
            // messages, not open-ended chat.
            safetySettings: [
              'HARM_CATEGORY_HARASSMENT',
              'HARM_CATEGORY_HATE_SPEECH',
              'HARM_CATEGORY_SEXUALLY_EXPLICIT',
              'HARM_CATEGORY_DANGEROUS_CONTENT',
            ].map((category) => ({ category, threshold: 'BLOCK_ONLY_HIGH' })),
          },
        });

        const finishReason = response.candidates?.[0]?.finishReason;
        const text = response.text;

        // Truncated output is almost always valid-looking JSON that is missing
        // its closing braces, so JSON.parse would throw somewhere confusing.
        // Name the real cause instead.
        if (finishReason === 'MAX_TOKENS') {
          lastError = new Error(
            `Response truncated (MAX_TOKENS, ${response.usageMetadata?.thoughtsTokenCount ?? 0} thinking tokens)`
          );
          break;
        }
        if (!text) {
          lastError = new Error(`Empty response from model (finishReason: ${finishReason ?? 'unknown'})`);
          break; // An empty body is not a key problem; stop retrying this key.
        }

        return { ok: true, data: JSON.parse(text), keyIndex };
      } catch (err) {
        lastError = err;

        if (isQuotaError(err)) break; // Next key, immediately.
        if (isTransientError(err) && attempt === 0) {
          await sleep(600);
          continue; // One retry on the same key.
        }
        break; // Anything else: not worth another attempt on this key.
      }
    }
  }

  const quota = isQuotaError(lastError);
  // Log the class of failure, never the key or the prompt contents.
  console.warn(`[gemini] all ${clients.length} key(s) failed: ${quota ? 'quota' : 'error'}`);

  return {
    ok: false,
    reason: quota ? 'QUOTA_EXHAUSTED' : 'MODEL_ERROR',
    detail: String(lastError?.message ?? 'Unknown Gemini failure').slice(0, 200),
  };
}
