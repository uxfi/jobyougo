// Pure helpers for apply-runner form filling. Kept free of Playwright so
// identity-vs-typeahead edge cases stay unit-testable.

import { looksLikeSalaryField, numbersInText } from './apply-salary.mjs';
import { listFilterText, choiceKind, optionsAreYesNo, optionsLookLikeWorkPolicy, remotePolicyPlan } from './apply-option-match.mjs';
import { languageKey, languageLevelKind } from './prompt-budget.mjs';
import { candidateIsIn, countryOf, dialCodeOf, placesIn } from './apply-places.mjs';

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

export const MARKETING_EMAIL_RE = /newsletter|marketing|opt.?in|may we email|email (me|you|us) about|email updates|keep me (posted|updated)|subscribe|email me about other job|other job openings within/i;
// Talent-pool consents ("keep my data for future recruitment", "contact me
// about other roles"): screening.consents.future_roles, never this application's gate.
export const FUTURE_ROLES_RE = /future (roles?|jobs?|opportunit|recruit|vacanc|positions?|openings?)|talent (pool|community)|other (job )?(roles?|positions?|openings?|opportunit|vacanc)|keep my (data|cv|profile|application)|offres futures|futurs recrutements|conserver mes donn/;
const MARKETING_CONSENT_RE = /do you agree|personal data|privacy notice|interview process/i;

export function looksLikeMarketingEmailField(f) {
  const s = fieldSearchText(f);
  return MARKETING_EMAIL_RE.test(s) && !MARKETING_CONSENT_RE.test(s);
}
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
  return dialCodeOf(country);
}

// National digits for intl-tel widgets (Greenhouse Country + Phone). The
// country combobox already carries +33 / +66 — pasting the full E.164 string
// into Phone left the dial picker on its geo default (often Australia) and
// looked like an AU number.
export function nationalPhoneNumber(phone = '', dialCode = '', opts = {}) {
  let p = String(phone || '').trim();
  if (!p) return '';
  const code = String(dialCode || '').trim() || (p.match(/^\s*(\+\d{1,4})\b/) || [])[1] || '';
  if (code && p.startsWith(code)) p = p.slice(code.length).trim();
  else p = p.replace(/^\s*\+\d{1,4}\s*/, '').trim();
  const stripped = p.replace(/^0+/, '').trim();
  if (!stripped) return String(phone || '').trim();
  if (opts.keepTrunkZero) return stripped.replace(/^(\d)/, '0$1');
  return stripped;
}

// True when the form has a dedicated country-code / indicatif widget next to
// the number. A residence "Country" field is not that widget, and neither is
// intl-tel-input's flag button: the number box drives that one, so the box
// keeps the international form.
export function formHasPhoneDialPicker(fields = []) {
  return (fields || []).some((f) => {
    if (!looksLikeDialCodeField(f)) return false;
    if (isIntlTelInputPicker(f)) return false;
    const s = fieldSearchText(f);
    if (/dial\s*code|calling\s*code|indicatif|phone[-_ ]?country|country[-_ ]?calling|phone[-_ ]?code/.test(s)) {
      return true;
    }
    const idName = `${f.idAttr || ''} ${f.name || ''}`;
    if (/phone.*country|country.*phone|dial|indicatif/i.test(idName)) return true;
    if (optionsLookLikeDialCodes(f.options)) return true;
    const bare = normalizedFieldLabel(f);
    return /^(your |work |personal |mobile )?(phone|mobile|cell|telephone|t[ée]l[ée]phone)( number)?$/.test(bare)
      && (isComboboxField(f) || String(f.tag || '').toLowerCase() === 'select');
  });
}

