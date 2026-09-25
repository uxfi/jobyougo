import test from 'node:test';
import assert from 'node:assert/strict';
import { skipComboboxProbe, looksLikeTypeahead, normalizedFieldLabel, isComboboxField, shouldSpeculativeProbe, shouldHumanType, isIdentityRepeatField, trivialFieldPlan, looksLikeDialCodeField, formDialCode, fileUploadPlan, shouldReplaceFilledValue, shouldFillField, fieldLooksRequired, isSecretCredentialField, travelOrRelocatePlan, employmentHistoryPlan, screeningChoicePlan, isAvailabilityStartField, monthLabel, isApplicationGateConsent, unknownThirdPartyPlan, locationTypeaheadHint } from '../lib/apply-fill-guards.mjs';

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
    'Phone', 'Phone number', 'Mobile', 'Mobile phone', 'LinkedIn', 'LinkedIn URL',
    'GitHub', 'Prénom', 'Nom de famille', 'Full name', 'Middle name',
    'First and last name', 'First & Last Name',
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
  assert.equal(looksLikeTypeahead(field('Company name')), true);
  assert.equal(looksLikeTypeahead(field('Current company')), true);
  assert.equal(looksLikeTypeahead(field('First name')), false);
  assert.equal(looksLikeTypeahead(field('Email')), false);
  assert.equal(looksLikeTypeahead(field('Do you require visa sponsorship?')), false);
  assert.equal(looksLikeTypeahead(field('Are you authorized to work in this country?')), false);
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

test('application-gate privacy consent is always filled (even without HTML required)', () => {
  const privacy = field('Required. By submitting this application, I agree that I have read the Privacy Policy', { type: 'checkbox' });
  assert.equal(isApplicationGateConsent(privacy), true);
  assert.equal(shouldFillField(privacy), true);
  assert.equal(fieldLooksRequired(privacy), true);
  assert.equal(trivialFieldPlan(privacy)?.check, true);
  assert.equal(isApplicationGateConsent(field('Email updates / newsletter', { type: 'checkbox' })), false);
});

