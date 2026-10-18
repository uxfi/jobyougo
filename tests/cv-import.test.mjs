import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CV_MAX_CHARS,
  CV_OCR_PROMPT,
  CV_PROFILE_PROMPT,
  CV_STRUCTURE_PROMPT,
  CV_TEXT_BUDGET,
  authorizedRegionsForNationality,
  clipCvText,
  coerceStructuredCv,
  currencyForCountry,
  currentRoleFromExperience,
  detectCvDialect,
  detectCvLanguage,
  explicitYearsFromText,
  extractContactFacts,
  groundProfile,
  normalizeSourceForMatch,
  occursInSource,
  parseCvWithLlm,
  renderCvMarkdown,
  validateCvParseRequest,
  yearsFromExperience,
} from '../lib/cv-import.mjs';

const NOW = new Date('2026-10-09T12:00:00Z');
const MODELS = { QWEN: 'test/text-model', QWEN_VL: 'test/vision-model' };

// What pdf.js gives for a typical one-page CV: no Markdown at all.
const RAW_CV = `Jane Doe
Staff Backend Engineer
Lyon, France · +33 6 12 34 56 78 · jane.doe@example.com
LinkedIn

PROFILE
Backend engineer with 9 years on payment platforms. I like boring, reliable systems.

EXPERIENCE
Acme Payments — Staff Engineer
Mar 2021 – Present, Lyon
• Led the migration of the ledger to event sourcing, cutting incidents by 40%
• Mentored 6 engineers

Globex — Senior Engineer
Jan 2017 – Jun 2021
• Built the fraud scoring service used by 2 million customers

EDUCATION
MSc Computer Science, INSA Lyon, 2014 – 2016

SKILLS
Go, Python, SQL, Kubernetes, Postgres, Kafka

LANGUAGES
French (native), English (C1)

Nationality: French
`;
const LINKS = ['https://www.linkedin.com/in/jane-doe/?originalSubdomain=fr', 'mailto:jane.doe@example.com'];

const PROFILE_JSON = {
  candidate: {
    full_name: 'Jane Doe', email: 'jane.doe@example.com', phone: '+33 6 12 34 56 78', location: 'Lyon, France',
    linkedin: '', github: '', portfolio_url: '', twitter: '', years_experience: '15',
    languages: [{ name: 'French', level: 'native' }, { name: 'English', level: 'C1' }, { name: 'German', level: 'B1' }],
  },
  target_roles: {
    primary: ['Staff Backend Engineer', 'Senior Backend Engineer', 'Platform Engineer', 'Payments Engineer'],
    archetypes: [{ name: 'Backend', level: 'staff', fit: 'primary' }, { name: 'Platform', level: 'Rockstar', fit: 'adjacent' }],
  },
  narrative: {
    headline: 'Staff Backend Engineer',
    exit_story: 'Backend engineer with 9 years on payment platforms.',
    superpowers: ['Event sourcing', 'Mentoring', 'Blockchain wizardry'],
    proof_points: [
      { name: 'Fraud scoring service', url: '', hero_metric: 'used by 5 million customers' },
      { name: 'Migration of the ledger to event sourcing', url: '', hero_metric: 'cutting incidents by 40%' },
      { name: 'Quantum payments engine', url: '', hero_metric: '' },
    ],
  },
  location: {
    city: 'Lyon', country: 'France', timezone: 'CET', postal_code: '69001', visa_status: 'EU citizen',
    authorized_in: ['France', 'EU'], nationality: 'French',
  },
  compensation: { employment_type: 'Full-time', target_range: '90K', currency: 'USD' },
  availability: { notice_period: '3 months', start_date: '' },
  search: { must_haves: ['remote'] },
  evidence: { authorized_in: 'Nationality: French', nationality: 'Nationality: French', visa_status: 'EU citizen', notice_period: 'three months notice', postal_code: '69001' },
  suggestions: {
    roles: ['Payments Architect', 'Staff Backend Engineer'],
    superpowers: ['Calm under pressure', 'Scaled 12 teams'],
    headline: 'Payments backend lead with 9 years',
    exit_story: 'I make payment systems boring. I led a ledger migration that cut incidents by 40%.',
  },
};

const STRUCTURE_JSON = {
  header: { name: 'Jane Doe', headline: 'Staff Backend Engineer', email: 'jane.doe@example.com', phone: '+33 6 12 34 56 78', location: 'Lyon, France', links: [] },
  summary: ['Backend engineer with 9 years on payment platforms. I like boring, reliable systems.'],
  experience: [
    {
      company: 'Acme Payments', title: 'Staff Engineer', start: 'Mar 2021', end: 'Present', location: 'Lyon',
      bullets: ['Led the migration of the ledger to event sourcing, cutting incidents by 40%', 'Mentored 6 engineers', 'Grew revenue by 300% in one quarter'],
    },
    { company: 'Globex', title: 'Senior Engineer', start: 'Jan 2017', end: 'Jun 2021', location: '', bullets: ['Built the fraud scoring service used by 2 million customers'] },
    { company: 'Initech', title: 'CTO', start: '2010', end: '2016', location: '', bullets: ['Invented everything'] },
  ],
  projects: [],
  education: [{ degree: 'MSc Computer Science', school: 'INSA Lyon', start: '2014', end: '2016', details: [] }],
  skills: [{ category: '', items: ['Go', 'Python', 'SQL', 'Kubernetes', 'Postgres', 'Kafka', 'Haskell'] }],
  languages: [{ name: 'French', level: 'native' }, { name: 'English', level: 'C1' }],
  certifications: [],
  other_sections: [{ title: 'Nationality', lines: ['Nationality: French'] }],
};

function kindOf(opts) {
  if (opts.systemPrompt.startsWith(CV_PROFILE_PROMPT)) return 'profile';
  if (opts.systemPrompt.startsWith(CV_STRUCTURE_PROMPT)) return 'structure';
  if (opts.systemPrompt.startsWith(CV_OCR_PROMPT)) return 'ocr';
  return 'unknown';
}

/**
 * A stand-in for lib/openrouter.mjs chat(). Each handler is a value, an
 * Error, { content, finish_reason }, or a function (opts, attempt) → one of those.
 */
function fakeChat(handlers) {
  const calls = [];
  const chat = async (opts) => {
    const kind = kindOf(opts);
    calls.push({ kind, ...opts });
    const attempt = calls.filter(c => c.kind === kind).length;
    let result = handlers[kind];
    if (typeof result === 'function') result = result(opts, attempt);
    if (result instanceof Error) throw result;
    let content = result;
    let finish = 'stop';
    if (result && typeof result === 'object' && 'content' in result) {
      content = result.content;
      finish = result.finish_reason || 'stop';
    }
    if (opts.meta) Object.assign(opts.meta, { finish_reason: finish, model: opts.model });
    return typeof content === 'string' ? content : JSON.stringify(content);
  };
  chat.calls = calls;
  return chat;
}

const src = normalizeSourceForMatch(RAW_CV);

test('contact facts: link annotations, bare handles, phones and portfolio', () => {
  const fromLinks = extractContactFacts(RAW_CV, LINKS);
  assert.equal(fromLinks.linkedin, 'linkedin.com/in/jane-doe', 'the visible text says only "LinkedIn": the URL is in the annotation');
  assert.deepEqual(fromLinks.emails, ['jane.doe@example.com']);
  assert.deepEqual(fromLinks.phones, ['+33 6 12 34 56 78']);
  assert.equal(fromLinks.github, '');

  const bare = extractContactFacts('Sam Roe\nLinkedIn: sam-roe-42 | GitHub: @samroe\nTwitter/X: @sam_roe\nPortfolio: samroe.dev\n06 12 34 56 78\nWorked 2016 - 2020 2021\n', []);
  assert.equal(bare.linkedin, 'linkedin.com/in/sam-roe-42');
  assert.equal(bare.github, 'github.com/samroe');
  assert.equal(bare.twitter, 'https://x.com/sam_roe');
  assert.equal(bare.portfolio, 'https://samroe.dev');
  assert.deepEqual(bare.phones, ['06 12 34 56 78'], 'a run of years is not a phone number');

  const repoOnly = extractContactFacts('Projects: https://github.com/kim/ledger and github.com/kim', []);
  assert.equal(repoOnly.github, 'github.com/kim', 'a profile, not a repository');
  const noPortfolio = extractContactFacts('Kim Lee\nkim.lee@me.com · Node.js · https://linkedin.com/in/kimlee', []);
  assert.equal(noPortfolio.portfolio, '', 'an e-mail domain, Node.js or a social profile is not a portfolio');
});

