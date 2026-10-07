import test from 'node:test';
import assert from 'node:assert/strict';
import { skipComboboxProbe, looksLikeTypeahead, normalizedFieldLabel, isComboboxField, shouldSpeculativeProbe, shouldHumanType, isIdentityRepeatField, trivialFieldPlan, looksLikeDialCodeField, looksLikePhoneNumberField, formDialCode, nationalPhoneNumber, fileUploadPlan, shouldReplaceFilledValue, fieldHasCommittedValue, shouldFillField, fieldLooksRequired, isSecretCredentialField, travelOrRelocatePlan, employmentHistoryPlan, screeningChoicePlan, isAvailabilityStartField, monthLabel, isApplicationGateConsent, unknownThirdPartyPlan, locationTypeaheadHint, listTypeQuery, isCandidateFullNameField, isCoreApplicationIdentity, fieldIsMulti } from '../lib/apply-fill-guards.mjs';

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

test('fieldIsMulti: select-all labels and the multiple flag, not a single radio', () => {
  assert.equal(fieldIsMulti(field('Select all that apply')), true);
  assert.equal(fieldIsMulti(field('Choose up to 3 areas')), true);
  assert.equal(fieldIsMulti(field('Tick all that apply')), true);
  assert.equal(fieldIsMulti({ label: 'Skills', multiple: true }), true);
  assert.equal(fieldIsMulti(field('How would you rate your English skills?')), false);
  assert.equal(fieldIsMulti(field('How would you best describe your current use of AI in your work?')), false);
  assert.equal(fieldIsMulti(field('Do you currently have the legal right to work in the EU?')), false);
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
  // eRecruiter's Popover picker: a labelled <button aria-haspopup="dialog">.
  assert.equal(isComboboxField({ tag: 'button', ariaHaspopup: 'dialog', label: 'When can you start working? *' }), true);
  assert.equal(isComboboxField({ tag: 'input', ariaHaspopup: 'dialog', label: 'Date of birth' }), false);
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
  // Greenhouse intl-tel country combobox (Bitpanda / job-boards.eu)
  assert.equal(looksLikeDialCodeField({ label: 'Country', type: 'text', name: '', idAttr: 'country', role: 'combobox' }), true);
  assert.equal(looksLikeDialCodeField(field('Country of residence')), false);
  assert.equal(looksLikeDialCodeField({ label: 'Phone', type: 'text', name: '', idAttr: '', role: 'combobox' }), true);
  assert.equal(looksLikePhoneNumberField({ label: 'Phone', type: 'text', name: '', idAttr: '', role: 'combobox' }), false);
  assert.equal(looksLikeDialCodeField(field('Phone', { type: 'tel' })), false);
  assert.equal(listTypeQuery(
    { label: 'Phone', type: 'text', role: 'combobox', name: '', idAttr: '' },
    { selectMatch: '+66', selectText: 'Thailand +66' },
    { country: 'Thailand' },
  ), 'Thailand');
  assert.equal(listTypeQuery(
    { label: 'Location', type: 'text', role: 'combobox', name: '', idAttr: '', options: [] },
    { value: 'Paris, France', selectText: 'Paris, France', selectMatch: 'Paris' },
    { city: 'Paris', location: 'Paris, France' },
  ), 'Paris');
  assert.equal(listTypeQuery(
    {
      label: 'Location',
      type: 'text',
      role: 'combobox',
      name: '',
      idAttr: '',
      options: [
        { text: 'Yes, I would also consider to move to Hamburg' },
        { text: "No, this doesn't work for me I only want to work remote" },
      ],
    },
    { value: 'Paris, France', selectText: 'Paris, France' },
    { city: 'Paris' },
  ), '');
  assert.equal(looksLikeTypeahead({
    label: 'Location',
    options: [{ text: "No, this doesn't work for me I only want to work remote" }],
  }), false);
  assert.equal(looksLikeTypeahead({ label: 'Location' }), true);
});

