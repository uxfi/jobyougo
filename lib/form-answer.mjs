// One writer for dashboard question mode and auto-apply free text.
// Choice fields (dropdowns, yes/no) stay in apply-llm. Prose goes through here.
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { outputLanguageName } from '../profile-language.mjs';
import { fitToMaxLength, hasKpiClaim, polishApplicationAnswer, redactSideProjects, stripKpiFromText, stripSideProjectLines, usesSideProjectAsProof } from './application-writing.mjs';
import {
  QUESTION_SYSTEM,
  activeProofNames,
  closestCareerLines,
  documentedScaleFacts,
  dropQuietCareerLines,
  indexCareer,
  inferSideNames,
  isFactualQuestion,
  isMotivationQuestion,
  isScaleQuestion,
  labelLanguage,
  questionPromptEn,
  questionPromptFr,
} from './prompt-budget.mjs';

const careerCache = new Map();

/**
 * The career index of the apply spec's own CV, else of the local cv.md + digest.
 * A stored CV keeps the owner's article-digest.md (spec.digest null); any
 * other account's spec carries its own digest or '' and never reads the file.
 */
export function careerIndexFor(spec = {}, root) {
  if (typeof spec?.cvMarkdown === 'string') {
    return { ...indexCareer(spec.cvMarkdown), digest: spec.digest === null ? readDigest(root) : String(spec.digest || '') };
  }
  return loadCareerIndex(root);
}

function readDigest(root) {
  try { return readFileSync(join(root, 'article-digest.md'), 'utf8'); } catch { return ''; }
}

export function loadCareerIndex(root) {
  const path = join(root, 'cv.md');
  let mtime = 0;
  let text = '';
  try {
    mtime = statSync(path).mtimeMs;
    const hit = careerCache.get(root);
    if (hit && hit.mtime === mtime) return hit.value;
    text = readFileSync(path, 'utf8');
  } catch { /* no CV */ }
  const value = { ...indexCareer(text), digest: readDigest(root) };
  careerCache.set(root, { mtime, value });
  return value;
}

function asCareerIndex(career, index) {
  if (index && typeof index === 'object' && (index.employers || index.text || index.sideNames)) {
    return { digest: '', ...index };
  }
  if (career && typeof career === 'object' && (career.employers || career.text || career.sideNames)) {
    return { digest: '', ...career };
  }
  const text = String(career || '');
  return {
    text,
    employers: undefined,
    products: undefined,
    sideNames: inferSideNames(text),
    digest: '',
  };
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

// A denial negates work or experience ("I have never designed", "I don't
// have"). A negative answer to the question ("I never act on feedback one
// loud user raises", Pencil) is not one: it emptied the field twice.
// Past forms only: "I never ship without testing" and "I don't design for edge
// cases first" describe how the candidate works, not missing experience.
const WORK_PAST = 'worked|designed|built|shipped|led|had|used|managed|owned|launched|developed|created|delivered|done|been|touched';
const WORK_BASE = 'work|design|build|ship|lead|have|use|manage|own|launch|develop|create|deliver|touch';
const DENIED_WORK_FR = String.raw`(?:\S+\s+)?(?:travaillé|conçu|livré|eu|utilisé|dirigé|mené|lancé|développé|créé|été|fait|d['’]expérience)`;
const DENIAL_EN = [
  String.raw`i\s+(?:have\s+not|haven't|have\s+never)\s+(?:\w+\s+){0,2}?(?:${WORK_PAST})\b`,
  String.raw`i['’]ve\s+(?:never|not)\s+(?:\w+\s+){0,2}?(?:${WORK_PAST})\b`,
  String.raw`i\s+(?:did\s+not|didn't)\s+(?:\w+\s+){0,2}?(?:${WORK_BASE})\b`,
  String.raw`i\s+never\s+(?:\w+\s+)?(?:${WORK_PAST})\b`,
  String.raw`i\s+(?:do\s+not|don't)\s+have\b(?!\s+to\b)`,
].join('|');
const DENIAL_FR = String.raw`je\s+n['’]ai\s+(?:pas|jamais)\s+${DENIED_WORK_FR}`;
const DENIAL_OPEN = new RegExp(String.raw`^\s*(?:${DENIAL_EN}|${DENIAL_FR}|je\s+ne\s+suis\s+pas\b)`, 'i');
const DENIAL_NEAR = new RegExp(String.raw`\b(?:${DENIAL_EN}|${DENIAL_FR}|pas conçu|no (?:mobile )?(?:product|experience) (?:as|in))`, 'i');

export function opensWithDenial(text) {
  const head = String(text || '').trim().slice(0, 280);
  return DENIAL_OPEN.test(head) || DENIAL_NEAR.test(head);
}

function looksLikeTitle(token) {
  const text = String(token || '').trim();
  if (!text || /\.(io|ai|xyz|fr)\b/i.test(text)) return false;
  if (/\b(designer|founders?|co-founder|builder|consultant|freelance|independent|contributor|manager)\b/i.test(text)) return true;
  return /^(senior|product|ux|web|graphic|head|lead)\b/i.test(text) && text.split(/\s+/).length >= 2;
}

function addProofName(names, raw) {
  const token = String(raw || '').replace(/\s*\([^)]*\)\s*/g, ' ').split(/[/,]/)[0].trim();
  if (!token || token.length < 3 || !/[A-ZÀ-Ý]/.test(token[0]) || looksLikeTitle(token)) return;
  if (/[.!?]/.test(token) || token.split(/\s+/).length > 5) return;
  if (/^(designed|working|built|reviewed|owned|led|created)\b/i.test(token)) return;
  if (/^(android|ios|saas|ux|ui|hr|ev)$/i.test(token)) return;
  if (token.split(/\s+/).length >= 3 && !/\b(group|générale|worldwide|télévisions|paribas)\b/i.test(token)) return;
  names.add(token);
}

