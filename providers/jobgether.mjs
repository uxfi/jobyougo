// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
/** @typedef {import('./_types.js').Job} Job */

// Jobgether provider — remote-jobs aggregator (https://jobgether.com) read
// through the endpoint Jobgether documents for AI agents:
//
//   GET https://jobgether.com/astroapi/ai/jobs.json?keyword=…&locations=…&limit=25&page=N
//   -> { jobs: [ { id, title, company, url, location, remote, contractType,
//                  experience, salaryRange, jobFunctions[], postedAt } ],
//        pagination: { page, limit, hasMore } }
//
// Docs: https://jobgether.com/astroapi/ai/jobs/docs (fetched 2026-10-09).
// robots.txt (same date) allows exactly this path and its query string
// (`Allow: /astroapi/ai/jobs.json?*`) while disallowing every other `?`
// URL, and sets `Crawl-delay: 2` — honoured below between requests.
//
// Each job's `url` is the Jobgether listing page (the API exposes no employer
// link), so the source's own page is the posting URL — the documented
// fallback in ADDING_A_PROVIDER.md when no upstream link exists. `remote`
// ("Full Remote", "Hybrid", …) and `location` ("Europe, EMEA", "Anywhere",
// "United States") are folded into `location` so remote_filter /
// location_filter can gate on them without a detail fetch.
//
// Wire in via a `job_boards:` entry with `provider: jobgether` and a
// `jobgether:` block. keywords are REQUIRED (there is no default query set —
// one user's targeting must not be baked into shared code):
//
//   - name: Jobgether — Design & Product (Europe)
//     provider: jobgether
//     jobgether:
//       keywords: ["product designer", "ux designer"]
//       locations: ["europe", "anywhere"]   # slugs: country / continent / "anywhere"
//       max_pages: 2                        # 25 jobs per page (server cap)
//     enabled: true
//
// Each keyword × location pair is paged newest-first until `hasMore` is false
// or `max_pages` is reached. An unknown location slug answers HTTP 400, which
// surfaces as a provider error rather than a silent empty board.

import { fetchJsonWithRetry, sleep } from './_http.mjs';

const HOST = 'jobgether.com';
const ENDPOINT = `https://${HOST}/astroapi/ai/jobs.json`;
const PAGE_SIZE = 25;          // server cap — larger `limit` values are clamped
const DEFAULT_MAX_PAGES = 2;
const HARD_MAX_PAGES = 10;
const CRAWL_DELAY_MS = 2000;   // robots.txt Crawl-delay: 2
const RETRY_POLICY = { retries: 2, baseDelayMs: 500, maxDelayMs: 8_000 };

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function stringList(value) {
  const list = Array.isArray(value) ? value : (typeof value === 'string' ? [value] : []);
  return [...new Set(list.map(v => (typeof v === 'string' ? v.trim() : '')).filter(Boolean))];
}

/**
 * Read the entry config. The nested `jobgether:` block wins; flat keys are
 * accepted for parity with other board providers.
 * @param {any} entry
 * @returns {{ keywords: string[], locations: string[], maxPages: number }}
 */
export function readJobgetherConfig(entry = {}) {
  const cfg = (entry && typeof entry.jobgether === 'object' && entry.jobgether) || {};
  const keywords = stringList(cfg.keywords ?? entry.keywords);
  const locations = stringList(cfg.locations ?? entry.locations);
  const rawPages = Number(cfg.max_pages ?? entry.max_pages);
  const maxPages = Number.isFinite(rawPages) && rawPages > 0
    ? Math.min(Math.floor(rawPages), HARD_MAX_PAGES)
    : DEFAULT_MAX_PAGES;
  return { keywords, locations: locations.length ? locations : [''], maxPages };
}

/**
 * @param {string} keyword
 * @param {string} location - '' for no location restriction
 * @param {number} page
 * @returns {string}
 */
export function buildJobgetherUrl(keyword, location, page) {
  const params = new URLSearchParams();
  params.set('keyword', keyword);
  if (location) params.set('locations', location);
  params.set('limit', String(PAGE_SIZE));
  params.set('page', String(page));
  return `${ENDPOINT}?${params.toString()}`;
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function postingUrl(value) {
  const raw = cleanText(value);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol !== 'https:' || (host !== HOST && host !== `www.${HOST}`)) return '';
    return parsed.href;
  } catch {
    return '';
  }
}

function toEpochMs(value) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Parse one Jobgether page. Exported for unit tests.
 * @param {unknown} json
 * @param {string} [fallbackCompany]
 * @returns {Job[]}
 */
export function parseJobgetherResponse(json, fallbackCompany = '') {
  if (!json || typeof json !== 'object' || !Array.isArray(/** @type {any} */ (json).jobs)) return [];
  /** @type {Job[]} */
  const jobs = [];
  for (const item of /** @type {any} */ (json).jobs) {
    if (!item || typeof item !== 'object') continue;
    const title = cleanText(item.title);
    const url = postingUrl(item.url);
    if (!title || !url) continue;
    const location = [cleanText(item.remote), cleanText(item.location)].filter(Boolean).join(' — ');
    /** @type {Job} */
    const job = {
      title,
      url,
      company: cleanText(item.company) || fallbackCompany,
      location,
    };
    const postedAt = toEpochMs(item.postedAt);
    if (postedAt !== undefined) job.postedAt = postedAt;
    jobs.push(job);
  }
  return jobs;
}

/**
 * @param {unknown} json
 * @returns {boolean}
 */
function hasMore(json) {
  const pagination = /** @type {any} */ (json)?.pagination;
  return Boolean(pagination && pagination.hasMore === true);
}

/** @type {Provider} */
export default {
  id: 'jobgether',

  detect(entry) {
    return entry?.provider === 'jobgether' ? { url: ENDPOINT } : null;
  },

  async fetch(entry, ctx) {
    const { keywords, locations, maxPages: entryMax } = readJobgetherConfig(entry);
    const label = entry?.name ?? 'entry';
    if (!keywords.length) {
      console.error(`⚠️  jobgether: ${label} has no jobgether.keywords — nothing to scan`);
      return [];
    }
    const hint = Number(ctx?.maxPages);
    const maxPages = Number.isFinite(hint) && hint > 0 ? Math.min(entryMax, Math.floor(hint)) : entryMax;

    const seen = new Set();
    /** @type {Job[]} */
    const out = [];
    let requests = 0;
    for (const keyword of keywords) {
      for (const location of locations) {
        for (let page = 1; page <= maxPages; page += 1) {
          if (requests > 0) await sleep(CRAWL_DELAY_MS, ctx);
          requests += 1;
          const json = await fetchJsonWithRetry(ctx, buildJobgetherUrl(keyword, location, page), { redirect: 'error' }, RETRY_POLICY);
          if (!json || typeof json !== 'object' || !Array.isArray(/** @type {any} */ (json).jobs)) {
            throw new Error(`jobgether: unexpected API response — expected { jobs: [...] }, got keys: [${json && typeof json === 'object' ? Object.keys(json).join(', ') : typeof json}]`);
          }
          const jobs = parseJobgetherResponse(json, entry?.name || 'Jobgether');
          for (const job of jobs) {
            if (seen.has(job.url)) continue;
            seen.add(job.url);
            out.push(job);
          }
          if (!hasMore(json) || jobs.length === 0) break;
        }
      }
    }
    return out;
  },
};
