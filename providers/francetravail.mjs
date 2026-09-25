// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// France Travail provider — reads the public candidate search the site
// candidat.francetravail.fr/rechercheoffre/emploi renders. No OAuth: the
// partner API (api.francetravail.io) needs a client id, this page does not.
//
//   - name: France Travail — Product & Design
//     provider: francetravail
//     careers_url: https://candidat.francetravail.fr/rechercheoffre/emploi
//     francetravail:
//       keywords: ["Product Designer", "UX Designer"]
//       max_pages: 1          # 20 offers per page, per keyword
//     enabled: true

import { intInRange } from './_config-utils.mjs';
import { decodeEntities } from './_html-entities.mjs';
import { BROWSER_LIKE_USER_AGENT } from './_http.mjs';

const ORIGIN = 'https://candidat.francetravail.fr';
const SEARCH_URL = `${ORIGIN}/offres/recherche`;
const TRUSTED_HOST = 'candidat.francetravail.fr';
const PAGE_SIZE = 20;
const DEFAULT_MAX_PAGES = 1;
const MAX_PAGES_CAP = 5;

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanKeywords(value) {
  const arr = Array.isArray(value) ? value : [];
  return [...new Set(arr.filter(k => typeof k === 'string').map(k => k.trim()).filter(Boolean))];
}

function stripTags(value) {
  return decodeEntities(String(value || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * @param {{ francetravail?: any, keywords?: any, max_pages?: any }} entry
 */
export function parseFrancetravailConfig(entry) {
  const cfg = entry?.francetravail && typeof entry.francetravail === 'object' ? entry.francetravail : {};
  const keywords = cleanKeywords(cfg.keywords).length
    ? cleanKeywords(cfg.keywords)
    : cleanKeywords(entry?.keywords);
  return {
    keywords,
    maxPages: intInRange(cfg.max_pages ?? entry?.max_pages, DEFAULT_MAX_PAGES, 1, MAX_PAGES_CAP),
  };
}

/**
 * France Travail 301s some keywords onto a same-host landing page
 * (`/offres/emploi/product-manager/s28m17`). Follow that hop only.
 * Anything else (other host, non-https, non-redirect) stays unresolved.
 * @param {string} requestUrl
 * @param {number} status
 * @param {string | null | undefined} location
 * @returns {string | null}
 */
export function resolveFrancetravailRedirect(requestUrl, status, location) {
  if (status < 300 || status >= 400 || !location) return null;
  let next;
  try {
    next = new URL(location, requestUrl);
  } catch {
    return null;
  }
  if (next.protocol !== 'https:' || next.hostname !== TRUSTED_HOST) return null;
  if (next.href === requestUrl) return null;
  return next.href;
}

/**
 * @param {{ keyword: string, page: number }} params
 */
export function buildFrancetravailSearchUrl(params) {
  const url = new URL(SEARCH_URL);
  if (url.hostname !== TRUSTED_HOST) throw new Error(`francetravail: untrusted host ${url.hostname}`);
  const page = intInRange(params.page, 0, 0, MAX_PAGES_CAP - 1);
  const start = page * PAGE_SIZE;
  url.searchParams.set('motsCles', params.keyword);
  url.searchParams.set('offresPartenaires', 'true');
  url.searchParams.set('tri', '1');
  url.searchParams.set('range', `${start}-${start + PAGE_SIZE - 1}`);
  return url.href;
}

function splitEmployer(subtext) {
  const text = stripTags(subtext);
  const match = text.match(/^(.+?)\s+[-–]\s+(.+)$/);
  if (!match) return { company: text, location: '' };
  return { company: match[1].trim(), location: match[2].trim() };
}

/**
 * Parse one search-results HTML page into Jobs.
 * @param {string} html
 */
export function parseFrancetravailResults(html) {
  const src = String(html || '');
  const jobs = [];
  const seen = new Set();
  const starts = [...src.matchAll(/<li\b[^>]*\bdata-id-offre="([A-Za-z0-9]+)"[^>]*>/g)];
  for (let i = 0; i < starts.length; i++) {
    const id = starts[i][1];
    const from = starts[i].index + starts[i][0].length;
    const to = i + 1 < starts.length ? starts[i + 1].index : src.indexOf('</li>', from);
    const block = src.slice(from, to === -1 ? from : to);
    const title = stripTags(block.match(/class="media-heading-title">([^<]+)/)?.[1] || '');
    if (!title || seen.has(id)) continue;
    seen.add(id);
    const { company, location } = splitEmployer(block.match(/class="subtext">([\s\S]*?)<\/p>/)?.[1] || '');
    const description = stripTags(block.match(/class="description">([\s\S]*?)<\/p>/)?.[1] || '').slice(0, 500);
    jobs.push({
      title,
      url: `${ORIGIN}/offres/recherche/detail/${id}`,
      company,
      location: location ? `${location}, France` : 'France',
      ...(description ? { description } : {}),
    });
  }
  return jobs;
}

async function fetchSearchHtml(ctx, url) {
  const headers = {
    'user-agent': BROWSER_LIKE_USER_AGENT,
    accept: 'text/html',
  };
  try {
    return await ctx.fetchText(url, { redirect: 'manual', headers });
  } catch (err) {
    const next = resolveFrancetravailRedirect(url, err?.status, err?.location);
    if (!next) throw err;
    return ctx.fetchText(next, { redirect: 'error', headers });
  }
}

/** @type {Provider} */
export default {
  id: 'francetravail',

  detect(entry) {
    if (entry?.provider === 'francetravail') return { url: SEARCH_URL };
    const raw = cleanString(entry?.careers_url || entry?.api);
    if (!raw) return null;
    try {
      const host = new URL(raw).hostname;
      if (host === TRUSTED_HOST) return { url: SEARCH_URL };
    } catch { /* not a URL */ }
    return null;
  },

  async fetch(entry, ctx) {
    const cfg = parseFrancetravailConfig(entry);
    if (!cfg.keywords.length) {
      throw new Error('francetravail: set francetravail.keywords (the public search has no unfiltered feed)');
    }
    const jobs = [];
    const seen = new Set();
    for (const keyword of cfg.keywords) {
      for (let page = 0; page < cfg.maxPages; page++) {
        const url = buildFrancetravailSearchUrl({ keyword, page });
        const html = await fetchSearchHtml(ctx, url);
        const batch = parseFrancetravailResults(html);
        for (const job of batch) {
          if (seen.has(job.url)) continue;
          seen.add(job.url);
          jobs.push(job);
        }
        if (batch.length < PAGE_SIZE) break;
      }
    }
    return jobs;
  },
};
