// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
/** @typedef {import('./_types.js').Job} Job */

// Workable job search provider — the public search behind jobs.workable.com,
// which lists the open roles of every company hiring on Workable (~170k
// postings, all professions, worldwide):
//
//   GET https://jobs.workable.com/api/v1/jobs?query=…&workplace=remote&location=…&day_range=7[&pageToken=…]
//   -> { totalSize, nextPageToken, jobs: [ { id, title, url, created, workplace,
//        locations[], company: { title }, description, … } ] }
//
// 20 jobs per page, newest first, cursor-paged with `nextPageToken`. Filters
// verified 2026-10-13 by their effect on `totalSize`: workplace (remote |
// hybrid | on_site), location (country or region, e.g. "France", "Europe"),
// day_range (days since posting). robots.txt disallows the HTML /search pages
// with a query string, not /api/; it also signals `search=yes`.
//
// Different from workable.mjs, which reads one company's account widget.
// `url` is the jobs.workable.com posting page (its Apply button leads to the
// employer's apply.workable.com form). A company that posts one role in
// several countries returns one item per country: they collapse into one job
// whose location lists them all.
//
// Wire in via a `job_boards:` entry; keywords come from the scanning
// profile ("{roles}", filled by lib/scan-targeting.mjs), else from
// config/profile.yml target roles:
//
//   - name: Workable — Remote
//     provider: workable-jobs
//     workable_jobs:
//       keywords: ["{roles}"]
//       workplace: remote      # optional
//       location: Europe       # optional
//       day_range: 7           # optional
//       max_pages: 2           # 20 jobs per page
//     enabled: true

import { fetchJsonWithRetry, sleep } from './_http.mjs';
import { htmlToText } from './_html-to-text.mjs';
import { resolveProfileKeywords } from './_profile-keywords.mjs';

const HOST = 'jobs.workable.com';
const ENDPOINT = `https://${HOST}/api/v1/jobs`;
const DEFAULT_MAX_PAGES = 2;
const HARD_MAX_PAGES = 10;
const REQUEST_DELAY_MS = 1000;
const WORKPLACES = new Set(['remote', 'hybrid', 'on_site']);
const WORKPLACE_LABEL = { remote: 'Remote', hybrid: 'Hybrid', on_site: 'On-site' };
const RETRY_POLICY = { retries: 2, baseDelayMs: 500, maxDelayMs: 8_000 };

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Read the entry's `workable_jobs:` block. Unfilled placeholders ("{roles}")
 * are dropped so the profile fallback applies.
 * @param {any} entry
 */
export function readWorkableJobsConfig(entry = {}) {
  const cfg = (entry && typeof entry.workable_jobs === 'object' && entry.workable_jobs) || {};
  const raw = Array.isArray(cfg.keywords) ? cfg.keywords : [cfg.keywords];
  const keywords = [...new Set(raw.map(cleanText).filter((k) => k && !k.includes('{')))];
  const workplace = WORKPLACES.has(cfg.workplace) ? cfg.workplace : '';
  const dayRange = Number(cfg.day_range);
  const pages = Number(cfg.max_pages);
  return {
    keywords,
    workplace,
    location: cleanText(cfg.location),
    dayRange: Number.isInteger(dayRange) && dayRange > 0 ? dayRange : 0,
    maxPages: Number.isInteger(pages) && pages > 0 ? Math.min(pages, HARD_MAX_PAGES) : DEFAULT_MAX_PAGES,
  };
}

/**
 * @param {string} keyword
 * @param {ReturnType<typeof readWorkableJobsConfig>} cfg
 * @param {string} [pageToken]
 */
export function buildWorkableJobsUrl(keyword, cfg, pageToken = '') {
  const params = new URLSearchParams({ query: keyword });
  if (cfg.workplace) params.set('workplace', cfg.workplace);
  if (cfg.location) params.set('location', cfg.location);
  if (cfg.dayRange) params.set('day_range', String(cfg.dayRange));
  if (pageToken) params.set('pageToken', pageToken);
  return `${ENDPOINT}?${params.toString()}`;
}

