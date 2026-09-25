/**
 * Shared select/radio option picking for apply-runner and apply-bridge.
 */
import { pickMatchingOption } from './apply-option-match.mjs';
import { isComboboxField } from './apply-fill-guards.mjs';

// Every ATS demographic dropdown offers some non-disclosure option, but the
// exact wording is never standardized. Matching this pattern deterministically
// skips LLM paraphrase risk (see apply-runner fillDeclineDropdown comments).
export const DECLINE_RE = /prefer not|decline|not to disclose|don.?t wish|rather not (to )?(say|answer|disclose)|not to (answer|say|respond|specify)|choose not to|no,? i (do not|don.t)|would rather not|not (to )?(self.?identify|specify)/i;

export function pickDeclineOption(options) {
  const usable = (options || []).filter(o => o.text && !/^(select|choose|--|please|sélection)/i.test(o.text.trim()));
  return usable.find(o => DECLINE_RE.test(o.text)) || null;
}

export function pickSelectOption(options, plan, fieldLabel) {
  const usable = (options || []).filter(o => o.text && !/^(select|choose|--|please|sélection)/i.test(o.text.trim()));
  if (plan?.yesNo) {
    const opt = pickMatchingOption(usable, plan.yesNo === 'yes' ? 'Yes' : 'No');
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
