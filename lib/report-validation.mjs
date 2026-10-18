/**
 * Score extraction + report integrity checks for oferta/pipeline post-processing.
 *
 * A finished evaluation can still say `**Score:** Rejected (hard fail)` instead of
 * `**Score:** 1.0/5`. That used to parse as the placeholder dash and the report
 * was discarded even though Blocks A–D were complete.
 */

export const HARD_REJECT_SCORE = '1.0/5';

export const CORRUPTION_PATTERNS = [
  '<tool_call>', '<tool_response>', '</tool_call>', '</tool_response>',
  '"name": "browser_navigate"', '"name": "browser_snapshot"',
  '"name": "bash"', '"name": "WebFetch"', '"name": "WebSearch"',
  'Taking a screenshot...', '</thinking>', '<thinking>',
];

export const REPORT_SECTION_PATTERNS = [
  /^## (?:A\)|Block A|Bloque A|Resumen del Rol|Résumé)/m,
  /^## (?:B\)|Block B|Bloque B|Match)/m,
  /^## (?:C\)|Block C|Bloque C|Nivel|Stratégie|Niveau)/m,
  /^## (?:D\)|Block D|Bloque D|Comp)/m,
  /^## (?:E\)|Block E|Bloque E|Personali)/m,
  /^## (?:F\)|Block F|Bloque F|Entrevista|Interview|Préparation)/m,
  /^## (?:Scoring|Score|Recommand|Disqualification|🚨)/m,
];

// Degenerate output: Qwen sometimes loops on one bullet until max_tokens
// (report 692, Consensys 2026-10-13: the same 14 bullets cycled, one line 10
// times). Across the 590 reports saved before it, no line repeated more than
// 4 times and no report had more than 9% duplicate lines.
export const REPEATED_LINE_MAX = 4;
export const DUPLICATE_LINE_RATIO_MAX = 0.3;
const DUPLICATE_RATIO_MIN_LINES = 20;
export const REPETITION_LOOP_CODE = 'repetition_loop';
export const OWN_EMPLOYER_CODE = 'own_employer';

function companyKey(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

// Equal, or one name holds the other as whole words ("BMW" / "BMW Group").
function sameCompany(a, b) {
  const left = companyKey(a);
  const right = companyKey(b);
  if (!left || !right) return false;
  return left === right || ` ${left} `.includes(` ${right} `) || ` ${right} `.includes(` ${left} `);
}

/**
 * The candidate's own employer the model named in its "# Evaluation: X — Y"
 * header while the offer belongs to another company, or ''. Report 739: Qwen
 * evaluated the CV's OneAsset job against itself (4.8/5) instead of a
 * Deliveroo posting.
 */
export function ownEmployerConfusion(headerCompany, offerCompany, ownCompanies = []) {
  if (!headerCompany || !offerCompany || sameCompany(headerCompany, offerCompany)) return '';
  return ownCompanies.find(name => sameCompany(name, headerCompany)) || '';
}

function normalizeReportLine(line) {
  return String(line || '').trim().replace(/\s+/g, ' ');
}

// Rules, table separators and very short lines repeat legitimately.
function isIgnorableReportLine(line) {
  return line.length < 4 || /^[-*_=|:\s]+$/.test(line);
}

/**
 * Detect an output loop: one non-empty line repeated more than
 * REPEATED_LINE_MAX times, or more than DUPLICATE_LINE_RATIO_MAX of the lines
 * being repeats of earlier lines.
 * Returns { looped, line, count, duplicateRatio, lineCount }.
 */
export function detectRepetitionLoop(content) {
  const lines = String(content || '')
    .split(/\r?\n/)
    .map(normalizeReportLine)
    .filter(line => !isIgnorableReportLine(line));
  const counts = new Map();
  for (const line of lines) counts.set(line, (counts.get(line) || 0) + 1);
  let line = '';
  let count = 0;
  for (const [text, n] of counts) {
    if (n > count) {
      line = text;
      count = n;
    }
  }
  const duplicateRatio = lines.length ? (lines.length - counts.size) / lines.length : 0;
  const looped = count > REPEATED_LINE_MAX
    || (lines.length >= DUPLICATE_RATIO_MIN_LINES && duplicateRatio > DUPLICATE_LINE_RATIO_MAX);
  return { looped, line, count, duplicateRatio, lineCount: lines.length };
}

const REJECT_PHRASE_RE = /\b(?:reject(?:ed|ion)?|rejet(?:ée?s?)?|hard\s*fail|hard\s*mismatch|hard\s*pass|immediate\s+rejection|do\s+not\s+apply|disqualif(?:ication|ied|y)?)\b/i;

export function normalizeScoreRaw(raw) {
  if (!raw || raw === '—' || raw === '-') return raw || '—';
  const match = String(raw).trim().match(/^(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+(?:\.\d+)?))?$/);
  if (!match) return '—';
  const score = Number(match[1]);
  const denominator = match[2] == null ? 5 : Number(match[2]);
  if (denominator !== 5 || !Number.isFinite(score) || score < 1 || score > 5) return '—';
  return `${score.toFixed(1)}/5`;
}

