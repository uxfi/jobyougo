import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyField } from '../lib/apply-classify.mjs';
import { pickSelectOption } from '../lib/apply-select.mjs';
import {
  shouldFillField,
  isCoreApplicationIdentity,
  skipComboboxProbe,
  screeningChoicePlan,
  derivePractice,
  isCandidateFullNameField,
  travelOrRelocatePlan,
  languageQuestionPlan,
} from '../lib/apply-fill-guards.mjs';

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
  yearsExperience: 12,
  languages: [
    { name: 'French', level: 'Native' },
    { name: 'English', level: 'Professional' },
    { name: 'Spanish', level: 'Basic' },
    { name: 'Thai', level: 'Notions' },
  ],
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
const spec = {
  identity: id,
  company: 'Otera',
  region: 'europe',
  answers: [],
  practice: derivePractice(
    {
      compensation: { target_range: 'EUR70K-110K salary / EUR600-900/day freelance' },
      location: { country: 'France', city: 'Paris' },
    },
    'JavaScript / Next.js, Vercel. Agentic AI. Built through deployment. production.',
  ),
};

function f(label, extra = {}) {
  return { type: 'text', label, name: '', idAttr: '', required: false, ...extra };
}

test('combined / full name boxes get Hugo Vermot; split names stay split', () => {
  assert.equal(classifyField(f('First and last name'), spec)?.value, 'Hugo Vermot');
  assert.equal(classifyField(f('First & Last Name *'), spec)?.value, 'Hugo Vermot');
  assert.equal(classifyField(f('First Name / Last Name'), spec)?.value, 'Hugo Vermot');
  assert.equal(classifyField(f('Name'), spec)?.value, 'Hugo Vermot');
  assert.equal(classifyField(f('Name *'), spec)?.value, 'Hugo Vermot');
  assert.equal(classifyField(f('Your name'), spec)?.value, 'Hugo Vermot');
  assert.equal(classifyField(f('Full name'), spec)?.value, 'Hugo Vermot');
  assert.equal(classifyField(f('What is your name?'), spec)?.value, 'Hugo Vermot');
  assert.equal(classifyField(f('First name'), spec)?.value, 'Hugo');
  assert.equal(classifyField(f('Last name'), spec)?.value, 'Vermot');
  assert.equal(classifyField(f('', { name: '_systemfield_name' }), spec)?.value, 'Hugo Vermot');
  assert.equal(shouldFillField(f('First and last name')), true);
  assert.equal(skipComboboxProbe(f('First and last name')), true);
});

test('essay prompts that casually say "name" are not the identity name field', () => {
  // Deliverect / Lever open question — `\bname\b` / "your name" used to return Hugo Vermot.
  const deliverect = f(
    "If you were to leave your next role after three years, what is the one 'impossible' or 'legendary' achievement you want to have attached to your name?",
    { tag: 'textarea' },
  );
  assert.equal(isCandidateFullNameField(deliverect), false);
  assert.equal(isCoreApplicationIdentity(deliverect), false);
  assert.notEqual(classifyField(deliverect, spec)?.value, 'Hugo Vermot');
  assert.equal(classifyField(deliverect, spec), null);
  assert.equal(classifyField(f('Make a name for yourself — describe your goal'), spec)?.value, undefined);
  // Short identity labels still resolve.
  assert.equal(classifyField(f('Your name'), spec)?.value, 'Hugo Vermot');
  assert.equal(classifyField(f('Name'), spec)?.value, 'Hugo Vermot');
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
  assert.equal(classifyField(f('Email me about other job openings within the Booking Holding’s entities'), spec)?.leaveBlank, true);
  assert.notEqual(classifyField(f('Do you agree to Agoda’s use of personal data from your application to improve our process?'), spec)?.leaveBlank, true);
  assert.equal(shouldFillField(f('Email updates / newsletter', { type: 'email' })), false);
  assert.equal(shouldFillField(f('Email me about other job openings within the Booking Holdings entities')), false);
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
    screeningChoicePlan(f('Do you have experience working with Agentic AI Products/ Systems? *'), spec)?.yesNo,
    'yes',
  );
  assert.equal(
    classifyField(f('Do you have experience working with Agentic AI Products/ Systems?', { type: 'radio', required: true }), spec)?.yesNo,
    'yes',
  );
});

