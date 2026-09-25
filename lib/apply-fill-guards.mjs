// Pure helpers for apply-runner form filling. Kept free of Playwright so
// identity-vs-typeahead edge cases stay unit-testable.

import { looksLikeSalaryField } from './apply-salary.mjs';

const NEVER_COMBOBOX_TYPES = new Set([
  'email', 'tel', 'url', 'number', 'password',
  'date', 'datetime-local', 'month', 'week', 'time', 'color', 'range',
]);

export function normalizedFieldLabel(f) {
  return String(f.label || '').replace(/[*✱?]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// Native types + identity labels: never a Yes/No widget. Skip the click-and-wait
// probe so First name / Email / Phone go straight to fill().
export function fieldSearchText(f = {}) {
  return `${normalizedFieldLabel(f)} ${f.name || ''} ${f.idAttr || ''}`.toLowerCase();
}

const MARKETING_EMAIL_RE = /newsletter|marketing|opt.?in|may we email|email you about|email updates|keep me (posted|updated)|subscribe/i;
const ECHO_RE = /confirm|confirmation|confirme[rz]?|re-?enter|re-?type|repeat|verify|v[ée]rif(?:ier|iez|ication)?|retape[rz]?/i;

// "Confirm email" / "Re-enter phone" — same value as the identity field, never a list.
export function isIdentityRepeatField(f) {
  const s = fieldSearchText(f);
  if (MARKETING_EMAIL_RE.test(s)) return false;
  if (ECHO_RE.test(s) && /e-?mail|courriel/.test(s)) return true;
  if (ECHO_RE.test(s) && /phone|mobile|t[ée]l[ée]phone/.test(s)) return true;
  if (/email[-_ ]?confirm|confirm[-_ ]?email|emailconfirmation/.test(s)) return true;
  return false;
}

// Dumb confirmation widgets that must not pause the run or call the LLM:
// repeat-the-email inputs, "is this email correct?", "I confirm the info above".
export function trivialFieldPlan(f, id = {}) {
  const s = fieldSearchText(f);
  if (f.type === 'checkbox') {
    if (/self-?identif|demographic|sensitive (self-?)?data/.test(s)) return null;
    if (isApplicationGateConsent(f)) return { check: true };
    if (/(i |je )?(confirm|certify|acknowledge|atteste|certifie)\b/.test(s)
        && /(e-?mail|courriel|information|details|accurat|correct|true|above|ci-dessus|saisie)/.test(s)) {
      return { check: true };
    }
    if (/the information (above|provided|entered).{0,40}(true|accurate|correct)/.test(s)) {
      return { check: true };
    }
    return null;
  }
  if (/is (this|your|the).{0,24}(e-?mail|courriel|email address).{0,24}(correct|right|accurate)|this (e-?mail|email address) is correct/.test(s)) {
    return { yesNo: 'yes', selectText: 'Yes', value: 'Yes' };
  }
  if (isIdentityRepeatField(f)) {
    if (/phone|mobile|t[ée]l/.test(s) && !/e-?mail|courriel/.test(s)) {
      return { value: id.phone || '', optionalEmpty: !id.phone };
    }
    return { value: id.email || '' };
  }
  return null;
}

export function formDialCode(phone = '', country = '') {
  const m = String(phone || '').match(/^\s*(\+\d{1,4})\b/);
  if (m) return m[1];
  const c = String(country || '').toLowerCase();
  if (/france|french/.test(c)) return '+33';
  if (/thailand|tha[iï]lande/.test(c)) return '+66';
  return '';
}

export function looksLikeDialCodeField(f) {
  const s = fieldSearchText(f);
  if (/phone number|mobile number|num[ée]ro/.test(s) && !/dial|indicatif|calling/.test(s)) return false;
  return /dial\s*code|calling\s*code|indicatif|phone[-_ ]?country|country[-_ ]?calling|phone[-_ ]?code/.test(s);
}

export function skipComboboxProbe(f) {
  if (NEVER_COMBOBOX_TYPES.has(String(f.type || '').toLowerCase())) return true;
  if (isIdentityRepeatField(f)) return true;
  const label = normalizedFieldLabel(f);
  if (/^(your |work |personal |professional )?(first name|last name|given name|family name|surname|preferred name|middle name|full name|legal name|pr[ée]nom|nom de famille|nom|email|e-mail|email address|courriel|phone|phone number|mobile|mobile number|mobile phone|t[ée]l[ée]phone|linkedin|linkedin url|linkedin profile|github|twitter|website|portfolio|url)$/.test(label)) {
    return true;
  }
  // Combined name boxes — never a combobox.
  if (/first\s*(name)?\s*(and|&|\/|\+)\s*last|pr[ée]nom et nom|nom et pr[ée]nom/.test(label)) return true;
  return false;
}

export function looksLikeTypeahead(f) {
  const label = normalizedFieldLabel(f);
  if (/how did you hear/.test(label)) return true;
  if (/company name|current company|employer|university|school/.test(label)) return true;
  return /^(your |current |home |work )?(city|ville|country|pays|location|localisation|university|universit[eé]|school|école|college|coll[eè]ge)( of .+)?$/.test(label);
}

export function isComboboxField(f) {
  if (!f) return false;
  if (f.role === 'combobox') return true;
  if (f.ariaAutocomplete === 'list' || f.ariaAutocomplete === 'both') return true;
  if (f.ariaHaspopup === 'listbox' || f.ariaHaspopup === 'menu' || f.ariaHaspopup === 'true') return true;
  if ((f.idAttr || '').includes('react-select')) return true;
  if (f.nearSelectWrapper) return true;
  const tag = String(f.tag || '').toLowerCase();
  if (tag === 'button' && /select|choose|dropdown|country|location/i.test(`${f.label || ''} ${f.name || ''}`)) return true;
  if (/spl-select|oc-select|ant-select|el-select|select2|mui.*select/i.test(`${f.idAttr || ''} ${f.name || ''}`)) return true;
  return false;
}

export function shouldSpeculativeProbe(f) {
  return !skipComboboxProbe(f) && f.tag !== 'textarea' && !f.contentEditable;
}

// Long prose keeps real keystrokes (anti-bot + rich-text widgets). Identity
// and other short values use loc.fill() — typing "Hugo" at 80ms/key adds
// nothing and dominated live run time.
export function shouldHumanType(f, text = '') {
  if (f?.tag === 'textarea' || f?.contentEditable) return true;
  const str = String(text || '');
  if (str.length > 80) return true;
  const label = normalizedFieldLabel(f || {});
  if (/cover letter|lettre de motivation|\bmotivation\b|why (are you|do you)|tell us|describe /.test(label)) return true;
  return false;
}

// A field is multi-select when the DOM says so OR the label asks for several
// ("select up to 3", "select all that apply"). Shared by apply-runner.mjs
// (labels a field before sending it to the LLM resolver) and apply-llm.mjs
// (the resolver's own fallback check) so the two can't drift out of sync.
export function fieldIsMulti(f) {
  return !!f.multiple || /\b(select|choose).{0,20}(all|up to|that apply|multiple|[2-9])\b/i.test(f.label || '');
}

// CV goes only on resume/autofill slots. Dumping it into "Employment
// reference" / "Other" / a size-rejected Browse widget is a live-run bug.
export function fileUploadPlan(f, spec = {}) {
  const s = fieldSearchText(f);
  if (/cover|lettre de motivation/.test(s) && !/resume|\bcv\b/.test(s)) {
    return { skip: 'cover letter file (non géré)' };
  }
  if (/reference|recommendation|transcript|diploma|certificate|work permit|passport|id (card|scan)|other\b|additional file|employment/.test(s)
    && !/resume|\bcv\b|autofill/.test(s)) {
    return { skip: 'pièce jointe non-CV (laissée vide)' };
  }
  if (/exceeds the allowed|too large|file (is )?too big|maximum (file )?size/.test(s)) {
    return { skip: 'fichier rejeté (taille)' };
  }
  if (spec.cvPath) return { upload: spec.cvPath };
  return { skip: 'aucun CV configuré' };
}

// ATS often omit HTML `required` and only mark the question with *, copy,
// aria-required, or a required class on the wrapper.
// Submit-gate consents (Privacy Policy / Terms / "By submitting I agree…").
// ATS often omit HTML `required` yet still block Submit — always treat as fill.
export function isApplicationGateConsent(f) {
  if (!f) return false;
  const type = String(f.type || '').toLowerCase();
  const role = String(f.role || '').toLowerCase();
  if (type !== 'checkbox' && role !== 'checkbox' && role !== 'switch') return false;
  const s = fieldSearchText(f);
  if (/newsletter|marketing|opt.?in|email updates|future (roles?|jobs?|opportunit)|keep me (posted|updated)/.test(s)) {
    return false;
  }
  return /by submitting|i agree that|j'accepte que|i (have )?read.{0,60}(privacy|terms|policy|notice)|privacy polic|terms of (use|service|application)|accepte[rz]? (la |les )?(politique|conditions)/.test(s);
}

export function fieldLooksRequired(f) {
  if (!f) return false;
  if (f.required) return true;
  const label = String(f.label || '');
  if (/[*✱]/.test(label)) return true;
  if (/(^|[\s(])required([\s).:]|$)/i.test(label)) return true;
  return false;
}

export function isCoreApplicationIdentity(f) {
  if (!f || f.type === 'file' || f.type === 'checkbox' || f.type === 'radio') return false;
  if (isIdentityRepeatField(f)) return false;
  const s = fieldSearchText(f);
  if (/newsletter|marketing|opt.?in/.test(s)) return false;
  if (f.type === 'email' || /e-?mail|courriel/.test(s)) return true;
  const label = normalizedFieldLabel(f);
  if (/^(your )?(first name|last name|given name|family name|surname|middle name|preferred name|full name|legal name|pr[ée]nom|nom de famille|nom)$/.test(label)) {
    return true;
  }
  // Single-box "First and last name" / "Name" — Ashby & similar.
  if (/first\s*(name)?\s*(and|&|\/|\+)\s*last\s*name|last\s*(name)?\s*(and|&|\/|\+)\s*first|pr[ée]nom et nom|nom et pr[ée]nom|full\s*name|legal\s*name|^(your\s*)?name$/.test(label)) {
    return true;
  }
  if (/_systemfield_(name|email|phone)/.test(s)) return true;
  if (f.type === 'tel' || /^(phone|phone number|mobile|mobile number|mobile phone|cell|cellphone|telephone|t[ée]l[ée]phone|num[ée]ro de t[ée]l)/.test(label)) {
    return true;
  }
  if (looksLikeDialCodeField(f)) return true;
  return false;
}

export function isResumeFileField(f) {
  if (!f || f.type !== 'file') return false;
  const s = fieldSearchText(f);
  if (/cover|lettre de motivation/.test(s) && !/resume|\bcv\b/.test(s)) return false;
  if (/reference|recommendation|transcript|diploma|other\b|additional file/.test(s) && !/resume|\bcv\b|autofill/.test(s)) return false;
  // SmartRecruiters / Greenhouse dropzones often label the input
  // "Choose a file or drop it here" with no name=resume — still the CV slot.
  if (/choose a file|drop (it|file) here|click or drag|drag (and|&) drop|upload (a |your )?(file|resume|cv)|parcourir/.test(s)) {
    return true;
  }
  return /resume|\bcv\b|curriculum|autofill|\battach\b|_systemfield_resume|resumeurl/.test(s)
    || /^file$/.test(normalizedFieldLabel(f));
}

// Optional but high-signal ATS fields we still fill when profile.yml has data:
// LinkedIn / portfolio / GitHub, location, cover letter, referral source.
// Demographics, salary, and marketing opt-ins stay skipped unless required.
export function isImportantOptionalField(f) {
  if (!f) return false;
  if (f.type === 'checkbox' || f.type === 'radio' || f.type === 'file') return false;
  if (isSecretCredentialField(f)) return false;
  const s = fieldSearchText(f);
  if (/newsletter|marketing|opt.?in|gender|pronoun|race|ethnicity|veteran|disability|sexual orientation|eeo\b|equal opportunity/.test(s)) {
    return false;
  }
  if (/linkedin|github|portfolio|behance|dribbble|website|site (web|internet)|personal (site|url|website)|\bx\.com\b|twitter/.test(s)) {
    return true;
  }
  const label = normalizedFieldLabel(f);
  if (/^(website|portfolio|url|linkedin|github|twitter|x)$/.test(label)) return true;
  if (/current location|where (are you|do you) (based|live)|\bcity\b|\bville\b|\blocation\b|\baddress\b|\badresse\b|based in|place of residence|lieu de r[ée]sidence/.test(s)) {
    return true;
  }
  if (/^(country|pays|city|ville|location|timezone|fuseau)$/.test(label)
      || (/\bcountry\b|\bpays\b/.test(s) && !/relocat|travel|work authorization|visa/.test(s))) {
    return true;
  }
  if (/time[\s_-]*zone|fuseau/.test(s)) return true;
  if (/cover letter|lettre de motivation/.test(s)) return true;
  if (/how did you (hear|find)|where did you (hear|find)|referral source|how you (heard|found)|comment avez-vous (entendu|trouv)/.test(s)) {
    return true;
  }
  if (/notice[\s_-]*period|pr[ée]avis|when can you start|available (to start|from)|disponibilit|\bstart date\b/.test(s)) {
    return true;
  }
  // Work-history block often unmarked as required but expected on Greenhouse.
  if (/company name|current company|employer name|job title|position title|start date|i currently work|currently work here/.test(s)) {
    return true;
  }
  if (/years? of experience|ann[ée]es? d.exp[ée]rience|how many years/.test(s)) return true;
  return false;
}

// Fill required fields, core identity, resume, and high-value optional profile
// fields (portfolio / LinkedIn / location / cover). Leave demographics, salary
// and marketing alone unless the ATS marks them required.
export function shouldFillField(f) {
  if (!f) return false;
  if (fieldLooksRequired(f)) return true;
  if (isApplicationGateConsent(f)) return true;
  if (isResumeFileField(f)) return true;
  if (isCoreApplicationIdentity(f)) return true;
  if (isImportantOptionalField(f)) return true;
  if (isIdentityRepeatField(f) && fieldLooksRequired(f)) return true;
  return false;
}

export function isSecretCredentialField(f) {
  if (!f) return false;
  if (f.type === 'password') return true;
  const s = fieldSearchText(f);
  if (/password to (the |your )?(portfolio|website|link)|mot de passe (pour|du|de)/.test(s)) return true;
  return /^(password|mot de passe|passcode|pass ?phrase)\b/.test(normalizedFieldLabel(f));
}

// Required travel / relocation questions: this candidate is remote, Paris.
export function travelOrRelocatePlan(f) {
  const s = fieldSearchText(f);
  if (/business trips?|willing to travel|open to travel|monthly travel|ready to (go on )?(business )?trips?|travel (for (this|the) )?(role|job|position)/.test(s)) {
    return { yesNo: 'no', selectText: 'No', value: 'No' };
  }
  if (/\brelocat|willing to move|open to moving|based in the gcc/.test(s)) {
    return { yesNo: 'no', selectText: 'No', value: 'No' };
  }
  return null;
}

const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function monthLabel(month) {
  const n = Number(month);
  if (n >= 1 && n <= 12) return MONTH_NAMES[n];
  const s = String(month || '').trim();
  if (!s) return '';
  const hit = MONTH_NAMES.findIndex(m => m && m.toLowerCase() === s.toLowerCase());
  if (hit > 0) return MONTH_NAMES[hit];
  return s;
}

// Work-history block on Greenhouse / Lever / Workday: company, title, dates,
// "I currently work here". Distinct from "when can you start?" availability.
export function employmentHistoryPlan(f, employment = {}) {
  if (!f) return null;
  const s = fieldSearchText(f);
  const company = String(employment.company || '').trim();
  const title = String(employment.title || '').trim();
  const startMonth = monthLabel(employment.startMonth);
  const startYear = String(employment.startYear || '').trim();
  const current = employment.current !== false;

  // Current role → no end date. Handle end-date fields before the "Current role"
  // checkbox so a compound label like "End date year — Current role" does not
  // get a checkbox plan on a year dropdown.
  if (/end date month|end month|(^| )to month/.test(s)) {
    if (current) return { skip: 'poste actuel (pas de mois de fin)', currentRoleEnd: true };
    return null;
  }
  if (/end date year|end year|(^| )to year/.test(s)) {
    if (current) return { skip: 'poste actuel (pas d\'année de fin)', currentRoleEnd: true };
    return null;
  }

  // Checkbox / toggle: currently in this role → tick.
  if (f.type === 'checkbox' || (/current role|i currently work|currently work here|still work(ing)? (here|there)|present (role|position)|this is my current/.test(s) && !/end date|start date/.test(s))) {
    if (/current role|i currently work|currently work here|still work(ing)? (here|there)|present (role|position)|this is my current|currently employ/.test(s)) {
      return current ? { check: true } : { check: false };
    }
  }

  if (/company name|current company|employer name|most recent.{0,40}employer|current employer|who is your (most recent|current) employer/.test(s)
      && !/previous(ly)? work|worked at|former employer|equal opportunity|eeo\b/.test(s)) {
    return company ? { value: company, selectText: company } : null;
  }

  // Bare "Title" / "Job title" in the experience block (not "job title you're applying for").
  if (/^(current |most recent |job |position |role )?title$/.test(normalizedFieldLabel(f))
      || /job title|position title|role title|title at (the )?(company|employer)/.test(s)) {
    return title ? { value: title, selectText: title } : null;
  }

  if (/start date month|start month|(^| )from month/.test(s)) {
    return startMonth
      ? { value: startMonth, selectText: startMonth, selectMatch: String(employment.startMonth || startMonth) }
      : null;
  }
  if (/start date year|start year|(^| )from year/.test(s)) {
    return startYear ? { value: startYear, selectText: startYear, selectMatch: startYear } : null;
  }
  return null;
}

// Age gate / "worked at this company?" — not EEO demographics, not free text.
export function screeningChoicePlan(f, spec = {}) {
  if (!f) return null;
  const s = fieldSearchText(f);
  const company = String(spec.company || '').trim();

  // "Are you 18 years of age or older?" — legal gate, always Yes for this candidate.
  if (/\b18\b.{0,20}(or older|years? (of )?age|years old)|over 18|at least 18/.test(s)) {
    return { yesNo: 'yes', selectText: 'Yes', value: 'Yes' };
  }

  // Agentic / AI product systems — candidate builds AI products (Creads, UXfi, Flemme, Jarvos).
  if (/agentic\s*ai|(ai|artificial intelligence).{0,40}(product|system|agent)|experience.{0,30}(with|in).{0,20}(agentic|ai agents?|llm)/.test(s)) {
    return { yesNo: 'yes', selectText: 'Yes', value: 'Yes' };
  }

  // "Have you previously worked at {Company}?"
  const companyEsc = company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (/previous(ly)? (worked|employed)|worked (at|for|with) (this|the) (company|employer)|former employee|ever (worked|employed) (at|for)/.test(s)
      || (companyEsc && new RegExp(`worked (at|for|with)\\s+${companyEsc}`, 'i').test(s))) {
    return { yesNo: 'no', selectText: 'No', value: 'No' };
  }

  // US state / province of residence. Candidate is not in a US state — prefer
  // Outside US / International / Other when the list offers it. Never invent a
  // US state via the LLM if that option is missing.
  if (/\b(state|province)\b/.test(s) && /live|resid|current|home|based/.test(s)
      && !/\b(united states|usa|statement|estate|state of mind)\b/.test(s)) {
    return {
      selectPrefer: /outside|not in (the )?u\.?s|international|other|n\/?a|none|does not apply|non-?us|abroad|foreign/i,
      leaveBlank: true,
    };
  }

  if (/postal|zip\s*code|code postal/.test(s)) {
    const postal = String(spec.identity?.postal || '').trim();
    if (postal) return { value: postal };
    if (f.required || fieldLooksRequired(f)) {
      return {
        value: 'N/A',
        selectText: 'N/A',
        selectPrefer: /n\/?a|not applicable|none|prefer not|decline|does not apply/i,
      };
    }
    return { skip: 'code postal non renseigné dans le profil', leaveBlank: true };
  }

  return null;
}

const NA_OPTION_RE = /n\/?a|not applicable|none|prefer not|decline|does not apply|no answer/i;

// Hiring manager, school, emergency contact: no profile data. Required slots
// get N/A (or the list's decline option). Optional ones stay empty.
export function unknownThirdPartyPlan(f) {
  if (!f) return null;
  const s = fieldSearchText(f);
  const thirdParty = /hiring[\s_-]*manager|name of (the )?(hiring )?manager|emergency[\s_-]*contact|contact d.urgence|school name|name of (your )?(school|university|college)|university name|nom de l.école|établissement scolaire/.test(s);
  if (!thirdParty) return null;
  if (f.required || fieldLooksRequired(f)) {
    return { value: 'N/A', selectText: 'N/A', selectPrefer: NA_OPTION_RE };
  }
  return { skip: 'tiers (laissé vide)', leaveBlank: true };
}

// City / country / timezone lists often miss a full "City, Region" string.
// Type the first three letters, then take the option that contains the word.
export function locationTypeaheadHint(f, identity = {}) {
  if (!f) return null;
  const s = fieldSearchText(f);
  let source = '';
  if (/time[\s_-]*zone|fuseau/.test(s)) source = identity.timezone || '';
  else if (/\bcountry\b|\bpays\b/.test(s) && !/relocat|visa|sponsor|work authori/.test(s)) source = identity.country || '';
  else if (/\b(city|ville|location)\b/.test(s) && !/relocat|capacity/.test(s)) source = identity.city || identity.location || '';
  else return null;
  const word = String(source).replace(/\(.*?\)/g, '').trim().split(/[\s,/]+/).find((w) => w.length >= 3) || '';
  if (word.length < 3) return null;
  return { prefix: word.slice(0, 3), contains: word };
}

// "When can you start?" availability — never employment "Start date month/year".
export function isAvailabilityStartField(f) {
  const s = fieldSearchText(f);
  if (/start date month|start date year|end date month|end date year|start month|start year|end month|end year/.test(s)) {
    return false;
  }
  return /when can you start|available (to start|from)|disponibilit|availability date|\bstart date\b/.test(s);
}

// Autofill from the CV routinely writes junk (salary 4000, truncated name).
// Identity and salary must be overwritten; long essays already in the box stay.
export function shouldReplaceFilledValue(f, current, planned) {
  const cur = String(current || '').trim();
  const want = String(planned || '').trim();
  if (!want) return false;
  if (!cur) return true;
  if (cur === want) return false;
  const s = fieldSearchText(f);
  if (looksLikeSalaryField(`${f.label || ''} ${f.name || ''}`)) return true;
  if (isIdentityRepeatField(f)) return true;
  if (/e-?mail|courriel/.test(s) && /@/.test(want)) return cur.toLowerCase() !== want.toLowerCase();
  if (/linkedin|github|portfolio|website/.test(s) && /https?:/i.test(want)) return true;
  if (/^(your )?(first name|last name|given name|family name|surname|full name|legal name|pr[ée]nom|nom de famille|phone|phone number|mobile|t[ée]l[ée]phone)$/.test(normalizedFieldLabel(f))) {
    return true;
  }
  if (looksLikeDialCodeField(f)) return true;
  return false;
}
