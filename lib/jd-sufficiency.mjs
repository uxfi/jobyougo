// Whether a fetched job description is enough to evaluate. A thin page
// (a listing shell, a cookie wall, a short teaser in another language) gives
// the model nothing about the offer, and it then scores the candidate's own
// CV instead: the Eyzee posting (justjoin.it, 2026-10-19) came back evaluated
// against OneAsset, the candidate's current employer, at 4.9/5.
// Such a JD is parked for review instead of being sent to the model.

const STOP = new Set(['the', 'and', 'for', 'with', 'des', 'les', 'une', 'sa', 's.a', 'sp', 'z', 'o.o', 'inc', 'ltd', 'llc', 'gmbh', 'sas', 'sarl', 'spa', 'srl', 'ag', 'bv', 'oy', 'ab']);

function tokens(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOP.has(t));
}

/**
 * @param {string} text fetched JD text
 * @param {{ company?: string, title?: string, minChars?: number, anchorChars?: number }} opts
 * @returns {{ ok: boolean, reason: string, chars: number, anchored: boolean }}
 */
export function jdSufficiency(text, { company = '', title = '', minChars = 1200, anchorChars = 4000 } = {}) {
  const body = String(text || '').replace(/\s+/g, ' ').trim();
  const lower = body.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const companyTokens = tokens(company);
  const titleTokens = tokens(title);
  const companyHit = companyTokens.length ? companyTokens.some((t) => lower.includes(t)) : null;
  const titleHit = titleTokens.length ? titleTokens.some((t) => lower.includes(t)) : null;
  const anchored = companyHit !== false || titleHit === true;
  const chars = body.length;
  if (chars < minChars) return { ok: false, reason: `job description too short (${chars} chars)`, chars, anchored };
  if (chars < anchorChars && companyHit === false && titleHit === false) {
    return { ok: false, reason: `job description (${chars} chars) never names the company or the role`, chars, anchored };
  }
  return { ok: true, reason: '', chars, anchored };
}

// Distinct function words per language. A posting written in Polish (Eyzee,
// justjoin.it) was scored as if it said nothing, and the model filled the gap
// with the CV: the evaluation names the language so the model reads it as is.
const LANGUAGE_WORDS = {
  pl: ['oraz', 'jest', 'dla', 'się', 'sie', 'nie', 'jesteśmy', 'doświadczenie', 'doswiadczenie', 'wymagania', 'oferujemy', 'znajomość', 'znajomosc', 'praca', 'pracy', 'zespół', 'lub', 'które', 'ktore', 'twoje', 'ciebie', 'naszym', 'projektowanie'],
  de: ['und', 'der', 'die', 'das', 'mit', 'für', 'wir', 'ist', 'eine', 'nicht', 'erfahrung', 'auf', 'sie', 'unsere', 'bei'],
  es: ['el', 'los', 'las', 'con', 'para', 'experiencia', 'una', 'que', 'del', 'por', 'nuestro', 'trabajo'],
  it: ['il', 'con', 'per', 'esperienza', 'una', 'che', 'della', 'nel', 'lavoro', 'sono', 'nostro'],
  pt: ['com', 'para', 'experiência', 'uma', 'que', 'não', 'você', 'dos', 'das', 'trabalho', 'nosso'],
  nl: ['het', 'een', 'met', 'voor', 'wij', 'ervaring', 'van', 'je', 'ons', 'jouw', 'bij'],
  fr: ['et', 'les', 'des', 'avec', 'pour', 'une', 'vous', 'nous', 'expérience', 'du', 'est', 'sur'],
  en: ['the', 'and', 'with', 'for', 'you', 'we', 'our', 'experience', 'to', 'of', 'is', 'are', 'will'],
};

export const LANGUAGE_LABELS = Object.freeze({
  pl: 'polonais', de: 'allemand', es: 'espagnol', it: 'italien', pt: 'portugais', nl: 'néerlandais', fr: 'français', en: 'anglais',
});

/**
 * Main language of a job description, or '' when the text is too short to tell.
 * @param {string} text
 * @returns {{ code: string, label: string, hits: number }}
 */
export function detectJdLanguage(text) {
  const words = String(text || '').toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
  if (words.length < 40) return { code: '', label: '', hits: 0 };
  let best = { code: '', hits: 0 };
  let second = 0;
  for (const [code, list] of Object.entries(LANGUAGE_WORDS)) {
    const set = new Set(list);
    let hits = words.filter((w) => set.has(w)).length;
    // Letters only Polish uses.
    if (code === 'pl') hits += (String(text).match(/[ąęłńśźż]/gi) || []).length >> 2;
    if (hits > best.hits) { second = best.hits; best = { code, hits }; } else if (hits > second) second = hits;
  }
  if (best.hits < 6 || best.hits < second * 1.5) return { code: '', label: '', hits: best.hits };
  return { code: best.code, label: LANGUAGE_LABELS[best.code], hits: best.hits };
}

function oneLine(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

/**
 * The pipeline's task line. It names the offer, the exact header, the
 * candidate's own employers (never the offer) and a foreign-language posting.
 * The old line, "Évalue l'offre ci-dessus", came right after the CV facts that
 * end on the OneAsset role: the Eyzee posting was evaluated as OneAsset twice
 * (2026-10-19).
 * @param {{ company?: string, title?: string, url?: string, language?: string, ownEmployers?: string[] }} opts
 */
export function offerTaskLine({ company = '', title = '', url = '', language = '', ownEmployers = [] } = {}) {
  const c = oneLine(company);
  const t = oneLine(title);
  const who = [c, t].filter(Boolean).join(' — ');
  const own = [...new Set(ownEmployers.map(oneLine).filter(Boolean))]
    .filter((name) => !c || name.toLowerCase() !== c.toLowerCase())
    .slice(0, 8);
  return [
    '---',
    `Évalue l'offre${who ? ` « ${who} »` : ''} : le texte du bloc « ## Offre », entre « DÉBUT DE L'OFFRE » et « FIN DE L'OFFRE ».${url ? ` URL: ${url}.` : ''}`,
    c && t ? `Première ligne exacte : # Evaluation: ${c} — ${t}` : '',
    c ? `L'entreprise évaluée est ${c}${c.endsWith('.') ? '' : '.'}${own.length ? ` ${own.join(', ')} : employeurs ou projets du candidat (CV), jamais l'offre. N'évalue pas ces postes.` : ''}` : '',
    language && language !== 'fr' && language !== 'en'
      ? `L'annonce est rédigée en ${LANGUAGE_LABELS[language] || language} : lis-la dans cette langue, relie ses exigences au CV, et ne remplace pas son contenu par celui du CV.`
      : '',
    'Applique le contrat système (A, B, C, D, G). Pas de plan CV, pas d\'entretien, pas de cover letter.',
  ].filter(Boolean).join('\n');
}

/** Header placed before the JD so the model knows which offer it scores. */
export function offerAnchor({ company = '', title = '', url = '' } = {}) {
  const who = [company, title].filter(Boolean).join(' - ');
  if (!who && !url) return '';
  return [
    '## Offer to evaluate',
    who ? `Offer: ${who}` : '',
    url ? `URL: ${url}` : '',
    "Evaluate this company and this role only. The employers listed in the candidate's CV (current or past) are not the offer.",
    '',
  ].filter((line, i, all) => line || i === all.length - 1).join('\n');
}