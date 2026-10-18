// Where a candidate can work, read once from any profile (config/profile.yml or
// a Supabase row normalized by lib/profile-shape.mjs) and shared by the scan,
// Jev, the evaluation gate and apply.
//
// Generic shape (all optional, under `location`):
//
//   bases:                      # one per place the candidate works from
//     - city: Paris
//       country: France
//       timezone: Europe/Paris  # IANA zone; derived from the country when absent
//       phone: "+33 …"          # falls back to candidate.phone
//       regions: [EU, EMEA]     # offer regions this base answers for
//       default: true           # used when an offer names no region
//       status: citizen         # citizen | eu_citizen | resident | work_visa | none
//   authorized_in: [France, European Union]
//   needs_sponsorship: true     # outside authorized_in
//   nationality: French
//   remote_policy: Full remote required
//   onsite_exceptions:          # where a full-remote candidate still goes on site
//     - { city: Bangkok, country: Thailand, modes: [onsite, hybrid] }
//   relocation: false
//   travel: { offsites: true, note: "Team offsites anywhere" }
//
// Older profiles keep working: city/country (or default_city/default_country)
// make the first base with candidate.phone, asia_city/asia_country a second
// one with candidate.phone_asia, and the free-text on-site availability gives
// the exceptions.

import {
  countryOf, placesIn, regionTagsOf, regionTagsIn, dialCodeOf, defaultZoneOf, expandCountryList, regionCountriesIn,
  foldPlace, countryOfNationality, demonymOf, isEuFreeMovementCountry, placeFromText,
} from './apply-places.mjs';

const REGION_TAGS = ['EU', 'EEA', 'EUROPE', 'EMEA', 'APAC', 'AMERICAS', 'GLOBAL'];
const WORK_MODES = ['onsite', 'hybrid'];

function str(value) {
  return value == null ? '' : String(value).replace(/\s+/g, ' ').trim();
}

function list(value) {
  if (Array.isArray(value)) return value.map(str).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return value.split(/[,;]/).map(str).filter(Boolean);
  return [];
}

function slug(text) {
  return foldPlace(text).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'base';
}

/** UTC offset in hours of an IANA zone at `date` (null when the zone is unknown). */
export function zoneOffset(zone, date = new Date()) {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' })
      .formatToParts(date).find((p) => p.type === 'timeZoneName')?.value || '';
    const m = name.match(/GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?$/);
    if (!m) return null;
    if (!m[1]) return 0;
    const hours = Number(m[2]) + (m[3] ? Number(m[3]) / 60 : 0);
    return m[1] === '-' ? -hours : hours;
  } catch {
    return null;
  }
}

function offsetLabel(offset) {
  if (offset == null) return '';
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  const h = Math.floor(abs);
  const m = Math.round((abs - h) * 60);
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}

// "UTC+7", "GMT-5", "ICT (UTC+7)" → 7 / -5; null when no offset is written.
function offsetIn(text) {
  const m = String(text || '').match(/\b(?:UTC|GMT)\s*([+\-−–])\s*(\d{1,2})(?::?(\d{2}))?/i);
  if (!m) return null;
  const hours = Number(m[2]) + (m[3] ? Number(m[3]) / 60 : 0);
  return m[1] === '+' ? hours : -hours;
}

// A time-zone option's offset: "GMT+1 (CET)", "(UTC+01:00) Paris", "+7", "UTC".
function optionOffset(text) {
  const written = offsetIn(text);
  if (written != null) return written;
  const bare = String(text || '').match(/(?:^|[\s(])([+\-−–])(\d{1,2})(?::?(\d{2}))?(?=$|[\s)])/);
  if (bare) {
    const hours = Number(bare[2]) + (bare[3] ? Number(bare[3]) / 60 : 0);
    return bare[1] === '+' ? hours : -hours;
  }
  return /\b(UTC|GMT)\b/i.test(String(text || '')) ? 0 : null;
}

