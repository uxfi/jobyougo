// Profile shape helpers shared by ui/server.mjs and the tests.
//
// Two storages hold the same profile in two shapes:
//
//   * config/profile.yml (local, single user) — the nested shape every consumer
//     reads: { candidate, target_roles, narrative, compensation, location,
//     search, availability, language, spend_tier, ... }.
//   * public.profiles (Supabase, one row per account) — a flat row: full_name,
//     email, location (string), linkedin, plus jsonb columns target_roles,
//     narrative, compensation, search_prefs, location_prefs and, after the
//     2026-10-07 migration, candidate, availability, preferences.
//
// Before this module the server handed the flat row straight to
// inferProfileMatchingRules / buildProfileCriteriaBlock / the cover-letter and
// e-mail renderers, which all read `profile.location.country`,
// `profile.search.must_haves`, `profile.candidate.phone`… so for every
// Supabase account the location policy, work authorization and search criteria
// were silently empty in evaluations (docs/NEW_USER_READINESS.md, item 9).
// normalizeProfileRow() turns the row into the nested shape once, at read time.
//
// Saves go the other way (profileToRow) and are merged section by section over
// the stored profile (mergeProfileSections) so a client that only knows some
// fields — the dashboard profile page does not know `availability` — cannot
// wipe what the onboarding wrote.

import { basesLabel, resolveLocationProfile } from './candidate-location.mjs';

// `screening` holds the answers application forms ask beyond the CV (how the
// candidate heard of a role, EEO choices, consents, clearance, licence,
// custom question → answer pairs). Its own jsonb column since 2026-10-13.
export const PROFILE_SECTIONS = Object.freeze([
  'candidate', 'target_roles', 'narrative', 'compensation', 'location', 'search', 'availability', 'preferences', 'screening',
]);

// Top-level YAML keys that are not sections but still travel with the profile.
// writing_voice / outreach_rules: an account's own writing and outreach rules,
// what the owner keeps in voice-dna.md and modes/_custom.md.
const TOP_LEVEL_KEYS = Object.freeze(['language', 'spend_tier', 'cv', 'page_format', 'style', 'cover_letter', 'contact_preferences', 'writing_voice', 'outreach_rules']);

