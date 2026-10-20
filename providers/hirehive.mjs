// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// HireHive provider (→ tracked_companies:) — public, no-auth tenant Jobs API:
//   GET https://<tenant>.hirehive.com/api/v2/jobs?page=N&page_size=100
// Response: { meta: { page, page_size, total_items, total_pages, has_next_page },
//   items: [ { id, title, location, state_code, country: { name, code },
//   published_date, hosted_url, ... } ] }
// Reference monitor: colophon-group/jobseek apps/crawler/src/core/monitors/hirehive.py.
// Verified live 2026-10-20 (redo, teamwork-com, amcsgroup tenants).
import { fetchJsonWithRetry, sleep } from './_http.mjs';

const HIREHIVE_HOST_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.hirehive\.com$/;
const RESERVED = new Set(['www', 'api', 'app', 'help', 'support', 'blog', 'status', 'docs', 'cdn']);
const PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 20;
const MAX_PAGES_CAP = 200;
const INTER_PAGE_DELAY_MS = 200;

/** @param {any} entry */
export function resolveHireHiveOrigin(entry) {
  for (const raw of [entry?.api, entry?.careers_url]) {
    if (typeof raw !== 'string' || !raw) continue;
    let u;
    try { u = new URL(raw); } catch { continue; }
    if (u.protocol !== 'https:') continue;
    const host = u.hostname.toLowerCase();
    if (!HIREHIVE_HOST_RE.test(host) || RESERVED.has(host.split('.')[0])) continue;
    return `https://${host}`;
  }
  return null;
}

function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

function toEpochMs(value) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Parse one API page. Exported for unit tests.
 * @param {any} json
 * @param {string} companyName
 */
export function parseHireHivePage(json, companyName) {
  const items = json && Array.isArray(json.items) ? json.items : null;
  if (!items) {
    const got = json && typeof json === 'object' ? Object.keys(json).join(', ') : typeof json;
    throw new Error(`hirehive: unexpected response — expected items[], got: [${got}]`);
  }
  const jobs = [];
  for (const j of items) {
    const title = typeof j?.title === 'string' ? j.title.trim() : '';
    if (!title) continue;
    let url = '';
    try {
      const u = new URL(typeof j.hosted_url === 'string' ? j.hosted_url.trim() : '');
      if (u.protocol === 'https:') url = u.href;
    } catch { /* dropped */ }
    if (!url) continue;
    const city = typeof j.location === 'string' ? j.location.trim() : '';
    const state = typeof j.state_code === 'string' ? j.state_code.trim() : '';
    const country = typeof j.country?.name === 'string' ? j.country.name.trim() : '';
    const job = { title, url, company: companyName, location: [city, state, country].filter(Boolean).join(', ') };
    const postedAt = toEpochMs(j.published_date);
    if (postedAt !== undefined) job.postedAt = postedAt;
    jobs.push(job);
  }
  return { jobs, rawCount: items.length, hasNext: json.meta?.has_next_page === true };
}

/** @type {Provider} */
export default {
  id: 'hirehive',

  detect(entry) {
    const origin = resolveHireHiveOrigin(entry);
    return origin ? { url: `${origin}/api/v2/jobs` } : null;
  },

  async fetch(entry, ctx) {
    const origin = resolveHireHiveOrigin(entry);
    if (!origin) throw new Error(`hirehive: cannot derive API URL for ${entry?.name} — careers_url must be https://<tenant>.hirehive.com`);
    const ctxMaxPages = Number(ctx?.maxPages);
    const pagesToFetch = Math.min(resolveMaxPages(entry), ctxMaxPages > 0 ? ctxMaxPages : Infinity);
    const out = [];
    for (let page = 1; page <= pagesToFetch; page++) {
      if (page > 1) await sleep(INTER_PAGE_DELAY_MS, ctx);
      const json = await fetchJsonWithRetry(ctx, `${origin}/api/v2/jobs?page=${page}&page_size=${PAGE_SIZE}`, { redirect: 'error' });
      const { jobs, rawCount, hasNext } = parseHireHivePage(json, entry?.name || '');
      out.push(...jobs);
      if (!hasNext || rawCount < PAGE_SIZE) break;
      if (page === pagesToFetch && !(ctxMaxPages > 0)) console.warn(`[hirehive] ${entry?.name}: stopped at ${pagesToFetch} pages — raise max_pages on this entry`);
    }
    return out;
  },
};