// Rows of a country-code picker read "Francia +33", "France (+33)", "+33 France".
const DIAL_ROW_RE = /(^|[\s(])\+\d{1,4}(?=[\s)]|$)/;
export function optionsLookLikeDialCodes(options) {
  const texts = (options || [])
    .map((o) => String(typeof o === 'string' ? o : o?.text || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (texts.length < 3) return false;
  const coded = texts.filter((t) => DIAL_ROW_RE.test(t)).length;
  return coded >= Math.ceil(texts.length * 0.6);
}

// intl-tel-input's flag button (aria-label "Selected country", localised by
// its i18n packs; ids "iti-…"). Its list is localised too ("Francia +33"),
// and the widget sets itself from a "+33 6…" typed in the number box.
export function isIntlTelInputPicker(f) {
  if (!f) return false;
  const label = normalizedFieldLabel(f);
  if (/^(selected country|pays s[ée]lectionn[ée]|pa[ií]s selec(c)?ionado|paese selezionato|ausgew[äa]hltes land|geselecteerd land)$/.test(label)) {
    return true;
  }
  return /(^|[\s_-])iti(__|-\d|-)/i.test(`${f.idAttr || ''} ${f.name || ''}`);
}

// One box that asks for the number AND the dial code ("including the country
// code", "for example: +420 123 456 789"). A split Greenhouse widget must keep
// the national number instead.
export function phoneFieldIncludesDialCode(f) {
  const s = fieldSearchText(f);
  if (/includ\w{0,3} (the )?(country|dial|calling) code|with (the )?(country|dial|calling) code|country code included|indicatif (compris|inclus|international)|avec (l['’])?indicatif|international format|format international|e\.164/.test(s)) {
    return true;
  }
  // An example number written with its "+NN" prefix shows the expected format.
  return /(e\.?g\.?|example|exemple|ex\.?|like|format)[^+\d]{0,12}\+\d{1,4}[\s\d().-]{5,}/i.test(`${f.label || ''} ${f.description || ''} ${f.placeholder || ''}`);
}

// Phone sub-fields that are not the number: "Phone extension", "Phone Device
// Type (Landline | Mobile)". The number typed there was a live Workday bug.
export function isPhoneExtensionField(f) {
  const label = normalizedFieldLabel(f);
  return /(phone|t[ée]l[ée]phone|\btel)\b.{0,12}\b(extension|ext)\b|^(extension|ext\.?)$/.test(label)
    || /phone[-_ ]?ext/.test(`${f.name || ''} ${f.idAttr || ''}`.toLowerCase());
}

export function isPhoneDeviceTypeField(f) {
  return /(phone|t[ée]l[ée]phone)\s*(device\s*)?type|device type|type of (phone|number)|type de t[ée]l[ée]phone/.test(fieldSearchText(f));
}

function controlOwnText(f = {}) {
  return `${f.name || ''} ${f.idAttr || ''} ${f.autocomplete || ''} ${f.className || ''}`.toLowerCase();
}

export function looksLikePhoneNumberField(f) {
  if (!f) return false;
  if (looksLikeDialCodeField(f)) return false;
  if (isPhoneExtensionField(f) || isPhoneDeviceTypeField(f)) return false;
  const type = String(f.type || '').toLowerCase();
  if (type === 'tel') return true;
  if (type === 'textarea' || f.tag === 'textarea') return false;
  // A location typeahead sitting next to the phone must not inherit the
  // phone label blob ("Current location … Phone") and receive the number.
  const own = controlOwnText(f);
  const namedPhone = /phone|tel\b|mobile|whats\s?app|telegram|signal number|viber/.test(own);
  if (!namedPhone) {
    if (/location-input|address-level|street-address/.test(own)) return false;
    if (/(^|[^a-z])(location|city|ville)([^a-z]|$)/.test(own)) return false;
    const head = normalizedFieldLabel(f).slice(0, 48);
    if (/^(current |your |home )?location\b/.test(head) || /^(current |your |home )?(city|ville)\b/.test(head)) return false;
  }
  const label = String(f.label || '').replace(/\s+/g, ' ').trim();
  const s = fieldSearchText(f);
  if (/_systemfield_phone/.test(s)) return true;
  if (/mobile\s+(app|apps|application|feature|product|experience|design)|consumer mobile|shipping .{0,40}mobile|tell us about .{0,80}mobile|experience .{0,40}mobile/i.test(label)) {
    return false;
  }
  if (label.length > 50 && /mobile/i.test(label) && !/phone|t[ée]l[ée]phone|\bcell\b/i.test(label)) return false;
  // "iPhone" is not a phone box: "Which platforms have you designed for
  // (iPhone, Android, web)?" received the phone number. Attribute names
  // such as "candidatephone" or "mobilephone" still are.
  if (/(?<!(?:^|[^a-z])i)phone|t[ée]l[ée]phone|tel[ée]fono|telem[oó]vel|\bcelular\b|\bm[oó]vil\b|telefoon|telefonnummer|handynummer|\btelefon\b|handy|contact number|num[ée]ro de contact|\bmobile\s*no\b|\bmob\.?\s*no\b/.test(s)) return true;
  // A messaging number is the phone: "WhatsApp number with Country Code".
  if (/whats\s?app|telegram|viber|signal/i.test(label) && /\b(number|no\.?|num[ée]ro|nummer|n[uú]mero|contact)\b/i.test(label)) return true;
  const bare = normalizedFieldLabel(f);
  return /^(your |work |personal |mobile )?((phone|mobile|cell)([ -]?(number|no\.?|nr\.?))?|cellphone|telephone|t[ée]l[ée]phone|telefoonnummer|telefoon|telefonnummer|handy)$/.test(bare);
}

export function looksLikeDialCodeField(f) {
  if (String(f?.type || '').toLowerCase() === 'tel') return false;
  const s = fieldSearchText(f);
  if (phoneFieldIncludesDialCode(f)) return false;
  if (isIntlTelInputPicker(f)) return true;
  // A country / prefix list whose rows carry "+33" is the dial picker whatever
  // its label says (Flat 101's "Selected country" was read as the residence
  // country and got "France" typed at a Spanish list).
  if (/country|pays|pa[ií]s|land|phone|t[ée]l|code|prefix|pr[ée]fixe|prefijo|vorwahl|indicatif/.test(s)
      && optionsLookLikeDialCodes(f.options)) {
    return true;
  }
  if (/phone number|mobile number|num[ée]ro/.test(s) && !/dial|indicatif|calling|country/.test(s)) {
    // A Phone-labelled <select>/combobox is the country/dial picker (intl-tel),
    // not the national-number box. Typing the digits there searched the geo
    // default ("Australia +61") on Agoda.
    const list = isComboboxField(f) || String(f.tag || '').toLowerCase() === 'select';
    if (!list) return false;
  }
  if (/dial\s*code|calling\s*code|indicatif|phone[-_ ]?country|country[-_ ]?calling|phone[-_ ]?code|land\s*\/\s*regio[-_ ]?code|country\s*\/\s*region[-_ ]?code/.test(s)) return true;
  // Greenhouse job-boards: intl-tel country combobox is id/name "country"
  // labelled "Country*" next to Phone — not a residence-country question.
  const idName = `${f.idAttr || ''} ${f.name || ''}`.trim();
  if (/^country$/i.test(f.idAttr || '') || /^country$/i.test(f.name || '')) return true;
  if (/phone.*country|country.*phone|dial|indicatif/i.test(idName)) return true;
  if (isComboboxField(f) || String(f.tag || '').toLowerCase() === 'select') {
    const bare = normalizedFieldLabel(f);
    if (/^(your |work |personal |mobile )?(phone|mobile|cell|telephone|t[ée]l[ée]phone)( number)?$/.test(bare)) {
      return true;
    }
  }
  return false;
}

export function skipComboboxProbe(f) {
  if (NEVER_COMBOBOX_TYPES.has(String(f.type || '').toLowerCase())) return true;
  if (isIdentityRepeatField(f)) return true;
  const label = normalizedFieldLabel(f);
  if (/^(your |work |personal |professional )?(first name|last name|given name|family name|surname|preferred name|middle name|full name|legal name|pr[ée]nom|nom de famille|nom|email|e-mail|email address|courriel|phone|phone number|mobile|mobile number|mobile phone|t[ée]l[ée]phone|linkedin|linkedin url|linkedin profile|github|twitter|website|portfolio|url)$/.test(label)) {
    return true;
  }
  if (isBareGivenNameLabel(f) || SURNAME_LABEL_RE.test(label)) return true;
  // Combined name boxes — never a combobox.
  if (/first\s*(name)?\s*(and|&|\/|\+)\s*last|pr[ée]nom et nom|nom et pr[ée]nom/.test(label)) return true;
  return false;
}

// Surname slots in the languages the boards use: Apellido(s), Cognome,
// Sobrenome / Apelido, Nachname, Achternaam.
const SURNAME_RE = /last[\s_-]*name|family[\s_-]*name|surname|nom de famille|\bapellidos?\b|\bcognome\b|\bsobrenome\b|\bapelido\b|\bnachname\b|\bfamilienname\b|\bachternaam\b/;
const SURNAME_LABEL_RE = /^(tu |su |seu |o |il |tuo |your )?(apellidos?(\(s\))?|cognome|sobrenome|apelido|nachname|familienname|achternaam)$/;

// Spanish / Italian / Portuguese "Nombre" / "Nome" on its own. It is the first
// name when the form also asks for the surname, the whole name otherwise —
// never the French "Nombre d'années…" (a number), which has more words.
export function isBareGivenNameLabel(f) {
  if (!f || f.type === 'file' || f.type === 'checkbox' || f.type === 'radio') return false;
  return /^(tu |su |mi |el |o |seu |il |tuo |your )?(nombre|nome)(s|\(s\))?$/.test(normalizedFieldLabel(f));
}

export function formHasSurnameField(fields = []) {
  return (fields || []).some((f) => f && f.type !== 'file' && f.type !== 'checkbox' && f.type !== 'radio'
    && (SURNAME_RE.test(fieldSearchText(f)) || SURNAME_LABEL_RE.test(normalizedFieldLabel(f))));
}

// A first-name slot on the form: then a bare "Nom" / "Name" is the surname.
// "Preferred first name" or a referee's first name is not that slot (Ashby
// forms carry "Name" + "Preferred first name").
const GIVEN_NAME_RE = /first[\s_-]*name|pr[ée]nom|given[\s_-]*name|\bvorname\b|\bvoornaam\b|primer nombre|primeiro nome/;
export function formHasGivenNameField(fields = []) {
  return (fields || []).some((f) => {
    if (!f || f.type === 'file' || f.type === 'checkbox' || f.type === 'radio') return false;
    const s = fieldSearchText(f);
    return GIVEN_NAME_RE.test(s) && !/preferred|nick|middle|second|alias|referr|referee|reference|emergency|contact|supervisor|manager|pr[ée]f[ée]r|d.usage/.test(s);
  });
}

export function looksLikeTypeahead(f) {
  if (optionsLookLikeWorkPolicy(f?.options)) return false;
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
  // Popover picker (eRecruiter): COLLECT_FIELDS only keeps dialog triggers
  // that are labelled form controls.
  if (tag === 'button' && f.ariaHaspopup === 'dialog') return true;
  if (tag === 'button' && /select|choose|dropdown|country|location/i.test(`${f.label || ''} ${f.name || ''}`)) return true;
  if (/spl-select|oc-select|ant-select|el-select|select2|mui.*select/i.test(`${f.idAttr || ''} ${f.name || ''}`)) return true;
  return false;
}

// Closed-option widgets: the only valid answer is one of the widget's own options.
export function isListField(f) {
  if (!f) return false;
  return String(f.tag || '').toLowerCase() === 'select' || f.type === 'radio' || isComboboxField(f);
}

function dialCodeOfPlan(plan = {}) {
  const direct = String(plan.selectMatch || '').trim();
  if (/^\+\d{1,4}$/.test(direct)) return direct;
  const m = `${plan.selectText || ''} ${plan.value || ''}`.match(/(^|\s)(\+\d{1,4})(?=\s|$)/);
  return m ? m[2] : '';
}

// Second search text for a dial-code list, tried when the code found nothing
// (a picker that searches names only): the country name.
export function listTypeQueryAlt(f, plan = {}, identity = {}) {
  if (!f || !looksLikeDialCodeField(f)) return '';
  const first = listTypeQuery(f, plan, identity);
  const country = String(identity.country || '').trim();
  return country && country !== first ? country : '';
}

// What the filler may type into a list's search box. Only lists whose options
// show up (or narrow down) as you type get text: city / location / country,
// employer, school, dial code — and the text is a place or organisation word,
// never the answer prose. Every other list is pick-only: typing "Available
// upon request" into a Yes/No dropdown was the live bug.
export function listTypeQuery(f, plan = {}, identity = {}) {
  if (!f) return '';
  const s = fieldSearchText(f);
  // Yes/No / screening lists are pick-only — never type "Yes" or a city into them.
  // Bitpanda EU-passport mentions "hiring location"; that must not become a
  // location typeahead with plan.value "Yes" (or identity.city "Paris").
  if (plan.yesNo || choiceKind(plan.selectText) || choiceKind(plan.value) || choiceKind(plan.selectMatch)) {
    return '';
  }
  if (optionsLookLikeWorkPolicy(f.options)) return '';
  const planBlob = `${plan.selectText || ''} ${plan.selectMatch || ''} ${plan.value || ''} ${plan.selectPrefer?.source || ''}`;
  if (/only want to work remote|remote only|travel frequently|move to hamburg|hamburg office/i.test(planBlob)) {
    return '';
  }
  if (/relocat|travel|sponsor|visa|passport|work permit|work authori|hybrid|capacity|time[\s_-]*zone|fuseau|privacy notice|protect your|personal data|hamburg/.test(s)) {
    return '';
  }
  if (looksLikeDialCodeField(f)) {
    // The code is the one text every picker shows and searches alike;
    // country names are localised ("Francia", "Frankreich") and "France"
    // filtered a Spanish list down to "Guayana Francesa +594".
    const code = dialCodeOfPlan(plan);
    if (code) return code;
    const country = String(identity.country || '').trim();
    if (country) return country;
    return listFilterText(String(plan.selectText || plan.value || '').trim());
  }
  const placeWord = (v) => String(v || '').replace(/\(.*?\)/g, '').trim()
    .split(/[\s,/]+/).find((w) => w.length >= 3) || '';
  if (/\bcountry\b|\bpays\b/.test(s)) return placeWord(plan.selectMatch || plan.value || identity.country);
  if (/\b(city|ville|location|localisation)\b|where (are you|do you)|based in|place of residence|lieu de r[ée]sidence/.test(s)) {
    const raw = String(plan.selectText || plan.value || '');
    if (/^(yes|no)\b/i.test(raw) || /only want to work remote|remote only|hamburg|travel frequently/i.test(raw)) return '';
    return placeWord(plan.selectMatch || plan.value || identity.city || identity.location);
  }
  if (/company name|current company|employer|universit|school|[ée]cole|college|coll[eè]ge/.test(s)) {
    const v = String(plan.selectText || plan.value || '').trim();
    return v.length >= 2 && v.length <= 60 ? listFilterText(v) : '';
  }
  return '';
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
  return !!f.multiple
    || /\b(select|choose|pick|tick|check)\b.{0,20}\b(all|up to|that apply|multiple|one or more|several|[2-9])\b|\ball that apply\b|(s[ée]lectionne[rz]?|choisi(?:r|ssez)|coche[rz]?)\b.{0,25}\b(plusieurs|toutes)\b/i.test(f.label || '');
}

// CV goes only on resume/autofill slots. Dumping it into "Employment
// reference" / "Other" / a size-rejected Browse widget is a live-run bug.
// A generic documents slot ("Additional files", "Other documents",
// "Attachments"): not the CV slot by name, and the only file input some forms
// have (AssessFirst/Teamtailor shows just "Additional files, Drop your file or
// upload"). Never a reference, transcript, diploma, permit or ID slot.
export function isGenericDocumentSlot(f) {
  if (!f || f.type !== 'file') return false;
  const s = fieldSearchText(f);
  if (isCoverLetterFileField(f)) return false;
  if (/reference|recommendation|transcript|diploma|certificate|work permit|passport|id (card|scan)|employment|portfolio|work samples?|case stud|writing sample|design (exercise|challenge)/.test(s)) return false;
  return /additional files?|other (files?|documents?)|supporting documents?|documents?|attachments?|drop your file|upload (a |your )?files?/.test(s);
}

// True when the CV should go into this generic slot: no dedicated resume slot
// on the form and no CV attached yet.
export function cvFallbackFor(f, fileFields = [], { spec = {}, resumeAlreadyUploaded = false } = {}) {
  return Boolean(spec.cvPath) && !resumeAlreadyUploaded && !fileFields.some(isResumeFileField) && isGenericDocumentSlot(f);
}

// Contact consents ("AssessFirst can contact me", "can use my phone number
// ... SMS", newsletters, marketing): the candidate's own call, never ticked
// by the bot, even when the ATS marks them required.
export function isContactConsent(f) {
  if (!f) return false;
  const type = String(f.type || '').toLowerCase();
  const role = String(f.role || '').toLowerCase();
  if (type !== 'checkbox' && role !== 'checkbox' && role !== 'switch') return false;
  const s = fieldSearchText(f);
  // "contact me about other roles / future opportunities" is the talent-pool consent: it follows the
  // user's screening answer (classifyField), it is not a marketing/SMS opt-in.
  if (/other (roles|positions|jobs|opportunities)|future (roles|positions|jobs|opportunities)|talent (pool|community|network)/.test(s)) return false;
  if (/(can|may|allow|agree to|consent to)\b.{0,60}\b(contact|call|text|e-?mail|message|reach)\b.{0,20}\bme\b|use my (phone|mobile|number|e-?mail)|\bsms\b|text messages?|whatsapp|promotional|newsletter|marketing/.test(s)
    && !/(personal data|my data).{0,100}(recruit|application|candidature)|privacy polic|terms of/.test(s)) return true;
  return false;
}

export function fileUploadPlan(f, spec = {}) {
  const s = fieldSearchText(f);
  if (isCoverLetterFileField(f)) {
    // The letter generated for this company (output/cover-letter-{company}-…pdf,
    // picked by lib/apply-spec.mjs). Without one the slot is reported, so a
    // required letter (Personio "Anschreiben") no longer leaves the send
    // button disabled with nothing to show.
    if (spec.coverLetterPath) return { upload: spec.coverLetterPath, kind: 'cover-letter' };
    return { skip: 'lettre de motivation — aucune générée pour cette offre (menu ⋯ → Cover letter), puis Rescan' };
  }
  // A portfolio / work-sample slot is not the CV slot. On Omnidoc the CV went
  // into "Portfolio" and the real "CV" input stayed empty.
  if (/portfolio|work samples?|case stud|writing sample|design (exercise|challenge)/.test(s) && !/resume|\bcv\b|curriculum/.test(s)) {
    return { skip: 'portfolio (fichier non géré — le CV n’est pas un portfolio)' };
  }
  if (spec.cvFallbackSlot && spec.cvPath && isGenericDocumentSlot(f)) return { upload: spec.cvPath, kind: 'cv-fallback' };
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
  // Talent-pool consents ("keep my data for future recruitment") are opt-in,
  // not the gate to this application.
  if (/newsletter|marketing|opt.?in|email updates|keep me (posted|updated)/.test(s) || FUTURE_ROLES_RE.test(s)) {
    return false;
  }
  // Consent to process the data of THIS application (Polish and German forms
  // require it: "I hereby give consent for my personal data to be processed
  // by CKSource for the purposes of recruitment").
  if (/(consent|agree|zgod|einwillig)[^.]{0,100}(personal data|my data|dane osobowe|daten)[^.]{0,120}(recruit|rekrut|application|bewerbung|candidature|this (job|position|role|vacancy))/.test(s)) {
    return true;
  }
  // Google Forms: "Record <e-mail> as the email to be included with my response".
  if (/record .{0,80} as the e-?mail|e-?mail to be included with my response|record my e-?mail( address)? with my response|enregistrer .{0,80} comme adresse e-?mail|als e-?mail-adresse/.test(s)) return true;
  return /by submitting|i agree that|j'accepte que|i (have )?read.{0,60}(privacy|terms|policy|notice)|privacy polic|terms of (use|service|application)|accepte[rz]? (la |les )?(politique|conditions)/.test(s);
}

export function fieldLooksRequired(f) {
  if (!f) return false;
  if (f.required) return true;
  const label = String(f.label || '');
  if (/[*✱]/.test(label)) return true;
  // Personio writes "(necessary)" / "(erforderlich)" after the label and
  // omits the HTML attribute: its salary and cover-letter slots stayed empty
  // and the send button stayed disabled with nothing reported.
  // "Attach other documents if required / if necessary", "falls erforderlich",
  // "si requis": a condition, not a marker.
  if (/(^|[\s(])(?<!\b(?:if|when|falls|wenn|si)\s)required([\s).:]|$)/i.test(label)) return true;
  // The other markers only as a bracketed tag or at the end of the label, so
  // a question wording ("is it necessary to relocate?") is not read as one.
  if (/\((required|necessary|mandatory|erforderlich|pflichtfeld|pflicht|obligatoire|requis|obligatorio|verplicht)\)|(^|\s)(?<!\b(?:if|when|falls|wenn|si)\s)(necessary|mandatory|erforderlich|pflichtfeld|obligatoire|requis|obligatorio|verplicht)[.:]?$/i.test(label)) return true;
  return false;
}

// True when the field IS a candidate full-name slot (Full name, Name, What is
// your name?, Ashby _systemfield_name). False for open questions that only
// mention "your name" idiomatically ("attached to your name", "make a name").
export function isCandidateFullNameField(f) {
  if (!f || f.type === 'file' || f.type === 'checkbox' || f.type === 'radio') return false;
  const label = normalizedFieldLabel(f);
  const s = fieldSearchText(f);
  const nameAttr = String(f.name || '').toLowerCase().trim();
  const idAttr = String(f.idAttr || '').toLowerCase().trim();
  const ac = String(f.autocomplete || '').toLowerCase().trim();

  // Third-party / non-candidate name slots ("If referred by a friend, please
  // confirm their full name" got the candidate's own name).
  if (/company|file[\s_-]?name|user[\s_-]?name|username|hiring|manager|recruiter|reference|\breferr|\bfriend|colleague|employee|emergency|contact[\s_-]*name|mother|father|spouse|partner|school|universit|employer|their (full )?name/.test(s)) {
    return false;
  }

  // HTML / ATS identity attrs — not label prose
  if (/_systemfield_name/.test(s)) return true;
  if (/^(name|fullname|legalname|legal_name|your_name|candidate_name|candidate-name)$/.test(nameAttr)) return true;
  if (/^(name|fullname|legalname|legal_name|your_name|candidate_name|candidate-name)$/.test(idAttr)) return true;
  if (ac === 'name') return true;

  // Explicit full/legal/candidate name in the label (including "Enter your full name")
  if (/\bfull\s*name\b|\blegal\s*name\b|\bcandidate\s*name\b|\bnom complet\b|\bnombre completo\b|\bnome completo\b|vollst[äa]ndiger name|volledige naam/.test(label)) return true;

  // Whole-label identity only — rejects "…attached to your name" essays
  if (/^(your |candidate |applicant )?(full |legal )?name$/.test(label)) return true;
  if (/^(votre )?(nom|nom complet)$/.test(label)) return true;
  if (/^(what is |what's |whats )your (full |legal )?name$/.test(label)) return true;
  if (/^(please )?(enter |type |provide |fill in )?(your )?(full |legal )?name$/.test(label)) return true;
  if (/^(quel est |quelle est )?(votre )?(nom|nom complet)$/.test(label)) return true;

  return false;
}

export function isCoreApplicationIdentity(f) {
  if (!f || f.type === 'file' || f.type === 'checkbox' || f.type === 'radio') return false;
  if (isIdentityRepeatField(f)) return false;
  const s = fieldSearchText(f);
  if (MARKETING_EMAIL_RE.test(s)) return false;
  if (f.type === 'email' || /e-?mail|courriel/.test(s)) return true;
  const label = normalizedFieldLabel(f);
  if (/^(your )?(first name|last name|given name|family name|surname|middle name|preferred name|pr[ée]nom|nom de famille|vorname|voornaam|primer nombre|primeiro nome)$/.test(label)) {
    return true;
  }
  if (isBareGivenNameLabel(f) || SURNAME_LABEL_RE.test(label)) return true;
  // Single-box "First and last name" — Ashby & similar.
  if (/first\s*(name)?\s*(and|&|\/|\+)\s*last\s*name|last\s*(name)?\s*(and|&|\/|\+)\s*first|pr[ée]nom et nom|nom et pr[ée]nom/.test(label)) {
    return true;
  }
  if (isCandidateFullNameField(f)) return true;
  if (/_systemfield_(email|phone)/.test(s)) return true;
  if (looksLikePhoneNumberField(f)) return true;
  if (looksLikeDialCodeField(f)) return true;
  return false;
}

/** A cover-letter upload slot (never the CV slot). */
export function isCoverLetterFileField(f) {
  if (!f || f.type !== 'file') return false;
  const s = fieldSearchText(f);
  // "cover" as a word or "cover_letter"/"coverletter": "How did you discover
  // us?" is not a letter slot.
  return /(?<![a-z])cover(?![a-z])|cover(ing)?[\s_-]*letter|lettre de motivation|anschreiben|motivationsschreiben|carta de presentaci/.test(s) && !/resume|\bcv\b|lebenslauf/.test(s);
}

export function isResumeFileField(f) {
  if (!f || f.type !== 'file') return false;
  const s = fieldSearchText(f);
  if (isCoverLetterFileField(f)) return false;
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
  if (isSubstantiveOptionalQuestion(f)) return true;
  return false;
}

// Optional essays and "link to code" still need an answer. A portfolio URL
// rule must not be what fills them, and shouldFillField must not skip them.
export function isSubstantiveOptionalQuestion(f) {
  if (!f) return false;
  if (f.type === 'checkbox' || f.type === 'radio' || f.type === 'file') return false;
  if (isSecretCredentialField(f)) return false;
  const s = fieldSearchText(f);
  if (/newsletter|marketing|opt.?in|gender|pronoun|race|ethnicity|veteran|disability|sexual orientation|eeo\b/.test(s)) {
    return false;
  }
  if (/link to code|code you wrote|where does ai|design decision|behaved in the browser|websites you designed/.test(s)) {
    return true;
  }
  const tag = String(f.tag || f.type || '').toLowerCase();
  return (tag === 'textarea' || f.type === 'textarea') && String(f.label || '').trim().length > 40;
}

// Fill required fields, core identity, resume, and high-value optional profile
// fields (portfolio / LinkedIn / location / cover). Leave demographics, salary
// and marketing alone unless the ATS marks them required.
export function shouldFillField(f) {
  if (!f) return false;
  if (isContactConsent(f)) return false;
  if (fieldLooksRequired(f)) return true;
  if (isApplicationGateConsent(f)) return true;
  if (isResumeFileField(f)) return true;
  if (isCoreApplicationIdentity(f)) return true;
  if (isImportantOptionalField(f)) return true;
  if (isIdentityRepeatField(f) && fieldLooksRequired(f)) return true;
  // Greenhouse Bitpanda-style screening (may lose the "*" in some scrapes).
  if (travelOrRelocatePlan(f)) return true;
  const s = fieldSearchText(f);
  if (/eu passport|european (union )?passport|passport or .{0,60}work permit|possess .{0,40}(eu )?passport|valid work permit that authori|protect your (personal )?data|control over your personal data|job applicant privacy/.test(s)) {
    return true;
  }
  return false;
}

// Credentials are never typed for the candidate and never handed to the model:
// "Retype Password" (a text input on Havi) came back as "********" and
// "password123" from the resolver.
export function isSecretCredentialField(f) {
  if (!f) return false;
  if (String(f.type || '').toLowerCase() === 'password') return true;
  const s = fieldSearchText(f);
  if (/password to (the |your )?(portfolio|website|link)|mot de passe (pour|du|de)/.test(s)) return true;
  const label = normalizedFieldLabel(f);
  if (/^(password|mot de passe|passcode|pass ?phrase)\b/.test(label)) return true;
  return label.length <= 48 && /\b(password|passwort|mot de passe|passcode|pass ?phrase|pin code|code pin)\b/.test(label);
}

// Criminal record, bankruptcy, dismissal: a legal statement only the
// candidate can make. The resolver answered "YES" to "Have you been convicted
// of any criminal offences…" on Starling.
export function isPersonalLegalQuestion(f) {
  if (!f) return false;
  const s = fieldSearchText(f);
  return /criminal|convict|offen[cs]es?\b|felon|misdemean|bankrupt|insolven|\bccjs?\b|\bivas?\b|debt (management|relief)|county court judg|dismissed from|terminated (from|for cause)|fired from|disciplinary (action|procedure)|debarred|struck off|casier judiciaire|condamn|faillite|licenci[ée]e? pour faute/.test(s);
}

// A box that wants the CV as text ("Resume", "Paste your CV here"). Not a
// question that merely mentions the CV ("…a link to your portfolio if not
// already in your CV?" received the whole markdown CV).
export function isResumePasteField(f) {
  if (!f) return false;
  const label = normalizedFieldLabel(f);
  const own = `${f.name || ''} ${f.idAttr || ''}`.toLowerCase();
  if (/link|url|portfolio|website|http|cover|lettre|why|describe|experience|tell us/.test(`${label} ${own}`)) return false;
  if (/resume[_-]?text|cv[_-]?text|resume_body|paste[_-]?resume/.test(own)) return true;
  return /^((please )?paste |copy )?(your )?(resume|cv|curriculum( vitae)?|r[ée]sum[ée])( text| here| \(text\)| \/ cv| or cv)?$/.test(label)
    || /^(please )?(paste|copy)( and paste)? (your )?(resume|cv|curriculum)/.test(label);
}

// Street / district / building lines are not the city: "Street Name" and
// "District (Amphoe or Khet)" both received "Paris, France".
export function isAddressLineField(f) {
  if (!f) return false;
  const s = fieldSearchText(f);
  // "building" as a verb ("experience building and launching…") is not an
  // address line. Only a building name/number, or a field that is just "Building".
  const label = normalizedFieldLabel(f);
  if (/^(address )?(building|bldg)( name| number| no\.?)?$/.test(label)) return true;
  return /street|address line|address \d|line [12]\b|\bdistrict\b|amphoe|khet|sub-?district|apartment|\bapt\b|\bsuite\b|\b(building|bldg)\s*(name|number|no\.?|#)\b|house (number|no)|num[ée]ro de rue|compl[ée]ment d.adresse|\bcounty\b/.test(s);
}

// A required tick box worded as the candidate's own statement ("I am applying
// for recruitment process!", "I confirm the information is accurate"). Not a
// newsletter or a talent-pool opt-in.
export function isRequiredAffirmation(f) {
  if (!f || (f.type !== 'checkbox' && f.role !== 'checkbox' && f.role !== 'switch')) return false;
  if (!(f.required || fieldLooksRequired(f))) return false;
  const s = fieldSearchText(f);
  if (MARKETING_EMAIL_RE.test(s) || FUTURE_ROLES_RE.test(s)) {
    return false;
  }
  const own = String(f.label || '').split(/\s+[—–]\s+/).pop().replace(/^[\s*✱•]+/, '').trim();
  if (/\b(i|je)\s+(do not|don't|am not|have not|n['’]?ai pas|ne suis pas)\b/i.test(own)) return false;
  return /^(i|je|j['’])\s*(am|have|agree|accept|confirm|understand|consent|declare|acknowledge|certify|authori[sz]e|give|ai|accepte|confirme|certifie|consens|autorise|reconnais|d[ée]clare)\b/i.test(own);
}

function findSpokenLanguage(languages, askedKey) {
  if (!askedKey) return null;
  return (languages || []).find((row) => languageKey(row.name || row.key) === askedKey) || null;
}

// Every language the question names: "English and Chinese as working
// language" is a No when only English is spoken (Bybit got a Yes).
function askedLanguageKeys(s) {
  const re = /\b(french|fran[cç]ais|english|anglais|spanish|espa[nñ]ol|espagnol|thai|tha[iï]|german|deutsch|allemand|italian|italiano|italien|portuguese|portugu[eê]s|portugais|dutch|nederlands|n[eé]erlandais|arabic|arabe|chinese|mandarin|chinois|japanese|japonais|korean|cor[eé]en|russian|russe|polish|polonais|swedish|su[eé]dois)\b/gi;
  return [...new Set([...String(s || '').matchAll(re)].map((m) => languageKey(m[1])))];
}

export function looksLikeSpokenLanguageQuestion(f) {
  const s = fieldSearchText(f);
  if (/programming language|design language|markup language|query language/i.test(s)) return false;
  return /\b(fluent|fluency|speak|speaker|langue|langues|anglais|fran[cç]ais|spanish|english|french|german|italian|portuguese|arabic|mandarin|chinese|japanese|dutch|thai|swedish|polish|russian|native speaker|mother tongue|langue maternelle|parlez-vous)\b/i.test(s)
    && /fluent|speak|parl|niveau|level|skills?|proficien|native|mother tongue|langue maternelle|courant|bilingue|working language|business language|langue de travail/i.test(s);
}

/** Yes/No or level for a spoken language, from the CV/profile list. Never an essay. */
export function languageQuestionPlan(f, languages = []) {
  if (!f || !looksLikeSpokenLanguageQuestion(f)) return null;
  if (f.type === 'textarea' || f.tag === 'textarea') return null;
  // No language list in the spec is not "speaks nothing": an older spec
  // answered No to "Are you fluent in French?" for a native speaker.
  if (!languages?.length) return null;
  const s = fieldSearchText(f);
  const askedKeys = askedLanguageKeys(s);
  const asked = askedKeys[0] || '';
  const hit = findSpokenLanguage(languages, asked);
  const kind = languageLevelKind(hit?.level);
  const yesNoAsk = /fluent in|are you fluent|do you speak|can you speak|parlez-vous|native speaker|mother tongue|langue maternelle|courant en/i.test(s)
    || /^(are|do|can|is) you\b/i.test(String(f.label || '').replace(/^[\s*••\-–—.)\d:]+/, '').trim());

  if (asked && yesNoAsk) {
    // A working / business language is a fluent one. A native / mother
    // tongue question needs a native level: C1 answered "Yes" to "Are you a
    // native English speaker?".
    // "Native or fluent", "native/bilingual", "near-native": a fluent level
    // qualifies, so only a question that asks for native alone needs it.
    // "Native-level proficiency" or "native (C2)" still asks for native: only
    // an explicit alternative lets a fluent level qualify.
    const nativeTerm = /\bnative\b|mother tongue|first language|langue maternelle|langue natale|lengua materna|muttersprache|madrelingua|l[ií]ngua materna/i.test(s);
    const fluentAlternative = /\bor (?:fluent|bilingual|near[- ]native|c1|equivalent)\b|\bfluent or\b|native\s*\/\s*(?:fluent|bilingual)|fluent\s*\/\s*native|bilingu|near[- ]native/i.test(s);
    const wantNative = nativeTerm && !fluentAlternative;
    const wantFluent = !wantNative && /fluent|courant|proficien|bilingu|near[- ]native|working language|business level|professional level|\bc1\b/i.test(s);
    const yes = askedKeys.every((key) => {
      const row = findSpokenLanguage(languages, key);
      const level = languageLevelKind(row?.level);
      if (wantNative) return level === 'native';
      return wantFluent ? level === 'native' || level === 'fluent' : !!row;
    });
    return {
      yesNo: yes ? 'yes' : 'no',
      selectText: yes ? 'Yes' : 'No',
      selectPrefer: yes ? /^(yes|oui)\b/i : /^(no|non)\b/i,
      value: yes ? 'Yes' : 'No',
    };
  }
  if (asked && hit && /level|skills?|proficiency|rate|niveau/.test(s)) {
    // A native speaker is Native / C2 below, not C1.
    if (asked === 'english' && kind === 'fluent') {
      return {
        selectText: 'C1',
        selectRank: [/\bc1\b/i, /fluent/i, /advanced/i, /full professional/i, /\bc2\b/i, /professional working|proficient/i],
        selectPrefer: /\bc1\b|fluent|advanced|full professional/i,
      };
    }
    if (kind === 'native') {
      return {
        selectText: 'Native',
        selectPrefer: /native|maternel|c2|mother/i,
        value: 'Native',
      };
    }
    if (kind === 'fluent') {
      return {
        selectText: 'Fluent',
        selectPrefer: /fluent|c1|advanced|professional|courant/i,
        value: 'Fluent',
      };
    }
    if (kind === 'basic' || kind === 'intermediate') {
      return {
        selectText: kind === 'basic' ? 'Basic' : 'Intermediate',
        selectPrefer: kind === 'basic' ? /basic|beginner|a1|a2|notions/i : /intermediate|b1|b2/i,
        value: kind === 'basic' ? 'Basic' : 'Intermediate',
      };
    }
  }
  if (!asked && /what languages|which languages|languages? (do you|you speak)|langues? (parl|maîtris)/i.test(s)
      && languages.length) {
    const text = languages.map((row) => `${row.name} (${row.level})`).join(', ');
    return { value: text, selectText: text };
  }
  return null;
}

// Required travel / relocation / onsite-hybrid questions for a profile that
// states no policy (lib/apply-policy.mjs answers them when it does).
// `remoteOnly: false` (a stated non-remote policy) keeps the office-visit
// "No" below from answering for the candidate.
export function travelOrRelocatePlan(f, { policyDriven = false, remoteOnly = true } = {}) {
  const s = fieldSearchText(f);
  // Already in a listed country (France): no paid move needed. Do not treat
  // "without relocation assistance" as "will you relocate?".
  if (/without[^.?]{0,40}relocation assistance|relocation assistance from|fill the position in one of the countries listed/.test(s)) {
    return { yesNo: 'yes', selectText: 'Yes', value: 'Yes' };
  }
  // The blanket "No" answers below are the historical default for a profile
  // without a policy. With one, lib/apply-policy.mjs has already answered
  // (it said Yes to a Bangkok office for the Bangkok base, and to offsites):
  // what it left is not a Yes/No, and stays with the resolver.
  if (!policyDriven) {
    if (/business trips?|willing to travel|open to travel|monthly travel|ready to (go on )?(business )?trips?|travel (for (this|the) )?(role|job|position)/.test(s)) {
      return { yesNo: 'no', selectText: 'No', value: 'No' };
    }
    if (/\brelocat|willing to move|open to moving|based in the gcc|based in,? or willing to relocate/.test(s)) {
      return { yesNo: 'no', selectText: 'No', value: 'No' };
    }
    // "3 days in office / hybrid model" — not compatible with full-remote profile.
    if (/(hybrid|in[- ]office|on[- ]?site|onsite).{0,40}(day|week|model)|days? (a|per) week in (the )?office|make yourself available for the required hybrid/.test(s)) {
      return { yesNo: 'no', selectText: 'No', value: 'No' };
    }
  }
  // Ashby "Location" whose list is Hamburg / travel / remote-only — not a city.
  // Only on place / office labels: a visa option that mentions remote work
  // must not steal the legal-right question.
  if (optionsLookLikeWorkPolicy(f.options)
      && /\blocation\b|hamburg|visit|office|hybrid|travel|relocat/.test(s)) {
    return remotePolicyPlan(f.options);
  }
  if (remoteOnly && /visiting .{0,80}(office|hamburg)|hamburg office|not based in hamburg|week per month .{0,40}(hamburg|office)/.test(s)) {
    return {
      yesNo: 'no',
      selectText: 'No',
      selectPrefer: /only want to work remote|this doesn.?t work for me|^no\b/i,
      value: 'No',
    };
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

  // "What is your current role?" is the job title. "Current role" as a
  // checkbox / "I currently work here" is the still-employed toggle.
  // Matching every "current role" label as a tick wrote "yes" into Agoda.
  if (/what is your current role|your current (job |role )?title|current (job )?title\b|what.{0,24}current (role|title|position)/.test(s)
      && !/end date|start date|currently work here|i currently work/.test(s)) {
    return title ? { value: title, selectText: title } : null;
  }

  const roleToggle = /i currently work here|currently work here|still work(ing)? (here|there)|this is my current (role|position|job)|currently employ(ed)? here/.test(s)
    || ((f.type === 'checkbox' || f.role === 'checkbox' || f.role === 'switch')
      && /current role|present (role|position)|currently employ/.test(s));
  if (roleToggle && !/end date|start date|what is your current role/.test(s)) {
    return current ? { check: true } : { check: false };
  }

  // "notice period to your current employer" and "non-compete with your
  // current employer" name the employer; they are not the company box.
  // Matching them wrote "OneAsset" into the notice field and dropped a
  // correct "No" on the non-compete (the company name is not Yes or No).
  // An essay that mentions the current company ("Why are you looking to
  // leave your current company?") is not the company box.
  const essayBox = f.tag === 'textarea' || f.type === 'textarea';
  if (!essayBox && /company name|current company|employer name|most recent.{0,40}employer|current employer|who is your (most recent|current) employer/.test(s)
      && !/previous(ly)? work|worked at|former employer|equal opportunity|eeo\b|notice[\s_-]*period|pr[ée]avis|non-?compete|non-?competition|non-concurrence|bound by|agreement|restrict|\bwhy\b|\bhow\b|\bleaving\b|leave (your|the|my) (current )?(company|employer|job|role)|\bquit|desired|applying|target|ideal|looking (for|to)/.test(s)) {
    return company ? { value: company, selectText: company } : null;
  }

  // Bare "Title" / "Job title" in the experience block (not "job title you're
  // applying for", not a Mr / Mrs salutation list).
  const salutations = (f.options || []).filter((o) => /^(mr|mrs|ms|miss|mx|dr|prof|sir|madam|m\.|mme|mlle|herr|frau|sr|sra|sig\.?|sig\.?ra)\.?$/i.test(String(typeof o === 'string' ? o : o?.text || '').trim())).length;
  if (!essayBox && salutations < 2
      && !/applying|desired|target|wish|want|ideal|looking|next role|position you/.test(s)
      && (/^(current |most recent |job |position |role )?(title|designation)$/.test(normalizedFieldLabel(f))
        || /job title|position title|role title|title at (the )?(company|employer)|current designation/.test(s))) {
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

function foldName(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\b(group|groupe|inc|sas|sa|gmbh|ltd|plc|llc|s\.?r\.?o|ag|bv)\b\.?/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

/** The hiring company is one of the CV's employers (same name, legal suffix aside). */
export function workedAtCompany(company, employerNames = []) {
  const want = foldName(company);
  if (want.length < 3) return false;
  return (employerNames || []).some((name) => {
    const have = foldName(name);
    if (have.length < 3) return false;
    return have === want || (Math.min(have.length, want.length) >= 4 && (have.startsWith(`${want} `) || want.startsWith(`${have} `)));
  });
}

// The question itself is a Yes/No: Yes|No rows, or it opens on "Do you /
// Have you…". "Which best describes your experience with AI-powered
// products?" is a pick list and got a flat "Yes" from the AI rule below.
function asksYesNo(f) {
  const opts = (f.options || []).map((o) => String(typeof o === 'string' ? o : o?.text || '').trim())
    .filter((t) => t && !/^(select|choose|--|please|s[ée]lectionn)/i.test(t));
  if (opts.length) return optionsAreYesNo(opts);
  const q = String(f.label || '').replace(/^[\s*•\-–—.)\d:]+/, '').trim();
  return /^(do|did|does|have|has|are|were|will|would|can|could|is)\s+(you|your)\b/i.test(q);
}

/**
 * Facts the Yes/No gates are allowed to use. Empty evidence means "don't
 * answer": absence in the CV is not a No.
 */
export function derivePractice(profile = {}, cvText = '') {
  const compensation = profile?.compensation || {};
  const search = profile?.search || {};
  const location = profile?.location || {};
  const money = [
    compensation.target_range,
    compensation.minimum,
    ...(Array.isArray(search.contract_types) ? search.contract_types : []),
  ].filter(Boolean).join('\n');
  const residence = [
    location.country,
    location.city,
    location.default_city,
    location.default_country,
    location.asia_city,
    location.asia_country,
  ].filter(Boolean).join(' ');
  return {
    evidence: String(cvText || ''),
    canInvoice: /\b(freelance|contractor|\/\s*day|per day|day rate|journ[ée]e)\b/i.test(money),
    hasResidence: residence.trim().length > 0,
    livesInCalifornia: /\bcalifornia\b/i.test(residence),
  };
}

export function practiceFrom(spec = {}) {
  return spec.practice || spec.identity?.practice || null;
}

function practiceEvidence(spec = {}) {
  return String(practiceFrom(spec)?.evidence || '');
}

function yesNo(value) {
  const yes = value === true || value === 'yes';
  return yes
    ? { yesNo: 'yes', selectText: 'Yes', value: 'Yes' }
    : { yesNo: 'no', selectText: 'No', value: 'No' };
}

// Age gate / "worked at this company?" — not EEO demographics, not free text.
export function screeningChoicePlan(f, spec = {}) {
  if (!f) return null;
  const s = fieldSearchText(f);
  const company = String(spec.company || '').trim();

  // "Are you 18 years of age or older?" — legal gate, always Yes for this candidate.
  // "over 18 months" is a duration, not an age.
  if (/\b18\b.{0,20}(or older|years? (of )?age|years old)|(over|at least|older than) 18\b(?!\s*(months?|weeks?|days?|hours?|%|mois|semaines))|\b18\+(?!\s*(months?|weeks?|days?))/.test(s)) {
    return { yesNo: 'yes', selectText: 'Yes', value: 'Yes' };
  }

  // Experience with agentic AI. Only when the CV says so. "Have you reviewed
  // the CandyAI product" is the company's name, not a skill claim.
  if (f.type !== 'textarea' && f.tag !== 'textarea' && asksYesNo(f)
      && /agentic\s*ai|experience.{0,40}(with|in|designing|building|working).{0,30}(agentic|ai agents?|llm)/.test(s)
      && !/reviewed the|comfortable with/.test(s)) {
    const evidence = practiceEvidence(spec);
    if (!evidence) return null;
    if (/\bagentic\b|\bai agents?\b|\bllm orchestration\b/i.test(evidence)) return yesNo(true);
    return null;
  }

  // "Have you personally led the development and launch of customer-facing AI-native …"
  if (f.type !== 'textarea' && f.tag !== 'textarea' && asksYesNo(f)
      && /led the development and launch|customer-facing ai-native|launch of .{0,60}ai-native/.test(s)) {
    const evidence = practiceEvidence(spec);
    if (!evidence) return null;
    if (/\bai[- ]native\b|\bagentic\b|\bshipped\b|launch/i.test(evidence)) return yesNo(true);
    return null;
  }

  // "Have you personally both designed and written the production code for
  // websites that are live today?" Not a URL field. Yes only when the CV
  // shows shipped front-end code.
  if (f.type !== 'textarea' && f.tag !== 'textarea' && asksYesNo(f)
      && /designed and written the production code|wrote the html/.test(s)) {
    const evidence = practiceEvidence(spec);
    if (!evidence) return null;
    const writesCode = /\bnext\.?js\b|\bjavascript\b|\breact\b|\bproduction code\b/i.test(evidence);
    const shipped = /\bvercel\b|\bdeployment\b|\blive\b|\bshipped\b|\bcloud run\b/i.test(evidence);
    if (writesCode && shipped) return yesNo(true);
    return null;
  }

  // "Can you invoice for this engagement?" Yes when the profile has a day
  // rate or a freelance / contractor contract. Otherwise leave it open.
  if (f.type !== 'textarea' && f.tag !== 'textarea' && asksYesNo(f)
      && /can you invoice|able to invoice|invoice for this/.test(s)) {
    if (practiceFrom(spec)?.canInvoice) return yesNo(true);
    return null;
  }

  // "Have you previously worked at {Company}?" / "employed by Mozilla before?"
  // Agoda/Booking: parent-auditor independence / "ex-employee of Deloitte".
  const companyEsc = company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (/previous(ly)? (worked|employed)|been employed by|employed by .{0,80} before|have you been employed|presently employed by|currently employed by|employed by any (company|entit)|worked (at|for|with) (this|the) (company|employer)|former employee|ever (worked|employed) (at|for)|ex-employee|current\/an ex-employee/.test(s)
      || /\bdeloitte\b|independent audi|impairment of .{0,60}parent/.test(s)
      || (companyEsc && new RegExp(`worked (at|for|with)\\s+${companyEsc}`, 'i').test(s))) {
    // Applying to a former employer (Renault, LVMH, Société Générale…): the
    // CV says yes. A blanket No would be a false statement there.
    if (workedAtCompany(company, spec.employerNames) && !/\bdeloitte\b|independent audi|impairment of/.test(s)) {
      return { yesNo: 'yes', selectText: 'Yes', value: 'Yes' };
    }
    return { yesNo: 'no', selectText: 'No', value: 'No' };
  }

  const identity = spec.identity || {};
  if (/currently located in|are you (currently )?(located|based|living|residing) in|do you (currently )?(live|reside) in/.test(s)
      && !/relocat|willing to|open to mov/.test(s)) {
    // Is the candidate in the place the question names: a city, a country or
    // a region ("the San Francisco Bay Area", "Madrid", "EMEA")? Places the old
    // short list did not know fell through to "Location → Yes".
    const inPlace = candidateIsIn(String(f.label || ''), identity);
    if (inPlace === true) return { yesNo: 'yes', selectText: 'Yes', value: 'Yes' };
    if (inPlace === false) return { yesNo: 'no', selectText: 'No', value: 'No' };
  }

  // US state / province of residence: the profile's location.us_state for a
  // US base; anyone else prefers Outside US / International / Other when the
  // list offers it. Never invent a US state via the LLM.
  if (/\b(state|province)\b/.test(s) && /live|resid|current|home|based/.test(s)
      && !/\b(united states|usa|statement|estate|state of mind)\b/.test(s)) {
    const state = String(identity.usState || '').trim();
    if (state && !/^outside/i.test(state)) return { value: state, selectText: state };
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
  const thirdParty = /hiring[\s_-]*manager|name of (the )?(hiring )?manager|emergency[\s_-]*contact|contact d.urgence|school name|name of (your )?(school|university|college)|university name|nom de l.école|établissement scolaire|\breferr(er|al name|ed by)|who referred|employee (name|id)|friend.{0,20}name|name of (the )?(person|employee|friend|colleague)|parrain|coopt/.test(s);
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
  if (looksLikeDialCodeField(f)) return null;
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
  // "Disponibilidad para viajar" / "disponibilité pour des déplacements" is
  // travel, not the start date.
  if (/viaj|travel|d[ée]placement|reise|relocat|remote|t[ée]l[ée]travail|horaire|schedule|hours|weekend|shift|astreinte/.test(s)) return false;
  return /when (can|could|would|will) you (be able to )?(start|join)|how (quickly|soon) .{0,40}(start|join)|able to (start|join)|available (to start|from)|disponibilit|disponibilidad|availability date|\bstart date\b|earliest (start|joining) date|joining date|eintrittsdatum|fr[üu]hestm[öo]glicher eintritt|verf[üu]gbar ab|fecha de incorporaci[oó]n|beschikbaarheid|data di inizio/.test(s);
}

// "Current location" is a city, not the profile's location policy
// ("Full remote · Paris or Thailand, depending on the role").
export function isPlaceIdentityField(f) {
  if (!f || f.type === 'checkbox' || f.type === 'radio' || f.type === 'file') return false;
  if (String(f.type || '').toLowerCase() === 'tel') return false;
  const own = controlOwnText(f);
  if (/phone|tel\b|mobile/.test(own) && !/location/.test(own)) return false;
  if (/location-input|address-level[12]|street-address/.test(own)) return true;
  if (/(^|[^a-z])(location|city|ville)([^a-z]|$)/.test(own) && !/phone/.test(own)) return true;
  const head = normalizedFieldLabel(f).slice(0, 72);
  if (/phone|t[ée]l[ée]phone/.test(head) && !/^(current |your |home )?location\b|^(current |your |home )?(city|ville)\b/.test(head)) return false;
  if (/relocat|visa|sponsor|time zone|hiring location|willing|open to|office|hybrid/.test(head)) return false;
  if (isAddressLineField(f)) return false;
  return /^(current |your |home )?location\b|^(current |your |home )?(city|ville|address|adresse)\b|where (are|do) (you|your)\b.{0,16}\b(based|live|located|reside|living)\b|place of residence|city of residence|o[uù] (êtes|habitez)[- ]vous/.test(head);
}

// Autofill from the CV routinely writes junk (salary 4000, truncated name,
// the profile's location sentence). Identity and salary must be overwritten
// when wrong; a value that already matches, and long essays already in the
// box, stay.
// Prompt wording only: a real "None" / "N/A" answer is an answer, and
// treating it as empty had the field re-picked on every pass. A lone dash
// is never an answer, nor a placeholder framed by dashes ("-- No answer --",
// "— Select —").
const EMPTY_CHOICE_RE = /^(select\b.*|choose\b.*|pick\b.*|please\b.*|-+|--.*|[—–].*|s[ée]lectionn.*|choisi[rs]?.*|selecci[oó]n.*|elij?[ae].*|elige.*|w[äa]hlen.*|bitte.*|scegli.*|selezion.*|kies.*|selecteer.*)$/i;

export function looksLikeEmptyChoice(text) {
  const t = String(text || '').trim();
  if (!t) return true;
  return EMPTY_CHOICE_RE.test(t) && t.length < 48;
}

export function fieldHasCommittedValue(f) {
  if (!f) return false;
  if (f.type === 'file') return Number(f.fileCount) > 0 || Boolean(String(f.fileChip || '').trim());
  if (f.type === 'checkbox' || f.role === 'checkbox' || f.role === 'switch') return Boolean(f.checked);
  if (f.type === 'radio') return Boolean(f.groupChecked || f.checked);
  return !looksLikeEmptyChoice(f.value);
}

function digitsOf(value) {
  return String(value || '').replace(/\D/g, '');
}

function urlsEquivalent(left, right) {
  const norm = (raw) => {
    const s = String(raw || '').trim();
    if (!s) return '';
    try {
      const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
      return `${u.hostname.replace(/^www\./i, '').toLowerCase()}${u.pathname.replace(/\/$/, '').toLowerCase()}`;
    } catch {
      return s.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '').toLowerCase();
    }
  };
  const a = norm(left);
  const b = norm(right);
  return Boolean(a && b && a === b);
}

function filledValuesEquivalent(cur, want, f) {
  if (!cur || !want) return false;
  if (cur === want) return true;
  if (cur.toLowerCase() === want.toLowerCase()) return true;
  if (cur.replace(/\s+/g, '') === want.replace(/\s+/g, '')) return true;
  if (looksLikeSalaryField(`${f?.label || ''} ${f?.name || ''}`)) {
    // The same amount, however the ATS formats it back ("45,000.00",
    // "45 000 €" for 45000): comparing raw digits re-typed it every pass.
    const [a] = numbersInText(cur);
    const [b] = numbersInText(want);
    if (a && b) return a === b;
    const da = digitsOf(cur);
    return da.length >= 4 && da === digitsOf(want);
  }
  if (looksLikePhoneNumberField(f) || looksLikeDialCodeField(f)) {
    const a = digitsOf(cur);
    const b = digitsOf(want);
    if (a.length < 6) return false;
    const curPlus = cur.startsWith('+');
    const wantPlus = want.startsWith('+');
    // Both international: the same number, country code included.
    if (curPlus && wantPlus) return a === b;
    // The widget put a "+" in front of a national entry: it must have added a
    // country code, not read the first digits as one ("+695659131").
    if (curPlus) {
      const national = b.replace(/^0+/, '');
      const extra = a.length - national.length;
      return a.endsWith(national) && extra >= 1 && extra <= 3;
    }
    const national = a.replace(/^0+/, '');
    return national.length >= 6 && (b.replace(/^0+/, '') === national || b.endsWith(national));
  }
  if (/https?:/i.test(cur) || /https?:/i.test(want) || /linkedin|github|portfolio|website/.test(fieldSearchText(f))) {
    return urlsEquivalent(cur, want);
  }
  return false;
}

// "Country", "Current country", "Country of residence", "Pays (de résidence)",
// "Land", "País": where the candidate lives. Not a passport, a dial code, a
// work-permit question or the job's country.
function isResidenceCountryField(f) {
  if (!f || f.type === 'checkbox' || f.type === 'radio' || f.type === 'file') return false;
  if (looksLikeDialCodeField(f) || looksLikePhoneNumberField(f)) return false;
  const label = normalizedFieldLabel(f).replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  if (/nationalit|citizenship|citoyennet|staatsangeh|passport|visa|sponsor|authori[sz]|permit|phone|t[ée]l[ée]phone|dial|calling|indicatif|birth|naissance|origin|hiring|job|position|role|vacanc|office|applying|relocat|willing/.test(label)) {
    return false;
  }
  return /^(your |current |home )?(country|pays|land|pa[ií]s|paese)( of residence| de r[ée]sidence| de residencia| di residenza| \/ region| or region)?$|^(wohnland|land \/ regio|country\/region)$|\b(which|what) country do you (live|reside)\b/.test(label);
}

export function shouldReplaceFilledValue(f, current, planned) {
  const cur = String(current || '').trim();
  const want = String(planned || '').trim();
  if (!want) return false;
  if (looksLikeEmptyChoice(cur)) return true;
  if (filledValuesEquivalent(cur, want, f)) return false;
  const s = fieldSearchText(f);
  if (isPlaceIdentityField(f)) {
    // A policy sentence, or two places joined by "or" ("Paris or Bangkok"):
    // never the one place the box asks for.
    const places = cur.split(/\s+(?:or|ou|oder|o)\s+/i).filter((part) => placesIn(part).countries.length);
    if (/depending on|full remote|remote\s*[·•]|location policy/i.test(cur) || places.length >= 2 || cur.length > 40) {
      return true;
    }
    const city = want.split(',')[0].trim().toLowerCase();
    return city ? !cur.toLowerCase().includes(city) : true;
  }
  // A residence country the site pre-filled ("United Kingdom" for a Paris
  // base) is replaced unless it already names the wanted country.
  if (isResidenceCountryField(f)) {
    return !(cur.toLowerCase().includes(want.toLowerCase()) || (countryOf(cur) && countryOf(cur) === countryOf(want)));
  }
  if (looksLikeSalaryField(`${f.label || ''} ${f.name || ''}`)) return true;
  if (isIdentityRepeatField(f)) return true;
  if (/e-?mail|courriel/.test(s) && /@/.test(want)) return cur.toLowerCase() !== want.toLowerCase();
  if (/linkedin|github|portfolio|website/.test(s) && /https?:/i.test(want)) return true;
  if (/^(your )?(first name|last name|given name|family name|surname|full name|legal name|pr[ée]nom|nom de famille|vorname|voornaam|phone|phone number|mobile|t[ée]l[ée]phone)$/.test(normalizedFieldLabel(f))) {
    return true;
  }
  if (isBareGivenNameLabel(f) || SURNAME_LABEL_RE.test(normalizedFieldLabel(f))) return true;
  // A country-code list shows "Thailand +66": it already holds "+66".
  if (looksLikeDialCodeField(f)) return !cur.includes(want);
  return false;
}
