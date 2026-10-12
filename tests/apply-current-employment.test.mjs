// tests/apply-current-employment.test.mjs — availability.current_employment
// (onboarding step 5) reaches the apply identity and the screening policy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIdentity, employmentStatusFrom } from '../lib/apply-spec.mjs';
import { policyPlan, policyPromptLines } from '../lib/apply-policy.mjs';
import { CURRENT_EMPLOYMENT_VALUES } from '../lib/profile-shape.mjs';

const OFFER = { offerLocation: { countries: ['Germany'], cities: [], remote: false } };
const profile = (current_employment, extra = {}) => ({
  candidate: { full_name: 'Test User', email: 't@example.com' },
  location: { authorized_in: ['France', 'European Union'], remote_policy: 'Full remote required' },
  availability: { ...(current_employment ? { current_employment } : {}), ...extra },
  search: { current_role: { title: 'Product Designer', company: 'Acme', start_year: 2022 } },
});
const yesNo = (label) => ({ label, type: 'radio', options: ['Yes', 'No'] });
const plan = (label, status) => policyPlan(yesNo(label), { ...OFFER, identity: buildIdentity(profile(status), 'europe') });

test('every onboarding choice maps to a status', () => {
  const expected = {
    'Employed, looking discreetly': 'employed-discreet',
    'Employed, actively looking': 'employed',
    Freelancing: 'freelancing',
    'Between jobs, available now': 'between-jobs',
    'Student / graduating': 'student',
  };
  assert.deepEqual(Object.keys(expected).sort(), [...CURRENT_EMPLOYMENT_VALUES].sort());
  for (const [value, status] of Object.entries(expected)) assert.equal(employmentStatusFrom(value), status, value);
  // Hand-written profile.yml text.
  assert.equal(employmentStatusFrom('Salaried at OneAsset'), 'employed');
  assert.equal(employmentStatusFrom(''), '');
  assert.equal(employmentStatusFrom('it depends'), '');
});

test('a profile without current_employment keeps the same identity', () => {
  const id = buildIdentity(profile(''), 'europe');
  assert.equal('currentEmployment' in id, false);
  assert.equal('employmentStatus' in id, false);
  assert.equal(id.noticePeriod, '1 week');
  assert.equal(id.startDate, 'After 1 week notice');
  assert.equal(id.employment.current, true);
  assert.equal(policyPromptLines(id, OFFER).includes('Current situation'), false);
  assert.equal(plan('May we contact your current employer?', ''), null);
  assert.equal(plan('Are you currently employed?', ''), null);
});

test('between jobs: no notice, available now, last role not current', () => {
  const id = buildIdentity(profile('Between jobs, available now'), 'europe');
  assert.equal(id.currentEmployment, 'Between jobs, available now');
  assert.equal(id.employmentStatus, 'between-jobs');
  assert.equal(id.noticePeriod, 'None, available now');
  assert.equal(id.startDate, 'Immediately');
  assert.equal(id.employment.current, false, '"I currently work here" stays unticked');
  assert.match(policyPromptLines(id, OFFER), /Current situation: between jobs, available now/);
  // What the profile states still wins.
  const stated = buildIdentity(profile('Between jobs, available now', { notice_period: '2 weeks', start_date: '2026-11-01' }), 'europe');
  assert.equal(stated.noticePeriod, '2 weeks');
  assert.equal(stated.startDate, '2026-11-01');
});

test('screening answers the status settles', () => {
  assert.equal(plan('May we contact your current employer?', 'Employed, looking discreetly').yesNo, 'no');
  assert.equal(plan('Can we contact your current employer for a reference?', 'Employed, looking discreetly').yesNo, 'no');
  assert.equal(plan('May we contact your current employer?', 'Employed, actively looking'), null, 'the resolver decides');
  assert.equal(plan('Are you currently employed?', 'Employed, actively looking').yesNo, 'yes');
  assert.equal(plan('Are you currently employed?', 'Employed, looking discreetly').yesNo, 'yes');
  assert.equal(plan('Are you currently employed?', 'Salaried at OneAsset').yesNo, 'yes');
  assert.equal(plan('Are you currently employed?', 'Between jobs, available now').yesNo, 'no');
  assert.equal(plan('Are you currently employed?', 'Student / graduating'), null);
  assert.equal(plan('Are you currently employed?', 'Freelancing'), null);
  // The former-employee check belongs to apply-fill-guards, not here.
  assert.equal(plan('Are you currently employed by Acme or any of its subsidiaries?', 'Employed, actively looking'), null);
  // A free-text box is not a yes/no ask.
  const box = { label: 'Please describe your current employment situation', type: 'textarea' };
  assert.equal(policyPlan(box, { ...OFFER, identity: buildIdentity(profile('Employed, looking discreetly'), 'europe') }), null);
});

test('the model sees the current situation in the policy block', () => {
  const discreet = buildIdentity(profile('Employed, looking discreetly'), 'europe');
  assert.match(policyPromptLines(discreet, OFFER), /searching discreetly.*"may we contact your current employer\?" is No/);
  const freelance = buildIdentity(profile('Freelancing'), 'europe');
  assert.match(policyPromptLines(freelance, OFFER), /freelancing \(self-employed\)/);
});
