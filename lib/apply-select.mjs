/**
 * Shared select/radio option picking for apply-runner and apply-bridge.
 */
import { pickMatchingOption } from './apply-option-match.mjs';
import { isComboboxField } from './apply-fill-guards.mjs';

// Every ATS demographic dropdown (gender, race/ethnicity, veteran, disability,
// LGBTQIA+…) offers some non-disclosure option, but the exact wording is never
// standardized ("Prefer not to say", "I don't wish to answer", "Decline to
// self-identify"…). A model asked to pick one paraphrases it instead ("Prefer
// not to disclose" when the option read "I don't wish to answer", live on
// Agoda/Greenhouse), and the paraphrase then matches nothing. Matching this
// pattern against the real options skips that risk, and a model call.
export const DECLINE_RE = /prefer not|decline|not to disclose|don.?t wish|rather not (to )?(say|answer|disclose)|not to (answer|say|respond|specify)|choose not to|no,? i (do not|don.t)|would rather not|not (to )?(self.?identify|specify)/i;

export function pickDeclineOption(options) {
  const usable = (options || []).filter(o => o.text && !/^(select|choose|--|please|sélection)/i.test(o.text.trim()));
  return usable.find(o => DECLINE_RE.test(o.text)) || null;
}

// "Less than 3 years" / "3-5 years" / "8+ years" / "10 or more" → [low, high].
function yearsRange(text) {
  const t = String(text || '').toLowerCase();
  let m = t.match(/(\d+)\s*\+|(\d+)\s*(?:or more|and above|and more|or above|plus|ou plus|et plus)/);
  if (m) return [Number(m[1] ?? m[2]), Infinity];
  m = t.match(/(?:less than|under|fewer than|moins de|<)\s*(\d+)/);
  if (m) return [0, Number(m[1]) - 0.5];
  m = t.match(/(?:more than|over|plus de|>)\s*(\d+)/);
  if (m) return [Number(m[1]) + 0.5, Infinity];
  m = t.match(/(\d+)\s*(?:-|–|—|to|à)\s*(\d+)/);
  if (m) return [Number(m[1]), Number(m[2])];
  m = t.match(/^\D*(\d+)\D*$/);
  if (m) return [Number(m[1]), Number(m[1])];
  return null;
}

// The experience bracket holding `years`. On a shared edge ("5-8" and "8+"
// for 8) the bracket that starts at the value wins: the first regex hit took
// "5-8 years" on Teamtailor.
export function pickYearsOption(options, years) {
  const n = Number(years);
  if (!Number.isFinite(n)) return null;
  let best = null;
  let bestLow = -Infinity;
  for (const o of options || []) {
    const r = yearsRange(o?.text);
    if (!r || n < r[0] || n > r[1]) continue;
    if (r[0] > bestLow) {
      bestLow = r[0];
      best = o;
    }
  }
  return best;
}

/** The literal a yes/no plan answers with ('' when the plan is not yes/no). */
export function yesNoText(plan) {
  return plan?.yesNo === 'yes' ? 'Yes' : plan?.yesNo === 'no' ? 'No' : '';
}

export function pickSelectOption(options, plan, fieldLabel) {
  const usable = (options || []).filter(o => o.text && !/^(select|choose|--|please|sélection)/i.test(o.text.trim()));
  if (yesNoText(plan)) {
    const opt = pickMatchingOption(usable, yesNoText(plan));
    if (opt) return opt;
  }
  if (plan?.years != null) {
    const opt = pickYearsOption(usable, plan.years);
    if (opt) return opt;
  }
  if (plan?.selectPrefer) {
    const opt = usable.find(o => plan.selectPrefer.test(o.text));
    if (opt) return opt;
  }
  for (const needle of [plan?.selectMatch, plan?.selectText, plan?.value].filter(Boolean)) {
    const opt = pickMatchingOption(usable, needle);
    if (opt) return opt;
  }
  if (plan?.declinePreferred) {
    const decline = pickDeclineOption(usable);
    if (decline) return decline;
  }
  if (usable.length === 1) return usable[0];
  return null;
}

export function llmKind(f) {
  if (f.tag === 'select' || isComboboxField(f)) return 'dropdown';
  if (f.type === 'radio') return 'choice';
  if (f.type === 'textarea') return 'long text';
  return 'short text';
}
