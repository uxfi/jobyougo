/**
 * Shared field classification for apply-runner (Playwright window) and
 * apply-bridge (Chrome extension tab). Same rules, same plans — keep them
 * aligned: any change here affects both browser paths.
 */
import { fitToMaxLength, hasKpiClaim, polishApplicationAnswer, usesSideProjectAsProof } from './application-writing.mjs';
import { answerLanguage, claimsUnworkedBrand, opensWithDenial } from './form-answer.mjs';
import {
  trivialFieldPlan,
  fileUploadPlan,
  isSecretCredentialField,
  isPersonalLegalQuestion,
  isResumePasteField,
  isAddressLineField,
  isRequiredAffirmation,
  isIdentityRepeatField,
  isPhoneExtensionField,
  isPhoneDeviceTypeField,
  travelOrRelocatePlan,
  employmentHistoryPlan,
  screeningChoicePlan,
  practiceFrom,
  languageQuestionPlan,
  unknownThirdPartyPlan,
  isAvailabilityStartField,
  looksLikeDialCodeField,
  looksLikePhoneNumberField,
  phoneFieldIncludesDialCode,
  formDialCode,
  nationalPhoneNumber,
  isComboboxField,
  isListField,
  fieldLooksRequired,
  fieldSearchText,
  normalizedFieldLabel,
  isApplicationGateConsent,
  isCandidateFullNameField,
  looksLikeMarketingEmailField,
  isBareGivenNameLabel,
  isIntlTelInputPicker,
  isPlaceIdentityField,
} from './apply-fill-guards.mjs';
import { SALARY_LABEL_RE, currencyFromLabel, formSalaryValue } from './apply-salary.mjs';
import { choiceKind, optionsAreYesNo, optionsLookLikeWorkPolicy, remotePolicyPlan } from './apply-option-match.mjs';
import { policyPlan, workAuthorizedFor } from './apply-policy.mjs';
import { candidateIsIn, isEuCountry, placesIn } from './apply-places.mjs';
import { labelLanguage } from './prompt-budget.mjs';

// "How did you hear about us?" in the languages the boards use.
const HEAR_ABOUT_RE = /how did you (hear|find|learn)|where did you (hear|find|see|learn)|referral source|how you (heard|found)|comment avez-vous (entendu|trouv[ée]|connu)|source of (application|candidature)|origine de (la |votre )?candidature|c[oó]mo (nos )?(conociste|te enteraste|supiste)|wie (sind sie|bist du) auf uns|wie haben sie von uns|hoe heb je ons gevonden|come ci hai conosciuto/;
// Someone else's details: a referee, a supervisor, an emergency contact.
const THIRD_PARTY_CONTACT_RE = /\breferee|\breferences?\b(?! available)|\bsupervisor|\bline manager|\bmanager'?s? (name|e-?mail|phone)|emergency|next of kin|contact person|guarantor|\bparrain|r[ée]f[ée]rent/;

// UTC offsets for the zones screening questions name. null = no zone named.
// Abbreviations are matched in capitals only: lower-case "est", "cet" and
// "ist" are French and German words ("Quel est…", "cet horaire", "Ist Ihre…").
function questionUtcOffset(text) {
  const raw = String(text || '');
  const t = raw.toLowerCase();
  const m = t.match(/(?:gmt|utc)\s*([+-])\s*(\d{1,2})(?::?(30))?/);
  if (m) return (m[1] === '-' ? -1 : 1) * (Number(m[2]) + (m[3] ? 0.5 : 0));
  if (/\b(PST|PDT)\b/.test(raw) || /\bpacific\b/.test(t)) return -8;
  if (/\b(MST|MDT)\b/.test(raw) || /\bmountain (time|standard)\b/.test(t)) return -7;
  if (/\b(CST|CDT)\b/.test(raw) || /central (us|time|standard)/.test(t)) return -6;
  if (/\b(EST|EDT)\b/.test(raw) || /\beastern\b/.test(t)) return -5;
  if (/\b(BST|GMT)\b/.test(raw) || /\buk time\b|\blondon\b/.test(t)) return 0;
  if (/\b(CET|CEST)\b/.test(raw) || /central european|\beurope(an)?\b|\bparis\b|\bberlin\b/.test(t)) return 1;
  if (/\b(EET|EEST)\b/.test(raw)) return 2;
  if (/\bIST\b/.test(raw) || /\bindia\b/.test(t)) return 5.5;
  if (/\bICT\b/.test(raw) || /\bbangkok\b|indochina/.test(t)) return 7;
  if (/\b(SGT|HKT)\b/.test(raw) || /singapore|hong kong|beijing|\bperth\b|\bapac\b|asia[- ]pacific/.test(t)) return 8;
  if (/\b(JST|KST)\b/.test(raw) || /tokyo|seoul/.test(t)) return 9;
  if (/\b(AEST|AEDT)\b/.test(raw) || /sydney|melbourne/.test(t)) return 10;
  return null;
}

function candidateUtcOffset(id = {}) {
  const t = `${id.timezone || ''} ${id.city || ''} ${id.country || ''}`.toLowerCase();
  if (/\bict\b|utc\s*\+\s*7|gmt\s*\+\s*7|bangkok|thailand|tha[iï]lande|phuket/.test(t)) return 7;
  if (/\bcet\b|\bcest\b|utc\s*\+\s*1|paris|france/.test(t)) return 1;
  return questionUtcOffset(String(id.timezone || ''));
}

// First matching pattern wins, not the first row in the DOM.
const HEAR_ABOUT_RANK = [
  /\blinkedin\b/i,
  /\barbeitnow\b/i,
  /\b(indeed|glassdoor|welcome to the jungle|wttj|monster|stepstone|xing)\b/i,
  /job board|job site|career site|company website|\bwebsite\b/i,
  /\b(google|web search|search engine)\b/i,
  /employee referral|\breferral\b|\breferred\b/i,
  /\b(other|autre)\b/i,
];

const STOPWORDS = new Set(['the', 'a', 'an', 'to', 'of', 'in', 'for', 'and', 'or', 'you', 'your', 'is', 'are', 'do', 'does', 'this', 'that', 'with', 'us', 'we', 'at', 'on', 'what', 'why', 'how', 'about', 'tell', 'please', 'would', 'be', 'it', 'le', 'la', 'les', 'de', 'des', 'un', 'une', 'vous', 'pour', 'et']);

// Job-domain nouns that appear in nearly EVERY question on an application form
// and therefore carry no power to tell two questions apart. Without this, a
// single shared "role" was enough to score 0.5 and clear the 0.4 threshold:
// "What is your current role?" {current, role} matched "How did you hear about
// this role?" {did, hear, role} and the form was submitted with the
// how-did-you-hear answer in the current-role box. Dropping these leaves only
// the words that actually discriminate ("interested", "hear", "experience").
const GENERIC_TERMS = new Set(['role', 'roles', 'position', 'positions', 'job', 'jobs', 'company', 'companies', 'work', 'working', 'poste', 'entreprise', 'travail']);

export function tokens(s) {
  return new Set(String(s).toLowerCase().replace(/[^a-z0-9àâéèêëîïôùûüç\s]/gi, ' ').split(/\s+/).filter(w => w.length > 2 && !STOPWORDS.has(w) && !GENERIC_TERMS.has(w)));
}

export function similarity(a, b) {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.min(ta.size, tb.size);
}

// A French question gets a French answer: the report's English drafts went
// into Inqom's "Lettre de motivation" as is.
function sameLanguage(label, answer) {
  const asked = labelLanguage(label);
  const written = answerLanguage(answer);
  return !asked || !written || asked === written;
}

export function bestAnswerFor(label, answers, usedAnswers = new Set(), sideNames = [], opts = {}) {
  // Prefer an unused answer when scores are close, so two similar questions
  // ("why us?" / "why this role?") don't get the exact same text.
  const scored = answers
    .map(qa => ({ qa, s: similarity(label, qa.question) }))
    .filter(x => x.s >= 0.4
      && sameLanguage(label, x.qa.answer)
      && !opensWithDenial(x.qa.answer)
      && !usesSideProjectAsProof(label, x.qa.answer, sideNames)
      && !hasKpiClaim(x.qa.answer)
      && !claimsUnworkedBrand(x.qa.answer, { company: opts.company, allowed: opts.allowedNames || [] })
      && !/^\s*\+?\d[\d\s.-]{6,}\s*$/.test(x.qa.answer))
    .sort((a, b) => b.s - a.s);
  if (!scored.length) return null;
  const fresh = scored.find(x => !usedAnswers.has(x.qa.question) && x.s >= scored[0].s - 0.2);
  if (fresh) return fresh.qa;
  // The best match was already consumed by an earlier (similar) question. Don't
  // reuse it verbatim — return null so this field goes to the LLM resolver,
  // which writes a distinct answer for its specific angle.
  if (usedAnswers.has(scored[0].qa.question)) return null;
  return scored[0].qa;
}

