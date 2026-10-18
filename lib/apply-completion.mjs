import { isResumeFileField, isApplicationGateConsent, fieldLooksRequired, isComboboxField, looksLikeEmptyChoice, shouldFillField } from './apply-fill-guards.mjs';
import { displayValue, hasShownValue, stableKey } from './apply-refill.mjs';
import { classifyField } from './apply-classify.mjs';

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
  if (/@/.test(blob) || /e-?mail/i.test(blob)) return true;
  // A signed-in board (Welcome to the Jungle) has no e-mail field: the
  // account carries it. A name with a CV or a phone is still an application,
  // where a CV alone could be any upload box.
  const named = filled.some(x => /\b(first|last|full|given|family|sur)?\s*name\b|pr[ée]nom|\bnom\b|nachname|vorname|nombre|apellido/i.test(String(x.label || '')) && String(x.value || '').trim());
  const cv = filled.some(x => /📎/.test(String(x.value || '')));
  const phone = filled.some(x => /phone|t[ée]l[ée]phone|mobile|telefon|tel[ée]fono/i.test(String(x.label || '')) && /\d{6,}/.test(String(x.value || '').replace(/\D/g, '')));
  return named && (cv || phone);
}

function choiceIsChecked(f) {
  return !!(f?.groupChecked || f?.checked);
}

// Re-read browser validity after filling: successful typing is not proof the
// ATS accepted an email, URL, pattern, date or required attachment.
export function fieldCompletionIssue(f, opts = {}) {
  // A file slot that shows its file (chip, FileList, or this run's upload) is
  // not missing one, whatever the native input's stale validity says: Welcome
  // to the Jungle kept "Please select a file." on an attached CV and every
  // run there stopped for a manual confirmation.
  if (f.type === 'file' && (fileSlotOccupied(f) || alreadyUploadedFile(f, opts.uploadedLabels))
      && (!f.validationMessage || /select a file|choose a file|s[ée]lectionn\w* un fichier|no file|please fill|required|requis|obligatoire/i.test(f.validationMessage))) {
    return null;
  }
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
  if (f.type === 'file' && !f.fileCount && !String(f.fileChip || '').trim() && (f.required || fieldLooksRequired(f) || isResumeFileField(f))) {
    if (alreadyUploadedFile(f, opts.uploadedLabels)) return null;
    return f.required || fieldLooksRequired(f) ? 'fichier requis manquant' : 'CV manquant';
  }
  if (f.invalid) return f.validationMessage || 'valeur invalide — vérifier le champ';
  // A list that still shows its prompt ("Bitte wählen", "Seleccione…") is
  // empty too; a text box is empty only when blank ("Please see my CV" is
  // an answer).
  const isList = f.tag === 'select' || isComboboxField(f);
  // A native select is judged by its option text: "Please select" stored
  // as value "0" is still the prompt.
  const empty = isList ? looksLikeEmptyChoice(displayValue(f)) : !String(f.value || '').trim();
  if ((f.required || fieldLooksRequired(f)) && f.type !== 'file' && empty) {
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
    if (!reason) return [];
    // Ranked fields (the bridge's collects) carry their key, so an issue on
    // one "Year" box is not read as an issue on the other.
    return [Number.isInteger(f?.ordinal) ? { label: fieldLabel(f), key: stableKey(f), reason } : { label: fieldLabel(f), reason }];
  });
}

// A row's identity: its field key (label + rank among same-label fields,
// lib/apply-refill.mjs stableKey) when the bridge set one, else its label.
// Two "Year" boxes are two rows; a filled one no longer hides the other.
const rowKey = (row) => row?.key || row?.label;

/** Filled rows of both lists, one per field, the later row winning. */
export function mergeFilled(a = [], b = []) {
  const byKey = new Map();
  for (const row of [...(a || []), ...(b || [])]) {
    // A label-only row (upload, live-DOM check) replaces the keyed row of
    // the same label instead of sitting next to it.
    const key = row?.key ? row.key : [...byKey.keys()].find((k) => byKey.get(k)?.label === row?.label) || rowKey(row);
    byKey.set(key, row);
  }
  return [...byKey.values()];
}

