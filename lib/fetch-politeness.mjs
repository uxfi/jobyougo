// Polite fetching helpers: tracking-param stripping and 429/5xx backoff with jitter.
const TRACKING = /^(utm_[a-z]+|gclid|fbclid|msclkid|mc_cid|mc_eid|_hsenc|_hsmi|igshid)$/i;

export function cleanFetchUrl(raw = '') {
  try {
    const u = new URL(String(raw));
    for (const key of [...u.searchParams.keys()]) if (TRACKING.test(key)) u.searchParams.delete(key);
    return u.toString();
  } catch { return String(raw || ''); }
}

// careers-page.com (Manatal) rate-limits hard: more attempts, longer base wait.
export function retryPolicy(url = '') {
  let host = '';
  try { host = new URL(url).hostname; } catch { /* ignore */ }
  return /(^|\.)careers-page\.com$/i.test(host) ? { attempts: 4, baseMs: 2500 } : { attempts: 2, baseMs: 1500 };
}

export function backoffDelayMs(attempt, { baseMs = 1500, retryAfter = '', rand = Math.random, maxMs = 20000 } = {}) {
  const headerSec = Number(retryAfter);
  const floor = Number.isFinite(headerSec) && headerSec > 0 ? headerSec * 1000 : 0;
  const exp = baseMs * 2 ** Math.max(0, attempt - 1);
  const jittered = exp * (0.75 + rand() * 0.5);
  return Math.min(maxMs, Math.max(floor, Math.round(jittered)));
}
