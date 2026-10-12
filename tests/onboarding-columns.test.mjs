// The onboarding reads a PDF CV in the browser and rebuilds its lines from the
// text positions. splitColumns() reads a sidebar CV one column at a time; it
// used to split label/value tables too (Europass, moderncv, dates on the right
// margin), sending every label away from its value. The two functions live in
// ui/onboarding.html (no build step), between the columns:start/end markers:
// this suite runs that block on synthetic pdf.js items.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const page = readFileSync(join(ROOT, 'ui/onboarding.html'), 'utf8');
const START = '/* columns:start */';
const END = '/* columns:end */';

function loadColumns() {
  assert.equal(page.split(START).length - 1, 1, 'one columns:start marker');
  assert.equal(page.split(END).length - 1, 1, 'one columns:end marker');
  const source = page.slice(page.indexOf(START), page.indexOf(END));
  // The block must stand alone: it runs here without the rest of the page.
  return new Function(`'use strict';\n${source}\nreturn { splitColumns, itemsToLines };`)();
}
const { splitColumns, itemsToLines } = loadColumns();

// Synthetic pdf.js text items: y is the baseline in PDF points (up is +).
const PAGE = { width: 595, height: 842 };
const item = (x, y, str, h = 10, w = str.length * h * 0.5) => ({ str, x, y, w, h, eol: false });
function column(x, top, leading, h, lines) {
  const out = [];
  lines.forEach((line, i) => { if (line) out.push(item(x, top - i * leading, line, h)); });
  return out;
}
const read = (items) => splitColumns(items, PAGE.width, PAGE.height).map(itemsToLines).filter(Boolean).join('\n\n');

const SIDEBAR = [
  'CONTACT', 'jane.smith@example.com', '+33 6 12 34 56 78', 'Paris, France', 'linkedin.com/in/janesmith', '',
  'SKILLS', 'Figma', 'Prototyping', 'User research', 'Design systems', 'Accessibility (WCAG)', 'Workshop facilitation', '',
  'TOOLS', 'Notion', 'Jira', 'Maze', '',
  'LANGUAGES', 'French (native)', 'English (C1)', 'Spanish (B1)', '',
  'EDUCATION', 'Master in Interaction Design', 'ENSCI Les Ateliers, 2014', '',
  'INTERESTS', 'Ceramics', 'Trail running',
];
const MAIN = [
  'SUMMARY',
  'Product designer with 9 years of experience in B2B SaaS and fintech,',
  'leading research, prototyping and design systems for teams of 20.',
  '',
  'EXPERIENCE',
  'Senior Product Designer, Acme SAS (2021 - Present)',
  '- Redesigned the onboarding flow, lifting activation by 18 percent.',
  '- Built the design system used by six product squads every day.',
  '- Ran forty user interviews a quarter with the research team.',
  'Product Designer, Beta Corp (2017 - 2021)',
  '- Shipped the mobile banking app to 300,000 customers in France.',
  '- Cut support tickets by a quarter with a new help centre flow.',
  'Junior Designer, Gamma Studio (2015 - 2017)',
  '- Designed marketing sites and brand kits for twelve clients.',
  '',
  'PROJECTS',
  'Open-source icon set with 2,000 stars on GitHub.',
  'Talk at Paris Web 2023 on accessible design systems.',
  '',
  'CERTIFICATIONS',
  'Nielsen Norman UX Certificate (2019)',
  'Google UX Design Certificate (2018)',
];
// The sidebar uses a smaller font and its own leading, as sidebar CVs do.
const sidebarPage = (top = 780) => [...column(36, top, 13, 9, SIDEBAR), ...column(210, top, 15, 10, MAIN)];

function assertColumnsKept(text) {
  const lines = text.split('\n');
  for (const line of MAIN.filter(Boolean)) assert.ok(lines.includes(line), `main line kept whole: ${line}`);
  for (const line of SIDEBAR.filter(Boolean)) assert.ok(lines.includes(line), `sidebar line kept whole: ${line}`);
  // Each column is read in one piece: the whole sidebar, then the whole main column.
  assert.ok(lines.indexOf('Trail running') < lines.indexOf('SUMMARY'), 'sidebar before the main column');
  assert.ok(lines.indexOf('CONTACT') < lines.indexOf('Trail running'));
  assert.ok(lines.indexOf('SUMMARY') < lines.indexOf('Google UX Design Certificate (2018)'));
}