/** Pending rows of both lists, one per field, minus the fields now filled. */
export function mergePending(pending = [], extra = [], filled = []) {
  const filledKeys = new Set((filled || []).map(rowKey));
  const filledLabels = new Set((filled || []).map((f) => f.label));
  const seenKeys = new Set();
  const seenLabels = new Set();
  const out = [];
  for (const row of [...(pending || []), ...(extra || [])]) {
    if (!row?.label) continue;
    const key = rowKey(row);
    // Keyed rows match keyed rows; a label-only row (from the live-DOM
    // check) matches by label, so it neither duplicates nor is hidden by
    // the wrong field.
    const isFilled = row.key ? filledKeys.has(key) : filledLabels.has(row.label);
    const isSeen = row.key ? seenKeys.has(key) : seenLabels.has(row.label);
    if (isFilled || isSeen) continue;
    seenKeys.add(key);
    seenLabels.add(row.label);
    out.push(row);
  }
  return out;
}

/**
 * Empty fields on the page that are neither filled nor pending: judged
 * optional, left without an answer, or skipped by a guard. Nothing recorded
 * them, so an audit could not tell which boxes a run passed over (Restream on
 * Ashby: four required boxes, empty, in neither list). One row per label; the
 * reason is what the plan says now.
 */
export function skippedFields(fields = [], { filled = [], pending = [], spec = {} } = {}) {
  const seen = new Set([...filled, ...pending].flatMap((r) => [r?.key, r?.label]).filter(Boolean));
  const out = new Map();
  for (const f of fields || []) {
    const label = fieldLabel(f);
    if (out.has(label) || seen.has(label) || seen.has(stableKey(f)) || hasShownValue(f)) continue;
    let plan = null;
    try { plan = shouldFillField(f) ? classifyField(f, spec, new Set()) : null; } catch { /* audit only */ }
    out.set(label, {
      label,
      type: f.type || '',
      ...(f.tag ? { tag: f.tag } : {}),
      ...(f.role ? { role: f.role } : {}),
      required: fieldLooksRequired(f),
      reason: !shouldFillField(f) ? 'jugé optionnel' : plan?.skip || (plan ? 'réponse non écrite' : 'aucune réponse'),
    });
  }
  return [...out.values()];
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

// "Question — Option": how collect-fields labels one box of a checkbox group.
function groupStem(label) {
  const parts = String(label || '').split(/\s+[—–]\s+/);
  return parts.length >= 2 ? parts.slice(0, -1).join(' — ').trim() : '';
}

/**
 * Pending rows of a checkbox group, settled as one question: none once a box
 * of the group is ticked on the page, else a single row for the question.
 * Each box of a required group used to get its own "requis — sans réponse"
 * row, and the form stayed blocked after one box was ticked.
 */
export function settleCheckboxGroups(pending = [], fields = []) {
  const boxes = (fields || []).filter((f) => f && (f.type === 'checkbox' || f.role === 'checkbox'));
  const ticked = new Set();
  for (const f of boxes) {
    const stem = groupStem(fieldLabel(f)).toLowerCase();
    if (stem && (f.checked || f.groupChecked)) ticked.add(stem);
  }
  const boxLabels = new Set(boxes.map((f) => fieldLabel(f)));
  const out = [];
  const seen = new Set();
  for (const p of pending || []) {
    const stem = boxLabels.has(p.label) ? groupStem(p.label) : '';
    if (!stem) {
      out.push(p);
      continue;
    }
    const key = stem.toLowerCase();
    if (ticked.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({ ...p, label: stem, key: undefined, reason: /^requis/.test(String(p.reason || '')) ? 'requis — cocher au moins une option' : p.reason });
  }
  return out;
}
