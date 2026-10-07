import { pass, fail } from './helpers.mjs';
import { bestAnswerFor } from '../lib/apply-classify.mjs';
import { usesSideProjectAsProof } from '../lib/application-writing.mjs';
import { answerMissesProof, claimsUnworkedBrand, extractAnswerBody, extractProofNames, formAnswerRequest, isToolDump, opensWithDenial, writeFormAnswer } from '../lib/form-answer.mjs';

function ok(label, cond) {
  if (cond) pass(label);
  else {
    fail(label);
    throw new Error(label);
  }
}

ok('denial opener is detected', opensWithDenial("Je n'ai pas conçu de produit"));
ok('a mid-sentence denial is detected', opensWithDenial('I designed web tools. I have not designed a mobile product as a primary product.'));
ok('a shipped-work sentence is not a denial', !opensWithDenial('I shipped the locator apps at Edenred.'));
const request = formAnswerRequest({
  question: 'Tell us about the mobile product you designed',
  company: 'Acme',
  role: 'Designer',
  career: '- Senior Product Designer : Edenred: Designed mobile apps for gas station location.\n- Creads.io : Founder: Brand Agent pipeline.',
});
ok('the request puts matching roles above the full career', request.user.indexOf('Closest matches') < request.user.indexOf('Full career') && request.user.includes('Edenred'));
const figmolReq = formAnswerRequest({
  question: 'Tell us about a product you shipped.',
  company: 'Acme',
  role: 'Designer',
  career: '- Edenred: designed the locator apps',
  offerContext: 'Reviewed in Figmol (internal Figma-like tool).',
});
ok('offer context keeps Figmol when the source names it', /Figmol/i.test(figmolReq.user));
ok('answer body drops the question header', /Edenred/.test(extractAnswerBody('## Acme — Designer\n**Question:** Tell us\n\nI shipped Edenred.')) && !/Question/.test(extractAnswerBody('## Acme — Designer\n**Question:** Tell us\n\nI shipped Edenred.')));

const calls = [];
const written = await writeFormAnswer({
  question: 'Tell us about a product you shipped.',
  company: 'Acme',
  role: 'Designer',
  career: '- Edenred: designed the locator apps',
  voice: '',
  complete: async ({ user }) => {
    calls.push(user);
    if (calls.length === 1) return "Je n'ai pas conçu ça.";
    return 'I shipped the locator apps at Edenred. I owned the driver flows. The work covered finding a station.';
  },
});

