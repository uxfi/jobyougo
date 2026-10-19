import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanJobDescriptionText } from '../lib/jd-clean.mjs';
import { identityFromManatalHtml } from '../lib/manatal-careers.mjs';
import { isContactConsent } from '../lib/apply-fill-guards.mjs';

const JD = [
  'Product Designer',
  'We are hiring a Product Designer to own end-to-end flows for our consumer and merchant apps.',
  ...Array.from({ length: 40 }, (_, i) => `Responsibility ${i}: design, prototype and ship flows with engineering, measuring adoption and iterating on research findings.`),
].join('\n');
const NAV = ['Skip to main content', 'Menu', 'Careers', 'Jobs', 'Log in', 'We use cookies to improve your experience', 'Accept all', 'Find jobs', 'English'];
const FOOT = ['Similar jobs', 'Graphic Designer', 'QA Engineer', 'Follow us', 'LinkedIn', 'Privacy policy', '© 2026 Acme. All rights reserved.'];
const filler = Array.from({ length: 300 }, (_, i) => `Navigation entry number ${i} of the mega menu`).join('\n');

test('a long page is cut down to the posting, nothing is added', () => {
  const page = [...NAV, filler, 'About the role', JD, ...FOOT, filler].join('\n');
  assert.ok(page.length > 15000);
  const out = cleanJobDescriptionText(page, { title: 'Product Designer' });
  assert.ok(out.length < page.length / 3);
  assert.match(out, /^About the role\nProduct Designer/);
  assert.match(out, /Responsibility 39/);
  assert.doesNotMatch(out, /mega menu|Similar jobs|cookies|Privacy policy|Follow us|QA Engineer/);
  // only removal: every output line exists in the input
  const input = new Set(page.split('\n').map(l => l.replace(/\s+/g, ' ').trim()));
  for (const line of out.split('\n')) assert.ok(!line || input.has(line), line);
});

test('short pages are returned untouched, and an over-aggressive cut falls back to the original', () => {
  const short = 'About the role\nDesign things.\nApply now';
  assert.equal(cleanJobDescriptionText(short), short);
  const junkOnly = Array.from({ length: 400 }, () => 'Menu').join('\n') + '\n' + 'x '.repeat(4000);
  assert.equal(cleanJobDescriptionText(junkOnly, { minLength: 100 }).length > 0, true);
});

test('without a description heading the boilerplate lines are still removed', () => {
  const page = [...NAV, JD, JD.replace(/Responsibility/g, 'Duty'), ...FOOT].join('\n') + '\n' + 'filler words '.repeat(500);
  const out = cleanJobDescriptionText(page, { minLength: 1000 });
  assert.doesNotMatch(out, /Skip to main content|Accept all/);
  assert.match(out, /Responsibility 0/);
});

test('careers-page.com identity: subdomain title | company, JSON-LD first, path style', () => {
  const sub = '<title>Graphic designer - Remote | YO AI Labs</title><meta property="og:title" content="Graphic designer - Remote | YO AI Labs" /><h1>Creative &amp; Design Specialist</h1>';
  assert.deepEqual(identityFromManatalHtml(sub, 'https://yoailabs.careers-page.com/jobs/b7e44713-1293-45c4-b8d6-9aa752e0fdf4'), { title: 'Graphic designer - Remote', company: 'YO AI Labs' });
  const ld = `<script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', title: 'Senior Product Designer', hiringOrganization: { name: 'Acme' }, jobLocation: { address: { addressLocality: 'Bangkok', addressCountry: 'Thailand' } } })}</script><title>x | y</title>`;
  assert.deepEqual(identityFromManatalHtml(ld, 'https://acme.careers-page.com/jobs/x'), { title: 'Senior Product Designer', company: 'Acme', location: 'Bangkok, Thailand' });
  const path = '<title>Associate Reporting Manager - Bukalapak | Career Page</title>';
  assert.deepEqual(identityFromManatalHtml(path, 'https://www.careers-page.com/bukalapak/job/L557WY85'), { title: 'Associate Reporting Manager', company: 'Bukalapak' });
  assert.deepEqual(identityFromManatalHtml('<title> - Bukalapak | Career Page</title>', 'https://www.careers-page.com/bukalapak'), { company: 'Bukalapak' }, 'a listing page has no job title');
  assert.equal(identityFromManatalHtml('', 'https://x.careers-page.com/jobs/1').title, undefined);
});

test('"contact me about other roles" is the talent-pool consent, not a marketing/SMS opt-in', () => {
  const box = text => ({ type: 'checkbox', label: text, name: text });
  assert.equal(isContactConsent(box('Companies may contact me about other roles')), false);
  assert.equal(isContactConsent(box('We may contact you about future opportunities')), false);
  assert.equal(isContactConsent(box('Yes, AssessFirst can use my phone number to contact me by SMS')), true);
  assert.equal(isContactConsent(box('Subscribe to our newsletter')), true);
});