// The names a zone goes by in option lists, winter and summer: "Central
// European Time", "Central European Standard Time", "CET", "Indochina Time".
// "GMT+7" is an offset and is matched as one.
function zoneNames(zone) {
  const year = new Date().getFullYear();
  const names = new Set();
  for (const date of [new Date(Date.UTC(year, 0, 15)), new Date(Date.UTC(year, 6, 15))]) {
    for (const locale of ['en-US', 'en-GB']) {
      for (const style of ['long', 'longGeneric', 'short']) {
        try {
          const name = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: style })
            .formatToParts(date).find((p) => p.type === 'timeZoneName')?.value || '';
          if (name && !/^(GMT|UTC)\b/.test(name)) names.add(name);
        } catch { /* unknown zone */ }
      }
    }
  }
  return [...names];
}

/**
 * The row of a time-zone list that is the candidate's zone: its city or IANA
 * name, then a long or short zone name, then its standard or current offset in
 * any format, then its region (EMEA, APAC, Americas). null when no row is.
 * `zone` is an IANA name; without a valid one the country's zone stands in.
 */
export function timezoneOption(options = [], { zone = '', city = '', country = '', offset = null, label = '' } = {}) {
  const rows = (options || []).map((o) => String(typeof o === 'string' ? o : o?.text || '').trim()).filter(Boolean);
  if (!rows.length) return null;
  const iana = zone && zoneOffset(zone) != null ? zone : defaultZoneOf(country);
  const find = (test) => rows.find(test) || null;
  const exact = label && find((row) => foldPlace(row) === foldPlace(label));
  if (exact) return exact;
  for (const place of [iana, iana.split('/').pop().replace(/_/g, ' '), city].filter(Boolean)) {
    const hit = find((row) => mentionsPlace(row, place));
    if (hit) return hit;
  }
  for (const name of iana ? zoneNames(iana) : []) {
    // Abbreviations in capitals only: "cet" and "est" are words.
    const abbr = /^[A-Z]{2,5}$/.test(name) ? new RegExp(`(?<![A-Za-z])${name}(?![A-Za-z])`) : null;
    const hit = find((row) => (abbr ? abbr.test(row) : mentionsPlace(row, name)));
    if (hit) return hit;
  }
  const year = new Date().getFullYear();
  const seasons = iana ? [0, 6].map((month) => zoneOffset(iana, new Date(Date.UTC(year, month, 15)))).filter((o) => o != null) : [];
  const standard = seasons.length ? Math.min(...seasons) : offset;
  for (const want of [standard, iana ? zoneOffset(iana) : offset]) {
    if (want == null) continue;
    const hit = find((row) => optionOffset(row) === want);
    if (hit) return hit;
  }
  const tags = new Set(regionTagsOf(country).filter((tag) => tag !== 'GLOBAL'));
  return find((row) => regionTagsIn(row).some((tag) => tags.has(tag)));
}

// A base's zone: an IANA name as given, else the country's zone; a written
// offset ("UTC+7") is kept when nothing better is known.
function timezoneOf(rawZone, country) {
  const given = str(rawZone);
  if (/^[A-Za-z]+\/[A-Za-z_+\-/]+$/.test(given)) {
    const offset = zoneOffset(given);
    if (offset != null) return { zone: given, offset, label: `${given} (${offsetLabel(offset)})` };
  }
  const zone = defaultZoneOf(country);
  if (zone) {
    const offset = zoneOffset(zone);
    return { zone, offset, label: `${zone} (${offsetLabel(offset)})` };
  }
  const offset = offsetIn(given);
  return { zone: '', offset, label: given || offsetLabel(offset) };
}

