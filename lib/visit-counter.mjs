/**
 * Portfolio visit counters (weekly visits + live presence), pure logic + Upstash REST store.
 *
 * - Week: ISO-8601 week of the civil date in Asia/Bangkok (key "2026-W43"), so the count
 *   resets Monday 00:00 Bangkok time.
 * - One visit per visitor per day: visitor id = HMAC-SHA256(salt, day|ip|ua), truncated.
 *   The day is part of the input, so ids rotate every day and cannot be linked across days.
 *   No cookie, no IP or user agent is ever stored, only the opaque id (TTL 2 days).
 * - Live: sorted set member = visitor id, score = last heartbeat (ms). Members older than
 *   LIVE_TTL_MS are pruned before counting.
 * - Bots (crawler UAs, empty UA, link-preview fetchers, headless browsers) are never counted.
 *
 * The store is anything with `exec(commands) -> Promise<results[]>` (Redis command arrays,
 * pipelined), so tests inject an in-memory fake.
 */
import { createHmac } from 'node:crypto';

export const TIME_ZONE = 'Asia/Bangkok';
export const LIVE_TTL_MS = 60_000;
export const DEDUP_TTL_S = 2 * 24 * 3600;
export const WEEK_TTL_S = 40 * 24 * 3600;
export const KEY_PREFIX = 'pf:visits';

export const keys = {
  week: (weekKey) => `${KEY_PREFIX}:week:${weekKey}`,
  seen: (day, id) => `${KEY_PREFIX}:seen:${day}:${id}`,
  live: () => `${KEY_PREFIX}:live`,
};

