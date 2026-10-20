// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// d.vinci provider (→ tracked_companies:) — public, no-auth per-tenant feed:
//   GET https://<customer>.dvinci-hr.com/jobPublication/list.json
// One call returns every published posting as a JSON array of
//   { id, position, jobPublicationURL, jobOpening: { locations: [{ name }],
//     location, createdDate, ... }, ... }
// Reference monitor: colophon-group/jobseek apps/crawler/src/core/monitors/dvinci.py.
// Verified live 2026-10-20 (psi-hr, cenit tenants).
import { fetchJsonWithRetry } from './_http.mjs';

const DVINCI_HOST_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.dvinci-hr\.com$/;
const RESERVED = new Set(['www', 'static', 'api', 'cdn']);

/** @param {any} entry */
export function resolveDvinciApiUrl(entry) {
  for (const raw of [entry?.api, entry?.careers_url]) {
    if (typeof raw !== 'string' || !raw) continue;
    let u;
    try { u = new URL(raw); } catch { continue; }
    if (u.protocol !== 'https:') continue;
    const host = u.hostname.toLowerCase();
    if (!DVINCI_HOST_RE.test(host) || RESERVED.has(host.split('.')[0])) continue;
    return `https://${host}/jobPublication/list.json`;
  }
  return null;
}

function toEpochMs(value) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Parse the list.json array. Exported for unit tests.
 * @param {any} json
 * @param {string} companyName
 */
export function parseDvinciResponse(json, companyName) {
  if (!Array.isArray(json)) {
    const got = json && typeof json === 'object' ? Object.keys(json).join(', ') : typeof json;
    throw new Error(`dvinci: unexpected response — expected an array of job publications, got: [${got}]`);
  }
  const jobs = [];
  for (const j of json) {
    const title = typeof j?.position === 'string' ? j.position.trim() : '';
    if (!title) continue;
    let url = '';
    try {
      const u = new URL(typeof j.jobPublicationURL === 'string' ? j.jobPublicationURL.trim() : '');
      if (u.protocol === 'https:') url = u.href;
    } catch { /* dropped */ }
    if (!url) continue;
    const opening = j.jobOpening && typeof j.jobOpening === 'object' ? j.jobOpening : {};
    const names = Array.isArray(opening.locations)
      ? [...new Set(opening.locations.map(l => (typeof l?.name === 'string' ? l.name.trim() : '')).filter(Boolean))]
      : [];
    const location = names.join(' / ') || (typeof opening.location === 'string' ? opening.location.trim() : '');
    const job = { title, url, company: companyName, location };
    const postedAt = toEpochMs(opening.createdDate);
    if (postedAt !== undefined) job.postedAt = postedAt;
    jobs.push(job);
  }
  return jobs;
}

/** @type {Provider} */
export default {
  id: 'dvinci',

  detect(entry) {
    const url = resolveDvinciApiUrl(entry);
    return url ? { url } : null;
  },

  async fetch(entry, ctx) {
    const apiUrl = resolveDvinciApiUrl(entry);
    if (!apiUrl) throw new Error(`dvinci: cannot derive API URL for ${entry?.name} — careers_url must be https://<customer>.dvinci-hr.com`);
    const json = await fetchJsonWithRetry(ctx, apiUrl, { redirect: 'error' });
    return parseDvinciResponse(json, entry?.name || '');
  },
};
