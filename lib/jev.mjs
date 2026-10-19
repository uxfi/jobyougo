/**
 * TypeSafe Jev via OpenRouter Decisions API.
 * Structured keep/drop / score decisions — not text generation.
 * POST https://openrouter.ai/api/alpha/decisions
 */
import 'dotenv/config';
import { recordAiUsageEvent } from './ai-usage-log.mjs';
import { clipJd } from './prompt-budget.mjs';
import { cleanJobDescriptionText } from './jd-clean.mjs';
import { isUndatedReview, jevDropOverrideReason, jevEvalOverrideReason } from './scan-decision.mjs';
import { pipelineNoteCompany } from './pipeline-record.mjs';

const API_KEY = process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_ADMIN_KEY;
const DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions';

export const JEV_MODEL = process.env.JEV_MODEL || '~typesafe/jev-latest';
export const JEV_KEEP_THRESHOLD = Number(process.env.JEV_KEEP_THRESHOLD || 0.4);
export const JEV_EVAL_THRESHOLD = Number(process.env.JEV_EVAL_THRESHOLD || 0.5);
export const JEV_CONCURRENCY = Math.max(1, Number(process.env.JEV_CONCURRENCY || 6));
export const JEV_SCAN_LIMIT = Math.max(1, Number(process.env.JEV_SCAN_LIMIT || 120));