ok('a denial in the wrong language is rewritten once', calls.length === 2);
ok('both calls share the career and the english rules', calls.every(user => user.includes('Edenred') && user.includes('English only')));
ok('the kept answer is the rewrite', /Edenred/.test(written.answer) && !/Je n'ai pas/.test(written.answer));
ok('a denial stored in the report is not reused', !bestAnswerFor(
  'Tell us about the mobile product you designed',
  [{ question: 'Tell us about the mobile product you designed', answer: "Je n'ai pas conçu de produit mobile." }],
));

const proofNames = extractProofNames('- Senior Product Designer : Edenred (2023 – 2024): Designed mobile apps.\n- Founder & Head of Product Design : Agence V0: Casino, Spar and Vival: retail mobile apps.');
ok('proof names come from employers and product labels', proofNames.includes('Edenred') && proofNames.includes('Casino') && proofNames.includes('Agence V0') && !proofNames.includes('Senior Product Designer'));
ok('a tool list misses the closest proof', answerMissesProof('I used Cursor and Claude on GitHub.', '- Senior Product Designer : Edenred: Designed mobile apps.'));
ok('naming the closest product is enough', !answerMissesProof('At Edenred I designed the locator apps.', '- Senior Product Designer : Edenred: Designed mobile apps.'));
ok('a tool dump is flagged on a product question', isToolDump('Tell us about a mobile product', 'I use Cursor, Claude and GitHub every day.'));
ok('an AI question may name the tools', !isToolDump('Have you used AI in your design process?', 'At OneAsset I use Cursor and GitHub with engineering.'));

const toolCalls = [];
const tooled = await writeFormAnswer({
  question: 'Tell us about the mobile product you designed',
  company: 'Acme',
  role: 'Designer',
  career: '- Senior Product Designer : Edenred: Designed mobile apps for gas station location.',
  complete: async () => {
    toolCalls.push(1);
    if (toolCalls.length === 1) return 'I use Cursor and GitHub to prototype quickly.';
    return 'At Edenred I designed the locator apps. Drivers needed a station nearby. I owned the map and the filters. Finding a station got faster.';
  },
});
ok('a tool dump without a product is rewritten once', toolCalls.length === 2 && /Edenred/.test(tooled.answer) && !/Cursor/.test(tooled.answer));

const kpiReq = formAnswerRequest({
  question: 'Tell us about a product you shipped.',
  company: 'Acme',
  role: 'Designer',
  career: '- Senior Product Designer : Société Générale: Designed savings flows. Drove +12% investment activity.\n- Founder : Agence V0: Delivered 20+ client projects, generating ~€400K.',
});
ok('career context drops copied KPIs', /Société Générale/.test(kpiReq.user) && /savings flows/.test(kpiReq.user) && !/\+12%/.test(kpiReq.user) && !/€400K/.test(kpiReq.user) && !/20\+/.test(kpiReq.user));
const titledKpi = formAnswerRequest({
  question: 'Tell us about a product you shipped.',
  company: 'Acme',
  role: 'Designer',
  career: '- Product Designer / Product Manager : UpViral (Jul 2024 – Dec 2025): SaaS marketing platform, about 10,000 users. Led a complete SaaS overhaul.',
});
ok('kpi strip keeps the employer title', /UpViral \(Jul 2024 – Dec 2025\)/.test(titledKpi.user) && /Led a complete SaaS overhaul/.test(titledKpi.user) && !/10,000/.test(titledKpi.user));

const kpiWritten = await writeFormAnswer({
  question: 'Tell us about a product you shipped.',
  company: 'Acme',
  role: 'Designer',
  career: '- Senior Product Designer : Société Générale: Designed savings flows.',
  complete: async () => 'At Société Générale I designed the savings flows. Drove +12% investment activity. The path stayed usable.',
});
ok('a KPI sentence is dropped from the answer', /Société Générale/.test(kpiWritten.answer) && /usable/.test(kpiWritten.answer) && !/\+12%/.test(kpiWritten.answer));

ok('JobYouGo is not a form-answer proof', usesSideProjectAsProof(
  'Tell us about one mobile feature you shipped',
  'I led a privacy-focused search shortcut in my personal app jobyougo.xyz, from research to launch on iOS and Android.',
  ['JobYouGo'],
));

const sideReq = formAnswerRequest({
  question: 'Tell us about one mobile feature you personally drove from insight through launch.',
  company: 'Mozilla',
  role: 'Designer',
  career: '- Senior Product Designer : Edenred: Designed mobile apps for gas station location.\n- JobYouGo (jobyougo.xyz) : Builder: Personal portfolio and completes applications.',
});
ok('a mobile request keeps Edenred and drops JobYouGo', /Edenred/.test(sideReq.user) && sideReq.closest.every((line) => !/JobYouGo/i.test(line)) && !/## Full career[\s\S]*JobYouGo/i.test(sideReq.user.split('WRITING:')[0]));

const sideCalls = [];
const sideWritten = await writeFormAnswer({
  question: 'Tell us about one mobile feature you personally drove from insight through launch.',
  company: 'Mozilla',
  role: 'Designer',
  career: '- Senior Product Designer : Edenred: Designed mobile apps for gas station location.\n- JobYouGo (jobyougo.xyz) : Builder: Personal portfolio and completes applications.',
  complete: async () => {
    sideCalls.push(1);
    if (sideCalls.length === 1) {
      return 'I led the end-to-end development of a privacy-focused search shortcut in my personal app jobyougo.xyz, from user research to launch on iOS and Android.';
    }
    return 'At Edenred I designed the locator apps. Drivers needed a station nearby. I owned the map and the filters. Finding a station got clearer.';
  },
});
ok('a JobYouGo draft is rewritten to an employer', sideCalls.length === 2 && /Edenred/.test(sideWritten.answer) && !/jobyougo/i.test(sideWritten.answer));

const leakReq = formAnswerRequest({
  question: 'Tell us about a product you shipped.',
  company: 'Mozilla',
  role: 'Designer',
  career: '- Senior Product Designer : Edenred: Designed mobile apps.\n- JobYouGo (jobyougo.xyz) : Builder: Personal portfolio.',
  facts: 'Website: https://jobyougo.xyz/portfolio',
  offerContext: 'The report cites JobYouGo as automation.',
});
ok('facts and offer redact JobYouGo on experience questions', !/JobYouGo/i.test(leakReq.user.split('WRITING:')[0]));

const scaleDigest = [
  '| Fact | Value |',
  '| --- | --- |',
  '| Société Générale customer scale | millions of customers |',
  '| UpViral users | about 10,000 users |',
  '| Creads.io users | 1,200 registered users |',
].join('\n');
const scaleReq = formAnswerRequest({
  question: 'What was the scale of the product you manage—approximately how many active users or customers does it serve?',
  company: 'Mozilla',
  role: 'Designer',
  career: '- Senior Product Designer : Société Générale: Retail banking.\n- Creads.io : Founder: Brand Agent pipeline.',
  digest: scaleDigest,
});
ok('a scale request includes the documented user counts', /10,000/.test(scaleReq.user) && /millions/.test(scaleReq.user) && /Société Générale/.test(scaleReq.user));
const scaleWritten = await writeFormAnswer({
  question: 'What was the scale of the product you manage—approximately how many active users or customers does it serve?',
  company: 'Mozilla',
  role: 'Designer',
  career: '- Product Designer : UpViral: SaaS marketing platform.',
  complete: async () => 'At UpViral I owned the SaaS overhaul. The live product served about 10,000 users.',
});
ok('a scale answer may keep the documented user count', /10,000/.test(scaleWritten.answer) && /UpViral/.test(scaleWritten.answer));

const firefoxStory = 'I led the end-to-end launch of a privacy-focused search shortcut in the Firefox mobile app, owning the user research, feature definition, and cross-team execution. I decided to prioritize contextual search suggestions based on user intent rather than tracking history, ensuring alignment with Mozilla’s mission. The feature shipped as a more intuitive, transparent way to access search, improving clarity and trust in the user experience.';
ok('a Firefox story is invented work at the hiring company', claimsUnworkedBrand(firefoxStory, { company: 'Mozilla', allowed: ['Edenred'] }));
ok('Firefox for iOS is invented hiring-company work', claimsUnworkedBrand(
  'I led the end-to-end development of a privacy-focused search shortcut in Firefox for iOS, owning the product vision.',
  { company: 'Mozilla', allowed: ['Edenred'] },
));
ok('an Edenred story is not invented hiring-company work', !claimsUnworkedBrand('At Edenred I designed the locator apps.', { company: 'Mozilla', allowed: ['Edenred'] }));
ok('wanting the role is not invented work', !claimsUnworkedBrand('I want to work at Mozilla because I shipped locator apps at Edenred.', { company: 'Mozilla', allowed: ['Edenred'] }));
ok('a stored Firefox story is not reused', !bestAnswerFor(
  'Tell us about one mobile feature you personally drove from insight through launch.',
  [{ question: 'Tell us about one mobile feature you personally drove from insight through launch.', answer: firefoxStory }],
  new Set(),
  [],
  { company: 'Mozilla', allowedNames: ['Edenred'] },
));
const firefoxReq = formAnswerRequest({
  question: 'Tell us about one mobile feature you personally drove from insight through launch.',
  company: 'Mozilla',
  role: 'Designer',
  career: '- Senior Product Designer : Edenred: Designed mobile apps for gas station location.',
});
ok('a Mozilla question forbids inventing work there', /applying to Mozilla/.test(firefoxReq.user) && /did not work at Mozilla/.test(firefoxReq.user) && /Closest matches/.test(firefoxReq.user));
const firefoxWritten = await writeFormAnswer({
  question: 'Tell us about one mobile feature you personally drove from insight through launch.',
  company: 'Mozilla',
  role: 'Designer',
  career: '- Senior Product Designer : Edenred: Designed mobile apps for gas station location.',
  complete: async () => firefoxStory,
});
ok('an invented Firefox draft is replaced by the employer', /Edenred/.test(firefoxWritten.answer) && !/Firefox|Mozilla/i.test(firefoxWritten.answer));
