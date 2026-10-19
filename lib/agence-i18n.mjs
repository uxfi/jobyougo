/**
 * /agence languages (v2 studio). 2026-10-18.
 *
 * EN and FR are written by hand (ui/portfolio/agence-i18n.js and the {en, fr} pairs in the other agence files).
 * Every other language is a machine translation of the English copy, made ahead of time by
 * scripts/agence-translate.mjs and stored in ui/portfolio/i18n/<code>.json as { k: { <key>: text } },
 * where <key> = i18nKey(English string).
 *
 * There is no language switch on the page. The server picks the language per request:
 *   1. ?lang=<code> (also remembered in a cookie; ?lang=auto forgets it),
 *   2. the v2studio-lang cookie,
 *   3. the browser's Accept-Language, in order of preference (regional variants and base languages match),
 *   4. the visitor's country (Vercel's x-vercel-ip-country header), when no browser language is available,
 *   5. English.
 * It then writes <html lang> and injects window.AG_I18N (code, base copy, Intl locale, and the catalogue for
 * machine languages) in place of <!--agence-i18n--> in the page shells, so the page renders in one pass.
 */
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

/** Hand-written languages, then the machine-translated ones (English name for prompts, Intl locale, direction). */
export const AGENCE_LANGS = [
  { code: 'en', name: 'English', intl: 'en-US' },
  { code: 'fr', name: 'French', intl: 'fr-FR' },
  { code: 'es', name: 'Spanish', intl: 'es-ES' },
  { code: 'de', name: 'German', intl: 'de-DE' },
  { code: 'it', name: 'Italian', intl: 'it-IT' },
  { code: 'pt-BR', name: 'Brazilian Portuguese', intl: 'pt-BR' },
  { code: 'pt-PT', name: 'European Portuguese', intl: 'pt-PT' },
  { code: 'nl', name: 'Dutch', intl: 'nl-NL' },
  { code: 'pl', name: 'Polish', intl: 'pl-PL' },
  { code: 'sv', name: 'Swedish', intl: 'sv-SE' },
  { code: 'da', name: 'Danish', intl: 'da-DK' },
  { code: 'nb', name: 'Norwegian Bokmål', intl: 'nb-NO' },
  { code: 'fi', name: 'Finnish', intl: 'fi-FI' },
  { code: 'cs', name: 'Czech', intl: 'cs-CZ' },
  { code: 'sk', name: 'Slovak', intl: 'sk-SK' },
  { code: 'ro', name: 'Romanian', intl: 'ro-RO' },
  { code: 'hu', name: 'Hungarian', intl: 'hu-HU' },
  { code: 'el', name: 'Greek', intl: 'el-GR' },
  { code: 'bg', name: 'Bulgarian', intl: 'bg-BG' },
  { code: 'hr', name: 'Croatian', intl: 'hr-HR' },
  { code: 'sl', name: 'Slovenian', intl: 'sl-SI' },
  { code: 'lt', name: 'Lithuanian', intl: 'lt-LT' },
  { code: 'lv', name: 'Latvian', intl: 'lv-LV' },
  { code: 'et', name: 'Estonian', intl: 'et-EE' },
  { code: 'uk', name: 'Ukrainian', intl: 'uk-UA' },
  { code: 'ru', name: 'Russian', intl: 'ru-RU' },
  { code: 'tr', name: 'Turkish', intl: 'tr-TR' },
  { code: 'ar', name: 'Arabic', intl: 'ar', rtl: true },
  { code: 'he', name: 'Hebrew', intl: 'he-IL', rtl: true },
  { code: 'fa', name: 'Persian', intl: 'fa-IR', rtl: true },
  { code: 'hi', name: 'Hindi', intl: 'hi-IN' },
  { code: 'bn', name: 'Bengali', intl: 'bn-BD' },
  { code: 'id', name: 'Indonesian', intl: 'id-ID' },
  { code: 'ms', name: 'Malay', intl: 'ms-MY' },
  { code: 'th', name: 'Thai', intl: 'th-TH' },
  { code: 'vi', name: 'Vietnamese', intl: 'vi-VN' },
  { code: 'ja', name: 'Japanese', intl: 'ja-JP' },
  { code: 'ko', name: 'Korean', intl: 'ko-KR' },
  { code: 'zh-Hans', name: 'Simplified Chinese', intl: 'zh-CN' },
  { code: 'zh-Hant', name: 'Traditional Chinese', intl: 'zh-TW' },
  { code: 'ca', name: 'Catalan', intl: 'ca-ES' },
];
export const HAND_LANGS = ['en', 'fr'];
export const MACHINE_LANGS = AGENCE_LANGS.filter((l) => !HAND_LANGS.includes(l.code)).map((l) => l.code);
const BY_CODE = new Map(AGENCE_LANGS.map((l) => [l.code.toLowerCase(), l]));
export const AGENCE_LANG_COOKIE = 'v2studio-lang';

