import { applyAgentActivity, calendarBounds, getAgentActivityByDate } from './agent-activity.mjs';

const GITHUB_LOGIN = 'uxfi';
const CACHE_MS = 15 * 60 * 1000;

let cache = null;
let mergedCache = null;

function attr(tag, name) {
  const match = String(tag || '').match(new RegExp(`\\b${name}="([^"]*)"`));
  return match ? match[1] : '';
}

function countFromTooltip(text) {
  const tip = String(text || '').replace(/\s+/g, ' ').trim();
  if (/^no contributions\b/i.test(tip)) return 0;
  const match = tip.match(/^(\d+)\s+contributions?\b/i);
  return match ? Number(match[1]) : null;
}

function sundayKey(date) {
  const day = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(day.getTime())) return '';
  day.setUTCDate(day.getUTCDate() - day.getUTCDay());
  return day.toISOString().slice(0, 10);
}

export function parseGithubContributions(html) {
  const source = String(html || '');
  const totalMatch = source.match(/([\d,]+)\s+contributions\s+in the last year/i);
  const total = totalMatch ? Number(totalMatch[1].replace(/,/g, '')) : null;
  const fromMatch = source.match(/\bdata-from="([^"]+)"/);
  const toMatch = source.match(/\bdata-to="([^"]+)"/);

  const byDate = new Map();
  const cellRe = /<td\b(?=[^>]*\bdata-date=")([^>]*)><\/td>\s*<tool-tip\b[^>]*>([\s\S]*?)<\/tool-tip>/gi;
  let match;
  while ((match = cellRe.exec(source))) {
    const date = attr(match[1], 'data-date');
    const level = Number(attr(match[1], 'data-level'));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (!Number.isInteger(level) || level < 0 || level > 4) continue;
    byDate.set(date, {
      date,
      level,
      count: countFromTooltip(match[2]),
    });
  }

  const days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (!days.length || total == null) return null;

  const weeks = [];
  let currentKey = '';
  let current = null;
  for (const day of days) {
    const key = sundayKey(day.date);
    if (!key) continue;
    if (key !== currentKey) {
      current = { start: key, days: Array(7).fill(null) };
      weeks.push(current);
      currentKey = key;
    }
    const index = new Date(`${day.date}T00:00:00Z`).getUTCDay();
    current.days[index] = day;
  }

  if (!weeks.length) return null;

  return {
    ok: true,
    login: GITHUB_LOGIN,
    total,
    from: fromMatch?.[1] || days[0].date,
    to: toMatch?.[1] || days[days.length - 1].date,
    weeks,
  };
}

export async function getGithubContributions({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache && now - cache.at < CACHE_MS) return cache.data;

  try {
    const response = await fetch(`https://github.com/users/${GITHUB_LOGIN}/contributions`, {
      headers: {
        Accept: 'text/html',
        'User-Agent': 'Mozilla/5.0 (compatible; jobyougo/1.0)',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`GitHub contributions HTTP ${response.status}`);
    const parsed = parseGithubContributions(await response.text());
    if (!parsed) throw new Error('GitHub contributions calendar was empty');
    cache = { at: now, data: parsed };
    return parsed;
  } catch (err) {
    if (cache?.data) return cache.data;
    throw err;
  }
}

export async function getContributionCalendar({ force = false } = {}) {
  const now = Date.now();
  if (!force && mergedCache && now - mergedCache.at < CACHE_MS) return mergedCache.data;

  const calendar = await getGithubContributions({ force });
  const bounds = calendarBounds(calendar);
  let activity = {};
  if (bounds) {
    try {
      activity = await getAgentActivityByDate(bounds);
    } catch (err) {
      console.warn(`[contributions] agent activity skipped: ${err.message}`);
    }
  }
  const data = applyAgentActivity(calendar, activity);
  mergedCache = { at: now, data };
  return data;
}
