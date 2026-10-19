import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePersonioUrl, parsePersonioFeed, fetchPersonioJobs, htmlToText, personioUrlProblem } from '../lib/personio-careers.mjs';
import { careersFeedFor } from '../lib/careers-feeds.mjs';
import { validatePortalsConfig } from '../validate-portals.mjs';

const XML = readFileSync(new URL('./fixtures/personio-feed.xml', import.meta.url), 'utf8');

test('Personio URL detection: board, /job/<id>, .com, explicit slug; others rejected', () => {
  assert.deepEqual(parsePersonioUrl('https://personio.jobs.personio.de'), { slug: 'personio', host: 'personio.jobs.personio.de' });
  assert.deepEqual(parsePersonioUrl('https://acme.jobs.personio.com/job/123?utm_source=x'), { slug: 'acme', host: 'acme.jobs.personio.com', jobId: '123' });
  assert.equal(parsePersonioUrl('https://acme.com/careers', { slug: 'acme' }).host, 'acme.jobs.personio.de');
  assert.equal(parsePersonioUrl('http://acme.jobs.personio.de'), null);
  assert.equal(parsePersonioUrl('https://jobs.personio.de'), null);
  assert.equal(parsePersonioUrl('https://evil.com/acme.jobs.personio.de'), null);
  assert.equal(careersFeedFor({ careers_url: 'https://acme.jobs.personio.de/' }).id, 'personio');
  assert.equal(careersFeedFor({ careers_url: 'https://yoailabs.careers-page.com/' }).id, 'manatal');
  assert.equal(careersFeedFor({ careers_url: 'https://boards.greenhouse.io/x' }), null);
});

test('feed parsing: entities, CDATA, HTML descriptions, offices, remote, dates, bad positions dropped', () => {
  const jobs = parsePersonioFeed(XML, { companyName: 'Acme', host: 'acme.jobs.personio.de' });
  assert.equal(jobs.length, 2);
  const [a, b] = jobs;
  assert.equal(a.title, 'Senior Product Designer & Researcher');
  assert.equal(a.url, 'https://acme.jobs.personio.de/job/1834171');
  assert.equal(a.company, 'Acme');
  assert.equal(a.location, 'Munich, Berlin');
  assert.equal(a.publishedAt, '2026-10-10T09:00:00+00:00');
  assert.match(a.description, /^The Role: How you'll make an impact\nHybrid in Munich\n\nYou own end-to-end flows & research\. A literal in text\./);
  assert.match(a.description, /- Ship prototypes\n- Run studies/);
  assert.doesNotMatch(a.description, /<|Empty section/);
  assert.equal(a.workMode, undefined);
  assert.equal(b.title, 'UX Designer (Remote, EU)');
  assert.equal(b.location, 'Remote');
  assert.equal(b.workMode, 'remote');
  assert.equal(b.publishedAt, '');
  assert.equal(b.description, '');
});

test('htmlToText strips tags and decodes entities without inventing text', () => {
  assert.equal(htmlToText('<p>A &amp; B</p><p>C&nbsp;D</p>'), 'A & B\nC D');
  assert.equal(htmlToText('<script>alert(1)</script>ok'), 'ok');
});

const res = (status, body = '', headers = {}) => ({ ok: status >= 200 && status < 300, status, text: async () => body, headers: { get: k => headers[k.toLowerCase()] || null } });

test('fetch: XML first (utm stripped, language=en, redirect:error), 429 retried, 404 falls back to the board page', async () => {
  const calls = [];
  let n = 0;
  const fetchImpl = async (url, opts) => { calls.push([url, opts.redirect]); return n++ === 0 ? res(429, '', { 'retry-after': '0' }) : res(200, XML); };
  const r = await fetchPersonioJobs('https://acme.jobs.personio.de/job/1?utm_source=li', { companyName: 'Acme', fetchImpl });
  assert.equal(r.source, 'xml');
  assert.equal(r.jobs.length, 2);
  assert.deepEqual(calls[0], ['https://acme.jobs.personio.de/xml?language=en', 'error']);
  assert.equal(calls.length, 2);

  const html = '<a class="job-box" href="/job/5?language=en"><h3>Product Designer</h3><span class="x_jobMetaText_y">Berlin</span></a>';
  const fb = await fetchPersonioJobs('https://acme.jobs.personio.de', { companyName: 'Acme', fetchImpl: async u => (u.includes('/xml') ? res(404) : res(200, html)) });
  assert.equal(fb.source, 'html');
  assert.deepEqual(fb.jobs.map(j => [j.title, j.url, j.location]), [['Product Designer', 'https://acme.jobs.personio.de/job/5', 'Berlin']]);
});

test('fetch: an empty feed is a clean empty result; errors and non-feed bodies throw (browser fallback)', async () => {
  const empty = await fetchPersonioJobs('https://acme.jobs.personio.de', { fetchImpl: async () => res(200, '<workzag-jobs></workzag-jobs>') });
  assert.deepEqual(empty, { source: 'xml', jobs: [] });
  await assert.rejects(fetchPersonioJobs('https://acme.jobs.personio.de', { fetchImpl: async () => res(403) }), /HTTP 403/);
  await assert.rejects(fetchPersonioJobs('https://acme.jobs.personio.de', { fetchImpl: async () => res(200, '<html>login</html>') }), /unexpected body/);
});

test('validate-portals flags malformed Personio URLs and slugs, warns on websearch for a feed URL', async () => {
  assert.match(personioUrlProblem('https://jobs.personio.de/acme'), /tenant subdomain/);
  assert.equal(personioUrlProblem('https://acme.jobs.personio.de'), null);
  const { errors, warnings } = await validatePortalsConfig({ tracked_companies: [
    { name: 'A', careers_url: 'https://jobs.personio.de/acme' },
    { name: 'B', careers_url: 'https://b.com', personio: 'bad slug!' },
    { name: 'C', careers_url: 'https://c.jobs.personio.de', scan_method: 'websearch', scan_query: 'x' },
  ] });
  assert.ok(errors.some(e => /tracked_companies\[0\]\.careers_url/.test(e.path)));
  assert.ok(errors.some(e => /tracked_companies\[1\]\.personio/.test(e.path)));
  assert.ok(warnings.some(w => /personio feed/.test(w.message)));
});