function hasOwn(obj, key) {
  return Boolean(obj) && Object.prototype.hasOwnProperty.call(obj, key);
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function obj(value) {
  return isObject(value) ? { ...value } : {};
}

function str(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function list(value, max = 50) {
  if (!Array.isArray(value)) return [];
  return value.map(item => (typeof item === 'string' ? item.trim() : item)).filter(Boolean).slice(0, max);
}

function pick(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (value !== null && value !== undefined && typeof value !== 'string') return value;
  }
  return '';
}

/**
 * True when `data` looks like a row of public.profiles rather than the nested
 * YAML shape. The row always carries `full_name`/`email` columns (even null)
 * and never a nested `candidate` object before the migration.
 */
export function isSupabaseProfileRow(data) {
  if (!isObject(data)) return false;
  if (hasOwn(data, 'is_admin') || hasOwn(data, 'location_prefs') || hasOwn(data, 'search_prefs')) return true;
  if (hasOwn(data, 'full_name') && !isObject(data.candidate)) return true;
  // Migrated row: candidate jsonb next to the flat columns.
  if (hasOwn(data, 'full_name') && typeof data.location !== 'object') return true;
  return false;
}

/**
 * Supabase row → nested profile (the shape config/profile.yml has).
 * Nested input is returned as-is (with sections guaranteed to be objects).
 */
export function normalizeProfileRow(data) {
  if (!isObject(data)) return {};
  if (!isSupabaseProfileRow(data)) {
    const out = { ...data };
    for (const key of PROFILE_SECTIONS) {
      if (key === 'preferences' || key === 'availability' || key === 'screening') {
        if (hasOwn(out, key) && !isObject(out[key])) out[key] = {};
      } else {
        out[key] = obj(out[key]);
      }
    }
    return out;
  }

  const candidateJson = obj(data.candidate);
  const candidate = {
    ...candidateJson,
    full_name: pick(data.full_name, candidateJson.full_name),
    email: pick(data.email, candidateJson.email),
    location: pick(typeof data.location === 'string' ? data.location : '', candidateJson.location),
    linkedin: pick(data.linkedin, candidateJson.linkedin),
  };

  const preferences = obj(data.preferences);
  const out = {
    candidate,
    target_roles: obj(data.target_roles),
    narrative: obj(data.narrative),
    compensation: obj(data.compensation),
    location: obj(data.location_prefs),
    search: obj(data.search_prefs),
    availability: obj(data.availability),
    preferences,
    screening: obj(data.screening),
    account: {
      id: data.id || null,
      is_admin: Boolean(data.is_admin),
      onboarding_completed_at: data.onboarding_completed_at || null,
      created_at: data.created_at || null,
      updated_at: data.updated_at || null,
    },
  };

  // Keys the YAML consumers read at the top level (language.output,
  // spend_tier, cv.template…) live in `preferences` on the row.
  for (const key of TOP_LEVEL_KEYS) {
    if (hasOwn(preferences, key) && preferences[key] !== null && preferences[key] !== undefined) out[key] = preferences[key];
  }
  return out;
}

/**
 * Merge an incoming (partial) nested profile over the stored one. Sections are
 * shallow-merged so a client that sends `candidate` without `languages` keeps
 * the stored languages; arrays and scalars inside a section are replaced.
 * `null` for a section clears it.
 */
export function mergeProfileSections(existing = {}, incoming = {}) {
  const base = normalizeProfileRow(existing);
  const out = { ...base };
  if (!isObject(incoming)) return out;

  for (const key of PROFILE_SECTIONS) {
    if (!hasOwn(incoming, key)) continue;
    const next = incoming[key];
    if (next === null) { out[key] = {}; continue; }
    if (!isObject(next)) continue;
    out[key] = { ...obj(base[key]), ...next };
  }
  for (const key of TOP_LEVEL_KEYS) {
    if (hasOwn(incoming, key)) out[key] = incoming[key];
  }
  // Legacy flat aliases some clients still send.
  if (hasOwn(incoming, 'search_prefs') && !hasOwn(incoming, 'search') && isObject(incoming.search_prefs)) {
    out.search = { ...obj(base.search), ...incoming.search_prefs };
  }
  if (hasOwn(incoming, 'location_prefs') && !hasOwn(incoming, 'location') && isObject(incoming.location_prefs)) {
    out.location = { ...obj(base.location), ...incoming.location_prefs };
  }
  for (const flat of ['full_name', 'email', 'phone', 'linkedin']) {
    if (hasOwn(incoming, flat) && typeof incoming[flat] === 'string' && !hasOwn(incoming, 'candidate')) {
      out.candidate = { ...obj(out.candidate), [flat]: incoming[flat] };
    }
  }
  delete out.account;
  return out;
}

function isEmptyValue(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (isObject(value)) return Object.keys(value).length === 0;
  return false;
}

/**
 * `primary` with its empty keys filled from `fallback`, section by section.
 * The owner's config/profile.yml fills what a Supabase row cannot hold yet
 * (extended columns before the migration): a stored value always wins, an
 * empty string never erases one from the file.
 */
export function fillProfileGaps(primary = {}, fallback = {}) {
  const top = normalizeProfileRow(primary);
  const base = normalizeProfileRow(fallback);
  const out = { ...base, ...Object.fromEntries(Object.entries(top).filter(([, v]) => !isEmptyValue(v))) };
  for (const key of PROFILE_SECTIONS) {
    const a = obj(top[key]);
    const b = obj(base[key]);
    if (!Object.keys(a).length && !Object.keys(b).length) continue;
    out[key] = { ...b, ...Object.fromEntries(Object.entries(a).filter(([, v]) => !isEmptyValue(v))) };
  }
  return out;
}

/**
 * Nested profile → the public.profiles row. `legacy` holds the columns every
 * deployment has; `extended` the jsonb columns added by
 * supabase/migrations/20261007_profile_onboarding.sql. The server tries both
 * and falls back to `legacy` alone when the migration has not run yet.
 */
export function profileToRow(profile = {}, userId) {
  const candidate = obj(profile.candidate);
  const preferences = obj(profile.preferences);
  for (const key of TOP_LEVEL_KEYS) {
    if (hasOwn(profile, key) && profile[key] !== undefined) preferences[key] = profile[key];
  }
  const search = isObject(profile.search) ? profile.search : (isObject(profile.search_prefs) ? profile.search_prefs : null);
  const location = isObject(profile.location) ? profile.location : (isObject(profile.location_prefs) ? profile.location_prefs : null);

  const legacy = {
    id: userId,
    full_name: str(candidate.full_name || profile.full_name),
    email: str(candidate.email || profile.email),
    location: str(candidate.location),
    linkedin: str(candidate.linkedin || profile.linkedin),
    target_roles: isObject(profile.target_roles) ? profile.target_roles : null,
    narrative: isObject(profile.narrative) ? profile.narrative : null,
    compensation: isObject(profile.compensation) ? profile.compensation : null,
    search_prefs: search,
    location_prefs: location,
  };
  const extended = {
    candidate,
    availability: isObject(profile.availability) ? profile.availability : {},
    preferences,
    screening: isObject(profile.screening) ? profile.screening : {},
  };
  return { legacy, extended };
}

/** PostgREST answers PGRST204 when an upsert names a column the table lacks. */
export function isMissingColumnError(error) {
  if (!error) return false;
  if (error.code === 'PGRST204' || error.code === '42703') return true;
  return /could not find the '[^']+' column|column "[^"]+" .*does not exist/i.test(String(error.message || ''));
}

