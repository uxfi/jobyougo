// agence-site.mjs — server helpers for the agency page (/agence, "v2 studio").
//
// The agency page (ui/agence.html) reuses the portfolio's design system. Rather
// than copying ~8.4k lines of CSS into a second file that would drift, the page
// carries a <!--@portfolio-css--> marker and the server splices in the FIRST
// <style> block of portfolio.html's <head> at request time (cached on mtime).
//
// The agency chatbot shares /api/hrhv with the portfolio's Jarvos bot; the
// request picks a whitelisted persona. Its system prompt is modes/agence.md plus
// the offers JSON embedded in ui/portfolio/agence-data.js, so the page and the
// bot quote prices from one source. Any missing piece fails closed ('').

import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

export const PORTFOLIO_CSS_MARKER = '<!--@portfolio-css-->';
export const OFFERS_JSON_START = '/*OFFERS_JSON*/';
export const OFFERS_JSON_END = '/*END_OFFERS_JSON*/';

const AGENCE_REDIRECTS = new Set(['/agency', '/agency/', '/agence/', '/agency.html']);

/** Real pages beside the homepage. navTone is the nav class for the first screen. */
export const AGENCE_SUBPAGES = Object.freeze({
  showcase: { navTone: '' },
  services: { navTone: 'on-light' },
  pricing: { navTone: 'on-light' },
  'secret-touch': { navTone: '' },
});

/** '/agence' + search for the alias paths, else null. '/agence.html' is served, not redirected. */
export function agenceRedirectTarget(path, search = '') {
  const q = typeof search === 'string' ? search : '';
  if (AGENCE_REDIRECTS.has(path)) return '/agence' + q;
  if (typeof path === 'string') {
    const m = /^\/agence\/([a-z0-9-]+)\/$/.exec(path);
    if (m && Object.hasOwn(AGENCE_SUBPAGES, m[1])) return '/agence/' + m[1] + q;
  }
  return null;
}

/** Slug for /agence/<page>, or null. Trailing slash is a redirect, not a page. */
export function agenceSubpageId(path) {
  if (typeof path !== 'string') return null;
  const m = /^\/agence\/([a-z0-9-]+)$/.exec(path);
  if (!m || !Object.hasOwn(AGENCE_SUBPAGES, m[1])) return null;
  return m[1];
}

/** True for the paths that serve the agency page itself. */
export function isAgencePagePath(path) {
  return path === '/agence' || path === '/agence.html'
    || (typeof path === 'string' && path.startsWith('/agence/layout-'));
}

async function fileSig(file) {
  try {
    const s = await stat(file);
    return s.isFile() ? `${s.mtimeMs}:${s.size}` : null;
  } catch {
    return null;
  }
}

/** First complete <style>…</style> element inside <head> (whole doc if no </head>), or ''. */
export function firstHeadStyle(html) {
  const text = String(html || '');
  const headEnd = text.search(/<\/head\s*>/i);
  const head = headEnd >= 0 ? text.slice(0, headEnd) : text;
  const m = head.match(/<style\b[^>]*>[\s\S]*?<\/style\s*>/i);
  return m ? m[0] : '';
}

/** Replace the first marker occurrence (no String.replace: CSS may contain `$`). */
export function injectPortfolioCss(agenceHtml, styleBlock) {
  const i = agenceHtml.indexOf(PORTFOLIO_CSS_MARKER);
  if (i < 0) return agenceHtml;
  return agenceHtml.slice(0, i) + (styleBlock || '') + agenceHtml.slice(i + PORTFOLIO_CSS_MARKER.length);
}

const pageCache = new Map(); // uiDir -> { key, html }

/**
 * agence.html with the portfolio design-system CSS spliced in. Returns null when
 * agence.html does not exist (the route then falls through to 404).
 */
export async function renderAgencePage(uiDir) {
  const agencePath = join(uiDir, 'agence.html');
  const portfolioPath = join(uiDir, 'portfolio.html');
  const [aSig, pSig] = await Promise.all([fileSig(agencePath), fileSig(portfolioPath)]);
  if (!aSig) return null;
  const key = `${aSig}|${pSig}`;
  const hit = pageCache.get(uiDir);
  if (hit && hit.key === key) return hit.html;

  let agenceHtml;
  try {
    agenceHtml = await readFile(agencePath, 'utf-8');
  } catch {
    return null;
  }
  let html = agenceHtml;
  let cacheable = true;
  if (agenceHtml.includes(PORTFOLIO_CSS_MARKER)) {
    // A transient read failure (EBUSY/EPERM on Windows while another process holds
    // the file) must not cache an unstyled page under the good mtime:size key.
    const portfolioHtml = pSig ? await readFile(portfolioPath, 'utf-8').catch(() => null) : '';
    if (portfolioHtml === null) cacheable = false;
    html = injectPortfolioCss(agenceHtml, firstHeadStyle(portfolioHtml));
  }
  if (cacheable) pageCache.set(uiDir, { key, html });
  return html;
}

