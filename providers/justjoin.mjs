// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// JustJoin.it provider — hits the current candidate offers API.
// Browser URLs under https://justjoin.it/job-offers/... are accepted for
// detection, but fetches use https://justjoin.it/api/candidate-api/offers.

const ALLOWED_HOSTS = new Set(['justjoin.it']);
const API_BASE = 'https://justjoin.it/api/candidate-api/offers';
const JOB_BASE = 'https://justjoin.it/job-offer/';
const PAGE_SIZE = 100;
const MAX_PAGES = 50;

function assertJustJoinUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`justjoin: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`justjoin: URL must use HTTPS: ${url}`);
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new Error(`justjoin: untrusted hostname "${parsed.hostname}" — must be justjoin.it`);
  }
  if (!parsed.pathname.startsWith('/job-offers') && parsed.pathname !== '/api/candidate-api/offers') {
    throw new Error(`justjoin: URL path must be /job-offers or /api/candidate-api/offers: ${url}`);
  }
  return parsed;
}

function detectUrl(entry) {
  const url = entry.api || entry.careers_url || '';
  if (typeof url !== 'string' || !url.trim()) return null;
  try {
    const parsed = assertJustJoinUrl(url);
    return { url: parsed.href };
  } catch {
    return null;
  }
}

function normalizeLocation(offer) {
  const parts = [];
  const workplace = String(offer?.workplaceType || '').trim();
  if (workplace) parts.push(workplace);
  if (Array.isArray(offer?.locations)) {
    for (const location of offer.locations) {
      const city = String(location?.city || '').trim();
      if (city) parts.push(city);
    }
  }
  const city = String(offer?.city || '').trim();
  if (city) parts.push(city);
  return [...new Set(parts.filter(Boolean))].join(', ');
}

function postedAtMillis(value) {
  const time = Date.parse(String(value || ''));
  return Number.isFinite(time) ? time : undefined;
}

function buildApiUrl(entry, from) {
  const apiUrl = entry.api || API_BASE;
  const parsed = assertJustJoinUrl(apiUrl);
  if (parsed.pathname !== '/api/candidate-api/offers') {
    parsed.pathname = '/api/candidate-api/offers';
    parsed.search = '';
  }
  parsed.searchParams.set('from', String(from));
  parsed.searchParams.set('itemsCount', String(Number(entry.page_size || PAGE_SIZE)));
  parsed.searchParams.set('cityRadius', String(Number(entry.city_radius || 30)));
  parsed.searchParams.set('currency', String(entry.currency || 'pln').toLowerCase());
  parsed.searchParams.set('orderBy', 'descending');
  parsed.searchParams.set('sortBy', 'publishedAt');
  parsed.searchParams.set('keywordType', 'any');
  parsed.searchParams.set('isPromoted', 'true');
  return parsed.href;
}

const OFFER_SLUG = /^[a-z0-9][a-z0-9-]{2,250}$/i;

/** Slug of a justjoin.it offer page (https://justjoin.it/job-offer/<slug>), or ''. */
export function justJoinOfferSlug(url) {
  let parsed;
  try { parsed = new URL(String(url || '')); } catch { return ''; }
  if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname)) return '';
  const match = parsed.pathname.match(/^\/job-offer\/([^/]+)\/?$/);
  return match && OFFER_SLUG.test(match[1]) ? match[1] : '';
}

/** The candidate API's one-offer endpoint: title, company and the HTML body. */
export function justJoinOfferApiUrl(slug) {
  return OFFER_SLUG.test(String(slug || '')) ? `${API_BASE}/${slug}` : '';
}

const squash = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const escapeHtml = (value) => squash(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function salaryLines(types = []) {
  const list = Array.isArray(types) ? types.filter(t => t && typeof t === 'object') : [];
  // Each contract type comes once in the posting's currency, then converted.
  const original = list.filter(t => t.currencySource === 'original');
  return (original.length ? original : list.slice(0, 1)).map(t => {
    const range = t.from != null && t.to != null ? `${t.from}–${t.to}` : (t.from ?? t.to ?? 'undisclosed');
    const unit = t.unit ? ` / ${String(t.unit).toLowerCase()}` : '';
    return `${squash(t.type || 'contract')}: ${range} ${squash(t.currency || '').toUpperCase()}${unit}`.trim();
  });
}

/**
 * One offer from GET /api/candidate-api/offers/<slug>, as job fields. The page's
 * JSON-LD flattens the body into one run-on line ("…praktykami UXanaliza
 * wymagań…"); the API body keeps the lists, plus the salary and skills.
 * @returns {null | { title: string, companyName: string, location: string, description: string, workplaceType: string, workMode: string, employmentType: string, publishedAt: string, url: string, language: string }}
 */
export function formatJustJoinOffer(json) {
  const offer = json && typeof json === 'object' ? (json.data && typeof json.data === 'object' && !Array.isArray(json.data) ? json.data : json) : null;
  if (!offer || !squash(offer.title) || !String(offer.body || '').trim()) return null;
  const cities = [...new Set([
    squash(offer.city),
    ...(Array.isArray(offer.locations) ? offer.locations.map(l => squash(l?.city)) : []),
  ].filter(Boolean))];
  const workplace = squash(offer.workplaceType).toLowerCase();
  const workMode = workplace === 'remote' ? 'remote' : workplace === 'hybrid' ? 'hybrid' : (workplace === 'office' || workplace === 'onsite') ? 'onsite' : '';
  const skills = (list) => (Array.isArray(list) ? list : [])
    .map(s => squash(s?.name) ? `${squash(s.name)}${s.level ? ` (${s.level}/5)` : ''}` : '')
    .filter(Boolean);
  const required = skills(offer.requiredSkills);
  const nice = skills(offer.niceToHaveSkills);
  const languages = (Array.isArray(offer.languages) ? offer.languages : [])
    .map(l => squash(typeof l === 'string' ? l : [l?.code || l?.name, l?.level].filter(Boolean).join(' ')))
    .filter(Boolean);
  const facts = [
    offer.experienceLevel ? `Experience level: ${escapeHtml(offer.experienceLevel)}` : '',
    ...salaryLines(offer.employmentTypes).map(line => `Salary (${escapeHtml(line)})`),
    required.length ? `Required skills: ${escapeHtml(required.join(', '))}` : '',
    nice.length ? `Nice to have: ${escapeHtml(nice.join(', '))}` : '',
    languages.length ? `Languages: ${escapeHtml(languages.join(', '))}` : '',
    offer.workingTime ? `Working time: ${escapeHtml(offer.workingTime)}` : '',
  ].filter(Boolean);
  return {
    title: squash(offer.title),
    companyName: squash(offer.companyName),
    // "remote, Warszawa, Łódź, …" read as five on-site cities: a remote offer
    // names its country, and the cities as the ones listed.
    location: workplace === 'remote'
      ? `Remote${offer.countryCode ? ` (${squash(offer.countryCode)})` : ''}${cities.length ? `; cities listed: ${cities.join(', ')}` : ''}`
      : [workplace ? workplace[0].toUpperCase() + workplace.slice(1) : '', ...cities, squash(offer.countryCode)].filter(Boolean).join(', '),
    // <li><p>…</p></li> came out as a lone "-" line above each item.
    description: `${String(offer.body).replace(/<li>\s*<p>/gi, '<li>').replace(/<\/p>\s*<\/li>/gi, '</li>')}${facts.length ? `<ul>${facts.map(f => `<li>${f}</li>`).join('')}</ul>` : ''}`,
    workplaceType: workplace ? workplace[0].toUpperCase() + workplace.slice(1) : '',
    workMode,
    employmentType: squash(offer.workingTime),
    publishedAt: squash(offer.publishedAt),
    url: squash(offer.url) || (offer.slug ? `${JOB_BASE}${offer.slug}` : ''),
  };
}

export function parseJustJoinResponse(json) {
  if (!json || !Array.isArray(json.data)) {
    throw new Error(`justjoin: unexpected API response — expected { data: [...] }, got keys: [${json ? Object.keys(json).join(', ') : 'null'}]`);
  }
  return json.data
    .filter(offer => offer && typeof offer === 'object')
    .map(offer => {
      const slug = String(offer.slug || '').trim();
      // Titles arrive with runs of spaces where characters were stripped
      // ("Senior Product  UX/UI Designer   with Fluent Japanese").
      const title = squash(offer.title);
      if (!slug || !title) return null;
      return {
        title,
        url: `${JOB_BASE}${slug}`,
        company: squash(offer.companyName),
        location: squash(normalizeLocation(offer)),
        postedAt: postedAtMillis(offer.publishedAt),
      };
    })
    .filter(Boolean);
}

/** @type {Provider} */
export default {
  id: 'justjoin',

  detect(entry) {
    return detectUrl(entry);
  },

  async fetch(entry, ctx) {
    if (!detectUrl(entry)) throw new Error('justjoin: careers_url or api must be a trusted justjoin.it URL');

    const jobs = [];
    let from = 0;
    const maxPages = Number(entry.max_pages || MAX_PAGES);
    for (let page = 0; page < maxPages; page++) {
      const url = buildApiUrl(entry, from);
      const json = await ctx.fetchJson(url, { redirect: 'error' });
      const parsed = parseJustJoinResponse(json);
      jobs.push(...parsed);

      const next = json?.meta?.next?.cursor;
      if (next == null || parsed.length === 0) break;
      from = Number(next);
      if (!Number.isFinite(from)) break;
    }
    return jobs;
  },
};