test('Location whose only options are Yes|No is not filled with the city', () => {
  const loc = classifyField(f('Location', {
    type: 'text',
    role: 'combobox',
    options: [{ text: 'Yes' }, { text: 'No' }],
  }), spec);
  assert.equal(loc?.yesNo, 'yes');
  assert.equal(loc?.selectText, 'Yes');
  assert.equal(classifyField(f('Location'), spec)?.selectText, 'Paris, France');
});

test('How did you hear picks LinkedIn before Other when both exist', () => {
  const plan = classifyField(f('How did you hear about this job?', { type: 'radio', required: true }), spec);
  assert.equal(plan?.selectText, 'LinkedIn');
  const picked = pickSelectOption([
    { text: 'Employee referral' },
    { text: 'Other' },
    { text: 'LinkedIn' },
    { text: 'Career fair' },
  ], plan, 'How did you hear about this job?');
  assert.equal(picked?.text, 'LinkedIn');
});

test('relocation / capacity do not steal city or location answers', () => {
  assert.equal(classifyField(f('This role requires relocation to Doha', { type: 'radio' }), spec)?.yesNo, 'no');
  assert.equal(classifyField(f('Capacity planning notes'), spec), null);
  assert.equal(shouldFillField(f('Capacity planning notes')), false);
  assert.equal(classifyField(f('City'), spec)?.value, 'Paris');
});

test('location typeahead is the city, not the phone number', () => {
  const loc = classifyField(f('Current location', { name: 'location', idAttr: 'location-input' }), spec);
  assert.equal(loc?.value, 'Paris, France');
  assert.equal(loc?.selectMatch, 'Paris');
  const shared = classifyField(f('Current location ✱ Phone ✱', { name: 'location' }), spec);
  assert.equal(shared?.value, 'Paris, France');
  const phone = classifyField(f('Phone', { name: 'phone', type: 'tel' }), spec);
  assert.match(String(phone?.value || ''), /95/);
  assert.doesNotMatch(String(phone?.value || ''), /Paris/);
});

test('SuccessFactors phone keeps the country code; residence country stays France', () => {
  const phoneField = f('Primary Contact Number (including the country code)', {
    name: 'tor__fcellPhone',
    idAttr: 'tor__fcellPhone',
  });
  const phone = classifyField(phoneField, spec);
  assert.equal(phone?.value, '+33 6 95 65 91 31');
  assert.equal(shouldFillField(phoneField), true);
  assert.equal(isCoreApplicationIdentity(phoneField), true);
  const country = classifyField(f('Country/Region of Residence:*', {
    tag: 'select',
    name: 'fbclc_country',
    idAttr: 'fbclc_country',
    options: [{ text: 'French Guiana' }, { text: 'France' }, { text: 'Thailand' }],
  }), spec);
  assert.equal(country?.selectText, 'France');
  assert.equal(country?.selectMatch, 'France');
  const picked = pickSelectOption(
    [{ text: 'French Guiana' }, { text: 'France' }, { text: 'Thailand' }],
    country,
    'Country/Region of Residence:*',
  );
  assert.equal(picked?.text, 'France');
});

test('twitter / password / additional portfolio stay distinct', () => {
  assert.equal(classifyField(f('Twitter URL'), spec)?.value, 'https://x.com/Chilka_');
  assert.match(classifyField(f('Password to portfolio link', { type: 'password' }), spec)?.skip || '', /mot de passe/);
  assert.equal(shouldFillField(f('Password to portfolio link', { type: 'password' })), false);
  assert.match(classifyField(f('Additional portfolio link'), spec)?.skip || '', /lien supplémentaire/);
  assert.equal(classifyField(f('GitHub'), spec)?.value, 'github.com/uxfi');
  assert.equal(classifyField(f('GitHub URL'), spec)?.value, 'github.com/uxfi');
  assert.equal(classifyField(f('Portfolio / GitHub / website'), spec)?.value, 'https://jobyougo.xyz/portfolio');
  assert.equal(classifyField(f('Portfolio or GitHub'), spec)?.value, 'https://jobyougo.xyz/portfolio');
  assert.equal(classifyField(f('Website'), spec)?.value, 'https://jobyougo.xyz/portfolio');
});

