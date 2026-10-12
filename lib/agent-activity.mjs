import { readAiUsageEvents } from './ai-usage-log.mjs';

const PROVIDER_LABELS = {
  openrouter: 'OpenRouter',
  openai: 'OpenAI',
  gemini: 'Gemini',
};

function addNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function emptyBucket() {
  return { byProvider: new Map() };
}

function providerLabel(id) {
  const key = String(id || '').toLowerCase();
  return PROVIDER_LABELS[key] || key;
}

function ensure(map, date) {
  if (!map.has(date)) map.set(date, emptyBucket());
  return map.get(date);
}

function addTo(map, date, provider, requests, tokens) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  const nextRequests = addNumber(requests);
  const nextTokens = addNumber(tokens);
  if (nextRequests <= 0 && nextTokens <= 0) return;
  const bucket = ensure(map, date);
  const key = String(provider || 'agent').toLowerCase();
  const current = bucket.byProvider.get(key) || { requests: 0, tokens: 0 };
  current.requests += nextRequests;
  current.tokens += nextTokens;
  bucket.byProvider.set(key, current);
}

function putMax(map, date, provider, requests, tokens) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  const nextRequests = addNumber(requests);
  const nextTokens = addNumber(tokens);
  if (nextRequests <= 0 && nextTokens <= 0) return;
  const bucket = ensure(map, date);
  const key = String(provider || 'agent').toLowerCase();
  const current = bucket.byProvider.get(key) || { requests: 0, tokens: 0 };
  current.requests = Math.max(current.requests, nextRequests);
  current.tokens = Math.max(current.tokens, nextTokens);
  bucket.byProvider.set(key, current);
}

export function groupUsageEventsByDate(events = []) {
  const map = new Map();
  for (const row of events) {
    const date = String(row?.ts || '').slice(0, 10);
    addTo(
      map,
      date,
      row?.provider || 'agent',
      addNumber(row?.requests) || 1,
      row?.total_tokens,
    );
  }
  return map;
}

function rowDate(row) {
  if (!row || typeof row !== 'object') return '';
  if (typeof row.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(row.date)) return row.date.slice(0, 10);
  for (const [key, value] of Object.entries(row)) {
    if (typeof value !== 'string' || !/date|day|time|bucket/i.test(key)) continue;
    const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
  }
  return '';
}

function finalize(map) {
  const days = {};
  for (const [date, bucket] of map) {
    let requests = 0;
    let tokens = 0;
    const providers = [];
    for (const [provider, stats] of bucket.byProvider) {
      if (stats.requests <= 0 && stats.tokens <= 0) continue;
      requests += stats.requests;
      tokens += stats.tokens;
      providers.push(providerLabel(provider));
    }
    if (requests <= 0 && tokens <= 0) continue;
    days[date] = {
      requests,
      tokens,
      providers,
    };
  }
  return days;
}

