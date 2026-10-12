// One application run should write each field once. The bridge runs several
// passes per page (deterministic plan, resolver, recon, Relance auto, ATS
// error fix, before-send fix); without shared bookkeeping each pass re-opened
// lists, asked the model again and retyped answers that had already landed.
// This module holds that bookkeeping. It is pure: the bridge calls it.

import { pickSelectOption, yesNoText } from './apply-select.mjs';
import { choiceKind } from './apply-option-match.mjs';
import { numbersInText } from './apply-salary.mjs';
import { isComboboxField, looksLikeEmptyChoice } from './apply-fill-guards.mjs';

/** One control on the page: frame + collect index (data-co-i restarts per frame). */
export const slotKey = (x) => `${x?.frameId ?? 0}:${x?.i}`;

/** Same field across re-collects, by frame + label (the index can move on a remount). */
export const fieldKey = (f) => `${f?.frameId ?? 0}:${String(f?.label || f?.name || '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 80)}`;

/**
 * Number the fields that share a label (a "Year" box in each experience
 * block, two "If yes, please specify"). Collect order is DOM order, so the
 * nth "Year" stays the nth "Year" across re-collects, where the index may not.
 */
export function withOrdinals(fields = []) {
  const list = fields || [];
  const total = new Map();
  for (const f of list) total.set(fieldKey(f), (total.get(fieldKey(f)) || 0) + 1);
  const seen = new Map();
  return list.map((f) => {
    const key = fieldKey(f);
    const ordinal = seen.get(key) || 0;
    seen.set(key, ordinal + 1);
    // `siblings` is part of the key: when a conditional field with the same
    // label appears above, every rank of that label shifts, and the memory of
    // the old ranks must not land on the new field.
    const siblings = total.get(key);
    return f && f.ordinal === ordinal && f.siblings === siblings ? f : { ...f, ordinal, siblings };
  });
}

const isRanked = (f) => Number.isInteger(f?.ordinal) && Number.isInteger(f?.siblings);

/**
 * Keep ranks computed on the whole page. A fresh, unranked collect is
 * ranked; a stray entry without a rank (a synthetic row) gets a slot-based
 * key of its own instead of re-ranking the others among a subset.
 */
export function ensureOrdinals(fields = []) {
  const list = fields || [];
  if (!list.some(isRanked)) return withOrdinals(list);
  return list.map((f) => (isRanked(f) ? f : { ...f, ordinal: `@${slotKey(f)}`, siblings: 0 }));
}

/** Label + rank among same-label fields: the key the run memory uses. */
export const stableKey = (f) => `${fieldKey(f)}#${f?.ordinal ?? 0}/${f?.siblings ?? 1}`;

/**
 * Map fields from an earlier collect onto a fresh one. By stable key first
 * (survives index changes); by slot only when that slot still carries the
 * same label. A field with no live match is returned as it was.
 */
export function rematchFields(stale = [], fresh = []) {
  const live = ensureOrdinals(fresh);
  const byStable = new Map(live.map((f) => [stableKey(f), f]));
  const bySlot = new Map(live.map((f) => [slotKey(f), f]));
  return ensureOrdinals(stale).map((f) => {
    const hit = byStable.get(stableKey(f));
    if (hit) return hit;
    const slot = bySlot.get(slotKey(f));
    return slot && fieldKey(slot) === fieldKey(f) ? slot : f;
  });
}

const isNativeSelect = (f) => String(f?.tag || '').toLowerCase() === 'select';
const isListLike = (f) => isNativeSelect(f) || isComboboxField(f);
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * The text a field shows. Collect stores a native select's option VALUE
 * ("TH", "3", a uuid); every rule compares option TEXT, so a correct pick
 * read as "different" and was re-selected on every pass.
 */
export function displayValue(f) {
  const raw = String(f?.value ?? '').trim();
  if (isNativeSelect(f) && raw && Array.isArray(f.options)) {
    const hit = f.options.find((o) => String(o?.value ?? '').trim() === raw);
    if (hit?.text) return String(hit.text).trim();
  }
  return raw;
}

/**
 * The options known for a list: the collected ones, else those the run
 * already saw (a closed react-select is collected without options).
 */
function optionsOf(f, known = null) {
  const own = (f?.options || []).filter((o) => o?.text);
  if (own.length) return own;
  return (known || []).map((o) => (typeof o === 'string' ? { value: o, text: o } : o)).filter((o) => o?.text);
}

