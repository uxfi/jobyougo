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
  let scoreRaw = String(raw).trim();
  if (scoreRaw.includes('/') && !scoreRaw.endsWith('/5')) scoreRaw = scoreRaw.split('/')[0] + '/5';
  if (!scoreRaw.includes('/')) scoreRaw += '/5';
  return scoreRaw;
}

export function isPlaceholderScore(scoreRaw) {
  if (!scoreRaw) return true;
  const s = String(scoreRaw).trim();
  if (s === '—' || s === '-') return true;
  return !Number.isFinite(parseFloat(s));
}

function scoreFromFragment(fragment) {
  const raw = String(fragment || '').trim();
  if (!raw || raw === '—' || raw === '-') return null;
  const leadingNum = raw.match(/^(\d+(?:\.\d+)?)(?:\s*\/\s*5)?\b/);
  if (leadingNum) return normalizeScoreRaw(leadingNum[1]);
  if (REJECT_PHRASE_RE.test(raw)) return HARD_REJECT_SCORE;
  const embedded = raw.match(/(\d+(?:\.\d+)?)\s*\/\s*5/);
  if (embedded) return normalizeScoreRaw(embedded[1]);
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

  const numericFallback = (text || '').match(/\*\*Global\*\*[^|]*\|\s*\*\*([\d.]+\/5)\*\*/i)
    || (text || '').match(/([\d.]+)\/5/);
  if (numericFallback?.[1]) return normalizeScoreRaw(numericFallback[1]);

  return '—';
}

/**
 * Combine LLM-parsed score with the profileGate hardReject override
 * (same rule as the previous inline parser).
 */
export function resolveEvaluationScore(fullResponse, { hardReject = false } = {}) {
  let scoreRaw = extractEvaluationScore(fullResponse);
  let numericScore = parseFloat(scoreRaw);
  if (hardReject && (!Number.isFinite(numericScore) || numericScore > 2)) {
    scoreRaw = HARD_REJECT_SCORE;
    numericScore = 1.0;
  }
  return { scoreRaw, numericScore };
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
