import test from 'node:test';
import assert from 'node:assert/strict';
import { skipComboboxProbe, looksLikeTypeahead, normalizedFieldLabel, isComboboxField, shouldSpeculativeProbe, shouldHumanType, isIdentityRepeatField, trivialFieldPlan, looksLikeDialCodeField, formDialCode, fileUploadPlan, shouldReplaceFilledValue, shouldFillField, fieldLooksRequired, isSecretCredentialField, travelOrRelocatePlan } from '../lib/apply-fill-guards.mjs';

const field = (label, extra = {}) => ({ label, type: 'text', name: '', idAttr: '', ...extra });

test('skipComboboxProbe: native types that cannot be a list', () => {
  for (const type of ['email', 'tel', 'url', 'number', 'password', 'date']) {
    assert.equal(skipComboboxProbe({ type, label: 'Anything odd' }), true, type);
  }
});

test('skipComboboxProbe: identity labels go straight to fill()', () => {
  const skip = [
    'First name', 'First name *', 'Your first name',
    'Last name', 'Email', 'Email *', 'Work email', 'Email address',
    'Phone', 'Phone number', 'Mobile', 'LinkedIn', 'LinkedIn URL',
    'GitHub', 'Prénom', 'Nom de famille', 'Full name',
  ];
  for (const label of skip) {
    assert.equal(skipComboboxProbe(field(label)), true, label);
  }
});

test('skipComboboxProbe: does not swallow real dropdowns that mention email/name', () => {
  const probe = [
    'Email updates',
    'May we email you about this role?',
    'How did you hear about us?',
    'Country',
    'City',
    'Are you authorized to work in this country?',
    'Current company',
  ];
  for (const label of probe) {
    assert.equal(skipComboboxProbe(field(label)), false, label);
  }
});

test('looksLikeTypeahead: city/country/university/source, not identity or Yes/No', () => {
  assert.equal(looksLikeTypeahead(field('City')), true);
  assert.equal(looksLikeTypeahead(field('Current location')), true);
  assert.equal(looksLikeTypeahead(field('Country')), true);
  assert.equal(looksLikeTypeahead(field('Country of residence')), true);
  assert.equal(looksLikeTypeahead(field('University')), true);
  assert.equal(looksLikeTypeahead(field('How did you hear about us?')), true);
  assert.equal(looksLikeTypeahead(field('First name')), false);
  assert.equal(looksLikeTypeahead(field('Email')), false);
  assert.equal(looksLikeTypeahead(field('Do you require visa sponsorship?')), false);
  assert.equal(looksLikeTypeahead(field('Are you authorized to work in this country?')), false);
  assert.equal(looksLikeTypeahead(field('Current company')), false);
  assert.equal(looksLikeTypeahead(field('Skills')), false);
  assert.equal(looksLikeTypeahead(field('Open source experience')), false);
});

test('normalizedFieldLabel strips required markers', () => {
  assert.equal(normalizedFieldLabel(field('Email *')), 'email');
  assert.equal(normalizedFieldLabel(field('First name✱')), 'first name');
});

test('isComboboxField uses role, aria, and select wrappers', () => {
  assert.equal(isComboboxField({ role: 'combobox' }), true);
  assert.equal(isComboboxField({ ariaHaspopup: 'listbox' }), true);
  assert.equal(isComboboxField({ nearSelectWrapper: true }), true);
  assert.equal(isComboboxField({ role: '', type: 'text' }), false);
});

test('shouldSpeculativeProbe skips identity and long-text fields', () => {
  assert.equal(shouldSpeculativeProbe(field('First name')), false);
  assert.equal(shouldSpeculativeProbe(field('Email', { type: 'email' })), false);
  assert.equal(shouldSpeculativeProbe({ ...field('Cover letter'), tag: 'textarea' }), false);
  assert.equal(shouldSpeculativeProbe(field('Are you authorized to work?')), true);
});

test('shouldHumanType: identity stays on fill(), prose keeps keystrokes', () => {
  assert.equal(shouldHumanType(field('First name'), 'Hugo'), false);
  assert.equal(shouldHumanType(field('Email', { type: 'email' }), 'hugo@example.com'), false);
  assert.equal(shouldHumanType(field('Phone'), '+33600000000'), false);
  assert.equal(shouldHumanType({ ...field('Cover letter'), tag: 'textarea' }, 'Hello'), true);
  assert.equal(shouldHumanType(field('Why are you applying?'), 'Because of the mission.'), true);
  assert.equal(shouldHumanType(field('Notes'), 'x'.repeat(81)), true);
});

test('confirm/re-enter email is an identity repeat, not a dropdown', () => {
  const labels = [
    'Confirm email',
    'Confirm your email',
    'Confirm your email address',
    'Re-enter email',
    'Retype email address',
    'Email confirmation',
    'Verify your email',
    'Confirmez votre email',
    'Confirmation de l\'email',
  ];
  for (const label of labels) {
    assert.equal(isIdentityRepeatField(field(label)), true, label);
    assert.equal(skipComboboxProbe(field(label)), true, label);
    assert.equal(shouldSpeculativeProbe(field(label)), false, label);
    assert.equal(trivialFieldPlan(field(label), { email: 'hugo@x.com' })?.value, 'hugo@x.com', label);
  }
  assert.equal(isIdentityRepeatField(field('Email updates')), false);
  assert.equal(isIdentityRepeatField(field('May we email you about this role?')), false);
  assert.equal(isIdentityRepeatField({ label: '', type: 'text', name: 'email_confirmation', idAttr: '' }), true);
});