test('optional salary / gender stay blank; notice and years fill', () => {
  assert.equal(shouldFillField(f('Expected salary')), false);
  assert.equal(shouldFillField(f('Gender')), false);
  const notice = classifyField(f('Notice period'), spec);
  assert.equal(notice?.value, '1 week');
  assert.equal(notice?.selectText, 'Immediate availability');
  assert.match(String(notice?.selectPrefer), /immediate/i);
  assert.equal(classifyField(f('How long is your notice period?'), spec)?.selectText, 'Immediate availability');
  assert.equal(classifyField(f('Years of experience'), spec)?.value, '12');
  assert.equal(classifyField(f('How many years of experience do you have?'), spec)?.value, '12');
  const designerYears = classifyField(f('How many years of experience do you have as a Product Designer? Excluding internships'), spec);
  assert.equal(designerYears?.years, 12);
  assert.equal(pickSelectOption([
    { text: '0-2 Years' },
    { text: '3-6 Years' },
    { text: '7-9 Years' },
    { text: '10+ Years' },
  ], designerYears, 'years')?.text, '10+ Years');
  assert.equal(classifyField(f('What is your current role?'), spec)?.value, 'Senior Product Designer / Product Lead');
  assert.equal(classifyField(f('What is your current role?'), spec)?.check, undefined);
  assert.equal(classifyField(f('Years of experience'), { identity: { ...id, yearsExperience: undefined } }), null);
  // Yes/No experience gates must not receive the numeric year count.
  assert.equal(classifyField(f('Do you have 5+ years of experience?', { type: 'radio' }), spec), null);
});

test('Bitpanda / Greenhouse: dial Country*, national phone, EU passport, hybrid, privacy', () => {
  const dial = classifyField(f('Country', { idAttr: 'country', role: 'combobox' }), {
    ...spec,
    identity: { ...id, dialCode: '+33' },
  });
  assert.equal(dial?.selectMatch, '+33');
  // No country-code picker on the form: the full international number. The
  // national "6 95…" became "+695659131" on intl-tel boxes and an unreadable
  // French number on Lever.
  assert.equal(
    classifyField(f('Phone'), { ...spec, identity: { ...id, dialCode: '+33' } })?.value,
    '+33 6 95 65 91 31',
  );
  assert.equal(
    classifyField(f('Phone'), { ...spec, formHasDialPicker: true, identity: { ...id, dialCode: '+33' } })?.value,
    '6 95 65 91 31',
  );
  const thaiDial = classifyField(f('Phone', { role: 'combobox' }), {
    ...spec,
    identity: { ...id, phone: '+66 62 784 2137', country: 'Thailand', dialCode: '+66' },
  });
  assert.match(String(thaiDial?.selectText || ''), /Thailand|\+66/);
  assert.equal(pickSelectOption([
    { text: 'Australia +61' },
    { text: 'Thailand +66' },
    { text: 'France +33' },
  ], thaiDial, 'Phone')?.text, 'Thailand +66');
  assert.equal(pickSelectOption(
    [{ text: 'Australia +61' }],
    { selectMatch: '+66', selectText: 'Thailand +66', value: 'Thailand +66' },
    'Phone',
  ), null);
  assert.equal(
    classifyField(f('Are you presently employed by any company within the Booking Holdings group, including Agoda?', { tag: 'select' }), spec)?.yesNo,
    'no',
  );
  const deloitte = classifyField(f('To avoid actual or perceived impairment of our parent company’s independent auditor', { tag: 'select' }), spec);
  assert.equal(deloitte?.yesNo, 'no');
  assert.equal(pickSelectOption([
    { text: 'Yes, I am a current/an ex-employee of Deloitte (or its Subsidiary companies)' },
    { text: 'No, I am not a current/an ex-employee of Deloitte (or its Subsidiary companies)' },
  ], deloitte, 'Deloitte')?.text, 'No, I am not a current/an ex-employee of Deloitte (or its Subsidiary companies)');
  assert.equal(
    classifyField(f('Do you currently possess an EU passport or a valid work permit that authorises you to work in the specified hiring location?'), spec)?.yesNo,
    'yes',
  );
  assert.equal(
    classifyField(f('Are you currently based in, or willing to relocate to, Vienna?'), spec)?.yesNo,
    'no',
  );
  assert.equal(
    classifyField(f('Are you happy to make yourself available for the required hybrid model of 3 days in office per week?'), spec)?.yesNo,
    'no',
  );
  assert.equal(
    classifyField(f('At Bitpanda we do everything in our power to protect your data and give you full control over your personal data.'), spec)?.yesNo,
    'yes',
  );
  assert.equal(
    shouldFillField(f('At Bitpanda we do everything in our power to protect your data and give you full control over your personal data.')),
    true,
  );
  assert.equal(
    shouldFillField(f('Do you currently possess an EU passport or a valid work permit that authorises you to work in the specified hiring location?')),
    true,
  );
  const salary = classifyField(f('What are your salary expectations?', { required: true }), {
    ...spec,
    identity: { ...id, salary: 'EUR70K-110K', salaryMinimum: 'EUR60K' },
  });
  assert.equal(salary?.value, '60000');
  assert.equal(salary?.selectMatch, '60000');
  const thbMonthly = classifyField(f('What is your salary expectation in THB monthly?', { required: true }), {
    ...spec,
    identity: { ...id, salary: 'EUR70K-110K', salaryMinimum: 'EUR60K', salaryCurrency: 'EUR' },
  });
  assert.match(String(thbMonthly?.skip || ''), /salaire/);
  assert.equal(thbMonthly?.leaveBlank, true);
});