test('a sidebar CV is read one column at a time', () => {
  const items = sidebarPage();
  assert.equal(splitColumns(items, PAGE.width, PAGE.height).length, 2);
  const text = read(items);
  assertColumnsKept(text);
  assert.ok(text.startsWith('CONTACT\n'), text.slice(0, 80));
});

test('a full-width header above two columns is read first, then each column', () => {
  const centred = (y, str, h) => { const w = str.length * h * 0.5; return item(297.5 - w / 2, y, str, h, w); };
  const items = [
    centred(800, 'Jane Smith', 20),
    centred(776, 'Senior Product Designer', 12),
    // Centred under the name: it starts in the gutter, left of the main column.
    centred(755, 'jane.smith@example.com · +33 6 12 34 56 78 · Paris, France', 9),
    ...sidebarPage(700),
  ];
  assert.equal(splitColumns(items, PAGE.width, PAGE.height).length, 3);
  const text = read(items);
  const lines = text.split('\n');
  assert.deepEqual(lines.slice(0, 3), ['Jane Smith', 'Senior Product Designer', 'jane.smith@example.com · +33 6 12 34 56 78 · Paris, France']);
  assert.equal(lines[3], '', 'blank line after the header');
  assert.equal(lines[4], 'CONTACT');
  assertColumnsKept(text);
});

test('a classic Europass page (right-aligned labels) is not split from its values', () => {
  const rows = [
    ['Personal information', 'Jane Smith'],
    ['Address', '12 rue de la Paix, 75002 Paris, France'],
    ['Telephone', '+33 6 12 34 56 78'],
    ['E-mail', 'jane.smith@example.com'],
    ['Nationality', 'French'],
    ['Work experience', ''],
    ['Dates', 'March 2021 - present'],
    ['Occupation or position held', 'Senior Product Designer'],
    ['Main activities and responsibilities', ['Lead designer of the onboarding and payments flows,', 'design system owner, research with forty users a quarter']],
    ['Name and address of employer', 'Acme SAS, 4 avenue de France, 75013 Paris'],
    ['Type of business or sector', 'Software publishing (B2B SaaS)'],
    ['Dates', 'September 2017 - February 2021'],
    ['Occupation or position held', 'Product Designer'],
    ['Main activities and responsibilities', ['Mobile banking app for 300,000 customers,', 'help centre redesign that cut support tickets by a quarter']],
    ['Name and address of employer', 'Beta Corp, 8 rue Lafayette, 75009 Paris'],
    ['Type of business or sector', 'Banking and financial services'],
    ['Education and training', ''],
    ['Dates', '2012 - 2014'],
    ['Title of qualification awarded', 'Master in Interaction Design'],
    ['Name of the organisation', 'ENSCI Les Ateliers, Paris'],
    ['Personal skills', ''],
    ['Mother tongue(s)', 'French'],
    ['Other language(s)', 'English (C1), Spanish (B1)'],
    ['Computer skills', 'Figma, Sketch, Notion, Jira, Maze, HTML and CSS'],
    ['Driving licence', 'B'],
  ];
  const items = [];
  let y = 800;
  for (const [label, value] of rows) {
    const w = label.length * 8 * 0.5;
    items.push(item(185 - w, y, label, 8, w));
    const values = Array.isArray(value) ? value : [value];
    values.forEach((v, i) => { if (v) items.push(item(200, y - i * 12, v, 10)); });
    y -= 12 * Math.max(1, values.length) + 8;
  }
  assert.equal(splitColumns(items, PAGE.width, PAGE.height).length, 1);
  const lines = read(items).split('\n');
  assert.ok(lines.includes('Occupation or position held Senior Product Designer'), 'label beside its value');
  assert.ok(lines.includes('Mother tongue(s) French'));
  assert.ok(lines.includes('Dates September 2017 - February 2021'));
  assert.ok(lines.includes('Main activities and responsibilities Lead designer of the onboarding and payments flows,'));
});

