/**
 * Authoritative geo resolution for a candidate offer.
 *
 * WHY: aggregator location metadata is not trustworthy. Verified in the wild —
 * realworkfromanywhere.com advertised Kindred's "Head of Product Design" as
 * "Anywhere in the World", while the source Ashby posting says "Remote - US".
 * Because the scan's remote/geo filter reads the AGGREGATOR's location string,
 * no amount of tuning that filter can catch this class: the input itself is
 * wrong. Four of five offers hand-checked in one session were US-only despite
 * being listed as worldwide remote.
 *
 * So: for each offer that survives the cheap filters, follow it to the real
 * posting and read the location the employer actually published.
 *
 * Order of trust:
 *   1. ATS JSON APIs (Ashby / Greenhouse / Lever) — structured and exact.
 *   2. schema.org JobPosting JSON-LD — emitted by most job pages, and the only
 *      place `applicantLocationRequirements` ("who may apply") is expressed.
 *   3. An ATS link discovered on an aggregator page → retry step 1 against it.
 * Returns null when nothing authoritative is found, so the caller can decide
 * whether to keep the offer rather than silently dropping it.
 */

/**
 * Verdict for an AUTHORITATIVE geo string (the employer's own Location field).
 *
 * Deliberately not reusing passesRemote() here: that function tests exclusions
 * BEFORE inclusions, which is right for a noisy aggregator blob but wrong for a
 * precise multi-region location. Chainguard publishes "Europe, UK, USA" — a
 * US token is present, yet the role is open to Europe and must be kept. So the
 * rule here is inverted on purpose: an allowed region WINS over a US/Canada
 * marker; exclusion applies only when no allowed region is named at all.
 *
 * Returns 'eligible' | 'excluded' | 'unknown'. 'unknown' means keep — an
 * unverifiable offer is not the same thing as an ineligible one.
 */
// Includes US metro names: an ATS Location field often names only the city
// ("Hybrid, San Francisco"), never the country, so a country-only list reads
// those as "no geo mentioned" and lets an on-site US role through.
const EXCLUDED_GEO_RE = /(?<![a-z0-9])(united states|usa|u\.s\.a?|us|canada|canadian|latam|latin america|mexico|brazil|argentina|san francisco|new york|nyc|bay area|los angeles|seattle|chicago|boston|austin|denver|atlanta|palo alto|mountain view|san jose|washington,? d\.?c)(?![a-z0-9])/i;

function wordListRe(terms) {
  const esc = (terms || []).map(t => String(t).trim().toLowerCase()).filter(Boolean)
    .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return esc.length ? new RegExp(`(?<![a-z0-9])(?:${esc.join('|')})(?![a-z0-9])`, 'i') : null;
}

export function classifyGeo(geo, remoteFilter = {}) {
  const t = ` ${String(geo || '').toLowerCase()} `;
  if (!t.trim()) return 'unknown';
  const allowedRe = wordListRe(remoteFilter.allowed_geo_any);
  if (allowedRe && allowedRe.test(t)) return 'eligible';
  if (EXCLUDED_GEO_RE.test(t)) return 'excluded';
  return 'unknown';
}

/**
 * Places that sit inside "Europe" geographically but are NOT an EU labour
 * market for a French passport: post-Brexit the UK requires a Skilled Worker
 * visa, and Switzerland was never in the EU. Both routinely publish roles as
 * plain "Europe"/"Remote - UK", so the geo filter alone reads them as eligible.
 * Caught in the wild on NEC Software Solutions' Lead UX Designer, whose posting
 * ends with "Candidates must be able to demonstrate a pre-existing right to
 * work and travel within the UK. Documentary evidence will be required."
 * These offers are kept (some employers do sponsor) but flagged, never silently
 * presented as directly actionable.
 */
const PERMIT_REQUIRED_RE = /(?<![a-z0-9])(united kingdom|uk|u\.k\.|england|scotland|wales|northern ireland|london|manchester|edinburgh|bristol|switzerland|swiss|zurich|zürich|geneva|genève|basel|lausanne)(?![a-z0-9])/i;

// A permit-free option anywhere in the location string cancels the flag: a role
// posted "Europe, Remote, London" or "Germany, Remote, Bosnia, Norway" is
// reachable on an EU passport, and flagging it would push genuinely actionable
// offers behind a warning they don't deserve. Same inclusion-wins-over-exclusion
// rule as classifyGeo — flag only when UK/Switzerland is the ONLY way in.
const PERMIT_FREE_RE = /(?<![a-z0-9])(europe|european|eu|eea|emea|worldwide|global|anywhere|remote emea|france|paris|germany|berlin|munich|münchen|spain|madrid|barcelona|italy|milan|netherlands|amsterdam|portugal|lisbon|poland|warsaw|sweden|stockholm|denmark|copenhagen|norway|oslo|finland|helsinki|belgium|brussels|austria|vienna|ireland|dublin|greece|czechia|prague|romania|bulgaria|croatia|estonia|latvia|lithuania|slovakia|slovenia|hungary|luxembourg|malta|cyprus|bosnia|serbia|ukraine|asia|apac|asean|singapore|thailand|bangkok|japan|india|indonesia|vietnam|philippines|malaysia|africa|nigeria|kenya|egypt|morocco|south africa|middle east|mena|dubai|uae|israel|turkey)(?![a-z0-9])/i;

