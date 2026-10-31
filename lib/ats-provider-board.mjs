// Long-tail ATS boards read through the scanner's own providers/ layer.
//
// The explorer and the board resolver verify Greenhouse, Ashby, Lever, Workable,
// SmartRecruiters, Recruitee, Personio and Teamtailor with direct JSON/XML calls
// (lib/ats-explorer.mjs). The vendors below have no such shortcut, but a
// providers/*.mjs already reads each of them, so a board is verified by asking
// that provider for its postings: the same code the scan will run later, and the
// same URL shapes discover-ats.mjs probes (it builds its careers_url from here).
//
// Workday is the odd one: three coordinates (tenant, instance, site), none of
// which a company name gives. They only come from a link on the company's own
// careers page, written here as the slug "tenant:wdN:Site" (site is case-sensitive).

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProviders } from '../providers/_registry.mjs';
import { makeHttpCtx } from '../providers/_http.mjs';

const PROVIDERS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'providers');

const lower = (s) => String(s).toLowerCase();

/** careers_url per long-tail vendor; the host is built from a lowercase slug where the vendor uses subdomains. */
export const PROVIDER_BOARD_URLS = {
  bamboohr: (s) => `https://${lower(s)}.bamboohr.com`,
  breezy: (s) => `https://${lower(s)}.breezy.hr`,
  pinpoint: (s) => `https://${lower(s)}.pinpointhq.com`,
  rippling: (s) => `https://ats.rippling.com/${s}/jobs`,
  join: (s) => `https://join.com/companies/${s}`,
};

export const PROVIDER_BOARD_ATS = [...Object.keys(PROVIDER_BOARD_URLS), 'workday'];

const WD_SEGMENT = /^[A-Za-z0-9_-]+$/;
const WORKDAY_RE = /https?:\/\/([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}(?:-[A-Za-z]{2})?\/)?([A-Za-z0-9_-]+)/gi;
const WORKDAY_LOCALE = /^[a-z]{2}(?:-[A-Za-z]{2})?$/;

/** Workday boards linked in a text: [{ ats: 'workday', slug: 'tenant:wd5:Site' }]. */
export function extractWorkdayBoards(input) {
  const out = new Map();
  for (const t of Array.isArray(input) ? input : [input]) {
    if (typeof t !== 'string' || !t) continue;
    let text = t;
    try { text = decodeURIComponent(t); } catch { /* keep raw */ }
    WORKDAY_RE.lastIndex = 0;
    let m;
    while ((m = WORKDAY_RE.exec(text))) {
      const [, tenant, instance, site] = m;
      if (WORKDAY_LOCALE.test(site) || /^(?:wday|cxs|login|job|jobs)$/i.test(site)) continue;
      const slug = `${tenant.toLowerCase()}:${instance.toLowerCase()}:${site}`;
      if (!out.has(slug)) out.set(slug, { ats: 'workday', slug });
    }
  }
  return [...out.values()];
}

