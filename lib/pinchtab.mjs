import { readFileSync } from 'fs';

const PINCHTAB_URL = (process.env.PINCHTAB_URL || 'http://localhost:9867').replace(/\/$/, '');

let _token = null;
function getToken() {
  if (_token !== null) return _token;
  if (process.env.PINCHTAB_TOKEN) { _token = process.env.PINCHTAB_TOKEN; return _token; }
  try {
    const cfg = JSON.parse(readFileSync(`${process.env.HOME}/.pinchtab/config.json`, 'utf-8'));
    _token = cfg?.server?.token || '';
  } catch { _token = ''; }
  return _token;
}

async function pinchtabFetch(method, path, body, { timeout = 30000, raw = false } = {}) {
  const token = getToken();
  const headers = {};
  if (!raw) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const init = { method, headers, signal: AbortSignal.timeout(timeout) };
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
  const r = await fetch(`${PINCHTAB_URL}${path}`, init);
  if (!r.ok) {
    const errText = await r.text().catch(() => '');
    const err = new Error(`pinchtab ${method} ${path} → HTTP ${r.status}: ${errText.slice(0, 200)}`);
    err.status = r.status;
    throw err;
  }
  if (raw) return Buffer.from(await r.arrayBuffer());
  const text = await r.text();
  try { return text ? JSON.parse(text) : {}; } catch { return { raw: text }; }
}

export async function pinchtabHealth() {
  try {
    const data = await pinchtabFetch('GET', '/health', undefined, { timeout: 3000 });
    return data?.status === 'ok' && data?.defaultInstance?.status === 'running';
  } catch { return false; }
}

export async function pinchtabNavigate(url, { timeout = 20000, waitFor } = {}) {
  const body = { url, newTab: true, timeout };
  if (waitFor) body.waitFor = waitFor;
  const data = await pinchtabFetch('POST', '/navigate', body, { timeout: timeout + 5000 });
  if (!data?.tabId) throw new Error(`pinchtab navigate returned no tabId for ${url}`);
  return data.tabId;
}

export async function pinchtabEvaluate(tabId, expression, { awaitPromise = true, timeout = 15000 } = {}) {
  const data = await pinchtabFetch('POST', `/tabs/${tabId}/evaluate`, { expression, awaitPromise }, { timeout });
  return data?.result;
}

export async function pinchtabText(tabId, { maxChars = 15000, mode = 'raw' } = {}) {
  const params = new URLSearchParams({ maxChars: String(maxChars), mode });
  return pinchtabFetch('GET', `/tabs/${tabId}/text?${params.toString()}`);
}

export async function pinchtabClose(tabId) {
  if (!tabId) return;
  try { await pinchtabFetch('POST', '/close', { tabId }, { timeout: 5000 }); } catch {}
}

export async function pinchtabPdf(tabId, opts = {}) {
  const params = new URLSearchParams({ tabId, raw: 'true' });
  for (const [k, v] of Object.entries(opts)) {
    if (v === undefined || v === null) continue;
    params.set(k, String(v));
  }
  return pinchtabFetch('GET', `/pdf?${params.toString()}`, undefined, { raw: true, timeout: 60000 });
}

export async function pinchtabScreenshot(tabId, opts = {}) {
  const params = new URLSearchParams({ tabId, raw: 'true' });
  for (const [k, v] of Object.entries(opts)) {
    if (v === undefined || v === null) continue;
    params.set(k, String(v));
  }
  return pinchtabFetch('GET', `/screenshot?${params.toString()}`, undefined, { raw: true, timeout: 60000 });
}

export { PINCHTAB_URL };
