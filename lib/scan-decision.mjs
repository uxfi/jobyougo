/**
 * Shared scan decisions for the UI server and `node scan.mjs`.
 *
 * One title gate, one remote policy, one pre-score, one rejection reason.
 * Ambiguous remote under strict mode is `review`: kept out of the validated
 * bucket, scored down, never presented as a strict remote match.
 *
 *   node lib/scan-decision.mjs --dry-run
 */
import { appendFileSync, mkdirSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as yaml from 'js-yaml';
import { compileKeyword, compilePositiveKeyword } from '../title-keywords.mjs';
import { normalizeUrl } from '../url-key.mjs';
import { isMainModule } from './is-main-module.mjs';
import { geoRejectCanWiden } from './remote-geo-widen.mjs';
import { regionTagsOf } from './apply-places.mjs';
import { workModeAllowed } from './candidate-location.mjs';
// Circular on purpose: used inside runTitleDryRun only, after both modules load.
import { loadPortalsForProfile } from './scan-targeting.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULT_REJECTED_REMOTE = [
  'remote-friendly',
  'remote friendly',
  'remote possible',
  'remote option',
  'optional office',
  'flexible location',
  'partially remote',
  'partly remote',
];

const DEFAULT_ALLOWED_GEO = [
  'worldwide', 'global', 'globally', 'work from anywhere', 'anywhere in the world',
  'europe', 'european', 'european union', 'eu', 'eea', 'emea', 'france', 'paris',
  'germany', 'berlin', 'uk', 'united kingdom', 'london', 'asia', 'apac', 'singapore',
];

const DEFAULT_REJECTED_GEO = [
  'us only', 'usa only', 'united states only', 'remote us', 'remote usa',
  'remote united states', 'us remote', 'usa remote', 'united states',
  'us-based', 'us based', 'canada only', 'remote canada', 'canada',
  'latam', 'latin america', 'south america', 'americas', 'north america',
];

// Geography any candidate takes; the rest comes from the profile (geoPolicyFrom).
const GENERIC_ALLOWED_GEO = ['worldwide', 'global', 'globally', 'work from anywhere', 'anywhere in the world'];
const REGION_GEO_WORDS = {
  EU: ['european union', 'eu', 'eea'],
  EUROPE: ['europe', 'european'],
  EMEA: ['emea'],
  APAC: ['asia', 'apac', 'asia pacific', 'south east asia', 'southeast asia'],
  AMERICAS: ['americas'],
};
// The Americas in parts: "Remote - LATAM" does not take a US resident, nor
// "North America" a Brazilian one.
const AMERICAS_PART_WORDS = [
  [['north america'], ['United States', 'Canada', 'Mexico']],
  [['latam', 'latin america'], ['Mexico', 'Brazil', 'Argentina', 'Colombia', 'Chile']],
  [['south america'], ['Brazil', 'Argentina', 'Colombia', 'Chile']],
];
const US_GEO_WORDS = ['us only', 'usa only', 'united states only', 'remote us', 'remote usa', 'remote united states', 'us remote', 'usa remote', 'united states', 'us-based', 'us based'];
const CANADA_GEO_WORDS = ['canada only', 'remote canada', 'canada'];

/**
 * Remote geography a candidate accepts, from lib/candidate-location.mjs:
 * the base cities and countries, the countries they may work in, and the
 * region words of their bases. The US / Canada / Americas rejects drop out
 * for a candidate based or authorized there. No location profile (the CLI,
 * tests) → null, the built-in defaults; a profile with no base and no
 * authorized country → a neutral policy that refuses no geography and leaves
 * US authorization unknown.
 */
export function geoPolicyFrom(loc) {
  if (!loc) return null;
  if (!loc.bases?.length && !loc.authorizedCountries?.size) {
    return { allowed: [...GENERIC_ALLOWED_GEO], rejected: [], usAuthorized: null, openWords: [] };
  }
  const countries = new Set([...loc.bases.map((base) => base.country), ...loc.authorizedCountries].filter(Boolean));
  const tags = new Set(loc.bases.flatMap((base) => base.regions || []));
  for (const country of countries) for (const tag of regionTagsOf(country)) tags.add(tag);
  const americasWords = [
    ...(tags.has('AMERICAS') ? REGION_GEO_WORDS.AMERICAS : []),
    ...AMERICAS_PART_WORDS.filter(([, members]) => members.some((country) => countries.has(country))).flatMap(([words]) => words),
  ];
  const allowed = new Set(GENERIC_ALLOWED_GEO);
  for (const country of countries) allowed.add(country.toLowerCase());
  if (countries.has('United States')) ['us', 'usa', 'remote us', 'us remote'].forEach((word) => allowed.add(word));
  for (const base of loc.bases) if (base.city) allowed.add(base.city.toLowerCase());
  for (const tag of tags) for (const word of REGION_GEO_WORDS[tag] || []) allowed.add(word);
  americasWords.forEach((word) => allowed.add(word));
  const unrejected = new Set(americasWords);
  if (countries.has('United States')) US_GEO_WORDS.forEach((word) => unrejected.add(word));
  if (countries.has('Canada')) CANADA_GEO_WORDS.forEach((word) => unrejected.add(word));
  // Words that open a reject phrase from the shared portals.yml lists
  // ("remote - us", "e-verify", "canada", "americas") for this candidate.
  const openWords = [
    ...(countries.has('United States') ? ['us', 'usa', 'u.s.', 'united states', 'i-9', 'e-verify'] : []),
    ...(countries.has('Canada') ? ['canada'] : []),
    ...americasWords,
  ];
  return {
    allowed: [...allowed],
    rejected: DEFAULT_REJECTED_GEO.filter((word) => !unrejected.has(word)),
    usAuthorized: countries.has('United States'),
    openWords,
  };
}