function postingUrl(value) {
  try {
    const parsed = new URL(cleanText(value));
    return parsed.protocol === 'https:' && parsed.hostname === HOST ? parsed.href : '';
  } catch {
    return '';
  }
}

/**
 * Parse one search page; same title + company in several places collapse
 * into one job. Exported for unit tests.
 * @param {unknown} json
 * @returns {Job[]}
 */
export function parseWorkableJobsResponse(json) {
  const items = /** @type {any} */ (json)?.jobs;
  if (!Array.isArray(items)) return [];
  /** @type {Map<string, Job & { places: string[] }>} */
  const byRole = new Map();
  for (const item of items) {
    const title = cleanText(item?.title);
    const url = postingUrl(item?.url);
    if (!title || !url) continue;
    const company = cleanText(item.company?.title);
    const places = (Array.isArray(item.locations) ? item.locations : [])
      .map(cleanText)
      .filter((place) => place && place !== 'TELECOMMUTE');
    const key = `${title.toLowerCase()}|${company.toLowerCase()}`;
    const known = byRole.get(key);
    if (known) {
      known.places.push(...places.filter((place) => !known.places.includes(place)));
      continue;
    }
    const job = { title, url, company, location: '', places: [...new Set(places)] };
    const workplace = WORKPLACE_LABEL[/** @type {keyof typeof WORKPLACE_LABEL} */ (item.workplace)];
    if (workplace) job.workplace = workplace;
    const postedAt = Date.parse(cleanText(item.created));
    if (!Number.isNaN(postedAt)) job.postedAt = postedAt;
    const description = htmlToText(cleanText(item.description));
    if (description) job.description = description;
    byRole.set(key, job);
  }
  return [...byRole.values()].map(({ places, workplace, ...job }) => ({
    ...job,
    location: [workplace, places.join('; ')].filter(Boolean).join(' — '),
  }));
}

/** @type {Provider} */
export default {
  id: 'workable-jobs',

  detect(entry) {
    return entry?.provider === 'workable-jobs' ? { url: ENDPOINT } : null;
  },

  async fetch(entry, ctx) {
    const cfg = readWorkableJobsConfig(entry);
    const keywords = cfg.keywords.length ? cfg.keywords : resolveProfileKeywords();
    if (!keywords.length) {
      console.error(`⚠️  workable-jobs: ${entry?.name ?? 'entry'} has no keywords — nothing to scan`);
      return [];
    }
    const hint = Number(ctx?.maxPages);
    const maxPages = Number.isFinite(hint) && hint > 0 ? Math.min(cfg.maxPages, Math.floor(hint)) : cfg.maxPages;

    const seen = new Set();
    /** @type {Job[]} */
    const out = [];
    let requests = 0;
    for (const keyword of keywords) {
      let pageToken = '';
      for (let page = 1; page <= maxPages; page += 1) {
        if (requests > 0) await sleep(REQUEST_DELAY_MS, ctx);
        requests += 1;
        const json = /** @type {any} */ (await fetchJsonWithRetry(ctx, buildWorkableJobsUrl(keyword, cfg, pageToken), { redirect: 'error' }, RETRY_POLICY));
        if (!json || !Array.isArray(json.jobs)) {
          throw new Error(`workable-jobs: unexpected API response — expected { jobs: [...] }, got keys: [${json && typeof json === 'object' ? Object.keys(json).join(', ') : typeof json}]`);
        }
        for (const job of parseWorkableJobsResponse(json)) {
          const key = `${job.title.toLowerCase()}|${job.company.toLowerCase()}`;
          if (seen.has(job.url) || seen.has(key)) continue;
          seen.add(job.url).add(key);
          out.push(job);
        }
        pageToken = cleanText(json.nextPageToken);
        if (!pageToken || json.jobs.length === 0) break;
      }
    }
    return out;
  },
};
