import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyField } from '../lib/apply-classify.mjs';
import { shouldFillField, skipComboboxProbe, screeningChoicePlan } from '../lib/apply-fill-guards.mjs';

const id = {
  fullName: 'Hugo Vermot',
  firstName: 'Hugo',
  lastName: 'Vermot',
  email: 'chilka.v@gmail.com',
  phone: '+33 6 95 65 91 31',
  city: 'Paris',
  country: 'France',
  location: 'Paris, France',
  timezone: 'CET/CEST',
  linkedin: 'https://linkedin.com/in/hugovermot',
  portfolio: 'https://jobyougo.xyz/portfolio',
  github: 'github.com/uxfi',
  twitter: 'https://x.com/Chilka_',
  noticePeriod: '1 week',
  howDidYouHear: 'Other',
  needsSponsorship: false,
  visaStatus: 'No sponsorship needed',
  employment: {
    company: 'OneAsset',
    title: 'Senior Product Designer / Product Lead',
    startMonth: 2,
    startYear: '2026',
    current: true,
  },
};
const spec = { identity: id, company: 'Otera', region: 'europe', answers: [] };

function f(label, extra = {}) {
  return { type: 'text', label, name: '', idAttr: '', required: false, ...extra };
}

test('combined / full name boxes get Hugo Vermot; split names stay split', () => {
  assert.equal(classifyField(f('First and last name'), spec)?.value, 'Hugo Vermot');
  assert.equal(classifyField(f('First & Last Name *'), spec)?.value, 'Hugo Vermot');
  assert.equal(classifyField(f('First Name / Last Name'), spec)?.value, 'Hugo Vermot');
  assert.equal(classifyField(f('Name'), spec)?.value, 'Hugo Vermot');
  assert.equal(classifyField(f('Name *'), spec)?.value, 'Hugo Vermot');
  assert.equal(classifyField(f('What is your name?'), spec)?.value, 'Hugo Vermot');
  assert.equal(classifyField(f('First name'), spec)?.value, 'Hugo');
  assert.equal(classifyField(f('Last name'), spec)?.value, 'Vermot');
  assert.equal(classifyField(f('', { name: '_systemfield_name' }), spec)?.value, 'Hugo Vermot');
  assert.equal(shouldFillField(f('First and last name')), true);
  assert.equal(skipComboboxProbe(f('First and last name')), true);
});

test('third-party / company / file name slots are not the candidate name', () => {
  assert.notEqual(classifyField(f('Company name'), spec)?.value, 'Hugo Vermot');
  assert.equal(classifyField(f('Company name'), spec)?.value, 'OneAsset');
  assert.equal(classifyField(f('Hiring manager name'), spec)?.value, undefined);
  assert.equal(classifyField(f('Emergency contact name'), spec)?.value, undefined);
  assert.equal(classifyField(f('User name'), spec)?.value, undefined);
  assert.equal(classifyField(f('File name'), spec)?.value, undefined);
  assert.equal(classifyField(f('School name'), spec)?.value, undefined);
});

test('middle name left blank; preferred / display name uses first name', () => {
  const mid = classifyField(f('Middle name'), spec);
  assert.equal(mid?.leaveBlank, true);
  assert.equal(classifyField(f('Preferred name'), spec)?.value, 'Hugo');
  assert.equal(classifyField(f('Display name'), spec)?.value, 'Hugo');
});

test('marketing emails never get the application email', () => {
  assert.equal(classifyField(f('Email updates / newsletter', { type: 'email' }), spec)?.leaveBlank, true);
  assert.equal(classifyField(f('May we email you about future roles?'), spec)?.leaveBlank, true);
  assert.equal(shouldFillField(f('Email updates / newsletter', { type: 'email' })), false);
  assert.equal(classifyField(f('Email'), spec)?.value, 'chilka.v@gmail.com');
  assert.equal(shouldFillField(f('Confirm email')), false);
  assert.equal(shouldFillField(f('Confirm email', { required: true })), true);
});

test('AssessFirst-style privacy gate consent is checked without HTML required', () => {
  const privacy = f('Required. By submitting this application, I agree that I have read the Privacy Policy', { type: 'checkbox' });
  assert.equal(classifyField(privacy, spec)?.check, true);
  assert.equal(shouldFillField(privacy), true);
});

test('visa / sponsorship / agentic radios stay deterministic Yes/No', () => {
  const visa = classifyField(f('Do you need visa support in the country you are based?', { type: 'radio', required: true }), spec);
  assert.equal(visa?.yesNo, 'no');
  assert.equal(visa?.selectText, 'No');
  const auth = classifyField(f('Are you authorized to work without sponsorship?', { type: 'radio', required: true }), spec);
  assert.equal(auth?.yesNo, 'yes');
  assert.equal(auth?.selectText, 'Yes');
  assert.equal(
    screeningChoicePlan(f('Do you have experience working with Agentic AI Products/ Systems? *'))?.yesNo,
    'yes',
  );
  assert.equal(
    classifyField(f('Do you have experience working with Agentic AI Products/ Systems?', { type: 'radio', required: true }), spec)?.yesNo,
    'yes',
  );
});

test('relocation / capacity do not steal city or location answers', () => {
  assert.equal(classifyField(f('This role requires relocation to Doha', { type: 'radio' }), spec)?.yesNo, 'no');
  assert.equal(classifyField(f('Capacity planning notes'), spec), null);
  assert.equal(shouldFillField(f('Capacity planning notes')), false);
  assert.equal(classifyField(f('City'), spec)?.value, 'Paris');
});

test('twitter / password / additional portfolio stay distinct', () => {
  assert.equal(classifyField(f('Twitter URL'), spec)?.value, 'https://x.com/Chilka_');
  assert.match(classifyField(f('Password to portfolio link', { type: 'password' }), spec)?.skip || '', /mot de passe/);
  assert.equal(shouldFillField(f('Password to portfolio link', { type: 'password' })), false);
  assert.equal(classifyField(f('Additional portfolio link'), spec)?.value, 'github.com/uxfi');
});

test('optional salary / gender stay blank; notice and years fill', () => {
  assert.equal(shouldFillField(f('Expected salary')), false);
  assert.equal(shouldFillField(f('Gender')), false);
  assert.equal(classifyField(f('Notice period'), spec)?.value, '1 week');
  assert.equal(classifyField(f('Years of experience'), spec)?.value, '8');
  assert.equal(classifyField(f('How many years of experience do you have?'), spec)?.value, '8');
  // Yes/No experience gates must not receive the numeric "8".
  assert.equal(classifyField(f('Do you have 5+ years of experience?', { type: 'radio' }), spec), null);
});