// "Yes" / "Yes, I am" / "Sí" read as yes; "No, I do not" as no.
function shownYesNo(text) {
  const kind = choiceKind(text);
  if (kind) return kind;
  const t = norm(text);
  if (/^(yes|oui|s[ií]|ja|sim)(?![a-zà-ÿ])/.test(t)) return 'yes';
  if (/^(no|non|nein|n[aã]o)(?![a-zà-ÿ])/.test(t)) return 'no';
  return null;
}

/**
 * A list already shows the answer the plan wants: the shown option is the
 * one the option matcher would pick for `want` (or equals it). With no
 * `want`, any real (non-placeholder) option counts as answered.
 */
export function listShowsAnswer(f, want = '', plan = null, knownOptions = null) {
  if (!isListLike(f)) return false;
  const shown = displayValue(f);
  if (!shown || looksLikeEmptyChoice(shown)) return false;
  const wanted = Array.isArray(want) ? want.map(String).filter(Boolean) : [String(want || '').trim()].filter(Boolean);
  if (!wanted.length) return true;
  const shownParts = shown.split(/\s*,\s*/).map(norm);
  const options = optionsOf(f, knownOptions);
  if (plan?.yesNo && wanted.length === 1 && !options.length) return shownYesNo(shown) === plan.yesNo;
  return wanted.every((w) => {
    if (norm(w) === norm(shown) || shownParts.includes(norm(w))) return true;
    if (!options.length) return false;
    const picked = pickSelectOption(options, plan && wanted.length === 1 ? plan : { selectText: w, value: w }, f.label);
    return Boolean(picked?.text) && (norm(picked.text) === norm(shown) || shownParts.includes(norm(picked.text)));
  });
}

/**
 * A list shows a real option, but the plan maps to a different option of
 * the same list. An ATS default (a geo-guessed country, a pre-selected
 * "Yes") is then replaced instead of kept as "already answered". Options
 * come from the field or from what the run already saw; with none, only a
 * shown Yes/No that contradicts a Yes/No plan is known to be wrong.
 */
export function listNeedsChange(f, want = '', plan = null, knownOptions = null) {
  if (!isListLike(f)) return false;
  const shown = displayValue(f);
  if (!shown || looksLikeEmptyChoice(shown)) return false;
  const w = String(want || '').trim();
  if (!w && !plan) return false;
  const options = optionsOf(f, knownOptions);
  if (!options.length) {
    const kind = plan?.yesNo ? shownYesNo(shown) : null;
    return Boolean(kind) && kind !== plan.yesNo;
  }
  const picked = pickSelectOption(options, plan || { selectText: w, value: w }, f.label);
  if (!picked?.text) return false;
  const shownParts = shown.split(/\s*,\s*/).map(norm);
  return norm(picked.text) !== norm(shown) && !shownParts.includes(norm(picked.text));
}

/** The field shows a real value (a native select by its option text). */
export function hasShownValue(f) {
  if (!f) return false;
  if (f.type === 'checkbox' || f.role === 'checkbox' || f.role === 'switch') return Boolean(f.checked);
  if (f.type === 'radio') return Boolean(f.groupChecked || f.checked);
  if (f.type === 'file') return Number(f.fileCount) > 0 || Boolean(String(f.fileChip || '').trim());
  return !looksLikeEmptyChoice(displayValue(f));
}

/**
 * After a fill whose reply never came, the page is read back. A value
 * counts as landed only when it answers what was sent: a placeholder, text
 * left in a list's filter box or an older value is not a success.
 */
export function readBackMatches(f, update = {}) {
  const shown = displayValue(f);
  if (!shown || looksLikeEmptyChoice(shown)) return false;
  const many = Array.isArray(update.selectMany) ? update.selectMany.map(String).filter(Boolean) : [];
  const want = String(update.selectText || update.value || '').trim();
  if (isListLike(f)) {
    if (listShowsAnswer(f, many.length ? many : want)) return true;
    // No options to match against: "Yes" sent, "Yes, I am authorized" shown.
    const b = norm(want);
    return !many.length && b.length >= 2 && new RegExp(`^${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-zà-ÿ0-9])`).test(norm(shown));
  }
  if (!want) return true;
  const a = norm(shown);
  const b = norm(want);
  // Equal, or cut by a maxLength the form enforced.
  if (a === b || (a.length >= 6 && b.startsWith(a))) return true;
  // The same amount reformatted ("45,000" for 45000).
  const [na] = numbersInText(shown);
  const [nb] = numbersInText(want);
  if (na && nb && na === nb) return true;
  // Digits only compare when BOTH sides are numbers (a phone): a name sent
  // and a number shown must not match through an empty digit string.
  const da = shown.replace(/\D/g, '');
  const db = want.replace(/\D/g, '');
  if (da.length < 6 || db.length < 6) return false;
  const ta = da.replace(/^0+/, '');
  const tb = db.replace(/^0+/, '');
  return da === db || (tb.length >= 6 && da.endsWith(tb)) || (ta.length >= 6 && db.endsWith(ta));
}