/** Language of the country, used only when no browser language matches. */
const COUNTRY_LANG = {
  FR: 'fr', MC: 'fr', LU: 'fr', BE: 'fr', SN: 'fr', CI: 'fr', CM: 'fr', ML: 'fr', BF: 'fr', NE: 'fr', TG: 'fr', BJ: 'fr', GA: 'fr', CG: 'fr', CD: 'fr', MG: 'fr', HT: 'fr', RE: 'fr', GP: 'fr', MQ: 'fr', GF: 'fr', NC: 'fr', PF: 'fr',
  DE: 'de', AT: 'de', CH: 'de', LI: 'de',
  ES: 'es', MX: 'es', AR: 'es', CO: 'es', CL: 'es', PE: 'es', VE: 'es', EC: 'es', GT: 'es', CU: 'es', BO: 'es', DO: 'es', HN: 'es', PY: 'es', SV: 'es', NI: 'es', CR: 'es', PA: 'es', UY: 'es', PR: 'es',
  IT: 'it', SM: 'it', VA: 'it',
  BR: 'pt-BR', PT: 'pt-PT', AO: 'pt-PT', MZ: 'pt-PT', CV: 'pt-PT',
  NL: 'nl', SR: 'nl', PL: 'pl', SE: 'sv', DK: 'da', NO: 'nb', FI: 'fi', CZ: 'cs', SK: 'sk', RO: 'ro', MD: 'ro', HU: 'hu',
  GR: 'el', CY: 'el', BG: 'bg', HR: 'hr', SI: 'sl', LT: 'lt', LV: 'lv', EE: 'et', UA: 'uk',
  RU: 'ru', BY: 'ru', KZ: 'ru', KG: 'ru', TR: 'tr',
  SA: 'ar', AE: 'ar', EG: 'ar', MA: 'ar', DZ: 'ar', TN: 'ar', IQ: 'ar', JO: 'ar', LB: 'ar', KW: 'ar', QA: 'ar', BH: 'ar', OM: 'ar', YE: 'ar', LY: 'ar', SY: 'ar', SD: 'ar', PS: 'ar',
  IL: 'he', IR: 'fa', AF: 'fa', BD: 'bn', ID: 'id', MY: 'ms', BN: 'ms', TH: 'th', VN: 'vi',
  JP: 'ja', KR: 'ko', CN: 'zh-Hans', SG: 'zh-Hans', TW: 'zh-Hant', HK: 'zh-Hant', MO: 'zh-Hant', AD: 'ca',
};

/** Stable 53-bit hash of an English string, base 36 (cyrb53). The page computes the same key (agence shells). */
export function i18nKey(str) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function agenceLang(code) {
  return typeof code === 'string' ? BY_CODE.get(code.trim().toLowerCase()) || null : null;
}

/** One browser tag ("pt", "zh-HK", "de-AT", "nn") → a supported code, or null. */
export function matchLangTag(tag, country = '') {
  const t = String(tag || '').trim().toLowerCase().replace(/_/g, '-');
  if (!t || t === '*') return null;
  const exact = BY_CODE.get(t);
  if (exact) return exact.code;
  const [base, ...rest] = t.split('-');
  const cc = String(country || '').toUpperCase();
  if (base === 'zh') {
    if (rest.includes('hant') || rest.some((r) => ['tw', 'hk', 'mo'].includes(r))) return 'zh-Hant';
    if (rest.includes('hans') || rest.some((r) => ['cn', 'sg'].includes(r))) return 'zh-Hans';
    return ['TW', 'HK', 'MO'].includes(cc) ? 'zh-Hant' : 'zh-Hans';
  }
  if (base === 'pt') {
    if (rest.includes('br')) return 'pt-BR';
    if (rest.length) return 'pt-PT';
    return ['PT', 'AO', 'MZ', 'CV'].includes(cc) ? 'pt-PT' : 'pt-BR';
  }
  if (base === 'no' || base === 'nn' || base === 'nb') return 'nb';
  if (base === 'iw') return 'he';
  if (base === 'in') return 'id';
  const b = BY_CODE.get(base);
  return b ? b.code : null;
}

/** Accept-Language → tags, best first (q-values honoured, ties keep their order). */
export function parseAcceptLanguage(header) {
  return String(header || '')
    .split(',')
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const qv = q ? Number(q.slice(2)) : 1;
      return { tag: tag.trim(), q: Number.isFinite(qv) ? qv : 0, i };
    })
    .filter((x) => x.tag && x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i)
    .map((x) => x.tag);
}

function readCookie(header, name) {
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return ''; }
    }
  }
  return '';
}

