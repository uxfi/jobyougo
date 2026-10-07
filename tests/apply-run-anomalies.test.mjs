// Regressions from the 2026-10-05/06 apply runs (scratch/apply-runs): each
// case is a value a real form received, or should have received.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applicationSource, classifyField, planFitsField } from '../lib/apply-classify.mjs';
import { shouldReplaceFilledValue } from '../lib/apply-fill-guards.mjs';
import { pickMatchingOption, optionMatchScore } from '../lib/apply-option-match.mjs';
import { candidatePolicy, offerLocationFromText, policyPlan } from '../lib/apply-policy.mjs';
import { claimsUnworkedBrand, draftFromClosest, writeFormAnswer } from '../lib/form-answer.mjs';
import { groupAnswerFromProfile, groupCheckboxes, isProseField, ownCountryOption } from '../lib/apply-llm.mjs';
import { labelLanguage, questionLanguage } from '../lib/prompt-budget.mjs';
import { fitToMaxLength } from '../lib/application-writing.mjs';

const id = {
  fullName: 'Hugo Vermot',
  firstName: 'Hugo',
  lastName: 'Vermot',
  email: 'chilka.v@gmail.com',
  phone: '+33 6 95 65 91 31',
  dialCode: '+33',
  city: 'Paris',
  country: 'France',
  location: 'Paris, France',
  timezone: 'CET/CEST',
  linkedin: 'https://linkedin.com/in/hugovermot',
  portfolio: 'https://jobyougo.xyz/portfolio',
  github: 'github.com/uxfi',
  salary: 'EUR70K-110K salary / EUR600-900/day freelance',
  salaryMinimum: 'EUR60K salary / EUR500/day',
  salaryCurrency: 'EUR',
  noticePeriod: '1 week',
  yearsExperience: 12,
  visaStatus: 'No sponsorship needed -- French / EU citizen',
  languages: [
    { name: 'French', level: 'Native' },
    { name: 'English', level: 'Professional' },
  ],
  education: [{ degree: 'Bachelor Product Design', school: 'Digital Campus Paris', start: '2013', end: '2016' }],
  employment: { company: 'OneAsset', title: 'Senior Product Designer / Product Lead', startMonth: 2, startYear: '2026', current: true },
  policy: {
    authorizedIn: ['France', 'European Union', 'European Economic Area', 'Thailand'],
    remote: 'Full remote required',
    onsite: 'Open to on-site if based in Thailand; comfortable traveling for multi-day team-building/offsite events anywhere',
    bases: [{ city: 'Paris', country: 'France' }, { city: 'Bangkok', country: 'Thailand' }],
  },
};
const spec = {
  identity: id,
  company: 'Hostaway',
  role: 'Senior Product Designer',
  region: 'europe',
  answers: [],
  employerNames: ['OneAsset', 'Renault Group', 'Société Générale', 'LVMH Group'],
};
const f = (label, extra = {}) => ({ type: 'text', tag: 'input', label, name: '', idAttr: '', required: true, ...extra });
const yesNo = [{ text: 'Yes' }, { text: 'No' }];
const radio = (label, extra = {}) => f(label, { type: 'radio', options: yesNo, ...extra });

test('a question about a mobile product never receives the phone number', () => {
  const essay = f('Tell us about the mobile product you are most proud of designing. What problem were you solving?', { type: 'textarea', tag: 'textarea' });
  assert.equal(classifyField(essay, spec), null);
  assert.equal(
    classifyField(f('Please share a portfolio link that includes shipped native mobile app work for iOS or Android *'), spec)?.value,
    id.portfolio,
  );
  assert.equal(planFitsField(essay, { value: '6 95 65 91 31' }, spec), false);
});

test('location questions get the place they ask for', () => {
  assert.equal(classifyField(f('Where are your currently located? *'), spec)?.value, 'Paris, France');
  assert.equal(classifyField(f('Where are you currently located? (City, country) *'), spec)?.value, 'Paris, France');
  assert.equal(classifyField(f('Which country are you currently based in?'), spec)?.value, 'France');
  assert.equal(classifyField(f('City'), spec)?.value, 'Paris');
  assert.equal(classifyField(f('Street Name'), spec)?.leaveBlank, true);
  assert.equal(classifyField(f('District (Amphoe or Khet)'), spec)?.leaveBlank, true);
});

test('no language list is not a No to "Are you fluent in French?"', () => {
  assert.equal(classifyField(f('Are you fluent in French?'), { ...spec, identity: { ...id, languages: [] } }), null);
  assert.equal(classifyField(f('Are you fluent in French?'), spec)?.yesNo, 'yes');
});

