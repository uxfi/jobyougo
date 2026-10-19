/**
 * Small, testable pieces of the careers-page scan: how long to wait on a
 * client-rendered page, a consent-banner dismiss, a per-host cooldown after a
 * failed challenge solve, and a time budget for the detail pages.
 */

// Cookie / consent walls hide the listings of many SPA careers pages (Shopee,
// Razer, Endowus, StashAway ...). Clicks one plain "accept" button, nothing else.
export const CONSENT_DISMISS_SCRIPT = `(() => {
  const accept = /^(accept( all)?( cookies)?|allow all( cookies)?|agree|i agree|ok|got it|tout accepter|accepter|j.accepte|accept & close|alles akzeptieren|akzeptieren)$/i;
  for (const el of document.querySelectorAll('button, [role="button"], a')) {
    const text = String(el.innerText || el.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim();
    if (text && text.length <= 24 && accept.test(text)) { try { el.click(); return text; } catch { /* next */ } }
  }
  return '';
})()`;

// A page that still looks empty or is visibly loading after the normal wait
// gets ONE extra window; a page with real text and no listings does not (no
// slowdown on companies that simply have nothing).
export function needsLongerWait(bodyText = '') {
  const text = String(bodyText || '').replace(/\s+/g, ' ').trim();
  if (text.length < 500) return true;
  return /\b(loading|chargement en cours|please wait|veuillez patienter|just a moment)\b/i.test(text.slice(0, 800));
}

export function createSolveCooldown({ ttlMs = 15 * 60 * 1000, now = () => Date.now() } = {}) {
  const failed = new Map();
  const hostOf = (url) => { try { return new URL(url).hostname; } catch { return String(url || ''); } };
  return {
    blocked(url) { const at = failed.get(hostOf(url)); return at !== undefined && now() - at < ttlMs; },
    fail(url) { failed.set(hostOf(url), now()); },
  };
}

// Detail pages: stop opening them once the company's budget is spent or two
// in a row failed (timeouts), instead of 8 x 9 s on a slow site.
export function createDetailBudget({ budgetMs = 30000, maxConsecutiveFails = 2, now = () => Date.now() } = {}) {
  const started = now();
  let fails = 0;
  return {
    ok() { return now() - started < budgetMs && fails < maxConsecutiveFails; },
    note(success) { fails = success ? 0 : fails + 1; },
  };
}
