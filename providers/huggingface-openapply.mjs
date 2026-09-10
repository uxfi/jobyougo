// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Hugging Face Open Apply Jobs provider — bounded reader for the public
// edwarddgao/open-apply-jobs dataset through Hugging Face's datasets-server.
//
// This is a discovery meta-source, not a primary ATS: rows point at original
// Ashby/Greenhouse/Lever/Workable-style apply URLs. The dataset is large, so the
// provider intentionally fetches only a configured number of row pages and then
// filters locally by keywords and remote/location signals.

import { decodeEntities } from './_html-entities.mjs';
import { intInRange } from './_config-utils.mjs';
import { resolveProfileKeywords } from './_profile-keywords.mjs';
import { fetchJsonWithRetry } from './_http.mjs';

const ROWS_URL = 'https://datasets-server.huggingface.co/rows';
const TRUSTED_HOST = 'datasets-server.huggingface.co';
const DATASET = 'edwarddgao/open-apply-jobs';
const CONFIG = 'default';
const SPLIT = 'train';
const DEFAULT_LENGTH = 100;
const DEFAULT_MAX_PAGES = 3;
const MAX_LENGTH = 100;
const MAX_PAGES_CAP = 20;
const REMOTE_MARKERS = ['remote', 'work from anywhere', 'work from home', 'distributed', 'emea', 'europe', 'apac', 'asia'];

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanKeywords(value) {
  const arr = Array.isArray(value) ? value : [];
  return [...new Set(arr.filter(k => typeof k === 'string').map(k => k.trim()).filter(Boolean))];
}

/** @param {string} url */
function assertHfUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`huggingface-openapply: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`huggingface-openapply: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== TRUSTED_HOST) {
    throw new Error(`huggingface-openapply: untrusted hostname "${parsed.hostname}" — must be ${TRUSTED_HOST}`);
  }
  return parsed;
}

/**
 * @param {{ huggingface_openapply?: any, keywords?: any, max_pages?: any }} entry
 */
export function parseOpenApplyConfig(entry) {
  const cfg = entry?.huggingface_openapply && typeof entry.huggingface_openapply === 'object'
    ? entry.huggingface_openapply
    : {};
  const keywords =
    cleanKeywords(cfg.keywords).length ? cleanKeywords(cfg.keywords)
      : cleanKeywords(entry?.keywords).length ? cleanKeywords(entry?.keywords)
        : resolveProfileKeywords();
  return {
    keywords,
    remoteOnly: cfg.remote_only !== false,
    matchDescription: cfg.match_description === true,
    length: intInRange(cfg.length, DEFAULT_LENGTH, 1, MAX_LENGTH),
    maxPages: intInRange(cfg.max_pages ?? entry?.max_pages, DEFAULT_MAX_PAGES, 1, MAX_PAGES_CAP),
  };
}

/** @param {{ offset: number, length: number }} params */
export function buildOpenApplyRowsUrl(params) {
  const url = assertHfUrl(ROWS_URL);
  url.searchParams.set('dataset', DATASET);
  url.searchParams.set('config', CONFIG);
  url.searchParams.set('split', SPLIT);
  url.searchParams.set('offset', String(params.offset));
  url.searchParams.set('length', String(params.length));
  return url.href;
}

