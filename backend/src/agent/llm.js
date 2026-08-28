import { GoogleGenAI } from '@google/genai';
import { env, geminiKeys, groqKeys, openrouterKeys, providerSummary } from '../config/env.js';

/**
 * LLM provider chain.
 *
 * Structured JSON generation, attempted across every configured key in order:
 *
 *   Gemini (primary)  ->  Groq  ->  OpenRouter  ->  caller's deterministic fallback
 *
 * The ordering is deliberate. Gemini stays primary because the whole prompt and
 * schema were tuned against it; the others exist so a quota wall on demo day is
 * an invisible hiccup instead of a degraded answer.
 *
 * Groq and OpenRouter both speak the OpenAI chat-completions API, so they share
 * one adapter over native fetch. Two SDKs for one wire format would be two
 * dependencies and two failure modes for no gain.
 *
 * Nothing here decides anything. Every response, whichever provider produced
 * it, is re-validated with Zod and then passed through the same guardrails.
 */

const geminiClients = geminiKeys.map((apiKey) => new GoogleGenAI({ apiKey }));

/**
 * The chain, flattened to a list of attempts. Built once at module load so the
 * request path does no assembly work.
 * @type {Array<{provider: string, model: string, key?: string, client?: object, baseUrl?: string}>}
 */
const CHAIN = [
  ...geminiClients.map((client) => ({ provider: 'gemini', model: env.GEMINI_MODEL, client })),
  ...groqKeys.map((key) => ({
    provider: 'groq',
    model: env.GROQ_MODEL,
    key,
    baseUrl: 'https://api.groq.com/openai/v1',
  })),
  ...openrouterKeys.map((key) => ({
    provider: 'openrouter',
    model: env.OPENROUTER_MODEL,
    key,
    baseUrl: 'https://openrouter.ai/api/v1',
  })),
];

export const isConfigured = CHAIN.length > 0;
export const chainSummary = providerSummary;

/** Failures where a different key or provider might succeed. */
function isQuotaError(err) {
  const status = err?.status ?? err?.code;
  const message = String(err?.message ?? '').toLowerCase();
  return (
    status === 429 ||
    message.includes('quota') ||
    message.includes('rate limit') ||
    message.includes('rate_limit') ||
    message.includes('resource_exhausted') ||
    message.includes('insufficient')
  );
}

/**
 * Failures that are a property of the provider, not the key: a missing model, a
 * malformed request, an unsupported parameter.
 *
 * Retrying these across sibling keys is pure waste — 11 Gemini keys all fail
 * identically on a model that does not exist, which is exactly what happened
 * before this check existed. Skip straight to the next provider.
 */
function isProviderConfigError(err) {
  const status = err?.status ?? err?.code;
  const message = String(err?.message ?? '').toLowerCase();
  return (
    status === 400 ||
    status === 404 ||
    message.includes('model_not_found') ||
    message.includes('does not exist') ||
    message.includes('not found for api version') ||
    message.includes('invalid_argument') ||
    message.includes('is not supported')
  );
}

