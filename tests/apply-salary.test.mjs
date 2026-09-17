import test from 'node:test';
import assert from 'node:assert/strict';
import {
  annualSalaryForForm,
  dailyRateForForm,
  formSalaryValue,
  looksLikeDailyRateField,
  salaryNumberMatchScore,
} from '../lib/apply-salary.mjs';
import { pickMatchingOption } from '../lib/apply-option-match.mjs';

const PROFILE = {
  target_range: 'EUR70K-110K salary / EUR600-900/day freelance',
  minimum: 'EUR60K salary / EUR500/day',
};

test('annual form salary is the profile minimum as one integer', () => {
  assert.equal(annualSalaryForForm(PROFILE), 60000);
  assert.equal(formSalaryValue(PROFILE, 'Salary range'), '60000');
  assert.equal(formSalaryValue(PROFILE, 'Expected compensation'), '60000');
  assert.equal(formSalaryValue(PROFILE, 'Pay expectation'), '60000');
});

test('daily-rate fields use the /day figure, not the annual one', () => {
  assert.equal(looksLikeDailyRateField('Daily rate / TJM'), true);
  assert.equal(dailyRateForForm(PROFILE), 500);
  assert.equal(formSalaryValue(PROFILE, 'Daily rate'), '500');
});

test('does not concatenate a min-max range into one number', () => {
  const v = formSalaryValue(PROFILE, 'Salary range');
  assert.equal(v.includes('70'), false);
  assert.equal(v.includes('110'), false);
  assert.equal(v.includes('76000'), false);
  assert.equal(v, '60000');
});

test('falls back to the target-range floor when minimum is missing', () => {
  assert.equal(annualSalaryForForm({ target_range: 'EUR70K-110K salary' }), 70000);
});

test('salary dropdown picks the bucket that contains 60000', () => {
  assert.ok(salaryNumberMatchScore('60000', '€60,000 – €80,000') >= 50);
  const picked = pickMatchingOption([
    '€40,000 – €55,000',
    '€60,000 – €80,000',
    '€90,000 – €120,000',
  ], '60000');
  assert.equal(picked?.text, '€60,000 – €80,000');
});

test('LLM range string still matches the same salary bucket', () => {
  const picked = pickMatchingOption([
    'USD 40,000–55,000',
    'USD 76,000–119,000',
    'USD 120,000–150,000',
  ], 'USD 76,000–119,000');
  assert.equal(picked?.text, 'USD 76,000–119,000');
});