test('the source check drops an invented bullet and an invented metric', () => {
  assert.equal(occursInSource('Led the migration of the ledger to event-sourcing, cutting incidents by 40%', src), true);
  assert.equal(occursInSource('Led the migration of the ledger to event sourcing cutting incidents by 40 %', src), true, 'punctuation and spacing do not matter');
  assert.equal(occursInSource('Led the migration of the ledger to event sourcing, cutting incidents by 60%', src), false, 'a changed number is not the same fact');
  assert.equal(occursInSource('Grew revenue by 300% in one quarter', src), false);

  const { cv, dropped } = coerceStructuredCv(STRUCTURE_JSON, src);
  assert.deepEqual(cv.experience.map(e => e.company), ['Acme Payments', 'Globex'], 'an employer the CV does not name is dropped');
  assert.deepEqual(cv.experience[0].bullets, ['Led the migration of the ledger to event sourcing, cutting incidents by 40%', 'Mentored 6 engineers']);
  assert.ok(!cv.skills[0].items.includes('Haskell'));
  assert.ok(dropped >= 3, `dropped ${dropped}`);
  assert.equal(cv.experience[0].end, 'Present');
});

test('exit_story: verbatim summary kept, invented prose moved to suggestions', () => {
  const { cv } = coerceStructuredCv(STRUCTURE_JSON, src);
  const kept = groundProfile(PROFILE_JSON, { normalizedSource: src, contacts: {}, structuredCv: cv, sourceText: RAW_CV, now: NOW });
  assert.equal(kept.profile.narrative.exit_story, 'Backend engineer with 9 years on payment platforms.');

  const invented = { ...PROFILE_JSON, narrative: { ...PROFILE_JSON.narrative, exit_story: 'A world-class engineer who single-handedly reinvented online payments.' }, suggestions: {} };
  const out = groundProfile(invented, { normalizedSource: src, contacts: {}, structuredCv: cv, sourceText: RAW_CV, now: NOW });
  assert.equal(out.profile.narrative.exit_story, 'Backend engineer with 9 years on payment platforms. I like boring, reliable systems.', 'falls back to the CV summary, verbatim');
  assert.equal(out.suggestions.exit_story, 'A world-class engineer who single-handedly reinvented online payments.');
  assert.ok(!out.droppedFields.includes('narrative.exit_story'), 'the field is filled from the CV summary, so it is not reported as left out');
});

test('years: overlapping ranges merge, an explicit statement wins', () => {
  const ranges = [{ start: 'Mar 2021', end: 'Present' }, { start: 'Jan 2017', end: 'Jun 2021' }, { start: '2014', end: '2016' }];
  assert.equal(yearsFromExperience(ranges.slice(0, 2), NOW), 10, 'Jan 2017 → Oct 2026, the 2021 overlap counted once');
  assert.equal(yearsFromExperience([{ start: '03/2019', end: '02/2021' }], NOW), 2);
  assert.equal(yearsFromExperience([{ start: 'Feb', end: 'Jun 2024' }], NOW), '', 'five months round to no whole year');
  assert.equal(yearsFromExperience([{ start: 'janvier 2015', end: "Aujourd'hui" }], NOW), 12);
  assert.equal(yearsFromExperience([], NOW), '');
  assert.equal(explicitYearsFromText('Designer with 12+ years of experience in fintech'), 12);
  assert.equal(explicitYearsFromText("Plus de 10 ans d'expérience en design produit"), 10);
  assert.equal(explicitYearsFromText('Shipped 2015 – 2020 at Acme'), '', 'dates are not a statement');

  const { cv } = coerceStructuredCv(STRUCTURE_JSON, src);
  const out = groundProfile(PROFILE_JSON, { normalizedSource: src, contacts: {}, structuredCv: cv, sourceText: RAW_CV, now: NOW });
  assert.equal(out.profile.candidate.years_experience, 9, '"with 9 years" beats the 10 computed from dates and the model\'s 15');
  const noStatement = normalizeSourceForMatch(RAW_CV.replace('with 9 years on', 'on'));
  const computed = groundProfile(PROFILE_JSON, { normalizedSource: noStatement, contacts: {}, structuredCv: cv, sourceText: RAW_CV, now: NOW });
  assert.equal(computed.profile.candidate.years_experience, 10);
});

test('current role and current employment follow the CV', () => {
  const role = currentRoleFromExperience([
    { company: 'Old Co', title: 'Engineer', start: '2016', end: 'Present' },
    { company: 'Acme', title: 'Lead', start: '03/2021', end: "Aujourd'hui" },
    { company: 'Past', title: 'Dev', start: '2010', end: '2015' },
  ], NOW);
  assert.deepEqual(role, { title: 'Lead', company: 'Acme', start_month: '03', start_year: '2021', current: true });
  assert.deepEqual(currentRoleFromExperience([{ company: 'Past', title: 'Dev', start: '2010', end: '2015' }], NOW),
    { title: '', company: '', start_month: '', start_year: '', current: false });

  const base = { normalizedSource: src, contacts: {}, sourceText: RAW_CV, now: NOW };
  const freelance = groundProfile({}, { ...base, structuredCv: { ...coerceStructuredCv({}, src).cv, experience: [{ company: '', title: 'Freelance Product Designer', start: '2019', end: 'Present', location: '', bullets: [] }] } });
  assert.equal(freelance.profile.availability.current_employment, 'Freelancing');
  assert.equal(freelance.profile.search.current_role.current, true);
  const student = groundProfile({}, { ...base, structuredCv: { ...coerceStructuredCv({}, src).cv, experience: [{ company: 'Shop', title: 'Intern', start: '2023', end: '2024', location: '', bullets: [] }], education: [{ degree: 'MSc', school: 'INSA', start: '2025', end: '2027', details: [] }] } });
  assert.equal(student.profile.availability.current_employment, 'Student / graduating');
  const employed = groundProfile({}, { ...base, structuredCv: coerceStructuredCv(STRUCTURE_JSON, src).cv });
  assert.equal(employed.profile.availability.current_employment, '', 'never guesses discreet vs active');
});

test('education rows for the application forms come from the CV education section', () => {
  const base = { normalizedSource: src, contacts: {}, sourceText: RAW_CV, now: NOW };
  const cv = {
    ...coerceStructuredCv({}, src).cv,
    education: [
      { degree: 'MSc in Computer Science', school: 'INSA Lyon', start: '2012', end: '2017', details: [] },
      { degree: 'PhD', school: 'Université Lyon 1', start: '2025', end: 'Present', details: [] },
      { degree: 'Baccalauréat S', school: '', start: '2012', end: '', details: [] },
      { degree: '', school: '', start: '2010', end: '2011', details: [] },
    ],
  };
  const out = groundProfile({}, { ...base, structuredCv: cv });
  assert.deepEqual(out.profile.candidate.education, [
    { degree: 'MSc in Computer Science', field: '', school: 'INSA Lyon', end_year: '2017' },
    { degree: 'PhD', field: '', school: 'Université Lyon 1', end_year: '' },
    { degree: 'Baccalauréat S', field: '', school: '', end_year: '2012' },
  ], 'the year it ended; an ongoing degree has none; a row without degree or school is not one');
  assert.deepEqual(groundProfile({}, { ...base, structuredCv: coerceStructuredCv({}, src).cv }).profile.candidate.education, []);
});

