import { pinchtabNavigate, pinchtabSnapshot, pinchtabAction, pinchtabEvaluate, pinchtabClose } from './pinchtab.mjs';
import { APPLICATION_FORM_PROBE, GUEST_TEXT_RE } from './form-detect.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Off-site apply URL embedded in a listing page (CryptoJobsList
 * `applicationLink`, and the same JSON shape elsewhere). The visible Apply
 * button often gates that URL behind a login modal, so a click stays on the
 * listing. Same-host links are ignored: they are the page itself.
 */
export function extractEmbeddedApplyUrl(html, pageUrl = '') {
  const raw = String(html || '');
  const match = raw.match(/"applicationLink"\s*:\s*"(https?:[^"]+)"/);
  if (!match) return null;
  const href = match[1].replace(/\\\//g, '/');
  let target;
  try { target = new URL(href); } catch { return null; }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return null;
  if (pageUrl) {
    try {
      const page = new URL(pageUrl);
      const host = (h) => h.replace(/^www\./, '');
      if (host(target.hostname) === host(page.hostname)) return null;
    } catch { /* page URL unusable — still return the link */ }
  }
  return target.href;
}

/**
 * An Apply control with target=_blank (or _new) and a real http(s) href opens
 * another tab. Same-document hashes stay in the current tab.
 * Returns the absolute URL to open, or null.
 */
export function progressionOpensNewTab(href, target, pageUrl = '') {
  const raw = String(href || '').trim();
  const where = String(target || '').toLowerCase();
  if (where !== '_blank' && where !== '_new') return null;
  if (!/^https?:\/\//i.test(raw)) return null;
  let dest;
  try { dest = new URL(raw); } catch { return null; }
  if (pageUrl) {
    try {
      const page = new URL(pageUrl);
      if (dest.href.split('#')[0] === page.href.split('#')[0]) return null;
    } catch { /* keep the destination */ }
  }
  return dest.href;
}

// Only application-entry controls. Never generic Submit, authentication or
// arbitrary page instructions: snapshots are untrusted interface data.
export function navigationCandidate(nodes, attempted, { url = '', guestOnly = false } = {}) {
  return nodes.find(n => ['link', 'button', 'tab'].includes(n.role)
    && (guestOnly ? GUEST_TEXT_RE : /^(apply(?: now| here| for this (?:job|role|position)| on company website)?|application|start(?: your)? application|continue as guest|apply without an account|postuler|candidater)$/i).test(String(n.name || '').replace(/\s+/g, ' ').trim())
    && n.ref && !n.disabled && !attempted.has(`${url ? url + '::' : ''}${n.role}:${n.name}`));
}

export async function watchApplicationTransition(page, { findForm, timeoutMs = 25000, intervalMs = 500 } = {}) {
  const popups = [];
  const collect = popup => popups.push(popup);
  page.on('popup', collect);
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      for (const candidate of [...popups].reverse().concat(page)) {
        if (candidate.isClosed()) continue;
        const result = await findForm(candidate).catch(() => ({}));
        if (result.frame) return { page: candidate, frame: result.frame };
      }
      await pause(intervalMs);
    }
    return { page: popups.find(p => !p.isClosed()) || page, frame: null };
  } finally { page.off('popup', collect); }
}

// Isolated navigation-only browser. Transfer the discovered URL, never claim
// that a form in another session is usable until the runner re-detects it.
export async function exploreApplicationInterface(url, {
  log = () => {}, maxSteps = 8, settleMs = 1800,
  browser = { navigate: pinchtabNavigate, snapshot: pinchtabSnapshot, action: pinchtabAction, evaluate: pinchtabEvaluate, close: pinchtabClose },
} = {}) {
  let tabId;
  const attempted = new Set();
  try {
    tabId = await browser.navigate(url, { timeout: 45000 });
    for (let step = 0; step <= maxSteps; step++) {
      const probe = await browser.evaluate(tabId, `(${APPLICATION_FORM_PROBE.toString()})()`);
      if (probe?.verdict === 'application_form') {
        return await browser.evaluate(tabId, 'location.href');
      }
      if (step === maxSteps) break;
      const currentUrl = await browser.evaluate(tabId, 'location.href');
      const snapshot = await browser.snapshot(tabId);
      const nodes = Array.isArray(snapshot) ? snapshot : snapshot.nodes || [];
      const guestOnly = probe?.verdict === 'auth_wall';
      const candidate = navigationCandidate(nodes, attempted, { url: currentUrl, guestOnly });
      if (guestOnly && !candidate) return null;
      if (candidate) {
        attempted.add(`${currentUrl}::${candidate.role}:${candidate.name}`);
        log(`PinchTab : lecture de l’interface → ${candidate.name}`);
        await browser.action(tabId, { kind: 'click', ref: candidate.ref });
      } else {
        log('PinchTab : exploration par défilement et nouvelle lecture.');
        await browser.action(tabId, { kind: 'scroll', scrollY: 650 });
      }
      // Fresh tree on every step; delayed forms are re-probed before any click.
      await pause(settleMs);
    }
    return null;
  } finally { if (tabId) await browser.close(tabId); }
}
