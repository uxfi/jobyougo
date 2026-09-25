/**
 * Qwen often returns a readable evaluation that still cannot be saved:
 * no **Score:** line, headings written as "A)" instead of "## A)", and
 * claims that contradict the CV fact sheet (a made-up year count, Figma
 * described as absent). These helpers detect that and build one repair prompt.
 */

import { extractEvaluationScore, isPlaceholderScore } from './report-validation.mjs';

export function normalizeEvalHeadings(text) {
  return String(text || '').replace(/^(?:#{1,6}\s*)?([A-G]\))\s+/gm, '## $1 ');
}

function designYears(facts) {
  return String(facts || '').match(/Années d'expérience design écrites dans le CV : (\d+)/)?.[1] || '';
}

/**
 * @param {string} text
 * @param {string} facts
 * @returns {string[]}
 */
export function findFactContradictions(text, facts) {
  const src = String(text || '');
  const factText = String(facts || '');
  const issues = [];
  const expected = designYears(factText);
  if (expected) {
    const claims = [
      ...src.matchAll(/(\d+)\s+ans d['’]expérience professionnelle/gi),
      ...src.matchAll(/(\d+)\s+ans d['’]expérience en design/gi),
    ];
    for (const match of claims) {
      if (match[1] !== expected) issues.push(`années: le CV dit ${expected}, le texte dit ${match[1]}`);
    }
  }
  if (/\bFigma\b/.test(factText) && FIGMA_DENIAL.test(src)) {
    issues.push('Figma est écrit dans le CV et le texte le traite comme absent');
  }
  if (/^-\s+Postes :/m.test(factText) && /ne précise pas d['’]expérience|seulement des projets personnels|niveau inconnu|aucune preuve d['’]expérience professionnelle/i.test(src)) {
    issues.push('le texte nie les postes listés dans le CV');
  }
  const namesCountries = /\b(UK|India|Philippines|Portugal|Royaume-Uni|Inde)\b/i.test(src);
  const opensThailand = /inclut la Thaïlande|Thaïlande n['’]est pas exclue|Thailand is included/i.test(src);
  if (/respective country/i.test(src) && namesCountries && opensThailand) {
    issues.push('« respective country » ne couvre pas un pays absent de la liste');
  }
  return issues;
}

export function draftNeedsRepair(text, facts) {
  const normalized = normalizeEvalHeadings(text);
  const issues = findFactContradictions(normalized, facts);
  const missingScore = isPlaceholderScore(extractEvaluationScore(normalized));
  const sections = (normalized.match(/^## [A-G]\)/gm) || []).length;
  return {
    issues,
    missingScore,
    sections,
    repair: issues.length > 0 || missingScore || sections < 2,
  };
}

const FIGMA_DENIAL = /figma[\s\S]{0,400}(non explicit|pas explicit|aucune mention|n['’]est pas mention|not explicitly|implicite|absence de preuve|via figmol)/i;

/**
 * Last pass before save. Rewrites a year count or a Figma denial that the
 * repair model repeated, using only the lines already copied from the CV.
 * @param {string} text
 * @param {string} facts
 */
export function applyFactGuards(text, facts) {
  let src = String(text || '');
  const factText = String(facts || '');
  const expected = designYears(factText);
  if (expected) {
    const fixYears = (full, count) => (count === expected ? full : full.replace(count, expected));
    src = src.replace(/(\d+)\s+ans d['’]expérience professionnelle/gi, fixYears);
    src = src.replace(/(\d+)\s+ans d['’]expérience en design/gi, fixYears);
  }
  const toolLine = factText.split('\n').find(line => /\bFigma\b/.test(line));
  if (toolLine && FIGMA_DENIAL.test(src)) {
    const quoted = toolLine.replace(/^-\s*/, '').trim();
    src = src.replace(
      /[^.!\n]*[Ff]igma[^.!\n]*(?:non explicit|pas explicit|aucune mention|n['’]est pas mention|not explicitly|implicite|absence de preuve|via [Ff]igmol)[^.!\n]*[.!]?/g,
      `Figma est confirmé : ${quoted}. `,
    );
  }
  return src;
}

export function buildEvalRepairPrompt(draft, facts) {
  return `Tu corriges une évaluation d'offre. Le brouillon ci-dessous est la seule analyse à réécrire. Les faits du CV sont imposés.

FAITS DU CV
${facts || '(aucun extrait)'}

RÈGLES
- Ligne 1 : # Evaluation: {Company} — {Role}
- Ligne 2 : **Score:** X.X/5 avec un nombre. Jamais un tiret.
- Titres exacts, chacun sur sa ligne : ## A) Résumé du rôle, ## B) Match CV, ## C) Niveau et stratégie, ## D) Comp et demande, ## G) Légitimité
- Le nombre d'années d'expérience design est celui des faits. N'en écris pas un autre.
- Si les faits contiennent une ligne d'outils, cite-la. Figma est confirmé dès que la ligne le nomme. Figmol n'est pas un outil de cette ligne : c'est l'outil interne d'OneAsset. Ne pas le ranger avec Figma, Cursor, Claude ou GitHub. Une option non nommée (Auto-Layout, Variables) est un écart partiel, pas une absence de Figma.
- « anywhere in your respective country » signifie dans le pays d'emploi, pas dans le monde. Si l'annonce liste des pays et que ni la France ni la Thaïlande n'y sont, la localisation du candidat n'est pas couverte. Ne dis pas que la Thaïlande est incluse.
- N'invente aucun employeur, chiffre ou outil.

BROUILLON
${String(draft || '').slice(0, 9000)}`;
}
