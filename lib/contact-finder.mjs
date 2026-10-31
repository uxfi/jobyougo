// Contact finder: for one offer, find who to write to (hiring inbox, recruiter,
// the team lead for the role, or a founder) and an address that can be
// trusted. Pure helpers are exported for tests; `findContacts` orchestrates
// them with injected network functions (page fetch, web search, optional
// enrichment providers) so nothing here touches the network on its own.
//
// Confidence levels on an address:
//   verified  — printed on the company's own site or in the posting, or
//               confirmed by an enrichment provider.
//   likely    — built from a name pattern the site itself uses, or a
//               provider answered "catch-all / risky".
//   guess     — a common pattern (first.last@) with nothing confirming it.
// Only verified and likely addresses are proposed as "best"; a guess is shown
// as such and the user decides.

import dns from 'node:dns/promises';
import { fetchResponse } from '../providers/_http.mjs';
import { inferPersona, mailboxKind } from './application-email.mjs';
import { JOB_HOST_RE, SOCIAL_HOST_RE, companyNameWords, isNotEmployerHost, isSharedHostTenant } from './non-employer-hosts.mjs';
import { atsSlugDomain, cleanOwnerName, guessDomainsFromName, isParkedPage, linkedinCompanyPage, linksToBoard, lookupEmployerSite, siteRoot } from './employer-site-sources.mjs';
import { ROLE_WORD, identityFromUrl } from './posting-identity.mjs';

// ── Hosts that are never the employer's own site ────────────────────────────
// The lists live in non-employer-hosts.mjs; isJobHost / isSocialHost keep
// their narrower meaning for the callers that want only those.
const WEBMAIL_RE = /(?:^|\.)(?:gmail\.com|googlemail\.com|outlook\.com|hotmail\.[a-z]+|live\.[a-z]+|yahoo\.[a-z.]+|icloud\.com|me\.com|proton\.me|protonmail\.com|gmx\.[a-z]+|web\.de|orange\.fr|wanadoo\.fr|free\.fr|sfr\.fr|laposte\.net|yandex\.[a-z]+|mail\.com|aol\.com)$/i;
// Asian, Indian, Australian and Nordic legal forms ("Maven Workforce Pvt
// Ltd", "Bjak Sdn Bhd", "Acme Private Limited", "Acme ApS") only after a
// first word: "APS Group" keeps its name.
const LEGAL_SUFFIX_RE = /\b(?:inc|incorporated|llc|ltd|limited|plc|gmbh|ag|sas|sasu|sa|sarl|eurl|sprl|bv|nv|oy|ab|as|srl|spa|co|corp|corporation|company|group|groupe|holding|labs?|technologies|technology|tech|software|studio|studios|solutions|digital|international|global|france|europe|the)\b\.?|(?<=[a-z0-9][^a-z0-9]+)\b(?:pvt|pte|pty|llp|sdn|bhd|kk|aps|private\s+(?:limited|ltd))\b\.?/gi;

/**
 * Registrable domain of a hostname: jobs.acme-group.co.uk → acme-group.co.uk.
 * Counting labels from the right already drops any subdomain; a name that
 * starts like one (people.ai, team.blue) is the domain itself.
 */
export function registrableDomain(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!host || /^[\d.]+$/.test(host) || host.includes(':')) return '';
  const labels = host.split('.').filter(Boolean);
  if (labels.length < 2) return '';
  const secondLevel = /^(?:co|com|org|net|gov|ac|edu|ltd|plc|asso)$/.test(labels[labels.length - 2]) && labels.length >= 3;
  return labels.slice(-(secondLevel ? 3 : 2)).join('.');
}

export function isJobHost(hostname) {
  return JOB_HOST_RE.test(String(hostname || '').toLowerCase());
}

export function isSocialHost(hostname) {
  return SOCIAL_HOST_RE.test(String(hostname || '').toLowerCase());
}

