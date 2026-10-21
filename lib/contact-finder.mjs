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
import { classifyMailbox, inferPersona } from './application-email.mjs';

// ── Hosts that are never the employer's own site ────────────────────────────
const JOB_HOST_RE = /(?:^|\.)(?:greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com|welcometothejungle\.com|linkedin\.com|indeed\.[a-z.]+|glassdoor\.[a-z.]+|wellfound\.com|angel\.co|himalayas\.app|remoteok\.com|remotive\.com|weworkremotely\.com|myworkdayjobs\.com|workday\.com|icims\.com|teamtailor\.com|recruitee\.com|bamboohr\.com|jobvite\.com|breezy\.hr|successfactors\.(?:com|eu)|taleo\.net|personio\.(?:de|com)|join\.com|jobteaser\.com|apec\.fr|hellowork\.com|otta\.com|ycombinator\.com|dover\.com|rippling\.com|gem\.com|pinpointhq\.com|applytojob\.com|jazz\.co|jazzhr\.com|zohorecruit\.com|freshteam\.com|homerun\.co|recruitcrm\.io|monster\.[a-z.]+|stepstone\.[a-z.]+|xing\.com|jobup\.ch|jobs\.ch|seek\.com\.au|jobsdb\.com|jora\.com|jobstreet\.[a-z.]+|google\.com|notion\.site|notion\.so|interamt\.de|talent\.com|jooble\.org|careerjet\.[a-z.]+|ziprecruiter\.com|dice\.com|hired\.com|remoteco\.com|workatastartup\.com|eu\.greenhouse\.io|wttj\.co|lesjeudis\.com|cadremploi\.fr|regionsjob\.com|keljob\.com|jobijoba\.com|welcomekit\.co|hireflix\.com|factorial\.[a-z]+)$/i;
const SOCIAL_HOST_RE = /(?:^|\.)(?:facebook\.com|twitter\.com|x\.com|instagram\.com|youtube\.com|tiktok\.com|github\.com|medium\.com|wikipedia\.org|crunchbase\.com|pitchbook\.com|bloomberg\.com|reuters\.com|techcrunch\.com|lesechos\.fr|maddyness\.com|frenchweb\.fr|societe\.com|pappers\.fr|infogreffe\.fr|verif\.com|trustpilot\.com|g2\.com|capterra\.com|producthunt\.com|apple\.com|play\.google\.com|amazon\.[a-z.]+|microsoft\.com|slideshare\.net|vimeo\.com|dribbble\.com|behance\.net|zoominfo\.com|rocketreach\.co|signalhire\.com|apollo\.io|lusha\.com|kaspr\.io|contactout\.com|theorg\.com|craft\.co|owler\.com|cbinsights\.com|glassdoor\.[a-z.]+|lemlist\.com)$/i;
const WEBMAIL_RE = /(?:^|\.)(?:gmail\.com|googlemail\.com|outlook\.com|hotmail\.[a-z]+|live\.[a-z]+|yahoo\.[a-z.]+|icloud\.com|me\.com|proton\.me|protonmail\.com|gmx\.[a-z]+|web\.de|orange\.fr|wanadoo\.fr|free\.fr|sfr\.fr|laposte\.net|yandex\.[a-z]+|mail\.com|aol\.com)$/i;
const HOST_PREFIX_RE = /^(?:www|careers?|jobs?|apply|boards?|talent|recruit(?:ing|ment)?|join|work|hiring|people|team|about|app|en|fr|de|es|it|nl|m|mobile|shop|store|blog|news|help|support|docs?|developer|dev|api|cdn|static|mail|email|go|get|try|my|portal|intranet)\./i;
const LEGAL_SUFFIX_RE = /\b(?:inc|incorporated|llc|ltd|limited|plc|gmbh|ag|sas|sasu|sa|sarl|eurl|sprl|bv|nv|oy|ab|as|srl|spa|co|corp|corporation|company|group|groupe|holding|labs?|technologies|technology|tech|software|studio|studios|solutions|digital|international|global|france|europe|the)\b\.?/gi;

/** Registrable domain of a hostname: jobs.acme-group.co.uk → acme-group.co.uk */
export function registrableDomain(hostname) {
  let host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!host || /^[\d.]+$/.test(host) || host.includes(':')) return '';
  host = host.replace(HOST_PREFIX_RE, '');
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

/** Does a domain plausibly belong to this company? "tryriot.com" ↔ "Riot". */
export function domainMatchesCompany(domain, company) {
  const core = String(domain || '').toLowerCase().split('.')[0].replace(/-/g, '');
  const tokens = companyTokens(company);
  if (!core || !tokens.length) return false;
  const joined = tokens.join('');
  if (core === joined || core.includes(joined) || joined.includes(core) && core.length >= 4) return true;
  return tokens.some(token => token.length >= 4 && (core.includes(token) || token.includes(core) && core.length >= 4));
}