function isFullRemoteOnly(policy, extraText = '') {
  const p = foldPlace(policy);
  if (/^full[_ -]?remote$/.test(p) || /^remote[_ -]?only$/.test(p)) return true;
  const text = `${p}\n${foldPlace(extraText)}`;
  return /full(y)?[ -]?remote|remote[ -]only|100\s*% (remote|teletravail)|teletravail (complet|total|100)/.test(text)
    && /(required|only|obligatoire|mandatory|exige|uniquement|seulement|must)/.test(text);
}

// Places a free-text on-site availability opens ("Open to on-site if based in
// Thailand"). Negated clauses and travel ("traveling for offsites anywhere")
// open nothing. Same reading as the evaluation gate's former inline parser.
export function onsitePlacesFromText(text = '', knownBases = []) {
  const open = String(text || '')
    .split(/[;\n]|\.\s/)
    .map((clause) => clause.split(/\btravel|\bdéplace/i)[0])
    .filter((clause) => !/\b(?:no|not|never|except|pas|jamais|sauf)\b/i.test(clause))
    .join('\n');
  const place = "\\p{Lu}[\\p{L}'’-]+(?:\\s+\\p{Lu}[\\p{L}'’-]+)*";
  const named = new RegExp(`(?<!\\p{L})(?:[Ii]n|[Aa]t|[Ww]ithin|[Àà]|[Ee]n|[Aa]ux?)\\s+(${place}(?:\\s*(?:,|/|or|and|ou|et)\\s*${place})*)`, 'gu');
  const places = new Set();
  for (const [, names] of open.matchAll(named)) {
    for (const name of names.split(/\s*(?:[,/]|\b(?:or|and|ou|et)\b)\s*/)) if (name) places.add(name);
  }
  // A country clause opens the base city in it (Thailand brings Bangkok
  // along); a city clause stays a city ("Bangkok only" never opens Thailand).
  for (const base of knownBases) {
    if (base.country && mentionsPlace(open, base.country)) [base.city, base.country].filter(Boolean).forEach((name) => places.add(name));
    else if (base.city && mentionsPlace(open, base.city)) places.add(base.city);
  }
  return [...places];
}

