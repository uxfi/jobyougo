// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Remotive provider - public remote-jobs API (https://remotive.com/api/remote-jobs).
// Returns { jobs: [...] }. Optional `category:` (Remotive category slug, e.g.
// `design`, `product`) narrows the feed; scan.mjs's title_filter still gates titles.
//
// API terms (legal notice in every response): link back to the Remotive URL and
// mention Remotive as the source; no more than ~4 calls a day. Jobs keep the
// remotive.com URL, carry `via: 'Remotive'`, and the scan throttles this source
// to one fetch per 6 h (override with `min_interval_minutes`).
//
// Wire in via a `job_boards:` entry with `provider: remotive`.

import { fetchJsonWithRetry } from './_http.mjs';

const FEED_URL = 'https://remotive.com/api/remote-jobs';
const CATEGORY_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;

/** @param {Record<string, unknown>} [entry] */
export function remotiveFeedUrl(entry) {
  const category = typeof entry?.category === 'string' ? entry.category.trim().toLowerCase() : '';
  if (!category) return FEED_URL;
  if (!CATEGORY_RE.test(category)) throw new Error(`remotive: invalid category slug: ${category}`);
  return `${FEED_URL}?category=${encodeURIComponent(category)}`;
}

// Remotive dates have no zone ("2026-10-17T16:04:29"); they are UTC.
/** @param {unknown} value */
function toEpochMs(value) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const raw = value.trim();
  const ms = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw) || !raw.includes('T') ? raw : `${raw}Z`);
  return Number.isNaN(ms) ? undefined : ms;
}

/** @param {unknown} html */
function plainText(html) {
  return typeof html === 'string'
    ? html.replace(/<(?:br|\/p|\/li|\/h\d)[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"')
      .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim()
    : '';
}

/** @type {Provider & { minIntervalMinutes: number, attribution: { name: string, url: string } }} */
export default {
  id: 'remotive',
  minIntervalMinutes: 360,
  attribution: { name: 'Remotive', url: 'https://remotive.com' },

  /**
   * Fetches and normalizes postings from the Remotive public feed.
   * @param {{ name?: string, category?: string }} entry - The job_boards entry being processed.
   * @param {any} ctx - HTTP context.
   */
  async fetch(entry, ctx) {
    // redirect:'error' prevents SSRF via server-side redirects
    const json = await fetchJsonWithRetry(ctx, remotiveFeedUrl(entry), { redirect: 'error' });
    if (!json || !Array.isArray(json.jobs)) {
      throw new Error(`remotive: unexpected API response - expected { jobs: [...] }, got keys: [${json ? Object.keys(json).join(', ') : 'null'}]`);
    }

    return json.jobs
      .filter(j => j && typeof j === 'object'
        && typeof j.title === 'string' && j.title.trim() !== ''
        && typeof j.url === 'string' && /^https?:\/\//i.test(j.url.trim()))
      .map(j => {
        const location = typeof j.candidate_required_location === 'string' ? j.candidate_required_location.trim() : '';
        /** @type {Record<string, any>} */
        const job = {
          title: j.title.trim(),
          url: j.url.trim(),
          company: typeof j.company_name === 'string' && j.company_name.trim() ? j.company_name.trim() : (entry.name || 'Remotive'),
          location,
          remoteEvidence: `Remote${location ? ` (${location})` : ''}`,
          via: 'Remotive',
        };
        const postedAt = toEpochMs(j.publication_date);
        if (postedAt !== undefined) job.postedAt = postedAt;
        const description = plainText(j.description);
        if (description) job.description = description;
        return job;
      });
  },
};