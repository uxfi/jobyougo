// Regressions from the 2026-10-05/06 apply runs (scratch/apply-runs): each
// case is a value a real form received, or should have received.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applicationSource, classifyField, planFitsField, readsAsYesNo } from '../lib/apply-classify.mjs';
import { candidateIsIn } from '../lib/apply-places.mjs';
import { shouldReplaceFilledValue, formHasSurnameField, formHasGivenNameField, formHasPhoneDialPicker, looksLikeDialCodeField, looksLikePhoneNumberField, isIntlTelInputPicker, isAvailabilityStartField, looksLikeEmptyChoice, optionsLookLikeDialCodes, skipComboboxProbe } from '../lib/apply-fill-guards.mjs';
import { redactSideProjects, stripSideProjectLines, usesSideProjectAsProof } from '../lib/application-writing.mjs';
import { closestCareerLines } from '../lib/prompt-budget.mjs';
import { pickMatchingOption, optionMatchScore } from '../lib/apply-option-match.mjs';
import { planToUpdate } from '../extension/apply-bridge-lib.mjs';
import { fieldCompletionIssue } from '../lib/apply-completion.mjs';
import { pickSelectOption, pickDeclineOption, pickYearsOption, isDemographicLabel } from '../lib/apply-select.mjs';
import { isMotivationQuestion } from '../lib/prompt-budget.mjs';
import { filterNavButtons, parseNavDecision, isOtherJobLink } from '../lib/apply-nav-llm.mjs';
import { extractJsonObject } from '../lib/apply-llm.mjs';
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
  startDate: 'After 1 week notice',
  yearsExperience: 12,
  // target_roles: "years as a Product Designer" is the career total only for them.
  targetRoles: ['Senior Product Designer', 'UX/UI Designer'],
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

test('a sponsorship note under a right-to-work question does not flip it (Teamtailor knockout)', () => {
  const note = 'Please note, if you do not have the right to work in the country your are applying to and visa sponsorship is not available, your application will be rejected automatically.';
  const rtw = radio(`Do you have the Right to Work in the country you are applying to?* Required ${note}`);
  // Salve.Inno 2026-10-16: no country parsed from the posting, and Paris / remote Europe.
  assert.equal(classifyField(rtw, { ...spec, offerLocation: { countries: [], cities: [], remote: false } })?.yesNo, 'yes');
  assert.equal(classifyField(rtw, { ...spec, offerLocation: { countries: ['France'], cities: ['paris'], remote: false } })?.yesNo, 'yes');
  assert.equal(classifyField(rtw, { ...spec, offerLocation: { countries: ['United Kingdom'], cities: ['london'], remote: false } })?.yesNo, 'no');
  // The sponsorship question on the same form keeps its own answer.
  assert.equal(classifyField(radio('Will you now or in the future require sponsorship for employment visa status?* Required'), spec)?.yesNo, 'no');
  assert.equal(classifyField(radio(`Do you require visa sponsorship? ${note}`), spec)?.yesNo, 'no');
  // The line before the question is not the ask either way.
  assert.equal(classifyField(radio('We are unable to offer visa sponsorship. Do you have the right to work in Germany?'), spec)?.yesNo, 'yes');
  assert.equal(classifyField(radio('You must have the right to work in the UK. Do you require visa sponsorship?'), spec)?.yesNo, 'yes');
  assert.equal(classifyField(radio('Are you authorized to work in the U.S. without sponsorship?'), spec)?.yesNo, 'no');
  // Statements carry the same employer note, in brackets or as a sentence.
  assert.equal(classifyField(radio('Right to work in the UK (visa sponsorship is not available)'), spec)?.yesNo, 'no');
  assert.equal(classifyField(radio('Right to work in the EU (visa sponsorship is not available)'), spec)?.yesNo, 'yes');
  const box = (label) => f(label, { type: 'checkbox' });
  const confirm = box('I confirm I have the right to work in the country I am applying to. Visa sponsorship is not available.');
  assert.equal(classifyField(confirm, { ...spec, offerLocation: { countries: ['France'], cities: ['paris'], remote: false } })?.check, true);
  assert.notEqual(classifyField(confirm, { ...spec, offerLocation: { countries: ['United Kingdom'], cities: ['london'], remote: false } })?.check, true);
  // The candidate's own "do not require" is not the employer's note.
  assert.equal(classifyField(radio('You must have the right to work in the UK. Do you require sponsorship'), spec)?.yesNo, 'yes');
});

