// The apply identity is built from any profile: the base is chosen per offer,
// nothing falls back to one person's values, and the screening section feeds
// the answers forms ask beyond the CV.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildIdentity, normalizeLanguages, noticeDays } from '../lib/apply-spec.mjs';
import { isDemographicQuestion, ownCountryOption, usStateLine } from '../lib/apply-llm.mjs';
import { pickSelectOption } from '../lib/apply-select.mjs';
import { careerIndexFor } from '../lib/form-answer.mjs';
import { classifyField } from '../lib/apply-classify.mjs';

const DUAL_BASE = {
  candidate: { full_name: 'Jane Doe', email: 'jane@example.com', phone: '+33 6 00 00 00 00', languages: ['French (native)', 'English (professional)'] },
  location: {
    bases: [
      { city: 'Paris', country: 'France', default: true },
      { city: 'Bangkok', country: 'Thailand', phone: '+66 60 000 0000' },
    ],
    authorized_in: ['France', 'European Union', 'Thailand'],
    nationality: 'French',
    remote_policy: 'Full remote required',
    onsite_exceptions: [{ country: 'Thailand', modes: ['onsite', 'hybrid'] }],
  },
  availability: { notice_period: '1 month' },
  search: { contract_types: ['Salaried'], sector_preferences: ['Fintech'] },
};

test('an APAC offer applies from the Asian base with its phone, zone and status', () => {
  const id = buildIdentity(DUAL_BASE, '', { offerText: 'Remote - APAC (Singapore)' });
  assert.equal(id.city, 'Bangkok');
  assert.equal(id.phone, '+66 60 000 0000');
  assert.equal(id.dialCode, '+66');
  assert.equal(id.utcOffset, 7);
  assert.equal(id.workStatus, 'authorized');
  assert.equal(id.needsSponsorship, false);
  assert.equal(id.workAuthEU, false);
  assert.equal(id.nationality, 'French');
});

test('an EMEA offer and the default both apply from the European base', () => {
  for (const offerText of ['EMEA - Remote', '']) {
    const id = buildIdentity(DUAL_BASE, '', { offerText });
    assert.equal(id.city, 'Paris');
    assert.equal(id.phone, '+33 6 00 00 00 00');
    assert.equal(id.workStatus, 'citizen');
    assert.equal(id.workAuthEU, true);
  }
  assert.equal(buildIdentity(DUAL_BASE, 'asia').city, 'Bangkok', 'the old dashboard override still works');
});

test('the policy carries the structured on-site exceptions and bases', () => {
  const { policy } = buildIdentity(DUAL_BASE, '');
  assert.equal(policy.fullRemoteOnly, true);
  assert.deepEqual(policy.onsiteExceptions.map(e => e.country), ['Thailand']);
  assert.deepEqual(policy.bases.map(b => b.city), ['Paris', 'Bangkok']);
});

test('a US-based profile: its own state, dial code and no "Outside US"', () => {
  const id = buildIdentity({
    candidate: { full_name: 'Sam Lee', phone: '+1 512 000 0000' },
    location: { bases: [{ city: 'Austin', country: 'United States' }], us_state: 'Texas', authorized_in: ['United States'] },
  }, '');
  assert.equal(id.country, 'United States');
  assert.equal(id.dialCode, '+1');
  assert.equal(id.usState, 'Texas');
  const plan = classifyField({ label: 'What state do you currently live in?', tag: 'select', options: ['Texas', 'Ohio', 'Outside US'] }, { identity: id, answers: [] });
  assert.equal(plan?.value, 'Texas');
});

test('no person-specific defaults: notice, start date, CV and timezone stay empty', () => {
  const id = buildIdentity({ candidate: { full_name: 'New User' } }, '');
  assert.equal(id.noticePeriod, '');
  assert.equal(id.startDate, '');
  assert.equal(id.city, '');
  assert.equal(id.timezone, '');
  assert.equal(id.base, null);
  assert.equal(id.needsSponsorship, false);
});