test('a salary in another currency is left to the candidate, with the reason', () => {
  const thb = classifyField(f('What is your salary expectation in THB monthly?'), spec);
  assert.equal(thb?.leaveBlank, true);
  assert.match(thb?.skip || '', /THB/);
  assert.equal(classifyField(f('What are your salary expectations?'), spec)?.value, '60000');
});

test('relocation, on-site and travel follow the profile and the place asked about', () => {
  assert.equal(classifyField(radio('This role requires relocation to Bangkok and follows a hybrid work model (3 days in office). Are you comfortable with this?'), spec)?.yesNo, 'yes');
  assert.equal(classifyField(radio('Will you be able to work from our Bangkok office (hybrid, 3 days a week)?'), spec)?.yesNo, 'yes');
  const paris = classifyField(radio('Are you willing to work in our Paris office 3 days per week?'), spec);
  assert.equal(paris?.yesNo, 'no');
  assert.notEqual(paris?.value, '5 days (full time)');
  assert.equal(classifyField(radio('Are you open to travel?'), spec)?.yesNo, 'yes');
  assert.equal(classifyField(radio('Are you comfortable traveling for quarterly team offsites?'), spec)?.yesNo, 'yes');
  assert.equal(classifyField(radio('Are you ready to go on business trips every month?'), spec)?.yesNo, 'no');
  assert.equal(classifyField(radio('Are you currently based in, or willing to relocate to, Vienna?'), spec)?.yesNo, 'no');
  assert.equal(classifyField(radio('Are you willing to relocate to Paris?'), spec)?.yesNo, 'yes');
  // Not travel, not on-site: these stay with the resolver.
  assert.equal(policyPlan(radio('Do you have experience in the travel industry?'), spec), null);
  assert.equal(policyPlan(radio('Have you built hybrid mobile apps?'), spec), null);
  assert.equal(policyPlan(f('Why do you want to move to a product role?', { type: 'textarea', tag: 'textarea' }), spec), null);
});

test('work authorization depends on the country, not one fixed Yes', () => {
  assert.equal(classifyField(radio('Do you have the right to work in the UK without requiring sponsorship?'), spec)?.yesNo, 'no');
  assert.equal(classifyField(radio('Will you now, or in the future, require sponsorship to work in the UK?'), spec)?.yesNo, 'yes');
  assert.equal(classifyField(radio('Are you legally authorized to work in the United States?'), spec)?.yesNo, 'no');
  assert.equal(classifyField(radio('Do you currently have the legal right to work in the EU (or the specific country of the role)?'), spec)?.yesNo, 'yes');
  assert.equal(classifyField(radio('Do you require visa sponsorship to work?'), spec)?.yesNo, 'no');
  const where = radio('Are you authorized to work in the country where the job is located?');
  assert.equal(classifyField(where, { ...spec, offerLocation: { countries: ['United Kingdom'], cities: ['london'], remote: false } })?.yesNo, 'no');
  assert.equal(classifyField(where, { ...spec, offerLocation: { countries: ['Spain'], cities: ['barcelona'], remote: false } })?.yesNo, 'yes');
  assert.equal(classifyField(where, { ...spec, offerLocation: { countries: [], cities: [], remote: true } })?.yesNo, 'yes');
  assert.equal(classifyField(where, { ...spec, region: 'asia', identity: { ...id, city: 'Bangkok', country: 'Thailand' } })?.yesNo, 'yes');
  // Visa the card brand, and essays that mention visas, are not status asks.
  assert.equal(policyPlan(radio('Do you have experience with Visa or Mastercard payment flows?'), spec), null);
  assert.equal(policyPlan(f('Tell us about a product you designed for international teams, including how visa and work permit steps were handled for new hires across several countries.', { type: 'textarea', tag: 'textarea' }), spec), null);
  assert.equal(classifyField(f('Please confirm the current right to work document you hold'), spec)?.value, id.visaStatus);
});

test('passwords and legal history are left to the candidate', () => {
  for (const label of ['Retype Password: *', 'Choose Password: *', 'Confirm password']) {
    const plan = classifyField(f(label), spec);
    assert.equal(plan?.leaveBlank, true, label);
    assert.equal(plan?.value, undefined, label);
  }
  const criminal = classifyField(radio('Have you been convicted of any criminal offences that are not yet spent under the Rehabilitation of Offenders Act?'), spec);
  assert.equal(criminal?.leaveBlank, true);
  assert.equal(criminal?.yesNo, undefined);
});