// Where the candidate found the posting, read off its URL: utm_source=LinkedIn,
// a Welcome to the Jungle / Arbeitnow page, or an ATS careers page the scan
// fetched directly. '' when the URL says nothing.
export function applicationSource(jobUrl = '') {
  const url = String(jobUrl || '');
  if (!url) return '';
  let tag = '';
  try {
    const u = new URL(url);
    tag = ['utm_source', 'source', 'src', 'ref', 'lever-source', 'gh_src']
      .map((k) => u.searchParams.get(k) || '').join(' ');
  } catch { /* not a URL */ }
  const blob = `${tag} ${url}`.toLowerCase();
  if (/linkedin/.test(blob)) return 'LinkedIn';
  if (/welcometothejungle|\bwttj\b/.test(blob)) return 'Welcome to the Jungle';
  if (/arbeitnow/.test(blob)) return 'Arbeitnow';
  if (/indeed\./.test(blob)) return 'Indeed';
  if (/glassdoor/.test(blob)) return 'Glassdoor';
  if (/weworkremotely/.test(blob)) return 'We Work Remotely';
  if (/himalayas/.test(blob)) return 'Himalayas';
  if (/wellfound|angel\.co/.test(blob)) return 'Wellfound';
  if (/otta\.com|welcome-to-the-jungle/.test(blob)) return 'Welcome to the Jungle';
  if (/justjoin\.it/.test(blob)) return 'Just Join IT';
  if (/builtin\.com/.test(blob)) return 'Built In';
  if (/remoteok/.test(blob)) return 'Remote OK';
  if (/xing\./.test(blob)) return 'Xing';
  if (/ashbyhq|greenhouse|lever\.co|workable|teamtailor|smartrecruiters|recruitee|personio|myworkdayjobs|bamboohr|jobvite|icims|successfactors|careers?\.|\/careers?\b|\/jobs?\b/.test(blob)) {
    return 'Company website';
  }
  return '';
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hearAboutPlan(id, source) {
  if (!source || source === 'LinkedIn') {
    return {
      value: source || id.howDidYouHear,
      selectText: 'LinkedIn',
      selectRank: HEAR_ABOUT_RANK,
      selectPrefer: /linkedin|indeed|glassdoor|welcome to the jungle|arbeitnow|xing|job board|job site|career site|company website|\bwebsite\b|\bgoogle\b|employee referral|\breferral\b|\breferred\b|\bother\b|\bautre\b/i,
    };
  }
  if (source === 'Company website') {
    return {
      value: 'Company careers page',
      selectText: 'Company website',
      selectRank: [
        /company (website|site|careers?)|careers? (site|page|website)|our (website|careers)|\bwebsite\b|site (de l.entreprise|carri[eè]re)/i,
        /job board|job site|job portal|online job/i,
        /\b(other|autre)\b/i,
        /\blinkedin\b/i,
      ],
      selectPrefer: /company (website|site|careers?)|careers? (site|page)|\bwebsite\b|job board|\bother\b|\bautre\b/i,
    };
  }
  const own = new RegExp(escapeRe(source).replace(/\\? /g, '\\s*'), 'i');
  return {
    value: source,
    selectText: source,
    selectRank: [
      own,
      /job board|job site|job portal|online job|internet/i,
      /\b(other|autre)\b/i,
      /career site|\bwebsite\b/i,
    ],
    selectPrefer: new RegExp(`${own.source}|job board|job site|\\bother\\b|\\bautre\\b`, 'i'),
  };
}

// Degree, school, field and year from the CV's Education block.
function educationPlan(f, id, s) {
  const edu = (id.education || [])[0];
  // An essay ("Briefly summarize your qualifications for this role") is not
  // the degree box.
  if (f.tag === 'textarea' || f.type === 'textarea') return null;
  const asksLevel = /highest (level of )?(education|degree|qualification)|education(al)? level|level of (education|study)|degree( level| type)?\b|highest qualification|qualification level|level of qualification|academic qualification|dipl[oô]me|niveau d.[ée]tudes|nivel de estudios|titulaci[oó]n|bildungsabschluss|\babschluss\b|opleidingsniveau|titolo di studio/.test(s);
  const asksSchool = /\b(school|universit\w*|college|institution|universidad|hochschule|universit[àa])\b|[ée]cole/.test(s) && /name|attended|which|what|where|nom|^\s*(school|university|college|[ée]cole|universit)/.test(s);
  const asksField = /field of study|\bmajor\b|discipline|area of study|speciali[sz]ation|domaine d.[ée]tudes|fili[eè]re/.test(s);
  // "Education — Post Graduation Not Required" is a checkbox row, not the
  // graduation year. Bare "graduat" also matched that row and typed "2016".
  if (f.type === 'checkbox' || f.role === 'checkbox' || f.role === 'switch') return null;
  const asksYear = /year of (completion|graduation)|completion year|graduation (year|date)|ann[ée]e d.obtention/.test(s);
  if (!(asksLevel || asksSchool || asksField || asksYear)) return null;
  if (!edu) return null;
  const degree = String(edu.degree || '');
  const level = /master|msc|m\.sc|mba|ma\b/i.test(degree) ? "Master's degree"
    : /ph\.?d|doctor/i.test(degree) ? 'PhD'
      : /bachelor|licence|\bba\b|bsc|b\.sc|undergraduate/i.test(degree) ? "Bachelor's degree"
        : degree;
  const field = degree.replace(/\b(bachelor('s)?|master('s)?|licence|degree|of|in|ba|bsc|msc|mba)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  if (asksYear && edu.end) return { value: edu.end, selectText: edu.end, selectMatch: edu.end };
  if (asksField && field) return { value: field, selectText: field };
  if (asksSchool && edu.school && !asksLevel) return { value: edu.school, selectText: edu.school };
  if (asksLevel) {
    const rank = /bachelor/i.test(level)
      ? [/bachelor|licence|undergraduate|bac\s*\+\s*3|first degree|\bba\b|\bbsc\b/i]
      : /master/i.test(level) ? [/master|\bmsc\b|\bma\b|bac\s*\+\s*5|graduate degree/i] : [];
    return { value: level, selectText: level, selectRank: rank.length ? rank : undefined };
  }
  return null;
}

// "Website" / "Portfolio" / "URL" — not an essay that happens to contain
// "websites", and not a Yes/No about production code.
function isProfileUrlSlot(f) {
  if (!f) return false;
  if (f.type === 'radio' || f.type === 'checkbox' || f.type === 'file') return false;
  const label = String(f.label || '');
  if (/tell us|describe|share (two|2 or 3|two or three)|for each|what you designed|what code|few sentences|what would you change|hands-on|designed and (built|written)|behaved in the browser/i.test(label)) {
    return false;
  }
  // "Can you share a link to your portfolio if not already in your CV?" asks
  // for the link, even in a textarea (it got the whole markdown CV).
  if (/\b(link|url)\b[^.?]{0,30}\b(portfolio|website|site|work)\b|\b(portfolio|website)\b[^.?]{0,12}\b(link|url)\b/i.test(label)) return true;
  if ((f.tag === 'textarea' || f.type === 'textarea') && label.length > 40) return false;
  return true;
}

function checkboxChoiceLabel(f) {
  const raw = String(f.label || '');
  const parts = raw.split(/\s+[—–]\s+|\s+-\s+/);
  return (parts.length > 1 ? parts[parts.length - 1] : raw)
    .replace(/[*✱]/g, ' ')
    .replace(/\brequired\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function questionStem(f) {
  const raw = String(f.label || '').split(/\s+[—–]\s+|\s+-\s+/)[0];
  return raw.replace(/[*✱]/g, ' ').replace(/\brequired\b/gi, '').replace(/\s+/g, ' ').trim();
}

// "Which of these have you worked in hands-on? — React"
// Checked only when the CV names that tool. Next.js counts as React.
// An option the CV never names is left blank. No CV text → no answer.
function handsOnCheckboxPlan(f, spec = {}) {
  if (f.type !== 'checkbox') return null;
  if (!/hands-on/i.test(questionStem(f))) return null;
  const evidence = String(practiceFrom(spec)?.evidence || '');
  if (!evidence) return null;
  const opt = checkboxChoiceLabel(f);
  const has = (re) => re.test(evidence);
  if (/^react$/i.test(opt)) {
    return has(/\breact\b|next\.?js/i) ? { check: true } : { skip: 'outil non utilisé', answeredBlank: true };
  }
  if (/next\.?js|astro|code-based framework/i.test(opt)) {
    return has(/next\.?js|\bastro\b|\bjavascript\b/i) ? { check: true } : { skip: 'outil non utilisé', answeredBlank: true };
  }
  if (/hubspot|wordpress|webflow|framer|^other$/i.test(opt)) {
    return has(/hubspot|wordpress|webflow|\bframer\b/i) ? { check: true } : { skip: 'outil non utilisé', answeredBlank: true };
  }
  return null;
}

// SaaS / enterprise / MarTech / AI are in the CV. Consumer, cyber, and
// industrial are not a claimed industry.
function industryCheckboxPlan(f) {
  if (f.type !== 'checkbox') return null;
  if (!/^what industries\b/i.test(questionStem(f)) && !/\bindustries\b/i.test(questionStem(f))) return null;
  const opt = checkboxChoiceLabel(f);
  if (/b2b saas|enterprise saas|martech|\bai\b|genai/i.test(opt)) return { check: true };
  if (/consumer|cyber|industrial|manufactur|^other$/i.test(opt)) {
    return { skip: 'industrie hors profil', answeredBlank: true };
  }
  return null;
}

// Teamtailor "Locations" is the posting's hiring regions, not the city field.
// Candidate is in France (CET) and authorized in the EU. UK is not.
function hiringLocationCheckboxPlan(f, id) {
  if (f.type !== 'checkbox') return null;
  if (!/^locations?$/i.test(questionStem(f))) return null;
  const opt = checkboxChoiceLabel(f);
  const country = String(id.country || '').trim();
  if (country && new RegExp(`\\b${country.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(opt)) {
    return { check: true };
  }
  // French / EU citizen: every EU hiring region, not the short list that
  // omitted Poland, Czechia, Hungary and the rest. The UK stays out.
  const named = placesIn(opt).explicit;
  if (named.some((c) => isEuCountry(c))) return { check: true };
  // A whole region the candidate is in ("Europe", "EMEA"), or remote anywhere.
  if (candidateIsIn(`in ${opt}`, id) === true) return { check: true };
  if (/^(remote|anywhere|worldwide|global)\b|\bfully remote\b/i.test(opt)) return { check: true };
  return { skip: 'localisation hors zone de travail', answeredBlank: true };
}

// Essays about sites he built must reach the model. A Section F paragraph
// about motivation is the wrong text, and the portfolio URL is not an answer.
function isOpenBuildQuestion(f) {
  const label = String(f.label || '');
  return /live websites you designed|websites you designed and built|design decision you changed|how it actually behaved|where does ai help|mobile feature|insight through launch|one mobile .{0,40}you personally|shipping consumer mobile/i.test(label);
}

const YES_NO_OPENER = /^(do|did|does|have|has|are|were|will|would|can|could|is|should) (you|your)\b/i;

function cleanQuestion(f) {
  return String(f.label || '').replace(/^[\s*••\-–—.)\d:]+/, '').trim();
}

const digitsOf = (v) => String(v || '').replace(/\D/g, '');
const PHONE_LIKE = (v) => {
  const raw = String(v || '').trim();
  const d = digitsOf(raw);
  return d.length >= 8 && d.length >= raw.replace(/\s/g, '').length * 0.6;
};
const EMAIL_LIKE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const URL_LIKE = /^(https?:\/\/)?(www\.)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i;

// "Are you…?", "Knowing this, would you accept…?", "Do you live in Germany
// and…?": the answer is Yes or No, wherever the auxiliary sits.
export function readsAsYesNo(label) {
  const q = String(label || '').replace(/[*✱]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!q) return false;
  return q.split(/(?<=[.?!:;])\s+/).some((part) => {
    const head = part.replace(/^[\s•\-–—.)\d]+/, '');
    // "In which country, or countries, do you mainly reside?" asks for a place.
    if (/^(what|which|where|when|why|how|who|whom|whose|(in|for|from|to|at|on|with|of|by) (which|what|whom))\b/i.test(head)) return false;
    return /^(are|do|does|did|will|would|can|could|have|has|is|should|may)\s+(you|your)\b/i.test(head)
      || /,\s*(are|do|will|would|can|could|have|is)\s+you\b/i.test(head)
      || /^(êtes|avez|pouvez|seriez|acceptez|accepteriez)[- ]vous\b/i.test(head);
  });
}

/**
 * Last check on any plan, whatever rule produced it: the value has to be the
 * kind of thing the field asks for. A phone number in "Tell us about the
 * mobile product…", the candidate's name in a referrer box, the CV in a
 * portfolio question or "5 days (full time)" on a Yes/No list are dropped —
 * the field then goes to the resolver, which reads the question as a whole.
 */
export function planFitsField(f, plan, spec = {}) {
  if (!f || !plan || plan.skip || plan.check || plan.upload) return true;
  const s = fieldSearchText(f);
  if (plan.resume) return !/link|url|portfolio|website|http/.test(s);
  if (plan.yesNo) return true;
  const value = String(plan.value ?? plan.selectText ?? '').trim();
  if (!value) return true;
  // A tick box is ticked or left alone: a year or a name is never its answer.
  if ((f.type === 'checkbox' || f.role === 'checkbox' || f.role === 'switch')
      && !/^(yes|no|true|false|on|off|checked|unchecked)$/i.test(value)) {
    return false;
  }
  const id = spec.identity || {};
  if (PHONE_LIKE(value) && !looksLikePhoneNumberField(f) && !looksLikeDialCodeField(f) && !isIdentityRepeatField(f)
      && !/postal|zip|code postal|salary|compensation|r[ée]mun|pay|rate|years?|ann[ée]e/.test(s)) {
    return false;
  }
  if (EMAIL_LIKE.test(value) && f.type !== 'email' && !/e-?mail|courriel|\bcorreo\b|_systemfield_email/.test(s)) return false;
  if (URL_LIKE.test(value) && /\//.test(value)
      && !/link|url|website|\bsite\b|portfolio|linkedin|github|twitter|x\.com|behance|dribbble|profil|lien|code|web/.test(s)) {
    return false;
  }
  const names = [id.fullName, `${id.firstName || ''} ${id.lastName || ''}`.trim(), id.firstName, id.lastName]
    .map((n) => String(n || '').trim().toLowerCase()).filter(Boolean);
  if (names.includes(value.toLowerCase())
      && /\breferr|\bfriend|colleague|employee|manager|recruiter|\breference|emergency|their (full )?name|parrain/.test(s)) {
    return false;
  }
  if (isAddressLineField(f) && value === String(id.location || '').trim()) return false;
  // A list whose rows are Yes and No only takes Yes or No.
  if (optionsAreYesNo(f.options) && !choiceKind(value) && !/^(yes|no|oui|non)\b/i.test(value)) return false;
  // A Yes/No question answered with a profile value is not answered: "France"
  // for "…do you now require sponsorship?", "60000" for "would you accept
  // $120-130K?", "Bachelor's degree" for "Have you completed a Master's?".
  // Links, e-mails and numbers asked for in a question stay ("Do you have a
  // LinkedIn profile you can share?"); a list with real rows keeps its pick.
  const rows = (f.options || []).filter((o) => {
    const t = String(typeof o === 'string' ? o : o?.text || '').trim();
    return t && !/^(select|choose|--|please|s[ée]lectionn)/i.test(t);
  });
  if (readsAsYesNo(f.label) && !/^(yes|no|oui|non)\b/i.test(value)
      && !URL_LIKE.test(value) && !EMAIL_LIKE.test(value) && !PHONE_LIKE(value)
      && (!rows.length || optionsAreYesNo(f.options))) {
    return false;
  }
  // A bare Yes/No does not answer an open question ("yes" went into "What
  // is your current role?" on Agoda). A statement box without a question
  // word ("Legally authorized to work in the EU") still takes it.
  if (choiceKind(value) && !readsAsYesNo(f.label) && !rows.length
      && f.type !== 'radio' && f.type !== 'checkbox' && !isListField(f)
      && /^(what|which|where|when|who|whom|whose|how (many|much|long|old|soon|quickly)|in which|quel(le)?s?|qu['’]est|o[uù]|combien|quand|qu[eé]|cu[aá]l|d[oó]nde|cu[aá]nt[oa]s?|welche[rs]?|wo|wann|wie viele?)\b/i.test(String(f.label || '').trim())) {
    return false;
  }
  // A place box takes a place, not a paragraph ("Where are you currently
  // located?" received an OneAsset story on Nucs AI). A list keeps its pick:
  // Plancraft's "Location" rows are remote-policy sentences.
  if (isPlaceIdentityField(f) && !rows.length && (value.length > 60 || value.split(/\s+/).length > 8)) return false;
  // A number box takes digits ("1 week" in "Notice period (in weeks)"), a
  // date box an ISO date.
  if (f.type === 'number' && !/^\s*-?\d+([.,]\d+)?\s*$/.test(value)) return false;
  if (f.type === 'date' && !plan.dateISO && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  if (f.type === 'month' && !plan.dateISO && !/^\d{4}-\d{2}$/.test(value)) return false;
  return true;
}

function classifyFieldRaw(f, spec, usedAnswers) {
  const s = `${f.label || ''} ${f.name || ''} ${f.idAttr || ''} ${f.autocomplete || ''}`.toLowerCase();
  const id = spec.identity || {};

  if (f.type === 'file') return fileUploadPlan(f, spec);
  // Credentials and legal history are the candidate's to type, never ours and
  // never the model's: leaveBlank sends them to the "à compléter" list.
  if (isSecretCredentialField(f)) {
    return { skip: 'champ mot de passe (jamais rempli automatiquement)', leaveBlank: true };
  }
  if (isPersonalLegalQuestion(f)) {
    return { skip: 'antécédents (casier, faillite, licenciement) — à confirmer toi-même', leaveBlank: true };
  }
  // "Resume/CV" textarea (alternative to the file upload) → paste the CV text.
  if ((f.tag === 'textarea' || f.type === 'textarea') && isResumePasteField(f)) {
    return { resume: true };
  }
  // Sensitive EEO questions stay blank (usually optional / "prefer not to say").
  // Pronouns are handled separately: many ATS make them required. \bage\b is
  // word-boundary anchored so it doesn't false-positive on "message",
  // "manage", "package", "language" (seen in the wild: Ashby's optional
  // "Diversity Survey" section asks "What is your current age?").
  // A gender declared in profile.yml is an answer the candidate chose to give,
  // so use it instead of declining. Scoped to the gender question itself: the
  // LGBTQIA+ question also contains "transgender", and race/veteran/disability
  // stay blank regardless.
  // "Are you 18 or older?" is a legal gate, not a demographic question: it
  // used to hit the \bage\b skip below before its own rule could answer.
  if (/\b18\b.{0,20}(or older|years? (of )?age|years old)|(over|at least|older than) 18\b(?!\s*(months?|weeks?|days?|hours?|%|mois|semaines))|\b18\+(?!\s*(months?|weeks?|days?))/.test(s)) {
    return { yesNo: 'yes', selectText: 'Yes', value: 'Yes' };
  }
  const bareLabel = normalizedFieldLabel(f);
  // The gender question itself: a short label, or a longer one that is still
  // about the candidate's gender. "Quel genre de projets…" (what kind of
  // projects) and "Gender pronouns" are not it.
  // "genre" alone is also French for "kind": only the short label counts.
  const asksGender = !/pronoun|lgbt|transgender community|identify as part of|race|ethnic|assigned at birth|same as the sex/.test(s)
    && (/^(your |what is your |please (select|indicate) your )?(gender|sexe|genre|sex|gender identity)( \(optional\))?$/.test(bareLabel)
      || /\bgender\b|\bsexe\b/.test(s));
  if (asksGender && id.gender) return { value: id.gender, selectText: id.gender };
  const eeo = /gender|\brace\b|ethnic|veteran|disab|origine (ethnique|raciale)|\bsexe\b|\bage\b|date of birth|birth\s*date|date de naissance|fecha de nacimiento|geburtsdatum|data di nascita|geboortedatum|how do you identify|sexual orientation|assigned at birth/.test(s)
    || (/\bgenre\b|\bdiversity\b/.test(s) && bareLabel.length <= 40);
  if (eeo && !/pronoun/.test(s)) {
    // declinePreferred: if this turns out to be required, prefer the
    // dropdown's own decline/non-disclosure option over skipping outright —
    // see fillDeclineDropdown / DECLINE_RE.
    return { skip: 'question démographique (laissée vide)', declinePreferred: true };
  }

  // Work authorization, sponsorship, relocation, on-site and travel follow the
  // profile's policy and the place the question names (lib/apply-policy.mjs).
  const policy = policyPlan(f, spec);
  if (policy) return policy;

  // The blanket "travel / relocation / hybrid → No" rules only stand in when
  // the profile carries no policy; with one, the policy above has answered
  // every yes/no it could, and a list it skipped stays with the resolver.
  const policyDriven = !!(id.policy && (id.policy.remote || id.policy.onsite || (id.policy.authorizedIn || []).length));
  const travel = travelOrRelocatePlan(f, { policyDriven });
  if (travel) return travel;

  const trivial = trivialFieldPlan(f, id);
  if (trivial) return trivial;

  const employment = employmentHistoryPlan(f, id.employment || {});
  if (employment) return employment;

  const screening = screeningChoicePlan(f, {
    company: spec.company,
    identity: id,
    employerNames: spec.employerNames || [],
    practice: practiceFrom(spec),
  });
  if (screening) return screening;

  const language = languageQuestionPlan(f, id.languages || []);
  if (language) return language;

  const education = educationPlan(f, id, fieldSearchText(f));
  if (education) return education;

  const thirdParty = unknownThirdPartyPlan(f);
  if (thirdParty) return thirdParty;

  if (f.type === 'checkbox') {
    // Application-gate consents ("By submitting… I agree… Privacy Policy")
    // are always required by the ATS even when HTML `required` is missing —
    // AssessFirst Live rejected submit with exactly that unchecked box.
    if (isApplicationGateConsent(f)) return { check: true };
    // Optional marketing consents are only ticked when the user opted in for
    // this run (spec.consentOptIn) — agreeing to data retention or future
    // contact on someone's behalf is never a silent default.
    const isConsent = /privacy|consent|gdpr|rgpd|terms|conditions|politique de confidentialité|j'accepte|i (agree|consent|acknowledge)/.test(s);
    if (isConsent && (f.required || fieldLooksRequired(f) || spec.consentOptIn)) return { check: true };
    const hands = handsOnCheckboxPlan(f, spec);
    if (hands) return hands;
    const industry = industryCheckboxPlan(f);
    if (industry) return industry;
    const hiring = hiringLocationCheckboxPlan(f, id);
    if (hiring) return hiring;
    // "*I am applying for recruitment process!" — a required statement the
    // candidate makes by applying at all.
    if (isRequiredAffirmation(f)) return { check: true };
    // A REQUIRED checkbox that isn't a consent is a factual claim to confirm
    // ("Have you ever designed a product that leverages AI?"). Skipping it left
    // a mandatory field blank on n8n's form; hand it to the resolver, which
    // reads the CV and answers yes/no.
    if (f.required || fieldLooksRequired(f)) return null;
    return { skip: 'checkbox non requise' };
  }

  const m = (re) => re.test(s);
  // Passport / work-permit questions are the policy's (lib/apply-policy.mjs):
  // the unconditional Yes that stood here said Yes to a UK work permit.
  if (m(/\brelatives\b|\brelative\b(?!\s+to)|family member/)) return { yesNo: 'no', value: 'No' };
  if (m(/pronoun/)) {
    const p = (id.pronouns || '').toLowerCase();
    return p ? { value: id.pronouns, selectText: p.split('/')[0] || id.pronouns } : { skip: 'pronoms (laissés vides)' };
  }
  if (m(/non-?compete|non-?competition|non-concurrence|bound by any agreements?|restrictive covenant|non-?solicit/)) {
    return { yesNo: 'no', selectText: 'No', value: 'No' };
  }
  // "select the status that allows you to work and live in that country" — work
  // eligibility status (distinct from the plain yes/no eligibility question).
  if (m(/status that allows you to (work|live)|allows you to (work|live) and (work|live)|immigration status|residency status/)) {
    // "Citizen" only where the profile says the candidate may work; in the
    // UK a French citizen's status is "requires sponsorship".
    if (!workAuthorizedFor(f, spec)) {
      return { value: 'Require sponsorship', selectText: 'Require sponsorship', selectPrefer: /sponsor|need (a )?(visa|permit)|require|not (yet )?authori[sz]ed|no (right|permit)/i };
    }
    const asia = spec.region === 'asia';
    return { value: asia ? 'Work VISA' : 'Citizen', selectText: asia ? 'Work VISA' : 'Citizen' };
  }
  // consent to interview recording / transcription (Brighthire etc.) → yes
  if (m(/consent.*(record|using this tool|transcri)|brighthire|record.*(interview|transcri)/)) {
    return { yesNo: 'yes', selectText: 'Yes' };
  }
  // Same opt-in as the checkbox rule above, for ATS that render their consents
  // as a yes/no group instead of a tickbox.
  if (spec.consentOptIn && m(/consent|do you agree|j'accepte|autoris|storing your|store your (information|data)|contact you about/)) {
    return { yesNo: 'yes', selectText: 'Yes', value: 'Yes' };
  }
  // Demographic self-ID consent: we leave the EEO fields blank, so decline the
  // consent to process self-identification data (coherent + privacy-preserving).
  if (m(/self-?identification data|consent.*self-?identif/)) {
    return { value: "I don't wish to answer", selectText: "don't wish" };
  }
  // California "Notice at Collection". Answer only from the profile's cities
  // and countries. A known base outside California is "not a resident".
  // A California base, or no location at all, is left for the form.
  if (m(/california/)) {
    const practice = practiceFrom(spec);
    if (practice?.hasResidence && !practice.livesInCalifornia) {
      return { value: 'I am not a California resident', selectText: 'not a California resident' };
    }
    return null;
  }
  // single-option acknowledgement selects (privacy notice, data-protection notice)
  // Bitpanda (and similar) ask a Yes/No over a long "protect your data" blurb.
  if (m(/privacy notice|notice at collection|acknowledge|data (privacy|protection) notice|protect your (personal )?data|control over your personal data|job applicant privacy/)) {
    return {
      yesNo: 'yes',
      selectText: 'Yes',
      selectPrefer: /yes|i agree|i consent|accept|acknowledge/i,
      value: 'Yes',
    };
  }
  // Someone else's name, e-mail or phone (referee, supervisor, emergency
  // contact): never the candidate's own details. "Referee 1 full name" got
  // "Hugo Vermot" and "Referee 1 email address" his e-mail.
  // "Job reference number" is the posting's id, not a referee.
  if (THIRD_PARTY_CONTACT_RE.test(s) && !(f.tag === 'textarea' || f.type === 'textarea')
      && !m(/(job|position|vacancy|offer|posting|requisition|advert|ad) ref|reference (number|code|id\b|no\b|#)|ref\.? ?(no|#|number)|r[ée]f[ée]rence (de l['’]offre|du poste|de l['’]annonce)/)
      && (f.type === 'email' || f.type === 'tel' || m(/\bname\b|\bnom\b|e-?mail|courriel|phone|t[ée]l[ée]phone|\bnumber\b|num[ée]ro|\bcontact\b/))) {
    if (f.type === 'email' || f.type === 'tel') return { skip: 'coordonnées d’un tiers (laissées vides)', leaveBlank: true };
    return unknownThirdPartyPlan(f) || { skip: 'coordonnées d’un tiers (laissées vides)', leaveBlank: true };
  }
  if (m(/preferred\s*name|nickname|display[\s_-]*name|nom pr[ée]f[ée]r|nom d.affichage/)) return { value: id.firstName };
  // Combined single-input name field ("First and last name", "Name and
  // surname"): must be caught before the first/last rules below, which both
  // match it — the last-name rule won on n8n's form and on justjoin.it, and the
  // application went out signed "Vermot".
  if (m(/first[\s_-]*(name)?[\s_-]*(and|&|\/|\+|et)[\s_-]*last[\s_-]*name|last[\s_-]*(name)?[\s_-]*(and|&|\/|\+|et)[\s_-]*first[\s_-]*name|pr[ée]nom et nom|nom et pr[ée]nom|first[\s_-]*name[\s_-]*last[\s_-]*name|name[\s_-]*\(first[\s_-]*(and|&)[\s_-]*last\)|\bname (and|&) surname|surname (and|&) (first )?name|imi[eę] i nazwisko|vor- und nachname|vorname und nachname|nombre y apellidos?|nome e cognome/)) {
    return { value: id.fullName || `${id.firstName || ''} ${id.lastName || ''}`.trim() };
  }
  if (m(/middle[\s_-]*name|second[\s_-]*name|nom du milieu/)) {
    return { skip: 'middle name (laissé vide)', leaveBlank: true };
  }
  if (m(/first[\s_-]*name|pr[ée]nom|given[\s_-]*name|\bvorname\b|\bvoornaam\b|primer nombre|primeiro nome/)) return { value: id.firstName };
  if (m(/last[\s_-]*name|family[\s_-]*name|surname|nom de famille|\bapellidos?\b|\bcognome\b|\bsobrenome\b|\bapelido\b|\bnachname\b|\bfamilienname\b|\bachternaam\b/)) return { value: id.lastName };
  // "Nombre" / "Nome" next to "Apellido(s)" / "Cognome" is the first name —
  // Flat 101's form went out as "Hugo Vermot" + "Vermot". Alone, it is the
  // whole name.
  if (isBareGivenNameLabel(f)) {
    return spec.formHasSurnameField
      ? { value: id.firstName }
      : { value: id.fullName || `${id.firstName || ''} ${id.lastName || ''}`.trim() };
  }
  // "Nom" next to "Prénom", "Name" next to "Vorname": the surname. Not when
  // the form has its own surname box, and never the ATS's full-name slot
  // (Ashby _systemfield_name, name="name", autocomplete="name"): n8n's form
  // once went out signed "Vermot".
  const attrFullName = /_systemfield_name/.test(s) || /^(name|fullname|full_name|full-name)$/i.test(String(f.name || ''))
    || /^(name|fullname|full_name|full-name)$/i.test(String(f.idAttr || '')) || String(f.autocomplete || '').toLowerCase() === 'name';
  if (spec.formHasGivenNameField && !spec.formHasSurnameField && !attrFullName
      && /^(votre |your |the |uw )?(nom|name|naam)$/.test(bareLabel)) {
    return { value: id.lastName };
  }
  // Full / legal / bare "Name" / Ashby _systemfield_name — not company, file,
  // hiring-manager, emergency-contact, or open questions that only mention
  // "your name" ("attached to your name"). Shared with isCoreApplicationIdentity.
  if (isCandidateFullNameField(f)) {
    return { value: id.fullName || `${id.firstName || ''} ${id.lastName || ''}`.trim() };
  }
  // Marketing / newsletter emails are never the application identity email.
  if (looksLikeMarketingEmailField(f)) {
    // A required Yes/No list cannot stay blank: it gets the profile's answer
    // (No unless consentOptIn) instead of blocking the send (Agoda's "Email
    // me about other job openings").
    if ((f.required || fieldLooksRequired(f))
        && (optionsAreYesNo(f.options) || (isListField(f) && !(f.options || []).length))) {
      return spec.consentOptIn
        ? { yesNo: 'yes', selectText: 'Yes', value: 'Yes' }
        : { yesNo: 'no', selectText: 'No', value: 'No' };
    }
    return { skip: 'email marketing (laissé vide)', leaveBlank: true };
  }
  if (f.type === 'email' || m(/e-?mail|courriel|\bcorreo\b|_systemfield_email/)) return { value: id.email };
  if (isPhoneExtensionField(f)) return { skip: 'extension téléphonique (laissée vide)', leaveBlank: true };
  if (isPhoneDeviceTypeField(f)) return { value: 'Mobile', selectText: 'Mobile', selectPrefer: /mobile|cell/i };
  if (looksLikeDialCodeField(f)) {
    const code = id.dialCode || formDialCode(id.phone, id.country);
    const country = String(id.country || '').trim();
    // intl-tel-input's flag button follows the number box: "+33 6 95…" typed
    // there selects France by itself. Picking in its localised list by hand
    // landed on "Guayana Francesa +594" and blocked the run for nothing.
    if (isIntlTelInputPicker(f) && !spec.formHasDialPicker) {
      return { skip: 'indicatif réglé par le numéro international', answeredBlank: true };
    }
    return code
      ? {
          value: country ? `${country} ${code}` : code,
          selectText: country ? `${country} ${code}` : code,
          selectMatch: code,
          // Greenhouse options read "France +33" — code alone still scores via
          // optionMatchScore; country name is a second needle for typeahead.
          selectPrefer: country
            ? new RegExp(`${String(code).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|\\b${country.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
            : null,
        }
      : { skip: 'indicatif téléphonique inconnu', leaveBlank: true };
  }
  if (looksLikePhoneNumberField(f)) {
    const full = String(id.phone || '').trim();
    const code = id.dialCode || formDialCode(full, id.country);
    const international = full && code && !/^\+/.test(full) ? `${code} ${full.replace(/^0+/, '')}` : full;
    // A country-code picker next to the box carries +33: the box takes the
    // national number. Everywhere else the full international form is the
    // one every widget reads right — the national "6 95…" became "+695659131"
    // on an intl-tel box and an unreadable French number on Lever.
    const current = String(f.value || '').trim();
    const rewritten = current.startsWith('+') && code && !digitsOf(current).startsWith(digitsOf(code));
    if (spec.formHasDialPicker && !phoneFieldIncludesDialCode(f) && !rewritten) {
      const national = nationalPhoneNumber(full, code);
      return { value: national || full, optionalEmpty: !full };
    }
    return { value: international, optionalEmpty: !international };
  }
  if (m(/active users|how many .{0,30}(users|customers)|scale of the product you manage/) && !m(/feature or improvement|tell us about one/)) {
    return null;
  }
  // "How did you hear about this job? (e.g. LinkedIn, job board…)" names
  // LinkedIn and GitHub as examples: the source rule has to run before the
  // link rules, which typed the profile URLs there.
  if (m(HEAR_ABOUT_RE)) return hearAboutPlan(id, applicationSource(spec.jobUrl));
  // A question about tools that only names LinkedIn / GitHub as examples is
  // not the profile slot; "What is your LinkedIn URL?" still is.
  // Whole words: "linkedin" itself contains "link".
  const asksProfileLink = m(/\b(url|link|lien|profile?|perfil|username|handle|account|page)\b/);
  const toolQuestion = m(/\b(which|what) (tools?|platforms?|social|networks?|channels?|sites?|version control)\b|do you use|version control/);
  if (m(/linkedin/) && (asksProfileLink || !toolQuestion)) return { value: id.linkedin };
  // GitHub only when that is the field. "Portfolio / GitHub / website" is the
  // portfolio slot — github.com in there looks like the wrong profile, and
  // "Which version control tools do you use (GitHub, GitLab…)?" is a question.
  if (m(/github/) && !m(/portfolio|behance|dribbble|website|personal (site|url)|site (web|internet)/)
      && (asksProfileLink || !toolQuestion)) {
    return { value: id.github };
  }
  if (m(/link to (the |some )?code (you|i) wrote|code you wrote|share a link to code/)) {
    const gh = String(id.github || '').trim();
    if (!gh) return { skip: 'pas de lien de code dans le profil', leaveBlank: true };
    return { value: /^https?:\/\//i.test(gh) ? gh : `https://${gh.replace(/^\/+/, '')}` };
  }
  // A link the profile does not hold: a public CV link, a Drive / Dropbox
  // folder of screens "different from your main portfolio link". The
  // candidate pastes it. The model wrote a paragraph ending in "[Google
  // Drive link to OneAsset project screens]", and the resume link got the
  // portfolio URL.
  // "A link to your portfolio if not already in your CV" is the portfolio slot.
  const folderLink = m(/google drive|dropbox|one ?drive|we ?transfer|\bdrive\b/);
  if (m(/\b(link|url|lien|enlace)\b/)
      && (folderLink || (m(/resume|\bcv\b|curriculum/) && !m(/portfolio|behance|dribbble|website|site web/)))
      && !m(/upload|attach|joindre|t[ée]l[ée]charg/) && f.type !== 'file') {
    const cvUrl = String(id.resumeUrl || id.cvUrl || '').trim();
    if (cvUrl && !folderLink) return { value: cvUrl };
    return { skip: folderLink ? 'lien Drive/Dropbox à fournir' : 'lien public vers le CV à fournir', leaveBlank: true };
  }
  // Must come BEFORE the generic portfolio/website/URL catch-all below: its
  // bare \burl\b match would otherwise swallow "Twitter URL" too and hand it
  // the portfolio link instead (a real bug found in live testing).
  if (m(/twitter|\bx\.com\b/)) return { value: id.twitter, optionalEmpty: !id.twitter };
  // "Additional portfolio link" is a SECOND slot. Do not put GitHub there:
  // that field is still a portfolio question. Leave it blank if we already
  // used the portfolio URL, rather than pasting github.com. "Portfolio / Other
  // URL" opens on the portfolio: that one is the portfolio slot.
  const label = String(f.label || '').replace(/[*✱]/g, ' ').trim().toLowerCase();
  if (isProfileUrlSlot(f) && m(/(additional|autre|second|other)\b/) && m(/portfolio|website|link|lien|\burl\b/)
      && !/^(your )?portfolio\b/.test(label)) {
    return { skip: 'lien supplémentaire (laissé vide)', leaveBlank: true };
  }
  if (isProfileUrlSlot(f) && m(/portfolio|website|site (web|internet)|personal site|personal url|\burl\b|web site|web address|site address/)) {
    return { value: id.portfolio, optionalEmpty: !id.portfolio };
  }
  // Street / district / building lines: the profile has no street address.
  if (isAddressLineField(f) && !m(/e-?mail/)) {
    return { skip: 'adresse postale (pas de rue dans le profil)', leaveBlank: true };
  }
  // Word-boundary anchored: a bare /location/ also matches "reLOCATION", so
  // "This role requires relocation to Bangkok — are you open to it?" was being
  // classified as a city field and answered with the candidate's address
  // instead of Yes/No (caught by live tracing: the runner typed "Bangkok,
  // Thailand" into a Yes/No dropdown). Same reasoning for \bcity\b, which
  // otherwise matches "capaCITY".
  // Nationality / citizenship is the passport, not where the candidate lives
  // this time (the Bangkok identity is still a French citizen).
  if (m(/nationalit|citizenship|citoyennet|country of (birth|origin)/) && !m(/sponsor|visa|authori[sz]/)) {
    const citizen = /\b(french|france)\b/i.test(String(id.visaStatus || '')) ? 'France' : String(id.country || '');
    if (!citizen) return null;
    const adjective = citizen === 'France' ? 'French' : citizen;
    const asksCountry = m(/country|pays/);
    return {
      value: asksCountry ? citizen : adjective,
      selectText: asksCountry ? citizen : adjective,
      selectPrefer: citizen === 'France' ? /^(french|france|fran[cç]ais)\b/i : null,
      selectMatch: citizen,
    };
  }
  // "Work location preference: Remote | Hybrid | On-site" is the work mode,
  // not a city: the profile's answer is remote.
  const optText = (o) => String(typeof o === 'string' ? o : o?.text || '');
  if ((f.options || []).some((o) => /^(fully |100% )?remote\b|\bremote\b|t[ée]l[ée]travail|\banywhere\b/i.test(optText(o)))
      && (f.options || []).some((o) => /hybrid|on-?site|office|in[- ]person|pr[ée]sentiel/i.test(optText(o)))
      && m(/location|work (mode|arrangement|preference|setup|style|type)|remote|hybrid|on-?site|office|t[ée]l[ée]travail|lieu de travail/)) {
    return { value: 'Remote', selectText: 'Remote', selectPrefer: /^(fully |100% )?remote\b|remote only|\bremote\b|t[ée]l[ée]travail/i };
  }
  // The profile has no birthplace.
  if (m(/(city|place|town) of birth|birth ?place|lieu de naissance|ciudad de nacimiento|geburtsort|luogo di nascita/)) {
    return { skip: 'lieu de naissance (pas dans le profil)', leaveBlank: true };
  }
  const asksPlace = m(/current location|where (are|do) (you|your)\b.{0,16}\b(based|live|located|reside|living)\b|currently (based|located|living|residing) in|based in|place of residence|city of residence|lieu de r[ée]sidence|o[uù] (êtes|habitez)[- ]vous|\blocation\b|\baddress\b|\badresse\b|\bciudad\b|\bcitt[àa]\b|\bwohnort\b|\bwoonplaats\b|\bstadt\b|^plaats$/)
    && !m(/relocat|travel|sponsor|visa|time[\s_-]*zone|fuseau|hybrid|office|willing|open to|preferred work location|applying (to|for)|job location|location of (the|this) (job|role|position)|web address|website|\burl\b|e-?mail/);
  if (asksPlace) {
    // "Location" whose only choices are Yes | No is an eligibility question:
    // Yes when it names no place or the candidate's, No for another one ("Are
    // you based in the San Francisco Bay Area?").
    if (optionsAreYesNo(f.options)) {
      return candidateIsIn(String(f.label || ''), id) === false
        ? { yesNo: 'no', selectText: 'No', value: 'No' }
        : { yesNo: 'yes', selectText: 'Yes', value: 'Yes' };
    }
    if (optionsLookLikeWorkPolicy(f.options)) return remotePolicyPlan(f.options);
    // Ask for what the question names: the country, the city, or both.
    if (m(/\b(which|what|in which) country\b|country of residence|country\/region|quel pays|pays de r[ée]sidence|\bland\s*\/\s*regio\b|van vestiging/) && !m(/city|code/)) {
      return { value: id.country, selectText: id.country, selectMatch: id.country };
    }
    // autocomplete="address-level2" is the browser's name for the city box.
    if ((m(/\b(which|what) city\b/) || m(/address-level2|\bciudad\b|\bcitt[àa]\b|\bwohnort\b|\bwoonplaats\b|\bstadt\b/)) && !m(/country|address-level1/)) {
      return { value: id.city || id.location, selectText: id.city, selectMatch: id.city };
    }
    return { value: id.location, selectText: id.location, selectMatch: id.city || id.location };
  }
  if (m(/\bcity\b|\bville\b|\bciudad\b|\bcitt[àa]\b|\bwohnort\b|\bstadt\b/) && !m(/capacity|relocat/)) {
    if (optionsAreYesNo(f.options)) {
      return candidateIsIn(String(f.label || ''), id) === false
        ? { yesNo: 'no', selectText: 'No', value: 'No' }
        : { yesNo: 'yes', selectText: 'Yes', value: 'Yes' };
    }
    // "(City, country)" wants both.
    if (m(/city[,\s&/]+(and\s+)?country|ville[,\s&/]+(et\s+)?pays/)) {
      return { value: id.location, selectText: id.location, selectMatch: id.city || id.location };
    }
    return { value: id.city || id.location, selectText: id.city, selectMatch: id.city };
  }
  // ", do you" questions are Yes/No ("For the country…, do you require
  // sponsorship?"). A place rule used to answer them "France", and the
  // yes/no check then threw that answer away.
  if (!readsAsYesNo(f.label) && (m(/country|pays|\bpa[ií]s\b|\bpaese\b|\bland\s*\/\s*regio\b|van vestiging/) || /^(land|pa[ií]s|paese)$/.test(bareLabel))
      && !m(/relocat|travel|work authori|visa|sponsor|telefoon|phone|\bcode\b/)) {
    return { value: id.country, selectText: id.country, selectMatch: id.country };
  }
  if (m(/time[\s_-]*zone|fuseau/)) {
    // A Yes/No about a time zone compares the zone the question names with
    // the candidate's: Paris is CET (UTC+1), Bangkok ICT (UTC+7). "Can you
    // work Pacific business hours?" used to be Yes because the candidate is
    // in CET; a far zone is left to the resolver, a near one is Yes.
    const yesNoTz = optionsAreYesNo(f.options) || readsAsYesNo(f.label)
      || /are you based|within two hours|within .{0,30}central european/.test(s);
    if (yesNoTz) {
      const mine = candidateUtcOffset(id);
      const asked = questionUtcOffset(String(f.label || ''));
      if (asked == null) {
        const cet = /cet|cest|paris|france|europe/i.test(`${id.timezone || ''} ${id.city || ''} ${id.country || ''}`);
        if (/european|europe|cet|cest|central european/.test(s)) return cet ? { yesNo: 'yes', selectText: 'Yes', value: 'Yes' } : { yesNo: 'no', selectText: 'No', value: 'No' };
        return null;
      }
      if (mine == null) return null;
      const tolerance = Number((s.match(/within\s+(\d+)\s*hours?/) || [])[1]) || 3;
      if (Math.abs(mine - asked) <= tolerance) return { yesNo: 'yes', selectText: 'Yes', value: 'Yes' };
      if (/are you (based|located|living)|based in|located in/.test(s)) return { yesNo: 'no', selectText: 'No', value: 'No' };
      return null;
    }
    return { value: id.timezone, selectText: id.timezone, selectMatch: id.timezone };
  }
  // "Expected salary currency": the currency, not the amount.
  if (m(/\bcurrency\b|\bdevise\b|\bmoneda\b|w[äa]hrung|\bvaluta\b/) && !m(/amount|montant|how much|combien/)) {
    const cur = String(id.salaryCurrency || '').trim();
    if (!cur) return null;
    const symbol = cur === 'EUR' ? '€|euro' : cur === 'USD' ? '\\$|dollar' : cur === 'GBP' ? '£|pound' : cur;
    return { value: cur, selectText: cur, selectMatch: cur, selectPrefer: new RegExp(`\\b${cur}\\b|${symbol}`, 'i') };
  }
  // "Desired Salary Range Format": the period, not an amount.
  if (m(/(salary|pay|compensation)[^?]{0,25}\b(format|period|frequency|unit|basis)\b/)) {
    return { value: 'Annual', selectText: 'Annual', selectRank: [/annual|yearly|per year|year/i] };
  }
  // The current pay is not in the profile, and the expectation is not it.
  if (m(/\b(current|present|actual|existing|today'?s|actuel(le)?)\b[^?]{0,25}\b(salary|compensation|pay|r[ée]mun[ée]ration|salaire|ctc|package)/)) {
    return { skip: 'salaire actuel (pas dans le profil) — à toi de décider', leaveBlank: true };
  }
  if (m(SALARY_LABEL_RE)) {
    // Never type the profile prose ("EUR70K-110K …") or a Section F range:
    // numeric inputs concatenate min+max into garbage like "v76000119000".
    const value = formSalaryValue(
      { minimum: id.salaryMinimum, target_range: id.salary, currency: id.salaryCurrency },
      f.label,
    );
    // Greenhouse band lists (€50,000 - €60,000): numeric value + optionMatchScore.
    if (value) return { value, selectText: value, selectMatch: value };
    const asked = currencyFromLabel(f.label);
    return {
      skip: asked && id.salaryCurrency && asked !== id.salaryCurrency
        ? `salaire demandé en ${asked} — le profil n'a qu'un montant en ${id.salaryCurrency}`
        : 'salaire non numérique dans le profil',
      leaveBlank: true,
    };
  }
  if (m(/notice[\s_-]*period|pr[ée]avis|how long is your notice|k[üu]ndigungsfrist|preaviso|opzegtermijn|periodo di preavviso/)) {
    const notice = String(id.noticePeriod || '1 week');
    // Revolut buckets: Immediate / 1 month / 2 months / 3 months+. A 1-week
    // profile has no exact bucket — Immediate availability is the closest.
    const short = /immediate|asap|disponib|none|no notice|^0\b|1\s*(week|semaine)|one\s+week|une\s+semaine|7\s*days?|7\s*jours?/i.test(notice);
    if (short) {
      return {
        value: notice,
        selectText: 'Immediate availability',
        selectRank: [
          /immediate|asap|disponib|none|no notice/i,
          /1\s*(week|semaine)|one\s+week|une\s+semaine/i,
          /less than\s*2|under\s*2\s*weeks|moins de\s*2/i,
        ],
        selectPrefer: /immediate|asap|disponib|none|no notice|^0\b|1\s*(week|semaine)|less than\s*1\s*month|moins d.?un mois/i,
      };
    }
    // Prefer exact selectText match over a broad selectPrefer — a loose
    // /1|2|3 months/ prefer would always pick the first bucket.
    return { value: notice, selectText: notice };
  }
  if (isAvailabilityStartField(f)) {
    const choice = f.type === 'radio' || f.tag === 'select' || isComboboxField(f);
    const notice = String(id.noticePeriod || '');
    const short = /immediate|asap|none|no notice|^0\b|1\s*(week|semaine)|one\s+week|une\s+semaine|7\s*days?/i.test(notice);
    if (choice && short) {
      return {
        value: 'Within 2 weeks',
        selectText: 'Within 2 weeks',
        selectRank: [
          /immediate|asap|disponib/i,
          /1\s*(week|semaine)|one\s+week|within\s*1\s*week/i,
          /within\s*2\s*weeks/i,
        ],
        selectPrefer: /immediate|asap|within\s*2\s*weeks|1\s*(week|semaine)/i,
      };
    }
    return { value: id.startDate, dateISO: id.startDateISO };
  }
  const cleanLabel = cleanQuestion(f);
  // Full-time engagement: "How many days a week can you work on this?". Not
  // "Are you willing to work in our Paris office 3 days per week?" — that is
  // an on-site question, and "5 days (full time)" landed on its Yes/No list.
  if (m(/how many days a week|days a week can you|days per week/)
      && (/^how many days/i.test(cleanLabel) || (f.options || []).some((o) => /\bdays?\b/i.test(String(o?.text || o))))) {
    return {
      value: '5 days (full time)',
      selectText: '5 days (full time)',
      selectPrefer: /5\s*days/i,
    };
  }
  // A production React/Next site, only when the CV names that stack and a
  // shipped or deployed product.
  if (m(/how much react|react have you shipped/)) {
    const evidence = String(practiceFrom(spec)?.evidence || '');
    const writesReact = /\breact\b|next\.?js/i.test(evidence);
    const shipped = /\bvercel\b|\bdeployment\b|\blive\b|\bshipped\b|\bproduction\b/i.test(evidence);
    if (!writesReact || !shipped) return null;
    return {
      value: 'A production site or app I built mostly myself',
      selectText: 'A production site or app I built mostly myself',
      selectPrefer: /production site or app i built mostly myself/i,
    };
  }
  // Years of experience — Product Designer / AI builder profile.
  // Skip Yes/No gates ("Do you have 5+ years…?") so they fall through to the
  // factual-question null below / LLM instead of typing the year count into a radio.
  {
    const yoYesNo = YES_NO_OPENER.test(cleanLabel);
    // "Both designed and built" is not the 12-year design career. The
    // design-and-code products start in 2022 (cv.md) → the 2-to-4 bracket.
    if (!yoYesNo && m(/both designed and built|designed and built websites/)) {
      return {
        value: '2 to 4 years',
        selectText: '2 to 4 years',
        selectPrefer: /2\s*to\s*4/i,
      };
    }
    if (!yoYesNo && m(/years? of ([a-z0-9/+\s-]{0,50})?(experience|exp)\b|ann[ée]es? d.exp[ée]rience|a[ñn]os de experiencia|jahre (berufs)?erfahrung|anni di esperienza|jaar ervaring|how many years|total (work |professional )?(years|experience)|work experience \(years\)|^work experience$/)) {
      const years = Number(id.yearsExperience);
      if (!Number.isFinite(years) || years <= 0) return null;
      // A specific stack or domain ("years with Kubernetes", "years have you
      // used Figma", "years of B2C product design experience") is not the
      // design career total: the resolver reads the CV. Figma itself is only
      // ten years old — "12" was impossible there.
      const GENERIC_WORDS = new Set(['a', 'an', 'the', 'this', 'that', 'our', 'your', 'such', 'similar', 'relevant', 'professional',
        'total', 'overall', 'work', 'working', 'role', 'roles', 'field', 'position', 'area', 'industry', 'capacity', 'product',
        'products', 'design', 'designer', 'designers', 'designing', 'ux', 'ui', 'user', 'experience', 'interaction', 'visual',
        'digital', 'senior', 'lead', 'principal', 'staff', 'as', 'in', 'of', 'full', 'time', 'paid', 'post', 'graduate', 'team']);
      const onlyGeneric = (phrase) => phrase.split(/[^a-z0-9]+/).filter(Boolean).every((w) => GENERIC_WORDS.has(w));
      const about = (s.match(/(?:experience|years)\b[^?.]{0,40}?\b(?:with|in|using|used|managing|leading|as)\s+([a-z][\w\s/+.#-]{1,40})/) || [])[1] || '';
      const qualifier = (s.match(/years? of ([a-z0-9/+\s-]{2,50}?)\s*(?:work\s+)?experience/) || [])[1] || '';
      if ((about && !onlyGeneric(about)) || (qualifier && !onlyGeneric(qualifier))) return null;
      return {
        value: String(years),
        selectText: String(years),
        years,
        selectPrefer: new RegExp(
          [`\\b${years}\\b`, `${years}\\+`, years >= 10 ? '10\\s*\\+' : '', years >= 10 ? '\\d{2}\\+' : '']
            .filter(Boolean)
            .join('|'),
        ),
      };
    }
  }
  // Bare "source"/"referr" substrings used to false-positive on unrelated
  // fields (any label/name/id containing "resource", "preferred", etc.) —
  // require the fuller phrase instead.
  if (m(HEAR_ABOUT_RE)) {
    return hearAboutPlan(id, applicationSource(spec.jobUrl));
  }
  if (m(/english (skills?|level|fluency|proficiency)|rate your english|how .{0,30}english|knowledge of (the )?english|english (language )?knowledge/)) {
    return {
      selectText: 'C1',
      selectRank: [
        /\bc1\b/i,
        /fluent/i,
        /advanced/i,
        /full professional/i,
        /\bc2\b/i,
        /professional working|proficient/i,
      ],
      selectPrefer: /\bc1\b|fluent|advanced|full professional/i,
    };
  }
  // A pick list of AI-use levels. "Tell us about a specific example you've
  // used AI in your work" is an essay, and got "Practitioner".
  if (m(/current use of ai|descri.{0,40}use of ai|ai in your (daily )?work/)
      && (isListField(f) || (f.options || []).length) && !(f.tag === 'textarea' || f.type === 'textarea')) {
    return {
      selectText: 'Practitioner',
      selectRank: [
        /practitioner|apply ai to complex|refine prompts/i,
        /power user/i,
        /regularly use/i,
      ],
      selectPrefer: /practitioner|apply ai to complex|refine prompts/i,
    };
  }
  // References: "Are you able to provide professional references?" is a Yes;
  // "References" as a box to fill is "Available upon request". A list goes to
  // the resolver, which picks among its real rows.
  // Whole word: "Work Type Preference" got "Available upon request".
  if (m(/\breferences?\b|background (check|screening|verification)/) && !m(/referr/) && !isListField(f)) {
    if (YES_NO_OPENER.test(cleanLabel) || m(/happy to|willing to|consent|agree|ok with|comfortable|able to provide|background (check|screening|verification)/)) {
      return { yesNo: 'yes', selectText: 'Yes', value: 'Yes' };
    }
    return { value: id.references };
  }

  // Factual yes/no questions ("Do you…", "Have you…") must never receive a
  // Section F motivation answer, even when token overlap is high (company
  // name + "work" match "why do you want to work at …"). Strip any leading
  // numbering / asterisk / bullet so "* Do you…" or "1. Have you…" still match.
  if (YES_NO_OPENER.test(cleanLabel)) return null;

  // A Section F answer is a paragraph of prose, so it can never be a valid
  // value for a closed-option widget — a <select>, radio group, or react-select
  // combobox only accepts one of its OWN options. Live tracing caught a
  // three-sentence motivation answer being typed into a Yes/No dropdown
  // ("This role requires relocation to Bangkok…"), which matched nothing.
  // Send these to the LLM resolver instead: it gets the real scraped option
  // list and picks a genuine option.
  if (f.tag === 'select' || f.type === 'radio' || isComboboxField(f)) return null;

  if (isOpenBuildQuestion(f)) return null;

  // Free-text questions → Section F answers
  const qa = bestAnswerFor(f.label, spec.answers, usedAnswers, spec.sideNames || [], {
    company: spec.company,
    allowedNames: spec.employerNames || [],
  });
  if (qa) return { value: polishApplicationAnswer(qa.answer, { sideNames: spec.sideNames }), fromQuestion: qa.question };
  if (m(/cover letter|lettre de motivation|motivation|why (do you want|are you interested|us|join)/) && spec.answers.length) {
    const motiv = spec.answers.slice(0, 2).map(a => a.answer).join('\n\n');
    if (!sameLanguage(f.label, motiv)) return null;
    return { value: polishApplicationAnswer(motiv, { sideNames: spec.sideNames }), fromQuestion: 'cover letter (combinaison des réponses F)' };
  }
  return null; // unknown → left for human
}

export function classifyField(f, spec, usedAnswers = new Set()) {
  const plan = classifyFieldRaw(f, spec, usedAnswers);
  if (!planFitsField(f, plan, spec)) return null;
  // A maxlength box cuts the answer mid-word: cut at a sentence instead.
  const max = Number(f?.maxLength);
  if (plan && typeof plan.value === 'string' && max > 0 && plan.value.length > max) {
    return { ...plan, value: fitToMaxLength(plan.value, max) };
  }
  return plan;
}
