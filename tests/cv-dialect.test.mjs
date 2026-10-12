import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './helpers.mjs';
import {
  candidateFacts,
  closestCareerLines,
  compactCv,
  detectCvDialect,
  educationFromText,
  experienceIndex,
  experienceYearsFromText,
  indexCareer,
  isHeadlineCandidate,
  languagesFromText,
  normalizeCvDialect,
  parseHeading,
  roleTenureYears,
} from '../lib/prompt-budget.mjs';
import { parseCvMarkdownForTemplate } from '../lib/cv-template-data.mjs';
import { coerceStructuredCv, normalizeSourceForMatch, renderCvMarkdown } from '../lib/cv-import.mjs';
import { workedAtCompany } from '../lib/apply-fill-guards.mjs';

// The layout the onboarding documents and lib/cv-import.mjs renders.
const H2_CV = `# Jane Doe
Staff Backend Engineer · Payments

**Email:** jane@example.com
**Location:** Lyon, France

## Summary

Backend engineer with nine years on payment platforms.

## Experience

### Acme Payments
**Staff Engineer**
Mar 2021 – Present · Lyon
- Led the migration of the ledger to event sourcing (-40% incidents)
- Mentored 6 engineers

### Globex
**Senior Engineer**
2017 – 2021
- Built the fraud scoring service

## Projects

### [Open Ledger](https://github.com/jane/ledger)
Open-source double-entry ledger
- 2K stars

## Education

### MSc Computer Science
INSA Lyon, 2014 – 2016

## Skills

- **Languages:** Go, Python, SQL
- **Infra:** Kubernetes, Postgres, Kafka

## Languages

- French (native)
- English (C1)
`;

// What ui/onboarding.html "Generate a skeleton from my answers" writes.
const SKELETON_CV = [
  '# Jane Smith', '', '**Email:** jane@example.com  ', '**LinkedIn:** linkedin.com/in/janesmith', '',
  '## Summary', '', 'Product designer for B2B tools.', '',
  '## Experience', '', '### Northwind', '**Product Designer**', '2021 – Present', '- Redesigned the checkout', '- Scope: team of 4', '',
  '## Projects', '', '- **Sidekit** — habit tracker', '',
  '## Education', '', '- BA Design — ECAL (2016)', '',
  '## Skills', '', '- Figma, Prototyping, User research', '',
  '## Languages', '', '- French (native)', '- English (C1)', '',
].join('\n');

// Text extracted from a PDF: no Markdown at all.
const RAW_CV = `Jane Doe
Staff Backend Engineer
Lyon, France · jane@example.com

PROFILE
Backend engineer with nine years on payment platforms.

EXPERIENCE
Acme Payments — Staff Engineer
Mar 2021 – Present
• Led the migration of the ledger to event sourcing
Globex — Senior Engineer
2017 – 2021
• Built the fraud scoring service

EDUCATION
MSc Computer Science, INSA Lyon, 2014 – 2016

SKILLS
Go, Python, SQL, Kubernetes

LANGUAGES
French (native), English (C1)
`;

test('the owner layout ("### Section" / "#### Role : Company") is left untouched', () => {
  const owner = '# Hugo\n## Product Leader\n\n### Summary\nDesigner.\n\n### Professional Experience\n\n#### Lead : Acme (2021 – Present)\n- Shipped\n';
  assert.equal(detectCvDialect(owner), 'h3');
  assert.equal(normalizeCvDialect(owner), owner);
  const cvPath = join(ROOT, 'cv.md');
  if (existsSync(cvPath)) {
    const cv = readFileSync(cvPath, 'utf8');
    if (detectCvDialect(cv) !== 'h2') assert.equal(normalizeCvDialect(cv), cv, 'cv.md reads exactly as before');
  }
  assert.equal(normalizeCvDialect(RAW_CV), RAW_CV, 'plain text is not rewritten');
});

