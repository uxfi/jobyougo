// Two quality defects the 2026-10-31 bench (13 drafts, Qwen, current code) still showed:
//  - every matched email opened with the same formula ("Your Product Designer
//    opening at X is about Y. You need someone who…", 5 of 13), because the
//    prompt showed one fixed example and Qwen copies the example it is shown;
//  - 7 of 13 drafts kept a sentence copied from the CV, and the full-email
//    repair pass left it as it was.
// The example now rotates with the offer; a copied sentence is reworded alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  auditApplicationEmail,
  buildApplicationEmailMessages,
  buildCopyRewritePrompt,
  copiedSentences,
  copyRewriteProblem,
  generateApplicationEmail,
  hookStyleFor,
  isCopiedFromSource,
  parseCopyRewrite,
  parseRecipient,
} from '../lib/application-email.mjs';

const PROFILE = { candidate: { full_name: 'Hugo Vermot', linkedin: 'linkedin.com/in/hugovermot', portfolio_url: 'https://jobyougo.xyz/portfolio' } };
const CV = [
  '# Hugo Vermot', '**Location:** Full remote', '',
  '## Summary',
  'Senior Product Designer with 12 years across consumer apps, SaaS platforms and financial services. I am looking to move into a new contract or CDI role, fully remote.', '',
  '## Experience',
  '### OneAsset - Senior Product Designer / Product Lead', 'Feb 2026 - Present',
  '- Shipped a regulated fintech platform: investor app, admin panel, marketing site and an OTC product in six months with one Product Owner.',
  '- Ran user interviews and designed complex journeys with engineering.',
  '### Creads.io - Founder', '2022 - 2025',
  '- Built a bootstrapped AI advertising SaaS with 1,200 registered users and 20 paying clients.',
].join('\n');
const COPIED = 'I shipped the investor app, admin panel, marketing site and an OTC product in six months with one Product Owner.';
const JOB = 'Product Designer\nAcme. Remote.\nWe need user research and operations tools for SaaS.';

// ── the hook example rotates with the offer ─────────────────────────────────

test('hookStyleFor is stable per offer, reaches every style, and keeps the original wording for no seed', () => {
  assert.equal(hookStyleFor('Acme|Product Designer'), hookStyleFor('Acme|Product Designer'));
  const seen = new Set();
  for (let i = 0; i < 40; i += 1) seen.add(hookStyleFor(`Company ${i}|Product Designer`).one.en);
  assert.equal(seen.size, 3, 'three different hooks are in use');
  assert.equal(hookStyleFor('').one.en, 'Your Product Designer opening at [company] is about [that thing].');
  assert.equal(hookStyleFor('').two.en, 'You need someone who has [need 1] and can [need 2].');
});

test('the matched prompt shows the offer\'s own hook example and no other', () => {
  const matches = [{ need: 'User research', proof: 'Ran interviews with real customers.', employer: 'UpViral', role: 'Product Designer', dates: '2024', score: 5 }];
  const systemFor = companyHint => buildApplicationEmailMessages({ cv: '# CV', profileData: PROFILE, jobText: 'We need a product designer for operations tools.', matches, roleHint: 'Product Designer', companyHint }).system;
  const byStyle = new Map();
  for (let i = 0; i < 40 && byStyle.size < 3; i += 1) {
    const company = `Company ${i}`;
    const style = hookStyleFor(`${company}|Product Designer`);
    if (!byStyle.has(style)) byStyle.set(style, systemFor(company));
  }
  assert.equal(byStyle.size, 3);
  const styles = [...byStyle.keys()];
  for (const [style, system] of byStyle) {
    assert.ok(system.includes(`"${style.one.en}"`) && system.includes(`"${style.one.fr}"`), 'sentence 1 example, English and French');
    assert.ok(system.includes(`"${style.two.en}"`) && system.includes(`"${style.two.fr}"`), 'sentence 2 example, English and French');
    for (const other of styles.filter(item => item !== style)) assert.ok(!system.includes(other.one.en), 'the other hooks are not shown');
    assert.match(system, /the HOOK/);
    assert.match(system, /Never recap the posting/);
    assert.match(system, /Paragraph 2 \(2-3 sentences, 65 words at most\)/);
  }
});

