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
  buildGreeting,
  buildApplicationSubject,
  buildClosing,
  applyClosing,
  extractModelAsk,
  shortRole,
  normalizeTerm,
  cutUngroundedClause,
  relocateEmployerOpeners,
  dropBrokenSentences,
  dropOrphanedAnaphors,
  offerLinkIssues,
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
  ].join('\n'), { language: 'fr', profileData: PROFILE, reader: { firstName: 'Marie' } });
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

test('buildMailtoUrl encodes subject and body, line breaks as %0D%0A (RFC 6068)', () => {
  assert.equal(
    buildMailtoUrl({ to: 'a@b.io', subject: 'Hi & bye', body: 'L1\nL2' }),
    'mailto:a@b.io?subject=Hi%20%26%20bye&body=L1%0D%0AL2',
  );
  assert.equal(buildMailtoUrl({ to: 'a@b.io', body: 'L1\r\nL2' }), 'mailto:a@b.io?body=L1%0D%0AL2');
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

test('mailboxKind: one classifier for hiring, avoid, department and generic inboxes; no first name from a role mailbox', async () => {
  const { mailboxKind } = await import('../lib/application-email.mjs');
  const table = {
    hiring: ['people.ops', 'people-team', 'hr.france', 'rh-recrutement', 'design.jobs', 'ressources.humaines', 'human-resources', 'bewerbung', 'karriere', 'drh', 'alternance', 'recruitingteam', 'talentacquisition'],
    avoid: ['datenschutz', 'dsgvo', 'no-reply', 'dpo'],
    generic: ['officials.de', 'kontakt', 'accueil', 'contact', 'service-client'],
    department: ['team.design', 'office.manager', 'customer.success'],
    '': ['marie.dupont', 'nicolas', 'jobson', 'd.poirier'],
  };
  for (const [kind, locals] of Object.entries(table)) {
    for (const local of locals) assert.equal(mailboxKind(local), kind, local);
  }
  // classifyMailbox delegates and keeps the old whole-word results.
  for (const [local, kind] of [['work', 'hiring'], ['bonjour', 'generic'], ['marketing', 'avoid'], ['jobs-paris', 'hiring'], ['team.design', 'department']]) assert.equal(classifyMailbox(local), kind, local);
  const mlabs = parseRecipient('human-resources@mlabs.city');
  assert.equal(mlabs.firstName, '');
  assert.equal(mlabs.isRoleMailbox, true);
  assert.equal(withContact(mlabs, {}).persona, 'recruiter');
  const team = parseRecipient('team.design@acme.io');
  assert.equal(team.firstName, '');
  assert.equal(inferPersona(team), 'inbox');
  assert.equal(parseRecipient('marie.dupont@acme.io').firstName, 'Marie');
});

test('maskUnnamedEmployers describes a forbidden brand instead of naming it', () => {
  const fr = maskUnnamedEmployers('Bonjour,\n\nChez OneAsset, j\'ai livré l\'app investisseur. Pour UpViral, j\'ai mené la découverte. OneAsset reste mon employeur.\n\nMon CV est en pièce jointe.', { unnamedEmployers: ['OneAsset', 'UpViral'], latestNames: ['OneAsset'], language: 'fr' });
  assert.deepEqual(fr.masked, ['OneAsset', 'UpViral']);
  assert.match(fr.body, /^Bonjour,\n\nDans mon poste actuel, j'ai livré/);
  assert.match(fr.body, /Chez un précédent employeur, j'ai mené/);
  assert.match(fr.body, /Mon employeur actuel reste mon employeur\./);
  const en = maskUnnamedEmployers('Hello,\n\nAt OneAsset I shipped the investor app. UpViral\'s roadmap was mine.\n\nCV attached.', { unnamedEmployers: ['OneAsset', 'UpViral'], latestNames: ['OneAsset'], language: 'en' });
  assert.match(en.body, /In my current role I shipped/);
  // A possessive brand is the thing at the place, never "a previous employer roadmap" (WP4).
  assert.match(en.body, /The roadmap at a previous employer was mine\./);
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
  // Never "At X, I" (WP4): an unnamed employer gets "Before my current role", a named one goes after the facts.
  assert.match(out, /Before my current role, I led implementation/);
  assert.match(out, /I navigated MIF2 regulatory constraints and investor-profile validation at Société Générale\./);
  assert.doesNotMatch(out, /(?:^|\. )At (?!a |my )[^,]+, I/m);
  assert.match(out, /In my current role, I designed the KYB\/KYC onboarding/);
});

test('ensureRoleOpener puts back the line that says what the email is, once', () => {
  const body = 'Hello,\n\nYou need someone who has built KYC flows.\n\nIn my current role I designed the KYB/KYC onboarding.\n\nMy CV is attached.\n\nBest,\nHugo Vermot';
  const out = ensureRoleOpener(body, { role: 'Senior Product Manager - Payments / Stablecoin', company: 'Paymonade', language: 'en' });
  // The opener names the title before the posting's " - " (writer review WL-4).
  assert.match(out.split('\n\n')[1], /^I'm applying for the Senior Product Manager role at Paymonade\. You need someone/);
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
  assert.match(out, /^I designed KYC onboarding flows for retail banking customers at Beta Bank\.$/m);
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
  assert.match(out, /In my current role, I designed compliance UX[^.]*\. I ran a full UX\/UI audit[^.]* at BMW Group\. I built interactive prototypes/);
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
  assert.match(fixedImplied.body, /I designed savings and investment flows under MIF2 rules for retail customers at Beta Bank\./);
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
  assert.match(draft.body, /I designed peer-to-peer payments and the expense sharing flow for students at Lydia\./);
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
  // A colon before a list of names opens it with "including" (WP4).
  assert.match(out, /since 2022, including UXfi and Creads\.io\./);
  assert.doesNotMatch(out, /internal tool/);
});

test('detectTextLanguage settles an English offer despite French page chrome, and stays silent on short text', async () => {
  const { detectTextLanguage } = await import('../lib/application-email.mjs');
  const en = 'Voir l’entreprise Suivre WE’RE HIRING PRODUCT DESIGNER HiPrep is looking for a creative and user-focused Product Designer to join its team and help build intuitive digital experiences. The ideal candidate should have proven experience in UI/UX design and a strong understanding of the principles. Proficiency in Figma and other relevant design tools. The ability to translate ideas into wireframes and high-fidelity designs.';
  assert.equal(detectTextLanguage(en), 'en');
  assert.equal(detectTextLanguage('Product Designer'), '');
});

test('layout turns a parenthesis list into commas and keeps acronyms; the portfolio line is the closing\'s, not the layout\'s', async () => {
  const { formatApplicationEmail } = await import('../lib/application-email.mjs');
  const profileData = { candidate: { full_name: 'Jo Doe', portfolio_url: 'https://jo.example/portfolio' } };
  const body = 'Hello,\n\nI shipped a full product (investor app, admin panel and marketing site) in six months under VARA (licence).\n\nMy CV is attached. Could we talk?';
  const out = formatApplicationEmail(body, { language: 'en', profileData });
  assert.match(out, /full product, investor app, admin panel and marketing site, in six months/);
  assert.match(out, /My CV is attached\. Could we talk\?/);
  assert.doesNotMatch(out.split('\n\n').slice(0, -1).join('\n\n'), /portfolio/);
});

test('the closing names the portfolio when the profile has one, before the ask, in both languages', () => {
  const en = applyClosing('Hello,\n\nI design products.\n\nCould we talk this week?\n\nBest,\nJo Doe\nhttps://jo.example/portfolio', buildClosing({ persona: 'recruiter', language: 'en', hasPortfolio: true, modelAsk: 'Could we talk this week?' }));
  assert.match(en, /My CV is attached and my portfolio is linked below\. Could we talk this week\?\n\nBest,/);
  const fr = applyClosing('Bonjour,\n\nJe conçois des produits.\n\nPouvons-nous échanger ?\n\nBien à vous,\nJo Doe', buildClosing({ persona: 'recruiter', language: 'fr', hasPortfolio: true, modelAsk: 'Pouvons-nous échanger ?' }));
  assert.match(fr, /Mon CV est en pièce jointe et mon portfolio est en lien ci-dessous\. Pouvons-nous échanger \?/);
  assert.doesNotMatch(fr, /lié ci-dessous/);
  assert.deepEqual(buildClosing({ language: 'en', hasPortfolio: false, modelAsk: 'Could we talk?' }), ['My CV is attached.', 'Could we talk?']);
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
  // The posting holds no company fact (no name, number or user noun): no motivation is asked for.
  assert.match(system, /no company fact to build on, so write no motivation sentence/);
  assert.doesNotMatch(system, /kind of problem I want to work on/);
  assert.match(system, /\{role\} at \{company\} - \{Full Name\}/);
  assert.doesNotMatch(system, /first "I.m applying for the \[role\] role at \[company\]\."/);
});

test('availabilityLine only states what the CV says, and never writes "CDI" in English', () => {
  const cv = 'looking to move into a new contract or CDI role, fully remote from Paris or Thailand';
  assert.equal(availabilityLine(cv, 'en'), "I'm available for a permanent or contract role, fully remote.");
  assert.equal(availabilityLine(cv, 'fr'), 'Je suis disponible pour un CDI ou une mission, en full remote.');
  assert.equal(availabilityLine('Senior designer in Paris.', 'en'), '');
});

test('ensureAvailability no longer inserts anything: the closing carries the availability', () => {
  const body = 'Hello,\n\nYour Product Designer opening is about research.\n\nI ran interviews. My CV is attached. Can we talk this week?\n\nBest,\nHugo Vermot';
  assert.equal(ensureAvailability(body, { cv: 'looking to move into a new contract or CDI role, fully remote', language: 'en' }), body);
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

test('trimToWordBudget leaves a short email alone and never cuts the hook or the closing', () => {
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

test('availability comes from the profile when the CV text does not state it, worded for the reader', () => {
  const profile = { availability: { desired_engagement: 'New contract or CDI role' }, location: { remote_policy: 'Full remote required' } };
  assert.equal(availabilityLine('Designer.', 'en', profile), "I'm available for a permanent or contract role, fully remote.");
  assert.equal(availabilityLine('Designer. I work fully remote.', 'en', {}), 'I work fully remote.', 'only the remote part is stated: a sentence of its own, not "a role, full remote"');
  assert.equal(availabilityLine('Designer.', 'en', { search: { contract_types: ['Contract', 'CDI'] } }), "I'm available for a permanent or contract role.");
  assert.equal(availabilityLine('Designer.', 'fr', { search: { contract_types: ['Contract', 'CDI'] } }), 'Je suis disponible pour un CDI ou une mission.');
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
  const remote = '**Location:** Full remote';
  const both = 'Open to contract or CDI roles, working fully remote.';
  assert.equal(availabilityLine(remote, 'en', {}), 'I work fully remote.');
  assert.equal(availabilityLine(remote, 'fr', {}), 'Je travaille en full remote.');
  assert.equal(availabilityLine('Designer, open to contract or CDI roles.', 'en', {}), "I'm available for a permanent or contract role.");
  assert.equal(availabilityLine(remote, 'en', {}, { jobText: 'Hybrid: three days a week in our office.' }), '', 'an office posting is not told "full remote"');
  assert.equal(availabilityLine(both, 'en', {}, { jobText: 'Hybrid, 3 days in the office.' }), "I'm available for a permanent or contract role.");
  assert.equal(availabilityLine(remote, 'en', {}, { jobText: 'On-site or remote, your choice.' }), 'I work fully remote.', 'a posting that also says remote keeps it');
  for (const text of [remote, 'Open to contract work.', both]) {
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
  assert.match(draft.body, /I work fully remote\./);
  assert.doesNotMatch(draft.body, /available for a role/);
  assert.match(draft.body, /multi-country design system/, 'the grounded proof stays');
  assert.match(draft.body, /I work fully remote\. Could we talk this week\?\n\nBest,/, 'the ask ends the email');
  assert.ok(draft.removed.some(sentence => /real-world/.test(sentence)));
  assert.ok(draft.removed.some(sentence => /replaced Figma/i.test(sentence)));
  assert.doesNotMatch(draft.issues.join('\n'), /Motivation générique|Outil écarté/, 'what was cut is no longer reported');
});

// ── 2026-10-24: greeting, subject, closing and availability written by code;
// the company name never doubled; French calques fixed (WP2). The bench of
// 2026-10-23 found 17 of 32 drafts ending on "My portfolio is linked below.",
// 18 of 20 English drafts offering a "CDI", and "Vertech Industrial Systems
// Industrial Systems" in production-shaped drafts.

const WP2_CV = [
  '# Jo Martin', '',
  '## Summary',
  'Product designer with 10 years in B2B SaaS. I am looking to move into a new contract or CDI role, fully remote.', '',
  '## Experience',
  '### Northwind - Senior Product Designer', '2022 - Present',
  '- Designed operator dashboards and alarm screens for plant engineers with two developers.',
  '- Ran usability tests with operators every sprint.',
  '### Contoso - Product Designer', '2018 - 2022',
  '- Built a design system used by four product teams.',
].join('\n');
const WP2_PROFILE = { candidate: { full_name: 'Jo Martin', portfolio_url: 'https://jo.example/portfolio' }, availability: { notice_period_days: 7 } };
const WP2_JOB = 'UX/UI Designer\nVertech Industrial Systems · Remote\n\nAbout the role\nYou will design operator dashboards and alarm screens for plant engineers, and build a design system with our engineers.\n\nRequirements\n- Experience designing B2B dashboards\n- Figma and design systems';
const WP2_EN = [
  'Hello,',
  'Your UX/UI Designer opening at Vertech Industrial Systems is about operator dashboards for plant engineers.',
  'I designed operator dashboards and alarm screens for plant engineers with two developers. I also ran usability tests with operators every sprint.',
  'Operator dashboards are the kind of problem I want to work on, because plant teams read them under pressure. The CV is attached. Would you have 20 minutes next week?',
].join('\n\n');
const WP2_FR = [
  'Bonjour,',
  'Votre poste de UX/UI Designer chez Vertech Industrial Systems porte sur les tableaux de bord des opérateurs.',
  'J’ai conçu des tableaux de bord opérateurs et des écrans d’alarme pour des ingénieurs d’usine, avec deux développeurs. J’ai aussi mené des tests utilisateurs avec les opérateurs à chaque sprint.',
  'Les tableaux de bord opérateurs sont le type de sujet sur lequel je veux travailler, parce que les équipes les lisent sous pression. CV attaché, auriez-vous 20 minutes la semaine prochaine ?',
].join('\n\n');
const wp2Reply = (body, { company = 'Vertech Industrial Systems', role = 'UX/UI Designer', language = 'en', subject = `${role} - Jo Martin` } = {}) => `COMPANY: ${company}\nROLE: ${role}\nLANGUAGE: ${language}\nSUBJECT: ${subject}\nBODY:\n${body}`;
const wp2Draft = (body, options = {}) => generateApplicationEmail({
  chat: async () => wp2Reply(body, options.reply),
  model: 'stub', cv: options.cv || WP2_CV, compactedCv: options.cv || WP2_CV, profileData: options.profileData || WP2_PROFILE,
  recipient: parseRecipient(options.to || 'alex.kim@vertech.com'), contact: options.contact === undefined ? { firstName: 'Alex', lastName: 'Kim', title: 'Design Manager', persona: 'hiring-manager' } : options.contact,
  jobText: options.jobText ?? WP2_JOB, jobUrl: options.jobUrl || '', companyText: options.companyText || '', language: options.language || 'en',
  roleHint: options.roleHint ?? 'UX/UI Designer', companyHint: options.companyHint ?? 'Vertech Industrial Systems', forwardTo: options.forwardTo || null, matcher: 'rules',
});
const proseOf = body => body.split('\n\n').slice(1, -1);
const lastSentences = body => splitSentences(proseOf(body).at(-1));

test('the domain guess never doubles a company name that already holds it, and never touches a domain', async () => {
  // jobs@vertech.com reads "Vertech"; the offer says "Vertech Industrial Systems".
  const vertech = await wp2Draft(WP2_EN, { to: 'jobs@vertech.com', contact: null });
  assert.doesNotMatch(vertech.body, /Industrial Systems Industrial Systems/);
  assert.equal(vertech.body.match(/Vertech Industrial Systems/g).length, 1);
  // anna@chess.com reads "Chess"; the Glassdoor slug gave "Chess Com"; the model wrote "Chess.com".
  const chessBody = 'Hello,\n\nYour Product Designer opening at Chess.com is about a design system for web and mobile.\n\nI built a design system used by four product teams. I also ran usability tests with operators every sprint.\n\nChess.com is the kind of product I want to work on, because millions of players use it daily. Could we talk this week?';
  const chess = await wp2Draft(chessBody, { to: 'anna@chess.com', contact: null, companyHint: 'Chess Com', roleHint: 'Product Designer', jobText: 'Product Designer, Design Systems\nChess.com · Remote\nYou will maintain our design system across web and mobile.', reply: { company: 'Chess Com', role: 'Product Designer' } });
  assert.equal(chess.body.match(/Chess\.com/g).length, 2);
  assert.doesNotMatch(chess.body, /Chess Com|\.com\.com/);
  // The intended rewrite still happens: the domain's "Hipreponline" becomes the offer's "HiPrep", the domain stays.
  const hiprepBody = 'Hello,\n\nYour Product Designer opening at Hipreponline is about learning flows.\n\nI built a design system used by four product teams. I also ran usability tests with operators every sprint.\n\nLearning flows are the kind of problem I want to work on, because students drop off early. I read hipreponline.com before writing. Could we talk this week?';
  const hiprep = await wp2Draft(hiprepBody, { to: 'jobs@hipreponline.com', contact: null, companyHint: 'HiPrep', roleHint: 'Product Designer', jobText: 'Product Designer\nHiPrep is looking for a Product Designer to build learning flows.', reply: { company: 'Hipreponline', role: 'Product Designer' } });
  assert.match(hiprep.body, /opening at HiPrep is about/);
  assert.match(hiprep.body, /hipreponline\.com/);
  assert.doesNotMatch(hiprep.body, /HiPrep\.com/);
});

test('every persona, in English and French, ends on one ask: a question, after the CV line', async () => {
  const defaults = {
    en: {
      recruiter: 'Would a short call about the role work this week or next?',
      unknown: 'Would a short call about the role work this week or next?',
      'hiring-manager': 'Would it help if I walked you through that work on a short call?',
      founder: 'Would a short call be useful?',
      inbox: 'Could you pass this on to the person hiring for the UX/UI Designer role?',
    },
    fr: {
      recruiter: 'Un court échange sur ce poste vous conviendrait-il cette semaine ou la suivante ?',
      unknown: 'Un court échange sur ce poste vous conviendrait-il cette semaine ou la suivante ?',
      'hiring-manager': 'Voulez-vous que je vous présente ce travail lors d’un court appel ?',
      founder: 'Un court appel vous serait-il utile ?',
      inbox: 'Pourriez-vous transmettre ce message à la personne qui recrute pour le poste d’UX/UI Designer ?',
    },
  };
  for (const language of ['en', 'fr']) {
    for (const persona of Object.keys(defaults[language])) {
      let body = language === 'fr' ? WP2_FR : WP2_EN;
      // A founder gets two paragraphs: the proof, then the closing.
      if (persona === 'founder') body = body.split('\n\n').filter((p, i) => i !== 1).join('\n\n');
      const contact = persona === 'inbox' ? null : { firstName: 'Alex', lastName: 'Kim', title: '', persona };
      const draft = await wp2Draft(body, { language, contact, to: persona === 'inbox' ? 'contact@vertech.com' : 'alex.kim@vertech.com', reply: { language } });
      assert.equal(draft.persona, persona);
      const sentences = lastSentences(draft.body);
      const label = `${language} ${persona}: ${proseOf(draft.body).at(-1)}`;
      assert.equal(sentences.at(-1), defaults[language][persona], label);
      assert.match(sentences.at(-1), /\?$/, label);
      assert.equal((proseOf(draft.body).at(-1).match(/\?/g) || []).length, 1, label);
      const cvAt = sentences.findIndex(sentence => /\bCV\b/.test(sentence));
      assert.ok(cvAt >= 0 && cvAt < sentences.length - 1, label);
      assert.doesNotMatch(draft.body, /20 minutes|CV attaché|lié ci-dessous/, label);
      if (language === 'en') assert.doesNotMatch(draft.body, /\bCDI\b/, label);
    }
  }
});

test('a usable ask from the model is kept, last; a CV clause glued to it goes', async () => {
  const kept = await wp2Draft(WP2_EN.replace('Would you have 20 minutes next week?', 'Could we talk about the dashboards this week?'));
  assert.equal(lastSentences(kept.body).at(-1), 'Could we talk about the dashboards this week?');
  assert.equal(extractModelAsk('Bonjour,\n\nX.\n\nCV attaché, pourriez-vous transmettre ma candidature à la bonne personne ?\n\nBien à vous,\nJo'), 'Pourriez-vous transmettre ma candidature à la bonne personne ?');
  // Qwen's broken French forward request is not kept; a correct one is.
  for (const broken of ['Pourriez-vous me transmettre à la personne concernée pour un échange rapide ?', 'Pouvez-vous me transmettre la personne à contacter pour un bref échange ?', 'Pourriez-vous me transmettre le bon interlocuteur ?']) {
    assert.equal(buildClosing({ language: 'fr', persona: 'recruiter', modelAsk: broken }).at(-1), 'Un court échange sur ce poste vous conviendrait-il cette semaine ou la suivante ?', broken);
  }
  assert.equal(buildClosing({ language: 'fr', persona: 'recruiter', modelAsk: 'Pourriez-vous me transmettre le nom du bon interlocuteur ?' }).at(-1), 'Pourriez-vous me transmettre le nom du bon interlocuteur ?');
  // A statement asking for a call is an ask too; a pleasantry is not, and goes.
  assert.deepEqual(buildClosing({ language: 'en', modelAsk: 'Let me know if a call works.' }).at(-1), 'Let me know if a call works.');
  assert.deepEqual(buildClosing({ language: 'en', persona: 'founder', modelAsk: 'I look forward to hearing from you.' }).at(-1), 'Would a short call be useful?');
  const pleasantry = await wp2Draft(WP2_EN.replace('Would you have 20 minutes next week?', 'I look forward to hearing from you.'));
  assert.doesNotMatch(pleasantry.body, /look forward/);
  assert.equal(lastSentences(pleasantry.body).at(-1), 'Would it help if I walked you through that work on a short call?');
  // "Available for a call this week." asks nothing (bench 2026-10-24, S2 twice): the persona's question.
  const diary = await wp2Draft(WP2_EN.replace('Would you have 20 minutes next week?', 'Available for a call this week.'));
  assert.equal(lastSentences(diary.body).at(-1), 'Would it help if I walked you through that work on a short call?');
  assert.doesNotMatch(diary.body, /Available for a call/);
  assert.equal(buildClosing({ language: 'fr', persona: 'founder', modelAsk: 'Je suis disponible pour un appel cette semaine.' }).at(-1), 'Un court appel vous serait-il utile ?');
  // A usable ask is preferred over a later unusable one.
  assert.equal(extractModelAsk('Hello,\n\nX.\n\nCould we talk this week? Available for a call this week.\n\nBest,\nJo'), 'Could we talk this week?');
  assert.deepEqual(buildClosing({ language: 'en', persona: 'founder', modelAsk: 'Could we have a call in the next two weeks?' }).at(-1), 'Would a short call be useful?', 'a figure is never kept');
});

// Final bodies from scratch/email-bench/results/baseline-2026-10-23-1.json.
const SIGN_FR = 'Bien à vous,\nHugo Vermot\nhttps://jobyougo.xyz/portfolio\nhttps://linkedin.com/in/hugovermot';
const SIGN_EN = 'Best,\nHugo Vermot\nhttps://jobyougo.xyz/portfolio\nhttps://linkedin.com/in/hugovermot';
const BENCH_FINALS = {
  'S3 r1': { persona: 'recruiter', language: 'fr', body: ['Bonjour,', 'Product Designer chez Alan, je réponds à l’exigence de concevoir et livrer des produits complets depuis l’idée jusqu’à la mise en production, avec une expérience de 5 ans dans des produits de santé et de prévention.', 'Depuis 2022, j’ai construit des produits autonomes en IA, dont Creads.io, une SaaS publicitaire qui génère des briefs structurés à partir du contexte marque, puis valide chaque sortie contre ce brief avant livraison.', 'La prévention comme norme est le type de sujet sur lequel je veux travailler, parce que les systèmes de santé doivent être conçus pour l’usage quotidien, pas pour les crises. CV attaché, pourriez-vous me transmettre le bon interlocuteur pour un échange rapide ? Je suis disponible pour un contrat ou un CDI. Mon portfolio est lié ci-dessous.', SIGN_FR].join('\n\n') },
  'S4 r1': { persona: 'founder', language: 'en', body: ['Hi Gabriel,', "I'm applying for the Senior Product Designer role at Dust. I built Creads.io, an AI advertising SaaS with 1,200 users, where I designed the full loop from brand-context memory to structured brief generation and multi-pass validation before output ships. That’s the kind of end-to-end AI workflow Dust is shaping.", 'I’m now looking to move into a senior product role with full ownership, especially in AI-driven collaboration.', 'My CV is attached and my portfolio is linked below. A quick call this week would be great. Available for full-time remote or Paris-based, with relocation support.', SIGN_EN].join('\n\n') },
  'S7 r1': { persona: 'hiring-manager', language: 'fr', body: ['Bonjour Camille,', 'Je postule au poste de Product Designer chez Aircall. Aircall conçoit des agents IA pour les communications client, avec des flux de configuration intuitifs pour des utilisateurs non techniques.', 'Depuis 2022, j’ai construit en solo des produits IA, UXfi, Flemme OS, Creads.io et Panfy.', 'La configuration d’agents IA est le type de sujet sur lequel je veux travailler, parce que les outils actuels manquent de contrôle sur le contexte et la qualité des sorties. CV attaché, je peux vous montrer ce travail en appel cette semaine. Je suis disponible pour un contrat ou un CDI, en full remote. Mon portfolio est lié ci-dessous.', SIGN_FR].join('\n\n') },
};

test('an employer the house rules keep unnamed stays masked in the model\'s ask: the closing never puts the first wording back', async () => {
  const cv = WP2_CV.replace('### Northwind - Senior Product Designer', '### OneAsset - Senior Product Designer');
  const body = WP2_EN.replace('Would you have 20 minutes next week?', 'I would like to walk you through my work at OneAsset on a call.');
  const draft = await generateApplicationEmail({
    chat: async () => wp2Reply(body),
    model: 'stub', cv, compactedCv: cv, profileData: WP2_PROFILE, recipient: parseRecipient('alex.kim@vertech.com'), contact: { firstName: 'Alex', lastName: 'Kim', title: 'Design Manager', persona: 'hiring-manager' },
    profileContext: '## Cover letters\n\n**Named employers (hard rule):** Do **not** name unknown or low-recognition employers as proof: OneAsset, UpViral.\n\n## Other\nx',
    jobText: WP2_JOB, language: 'en', roleHint: 'UX/UI Designer', companyHint: 'Vertech Industrial Systems', matcher: 'rules',
  });
  assert.doesNotMatch(draft.body, /OneAsset/);
  assert.match(lastSentences(draft.body).at(-1), /walk you through my work in my current role on a call\.$/);
});

test('the bench finals that ended on "My portfolio is linked below." end on their ask after applyClosing', () => {
  const profile = { search: { contract_types: ['Contract', 'CDI'] }, location: { remote_policy: 'Full remote required' }, availability: { notice_period_days: 7 } };
  for (const [name, { persona, language, body }] of Object.entries(BENCH_FINALS)) {
    const modelAsk = extractModelAsk(body);
    const closing = buildClosing({ persona, language, role: 'Product Designer', hasPortfolio: true, availability: availabilityLine('', language, profile), modelAsk });
    const out = applyClosing(body, closing);
    const sentences = lastSentences(out);
    assert.equal(sentences.at(-1), closing.at(-1), name);
    assert.match(sentences.at(-1), /\?$|appel|call/, name);
    assert.doesNotMatch(out, /lié ci-dessous|CV attaché|contrat ou un CDI|Available for full-time/, name);
    assert.ok(sentences.findIndex(sentence => /\bCV\b/.test(sentence)) < sentences.length - 1, name);
    // The motivation stays, before the closing; the signature is untouched.
    if (language === 'fr') assert.match(proseOf(out).at(-1), /^La /, name);
    assert.ok(out.endsWith(language === 'fr' ? SIGN_FR : SIGN_EN), name);
    // Applying it again changes nothing.
    assert.equal(applyClosing(out, buildClosing({ persona, language, role: 'Product Designer', hasPortfolio: true, availability: availabilityLine('', language, profile), modelAsk: extractModelAsk(out) })), out, name);
  }
  // S4 and S7 keep the model's ask; S3's "me transmettre le bon interlocuteur" is broken French: the recruiter's question.
  assert.equal(extractModelAsk(BENCH_FINALS['S7 r1'].body), 'Je peux vous montrer ce travail en appel cette semaine.');
  assert.equal(lastSentences(applyClosing(BENCH_FINALS['S4 r1'].body, buildClosing({ persona: 'founder', language: 'en', modelAsk: extractModelAsk(BENCH_FINALS['S4 r1'].body) }))).at(-1), 'A quick call this week would be great.');
  assert.equal(buildClosing({ persona: 'recruiter', language: 'fr', modelAsk: extractModelAsk(BENCH_FINALS['S3 r1'].body) }).at(-1), 'Un court échange sur ce poste vous conviendrait-il cette semaine ou la suivante ?');
});

test('availabilityLine: no "CDI" in English, no claim from "smart contract" or "a remote team", the start date from the notice', () => {
  const smart = '## Experience\n- Designed smart contract dashboards for a DeFi wallet.';
  assert.equal(availabilityLine(smart, 'en', {}), '');
  const team = '## Experience\n- Managed a fully remote team of 6 designers.';
  assert.equal(availabilityLine(team, 'en', {}), '');
  assert.doesNotMatch(availabilityLine(team, 'en', { search: { contract_types: ['CDI'] } }), /remote/);
  const profile = { search: { contract_types: ['Contract', 'CDI'] }, location: { remote_policy: 'Full remote required' }, availability: { notice_period_days: 7 } };
  assert.equal(availabilityLine('', 'en', profile), "I'm available for a permanent or contract role, fully remote, and can start after one week's notice.");
  assert.equal(availabilityLine('', 'fr', profile), 'Je suis disponible pour un CDI ou une mission, en full remote, et je peux commencer après un préavis d’une semaine.');
  assert.equal(availabilityLine('', 'en', profile, { notice: false }), "I'm available for a permanent or contract role, fully remote.");
  assert.equal(availabilityLine('', 'en', { ...profile, location: {} }), "I'm available for a permanent or contract role and can start after one week's notice.");
  assert.equal(availabilityLine('', 'fr', { location: { remote_policy: 'Full remote' }, availability: { notice_period_days: 7 } }), 'Je travaille en full remote et je peux commencer après un préavis d’une semaine.');
  for (const jobText of ['', 'Full-time, permanent position.', 'Contract role, 6 months.', 'CDI, Paris.']) {
    assert.doesNotMatch(availabilityLine('', 'en', profile, { jobText }), /\bCDI\b/, jobText);
  }
  // The posting's contract type picks the wording.
  assert.match(availabilityLine('', 'en', profile, { jobText: 'Employment type: Full-time' }), /^I'm available for a permanent role, fully remote, and/);
  assert.match(availabilityLine('', 'en', profile, { jobText: 'This is a 6-month contract, full-time.' }), /^I'm available for a contract, fully remote, and/);
  assert.match(availabilityLine('', 'fr', profile, { jobText: 'Type de contrat : CDI' }), /^Je suis disponible pour un CDI, en full remote, et/);
  assert.match(availabilityLine('', 'fr', profile, { jobText: 'Mission freelance de 6 mois.' }), /^Je suis disponible pour une mission, en full remote, et/);
  // "Vos missions" is not a freelance mission.
  assert.match(availabilityLine('', 'fr', profile, { jobText: 'Vos missions : concevoir les parcours.' }), /^Je suis disponible pour un CDI ou une mission/);
  // A candidate who only takes permanent roles is never offered as a contractor.
  assert.match(availabilityLine('', 'en', { search: { contract_types: ['CDI'] } }, { jobText: 'Contract role, 6 months.' }), /^I'm available for a permanent role\./);
  // Notice lengths.
  assert.match(availabilityLine('', 'en', { availability: { notice_period_days: 14 } }), /^I can start after two weeks' notice\.$/);
  assert.match(availabilityLine('', 'en', { availability: { notice_period_days: 90 } }), /^I can start after three months' notice\.$/);
  assert.match(availabilityLine('', 'fr', { availability: { notice_period_days: 30 } }), /^Je peux commencer après un préavis d’un mois\.$/);
  assert.match(availabilityLine('', 'en', { availability: { notice_period: '1 week' } }), /one week's notice/);
  assert.equal(availabilityLine('', 'en', { availability: {} }), '');
});

test('end to end: the notice goes to a shared inbox, never cut as an unbacked figure; a hiring manager reads no notice', async () => {
  const profileData = { ...WP2_PROFILE, availability: { notice_period_days: 14 } };
  const inbox = await wp2Draft(WP2_EN, { profileData, to: 'jobs@vertech.com', contact: null });
  assert.match(proseOf(inbox.body).at(-1), /I'm available for a permanent or contract role, fully remote, and can start after two weeks' notice\. Would a short call/);
  assert.deepEqual(inbox.removed, []);
  const manager = await wp2Draft(WP2_EN, { profileData });
  assert.match(proseOf(manager.body).at(-1), /I'm available for a permanent or contract role, fully remote\. Would it help/);
  assert.doesNotMatch(manager.body, /notice/);
});

test('the greeting is the code\'s: the reader\'s first name in the email language, one line, never invented', async () => {
  const alex = await wp2Draft(WP2_EN.replace(/^Hello,/, 'Bonjour Alex,'));
  assert.match(alex.body, /^Hi Alex,\n\nYour UX and UI Designer opening/);
  const fr = await wp2Draft(WP2_FR.replace(/^Bonjour,/, 'Hi Alex,'), { language: 'fr', reply: { language: 'fr' } });
  assert.match(fr.body, /^Bonjour Alex,\n\nVotre poste/);
  // A shared inbox has no first name: the model's "Hi Marie," is invented.
  const inbox = await wp2Draft(WP2_EN.replace(/^Hello,/, 'Hi Marie,'), { to: 'jobs@vertech.com', contact: null });
  assert.match(inbox.body, /^Hello,\n\nYour /);
  assert.doesNotMatch(inbox.body, /Marie/);
  // "Hi Marie" without its comma: one greeting line, not "Hello," then "Hi Marie".
  const noComma = formatApplicationEmail('Hi Marie\n\nYour role is about research.\n\nCould we talk?', { language: 'en', profileData: PROFILE, reader: { firstName: 'Marie' } });
  assert.match(noComma, /^Hi Marie,\n\nYour role is about research\./);
  assert.equal(noComma.match(/Marie/g).length, 1);
  const glued = formatApplicationEmail('Hi Marie, your role is about research.\n\nCould we talk?', { language: 'en', profileData: PROFILE });
  // The sentence left after the greeting starts with a capital (writer review WL-6).
  assert.match(glued, /^Hello,\n\nYour role is about research\./);
  assert.equal(buildGreeting({ firstName: 'Alex' }, 'en'), 'Hi Alex,');
  assert.equal(buildGreeting({ firstName: 'Alex' }, 'fr'), 'Bonjour Alex,');
  assert.equal(buildGreeting(null, 'fr'), 'Bonjour,');
  assert.equal(buildGreeting({ firstName: '' }, 'en'), 'Hello,');
});

test('the subject is the code\'s: role, company in the offer\'s casing and name, 70 characters at most', async () => {
  const lovable = await generateApplicationEmail({
    chat: async () => 'COMPANY: lovable\nROLE: Product Designer\nLANGUAGE: en\nSUBJECT: Product Designer - Hugo Vermot\nBODY:\nHello,\n\nYour Product Designer opening at lovable is about the editor.\n\nI built a design system used by four product teams.\n\nCould we talk this week?',
    model: 'stub', cv: WP2_CV, profileData: PROFILE, jobText: 'Product Designer at lovable. You will design the editor and its design system.', language: 'en', roleHint: 'Product Designer', matcher: 'rules',
  });
  assert.equal(lovable.subject, 'Product Designer at Lovable - Hugo Vermot');
  assert.equal(buildApplicationSubject({ role: 'Product Designer', company: 'Alan', fullName: 'Hugo Vermot', language: 'fr' }), 'Candidature Product Designer chez Alan - Hugo Vermot');
  // Over 70 characters: the company goes first, then "Candidature ".
  const long = buildApplicationSubject({ role: 'Senior Product Designer, Growth', company: 'Northwind Industrial Holdings International', fullName: 'Hugo Vermot' });
  assert.equal(long, 'Senior Product Designer, Growth - Hugo Vermot');
  assert.equal(buildApplicationSubject({ role: 'Lead Product Designer, Onboarding and Activation', company: 'Northwind Industrial Holdings', fullName: 'Hugo Vermot', language: 'fr' }), 'Lead Product Designer, Onboarding and Activation - Hugo Vermot');
  for (const subject of [long]) assert.ok(subject.length <= 70);
  // The role as a subject reads it.
  assert.equal(shortRole('Product Designer (H/F)'), 'Product Designer');
  assert.equal(shortRole('UX Designer (m/w/d)'), 'UX Designer');
  assert.equal(shortRole('Senior Product Manager - Payments / Stablecoin Infrastructure'), 'Senior Product Manager');
  assert.equal(shortRole('Product Designer - Growth'), 'Product Designer - Growth', 'a short role keeps its team');
  // An offer with no role to name keeps the model's subject.
  assert.equal(buildApplicationSubject({ role: '', company: 'Alan', fullName: 'Hugo Vermot' }), '');
});

test('a spontaneous subject names the profile\'s first target role, never the CV headline', async () => {
  const headline = 'Product Leader & AI Builder';
  const reply = `COMPANY: Alan\nROLE: ${headline}\nLANGUAGE: fr\nSUBJECT: Candidature spontanée - ${headline} - Hugo Vermot\nBODY:\nBonjour,\n\nAlan rembourse les frais de santé de ses membres en quelques minutes.\n\nJ’ai construit un design system utilisé par quatre équipes produit.\n\nPouvons-nous en parler cette semaine ?`;
  const draftWith = profileData => generateApplicationEmail({ chat: async () => reply, model: 'stub', cv: WP2_CV, profileData, recipient: parseRecipient('jobs@alan.com'), companyText: 'Alan rembourse les frais de santé de ses membres.', language: 'fr', matcher: 'rules' });
  const withRoles = await draftWith({ candidate: { full_name: 'Hugo Vermot' }, narrative: { headline }, target_roles: { primary: ['Senior Product Designer', 'Lead Product Designer'] } });
  assert.equal(withRoles.subject, 'Candidature spontanée - Senior Product Designer - Hugo Vermot');
  const without = await draftWith({ candidate: { full_name: 'Hugo Vermot' }, narrative: { headline } });
  assert.equal(without.subject, 'Candidature spontanée - Hugo Vermot');
  assert.equal(buildApplicationSubject({ spontaneous: true, roleType: 'Senior Product Designer', fullName: 'Hugo Vermot', language: 'en' }), 'Senior Product Designer - Hugo Vermot');
});

test('a person the employer names is asked for once when the reader is a shared inbox, never when the reader has a name', async () => {
  const claire = { firstName: 'Claire', lastName: 'Martin', title: 'Head of Design' };
  const inbox = await wp2Draft(WP2_EN, { to: 'jobs@vertech.com', contact: null, forwardTo: claire });
  assert.equal(inbox.body.match(/Claire Martin/g).length, 1);
  assert.equal(lastSentences(inbox.body).at(-1), 'Could you pass this on to Claire Martin, Head of Design?');
  assert.match(inbox.body, /^Hello,/);
  const fr = await wp2Draft(WP2_FR, { to: 'jobs@vertech.com', contact: null, forwardTo: claire, language: 'fr', reply: { language: 'fr' } });
  assert.equal(fr.body.match(/Claire Martin/g).length, 1);
  assert.equal(lastSentences(fr.body).at(-1), 'Pourriez-vous le transmettre à Claire Martin, Head of Design ?');
  // The model already named her: no second mention.
  const named = await wp2Draft(WP2_EN.replace('for plant engineers.', 'for plant engineers, a team Claire Martin leads.'), { to: 'jobs@vertech.com', contact: null, forwardTo: claire });
  assert.equal(named.body.match(/Claire Martin/g).length, 1);
  // A named recipient is the person to talk to.
  const alex = await wp2Draft(WP2_EN, { forwardTo: claire });
  assert.doesNotMatch(alex.body, /Claire|pass this on/);
});

test('French calques: "un rôle de" and "postule pour le poste" are rewritten; "CV attaché" left in the text is flagged', () => {
  const out = formatApplicationEmail('Bonjour,\n\nJe postule pour le rôle de Product Designer chez Alan. Un rôle d’Ingénieur ne me convient pas.\n\nJe postule pour un poste de designer.\n\nMon CV est en pièce jointe.', { language: 'fr', profileData: PROFILE });
  assert.match(out, /Je postule au poste de Product Designer chez Alan\. Un poste d’Ingénieur/);
  assert.match(out, /Je postule à un poste de designer\./);
  const leftover = auditApplicationEmail({ subject: 'Candidature Product Designer - Hugo Vermot', body: 'Bonjour,\n\nCV attaché, voici mon parcours.\n\nMon CV est en pièce jointe.\n\nBien à vous,\nHugo', language: 'fr' });
  assert.ok(leftover.some(issue => /Calque.*CV attaché/.test(issue)), leftover.join(' | '));
  const role = auditApplicationEmail({ subject: 'X', body: 'Bonjour,\n\nVotre rôle de Head of Design compte.\n\nMon CV est en pièce jointe.\n\nBien à vous,\nHugo', language: 'fr' });
  assert.ok(role.some(issue => /Calque.*rôle de/.test(issue)), role.join(' | '));
});

// ── WP3: keep the strongest proof (2026-10-24) ─────────────────────────────
// Bodies from the 2026-10-23 traces (scratch/email-bench results and the
// writer lenses' repros), with the candidate's facts in an inline CV.

const WP3_CV = [
  '# Hugo Vermot',
  '## Experience',
  '### OneAsset - Senior Product Designer / Product Lead (Feb 2026 - Present)',
  '*Regulated real-world asset investment platform: fractional real estate ownership from $10,000, daily USDC yield, VARA licensed.*',
  '- Designed compliance UX for a VARA-licensed RWA product: KYB/KYC onboarding, reporting workflows, investor flows.',
  '- Shipped the investor app, admin panel, marketing site and an OTC product in six months with one Product Owner.',
  '- Built interactive prototypes entirely in Cursor and Claude Code.',
  '### Creads.io - Founder (2022 - 2025)',
  '- Built a bootstrapped AI advertising SaaS with 1,200 registered users and 20 paying clients.',
  '- Read a brand website into a structured brief and checked every output against that brief.',
  '### BMW Group - Senior Product Designer (2021 - 2022)',
  "- Ran a full UX/UI audit and data analysis to identify the site's weakest conversion points.",
  '### Renault - Product Designer (2019 - 2021)',
  '- Built a multi-country design system that cut development time by 20%.',
  '### UpViral - Product Designer (2018 - 2019)',
  '- Ran multiple rounds of user interviews with real customers, translating findings directly into structural product decisions.',
  '- Measured each outcome of the onboarding redesign with the growth team.',
  '- Planned each move of the migration with engineering.',
  '## Other',
  '- Active in the French UX community. Started after two years at Marcel/Publicis.',
].join('\n');
const WP3_SIGN = 'Best,\nHugo Vermot';
const WP3_CLOSE_EN = "My CV is attached and my portfolio is linked below. I'm available for a permanent or contract role, fully remote. Could we schedule a short call this week?";
const WP3_CLOSE_INBOX = "My CV is attached and my portfolio is linked below. I'm available for a permanent or contract role, fully remote. Could you pass this on to the person hiring for the Senior Product Manager role?";
const wp3Count = text => (String(text).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
// The model's prose: every prose sentence before the code's CV line.
const wp3ModelWords = body => {
  const prose = proseOf(body);
  const last = splitSentences(prose.at(-1));
  const cvAt = last.findIndex(sentence => /^My CV is attached/.test(sentence));
  return wp3Count([...prose.slice(0, -1), ...(cvAt < 0 ? last : last.slice(0, cvAt))].join(' '));
};

test('normalizeTerm: one stem for shipping, shipped and ships, outcomes and outcome, moves and move; activation never meets active', () => {
  for (const group of [['shipping', 'shipped', 'ships', 'ship'], ['outcomes', 'outcome'], ['moves', 'move'], ['requirements', 'required', 'requires'], ['management', 'managed', 'manager'], ['livrés', 'livré', 'livrer'], ['activation', 'activated', 'activate'], ['process', 'processes']]) {
    assert.equal(new Set(group.map(normalizeTerm)).size, 1, group.join(' '));
  }
  assert.notEqual(normalizeTerm('activation'), normalizeTerm('active'));
  assert.equal(normalizeTerm('status'), 'status');
  assert.equal(normalizeTerm('users'), 'user');
});

test('grounding: "shipping", "outcomes" and "moves" are the CV\'s "shipped", "outcome" and "move", not posting terms', () => {
  const posting = 'We are shipping fast. Measure outcomes. Every move counts. Drive activation.';
  const body = ['Hello,', 'I am applying for the role.', 'In my current role, I lead product and UX with one Product Owner, shipping the investor app in six months. At UpViral I measured outcomes of the onboarding redesign. I planned moves of the migration with engineering.', 'My CV is attached.', WP3_SIGN].join('\n\n');
  assert.deepEqual(findUngroundedClaims(body, { cv: WP3_CV, sourceText: posting, sameLanguage: true }), []);
});

test('an ask in paragraph 2 is checked for figures only: "Would you be open to a quick call this week?" survives the guard', () => {
  // S4 r2 (2026-10-23): the posting says "open" and "week", and the founder's only ask was removed.
  const posting = 'Senior Product Designer at Dust. Be open to feedback, ship every week, and call out problems early.';
  const body = ['Hi Gabriel,', 'I built Creads.io, an AI advertising SaaS with 1,200 registered users.', 'I shipped the investor app, admin panel and an OTC product in six months with one Product Owner. Would you be open to a quick call this week?', 'My CV is attached and my portfolio is linked below.', WP3_SIGN].join('\n\n');
  const claims = findUngroundedClaims(body, { cv: WP3_CV, sourceText: posting, company: 'Dust', role: 'Senior Product Designer', sameLanguage: true });
  assert.deepEqual(claims, []);
  assert.match(stripUngroundedSentences(body, claims).body, /Would you be open to a quick call this week\?/);
  // The statement form too (repro-guards case 1).
  const statement = body.replace('Would you be open to a quick call this week?', "I'm open to a call this week.");
  assert.deepEqual(findUngroundedClaims(statement, { cv: WP3_CV, sourceText: posting, company: 'Dust', role: 'Senior Product Designer', sameLanguage: true }), []);
  // A past claim with a call in it is not an ask: it is checked.
  const claim = body.replace('Would you be open to a quick call this week?', 'I shipped feedback tools every week, happy to discuss on a call.');
  assert.equal(findUngroundedClaims(claim, { cv: WP3_CV, sourceText: posting, company: 'Dust', role: 'Senior Product Designer', sameLanguage: true }).length, 1);
});

test('a claim slipped into the last paragraph is checked like a proof sentence: "fund movements" (S8 r2)', () => {
  const posting = 'Senior Product Manager - Payments / Stablecoin. You will own systems that handle complex fund movements, state consistency and multi-market compliant flows.';
  const body = ['Hi,', 'Your Senior Product Manager opening at Paymonade is about compliant transaction flows.', 'In my current role on a regulated RWA investment platform with VARA licensing, I designed KYB/KYC onboarding and investor flows.', 'I want to work on payment reliability because it is the foundation of trust in digital finance. I’ve shipped compliant, multi-market product flows and built systems that handle complex fund movements and state consistency. My CV is attached. Could you pass this on to the person hiring for this role?', WP3_SIGN].join('\n\n');
  const claims = findUngroundedClaims(body, { cv: WP3_CV, sourceText: posting, company: 'Paymonade', role: 'Senior Product Manager - Payments / Stablecoin', sameLanguage: true });
  assert.equal(claims.length, 1);
  assert.match(claims[0].sentence, /fund movements/);
  assert.ok(claims[0].words.includes('fund') && claims[0].words.includes('consistency'), claims[0].words.join(', '));
  // The motivation, the CV line and the ask of that paragraph are not term-checked.
  assert.ok(!claims.some(claim => /foundation of trust|My CV|pass this on/.test(claim.sentence)));
});

test('the repro-s2 body keeps its true sentences and drops the "activation" one (the CV\'s "Active" is another word)', () => {
  const posting = 'Lead Product Designer, Growth. Own onboarding and activation. Turn insights into shipping decisions. Comfort prototyping or coding your ideas.';
  const body = ['Hi Alex,', "I'm applying for the Lead Product Designer, Growth role at Perplexity.", 'In my current role, I lead product and UX with one Product Owner, shipping the investor app, admin panel, marketing site, and an OTC product in six months. I designed the onboarding and activation flows using prototypes in Cursor and Claude Code, reviewed live, then handed off.', 'My CV is attached. I’d be happy to walk through it on a call this week.', WP3_SIGN].join('\n\n');
  const claims = findUngroundedClaims(body, { cv: WP3_CV, sourceText: posting, company: 'Perplexity', role: 'Lead Product Designer, Growth', sameLanguage: true });
  assert.deepEqual(claims.map(claim => claim.words), [['activation']]);
  const { body: out, removed } = stripUngroundedSentences(body, claims);
  assert.deepEqual(removed, ['I designed the onboarding and activation flows using prototypes in Cursor and Claude Code, reviewed live, then handed off.']);
  assert.match(out, /shipping the investor app, admin panel, marketing site, and an OTC product in six months\./);
  assert.match(out, /walk through it on a call this week\./);
});

test('a clause holding the unbacked words is cut instead of the sentence: "…serving multiple markets." → "…product."', () => {
  const posting = 'Products serving multiple legal entities or markets, or experience in regulated financial services.';
  const sentence = 'In my current role, I designed compliance workflows for a VARA-licensed product serving multiple markets.';
  const body = ['Hello,', 'Your opening at Paymonade is about compliant flows.', `${sentence} I shipped the investor app with one Product Owner.`, 'My CV is attached.', WP3_SIGN].join('\n\n');
  const claims = findUngroundedClaims(body, { cv: WP3_CV, sourceText: posting, company: 'Paymonade', sameLanguage: true });
  assert.deepEqual(claims.map(claim => claim.words), [['serving']]);
  const { body: out, removed, cut } = stripUngroundedSentences(body, claims);
  assert.deepEqual(removed, []);
  assert.deepEqual(cut, [{ sentence, clause: 'serving multiple markets', kept: 'In my current role, I designed compliance workflows for a VARA-licensed product.' }]);
  assert.match(out, /for a VARA-licensed product\. I shipped the investor app/);
  // What is left must be a whole first-person sentence of 8+ words without the flagged word.
  assert.equal(cutUngroundedClause('I designed payout callbacks for merchants.', { words: ['payout'] }), null);
  assert.equal(cutUngroundedClause('I shipped it, serving multiple markets.', { words: ['serving'] }), null);
  assert.equal(cutUngroundedClause('In my current role, using Cursor and Claude Code to prototype flows across markets.', { words: ['markets'] }), null);
  assert.equal(cutUngroundedClause('I reduced feedback loops for the team by half.', { figures: ['by half'] }), null);
});

test('end to end: the cut clause is reported in `cut`, the sentence counts as handled, nothing else is removed', async () => {
  const body = 'Hello,\n\nYour Senior Product Manager opening at Paymonade is about compliant flows.\n\nIn my current role, I designed compliance workflows for a VARA-licensed product serving multiple markets. I shipped the investor app with one Product Owner.\n\nMy CV is attached. Could we talk this week?';
  const draft = await generateApplicationEmail({
    chat: async () => `COMPANY: Paymonade\nROLE: Senior Product Manager\nLANGUAGE: en\nSUBJECT: Senior Product Manager - Hugo Vermot\nBODY:\n${body}`,
    model: 'stub', cv: WP3_CV, compactedCv: WP3_CV, profileData: PROFILE, recipient: parseRecipient('jobs@paymonade.com'),
    jobText: 'Senior Product Manager\nPaymonade\n\nRequirements\n- Products serving multiple legal entities or markets, or experience in regulated financial services.',
    language: 'en', roleHint: 'Senior Product Manager', companyHint: 'Paymonade', matcher: 'rules',
  });
  assert.deepEqual(draft.cut.map(item => item.clause), ['serving multiple markets']);
  assert.deepEqual(draft.removed, []);
  assert.equal(draft.ungrounded, 0);
  assert.match(draft.body, /for a VARA-licensed product\. I shipped the investor app/);
  assert.doesNotMatch(draft.issues.join('\n'), /serving/);
});

test('French paragraph-1 claims are checked across languages: "5 ans … produits de santé" is flagged, "Je postule au poste…" is not', () => {
  // S3 r1 (2026-10-23): the posting's "5+ years" and Alan's health products, stated as the candidate's experience.
  const posting = 'Product Designer chez Alan. Alan construit une assurance santé et des services de prévention. 5+ years of experience designing complete products.';
  const s3 = 'Product Designer chez Alan, je réponds à l’exigence de concevoir et livrer des produits complets depuis l’idée jusqu’à la mise en production, avec une expérience de 5 ans dans des produits de santé et de prévention.';
  const body = ['Bonjour,', `Je postule au poste de Product Designer chez Alan. ${s3}`, 'Depuis 2022, j’ai construit Creads.io, un SaaS publicitaire avec 1 200 utilisateurs.', 'Mon CV est en pièce jointe. Un court échange vous conviendrait-il ?', 'Bien à vous,\nHugo Vermot'].join('\n\n');
  const claims = findUngroundedClaims(body, { cv: WP3_CV, sourceText: posting, company: 'Alan', role: 'Product Designer', sameLanguage: false });
  assert.equal(claims.length, 1);
  assert.equal(claims[0].sentence, s3);
  assert.ok(claims[0].figures.some(figure => /^5 ans/.test(figure)), claims[0].figures.join(', '));
  assert.deepEqual(claims[0].words, ['santé', 'prévention']);
  // The cut keeps the sentence without the borrowed clause.
  assert.match(stripUngroundedSentences(body, claims).body, /jusqu’à la mise en production\.\n\nDepuis 2022/);
  // "1 200 utilisateurs" stays backed by "1,200 registered users"; a length of experience needs the same unit.
  const years = body.replace(s3, 'J’ai conçu des produits complets pendant 2 ans chez Marcel.');
  assert.deepEqual(findUngroundedClaims(years, { cv: WP3_CV, sourceText: posting, company: 'Alan', role: 'Product Designer', sameLanguage: false }), []);
});

test('stripUngroundedSentences works by severity: a paragraph whose every sentence is flagged keeps the one with the fewest flags', () => {
  const figure = 'I grew activation by 40% in a quarter.';
  const word = 'I owned the payouts dashboard.';
  const body = ['Hello,', 'I am applying for the role.', `${figure} ${word}`, 'My CV is attached.', WP3_SIGN].join('\n\n');
  // Given in the other order, the figure (the most severe flag) still goes first.
  const claims = [
    { paragraph: 2, sentence: word, figures: [], words: ['payouts'], jargon: ['payout'] },
    { paragraph: 2, sentence: figure, figures: ['40%'], words: [], jargon: [] },
  ];
  const { body: out, removed } = stripUngroundedSentences(body, claims);
  assert.deepEqual(removed, [figure]);
  assert.match(out, /\n\nI owned the payouts dashboard\.\n\n/);
});

const WP3_S1_MATCHES = [
  { score: 4.2, skills: true, need: 'Work starts in an LLM, moves into tools like Claude and Cursor to explore flows and interactions, and then comes into Figma for systems and polish.', proof: 'Tools: Figma' },
  { score: 7.52, need: 'Prototype using AI tools: Use Cursor and Claude Code to build and iterate on flows and simple interfaces.', proof: 'Built interactive prototypes entirely in Cursor and Claude Code.' },
  { score: 3.31, need: 'Experience planning and running customer interviews or usability tests', proof: 'Ran multiple rounds of user interviews with real customers, translating findings directly into structural product decisions.' },
];
const WP3_S8_MATCHES = [
  { score: 5.56, need: 'Products serving multiple legal entities or markets, or experience in regulated financial services and digital assets in Europe.', proof: 'Regulated real-world asset investment platform: fractional real estate ownership from $10,000, daily USDC yield, VARA licensed.' },
  { score: 5.04, need: 'Translate requirements defined by Compliance, including KYC/KYB, AML, enhanced due diligence, proof of address and regulatory remediation, into user flows, data rules and operational tools.', proof: 'Designed compliance UX for a VARA-licensed RWA product: KYB/KYC onboarding, reporting workflows, investor flows.' },
  { score: 4.19, need: 'Strong analytical skills, with the ability to use SQL or analytics tools to investigate conversion and transaction issues and measure product improvements.', proof: "Ran a full UX/UI audit and data analysis to identify the site's weakest conversion points." },
];

test('trimToWordBudget drops the lowest-value sentence: S1 r2 keeps "1,200 users" and loses "bring that same rigor"', () => {
  const proof = 'I’ve designed and shipped AI-powered products from brand context to output validation, including Creads.io, a SaaS with 1,200 users that checks every output against a structured brief before it ships.';
  const filler = 'I’ve built the core loops for that product, and I want to bring that same rigor to Ramp’s AI-first design process.';
  const body = ['Hi Sarah,',
    'Your Product Designer opening at Ramp is about building systems that shape how companies move and manage billions. You need someone who has shipped complex B2B products and can prototype in AI tools like Cursor and Claude Code.',
    `At a previous employer, I ran multiple rounds of user interviews with real customers, translating findings directly into structural product decisions. ${proof}`,
    `Creads.io is the kind of problem I want to work on, because it uses AI to generate and validate creative briefs at scale. ${filler} ${WP3_CLOSE_EN}`,
    WP3_SIGN].join('\n\n');
  assert.ok(wp3ModelWords(body) > 135);
  const { body: out, dropped } = trimToWordBudget(body, { persona: 'recruiter', matches: WP3_S1_MATCHES, cv: WP3_CV });
  assert.deepEqual(dropped, [filler]);
  assert.ok(out.includes(proof));
  assert.ok(wp3ModelWords(out) <= 120, String(wp3ModelWords(out)));
  // The motivation (25 words or fewer) and the closing stay, the ask last.
  assert.match(proseOf(out).at(-1), /^Creads\.io is the kind of problem I want to work on, because[^.]*\. My CV is attached[^?]*Could we schedule a short call this week\?$/);
});

test('trimToWordBudget keeps the matched VARA/KYB proof (S8 r1 before the trim) and drops the filler first', () => {
  const vara = 'In my current role leading Product and UX at a regulated real-world asset investment platform, I designed KYB/KYC onboarding, compliance reporting workflows and investor flows for a VARA-licensed product.';
  const bmw = "I ran a full UX/UI audit and data analysis at BMW Group to identify the site's weakest conversion points.";
  const filler = 'I’ve shipped end-to-end product systems from concept to deployment, and I’m ready to bring that rigor to your transaction journey.';
  const hook = 'Your Senior Product Manager - Payments / Stablecoin opening at Paymonade is about building compliant, scalable transaction flows across multiple markets.';
  const body = ['Hi,', `${hook} You need someone who has built regulated fintech products and can translate compliance needs into operational tools.`,
    `${vara} ${bmw} I also built a multi-country design system at Renault, cutting development time by 20% across international markets.`,
    `I want to work on regulated transaction flows because they’re the kind of complex, user-facing systems that need both technical precision and trust-first design. ${filler} ${WP3_CLOSE_INBOX}`,
    WP3_SIGN].join('\n\n');
  const { body: out, dropped } = trimToWordBudget(body, { persona: 'inbox', matches: WP3_S8_MATCHES, cv: WP3_CV });
  assert.equal(dropped[0], filler);
  for (const kept of [hook, vara, bmw]) assert.ok(out.includes(kept), kept);
  assert.ok(wp3ModelWords(out) <= 120);
  // The shape the WB-1 trace had (Renault without a figure), on a tighter budget:
  // Renault goes before anything that answers the posting, KYB/KYC stays.
  const renault = 'I also worked on an international product at Renault, building a shared multi-country design system used across teams.';
  const traced = ['Hi,', 'Your Senior Product Manager - Payments / Stablecoin opening at Paymonade is about building reliable, compliant transaction flows across multiple markets. You need someone who has built regulated fintech products and can translate compliance needs into operational flows.',
    `In my current role leading Product and UX at a regulated real-world asset investment platform, I designed compliance workflows for a VARA-licensed product, including KYB/KYC onboarding and reporting. ${bmw} ${renault}`,
    `I want to work on scalable, compliant payment systems because they’re the backbone of trust in digital finance. I’ve shipped AI-powered product systems with real user data and regulatory constraints. ${WP3_CLOSE_INBOX}`,
    WP3_SIGN].join('\n\n');
  const tight = trimToWordBudget(traced, { persona: 'inbox', matches: WP3_S8_MATCHES, cv: WP3_CV, max: 120, target: 110 });
  assert.equal(tight.dropped[0], renault);
  assert.match(tight.body, /KYB\/KYC onboarding and reporting\. I ran a full UX\/UI audit/);
});

test('trimToWordBudget on a French email: "six mois" is backed by the English CV, and the proof paragraph keeps two sentences', () => {
  // S7 (wp3-1 bench run, 2026-10-24): the trim left one sentence of proof, the weakest.
  const sixMonths = 'J’ai livré l’application investisseur, le panneau d’administration, le site marketing et un produit OTC en six mois.';
  const agent = 'J’ai aussi construit un agent IA pour Creads.io, qui génère des briefs structurés à partir du site d’une marque, puis valide chaque sortie contre ce brief avant livraison.';
  const body = ['Bonjour Camille,',
    'Votre poste de Product Designer chez Aircall porte sur la conception d’expériences de configuration intuitives pour des agents IA, avec un focus sur les frameworks, l’évaluation et les actions comme les réservations. Vous avez besoin de quelqu’un qui a conçu des flows d’IA en collaboration directe avec l’ingénierie, et peut livrer des prototypes fonctionnels rapidement.',
    `Depuis février 2026, j’ai mené le produit et l’UX dans une plateforme régulée d’actifs réels, avec un seul Product Owner. ${sixMonths} ${agent}`,
    'La configuration de ces agents IA est le type de sujet sur lequel je veux travailler, parce que c’est là que l’IA devient utile sans sacrifier la qualité ou le contrôle. Mon CV est en pièce jointe et mon portfolio est en lien ci-dessous. Je suis disponible pour un CDI, en full remote. Voulez-vous que je vous présente ce travail lors d’un court appel ?',
    'Bien à vous,\nHugo Vermot'].join('\n\n');
  const matches = [{ score: 4.31, need: 'Prototype using AI tools and collaborate with engineering on configuration flows for AI agents.', proof: 'Built interactive prototypes entirely in Cursor and Claude Code.' }];
  const { body: out, dropped } = trimToWordBudget(body, { persona: 'hiring-manager', matches, cv: WP3_CV, sameLanguage: false });
  assert.ok(dropped.length >= 1);
  assert.equal(proseOf(out)[1], `${sixMonths} ${agent}`);
  assert.match(proseOf(out).at(-1), /Voulez-vous que je vous présente ce travail lors d’un court appel \?$/);
});

const WP3_FOUNDER = ['Hi Gabriel,',
  "I'm applying for the Senior Product Designer role at Dust. I built Creads.io, an AI advertising SaaS with 1,200 registered users, where every output is checked against a structured brief before it ships. That loop from brand context to a validated output is the work I know best.",
  'In my current role, I lead product and UX for a regulated investment platform, and I shipped the investor app, admin panel, marketing site and an OTC product in six months with one Product Owner. I prototype in Cursor and Claude Code and review every flow on the live app before it goes to engineering.',
  "Dust’s agents for whole teams are the kind of product I want to work on, because a shared assistant lives or dies on its onboarding. My CV is attached and my portfolio is linked below. Would a short call be useful?",
  WP3_SIGN].join('\n\n');

test('a founder email over 85 words is merged into 2 paragraphs and trimmed to 85 or fewer, hook and closing intact', () => {
  assert.ok(wp3ModelWords(WP3_FOUNDER) > 115);
  const { body, dropped } = trimToWordBudget(WP3_FOUNDER, { persona: 'founder', cv: WP3_CV });
  assert.ok(dropped.length >= 1);
  assert.equal(proseOf(body).length, 2);
  assert.ok(wp3ModelWords(body) <= 85, String(wp3ModelWords(body)));
  assert.match(body, /^Hi Gabriel,\n\nI'm applying for the Senior Product Designer role at Dust\./);
  assert.match(proseOf(body).at(-1), /My CV is attached and my portfolio is linked below\. Would a short call be useful\?$/);
  // Under the budget, a founder email in 3 paragraphs is still merged into 2.
  const short = ['Hi Gabriel,', 'I built Creads.io, an AI SaaS with 1,200 registered users.', 'I shipped an investor app in six months.', 'My CV is attached. Would a short call be useful?', WP3_SIGN].join('\n\n');
  const merged = trimToWordBudget(short, { persona: 'founder', cv: WP3_CV });
  assert.deepEqual(merged.dropped, []);
  assert.equal(merged.body, ['Hi Gabriel,', 'I built Creads.io, an AI SaaS with 1,200 registered users. I shipped an investor app in six months.', 'My CV is attached. Would a short call be useful?', WP3_SIGN].join('\n\n'));
});

test('the founder length audit says 85 and counts the model\'s prose, not the code\'s closing', () => {
  const long = auditApplicationEmail({ subject: 'Senior Product Designer at Dust - Hugo Vermot', body: WP3_FOUNDER, language: 'en' }, { persona: 'founder' });
  const issue = long.find(item => /^Trop long/.test(item));
  assert.ok(issue, long.join(' | '));
  assert.match(issue, /\(max 85\)/);
  const trimmed = trimToWordBudget(WP3_FOUNDER, { persona: 'founder', cv: WP3_CV }).body;
  assert.ok(!auditApplicationEmail({ subject: 'Senior Product Designer at Dust - Hugo Vermot', body: trimmed, language: 'en' }, { persona: 'founder' }).some(item => /^Trop long|paragraphes :/.test(item)));
});

test('end to end: a founder draft in 3 paragraphs comes out in 2, at most 85 words before the closing, the ask last', async () => {
  const job = 'Senior Product Designer\nDust · Paris or remote\n\nWhat you will do\n- Tackle ambiguous product problems across our platform with engineering.\n- Research, prototyping, brand, or even code, in true early-stage startup fashion.';
  const draft = await generateApplicationEmail({
    chat: async () => `COMPANY: Dust\nROLE: Senior Product Designer\nLANGUAGE: en\nSUBJECT: Senior Product Designer - Hugo Vermot\nBODY:\n${proseOf(WP3_FOUNDER).map((p, i, all) => (i === all.length - 1 ? p.replace(/ My CV[\s\S]*$/, ' The CV is attached. Would a short call be useful?') : p)).join('\n\n').replace(/^/, 'Hi Gabriel,\n\n')}`,
    model: 'stub', cv: WP3_CV, compactedCv: WP3_CV, profileData: { candidate: { full_name: 'Hugo Vermot', portfolio_url: 'https://jobyougo.xyz/portfolio' } },
    recipient: parseRecipient('gabriel@dust.tt'), contact: { firstName: 'Gabriel', lastName: 'Hubert', title: 'Co-founder & CEO', persona: 'founder' },
    jobText: job, language: 'en', roleHint: 'Senior Product Designer', companyHint: 'Dust', matcher: 'rules',
  });
  assert.equal(draft.persona, 'founder');
  assert.equal(proseOf(draft.body).length, 2, draft.body);
  assert.ok(wp3ModelWords(draft.body) <= 85, draft.body);
  assert.ok(draft.trimmed.length >= 1);
  assert.match(draft.body, /^Hi Gabriel,\n\nI'm applying for the Senior Product Designer role at Dust\./);
  assert.match(lastSentences(draft.body).at(-1), /\?$/);
  assert.doesNotMatch(draft.issues.join('\n'), /Trop long|paragraphes :/);
});

// ── WP4: no broken sentences from the rewrites (2026-10-24) ─────────────────

const WP4_SIGN = 'Best,\nHugo Vermot';
const WP4_SIGN_FR = 'Bien à vous,\nHugo Vermot';
const wp4Email = (p1, p2, ask = 'My CV is attached. Could we talk this week?') => ['Hi Priya,', p1, p2, ask, WP4_SIGN].join('\n\n');
// The candidate speaking once a mask lead is set aside ("In my current role, I…").
const WP4_OWN = /(?<![\p{L}'’])(?:(?:I|[Ww]e|[Jj]e|[Nn]ous)\s+\p{L}|I['’](?:ve|m|d)\s+\p{L}|[Jj]['’]\p{L})/u;
const WP4_CV = [
  '# Hugo Vermot',
  '### Summary',
  // One summary line names three products and one fact: the fact is Creads.io's.
  'Bootstrapped products: UXfi (AI UX audit), Flemme OS (outbound automation) and Creads.io, an AI advertising SaaS with 1,200 registered users.',
  '### Independent products and ventures',
  '#### Creads.io : Founder (2024 – Present)',
  '- AI advertising SaaS that checks every output against a structured brief.',
  '- 1,200 registered users and 20 paying clients.',
  '#### Flemme OS : Founder (2022 – Present)',
  '- Outbound automation platform with modular agents.',
  '#### UXfi (uxfi.ai) : Founder (2022 – Present)',
  '- AI UX audit for e-commerce. Pricing from $10/month.',
  '#### Panfy : Builder (on hold)',
  '- Crypto analytics prototype.',
  '### Professional Experience',
  '#### Senior Product Designer / Product Lead : OneAsset (Feb 2026 – Present)',
  '- Lead product and UX for a regulated investment platform with one Product Owner.',
  '- Built interactive prototypes in Cursor and Claude Code and ran design delivery with engineering.',
  '#### Product Designer : UpViral (Jul 2024 – Dec 2025)',
  '- Ran multiple rounds of user interviews with real customers, translating findings directly into structural product decisions.',
  '#### Senior Product Designer : BMW Group (2021 – 2022)',
  "- Ran a full UX/UI audit and data analysis to identify the site's weakest conversion points.",
].join('\n');
const WP4_RULES = '## Cover letters\n\n**Named employers (hard rule):** Do **not** name unknown or low-recognition employers as proof: OneAsset, UpViral. For current roles describe the work.\n\n## Other\nx';

test('stripProcessDetail cuts only the clause with the process term, and never leaves a sentence without its subject', () => {
  const live = [
    'In my current role, I prototype flows in Cursor and Claude Code and ship them to engineering with GitHub pull requests.',
    'In my current role, I run design delivery on GitHub, using Cursor and Claude Code for prototypes.',
    'In my current role, I ran design delivery on GitHub.',
    'In my current role, I built a Git-based design workflow with engineering, using Cursor and Claude Code to prototype flows.',
  ];
  for (const sentence of live) {
    const out = proseOf(stripProcessDetail(wp4Email('Your opening is about agentic delivery.', `${sentence} I shipped Creads.io to 1,200 users.`)))[1];
    for (const kept of splitSentences(out)) {
      const rest = kept.replace(/^In my current role,?\s*/i, '');
      assert.match(rest, WP4_OWN, `${sentence} -> ${out}`);
      assert.doesNotMatch(kept, /GitHub|\bGit\b|pull request/i);
    }
    assert.doesNotMatch(out, /In my current role\.|In my current role, using/);
    assert.match(out, /I shipped Creads\.io to 1,200 users\.$/);
  }
  // The clause goes, the sentence stays.
  assert.equal(proseOf(stripProcessDetail(wp4Email('Hook.', live[0])))[1], 'In my current role, I prototype flows in Cursor and Claude Code and ship them to engineering.');
  assert.equal(proseOf(stripProcessDetail(wp4Email('Hook.', `${live[1]} I shipped Creads.io.`)))[1], 'In my current role, I run design delivery, using Cursor and Claude Code for prototypes. I shipped Creads.io.');
  // A dropped sentence takes "This includes…" with it; a paragraph is never emptied.
  assert.equal(proseOf(stripProcessDetail(wp4Email('Hook.', `${live[2]} This includes live reviews. I shipped Creads.io to 1,200 users.`)))[1], 'I shipped Creads.io to 1,200 users.');
  assert.equal(proseOf(stripProcessDetail(wp4Email('Hook.', live[2])))[1], live[2]);
  assert.equal(proseOf(stripProcessDetail(wp4Email('Hook.', `${live[2]} This includes live reviews.`)))[1], 'This includes live reviews.');
  // French: the "via GitHub" clause.
  const fr = proseOf(stripProcessDetail(['Bonjour,', 'Accroche.', 'Dans mon poste actuel, j’ai conçu les prototypes dans Cursor et je les ai livrés aux développeurs via GitHub chaque semaine.', 'Mon CV est en pièce jointe.', WP4_SIGN_FR].join('\n\n')))[1];
  assert.equal(fr, 'Dans mon poste actuel, j’ai conçu les prototypes dans Cursor et je les ai livrés aux développeurs.');
});

test('maskUnnamedEmployers never writes a second mask, a possessive mask or "À mon employeur actuel"', () => {
  const opts = { unnamedEmployers: ['OneAsset', 'UpViral'], latestNames: ['OneAsset'], language: 'en' };
  const en = maskUnnamedEmployers(wp4Email('Intro sentence about the role.', "In my current role, I lead product and UX at OneAsset, a regulated real-world asset platform. I redesigned OneAsset's onboarding with one Product Owner.", "I'd be happy to walk through the Creads.io workflow or the OneAsset onboarding on a call."), opts);
  assert.match(en.body, /In my current role, I lead product and UX at a regulated real-world asset platform\./);
  assert.match(en.body, /I redesigned the onboarding at my current employer with one Product Owner\./);
  assert.match(en.body, /the Creads\.io workflow or the onboarding at my current employer on a call\./);
  assert.doesNotMatch(en.body, /in my current role[^.]*in my current role|employer onboarding|OneAsset/i);
  assert.deepEqual(en.masked, ['OneAsset']);
  // A sentence start with an apposition says it is the current job; an earlier one keeps its description.
  const lead = maskUnnamedEmployers(wp4Email('Intro.', 'At OneAsset, a regulated platform, I designed KYC. At UpViral, a SaaS platform, I led discovery. Currently, I work at OneAsset on payments.'), opts).body;
  assert.match(lead, /In my current role at a regulated platform, I designed KYC\. At a SaaS platform, I led discovery\. Currently, I work on payments\./);
  const fr = maskUnnamedEmployers(['Bonjour,', 'Intro.', "À OneAsset, j'ai livré l'app investisseur. Chez OneAsset, une plateforme régulée, j'ai conçu le KYC. J'ai conçu l'app d'OneAsset. À UpViral, j'ai mené la découverte.", 'Mon CV est en pièce jointe.', WP4_SIGN_FR].join('\n\n'), { ...opts, language: 'fr' }).body;
  assert.match(fr, /Dans mon poste actuel, j'ai livré l'app investisseur\./);
  assert.match(fr, /Dans mon poste actuel, pour une plateforme régulée, j'ai conçu le KYC\./);
  assert.match(fr, /J'ai conçu l'app de mon employeur actuel\./);
  assert.match(fr, /Chez un précédent employeur, j'ai mené la découverte\./);
  assert.doesNotMatch(fr, /À mon employeur|d'mon/);
});

test('fixCurrentRoleAttribution and the opener move never leave a sentence opening "At <Name>, I" or "Chez <Name>, j\'"', () => {
  const opener = /(?:^|[.!?]\s+)(?:At (?!a |an |my |the )\p{Lu}[^,]*,\s*I(?![\p{L}])|Chez (?!un |mon )\p{Lu}[^,]*,\s*j['’])/mu;
  const cv = ['### Professional Experience', '#### Product Lead : OneAsset (Feb 2026 – Present)', '- Designed compliance UX for a VARA-licensed RWA product: KYB/KYC onboarding, reporting workflows.', '#### Senior Product Designer : BMW Group (2021 – 2022)', "- Ran a full UX/UI audit and data analysis to identify the site's weakest conversion points."].join('\n');
  const body = wp4Email('I am applying for the role.', "In my current role, I designed compliance UX for a VARA-licensed RWA product. In my current role, I ran a full UX/UI audit and data analysis to identify the site's weakest conversion points.");
  const { body: out, fixed } = fixCurrentRoleAttribution(body, cv, { unnamedEmployers: ['OneAsset'] });
  assert.equal(fixed.length, 1);
  assert.doesNotMatch(out, opener);
  assert.match(out, /I ran a full UX\/UI audit and data analysis to identify the site's weakest conversion points at BMW Group\./);
  const frCv = `${cv}\n- Mené un audit UX/UI complet et une analyse de données pour identifier les points de conversion les plus faibles du site.`;
  const fr = fixCurrentRoleAttribution(['Bonjour,', 'Je postule.', "Dans mon poste actuel, j'ai conçu une UX de conformité pour un produit RWA sous licence VARA. Dans mon poste actuel, j'ai mené un audit UX/UI complet et une analyse de données pour identifier les points de conversion les plus faibles du site.", 'Mon CV est en pièce jointe.', WP4_SIGN_FR].join('\n\n'), frCv, { unnamedEmployers: ['OneAsset'], language: 'fr' });
  assert.doesNotMatch(fr.body, opener);
  // The model's own openers (2026-10-24 wp3 bench: S2, S5, S8).
  const moved = relocateEmployerOpeners(wp4Email(
    'At Creads.io, I designed a multi-pass validation layer that checks every output against a structured brief before it ships, ensuring consistency.',
    "At Shiseido, I redesigned loyalty flows, onboarding, and account space end-to-end, driving +20% enrollment. At BMW Group, I ran a full UX/UI audit and data analysis to identify the site's weakest conversion points. At Société Générale, I designed national-scale banking flows for millions of customers, navigating MiFID II constraints. At a previous employer, I ran user interviews.",
  ));
  assert.equal(moved.moved.length, 4);
  assert.doesNotMatch(moved.body, opener);
  assert.match(moved.body, /I designed a multi-pass validation layer at Creads\.io that checks every output/);
  assert.match(moved.body, /I redesigned loyalty flows, onboarding, and account space end-to-end at Shiseido, driving \+20% enrollment\./);
  assert.match(moved.body, /weakest conversion points at BMW Group\./);
  assert.match(moved.body, /for millions of customers at Société Générale, navigating MiFID II constraints\./);
  assert.match(moved.body, /At a previous employer, I ran user interviews\./);
  const frMoved = relocateEmployerOpeners(['Bonjour,', 'Accroche.', "Chez Renault, j'ai conçu une marketplace de véhicules qui relie acheteurs et vendeurs.", 'Mon CV est en pièce jointe.', WP4_SIGN_FR].join('\n\n'));
  assert.match(frMoved.body, /J'ai conçu une marketplace de véhicules chez Renault qui relie acheteurs et vendeurs\./);
  // "À Creads.io, j'ai…" (wp4 bench S3) and a participle clause as the anchor.
  assert.match(relocateEmployerOpeners(['Bonjour,', 'Accroche.', 'À Creads.io, j’ai mis en place un contrôle en deux passes avant livraison.', 'Mon CV est en pièce jointe.', WP4_SIGN_FR].join('\n\n')).body, /J’ai mis en place un contrôle en deux passes avant livraison chez Creads\.io\./);
  assert.match(relocateEmployerOpeners(wp4Email('Hook.', 'At Société Générale, I designed savings flows across desktop and mobile, working with the compliance team.')).body, /across desktop and mobile at Société Générale, working with the compliance team\./);
  // "At First, I…" is not a place.
  assert.equal(relocateEmployerOpeners(wp4Email('Hook.', 'At First, I thought the flow was simple.')).moved.length, 0);
});

test('cleanSentenceQuality: a motivation echoing the hook stays, French function words are not content, the role reads as the layout writes it', () => {
  const sig = 'Best,\nHugo Vermot\nhttps://x.io/portfolio';
  // repro #9: the motivation starts from the hook's concrete thing, as the prompt asks.
  const body9 = `Hi Sarah,\n\nYour Product Designer opening at Ramp is about onboarding flows for small business owners. You need someone who has shipped fintech onboarding.\n\nIn my current role, I designed KYB onboarding for a regulated platform.\n\nOnboarding flows for small business owners are the kind of problem I want to work on, because a first week decides retention. My CV is attached. Let me know if a call works.\n\n${sig}`;
  assert.deepEqual(cleanSentenceQuality(body9, { company: 'Ramp', role: 'Product Designer' }).dropped, []);
  // French hook and motivation sharing only "des agents IA".
  const fr = ['Bonjour Camille,', 'Vous concevez des agents IA pour les appels vocaux.', 'Depuis 2022, je construis des produits avec des agents IA et une validation en deux passes.', 'Concevoir la configuration des agents IA est le type de sujet sur lequel je veux travailler, parce que la confiance se gagne au premier appel. Mon CV est en pièce jointe.', WP4_SIGN_FR].join('\n\n');
  assert.deepEqual(cleanSentenceQuality(fr, { company: 'Aircall', role: 'Product Designer', language: 'fr' }).dropped, []);
  // WB-8 repro: "l'accès aux soins" twice is the company's own subject, echoed.
  const alan = 'Bonjour,\n\nAlan simplifie l’accès aux soins pour les salariés et leurs familles. Je postule pour un poste de Product Designer.\n\nDepuis 2022, j’ai construit des produits IA comme Creads.io, un SaaS publicitaire avec 1 200 utilisateurs.\n\nRendre l’accès aux soins plus simple est le sujet sur lequel je veux travailler, parce que la prévention se joue au quotidien. Mon CV est en pièce jointe.\n\nBien à vous,\nHugo Vermot';
  assert.deepEqual(cleanSentenceQuality(alan, { company: 'Alan', role: 'Product Designer', sourceText: 'Alan simplifie l’accès aux soins.', language: 'fr' }).dropped, []);
  // GitLab: the role with a colon, as the layout writes it ("…Management, Agentic…").
  const role = 'Director, Product Management: Agentic Software Delivery';
  const gitlab = wp4Email("I'm applying for the Director, Product Management, Agentic Software Delivery role at GitLab.", 'In my current role, I shipped agentic software delivery tooling for a regulated platform.');
  assert.deepEqual(cleanSentenceQuality(gitlab, { company: 'GitLab', role }).dropped, []);
  // A real repeat between two proofs still goes.
  const repeat = wp4Email('Hook about the role.', 'I built a multi-pass validation layer for generated creatives. Every creative goes through the multi-pass validation layer before delivery.');
  assert.equal(cleanSentenceQuality(repeat, { company: 'Acme', role: 'Designer' }).dropped.length, 1);
});

test('French regexes see accented words: "attiré", "réduit de moitié", "doublé", "livrée", "étant donné", "à mon poste actuel", "un échange"', () => {
  const frBody = ['Bonjour,', 'Je suis attiré par votre mission de prévention santé chez Alan.', "J'ai réduit de moitié le temps d'onboarding sur une plateforme régulée. J'ai doublé la conversion du parcours KYC.", 'Mon CV est en pièce jointe. Dites-moi si un appel vous convient.', WP4_SIGN_FR].join('\n\n');
  const audit = auditApplicationEmail({ subject: 'Product Designer chez Alan - Hugo Vermot', body: frBody, language: 'fr' });
  assert.ok(audit.some(issue => /Ouverture mise en scène : "Je suis attiré"/.test(issue)), audit.join('\n'));
  assert.ok(auditApplicationEmail({ subject: 'x', body: frBody.replace('Je suis attiré par', 'Je suis intéressée par'), language: 'fr' }).some(issue => /mise en scène/.test(issue)));
  const claims = findUngroundedClaims(frBody, { cv: '#### Lead : Acme (2023 - present)\n- Designed KYC onboarding for a regulated platform.', sourceText: 'onboarding santé', sameLanguage: false });
  assert.deepEqual(claims.flatMap(claim => claim.figures), ['réduit de moitié', 'doublé']);
  // A participle fragment is joined back; a feeling sentence with "étant donné" is a reason and stays.
  assert.match(formatApplicationEmail('Bonjour,\n\nJe postule.\n\nJ’ai conçu l’app investisseur. Livrée en six mois.\n\nMon CV est en pièce jointe.', { language: 'fr', profileData: {} }), /J’ai conçu l’app investisseur, livrée en six mois\./);
  assert.match(formatApplicationEmail('Bonjour,\n\nJe suis attirée par ce poste étant donné mon travail sur des parcours KYC régulés depuis trois ans.\n\nMon CV est en pièce jointe.', { language: 'fr', profileData: {} }), /étant donné mon travail/);
  // "À mon poste actuel" is the candidate's mask, not posting words; "un échange" is an ask.
  const frCv = '### Expérience professionnelle\n#### Product Designer : Acme (2022 – aujourd’hui)\n- J’ai conçu des parcours KYC pour une plateforme régulée.';
  const masked = ['Bonjour,', 'Je postule au poste de Product Designer chez Alan.', 'À mon poste actuel, j’ai conçu des parcours KYC.', 'Mon CV est en pièce jointe. Pouvons-nous échanger ?', WP4_SIGN_FR].join('\n\n');
  assert.deepEqual(findUngroundedClaims(masked, { cv: frCv, sourceText: 'Le poste actuel demande des parcours KYC.', sameLanguage: true }), []);
  const ask = ['Bonjour,', 'Je postule au poste de Product Designer chez Alan.', 'J’ai conçu des parcours KYC.', 'Un échange rapide sur l’onboarding mobile me conviendrait. Mon CV est en pièce jointe.', WP4_SIGN_FR].join('\n\n');
  assert.deepEqual(findUngroundedClaims(ask, { cv: frCv, sourceText: 'Vous concevrez l’onboarding mobile.', sameLanguage: true }), []);
});

test('a list of the candidate\'s product names: names kept without their groups, then cut to the one with a fact', () => {
  // The live S3 sentence: "Name (…)" groups go, the colon opens the list.
  const s3 = formatApplicationEmail('Bonjour,\n\nJe postule au poste de Product Designer chez Alan.\n\nDepuis 2022, j’ai construit des produits AI autonomes : UXfi (audit UX), Flemme OS (automatisation outbound), Creads.io (SaaS publicitaire avec 1 200 utilisateurs).\n\nMon CV est en pièce jointe.', { language: 'fr', profileData: {} });
  assert.match(s3, /Depuis 2022, j’ai construit des produits AI autonomes, dont UXfi, Flemme OS et Creads\.io\./);
  // A group after a common noun is content, and the old comma rule keeps it.
  assert.match(formatApplicationEmail('Hello,\n\nI shipped a full product (investor app, admin panel and marketing site) in six months under VARA (licence).\n\nMy CV is attached.', { language: 'en', profileData: {} }), /full product, investor app, admin panel and marketing site, in six months under VARA \(licence\)\./);
  const quality = (p2, language) => cleanSentenceQuality(['Hello,', 'I am applying for the Product Designer role at Alan.', p2, 'My CV is attached.', WP4_SIGN].join('\n\n'), { company: 'Alan', role: 'Product Designer', cv: WP4_CV, language });
  // Creads.io is the product the CV gives users and clients: the list becomes it.
  assert.equal(proseOf(quality('Depuis 2022, j’ai construit des produits AI autonomes, dont UXfi, Flemme OS et Creads.io.', 'fr').body)[1], 'Depuis 2022, j’ai construit des produits AI autonomes, dont Creads.io.');
  assert.equal(proseOf(quality('Depuis 2022, j’ai construit en solo des produits IA, UXfi, Flemme OS, Creads.io et Panfy.', 'fr').body)[1], 'Depuis 2022, j’ai construit en solo des produits IA, dont Creads.io.');
  assert.equal(proseOf(quality('Since 2022, I’ve built bootstrapped AI products from user flows through deployment, UXfi, Flemme OS, Creads.io.', 'en').body)[1], 'Since 2022, I’ve built bootstrapped AI products from user flows through deployment, including Creads.io.');
  // The sentence names its product again (wp4 bench S6): the list just goes.
  assert.equal(proseOf(quality('Depuis 2022, j’ai construit trois produits autonomes en IA, UXfi, Flemme OS et Creads.io, dont Creads.io est un SaaS public avec 1 200 utilisateurs.', 'fr').body)[1], 'Depuis 2022, j’ai construit trois produits autonomes en IA, dont Creads.io est un SaaS public avec 1 200 utilisateurs.');
  // No product with a fact: the sentence goes when its paragraph has another one.
  const none = quality('I built UXfi, Flemme OS and Panfy as prototypes. I shipped an investor app in six months.', 'en');
  assert.deepEqual(none.dropped, ['I built UXfi, Flemme OS and Panfy as prototypes.']);
  // Tools are not products.
  assert.deepEqual(quality('I prototype in Figma, Cursor and Claude Code every week for engineering.', 'en').dropped, []);
});

test('the CV-copy audit sees a CV bullet behind "At X," or a mask; a paraphrase is not flagged', () => {
  const copy = sentence => auditApplicationEmail({ subject: 'x', body: wp4Email('Your Product Designer opening at Ramp is about AI prototyping. You need someone who runs research.', sentence), language: 'en' }, { copySource: WP4_CV, minCopyWords: 12 }).filter(issue => /recopiée/.test(issue));
  assert.equal(copy('At a previous employer, I ran multiple rounds of user interviews with real customers, translating findings directly into structural product decisions.').length, 1);
  assert.equal(copy("At BMW Group, I ran a full UX/UI audit and data analysis to identify the site's weakest conversion points.").length, 1);
  assert.equal(copy('In my current role, I lead product and UX for a regulated investment platform with one Product Owner.').length, 1);
  assert.equal(copy('At BMW Group, I audited the site and its data to find where visitors dropped off before buying.').length, 0);
  assert.equal(copy('I talked to real customers many times, and what they said changed how the product was structured.').length, 0);
});

test('dropBrokenSentences drops bare masks, masks before a gerund, doubled masks and short verbless lines, never a whole paragraph', () => {
  const body = wp4Email('Your opening is about agentic delivery.', [
    'In my current role.',
    'This includes a multi-pass validation layer.',
    'In my current role, using Cursor and Claude Code to prototype flows and interact with code.',
    'In my current role leading Product and UX in my current role, a regulated real-world asset platform.',
    'Six months, one Product Owner.',
    'In my current role, with one Product Owner, I shipped the investor app in six months.',
    'Creads.io checks every output.',
  ].join(' '));
  const { body: out, dropped, kept } = dropBrokenSentences(body);
  assert.deepEqual(dropped, [
    'In my current role.',
    'This includes a multi-pass validation layer.',
    'In my current role, using Cursor and Claude Code to prototype flows and interact with code.',
    'In my current role leading Product and UX in my current role, a regulated real-world asset platform.',
    'Six months, one Product Owner.',
  ]);
  assert.deepEqual(kept, []);
  assert.equal(proseOf(out)[1], 'In my current role, with one Product Owner, I shipped the investor app in six months. Creads.io checks every output.');
  // The closing is the code's and is not read; a question is never "verbless".
  assert.equal(proseOf(out)[2], 'My CV is attached. Could we talk this week?');
  // A paragraph with nothing else keeps its broken sentence, reported in `kept`.
  const alone = dropBrokenSentences(wp4Email('Your opening is about agentic delivery.', 'In my current role, using Cursor for prototypes.'));
  assert.deepEqual(alone.dropped, []);
  assert.deepEqual(alone.kept, ['In my current role, using Cursor for prototypes.']);
  // French: a bare mask and "en utilisant" with no subject.
  const fr = dropBrokenSentences(['Bonjour,', 'Accroche sur le poste.', 'Dans mon poste actuel. Dans mon poste actuel, en utilisant Cursor pour les prototypes. J’ai livré l’app investisseur en six mois.', 'Mon CV est en pièce jointe. Pouvons-nous échanger ?', WP4_SIGN_FR].join('\n\n'));
  assert.equal(proseOf(fr.body)[1], 'J’ai livré l’app investisseur en six mois.');
});

test('a first paragraph that was only a feeling sentence becomes the role opener, not a missing paragraph', async () => {
  const slotted = formatApplicationEmail('Bonjour,\n\nJe suis attiré par votre mission de prévention chez Alan.\n\nJ’ai conçu des parcours KYC.\n\nMon CV est en pièce jointe.', { language: 'fr', profileData: {}, keepRoleSlot: true });
  const filled = ensureRoleOpener(slotted, { role: 'Product Designer', company: 'Alan', language: 'fr' });
  assert.equal(proseOf(filled)[0], 'Je postule au poste de Product Designer chez Alan.');
  assert.equal(proseOf(filled)[1], 'J’ai conçu des parcours KYC.');
  // No role: the slot goes, nothing invisible is left.
  assert.doesNotMatch(ensureRoleOpener(slotted, { role: '', company: 'Alan', language: 'fr' }), /\uE000/);
  // Without the option the layout keeps its old behaviour.
  assert.doesNotMatch(formatApplicationEmail('Bonjour,\n\nJe suis attiré par votre mission.\n\nJ’ai conçu des parcours KYC.\n\nMon CV est en pièce jointe.', { language: 'fr', profileData: {} }), /\uE000|attiré/);
  const draft = await generateApplicationEmail({
    chat: async () => 'COMPANY: Alan\nROLE: Product Designer\nLANGUAGE: fr\nSUBJECT: Product Designer - Hugo Vermot\nBODY:\nBonjour,\n\nJe suis attiré par votre mission de prévention chez Alan.\n\nDans mon poste actuel, je dirige le produit et l’UX pour une plateforme d’investissement régulée.\n\nPouvons-nous échanger cette semaine ?',
    model: 'stub', cv: WP4_CV, compactedCv: WP4_CV, profileData: { candidate: { full_name: 'Hugo Vermot' } }, profileContext: WP4_RULES,
    recipient: parseRecipient('jobs@alan.com'), jobText: 'Product Designer chez Alan. Vous concevrez les parcours de prévention santé pour nos membres.', language: 'fr', roleHint: 'Product Designer', companyHint: 'Alan', matcher: 'rules',
  });
  assert.match(proseOf(draft.body)[0], /^Je postule au poste de Product Designer chez Alan\.$/);
  assert.doesNotMatch(draft.body, /attiré|\uE000/);
});

test('end to end: no bare mask, no doubled mask, no "At <Name>, I" in the final email', async () => {
  const raw = [
    'COMPANY: Acme', 'ROLE: Product Designer', 'LANGUAGE: en', 'SUBJECT: Product Designer - Hugo Vermot', 'BODY:',
    'Hi,',
    '',
    'Your Product Designer opening at Acme is about regulated onboarding. You need someone who leads product and UX on a regulated investment platform.',
    '',
    'In my current role, I lead product and UX at OneAsset, a regulated investment platform, with one Product Owner. In my current role, I handed designs over through pull requests. This includes live reviews. In my current role, using Cursor and Claude Code for prototypes. At BMW Group, I ran a site audit and data analysis that showed where visitors dropped off.',
    '',
    'Could we talk this week?',
  ].join('\n');
  const draft = await generateApplicationEmail({
    chat: async () => raw, model: 'stub', cv: WP4_CV, compactedCv: WP4_CV, profileData: { candidate: { full_name: 'Hugo Vermot' } }, profileContext: WP4_RULES,
    recipient: parseRecipient('jobs@acme.com'), jobText: 'Product Designer\nYou will lead product and UX for our regulated investment platform, with research, prototypes and a site audit.', language: 'en', roleHint: 'Product Designer', companyHint: 'Acme', matcher: 'rules',
  });
  const sentences = proseOf(draft.body).flatMap(paragraph => splitSentences(paragraph));
  assert.ok(!sentences.some(sentence => /^In my current role[.,]?\s*(?:using\b|\.|$)/i.test(sentence)), draft.body);
  assert.ok(!sentences.some(sentence => (sentence.match(/in my current role|my current employer/gi) || []).length >= 2), draft.body);
  assert.ok(!sentences.some(sentence => /^At (?!a |an |my |the )\p{Lu}[^,]*,\s*I\b/u.test(sentence)), draft.body);
  assert.doesNotMatch(draft.body, /OneAsset|pull request|handed designs|This includes/);
  assert.match(draft.body, /In my current role, I lead product and UX at a regulated investment platform, with one Product Owner\./);
  assert.match(draft.body, /I ran a site audit and data analysis at BMW Group that showed where visitors dropped off\./);
  assert.deepEqual(draft.broken, ['In my current role, using Cursor and Claude Code for prototypes.']);
});

test('the process cut keeps a sentence about the reader, and takes a two-word clause whole instead of leaving "…, and hand off."', () => {
  // A hook sentence has no "I": a verb left is enough (it used to go whole).
  assert.equal(proseOf(stripProcessDetail(wp4Email('Your Product Designer opening at Ramp is about AI prototyping. You need someone who has shipped B2B products, writes PRDs and prototypes with AI tools.', 'I shipped Creads.io to 1,200 users.')))[0],
    'Your Product Designer opening at Ramp is about AI prototyping. You need someone who has shipped B2B products and prototypes with AI tools.');
  // 2026-10-24 bench, S4: the verb lost its object, the clause goes.
  assert.equal(proseOf(stripProcessDetail(wp4Email('Hook.', 'I prototype in Cursor and Claude Code, and hand off through PRDs. I shipped Creads.io to 1,200 users.')))[1], 'I prototype in Cursor and Claude Code. I shipped Creads.io to 1,200 users.');
  assert.equal(proseOf(stripProcessDetail(wp4Email('Hook.', 'I prototype in Cursor, and hand the flows over to engineering through GitHub pull requests.')))[1], 'I prototype in Cursor, and hand the flows over.');
  // A mask with a clause before its subject keeps the subject.
  assert.equal(proseOf(stripProcessDetail(wp4Email('Hook.', 'In my current role, using GitHub for reviews, I shipped the investor app in six months.')))[1], 'In my current role, I shipped the investor app in six months.');
  // A mask followed by a participle and no subject is never kept, cut or not.
  assert.equal(proseOf(stripProcessDetail(wp4Email('Hook.', 'In my current role, using Cursor and Claude Code to prototype flows, with GitHub reviews. I shipped Creads.io.')))[1], 'I shipped Creads.io.');
});

test('a clause cut never leaves a participle hanging: "…, working directly." takes the whole participle clause (S10)', () => {
  assert.deepEqual(cutUngroundedClause('I designed investment flows across desktop and mobile at Société Générale, working directly with front-end and mobile engineers.', { words: ['front-end'] }),
    { clause: 'working directly with front-end and mobile engineers', kept: 'I designed investment flows across desktop and mobile at Société Générale.' });
  assert.equal(cutUngroundedClause('J’ai conçu les parcours d’investissement sur desktop et mobile pour la banque, en travaillant directement avec les équipes front-end.', { words: ['front-end'] }).kept,
    'J’ai conçu les parcours d’investissement sur desktop et mobile pour la banque.');
});

test('the last paragraph\'s sentence about the company is not a claim, and a sentence leaning on a removed one goes with it (S13)', () => {
  const cv = '#### Lead : Acme (2023 - present)\n- Designed KYB/KYC onboarding for a regulated platform.';
  const body = ['Hi Nadia,', 'Your Senior Product Designer, Onboarding role at Brightwell is about a compliant onboarding journey.', 'In my current role, I designed KYB/KYC onboarding for a regulated platform.', 'Onboarding is the first moment a company decides if Brightwell becomes their finance team’s daily tool. That’s the kind of problem I want to work on, because month-end closing should take days. My CV is attached. Could we talk this week?', WP4_SIGN].join('\n\n');
  assert.deepEqual(findUngroundedClaims(body, { cv, sourceText: 'The first moment a customer decides whether Brightwell becomes their daily tool is onboarding.', company: 'Brightwell', role: 'Senior Product Designer, Onboarding' }), []);
  // When a strip does remove the sentence it points at, "That's…" goes too.
  const removed = ['Onboarding is the first moment a company decides if Brightwell becomes their finance team’s daily tool.'];
  const after = body.replace(`${removed[0]} `, '');
  const out = dropOrphanedAnaphors(body, after, removed);
  assert.deepEqual(out.dropped, ['That’s the kind of problem I want to work on, because month-end closing should take days.']);
  assert.equal(proseOf(out.body)[2], 'My CV is attached. Could we talk this week?');
  // Nothing removed, nothing dropped.
  assert.deepEqual(dropOrphanedAnaphors(body, body, []).dropped, []);
  // A paragraph is never emptied.
  const alone = wp4Email('Hook.', 'I built a validation layer for generated ads. This keeps every output on brief.');
  assert.deepEqual(dropOrphanedAnaphors(alone, wp4Email('Hook.', 'This keeps every output on brief.'), ['I built a validation layer for generated ads.']).dropped, []);
});

test('the trim keeps the model\'s hook behind the code\'s role opener (S4: the Creads.io hook went first)', () => {
  const body = ['Hi Gabriel,',
    "I'm applying for the Senior Product Designer role at Dust. I built Creads.io, an AI advertising SaaS with 1,200 users, where I designed the full workflow from brand-context memory to structured brief generation and multi-pass output validation before shipping.",
    'In my current role, I lead product and UX with one Product Owner on a regulated investment platform. In six months, I shipped the investor app, admin panel, marketing site, and an OTC product with engineering. I prototype in Cursor and Claude Code. I’ve spent four years building bootstrapped AI products.',
    'My CV is attached. Could we talk this week?', WP4_SIGN].join('\n\n');
  const out = trimToWordBudget(body, { persona: 'founder' });
  assert.ok(out.dropped.length >= 1);
  assert.ok(!out.dropped.some(sentence => /Creads\.io/.test(sentence)), out.dropped.join(' | '));
  assert.match(proseOf(out.body)[0], /^I'm applying for the Senior Product Designer role at Dust\. I built Creads\.io, an AI advertising SaaS with 1,200 users/);
  const fr = ['Bonjour Gabriel,',
    'Je postule au poste de Senior Product Designer chez Dust. J’ai construit Creads.io, un SaaS publicitaire avec 1 200 utilisateurs, où j’ai conçu tout le flux, du contexte de marque à la validation en plusieurs passes avant livraison.',
    'Dans mon poste actuel, je dirige le produit et l’UX avec un seul Product Owner sur une plateforme d’investissement régulée. En six mois, j’ai livré l’app investisseur, le panel admin, le site marketing et un produit OTC avec l’équipe technique. Je prototype dans Cursor et Claude Code.',
    'Mon CV est en pièce jointe. Pouvons-nous échanger cette semaine ?', WP4_SIGN_FR].join('\n\n');
  const frOut = trimToWordBudget(fr, { persona: 'founder' });
  assert.ok(!frOut.dropped.some(sentence => /Creads\.io/.test(sentence)), frOut.dropped.join(' | '));
  // Without the code's opener the first sentence is the hook, as before.
  assert.ok(!trimToWordBudget(body.replace("I'm applying for the Senior Product Designer role at Dust. ", ''), { persona: 'founder' }).dropped.some(sentence => /Creads\.io/.test(sentence)));
});

test('an extra matched pair far below the best one is left out (GitLab: "how investment is allocated" ↔ the bank\'s savings line)', () => {
  const cv = [
    '# Hugo Vermot', '### Professional Experience',
    '#### Product Lead : OneAsset (Feb 2026 – Present)',
    '- Designed compliance UX for a VARA-licensed RWA product: KYB/KYC onboarding, reporting workflows, investor flows.',
    '- Built interactive prototypes in Cursor and Claude Code and shipped them with engineering.',
    '#### Senior Product Designer : Société Générale (2019 – 2021)',
    '- Retail banking: savings, allocation, and investment products. National scale, millions of customers.',
    '#### Product Designer : UpViral (2017 – 2019)',
    '- Ran multiple rounds of user interviews with real customers.',
  ].join('\n');
  const posting = ['Senior Product Designer, Payments', 'What you will do',
    '- Design compliant KYB/KYC onboarding and reporting workflows for our VARA-licensed RWA investors.',
    '- Establish how investment is allocated and reallocated across our four roadmaps at scale.',
    '- Partner with research on interviews.'].join('\n');
  const proofsOf = text => matchPostingToCv(text, cv, 3).map(match => match.proof.slice(0, 20));
  assert.deepEqual(proofsOf(posting), ['Designed compliance ']);
  // Alone, the same weak pair is the best there is, and stays.
  assert.deepEqual(proofsOf(posting.split('\n').filter(line => !line.startsWith('- Design compliant')).join('\n')), ['Retail banking: savi']);
  // A second strong pair stays next to the first.
  assert.deepEqual(proofsOf(`${posting}\n- Build interactive prototypes in Cursor and Claude Code with engineering.`), ['Designed compliance ', 'Built interactive pr']);
});

test('a short sentence with a name and a verb the list does not hold is not "verbless"', () => {
  const out = dropBrokenSentences(wp4Email('Your opening is about agentic delivery.', 'Creads.io validates every brief. Six months, one Product Owner. I shipped the investor app.'));
  assert.deepEqual(out.dropped, ['Six months, one Product Owner.']);
  assert.equal(proseOf(out.body)[1], 'Creads.io validates every brief. I shipped the investor app.');
});

test('a participle that only carries the process term goes with it: "basé sur Git", "pilotée par Git" (S7, S12)', () => {
  const fr = (p1, p2) => ['Bonjour Camille,', p1, p2, 'Mon CV est en pièce jointe. Pouvons-nous échanger ?', WP4_SIGN_FR].join('\n\n');
  const s7 = proseOf(stripProcessDetail(fr('Vous avez besoin de quelqu’un qui a déjà mis en œuvre un flux de design basé sur Git avec les développeurs, et peut livrer des expériences complexes en peu de temps.', 'En six mois, j’ai livré l’application investisseur, le panneau d’administration, le site marketing et un produit OTC, avec un flux de design basé sur GitHub.')));
  assert.equal(s7[0], 'Vous avez besoin de quelqu’un qui a déjà mis en œuvre un flux de design avec les développeurs, et peut livrer des expériences complexes en peu de temps.');
  // Little left of an "avec…" clause: the clause goes.
  assert.equal(s7[1], 'En six mois, j’ai livré l’application investisseur, le panneau d’administration, le site marketing et un produit OTC.');
  assert.equal(proseOf(stripProcessDetail(fr('Accroche.', 'Dans mon poste actuel, j’ai livré l’application investisseur, le site marketing et un produit OTC, avec une livraison pilotée par Git. J’ai conçu le KYC.')))[1],
    'Dans mon poste actuel, j’ai livré l’application investisseur, le site marketing et un produit OTC. J’ai conçu le KYC.');
  // "avec ingénieurs" keeps its noun; after an auxiliary the participle is the verb.
  assert.equal(proseOf(stripProcessDetail(fr('Vous avez besoin de quelqu’un qui a conçu des flux d’agents IA et peut livrer avec ingénieurs via un flux Git.', 'J’ai conçu le KYC.')))[0], 'Vous avez besoin de quelqu’un qui a conçu des flux d’agents IA et peut livrer avec ingénieurs.');
  assert.equal(proseOf(stripProcessDetail(fr('Accroche.', 'Dans mon poste actuel, j’ai travaillé sur GitHub avec les développeurs pour livrer l’application investisseur.')))[1], 'Dans mon poste actuel, j’ai travaillé avec les développeurs pour livrer l’application investisseur.');
});

test('a clause cut never leaves a preposition before a comma: no "I\'ve worked with, aligning…" (S9)', () => {
  assert.equal(cutUngroundedClause('I’ve worked with engineering teams on fixed-scope projects, aligning design with technical delivery.', { words: ['fixed-scope'] }), null);
  // The participle clause itself still goes when it holds the flag.
  assert.equal(cutUngroundedClause('I designed the investor onboarding for a regulated platform, working with fixed-scope engineering squads.', { words: ['fixed-scope'] }).kept, 'I designed the investor onboarding for a regulated platform.');
});

test('the trim cuts a hollow link before the motivation (S5: "…, exactly the kind of workflow GitLab is scaling." stayed and the motivation went)', () => {
  const body = ['Hi Priya,', 'Your Director, Product Management, Agentic Software Delivery role at GitLab is about shaping how AI transforms software delivery from manual handoffs to agent-driven workflows. You need someone who has built AI-native product systems and can model that workflow in practice.',
    'I’ve spent four years building bootstrapped AI products, including Creads.io, where brand context, structured briefs, and multi-pass validation ensure output quality before shipping. I’ve also led product strategy across regulated fintech and international SaaS, with a focus on compliance, user trust, and delivery speed.',
    'Agentic software delivery is the kind of problem I want to work on, because it’s where AI stops being a helper and starts making real decisions in production. I’ve built systems that check outputs against briefs, route tasks through agents, and hand off to code, exactly the kind of workflow GitLab is scaling. My CV is attached and my portfolio is linked below. I\'m available for a permanent role, fully remote. I’d be happy to walk through that work on a call this week.',
    WP4_SIGN].join('\n\n');
  assert.deepEqual(trimToWordBudget(body, {}).dropped, ['I’ve built systems that check outputs against briefs, route tasks through agents, and hand off to code, exactly the kind of workflow GitLab is scaling.']);
});

test('"PRs" is process detail: "…, then shipped them through PRs." loses its clause (S10)', () => {
  assert.equal(proseOf(stripProcessDetail(wp4Email('Hook.', 'I designed components and patterns in Figma, then shipped them through PRs. I prototyped interactions in Cursor.')))[1], 'I designed components and patterns in Figma. I prototyped interactions in Cursor.');
  assert.ok(auditApplicationEmail({ subject: 'x', body: wp4Email('Your opening is about design systems at Chess.com.', 'I shipped every component through PRs with the front-end team.'), language: 'en' }).some(issue => /process : "PRs"/.test(issue)));
});

test('an ask that names "regulated flows" is still an ask, never cut as a claim (S13); a real past-work claim beside it still is', () => {
  const cv = '#### Lead : Acme (2023 - present)\n- Designed KYB/KYC onboarding for a regulated platform.';
  const ask = 'I’d be happy to walk through my work on regulated flows and AI prototyping on a call this week.';
  const body = ['Hi Nadia,', 'Your Senior Product Designer, Onboarding role at Brightwell is about a compliant onboarding journey.', 'In my current role, I designed KYB/KYC onboarding for a regulated platform.', `That is the kind of problem I want to work on, because month-end closing should take days. My CV is attached. ${ask}`, WP4_SIGN].join('\n\n');
  const opts = { cv, sourceText: 'You will lead AI prototyping for onboarding flows.', company: 'Brightwell', role: 'Senior Product Designer, Onboarding' };
  assert.deepEqual(findUngroundedClaims(body, opts), []);
  const claim = findUngroundedClaims(body.replace(ask, 'I’ve led AI prototyping for regulated flows, and I’d be happy to talk on a call this week.'), opts);
  assert.equal(claim.length, 1);
  assert.ok(claim[0].words.includes('prototyping'), claim[0].words.join(', '));
});

// ── WP5: request plumbing (2026-10-24) ─────────────────────────────────────
// The language is settled in code (always French or English), the person the
// posting names reaches the prompt, and the unsourced company blurb is cut
// inside the writer, where the bench sees it.

const WP5_DE_JOB = [
  'UX Designer – Fokus digitale Gesundheitsprodukte & KI (m/w/d)',
  'Kliniqo GmbH · Berlin oder Home Office',
  '',
  'Über uns',
  'Kliniqo entwickelt digitale Gesundheitsprodukte für Arztpraxen und ihre Patientinnen und Patienten. Wir sind ein Team von 40 Menschen in Berlin.',
  '',
  'Deine Aufgaben',
  '- Du gestaltest die Nutzererfahrung unserer App von der Recherche bis zum fertigen Design.',
  '- Du arbeitest eng mit dem Produktteam und den Entwicklern zusammen und baust ein Designsystem auf.',
  '',
  'Dein Profil',
  '- Mehrjährige Erfahrung als UX Designer, gerne im Gesundheitswesen.',
  '- Sehr gute Englischkenntnisse, Deutsch ist ein Plus.',
].join('\n');
const WP5_REPLY = 'COMPANY: Kliniqo GmbH\nROLE: UX Designer\nLANGUAGE: de\nSUBJECT: UX Designer - Jo Martin\nBODY:\nHallo,\n\nYour UX Designer opening at Kliniqo is about a design system for doctors and their patients.\n\nI built a design system used by four product teams. I also ran usability tests with operators every sprint.\n\nCould we talk this week?';

test('detectTextLanguage names German, Spanish, Italian, Dutch and Portuguese offers, and a looser reading takes a short French one', async () => {
  const { detectTextLanguage } = await import('../lib/application-email.mjs');
  assert.equal(detectTextLanguage(WP5_DE_JOB), 'de');
  assert.equal(detectTextLanguage('Buscamos un diseñador de producto con experiencia en el diseño de interfaces para nuestro equipo de producto. El puesto es remoto y trabajarás con los ingenieros y las personas de negocio del equipo. También valoramos la experiencia en sistemas de diseño.'), 'es');
  assert.equal(detectTextLanguage('Cerchiamo un product designer con esperienza nella progettazione di interfacce per la nostra azienda. Il lavoro è da remoto e lavorerai con gli sviluppatori e il team di prodotto. Sono richieste anche competenze di ricerca utente.'), 'it');
  assert.equal(detectTextLanguage('Wij zoeken een product designer met ervaring in het ontwerpen van interfaces voor onze klanten. Je gaat werken met het team van ontwikkelaars en je bent verantwoordelijk voor de gebruikerservaring van ons platform bij ons bedrijf.'), 'nl');
  assert.equal(detectTextLanguage('Buscamos um product designer com experiência em design de interfaces para a nossa empresa. O trabalho é remoto e você vai trabalhar com a equipe de produto e os engenheiros. Também valorizamos experiência com pesquisa.'), 'pt');
  const shortFr = 'Nous recherchons un Product Designer pour notre équipe à Lyon, avec une expérience des produits B2B.';
  assert.equal(detectTextLanguage(shortFr), '');
  assert.equal(detectTextLanguage(shortFr, { minWords: 8, minHits: 2 }), 'fr');
  // Domains, addresses and links are no words: "acme.com" read as the Portuguese "com".
  const domains = 'Join chess.com and lichess.com teams. Visit acme.com, docs.acme.com, help.acme.com. Contact jobs@acme.com.';
  assert.equal(detectTextLanguage(domains, { minWords: 8, minHits: 2 }), '');
  // English "do" and "per" count for no other language.
  assert.equal(detectTextLanguage('What do we do per day? We do the work, per the plan, and you do yours.', { minWords: 8, minHits: 2 }), 'en');
});

test('the code\'s role opener never carries the posting\'s gender tag', async () => {
  const reply = 'COMPANY: Kliniqo GmbH\nROLE: UX Designer – Fokus digitale Gesundheitsprodukte & KI (m/w/d)\nLANGUAGE: en\nSUBJECT: x\nBODY:\nHello,\n\nI built a design system used by four product teams, and I ran usability tests with operators every sprint.\n\nRegulated flows are where I do my best work, because every screen has to earn trust.\n\nCould we talk this week?';
  const draft = await generateApplicationEmail({ chat: async () => reply, model: 'stub', cv: WP2_CV, compactedCv: WP2_CV, profileData: WP2_PROFILE, recipient: parseRecipient('jobs@kliniqo.de'), jobText: WP5_DE_JOB, language: 'auto', companyHint: 'Kliniqo GmbH', matcher: 'rules' });
  // Nor its dash and German qualifiers (writer review WL-4).
  assert.match(draft.body, /I'm applying for the UX Designer role at Kliniqo GmbH\./, draft.body);
  assert.doesNotMatch(draft.body, /m\/w\/d|–|Fokus/);
});

test('a German company page with no posting: the warning names the page, not an offer', async () => {
  const page = 'Kliniqo entwickelt digitale Gesundheitsprodukte für Arztpraxen und ihre Patientinnen und Patienten. Wir sind ein Team von 40 Menschen in Berlin und arbeiten mit Kliniken auf der ganzen Welt. Unsere Produkte werden von über 2000 Praxen genutzt, und wir wachsen auch in Österreich und der Schweiz mit unserem Team.';
  const draft = await generateApplicationEmail({ chat: async () => WP5_REPLY, model: 'stub', cv: WP2_CV, profileData: WP2_PROFILE, recipient: parseRecipient('jobs@kliniqo.de'), companyText: page, language: 'auto', matcher: 'rules' });
  assert.equal(draft.language, 'en');
  assert.deepEqual(draft.warnings, ['Site de l\'entreprise en allemand : email écrit en anglais (changez-le dans le menu langue).']);
});

test('a German offer: the email is written in English, greets once, and says so in a warning', async () => {
  let user = '';
  const draftFor = (options = {}) => generateApplicationEmail({
    chat: async ({ messages }) => { user = messages[0].content; return WP5_REPLY; },
    model: 'stub', cv: WP2_CV, compactedCv: WP2_CV, profileData: WP2_PROFILE, recipient: parseRecipient('jobs@kliniqo.de'),
    jobText: WP5_DE_JOB, language: 'auto', roleHint: 'UX Designer – Fokus digitale Gesundheitsprodukte & KI', companyHint: 'Kliniqo GmbH', matcher: 'rules', ...options,
  });
  const draft = await draftFor();
  assert.equal(draft.language, 'en');
  assert.match(draft.body, /^Hello,\n\n/);
  assert.doesNotMatch(draft.body, /Hallo/);
  assert.equal((draft.body.match(/^(?:Hello|Hi|Hallo|Bonjour)\b/gm) || []).length, 1, draft.body);
  assert.deepEqual(draft.warnings, ['Offre en allemand : email écrit en anglais (changez-le dans le menu langue).']);
  assert.match(user, /- Write in English\./);
  // A German posting and an English email share no word: that check would only send a false issue to the repair.
  assert.ok(!draft.issues.some(issue => /ne reprend aucun sujet/.test(issue)), draft.issues.join(' | '));
  assert.deepEqual(offerLinkIssues({ role: 'UX Designer', body: 'Hello,\n\nI built a design system because teams needed it.\n\nBest,' }, { jobText: WP5_DE_JOB, crossLanguage: true }), []);
  // The profile's language.output, when it is French, is the fallback instead.
  const fr = await draftFor({ profileLanguage: 'fr' });
  assert.equal(fr.language, 'fr');
  assert.deepEqual(fr.warnings, ['Offre en allemand : email écrit en français (changez-le dans le menu langue).']);
  // An explicit choice wins and needs no warning.
  const chosen = await draftFor({ language: 'en' });
  assert.deepEqual(chosen.warnings, []);
});

test('"Auto" with nothing to read: the profile\'s fr or en, else English; never left to the model', async () => {
  const reply = 'COMPANY: Northwind\nROLE: Product Designer\nLANGUAGE: fr\nSUBJECT: x\nBODY:\nBonjour,\n\nJ’ai construit un design system utilisé par quatre équipes produit.\n\nPouvons-nous en parler cette semaine ?';
  const draftWith = profileLanguage => generateApplicationEmail({ chat: async () => reply, model: 'stub', cv: WP2_CV, profileData: WP2_PROFILE, recipient: parseRecipient('jobs@northwind.io'), language: 'auto', profileLanguage, matcher: 'rules' });
  assert.equal((await draftWith('')).language, 'en');
  assert.equal((await draftWith('fr')).language, 'fr');
  assert.equal((await draftWith('de')).language, 'en');
});

test('the person the posting names reaches the prompt as one Reader line, and the closing names them once', async () => {
  const marie = { firstName: 'Marie', lastName: 'Dupont', title: 'Head of Design' };
  const reader = parseRecipient('jobs@tallyhop.io');
  const { user } = buildApplicationEmailMessages({ cv: WP2_CV, recipient: reader, forwardTo: marie, roleHint: 'Product Designer', companyHint: 'Tallyhop' });
  assert.equal(user.match(/Person hiring, named in the posting: Marie Dupont, Head of Design\./g).length, 1);
  // A reader with a name is the person to talk to: no line.
  const named = buildApplicationEmailMessages({ cv: WP2_CV, recipient: withContact(parseRecipient('alex.kim@tallyhop.io'), { firstName: 'Alex' }), forwardTo: marie });
  assert.doesNotMatch(named.user, /Person hiring/);
  // End to end: the prompt the model got carries the line, the body names Marie once, in the ask.
  const draft = await wp2Draft(WP2_EN, { to: 'jobs@vertech.com', contact: null, forwardTo: marie });
  assert.match(draft.prompt.user, /Person hiring, named in the posting: Marie Dupont, Head of Design\./);
  assert.equal(draft.body.match(/Marie Dupont/g).length, 1);
  assert.equal(lastSentences(draft.body).at(-1), 'Could you pass this on to Marie Dupont, Head of Design?');
});

test('the unsourced company blurb is cut inside the writer, and the candidate\'s own product sentence stays', async () => {
  const body = 'Hello,\n\nVertech designs industrial automation solutions. I\'m applying for the UX/UI Designer role.\n\nI built a design system used by four product teams. Figma is my main tool.\n\nCould we talk this week?';
  const draft = await wp2Draft(body, { to: 'jobs@vertech.com', contact: null, jobText: '', companyText: '', reply: { company: 'Vertech' } });
  assert.ok(draft.removed.includes('Vertech designs industrial automation solutions.'), draft.removed.join(' | '));
  assert.doesNotMatch(draft.body, /designs industrial automation/);
  assert.match(draft.body, /Figma is my main tool\./);
  // With the posting read, the same sentence has a source: it stays.
  const read = await wp2Draft(body, { to: 'jobs@vertech.com', contact: null, reply: { company: 'Vertech' } });
  assert.ok(!read.removed.includes('Vertech designs industrial automation solutions.'));
});

// ── WP6: the matcher feeds the right proof ──────────────────────────────────
// Inline copies of the CV shapes the 2026-10-24 analysis traced (an owner-like
// CV: a current job with a contract line then a product line, a Git workflow
// line, a little-known previous employer with a descriptor). Never cv.md.
const WP6_CV = [
  '# Hugo Vermot', '',
  '### Summary', '',
  'Since February 2026 I lead Product and UX at OneAsset, a regulated real-world asset investment platform. Design delivery now runs on Git: PRDs, feature branches, prototypes in Cursor and Claude Code, live review in Figmol (the internal tool I built), then handoff to engineering.', '',
  '### Professional Experience', '',
  '#### Senior Product Designer / Product Lead : OneAsset (Feb 2026 – Present)',
  '*Salaried; product lead with one Product Owner.*',
  '*Regulated real-world asset investment platform: fractional real estate ownership from $10,000, daily USDC yield (Base / ERC-3643), VARA licensed.*',
  '- Built interactive prototypes entirely in Cursor and Claude Code, reviewed them in Figmol (internal Figma-like tool mirroring the live app), and ran a GitHub flow with engineering (PRD, feature branch, PR review).',
  '- Designed compliance UX for a VARA-licensed RWA product: KYB/KYC onboarding, reporting workflows, investor flows, OTC, trust-first UI (Base / ERC-3643).',
  "- Built a Git-based design workflow with engineering: PRD written, feature branch opened, live prototype in Cursor/Claude Code, Figmol review, PR opened for engineering, implementation continues in Cursor and Claude Code. Design changes are checked for PRD coherence against the CTO's internal specification agent, the product's database of record.", '',
  '#### Founder / Independent AI Product Builder (2022 – Present)',
  '*Solo AI product studio: UX auditing, outbound automation, creative generation.*',
  '- Combined product design, prompt engineering, agent orchestration, scoring-system design, and growth automation into a single delivery practice.', '',
  '#### Product Designer / Product Manager : UpViral (Jul 2024 – Dec 2025)',
  '*SaaS marketing platform, about 10,000 users.*',
  '- Led a complete SaaS overhaul as the sole designer: UI redesign, information architecture rebuild, and user-flow redesign from weak initial foundations.',
  '- Ran multiple rounds of user interviews with real customers, translating findings directly into structural product decisions.',
  '- Partnered directly with the CPO on roadmap and priorities.',
  '- Led implementation with developers while continuing user interviews and product refinement in parallel. This is the main example of day-to-day engineering collaboration besides OneAsset.', '',
  '### Skills', '- Tools: Figma, Cursor, Claude Code',
].join('\n');
const WP6_RAMP = [
  'ABOUT THE ROLE', '',
  'As a Product Designer at Ramp, you are accountable for outcomes, not just artifacts. You work with PMs, engineers, and other designers to define the right problems.',
  'Design at Ramp is AI first and builder led. Work starts in an LLM, moves into tools like Claude and Cursor to explore flows and interactions, and then comes into Figma for systems and polish.', '',
  'WHAT YOU’LL DO', '',
  ' - Prototype using AI tools: Use Cursor and Claude Code to build and iterate on flows and simple interfaces. Let AI generate code while you guide structure, behavior, and UX quality.',
  ' - Validate assumptions with self-serve research: Talk directly with customers, run quick tests, and use what you learn to adjust direction.', '',
  'WHAT WE’RE LOOKING FOR', '',
  ' - Clear communication and comfort collaborating directly with engineers and PMs',
].join('\n');
const WP6_GITLAB = [
  'What you’ll do',
  "- Represent the section with GitLab's senior leadership, key enterprise customers, partners, and industry audiences, while modeling AI-native product management across discovery, synthesis, prototyping, roadmap exploration, and concept development.",
  '- Technical fluency to work with engineers and architects on pipeline design, artifact workflows, deployment strategies, and observability signals such as logs, metrics, and traces.',
].join('\n');
const WP6_FIGMA_ONLY = [
  'Product Designer', 'Tallyhop · Paris or remote (Europe)', '',
  'What you will do',
  '- Contribute to our design system in Figma.', '',
  'About you',
  '- Fluent English; French is a plus.',
].join('\n');

test('WP6: Ramp\'s AI-prototyping need is answered with the Cursor and Claude Code line, and the tools pair never comes first', () => {
  const matches = matchPostingToCv(WP6_RAMP, WP6_CV, 3);
  assert.ok(matches.length >= 1);
  assert.notEqual(matches[0].skills, true, 'a real pair scoring higher comes before the tools pair');
  for (let i = 1; i < matches.length; i++) assert.ok(matches[i - 1].score >= matches[i].score, 'sorted by score');
  const block = formatPostingMatches(matches, { unnamedEmployers: ['OneAsset', 'UpViral'], internalTools: ['Figmol'], cv: WP6_CV });
  const answer = block.split(/\n(?=\d+\. )/).find(item => /Prototype using AI tools/.test(item));
  assert.ok(answer, block);
  assert.match(answer, /CV answer[^\n]*"[^"]*Cursor and Claude Code[^"]*"/);
  assert.doesNotMatch(answer, /\bGit/);
  // The pair was scored on the shown line, which keeps the words it matched on.
  const pair = matches.find(match => /Prototype using AI tools/.test(match.need));
  assert.match(pair.excerpt, /Cursor and Claude Code/);
  assert.ok(pair.words.includes('cursor'));
  // The workflow told as its steps is never the proof, for any of these postings.
  for (const posting of [WP6_RAMP, WP6_GITLAB, WP6_FIGMA_ONLY, 'Requirements\n- Partner with engineers to keep Figma and the code libraries in sync, and review implementations.']) {
    assert.ok(matchPostingToCv(posting, WP6_CV, 3).every(match => !/design workflow/.test(match.proof)));
  }
});

test('WP6: pairs sharing only concepts and their own trigger words stay below the strong gate (GitLab)', async () => {
  const { hasStrongMatch } = await import('../lib/application-email.mjs');
  const matches = matchPostingToCv(WP6_GITLAB, WP6_CV, 3);
  assert.ok(matches.every(match => match.words.length > 0 || match.score < 4), JSON.stringify(matches.map(m => [m.score, m.words])));
  assert.ok(matches.every(match => match.score < STRONG_MATCH_SCORE), JSON.stringify(matches.map(m => [m.score, m.words, m.concepts])));
  assert.equal(hasStrongMatch(matches), false);
});

test('WP6: the tools pair alone does not switch on MATCHES (Figma-only posting, weak real pairs)', async () => {
  const { hasStrongMatch } = await import('../lib/application-email.mjs');
  const matches = matchPostingToCv(WP6_FIGMA_ONLY, WP6_CV, 3);
  assert.ok(matches.some(match => match.skills), 'the tools pair is there');
  assert.equal(matches.find(match => match.skills).need, 'Contribute to our design system in Figma.', 'no bullet left on the need');
  assert.equal(hasStrongMatch(matches), false);
  assert.equal(hasStrongMatch([{ skills: true, score: 4.2 }, { score: 4.5, words: ['kyc'] }]), true);
  let prompt = '';
  await generateApplicationEmail({
    chat: async ({ messages }) => { prompt ||= messages[0].content; return 'COMPANY: Tallyhop\nROLE: Product Designer\nLANGUAGE: en\nSUBJECT: Product Designer - Hugo Vermot\nBODY:\nHello,\n\nI\'m applying for the Product Designer role at Tallyhop.\n\nI ran user interviews with real customers.\n\nCould we talk this week?'; },
    model: 'x', cv: WP6_CV, compactedCv: WP6_CV, profileData: PROFILE, jobText: WP6_FIGMA_ONLY, language: 'en', roleHint: 'Product Designer', companyHint: 'Tallyhop', matcher: 'rules',
  });
  assert.ok(prompt.includes('## Posting'), 'the prompt was captured');
  assert.doesNotMatch(prompt, /## MATCHES/);
});

test('WP6: broadenWorkflow keeps what matched in a list of process steps and drops the clause that only carries the process', async () => {
  const { broadenWorkflow } = await import('../lib/application-email.mjs');
  const line154 = 'Built interactive prototypes entirely in Cursor and Claude Code, reviewed them in Figmol (internal Figma-like tool mirroring the live app), and ran a GitHub flow with engineering (PRD, feature branch, PR review).';
  assert.doesNotMatch(broadenWorkflow(line154), /ran engineering|GitHub/);
  const line160 = 'Built a Git-based design workflow with engineering: PRD written, feature branch opened, live prototype in Cursor/Claude Code, Figmol review, PR opened for engineering, implementation continues in Cursor and Claude Code.';
  const broad = broadenWorkflow(line160);
  assert.match(broad, /live prototype in Cursor and Claude Code/);
  assert.doesNotMatch(broad, /Git-based|PRD|feature branch|PR opened|review/);
  // The leftovers the 2026-10-24 bench showed once the process term was cut.
  assert.equal(broadenWorkflow('I design in Cursor and Claude Code, and hand off via GitHub.'), 'I design in Cursor and Claude Code.');
  assert.equal(broadenWorkflow('I designed components and patterns in Figma, then shipped them through PRs and feature branches.'), 'I designed components and patterns in Figma.');
  assert.equal(broadenWorkflow('Design delivery runs on Git, I prototype directly in Cursor and Claude Code.'), 'I prototype directly in Cursor and Claude Code.');
  assert.equal(broadenWorkflow('I design in Figma, but my current workflow runs on Git, I build interactive prototypes in Cursor and Claude Code.'), 'I design in Figma, but I build interactive prototypes in Cursor and Claude Code.');
  assert.equal(broadenWorkflow('The design delivery runs on Git, with prototypes in Cursor and Claude Code.'), 'The design delivery runs on prototypes in Cursor and Claude Code.');
  assert.equal(broadenWorkflow('Design delivery now runs on Git: PRDs, feature branches, prototypes in Cursor and Claude Code, live review in Figmol, then handoff to engineering.'), 'Design delivery now runs on prototypes in Cursor and Claude Code, then handoff to engineering.');
  assert.equal(broadenWorkflow('Shipped the investor app in the first 6 months, with design delivery on Git.'), 'Shipped the investor app in the first 6 months.');
  assert.equal(broadenWorkflow('I built a design workflow with engineering: live prototypes in Cursor and Claude Code, reviewed in my internal tool Figmol, then handed off via GitHub.'), 'I built a design workflow with engineering: live prototypes in Cursor and Claude Code.');
  // As the main verb, the GitHub flow stays for stripProcessDetail, which drops the sentence ("I, reviewing…" before).
  const mainVerb = broadenWorkflow('I used a GitHub flow with engineering, reviewing live prototypes in an internal tool I built.');
  assert.equal(mainVerb, 'I used a GitHub flow with engineering, reviewing live prototypes.');
  assert.doesNotMatch(stripProcessDetail(`Hello,\n\nI'm applying.\n\nI built prototypes in Cursor. ${mainVerb}\n\nCould we talk?`), /GitHub|reviewing/);
  const then = broadenWorkflow('I then ran a GitHub flow with engineering, using PRDs and feature branches, with live reviews.');
  assert.equal(then, 'I ran a GitHub flow with engineering, using PRDs and feature branches, with live reviews.');
  const stripped = stripProcessDetail(`Hello,\n\nI'm applying.\n\nI built prototypes in Cursor. ${then}\n\nCould we talk?`);
  assert.doesNotMatch(stripped, /I with engineering|GitHub/, stripped);
  assert.equal(broadenWorkflow('I shipped the full product using a GitHub flow with engineering.'), 'I shipped the full product.');
  assert.equal(broadenWorkflow('I shipped components using Cursor and Claude Code, with prototypes reviewed in an internal tool I built.'), 'I shipped components using Cursor and Claude Code.');
  assert.equal(broadenWorkflow('I work with engineers daily, using GitHub PRs and live reviews to align on implementation.'), 'I work with engineers daily, using live reviews to align on implementation.');
  // The review as the verb: the sentence is left whole for the internal-tool filter, never "The live app was."
  assert.equal(broadenWorkflow('The live app was reviewed in an internal tool I built before handoff to engineering.'), 'The live app was reviewed in an internal tool I built before handoff to engineering.');
  // Nothing to do on a line without process detail.
  assert.equal(broadenWorkflow('I work with engineering every day.'), 'I work with engineering every day.');
});

test('WP6: an excerpt keeps the end of a list of nouns, and never a step the process strip drops', () => {
  assert.equal(
    proofExcerpt('Combined product design, prompt engineering, agent orchestration, scoring-system design, and growth automation into a single delivery practice.', { words: ['agent'] }),
    'Combined product design, prompt engineering, agent orchestration, scoring-system design, and growth automation into a single delivery practice.',
  );
  // "PR opened for engineering" holds "engineering" but is a step: the focus falls back to the plain excerpt.
  const focused = proofExcerpt('Built a Git-based design workflow with engineering: PRD written, feature branch opened, live prototype in Cursor/Claude Code, Figmol review, PR opened for engineering, implementation continues in Cursor and Claude Code.', { words: ['engin', 'implementat'] });
  assert.match(focused, /implementation continues in Cursor and Claude Code/);
  assert.doesNotMatch(focused, /PR opened/);
});

test('WP6: a line of process steps only is never a pair, nor a fragment under six words without a figure', () => {
  const cv = [
    '### Experience', '',
    '#### Product Designer : Acme (2020 – 2024)',
    '- GitHub PRs and feature branches with engineering.',
    '- Ran pull request reviews.',
    '- Drove +12% investment activity on the savings flows.',
  ].join('\n');
  const matches = matchPostingToCv('Requirements\n- Work with engineering on pull requests, feature branches and code review every week.\n- Grow investment activity on savings flows.', cv, 3);
  assert.ok(matches.every(match => !/GitHub PRs|pull request reviews/.test(match.proof)), JSON.stringify(matches));
});

test('WP6: an employer kept unnamed is described from its CV line, the current one too', async () => {
  const { employerDescriptor } = await import('../lib/application-email.mjs');
  assert.equal(employerDescriptor(WP6_CV, 'UpViral'), 'a SaaS marketing platform with about 10,000 users');
  assert.equal(employerDescriptor(WP6_CV, 'OneAsset'), 'a regulated real-world asset investment platform', 'the contract line is skipped');
  assert.equal(employerDescriptor(WP6_CV, 'Unknown Corp'), '');
  assert.equal(employerDescriptor('', 'UpViral'), '');
  const bank = '### Experience\n\n#### Senior Product Designer : Big Bank (2023 – 2024)\n*Retail banking: savings, allocation, and investment products.*\n- Designed savings flows.';
  assert.equal(employerDescriptor(bank, 'Big Bank'), 'a company in retail banking', 'a field, not a company');
  assert.equal(employerDescriptor('### Experience\n\n#### Designer : Acme (2020 – 2022)\n*Contract: AI analytics platform for retailers.*\n- Built dashboards.', 'Acme'), 'an AI analytics platform for retailers', '"Contract:" is cut, the rest kept');
  const upviral = { need: 'Customer research.', proof: 'Ran multiple rounds of user interviews with real customers, translating findings directly into structural product decisions.', employer: 'UpViral', role: 'Product Designer / Product Manager', current: false, latest: false, product: false, dates: 'Jul 2024 – Dec 2025' };
  const block = formatPostingMatches([upviral], { unnamedEmployers: ['UpViral', 'OneAsset'], cv: WP6_CV });
  assert.match(block, /"at a SaaS marketing platform with about 10,000 users"/);
  assert.doesNotMatch(block, /UpViral|a previous employer/);
  // No descriptor in the CV: the old mask.
  assert.match(formatPostingMatches([upviral], { unnamedEmployers: ['UpViral'] }), /"at a previous employer"/);
  const current = { need: 'Regulated products.', proof: 'Designed compliance UX for a VARA-licensed RWA product: KYB/KYC onboarding, reporting workflows.', employer: 'OneAsset', role: 'Senior Product Designer / Product Lead', current: true, latest: true, product: false, dates: 'Feb 2026 – Present' };
  const now = formatPostingMatches([current], { unnamedEmployers: ['OneAsset'], cv: WP6_CV });
  assert.match(now, /"in my current role" \(the employer: a regulated real-world asset investment platform\)/);
  assert.doesNotMatch(now, /OneAsset/);
});

test('WP6: a need answered twice (tools pair and a real pair) is named once', () => {
  const need = 'Strong Figma and prototyping skills; experience with AI prototyping tools is a plus.';
  const block = formatPostingMatches([
    { need, proof: 'Tools: Figma', skills: true, score: 4.2 },
    { need, proof: 'Built interactive prototypes entirely in Cursor and Claude Code.', employer: 'Acme', role: 'Designer', current: false, latest: false, product: false, dates: '2020 – 2024', score: 3.9 },
  ]);
  assert.equal(block.split(need).length - 1, 1);
  assert.match(block, /2\. Posting asks: the same need as 1/);
});

test('WP6: the main description collapses a list of product names to the one with a fact', () => {
  const profile = {
    narrative: {
      exit_story: 'Has built bootstrapped AI products for 4 years (since 2022): UXfi, Flemme OS, Creads.io and Panfy. Creads.io is the launched AI advertising SaaS: 1,200 registered users and 20 paying clients. Since February 2026 leads Product and UX at OneAsset: with one Product Owner, shipped the investor app in the first 6 months, with design delivery on Git (PRD, feature branch, prototype in Cursor and Claude Code, PR review with engineering).',
      superpowers: ['Four years of bootstrapped AI products (UXfi, Flemme OS, Creads.io, Panfy): brand context, structured briefs'],
    },
  };
  return import('../lib/application-email.mjs').then(({ candidateDescription }) => {
    const { text } = candidateDescription(profile);
    assert.doesNotMatch(text, /UXfi, Flemme OS|Flemme OS, Creads\.io/);
    assert.match(text, /including Creads\.io/);
    assert.doesNotMatch(text, /on Git|PRD|PR review/);
  });
});

test('WP6: a review clause after a comma never earns a pair, and the model never cites the workflow told as steps', () => {
  // Chess.com's "review implementations" paired at 5.59 on "…, reviewed them in
  // Figmol", a clause the email then cuts as internal-tool detail (2026-10-24 bench, S10).
  const posting = 'What you will do\n- Partner with engineers to keep Figma and the code libraries in sync, and review implementations.';
  const matches = matchPostingToCv(posting, WP6_CV, 3);
  assert.ok(matches.length, 'a pair is still found');
  assert.ok(matches.every(match => !/review/i.test(match.excerpt || '')), JSON.stringify(matches, null, 1));
  assert.equal(
    proofExcerpt('Built interactive prototypes entirely in Cursor and Claude Code, reviewed them in Figmol, and ran a GitHub flow with engineering.', { words: ['review', 'cod'] }),
    'Built interactive prototypes entirely in Cursor and Claude Code.',
  );
  // The model's pairs follow the same rule as the rules' pairs.
  const cvLines = numberCvLines(WP6_CV);
  const at = re => cvLines.findIndex(line => re.test(line.text)) + 1;
  const quote = 'Use Cursor and Claude Code to build and iterate on flows';
  const reply = { matches: [
    { need: 'AI prototyping', quote, lines: [at(/Git-based design workflow/)], strength: 'strong' },
    { need: 'AI prototyping', quote, lines: [at(/Built interactive prototypes entirely/)], strength: 'strong' },
  ] };
  const kept = validatePostingMatches(reply, { jobText: WP6_RAMP, cv: WP6_CV, cvLines });
  assert.ok(kept.length >= 1, JSON.stringify(kept));
  assert.ok(kept.every(match => !/design workflow/.test(match.proof)), JSON.stringify(kept, null, 1));
});

test('WP6: broadenWorkflow leftovers after a conjunction, a bare verb or a French connector', async () => {
  const { broadenWorkflow } = await import('../lib/application-email.mjs');
  // "…runs on and I build…" before.
  assert.equal(broadenWorkflow('My current workflow runs on Git, and I build prototypes in Cursor and Claude Code.'), 'I build prototypes in Cursor and Claude Code.');
  assert.equal(broadenWorkflow('Design delivery runs on Git, so I prototype directly in Cursor and Claude Code.'), 'I prototype directly in Cursor and Claude Code.');
  // Never "runs on which…": the sentence is left whole for stripProcessDetail.
  assert.equal(broadenWorkflow('Design delivery runs on Git, which keeps engineering in sync.'), 'Design delivery runs on Git, which keeps engineering in sync.');
  // A verb with nothing after it keeps its term ("I hand off." before); with an object the term goes.
  assert.equal(broadenWorkflow('I hand off through GitHub.'), 'I hand off through GitHub.');
  assert.equal(broadenWorkflow('I collaborate with engineering through GitHub.'), 'I collaborate with engineering.');
  // "…, and hand off." with no one to hand off to, as Qwen writes it (S4).
  assert.equal(broadenWorkflow('I design in Cursor and Claude Code, and hand off.'), 'I design in Cursor and Claude Code.');
  assert.equal(broadenWorkflow('I prototype in Cursor and Claude Code, then hand them off to engineering.'), 'I prototype in Cursor and Claude Code, then hand them off to engineering.');
  assert.equal(broadenWorkflow('Je prototype dans Cursor et Claude Code, puis je livre via GitHub.'), 'Je prototype dans Cursor et Claude Code.');
  // The review as the verb after its subject stays whole ("I." before, S1); the tool named from the CV goes (S11).
  assert.equal(broadenWorkflow('I reviewed them in an internal tool I built.'), 'I reviewed them in an internal tool I built.');
  assert.equal(broadenWorkflow('I built prototypes in Cursor and Claude Code, reviewed them in Figmol, my internal Figma-like tool, then handed them off to engineering.'), 'I built prototypes in Cursor and Claude Code, then handed them off to engineering.');
  assert.equal(broadenWorkflow('I worked on internal tooling for brand teams.'), 'I worked on internal tooling for brand teams.');
  // In the email, the sentences left whole go with the process strip, never as "I hand off." or "…runs, I build…".
  const proofOf = p2 => stripProcessDetail(formatApplicationEmail(`Hi Sam,\n\nI'm applying for the Product Designer role at Acme.\n\n${p2}\n\nCould we talk this week?`, { language: 'en', profileData: { candidate: { full_name: 'Hugo Vermot' } }, reader: { firstName: 'Sam' } })).split('\n\n')[2];
  assert.equal(proofOf('I led the investor app. I hand off through GitHub.'), 'I led the investor app.');
  assert.equal(proofOf('I led the investor app. Everything runs on Git, I build interactive prototypes in Cursor and Claude Code.'), 'I led the investor app.');
  assert.equal(proofOf('I led the investor app. Design delivery runs on Git, which keeps engineering in sync with every release.'), 'I led the investor app.');
  // "I ran this, and live reviews." before (wp5 bench, S5).
  assert.equal(proofOf('I led the investor app. I ran this through GitHub PRs, and live reviews.'), 'I led the investor app.');
  assert.equal(proofOf('I built prototypes in Cursor and Claude Code. I reviewed them in my internal Figma-like tool.'), 'I built prototypes in Cursor and Claude Code.');
});

test('WP6: a design-system posting meets the CV\'s design system line, under the strong gate on that concept alone', () => {
  const cv = [
    '### Experience', '',
    '#### Senior Product Designer : Renault Group (2020 – 2021)',
    '- Built a multi-country design system adopted across teams, cutting development time by 20%.',
    '- Designed the used-car listing pages for six markets.',
  ].join('\n');
  const matches = matchPostingToCv('What we are looking for\n- 4+ years of product design experience, with at least 2 years working on a design system.', cv, 3);
  const pair = matches.find(match => /design system/.test(match.proof));
  assert.ok(pair, JSON.stringify(matches));
  assert.ok(pair.score < STRONG_MATCH_SCORE, String(pair.score));
});

// ── WP7: motivation from a sourced company fact ────────────────────────────
// The 2026-10-25 bisect (VARIANT_GUIDE.md, wp7) kept the company fact, the
// founder prompt and the guards; the posting hook of MATCHED_STRUCTURE stays.
const WP7_CV = [
  '# Hugo Vermot', '',
  '### Independent products and ventures', '',
  '#### Creads.io : Founder, AI Product Builder (2024 – Present)',
  '- Launched an AI advertising SaaS that reads a brand\'s website and checks every output against a structured brief.', '',
  '### Professional Experience', '',
  '#### Senior Product Designer / Product Lead : OneAsset (Feb 2026 – Present)',
  '- Shipped the investor app, admin panel and an OTC product in six months with one Product Owner.',
].join('\n');
// Excerpts of the bench postings (scratch/email-bench/scenarios.json, S3 Alan and S2 Perplexity).
const WP7_ALAN = [
  'Product Designer',
  'Alan · Paris',
  '',
  'About Alan',
  'Alan is building the health partner of companies and their employees. We partner with 35K+ companies of all sizes, serving more than 950K+ members, and have reached 680M+ in ARR. Our team of 700+ people (still growing) operates across France, Spain, Belgium, and Canada.',
  '',
  'What you will do',
  '- Design the onboarding of new members on mobile and web.',
  '- Work with product managers and engineers on prevention features.',
].join('\n');
const WP7_PERPLEXITY = [
  'Perplexity is looking for an experienced Lead Product Designer to own design for Growth. You\'ll shape the experiences that bring Perplexity to as many people as possible.',
  '',
  'Growth design has its own craft and nuance. You\'ll own the highest-leverage moments in the user journey: first-run onboarding and activation, consumer acquisition surfaces, conversion and upsell flows.',
  '',
  'WHAT YOU\'LL DO',
  ' - Lead product design for Growth across the full funnel.',
].join('\n');

test('WP7: extractCompanyFacts takes an anchored sentence from the company section, never the team, the role or marketing', async () => {
  const { extractCompanyFacts } = await import('../lib/application-email.mjs');
  const alan = extractCompanyFacts(WP7_ALAN, '', 3, { company: 'Alan', proof: 'onboarding flows for investors' });
  assert.equal(alan[0], 'We partner with 35K+ companies of all sizes, serving more than 950K+ members, and have reached 680M+ in ARR.');
  assert.ok(alan.every(fact => !/Our team of 700/.test(fact)), 'the headcount is not what the company does');
  // Every Perplexity sentence is about the role or written to "you": no fact, so no motivation.
  assert.deepEqual(extractCompanyFacts(WP7_PERPLEXITY, '', 3, { company: 'Perplexity' }), []);
  // A paragraph of marketing words only gives nothing.
  assert.deepEqual(extractCompanyFacts('About Acme\nAcme is the leading innovative platform shaping the future of seamless, world-class collaboration for everyone.\n\nResponsibilities\n- Design flows.', '', 3, { company: 'Acme' }), []);
  // The company page counts, and its menu and cookie lines do not.
  const site = 'Tallyhop | Payroll for small shops\nAccepter les cookies\nVoir plus de cas d’usage Voir plus de cas d’usage\n6,000 small businesses in France and Belgium run their payroll on Tallyhop every month.';
  assert.deepEqual(extractCompanyFacts('', site, 3, { company: 'Tallyhop' }), ['6,000 small businesses in France and Belgium run their payroll on Tallyhop every month.']);
  // A posting title with a gender tag is never a fact.
  assert.deepEqual(extractCompanyFacts('UX Designer – Fokus digitale Gesundheitsprodukte für Praxen und Patienten (m/w/d)', '', 3, { company: 'Kliniqo' }), []);
});

test('WP7: a motivation about the candidate\'s own product, or about nothing the company said, is flagged and stripped', () => {
  const posting = 'Ramp is building the infrastructure for finance teams, embedded in the transaction flow of every dollar a business spends.';
  const body = ['Hi Sarah,', 'I\'m applying for the Product Designer role at Ramp. I prototype product flows in code.',
    'In my current role, I shipped the investor app, admin panel and an OTC product in six months.',
    'Creads.io is the kind of problem I want to work on, because it uses AI to turn brand context into structured briefs. Could we talk this week?', SIGN_EN].join('\n\n');
  const options = { cv: WP7_CV, sourceText: posting };
  assert.deepEqual(genericMotivationSentences(body, options), ['Creads.io is the kind of problem I want to work on, because it uses AI to turn brand context into structured briefs.']);
  const { body: stripped, removed } = stripGenericMotivation(body, options);
  assert.equal(removed.length, 1);
  assert.doesNotMatch(stripped, /Creads\.io is the kind/);
  assert.match(stripped, /Could we talk this week\?/);
  // A reason built on the company's own words stays, and so does one with no source to compare.
  const grounded = body.replace(/Creads\.io is the kind of problem I want to work on, because it uses AI to turn brand context into structured briefs\./, 'Ramp sits in the transaction flow of every dollar a business spends, and I want to design those flows because I shipped regulated payment journeys.');
  assert.deepEqual(genericMotivationSentences(grounded, options), []);
  // Subject words the source never uses ("gardening apps") and no own name: flagged; across languages, never on that ground.
  const unrelated = body.replace(/Creads\.io/, 'Gardening apps');
  assert.equal(genericMotivationSentences(unrelated, options).length, 1);
  assert.equal(genericMotivationSentences(unrelated, { ...options, crossLanguage: true }).length, 0);
  // Without the CV and the source, only the generic phrases count, as before.
  assert.deepEqual(genericMotivationSentences(body), []);
});

test('WP7: "That\'s the kind of…" is a hollow link, the motivation template goes to the repair pass, and so does a pasted fact', () => {
  const audit = text => auditApplicationEmail({ subject: 'Senior Product Designer at Dust - Hugo Vermot', body: ['Hi Gabriel,', text, 'My CV is attached. Would a short call be useful?', SIGN_EN].join('\n\n'), language: 'en' });
  assert.ok(audit('I\'m applying for the Senior Product Designer role at Dust. I built Creads.io, an AI advertising SaaS with 1,200 users. That\'s the kind of AI workflow Dust is shaping.').some(issue => /^Formule creuse : "That's the kind of"/.test(issue)));
  assert.ok(audit('Agentic delivery is the kind of problem I want to work on, because agents now make real decisions in production.').some(issue => /^Formule toute faite/.test(issue)));
  assert.ok(!audit('Agentic delivery runs real decisions in production, and I want to design for it because I built agent checks.').some(issue => /^Formule toute faite/.test(issue)));
  // The company fact pasted as it is into the motivation goes to the repair pass (2026-10-25 bench, S10).
  const fact = 'Chess.com is where people around the world play, learn and watch chess, on the web and in our iOS and Android apps.';
  const pasted = ['Hi Jordan,', 'I\'m applying for the Product Designer role at Chess.com. I built a design system from scratch.', 'Chess.com is where people around the world play, learn and watch chess, because I\'ve built systems across platforms. Could we talk this week?', SIGN_EN].join('\n\n');
  assert.ok(auditApplicationEmail({ subject: 'Product Designer at Chess.com - Hugo Vermot', body: pasted, language: 'en' }, { fact }).some(issue => /^Fait de l'entreprise recopié/.test(issue)));
  const retold = pasted.replace('Chess.com is where people around the world play, learn and watch chess, because I\'ve built systems across platforms.', 'Millions of players learn chess on Chess.com every day, and I want to keep its apps consistent because I built a design system from scratch.');
  assert.ok(!auditApplicationEmail({ subject: 'Product Designer at Chess.com - Hugo Vermot', body: retold, language: 'en' }, { fact }).some(issue => /^Fait de l'entreprise recopié/.test(issue)));
});

test('WP7: offerLinkIssues asks for a motivation only from a hiring manager\'s or unknown reader\'s email, and only with a company fact', () => {
  const posting = 'We are building a compliance dashboard for stablecoin payments and onboarding flows.';
  const email = { body: 'Hi\n\nI built compliance onboarding flows for payments and a dashboard for stablecoin teams.\n\nBye', role: 'Designer' };
  const asks = options => offerLinkIssues(email, { jobText: posting, ...options }).some(issue => /Pas de phrase de motivation/.test(issue));
  for (const persona of ['founder', 'recruiter', 'inbox']) assert.equal(asks({ persona }), false, persona);
  assert.equal(asks({ persona: 'hiring-manager', hasFact: false }), false);
  assert.equal(asks({ persona: 'hiring-manager', hasFact: true }), true);
  assert.equal(asks({ persona: 'unknown' }), true);
  assert.equal(asks({}), true, 'an old caller keeps the old behaviour');
});

test('WP7: the code\'s role opener drops a first sentence that leaned on nothing', () => {
  const body = ['Hi Gabriel,', 'That\'s the kind of AI workflow I build. I built Creads.io, an AI advertising SaaS with 1,200 users.', 'My CV is attached.', SIGN_EN].join('\n\n');
  const out = ensureRoleOpener(body, { role: 'Senior Product Designer', company: 'Dust', language: 'en' });
  assert.equal(out.split('\n\n')[1], 'I\'m applying for the Senior Product Designer role at Dust. I built Creads.io, an AI advertising SaaS with 1,200 users.');
  // Alone in its paragraph, it stays: the opener never empties the paragraph.
  const alone = ensureRoleOpener(['Hi Gabriel,', 'It ships every week to 1,200 users.', 'My CV is attached.', SIGN_EN].join('\n\n'), { role: 'Senior Product Designer', company: 'Dust', language: 'en' });
  assert.equal(alone.split('\n\n')[1], 'I\'m applying for the Senior Product Designer role at Dust. It ships every week to 1,200 users.');
  const fr = ensureRoleOpener(['Bonjour,', 'C’est le type de produit que je conçois. J’ai livré une app d’investissement en six mois.', 'Mon CV est en pièce jointe.', 'Bien à vous,\nHugo Vermot'].join('\n\n'), { role: 'Product Designer', company: 'Alan', language: 'fr' });
  assert.equal(fr.split('\n\n')[1], 'Je postule au poste de Product Designer chez Alan. J’ai livré une app d’investissement en six mois.');
});

const WP7_MATCHES = [
  { need: 'Proven work on regulated flows: KYC/KYB, payments', proof: 'Designed KYB/KYC onboarding and investor flows for a VARA-licensed product.', employer: 'OneAsset', role: 'Senior Product Designer', latest: true, score: 6.9, words: ['kyb'] },
  { need: 'Contribute to our design system', proof: 'Built a multi-country design system adopted across teams, cutting development time by 20%.', employer: 'Renault Group', role: 'Senior Product Designer', dates: '2020 – 2021', score: 4.5, words: ['design'] },
];
const WP7_PROFILE = { ...PROFILE, narrative: { headline: 'Product designer', exit_story: 'Product designer with 12+ years across SaaS and financial services.' } };
const WP7_JOB = 'About Brightwell\nBrightwell gives finance teams corporate cards, invoice payments and approval workflows in one app. Founded in Lyon in 2019, Brightwell is used by 4,000 companies in 9 European countries.\n\nThe role\nYou will own the onboarding journey: sign-up, KYB, card issuing.\n\nWhat we are looking for\n- Proven work on regulated flows: KYC/KYB, payments.\n- Contribute to our design system.';
const wp7Prompt = (persona, extra = {}) => buildApplicationEmailMessages({
  cv: WP7_CV, profileData: WP7_PROFILE, jobText: WP7_JOB, matches: WP7_MATCHES, roleHint: 'Senior Product Designer', companyHint: 'Brightwell',
  recipient: { valid: true, email: 'x@brightwell.eu', firstName: 'Nadia', title: persona === 'hiring-manager' ? 'VP Design' : persona === 'founder' ? 'CEO & Co-founder' : 'Talent Partner', persona }, ...extra,
});

test('WP7: the founder prompt asks for 50 to 80 words, no motivation, and never puts the years and range on the ask', () => {
  const { system, user } = wp7Prompt('founder');
  assert.doesNotMatch(system, /90 to 140/);
  assert.match(system, /LENGTH: 50 to 80 words/);
  assert.doesNotMatch(system, /MOTIVATION/);
  assert.match(system, /^2\. Paragraph 2 \(1 sentence\): CV attached, a call if useful\.$/m);
  assert.doesNotMatch(system, /years and range \(sectors, craft\) taken from the MAIN DESCRIPTION/);
  assert.doesNotMatch(user, /COMPANY FACT/);
});

test('WP7: no persona gets the motivation wording template; the proof paragraph still opens with the years and range', async () => {
  const { EMAIL_VOICE_RULES } = await import('../lib/application-email.mjs');
  for (const persona of ['hiring-manager', 'recruiter', 'inbox', 'founder']) {
    assert.doesNotMatch(wp7Prompt(persona).system, /kind of problem I want to work on|type de sujet sur lequel/, persona);
  }
  const recruiter = wp7Prompt('recruiter').system;
  assert.match(recruiter.split('\n').find(line => /^2\. Paragraph 2 /.test(line)), /Open it with the years and range/);
  assert.equal(EMAIL_VOICE_RULES.includes('kind of problem'), false);
});

test('WP7: the motivation is asked about the company fact, and not at all without one', () => {
  const { system, user } = wp7Prompt('hiring-manager');
  assert.match(user, /## COMPANY FACT[^\n]*\n(?:Founded in Lyon in 2019, Brightwell is used by 4,000 companies in 9 European countries\.|Brightwell gives finance teams corporate cards, invoice payments and approval workflows in one app\.)/);
  assert.match(system, /MOTIVATION: one sentence of the last paragraph is about the COMPANY FACT/);
  assert.match(system, /^3\. Paragraph 3 \(2 sentences, 40 words at most, ask included\): first the motivation sentence, built on the COMPANY FACT/m);
  const none = wp7Prompt('hiring-manager', { companyFact: '' });
  assert.doesNotMatch(none.user, /COMPANY FACT/);
  assert.match(none.system, /no company fact to build on, so write no motivation sentence/);
  assert.match(none.system, /^3\. Paragraph 3 \(1 sentence\): CV attached, and an offer to walk through that work on a call\.$/m);
  // A fact the caller computed is used as given.
  assert.match(wp7Prompt('recruiter', { companyFact: 'Brightwell matches every card payment with its receipt automatically.' }).user, /## COMPANY FACT[^\n]*\nBrightwell matches every card payment/);
});

test('WP7: a motivation may restate a figure of the posting; a past-work sentence with that figure is still flagged', () => {
  const source = 'Tallyhop builds payroll software for small shops. 6,000 small businesses in France and Belgium run their payroll on Tallyhop every month.';
  const body = ['Hello,', 'I\'m applying for the Product Designer role at Tallyhop. I shipped the investor app, admin panel and an OTC product in six months.',
    'In my current role, I designed onboarding for investors with one Product Owner.',
    '6,000 small businesses run their payroll on Tallyhop every month, and I want to make that run simpler because I designed regulated flows for non-experts. Could we talk this week?', SIGN_EN].join('\n\n');
  const claims = findUngroundedClaims(body, { cv: WP7_CV, sourceText: source, company: 'Tallyhop', role: 'Product Designer' });
  assert.ok(!claims.some(claim => claim.figures.some(figure => /6000|6,000/.test(figure))), JSON.stringify(claims));
  const claimed = body.replace('6,000 small businesses run their payroll on Tallyhop every month, and I want to make that run simpler because I designed regulated flows for non-experts.', 'Because I shipped payroll for 6,000 small businesses, I want to work on this.');
  assert.ok(findUngroundedClaims(claimed, { cv: WP7_CV, sourceText: source, company: 'Tallyhop', role: 'Product Designer' }).some(claim => claim.figures.length), 'past work keeps its CV check');
  // The figure in the wish, the past work after "because" (2026-10-25 bench, S13).
  const wish = body.replace('6,000 small businesses run their payroll on Tallyhop every month, and I want to make that run simpler because I designed regulated flows for non-experts.', 'I want to help Tallyhop’s 6,000 small businesses close payroll faster because I’ve already built regulated flows for non-experts.');
  assert.ok(!findUngroundedClaims(wish, { cv: WP7_CV, sourceText: source, company: 'Tallyhop', role: 'Product Designer' }).some(claim => claim.figures.length));
  // A figure the source does not hold is still flagged in a motivation.
  const invented = body.replace('6,000 small businesses', '9,000 small businesses');
  assert.ok(findUngroundedClaims(invented, { cv: WP7_CV, sourceText: source, company: 'Tallyhop', role: 'Product Designer' }).some(claim => claim.figures.some(figure => /9000/.test(figure))));
});
