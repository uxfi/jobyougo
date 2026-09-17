/**
 * Tests for lib/report-validation.mjs — textual reject scores must save.
 *
 * THE BUG THIS PINS
 *
 * Pipeline post-processing only accepted `**Score:** 4.3/5`. A finished
 * evaluation that wrote `**Score:** Rejected (hard fail)` parsed as `—`,
 * validateReportContent refused, removeFromPipeline never ran, and the URL
 * was re-queued. Mapping reject → 1.0/5 (same as profileGate.hardReject)
 * is the fix; the parser must keep working if the model still writes words.
 */
import { pass, fail } from './helpers.mjs';
import {
  extractEvaluationScore,
  isPlaceholderScore,
  resolveEvaluationScore,
  validateReportContent,
} from '../lib/report-validation.mjs';

console.log('\nreport-validation — textual reject scores are complete evaluations');

const BJAK_RESPONSE = `# Evaluation: BJAK — Senior Product Designer

**Date:** 2026-09-15
**URL:** https://jobs.bjak.my/example
**Score:** Rejected (hard fail)
**Legitimacy:** Proceed with Caution

---

## A) Role Summary
Remote status is unknown. Location policy of the candidate requires explicit full remote.

## B) Match with CV
Skills overlap exists, but the remote unknown is a hard blocker.

## C) Niveau et stratégie
Do not apply while remote is unconfirmed.

## D) Comp et demande
Compensation not evaluated after hard fail.

## Scoring
Reco: Reject because remote is unknown.
`;

function wrapLikeServer(fullResponse, scoreRaw, role = 'Senior Product Designer') {
  return `# Evaluation — ${role}\n\n**Date:** 2026-09-15\n**Score:** ${scoreRaw}\n\n---\n\n${fullResponse}`;
}

const OLD_NUMERIC_ONLY = (text) => {
  const scoreMatch = text.match(/\*\*Score[:\*]+\s*([\d.]+(?:\/5)?)/i)
    || text.match(/Score[:\s]+\*?\*?([\d.]+(?:\/5)?)/i)
    || text.match(/\*\*Global\*\*[^|]*\|\s*\*\*([\d.]+\/5)\*\*/i)
    || text.match(/([\d.]+)\/5/);
  return scoreMatch?.[1] || '—';
};

OLD_NUMERIC_ONLY(BJAK_RESPONSE) === '—'
  ? pass('old numeric-only parser treated BJAK Rejected (hard fail) as placeholder —')
  : fail(`old parser should miss BJAK reject, got ${OLD_NUMERIC_ONLY(BJAK_RESPONSE)}`);

const bjakScore = extractEvaluationScore(BJAK_RESPONSE);
bjakScore === '1.0/5'
  ? pass('Score: Rejected (hard fail) maps to 1.0/5')
  : fail(`BJAK reject mapped to ${bjakScore}, expected 1.0/5`);

isPlaceholderScore(bjakScore)
  ? fail('mapped 1.0/5 must not be a placeholder')
  : pass('mapped 1.0/5 is not a placeholder (—, -)');

const bjakWrapped = wrapLikeServer(BJAK_RESPONSE, bjakScore, 'Senior Product Designer');
const bjakValidation = validateReportContent(bjakWrapped, bjakScore, 'bjak', 'Senior Product Designer');
bjakValidation.valid
  ? pass('validateReportContent accepts the BJAK reject report after mapping')
  : fail(`BJAK reject still rejected by validation: ${bjakValidation.reason}`);

const unmapped = validateReportContent(wrapLikeServer(BJAK_RESPONSE, '—', 'Senior Product Designer'), '—', 'bjak', 'Senior Product Designer');
!unmapped.valid && /placeholder/i.test(unmapped.reason || '')
  ? pass('without mapping, Score — still fails validation (the original bug)')
  : fail(`unmapped placeholder should fail, got ${JSON.stringify(unmapped)}`);

const phrases = [
  ['**Score:** Rejected (hard mismatch)', 'hard mismatch'],
  ['**Score:** Immediate rejection', 'Immediate rejection'],
  ['**Score:** hard pass', 'hard pass'],
  ['**Score:** Rejected (hard fail on remote)', 'Rejected (hard fail on remote)'],
  ['Score: Rejected (hard fail)', 'unbolded Score: Rejected'],
];
for (const [line, label] of phrases) {
  const text = `${line}\n\n## A) Role Summary\nRemote unknown.\n\n## B) Match\nHard blocker.`;
  const score = extractEvaluationScore(text);
  score === '1.0/5'
    ? pass(`${label} → 1.0/5`)
    : fail(`${label} mapped to ${score}, expected 1.0/5`);
}

const globalReject = `# Evaluation: Acme — Role\n\n| Axis | Result |\n| Global | Reject |\n\n## A) Role Summary\nx\n\n## B) Match\ny`;
extractEvaluationScore(globalReject) === '1.0/5'
  ? pass('table Global | Reject maps to 1.0/5')
  : fail(`Global | Reject mapped to ${extractEvaluationScore(globalReject)}`);

const globalBold = `# Evaluation: Acme — Role\n\n| **Global** | **Reject** |\n\n## A) Role Summary\nx\n\n## B) Match\ny`;
extractEvaluationScore(globalBold) === '1.0/5'
  ? pass('table **Global** | **Reject** maps to 1.0/5')
  : fail(`bold Global | Reject mapped to ${extractEvaluationScore(globalBold)}`);

const numeric = `# Evaluation: Acme — Role\n\n**Score:** 4.3/5\n\n## A) Role Summary\nx\n\n## B) Match\ny`;
extractEvaluationScore(numeric) === '4.3/5'
  ? pass('numeric **Score:** 4.3/5 is unchanged')
  : fail(`numeric score became ${extractEvaluationScore(numeric)}`);

const numericWithRejectWord = `# Evaluation: Acme — Role\n\n**Score:** 4.3/5\n\n## A) Role Summary\nWould reject if remote were unknown.\n\n## B) Match\nApply.`;
extractEvaluationScore(numericWithRejectWord) === '4.3/5'
  ? pass('body mention of reject does not override a numeric header score')
  : fail(`false-positive reject mapping: ${extractEvaluationScore(numericWithRejectWord)}`);

const numericRejectedSuffix = `**Score:** 1.0/5 (Rejected)\n\n## A) Role Summary\nx\n\n## B) Match\ny`;
extractEvaluationScore(numericRejectedSuffix) === '1.0/5'
  ? pass('**Score:** 1.0/5 (Rejected) keeps the number')
  : fail(`suffix form became ${extractEvaluationScore(numericRejectedSuffix)}`);

const overridden = resolveEvaluationScore(numeric, { hardReject: true });
overridden.scoreRaw === '1.0/5'
  ? pass('profileGate.hardReject still forces 1.0/5 over a high LLM score')
  : fail(`hardReject override gave ${overridden.scoreRaw}`);

isPlaceholderScore('Rejected') && isPlaceholderScore('Rejected/5')
  ? pass('bare Rejected / Rejected/5 remain placeholders if mapping is skipped')
  : fail('validation must still refuse an unmapped textual score');

const goodNumeric = validateReportContent(wrapLikeServer(numeric, '4.3/5', 'Role'), '4.3/5', 'acme', 'Role');
goodNumeric.valid
  ? pass('numeric 4.3/5 report still validates')
  : fail(`numeric report failed validation: ${goodNumeric.reason}`);