test('the place is the one the question names, not its note or examples', () => {
  const at = (countries, cities = []) => ({ ...spec, offerLocation: { countries, cities, remote: false } });
  const ask = (label, place) => classifyField(radio(label), place)?.yesNo;
  // Brexit note: a UK question with "EU" under it got Yes.
  assert.equal(ask('Do you have the right to work in the UK? EU nationals must hold settled or pre-settled status.', at(['United Kingdom'], ['london'])), 'no');
  assert.equal(ask('Will you require sponsorship to work in the U.K.? EU citizens may need a visa.', at(['United Kingdom'], ['london'])), 'yes');
  // An example status is not the job's country.
  assert.equal(ask('Are you legally authorized to work in the country where this job is located? (e.g. U.S. citizen or green card holder)', at(['France'], ['paris'])), 'yes');
  assert.equal(ask('Do you have the right to work in the country you are applying to? We are unable to sponsor UK Skilled Worker visas.', at(['France'], ['paris'])), 'yes');
  // The lead-in is still the question's place; the posting comes next, the note last.
  assert.equal(ask('You must have the right to work in the EU. Will you require sponsorship?', at(['United Kingdom'], ['london'])), 'no');
  assert.equal(ask('Do you have the right to work in this country? This role is based in London.', at([])), 'no');
  // Dotted abbreviations do not end the sentence.
  assert.equal(ask('Are you authorized to work in the U.S. without sponsorship?', at(['France'], ['paris'])), 'no');
  // "Europe" in the question is the EU; "across Europe" in a lead-in is not the role's place.
  assert.equal(ask('Are you eligible to work in Europe?', at(['United Kingdom'], ['london'])), 'yes');
  assert.equal(ask('We hire across Europe. Do you have the right to work in the country of the role?', at(['United Kingdom'], ['london'])), 'no');
});

test('helper lines and notes do not rewrite the question', () => {
  const at = (countries, cities = []) => ({ ...spec, offerLocation: { countries, cities, remote: false } });
  const ask = (label, place) => classifyField(radio(label), place)?.yesNo;
  // Helper text on its own line, no full stop: a line break ends the sentence.
  assert.equal(ask('Visa sponsorship is not available for this role\nDo you have the right to work in Germany?', at(['Germany'], ['berlin'])), 'yes');
  assert.equal(ask('Visa sponsorship is not available for this role\nDo you have the right to work in the country you are applying to?', at(['United Kingdom'], ['london'])), 'no');
  const box = f('Visa sponsorship is not available\nI have the right to work in the country I am applying to', { type: 'checkbox' });
  assert.equal(classifyField(box, at(['France'], ['paris']))?.check, true);
  // "without sponsorship" and "EU passport" in the note are not the ask.
  assert.equal(ask('Do you require sponsorship?\nNote: we only hire candidates who can work without visa sponsorship.', at(['France'], ['paris'])), 'no');
  assert.equal(ask('Do you require sponsorship?\nNote: we only hire candidates who can work without visa sponsorship.', at(['United Kingdom'], ['london'])), 'yes');
  assert.equal(ask('Will you require visa sponsorship to work in France?\nEU passport holders do not need one.', at(['France'], ['paris'])), 'no');
  assert.equal(ask('Do you hold an EU passport or a valid UK work permit?', at(['United Kingdom'], ['london'])), 'yes');
  // A "?" in brackets does not end the question.
  assert.equal(ask('Work authorization (required?) Are you authorized to work in the UK?', at(['France'], ['paris'])), 'no');
});

test('two questions in one label: each one counts, the first one leads', () => {
  const at = (countries, cities = []) => ({ ...spec, offerLocation: { countries, cities, remote: false } });
  const ask = (label, place) => classifyField(radio(label), place)?.yesNo;
  assert.equal(ask('Are you currently based in the EU? Do you have the right to work in the EU without sponsorship?', at(['France'], ['paris'])), 'yes');
  assert.equal(ask('Are you currently based in the EU?\nDo you have the right to work in the EU without sponsorship?', at(['France'], ['paris'])), 'yes');
  assert.equal(ask('Do you have the right to work in Germany? Do you currently live in Germany?', at(['Germany'], ['berlin'])), 'no');
  assert.equal(ask('Do you have the right to work? Are you based in Germany?', at(['Germany'], ['berlin'])), 'no');
  // A follow-up "If not, …" does not take over the main ask.
  assert.equal(ask('Do you have the right to work in the UK? If not, will you require sponsorship?', at(['United Kingdom'], ['london'])), 'no');
  assert.equal(ask('Do you have permission to work in the Netherlands? If not, do you need sponsorship?', at(['France'], ['paris'])), 'yes');
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
  // A motivation answer is about the company: naming no employer is not a
  // fault any more, so the first usable draft is kept without a rewrite.
  assert.equal(calls, 1);
  assert.ok(written.answer.length > 20);
  assert.doesNotMatch(written.answer, /path stayed usable|framing and the delivery/);
});

