// Free sources for the employer's own site, read before any web search: the
// offer's ATS account (Ashby, Greenhouse, Lever, Workable), Welcome to the
// Jungle's organisation API, an ATS tenant's career site, the LinkedIn
// company page linked from a posting, and domains built from the name.
//
// 218 of the 575 reports (2026-10-24) sit on ATS or WTTJ hosts that publish
// the employer's website for free (Ashby publicWebsite bjak.my, Workable url
// mlabs.city, WTTJ media_website_url alan.com), while the finder asked a
// search engine that blocks after 2-3 queries (2026-10-23). The account's own
// name also tells a wrong tracker company apart: a "Lindy" row on Ashby board
// bjakcareer is a Bjak offer.
//
// Pure readers plus one orchestrator that fetches through the caller's
// fetchPage; nothing here touches the network on its own. Endpoint formats
// change, so every reader returns '' quietly on an error or an unexpected
// shape. Name affinity is judged by the caller (contact-finder.mjs) through
// `accept`, so this module only imports host lists and slug parsing.

import { extractAtsSlugs } from './ats-explorer.mjs';
import { JOB_HOST_RE, SOCIAL_HOST_RE, companyNameWords, isNotEmployerHost } from './non-employer-hosts.mjs';

// The ATS and board hosts themselves: a link to them is never the employer's site.
const VENDOR_HOST_RE = /(?:^|\.)(?:ashbyhq\.com|greenhouse\.io|lever\.co|workable\.com|welcometothejungle\.com|wttj\.co|teamtailor\.com|teamtailor-cdn\.com|recruitee\.com)$/i;
const DOMAIN_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/;

// Same second-level rule as registrableDomain in contact-finder.mjs, which
// imports this module (so not the other way): careers.acme.co.uk → acme.co.uk.
function registrable(host) {
  const labels = String(host || '').toLowerCase().replace(/\.$/, '').split('.').filter(Boolean);
  if (labels.length < 2) return '';
  const secondLevel = labels.length >= 3 && /^(?:co|com|org|net|gov|ac|edu|ltd|plc|asso)$/.test(labels[labels.length - 2]);
  return labels.slice(-(secondLevel ? 3 : 2)).join('.');
}

// "&#1114112;" (above U+10FFFF) or a lone surrogate would throw out of
// String.fromCodePoint and fail the whole contact search: keep the entity text.
function codePointOr(code, fallback) {
  return Number.isInteger(code) && code >= 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : fallback;
}