/** The text a plan wants a field to show ('' when the plan has no literal). */
export function planWant(plan) {
  return String(plan?.value || plan?.selectText || yesNoText(plan) || '').trim();
}

/**
 * Per-run memory shared by every pass. `options` saves re-opening a list
 * just to read it, `answers` keeps the resolver consistent (temperature > 0
 * gave "No" then "Yes" to one question), `attempts` stops the retry loop.
 */
export function createRunMemory() {
  // `contradicted`: lists whose shown value the plan contradicts (an ATS
  // default), keyed to that value, kept across passes so a failed
  // replacement is never settled as "filled" — while a replacement that
  // landed late (the list now shows something else) is not flagged.
  return { options: new Map(), answers: new Map(), attempts: new Map(), contradicted: new Map() };
}

/** The field still shows the value the plan contradicted earlier on this step. */
export function stillContradicted(memory, f) {
  const was = memory?.contradicted?.get(stableKey(f));
  return was != null && norm(was) === norm(displayValue(f));
}

export function rememberOptions(memory, f, options) {
  if (!memory || !Array.isArray(options) || !options.length) return;
  memory.options.set(stableKey(f), options);
}

export function knownOptions(memory, f) {
  return memory?.options.get(stableKey(f)) || null;
}

export function rememberAnswer(memory, f, answer) {
  if (!memory || answer == null || answer === '') return;
  memory.answers.set(stableKey(f), answer);
}

export function knownAnswer(memory, f) {
  return memory?.answers.get(stableKey(f)) ?? null;
}

/** Drop an answer the form proved wrong (the option does not exist). */
export function forgetAnswer(memory, f) {
  memory?.answers.delete(stableKey(f));
}

/** Count a failed write; returns the number of failures so far. */
export function noteFailedAttempt(memory, f) {
  if (!memory) return 1;
  const key = stableKey(f);
  const n = (memory.attempts.get(key) || 0) + 1;
  memory.attempts.set(key, n);
  return n;
}

export function failedAttempts(memory, f) {
  return memory?.attempts.get(stableKey(f)) || 0;
}

/** After this many failed writes a field is left to the user, not retried. */
export const MAX_FIELD_ATTEMPTS = 2;

/**
 * Fields a "Relance auto" should touch: the ones whose pending reason is
 * retryable and that still show no committed value. Matching is by label
 * (pending rows carry the label); a same-label field that already holds a
 * value is not retried.
 */
export function retryTargets(pending = [], liveFields = [], { retryable = () => false, hasValue = () => false } = {}) {
  const rows = (pending || []).filter((p) => retryable(String(p?.reason || '')));
  if (!rows.length) return [];
  const labelOf = (f) => String(f?.label || f?.name || f?.type || `field#${f?.i}`).slice(0, 80);
  // A keyed row names its field exactly; a label-only row (uploads, older
  // rows) matches every field of that label.
  const live = ensureOrdinals(liveFields || []);
  const liveKeys = new Set(live.map(stableKey));
  // A keyed row whose key no longer exists (a same-label field appeared and
  // the ranks moved) falls back to its label.
  const keys = new Set(rows.filter((p) => p.key && liveKeys.has(p.key)).map((p) => p.key));
  const labels = new Set(rows.filter((p) => !p.key || !liveKeys.has(p.key)).map((p) => p.label));
  return live.filter((f) => (keys.has(stableKey(f)) || labels.has(labelOf(f))) && !hasValue(f));
}

/**
 * Recon re-checks profile text the ATS may have autofilled wrong. It must
 * not touch what this pass just wrote, lists (Phase B owns them), or fields
 * outside the caller's scope (a targeted fix used to retype the whole form).
 */
export function reconCandidates(fields = [], { written = new Set(), scope = null } = {}) {
  return ensureOrdinals(fields).filter((f) => {
    if (!f || f.type === 'file' || f.type === 'checkbox' || f.type === 'radio') return false;
    if (isListLike(f)) return false;
    if (written.has(stableKey(f))) return false;
    if (scope && !scope.has(stableKey(f))) return false;
    return true;
  });
}
