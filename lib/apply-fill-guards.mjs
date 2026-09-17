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

const MARKETING_EMAIL_RE = /newsletter|marketing|opt.?in|may we email|email you about|email updates|keep me (posted|updated)/i;
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
  return /^(your |work |personal |professional )?(first name|last name|given name|family name|surname|preferred name|full name|legal name|pr[ée]nom|nom de famille|nom|email|e-mail|email address|courriel|phone|phone number|mobile|mobile number|t[ée]l[ée]phone|linkedin|linkedin url|linkedin profile|github|twitter|website|portfolio|url)$/.test(label);
}

export function looksLikeTypeahead(f) {
  const label = normalizedFieldLabel(f);
  if (/how did you hear/.test(label)) return true;
  return /^(your |current |home |work )?(city|ville|country|pays|location|localisation|university|universit[eé]|school|école|college|coll[eè]ge)( of .+)?$/.test(label);
}

export function isComboboxField(f) {
  return f.role === 'combobox' || f.ariaAutocomplete === 'list'
    || f.ariaHaspopup === 'listbox' || (f.idAttr || '').includes('react-select')
    || !!f.nearSelectWrapper;
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
  if (f.type === 'email' && /e-?mail|courriel/.test(s)) return true;
  const label = normalizedFieldLabel(f);
  if (/^(your )?(first name|last name|given name|family name|surname|full name|legal name|pr[ée]nom|nom de famille)$/.test(label)) return true;
  if (f.type === 'tel' || /^(phone|phone number|mobile|mobile number|t[ée]l[ée]phone)$/.test(label)) return true;
  if (looksLikeDialCodeField(f)) return true;
  return false;
}

export function isResumeFileField(f) {
  if (!f || f.type !== 'file') return false;
  const s = fieldSearchText(f);
  if (/cover|lettre de motivation/.test(s) && !/resume|\bcv\b/.test(s)) return false;
  if (/reference|recommendation|transcript|diploma|other\b|additional file/.test(s) && !/resume|\bcv\b|autofill/.test(s)) return false;
  return /resume|\bcv\b|curriculum|autofill|\battach\b/.test(s) || /^file$/.test(normalizedFieldLabel(f));
}

// Optional visible questions stay blank. Only fill what submit will block on:
// required (incl. * / aria / "required" copy), core identity, resume.
export function shouldFillField(f) {
  if (!f) return false;
  if (fieldLooksRequired(f)) return true;
  if (isResumeFileField(f)) return true;
  if (isCoreApplicationIdentity(f)) return true;
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
