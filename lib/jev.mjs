/**
 * TypeSafe Jev via OpenRouter Decisions API.
 * Structured keep/drop / score decisions — not text generation.
 * POST https://openrouter.ai/api/alpha/decisions
 */
import 'dotenv/config';
import { recordAiUsageEvent } from './ai-usage-log.mjs';
import { clipJd } from './prompt-budget.mjs';

const API_KEY = process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_ADMIN_KEY;
const DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions';

export const JEV_MODEL = process.env.JEV_MODEL || '~typesafe/jev-latest';
export const JEV_KEEP_THRESHOLD = Number(process.env.JEV_KEEP_THRESHOLD || 0.55);
export const JEV_EVAL_THRESHOLD = Number(process.env.JEV_EVAL_THRESHOLD || 0.5);
export const JEV_CONCURRENCY = Math.max(1, Number(process.env.JEV_CONCURRENCY || 6));
export const JEV_SCAN_LIMIT = Math.max(1, Number(process.env.JEV_SCAN_LIMIT || 120));

const HEADERS = () => ({
  Authorization: `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
  'HTTP-Referer': 'https://career-ops.local',
  'X-Title': 'career-ops',
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
    description_excerpt: clean(candidate.description).slice(0, 1200),
    remote_disposition: clean(candidate.remoteDisposition),
    remote_confidence: candidate.remoteConfidence ?? '',
    remote_reason: clean(candidate.remoteReason),
    geo_signals: clean(candidate.geoSignals || candidate.location),
    seniority: clean(candidate.seniority),
    contract: clean(candidate.contract),
    date_source: clean(candidate.dateSource),
    pre_score: candidate.preScore ?? '',
    matched_constraints: clean(candidate.matchedConstraints),
    candidate_authorized_in: location.authorizedIn || [],
    candidate_remote_policy: location.remotePolicy || (location.fullRemoteOnly ? 'full remote only' : ''),
    candidate_full_remote_only: Boolean(location.fullRemoteOnly),
    candidate_no_relocation: Boolean(location.noRelocation),
    candidate_target_roles: targeting.primaryRoles || [],
    candidate_must_haves: search.mustHaves || [],
    candidate_deal_breakers: search.dealBreakers || [],
    candidate_geography_preferences: search.geographyPreferences || [],
  };
}

function scanKeepQuestions() {
  return {
    keep: {
      type: 'noul',
      instructions:
        'Should this job be kept for the candidate? Use remote_disposition, remote_confidence, geo_signals, seniority, contract, pre_score, and matched_constraints. Require title/role family fit AND workable remote/geo. remote_disposition=review is not a strict remote match: keep only if the role family is strong. Reject US/Canada/Americas-only residency or US work-auth (I-9, E-Verify) unless candidate_authorized_in includes the United States. Reject onsite-only when candidate_full_remote_only is true.',
      criteria: {
        true: 'Role fits target roles and location/remote policy is workable for this candidate.',
        false: 'Wrong role family, onsite-only when full-remote required, or geo/work-auth incompatible.',
      },
    },
    fit: {
      type: 'score',
      instructions: 'How strong is the fit for this candidate overall?',
      criteria: ['Poor fit', 'Acceptable fit', 'Strong fit'],
    },
  };
}

function evalGateQuestions() {
  return {
    worth_evaluating: {
      type: 'noul',
      instructions:
        'Given the job description and candidate constraints, is a full written evaluation worth running? Reject ONLY with explicit evidence of: onsite/hybrid attendance outside Thailand, US/Canada/Americas-only residency, or US work-auth (I-9, E-Verify). Do NOT reject for bare Remote with no country lock, assumed travel/OEM, HQ location, domain skill gaps, or city-in-title when the posting is still remote.',
      criteria: {
        true: 'Worth a full evaluation — no explicit geo/work-auth blocker; role family is plausible.',
        false: 'Hard pass — explicit attendance, residency, or work-auth mismatch in the JD/location field.',
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

  await mapPool(roster, concurrency, async (candidate, index) => {
    try {
      const state = buildCandidateProfileState(candidate, profileRules);
      const { answers, model, id } = await decide({
        state,
        questions: scanKeepQuestions(),
      });
      const keepProb = noulFromAnswers(answers, 'keep');
      const fit = scoreFromAnswers(answers, 'fit');
      const outcome = classifyJevOutcome({ keepProb, threshold: keepThreshold });
      const decision = {
        ...candidate,
        jevKeep: keepProb,
        jevFit: fit,
        jevModel: model,
        jevId: id,
        jevOutcome: outcome,
        finalScore: keepProb == null ? null : Math.round(((Number(candidate.preScore) || 0) * 0.45 + keepProb * 0.55) * 1000) / 1000,
      };
      if (outcome === 'validated') kept.push(decision);
      else if (outcome === 'unverified') unverified.push({ ...decision, jevReason: 'missing_noul' });
      else dropped.push({ ...decision, jevReason: 'below_threshold' });
      if (typeof onProgress === 'function') {
        onProgress({ index, total: roster.length, keepProb, fit, kept: outcome === 'validated', outcome });
      }
    } catch (err) {
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
    job_description: clipJd(clean(jdText), 3500),
  };
  const { answers, model, id } = await decide({
    state,
    questions: evalGateQuestions(),
  });
  const worth = noulFromAnswers(answers, 'worth_evaluating');
  return {
    worth,
    pass: worth != null && worth >= threshold,
    model,
    id,
    threshold,
  };
}

/**
 * Build a scan response body compatible with extractScanEntriesFromResponse.
 */
function jevNoteLine(candidate) {
  const noteParts = [clean(candidate.company), clean(candidate.title), clean(candidate.publishedAt)].filter(Boolean);
  return noteParts.length ? `${candidate.url} | ${noteParts.join(' | ')}` : candidate.url;
}

export function buildJevScanResponse({ kept = [], dropped = [], unverified = [], review = [], considered = 0 } = {}) {
  const lines = [
    `Offres exclues totales après filtrage Jev : ${dropped.length}`,
    `Candidats considérés : ${considered}`,
    `Non qualifiées (Jev indisponible ou sans score) : ${unverified.length}`,
    `Remote à revoir : ${review.length}`,
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
    lines.push('Signal remote ambigu. Bac review, séparé des matchs stricts.');
    for (const c of review) lines.push(jevNoteLine(c));
  }
  return lines.join('\n');
}
