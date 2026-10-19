import test from 'node:test';
import assert from 'node:assert/strict';
import { parseManatalUrl, parseManatalApi, parseManatalHtml, fetchManatalJobs, isManatalUrl } from '../lib/manatal-careers.mjs';

test('url parsing: path vs subdomain', () => {
  assert.deepEqual(parseManatalUrl('https://www.careers-page.com/bukalapak'), { kind: 'path', slug: 'bukalapak', base: 'https://www.careers-page.com' });
  assert.equal(parseManatalUrl('https://yoailabs.careers-page.com/').kind, 'subdomain');
  assert.equal(isManatalUrl('https://example.com/careers'), false);
  assert.equal(isManatalUrl('https://evilcareers-page.com/x'), false);
});

test('api results map to job urls', () => {
  const jobs = parseManatalApi({ results: [{ hash: 'L557WY85', position_name: 'Product Designer', city: 'Jakarta', country: 'Indonesia' }, { hash: '', position_name: 'x' }] }, 'bukalapak');
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].url, 'https://www.careers-page.com/bukalapak/job/L557WY85');
  assert.equal(jobs[0].location, 'Jakarta, Indonesia');
});

const CARD = (id, title) => `<a href="/jobs/${id}" class="job-title-link" data-job-id="${id}" data-job-title="${title}" data-job-city="New York" data-job-country="United States"><h6>${title}</h6></a><a href="jobs/${id}/apply" class="btn" data-job-title="${title}">Apply</a>`;
const ID = n => `0e8b28b7-b487-4e20-aee1-${String(n).padStart(12, '0')}`;

test('html cards parse once per job, ignoring apply/refer links', () => {
  const jobs = parseManatalHtml(CARD(ID(1), 'UI/UX Designer &amp; Research'), 'https://yoailabs.careers-page.com');
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, 'UI/UX Designer & Research');
  assert.equal(jobs[0].url, `https://yoailabs.careers-page.com/jobs/${ID(1)}`);
});

test('subdomain fetch uses server-side search, paginates and dedupes', async () => {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(url);
    const page = Number(new URL(url).searchParams.get('page'));
    const html = page === 1 ? Array.from({ length: 10 }, (_, i) => CARD(ID(i), `Designer ${i}`)).join('') : CARD(ID(0), 'Designer 0');
    return { ok: true, text: async () => html };
  };
  const { jobs, source } = await fetchManatalJobs('https://yoailabs.careers-page.com/', { fetchImpl, searchTerms: ['designer'], spacingMs: 0 });
  assert.equal(source, 'html-search');
  assert.equal(jobs.length, 10);
  assert.ok(calls[0].includes('search=designer'));
});

test('path fetch follows the JSON api pagination', async () => {
  const pages = { 'https://www.careers-page.com/api/v1.0/c/bukalapak/jobs/': { next: 'https://www.careers-page.com/api/v1.0/c/bukalapak/jobs/?page=2', results: [{ hash: 'A1', position_name: 'A' }] }, 'https://www.careers-page.com/api/v1.0/c/bukalapak/jobs/?page=2': { next: null, results: [{ hash: 'B2', position_name: 'B' }] } };
  const fetchImpl = async url => ({ ok: true, text: async () => JSON.stringify(pages[url]) });
  const { jobs, source } = await fetchManatalJobs('https://www.careers-page.com/bukalapak', { fetchImpl });
  assert.equal(source, 'api');
  assert.equal(jobs.length, 2);
});

test('http failure throws so the caller can fall back to the browser', async () => {
  await assert.rejects(fetchManatalJobs('https://yoailabs.careers-page.com/', { fetchImpl: async () => ({ ok: false, status: 429 }), searchTerms: ['x'], spacingMs: 0 }), /429/);
});
test('mid-way 429 keeps partial results', async () => {
  let n = 0;
  const fetchImpl = async () => (n++ ? { ok: false, status: 429 } : { ok: true, text: async () => Array.from({ length: 10 }, (_, i) => CARD(ID(i), 'D' + i)).join('') });
  const r = await fetchManatalJobs('https://yoailabs.careers-page.com/', { fetchImpl, searchTerms: ['a'], spacingMs: 0 });
  assert.equal(r.partial, true);
  assert.equal(r.jobs.length, 10);
});
