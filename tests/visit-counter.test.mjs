import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  civilDate, isoWeekKey, isBot, visitorId, clientIp, recordVisit, readCounts,
  createMemoryStore, createUpstashStore, readStoreConfig, keys, LIVE_TTL_MS,
} from '../lib/visit-counter.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const UA2 = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const SALT = 'test-salt';

test('civil date and ISO week follow Asia/Bangkok, not UTC', () => {
  // Sunday 2026-10-25 17:30 UTC = Monday 2026-10-26 00:30 Bangkok -> new week.
  const t = new Date('2026-10-25T17:30:00Z');
  assert.equal(civilDate(t), '2026-10-26');
  assert.equal(isoWeekKey(t), '2026-W44');
  assert.equal(isoWeekKey(t, 'UTC'), '2026-W43');
  // Sunday 2026-10-25 16:59 UTC = 23:59 Bangkok, still W43.
  assert.equal(isoWeekKey(new Date('2026-10-25T16:59:00Z')), '2026-W43');
});

test('ISO week year boundaries', () => {
  assert.equal(isoWeekKey(new Date('2026-01-01T05:00:00Z')), '2026-W01'); // Thursday
  assert.equal(isoWeekKey(new Date('2027-01-01T05:00:00Z')), '2026-W53'); // Friday of 2026-W53
  assert.equal(isoWeekKey(new Date('2025-12-29T05:00:00Z')), '2026-W01'); // Monday
  assert.equal(isoWeekKey(new Date('2021-01-03T05:00:00Z')), '2020-W53');
});

test('bot detection', () => {
  for (const ua of ['', 'curl/8.4', 'Googlebot/2.1 (+http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; bingbot/2.0)', 'facebookexternalhit/1.1', 'WhatsApp/2.23',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/130.0 Safari/537.36',
    'python-requests/2.31', 'vercel-screenshot/1.0', 'Slackbot-LinkExpanding 1.0']) {
    assert.equal(isBot(ua), true, ua);
  }
  assert.equal(isBot(UA), false);
  assert.equal(isBot(UA2), false);
});

test('visitor id is opaque, salted and rotates daily', () => {
  const a = visitorId({ ip: '1.2.3.4', ua: UA, day: '2026-10-19', salt: SALT });
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.ok(!a.includes('1.2.3.4'));
  assert.equal(a, visitorId({ ip: '1.2.3.4', ua: UA, day: '2026-10-19', salt: SALT }));
  assert.notEqual(a, visitorId({ ip: '1.2.3.4', ua: UA, day: '2026-10-20', salt: SALT }));
  assert.notEqual(a, visitorId({ ip: '1.2.3.4', ua: UA, day: '2026-10-19', salt: 'other' }));
  assert.throws(() => visitorId({ ip: '1', ua: UA, day: 'd' }));
});

test('client ip from proxy headers', () => {
  assert.equal(clientIp({ 'x-forwarded-for': '9.9.9.9, 10.0.0.1' }), '9.9.9.9');
  assert.equal(clientIp({ 'x-real-ip': '8.8.8.8' }), '8.8.8.8');
  assert.equal(clientIp({}), '');
});

test('one visit per visitor per day, new day counts again, stores no raw data', async () => {
  let now = Date.parse('2026-10-19T03:00:00Z');
  const store = createMemoryStore({ clock: () => now });
  const v = { ip: '1.2.3.4', ua: UA, salt: SALT };
  let r = await recordVisit(store, { ...v, now });
  assert.deepEqual([r.week, r.live, r.counted, r.weekKey], [1, 1, true, '2026-W43']);
  r = await recordVisit(store, { ...v, now: now += 30_000, event: 'beat' });
  assert.deepEqual([r.week, r.counted], [1, false]);
  r = await recordVisit(store, { ...v, now: now += 1000 }); // reload
  assert.equal(r.week, 1);
  r = await recordVisit(store, { ip: '5.6.7.8', ua: UA2, salt: SALT, now });
  assert.deepEqual([r.week, r.live], [2, 2]);
  now = Date.parse('2026-10-20T03:00:00Z');
  r = await recordVisit(store, { ...v, now });
  assert.deepEqual([r.week, r.counted], [3, true]);
  const dump = JSON.stringify([...store._kv.keys(), ...store._z.keys(), ...[...store._z.values()].flatMap((e) => [...e.m.keys()])]);
  assert.ok(!dump.includes('1.2.3.4') && !dump.includes('Mozilla'), 'no IP or UA stored');
});

test('week counter resets on Monday 00:00 Bangkok', async () => {
  let now = Date.parse('2026-10-25T16:00:00Z'); // Sun 23:00 BKK
  const store = createMemoryStore({ clock: () => now });
  let r = await recordVisit(store, { ip: '1.1.1.1', ua: UA, salt: SALT, now });
  assert.deepEqual([r.week, r.weekKey], [1, '2026-W43']);
  now = Date.parse('2026-10-25T17:10:00Z'); // Mon 00:10 BKK
  r = await recordVisit(store, { ip: '1.1.1.1', ua: UA, salt: SALT, now });
  assert.deepEqual([r.week, r.weekKey, r.counted], [1, '2026-W44', true]);
});

