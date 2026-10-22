import test from 'node:test';
import assert from 'node:assert/strict';
import {
  auditApplicationEmail,
  buildApplicationEmailPrompt,
  describeUngroundedClaim,
  extractOutreachRules,
  findUngroundedClaims,
  findToolAttributionClaims,
  splitSentences,
  maskUnnamedEmployers,
  indexCvExperiences,
  formatApplicationEmail,
  rankCvEvidence,
  replaceEmailDashes,
  buildMailtoUrl,
  parseApplicationEmailResponse,
  parseRecipient,
  classifyMailbox,
  inferPersona,
  withContact,
  portfolioUrlFromCv,
  profileWithPortfolio,
  applyContactFallback,
  stripUngroundedSentences,
  buildApplicationEmailMessages,
  matchPostingToCv,
  cvProofLines,
  formatPostingMatches,
  parseRoleHeading,
  proofExcerpt,
  fixCurrentRoleAttribution,
  ensureRoleOpener,
  ensureAvailability,
  stripProcessDetail,
  cleanSentenceQuality,
  trimToWordBudget,
  availabilityLine,
  toolsNamedIn,
  replacedTools,
  findToolContradictions,
  stripToolContradictions,
  genericMotivationSentences,
  stripGenericMotivation,
  describeGenericMotivation,
  STRONG_MATCH_SCORE,
  numberCvLines,
  validatePostingMatches,
  mergePostingMatches,
  generateApplicationEmail,
  cvRulesLookUnsure,
  validateCvStructure,
  structureProofLines,
  readCvStructure,
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
    'Bien à vous,\nHugo Vermot\nhttps://jobyougo.xyz/portfolio\nhttps://linkedin.com/in/hugovermot',
  ].join('\n'));
});

test('portfolio URL comes from the CV when the profile row has none, and stays off another person', () => {
  const cv = '**Portfolio:** [jobyougo.xyz/portfolio](https://jobyougo.xyz/portfolio)';
  assert.equal(portfolioUrlFromCv(cv), 'https://jobyougo.xyz/portfolio');
  const fromCv = profileWithPortfolio({ full_name: 'Hugo Vermot', linkedin: 'linkedin.com/in/hugovermot' }, cv);
  const body = formatApplicationEmail('Hello,\n\nI am applying for the role.\n\nI designed the investor app with one Product Owner.\n\nCV is attached.', {
    language: 'en',
    profileData: fromCv,
  });
  assert.match(body, /https:\/\/jobyougo\.xyz\/portfolio/);
  assert.match(body, /https:\/\/linkedin\.com\/in\/hugovermot/);

  const other = applyContactFallback(
    { candidate: { full_name: 'Ada Lovelace' } },
    { candidate: { full_name: 'Hugo Vermot', portfolio_url: 'https://jobyougo.xyz/portfolio' } },
  );
  assert.equal(other.candidate.portfolio_url, undefined);
  const same = applyContactFallback(
    { full_name: 'Hugo Vermot' },
    { candidate: { full_name: 'Hugo Vermot', portfolio_url: 'https://jobyougo.xyz/portfolio', linkedin: 'linkedin.com/in/hugovermot' } },
  );
  assert.equal(same.candidate.portfolio_url, 'https://jobyougo.xyz/portfolio');
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
  assert.doesNotMatch(body, /drawn to/i);
  const curly = formatApplicationEmail('Hello,\n\nI\u2019m particularly drawn to shaping trust-driven flows at Affirm. At OneAsset I shipped the investor app with one Product Owner and handed it to engineering via GitHub.\n\nMy CV is attached. Would you have 20 minutes next week?', { language: 'en', profileData: PROFILE });
  assert.doesNotMatch(curly, /drawn to|trust-driven/i);
  assert.match(curly, /https:\/\/jobyougo\.xyz\/portfolio/);
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
  assert.match(fr, /véhicules, annonces/); // a colon inside a sentence becomes a comma
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
  assert.match(body, /handed them off\.\n\nMy CV/);
  assert.doesNotMatch(body, /workflow is driven/);
  // Kept when dropping it would leave a one-sentence paragraph.
  const thin = formatApplicationEmail('Hello,\n\nIntro.\n\nI built prototypes in Cursor. The workflow is driven by AI.\n\nMy CV is attached.', { language: 'en', profileData: PROFILE });
  assert.match(thin, /workflow is driven by AI/);
});

test('recap sentence is dropped mid-paragraph and "X, not a Y" is caught', () => {
  const body = formatApplicationEmail('Hello,\n\nDiscovery should feel like advice, not a ranked list from a system.\n\nI built prototypes in Cursor. This workflow treats AI as a core production layer. I handed them off via GitHub.\n\nMy CV is attached.', { language: 'en', profileData: PROFILE });
  assert.match(body, /I built prototypes in Cursor\. I handed them off\./);
  assert.ok(auditApplicationEmail({ subject: 'X - Hugo Vermot', body, language: 'en' }).some(i => /pas X mais Y/.test(i)));
});