/** The company's own domain when the posting lives on it; '' for an ATS or a job board. */
export function companyDomainFromJobUrl(jobUrl) {
  try {
    const host = new URL(String(jobUrl || '')).hostname;
    if (isJobHost(host) || isSocialHost(host) || WEBMAIL_RE.test(host)) return '';
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

/**
 * Company website from a job page: JSON-LD hiringOrganization.sameAs / url,
 * which job boards (Welcome to the Jungle, many ATS pages) fill in.
 */
export function companyWebsiteFromHtml(html) {
  const blocks = String(html || '').matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const block of blocks) {
    let parsed;
    try { parsed = JSON.parse(block[1].trim()); } catch { continue; }
    for (const node of jsonLdNodes(parsed)) {
      const org = node.hiringOrganization && typeof node.hiringOrganization === 'object' ? node.hiringOrganization : null;
      const candidates = org ? [org.sameAs, org.url] : [];
      for (const raw of candidates.flat()) {
        const url = absolutize(raw);
        if (!url) continue;
        try {
          const host = new URL(url).hostname;
          if (!isJobHost(host) && !isSocialHost(host)) return url;
        } catch { /* skip */ }
      }
    }
  }
  return '';
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
    if (!domain || isJobHost(domain) || isSocialHost(domain) || WEBMAIL_RE.test(domain)) return;
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

/** Pick the company site among search results for "<company> official website". */
export function pickDomainFromSearch(results = [], company = '') {
  const tokens = companyTokens(company);
  for (const result of results) {
    let host = '';
    try { host = new URL(result.url).hostname; } catch { continue; }
    if (isJobHost(host) || isSocialHost(host) || WEBMAIL_RE.test(host)) continue;
    const domain = registrableDomain(host);
    if (!domain) continue;
    const title = String(result.title || '').toLowerCase();
    if (domainMatchesCompany(domain, company) || tokens.some(token => token.length >= 4 && title.includes(token))) return { domain, url: result.url, title: result.title || '' };
  }
  return null;
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

/** Visible text of a page, one line per block. */
export function pageText(html = '') {
  return decodeEntities(String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(?:p|div|li|h[1-6]|br|tr|section|article|header|footer|dd|dt|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
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

/**
 * Email addresses printed on a page (text, mailto:, "name [at] domain"), kept
 * only on the company's own domain. Each carries the mailbox class and the
 * text around it.
 */
export function extractEmails(html, { domain = '', sourceUrl = '' } = {}) {
  const raw = String(html || '');
  const text = pageText(raw);
  const deobfuscated = text
    .replace(/\s*[\[(]\s*(?:at|arobase|@)\s*[\])]\s*/gi, '@')
    .replace(/\s*[\[(]\s*(?:dot|point)\s*[\])]\s*/gi, '.');
  // mailto: links carry their own context (the text around the anchor).
  const mailtos = [...raw.matchAll(/mailto:([^"'?\s<>]+)/gi)].map(m => {
    let address = m[1];
    try { address = decodeURIComponent(address); } catch { /* keep raw */ }
    return { text: decodeEntities(address), context: pageText(raw.slice(Math.max(0, m.index - 220), m.index + 260)).replace(/\n/g, ' ').trim() };
  });
  const sources = [{ text: deobfuscated, context: '' }, ...mailtos];
  const want = String(domain || '').toLowerCase();
  const out = new Map();
  for (const source of sources) {
    for (const m of emailMatches(source.text)) {
      const email = m[0].toLowerCase().replace(/^[._-]+/, '');
      const [local, host] = email.split('@');
      if (!local || !host || IMAGE_EXT_RE.test(email) || JUNK_LOCAL_RE.test(local) || JUNK_DOMAIN_RE.test(host)) continue;
      const emailDomain = registrableDomain(host);
      if (want && emailDomain !== want) continue;
      if (!want && (WEBMAIL_RE.test(host) || isJobHost(host))) continue;
      const kind = classifyMailbox(local) || (looksLikePersonLocal(local) ? 'person' : 'other');
      const at = deobfuscated.indexOf(email);
      const context = at >= 0 ? deobfuscated.slice(Math.max(0, at - 90), at + email.length + 60).replace(/\n/g, ' ') : source.context;
      if (!out.has(email)) out.set(email, { email, local, domain: emailDomain, kind, context, sourceUrl });
    }
  }
  return [...out.values()];
}

/** "paul.martin" → { firstName: 'Paul', lastName: 'Martin' }; '' parts when the local part is not a name. */
export function nameFromLocal(local) {
  const m = String(local || '').toLowerCase().match(/^([a-z]{2,})[._-]([a-z]{2,})$/);
  if (!m) return { firstName: '', lastName: '' };
  const cap = word => word.charAt(0).toUpperCase() + word.slice(1);
  return { firstName: cap(m[1]), lastName: cap(m[2]) };
}

const CRAWL_LINK_RE = /(?:^|\/)(?:contact(?:ez)?(?:-nous|-us)?|about(?:-us)?|a-propos|qui-sommes-nous|company|entreprise|team|equipe|l-equipe|our-team|people|careers?|jobs?|join(?:-us)?|recrutement|nous-rejoindre|rejoignez-nous|emploi|legal|mentions-legales|mentions|impressum|imprint|privacy|confidentialite|politique-de-confidentialite|cgu|terms|press|presse|media)(?:\/|\.html?|\.php|$|\?|#)/i;

/**
 * Internal links worth reading for contacts: contact, about, team, careers,
 * legal and privacy pages. Returns absolute URLs, most useful first.
 */
export function pickCrawlLinks(html, baseUrl, { limit = 7 } = {}) {
  let base;
  try { base = new URL(baseUrl); } catch { return []; }
  const baseDomain = registrableDomain(base.hostname);
  const seen = new Set();
  const scored = [];
  for (const m of String(html || '').matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi)) {
    let url;
    try { url = new URL(decodeEntities(m[1]), base); } catch { continue; }
    if (!/^https?:$/.test(url.protocol) || registrableDomain(url.hostname) !== baseDomain) continue;
    url.hash = '';
    const href = url.href.replace(/\/$/, '');
    if (seen.has(href) || href === base.href.replace(/\/$/, '')) continue;
    const path = url.pathname.toLowerCase();
    const label = pageText(m[2]).toLowerCase();
    const hit = CRAWL_LINK_RE.test(path) || /\b(?:contact|about|team|équipe|equipe|careers?|jobs?|recrutement|rejoindre|mentions légales|mentions legales|impressum|privacy|confidentialité|legal|press|presse)\b/.test(label);
    if (!hit) continue;
    seen.add(href);
    const priority = /contact/.test(path + label) ? 0 : /team|equipe|équipe|people|about|propos|company|entreprise/.test(path + label) ? 1 : /career|job|recrut|rejoin|join|emploi/.test(path + label) ? 2 : /mention|impressum|imprint|legal/.test(path + label) ? 3 : 4;
    scored.push({ url: href, priority });
  }
  return scored.sort((a, b) => a.priority - b.priority).slice(0, limit).map(item => item.url);
}

/** Default paths to try when the home page links nothing useful. */
export function defaultCrawlPaths(language = 'en') {
  const fr = ['/contact', '/a-propos', '/equipe', '/mentions-legales', '/nous-rejoindre', '/recrutement', '/about', '/team', '/careers', '/legal', '/privacy'];
  const en = ['/contact', '/contact-us', '/about', '/about-us', '/team', '/company', '/careers', '/jobs', '/legal', '/imprint', '/impressum', '/privacy'];
  return language === 'fr' ? fr : en;
}

// ── Named people on company pages (legal notices, team pages) ───────────────
const NAME = '([A-ZÀ-ÝÇ][\\p{L}\'’-]+(?:\\s+(?:de|du|des|van|von|der|den|da|di|le|la|du)\\s+)?(?:\\s+[A-ZÀ-ÝÇ][\\p{L}\'’-]+){1,2})';
const HONORIFIC = '(?:M\\.|Mme\\.?|Mr\\.?|Mrs\\.?|Ms\\.?|Monsieur|Madame|Herr|Frau|Dr\\.?)?\\s*';
const PEOPLE_PATTERNS = [
  { re: new RegExp(`directeur(?:·?trice|·e)? de (?:la )?publication\\s*[:\\-–—]?\\s*${HONORIFIC}${NAME}`, 'iu'), title: 'Directeur de la publication', persona: 'founder' },
  { re: new RegExp(`responsable de (?:la )?publication\\s*[:\\-–—]?\\s*${HONORIFIC}${NAME}`, 'iu'), title: 'Responsable de la publication', persona: 'founder' },
  { re: new RegExp(`repr[ée]sent[ée]e?\\s+(?:l[ée]galement\\s+)?par\\s*[:\\-–—]?\\s*${HONORIFIC}${NAME}`, 'iu'), title: 'Représentant légal', persona: 'founder' },
  { re: new RegExp(`\\b(?:pr[ée]sident(?:e)?|g[ée]rant(?:e)?|directeur g[ée]n[ée]ral|directrice g[ée]n[ée]rale)\\s*[:\\-–—]\\s*${HONORIFIC}${NAME}`, 'iu'), title: 'Président', persona: 'founder' },
  { re: new RegExp(`gesch[äa]ftsf[üu]hr(?:er|erin|ung)\\s*[:\\-–—]?\\s*${HONORIFIC}${NAME}`, 'iu'), title: 'Geschäftsführer', persona: 'founder' },
  { re: new RegExp(`\\b(CEO|Chief Executive Officer|Founder|Co-?founder|CTO|CPO|COO|CMO|Head of [A-Z][\\p{L}]+(?: [A-Z][\\p{L}]+)?|VP(?: of)? [A-Z][\\p{L}]+|Design Lead|Head of Design)\\s*[:\\-–—]\\s*${HONORIFIC}${NAME}`, 'u'), title: null, persona: null },
  { re: new RegExp(`${NAME},?\\s+(?:is\\s+|est\\s+)?(?:our\\s+|the\\s+|notre\\s+|le\\s+|la\\s+)?(CEO|Chief Executive Officer|Founder|Co-?founder|Fondateur|Fondatrice|Cofondateur|Cofondatrice|CTO|CPO|COO|CMO|Head of [A-Z][\\p{L}]+(?: [A-Z][\\p{L}]+)?|VP(?: of)? [A-Z][\\p{L}]+|Design Lead|Head of Design)\\b`, 'u'), title: null, persona: null, nameFirst: true },
];
const NOT_A_NAME = /^(?:Mentions|Legal|Notice|Contact|Site|Societe|Société|Company|Hébergeur|Hebergeur|Editeur|Éditeur|Siège|Siege|Capital|Adresse|Paris|France|Europe|Directeur|Directrice|Responsable|Président|Gérant|Service|Client|Support|Data|Protection|Privacy|Policy|Terms|Conditions|Cookie|Cookies|Email|Mail|Tel|Téléphone|Telephone|Fax|SAS|SARL|SA|Inc|Ltd|GmbH|OVH|AWS|Google|Amazon|Microsoft|Cloud|Web|Services|Head|Lead|Chief|Officer|Vice|Senior|Junior|Product|Design|Engineering|Marketing|Sales|People|Talent)$/i;

function properCase(word) {
  return word.split(/([-'’])/).map(part => (/^[-'’]$/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())).join('');
}

/**
 * "Marie Dupont" → first/last. Rejects initials ("Ben N.", "A. Dylan"),
 * digits, role words and anything that is not two to four name words.
 */
const LEAD_IN_WORD = /^(?:meet|contact|say|hello|hi|welcome|introducing|with|from|our|about|join|ask|email|call|by|and|or|the|dear|chez|rencontrez|contactez|avec|par|notre|votre|bonjour|voici)$/i;

function splitName(full) {
  const words = String(full || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  // "Meet Claire Martin" → "Claire Martin".
  while (words.length >= 3 && LEAD_IN_WORD.test(words[0])) words.shift();
  if (words.length < 2 || words.length > 4) return null;
  if (words.some(word => NOT_A_NAME.test(word) || /\d/.test(word) || /^\p{L}\.?$/u.test(word) || /\.$/.test(word) || !/^\p{L}[\p{L}'’-]*$/u.test(word))) return null;
  const named = words.map(word => (word === word.toLowerCase() || word === word.toUpperCase() ? properCase(word) : word));
  return { firstName: named[0], lastName: named.slice(1).join(' ') };
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

/** People named with a role on a page: legal notices, team sections. */
export function extractNamedPeople(text, { sourceUrl = '' } = {}) {
  const lines = String(text || '').split('\n');
  const out = new Map();
  for (const line of lines) {
    for (const pattern of PEOPLE_PATTERNS) {
      const m = line.match(pattern.re);
      if (!m) continue;
      const name = splitName(pattern.nameFirst ? m[1] : m[pattern.title ? 1 : 2]);
      if (!name) continue;
      const title = pattern.title || (pattern.nameFirst ? m[2] : m[1]);
      const key = `${name.firstName} ${name.lastName}`.toLowerCase();
      if (out.has(key)) continue;
      out.set(key, { ...name, title: String(title).trim(), persona: pattern.persona || inferPersona({ title }), source: 'site', sourceUrl, evidence: line.trim().slice(0, 160) });
    }
  }
  return [...out.values()];
}

// ── People from web search (LinkedIn result titles and snippets) ────────────
const TITLE_SPLIT_RE = /\s+[-–—|·]\s+|\s+\|\s+/;
const LINKEDIN_RE = /linkedin\.com\/(?:[a-z]{2,3}\/)?(?:in|pub)\//i;

function cleanTitlePart(part) {
  return String(part || '').replace(/\s*\|\s*linkedin\s*$/i, '').replace(/^\s*linkedin\s*[:|-]\s*/i, '').replace(/\s+/g, ' ').trim();
}

/**
 * Parse one search result into a person. LinkedIn titles come as
 * "Jane Doe - Head of Design - Acme | LinkedIn" (any order after the name);
 * snippets carry "Head of Design at Acme". Returns null unless the company
 * is mentioned somewhere.
 */
export function parseSearchPerson(result = {}, { company = '', domain = '' } = {}) {
  const url = String(result.url || '');
  if (!LINKEDIN_RE.test(url)) return null;
  const parts = String(result.title || '').replace(/\s+on LinkedIn:.*$/i, '').split(TITLE_SPLIT_RE).map(cleanTitlePart).filter(Boolean);
  if (!parts.length) return null;
  const name = splitName(parts[0].replace(/[,(].*$/, ''));
  if (!name) return null;
  const rest = parts.slice(1);
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
  if (!title && at) title = at[1].replace(/^(?:[^.]*?(?:\d+\+?\s+(?:followers|abonnés)|·)\s*)/i, '').trim();
  if (!companyPart && at && companyPartMatches(at[2].replace(/\s*(?:·|\||,).*$/, ''), company, domain)) companyPart = at[2].trim();
  if (!companyPart) {
    // Snippet sentences: "Experience: Riot · Location: Paris" or "… at Riot."
    const mentions = [...snippet.matchAll(/(?:Experience|Expérience|at|chez|@)\s*:?\s*([^·|.,;]{2,40})/gi)].map(m => m[1].trim());
    companyPart = mentions.find(part => companyPartMatches(part, company, domain)) || '';
  }
  if (!companyPart) return null;
  title = title.replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return { ...name, title, persona: inferPersona({ title }), linkedinUrl: url.split('?')[0], source: 'search', evidence: `${result.title || ''}${snippet ? ` — ${snippet.slice(0, 120)}` : ''}`.slice(0, 220) };
}

/** Titles of the person who would lead this role's team. */
export function roleLeadTitles(role = '') {
  const r = String(role || '').toLowerCase();
  if (/design|ux|ui\b|user experience|product designer/.test(r)) return ['Head of Design', 'Design Lead', 'VP Design', 'Head of Product Design', 'Design Director', 'Design Manager'];
  if (/product manager|product owner|head of product|product lead|chef de produit|cpo/.test(r)) return ['Head of Product', 'VP Product', 'CPO', 'Product Director', 'Product Lead'];
  if (/engineer|developer|développeur|software|backend|frontend|full ?stack|devops|sre/.test(r)) return ['CTO', 'VP Engineering', 'Head of Engineering', 'Engineering Manager'];
  if (/data|analytics|machine learning|ml\b|ai\b|intelligence artificielle/.test(r)) return ['Head of Data', 'VP Data', 'Head of AI', 'CTO'];
  if (/marketing|growth|brand|content|communication/.test(r)) return ['Head of Marketing', 'CMO', 'VP Marketing', 'Head of Growth'];
  if (/sales|account|business developer|commercial/.test(r)) return ['Head of Sales', 'VP Sales', 'CRO'];
  if (/people|hr\b|talent|recrut/.test(r)) return ['Head of People', 'CPO', 'HR Director'];
  return ['Head of', 'Director', 'VP'];
}

/** The three searches (recruiter, team lead, founder), company-scoped. */
export function peopleQueries({ company = '', role = '', domain = '' } = {}) {
  const name = String(company || '').trim();
  if (!name) return [];
  const scope = domain ? `"${name}" ${String(domain).split('.')[0]}` : `"${name}"`;
  const lead = roleLeadTitles(role).slice(0, 4).map(t => `"${t}"`).join(' OR ');
  return [
    { persona: 'recruiter', query: `site:linkedin.com/in ${scope} ("talent acquisition" OR recruiter OR "talent partner" OR "head of people" OR "chargée de recrutement" OR "responsable recrutement")` },
    { persona: 'hiring-manager', query: `site:linkedin.com/in ${scope} (${lead})` },
    { persona: 'founder', query: `site:linkedin.com/in ${scope} (CEO OR founder OR "co-founder" OR fondateur)` },
  ];
}

// ── Email patterns for a named person ───────────────────────────────────────
const PATTERNS = ['first.last', 'first', 'flast', 'firstlast', 'first_last', 'f.last', 'last', 'first-last', 'lastfirst', 'last.first'];

function asciiLocal(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, '').replace(/[^a-z0-9-]+/g, '').replace(/-+/g, '-');
}

export function applyPattern(pattern, firstName, lastName) {
  const first = asciiLocal(firstName).replace(/-/g, '');
  const lastWords = String(lastName || '').trim().split(/\s+/).filter(Boolean);
  const last = asciiLocal(lastWords[lastWords.length - 1] || '').replace(/-/g, '');
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

/** Which pattern an address follows for a known name, or ''. */
export function detectPattern(email, firstName, lastName) {
  const local = String(email || '').toLowerCase().split('@')[0];
  for (const pattern of PATTERNS) {
    if (local && applyPattern(pattern, firstName, lastName) === local) return pattern;
  }
  return '';
}

/**
 * Guess the company's naming pattern from person-like addresses found on
 * its site ("marie.dupont@" → first.last). Returns the most frequent
 * pattern, or '' when the addresses show none.
 */
export function inferPattern(personEmails = []) {
  const counts = new Map();
  for (const email of personEmails) {
    const local = String(email || '').toLowerCase().split('@')[0];
    const pattern = /^[a-z]+\.[a-z]+$/.test(local) ? 'first.last'
      : /^[a-z]+_[a-z]+$/.test(local) ? 'first_last'
        : /^[a-z]+-[a-z]+$/.test(local) ? 'first-last'
          : /^[a-z]\.[a-z]{3,}$/.test(local) ? 'f.last'
            : '';
    if (pattern) counts.set(pattern, (counts.get(pattern) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}

/** Candidate addresses for a person, best pattern first. */
export function emailCandidates({ firstName, lastName, domain, knownPattern = '' } = {}) {
  if (!domain || !firstName) return [];
  const order = [...new Set([knownPattern, ...PATTERNS].filter(Boolean))];
  const out = [];
  for (const pattern of order) {
    const local = applyPattern(pattern, firstName, lastName);
    if (local && !out.some(item => item.local === local)) out.push({ pattern, local, email: `${local}@${domain}` });
  }
  return out;
}

const mxCache = new Map();
/** Does the domain publish MX records (so an address there can receive mail)? */
export async function domainAcceptsMail(domain) {
  const key = String(domain || '').toLowerCase();
  if (!key) return false;
  if (mxCache.has(key)) return mxCache.get(key);
  let ok = null;
  try {
    const records = await dns.resolveMx(key);
    ok = Array.isArray(records) && records.length > 0;
  } catch (err) {
    ok = err?.code === 'ENODATA' || err?.code === 'ENOTFOUND' ? false : null;
  }
  mxCache.set(key, ok);
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

/**
 * Fetch one public page with the providers' guarded HTTP layer (resolved
 * address must be public). Follows up to three redirects, each re-checked.
 */
export function createPageFetcher({ timeoutMs = 10000, maxChars = 400000, language = 'fr,en;q=0.8' } = {}) {
  return async function fetchPage(input) {
    let url = publicHttpUrl(input);
    if (!url) return { ok: false, status: 0, html: '', text: '', url: String(input || ''), error: 'not a public http(s) URL' };
    for (let hop = 0; hop < 4; hop += 1) {
      let response;
      try {
        response = await fetchResponse(url.href, { timeoutMs, redirect: 'manual', headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'Accept-Language': language } });
      } catch (err) {
        return { ok: false, status: err?.status || 0, html: '', text: '', url: url.href, error: err?.message || String(err) };
      }
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        let next = null;
        try { next = location ? publicHttpUrl(new URL(location, url).href) : null; } catch { next = null; }
        if (!next) return { ok: false, status: response.status, html: '', text: '', url: url.href, error: 'redirect to a non-public URL' };
        url = next;
        continue;
      }
      const declared = Number(response.headers.get('content-length') || 0);
      if (declared > 3_000_000) return { ok: false, status: response.status, html: '', text: '', url: url.href, error: `page too large (${declared} bytes)` };
      const contentType = response.headers.get('content-type') || '';
      if (!/text\/html|application\/xhtml|text\/plain/i.test(contentType) && contentType) {
        return { ok: false, status: response.status, html: '', text: '', url: url.href, error: `not an HTML page (${contentType.split(';')[0]})` };
      }
      const html = (await response.text()).slice(0, maxChars);
      return { ok: true, status: response.status, html, text: pageText(html), url: url.href };
    }
    return { ok: false, status: 0, html: '', text: '', url: url.href, error: 'too many redirects' };
  };
}

// ── Ranking ─────────────────────────────────────────────────────────────────
const CONFIDENCE_WEIGHT = { verified: 3, likely: 2, guess: 1 };
// A named employee with an unknown role still beats a support inbox: a person
// can forward an application, a ticket queue rarely does.
const PERSONA_WEIGHT = { recruiter: 3, 'hiring-manager': 3, founder: 2, inbox: 1.5, unknown: 1.6 };

export function scoreContact(contact) {
  let confidence = CONFIDENCE_WEIGHT[contact.confidence] || 0;
  let persona = PERSONA_WEIGHT[contact.persona] ?? 1;
  if (contact.kind === 'hiring') persona = 2.5;
  // A generic inbox (contact@, support@) is a last resort: it stays below a
  // likely named recruiter or team lead, above a bare guess.
  if (contact.kind === 'generic') { persona = 0.5; confidence = Math.min(confidence, 2); }
  if (contact.kind === 'avoid') persona = 0;
  let source = 0;
  if (contact.sources.some(s => s.type === 'posting')) source += 1.5;
  if (contact.sources.some(s => s.type === 'site')) source += 1;
  if (contact.sources.some(s => s.type === 'provider')) source += 0.5;
  if (contact.mx === false) return 0;
  return confidence * 2 + persona + source;
}

export function rankContacts(contacts = []) {
  return contacts
    .map(contact => ({ ...contact, score: Number(scoreContact(contact).toFixed(2)) }))
    .filter(contact => contact.score > 0 && contact.kind !== 'avoid')
    .sort((a, b) => b.score - a.score);
}

/** The contact worth drafting for without asking: a verified or likely address. */
export function pickBest(ranked = []) {
  return ranked.find(contact => contact.confidence !== 'guess' && contact.mx !== false) || null;
}

function contactFor({ email, firstName = '', lastName = '', title = '', kind = '', persona = '', confidence = 'guess', source, linkedinUrl = '' }) {
  const local = String(email).split('@')[0];
  const resolvedKind = kind || (firstName ? 'person' : classifyMailbox(local) || 'other');
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

function rememberPerson(people, person) {
  const key = `${person.firstName} ${person.lastName}`.toLowerCase();
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

const TEAM_PAGE_RE = /\b(?:team|équipe|equipe|founders?|fondateurs?|leadership|ceo|cto|head of|directeur|directrice|notre histoire|about us|qui sommes)\b/i;

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
  const en = words.filter(w => /^(?:the|and|with|for|of|to|in|you|our)$/.test(w)).length;
  const fr = words.filter(w => /^(?:le|la|les|et|avec|pour|des|du|dans|vous|nous|une)$/.test(w)).length;
  return fr > en ? 'fr' : 'en';
}

/**
 * The whole search for one offer. Network goes through the injected
 * functions; everything else is deterministic and covered by tests.
 */
export async function findContacts({ company = '', role = '', jobUrl = '', jobText = '', jobHtml = '', companyUrlHint = '' } = {}, {
  fetchPage,
  webSearch = null,
  providers = [],
  extractPeople = null,
  judgePeople = null,
  resolveMx = domainAcceptsMail,
  maxPages = 8,
  maxSearches = 4,
  log = () => {},
  onStatus = () => {},
} = {}) {
  if (typeof fetchPage !== 'function') throw new Error('findContacts needs fetchPage');
  const notes = [];
  const searches = [];
  const pagesRead = [];
  const contacts = new Map();
  const people = new Map();
  const companyName = String(company || '').trim();
  const language = sameLanguageAs(jobText);

  const search = async (query, { num = 10 } = {}) => {
    if (!webSearch || searches.length >= maxSearches) return [];
    try {
      const results = (await webSearch(query, { num })) || [];
      searches.push({ query, results: results.length });
      log(`search "${query.slice(0, 80)}" → ${results.length}`);
      return results;
    } catch (err) {
      searches.push({ query, results: 0, error: err.message });
      log(`search failed "${query.slice(0, 60)}": ${err.message}`);
      return [];
    }
  };

  // 1. The company's own domain.
  onStatus('Site de l\'entreprise');
  let domain = '';
  let website = '';
  let domainSource = '';
  const hinted = absolutize(companyUrlHint);
  if (hinted) {
    try { const host = new URL(hinted).hostname; if (!isJobHost(host) && !isSocialHost(host)) { domain = registrableDomain(host); website = hinted; domainSource = 'hint'; } } catch { /* ignore */ }
  }
  if (!domain) {
    const fromHtml = companyWebsiteFromHtml(jobHtml);
    if (fromHtml) { domain = registrableDomain(new URL(fromHtml).hostname); website = fromHtml; domainSource = 'job-page'; }
  }
  // The posting's host is the employer only when it is not a job board we
  // know; an unknown board would otherwise become "the company". When the
  // host does not look like the company's name, it is kept as a last resort.
  const hostDomain = companyDomainFromJobUrl(jobUrl);
  if (!domain && hostDomain && (!companyName || domainMatchesCompany(hostDomain, companyName))) {
    domain = hostDomain;
    website = `https://${domain}`;
    domainSource = 'job-url';
  }
  if (!domain) {
    const mentioned = domainsFromText(jobText, companyName).find(item => domainMatchesCompany(item.domain, companyName));
    if (mentioned) { domain = mentioned.domain; website = `https://${domain}`; domainSource = 'posting-text'; }
  }
  if (!domain && companyName && webSearch) {
    onStatus('Recherche du site officiel');
    const results = await search(`"${companyName}" ${language === 'fr' ? 'site officiel' : 'official website'}`, { num: 8 });
    const picked = pickDomainFromSearch(results, companyName);
    if (picked) { domain = picked.domain; website = picked.url; domainSource = 'search'; }
  }
  if (!domain && hostDomain) {
    domain = hostDomain;
    website = `https://${domain}`;
    domainSource = 'job-url-unmatched';
    notes.push(`Le site ${domain} vient de l'adresse de l'annonce et ne porte pas le nom « ${companyName} » : vérifiez qu'il s'agit bien de l'employeur.`);
  }
  if (!domain) notes.push('Site de l\'entreprise introuvable : seules les adresses de l\'annonce sont utilisables.');

  // 2. Addresses printed in the posting itself (the employer said where to write).
  for (const found of extractEmails(jobText, { domain: '' })) {
    if (domain && found.domain !== domain && found.kind !== 'hiring') continue;
    if (found.kind === 'avoid') continue;
    mergeContact(contacts, contactFor({ email: found.email, kind: found.kind === 'other' ? 'generic' : found.kind, confidence: 'verified', source: { type: 'posting', url: jobUrl, detail: found.context } }));
  }

  // 2b. People the posting names ("Louis, Talent Acquisition Manager", "you
  // will report to Marie Dupont, Head of Design"): deterministic patterns,
  // then the optional model pass, every name checked against the posting.
  if (String(jobText).trim()) {
    for (const person of extractNamedPeople(jobText, { sourceUrl: jobUrl })) rememberPerson(people, { ...person, source: 'posting' });
    if (extractPeople) {
      try {
        const found = await extractPeople(String(jobText).slice(0, 8000), { company: companyName, source: 'posting' });
        for (const item of found || []) {
          const firstName = String(item.firstName || '').trim();
          const lastName = String(item.lastName || '').trim();
          const title = String(item.title || '').trim().slice(0, 80);
          if (!firstName || !title) continue;
          // The role must be written in the posting too, not inferred by the model.
          if (!String(jobText).toLowerCase().includes(title.toLowerCase())) continue;
          const full = [firstName, lastName].filter(Boolean).join(' ');
          if (!new RegExp(`(?:^|[^\\p{L}])${full.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[^\\p{L}]|$)`, 'u').test(jobText)) continue;
          const name = lastName ? splitName(full) : (/^\p{L}[\p{L}'’-]{1,30}$/u.test(firstName) && !NOT_A_NAME.test(firstName) ? { firstName: properCase(firstName), lastName: '' } : null);
          if (!name) continue;
          rememberPerson(people, { ...name, title, persona: inferPersona({ title }), source: 'posting', sourceUrl: jobUrl, evidence: `${full}, ${title} (named in the posting)` });
        }
      } catch (err) {
        log(`extractPeople failed on the posting: ${err.message}`);
      }
    }
  }

  // 3. The site: home page, then contact / about / team / careers / legal pages.
  let companyText = '';
  const personEmails = [];
  const teamPages = [];
  const pageQueue = [];
  if (domain) {
    onStatus('Lecture du site de l\'entreprise');
    const home = await fetchPage(website || `https://${domain}`);
    if (home.ok) {
      pagesRead.push(home.url);
      companyText = home.text.slice(0, 3000);
      const links = pickCrawlLinks(home.html, home.url, { limit: maxPages - 1 });
      pageQueue.push(...links);
      const base = home.url.replace(/\/$/, '');
      for (const path of defaultCrawlPaths(language)) {
        const candidate = `${base}${path}`;
        if (pageQueue.length >= maxPages - 1) break;
        if (!pageQueue.some(url => url.toLowerCase() === candidate.toLowerCase())) pageQueue.push(candidate);
      }
      const harvest = (page) => {
        for (const found of extractEmails(page.html, { domain, sourceUrl: page.url })) {
          if (found.kind === 'person') personEmails.push(found.email);
          mergeContact(contacts, contactFor({ email: found.email, kind: found.kind === 'other' ? 'generic' : found.kind, confidence: 'verified', source: { type: 'site', url: page.url, detail: found.context } }));
        }
        for (const person of extractNamedPeople(page.text, { sourceUrl: page.url })) rememberPerson(people, person);
        if (extractPeople && teamPages.length < 2 && TEAM_PAGE_RE.test(page.text)) teamPages.push(page);
      };
      harvest(home);
      let read = 1;
      for (const url of pageQueue) {
        if (read >= maxPages) break;
        const page = await fetchPage(url);
        read += 1;
        if (!page.ok) continue;
        pagesRead.push(page.url);
        harvest(page);
      }
    } else {
      notes.push(`Le site ${domain} n'a pas répondu (${home.error || `HTTP ${home.status}`}).`);
    }
  }

  // 3b. Optional model pass over team/about pages: names with a title, each
  // checked to appear word for word in the page (the model lists, never invents).
  if (extractPeople && teamPages.length) {
    onStatus('Lecture de la page équipe');
    for (const page of teamPages) {
      try {
        const found = await extractPeople(page.text.slice(0, 6000), { company: companyName });
        for (const item of found || []) {
          const name = splitName(`${item.firstName || ''} ${item.lastName || ''}`.trim() || item.name || '');
          if (!name) continue;
          const full = `${name.firstName} ${name.lastName}`;
          if (!nameOnPage(page.text, name)) continue;
          const title = String(item.title || '').trim().slice(0, 80);
          if (!title || !page.text.toLowerCase().includes(title.toLowerCase())) continue;
          rememberPerson(people, { ...name, title, persona: inferPersona({ title }), source: 'site', sourceUrl: page.url, evidence: `${full}, ${title}` });
        }
      } catch (err) {
        log(`extractPeople failed on ${page.url}: ${err.message}`);
      }
    }
  }

  // 4. People through web search: recruiter, the team's lead, a founder.
  if (webSearch && companyName) {
    onStatus('Recherche des recruteurs et de l\'équipe');
    const fromSearch = [];
    for (const item of peopleQueries({ company: companyName, role, domain })) {
      if (searches.length >= maxSearches) break;
      const results = await search(item.query, { num: 10 });
      for (const result of results) {
        const person = parseSearchPerson(result, { company: companyName, domain });
        if (!person) continue;
        if (person.persona === 'unknown' && item.persona !== 'hiring-manager') person.persona = item.persona;
        fromSearch.push({ ...person, queryPersona: item.persona });
      }
    }
    // Namesakes ("Riot" the startup vs Riot Games): a model reads the company
    // page and the posting and keeps only people who plausibly work HERE.
    let kept = fromSearch;
    if (judgePeople && fromSearch.length && (companyText || jobText)) {
      try {
        const verdict = await judgePeople(fromSearch.map(p => ({ name: `${p.firstName} ${p.lastName}`.trim(), title: p.title, evidence: p.evidence })), { company: companyName, companyText, jobText, role });
        if (Array.isArray(verdict)) {
          kept = fromSearch.filter((_, index) => verdict.includes(index));
          const dropped = fromSearch.length - kept.length;
          if (dropped) log(`judgePeople dropped ${dropped}/${fromSearch.length} search result(s) as another company`);
        }
      } catch (err) {
        log(`judgePeople failed: ${err.message}`);
      }
    }
    for (const person of kept) rememberPerson(people, person);
  }

  // 5. An address for each person: provider first, else the site's own pattern, else a guess.
  const knownPattern = inferPattern(personEmails);
  let providerPattern = '';
  const providersUsed = [];
  const live = [...providers];
  if (domain && live.length) {
    onStatus('Vérification des adresses');
    for (const provider of live) {
      if (typeof provider.domainSearch !== 'function') continue;
      try {
        const found = await provider.domainSearch(domain);
        providersUsed.push(provider.name);
        providerPattern = found.pattern || '';
        for (const item of found.emails || []) {
          if (!item.email) continue;
          const kind = item.firstName ? 'person' : classifyMailbox(item.email.split('@')[0]) || 'generic';
          if (kind === 'avoid') continue;
          mergeContact(contacts, contactFor({ email: item.email, firstName: item.firstName, lastName: item.lastName, title: item.title, kind, confidence: item.status === 'verified' ? 'verified' : 'likely', source: { type: 'provider', url: provider.name, detail: item.title || item.department || '' } }));
        }
      } catch (err) {
        if (err.unavailable) { notes.push(`${provider.name} indisponible : ${err.message}`); live.splice(live.indexOf(provider), 1); }
        else log(`${provider.name} domainSearch failed: ${err.message}`);
      }
    }
  }
  if (domain) {
    for (const person of people.values()) {
      if (!person.firstName || contacts.size > 40) break;
      // A first name alone (from the posting) only supports first@domain.
      if (!person.lastName && !person.sources?.some(s => s.type === 'posting')) continue;
      const existing = [...contacts.values()].find(c => c.firstName.toLowerCase() === person.firstName.toLowerCase() && c.lastName.toLowerCase() === person.lastName.toLowerCase());
      if (existing) { existing.title = existing.title || person.title; existing.persona = person.persona; existing.linkedinUrl = existing.linkedinUrl || person.linkedinUrl || ''; continue; }
      let resolved = null;
      for (const provider of live) {
        if (typeof provider.findEmail !== 'function') continue;
        try {
          const answer = await provider.findEmail({ firstName: person.firstName, lastName: person.lastName, domain, company: companyName, title: person.title });
          if (!providersUsed.includes(provider.name)) providersUsed.push(provider.name);
          if (answer.email) { resolved = { email: answer.email, confidence: answer.status === 'verified' ? 'verified' : answer.status === 'likely' ? 'likely' : 'guess', source: { type: 'provider', url: provider.name, detail: `${person.title || ''}`.trim() } }; break; }
        } catch (err) {
          if (err.unavailable) { notes.push(`${provider.name} indisponible : ${err.message}`); live.splice(live.indexOf(provider), 1); }
          else log(`${provider.name} findEmail failed: ${err.message}`);
        }
      }
      if (!resolved) {
        const pattern = knownPattern || (providerPattern ? providerPattern.replace(/[{}]/g, '') : '');
        const candidates = emailCandidates({ firstName: person.firstName, lastName: person.lastName, domain, knownPattern: pattern });
        if (!candidates.length) continue;
        const first = candidates[0];
        resolved = { email: first.email, confidence: pattern && first.pattern === pattern ? 'likely' : 'guess', source: { type: 'pattern', url: person.sourceUrl || person.linkedinUrl || '', detail: pattern ? `schéma du site : ${pattern}` : `schéma courant : ${first.pattern}` }, alternatives: candidates.slice(1, 3).map(item => item.email) };
      }
      const contact = contactFor({ email: resolved.email, firstName: person.firstName, lastName: person.lastName, title: person.title, kind: 'person', persona: person.persona, confidence: resolved.confidence, source: resolved.source, linkedinUrl: person.linkedinUrl || '' });
      for (const source of person.sources || []) contact.sources.push(source);
      if (resolved.alternatives) contact.alternatives = resolved.alternatives;
      mergeContact(contacts, contact);
    }
  } else if (people.size) {
    notes.push(`${people.size} personne(s) trouvée(s) mais sans domaine d'entreprise, aucune adresse ne peut être construite.`);
  }

  // 6. Mail check per domain (MX), then ranking.
  const domains = [...new Set([...contacts.values()].map(c => c.email.split('@')[1]))];
  for (const d of domains) {
    const ok = await resolveMx(d).catch(() => null);
    for (const contact of contacts.values()) if (contact.email.endsWith(`@${d}`)) contact.mx = ok;
    if (ok === false) notes.push(`${d} ne reçoit pas de mail (pas de MX).`);
  }
  const ranked = rankContacts([...contacts.values()]);
  const best = pickBest(ranked);
  if (!ranked.length) notes.push('Aucune adresse trouvée. Vous pouvez saisir une adresse à la main.');
  else if (!best) notes.push('Seules des adresses devinées : à confirmer avant d\'écrire.');

  return {
    company: { name: companyName, domain, website, source: domainSource },
    companyText,
    contacts: ranked,
    best,
    people: [...people.values()],
    searches,
    pagesRead,
    providersUsed,
    notes,
  };
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

/** Company name from a posting's first lines ("Senior Designer at Acme", "Company: Acme"). */
export function companyNameFromJobText(jobText) {
  const head = String(jobText || '').split('\n').slice(0, 8).join('\n');
  // An explicit "Company:" line wins over "Designer at Paris office".
  // The name stays on its line: "at OneAsset\nUX/UI Designer" read "OneAsset UX".
  const m = head.match(/^(?:Company|Entreprise|Employer|Société)\s*:\s*(.+)$/im) || head.match(/\b(?:at|chez|@)[ \t]+([A-Z][\w&.'-]*(?:[ \t]+[A-Z][\w&.'-]*){0,2})/);
  return m ? String(m[1]).replace(/\s+/g, ' ').trim().slice(0, 60) : '';
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
  return own.some((o) => normCompany(o) === n);
}

/**
 * The company to search: the given one (tracker row / user), else the job
 * board URL, else the posting's first lines; any of the candidate's own
 * companies is skipped. Returns { company, source, rejected }.
 */
export function targetCompany({ company = '', jobUrl = '', jobText = '', own = [] } = {}) {
  const rejected = [];
  const tries = [
    ['given', String(company || '').trim()],
    ['job-url', companyFromJobUrl(jobUrl)],
    ['posting-text', jobText ? companyNameFromJobText(jobText) : ''],
  ];
  for (const [source, name] of tries) {
    if (!name) continue;
    if (isOwnCompany(name, own)) { rejected.push(name); continue; }
    return { company: name, source, rejected };
  }
  return { company: '', source: '', rejected };
}