/**
 * Picks the page language. `query` is the ?lang= value, `cookie` the raw Cookie header.
 * Returns { code, source, setCookie } where setCookie is a Set-Cookie value when ?lang= asked to remember or forget.
 */
export function pickAgenceLang({ query = '', cookie = '', acceptLanguage = '', country = '' } = {}) {
  const cc = /^[A-Za-z]{2}$/.test(String(country || '')) ? String(country).toUpperCase() : '';
  const q = String(query || '').trim();
  if (q.toLowerCase() === 'auto') {
    return { ...pickAgenceLang({ acceptLanguage, country: cc }), setCookie: `${AGENCE_LANG_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax` };
  }
  const fromQuery = agenceLang(q);
  if (fromQuery) {
    return { code: fromQuery.code, source: 'query', setCookie: `${AGENCE_LANG_COOKIE}=${encodeURIComponent(fromQuery.code)}; Path=/; Max-Age=31536000; SameSite=Lax` };
  }
  const fromCookie = agenceLang(readCookie(cookie, AGENCE_LANG_COOKIE));
  if (fromCookie) return { code: fromCookie.code, source: 'cookie', setCookie: '' };
  for (const tag of parseAcceptLanguage(acceptLanguage)) {
    const code = matchLangTag(tag, cc);
    if (code) return { code, source: 'browser', setCookie: '' };
  }
  if (cc && COUNTRY_LANG[cc]) return { code: COUNTRY_LANG[cc], source: 'country', setCookie: '' };
  return { code: 'en', source: 'default', setCookie: '' };
}

/* Catalogues, cached by file signature. A missing or broken file means "no translation": the page stays in English. */
const catalogCache = new Map();
export async function loadAgenceCatalog(uiDir, code) {
  if (!MACHINE_LANGS.includes(code)) return null;
  const path = join(uiDir, 'portfolio', 'i18n', `${code}.json`);
  let sig = '';
  try { const s = await stat(path); sig = `${s.mtimeMs}:${s.size}`; } catch { return null; }
  const hit = catalogCache.get(path);
  if (hit && hit.sig === sig) return hit.catalog;
  try {
    const json = JSON.parse(await readFile(path, 'utf-8'));
    const catalog = json && typeof json.k === 'object' && json.k ? json.k : null;
    catalogCache.set(path, { sig, catalog });
    return catalog;
  } catch {
    return null;
  }
}

/** JSON that is safe inside an inline <script>. */
function scriptJson(value) {
  // Characters built from code points, so no editor or tool turns the escapes back into raw characters.
  const BS = String.fromCharCode(92);
  const LS = String.fromCharCode(0x2028);
  const PS = String.fromCharCode(0x2029);
  return JSON.stringify(value)
    .split('<').join(BS + 'u003c')
    .split(LS).join(BS + 'u2028')
    .split(PS).join(BS + 'u2029');
}

/**
 * Writes the language into a rendered agence page: <html lang="…"> and window.AG_I18N at <!--agence-i18n-->.
 * A machine language without a catalogue falls back to English (the page never shows a half-translated mix of
 * a missing file).
 */
export function localizeAgenceHtml(html, code, catalog) {
  let lang = agenceLang(code) || agenceLang('en');
  const mt = !HAND_LANGS.includes(lang.code);
  if (mt && !catalog) lang = agenceLang('en');
  const isMt = !HAND_LANGS.includes(lang.code);
  const payload = { code: lang.code, base: lang.code === 'fr' ? 'fr' : 'en', intl: lang.intl, mt: isMt, rtl: !!lang.rtl };
  if (isMt) payload.cat = catalog;
  const boot = `<script>window.AG_I18N=${scriptJson(payload)};</script>`;
  return String(html)
    .replace(/<html lang="[^"]*"/, `<html lang="${lang.code}"`)
    .replace('<!--agence-i18n-->', boot);
}

/** Request → { html, setCookie, code } for an already-rendered agence page. */
export async function localizeAgenceForRequest(html, req, searchParams, uiDir) {
  const h = (req && req.headers) || {};
  const pick = pickAgenceLang({
    query: searchParams && typeof searchParams.get === 'function' ? searchParams.get('lang') || '' : '',
    cookie: h.cookie || '',
    acceptLanguage: h['accept-language'] || '',
    country: h['x-vercel-ip-country'] || '',
  });
  const catalog = await loadAgenceCatalog(uiDir, pick.code);
  return { html: localizeAgenceHtml(html, pick.code, catalog), setCookie: pick.setCookie, code: pick.code, source: pick.source };
}

/** English name of a supported language, for the assistant's instructions. */
export function agenceLanguageName(code) {
  const l = agenceLang(code);
  return l ? l.name : 'English';
}
