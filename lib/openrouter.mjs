import 'dotenv/config';
import {
  estimateTokensFromMessages,
  estimateTokensFromText,
  recordAiUsageEvent,
} from './ai-usage-log.mjs';

const API_KEY  = process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_ADMIN_KEY;
const BASE_URL = 'https://openrouter.ai/api/v1';

if (!API_KEY) {
  console.warn('[openrouter] OPENROUTER_API_KEY/OPENROUTER_ADMIN_KEY not set — LLM calls will fail.');
}

const HEADERS = () => ({
  'Authorization': `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
  'HTTP-Referer': 'https://career-ops.local',
  'X-Title': 'career-ops',
});

// Retry a fetch once on network-level errors (ETIMEDOUT, ECONNRESET, etc.)
async function fetchWithRetry(url, opts, timeoutMs = 120_000, label = '') {
  const attempt = async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...opts, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };

  const isRetryableStatus = (res) => res && (res.status === 429 || res.status === 502 || res.status === 503 || res.status === 529);

  try {
    const res = await attempt();
    if (isRetryableStatus(res)) {
      const retryAfter = Number(res.headers.get('retry-after'));
      const wait = Math.min(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000, 15000);
      console.warn(`[openrouter]${label} HTTP ${res.status} — retrying once in ${wait}ms`);
      await new Promise(resolve => setTimeout(resolve, wait));
      return await attempt();
    }
    return res;
  } catch (err) {
    const retryable = err.cause?.code === 'ETIMEDOUT' || err.cause?.code === 'ECONNRESET' || err.name === 'AbortError';
    if (retryable) {
      console.warn(`[openrouter]${label} ${err.cause?.code || err.name} — retrying once...`);
      return await attempt();
    }
    throw err;
  }
}

function addNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// Job feeds / JDs sometimes carry a lone (unpaired) UTF-16 surrogate (truncated
// emoji, bad encoding). OpenRouter's upstream providers reject those with a 400
// before any retry logic can help, so strip them from every message we send.
function stripLoneSurrogates(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
}

function sanitizeMessages(msgs) {
  return msgs.map(m => (typeof m.content === 'string' ? { ...m, content: stripLoneSurrogates(m.content) } : m));
}

async function fetchGenerationStats(generationId) {
  if (!generationId) return null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt) await new Promise(resolve => setTimeout(resolve, 900 * attempt));
    try {
      const params = new URLSearchParams({ id: generationId });
      const res = await fetchWithRetry(
        `${BASE_URL}/generation?${params}`,
        { headers: HEADERS() },
        30_000,
        ` [generation] [${generationId}]`
      );
      if (!res.ok) continue;
      const json = await res.json();
      return json?.data || null;
    } catch {}
  }
  return null;
}

async function recordOpenRouterUsage({ model, messages, outputText = '', generationId = '', usage = null, streamed = false }) {
  try {
    const stats = generationId ? await fetchGenerationStats(generationId) : null;
    const statInput = addNumber(stats?.tokens_prompt || stats?.native_tokens_prompt);
    const statOutput = addNumber(stats?.tokens_completion || stats?.native_tokens_completion);
    const usageInput = addNumber(usage?.prompt_tokens || usage?.input_tokens);
    const usageOutput = addNumber(usage?.completion_tokens || usage?.output_tokens);
    const input = statInput || usageInput || estimateTokensFromMessages(messages);
    const output = statOutput || usageOutput || estimateTokensFromText(outputText);
    const total = addNumber(usage?.total_tokens) || input + output;
    await recordAiUsageEvent({
      provider: 'openrouter',
      source: stats ? 'openrouter-generation' : (usage ? 'openrouter-response' : 'local-estimate'),
      model: stats?.model || model,
      generation_id: stats?.id || generationId || null,
      input_tokens: input,
      output_tokens: output,
      total_tokens: total,
      cost_usd: typeof stats?.total_cost === 'number' ? stats.total_cost : (typeof usage?.cost === 'number' ? usage.cost : null),
      estimated: !stats && !usage,
      streamed,
    });
  } catch (err) {
    console.warn(`[openrouter] usage logging failed: ${err.message}`);
  }
}

/**
 * Call any LLM via OpenRouter (OpenAI-compatible API).
 */
export async function chat({ model, messages, temperature = 0.3, max_tokens = 4096, systemPrompt }) {
  if (!API_KEY) throw new Error('OPENROUTER_API_KEY or OPENROUTER_ADMIN_KEY is not set in .env');

  const msgs = sanitizeMessages(systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : messages);

  const res = await fetchWithRetry(
    `${BASE_URL}/chat/completions`,
    {
      method: 'POST',
      headers: HEADERS(),
      body: JSON.stringify({ model, messages: msgs, temperature, max_tokens }),
    },
    120_000,
    ` [chat] [${model}]`
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter error ${res.status}: ${err}`);
  }

  const json = await res.json();
  const content = json.choices?.[0]?.message?.content ?? '';
  await recordOpenRouterUsage({
    model: json.model || model,
    messages: msgs,
    outputText: content,
    generationId: json.id || '',
    usage: json.usage || null,
    streamed: false,
  });
  return content;
}

/**
 * List available models from OpenRouter.
 */