test('onboarding languages "Name (level)" reach apply with a CEFR level', () => {
  assert.deepEqual(normalizeLanguages(['French (native)', 'English (professional)', 'Thai: basic', { name: 'German', level: 'B1' }]), [
    { name: 'French', level: 'native', cefr: 'C2' },
    { name: 'English', level: 'professional', cefr: 'C1' },
    { name: 'Thai', level: 'basic', cefr: 'A2' },
    { name: 'German', level: 'B1', cefr: 'B1' },
  ]);
  assert.equal(noticeDays('1 month'), 30);
  assert.equal(noticeDays('2 semaines'), 14);
  assert.equal(noticeDays('Immediately'), 0);
});

test('screening: EEO declines by default, chosen answers and custom pairs are kept', () => {
  const id = buildIdentity({
    candidate: { full_name: 'Jane Doe' },
    screening: {
      how_did_you_hear: 'LinkedIn',
      eeo: { gender: 'Woman', veteran: 'I am not a protected veteran' },
      custom_answers: [{ question: 'Why remote?', answer: 'Deep work across time zones.' }, { question: '', answer: 'dropped' }],
      non_compete: { bound: false },
    },
  }, '');
  assert.equal(id.howDidYouHear, 'LinkedIn');
  assert.equal(id.gender, 'Woman');
  assert.equal(id.screening.eeo.raceEthnicity, 'Prefer not to say');
  assert.equal(id.screening.eeo.veteran, 'I am not a protected veteran');
  assert.deepEqual(id.screening.customAnswers, [{ question: 'Why remote?', answer: 'Deep work across time zones.' }]);
  assert.equal(id.screening.nonCompete, false);
  const veteran = classifyField({ label: 'Veteran status', tag: 'select', options: ['I am a protected veteran', 'I am not a protected veteran', 'Decline'] }, { identity: id, answers: [] });
  assert.equal(veteran?.value, 'I am not a protected veteran');
});

test('the model never answers age or other demographic questions', () => {
  assert.equal(isDemographicQuestion({ label: 'Age' }), true);
  assert.equal(isDemographicQuestion({ label: 'What is your date of birth?' }), true);
  assert.equal(isDemographicQuestion({ label: 'Race / Ethnicity' }), true);
  assert.equal(isDemographicQuestion({ label: 'How do you manage stakeholders?' }), false);
  assert.equal(isDemographicQuestion({ label: 'Years of experience managing teams' }), false);
});

test('no notice period in the profile: the notice question is left to the candidate', () => {
  const id = buildIdentity({ candidate: { full_name: 'New User' } }, '');
  assert.equal(classifyField({ label: 'Notice period', tag: 'select', options: ['Immediate', '1 month', '3 months'] }, { identity: id, answers: [] }), null);
  const withNotice = buildIdentity({ candidate: { full_name: 'New User' }, availability: { notice_period: '1 month' } }, '');
  assert.equal(classifyField({ label: 'Notice period', type: 'text' }, { identity: withNotice, answers: [] })?.value, '1 month');
});

// 2026-10-13 review: legacy location text, EU nationals, onboarding edits over
// YAML-only keys, notice in the start date, nationality lists, US state, digest.
test('a legacy row with only a location text answers sponsorship from that base; no place is unknown', () => {
  const sponsor = { label: 'Will you now or in the future require visa sponsorship to work in Germany?', type: 'text', name: '', idAttr: '' };
  const authorized = { label: 'Are you legally authorized to work in Germany?', tag: 'select', options: ['Yes', 'No'], name: '', idAttr: '' };
  const legacy = buildIdentity({ candidate: { full_name: 'Ana Weber', location: 'Berlin, Germany' } }, '');
  assert.equal(legacy.city, 'Berlin');
  assert.equal(legacy.country, 'Germany');
  assert.equal(classifyField(sponsor, { identity: legacy, answers: [] })?.yesNo, 'no');
  assert.equal(classifyField(authorized, { identity: legacy, answers: [] })?.yesNo, 'yes');
  const blank = buildIdentity({ candidate: { full_name: 'New User' } }, '');
  assert.equal(classifyField(sponsor, { identity: blank, answers: [] }), null);
  assert.equal(classifyField(authorized, { identity: blank, answers: [] }), null);
});

