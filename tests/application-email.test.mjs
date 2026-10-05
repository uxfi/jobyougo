import test from 'node:test';
import assert from 'node:assert/strict';
import {
  auditApplicationEmail,
  buildApplicationEmailPrompt,
  describeUngroundedClaim,
  extractOutreachRules,
  findUngroundedClaims,
  formatApplicationEmail,
  rankCvEvidence,
  replaceEmailDashes,
  buildMailtoUrl,
  parseApplicationEmailResponse,
  parseRecipient,
  stripUngroundedSentences,
} from '../lib/application-email.mjs';

test('parseRecipient reads a named company address', () => {
  const r = parseRecipient('marie.dupont@acme-group.co.uk');
  assert.equal(r.valid, true);
  assert.equal(r.firstName, 'Marie');
  assert.equal(r.lastName, 'Dupont');
  assert.equal(r.companyGuess, 'Acme Group');
  assert.equal(r.websiteUrl, 'https://acme-group.co.uk');
  assert.equal(r.isWebmail, false);
});

test('parseRecipient uses the display name and skips shared inboxes', () => {
  assert.equal(parseRecipient('"Jean Martin" <jobs@doctolib.fr>').firstName, 'Jean');
  const shared = parseRecipient('recrutement@doctolib.fr');
  assert.equal(shared.firstName, '');
  assert.equal(shared.isRoleMailbox, true);
  assert.equal(shared.companyGuess, 'Doctolib');
});

test('parseRecipient does not guess a company from webmail', () => {
  const r = parseRecipient('paul.durand@gmail.com');
  assert.equal(r.isWebmail, true);
  assert.equal(r.companyGuess, '');
  assert.equal(r.websiteUrl, '');
  assert.equal(r.firstName, 'Paul');
});

test('parseRecipient never points at an IP or an internal host', () => {
  assert.equal(parseRecipient('a@169.254.169.254').websiteUrl, '');
  assert.equal(parseRecipient('a@intranet.corp').websiteUrl, '');
});

test('parseRecipient flags invalid input and ignores empty input', () => {
  assert.equal(parseRecipient(''), null);
  assert.equal(parseRecipient('not an email').valid, false);
});

test('prompt switches between offer and spontaneous application', () => {
  const recipient = parseRecipient('hr@acme.io');
  const spontaneous = buildApplicationEmailPrompt({ cv: '# CV', recipient, companyText: 'Acme builds payroll APIs.' });
  assert.match(spontaneous, /candidature spontanée, aucune offre/);
  assert.match(spontaneous, /Acme builds payroll APIs/);
  assert.match(spontaneous, /Destinataire inconnu/);

  const offer = buildApplicationEmailPrompt({ cv: '# CV', jobUrl: 'https://x.io/job', jobText: 'Senior Product Designer', language: 'fr' });
  assert.match(offer, /candidature à une offre/);
  assert.match(offer, /Écris en français/);
});

const PROFILE = { candidate: { full_name: 'Hugo Vermot', linkedin: 'linkedin.com/in/hugovermot', portfolio_url: 'https://jobyougo.xyz/portfolio' } };

test('formatApplicationEmail rebuilds greeting, paragraphs and signature', () => {
  const body = formatApplicationEmail([
    'Bonjour Marie,',
    'Le poste porte sur le design system.',
    'Chez LVMH, j\'ai conçu une plateforme data.',
    '',
    'Mon CV est en pièce jointe.',
    'Cordialement,',
    'Hugo Vermot',
    'linkedin.com/in/hugovermot',
  ].join('\n'), { language: 'fr', profileData: PROFILE });
  assert.equal(body, [
    'Bonjour Marie,',
    '',
    'Le poste porte sur le design system. Chez LVMH, j\'ai conçu une plateforme data.',
    '',
    'Mon CV est en pièce jointe.',
    '',
    'Bien à vous,\nHugo Vermot\njobyougo.xyz/portfolio | linkedin.com/in/hugovermot',
  ].join('\n'));
});

