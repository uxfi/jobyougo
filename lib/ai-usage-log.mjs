import { appendFile, mkdir, readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_LOG_PATH = process.env.VERCEL
  ? '/tmp/career-ops/data/ai-usage-ledger.jsonl'
  : join(ROOT, 'data', 'ai-usage-ledger.jsonl');

export const AI_USAGE_LOG_PATH = process.env.AI_USAGE_LOG_PATH || DEFAULT_LOG_PATH;

function addNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function safeJson(value) {
  try { return JSON.stringify(value || ''); } catch { return String(value || ''); }
}

export function estimateTokensFromText(value) {
  const text = typeof value === 'string' ? value : safeJson(value);
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

export function estimateTokensFromMessages(messages = []) {
  if (!Array.isArray(messages)) return estimateTokensFromText(messages);
  return messages.reduce((sum, message) => {
    return sum + estimateTokensFromText(message?.role || '') + estimateTokensFromText(message?.content || '');
  }, 0);
}

export async function recordAiUsageEvent(event = {}) {
  const inputTokens = Math.max(0, Math.round(addNumber(event.input_tokens)));
  const outputTokens = Math.max(0, Math.round(addNumber(event.output_tokens)));
  const totalTokens = Math.max(0, Math.round(addNumber(event.total_tokens) || inputTokens + outputTokens));
  const row = {
    ts: event.ts || new Date().toISOString(),
    provider: String(event.provider || '').toLowerCase(),
    source: event.source || 'local',
    model: event.model || '',
    generation_id: event.generation_id || null,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
    requests: Math.max(1, Math.round(addNumber(event.requests) || 1)),
    cost_usd: typeof event.cost_usd === 'number' && Number.isFinite(event.cost_usd) ? event.cost_usd : null,
    estimated: Boolean(event.estimated),
  };
  if (!row.provider || !row.total_tokens) return;

  await mkdir(dirname(AI_USAGE_LOG_PATH), { recursive: true });
  await appendFile(AI_USAGE_LOG_PATH, `${JSON.stringify(row)}\n`, 'utf-8');
}

export async function recordGeminiUsageFromResponse({ model = '', response = {}, inputText = '', outputText = '' } = {}) {
  const usage = response?.usageMetadata || response?.usage_metadata || {};
  const inputTokens = addNumber(usage.promptTokenCount || usage.prompt_token_count) || estimateTokensFromText(inputText);
  const outputTokens = addNumber(usage.candidatesTokenCount || usage.candidates_token_count) || estimateTokensFromText(outputText);
  const totalTokens = addNumber(usage.totalTokenCount || usage.total_token_count) || inputTokens + outputTokens;
  await recordAiUsageEvent({
    provider: 'gemini',
    source: usage.totalTokenCount || usage.total_token_count ? 'gemini-usageMetadata' : 'local-estimate',
    model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
    estimated: !(usage.totalTokenCount || usage.total_token_count),
  });
}

export async function readAiUsageEvents({ start, end } = {}) {
  let text = '';
  try {
    text = await readFile(AI_USAGE_LOG_PATH, 'utf-8');
  } catch {
    return [];
  }

  const startMs = start ? new Date(start).getTime() : -Infinity;
  const endMs = end ? new Date(end).getTime() : Infinity;
  return text
    .split('\n')
    .filter(Boolean)
    .map(line => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean)
    .filter(row => {
      const ts = new Date(row.ts).getTime();
      return Number.isFinite(ts) && ts >= startMs && ts <= endMs;
    });
}

export function aggregateUsageEvents(events = [], providerId = '') {
  const provider = String(providerId || '').toLowerCase();
  const matching = events.filter(row => !provider || row.provider === provider);
  const models = [];
  const totals = matching.reduce((acc, row) => {
    acc.input_tokens += addNumber(row.input_tokens);
    acc.output_tokens += addNumber(row.output_tokens);
    acc.total_tokens += addNumber(row.total_tokens);
    acc.requests += addNumber(row.requests);
    if (typeof row.cost_usd === 'number' && Number.isFinite(row.cost_usd)) acc.cost_usd += row.cost_usd;
    if (row.model && !models.includes(row.model)) models.push(row.model);
    if (row.estimated) acc.estimated = true;
    return acc;
  }, { input_tokens: 0, output_tokens: 0, total_tokens: 0, requests: 0, cost_usd: 0, estimated: false });

  return {
    ...totals,
    cost_usd: totals.cost_usd || null,
    models: models.slice(0, 8),
  };
}