test('currency, nationality and language helpers', () => {
  assert.equal(currencyForCountry('France'), 'EUR');
  assert.equal(currencyForCountry('Allemagne'), 'EUR');
  assert.equal(currencyForCountry('Royaume-Uni'), 'GBP');
  assert.equal(currencyForCountry('United States'), 'USD');
  assert.equal(currencyForCountry('Schweiz'), 'CHF');
  assert.equal(currencyForCountry('Thaïlande'), 'THB');
  assert.equal(currencyForCountry('Narnia'), '');
  assert.deepEqual(authorizedRegionsForNationality('Française'), ['France', 'European Union']);
  assert.deepEqual(authorizedRegionsForNationality('Swiss'), ['Switzerland']);
  assert.deepEqual(authorizedRegionsForNationality('Martian'), []);
  assert.equal(detectCvLanguage(RAW_CV), 'en');
  assert.equal(detectCvLanguage("Expérience professionnelle\nChef de projet chez Acme depuis 2019, pour les équipes produit et les clients. Gestion des priorités avec une équipe de 6 développeurs.\nFormation\nCompétences"), 'fr');
  assert.equal(detectCvLanguage('Go Python SQL'), '');
});

test('dialect detection', () => {
  assert.equal(detectCvDialect('# Jane\n\n## Summary\nx\n\n## Experience\n### Acme\n**Lead**\n2021 – Present\n- y'), 'h2');
  assert.equal(detectCvDialect('# Hugo\n## Product Leader\n\n### Summary\nx\n\n### Professional Experience\n#### Lead : Acme (2021 – Present)'), 'h3');
  assert.equal(detectCvDialect(RAW_CV), 'none');
  assert.equal(detectCvDialect('# Jean\n\n## Expérience professionnelle\n### Acme\n\n## Compétences\n- Go'), 'h2');
});