test('extractOutreachRules reads the employers that must not be named', () => {
  const rules = extractOutreachRules({
    profileContext: '## Cover letters\n\n**Named employers (hard rule):** Do **not** name unknown or low-recognition employers as proof: OneAsset, UpViral, Agence V0, small clients. For current roles describe the work.\n\n## Other\nx',
  });
  assert.deepEqual(rules.unnamedEmployers, ['OneAsset', 'UpViral', 'Agence V0']);
  assert.match(rules.text, /Named employers/);
  assert.doesNotMatch(rules.text, /## Other/);
});

test('auditApplicationEmail flags brand, opener, hollow link and length', () => {
  const body = formatApplicationEmail([
    'Hi Marie,',
    '',
    'I\'m drawn to your agent platform. At OneAsset I shipped a full product with one Product Owner. This aligns closely with your vision.',
    '',
    'My CV is attached.',
  ].join('\n'), { language: 'en', profileData: PROFILE });
  const issues = auditApplicationEmail({ subject: 'Product Designer - Hugo Vermot', body }, { unnamedEmployers: ['OneAsset'] });
  assert.ok(issues.some(i => /OneAsset/.test(i)));
  assert.ok(issues.some(i => /Ouverture/.test(i)));
  const curly = formatApplicationEmail('Hello,\n\nI\u2019m particularly drawn to shaping trust-driven flows at Affirm. At OneAsset I shipped the investor app with one Product Owner and handed it to engineering via GitHub.\n\nMy CV is attached. Would you have 20 minutes next week?', { language: 'en', profileData: PROFILE });
  assert.ok(auditApplicationEmail({ subject: 'Product Designer - Hugo Vermot', body: curly, language: 'en' }).some(i => /Ouverture/.test(i)));
  assert.ok(issues.some(i => /Formule creuse/.test(i)));
  assert.ok(issues.some(i => /Trop court/.test(i)));
});

test('replaceEmailDashes keeps sentences whole', () => {
  assert.equal(
    replaceEmailDashes('This workflow — AI-assisted prototyping, Git hand-off — lets me test fast.'),
    'This workflow (AI-assisted prototyping, Git hand-off) lets me test fast.',
  );
  assert.equal(
    replaceEmailDashes('The process runs on AI — research, prototyping, and hand-off.'),
    'The process runs on AI: research, prototyping, and hand-off.',
  );
  assert.equal(replaceEmailDashes('Fast — and careful.'), 'Fast, and careful.');
  assert.equal(
    replaceEmailDashes('Systems machines can run — style references, prompt libraries — so output scales.'),
    'Systems machines can run (style references, prompt libraries) so output scales.',
  );
  assert.equal(replaceEmailDashes('70–110K'), '70-110K');
});

test('auditApplicationEmail catches internal tools, swaps, X-not-Y, tutoiement and subject language', () => {
  const wrap = (greeting, text, lang) => formatApplicationEmail(`${greeting}\n\n${text}`, { language: lang, profileData: PROFILE });
  const en = wrap('Hi Sarah,', [
    'I am applying for the Lead Product Designer role. Discovery should feel human, not algorithmic, especially on two sides.',
    'In my latest role I built prototypes in Cursor and reviewed them in Figma before a GitHub hand-off. I also used Figmol daily for the same review work.',
    'My CV is attached. Would you have 20 minutes next week to talk about the marketplace work?',
  ].join('\n\n'), 'en');
  const enIssues = auditApplicationEmail({ subject: 'Candidature - Hugo Vermot', body: en, language: 'en' }, { internalTools: ['Figmol'] });
  for (const re of [/Figmol/, /Figma/, /pas X mais Y/, /Objet en français/]) assert.ok(enIssues.some(i => re.test(i)), re);

  const fr = wrap('Bonjour Paul,', [
    'Je postule pour le poste de Lead Product Designer. Le marché à deux côtés pose un vrai problème de confiance.',
    'Dans mon poste actuel, j\'ai conçu des prototypes dans Cursor et Claude Code. La mainlevée assistée par l\'IA a accéléré la livraison.',
    'Mon CV est en pièce jointe. Pourrais-tu me dire si un échange de 20 minutes est possible la semaine prochaine ?',
  ].join('\n\n'), 'fr');
  const frIssues = auditApplicationEmail({ subject: 'Lead Product Designer - Hugo Vermot', body: fr, language: 'fr' });
  assert.ok(frIssues.some(i => /Tutoiement/.test(i)));
  assert.ok(frIssues.some(i => /passation/.test(i)));
});

test('audit catches multi-word X-not-Y, solo claims and French calques; layout adds French spacing', () => {
  const en = formatApplicationEmail([
    'Hi Sarah,',
    'I am applying for the Lead Product Designer role. Discovery should feel like advice, not a ranked list.',
    'In my latest role I designed the investor app alone, from research to the GitHub hand-off with engineering.',
    'My CV is attached. Would you have 20 minutes next week to talk about the marketplace?',
  ].join('\n\n'), { language: 'en', profileData: PROFILE });
  const enIssues = auditApplicationEmail({ subject: 'Lead Product Designer - Hugo Vermot', body: en, language: 'en' });
  assert.ok(enIssues.some(i => /pas X mais Y/.test(i)));
  assert.ok(enIssues.some(i => /périmètre exact/.test(i)));

  const fr = formatApplicationEmail([
    'Bonjour,',
    'Je postule pour le poste de Lead Product Designer. Une découverte AI-driven est exactement l’enjeu que je connais.',
    'Chez Renault, j’ai conçu une marketplace de véhicules: annonces, recherche et contact vendeur.',
    'Mon CV est en pièce jointe. Auriez-vous 20 minutes la semaine prochaine?',
  ].join('\n\n'), { language: 'fr', profileData: PROFILE });
  assert.match(fr, /véhicules : annonces/);
  assert.match(fr, /semaine prochaine \?/);
  const frIssues = auditApplicationEmail({ subject: 'Lead Product Designer - Hugo Vermot', body: fr, language: 'fr' });
  assert.ok(frIssues.some(i => /Calque/.test(i)));
  assert.ok(frIssues.some(i => /exactement/.test(i)));
});

test('parseApplicationEmailResponse capitalizes a slug company name in the body', () => {
  const out = parseApplicationEmailResponse('COMPANY: lovable\nROLE: Brand Designer\nLANGUAGE: en\nSUBJECT: Brand Designer - Hugo Vermot\nBODY:\nHello,\n\nThe role at lovable is about brand. See lovable.dev.');
  assert.equal(out.company, 'Lovable');
  assert.match(out.body, /role at Lovable is/);
  assert.match(out.body, /lovable\.dev/);
});

test('parseApplicationEmailResponse extracts fields and keeps line breaks', () => {
  const out = parseApplicationEmailResponse([
    '```',
    '**COMPANY:** Acme',
    'ROLE: Senior Product Designer',
    'LANGUAGE: en',
    'SUBJECT: Senior Product Designer — Hugo Vermot',
    'BODY:',
    'Hi Marie,',
    '',
    'Acme ships payroll APIs to small teams. I designed onboarding flows for a fintech product.',
    '',
    'Best,',
    'Hugo Vermot',
    '```',
  ].join('\n'));
  assert.equal(out.company, 'Acme');
  assert.equal(out.role, 'Senior Product Designer');
  assert.equal(out.language, 'en');
  assert.equal(out.subject, 'Senior Product Designer - Hugo Vermot');
  assert.match(out.body, /^Hi Marie,\n\nAcme ships/);
  assert.match(out.body, /Best,\nHugo Vermot$/);
});

test('parseApplicationEmailResponse falls back when the format is ignored', () => {
  const out = parseApplicationEmailResponse('Subject: Hello\n\nHello,\n\nI design products.');
  assert.equal(out.subject, 'Hello');
  assert.match(out.body, /I design products/);
});

test('buildMailtoUrl encodes subject and body', () => {
  assert.equal(
    buildMailtoUrl({ to: 'a@b.io', subject: 'Hi & bye', body: 'L1\nL2' }),
    'mailto:a@b.io?subject=Hi%20%26%20bye&body=L1%0AL2',
  );
});

test('rankCvEvidence ranks professional experience by shared domain words', () => {
  const cv = [
    '### Independent products and ventures',
    '#### Side project : Builder',
    '- Marketplace for marketplace sellers.',
    '### Professional Experience',
    '#### Designer : Renault Group (2020 – 2021)',
    '*Renew, a used-car marketplace.* Listings, sellers and buyers across countries.',
    '#### Designer : Bank (2022)',
    '- Savings and investment flows under regulation.',
    '### Skills',
    '- Figma',
  ].join('\n');
  const ranked = rankCvEvidence(cv, 'Lead designer for our marketplace: buyers, sellers and listings discovery.');
  assert.equal(ranked.length, 1);
  assert.match(ranked[0].heading, /Renault/);
  assert.ok(ranked[0].shared.includes('marketplace'));
  assert.deepEqual(rankCvEvidence(cv, ''), []);
});

test('audit catches the French "X, pas un Y" form', () => {
  const body = formatApplicationEmail('Bonjour,\n\nJe postule pour le poste. La découverte doit rester humaine, pas un classement algorithmique, pour les deux côtés.\n\nDans mon poste actuel, j’ai conçu les parcours investisseur avec un Product Owner et livré via GitHub.\n\nMon CV est en pièce jointe. Auriez-vous 20 minutes la semaine prochaine pour en parler ?', { language: 'fr', profileData: PROFILE });
  assert.ok(auditApplicationEmail({ subject: 'X - Hugo Vermot', body, language: 'fr' }).some(i => /pas X mais Y/.test(i)));
});

test('formatApplicationEmail drops a closing recap sentence', () => {
  const body = formatApplicationEmail('Hello,\n\nI am applying for the role.\n\nI built prototypes in Cursor. I handed them off via GitHub. The workflow is driven by AI: structured prompts and validation layers.\n\nMy CV is attached.', { language: 'en', profileData: PROFILE });
  assert.match(body, /handed them off via GitHub\.\n\nMy CV/);
  assert.doesNotMatch(body, /workflow is driven/);
  // Kept when dropping it would leave a one-sentence paragraph.
  const thin = formatApplicationEmail('Hello,\n\nIntro.\n\nI built prototypes in Cursor. The workflow is driven by AI.\n\nMy CV is attached.', { language: 'en', profileData: PROFILE });
  assert.match(thin, /workflow is driven by AI/);
});

test('recap sentence is dropped mid-paragraph and "X, not a Y" is caught', () => {
  const body = formatApplicationEmail('Hello,\n\nDiscovery should feel like advice, not a ranked list from a system.\n\nI built prototypes in Cursor. This workflow treats AI as a core production layer. I handed them off via GitHub.\n\nMy CV is attached.', { language: 'en', profileData: PROFILE });
  assert.match(body, /I built prototypes in Cursor\. I handed them off via GitHub\./);
  assert.ok(auditApplicationEmail({ subject: 'X - Hugo Vermot', body, language: 'en' }).some(i => /pas X mais Y/.test(i)));
});

test('formatApplicationEmail joins participle fragments to the previous sentence', () => {
  const body = formatApplicationEmail('Bonjour,\n\nJe postule.\n\nLes prototypes ont été construits dans Cursor et Claude Code. Revus sur l’app live. Passés aux développeurs via GitHub.\n\nMon CV est en pièce jointe.', { language: 'fr', profileData: PROFILE });
  assert.match(body, /Claude Code, revus sur l’app live, passés aux développeurs via GitHub\./);
});

const GROUND_CV = [
  '### Professional Experience',
  '#### Senior Product Designer : OneAsset (2026)',
  '- Shipped the investor app with one Product Owner.',
  '#### Senior Product Designer : Edenred (2023 – 2024)',
  '- Designed mobile apps for gas station and EV-charging-point location for corporate mobility clients.',
].join('\n');

// The checker drops the greeting and the final block (the signature). The ask
// is the last prose paragraph and is not term-checked.
function groundEmail(intro, proof, ask = 'My CV is attached. Would you have 20 minutes next week?') {
  return ['Hello,', intro, proof, ask, 'Best,\nHugo Vermot'].join('\n\n');
}

test('one posting term missing from the CV flags the proof sentence even when another term is already in the CV', () => {
  const body = groundEmail(
    'I am applying for the Head of Product role on the multi-service mobility platform.',
    'In my latest role I led a multi-service mobility platform, including trip tracking.',
  );
  const source = 'Head of Product. Own our multi-service mobility platform: trip tracking and feedback loops.';
  const claims = findUngroundedClaims(body, {
    cv: GROUND_CV,
    sourceText: source,
    company: 'Joyride',
    role: 'Head of Product',
    sameLanguage: true,
  });
  const proof = claims.find(claim => /trip tracking/.test(claim.sentence));
  assert.ok(proof, 'the proof sentence must be flagged');
  assert.ok(proof.words.includes('multi-service'));
  assert.equal(proof.words.includes('mobility'), false);
  assert.equal(claims.some(claim => /I am applying/.test(claim.sentence) && claim.words.length), false);
});

test('a proof sentence whose content words are in the CV is not flagged', () => {
  const body = groundEmail(
    'I am applying for the Senior Product Designer role.',
    'At Edenred I designed mobile apps for corporate mobility clients.',
    'My CV is attached.',
  );
  const claims = findUngroundedClaims(body, {
    cv: GROUND_CV,
    sourceText: 'Senior Product Designer. Design mobile apps for corporate mobility clients.',
    company: 'Edenred',
    role: 'Senior Product Designer',
  });
  assert.deepEqual(claims, []);
});

test('a figure missing from the CV is flagged and that sentence is removed when the paragraph keeps another', () => {
  const body = groundEmail(
    'I am applying for the role.',
    'I shipped the investor app with one Product Owner. I reduced feedback loops by half.',
  );
  const claims = findUngroundedClaims(body, { cv: GROUND_CV, sourceText: 'reduce feedback loops', sameLanguage: true });
  const hit = claims.find(claim => /by half/.test(claim.sentence));
  assert.ok(hit);
  assert.ok(hit.figures.some(figure => /half/i.test(figure)));
  assert.match(describeUngroundedClaim(hit), /absent/);
  const { body: stripped, removed } = stripUngroundedSentences(body, claims);
  assert.deepEqual(removed, ['I reduced feedback loops by half.']);
  assert.match(stripped, /investor app/);
  assert.doesNotMatch(stripped, /by half/);
});

test('the only sentence of a paragraph is kept when it is ungrounded', () => {
  const body = groundEmail(
    'I am applying for the role.',
    'I reduced feedback loops by half.',
  );
  const claims = findUngroundedClaims(body, { cv: GROUND_CV, sourceText: '', sameLanguage: true });
  const { removed } = stripUngroundedSentences(body, claims);
  assert.deepEqual(removed, []);
});

test('posting vocabulary is not checked when the email is not in the CV language', () => {
  const body = ['Bonjour,', 'Je postule au poste.', 'Dans mon poste actuel, j’ai mené une plateforme multi-service de mobilité.', 'Mon CV est en pièce jointe.', 'Bien à vous,\nHugo Vermot'].join('\n\n');
  const claims = findUngroundedClaims(body, {
    cv: GROUND_CV,
    sourceText: 'multi-service mobility platform',
    sameLanguage: false,
  });
  assert.deepEqual(claims, []);
});

test('the candidate may describe the internal review tool they built, without its name', () => {
  const text = (tool) => formatApplicationEmail(`Hello,\n\nI am applying for the Lead Product Designer role on your marketplace team.\n\nIn my latest role I built prototypes in Cursor and Claude Code. I reviewed them in ${tool} before a GitHub hand-off with engineering.\n\nMy CV is attached. Would you have 20 minutes next week to talk about the role?`, { language: 'en', profileData: PROFILE });
  const audit = (tool) => auditApplicationEmail({ subject: 'Lead Product Designer - Hugo Vermot', body: text(tool), language: 'en' }, { internalTools: ['Figmol'] });
  assert.ok(!audit('an internal review tool I built').some(i => /outil|Figma/i.test(i)));
  assert.ok(audit('Figmol').some(i => /Figmol/.test(i)));
});