test('names: combined boxes get the full name, a referrer box never gets it', () => {
  assert.equal(classifyField(f('Name and surname*'), spec)?.value, 'Hugo Vermot');
  assert.equal(classifyField(f('Preferred name'), spec)?.value, 'Hugo');
  const referrer = classifyField(f('If referred by a friend, please confirm their full name & employee ID: (Optional)', { required: false }), spec);
  assert.notEqual(referrer?.value, 'Hugo Vermot');
});

test('phone: international without a code picker, sub-fields stay out', () => {
  assert.equal(classifyField(f('Phone number *', { type: 'tel' }), spec)?.value, '+33 6 95 65 91 31');
  assert.equal(classifyField(f('Phone (for example: +420 123 456 789) *'), { ...spec, formHasDialPicker: true })?.value, '+33 6 95 65 91 31');
  assert.equal(classifyField(f('Phone', { type: 'tel' }), { ...spec, formHasDialPicker: true })?.value, '6 95 65 91 31');
  // The widget already rewrote the box under another code: international again.
  assert.equal(classifyField(f('Phone', { type: 'tel', value: '+69 5 65 91 31' }), { ...spec, formHasDialPicker: true })?.value, '+33 6 95 65 91 31');
  assert.equal(classifyField(f('Phone Extension'), spec)?.leaveBlank, true);
  assert.equal(classifyField(f('Phone Device Type', { tag: 'select', options: [{ text: 'Landline' }, { text: 'Mobile' }] }), spec)?.value, 'Mobile');
  const phone = f('Phone number', { type: 'tel' });
  assert.equal(shouldReplaceFilledValue(phone, '+695659131', '+33 6 95 65 91 31'), true);
  assert.equal(shouldReplaceFilledValue(phone, '+69 5 65 91 31', '6 95 65 91 31'), true);
  assert.equal(shouldReplaceFilledValue(phone, '06 95 65 91 31', '+33 6 95 65 91 31'), false);
  assert.equal(shouldReplaceFilledValue(phone, '+33 6 95 65 91 31', '6 95 65 91 31'), false);
});

test('portfolio slots and portfolio questions get the portfolio, never the CV', () => {
  assert.equal(classifyField(f('Portfolio / Other URL', { required: false }), spec)?.value, id.portfolio);
  const ask = f('Can you share a link to your portfolio if not already in your CV?', { type: 'textarea', tag: 'textarea' });
  assert.equal(classifyField(ask, spec)?.value, id.portfolio);
  assert.equal(classifyField(ask, spec)?.resume, undefined);
  assert.equal(classifyField(f('Resume', { type: 'textarea', tag: 'textarea' }), spec)?.resume, true);
  assert.match(classifyField(f('Portfolio', { type: 'file' }), { ...spec, cvPath: 'cv.pdf' })?.skip || '', /portfolio/);
  assert.equal(classifyField(f('CV', { type: 'file' }), { ...spec, cvPath: 'cv.pdf' })?.upload, 'cv.pdf');
});

test('a former employer answers Yes to "worked here before?"', () => {
  assert.equal(classifyField(radio('Have you previously worked at Renault Group?'), { ...spec, company: 'Renault Group' })?.yesNo, 'yes');
  assert.equal(classifyField(radio('Have you been employed by Mozilla before?'), { ...spec, company: 'Mozilla' })?.yesNo, 'no');
});

test('a required statement checkbox is ticked, a marketing one is not', () => {
  assert.equal(classifyField(f('*I am applying for recruitment process!', { type: 'checkbox' }), spec)?.check, true);
  const pool = classifyField(f('I agree that you keep my data for future recruitment processes', { type: 'checkbox', required: false }), spec);
  assert.notEqual(pool?.check, true);
});

test('"how did you hear" follows the posting URL', () => {
  assert.equal(applicationSource('https://www.welcometothejungle.com/en/companies/inqom/jobs/x'), 'Welcome to the Jungle');
  assert.equal(applicationSource('https://jobs.ashbyhq.com/Snyk/1/application?utm_source=LinkedIn_Job_Mapping'), 'LinkedIn');
  assert.equal(applicationSource('https://careers.hostaway.com/o/senior-product-designer'), 'Company website');
  const hear = f('How did you hear about this job? *');
  assert.equal(classifyField(hear, { ...spec, jobUrl: 'https://www.arbeitnow.com/jobs/companies/plancraft/x' })?.value, 'Arbeitnow');
  const list = f('How did you hear about this job?', { tag: 'select' });
  const fromWttj = classifyField(list, { ...spec, jobUrl: 'https://www.welcometothejungle.com/en/companies/inqom/jobs/x' });
  const options = [{ text: 'LinkedIn' }, { text: 'Job board' }, { text: 'Other' }];
  const rank = fromWttj.selectRank.find((re) => options.some((o) => re.test(o.text)));
  assert.equal(options.find((o) => rank.test(o.text))?.text, 'Job board');
});

