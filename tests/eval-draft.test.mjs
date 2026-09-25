import { pass, fail } from './helpers.mjs';
import { extractEvaluationScore, validateReportContent } from '../lib/report-validation.mjs';
import {
  applyFactGuards,
  buildEvalRepairPrompt,
  draftNeedsRepair,
  findFactContradictions,
  normalizeEvalHeadings,
} from '../lib/eval-draft.mjs';

function ok(label, cond) {
  if (cond) pass(label);
  else fail(label);
}

const facts = [
  '- Intitulé : Senior Product Designer | Designing and building AI products',
  "- Années d'expérience design écrites dans le CV : 12",
  '- Postes :',
  '  - Senior Product Designer / Product Lead : OneAsset (Feb 2026 – Present)',
  '- Tools: Figma (10/10), Figmol',
].join('\n');

const broken = `Evaluation: Fireflies.ai — Product Designer
A) Résumé du rôle
Remote. Work remotely anywhere in your respective country. Pays: UK, India, Philippines, Portugal. La Thaïlande n'est pas exclue.
B) Match CV
Figma est implicite, non explicitement mentionné.
C) Niveau et stratégie
Senior (15 ans d'expérience professionnelle).
D) Comp et demande
non indiquée
G) Légitimité
Tier: High`;

const normalized = normalizeEvalHeadings(broken);
ok('loose headings become markdown headings', /^## A\) Résumé/m.test(normalized) && /^## B\) Match/m.test(normalized));
ok('already marked headings stay single', normalizeEvalHeadings('## C) Niveau et stratégie\n') === '## C) Niveau et stratégie\n');

const issues = findFactContradictions(broken, facts);
ok('15 years contradicts the CV year count', issues.some(item => item.startsWith('années:')));
ok('implicit Figma contradicts the tool line', issues.some(item => item.includes('Figma')));
ok('Figma described only through Figmol still contradicts the tool line', findFactContradictions('Figma est implicite via Figmol.', facts).some(item => item.includes('Figma')));
ok('respective country does not include Thailand', issues.some(item => item.includes('respective country')));

const check = draftNeedsRepair(broken, facts);
ok('the Fireflies draft needs a repair', check.repair && check.missingScore && check.sections >= 4);

const sound = `# Evaluation: Fireflies.ai — Product Designer
**Score:** 4.1/5
## A) Résumé du rôle
Remote senior product design.
## B) Match CV
12 ans d'expérience professionnelle. Figma (10/10) est confirmé. Auto-Layout n'est pas nommé.
## C) Niveau et stratégie
Senior.
## D) Comp et demande
non indiquée
## G) Légitimité
Tier: High`;
ok('a draft that keeps the CV facts does not need repair', draftNeedsRepair(sound, facts).repair === false);
ok('repair prompt carries the facts and the score line', /Figma \(10\/10\)/.test(buildEvalRepairPrompt(broken, facts)) && /\*\*Score:\*\*/.test(buildEvalRepairPrompt(broken, facts)));

const denied = `**Score:** 4.2/5\n## D) Comp et demande\nOutils : Cursor, Figmol. Figma n'est pas mentionné dans les outils du CV.\n## C) Niveau\nSenior (15 ans d'expérience professionnelle).`;
const guarded = applyFactGuards(denied, facts);
ok('guard writes the CV tool line over a Figma denial', /Figma \(10\/10\)/.test(guarded) && !/pas mentionné/.test(guarded));
ok('guard keeps the CV year count', /12 ans d'expérience professionnelle/.test(guarded) && !/15 ans/.test(guarded));
ok('guarded text no longer contradicts the CV', findFactContradictions(guarded, facts).length === 0);

const saved = `# Evaluation — Product Designer\n\n**Date:** 2026-09-24\n**Score:** ${extractEvaluationScore(sound)}\n\n---\n\n${sound}`;
const validation = validateReportContent(saved, extractEvaluationScore(sound), 'fireflies-ai', 'Product Designer');
ok('a scored draft with headings passes report validation', validation.valid === true);