test('no hook style trips the audit (posting recap, hollow link, repeated opening), in English or French', () => {
  const fill = (text, role) => text
    .replace('[company]', 'Acme').replace('[Company]', 'Acme').replace('[role]', role)
    .replace('[that thing]', 'les outils des équipes terrain').replace('[do that thing]', 'build tools for field teams')
    .replace('[need 1]', 'user research').replace('[need 2]', 'design systems');
  const frFill = text => fill(text, 'Product Designer');
  for (let i = 0; i < 40; i += 1) {
    const style = hookStyleFor(`Company ${i}|Product Designer`);
    for (const language of ['en', 'fr']) {
      const hook = `${fill(style.one[language], 'Product Designer')} ${fill(style.two[language], 'Product Designer')}`;
      const body = ['Hello,', hook, language === 'fr' ? 'J’ai mené des entretiens utilisateurs avec les équipes techniques.' : 'I ran user interviews with engineering.', 'My CV is attached. Can we talk this week?', 'Best,\nHugo Vermot'].join('\n\n');
      const issues = auditApplicationEmail({ subject: 'Product Designer - Hugo Vermot', body, language }, {})
        .filter(issue => /Résumé de l'annonce|Formule|Même début|Ouverture mise en scène|Variable non remplacée/.test(issue));
      assert.deepEqual(issues, [], `${language}: ${hook}`);
    }
  }
  assert.ok(frFill);
});

// ── a copied sentence is reworded on its own ────────────────────────────────

test('copiedSentences and isCopiedFromSource agree with the audit', () => {
  const body = `Hello,\n\nYour Product Designer opening at Acme is about operations tools.\n\n${COPIED} I ran interviews with engineering teams every week.\n\nMy CV is attached.\n\nBest,\nHugo Vermot`;
  assert.deepEqual(copiedSentences(body, { copySource: CV }), [COPIED]);
  assert.equal(isCopiedFromSource(COPIED, { copySource: CV }), true);
  assert.equal(isCopiedFromSource('With one Product Owner, I took the investor app, admin panel, marketing site and OTC product live in six months.', { copySource: CV, minCopyWords: 12 }), false);
  assert.deepEqual(copiedSentences(body, { copySource: '' }), []);
  const issue = auditApplicationEmail({ subject: 'Product Designer - Hugo Vermot', body, language: 'en' }, { copySource: CV }).find(item => /Phrase recopiée du CV/.test(item));
  assert.ok(issue && issue.includes(COPIED.slice(0, 80)));
});

test('parseCopyRewrite keeps the sentence, not the label, quotes or comments', () => {
  assert.equal(parseCopyRewrite('With one Product Owner, I took it live in six months.'), 'With one Product Owner, I took it live in six months.');
  assert.equal(parseCopyRewrite('Rewritten sentence: "I took it live in six months."'), 'I took it live in six months.');
  assert.equal(parseCopyRewrite('```\n“Je l’ai livré en six mois.”\n```\nNote: same facts.'), 'Je l’ai livré en six mois.');
  assert.equal(parseCopyRewrite(''), '');
  assert.equal(parseCopyRewrite(null), '');
  const prompt = buildCopyRewritePrompt({ sentence: COPIED, language: 'fr' });
  assert.match(prompt, /repeats the candidate's CV word for word/);
  assert.match(prompt, /French, with vouvoiement/);
  assert.ok(prompt.endsWith(`SENTENCE: ${COPIED}`));
});

test('copyRewriteProblem accepts a faithful rewording and refuses anything that changes the facts', () => {
  const next = 'With one Product Owner, I took the investor app, admin panel, marketing site and OTC product live in six months.';
  assert.equal(copyRewriteProblem(COPIED, next), '');
  const problem = text => copyRewriteProblem(COPIED, text, { unnamedEmployers: ['OneAsset'] });
  assert.equal(problem(''), 'empty');
  assert.equal(problem('Shipped it.'), 'length');
  assert.equal(problem(COPIED), 'unchanged');
  assert.equal(problem('I took the investor app live in six months. I did it with one Product Owner.'), 'several sentences');
  assert.equal(problem('With one Product Owner: I took the investor app, admin panel and OTC product live in six months.'), 'punctuation');
  assert.equal(problem('With one Product Owner, I took the investor app, admin panel and OTC product live in 4 months.'), 'figure');
  assert.equal(problem('With one Product Owner, I took the investor app, admin panel and OTC product live in four months.'), 'figure');
  assert.equal(problem('With two Product Owners, I took the investor app, admin panel and OTC product live in six months.'), 'figure');
  assert.equal(copyRewriteProblem('J’ai livré l’application en six mois avec un Product Owner.', 'Avec un Product Owner, j’ai mis l’application en ligne en six mois.'), '');
  assert.equal(copyRewriteProblem('J’ai livré l’application en six mois avec un Product Owner.', 'Avec un Product Owner, j’ai mis l’application en ligne en quatre mois.'), 'figure');
  assert.equal(problem('With one Product Owner, I took the investor app, admin panel and OTC product live for Stripe in six months.'), 'name');
  assert.equal(problem('With one Product Owner, I took the investor app, admin panel and OTC product live in six months using Figma.'), 'name');
  assert.equal(problem('With one Product Owner, I took the investor app, admin panel and OTC product live in six months using figma.'), 'tool');
  assert.equal(problem('With one Product Owner, I took the investor app, admin panel and OTC product live in six months at OneAsset.'), 'name');
  assert.equal(copyRewriteProblem('At OneAsset I ran the product team.', 'I ran the product team there every day, owning the roadmap.', { unnamedEmployers: ['OneAsset'] }), '');
  assert.equal(copyRewriteProblem('In my current role, I shipped the investor app in six months.', 'The investor app went live in six months under my lead.'), 'mask');
  assert.equal(copyRewriteProblem('In my current role, I shipped the investor app in six months.', 'In my current role, I took the investor app live in six months.'), '');
  // Figures keep their form: "1,200 users" stays "1,200 users".
  assert.equal(copyRewriteProblem('I built a SaaS with 1,200 registered users.', 'My SaaS reached 1,200 registered users.'), '');
  assert.equal(copyRewriteProblem('I built a SaaS with 1,200 registered users.', 'My SaaS reached 1200 registered users.'), 'figure');
});

function mainEmail(body) {
  return `COMPANY: Acme\nROLE: Product Designer\nLANGUAGE: en\nSUBJECT: Product Designer at Acme - Hugo Vermot\nBODY:\n${body}`;
}
function run(chat) {
  return generateApplicationEmail({ chat, model: 'x', cv: CV, compactedCv: CV, profileData: PROFILE, jobText: JOB, language: 'en', roleHint: 'Product Designer', companyHint: 'Acme', recipient: parseRecipient('jobs@acme.com'), matcher: 'rules' });
}
const COPY_BODY = [
  'Hello,',
  'Your Product Designer opening at Acme is about operations tools. You need someone who runs user research.',
  `${COPIED} Interviews with real users shaped the journeys I designed alongside the engineers.`,
  'My CV is attached. Could we talk this week?',
].join('\n\n');
const isRewriteCall = args => /repeats the candidate's CV word for word/.test(String(args?.messages?.[0]?.content || ''));

test('end to end: a sentence the repair pass leaves copied is reworded alone and the copy issue goes', async () => {
  const calls = [];
  const draft = await run(async args => {
    calls.push(args);
    return isRewriteCall(args) ? 'With one Product Owner, I took the investor app, admin panel, marketing site and OTC product live in six months.' : mainEmail(COPY_BODY);
  });
  assert.equal(calls.filter(isRewriteCall).length, 1, 'one rewrite call');
  assert.match(calls.find(isRewriteCall).messages[0].content, /SENTENCE: I shipped the investor app/);
  assert.doesNotMatch(draft.body, /I shipped the investor app, admin panel, marketing site and an OTC product in six months with one Product Owner/);
  assert.match(draft.body, /With one Product Owner, I took the investor app, admin panel, marketing site and OTC product live in six months\./);
  assert.match(draft.body, /Interviews with real users shaped the journeys I designed alongside the engineers\./, 'the other sentences stay');
  assert.doesNotMatch(draft.issues.join('\n'), /Phrase recopiée/);
});

test('end to end: a rewording that changes a figure is refused, the sentence and its issue stay', async () => {
  const calls = [];
  const draft = await run(async args => {
    calls.push(args);
    return isRewriteCall(args) ? 'With one Product Owner, I shipped four products in six months.' : mainEmail(COPY_BODY);
  });
  assert.equal(calls.filter(isRewriteCall).length, 1);
  assert.match(draft.body, /I shipped the investor app, admin panel, marketing site and an OTC product in six months with one Product Owner\./);
  assert.doesNotMatch(draft.body, /four products/);
  assert.match(draft.issues.join('\n'), /Phrase recopiée du CV/);
});

test('end to end: a failing rewrite call leaves the draft as it was', async () => {
  const draft = await run(async args => {
    if (isRewriteCall(args)) throw new Error('model unavailable');
    return mainEmail(COPY_BODY);
  });
  assert.match(draft.body, /I shipped the investor app, admin panel, marketing site and an OTC product in six months with one Product Owner\./);
  assert.match(draft.issues.join('\n'), /Phrase recopiée du CV/);
});

test('end to end: nothing is copied, no rewrite call is made', async () => {
  const body = [
    'Hello,',
    'Your Product Designer opening at Acme is about operations tools. You need someone who runs user research.',
    'I built a fintech platform with a Product Owner over six months, covering the investor app and the admin panel. Interviews with real users shaped the journeys I designed alongside the engineers.',
    'My CV is attached. Could we talk this week?',
  ].join('\n\n');
  const calls = [];
  const draft = await run(async args => { calls.push(args); return mainEmail(body); });
  assert.equal(calls.filter(isRewriteCall).length, 0);
  assert.doesNotMatch(draft.issues.join('\n'), /Phrase recopiée/);
});
