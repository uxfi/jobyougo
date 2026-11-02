// The evaluation report is cut to what verifies the posting and justifies the score (2026-10-31):
//   ## A) Vérifications  the posting's facts, quoted
//   ## B) Match CV       the requirements that weigh on the score
//   ## Notation          five rated dimensions, from which the score is computed
// The old A) role summary, C) level and strategy, D) comp and G) legitimacy sections were prose
// nobody used: their facts moved into A) and into the Notation evidence. Existing reports keep
// their format, so the readers must take both.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EVAL_SYSTEM } from '../lib/prompt-budget.mjs';
import { validateReportContent, extractEvaluationScore, parseDimensionScores, computeGlobalScore, REPORT_SECTION_PATTERNS } from '../lib/report-validation.mjs';
import { draftNeedsRepair, buildEvalRepairPrompt } from '../lib/eval-draft.mjs';
import { offerPartOfReport, offerLocationFromText } from '../lib/apply-policy.mjs';

const SLIM = `# Evaluation: Attendi — UX Product Designer
**Score:** 2.5/5

## A) Vérifications
- **Lieu** : "Amsterdam, Pays-Bas (NH · NL)"
- **Remote** : "full remote"
- **Résidence / autorisation** : "Résidence à Amsterdam ou aux Pays-Bas exigée"
- **Niveau** : 2-4 ans demandés ; candidat senior
- **Salaire** : 4 000 – 4 500 € par mois
- **Annonce** : High, startup identifiable et poste précis

## B) Match CV
- Figma, B2B SaaS → confirmés (OneAsset, UpViral)
- Néerlandais natif → gap

## Notation

| Dimension | Note | Preuve |
|-----------|------|--------|
| Match CV | 2 | Néerlandais natif exigé, absent du CV. |
| North Star | 3 | Rôle proche, mais le profil est lead produit. |
| Comp | 2 | 10 à 25 % sous la cible. |
| Culture | 4 | Petite équipe, autonomie. |
| Red flags | 2 | Résidence aux Pays-Bas exigée. |
`;

test('the prompt asks for three sections and nothing else', () => {
  const titles = EVAL_SYSTEM.split('\n').filter((line) => /^\s*## /.test(line)).map((line) => line.trim());
  assert.deepEqual(titles, ['## A) Vérifications', '## B) Match CV', '## Notation']);
  assert.doesNotMatch(EVAL_SYSTEM, /## [CDG]\)|Résumé du rôle|Niveau et stratégie|Comp et demande|Légitimité/);
  assert.match(EVAL_SYSTEM, /ni résumé du rôle, ni stratégie, ni analyse de culture, ni plan/);
});

test('A) is the posting\'s facts, quoted, with no opinion on the candidate', () => {
  for (const label of ['Lieu', 'Remote', 'Résidence / autorisation', 'Niveau', 'Salaire', 'Annonce']) {
    assert.ok(EVAL_SYSTEM.includes(`**${label}**`), `${label} line`);
  }
  assert.match(EVAL_SYSTEM, /citation verbatim de toute contrainte de présence, de résidence ou d'autorisation de travail/);
  assert.match(EVAL_SYSTEM, /sans avis sur le candidat/);
});

test('the Notation rubric and the hard-fail rules are untouched', () => {
  for (const dimension of ['Match CV', 'North Star', 'Comp', 'Culture', 'Red flags']) assert.ok(EVAL_SYSTEM.includes(`  - ${dimension} :`), dimension);
  assert.match(EVAL_SYSTEM, /HARD FAIL = Score 1\.0\/5 \+ SKIP/);
  assert.match(EVAL_SYSTEM, /recalculée par le système à partir de ces notes/);
});

test('a slim report is valid, and its score comes from the Notation table', () => {
  const dims = parseDimensionScores(SLIM);
  assert.ok(dims, 'all five dimensions read');
  assert.equal(extractEvaluationScore(SLIM), '2.5/5');
  assert.ok(computeGlobalScore(dims) > 0);
  assert.equal(REPORT_SECTION_PATTERNS.filter((pattern) => pattern.test(SLIM)).length, 2, 'A) and B) are the two sections the validator counts');
  assert.deepEqual(validateReportContent(SLIM, '2.5/5', 'Attendi', 'UX Product Designer'), { valid: true });
});

test('a slim draft needs no repair, and a draft without sections does', () => {
  assert.equal(draftNeedsRepair(SLIM, '').repair, false);
  assert.equal(draftNeedsRepair('**Score:** 3.0/5\nSome prose with no headings at all.', '').repair, true);
  const repair = buildEvalRepairPrompt(SLIM, 'facts');
  assert.match(repair, /## A\) Vérifications, ## B\) Match CV, ## Notation/);
  assert.doesNotMatch(repair, /## [CDG]\)/);
});

test('apply still reads the job\'s place from A), not from the candidate side of the report', () => {
  const offerPart = offerPartOfReport(SLIM);
  assert.match(offerPart, /\*\*Lieu\*\* : "Amsterdam/);
  assert.doesNotMatch(offerPart, /Néerlandais natif → gap/, 'B) discusses the candidate and stays out');
  assert.doesNotMatch(offerPart, /Score/, 'the verdict line stays out');
  const place = offerLocationFromText({ role: 'UX Product Designer', url: 'https://attendi.recruitee.com/o/ux-product-designer', reportText: SLIM, candidateName: 'Hugo Vermot' });
  assert.ok(place.countries.some((country) => /netherlands|pays-bas/i.test(country)), `read ${JSON.stringify(place)}`);
});