export function extractProofNames(text) {
  const names = new Set();
  for (const line of String(text || '').split('\n')) {
    const body = line.replace(/^\s*-\s*/, '').trim();
    if (!body) continue;
    for (const part of body.split(':')) {
      for (const piece of part.split(/,| and | et /)) addProofName(names, piece);
    }
  }
  return [...names];
}

// A described employer ("a fintech for retail investors") is proof too: the
// user does not want little-known company names, so first-person shipped
// work counts as much as a named employer.
export function answerMissesProof(answer, source) {
  const names = extractProofNames(source);
  if (!names.length) return false;
  const hay = String(answer || '').toLowerCase();
  if (names.some((name) => hay.includes(name.toLowerCase()))) return false;
  return !String(answer || '').split(/(?<=[.!?])\s+/).some(hasFirstPersonWork);
}

// "At OneAsset, I led…", "Chez Edenred, j'ai…": every answer opened the same
// way, on a name the reader often does not know.
// Case-sensitive on purpose: the employer starts with a capital ("At the
// core, I believe…" is not an employer opening).
const EMPLOYER_OPEN = /^\s*(?:[Aa]t|[Ww]hile at|[Dd]uring my (?:time|years) at|[Ii]n my (?:role|time|years) at|[Ww]orking at|[Cc]hez|[Aa]u sein d['’e]|[Ll]ors de mon passage chez|[Pp]endant mes années chez)\s+[A-ZÀ-Ý0-9][^,.!?\n]{1,59}?,?\s+(?:I|I['’](?:ve|d|m)|[Ww]e|[Jj]['’]|[Jj]e|[Nn]ous)\b/;

export function opensWithEmployer(text) {
  return EMPLOYER_OPEN.test(String(text || ''));
}

function escapeRe(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const KNOWN_PLATFORM = new Set(['android', 'ios', 'iphone', 'ipad', 'saas']);

export function claimsUnworkedBrand(answer, { company = '', offer = '', allowed = [] } = {}) {
  const text = String(answer || '');
  if (!text.trim()) return false;
  const allowedSet = new Set(allowed.map((name) => String(name || '').toLowerCase()).filter(Boolean));
  const foreign = [];
  const add = (name) => {
    const token = String(name || '').replace(/\s*\([^)]*\)\s*/g, ' ').trim();
    if (token.length < 3 || allowedSet.has(token.toLowerCase()) || KNOWN_PLATFORM.has(token.toLowerCase())) return;
    if (/^(the|company|role|designer)$/i.test(token)) return;
    foreign.push(token);
  };
  add(company);
  for (const part of String(company || '').split(/[\s,/]+/)) add(part);
  for (const name of extractProofNames(offer)) add(name);

  // Only a past-work claim counts. Naming the hiring company is what a
  // motivation answer does ("I am interested in Plancraft", "Plancraft's
  // mission", "bring that to the team at Plancraft"): flagging those sent
  // every motivation answer to the canned fallback.
  for (const sentence of text.split(/(?<=[.!?])\s+/).filter(Boolean)) {
    if (foreign.some((name) => claimsWorkAt(sentence, name))) return true;
    if (!hasFirstPersonWork(sentence)) continue;
    // An unnamed product shipped "in the Firefox mobile app" / "in Firefox for iOS".
    for (const match of sentence.matchAll(/\b(?:in the|in|dans(?: l['’])?)\s+([A-ZÀ-Ý][\w.-]+)(?:\s+for\s+(?:iOS|Android)|\s+mobile)?(?:\s+(?:app|application|product|produit))?\b/g)) {
      const name = match[1];
      if (KNOWN_PLATFORM.has(name.toLowerCase()) || allowedSet.has(name.toLowerCase())) continue;
      if (/^(the|this|that|our|my|a)$/i.test(name)) continue;
      if (/\b(?:for iOS|for Android|mobile app|application|product)\b/i.test(match[0]) || foreign.some((item) => item.toLowerCase() === name.toLowerCase())) {
        return true;
      }
    }
    for (const match of sentence.matchAll(/\b([A-ZÀ-Ý][\w.-]+)\s+for\s+(?:iOS|Android)\b/g)) {
      const name = match[1];
      if (!allowedSet.has(name.toLowerCase()) && !KNOWN_PLATFORM.has(name.toLowerCase())) return true;
    }
  }
  return false;
}

// Wanting, joining, admiring: the company is where the candidate is going,
// not where the work was done.
const INTENT_WORDS = /\b(want|wants|would|'d|will|could|hope|eager|excited|keen|forward|love to|like to|aim|plan to|join|joining|bring|apply|applying|contribute|interested|interest|drawn|attracted|attracts|admire|appeals?|why|motivat\w*|resonat\w*|align\w*|opportunit\w*|souhaite\w*|veux|voudrais|rejoindre|apporter|candidat\w*|intéress\w*|attir\w*)\b/i;
const FIRST_PERSON = /\b(i|i've|we|j['’]ai|je|nous)\b/i;
const WORK_VERBS = 'shipped|designed|led|owned|launched|built|drove|created|developed|delivered|redesigned|managed|ran|worked|improved|helped|contributed|supported|joined|optimi[sz]ed|refined|scaled|grew|migrated|implemented|integrated|conçu|conçue|mené|menée|livré|livrée|lancé|lancée|dirigé|dirigée|travaillé|développé|créé|amélioré|contribué|participé|rejoint|aidé';

function hasFirstPersonWork(sentence) {
  const verb = sentence.match(new RegExp(`\\b(?:${WORK_VERBS})\\b`, 'i'));
  if (!verb) return false;
  const before = sentence.slice(0, verb.index);
  return FIRST_PERSON.test(before) && !INTENT_WORDS.test(sentence);
}

function claimsWorkAt(sentence, name) {
  // A company named by a common word (Resilience, Remote) only counts when
  // the sentence writes it as the name: "designed for resilience" is not
  // work at Resilience.
  if (/^[A-Z][a-z]+$/.test(name) && !sentence.includes(name)) return false;
  const n = escapeRe(name);
  // "At Plancraft, I led…" / "Chez Plancraft, j'ai conçu…"
  const lead = sentence.match(new RegExp(`\\b(?:at|chez)\\s+${n}\\b[,:]?\\s+(?:i|i've|i have|we|j['’]ai|je|nous avons)\\s+(?:have\\s+|also\\s+)*(?:${WORK_VERBS})\\b`, 'i'));
  if (lead && !INTENT_WORDS.test(sentence.slice(Math.max(0, lead.index - 40), lead.index))) return true;
  // "I led … at Plancraft", "I designed … in the Plancraft app".
  for (const verb of sentence.matchAll(new RegExp(`\\b(?:${WORK_VERBS})\\b`, 'gi'))) {
    const before = sentence.slice(0, verb.index);
    if (!FIRST_PERSON.test(before) || INTENT_WORDS.test(before)) continue;
    const after = sentence.slice(verb.index + verb[0].length, verb.index + verb[0].length + 160);
    const place = after.match(new RegExp(`^([^.]*?)\\b(?:at|chez|for|pour|in|dans|on|sur|within)\\s+(?:the\\s+|l['’])?${n}(?:['’]s)?\\b`, 'i'));
    // "…at OneAsset, similar to the work at Kraken": a comparison, not a claim.
    if (place && !INTENT_WORDS.test(place[1]) && !/\b(similar to|like|the work|comparable|compared|akin|as (at|in|for)|close to)\b/i.test(place[1])) return true;
    if (new RegExp(`\\b${n}\\s+(?:for\\s+(?:ios|android)|mobile|app|application|product|platform)\\b`, 'i').test(after)) return true;
  }
  return false;
}

// Last resort when both drafts invent work: one plain sentence from the
// closest CV line ("At Edenred, I designed mobile apps for gas station
// location."). Nothing when the line has no action verb to reuse — the old
// template wrote "At LVMH Group I business analysis…" and padded every answer
// with "I owned the framing and the delivery. The path stayed usable."
export function draftFromClosest(closest, french, question = '') {
  const rows = (closest || []).filter(Boolean);
  const mobileAsk = /\b(mobile|ios|android|app|apps)\b/i.test(question);
  const picked = (mobileAsk && rows.find((row) => /\b(mobile|ios|android|iphone)\b/i.test(row))) || rows[0] || '';
  const line = String(picked).replace(/^\s*-\s*/, '').trim();
  if (!line) return '';
  const name = extractProofNames(line)[0];
  if (!name) return '';
  const EN_ACTION = /^(designed|built|led|owned|shipped|ran|redesigned|created|launched|delivered|managed|drove|developed)\b/i;
  const FR_ACTION = /^(conçu|mené|livré|dirigé|créé|lancé|développé|piloté|refondu)\b/i;
  const action = line.split(':').map((part) => part.trim())
    .filter((part) => (french ? FR_ACTION : EN_ACTION).test(part) && !looksLikeTitle(part))
    .pop() || '';
  const bit = stripKpiFromText(action).replace(/\s+/g, ' ').trim()
    .replace(/^[A-ZÀ-Ý]/, (ch) => ch.toLowerCase())
    .replace(/[.;,]+$/, '');
  if (!bit || bit.split(/\s+/).length < 3) return '';
  return french ? `J'ai ${bit} chez ${name}.` : `I ${bit} at ${name}.`;
}

// A why-us answer written as a case study: it opens on a past employer
// ("At Renault Group, I led…") or runs the decision/result template, and
// says nothing about the hiring company or the candidate's next step.
const STORY_TEMPLATE = /\b(i made the decision|i chose to|the result was|this experience (directly )?matches|matches your need|j['’]ai pris la décision|le résultat a été|cette expérience correspond)\b/i;

export function isStoryShapedMotivation(answer, { company = '', allowed = [] } = {}) {
  const text = String(answer || '').trim();
  if (!text) return false;
  if (STORY_TEMPLATE.test(text)) return true;
  const head = text.split(/(?<=[.!?])\s+/)[0] || '';
  const opensOnEmployer = /^(at|chez|while at|during my time at|pendant mes années chez)\s+[A-ZÀ-Ý]/i.test(head)
    && !(company && head.toLowerCase().includes(String(company).toLowerCase()));
  if (opensOnEmployer) return true;
  const named = allowed.filter((name) => name && name.length >= 3 && text.includes(name));
  return new Set(named).size >= 3;
}

export function namesCompany(answer, company) {
  const co = String(company || '').trim();
  if (!co || /^(company|the hiring company)$/i.test(co)) return true;
  const hay = String(answer || '').toLowerCase();
  // "Hipster Private Limited" is "Hipster" in the answer.
  const head = co.split(/\s+/)[0].toLowerCase();
  return hay.includes(co.toLowerCase()) || (head.length >= 3 && hay.includes(head));
}

export function isToolDump(question, answer) {
  if (/\b(tool|tools|figma|cursor|github|ai|llm|stack|method|workflow|processus|outils?)\b/i.test(question)) return false;
  const tools = [...new Set(String(answer || '').toLowerCase().match(/\b(cursor|claude|github|figma)\b/g) || [])];
  return tools.length >= 2;
}

export function formAnswerRequest({
  question,
  company,
  role,
  career = '',
  voice = '',
  facts = '',
  offerContext = '',
  index,
  digest = '',
  outputLanguage = '',
  ambition = '',
}) {
  const resolved = asCareerIndex(career, index);
  const sideNames = resolved.sideNames || inferSideNames(resolved.text || '');
  // French gets its own frame; Spanish, German and Italian use the English
  // frame with the answer language named (the resolver wrote English on a
  // Spanish form).
  const detected = labelLanguage(question);
  let lang = detected === 'fr' ? 'fr' : 'en';
  let answerLang = detected === 'es' ? 'Spanish' : detected === 'de' ? 'German' : detected === 'it' ? 'Italian' : '';
  // The profile's language.output (dashboard question mode) wins over the
  // question's language. When both agree the prompt is the usual one.
  let configured = false;
  if (outputLanguage) {
    const wantLang = /^fr\b/i.test(outputLanguage) ? 'fr' : 'en';
    const wantAnswerLang = wantLang === 'en' && !/^en\b/i.test(outputLanguage) ? outputLanguageName(outputLanguage) : '';
    if (wantLang !== lang || wantAnswerLang !== answerLang) {
      lang = wantLang;
      answerLang = wantAnswerLang;
      configured = true;
    }
  }
  const kind = isFactualQuestion(question)
    ? 'factual'
    : isScaleQuestion(question)
      ? 'scale'
      : isMotivationQuestion(question, company)
        ? 'motivation'
        : 'narrative';
  const instructions = lang === 'fr'
    ? questionPromptFr({ question, company, role, voice, configured })
    : questionPromptEn({ question, company, role, voice, answerLang, configured });
  const cleanLine = (line) => stripKpiFromText(line);
  const careerSource = resolved.text || String(career || '');
  // Independent products are redacted before the Closest-matches search too:
  // through the report text they pulled Creads.io lines into motivation answers.
  const offerHay = redactSideProjects(
    String(offerContext || '').replace(/[#*_>`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1400),
    question,
    sideNames,
  );
  const proofQuery = (kind === 'motivation' || /\b(relevant (project|experience)|tell us about yourself)\b/i.test(question))
    ? [question, role, offerHay].filter(Boolean).join(' ')
    : question;
  const closestRaw = closestCareerLines(proofQuery, careerSource, 6, {
    employers: resolved.employers,
    products: resolved.products,
    sideNames,
  });
  const closest = closestRaw.map(cleanLine).filter(Boolean);
  const careerText = cleanLine(dropQuietCareerLines(
    stripSideProjectLines(careerSource, question, sideNames),
    question,
    resolved,
  ));
  const scaleFacts = isScaleQuestion(question)
    ? documentedScaleFacts({
      digest: digest || resolved.digest || '',
      employers: resolved.employers || [],
      sideNames,
    })
    : '';
  const safeFacts = redactSideProjects(facts, question, sideNames);
  const safeOffer = redactSideProjects(offerContext, question, sideNames);
  // Where the candidate is heading (profile narrative.headline / next_role):
  // the "why this is my next step" half of a motivation answer.
  const safeAmbition = kind === 'motivation'
    ? stripKpiFromText(redactSideProjects(String(ambition || '').trim(), question, sideNames))
    : '';
  const user = [
    safeAmbition ? `## Ambition\nWhere you are heading. Use it for why this role is your next step; it is not proof.\n${safeAmbition}` : '',
    closest.length ? `## Closest matches\n${closest.join('\n')}` : '',
    careerText ? `## Full career\n${careerText}` : '',
    scaleFacts ? `## Facts\n${scaleFacts}` : '',
    safeFacts ? (scaleFacts ? safeFacts : `## Facts\n${safeFacts}`) : '',
    safeOffer ? `## Offer\nThis is the job you are applying to. Use requirements and Match CV here for why/fit/cover. It is not your experience.\n${safeOffer}` : '',
    instructions,
  ].filter(Boolean).join('\n\n');
  const titleSlice = (lines) => lines.map((line) => String(line).split(':').slice(0, 2).join(':')).join('\n');
  const allowedNames = [
    ...activeProofNames(resolved, question),
    ...extractProofNames(titleSlice(closest)),
  ].filter(Boolean);
  return { system: QUESTION_SYSTEM, user, lang, answerLang, kind, closest, sideNames, allowedNames, company };
}

// What was wrong with the draft, in words the model can act on. One generic
// "rejected for one of seven reasons" note left it guessing, so the rewrite
// often repeated the same fault.
const ISSUE_NOTES = {
  en: {
    denial: 'It denies work the career lists. Answer with the closest real work instead.',
    language: 'It is in the wrong language. Write in English only.',
    brand: (company) => `It claims work at ${company} or on its products. You never worked there: talk about ${company} only as the company you are applying to, and take your proof from Closest matches.`,
    'side-project': 'It uses an independent product as the proof. Use a professional employer from Closest matches.',
    junk: 'It is a contact detail, not an answer. Answer the question in sentences.',
    proof: 'The question asks for career evidence. Use one relevant professional detail from Closest matches and state your contribution accurately. Do not add a result absent from the facts.',
    opener: 'It opens with the employer ("At X, I…"). Open with the answer itself (how you work, a call you made, what you believe), then the proof.',
    tools: 'It is a list of tools. Describe the work and its result instead.',
    kpi: 'It quotes a number or KPI. Say the result in words.',
    story: 'It reads like a case study about a past employer and does not answer the motivation question directly. Keep the relevant company or role detail and cut the career summary.',
    company: (company) => `The question asks why ${company}. Name one specific detail from the Offer that explains your interest, without generic praise.`,
    slop: 'Replace stock application language with a plain, specific point grounded in the profile. Cut any sentence that adds no information.',
  },
  fr: {
    denial: 'Elle nie un travail que le parcours mentionne. Réponds avec le travail réel le plus proche.',
    language: 'Elle est dans la mauvaise langue. Écris uniquement en français.',
    brand: (company) => `Elle invente un travail chez ${company} ou sur ses produits. Tu n'y as jamais travaillé : parle de ${company} seulement comme de l'entreprise où tu postules, et prends ta preuve dans Closest matches.`,
    'side-project': 'Elle prend un produit indépendant comme preuve. Prends un employeur de Closest matches.',
    junk: "C'est une coordonnée, pas une réponse. Réponds à la question en phrases.",
    proof: "La question demande une preuve de parcours. Utilise un seul détail professionnel pertinent de Closest matches et décris exactement ta contribution, sans ajouter de résultat absent des faits.",
    opener: "Elle commence par l'employeur (« Chez X, j'ai… »). Commence par la réponse elle-même (ta façon de faire, un choix, ce que tu penses), puis la preuve.",
    tools: "C'est une liste d'outils. Décris le travail et son résultat.",
    kpi: 'Elle cite un chiffre ou un KPI. Dis le résultat en mots.',
    story: "La réponse ressemble à une étude de cas sur un ancien employeur et ne répond pas directement à la question de motivation. Garde le détail utile sur l'entreprise ou le poste et coupe le récit de carrière.",
    company: (company) => `La question demande pourquoi ${company}. Nomme un détail précis de l'Offre qui explique ton intérêt, sans compliment générique.`,
    slop: 'Remplace les formules toutes faites par une idée simple et précise, liée au profil. Coupe toute phrase qui n’ajoute aucune information.',
  },
};

function rewriteRequest(request, draft, issues = []) {
  const company = request.company || 'the hiring company';
  const lang = request.lang === 'fr' ? 'fr' : 'en';
  const notes = issues.map((code) => {
    // A Spanish / German / Italian question: the language note names it.
    if (code === 'language' && request.answerLang) return `It is in the wrong language. Write in ${request.answerLang} only.`;
    const note = ISSUE_NOTES[lang][code];
    return typeof note === 'function' ? note(company) : note;
  }).filter(Boolean);
  const head = lang === 'fr' ? 'Réécris la réponse ci-dessous.' : 'Rewrite the draft below.';
  const shape = lang === 'fr'
    ? 'Réponds à la question précise. Garde uniquement les détails qui la rendent plus claire ou plus crédible. N’ajoute aucun fait.'
    : 'Answer the specific question. Keep only details that make the answer clearer or more credible. Add no new claims.';
  return {
    system: request.system,
    user: `${request.user}\n\n${[head, ...notes, shape].join(' ')}\n\n${draft}`,
    lang: request.lang,
    answerLang: request.answerLang,
    company: request.company,
  };
}

// A narrative question answered with a bare phone number, e-mail or URL.
function isContactJunk(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (/^\+?[\d\s().-]{7,}$/.test(t)) return true;
  if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(t)) return true;
  return /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(t);
}

const GENERIC_APPLICATION_PHRASE = /\b(?:passionate about|excited to apply|thrilled to apply|unique blend|leverage my|game changer|meaningful impact|unlock (?:the|my|your)|cutting edge|fast paced environment|dynamic team|in today's (?:world|market)|je suis passionn[ée]e? par|ravi[ée]e? de (?:postuler|rejoindre)|mettre à profit|impact significatif|environnement dynamique|au cœur de|innovation de pointe)\b/i;
const CAREER_EVIDENCE_QUESTION = /\b(?:experience|example|time when|project|challenge|achievement|accomplishment|impact|result|work you|career|expertise|skill|strength|approach|handled|manage[dt]?|designed|built|led|delivered|tell us about yourself|expérience|exemple|moment où|projet|défi|réalisation|impact|résultat|travail|parcours|compétence|point fort|approche|géré|conçu|construit|livré|racontez|décrivez)\b/i;
const COMPANY_MOTIVATION_QUESTION = /\b(?:why (?:us|our company|this company)|what (?:attracts|interests|excites|draws) you (?:to|about) (?:us|our company|this company)|what draws you to|pourquoi (?:nous|cette entreprise)|qu'est-ce qui vous (?:attire|intéresse) chez (?:nous|cette entreprise)|por qu[eé] (?:nosotros|esta empresa)|warum (?:uns|unser unternehmen))\b/i;

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
  index,
  digest = '',
  maxChars = 0,
  outputLanguage = '',
  ambition = '',
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
    index,
    digest,
    outputLanguage,
    ambition,
  });
  const limit = Number(maxChars) > 0 ? Number(maxChars) : 0;
  const lengthNote = limit
    ? (request.lang === 'fr' ? `\n\nLa case accepte ${limit} caractères au plus.` : `\n\nThe box takes at most ${limit} characters.`)
    : '';
  const raw = await complete({
    system: request.system,
    user: `${request.user}${lengthNote}`,
    temperature: 0.1,
    max_tokens: 700,
  });
  const scale = isScaleQuestion(asked);
  const factual = isFactualQuestion(asked);
  const proofSource = [(request.closest || []).join('\n'), (request.allowedNames || []).join('\n')].filter(Boolean).join('\n');
  const sideNames = request.sideNames || [];
  const brandOpts = {
    company,
    offer: offerContext,
    allowed: request.allowedNames || extractProofNames(proofSource),
  };
  // Hard faults make an answer unusable. Soft ones only make it weaker: a
  // rewrite is asked for, but a draft with only soft faults is still sent
  // rather than the canned fallback.
  // "I don't have direct healthcare experience, but at Société Générale…"
  // concedes a gap and proves with real work: not a denial to rewrite away.
  const concedesThenProves = (text) => {
    const head = String(text || '').trim().split(/(?<=[.!?])\s+/)[0] || '';
    if (!/\b(but|however|yet|though|although|mais|cependant|pourtant|en revanche)\b/i.test(head)) return false;
    return (request.allowedNames || []).some((name) => name && String(text).includes(name));
  };
  const hardIssues = (text) => {
    if (!String(text || '').trim()) return ['empty'];
    const spoken = answerLanguage(text);
    // answerLanguage reads French and English only: for a Spanish / German /
    // Italian question either of those is the wrong language.
    const wrongLanguage = request.answerLang ? !!spoken : spoken && spoken !== request.lang;
    return [
      opensWithDenial(text) && !concedesThenProves(text) && 'denial',
      wrongLanguage && 'language',
      !factual && claimsUnworkedBrand(text, brandOpts) && 'brand',
      usesSideProjectAsProof(asked, text, sideNames) && 'side-project',
      !factual && isContactJunk(text) && 'junk',
      GENERIC_APPLICATION_PHRASE.test(text) && 'slop',
    ].filter(Boolean);
  };
  // A why-us answer is about the company, not an employer story: the "names
  // no employer" fault turned "Why Kraken?" into a Renault paragraph.
  const motivation = request.kind === 'motivation';
  const asksWhyCompany = motivation && (
    (company && String(asked).toLowerCase().includes(String(company).toLowerCase()))
    || COMPANY_MOTIVATION_QUESTION.test(asked)
  );
  const softIssues = (text) => [
    !factual && !scale && !motivation && CAREER_EVIDENCE_QUESTION.test(asked) && answerMissesProof(text, proofSource) && 'proof',
    !factual && opensWithEmployer(text) && 'opener',
    motivation && isStoryShapedMotivation(text, { company, allowed: request.allowedNames || [] }) && 'story',
    asksWhyCompany && !namesCompany(text, company) && 'company',
    isToolDump(asked, text) && 'tools',
    !factual && !scale && hasKpiClaim(text) && 'kpi',
  ].filter(Boolean);
  const polish = (value) => polishApplicationAnswer(extractAnswerBody(value), { keepScale: scale, sideNames });

  const first = polish(raw);
  const firstIssues = [...hardIssues(first), ...softIssues(first)];
  let answer = first;
  if (firstIssues.length) {
    const again = rewriteRequest(request, first, firstIssues.filter((code) => code !== 'empty'));
    const retried = polish(await complete({
      system: again.system,
      user: `${again.user}${lengthNote}`,
      temperature: 0.1,
      max_tokens: 700,
    }));
    // The rewrite first on a tie: it was written with the fault named.
    const usable = [retried, first]
      .filter((text) => text && !hardIssues(text).length)
      .sort((a, b) => softIssues(a).length - softIssues(b).length);
    answer = usable[0] || '';
    // A motivation question gets no story fallback: blank beats off-topic.
    if (!answer && !motivation) {
      const fallback = draftFromClosest(request.closest, request.lang === 'fr', asked);
      answer = fallback && !hardIssues(fallback).length ? fallback : '';
    }
  }
  if (limit) answer = fitToMaxLength(answer, limit);
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