test('the last-resort draft is one real sentence or nothing', () => {
  assert.equal(
    draftFromClosest(['- Senior Product Designer : Edenred: Designed mobile apps for gas station location.'], false, 'Tell us about a mobile app'),
    'I designed mobile apps for gas station location at Edenred.',
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

// Found by replaying every label of scratch/apply-runs through the classifier.
test('replay review: places named in Yes/No questions', () => {
  assert.equal(classifyField(radio('Are you currently based in the San Francisco Bay Area?*'), spec)?.yesNo, 'no');
  assert.equal(classifyField(radio('We cannot hire a remote worker for this role. Are you based in Madrid?'), spec)?.yesNo, 'no');
  assert.equal(classifyField(radio('Are you currently based in EMEA?'), spec)?.yesNo, 'yes');
  assert.equal(classifyField(radio('Do you live in Germany and are you allowed to work in Germany?*'), spec)?.yesNo, 'no');
  assert.equal(classifyField(radio('Are you currently living in The Netherlands and in possession of an EU passport?'), spec)?.yesNo, 'no');
  assert.equal(classifyField(radio('Are you legally authorized to work in the US (or country of your residence)?'), spec)?.yesNo, 'yes');
  assert.equal(candidateIsIn('Do you hold an EU passport?', id), null);
  assert.equal(classifyField(f('In which country, or countries, do you mainly reside?* Required'), spec)?.value, 'France');
  assert.equal(classifyField(f('Locations* Required — Europe', { type: 'checkbox' }), spec)?.check, true);
  assert.equal(classifyField(f('Locations* Required — Poland', { type: 'checkbox' }), spec)?.check, true);
  assert.equal(classifyField(f('Locations* Required — London', { type: 'checkbox' }), spec)?.check, undefined);
});

test('replay review: a Yes/No question never gets a profile value', () => {
  assert.equal(readsAsYesNo('The salary range for this role is $120-130K a year. Knowing this, would you accept?'), true);
  assert.equal(readsAsYesNo('In which country, or countries, do you mainly reside?'), false);
  assert.equal(classifyField(f('Have you completed a Master\'s degree in a relevant field?'), spec), null);
  assert.equal(classifyField(f('Did you graduate from University'), spec), null);
  assert.equal(classifyField(f('Education — Post Graduation Not Required', { type: 'checkbox' }), spec)?.value, undefined);
  assert.equal(classifyField(radio('Do you have a non-compete in place with your previous or current employer?'), spec)?.yesNo, 'no');
  assert.equal(classifyField(f('What is your notice period to your current employer?*'), spec)?.value, '1 week');
});

test('replay review: words inside words, tools, currencies', () => {
  assert.notEqual(classifyField(f('Work Type Preference'), spec)?.value, 'Available upon request');
  assert.equal(classifyField(f('How many years have you used Figma professionally? *'), spec), null);
  assert.equal(classifyField(f('How many years of B2C/consumer facing product design experience do you have? *'), spec), null);
  assert.equal(classifyField(f('Years of UX/UI experience'), spec)?.value, '12');
  assert.equal(classifyField(f('What is the minimum salary that you would accept in British £ ONLY and per month'), spec)?.leaveBlank, true);
  // Hugo 2026-10-20: a USD form gets the EUR expectation converted at ~1.1 (rounded up) instead of a blank.
  assert.match(String(classifyField(f('What are your salary expectations for this role? (Please provide a range in USD.)'), spec)?.value || ''), /^\d+/);
  assert.equal(classifyField(f('Please mention your current monthly compensation *'), spec)?.leaveBlank, true);
  assert.equal(classifyField(f('Desired Salary Range Format'), spec)?.value, 'Annual');
  assert.equal(classifyField(f('Please describe your experience building and launching customer-facing AI-native products', { type: 'textarea', tag: 'textarea' }), spec)?.leaveBlank, undefined);
});

test('replay review: titles, availability, identity questions', () => {
  assert.equal(classifyField(f('Current Designation *'), spec)?.value, id.employment.title);
  assert.equal(classifyField(f('When will you be able to join Appinio?'), spec)?.value, 'After 1 week notice');
  assert.equal(classifyField(f('If you are selected, how soon can you join us?'), spec)?.value, 'After 1 week notice');
  const identify = classifyField(f('How do you identify?*', { tag: 'select' }), spec);
  assert.equal(identify?.declinePreferred, true);
  assert.equal(classifyField(f('Mobile No.'), spec)?.value, '+33 6 95 65 91 31');
  assert.equal(classifyField(f('US Export Control laws: In which country did you obtain citizenship?'), { ...spec, identity: { ...id, city: 'Bangkok', country: 'Thailand' } })?.value, 'France');
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

// Flat 101 (talent.flat101.es, 2026-10-07): "Nombre" got "Hugo Vermot" next
// to "Apellido(s)", and intl-tel-input's "Selected country" was read as the
// residence country, searched with "France" and clicked on "Guayana
// Francesa +594".
test('Spanish / Italian / Portuguese name slots: Nombre is the first name next to Apellido(s)', () => {
  const nombre = f('Nombre *');
  const apellidos = f('Apellido(s) *');
  const withSurname = { ...spec, formHasSurnameField: formHasSurnameField([nombre, apellidos, f('Email')]) };
  assert.equal(withSurname.formHasSurnameField, true);
  assert.equal(classifyField(nombre, withSurname)?.value, 'Hugo');
  assert.equal(classifyField(apellidos, withSurname)?.value, 'Vermot');
  assert.equal(classifyField(f('Nome'), { ...spec, formHasSurnameField: true })?.value, 'Hugo');
  assert.equal(classifyField(f('Cognome'), spec)?.value, 'Vermot');
  assert.equal(classifyField(f('Sobrenome'), spec)?.value, 'Vermot');
  assert.equal(classifyField(f('Vorname'), spec)?.value, 'Hugo');
  assert.equal(classifyField(f('Nachname'), spec)?.value, 'Vermot');
  // Alone, "Nombre" is the whole name; "Nombre completo" always is.
  assert.equal(formHasSurnameField([nombre, f('Email'), f('Teléfono')]), false);
  assert.equal(classifyField(nombre, { ...spec, formHasSurnameField: false })?.value, 'Hugo Vermot');
  assert.equal(classifyField(f('Nombre completo'), { ...spec, formHasSurnameField: true })?.value, 'Hugo Vermot');
  // The French "Nombre" is a number, never a name.
  assert.notEqual(classifyField(f("Nombre d'années d'expérience en design"), withSurname)?.value, 'Hugo');
  assert.equal(skipComboboxProbe(nombre), true);
  assert.equal(skipComboboxProbe(apellidos), true);
});

test('intl-tel-input "Selected country" is set by the international number, never picked by hand', () => {
  const picker = { type: 'text', tag: 'div', label: 'Selected country', name: '', idAttr: '', role: 'combobox', ariaHaspopup: 'listbox', required: true };
  const phone = f('Teléfono *', { type: 'tel' });
  assert.equal(looksLikeDialCodeField(picker), true);
  assert.equal(isIntlTelInputPicker(picker), true);
  assert.equal(formHasPhoneDialPicker([picker, phone]), false);
  const formSpec = { ...spec, formHasDialPicker: formHasPhoneDialPicker([picker, phone]) };
  const plan = classifyField(picker, formSpec);
  assert.equal(plan?.answeredBlank, true);
  assert.equal(plan?.value, undefined);
  assert.equal(classifyField(phone, formSpec)?.value, '+33 6 95 65 91 31');
  // A country list whose rows carry dial codes is the dial picker whatever its label.
  const coded = { type: 'text', tag: 'select', label: 'País', name: 'prefix', idAttr: '', options: [{ text: 'España +34' }, { text: 'Francia +33' }, { text: 'Guayana Francesa +594' }, { text: 'Alemania +49' }] };
  assert.equal(looksLikeDialCodeField(coded), true);
  assert.equal(optionsLookLikeDialCodes(coded.options), true);
  assert.equal(optionsLookLikeDialCodes([{ text: 'Yes' }, { text: 'No' }, { text: 'Maybe' }]), false);
  const dial = classifyField(coded, spec);
  assert.equal(dial?.selectMatch, '+33');
  assert.equal(pickMatchingOption(coded.options, dial.selectText)?.text, 'Francia +33');
});

test('a country-code row with another code never matches the candidate country', () => {
  const rows = ['Guayana Francesa +594', 'Polinesia Francesa +689', 'Francia +33', 'San Pedro y Miquelón +508'];
  assert.equal(pickMatchingOption(rows, 'France')?.text, undefined);
  assert.equal(pickMatchingOption(rows, 'France +33')?.text, 'Francia +33');
  assert.equal(pickMatchingOption(rows, '+33')?.text, 'Francia +33');
  assert.equal(optionMatchScore('France +33', 'Guayana Francesa +594'), 0);
  assert.equal(optionMatchScore('France', 'Guayana Francesa +594'), 0);
  assert.equal(optionMatchScore('France', 'France +33'), 95);
  assert.equal(optionMatchScore('France +33', 'France'), 100);
  assert.ok(optionMatchScore('United States +1', 'United States +1') > optionMatchScore('United States +1', 'Canada +1'));
  assert.ok(optionMatchScore('United States +1', 'Canada +1') > 0);
  assert.equal(optionMatchScore('Thailand +66', 'Thailand (+66)'), 97);
  // Lists without codes keep their old matching.
  assert.equal(pickMatchingOption(['Austria', 'Australia', 'France'], 'France')?.text, 'France');
});

// 2026-10-05/07 runs: Agoda's required "Email me about other job openings"
// list stayed blank and blocked the send; "yes" went into "What is your
// current role?"; a story paragraph went into "Where are you currently
// located?" on Nucs AI; every Welcome to the Jungle run stopped on
// "Please select a file." for a CV that was attached.
test('a required marketing opt-in list answers No, an optional one stays blank', () => {
  const list = f('Email me about other job openings within the Booking Holding’s entities', { tag: 'select', options: [{ text: 'Select...' }, { text: 'Yes' }, { text: 'No' }] });
  assert.equal(classifyField(list, spec)?.yesNo, 'no');
  assert.equal(classifyField(list, { ...spec, consentOptIn: true })?.yesNo, 'yes');
  assert.equal(classifyField({ ...list, required: false }, spec)?.leaveBlank, true);
  assert.equal(classifyField(f('Newsletter email', { type: 'email' }), spec)?.leaveBlank, true);
});

test('planFitsField rejects a bare yes in an open question and a paragraph in a place box', () => {
  assert.equal(planFitsField(f('What is your current role?'), { value: 'yes' }, spec), false);
  assert.equal(planFitsField(f('What is your current role?'), { value: 'Senior Product Designer' }, spec), true);
  assert.equal(planFitsField(f('Do you have a valid driving licence?'), { value: 'Yes' }, spec), true);
  assert.equal(planFitsField(f('Where are your currently located? *'), { value: 'At OneAsset I designed and shipped the product. I owned the framing and the delivery.' }, spec), false);
  assert.equal(planFitsField(f('Where are your currently located? *'), { value: 'Paris, France' }, spec), true);
});

test('an attached file is not a missing file, whatever the stale validity says', () => {
  const cv = { type: 'file', label: 'CV', name: '', idAttr: '', required: true, fileCount: 0, fileChip: 'Hugo_Vermot_CV.pdf', invalid: true, ariaInvalid: false, validationMessage: 'Please select a file.' };
  assert.equal(fieldCompletionIssue(cv), null);
  assert.equal(fieldCompletionIssue({ ...cv, fileChip: '', ariaInvalid: true }, { uploadedLabels: ['CV'] }), null);
  assert.equal(fieldCompletionIssue({ ...cv, fileChip: '' }), 'fichier requis manquant');
  assert.equal(fieldCompletionIssue({ ...cv, ariaInvalid: true, validationMessage: 'File is too large (max 2 MB)' }), 'File is too large (max 2 MB)');
});

// 2026-10-08 audit of the classifier, the resolver and the nav decision:
// each case below is a value the audit reproduced with node.
test('work authorization follows the job country, also for remote jobs and status lists', () => {
  const us = { ...spec, offerLocation: { countries: ['United States'], cities: ['new york'], remote: true } };
  assert.equal(classifyField(radio('Are you legally authorized to work in the country where this job is located?'), us)?.yesNo, 'no');
  assert.equal(classifyField(radio('Will you now or in the future require sponsorship for employment visa status?'), us)?.yesNo, 'yes');
  const uk = { ...spec, offerLocation: { countries: ['United Kingdom'], cities: ['london'], remote: false } };
  const status = f('What is your current immigration status in the UK?', { tag: 'select', options: ['Citizen', 'Permanent resident', 'Visa holder', 'Require sponsorship'].map((t) => ({ text: t })) });
  assert.equal(pickSelectOption(status.options, classifyField(status, uk), 'status')?.text, 'Require sponsorship');
  assert.equal(classifyField(f('UK right to work status'), uk)?.value, 'Requires visa sponsorship');
  assert.equal(classifyField(f('Do you hold a valid work permit that authorizes you to work in the UK?', { tag: 'select', options: ['Yes', 'No', 'I will need sponsorship'].map((t) => ({ text: t })) }), uk)?.yesNo, 'no');
  // A third row does not hand the question back to the old blanket "No".
  const asia = { ...spec, region: 'asia', identity: { ...id, city: 'Bangkok', country: 'Thailand', location: 'Bangkok, Thailand' }, offerLocation: { countries: ['Thailand'], cities: ['bangkok'], remote: false } };
  assert.equal(classifyField(f('Are you comfortable with our hybrid model (3 days per week in the Bangkok office)?', { tag: 'select', options: ['Yes', 'No', 'Open to discuss'].map((t) => ({ text: t })) }), asia)?.yesNo, 'yes');
  assert.equal(classifyField(f('Are you willing to travel for team offsites?', { tag: 'select', options: ['Yes', 'No', 'Occasionally'].map((t) => ({ text: t })) }), spec)?.yesNo, 'yes');
});

test('rules fire on the field they are for, not on a look-alike label', () => {
  // Third-party contacts, iPhone, gender, employment, qualification, links.
  for (const label of ['Referee 1 full name', 'Reference phone number', 'Supervisor first name']) {
    assert.notEqual(classifyField(f(label), spec)?.value, id.fullName, label);
    assert.notEqual(classifyField(f(label), spec)?.value, id.phone, label);
    assert.notEqual(classifyField(f(label), spec)?.value, id.firstName, label);
  }
  assert.equal(classifyField(f('Referee 1 email address', { type: 'email' }), spec)?.leaveBlank, true);
  assert.notEqual(classifyField(f('Which platforms have you designed for (iPhone, Android, web)?'), spec)?.value, id.phone);
  assert.equal(classifyField(f('Quel genre de projets aimez-vous concevoir ?', { type: 'textarea', tag: 'textarea' }), spec), null);
  assert.equal(classifyField(f('Gender'), { ...spec, identity: { ...id, gender: 'Male' } })?.value, 'Male');
  assert.equal(classifyField(f('Why are you looking to leave your current company?', { type: 'textarea', tag: 'textarea' }), spec), null);
  assert.notEqual(classifyField(f('Title', { tag: 'select', options: ['Mr', 'Mrs', 'Ms', 'Dr'].map((t) => ({ text: t })) }), spec)?.value, id.employment.title);
  assert.equal(classifyField(f('Briefly summarize your qualifications for this role', { type: 'textarea', tag: 'textarea' }), spec), null);
  assert.equal(classifyField(f('Expected salary currency', { tag: 'select', options: ['EUR', 'USD', 'GBP'].map((t) => ({ text: t })) }), spec)?.value, 'EUR');
  assert.equal(classifyField(radio('Can you work Pacific time zone (PST) business hours?'), spec), null);
  assert.equal(classifyField(radio('Are you based in a European time zone, within two hours of CET?'), spec)?.yesNo, 'yes');
  assert.notEqual(classifyField(f('How did you hear about this job? (e.g. LinkedIn, job board, referral)'), spec)?.value, id.linkedin);
  assert.notEqual(classifyField(f('Which version control tools do you use (GitHub, GitLab, Bitbucket)?'), spec)?.value, id.github);
  assert.equal(classifyField(radio('Are you at least 18 years of age?'), spec)?.yesNo, 'yes');
  assert.equal(classifyField(f('How do you embrace ambiguity in your work?', { type: 'textarea', tag: 'textarea' }), spec), null);
  assert.equal(classifyField(f('University name'), spec)?.value, 'Digital Campus Paris');
  assert.equal(classifyField(f('City', { autocomplete: 'address-level2' }), spec)?.value, 'Paris');
  assert.equal(classifyField(f('Web address'), spec)?.value, id.portfolio);
  assert.equal(classifyField(f('Work location preference', { tag: 'select', options: ['Remote', 'Hybrid', 'On-site'].map((t) => ({ text: t })) }), spec)?.value, 'Remote');
  assert.equal(classifyField(f('City of birth'), spec)?.leaveBlank, true);
  assert.equal(classifyField(f('Notice period (in weeks)', { type: 'number' }), spec), null);
  assert.equal(classifyField(f('Nom'), { ...spec, formHasGivenNameField: true })?.value, 'Vermot');
  assert.notEqual(classifyField(f('How would you rate your skills relative to other designers?', { tag: 'select', options: ['Beginner', 'Intermediate', 'Expert'].map((t) => ({ text: t })) }), spec)?.yesNo, 'no');
});

test('Spanish, German and Italian labels reach the same rules', () => {
  assert.equal(classifyField(f('Teléfono'), spec)?.value, id.phone);
  assert.equal(classifyField(f('Correo electrónico'), spec)?.value, id.email);
  assert.equal(classifyField(f('Ciudad'), spec)?.value, 'Paris');
  assert.equal(classifyField(f('País'), spec)?.value, 'France');
  assert.equal(classifyField(f('Años de experiencia'), spec)?.value, '12');
  assert.equal(classifyField(f('Fecha de nacimiento'), spec)?.declinePreferred, true);
  assert.equal(classifyField(f('¿Cómo nos conociste?', { tag: 'select', options: ['LinkedIn', 'Portal de empleo', 'Otro'].map((t) => ({ text: t })) }), spec)?.selectText, 'LinkedIn');
  assert.deepEqual([labelLanguage('¿Por qué quieres trabajar en Flat 101?'), labelLanguage('Warum möchten Sie bei uns arbeiten?'), labelLanguage('Perché vuoi lavorare con noi?')], ['es', 'de', 'it']);
  assert.equal(pickMatchingOption(['Sí', 'No'], 'Yes')?.text, 'Sí');
  assert.equal(pickMatchingOption(['Ja', 'Nein'], 'No')?.text, 'Nein');
  assert.equal(pickYearsOption(['Less than 5 years', '5 to 10 years', '10 years or more'].map((t) => ({ text: t })), 12)?.text, '10 years or more');
});

test('the decline pre-pass only answers demographic questions', () => {
  const rows = ['Yes, I am authorized', 'No, I do not have authorization'].map((t) => ({ text: t }));
  assert.equal(pickDeclineOption(rows), null);
  assert.equal(isDemographicLabel('Are you legally authorized to work in the UK?'), false);
  assert.equal(isDemographicLabel('How do you identify? (gender)'), true);
  assert.equal(pickDeclineOption([{ text: 'Male' }, { text: 'Female' }, { text: 'Prefer not to say' }])?.text, 'Prefer not to say');
});

test('why-us questions are motivation, and the writer never swaps them for a story', () => {
  for (const q of ['Why Resilience ?', 'Why Riot?', 'Motivation: Why did you apply for this position at Riot?', 'Why are you applying?', 'What excites you about this role?', 'Pourquoi Resilience ?']) {
    assert.equal(isMotivationQuestion(q, 'Riot'), true, q);
  }
  assert.equal(isMotivationQuestion('Describe a product you shipped.', 'Riot'), false);
  assert.equal(claimsUnworkedBrand('At Kraken, I improved the KYC review flow.', { company: 'Kraken', allowed: ['OneAsset'] }), true);
  assert.equal(claimsUnworkedBrand('I designed KYC journeys at OneAsset, similar to the work at Kraken.', { company: 'Kraken', allowed: ['OneAsset'] }), false);
  assert.equal(claimsUnworkedBrand('I designed for resilience under load.', { company: 'Resilience', allowed: ['OneAsset'] }), false);
});

test('the nav decision never clicks a send button while navigating, nor another posting', () => {
  const buttons = [{ n: 0, text: 'Apply now', href: '/jobs/8049327-head-of-cx/apply' }, { n: 1, text: 'Submit application', href: '' }, { n: 2, text: 'Product Director - B2C', href: '/jobs/8279500-product-director' }];
  const listed = filterNavButtons(buttons, [], { phase: 'navigate' });
  assert.deepEqual(listed.map((b) => b.text), ['Apply now', 'Product Director - B2C']);
  const url = 'https://careers.holafly.com/jobs/8049327-head-of-cx-automation-ai?utm_source=LinkedIn';
  assert.equal(isOtherJobLink('/jobs/8279500-product-director', url), true);
  assert.equal(isOtherJobLink('/jobs/8049327-head-of-cx-automation-ai/applications/new', url), false);
  assert.equal(parseNavDecision('{"action":"click","index":1}', listed, { url, phase: 'navigate' }).action, 'human');
  assert.equal(parseNavDecision('{"action":"click","index":0}', listed, { url, phase: 'navigate' }).text, 'Apply now');
});

test('the resolver reply survives bracketed keys and a cut-off object', () => {
  assert.deepEqual(extractJsonObject('{"3": 1, "g0": [0, 2], "9": "Paris, France"'), { 3: 1, g0: [0, 2], 9: 'Paris, France' });
  assert.equal(groupAnswerFromProfile({ stem: 'Where did you hear about this job?', rows: [{ option: 'Remote OK', field: { i: 1 } }, { option: 'LinkedIn', field: { i: 2 } }] }, id), null);
  assert.equal(ownCountryOption({ label: 'Country of the position you are applying for', options: ['Austria', 'Belgium', 'France', 'Germany', 'Italy', 'Netherlands', 'Poland', 'Spain', 'Sweden'].map((t) => ({ text: t })) }, id), undefined);
  assert.equal(ownCountryOption({ label: 'Selected country', options: ['Alemania +49', 'España +34', 'Francia +33', 'Guayana Francesa +594', 'Italia +39', 'Polonia +48', 'Portugal +351', 'Reino Unido +44'].map((t) => ({ text: t })) }, id), 'Francia +33');
});

// 2026-10-08 self-review: regressions the first fix pass introduced, each
// pinned so it cannot come back.
test('self-review: profile links, remote offers, gender, Ashby names', () => {
  assert.equal(classifyField(f('What is your LinkedIn URL?'), spec)?.value, id.linkedin);
  assert.equal(classifyField(f('What is your GitHub username?'), spec)?.value, id.github);
  assert.notEqual(classifyField(f('Which tools do you use (LinkedIn, GitHub, Notion)?'), spec)?.value, id.linkedin);
  // A remote job open in France and the UK is worked from France.
  const both = { ...spec, offerLocation: { countries: ['France', 'United Kingdom'], cities: [], remote: true } };
  assert.equal(classifyField(radio('Are you legally authorized to work in the country where this job is located?'), both)?.yesNo, 'yes');
  // The long gender question keeps the profile's answer.
  const agoda = f('We collect your gender information for diversity, equity & inclusion monitoring. What is your gender?', { tag: 'select', options: ['Male', 'Female', 'Prefer not to disclose'].map((t) => ({ text: t })) });
  assert.equal(classifyField(agoda, { ...spec, identity: { ...id, gender: 'Male' } })?.value, 'Male');
  // Ashby "Name" + "Preferred first name": the full name, never the surname.
  const ashbyName = f('Name', { name: '_systemfield_name' });
  assert.equal(formHasGivenNameField([ashbyName, f('Preferred first name')]), false);
  assert.equal(classifyField(ashbyName, { ...spec, formHasGivenNameField: true })?.value, 'Hugo Vermot');
  assert.equal(classifyField(f('Nom'), { ...spec, formHasGivenNameField: true, formHasSurnameField: true })?.value, 'Hugo Vermot');
});

test('self-review: time zones, ages, references, phones, availability, employer', () => {
  assert.equal(classifyField(radio('Can you work in the CET time zone?'), spec)?.yesNo, 'yes');
  assert.equal(classifyField(radio('Are you able to work in the EST time zone?'), spec), null);
  assert.equal(classifyField(radio('Est-ce que le fuseau horaire CET vous convient ?'), spec)?.yesNo, 'yes');
  // French "est" / "cet" are words, not zones.
  assert.equal(classifyField(f('Quel est votre fuseau horaire ?', { tag: 'select', options: ['CET/CEST', 'GMT', 'EST'].map((t) => ({ text: t })) }), spec)?.value, id.timezone);
  assert.notEqual(classifyField(radio('Have you worked remotely for over 18 months?'), spec)?.yesNo, 'yes');
  assert.notEqual(classifyField(f('Job reference number'), spec)?.leaveBlank, true);
  assert.equal(looksLikePhoneNumberField({ label: 'Mobile', type: 'text', name: 'candidatePhone', idAttr: '' }), true);
  assert.equal(looksLikePhoneNumberField({ label: 'Have you designed apps for iPhone?', type: 'text', name: '', idAttr: '' }), false);
  assert.equal(isAvailabilityStartField(f('Disponibilidad para viajar')), false);
  assert.equal(isAvailabilityStartField(f('Disponibilidad')), true);
  assert.equal(classifyField(f('Current employer (leave blank if none)'), spec)?.value, 'OneAsset');
  // A statement box takes Yes; an open question does not.
  assert.equal(planFitsField(f('Legally authorized to work in the EU'), { value: 'Yes' }, spec), true);
  assert.equal(planFitsField(f('What is your current role?'), { value: 'yes' }, spec), false);
  assert.equal(looksLikeEmptyChoice('-'), true);
  assert.equal(looksLikeEmptyChoice('N/A'), false);
});

test('self-review: navigation keeps Apply buttons, motivation stays narrow, side projects are whole words', () => {
  const navButtons = filterNavButtons([{ text: 'Apply' }, { text: 'Postuler' }, { text: 'Submit application' }, { text: 'Send' }], [], { phase: 'navigate' });
  assert.deepEqual(navButtons.map((b) => b.text), ['Apply', 'Postuler']);
  assert.equal(isOtherJobLink('https://acme.teamtailor.com/jobs/12345-designer', 'https://www.welcometothejungle.com/en/companies/acme/jobs/designer_paris'), false);
  assert.equal(isOtherJobLink('/jobs/8279500-product-director', 'https://careers.holafly.com/jobs/8049327-head-of-cx'), true);
  assert.equal(isMotivationQuestion('What motivated you to become a designer?', 'Riot'), false);
  assert.equal(isMotivationQuestion('Pourquoi avez-vous quitté votre dernier poste ?', 'Riot'), false);
  assert.equal(isMotivationQuestion('What motivates you to apply to this role?', 'Riot'), true);
  assert.equal(redactSideProjects('A bohemian style and Bohe itself.', 'Tell us', ['Bohe']), 'A bohemian style and itself.');
  // Tether: the portfolio URL went out as "https://.xyz/portfolio".
  assert.equal(redactSideProjects('Portfolio: https://jobyougo.xyz/portfolio, mail me@jobyougo.xyz. I built JobYouGo.', 'Share your portfolio', ['JobYouGo']),
    'Portfolio: https://jobyougo.xyz/portfolio, mail me@jobyougo.xyz. I built .');
  assert.equal(redactSideProjects('My app jobyougo.xyz/app shipped.', 'Tell us', ['JobYouGo']), 'My app shipped.');
  assert.equal(stripSideProjectLines('Portfolio: https://jobyougo.xyz/portfolio\nSide app: JobYouGo', 'Share your portfolio or links', ['JobYouGo']), 'Portfolio: https://jobyougo.xyz/portfolio');
  // Elsewhere the address goes whole, never cut in half.
  assert.equal(redactSideProjects('Website: https://jobyougo.xyz/portfolio', 'Tell us about a product you shipped', ['JobYouGo']), 'Website:');
  assert.equal(usesSideProjectAsProof('Please share your portfolio', 'https://jobyougo.xyz/portfolio', ['JobYouGo']), false);
  // Evaluator lines about the candidate's base are not the job's place.
  assert.deepEqual(offerLocationFromText({ role: 'Designer', reportText: '- **Localisation:** Anywhere in the World → compatible avec Phuket, Thaïlande' }).countries, []);
});

test('dial-code lists are searched with the code, then the country name', () => {
  const picker = { i: 4, frameId: 0, type: 'text', tag: 'input', label: 'Country code', name: 'phoneCountryCode', idAttr: '', role: 'combobox', options: [] };
  const plan = classifyField(picker, spec);
  const u = planToUpdate(picker, plan, id);
  assert.equal(u.list, true);
  assert.equal(u.typeQuery, '+33');
  assert.equal(u.typeQueryAlt, 'France');
  assert.ok(u.alternates.includes('+33'));
  const city = { i: 5, frameId: 0, type: 'text', tag: 'input', label: 'City', name: '', idAttr: '', role: 'combobox', options: [] };
  const cityUpdate = planToUpdate(city, classifyField(city, spec), id);
  assert.equal(cityUpdate.typeQuery, 'Paris');
  assert.equal(cityUpdate.typeQueryAlt, undefined);
});

test('replay review: a messaging number is the phone, links the profile lacks go to the candidate', () => {
  assert.match(classifyField(f('WhatsApp number with Country Code *'), spec).value, /^\+\d/);
  const drive = classifyField(f('Please share a publicly accessible Google Drive link containing additional screens from one of your real UI/UX projects.', { tag: 'textarea', type: 'textarea' }), spec);
  assert.equal(drive.leaveBlank, true);
  const cvLink = classifyField(f('Link to your updated resume. The link must be publicly accessible. *'), spec);
  assert.equal(cvLink.leaveBlank, true);
  assert.equal(classifyField(f('Portfolio Website/Link (e.g., Behance, Dribbble, PDF, etc.) *'), spec).value, spec.identity.portfolio);
  assert.deepEqual(classifyField(f('Email * — Record my email address with my response', { type: 'checkbox' }), spec), { check: true });
});

test('an AI question may take its proof from independent products', () => {
  const q = 'How do you currently use AI tools or agentic workflows in your design process?';
  assert.equal(usesSideProjectAsProof(q, 'I build my own AI products, like JobYouGo, and prototype in Claude Code.', ['JobYouGo']), false);
  assert.equal(redactSideProjects('I built JobYouGo, an AI job tool.', q, ['JobYouGo']), 'I built JobYouGo, an AI job tool.');
  assert.equal(usesSideProjectAsProof('Tell us about a mobile feature you shipped', 'I shipped it in JobYouGo.', ['JobYouGo']), true);
});

test('a French "j\'ai" is not an AI question, "l\'IA" is', () => {
  assert.equal(usesSideProjectAsProof("Décrivez un projet où j'ai vu votre impact", 'Avec JobYouGo.', ['JobYouGo']), true);
  assert.equal(usesSideProjectAsProof("Comment utilisez-vous l'IA ?", 'Avec JobYouGo.', ['JobYouGo']), false);
});

test('an AI question finds the candidate\'s own AI products among the closest matches', () => {
  const career = '- Senior Product Designer : Edenred: Designed mobile apps for gas stations.\n- UXfi : Builder: AI agents that write UX audits with LLM prompts.';
  const ai = closestCareerLines('How do you use AI agents and LLM prompts in your work?', career, 6, { sideNames: ['UXfi'] });
  assert.ok(ai.some((line) => /UXfi/.test(line)), JSON.stringify(ai));
  const mobile = closestCareerLines('Tell us about a mobile app you designed', career, 6, { sideNames: ['UXfi'] });
  assert.ok(!mobile.some((line) => /UXfi/.test(line)), JSON.stringify(mobile));
});
