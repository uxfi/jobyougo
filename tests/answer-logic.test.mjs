import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pass, fail, ROOT } from './helpers.mjs';
import { classifyField } from '../lib/apply-classify.mjs';
import { looksLikePhoneNumberField, screeningChoicePlan, travelOrRelocatePlan } from '../lib/apply-fill-guards.mjs';
import { usesSideProjectAsProof } from '../lib/application-writing.mjs';
import {
  answerMissesProof,
  formAnswerRequest,
  isToolDump,
  opensWithDenial,
} from '../lib/form-answer.mjs';
import {
  closestCareerLines,
  experienceIndex,
  indexCareer,
  isFactualQuestion,
  isMotivationQuestion,
  isScaleQuestion,
  questionLanguage,
} from '../lib/prompt-budget.mjs';

function ok(label, cond) {
  if (cond) pass(label);
  else {
    fail(label);
    throw new Error(label);
  }
}

const cv = readFileSync(join(ROOT, 'cv.md'), 'utf8');
const digest = readFileSync(join(ROOT, 'article-digest.md'), 'utf8');
const careerIndex = indexCareer(cv);
const career = experienceIndex(cv);
const mozilla = {
  identity: {
    firstName: 'Hugo',
    lastName: 'Vermot',
    email: 'chilka.v@gmail.com',
    phone: '+33 6 95 65 91 31',
    city: 'Paris',
    country: 'France',
    location: 'Paris, France',
    needsSponsorship: false,
    employment: { company: 'OneAsset', title: 'Senior Product Designer / Product Lead', startMonth: 2, startYear: '2026', current: true },
  },
  company: 'Mozilla',
  region: 'europe',
  answers: [],
};
const field = (label, extra = {}) => ({ type: 'text', label, name: '', idAttr: '', required: true, ...extra });

const mobileQ = 'Tell us about one mobile feature or improvement you personally drove from insight through launch.';
const scaleQ = 'What was the scale of the product you manage—approximately how many active users or customers does it serve?';
const whyQ = 'Why are you interested in this role?';
const aiQ = 'Have you used AI in your design process?';
const salaryQ = 'Salary expectations';

const mobileReq = formAnswerRequest({
  question: mobileQ,
  company: 'Mozilla',
  role: 'Designer',
  career,
  index: careerIndex,
  facts: 'Website: https://jobyougo.xyz/portfolio\nPhone: +33 6 95 65 91 31',
  offerContext: 'Reviewed in Figmol. JobYouGo mentioned in the report.',
});
const scaleReq = formAnswerRequest({ question: scaleQ, company: 'Mozilla', role: 'Designer', career, index: careerIndex, digest });
const whyReq = formAnswerRequest({ question: whyQ, company: 'Mozilla', role: 'Designer', career });
const salaryReq = formAnswerRequest({ question: salaryQ, company: 'Mozilla', role: 'Designer', career });
const frReq = formAnswerRequest({ question: 'Décrivez une application mobile que vous avez conçue.', company: 'Acme', role: 'Designer', career });

const mobileHits = closestCareerLines(mobileQ, career);
const aiHits = closestCareerLines(aiQ, career);

ok('Q? and apply share the same writer request shape', mobileReq.system && mobileReq.user && mobileReq.lang === 'en');
ok('an english question stays on the english path', mobileReq.lang === 'en' && /English only/.test(mobileReq.user));
ok('a french question stays on the french path', frReq.lang === 'fr' && /français uniquement/.test(frReq.user));
ok('mobile closest keeps shipped apps and drops side projects', mobileHits.some((line) => /Edenred|Casino/i.test(line)) && mobileHits.every((line) => !/JobYouGo|Creads|UXfi|Vloggy/i.test(line)));
ok('facts and offer cannot leak JobYouGo into a mobile prompt', !/JobYouGo/i.test(mobileReq.user.split('WRITING:')[0]));
const offerBlock = (mobileReq.user.match(/## Offer\n([\s\S]*?)(?:\n\n|$)/) || [])[1] || '';
ok('offer context keeps the tool name from the source', /Figmol/i.test(offerBlock));
ok('a JobYouGo mobile story is rejected as proof', usesSideProjectAsProof(mobileQ, 'I shipped a search shortcut in my personal app jobyougo.xyz.', careerIndex.sideNames));
ok('an Edenred mobile story is accepted', !answerMissesProof('At Edenred I designed the locator apps.', mobileHits.join('\n')));
ok('a tool dump is rejected on a product question', isToolDump(mobileQ, 'I use Cursor and GitHub every day.'));
ok('a denial is rejected', opensWithDenial("Je n'ai pas conçu de produit mobile."));
ok('AI closest uses the employer workflow', aiHits.some((line) => /OneAsset/i.test(line)) && aiHits.every((line) => !/Creads|UXfi|JobYouGo/i.test(line)));
ok('scale questions keep the documented counts only', isScaleQuestion(scaleQ) && /10,000/.test(scaleReq.user) && /millions/.test(scaleReq.user));
ok('scale instructions name SG or UpViral, not Creads as the proof', /Société Générale/.test(scaleReq.user) && /UpViral/.test(scaleReq.user) && /employer-scale proof/.test(scaleReq.user) && !/Creads/.test((scaleReq.user.match(/## Facts\n[\s\S]*?(?=\n\n## |\n\nAnswer|\n\nLANGUAGE)/) || [''])[0]) && !/\+12%/.test((scaleReq.user.match(/## Facts\n[\s\S]*?(?=\n\n## |\n\nAnswer|\n\nLANGUAGE)/) || [''])[0]));
ok('a ceased employer is not an allowed proof name', !(mobileReq.allowedNames || []).some((name) => /Vloggy/i.test(name)));
ok('why-us is a motivation question, not a product dump', isMotivationQuestion(whyQ) && /One detail from the offer/.test(whyReq.user) && !/4 to 6 sentences/.test(whyReq.user));
ok('why-us uses the eval match to pick proof', formAnswerRequest({
  question: whyQ,
  company: 'Mozilla',
  role: 'Designer',
  career,
  index: careerIndex,
  offerContext: '## B) Match CV\nMobile locator apps and gas-station flows.\nSavings product design.',
}).closest.some((line) => /Edenred|Société Générale/i.test(line)));
ok('salary stays a short factual value', isFactualQuestion(salaryQ) && /bare value/.test(salaryReq.user));
ok('a mobile essay is not a phone field', !looksLikePhoneNumberField(field(mobileQ, { tag: 'textarea' })));
ok('shipping consumer mobile apps is not a phone field', !looksLikePhoneNumberField(field('Which best describes your experience shipping consumer mobile apps?')));
ok('Mozilla before / France / no paid move stay deterministic',
  screeningChoicePlan(field('Have you been employed by Mozilla before?'), { company: 'Mozilla' })?.yesNo === 'no'
  && screeningChoicePlan(field('Are you currently located in France?'), { identity: mozilla.identity })?.yesNo === 'yes'
  && travelOrRelocatePlan(field('Would you be able to fill the position in one of the countries listed without relocation assistance from Mozilla?'))?.yesNo === 'yes');
ok('classify does not paste the phone into the mobile essay', classifyField(field(mobileQ, { tag: 'textarea' }), mozilla) === null);
ok('classify leaves the scale essay to the shared writer', classifyField(field(scaleQ, { tag: 'textarea' }), mozilla) === null);
ok('question language helper matches the writer', questionLanguage(mobileQ) === 'en' && questionLanguage('Pourquoi ce rôle ?') === 'fr');
