/**
 * Free model providers, tried before the paid OpenRouter models (2026-11-02,
 * after the OpenRouter balance ran out). A provider is active as soon as its
 * key is in .env. AI_FREE_FIRST=0 goes back to the paid models only.
 *
 * Free tiers come and go, so model ids are discovered from each provider's
 * /models unless listed here or pinned with <ID>_FREE_MODEL (GROQ_FREE_MODEL).
 * Free tiers may keep prompts to improve their models, and prompts carry the
 * candidate's CV: see the warning in .env.example.
 */
import 'dotenv/config';
import {
  estimateTokensFromMessages,
  estimateTokensFromText,
  recordAiUsageEvent,
} from './ai-usage-log.mjs';

export const FREE_PROVIDERS = [
  // Checked live on 2026-11-02. gemini-2.5-flash-lite answers 404 on new keys;
  // Gemma puts its thinking in the text and is left out.
  { id: 'gemini', envKeys: ['GEMINI_API_KEY'], baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', models: ['gemini-3.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-flash-latest'], vision: true },
  { id: 'groq', envKeys: ['GROQ_API_KEY'], baseUrl: 'https://api.groq.com/openai/v1' },
  { id: 'cerebras', envKeys: ['CEREBRAS_API_KEY'], baseUrl: 'https://api.cerebras.ai/v1' },
  { id: 'mistral', envKeys: ['MISTRAL_API_KEY'], baseUrl: 'https://api.mistral.ai/v1' },
  { id: 'sambanova', envKeys: ['SAMBANOVA_API_KEY'], baseUrl: 'https://api.sambanova.ai/v1' },
  { id: 'nvidia', envKeys: ['NVIDIA_API_KEY'], baseUrl: 'https://integrate.api.nvidia.com/v1' },
  { id: 'github', envKeys: ['GITHUB_MODELS_TOKEN'], baseUrl: 'https://models.github.ai/inference', modelsUrl: 'https://models.github.ai/catalog/models' },
  // The router picks a free model that is up; it works on a negative balance
  // (checked live on 2026-11-02), single :free models are often rate-limited.
  { id: 'openrouter-free', envKeys: ['OPENROUTER_API_KEY', 'OPENROUTER_ADMIN_KEY'], baseUrl: 'https://openrouter.ai/api/v1', models: ['openrouter/free'], vision: true },
];

const NOT_CHAT_MODEL = /embed|whisper|tts|audio|speech|transcri|image|imagen|video|guard|safety|moderation|rerank|ocr|live|native|code/i;
const MODEL_PREFERENCE = [/qwen/i, /llama/i, /mistral-(small|large)/i, /nemotron/i, /gpt-oss|gpt-4\.1-mini|gpt-4o-mini/i, /deepseek/i];
const DISCOVERED_MODELS_PER_PROVIDER = 2;
const REQUEST_TIMEOUT_MS = 90_000;
// With no credit left, a rate-limited call waits for a free slot this long.
const MAX_WAIT_MS = 130_000;
const PAID_RETRY_AFTER_MS = 10 * 60_000;
const HOUR_MS = 60 * 60_000;

const cooldowns = new Map();
const discovered = new Map();
let paidBlockedUntil = 0;
let lastPaidError = null;

export function resetFreeLlmState() {
  cooldowns.clear();
  discovered.clear();
  paidBlockedUntil = 0;
  lastPaidError = null;
}

export function freeFirstEnabled() {
  return !/^(0|false|off|no)$/i.test(String(process.env.AI_FREE_FIRST || '').trim());
}

function providerKey(provider) {
  for (const name of provider.envKeys) {
    const value = String(process.env[name] || '').trim();
    // .env.example placeholders are not keys.
    if (value && !/your_|paste-your/i.test(value)) return value;
  }
  return '';
}

function providerHeaders(provider, key) {
  return {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...(provider.id === 'openrouter-free' ? { 'HTTP-Referer': 'https://jobyougo.xyz', 'X-Title': 'JobYouGo' } : {}),
  };
}

export function pickDiscoveredModels(ids = []) {
  const usable = ids.filter(id => id && !NOT_CHAT_MODEL.test(id));
  const ranked = [];
  for (const pattern of MODEL_PREFERENCE) {
    for (const id of usable) if (pattern.test(id) && !ranked.includes(id)) ranked.push(id);
  }
  return (ranked.length ? ranked : usable).slice(0, DISCOVERED_MODELS_PER_PROVIDER);
}

async function providerModels(provider, key) {
  const pinned = String(process.env[`${provider.id.toUpperCase()}_FREE_MODEL`] || '').trim();
  if (pinned) return pinned.split(',').map(id => id.trim()).filter(Boolean);
  if (provider.models) return provider.models;
  if (discovered.has(provider.id)) return discovered.get(provider.id);
  let models = [];
  try {
    const res = await fetch(provider.modelsUrl || `${provider.baseUrl}/models`, {
      headers: providerHeaders(provider, key),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      const json = await res.json();
      const list = Array.isArray(json) ? json : (json.data || []);
      models = pickDiscoveredModels(list.map(entry => entry.id || entry.name));
    } else {
      console.warn(`[free-llm] ${provider.id} /models HTTP ${res.status}`);
    }
  } catch (err) {
    console.warn(`[free-llm] ${provider.id} /models failed: ${err.message}`);
  }
  // An empty list is kept too: a provider whose /models hangs would otherwise
  // add its timeout to every call. A server restart reads it again.
  discovered.set(provider.id, models);
  return models;
}

function cooldownKey(target) {
  return `${target.provider.id}|${target.model}`;
}

// Lazy: a provider's /models is only read once the ones before it have failed.
async function* eachTarget({ vision = false } = {}) {
  for (const provider of FREE_PROVIDERS) {
    if (vision && !provider.vision) continue;
    const key = providerKey(provider);
    if (!key) continue;
    for (const model of await providerModels(provider, key)) yield { provider, key, model };
  }
}

/** How long a failed call keeps this model out of rotation. */
export function cooldownForError(err) {
  const status = Number(err?.status) || 0;
  const message = String(err?.message || '');
  if (status === 429) {
    if (/per ?day|daily|free-models-per-day/i.test(message)) return HOUR_MS;
    const retryAfter = Number(err?.retryAfter);
    if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1000, HOUR_MS);
    const said = message.match(/retry (?:in|after) (\d+(?:\.\d+)?)\s*s/i);
    return said ? Math.min(Math.ceil(Number(said[1])) * 1000, HOUR_MS) : 60_000;
  }
  if (status === 401 || status === 403 || status === 404) return HOUR_MS;
  // A 400 is about this request (size, response_format), not about the model.
  if (status === 400 || err?.emptyAnswer) return 0;
  return 30_000;
}

function isAccountFailure(err) {
  return /\b(401|402)\b|is not set/.test(String(err?.message || ''));
}

function noteFreeFailure(target, err) {
  const wait = cooldownForError(err);
  if (wait) cooldowns.set(cooldownKey(target), Date.now() + wait);
  console.warn(`[free-llm] ${target.provider.id} ${target.model} failed (${String(err?.message || err).slice(0, 160)}), next provider`);
}

/**
 * The order to try for one call: every free model that is not cooling down,
 * then the paid call. Once the paid side answered 401/402, wait for a free slot
 * instead. Callers run each step and report a failure with step.fail(err):
 *
 *   for await (const step of freeFirstRoute()) {
 *     try { return await (step.target ? freeCall(step.target) : paidCall()); }
 *     catch (err) { step.fail(err); }
 *   }
 */
export async function* freeFirstRoute({ vision = false } = {}) {
  if (!freeFirstEnabled()) {
    yield { target: null, fail(err) { throw err; } };
    return;
  }
  const deadline = Date.now() + MAX_WAIT_MS;
  // Refused this request without a cooldown (a 400, a bad answer): waiting
  // would not change the answer.
  const refused = new Set();
  while (true) {
    const targets = [];
    for await (const target of eachTarget({ vision })) {
      if (refused.has(cooldownKey(target))) continue;
      targets.push(target);
      if ((cooldowns.get(cooldownKey(target)) || 0) > Date.now()) continue;
      yield {
        target,
        fail(err) {
          // Text already reached the caller: another model cannot pick it up.
          if (err?.partial) throw err;
          noteFreeFailure(target, err);
          if (!cooldownForError(err)) refused.add(cooldownKey(target));
        },
      };
    }
    if (Date.now() >= paidBlockedUntil) {
      yield {
        target: null,
        fail(err) {
          if (!isAccountFailure(err)) throw err;
          lastPaidError = err;
          paidBlockedUntil = Date.now() + PAID_RETRY_AFTER_MS;
        },
      };
    }
    const waiting = targets.filter(target => !refused.has(cooldownKey(target)));
    const nextSlot = Math.min(...waiting.map(target => cooldowns.get(cooldownKey(target)) || 0));
    const wait = nextSlot - Date.now();
    if (!waiting.length || Date.now() >= deadline || wait > deadline - Date.now()) {
      const paid = lastPaidError?.message || 'paid models unavailable';
      const configured = waiting.length || refused.size;
      throw new Error(configured ? `${paid} (modèles gratuits saturés)` : `${paid} (aucun modèle gratuit configuré)`);
    }
    console.warn(`[free-llm] no credit and every free model is rate-limited, waiting ${Math.ceil(Math.max(wait, 0) / 1000)}s`);
    await new Promise(resolve => setTimeout(resolve, Math.max(wait, 250)));
  }
}

async function postChat(target, body) {
  const res = await fetch(`${target.provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: providerHeaders(target.provider, target.key),
    body: JSON.stringify({ model: target.model, ...body }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`${target.provider.id} HTTP ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    err.retryAfter = res.headers?.get?.('retry-after');
    throw err;
  }
  return res;
}

async function recordFreeUsage({ target, servedModel, messages, outputText, usage, streamed }) {
  const input = Number(usage?.prompt_tokens) || estimateTokensFromMessages(messages);
  const output = Number(usage?.completion_tokens) || estimateTokensFromText(outputText);
  await recordAiUsageEvent({
    provider: target.provider.id,
    source: 'free-tier',
    model: servedModel || target.model,
    input_tokens: input,
    output_tokens: output,
    total_tokens: Number(usage?.total_tokens) || input + output,
    cost_usd: 0,
    estimated: !usage,
    streamed,
  }).catch(err => console.warn(`[free-llm] usage logging failed: ${err.message}`));
}

function emptyAnswerError(target) {
  const err = new Error(`${target.provider.id} ${target.model} returned no text`);
  err.emptyAnswer = true;
  return err;
}

function stripThinking(text) {
  return String(text || '').replace(/<(think|thought)>[\s\S]*?<\/\1>/gi, '').trim();
}

export async function freeChat(target, { messages, temperature, max_tokens, response_format, meta }) {
  const res = await postChat(target, {
    messages,
    temperature,
    max_tokens,
    ...(response_format ? { response_format } : {}),
  });
  const json = await res.json();
  const content = stripThinking(json.choices?.[0]?.message?.content);
  if (!content) throw emptyAnswerError(target);
  const servedModel = json.model || target.model;
  if (meta && typeof meta === 'object') {
    Object.assign(meta, { finish_reason: json.choices?.[0]?.finish_reason || '', model: servedModel });
  }
  await recordFreeUsage({ target, servedModel, messages, outputText: content, usage: json.usage, streamed: false });
  return content;
}

export async function* freeChatStream(target, { messages, temperature, max_tokens, meta }) {
  const res = await postChat(target, {
    messages,
    temperature,
    max_tokens,
    stream: true,
    stream_options: { include_usage: true },
  });
  let outputText = '';
  let finishReason = '';
  let usage = null;
  let buf = '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        let json;
        try { json = JSON.parse(data); } catch { continue; }
        if (json.usage) usage = json.usage;
        const choice = json.choices?.[0];
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        const chunk = choice?.delta?.content;
        if (typeof chunk === 'string' && chunk) {
          outputText += chunk;
          yield chunk;
        }
      }
    }
  } catch (err) {
    if (outputText) err.partial = true;
    throw err;
  }
  if (!outputText) throw emptyAnswerError(target);
  if (meta && typeof meta === 'object') {
    Object.assign(meta, { finish_reason: finishReason, native_finish_reason: '', reasoning_chars: 0, generation_id: '', usage, model: target.model });
  }
  await recordFreeUsage({ target, messages, outputText, usage, streamed: true });
}