export function isPlaceholderScore(scoreRaw) {
  if (!scoreRaw) return true;
  const s = String(scoreRaw).trim();
  if (s === '—' || s === '-') return true;
  const match = s.match(/^(\d+(?:\.\d+)?)\s*\/\s*5$/);
  if (!match) return true;
  const score = Number(match[1]);
  return !Number.isFinite(score) || score < 1 || score > 5;
}

function scoreFromFragment(fragment) {
  const raw = String(fragment || '').trim();
  if (!raw || raw === '—' || raw === '-') return null;
  const leadingNum = raw.match(/^(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+(?:\.\d+)?))?(?=\s|$|[([,.;:—-])/);
  if (leadingNum) return normalizeScoreRaw(leadingNum[2] == null ? leadingNum[1] : `${leadingNum[1]}/${leadingNum[2]}`);
  if (REJECT_PHRASE_RE.test(raw)) return HARD_REJECT_SCORE;
  return null;
}

function extractScoreLine(text) {
  return text.match(/\*\*Score[:\*]+\s*([^\n]+)/i)?.[1]
    || text.match(/(?:^|\n)\s*Score[:\s]+\*?\*?\s*([^\n]+)/im)?.[1]
    || '';
}

function extractGlobalCell(text) {
  return text.match(/\|\s*\*?\*?Global\*?\*?\s*\|\s*\*?\*?([^\n|]+)/i)?.[1]?.trim()
    || text.match(/\*\*Global\*\*[^|\n]*\|\s*\*?\*?([^\n*]+)/i)?.[1]?.trim()
    || '';
}

/**
 * Parse a completed evaluation's global score.
 * Textual rejects (Rejected, hard fail, hard mismatch, …) map to 1.0/5.
 */
export function extractEvaluationScore(text) {
  const fromLine = scoreFromFragment(extractScoreLine(text || ''));
  if (fromLine) return fromLine;

  const fromGlobal = scoreFromFragment(extractGlobalCell(text || ''));
  if (fromGlobal) return fromGlobal;

  const numericFallback = (text || '').match(/\*\*Global\*\*[^|]*\|\s*\*\*([\d.]+\/5)\*\*/i);
  if (numericFallback?.[1]) return normalizeScoreRaw(numericFallback[1]);

  return '—';
}

/**
 * Global score from the five rated dimensions of the `## Notation` table.
 * The model rates each dimension against a fixed rubric (lib/prompt-budget.mjs
 * EVAL_SYSTEM); the Global is arithmetic, so two offers with the same ratings
 * always get the same score. Free-form Globals drifted: Chromatic (match 5,
 * remote, comp above target) came out 3.8 while a weaker fit came out 4.5.
 */
export const SCORE_WEIGHTS = Object.freeze({
  match: 0.40,
  northStar: 0.25,
  comp: 0.10,
  culture: 0.10,
  redFlags: 0.15,
});

const DIMENSION_LABELS = [
  ['match', /match\s*cv/i],
  ['northStar', /north\s*star/i],
  ['comp', /^comp/i],
  ['culture', /cultur/i],
  ['redFlags', /red\s*flags?|signaux?\s+d['’]alerte|drapeaux?\s+rouges?/i],
];

/** Rated dimensions of the `## Notation` table, or null unless all five are present. */
export function parseDimensionScores(text) {
  const section = String(text || '').match(/^##\s*Notation[^\n]*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/im)?.[1] || '';
  if (!section) return null;
  const dims = {};
  for (const line of section.split('\n')) {
    if (!line.includes('|')) continue;
    const cells = line.split('|').map((c) => c.replace(/\*+/g, '').trim()).filter((c, i, a) => !(c === '' && (i === 0 || i === a.length - 1)));
    if (cells.length < 2) continue;
    const rating = cells[1].match(/^(\d(?:[.,]\d)?)\s*(?:\/\s*5)?$/);
    if (!rating) continue;
    const value = Number(rating[1].replace(',', '.'));
    if (!(value >= 1 && value <= 5)) continue;
    const key = DIMENSION_LABELS.find(([, re]) => re.test(cells[0]))?.[0];
    if (key && dims[key] == null) dims[key] = value;
  }
  return Object.keys(SCORE_WEIGHTS).every((k) => dims[k] != null) ? dims : null;
}

/** Weighted Global, one decimal. A serious red flag (<= 2) caps it at 3.0. */
export function computeGlobalScore(dims) {
  if (!dims) return null;
  let total = 0;
  for (const [key, weight] of Object.entries(SCORE_WEIGHTS)) total += dims[key] * weight;
  if (dims.redFlags <= 2) total = Math.min(total, 3.0);
  return Math.min(5, Math.max(1, Math.round(total * 10) / 10));
}

/** Replace the first `**Score:**` line so the body matches the header. */
function withScoreLine(text, scoreRaw) {
  const line = `**Score:** ${scoreRaw}`;
  return /\*\*Score[:\*]+[^\n]*/i.test(text)
    ? text.replace(/\*\*Score[:\*]+[^\n]*/i, line)
    : text;
}

/**
 * Combine LLM-parsed score with the profileGate hardReject override
 * (same rule as the previous inline parser). When the evaluation carries a
 * complete `## Notation` table, the Global is computed from it instead of the
 * model's own number; the model's hard fail (<= 1.5) still wins.
 */
export function resolveEvaluationScore(fullResponse, { hardReject = false } = {}) {
  let scoreRaw = extractEvaluationScore(fullResponse);
  let numericScore = parseFloat(scoreRaw);
  let text = fullResponse;
  let computed = false;
  const modelHardFail = Number.isFinite(numericScore) && numericScore <= 1.5;
  const dims = modelHardFail ? null : parseDimensionScores(fullResponse);
  const global = computeGlobalScore(dims);
  if (global != null) {
    scoreRaw = `${global.toFixed(1)}/5`;
    numericScore = global;
    text = withScoreLine(fullResponse, scoreRaw);
    computed = true;
  }
  if (hardReject && (!Number.isFinite(numericScore) || numericScore > 2)) {
    scoreRaw = HARD_REJECT_SCORE;
    numericScore = 1.0;
    text = withScoreLine(text, scoreRaw);
  }
  return { scoreRaw, numericScore, text, computed, dims };
}

/**
 * Validates that report content is a proper structured evaluation,
 * not raw LLM conversation logs or corrupted output.
 * Returns { valid: boolean, reason?: string, code?: string }
 */
export function validateReportContent(content, scoreRaw, company, role) {
  const foundCorruption = CORRUPTION_PATTERNS.filter(p => content.includes(p));
  if (foundCorruption.length > 0) {
    return { valid: false, reason: `Contains raw LLM logs: ${foundCorruption.slice(0, 3).join(', ')}` };
  }

  const loop = detectRepetitionLoop(content);
  if (loop.looped) {
    const sample = loop.line.length > 80 ? `${loop.line.slice(0, 77)}...` : loop.line;
    return {
      valid: false,
      code: REPETITION_LOOP_CODE,
      loop: { line: loop.line, count: loop.count, duplicateRatio: loop.duplicateRatio },
      reason: `Output looped: the same line repeats ${loop.count} times ("${sample}"), ${Math.round(loop.duplicateRatio * 100)}% of lines are duplicates — the model degenerated, relaunch the evaluation`,
    };
  }

  if (isPlaceholderScore(scoreRaw)) {
    return { valid: false, reason: `Score is placeholder (${scoreRaw}) — evaluation was not completed` };
  }

  if (company === 'unknown' && role === 'role') {
    return { valid: false, reason: 'Could not extract company/role from response — evaluation may have failed' };
  }

  const sectionCount = REPORT_SECTION_PATTERNS.filter(p => p.test(content)).length;
  if (sectionCount < 2) {
    return { valid: false, reason: `Only ${sectionCount} evaluation sections found (need at least 2)` };
  }

  return { valid: true };
}