// A reject phrase that names a place this candidate may work in no longer rejects.
function openedByPolicy(phrase, geoPolicy) {
  const text = normalizeMatchText(phrase);
  return (geoPolicy?.openWords || []).some((word) => new RegExp(`(^|[^a-z])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(text));
}

// Rejected remote terms that only name attendance ("hybrid", "on-site", "in
// office", "commutable"). A posting located in one of the candidate's on-site
// exceptions keeps them (evaluateCandidate).
const ATTENDANCE_TERM = /\b(?:hybrid|on-?site|in[- ]office|office[- ]based|commut\w*)\b/i;

// The on-site exception a posting's location names ("Bangkok, Thailand
// (Hybrid)" for a full-remote candidate who works on site in Bangkok), or null.
function onsiteExceptionOf(candidate, loc) {
  const place = clean(candidate.location);
  if (!place || !loc?.onsiteExceptions?.length) return null;
  const mode = /\bhybrid\b/i.test([candidate.title, place, candidate.description].join(' ')) ? 'hybrid' : 'onsite';
  return workModeAllowed(loc, { mode, text: place }).exception;
}

const US_JD_PHRASES = [
  'must live in the us', 'must live in the usa', 'must live in the united states',
  'must reside in the us', 'must reside in the united states',
  'i-9', 'e-verify', 'authorized to work in the united states',
  'authorized to work in the us', 'us citizens only', 'u.s. citizens only',
];

const US_JD_INCLUSIVE = [
  'united states or europe', 'us or europe', 'us or eu', 'us or emea',
  'europe or the united states', 'worldwide', 'work from anywhere',
  'anywhere in the world', 'global remote',
];

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeMatchText(value = '') {
  return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function escapeRegex(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function phraseInText(text = '', phrase = '') {
  const cleanPhrase = normalizeMatchText(phrase);
  if (!cleanPhrase) return false;
  const pattern = cleanPhrase.split(/\s+/).map(escapeRegex).join('[\\s\\-/_,.()]+');
  return new RegExp(`(^|[^a-z0-9])${pattern}([^a-z0-9]|$)`, 'i').test(text);
}

function firstPhraseMatch(text = '', phrases = []) {
  for (const phrase of phrases) {
    const value = clean(phrase);
    if (value && phraseInText(text, value)) return value;
  }
  return '';
}

function keywordList(value) {
  return (Array.isArray(value) ? value : [])
    .filter(item => typeof item === 'string')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);
}

function compilePatterns(value) {
  const matchers = [];
  for (const raw of Array.isArray(value) ? value : []) {
    if (typeof raw !== 'string' || !raw.trim()) continue;
    try {
      matchers.push({ source: raw.trim(), re: new RegExp(raw.trim(), 'i') });
    } catch {
      matchers.push({ source: raw.trim(), re: null, invalid: true });
    }
  }
  return matchers;
}

function firstKeywordHit(lower, keywords, compile) {
  for (const keyword of keywordList(keywords)) {
    const matcher = compile(keyword);
    if (matcher(lower)) return keyword;
  }
  return '';
}

function firstPatternHit(title, patterns) {
  const compiled = Array.isArray(patterns) && patterns[0]?.re !== undefined
    ? patterns
    : compilePatterns(patterns);
  for (const item of compiled) {
    if (item.invalid) continue;
    if (item.re.test(title)) return item.source;
  }
  return '';
}

/**
 * Title gate shared by the app and the CLI.
 * Negatives (keywords and patterns) veto. A positive keyword or a positive
 * pattern is enough. An empty positive list stays open, matching buildTitleFilter.
 */
export function explainTitle(title, titleFilter = {}) {
  const text = String(title ?? '');
  const lower = text.toLowerCase();
  const blockedKeyword = firstKeywordHit(lower, titleFilter.negative, compileKeyword);
  if (blockedKeyword) {
    return { ok: false, matched: null, blockedBy: blockedKeyword, via: 'keyword', reason: `negative keyword "${blockedKeyword}"` };
  }
  const blockedPattern = firstPatternHit(text, titleFilter.negative_patterns);
  const aiProgramManager = /\b(ai|artificial intelligence|genai|generative ai|llm|agentic|agents?)\b/i.test(text)
    && /\b(program|project)\s+manager\b/i.test(text)
    && !/\b(delivery|partner|channel|vendor|incident|release|site reliability)\s+manager\b/i.test(text)
    && /program\|project/.test(blockedPattern || '');
  if (blockedPattern && !aiProgramManager) {
    return { ok: false, matched: null, blockedBy: blockedPattern, via: 'pattern', reason: `negative pattern "${blockedPattern}"` };
  }
  const matchedKeyword = firstKeywordHit(lower, titleFilter.positive, compilePositiveKeyword);
  if (matchedKeyword) {
    return { ok: true, matched: matchedKeyword, blockedBy: null, via: 'keyword', reason: `positive keyword "${matchedKeyword}"` };
  }
  const matchedPattern = firstPatternHit(text, titleFilter.positive_patterns);
  if (matchedPattern) {
    return { ok: true, matched: matchedPattern, blockedBy: null, via: 'pattern', reason: `positive pattern "${matchedPattern}"` };
  }
  const hasPositive = keywordList(titleFilter.positive).length > 0 || compilePatterns(titleFilter.positive_patterns).some(item => !item.invalid);
  if (!hasPositive) {
    return { ok: true, matched: null, blockedBy: null, via: 'open', reason: 'no positive constraint' };
  }
  return { ok: false, matched: null, blockedBy: null, via: 'no_positive', reason: 'no positive keyword or pattern' };
}

export function normalizeRemotePolicy(raw = {}) {
  const policy = clean(raw.ambiguous_policy || 'review').toLowerCase() || 'review';
  return {
    mode: clean(raw.mode || ''),
    requiredAny: keywordList(raw.required_any),
    rejectedAny: keywordList(raw.rejected_any),
    allowedGeoAny: keywordList(raw.allowed_geo_any),
    rejectedGeoAny: keywordList(raw.rejected_geo_any),
    ambiguousPolicy: policy === 'skip' ? 'reject' : policy,
  };
}

function ambiguousRemote(policy) {
  if (policy === 'reject') return { disposition: 'reject', confidence: 0 };
  if (policy === 'keep_but_downrank') return { disposition: 'keep_but_downrank', confidence: 0.35 };
  if (policy === 'keep') return { disposition: 'keep', confidence: 0.45 };
  return { disposition: 'review', confidence: 0.3 };
}

function remoteResult(disposition, confidence, reason, evidence = '') {
  return { disposition, confidence, reason, evidence: evidence || '' };
}

/**
 * Remote decision. Strict mode does not treat a missing remote signal as a pass.
 * `review` is the configured choice: the offer stays visible, scored down,
 * and is not mixed with validated strict-remote offers. `onsiteException` is
 * the candidate's on-site exception the posting's location names: attendance
 * terms then reject nothing and strict mode keeps the posting.
 */
// Attendance words that bind nothing (2026-10-17 audit of a 305-company scan):
// "Interviews will be conducted via virtual meetings and/or onsite" (Bjak),
// "a strong remote-friendly culture" (Pennylane), relocation help.
const NON_BINDING_ATTENDANCE = [
  /\binterview\w*|\btrial (?:work|day|period)|\b(?:hiring|recruit\w*|selection) process/i,
  // "our chaotic-but-fun, remote-friendly, start-up environment" (Consensys).
  /\bremote[- ]friendly\b[^.!?]{0,30}?\b(?:culture|company|team|environment|organi[sz]ation|workplace|start-?up)/i,
  /\brelocation (?:assistance|support|package|bonus|help|stipend)/i,
  // Benefits and job content, not attendance: "on-site gyms" (JetBrains),
  // "a hybrid UR/UX skill set", "on-site research" (Anduril).
  /\bon-?site (?:gyms?|meals?|cafeteria|canteen|childcare|parking|massage|sports?)/i,
  /\bhybrid (?:[\w/-]+ ){0,2}(?:skill ?set|skills|background|profile|role of)\b|\bdesign\/development hybrid\b/i,
  /\bon-?site (?:research|visits?|with (?:customers|users|clients|soldiers))\b/i,
];
// A choice that includes remote: "Europe remote or London hybrid" (Synthesia),
// "London (Hybrid) / UK Remote" (Monzo), "remote and hybrid work options" (Valtech).
const REMOTE_CHOICE = [
  /\bremote\b[^.!?]{0,60}?(?:\bor\b|\/)[^.!?]{0,60}?\b(?:hybrid|on-?site|in[- ]office)\b/i,
  /\b(?:hybrid|on-?site|in[- ]office)\b[^.!?]{0,60}?(?:\bor\b|\/)\s*(?:[\w()]+\s+){0,2}(?:fully\s+|full\s+)?remote\b/i,
  /\bremote (?:and|or|&|,) ?hybrid (?:work(?:ing)? )?(?:options|arrangements|models?)\b/i,
];

function isAttendancePhrase(phrase = '') {
  return ATTENDANCE_TERM.test(phrase)
    || DEFAULT_REJECTED_REMOTE.includes(phrase)
    || /\b(?:relocat\w*|commut\w*)\b/i.test(phrase);
}

function jdSentences(text = '') {
  return String(text || '').split(/(?<=[.!?])\s+|\s+[-•·]\s+|\n+/).filter(Boolean);
}

/** The description without its non-binding attendance sentences. */
export function bindingAttendanceText(description = '') {
  return jdSentences(description)
    .filter(sentence => !NON_BINDING_ATTENDANCE.some(re => re.test(sentence)))
    .filter(sentence => !REMOTE_CHOICE.some(re => re.test(sentence)))
    .join(' ');
}

export function offersRemoteChoice(description = '') {
  return jdSentences(description).some(sentence => REMOTE_CHOICE.some(re => re.test(sentence)));
}

export function assessRemote(candidate = {}, remoteFilterRaw = {}, inclusivePhrases = [], geoPolicy = null, onsiteException = null, { attendanceOpen = false } = {}) {
  const remoteFilter = normalizeRemotePolicy(remoteFilterRaw);
  // attendanceOpen: the candidate is not full remote only (evaluateCandidate),
  // so attendance words and a missing "remote" are information, not a refusal.
  const attendanceFree = Boolean(onsiteException) || attendanceOpen;
  const allowedGeoDefaults = geoPolicy ? geoPolicy.allowed : DEFAULT_ALLOWED_GEO;
  const rejectedGeoDefaults = geoPolicy ? geoPolicy.rejected : DEFAULT_REJECTED_GEO;
  const strictMode = remoteFilter.mode === 'strict_full_remote_only';
  const titleText = clean(candidate.title);
  const locationText = clean(candidate.location);
  const evidenceText = clean(candidate.remoteEvidence);
  const urlText = clean(candidate.url);
  const descriptionText = clean(candidate.description).slice(0, 8000);
  const remoteSignalText = [titleText, locationText, evidenceText, urlText].filter(Boolean).join(' | ');
  const geoSignalText = [locationText, evidenceText, urlText].filter(Boolean).join(' | ');
  const rejectSignalText = [remoteSignalText, descriptionText].filter(Boolean).join(' | ');
  const lower = normalizeMatchText(remoteSignalText);
  const rejectLower = normalizeMatchText(rejectSignalText);
  const geoLower = normalizeMatchText(geoSignalText);
  const titleLower = normalizeMatchText(titleText);

  // portals.yml's "must live in the us" / "e-verify" open like its geo rejects.
  const rejectedAny = remoteFilter.rejectedAny
    .filter((phrase) => !openedByPolicy(phrase, geoPolicy) && !(attendanceFree && ATTENDANCE_TERM.test(phrase)));
  const rejectPhrases = [...rejectedAny, ...(attendanceFree ? [] : DEFAULT_REJECTED_REMOTE)];
  // Attendance words are read where they bind. The ATS's own "Remote" field
  // outranks a stray word anywhere but the title; a JD offering remote as
  // one of the choices lifts an ATS "Hybrid" (never an ATS "OnSite").
  const workMode = clean(candidate.workMode).toLowerCase();
  // The location field can carry the choice too: "Cardiff, London or Remote (UK)".
  const remoteChoice = workMode !== 'onsite' && offersRemoteChoice([locationText, descriptionText].filter(Boolean).join('. '));
  const attendanceText = workMode === 'remote'
    ? titleText
    : [remoteChoice ? titleText : remoteSignalText, bindingAttendanceText(descriptionText)].filter(Boolean).join(' | ');
  // With remote on offer, "remote friendly" or "remote possible" no longer
  // means remote is only tolerated ("A flexible, remote friendly role based
  // out of Europe or one of our hubs", Synthesia).
  const attendancePhrases = rejectPhrases
    .filter(isAttendancePhrase)
    .filter(phrase => !(remoteChoice && DEFAULT_REJECTED_REMOTE.includes(phrase)));
  const rejectedMatch = firstPhraseMatch(rejectLower, rejectPhrases.filter(phrase => !isAttendancePhrase(phrase)))
    || firstPhraseMatch(normalizeMatchText(attendanceText), attendancePhrases);
  if (rejectedMatch) {
    return remoteResult('reject', 0, `rejected remote term "${rejectedMatch}"`, rejectedMatch);
  }
  if (!strictMode) {
    return remoteResult('keep', 0.7, 'remote filter not strict', '');
  }
  if (onsiteException) {
    const place = onsiteException.city || onsiteException.country || onsiteException.name;
    return remoteResult('keep', 0.8, `on-site exception "${place}"`, place);
  }

  const requiredMatch = firstPhraseMatch(lower, remoteFilter.requiredAny);
  // A hybrid or on-site posting needs no "remote" word; its geography still counts.
  if (!requiredMatch && !attendanceOpen) {
    const amb = ambiguousRemote(remoteFilter.ambiguousPolicy);
    return remoteResult(amb.disposition, amb.confidence, 'remote status is ambiguous', '');
  }

  const descLower = normalizeMatchText(descriptionText);
  // Only a candidate known not to be US-authorized (or the built-in defaults,
  // without a policy) is refused on US work-auth; unknown status is not.
  const usJdHit = !geoPolicy || geoPolicy.usAuthorized === false ? firstPhraseMatch(descLower, US_JD_PHRASES) : '';
  if (usJdHit) {
    const hardAuth = /\bi-9\b|\be-verify\b|us citizens only|u\.s\. citizens only|authorized to work in the (us|usa|united states)/i.test(usJdHit);
    const inclusiveHit = firstPhraseMatch(descLower, US_JD_INCLUSIVE);
    if (hardAuth || !inclusiveHit) {
      return remoteResult('reject', 0, `JD requires US residency or work auth "${usJdHit}"`, usJdHit);
    }
  }

  const titleGeoMatch = firstPhraseMatch(titleLower, [
    'remote worldwide', 'worldwide remote', 'remote global', 'global remote',
    'remote europe', 'europe remote', 'remote emea', 'emea remote', 'remote eu',
    'eu remote', 'remote asia', 'asia remote', 'remote apac', 'apac remote',
    'work from anywhere',
  ]);
  const titleGeoTerms = titleGeoMatch
    ? titleGeoMatch.split(/\s+/).filter(term => term !== 'remote')
    : [];
  const allowedPool = [...remoteFilter.allowedGeoAny, ...allowedGeoDefaults];
  const allowedGeoMatch = firstPhraseMatch(geoLower, allowedPool)
    || firstPhraseMatch(titleGeoTerms.join(' '), allowedPool);
  const rejectedGeoMatch = firstPhraseMatch(lower, [
    ...remoteFilter.rejectedGeoAny.filter((phrase) => !openedByPolicy(phrase, geoPolicy)),
    ...rejectedGeoDefaults,
  ]);
  const vagueAllowedGeo = normalizeMatchText(allowedGeoMatch) === 'work from anywhere';
  if (rejectedGeoMatch && (!allowedGeoMatch || vagueAllowedGeo)) {
    const opened = geoRejectCanWiden(descriptionText, inclusivePhrases);
    if (opened.widen) {
      return remoteResult('keep', 0.8, `rejected geo "${rejectedGeoMatch}" opened by JD phrase "${opened.phrase}"`, opened.phrase);
    }
    return remoteResult('reject', 0, `rejected remote geography "${rejectedGeoMatch}"`, rejectedGeoMatch);
  }
  if (allowedGeoMatch) {
    return remoteResult(
      'keep',
      0.95,
      requiredMatch ? `remote "${requiredMatch}" and geo "${allowedGeoMatch}"` : `geo "${allowedGeoMatch}", candidate takes hybrid or on-site work`,
      [requiredMatch, allowedGeoMatch].filter(Boolean).join(' / '),
    );
  }
  if (rejectedGeoMatch) {
    const opened = geoRejectCanWiden(descriptionText, inclusivePhrases);
    if (opened.widen) {
      return remoteResult('keep', 0.8, `rejected geo "${rejectedGeoMatch}" opened by JD phrase "${opened.phrase}"`, opened.phrase);
    }
    return remoteResult('reject', 0, `rejected remote geography "${rejectedGeoMatch}"`, rejectedGeoMatch);
  }
  const amb = ambiguousRemote(remoteFilter.ambiguousPolicy);
  const confidence = amb.disposition === 'reject' ? 0 : Math.max(amb.confidence, 0.55);
  return remoteResult(amb.disposition, confidence, 'remote geography is ambiguous', requiredMatch);
}

export function coerceIsoDate(value, today = '') {
  if (value == null || value === '') return '';
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
  }
  const raw = clean(value);
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/);
  if (iso) return validIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  if (/^\d{10,13}$/.test(raw)) {
    const millis = raw.length === 10 ? Number(raw) * 1000 : Number(raw);
    const parsed = new Date(millis);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  }
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime()) && parsed.getFullYear() > 1990) return parsed.toISOString().slice(0, 10);
  return today && raw === today ? today : '';
}

function addIsoDays(iso, days) {
  const base = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return '';
  return new Date(base.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

function ageDays(iso, today) {
  const start = new Date(`${iso}T00:00:00Z`).getTime();
  const end = new Date(`${today}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.floor((end - start) / DAY_MS);
}

const MONTH_INDEX = {
  january: 1, jan: 1, february: 2, feb: 2, fevrier: 2,
  march: 3, mar: 3, mars: 3, april: 4, apr: 4, avril: 4,
  may: 5, mai: 5, june: 6, jun: 6, juin: 6,
  july: 7, jul: 7, juillet: 7, juli: 7, august: 8, aug: 8, aout: 8,
  september: 9, sep: 9, sept: 9, septembre: 9,
  october: 10, oct: 10, octobre: 10, oktober: 10,
  november: 11, nov: 11, novembre: 11,
  december: 12, dec: 12, decembre: 12, dezember: 12,
  januar: 1, februar: 2, marz: 3, juni: 6,
};

function foldDateText(value = '') {
  return String(value || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function validIso(year, month, day) {
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return '';
  return dt.toISOString().slice(0, 10);
}

function lastDayOfMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

const MONTH_NAME_RE = Object.keys(MONTH_INDEX).sort((a, b) => b.length - a.length).join('|');

function inferYear(month, day, today) {
  const base = coerceIsoDate(today) || new Date().toISOString().slice(0, 10);
  const year = Number(base.slice(0, 4));
  const thisYear = validIso(year, month, day);
  if (!thisYear) return '';
  return thisYear > base ? validIso(year - 1, month, day) : thisYear;
}

/**
 * Calendar dates in free text. Month-only dates use the last day of that
 * month, so a still-open month is not treated as stale. A day and month
 * without a year are placed in the current year, or the previous one when
 * that day has not happened yet.
 */
export function explicitDatesFromText(text = '', today = '') {
  const raw = foldDateText(text);
  const found = [];
  for (const match of raw.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) {
    const date = validIso(Number(match[1]), Number(match[2]), Number(match[3]));
    if (date) found.push(date);
  }
  for (const match of raw.matchAll(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](20\d{2})\b/g)) {
    let day = Number(match[1]);
    let month = Number(match[2]);
    const year = Number(match[3]);
    if (month > 12 && day <= 12) [day, month] = [month, day];
    const date = validIso(year, month, day);
    if (date) found.push(date);
  }
  if (/\btuyen\b|\bviec\b|\buniversite\b|\btruong\b/.test(raw)) {
    for (const match of raw.matchAll(/\bt(1[0-2]|0?[1-9])\/(20\d{2})\b/g)) {
      found.push(lastDayOfMonth(Number(match[2]), Number(match[1])));
    }
  }
  for (const match of raw.matchAll(new RegExp(`\\b(${MONTH_NAME_RE})\\b[\\s,.-]+(\\d{1,2})(?!\\d)(?:st|nd|rd|th)?\\b(?:[\\s,.-]+(20\\d{2}))?`, 'g'))) {
    const month = MONTH_INDEX[match[1]];
    const day = Number(match[2]);
    if (!month || day > 31) continue;
    const date = match[3] ? validIso(Number(match[3]), month, day) : inferYear(month, day, today);
    if (date) found.push(date);
  }
  for (const match of raw.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?[\\s.-]+(${MONTH_NAME_RE})\\b(?:[\\s,.-]*(20\\d{2}))?`, 'g'))) {
    const month = MONTH_INDEX[match[2]];
    const day = Number(match[1]);
    if (!month) continue;
    const date = match[3] ? validIso(Number(match[3]), month, day) : inferYear(month, day, today);
    if (date) found.push(date);
  }
  for (const match of raw.matchAll(new RegExp(`\\b(${MONTH_NAME_RE})\\b[\\s,.-]*(20\\d{2})\\b`, 'g'))) {
    const month = MONTH_INDEX[match[1]];
    if (month) found.push(lastDayOfMonth(Number(match[2]), month));
  }
  return found.filter(Boolean);
}

/** Oldest explicit calendar date in the text, or empty. */
export function explicitDateFromText(text = '', today = '') {
  const found = explicitDatesFromText(text, today);
  found.sort();
  return found[0] || '';
}

function dateFromUrl(url = '') {
  const raw = String(url || '');
  const found = [];
  for (const match of raw.matchAll(/\/(20\d{2})[/-](\d{1,2})[/-](\d{1,2})(?:\/|$|\?|#)/g)) {
    const date = validIso(Number(match[1]), Number(match[2]), Number(match[3]));
    if (date) found.push(date);
  }
  try {
    const params = new URL(raw).searchParams;
    for (const key of ['posted', 'published', 'published_at', 'date', 'dateposted']) {
      const date = explicitDateFromText(params.get(key) || '');
      if (date) found.push(date);
    }
  } catch { /* not a URL */ }
  found.sort();
  return found[0] || '';
}

function shiftDays(today, days) {
  const base = coerceIsoDate(today);
  if (!base) return '';
  return addIsoDays(base, -Math.abs(Number(days) || 0));
}

const RELATIVE_UNIT_DAYS = {
  day: 1, days: 1, jour: 1, jours: 1, tag: 1, tagen: 1, tages: 1,
  week: 7, weeks: 7, semaine: 7, semaines: 7, woche: 7, wochen: 7,
  month: 30, months: 30, mois: 30, monat: 30, monaten: 30, monats: 30,
};

function pushRelative(found, today, count, unit) {
  const daysEach = RELATIVE_UNIT_DAYS[foldDateText(unit)];
  const n = Number(count);
  if (!daysEach || !Number.isFinite(n) || n <= 0) return;
  const date = shiftDays(today, n * daysEach);
  if (date) found.push(date);
}

/**
 * Freshness badges ("posted 20 days ago", "il y a 3 semaines", "vor 2 Wochen").
 * "5 years of experience" is not a posting date. The oldest match wins.
 */
export function relativeDateFromText(text = '', today = '') {
  const raw = foldDateText(text);
  const found = [];
  const unit = Object.keys(RELATIVE_UNIT_DAYS).sort((a, b) => b.length - a.length).join('|');
  const edge = `(?:^|[\\n|·•]\\s*)`;
  const label = `\\b(?:posted|publiee?|mis en ligne|ajoutee?|originally posted|first published|date posted)\\s+`;
  const ago = `(?:more than |over |plus de )?(\\d+)\\s*\\+?\\s*(${unit})\\s+ago`;
  const french = `il y a(?: plus de)?\\s+(?:un(?:e)?\\s+)?(\\d+)\\s+(${unit})\\b`;
  const german = `vor\\s+(?:einem?\\s+)?(\\d+)\\s+(${unit})\\b`;
  const consider = (match, count, unitName, { allowComma = false } = {}) => {
    const after = raw.slice(match.index + match[0].length);
    if (!allowComma && /^\s*,/.test(after)) return;
    pushRelative(found, today, count, unitName);
  };
  for (const match of raw.matchAll(new RegExp(`${edge}${ago}`, 'g'))) consider(match, match[1], match[2]);
  for (const match of raw.matchAll(new RegExp(`${label}${ago}`, 'g'))) consider(match, match[1], match[2], { allowComma: true });
  for (const match of raw.matchAll(new RegExp(`${edge}${french}`, 'g'))) consider(match, match[1], match[2]);
  for (const match of raw.matchAll(new RegExp(`${label}${french}`, 'g'))) consider(match, match[1], match[2], { allowComma: true });
  for (const match of raw.matchAll(new RegExp(`${edge}${german}`, 'g'))) consider(match, match[1], match[2]);
  for (const match of raw.matchAll(new RegExp(`${label}${german}`, 'g'))) consider(match, match[1], match[2], { allowComma: true });
  for (const match of raw.matchAll(new RegExp(`${edge}il y a une semaine\\b`, 'g'))) consider(match, 1, 'semaine');
  for (const match of raw.matchAll(new RegExp(`${edge}il y a un mois\\b`, 'g'))) consider(match, 1, 'mois');
  const spoken = `(?:[|·•]\\s*|${label})`;
  if (new RegExp(`${spoken}(?:today|aujourd'?hui)\\b`).test(raw)) found.push(shiftDays(today, 0));
  if (new RegExp(`${spoken}(?:yesterday|hier)\\b`).test(raw)) found.push(shiftDays(today, 1));
  if (new RegExp(`${spoken}(?:a week ago|last week|la semaine derniere)\\b`).test(raw)) found.push(shiftDays(today, 8));
  if (new RegExp(`${spoken}(?:a month ago|last month|le mois dernier)\\b`).test(raw)) found.push(shiftDays(today, 30));
  found.sort();
  return found[0] || '';
}

const POSTED_LABEL = /\b(?:originally posted|first published|date de publication|date posted|mis en ligne|publiee? le|ajoutee? le|posted)\b/;

function notFuture(date, today) {
  const base = coerceIsoDate(today);
  if (!date || (base && date > base)) return '';
  return date;
}

/**
 * Publication date. A date already sent by the source is kept as-is.
 * Otherwise the oldest date found in the URL, the title, a "posted" label
 * in the snippet, or a relative badge. A date in the future is ignored.
 */
export function resolvePublishedDate(candidate = {}, today = '') {
  const structured = notFuture(coerceIsoDate(candidate.publishedAt || candidate.postedAt), today);
  if (structured) return structured;
  const found = [];
  const fromUrl = dateFromUrl(candidate.url);
  if (fromUrl) found.push(fromUrl);
  const titleDate = explicitDateFromText(candidate.title || '', today);
  if (titleDate) found.push(titleDate);
  const snippet = [candidate.description, candidate.snippet, candidate.remoteEvidence].filter(Boolean).join('\n').slice(0, 400);
  const folded = foldDateText(snippet);
  for (const match of folded.matchAll(new RegExp(`${POSTED_LABEL.source}.{0,48}`, 'g'))) {
    const date = explicitDateFromText(match[0], today);
    if (date) found.push(date);
  }
  const relative = relativeDateFromText(`${candidate.title || ''}\n${snippet}`, today);
  if (relative) found.push(relative);
  const usable = found.map(date => notFuture(date, today)).filter(Boolean);
  usable.sort();
  return usable[0] || '';
}

export function assessFreshness({ publishedAt, firstSeen, maxAgeDays, today }) {
  const windowDays = Number(maxAgeDays);
  const bounded = Number.isFinite(windowDays) && windowDays > 0 ? windowDays : 0;
  const published = coerceIsoDate(publishedAt);
  if (published) {
    const base = coerceIsoDate(today);
    if (base && published > base) {
      return { ok: false, source: 'published', freshness: 0, publishedAt: published, reason: `published ${published} is in the future` };
    }
    if (!bounded) return { ok: true, source: 'published', freshness: 0.8, publishedAt: published, reason: '' };
    const age = ageDays(published, today);
    if (age > bounded) {
      return { ok: false, source: 'published', freshness: 0, publishedAt: published, reason: `published ${published} is older than ${bounded}d` };
    }
    return { ok: true, source: 'published', freshness: Math.max(0.5, 1 - (age / bounded) * 0.5), publishedAt: published, reason: '' };
  }
  const seen = coerceIsoDate(firstSeen);
  if (seen && bounded && ageDays(seen, today) > bounded) {
    return { ok: false, source: 'proxy', freshness: 0, publishedAt: '', proxySeen: seen, reason: `undated offer first seen ${seen}, past ${bounded}d` };
  }
  const proxySeen = seen || today;
  return {
    ok: true,
    source: 'proxy',
    freshness: 0.4,
    publishedAt: '',
    proxySeen,
    proxyExpiresAt: bounded ? addIsoDays(proxySeen, bounded) : '',
    reason: 'no published date, using first_seen proxy',
  };
}

export function internOrJuniorReason(title = '', url = '') {
  const text = `${title}\n${url}`;
  // Feminine and plural French forms too ("Alternante(e) UX/UI designer", GAMMEO 2026-10-16).
  if (/\b(intern|internship|working student|stagiaires?|alternance|alternante?s?|apprentie?s?|apprentissage|entry[- ]level|graduate)\b/i.test(text)) {
    return 'intern or junior programme';
  }
  if (/(?:^|[/_-])(?:intern(?:ship)?|stagiaire|alternance|alternant|apprenti)(?:[/_-]|$)/i.test(url)) {
    return 'intern or junior programme';
  }
  if (
    /\bstage\s+de\b/i.test(title)
    || /^stage\b/i.test(String(title).trim())
    || /\bfin\s+d['’]études\b/i.test(title)
  ) {
    return 'internship (stage)';
  }
  if (!/\bearly[- ]stage\b/i.test(title) && (/[-–—]\s*stage\b/i.test(title) || /\bstage\s*[-–—]/i.test(title))) {
    return 'internship (stage)';
  }
  if (/[/_-]stage[/_-]de(?:[/_-]|$)/i.test(url) || /[/_-]stage[/_-]fin/i.test(url)) {
    return 'internship (stage)';
  }
  // "JR 747", "JR-12345" is a requisition number (ELEKS), not "Jr.".
  if (/\bjunior\b|\bjr\b\.?(?![\s-]*#?\d)/i.test(title) || /(?:^|[/_-])junior(?:[/_-]|$)/i.test(url)) return 'junior title';
  return '';
}

// "Assistant" names the level in "Assistant Product Designer" / "Design
// Assistant", but the product in "Product Designer, AI Assistant". Those
// product words are blanked before the level check.
const ASSISTANT_PRODUCT = /\b(?:ai|a\.i\.|gen\s?ai|llm|voice|virtual|coding|code|shopping|smart|chat|conversational|copilot|agentic|agent|writing|email|meeting|digital)[\s-]+assistants?\b/gi;
const ASSISTANT_SENIOR = /\bassistant(?:e)?\s+(?:vice[\s-]+president|director|professor)\b/gi;
const ASSISTANT_LEVEL = /\bassistant(?:e)?s?\b/i;
const SENIOR_TITLE_WORDS = /\b(?:staff|principal|lead|head|director|vp|chief)\b/i;
// mid-level, midweight, "(Mid)", a leading "Mid", Canadian "Intermediate".
const MID_LEVEL = /\bmid[\s-]?(?:level|weight)\b|[([]\s*mid\s*[)\]]|^\s*mid\s+(?!market|size|cap)\w|\bintermediate\b/i;
// "Mid/Senior", "Mid Senior", "Intermediate/Senior": the posting also takes a senior.
const MID_OR_SENIOR = /\b(?:mid|intermediate)(?:[\s-]?(?:level|weight))?\s*(?:\/|-|–|\bto\b|\bor\b|&|\band\b|\+)?\s*(?:senior|sr\.?|lead)\b/i;

/**
 * Titles below the candidate's target level (profile.yml: Senior/Lead) that
 * internOrJuniorReason does not cover: assistant and mid-level. The 2026-10-13
 * scan kept "Assistant Product Designer" (0.73) and "UI/UX Designer (Mid
 * Level)".
 */
export function belowTargetLevelReason(title = '') {
  const text = String(title || '');
  // A staff/lead/head title is not an assistant role: "Staff Product Designer -
  // Wise Assistant Experience" names the product.
  if (!SENIOR_TITLE_WORDS.test(text) && ASSISTANT_LEVEL.test(text.replace(ASSISTANT_PRODUCT, ' ').replace(ASSISTANT_SENIOR, ' '))) return 'below target level (assistant)';
  if (MID_LEVEL.test(text) && !MID_OR_SENIOR.test(text)) return 'below target level (mid-level)';
  return '';
}

const SENIOR_LEVEL_WORDS = /\b(senior|sr|lead|staff|principal|head|director|vp|chief)\b/i;
// "Mid/Senior", "Intermediate": the profile takes a mid-level role too.
const MID_LEVEL_TARGET = /\b(?:mid(?:[\s-]?(?:level|weight))?|intermediate)\b(?![\s-]?(?:market|size|cap))/i;

/**
 * Which level gates a profile wants: internships/junior are refused unless the
 * profile targets them (inferProfileMatchingRules rejectInternships), and
 * assistant/mid-level titles only when the primary archetypes or roles name
 * a senior level and no mid level. No targeting → both gates on (CLI and tests).
 */
export function levelPolicyFrom(targeting) {
  if (!targeting) return { rejectInternships: true, belowSenior: true };
  const levels = [
    ...(targeting.archetypes || []).filter((entry) => entry.fit !== 'secondary').map((entry) => `${entry.level} ${entry.name}`),
    ...(targeting.primaryRoles || []),
  ].join(' ');
  return {
    rejectInternships: targeting.rejectInternships !== false,
    belowSenior: SENIOR_LEVEL_WORDS.test(levels) && !MID_LEVEL_TARGET.test(levels),
    ...secondaryScopeFrom(targeting),
  };
}

/** Intern/junior first, then assistant/mid-level, then a secondary role out of scope. One reason or ''. */
export function levelGateReason(title = '', url = '', policy = levelPolicyFrom()) {
  return (policy.rejectInternships ? internOrJuniorReason(title, url) : '')
    || (policy.belowSenior ? belowTargetLevelReason(title) : '')
    || secondaryScopeReason(title, policy);
}

// Words that name a level or the generic occupation, not the scope:
// "Senior AI Product Designer" → design, ai.
const SCOPE_STOPWORDS = new Set(['senior', 'sr', 'junior', 'jr', 'lead', 'staff', 'principal', 'head', 'of', 'founding', 'mid', 'associate', 'product', 'manager', 'owner', 'remote', 'freelance', 'contract', 'fractional', 'the', 'and', 'for']);
// The same occupation under another title.
const OCCUPATION_ALIASES = { 'product manager': ['product owner'] };

/**
 * A secondary archetype ("Product Manager — fit: secondary" on a design-first
 * profile) is a match only in the primary scope: "AI Product Manager" or
 * "Product Manager, Design Systems", not "Product Manager (Fintech)". Jev kept
 * those at 0.5-0.7 although its rules say so (2026-10-13). Nothing when the
 * profile has no secondary archetype or no scope word.
 */
function secondaryScopeFrom(targeting) {
  const primary = [
    ...(targeting.archetypes || []).filter((entry) => !entry.fit || entry.fit === 'primary').map((entry) => entry.name),
    ...(targeting.primaryRoles || []),
  ].map((name) => String(name || '').toLowerCase());
  const secondary = (targeting.archetypes || []).filter((entry) => entry.fit === 'secondary')
    .map((entry) => clean(String(entry.name || '').toLowerCase().replace(FAMILY_QUALIFIERS, ' ')))
    .filter((core) => core.length >= 3 && !primary.some((name) => name.includes(core)));
  const scope = new Set();
  for (const name of primary) {
    for (const word of name.split(/[^a-z]+/).filter((w) => w && !SCOPE_STOPWORDS.has(w))) {
      scope.add(word.length <= 3 ? word : `${word.replace(/(?:ers|er|ing|s)$/, '')}\\w*`);
    }
  }
  // French titles say IA: "Lead Product Manager — IA Médicale" was dropped.
  if (scope.has('ai')) scope.add('ia');
  if (!secondary.length || !scope.size) return {};
  const phrases = secondary.flatMap((core) => [core, ...(OCCUPATION_ALIASES[core] || [])]);
  return {
    secondaryFamily: new RegExp(`\\b(?:${phrases.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')).join('|')})\\b`, 'i'),
    primaryScope: new RegExp(`\\b(?:${[...scope].join('|')})\\b`, 'i'),
    primaryFamily: roleFamilyPattern(targeting),
  };
}

function secondaryScopeReason(title, policy = {}) {
  const { secondaryFamily, primaryScope, primaryFamily } = policy;
  const text = String(title || '');
  if (!secondaryFamily || !secondaryFamily.test(text)) return '';
  if (primaryFamily?.test(text) || primaryScope.test(text)) return '';
  return 'secondary role outside the primary scope';
}

/**
 * A freelance or contract title (detectContract) when the candidate's
 * contract types take neither. profile.yml asks for a salaried role, and
 * "Senior Freelance Product Designer (Fractional)" was force-kept, then
 * scored 4.6 (report 702). No contract types → no mismatch.
 */
export function contractMismatchReason(title = '', contractTypes = []) {
  const contract = detectContract(title);
  const accepted = (contractTypes || []).join(', ');
  if (!['freelance', 'contract'].includes(contract) || !accepted) return '';
  if (/freelance|contract|mission|fractional/i.test(accepted)) return '';
  return `${contract} role, candidate wants ${accepted}`;
}

// Level and qualifier words dropped from an archetype name to get its family
// ("Senior AI Product Designer" → "product designer").
const FAMILY_QUALIFIERS = /\b(senior|sr|junior|jr|lead|staff|principal|head of|founding|mid|associate|ai|genai|remote|freelance|contract|fractional)\b\.?/gi;
// Spellings of the same family word.
const FAMILY_SYNONYMS = [
  [/\b(?:ux\s*\/\s*ui|ui\s*\/\s*ux|ux-ui|ui-ux)\b/, '(?:ux|ui|ux\\s*\\/\\s*ui|ui\\s*\\/\\s*ux|ux-ui|ui-ux|user\\s+experience)'],
  [/\bux\b/, '(?:ux|user\\s+experience)'],
];

function familyWordPattern(word, isLast) {
  for (const [re, pattern] of FAMILY_SYNONYMS) if (re.test(word)) return pattern;
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!isLast) return escaped;
  // designer|design|designers, engineer|engineering, builder|builders.
  const stem = escaped.replace(/(?:ers|er|ing|s)$/, '');
  return `${stem}(?:ers|er|ing|s)?`;
}

/**
 * The role family of the profile's primary archetypes and roles, as one
 * pattern; null when the profile targets nothing.
 */
export function roleFamilyPattern(targeting) {
  if (!targeting) return null;
  const names = [
    ...(targeting.archetypes || []).filter((entry) => !entry.fit || entry.fit === 'primary').map((entry) => entry.name),
    ...(targeting.primaryRoles || []),
  ];
  const cores = new Set();
  for (const name of names) {
    const full = clean(String(name || '').toLowerCase().replace(/[()]/g, ' '));
    const stripped = clean(full.replace(FAMILY_QUALIFIERS, ' '));
    // "AI Engineer" → "engineer" would keep Sales Engineer, "Head of Product"
    // → "product" Product Marketing Manager: a lone family word keeps its qualifiers.
    const words = stripped.split(/\s+/).filter(Boolean);
    const core = words.length === 1 && !qualifierWords(words).length ? full : stripped;
    if (core.length >= 3) cores.add(core.replace(/\s*\/\s*/g, '/'));
  }
  if (!cores.size) return null;
  const alternatives = [...cores].map((core) => {
    const words = core.split(/\s+/);
    return `\\b${words.map((word, i) => familyWordPattern(word, i === words.length - 1)).join('\\s+')}\\b`;
  });
  return new RegExp(alternatives.join('|'), 'i');
}

function overrideOptions(options) {
  // Older callers pass the contract types alone.
  if (Array.isArray(options)) return { contractTypes: options, targeting: null };
  return { contractTypes: options?.contractTypes || [], targeting: options?.targeting || null };
}

/**
 * Jev keep is a hint. A title in the profile's primary role family that is
 * not below the target level, not a contract type the candidate refuses, not
 * an apply/listing page, and not explicit onsite/hybrid in the title must stay
 * in the pipeline even when Jev scores it below threshold. A secondary
 * archetype (e.g. Product Manager for a design-first profile) depends on the
 * product scope, so Jev decides it. No targeting → no override.
 */
export function jevDropOverrideReason(candidate = {}, options = {}) {
  const { contractTypes, targeting } = overrideOptions(options);
  const family = roleFamilyPattern(targeting);
  const title = String(candidate.title || '').trim();
  const url = String(candidate.url || '');
  if (!title || !family) return '';
  if (levelGateReason(title, url, levelPolicyFrom(targeting))) return '';
  if (contractMismatchReason(title, contractTypes)) return '';
  if (listingPageReason(candidate)) return '';
  if (/\/apply(?:\/en)?\/?(?:[?#]|$)/i.test(url)) return '';
  if (/\b(recruiter|talent\s+partner)\b/i.test(title)) return '';
  if (/\b(hybrid|on-?site|onsite|office-based)\b/i.test(title) && !/\bremote\b/i.test(title)) return '';
  if (family.test(title)) return 'target role family';
  // "Design Lead" / "Design Engineer" search terms also match chip, civil
  // and hardware titles (CPU Clock Design Lead, Physical Design Engineer):
  // those are other trades, Jev decides.
  if (NON_PRODUCT_DESIGN.test(title)) return '';
  return searchTermPattern(targeting)?.test(title) ? 'profile search term' : '';
}

/**
 * The profile's own search terms (target_roles.search_terms: Web Designer, UX
 * Researcher, Design Lead…) as one title pattern. The candidate searches for
 * them on purpose, so Jev's "different occupation" reading must not drop them:
 * it kept dropping Web Designers although the profile lists the term.
 */
function searchTermPattern(targeting) {
  // Only terms that name a role ("Web Designer", "Head of Design", "UX/UI"): a
  // topic term ("AI Product", "Product Growth", "Head of AI") would keep any
  // title that merely contains it.
  const ROLE_TERM = /(?:designers?|design|researchers?|engineers?|lead|webdesigners?|webdesign|ux\/ui|ui\/ux|ux[ -]ui|ui[ -]ux)$/i;
  const terms = [...new Set((targeting?.searchTerms || []).map((term) => String(term || '').trim()).filter((term) => term.length >= 4 && ROLE_TERM.test(term)))];
  if (!terms.length) return null;
  const parts = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'));
  return new RegExp(`(?<![\\w])(?:${parts.join('|')})(?![\\w])`, 'i');
}

export function jevEvalOverrideReason({ title = '', url = '', jdText = '', contractTypes = [], targeting = null } = {}) {
  const inFamily = Boolean(jevDropOverrideReason({ title, url }, { contractTypes, targeting }));
  const adjacent = !inFamily && Boolean(adjacentDesignRoleReason({ title, url }, { contractTypes, targeting }));
  if (!inFamily && !adjacent) return '';
  const jd = String(jdText || '');
  if (!jd.trim()) return '';
  // Only binding attendance sentences count: "occasional onsite offsites",
  // "remote or hybrid, your choice" or an HQ blurb mentioning the office used
  // to cancel the override for Senior Product Designer, Docs (Coda, 0.09)
  // and Product Designer (Airapps, 0.05) on 2026-10-19/20. The profile gate
  // already ran its deterministic attendance check before Jev.
  const binding = bindingAttendanceText(jd);
  const attendance = /\b(hybrid|on-?site|onsite|office-based|in[- ]office|must relocate|relocation required)\b/i.test(binding);
  const fullRemote = /\b(?:full(?:y)?[ -]?remote|100\s?% remote|remote[- ]first|work from anywhere|anywhere in the world)\b/i.test(jd);
  if (attendance && !fullRemote) return '';
  return inFamily ? 'role family, no verbatim attendance lock' : 'adjacent design role, no verbatim attendance lock';
}

// Design roles next to the primary product-design archetypes. Jev reads them
// as "a different occupation" too often: in the 7 days to 2026-10-20 it
// dropped Sr. Web Designer (Kraken), Vice President, Experience Designer
// (BNY), UX/UI Designer (Pi R Square, Bangkok), UI/UX Designer (Turba Labs),
// Product Designer (MindFi). A moderate gap from the main search is a review,
// never a silent drop.
const ADJACENT_DESIGN_ROLE = new RegExp([
  String.raw`\b(?:product|ux|ui|user[- ]experience|user[- ]interface|interaction|experience|digital|web|visual|service|conversational|ai|mobile|app|saas|platform|growth|brand)\s+design(?:ers?)?\b`,
  String.raw`\b(?:ux\s*[/&-]\s*ui|ui\s*[/&-]\s*ux)\b`,
  String.raw`\bux\b.{0,20}\b(?:designers?|researchers?|research|lead|architect|writer|strategist|manager)\b`,
  String.raw`\bdesign\s+(?:lead|leader|manager|director|principal|engineer|technologist|systems?|ops|strategist)\b`,
  String.raw`\b(?:head|director|vp|vice\s+president)\s+(?:of\s+)?(?:product\s+)?(?:ux|design)\b`,
  String.raw`\b(?:user|ux)\s+researcher\b`,
  String.raw`\bprototyper\b`,
  String.raw`\bproduct\s*(?:&|and|\/|\+)\s*(?:ux\s+)?design(?:ers?)?\b`,
  String.raw`\bdesign\s*(?:&|and|\/|\+)\s*product\b`,
  String.raw`\b(?:web|ui|ux|product|experience)\s+designer\b`,
  String.raw`\bexperience\s+designer\b`,
].join('|'), 'i');

// "Design" titles from other trades: chips, hardware, buildings, apparel,
// print, learning, games. They stay a Jev drop.
const NON_PRODUCT_DESIGN = /\b(?:electr\w*|electronics?|physical|civil|g[ée]nie|structural|mechanical|cpu|clock|logic|pcb|ecad|asic|fpga|rf|analog|mixed[- ]signal|dft|sta|bim|data\s+cent(?:er|re)|infrastructure|fluid|process\s+design\w*|package|packaging|hardware|silicon|chip|soc|interior|fashion|apparel|garment|footwear|instructional|learning\s+experience|game\s+design\w*|level\s+design\w*|graphic|editorial|print|industrial|landscape|architectural|business\s+analyst|functional\s+design|salesforce\s+developer|lighting|sound|costume|aerospace|automotive|hvac|piping|r\s*&\s*d)\b/i;

/**
 * A design role adjacent to the primary archetypes, with no hard blocker the
 * deterministic gates know (below level, intern/junior, refused contract,
 * listing/apply page, recruiter, title-level hybrid/onsite). Jev scoring it
 * below threshold sends it to review instead of dropping it.
 */
export function adjacentDesignRoleReason(candidate = {}, options = {}) {
  const { contractTypes, targeting } = overrideOptions(options);
  const title = String(candidate.title || '').trim();
  const url = String(candidate.url || '');
  if (!title || !targeting) return '';
  if (!ADJACENT_DESIGN_ROLE.test(title) || NON_PRODUCT_DESIGN.test(title)) return '';
  if (levelGateReason(title, url, levelPolicyFrom(targeting))) return '';
  if (contractMismatchReason(title, contractTypes)) return '';
  if (listingPageReason(candidate)) return '';
  if (/\/apply(?:\/en)?\/?(?:[?#]|$)/i.test(url)) return '';
  if (/\b(recruiter|talent\s+partner|freelance\s+jobs|hire\s+a|best\s+freelance|benchmarks?)\b/i.test(title)) return '';
  // Articles and search pages from web search, not postings.
  if (/\?\s*$|^(?:what|who|how|why|the rise|top \d+|r\/)\b/i.test(title)) return '';
  if (/\b(hybrid|on-?site|onsite|office-based)\b/i.test(title) && !/\bremote\b/i.test(title)) return '';
  return 'adjacent design role';
}

function detectSeniority(title, boosts = []) {
  const lower = String(title || '').toLowerCase();
  for (const boost of keywordList(boosts)) {
    if (lower.includes(boost)) return boost;
  }
  return ['principal', 'director', 'head', 'lead', 'staff', 'senior'].find(rank => new RegExp(`\\b${rank}\\b`, 'i').test(lower)) || '';
}

function detectContract(title) {
  const lower = String(title || '').toLowerCase();
  if (/\bfreelance\b|\bfractional\b/.test(lower)) return 'freelance';
  // "Permanent contract" (WTTJ titles) is permanent, and a CDD is a salaried
  // fixed-term job: neither is a contractor role (contractMismatchReason).
  if (/\bpermanent\b|\bcdi\b/.test(lower)) return 'permanent';
  if (/\bcdd\b|\bfixed[- ]term\b/.test(lower)) return 'fixed-term';
  if (/\bcontract\b|\bmission\b/.test(lower)) return 'contract';
  if (/\bfull[- ]time\b/.test(lower)) return 'permanent';
  return '';
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

// Web-search engines return search, category, profile, article and
// talent-marketplace pages next to postings. The chat-LLM scan prompt used to
// drop them (rule 2b in ui/server.mjs); Jev now owns selection and has no such
// rule, so on 2026-10-02 they took 48 of the 120 Jev slots. A posting has its
// own URL. Real postings that look close and must stay:
// wellfound.com/jobs/<id>-<slug>, remotive.com/remote-jobs/<category>/<slug>-<id>,
// the-dots.com/jobs/<slug>-<id>, linkedin.com/jobs/view/<id>,
// behance.net/joblist/<id>/<slug>, arc.dev/remote-jobs/j/<id>.
// arc.dev/hire-* and arc.dev/remote-jobs/<skill> are employer landing pages
// and role indexes ("The Best Freelance UI/UX Designers for Hire"), not a posting.
const LISTING_URL_PATTERNS = [
  // WeLoveProduct exposes SEO category pages under this path. They contain
  // multiple roles, despite looking like a single product-designer listing.
  /weloveproduct\.co\/(?:product|ux|ui|design)[^/?#]*-jobs(?:-[^/?#]*)?\/?(?:[?#]|$)/i,
  /wellfound\.com\/(role|job-collections|location)\//i,
  /remote\.co\/remote-jobs(?:[/?#]|$)/i,
  /jobsdb\.com\/profiles\//i,
  /remotive\.com\/remote-jobs\/o-/i,
  /the-dots\.com\/users\//i,
  /skima\.ai\/resources\//i,
  /techjobsforgood\.com\/job-title\//i,
  /indeed\.[a-z.]+\/q-[^/?#]*-jobs\.html/i,
  /linkedin\.com\/jobs\/(?!view\/)[^/?#]*-jobs(?:-[^/?#]*)?\/?(?:[?#]|$)/i,
  /builtin\.com\/jobs\//i,
  /arc\.dev\/hire-/i,
  /arc\.dev\/remote-jobs(?!\/j\/)(?:[/?#]|$)/i,
  /toptal\.com\/(?:designers|developers|product-managers|finance|project-managers)\//i,
  /toptal\.com\/freelance-jobs\/[^/?#]+\/[^/?#]+\/?(?:[?#]|$)/i,
  /yunojuno\.com\/(?:sub-disciplines|freelancer-rates)/i,
  /worksome\.com\/profile\//i,
  /lehibou\.com\/(?:[a-z]{2}\/)?freelance(?:\/|$)/i,
  /lehibou\.com\/recherche(?:\/annonces)?\/?(?:[?#]|$)/i,
  /workingnotworking\.com\/(?:search|magazine)\//i,
  /cdn\d*\.workingnotworking\.com\//i,
  /kicklox\.com\/[^/?#]+-freelance\/?(?:[?#]|$)/i,
  /plateforme\.freelance\.com\/(?:job|metier)\//i,
  // Role encyclopedia pages ("Product Designer (UI/UX) — Role Architecture &
  // Career Intelligence"): attributed to Cognigy by a company web query, then an
  // apply run found no form on it (2026-10-17).
  /tinycto\.tv\/tech-careers\//i,
  // Pages that are not postings on any site: salary guides, rate calculators,
  // "hire a designer" landing pages, skill and trade sheets, articles. Seen in
  // the pipeline 2026-10-17 (uiuxjobsboard /salary/, lemon.io /rate-calculator/,
  // contra.com /hire/, yunojuno /skills/, freelancerepublik talks.).
  /\/(?:salary|salaries|salaire|salaires|rate-calculator|hourly-rates?|cost-to-hire|pricing)(?:\/|$|[?#])/i,
  // Only a path segment that STARTS with hire: "…/founding-ai-engineer-contract-to-hire-x1"
  // is a posting slug, not a hire page.
  /\/(?:hire|for-hire|hire-[a-z0-9-]+)(?:\/|$|[?#])/i,
  /\/(?:blog|blogs|article|articles|news|guides?|resources?|insights?|magazine|stories|podcasts?|career-advice|conseils|actualites?|metiers?|fiche-metier|skills|glossary|wiki)(?:\/|$|[?#])/i,
  /^https?:\/\/(?:blog|talks|learn|help|support|docs|news|magazine)\./i,
];

// Search-result titles of those pages: a plural "Jobs" followed by a place,
// a year, a count or the site name ("Product Designer Jobs in Europe - 2026 |
// Wellfound", "ux designer Remote Jobs (597 openings)", "Jobs [Aug 2026]").
// A posting says "Job" at most ("Design Lead - Freelance Job at AKQA").
const LISTING_TITLE_PATTERNS = [
  /\bjobs\b\s*(?:\[|\(|\||,\s*employment\b|\d{4}\b|(?:in|at|for|near|online)\b|$)/i,
  /\b\d+\s+open\s+[^\n]{0,60}\broles?\b/i,
  /\b\d[\d,]*\+?\s+(?:open\s+roles|openings)\b/i,
  /\bjob description\b/i,
  /^(?:\d+|best|top)\s+.*\b(?:jobs|startups|companies)\b/i,
  // "UI/UX Designer Jobs — Vetted Remote Contracts", "Freelance Jobs: Work Remote",
  // "Remote Product Designer Jobs Europe 2026": a plural Jobs then a dash/colon or a year.
  /\bjobs\b\s*[-–—:]/i,
  /\bjobs\b(?:\s+[a-z]+){0,2}\s+(?:19|20)\d\d\b/i,
  // Pay data, hiring guides and trade sheets: "Product Designer Salary Guide 2026",
  // "UX Designer Hourly Rates / Cost to Hire", "Fiche Métier, Salaire & Tjm".
  /\b(?:salary|salaries|salaire|salaires|hourly rates?|cost to hire|rate calculator|tjm|pay guide)\b/i,
  /\bfiche m[eé]tier\b/i,
  /\bhire\s+(?:top\s+|the\s+best\s+)?(?:[\w/&-]+\s+){0,3}(?:designers?|developers?|freelancers?|talents?)\b/i,
  /\bfreelancers?\s+(?:for|in|near|on)\b/i,
  /\boffres?\s+d['’]emploi\s+(?:de|d['’]|en|à)\b/i,
  /\b(?:how to|what is|what are|the rise of|why)\b/i,
];

// Talent-directory copy. These pages sell freelancers to employers. The phrase
// stays decisive even when the URL contains a numeric id (a profile id is not
// a posting id): "Designers for Hire", "Hire Top Remote…", "Découvrez mon profil".
const MARKETPLACE_TITLE_PATTERNS = [
  /\bfor hire\b/i,
  /\bhire top\b/i,
  /\bready to hire\b/i,
  /\bexperts disponibles\b/i,
  /\btrouvez votre\b/i,
  /\bcontractor rates\b/i,
  /\bneed a freelance\b/i,
  /\b\d[\d\s.,]*\s*talents\b/i,
  /\bd[eé]couvrez (?:mon|le) profil\b/i,
];

// A single posting carries its own id in the URL (authenticjobs.com/job/3645/,
// remotive …/ux-designer-3789495, techjobsforgood.com/jobs/34195/, Ashby and
// Lever UUIDs). Board names then sit in its title ("- Authentic Jobs",
// "| Tech Jobs for Good", "- Remote jobs", "@Jobs for Humanity"), so the title
// patterns only judge URLs without an id. A bare year is not an id.
const POSTING_ID = /\d{5,}|(?<!\d)(?!(?:19|20)\d\d(?!\d))\d{4}(?!\d)|[0-9a-f]{8}-[0-9a-f]{4}-/i;

export function listingPageReason(candidate = {}) {
  const url = String(candidate.url || '');
  if (LISTING_URL_PATTERNS.some(re => re.test(url))) return 'not a job posting (listing or profile URL)';
  const title = String(candidate.title || '');
  if (MARKETPLACE_TITLE_PATTERNS.some(re => re.test(title))) {
    return 'not a job posting (talent directory or profile)';
  }
  if (!POSTING_ID.test(url) && LISTING_TITLE_PATTERNS.some(re => re.test(title))) {
    return 'not a job posting (listing page title)';
  }
  return '';
}

/**
 * portals.yml `excluded_domains`: platforms the user never wants in a scan
 * (paywalled boards, paid-bid marketplaces, app-store apply links). A posting
 * whose host is one of them or a subdomain of one is rejected, whatever the
 * source that surfaced it (web search, API, feed).
 */
export function excludedDomainReason(url = '', domains = []) {
  if (!Array.isArray(domains) || !domains.length) return '';
  let host = '';
  try { host = new URL(String(url)).hostname.toLowerCase().replace(/^www./, ''); } catch { return ''; }
  const hit = domains
    .map((domain) => String(domain || '').trim().toLowerCase().replace(/^www./, ''))
    .find((domain) => domain && (host === domain || host.endsWith(`.${domain}`)));
  return hit ? `excluded domain (${hit})` : '';
}

/**
 * Full pre-Jev decision. `locationAllows` / `countryAllows` are the CLI predicates
 * so both engines share them instead of reimplementing location and country.
 * `locationProfile` (lib/candidate-location.mjs) lets a posting located in one
 * of the candidate's on-site exceptions through its hybrid/on-site words.
 */
export const UNDATED_REVIEW_REASON = 'web search hit with no publication date';

// A review candidate held only for its missing date; an ambiguous remote
// signal stays the check to make first.
export function isUndatedReview(candidate = {}) {
  return (candidate.reasons || []).includes(UNDATED_REVIEW_REASON) && candidate.remoteDisposition !== 'review';
}

export const IDENTITY_MISSING = 'identity missing';

export function evaluateCandidate(candidate = {}, portalsConfig = {}, options = {}) {
  const today = options.today || new Date().toISOString().slice(0, 10);
  const onsiteException = onsiteExceptionOf(candidate, options.locationProfile);
  // portals.yml's attendance filters ("hybrid", "on-site" title words, the
  // strict full-remote mode) are the owner's full-remote policy. A candidate
  // whose profile takes hybrid or on-site work (not full remote only) keeps
  // those postings; Jev and the evaluation weigh them against that policy.
  const attendanceOpen = options.locationProfile?.fullRemoteOnly === false;
  const titleFilter = portalsConfig.title_filter || {};
  // No title (identity not extracted): the title filter has nothing to read,
  // so it does not reject; the posting goes to review (identity missing).
  const untitled = !String(candidate.title ?? '').trim();
  const title = untitled ? { ok: true, matched: null, blockedBy: null, via: 'untitled', reason: IDENTITY_MISSING } : explainTitle(candidate.title, onsiteException || attendanceOpen
    ? { ...titleFilter, negative: keywordList(titleFilter.negative).filter((word) => !ATTENDANCE_TERM.test(word)) }
    : titleFilter);
  const remote = assessRemote(
    candidate,
    portalsConfig.remote_filter || {},
    portalsConfig.country_eligibility_filter?.inclusive || [],
    options.geoPolicy || null,
    onsiteException,
    { attendanceOpen },
  );
  const reasons = [];
  let reasonCode = 'ok';
  let disposition = 'keep';
  const excluded = excludedDomainReason(candidate.url, portalsConfig.excluded_domains);
  const listing = listingPageReason(candidate);
  // options.levelPolicy comes from the profile (levelPolicyFrom); without one
  // both level gates stay on.
  const level = title.ok ? levelGateReason(candidate.title, candidate.url, options.levelPolicy || levelPolicyFrom()) : '';

  if (excluded) {
    disposition = 'reject';
    reasonCode = 'excluded_domain';
    reasons.push(excluded);
  } else if (candidate.postingClosed) {
    // Set by the scan's date lookup: the board API no longer has the posting.
    disposition = 'reject';
    reasonCode = 'closed';
    reasons.push('posting gone from its board API');
  } else if (listing) {
    disposition = 'reject';
    reasonCode = 'listing';
    reasons.push(listing);
  } else if (!title.ok) {
    disposition = 'reject';
    reasonCode = 'title';
    reasons.push(title.reason);
  } else if (level) {
    // Same rule the pipeline applies before Jev (dropInternPipelineItems):
    // rejecting here spares the Jev call.
    disposition = 'reject';
    reasonCode = 'level';
    reasons.push(level);
  } else if (remote.disposition === 'reject') {
    disposition = 'reject';
    reasonCode = 'remote';
    reasons.push(remote.reason);
  // A posting located in one of the candidate's on-site exceptions (Bangkok)
  // is where they can work: portals.yml lists countries, so a bare "Khlong Toei,
  // Bangkok" (JobsDB) failed allow: [thailand] - 122 rejects in a week.
  } else if (!onsiteException && typeof options.locationAllows === 'function' && !options.locationAllows(candidate, {
    // Remote with an allowed geography (strict mode's 0.95, or a JD phrase
    // opening a rejected geo at 0.8): a city-only location is then the
    // employer's office, not where the role sits ("London", Synthesia
    // "Europe remote or London hybrid", 2026-10-17).
    remoteConfirmed: remote.disposition === 'keep' && remote.confidence >= 0.8,
  })) {
    disposition = 'reject';
    reasonCode = 'location';
    reasons.push('location_filter rejected');
  } else if (typeof options.countryAllows === 'function' && !options.countryAllows(candidate)) {
    disposition = 'reject';
    reasonCode = 'country';
    reasons.push('country_eligibility_filter rejected');
  }

  const freshness = assessFreshness({
    publishedAt: resolvePublishedDate(candidate, today),
    firstSeen: typeof options.firstSeenFor === 'function' ? options.firstSeenFor(candidate) : (options.firstSeen || ''),
    maxAgeDays: portalsConfig.scan_max_age_days,
    today,
  });
  if (disposition !== 'reject' && !freshness.ok) {
    disposition = 'reject';
    reasonCode = 'age';
    reasons.push(freshness.reason);
  }

  if (disposition !== 'reject' && (remote.disposition === 'review' || remote.disposition === 'keep_but_downrank')) {
    disposition = remote.disposition === 'keep_but_downrank' ? 'keep' : 'review';
    reasons.push(remote.reason);
  } else if (disposition !== 'reject') {
    reasons.push(title.reason);
    if (remote.reason) reasons.push(remote.reason);
  }
  if (freshness.reason && disposition !== 'reject') reasons.push(freshness.reason);
  // A web-search hit is undated far more often than a board row (154 of 159,
  // 2026-10-07..15), and the undated ones were often months old: review, not
  // a validated match.
  if (untitled && disposition === 'keep') {
    disposition = 'review';
    reasons.push(IDENTITY_MISSING);
  }
  if (disposition === 'keep' && candidate.webSearch && freshness.source === 'proxy') {
    disposition = 'review';
    reasons.push(UNDATED_REVIEW_REASON);
  }

  const seniority = detectSeniority(candidate.title, portalsConfig.title_filter?.seniority_boost);
  const titleScore = title.ok ? (seniority ? 1 : 0.8) : 0;
  const remoteScore = disposition === 'reject' && reasonCode === 'remote' ? 0 : remote.confidence;
  const freshScore = freshness.ok ? freshness.freshness : 0;
  const overall = disposition === 'reject' ? 0 : round3(titleScore * 0.45 + remoteScore * 0.35 + freshScore * 0.2);
  const contract = detectContract(candidate.title);
  const geo = clean(candidate.location || remote.evidence);
  const matched = [title.matched, remote.evidence, seniority, contract].filter(Boolean);

  return {
    disposition,
    reasonCode,
    reasons,
    remote,
    freshness,
    title,
    scores: { title: titleScore, remote: remoteScore, freshness: freshScore, overall },
    signals: {
      seniority,
      contract,
      geo,
      matchedTitle: title.matched || '',
      matchedConstraints: matched.join(', '),
    },
  };
}

export function attachDecision(candidate, decision) {
  return {
    ...candidate,
    disposition: decision.disposition,
    reasonCode: decision.reasonCode,
    reasons: decision.reasons,
    remoteDisposition: decision.remote.disposition,
    remoteConfidence: decision.scores.remote,
    remoteReason: decision.remote.reason,
    remoteEvidence: candidate.remoteEvidence || decision.remote.evidence || candidate.location || '',
    preScore: decision.scores.overall,
    scores: decision.scores,
    dateSource: decision.freshness.source,
    publishedAt: candidate.publishedAt || decision.freshness.publishedAt || '',
    proxySeen: decision.freshness.proxySeen || '',
    proxyExpiresAt: decision.freshness.proxyExpiresAt || '',
    seniority: decision.signals.seniority,
    contract: decision.signals.contract,
    geoSignals: decision.signals.geo,
    matchedConstraints: decision.signals.matchedConstraints,
  };
}

export function partitionCandidates(candidates = [], portalsConfig = {}, options = {}) {
  const kept = [];
  const review = [];
  const rejected = [];
  for (const candidate of candidates) {
    const decision = evaluateCandidate(candidate, portalsConfig, options);
    const enriched = attachDecision(candidate, decision);
    if (decision.disposition === 'reject') rejected.push(enriched);
    else if (decision.disposition === 'review') review.push(enriched);
    else kept.push(enriched);
  }
  return { kept, review, rejected };
}

function rosterRank(item) {
  const published = item.publishedAt || '';
  return [
    Number(item.preScore) || 0,
    Number(item.scores?.freshness) || 0,
    published,
  ];
}

/**
 * Pick the Jev roster by pre-score, with a per-source cap so one board
 * cannot fill the window just by arriving first.
 */
export function selectRoster(candidates = [], { limit = 120, maxShare = 0.2 } = {}) {
  const cap = Math.max(1, Math.floor(limit * maxShare));
  const ranked = [...candidates].sort((a, b) => {
    const [aScore, aFresh, aDate] = rosterRank(a);
    const [bScore, bFresh, bDate] = rosterRank(b);
    return bScore - aScore || bFresh - aFresh || String(bDate).localeCompare(String(aDate));
  });
  const perSource = new Map();
  const selected = [];
  const deferred = [];
  for (const item of ranked) {
    const source = item.source || 'unknown';
    const used = perSource.get(source) || 0;
    if (used >= cap) {
      deferred.push(item);
      continue;
    }
    selected.push(item);
    perSource.set(source, used + 1);
    if (selected.length >= limit) break;
  }
  if (selected.length < limit) {
    for (const item of deferred) {
      if (selected.length >= limit) break;
      selected.push(item);
    }
  }
  const selectedUrls = new Set(selected.map(item => item.url));
  return {
    selected,
    omitted: ranked.filter(item => !selectedUrls.has(item.url)),
    perSourceCap: cap,
  };
}

export function canonicalJobUrl(url) {
  return normalizeUrl(url) || clean(url);
}

export function companyKey(name) {
  return clean(name).toLowerCase().replace(/[()]/g, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

// Level, place and contract words say nothing about which job it is. Counting
// them made "Senior Product Manager" and "Senior Product Designer" share two
// words, so a tracked or deleted PM row hid every design role at that company.
// "lead" and "head" stay: in "Design Lead" or "Head of Design" they are the role.
const GENERIC_ROLE_WORDS = new Set([
  'senior', 'sr', 'junior', 'jr', 'staff', 'principal', 'associate', 'intern', 'founding',
  'confirmed', 'confirme', 'experienced', 'mid', 'level', 'remote', 'hybrid',
  'onsite', 'europe', 'emea', 'global', 'worldwide', 'full', 'time', 'fulltime', 'part',
  'contract', 'freelance', 'permanent', 'months',
  // glue words and gender tags ("m/f/d", "H/F")
  'of', 'the', 'and', 'for', 'to', 'in', 'at', 'on', 'with', 'from', 'all', 'de', 'du', 'la',
  'le', 'les', 'des', 'en', 'et', 'au', 'hf', 'fh', 'mf', 'fm', 'mfd', 'mwd', 'fmd', 'wmd',
]);
// Two titles naming different jobs are different roles whatever else they share.
const ROLE_NOUNS = new Set([
  'designer', 'manager', 'engineer', 'developer', 'researcher', 'owner', 'architect',
  'scientist', 'analyst', 'consultant', 'writer', 'strategist', 'specialist', 'marketer',
  'recruiter', 'counsel', 'accountant', 'administrator',
]);

// Words that only name the job family. A title made of them alone ("Product
// Manager") says nothing about which opening it is, so it must not swallow
// "Product Manager, Growth": Glean had five such openings behind one row.
const FAMILY_WORDS = new Set([
  ...ROLE_NOUNS, 'product', 'design', 'ux', 'ui', 'ai', 'ml', 'lead', 'head', 'chief',
  'director', 'technical', 'digital', 'visual', 'interaction', 'experience', 'user',
  'creative', 'software', 'web',
]);

function qualifierWords(words) {
  return words.filter(word => !FAMILY_WORDS.has(word) && !FAMILY_WORDS.has(word.replace(/s$/, '')));
}

// Short words (UX, UI, AI, PM) count, so "Senior UX Designer" still equals
// itself once "senior" is gone; numbers ("100 % remote") do not.
function roleWords(value) {
  return clean(value).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
    .filter(word => word.length >= 2 && !/^\d+$/.test(word) && !GENERIC_ROLE_WORDS.has(word));
}

// "design" inside "designer" is the same word; "ai" inside "retail" is not.
function sameRoleWord(a, b) {
  return a === b || (a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a)));
}

/**
 * Same role at one company: every meaningful word of the shorter title is in
 * the other ("Product Designer" = "Senior Product Designer (UI/UX)"), and a
 * bare family title only equals another bare one. Sharing two words was not
 * enough: "Product Designer, Evals & Prompts" matched "Product Designer,
 * Design Systems", and "Technical Product Lead - AI Finance" matched
 * "… - AI Neobank".
 */
export function rolesLikelySame(a, b) {
  const left = roleWords(a);
  const right = roleWords(b);
  if (!left.length || !right.length) return false;
  const leftNouns = left.filter(word => ROLE_NOUNS.has(word));
  const rightNouns = right.filter(word => ROLE_NOUNS.has(word));
  if (leftNouns.length && rightNouns.length && !leftNouns.some(word => rightNouns.includes(word))) return false;
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  const found = shorter.filter(word => longer.some(other => sameRoleWord(word, other)));
  if (found.length !== shorter.length || (shorter.length < 2 && longer.length !== 1)) return false;
  return qualifierWords(shorter).length > 0 || qualifierWords(longer).length === 0;
}

function titleKey(title) {
  return clean(title).toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * One board often republishes the same title in every country. Location
 * filtering has already run, so the copies that remain are interchangeable.
 * Keep the first survivor for each source + exact title.
 */
export function collapseDuplicateTitles(candidates = []) {
  const seen = new Set();
  const kept = [];
  for (const candidate of candidates) {
    const title = titleKey(candidate.title);
    const source = clean(candidate.source || candidate.company).toLowerCase();
    const key = title ? `${source}\n${title}` : '';
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    kept.push(candidate);
  }
  return kept;
}

export function dedupeCandidates(candidates = []) {
  const seenUrls = new Set();
  const seenRoles = [];
  const kept = [];
  for (const candidate of candidates) {
    const urlKey = canonicalJobUrl(candidate.url);
    if (urlKey && seenUrls.has(urlKey)) continue;
    const company = companyKey(candidate.company);
    const fuzzy = company && seenRoles.some(entry => entry.company === company && rolesLikelySame(entry.title, candidate.title));
    if (fuzzy) continue;
    if (urlKey) seenUrls.add(urlKey);
    if (company && candidate.title) seenRoles.push({ company, title: candidate.title });
    kept.push({ ...candidate, normalizedUrl: urlKey || candidate.normalizedUrl || '' });
  }
  return kept;
}

export function decisionLogRecord(candidate, extra = {}) {
  return {
    ts: new Date().toISOString(),
    url: candidate.url || '',
    title: candidate.title || '',
    company: candidate.company || '',
    source: candidate.source || '',
    engine: candidate.engine || '',
    disposition: candidate.disposition || extra.disposition || '',
    reasonCode: candidate.reasonCode || extra.reasonCode || '',
    reasons: candidate.reasons || extra.reasons || [],
    scores: candidate.scores || {
      title: null,
      remote: candidate.remoteConfidence ?? null,
      freshness: null,
      overall: candidate.preScore ?? null,
    },
    remoteDisposition: candidate.remoteDisposition || '',
    dateSource: candidate.dateSource || '',
    jev: extra.jev || 'not_sent',
    seniority: candidate.seniority || '',
    contract: candidate.contract || '',
    geo: candidate.geoSignals || candidate.location || '',
    matchedConstraints: candidate.matchedConstraints || '',
  };
}

export function appendDecisionLog(filePath, records = []) {
  if (!filePath || !records.length) return;
  mkdirSync(path.dirname(filePath), { recursive: true });
  appendFileSync(filePath, `${records.map(record => JSON.stringify(record)).join('\n')}\n`);
}

export function summarizeDecisions(records = []) {
  const counts = {};
  for (const record of records) {
    const key = `${record.disposition || '?'}:${record.reasonCode || record.jev || '?'}`;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

export function runTitleDryRun({ portalsPath, profilePath, examplesPath } = {}) {
  const portals = loadPortalsForProfile(portalsPath, profilePath);
  const examples = yaml.load(readFileSync(
    examplesPath || path.join(path.dirname(fileURLToPath(import.meta.url)), 'scan-title-examples.yml'),
    'utf-8',
  )) || {};
  const rows = [];
  let mismatches = 0;
  // The scan gate is the title filter plus the level rule (evaluateCandidate).
  const gate = (title) => {
    const result = explainTitle(title, portals.title_filter || {});
    const level = result.ok ? levelGateReason(title, '') : '';
    return level ? { ...result, ok: false, reason: level } : result;
  };
  for (const title of examples.accepted || []) {
    const result = gate(title);
    const ok = result.ok === true;
    if (!ok) mismatches += 1;
    rows.push({ title, expected: 'accept', ok, detail: result.reason });
  }
  for (const title of examples.rejected || []) {
    const result = gate(title);
    const ok = result.ok === false;
    if (!ok) mismatches += 1;
    rows.push({ title, expected: 'reject', ok, detail: result.reason });
  }
  return { rows, mismatches, accepted: (examples.accepted || []).length, rejected: (examples.rejected || []).length };
}

if (isMainModule(import.meta.url)) {
  const dryRun = process.argv.includes('--dry-run');
  if (!dryRun) {
    console.error('Usage: node lib/scan-decision.mjs --dry-run');
    process.exitCode = 1;
  } else {
    const result = runTitleDryRun();
    for (const row of result.rows) {
      console.log(`${row.ok ? 'OK' : 'MISMATCH'}\t${row.expected}\t${row.title}\t${row.detail}`);
    }
    console.log(`examples ${result.accepted + result.rejected}, mismatches ${result.mismatches}`);
    if (result.mismatches) process.exitCode = 1;
  }
}