// Comeet: the positions API needs a company uid and a per-tenant token, neither
// in a job URL. The branded careers page (www.comeet.com/jobs/<name>/<uid>)
// ships both in its own page JSON for every visitor, so a board is "name:uid"
// and the token is read from that page when the board is verified.
// Both parts are case-sensitive ("B6.00F"), hence no lowercasing here.
const COMEET_RE = /https?:\/\/(?:www\.)?comeet\.com\/jobs\/([A-Za-z0-9._-]{2,80})\/([A-Za-z0-9.]{3,20})(?=[/?#"'\s<)]|$)/gi;
const COMEET_API_RE = /comeet\.co\/careers-api\/2\.0\/company\/([A-Za-z0-9.]{3,20})\/positions/gi;
const COMEET_PART = /^[A-Za-z0-9._-]+$/;

/** Comeet boards linked in a text: [{ ats: 'comeet', slug: 'name:uid' }]. */
export function extractComeetBoards(input) {
  const out = new Map();
  for (const t of Array.isArray(input) ? input : [input]) {
    if (typeof t !== 'string' || !t) continue;
    COMEET_RE.lastIndex = 0;
    let m;
    while ((m = COMEET_RE.exec(t))) {
      const slug = `${m[1]}:${m[2]}`;
      if (!out.has(slug)) out.set(slug, { ats: 'comeet', slug });
    }
  }
  return [...out.values()];
}

/** Company uids named by a Comeet positions API URL (how a tracked entry may already point at a board). */
export function extractComeetApiUids(input) {
  const out = new Set();
  for (const t of Array.isArray(input) ? input : [input]) {
    if (typeof t !== 'string' || !t) continue;
    COMEET_API_RE.lastIndex = 0;
    let m;
    while ((m = COMEET_API_RE.exec(t))) out.add(m[1]);
  }
  return [...out];
}

/** The uid of a Comeet board slug ("name:uid"), '' for anything else. */
export const comeetUid = (slug) => String(slug || '').split(':')[1] || '';

/** { careers_url, provider? } of a long-tail board, or null for a slug the vendor cannot hold. */
export function providerBoardEndpoints(ats, slug) {
  if (ats === 'comeet') {
    const [name, uid, extra] = String(slug).split(':');
    if (extra !== undefined || ![name, uid].every((p) => p && COMEET_PART.test(p))) return null;
    return { careers_url: `https://www.comeet.com/jobs/${name}/${uid}`, provider: 'comeet' };
  }
  if (ats === 'workday') {
    const [tenant, instance, site] = String(slug).split(':');
    if (![tenant, instance, site].every((p) => p && WD_SEGMENT.test(p)) || !/^wd\d+$/.test(instance)) return null;
    return { careers_url: `https://${tenant}.${instance}.myworkdayjobs.com/${site}`, provider: 'workday' };
  }
  const build = PROVIDER_BOARD_URLS[ats];
  if (!build || !/^[A-Za-z0-9._-]+$/.test(String(slug))) return null;
  return { careers_url: build(slug) };
}

const jsonString = (raw) => { try { return JSON.parse(`"${raw}"`); } catch { return raw; } };

/**
 * Verify a Comeet board: read the token and company uid from the branded
 * careers page (the uid must match the one asked for, so a redirect to another
 * tenant never counts), then ask the positions API. Same result shape as
 * verifyBoard, plus `api`: the positions URL the portals.yml entry needs.
 */
export async function verifyComeetBoard({ slug }, { fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
  const none = (status = 0) => ({ status, titles: [], locations: [], name: null, sample: '' });
  const ep = providerBoardEndpoints('comeet', slug);
  if (!ep) return none();
  const uid = comeetUid(slug);
  const get = async (url) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetchImpl(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': 'jobyougo-ats-explorer/1.0', Accept: 'application/json, text/html, */*' } });
      return { status: r.status, text: r.status === 200 ? await r.text() : '' };
    } catch { return { status: 0, text: '' }; } finally { clearTimeout(timer); }
  };
  const page = await get(ep.careers_url);
  if (page.status !== 200) return none(page.status);
  const token = (page.text.match(/"token"\s*:\s*"([A-Fa-f0-9]{16,64})"/) || [])[1];
  const pageUid = (page.text.match(/"company_uid"\s*:\s*"([^"]+)"/) || [])[1];
  if (!token || pageUid !== uid) return none();
  const rawName = (page.text.match(/"company_name"\s*:\s*"((?:[^"\\]|\\.)*)"/) || [])[1];
  const api = `https://www.comeet.co/careers-api/2.0/company/${encodeURIComponent(uid)}/positions?token=${token}`;
  const res = await get(api);
  if (res.status !== 200) return none(res.status);
  let positions;
  try { positions = JSON.parse(res.text); } catch { return { ...none(200), parseError: true }; }
  const list = (Array.isArray(positions) ? positions : []).filter((p) => typeof p?.name === 'string' && p.name.trim());
  return {
    status: 200,
    titles: list.map((p) => p.name.trim()),
    locations: list.map((p) => [p.location?.name, p.location?.is_remote ? 'remote' : ''].filter((x) => typeof x === 'string' && x.trim()).join(', ')),
    name: rawName ? jsonString(rawName).trim() || null : null,
    sample: '',
    api,
  };
}

let providersPromise = null;
function sharedProviders() {
  providersPromise ||= loadProviders(PROVIDERS_DIR);
  return providersPromise;
}

const textOf = (job) => [job?.title, job?.description].filter((x) => typeof x === 'string').join(' ');

/**
 * Ask the vendor's provider for a board's postings. Same result shape as
 * verifyBoard: { status, titles, locations, name, sample }. status 200 means
 * the provider answered (possibly with no job); 0 means it could not.
 */
export async function verifyBoardViaProvider({ ats, slug }, { providers = null, ctx = null } = {}) {
  const ep = providerBoardEndpoints(ats, slug);
  if (!ep) return { status: 0, titles: [], locations: [], name: null, sample: '' };
  const registry = providers || await sharedProviders();
  const provider = registry.get?.(ats);
  const entry = { name: String(slug), careers_url: ep.careers_url };
  if (!provider || provider.detect?.(entry) === false || provider.detect?.(entry) == null) {
    return { status: 0, titles: [], locations: [], name: null, sample: '' };
  }
  try {
    const jobs = await provider.fetch(entry, { ...(ctx || makeHttpCtx()), maxPages: 1 });
    const list = Array.isArray(jobs) ? jobs.filter((j) => typeof j?.title === 'string' && j.title.trim()) : [];
    return {
      status: 200,
      titles: list.map((j) => j.title.trim()),
      locations: list.map((j) => (typeof j.location === 'string' ? j.location.trim() : '')),
      name: null,
      sample: list.slice(0, 3).map(textOf).join(' ').slice(0, 20000),
    };
  } catch (err) {
    const status = Number(err?.status);
    return { status: Number.isInteger(status) && status >= 400 ? status : 0, titles: [], locations: [], name: null, sample: '' };
  }
}
