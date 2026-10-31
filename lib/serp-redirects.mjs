// Google result links that hide the posting URL.
//
// Measured 2026-10-31 through PinchTab: every outbound link of a Google results
// page is https://www.google.com/goto?url=<opaque token> (the older /url?q=<url>
// form is gone). The token cannot be decoded, but the link answers a plain 302
// whose Location is the posting. The page's visible breadcrumb is no substitute:
// it truncates long segments ("8165735-proj...") and sometimes leaves one out
// (".../1428832-nina-zerak" for ".../people/1428832-nina-zerak").
//
// The extractor in ui/server.mjs hands such a result over as { gotoHref }, and
// this module turns it into { url }. Until it did, the reader found no result on
// a page full of them and put the engine to rest as "unparsed results page".
//
// Following a link is one more request to Google, and Google answers a client
// that asks too much with a page (HTTP 200, no Location) instead of the 302: after
// ~35 links in a few minutes the same links stopped resolving, and the results
// page itself turned into a challenge. So only the results the caller wants are
// followed (`keep`), a refused batch stops the loop, and the module then rests
// for `cooldownMs` rather than keep asking.

// www.google.com or a country domain (google.de, google.co.th, google.com.au); never "google.com.evil.example".
const GOTO_HOST = /^www\.google\.(?:com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/i;
const GOOGLE_HOST = /(?:^|\.)google\./i;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const COOLDOWN_MS = 10 * 60 * 1000;
const BATCH_PAUSE_MS = 250;

let refusedUntil = 0;

/** Forget a refusal (tests; a scan that wants to try again). */
export function resetGoogleGotoCooldown() { refusedUntil = 0; }

/** Only a Google /goto link is ever fetched, whatever a page puts in its markup. */
export function isGoogleGotoUrl(href) {
  try {
    const url = new URL(String(href || ''));
    return url.protocol === 'https:' && GOTO_HOST.test(url.hostname) && url.pathname === '/goto';
  } catch { return false; }
}

const withoutGoto = ({ gotoHref, ...job }) => job;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * { url } for the posting a /goto link points at; { blocked: true } when Google
 * answered something else than a redirect (rate limit, "sorry" page, interstitial); {} on a network error.
 */
async function follow(href, { fetchImpl, timeoutMs }) {
  try {
    const res = await fetchImpl(href, {
      redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' },
    });
    if (res.status >= 300 && res.status < 400) {
      const target = new URL(res.headers?.get?.('location') || '', href);
      if (!/^https?:$/.test(target.protocol)) return {};
      if (GOOGLE_HOST.test(target.hostname)) return { blocked: /^\/sorry\b/.test(target.pathname) };
      return { url: target.href };
    }
    return { blocked: true };
  } catch {
    return {};
  }
}

/**
 * Resolve the { gotoHref } results of a Google page into { url } ones, in order.
 * A result that already has a URL is kept as it is; one that is not worth a
 * request (`keep` says no) or cannot be resolved is dropped. At most `max` links
 * are followed, `concurrency` at a time.
 * @param {object[]} jobs
 * @param {{ keep?: (job: object) => boolean, fetchImpl?: Function, concurrency?: number, timeoutMs?: number, max?: number, cooldownMs?: number, now?: () => number, pauseMs?: number }} [options]
 * @returns {Promise<{ jobs: object[], unresolved: number, blocked: boolean }>}
 */
export async function resolveGoogleGoto(jobs, {
  keep = null, fetchImpl = globalThis.fetch, concurrency = 3, timeoutMs = 8000, max = 12,
  cooldownMs = COOLDOWN_MS, now = Date.now, pauseMs = BATCH_PAUSE_MS,
} = {}) {
  const list = Array.isArray(jobs) ? jobs : [];
  const out = new Array(list.length).fill(null);
  const pending = [];
  list.forEach((job, i) => {
    if (!job || typeof job !== 'object') return;
    if (/^https?:\/\//i.test(job.url || '')) { out[i] = withoutGoto(job); return; }
    if (!isGoogleGotoUrl(job.gotoHref) || (keep && !keep(job))) return;
    if (pending.length < max) pending.push(i);
  });

  if (pending.length && now() < refusedUntil) {
    return { jobs: out.filter(Boolean), unresolved: pending.length, blocked: true };
  }

  let resolved = 0;
  let refused = 0;
  for (let k = 0; k < pending.length; k += concurrency) {
    if (k > 0) await sleep(pauseMs);
    const batch = pending.slice(k, k + concurrency);
    const answers = await Promise.all(batch.map((i) => follow(list[i].gotoHref, { fetchImpl, timeoutMs })));
    batch.forEach((i, j) => {
      if (answers[j].url) { out[i] = { ...withoutGoto(list[i]), url: answers[j].url }; resolved++; }
      else if (answers[j].blocked) refused++;
    });
    if (answers.every((a) => a.blocked)) { refusedUntil = now() + cooldownMs; break; }
  }
  return { jobs: out.filter(Boolean), unresolved: pending.length - resolved, blocked: resolved === 0 && refused > 0 };
}
