// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// NAV Arbeidsplassen provider — Norway's official job vacancy feed.
// Docs: https://navikt.github.io/pam-stilling-feed/
//
// The feed is free to use but every request needs a bearer JWT. For experiments
// NAV publishes a rotating public token at /api/publicToken; production users
// can set NAV_JOB_FEED_TOKEN in .env to avoid depending on that endpoint.
//
// The feed is a change stream, not a search API: it contains active and inactive
// ads and expects consumers to filter client-side. This provider therefore uses
// If-Modified-Since, keeps only ACTIVE entries, filters by configured keywords,
// and follows a bounded number of detail URLs for application links and full JD
// text.

import { decodeEntities } from './_html-entities.mjs';
import { intInRange } from './_config-utils.mjs';
import { resolveProfileKeywords } from './_profile-keywords.mjs';

const ORIGIN = 'https://pam-stilling-feed.nav.no';
const FEED_URL = `${ORIGIN}/api/v1/feed`;
const TOKEN_URL = `${ORIGIN}/api/publicToken`;
const TRUSTED_HOST = 'pam-stilling-feed.nav.no';
const PUBLIC_PAGE_BASE = 'https://arbeidsplassen.nav.no/stillinger/stilling/';
const DEFAULT_MODIFIED_SINCE_DAYS = 30;
const DEFAULT_MAX_PAGES = 3;
const DEFAULT_DETAIL_LIMIT = 25;
const MAX_PAGES_CAP = 50;
const MAX_DETAIL_LIMIT = 100;

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanKeywords(value) {
  const arr = Array.isArray(value) ? value : [];
  return [...new Set(arr.filter(k => typeof k === 'string').map(k => k.trim()).filter(Boolean))];
}

