import test from 'node:test';
import assert from 'node:assert/strict';
import { choiceKind, optionMatchScore, pickMatchingOption } from '../lib/apply-option-match.mjs';

test('choiceKind recognizes yes/no literals only', () => {
  assert.equal(choiceKind('Yes'), 'yes');
  assert.equal(choiceKind('oui'), 'yes');
  assert.equal(choiceKind('No'), 'no');
  assert.equal(choiceKind('non'), 'no');
  assert.equal(choiceKind('France'), null);
  assert.equal(choiceKind('None of the above'), null);
});

test('No matches the long sponsorship option, not None / Non-binary', () => {
  const opts = [
    'None of the above',
    'Non-binary',
    "No, I don't require sponsorship",
    'Yes, I require sponsorship',
  ];
  const picked = pickMatchingOption(opts, 'No');
  assert.equal(picked?.text, "No, I don't require sponsorship");
  assert.ok(optionMatchScore('No', "No, I don't require sponsorship") >= 50);
  assert.equal(optionMatchScore('No', 'None of the above'), 0);
  assert.equal(optionMatchScore('No', 'Non-binary'), 0);
});

test('Yes matches the long authorized-to-work option', () => {
  const picked = pickMatchingOption([
    'No',
    'Yes, I am authorized to work in this country',
  ], 'Yes');
  assert.equal(picked?.text, 'Yes, I am authorized to work in this country');
});

test('country aliases: France ↔ French Republic, Thailand ↔ Thaïlande', () => {
  assert.equal(pickMatchingOption(['French Republic', 'Germany'], 'France')?.text, 'French Republic');
  assert.equal(pickMatchingOption(['France', 'Belgium'], 'French Republic')?.text, 'France');
  assert.equal(pickMatchingOption(['Thaïlande', 'France'], 'Thailand')?.text, 'Thaïlande');
  assert.equal(pickMatchingOption(['United States of America', 'United Kingdom'], 'USA')?.text, 'United States of America');
});

test('short country codes do not substring-match unrelated options', () => {
  assert.equal(pickMatchingOption(['Let us know', 'United States'], 'US')?.text, 'United States');
  assert.equal(pickMatchingOption(['From our team', 'France'], 'FR')?.text, 'France');
});

test('Male does not pick Female via substring', () => {
  assert.equal(pickMatchingOption(['Female', 'Prefer not to say'], 'Male'), null);
  assert.equal(pickMatchingOption(['Male', 'Female'], 'Male')?.text, 'Male');
});

test('pickMatchingOption keeps the original option object', () => {
  const opts = [
    { value: 'no_sponsor', text: "No, I don't require sponsorship" },
    { value: 'none', text: 'None of the above' },
  ];
  const picked = pickMatchingOption(opts, 'No');
  assert.equal(picked?.value, 'no_sponsor');
});

test('dial code +33 matches FR +33 in a country list', () => {
  const picked = pickMatchingOption(['US +1', 'FR +33', 'TH +66', 'DE +49'], '+33');
  assert.equal(picked?.text, 'FR +33');
});

test('month aliases: February ↔ Feb ↔ 2 ↔ 02', () => {
  assert.equal(pickMatchingOption(['January', 'February', 'March'], '2')?.text, 'February');
  assert.equal(pickMatchingOption(['January', 'February', 'March'], 'February')?.text, 'February');
  assert.equal(pickMatchingOption(['01', '02', '03'], 'February')?.text, '02');
  assert.equal(pickMatchingOption(['1', '2', '3'], 'February')?.text, '2');
  assert.equal(pickMatchingOption(['2024', '2025', '2026'], '2026')?.text, '2026');
  assert.equal(pickMatchingOption(['2024', '2025', '2026'], '2025')?.text, '2025');
});
