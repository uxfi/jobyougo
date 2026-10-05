import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyField } from '../lib/apply-classify.mjs';
import { pickSelectOption } from '../lib/apply-select.mjs';
import {
  shouldFillField,
  skipComboboxProbe,
  screeningChoicePlan,
  isCandidateFullNameField,
  isCoreApplicationIdentity,
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

test('twitter / password / additional portfolio stay distinct', () => {
  assert.equal(classifyField(f('Twitter URL'), spec)?.value, 'https://x.com/Chilka_');
  assert.match(classifyField(f('Password to portfolio link', { type: 'password' }), spec)?.skip || '', /mot de passe/);
  assert.equal(shouldFillField(f('Password to portfolio link', { type: 'password' })), false);
  assert.equal(classifyField(f('Additional portfolio link'), spec)?.value, 'github.com/uxfi');
});

test('optional salary / gender stay blank; notice and years fill', () => {
  assert.equal(shouldFillField(f('Expected salary')), false);
  assert.equal(shouldFillField(f('Gender')), false);
  const notice = classifyField(f('Notice period'), spec);
  assert.equal(notice?.value, '1 week');
  assert.equal(notice?.selectText, 'Immediate availability');
  assert.match(String(notice?.selectPrefer), /immediate/i);
  assert.equal(classifyField(f('How long is your notice period?'), spec)?.selectText, 'Immediate availability');
  assert.equal(classifyField(f('Years of experience'), spec)?.value, '8');
  assert.equal(classifyField(f('How many years of experience do you have?'), spec)?.value, '8');
  // Yes/No experience gates must not receive the numeric "8".
  assert.equal(classifyField(f('Do you have 5+ years of experience?', { type: 'radio' }), spec), null);
});

test('Bitpanda / Greenhouse: dial Country*, national phone, EU passport, hybrid, privacy', () => {
  const dial = classifyField(f('Country', { idAttr: 'country', role: 'combobox' }), {
    ...spec,
    identity: { ...id, dialCode: '+33' },
  });
  assert.equal(dial?.selectMatch, '+33');
  assert.equal(
    classifyField(f('Phone'), { ...spec, identity: { ...id, dialCode: '+33' } })?.value,
    '6 95 65 91 31',
  );
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
  assert.notEqual(years?.value, '8');
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

  const ind = 'What industries do you have relevant experience in?*Required';
  assert.equal(classifyField(box(ind, 'B2B SaaS'), spec)?.check, true);
  assert.equal(classifyField(box(ind, 'Enterprise SaaS'), spec)?.check, true);
  assert.equal(classifyField(box(ind, 'MarTech'), spec)?.check, true);
  assert.equal(classifyField(box(ind, 'AI / GenAI'), spec)?.check, true);
  assert.equal(classifyField(box(ind, 'Consumer SaaS / B2C software'), spec)?.answeredBlank, true);
  assert.equal(classifyField(box(ind, 'Cybersecurity'), spec)?.answeredBlank, true);
  assert.equal(classifyField(box(ind, 'Other'), spec)?.answeredBlank, true);
});
