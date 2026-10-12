// spend_tier → the model that writes evaluations in the web app.
//
// The onboarding (step 7, "Evaluation depth") saves spend_tier and promises it
// "picks the model that scores your offers". Only evaluations follow it:
// letters, form answers, apply and application emails stay on MODELS.QWEN.
//
// All three tiers stay in the Qwen family and on the same output contract
// (lib/prompt-budget.mjs EVAL_SYSTEM). OpenRouter prices on 2026-10-09, per
// million tokens in / out:
//
//   economy  qwen/qwen3.7-flash               $0.03 / $0.13  reasoning switched off
//   standard qwen/qwen3-30b-a3b-instruct-2507 $0.10 / $0.30  today's model, unchanged
//   premium  qwen/qwen3-235b-a22b-2507        $0.09 / $0.55  non-thinking instruct
//
// Premium is the 235B instruct, not the thinking variant: thinking tokens
// count against the 3 200-token report budget and would cut reports short.
// qwen3.7-flash thinks by default; `reasoning: { enabled: false }` turns that
// off (checked live on 2026-10-09: 0 reasoning tokens).

export const SPEND_TIERS = Object.freeze(['economy', 'standard', 'premium']);
export const DEFAULT_SPEND_TIER = 'standard';

/**
 * The tier a profile asks for. Absent or unknown → standard, the documented
 * default (modes/_shared.md "Spend Tier"), so an old profile keeps today's model.
 *
 * @param {unknown} value profile.spend_tier
 * @returns {{tier: string, source: 'configured'|'default'|'invalid'}}
 */
export function resolveSpendTier(value) {
  if (value === undefined || value === null || value === '') return { tier: DEFAULT_SPEND_TIER, source: 'default' };
  const tier = String(value).trim().toLowerCase();
  if (SPEND_TIERS.includes(tier)) return { tier, source: 'configured' };
  return { tier: DEFAULT_SPEND_TIER, source: 'invalid' };
}

/**
 * Model (and reasoning switch) for an evaluation at this tier. `reasoning` is
 * only set when the model needs it, so the standard request body is the one
 * the server sent before tiers existed.
 *
 * @param {unknown} value profile.spend_tier
 * @param {{QWEN: string, QWEN_FLASH: string, QWEN_235B: string}} models lib/openrouter.mjs MODELS
 * @returns {{tier: string, model: string, reasoning?: object}}
 */
export function evalModelForTier(value, models) {
  const { tier } = resolveSpendTier(value);
  if (tier === 'economy') return { tier, model: models.QWEN_FLASH, reasoning: { enabled: false } };
  if (tier === 'premium') return { tier, model: models.QWEN_235B };
  return { tier, model: models.QWEN };
}