/** Lowercase name tokens without legal suffixes: "Acme Labs SAS" → ["acme"]. */
export function companyTokens(name) {
  return [...new Set(String(name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(LEGAL_SUFFIX_RE, ' ')
    .split(/[^a-z0-9]+/)
    .filter(token => token.length >= 2))];
}

// ── Does a domain carry the company's name? ─────────────────────────────────
// Words around a name that do not change whose site it is ("tryriot",
// "datadoghq", "acme-group"). Semantic words (games, bank, pay) are left out:
// riotgames.com is another company than Riot.
const AFFIX_PREFIXES = ['try', 'get', 'use', 'join', 'hello', 'go', 'with', 'meet', 'hey', 'the', 'my', 'we', 'its', 'team', 'hi'];
const AFFIX_SUFFIXES = ['hq', 'app', 'apps', 'ai', 'io', 'lab', 'labs', 'group', 'inc', 'co', 'corp', 'team', 'hr', 'official', 'online', 'web', 'global', 'world', 'careers', 'jobs', 'uk', 'us', 'usa', 'eu', 'de', 'fr', 'france', 'tech', 'studio', 'studios', 'software', 'systems', 'technologies', 'company', 'international'];
// First words too common to stand for a whole name: bell.ca is not Bellwood
// Labs, datadog.com is not Data Solutions.
const GENERIC_NAME_TOKENS = new Set(['data', 'smart', 'cloud', 'digital', 'one', 'bell', 'wood', 'euro', 'tech', 'global', 'studio', 'labs', 'group', 'solutions', 'ai', 'app']);

/**
 * The spellings a domain label may take for this name: every word joined
 * ("Bellwood Labs" → bellwoodlabs), the distinctive tokens joined
 * (→ bellwood), and "Chess Com" → chess. One generic word left alone
 * ("Data Solutions" → data) is not a spelling of the name.
 * fullName: only the spellings of every word (novalabs for Nova Labs, not
 * nova, which another Nova owns).
 */
function nameForms(company, { fullName = false } = {}) {
  const words = companyNameWords(company);
  const tokens = companyTokens(company);
  const forms = new Set();
  if (words.length) forms.add(words.join(''));
  if (!fullName && tokens.length && !(words.length >= 2 && tokens.length === 1 && GENERIC_NAME_TOKENS.has(tokens[0]))) forms.add(tokens.join(''));
  if (words.length >= 2 && words[words.length - 1] === 'com') forms.add(words.slice(0, -1).join(''));
  if (String(company || '').includes('&')) forms.add(companyNameWords(String(company).replace(/&/g, ' and ')).join(''));
  return { forms: [...forms].filter(form => form.length >= 2), words, tokens };
}

/**
 * How a domain's own label resembles the company name: 'exact' (qonto.com ↔
 * Qonto), 'affix' (tryriot.com ↔ Riot, datadoghq.com ↔ Datadog), 'token'
 * (vertech.com ↔ Vertech Industrial Systems), or '' when it does not.
 * No other substring matching: bell.ca is not Bellwood Labs.
 * { fullName: true }: the domain must carry every word of the name (no
 * 'token', and no match left only once Labs, Systems or France are set
 * aside): nova.com is not Nova Labs' by its name alone.
 */
export function domainNameAffinity(domain, company, { fullName = false } = {}) {
  const core = String(domain || '').toLowerCase().split('.')[0].replace(/-/g, '');
  if (!core) return '';
  const { forms, tokens } = nameForms(company, { fullName });
  if (!forms.length) return '';
  if (forms.includes(core)) return 'exact';
  for (const form of forms) {
    if (form.length < 3) continue;
    for (const prefix of ['', ...AFFIX_PREFIXES]) {
      for (const suffix of ['', ...AFFIX_SUFFIXES]) {
        if ((prefix || suffix) && core === `${prefix}${form}${suffix}`) return 'affix';
      }
    }
  }
  const first = tokens[0] || '';
  if (!fullName && tokens.length >= 2 && first.length >= 4 && !GENERIC_NAME_TOKENS.has(first) && (core === first || AFFIX_SUFFIXES.some(suffix => core === `${first}${suffix}`))) return 'token';
  return '';
}

/** Does a domain plausibly belong to this company? "tryriot.com" ↔ "Riot". */
export function domainMatchesCompany(domain, company) {
  return domainNameAffinity(domain, company) !== '';
}

/** The company's own domain when the posting lives on it; '' for an ATS, a job board or a directory. */
export function companyDomainFromJobUrl(jobUrl, { company = '' } = {}) {
  try {
    const host = new URL(String(jobUrl || '')).hostname;
    if (isNotEmployerHost(host, { company }) || WEBMAIL_RE.test(host)) return '';
    return registrableDomain(host);
  } catch {
    return '';
  }
}

function absolutize(value) {
  const raw = String(value || '').trim().replace(/^\/\//, 'https://');
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^[\w.-]+\.[a-z]{2,}(?:\/|$)/i.test(raw)) return `https://${raw}`;
  return '';
}

function jsonLdNodes(value, out = []) {
  if (Array.isArray(value)) value.forEach(item => jsonLdNodes(item, out));
  else if (value && typeof value === 'object') {
    out.push(value);
    if (Array.isArray(value['@graph'])) jsonLdNodes(value['@graph'], out);
  }
  return out;
}

const JSON_LD_RE = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

/**
 * Company website from a job page: JSON-LD hiringOrganization.sameAs / url,
 * which job boards (Welcome to the Jungle, many ATS pages) fill in. Every
 * entry is read; boards, directories and social profiles are skipped (a
 * sameAs of builtin.com/company/x is not the site), and the entry whose
 * domain carries the name wins over the first one left. An entry without
 * the name on a profile path (/company/x, /companies/x) is an unlisted
 * board's page about the employer: never returned. Without the name, the
 * caller still has to check the home page (findContacts does).
 * companyWebsiteFromHtml(html, company) or (html, { company, organization }):
 * organization: true also reads an @type Organization node's sameAs / url,
 * as on a LinkedIn company page.
 */
export function companyWebsiteFromHtml(html, options = '') {
  const { company = '', organization = false } = typeof options === 'string' ? { company: options } : (options || {});
  const kept = [];
  for (const block of String(html || '').matchAll(JSON_LD_RE)) {
    let parsed;
    try { parsed = JSON.parse(block[1].trim()); } catch { continue; }
    for (const node of jsonLdNodes(parsed)) {
      const orgs = [node.hiringOrganization].flat();
      if (organization && [node['@type']].flat().some(type => /^(?:Organization|Corporation|LocalBusiness)$/i.test(String(type)))) orgs.push(node);
      for (const org of orgs) {
        if (!org || typeof org !== 'object') continue;
        const name = company || (typeof org.name === 'string' ? org.name : '');
        for (const raw of [org.sameAs, org.url].flat()) {
          const url = absolutize(raw);
          if (!url) continue;
          let parsed;
          try { parsed = new URL(url); } catch { continue; }
          const host = parsed.hostname;
          if (isNotEmployerHost(host, { company: name }) || WEBMAIL_RE.test(host)) continue;
          const affinity = name ? domainNameAffinity(registrableDomain(host), name) : '';
          if (!affinity && ABOUT_PAGE_PATH_RE.test(parsed.pathname.toLowerCase())) continue;
          kept.push({ url, affinity });
        }
      }
    }
  }
  return (kept.find(item => item.affinity) || kept[0])?.url || '';
}

const EMAIL_IN_TEXT_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
// A 400 KB page is scanned token by token: the regex only runs on tokens
// that contain "@" and have an address-sized length, so a long run of
// letters cannot make it backtrack over the whole page.
function* emailMatches(text) {
  const seen = new Set();
  for (const token of String(text || '').split(/[\s<>"'()\[\]{},;]+/)) {
    if (token.length > 254 || !token.includes('@')) continue;
    for (const m of token.matchAll(EMAIL_IN_TEXT_RE)) {
      if (seen.has(m[0])) continue;
      seen.add(m[0]);
      yield m;
    }
  }
}
const URL_IN_TEXT_RE = /\b(?:https?:\/\/|www\.)[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s)"'<>]*)?/gi;

/** Domains mentioned in a posting (emails, links), ranked by company-name match. */
export function domainsFromText(text, company = '') {
  const found = new Map();
  const add = (domain, via) => {
    if (!domain || isNotEmployerHost(domain, { company }) || WEBMAIL_RE.test(domain)) return;
    const prev = found.get(domain) || { domain, score: 0, via: new Set() };
    prev.score += (via === 'email' ? 2 : 1) + (domainMatchesCompany(domain, company) ? 3 : 0);
    prev.via.add(via);
    found.set(domain, prev);
  };
  for (const m of emailMatches(text)) add(registrableDomain(m[0].split('@')[1]), 'email');
  for (const m of String(text || '').matchAll(URL_IN_TEXT_RE)) {
    try { add(registrableDomain(new URL(m[0].startsWith('http') ? m[0] : `https://${m[0]}`).hostname), 'url'); } catch { /* skip */ }
  }
  return [...found.values()].map(item => ({ ...item, via: [...item.via] })).sort((a, b) => b.score - a.score);
}

// Lowercase, unaccented words of a free text: "TripleTen: Bootcamp" → tripleten bootcamp.
function plainWords(text) {
  return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter(Boolean);
}

// 2 when a result title starts with the company name and a separator (or
// ends there), 1 when it holds the name as a whole phrase, else 0.
function titleNamesCompany(title, company) {
  const words = companyNameWords(company);
  if (!words.length) return 0;
  const name = words.join('[\\s.-]*');
  const plain = String(title || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  if (new RegExp(`^${name}\\s*(?:$|[|:·,(–—-])`).test(plain)) return 2;
  return new RegExp(`(?:^|[^a-z0-9])${name}(?:$|[^a-z0-9])`).test(plain) ? 1 : 0;
}

const AFFINITY_SCORE = { exact: 6, affix: 4, token: 3 };
// A directory path about a company (/company/acme, /view/123, /review/acme.com).
const ABOUT_PAGE_PATH_RE = /^\/(?:[a-z]{2}(?:[-_][a-z]{2})?\/)?(?:company|companies|organi[sz]ations?|org|profile|profiles|view|review|reviews|d)\/[^/]/;

/**
 * Candidate company sites among search results for "<company> official
 * website", best first, one entry per domain. Boards and directories are
 * skipped, and a host only qualifies by its name: a result title that
 * mentions the company never makes scamdoc.com its site.
 * Returns [{ domain, origin, url, title, affinity, score }].
 */
export function rankDomainCandidates(results = [], company = '') {
  const tokens = companyTokens(company);
  const byDomain = new Map();
  (Array.isArray(results) ? results : []).forEach((result, rank) => {
    let url;
    try { url = new URL(String(result?.url || '')); } catch { return; }
    if (!/^https?:$/.test(url.protocol) || isNotEmployerHost(url.hostname, { company }) || WEBMAIL_RE.test(url.hostname)) return;
    const domain = registrableDomain(url.hostname);
    if (!domain) return;
    const affinity = domainNameAffinity(domain, company);
    if (!affinity) return;
    let score = AFFINITY_SCORE[affinity] + titleNamesCompany(result.title, company);
    const path = url.pathname.toLowerCase().replace(/\/+$/, '');
    if (!path || /^\/(?:[a-z]{2}(?:[-_][a-z]{2})?|about(?:-us)?)$/.test(path)) score += 1;
    if (tokens.some(token => token.length >= 4 && path.includes(token)) || ABOUT_PAGE_PATH_RE.test(path)) score -= 2;
    score = Math.round((score + Math.max(0, 1 - 0.1 * rank)) * 10) / 10;
    const prev = byDomain.get(domain);
    if (!prev || score > prev.score) byDomain.set(domain, { domain, origin: url.origin, url: String(result.url), title: String(result.title || ''), affinity, score });
  });
  return [...byDomain.values()].sort((a, b) => b.score - a.score);
}

/** Pick the company site among search results for "<company> official website". */
export function pickDomainFromSearch(results = [], company = '') {
  const best = rankDomainCandidates(results, company)[0];
  return best ? { domain: best.domain, url: best.url, title: best.title } : null;
}

// Does one identity field ("Bellwood Labs | Home", "© 2026 Acme, Inc.") name
// the company: a part equal to the name, or its words joined as whole words?
// fullName: every word of the name, joined ("Mercury" alone is not Mercury
// Systems, though both reduce to "mercury").
function fieldNamesCompany(value, company, { fullName = false } = {}) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return false;
  // A placeholder titled with its own host ("riot.app") names a domain, not
  // the company, unless the company is named like a domain ("Chess.com").
  if (/^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(text)) return !fullName && companyPartMatches(text, company);
  if (!fullName && text.split(/\s+[-–—|·:]\s+|\s*[|·]\s*|:\s+/).some(part => companyPartMatches(part, company))) return true;
  const words = companyNameWords(company);
  const names = new Set([words.join('')]);
  if (words.length >= 2 && words[words.length - 1] === 'com') names.add(words.slice(0, -1).join(''));
  const longest = Math.max(...[...names].map(name => name.length));
  if (!longest) return false;
  const fieldWords = plainWords(text);
  for (let start = 0; start < fieldWords.length; start += 1) {
    let joined = '';
    for (let end = start; end < fieldWords.length && joined.length < longest; end += 1) {
      joined += fieldWords[end];
      if (names.has(joined)) return true;
    }
  }
  return false;
}

/**
 * Does a home page name the company in the places a site names itself: the
 * <title>, og:site_name, the application-name meta, a JSON-LD Organization /
 * Corporation / WebSite name, or the © line? A directory's home page names
 * the directory (ScamDoc, Built In), not the companies it lists.
 * { fullName: true }: the page must write every word of the name (a bank
 * titled "Mercury" does not name Mercury Systems).
 */
export function homepageNamesCompany(html, company, { fullName = false } = {}) {
  const raw = String(html || '');
  if (!raw || !companyNameWords(company).length) return false;
  const fields = [];
  const title = raw.match(/<title[^>]*>([\s\S]{0,400}?)<\/title>/i);
  if (title) fields.push(title[1]);
  for (const [tag] of raw.matchAll(/<meta\b[^>]*>/gi)) {
    if (!/(?:property|name)\s*=\s*["'](?:og:site_name|application-name)["']/i.test(tag)) continue;
    const content = tag.match(/content\s*=\s*["']([^"']*)["']/i);
    if (content) fields.push(content[1]);
  }
  for (const block of raw.matchAll(JSON_LD_RE)) {
    let parsed;
    try { parsed = JSON.parse(block[1].trim()); } catch { continue; }
    for (const node of jsonLdNodes(parsed)) {
      const types = [node['@type']].flat().map(String);
      if (types.some(type => /^(?:Organization|Corporation|WebSite)$/i.test(type)) && typeof node.name === 'string') fields.push(node.name);
    }
  }
  for (const line of pageText(raw.replace(/&copy;/gi, '©')).split('\n')) {
    const at = line.search(/©|\(c\)|copyright/i);
    if (at >= 0) fields.push(line.slice(Math.max(0, at - 60), at + 120));
  }
  return fields.some(field => fieldNamesCompany(decodeEntities(field), company, { fullName }));
}

// ── Emails on a page ────────────────────────────────────────────────────────
const IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|svg|webp|ico|css|js)$/i;
const JUNK_LOCAL_RE = /^(?:[a-f0-9]{16,}|.{41,}|u[0-9a-f]{6,}|[0-9]+)$/i;
const JUNK_DOMAIN_RE = /(?:^|\.)(?:example\.(?:com|org)|sentry\.io|wixpress\.com|sentry-next\.wixpress\.com|domain\.com|email\.com|yourcompany\.com|company\.com|test\.com|2x\.png|w3\.org|schema\.org)$/i;

// "&#1114112;" (above U+10FFFF) would throw out of String.fromCodePoint and
// abort the whole search on one odd page: keep the entity text instead.
function codePointOr(code, fallback) {
  return Number.isInteger(code) && code >= 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : fallback;
}

function decodeEntities(value = '') {
  return String(value)
    .replace(/&#(\d+);/g, (whole, code) => codePointOr(Number(code), whole))
    .replace(/&#x([0-9a-f]+);/gi, (whole, hex) => codePointOr(parseInt(hex, 16), whole))
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
}

// ── Protected addresses and heavy pages ─────────────────────────────────────
const EMAIL_ONLY_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

/**
 * Cloudflare email protection: the first byte is the key, each following
 * byte is one UTF-8 byte of the address XOR the key. '' for odd-length or
 * non-hex input, or when the result is not an address.
 */
export function decodeCfEmail(hex) {
  const value = String(hex || '').trim();
  if (value.length < 4 || value.length % 2 || /[^0-9a-f]/i.test(value)) return '';
  const key = parseInt(value.slice(0, 2), 16);
  const bytes = new Uint8Array(value.length / 2 - 1);
  for (let i = 2; i < value.length; i += 2) bytes[i / 2 - 1] = parseInt(value.slice(i, i + 2), 16) ^ key;
  let decoded = '';
  try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return ''; }
  // A protected mailto: keeps its ?subject=… after the address.
  const address = decoded.split('?')[0].trim();
  return EMAIL_ONLY_RE.test(address) ? address : '';
}

// Attribute runs bounded and stopped at the next "<": unbounded, a page of
// unclosed "<span data-cfemail=" tags made the pattern cubic.
const CF_ELEMENT_RE = /<([a-z][a-z0-9]*)\b[^<>]{0,1000}?\sdata-cfemail\s*=\s*["']?([0-9a-f]+)["']?[^<>]{0,1000}>[\s\S]{0,500}?<\/\1\s*>/gi;
const CF_HREF_RE = /href\s*=\s*(["'])(?:(?:https?:)?\/\/[^"'/]+)?\/cdn-cgi\/l\/email-protection#([0-9a-f]+)\1/gi;

/**
 * Cloudflare-protected addresses written out: an element carrying
 * data-cfemail becomes the address, an /cdn-cgi/l/email-protection#HEX link
 * becomes a mailto:. Anything that does not decode is left as it was.
 */
export function preDecodeHtml(html) {
  const raw = String(html || '');
  if (!/data-cfemail|email-protection#/i.test(raw)) return raw;
  return raw
    .replace(CF_ELEMENT_RE, (whole, tag, hex) => decodeCfEmail(hex) || whole)
    .replace(CF_HREF_RE, (whole, quote, hex) => {
      const email = decodeCfEmail(hex);
      return email ? `href=${quote}mailto:${email}${quote}` : whole;
    });
}

// Image markup and presentational attributes: most of a long staff page
// (RoomPriceGenie's /genies/, 1.4 MB, is 265 KB without them).
const MEDIA_TAG_RE = /<\/?(?:img|picture|source|track)\b[^<>]*>/gi;
const TAG_WITH_ATTRS_RE = /<[a-z][a-z0-9-]*\s[^<>]*>/gi;
const PRESENTATION_ATTR_RE = /\s(?:class|style|id|width|height|sizes|srcset|data-[\w:.-]+)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+)/gi;

/**
 * A page without its weight: scripts (JSON-LD kept), styles, SVG, noscript
 * and comments removed. Still too long, its images and presentational
 * attributes (class, style, id, data-*, srcset, sizes, width, height) go
 * too (Cloudflare addresses are decoded before), and only then are the
 * first and last maxChars/2 kept, so the footer (contact, Impressum,
 * mailto) survives a 900 KB home page. Cutting first dropped the cards in
 * the middle of a long team page, a different few at each fetch.
 */
export function slimHtml(html, maxChars = 400000) {
  let slim = String(html || '')
    .replace(/<script\b([^>]*)>[\s\S]*?<\/script\s*>/gi, (whole, attrs) => (/application\/ld\+json/i.test(attrs) ? whole : ' '))
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<svg\b[\s\S]*?<\/svg\s*>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  if (maxChars > 0 && slim.length > maxChars) {
    slim = slim.replace(MEDIA_TAG_RE, ' ').replace(TAG_WITH_ATTRS_RE, tag => tag.replace(PRESENTATION_ATTR_RE, ''));
  }
  if (maxChars > 0 && slim.length > maxChars) {
    const half = Math.floor(maxChars / 2);
    slim = `${slim.slice(0, half)}\n${slim.slice(-half)}`;
  }
  return slim;
}

/** Visible text of a page, one line per block. */
export function pageText(html = '') {
  return decodeEntities(String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    // A page cut inside a <style> or <script> block: the rest is code.
    .replace(/<(?:style|script)\b[^>]*>[\s\S]*$/i, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // Block ends break the line; <title> and the nav too, or each page's own
    // title glues onto the shared menu and the menu looks unique to it.
    .replace(/<\/(?:p|div|li|h[1-6]|br|tr|section|article|header|footer|dd|dt|blockquote|title|nav|ul|ol|main|aside|table)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&shy;/gi, ''))
    // Soft hyphen and zero-width characters split names and addresses ("Heise-rowski").
    .replace(/[\u00ad\u200b-\u200d\u2060\ufeff]/g, '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

// "marie.dupont", "m.dupont", "jean-pierre.durand": a person. A single word
// ("partenariats", "boutique", "service") is not, whatever its length.
function looksLikePersonLocal(local) {
  return /^[a-z]{2,}[._-][a-z]{2,}(?:[._-][a-z]{1,})?$/i.test(local) || /^[a-z]\.[a-z]{3,}$/i.test(local);
}

// Pieces of a local part that never belong to a name: cities and country
// codes ("compta.paris", "info.fr" style inboxes), service words, and the
// role, department and legal words of two-word inboxes (new.business@,
// donnees.personnelles@, accounts.payable@ read as "New Business" and
// "Donnees Personnelles" and drafted for).
const NOT_NAME_PIECES = new Set([
  'paris', 'london', 'berlin', 'lyon', 'madrid', 'munich', 'amsterdam', 'marseille', 'lille', 'toulouse', 'bordeaux', 'nantes',
  'rennes', 'strasbourg', 'montpellier', 'brussels', 'bruxelles', 'geneva', 'geneve', 'zurich', 'lausanne', 'barcelona', 'milan',
  'milano', 'rome', 'lisbon', 'lisboa', 'dublin', 'hamburg', 'frankfurt', 'cologne', 'vienna', 'wien', 'muenchen', 'stockholm',
  'copenhagen', 'oslo', 'helsinki', 'warsaw', 'prague', 'newyork', 'nyc',
  'fr', 'uk', 'us', 'es', 'it', 'nl', 'be', 'ch', 'eu', 'en', 'int', 'global', 'europe', 'france', 'emea', 'apac', 'usa',
  'relations', 'ressources', 'mairie', 'mail', 'email', 'web', 'shop', 'boutique',
  'new', 'business', 'development', 'accounts', 'account', 'payable', 'receivable', 'invoices', 'invoice', 'accounting', 'payroll',
  'procurement', 'purchasing', 'achats', 'fournisseurs', 'suppliers', 'supplier', 'vendors', 'orders', 'commandes',
  'donnees', 'personnelles', 'privee', 'protection', 'requests', 'request', 'mentions', 'legales', 'assistance', 'technique',
  'technical', 'board', 'conseil', 'events', 'evenements', 'questions', 'feedback', 'reservations', 'booking', 'bookings',
]);

// Privacy, legal, finance, purchasing and sales inboxes mailboxKind does not
// list: no application goes to donnees.personnelles@ or accounts.payable@,
// nor to the German and French ones (vertrieb@, dsb@, ventes@, devis@).
const AVOID_PIECES = new Set([
  'donnees', 'personnelles', 'privee', 'protection', 'requests', 'mentions', 'legales', 'accounts', 'payable', 'receivable',
  'invoices', 'invoice', 'accounting', 'payroll', 'procurement', 'purchasing', 'achats', 'fournisseurs', 'suppliers', 'supplier',
  'vendors', 'business', 'orders', 'commandes', 'reservations',
  'vertrieb', 'verkauf', 'einkauf', 'buchhaltung', 'rechnung', 'rechnungen', 'dsb', 'datenschutzbeauftragter', 'dataprotection',
  'privacyofficer', 'ventes', 'vente', 'devis', 'facturation', 'factures', 'partenariat', 'partenariats',
]);

/**
 * The kind of an address from its local part alone: a mailbox class
 * (mailboxKind, then 'avoid' for the inboxes AVOID_PIECES names), else
 * 'person' for a name-shaped local whose pieces are neither a role, a
 * department, a city nor a country code, else 'other'.
 */
function localKind(local) {
  const kind = mailboxKind(local);
  if (kind) return kind;
  const pieces = String(local || '').toLowerCase().split(/[^a-z]+/).filter(Boolean);
  if (pieces.some(piece => AVOID_PIECES.has(piece))) return 'avoid';
  return looksLikePersonLocal(local) && !pieces.some(piece => NOT_NAME_PIECES.has(piece)) ? 'person' : 'other';
}

// A local part that may be a person's own address: no mailbox word, no city.
function nameLikeLocal(local) {
  const pieces = String(local || '').toLowerCase().split(/[^a-z]+/).filter(Boolean);
  return Boolean(pieces.length) && !mailboxKind(local) && !pieces.some(piece => NOT_NAME_PIECES.has(piece));
}

// Inline tags a browser renders with no gap: "<strong>jobs</strong>@acme.io".
const INLINE_TAG_RE = /<\/?(?:span|strong|b|i|em|small|sup|sub|wbr|font)\b[^>]*>/gi;
const HAS_INLINE_TAG_RE = /<\/?(?:span|strong|b|i|em|small|sup|sub|wbr|font)\b/i;
// JSON-LD nodes whose email is the company's or one of its people's.
const ORG_NODE_RE = /(?:Organization|^Corporation|LocalBusiness|^Person)$/;

// "jobs [at] acme.io", a fullwidth at sign, "jobs @ acme.io" → "jobs@acme.io". A
// bare " at " or " dot " stays prose: "meet us at acme dot io" is no address.
function normalizeAddressText(text) {
  return String(text || '')
    .replace(/\uff20|&commat;/gi, '@')
    .replace(/\s*[[({]\s*(?:at|arobase|@)\s*[\])}]\s*/gi, '@')
    .replace(/\s*[[({]\s*(?:dot|point)\s*[\])}]\s*/gi, '.')
    .replace(/([a-z0-9._%+-])[ \t\u00a0]+@[ \t\u00a0]+(?=[a-z0-9])/gi, '$1@');
}

/** Addresses in JSON-LD: Organization email, contactPoint[].email, founder[] / employee[].email. */
function jsonLdEmails(raw) {
  const out = [];
  const add = (value, context) => {
    for (const item of [value].flat()) if (typeof item === 'string' && item.trim()) out.push({ text: item.trim().replace(/^mailto:/i, ''), context });
  };
  for (const block of raw.matchAll(JSON_LD_RE)) {
    let parsed;
    try { parsed = JSON.parse(block[1].trim()); } catch { continue; }
    for (const node of jsonLdNodes(parsed)) {
      const type = [node['@type']].flat().map(String).find(value => ORG_NODE_RE.test(value));
      if (!type) continue;
      add(node.email, `JSON-LD ${type}`);
      for (const point of [node.contactPoint].flat()) {
        if (!point || typeof point !== 'object') continue;
        const contactType = typeof point.contactType === 'string' ? ` (${point.contactType})` : '';
        add(point.email, `JSON-LD ${[point['@type']].flat()[0] || 'ContactPoint'}${contactType}`);
      }
      for (const key of ['founder', 'employee']) {
        for (const person of [node[key]].flat()) {
          if (person && typeof person === 'object') add(person.email, `JSON-LD ${key}${typeof person.name === 'string' ? ` ${person.name}` : ''}`);
        }
      }
    }
  }
  return out;
}

// The visible text of the <a> whose href holds the mailto: at `index`, or ''.
function mailtoAnchorText(raw, index) {
  const open = raw.lastIndexOf('<', index);
  if (open < 0 || !/^<a\s/i.test(raw.slice(open, open + 3)) || raw.slice(open, index).includes('>')) return '';
  const end = raw.indexOf('>', index);
  if (end < 0) return '';
  const rest = raw.slice(end + 1, end + 1 + 2000);
  const close = rest.search(/<\/a\s*>/i);
  return close >= 0 ? pageText(rest.slice(0, close)).replace(/\s+/g, ' ').trim() : '';
}

// Where an address sits in a text, matched without case; '' when absent.
function contextIn(text, email, lower = text.toLowerCase()) {
  const at = lower.indexOf(email);
  return at >= 0 ? text.slice(Math.max(0, at - 90), at + email.length + 60).replace(/\n/g, ' ') : '';
}

/**
 * Email addresses printed on a page (text, mailto:, "name [at] domain",
 * Cloudflare protection, JSON-LD), kept only on the company's own domain or
 * a sibling ccTLD printed on its own site (info@cosuno.de for cosuno.com).
 * Each carries the mailbox class and the text around it. `structured: false`
 * skips JSON-LD (a job board's own Organization block is not the employer).
 */
export function extractEmails(html, { domain = '', sourceUrl = '', structured = true } = {}) {
  const raw = preDecodeHtml(String(html || ''));
  const spaced = normalizeAddressText(pageText(raw));
  // Second reading with inline tags glued, for "<strong>jobs</strong>@acme.io".
  const glued = HAS_INLINE_TAG_RE.test(raw) ? normalizeAddressText(pageText(raw.replace(INLINE_TAG_RE, ''))) : '';
  const clean = value => String(value || '').toLowerCase().replace(/^[._-]+/, '');
  const candidates = [];
  const seenInText = new Set();
  const spacedLower = spaced.toLowerCase();
  for (const m of emailMatches(spaced)) {
    const email = clean(m[0]);
    seenInText.add(email);
    candidates.push({ email, context: contextIn(spaced, email, spacedLower) });
  }
  if (glued && glued !== spaced) {
    const gluedLower = glued.toLowerCase();
    const spacedFound = [...seenInText];
    for (const m of emailMatches(glued)) {
      const email = clean(m[0]);
      // Gluing must not grow a visible address ("Contact" + "jobs@acme.io").
      if (seenInText.has(email) || spacedFound.some(found => email.includes(found))) continue;
      seenInText.add(email);
      candidates.push({ email, context: contextIn(glued, email, gluedLower) });
    }
  }
  // mailto: links carry their own context (the text around the anchor). An
  // anchor whose visible text is another address shows the right one: the
  // href is a typo (Mindera: href pdpo@, text dpo@). JSON-LD is read below.
  const markup = raw.replace(JSON_LD_RE, ' ');
  for (const m of markup.matchAll(/mailto:([^"'?\s<>]+)/gi)) {
    let address = m[1];
    try { address = decodeURIComponent(address); } catch { /* keep raw */ }
    address = decodeEntities(address);
    const shown = mailtoAnchorText(markup, m.index);
    if (EMAIL_ONLY_RE.test(shown) && clean(shown) !== clean(address) && !seenInText.has(clean(address))) continue;
    const context = pageText(markup.slice(Math.max(0, m.index - 220), m.index + 260)).replace(/\n/g, ' ').trim();
    for (const hit of emailMatches(address)) candidates.push({ email: clean(hit[0]), context });
  }
  if (structured) {
    for (const item of jsonLdEmails(raw)) {
      for (const hit of emailMatches(item.text)) candidates.push({ email: clean(hit[0]), context: item.context });
    }
  }
  const want = String(domain || '').toLowerCase();
  let onSite = false;
  try { onSite = Boolean(want) && registrableDomain(new URL(sourceUrl).hostname) === want; } catch { onSite = false; }
  const out = new Map();
  for (const { email, context } of candidates) {
    if (out.has(email)) continue;
    const [local, host] = email.split('@');
    if (!local || !host || IMAGE_EXT_RE.test(email) || JUNK_LOCAL_RE.test(local) || JUNK_DOMAIN_RE.test(host)) continue;
    const emailDomain = registrableDomain(host);
    let detail = context;
    if (want && emailDomain !== want) {
      // The company's own site naming its other country domain: same first label.
      if (!onSite || !emailDomain || emailDomain.split('.')[0] !== want.split('.')[0]) continue;
      detail = `${context} (domaine voisin)`.trim();
    }
    if (!want && (WEBMAIL_RE.test(host) || isJobHost(host))) continue;
    out.set(email, { email, local, domain: emailDomain, kind: localKind(local), context: detail, sourceUrl });
  }
  return [...out.values()];
}

/**
 * "paul.martin" → { firstName: 'Paul', lastName: 'Martin' }; '' parts when the
 * local part is not a name ("human-resources", "office.manager", "compta.paris").
 */
export function nameFromLocal(local) {
  const m = String(local || '').toLowerCase().match(/^([a-z]{2,})[._-]([a-z]{2,})$/);
  if (!m || localKind(m[0]) !== 'person' || [m[1], m[2]].some(part => mailboxKind(part))) return { firstName: '', lastName: '' };
  const cap = word => word.charAt(0).toUpperCase() + word.slice(1);
  return { firstName: cap(m[1]), lastName: cap(m[2]) };
}

// ── Which pages of the site to read ─────────────────────────────────────────
// The page budget goes to one contact page, two team pages, the legal notice
// (an Impressum names the directors), one about page and one careers page,
// then privacy and press. A link is scored on its last path segment, then on
// its label when the label is short: a sentence that mentions "about" is not
// an about link, and /de/legal/stromkennzeichnung is not the legal notice.
const LABEL_WORDS = words => new RegExp(`(?<![\\p{L}\\p{N}])(?:${words})(?![\\p{L}\\p{N}])`, 'u');
const CRAWL_BUCKETS = [
  { name: 'contact', priority: 0, cap: 1,
    segment: /^(?:contacts?|contact-?us|contactez-nous|nous-contacter|kontakt|kontaktieren|contacto|contactanos|contatti|contattaci)$/,
    label: LABEL_WORDS('contact|contactez-nous|nous contacter|kontakt|contacto|contatti') },
  { name: 'team', priority: 1, cap: 2,
    segment: /^(?:team|teams|our-team|the-team|meet-the-team|equipe|l-equipe|notre-equipe|people|our-people|leadership|management|unser-team|das-team)$/,
    label: LABEL_WORDS('team|équipe|equipe|meet the|our people|leadership|management') },
  { name: 'legal', priority: 1, cap: 1,
    segment: /^(?:impressum|imprint|mentions-legales|mentions-legal|legal-notices?|legal-information|informations-legales|legal)$/,
    label: LABEL_WORDS('impressum|imprint|mentions légales|mentions legales|legal notice|legal') },
  { name: 'about', priority: 2, cap: 1,
    segment: /^(?:about|about-us|a-propos|qui-sommes-nous|who-we-are|ueber-uns|uber-uns|unternehmen|company|over-ons|chi-siamo|sobre-nosotros)$/,
    label: LABEL_WORDS('about|à propos|a propos|qui sommes-nous|über uns|ueber uns|who we are|unternehmen') },
  { name: 'careers', priority: 3, cap: 1,
    segment: /^(?:careers?|jobs?|karriere|recrutement|nous-rejoindre|rejoignez-nous|join-us|emploi|stellenangebote)$/,
    label: LABEL_WORDS('careers?|jobs?|karriere|recrutement|rejoindre|join us') },
  { name: 'privacy-press', priority: 4, cap: 2,
    segment: /^(?:privacy|privacy-policy|datenschutz|datenschutzerklaerung|confidentialite|politique-de-confidentialite|press|presse)$/,
    label: LABEL_WORDS('privacy|confidentialité|datenschutz|press|presse') },
];
const LOCALE_SEGMENT_RE = /^[a-z]{2}(?:[-_][a-z]{2,4})?$/i;
// Sections whose links are content, whatever their label says ("Structurer
// son équipe finance" is a blog post, "Team Recruitment" a product feature).
const CONTENT_SECTION_RE = /^(?:blogs?|news|insights?|insights-hub|articles?|posts?|stories|magazine|podcasts?|products?|features?|solutions?|services?|offers?|offres?|platform|pricing|resources?|guides?|docs|help|support|customers?|case-studies|cases|work|portfolio|projects?|use-cases|industries|events?|webinars?|academy|templates?)$/;
// Words a menu label may put before its term: "Our team", "Meet our team", "L'équipe".
const LABEL_LEAD_IN_RE = /^(?:our|the|meet|my|notre|nos|l['’]|la|le|les|unser|unsere|das|die|el|nuestro|nuestra|il|lo|het|de)$/;

// "Über-uns.html" → "uber-uns": decoded, lowercase, no accents, no extension.
function plainSegment(value) {
  let segment = String(value || '');
  try { segment = decodeURIComponent(segment); } catch { /* keep raw */ }
  return segment.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\.(?:html?|php|aspx?)$/, '');
}

/**
 * The crawl bucket of a link: its last path segment, else its label. A label
 * counts when it has 5 words or fewer and leads with the term, after lead-in
 * words at most ("Our team", "Meet the Genies", "Leadership & Management
 * Team"; not "Learn more about agentic commerce", "AI team acceleration"),
 * on a shallow path outside the content sections. Returns { bucket, viaLabel } or null.
 */
function crawlBucket(pathname, label = '') {
  const segments = String(pathname || '').split('/').filter(Boolean).map(plainSegment);
  const last = segments[segments.length - 1] || '';
  const bySegment = last ? CRAWL_BUCKETS.find(bucket => bucket.segment.test(last)) : null;
  if (bySegment) return { bucket: bySegment, viaLabel: false };
  const path = segments.length > 1 && LOCALE_SEGMENT_RE.test(segments[0]) ? segments.slice(1) : segments;
  if (!path.length || path.length > 2 || path.some(segment => CONTENT_SECTION_RE.test(segment))) return null;
  const text = String(typeof label === 'function' ? label() : label || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!text || text.split(' ').filter(word => /[\p{L}\p{N}]/u.test(word)).length > 5) return null;
  for (const bucket of CRAWL_BUCKETS) {
    const at = text.search(bucket.label);
    if (at < 0) continue;
    const before = text.slice(0, at).split(/\s+/).filter(Boolean);
    if (before.length <= 2 && before.every(word => LABEL_LEAD_IN_RE.test(word))) return { bucket, viaLabel: true };
  }
  return null;
}

/** The two-letter language of a page's <html lang>, or ''. */
export function htmlLang(html) {
  const m = String(html || '').match(/<html\b[^>]*?\slang\s*=\s*["']?([a-z]{2})(?![a-z])/i);
  return m ? m[1].toLowerCase() : '';
}

// "/fr" for https://acme.io/fr/…, '' when the first segment is no locale.
function localePrefix(url) {
  try {
    const first = new URL(url).pathname.split('/').filter(Boolean)[0] || '';
    return LOCALE_SEGMENT_RE.test(first) ? `/${first}` : '';
  } catch {
    return '';
  }
}

/**
 * Rank candidate URLs ({href, label}) into the crawl buckets: one per path
 * once its locale prefix is set aside (the home page's locale wins over
 * /en/x), each bucket capped, most useful first. Returns [{url, bucket}].
 */
function rankCrawlCandidates(candidates, baseUrl, { limit = 7, locale = '' } = {}) {
  let base;
  try { base = new URL(baseUrl); } catch { return []; }
  const baseDomain = registrableDomain(base.hostname);
  const baseHref = base.href.replace(/#.*$/, '').replace(/\/$/, '');
  const homeLocale = String(locale || '').slice(0, 2).toLowerCase() || localePrefix(base.href).slice(1, 3).toLowerCase();
  const byPath = new Map();
  candidates.forEach((candidate, index) => {
    const raw = decodeEntities(String(candidate.href || '')).trim();
    if (!raw || /^(?:mailto|tel|javascript|data):/i.test(raw) || raw.includes('@')) return;
    let url;
    try { url = new URL(raw, base); } catch { return; }
    if (!/^https?:$/.test(url.protocol) || registrableDomain(url.hostname) !== baseDomain) return;
    url.hash = '';
    const href = url.href.replace(/\/$/, '');
    // The home page (any locale) and Cloudflare's own paths are never a page to read.
    if (href === baseHref || /^\/(?:[a-z]{2}(?:[-_][a-z]{2,4})?\/?)?$/i.test(url.pathname) || /\/cdn-cgi\//i.test(url.pathname)) return;
    const hit = crawlBucket(url.pathname, candidate.label);
    if (!hit) return;
    const { bucket } = hit;
    const segments = url.pathname.split('/').filter(Boolean);
    const linkLocale = segments.length > 1 && LOCALE_SEGMENT_RE.test(segments[0]) ? segments[0].slice(0, 2).toLowerCase() : '';
    const rest = `/${(linkLocale ? segments.slice(1) : segments).join('/')}${url.search}`.toLowerCase();
    const entry = {
      url: href,
      bucket: bucket.name,
      priority: bucket.priority,
      order: CRAWL_BUCKETS.indexOf(bucket),
      localeRank: homeLocale && linkLocale === homeLocale ? 0 : linkLocale ? 2 : 1,
      // A path that says what the page is beats a label pointing elsewhere.
      viaLabel: hit.viaLabel ? 1 : 0,
      // The legal notice itself before a /legal index page.
      generic: bucket.name === 'legal' && plainSegment(segments[segments.length - 1]) === 'legal' ? 1 : 0,
      // Careers: the shortest path, never its /jobs/<category> children.
      length: bucket.name === 'careers' ? url.pathname.length : 0,
      index,
    };
    const prev = byPath.get(rest);
    if (!prev || entry.localeRank < prev.localeRank) byPath.set(rest, entry);
  });
  const ranked = [...byPath.values()].sort((a, b) => a.priority - b.priority || a.order - b.order || a.localeRank - b.localeRank
    || a.viaLabel - b.viaLabel || a.generic - b.generic || a.length - b.length || a.index - b.index);
  const used = new Map();
  const out = [];
  for (const entry of ranked) {
    if (out.length >= limit) break;
    const taken = used.get(entry.bucket) || 0;
    if (taken >= CRAWL_BUCKETS[entry.order].cap) continue;
    used.set(entry.bucket, taken + 1);
    out.push({ url: entry.url, bucket: entry.bucket });
  }
  return out;
}

// Links of a page as crawl candidates: the opening <a …href> tag, the label
// read lazily from at most 2000 characters up to </a>. Each opening tag is
// cut at its own end (or the next "<") before its href is read: one pattern
// over the whole tag went cubic on a page of unclosed "<a href=" (20 KB, 8.7 s).
function crawlCandidatesFromHtml(html, baseUrl, { limit = 7, locale = '' } = {}) {
  const raw = String(html || '');
  const candidates = [];
  for (const m of raw.matchAll(/<a\s[^<>]{0,4000}>/gi)) {
    const href = m[0].match(/\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i);
    if (!href) continue;
    const end = m.index + m[0].length;
    candidates.push({
      href: href[1] ?? href[2] ?? href[3] ?? '',
      label: () => {
        const rest = raw.slice(end, end + 2000);
        const close = rest.search(/<\/a\s*>/i);
        return close >= 0 ? pageText(rest.slice(0, close)) : '';
      },
    });
  }
  return rankCrawlCandidates(candidates, baseUrl, { limit, locale: locale || htmlLang(raw) });
}

/**
 * Internal links worth reading for contacts: contact, team, legal notice,
 * about, careers, then privacy and press. Returns absolute URLs, most useful
 * first.
 */
export function pickCrawlLinks(html, baseUrl, { limit = 7, locale = '' } = {}) {
  return crawlCandidatesFromHtml(html, baseUrl, { limit, locale }).map(item => item.url);
}

/** Bucketed page URLs listed in a sitemap (the <loc> entries). */
export function pickSitemapLinks(xml, baseUrl, { limit = 7, locale = '' } = {}) {
  return rankCrawlCandidates(sitemapLocs(xml).map(href => ({ href, label: '' })), baseUrl, { limit, locale }).map(item => item.url);
}

function sitemapLocs(xml) {
  return [...String(xml || '').matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\s\]]+)\s*(?:\]\]>)?\s*<\/loc>/gi)].map(m => decodeEntities(m[1]));
}

/** Default paths to try when the home page links fewer than 3 useful pages. */
export function defaultCrawlPaths(language = 'en') {
  const fr = ['/contact', '/a-propos', '/equipe', '/mentions-legales', '/nous-rejoindre', '/recrutement', '/about', '/team', '/careers', '/jobs', '/legal', '/privacy', '/presse'];
  const de = ['/impressum', '/kontakt', '/ueber-uns', '/team', '/karriere', '/datenschutz', '/presse'];
  const en = ['/contact', '/contact-us', '/about', '/about-us', '/team', '/company', '/careers', '/jobs', '/legal', '/imprint', '/impressum', '/privacy', '/press'];
  return language === 'fr' ? fr : language === 'de' ? de : en;
}

// ── Named people on company pages (legal notices, team pages) ───────────────
// A name is matched case-sensitively (NAME has no i flag, so "an der
// strategischen" is no person). Label and title words match in any casing
// through caseless(), which spells each letter as [xX] in the same u regex.

/**
 * A regex source whose letters match in either case. Escapes (\s, \p{L})
 * are kept as they are; a class gains the other case of its letters. No
 * ranges in the source.
 */
function caseless(source) {
  let out = '';
  let inClass = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '\\') {
      const escape = source.slice(i).match(/^\\[pPu]\{[^}]*\}|^\\[\s\S]/)[0];
      out += escape;
      i += escape.length - 1;
      continue;
    }
    const lower = ch.toLowerCase();
    const upper = ch.toUpperCase();
    const other = ch === lower ? upper : lower;
    const cased = /\p{L}/u.test(ch) && other !== ch && other.length === 1;
    if (inClass) {
      if (ch === ']') inClass = false;
      out += cased ? ch + other : ch;
    } else if (ch === '[') {
      inClass = true;
      out += ch;
    } else {
      out += cased ? `[${lower}${upper}]` : ch;
    }
  }
  return out;
}

const NAME_WORD = '\\p{Lu}[\\p{L}\'’-]+';
const NAME_PARTICLE = '(?:de|du|des|van|von|der|den|da|di|le|la)';
// A capitalised word, up to two particles, then one or two capitalised words:
// "Maxine von Grumbkow", "Jean de La Fontaine", "Madeleine Le Sergent".
const NAME = `(${NAME_WORD}(?:\\s+${NAME_PARTICLE}){0,2}(?:\\s+${NAME_WORD}){1,2})`;
// Shortest first, so a capitalised title word after the name stays in the title.
const NAME_SHORT = `(${NAME_WORD}(?:\\s+${NAME_PARTICLE}){0,2}(?:\\s+${NAME_WORD}){1,2}?)`;
// Bounded: an unbounded repeat makes the unanchored patterns quadratic on a run of "Mr Mr Mr…".
const HONORIFIC = '(?:(?:M\\.|Mme\\.|Mlle\\.|Mr\\.|Mrs\\.|Ms\\.|Dr\\.|Prof\\.)\\s*|(?:Mme|Mlle|Mr|Mrs|Ms|Monsieur|Madame|Mademoiselle|Herr|Frau|Dr|Prof)\\s+){0,3}';

// Job-title heads shared by the three passes. Acronyms are upper case only
// ("cto" in a sentence is no title); the words match in any casing.
const TITLE_ACRONYM = '(?:Co-)?(?:CEO|CTO|CPO|COO|CFO|CRO|CMO|CHRO|CDO|CIO)|S?VP|EVP|DRH|HR\\s+\\p{L}+';
const TITLE_WORD = caseless([
  'co[- ]?founder', 'founder', 'co[- ]?fondat(?:eur|rice)', 'fondat(?:eur|rice)',
  'chief\\s+\\p{L}+(?:\\s+\\p{L}+)?\\s+officer', 'head\\s+of\\s+\\p{L}+', 'vice[- ]president',
  'managing\\s+directors?', 'directors?', 'directeur', 'directrice', 'pr[ée]sident(?:e)?',
  'gesch[äa]ftsf[üu]hrer(?:in)?', 'vorstand',
  'talent\\s+acquisition(?:\\s+\\p{L}+)?', 'talent\\s+partner', 'recruiter', 'recruiting\\s+\\p{L}+',
  // "Responsable du traitement" is the GDPR data controller, not a job.
  'people\\s+(?:ops|operations|partner)', 'charg[ée]e?\\s+de\\s+recrutement', 'responsable\\s+(?!d[eu]s?\\s+traitement)\\p{L}+',
  'lead\\s+\\p{L}+', '\\p{L}+\\s+lead', '\\p{L}+\\s+manager',
].join('|'));
const TITLE_HEAD = `(?:${TITLE_ACRONYM}|${TITLE_WORD})(?![\\p{L}])`;
// Titles strong enough to stand before a dash ("CEO – Anna Schmidt"); "Team
// Lead - Enterprise Delivery" is a job listing.
const STRONG_HEAD = `(?:(?:Co-)?(?:CEO|CTO|CPO|COO|CFO|CRO|CMO|CHRO)|${caseless('co[- ]?founder|founder|co[- ]?fondat(?:eur|rice)|fondat(?:eur|rice)')})(?![\\p{L}])`;
// Up to two words before the head ("Senior Recruiter", "Global Head of
// People"), never a conjunction; the rest stops at a sentence or a dash.
const TITLE_PREFIX = '(?:(?!(?:and|et|und|or|ou|with|avec|mit)\\s)[\\p{L}&/\'’.-]+\\s+){0,2}?';
const TITLE_REST = '(?:(?!\\s-\\s)[^.;:@|!?()\\n·•–—]){0,70}';
const IS_OUR = '(?:(?:is|est|ist)\\s+)?(?:(?:our|the|notre|unser|unsere|unserer|le|la)\\s+|l[\'’])?';
const TITLE_START_RE = new RegExp(`^${TITLE_HEAD}`, 'u');
const TITLE_LINE_RE = new RegExp(`^${TITLE_PREFIX}${TITLE_HEAD}[^!?]*$`, 'u');
const NAME_LINE_RE = new RegExp(`^${HONORIFIC}${NAME}$`, 'u');
const NAME_THEN_PROSE_RE = new RegExp(`^${HONORIFIC}${NAME}(?=\\s+[\\p{Ll}\\d])`, 'u');
// "Claire Martin, Head of Design", "Anna Schmidt – Recruiter", "Paul is our CTO".
// Groups: name, the words before the head, the title from its head.
const NAME_THEN_TITLE_RE = new RegExp(`(?<![\\p{L}'’-])${HONORIFIC}${NAME_SHORT}(?:\\s*,\\s*|\\s+[-–—|·•]\\s+|\\s*:\\s+|\\s+(?=(?:is|est|ist)\\s))${IS_OUR}(${TITLE_PREFIX})(${TITLE_HEAD}${TITLE_REST})`, 'gu');
// "Philipp Schröder Co-Founder & Chief Executive Officer": a short line, no separator.
const NAME_TITLE_LINE_RE = new RegExp(`^${HONORIFIC}${NAME_SHORT}\\s+(${TITLE_HEAD}${TITLE_REST})$`, 'u');
// "CTO: Paul Lemaire", "Head of Design : Claire Martin", "CEO – Anna Schmidt".
const TITLE_THEN_NAME_RE = new RegExp(`(?<![\\p{L}])(?:(${TITLE_HEAD}(?:\\s+[\\p{L}&/'’-]+){0,3}?)\\s*[:：]|(${STRONG_HEAD}(?:\\s+(?:&|and|et)\\s+${STRONG_HEAD})?)\\s+[-–—])\\s*${HONORIFIC}${NAME}(?=\\s*(?:$|[,;.|()–—]|\\s-\\s|\\s(?:et|and|und|&)\\s|\\s+\\p{Lu}[\\p{L}'’-]+\\s*[:：]))`, 'gu');
// Words that may come before a title's head on a "Name, Title" line: a
// level or a field ("Senior", "Customer Success Manager"); "Market
// Intelligence, App Review Manager" is a product list.
const TITLE_QUALIFIER = new Set(['senior', 'sr', 'junior', 'jr', 'lead', 'principal', 'staff', 'chief', 'global', 'regional', 'local', 'interim', 'acting', 'deputy', 'associate', 'assistant', 'executive', 'general', 'group', 'country', 'area', 'strategic', 'technical', 'founding', 'new', 'key', 'account', 'office', 'team', 'ux', 'ui', 'nouveau', 'nouvelle', 'adjoint', 'adjointe']);
// A testimonial's attribution: the line after a closing quote, or one that
// opens with a quote or a dash.
const QUOTE_END_RE = /[»”"]\s*$/;
const QUOTE_START_RE = /^\s*[«“"—–]/;

// Legal headings that name the company's officers (Impressum, mentions
// légales). A label alone on its line takes the names on the next lines.
const LEGAL_LABELS = [
  { re: 'directeur(?:·?trice|·e)?\\s+de\\s+(?:la\\s+)?publication|directrice\\s+de\\s+(?:la\\s+)?publication|responsable\\s+de\\s+(?:la\\s+)?publication|publication\\s+director|director\\s+of\\s+(?:the\\s+)?publication|editor[- ]in[- ]chief' },
  // "représentée par son Président, M. Jean Dupont": a comma may end the label.
  { re: 'repr[ée]sent[ée]e?s?\\s+(?:l[ée]galement\\s+)?par(?:\\s+(?:son|sa|ses)\\s+(?:pr[ée]sident(?:e)?|g[ée]rant(?:e)?|directeur\\s+g[ée]n[ée]ral)s?)?|legal\\s+representatives?|represented\\s+by', title: 'Représentant légal', comma: true },
  { re: 'vertreten\\s+durch\\s+(?:den|die)\\s+gesch[äa]ftsf[üu]hrer(?:innen|in)?', title: 'Geschäftsführer' },
  { re: 'vertreten\\s+durch', title: 'Représentant légal' },
  { re: 'gesch[äa]ftsf[üu]hr(?:er:innen|erinnen|erin|er|ung)|gesch[äa]ftsf[üu]hrende\\s+gesellschafter(?:in)?', title: 'Geschäftsführer' },
  { re: 'vorstand(?:svorsitzender?)?', title: 'Vorstand' },
  { re: 'managing\\s+directors?', title: 'Managing Director' },
  // "Président" in a sentence is no heading: these need a colon or a dash.
  { re: 'pr[ée]sident(?:e)?|g[ée]rant(?:e)?|directeur\\s+g[ée]n[ée]ral|directrice\\s+g[ée]n[ée]rale', separator: true },
].map(label => ({
  ...label,
  inline: new RegExp(`(?<![\\p{L}])(${caseless(label.re)})(?![\\p{L}])${label.separator ? '\\s*[:：–—-]\\s*' : `(?:\\s*[:：${label.comma ? ',' : ''}–—-]\\s*|\\s+)`}`, 'gu'),
  heading: new RegExp(`^(${caseless(label.re)})\\s*[:：]?$`, 'u'),
}));

const NOT_A_NAME = /^(?:Mentions|Legal|Notice|Contact|Site|Societe|Société|Company|Hébergeur|Hebergeur|Editeur|Éditeur|Siège|Siege|Capital|Adresse|Paris|France|Europe|Directeur|Directrice|Director|Responsable|Président|Gérant|Service|Client|Support|Data|Protection|Privacy|Policy|Politique|Terms|Conditions|Cookie|Cookies|Email|Mail|Tel|Téléphone|Telephone|Fax|SAS|SASU|SARL|EURL|SA|AG|KG|SE|UG|GbR|OHG|BV|NV|LLC|PLC|Inc|Ltd|GmbH|Corp|Group|Groupe|Holding|OVH|AWS|Google|Amazon|Microsoft|Cloud|Web|Services|Head|Lead|Chief|Officer|Vice|VP|Senior|Junior|Product|Design|Engineering|Engineer|Marketing|Sales|People|Talent|Manager|Principal|Partner|Associate|Consultant|Advisor|Specialist|Founder|Cofounder|Co-founder|Fondateur|Fondatrice|Cofondateur|Cofondatrice|Team|Teams|Leadership|Management|Board|Equipe|Équipe|Software|Architect|Report|Streamline|Front|App|Gérer|Learn|Discover|Vorstand|Aufsichtsrat|Geschäftsführer|Geschäftsführerin|Geschäftsführung|Impressum|Imprint|Managing|Directors|Executive|Représentant|Représentante|Présidente|Gérante|Publication|CEO|CTO|CPO|COO|CFO|CRO|CMO|CHRO|CDO|CIO|SVP|EVP|DRH|HR|RH|PDG|DG|Customer|Customers|Success|Studies|Study|Press|Presse|Pricing|Careers|Carrières|Blog|News|Newsroom|Resources|Ressources|Solutions|Features|Platform|Partners|Partenaires|Partnerships|Investors|Events|Webinars|Community|Help|Demo|Overview|Integrations|Enterprise|Industries|Developers|Insights|Operations|Finance|Revenue|Growth|Generation|Analytics|Relations|Experience|Culture|Values|Benefits|Openings|Clients|Produit|Produits|Tarifs|Accueil|Actualités|Témoignages|Recrutement)$/i;

function properCase(word) {
  return word.split(/([-'’])/).map(part => (/^[-'’]$/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())).join('');
}

/**
 * "Marie Dupont" → first/last. Rejects initials ("Ben N.", "A. Dylan"),
 * digits, role words and anything that is not two to four name words.
 */
const LEAD_IN_WORD = /^(?:meet|contact|say|hello|hi|welcome|introducing|presenting|with|from|our|about|join|ask|email|call|by|and|or|the|dear|chez|rencontrez|contactez|découvrez|decouvrez|discover|écrivez|ecrivez|écrire|ecrire|kontakt|kontaktieren|treffen|avec|par|notre|votre|bonjour|voici)$/i;
const HONORIFIC_WORD = /^(?:m\.|mme\.?|mlle\.?|mr\.?|mrs\.?|ms\.?|monsieur|madame|mademoiselle|herr|frau|dr\.?|prof\.?)$/i;

// "Hi, I'm Grigory, CTO", "je suis Marie", "ich bin Jonas": the name is
// what follows ("I'm Grigory" was a first and a last name).
const SELF_INTRO_WORD = /^i['’]?m$/i;
const SELF_INTRO_PAIR = /^(?:i am|je suis|ich bin)$/i;
// "Grigory's", "We're": a contraction is no name word ("O'Neil", "D'Arcy" are).
const CONTRACTION_RE = /['’](?:m|s|re|ve|ll|d)$/i;
// Words of a posting's field labels ("Reports To:", "Interview Process:",
// "Next Steps:", "Start Date:", "Job Family:"): no name is made of them.
// "To", "Line" and "Job" stay out: Johnnie To, Line Nielsen, Job Cohen.
const FIELD_LABEL_WORD = /^(?:reports|reporting|process|steps|next|interview|interviews|hiring|selection|recruitment|start|date|working|hours|location|type|level|status|department|stage|family|category|title|employment|contract|schedule|deadline|closing|posted)$/i;

function splitName(full) {
  const words = String(full || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  // "Meet Claire Martin" → "Claire Martin"; "Découvrez Alex" leaves one word: no name.
  for (;;) {
    if (words.length && (LEAD_IN_WORD.test(words[0]) || HONORIFIC_WORD.test(words[0]) || SELF_INTRO_WORD.test(words[0]))) words.shift();
    else if (words.length > 1 && SELF_INTRO_PAIR.test(`${words[0]} ${words[1]}`)) words.splice(0, 2);
    else break;
  }
  if (words.length < 2 || words.length > 4) return null;
  if (words.some(word => NOT_A_NAME.test(word) || FIELD_LABEL_WORD.test(word) || /\d/.test(word) || /^\p{L}\.?$/u.test(word) || /\.$/.test(word) || !/^\p{L}[\p{L}'’-]*$/u.test(word) || CONTRACTION_RE.test(word))) return null;
  // A particle inside the name stays lower case ("Jean de La Fontaine").
  const named = words.map((word, index) => (index > 0 && index < words.length - 1 && SURNAME_PARTICLES.has(word) ? word
    : word === word.toLowerCase() || word === word.toUpperCase() ? properCase(word) : word));
  return { firstName: named[0], lastName: named.slice(1).join(' ') };
}

// inferPersona misses "Cofondateur", the German titles of a company's head
// and the C-level acronyms it does not list (CFO, CRO, CHRO).
function personaFor(title) {
  const persona = inferPersona({ title });
  if (persona !== 'unknown') return persona;
  const text = String(title || '');
  if (/(?<![\p{L}])CHRO(?![\p{L}])/u.test(text)) return 'recruiter';
  // A German HR team named in a posting ("Personalabteilung", "Personalreferentin").
  if (/(?<![\p{L}])personal(?:abteilung|referent(?:in)?|leiter(?:in)?|leitung|wesen|team|management|entwicklung)(?![\p{L}])/iu.test(text)) return 'recruiter';
  return /co-?fondat|gr[üu]nder|gesch[äa]ftsf[üu]hr|vorstand|inhaber|(?<![\p{L}])(?:CFO|CRO|CDO|CIO|PDG|DG)(?![\p{L}])/iu.test(text) ? 'founder' : persona;
}

/**
 * "Benoit Cofondateur", "Romain Training": a model that split a title into a
 * surname. True when the last name is a title word or appears in the title.
 */
function lastNameIsTitle(lastName, title = '') {
  const last = String(lastName || '').trim();
  if (!last) return false;
  const words = last.split(/\s+/);
  if (TITLE_START_RE.test(last) || words.some(word => NOT_A_NAME.test(word))) return true;
  const inTitle = new Set(String(title || '').toLowerCase().split(/[^\p{L}'’-]+/u).filter(Boolean));
  return words.some(word => word.length > 2 && !SURNAME_PARTICLES.has(word.toLowerCase()) && inTitle.has(word.toLowerCase()));
}

/**
 * Does a LinkedIn title part name THIS company? Exact after normalisation
 * ("Riot" ≠ "Riot Games", "Acme Labs SAS" = "Acme Labs"), or the site's own
 * domain word ("tryriot"). Loose substring matching sent every Riot Games
 * employee to a cybersecurity startup called Riot.
 */
export function companyPartMatches(part, company, domain = '') {
  const norm = value => companyTokens(value).join(' ');
  const raw = String(part || '').trim();
  const a = norm(raw);
  const b = norm(company);
  if (!a || !b) return false;
  const core = String(domain || '').toLowerCase().split('.')[0].replace(/-/g, '');
  if (core.length >= 5 && a.replace(/\s/g, '').includes(core)) return true;
  // A search engine cut the title ("… - Riot ..."): the company may well be
  // "Riot Games". Unknown is not a match.
  if (/(?:\.\.\.|…)\s*$/.test(raw)) return false;
  if (a === b) return true;
  // "Acme Labs" ↔ "Acme Labs Inc" survives tokenisation; "Riot" ↔ "Riot Games" does not.
  const ta = a.split(' ');
  const tb = b.split(' ');
  return tb.length >= 2 && tb.every(token => ta.includes(token)) && ta.length <= tb.length + 1;
}

// Pages that list a team: the path or the menu label says so.
const TEAM_LIKE_SEGMENT_RE = /(?:^|-)(?:team|teams|equipe|people|leadership|management|founders?|meet)(?:-|$)|^(?:ueber-uns|uber-uns|who-we-are)$/;
const TEAM_LIKE_LABEL_RE = /(?<![\p{L}])(?:team|équipe|equipe|people|leadership|management|founders?|fondateurs?|who we are|über uns|ueber uns|meet)(?![\p{L}])/iu;

/** Does a page read like a team page by its URL path (outside blog and product sections) or its link label? */
export function isTeamLikePage(url = '', label = '') {
  let segments = [];
  try { segments = new URL(url).pathname.split('/').filter(Boolean).map(plainSegment); } catch { segments = []; }
  if (!segments.some(segment => CONTENT_SECTION_RE.test(segment)) && segments.some(segment => TEAM_LIKE_SEGMENT_RE.test(segment))) return true;
  return TEAM_LIKE_LABEL_RE.test(String(label || ''));
}

// Words a title may end with after a comma that name no company: a team,
// a region, a field ("Co-CEO, Customer Journey", "Director, Engineering").
const TITLE_TAIL_WORD = new Set(['engineering', 'product', 'products', 'design', 'marketing', 'sales', 'operations', 'ops', 'customer', 'customers', 'journey', 'success', 'experience', 'care', 'support', 'growth', 'people', 'culture', 'talent', 'finance', 'financial', 'data', 'tech', 'technology', 'technical', 'research', 'brand', 'content', 'partnerships', 'partners', 'strategy', 'revenue', 'business', 'development', 'innovation', 'security', 'legal', 'compliance', 'hr', 'rh', 'it', 'ai', 'ml', 'platform', 'infrastructure', 'analytics', 'communications', 'communication', 'commercial', 'digital', 'international', 'global', 'regional', 'interim', 'emea', 'apac', 'amer', 'americas', 'america', 'latam', 'europe', 'france', 'germany', 'dach', 'uk', 'us', 'usa', 'nordics', 'benelux', 'japan', 'asia', 'africa', 'north', 'south', 'east', 'west', 'central', 'and', 'of', 'the', 'et', 'de', 'des', 'du', 'la', 'le', 'produit', 'ingénierie', 'ventes', 'opérations', 'finances', 'données', 'recrutement', 'juridique', 'partenariats', 'croissance', 'clients', 'client', 'ressources', 'humaines']);

// A heading over a list of cards that says it lists the team.
const TEAM_HEADING_RE = /(?<![\p{L}])(?:team|teams|équipe|equipe|leadership|management|founders?|fondateurs?|direction|dirigeante?s?|associés|vorstand|geschäftsführung|our people|board)(?![\p{L}])/iu;

/** Does a title place its holder at this company ("CEO, Dataiku", "CTO chez AppTweak")? */
function jobTitleNamesCompany(title, { company = '', domain = '' } = {}) {
  const text = String(title || '');
  const at = text.match(/\s(?:at|chez|bei|@)\s+(.+)$/iu);
  if (at && companyPartMatches(at[1], company, domain)) return true;
  return text.split(/\s*,\s*/).slice(1).some(part => companyPartMatches(part, company, domain));
}

// Company-level titles an "of" / "de" / "von" tail ties to an organisation.
const ORG_HEAD = `(?:(?:Co-)?(?:CEO|CTO|CPO|COO|CFO|CRO|CMO|CHRO)|${caseless('co[- ]?founder|founder|co[- ]?fondat(?:eur|rice)|cofondat(?:eur|rice)|fondat(?:eur|rice)|chief\\s+\\p{L}+(?:\\s+\\p{L}+)?\\s+officer|(?<!vice[- ])pr[ée]sident(?:e)?|(?<!vice[- ])chair(?:man|woman|person)?|owner|managing\\s+director|managing\\s+partner|directeur\\s+g[ée]n[ée]ral|directrice\\s+g[ée]n[ée]rale|g[ée]rant(?:e)?|gesch[äa]ftsf[üu]hrer(?:in)?|gr[üu]nder(?:in)?')})(?![\\p{L}])`;
const ORG_TAIL_RE = new RegExp(`^(.*?${ORG_HEAD})\\s+(?:(?:of|de|du|des|von|der)(?![\\p{L}])|d['’])\\s*(.+)$`, 'u');

function namesAnotherOrg(tail) {
  const text = String(tail || '').trim();
  if (!/^\p{Lu}/u.test(text) || TITLE_START_RE.test(text)) return false;
  return !text.toLowerCase().split(/[\s&/,]+/).filter(Boolean).every(word => TITLE_TAIL_WORD.has(word));
}

// A step of the hiring process or a scheduling note read as a title: an
// arrow, "availability", "to (be) confirmed", or a title ending in
// interview, screen or call ("Interview Coordinator" stays a job).
const PROCESS_STEP_RE = /[→⇒➔➜]|->|(?<![\p{L}])(?:availability|disponibilit[ée]s?|to\s+(?:be\s+)?confirm(?:ed)?|tbc|tbd)(?![\p{L}])|(?<![\p{L}])(?:interviews?|screen(?:ing)?|calls?)$/iu;

/**
 * The title kept for a name found on a page, or '' to drop the candidate: a
 * title that names another organisation ("Founder, Late Checkout", "HR
 * Manager at UGC") is a testimonial; a "name" that is the company is none.
 * A tail naming this company is cut off.
 */
function titleForCandidate(name, title, { company = '', domain = '' } = {}) {
  let clean = String(title || '').replace(/\s+/g, ' ').replace(/[\s,:&–—-]+$/, '').trim();
  // "CIO Edition 2026", "… with 20+ years": no job title carries a number.
  // "Former CFO of Mimecast" is a board member's past job elsewhere.
  if (!clean || /\d{2}/.test(clean) || /^(?:former|ex-|ancien(?:ne)?\s)/i.test(clean)) return '';
  // "Recruiter Screen → Portfolio Review", "Hiring Manager Interview",
  // "Talent Partner to confirm": a hiring step or a note, nobody's job.
  if (PROCESS_STEP_RE.test(clean)) return '';
  const full = companyTokens(`${name.firstName} ${name.lastName}`).join(' ');
  if (full && full === companyTokens(company).join(' ')) return '';
  // "Co-founder du restaurant Adela": a customer's business.
  if (/\s(?:du|de\s+la|de\s+l['’]|de\s+l’)\s*(?:restaurant|cabinet|groupe|magasin|boutique|soci[ée]t[ée]|salon|agence|start-?up|entreprise)\s+\p{Lu}/iu.test(clean)) return '';
  const at = clean.match(/^(.+?)\s+(?:at|chez|bei|@)\s+(.+)$/iu);
  if (at) {
    if (!companyPartMatches(at[2], company, domain)) return '';
    clean = at[1].trim();
  }
  // "Founder of Globex", "CEO of Initech", "fondateur de BlaBlaCar": a
  // company-level title tied to another organisation is an advisor's or an
  // investor's. "Head of Engineering" and "VP of Sales" name a team.
  const of = clean.match(ORG_TAIL_RE);
  if (of && namesAnotherOrg(of[2])) {
    if (!companyPartMatches(of[2], company, domain)) return '';
    clean = of[1].trim();
  }
  // Every comma part after the first: a field or a region, or this company.
  const parts = clean.split(/\s*,\s*/);
  const kept = [parts[0]];
  for (const part of parts.slice(1)) {
    if (!namesAnotherOrg(part)) kept.push(part);
    else if (!companyPartMatches(part, company, domain)) return '';
  }
  return kept.join(', ').slice(0, 80);
}

// "Dr. Andreas Zollmann, Johannes Zollmann", "Stefan Münter und Thomas Heiserowski".
const LIST_HONORIFIC_RE = /^(?:(?:M|Mme|Mlle|Mr|Mrs|Ms|Dr|Prof)\.\s*|(?:Mme|Mlle|Mr|Mrs|Ms|Monsieur|Madame|Mademoiselle|Herr|Frau|Dr|Prof)\s+)+/u;

/**
 * Names listed after a legal label: split on commas and und/and/et/&, each
 * part a whole name (honorifics aside). The list ends at a bracket, a dash,
 * a semicolon or the next "Label:". Lenient: names up to the first part that
 * is none ("Madame Noémie Parker, Présidente"). Returns { names, complete }.
 */
function namesFromList(text) {
  const rest = String(text || '').split(/\s*[;|(]|\s[-–—]\s|\s(?=\p{Lu}[\p{L}'’-]+\s*[:：])/u)[0];
  const parts = rest.split(/\s*,\s*|\s+(?:und|and|et|&)\s+/).map(part => part.replace(LIST_HONORIFIC_RE, '').trim()).filter(Boolean);
  const names = [];
  for (const part of parts) {
    const m = part.match(NAME_LINE_RE);
    const name = m ? splitName(m[1]) : null;
    if (!name) {
      // "Geschäftsführer Max Mustermann sagt …": a name the sentence goes on after.
      const lead = part.match(NAME_THEN_PROSE_RE);
      const prefix = lead ? splitName(lead[1]) : null;
      if (prefix) names.push(prefix);
      return { names, complete: false };
    }
    names.push(name);
  }
  return { names, complete: names.length > 0 };
}

/**
 * Card pairs: a line that is only a name with a title line of 80 characters
 * or fewer, below it ("David Bernard" / "CEO & Founder") or, on a page that
 * prints titles first, above it ("CEO" / "Jean Dupont"). The layout is read
 * from the page: titles first only when that reading pairs more cards
 * (reading names first there gave each person the next one's title and
 * dropped the last); on a tie names first, the common layout ("Directors"
 * over name-first cards pairs as many both ways). Returns [{ index, name,
 * title }] for the candidates that survive the guards; index is the card's
 * first line.
 */
function cardPairs(lines, guard) {
  const scan = (titleFirst) => {
    const pairs = [];
    for (let i = 0; i + 1 < lines.length; i += 1) {
      const titleLine = lines[titleFirst ? i : i + 1];
      if (!titleLine || titleLine.length > 80 || /[.!?]$/.test(titleLine) || !TITLE_LINE_RE.test(titleLine)) continue;
      const m = lines[titleFirst ? i + 1 : i].match(NAME_LINE_RE);
      if (!m) continue;
      const name = splitName(m[1]);
      const title = name ? titleForCandidate(name, titleLine, guard) : '';
      // After a closing quote: a testimonial's attribution, not a card, unless
      // the title names this company.
      if (title && (!QUOTE_END_RE.test(lines[i - 1] || '') || jobTitleNamesCompany(titleLine, guard))) pairs.push({ index: i, name, title });
      i += 1;
    }
    return pairs;
  };
  const below = scan(false);
  const above = scan(true);
  return above.length > below.length ? above : below;
}

// One page lists at most this many people; past PAGE_PEOPLE_FOCUS, only
// those who hire, lead or found (or lead this role's team) are kept,
// recruiters and the role's leads first (a staff page is often A to Z: the
// Talent Acquisition Specialist may come last). Page order is kept.
const PAGE_PEOPLE_MAX = 40;
const PAGE_PEOPLE_FOCUS = 20;

/**
 * Does a title hold one of roleLeadTitles(role), as whole words and with
 * "of" aside ("VP of Product" holds "VP Product"; "Director" no longer
 * holds "CTO")? "Chief Technical Officer" counts as CTO, "Chief Product
 * Officer" as CPO.
 */
function leadsRoleTeam(title, leads = []) {
  const lower = String(title || '').toLowerCase();
  const plain = value => ` ${String(value || '').toLowerCase().replace(/[^\p{L}\p{N}&]+/gu, ' ').replace(/\s(?:of|the)(?=\s)/g, ' ').replace(/\s+/g, ' ').trim()} `;
  const text = plain(lower);
  const acronyms = [...lower.matchAll(/(?<![\p{L}])chief\s+(\p{L})\p{L}*(?:\s+\p{L}+)?\s+officer/gu)].map(m => `c${m[1]}o`);
  return leads.some(lead => {
    const wanted = plain(lead);
    return (wanted.trim() && text.includes(wanted)) || acronyms.includes(String(lead).toLowerCase());
  });
}

// Departments a manager may lead besides this role's team: a "Head of Global
// Partnerships", a "Strategic Account Manager" or a "VP Marketing" is no
// lead for a designer (RoomPriceGenie's best contact was the first).
const OTHER_TEAM_RE = /(?<![\p{L}])(sales|partnerships?|partners?|alliances|accounts?|business development|revenue|customer success|customer support|customer care|customer service|customer experience|support|finance|financial|accounting|controlling|treasury|marketing|growth|communications?|community|events?|office|legal|compliance|procurement|purchasing|facilities|administration|payroll|investor relations|public relations)(?![\p{L}])/giu;
// roleLeadTitles' answer for a role it cannot place: any head, director or VP.
const GENERIC_LEAD_TITLES = new Set(['head of', 'director', 'vp']);

/** Does a title lead a department this role does not belong to (its name and lead titles say)? */
function leadsOtherTeam(title, { leads = [], role = '' } = {}) {
  const own = `${role} ${leads.join(' ')}`.toLowerCase();
  const words = [...String(title || '').toLowerCase().matchAll(OTHER_TEAM_RE)].map(m => m[1].replace(/s$/, ''));
  return words.length > 0 && !words.some(word => own.includes(word));
}

/** The leads of a role's team: roleLeadTitles, plus product's heads for a designer (a startup's design team often reports to product). */
function teamLeadTitles(role = '') {
  const leads = roleLeadTitles(role);
  return DESIGN_ROLE_RE.test(String(role || '').toLowerCase()) ? [...leads, 'Head of Product', 'CPO', 'VP Product'] : leads;
}

// "VP of Product" for a posting that reports to the "VP Product": every word
// of the posting's title is in the person's.
function matchesReportTitle(title, reportTitle = '') {
  if (!reportTitle) return false;
  if (leadsRoleTeam(title, [reportTitle])) return true;
  const words = String(reportTitle).toLowerCase().split(/[^\p{L}]+/u).filter(word => word && !REPORT_TAIL_WORD.test(word));
  const have = new Set(String(title || '').toLowerCase().split(/[^\p{L}]+/u));
  return words.length > 0 && words.every(word => have.has(word));
}

/**
 * Who a person is to this role: 1 a recruiter, 2 the lead of the role's
 * team (teamLeadTitles, or the title the posting reports to), 3 a founder,
 * 4 another manager, 5 a manager of another department (sales,
 * partnerships, finance, marketing…) or a role that is not known. The best
 * contact, the guess slots and the forward target follow this order.
 */
export function roleRank(person, { role = '', leads = teamLeadTitles(role), reportTitle = '' } = {}) {
  const title = String(person?.title || '');
  const persona = person?.persona || '';
  if (persona === 'recruiter') return 1;
  if (title && matchesReportTitle(title, reportTitle)) return 2;
  const otherTeam = Boolean(title) && leadsOtherTeam(title, { leads, role });
  const genericLeads = leads.every(lead => GENERIC_LEAD_TITLES.has(String(lead).toLowerCase()));
  if (title && leadsRoleTeam(title, leads) && !(otherTeam && genericLeads)) return 2;
  if (persona === 'founder') return 3;
  if (otherTeam) return 5;
  return persona === 'hiring-manager' ? 4 : 5;
}

function capPagePeople(people, role = '') {
  if (people.length <= PAGE_PEOPLE_FOCUS) return people;
  const leads = roleLeadTitles(role);
  const rank = person => (person.persona === 'recruiter' ? 0
    : leadsRoleTeam(person.title, leads) ? 1
      : person.persona === 'founder' ? 2 : person.persona === 'hiring-manager' ? 3 : 9);
  const kept = new Set(people
    .map((person, index) => ({ person, index, rank: rank(person) }))
    .filter(item => item.rank < 9)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, PAGE_PEOPLE_MAX)
    .map(item => item.person));
  return people.filter(person => kept.has(person));
}

/**
 * The three passes over a page's lines. (c) legal labels with their names
 * (same line or the next lines); (a) a name and a title on one line, either
 * order; (b) card pairs, kept only on a team-like page that has 2 or more.
 * Returns { people, cards, firstCardAt }: cards counts the card pairs
 * whatever the page, firstCardAt is the character offset of the first one
 * (-1 when none).
 */
function namedPeopleScan(text, { sourceUrl = '', teamLike, company = '', domain = '', role = '' } = {}) {
  const raw = String(text || '').split('\n');
  const lines = raw.map(line => line.trim());
  const guard = { company, domain };
  const out = new Map();
  const add = (name, title, { persona = '', evidence = '' } = {}) => {
    const key = `${name.firstName} ${name.lastName}`.toLowerCase();
    if (!title || out.has(key)) return;
    out.set(key, { ...name, title, persona: persona || personaFor(title), source: 'site', sourceUrl, evidence: String(evidence).slice(0, 160) });
  };
  const legalTitle = (label, matched) => label.title || (matched.charAt(0).toUpperCase() + matched.slice(1)).replace(/\s+/g, ' ');
  const isNameLine = line => { const m = String(line || '').match(NAME_LINE_RE); return Boolean(m && splitName(m[1])); };
  const fieldWords = words => words.split(/\s+/).filter(word => /\p{L}/u.test(word)).every(word => TITLE_QUALIFIER.has(word.toLowerCase()) || TITLE_TAIL_WORD.has(word.toLowerCase()));
  const bareLines = [];
  lines.forEach((line, i) => {
    if (!line) return;
    // (c) "Geschäftsführer" alone on its line: the names on the next lines
    // (lenient on the first, every part a name on the two after). Right
    // under a name it is that card's title ("Kyle Lukianuk" / "Managing
    // Director"), no heading.
    const heading = LEGAL_LABELS.map(label => ({ label, m: line.match(label.heading) })).find(item => item.m);
    if (heading) {
      if (isNameLine(lines[i - 1])) return;
      for (let j = i + 1; j <= i + 3 && j < lines.length; j += 1) {
        const { names, complete } = namesFromList(lines[j]);
        if (j > i + 1 && !complete) break;
        for (const name of names) add(name, legalTitle(heading.label, heading.m[1]), { persona: 'founder', evidence: `${line} ${lines[j]}` });
        if (!complete) break;
      }
      return;
    }
    // (c) "Managing Directors: Christoph Berner, Fritz Cramer, …" on one line.
    for (const label of LEGAL_LABELS) {
      for (const m of line.matchAll(label.inline)) {
        // A list of names fits in 300 characters; the rest of a long line is not read again.
        const after = m.index + m[0].length;
        for (const name of namesFromList(line.slice(after, after + 300)).names) add(name, legalTitle(label, m[1]), { persona: 'founder', evidence: line });
      }
    }
    // A quote's attribution: a customer, unless the title names this company
    // ("Florian Douetteau, CEO and co-founder, Dataiku").
    const quoted = QUOTE_START_RE.test(line) || QUOTE_END_RE.test(lines[i - 1] || '');
    const fromHere = title => !quoted || jobTitleNamesCompany(title, guard);
    // (a) Name then title, title then name, then a bare "Name Title" line.
    for (const m of line.matchAll(NAME_THEN_TITLE_RE)) {
      if (!fieldWords(m[2]) || !fromHere(`${m[2]}${m[3]}`)) continue;
      // In a posting, "Words: value" is a field ("Reports To: Head of
      // Design"), not "Name: Title".
      if (teamLike === false && /^\s*:/.test(m[0].slice(m[0].indexOf(m[1]) + m[1].length))) continue;
      const name = splitName(m[1]);
      const title = name ? titleForCandidate(name, `${m[2]}${m[3]}`, guard) : '';
      if (title) add(name, title, { evidence: line });
    }
    if (quoted) return;
    for (const m of line.matchAll(TITLE_THEN_NAME_RE)) {
      const name = splitName(m[3]);
      const title = name ? titleForCandidate(name, m[1] || m[2], guard) : '';
      if (title) add(name, title, { evidence: line });
    }
    const bare = line.length <= 100 ? line.match(NAME_TITLE_LINE_RE) : null;
    const bareName = bare ? splitName(bare[1]) : null;
    const bareTitle = bareName ? titleForCandidate(bareName, bare[2], guard) : '';
    if (bareTitle) bareLines.push({ name: bareName, title: bareTitle, line });
  });
  // (b) Cards, and bare "Name Title" lines: a list, not a stray line, on a
  // page about the team, or under a heading that says so ("L'équipe
  // dirigeante" on an about page). "Pressefotos Europace Vorstand" alone is a caption.
  const pairs = cardPairs(lines, guard);
  const isTeamLike = teamLike === undefined ? isTeamLikePage(sourceUrl) : Boolean(teamLike);
  const headed = pairs.length >= 2 && lines.slice(Math.max(0, pairs[0].index - 3), pairs[0].index).some(line => line.length <= 60 && TEAM_HEADING_RE.test(line));
  if (isTeamLike || bareLines.length >= 2) {
    for (const item of bareLines) add(item.name, item.title, { evidence: item.line });
  }
  if ((isTeamLike || headed) && pairs.length >= 2) {
    for (const pair of pairs) add(pair.name, pair.title, { evidence: `${lines[pair.index]} / ${lines[pair.index + 1]}` });
  }
  let firstCardAt = -1;
  if (pairs.length) firstCardAt = raw.slice(0, pairs[0].index).reduce((sum, line) => sum + line.length + 1, 0);
  return { people: capPagePeople([...out.values()], role), cards: pairs.length, firstCardAt };
}

/**
 * People named with a role on a page: legal notices (with their lists of
 * directors), "Name, Title" lines either way round, and team cards on a
 * team-like page (teamLike defaults to the URL's path). company and domain
 * let testimonials naming another company be dropped; role picks who stays
 * on a crowded page.
 */
export function extractNamedPeople(text, options = {}) {
  return namedPeopleScan(text, options).people;
}

/**
 * The "message the recruiter" card of a LinkedIn guest posting: the person
 * who posted the offer for the employer. Returns { firstName, lastName,
 * title, persona, linkedinUrl } or null; null too when the card's subtitle
 * places them at another company (an agency recruiter).
 */
export function parseLinkedInPoster(html, { company = '', domain = '' } = {}) {
  const raw = String(html || '');
  const at = raw.search(/class\s*=\s*["'][^"']*\bmessage-the-recruiter\b/i);
  if (at < 0) return null;
  const block = raw.slice(at, at + 8000);
  const textOf = re => pageText((block.match(re) || [])[1] || '').replace(/\s+/g, ' ').trim();
  const name = splitName(textOf(/<h3\b[^>]*\bbase-main-card__title\b[^>]*>([\s\S]*?)<\/h3>/i));
  if (!name) return null;
  let title = textOf(/<h4\b[^>]*\bbase-main-card__subtitle\b[^>]*>([\s\S]*?)<\/h4>/i);
  const tail = title.match(/^(.+?)\s+(?:chez|at|bei|@)\s+(.+)$/iu);
  if (tail) {
    if (company && !companyPartMatches(tail[2], company, domain)) return null;
    title = tail[1].trim();
  }
  title = title.slice(0, 80);
  const href = decodeEntities((block.match(/href\s*=\s*["']([^"']*\/in\/[^"']+)["']/i) || [])[1] || '');
  let linkedinUrl = '';
  try { const url = new URL(href, 'https://www.linkedin.com'); linkedinUrl = href ? url.origin + url.pathname : ''; } catch { linkedinUrl = ''; }
  return { ...name, title, persona: personaFor(title), linkedinUrl };
}

// ── People from web search (LinkedIn result titles and snippets) ────────────
const TITLE_SPLIT_RE = /\s+[-–—|·]\s+|\s+\|\s+/;
const LINKEDIN_RE = /linkedin\.com\/(?:[a-z]{2,3}\/)?(?:in|pub)\//i;

// One key per LinkedIn profile, whatever the host (fr.linkedin.com, www.).
function linkedinProfileKey(url) {
  const match = String(url || '').match(/linkedin\.com\/(?:[a-z]{2,3}\/)?(?:in|pub)\/([^/?#]+)/i);
  return match ? match[1].toLowerCase() : '';
}

function cleanTitlePart(part) {
  return String(part || '').replace(/\s*\|\s*linkedin\s*$/i, '').replace(/^\s*linkedin\s*[:|-]\s*/i, '').replace(/\s+/g, ' ').trim();
}

// An emoji (or flag) in a LinkedIn name part separates the name from a
// headline: "Jane Doe 🚀 Product Design".
const NAME_EMOJI_RE = /[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Variation_Selector}\p{Join_Control}]+/u;

/**
 * The name in a LinkedIn result title, cleaned for splitName: no
 * parenthesis ("Jane (Janie) Doe"), no credentials after a comma ("Sarah
 * Kim, PhD"), no leading honorific ("Dr. Jane Doe") and no single-letter
 * middle initial ("John A. Smith"). Text after an emoji is not the name.
 */
export function normalizeSearchName(raw) {
  let name = String(raw || '').split(NAME_EMOJI_RE)[0];
  name = name.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/,.*$/, ' ');
  name = name.replace(/^\s*(?:(?:dr|prof|mr|mrs|ms|mme|m)\.?\s+)+/i, '');
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words.filter((word, index) => !(index > 0 && index < words.length - 1 && /^\p{L}\.?$/u.test(word))).join(' ');
}

// Snippet segments that are LinkedIn's own labels, not a headline.
const SNIPPET_META_RE = /^(?:experience|expérience|education|formation|location|lieu|localisation|standort|ausbildung|berufserfahrung)\s*:/i;
const SNIPPET_COUNT_RE = /\d[\d,.]*\s*k?\+?\s*(?:connections|relations|followers|abonnés|kontakte)/i;
const SNIPPET_EXPERIENCE_RE = /^(?:experience|expérience|berufserfahrung)\s*:\s*/i;
// Words a headline holds when it is a job title.
const SNIPPET_ROLE_RE = /(?<![\p{L}])(?:head|lead|leader|manager|director|directeur|directrice|designer|engineer|developer|développeu\p{L}*|recruit\p{L}*|recrut\p{L}*|talent|people|founder|co-?founder|fondat\p{L}*|ceo|cto|cpo|coo|cmo|cfo|cro|chro|vp|chief|partner|owner|officer|president|présidente?|responsable|charg[ée]e?|leiter\p{L}*|gründer\p{L}*|geschäftsführ\p{L}*|analyst|consultant|specialist|scientist|architect|researcher)(?![\p{L}])/iu;

/**
 * The job title in a LinkedIn snippet made of " · " segments: a segment
 * "Head of Design at Europace", else the role-worded segment just before the
 * company ("Berlin, Germany · Head of Design · Europace AG"), else the
 * headline when the company comes from "Experience:" ("Head of Design |
 * Fintech · Experience: Europace · …"). A headline is cut at its first " | ".
 * '' otherwise.
 */
export function snippetTitle(snippet, { company = '', domain = '' } = {}) {
  const segments = String(snippet || '').split(/\s+·\s+/).map(segment => segment.trim()).filter(Boolean);
  const titleLike = value => Boolean(value) && value.length <= 80 && !SNIPPET_META_RE.test(value) && !SNIPPET_COUNT_RE.test(value) && SNIPPET_ROLE_RE.test(value);
  const headOf = value => String(value || '').split(/\s+\|\s+/)[0].trim();
  for (const segment of segments) {
    const at = segment.match(/^(.{2,80}?)\s+(?:at|chez|bei|@)\s+(.{2,60})$/i);
    if (at && companyPartMatches(at[2], company, domain) && titleLike(headOf(at[1]))) return headOf(at[1]);
  }
  const index = segments.findIndex(segment => companyPartMatches(segment.replace(SNIPPET_EXPERIENCE_RE, ''), company, domain));
  if (index <= 0) return '';
  if (titleLike(headOf(segments[index - 1]))) return headOf(segments[index - 1]);
  if (SNIPPET_EXPERIENCE_RE.test(segments[index]) && titleLike(headOf(segments[0]))) return headOf(segments[0]);
  return '';
}

// What a result must say before it takes the persona of the query that
// found it: a founder query also returns engineers who list the company.
const QUERY_PERSONA_PROOF = {
  founder: /founder|fondat|(?<![\p{L}])ceo(?![\p{L}])|gründer|geschäftsführ/iu,
  recruiter: /recruit|talent|recrut|(?<![\p{L}])(?:people|hr|rh)(?![\p{L}])|(?<![\p{L}])personal/iu,
};

/** The query's persona when the result's title or snippet proves it, else 'unknown'. */
export function provenQueryPersona(queryPersona, text) {
  const proof = QUERY_PERSONA_PROOF[queryPersona];
  return proof && proof.test(String(text || '')) ? queryPersona : 'unknown';
}

/**
 * Parse one search result into a person. LinkedIn titles come as
 * "Jane Doe - Head of Design - Acme | LinkedIn" (any order after the name);
 * snippets carry "Head of Design at Acme" or " · " segments. Returns null
 * unless the company is mentioned somewhere.
 */
export function parseSearchPerson(result = {}, { company = '', domain = '' } = {}) {
  const url = String(result.url || '');
  if (!LINKEDIN_RE.test(url)) return null;
  const parts = String(result.title || '').replace(/\s+on LinkedIn:.*$/i, '').split(TITLE_SPLIT_RE).map(cleanTitlePart).filter(Boolean);
  if (!parts.length) return null;
  const name = splitName(normalizeSearchName(parts[0]));
  if (!name) return null;
  // "Jane Doe ✨ Product Design - Acme": the text after the emoji is a title part.
  const headline = cleanTitlePart(parts[0].split(NAME_EMOJI_RE).slice(1).join(' '));
  const rest = [...(headline ? [headline] : []), ...parts.slice(1)];
  // A title part such as "Talent Partner at Riot" names the company too: the
  // company is its tail, the title is what comes before.
  let companyPart = '';
  let titleFromTail = '';
  for (const part of rest) {
    if (companyPartMatches(part, company, domain)) { companyPart = part; break; }
    const tail = String(part).match(/^(.{2,80}?)\s+(?:at|chez|@)\s+(.{2,60})$/i);
    if (tail && companyPartMatches(tail[2], company, domain)) { companyPart = part; titleFromTail = tail[1].trim(); break; }
  }
  let title = titleFromTail || rest.filter(part => part !== companyPart && !/^linkedin$/i.test(part)).join(', ');
  const snippet = String(result.snippet || '');
  const at = snippet.match(/^([^.·|]{2,80}?)\s+(?:at|chez|@)\s+([^.·|]{2,60})/u);
  const atTitle = at ? at[1].replace(/^(?:[^.]*?(?:\d+\+?\s+(?:followers|abonnés)|·)\s*)/i, '').trim() : '';
  const atNamesCompany = Boolean(at) && companyPartMatches(at[2].replace(/\s*(?:·|\||,).*$/, ''), company, domain);
  if (!companyPart && atNamesCompany) companyPart = at[2].trim();
  if (!companyPart) {
    // Snippet sentences: "Experience: Riot · Location: Paris" or "… at Riot.",
    // or a bare " · Europace AG · " segment.
    const mentions = [...snippet.matchAll(/(?:Experience|Expérience|at|chez|@)\s*:?\s*([^·|.,;]{2,40})/gi)].map(m => m[1].trim());
    companyPart = mentions.find(part => companyPartMatches(part, company, domain))
      || snippet.split(/\s+·\s+/).map(segment => segment.trim()).find(segment => companyPartMatches(segment, company, domain)) || '';
  }
  if (!companyPart) return null;
  // "Head of Design at Europace" first, then the " · " segments, then an
  // "X at Y" headline whose Y is not recognised.
  if (!title) title = (atNamesCompany && atTitle) || snippetTitle(snippet, { company, domain }) || atTitle;
  title = title.replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return { ...name, title, persona: inferPersona({ title }), linkedinUrl: url.split('?')[0], source: 'search', evidence: `${result.title || ''}${snippet ? ` — ${snippet.slice(0, 120)}` : ''}`.slice(0, 220) };
}

const DESIGN_ROLE_RE = /design|ux|ui\b|user experience|product designer/;

/** Titles of the person who would lead this role's team. */
export function roleLeadTitles(role = '') {
  const r = String(role || '').toLowerCase();
  if (DESIGN_ROLE_RE.test(r)) return ['Head of Design', 'Design Lead', 'VP Design', 'Head of Product Design', 'Design Director', 'Design Manager'];
  if (/product manager|product owner|head of product|product lead|chef de produit|cpo/.test(r)) return ['Head of Product', 'VP Product', 'CPO', 'Product Director', 'Product Lead'];
  if (/engineer|developer|développeur|software|backend|frontend|full ?stack|devops|sre/.test(r)) return ['CTO', 'VP Engineering', 'Head of Engineering', 'Engineering Manager'];
  if (/data|analytics|machine learning|ml\b|ai\b|intelligence artificielle/.test(r)) return ['Head of Data', 'VP Data', 'Head of AI', 'CTO'];
  if (/marketing|growth|brand|content|communication/.test(r)) return ['Head of Marketing', 'CMO', 'VP Marketing', 'Head of Growth'];
  if (/sales|account|business developer|commercial/.test(r)) return ['Head of Sales', 'VP Sales', 'CRO'];
  if (/people|hr\b|talent|recrut/.test(r)) return ['Head of People', 'CPO', 'HR Director'];
  return ['Head of', 'Director', 'VP'];
}

// "You will report to the Head of Product", "rattaché(e) au Directeur
// Produit", "du berichtest an unseren Head of Design": the title is read up
// to a punctuation mark or a word that starts a new clause.
const REPORTS_TO_RES = [
  /\breport(?:s|ing)?\s+(?:directly\s+)?(?:in)?to\s*:?\s*(?:the\s+|our\s+|an?\s+)?([^,.;:()!?\n]{2,60})/i,
  /\brattach[ée]+(?:\s*\(e\)|e)?s?\s+(?:directement\s+)?(?:au|aux|à\s+la|à\s+l['’]|a\s+la)\s*([^,.;:()!?\n]{2,60})/i,
  /\bberichte(?:st|t)?\s+(?:direkt\s+)?an\s+(?:den\s+|die\s+|das\s+|unseren\s+|unsere\s+|unser\s+|deinen\s+|deine\s+)?([^,.;:()!?\n]{2,60})/i,
];
const REPORT_STOP_WORD = /^(?:and|who|which|with|to|in|on|for|you|your|will|that|as|et|qui|vous|pour|avec|dans|sur|au|und|der|mit|im|wo|als)$/i;
const REPORT_TAIL_WORD = /^(?:of|de|du|des|d|la|le|the|&|for)$/i;
const REPORT_TITLE_RE = /(?<![\p{L}])(?:head|lead|director|directeur|directrice|vp|vice|chief|ceo|cto|cpo|coo|cmo|cdo|manager|responsable|leiter\p{L}*|leitung|founder|co-?founder|fondat\p{L}*|gründer\p{L}*|geschäftsführ\p{L}*|présidente?|president)(?![\p{L}])/iu;
// "the team lead", "your manager": a title every team has, no search term.
const GENERIC_REPORT_TITLE_RE = /^(?:(?:team|tech|line|direct|hiring|your|their)\s+)?(?:lead|leader|manager|supervisor|head|responsable)$/i;

/** The title the role reports to, when the posting names a title and no person; '' otherwise. */
export function reportingTitleFromPosting(jobText) {
  const text = String(jobText || '');
  for (const re of REPORTS_TO_RES) {
    const match = text.match(re);
    if (!match) continue;
    const words = [];
    for (const word of match[1].trim().split(/\s+/)) {
      if (words.length >= 6 || REPORT_STOP_WORD.test(word)) break;
      words.push(word);
    }
    while (words.length && REPORT_TAIL_WORD.test(words[words.length - 1])) words.pop();
    const title = words.join(' ');
    if (title && !/\d/.test(title) && REPORT_TITLE_RE.test(title) && !GENERIC_REPORT_TITLE_RE.test(title)) return title;
  }
  return '';
}

// Recruiter titles as people write them on LinkedIn, by posting language.
const RECRUITER_TERMS = {
  fr: 'recruteur OR recruteuse OR "chargé de recrutement" OR "chargée de recrutement" OR "talent acquisition" OR RH',
  de: 'Recruiter OR Recruiterin OR "Talent Acquisition" OR "People & Culture"',
  en: 'recruiter OR "talent acquisition" OR "talent partner" OR "people partner" OR "people operations"',
};
// A design team at a startup is often led by product: Head of Product and CPO count.
const DESIGN_LEAD_QUERY_TITLES = ['Head of Design', 'Design Lead', 'Design Director', 'Head of Product', 'CPO'];
// The spare search's titles when the first lead query found nobody.
const PRODUCT_LEAD_TITLES = ['Head of Product', 'CPO', 'Chief Product Officer', 'VP Product', 'Product Director', 'CTO'];

// The lead query's titles: the one the posting reports to first.
function leadQueryTitles(role = '', jobText = '') {
  const titles = DESIGN_ROLE_RE.test(String(role || '').toLowerCase()) ? DESIGN_LEAD_QUERY_TITLES : roleLeadTitles(role).slice(0, 4);
  const seen = new Set();
  return [reportingTitleFromPosting(jobText), ...titles].filter(title => title && !seen.has(title.toLowerCase()) && seen.add(title.toLowerCase()));
}

// The quoted name, plus the domain's own word when the site is confirmed and
// spells the name differently ("Riot" OR tryriot). Never a required second
// word: '"TripleTen" scamdoc' found nobody.
function peopleScope({ company = '', domain = '', confirmed = false } = {}) {
  const name = String(company || '').trim();
  const core = String(domain || '').toLowerCase().split('.')[0];
  const spelled = core.replace(/-/g, '');
  const differs = spelled && ![companyTokens(name).join(''), companyNameWords(name).join('')].includes(spelled);
  return confirmed && differs ? `("${name}" OR ${core})` : `"${name}"`;
}

/** The three searches (recruiter, team lead, founder), company-scoped. */
export function peopleQueries({ company = '', role = '', domain = '', confirmed = false, language = 'en', jobText = '' } = {}) {
  const name = String(company || '').trim();
  if (!name) return [];
  const scope = peopleScope({ company: name, domain, confirmed });
  const lead = leadQueryTitles(role, jobText).map(t => `"${t}"`).join(' OR ');
  return [
    { persona: 'recruiter', query: `site:linkedin.com/in ${scope} (${RECRUITER_TERMS[language] || RECRUITER_TERMS.en})` },
    { persona: 'hiring-manager', query: `site:linkedin.com/in ${scope} (${lead})` },
    { persona: 'founder', query: `site:linkedin.com/in ${scope} (CEO OR founder OR "co-founder" OR fondateur)` },
  ];
}

/**
 * A second team-lead search with product-leadership titles the first one
 * did not ask for, or null when none is left.
 */
export function spareLeadQuery({ company = '', role = '', domain = '', confirmed = false, jobText = '' } = {}) {
  const name = String(company || '').trim();
  if (!name) return null;
  const asked = new Set(leadQueryTitles(role, jobText).map(title => title.toLowerCase()));
  const titles = PRODUCT_LEAD_TITLES.filter(title => !asked.has(title.toLowerCase()));
  if (!titles.length) return null;
  return { persona: 'hiring-manager', spare: true, query: `site:linkedin.com/in ${peopleScope({ company: name, domain, confirmed })} (${titles.map(t => `"${t}"`).join(' OR ')})` };
}

// ── People from TheOrg (public org charts) ──────────────────────────────────
/**
 * TheOrg page slugs to try for a company: the name's words ("bellwood-labs"),
 * then its distinctive tokens ("bellwood"). Two at most.
 */
export function theOrgSlugs(company) {
  return [...new Set([companyNameWords(company).join('-'), companyTokens(company).join('-')])].filter(slug => slug.length >= 2).slice(0, 2);
}

/**
 * The organisation a TheOrg page describes, from its JSON-LD Organization:
 * { name, website, domain, people: [{ firstName, lastName, title, persona }] },
 * or null when the page has none.
 */
export function parseTheOrgPage(html) {
  for (const block of String(html || '').matchAll(JSON_LD_RE)) {
    let parsed;
    try { parsed = JSON.parse(block[1].trim()); } catch { continue; }
    const org = jsonLdNodes(parsed).find(node => [node['@type']].flat().some(type => /Organization$/i.test(String(type))));
    if (!org) continue;
    const website = absolutize(typeof org.url === 'string' ? org.url : '');
    let domain = '';
    try { domain = website ? registrableDomain(new URL(website).hostname) : ''; } catch { domain = ''; }
    const people = [];
    for (const employee of [org.employee].flat()) {
      if (!employee || typeof employee !== 'object') continue;
      const name = splitName(normalizeSearchName(employee.name));
      if (!name) continue;
      const title = String(employee.jobTitle || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      people.push({ ...name, title, persona: personaFor(title) });
    }
    return { name: String(org.name || '').trim(), website, domain, people };
  }
  return null;
}

// Endings a startup picks for its name, not for a country: lindy.ai and
// lindy.com are two companies, doctolib.fr and doctolib.com one.
const VANITY_TLD_RE = /^(?:ai|io|co|me|tv|ly|so|gg|sh|to|fm|cc|ws|vc|app|dev|xyz|tech|studio|design|agency|team|inc)$/;

/**
 * Is a TheOrg page this company? Its website is the finder's domain, or the
 * same core label under a country ending (doctolib.fr for doctolib.com), and
 * its name is the company's. riot → weareriot.com is another Riot than
 * tryriot.com.
 */
export function theOrgPageMatches(page, { company = '', domain = '' } = {}) {
  if (!page?.domain || !domain) return false;
  const split = value => { const [core, ...rest] = String(value).split('.'); return { core, ending: rest.join('.') }; };
  const theirs = split(page.domain);
  const ours = split(domain);
  const sibling = theirs.core === ours.core && !VANITY_TLD_RE.test(theirs.ending) && !VANITY_TLD_RE.test(ours.ending);
  return (page.domain === domain || sibling) && companyPartMatches(page.name, company);
}

// ── Email patterns for a named person ───────────────────────────────────────
const PATTERNS = ['first.last', 'first', 'flast', 'firstlast', 'first_last', 'f.last', 'last', 'first-last', 'lastfirst', 'last.first'];

function asciiLocal(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, '').replace(/[^a-z0-9-]+/g, '').replace(/-+/g, '-');
}

// Surname particles: "Le Roux" is leroux@, "de La Fontaine" delafontaine@.
const SURNAME_PARTICLES = new Set(['le', 'la', 'de', 'du', 'des', 'van', 'von', 'der', 'den', 'da', 'di']);

/**
 * The last-name forms an address may use, most likely first. A particle is
 * joined to what follows ("Le Roux" → ['leroux', 'roux'], "de La Fontaine" →
 * ['delafontaine', 'fontaine']); without one, the last word ("Claire Dupont"
 * read as a last name → ['dupont']). [] for no last name.
 */
export function lastVariants(lastName) {
  const words = String(lastName || '').trim().split(/\s+/).filter(Boolean).map(word => asciiLocal(word).replace(/-/g, '')).filter(Boolean);
  if (!words.length) return [];
  const lastWord = words[words.length - 1];
  const at = words.findIndex((word, index) => index < words.length - 1 && SURNAME_PARTICLES.has(word));
  if (at < 0) return [lastWord];
  return [...new Set([words.slice(at).join(''), lastWord])];
}

// A name is compound when its address could use two last-name forms.
function compoundLastName(lastName) {
  return lastVariants(lastName).length > 1;
}

export function applyPattern(pattern, firstName, lastName) {
  return localFor(pattern, asciiLocal(firstName).replace(/-/g, ''), lastVariants(lastName)[0] || '');
}

// The local part for a pattern, from an ASCII first name and last-name form.
function localFor(pattern, first, last) {
  if (!first) return '';
  if (!last) return pattern === 'first' ? first : '';
  const f = first[0];
  switch (pattern) {
    case 'first.last': return `${first}.${last}`;
    case 'first': return first;
    case 'flast': return `${f}${last}`;
    case 'firstlast': return `${first}${last}`;
    case 'first_last': return `${first}_${last}`;
    case 'f.last': return `${f}.${last}`;
    case 'last': return last;
    case 'first-last': return `${first}-${last}`;
    case 'lastfirst': return `${last}${first}`;
    case 'last.first': return `${last}.${first}`;
    default: return '';
  }
}

/**
 * Which pattern an address follows for a known name, or ''. Every last-name
 * form counts ("e.roux@" is f.last for Élodie Le Roux). `patterns` limits
 * the patterns tried.
 */
export function detectPattern(email, firstName, lastName, { patterns = PATTERNS } = {}) {
  const local = String(email || '').toLowerCase().split('@')[0];
  if (!local) return '';
  const first = asciiLocal(firstName).replace(/-/g, '');
  const lasts = lastVariants(lastName);
  for (const pattern of patterns) {
    for (const last of lasts.length ? lasts : ['']) {
      if (localFor(pattern, first, last) === local) return pattern;
    }
  }
  return '';
}

// The pattern a person-like local part shows by its shape alone ("j.doe" is
// f.last, "marie.dupont" first.last); '' for a single word.
function shapePattern(local) {
  const value = String(local || '').toLowerCase();
  return /^[a-z]\.[a-z]{2,}$/.test(value) ? 'f.last'
    : /^[a-z]{2,}\.[a-z]{2,}$/.test(value) ? 'first.last'
      : /^[a-z]{2,}_[a-z]{2,}$/.test(value) ? 'first_last'
        : /^[a-z]{2,}-[a-z]{2,}$/.test(value) ? 'first-last'
          : '';
}

/**
 * Guess the company's naming pattern from person-like addresses found on
 * its site ("marie.dupont@" → first.last). Role and department mailboxes
 * (equipe.rh@, office.manager@) never count. Returns the most frequent
 * pattern, or '' when the addresses show none.
 */
export function inferPattern(personEmails = []) {
  const counts = new Map();
  for (const email of new Set(personEmails.map(value => String(value || '').toLowerCase()))) {
    const local = email.split('@')[0];
    const pattern = localKind(local) === 'person' ? shapePattern(local) : '';
    if (pattern) counts.set(pattern, (counts.get(pattern) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}

/**
 * Candidate addresses for a person, best pattern first. For a compound last
 * name the known pattern with the last word alone ("elodie.roux") comes
 * right after the primary form ("elodie.leroux").
 */
export function emailCandidates({ firstName, lastName, domain, knownPattern = '' } = {}) {
  if (!domain || !firstName) return [];
  const order = [...new Set([knownPattern, ...PATTERNS].filter(Boolean))];
  const first = asciiLocal(firstName).replace(/-/g, '');
  const [primary = '', ...others] = lastVariants(lastName);
  const out = [];
  const push = (pattern, last) => {
    const local = localFor(pattern, first, last);
    if (local && !out.some(item => item.local === local)) out.push({ pattern, local, email: `${local}@${domain}` });
  };
  for (const [index, pattern] of order.entries()) {
    push(pattern, primary);
    if (index === 0) for (const last of others) push(pattern, last);
  }
  return out;
}

/**
 * What a DNS answer says about mail: true (MX records), false (a null MX
 * "0 ." per RFC 7505, no such domain, or no record of any kind) or null when
 * it cannot tell (a DNS error, or no MX but an A/AAAA record, which a sender
 * may still deliver to). `hasAddress`: resolve4 or resolve6 answered.
 */
export function mxVerdict(records, err = null, { hasAddress = false } = {}) {
  if (err) {
    if (err.code === 'ENOTFOUND') return false;
    if (err.code === 'ENODATA') return hasAddress ? null : false;
    return null;
  }
  if (!Array.isArray(records) || !records.length) return hasAddress ? null : false;
  if (records.length === 1 && ['', '.'].includes(String(records[0]?.exchange ?? '').trim())) return false;
  return true;
}

const mxCache = new Map();
/**
 * Does the domain receive mail? true, false or null (unknown), see
 * mxVerdict. `resolver` replaces node:dns in tests (no cache then).
 */
export async function domainAcceptsMail(domain, { resolver = dns } = {}) {
  const key = String(domain || '').toLowerCase();
  if (!key) return false;
  const cached = resolver === dns;
  if (cached && mxCache.has(key)) return mxCache.get(key);
  let records = null;
  let error = null;
  try { records = await resolver.resolveMx(key); } catch (err) { error = err; }
  let hasAddress = false;
  if (error?.code === 'ENODATA' || (!error && !(Array.isArray(records) && records.length))) {
    const answers = async (lookup) => {
      try { const list = await lookup(); return Array.isArray(list) && list.length > 0; } catch { return false; }
    };
    hasAddress = (await answers(() => resolver.resolve4(key))) || (await answers(() => resolver.resolve6(key)));
  }
  const ok = mxVerdict(records, error, { hasAddress });
  if (cached) mxCache.set(key, ok);
  return ok;
}

// ── Enrichment providers (optional, key-gated) ──────────────────────────────
function mapVerifyStatus(value) {
  const v = String(value || '').toLowerCase();
  if (/^(?:valid|deliverable|ok|verified|safe)$/.test(v)) return 'verified';
  if (/catch|accept_all|accept-all|risky|unknown|webmail/.test(v)) return 'likely';
  if (/invalid|undeliverable|bounce|disposable|not_found|notfound/.test(v)) return 'invalid';
  return v ? 'likely' : 'unknown';
}

export class ProviderUnavailable extends Error {
  constructor(provider, message) {
    super(`${provider}: ${message}`);
    this.provider = provider;
    this.unavailable = true;
  }
}

/**
 * lemlist enrichment (POST /api/enrich, then GET /api/enrich/{id}).
 * Needs a plan with API access: a 402 marks the provider unavailable.
 */
export function lemlistProvider({ apiKey, fetchImpl = fetch, pollMs = 3000, timeoutMs = 45000, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  if (!apiKey) return null;
  const auth = `Basic ${Buffer.from(`:${apiKey}`).toString('base64')}`;
  const call = async (method, path) => {
    const response = await fetchImpl(`https://api.lemlist.com${path}`, { method, headers: { Authorization: auth, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    if (response.status === 402 || response.status === 401 || response.status === 403) throw new ProviderUnavailable('lemlist', `HTTP ${response.status} (plan sans accès API ou clé invalide)`);
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { status: response.status, json };
  };
  const poll = async (id) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const { status, json } = await call('GET', `/api/enrich/${encodeURIComponent(id)}`);
      if (status === 200 && json && (json.enrichmentStatus === 'done' || json.data)) return json;
      if (status >= 400) throw new Error(`lemlist GET /api/enrich/${id} → HTTP ${status}`);
      await sleep(pollMs);
    }
    throw new Error('lemlist: enrichment timed out');
  };
  return {
    name: 'lemlist',
    async findEmail({ firstName, lastName, domain, company, title }) {
      const params = new URLSearchParams({ findEmail: 'true', firstName: firstName || '', lastName: lastName || '', companyDomain: domain || '', companyName: company || '' });
      if (title) params.set('jobTitle', title);
      const { status, json } = await call('POST', `/api/enrich?${params}`);
      if (status !== 200 || !json?.id) throw new Error(`lemlist POST /api/enrich → HTTP ${status}`);
      const result = await poll(json.id);
      const email = result?.data?.email?.email || result?.data?.email?.value || '';
      const notFound = Boolean(result?.data?.email?.notFound) || !email;
      return { email, status: notFound ? 'notfound' : 'verified', raw: result };
    },
    async verifyEmail(email) {
      const params = new URLSearchParams({ verifyEmail: 'true', email });
      const { status, json } = await call('POST', `/api/enrich?${params}`);
      if (status !== 200 || !json?.id) throw new Error(`lemlist POST /api/enrich (verify) → HTTP ${status}`);
      const result = await poll(json.id);
      const value = result?.data?.email?.status || result?.data?.email?.verification || result?.data?.verify?.status || result?.data?.emailStatus || '';
      return { status: mapVerifyStatus(value), raw: result };
    },
  };
}

/** hunter.io: domain search (pattern + addresses), email finder, verifier. */
export function hunterProvider({ apiKey, fetchImpl = fetch } = {}) {
  if (!apiKey) return null;
  const call = async (path, params) => {
    const query = new URLSearchParams({ ...params, api_key: apiKey });
    const response = await fetchImpl(`https://api.hunter.io/v2/${path}?${query}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    if (response.status === 401 || response.status === 403 || response.status === 402) throw new ProviderUnavailable('hunter', `HTTP ${response.status}`);
    const json = await response.json().catch(() => null);
    if (response.status === 429) throw new Error('hunter: quota exceeded');
    if (!response.ok) throw new Error(`hunter ${path} → HTTP ${response.status}`);
    return json?.data || {};
  };
  return {
    name: 'hunter',
    async domainSearch(domain) {
      const data = await call('domain-search', { domain, limit: '10' });
      return {
        pattern: String(data.pattern || '').replace(/[{}]/g, ''),
        emails: (data.emails || []).map(item => ({ email: item.value, firstName: item.first_name || '', lastName: item.last_name || '', title: item.position || '', department: item.department || '', confidence: item.confidence || 0, status: mapVerifyStatus(item.verification?.status) })),
      };
    },
    async findEmail({ firstName, lastName, domain }) {
      const data = await call('email-finder', { domain, first_name: firstName || '', last_name: lastName || '' });
      if (!data.email) return { email: '', status: 'notfound', raw: data };
      const status = data.verification?.status ? mapVerifyStatus(data.verification.status) : (Number(data.score) >= 70 ? 'likely' : 'guess');
      return { email: data.email, status, score: data.score, raw: data };
    },
    async verifyEmail(email) {
      const data = await call('email-verifier', { email });
      return { status: mapVerifyStatus(data.status || data.result), raw: data };
    },
  };
}

// A provider that answered "unavailable" (plan without API access, bad key)
// is skipped for a day, so its note shows once a day, not on every search.
// Keyed by provider name: the server builds new provider objects per search.
export const PROVIDER_OUTAGE_MS = 24 * 60 * 60 * 1000;
const PROVIDER_OUTAGES = new Map();

/** Providers from the environment: none when no key is set. */
export function providersFromEnv(env = process.env) {
  return [
    hunterProvider({ apiKey: env.HUNTER_API_KEY }),
    lemlistProvider({ apiKey: env.LEMLIST_API_KEY }),
  ].filter(Boolean);
}

// ── Safe page fetch (public hosts only, redirects followed by hand) ──────────
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function publicHttpUrl(value) {
  let url;
  try { url = new URL(String(value || '')); } catch { return null; }
  if (!/^https?:$/.test(url.protocol)) return null;
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') || /^[\d.]+$/.test(host) || /^\[/.test(host) || /\.(?:local|localhost|internal|lan|home|corp|intranet|test|invalid)$/.test(host)) return null;
  return url;
}

// What each fetch mode asks for and accepts. 'xml' also takes text/plain:
// robots.txt, and sitemaps some servers label as plain text.
const FETCH_MODES = {
  html: { accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', type: /text\/html|application\/xhtml|text\/plain/i, what: 'an HTML page' },
  json: { accept: 'application/json,application/ld+json;q=0.9,*/*;q=0.1', type: /application\/(?:[\w.-]+\+)?json|text\/json/i, what: 'a JSON document' },
  xml: { accept: 'application/xml,text/xml;q=0.9,text/plain;q=0.8,*/*;q=0.1', type: /(?:application|text)\/(?:[\w.-]+\+)?xml|text\/plain/i, what: 'an XML document' },
};

/**
 * Fetch one public page with the providers' guarded HTTP layer (resolved
 * address must be public). Follows up to three redirects, each re-checked.
 * fetchPage(url, { as, slim }):
 *   'html' (default) → { ok, status, html, text, url }: Cloudflare-protected
 *                      addresses decoded, then slimmed (slimHtml) to maxChars;
 *                      slim: false keeps inline scripts (an ATS page's data
 *                      blob) and only cuts at maxChars, as before;
 *   'json'           → { ok, status, json, url }; a body that does not parse is ok: false;
 *   'xml'            → { ok, status, text, url } (sitemaps, robots.txt).
 */
export function createPageFetcher({ timeoutMs = 10000, maxChars = 400000, language = 'fr,en;q=0.8' } = {}) {
  return async function fetchPage(input, { as = 'html', slim = true } = {}) {
    const modeName = FETCH_MODES[as] ? as : 'html';
    const mode = FETCH_MODES[modeName];
    const failed = (status, at, error) => ({ ok: false, status, html: '', text: '', ...(modeName === 'json' ? { json: null } : {}), url: at, error });
    let url = publicHttpUrl(input);
    if (!url) return failed(0, String(input || ''), 'not a public http(s) URL');
    for (let hop = 0; hop < 4; hop += 1) {
      let response;
      try {
        response = await fetchResponse(url.href, { timeoutMs, redirect: 'manual', headers: { 'User-Agent': BROWSER_UA, Accept: mode.accept, 'Accept-Language': language } });
      } catch (err) {
        return failed(err?.status || 0, url.href, err?.message || String(err));
      }
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        let next = null;
        try { next = location ? publicHttpUrl(new URL(location, url).href) : null; } catch { next = null; }
        if (!next) return failed(response.status, url.href, 'redirect to a non-public URL');
        url = next;
        continue;
      }
      const declared = Number(response.headers.get('content-length') || 0);
      if (declared > 3_000_000) return failed(response.status, url.href, `page too large (${declared} bytes)`);
      const contentType = response.headers.get('content-type') || '';
      if (contentType && !mode.type.test(contentType)) return failed(response.status, url.href, `not ${mode.what} (${contentType.split(';')[0]})`);
      const body = await response.text();
      if (modeName === 'json') {
        try { return { ok: true, status: response.status, json: JSON.parse(body), url: url.href }; } catch { return failed(response.status, url.href, 'invalid JSON'); }
      }
      if (modeName === 'xml') return { ok: true, status: response.status, text: body.slice(0, 3_000_000), url: url.href };
      // Slimmed after decoding, so a footer past the first 400 KB survives.
      const html = slim ? slimHtml(preDecodeHtml(body), maxChars) : preDecodeHtml(body).slice(0, maxChars);
      return { ok: true, status: response.status, html, text: pageText(html), url: url.href };
    }
    return failed(0, url.href, 'too many redirects');
  };
}

// ── What the company says about itself ──────────────────────────────────────
const ABOUT_PATH_RE = /(?:^|\/)(?:about|about-us|a-propos|qui-sommes-nous|who-we-are|ueber-uns|uber-uns|unternehmen|company|entreprise|over-ons|chi-siamo|sobre-nosotros|notre-histoire|our-story)(?:\/|\.html?|$)/i;
const BRIEF_JUNK_RE = /cookie|consent|©|&copy;|copyright/i;

// A page as { html, text, url }: a string is read as HTML (plain text passes through).
function briefPage(value) {
  if (typeof value === 'string') return { html: value, text: pageText(value), url: '' };
  if (!value || typeof value !== 'object') return null;
  const html = String(value.html || '');
  return { html, text: String(value.text || '') || pageText(html), url: String(value.url || '') };
}

// The meta description, og:description and JSON-LD Organization description, entity-decoded.
function selfDescriptions(html) {
  const out = [];
  const add = value => {
    const text = decodeEntities(String(value || '')).replace(/\s+/g, ' ').trim();
    if (text.length >= 20) out.push(text.slice(0, 600));
  };
  for (const [tag] of String(html || '').matchAll(/<meta\b[^>]*>/gi)) {
    const key = tag.match(/(?:name|property)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    if (key !== 'description' && key !== 'og:description') continue;
    const content = tag.match(/content\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    if (content) add(content[1] ?? content[2]);
  }
  for (const block of String(html || '').matchAll(JSON_LD_RE)) {
    let parsed;
    try { parsed = JSON.parse(block[1].trim()); } catch { continue; }
    for (const node of jsonLdNodes(parsed)) {
      const types = [node['@type']].flat().map(String);
      if (types.some(type => /^(?:Organization|Corporation)$/.test(type)) && typeof node.description === 'string') add(node.description);
    }
  }
  return out;
}

/**
 * What a company says about itself, clean enough to quote: its meta
 * description, og:description and JSON-LD Organization description, then the
 * lines of the home page and of the first about/company page that appear on
 * fewer than 2 of the pages given (nav and footer drop out), have 8+ words,
 * hold almost no code ('{', '}', ';' under 2%) and no cookie or © mention.
 *
 * companyBrief({ home, pages = [], max = 2500 }) → string ('' when nothing qualifies)
 *   home   page object { html, text?, url? } or an HTML/text string
 *   pages  other pages of the same site, same shape (about, contact, team…)
 */
export function companyBrief({ home, pages = [], max = 2500 } = {}) {
  const homePage = briefPage(home);
  if (!homePage) return '';
  const others = [];
  const bodies = new Set([homePage.text]);
  for (const page of (Array.isArray(pages) ? pages : []).map(briefPage)) {
    // The same body twice (an SPA shell) would make every line look shared.
    if (!page || bodies.has(page.text)) continue;
    bodies.add(page.text);
    others.push(page);
  }
  const linesOf = page => page.text.split('\n').map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const seenOn = new Map();
  for (const page of [homePage, ...others]) for (const line of new Set(linesOf(page))) seenOn.set(line, (seenOn.get(line) || 0) + 1);
  const qualifies = line => (seenOn.get(line) || 0) < 2
    && line.split(' ').length >= 8
    && (line.match(/[{};]/g) || []).length / line.length < 0.02
    && !BRIEF_JUNK_RE.test(line);
  const about = others.find(page => { try { return ABOUT_PATH_RE.test(new URL(page.url).pathname); } catch { return false; } });
  const parts = [];
  const kept = new Set();
  const add = line => {
    const key = line.toLowerCase();
    if (kept.has(key)) return;
    kept.add(key);
    parts.push(line);
  };
  selfDescriptions(homePage.html).forEach(add);
  linesOf(homePage).filter(qualifies).forEach(add);
  if (about) linesOf(about).filter(qualifies).forEach(add);
  let brief = '';
  for (const part of parts) {
    if (brief.length + part.length + 1 > max) {
      if (!brief) brief = part.slice(0, max);
      break;
    }
    brief += (brief ? '\n' : '') + part;
  }
  return brief;
}

// ── Ranking ─────────────────────────────────────────────────────────────────
const CONFIDENCE_WEIGHT = { verified: 3, likely: 2, guess: 1 };
// A named employee with an unknown role still beats a support inbox: a person
// can forward an application, a ticket queue rarely does.
const PERSONA_WEIGHT = { recruiter: 3, 'hiring-manager': 3, founder: 2, inbox: 1.5, unknown: 1.6 };

// Pages whose addresses serve privacy, terms, press or investors, never
// hiring. A legal notice (mentions légales, Impressum, imprint) is not one:
// it prints the general contact by law (Europace: info@ on /impressum only).
const POLICY_PIECE_RE = /^(?:privacy|confidentialit\w*|datenschutz\w*|donnees|cookies?|terms|conditions|cgu|cgv|rgpd|gdpr|press|presse|media|medias|newsroom|investors?|investisseurs?)$/;

/** Is this a privacy, cookie, terms, press, media or investor page? */
export function isPolicyPage(url) {
  let path = '';
  try { path = new URL(url).pathname.toLowerCase(); } catch { return false; }
  return path.split(/[^a-z]+/).some(piece => piece && POLICY_PIECE_RE.test(piece));
}

// Printed only on such pages (each site or posting source carries the flag).
function foundOnlyOnPolicyPages(contact) {
  const printed = (contact.sources || []).filter(source => ['site', 'posting', 'provider'].includes(source.type));
  return printed.length > 0 && printed.every(source => source.flag === 'policy-page');
}

// A help desk (support@, help@, customer.service@, customer.care@, sav@,
// assistance@, kundenservice@): listed, never drafted for.
const HELP_DESK_PIECES = new Set([
  'support', 'help', 'helpdesk', 'helpcenter', 'service', 'servicedesk', 'care', 'customercare', 'sav', 'assistance', 'clients',
  'kundenservice', 'servicekunden', 'kundendienst',
]);
// The same desks written as one word: customerservice@, customersupport@,
// supportteam@, serviceclient@, techsupport@.
const HELP_DESK_WORD_RE = /^(?:customer|client|clients|kunden|tech|it)?(?:support|service|care|help)(?:team|desk|center|centre|client|clients|kunden)?$/;
function isHelpDesk(contact) {
  if (contact.kind !== 'generic') return false;
  return String(contact.email || '').split('@')[0].toLowerCase().split(/[^a-z]+/).some(piece => HELP_DESK_PIECES.has(piece) || HELP_DESK_WORD_RE.test(piece));
}

function contactDomain(contact) {
  return registrableDomain(String(contact.email || '').split('@')[1] || '');
}

// Printed only by the site's own pages (its domain, or a sibling ccTLD it
// prints: info@lindy.de on lindy.com), never by the posting or a provider.
function foundOnlyOnSite(contact) {
  const printed = (contact.sources || []).filter(source => ['site', 'posting', 'provider'].includes(source.type));
  return printed.length > 0 && printed.every(source => source.type === 'site');
}

// A shared inbox the mailbox words name (contact@, info@, hello@), against
// one an unknown word makes generic (vertrieb@ before AVOID_PIECES knew it).
function knownInbox(contact) {
  return contact.kind === 'generic' && Boolean(mailboxKind(String(contact.email || '').split('@')[0])) ? 1 : 0;
}

export function scoreContact(contact) {
  let confidence = CONFIDENCE_WEIGHT[contact.confidence] || 0;
  let persona = PERSONA_WEIGHT[contact.persona] ?? 1;
  // The person's place for this role (teamRank, set by findContacts): the
  // lead of its team weighs like a recruiter whatever the title says ("CPO
  // & Co-founder"), a manager of another department like an unknown role,
  // any other manager just below a founder.
  if (contact.teamRank === 1 || contact.teamRank === 2) persona = Math.max(persona, PERSONA_WEIGHT.recruiter);
  else if (contact.persona === 'hiring-manager' && contact.teamRank === 5) persona = PERSONA_WEIGHT.unknown;
  else if (contact.persona === 'hiring-manager' && contact.teamRank === 4) persona = PERSONA_WEIGHT.founder - 0.1;
  if (contact.kind === 'hiring') persona = 2.5;
  // A generic inbox (contact@, support@) is a last resort: it stays below a
  // likely named recruiter or team lead, above a bare guess.
  if (contact.kind === 'generic') { persona = 0.5; confidence = Math.min(confidence, 2); }
  if (contact.kind === 'avoid') persona = 0;
  // An address printed only on a privacy or press page is no hiring contact.
  if (foundOnlyOnPolicyPages(contact)) persona = Math.min(persona, 0.3);
  let source = 0;
  // Printed: an address found as such on the site or in the posting (a guess
  // carries its person's page as a source too).
  const printed = contact.confidence === 'verified' && contact.sources.some(s => s.type === 'site' || s.type === 'posting');
  if (contact.sources.some(s => s.type === 'posting')) source += 1.5;
  if (contact.sources.some(s => s.type === 'site')) source += 1;
  // A public org chart scoped to the company's own domain counts like its
  // site, for an address the site does not print: it never decides between
  // two printed addresses.
  if (!printed && contact.sources.some(s => s.type === 'theorg')) source += 1;
  if (contact.sources.some(s => s.type === 'provider')) source += 0.5;
  const score = confidence * 2 + persona + source;
  // A domain without MX: still listed (the employer printed it), ranked low.
  return contact.mx === false ? score / 2 : score;
}

/**
 * Contacts by score; at equal score, the person higher in line for this role
 * (teamRank) first, then an inbox the mailbox words name (contact@, info@)
 * before one an unknown word makes generic.
 */
export function rankContacts(contacts = []) {
  return contacts
    .map(contact => ({ ...contact, score: Number(scoreContact(contact).toFixed(2)) }))
    .filter(contact => contact.score > 0 && contact.kind !== 'avoid')
    .sort((a, b) => b.score - a.score || (a.teamRank ?? 9) - (b.teamRank ?? 9) || knownInbox(b) - knownInbox(a));
}

/**
 * Why a contact is not drafted for without asking, or '' when it may be:
 * a guess, a domain without MX, an address printed only on a privacy or
 * press page, a help desk, an address at a company domain the search could
 * not confirm or one only that unconfirmed site prints (a sibling ccTLD:
 * info@lindy.de on a namesake's lindy.com), with no employer site an
 * address that neither carries the company's name nor is a hiring inbox in
 * the posting's text (noSite: { company, textEmails }), a staff member's
 * own address no name claimed (personalLocal), or a person whose role is
 * not this offer's (teamRank 4
 * or 5: another manager, another department, an unknown role).
 * namePattern: the site's naming pattern (patternEvidence); nameTokens: the
 * folded words of every person's name the run found.
 */
export function bestBlocker(contact, { domainConfirmed = true, domain = '', noSite = null, namePattern = '', nameTokens = null } = {}) {
  if (contact.confidence === 'guess') return 'adresse devinée';
  if (contact.mx === false) return 'domaine sans MX';
  if (foundOnlyOnPolicyPages(contact)) return 'page confidentialité ou presse';
  if (isHelpDesk(contact)) return 'boîte support';
  if (contact.kind === 'generic' && personalLocal(contact, { namePattern, nameTokens })) return 'adresse personnelle non identifiée';
  if (domain && !domainConfirmed && (contactDomain(contact) === domain || foundOnlyOnSite(contact))) return 'site non confirmé';
  // contact@taleez.com in an ATS page's footer is the platform's.
  if (!domain && noSite && !domainMatchesCompany(contactDomain(contact), noSite.company) && !(contact.kind === 'hiring' && noSite.textEmails?.has(contact.email))) return 'employeur non vérifié';
  if (contact.kind === 'person' && contact.teamRank >= 4) return 'rôle sans lien avec l\'offre';
  return '';
}

/** The contact worth drafting for without asking: a verified or likely address with no blocker. */
export function pickBest(ranked = [], { domainConfirmed = true, domain = '', noSite = null, namePattern = '', nameTokens = null } = {}) {
  return ranked.find(contact => !bestBlocker(contact, { domainConfirmed, domain, noSite, namePattern, nameTokens })) || null;
}

/**
 * Is a contact classed as an inbox really a staff member's own address? No
 * mailbox word explains its local part, it is not the company's own name
 * (riot@riot.co), and either it is a word of a name the run found (nicolas@
 * with two Nicolas on the team), it reads like first.last (milan.novak@,
 * kept from the people by its city word), or it is one word on a site whose
 * people write first@ (aji@ beside adina@ = Adina Popa).
 */
function personalLocal(contact, { namePattern = '', nameTokens = null } = {}) {
  const local = String(contact.email || '').split('@')[0].toLowerCase();
  if (!local || mailboxKind(local)) return false;
  const label = contactDomain(contact).split('.')[0];
  if (local.replace(/[^a-z0-9]/g, '') === label.replace(/-/g, '') || label.split('-').includes(local)) return false;
  if (nameTokens?.has(local)) return true;
  // boutique.paris@ and web.shop@ are made of service and place words only.
  if (looksLikePersonLocal(local) && local.split(/[^a-z]+/).some(piece => piece && !NOT_NAME_PIECES.has(piece))) return true;
  return namePattern === 'first' && /^[a-z]{2,}$/.test(local);
}

// Contact kind from a local part: a department inbox counts as generic.
function contactKind(local) {
  const kind = mailboxKind(local);
  return kind === 'department' ? 'generic' : kind;
}

// Contact kind for an address extractEmails classified: a single unknown
// word ("nicolas@") or a department inbox is generic until a name pairs it.
function foundKind(kind) {
  return kind === 'other' || kind === 'department' ? 'generic' : kind;
}

// Labels that send an address to privacy, press, investors, partners, sales,
// new business, suppliers or billing, in English, French and German
// ("Vertrieb:", "Datenschutzbeauftragter:", "Ventes :", "Devis :").
// "Délégué" alone is not one: a Belgian administrateur délégué runs the
// company.
const LABEL_AVOID_RE = /(?<![\p{L}])(?:dpo|data protection|protection des donn[ée]es|donn[ée]es personnelles|vie priv[ée]e|privacy|d[ée]l[ée]gu[ée]e? (?:à|a) la protection|rgpd|gdpr|exercer vos droits|your rights|press|presse|journalists?|journalistes?|investors?|investisseurs?|partenariats?|partnerships?|sales|commercial|new business|business development|suppliers?|fournisseurs?|achats|procurement|accounts payable|billing|factur\p{L}*|ventes?|devis|vertrieb|verkauf|einkauf|buchhaltung|rechnung\p{L}*|datenschutz\p{L}*)(?![\p{L}])/iu;

/**
 * Does the label of an address call it a privacy, press, partnership, sales
 * or billing contact? `text` is the page text (lines kept) or the context
 * extractEmails gave. The label is the words just before the address on its
 * line (the line above when the address opens its line), back to the
 * previous address or sentence ("Contact: support@x, dpo@x" does not label
 * support@; "Press is here. Write to hello@x" does not label hello@), plus
 * a parenthesis right after it ("anna@x (partnerships)").
 */
export function labelSaysAvoid(text, email) {
  const address = String(email || '').toLowerCase();
  const lines = String(text || '').split('\n');
  const index = address ? lines.findIndex(line => line.toLowerCase().includes(address)) : -1;
  if (index < 0) return false;
  const line = lines[index];
  const at = line.toLowerCase().indexOf(address);
  let before = line.slice(0, at);
  // "Délégué à la protection des données" on the line above the address.
  if (!/[\p{L}\p{N}]/u.test(before)) before = `${lines[index - 1] || ''} ${before}`;
  before = before.slice(-50);
  const previous = [...before.matchAll(EMAIL_IN_TEXT_RE)].pop();
  if (previous) before = before.slice(previous.index + previous[0].length);
  const sentence = [...before.matchAll(/[.!?;|•·](?=\s)/g)].pop();
  if (sentence) before = before.slice(sentence.index + 1);
  const after = line.slice(at + address.length).match(/^\s*\(([^()]{0,40})\)/)?.[1] || '';
  return LABEL_AVOID_RE.test(`${before} ${after}`);
}

function contactFor({ email, firstName = '', lastName = '', title = '', kind = '', persona = '', confidence = 'guess', source, linkedinUrl = '' }) {
  const local = String(email).split('@')[0];
  const resolvedKind = kind || (firstName ? 'person' : contactKind(local) || 'other');
  if (resolvedKind === 'person' && !firstName) ({ firstName, lastName } = nameFromLocal(local));
  return {
    email: String(email).toLowerCase(),
    firstName, lastName, title,
    kind: resolvedKind,
    persona: persona || inferPersona({ title, mailboxKind: resolvedKind === 'person' ? '' : resolvedKind, isRoleMailbox: resolvedKind !== 'person' }),
    confidence,
    sources: source ? [source] : [],
    linkedinUrl,
    mx: null,
  };
}

// One person whatever the accents: "Hélène Durand" on the site and "Helene
// Durand" on TheOrg are one entry (the first spelling seen is kept).
function personKey(person) {
  return `${foldName(person.firstName)} ${foldName(person.lastName)}`;
}

function rememberPerson(people, person) {
  const key = personKey(person);
  const prev = people.get(key);
  const entry = { ...person, sources: person.sources || [{ type: person.source, url: person.sourceUrl || person.linkedinUrl || '', detail: person.evidence || '' }] };
  if (!prev) { people.set(key, entry); return entry; }
  prev.title = prev.title || entry.title;
  if (prev.persona === 'unknown' && entry.persona !== 'unknown') prev.persona = entry.persona;
  prev.linkedinUrl = prev.linkedinUrl || entry.linkedinUrl || '';
  for (const source of entry.sources) {
    if (!prev.sources.some(s => s.type === source.type && s.url === source.url)) prev.sources.push(source);
  }
  return prev;
}

const foldName = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const C_LEVEL_RE = /(?<![\p{L}])(?:ceo|cto|cpo|coo|cmo|cfo|cro|cdo|chro|ciso)(?![\p{L}])/gu;

// Two mentions of one person: the same C-level word, or both lead the
// company or a team (founder, hiring manager), or both recruit.
function sameRole(a, b) {
  const words = title => new Set(String(title || '').toLowerCase().match(C_LEVEL_RE) || []);
  const theirs = words(b.title);
  if ([...words(a.title)].some(word => theirs.has(word))) return true;
  const group = persona => (persona === 'founder' || persona === 'hiring-manager' ? 'lead' : persona === 'recruiter' ? 'recruiter' : '');
  return Boolean(group(a.persona)) && group(a.persona) === group(b.persona);
}

/**
 * A posting person known by first name only ("I'm Grigory, co-founder and
 * CTO") merges into the one full-name person with that first name (accents
 * aside) and a compatible role (Grigory Emelianov, CTO). Sources are joined
 * and the posting's title is kept. Mutates and returns the people map.
 */
export function mergePostingPeople(people) {
  for (const [key, person] of [...people]) {
    if (person.lastName || !person.sources?.some(source => source.type === 'posting')) continue;
    const first = foldName(person.firstName);
    const namesakes = [...people.values()].filter(other => other !== person && other.lastName && foldName(other.firstName) === first);
    if (namesakes.length !== 1 || !sameRole(person, namesakes[0])) continue;
    const target = namesakes[0];
    for (const source of person.sources) {
      if (!target.sources.some(s => s.type === source.type && s.url === source.url)) target.sources.push(source);
    }
    if (person.title) target.title = person.title;
    if (person.persona && person.persona !== 'unknown') target.persona = person.persona;
    people.delete(key);
  }
  return people;
}

// Patterns an address may show for a name printed next to it.
const PAIR_PATTERNS = ['first', 'flast', 'f.last', 'first.last', 'firstlast', 'last'];

/**
 * Printed addresses matched to named people: an address pairs with a person
 * when it follows one of PAIR_PATTERNS for their name and no other person
 * fits it (nicolas@ and "Nicolas Bégin"; two Nicolas, no pair). When no
 * pattern fits anyone, a local equal to one later word of exactly one
 * person's name pairs too, as pattern 'middle' (aji@ and "Ahmad Aji
 * Santoso"): their address, but no evidence of the site's pattern. Role and
 * department mailboxes never pair. entries: [{ email, url }]. Returns
 * [{ email, url, person, pattern }].
 */
export function pairAddressesWithPeople(entries = [], people = []) {
  const out = [];
  const seen = new Set();
  for (const entry of entries) {
    const email = String(entry?.email || '').toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    const local = email.split('@')[0];
    if (!nameLikeLocal(local)) continue;
    const fits = people
      .map(person => ({ person, pattern: detectPattern(email, person.firstName, person.lastName, { patterns: PAIR_PATTERNS }) }))
      .filter(item => item.pattern);
    if (fits.length === 1) out.push({ email, url: entry.url || '', person: fits[0].person, pattern: fits[0].pattern });
    if (fits.length || !/^[a-z]{3,}$/.test(local)) continue;
    const middle = people.filter(person => foldName(`${person.firstName} ${person.lastName}`).split(/[^a-z]+/).filter(Boolean).slice(1).includes(local));
    if (middle.length === 1) out.push({ email, url: entry.url || '', person: middle[0], pattern: 'middle' });
  }
  return out;
}

/**
 * The site's naming pattern and what shows it. Paired addresses
 * (votes: [{ pattern, email, url, name, compound }]) win by majority and make
 * guesses 'likely'. Else the shape of person addresses (shapeEmails:
 * [{ email, url, printed }]): 'likely' when 2+ distinct addresses agree,
 * make 60% of the shapes and have their name printed beside them (printed
 * defaults to true), otherwise it only orders the guesses ('guess').
 */
export function patternEvidence(votes = [], shapeEmails = []) {
  const top = groups => [...groups.entries()].sort((a, b) => b[1].length - a[1].length || PATTERNS.indexOf(a[0]) - PATTERNS.indexOf(b[0]))[0];
  if (votes.length) {
    const groups = new Map();
    for (const vote of votes) groups.set(vote.pattern, [...(groups.get(vote.pattern) || []), vote]);
    const [pattern, chosen] = top(groups);
    return {
      pattern, support: chosen.length, basis: 'paired', confidence: 'likely',
      sources: [...new Set(chosen.map(vote => vote.url).filter(Boolean))],
      examples: chosen.slice(0, 3).map(vote => `${vote.email.split('@')[0]}@ = ${vote.name}`),
      compound: chosen.some(vote => vote.compound),
    };
  }
  const groups = new Map();
  const seen = new Set();
  let total = 0;
  for (const item of shapeEmails) {
    const email = String(item?.email || '').toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    const local = email.split('@')[0];
    const pattern = localKind(local) === 'person' ? shapePattern(local) : '';
    if (!pattern) continue;
    total += 1;
    groups.set(pattern, [...(groups.get(pattern) || []), { email, url: item.url || '', printed: item.printed !== false }]);
  }
  if (!total) return { pattern: '', support: 0, basis: '', confidence: '', sources: [], examples: [], compound: false };
  const [pattern, chosen] = top(groups);
  return {
    pattern, support: chosen.length, basis: 'shape',
    confidence: chosen.filter(item => item.printed).length >= 2 && chosen.length / total >= 0.6 ? 'likely' : 'guess',
    sources: [...new Set(chosen.map(item => item.url).filter(Boolean))],
    examples: chosen.slice(0, 3).map(item => item.email),
    compound: false,
  };
}

// The pattern guesses start with: the site's when it is likely, else the
// provider's, else the site's weak one (it only orders the guesses).
function guessOrder(evidence, providerPattern = '') {
  return evidence.confidence === 'likely' ? evidence.pattern : providerPattern || evidence.pattern;
}

// Confidence and source detail of a pattern-built address.
function guessConfidence({ evidence, providerPattern = '', pattern, lastName = '' }) {
  if (evidence.confidence === 'likely' && pattern === evidence.pattern) {
    const detail = evidence.basis === 'paired' ? `schéma du site : ${evidence.examples[0]}` : `schéma du site : ${pattern} (${evidence.support} adresses)`;
    // A compound name ("Le Roux") on a pattern seen only on simple names stays a guess.
    if (compoundLastName(lastName) && !evidence.compound) return { confidence: 'guess', detail: `${detail}, nom composé` };
    return { confidence: 'likely', detail };
  }
  if (providerPattern && pattern === providerPattern) return { confidence: 'likely', detail: `schéma du site : ${pattern}` };
  if (evidence.pattern && pattern === evidence.pattern) {
    return { confidence: 'guess', detail: `schéma probable : ${pattern} (${evidence.support} adresse${evidence.support > 1 ? 's' : ''} du site)` };
  }
  return { confidence: 'guess', detail: `schéma courant : ${pattern}` };
}

/**
 * The model may only list people the page names: the full name as whole
 * words, or the first and last names within one short span (a card that
 * puts them on two lines). A bare last name somewhere on the page ("Martin
 * Street") is not enough.
 */
export function nameOnPage(text, { firstName = '', lastName = '' } = {}) {
  const page = String(text || '');
  if (!firstName) return false;
  const word = value => `(?<![\\p{L}])${escapeReLiteral(value)}(?![\\p{L}])`;
  if (!lastName) return new RegExp(word(firstName), 'u').test(page);
  if (new RegExp(`${word(firstName)}\\s+${word(lastName)}`, 'u').test(page)) return true;
  return new RegExp(`${word(firstName)}[\\s,:|·•-]{1,40}${word(lastName)}|${word(lastName)}[\\s,:|·•-]{1,40}${word(firstName)}`, 'u').test(page);
}

function escapeReLiteral(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Is the title the line just above or below a line that is the full name?
function titleNextToName(text, full, title) {
  const lines = String(text || '').split('\n').map(line => line.trim().toLowerCase());
  const wanted = String(title || '').trim().toLowerCase();
  const name = String(full || '').trim().toLowerCase();
  return lines.some((line, index) => line === name && (lines[index - 1] === wanted || lines[index + 1] === wanted));
}

/**
 * Is the name an address spells printed on the page that shows it, accents
 * aside: each piece of two letters or more as a capitalised word, all within
 * one short span ("marie.dupont@" next to "Marie Dupont" or "Dupont, Marie",
 * "m.dupont@" next to "Dupont")? Only such addresses show the site's naming
 * pattern by their shape: a role inbox spells nobody printed there.
 */
export function addressNamePrinted(text, local) {
  const pieces = String(local || '').toLowerCase().split(/[._-]+/).filter(piece => piece.length >= 2);
  if (!pieces.length || pieces.length > 3 || pieces.some(piece => !/^[a-z]+$/.test(piece))) return false;
  const page = String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  const word = piece => `(?<![\\p{L}])${piece.charAt(0).toUpperCase()}${piece.slice(1)}(?![\\p{L}])`;
  const span = list => list.map(word).join('[\\s,:|·•\'’-]{1,40}');
  return new RegExp(`${span(pieces)}|${span([...pieces].reverse())}`, 'u').test(page);
}

function mergeContact(map, contact) {
  const prev = map.get(contact.email);
  if (!prev) { map.set(contact.email, contact); return; }
  const rank = { verified: 3, likely: 2, guess: 1 };
  if ((rank[contact.confidence] || 0) > (rank[prev.confidence] || 0)) prev.confidence = contact.confidence;
  prev.firstName = prev.firstName || contact.firstName;
  prev.lastName = prev.lastName || contact.lastName;
  prev.title = prev.title || contact.title;
  prev.linkedinUrl = prev.linkedinUrl || contact.linkedinUrl;
  if (prev.kind === 'other' && contact.kind !== 'other') prev.kind = contact.kind;
  if (prev.persona === 'unknown' && contact.persona !== 'unknown') prev.persona = contact.persona;
  for (const source of contact.sources) {
    if (!prev.sources.some(s => s.type === source.type && s.url === source.url)) prev.sources.push(source);
  }
}

function sameLanguageAs(text) {
  const words = String(text || '').toLowerCase().match(/\b\p{L}+\b/gu) || [];
  const count = re => words.filter(w => re.test(w)).length;
  const scores = [
    ['en', count(/^(?:the|and|with|for|of|to|in|you|our)$/)],
    ['fr', count(/^(?:le|la|les|et|avec|pour|des|du|dans|vous|nous|une)$/)],
    ['de', count(/^(?:der|die|und|wir|sie|mit|für)$/)],
  ];
  return scores.reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0];
}

// What a title or a company name says of its language when no posting text
// was read (Glassdoor 403): "Designerin (w/m/d)", "GmbH" → de; "(H/F)",
// "SAS", "Chargé de…" → fr.
const DE_MARKER_RE = /\((?:[mwfdx]\s*\/\s*){2}[mwfdx]\)|(?<![\p{L}])(?:gmbh|ag|kg|ug|werkstudent\p{L}*|praktikant\p{L}*|mitarbeiter\p{L}*|leiter\p{L}*|entwickler\p{L}*|gestalter\p{L}*|berater\p{L}*)(?![\p{L}])|\p{L}{3,}erin(?![\p{L}])/iu;
const FR_MARKER_RE = /\((?:h\s*\/\s*f|f\s*\/\s*h)\)|(?<![\p{L}])(?:sas|sasu|sarl|charg[ée]e?|d[ée]veloppeu(?:r|se)|stagiaire|alternance|alternant\p{L}*|chef de projet)(?![\p{L}])/iu;
const LANGUAGE_WORD_RE = /^(?:the|and|with|for|of|to|in|you|our|le|la|les|et|avec|pour|des|du|dans|vous|nous|une|der|die|und|wir|sie|mit|für)$/;

/**
 * The language the name guess builds domains for: the posting's when its
 * text tells, else the markers of the role and company, else '' (unknown:
 * the guess tries .de and .fr beside the usual TLDs). Europace's unreadable
 * posting "Product Designerin (w/m/d)" gave 'en', so europace.de was never tried.
 */
function guessLanguage(jobText, role = '', company = '') {
  const words = String(jobText || '').toLowerCase().match(/\b\p{L}+\b/gu) || [];
  if (words.some(word => LANGUAGE_WORD_RE.test(word))) return sameLanguageAs(jobText);
  const hint = `${role || ''} ${company || ''}`;
  if (DE_MARKER_RE.test(hint)) return 'de';
  if (FR_MARKER_RE.test(hint)) return 'fr';
  return '';
}

// One crawl's fetch limit: 404s, duplicates and shells cost an attempt, not
// a page of the maxPages budget.
const MAX_CRAWL_ATTEMPTS = 14;

/**
 * Bucketed pages from the site's sitemap: the Sitemap: lines of robots.txt,
 * else /sitemap.xml; two sitemap documents at most (a sitemap index leads to
 * its page sitemap), so three fetches with robots.txt. Returns [{url, bucket}].
 */
async function sitemapCandidates(origin, { fetchPage, limit = 7, locale = '', log = () => {} } = {}) {
  let baseDomain = '';
  try { baseDomain = registrableDomain(new URL(origin).hostname); } catch { return []; }
  const sameSite = value => {
    try { const url = new URL(value); return /^https?:$/.test(url.protocol) && registrableDomain(url.hostname) === baseDomain; } catch { return false; }
  };
  const get = async url => {
    try { return await fetchPage(url, { as: 'xml' }); } catch (err) { log(`sitemap ${url} failed: ${err.message}`); return null; }
  };
  // Posts, products and images last: the pages sitemap holds /contact.
  const childRank = url => {
    const name = String(url).split('/').pop().replace(/sitemaps?/gi, '');
    return /page|main|static/i.test(name) ? 0 : /post|blog|news|product|image|video|tag|categor|author|job/i.test(name) ? 2 : 1;
  };
  const robots = await get(`${origin}/robots.txt`);
  const robotsText = robots?.ok ? String(robots.text || robots.html || '') : '';
  const pointers = [...robotsText.matchAll(/^[ \t]*sitemap:[ \t]*(\S+)/gim)].map(m => m[1]).filter(url => sameSite(url) && !/\.gz$/i.test(url));
  const queue = [...new Set([...pointers, `${origin}/sitemap.xml`])];
  const tried = new Set();
  const locs = [];
  let fetched = 0;
  while (queue.length && fetched < 2) {
    const next = queue.shift();
    if (tried.has(next)) continue;
    tried.add(next);
    fetched += 1;
    const doc = await get(next);
    const body = doc?.ok ? [doc.text, doc.html].map(value => String(value || '')).find(value => /<(?:urlset|sitemapindex)\b/i.test(value)) || '' : '';
    if (!body) continue;
    const entries = sitemapLocs(body).filter(sameSite);
    if (/<sitemapindex\b/i.test(body)) {
      queue.unshift(...entries.filter(url => !tried.has(url)).sort((a, b) => childRank(a) - childRank(b)).slice(0, 3));
      continue;
    }
    locs.push(...entries);
    if (rankCrawlCandidates(locs.map(href => ({ href, label: '' })), origin, { limit, locale }).length >= 3) break;
  }
  return rankCrawlCandidates(locs.map(href => ({ href, label: '' })), origin, { limit, locale });
}

// A person's or a contact's place in line for this offer: 0 when the
// posting names them, else their roleRank (recruiter, team lead, founder,
// other manager, another department or unknown).
function teamRank(person, ranking) {
  return person.sources?.some(source => source.type === 'posting') ? 0 : roleRank(person, ranking);
}

/**
 * People in the order their addresses are built: those the posting names,
 * then recruiters, the leads of this role's team, founders, other managers,
 * and last the managers of other departments and unknown roles (teamRank),
 * page order kept within each. The guess cap keeps this order, so a team
 * page's account managers never take the three guess slots ahead of its
 * recruiters.
 */
function peopleForGuesses(people, ranking = {}) {
  return [...people].map((person, index) => ({ person, index, rank: teamRank(person, ranking) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(item => item.person);
}

// The team pass: 6000 characters a call, two calls a page, three a search.
const MODEL_CHUNK = 6000;
const MODEL_CALLS_PER_PAGE = 2;
const MODEL_CALLS_PER_RUN = 3;

/**
 * What one page sends to the model: 6000 characters from 300 before its
 * first card line (cut at line ends), then the next 6000 when the page is
 * longer. A page with no card starts at its top.
 */
function modelWindows(text, firstCardAt = -1) {
  const page = String(text || '');
  let start = 0;
  if (firstCardAt > 300) {
    const lineStart = page.lastIndexOf('\n', firstCardAt - 300);
    start = lineStart >= 0 ? lineStart + 1 : 0;
  }
  const windows = [];
  while (windows.length < MODEL_CALLS_PER_PAGE && start < page.length) {
    let end = Math.min(page.length, start + MODEL_CHUNK);
    if (end < page.length) {
      const lineEnd = page.lastIndexOf('\n', end);
      if (lineEnd > start + MODEL_CHUNK / 2) end = lineEnd;
    }
    const chunk = page.slice(start, end);
    if (chunk.trim()) windows.push(chunk);
    start = end + 1;
  }
  return windows;
}

/**
 * The calls of the optional model pass, in order: team-like pages (URL or
 * menu label) first, then by card density (name lines followed by title
 * lines), then about pages. The home page only with 3+ cards (its menu says
 * "Team" on every site); a page whose deterministic passes already named 5+
 * people needs no model. Returns [{ page, text }].
 */
function modelCallsFor(home, pages, { maxCalls = MODEL_CALLS_PER_RUN } = {}) {
  const candidates = pages
    .map((page, index) => ({ page, index }))
    .filter(({ page }) => page.teamLike || page.cards > 0 || page.bucket === 'about');
  if (home && home.cards >= 3) candidates.push({ page: home, index: pages.length });
  const ranked = candidates
    .filter(({ page }) => (page.named || 0) < 5)
    .sort((a, b) => Number(Boolean(b.page.teamLike)) - Number(Boolean(a.page.teamLike)) || (b.page.cards || 0) - (a.page.cards || 0) || a.index - b.index);
  const calls = [];
  for (const { page } of ranked) {
    for (const text of modelWindows(page.text, page.firstCardAt)) {
      if (calls.length >= maxCalls) return calls;
      calls.push({ page, text });
    }
  }
  return calls;
}

// Home pages read at most for a guess from the name: every candidate that
// receives mail (riot.ai, riot.co, riot.app and tryriot.com all do; reading
// three left the real one unread), fetched together.
const MAX_NAME_GUESS_FETCHES = 10;

function pageTitle(html) {
  return decodeEntities(String(html || '').match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim();
}

// Words too common on home pages and in postings to tie one to the other.
const COMMON_WORDS = new Set([
  'about', 'after', 'their', 'there', 'these', 'those', 'which', 'while', 'where', 'would', 'could', 'should', 'other', 'every',
  'being', 'under', 'within', 'through', 'across', 'between', 'before', 'during', 'without', 'around', 'world', 'people', 'company',
  'companies', 'business', 'businesses', 'product', 'products', 'design', 'designer', 'designers', 'digital', 'platform', 'solution',
  'solutions', 'service', 'services', 'software', 'online', 'global', 'leading', 'build', 'building', 'teams', 'working', 'remote',
  'hybrid', 'experience', 'years', 'skills', 'great', 'together', 'create', 'customer', 'customers', 'clients', 'client', 'users',
  'value', 'values', 'mission', 'culture', 'growth', 'hiring', 'career', 'careers', 'apply', 'application', 'position', 'offer',
  'offers', 'salary', 'benefits', 'location', 'office', 'based', 'startup', 'market', 'using', 'including', 'ability', 'strong',
  'looking', 'joining', 'contact', 'learn', 'discover', 'welcome', 'today', 'first', 'innovative', 'modern', 'simple', 'better',
  'quality', 'support', 'partner', 'partners', 'project', 'projects', 'management', 'manager', 'senior', 'junior', 'engineer',
  'engineering', 'developer', 'development', 'technology', 'technologies', 'tools', 'europe', 'european', 'france', 'germany',
  'london', 'paris', 'berlin', 'amsterdam', 'votre', 'notre', 'entreprise', 'equipe', 'poste', 'profil', 'missions', 'projet',
  'projets', 'creation', 'developpement', 'candidat', 'recherche', 'rejoindre', 'travail', 'travailler', 'plusieurs', 'depuis',
  'leurs', 'cette', 'toute', 'toutes', 'autres', 'ainsi', 'aussi', 'unser', 'unsere', 'unseren', 'werden', 'haben', 'durch',
  'ihre', 'ihren', 'sowie', 'unternehmen', 'arbeiten', 'kunden', 'mitarbeiter', 'bereich', 'deine', 'deinen', 'cookies', 'privacy',
]);

// Distinctive words of a text: five letters or more, unaccented, neither
// common nor the company's own name.
function distinctiveWords(text, company) {
  const own = new Set(companyTokens(company));
  return new Set(plainWords(text).filter(word => word.length >= 5 && !/\d/.test(word) && !COMMON_WORDS.has(word) && !own.has(word)));
}

/**
 * What ties a guessed site to the offer: it links the offer's board, the
 * posting mentions its domain, or its home page and the posting share two
 * distinctive words ("security awareness training"). '' when nothing does.
 * Only 'board' and 'mention' confirm a pick: 'words' is a log hint, since a
 * namesake's page shares as many words with a posting as the real site's
 * (riot.co, a studio, and a Riot posting: "ambitious", "actually", "enjoy").
 */
function guessCorroboration(home, { domain, company, jobUrl, jobText = '', jobHtml = '' }) {
  const html = String(home?.html || '');
  if (linksToBoard(html, jobUrl)) return 'board';
  const mention = new RegExp(`(?<![a-z0-9.-])(?:www\\.)?${escapeReLiteral(domain)}(?![a-z0-9-])`, 'i');
  if (mention.test(String(jobText)) || mention.test(String(jobHtml))) return 'mention';
  const descriptions = [...html.matchAll(/<meta\b[^>]*>/gi)]
    .filter(([tag]) => /(?:name|property)\s*=\s*["'](?:description|og:description)["']/i.test(tag))
    .map(([tag]) => decodeEntities(tag.match(/content\s*=\s*["']([^"']*)["']/i)?.[1] || ''));
  const homeWords = distinctiveWords([pageTitle(html), ...descriptions, String(home?.text || pageText(html)).slice(0, 4000)].join(' '), company);
  const postingWords = distinctiveWords(String(jobText).slice(0, 6000), company);
  return [...homeWords].filter(word => postingWords.has(word)).length >= 2 ? 'words' : '';
}

/**
 * The company's site guessed from its name (guessDomainsFromName): the home
 * page of every candidate that receives mail is read, and a parked page, one
 * that does not name the company or one that redirects to a domain without
 * the name (riot.ai → riotgames.com) is out. One left is the pick; with
 * several, the only one linking the offer's board or named in the posting
 * is. The pick is confirmed only when it links the offer's board or the
 * posting names its domain (guessCorroboration 'board' or 'mention'; shared
 * words never confirm). Returns { pick: { domain, origin, title } | null,
 * confirmed, choices: [{ domain, title }] }.
 */
async function siteFromName(company, { language, jobUrl, jobText = '', jobHtml = '', resolveMx, verifyHome, homes, log = () => {} }) {
  const candidates = guessDomainsFromName(company, { language, tokensOf: companyTokens });
  const mx = await Promise.all(candidates.map(candidate => Promise.resolve().then(() => resolveMx(candidate)).catch(() => null)));
  const open = candidates.filter((candidate, index) => mx[index] === true).slice(0, MAX_NAME_GUESS_FETCHES);
  const pages = await Promise.all(open.map(candidate => verifyHome(`https://${candidate}`)));
  const named = new Map();
  for (const [index, candidate] of open.entries()) {
    const home = pages[index];
    if (!home?.ok || isParkedPage(home.html) || !homepageNamesCompany(home.html, company)) continue;
    // A candidate that redirects (getlindy.com → lindy.ai) is the site it lands on.
    let origin = `https://${candidate}`;
    try { origin = new URL(home.url || origin).origin; } catch { /* keep the candidate */ }
    let domain = '';
    try { domain = registrableDomain(new URL(origin).hostname); } catch { domain = ''; }
    if (!domain || isNotEmployerHost(domain, { company }) || named.has(domain)) continue;
    if (domain !== registrableDomain(candidate) && !domainMatchesCompany(domain, company)) {
      log(`name guess ${candidate} redirects to ${domain}, which does not carry "${company}"`);
      continue;
    }
    homes.set(origin, home);
    named.set(domain, { domain, origin, title: pageTitle(home.html), tie: guessCorroboration(home, { domain, company, jobUrl, jobText, jobHtml }) });
  }
  log(`name guess "${company}": ${[...named.values()].map(item => `${item.domain}${item.tie ? ` (${item.tie})` : ''}`).join(', ') || 'no named site'} (${open.length} home page(s) read)`);
  const passed = [...named.values()];
  const strong = passed.filter(item => item.tie === 'board' || item.tie === 'mention');
  const pick = passed.length === 1 ? passed[0] : strong.length === 1 ? strong[0] : null;
  if (pick) return { pick: { domain: pick.domain, origin: pick.origin, title: pick.title }, confirmed: pick.tie === 'board' || pick.tie === 'mention', choices: [] };
  return { pick: null, confirmed: false, choices: passed.map(({ domain, title }) => ({ domain, title })) };
}

/**
 * The whole search for one offer. Network goes through the injected
 * functions; everything else is deterministic and covered by tests.
 */
// Pattern-built addresses kept at most (Hugo: real addresses first, few guesses).
export const MAX_GUESSES = 3;
// Staff members' own printed addresses listed at most (the rest are counted).
export const MAX_STAFF_CONTACTS = 12;
const ABORTED_NOTE = 'Recherche interrompue : la fenêtre a été fermée.';

export async function findContacts({ company = '', role = '', jobUrl = '', jobText = '', jobHtml = '', companyUrlHint = '', ownEmails = [] } = {}, {
  fetchPage,
  webSearch = null,
  providers = [],
  extractPeople = null,
  judgePeople = null,
  resolveMx = domainAcceptsMail,
  maxPages = 8,
  maxSearches = 4,
  // Providers found unavailable, by name → time until which they are skipped.
  providerOutages = PROVIDER_OUTAGES,
  now = Date.now,
  // Aborted when the modal closes: the run returns at the next step, page or
  // search. Past deadlineMs (0 = none) the remaining searches and pages are
  // skipped and the run ends with what it has.
  signal = null,
  deadlineMs = 0,
  log = () => {},
  onStatus = () => {},
} = {}) {
  if (typeof fetchPage !== 'function') throw new Error('findContacts needs fetchPage');
  const notes = [];
  const searches = [];
  // Per search, for the run diagnostics: { persona, query, results, parsed, kept }.
  const queryStats = [];
  const pagesRead = [];
  const contacts = new Map();
  const people = new Map();
  // A placeholder ("?", "Stealth Startup") is no name to search, and a job
  // title stored as the company falls back to the board the URL names.
  let companyName = searchableCompanyName(company);
  if (companyName && companyLooksLikeRole(companyName, role)) {
    const fromUrl = searchableCompanyName(companyFromJobUrl(jobUrl) || identityFromUrl(jobUrl).company);
    notes.push(`« ${companyName} » est un intitulé de poste, pas une entreprise${fromUrl ? ` : recherche sur ${fromUrl}` : ''}.`);
    companyName = fromUrl;
  }
  let companyOverridden = '';
  const language = sameLanguageAs(jobText);
  // Who matters for this role: the leads of its team and the title the
  // posting reports to (roleRank orders the best contact, the guess slots
  // and the forward target).
  const ranking = { role, leads: teamLeadTitles(role), reportTitle: reportingTitleFromPosting(jobText) };

  // Stop and time limit. aborted(): the caller left (the modal closed),
  // nothing more is worth doing. halted(): no new page fetch or search
  // (aborted, or past the deadline; the deadline note is written once, when
  // something is skipped).
  const runStart = now();
  let pastDeadline = false;
  const aborted = () => Boolean(signal?.aborted);
  const halted = () => {
    if (aborted()) return true;
    if (!pastDeadline && deadlineMs > 0 && now() - runStart >= deadlineMs) {
      pastDeadline = true;
      notes.push('Temps limite atteint : recherche partielle (recherches et pages restantes ignorées).');
      log(`deadline of ${deadlineMs} ms reached: remaining searches and pages skipped`);
    }
    return pastDeadline;
  };
  // A fetch or search in flight ends the moment the caller aborts (the
  // request itself runs out on its own timeout).
  const abortedSoon = signal ? new Promise(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', () => resolve(), { once: true }); }) : null;
  const unlessAborted = (work, fallback) => (abortedSoon ? Promise.race([work, abortedSoon.then(fallback)]) : work);
  const fetchRaw = fetchPage;
  fetchPage = async (...args) => {
    const stopped = { ok: false, status: 0, html: '', text: '', url: String(args[0] || ''), error: aborted() ? 'recherche interrompue' : 'temps limite atteint' };
    if (halted()) return stopped;
    return unlessAborted(fetchRaw(...args), () => ({ ...stopped, error: 'recherche interrompue' }));
  };

  // `usable(results)` tells the search which answer is worth keeping: an
  // engine whose results fail it does not end the search (the server tries
  // the next engine). signal and stopAt (the deadline's clock time, 0 for
  // none) let a search already running stop before its next engine.
  const stopAt = deadlineMs > 0 ? runStart + deadlineMs : 0;
  const search = async (query, { num = 10, usable } = {}) => {
    if (!webSearch || searches.length >= maxSearches || halted()) return [];
    try {
      const results = (await unlessAborted(webSearch(query, { num, usable, signal, stopAt }), () => [])) || [];
      searches.push({ query, results: results.length });
      log(`search "${query.slice(0, 80)}" → ${results.length}`);
      return results;
    } catch (err) {
      searches.push({ query, results: 0, error: err.message });
      log(`search failed "${query.slice(0, 60)}": ${err.message}`);
      return [];
    }
  };

  // 1. The company's own domain. Confirmed when the employer pointed at it
  // (hint, job page, posting) or its home page names the company; a search
  // pick whose home page could not be read stays unconfirmed.
  onStatus('Site de l\'entreprise');
  let domain = '';
  let website = '';
  let domainSource = '';
  let domainConfirmed = false;
  const adopt = (url, source, confirmed = true) => {
    const parsed = new URL(url);
    domain = registrableDomain(parsed.hostname);
    website = domain ? parsed.origin : '';
    domainSource = domain ? source : '';
    domainConfirmed = Boolean(domain) && confirmed;
  };
  // Sites whose home page was read and does not name the company: their
  // addresses on the posting page are the platform's (a footer's
  // contact@taleez.com), never the employer's.
  const refuted = new Set();
  // Home pages read while checking a candidate site, reused by step 3.
  const homes = new Map();
  const verifyHome = async (url) => {
    if (!homes.has(url)) {
      let page;
      try { page = await fetchPage(url); } catch (err) { page = null; log(`home page ${url} failed: ${err.message}`); }
      homes.set(url, page || { ok: false, status: 0, html: '', text: '', url, error: 'no answer' });
    }
    return homes.get(url);
  };
  // The domain a read home page landed on when a redirect took it off the
  // candidate's domain to one without the company's name (an old domain
  // sold on, a brand moved under another company): that page says nothing
  // about the candidate, which is not taken. '' otherwise.
  const landedElsewhere = (home, site) => {
    if (!home?.ok) return '';
    let landed = '';
    try { landed = registrableDomain(new URL(String(home.url || '')).hostname); } catch { landed = ''; }
    return landed && landed !== site && !domainMatchesCompany(landed, companyName) ? landed : '';
  };
  const movedNote = (site, landed) => `Le site ${site} redirige vers ${landed}, qui ne porte pas le nom « ${companyName} » : ignoré.`;
  // The modal closed: what was learned so far, no contact (nobody reads it).
  const abortedResult = () => {
    if (!notes.includes(ABORTED_NOTE)) notes.push(ABORTED_NOTE);
    log('stopped: the page was closed');
    return {
      company: { name: companyName, domain, website, source: domainSource, confirmed: domainConfirmed, overridden: companyOverridden },
      domainChoices: [],
      companyText: '',
      contacts: [],
      best: null,
      people: [...people.values()],
      patternEvidence: { pattern: '', support: 0, basis: '', confidence: '', sources: [], examples: [] },
      searches,
      pagesRead,
      providersUsed: [],
      notes,
      stopped: 'aborted',
      diagnostics: { domainSource, queries: queryStats, peopleBySource: peopleBySource(people.values()), theorg: { url: '', people: 0, verdict: '' }, pattern: { pattern: '', support: 0, basis: '' } },
    };
  };
  if (aborted()) return abortedResult();
  // A site the user typed (or picked among domainChoices). A job board, a
  // directory or a shared host is never the employer's domain.
  const hinted = absolutize(companyUrlHint);
  if (hinted) {
    try {
      const host = new URL(hinted).hostname;
      if (!isNotEmployerHost(host, { company: companyName })) adopt(hinted, 'hint');
      else notes.push(`Le site indiqué (${host}) est un site d'annonces, un annuaire ou un hébergeur partagé : ignoré.`);
    } catch { /* ignore */ }
  }
  // The job page's JSON-LD (hiringOrganization sameAs / url). A site whose
  // domain does not carry the name (an unlisted board's page about the
  // employer, hello@remoterocketship.com taken for Kinetik Labs') counts
  // only when its home page names the company, like the LinkedIn site below.
  if (!domain) {
    const fromHtml = companyWebsiteFromHtml(jobHtml, companyName);
    let parsed = null;
    try { parsed = fromHtml ? new URL(fromHtml) : null; } catch { parsed = null; }
    const siteDomain = parsed ? registrableDomain(parsed.hostname) : '';
    if (siteDomain && (!companyName || domainMatchesCompany(siteDomain, companyName))) adopt(fromHtml, 'job-page');
    else if (siteDomain) {
      const home = await verifyHome(parsed.origin);
      const moved = landedElsewhere(home, siteDomain);
      if (moved) notes.push(movedNote(siteDomain, moved));
      else if (home.ok && homepageNamesCompany(home.html, companyName)) adopt(fromHtml, 'job-page');
      else if (home.ok) {
        refuted.add(siteDomain);
        notes.push(`Le site ${siteDomain} (page de l'annonce) ne mentionne pas « ${companyName} » : ignoré.`);
      } else notes.push(`Le site ${siteDomain} (page de l'annonce) n'a pas répondu : impossible de vérifier qu'il s'agit de « ${companyName} », ignoré.`);
    }
  }
  // The offer's own ATS account or board names the employer and its site for
  // free (Ashby publicWebsite, Workable url, WTTJ media_website_url): two
  // requests at most, 8 s in all, before any search. The site counts only
  // when its domain carries the company's or the account's name. An account
  // name that shares nothing with the tracker's company replaces it (a
  // "Lindy" row on Ashby board bjakcareer is a Bjak offer); an agency board
  // resolves to the agency, which is who receives the application.
  if (!domain && jobUrl) {
    const accept = (url, owner) => {
      let host = '';
      try { host = new URL(url).hostname; } catch { return false; }
      const site = registrableDomain(host);
      if (!site || isNotEmployerHost(host, { company: companyName }) || WEBMAIL_RE.test(host)) return false;
      return [companyName, owner].some(name => name && domainMatchesCompany(site, name));
    };
    const sources = await lookupEmployerSite(jobUrl, { fetchPage, company: companyName, accept, log });
    const owner = searchableCompanyName(cleanOwnerName(sources.ownerName));
    if (owner && owner !== companyName) {
      // A name read off the URL slug ("Bjakcareer") gives way to the account's own.
      if (!companyName || compactCompany(companyName) === compactCompany(identityFromUrl(jobUrl).company)) companyName = owner;
      else if (boardOwnerDisagrees(companyName, owner, sources.slug)) {
        notes.push(`« ${companyName} » ne correspond pas au compte ATS « ${owner} » : recherche sur ${owner}.`);
        companyOverridden = companyName;
        companyName = owner;
      }
    }
    const root = sources.website ? siteRoot(sources.website) : '';
    if (root) adopt(root, `ats:${sources.ats}`);
    // A board named after a domain (jobs.ashbyhq.com/kraken.com) points at
    // the employer; one that carries another name than the company's must
    // name it on its home page (a "Lindy" row on board careerswift.ai).
    const slugDomain = domain ? null : atsSlugDomain(jobUrl);
    if (slugDomain) {
      const url = `https://${slugDomain.domain}`;
      if (!companyName || accept(url, owner)) adopt(url, `ats:${slugDomain.ats}`);
      else {
        const home = await verifyHome(url);
        const moved = landedElsewhere(home, slugDomain.domain);
        if (moved) notes.push(movedNote(slugDomain.domain, moved));
        else if (home.ok && homepageNamesCompany(home.html, companyName)) adopt(url, `ats:${slugDomain.ats}`);
        else {
          if (home.ok) refuted.add(slugDomain.domain);
          notes.push(`Le compte ATS « ${slugDomain.domain} » ne mentionne pas « ${companyName} » : ignoré.`);
        }
      }
    }
  }
  // The posting's host is the employer only when it is not a job board or a
  // directory, and when it carries the company's name; otherwise its home
  // page must name the company (last step below). With no company name
  // (a "?" row) nothing can be checked: the host is kept unconfirmed.
  const hostDomain = companyDomainFromJobUrl(jobUrl, { company: companyName });
  if (!domain && hostDomain && !companyName) {
    adopt(`https://${hostDomain}`, 'job-url', false);
    notes.push(`Employeur inconnu : le site de l'annonce (${hostDomain}) est lu, mais rien ne confirme qu'il s'agit de l'employeur.`);
  }
  if (!domain && hostDomain && domainMatchesCompany(hostDomain, companyName)) adopt(`https://${hostDomain}`, 'job-url');
  if (!domain) {
    const mentioned = domainsFromText(jobText, companyName).find(item => domainMatchesCompany(item.domain, companyName));
    if (mentioned) adopt(`https://${mentioned.domain}`, 'posting-text');
  }
  // Addresses printed in the posting itself (the employer said where to
  // write): its text, and its HTML (mailto: links the text drops). One at a
  // domain shaped like the name is stronger evidence than any search. A
  // board or directory page prints its own inboxes (careers@jobgether.com in
  // its footer): never the employer's. A tenant address on shared hosting
  // (recrutement@culture.gouv.fr) stays.
  // The posting page's JSON-LD Organization is the board or the ATS, not the employer.
  const postingTextFound = extractEmails(jobText, { domain: '' });
  const postingFound = [...postingTextFound, ...(jobHtml ? extractEmails(jobHtml, { domain: '', sourceUrl: jobUrl, structured: false }) : [])]
    .filter(found => {
      const host = found.email.split('@')[1];
      return isSharedHostTenant(host) || !isNotEmployerHost(host, { company: companyName });
    });
  if (!domain && companyName) {
    const strength = { exact: 2, affix: 1 };
    const fromEmail = postingFound
      .map(found => ({ found, affinity: domainNameAffinity(found.domain, companyName) }))
      .filter(item => strength[item.affinity] && !isNotEmployerHost(item.found.domain, { company: companyName }) && !WEBMAIL_RE.test(item.found.domain))
      .sort((a, b) => strength[b.affinity] - strength[a.affinity])[0];
    if (fromEmail) adopt(`https://${fromEmail.found.domain}`, 'posting-email');
  }
  // A LinkedIn posting links its company page, whose JSON-LD names the site.
  if (!domain) {
    const companyPage = linkedinCompanyPage(jobHtml);
    let page = null;
    if (companyPage) {
      try { page = await fetchPage(companyPage); } catch (err) { log(`linkedin company page ${companyPage} failed: ${err.message}`); }
    }
    const site = page?.ok ? companyWebsiteFromHtml(page.html, { company: companyName, organization: true }) : '';
    let parsed = null;
    try { parsed = site ? new URL(site) : null; } catch { parsed = null; }
    const siteDomain = parsed ? registrableDomain(parsed.hostname) : '';
    if (siteDomain && (!companyName || domainMatchesCompany(siteDomain, companyName))) adopt(parsed.origin, 'linkedin');
    else if (siteDomain) {
      const home = await verifyHome(parsed.origin);
      const moved = landedElsewhere(home, siteDomain);
      if (moved) notes.push(movedNote(siteDomain, moved));
      else if (home.ok && homepageNamesCompany(home.html, companyName)) adopt(parsed.origin, 'linkedin');
      else {
        if (home.ok) refuted.add(siteDomain);
        notes.push(`Le site ${siteDomain} (page LinkedIn) ne mentionne pas « ${companyName} » : ignoré.`);
      }
    }
  }
  // Domains built from the name, before any search: a candidate must receive
  // mail and its home page must name the company. Taken when exactly one
  // does, or exactly one links the offer's board; namesakes (lindy.ai and
  // lindy.com) are left to the user as domainChoices. A lone pick that
  // neither links the offer's board nor is named in the posting may be a
  // namesake (riot.co, a studio, for Riot the security startup), whatever
  // words its page shares with the posting: the search runs first, and the
  // pick is kept unconfirmed only when nothing better turns up.
  let domainChoices = [];
  let unconfirmedGuess = null;
  if (!domain && companyName) {
    const guess = await siteFromName(companyName, { language: guessLanguage(jobText, role, companyName), jobUrl, jobText, jobHtml, resolveMx, verifyHome, homes, log });
    if (guess.pick && guess.confirmed) adopt(guess.pick.origin, 'name-guess');
    else if (guess.pick) unconfirmedGuess = guess.pick;
    else if (guess.choices.length) {
      domainChoices = guess.choices;
      notes.push(`Plusieurs sites portent le nom « ${companyName} » (${guess.choices.map(choice => choice.domain).join(', ')}) : aucun n'est choisi d'office.`);
    }
  }
  // A search pick that shares only part of the name with the company, kept
  // unconfirmed when nothing better turns up (below).
  let partialSearchPick = null;
  if (!domain && companyName && webSearch) {
    onStatus('Recherche du site officiel');
    const query = `"${companyName}" ${language === 'fr' ? 'site officiel' : 'official website'}`;
    // An answer made only of directories and boards is not worth keeping.
    const results = await search(query, { num: 8, usable: answer => rankDomainCandidates(answer, companyName).length > 0 });
    const candidates = rankDomainCandidates(results, companyName);
    // A host qualifies by its name only; its home page must then name the
    // company. Two candidates at most (one fetch each).
    for (const candidate of candidates.slice(0, 2)) {
      const home = await verifyHome(candidate.origin);
      const moved = landedElsewhere(home, candidate.domain);
      if (moved) { notes.push(movedNote(candidate.domain, moved)); continue; }
      // A domain that carries only the name's distinctive word (vertech.com
      // for Vertech Industrial Systems) may call itself by that word alone.
      const named = home.ok && (homepageNamesCompany(home.html, companyName)
        || (candidate.affinity === 'token' && homepageNamesCompany(home.html, companyTokens(companyName)[0])));
      // Only the first word in common (mercury.com, a bank, for Mercury
      // Systems; nova.com for Nova Labs): a namesake, unless the domain or
      // the home page carries the whole name, the site links the offer's
      // board or the posting names its domain. Its addresses are then
      // listed, never drafted to without asking.
      const whole = named && (domainNameAffinity(candidate.domain, companyName, { fullName: true })
        || homepageNamesCompany(home.html, companyName, { fullName: true })
        || ['board', 'mention'].includes(guessCorroboration(home, { domain: candidate.domain, company: companyName, jobUrl, jobText, jobHtml })));
      if (whole) { adopt(candidate.origin, 'search'); break; }
      if (named) { partialSearchPick = partialSearchPick || candidate; continue; }
      if (home.ok) { refuted.add(candidate.domain); notes.push(`Le site ${candidate.domain} ne mentionne pas « ${companyName} » : ignoré.`); continue; }
      // Unreadable home page: only a domain that is the name itself is kept, unconfirmed.
      if (candidate.affinity === 'exact') { adopt(candidate.origin, 'search', false); break; }
    }
    queryStats.push({ persona: 'domain', query, results: results.length, parsed: candidates.length, kept: domainSource === 'search' ? 1 : 0 });
  }
  // A posting host that is no known board but does not carry the name (an
  // unknown aggregator): kept only when its home page names the company.
  if (!domain && hostDomain && companyName) {
    const url = `https://${hostDomain}`;
    const home = await verifyHome(url);
    const moved = landedElsewhere(home, hostDomain);
    if (moved) notes.push(movedNote(hostDomain, moved));
    else if (home.ok && homepageNamesCompany(home.html, companyName)) adopt(url, 'job-url-verified');
    else if (home.ok) { refuted.add(hostDomain); notes.push(`Le site ${hostDomain} ne mentionne pas « ${companyName} » : ignoré.`); }
    else notes.push(`Le site ${hostDomain} (adresse de l'annonce) n'a pas répondu : impossible de vérifier qu'il s'agit de « ${companyName} », ignoré.`);
  }
  if (!domain && unconfirmedGuess) {
    adopt(unconfirmedGuess.origin, 'name-guess', false);
    notes.push(`Le site ${unconfirmedGuess.domain} porte le nom « ${companyName} », mais rien ne le relie à l'annonce : non confirmé.`);
  }
  if (!domain && partialSearchPick) {
    adopt(partialSearchPick.origin, 'search', false);
    notes.push(`Le site ${partialSearchPick.domain} ne porte qu'une partie du nom « ${companyName} » et rien ne le relie à l'annonce : non confirmé.`);
  }
  if (!domain) notes.push('Site de l\'entreprise introuvable : seules les adresses de l\'annonce sont utilisables.');
  if (aborted()) return abortedResult();

  // 2. Posting addresses become contacts: at the chosen domain, at another
  // domain that carries the name (jobs@acme-careers.com), or a hiring inbox.
  // Never at a site the run set aside, nor at the job page's own host when
  // another domain is the employer's: those are the platform's inboxes.
  let jobHost = '';
  try { jobHost = registrableDomain(new URL(jobUrl).hostname); } catch { jobHost = ''; }
  // Addresses the posting's text gives (not only its page chrome), and
  // person addresses whose name is printed beside them (pattern evidence).
  const textEmails = new Set(postingTextFound.map(found => found.email));
  const printedNames = new Set();
  for (const found of postingFound) {
    const tenant = isSharedHostTenant(found.email.split('@')[1]);
    if (refuted.has(found.domain) && !tenant) continue;
    if (domain && found.domain === jobHost && jobHost !== domain && !tenant && !domainMatchesCompany(found.domain, companyName)) continue;
    if (domain && found.domain !== domain && found.kind !== 'hiring' && !domainMatchesCompany(found.domain, companyName)) continue;
    if (found.kind === 'avoid') continue;
    if (found.kind === 'person' && addressNamePrinted(jobText, found.local)) printedNames.add(found.email);
    mergeContact(contacts, contactFor({ email: found.email, kind: foundKind(found.kind), confidence: 'verified', source: { type: 'posting', url: jobUrl, detail: found.context } }));
  }

  // 2b. People the posting names ("Louis, Talent Acquisition Manager", "you
  // will report to Marie Dupont, Head of Design"): the LinkedIn poster card,
  // deterministic patterns, then the optional model pass, every name checked
  // against the posting.
  const poster = parseLinkedInPoster(jobHtml, { company: companyName, domain });
  if (poster) rememberPerson(people, { ...poster, source: 'posting', sourceUrl: jobUrl, evidence: `${poster.firstName} ${poster.lastName}${poster.title ? `, ${poster.title}` : ''} (posted the offer on LinkedIn)` });
  if (String(jobText).trim()) {
    for (const person of extractNamedPeople(jobText, { sourceUrl: jobUrl, teamLike: false, company: companyName, domain, role })) rememberPerson(people, { ...person, source: 'posting' });
    if (extractPeople) {
      try {
        const found = await extractPeople(String(jobText).slice(0, 8000), { company: companyName, source: 'posting' });
        for (const item of found || []) {
          const firstName = String(item.firstName || '').trim();
          let lastName = String(item.lastName || '').trim();
          const title = String(item.title || '').trim().slice(0, 80);
          if (!firstName || !title) continue;
          // "Benoit, Cofondateur & Head of AI": the title is no surname; the
          // posting gives a first name only.
          if (lastNameIsTitle(lastName, title)) lastName = '';
          // "reporting to the Frontend Lead" answered as Frontend / Lead: a
          // first name left alone that is a word of its own title is no one.
          if (!lastName && title.toLowerCase().split(/[^\p{L}]+/u).includes(firstName.toLowerCase())) continue;
          // The role must be written in the posting too, not inferred by the model.
          if (!String(jobText).toLowerCase().includes(title.toLowerCase())) continue;
          const full = [firstName, lastName].filter(Boolean).join(' ');
          if (!new RegExp(`(?:^|[^\\p{L}])${full.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[^\\p{L}]|$)`, 'u').test(jobText)) continue;
          const name = lastName ? splitName(full) : (/^\p{L}[\p{L}'’-]{1,30}$/u.test(firstName) && !NOT_A_NAME.test(firstName) ? { firstName: properCase(firstName), lastName: '' } : null);
          if (!name) continue;
          rememberPerson(people, { ...name, title, persona: personaFor(title), source: 'posting', sourceUrl: jobUrl, evidence: `${full}, ${title} (named in the posting)` });
        }
      } catch (err) {
        log(`extractPeople failed on the posting: ${err.message}`);
      }
    }
  }
  if (aborted()) return abortedResult();

  // 3. The site: home page, then contact / team / legal notice / about /
  // careers pages. Only a new page with content counts toward maxPages: a
  // 404, a duplicate body, the site's soft-404 or JS shell costs one of
  // MAX_CRAWL_ATTEMPTS fetches, not a page.
  let companyText = '';
  // Person addresses dropped for their label (a DPO, a press contact): no
  // contact, but still evidence of the site's naming pattern.
  const evidenceOnly = [];
  const readPages = [];
  let homePage = null;
  if (domain && !halted()) {
    onStatus('Lecture du site de l\'entreprise');
    const home = homes.get(website) || await fetchPage(website || `https://${domain}`);
    if (home?.ok) {
      homePage = { ...home, text: String(home.text || ''), html: String(home.html || '') };
      pagesRead.push(home.url);
      // A near-empty page that yields nothing is a shell, not a page read.
      // Each page keeps its card count, first card offset and people found:
      // the model pass below picks its pages and windows from them.
      const harvest = (page, { thin = false } = {}) => {
        const found = extractEmails(page.html, { domain, sourceUrl: page.url });
        const scan = namedPeopleScan(page.text, { sourceUrl: page.url, teamLike: Boolean(page.teamLike), company: companyName, domain, role });
        const named = scan.people;
        Object.assign(page, { cards: scan.cards, firstCardAt: scan.firstCardAt, named: named.length });
        if (thin && !found.length && !named.length) return false;
        // Privacy, terms, press or investor page: its addresses are never the pick.
        const flag = isPolicyPage(page.url) ? { flag: 'policy-page' } : {};
        for (const item of found) {
          if (item.kind === 'person' && addressNamePrinted(page.text, item.local)) printedNames.add(item.email);
          // "Délégué à la protection des données : paul.martin@", "Partnerships:
          // anna@": whatever the local part says, no application goes there.
          const labelText = String(page.text || '').toLowerCase().includes(item.email) ? page.text : item.context;
          if (item.kind !== 'hiring' && labelSaysAvoid(labelText, item.email)) {
            if (item.domain === domain) evidenceOnly.push({ email: item.email, url: page.url });
            continue;
          }
          mergeContact(contacts, contactFor({ email: item.email, kind: foundKind(item.kind), confidence: 'verified', source: { type: 'site', url: page.url, detail: item.context, ...flag } }));
        }
        for (const person of named) rememberPerson(people, person);
        return true;
      };
      harvest(homePage);
      // The site's own language and locale prefix, not the posting's.
      const siteLanguage = htmlLang(homePage.html) || sameLanguageAs(homePage.text);
      let origin = '';
      try { origin = new URL(home.url).origin; } catch { origin = website || `https://${domain}`; }
      const queue = crawlCandidatesFromHtml(homePage.html, home.url, { limit: maxPages - 1, locale: siteLanguage });
      const urlKey = url => String(url || '').replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase();
      const enqueue = item => { if (!queue.some(queued => urlKey(queued.url) === urlKey(item.url))) queue.push(item); };
      if (queue.length < 3) {
        for (const item of await sitemapCandidates(origin, { fetchPage, limit: maxPages - 1, locale: siteLanguage, log })) enqueue(item);
        const prefix = localePrefix(home.url);
        for (const path of defaultCrawlPaths(siteLanguage)) enqueue({ url: `${origin}${prefix}${path}`, bucket: crawlBucket(path)?.bucket.name || '' });
      }
      const bodyKey = text => `${text.length}:${text.slice(0, 2048)}`;
      const homeBody = bodyKey(homePage.text);
      const seenUrls = new Set([urlKey(home.url), urlKey(website)]);
      const seenBodies = new Set([homeBody]);
      // One random path tells the site's soft-404 page (or JS shell) apart.
      let shellBody = '';
      if (queue.length) {
        try {
          const probe = await fetchPage(`${origin}/${Math.random().toString(36).slice(2, 10)}-introuvable`);
          if (probe?.ok) shellBody = bodyKey(String(probe.text || ''));
        } catch (err) {
          log(`shell probe on ${origin} failed: ${err.message}`);
        }
      }
      let read = 1;
      let attempts = 0;
      let sameAsHome = 0;
      for (const item of queue) {
        if (read >= maxPages || attempts >= MAX_CRAWL_ATTEMPTS || halted()) break;
        if (seenUrls.has(urlKey(item.url))) continue;
        seenUrls.add(urlKey(item.url));
        attempts += 1;
        let page = null;
        try { page = await fetchPage(item.url); } catch (err) { log(`page ${item.url} failed: ${err.message}`); }
        if (!page?.ok) continue;
        const finalUrl = page.url || item.url;
        if (urlKey(finalUrl) !== urlKey(item.url)) {
          if (seenUrls.has(urlKey(finalUrl))) continue;
          seenUrls.add(urlKey(finalUrl));
        }
        const text = String(page.text || '');
        const body = bodyKey(text);
        if (body === homeBody) {
          sameAsHome += 1;
          if (sameAsHome >= 3) { notes.push(`Site rendu en JS : pages identiques sur ${domain}, lecture arrêtée.`); break; }
          continue;
        }
        sameAsHome = 0;
        if (body === shellBody || seenBodies.has(body)) continue;
        seenBodies.add(body);
        let bucket = item.bucket || '';
        if (!bucket) { try { bucket = crawlBucket(new URL(finalUrl).pathname)?.bucket.name || ''; } catch { bucket = ''; } }
        const current = { ...page, url: finalUrl, text, html: String(page.html || ''), bucket, teamLike: bucket === 'team' || isTeamLikePage(finalUrl) };
        if (!harvest(current, { thin: text.trim().length < 200 })) continue;
        pagesRead.push(finalUrl);
        readPages.push(current);
        read += 1;
      }
      companyText = companyBrief({ home: homePage, pages: readPages });
    } else {
      notes.push(`Le site ${domain} n'a pas répondu (${home?.error || `HTTP ${home?.status}`}).`);
    }
  }
  if (aborted()) return abortedResult();

  // 3b. Optional model pass over the pages that list people (team-like
  // pages, then by card density), from just before their first card: names
  // with a title, each checked to appear word for word in the page (the
  // model lists, never invents). Skipped past the deadline, like the pages.
  const modelCalls = extractPeople && homePage && !halted() ? modelCallsFor(homePage, readPages) : [];
  if (modelCalls.length) {
    onStatus('Lecture de la page équipe');
    for (const { page, text } of modelCalls) {
      if (aborted()) return abortedResult();
      try {
        const found = await extractPeople(text, { company: companyName });
        for (const item of found || []) {
          const name = splitName(`${item.firstName || ''} ${item.lastName || ''}`.trim() || item.name || '');
          if (!name) continue;
          const full = `${name.firstName} ${name.lastName}`;
          if (!nameOnPage(page.text, name)) continue;
          const title = String(item.title || '').trim().slice(0, 80);
          if (!title || !page.text.toLowerCase().includes(title.toLowerCase())) continue;
          // "Benoit, Cofondateur & Head of AI" read as Benoit Cofondateur: no surname, no person.
          if (lastNameIsTitle(name.lastName, title)) continue;
          // The card pass gave this person another title on this page: the
          // model's wins when it sits on the line just above or below the name.
          const known = people.get(personKey(name));
          if (known?.title && known.title.toLowerCase() !== title.toLowerCase() && known.sources?.some(s => s.type === 'site' && s.url === page.url) && titleNextToName(page.text, full, title)) {
            known.title = title;
            known.persona = personaFor(title);
          }
          rememberPerson(people, { ...name, title, persona: personaFor(title), source: 'site', sourceUrl: page.url, evidence: `${full}, ${title}` });
        }
      } catch (err) {
        log(`extractPeople failed on ${page.url}: ${err.message}`);
      }
    }
  }
  if (aborted()) return abortedResult();

  // 3c. TheOrg's public org chart: one page fetch (a second slug when the
  // first is missing or another organisation), people with their titles.
  // Kept only when the page's website is this company's domain (or redirects
  // to it) and its name the company's; it never changes the domain, and its
  // people skip the search judge below.
  const theorg = { url: '', people: 0, verdict: '' };
  const theOrgNames = new Set();
  // A page that lists the company's old domain (prolific.co) under its own
  // name is still this company when that domain redirects to the chosen one
  // (www.prolific.com): a home page already read for it, else one fetch.
  const theOrgMovedHere = async (org) => {
    if (!org?.domain || org.domain === domain || !companyPartMatches(org.name, companyName)) return false;
    const landedAt = home => { try { return home?.ok ? registrableDomain(new URL(String(home.url || '')).hostname) : ''; } catch { return ''; } };
    const seen = [...homes.entries()]
      .filter(([url]) => { try { return registrableDomain(new URL(url).hostname) === org.domain; } catch { return false; } })
      .map(([, home]) => home);
    let moved = seen.some(home => landedAt(home) === domain);
    if (!moved && !seen.some(home => home?.ok)) {
      let origin = '';
      try { origin = new URL(org.website || `https://${org.domain}`).origin; } catch { origin = ''; }
      moved = Boolean(origin) && landedAt(await verifyHome(origin)) === domain;
    }
    if (moved) log(`theorg: ${org.name} lists ${org.domain}, which redirects to ${domain}`);
    return moved;
  };
  if (domain && companyName && !halted()) {
    onStatus('Lecture de l\'organigramme public');
    for (const slug of theOrgSlugs(companyName)) {
      const url = `https://theorg.com/org/${slug}`;
      let page = null;
      try { page = await fetchPage(url); } catch (err) { log(`theorg ${url} failed: ${err.message}`); }
      theorg.url = url;
      const org = page?.ok ? parseTheOrgPage(page.html) : null;
      if (!page?.ok) {
        theorg.verdict = `HTTP ${page?.status || 0}`;
        if (page?.status === 404) continue;
        break;
      }
      if (!org) { theorg.verdict = 'no organisation'; continue; }
      if (!theOrgPageMatches(org, { company: companyName, domain }) && !(await theOrgMovedHere(org))) {
        theorg.verdict = `another organisation (${org.domain || 'no site'})`;
        log(`theorg ${url}: ${org.name} at ${org.domain || 'no site'} is not ${companyName} at ${domain}`);
        continue;
      }
      const listed = capPagePeople(org.people, role);
      for (const person of listed) {
        rememberPerson(people, { ...person, source: 'theorg', sourceUrl: url, evidence: `${person.firstName} ${person.lastName}${person.title ? `, ${person.title}` : ''} (TheOrg)` });
        theOrgNames.add(foldName(`${person.firstName} ${person.lastName}`));
      }
      Object.assign(theorg, { people: listed.length, verdict: 'accepted' });
      break;
    }
  }
  if (aborted()) return abortedResult();

  // 4. People through web search: recruiter, the team's lead, a founder.
  // 20 results a query (Brave returns up to 20); one profile, one candidate.
  if (webSearch && companyName && searches.length < maxSearches && !halted()) {
    onStatus('Recherche des recruteurs et de l\'équipe');
    const fromSearch = [];
    const byProfile = new Map();
    const statOf = new Map();
    const hasLinkedIn = answer => answer.some(result => LINKEDIN_RE.test(String(result?.url || '')));
    const runPeopleQuery = async (item) => {
      const results = await search(item.query, { num: 20, usable: hasLinkedIn });
      const stat = { persona: item.persona, query: item.query, results: results.length, parsed: 0, kept: 0 };
      queryStats.push(stat);
      for (const result of results) {
        const person = parseSearchPerson(result, { company: companyName, domain });
        if (!person) continue;
        stat.parsed += 1;
        // The query's persona only when the title or the snippet says so: a
        // founder query also returns engineers who list the company.
        if (person.persona === 'unknown') person.persona = provenQueryPersona(item.persona, `${person.title} ${result.snippet || ''}`);
        const key = linkedinProfileKey(person.linkedinUrl) || foldName(`${person.firstName} ${person.lastName}`);
        const seen = byProfile.get(key);
        if (seen) {
          seen.title = seen.title || person.title;
          if (seen.persona === 'unknown') seen.persona = person.persona;
          continue;
        }
        const candidate = { ...person, queryPersona: item.persona };
        byProfile.set(key, candidate);
        statOf.set(candidate, stat);
        fromSearch.push(candidate);
      }
      return stat;
    };
    let leadStat = null;
    for (const item of peopleQueries({ company: companyName, role, domain, confirmed: domainConfirmed, language, jobText })) {
      if (searches.length >= maxSearches || halted()) break;
      const stat = await runPeopleQuery(item);
      if (item.persona === 'hiring-manager') leadStat = stat;
    }
    // A search left over (the domain was known before this step): a second
    // lead query with product-leadership titles when the first found nobody.
    if (leadStat && leadStat.parsed === 0 && searches.length < maxSearches && !halted()) {
      const spare = spareLeadQuery({ company: companyName, role, domain, confirmed: domainConfirmed, jobText });
      if (spare) await runPeopleQuery(spare);
    }
    if (aborted()) return abortedResult();
    // Namesakes ("Riot" the startup vs Riot Games): a model reads the company
    // page and the posting and keeps only people who plausibly work HERE.
    let kept = fromSearch;
    if (judgePeople && fromSearch.length && (companyText || jobText)) {
      try {
        const verdict = await judgePeople(fromSearch.map(p => ({ name: `${p.firstName} ${p.lastName}`.trim(), title: p.title, evidence: p.evidence })), { company: companyName, companyText, jobText, role });
        if (Array.isArray(verdict)) {
          // A profile TheOrg lists for this company stays whatever the judge says.
          kept = fromSearch.filter((person, index) => verdict.includes(index) || theOrgNames.has(foldName(`${person.firstName} ${person.lastName}`)));
          const dropped = fromSearch.length - kept.length;
          if (dropped) log(`judgePeople dropped ${dropped}/${fromSearch.length} search result(s) as another company`);
        }
      } catch (err) {
        log(`judgePeople failed: ${err.message}`);
      }
    }
    for (const person of kept) {
      rememberPerson(people, person);
      statOf.get(person).kept += 1;
    }
  }

  // 4b. One person, one entry: a first name the posting gives ("I'm
  // Grigory, CTO") joins the full name the site or a search found.
  mergePostingPeople(people);

  // 4c. Printed addresses meet the people the employer names: nicolas@ next
  // to "Nicolas Bégin" is his address (a person, not an inbox) and shows the
  // site's naming pattern. Posting addresses count like site addresses.
  const votes = [];
  const pairedPeople = new Set();
  if (domain) {
    const printed = [...contacts.values()].filter(c => c.confidence === 'verified' && contactDomain(c) === domain && c.sources.some(s => s.type === 'site' || s.type === 'posting'));
    const named = [...people.values()].filter(person => person.firstName && person.sources?.some(s => s.type === 'site' || s.type === 'posting'));
    for (const pair of pairAddressesWithPeople([...printed.map(c => ({ email: c.email, url: c.sources.find(s => s.type === 'site' || s.type === 'posting')?.url || '' })), ...evidenceOnly], named)) {
      const contact = contacts.get(pair.email);
      if (contact) {
        Object.assign(contact, { firstName: pair.person.firstName, lastName: pair.person.lastName, title: pair.person.title || contact.title, persona: pair.person.persona || contact.persona, kind: 'person' });
        contact.linkedinUrl = contact.linkedinUrl || pair.person.linkedinUrl || '';
        pairedPeople.add(pair.person);
      }
      // A middle name (aji@ for Ahmad Aji Santoso) is that person's choice, not the site's pattern.
      if (pair.pattern === 'middle') continue;
      votes.push({ pattern: pair.pattern, email: pair.email, url: pair.url, name: `${pair.person.firstName} ${pair.person.lastName}`.trim(), compound: compoundLastName(pair.person.lastName) });
    }
  }
  // The pattern: paired addresses first, else the shape of person addresses,
  // 'likely' only from 2+ whose name is printed beside them (a role inbox
  // such as accounts.payable@ shows no naming pattern).
  const shapeEmails = domain
    ? [...[...contacts.values()].filter(c => c.confidence === 'verified' && c.kind === 'person' && contactDomain(c) === domain && c.sources.some(s => s.type === 'site' || s.type === 'posting')).map(c => ({ email: c.email, url: c.sources.find(s => s.type === 'site' || s.type === 'posting')?.url || '' })), ...evidenceOnly]
      .map(item => ({ ...item, printed: printedNames.has(item.email) }))
    : [];
  const evidence = patternEvidence(votes, shapeEmails);
  if (aborted()) return abortedResult();

  // 5. An address for each person: provider first, else the site's own pattern, else a guess.
  let providerPattern = '';
  const providersUsed = [];
  const startedAt = now();
  const live = providers.filter(provider => !(provider && (providerOutages.get(provider.name) || 0) > startedAt));
  if (live.length < providers.length) log(`${providers.length - live.length} provider(s) skipped: unavailable earlier today`);
  // An unavailable provider: one note, then skipped for PROVIDER_OUTAGE_MS.
  const providerDown = (provider, err) => {
    notes.push(`${provider.name} indisponible : ${err.message}`);
    providerOutages.set(provider.name, startedAt + PROVIDER_OUTAGE_MS);
    if (live.includes(provider)) live.splice(live.indexOf(provider), 1);
  };
  // Providers are network calls like a fetch: none starts past the deadline,
  // and one running is let go when the caller aborts.
  if (domain && live.length && !halted()) {
    onStatus('Vérification des adresses');
    for (const provider of [...live]) {
      if (typeof provider.domainSearch !== 'function') continue;
      if (halted()) break;
      try {
        const found = await unlessAborted(provider.domainSearch(domain), () => ({ emails: [] }));
        providersUsed.push(provider.name);
        providerPattern = found.pattern || '';
        for (const item of found.emails || []) {
          if (!item.email) continue;
          const kind = item.firstName ? 'person' : contactKind(item.email.split('@')[0]) || 'generic';
          if (kind === 'avoid') continue;
          mergeContact(contacts, contactFor({ email: item.email, firstName: item.firstName, lastName: item.lastName, title: item.title, kind, confidence: item.status === 'verified' ? 'verified' : 'likely', source: { type: 'provider', url: provider.name, detail: item.title || item.department || '' } }));
        }
      } catch (err) {
        if (err.unavailable) providerDown(provider, err);
        else log(`${provider.name} domainSearch failed: ${err.message}`);
      }
    }
  }
  if (domain) {
    for (const person of peopleForGuesses(people.values(), ranking)) {
      if (!person.firstName || contacts.size > 40 || aborted()) break;
      // Already matched to an address the employer printed.
      if (pairedPeople.has(person)) continue;
      // A first name alone (from the posting) only supports first@domain.
      if (!person.lastName && !person.sources?.some(s => s.type === 'posting')) continue;
      const existing = [...contacts.values()].find(c => personKey(c) === personKey(person));
      if (existing) { existing.title = existing.title || person.title; existing.persona = person.persona; existing.linkedinUrl = existing.linkedinUrl || person.linkedinUrl || ''; continue; }
      let resolved = null;
      // Past the deadline the guess comes from the pattern alone (no network).
      for (const provider of halted() ? [] : [...live]) {
        if (typeof provider.findEmail !== 'function') continue;
        try {
          const answer = await unlessAborted(provider.findEmail({ firstName: person.firstName, lastName: person.lastName, domain, company: companyName, title: person.title }), () => ({}));
          if (!providersUsed.includes(provider.name)) providersUsed.push(provider.name);
          if (answer.email) { resolved = { email: answer.email, confidence: answer.status === 'verified' ? 'verified' : answer.status === 'likely' ? 'likely' : 'guess', source: { type: 'provider', url: provider.name, detail: `${person.title || ''}`.trim() } }; break; }
        } catch (err) {
          if (err.unavailable) providerDown(provider, err);
          else log(`${provider.name} findEmail failed: ${err.message}`);
        }
      }
      if (!resolved) {
        const fromProvider = providerPattern.replace(/[{}]/g, '');
        const candidates = emailCandidates({ firstName: person.firstName, lastName: person.lastName, domain, knownPattern: guessOrder(evidence, fromProvider) });
        if (!candidates.length) continue;
        const first = candidates[0];
        const guessed = guessConfidence({ evidence, providerPattern: fromProvider, pattern: first.pattern, lastName: person.lastName });
        resolved = { email: first.email, confidence: guessed.confidence, source: { type: 'pattern', url: person.sourceUrl || person.linkedinUrl || '', detail: guessed.detail }, alternatives: candidates.slice(1, 3).map(item => item.email) };
      }
      const contact = contactFor({ email: resolved.email, firstName: person.firstName, lastName: person.lastName, title: person.title, kind: 'person', persona: person.persona, confidence: resolved.confidence, source: resolved.source, linkedinUrl: person.linkedinUrl || '' });
      for (const source of person.sources || []) contact.sources.push(source);
      if (resolved.alternatives) contact.alternatives = resolved.alternatives;
      mergeContact(contacts, contact);
    }
  } else if (people.size) {
    notes.push(`${people.size} personne(s) trouvée(s) mais sans domaine d'entreprise, aucune adresse ne peut être construite.`);
  }

  if (aborted()) return abortedResult();

  // The candidate's own addresses are never a contact (a page read signed in
  // can print them).
  const own = new Set((ownEmails || []).map(e => String(e).trim().toLowerCase()).filter(Boolean));
  for (const [key, contact] of contacts) if (own.has(String(contact.email).toLowerCase())) contacts.delete(key);

  // 6. Mail check per domain (MX), then ranking. A DNS answer that cannot
  // tell (error, A record without MX) is null: guesses stay, tagged.
  const domains = [...new Set([...contacts.values()].map(c => c.email.split('@')[1]))];
  for (const d of domains) {
    const ok = await Promise.resolve().then(() => resolveMx(d)).catch(() => null);
    for (const contact of contacts.values()) if (contact.email.endsWith(`@${d}`)) contact.mx = ok === true || ok === false ? ok : null;
    if (ok === false) notes.push(`${d} ne reçoit pas de mail (pas de MX).`);
  }
  // Found = printed on a page or confirmed; guessed = built from a pattern.
  // Guesses stay few and never on a domain without MX.
  for (const contact of contacts.values()) contact.status = contact.confidence === 'verified' ? 'found' : 'guessed';
  // Each named person's place in line for this offer (posting, recruiter,
  // team lead, founder, other manager, other department or unknown role).
  for (const contact of contacts.values()) if (contact.kind === 'person') contact.teamRank = teamRank(contact, ranking);
  for (const person of people.values()) person.roleRank = roleRank(person, ranking);
  // The guess slots follow that order, score only within a rank: a TheOrg
  // VP Marketing never pushes out the recruiters and the CPO.
  const guessesRanked = rankContacts([...contacts.values()].filter(c => c.status === 'guessed'))
    .map((contact, index) => ({ contact, index }))
    .sort((a, b) => (a.contact.teamRank ?? 9) - (b.contact.teamRank ?? 9) || a.index - b.index)
    .map(item => item.contact);
  const keepGuess = new Set(guessesRanked.filter(c => c.mx !== false).slice(0, MAX_GUESSES).map(c => c.email));
  const droppedNoMx = [];
  const droppedOverCap = [];
  for (const [key, contact] of contacts) {
    if (contact.status !== 'guessed' || keepGuess.has(contact.email)) continue;
    (contact.mx === false ? droppedNoMx : droppedOverCap).push(contact);
    contacts.delete(key);
  }
  if (droppedNoMx.length) notes.push(`${droppedNoMx.length} adresse(s) devinée(s) écartée(s) : le domaine ne reçoit pas de mail.`);
  if (droppedOverCap.length) {
    const names = [...new Set(droppedOverCap.map(c => `${c.firstName} ${c.lastName}`.trim()).filter(Boolean))];
    notes.push(`${droppedOverCap.length} adresse(s) devinée(s) écartée(s) au-delà des ${MAX_GUESSES} plus probables${names.length ? ` (${names.slice(0, 4).join(', ')}${names.length > 4 ? '…' : ''})` : ''}.`);
  }
  for (const contact of contacts.values()) {
    contact.tags = [];
    if (contact.mx === false) contact.tags.push('domaine sans MX');
    else if (contact.mx === null) contact.tags.push('MX non vérifiable');
    if (foundOnlyOnPolicyPages(contact)) contact.tags.push('page confidentialité ou presse');
  }
  const ranked = rankContacts([...contacts.values()]);
  // Without an employer site, only the company's own name or a hiring inbox
  // the posting's text gives makes an address the employer's.
  const noSite = domain ? null : { company: companyName, textEmails };
  // An unpaired aji@ beside first@ staff addresses, or a word of a name the
  // run found, is someone's own address, never the inbox drafted for.
  const nameTokens = new Set([...people.values()].flatMap(person => foldName(`${person.firstName} ${person.lastName}`).split(/[^a-z]+/)).filter(token => token.length >= 3));
  const blockerContext = { domainConfirmed, domain, noSite, namePattern: evidence.pattern, nameTokens };
  const best = pickBest(ranked, blockerContext);
  if (!ranked.length) notes.push('Aucune adresse trouvée. Vous pouvez saisir une adresse à la main.');
  else if (!best) {
    const blockers = [...new Set(ranked.filter(c => c.status === 'found').map(c => bestBlocker(c, blockerContext)).filter(Boolean))];
    notes.push(blockers.length ? `Aucune adresse choisie d'office (${blockers.join(', ')}) : choisissez-en une.` : 'Seules des adresses devinées : à confirmer avant d\'écrire.');
  }
  // A staff page that prints everyone's address (126 first@ on
  // RoomPriceGenie's /genies/): the MAX_STAFF_CONTACTS first in the ranking
  // (recruiters and the role's leads lead it) are listed, and best.
  const isStaff = contact => contact.status === 'found' && (contact.kind === 'person' || (contact.kind === 'generic' && personalLocal(contact, { namePattern: evidence.pattern, nameTokens })));
  const staff = ranked.filter(isStaff);
  const shownStaff = new Set(staff.slice(0, MAX_STAFF_CONTACTS));
  if (best) shownStaff.add(best);
  const listed = ranked.filter(contact => !isStaff(contact) || shownStaff.has(contact));
  if (listed.length < ranked.length) notes.push(`${ranked.length - listed.length} adresse(s) du personnel non listée(s) : les ${MAX_STAFF_CONTACTS} plus utiles pour cette offre sont gardées.`);

  return {
    // overridden: the tracker's company when the ATS account replaced it.
    company: { name: companyName, domain, website, source: domainSource, confirmed: domainConfirmed, overridden: companyOverridden },
    // Sites that all name the company when none could be picked: the user chooses.
    domainChoices,
    companyText,
    contacts: listed,
    best,
    people: [...people.values()],
    // How the naming pattern was learned: { pattern, support, basis, confidence, sources, examples }.
    patternEvidence: { pattern: evidence.pattern, support: evidence.support, basis: evidence.basis, confidence: evidence.confidence, sources: evidence.sources, examples: evidence.examples },
    searches,
    pagesRead,
    providersUsed,
    notes,
    // 'deadline' when searches or pages were skipped for time ('aborted' on the early return).
    stopped: pastDeadline ? 'deadline' : '',
    // For the run log: where the domain came from, what each search gave
    // (results, people parsed at the company, people kept), people per
    // source, TheOrg's answer and how the pattern was learned.
    diagnostics: {
      domainSource,
      queries: queryStats,
      peopleBySource: peopleBySource(people.values()),
      theorg,
      pattern: { pattern: evidence.pattern, support: evidence.support, basis: evidence.basis },
    },
  };
}

// People per source type ({ site: 4, search: 2, theorg: 6 }); a person on two sources counts in both.
function peopleBySource(people) {
  const counts = {};
  for (const person of people) {
    for (const type of new Set((person.sources || []).map(source => source.type))) counts[type] = (counts[type] || 0) + 1;
  }
  return counts;
}

// ── Who to name in an email to a shared inbox ──────────────────────────────
// Forward tiers by roleRank: the recruiter, then the lead of this role's
// team, then a founder; nobody else (a VP Marketing or an account manager
// from a testimonial is no one to forward an application to).
const FORWARD_RANK_TIER = { 1: 0, 2: 1, 3: 2 };
// People without a roleRank (a result from before it existed).
const FORWARD_PERSONA_TIER = { recruiter: 0, 'hiring-manager': 1, founder: 2 };

/**
 * The person an email to a shared inbox can ask to be forwarded to: when
 * the best contact has no first name (jobs@, contact@) or there is none,
 * the person the employer itself names, with a first name and a title: a
 * recruiter, else the lead of this role's team (or the title the posting
 * reports to), else a founder; the posting before the site, then page
 * order. Never someone found only by search, nor only on a site the run
 * could not confirm (a namesake's CEO). Returns { firstName, lastName,
 * title, persona, source } or null.
 */
export function pickForwardTarget(found = {}) {
  if (String(found?.best?.firstName || '').trim()) return null;
  const siteTrusted = !(found?.company?.domain && found.company.confirmed === false);
  const sourceOf = person => {
    const types = (person.sources || []).map(source => source.type);
    return types.includes('posting') ? 'posting' : types.includes('site') && siteTrusted ? 'site' : '';
  };
  const tierOf = person => (person.roleRank !== undefined ? FORWARD_RANK_TIER[person.roleRank] : FORWARD_PERSONA_TIER[person.persona]);
  const pick = (found?.people || [])
    .map((person, index) => ({ person, index, source: sourceOf(person), tier: tierOf(person) }))
    .filter(item => String(item.person.firstName || '').trim() && String(item.person.title || '').trim() && item.source && item.tier !== undefined)
    .sort((a, b) => a.tier - b.tier || (a.source === 'posting' ? 0 : 1) - (b.source === 'posting' ? 0 : 1) || a.index - b.index)[0];
  if (!pick) return null;
  const { firstName, lastName = '', title, persona } = pick.person;
  return { firstName: String(firstName).trim(), lastName: String(lastName || '').trim(), title: String(title).trim(), persona, source: pick.source };
}

// ── The people the contact modal lists ─────────────────────────────────────
const PAGE_SOURCE_RANK = { posting: 0, site: 1, theorg: 2, search: 3 };
// On the roleRank scale, for people without one (a result from before it existed).
const PAGE_PERSONA_RANK = { recruiter: 1, 'hiring-manager': 1, founder: 3 };

/**
 * The people found, for the page (max at most): those the employer names
 * first (posting, site, then TheOrg, then search), then by roleRank within
 * each: recruiters, the leads of this role's team, founders, other managers,
 * everyone else (a VP Marketing never above the recruiter). hasAddress: one
 * of the contacts carries their name (a found or a guessed address). sourceUrl: the first
 * page that names them; queryPersona: the search that found them, when
 * nothing confirmed their role. Returns [{ firstName, lastName, title,
 * persona, queryPersona, linkedinUrl, sources: ['posting', …], sourceUrl,
 * hasAddress }].
 */
export function peopleForPage(found = {}, { max = 30 } = {}) {
  const fullName = item => `${foldName(item.firstName)} ${foldName(item.lastName)}`;
  const addressed = new Set((found?.contacts || []).filter(contact => String(contact.firstName || '').trim()).map(fullName));
  return (found?.people || [])
    .filter(person => String(person.firstName || '').trim())
    .map((person, index) => {
      const types = [...new Set((person.sources || []).map(source => source.type).filter(Boolean))];
      return { person, index, types, rank: Math.min(4, ...types.map(type => PAGE_SOURCE_RANK[type] ?? 4)), tier: person.roleRank ?? PAGE_PERSONA_RANK[person.persona] ?? 5 };
    })
    .sort((a, b) => a.rank - b.rank || a.tier - b.tier || a.index - b.index)
    .slice(0, max)
    .map(({ person, types }) => {
      const page = (person.sources || []).find(source => source.type !== 'search' && /^https?:\/\//i.test(String(source.url || '')));
      return {
        firstName: String(person.firstName).trim(),
        lastName: String(person.lastName || '').trim(),
        title: String(person.title || '').trim().slice(0, 120),
        persona: person.persona || 'unknown',
        queryPersona: person.persona && person.persona !== 'unknown' ? '' : String(person.queryPersona || ''),
        linkedinUrl: /^https?:\/\//i.test(String(person.linkedinUrl || '')) ? person.linkedinUrl : '',
        sources: types,
        sourceUrl: page ? page.url : '',
        hasAddress: addressed.has(fullName(person)),
      };
    });
}

// ── Target company ─────────────────────────────────────────────────────────
// The employer the finder searches must come from the offer, never from the
// candidate: a Glassdoor page read in the user's signed-in Chrome starts with
// the user's own header ("… at OneAsset"), and the "at <Name>" guess below
// took the candidate's current employer for the company (Vertech run).

const normCompany = (s) => String(s || '')
  .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/&/g, ' and ')
  .replace(/\b(inc|ltd|llc|gmbh|sas|sa|group|groupe|plc|corp|co)\b\.?/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ').trim();

// Without spaces and single letters: "One Asset" and "OneAsset S.A." → oneasset.
const compactCompany = (s) => normCompany(s).split(' ').filter(word => word.length > 1).join('');

// Tracker placeholders for an unknown employer ("?" per AGENTS.md) and
// names that hide it: nothing to search.
const PLACEHOLDER_COMPANY_RE = /^(?:\?+|n\/?a|-+|—|unknown|inconnue?|confidential|confidentiel(?:le)?|undisclosed|stealth(?: (?:startup|mode|company))?|anonymous|anonyme|our client|client confidentiel|entreprise confidentielle)$/i;

/**
 * A company name as it can be searched: '' for a placeholder ("?",
 * "Stealth Startup", "Confidential"), without "(Stealth)" / "(Remote)"
 * groups or " - Careers" tails, and Glassdoor's "Chess Com" as "Chess.com".
 */
export function searchableCompanyName(name) {
  const text = String(name || '').replace(/\s+/g, ' ').trim()
    .replace(/\s*\((?:stealth|remote|hiring|confidential|confidentiel|anonymous)\b[^)]*\)\s*/gi, ' ')
    .replace(/\s+[-–—|]\s+(?:remote|careers?|jobs?|hiring|recrutement)\b.*$/i, '')
    .trim();
  if (!text || PLACEHOLDER_COMPANY_RE.test(text)) return '';
  return text.replace(/\s+com$/i, '.com');
}

// Words a job title carries around its role words ("Senior Technical
// Product Manager"): with two role words and nothing else, it is a title.
const TITLE_QUALIFIER_RE = /^(?:senior|sr|junior|jr|staff|principal|technical|tech|mid|level|i|ii|iii|iv|remote|hybrid|freelance|contract|contractor|chief|vp|vice|president|of|and|the|for|to|de|du|des|en|et|h|f|m|w|d|x|full|stack|front|back|end|frontend|backend|ai|ml|data|web|mobile|digital|visual|graphic|interaction|user|experience|software|platform|growth|marketing|sales|research|ops|operations|brand|content|creative|motion|game|systems?)$/;

/**
 * Is this "company" a job title (the role itself, or two role words and only
 * title words around them)? posting-identity's ROLE_WORD decides what a role
 * word is.
 */
export function companyLooksLikeRole(name, role = '') {
  const plain = value => plainWords(value).join(' ');
  const text = plain(name);
  if (!text) return false;
  if (role && text === plain(role)) return true;
  const words = text.split(' ');
  return words.filter(word => ROLE_WORD.test(word)).length >= 2 && words.every(word => ROLE_WORD.test(word) || TITLE_QUALIFIER_RE.test(word));
}

/**
 * Does an ATS account's name contradict the tracker's company? Yes when they
 * share no name token, neither holds the other, and the board slug does not
 * carry the given name: "Lindy" on board bjakcareer owned by Bjak, not
 * "DataDome" on ddome owned by DataDome. A given name with no token of its
 * own ("x", "The") always gives way.
 */
export function boardOwnerDisagrees(given, owner, slug = '') {
  const ownerTokens = companyTokens(owner);
  if (!ownerTokens.length) return false;
  const givenTokens = companyTokens(given);
  if (!givenTokens.length) return true;
  if (givenTokens.some(token => ownerTokens.includes(token))) return false;
  const a = compactCompany(given);
  const b = compactCompany(owner);
  if (a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a))) return false;
  const plainSlug = String(slug || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const forms = [companyNameWords(given).join(''), givenTokens.join('')].filter(form => form.length >= 3);
  return !(plainSlug && forms.some(form => plainSlug.includes(form)));
}

// "at X" guesses that are a place or a phrase, not an employer ("at Paris
// office", "Work at Home", "design at Scale").
const AT_NOT_COMPANY = new Set(['home', 'remote', 'paris', 'london', 'berlin', 'office', 'headquarters', 'hq', 'scale', 'night', 'least']);

/** Company name from a posting's first lines ("Senior Designer at Acme", "Company: Acme"). */
export function companyNameFromJobText(jobText) {
  const head = String(jobText || '').split('\n').slice(0, 8).join('\n');
  const clean = value => String(value).replace(/\s+/g, ' ').trim().slice(0, 60);
  // An explicit "Company:" line wins over "Designer at Paris office".
  const labelled = head.match(/^(?:Company|Entreprise|Employer|Société)\s*:\s*(.+)$/im);
  if (labelled) return clean(labelled[1]);
  // The name stays on its line: "at OneAsset\nUX/UI Designer" read "OneAsset UX".
  for (const m of head.matchAll(/\b(?:at|chez|@)[ \t]+([A-Z][\w&.'-]*(?:[ \t]+[A-Z][\w&.'-]*){0,2})/g)) {
    if (AT_NOT_COMPANY.has(m[1].split(/[ \t]+/)[0].toLowerCase())) continue;
    if (/^[ \t]+(?:office|team|hq|headquarters)\b/i.test(head.slice(m.index + m[0].length))) continue;
    return clean(m[1]);
  }
  return '';
}

/**
 * The employer written in a job board URL. Glassdoor:
 * /job-listing/<title>-<employer>-JV_KO<a>,<b>_KE<c>,<d>.htm, where KE is the
 * employer's character range in the slug.
 */
export function companyFromJobUrl(jobUrl) {
  let u;
  try { u = new URL(jobUrl); } catch { return ''; }
  if (!/(^|\.)glassdoor\.[a-z.]+$/i.test(u.hostname)) return '';
  const seg = decodeURIComponent(u.pathname.split('/').pop() || '');
  const m = seg.match(/^(.+?)-JV_.*?KE(\d+),(\d+)/i);
  if (!m) return '';
  const name = m[1].slice(Number(m[2]), Number(m[3])).replace(/[-_]+/g, ' ').trim();
  return name.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * The candidate's own companies from the career index: employers on the CV
 * ("Title : Company (dates)") and side projects.
 */
export function ownCompanyNames(career = {}) {
  const names = [];
  for (const line of career?.employers || []) {
    const m = String(line).replace(/^\s*-\s*/, '').match(/^[^:(]*:\s*([^:(]{2,60}?)\s*\(/);
    if (m) names.push(m[1].trim());
  }
  for (const s of career?.sideNames || []) names.push(String(s));
  return [...new Set(names.filter((n) => normCompany(n).length >= 3))];
}

export function isOwnCompany(name, own = []) {
  const n = normCompany(name);
  if (!n) return false;
  const c = compactCompany(name);
  return own.some((o) => normCompany(o) === n || (c.length >= 4 && compactCompany(o) === c));
}

/**
 * The company to search: the given one (tracker row / user), else the job
 * board URL (Glassdoor's employer range, else the ATS board or /companies/
 * slug), else the posting's first lines. Placeholders are cleaned away
 * (searchableCompanyName), a job title stored as the company is passed over,
 * and any of the candidate's own companies is skipped.
 * Returns { company, source, rejected }.
 */
export function targetCompany({ company = '', jobUrl = '', jobText = '', own = [], role = '' } = {}) {
  const rejected = [];
  const tries = [
    ['given', searchableCompanyName(company)],
    ['job-url', searchableCompanyName(companyFromJobUrl(jobUrl) || identityFromUrl(jobUrl).company)],
    ['posting-text', jobText ? searchableCompanyName(companyNameFromJobText(jobText)) : ''],
  ];
  for (const [source, name] of tries) {
    if (!name || companyLooksLikeRole(name, role)) continue;
    if (isOwnCompany(name, own)) { rejected.push(name); continue; }
    return { company: name, source, rejected };
  }
  return { company: '', source: '', rejected };
}
