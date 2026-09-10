// Pure helpers for apply-runner form filling. Kept free of Playwright so
// identity-vs-typeahead edge cases stay unit-testable.

const NEVER_COMBOBOX_TYPES = new Set([
  'email', 'tel', 'url', 'number', 'password',
  'date', 'datetime-local', 'month', 'week', 'time', 'color', 'range',
]);

export function normalizedFieldLabel(f) {
  return String(f.label || '').replace(/[*✱?]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// Native types + identity labels: never a Yes/No widget. Skip the click-and-wait
// probe so First name / Email / Phone go straight to humanType.
export function skipComboboxProbe(f) {
  if (NEVER_COMBOBOX_TYPES.has(String(f.type || '').toLowerCase())) return true;
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
