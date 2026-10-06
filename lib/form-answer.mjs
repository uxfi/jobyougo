// One writer for dashboard question mode and auto-apply free text.
// Choice fields (dropdowns, yes/no) stay in apply-llm. Prose goes through here.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { polishApplicationAnswer } from './application-writing.mjs';
import {
  QUESTION_SYSTEM,
  experienceIndex,
  questionLanguage,
  questionPromptEn,
  questionPromptFr,
} from './prompt-budget.mjs';

const careerCache = new Map();

export function loadCareerIndex(root) {
  if (!careerCache.has(root)) {
    let text = '';
    try { text = readFileSync(join(root, 'cv.md'), 'utf8'); } catch { /* no CV */ }
    careerCache.set(root, experienceIndex(text));
  }
  return careerCache.get(root);
}

export function extractAnswerBody(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  const labeled = text.match(/\*\*Question\s*:?\s*\*\*[^\n]*\n+([\s\S]*?)(?:\n---\s*\n|\n_Note\b|$)/i);
  const body = labeled ? labeled[1] : text.replace(/^##[^\n]*\n+/, '');
  return body.replace(/^\*\*Question\s*:?\s*\*\*[^\n]*\n+/i, '').trim();
}

export function answerLanguage(text) {
  const sample = String(text || '');
  const fr = (sample.match(/\b(je|j'ai|les|des|une|dans|pour|avec|mon|ma|mes|été|conçu|travaillé)\b/gi) || []).length;
  const en = (sample.match(/\b(i|the|and|with|for|my|was|designed|worked|have)\b/gi) || []).length;
  if (fr === 0 && en === 0) return null;
  if (fr === en) return null;
  return fr > en ? 'fr' : 'en';
}

const DENIAL_OPEN = /^\s*(?:i\s+(?:have\s+not|haven't|did\s+not|didn't|have\s+never|never)\b|i\s+(?:do\s+not|don't)\s+have\b|je\s+n['’]ai\s+(?:pas|jamais)\b|je\s+ne\s+(?:suis|ai)\s+pas\b)/i;

export function opensWithDenial(text) {
  return DENIAL_OPEN.test(String(text || '').trim());
}

export function formAnswerRequest({ question, company, role, career = '', voice = '', facts = '', offerContext = '' }) {
  const lang = questionLanguage(question);
  const instructions = lang === 'fr'
    ? questionPromptFr({ question, company, role, voice })
    : questionPromptEn({ question, company, role, voice });
  const user = [
    career ? `## Full career\n${career}` : '',
    facts ? `## Facts\n${facts}` : '',
    offerContext ? `## Offer\n${offerContext}` : '',
    instructions,
  ].filter(Boolean).join('\n\n');
  return { system: QUESTION_SYSTEM, user, lang };
}

function rewriteRequest(request, draft) {
  const note = request.lang === 'fr'
    ? 'La réponse ci-dessous est refusée : elle commence par un refus, ou elle n\'est pas en français. Réécris-la avec les mêmes règles. Ne nie pas un travail déjà présent dans le parcours.'
    : 'The draft below is rejected: it opens with a denial, or it is not in English. Rewrite it with the same rules. Do not deny work that is already in the career.';
  return {
    system: request.system,
    user: `${request.user}\n\n${note}\n\n${draft}`,
    lang: request.lang,
  };
}

export function formAnswerBlock({ company, role, question, answer, french }) {
  const label = french ? '**Question :**' : '**Question:**';
  return `## ${company} — ${role}\n${label} ${question}\n\n${answer}`.trim();
}

export async function writeFormAnswer({
  question,
  company = 'Company',
  role = 'Role',
  career = '',
  voice = '',
  facts = '',
  offerContext = '',
  complete,
}) {
  const asked = String(question || '').trim();
  if (!asked) return { answer: '', block: '' };
  const request = formAnswerRequest({
    question: asked,
    company,
    role,
    career,
    voice,
    facts,
    offerContext,
  });
  const raw = await complete({
    system: request.system,
    user: request.user,
    temperature: 0.1,
    max_tokens: 700,
  });
  let answer = polishApplicationAnswer(extractAnswerBody(raw));
  const spoken = answerLanguage(answer);
  if (opensWithDenial(answer) || (spoken && spoken !== request.lang)) {
    const again = rewriteRequest(request, answer);
    const retriedRaw = await complete({
      system: again.system,
      user: again.user,
      temperature: 0.1,
      max_tokens: 700,
    });
    const retried = polishApplicationAnswer(extractAnswerBody(retriedRaw));
    if (retried) answer = retried;
  }
  return {
    answer,
    block: formAnswerBlock({
      company,
      role,
      question: asked,
      answer,
      french: request.lang === 'fr',
    }),
  };
}