const subpageCache = new Map();

/**
 * Assembled subpage (shell + fragment). Null when the slug is unknown or a file is missing.
 */
export async function renderAgenceSubpage(uiDir, slug) {
  if (!Object.hasOwn(AGENCE_SUBPAGES, slug)) return null;
  const shellPath = join(uiDir, 'agence', 'page.html');
  const partPath = join(uiDir, 'agence', `${slug}.html`);
  const [shellSig, partSig] = await Promise.all([fileSig(shellPath), fileSig(partPath)]);
  if (!shellSig || !partSig) return null;
  const key = `${shellSig}|${partSig}`;
  const cacheKey = `${uiDir}\0${slug}`;
  const hit = subpageCache.get(cacheKey);
  if (hit && hit.key === key) return hit.html;

  let shell;
  let part;
  try {
    [shell, part] = await Promise.all([readFile(shellPath, 'utf-8'), readFile(partPath, 'utf-8')]);
  } catch {
    return null;
  }
  const html = shell
    .split('<!--@slug-->').join(slug)
    .split('<!--@navtone-->').join(AGENCE_SUBPAGES[slug].navTone)
    .split('<!--@main-->').join(part);
  subpageCache.set(cacheKey, { key, html });
  return html;
}

/** The JSON value between the offers markers, or undefined when absent/invalid. */
export function extractOffersJson(source) {
  const text = String(source || '');
  const start = text.indexOf(OFFERS_JSON_START);
  if (start < 0) return undefined;
  const from = start + OFFERS_JSON_START.length;
  const end = text.indexOf(OFFERS_JSON_END, from);
  if (end < 0) return undefined;
  const raw = text.slice(from, end).trim();
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

const promptCache = new Map(); // rootDir -> { key, prompt }

/**
 * System prompt for the agency chatbot: modes/agence.md + the offers JSON.
 * Returns '' (fail closed) when either part is missing, empty or invalid.
 */
export async function buildAgencyChatPrompt(rootDir) {
  const mdPath = join(rootDir, 'modes', 'agence.md');
  const dataPath = join(rootDir, 'ui', 'portfolio', 'agence-data.js');
  const [mSig, dSig] = await Promise.all([fileSig(mdPath), fileSig(dataPath)]);
  if (!mSig || !dSig) return '';
  const key = `${mSig}|${dSig}`;
  const hit = promptCache.get(rootDir);
  if (hit && hit.key === key) return hit.prompt;

  let prompt = '';
  try {
    const [md, data] = await Promise.all([readFile(mdPath, 'utf-8'), readFile(dataPath, 'utf-8')]);
    const offers = extractOffersJson(data);
    if (md.trim() && offers !== undefined) {
      prompt = md.trimEnd()
        + '\n\n## Offers (authoritative, quote prices exactly)\n'
        + JSON.stringify(offers, null, 2);
    }
  } catch {
    return '';
  }
  promptCache.set(rootDir, { key, prompt });
  return prompt;
}

const CHAT_PERSONAS = Object.freeze(Object.assign(Object.create(null), { hugo: true, agency: true }));

/** { persona: 'hugo'|'agency', lang: 'fr'|'en' } from an /api/hrhv body. Unknown → 'hugo' / 'en'. */
export function resolveChatPersona(body) {
  const rawPersona = body && typeof body === 'object' ? body.persona : undefined;
  const persona = typeof rawPersona === 'string' && Object.hasOwn(CHAT_PERSONAS, rawPersona) ? rawPersona : 'hugo';
  const rawLang = body && typeof body === 'object' ? body.lang : undefined;
  const lang = typeof rawLang === 'string' && /^fr(?:[-_]|$)/i.test(rawLang.trim()) ? 'fr' : 'en';
  return { persona, lang };
}

/** Language line appended to the agency system prompt. */
export function agencyLanguageInstruction(lang) {
  const name = lang === 'fr' ? 'French' : 'English';
  return `\n\nAnswer in ${name} (the visitor's page language) unless the visitor writes in another language; then answer in theirs.`;
}
