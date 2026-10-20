// HireHive provider — offline fixtures only (fictional tenants).
import test from 'node:test';
import assert from 'node:assert/strict';
import hirehive, { parseHireHivePage } from '../../providers/hirehive.mjs';

const item = (over = {}) => ({ id: 'job_1', title: 'Senior Product Designer', location: 'Cork', state_code: null, country: { name: 'Ireland', code: 'IE' }, published_date: '2026-10-14T15:12:09.627Z', hosted_url: 'https://acme.hirehive.com/senior-product-designer-cork-abc', ...over });
const page = (items, hasNext = false) => ({ meta: { page: 1, page_size: 100, has_next_page: hasNext }, items });

test('hirehive: id + detect on *.hirehive.com only', () => {
  assert.equal(hirehive.id, 'hirehive');
  assert.deepEqual(hirehive.detect({ careers_url: 'https://acme.hirehive.com/' }), { url: 'https://acme.hirehive.com/api/v2/jobs' });
  for (const u of ['http://acme.hirehive.com', 'https://evil.example/acme.hirehive.com', 'https://acme.hirehive.com.evil.io', 'https://www.hirehive.com', 'x', null]) {
    assert.equal(hirehive.detect({ careers_url: u }), null, String(u));
  }
});

test('hirehive: parse normalizes and drops malformed rows; envelope checked', () => {
  const { jobs } = parseHireHivePage(page([item(), item({ title: '' }), item({ hosted_url: 'ftp://x' }), item({ location: 'Draper', state_code: 'UT', country: { name: 'United States' } })]), 'Acme');
  assert.equal(jobs.length, 2);
  assert.deepEqual(jobs[0], { title: 'Senior Product Designer', url: 'https://acme.hirehive.com/senior-product-designer-cork-abc', company: 'Acme', location: 'Cork, Ireland', postedAt: Date.parse('2026-10-14T15:12:09.627Z') });
  assert.equal(jobs[1].location, 'Draper, UT, United States');
  assert.deepEqual(parseHireHivePage(page([]), 'Acme').jobs, []);
  assert.throws(() => parseHireHivePage({ jobs: [] }, 'Acme'), /expected items/);
  assert.throws(() => parseHireHivePage(null, 'Acme'), /expected items/);
});

test('hirehive: follows has_next_page, redirect:error, probe = one request', async () => {
  const calls = [];
  const full = [...Array(100)].map((_, i) => item({ hosted_url: `https://acme.hirehive.com/j-${i}` }));
  const ctx = (maxPages) => ({ sleep: async () => {}, maxPages, fetchJson: async (url, opts) => { calls.push({ url, opts }); return url.includes('page=1&') ? page(full, true) : page([item()], false); } });
  const jobs = await hirehive.fetch({ name: 'Acme', careers_url: 'https://acme.hirehive.com' }, ctx(undefined));
  assert.equal(jobs.length, 101);
  assert.deepEqual(calls.map(c => c.url), ['https://acme.hirehive.com/api/v2/jobs?page=1&page_size=100', 'https://acme.hirehive.com/api/v2/jobs?page=2&page_size=100']);
  assert.ok(calls.every(c => c.opts.redirect === 'error'));
  calls.length = 0;
  await hirehive.fetch({ name: 'Acme', careers_url: 'https://acme.hirehive.com' }, ctx(1));
  assert.equal(calls.length, 1);
  calls.length = 0;
  await assert.rejects(hirehive.fetch({ name: 'X', careers_url: 'https://evil.example' }, ctx(undefined)), /cannot derive/);
  assert.equal(calls.length, 0);
});