test('shouldFillField: profile links / cover / location fill even when optional; salary and EEO stay blank', () => {
  assert.equal(shouldFillField(field('LinkedIn Profile')), true);
  assert.equal(shouldFillField(field('Portfolio URL')), true);
  assert.equal(shouldFillField(field('GitHub')), true);
  assert.equal(shouldFillField(field('Website')), true);
  assert.equal(shouldFillField(field('Cover letter', { tag: 'textarea' })), true);
  assert.equal(shouldFillField(field('How did you hear about us?')), true);
  assert.equal(shouldFillField(field('Current location')), true);
  assert.equal(shouldFillField(field('Country')), true);
  assert.equal(shouldFillField(field('Expected salary')), false);
  assert.equal(shouldFillField(field('Gender')), false);
  assert.equal(shouldFillField(field('First name')), true);
  assert.equal(shouldFillField(field('First and last name')), true);
  assert.equal(shouldFillField(field('First & Last Name')), true);
  assert.equal(shouldFillField(field('Name')), true);
  assert.equal(shouldFillField(field('Mobile phone')), true);
  assert.equal(shouldFillField(field('City')), true);
  assert.equal(shouldFillField(field('Timezone')), true);
  assert.equal(shouldFillField(field('Years of experience')), true);
  assert.equal(shouldFillField(field('Email', { type: 'email' })), true);
  assert.equal(shouldFillField(field('Phone number', { type: 'tel' })), true);
  assert.equal(shouldFillField(field('Are you fluent in Arabic?*')), true);
  assert.equal(shouldFillField(field('Portfolio Link *')), true);
  assert.equal(shouldFillField(field('Confirm email')), false);
  assert.equal(shouldFillField(field('Confirm email', { required: true })), true);
  assert.equal(shouldFillField({ label: 'Attach', type: 'file', name: 'resume', idAttr: '' }), true);
  assert.equal(shouldFillField({ label: 'Upload Other', type: 'file', name: 'other', idAttr: '' }), false);
  assert.equal(shouldFillField({ label: 'Choose a file or drop it here', type: 'file', name: '', idAttr: '' }), true);
  assert.equal(shouldFillField({ label: 'Click or drag file to upload', type: 'file', name: '', idAttr: '' }), true);
  assert.equal(isComboboxField({ role: 'combobox' }), true);
  assert.equal(isComboboxField({ tag: 'button', label: 'Select country', ariaHaspopup: 'listbox' }), true);
  assert.equal(isComboboxField({ idAttr: 'react-select-3-input', nearSelectWrapper: false }), true);
  assert.equal(isComboboxField({ tag: 'input', label: 'First name', type: 'text' }), false);
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

const job = {
  company: 'OneAsset',
  title: 'Senior Product Designer / Product Lead',
  startMonth: 2,
  startYear: '2026',
  current: true,
};

test('employmentHistoryPlan fills Greenhouse work-history block', () => {
  assert.equal(employmentHistoryPlan(field('Company name*'), job)?.value, 'OneAsset');
  assert.equal(employmentHistoryPlan(field('Who is your most recent/current employer?'), job)?.value, 'OneAsset');
  assert.equal(employmentHistoryPlan(field('Title*'), job)?.value, 'Senior Product Designer / Product Lead');
  assert.equal(employmentHistoryPlan(field('Start date month*'), job)?.selectText, 'February');
  assert.equal(employmentHistoryPlan(field('Start date year*'), job)?.value, '2026');
  assert.equal(employmentHistoryPlan(field('End date month*'), job)?.currentRoleEnd, true);
  assert.equal(employmentHistoryPlan(field('End date year*'), job)?.currentRoleEnd, true);
  assert.equal(employmentHistoryPlan(field('Current role', { type: 'checkbox' }), job)?.check, true);
  assert.equal(monthLabel(2), 'February');
});

test('isAvailabilityStartField ignores employment month/year dropdowns', () => {
  assert.equal(isAvailabilityStartField(field('Start date month*')), false);
  assert.equal(isAvailabilityStartField(field('Start date year*')), false);
  assert.equal(isAvailabilityStartField(field('When can you start?')), true);
  assert.equal(isAvailabilityStartField(field('Start date')), true);
});

test('screeningChoicePlan: 18+, previously worked, state, postal', () => {
  assert.equal(screeningChoicePlan(field('Are you 18 or older?*'))?.yesNo, 'yes');
  assert.equal(screeningChoicePlan(field('Have you previously worked at Natera?*'), { company: 'Natera' })?.yesNo, 'no');
  const state = screeningChoicePlan(field('What state do you currently live in?*'), {
    identity: { country: 'France' },
  });
  assert.ok(state?.selectPrefer);
  assert.equal(state?.leaveBlank, true);
  assert.equal(state?.value, undefined);
  assert.equal(screeningChoicePlan(field('Postal Code'), { identity: {} })?.leaveBlank, true);
  assert.equal(screeningChoicePlan(field('Postal Code*'), { identity: {} })?.value, 'N/A');
  assert.equal(screeningChoicePlan(field('Postal Code*'), { identity: { postal: '75011' } })?.value, '75011');
  assert.equal(screeningChoicePlan(field('Do you have experience working with Agentic AI Products/ Systems? *'))?.yesNo, 'yes');
  // bare "employer" must not hijack EEO / equal-opportunity copy
  assert.equal(employmentHistoryPlan(field('Equal Opportunity Employer acknowledgement'), {
    company: 'OneAsset', title: 'X', startMonth: 2, startYear: '2026', current: true,
  }), null);
});

test('required third-party names get N/A; location typeahead uses the first word', () => {
  assert.equal(unknownThirdPartyPlan(field('Hiring manager name*'))?.value, 'N/A');
  assert.equal(unknownThirdPartyPlan(field('Emergency contact'))?.leaveBlank, true);
  assert.equal(unknownThirdPartyPlan(field('School name*'))?.selectText, 'N/A');
  const hint = locationTypeaheadHint(field('City'), { city: 'Paris' });
  assert.equal(hint.prefix, 'Par');
  assert.equal(hint.contains, 'Paris');
  assert.equal(locationTypeaheadHint(field('Country'), { country: 'France' }).contains, 'France');
});