function decodeEntities(value = '') {
  return String(value || '')
    .replace(/&#x([0-9a-f]+);/gi, (whole, hex) => codePointOr(parseInt(hex, 16), whole))
    .replace(/&#(\d+);/g, (whole, dec) => codePointOr(Number(dec), whole))
    .replace(/&quot;/gi, '"').replace(/&apos;|&#39;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&');
}

// An absolute http(s) URL, or '' (a bare "acme.com" gets https://).
function absoluteUrl(value) {
  const raw = decodeEntities(typeof value === 'string' ? value : '').trim().replace(/^\/\//, 'https://');
  if (!raw) return '';
  const candidate = /^https?:\/\//i.test(raw) ? raw : /^[\w.-]+\.[a-z]{2,}(?:\/|$)/i.test(raw) ? `https://${raw}` : '';
  try { return candidate ? new URL(candidate).href : ''; } catch { return ''; }
}

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

// A site of its own: not an ATS or board host, not a social network, a
// directory or shared hosting; or the vendor's own, for its own account
// (Ashby's board on jobs.ashbyhq.com/ashby names ashbyhq.com).
function ownSite(url, owner = '') {
  const host = hostOf(url);
  if (!host) return false;
  if (!VENDOR_HOST_RE.test(host) && !isNotEmployerHost(host)) return true;
  return Boolean(owner) && isNotEmployerHost(host) && !isNotEmployerHost(host, { company: owner });
}

const EMPTY = Object.freeze({ website: '', ownerName: '' });
const result = (website = '', ownerName = '') => ({ website: website && ownSite(website, cleanOwnerName(ownerName)) ? website : '', ownerName: cleanOwnerName(ownerName) });

/**
 * A board owner's name as an ATS prints it: "Bjak " → "Bjak", "Careers at
 * Acme" → "Acme", "Deliverect logo" → "Deliverect". '' when nothing is left.
 */
export function cleanOwnerName(name) {
  const text = decodeEntities(typeof name === 'string' ? name : '').replace(/[\u200e\u200f]/g, '').replace(/\s+/g, ' ').trim()
    .replace(/^(?:careers?|jobs?|join)\s+(?:at|@|chez)\s+/i, '')
    .replace(/\s+logo$/i, '')
    .replace(/\s*(?:[-–—|:]\s*|\s)(?:careers?|jobs?|job board|career site|recrutement|karriere)$/i, '')
    .trim();
  return text.length >= 2 && text.length <= 80 && !/^(?:careers?|jobs?|home)$/i.test(text) ? text : '';
}

/**
 * The crawl root of a site an ATS points at: a careers subdomain is not the
 * company's site (careers.datadoghq.com → https://datadoghq.com).
 */
export function siteRoot(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return ''; }
  const host = parsed.hostname.toLowerCase();
  const site = registrable(host);
  if (site && host !== site && /^(?:careers?|jobs?|join|work|apply|talent|hiring|recruiting|recrutement|karriere|team)$/.test(host.split('.')[0])) return `https://${site}`;
  return parsed.origin;
}

// ── Readers: one ATS answer → { website, ownerName } ────────────────────────

/**
 * Ashby board page (jobs.ashbyhq.com/<org>): the window.__appData blob holds
 * organization.name and organization.publicWebsite. Needs the page unslimmed
 * (the blob is an inline script); a truncated blob is read by pattern.
 */
export function ashbyAppData(html) {
  const raw = typeof html === 'string' ? html : '';
  if (!raw) return { ...EMPTY };
  const blob = raw.match(/window\.__appData\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/);
  if (blob) {
    try {
      const org = JSON.parse(blob[1])?.organization;
      if (org && typeof org === 'object') return result(absoluteUrl(org.publicWebsite), org.name);
    } catch { /* read by pattern below */ }
  }
  const unquote = value => { try { return JSON.parse(`"${value}"`); } catch { return ''; } };
  const orgAt = raw.search(/"organization"\s*:\s*\{/);
  const scope = orgAt >= 0 ? raw.slice(orgAt, orgAt + 4000) : '';
  const name = scope.match(/"name"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const site = (scope || raw).match(/"publicWebsite"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  return result(absoluteUrl(site ? unquote(site[1]) : ''), name ? unquote(name[1]) : '');
}

/**
 * Greenhouse board API (boards-api.greenhouse.io/v1/boards/<board>): the
 * board's name, and a link in its intro text whose domain carries that name.
 */
export function greenhouseBoard(json) {
  if (!json || typeof json !== 'object') return { ...EMPTY };
  const ownerName = cleanOwnerName(json.name);
  let website = '';
  if (ownerName && typeof json.content === 'string') {
    for (const m of decodeEntities(json.content).matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
      const url = absoluteUrl(m[1]);
      if (url && ownSite(url) && labelCarriesName(hostOf(url), ownerName)) { website = url; break; }
    }
  }
  return result(website, ownerName);
}

/**
 * Greenhouse jobs API (…/boards/<board>/jobs): a job's absolute_url on the
 * employer's own careers site (careers.datadoghq.com), and company_name.
 */
export function greenhouseJobsSite(json) {
  const jobs = Array.isArray(json?.jobs) ? json.jobs : [];
  let website = '';
  let ownerName = '';
  for (const job of jobs) {
    if (!job || typeof job !== 'object') continue;
    ownerName = ownerName || cleanOwnerName(job.company_name);
    const url = absoluteUrl(job.absolute_url);
    if (!website && url && ownSite(url)) website = new URL(url).origin;
    if (website && ownerName) break;
  }
  return result(website, ownerName);
}

/**
 * Lever board page: the a.main-header-logo href (a careers microsite such as
 * spotifyjobs.com, or nothing when it points back at lever.co) and the logo's
 * alt text or the page title as the name.
 */
export function leverHeaderLogo(html) {
  const raw = typeof html === 'string' ? html : '';
  if (!raw) return { ...EMPTY };
  let website = '';
  let ownerName = '';
  const anchor = raw.match(/<a\b[^>]*\bmain-header-logo\b[^>]*>/i);
  if (anchor) {
    website = absoluteUrl(anchor[0].match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1] || '');
    const img = raw.slice(anchor.index, anchor.index + anchor[0].length + 600).match(/<img\b[^>]*\balt\s*=\s*["']([^"']*)["']/i);
    ownerName = cleanOwnerName(img?.[1] || '');
  }
  if (!ownerName) ownerName = cleanOwnerName((raw.match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1] || '').split(/\s+[-–—|]\s+/)[0]);
  return result(website, ownerName);
}

/** Workable account API (apply.workable.com/api/v1/accounts/<acct>): url and name. */
export function workableAccount(json) {
  if (!json || typeof json !== 'object') return { ...EMPTY };
  return result(absoluteUrl(json.url || json.website), json.name);
}

/** Workable job API (jobs.workable.com/api/v1/jobs/<id>): company.website and company.name. */
export function workableJob(json) {
  const company = json?.company;
  if (!company || typeof company !== 'object') return { ...EMPTY };
  return result(absoluteUrl(company.website || company.url), company.name);
}

/** WTTJ organisation API: media_website_url and name, at the top or under organization. */
export function wttjOrganization(json) {
  if (!json || typeof json !== 'object') return { ...EMPTY };
  const org = json.organization && typeof json.organization === 'object' ? json.organization : json;
  const website = absoluteUrl(org.media_website_url) || absoluteUrl(typeof org.website === 'string' ? org.website : org.website?.url);
  return result(website, org.name);
}

// Does the host's own label hold the name joined ("deezer" in deezer.com)? A
// first filter among a page's links; the caller still checks name affinity.
function labelCarriesName(host, name) {
  const core = registrable(host).split('.')[0].replace(/-/g, '');
  const words = companyNameWords(name);
  const forms = [words.join('')];
  if (words.length >= 2 && /^(?:com|io|ai|co|app)$/.test(words[words.length - 1])) forms.push(words.slice(0, -1).join(''));
  return Boolean(core) && forms.some(form => form.length >= 3 && core.includes(form));
}

function metaContent(html, name) {
  for (const [tag] of String(html || '').matchAll(/<meta\b[^>]*>/gi)) {
    if (!new RegExp(`(?:property|name)\\s*=\\s*["']${name}["']`, 'i').test(tag)) continue;
    const content = tag.match(/content\s*=\s*(["'])(.*?)\1/i);
    if (content) return decodeEntities(content[2]);
  }
  return '';
}

/**
 * An ATS tenant's career site (busuu.teamtailor.com, aerolab.recruitee.com):
 * the final URL when it redirected off the vendor (bunq.recruitee.com →
 * careers.bunq.com), else the first outbound link whose domain carries the
 * company's or the site's name; og:site_name as the name.
 */
export function tenantSite(html, finalUrl = '', company = '') {
  const raw = typeof html === 'string' ? html : '';
  const ownerName = cleanOwnerName(metaContent(raw, 'og:site_name'));
  const final = absoluteUrl(finalUrl);
  if (final && ownSite(final)) return result(new URL(final).origin, ownerName);
  const names = [company, ownerName].filter(Boolean);
  if (!names.length) return result('', ownerName);
  for (const m of raw.matchAll(/<a\b[^>]*?\bhref\s*=\s*["'](https?:\/\/[^"']+)["']/gi)) {
    const url = absoluteUrl(m[1]);
    if (url && ownSite(url) && names.some(name => labelCarriesName(hostOf(url), name))) return result(new URL(url).origin, ownerName);
  }
  return result('', ownerName);
}

const READERS = { ashbyAppData, greenhouseBoard, greenhouseJobsSite, leverHeaderLogo, workableAccount, workableJob, wttjOrganization, tenantSite };

// ── What the job URL lets us ask ────────────────────────────────────────────

// {ats, slug} pairs read from the URL's host and path only (a query string
// can quote another board), plus the Greenhouse embed form ?for=<board>.
function urlSlugs(url) {
  const host = url.hostname.toLowerCase();
  const slugs = extractAtsSlugs(`${host}${url.pathname}`);
  const embedded = /(?:^|\.)greenhouse\.io$/.test(host) ? String(url.searchParams.get('for') || '').toLowerCase() : '';
  if (embedded && !slugs.some(item => item.ats === 'greenhouse' && item.slug === embedded)) slugs.push({ ats: 'greenhouse', slug: embedded });
  return slugs;
}

/**
 * The public endpoints that describe the employer behind a job URL, in the
 * order they are worth asking. Returns [{ ats, slug, kind: 'html'|'json',
 * url, read, slim? }]; read names the reader, slim: false keeps inline
 * scripts (Ashby's data blob).
 */
export function atsSiteLookups(jobUrl) {
  let url;
  try { url = new URL(String(jobUrl || '')); } catch { return []; }
  if (!/^https?:$/.test(url.protocol)) return [];
  const host = url.hostname.toLowerCase();
  const out = [];
  const push = lookup => { if (!out.some(item => item.url === lookup.url)) out.push(lookup); };
  for (const { ats, slug } of urlSlugs(url)) {
    const s = encodeURIComponent(slug);
    if (ats === 'ashby') push({ ats, slug, kind: 'html', url: `https://jobs.ashbyhq.com/${s}`, read: 'ashbyAppData', slim: false });
    else if (ats === 'greenhouse') {
      // The board first: its name is what the website is checked against.
      push({ ats, slug, kind: 'json', url: `https://boards-api.greenhouse.io/v1/boards/${s}`, read: 'greenhouseBoard' });
      push({ ats, slug, kind: 'json', url: `https://boards-api.greenhouse.io/v1/boards/${s}/jobs`, read: 'greenhouseJobsSite' });
    } else if (ats === 'lever') {
      // Lever account names keep their case (jobs.lever.co/Deliverect answers,
      // /deliverect is a 404): the job URL's own segment is asked when it is
      // this slug.
      const own = /(?:^|\.)lever\.co$/.test(host) ? url.pathname.split('/').filter(Boolean)[0] || '' : '';
      const account = own.toLowerCase() === slug ? own : slug;
      push({ ats, slug, kind: 'html', url: `https://${host === 'jobs.eu.lever.co' ? 'jobs.eu.lever.co' : 'jobs.lever.co'}/${encodeURIComponent(account)}`, read: 'leverHeaderLogo' });
    }
    else if (ats === 'workable') push({ ats, slug, kind: 'json', url: `https://apply.workable.com/api/v1/accounts/${s}`, read: 'workableAccount' });
    else if (ats === 'teamtailor' || ats === 'recruitee') push({ ats, slug, kind: 'html', url: `https://${slug}.${ats}.com/`, read: 'tenantSite' });
  }
  const workableView = host === 'jobs.workable.com' ? url.pathname.match(/^\/view\/([A-Za-z0-9]+)/) : null;
  if (workableView) push({ ats: 'workable', slug: workableView[1], kind: 'json', url: `https://jobs.workable.com/api/v1/jobs/${workableView[1]}`, read: 'workableJob' });
  const wttj = /(?:^|\.)welcometothejungle\.com$/.test(host) ? url.pathname.match(/^\/[a-z]{2}(?:-[a-z]{2})?\/companies\/([a-z0-9-]+)/i) : null;
  if (wttj) push({ ats: 'wttj', slug: wttj[1].toLowerCase(), kind: 'json', url: `https://api.welcometothejungle.com/api/v1/organizations/${encodeURIComponent(wttj[1].toLowerCase())}`, read: 'wttjOrganization' });
  return out;
}

/**
 * An ATS slug that is a domain (jobs.ashbyhq.com/kraken.com): the employer
 * named its board after its site. Returns { domain, ats } or null.
 */
export function atsSlugDomain(jobUrl) {
  let url;
  try { url = new URL(String(jobUrl || '')); } catch { return null; }
  for (const { ats, slug } of urlSlugs(url)) {
    if (!slug.includes('.') || !DOMAIN_SLUG_RE.test(slug) || isNotEmployerHost(slug)) continue;
    const domain = registrable(slug);
    if (domain) return { domain, ats };
  }
  return null;
}

/**
 * Ask the job URL's ATS or board who the employer is, through the caller's
 * fetchPage: at most maxRequests lookups within budgetMs. A website counts
 * only when accept(website, ownerName) says so (the caller checks name
 * affinity); asking stops once a website is accepted and the owner is named.
 * Returns { website, ownerName, ats, slug, requests }.
 */
export async function lookupEmployerSite(jobUrl, { fetchPage, company = '', accept = () => true, maxRequests = 2, budgetMs = 8000, log = () => {} } = {}) {
  const lookups = atsSiteLookups(jobUrl);
  const out = { website: '', ownerName: '', ats: lookups[0]?.ats || '', slug: lookups[0]?.slug || '', requests: 0 };
  if (!lookups.length || typeof fetchPage !== 'function' || maxRequests <= 0) return out;
  let stopped = false;
  const run = async () => {
    for (const lookup of lookups) {
      if (stopped || out.requests >= maxRequests || (out.website && out.ownerName)) break;
      out.requests += 1;
      let page = null;
      try {
        page = await fetchPage(lookup.url, lookup.kind === 'json' ? { as: 'json' } : { slim: lookup.slim !== false });
      } catch (err) {
        log(`ats lookup ${lookup.url} failed: ${err?.message || err}`);
        continue;
      }
      if (stopped) break;
      if (!page?.ok || Number(page.status) >= 400) { log(`ats lookup ${lookup.url} → ${page?.error || `HTTP ${page?.status}`}`); continue; }
      let found = EMPTY;
      try {
        const read = READERS[lookup.read];
        found = lookup.kind === 'json' ? read(page.json) : read(String(page.html || ''), page.url || lookup.url, company);
      } catch (err) {
        log(`ats reader ${lookup.read} failed: ${err?.message || err}`);
      }
      if (!out.ownerName && found.ownerName) out.ownerName = found.ownerName;
      let accepted = false;
      if (!out.website && found.website) {
        try { accepted = Boolean(accept(found.website, out.ownerName)); } catch { accepted = false; }
        if (accepted) Object.assign(out, { website: found.website, ats: lookup.ats, slug: lookup.slug });
        else log(`ats lookup ${lookup.url}: ${found.website} not taken (no name affinity)`);
      }
    }
  };
  let timer = null;
  const timeout = new Promise(resolve => {
    // Not unref'd: it is cleared as soon as the lookups end, and it must keep
    // the process alive while a request hangs.
    timer = setTimeout(() => { stopped = true; log(`ats lookups stopped after ${budgetMs} ms`); resolve(); }, budgetMs);
  });
  await Promise.race([run().catch(err => log(`ats lookups failed: ${err?.message || err}`)), timeout]);
  clearTimeout(timer);
  stopped = true;
  return { ...out };
}

// ── LinkedIn company page ───────────────────────────────────────────────────

/**
 * The company page a LinkedIn guest posting links from its top card
 * (a.topcard__org-name-link → linkedin.com/company/<slug>), or ''.
 */
export function linkedinCompanyPage(jobHtml) {
  for (const [tag] of String(jobHtml || '').matchAll(/<a\b[^>]*>/gi)) {
    if (!/topcard__org-name-link/.test(tag)) continue;
    const href = decodeEntities(tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1] || '');
    const m = href.match(/^(https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com)\/company\/([^/?#"'\s]+)/i);
    if (m) return `${m[1].replace(/^http:/i, 'https:')}/company/${m[2]}/`;
  }
  return '';
}

// ── Domains built from the name ─────────────────────────────────────────────

const TLDS_BY_LANGUAGE = { fr: ['fr', 'com', 'io', 'co'], de: ['de', 'com', 'io'] };
const DEFAULT_TLDS = ['com', 'io', 'ai', 'co', 'app'];
const NAME_TLD_RE = /^(?:com|io|ai|co|app|net|org|fr|de)$/;

// German spellings domains use: Müller → mueller, Straße → strasse.
function transliterate(value) {
  return String(value || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
}

/**
 * Candidate domains for a company name, at most 8: the words joined and
 * hyphenated (umlauts transliterated), then the distinctive tokens, each on
 * the posting language's TLDs (fr: .fr .com .io .co; de: .de .com .io; else
 * .com .io .ai .co .app), plus get/try + name on .com. A language of ''
 * (unknown: no posting text, nothing in the title) adds the name on .de and
 * .fr, 10 at most (Europace lives on europace.de). A name that is already a
 * domain ("Chess.com") gives that domain alone. tokensOf gives the
 * distinctive tokens (contact-finder's companyTokens); words by default.
 */
export function guessDomainsFromName(company, { language = 'en', tokensOf = null } = {}) {
  const name = transliterate(company);
  const words = companyNameWords(name);
  if (!words.length) return [];
  // "Chess.com" is its own domain: chess.io is someone else.
  if (words.length >= 2 && NAME_TLD_RE.test(words[words.length - 1])) {
    const base = words.slice(0, -1).join('');
    return base.length >= 2 ? [`${base}.${words[words.length - 1]}`] : [];
  }
  let tokens = words;
  if (typeof tokensOf === 'function') {
    try { tokens = (tokensOf(words.join(' ')) || []).map(token => String(token)); } catch { tokens = words; }
  }
  const bases = [...new Set([
    words.join(''),
    tokens.join(''),
    words.length >= 2 ? words.join('-') : '',
    tokens.length >= 2 ? tokens.join('-') : '',
  ])].filter(base => base.length >= 3 && /^[a-z0-9-]+$/.test(base));
  if (!bases.length) return [];
  const tlds = TLDS_BY_LANGUAGE[language] || DEFAULT_TLDS;
  const grid = tlds.flatMap(tld => bases.map(base => `${base}.${tld}`));
  const prefixed = ['get', 'try'].map(prefix => `${prefix}${bases[0].replace(/-/g, '')}.com`);
  const extra = language ? [] : ['de', 'fr'].map(tld => `${bases[0]}.${tld}`);
  const max = language ? 8 : 10;
  return [...new Set([...grid.slice(0, max - prefixed.length - extra.length), ...extra, ...prefixed])].slice(0, max);
}

/** A parked or for-sale domain page: it names the domain, not a company. */
export function isParkedPage(html) {
  const raw = String(html || '').slice(0, 20000);
  return /\b(?:domain(?: name)? (?:is |may be )?for sale|buy this domain|this domain (?:is|may be) for sale|domain parking|parked (?:free|domain|by)|sedoparking|hugedomains|afternic|domain is parked)\b/i.test(raw);
}

/**
 * Does a page link to the offer's own board: the ATS board or tenant
 * (jobs.ashbyhq.com/<org>, greenhouse.io/<board>, <tenant>.teamtailor.com,
 * welcometothejungle.com/…/companies/<slug>), or the job URL's host when it
 * is no board or social site? A home page that links its careers board is
 * the employer behind it, not a namesake.
 */
export function linksToBoard(html, jobUrl) {
  let url;
  try { url = new URL(String(jobUrl || '')); } catch { return false; }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  // A path on a shared ATS host, ended by /, ?, # or the end of the link
  // (greenhouse.io/prolific, not greenhouse.io/prolificacademy).
  const paths = [];
  const hosts = [];
  for (const { ats, slug } of urlSlugs(url)) {
    if (ats === 'ashby') paths.push(`ashbyhq.com/${slug}`);
    else if (ats === 'greenhouse') paths.push(`greenhouse.io/${slug}`, `greenhouse.io/embed/job_board?for=${slug}`);
    else if (ats === 'lever') paths.push(`lever.co/${slug}`);
    else if (ats === 'workable') paths.push(`workable.com/${slug}`);
    else if (ats === 'smartrecruiters') paths.push(`smartrecruiters.com/${slug}`);
    else hosts.push(host); // a tenant board: busuu.teamtailor.com
  }
  const wttj = /(?:^|\.)welcometothejungle\.com$/.test(host) ? url.pathname.match(/\/companies\/([a-z0-9-]+)/i) : null;
  if (wttj) paths.push(`/companies/${wttj[1].toLowerCase()}`);
  if (!paths.length && !hosts.length && host && !JOB_HOST_RE.test(host) && !SOCIAL_HOST_RE.test(host) && !isNotEmployerHost(host)) hosts.push(host);
  const ends = (href, needle) => {
    const at = href.indexOf(needle);
    return at >= 0 && /^(?:$|[/?#&])/.test(href.slice(at + needle.length));
  };
  for (const m of String(html || '').matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)) {
    const href = decodeEntities(m[1]).toLowerCase();
    if (paths.some(path => ends(href, path) && (!wttj || href.includes('welcometothejungle.com')))) return true;
    const linked = hostOf(href).replace(/^www\./, '');
    if (linked && hosts.includes(linked)) return true;
  }
  return false;
}