test('parseCvWithLlm: normal path grounds the profile and structures the CV', async () => {
  const chat = fakeChat({ profile: PROFILE_JSON, structure: STRUCTURE_JSON });
  const out = await parseCvWithLlm({ text: RAW_CV, links: LINKS, chat, models: MODELS, now: NOW });
  assert.equal(out.ok, true);
  assert.equal(chat.calls.length, 2);
  assert.ok(chat.calls.every(c => c.model === MODELS.QWEN && c.temperature === 0 && c.response_format?.type === 'json_object'));
  assert.match(chat.calls[0].messages[0].content, /<<<CV\n[\s\S]*\nCV>>>$/);
  assert.match(chat.calls[0].messages[0].content, /linkedin\.com\/in\/jane-doe/, 'link annotations reach the model');

  const p = out.profile;
  assert.equal(p.candidate.full_name, 'Jane Doe');
  assert.equal(p.candidate.email, 'jane.doe@example.com');
  assert.equal(p.candidate.phone, '+33 6 12 34 56 78');
  assert.equal(p.candidate.linkedin, 'linkedin.com/in/jane-doe');
  assert.deepEqual(p.candidate.languages, ['French (native)', 'English (C1)'], 'German is not in the CV');
  assert.equal(p.candidate.years_experience, 9);
  assert.deepEqual(p.target_roles.primary, ['Staff Backend Engineer', 'Senior Backend Engineer', 'Platform Engineer']);
  assert.deepEqual(p.target_roles.archetypes, [{ name: 'Backend', level: 'Staff', fit: 'primary' }, { name: 'Platform', level: '', fit: 'adjacent' }]);
  assert.equal(p.narrative.headline, 'Staff Backend Engineer');
  assert.deepEqual(p.narrative.superpowers, ['Event sourcing', 'Mentoring']);
  assert.deepEqual(p.narrative.proof_points, [
    { name: 'Fraud scoring service', url: '', hero_metric: '' },
    { name: 'Migration of the ledger to event sourcing', url: '', hero_metric: 'cutting incidents by 40%' },
  ], 'an invented metric is emptied, an invented project dropped');
  assert.deepEqual(p.compensation, { currency: 'EUR', employment_type: '', target_range: '', minimum: '', location_flexibility: '' });
  assert.equal(p.location.city, 'Lyon');
  assert.equal(p.location.country, 'France');
  assert.equal(p.location.postal_code, '', 'a postal code the CV does not write');
  assert.equal(p.location.visa_status, '', 'evidence not in the CV');
  assert.deepEqual(p.location.authorized_in, ['France', 'European Union']);
  assert.equal(p.location.remote_policy, '');
  assert.equal(p.location.needs_sponsorship, undefined, 'never inferred');
  assert.deepEqual(p.search.current_role, { title: 'Staff Engineer', company: 'Acme Payments', start_month: '03', start_year: '2021', current: true });
  assert.deepEqual(p.search.must_haves, [], 'preferences are not in a CV');
  assert.equal(p.availability.notice_period, '');
  assert.equal(p.availability.current_employment, '');
  assert.equal(p.language.output, 'en');

  assert.deepEqual(out.suggestions.roles, ['Payments Architect']);
  assert.deepEqual(out.suggestions.superpowers, ['Calm under pressure', 'Blockchain wizardry'],
    'a suggestion with an invented number is dropped; a strength the CV does not state is offered, not saved');
  assert.equal(out.suggestions.headline, 'Payments backend lead with 9 years');

  assert.equal(out.structured, true);
  assert.equal(out.ocr, false);
  assert.equal(out.truncated, false);
  assert.ok(out.dropped.lines >= 3);
  assert.ok(out.dropped.fields.includes('candidate.languages'));
  assert.equal(out.source_text, RAW_CV.trim());
  const md = out.cv_markdown;
  assert.match(md, /^# Jane Doe\nStaff Backend Engineer\n\n\*\*Email:\*\* jane\.doe@example\.com {2}\n\*\*Phone:\*\* \+33 6 12 34 56 78/);
  assert.match(md, /\*\*LinkedIn:\*\* linkedin\.com\/in\/jane-doe/);
  assert.match(md, /## Experience\n\n### Acme Payments\n\*\*Staff Engineer\*\*\nMar 2021 – Present · Lyon\n- Led the migration/);
  assert.match(md, /## Education\n\n### MSc Computer Science\nINSA Lyon, 2014 – 2016/);
  assert.match(md, /## Languages\n\n- French \(native\)\n- English \(C1\)/);
  assert.ok(!/300%|Initech|Haskell/.test(md), 'nothing invented reaches the CV');
  assert.ok(out.warnings.some(w => /could not be found in your CV/.test(w)));
});

const MARKDOWN_CV = `# Jane Doe
Staff Backend Engineer

**Email:** jane.doe@example.com

## Summary

Backend engineer with nine years on payment platforms and a taste for reliable systems.

## Experience

### Acme Payments
**Staff Engineer**
Mar 2021 – Present
- Led the migration of the ledger to event sourcing

### Globex
**Senior Engineer**
2017 – 2021
- Built the fraud scoring service

## Education

### MSc Computer Science
INSA Lyon, 2014 – 2016
`;

test('parseCvWithLlm: a CV already in Markdown skips the structuring call', async () => {
  const chat = fakeChat({ profile: { candidate: { full_name: 'Jane Doe' } }, structure: new Error('must not be called') });
  const out = await parseCvWithLlm({ text: MARKDOWN_CV, chat, models: MODELS, now: NOW });
  assert.deepEqual(chat.calls.map(c => c.kind), ['profile']);
  assert.equal(out.structured, false);
  assert.equal(out.cv_markdown, MARKDOWN_CV.trim());
  assert.deepEqual(out.profile.search.current_role, { title: 'Staff Engineer', company: 'Acme Payments', start_month: '03', start_year: '2021', current: true });
  assert.equal(out.profile.candidate.years_experience, 10);
  assert.equal(out.profile.narrative.headline, 'Staff Backend Engineer');
  assert.equal(out.profile.narrative.exit_story, 'Backend engineer with nine years on payment platforms and a taste for reliable systems.');
  assert.deepEqual(out.warnings, []);
});

test('parseCvWithLlm: a structuring failure falls back to the source text', async () => {
  const chat = fakeChat({ profile: PROFILE_JSON, structure: new Error('upstream 500') });
  const out = await parseCvWithLlm({ text: RAW_CV, chat, models: MODELS, now: NOW });
  assert.equal(out.ok, true);
  assert.equal(out.structured, false);
  assert.equal(out.cv_markdown, RAW_CV.trim());
  assert.equal(chat.calls.filter(c => c.kind === 'structure').length, 2, 'one retry');
  assert.ok(out.warnings.some(w => /could not restructure/.test(w)));
  assert.equal(out.profile.candidate.full_name, 'Jane Doe');
});

test('parseCvWithLlm: invalid JSON is retried once with a sharper instruction', async () => {
  const chat = fakeChat({
    profile: (opts, attempt) => (attempt === 1 ? 'Sure! Here is the profile: {"candidate": {"full_name": "Jane' : PROFILE_JSON),
    structure: STRUCTURE_JSON,
  });
  const out = await parseCvWithLlm({ text: RAW_CV, chat, models: MODELS, now: NOW });
  const profileCalls = chat.calls.filter(c => c.kind === 'profile');
  assert.equal(profileCalls.length, 2);
  assert.match(profileCalls[1].systemPrompt, /valid, complete JSON only/);
  assert.ok(profileCalls[1].max_tokens > profileCalls[0].max_tokens);
  assert.equal(out.profile.candidate.full_name, 'Jane Doe');

  const broken = fakeChat({ profile: 'not json at all', structure: STRUCTURE_JSON });
  await assert.rejects(parseCvWithLlm({ text: RAW_CV, chat: broken, models: MODELS, now: NOW }), (err) => {
    assert.equal(err.statusCode, 502);
    assert.match(err.message, /fill the steps by hand/);
    return true;
  });
});

test('parseCvWithLlm: a cut-off answer (finish_reason length) is retried', async () => {
  const chat = fakeChat({
    profile: (opts, attempt) => (attempt === 1 ? { content: JSON.stringify(PROFILE_JSON), finish_reason: 'length' } : PROFILE_JSON),
    structure: (opts, attempt) => (attempt === 1 ? { content: '{"header": {"name": "Jane Doe"', finish_reason: 'length' } : STRUCTURE_JSON),
  });
  const out = await parseCvWithLlm({ text: RAW_CV, chat, models: MODELS, now: NOW });
  assert.equal(chat.calls.filter(c => c.kind === 'profile').length, 2);
  assert.equal(chat.calls.filter(c => c.kind === 'structure').length, 2);
  assert.equal(out.structured, true);
});

test('parseCvWithLlm: a scanned CV is transcribed with the vision model first', async () => {
  const image = 'data:image/png;base64,iVBORw0KGgo=';
  const chat = fakeChat({ ocr: RAW_CV, profile: PROFILE_JSON, structure: STRUCTURE_JSON });
  const out = await parseCvWithLlm({ text: '  ', images: [image, 'https://evil.example/x.png'], chat, models: MODELS, now: NOW });
  const ocrCall = chat.calls.find(c => c.kind === 'ocr');
  assert.ok(ocrCall, 'the vision model was called');
  assert.equal(ocrCall.model, MODELS.QWEN_VL);
  assert.equal(ocrCall.temperature, 0);
  assert.equal(ocrCall.max_tokens, 6000);
  const parts = ocrCall.messages[0].content;
  assert.equal(parts[0].type, 'text');
  assert.deepEqual(parts.slice(1), [{ type: 'image_url', image_url: { url: image } }], 'only data: image URLs are sent');
  assert.equal(out.ocr, true);
  assert.equal(out.source_text, RAW_CV.trim());
  assert.equal(out.profile.candidate.full_name, 'Jane Doe');
  assert.ok(out.warnings.some(w => /read from images/.test(w)));

  const textWins = fakeChat({ ocr: new Error('must not be called'), profile: PROFILE_JSON, structure: STRUCTURE_JSON });
  const withText = await parseCvWithLlm({ text: RAW_CV, images: [image], chat: textWins, models: MODELS, now: NOW });
  assert.equal(withText.ocr, false, 'images are ignored when the text layer is enough');

  const blank = fakeChat({ ocr: 'Page 1', profile: PROFILE_JSON });
  await assert.rejects(parseCvWithLlm({ text: '', images: [image], chat: blank, models: MODELS, now: NOW }), err => err.statusCode === 400);
  await assert.rejects(parseCvWithLlm({ text: 'Jane Doe, engineer', chat: blank, models: MODELS, now: NOW }), err => err.statusCode === 400 && /too short/.test(err.message));
});

test('parseCvWithLlm: a long CV is cut by sections and says so', async () => {
  const publications = Array.from({ length: 700 }, (_, i) => `Paper ${i + 1}: a study of distributed ledgers and payment rails, volume ${i}.`).join('\n');
  const long = `${RAW_CV}\nPUBLICATIONS\n${publications}\n`;
  assert.ok(long.length > CV_TEXT_BUDGET);
  const chat = fakeChat({ profile: PROFILE_JSON, structure: STRUCTURE_JSON });
  const out = await parseCvWithLlm({ text: long, chat, models: MODELS, now: NOW });
  assert.equal(out.truncated, true);
  assert.ok(out.warnings.some(w => /Your CV is long/.test(w)));
  const sent = chat.calls[0].messages[0].content;
  assert.ok(sent.length < CV_TEXT_BUDGET + 500, `sent ${sent.length}`);
  assert.match(sent, /EXPERIENCE\nAcme Payments/, 'the career is kept');
  assert.match(sent, /LANGUAGES\nFrench/, 'later main sections are kept too');
  assert.ok(!sent.includes('Paper 700:'), 'the tail of the long section is cut');
  assert.equal(out.source_text.length, long.trim().length, 'the stored text is complete');

  // A name in capitals above the first section is the header, kept first.
  const capsHeader = `JANE DOE\njane.doe@example.com\n\nREFERENCES\n${'Available on request. '.repeat(400)}\n\nEXPERIENCE\nAcme — Lead\n2020 – Present\n`;
  const clipped = clipCvText(capsHeader, 2000);
  assert.equal(clipped.truncated, true);
  assert.ok(clipped.text.startsWith('JANE DOE\njane.doe@example.com'));
  assert.match(clipped.text, /EXPERIENCE\nAcme — Lead/, 'experience outranks references');
  assert.ok(clipped.text.length <= 2000);
});

test('renderCvMarkdown omits empty sections and keeps the contract layout', () => {
  const md = renderCvMarkdown({
    header: { name: 'Kim Lee', headline: '', email: '', phone: '', location: '', links: [] },
    summary: [], experience: [{ company: '', title: 'Freelance Designer', start: '2019', end: 'Present', location: '', bullets: ['Shipped apps'] }],
    projects: [{ name: 'Tiny', url: 'https://tiny.dev', description: 'A tiny app', bullets: [] }],
    education: [], skills: [{ category: 'Design', items: ['Figma', 'Research'] }], languages: [], certifications: ['AWS SA'], other_sections: [],
  }, { email: 'kim@x.io' });
  assert.equal(md, '# Kim Lee\n\n**Email:** kim@x.io\n\n## Experience\n\n### Freelance Designer\n2019 – Present\n- Shipped apps\n\n## Projects\n\n### [Tiny](https://tiny.dev)\nA tiny app\n\n## Skills\n\n- **Design:** Figma, Research\n\n## Certifications\n\n- AWS SA\n');
});

// Live run on a two-column PDF (2026-10-09): the side column was interleaved
// with the main one, so "design systems" and "user interviews" were split by a
// line of the other column and the source check dropped them.
test('occursInSource: a short phrase split by another column still matches, an invented one does not', () => {
  const interleaved = normalizeSourceForMatch('Design: Figma, prototyping, design | Product designer with 9 years of experience building\nsystems, interaction design | consumer health products.');
  assert.equal(occursInSource('design systems', interleaved, 'item'), true, 'a skill cut by one line of the other column');
  assert.equal(occursInSource('design systems', interleaved, 'exact'), false, 'a title or a name is never pieced together');
  assert.equal(occursInSource('design systems', interleaved), false, 'nor a short line');
  assert.equal(occursInSource('interaction prototyping', interleaved, 'item'), false, 'word order matters');
  assert.equal(occursInSource('design leadership', interleaved, 'item'), false);
  const far = normalizeSourceForMatch(`design ${'filler '.repeat(40)} systems`);
  assert.equal(occursInSource('design systems', far, 'item'), false, 'words far apart are not a phrase');
  const twoJumps = normalizeSourceForMatch('user research lead | north star metrics | interviews');
  assert.equal(occursInSource('user research interviews', twoJumps, 'item'), true, 'one jump');
  assert.equal(occursInSource('user lead interviews', twoJumps, 'item'), false, 'two jumps are two places of the CV');
});

test('languages with a parenthesised level, duplicated side sections, address and project links', async () => {
  const text = `CONTACT
camille@example.com
12 rue Merciere, 69002 Lyon, France
LANGUAGES
French — native
English — C1 (professional)
Camille Laurent
Senior Product Designer
PROFILE
Product designer with 9 years of experience building consumer health and mobility products.
EXPERIENCE
Doctolib — Senior Product Designer
Mar 2022 – Present · Paris
Redesigned the appointment booking flow used by 80 million patients.
PROJECTS
Open Health Icons
An open-source icon set for medical interfaces.
Details
Available with 2 months' notice`;
  const links = ['https://github.com/claurent-dev'];
  const chat = fakeChat({
    profile: {
      candidate: { full_name: 'Camille Laurent', location: '12 rue Merciere, 69002 Lyon, France', languages: [{ name: 'English', level: 'C1 (professional)' }] },
      narrative: { proof_points: [{ name: 'Open Health Icons', url: 'https://github.com/claurent-dev', hero_metric: '' }] },
      location: { city: 'Lyon', country: 'France' },
      availability: { notice_period: "2 months' notice" },
      evidence: { notice_period: "Available with 2 months' notice" },
    },
    structure: {
      header: { name: 'Camille Laurent', headline: 'Senior Product Designer', email: 'camille@example.com', phone: '', location: '12 rue Merciere, 69002 Lyon, France', links },
      summary: ['Product designer with 9 years of experience building consumer health and mobility products.'],
      experience: [{ company: 'Doctolib', title: 'Senior Product Designer', start: 'Mar 2022', end: 'Present', location: 'Paris', bullets: ['Redesigned the appointment booking flow used by 80 million patients.'] }],
      projects: [{ name: 'Open Health Icons', url: '', description: 'An open-source icon set for medical interfaces.', bullets: [] }],
      education: [], skills: [],
      languages: [{ name: 'French', level: 'native' }, { name: 'English', level: 'C1 (professional)' }],
      certifications: [],
      other_sections: [
        { title: 'LANGUAGES', lines: ['French — native', 'English — C1 (professional)'] },
        { title: 'Details', lines: ["Available with 2 months' notice"] },
      ],
    },
  });
  const out = await parseCvWithLlm({ text, links, fileName: 'camille.pdf', chat, models: MODELS, now: NOW });
  assert.deepEqual(out.profile.candidate.languages, ['English (C1, professional)']);
  assert.equal(out.profile.candidate.location, 'Lyon, France');
  assert.equal(out.profile.narrative.proof_points[0].url, '', "the candidate's own GitHub is not the project's link");
  assert.equal(out.profile.availability.notice_period, '2 months');
  assert.match(out.cv_markdown, /^- English \(C1, professional\)$/m);
  assert.equal((out.cv_markdown.match(/^## languages$/gim) || []).length, 1, 'one Languages section');
  assert.match(out.cv_markdown, /^## Details$/m);
});

test('parseCvWithLlm: headings derived from a Word file do not skip the structuring call', async () => {
  const docx = `# Jonas Weber\nData Engineer\n\n## Summary\nData engineer who builds reliable batch and streaming pipelines for e-commerce analytics at scale.\n\n## Experience\n\n### Zalando — Senior Data Engineer\nApr 2021 – Present, Berlin\nMigrated 40 Airflow pipelines to dbt and cut nightly runtime by 35%.\n\n## Skills\nPython, SQL, Airflow, dbt, Kafka`;
  const chat = fakeChat({ profile: { candidate: { full_name: 'Jonas Weber' } }, structure: { header: { name: 'Jonas Weber' }, experience: [{ company: 'Zalando', title: 'Senior Data Engineer', start: 'Apr 2021', end: 'Present', bullets: ['Migrated 40 Airflow pipelines to dbt and cut nightly runtime by 35%.'] }] } });
  const fromWord = await parseCvWithLlm({ text: docx, fileName: 'jonas.docx', chat, models: MODELS, now: NOW });
  assert.deepEqual(chat.calls.map(c => c.kind).sort(), ['profile', 'structure']);
  assert.equal(fromWord.structured, true);
  const chat2 = fakeChat({ profile: { candidate: { full_name: 'Jonas Weber' } }, structure: new Error('must not be called') });
  const pasted = await parseCvWithLlm({ text: docx, fileName: 'cv.md', chat: chat2, models: MODELS, now: NOW });
  assert.deepEqual(chat2.calls.map(c => c.kind), ['profile']);
  assert.equal(pasted.structured, false);
});

// Live OCR run (2026-10-09): the phone swallowed the street number on the next
// line, the model built "linkedin.com/in/LinkedIn" from the label of a scan,
// and the side column's CONTACT block was repeated under the header.
test('a phone stops at the end of its line; a label is not a LinkedIn handle; no CONTACT section', async () => {
  assert.deepEqual(extractContactFacts('CONTACT\ncamille@example.com\n+33 6 12 34 56 78\n12 rue Merciere, 69002 Lyon, France').phones, ['+33 6 12 34 56 78']);
  const text = `CONTACT\ncamille@example.com\n+33 6 12 34 56 78\n12 rue Merciere, 69002 Lyon, France\nLinkedIn · GitHub\n\nCamille Laurent\nSenior Product Designer\n\nPROFILE\nProduct designer with 9 years of experience building consumer health and mobility products.\n\nEXPERIENCE\nDoctolib — Senior Product Designer\nMar 2022 – Present · Paris\nRedesigned the appointment booking flow used by 80 million patients.`;
  const chat = fakeChat({
    profile: { candidate: { full_name: 'Camille Laurent', phone: '+33 6 12 34 56 78 12', linkedin: 'linkedin.com/in/LinkedIn', github: 'github.com/GitHub' } },
    structure: {
      header: { name: 'Camille Laurent', email: 'camille@example.com', phone: '+33 6 12 34 56 78' },
      experience: [{ company: 'Doctolib', title: 'Senior Product Designer', start: 'Mar 2022', end: 'Present', bullets: ['Redesigned the appointment booking flow used by 80 million patients.'] }],
      other_sections: [{ title: 'CONTACT', lines: ['camille@example.com', '+33 6 12 34 56 78', 'LinkedIn · GitHub'] }],
    },
  });
  const out = await parseCvWithLlm({ text, fileName: 'scan.pdf', chat, models: MODELS, now: NOW });
  assert.equal(out.profile.candidate.phone, '+33 6 12 34 56 78');
  assert.equal(out.profile.candidate.linkedin, '');
  assert.equal(out.profile.candidate.github, '');
  assert.doesNotMatch(out.cv_markdown, /^## CONTACT$/m);
});

// ─── Review findings (2026-10-09) ────────────────────────────────────────────

const LYON_CV = `Jane Doe
Senior Product Designer
Lyon, France
jane@example.com

EXPERIENCE
Acme Corp — Senior Product Designer
2017 – Present
Led the design system.
`;

test('CVI-F1: a quote must state the value it is given for', () => {
  const lyon = normalizeSourceForMatch(LYON_CV);
  const invented = groundProfile({
    location: { city: 'Lyon', country: 'France', visa_status: 'US Green Card holder', authorized_in: ['United States', 'Canada'], nationality: 'French' },
    availability: { notice_period: '3 months', start_date: 'January 2027' },
    compensation: { employment_type: 'Freelance' },
    evidence: { visa_status: 'Lyon, France', authorized_in: 'Senior Product Designer', nationality: 'Lyon, France', notice_period: 'Present', start_date: '2017', employment_type: 'Acme Corp' },
  }, { normalizedSource: lyon, contacts: {}, sourceText: LYON_CV, now: NOW });
  const p = invented.profile;
  assert.equal(p.location.visa_status, '');
  assert.deepEqual(p.location.authorized_in, [], 'where someone lives is not where they may work');
  assert.equal(p.availability.notice_period, '');
  assert.equal(p.availability.start_date, '');
  assert.equal(p.compensation.employment_type, '');
  for (const field of ['location.visa_status', 'location.authorized_in', 'location.nationality', 'availability.notice_period', 'availability.start_date', 'compensation.employment_type']) {
    assert.ok(invented.droppedFields.includes(field), `${field} is reported as left out`);
  }

  const statedCv = `${LYON_CV}\nDETAILS\nAuthorized to work in the EU and Canada (work permit)\nNotice period: 3 months\nOpen to freelance missions\nAvailable from January 2027\nNationalité : française\n`;
  const stated = groundProfile({
    location: { visa_status: 'Work permit', authorized_in: ['European Union', 'Canada', 'United States'], nationality: 'French' },
    availability: { notice_period: '3 months', start_date: 'January 2027' },
    compensation: { employment_type: 'Freelance' },
    evidence: {
      visa_status: 'Authorized to work in the EU and Canada (work permit)', authorized_in: 'Authorized to work in the EU and Canada',
      nationality: 'Nationalité : française', notice_period: 'Notice period: 3 months', start_date: 'Available from January 2027', employment_type: 'Open to freelance missions',
    },
  }, { normalizedSource: normalizeSourceForMatch(statedCv), contacts: {}, sourceText: statedCv, now: NOW });
  assert.equal(stated.profile.location.visa_status, 'Work permit');
  assert.deepEqual(stated.profile.location.authorized_in, ['European Union', 'Canada', 'France'], 'the United States is not in the quote');
  assert.equal(stated.profile.availability.notice_period, '3 months');
  assert.equal(stated.profile.availability.start_date, 'January 2027');
  assert.equal(stated.profile.compensation.employment_type, 'Freelance');
  assert.deepEqual(stated.droppedFields, ['location.authorized_in']);
});

test('CVI-F2: a fragment matches on word boundaries only', () => {
  const cv = normalizeSourceForMatch('Director of Engineering. Built robust, scalable JavaScript apps; metadata pipelines on amazonaws S3. Google Analytics. Sparked adoption of HTML.');
  for (const word of ['Java', 'Scala', 'Go', 'CTO', 'Meta', 'Amazon', 'Spark', 'ML', 'R', 'C']) {
    assert.equal(occursInSource(word, cv, 'item'), false, `${word} is only part of a word`);
  }
  assert.equal(occursInSource('JavaScript', cv, 'item'), true);
  assert.equal(occursInSource('Google Analytics', cv, 'exact'), true);
  assert.equal(occursInSource('avascript apps; metadata', cv), false, 'the space-free comparison starts on a word too');
  assert.equal(occursInSource('Led the migration of the ledger to event-sourcing', src), true, 'glued and spaced forms still compare equal');

  const { cv: structured } = coerceStructuredCv({
    experience: [{ company: 'Meta', title: 'CTO', start: '2018', end: '2024' }],
    skills: [{ items: ['Java', 'Rust', 'Scala', 'Go', 'Spark', 'JavaScript'] }],
  }, cv);
  assert.deepEqual(structured.experience, [], '"metadata" does not ground the employer Meta, "director" not the title CTO');
  assert.deepEqual(structured.skills, [{ category: '', items: ['JavaScript'] }]);
});

test('CVI-F3 / SRV-F1: an oversized CV is refused and long runs are parsed in linear time', async () => {
  const over = validateCvParseRequest({ markdown: 'x'.repeat(CV_MAX_CHARS + 1) });
  assert.deepEqual(over, { ok: false, status: 413, error: `This CV is too long to analyze (${CV_MAX_CHARS + 1} characters). Paste its main sections instead.` });
  assert.equal(validateCvParseRequest({ markdown: 'x'.repeat(CV_MAX_CHARS) }).ok, true);
  await assert.rejects(parseCvWithLlm({ text: 'x'.repeat(CV_MAX_CHARS + 1), chat: fakeChat({}), models: MODELS, now: NOW }), err => err.statusCode === 413);

  // Each of these took seconds to hours before (quadratic or cubic backtracking).
  const n = 150_000;
  const timed = (label, run) => {
    const start = performance.now();
    run();
    const ms = performance.now() - start;
    assert.ok(ms < 1500, `${label} took ${Math.round(ms)} ms`);
  };
  timed('spaces before a dash', () => normalizeSourceForMatch(`${' '.repeat(n)}-x`));
  timed('brackets', () => normalizeSourceForMatch('[]('.repeat(n / 3)));
  timed('an address-like run', () => extractContactFacts('a'.repeat(n)));
  timed('a labelled phone with spaces', () => extractContactFacts(`phone${' '.repeat(n)}x`));
  timed('a heading with spaces', () => clipCvText(`# Jane\n## a${' '.repeat(n)}b\n${'filler line\n'.repeat(3000)}`));
  timed('blank lines', () => clipCvText(`${'\n'.repeat(n)}${'x'.repeat(40000)}`));
  const start = performance.now();
  const chat = fakeChat({ profile: { candidate: { full_name: 'Jane' } }, structure: { header: { name: 'Jane' }, summary: ['x'.repeat(300)] } });
  await parseCvWithLlm({ text: `Jane\n${' '.repeat(n)}${'x'.repeat(300)}`, fileName: 'cv.pdf', chat, models: MODELS, now: NOW });
  assert.ok(performance.now() - start < 3000, 'the whole import of a long run of spaces');
});

test('CVI-F4: the long-line fallback needs order and locality; exit_story and metrics are exact', () => {
  const cv = normalizeSourceForMatch('Senior product designer.\nLed the redesign of the checkout, raising conversion by 12%\nDesigned onboarding flows for the mobile app\nBuilt a design system used by 4 squads');
  assert.equal(occursInSource('Led the redesign of the checkout raising revenue by 12%', cv), false, 'a substituted word');
  assert.equal(occursInSource('Designed checkout flows for the mobile app', cv), false, 'words from two lines');
  assert.equal(occursInSource('Led redesign of the checkout, raising conversion by 12%', cv), true, 'a dropped article');
  assert.equal(occursInSource('Led the redesign of the checkout, raising the conversion by 12%', cv), true, 'an added article');

  const text = 'Jane Doe\nPROFILE\nSenior product designer who led the redesign of the checkout. I care about accessible products.\nEXPERIENCE\nAcme\nBuilt a design system for the mobile app used by 4 squads, raising conversion by 12%\n';
  const source = normalizeSourceForMatch(text);
  const structured = coerceStructuredCv({ summary: ['Senior product designer who led the redesign of the checkout. I care about accessible products.'] }, source).cv;
  const out = groundProfile({
    narrative: {
      exit_story: 'Senior product designer who led the redesign of the checkout and built a design system for the mobile app.',
      proof_points: [{ name: 'Design system', hero_metric: '4x revenue' }, { name: 'Design system for the mobile app', hero_metric: 'raising conversion by 12%' }],
    },
  }, { normalizedSource: source, sourceText: text, structuredCv: structured, now: NOW });
  assert.equal(out.profile.narrative.exit_story, 'Senior product designer who led the redesign of the checkout. I care about accessible products.', 'the CV summary, not the recombined one');
  assert.equal(out.suggestions.exit_story, 'Senior product designer who led the redesign of the checkout and built a design system for the mobile app.');
  assert.deepEqual(out.profile.narrative.proof_points.map(p => p.hero_metric), ['', 'raising conversion by 12%'], '"4 squads" does not ground "4x revenue"');
});

test('CVI-F5: a superpower needs all its words in the CV; the others become suggestions', () => {
  const text = 'Jane Doe\nSKILLS\nFigma, user research, prototyping, data visualisation, design system\n';
  const out = groundProfile({
    narrative: { superpowers: ['User research', 'Python data pipelines', 'Rust systems programming', 'AI research', 'Design system prototyping'] },
    suggestions: { superpowers: ['Calm under pressure'] },
  }, { normalizedSource: normalizeSourceForMatch(text), sourceText: text, now: NOW });
  assert.deepEqual(out.profile.narrative.superpowers, ['User research', 'Design system prototyping']);
  assert.deepEqual(out.suggestions.superpowers, ['Calm under pressure', 'Python data pipelines', 'Rust systems programming', 'AI research']);
  assert.ok(!out.droppedFields.includes('narrative.superpowers'), 'refused superpowers are offered as suggestions, not left out');
});

test('CVI-F6: titles, dates and links are matched exactly', () => {
  const text = 'Jane Doe\nSenior Product Designer\njanedoe@gmail.com\n\nEXPERIENCE\nAcme Corp — Lead Designer\nMar 2021 – Present\nGlobex — Designer\n2017 – 2021\n';
  const source = normalizeSourceForMatch(text);
  assert.equal(occursInSource('Senior Lead Designer', source, 'exact'), false);
  assert.equal(occursInSource('Product Designer Acme', source, 'exact'), false);
  const { cv } = coerceStructuredCv({
    header: { links: ['janedoe.com', 'https://janedoe.com'] },
    experience: [
      { company: 'Acme Corp', title: 'Senior Lead Designer', start: 'Mar 2021', end: 'Present' },
      { company: 'Globex', title: 'Designer', start: 'Mar 2017', end: '2021' },
    ],
  }, source);
  assert.equal(cv.experience[0].title, '', 'an inflated title is dropped');
  assert.equal(cv.experience[0].start, 'Mar 2021');
  assert.equal(cv.experience[1].start, '', '"Mar" belongs to 2021, not to 2017');
  assert.equal(cv.experience[1].end, '2021');
  assert.deepEqual(cv.header.links, [], 'an e-mail address is not a website');
  const months = coerceStructuredCv({ experience: [{ company: 'Globex', start: '03/2017', end: 'Jun 2021' }] }, normalizeSourceForMatch('Globex\nMar 2017 – Jun 2021')).cv;
  assert.deepEqual([months.experience[0].start, months.experience[0].end], ['03/2017', 'Jun 2021'], 'the same date written another way');

  const profile = groundProfile({ candidate: { portfolio_url: 'janedoe.com' } }, { normalizedSource: source, sourceText: text, now: NOW });
  assert.equal(profile.profile.candidate.portfolio_url, '');
});

test('CVI-F7: icon labels are not handles, and a guessed handle needs its own label', () => {
  for (const row of ['Email | LinkedIn | GitHub', 'GitHub | LinkedIn', 'LinkedIn - Portfolio', 'janedoe@gmail.com | LinkedIn | GitHub | Lyon, France', 'GitHub: France', 'Twitter | @jane']) {
    const facts = extractContactFacts(row);
    assert.deepEqual([facts.linkedin, facts.github, facts.twitter], ['', '', ''], row);
  }
  assert.equal(extractContactFacts('LinkedIn - jane-doe').linkedin, 'linkedin.com/in/jane-doe', 'a spaced dash still introduces a handle');

  const guessed = { candidate: { linkedin: 'linkedin.com/in/janedoe', github: 'github.com/janedoe', twitter: '@janedoe' } };
  const emailOnly = 'Jane Doe\njanedoe@gmail.com\nLyon, France\n';
  const fromEmail = groundProfile(guessed, { normalizedSource: normalizeSourceForMatch(emailOnly), sourceText: emailOnly, contacts: {}, now: NOW }).profile.candidate;
  assert.deepEqual([fromEmail.linkedin, fromEmail.github, fromEmail.twitter], ['', '', ''], 'the e-mail local part is not a handle');
  const labelled = 'Jane Doe\nlinkedin.com/in/janedoe · github.com/janedoe · Twitter @janedoe\n';
  const kept = groundProfile(guessed, { normalizedSource: normalizeSourceForMatch(labelled), sourceText: labelled, contacts: {}, now: NOW }).profile.candidate;
  assert.deepEqual([kept.linkedin, kept.github, kept.twitter], ['linkedin.com/in/janedoe', 'github.com/janedoe', 'https://x.com/janedoe']);
});

test("CVI-F8: the candidate's phone beats a referee's, and a repository is not a profile", () => {
  const refs = 'Jane Doe\n+33 6 12 34 56 78\njane@x.fr\n\nEXPERIENCE\nAcme\n\nREFERENCES\nJohn Smith, Head of Design — Phone: +44 20 7946 0958\n';
  assert.deepEqual(extractContactFacts(refs).phones, ['+33 6 12 34 56 78']);
  const national = `Jane Doe\n06 12 34 56 78\n${'\n'.repeat(16)}Contact my manager. Tel: 01 23 45 67 89\n`;
  assert.deepEqual(extractContactFacts(national).phones, ['06 12 34 56 78', '01 23 45 67 89'], 'the header number first');

  const body = `Jane Doe\njane.doe@x.fr\n${'Shipped things.\n'.repeat(20)}Contributed to github.com/kubernetes/kubernetes\n`;
  assert.equal(extractContactFacts(body).github, '');
  assert.equal(extractContactFacts('Jane Doe\njane.doe@x.fr', ['https://github.com/facebook/react']).github, '');
  assert.equal(extractContactFacts(`${body}My ledger: github.com/jdoe/ledger\n`).github, 'github.com/jdoe', 'an owner that carries the name');
  assert.equal(extractContactFacts('Kim Lee\ngithub.com/kim/ledger\n').github, 'github.com/kim', 'a repository in the header');
});

test('CVI-F9: an unlabelled portfolio must carry the candidate\'s name', () => {
  assert.equal(extractContactFacts('Jane Doe\nSkills: ASP.NET, Vue.JS').portfolio, '');
  assert.equal(extractContactFacts('Jane Doe\nProduct Designer @ Booking.com').portfolio, '');
  assert.equal(extractContactFacts('Jane Doe\nData Scientist | Python | pandas.io').portfolio, '');
  assert.equal(extractContactFacts('Jane Doe\njane@x.fr', ['mailto:jane@x.fr', 'https://www.acme.com/', 'https://www.linkedin.com/in/jane']).portfolio, '', 'an employer link');
  assert.equal(extractContactFacts('Jane Doe\njane@x.fr', ['https://www.janedoe.design/']).portfolio, 'https://www.janedoe.design');
  assert.equal(extractContactFacts('Jane Doe\njane@x.fr', ['https://www.behance.net/janedoe']).portfolio, 'https://www.behance.net/janedoe');
  assert.equal(extractContactFacts('JD\njane@x.fr', ['https://www.studio-north.design/'], { name: 'Jane North' }).portfolio, 'https://www.studio-north.design', 'the grounded name helps');
});

test('CVI-F10: languages and their levels come from the language lines of the CV', () => {
  const text = 'Jane Doe\nResearch Engineer at the German Aerospace Center (DLR)\nBSc English Literature\n\nLANGUAGES\nFrench (B1)\n';
  const source = normalizeSourceForMatch(text);
  const out = groundProfile({ candidate: { languages: [{ name: 'English', level: 'Native' }, { name: 'German', level: 'C1' }, { name: 'French', level: 'C2' }] } },
    { normalizedSource: source, sourceText: text, now: NOW });
  assert.deepEqual(out.profile.candidate.languages, ['French'], 'an employer and a degree name no language; B1 does not ground C2');
  assert.ok(out.droppedFields.includes('candidate.languages'));
  const { cv } = coerceStructuredCv({ languages: [{ name: 'German', level: 'C1' }, { name: 'Français', level: 'C2' }] }, source, { sourceText: text });
  assert.deepEqual(cv.languages, [{ name: 'Français', level: '' }]);

  const noSection = 'Jane Doe\nFluent in Spanish, native French speaker\nWorked with German clients\n';
  const loose = groundProfile({ candidate: { languages: [{ name: 'Spanish', level: 'Fluent' }, { name: 'French', level: 'native' }, { name: 'German', level: '' }] } },
    { normalizedSource: normalizeSourceForMatch(noSection), sourceText: noSection, now: NOW });
  assert.deepEqual(loose.profile.candidate.languages, ['Spanish (Fluent)', 'French (native)'], 'without a section, lines with a level word');

  const list = 'Jane Doe\nLANGUAGES\nFrench native, English: C1, professional\n';
  const levels = groundProfile({ candidate: { languages: [{ name: 'French', level: 'native' }, { name: 'English', level: 'native' }] } },
    { normalizedSource: normalizeSourceForMatch(list), sourceText: list, now: NOW });
  assert.deepEqual(levels.profile.candidate.languages, ['French (native)', 'English'], "French's level is not English's");
  const split = groundProfile({ candidate: { languages: [{ name: 'English', level: 'C1 (professional)' }] } },
    { normalizedSource: normalizeSourceForMatch(list), sourceText: list, now: NOW });
  assert.deepEqual(split.profile.candidate.languages, ['English (C1, professional)'], 'a level cut by a comma stays with its language');
});

test('CVI-F11: "Depuis/Since" roles are ongoing; a Present end needs its own range', () => {
  const text = 'Jean Dupont\n\nEXPÉRIENCE\nSociété Générale — Chef de projet\nDepuis mars 2019\nBNP Paribas — Analyste\n2015 – 2019\n';
  const source = normalizeSourceForMatch(text);
  for (const variant of [{ start: 'Depuis mars 2019', end: '' }, { start: 'mars 2019', end: "Aujourd'hui" }, { start: 'mars 2019', end: 'Present' }]) {
    const { cv } = coerceStructuredCv({ experience: [{ company: 'Société Générale', title: 'Chef de projet', ...variant }, { company: 'BNP Paribas', title: 'Analyste', start: '2015', end: '2019' }] }, source);
    assert.equal(cv.experience[0].end, variant.end, JSON.stringify(variant));
    assert.equal(currentRoleFromExperience(cv.experience, NOW).company, 'Société Générale', JSON.stringify(variant));
    assert.equal(yearsFromExperience(cv.experience, NOW), 12, JSON.stringify(variant));
  }
  assert.deepEqual(currentRoleFromExperience([{ company: 'Zalando', title: 'Engineer', start: 'Seit 2020', end: '' }], NOW).start_year, '2020');

  const english = normalizeSourceForMatch('Jane\nAcme — Lead\n2021 – Present\nGlobex — Dev\n2015 – 2018\n');
  const { cv } = coerceStructuredCv({ experience: [{ company: 'Acme', title: 'Lead', start: '2021', end: 'Present' }, { company: 'Globex', title: 'Dev', start: '2015', end: 'Present' }] }, english);
  assert.deepEqual(cv.experience.map(e => e.end), ['Present', ''], 'another role being ongoing does not make this one ongoing');
});

test('CVI-F12 and the headline length: invented acronyms and long taglines are suggestions', () => {
  const designer = 'Jane Doe\n\nEXPERIENCE\nAcme — Product Designer\n2019 – Present\nDesigned the checkout.\n';
  const composed = groundProfile({ narrative: { headline: 'CTO & VP of AI | Product Designer' } }, { normalizedSource: normalizeSourceForMatch(designer), sourceText: designer, now: NOW });
  assert.equal(composed.profile.narrative.headline, '');
  assert.equal(composed.suggestions.headline, 'CTO & VP of AI | Product Designer');
  assert.ok(composed.droppedFields.includes('narrative.headline'));

  const tagline = 'Senior product designer for consumer health and mobility products, design systems, research and prototyping across web and mobile';
  assert.ok(tagline.length > 120 && tagline.length <= 160);
  const text = `Jane Doe\n${tagline}\n\nEXPERIENCE\nAcme — Product Designer\n2019 – Present\n`;
  const source = normalizeSourceForMatch(text);
  const structured = coerceStructuredCv({ header: { name: 'Jane Doe', headline: tagline } }, source).cv;
  const long = groundProfile({ narrative: { headline: tagline }, suggestions: { headline: 'Product designer' } }, { normalizedSource: source, sourceText: text, structuredCv: structured, now: NOW });
  assert.equal(long.profile.narrative.headline, '', 'the field holds 120 characters');
  assert.equal(long.suggestions.headline, tagline, 'offered whole instead');
  assert.ok(!long.droppedFields.includes('narrative.headline'), 'it is in the CV, not left out');
});

// Live run (2026-10-09, after the stricter grounding): work authorization was
// filled from "Nationality: French" yet reported as "left out", and a freelance
// entry printed its title twice.
test('a refused model value is not reported when the field is still filled; no repeated title', async () => {
  const text = `Camille Laurent\nSenior Product Designer\ncamille@example.com\n\nPROFILE\nProduct designer with 9 years of experience building consumer health and mobility products.\n\nEXPERIENCE\nFreelance UX Designer\nJan 2016 – Aug 2018 · Lyon\nDelivered UX audits and prototypes for 15 startups and agencies in the Lyon area.\n\nDETAILS\nNationality: French`;
  const chat = fakeChat({
    profile: {
      candidate: { full_name: 'Camille Laurent' },
      location: { authorized_in: ['France', 'European Union'] },
      evidence: { authorized_in: 'Nationality: French' },
    },
    structure: {
      header: { name: 'Camille Laurent' },
      experience: [{ company: 'Freelance UX Designer', title: 'Freelance UX Designer', start: 'Jan 2016', end: 'Aug 2018', location: 'Lyon', bullets: ['Delivered UX audits and prototypes for 15 startups and agencies in the Lyon area.'] }],
    },
  });
  const out = await parseCvWithLlm({ text, fileName: 'cv.pdf', chat, models: MODELS, now: NOW });
  assert.deepEqual(out.profile.location.authorized_in, ['France', 'European Union']);
  assert.ok(!out.dropped.fields.includes('location.authorized_in'));
  assert.ok(!out.dropped.fields.includes('location.nationality'));
  assert.match(out.cv_markdown, /^### Freelance UX Designer\nJan 2016 – Aug 2018 · Lyon$/m);
});
