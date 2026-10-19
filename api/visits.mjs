/**
 * Vercel function: portfolio visit counters (see lib/visit-counter.mjs).
 * GET  /api/visits                  -> { ok, configured, week, live }
 * POST /api/visits {"e":"view"|"beat"|"leave"} -> same, after recording the visitor.
 * Without a Redis store (KV_REST_API_* / UPSTASH_REDIS_REST_*) it answers
 * { ok:false, configured:false } and the page keeps the counters hidden.
 */
import {
  readStoreConfig, createUpstashStore, recordVisit, readCounts, clientIp,
} from '../lib/visit-counter.mjs';

const EVENTS = new Set(['view', 'beat', 'leave']);

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
    try { return JSON.parse(String(req.body)); } catch { return {}; }
  }
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 1024) break; }
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // sendBeacon / same-origin GETs may omit it
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return send(res, 405, { ok: false });
  }
  const cfg = readStoreConfig(process.env);
  if (!cfg) return send(res, 200, { ok: false, configured: false });
  const store = createUpstashStore(cfg);
  try {
    if (req.method === 'GET') {
      const c = await readCounts(store);
      return send(res, 200, { ok: true, configured: true, week: c.week, live: c.live, weekKey: c.weekKey });
    }
    if (!sameOrigin(req)) return send(res, 403, { ok: false });
    const body = await readBody(req);
    const event = EVENTS.has(body?.e) ? body.e : 'view';
    const c = await recordVisit(store, {
      ip: clientIp(req.headers),
      ua: String(req.headers['user-agent'] || ''),
      event,
      salt: cfg.salt,
    });
    return send(res, 200, { ok: true, configured: true, week: c.week, live: c.live, weekKey: c.weekKey });
  } catch {
    return send(res, 200, { ok: false, configured: true, error: 'store_unavailable' });
  }
}