test('a French question does not get an English Section F answer', () => {
  assert.equal(questionLanguage('Lettre de motivation'), 'fr');
  assert.equal(labelLanguage('Cover letter'), 'en');
  const answers = [{ question: 'Cover letter', answer: 'I am applying for the Senior Product Designer role at Inqom because the product needs clear flows.' }];
  assert.equal(classifyField(f('Lettre de motivation', { type: 'textarea', tag: 'textarea' }), { ...spec, answers }), null);
  assert.match(classifyField(f('Cover letter', { type: 'textarea', tag: 'textarea' }), { ...spec, answers })?.value || '', /Inqom/);
});

test('years: the career total, not for a specific stack', () => {
  assert.equal(classifyField(f('Total Work Experience *'), spec)?.value, '12');
  assert.equal(classifyField(f('How many years of experience do you have as a Product Designer?'), spec)?.value, '12');
  assert.equal(classifyField(f('How many years of experience do you have with Kubernetes?'), spec), null);
});

test('education comes from the CV', () => {
  assert.equal(classifyField(f('School name'), spec)?.value, 'Digital Campus Paris');
  assert.equal(classifyField(f('Highest Qualification *'), spec)?.value, "Bachelor's degree");
  assert.equal(classifyField(f('Field of study'), spec)?.value, 'Product Design');
  assert.equal(classifyField(f('School name'), { ...spec, identity: { ...id, education: [] } })?.value, 'N/A');
});

test('a maxlength box gets whole sentences', () => {
  const answers = [{ question: 'Why are you interested in this role?', answer: 'I like the product. It solves a real problem for hosts. The team ships fast and listens to users every week.' }];
  const plan = classifyField(f('Why are you interested in this role?', { type: 'textarea', tag: 'textarea', maxLength: 60 }), { ...spec, answers });
  assert.equal(plan?.value, 'I like the product. It solves a real problem for hosts.');
  assert.equal(fitToMaxLength('one two three four five six', 15), 'one two three');
});

test('option matching: places, long rows, numbering', () => {
  const paris = ['Paris, TX, USA', 'Paris, Île-de-France, FRA', 'Paris, Ogooué et Lac'].map((text) => ({ text }));
  assert.equal(pickMatchingOption(paris, 'Paris, France')?.text, 'Paris, Île-de-France, FRA');
  assert.equal(optionMatchScore('Paris, France', 'Paris, TX, USA'), 0);
  const deloitte = [
    { text: 'Yes, I am a current/an ex-employee of Deloitte (or its Subsidiary companies)' },
    { text: 'No, I am not a current/an ex-employee of Deloitte (or its Subsidiary companies)' },
  ];
  assert.equal(pickMatchingOption(deloitte, deloitte[1].text)?.text, deloitte[1].text);
  const ai = '3. Practitioner: I apply AI to complex work and refine prompts, context, and tool choices to improve quality, depth, and outcomes.';
  assert.ok(optionMatchScore(ai.toLowerCase(), ai) >= 90);
  assert.ok(optionMatchScore(ai.replace(/^3\. /, '').replace(/\.$/, ''), ai) >= 90);
});

test('motivation answers may name the hiring company; invented work there may not', () => {
  const opts = { company: 'Plancraft', allowed: ['OneAsset', 'Renault Group'] };
  assert.equal(claimsUnworkedBrand('I am interested in Plancraft because it builds software for craftspeople. At OneAsset I shipped a full product.', opts), false);
  assert.equal(claimsUnworkedBrand("I am drawn to Plancraft's mission. At OneAsset I designed investor journeys.", opts), false);
  assert.equal(claimsUnworkedBrand('At OneAsset I led the product strategy, and I want to bring that to the team at Plancraft.', opts), false);
  assert.equal(claimsUnworkedBrand('At Plancraft, I led the redesign of the quoting flow.', opts), true);
  assert.equal(claimsUnworkedBrand('I designed the onboarding for Plancraft last year.', opts), true);
});

test('the writer keeps a usable draft instead of the canned template', async () => {
  const drafts = [
    'Plancraft builds tools for craftspeople, which is the kind of operational product I like designing.',
    'The quoting flow in Plancraft is the kind of product I like designing, with clear and fast steps.',
  ];
  let calls = 0;
  const written = await writeFormAnswer({
    question: 'What motivates you to apply, and why does this role feel like a great fit?',
    company: 'Plancraft',
    role: 'Head of Product',
    career: '- Senior Product Designer / Product Lead : OneAsset (Feb 2026 – Present): Designed the investor app.',
    complete: async () => drafts[Math.min(calls++, drafts.length - 1)],
  });
  assert.equal(calls, 2);
  assert.ok(written.answer.length > 20);
  assert.doesNotMatch(written.answer, /path stayed usable|framing and the delivery/);
});

