/**
 * Monetization channels for JobYouGo. Every channel stays OFF until
 * config/monetization.yml enables it and its IDs are filled in.
 *
 *   sponsored_jobs  Careerjet / Jooble publisher feeds shown as "Sponsored"
 *                   cards. They pay per real click, so their links are
 *                   display-only: the scan, link check, JD fetch and apply
 *                   runner must never request them (automated requests count
 *                   as invalid clicks and can close the publisher account).
 *   affiliates      Disclosed affiliate links matched to the gaps a report
 *                   flags (e.g. a course next to a missing skill).
 *   sponsors        Directly sold cards, served from this config — no
 *                   third-party script, so the "your data stays on your
 *                   machine" promise holds.
 *   adsense         Google AdSense on the public landing page only: AdSense
 *                   policy forbids ads integrated into software, and Chrome
 *                   Web Store policy forbids AdSense in extensions.
 */
import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import { load as yamlLoad } from 'js-yaml';
import { asciiFold } from './ascii-fold.mjs';

export const MONETIZATION_CONFIG_PATH = join('config', 'monetization.yml');
export const EVENT_TYPES = ['impression', 'click'];
export const EVENT_CHANNELS = ['sponsor', 'sponsored_job', 'affiliate'];
export const SPONSORED_JOB_PROVIDERS = ['careerjet', 'jooble'];

const PROVIDER_ENV = {
  careerjet: 'CAREERJET_API_KEY',
  jooble: 'JOOBLE_API_KEY',
};
const ADSENSE_CLIENT_RE = /^ca-pub-\d{16}$/;
const ADSENSE_SLOT_RE = /^\d{6,20}$/;
const EVENT_ID_RE = /^[a-z0-9][a-z0-9:._-]{0,119}$/i;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
// Sponsor logos must be same-origin files (ui/assets or images/): a remote
// logo would hand every viewer's IP to the sponsor's server.
const LOCAL_LOGO_RE = /^\/(assets|images)\/[\w./-]+\.(png|jpe?g|webp|svg)$/i;

const DEFAULT_DISCLOSURE = 'Affiliate links: JobYouGo may earn a commission, at no extra cost to you.';

function text(value, max = 400) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function list(value) {
  if (Array.isArray(value)) return value.map(item => text(item, 120)).filter(Boolean);
  const single = text(value, 120);
  return single ? [single] : [];
}