/** The column a PostgREST/Postgres missing-column error names ('' when none). */
export function missingColumnName(error) {
  const message = String(error?.message || '');
  return (message.match(/could not find the '([^']+)' column/i) || message.match(/column "(?:[^"]+\.)?([^"]+)" (?:of relation "[^"]+" )?does not exist/i) || [])[1] || '';
}

// ─── Completeness ────────────────────────────────────────────────────────────

function isMissing(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

export const REQUIRED_PROFILE_CHECKS = Object.freeze(['identity', 'target_roles', 'location', 'cv']);

/**
 * What the pipeline needs before scan / evaluation / CV generation can run
 * for this account, plus a weighted completion score for the dashboard.
 * `complete` only depends on REQUIRED_PROFILE_CHECKS so an existing account is
 * never bounced back to onboarding by a new optional check.
 */
export function computeProfileStatus(rawProfile = {}, cvMarkdown = '') {
  const data = normalizeProfileRow(rawProfile);
  const candidate = obj(data.candidate);
  const targetRoles = obj(data.target_roles);
  const narrative = obj(data.narrative);
  const compensation = obj(data.compensation);
  const location = obj(data.location);
  const search = obj(data.search);
  const availability = obj(data.availability);
  const screening = obj(data.screening);
  const cv = str(cvMarkdown);

  const checks = {
    // required
    identity: !isMissing(candidate.full_name),
    target_roles: list(targetRoles.primary).length > 0,
    location: !isMissing(location.country) || !isMissing(candidate.location) || list(location.bases).length > 0,
    cv: cv.length > 0,
    // recommended — drive the completion score and the dashboard checklist
    contact: !isMissing(candidate.phone) || !isMissing(candidate.linkedin),
    headline: !isMissing(narrative.headline),
    narrative: !isMissing(narrative.exit_story) || list(narrative.superpowers).length > 0,
    proof_points: list(narrative.proof_points).length > 0,
    archetypes: list(targetRoles.archetypes).length > 0,
    compensation: !isMissing(compensation.target_range) || !isMissing(compensation.minimum),
    remote_policy: !isMissing(location.remote_policy) || !isMissing(compensation.location_flexibility),
    // needs_sponsorship: false is what an untouched form sends, so a bare
    // boolean false is not an answer; only a stated status or `true` is.
    work_authorization: !isMissing(location.visa_status) || list(location.authorized_in).length > 0 || location.needs_sponsorship === true,
    criteria: list(search.must_haves).length > 0 || list(search.deal_breakers).length > 0 || list(search.sector_preferences).length > 0,
    availability: !isMissing(availability.notice_period) || !isMissing(availability.start_date),
    // What application forms ask beyond the CV.
    languages: list(candidate.languages).length > 0,
    education: list(candidate.education).length > 0,
    nationality: !isMissing(location.nationality) || list(candidate.nationalities).length > 0,
    screening: !isMissing(screening.how_did_you_hear) || !isMissing(screening.eeo) || list(screening.custom_answers).length > 0,
    cv_substantial: cv.length >= 400,
  };

  const weights = {
    identity: 15, target_roles: 15, location: 10, cv: 15,
    contact: 5, headline: 5, narrative: 6, proof_points: 5, archetypes: 4,
    compensation: 5, remote_policy: 5, work_authorization: 4, criteria: 4, availability: 2,
    languages: 2, education: 2, nationality: 2, screening: 2,
    cv_substantial: 0,
  };
  const total = Object.values(weights).reduce((sum, w) => sum + w, 0);
  const earned = Object.entries(weights).reduce((sum, [key, w]) => sum + (checks[key] ? w : 0), 0);
  const completion = total ? Math.round((earned / total) * 100) : 0;

  const missing = REQUIRED_PROFILE_CHECKS.filter(key => !checks[key]);
  const recommended = Object.keys(weights).filter(key => !REQUIRED_PROFILE_CHECKS.includes(key) && weights[key] > 0 && !checks[key]);

  return {
    complete: missing.length === 0,
    missing,
    recommended,
    completion,
    checks,
    onboarding_completed_at: data.account?.onboarding_completed_at || null,
  };
}

// ─── Candidate home base (for the evaluation prompt) ─────────────────────────

/**
 * Where the candidate lives, for prompt lines such as "hybrid attendance
 * outside {home}". Never a hard-coded city: derived from the profile.
 */
export function homeLocationLabel(profile = {}) {
  const data = normalizeProfileRow(profile);
  const candidate = obj(data.candidate);
  // Every base ("Paris, France or Bangkok, Thailand"), generic or legacy.
  const bases = basesLabel(resolveLocationProfile(data));
  if (bases) return bases;
  return str(candidate.location) || "the candidate's home location";
}

// ─── CV parse output ─────────────────────────────────────────────────────────

export const ARCHETYPE_LEVELS = Object.freeze(['Junior', 'Mid', 'Senior', 'Lead', 'Staff', 'Principal', 'Director']);
const ARCHETYPE_FITS = ['primary', 'secondary', 'adjacent'];
// What models write instead of the seven levels. Anything else stays empty
// rather than becoming a free-text "level" the scorer cannot compare.
const LEVEL_ALIASES = {
  'mid-level': 'Mid', 'mid level': 'Mid', intermediate: 'Mid', medior: 'Mid',
  'entry-level': 'Junior', 'entry level': 'Junior', entry: 'Junior', graduate: 'Junior',
  head: 'Director', 'head of': 'Director', vp: 'Director',
};

function archetypeLevel(value) {
  const raw = str(value).toLowerCase();
  if (!raw) return '';
  return ARCHETYPE_LEVELS.find(l => l.toLowerCase() === raw) || LEVEL_ALIASES[raw] || '';
}

function coerceArchetype(entry) {
  if (!isObject(entry)) return null;
  const name = str(entry.name);
  if (!name) return null;
  const fit = ARCHETYPE_FITS.find(f => f === str(entry.fit).toLowerCase()) || 'secondary';
  return { name: name.slice(0, 80), level: archetypeLevel(entry.level), fit };
}

/** "French (native)" from a string or a {name, level} object. */
export function languageLabel(entry) {
  if (typeof entry === 'string') return entry.trim().slice(0, 60);
  if (!isObject(entry)) return '';
  const name = str(entry.name || entry.language);
  if (!name) return '';
  const level = str(entry.level || entry.proficiency);
  return (level ? `${name} (${level})` : name).slice(0, 60);
}

function coerceProofPoint(entry) {
  if (!isObject(entry)) return null;
  const name = str(entry.name);
  if (!name) return null;
  return { name: name.slice(0, 120), url: str(entry.url).slice(0, 300), hero_metric: str(entry.hero_metric).slice(0, 200) };
}

function stripUrlNoise(value) {
  return str(value)
    .replace(/^<|>$/g, '')
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
}

/**
 * 'linkedin.com/in/<handle>' from a URL ("https://fr.linkedin.com/in/jane/?trk=x"),
 * a path ("in/jane") or a bare handle ("jane-doe", "@jane"). '' for anything
 * else, a company page included: the form field is the candidate's profile.
 */
export function normalizeLinkedin(value) {
  const raw = stripUrlNoise(value);
  if (!raw) return '';
  const url = raw.match(/^(?:[a-z]{2,3}\.)?linkedin\.com\/(?:in|pub)\/([^/\s]+)/i);
  if (url) return `linkedin.com/in/${url[1]}`;
  if (/linkedin\.com/i.test(raw)) return '';
  const path = raw.match(/^\/?in\/([^/\s]+)$/i);
  if (path) return `linkedin.com/in/${path[1]}`;
  const handle = raw.replace(/^@/, '');
  return /^[\p{L}\p{N}][\p{L}\p{N}_.%-]{1,99}$/u.test(handle) && !handle.includes('.') ? `linkedin.com/in/${handle}` : '';
}

const GITHUB_RESERVED = new Set(['orgs', 'features', 'about', 'pricing', 'topics', 'collections', 'marketplace', 'sponsors', 'settings', 'login', 'join', 'explore', 'apps', 'enterprise', 'site']);

/** 'github.com/<user>' from a profile or repository URL, or a bare handle. */
export function normalizeGithub(value) {
  const raw = stripUrlNoise(value);
  if (!raw) return '';
  const url = raw.match(/^github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))(?:\/|$)/i);
  if (url) return GITHUB_RESERVED.has(url[1].toLowerCase()) ? '' : `github.com/${url[1]}`;
  if (/github\./i.test(raw)) return '';
  const handle = raw.replace(/^@/, '');
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(handle) ? `github.com/${handle}` : '';
}

