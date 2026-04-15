import 'dotenv/config';

const API_KEY  = process.env.OPENROUTER_API_KEY;
const BASE_URL = 'https://openrouter.ai/api/v1';

if (!API_KEY) {
  console.warn('[openrouter] OPENROUTER_API_KEY not set — LLM calls will fail.');
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

  try {
    return await attempt();
  } catch (err) {
    const retryable = err.cause?.code === 'ETIMEDOUT' || err.cause?.code === 'ECONNRESET' || err.name === 'AbortError';
    if (retryable) {
      console.warn(`[openrouter]${label} ${err.cause?.code || err.name} — retrying once...`);
      return await attempt();
    }
    throw err;
  }
}

/**
 * Call any LLM via OpenRouter (OpenAI-compatible API).
 */
export async function chat({ model, messages, temperature = 0.3, max_tokens = 4096, systemPrompt }) {
  if (!API_KEY) throw new Error('OPENROUTER_API_KEY is not set in .env');

  const msgs = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : messages;

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
  return json.choices?.[0]?.message?.content ?? '';
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

/**
 * Streaming chat — yields text chunks via async generator.
 */
export async function* chatStream({ model, messages, temperature = 0.3, max_tokens = 8192, systemPrompt }) {
  if (!API_KEY) throw new Error('OPENROUTER_API_KEY is not set in .env');

  const msgs = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : messages;

  console.log(`[openrouter] [stream] [${model}] sending ${JSON.stringify({ messages: msgs.length, max_tokens })}`);

  const res = await fetchWithRetry(
    `${BASE_URL}/chat/completions`,
    {
      method: 'POST',
      headers: HEADERS(),
      body: JSON.stringify({ model, messages: msgs, temperature, max_tokens, stream: true }),
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
        console.log(`[openrouter] [stream] [${model}] done — ${totalChars} chars`);
        return;
      }
      try {
        const json = JSON.parse(data);
        const chunk = json.choices?.[0]?.delta?.content;
        if (chunk) {
          totalChars += chunk.length;
          yield chunk;
        }
      } catch {}
    }
  }
}

// ── Preset shortcuts ──────────────────────────────────────────────────────────

export const MODELS = {
  CLAUDE_SONNET:  'anthropic/claude-sonnet-4-6',
  CLAUDE_HAIKU:   'anthropic/claude-haiku-4-5',
  GPT4O:          'openai/gpt-4o',
  GPT4O_MINI:     'openai/gpt-4o-mini',
  GPT4_1_MINI:    'openai/gpt-4.1-mini',
  GEMINI_PRO:     'google/gemini-pro-1.5',
  DEEPSEEK:       'deepseek/deepseek-chat',
};