test('an H2-dialect CV keeps experience, education, skills and languages', () => {
  const normalized = normalizeCvDialect(H2_CV);
  assert.match(normalized, /^## Staff Backend Engineer · Payments$/m, 'the tagline becomes the title line');
  assert.match(normalized, /^#### Staff Engineer : Acme Payments \(Mar 2021 – Present · Lyon\)$/m);
  assert.match(normalized, /^- MSc Computer Science : INSA Lyon \(2014 – 2016\)$/m);

  const lean = compactCv(H2_CV);
  assert.ok(lean.length > 600, `compactCv kept ${lean.length} chars`);
  for (const fact of ['Acme Payments', 'Globex', 'event sourcing', 'INSA Lyon', 'Kubernetes', 'French (native)', 'nine years']) {
    assert.ok(lean.includes(fact), `compactCv keeps ${fact}`);
  }
  const index = indexCareer(H2_CV);
  assert.deepEqual(index.employerNames, ['Acme Payments', 'Globex']);
  assert.equal(index.employers.length, 2);
  assert.ok(index.sideNames.includes('Open Ledger'));
  assert.ok(index.text.includes('Built the fraud scoring service'));
  assert.deepEqual(index.languages.map(l => l.name), ['French', 'English']);
  assert.deepEqual(educationFromText(H2_CV), [{ degree: 'MSc Computer Science', school: 'INSA Lyon', start: '2014', end: '2016' }]);
  const facts = candidateFacts(H2_CV);
  assert.match(facts, /Intitulé : Staff Backend Engineer · Payments/);
  assert.match(facts, /Staff Engineer : Acme Payments/);
  assert.ok(!/Intitulé : (Summary|Experience)/.test(facts), 'a section name is not the title');
});

test('the onboarding skeleton keeps its experience, education and languages', () => {
  const lean = compactCv(SKELETON_CV);
  for (const fact of ['Northwind', 'Redesigned the checkout', 'ECAL', 'Figma', 'French (native)']) {
    assert.ok(lean.includes(fact), `compactCv keeps ${fact}`);
  }
  const index = indexCareer(SKELETON_CV);
  assert.deepEqual(index.employerNames, ['Northwind']);
  assert.match(experienceIndex(SKELETON_CV), /Product Designer : Northwind \(2021 – Present\): Redesigned the checkout/);
  assert.deepEqual(educationFromText(SKELETON_CV), [{ degree: 'BA Design', school: 'ECAL', start: '2016', end: '' }]);
  assert.deepEqual(languagesFromText(SKELETON_CV).map(l => `${l.name} (${l.level})`), ['French (native)', 'English (C1)']);
  assert.ok(!/Intitulé/.test(candidateFacts(SKELETON_CV)), 'no tagline, no title — never "Summary"');
});

test('a plain-text CV is clipped whole instead of shrinking to its header', () => {
  const lean = compactCv(RAW_CV);
  assert.equal(lean, RAW_CV.trim(), 'short enough to keep entirely');
  assert.ok(compactCv(`${RAW_CV}\n${'Detail line about a project.\n'.repeat(1000)}`, 4000).length <= 4100);
  const index = indexCareer(RAW_CV);
  assert.ok(index.text.includes('Acme Payments') && index.text.includes('INSA Lyon'), 'the career text is the plain text');
  assert.deepEqual(languagesFromText(RAW_CV).map(l => l.name), ['French', 'English']);
});

test('renderCvMarkdown output round-trips through the CV readers', () => {
  const source = normalizeSourceForMatch(RAW_CV);
  const { cv } = coerceStructuredCv({
    header: { name: 'Jane Doe', headline: 'Staff Backend Engineer' },
    summary: ['Backend engineer with nine years on payment platforms.'],
    experience: [
      { company: 'Acme Payments', title: 'Staff Engineer', start: 'Mar 2021', end: 'Present', bullets: ['Led the migration of the ledger to event sourcing'] },
      { company: 'Globex', title: 'Senior Engineer', start: '2017', end: '2021', bullets: ['Built the fraud scoring service'] },
    ],
    education: [{ degree: 'MSc Computer Science', school: 'INSA Lyon', start: '2014', end: '2016' }],
    skills: [{ category: '', items: ['Go', 'Python', 'SQL', 'Kubernetes'] }],
    languages: [{ name: 'French', level: 'native' }, { name: 'English', level: 'C1' }],
  }, source);
  const md = renderCvMarkdown(cv, { email: 'jane@example.com', location: 'Lyon, France' });
  assert.equal(detectCvDialect(md), 'h2');

  const parsed = parseCvMarkdownForTemplate(md);
  assert.equal(parsed.summary, 'Backend engineer with nine years on payment platforms.');
  assert.deepEqual(parsed.experience, [
    { company: 'Acme Payments', role: 'Staff Engineer', period: 'Mar 2021 – Present', bullets: ['Led the migration of the ledger to event sourcing'] },
    { company: 'Globex', role: 'Senior Engineer', period: '2017 – 2021', bullets: ['Built the fraud scoring service'] },
  ]);
  assert.deepEqual(parsed.education, [{ degree: 'MSc Computer Science', school: 'INSA Lyon', year: '2014 – 2016' }]);
  assert.deepEqual(parsed.skill_sections, [{ title: 'Skills', items: ['Go', 'Python', 'SQL', 'Kubernetes'] }]);
  assert.deepEqual(parsed.languages, [{ name: 'French', level: 'native' }, { name: 'English', level: 'C1' }]);

  const lean = compactCv(md);
  assert.ok(lean.includes('Acme Payments') && lean.includes('INSA Lyon') && lean.includes('Kubernetes'));
  const index = indexCareer(md);
  assert.deepEqual(index.employerNames, ['Acme Payments', 'Globex']);
  assert.ok(index.employers.every(line => /\(\d{4}|\(Mar/.test(line)), 'dates travel with each role');
  assert.deepEqual(educationFromText(md), [{ degree: 'MSc Computer Science', school: 'INSA Lyon', start: '2014', end: '2016' }]);
  assert.deepEqual(languagesFromText(md).map(l => l.name), ['French', 'English']);
});

// ─── Review fixes (PB-1 … PB-12, SRV-F1) ────────────────────────────────────

const structured = (cv) => ({
  header: { name: 'Jane Roe', headline: '' },
  summary: ['Marketer.'],
  experience: [],
  projects: [],
  education: [],
  skills: [],
  languages: [],
  certifications: [],
  other_sections: [],
  ...cv,
});

const elapsed = (fn) => {
  const start = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - start) / 1e6;
};

test('parseHeading reads exactly N hashes and strips a closing sequence', () => {
  assert.equal(parseHeading('## Experience', 2), 'Experience');
  assert.equal(parseHeading('##   Experience  ##  ', 2), 'Experience');
  assert.equal(parseHeading('## Experience\r', 2), 'Experience', 'a CRLF line');
  assert.equal(parseHeading('##\tSkills', 2), 'Skills');
  assert.equal(parseHeading('### C#', 3), 'C#', 'a closing "#" needs a space before it');
  assert.equal(parseHeading('### Experience', 2), null);
  assert.equal(parseHeading('## Experience', 3), null);
  assert.equal(parseHeading('##Experience', 2), null);
  assert.equal(parseHeading('##   ', 2), null, 'an empty heading is no section');
  assert.equal(parseHeading(`## ${'a'.repeat(400)}`, 2), null, 'a 400-character line is content');
});

test('SRV-F1: heading lines with long space runs are read in linear time', () => {
  const spaces = ' '.repeat(100000);
  const cv = `# Jane\n## a${spaces}b\n## Skills\n- Go\n### a${spaces}b\n`;
  // The regex form took about 5 s on 4,000 spaces, and grew cubically.
  assert.ok(elapsed(() => detectCvDialect(cv)) < 1000);
  assert.ok(elapsed(() => normalizeCvDialect(cv)) < 1000);
  assert.ok(elapsed(() => compactCv(cv)) < 1000);
  assert.ok(elapsed(() => candidateFacts(`# Jane\n## a${'. '.repeat(50000)}b\n### Skills\n- Go\n`)) < 1000);
  assert.equal(detectCvDialect(cv), 'h2', 'the long line is not a section; "## Skills" still is');
  // Headings just under the length cap, one after another: about 2.5 ms each
  // with the regex form, so several seconds for this CV.
  const run = ' '.repeat(290);
  const headings = `# Jane\n${`## a${run}b\n`.repeat(1000)}## Experience\n${`### a${run}b\n- x\n`.repeat(1000)}`;
  assert.ok(elapsed(() => parseCvMarkdownForTemplate(headings)) < 1500);
  assert.ok(elapsed(() => detectCvDialect(headings)) < 1000);
  assert.ok(elapsed(() => compactCv(headings)) < 1500);
  assert.equal(parseCvMarkdownForTemplate('# J\n## Experience ##\n### Acme ###\n**Designer**\n2020 – 2022\n').experience[0].company, 'Acme');
});

test('PB-7 and the other readers stay linear on a 100k-character CV', () => {
  const blank = '\n'.repeat(100000);
  // 31.8 s per compactCv call before: a backwards search of the output on every line.
  assert.ok(elapsed(() => compactCv(`# Jane${blank}## Skills\n- Go\n`)) < 1000);
  assert.ok(elapsed(() => compactCv(`# Jane\n${'x\n'.repeat(50000)}## Skills\n- Go\n`)) < 1000);
  assert.ok(elapsed(() => indexCareer(`# Jane\n### Professional Experience\n#### Lead : Acme (2020 – 2022)${blank}- x\n`)) < 1000);
  assert.ok(elapsed(() => languagesFromText(`# Jane\n${' \n'.repeat(50000)}x\n`)) < 1000);
  assert.ok(elapsed(() => educationFromText(`# Jane\n### Education\n- x:${' '.repeat(100000)}y\n`)) < 1000);
  assert.ok(elapsed(() => educationFromText(`# Jane\n### Education\n${`- x: y (${' '.repeat(75)}2016)\n`.repeat(1000)}`)) < 1000);
  assert.ok(elapsed(() => languagesFromText(`# Jane\n### Languages\n- French: ${'('.repeat(100000)}\n`)) < 1000);
  assert.ok(elapsed(() => indexCareer(`# Jane\n### Professional Experience\n#### Lead\n- ${'('.repeat(100000)}\n`)) < 1000);
  assert.ok(elapsed(() => experienceYearsFromText(`${'1'.repeat(100000)} years`)) < 1000);
  assert.ok(elapsed(() => compactCv(`# Jane\n## Experience\n### Acme\n${' *a'.repeat(33000)}\n`)) < 1000);
});

test('PB-1: an H3 CV with one "## Profile" heading keeps its career', () => {
  const cv = [
    '# Jane Roe', '## Profile', 'Product designer with 8 years in fintech.', '',
    '### Professional Experience', '',
    '#### Senior Product Designer : Acme (2020 – Present)', '- Led the design system', '',
    '#### Product Designer : Globex (2016 – 2020)', '- Shipped onboarding', '',
    '### Education', '- BA Design : ECAL (2013 – 2016)', '',
    '### Languages', '- French : Native', '',
  ].join('\n');
  assert.equal(detectCvDialect(cv), 'h3');
  assert.equal(normalizeCvDialect(cv), cv);
  assert.deepEqual(indexCareer(cv).employerNames, ['Acme', 'Globex']);
  assert.deepEqual(educationFromText(cv), [{ degree: 'BA Design', school: 'ECAL', start: '2013', end: '2016' }]);
  assert.deepEqual(languagesFromText(cv).map(l => l.name), ['French']);
});

test('PB-1: "### Education" under an H2 Experience section is the next section', () => {
  const entries = '# Jane\n## Summary\nDesigner.\n## Experience\n### Acme\n**Senior Designer**\n2020 – 2023\n- Led\n### Education\n- BA Design : ECAL (2013 – 2016)\n### Languages\n- French (native)\n';
  const roles = '# Jane\n## Experience\n#### Senior Product Designer : Acme (2020 – Present)\n- Led\n### Education\n- BA Design : ECAL (2013 – 2016)\n### Languages\n- French : Native\n';
  for (const cv of [entries, roles]) {
    assert.equal(detectCvDialect(cv), 'h2', 'an entry under "## Experience" makes it H2');
    assert.deepEqual(indexCareer(cv).employerNames, ['Acme'], 'no "Education" or "French" employer');
    assert.deepEqual(educationFromText(cv), [{ degree: 'BA Design', school: 'ECAL', start: '2013', end: '2016' }]);
    assert.deepEqual(languagesFromText(cv).map(l => l.name), ['French']);
  }
});

test('PB-2: an entry with no company never turns a bullet into an employer', () => {
  const md = renderCvMarkdown(structured({
    experience: [
      { company: '', title: 'Freelance Marketing Consultant', start: '2015', end: '2017', location: '', bullets: ['Google Ads campaigns for 20 clients', 'SEO audits'] },
      { company: 'Airbus', title: '', start: '2012', end: '2015', location: '', bullets: ['Shopify store migration'] },
    ],
  }));
  const normalized = normalizeCvDialect(md);
  assert.match(normalized, /^#### Freelance Marketing Consultant : — \(2015 – 2017\)$/m);
  assert.match(normalized, /^#### — : Airbus \(2012 – 2015\)$/m);
  const { employerNames } = indexCareer(md);
  assert.deepEqual(employerNames, ['Airbus']);
  assert.equal(workedAtCompany('Google', employerNames), false);
  assert.equal(workedAtCompany('Shopify', employerNames), false);
  assert.equal(workedAtCompany('Airbus', employerNames), true);
});

test('PB-3: an Experience section of bullets still reaches the career index', () => {
  const cv = '# Jane\n## Summary\nDesigner.\n## Experience\n- Senior Product Designer, Qonto (2020 – 2023): Led the mobile app redesign\n- Product Designer, N26 (2017 – 2020): Designed onboarding\nAcme Bank — UX Designer — 2015 – 2017\n## Skills\n- Figma\n';
  const index = indexCareer(cv);
  for (const fact of ['Qonto', 'Led the mobile app redesign', 'Acme Bank']) assert.ok(index.text.includes(fact), `career text keeps ${fact}`);
  assert.deepEqual(index.employers, [
    '- Senior Product Designer, Qonto (2020 – 2023):',
    '- Product Designer, N26 (2017 – 2020):',
    '- Acme Bank — UX Designer — 2015 – 2017:',
  ]);
  assert.deepEqual(index.employerNames, [], 'no bullet text becomes a trusted employer name');
  assert.ok(closestCareerLines('Tell us about a mobile app you shipped', index.text, 6, index).length > 0);
});

test('PB-4: role and company sides are told apart by whole title words', () => {
  const head = (heading, body = '- did') => normalizeCvDialect(`# J\n## Summary\nx\n## Experience\n### ${heading}\n${body}\n`)
    .split('\n').find(line => line.startsWith('#### '));
  assert.equal(head('Octopus Energy — Product Designer'), '#### Product Designer : Octopus Energy');
  assert.equal(head('Doctolib — Product Designer'), '#### Product Designer : Doctolib');
  assert.equal(head('Salesforce — Account Executive'), '#### Account Executive : Salesforce');
  assert.equal(head("Chargée de communication — L'Oréal"), "#### Chargée de communication : L'Oréal");
  assert.equal(head('Développeuse front-end — Qonto'), '#### Développeuse front-end : Qonto');
  assert.equal(head('Software Engineer', '**Google**\n2019 – 2021'), '#### Software Engineer : Google (2019 – 2021)');
  assert.equal(head('Acme — Paris'), '#### — : Acme — Paris', 'neither side is a title: kept whole');
  const paris = indexCareer('# J\n## Summary\nx\n## Experience\n### Acme — Paris\n2019 – 2021\n- did\n');
  assert.equal(workedAtCompany('Paris Saint-Germain', paris.employerNames), false);
  assert.equal(workedAtCompany('Acme', paris.employerNames), true);
  assert.equal(head('Headspace | Content Writer | 2014 – 2016'), '#### Content Writer : Headspace (2014 – 2016)');
  const tenure = indexCareer('# J\n## Summary\nx\n## Experience\n### Headspace | Content Writer | 2014 – 2016\n- did\n');
  assert.equal(roleTenureYears(tenure.employers[0]), 2);
});

test('PB-5: a promotion under one "### Company" keeps both roles and their dates', () => {
  const bold = normalizeCvDialect('# J\n## Summary\nx\n## Experience\n### Acme\n**Senior Designer**\n2020 – 2023\n- Led the design system\n**Designer**\n2017 – 2020\n- Shipped onboarding\n');
  assert.match(bold, /^#### Senior Designer : Acme \(2020 – 2023\)\n- Led the design system$/m);
  assert.match(bold, /^#### Designer : Acme \(2017 – 2020\)\n- Shipped onboarding$/m);
  const sub = '# J\n## Summary\nx\n## Experience\n### Acme\n#### UX Designer : Acme (2020 – 2022)\n- Led\n#### Junior Designer (2018 – 2020)\n- Shipped\n';
  const normalized = normalizeCvDialect(sub);
  assert.match(normalized, /^#### UX Designer : Acme \(2020 – 2022\)$/m);
  assert.match(normalized, /^#### Junior Designer : Acme \(2018 – 2020\)$/m);
  assert.ok(!/\*[^*\n]*####/.test(normalized), 'no "####" text in a tagline');
  assert.deepEqual(indexCareer(sub).employerNames, ['Acme']);
});

test('PB-6: a bold label is not the job title', () => {
  const cv = '# J\n## Summary\nx\n## Experience\n### Acme\n*Senior Designer* · 2020 – 2023\n**Key achievements:**\n- Led\n';
  const index = indexCareer(cv);
  assert.deepEqual(index.employerNames, ['Acme']);
  assert.equal(workedAtCompany('Acme', index.employerNames), true);
  assert.ok(!/Key achievements: :/.test(candidateFacts(cv)));
  const flat = normalizeCvDialect('# J\n## Summary\nx\n## Experience\n**Senior Designer**, Acme (2020 – 2022)\n**Tools:** Figma\n**Key projects**\n- Led\n');
  assert.match(flat, /^#### Senior Designer : Acme \(2020 – 2022\)$/m);
  assert.match(flat, /^\*\*Tools:\*\* Figma$/m, '"**Tools:** Figma" stays a line');
  assert.match(flat, /^\*\*Key projects\*\*$/m, 'a lone bold label is no role');
});

test('PB-8: education entries keep degree and school on their own sides', () => {
  assert.deepEqual(
    educationFromText('# J\n## Summary\nx\n## Education\n### Strate École de Design\n**Bachelor Design**\n2011 – 2014\n'),
    [{ degree: 'Bachelor Design', school: 'Strate École de Design', start: '2011', end: '2014' }],
  );
  const md = renderCvMarkdown(structured({
    education: [
      { degree: '', school: 'HEC Paris', start: '2012', end: '2014', details: [] },
      { degree: 'Master Management', school: 'ESSEC', start: '', end: '', details: [] },
      { degree: 'MSc Data', school: '', start: '2018', end: '2019', details: [] },
    ],
  }));
  assert.deepEqual(educationFromText(md), [
    { degree: '', school: 'HEC Paris', start: '2012', end: '2014' },
    { degree: 'Master Management', school: 'ESSEC', start: '', end: '' },
    { degree: 'MSc Data', school: '', start: '2018', end: '2019' },
  ]);
  assert.deepEqual(
    educationFromText('# J\n### Education\n- MS Computer Science, UT Austin (2018)\n- Thesis: fraud detection models\n'),
    [{ degree: 'MS Computer Science', school: 'UT Austin', start: '2018', end: '' }],
    'the comma form of the shipped examples; an undated detail line is no degree',
  );
});

test('PB-9: a comma-separated languages line keeps every language', () => {
  const block = languagesFromText('# J\n## Summary\nx\n## Langues\nFrançais (langue maternelle), Anglais (C1), Espagnol (B1)\n');
  assert.deepEqual(block.map(l => `${l.name} (${l.level})`), ['Français (langue maternelle)', 'Anglais (C1)', 'Espagnol (B1)']);
  const one = languagesFromText('# J\n### Languages\n- English : fluent, professional working proficiency\n');
  assert.deepEqual(one.map(l => l.level), ['fluent, professional working proficiency'], 'one language, one row');
  const plain = languagesFromText('Jane\nLanguages\nEnglish (native)\nSpanish (B2)\nInterests\nRunning: marathons\nChess: club level\n');
  assert.deepEqual(plain.map(l => l.name), ['English', 'Spanish'], 'the next section is no language');
});

test('PB-10: a contact or location line under "# Name" is not the title', () => {
  for (const line of [
    'Paris, France · +33 6 12 34 56 78 · linkedin.com/in/janedoe',
    '+33 6 12 34 56 78',
    'janedoe.dev',
    'Lyon, France',
    'Remote · Lyon · Open to relocation',
    'Summary',
    'jane@example.com',
    '**Email:** jane@example.com',
  ]) assert.equal(isHeadlineCandidate(line), false, line);
  for (const line of ['Staff Backend Engineer · Payments', 'Product Designer, Fintech', 'ASP.NET Developer', 'Product Designer since 2014']) {
    assert.equal(isHeadlineCandidate(line), true, line);
  }
  const cv = '# Jane Doe\nParis, France · +33 6 12 34 56 78 · linkedin.com/in/janedoe\n\n## Experience\n### Acme\n**Designer**\n2020 – 2022\n';
  assert.ok(!/Intitulé/.test(candidateFacts(cv)));
});

test('PB-11: certifications and other sections of a converted CV reach the prompts', () => {
  const md = renderCvMarkdown(structured({
    experience: [{ company: 'Acme', title: 'Engineer', start: '2020', end: '2022', location: '', bullets: ['Built it'] }],
    certifications: ['AWS Solutions Architect (2022)', 'PMP (2019)'],
    other_sections: [{ title: 'Volunteering', lines: ['Restos du Coeur, 2018'] }],
  }));
  const lean = compactCv(md);
  for (const fact of ['AWS Solutions Architect', 'PMP', 'Restos du Coeur']) assert.ok(lean.includes(fact), `compactCv keeps ${fact}`);
  assert.ok(indexCareer(md).text.includes('AWS Solutions Architect'));
});

test('PB-12: projects of a converted CV are not listed as positions', () => {
  const facts = candidateFacts(H2_CV);
  const [postes, projets] = facts.split('- Projets (pas des postes) :');
  assert.match(postes, /Staff Engineer : Acme Payments/);
  assert.ok(!/Open Ledger/.test(postes), 'the project is not a Poste');
  assert.match(projets, /Open Ledger : project/);
  assert.ok(indexCareer(H2_CV).sideNames.includes('Open Ledger'));
  assert.ok(!indexCareer(H2_CV).sideNames.includes('project'));
});
