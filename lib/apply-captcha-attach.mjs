/**
 * Captcha / bot wall on a form the Chrome extension fills: solved by PinchTab
 * in that same tab, through PinchTab's attach to the user's Chrome (Option A,
 * no third-party solver). Opt-in: PINCHTAB_ATTACH_CDP_URL names the Chrome
 * DevTools origin (e.g. http://127.0.0.1:9222). Without it, or on any
 * failure, the caller keeps waiting for the user as before.
 */
import {
  pinchtabHealth,
  pinchtabInstances,
  pinchtabAttach,
  pinchtabInstanceTabs,
  pinchtabSolve,
  pinchtabSolveSucceeded,
} from './pinchtab.mjs';

export const ATTACH_NAME = 'jobyougo-chrome';
export const SOLVABLE_KINDS = new Set(['captcha', 'challenge']);

export function attachCdpUrl(env = process.env) {
  const raw = String(env.PINCHTAB_ATTACH_CDP_URL || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    // Loopback only: a DevTools port is full control of the browser.
    if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(u.hostname)) return '';
    return raw;
  } catch {
    return '';
  }
}

const sameDoc = (a, b) => {
  try {
    const x = new URL(a); const y = new URL(b);
    return x.origin === y.origin && x.pathname.replace(/\/+$/, '') === y.pathname.replace(/\/+$/, '');
  } catch { return false; }
};

/** The attached tab showing `url`: exact URL first, else same origin + path. */
export function pickAttachedTab(tabs, url) {
  const list = (tabs || []).filter((t) => t && (t.id || t.tabId));
  const exact = list.find((t) => String(t.url || '') === url);
  const hit = exact || list.find((t) => sameDoc(String(t.url || ''), url));
  return hit ? String(hit.id || hit.tabId) : null;
}

const defaultDeps = {
  health: pinchtabHealth,
  instances: pinchtabInstances,
  attach: pinchtabAttach,
  instanceTabs: pinchtabInstanceTabs,
  solve: pinchtabSolve,
};

/**
 * Returns { available, solved, reason }. Never throws.
 * available:false → attach not configured / PinchTab down / tab not found:
 * the caller's old path (wait for the user) runs unchanged.
 */
export async function solveInAttachedTab({ url, kind, env = process.env, deps = {}, timeoutMs = 45000 } = {}) {
  const d = { ...defaultDeps, ...deps };
  if (!SOLVABLE_KINDS.has(kind)) return { available: false, solved: false, reason: 'not a captcha' };
  const cdpUrl = attachCdpUrl(env);
  if (!cdpUrl) return { available: false, solved: false, reason: 'PINCHTAB_ATTACH_CDP_URL non défini' };
  if (!url) return { available: false, solved: false, reason: 'URL de l’onglet inconnue' };
  try {
    if (!(await d.health())) return { available: false, solved: false, reason: 'PinchTab indisponible' };
    const all = await d.instances();
    // GET /instances carries no name (seen live: {id, status, attached, mode}):
    // an attached instance that runs is ours (attach allows 127.0.0.1 only),
    // so a second captcha does not attach the same Chrome again.
    const live = (i) => i && i.status !== 'stopped' && i.status !== 'error';
    let inst = all.find((i) => live(i) && (i.name === ATTACH_NAME || i.profileName === ATTACH_NAME))
      || all.find((i) => live(i) && i.attached === true);
    if (!inst) inst = await d.attach(cdpUrl, ATTACH_NAME);
    const instId = inst?.id || inst?.instance?.id;
    if (!instId) return { available: false, solved: false, reason: 'attach refusé' };
    const tabId = pickAttachedTab(await d.instanceTabs(instId), url);
    if (!tabId) return { available: false, solved: false, reason: 'onglet du formulaire introuvable via attach' };
    const result = await d.solve(tabId, { maxAttempts: 4, timeout: timeoutMs });
    return { available: true, solved: pinchtabSolveSucceeded(result), reason: result?.challengeType || '' };
  } catch (err) {
    return { available: false, solved: false, reason: String(err?.message || err).slice(0, 120) };
  }
}