export async function listModels() {
  const res = await fetchWithRetry(
    `${BASE_URL}/models`,
    { headers: HEADERS() },
    30_000
  );
  if (!res.ok) throw new Error(`OpenRouter error ${res.status}`);
  const json = await res.json();
  return json.data ?? [];
}

function reasoningTokenCount(usage) {
  return addNumber(
    usage?.completion_tokens_details?.reasoning_tokens
    || usage?.reasoning_tokens
    || usage?.native_tokens_reasoning
  );
}

function assignStreamMeta(meta, values) {
  if (!meta || typeof meta !== 'object') return;
  Object.assign(meta, values);
}

function logStreamDone(model, { totalChars, finishReason, reasoningChars, usage }) {
  const completion = usage ? addNumber(usage.completion_tokens || usage.output_tokens) : '?';
  const reasoningTokens = usage ? reasoningTokenCount(usage) : '?';
  console.log(
    `[openrouter] [stream] [${model}] done — ${totalChars} chars, finish=${finishReason || '?'}, reasoning_chars=${reasoningChars}, completion_tokens=${completion}, reasoning_tokens=${reasoningTokens}`
  );
}

/**
 * Streaming chat — yields visible text chunks via async generator.
 * Reasoning tokens (gpt-5 / o-series) are billed as completion but are NOT
 * in delta.content; they are counted/logged, not yielded as user-visible text.
 */
export async function* chatStream({
  model,
  messages,
  temperature = 0.3,
  max_tokens = 8192,
  systemPrompt,
  reasoning,
  meta,
}) {
  if (!API_KEY) throw new Error('OPENROUTER_API_KEY or OPENROUTER_ADMIN_KEY is not set in .env');

  const msgs = sanitizeMessages(systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : messages);

  console.log(`[openrouter] [stream] [${model}] sending ${JSON.stringify({ messages: msgs.length, max_tokens, reasoning: reasoning || null })}`);

  const body = {
    model,
    messages: msgs,
    temperature,
    max_tokens,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (reasoning) body.reasoning = reasoning;

  const res = await fetchWithRetry(
    `${BASE_URL}/chat/completions`,
    {
      method: 'POST',
      headers: HEADERS(),
      body: JSON.stringify(body),
    },
    120_000,
    ` [stream] [${model}]`
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter error ${res.status}: ${err}`);
  }

  console.log(`[openrouter] [stream] [${model}] connected — streaming...`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let totalChars = 0;
  let generationId = '';
  let finalUsage = null;
  let outputText = '';
  let finishReason = '';
  let nativeFinishReason = '';
  let reasoningChars = 0;

  const persistMeta = () => assignStreamMeta(meta, {
    finish_reason: finishReason,
    native_finish_reason: nativeFinishReason,
    reasoning_chars: reasoningChars,
    generation_id: generationId,
    usage: finalUsage,
  });

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') {
        persistMeta();
        logStreamDone(model, { totalChars, finishReason, reasoningChars, usage: finalUsage });
        await recordOpenRouterUsage({
          model,
          messages: msgs,
          outputText,
          generationId,
          usage: finalUsage,
          streamed: true,
        });
        return;
      }
      try {
        const json = JSON.parse(data);
        if (json.id) generationId = json.id;
        if (json.usage) finalUsage = json.usage;
        const choice = json.choices?.[0];
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        if (choice?.native_finish_reason) nativeFinishReason = choice.native_finish_reason;
        const delta = choice?.delta || {};
        const reasoningChunk = typeof delta.reasoning === 'string'
          ? delta.reasoning
          : (typeof delta.reasoning_content === 'string' ? delta.reasoning_content : '');
        if (reasoningChunk) reasoningChars += reasoningChunk.length;
        const chunk = typeof delta.content === 'string'
          ? delta.content
          : (typeof delta.text === 'string' ? delta.text : '');
        if (chunk) {
          totalChars += chunk.length;
          outputText += chunk;
          yield chunk;
        } else if (!outputText && typeof choice?.message?.content === 'string' && choice.message.content) {
          outputText = choice.message.content;
          totalChars = outputText.length;
          yield outputText;
        }
      } catch {}
    }
  }

  persistMeta();
  logStreamDone(model, { totalChars, finishReason, reasoningChars, usage: finalUsage });
  await recordOpenRouterUsage({
    model,
    messages: msgs,
    outputText,
    generationId,
    usage: finalUsage,
    streamed: true,
  });
}

// ── Preset shortcuts ──────────────────────────────────────────────────────────

export const MODELS = {
  CLAUDE_SONNET:  'anthropic/claude-sonnet-4-6',
  CLAUDE_HAIKU:   'anthropic/claude-haiku-4-5',
  GPT4O:          'openai/gpt-4o',
  GPT4O_MINI:     'openai/gpt-4o-mini',
  GPT41_MINI:     'openai/gpt-4.1-mini',
  SOL:            'openai/gpt-5.6-sol',
  GEMINI_PRO:     'google/gemini-pro-1.5',
  DEEPSEEK:       'deepseek/deepseek-chat',
  /** TypeSafe Jev — Decisions API only (lib/jev.mjs), not chat completions */
  JEV:            process.env.JEV_MODEL || '~typesafe/jev-latest',
};