test('Stravito: essays are not the portfolio URL; choices follow the CV', () => {
  const sites = f(
    'Share two or three live websites you designed and built yourself.*Required',
    { tag: 'textarea', type: 'textarea', required: true },
  );
  assert.equal(classifyField(sites, spec), null);
  assert.equal(shouldFillField(sites), true);

  const decision = f(
    'Tell us about a design decision you changed because of how it actually behaved in the browser.*Required',
    { tag: 'textarea', type: 'textarea', required: true },
  );
  assert.equal(classifyField(decision, spec), null);

  const ai = f(
    'Where does AI help in your design and build work, and where does it not?',
    { tag: 'textarea', type: 'textarea' },
  );
  assert.equal(classifyField(ai, spec), null);
  assert.equal(shouldFillField(ai), true);

  assert.equal(
    classifyField(f('Can you share a link to code you wrote?'), spec)?.value,
    'https://github.com/uxfi',
  );
  assert.equal(shouldFillField(f('Can you share a link to code you wrote?')), true);
  assert.equal(classifyField(f('Website'), spec)?.value, 'https://jobyougo.xyz/portfolio');

  const built = f(
    'Have you personally both designed and written the production code for websites that are live today?',
    { type: 'radio', required: true },
  );
  assert.equal(classifyField(built, spec)?.yesNo, 'yes');
  assert.notEqual(classifyField(built, spec)?.value, id.portfolio);

  const react = classifyField(f(
    'How much React have you shipped to production?',
    { type: 'radio', required: true },
  ), spec);
  assert.match(react?.selectText || '', /mostly myself/);
  const reactOpt = pickSelectOption([
    { text: 'None yet' },
    { text: 'Side projects or courses only' },
    { text: 'Components in a production codebase someone else set up' },
    { text: 'A production site or app I built mostly myself' },
  ], react, 'How much React have you shipped to production?');
  assert.equal(reactOpt?.text, 'A production site or app I built mostly myself');

  const box = (q, opt) => f(`${q} — ${opt}`, { type: 'checkbox', required: true });
  const hands = 'Which of these have you worked in hands-on?*Required';
  assert.equal(classifyField(box(hands, 'React'), spec)?.check, true);
  assert.equal(classifyField(box(hands, 'Next.js, Astro or another code-based framework'), spec)?.check, true);
  assert.equal(classifyField(box(hands, 'HubSpot CMS (HubL)'), spec)?.answeredBlank, true);
  assert.equal(classifyField(box(hands, 'WordPress or another templating CMS'), spec)?.answeredBlank, true);
  assert.equal(classifyField(box(hands, 'Webflow or Framer'), spec)?.answeredBlank, true);

  const years = classifyField(f(
    'How many years have you worked in a role where you both designed and built websites?',
    { type: 'radio', required: true },
  ), spec);
  assert.equal(years?.selectText, '2 to 4 years');
  assert.notEqual(years?.value, '12');
  const yearOpt = pickSelectOption([
    { text: 'Less than 2 years' },
    { text: '2 to 4 years' },
    { text: '5 to 8 years' },
    { text: 'More than 8 years' },
  ], years, 'years');
  assert.equal(yearOpt?.text, '2 to 4 years');

  const loc = 'Locations*Required';
  assert.equal(classifyField(box(loc, 'The Netherlands'), spec)?.check, true);
  assert.equal(classifyField(box(loc, 'Sweden'), spec)?.check, true);
  assert.equal(classifyField(box(loc, 'The UK'), spec)?.answeredBlank, true);

  assert.equal(classifyField(f(
    'Are you based in a European time zone, within two hours of Central European Time?',
    { type: 'radio', required: true },
  ), spec)?.yesNo, 'yes');
  assert.equal(classifyField(f('Timezone'), spec)?.value, 'CET/CEST');

  assert.equal(classifyField(f('Can you invoice for this engagement?', { type: 'radio', required: true }), spec)?.yesNo, 'yes');

  const days = classifyField(f(
    'How many days a week can you work on this for the full six months?',
    { type: 'radio', required: true },
  ), spec);
  assert.equal(pickSelectOption([
    { text: '5 days (full time)' },
    { text: '4 days' },
    { text: '3 days or fewer' },
  ], days, 'days')?.text, '5 days (full time)');

  const start = classifyField(f('When could you start?', { type: 'radio', required: true }), spec);
  assert.equal(pickSelectOption([
    { text: 'Within 2 weeks' },
    { text: 'Within a month' },
    { text: 'In 1 to 2 months' },
    { text: 'In more than 2 months' },
  ], start, 'start')?.text, 'Within 2 weeks');
  const agodaStart = classifyField(f('How quickly would you be able to start if we were to make you an offer?', { tag: 'select', required: true }), spec);
  assert.equal(pickSelectOption([
    { text: 'Immediate' },
    { text: '2 Weeks Notice' },
    { text: '1 Month Notice' },
  ], agodaStart, 'start')?.text, 'Immediate');

  const ind = 'What industries do you have relevant experience in?*Required';
  assert.equal(classifyField(box(ind, 'B2B SaaS'), spec)?.check, true);
  assert.equal(classifyField(box(ind, 'Enterprise SaaS'), spec)?.check, true);
  assert.equal(classifyField(box(ind, 'MarTech'), spec)?.check, true);
  assert.equal(classifyField(box(ind, 'AI / GenAI'), spec)?.check, true);
  assert.equal(classifyField(box(ind, 'Consumer SaaS / B2C software'), spec)?.answeredBlank, true);
  assert.equal(classifyField(box(ind, 'Cybersecurity'), spec)?.answeredBlank, true);
  assert.equal(classifyField(box(ind, 'Other'), spec)?.answeredBlank, true);
});