/** @param {string} url */
function assertNavUrl(url) {
  let parsed;
  try {
    parsed = new URL(url, ORIGIN);
  } catch {
    throw new Error(`nav: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`nav: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== TRUSTED_HOST) {
    throw new Error(`nav: untrusted hostname "${parsed.hostname}" — must be ${TRUSTED_HOST}`);
  }
  return parsed.href;
}

/**
 * Reads and sanitizes the entry's `nav:` config block. Exported for tests.
 * @param {{ nav?: any, keywords?: any, max_pages?: any }} entry
 */
export function parseNavConfig(entry) {
  const cfg = entry?.nav && typeof entry.nav === 'object' ? entry.nav : {};
  const keywords =
    cleanKeywords(cfg.keywords).length ? cleanKeywords(cfg.keywords)
      : cleanKeywords(entry?.keywords).length ? cleanKeywords(entry?.keywords)
        : resolveProfileKeywords();
  return {
    keywords,
    modifiedSinceDays: intInRange(cfg.modified_since_days, DEFAULT_MODIFIED_SINCE_DAYS, 1, 183),
    maxPages: intInRange(cfg.max_pages ?? entry?.max_pages, DEFAULT_MAX_PAGES, 1, MAX_PAGES_CAP),
    detailLimit: intInRange(cfg.detail_limit, DEFAULT_DETAIL_LIMIT, 0, MAX_DETAIL_LIMIT),
    fetchDetails: cfg.fetch_details !== false,
  };
}

/** @param {string} text */
export function extractPublicToken(text) {
  const token = String(text || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => /^eyJ[A-Za-z0-9_-]+\./.test(line));
  if (!token) throw new Error('nav: public token response did not contain a JWT');
  return token;
}

function tokenHeaders(token, extra = {}) {
  return { accept: 'application/json', authorization: `Bearer ${token}`, ...extra };
}

/** @param {string} html */
function htmlToText(html) {
  if (typeof html !== 'string' || !html) return '';
  return decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** @param {unknown} value */
function toEpochMs(value) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** @param {unknown} value */
function safeExternalUrl(value) {
  const raw = cleanString(value);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' ? parsed.href : '';
  } catch {
    return '';
  }
}

/** @param {string} uuid */
function publicPageUrl(uuid) {
  return `${PUBLIC_PAGE_BASE}${encodeURIComponent(uuid)}`;
}

/**
 * @param {any} item
 * @returns {{ title: string, url: string, company: string, location: string, postedAt?: number, uuid: string, text: string } | null}
 */
export function normalizeNavFeedItem(item) {
  if (!item || typeof item !== 'object') return null;
  const feed = item._feed_entry && typeof item._feed_entry === 'object' ? item._feed_entry : {};
  if (cleanString(feed.status) !== 'ACTIVE') return null;

  const uuid = cleanString(feed.uuid) || cleanString(item.id);
  const title = cleanString(feed.title) || cleanString(item.title);
  if (!uuid || !title) return null;

  const company = cleanString(feed.businessName) || 'NAV Arbeidsplassen';
  const municipal = cleanString(feed.municipal);
  const location = municipal ? `${municipal}, Norway` : 'Norway';
  const postedAt = toEpochMs(cleanString(item.date_modified) || cleanString(feed.sistEndret));
  const text = [title, company, municipal, cleanString(item.content_text)].join(' ');

  /** @type {{ title: string, url: string, company: string, location: string, postedAt?: number, uuid: string, text: string }} */
  const job = { title, url: publicPageUrl(uuid), company, location, uuid, text };
  if (postedAt !== undefined) job.postedAt = postedAt;
  return job;
}

/**
 * @param {any} detail
 * @param {{ title: string, url: string, company: string, location: string, postedAt?: number, uuid: string }} fallback
 * @returns {{ title: string, url: string, company: string, location: string, description?: string, postedAt?: number }}
 */
export function normalizeNavDetail(detail, fallback) {
  const ad = detail?.ad_content && typeof detail.ad_content === 'object'
    ? detail.ad_content
    : detail?.json && typeof detail.json === 'object'
      ? detail.json
      : {};

  const title = cleanString(ad.title) || fallback.title;
  const company = cleanString(ad.employer?.name) || fallback.company;
  const firstLoc = Array.isArray(ad.workLocations) && ad.workLocations[0] && typeof ad.workLocations[0] === 'object'
    ? ad.workLocations[0]
    : {};
  const city = cleanString(firstLoc.city) || cleanString(firstLoc.municipal);
  const county = cleanString(firstLoc.county);
  const country = cleanString(firstLoc.country).replace(/^NORGE$/i, 'Norway');
  const location = [city, county, country || (!city && !county ? 'Norway' : '')].filter(Boolean).join(', ') || fallback.location;
  const url = safeExternalUrl(ad.applicationUrl) || safeExternalUrl(ad.sourceurl) || safeExternalUrl(ad.link) || fallback.url;
  const description = htmlToText(cleanString(ad.description));
  const postedAt = toEpochMs(ad.published) ?? fallback.postedAt;

  /** @type {{ title: string, url: string, company: string, location: string, description?: string, postedAt?: number }} */
  const job = { title, url, company, location };
  if (description) job.description = description;
  if (postedAt !== undefined) job.postedAt = postedAt;
  return job;
}

/**
 * @param {string} haystack
 * @param {string[]} keywords
 */
function matchesKeywords(haystack, keywords) {
  const lower = haystack.toLowerCase();
  return keywords.some(kw => lower.includes(kw.toLowerCase()));
}

/** @type {Provider} */
export default {
  id: 'nav',

  detect(entry) {
    return entry?.provider === 'nav' ? { url: FEED_URL } : null;
  },

  async fetch(entry, ctx) {
    const cfg = parseNavConfig(entry);
    if (!cfg.keywords.length) {
      throw new Error(`nav: entry "${entry?.name || '(unnamed)'}" has no nav.keywords[] and no profile fallback`);
    }

    const token = process.env.NAV_JOB_FEED_TOKEN || extractPublicToken(await ctx.fetchText(TOKEN_URL, { redirect: 'error' }));
    const since = new Date(Date.now() - cfg.modifiedSinceDays * 86_400_000).toUTCString();
    const maxPages = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0 ? Math.min(ctx.maxPages, cfg.maxPages) : cfg.maxPages;
    const byUrl = new Map();
    let next = FEED_URL;
    let detailCalls = 0;

    for (let page = 1; page <= maxPages && next; page++) {
      let json;
      try {
        json = /** @type {any} */ (await ctx.fetchJson(assertNavUrl(next), {
          headers: tokenHeaders(token, { 'if-modified-since': since }),
          redirect: 'error',
          timeoutMs: 15_000,
        }));
      } catch (err) {
        if (err?.status === 304) break;
        throw err;
      }

      if (!json || !Array.isArray(json.items)) {
        throw new Error(
          `nav: unexpected feed response on page ${page} — expected { items: [...] }, got keys: [${json ? Object.keys(json).join(', ') : 'null'}]`,
        );
      }

      for (const item of json.items) {
        const headerJob = normalizeNavFeedItem(item);
        if (!headerJob) continue;
        if (!matchesKeywords(headerJob.text, cfg.keywords)) continue;

        let job = headerJob;
        if (cfg.fetchDetails && !ctx?.maxPages && detailCalls < cfg.detailLimit) {
          detailCalls++;
          try {
            const detailUrl = assertNavUrl(item.url);
            const detail = await ctx.fetchJson(detailUrl, {
              headers: tokenHeaders(token),
              redirect: 'error',
              timeoutMs: 15_000,
            });
            job = normalizeNavDetail(detail, headerJob);
          } catch {
            job = headerJob;
          }
        }

        const { uuid, text, ...publicJob } = job;
        if (!byUrl.has(publicJob.url)) byUrl.set(publicJob.url, publicJob);
      }

      next = cleanString(json.next_url);
      if (json.items.length === 0) break;
    }

    return [...byUrl.values()];
  },
};