/** Failures where the same key might succeed on a second attempt. */
function isTransientError(err) {
  const status = err?.status ?? err?.code;
  const message = String(err?.message ?? '').toLowerCase();
  return (
    [500, 502, 503, 504].includes(status) ||
    message.includes('fetch failed') ||
    message.includes('etimedout') ||
    message.includes('econnreset') ||
    message.includes('overloaded')
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Time budgets.
 *
 * These exist because classification alone cannot bound this. A bad Gemini
 * model surfaces from the SDK as `TypeError: fetch failed` with no status —
 * indistinguishable from a real network blip — and each attempt costs ~11s of
 * connect timeout. Treated as transient and retried across 11 keys, one
 * misconfiguration took 242 seconds to reach the fallback.
 *
 * A slow fallback is as useless as no fallback when someone is watching, so the
 * chain is bounded by wall time regardless of what any error claims to be.
 */
const ATTEMPT_TIMEOUT_MS = 8_000;
const CHAIN_DEADLINE_MS = 20_000;

/**
 * Reject if `promise` has not settled within `ms`.
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} label
 * @returns {Promise<T>}
 */
function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Strip markdown fences some models wrap JSON in despite being told not to. */
function parseJson(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(cleaned);
}

// -----------------------------------------------------------------------------

async function callGemini({ client, model }, { systemInstruction, prompt, responseSchema, temperature }) {
  const response = await client.models.generateContent({
    model,
    contents: prompt,
    config: {
      systemInstruction,
      responseMimeType: 'application/json',
      responseSchema,
      temperature,
      // Gemini 3.x thinking tokens count against maxOutputTokens. Left alone
      // this prompt burned ~1150 of them and truncated the JSON mid-object.
      // thinkingBudget: 0 is rejected on this model (INVALID_ARGUMENT) but
      // thinkingLevel 'low' is accepted and measures far lower.
      thinkingConfig: { thinkingLevel: 'low' },
      maxOutputTokens: 1024,
      safetySettings: [
        'HARM_CATEGORY_HARASSMENT',
        'HARM_CATEGORY_HATE_SPEECH',
        'HARM_CATEGORY_SEXUALLY_EXPLICIT',
        'HARM_CATEGORY_DANGEROUS_CONTENT',
      ].map((category) => ({ category, threshold: 'BLOCK_ONLY_HIGH' })),
    },
  });

  const finishReason = response.candidates?.[0]?.finishReason;
  // Truncated output is valid-looking JSON missing its closing braces, so
  // JSON.parse would throw somewhere confusing. Name the real cause.
  if (finishReason === 'MAX_TOKENS') {
    throw new Error(
      `Response truncated (MAX_TOKENS, ${response.usageMetadata?.thoughtsTokenCount ?? 0} thinking tokens)`
    );
  }
  if (!response.text) throw new Error(`Empty response (finishReason: ${finishReason ?? 'unknown'})`);

  return parseJson(response.text);
}

/**
 * Groq and OpenRouter, over the OpenAI chat-completions shape.
 *
 * These use response_format json_object rather than a strict json_schema:
 * schema support varies by model on OpenRouter, and a request rejected for an
 * unsupported response_format would burn a chain step for a formatting reason.
 * The schema is described in the system message instead, and Zod re-validates
 * on receipt either way — which was always the real enforcement.
 */
async function callOpenAICompatible(
  { baseUrl, key, model, provider },
  { systemInstruction, prompt, responseSchema, temperature }
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        // OpenRouter attributes traffic with these; harmless elsewhere.
        ...(provider === 'openrouter'
          ? { 'HTTP-Referer': env.FRONTEND_URL, 'X-Title': 'ResolveAI' }
          : {}),
      },
      body: JSON.stringify({
        model,
        temperature,
        max_tokens: 1024,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `${systemInstruction}\n\nReturn a JSON object matching this schema exactly:\n${JSON.stringify(responseSchema)}`,
          },
          { role: 'user', content: prompt },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      const err = new Error(`${provider} ${res.status}: ${body.slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }

    const json = await res.json();
    const text = json.choices?.[0]?.message?.content;
    if (!text) throw new Error(`Empty response from ${provider}`);
    return parseJson(text);
  } finally {
    clearTimeout(timeout);
  }
}

// -----------------------------------------------------------------------------

/**
 * Generate structured JSON, walking the provider chain until one succeeds.
 *
 * @param {object} input
 * @param {string} input.systemInstruction
 * @param {string} input.prompt
 * @param {object} input.responseSchema
 * @param {number} [input.temperature=0.4]
 * @returns {Promise<{ ok: true, data: unknown, provider: string, model: string, attempt: number }
 *                  | { ok: false, reason: string, detail: string }>}
 *          Never throws. The caller decides whether to fall back, and an
 *          exception here would make that decision harder to get right.
 */
export async function generateStructured({
  systemInstruction,
  prompt,
  responseSchema,
  temperature = 0.4,
}) {
  if (!isConfigured) {
    return { ok: false, reason: 'NOT_CONFIGURED', detail: 'No LLM provider key is configured' };
  }

  const startedAt = Date.now();
  const remaining = () => CHAIN_DEADLINE_MS - (Date.now() - startedAt);

  let lastError = null;
  let quotaSeen = false;
  let deadlineHit = false;
  /** Providers proven broken this call, so their remaining keys are skipped. */
  const deadProviders = new Set();

  for (let i = 0; i < CHAIN.length; i++) {
    const entry = CHAIN[i];
    if (deadProviders.has(entry.provider)) continue;

    if (remaining() <= 0) {
      deadlineHit = true;
      break;
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const call =
          entry.provider === 'gemini'
            ? callGemini(entry, { systemInstruction, prompt, responseSchema, temperature })
            : callOpenAICompatible(entry, { systemInstruction, prompt, responseSchema, temperature });

        const data = await withTimeout(
          call,
          Math.min(ATTEMPT_TIMEOUT_MS, Math.max(remaining(), 1_000)),
          entry.provider
        );

        if (i > 0) {
          // Worth knowing in the logs that the primary did not serve this.
          console.warn(`[llm] served by ${entry.provider} (chain position ${i + 1}/${CHAIN.length})`);
        }
        return { ok: true, data, provider: entry.provider, model: entry.model, attempt: i };
      } catch (err) {
        lastError = err;

        // Quota is the ONLY failure worth trying a sibling key for — it is a
        // property of the key, not the provider. Never retried on the same key:
        // that just burns the remaining budget and delays the answer.
        if (isQuotaError(err)) {
          quotaSeen = true;
          break;
        }

        // One retry for a genuine blip, if there is budget to do it in.
        if (isTransientError(err) && attempt === 0 && remaining() > 2 * ATTEMPT_TIMEOUT_MS) {
          await sleep(500);
          continue;
        }

        // Everything else — a missing model, a malformed request, an
        // unreachable host — is a property of the PROVIDER, so every sibling
        // key will fail identically. Write the provider off and move on.
        //
        // This is not hypothetical: with generativelanguage.googleapis.com
        // unreachable, each Gemini attempt costs ~11s of connect timeout, and
        // walking all 11 keys took 242 seconds to reach a working provider that
        // answers in under one.
        deadProviders.add(entry.provider);
        break;
      }
    }
  }

  // Log the class of failure only — never a key, never the prompt contents.
  const elapsed = Date.now() - startedAt;
  console.warn(
    `[llm] no provider served the request in ${elapsed}ms ` +
      `(${quotaSeen ? 'quota' : deadlineHit ? 'deadline' : 'error'})`
  );

  return {
    ok: false,
    reason: quotaSeen ? 'QUOTA_EXHAUSTED' : deadlineHit ? 'DEADLINE_EXCEEDED' : 'MODEL_ERROR',
    detail: String(lastError?.message ?? 'Unknown LLM failure').slice(0, 200),
  };
}