/**
 * First number of "12+ years", "8,5 ans", "about 10" — never digits glued
 * together. 0 is kept only with allowZero: a graduate types 0 in the form,
 * while a 0 read from a CV by the model says nothing.
 */
export function yearsFromValue(value, { allowZero = false } = {}) {
  let years;
  if (typeof value === 'number') {
    years = Math.round(value);
  } else {
    const match = String(value ?? '').match(/\d+(?:[.,]\d+)?/);
    if (!match) return '';
    years = Math.round(Number.parseFloat(match[0].replace(',', '.')));
  }
  return Number.isFinite(years) && years >= (allowZero ? 0 : 1) && years < 70 ? years : '';
}

const CURRENCY_SYMBOLS = { '€': 'EUR', '£': 'GBP', '$': 'USD', '¥': 'JPY', '₹': 'INR', '฿': 'THB' };

/** "EUR" from "eur", "EUR/USD", "€" — the first 3-letter code, never "EUR/U". */
export function currencyCode(value) {
  const raw = str(value);
  if (!raw) return '';
  const code = raw.match(/(?:^|[^A-Za-z])([A-Za-z]{3})(?![A-Za-z])/);
  if (code) return code[1].toUpperCase();
  const symbol = Object.keys(CURRENCY_SYMBOLS).find(s => raw.includes(s));
  return symbol ? CURRENCY_SYMBOLS[symbol] : '';
}

