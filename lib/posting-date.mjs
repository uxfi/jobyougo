// Publication dates for postings a web search found. A posting with no date
// passes the scan's age filter (unknown is not old), and 154 of 159 web-search
// rows scanned 2026-10-07..15 had none: offers months old reached Jev and Qwen.
// Each host's own public API answers first; a plain page read for JSON-LD
// `datePosted` comes before the caller's browser fallback.

const DAY = /^(\d{4}-\d{2}-\d{2})/;

function day(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value < 1e12 ? value * 1000 : value;
    return new Date(ms).toISOString().slice(0, 10);
  }
  const match = String(value).trim().match(DAY);
  return match ? match[1] : null;
}

async function getJson(fetchImpl, url, { timeoutMs, ...init } = {}) {
  const r = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), ...init });
  if (!r.ok) return null;
  return r.json().catch(() => null);
}

/** `datePosted` from a page's JSON-LD, else a datePosted/published meta tag. */
export function datePostedFromHtml(html = '') {
  const text = String(html || '');
  for (const block of text.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data;
    try {
      data = JSON.parse(block[1].trim());
    } catch {
      continue;
    }
    const stack = [data];
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== 'object') continue;
      if (Array.isArray(node)) {
        stack.push(...node);
        continue;
      }
      const found = day(node.datePosted);
      if (found) return found;
      if (node['@graph']) stack.push(node['@graph']);
    }
  }
  const meta = text.match(/<meta[^>]+(?:itemprop=["']datePosted["']|property=["']article:published_time["'])[^>]*content=["']([^"']+)["']/i)
    || text.match(/"datePosted"\s*:\s*"([^"]+)"/);
  return meta ? day(meta[1]) : null;
}

const WTTJ_ORIGIN = 'https://www.welcometothejungle.com';
let wttjKeys = null;

async function wttjAlgoliaKeys(fetchImpl, timeoutMs) {
  if (wttjKeys) return wttjKeys;
  const r = await fetchImpl(`${WTTJ_ORIGIN}/api/env`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) return null;
  const text = await r.text();
  const env = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  const appId = String(env.PUBLIC_ALGOLIA_APPLICATION_ID || '').trim();
  const apiKey = String(env.PUBLIC_ALGOLIA_API_KEY_CLIENT || '').trim();
  if (!/^[A-Z0-9]{6,16}$/i.test(appId) || !apiKey) return null;
  wttjKeys = { appId, apiKey };
  return wttjKeys;
}

// welcometothejungle.com answers plain requests with 403; its jobs index
// (providers/wttj.mjs) carries published_at_timestamp.
async function wttjDate(url, fetchImpl, timeoutMs) {
  const m = url.match(/^https:\/\/(?:www\.)?welcometothejungle\.com\/[a-z]{2}\/companies\/([a-z0-9_-]+)\/jobs\/([a-z0-9_-]+)/i);
  if (!m) return undefined;
  const keys = await wttjAlgoliaKeys(fetchImpl, timeoutMs);
  if (!keys) return null;
  // The index does not search slugs: query the company and title words
  // ("ramp product designer" for ramp/jobs/product-designer_fr_faytlc25).
  const words = (slug) => slug.replace(/_.*$/, '').replace(/-\d+$/, '').replace(/[-_]+/g, ' ').trim();
  const params = new URLSearchParams({
    query: `${words(m[1])} ${words(m[2])}`,
    hitsPerPage: '20',
    attributesToRetrieve: 'slug,organization,published_at_timestamp',
  });
  const json = await getJson(fetchImpl, `https://${keys.appId}-dsn.algolia.net/1/indexes/wttj_jobs_production_en/query`, {
    timeoutMs,
    method: 'POST',
    headers: {
      'x-algolia-application-id': keys.appId,
      'x-algolia-api-key': keys.apiKey,
      referer: `${WTTJ_ORIGIN}/`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ params: params.toString() }),
  });
  const hit = (json?.hits || []).find(h => h?.slug === m[2] && h?.organization?.slug === m[1]);
  return hit ? day(hit.published_at_timestamp) : null;
}

// 404/410 from a board API means the posting is gone; 429, 5xx and network
// errors say nothing about it.
const GONE = new Set([404, 410]);

async function fetchStatus(fetchImpl, url, timeoutMs) {
  const r = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (GONE.has(r.status)) return { closed: true };
  if (!r.ok) return { json: null };
  return { json: await r.json().catch(() => null) };
}

function fromJob({ closed, json }, field) {
  return closed ? { date: null, closed: true } : { date: day(json?.[field]), closed: false };
}