const HEADERS = () => ({
  Authorization: `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
  'HTTP-Referer': 'https://jobyougo.xyz',
  'X-Title': 'JobYouGo',
});

function clean(value) {
  return String(value || '').trim();
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * @param {{ state: string|object|array, questions: object, model?: string, timeoutMs?: number }} opts
 * @returns {Promise<{ model: string, answers: object, usage?: object, id?: string, raw: object }>}
 */
export async function decide({ state, questions, model = JEV_MODEL, timeoutMs = 60_000 } = {}) {
  if (!API_KEY) throw new Error('OPENROUTER_API_KEY or OPENROUTER_ADMIN_KEY is not set in .env');
  if (state == null) throw new Error('jev.decide: state is required');
  if (!questions || typeof questions !== 'object') throw new Error('jev.decide: questions is required');

  const res = await fetch(DECISIONS_URL, {
    method: 'POST',
    headers: HEADERS(),
    body: JSON.stringify({ model, state, questions }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Jev Decisions HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  if (!res.ok) {
    throw new Error(`Jev Decisions HTTP ${res.status}: ${text.slice(0, 400)}`);
  }

  const usage = json.usage || {};
  await recordAiUsageEvent({
    provider: 'openrouter',
    source: 'openrouter-decisions',
    model: json.model || model,
    generation_id: json.id || null,
    input_tokens: num(usage.input_tokens),
    output_tokens: num(usage.output_tokens),
    total_tokens: num(usage.input_tokens) + num(usage.output_tokens),
    cost_usd: typeof usage.cost === 'number' ? usage.cost : null,
    estimated: false,
    streamed: false,
  }).catch(() => {});

  return {
    model: json.model || model,
    answers: json.answers || {},
    usage,
    id: json.id || null,
    raw: json,
  };
}

export function classifyJevOutcome({ keepProb = null, error = '', threshold = JEV_KEEP_THRESHOLD } = {}) {
  if (error || keepProb == null) return 'unverified';
  return keepProb >= threshold ? 'validated' : 'dropped';
}

export function noulFromAnswers(answers = {}, key = 'keep') {
  const block = answers?.[key];
  if (!block || block.type !== 'noul') return null;
  const n = Number(block.noul);
  return Number.isFinite(n) ? n : null;
}

export function scoreFromAnswers(answers = {}, key = 'fit') {
  const block = answers?.[key];
  if (!block || block.type !== 'score') return null;
  const n = Number(block.score);
  return Number.isFinite(n) ? n : null;
}

// The lines that decide a keep/drop: where, how (remote, hybrid, office),
// who may apply. In an ATS body they usually sit after the company blurb and
// the benefits ("LOCATION On-site in New York", Clera; "WORK MODEL FOR THIS
// ROLE - Hybrid", Nubank), past the first 1,200 characters Jev used to get.
// The level is left out: the title carries it, and "lead" or "senior" turn up
// in every other sentence of a JD.
const DECISIVE_LINE = /\b(?:remote|hybrid|on-?site|in[- ]office|office|locat\w*|based in|work(?:ing)? (?:model|mode|from)|time ?zones?|relocat\w*|visa|sponsor\w*|authori[sz]ed to work|work permit|citizens?|residen\w*|eligib\w*|countr(?:y|ies)|years? of experience|contract|freelance|full[- ]time|part[- ]time|cdi|cdd)\b/i;
const EXCERPT_HEAD = 500;
const EXCERPT_MAX = 2000;

/** Opening lines plus every decisive line, in order, up to EXCERPT_MAX characters. */
export function jevDescriptionExcerpt(description = '') {
  const text = clean(description).replace(/\s+/g, ' ');
  if (text.length <= EXCERPT_MAX) return text;
  const head = text.slice(0, EXCERPT_HEAD).replace(/\s+\S*$/, '');
  const picked = [];
  let size = head.length;
  for (const line of text.slice(head.length).split(/(?<=[.!?])\s+|\s+[-•·]\s+/)) {
    const sentence = line.trim();
    if (!sentence || !DECISIVE_LINE.test(sentence)) continue;
    const piece = sentence.length > 300 ? `${sentence.slice(0, 300)}…` : sentence;
    if (size + piece.length + 3 > EXCERPT_MAX) break;
    picked.push(piece);
    size += piece.length + 3;
  }
  return picked.length ? `${head} … ${picked.join(' … ')}` : text.slice(0, EXCERPT_MAX);
}

const LEVEL_WORDS = ['Junior', 'Mid', 'Senior', 'Lead', 'Staff', 'Principal', 'Head', 'Director', 'VP'];

/**
 * Seniority the candidate targets, from the levels of the primary archetypes
 * and the primary role titles ("Senior/Lead" for the 2026-10 profile).
 */
export function candidateTargetLevel(targeting = {}) {
  const text = [
    ...(targeting.archetypes || []).filter(entry => entry.fit === 'primary').map(entry => entry.level),
    ...(targeting.primaryRoles || []),
  ].join(' ');
  return LEVEL_WORDS.filter(word => new RegExp(`\\b${word}\\b`, 'i').test(text)).join('/');
}

export function buildCandidateProfileState(candidate = {}, profileRules = {}) {
  const location = profileRules.location || {};
  const targeting = profileRules.targeting || {};
  const search = profileRules.search || {};
  return {
    title: clean(candidate.title),
    company: clean(candidate.company),
    location: clean(candidate.location),
    remote_evidence: clean(candidate.remoteEvidence),
    source: clean(candidate.source || candidate.engine),
    published_at: clean(candidate.publishedAt),
    url: clean(candidate.url),
    description_excerpt: jevDescriptionExcerpt(candidate.description),
    remote_disposition: clean(candidate.remoteDisposition),
    remote_confidence: candidate.remoteConfidence ?? '',
    remote_reason: clean(candidate.remoteReason),
    geo_signals: clean(candidate.geoSignals || candidate.location),
    seniority: clean(candidate.seniority),
    contract: clean(candidate.contract),
    date_source: clean(candidate.dateSource),
    pre_score: candidate.preScore ?? '',
    matched_constraints: clean(candidate.matchedConstraints),
    // authorized_in plus the countries of the bases (a legacy profile has an
    // empty authorized_in and would otherwise read as authorized nowhere).
    candidate_authorized_in: [...new Set([...(location.authorizedIn || []), ...(location.loc?.bases || []).map(base => base.country)].filter(Boolean))],
    candidate_remote_policy: location.remotePolicy || (location.fullRemoteOnly ? 'full remote only' : ''),
    candidate_full_remote_only: Boolean(location.fullRemoteOnly),
    candidate_no_relocation: Boolean(location.noRelocation),
    candidate_target_roles: targeting.primaryRoles || [],
    candidate_search_terms: targeting.searchTerms || [],
    // Strings, like the other candidate_* lists the Decisions API already takes.
    candidate_archetypes: (targeting.archetypes || [])
      .map(({ name, level, fit }) => `${name} — level: ${level || 'unspecified'} — fit: ${fit}`),
    candidate_target_level: candidateTargetLevel(targeting),
    candidate_must_haves: search.mustHaves || [],
    candidate_deal_breakers: search.dealBreakers || [],
    candidate_geography_preferences: search.geographyPreferences || [],
    candidate_contract_types: search.contractTypes || [],
    candidate_sector_preferences: search.sectorPreferences || [],
    candidate_compensation_minimum: clean(profileRules.compensation?.minimum),
    candidate_years_experience: targeting.yearsExperience || candidate.yearsExperience || '',
    candidate_reject_internships: targeting.rejectInternships !== false,
    // Where the candidate works from and where on-site work is still fine
    // (lib/candidate-location.mjs through inferProfileMatchingRules).
    candidate_bases: (location.loc?.bases || [])
      .map(base => [base.label, base.timezoneLabel, base.default ? 'default base' : `for ${base.regions.join('/')} offers`].filter(Boolean).join(' — ')),
    candidate_onsite_exceptions: location.onsitePlaces || [],
    candidate_offsite_travel_ok: Boolean(location.loc?.travel?.offsites),
    candidate_nationality: clean(profileRules.candidate?.nationality),
  };
}

// Shared by the keep and eval-gate questions. The roles come from the state
// (profile.yml archetypes), not from a list here: until 2026-10-13 the text
// said "Product Manager … prefer keep" for every profile, and a design-first
// candidate got Product Pricing Manager and Technical Product Owner offers.
// Intern/junior/assistant/mid-level titles never reach Jev (levelGateReason).
const ROLE_RULES = [
  'Read the targeting from the state: candidate_archetypes (entries "name — level — fit: primary|secondary"), candidate_target_roles, candidate_target_level and candidate_contract_types.',
  'A title in the family of a fit: primary archetype is a strong match even without a level word in the title: a short title (e.g. "Product Design" for a Product Designer archetype, "Backend" for a Backend Engineer one) is never a reject for being short. AI is a qualifier, not a requirement.',
  'A title from a fit: secondary archetype matches only when its scope overlaps the domain of the primary archetypes. For a design-first candidate with a secondary Product Manager archetype, a PM role on a user-facing or AI product matches, while product management of pricing, assurance or quality, compliance, operations, or technical, platform, infrastructure, cloud, IAM, security or data-infrastructure products is a different occupation (e.g. Product Pricing Manager, Product Assurance Manager, Technical Product Owner, Product Manager Cloud Infrastructure). A title in no archetype family is a different occupation.',
  'Titles below candidate_target_level are not a match, and neither are execution roles beneath the primary archetypes even with Senior in the title (for product or UX/UI designer archetypes: HTML/CSS integrator, Intégrateur / web integrator), unless the title contains a phrase of candidate_search_terms: the candidate searches for those on purpose (e.g. Web Designer, UX Researcher), so they match.',
  'When candidate_contract_types lists no freelance or contract work, an explicitly freelance, fractional, mission-based or contract-only role is not a match (e.g. "Senior Freelance Product Designer (Fractional)").',
].join(' ');

// Attendance and residence, read from the state for every candidate. An empty
// candidate_authorized_in is a profile that says nothing about authorization,
// not a candidate authorized nowhere.
const PLACE_RULES = 'When candidate_full_remote_only is true, explicit on-site or hybrid attendance is a reject unless the posting is based in a place listed in candidate_onsite_exceptions; offsite or team-building travel is fine when candidate_offsite_travel_ok is true. When candidate_authorized_in is not empty, residence or work authorization restricted to countries outside candidate_authorized_in is a reject, US work-auth markers included (I-9, E-Verify) unless candidate_authorized_in lists the United States; an empty candidate_authorized_in means the authorization is unknown, never a residence or work-authorization reject. When candidate_reject_internships is true, internships, stages and junior roles are a reject.';

const SOFT_SIGNALS = 'candidate_sector_preferences and candidate_compensation_minimum are fit signals, not rejects: lower the fit when the sector is far from the preferences or stated pay is clearly below the minimum.';

export function scanKeepQuestions() {
  return {
    keep: {
      type: 'noul',
      instructions:
        `Should this job be kept for the candidate? ${ROLE_RULES} ${PLACE_RULES} remote_disposition=review is not a reject, and an on-site or hybrid mention only rejects when it is explicit in the title or remote_disposition. A city in a Welcome to the Jungle URL (_paris, _london, _lille) is an office tag, not onsite. Also reject a different occupation (recruiter, legal, or any role in no archetype family). ${SOFT_SIGNALS}`,
      criteria: {
        true: 'A fit: primary archetype role (a bare short title included), or a fit: secondary archetype role whose scope overlaps the primary domain; at or near candidate_target_level; a contract type the candidate takes; no explicit intern, attendance or work-authorization blocker for this candidate.',
        false: 'Below the target level or an execution role beneath the primary archetypes, freelance/fractional/contract-only for a salaried candidate, explicit attendance outside the on-site exceptions of a full-remote candidate, work authorization the candidate lacks, a secondary-archetype role outside the primary domain, or a different occupation.',
      },
    },
    fit: {
      type: 'score',
      instructions: `How strong is the fit for this candidate overall? Strong: a fit: primary archetype at candidate_target_level with a setup the candidate accepts (remote, or on site in one of candidate_onsite_exceptions). Acceptable: a fit: secondary archetype whose scope overlaps the primary domain, or a primary archetype with an unclear level or remote setup. Poor: anything else. ${SOFT_SIGNALS}`,
      criteria: ['Poor fit', 'Acceptable fit', 'Strong fit'],
    },
  };
}

export function evalGateQuestions() {
  return {
    worth_evaluating: {
      type: 'noul',
      instructions:
        `Given the job description and candidate constraints, is a full written evaluation worth running? ${ROLE_RULES} ${PLACE_RULES} Use the job description to judge the scope of a secondary-archetype role, the level of a short title and the contract type. An attendance or residence reject needs a verbatim requirement in the JD. Do NOT reject because a city appears in the title or URL, because the title is short, because remote_disposition is review, for bare Remote with no country lock, HQ-only mentions, assumed travel, or domain skill gaps. ${SOFT_SIGNALS}`,
      criteria: {
        true: 'Worth a full evaluation: a fit: primary archetype role, or a fit: secondary archetype role whose scope overlaps the primary domain, at or near candidate_target_level, in a contract type the candidate takes, and the JD has no intern/junior, residence, work-authorization or attendance blocker for this candidate.',
        false: 'Hard pass: below the target level or an execution role beneath the primary archetypes, freelance/fractional/contract-only for a salaried candidate, a secondary-archetype role outside the primary domain, or a verbatim attendance, residence or work-authorization requirement the candidate does not meet.',
      },
    },
  };
}

async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  const n = Math.min(concurrency, Math.max(1, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

export function isJevAccountError(message = '') {
  return /HTTP (401|402)\b|OPENROUTER_API_KEY or OPENROUTER_ADMIN_KEY is not set/.test(String(message));
}

/**
 * One line naming why Jev qualified nothing, for the scan result. Empty when
 * no call failed.
 */
export function jevErrorSummary(errors = []) {
  const first = String(errors[0]?.error || '');
  if (!first) return '';
  if (/HTTP 402\b/.test(first)) return 'Jev indisponible : crédits OpenRouter épuisés (HTTP 402). Recharge sur https://openrouter.ai/settings/credits puis relance le scan.';
  if (/HTTP 401\b/.test(first)) return 'Jev indisponible : clé OpenRouter refusée (HTTP 401). Vérifie OPENROUTER_API_KEY dans .env.';
  if (/is not set/.test(first)) return 'Jev indisponible : OPENROUTER_API_KEY absente de .env.';
  return `Jev en erreur sur ${errors.length} appel(s) : ${first.slice(0, 160)}`;
}

/**
 * Filter scan roster with Jev keep/drop decisions.
 * @returns {Promise<{ kept: object[], dropped: object[], errors: object[], considered: number }>}
 */
export async function filterScanCandidatesWithJev(candidates = [], profileRules = {}, {
  limit = JEV_SCAN_LIMIT,
  concurrency = JEV_CONCURRENCY,
  keepThreshold = JEV_KEEP_THRESHOLD,
  onProgress,
} = {}) {
  const roster = (candidates || []).slice(0, limit);
  const kept = [];
  const dropped = [];
  const unverified = [];
  const errors = [];
  // A 401/402 answers every later call the same way: on 2026-10-02 an empty
  // OpenRouter balance turned all 120 calls into 402s. Stop calling after the
  // first one; the rest share its error.
  let accountError = '';

  await mapPool(roster, concurrency, async (candidate, index) => {
    if (accountError) {
      errors.push({ candidate, error: accountError });
      unverified.push({ ...candidate, jevKeep: null, jevOutcome: 'unverified', jevError: accountError, finalScore: null });
      if (typeof onProgress === 'function') {
        onProgress({ index, total: roster.length, error: accountError, kept: false, outcome: 'unverified' });
      }
      return;
    }
    try {
      const state = buildCandidateProfileState(candidate, profileRules);
      const { answers, model, id } = await decide({
        state,
        questions: scanKeepQuestions(),
      });
      let keepProb = noulFromAnswers(answers, 'keep');
      const fit = scoreFromAnswers(answers, 'fit');
      let outcome = classifyJevOutcome({ keepProb, threshold: keepThreshold });
      const override = jevDropOverrideReason(candidate, { contractTypes: profileRules.search?.contractTypes, targeting: profileRules.targeting });
      if (override && outcome !== 'unverified') {
        if (keepProb == null || keepProb < keepThreshold) keepProb = keepThreshold;
        outcome = 'validated';
      }
      const decision = {
        ...candidate,
        jevKeep: keepProb,
        jevFit: fit,
        jevModel: model,
        jevId: id,
        jevOutcome: outcome,
        jevReason: override && outcome === 'validated' ? override : '',
        finalScore: keepProb == null ? null : Math.round(((Number(candidate.preScore) || 0) * 0.45 + keepProb * 0.55) * 1000) / 1000,
      };
      if (outcome === 'validated') kept.push(decision);
      else if (outcome === 'unverified') unverified.push({ ...decision, jevReason: 'missing_noul' });
      else dropped.push({ ...decision, jevReason: 'below_threshold' });
      if (typeof onProgress === 'function') {
        onProgress({ index, total: roster.length, keepProb, fit, kept: outcome === 'validated', outcome });
      }
    } catch (err) {
      if (isJevAccountError(err.message)) accountError = err.message;
      errors.push({ candidate, error: err.message });
      unverified.push({ ...candidate, jevKeep: null, jevOutcome: 'unverified', jevError: err.message, finalScore: null });
      if (typeof onProgress === 'function') {
        onProgress({ index, total: roster.length, error: err.message, kept: false, outcome: 'unverified' });
      }
    }
  });

  kept.sort((a, b) => (num(b.finalScore) - num(a.finalScore)) || (num(b.jevKeep) - num(a.jevKeep)) || (num(b.jevFit) - num(a.jevFit)));
  return { kept, dropped, unverified, errors, considered: roster.length };
}

/**
 * Soft gate before expensive text evaluation (pipeline / oferta).
 */
export async function decideOfferWorthEvaluating({
  jdText = '',
  title = '',
  company = '',
  url = '',
  profileRules = {},
  threshold = JEV_EVAL_THRESHOLD,
} = {}) {
  const state = {
    ...buildCandidateProfileState({ title, company, url, description: jdText }, profileRules),
    job_description: clipJd(clean(cleanJobDescriptionText(jdText, { title })), 3500),
  };
  const { answers, model, id } = await decide({
    state,
    questions: evalGateQuestions(),
  });
  const worth = noulFromAnswers(answers, 'worth_evaluating');
  const evalOverride = jevEvalOverrideReason({ title, url, jdText, contractTypes: profileRules.search?.contractTypes, targeting: profileRules.targeting });
  const passByScore = worth != null && worth >= threshold;
  const pass = passByScore || Boolean(evalOverride);
  return {
    worth: pass && (worth == null || worth < threshold) ? threshold : worth,
    pass,
    model,
    id,
    threshold,
    override: pass && !passByScore ? evalOverride : '',
  };
}

/**
 * Build a scan response body compatible with extractScanEntriesFromResponse.
 */
function jevNoteLine(candidate) {
  const title = clean(candidate.title);
  const noteParts = [title ? pipelineNoteCompany(clean(candidate.company)) : clean(candidate.company), title, clean(candidate.publishedAt)].filter(Boolean);
  return noteParts.length ? `${candidate.url} | ${noteParts.join(' | ')}` : candidate.url;
}

export function buildJevScanResponse({ kept = [], dropped = [], unverified = [], review = [], considered = 0, errors = [] } = {}) {
  const errorLine = jevErrorSummary(errors);
  const undated = review.filter(c => isUndatedReview(c)).length;
  const lines = [
    ...(errorLine ? [`⚠️ ${errorLine}`, ''] : []),
    `Offres exclues totales après filtrage Jev : ${dropped.length}`,
    `Candidats considérés : ${considered}`,
    `Non qualifiées (Jev indisponible ou sans score) : ${unverified.length}`,
    `Remote à revoir : ${review.length - undated}`,
    ...(undated ? [`Date à vérifier (recherche web sans date) : ${undated}`] : []),
    '',
    '## Offres retenues',
    '',
  ];
  if (!kept.length) {
    lines.push('Aucune offre retenue.');
  } else {
    for (const c of kept) {
      const meta = [
        c.company ? `company=${c.company}` : '',
        c.location ? `location=${c.location}` : '',
        c.remoteEvidence ? `remote_evidence=${c.remoteEvidence}` : '',
        c.jevKeep != null ? `jev_keep=${Number(c.jevKeep).toFixed(2)}` : '',
        c.finalScore != null ? `final=${Number(c.finalScore).toFixed(2)}` : '',
        c.jevFit != null ? `jev_fit=${Number(c.jevFit).toFixed(2)}` : '',
      ].filter(Boolean).join(' | ');
      lines.push(`- ${clean(c.title) || 'Untitled'} | ${clean(c.company) || '?'} | ${c.url}${meta ? ` | ${meta}` : ''}`);
    }
  }
  lines.push('', '## URLs_À_AJOUTER', '');
  if (!kept.length) lines.push('AUCUNE');
  else for (const c of kept) lines.push(jevNoteLine(c));

  lines.push('', '## URLs_NON_QUALIFIEES', '');
  if (!unverified.length) lines.push('AUCUNE');
  else {
    lines.push('Jev n’a pas qualifié ces offres. Elles ne sont pas des matchs validés.');
    for (const c of unverified) lines.push(jevNoteLine(c));
  }

  lines.push('', '## URLs_REMOTE_REVIEW', '');
  if (!review.length) lines.push('AUCUNE');
  else {
    lines.push(undated
      ? 'Signal remote ambigu ou date de publication inconnue. Bac review, séparé des matchs stricts.'
      : 'Signal remote ambigu. Bac review, séparé des matchs stricts.');
    for (const c of review) lines.push(jevNoteLine(c));
  }
  return lines.join('\n');
}
