// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Traffit provider (→ tracked_companies:) — public, no-auth per-tenant feed:
//   GET https://<slug>.traffit.com/public/job_posts/published
// Pagination is driven by REQUEST headers (X-Request-Page-Size,
// X-Request-Current-Page); the response carries x-result-total-pages /
// x-result-total-count. Body: a JSON array of
//   { url, id, advert: { name, values: [{ field_id, value }] }, valid_start,
//     awarded, options: { job_location, remote, ... } }
// `awarded: true` postings (filled positions) are skipped.
// Docs: https://api.traffit.com/ ; reference monitor: colophon-group/jobseek
// apps/crawler/src/core/monitors/traffit.py. Verified live 2026-10-20.
import { fetchResponseWithRetry, sleep } from './_http.mjs';

const TRAFFIT_HOST_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.traffit\.com$/;
const RESERVED = new Set(['www', 'api', 'cdn', 'cdn3', 'app', 'help', 'knowledge']);
const PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 20;
const MAX_PAGES_CAP = 200;
const INTER_PAGE_DELAY_MS = 200;

/** @param {any} entry */
export function resolveTraffitApiUrl(entry) {
  for (const raw of [entry?.api, entry?.careers_url]) {
    if (typeof raw !== 'string' || !raw) continue;
    let u;
    try { u = new URL(raw); } catch { continue; }
    if (u.protocol !== 'https:') continue;
    const host = u.hostname.toLowerCase();
    if (!TRAFFIT_HOST_RE.test(host) || RESERVED.has(host.split('.')[0])) continue;
    return `https://${host}/public/job_posts/published`;
  }
  return null;
}

function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

function valueOf(values, id) {
  if (!Array.isArray(values)) return undefined;
  const hit = values.find(v => v && v.field_id === id);
  return hit ? hit.value : undefined;
}

function parseGeo(raw) {
  if (typeof raw !== 'string' || !raw) return '';
  try {
    const g = JSON.parse(raw);
    const locality = typeof g?.locality === 'string' ? g.locality.trim() : '';
    const country = typeof g?.country === 'string' ? g.country.trim() : '';
    return [locality, country].filter(Boolean).join(', ');
  } catch { return ''; }
}

function toEpochMs(value) {
  if (typeof value !== 'string' || !value) return undefined;
  const m = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!m) return undefined;
  const parsed = Date.parse(`${m[1]}T00:00:00Z`);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Parse one page (JSON array). Exported for unit tests.
 * @param {any} json
 * @param {string} companyName
 */
export function parseTraffitPage(json, companyName) {
  if (!Array.isArray(json)) {
    const got = json && typeof json === 'object' ? Object.keys(json).join(', ') : typeof json;
    throw new Error(`traffit: unexpected response — expected an array of job posts, got: [${got}]`);
  }
  const jobs = [];
  for (const row of json) {
    if (!row || typeof row !== 'object' || row.awarded === true) continue;
    const title = typeof row.advert?.name === 'string' ? row.advert.name.trim() : '';
    if (!title) continue;
    let url = '';
    try {
      const u = new URL(typeof row.url === 'string' ? row.url.trim() : '');
      if (u.protocol === 'https:') url = u.href;
    } catch { /* dropped below */ }
    if (!url) continue;
    let location = parseGeo(valueOf(row.advert?.values, 'geolocation')) || parseGeo(row.options?.job_location);
    if (String(row.options?.remote) === '1') location = location ? `${location} (Remote)` : 'Remote';
    const job = { title, url, company: companyName, location };
    const postedAt = toEpochMs(row.valid_start);
    if (postedAt !== undefined) job.postedAt = postedAt;
    jobs.push(job);
  }
  return jobs;
}

/** @type {Provider} */
export default {
  id: 'traffit',

  detect(entry) {
    const url = resolveTraffitApiUrl(entry);
    return url ? { url } : null;
  },

  async fetch(entry, ctx) {
    const apiUrl = resolveTraffitApiUrl(entry);
    if (!apiUrl) throw new Error(`traffit: cannot derive API URL for ${entry?.name} — careers_url must be https://<slug>.traffit.com`);
    const ctxMaxPages = Number(ctx?.maxPages);
    const pagesToFetch = Math.min(resolveMaxPages(entry), ctxMaxPages > 0 ? ctxMaxPages : Infinity);
    const out = [];
    let stopReason = 'complete';
    for (let page = 1; page <= pagesToFetch; page++) {
      if (page > 1) await sleep(INTER_PAGE_DELAY_MS, ctx);
      const res = await fetchResponseWithRetry(ctx, apiUrl, {
        redirect: 'error',
        headers: { Accept: 'application/json', 'X-Request-Page-Size': String(PAGE_SIZE), 'X-Request-Current-Page': String(page) },
      });
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); } catch { throw new Error('traffit: response is not JSON'); }
      out.push(...parseTraffitPage(json, entry?.name || ''));
      const totalPages = Number.parseInt(res.headers?.get?.('x-result-total-pages') ?? '', 10);
      if (json.length < PAGE_SIZE) break;
      if (Number.isFinite(totalPages) && page >= totalPages) break;
      if (!Number.isFinite(totalPages)) break; // no pagination headers → single page
      if (page === pagesToFetch && !(ctxMaxPages > 0)) stopReason = 'cap';
    }
    if (stopReason === 'cap') console.warn(`[traffit] ${entry?.name}: stopped at ${pagesToFetch} pages — raise max_pages on this entry`);
    return out;
  },
};