test('Mozilla-style mobile / France / relocation questions do not steal identity values', () => {
  const essay = f(
    'Tell us about one mobile feature or improvement you personally drove from insight through launch. What did you own, and what measurable impact did it have?',
    { tag: 'textarea', required: true },
  );
  assert.notEqual(classifyField(essay, spec)?.value, '6 95 65 91 31');
  assert.equal(classifyField(essay, spec), null);

  const mobileExp = f('Which best describes your experience shipping consumer mobile apps?', {
    tag: 'select',
    required: true,
  });
  assert.notEqual(classifyField(mobileExp, spec)?.value, '6 95 65 91 31');
  assert.equal(classifyField(mobileExp, spec), null);

  assert.equal(
    classifyField(f('Have you been employed by Mozilla before?', { tag: 'select', required: true }), {
      ...spec,
      company: 'Mozilla',
    })?.yesNo,
    'no',
  );
  assert.equal(
    classifyField(f('Are you currently located in France?', { tag: 'select', required: true }), spec)?.yesNo,
    'yes',
  );
  assert.equal(
    classifyField(f('Are you currently located in France?', { tag: 'select', required: true }), {
      ...spec,
      region: 'asia',
      identity: { ...id, city: 'Bangkok', country: 'Thailand', location: 'Bangkok, Thailand' },
    })?.yesNo,
    'no',
  );
  assert.equal(
    classifyField(f('If offered this position would you be able to fill the position in one of the countries listed on the job posting without relocation assistance from Mozilla?', { tag: 'select', required: true }), spec)?.yesNo,
    'yes',
  );
  assert.equal(
    classifyField(f('What was the scale of the product you manage—approximately how many active users or customers does it serve?', { tag: 'textarea', required: true }), spec),
    null,
  );
});

