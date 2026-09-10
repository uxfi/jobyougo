// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// JobTech Sweden provider — official Arbetsformedlingen job-search API.
// Public search endpoint: https://jobsearch.api.jobtechdev.se/search
//
// Configure in `job_boards:` with `provider: jobtech` and a `jobtech:` block:
//
//   - name: JobTech Sweden — AI remote
//     provider: jobtech
//     jobtech:
//       keywords: ["AI Product Manager", "Solutions Architect"]
//       remote: true
//       limit: 100
//       max_pages: 3
//     enabled: true
//
// The API is Sweden-specific. It supports a free-text `q` parameter, optional
// `remote=true`, `limit` up to 100, and `offset` pagination. scan.mjs applies
// the global title/location/content filters after this provider returns rows.

import { intInRange } from './_config-utils.mjs';
import { resolveProfileKeywords } from './_profile-keywords.mjs';

const SEARCH_URL = 'https://jobsearch.api.jobtechdev.se/search';
const TRUSTED_HOST = 'jobsearch.api.jobtechdev.se';
const DEFAULT_LIMIT = 100;
const DEFAULT_MAX_PAGES = 3;
const MAX_PAGES_CAP = 50;

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanKeywords(value) {
  const arr = Array.isArray(value) ? value : [];
  return [...new Set(arr.filter(k => typeof k === 'string').map(k => k.trim()).filter(Boolean))];
}

/** @param {string} url */
function assertJobtechUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`jobtech: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`jobtech: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== TRUSTED_HOST) {
    throw new Error(`jobtech: untrusted hostname "${parsed.hostname}" — must be ${TRUSTED_HOST}`);
  }
  return parsed;
}

/**
 * Reads and sanitizes the entry's `jobtech:` config block. Exported for tests.
 * @param {{ jobtech?: any, keywords?: any, max_pages?: any }} entry
 * @returns {{ keywords: string[], remote: boolean, limit: number, maxPages: number }}
 */
export function parseJobtechConfig(entry) {
  const cfg = entry?.jobtech && typeof entry.jobtech === 'object' ? entry.jobtech : {};
  const keywords =
    cleanKeywords(cfg.keywords).length ? cleanKeywords(cfg.keywords)
      : cleanKeywords(entry?.keywords).length ? cleanKeywords(entry?.keywords)
        : resolveProfileKeywords();
  return {
    keywords,
    remote: cfg.remote === true,
    limit: intInRange(cfg.limit, DEFAULT_LIMIT, 1, DEFAULT_LIMIT),
    maxPages: intInRange(cfg.max_pages ?? entry?.max_pages, DEFAULT_MAX_PAGES, 1, MAX_PAGES_CAP),
  };
}

/**
 * Build a pinned JobTech search URL. Exported for tests.
 * @param {{ q: string, remote: boolean, limit: number, offset: number }} params
 */
export function buildJobtechSearchUrl(params) {
  const url = assertJobtechUrl(SEARCH_URL);
  url.searchParams.set('q', params.q);
  url.searchParams.set('limit', String(params.limit));
  url.searchParams.set('offset', String(params.offset));
  if (params.remote) url.searchParams.set('remote', 'true');
  return url.href;
}

/** @param {unknown} value */
function toEpochMs(value) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** @param {unknown} value */
function safeUrl(value) {
  const raw = cleanString(value);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' ? parsed.href : '';
  } catch {
    return '';
  }
}

/**
 * Builds a readable location from JobTech's workplace fields.
 * @param {any} hit
 */
export function normalizeJobtechLocation(hit) {
  const parts = [];
  const model = cleanString(hit?.workplace_model?.label);
  if (/remote|distans/i.test(model)) parts.push('Remote');

  const addAddress = (addr) => {
    if (!addr || typeof addr !== 'object') return;
    const city = cleanString(addr.city);
    const region = cleanString(addr.region);
    const country = cleanString(addr.country);
    const assembled = [city, region, country].filter(Boolean).join(', ');
    if (assembled) parts.push(assembled);
  };

  if (Array.isArray(hit?.workplace_addresses) && hit.workplace_addresses.length > 0) {
    for (const addr of hit.workplace_addresses.slice(0, 3)) addAddress(addr);
  } else {
    addAddress(hit?.workplace_address);
  }

  return [...new Set(parts)].join(' / ');
}

/**
 * Normalize one JobTech hit into the shared Job shape. Exported for tests.
 * @param {any} hit
 * @param {string} [fallbackCompany]
 * @returns {{ title: string, url: string, company: string, location: string, description?: string, postedAt?: number } | null}
 */
export function normalizeJobtechJob(hit, fallbackCompany) {
  if (!hit || typeof hit !== 'object') return null;
  const title = cleanString(hit.headline);
  if (!title) return null;

  const url = safeUrl(hit.webpage_url) || safeUrl(hit.application_details?.url);
  if (!url) return null;

  const company = cleanString(hit.employer?.name) || cleanString(fallbackCompany) || 'JobTech Sweden';
  const location = normalizeJobtechLocation(hit);
  const description = cleanString(hit.description?.text);
  const postedAt = toEpochMs(hit.publication_date);

  /** @type {{ title: string, url: string, company: string, location: string, description?: string, postedAt?: number }} */
  const job = { title, url, company, location };
  if (description) job.description = description;
  if (postedAt !== undefined) job.postedAt = postedAt;
  return job;
}

/** @type {Provider} */
export default {
  id: 'jobtech',

  detect(entry) {
    return entry?.provider === 'jobtech' ? { url: SEARCH_URL } : null;
  },

  async fetch(entry, ctx) {
    const { keywords, remote, limit, maxPages } = parseJobtechConfig(entry);
    if (!keywords.length) {
      throw new Error(`jobtech: entry "${entry?.name || '(unnamed)'}" has no jobtech.keywords[] and no profile fallback`);
    }

    const byUrl = new Map();
    const errors = [];
    let succeeded = 0;
    const pageCap = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0 ? Math.min(ctx.maxPages, maxPages) : maxPages;

    for (const keyword of keywords) {
      for (let page = 0; page < pageCap; page++) {
        const offset = page * limit;
        const url = buildJobtechSearchUrl({ q: keyword, remote, limit, offset });
        let json;
        try {
          json = /** @type {any} */ (await ctx.fetchJson(url, {
            headers: { accept: 'application/json' },
            redirect: 'error',
          }));
        } catch (err) {
          if (ctx?.maxPages) throw err;
          errors.push(`"${keyword}" page ${page + 1}: ${(err && err.message) || err}`);
          break;
        }

        const hits = json?.hits;
        if (!Array.isArray(hits)) {
          throw new Error(
            `jobtech: unexpected API response for "${keyword}" page ${page + 1} — expected { hits: [...] }, got keys: [${json ? Object.keys(json).join(', ') : 'null'}]`,
          );
        }
        succeeded++;

        for (const hit of hits) {
          const job = normalizeJobtechJob(hit, entry?.name);
          if (job && !byUrl.has(job.url)) byUrl.set(job.url, job);
        }

        const total = Number(json?.total?.value);
        if (hits.length < limit) break;
        if (Number.isFinite(total) && offset + hits.length >= total) break;
      }
    }

    if (succeeded === 0 && errors.length) {
      throw new Error(`jobtech: all ${keywords.length} keyword request(s) failed — ${errors[0]}`);
    }

    return [...byUrl.values()];
  },
};