test('trivial confirm widgets: email-correct Yes, confirm-info checkbox', () => {
  assert.deepEqual(
    trivialFieldPlan(field('Is your email correct?'), { email: 'hugo@x.com' }),
    { yesNo: 'yes', selectText: 'Yes', value: 'Yes' },
  );
  assert.deepEqual(
    trivialFieldPlan({ label: 'I confirm that my email address is correct', type: 'checkbox', name: '', idAttr: '' }),
    { check: true },
  );
  assert.deepEqual(
    trivialFieldPlan({ label: 'I certify the information above is accurate', type: 'checkbox', name: '', idAttr: '' }),
    { check: true },
  );
});

test('dial code is +33 from a French number, not the full phone', () => {
  assert.equal(formDialCode('+33 6 95 65 91 31', 'France'), '+33');
  assert.equal(formDialCode('', 'France'), '+33');
  assert.equal(formDialCode('', 'Thailand'), '+66');
  assert.equal(looksLikeDialCodeField(field('Dial code *')), true);
  assert.equal(looksLikeDialCodeField(field('Phone number *')), false);
  assert.equal(looksLikeDialCodeField({ label: 'Dial code', type: 'text', name: 'phoneCountryCode', idAttr: '' }), true);
});

test('fileUploadPlan never dumps the CV into employment-reference / other', () => {
  assert.equal(fileUploadPlan(field('Upload CV'), { cvPath: '/tmp/cv.pdf' }).upload, '/tmp/cv.pdf');
  assert.equal(fileUploadPlan(field('Autofill from resume'), { cvPath: '/tmp/cv.pdf' }).upload, '/tmp/cv.pdf');
  assert.match(fileUploadPlan(field('Upload Employment reference'), { cvPath: '/tmp/cv.pdf' }).skip, /non-CV/);
  assert.match(fileUploadPlan(field('Upload Other'), { cvPath: '/tmp/cv.pdf' }).skip, /non-CV/);
  assert.match(fileUploadPlan(field('Browse The file exceeds the allowed'), { cvPath: '/tmp/cv.pdf' }).skip, /taille/);
});

test('shouldFillField: optional LinkedIn/salary/cover stay blank, required questions fill', () => {
  assert.equal(shouldFillField(field('LinkedIn Profile')), false);
  assert.equal(shouldFillField(field('Cover letter', { tag: 'textarea' })), false);
  assert.equal(shouldFillField(field('How did you hear about us?')), false);
  assert.equal(shouldFillField(field('Expected salary')), false);
  assert.equal(shouldFillField(field('Gender')), false);
  assert.equal(shouldFillField(field('First name')), true);
  assert.equal(shouldFillField(field('Email', { type: 'email' })), true);
  assert.equal(shouldFillField(field('Phone number', { type: 'tel' })), true);
  assert.equal(shouldFillField(field('Are you fluent in Arabic?*')), true);
  assert.equal(shouldFillField(field('Portfolio Link *')), true);
  assert.equal(shouldFillField(field('Confirm email')), false);
  assert.equal(shouldFillField(field('Confirm email', { required: true })), true);
  assert.equal(shouldFillField({ label: 'Attach', type: 'file', name: 'resume', idAttr: '' }), true);
  assert.equal(shouldFillField({ label: 'Upload Other', type: 'file', name: 'other', idAttr: '' }), false);
  assert.equal(fieldLooksRequired(field('Location (City)*')), true);
  assert.equal(fieldLooksRequired(field('LinkedIn Profile')), false);
  assert.equal(fieldLooksRequired(field('Email (required)')), true);
});

test('portfolio that mentions a password is still a URL field, not a credential', () => {
  assert.equal(isSecretCredentialField(field('Portfolio Link (include password if you have one!)')), false);
  assert.equal(isSecretCredentialField(field('Password to portfolio link')), true);
  assert.equal(isSecretCredentialField(field('Password', { type: 'password' })), true);
});

test('required monthly travel / relocation answers No, not availability prose', () => {
  const trips = travelOrRelocatePlan(field('Are you ready to go on business trips every month?'));
  assert.equal(trips?.yesNo, 'no');
  assert.equal(trips?.value, 'No');
  assert.equal(travelOrRelocatePlan(field('Are you open to relocating to Doha?'))?.yesNo, 'no');
  assert.equal(travelOrRelocatePlan(field('First name')), null);
});

test('shouldReplaceFilledValue overwrites salary autofill junk, not essays', () => {
  assert.equal(shouldReplaceFilledValue(field('Expected salary'), '4000', '60000'), true);
  assert.equal(shouldReplaceFilledValue(field('Email', { type: 'email' }), 'wrong@x.com', 'hugo@x.com'), true);
  assert.equal(shouldReplaceFilledValue(field('Email', { type: 'email' }), 'hugo@x.com', 'hugo@x.com'), false);
  assert.equal(shouldReplaceFilledValue({ ...field('Cover letter'), tag: 'textarea' }, 'Long enough essay from the ATS', 'A different draft'), false);
});