/** Civil date "YYYY-MM-DD" of `date` in `timeZone`. */
export function civilDate(date = new Date(), timeZone = TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** ISO week key "YYYY-Www" of the civil date of `date` in `timeZone`. */
export function isoWeekKey(date = new Date(), timeZone = TIME_ZONE) {
  const [y, m, d] = civilDate(date, timeZone).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const dow = t.getUTCDay() || 7; // Mon=1..Sun=7
  t.setUTCDate(t.getUTCDate() + 4 - dow); // Thursday of this week decides the ISO year
  const isoYear = t.getUTCFullYear();
  const week = Math.ceil(((t - Date.UTC(isoYear, 0, 1)) / 86_400_000 + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

const BOT_UA = /bot\b|bot\/|crawl|spider|slurp|scrap|preview|facebookexternalhit|embedly|whatsapp|telegram|discord|skype|headless|phantom|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|curl\/|wget|python|httpclient|okhttp|axios|node-fetch|undici|go-http|java\/|libwww|vercel-(screenshot|favicon)|bingpreview|yandex|baidu|semrush|ahrefs|mj12/i;

/** True for crawlers, link unfurlers, monitors, scripts and empty user agents. */
export function isBot(ua) {
  const s = String(ua || '').trim();
  if (s.length < 10) return true;
  return BOT_UA.test(s);
}

/** Opaque per-day visitor id; never reversible to the IP or UA without the salt. */
export function visitorId({ ip = '', ua = '', day, salt }) {
  if (!salt) throw new Error('visitorId: salt required');
  return createHmac('sha256', String(salt)).update(`${day}|${ip}|${ua}`).digest('hex').slice(0, 32);
}

/** First public client IP from proxy headers (Vercel sets x-forwarded-for / x-real-ip). */
export function clientIp(headers = {}) {
  const h = (n) => headers[n] ?? headers[n.toLowerCase()];
  const xff = String(h('x-vercel-forwarded-for') || h('x-forwarded-for') || '').split(',')[0].trim();
  return xff || String(h('x-real-ip') || '').trim();
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; };

/** Read-only counts (bots, GET). */
export async function readCounts(store, { now = Date.now(), timeZone = TIME_ZONE } = {}) {
  const weekKey = isoWeekKey(new Date(now), timeZone);
  const r = await store.exec([
    ['GET', keys.week(weekKey)],
    ['ZREMRANGEBYSCORE', keys.live(), '-inf', String(now - LIVE_TTL_MS)],
    ['ZCARD', keys.live()],
  ]);
  return { week: num(r[0]), live: num(r[2]), weekKey, counted: false };
}

/**
 * Record a page view / heartbeat / leave for a visitor and return the counts.
 * event: 'view' | 'beat' count the visitor once per day and refresh presence; 'leave' drops presence.
 */
export async function recordVisit(store, {
  ip = '', ua = '', event = 'view', salt, now = Date.now(), timeZone = TIME_ZONE,
} = {}) {
  if (isBot(ua)) return readCounts(store, { now, timeZone });
  const date = new Date(now);
  const day = civilDate(date, timeZone);
  const weekKey = isoWeekKey(date, timeZone);
  const id = visitorId({ ip, ua, day, salt });
  const live = keys.live();
  const cutoff = String(now - LIVE_TTL_MS);

  if (event === 'leave') {
    const r = await store.exec([
      ['ZREM', live, id],
      ['ZREMRANGEBYSCORE', live, '-inf', cutoff],
      ['ZCARD', live],
      ['GET', keys.week(weekKey)],
    ]);
    return { week: num(r[3]), live: num(r[2]), weekKey, counted: false };
  }

  const first = await store.exec([
    ['SET', keys.seen(day, id), '1', 'NX', 'EX', String(DEDUP_TTL_S)],
    ['ZADD', live, String(now), id],
    ['ZREMRANGEBYSCORE', live, '-inf', cutoff],
    ['PEXPIRE', live, String(LIVE_TTL_MS * 2)],
  ]);
  const counted = first[0] === 'OK';
  const second = await store.exec([
    counted ? ['INCR', keys.week(weekKey)] : ['GET', keys.week(weekKey)],
    ['EXPIRE', keys.week(weekKey), String(WEEK_TTL_S)],
    ['ZCARD', live],
  ]);
  return { week: num(second[0]), live: num(second[2]), weekKey, counted };
}

/** Store config from env (Vercel Marketplace Upstash injects KV_* or UPSTASH_REDIS_REST_*). */
export function readStoreConfig(env = process.env) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL || '';
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN || '';
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ''), token, salt: env.VISIT_COUNTER_SALT || token };
}

/** Upstash Redis REST pipeline client (fetch only, no dependency). */
export function createUpstashStore({ url, token }, { fetchImpl = globalThis.fetch, timeoutMs = 2500 } = {}) {
  return {
    async exec(commands) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetchImpl(`${url}/pipeline`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(commands),
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`store HTTP ${res.status}`);
        const out = await res.json();
        if (!Array.isArray(out)) throw new Error('store: bad response');
        return out.map((r) => {
          if (r && r.error) throw new Error('store command failed');
          return r ? r.result : null;
        });
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** In-memory store with the same command subset (tests, local mocks). */
export function createMemoryStore({ clock = () => Date.now() } = {}) {
  const kv = new Map(); // key -> { v, exp }
  const z = new Map(); // key -> { m: Map(member->score), exp }
  const alive = (map, k) => {
    const e = map.get(k);
    if (e && e.exp != null && e.exp <= clock()) { map.delete(k); return undefined; }
    return e;
  };
  const run = ([cmd, k, ...a]) => {
    switch (String(cmd).toUpperCase()) {
      case 'GET': return alive(kv, k)?.v ?? null;
      case 'SET': {
        const nx = a.includes('NX');
        const exi = a.indexOf('EX');
        if (nx && alive(kv, k)) return null;
        kv.set(k, { v: a[0], exp: exi >= 0 ? clock() + Number(a[exi + 1]) * 1000 : null });
        return 'OK';
      }
      case 'INCR': {
        const e = alive(kv, k);
        const v = String(Number(e?.v || 0) + 1);
        kv.set(k, { v, exp: e?.exp ?? null });
        return Number(v);
      }
      case 'EXPIRE': case 'PEXPIRE': {
        const ms = Number(a[0]) * (String(cmd).toUpperCase() === 'EXPIRE' ? 1000 : 1);
        const e = alive(kv, k) || alive(z, k);
        if (!e) return 0;
        e.exp = clock() + ms;
        return 1;
      }
      case 'ZADD': {
        const e = alive(z, k) || { m: new Map(), exp: null };
        z.set(k, e);
        const added = e.m.has(a[1]) ? 0 : 1;
        e.m.set(a[1], Number(a[0]));
        return added;
      }
      case 'ZREM': { const e = alive(z, k); return e && e.m.delete(a[0]) ? 1 : 0; }
      case 'ZREMRANGEBYSCORE': {
        const e = alive(z, k); if (!e) return 0;
        const max = Number(a[1]); let n = 0;
        for (const [mem, s] of e.m) if (s <= max) { e.m.delete(mem); n += 1; }
        return n;
      }
      case 'ZCARD': return alive(z, k)?.m.size ?? 0;
      default: throw new Error(`memory store: unsupported ${cmd}`);
    }
  };
  return { async exec(commands) { return commands.map(run); }, _kv: kv, _z: z };
}
