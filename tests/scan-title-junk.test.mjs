import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isNonJobTitle, withNonJobTitles, NON_JOB_TITLE_INNER } from '../lib/scan-title-junk.mjs';
import { loadPortalsForProfile } from '../lib/scan-targeting.mjs';
import { explainTitle } from '../lib/scan-decision.mjs';

const JUNK = [
  'Skip to Main Content', 'Skip to main navigation', 'Access Careers page', 'Find jobs', 'Find Jobs', 'Find a job',
  'Cancel', 'Create Job Alert', 'Marketer', 'Developer', 'Designer', 'Ing\u00e9nieurs', 'Commerciaux', 'D\u00e9veloppeurs', 'Agency',
  'Emploi Paris', 'Emploi Product Designer Paris', 'Jobs in Bangkok', '54 jobs', 'Product Designer jobs', '27 offres',
];
const REAL = [
  'Product Designer', 'Senior Product Designer', 'Staff Product Designer, AI', 'Senior UX/UI Designer', 'Head of Design',
  'Design Lead, Agents', 'Product Designer (Remote)', 'Lead Product Designer', 'Senior Product Manager, Payments', 'UX Researcher',
  'Product Designer, Growth', 'AI Product Designer - Singapore',
];

test('page chrome, listing headings and category names are not job titles', () => {
  for (const title of JUNK) assert.equal(isNonJobTitle(title), true, title);
});

test('real design and product titles are never caught', () => {
  for (const title of REAL) assert.equal(isNonJobTitle(title), false, title);
});

test('the embedded source works as the anchored group the server and the page script build', () => {
  const base = String.raw`^(?:search\s+jobs|careers\s+at\s+.{1,100})$`;
  const re = new RegExp(withNonJobTitles(base), 'i');
  assert.ok(re.test('Search jobs') && re.test('Skip to Main Content') && re.test('Emploi Paris'));
  assert.ok(!re.test('Staff Product Designer'));
  assert.ok(NON_JOB_TITLE_INNER.length > 100);
});

test('the title filter alone already refuses the junk, so a junk count is not a filter pass', () => {
  const tf = loadPortalsForProfile().title_filter;
  for (const title of JUNK.filter(t => !/design/i.test(t))) assert.equal(explainTitle(title, tf).ok, false, title);
});

test('a search heading that holds design words does pass the title filter, which is why it is dropped as non-job', () => {
  const tf = loadPortalsForProfile().title_filter;
  for (const title of ['Emploi Product Designer Paris', 'Product Designer jobs']) {
    assert.equal(explainTitle(title, tf).ok, true, title);
    assert.equal(isNonJobTitle(title), true, title);
  }
});

test('the server and the Playwright scraper wire the junk list into every careers path', () => {
  const server = readFileSync(new URL('../ui/server.mjs', import.meta.url), 'utf8');
  const scraper = readFileSync(new URL('../lib/scan-careers-page.mjs', import.meta.url), 'utf8');
  assert.match(server, /withNonJobTitles\(CAREER_NAVIGATION_TITLE_BASE_SOURCE\)/);
  assert.match(server, /return !isNonJobTitle\(value\)/);
  assert.equal((server.match(/jobs = dropNonJobTitles\(jobs,/g) || []).length, 2);
  assert.match(scraper, /nonJob\.test\(text\)/);
});
