// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Jobicy provider — board-wide remote-jobs aggregator feed
// (https://jobicy.com/api/v2/remote-jobs?count=50). Returns { jobs: [...] }.
//
// Wire in via a `job_boards:` entry with `provider: jobicy`. The bare entry
// reads the newest 50 postings across every industry. The public API also
// takes `industry` (a slug from ?get=industries, e.g. design-multimedia),
// `tag` (free text, 3–50 chars) and `geo` (anywhere / europe / apac / …), so
// an entry can narrow the feed server-side and reach deeper than the newest
// 50 of the whole board:
//
//   - name: Jobicy — Creative & Design
//     provider: jobicy
//     jobicy:
//       industry: design-multimedia
//       count: 50            # 1–100
//     enabled: true
//
// Flat `industry` / `tag` / `geo` / `count` keys are accepted too.

const BASE_URL = 'https://jobicy.com/api/v2/remote-jobs';
const DEFAULT_COUNT = 50;
const MAX_COUNT = 100;
const TAG_MIN_LENGTH = 3;   // server-validated: shorter tags answer HTTP 400
const TAG_MAX_LENGTH = 50;
const FEED_URL = `${BASE_URL}?count=${DEFAULT_COUNT}`;

/**
 * Build the feed URL for an entry. Exported for unit tests.
 * @param {any} [entry]
 * @returns {string}
 */
export function buildJobicyUrl(entry = {}) {
  const cfg = (entry && typeof entry.jobicy === 'object' && entry.jobicy) || {};
  const pick = (key) => {
    const value = cfg[key] ?? entry?.[key];
    return typeof value === 'string' ? value.trim() : '';
  };
  const rawCount = Number(cfg.count ?? entry?.count);
  const count = Number.isFinite(rawCount) && rawCount > 0
    ? Math.min(Math.floor(rawCount), MAX_COUNT)
    : DEFAULT_COUNT;
  const params = new URLSearchParams({ count: String(count) });
  const industry = pick('industry');
  if (industry) params.set('industry', industry);
  const tag = pick('tag');
  if (tag) {
    if (tag.length < TAG_MIN_LENGTH || tag.length > TAG_MAX_LENGTH) {
      throw new Error(`jobicy: tag must be ${TAG_MIN_LENGTH}–${TAG_MAX_LENGTH} characters, got "${tag}"`);
    }
    params.set('tag', tag);
  }
  const geo = pick('geo');
  if (geo) params.set('geo', geo);
  return `${BASE_URL}?${params.toString()}`;
}

/** @type {Provider} */
export default {
  id: 'jobicy',

  detect(entry) {
    if (entry?.provider !== 'jobicy') return null;
    try {
      return { url: buildJobicyUrl(entry) };
    } catch {
      return { url: FEED_URL };
    }
  },

  /**
   * Fetches and normalizes postings from the Jobicy public feed.
   * @param {{ name?: string }} entry - The job_boards entry being processed.
   * @param {{ fetchJson: (url: string, opts?: { redirect?: 'error'|'follow'|'manual' }) => Promise<any> }} ctx - HTTP context.
   * @returns {Promise<Array<{title: string, url: string, company: string, location: string, postedAt?: number}>>}
   */
  async fetch(entry, ctx) {
    const feedUrl = buildJobicyUrl(entry);
    // redirect:'error' prevents SSRF via server-side redirects
    const json = await ctx.fetchJson(feedUrl, { redirect: 'error' });
    if (!json || !Array.isArray(json.jobs)) {
      throw new Error(`jobicy: unexpected API response — expected { jobs: [...] }, got keys: [${json ? Object.keys(json).join(', ') : 'null'}]`);
    }

    return parseJobicyResponse(json, entry.name || 'Jobicy');
  },
};

/**
 * Parse a Jobicy API response. Exported for unit tests.
 *
 * @param {any} json - Raw response payload.
 * @param {string} defaultCompany - Fallback company name.
 * @returns {Array<{title: string, url: string, company: string, location: string}>}
 */
export function parseJobicyResponse(json, defaultCompany = 'Jobicy') {
  if (!json || !Array.isArray(json.jobs)) return [];

  const toEpochMs = (value) => {
    if (!value) return undefined;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  };

  return json.jobs
    .map(j => {
      if (!j || typeof j !== 'object') return null;

      const title = typeof j.jobTitle === 'string' ? j.jobTitle.trim() : '';
      if (!title) return null;

      const rawUrl = typeof j.url === 'string' ? j.url.trim() : '';
      let url = null;
      try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol === 'https:' && (parsed.hostname === 'jobicy.com' || parsed.hostname === 'www.jobicy.com')) {
          url = parsed.href;
        }
      } catch {
        // Invalid or malformed URL
      }
      if (!url) return null;

      const company = typeof j.companyName === 'string' && j.companyName.trim() ? j.companyName.trim() : defaultCompany;
      const location = typeof j.jobGeo === 'string' ? j.jobGeo.trim() : '';
      const postedAt = toEpochMs(j.pubDate);

      return {
        title,
        url,
        company,
        location,
        postedAt,
      };
    })
    .filter(j => j !== null);
}
