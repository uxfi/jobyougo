import { readFileSync, existsSync, renameSync } from 'fs';
import { spawn } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';

// PinchTab is OPTIONAL. Greenhouse/Ashby/Lever job descriptions are fetched from
// public ATS APIs in ui/server.mjs — the pipeline must not depend on this daemon
// for those URLs. For JS-only career pages (captcha, SPA scrape, apply-runner):
//   npm i -g pinchtab
//   pinchtab server          # or: pinchtab daemon start
//   pinchtab health          # default http://localhost:9867
// Token: PINCHTAB_TOKEN, then %APPDATA%\pinchtab\config.json or ~/.pinchtab/config.json.
// A stale env token (HTTP 401) falls through to the config-file token.
// Override base URL with PINCHTAB_URL.

const PINCHTAB_URL = (process.env.PINCHTAB_URL || 'http://localhost:9867').replace(/\/$/, '');

let _token = null;
export function resolvePinchtabConfigPath(env = process.env, home = homedir()) {
  if (env.PINCHTAB_CONFIG) return env.PINCHTAB_CONFIG;
  const windowsConfig = env.APPDATA && join(env.APPDATA, 'pinchtab', 'config.json');
  if (windowsConfig && existsSync(windowsConfig)) return windowsConfig;
  return env.PINCHTAB_CONFIG || join(env.HOME || env.USERPROFILE || home, '.pinchtab', 'config.json');
}

function readConfigToken() {
  try {
    const cfg = JSON.parse(readFileSync(resolvePinchtabConfigPath(), 'utf-8'));
    return cfg?.server?.token || '';
  } catch { return ''; }
}

function tokenCandidates() {
  const tokens = [];
  const push = (value) => {
    const token = String(value || '');
    if (!tokens.includes(token)) tokens.push(token);
  };
  if (_token !== null) push(_token);
  push(process.env.PINCHTAB_TOKEN);
  push(readConfigToken());
  return tokens.filter(Boolean);
}

async function pinchtabFetchWithToken(method, path, body, token, timeout) {
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

async function pinchtabFetch(method, path, body, { timeout = 30000 } = {}) {
  const tokens = tokenCandidates();
  const attempts = tokens.length ? tokens : [''];
  let lastErr;
  for (const token of attempts) {
    try {
      const data = await pinchtabFetchWithToken(method, path, body, token, timeout);
      _token = token;
      return data;
    } catch (err) {
      lastErr = err;
      if (err.status !== 401) throw err;
      if (_token === token) _token = null;
    }
  }
  throw lastErr;
}

export async function pinchtabHealth() {
  try {
    const data = await pinchtabFetch('GET', '/health', undefined, { timeout: 3000 });
    return data?.status === 'ok' && data?.defaultInstance?.status === 'running';
  } catch { return false; }
}

// The scan's web queries go through PinchTab. Without it they fall back to
// SearchAPI, local Google and DuckDuckGo, which answer with 429s and captchas,
// so a scan starts the server itself when it is installed but not running.
// `pinchtab daemon` is macOS/Linux only; `server --background` also works on
// Windows. -y is the guards-down preset that /evaluate needs.
// PINCHTAB_AUTOSTART=0 turns this off; PINCHTAB_BIN overrides the command.
const STALE_PID_RE = /background PID file at (.+?) points to a live process that cannot be verified/;

// The start command prints the server token. Nothing from its output reaches a
// log or an error message without passing through here.
export function redactPinchtabOutput(text = '') {
  return String(text)
    .replace(/("token"\s*:\s*")[^"]*/gi, '$1<redacted>')
    .replace(/(token\s*[=:]\s*)[A-Za-z0-9._-]{8,}/gi, '$1<redacted>');
}

export function stalePidFileFromOutput(text = '') {
  const match = String(text).match(STALE_PID_RE);
  return match ? match[1].trim() : '';
}

function runPinchtabStart() {
  return new Promise((resolve) => {
    let output = '';
    let child;
    try {
      child = spawn(process.env.PINCHTAB_BIN || 'pinchtab', ['server', '--background', '-y'], {
        shell: process.platform === 'win32',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolve({ output: err.message });
      return;
    }
    const timer = setTimeout(() => {
      child.kill();
      resolve({ output: `${output}\nstart timed out` });
    }, 60000);
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', err => { clearTimeout(timer); resolve({ output: `${output}\n${err.message}` }); });
    child.on('close', () => { clearTimeout(timer); resolve({ output }); });
  });
}

// Any HTTP answer on the port, even a 401 or a not-ready instance, means a
// server owns it. pinchtabHealth() is stricter and is false while it boots.
async function pinchtabPortAnswers() {
  try {
    await fetch(`${PINCHTAB_URL}/health`, { signal: AbortSignal.timeout(3000) });
    return true;
  } catch { return false; }
}

async function waitForPinchtab(waitMs) {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if (await pinchtabHealth()) return true;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return false;
}

function lastOutputLine(text = '') {
  const lines = redactPinchtabOutput(text).split('\n').map(line => line.trim()).filter(Boolean);
  return lines[lines.length - 1] || 'no output';
}

let _ensuring = null;

/**
 * Health check; when the server is down, start it and wait for the default
 * instance. Concurrent callers share one start.
 * @returns {Promise<{ up: boolean, started: boolean, error?: string }>}
 */
export function ensurePinchtabRunning({ waitMs = 30000, log = console.log, onStart } = {}) {
  if (!_ensuring) {
    _ensuring = ensurePinchtabRunningOnce({ waitMs, log, onStart }).finally(() => { _ensuring = null; });
  }
  return _ensuring;
}

async function ensurePinchtabRunningOnce({ waitMs, log, onStart }) {
  if (await pinchtabHealth()) return { up: true, started: false };
  // Booting, or up with its default instance still starting: wait, never start
  // a second server on a port that is taken.
  if (await pinchtabPortAnswers()) {
    if (await waitForPinchtab(waitMs)) return { up: true, started: false };
    return { up: false, started: false, error: `server answers on ${PINCHTAB_URL} but its default instance is not running` };
  }
  if (process.env.PINCHTAB_AUTOSTART === '0') {
    return { up: false, started: false, error: 'not running, autostart off (PINCHTAB_AUTOSTART=0)' };
  }
  onStart?.();
  log('[pinchtab] not running, starting `pinchtab server --background -y`');
  let start = await runPinchtabStart();
  // A pid file left by a dead server can name a PID that Windows has since
  // given to another program, and pinchtab then refuses to start (it cannot
  // read any process command on this Windows build, so it never verifies).
  // Nothing answered on the port above, so the file is stale: set it aside.
  const stalePidFile = stalePidFileFromOutput(start.output);
  if (stalePidFile) {
    try {
      renameSync(stalePidFile, `${stalePidFile}.stale-${Date.now()}`);
    } catch (err) {
      return { up: false, started: false, error: `stale pid file ${stalePidFile}: ${err.message}` };
    }
    log(`[pinchtab] stale pid file set aside: ${stalePidFile}`);
    start = await runPinchtabStart();
  }
  if (await waitForPinchtab(waitMs)) {
    log('[pinchtab] server up');
    return { up: true, started: true };
  }
  return { up: false, started: false, error: lastOutputLine(start.output) };
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