export function needsWorkPermit(geo) {
  const s = String(geo || '');
  if (!PERMIT_REQUIRED_RE.test(s)) return false;
  return !PERMIT_FREE_RE.test(s);
}

const TIMEOUT_MS = 12000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function get(url, { json = false } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: json ? 'application/json' : 'text/html,*/*' } });
    if (!res.ok) return null;
    return json ? await res.json() : await res.text();
  } catch { return null; }
  finally { clearTimeout(timer); }
}

function flattenLocationish(value, depth = 0) {
  if (value == null || depth > 4) return [];
  if (typeof value === 'string' || typeof value === 'number') return [String(value)];
  if (Array.isArray(value)) return value.flatMap(v => flattenLocationish(v, depth + 1));
  if (typeof value === 'object') {
    // Pull the human-readable bits of schema.org Place/PostalAddress/Country.
    const keys = ['name', 'addressLocality', 'addressRegion', 'addressCountry', 'address', 'jobLocation', 'applicantLocationRequirements'];
    return keys.flatMap(k => (k in value ? flattenLocationish(value[k], depth + 1) : []));
  }
  return [];
}

/** schema.org JobPosting → the strings that describe where one may work/apply. */
function geoFromJsonLd(html) {
  if (!html) return null;
  const parts = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    let data;
    try { data = JSON.parse(m[1].trim()); } catch { continue; }
    for (const node of (Array.isArray(data) ? data : [data, ...(data['@graph'] || [])])) {
      if (!node || typeof node !== 'object') continue;
      const type = String(node['@type'] || '');
      if (!/JobPosting/i.test(type)) continue;
      parts.push(...flattenLocationish(node.jobLocation));
      parts.push(...flattenLocationish(node.applicantLocationRequirements));
      if (node.jobLocationType) parts.push(String(node.jobLocationType));
    }
  }
  return parts.length ? [...new Set(parts)].join(', ') : null;
}

/** Recognize an ATS posting URL and return {kind, org, id}. */
export function parseAtsUrl(url) {
  let u; try { u = new URL(url); } catch { return null; }
  const host = u.hostname.toLowerCase();
  const seg = u.pathname.split('/').filter(Boolean);
  if (host.endsWith('ashbyhq.com') && seg.length >= 2) return { kind: 'ashby', org: seg[0], id: seg[1] };
  if (host.includes('greenhouse.io')) {
    const i = seg.indexOf('jobs');
    if (i > 0 && seg[i + 1]) return { kind: 'greenhouse', org: seg[i - 1], id: seg[i + 1] };
  }
  if (host.endsWith('lever.co') && seg.length >= 2) return { kind: 'lever', org: seg[0], id: seg[1] };
  return null;
}

async function geoFromAts(ats) {
  if (ats.kind === 'greenhouse') {
    const j = await get(`https://boards-api.greenhouse.io/v1/boards/${ats.org}/jobs/${ats.id}`, { json: true });
    return j?.location?.name || null;
  }
  if (ats.kind === 'lever') {
    const j = await get(`https://api.lever.co/v0/postings/${ats.org}/${ats.id}`, { json: true });
    return j?.categories?.location || j?.workplaceType || null;
  }
  if (ats.kind === 'ashby') {
    // Ashby exposes the whole board; find the posting by id.
    const j = await get(`https://api.ashbyhq.com/posting-api/job-board/${ats.org}?includeCompensation=false`, { json: true });
    const post = (j?.jobs || []).find(p => p.jobId === ats.id || p.id === ats.id || String(p.jobUrl || '').includes(ats.id));
    if (!post) return null;
    return [post.location, post.workplaceType, ...(post.secondaryLocations || []).map(l => l?.location)]
      .filter(Boolean).join(', ') || null;
  }
  return null;
}

/**
 * @returns {Promise<{geo: string, via: string}|null>} authoritative geo, or null
 */
export async function resolveOfferGeo(url) {
  const direct = parseAtsUrl(url);
  if (direct) {
    const geo = await geoFromAts(direct);
    if (geo) return { geo, via: `ats:${direct.kind}` };
  }
  const html = await get(url);
  if (!html) return null;

  // The ATS link is tried BEFORE JSON-LD, deliberately. Aggregators emit a
  // schema.org `applicantLocationRequirements` listing every country on earth
  // as boilerplate — measured on the Kindred listing, which returned ~190
  // countries including France and Thailand, while the real Ashby posting said
  // "Remote - US". Trusting that JSON-LD would manufacture exactly the
  // false "worldwide" verdict this module exists to prevent.
  const links = [...html.matchAll(/https?:\/\/[^"'\s<>]*(?:ashbyhq\.com|greenhouse\.io|lever\.co)[^"'\s<>]*/gi)]
    .map(m => m[0].replace(/&amp;/g, '&'));
  for (const link of [...new Set(links)].slice(0, 4)) {
    const ats = parseAtsUrl(link);
    if (!ats) continue;
    const geo = await geoFromAts(ats);
    if (geo) return { geo, via: `ats-link:${ats.kind}` };
  }

  const ld = geoFromJsonLd(html);
  // Guard against the country-dump boilerplate described above: a genuine
  // restriction names a handful of places, never the whole UN roster.
  if (ld && ld.split(',').length <= 25) return { geo: ld, via: 'json-ld' };
  return null;
}
