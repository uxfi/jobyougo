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
import { getJobYouGoRoot } from '../path-resolver.mjs';
import { isMainModule } from './is-main-module.mjs';
import { geoRejectCanWiden } from './remote-geo-widen.mjs';

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
 * and is not mixed with validated strict-remote offers.
 */
export function assessRemote(candidate = {}, remoteFilterRaw = {}, inclusivePhrases = []) {
  const remoteFilter = normalizeRemotePolicy(remoteFilterRaw);
  const strictMode = remoteFilter.mode === 'strict_full_remote_only';
  const titleText = clean(candidate.title);
  const locationText = clean(candidate.location);
  const evidenceText = clean(candidate.remoteEvidence);
  const urlText = clean(candidate.url);
  const descriptionText = clean(candidate.description).slice(0, 4000);
  const remoteSignalText = [titleText, locationText, evidenceText, urlText].filter(Boolean).join(' | ');
  const geoSignalText = [locationText, evidenceText, urlText].filter(Boolean).join(' | ');
  const rejectSignalText = [remoteSignalText, descriptionText].filter(Boolean).join(' | ');
  const lower = normalizeMatchText(remoteSignalText);
  const rejectLower = normalizeMatchText(rejectSignalText);
  const geoLower = normalizeMatchText(geoSignalText);
  const titleLower = normalizeMatchText(titleText);

  const rejectedMatch = firstPhraseMatch(rejectLower, [...remoteFilter.rejectedAny, ...DEFAULT_REJECTED_REMOTE]);
  if (rejectedMatch) {
    return remoteResult('reject', 0, `rejected remote term "${rejectedMatch}"`, rejectedMatch);
  }
  if (!strictMode) {
    return remoteResult('keep', 0.7, 'remote filter not strict', '');
  }

  const requiredMatch = firstPhraseMatch(lower, remoteFilter.requiredAny);
  if (!requiredMatch) {
    const amb = ambiguousRemote(remoteFilter.ambiguousPolicy);
    return remoteResult(amb.disposition, amb.confidence, 'remote status is ambiguous', '');
  }

  const descLower = normalizeMatchText(descriptionText);
  const usJdHit = firstPhraseMatch(descLower, US_JD_PHRASES);
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
  const allowedPool = [...remoteFilter.allowedGeoAny, ...DEFAULT_ALLOWED_GEO];
  const allowedGeoMatch = firstPhraseMatch(geoLower, allowedPool)
    || firstPhraseMatch(titleGeoTerms.join(' '), allowedPool);
  const rejectedGeoMatch = firstPhraseMatch(lower, [...remoteFilter.rejectedGeoAny, ...DEFAULT_REJECTED_GEO]);
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
      `remote "${requiredMatch}" and geo "${allowedGeoMatch}"`,
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
    return new Date(value).toISOString().slice(0, 10);
  }
  const raw = clean(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
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

export function assessFreshness({ publishedAt, firstSeen, maxAgeDays, today }) {
  const windowDays = Number(maxAgeDays);
  const bounded = Number.isFinite(windowDays) && windowDays > 0 ? windowDays : 0;
  const published = coerceIsoDate(publishedAt);
  if (published) {
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
  if (/\bcontract\b|\bmission\b|\bcdd\b/.test(lower)) return 'contract';
  if (/\bpermanent\b|\bcdi\b|\bfull[- ]time\b/.test(lower)) return 'permanent';
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
  /wellfound\.com\/(role|job-collections|location)\//i,
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
];

// Search-result titles of those pages: a plural "Jobs" followed by a place,
// a year, a count or the site name ("Product Designer Jobs in Europe - 2026 |
// Wellfound", "ux designer Remote Jobs (597 openings)", "Jobs [Aug 2026]").
// A posting says "Job" at most ("Design Lead - Freelance Job at AKQA").
const LISTING_TITLE_PATTERNS = [
  /\bjobs\b\s*(?:\[|\(|\||,\s*employment\b|\d{4}\b|(?:in|at|for|near)\b|$)/i,
  /\b\d[\d,]*\+?\s+(?:open\s+roles|openings)\b/i,
  /\bjob description\b/i,
  /^(?:\d+|best|top)\s+.*\b(?:jobs|startups|companies)\b/i,
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
 * Full pre-Jev decision. `locationAllows` / `countryAllows` are the CLI predicates
 * so both engines share them instead of reimplementing location and country.
 */
export function evaluateCandidate(candidate = {}, portalsConfig = {}, options = {}) {
  const today = options.today || new Date().toISOString().slice(0, 10);
  const title = explainTitle(candidate.title, portalsConfig.title_filter || {});
  const remote = assessRemote(
    candidate,
    portalsConfig.remote_filter || {},
    portalsConfig.country_eligibility_filter?.inclusive || [],
  );
  const reasons = [];
  let reasonCode = 'ok';
  let disposition = 'keep';
  const listing = listingPageReason(candidate);

  if (listing) {
    disposition = 'reject';
    reasonCode = 'listing';
    reasons.push(listing);
  } else if (!title.ok) {
    disposition = 'reject';
    reasonCode = 'title';
    reasons.push(title.reason);
  } else if (remote.disposition === 'reject') {
    disposition = 'reject';
    reasonCode = 'remote';
    reasons.push(remote.reason);
  } else if (typeof options.locationAllows === 'function' && !options.locationAllows(candidate)) {
    disposition = 'reject';
    reasonCode = 'location';
    reasons.push('location_filter rejected');
  } else if (typeof options.countryAllows === 'function' && !options.countryAllows(candidate)) {
    disposition = 'reject';
    reasonCode = 'country';
    reasons.push('country_eligibility_filter rejected');
  }

  const freshness = assessFreshness({
    publishedAt: candidate.publishedAt || candidate.postedAt,
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

export function runTitleDryRun({ portalsPath, examplesPath } = {}) {
  const root = getJobYouGoRoot();
  const portals = yaml.load(readFileSync(portalsPath || path.join(root, 'portals.yml'), 'utf-8')) || {};
  const examples = yaml.load(readFileSync(
    examplesPath || path.join(path.dirname(fileURLToPath(import.meta.url)), 'scan-title-examples.yml'),
    'utf-8',
  )) || {};
  const rows = [];
  let mismatches = 0;
  for (const title of examples.accepted || []) {
    const result = explainTitle(title, portals.title_filter || {});
    const ok = result.ok === true;
    if (!ok) mismatches += 1;
    rows.push({ title, expected: 'accept', ok, detail: result.reason });
  }
  for (const title of examples.rejected || []) {
    const result = explainTitle(title, portals.title_filter || {});
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
