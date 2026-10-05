import { isResumeFileField, isApplicationGateConsent, fieldLooksRequired } from './apply-fill-guards.mjs';

function labelsOverlap(a, b) {
  const na = String(a || '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 48);
  const nb = String(b || '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 48);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

export function alreadyUploadedFile(f, uploadedLabels = []) {
  if (!uploadedLabels.length) return false;
  const key = `${f.label || ''} ${f.name || ''}`;
  return uploadedLabels.some(l => labelsOverlap(key, l));
}

/** True when the DOM already shows a file (FileList or filename chip). */
export function fileSlotOccupied(f) {
  if (!f || f.type !== 'file') return false;
  return Number(f.fileCount) > 0 || !!String(f.fileChip || '').trim();
}

/**
 * Whether Phase A should setInputFiles on this slot.
 * Skip when the DOM already has a file, when a prior pass recorded this label,
 * or when a resume/CV was already attached this run (Ashby often re-exposes a
 * second input with a different label after the first upload).
 */
export function shouldUploadFileField(f, { uploadedLabels = [], resumeAlreadyUploaded = false } = {}) {
  if (!f || f.type !== 'file') return false;
  if (fileSlotOccupied(f)) return false;
  if (alreadyUploadedFile(f, uploadedLabels)) return false;
  if (resumeAlreadyUploaded && isResumeFileField(f)) return false;
  return true;
}

export function looksReadyToSubmit({ filled = [], pending = [], applyEntryVisible = false } = {}) {
  if (pending.length) return false;
  if (applyEntryVisible) return false;
  const blob = filled.map(x => `${x.label} ${x.value}`).join('\n');
  return /@/.test(blob) || /e-?mail/i.test(blob);
}

function choiceIsChecked(f) {
  return !!(f?.groupChecked || f?.checked);
}

// Re-read browser validity after filling: successful typing is not proof the
// ATS accepted an email, URL, pattern, date or required attachment.
export function fieldCompletionIssue(f, opts = {}) {
  // Explicit ATS rejection wins even when a radio/checkbox is selected.
  if (f.ariaInvalid) return f.validationMessage || 'valeur invalide — vérifier le champ';
  if (f.type === 'radio' || f.type === 'checkbox') {
    // Application-gate consents / "Required." labels often omit HTML required
    // yet still block Submit (AssessFirst Live Privacy Policy checkbox).
    const mustChoose = f.required || fieldLooksRequired(f) || isApplicationGateConsent(f);
    if (mustChoose && !choiceIsChecked(f)) return 'choix requis non renseigné';
    return f.invalid && !choiceIsChecked(f) ? (f.validationMessage || 'choix invalide') : null;
  }
  // Resume slots must get a file even when the ATS omits HTML `required`
  // (common on SmartRecruiters / Greenhouse dropzones).
  // FileList is often cleared once the ATS shows a filename chip.
  if (f.type === 'file' && !f.fileCount && !String(f.fileChip || '').trim() && (f.required || isResumeFileField(f))) {
    if (alreadyUploadedFile(f, opts.uploadedLabels)) return null;
    return f.required ? 'fichier requis manquant' : 'CV manquant';
  }
  if (f.invalid) return f.validationMessage || 'valeur invalide — vérifier le champ';
  if ((f.required || fieldLooksRequired(f)) && f.type !== 'file' && !String(f.value || '').trim()) {
    return 'requis et vide';
  }
  return null;
}

// ── Filled / pending bookkeeping, shared by apply-runner and the plugin bridge ──

/** The label a field is reported under in `filled` and `pending`. */
export function fieldLabel(f) {
  return String(f?.label || f?.name || f?.type || `field#${f?.i}`).slice(0, 80);
}

/** Labels of the filled rows that record an attached file (📎). */
export function attachedLabels(filled = []) {
  return (filled || []).filter((x) => String(x?.value || '').includes('📎')).map((x) => x.label);
}

/** Live-DOM check: the fields the ATS still treats as empty or invalid. */
export function completionIssues(fields = [], uploadedLabels = []) {
  return (fields || []).flatMap((f) => {
    const reason = fieldCompletionIssue(f, { uploadedLabels });
    return reason ? [{ label: fieldLabel(f), reason }] : [];
  });
}

/** Filled rows of both lists, one per label, the later row winning. */
export function mergeFilled(a = [], b = []) {
  const byLabel = new Map();
  for (const row of [...(a || []), ...(b || [])]) byLabel.set(row.label, row);
  return [...byLabel.values()];
}

/** Pending rows of both lists, one per label, minus the labels now filled. */
export function mergePending(pending = [], extra = [], filled = []) {
  const filledLabels = new Set((filled || []).map((f) => f.label));
  const seen = new Set();
  const out = [];
  for (const row of [...(pending || []), ...(extra || [])]) {
    if (!row?.label || filledLabels.has(row.label) || seen.has(row.label)) continue;
    seen.add(row.label);
    out.push(row);
  }
  return out;
}

// fieldType: pass f.type from the collected field descriptor. 'tel' compares
// digits only \u2014 masked phone widgets (e.g. react-international-phone) accept
// a fill() and keep every digit, but reformat spacing on commit ("+66 62 784
// 2137" -> "+66 627842137"), so the byte-exact check below reports a false
// mismatch on a fill that actually landed. That false negative sends the
// caller into a keystroke-typing fallback the widget doesn't honor either,
// clearing a field that was already correctly filled \u2014 visible to a user
// watching the browser as the phone field filling and emptying itself on
// every retry, never actually landing.
export async function fieldMatchesAnswer(locator, expected, fieldType) {
  try {
    let actual = await locator.inputValue({ timeout: 600 }).catch(() => null);
    if (actual === null) actual = await locator.evaluate(el => el.innerText ?? el.textContent ?? '');
    if (fieldType === 'tel') {
      const digits = value => String(value).replace(/\D/g, '');
      const a = digits(actual);
      return a.length > 0 && a === digits(expected);
    }
    const normalize = value => String(value).replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').trim();
    return normalize(actual) === normalize(expected);
  } catch { return false; }
}