test('moderncv dates and labels in a left column stay beside their entries', () => {
  const rows = [
    ['2014 - 2016', 'Master in Interaction Design, ENSCI Les Ateliers'],
    ['2011 - 2014', 'Bachelor in Graphic Design, Ecole Estienne'],
    ['2021 - now', 'Senior Product Designer, Acme SAS'],
    ['2017 - 2021', 'Product Designer, Beta Corp'],
    ['2015 - 2017', 'Junior Designer, Gamma Studio'],
    ['French', 'Native'],
    ['English', 'C1, professional'],
    ['Spanish', 'B1'],
    ['German', 'A2'],
    ['Design', 'Figma, prototyping, design systems'],
    ['Research', 'Interviews, usability tests'],
    ['Front-end', 'HTML, CSS'],
    ['2019', 'Nielsen Norman UX Certificate'],
    ['2018', 'Google UX Design Certificate'],
    ['2023', 'Talk at Paris Web'],
    ['2022', 'Open-source icon set'],
    ['Hobbies', 'Ceramics, trail running'],
    ['Volunteering', 'Design mentor at ADA'],
    ['Driving', 'Licence B'],
    ['Location', 'Paris, France'],
  ];
  const items = [];
  rows.forEach(([label, value], i) => {
    const w = label.length * 10 * 0.5;
    items.push(item(140 - w, 790 - i * 22, label, 10, w));
    items.push(item(150, 790 - i * 22, value, 10));
  });
  assert.equal(splitColumns(items, PAGE.width, PAGE.height).length, 1);
  const lines = read(items).split('\n');
  assert.ok(lines.includes('2014 - 2016 Master in Interaction Design, ENSCI Les Ateliers'));
  assert.ok(lines.includes('English C1, professional'));
  assert.ok(lines.includes('French Native'));
});

test('dates aligned on the right margin stay on the line of their role', () => {
  const roles = [
    ['Senior Product Designer, Acme', 'Mar 2021 - Present', '- Led the design system'],
    ['Product Designer, Beta Corp', 'Sep 2017 - Feb 2021', '- Shipped the banking app'],
    ['Junior Designer, Gamma', 'Jan 2015 - Aug 2017', '- Brand kits for clients'],
    ['Design Intern, Delta', 'Jun 2014 - Dec 2014', '- Icon set and illustrations'],
    ['Teaching Assistant, ENSCI', 'Sep 2013 - Jun 2014', '- Ran weekly studio reviews'],
    ['Freelance Designer', 'Jan 2012 - Aug 2013', '- Websites for small shops'],
    ['Master, ENSCI Les Ateliers', 'Sep 2012 - Jun 2014', '- Interaction design'],
    ['Bachelor, Ecole Estienne', 'Sep 2009 - Jun 2012', '- Graphic design'],
  ];
  const items = [];
  roles.forEach(([title, dates, bullet], i) => {
    const y = 790 - i * 46;
    const w = dates.length * 10 * 0.5;
    items.push(item(56, y, title, 10));
    items.push(item(539 - w, y, dates, 10, w));
    items.push(item(66, y - 15, bullet, 10));
  });
  assert.equal(splitColumns(items, PAGE.width, PAGE.height).length, 1);
  const lines = read(items).split('\n');
  assert.ok(lines.includes('Senior Product Designer, Acme | Mar 2021 - Present'));
  assert.ok(lines.includes('Bachelor, Ecole Estienne | Sep 2009 - Jun 2012'));
  assert.equal(lines[1], '- Led the design system', 'the bullet follows its role');
});

test('a short page is read as rows', () => {
  const items = column(56, 790, 15, 10, ['Jane Smith', 'Product designer', 'Paris']);
  assert.deepEqual(splitColumns(items, PAGE.width, PAGE.height), [items]);
  assert.equal(itemsToLines(items), 'Jane Smith\nProduct designer\nParis');
});