/** The text names `place` as a whole word (accents and case ignored). */
export function mentionsPlace(text = '', place = '') {
  const t = foldPlace(text);
  const p = foldPlace(place);
  if (!p) return false;
  const pattern = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(?<![a-z0-9])${pattern}(?![a-z0-9])`).test(t);
}

function exceptionFromPlace(name) {
  const country = countryOf(name);
  if (!country) return { city: '', country: '', name: str(name), modes: [...WORK_MODES] };
  const isCountry = foldPlace(name) === foldPlace(country) || countryOf(name) === name;
  return { city: isCountry ? '' : str(name), country, name: str(name), modes: [...WORK_MODES] };
}

function normalizeBase(raw, index, { candidate, authorizedCountries, nationality }) {
  const city = str(raw.city);
  const country = countryOf(raw.country) || countryOf(city) || str(raw.country);
  const tz = timezoneOf(raw.timezone, country);
  const tags = list(raw.regions).map((r) => r.toUpperCase()).filter((r) => REGION_TAGS.includes(r));
  const regions = tags.length ? tags : regionTagsOf(country);
  const phone = str(raw.phone) || (index === 0 ? str(candidate.phone) : '');
  const natCountry = countryOfNationality(nationality);
  // An EU / EEA national based in another EU / EEA country works there as
  // an EU citizen, not on a visa.
  const status = str(raw.status)
    || (natCountry && natCountry === country ? 'citizen'
      : natCountry && isEuFreeMovementCountry(natCountry) && isEuFreeMovementCountry(country) ? 'eu_citizen'
        : authorizedCountries.has(country) ? 'authorized' : '');
  return {
    id: str(raw.id) || slug(city || country || `base-${index + 1}`),
    label: str(raw.label) || [city, country].filter(Boolean).join(', '),
    city,
    country,
    timezone: tz.zone,
    utcOffset: tz.offset,
    timezoneLabel: tz.label,
    phone,
    dialCode: (phone.match(/^\s*(\+\d{1,4})/) || [])[1] || dialCodeOf(country),
    regions,
    default: raw.default === true,
    status,
    postalCode: str(raw.postal_code || raw.postal),
    cvProfile: str(raw.cv_profile),
  };
}

// Bases written by older profiles (and by the single-base onboarding).
function legacyBases(location, candidate) {
  const out = [];
  let city = str(location.default_city || location.city);
  let country = str(location.default_country || location.country);
  // A row with only a location text ("Berlin, Germany") still has its base,
  // labelled as written.
  let label = '';
  const place = !city && !country ? placeFromText(candidate.location) : {};
  if (place.country) {
    ({ city, country } = place);
    label = str(candidate.location);
  }
  if (city || country) {
    out.push({
      city, country, label,
      timezone: location.timezone && !/\bor\b|\bou\b/i.test(location.timezone) ? location.timezone : '',
      phone: candidate.phone,
      postal_code: location.postal_code || location.postal || candidate.postal_code,
      default: true,
    });
  }
  const asiaCity = str(location.asia_city);
  const asiaCountry = str(location.asia_country);
  if (asiaCity || asiaCountry) {
    out.push({ city: asiaCity, country: asiaCountry, phone: candidate.phone_asia || '' });
  }
  return out;
}

/**
 * The candidate's location profile, from any profile shape. Never throws;
 * an empty profile gives no bases and an open policy.
 */
export function resolveLocationProfile(profile = {}) {
  const location = profile?.location && typeof profile.location === 'object' ? profile.location : {};
  const search = profile?.search && typeof profile.search === 'object' ? profile.search : {};
  const candidate = profile?.candidate && typeof profile.candidate === 'object' ? profile.candidate : {};
  const compensation = profile?.compensation && typeof profile.compensation === 'object' ? profile.compensation : {};

  const authorizedIn = list(location.authorized_in);
  const authorizedCountries = expandCountryList(authorizedIn);
  // Nationality as written, else read from a visa line ("French / EU citizen").
  const nationality = str(location.nationality || candidate.nationality)
    || (/citizen|citoyen|national/i.test(location.visa_status || '') ? demonymOf(countryOfNationality(location.visa_status)) : '');

  let rawBases = Array.isArray(location.bases) && location.bases.length
    ? location.bases.filter((b) => b && typeof b === 'object')
    : legacyBases(location, candidate);
  // The dashboard edits only location.city / country: when they name another
  // place than the default base, they are the newer answer and replace it
  // (its zone, regions and status were the old place's).
  if (Array.isArray(location.bases) && location.bases.length) {
    const flatCity = str(location.city);
    const flatCountry = str(location.country);
    const index = Math.max(0, rawBases.findIndex((b) => b.default === true));
    const current = rawBases[index] || {};
    const moved = (flatCity && foldPlace(flatCity) !== foldPlace(current.city))
      || (flatCountry && (countryOf(flatCountry) || flatCountry) !== (countryOf(current.country) || str(current.country)));
    if (moved) {
      rawBases = rawBases.map((b, i) => (i === index
        ? { city: flatCity || '', country: flatCountry || '', phone: b.phone, postal_code: location.postal_code || b.postal_code, default: true }
        : b));
    }
  }
  const bases = rawBases.map((b, i) => normalizeBase(b, i, { candidate, authorizedCountries, nationality }));
  if (bases.length && !bases.some((b) => b.default)) bases[0].default = true;
  // Every base's own country is a place the candidate may work from, unless
  // the profile says otherwise (status: none).
  for (const b of bases) if (b.country && b.status !== 'none') authorizedCountries.add(b.country);
  const defaultBase = bases.find((b) => b.default) || bases[0] || null;
  if (defaultBase && !defaultBase.regions.includes('GLOBAL')) defaultBase.regions = [...defaultBase.regions, 'GLOBAL'];

  const remotePolicy = str(location.remote_policy || compensation.location_flexibility);
  const onsiteText = str(search.onsite_availability || location.onsite_availability);
  const fullRemoteOnly = isFullRemoteOnly(location.remote_policy, location.remote_policy ? '' : compensation.location_flexibility);

  // Structured exceptions, or the onboarding's "City, Country" strings.
  let onsiteExceptions = Array.isArray(location.onsite_exceptions) && location.onsite_exceptions.length
    ? location.onsite_exceptions.flatMap((e) => {
        if (typeof e === 'string') {
          const { city, country } = placeFromText(e);
          return [{ city, country: country || (city ? '' : str(e.split(',')[0])), name: e.trim(), modes: [...WORK_MODES] }];
        }
        if (!e || typeof e !== 'object') return [];
        const country = countryOf(e.country) || countryOf(e.city) || str(e.country);
        const modes = list(e.modes).map((m) => m.toLowerCase().replace(/[^a-z]/g, '')).filter((m) => WORK_MODES.includes(m));
        return [{ city: str(e.city), country, name: str(e.city) || country, modes: modes.length ? modes : [...WORK_MODES] }];
      }).filter((e) => e.city || e.country || e.name)
    : null;
  if (!onsiteExceptions) onsiteExceptions = onsitePlacesFromText(onsiteText, bases).map(exceptionFromPlace).filter((e) => e.name);

  const travelRaw = location.travel && typeof location.travel === 'object' ? location.travel : {};
  const travelText = `${onsiteText}\n${str(location.travel_note)}`;
  const travel = {
    offsites: travelRaw.offsites != null ? Boolean(travelRaw.offsites) : /offsite|team[- ]?building|travel|d[ée]placement|s[ée]minaire/i.test(travelText),
    maxPercent: Number(travelRaw.max_percent) || null,
    note: str(travelRaw.note) || (/\btravel|d[ée]placement|offsite/i.test(onsiteText) ? onsiteText : ''),
  };

  const relocation = location.relocation != null
    ? location.relocation
    : (fullRemoteOnly || /no relocation|sans relocalisation|pas de relocalisation/i.test(`${remotePolicy}\n${onsiteText}`) ? false : null);

  return {
    bases,
    defaultBase,
    multiBase: bases.length > 1,
    authorizedIn,
    authorizedCountries,
    needsSponsorship: location.needs_sponsorship === true,
    nationality,
    remotePolicy,
    fullRemoteOnly,
    onsiteText,
    onsiteExceptions,
    // One name per exception: the city when it names one ("Bangkok" never
    // reads as the whole of Thailand), else the country.
    onsitePlaces: [...new Set(onsiteExceptions.map((e) => e.city || e.country || e.name).filter(Boolean))],
    relocation,
    travel,
    visaStatus: str(location.visa_status),
  };
}

/** May the candidate work in `country` without sponsorship? null when unknown. */
export function authorizedFor(loc, country) {
  const c = countryOf(country) || str(country);
  if (!c) return null;
  if (!loc.authorizedCountries.size && !loc.bases.length) return null;
  return loc.authorizedCountries.has(c);
}

/**
 * Hybrid or on-site attendance allowed for this posting? Always for remote /
 * unknown modes and for candidates who are not full remote only; otherwise
 * only when the posting names one of the on-site exceptions for that mode.
 */
export function workModeAllowed(loc, { mode = '', text = '' } = {}) {
  if (!loc.fullRemoteOnly || !WORK_MODES.includes(mode)) return { ok: true, exception: null };
  const named = placesIn(text);
  for (const e of loc.onsiteExceptions) {
    if (!e.modes.includes(mode)) continue;
    if (e.city && mentionsPlace(text, e.city)) return { ok: true, exception: e };
    if (!e.city && e.country && (mentionsPlace(text, e.country) || named.countries.includes(e.country))) return { ok: true, exception: e };
    if (!e.country && e.name && mentionsPlace(text, e.name)) return { ok: true, exception: e };
  }
  return { ok: false, exception: null };
}

/**
 * The base to apply from for an offer. `text` is whatever locates the offer
 * (location field, report location lines, title, URL slug); `legacyRegion`
 * keeps the old 'asia' | 'europe' switch working.
 * Returns { base, reason } — base is null only when the profile has none.
 */
export function selectBase(loc, { text = '', countries = [], legacyRegion = '' } = {}) {
  if (!loc.bases.length) return { base: null, reason: 'no base in profile' };
  if (loc.bases.length === 1) return { base: loc.bases[0], reason: 'single base' };
  if (legacyRegion === 'asia') {
    const asia = loc.bases.find((b) => b.regions.includes('APAC'));
    if (asia) return { base: asia, reason: 'region override: asia' };
  }
  if (legacyRegion === 'europe') {
    const eu = loc.bases.find((b) => b.regions.includes('EU') || b.regions.includes('EUROPE')) || loc.defaultBase;
    return { base: eu, reason: 'region override: europe' };
  }
  const found = placesIn(text);
  const offerCountries = new Set([...countries.map((c) => countryOf(c) || c), ...found.countries]);
  const regionCountries = regionCountriesIn(text);
  const offerTags = new Set([
    ...[...offerCountries, ...regionCountries].flatMap((c) => regionTagsOf(c)),
    ...regionTagsIn(text).filter((tag) => tag !== 'GLOBAL'),
  ]);
  const tzOffset = offsetIn(text);
  let best = null;
  for (const base of loc.bases) {
    let score = 0;
    const why = [];
    if (base.city && found.cities.some((c) => foldPlace(c.city) === foldPlace(base.city))) { score += 100; why.push(`city ${base.city}`); }
    if (base.country && offerCountries.has(base.country)) { score += 80; why.push(`country ${base.country}`); }
    if (base.country && regionCountries.has(base.country)) { score += 60; why.push('region'); }
    else if (base.regions.some((tag) => tag !== 'GLOBAL' && offerTags.has(tag))) { score += 50; why.push('region tag'); }
    if (tzOffset != null && base.utcOffset != null && Math.abs(tzOffset - base.utcOffset) <= 3) { score += 40; why.push('timezone'); }
    if (base.country && loc.authorizedCountries.size && !loc.authorizedCountries.has(base.country) && base.status !== 'citizen') score -= 30;
    if (!best || score > best.score) best = { base, score, why };
  }
  if (!best || best.score <= 0) return { base: loc.defaultBase, reason: 'default base (offer names no base region)' };
  return { base: best.base, reason: best.why.join(', ') };
}

/** Human lines for prompts: every base with its zone and what it answers for. */
export function locationSummaryLines(loc) {
  const lines = [];
  for (const b of loc.bases) {
    const answers = b.default ? 'default base' : `for ${b.regions.filter((r) => r !== 'GLOBAL').join('/') || b.country} offers`;
    lines.push(`- ${b.label || b.country}${b.timezoneLabel ? ` — ${b.timezoneLabel}` : ''} — ${answers}${b.status ? ` — ${b.status}` : ''}`);
  }
  if (loc.multiBase) lines.push('- The base is chosen per offer: the one whose region or country matches the posting, else the default base.');
  return lines;
}

/** "Paris, France or Bangkok, Thailand" — every base, for a one-line location. */
export function basesLabel(loc, joiner = ' or ') {
  return loc.bases.map((b) => b.label).filter(Boolean).join(joiner);
}

/** "on site only in Bangkok, Thailand" style phrase for the exceptions ('' when none). */
export function onsiteExceptionsLabel(loc) {
  return loc.onsiteExceptions.map((e) => [e.city, e.country].filter(Boolean).join(', ') || e.name).filter(Boolean).join('; ');
}