/** @param {string} html */
export function stripOpenApplyHtml(html) {
  if (typeof html !== 'string' || !html) return '';
  const noMedia = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  return decodeEntities(noMedia.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** @param {unknown} value */
function safeApplyUrl(value) {
  const raw = cleanString(value);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' ? parsed.href : '';
  } catch {
    return '';
  }
}

/** @param {unknown} value */
function toEpochMs(value) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** @param {unknown} value */
function locationsText(value) {
  return Array.isArray(value)
    ? value.filter(v => typeof v === 'string' && v.trim()).map(v => v.trim()).join(', ')
    : '';
}

/** @param {unknown} value */
function sourceSlugToCompany(value) {
  const slug = cleanString(value);
  if (!slug) return '';
  return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/** @param {any} row @param {boolean} includeDescription */
function searchText(row, includeDescription = false) {
  return [
    cleanString(row?.title),
    cleanString(row?.source_slug),
    cleanString(row?.department),
    locationsText(row?.locations),
    includeDescription ? stripOpenApplyHtml(cleanString(row?.description_html)) : '',
  ].filter(Boolean).join(' ');
}

/**
 * @param {string} text
 * @param {string[]} keywords
 */
function matchesKeywords(text, keywords) {
  if (!keywords.length) return true;
  const lower = text.toLowerCase();
  return keywords.some((kw) => {
    const needle = kw.toLowerCase().trim();
    if (/^[a-z]{2,3}$/.test(needle)) {
      const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`\\b${escaped}\\b`).test(lower);
    }
    return lower.includes(needle);
  });
}

/** @param {any} row */
function signalsRemote(row) {
  if (row?.remote === true) return true;
  const text = [locationsText(row?.locations), stripOpenApplyHtml(cleanString(row?.description_html))].join(' ').toLowerCase();
  return REMOTE_MARKERS.some(marker => text.includes(marker));
}

/** @param {any} row */
function normalizeSalary(row) {
  const min = Number(row?.salary_min);
  const max = Number(row?.salary_max);
  const hasMin = Number.isFinite(min) && min > 0;
  const hasMax = Number.isFinite(max) && max > 0;
  if (!hasMin && !hasMax) return null;
  return {
    min: hasMin ? min : max,
    max: hasMax ? max : min,
    currency: cleanString(row?.salary_currency).toUpperCase(),
  };
}

/**
 * Normalize one Hugging Face dataset row. Exported for tests.
 * @param {any} row
 * @returns {{ title: string, url: string, company: string, location: string, description?: string, postedAt?: number, salary?: {min: number, max: number, currency: string} } | null}
 */
export function normalizeOpenApplyRow(row) {
  if (!row || typeof row !== 'object') return null;
  const title = cleanString(row.title);
  const url = safeApplyUrl(row.apply_url);
  if (!title || !url) return null;

  const company = sourceSlugToCompany(row.source_slug) || 'Open Apply Jobs';
  const location = locationsText(row.locations) || (row.remote === true ? 'Remote' : '');
  const description = stripOpenApplyHtml(cleanString(row.description_html));
  const postedAt = toEpochMs(row.posted_at);

  /** @type {{ title: string, url: string, company: string, location: string, description?: string, postedAt?: number, salary?: {min: number, max: number, currency: string} }} */
  const job = { title, url, company, location };
  if (description) job.description = description;
  if (postedAt !== undefined) job.postedAt = postedAt;
  const salary = normalizeSalary(row);
  if (salary) job.salary = salary;
  return job;
}

/** @type {Provider} */
export default {
  id: 'huggingface-openapply',

  detect(entry) {
    return entry?.provider === 'huggingface-openapply' ? { url: buildOpenApplyRowsUrl({ offset: 0, length: DEFAULT_LENGTH }) } : null;
  },

  async fetch(entry, ctx) {
    const cfg = parseOpenApplyConfig(entry);
    if (!cfg.keywords.length) {
      throw new Error(`huggingface-openapply: entry "${entry?.name || '(unnamed)'}" has no huggingface_openapply.keywords[] and no profile fallback`);
    }

    const out = [];
    const seen = new Set();
    const pageCap = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0 ? Math.min(ctx.maxPages, cfg.maxPages) : cfg.maxPages;

    for (let page = 0; page < pageCap; page++) {
      const url = buildOpenApplyRowsUrl({ offset: page * cfg.length, length: cfg.length });
      let json;
      try {
        json = /** @type {any} */ (await fetchJsonWithRetry(ctx, url, {
          headers: { accept: 'application/json' },
          redirect: 'error',
          timeoutMs: 20_000,
        }, { retries: 1, baseDelayMs: 500, maxDelayMs: 2_000 }));
      } catch (err) {
        if (page === 0) throw err;
        const message = err && typeof err === 'object' && 'message' in err ? err.message : String(err);
        console.error(`huggingface-openapply: page ${page + 1} failed — keeping ${out.length} jobs gathered so far: ${message}`);
        break;
      }
      if (!json || !Array.isArray(json.rows)) {
        throw new Error(
          `huggingface-openapply: unexpected rows response on page ${page + 1} — expected { rows: [...] }, got keys: [${json ? Object.keys(json).join(', ') : 'null'}]`,
        );
      }
      for (const wrapped of json.rows) {
        const row = wrapped?.row && typeof wrapped.row === 'object' ? wrapped.row : wrapped;
        const text = searchText(row, cfg.matchDescription);
        if (!matchesKeywords(text, cfg.keywords)) continue;
        if (cfg.remoteOnly && !signalsRemote(row)) continue;

        const job = normalizeOpenApplyRow(row);
        if (!job || seen.has(job.url)) continue;
        seen.add(job.url);
        out.push(job);
      }
      if (json.rows.length < cfg.length) break;
    }

    return out;
  },
};