test('live presence expires after the TTL and on leave', async () => {
  let now = Date.parse('2026-10-19T03:00:00Z');
  const store = createMemoryStore({ clock: () => now });
  await recordVisit(store, { ip: 'a', ua: UA, salt: SALT, now });
  await recordVisit(store, { ip: 'b', ua: UA, salt: SALT, now });
  let c = await readCounts(store, { now: now + 30_000 });
  assert.equal(c.live, 2);
  now += 45_000;
  await recordVisit(store, { ip: 'a', ua: UA, salt: SALT, now, event: 'beat' }); // a keeps beating
  c = await readCounts(store, { now: now + 20_000 }); // b last seen 65 s ago
  assert.equal(c.live, 1);
  assert.equal(c.week, 2, 'weekly count is unaffected by presence');
  const r = await recordVisit(store, { ip: 'a', ua: UA, salt: SALT, now: now + 21_000, event: 'leave' });
  assert.equal(r.live, 0);
  assert.equal(LIVE_TTL_MS, 60_000);
});

test('bots are never counted but still read counts', async () => {
  const now = Date.parse('2026-10-19T03:00:00Z');
  const store = createMemoryStore({ clock: () => now });
  await recordVisit(store, { ip: 'a', ua: UA, salt: SALT, now });
  const r = await recordVisit(store, { ip: 'b', ua: 'Googlebot/2.1', salt: SALT, now });
  assert.deepEqual([r.week, r.live, r.counted], [1, 1, false]);
});

test('store config: KV_* or UPSTASH_*, else unconfigured', () => {
  assert.equal(readStoreConfig({}), null);
  assert.equal(readStoreConfig({ KV_REST_API_URL: 'https://x' }), null);
  const a = readStoreConfig({ KV_REST_API_URL: 'https://x.upstash.io/', KV_REST_API_TOKEN: 't' });
  assert.equal(a.url, 'https://x.upstash.io');
  assert.equal(a.salt, 't');
  const b = readStoreConfig({ UPSTASH_REDIS_REST_URL: 'https://y', UPSTASH_REDIS_REST_TOKEN: 'u', VISIT_COUNTER_SALT: 's' });
  assert.deepEqual([b.url, b.salt], ['https://y', 's']);
});

test('upstash store sends a pipeline and maps results', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, json: async () => [{ result: 'OK' }, { result: 3 }] };
  };
  const s = createUpstashStore({ url: 'https://x', token: 'tok' }, { fetchImpl });
  assert.deepEqual(await s.exec([['SET', 'a', '1'], ['INCR', 'b']]), ['OK', 3]);
  assert.equal(calls[0].url, 'https://x/pipeline');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
  const bad = createUpstashStore({ url: 'https://x', token: 't' }, { fetchImpl: async () => ({ ok: false, status: 500 }) });
  await assert.rejects(bad.exec([['GET', 'a']]));
});

test('api handler degrades to configured:false without a store', async () => {
  const saved = { ...process.env };
  for (const k of ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) delete process.env[k];
  try {
    const { default: handler } = await import('../api/visits.mjs');
    const out = {};
    const res = { setHeader: (k, v) => { out[k] = v; }, end: (b) => { out.body = b; } };
    await handler({ method: 'POST', headers: {}, body: { e: 'view' } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(out.body), { ok: false, configured: false });
    assert.equal(out['Cache-Control'], 'no-store');
  } finally {
    Object.assign(process.env, saved);
  }
});

test('vercel.json routes /api/visits to its own function before the catch-all api route', () => {
  const cfg = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
  assert.ok(cfg.builds.some((b) => b.src === 'api/visits.mjs'));
  const i = cfg.routes.findIndex((r) => r.src === '/api/visits');
  const j = cfg.routes.findIndex((r) => r.src === '/api/(.*)');
  assert.ok(i >= 0 && i < j);
  assert.equal(cfg.routes[i].dest, 'api/visits.mjs');
});

test('portfolio footer carries the hidden counter, script and EN/FR labels', () => {
  const html = readFileSync(join(ROOT, 'ui/portfolio.html'), 'utf8');
  assert.match(html, /id="footer-visits"[^>]*hidden/);
  assert.match(html, /\/portfolio\/visit-counter\.js/);
  const i18n = readFileSync(join(ROOT, 'ui/portfolio/i18n.js'), 'utf8');
  for (const k of ['visits_week', 'visits_week_one', 'visits_live']) {
    assert.equal(i18n.split(`"${k}":`).length - 1, 2, `${k} in en and fr`);
  }
  assert.equal(keys.week('2026-W43'), 'pf:visits:week:2026-W43');
});