test('the last-resort draft is one real sentence or nothing', () => {
  assert.equal(
    draftFromClosest(['- Senior Product Designer : Edenred: Designed mobile apps for gas station location.'], false, 'Tell us about a mobile app'),
    'At Edenred, I designed mobile apps for gas station location.',
  );
  assert.equal(
    draftFromClosest(['- UX / Product Designer : LVMH Group: business analysis and data analysis were part of the product work.'], false, 'Tell us'),
    '',
  );
});

test('resolver: short facts are not essays, checkbox groups pick the candidate place', () => {
  assert.equal(isProseField({ label: 'Where are your currently located? *', kind: 'short text' }), false);
  assert.equal(isProseField({ label: 'Why do you want to join us?', kind: 'short text' }), true);
  assert.equal(isProseField({ label: 'Anything else?', kind: 'long text' }), true);
  const rows = ['France (Paris, Île-de-France, France)', 'Kenya (Nairobi, Nairobi City, Kenya)', 'Germany (Berlin, Berlin, Germany)', 'United Kingdom (London, Greater London, UK)']
    .map((opt, i) => ({ i, kind: 'checkbox', label: `What is your preferred work location? * — ${opt}` }));
  const { groups, singles } = groupCheckboxes([...rows, { i: 9, kind: 'short text', label: 'City' }]);
  assert.equal(groups.length, 1);
  assert.equal(singles.length, 1);
  const picks = groupAnswerFromProfile(groups[0], id);
  assert.deepEqual(picks.map((r) => r.field.i), [0]);
  const knows = groupCheckboxes([
    { i: 1, kind: 'checkbox', label: 'Do you know anyone who works at Starling? — Yes - Family Member' },
    { i: 2, kind: 'checkbox', label: "Do you know anyone who works at Starling? — No - I don't know anyone who works at Starling" },
  ]).groups[0];
  assert.deepEqual(groupAnswerFromProfile(knows, id).map((r) => r.field.i), [2]);
});

test('every language named must be spoken; a working language must be fluent', () => {
  assert.equal(classifyField(radio('Can you use English and Chinese as working language?'), spec)?.yesNo, 'no');
  assert.equal(classifyField(radio('Can you use English as a working language?'), spec)?.yesNo, 'yes');
  assert.equal(classifyField(radio('Do you speak French and English?'), spec)?.yesNo, 'yes');
});

test('country and dial-code lists take the candidate row or nothing', () => {
  const cut = ['Afghanistan +93', 'Albania +355', 'Algeria +213', 'Andorra +376', 'Angola +244', 'Argentina +54', 'Australia +61', 'Austria +43']
    .map((text) => ({ text }));
  assert.equal(ownCountryOption({ label: 'Country*', options: cut }, id), null);
  assert.equal(ownCountryOption({ label: 'Country*', options: [...cut, { text: 'France +33' }] }, id), 'France +33');
  const nat = ['American', 'Belgian', 'British', 'Dutch', 'French', 'German', 'Italian', 'Spanish'].map((text) => ({ text }));
  assert.equal(ownCountryOption({ label: 'Nationality', options: nat }, id), 'French');
  assert.equal(ownCountryOption({ label: 'Which tools do you use?', options: nat }, id), undefined);
});

test('policy and offer location are read from the profile and the posting', () => {
  const policy = candidatePolicy(id);
  assert.deepEqual([...policy.onsiteCountries], ['Thailand']);
  assert.equal(policy.travelOk, true);
  assert.equal(policy.remoteOnly, true);
  assert.ok(policy.authorized.has('Germany') && policy.authorized.has('Thailand') && !policy.authorized.has('United Kingdom'));
  const olx = offerLocationFromText({ role: 'Lead Product Manager, Trust & Safety', url: 'https://www.welcometothejungle.com/en/companies/olx-group/jobs/lead-product-manager-trust-safety_barcelona_nneljybj' });
  assert.deepEqual(olx.countries, ['Spain']);
  const koro = offerLocationFromText({
    role: 'Product Designer',
    reportText: '- **Localisation actuelle (Phuket, Thaïlande)** : non compatible\n- **Localisation** : KoRo HQ Berlin · Hybrid · Remote.',
  });
  assert.deepEqual(koro.countries, ['Germany']);
  assert.equal(koro.remote, false);
});