async function fetchJson(url, { method = 'GET', headers = {}, body, timeoutMs = 15000 } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; jobyougo/1.0)',
      ...headers,
    },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 160)}`);
  }
  return text ? JSON.parse(text) : {};
}

async function addLedger(map, start, end) {
  const events = await readAiUsageEvents({
    start: `${start}T00:00:00.000Z`,
    end: `${end}T23:59:59.999Z`,
  });
  for (const [date, bucket] of groupUsageEventsByDate(events)) {
    if (date < start || date > end) continue;
    for (const [provider, stats] of bucket.byProvider) {
      putMax(map, date, provider, stats.requests, stats.tokens);
    }
  }
}

async function addOpenRouterAnalytics(map, start, end, managementKey) {
  const bodyFor = (metrics) => JSON.stringify({
    metrics,
    granularity: 'day',
    limit: 400,
    time_range: {
      start: `${start}T00:00:00.000Z`,
      end: `${end}T23:59:59.999Z`,
    },
  });
  let data;
  try {
    data = await fetchJson('https://openrouter.ai/api/v1/analytics/query', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${managementKey}`,
        'Content-Type': 'application/json',
      },
      body: bodyFor(['request_count', 'tokens_total']),
    });
  } catch {
    data = await fetchJson('https://openrouter.ai/api/v1/analytics/query', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${managementKey}`,
        'Content-Type': 'application/json',
      },
      body: bodyFor(['request_count']),
    });
  }
  const rows = Array.isArray(data?.data) ? data.data : [];
  const byDate = new Map();
  for (const row of rows) {
    const date = rowDate(row);
    if (!date) continue;
    const current = byDate.get(date) || { requests: 0, tokens: 0 };
    current.requests += addNumber(row.request_count);
    current.tokens += addNumber(row.tokens_total);
    byDate.set(date, current);
  }
  for (const [date, stats] of byDate) {
    putMax(map, date, 'openrouter', stats.requests, stats.tokens);
  }
}

async function addOpenRouterActivity(map, key) {
  const data = await fetchJson('https://openrouter.ai/api/v1/activity', {
    headers: { Authorization: `Bearer ${key}` },
  });
  const rows = Array.isArray(data?.data) ? data.data : [];
  const byDate = new Map();
  for (const row of rows) {
    const date = rowDate(row);
    if (!date) continue;
    const current = byDate.get(date) || { requests: 0, tokens: 0 };
    current.requests += addNumber(row.requests);
    current.tokens += addNumber(row.prompt_tokens) + addNumber(row.completion_tokens) + addNumber(row.reasoning_tokens);
    byDate.set(date, current);
  }
  for (const [date, stats] of byDate) {
    putMax(map, date, 'openrouter', stats.requests, stats.tokens);
  }
}

function bucketDate(bucket) {
  if (typeof bucket?.start_time === 'number') {
    return new Date(bucket.start_time * 1000).toISOString().slice(0, 10);
  }
  return rowDate(bucket);
}

const OPENAI_USAGE_PATHS = [
  'completions',
  'embeddings',
  'images',
  'audio_speeches',
  'audio_transcriptions',
  'moderations',
];

async function addOpenAiSlice(local, key, path, fromMs, toMs) {
  const params = new URLSearchParams({
    start_time: String(Math.floor(fromMs / 1000)),
    end_time: String(Math.floor(toMs / 1000)),
    bucket_width: '1d',
    limit: '31',
  });
  const data = await fetchJson(`https://api.openai.com/v1/organization/usage/${path}?${params}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const buckets = Array.isArray(data?.data) ? data.data : [];
  for (const bucket of buckets) {
    const date = bucketDate(bucket);
    const results = Array.isArray(bucket?.results) ? bucket.results : [bucket];
    let requests = 0;
    let tokens = 0;
    for (const row of results) {
      requests += addNumber(row.num_model_requests || row.requests || row.num_images || row.num_sessions);
      tokens += addNumber(row.input_tokens) + addNumber(row.output_tokens);
    }
    addTo(local, date, 'openai', requests, tokens);
  }
}

async function addOpenAiUsage(map, start, end, key) {
  const span = 30 * 24 * 60 * 60 * 1000;
  const earliest = Date.now() - (364 * 24 * 60 * 60 * 1000);
  let cursor = Math.max(Date.parse(`${start}T00:00:00.000Z`), earliest);
  const endMs = Date.parse(`${end}T23:59:59.999Z`);
  const slices = [];
  while (cursor < endMs) {
    const sliceEnd = Math.min(endMs, cursor + span);
    slices.push([cursor, sliceEnd]);
    cursor = sliceEnd + 1000;
  }
  const local = new Map();
  for (const path of OPENAI_USAGE_PATHS) {
    try {
      for (let i = 0; i < slices.length; i += 4) {
        await Promise.all(slices.slice(i, i + 4).map(([from, to]) => addOpenAiSlice(local, key, path, from, to)));
      }
    } catch (err) {
      console.warn(`[agent-activity] OpenAI ${path} skipped: ${err.message}`);
    }
  }
  for (const [date, bucket] of local) {
    const stats = bucket.byProvider.get('openai');
    if (stats) putMax(map, date, 'openai', stats.requests, stats.tokens);
  }
}

export async function getAgentActivityByDate({ start, end } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return {};
  const map = new Map();
  await addLedger(map, start, end);

  const managementKey = process.env.OPENROUTER_MANAGEMENT_KEY || process.env.OPENROUTER_MANAGEMENT_API_KEY || '';
  const openAiKey = process.env.OPENAI_ADMIN_KEY || process.env.OPENAI_MANAGEMENT_KEY || process.env.OPENAI_ORG_ADMIN_KEY || process.env.OPENAI_API_ADMIN_KEY || '';

  if (managementKey) {
    try {
      await addOpenRouterAnalytics(map, start, end, managementKey);
    } catch (err) {
      console.warn(`[agent-activity] OpenRouter analytics skipped: ${err.message}`);
    }
    try {
      await addOpenRouterActivity(map, managementKey);
    } catch (err) {
      console.warn(`[agent-activity] OpenRouter activity skipped: ${err.message}`);
    }
  }
  if (openAiKey) {
    try {
      await addOpenAiUsage(map, start, end, openAiKey);
    } catch (err) {
      console.warn(`[agent-activity] OpenAI usage skipped: ${err.message}`);
    }
  }

  return finalize(map);
}

export function agentLevelFor(count, counts) {
  const n = addNumber(count);
  if (n <= 0) return 0;
  const positive = counts.filter(value => addNumber(value) > 0).map(addNumber).sort((a, b) => a - b);
  if (positive.length < 2) return 2;
  const min = positive[0];
  const max = positive[positive.length - 1];
  if (max === min) return 2;
  const t = (n - min) / (max - min);
  if (t < 0.25) return 1;
  if (t < 0.5) return 2;
  if (t < 0.75) return 3;
  return 4;
}

export function applyAgentActivity(calendar, activityByDate = {}) {
  const weeks = (calendar?.weeks || []).map(week => ({
    start: week.start,
    days: (week.days || []).map(day => (day ? { ...day, providers: [] } : null)),
  }));
  const days = weeks.flatMap(week => week.days).filter(Boolean);
  const counts = days.map(day => addNumber(activityByDate[day.date]?.requests));
  let agentDays = 0;
  let agentRequests = 0;
  for (const day of days) {
    const agent = activityByDate[day.date];
    const requests = addNumber(agent?.requests);
    day.agents = requests;
    day.agentTokens = addNumber(agent?.tokens);
    day.providers = Array.isArray(agent?.providers) ? agent.providers : [];
    if (requests <= 0) continue;
    agentDays += 1;
    agentRequests += requests;
    day.level = Math.max(addNumber(day.level), agentLevelFor(requests, counts));
  }
  return {
    ...calendar,
    weeks,
    agentDays,
    agentRequests,
  };
}

export function calendarBounds(calendar) {
  const dates = (calendar?.weeks || [])
    .flatMap(week => week.days || [])
    .filter(day => day?.date)
    .map(day => day.date)
    .sort();
  if (!dates.length) return null;
  return { start: dates[0], end: dates[dates.length - 1] };
}