test('Plancraft / Ashby: Location is remote policy, EU work yes, English C1, AI practitioner', () => {
  const locOpts = [
    { text: 'Yes' },
    { text: 'No' },
    { text: 'Yes, no problem I am open to travel frequently' },
    { text: 'Yes, I would also consider to move to Hamburg' },
    { text: "No, this doesn't work for me I only want to work remote" },
  ];
  const loc = classifyField(f('Location', { tag: 'select', required: true, options: locOpts }), spec);
  assert.notEqual(loc?.selectText, 'Paris, France');
  assert.match(String(loc?.selectText || ''), /only want to work remote/i);
  assert.equal(pickSelectOption(locOpts, loc, 'Location')?.text, "No, this doesn't work for me I only want to work remote");
  assert.equal(
    pickSelectOption(locOpts, { value: 'Paris, France', selectText: 'Paris, France' }, 'Location')?.text,
    "No, this doesn't work for me I only want to work remote",
  );

  const euRight = classifyField(f('Do you currently have the legal right to work in the EU (or the specific country of the role)?', {
    type: 'radio',
    required: true,
    options: [
      { text: "No, I don't have the legal right" },
      { text: 'Yes, I have the legal right' },
    ],
  }), spec);
  assert.equal(euRight?.yesNo, 'yes');
  assert.equal(pickSelectOption([
    { text: "No, I don't have the legal right" },
    { text: 'Yes, I have the legal right' },
  ], euRight, 'legal right')?.text, 'Yes, I have the legal right');
  assert.equal(
    travelOrRelocatePlan(f('Do you currently have the legal right to work in the EU?', {
      options: [{ text: 'Yes, I can work remotely from the EU' }, { text: 'No' }],
    })),
    null,
  );
  assert.equal(
    classifyField(f("If you're not based in Hamburg: this role includes visiting our Hamburg office at least a week per month", { type: 'radio', required: true }), spec)?.yesNo,
    'no',
  );
  assert.equal(
    classifyField(f('Have you personally led the development and launch of customer-facing AI-native products?', { type: 'radio', required: true }), spec)?.yesNo,
    'yes',
  );

  const english = classifyField(f('How would you rate your English skills?', { tag: 'select', required: true }), spec);
  assert.equal(pickSelectOption([
    { text: 'A2' },
    { text: 'B2' },
    { text: 'C1' },
    { text: 'C2 / Native' },
  ], english, 'english')?.text, 'C1');

  const aiUse = classifyField(f('How would you best describe your current use of AI in your work?', { type: 'radio', required: true }), spec);
  assert.equal(pickSelectOption([
    { text: '1. Curious: I have tried a few tools' },
    { text: '2. Regular: I use AI for everyday tasks' },
    { text: '3. Practitioner: I apply AI to complex work and refine prompts, context, and tool choices to improve quality, depth, and outcomes.' },
    { text: '4. Builder: I ship AI products' },
  ], aiUse, 'ai')?.text, '3. Practitioner: I apply AI to complex work and refine prompts, context, and tool choices to improve quality, depth, and outcomes.');

  const hear = classifyField(f('How did you hear about plancraft?', { tag: 'select', required: true }), spec);
  assert.equal(pickSelectOption([
    { text: 'Xing' },
    { text: 'LinkedIn' },
    { text: 'Arbeitnow' },
    { text: 'Other' },
  ], hear, 'hear')?.text, 'LinkedIn');
  assert.equal(pickSelectOption([
    { text: 'Xing' },
    { text: 'Arbeitnow' },
    { text: 'Other' },
  ], hear, 'hear')?.text, 'Arbeitnow');
});