function strings(value, max, clip) {
  return list(value, max).filter(r => typeof r === 'string').map(r => r.slice(0, clip));
}

function twoDigitMonth(value) {
  const n = Number.parseInt(str(value), 10);
  return Number.isFinite(n) && n >= 1 && n <= 12 ? String(n).padStart(2, '0') : '';
}

function fourDigitYear(value) {
  const m = str(value).match(/\b(19|20)\d{2}\b/);
  return m ? m[0] : '';
}

export const CURRENT_EMPLOYMENT_VALUES = Object.freeze([
  'Employed, looking discreetly', 'Employed, actively looking', 'Freelancing', 'Between jobs, available now', 'Student / graduating',
]);

const OUTPUT_LANGUAGES = ['en', 'fr', 'de', 'es', 'it', 'pt', 'nl'];

/**
 * Make the LLM's JSON safe for the onboarding form: every expected key exists,
 * strings are strings, lists are lists of non-empty strings, nothing is
 * invented. Unknown keys are dropped. Grounding against the CV text happens in
 * lib/cv-import.mjs; this only types and caps.
 */
export function coerceParsedProfile(parsed) {
  const p = obj(parsed);
  const c = obj(p.candidate);
  const t = obj(p.target_roles);
  const n = obj(p.narrative);
  const comp = obj(p.compensation);
  const loc = obj(p.location);
  const s = obj(p.search);
  const role = obj(s.current_role);
  const avail = obj(p.availability);
  const lang = obj(p.language);
  const employment = str(avail.current_employment);
  const output = str(lang.output).toLowerCase();

  return {
    candidate: {
      full_name: str(c.full_name).slice(0, 120),
      email: str(c.email).slice(0, 200),
      phone: str(c.phone).slice(0, 40),
      location: str(c.location).slice(0, 120),
      linkedin: normalizeLinkedin(c.linkedin).slice(0, 200),
      portfolio_url: str(c.portfolio_url).slice(0, 300),
      github: normalizeGithub(c.github).slice(0, 200),
      twitter: str(c.twitter).slice(0, 200),
      years_experience: yearsFromValue(c.years_experience),
      languages: list(c.languages, 10).map(languageLabel).filter(Boolean),
    },
    target_roles: {
      primary: strings(t.primary, 3, 80),
      archetypes: list(t.archetypes, 4).map(coerceArchetype).filter(Boolean),
    },
    narrative: {
      headline: str(n.headline).slice(0, 160),
      exit_story: str(n.exit_story).slice(0, 600),
      superpowers: strings(n.superpowers, 5, 80),
      proof_points: list(n.proof_points, 8).map(coerceProofPoint).filter(Boolean),
    },
    compensation: {
      currency: currencyCode(comp.currency),
      employment_type: str(comp.employment_type).slice(0, 80),
      target_range: str(comp.target_range).slice(0, 80),
      minimum: str(comp.minimum).slice(0, 80),
      location_flexibility: str(comp.location_flexibility).slice(0, 200),
    },
    location: {
      country: str(loc.country).slice(0, 80),
      city: str(loc.city).slice(0, 80),
      postal_code: str(loc.postal_code).slice(0, 20),
      timezone: str(loc.timezone).slice(0, 40),
      visa_status: str(loc.visa_status).slice(0, 160),
      authorized_in: strings(loc.authorized_in, 10, 60),
      remote_policy: str(loc.remote_policy).slice(0, 160),
    },
    search: {
      current_role: {
        title: str(role.title).slice(0, 120),
        company: str(role.company).slice(0, 120),
        start_month: twoDigitMonth(role.start_month),
        start_year: fourDigitYear(role.start_year),
        current: role.current === true,
      },
      contract_types: strings(s.contract_types, 6, 80),
      sector_preferences: strings(s.sector_preferences, 8, 80),
      geography_preferences: strings(s.geography_preferences, 8, 80),
      must_haves: strings(s.must_haves, 8, 160),
      nice_to_haves: strings(s.nice_to_haves, 8, 160),
      deal_breakers: strings(s.deal_breakers, 8, 160),
    },
    availability: {
      notice_period: str(avail.notice_period).slice(0, 80),
      start_date: str(avail.start_date).slice(0, 80),
      current_employment: CURRENT_EMPLOYMENT_VALUES.includes(employment) ? employment : '',
    },
    language: {
      output: OUTPUT_LANGUAGES.includes(output) ? output : '',
    },
  };
}