/** Lever posting page: 404/410 = closed; a page showing the posting = open. */
export async function leverPageStatus(fetchImpl, pageUrl, timeoutMs = 10_000) {
  try {
    const r = await fetchImpl(pageUrl, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', Accept: 'text/html' },
    });
    if (GONE.has(r.status)) return { date: null, closed: true, closedBy: 'lever-page' };
    if (!r.ok) return { date: null, closed: false };
    const html = await r.text().catch(() => '');
    if (/posting-headline|class="posting-page"|data-qa="posting-name"/i.test(html)) return { date: datePostedFromHtml(html), closed: false };
    return { date: null, closed: false };
  } catch {
    return { date: null, closed: false };
  }
}

/**
 * Date and closed state from the host's own API, or undefined when no API
 * covers the URL (the caller then reads the page). `getAshbyBoard(slug)`
 * returns the board JSON, {} when it could not be read. A WTTJ miss is never
 * "closed": its index is searched, not addressed.
 */
export async function postingStatusFromApi(url, { fetchImpl = fetch, timeoutMs = 10_000, getAshbyBoard, findAshbyJob } = {}) {
  let m = url.match(/^https:\/\/(?:job-boards|boards)(?:\.eu)?\.greenhouse\.io\/([^/?#]+)\/jobs\/(\d+)/i);
  if (m) {
    const res = await fetchStatus(fetchImpl, `https://boards-api.greenhouse.io/v1/boards/${m[1]}/jobs/${m[2]}`, timeoutMs);
    if (res.closed) return { date: null, closed: true };
    return { date: day(res.json?.first_published), closed: false };
  }
  m = url.match(/^https:\/\/jobs(\.eu)?\.lever\.co\/([^/?#]+)\/([a-f0-9-]{36})/i);
  if (m) {
    const base = m[1] ? 'https://api.eu.lever.co' : 'https://api.lever.co';
    const res = await fetchStatus(fetchImpl, `${base}/v0/postings/${m[2]}/${m[3]}?mode=json`, timeoutMs);
    if (!res.closed) return fromJob(res, 'createdAt');
    // The postings API lists published postings only: an unlisted one that
    // still takes applications answers 404 there too (Airalo "Senior Product
    // Designer, UX", 2026-10-19). Only the posting page itself says closed.
    return leverPageStatus(fetchImpl, `https://jobs${m[1] || ''}.lever.co/${m[2]}/${m[3]}`, timeoutMs);
  }
  m = url.match(/^https:\/\/jobs\.ashbyhq\.com\/([^/?#]+)\/([a-f0-9-]{36})/i);
  if (m && getAshbyBoard && findAshbyJob) {
    const board = await getAshbyBoard(m[1]);
    if (!Array.isArray(board?.jobs)) return { date: null, closed: false };
    const job = findAshbyJob(board, m[2]);
    return job ? { date: day(job.publishedAt), closed: false } : { date: null, closed: true };
  }
  m = url.match(/^https:\/\/apply\.workable\.com\/([a-z0-9_-]+)\/j\/([A-Z0-9]+)/i);
  if (m) {
    return fromJob(await fetchStatus(fetchImpl, `https://apply.workable.com/api/v2/accounts/${m[1]}/jobs/${m[2]}`, timeoutMs), 'published');
  }
  m = url.match(/^https:\/\/jobs\.smartrecruiters\.com\/([^/?#]+)\/(\d+)/i);
  if (m) {
    return fromJob(await fetchStatus(fetchImpl, `https://api.smartrecruiters.com/v1/companies/${m[1]}/postings/${m[2]}`, timeoutMs), 'releasedDate');
  }
  m = url.match(/^https:\/\/ats\.rippling\.com\/([^/?#]+)\/jobs\/([a-f0-9-]{36})/i);
  if (m) {
    return fromJob(await fetchStatus(fetchImpl, `https://api.rippling.com/platform/api/ats/v1/board/${m[1]}/jobs/${m[2]}`, timeoutMs), 'createdOn');
  }
  const wttj = await wttjDate(url, fetchImpl, timeoutMs);
  return wttj === undefined ? undefined : { date: wttj, closed: false };
}

/** JSON-LD date of a page fetched without a browser. */
export async function postingDateFromPage(url, { fetchImpl = fetch, timeoutMs = 10_000 } = {}) {
  const r = await fetchImpl(url, {
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!r.ok || !/html/i.test(r.headers.get('content-type') || 'text/html')) return null;
  return datePostedFromHtml((await r.text()).slice(0, 2_000_000));
}
