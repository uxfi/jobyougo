// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Taiwan Jobs Open Data provider — Taiwan Employment Service public dataset.
// Dataset: https://data.gov.tw/en/datasets/44062
// API: https://apiservice.mol.gov.tw/OdService/rest/datastore/A17000000J-030144-VAL
//
// The endpoint returns a current open-data snapshot with Chinese field labels.
// The provider filters client-side by keywords and optional remote markers,
// then emits normalized job rows for scan.mjs's global filters.

import { intInRange } from './_config-utils.mjs';
import { resolveProfileKeywords } from './_profile-keywords.mjs';

const DATASTORE_URL = 'https://apiservice.mol.gov.tw/OdService/rest/datastore/A17000000J-030144-VAL';
const TRUSTED_HOST = 'apiservice.mol.gov.tw';
const TRUSTED_JOB_HOST = 'job.taiwanjobs.gov.tw';
const DEFAULT_MAX_RECORDS = 1000;
const MAX_RECORDS_CAP = 5000;
const REMOTE_MARKERS = ['remote', 'wfh', 'work from home', '遠端', '居家', '在家'];

function cleanString(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function cleanKeywords(value) {
  const arr = Array.isArray(value) ? value : [];
  return [...new Set(arr.filter(k => typeof k === 'string').map(k => k.trim()).filter(Boolean))];
}

/** @param {string} url */
function assertTaiwanApiUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`taiwanjobs: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`taiwanjobs: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== TRUSTED_HOST) {
    throw new Error(`taiwanjobs: untrusted hostname "${parsed.hostname}" — must be ${TRUSTED_HOST}`);
  }
  return parsed;
}

/**
 * @param {{ taiwanjobs?: any, keywords?: any }} entry
 * @returns {{ keywords: string[], maxRecords: number, remoteOnly: boolean }}
 */
export function parseTaiwanJobsConfig(entry) {
  const cfg = entry?.taiwanjobs && typeof entry.taiwanjobs === 'object' ? entry.taiwanjobs : {};
  const keywords =
    cleanKeywords(cfg.keywords).length ? cleanKeywords(cfg.keywords)
      : cleanKeywords(entry?.keywords).length ? cleanKeywords(entry?.keywords)
        : resolveProfileKeywords();
  return {
    keywords,
    maxRecords: intInRange(cfg.max_records, DEFAULT_MAX_RECORDS, 1, MAX_RECORDS_CAP),
    remoteOnly: cfg.remote_only === true,
  };
}

/**
 * Read a value from Taiwan's labelled open-data fields. The API keys are shaped
 * like `OCCU_DESC（職務名稱）`; prefix lookup keeps the parser stable if the human
 * label changes while the code prefix stays intact.
 * @param {any} row
 * @param {string} prefix
 */
export function taiwanField(row, prefix) {
  if (!row || typeof row !== 'object') return '';
  if (typeof row[prefix] === 'string') return cleanString(row[prefix]);
  const key = Object.keys(row).find(k => k === prefix || k.startsWith(`${prefix}（`));
  return key ? cleanString(row[key]) : '';
}

/** @param {unknown} value */
function safeTaiwanJobUrl(value) {
  const raw = cleanString(value);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' || parsed.hostname !== TRUSTED_JOB_HOST) return '';
    return parsed.href;
  } catch {
    return '';
  }
}

/** @param {unknown} value */
function parseTaiwanDate(value) {
  const raw = cleanString(value);
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return undefined;
  const parsed = Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00+08:00`);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** @param {unknown} value */
function positiveNumber(value) {
  const raw = cleanString(value);
  if (!raw || raw === '-') return null;
  const n = Number(raw.replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** @param {any} row */
export function taiwanJobsText(row) {
  return [
    taiwanField(row, 'OCCU_DESC'),
    taiwanField(row, 'CJOB_NAME2'),
    taiwanField(row, 'JOB_DETAIL'),
    taiwanField(row, 'COMPNAME'),
    taiwanField(row, 'CITYNAME'),
    taiwanField(row, 'WKTIME'),
  ].filter(Boolean).join(' ');
}

/**
 * Normalize one Taiwan Jobs record. Exported for tests.
 * @param {any} row
 * @param {string} [fallbackCompany]
 * @returns {{ title: string, url: string, company: string, location: string, description?: string, postedAt?: number, salary?: {min: number, max: number, currency: string} } | null}
 */
export function normalizeTaiwanJobsRecord(row, fallbackCompany) {
  if (!row || typeof row !== 'object') return null;
  const title = taiwanField(row, 'OCCU_DESC') || taiwanField(row, 'CJOB_NAME2');
  const url = safeTaiwanJobUrl(taiwanField(row, 'URL_QUERY'));
  if (!title || !url) return null;

  const company = taiwanField(row, 'COMPNAME') || cleanString(fallbackCompany) || 'Taiwan Jobs';
  const city = taiwanField(row, 'CITYNAME');
  const location = city ? `${city}, Taiwan` : 'Taiwan';
  const description = taiwanField(row, 'JOB_DETAIL');
  const postedAt = parseTaiwanDate(taiwanField(row, 'TRANDATE'));

  /** @type {{ title: string, url: string, company: string, location: string, description?: string, postedAt?: number, salary?: {min: number, max: number, currency: string} }} */
  const job = { title, url, company, location };
  if (description) job.description = description;
  if (postedAt !== undefined) job.postedAt = postedAt;

  const min = positiveNumber(taiwanField(row, 'NT_L'));
  const max = positiveNumber(taiwanField(row, 'NT_U'));
  if (min !== null || max !== null) {
    job.salary = {
      min: min ?? /** @type {number} */ (max),
      max: max ?? /** @type {number} */ (min),
      currency: 'TWD',
    };
  }
  return job;
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
    return needle && lower.includes(needle);
  });
}

/** @param {string} text */
function signalsRemote(text) {
  const lower = text.toLowerCase();
  return REMOTE_MARKERS.some(marker => lower.includes(marker.toLowerCase()));
}

/** @type {Provider} */
export default {
  id: 'taiwanjobs',

  detect(entry) {
    return entry?.provider === 'taiwanjobs' ? { url: DATASTORE_URL } : null;
  },

  async fetch(entry, ctx) {
    const cfg = parseTaiwanJobsConfig(entry);
    const url = assertTaiwanApiUrl(DATASTORE_URL);
    url.searchParams.set('$format', 'json');
    const json = /** @type {any} */ (await ctx.fetchJson(url.href, {
      headers: { accept: 'application/json' },
      redirect: 'error',
      timeoutMs: 20_000,
    }));

    const records = json?.result?.records;
    if (!Array.isArray(records)) {
      throw new Error(
        `taiwanjobs: unexpected API response — expected { result: { records: [...] } }, got keys: [${json ? Object.keys(json).join(', ') : 'null'}]`,
      );
    }

    const out = [];
    const seen = new Set();
    for (const row of records) {
      const text = taiwanJobsText(row);
      if (!matchesKeywords(text, cfg.keywords)) continue;
      if (cfg.remoteOnly && !signalsRemote(text)) continue;

      const job = normalizeTaiwanJobsRecord(row, entry?.name);
      if (!job || seen.has(job.url)) continue;
      seen.add(job.url);
      out.push(job);
      if (out.length >= cfg.maxRecords) break;
    }
    return out;
  },
};