/**
 * Pull the first complete JSON object out of an LLM answer that may wrap it in
 * fences or prose. The scan is string-aware, so a "}" inside a value does not
 * end the object; the old first-"{"-to-last-"}" slice broke on prose after the
 * JSON that contained a brace, and on two objects in one answer.
 */
export function extractJsonObject(text = '') {
  const raw = String(text || '');
  let from = raw.indexOf('{');
  let lastError = null;
  while (from !== -1) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let i = from; i < raw.length; i++) {
      const ch = raw[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end === -1) break;
    try {
      return JSON.parse(raw.slice(from, end + 1));
    } catch (err) {
      lastError = err;
      from = raw.indexOf('{', from + 1);
    }
  }
  throw new Error(lastError ? `invalid JSON object in response: ${lastError.message}` : 'no complete JSON object in response');
}

// ─── PUT /api/profile input ──────────────────────────────────────────────────

const LEGACY_FLAT_OBJECTS = ['search_prefs', 'location_prefs'];
const LEGACY_FLAT_STRINGS = ['full_name', 'email', 'phone', 'linkedin'];
const SHORT_FIELDS = new Set([
  'full_name', 'email', 'phone', 'location', 'linkedin', 'portfolio_url', 'github', 'twitter',
  'country', 'city', 'postal_code', 'timezone', 'currency', 'employment_type', 'target_range', 'minimum',
  'notice_period', 'start_date', 'current_employment', 'output', 'modes_dir', 'title', 'company',
  'start_month', 'start_year', 'spend_tier', 'template', 'page_format',
]);
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
// The caps sit far above what the onboarding and the dashboard produce; they
// only stop a client from storing megabytes. A value over a cap is dropped,
// never clipped, so mergeProfileSections keeps the stored value: a clipped
// copy used to replace it (a data-URL photo cut to 300 characters, an exit
// story cut to 2000) while the save answered ok.
const SHORT_MAX = 1000;
const TEXT_MAX = 10_000;
const ITEM_MAX = 2000;
const PHOTO_DATA_URL_MAX = 2_500_000;
const MAX_KEYS = 100;
const MAX_ITEMS = 50;
// Objects or lists allowed below a section key, enough for
// cover_letter.language_learning[].countries[].
const MAX_DEPTH = 3;
// Same image types as build-cv-html.mjs, which inlines the photo in the CV.
const PHOTO_DATA_URL_RE = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i;
const DROP = Symbol('drop');

