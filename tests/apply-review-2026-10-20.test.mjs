import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyField, hearAboutCheckboxPlan } from '../lib/apply-classify.mjs';
import { dialAnswerCountry, labelIsOnlyPlaceholder, listTypeQuery } from '../lib/apply-fill-guards.mjs';

const identity = { fullName: 'Hugo Vermot', country: 'France', city: 'Paris', linkedin: 'https://linkedin.com/in/hugovermot' };
const spec = { identity, jobUrl: 'https://job-boards.greenhouse.io/inthepocket/jobs/123', answers: [] };
const box = (opt) => ({ type: 'checkbox', tag: 'input', label: `How did you hear about this job? * — ${opt}`, required: false });

test('hear-about checkbox group: the source box is ticked, referrals and the rest stay blank', () => {
  assert.deepEqual(classifyField(box('In The Pocket Website'), spec), { check: true });
  assert.equal(classifyField(box('In The Pocket Employee'), spec).check, undefined);
  assert.equal(classifyField(box('Facebook'), spec).check, undefined);
  assert.equal(classifyField(box('Other'), spec).check, undefined);
  const viaLinkedIn = { ...spec, jobUrl: 'https://www.linkedin.com/jobs/view/1' };
  assert.deepEqual(hearAboutCheckboxPlan(box('LinkedIn'), identity, viaLinkedIn.jobUrl), { check: true });
  assert.equal(hearAboutCheckboxPlan({ type: 'checkbox', label: 'I agree to the privacy policy' }, identity, spec.jobUrl), null);
});

test('"France +33" on a country list that is not a dial picker types and matches the country name', () => {
  assert.equal(dialAnswerCountry('France +33'), 'France');
  assert.equal(dialAnswerCountry('France (+33)'), 'France');
  assert.equal(dialAnswerCountry('+33 6 95 65 91 31'), '');
  assert.equal(dialAnswerCountry('Yes'), '');
  const f = { tag: 'div', role: 'combobox', type: 'text', label: 'My information', options: [{ text: 'International' }, { text: 'Afghanistan' }] };
  assert.equal(listTypeQuery(f, { value: 'France +33', selectText: 'France +33' }, identity), 'France');
});

test('a list whose only label is its placeholder and options is never answered blind', () => {
  assert.equal(labelIsOnlyPlaceholder({ label: 'Select... Yes No', options: [{ text: 'Yes' }, { text: 'No' }] }), true);
  assert.equal(labelIsOnlyPlaceholder({ label: 'Select... United Kingdom Spain', options: [{ text: 'United Kingdom' }, { text: 'Spain' }] }), true);
  assert.equal(labelIsOnlyPlaceholder({ label: 'Do you require visa sponsorship? Select...', options: [{ text: 'Yes' }, { text: 'No' }] }), false);
  assert.equal(labelIsOnlyPlaceholder({ label: 'Current location ✱' }), false);
});