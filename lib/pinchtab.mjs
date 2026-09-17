import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// PinchTab is OPTIONAL. Greenhouse/Ashby/Lever job descriptions are fetched from
// public ATS APIs in ui/server.mjs — the pipeline must not depend on this daemon
// for those URLs. For JS-only career pages (captcha, SPA scrape, apply-runner):
//   npm i -g pinchtab
//   pinchtab server          # or: pinchtab daemon start
//   pinchtab health          # default http://localhost:9867
// Token: PINCHTAB_TOKEN, or %APPDATA%\pinchtab\config.json, or ~/.pinchtab/config.json
// Override base URL with PINCHTAB_URL.

const PINCHTAB_URL = (process.env.PINCHTAB_URL || 'http://localhost:9867').replace(/\/$/, '');

let _token = null;
export function resolvePinchtabConfigPath(env = process.env, home = homedir()) {
  if (env.PINCHTAB_CONFIG) return env.PINCHTAB_CONFIG;
  const windowsConfig = env.APPDATA && join(env.APPDATA, 'pinchtab', 'config.json');
  if (windowsConfig && existsSync(windowsConfig)) return windowsConfig;
  return env.PINCHTAB_CONFIG || join(env.HOME || env.USERPROFILE || home, '.pinchtab', 'config.json');
}

function getToken() {
  if (_token !== null) return _token;
  if (process.env.PINCHTAB_TOKEN) { _token = process.env.PINCHTAB_TOKEN; return _token; }
  try {
    const cfg = JSON.parse(readFileSync(resolvePinchtabConfigPath(), 'utf-8'));
    _token = cfg?.server?.token || '';
  } catch { _token = ''; }
  return _token;
}

async function pinchtabFetch(method, path, body, { timeout = 30000 } = {}) {
  const token = getToken();
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
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

export async function pinchtabClose(tabId) {
  if (!tabId) return;
  try { await pinchtabFetch('POST', '/close', { tabId }, { timeout: 5000 }); } catch {}
}

export async function pinchtabSnapshot(tabId) {
  return pinchtabFetch('GET', `/snapshot?tabId=${encodeURIComponent(tabId)}`);
}

export async function pinchtabAction(tabId, action) {
  return pinchtabFetch('POST', '/action', { ...action, tabId });
}

export async function pinchtabSolve(tabId, { solver, maxAttempts = 6, timeout = 40000 } = {}) {
  const body = { maxAttempts, timeout };
  if (solver) body.solver = solver;
  const path = tabId ? `/tabs/${encodeURIComponent(tabId)}/solve` : '/solve';
  return pinchtabFetch('POST', path, body, { timeout: timeout + 5000 });
}

export function pinchtabSolveSucceeded(result) {
  // attempts:0 means PinchTab found no challenge; the request still succeeded
  // and must not count against a caller's circuit breaker.
  return result?.solved === true;
}

export async function pinchtabCookies(tabId) {
  const params = tabId ? `?tabId=${encodeURIComponent(tabId)}` : '';
  return pinchtabFetch('GET', `/cookies${params}`, undefined, { timeout: 10000 });
}

export { PINCHTAB_URL };