function safeKey(key) {
  return typeof key === 'string' && key.length > 0 && key.length <= 64 && !UNSAFE_KEYS.has(key);
}

// candidate.photo is a path, a URL or an inline image, so it has its own cap.
function photoValue(value) {
  if (value.startsWith('data:')) return value.length <= PHOTO_DATA_URL_MAX && PHOTO_DATA_URL_RE.test(value) ? value : DROP;
  return value.length <= SHORT_MAX ? value : DROP;
}

function cleanScalar(key, value, inList) {
  if (typeof value === 'string') {
    if (key === 'photo') return photoValue(value);
    const cap = SHORT_FIELDS.has(key) ? SHORT_MAX : (inList ? ITEM_MAX : TEXT_MAX);
    return value.length <= cap ? value : DROP;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean' || value === null) return value;
  return undefined;
}

// DROP when any part of the value is over a cap (length, count or depth): the
// caller then leaves the whole key out rather than storing part of it.
function cleanValue(key, value, depth, inList) {
  if (Array.isArray(value)) {
    if (depth <= 0 || value.length > MAX_ITEMS) return DROP;
    const out = [];
    for (const item of value) {
      const next = cleanValue(null, item, depth - 1, true);
      if (next === DROP) return DROP;
      if (next !== undefined && next !== null) out.push(next);
    }
    return out;
  }
  if (isObject(value)) return depth > 0 ? cleanObject(value, depth - 1, inList) : DROP;
  return cleanScalar(key, value, inList);
}

function cleanObject(value, depth, inList) {
  const entries = Object.entries(value);
  if (entries.length > MAX_KEYS) return DROP;
  const out = {};
  for (const [k, v] of entries) {
    if (!safeKey(k)) continue;
    const next = cleanValue(k, v, depth, inList);
    if (next === DROP) return DROP;
    if (next !== undefined) out[k] = next;
  }
  return out;
}

function sponsorshipFlag(value) {
  if (typeof value === 'boolean') return value;
  const raw = str(value).toLowerCase();
  if (['true', 'yes', 'oui', '1'].includes(raw)) return true;
  if (['false', 'no', 'non', '0'].includes(raw)) return false;
  return undefined;
}

// DROP when the section has more keys than any client sends. Otherwise each
// key over a cap is left out on its own: the merge is per key, so its stored
// value stays and the rest of the section is saved.
function sanitizeSection(key, value) {
  const entries = Object.entries(value);
  if (entries.length > MAX_KEYS) return DROP;
  const out = {};
  for (const [k, v] of entries) {
    if (!safeKey(k)) continue;
    const next = cleanValue(k, v, MAX_DEPTH, false);
    if (next !== DROP && next !== undefined) out[k] = next;
  }
  if (key === 'candidate' && hasOwn(out, 'years_experience')) out.years_experience = yearsFromValue(value.years_experience, { allowZero: true });
  if (key === 'location' && hasOwn(out, 'needs_sponsorship')) {
    const flag = sponsorshipFlag(value.needs_sponsorship);
    if (flag === undefined) delete out.needs_sponsorship;
    else out.needs_sponsorship = flag;
  }
  return out;
}

/**
 * The body of PUT /api/profile, made safe to merge: only the known sections,
 * the top-level YAML keys and the legacy flat aliases mergeProfileSections()
 * understands survive; sections are plain objects with bounded strings and
 * lists. Unknown keys inside a section stay (other clients write
 * default_city, apply_cv, people_management…). A value over its cap is left
 * out, never clipped, so the stored one is kept. A client used to be able to
 * store megabytes, or a string where a section belongs, straight into
 * config/profile.yml or the jsonb columns. Never throws.
 */
export function sanitizeProfileInput(incoming) {
  try {
    if (!isObject(incoming)) return {};
    const out = {};
    for (const key of PROFILE_SECTIONS) {
      if (!hasOwn(incoming, key)) continue;
      const value = incoming[key];
      if (value === null) out[key] = null;
      else if (isObject(value)) {
        const next = sanitizeSection(key, value);
        if (next !== DROP) out[key] = next;
      }
    }
    // The merge replaces these keys whole, so any part over a cap drops the key.
    for (const key of TOP_LEVEL_KEYS) {
      if (!hasOwn(incoming, key)) continue;
      const next = cleanValue(key, incoming[key], MAX_DEPTH + 1, false);
      if (next !== DROP && next !== undefined) out[key] = next;
    }
    for (const key of LEGACY_FLAT_OBJECTS) {
      if (!hasOwn(incoming, key) || !isObject(incoming[key])) continue;
      const next = sanitizeSection(key === 'location_prefs' ? 'location' : 'search', incoming[key]);
      if (next !== DROP) out[key] = next;
    }
    for (const key of LEGACY_FLAT_STRINGS) {
      if (hasOwn(incoming, key) && typeof incoming[key] === 'string' && incoming[key].length <= SHORT_MAX) out[key] = incoming[key];
    }
    return out;
  } catch {
    return {};
  }
}