function bool(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function int(value, fallback, { min, max }) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function httpUrl(value) {
  const raw = text(value, 2000);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function slug(value) {
  const id = asciiFold(value, { punctuation: 'space' }).replace(/\s+/g, '-');
  return EVENT_ID_RE.test(id) ? id : '';
}

function day(value) {
  const raw = text(value, 10);
  return DAY_RE.test(raw) ? raw : '';
}

/**
 * Normalize the raw YAML into the shape the server uses. Unknown keys are
 * ignored and every invalid entry is dropped, so a typo can switch a channel
 * off but never ship a broken card or an unsafe link.
 *
 * @param {object} raw - Parsed config/monetization.yml (or {}).
 * @returns {{config: object, warnings: string[]}}
 */
export function normalizeMonetizationConfig(raw = {}) {
  const warnings = [];
  const src = raw && typeof raw === 'object' ? raw : {};

  const sj = src.sponsored_jobs || {};
  const providers = list(sj.providers).map(p => p.toLowerCase());
  const unknownProviders = providers.filter(p => !SPONSORED_JOB_PROVIDERS.includes(p));
  if (unknownProviders.length) warnings.push(`sponsored_jobs: unknown provider(s) ${unknownProviders.join(', ')}`);
  const sponsoredJobs = {
    enabled: bool(sj.enabled),
    providers: (providers.length ? providers : SPONSORED_JOB_PROVIDERS).filter(p => SPONSORED_JOB_PROVIDERS.includes(p)),
    keywords: list(sj.keywords),
    location: text(sj.location, 120),
    remoteOnly: bool(sj.remote_only, true),
    careerjetLocale: /^[a-z]{2}_[A-Z]{2}$/.test(text(sj.careerjet_locale)) ? text(sj.careerjet_locale) : 'en_GB',
    limit: int(sj.limit, 4, { min: 1, max: 10 }),
    cacheMinutes: int(sj.cache_minutes, 60, { min: 5, max: 1440 }),
    // Absent key → default service; present but empty → lookup disabled.
    publicIpLookupUrl: 'public_ip_lookup_url' in sj ? httpUrl(sj.public_ip_lookup_url) : 'https://api.ipify.org?format=json',
  };

  const af = src.affiliates || {};
  const offers = [];
  for (const entry of Array.isArray(af.offers) ? af.offers : []) {
    const id = slug(entry?.id || entry?.label);
    const label = text(entry?.label, 80);
    const url = httpUrl(entry?.url);
    const keywords = list(entry?.keywords).map(k => k.toLowerCase());
    if (!id || !label) { warnings.push('affiliates: an offer is missing id or label'); continue; }
    if (!url) continue; // placeholder waiting for the real affiliate link
    if (!keywords.length) { warnings.push(`affiliates: offer "${id}" has no keywords`); continue; }
    offers.push({
      id,
      label,
      description: text(entry?.description, 160),
      url,
      keywords,
      matchOn: entry?.match_on === 'report' ? 'report' : 'gaps',
    });
  }
  const affiliates = {
    enabled: bool(af.enabled),
    maxPerReport: int(af.max_per_report, 2, { min: 1, max: 5 }),
    disclosure: text(af.disclosure, 200) || DEFAULT_DISCLOSURE,
    offers,
  };

  const sp = src.sponsors || {};
  const items = [];
  for (const entry of Array.isArray(sp.items) ? sp.items : []) {
    const id = slug(entry?.id || entry?.title);
    const title = text(entry?.title, 80);
    const url = httpUrl(entry?.url);
    if (!id || !title) { warnings.push('sponsors: an item is missing id or title'); continue; }
    if (!url) continue;
    const logo = text(entry?.logo, 200);
    if (logo && !LOCAL_LOGO_RE.test(logo)) warnings.push(`sponsors: "${id}" logo must be a local /assets/ or /images/ file — ignored`);
    items.push({
      id,
      title,
      text: text(entry?.text, 200),
      cta: text(entry?.cta, 40) || 'Learn more',
      url,
      logo: LOCAL_LOGO_RE.test(logo) ? logo : '',
      start: day(entry?.start),
      end: day(entry?.end),
    });
  }
  const sponsors = { enabled: bool(sp.enabled), items };

  const ad = src.adsense || {};
  const client = text(ad.client, 40);
  const landingSlot = text(ad.landing_slot, 20);
  if (client && !ADSENSE_CLIENT_RE.test(client)) warnings.push('adsense: client must look like ca-pub-0000000000000000');
  if (landingSlot && !ADSENSE_SLOT_RE.test(landingSlot)) warnings.push('adsense: landing_slot must be the numeric ad-unit ID');
  const adsense = {
    enabled: bool(ad.enabled) && ADSENSE_CLIENT_RE.test(client),
    client: ADSENSE_CLIENT_RE.test(client) ? client : '',
    landingSlot: ADSENSE_SLOT_RE.test(landingSlot) ? landingSlot : '',
  };

  return { config: { sponsoredJobs, affiliates, sponsors, adsense }, warnings };
}

/**
 * Read config/monetization.yml (or MONETIZATION_CONFIG when set). A missing
 * file means every channel is off.
 *
 * @param {string} root - Repo root.
 * @param {{path?: string}} [options] - Explicit file, absolute or root-relative.
 * @returns {Promise<{config: object, warnings: string[]}>}
 */
export async function loadMonetizationConfig(root, { path = process.env.MONETIZATION_CONFIG || MONETIZATION_CONFIG_PATH } = {}) {
  let raw = {};
  try {
    raw = yamlLoad(await readFile(resolve(root, path), 'utf-8')) || {};
  } catch (err) {
    if (err.code !== 'ENOENT') return { ...normalizeMonetizationConfig({}), warnings: [`monetization.yml unreadable: ${err.message}`] };
  }
  return normalizeMonetizationConfig(raw);
}

/** Providers that are both listed in the config and have their key in .env. */
export function configuredProviders(sponsoredJobs, env = process.env) {
  return (sponsoredJobs?.providers || []).filter(p => Boolean(env[PROVIDER_ENV[p]]));
}

/** Sponsor cards whose optional start/end window contains `now`. */
export function activeSponsors(items = [], now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  return items.filter(item => (!item.start || item.start <= today) && (!item.end || today <= item.end));
}

/**
 * Tag a sponsor link so the sponsor sees JobYouGo traffic in their own
 * analytics — that is the click proof a directly sold placement is billed on.
 */
export function withUtm(url, { medium, campaign }) {
  try {
    const out = new URL(url);
    if (!out.searchParams.has('utm_source')) out.searchParams.set('utm_source', 'jobyougo');
    if (!out.searchParams.has('utm_medium')) out.searchParams.set('utm_medium', medium);
    if (campaign && !out.searchParams.has('utm_campaign')) out.searchParams.set('utm_campaign', campaign);
    return out.toString();
  } catch {
    return url;
  }
}

/**
 * What the dashboard needs to know. Never includes API keys; affiliate offers
 * are matched server-side, so only the channel switch goes to the client.
 */
export function publicMonetizationConfig(config, { env = process.env, now = new Date() } = {}) {
  const { sponsoredJobs, affiliates, sponsors } = config;
  return {
    sponsoredJobs: {
      enabled: sponsoredJobs.enabled && configuredProviders(sponsoredJobs, env).length > 0,
    },
    affiliates: {
      enabled: affiliates.enabled && affiliates.offers.length > 0,
      disclosure: affiliates.disclosure,
    },
    sponsors: {
      enabled: sponsors.enabled,
      items: sponsors.enabled
        ? activeSponsors(sponsors.items, now).map(item => ({ ...item, url: withUtm(item.url, { medium: 'sponsor', campaign: item.id }) }))
        : [],
    },
  };
}

// ─── Affiliate matching ──────────────────────────────────────────────────────

// Report lines that describe a gap between the offer and the CV. Reports are
// written in French or English, so both vocabularies are listed (folded).
const GAP_MARKERS = [
  'gap', 'gaps', 'soft gaps', 'hard stops', 'missing', 'lack', 'lacks', 'lacking',
  'not mentioned', 'no mention', 'absence', 'absent', 'manque', 'manquant', 'manquante',
  'lacune', 'lacunes', 'ecart', 'ne mentionne pas', 'ne mentionne', 'pas de mention',
  'aucune mention', 'non mentionne', 'sans mention', 'a renforcer', 'insuffisant', 'insuffisante',
];

function containsTerm(haystack, term) {
  // Both sides are asciiFold-ed: words separated by single spaces. A trailing
  // "*" in a keyword means prefix match ("prototyp*" → prototypage, prototyping).
  if (term.endsWith('*')) {
    const stem = asciiFold(term.slice(0, -1));
    return Boolean(stem) && ` ${haystack}`.includes(` ${stem}`);
  }
  const word = asciiFold(term);
  return Boolean(word) && ` ${haystack} `.includes(` ${word} `);
}

/** The lines of a report that flag a gap, folded for matching. */
export function extractGapText(markdown = '') {
  return String(markdown)
    .split(/\r?\n/)
    .map(line => asciiFold(line))
    .filter(line => line && GAP_MARKERS.some(marker => containsTerm(line, marker)))
    .join(' \n ');
}

/**
 * Pick the affiliate offers a report calls for. An offer matches when one of
 * its keywords appears in the report's gap lines (or anywhere in the report
 * for `match_on: report`). More keyword hits rank first; ties keep config order.
 *
 * @returns {Array<object>} offers with a `matched` list of the keywords found.
 */
export function matchAffiliateOffers(offers = [], markdown = '', { max = 2 } = {}) {
  const full = asciiFold(markdown);
  const gaps = extractGapText(markdown);
  return offers
    .map((offer, index) => {
      const haystack = offer.matchOn === 'report' ? full : gaps;
      const matched = offer.keywords.filter(keyword => containsTerm(haystack, keyword));
      return { offer, index, matched };
    })
    .filter(row => row.matched.length > 0)
    .sort((a, b) => b.matched.length - a.matched.length || a.index - b.index)
    .slice(0, max)
    .map(({ offer, matched }) => ({ ...offer, matched: matched.map(k => k.replace(/\*$/, '')) }));
}

// ─── Sponsored jobs (Careerjet / Jooble publisher programs) ─────────────────

/** True for a routable address — Careerjet refuses loopback/private IPs. */
export function isPublicIp(ip = '') {
  let value = String(ip).trim().toLowerCase();
  if (value.startsWith('::ffff:')) value = value.slice(7);
  const v4 = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = v4.slice(1, 3).map(Number);
    if (v4.slice(1).some(part => Number(part) > 255)) return false;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
    return true;
  }
  if (!value.includes(':')) return false;
  if (value === '::' || value === '::1') return false;
  if (/^f[cd]/.test(value) || /^fe[89ab]/.test(value)) return false; // unique-local, link-local
  return true;
}

/** The viewer's IP: the proxy header when hosted (Vercel), else the socket. */
export function clientIpFromRequest(req) {
  const forwarded = String(req?.headers?.['x-forwarded-for'] || '')
    .split(',')
    .map(part => part.trim())
    .find(isPublicIp);
  return forwarded || String(req?.socket?.remoteAddress || '');
}

let publicIpCache = { ip: '', at: 0 };

/**
 * Careerjet wants the IP of the person who will see the jobs. When the app
 * runs locally the request comes from 127.0.0.1, so ask a what-is-my-IP
 * service once an hour. The lookup URL is configurable; an empty value
 * disables it (Careerjet is then skipped locally, Jooble still works).
 */
export async function resolveViewerIp(req, { lookupUrl = '', fetchImpl = fetch, now = Date.now() } = {}) {
  const direct = clientIpFromRequest(req);
  if (isPublicIp(direct)) return direct;
  if (!lookupUrl) return '';
  if (publicIpCache.ip && now - publicIpCache.at < 3_600_000) return publicIpCache.ip;
  try {
    const res = await fetchImpl(lookupUrl, { signal: AbortSignal.timeout(5000) });
    const body = await res.text();
    let ip = body.trim();
    try { ip = String(JSON.parse(body).ip || '').trim(); } catch {}
    if (isPublicIp(ip)) {
      publicIpCache = { ip, at: now };
      return ip;
    }
  } catch {}
  return '';
}

function normalizeJob(provider, job) {
  const title = text(job.title, 140);
  const url = httpUrl(job.url);
  if (!title || !url) return null;
  return {
    provider,
    title,
    company: text(job.company, 80),
    location: text(job.location, 80),
    salary: text(job.salary, 60),
    postedAt: text(job.postedAt, 40),
    url,
  };
}

async function fetchCareerjetJobs({ apiKey, keywords, location, locale, userIp, userAgent, limit, fetchImpl }) {
  if (!isPublicIp(userIp)) throw new Error('Careerjet needs the viewer\'s public IP');
  // v4 API: Basic auth with the publisher API key; user_ip and user_agent are
  // required and must be the real viewer's (https://www.careerjet.com/partners/api).
  const params = new URLSearchParams({
    locale_code: locale,
    keywords,
    user_ip: userIp,
    user_agent: userAgent || 'Mozilla/5.0',
    page_size: String(limit),
    sort: 'date',
  });
  if (location) params.set('location', location);
  const res = await fetchImpl(`https://search.api.careerjet.net/v4/query?${params}`, {
    headers: { Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`Careerjet HTTP ${res.status}`);
  const data = await res.json();
  return (data.jobs || []).map(job => normalizeJob('careerjet', {
    title: job.title,
    company: job.company,
    location: job.locations,
    salary: job.salary,
    postedAt: job.date,
    url: job.url,
  })).filter(Boolean);
}

async function fetchJoobleJobs({ apiKey, keywords, location, limit, fetchImpl }) {
  const res = await fetchImpl(`https://jooble.org/api/${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keywords, location, page: '1', ResultOnPage: limit }),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`Jooble HTTP ${res.status}`);
  const data = await res.json();
  return (data.jobs || []).map(job => normalizeJob('jooble', {
    title: job.title,
    company: job.company,
    location: job.location,
    salary: job.salary,
    postedAt: job.updated,
    url: job.link,
  })).filter(Boolean);
}

/**
 * Keywords for the sponsored query: the config wins, else the profile's first
 * target role. One query per provider keeps the publisher APIs cheap.
 */
export function sponsoredQuery(sponsoredJobs, profile = {}) {
  // Local profile.yml nests roles under target_roles.primary; a Supabase row
  // may store the list directly.
  const targetRoles = profile?.target_roles;
  const roles = list(Array.isArray(targetRoles) ? targetRoles : targetRoles?.primary);
  const keyword = sponsoredJobs.keywords[0] || roles[0] || '';
  const remote = sponsoredJobs.remoteOnly;
  return {
    keyword,
    careerjet: { keywords: remote && !/remote/i.test(keyword) ? `${keyword} remote` : keyword, location: sponsoredJobs.location },
    jooble: { keywords: keyword, location: sponsoredJobs.location || (remote ? 'Remote' : '') },
  };
}

const sponsoredCache = new Map();

/**
 * Fetch sponsored jobs from every configured provider, interleaved so no
 * single network fills the block. Results are cached per viewer IP and query.
 *
 * @returns {Promise<{items: object[], errors: string[]}>}
 */
export async function fetchSponsoredJobs({
  sponsoredJobs,
  profile = {},
  userIp = '',
  userAgent = '',
  env = process.env,
  fetchImpl = fetch,
  now = Date.now(),
} = {}) {
  const providers = configuredProviders(sponsoredJobs, env);
  const query = sponsoredQuery(sponsoredJobs, profile);
  if (!providers.length || !query.keyword) return { items: [], errors: [] };

  const cacheKey = [providers.join(','), query.keyword, sponsoredJobs.location, userIp].join('|');
  const cached = sponsoredCache.get(cacheKey);
  if (cached && now - cached.at < sponsoredJobs.cacheMinutes * 60_000) return cached.value;

  const limit = sponsoredJobs.limit;
  const settled = await Promise.allSettled(providers.map(provider => provider === 'careerjet'
    ? fetchCareerjetJobs({ apiKey: env.CAREERJET_API_KEY, ...query.careerjet, locale: sponsoredJobs.careerjetLocale, userIp, userAgent, limit, fetchImpl })
    : fetchJoobleJobs({ apiKey: env.JOOBLE_API_KEY, ...query.jooble, limit, fetchImpl })));

  const lists = settled.map(result => (result.status === 'fulfilled' ? result.value : []));
  const errors = settled
    .map((result, i) => (result.status === 'rejected' ? `${providers[i]}: ${result.reason?.message || result.reason}` : ''))
    .filter(Boolean);
  const seen = new Set();
  const items = [];
  for (let i = 0; items.length < limit && lists.some(l => i < l.length); i += 1) {
    for (const l of lists) {
      const job = l[i];
      if (!job || items.length >= limit) continue;
      const key = asciiFold(`${job.title} ${job.company}`);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(job);
    }
  }
  const value = { items, errors };
  // Do not cache a total failure: the next page load retries.
  if (items.length || !errors.length) sponsoredCache.set(cacheKey, { at: now, value });
  return value;
}

/** Test hook: forget cached sponsored results and the public IP. */
export function resetMonetizationCaches() {
  sponsoredCache.clear();
  publicIpCache = { ip: '', at: 0 };
}

// ─── AdSense (public landing page only) ─────────────────────────────────────

/** Loader tag for <head>. With a client and no slot, AdSense runs Auto ads. */
export function adsenseHeadHtml(adsense) {
  if (!adsense?.enabled || !adsense.client) return '';
  return `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsense.client}" crossorigin="anonymous"></script>`;
}

/** A labelled, responsive ad unit for the landing page (needs landing_slot). */
export function adsenseSlotHtml(adsense) {
  if (!adsense?.enabled || !adsense.client || !adsense.landingSlot) return '';
  return `<section class="ad-slot" aria-label="Advertisement">
  <div class="ad-slot-label">Advertisement</div>
  <ins class="adsbygoogle" style="display:block" data-ad-client="${adsense.client}" data-ad-slot="${adsense.landingSlot}" data-ad-format="auto" data-full-width-responsive="true"></ins>
  <script>(adsbygoogle = window.adsbygoogle || []).push({});</script>
</section>`;
}

/** ads.txt line that authorizes Google to sell this site's inventory. */
export function adsTxt(adsense) {
  if (!adsense?.enabled || !adsense.client) return '';
  return `google.com, ${adsense.client.replace(/^ca-/, '')}, DIRECT, f08c47fec0942fa0\n`;
}

// ─── Impression / click counter ──────────────────────────────────────────────

let writeQueue = Promise.resolve();

/**
 * Every `channel:id` the current config can display. Events for anything else
 * are refused, so the counts cannot be inflated with made-up IDs.
 */
export function monetizationEventKeys(config) {
  return new Set([
    ...config.sponsors.items.map(item => `sponsor:${item.id}`),
    ...config.affiliates.offers.map(offer => `affiliate:${offer.id}`),
    ...config.sponsoredJobs.providers.map(provider => `sponsored_job:${provider}`),
  ]);
}

/**
 * Add one impression or click to data/monetization-stats.json, aggregated per
 * day and per `channel:id`. Nothing about the viewer is stored. Writes are
 * serialized so concurrent events cannot drop each other.
 *
 * @param {{now?: Date, allowedKeys?: Set<string>}} [options] - allowedKeys
 *   (from monetizationEventKeys) restricts which placements can be counted.
 */
export function recordMonetizationEvent(filePath, event = {}, { now = new Date(), allowedKeys } = {}) {
  const type = String(event.type || '');
  const channel = String(event.channel || '');
  const id = String(event.id || '');
  if (!EVENT_TYPES.includes(type) || !EVENT_CHANNELS.includes(channel) || !EVENT_ID_RE.test(id)
      || (allowedKeys && !allowedKeys.has(`${channel}:${id}`))) {
    return Promise.reject(new Error('invalid monetization event'));
  }
  const run = writeQueue.then(async () => {
    let stats = { days: {} };
    try {
      stats = JSON.parse(await readFile(filePath, 'utf-8'));
      if (!stats || typeof stats.days !== 'object') stats = { days: {} };
    } catch {}
    const key = now.toISOString().slice(0, 10);
    const bucket = (stats.days[key] ||= {});
    const counts = (bucket[`${channel}:${id}`] ||= { impressions: 0, clicks: 0 });
    counts[type === 'click' ? 'clicks' : 'impressions'] += 1;
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(stats, null, 2)}\n`, 'utf-8');
    return counts;
  });
  writeQueue = run.catch(() => {});
  return run;
}