test('an EU national based in another EU country answers the status list as an EU citizen', () => {
  const id = buildIdentity({ candidate: { full_name: 'Jean Martin' }, location: { nationality: 'French', bases: [{ city: 'Lisbon', country: 'Portugal' }] } }, '');
  assert.equal(id.workStatus, 'eu_citizen');
  const field = { label: 'Please select the status that allows you to work and live in that country', tag: 'select', options: ['Non-EU citizen', 'Citizen', 'EU citizen', 'Work VISA'].map((text) => ({ text })), name: '', idAttr: '' };
  const plan = classifyField(field, { identity: id, answers: [] });
  assert.equal(pickSelectOption(field.options, plan, field.label)?.text, 'EU citizen');
  assert.equal(pickSelectOption(field.options.filter((o) => o.text !== 'EU citizen'), plan, field.label)?.text, 'Citizen');
});

test('onboarding answers win over YAML-only keys; an empty EEO gender declines', () => {
  const id = buildIdentity({
    candidate: { full_name: 'Sam Lee', nationalities: ['British'], gender: 'Male' },
    location: { nationality: 'Irish' },
    screening: { eeo: { gender: '' } },
  }, '');
  assert.equal(id.nationality, 'Irish');
  assert.equal(id.gender, '');
  const gender = classifyField({ label: 'Gender', tag: 'select', options: ['Male', 'Female', 'Prefer not to say'], name: '', idAttr: '' }, { identity: id, answers: [] });
  assert.equal(gender?.declinePreferred, true);
  assert.equal(buildIdentity({ candidate: { gender: 'Male' } }, '').gender, 'Male', 'no EEO answer: the profile value');
});

test('a start date after a notice period is today plus the notice', () => {
  const expected = new Date();
  expected.setDate(expected.getDate() + 7);
  const iso = `${expected.getFullYear()}-${String(expected.getMonth() + 1).padStart(2, '0')}-${String(expected.getDate()).padStart(2, '0')}`;
  assert.equal(buildIdentity({ availability: { start_date: 'After 1 week notice', notice_period: '1 week' } }, '').startDateISO, iso);
  assert.equal(buildIdentity({ availability: { start_date: '2027-01-04', notice_period: '1 week' } }, '').startDateISO, '2027-01-04');
});

test('a nationality list without a nationality is left to the candidate', () => {
  const field = { label: 'Nationality', options: ['Austria', 'Belgium', 'France', 'Germany', 'Italy', 'Spain', 'Thailand', 'United Kingdom'] };
  assert.equal(ownCountryOption(field, { country: 'France' }), null);
  assert.equal(ownCountryOption(field, { country: 'Thailand', nationality: 'French' }), 'France');
});

test('the US state line follows the base', () => {
  assert.match(usStateLine({ usState: 'Outside US' }), /"Outside US"/);
  assert.match(usStateLine({ usState: 'Texas' }), /: Texas\./);
  assert.match(usStateLine({ usState: '' }), /not in the facts/);
});

test('the article digest goes with a stored CV for the owner only', () => {
  const root = mkdtempSync(join(tmpdir(), 'digest-'));
  writeFileSync(join(root, 'article-digest.md'), 'Owner proof point');
  assert.equal(careerIndexFor({ cvMarkdown: '# CV', digest: null }, root).digest, 'Owner proof point');
  assert.equal(careerIndexFor({ cvMarkdown: '# CV', digest: '' }, root).digest, '');
  assert.equal(careerIndexFor({ cvMarkdown: '# CV' }, root).digest, '', 'a spec without the marker never reads it');
});

test('an AI level list takes the profile level word first, in rank order', () => {
  const pick = (aiProficiency, label, options) => {
    const f = { label, tag: 'select', options: options.map((t) => ({ value: t, text: t })) };
    const plan = classifyField(f, { identity: { aiProficiency }, answers: [] });
    return plan && pickSelectOption(f.options, plan, label)?.text;
  };
  const expert = 'Expert (four years building and shipping AI products)';
  assert.equal(pick(expert, 'How would you rate your proficiency with AI tools?', ['Beginner', 'Intermediate', 'Advanced', 'Expert']), 'Expert');
  assert.equal(pick(expert, 'Describe your current use of AI', ['I do not use AI', 'Practitioner: AI in complex work', 'AI native: I build AI products']), 'AI native: I build AI products');
  assert.equal(pick('Practitioner (applies AI to complex work)', 'Describe your current use of AI', ['I do not use AI', 'Practitioner: AI in complex work', 'AI native: I build AI products']), 'Practitioner: AI in complex work');
});