test('nationalPhoneNumber strips the dial code for intl-tel Phone inputs', () => {
  assert.equal(nationalPhoneNumber('+33 6 95 65 91 31', '+33'), '6 95 65 91 31');
  assert.equal(nationalPhoneNumber('+66 62 784 2137', '+66'), '62 784 2137');
  assert.equal(nationalPhoneNumber('6 95 65 91 31', '+33'), '6 95 65 91 31');
  assert.equal(nationalPhoneNumber('+33 6 95 65 91 31', '+33', { keepTrunkZero: true }), '06 95 65 91 31');
  assert.equal(nationalPhoneNumber('+66 62 784 2137', '+66', { keepTrunkZero: true }), '062 784 2137');
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

test('isCandidateFullNameField: real name slots yes; "attached to your name" essay no', () => {
  for (const label of ['Full name', 'Name', 'Your name', 'Legal name', 'What is your name?', 'Nom']) {
    assert.equal(isCandidateFullNameField(field(label)), true, label);
    assert.equal(isCoreApplicationIdentity(field(label)), true, label);
  }
  assert.equal(isCandidateFullNameField(field('First name')), false);
  assert.equal(isCandidateFullNameField(field('Prénom')), false);
  assert.equal(isCoreApplicationIdentity(field('First name')), true);
  assert.equal(isCoreApplicationIdentity(field('Prénom')), true);
  assert.equal(isCoreApplicationIdentity(field('Last name')), true);
  assert.equal(isCoreApplicationIdentity(field('Email', { type: 'email' })), true);
  assert.equal(isCoreApplicationIdentity(field('Phone', { type: 'tel' })), true);
  assert.equal(isCandidateFullNameField(field('', { name: '_systemfield_name' })), true);
  const legendary = field(
    "If you were to leave your next role after three years, what is the one 'impossible' or 'legendary' achievement you want to have attached to your name?",
  );
  assert.equal(isCandidateFullNameField(legendary), false);
  assert.equal(isCoreApplicationIdentity(legendary), false);
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
  assert.equal(travelOrRelocatePlan(field('Are you currently based in, or willing to relocate to, Vienna?'))?.yesNo, 'no');
  assert.equal(
    travelOrRelocatePlan(field('If offered this position would you be able to fill the position in one of the countries listed on the job posting without relocation assistance from Mozilla?'))?.yesNo,
    'yes',
  );
  assert.equal(travelOrRelocatePlan(field('Are you happy to make yourself available for the required hybrid model of 3 days in office per week?'))?.yesNo, 'no');
  assert.match(
    String(travelOrRelocatePlan(field('Location', {
      options: [
        { text: 'Yes, I would also consider to move to Hamburg' },
        { text: "No, this doesn't work for me I only want to work remote" },
      ],
    }))?.selectText || ''),
    /only want to work remote/i,
  );
  assert.equal(
    travelOrRelocatePlan(field("If you're not based in Hamburg: this role includes visiting our Hamburg office a week per month"))?.yesNo,
    'no',
  );
  assert.equal(travelOrRelocatePlan(field('First name')), null);
});

test('shouldReplaceFilledValue overwrites salary autofill junk, not essays', () => {
  assert.equal(shouldReplaceFilledValue(field('Current location'), 'Full remote · Paris (CET) or Thailand (ICT), depending on the role', 'Bangkok, Thailand'), true);
  assert.equal(shouldReplaceFilledValue(field('Current location', { name: 'location' }), 'Paris or Bangkok, depending on the offer', 'Paris, France'), true);
  assert.equal(shouldReplaceFilledValue(field('Current location'), 'Bangkok, Thailand', 'Bangkok, Thailand'), false);
  assert.equal(shouldReplaceFilledValue(field('Expected salary'), '4000', '60000'), true);
  assert.equal(shouldReplaceFilledValue(field('Email', { type: 'email' }), 'wrong@x.com', 'hugo@x.com'), true);
  assert.equal(shouldReplaceFilledValue(field('Email', { type: 'email' }), 'hugo@x.com', 'hugo@x.com'), false);
  assert.equal(shouldReplaceFilledValue({ ...field('Cover letter'), tag: 'textarea' }, 'Long enough essay from the ATS', 'A different draft'), false);
  assert.equal(shouldReplaceFilledValue(field('Expected salary'), '60,000', '60000'), false);
  assert.equal(shouldReplaceFilledValue(field('LinkedIn'), 'https://www.linkedin.com/in/hugo/', 'https://linkedin.com/in/hugo'), false);
  assert.equal(shouldReplaceFilledValue(field('Country', { tag: 'select' }), 'Select…', 'France'), true);
  assert.equal(shouldReplaceFilledValue(field('Why are you interested in this role?', { tag: 'textarea' }), 'I want this role because the product maps to work I shipped at Edenred.', 'Another draft'), false);
  assert.equal(fieldHasCommittedValue(field('Cover letter', { tag: 'textarea', value: 'Already written by the ATS.' })), true);
  assert.equal(fieldHasCommittedValue(field('Country', { tag: 'select', value: 'Select one' })), false);
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
  assert.equal(employmentHistoryPlan(field('What is your current role?'), job)?.value, 'Senior Product Designer / Product Lead');
  assert.equal(employmentHistoryPlan(field('What is your current role?'), job)?.check, undefined);
  assert.equal(employmentHistoryPlan(field('What is your notice period to your current employer?*'), job), null);
  assert.equal(employmentHistoryPlan(field('Do you have a non-compete in place with your previous or current employer?'), job), null);
  assert.equal(monthLabel(2), 'February');
});

test('isAvailabilityStartField ignores employment month/year dropdowns', () => {
  assert.equal(isAvailabilityStartField(field('Start date month*')), false);
  assert.equal(isAvailabilityStartField(field('Start date year*')), false);
  assert.equal(isAvailabilityStartField(field('When can you start?')), true);
  assert.equal(isAvailabilityStartField(field('When could you start?')), true);
  assert.equal(isAvailabilityStartField(field('How quickly would you be able to start if we were to make you an offer?')), true);
  assert.equal(isAvailabilityStartField(field('Start date')), true);
});

test('screeningChoicePlan: 18+, previously worked, state, postal', () => {
  assert.equal(screeningChoicePlan(field('Are you 18 or older?*'))?.yesNo, 'yes');
  assert.equal(screeningChoicePlan(field('Have you previously worked at Natera?*'), { company: 'Natera' })?.yesNo, 'no');
  assert.equal(screeningChoicePlan(field('Have you been employed by Mozilla before?*'), { company: 'Mozilla' })?.yesNo, 'no');
  assert.equal(screeningChoicePlan(field('To avoid actual or perceived impairment of our parent company’s independent auditor'))?.yesNo, 'no');
  assert.equal(screeningChoicePlan(field('Are you a current/an ex-employee of Deloitte (or its Subsidiary companies)?'))?.yesNo, 'no');
  assert.equal(screeningChoicePlan(field('Are you currently located in France?*'), { identity: { country: 'France', city: 'Paris' } })?.yesNo, 'yes');
  assert.equal(screeningChoicePlan(field('Are you currently located in France?*'), { identity: { country: 'Thailand', city: 'Bangkok' } })?.yesNo, 'no');
  assert.equal(screeningChoicePlan(field('Are you currently located in Thailand?*'), { identity: { country: 'Thailand', city: 'Bangkok' } })?.yesNo, 'yes');
  assert.equal(looksLikePhoneNumberField(field('Phone')), true);
  assert.equal(looksLikePhoneNumberField(field('Tell us about one mobile feature you shipped', { tag: 'textarea' })), false);
  assert.equal(looksLikePhoneNumberField(field('Which best describes your experience shipping consumer mobile apps?')), false);
  const state = screeningChoicePlan(field('What state do you currently live in?*'), {
    identity: { country: 'France' },
  });
  assert.ok(state?.selectPrefer);
  assert.equal(state?.leaveBlank, true);
  assert.equal(state?.value, undefined);
  assert.equal(screeningChoicePlan(field('Postal Code'), { identity: {} })?.leaveBlank, true);
  assert.equal(screeningChoicePlan(field('Postal Code*'), { identity: {} })?.value, 'N/A');
  assert.equal(screeningChoicePlan(field('Postal Code*'), { identity: { postal: '75011' } })?.value, '75011');
  assert.equal(screeningChoicePlan(field('Do you have experience working with Agentic AI Products/ Systems? *')), null);
  assert.equal(screeningChoicePlan(field('Do you have experience working with Agentic AI Products/ Systems? *'), {
    practice: { evidence: 'Agentic AI, LLM orchestration' },
  })?.yesNo, 'yes');
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
  // Greenhouse dial Country* (id=country) is not a residence typeahead
  assert.equal(locationTypeaheadHint({ label: 'Country', type: 'text', name: '', idAttr: 'country', role: 'combobox' }, { country: 'France' }), null);
});