test('spoken language questions are Yes/No from the CV, never a career essay', () => {
  const french = classifyField(f('Are you fluent in French?'), spec);
  assert.equal(french?.yesNo, 'yes');
  assert.equal(french?.value, 'Yes');
  assert.ok(!/Agence V0|designed retail/i.test(String(french?.value || '')));
  assert.equal(languageQuestionPlan(f('Are you fluent in French?'), id.languages)?.yesNo, 'yes');

  assert.equal(classifyField(f('Are you fluent in English?'), spec)?.yesNo, 'yes');
  assert.equal(classifyField(f('Are you fluent in Spanish?'), spec)?.yesNo, 'no');
  assert.equal(classifyField(f('Are you fluent in Arabic?'), spec)?.yesNo, 'no');
  assert.equal(classifyField(f('Do you speak Spanish?'), spec)?.yesNo, 'yes');
  assert.equal(classifyField(f('Parlez-vous français ?'), spec)?.yesNo, 'yes');

  const englishLevel = classifyField(f('How would you rate your English skills?', { tag: 'select' }), spec);
  assert.equal(englishLevel?.selectText, 'C1');

  const listed = classifyField(f('What languages do you speak?'), spec);
  assert.match(String(listed?.value || ''), /French \(Native\)/);
  assert.match(String(listed?.value || ''), /English \(Professional\)/);

  assert.equal(classifyField(f('Which programming languages have you used?', { tag: 'textarea' }), spec), null);
});

test('replay leftovers: phone, place, employer, address, EU locations, AI product', () => {
  assert.equal(classifyField(f('Telefoonnummer:*'), spec)?.value, '+33 6 95 65 91 31');
  assert.equal(classifyField(f('Mobile No.'), spec)?.value, '+33 6 95 65 91 31');
  assert.equal(classifyField(f('Land/regio van vestiging:*'), spec)?.value, 'France');
  assert.match(String(classifyField(f('Land/regio-code:*'), spec)?.selectMatch || ''), /\+33/);

  const notice = classifyField(f('What is your notice period to your current employer?*'), spec);
  assert.equal(notice?.value, '1 week');
  assert.notEqual(notice?.value, 'OneAsset');
  assert.equal(classifyField(f('Current Employer*'), spec)?.value, 'OneAsset');
  assert.equal(
    classifyField(f('Do you have a non-compete in place with your previous or current employer that prevents you from joining?', { type: 'radio', options: [{ text: 'Yes' }, { text: 'No' }] }), spec)?.yesNo,
    'no',
  );
  assert.equal(
    classifyField(f('Are you currently bound by any agreements with a current or former employer that would restrict you?', { type: 'radio', options: [{ text: 'Yes' }, { text: 'No' }] }), spec)?.yesNo,
    'no',
  );

  const built = f('Please describe your experience building and launching customer-facing AI-native products', { tag: 'textarea' });
  assert.notEqual(classifyField(built, spec)?.skip, 'adresse postale (pas de rue dans le profil)');
  assert.equal(classifyField(f('Building'), spec)?.leaveBlank, true);

  const edu = { ...spec, identity: { ...id, education: [{ degree: 'Bachelor Product Design', school: 'Digital Campus Paris', end: '2016' }] } };
  const grad = classifyField(f('Education — Post Graduation Not Required (1083)', { type: 'checkbox', required: true }), edu);
  assert.notEqual(grad?.value, '2016');

  assert.equal(classifyField(f('Locations — Poland', { type: 'checkbox' }), spec)?.check, true);
  assert.equal(classifyField(f('Locations — Czechia', { type: 'checkbox' }), spec)?.check, true);
  assert.equal(classifyField(f('Locations — United Kingdom', { type: 'checkbox' }), spec)?.check, undefined);

  const candy = f('Have you reviewed the CandyAI product, and are you fully and professionally comfortable with it?', { type: 'radio', options: [{ text: 'Yes' }, { text: 'No' }] });
  assert.notEqual(classifyField(candy, spec)?.yesNo, 'yes');
  assert.equal(
    classifyField(f('Do you have experience working with Agentic AI Products/ Systems?', { type: 'radio', options: [{ text: 'Yes' }, { text: 'No' }] }), spec)?.yesNo,
    'yes',
  );

  const sponsor = classifyField(f('For the country in which you will be based, do you now, or will you at any time require visa sponsorship?'), spec);
  assert.equal(sponsor?.yesNo, 'no');
  assert.notEqual(sponsor?.value, 'France');
});
