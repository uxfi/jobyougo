import { readFileSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';
import {
  assembleUiPrompt,
  clipJd,
  clipReportForWriting,
  candidateFacts,
  closestCareerLines,
  compactCv,
  compactPipeline,
  compactProfile,
  compactTracker,
  documentedScaleFacts,
  experienceYearsFromText,
  experienceIndex,
  indexCareer,
  languagesFromText,
  roleTenureYears,
  isFactualQuestion,
  isMotivationQuestion,
  isScaleQuestion,
  questionLanguage,
  questionPromptEn,
  questionPromptFr,
} from '../lib/prompt-budget.mjs';

function ok(label, cond) {
  if (cond) pass(label);
  else {
    fail(label);
    throw new Error(label);
  }
}

const cv = readFileSync(join(ROOT, 'cv.md'), 'utf8');
const profile = readFileSync(join(ROOT, 'modes/_profile.md'), 'utf8');
const shared = readFileSync(join(ROOT, 'modes/_shared.md'), 'utf8');
const oferta = readFileSync(join(ROOT, 'modes/oferta.md'), 'utf8');

const leanCv = compactCv(cv);
ok('compact CV is shorter than the source', leanCv.length < cv.length * 0.6);
ok('compact CV keeps OneAsset and LVMH', /OneAsset/.test(leanCv) && /LVMH/.test(leanCv));
ok('compact CV keeps the skills block', /Prompt engineering/.test(leanCv));
ok('career years come from the CV figure', experienceYearsFromText(cv) === 12 && experienceYearsFromText('Designer with 8 years of experience') === 8 && experienceYearsFromText('no count') === null);

const leanProfile = compactProfile(profile);
ok('profile extract keeps the location policy', /Location Policy/i.test(leanProfile));
ok('profile extract drops the writing-style section', !/^## Writing Style/m.test(leanProfile));

const longJd = `${'Requirements\n'.repeat(400)}hybrid 3 days/week in London office. Salary 80k.`;
const clipped = clipJd(longJd, 2500);
ok('long JD keeps a tail that carries attendance language', /hybrid 3 days/.test(clipped));
ok('long JD head is capped', clipped.length < longJd.length);

const report = `# Evaluation\n\n## A) Résumé du rôle\nRemote product design.\n\n## Job Description (archived verbatim)\n${'lorem '.repeat(800)}\n\n## B) Match CV\nFigma.\n`;
const leanReport = clipReportForWriting(report, 2000);
ok('writing context drops the archived JD', !/lorem/.test(leanReport));
ok('writing context keeps the match section', /Match CV/.test(leanReport));

const assembled = assembleUiPrompt({
  mode: 'pipeline',
  shared,
  modeFile: oferta,
  cv,
  profile,
  profileConfig: 'spend_tier: standard\n',
  criteria: '### Hard Matching Rules\n- Full remote only: yes',
  articleDigest: 'digest should stay out of eval',
  prefetch: '## Job Description\nSenior Product Designer, fully remote.',
});
ok('eval system is the short contract, not oferta.md', assembled.systemPrompt.includes('## B) Match CV') && !assembled.systemPrompt.includes('Block E'));
ok('eval user prompt does not include the digest', !assembled.parts.join('\n').includes('digest should stay out'));
ok('eval prompt is under half the raw context', assembled.afterChars < assembled.beforeChars / 2);
const evalText = assembled.parts.join('\n');
ok('eval ends with confirmed CV facts', /Faits confirmés du CV/.test(evalText) && /Figma \(10\/10\)/.test(evalText) && /12/.test(candidateFacts(cv)));
ok('eval profile omits form-answer rules', !/Form answers/.test(evalText) && !/Evidence order/.test(evalText));

const question = assembleUiPrompt({
  mode: 'question',
  shared,
  modeFile: 'question mode playbook '.repeat(200),
  cv,
  profile,
  criteria: 'remote',
  prefetch: report,
});
ok('question system is not _shared.md', question.systemPrompt.length < 500);
ok('question prefetch drops the archived JD', !question.parts.join('\n').includes('lorem'));
ok('question profile still carries form-answer rules', /Form answers|Evidence order/i.test(question.parts.join('\n')));
ok('question prompt lists later roles from the full career', /Edenred/.test(question.parts.join('\n')) && /Casino/.test(question.parts.join('\n')) && /SNCF|France Télévisions/.test(question.parts.join('\n')));
const career = experienceIndex(cv);
ok('career index lists employers before side projects', career.indexOf('Product Lead : OneAsset') < career.indexOf('Creads.io : Founder') && career.indexOf('Edenred') < career.indexOf('Creads.io : Founder'));
ok('career index keeps a second bullet when it names the product', /locator apps/.test(career) && /iOS and Android/.test(career));
const mobileHits = closestCareerLines('Tell us about the mobile product you designed', career);
ok('closest matches surface the mobile roles', mobileHits.some((line) => /Edenred/i.test(line)) && mobileHits.some((line) => /Casino|France Télévisions/i.test(line)));
ok('closest matches skip skill bullets', mobileHits.every((line) => !/^-\s+Workshops,/.test(line)));
ok('closest matches skip JobYouGo and other side projects', mobileHits.every((line) => !/JobYouGo|Creads|UXfi|Flemme|Jarvos/i.test(line)));
const mozillaMobile = closestCareerLines(
  'Tell us about one mobile feature or improvement you personally drove from insight through launch. What did you own, and what measurable impact did it have?',
  career,
);
ok('a mobile-feature question ranks shipped apps before current work',
  mozillaMobile.some((line) => /Edenred|Casino/i.test(line))
  && mozillaMobile.every((line) => !/Vloggy/i.test(line))
  && mozillaMobile.findIndex((line) => /Edenred|Casino/i.test(line))
    < (mozillaMobile.findIndex((line) => /OneAsset/i.test(line)) === -1 ? 99 : mozillaMobile.findIndex((line) => /OneAsset/i.test(line))));
const bankHits = closestCareerLines('Parlez-nous d une experience en banque ou finance.', career);
ok('a finance question surfaces the bank roles', bankHits.some((line) => /Société Générale|Banque Populaire/i.test(line)));
const aiHits = closestCareerLines('Have you used AI in your design process?', career);
ok('an AI question surfaces the employer AI role', aiHits.some((line) => /OneAsset/i.test(line)));
ok('an AI question does not use a side project as closest proof', aiHits.every((line) => !/UXfi|Creads|JobYouGo|Flemme|Jarvos/i.test(line)));
const indexed = indexCareer(cv);
ok('career index treats independent-only names as side products', indexed.sideNames.some((name) => /JobYouGo|Creads/i.test(name)) && !indexed.sideNames.some((name) => /Edenred|Vloggy|Société Générale/i.test(name)));
ok('a name in both sections stays an employer', indexed.employers.some((line) => /Vloggy/i.test(line)) && !indexed.sideNames.some((name) => /Vloggy/i.test(name)));
ok('career text does not repeat an employer as a personal product', /Co-founder : Vloggy/.test(indexed.text) && !/ceased operations/.test(indexed.text));
ok('a same-year month range counts as a short role', roleTenureYears('Shiseido Group (Feb – Jun 2024)') === 0.5);
const proudHits = closestCareerLines('Describe a project you are proud of.', career, 6, indexed);
ok('a generic question falls back to longer professional roles',
  proudHits.some((line) => /Agence V0/i.test(line))
  && proudHits.findIndex((line) => /Agence V0/i.test(line))
    < (proudHits.findIndex((line) => /OneAsset/i.test(line)) === -1 ? 99 : proudHits.findIndex((line) => /OneAsset/i.test(line))));
const otherCv = [
  '### Professional Experience',
  '',
  '#### Product Designer : Northwind (2022 – 2024)',
  '*Consumer iOS app, 50,000 users.*',
  '- Designed the iOS checkout.',
  '',
  '### Independent products',
  '',
  '#### Sidekit : Founder (2024 – Present)',
  '*Personal habit tracker, 80 users.*',
  '- Built a habit tracker.',
].join('\n');
const other = indexCareer(otherCv);
ok('another CV derives side names from Independent products', other.sideNames.includes('Sidekit') && !other.sideNames.includes('Northwind'));
const otherHits = closestCareerLines('Tell us about a mobile product you designed', other.text, 6, other);
ok('another CV uses the employer as mobile proof', otherHits.some((line) => /Northwind/i.test(line)) && otherHits.every((line) => !/Sidekit/i.test(line)));
const otherScale = documentedScaleFacts({
  digest: '| Fact | Value |\n| --- | --- |\n| Northwind users | 50,000 users |\n| Sidekit users | 80 users |',
  employers: other.employers,
  sideNames: other.sideNames,
});
ok('scale facts keep employer counts and demote independent products', /50,000/.test(otherScale) && /not the employer-scale proof/i.test(otherScale) && !/80 users/.test(otherScale));
const tenureCv = indexCareer([
  '### Professional Experience',
  '',
  '#### Designer : ShortCo (2025 – Present)',
  '*Consumer iOS app.*',
  '- Designed the iOS checkout.',
  '',
  '#### Designer : LongCo (2018 – 2024)',
  '*Consumer iOS app.*',
  '- Designed the iOS checkout.',
  '',
  '### Independent products',
  '',
  '#### Homestack : Founder (2021 – Present)',
  '*Personal iOS habit tracker.*',
  '- Designed the iOS checkout.',
].join('\n'));
const tenureHits = closestCareerLines('Tell us about a mobile product you designed', tenureCv.text, 6, tenureCv);
ok('a longer professional role ranks before a short one when both match',
  tenureHits.findIndex((line) => /LongCo/i.test(line)) < tenureHits.findIndex((line) => /ShortCo/i.test(line)));
ok('an unnamed independent product stays out of closest matches', tenureHits.every((line) => !/Homestack/i.test(line)));
const namedSideHits = closestCareerLines('What did you ship on Homestack?', tenureCv.text, 6, tenureCv);
ok('a named independent product may appear', namedSideHits.some((line) => /Homestack/i.test(line)));
const frenchCv = indexCareer([
  '### Expérience professionnelle',
  '',
  '#### Designer : Nordvent (2022 – 2024)',
  '*Application iOS, 12 000 utilisateurs.*',
  '- Designed the iOS checkout.',
  '',
  '### Projets personnels',
  '',
  '#### Sidekit : Founder (2024 – Present)',
  '*Tracker personnel.*',
  '- Built a habit tracker.',
].join('\n'));
ok('a french CV still splits employers from personal projects', frenchCv.employerNames.includes('Nordvent') && frenchCv.sideNames.includes('Sidekit'));
const frenchHits = closestCareerLines('Parlez-nous d une application mobile', frenchCv.text, 6, frenchCv);
ok('a french CV uses the professional role as mobile proof', frenchHits.some((line) => /Nordvent/i.test(line)) && frenchHits.every((line) => !/Sidekit/i.test(line)));
ok('salary stays a factual question', isFactualQuestion('Salary expectations') && !isFactualQuestion('Tell us about a product you designed') && !isFactualQuestion('Have you used AI in your design process?'));
ok('a fluency question is factual, not a career essay', isFactualQuestion('Are you fluent in French?') && isFactualQuestion('Do you speak Spanish?'));
const langs = languagesFromText(cv);
ok('the CV languages section is parsed', langs.some((l) => /french/i.test(l.name) && /native/i.test(l.level)) && langs.some((l) => /english/i.test(l.name)));
ok('career index carries spoken languages', indexCareer(cv).languages.some((l) => /french/i.test(l.name)));
ok('a user-count question is a scale question', isScaleQuestion('What was the scale of the product you manage—approximately how many active users or customers does it serve?') && !isScaleQuestion('Tell us about one mobile feature you shipped'));
ok('why-us is a motivation question', isMotivationQuestion('Why are you interested in this role?') && !isMotivationQuestion('Tell us about a product you designed'));
ok('fit and cover letter are motivation questions', isMotivationQuestion('What makes you a good fit for this position?') && isMotivationQuestion('Cover letter'));
ok('motivation instructions start from the offer, not a canned employer opener', /One detail from the offer/.test(questionPromptEn({ question: 'Why do you want to work at Acme?', company: 'Acme', role: 'Designer', voice: '' })) && !/First sentence: an employer/.test(questionPromptEn({ question: 'Why do you want to work at Acme?', company: 'Acme', role: 'Designer', voice: '' })));

const enQuestion = 'Tell us about the product you are most proud of designing. What problem were you solving?';
const frQuestion = 'Décrivez une expérience dont vous êtes fier et le problème que vous résolviez.';
const enPrompt = questionPromptEn({ question: enQuestion, company: 'Acme', role: 'Designer', voice: 'short' });
const frPrompt = questionPromptFr({ question: frQuestion, company: 'Acme', role: 'Designer', voice: 'court' });
ok('english question instructions stay in english', /English only/.test(enPrompt) && /First sentence/.test(enPrompt) && !/français uniquement/.test(enPrompt));
ok('narrative instructions ban KPIs', /No number/.test(enPrompt) && /Aucun chiffre/.test(frPrompt));
ok('narrative instructions keep the offer off the career', /Closest matches/.test(enPrompt) && /did not work at Acme/.test(enPrompt));
ok('french question instructions stay in french', /français uniquement/.test(frPrompt) && /Première phrase/.test(frPrompt));
ok('a factual question stays a short value', /valeur seule|bare value/.test(questionPromptEn({ question: 'Salary expectations', company: 'Acme', role: 'Designer', voice: '' })) && !/First sentence/.test(questionPromptEn({ question: 'Salary expectations', company: 'Acme', role: 'Designer', voice: '' })));
ok('question language follows the question', questionLanguage(enQuestion) === 'en' && questionLanguage(frQuestion) === 'fr');

const tracker = [
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|',
  '| 1 | 2026-09-01 | Acme | Designer | 4.2/5 | Applied | ❌ | [1](reports/1.md) | long note |',
  '| 2 | 2026-09-02 | Other | PM | 3.1/5 | Evaluated | ❌ | [2](reports/2.md) | |',
].join('\n');
const leanTracker = compactTracker(tracker);
ok('tracker keeps the live application and drops the report link', /Acme/.test(leanTracker) && !/reports\/1/.test(leanTracker));
ok('tracker counts the evaluated row without listing it', /Evaluated 1/.test(leanTracker) && !/Other/.test(leanTracker));

const inbox = `- [ ] https://jobs.example/1 | Sierra | Engineer | Singapore · London · Berlin · Paris | posted: 2026-01-01 | location: unclear — no signal\n`.repeat(30);
const leanInbox = compactPipeline(inbox, 5);
ok('pipeline inbox keeps a short extract and a remainder count', /URL en attente/.test(leanInbox) && /25 autres/.test(leanInbox) && !/Singapore · London/.test(leanInbox));

const pdf = assembleUiPrompt({
  mode: 'pdf',
  shared,
  modeFile: oferta,
  cv,
  profile,
  criteria: 'remote',
});
ok('pdf system is the marker contract', pdf.systemPrompt.includes('### SUMMARY_TEXT') && !pdf.systemPrompt.includes('Block E'));
ok('pdf uses the compact CV', pdf.parts.join('\n').includes('Prompt engineering') && pdf.afterChars < cv.length + 8000);