test('formatApplicationEmail joins participle fragments to the previous sentence', () => {
  const body = formatApplicationEmail('Bonjour,\n\nJe postule.\n\nLes prototypes ont été construits dans Cursor et Claude Code. Revus sur l’app live. Passés aux développeurs via GitHub.\n\nMon CV est en pièce jointe.', { language: 'fr', profileData: PROFILE });
  assert.match(body, /Claude Code, revus sur l’app live, passés aux développeurs./);
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

test('a digit glued to letters (MIF2, B2B) is a name, not a figure', () => {
  const body = groundEmail(
    'I am applying for the role.',
    'I designed investment flows under MIF2 requirements for a B2B product. I shipped 12 features.',
  );
  const cv = `${GROUND_CV}\n- Designed investment flows under MIF2 requirements for a B2B product.`;
  const claims = findUngroundedClaims(body, { cv, sourceText: '', sameLanguage: true });
  assert.equal(claims.length, 1);
  assert.deepEqual(claims[0].figures, ['12 features']);
});

const TOOL_CV = [
  '### Independent products and ventures',
  '#### Creads.io : Founder, AI Product Builder (2024 – Present)',
  '- Brand Agent: website scraping (Firecrawl) and Brand DNA generation.',
  '### Professional Experience',
  '#### Senior Product Designer / Product Lead : OneAsset (Feb 2026 – Present)',
  '- Prototypes in Cursor and Claude Code, GitHub flow with engineering.',
  '#### Senior Product Designer : Société Générale (Feb 2023 – Oct 2024)',
  '- Designed savings and investment flows under MIF2 requirements.',
].join('\n');

test('indexCvExperiences names each block and marks the latest role', () => {
  const index = indexCvExperiences(TOOL_CV);
  assert.deepEqual(index.map(item => item.names[0]), ['Creads.io', 'OneAsset', 'Société Générale']);
  assert.equal(index.find(item => item.latest).names[0], 'OneAsset');
});

test('a tool glued onto an experience whose CV block never mentions it is flagged, the right one is not', () => {
  const body = groundEmail(
    'Vous construisez des agents vocaux.',
    'Chez Creads.io j\'ai conçu le Brand Agent, qui scrape le site client. J\'ai construit les prototypes en Cursor et Claude Code, puis passé chaque flux aux développeurs par pull request.',
    'Mon CV est en pièce jointe.',
  );
  const claims = findToolAttributionClaims(body, TOOL_CV);
  assert.equal(claims.length, 1);
  assert.deepEqual(claims[0].tools, ['Cursor', 'Claude Code', 'GitHub / pull requests']);
  assert.equal(claims[0].employer, 'Creads.io');
  assert.match(describeUngroundedClaim(claims[0]), /mauvaise expérience/);
  const { body: stripped, removed } = stripUngroundedSentences(body, claims);
  assert.equal(removed.length, 1);
  assert.match(stripped, /Brand Agent/);
  assert.doesNotMatch(stripped, /Cursor/);

  const fine = groundEmail(
    'Vous construisez des agents vocaux.',
    'Dans mon poste actuel, j\'ai livré l\'app investisseur avec un Product Owner. Les prototypes sont construits en Cursor et Claude Code, puis passés aux développeurs via GitHub.',
  );
  assert.deepEqual(findToolAttributionClaims(fine, TOOL_CV), []);
  const sg = groundEmail('Intro.', 'At Société Générale I designed investment flows under MIF2. I prototyped them in Cursor.');
  assert.equal(findToolAttributionClaims(sg, TOOL_CV)[0].employer, 'Société Générale');
});

test('layout writes out "CV attached" fragments; audit catches "te", "engineering" and "hand-off"', () => {
  const en = formatApplicationEmail('Hello,\n\nI design products for banks with one Product Owner.\n\nI shipped the investor app and the admin panel with engineering.\n\nCV attached. Happy to talk.', { language: 'en', profileData: PROFILE });
  assert.match(en, /My CV is attached\. Happy to talk\./);
  const fr = formatApplicationEmail('Bonjour,\n\nJe conçois des produits bancaires avec un Product Owner.\n\nJ\'ai livré l\'app investisseur et la console d\'administration avec les développeurs.\n\nCV en pièce jointe. Je peux te détailler ces workflows avec l\'équipe engineering, puis le hand-off.', { language: 'fr', profileData: PROFILE });
  assert.match(fr, /Mon CV est en pièce jointe\./);
  const issues = auditApplicationEmail({ subject: 'X - Hugo Vermot', body: fr, language: 'fr' });
  assert.ok(issues.some(i => /Tutoiement/.test(i)), 'te → tutoiement');
  assert.ok(issues.some(i => /Calque/.test(i) && /engineering|hand-off/.test(i)), 'engineering → calque');
  assert.ok(!auditApplicationEmail({ subject: 'X - Hugo Vermot', body: formatApplicationEmail('Bonjour,\n\nJe conçois des produits avec un Product Owner et je vous remercie.\n\nJ\'ai livré l\'app investisseur avec les développeurs, revue en direct dans un outil interne.\n\nMon CV est en pièce jointe. Dites-moi si un appel vous convient.', { language: 'fr', profileData: PROFILE }), language: 'fr' }).some(i => /Tutoiement/.test(i)), 'vous stays clean');
});

test('review fixes: personas, mailbox prefixes, figures with units, masking at sentence end, signature untouched', () => {
  assert.equal(inferPersona({ title: 'Product Owner' }), 'hiring-manager');
  assert.equal(inferPersona({ title: 'Vice President of Design' }), 'hiring-manager');
  assert.equal(inferPersona({ title: 'VP Engineering' }), 'hiring-manager');
  assert.equal(inferPersona({ title: 'Co-founder & CEO' }), 'founder');
  assert.equal(classifyMailbox('d.poirier'), '');
  assert.equal(classifyMailbox('jobson'), '');
  assert.equal(classifyMailbox('jobs-paris'), 'hiring');
  assert.equal(classifyMailbox('dpo'), 'avoid');
  assert.equal(withContact(parseRecipient('m.dupont@acme.io'), {}).persona, 'unknown');
  assert.equal(withContact(parseRecipient('marie.dupont@acme.io'), { firstName: 'jean-pierre', lastName: 'Durand' }).firstName, 'Jean-Pierre');

  const claims = findUngroundedClaims(groundEmail('Intro.', 'I grew the base to 50k users and 3x revenue under MIF2.'), { cv: `${GROUND_CV}\n- Worked under MIF2 rules.`, sourceText: '', sameLanguage: true });
  assert.deepEqual(claims.map(c => c.figures), [['50k users', '3x revenue']]);
  const fr = findUngroundedClaims(['Bonjour,', 'Intro.', 'Creads compte 1 200 utilisateurs.', 'CV.', 'Bien à vous,\nHugo'].join('\n\n'), { cv: 'Creads has 1,200 registered users', sourceText: '', sameLanguage: false });
  assert.deepEqual(fr, []);

  const masked = maskUnnamedEmployers('Hello,\n\nI shipped the app at OneAsset. OneAsset is my employer.\n\nBest,\nHugo Vermot\nhttps://jobyougo.xyz/portfolio', { unnamedEmployers: ['OneAsset'], latestNames: ['OneAsset'], language: 'en' });
  assert.match(masked.body, /app in my current role\. My current employer is my employer\./);
  assert.match(masked.body, /\nhttps:\/\/jobyougo/);
  assert.deepEqual(masked.masked, ['OneAsset']);
  assert.deepEqual(masked.leftover, []);
});

test('maskUnnamedEmployers describes a forbidden brand instead of naming it', () => {
  const fr = maskUnnamedEmployers('Bonjour,\n\nChez OneAsset, j\'ai livré l\'app investisseur. Pour UpViral, j\'ai mené la découverte. OneAsset reste mon employeur.\n\nMon CV est en pièce jointe.', { unnamedEmployers: ['OneAsset', 'UpViral'], latestNames: ['OneAsset'], language: 'fr' });
  assert.deepEqual(fr.masked, ['OneAsset', 'UpViral']);
  assert.match(fr.body, /^Bonjour,\n\nDans mon poste actuel, j'ai livré/);
  assert.match(fr.body, /Chez un précédent employeur, j'ai mené/);
  assert.match(fr.body, /Mon employeur actuel reste mon employeur\./);
  const en = maskUnnamedEmployers('Hello,\n\nAt OneAsset I shipped the investor app. UpViral\'s roadmap was mine.\n\nCV attached.', { unnamedEmployers: ['OneAsset', 'UpViral'], latestNames: ['OneAsset'], language: 'en' });
  assert.match(en.body, /In my current role I shipped/);
  assert.match(en.body, /A previous employer roadmap was mine/);
  const none = maskUnnamedEmployers('At LVMH I designed a platform.', { unnamedEmployers: ['OneAsset'], latestNames: ['OneAsset'] });
  assert.deepEqual(none.masked, []);
  assert.equal(none.body, 'At LVMH I designed a platform.');
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

// ── Posting needs → CV proof lines (2026-10-08: the emails were vague on
// skills and did not refer to the posting) ──────────────────────────────────

const FINTECH_CV = [
  '### Summary',
  'Product leader.',
  '### Professional Experience',
  '#### Senior Product Designer / Product Lead : OneAsset (Feb 2026 – Present)',
  '*Salaried; product lead with one Product Owner.*',
  '*Regulated real-world asset investment platform: daily USDC yield (Base / ERC-3643), VARA licensed.*',
  '- Designed compliance UX for a VARA-licensed RWA product: KYB/KYC onboarding, reporting workflows, investor flows, OTC.',
  '- Built prototypes in Cursor and Claude Code, reviewed them in Figmol, and ran a GitHub flow with engineering.',
  '#### Senior Product Designer : Société Générale (Feb 2023 – Oct 2024)',
  '*Retail banking: savings, allocation, and investment products.*',
  '- Navigated MIF2 regulatory constraints and investor-profile validation to keep the flows both compliant and usable.',
  '#### Freelance Senior Product Designer (2016 – Present)',
  '- Helped early-stage startups including Arlequin. Dates and metrics for Arlequin are not on file.',
  '### Skills',
  '- Figma',
].join('\n');

const PAYMENTS_POSTING = [
  'About the Company',
  'Paymonade delivers payment technology in 187 countries, with crypto onramps for businesses.',
  'Responsibilities',
  '1. Own compliance product development and ongoing improvements.',
  '- Translate requirements defined by Compliance, including KYC/KYB and AML, into user flows, data rules and operational tools.',
  'Requirements',
  '- Strong analytical skills, with the ability to use SQL to investigate conversion and transaction issues.',
  'Preferred Experience',
  '- Products serving multiple markets, or experience in regulated financial services and digital assets in Europe.',
  'Show more Show less Seniority level Mid-Senior level Industries Financial Services, Banking, and Internet Marketplace Platforms Get notified about new jobs.',
].join('\n');

test('cvProofLines keeps role bullets and product lines, skips the contract line and notes to the CV editor', () => {
  const lines = cvProofLines(FINTECH_CV);
  assert.ok(lines.some(l => l.product && l.current && /USDC/.test(l.text)));
  assert.ok(lines.some(l => !l.product && l.employer === 'Société Générale' && /MIF2/.test(l.text)));
  assert.ok(!lines.some(l => /^Salaried/.test(l.text)));
  assert.ok(!lines.some(l => /not on file/.test(l.text)));
  assert.ok(!lines.some(l => /Figma$/.test(l.text)), 'Skills are not proof lines');
});

test('matchPostingToCv pairs each posting need with the CV line that answers it, on pasted and flattened text', () => {
  for (const text of [PAYMENTS_POSTING, PAYMENTS_POSTING.replace(/\s+/g, ' ')]) {
    const matches = matchPostingToCv(text, FINTECH_CV);
    const kyc = matches.find(m => /KYC\/KYB and AML/.test(m.need));
    assert.ok(kyc, 'the KYC/AML need is matched');
    assert.match(kyc.proof, /KYB\/KYC onboarding/);
    assert.ok(kyc.concepts.includes('compliance'));
    // "digital assets" in the posting is the USDC / RWA platform in the CV.
    const assets = matches.find(m => /digital assets/.test(m.need));
    assert.ok(assets && /USDC|MIF2|VARA/.test(assets.proof), JSON.stringify(matches, null, 1));
    // The company blurb and the job-board chrome are not needs.
    assert.ok(!matches.some(m => /187 countries|Seniority level|Get notified/.test(m.need)));
    // Two needs never share one CV line.
    assert.equal(new Set(matches.map(m => m.proof)).size, matches.length);
  }
});

test('matchPostingToCv does not pair "prompt engineering" or "scoring-system design" with working with engineers', () => {
  const cv = [
    '### Professional Experience',
    '#### Founder / Independent AI Product Builder (2022 – Present)',
    '- Combined product design, prompt engineering, agent orchestration and scoring-system design into a single delivery practice.',
  ].join('\n');
  const matches = matchPostingToCv('Requirements\n- You partner with engineers on system design and technical constraints every week.', cv);
  assert.ok(!matches.some(m => m.concepts.includes('engineering')));
});

test('matchPostingToCv returns nothing without a posting or without professional experience', () => {
  assert.deepEqual(matchPostingToCv('', FINTECH_CV), []);
  assert.deepEqual(matchPostingToCv(PAYMENTS_POSTING, '### Skills\n- Figma'), []);
});

test('formatPostingMatches hides an unnamed employer and an internal tool, also inside the CV line', () => {
  const block = formatPostingMatches([
    { need: 'Prototype with AI tools.', proof: 'Shipped the OneAsset investor app; reviewed prototypes in Figmol.', employer: 'OneAsset', role: 'Product Lead', current: true, latest: true, product: false, dates: 'Feb 2026 – Present' },
    { need: 'Regulated finance.', proof: 'Navigated MIF2 constraints.', employer: 'Société Générale', role: 'Senior Product Designer', current: false, product: false, dates: 'Feb 2023 – Oct 2024' },
  ], { unnamedEmployers: ['OneAsset'], internalTools: ['Figmol'] });
  assert.ok(!/OneAsset|Figmol/.test(block), block);
  assert.match(block, /in my current role/);
  assert.match(block, /an internal tool/);
  assert.match(block, /Société Générale, Feb 2023 – Oct 2024/);
});

test('with matches, the prompt asks for one CV answer per posting need and drops the hooks', () => {
  const matches = matchPostingToCv(PAYMENTS_POSTING, FINTECH_CV);
  const args = {
    cv: FINTECH_CV,
    profileData: PROFILE,
    recipient: parseRecipient('contact@paymonade.tech'),
    jobText: PAYMENTS_POSTING,
    hooks: [{ line: 'HOOK LINE' }],
    unnamedEmployers: ['OneAsset'],
  };
  const withMatches = buildApplicationEmailMessages({ ...args, matches });
  assert.match(withMatches.system, /one sentence per match/);
  assert.match(withMatches.user, /## MATCHES/);
  assert.match(withMatches.user, /KYB\/KYC onboarding/);
  assert.ok(!/HOOK LINE/.test(withMatches.user));
  // The inbox persona keeps its own ask.
  assert.match(withMatches.system, /forward it to the person hiring/);
  const without = buildApplicationEmailMessages({ ...args, matches: [] });
  assert.ok(!/## MATCHES/.test(without.user));
  assert.match(without.user, /HOOK LINE/);
});

test('role-title words stated as experience are ungrounded unless the sentence names the role', () => {
  const body = groundEmail(
    'I am applying for the Senior Product Manager - Payments role.',
    'In my current role I shipped the investor app with one Product Owner. I designed the payment collection steps.',
    'My CV is attached.',
  );
  const claims = findUngroundedClaims(body, { cv: GROUND_CV, sourceText: 'Senior Product Manager - Payments', role: 'Senior Product Manager - Payments', sameLanguage: true });
  assert.equal(claims.length, 1);
  assert.match(claims[0].sentence, /payment collection/);
  // Naming the role is fine.
  const naming = groundEmail('I am applying for the role.', 'I shipped the investor app for this Payments role.', 'My CV is attached.');
  assert.deepEqual(findUngroundedClaims(naming, { cv: GROUND_CV, sourceText: 'Payments', role: 'Senior Product Manager - Payments', sameLanguage: true }), []);
});

test('payments jargon from the posting is checked across languages and for three-letter acronyms', () => {
  const posting = 'Translate KYC, AML and payout rules into flows. Handle callbacks.';
  const fr = ['Bonjour,', 'Je postule au poste.', 'Dans mon poste actuel, j’ai conçu les règles AML et les callbacks de payout. J’ai conçu l’onboarding KYC.', 'Mon CV est en pièce jointe.', 'Bien à vous,\nHugo Vermot'].join('\n\n');
  const cv = `${GROUND_CV}\n- Designed KYB/KYC onboarding.`;
  const claims = findUngroundedClaims(fr, { cv, sourceText: posting, sameLanguage: false });
  assert.equal(claims.length, 1);
  assert.deepEqual(claims[0].words.sort(), ['aml', 'callback', 'payout']);
  // Same language: the acronym the CV never uses is caught too.
  const en = groundEmail('I am applying for the role.', 'I shipped the investor app. I wrote the AML rules.', 'My CV is attached.');
  const enClaims = findUngroundedClaims(en, { cv, sourceText: posting, sameLanguage: true });
  assert.ok(enClaims.some(c => c.words.includes('aml')));
});

test('a lowercase or uppercase profile name is written properly in the signature', () => {
  const sign = name => formatApplicationEmail('Hello,\n\nI am applying.\n\nMy CV is attached.', { language: 'en', profileData: { candidate: { full_name: name } } }).split('\n').slice(-1)[0];
  assert.equal(sign('hugo vermot'), 'Hugo Vermot');
  assert.equal(sign('JEAN-LUC MARTIN'), 'Jean-Luc Martin');
  assert.equal(sign('Jean-Luc de La Tour'), 'Jean-Luc de La Tour');
});

test('parseRoleHeading reads the usual role / employer / dates layouts', () => {
  const cases = [
    ['Senior Product Designer / Product Lead : OneAsset (Feb 2026 – Present)', 'Senior Product Designer / Product Lead', 'OneAsset', 'Feb 2026 – Present'],
    ['Acme Corp — Product Manager, 2019 – 2022', 'Product Manager', 'Acme Corp', '2019 – 2022'],
    ['Product Designer at Doctolib (2021 – Present)', 'Product Designer', 'Doctolib', '2021 – Present'],
    ['Chef de projet digital | BNP Paribas | 2018 - 2020', 'Chef de projet digital', 'BNP Paribas', '2018 - 2020'],
    ['**Product Manager**, Qonto (2021-2023)', 'Product Manager', 'Qonto', '2021-2023'],
    ['Founder / Independent AI Product Builder (2022 – Present)', 'Founder / Independent AI Product Builder', '', '2022 – Present'],
  ];
  for (const [heading, role, employer, dates] of cases) {
    assert.deepEqual(parseRoleHeading(heading), { role, employer, dates }, heading);
  }
});

test('cvProofLines reads a French CV and a plain-text CV without the usual headings', () => {
  const fr = cvProofLines('# Jane\n## Expérience professionnelle\n### Chef de produit — Qonto (2021 – aujourd’hui)\n- Conçu le parcours KYC avec l’équipe conformité et les développeurs.\n## Compétences\n- SQL, Figma, Amplitude et analyse de données produit');
  assert.equal(fr.length, 1);
  assert.equal(fr[0].employer, 'Qonto');
  assert.equal(fr[0].current, true);
  const plain = cvProofLines('Jane Doe\nExperience\nQonto, Product Manager 2021-2023\n- Built the SEPA payout flow with the payments team.\n- Ran SQL analyses of KYC drop-off with compliance.\nEducation\n- HEC Paris, master in management and finance studies');
  assert.deepEqual(plain.map(l => l.text), ['Built the SEPA payout flow with the payments team.', 'Ran SQL analyses of KYC drop-off with compliance.']);
  // Without a role, the prompt line still reads cleanly.
  const block = formatPostingMatches([{ need: 'SEPA payments.', proof: plain[0].text, role: '', employer: '', dates: '', current: false, product: false }]);
  assert.match(block, /CV answer \(what the candidate did\): "Built the SEPA payout flow/);
});

test('proofExcerpt gives the model a clean line: no parentheses, no note to the reader, a short list', () => {
  assert.equal(
    proofExcerpt('Designed compliance UX for a VARA-licensed RWA product: KYB/KYC onboarding, reporting workflows, investor flows, OTC, trust-first UI (Base / ERC-3643).'),
    'Designed compliance UX for a VARA-licensed RWA product: KYB/KYC onboarding, reporting workflows, investor flows.',
  );
  assert.equal(
    proofExcerpt('Led implementation with developers while continuing user interviews and product refinement in parallel. This is the main example of day-to-day engineering collaboration besides OneAsset.'),
    'Led implementation with developers while continuing user interviews and product refinement in parallel.',
  );
  assert.equal(proofExcerpt('Drove +12% investment activity. Navigated MIF2 constraints.'), 'Drove +12% investment activity. Navigated MIF2 constraints.');
});

test('the audit flags a recap of the posting read back to its author', () => {
  const body = formatApplicationEmail('Hello,\n\nI am applying for the Senior PM role at Paymonade. The posting asks for KYC experience. It also asks for SQL.\n\nIn my current role I designed the KYB/KYC onboarding of a regulated investment platform with one Product Owner.\n\nMy CV is attached.', { language: 'en', profileData: PROFILE });
  const issues = auditApplicationEmail({ subject: 'Senior PM - Hugo Vermot', body, language: 'en' });
  assert.ok(issues.some(issue => /Résumé de l'annonce/.test(issue)), JSON.stringify(issues));
  const clean = formatApplicationEmail('Hello,\n\nI am applying for the Senior PM role at Paymonade. You need someone who has built KYC flows in a regulated product.\n\nIn my current role I designed the KYB/KYC onboarding of a regulated investment platform with one Product Owner.\n\nMy CV is attached.', { language: 'en', profileData: PROFILE });
  assert.ok(!auditApplicationEmail({ subject: 'Senior PM - Hugo Vermot', body: clean, language: 'en' }).some(issue => /Résumé/.test(issue)));
});

test('a proof from a finished experience labelled "in my current role" gets its own employer back', () => {
  const cv = [
    '### Professional Experience',
    '#### Product Lead : OneAsset (Feb 2026 – Present)',
    '- Designed compliance UX for a VARA-licensed RWA product: KYB/KYC onboarding, reporting workflows.',
    '#### Product Designer / Product Manager : UpViral (Jul 2024 – Dec 2025)',
    '- Led implementation with developers while continuing user interviews and product refinement in parallel.',
    '#### Senior Product Designer : Société Générale (Feb 2023 – Oct 2024)',
    '- Navigated MIF2 regulatory constraints and investor-profile validation to keep the flows compliant.',
  ].join('\n');
  const body = ['Hello,', 'I am applying for the role.', 'In my current role, I led implementation with developers while running user interviews and product refinement. In my current role, I navigated MIF2 regulatory constraints and investor-profile validation. In my current role, I designed the KYB/KYC onboarding and reporting workflows.', 'My CV is attached.', 'Best,\nHugo Vermot'].join('\n\n');
  const { body: out, fixed } = fixCurrentRoleAttribution(body, cv, { unnamedEmployers: ['OneAsset', 'UpViral'] });
  assert.equal(fixed.length, 2);
  assert.match(out, /At a previous employer, I led implementation/);
  assert.match(out, /At Société Générale, I navigated MIF2/);
  assert.match(out, /In my current role, I designed the KYB\/KYC onboarding/);
});

test('ensureRoleOpener puts back the line that says what the email is, once', () => {
  const body = 'Hello,\n\nYou need someone who has built KYC flows.\n\nIn my current role I designed the KYB/KYC onboarding.\n\nMy CV is attached.\n\nBest,\nHugo Vermot';
  const out = ensureRoleOpener(body, { role: 'Senior Product Manager - Payments / Stablecoin', company: 'Paymonade', language: 'en' });
  assert.match(out.split('\n\n')[1], /^I'm applying for the Senior Product Manager - Payments \/ Stablecoin role at Paymonade\. You need someone/);
  assert.equal(ensureRoleOpener(out, { role: 'Senior Product Manager', company: 'Paymonade' }), out);
  const fr = ensureRoleOpener('Bonjour,\n\nVous cherchez quelqu’un qui a conçu des parcours KYC.\n\nMon CV est en pièce jointe.\n\nBien à vous,\nHugo Vermot', { role: 'Product Designer', company: 'Alan', language: 'fr' });
  assert.match(fr, /Je postule au poste de Product Designer chez Alan\. Vous cherchez/);
  // Unknown role: nothing to add.
  assert.equal(ensureRoleOpener(body, { role: '', company: 'Paymonade' }), body);
});

test('the audit flags three sentences that open the same way', () => {
  const body = formatApplicationEmail('Hello,\n\nI am applying for the PM role. You need someone who has KYC experience. You need someone who can read SQL.\n\nIn my current role I designed the KYB/KYC onboarding of a regulated platform with one Product Owner.\n\nMy CV is attached.', { language: 'en', profileData: PROFILE });
  const issues = auditApplicationEmail({ subject: 'PM - Hugo Vermot', body, language: 'en' });
  assert.ok(issues.some(issue => /Même début de phrase/.test(issue)), JSON.stringify(issues));
});

// ── Review round on the matching (2026-10-08) ───────────────────────────────

test('Title-Case role headings are needs, an "About <Company>" heading is not', () => {
  const role = 'You will design the KYC/KYB onboarding and compliance reporting workflows for our regulated investment product.';
  for (const heading of ['About This Role', 'About The Job', 'About Your Role', 'About This Opportunity', 'About the role']) {
    const posting = `Acme is a regulated fintech for European SMEs.\n\n${heading}\n${role}\n\nWhat we offer\n- Remote work and a learning budget for every designer on the team.`;
    for (const text of [posting, posting.replace(/\s+/g, ' ')]) {
      const matches = matchPostingToCv(text, FINTECH_CV);
      assert.ok(matches.some(m => m.need === role), `${heading}: ${JSON.stringify(matches.map(m => m.need))}`);
    }
  }
  const blurb = matchPostingToCv('About Acme\nAcme runs a regulated digital assets and compliance platform for investors in Europe.\nRequirements\n- Experience designing KYC/KYB onboarding for regulated investment products.', FINTECH_CV);
  assert.ok(!blurb.some(m => /^Acme runs/.test(m.need)));
});

test('flattened postings: upper-case headings, inline bullets and the server metadata block', () => {
  const flat = '## Job metadata\nSource fallback: Ashby\nCompany: Acme\nRole: Product Designer\nCompensation: 80k\n\n## Job description\nABOUT ACME Acme builds payroll software. WHAT YOU\'LL DO - Design KYC/KYB onboarding flows for regulated investment products - Partner with engineers on GitHub pull requests every week COMPENSATION AND BENEFITS - Beautiful office in the heart of Paris with a regulated digital assets team - Health insurance';
  const matches = matchPostingToCv(flat, FINTECH_CV);
  assert.ok(matches.some(m => /^Design KYC\/KYB onboarding flows/.test(m.need)), JSON.stringify(matches.map(m => m.need)));
  assert.ok(!matches.some(m => /Beautiful office|Source fallback|Role: Product Designer|builds payroll/.test(m.need)));
});

test('a finished first job is not the current role; bold job lines are job headings', () => {
  const between = cvProofLines('## Experience\n### Product Designer : Beta Bank (2016 – 2019)\n- Designed KYC onboarding flows for retail banking customers with the compliance team.\n### Product Designer : Acme Pay (2012 – 2016)\n- Designed the checkout and payouts dashboard for merchants.');
  assert.ok(between.every(line => !line.current && !line.latest));
  const bold = cvProofLines('## Experience\n**Senior Product Designer — Acme Pay (2021 – Present)**\n- Designed the merchant payouts dashboard and its reconciliation views.\n**Product Designer — Beta Bank (2016 – 2019)**\n- Designed KYC onboarding flows for retail banking customers.');
  assert.deepEqual(bold.map(line => [line.employer, line.current]), [['Acme Pay', true], ['Beta Bank', false]]);
  // PDF bullet glyphs and dates first.
  const pdf = cvProofLines('## Work History\n### 2019 – 2023 | Product Designer | Qonto\n▪ Designed the SEPA transfer flow with the payments team.\n● Ran usability tests of the card onboarding with customers.');
  assert.equal(pdf.length, 2);
  assert.equal(pdf[0].employer, 'Qonto');
  assert.equal(pdf[0].dates, '2019 – 2023');
});

test('the MATCHES block keeps figures whole and hides every unnamed brand', () => {
  assert.match(proofExcerpt('Regulated platform: fractional real estate ownership from $10,000, daily USDC yield, VARA licensed, OTC desk.'), /\$10,000, daily USDC yield, VARA licensed\.$/);
  const block = formatPostingMatches([
    { need: 'OTC trading.', proof: 'Also shipped an OTC product alongside OneAsset.', employer: 'UpViral', role: 'Product Designer', current: false, latest: false, product: false, dates: '2024 – 2025' },
    { need: 'Agency work.', proof: 'Delivered 20+ client projects.', employer: 'Agence V0', role: 'Founder & Head of Product Design', current: false, latest: false, product: false, dates: '2020 – 2024' },
  ], { unnamedEmployers: ['OneAsset', 'UpViral', 'Agence V0'] });
  assert.ok(!/OneAsset|UpViral|Agence V0/.test(block), block);
  assert.match(block, /Also shipped an OTC product\./);
  assert.match(block, /a company the candidate founded/);
});

test('"in my current role" no longer frees the role-title words, and the masks are not posting terms', () => {
  const role = 'Senior Product Manager - Payments / Stablecoin';
  const body = groundEmail('I am applying for the role.', 'In my current role, I shipped the investor app. In my current role, I designed the stablecoin payment flows.', 'My CV is attached.');
  const claims = findUngroundedClaims(body, { cv: GROUND_CV, sourceText: `${role}\nWe are an equal opportunity employer.`, role, sameLanguage: true });
  assert.equal(claims.length, 1);
  assert.match(claims[0].sentence, /stablecoin payment flows/);
  // "At a previous employer" is the mask the prompt asks for, not "employer" from the posting.
  const masked = groundEmail('I am applying for the role.', 'At a previous employer, I designed mobile apps for gas station location.', 'My CV is attached.');
  assert.deepEqual(findUngroundedClaims(masked, { cv: GROUND_CV, sourceText: 'We are an equal opportunity employer.', sameLanguage: true }), []);
});

test('a fact slipped into the ask paragraph is checked; the ask itself is not', () => {
  const body = ['Hello,', 'I am applying for the Payments role.', 'In my current role, I shipped the investor app.', 'I also built the payout callbacks for 57 fiat currencies. My CV is attached. Let me know if a call works.', 'Best,\nHugo Vermot'].join('\n\n');
  const claims = findUngroundedClaims(body, { cv: GROUND_CV, sourceText: 'Payouts and callbacks across 57 fiat currencies.', sameLanguage: true });
  assert.equal(claims.length, 1);
  assert.match(claims[0].sentence, /^I also built the payout callbacks/);
});

test('fixCurrentRoleAttribution leaves a sentence that already names the other employer', () => {
  const cv = [
    '### Professional Experience',
    '#### Product Lead : OneAsset (Feb 2026 – Present)',
    '- Designed compliance UX for a VARA-licensed RWA product: KYB/KYC onboarding, reporting workflows.',
    '#### Senior Product Designer : Société Générale (Feb 2023 – Oct 2024)',
    '- Navigated MIF2 regulatory constraints and investor-profile validation to keep the flows compliant.',
  ].join('\n');
  const body = ['Hello,', 'I am applying for the role.', 'In my current role, I designed KYB/KYC onboarding for a VARA-licensed product, and at Société Générale I navigated MIF2 regulatory constraints and investor-profile validation.', 'My CV is attached.', 'Best,\nHugo Vermot'].join('\n\n');
  const { body: out, fixed } = fixCurrentRoleAttribution(body, cv, { unnamedEmployers: ['OneAsset'] });
  assert.deepEqual(fixed, []);
  assert.equal(out, body);
});

test('a founder never gets the need-by-need structure', () => {
  const matches = matchPostingToCv(PAYMENTS_POSTING, FINTECH_CV);
  const recipient = withContact(parseRecipient('gabriel@paymonade.tech'), { firstName: 'Gabriel', title: 'CEO' });
  const prompt = buildApplicationEmailMessages({ cv: FINTECH_CV, profileData: PROFILE, recipient, jobText: PAYMENTS_POSTING, matches });
  assert.ok(!/## MATCHES/.test(prompt.user));
  assert.ok(!/one sentence per match/.test(prompt.system));
});

test('a CV bullet copied as a sentence gets its subject back in English', () => {
  const body = formatApplicationEmail('Hello,\n\nI am applying for the PM role at Paymonade.\n\nIn my current role, I lead product at a regulated platform. Designed compliance UX for a VARA-licensed product. Ran a full UX/UI audit and data analysis. Designed Figma kits stays as is.\n\nMy CV is attached.', { language: 'en', profileData: PROFILE });
  assert.match(body, /I designed compliance UX for a VARA-licensed product\. I ran a full UX\/UI audit/);
  assert.match(body, /Designed Figma kits stays as is\./);
});

// ── Second review round (2026-10-08) ───────────────────────────────────────

test('French role headings and "Who we are looking for" are needs, not company sections', () => {
  const body = 'Vous concevrez les parcours d’onboarding KYC/KYB et les outils de conformité pour nos clients institutionnels régulés.';
  for (const heading of ['À propos du poste', 'À propos de l’offre d’emploi', 'À PROPOS DU POSTE', 'Descriptif du poste']) {
    const needs = matchPostingToCv(`${heading}\n${body}\n`, FINTECH_CV);
    assert.ok(needs.some(m => m.need === body), heading);
  }
  const looking = 'Experience designing compliance products: KYC/KYB onboarding, AML reviews and audit trails.';
  for (const heading of ['Who we are looking for', 'WHO WE ARE LOOKING FOR', 'Who We Are Looking For:', 'Who we’re looking for']) {
    const matches = matchPostingToCv(`About Acme\nAcme builds stablecoin payment rails.\n\n${heading}\n- ${looking}\n`, FINTECH_CV);
    assert.ok(matches.some(m => m.need === looking), heading);
  }
  // "Qui sommes-nous ?" then an unlisted role heading: the role section is not swallowed.
  const fr = matchPostingToCv('Qui sommes-nous ?\nNous sommes une fintech B2B de paiements en stablecoins.\n\nVotre Quotidien Chez Nous\nVous concevrez les parcours d’onboarding KYC/KYB et les outils de conformité pour nos clients régulés.', FINTECH_CV);
  assert.ok(fr.some(m => /parcours d’onboarding KYC\/KYB/.test(m.need)), JSON.stringify(fr));
});

test('upper-case words inside a line are not headings; perks never become needs', () => {
  const posting = 'Requirements\n- Experience with KYC AML SEPA flows in a regulated investment product for European customers.\nPerks & Benefits https://acme.com/perks\n- Health insurance and a learning budget for every designer on the team.';
  const matches = matchPostingToCv(posting, FINTECH_CV);
  assert.ok(matches.some(m => /^Experience with KYC AML SEPA flows/.test(m.need)));
  assert.ok(!matches.some(m => /Health insurance/.test(m.need)));
});

test('a single concept carried by its own trigger word does not make a pair', () => {
  const cv = '### Professional Experience\n#### Product Designer : LVMH Group (2022 – 2023)\n- Built journey maps and internal monitoring tools for distributed brand teams.';
  assert.deepEqual(matchPostingToCv('Requirements\n- Improve monitoring, alerts and incident procedures with Engineering.', cv), []);
  const fin = '### Professional Experience\n#### Product Designer : Société Générale (2023 – 2024)\n- Designed savings, allocation and investment flows across desktop and mobile.';
  assert.ok(!matchPostingToCv('Requirements\n- Own the investigation tooling used by our operations analysts.', fin).some(m => m.concepts.includes('finance')));
});

test('CV labels and titles are never read as jobs or employers', () => {
  const lines = cvProofLines('## Experience\n\n**Senior Product Designer — Acme Pay (2022 – Present)**\n**Key achievements:**\n- Designed the payout reconciliation dashboard used by finance teams daily.\n**Tools:** Figma, Linear\n**Product Designer — Beta Bank (2018 – 2022)**\n- Designed KYC onboarding flows for retail banking customers.');
  assert.deepEqual(lines.map(l => [l.employer, l.latest]), [['Acme Pay', true], ['Beta Bank', false]]);
  assert.deepEqual(parseRoleHeading('UX Republic — Product Designer (2019 – 2021)'), { role: 'Product Designer', employer: 'UX Republic', dates: '2019 – 2021' });
  // "Product Owner" at an unnamed employer did not found it.
  const block = formatPostingMatches([{ need: 'KYC.', proof: 'Owned the KYC onboarding backlog.', employer: 'Bloomly', role: 'Product Owner', current: false, latest: false, product: false, dates: '2019 – 2022' }], { unnamedEmployers: ['Bloomly'] });
  assert.match(block, /previous employer/);
  assert.ok(!/founded/.test(block));
});

test('between jobs: "in my current role" on a finished job gets that employer', () => {
  const cv = '# Jane Doe\n## Experience\n### Product Designer : Beta Bank (2016 – 2019)\n- Designed KYC onboarding flows for retail banking customers with the compliance team.\n### Product Designer : Acme Pay (2012 – 2016)\n- Designed the checkout and payouts dashboard for merchants.';
  const body = ['Hello,', 'I am applying for the role.', 'In my current role, I designed KYC onboarding flows for retail banking customers.', 'My CV is attached.', 'Best,\nJane Doe'].join('\n\n');
  const { body: out, fixed } = fixCurrentRoleAttribution(body, cv);
  assert.equal(fixed.length, 1);
  assert.match(out, /At Beta Bank, I designed KYC onboarding flows/);
});

test('the ask paragraph keeps its forward request; a payments claim slipped into it is still caught', () => {
  const source = 'We are hiring a Senior PM for our payments team. Payouts, callbacks and reconciliation.';
  const ask = ['Hello,', 'I am applying for the role.', 'In my current role, I shipped the investor app.', 'I’d appreciate it if you could pass this along to the person hiring for your payments team.', 'Best,\nHugo Vermot'].join('\n\n');
  assert.deepEqual(findUngroundedClaims(ask, { cv: GROUND_CV, sourceText: source, sameLanguage: true }), []);
  const slipped = ['Hello,', 'I am applying for the role.', 'In my current role, I shipped the investor app.', 'I also owned payouts and callbacks. My CV is attached.', 'Best,\nHugo Vermot'].join('\n\n');
  const claims = findUngroundedClaims(slipped, { cv: GROUND_CV, sourceText: source, sameLanguage: true });
  assert.equal(claims.length, 1);
  assert.match(claims[0].sentence, /payouts and callbacks/);
});

test('ensureRoleOpener: no second opener when the role is already named; French elision', () => {
  const named = 'Hello,\n\nThe Senior Product Manager opening at Paymonade caught my eye.\n\nIn my current role I designed KYB/KYC onboarding.\n\nMy CV is attached.\n\nBest,\nHugo Vermot';
  assert.equal(ensureRoleOpener(named, { role: 'Senior Product Manager', company: 'Paymonade' }), named);
  const fr = ensureRoleOpener('Bonjour,\n\nVous cherchez quelqu’un pour les parcours KYC.\n\nMon CV est en pièce jointe.\n\nBien à vous,\nHugo Vermot', { role: 'Ingénieur produit', company: 'Qonto', language: 'fr' });
  assert.match(fr, /Je postule au poste d’Ingénieur produit chez Qonto\./);
});

test('a sentence right after "In my current role" that restates an earlier job gets that job', () => {
  const cv = [
    '### Professional Experience',
    '#### Product Lead : OneAsset (Feb 2026 – Present)',
    '- Designed compliance UX for a VARA-licensed RWA product: KYB/KYC onboarding, reporting workflows, investor flows.',
    '- Built interactive prototypes entirely in Cursor and Claude Code and ran a GitHub flow with engineering.',
    '#### Senior Product Designer : BMW Group (2021 – 2022)',
    "- Ran a full UX/UI audit and data analysis to identify the site's weakest conversion points.",
  ].join('\n');
  const body = ['Hello,', 'I am applying for the role.', "In my current role, I designed compliance UX for a VARA-licensed RWA product. I ran a full UX/UI audit and data analysis to identify the site's weakest conversion points. I built interactive prototypes entirely in Cursor and Claude Code.", 'My CV is attached.', 'Best,\nHugo Vermot'].join('\n\n');
  const { body: out, fixed } = fixCurrentRoleAttribution(body, cv, { unnamedEmployers: ['OneAsset'] });
  assert.equal(fixed.length, 1);
  assert.match(out, /In my current role, I designed compliance UX[^.]*\. At BMW Group, I ran a full UX\/UI audit[^.]*\. I built interactive prototypes/);
  // No current-role sentence before it: nothing is implied, nothing changes.
  const plain = ['Hello,', 'I am applying for the role.', "I ran a full UX/UI audit and data analysis to identify the site's weakest conversion points.", 'My CV is attached.', 'Best,\nHugo Vermot'].join('\n\n');
  assert.deepEqual(fixCurrentRoleAttribution(plain, cv).fixed, []);
});

// ── Model reading of posting and CV, checked by code (2026-10-09) ──────────

const PLAIN_CV = [
  'JANE DOE',
  'Product designer',
  '',
  'SUMMARY',
  'Designer with eight years in regulated finance and payments products.',
  '',
  'PROFESSIONAL EXPERIENCE',
  'Senior Product Designer | Qonto (2021 – Present)',
  'Business banking platform for European SMEs, licensed in France.',
  '• Designed the KYC/KYB onboarding and the compliance review tools with the risk team.',
  '• Ran usability tests of the SEPA transfer flow with customers every sprint.',
  'Product Designer | Beta Bank (2016 – 2021)',
  '• Designed savings and investment flows under MIF2 rules for retail customers.',
  '',
  'EDUCATION',
  '• Master in interaction design, Strate School of Design, Paris, 2016.',
].join('\n');

test('a CV pasted from a PDF: upper-case titles, "|" job lines and "•" bullets are read like markdown', () => {
  const lines = cvProofLines(PLAIN_CV);
  assert.deepEqual(lines.map(l => [l.employer, l.product, l.latest]), [
    ['Qonto', true, true],
    ['Qonto', false, true],
    ['Qonto', false, true],
    ['Beta Bank', false, false],
  ]);
  assert.ok(!lines.some(l => /Strate|eight years/.test(l.text)), 'summary and education are not proofs');
});

test('numberCvLines hides summary, skills and education lines from the model and keeps the job lines', () => {
  const numbered = numberCvLines(PLAIN_CV);
  assert.ok(numbered.some(l => /KYC\/KYB onboarding/.test(l.text) && l.section === 'PROFESSIONAL EXPERIENCE'));
  assert.ok(!numbered.some(l => /eight years|Strate School/.test(l.text)));
  const md = numberCvLines('# Jane\n### Summary\nDesigner in finance.\n### Professional Experience\n#### Designer : Qonto (2021 – Present)\n- Designed the KYC/KYB onboarding with the risk team.\n- Dates and metrics are not on file.');
  assert.deepEqual(md.map(l => l.text), ['# Jane', '### Professional Experience', '#### Designer : Qonto (2021 – Present)', '- Designed the KYC/KYB onboarding with the risk team.']);
});

test('validatePostingMatches keeps only what the posting and the CV really say', () => {
  const jobText = 'Responsibilities\n- Translate compliance requirements, including KYC/KYB and AML, into user flows and review tools.\n- Lead the SEPA payments roadmap.';
  const cvLines = numberCvLines(PLAIN_CV);
  const at = re => cvLines.findIndex(l => re.test(l.text)) + 1;
  const reply = {
    matches: [
      // A good pair, with the job's product line as "employer": the rules' employer wins.
      { need: 'KYC/KYB compliance flows', quote: 'including KYC/KYB and AML, into user flows', lines: [at(/KYC\/KYB onboarding/)], employer: 'Business banking platform for European SMEs, licensed in France.', current: true, strength: 'strong' },
      // A quote the posting does not contain.
      { need: 'Card acquiring', quote: 'Own card acquiring and chargebacks end to end', lines: [at(/SEPA transfer/)], employer: 'Qonto', strength: 'strong' },
      // A line number that does not exist.
      { need: 'SEPA payments', quote: 'Lead the SEPA payments roadmap', lines: [999], employer: 'Qonto', strength: 'strong' },
      // The model calls it strong; the CV line shares nothing with the need.
      { need: 'Payments roadmap', quote: 'Lead the SEPA payments roadmap', lines: [at(/savings and investment/)], employer: 'Beta Bank', strength: 'strong' },
    ],
  };
  const kept = validatePostingMatches(JSON.stringify(reply), { jobText, cv: PLAIN_CV, cvLines });
  assert.equal(kept.length, 1, JSON.stringify(kept, null, 1));
  assert.equal(kept[0].employer, 'Qonto');
  assert.equal(kept[0].latest, true);
  assert.match(kept[0].proof, /^Designed the KYC\/KYB onboarding/);
  assert.ok(kept[0].score >= 2.3);
  assert.deepEqual(validatePostingMatches('no json here', { jobText, cv: PLAIN_CV, cvLines }), []);
});

test('mergePostingMatches keeps the best pair per CV line and per need, and borrows a missing employer', () => {
  const rules = [
    { need: 'Translate compliance requirements, including KYC/KYB and AML, into user flows.', proof: 'Designed the KYC/KYB onboarding.', employer: '', score: 4.9, concepts: ['compliance'], current: false, latest: false },
    { need: 'Strong analytical skills with SQL.', proof: 'Ran a conversion audit with data analysis.', employer: 'BMW Group', score: 4.1, concepts: ['data'], current: false, latest: false },
  ];
  const model = [
    { need: 'KYC/KYB compliance flows', quote: 'including KYC/KYB and AML', proof: 'Designed the KYC/KYB onboarding.', employer: 'Qonto', score: 5.2, concepts: ['compliance'], current: true, latest: true, source: 'model' },
    { need: 'Regulated digital assets', quote: 'regulated financial services and digital assets', proof: 'Licensed business banking platform.', employer: 'Qonto', score: 2.0, concepts: ['finance'], current: true, latest: true, source: 'model' },
  ];
  const merged = mergePostingMatches(rules, model);
  assert.deepEqual(merged.map(m => [m.score, m.employer]), [[5.2, 'Qonto'], [4.1, 'BMW Group']]);
});

test('generateApplicationEmail asks the model for the pairs only when the rules are unsure, and survives a broken reply', async () => {
  const jobText = 'Responsibilities\n- Translate compliance requirements, including KYC/KYB onboarding and AML, into user flows and review tools.';
  const email ='COMPANY: Acme\nROLE: Product Designer\nLANGUAGE: en\nSUBJECT: Product Designer - Jane Doe\nBODY:\nHello,\n\nI\'m applying for the Product Designer role at Acme. You need someone who has built KYC flows.\n\nIn my current role, I designed the KYC/KYB onboarding and the compliance review tools with the risk team.\n\nMy CV is attached. Please forward it to the person hiring for this role.';
  const calls = [];
  const chat = async ({ systemPrompt }) => {
    const matching = /pair a job posting/.test(systemPrompt || '');
    calls.push(matching ? 'match' : 'email');
    if (matching) return 'not json';
    return email;
  };
  const draft = await generateApplicationEmail({ chat, model: 'test', cv: PLAIN_CV, jobText, profileData: { candidate: { full_name: 'Jane Doe' } }, recipient: parseRecipient('jobs@acme.com') });
  assert.ok(draft.body.includes('KYC/KYB onboarding'));
  // The rules found a strong pair on this CV: no model call for the matching.
  assert.deepEqual(calls.filter(c => c === 'match'), []);
  // A posting the rules cannot pair: the model is asked; its broken reply falls back to the rules.
  calls.length = 0;
  const vague = 'We are a fast-growing startup. You will shape the future of our product with a great team.';
  const second = await generateApplicationEmail({ chat, model: 'test', cv: PLAIN_CV, jobText: vague, profileData: { candidate: { full_name: 'Jane Doe' } }, recipient: parseRecipient('jobs@acme.com') });
  assert.ok(second && second.body);
  assert.deepEqual(calls.filter(c => c === 'match'), ['match']);
});

test('fixCurrentRoleAttribution knows the employers of a plain-text CV and never names one twice', () => {
  const body = ['Hello,', 'I am applying for the role.', 'In my current role, I designed the KYC/KYB onboarding and the compliance review tools. I designed savings and investment flows under MIF2 rules for retail customers at Beta Bank.', 'My CV is attached.', 'Best,\nJane Doe'].join('\n\n');
  const { body: out, fixed } = fixCurrentRoleAttribution(body, PLAIN_CV);
  assert.deepEqual(fixed, []);
  assert.equal(out, body);
  const implied = body.replace(' at Beta Bank.', '.');
  const fixedImplied = fixCurrentRoleAttribution(implied, PLAIN_CV);
  assert.match(fixedImplied.body, /At Beta Bank, I designed savings and investment flows/);
});

// ── The CV's jobs read by the model, checked and cached (2026-10-09) ───────

const LINKEDIN_CV = [
  'Camille Martin',
  'Senior Product Designer',
  'Experience',
  'Qonto',
  'Senior Product Designer',
  'March 2021 - Present (3 years 8 months)',
  'Paris, France',
  'Designed the KYC/KYB onboarding and the compliance review tools with the risk team.',
  'Lydia',
  'Product Designer',
  'January 2018 - February 2021 (3 years 2 months)',
  'Designed peer-to-peer payments and the expense sharing flow for students.',
  'Education',
  'Strate School of Design, Master, 2017',
].join('\n');

test('the rules misread a LinkedIn export, and say they are unsure', () => {
  assert.equal(cvRulesLookUnsure(cvProofLines(LINKEDIN_CV)), true);
  assert.equal(cvRulesLookUnsure(cvProofLines(FINTECH_CV)), false);
  // One "employer" for every job is a city, not an employer.
  const city = cvProofLines('## Experience\n### Senior Product Designer, Qonto — Paris (2021 – Present)\n- Designed the KYC onboarding for small businesses.\n### Product Designer, Lydia — Paris (2018 – 2021)\n- Designed peer-to-peer payments for students.\n- Ran usability tests every sprint with students.');
  assert.equal(cvRulesLookUnsure(city), true);
});

test('validateCvStructure keeps what the heading lines say and decides "current" from the dates', () => {
  const cvLines = numberCvLines(LINKEDIN_CV, 30000, { all: true });
  const at = text => cvLines.findIndex(line => line.text === text) + 1;
  const reply = JSON.stringify({ jobs: [
    // Right job; the model's "current" agrees with "Present".
    { employer: 'Qonto', title: 'Senior Product Designer', dates: 'March 2021 - Present (3 years 8 months)', current: false, kind: 'employee', first_line: at('Qonto'), last_line: at('Designed the KYC/KYB onboarding and the compliance review tools with the risk team.') },
    // An employer not in the heading lines; "current" contradicted by a closed range.
    { employer: 'Revolut', title: 'Product Designer', dates: 'January 2018 - February 2021 (3 years 2 months)', current: true, kind: 'employee', first_line: at('Lydia'), last_line: 999 },
    // Overlapping, out-of-range and broken rows are dropped.
    { employer: 'Qonto', title: 'X', first_line: 0, last_line: 3 },
    { employer: 'Qonto', title: 'X', first_line: 'L2', last_line: 'L1' },
  ] });
  const jobs = validateCvStructure(reply, cvLines);
  assert.deepEqual(jobs.map(job => [job.employer, job.title, job.current]), [['Qonto', 'Senior Product Designer', true], ['', 'Product Designer', false]]);
  const proofs = structureProofLines(jobs, cvLines);
  assert.deepEqual(proofs.map(p => [p.employer, p.latest, p.text.slice(0, 20)]), [['Qonto', true, 'Designed the KYC/KYB'], ['', false, 'Designed peer-to-pee']]);
});

test('structureProofLines: the latest job is the current one at a company, not a side project', () => {
  const cvLines = numberCvLines('Side project | Ancient World (2024 – Present)\n- Built a multiplayer game economy with inventory and quests.\nProduct Lead | OneAsset (2026 – Present)\n- Designed the KYB/KYC onboarding of a regulated platform.', 30000, { all: true });
  const jobs = [
    { employer: 'Ancient World', title: 'Side project', dates: '2024 – Present', current: true, own: true, first: 1, last: 2 },
    { employer: 'OneAsset', title: 'Product Lead', dates: '2026 – Present', current: true, own: false, first: 3, last: 4 },
  ];
  const proofs = structureProofLines(jobs, cvLines);
  assert.deepEqual(proofs.map(p => [p.employer, p.latest]), [['Ancient World', false], ['OneAsset', true]]);
});

test('a reply cut at the token limit keeps its complete jobs', () => {
  const cvLines = numberCvLines(LINKEDIN_CV, 30000, { all: true });
  const cut = '{"jobs":[{"employer":"Qonto","title":"Senior Product Designer","dates":"March 2021 - Present (3 years 8 months)","current":true,"kind":"employee","first_line":4,"last_line":8},{"employer":"Lyd';
  assert.deepEqual(validateCvStructure(cut, cvLines).map(job => job.employer), ['Qonto']);
});

test('readCvStructure: one call per CV, shared while pending, not kept when it fails', async () => {
  let calls = 0;
  // A complete read (both jobs): no second read.
  const reply = '{"jobs":[{"employer":"Qonto","title":"Senior Product Designer","dates":"March 2021 - Present (3 years 8 months)","current":true,"kind":"employee","first_line":4,"last_line":8},{"employer":"Lydia","title":"Product Designer","dates":"January 2018 - February 2021 (3 years 2 months)","current":false,"kind":"employee","first_line":9,"last_line":12}]}';
  const chat = async () => { calls += 1; return reply; };
  const cv = `${LINKEDIN_CV}\n(cache test ${Math.random()})`;
  const [a, b] = await Promise.all([readCvStructure({ chat, model: 'test', cv }), readCvStructure({ chat, model: 'test', cv })]);
  assert.equal(calls, 1);
  assert.equal(a, b);
  assert.equal(a.proofs[0].employer, 'Qonto');
  await readCvStructure({ chat, model: 'test', cv });
  assert.equal(calls, 1);
  let failing = 0;
  const broken = async () => { failing += 1; return 'not json'; };
  const other = `${LINKEDIN_CV}\n(failure test ${Math.random()})`;
  await assert.rejects(readCvStructure({ chat: broken, model: 'test', cv: other }));
  await assert.rejects(readCvStructure({ chat: broken, model: 'test', cv: other }));
  // Each failed read tries twice (a second read after a weak first one), and is not cached.
  assert.equal(failing, 4);
});

test('an email from a LinkedIn-export CV names the right employer and current job', async () => {
  const cv = `${LINKEDIN_CV}\n(email test ${Math.random()})`;
  const cvLines = numberCvLines(cv, 30000, { all: true });
  const at = text => cvLines.findIndex(line => line.text === text) + 1;
  const structure = JSON.stringify({ jobs: [
    { employer: 'Qonto', title: 'Senior Product Designer', dates: 'March 2021 - Present (3 years 8 months)', current: true, kind: 'employee', first_line: at('Qonto'), last_line: at('Paris, France') + 1 },
    { employer: 'Lydia', title: 'Product Designer', dates: 'January 2018 - February 2021 (3 years 2 months)', current: false, kind: 'employee', first_line: at('Lydia'), last_line: at('Lydia') + 3 },
  ] });
  const email = 'COMPANY: Acme\nROLE: Product Designer\nLANGUAGE: en\nSUBJECT: Product Designer - Camille Martin\nBODY:\nHello,\n\nI\'m applying for the Product Designer role at Acme. You need someone who has built KYC onboarding flows.\n\nIn my current role, I designed the KYC/KYB onboarding and the compliance review tools with the risk team. In my current role, I designed peer-to-peer payments and the expense sharing flow for students.\n\nMy CV is attached. Please forward it to the person hiring for this role.';
  const seen = [];
  const chat = async ({ systemPrompt, messages }) => {
    if (/list the jobs in it/.test(systemPrompt || '')) { seen.push('structure'); return structure; }
    seen.push(/pair a job posting/.test(systemPrompt || '') ? 'match' : 'email');
    if (seen.at(-1) === 'email') seen.push(messages[0].content.includes('Qonto, current role') ? 'qonto-current' : 'no-qonto-current');
    return seen.at(-1) === 'match' ? '{"matches":[]}' : email;
  };
  const jobText = 'Requirements\n- Experience designing KYC/KYB onboarding and compliance review tools with a risk team.';
  const draft = await generateApplicationEmail({ chat, model: 'test', cv, jobText, profileData: { candidate: { full_name: 'Camille Martin' } }, recipient: parseRecipient('jobs@acme.com') });
  assert.ok(seen.includes('structure'), JSON.stringify(seen));
  assert.ok(seen.includes('qonto-current'), JSON.stringify(seen));
  // The Lydia sentence wrongly labelled "current role" gets its employer.
  assert.match(draft.body, /At Lydia, I designed peer-to-peer payments/);
});

// ── Fourth review round: uncertain reads never become false labels ──────────

test('a job the model anchors on the profile header, with nothing under it, is dropped', () => {
  const cv = 'Camille Martin\nSenior Product Designer at Qonto\nParis, Île-de-France, France\nSummary\nDesigner in payments.\nExperience\nQonto\nSenior Product Designer\nMarch 2021 - Present (3 years 8 months)\nDesigned the KYC/KYB onboarding and the compliance review tools with the risk team.';
  const cvLines = numberCvLines(cv, 30000, { all: true });
  const jobs = validateCvStructure({ jobs: [{ employer: 'Qonto', title: 'Senior Product Designer', dates: '', current: true, kind: 'employee', first_line: 2, last_line: 10 }] }, cvLines);
  assert.deepEqual(jobs, []);
  // A place is never a proof line.
  const placed = structureProofLines([{ employer: 'Qonto', title: 'Senior Product Designer', dates: 'March 2021 - Present', current: true, own: false, first: 7, last: 10 }], numberCvLines('a\nb\nc\nd\ne\nf\nQonto\nParis, Île-de-France, France\nMarch 2021 - Present\nDesigned the KYC/KYB onboarding and the compliance review tools with the risk team.', 30000, { all: true }));
  assert.deepEqual(placed.map(p => p.text.slice(0, 12)), ['Designed the']);
});

test('LinkedIn grouped positions keep the company line above them', () => {
  const cv = 'Experience\nQonto\n3 years 8 months\nProduct Design Lead\nMarch 2023 - Present (1 year 8 months)\nI lead a team of four designers on account opening and KYC verification.\nSenior Product Designer\nMarch 2021 - March 2023 (2 years 1 month)\nDesigned the SEPA transfer flow and the card spending dashboard for SMEs.';
  const cvLines = numberCvLines(cv, 30000, { all: true });
  const jobs = validateCvStructure({ jobs: [
    { employer: 'Qonto', title: 'Product Design Lead', dates: 'March 2023 - Present (1 year 8 months)', current: true, kind: 'employee', first_line: 4, last_line: 6 },
    { employer: 'Qonto', title: 'Senior Product Designer', dates: 'March 2021 - March 2023 (2 years 1 month)', current: false, kind: 'employee', first_line: 7, last_line: 9 },
  ] }, cvLines);
  assert.deepEqual(jobs.map(job => [job.employer, job.current]), [['Qonto', true], ['Qonto', false]]);
});

test('the rules say they are unsure when a city, a date or a role holds the employer', () => {
  const lines = (a, b) => [
    { text: 'Designed the KYC onboarding for SMEs.', role: 'Senior Product Designer', employer: a, dates: '2021 – Present', latest: true, current: true },
    { text: 'Ran usability tests every sprint.', role: 'Senior Product Designer', employer: a, dates: '2021 – Present', latest: true, current: true },
    { text: 'Designed peer-to-peer payments.', role: 'Product Designer', employer: b, dates: '2018 – 2021', latest: false, current: false },
  ];
  assert.equal(cvRulesLookUnsure(lines('Paris', 'Lyon'), 'Camille Martin\ncamille@example.com | Paris'), true);
  assert.equal(cvRulesLookUnsure(lines('Qonto · 2021', 'Lydia · 2018'), ''), true);
  assert.equal(cvRulesLookUnsure(lines('Remote', 'Paris'), ''), true);
  assert.equal(cvRulesLookUnsure(lines('Qonto', 'Lydia'), 'Camille Martin\ncamille@example.com | Paris'), false);
  const comma = lines('Paris', 'Lyon').map(line => ({ ...line, role: `${line.role}, Qonto` }));
  assert.equal(cvRulesLookUnsure(comma, ''), true);
});

test('the latest job is the first current one at a company in CV order; a second current employer is not "previous"', () => {
  const jobs = [
    { employer: 'Qonto', title: 'Senior Product Designer', dates: '2019 – Present', current: true, own: false, first: 1, last: 2 },
    { employer: 'Gobelins Paris', title: 'Lecturer (part-time)', dates: '2023 – Present', current: true, own: false, first: 3, last: 4 },
  ];
  const proofs = structureProofLines(jobs, numberCvLines('Senior Product Designer | Qonto (2019 – Present)\n- Redesigned the account opening and KYC verification flow.\nLecturer | Gobelins Paris (2023 – Present)\n- Teach a weekly class on interaction design for payments.', 30000, { all: true }));
  assert.deepEqual(proofs.map(p => [p.employer, p.latest, p.current]), [['Qonto', true, true], ['Gobelins Paris', false, true]]);
  const block = formatPostingMatches([{ need: 'Teaching.', proof: proofs[1].text, employer: 'Gobelins Paris', role: 'Lecturer', current: true, latest: false, own: false, product: false, dates: '2023 – Present' }], { unnamedEmployers: ['Gobelins Paris'] });
  assert.match(block, /in my current role/);
  assert.equal(maskUnnamedEmployers('At Qonto SAS I designed the flow.', { unnamedEmployers: ['Qonto'], latestNames: ['Qonto SAS'] }).body, 'In my current role I designed the flow.');
});

test('fixCurrentRoleAttribution changes nothing when the current job is unknown or the sentence only borrows a few words', () => {
  const proofs = [
    { text: 'Paris, Île-de-France, France is where the team sits every day.', role: '', employer: '', dates: '', current: true, latest: true, own: false },
    { text: 'Ran A/B tests on the checkout conversion funnel for a mobile payments app.', role: 'Product Designer', employer: 'Lydia', dates: '2018 – 2021', current: false, latest: false, own: false },
  ];
  const body = ['Hello,', 'I am applying for the role.', 'In my current role, I redesigned the KYC onboarding flow and cut drop-off on the checkout conversion funnel by 18%.', 'My CV is attached.', 'Best,\nCamille Martin'].join('\n\n');
  assert.deepEqual(fixCurrentRoleAttribution(body, '', { proofs }).fixed, []);
  const known = [{ ...proofs[0], employer: 'Qonto', text: 'Redesigned the account opening and KYC verification for 40,000 small businesses.' }, proofs[1]];
  assert.deepEqual(fixCurrentRoleAttribution(body, '', { proofs: known }).fixed, []);
});

test('a weak first read of the CV gets a second one, and the better read is kept', async () => {
  const cv = `${LINKEDIN_CV}\n(retry test ${Math.random()})`;
  const cvLines = numberCvLines(cv, 30000, { all: true });
  const at = text => cvLines.findIndex(line => line.text === text) + 1;
  const good = JSON.stringify({ jobs: [
    { employer: 'Qonto', title: 'Senior Product Designer', dates: 'March 2021 - Present (3 years 8 months)', current: true, kind: 'employee', first_line: at('Qonto'), last_line: at('Paris, France') + 1 },
    { employer: 'Lydia', title: 'Product Designer', dates: 'January 2018 - February 2021 (3 years 2 months)', current: false, kind: 'employee', first_line: at('Lydia'), last_line: at('Lydia') + 3 },
  ] });
  // First read: Qonto anchored on the headline at the top, nothing under it.
  const weak = JSON.stringify({ jobs: [
    { employer: 'Qonto', title: 'Senior Product Designer', dates: '', current: true, kind: 'employee', first_line: 2, last_line: 2 },
    { employer: 'Lydia', title: 'Product Designer', dates: 'January 2018 - February 2021 (3 years 2 months)', current: false, kind: 'employee', first_line: at('Lydia'), last_line: at('Lydia') + 3 },
  ] });
  const prompts = [];
  const chat = async ({ messages }) => { prompts.push(messages[0].content); return prompts.length === 1 ? weak : good; };
  const read = await readCvStructure({ chat, model: 'test', cv });
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /anchor each job on its own heading line/);
  assert.ok(read.proofs.some(p => p.employer === 'Qonto' && p.latest));
  // A good first read is not read twice.
  const once = [];
  await readCvStructure({ chat: async ({ messages }) => { once.push(messages[0].content); return good; }, model: 'test', cv: `${LINKEDIN_CV}\n(once ${Math.random()})` });
  assert.equal(once.length, 1);
});

test('a CV from the onboarding import (H2 dialect) is read by the rules, with employers and dates', () => {
  const cv = ['# Camille Martin', 'Senior Product Designer', '', '**Email:** camille@example.com  ', '**Location:** Paris', '', '## Summary', '', 'Designer in payments.', '', '## Experience', '', '### Qonto', '**Senior Product Designer**', 'March 2021 – Present · Paris', '- Designed the KYC/KYB onboarding and the compliance review tools with the risk team.', '- Ran usability tests of the SEPA transfer flow with customers every sprint.', '', '### Lydia', '**Product Designer**', '2018 – 2021', '- Designed peer-to-peer payments and the expense sharing flow for students.', '', '## Education', '', '### Master in interaction design', 'Strate, 2016 – 2018'].join('\n');
  const proofs = cvProofLines(cv);
  assert.deepEqual([...new Set(proofs.map(p => `${p.employer}|${p.role}|${p.latest}`))], ['Qonto|Senior Product Designer|true', 'Lydia|Product Designer|false']);
  assert.equal(cvRulesLookUnsure(proofs, cv), false);
  assert.ok(indexCvExperiences(cv).some(item => item.names.includes('Qonto')));
});

test('the audit flags two paragraphs that say the same thing and a sentence copied from the CV', async () => {
  const { auditApplicationEmail } = await import('../lib/application-email.mjs');
  const cv = 'I shipped a full investor app, admin panel and marketing site in six months with one Product Owner at my current role.';
  const body = [
    'Hi,',
    'I shipped a full investor app, admin panel and marketing site in six months with one Product Owner at my current role. The prototypes were built in Cursor and Claude Code.',
    'The prototypes were built in Cursor and Claude Code, then reviewed with the investor app, admin panel and marketing site shipped in six months.',
    'My CV is attached. Can we talk?',
  ].join('\n\n');
  const issues = auditApplicationEmail({ subject: 'Designer - Hugo', body, language: 'en' }, { copySource: cv });
  assert.ok(issues.some(issue => /répètent la même chose/.test(issue)), issues.join('\n'));
  assert.ok(issues.some(issue => /recopiée du CV/.test(issue)), issues.join('\n'));
});

test('the main description reaches the prompt and no candidate fact is hard-coded in the voice rules', async () => {
  const { buildApplicationEmailMessages, candidateDescription, EMAIL_VOICE_RULES } = await import('../lib/application-email.mjs');
  const profileData = { narrative: { headline: 'Data engineer', exit_story: 'Builds payment pipelines for fintech teams.', next_role: 'Senior data role' } };
  assert.match(candidateDescription(profileData).text, /payment pipelines/);
  const { system, user } = buildApplicationEmailMessages({ cv: '# CV', profileData, jobText: 'We build ledgers. Looking for a data engineer.' });
  assert.match(system, /BASE OF THE EMAIL/);
  assert.match(user, /MAIN DESCRIPTION[\s\S]*payment pipelines/);
  assert.doesNotMatch(EMAIL_VOICE_RULES, /investor app|Product Owner/);
});

test('offerLinkIssues warns when nothing was read, and when the email shares no subject with the offer', async () => {
  const { offerLinkIssues } = await import('../lib/application-email.mjs');
  assert.equal(offerLinkIssues({ body: 'Hi\n\nx\n\nBye', role: '' }, {}).length, 1);
  const posting = 'We are building a compliance dashboard for stablecoin payments and onboarding flows.';
  assert.equal(offerLinkIssues({ body: 'Hi\n\nI built compliance onboarding flows for payments, and I want to join because your payments dashboard serves them.\n\nBye', role: 'Designer' }, { jobText: posting }).length, 0);
  assert.equal(offerLinkIssues({ body: 'Hi\n\nI like gardening and cooking every weekend.\n\nBye', role: 'Designer' }, { jobText: posting }).some(issue => /aucun sujet/.test(issue)), true);
});

test('a tool slash becomes "and", acronyms stay, and a motivation sentence with a reason survives', async () => {
  const { formatApplicationEmail, auditApplicationEmail } = await import('../lib/application-email.mjs');
  const body = [
    'Hello,',
    'I prototype in Cursor/Claude Code and ship KYC/KYB flows. I\'m excited to apply. I\'d like to join Acme because your onboarding flow serves first-time investors.',
    'My CV is attached.',
  ].join('\n\n');
  const out = formatApplicationEmail(body, { language: 'en', profileData: { candidate: { full_name: 'Jo Doe' } } });
  assert.match(out, /Cursor and Claude Code/);
  assert.match(out, /KYC\/KYB/);
  assert.doesNotMatch(out, /excited to apply/);
  assert.match(out, /I'd like to join Acme because/);
  const issues = auditApplicationEmail({ subject: 'x', body: 'Hi,\n\nI work (daily): prototypes; reviews - fast / slow, in Figma.\n\nMy CV is attached.', language: 'en' });
  assert.ok(issues.some(issue => /Trop de ponctuation/.test(issue)), issues.join('\n'));
});

test('layout drops the internal-tool clause and turns a colon after a year into a comma', async () => {
  const { formatApplicationEmail } = await import('../lib/application-email.mjs');
  const out = formatApplicationEmail('Hello,\n\nI built AI products since 2022: UXfi and Creads.io. I shipped the app in six months. I reviewed prototypes in an internal tool I built before handing them off.\n\nMy CV is attached.', { language: 'en', profileData: { candidate: { full_name: 'Jo Doe' } } });
  assert.match(out, /since 2022, UXfi/);
  assert.doesNotMatch(out, /internal tool/);
});

test('detectTextLanguage settles an English offer despite French page chrome, and stays silent on short text', async () => {
  const { detectTextLanguage } = await import('../lib/application-email.mjs');
  const en = 'Voir l’entreprise Suivre WE’RE HIRING PRODUCT DESIGNER HiPrep is looking for a creative and user-focused Product Designer to join its team and help build intuitive digital experiences. The ideal candidate should have proven experience in UI/UX design and a strong understanding of the principles. Proficiency in Figma and other relevant design tools. The ability to translate ideas into wireframes and high-fidelity designs.';
  assert.equal(detectTextLanguage(en), 'en');
  assert.equal(detectTextLanguage('Product Designer'), '');
});

test('layout links the portfolio the offer asks for, turns a parenthesis list into commas, and keeps acronyms', async () => {
  const { formatApplicationEmail } = await import('../lib/application-email.mjs');
  const profileData = { candidate: { full_name: 'Jo Doe', portfolio_url: 'https://jo.example/portfolio' } };
  const body = 'Hello,\n\nI shipped a full product (investor app, admin panel and marketing site) in six months under VARA (licence).\n\nMy CV is attached. Could we talk?';
  const out = formatApplicationEmail(body, { language: 'en', profileData, portfolioAsked: true });
  assert.match(out, /full product, investor app, admin panel and marketing site, in six months/);
  assert.match(out, /My CV is attached and my portfolio is linked below\./);
  assert.match(formatApplicationEmail(body, { language: 'en', profileData }), /My CV is attached\. Could we talk/);
});

test('the portfolio is always mentioned when the profile has one, even without a "CV attached" sentence', async () => {
  const { formatApplicationEmail } = await import('../lib/application-email.mjs');
  const profileData = { candidate: { full_name: 'Jo Doe', portfolio_url: 'https://jo.example/portfolio' } };
  const out = formatApplicationEmail('Hello,\n\nI design products.\n\nCould we talk this week?', { language: 'en', profileData, portfolioAsked: true });
  assert.match(out, /Could we talk this week\? My portfolio is linked below\./);
  const fr = formatApplicationEmail('Bonjour,\n\nJe conçois des produits.\n\nPouvons-nous échanger ?', { language: 'fr', profileData, portfolioAsked: true });
  assert.match(fr, /Mon portfolio est lié ci-dessous\./);
});

// Regression: company "555GROUP PTE. LTD." from the posting.
const PTE = '555GROUP PTE. LTD.';
test('sentence splitting never cuts company suffixes or abbreviations', () => {
  assert.deepEqual(splitSentences(`I'd like to join ${PTE} I build design systems.`), [`I'd like to join ${PTE}`, 'I build design systems.']);
  assert.deepEqual(splitSentences('Acme Co. Ltd. is hiring. Dr. Smith leads design. I am J. R. Tolkien fan.'), ['Acme Co. Ltd. is hiring.', 'Dr. Smith leads design.', 'I am J. R. Tolkien fan.']);
  assert.deepEqual(splitSentences('I worked at Acme Inc. The team was small.'), ['I worked at Acme Inc.', 'The team was small.']);
  assert.deepEqual(splitSentences('Qonto S.A.S. hired me. I shipped it.'), ['Qonto S.A.S. hired me.', 'I shipped it.']);
});

test('statements about the target company and role are never removed as absent from the CV', () => {
  const body = groundEmail(
    `I'm applying for the Product Designer role at ${PTE} I'd like to join ${PTE}`,
    'At Edenred I designed mobile apps for corporate mobility clients. I shipped the investor app with one Product Owner.',
  );
  const claims = findUngroundedClaims(body, {
    cv: GROUND_CV,
    sourceText: `Product Designer at ${PTE} in Singapore. Design mobile apps.`,
    company: PTE,
    role: 'Product Designer',
    sameLanguage: true,
  });
  assert.deepEqual(claims, []);
  const { body: kept, removed } = stripUngroundedSentences(body, claims);
  assert.deepEqual(removed, []);
  assert.equal(kept, body);
});

test('a figure in the company name is not an unbacked figure, a real unbacked figure still is', () => {
  const body = groundEmail(
    `I'm applying for the Product Designer role at ${PTE}`,
    'At Edenred I designed mobile apps. I grew activation by 40%.',
  );
  const claims = findUngroundedClaims(body, { cv: GROUND_CV, sourceText: '', company: PTE, role: 'Product Designer' });
  assert.equal(claims.length, 1);
  assert.match(claims[0].sentence, /40%/);
});

test('the audit does not report "LTD." as a fragment for a company name with suffixes', () => {
  const body = groundEmail(
    `I'm applying for the Product Designer role at ${PTE} I'd like to join ${PTE}`,
    'At Edenred I designed mobile apps for corporate mobility clients.',
  );
  const issues = auditApplicationEmail({ subject: 'Product Designer - Hugo Vermot', body, language: 'en' }, {});
  assert.equal(issues.some(issue => /Fragment/.test(issue)), false, issues.join(' | '));
});
test('the matched prompt asks for a hook, 90-140 words and a plain ask, not the formula opener', () => {
  const matches = [{ need: 'User research', proof: 'Ran interviews with real customers.', employer: 'UpViral', role: 'Product Designer', dates: '2024', score: 5 }];
  const { system } = buildApplicationEmailMessages({ cv: '# CV', profileData: PROFILE, jobText: 'We need a product designer for operations tools.', matches, roleHint: 'Product Designer', companyHint: 'Acme' });
  assert.match(system, /the HOOK/);
  assert.match(system, /Do not open with "I.m applying for"/);
  assert.match(system, /90 to 140 words/);
  assert.match(system, /one concrete number beats an adjective/);
  assert.match(system, /Never the template "I.d like to join \[company\] because"/);
  assert.match(system, /\{role\} at \{company\} - \{Full Name\}/);
  assert.doesNotMatch(system, /first "I.m applying for the \[role\] role at \[company\]\."/);
});

test('availabilityLine only states what the CV says', () => {
  const cv = 'looking to move into a new contract or CDI role, fully remote from Paris or Thailand';
  assert.equal(availabilityLine(cv, 'en'), "I'm available for a contract or CDI role, full remote.");
  assert.match(availabilityLine(cv, 'fr'), /^Je suis disponible pour un contrat ou un CDI, en full remote\.$/);
  assert.equal(availabilityLine('Senior designer in Paris.', 'en'), '');
});

test('ensureAvailability adds the sentence before the ask, once, and never without a CV statement', () => {
  const cv = 'new contract or CDI role, fully remote';
  const body = 'Hello,\n\nYour Product Designer opening is about research.\n\nI ran interviews. My CV is attached. Can we talk this week?\n\nBest,\nHugo Vermot';
  const out = ensureAvailability(body, { cv, language: 'en' });
  assert.match(out, /My CV is attached\. I'm available for a contract or CDI role, full remote\. Can we talk this week\?/);
  assert.equal(ensureAvailability(out, { cv, language: 'en' }), out);
  assert.equal(ensureAvailability(body, { cv: 'Designer in Paris', language: 'en' }), body);
});

test('formatApplicationEmail greets in the email language even when the model did not', () => {
  const en = formatApplicationEmail('Bonjour,\n\nYour role is about research.\n\nCan we talk?', { language: 'en', profileData: PROFILE });
  assert.match(en, /^Hello,/);
  const fr = formatApplicationEmail('Hello,\n\nVotre poste porte sur la recherche.\n\nPouvons-nous \u00e9changer ?', { language: 'fr', profileData: PROFILE });
  assert.match(fr, /^Bonjour,/);
});

const E2E_CV = [
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
const E2E_JOB = 'Product Designer\n555GROUP PTE. LTD. Remote.\nWe need user research, design systems and AI prototyping for SaaS.';
const e2e = body => generateApplicationEmail({
  chat: async () => `COMPANY: 555GROUP PTE. LTD.\nROLE: Product Designer\nLANGUAGE: en\nSUBJECT: Product Designer at 555GROUP PTE. LTD. - Hugo Vermot\nBODY:\n${body}`,
  model: 'x', cv: E2E_CV, compactedCv: E2E_CV, profileData: PROFILE, jobText: E2E_JOB, language: 'en',
  roleHint: 'Product Designer', companyHint: '555GROUP PTE. LTD.', matcher: 'rules',
});

test('end to end: the 555GROUP PTE. LTD. opener, motivation and grounded claims are never removed or flagged', async () => {
  const body = [
    'Hello,',
    "I'm applying for the Product Designer role at 555GROUP PTE. LTD. You need someone who runs user research and ships complex flows.",
    "I've led end-to-end product design for consumer apps and SaaS platforms over 12 years, with a focus on user journeys, constraints, and delivery. I've worked across consumer and SaaS products, including a bootstrapped AI SaaS with 1,200 users and a regulated fintech platform.",
    "I'd like to join 555GROUP PTE. LTD. because operations teams need clear tools. My CV is attached. Could we talk this week?",
  ].join('\n\n');
  const draft = await e2e(body);
  assert.deepEqual(draft.removed, []);
  assert.equal(draft.ungrounded, 0);
  assert.doesNotMatch(draft.issues.join('\n'), /LTD\.|Fragment|Phrase retir/);
  assert.match(draft.body, /I'm applying for the Product Designer role at 555GROUP PTE\. LTD\./);
  assert.match(draft.body, /I'd like to join 555GROUP PTE\. LTD\./);
  assert.match(draft.body, /1,200 users/);
});

test('end to end: a 190-word draft is trimmed to the budget and passes the length audit', async () => {
  const filler = ['I shipped the investor app, admin panel, marketing site and an OTC product in six months with one Product Owner.', 'Interviews with real customers shaped every structural product decision I made at UpViral across several research rounds.', 'Creads.io, my bootstrapped AI advertising SaaS, reached 1,200 registered users and 20 paying clients through founder-led sales.', 'Regulated fintech journeys took design work alongside engineering, compliance reviewers and several investor profile validations.', 'Enterprise retail and finance clients at Agence V0 received dozens of delivered projects over five freelance years.', 'Complex navigation structures and data-heavy screens were reworked with product owners during discovery workshops.'].join(' ');
  const body = ['Hello,', "I'm applying for the Product Designer role at 555GROUP PTE. LTD. You need someone who runs user research.", filler + ' ' + ['Multi-country design systems cut development time at Renault through shared components and governance.', 'Dashboards for marketing teams across fifteen luxury maisons followed from workshops with data analysts.', 'Mobile banking journeys for retail customers were prototyped, tested weekly, then released by squads.', 'Onboarding flows for investors replaced paper forms with guided identity checks and clear progress states.'].join(' '), "I'd like to join 555GROUP PTE. LTD. because operations teams need clear tools. My CV is attached. Could we talk this week?"].join('\n\n');
  const draft = await e2e(body);
  assert.ok(draft.trimmed.length >= 1);
  const prose = draft.body.split('\n\n').slice(1, -1).join(' ');
  assert.ok(prose.split(/\s+/).length <= 145, 'words: ' + prose.split(/\s+/).length);
  assert.doesNotMatch(draft.issues.join('\n'), /Trop long/);
  assert.match(draft.body, /I'm applying for the Product Designer role at 555GROUP PTE\. LTD\./);
});

test('stripProcessDetail cuts GitHub and PR clauses, and a pure process sentence, but never empties a paragraph', () => {
  const body = 'Hello,\n\nHook.\n\nI shipped the investor app in six months. I prototype in Cursor and then push the designs to GitHub for engineering. Work moves through pull requests.\n\nCould we talk?\n\nBest,\nHugo';
  const out = stripProcessDetail(body);
  assert.doesNotMatch(out, /GitHub|pull request/i);
  assert.match(out, /I shipped the investor app in six months\./);
  const only = stripProcessDetail('Hello,\n\nHook.\n\nWork moves through pull requests.\n\nCould we talk?\n\nBest,\nHugo');
  assert.match(only, /pull requests/);
});

test('trimToWordBudget leaves a short email alone and never cuts the hook or the last paragraph', () => {
  const short = 'Hello,\n\nHook sentence here.\n\nOne proof. Another proof.\n\nAsk.\n\nBest,\nHugo';
  assert.equal(trimToWordBudget(short).body, short);
  const long = 'Hello,\n\nHook sentence here ' + 'x '.repeat(30) + '.\n\n' + Array.from({ length: 8 }, (_, i) => 'Proof number ' + i + ' ' + 'word '.repeat(12) + 'end.').join(' ') + '\n\nThe ask stays.\n\nBest,\nHugo';
  const { body, dropped } = trimToWordBudget(long);
  assert.ok(dropped.length > 0);
  assert.match(body, /Hook sentence here/);
  assert.match(body, /The ask stays\./);
});

test('the voice rules no longer list GitHub as a tool to name', async () => {
  const { EMAIL_VOICE_RULES } = await import('../lib/application-email.mjs');
  assert.match(EMAIL_VOICE_RULES, /Never GitHub, Git, PRD, branch or pull request/);
  assert.doesNotMatch(EMAIL_VOICE_RULES, /\(Figma, Cursor, Claude Code, GitHub\)/);
});

test('cleanSentenceQuality drops the repeated tool sentence, the garbled one and the vague filler, never the hook', () => {
  const body = [
    'Hello,',
    'Your Product Designer opening at 555 is about owning end-to-end flows. You need someone who has maintained design systems in Figma.',
    "In my current role, I replaced Figma mockups as the source of truth with prototypes coded in Cursor and Claude Code. I built interactive prototypes entirely in Cursor and Claude Code, and ran engineering. At a company I founded, I recorded a +40% SaaS efficiency improvement.",
    "The 555 diner app is the kind of product I want to work on, because it solves everyday friction. I've shipped similar systems across SaaS and consumer apps, and I'm ready to bring that experience to 555. My CV is attached.",
    'Best,\nHugo Vermot',
  ].join('\n\n');
  const { body: out, dropped } = cleanSentenceQuality(body, { company: '555', role: 'Product Designer' });
  assert.equal(dropped.length, 2);
  assert.match(out, /^Hello,\n\nYour Product Designer opening at 555 is about/);
  assert.match(out, /replaced Figma mockups/);
  assert.doesNotMatch(out, /and ran engineering|similar systems|ready to bring/);
  assert.match(out, /\+40% SaaS efficiency improvement/);
  assert.match(out, /My CV is attached\./);
});

test('cleanSentenceQuality does not treat the company repeated in the hook and the reason as a duplicate', () => {
  const body = 'Hello,\n\nI\'m applying for the Product Designer role at 555GROUP PTE. LTD. You need someone who runs user research.\n\nI shipped the investor app in six months.\n\nI\'d like to join 555GROUP PTE. LTD. because operations teams need clear tools. Could we talk?\n\nBest,\nHugo';
  assert.deepEqual(cleanSentenceQuality(body, { company: '555GROUP PTE. LTD.', role: 'Product Designer' }).dropped, []);
});

test('end to end: duplicate and garbled sentences are cleaned and the Galian figure keeps its CV source', async () => {
  const cv = E2E_CV + '\n### Agence V0 - Founder\n- GALIAN-SMABTP: recorded +40% SaaS efficiency improvement.';
  const body = ['Hello,', "Your Product Designer opening at 555GROUP PTE. LTD. is about SaaS flows. You need someone who ships with engineering.", "I shipped the investor app, admin panel, marketing site and an OTC product in six months with one Product Owner. I shipped the investor app and OTC product in six months with one Product Owner, and ran engineering. At a company I founded, I recorded a +40% SaaS efficiency improvement.", "Operations tools are the kind of product I want to work on, because they need clarity. Could we talk this week?"].join('\n\n');
  const draft = await generateApplicationEmail({ chat: async () => `COMPANY: 555GROUP PTE. LTD.\nROLE: Product Designer\nLANGUAGE: en\nSUBJECT: Product Designer - Hugo Vermot\nBODY:\n${body}`, model: 'x', cv, compactedCv: cv, profileData: PROFILE, jobText: E2E_JOB, language: 'en', roleHint: 'Product Designer', companyHint: '555GROUP PTE. LTD.', matcher: 'rules' });
  assert.doesNotMatch(draft.body, /and ran engineering/);
  assert.equal((draft.body.match(/six months/g) || []).length, 1);
  assert.doesNotMatch(draft.issues.join('\n'), /Qualit\u00e9/);
});

test('availability comes from the profile when the CV text does not state it, and says contract or CDI', () => {
  const profile = { availability: { desired_engagement: 'New contract or CDI role' } };
  assert.equal(availabilityLine('Designer, full remote.', 'en', profile), "I'm available for a contract or CDI role, full remote.");
  assert.equal(availabilityLine('Designer, full remote.', 'en', {}), 'I work full remote.', 'only the remote part is stated: a sentence of its own, not "a role, full remote"');
  assert.equal(availabilityLine('Designer.', 'en', { search: { contract_types: ['Contract', 'CDI'] } }), "I'm available for a contract or CDI role.");
});

// ── 2026-10-21, DConstruct PLUS (UI/UX Designer): broken availability sentence,
// a generic motivation, and a proof that told a Figma shop the candidate had
// replaced Figma.
const FIGMA_CV = [
  '# Hugo Vermot', '**Location:** Full remote', '',
  '## Summary', 'Senior product designer with 12 years across consumer apps and SaaS.', '',
  '## Experience',
  '### OneAsset - Senior Product Designer / Product Lead', 'Feb 2026 - Present',
  '- Replaced Figma mockups as the source of truth with prototypes coded in Cursor and Claude Code.',
  '- Ran user interviews and designed complex journeys with engineering.',
  '### Renault - Design Lead', '2019 - 2021',
  '- Built a multi-country design system adopted across teams, cutting development time by 20%.', '',
  '## Skills',
  '- Tools: Figma (10/10), Sketch, Adobe XD, Principle, Zeplin',
].join('\n');
const FIGMA_JOB = [
  'UI/UX Designer', 'Dconstruct is looking for a UI/UX Designer.', '',
  'Responsibilities',
  '1. Create wireframes, mockups, and prototypes that communicate design concepts and user flows.', '',
  '2. Develop and maintain design systems, style guides and design documentation.', '',
  'Qualifications',
  '1. Proficiency in design tools such as Sketch, Adobe XD, Figma, or similar.',
].join('\n');

test('availability is a sentence of its own in every case, and follows a posting that asks for the office', () => {
  assert.equal(availabilityLine('Designer, full remote.', 'en', {}), 'I work full remote.');
  assert.equal(availabilityLine('Designer, full remote.', 'fr', {}), 'Je travaille en full remote.');
  assert.equal(availabilityLine('Designer, contract or CDI.', 'en', {}), "I'm available for a contract or CDI role.");
  assert.equal(availabilityLine('Designer, full remote.', 'en', {}, { jobText: 'Hybrid: three days a week in our office.' }), '', 'an office posting is not told "full remote"');
  assert.equal(availabilityLine('Designer, contract or CDI, full remote.', 'en', {}, { jobText: 'Hybrid, 3 days in the office.' }), "I'm available for a contract or CDI role.");
  assert.equal(availabilityLine('Designer, full remote.', 'en', {}, { jobText: 'On-site or remote, your choice.' }), 'I work full remote.', 'a posting that also says remote keeps it');
  for (const text of ['Designer, full remote.', 'Designer, contract.', 'Designer, contract, full remote.']) {
    assert.doesNotMatch(availabilityLine(text, 'en', {}), /available for a role/);
  }
});

test('a tool the posting asks for is named, a sentence saying it was replaced is not', () => {
  assert.deepEqual(toolsNamedIn(FIGMA_JOB), ['Sketch', 'Adobe XD', 'Figma']);
  assert.deepEqual(toolsNamedIn('Figmol is my internal Figma-like tool. I sketch ideas.'), [], 'Figmol, Figma-like and the verb are not the tools');
  assert.deepEqual(replacedTools('Replaced Figma mockups as the source of truth with prototypes coded in Cursor.'), ['Figma']);
  assert.deepEqual(replacedTools('Replaced Sketch with Figma for the whole team.'), ['Sketch'], '"with Figma" is what it was replaced by');
  assert.deepEqual(replacedTools('Instead of Figma, I prototype in code.'), ['Figma']);
  assert.deepEqual(replacedTools('Remplacé les maquettes Figma par des prototypes codés.'), ['Figma']);
  assert.deepEqual(replacedTools('I design in Figma every day.'), []);
  const body = 'Hello,\n\nIn my current role, I replaced Figma mockups as the source of truth with prototypes. I ran user interviews.\n\nBest,\nHugo';
  assert.equal(findToolContradictions(body, FIGMA_JOB).length, 1);
  assert.deepEqual(findToolContradictions(body, 'We need a UX designer who prototypes in code.'), [], 'no tool asked, nothing to contradict');
  const out = stripToolContradictions(body, FIGMA_JOB);
  assert.doesNotMatch(out.body, /replaced Figma/);
  assert.match(out.body, /I ran user interviews\./);
});

test('the posting\'s tools are answered from the CV tool list and the "replaced Figma" line never answers anything', () => {
  const matches = matchPostingToCv(FIGMA_JOB, FIGMA_CV, 3);
  assert.equal(matches[0].skills, true);
  assert.equal(matches[0].proof, 'Tools: Figma, Sketch');
  assert.match(matches[0].need, /Proficiency in design tools/);
  assert.ok(matches[0].score >= STRONG_MATCH_SCORE, 'a tool named by both sides is a strong match');
  assert.ok(matches.length <= 3);
  assert.ok(matches.every(match => !/Replaced Figma/.test(match.proof)));
  const text = formatPostingMatches(matches, { unnamedEmployers: ['OneAsset'] });
  assert.match(text, /Tools: Figma, Sketch/);
  assert.doesNotMatch(text, /Replaced Figma/);
  // no tool list in the CV: nothing is invented
  const bare = FIGMA_CV.replace(/\n## Skills\n- Tools:.*$/m, '');
  assert.ok(matchPostingToCv(FIGMA_JOB, bare, 3).every(match => !match.skills));
  // a posting that names no tool is untouched by all this
  assert.ok(matchPostingToCv('Responsibilities\n1. Develop and maintain design systems and style guides.', FIGMA_CV, 3).every(match => !match.skills));
});

test('a reason that fits any company is not a motivation, a concrete one stays', () => {
  const email = [
    'Hello,',
    "I'm applying for the UI/UX Designer role at Dconstruct. You need prototypes and a design system.",
    "I want to work on smarter robotics and data intelligence because they solve real-world problems with measurable impact. I've built AI-powered product systems that ship fast, and I'd love to bring that to your team.",
    'Your inspection robots feed a data platform, and that is the kind of problem I want to work on, because operators read dense data under time pressure. My CV is attached.',
    'Best,\nHugo',
  ].join('\n\n');
  const generic = genericMotivationSentences(email);
  assert.equal(generic.length, 2);
  assert.match(generic[0], /real-world problems/);
  assert.match(generic[1], /bring that to your team/);
  const out = stripGenericMotivation(email);
  assert.deepEqual(out.removed, generic);
  assert.doesNotMatch(out.body, /real-world|bring that to your team/);
  assert.match(out.body, /operators read dense data/, 'a concrete reason is kept');
  assert.match(out.body, /^Hello,\n\n/);
  assert.match(out.body, /Best,\nHugo$/);
  // a proof sentence is not a motivation, whatever its words
  const proof = 'Hello,\n\nI shipped a checkout redesign with measurable impact on conversion.\n\nCould we talk this week?\n\nBest,\nHugo';
  assert.deepEqual(genericMotivationSentences(proof), []);
  assert.match(describeGenericMotivation(generic[0]), /^Motivation générique/);
  // French
  assert.equal(genericMotivationSentences('Bonjour,\n\nJe veux travailler chez vous parce que vous résolvez des problèmes concrets avec un impact mesurable.\n\nMerci.\n\nBien à vous').length, 1);
});

test('end to end: the DConstruct draft loses its generic motivation and its "replaced Figma" line, and gets a real availability sentence', async () => {
  const body = [
    'Hello,',
    "I'm applying for the UI/UX Designer role at Dconstruct. You ask for prototypes, a design system and Figma.",
    'In my current role, I replaced Figma mockups as the source of truth with prototypes coded in Cursor and Claude Code. At Renault, I built a multi-country design system adopted across teams.',
    "I want to work on smarter robotics because they solve real-world problems with measurable impact. I'd love to bring that to your team. My CV is attached. Could we talk this week?",
  ].join('\n\n');
  const draft = await generateApplicationEmail({
    chat: async () => `COMPANY: Dconstruct\nROLE: UI/UX Designer\nLANGUAGE: en\nSUBJECT: UI/UX Designer - Hugo Vermot\nBODY:\n${body}`,
    model: 'x', cv: FIGMA_CV, compactedCv: FIGMA_CV, profileData: PROFILE, jobText: FIGMA_JOB, language: 'en',
    roleHint: 'UI/UX Designer', companyHint: 'Dconstruct', matcher: 'rules',
  });
  assert.doesNotMatch(draft.body, /real-world|measurable impact|bring that to your team/);
  assert.doesNotMatch(draft.body, /replaced Figma/i);
  assert.match(draft.body, /I work full remote\./);
  assert.doesNotMatch(draft.body, /available for a role/);
  assert.match(draft.body, /multi-country design system/, 'the grounded proof stays');
  assert.match(draft.body, /Could we talk this week\?/);
  assert.ok(draft.removed.some(sentence => /real-world/.test(sentence)));
  assert.ok(draft.removed.some(sentence => /replaced Figma/i.test(sentence)));
  assert.doesNotMatch(draft.issues.join('\n'), /Motivation générique|Outil écarté/, 'what was cut is no longer reported');
});
