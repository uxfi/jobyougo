// tests/spend-tier.test.mjs — spend_tier picks the evaluation model (onboarding
// step 7 "Evaluation depth"); standard is today's model and request body.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SPEND_TIER, evalModelForTier, resolveSpendTier } from '../lib/spend-tier.mjs';
import { MODELS } from '../lib/openrouter.mjs';

test('absent, empty or unknown tiers are standard', () => {
  assert.equal(DEFAULT_SPEND_TIER, 'standard');
  assert.deepEqual(resolveSpendTier(undefined), { tier: 'standard', source: 'default' });
  assert.deepEqual(resolveSpendTier(''), { tier: 'standard', source: 'default' });
  assert.deepEqual(resolveSpendTier('turbo'), { tier: 'standard', source: 'invalid' });
  assert.deepEqual(resolveSpendTier(' Premium '), { tier: 'premium', source: 'configured' });
});

test('standard is today\'s Qwen 30B request, with no reasoning field', () => {
  for (const value of [undefined, '', 'standard', 'nonsense']) {
    const pick = evalModelForTier(value, MODELS);
    assert.equal(pick.model, MODELS.QWEN);
    assert.equal(pick.model, 'qwen/qwen3-30b-a3b-instruct-2507');
    assert.equal('reasoning' in pick, false, 'the stream body must not gain a reasoning key');
  }
});

test('economy and premium stay in the Qwen family', () => {
  const economy = evalModelForTier('economy', MODELS);
  assert.equal(economy.model, MODELS.QWEN_FLASH);
  assert.deepEqual(economy.reasoning, { enabled: false }, 'qwen3.7-flash thinks by default');
  const premium = evalModelForTier('premium', MODELS);
  assert.equal(premium.model, MODELS.QWEN_235B);
  assert.equal('reasoning' in premium, false, 'non-thinking instruct: no reasoning tokens eat the report budget');
  for (const pick of [economy, premium]) assert.match(pick.model, /^qwen\//);
  assert.notEqual(economy.model, MODELS.QWEN);
  assert.notEqual(premium.model, MODELS.QWEN);
});
