// Traffit provider — offline fixtures only (fictional tenants).
import test from 'node:test';
import assert from 'node:assert/strict';
import traffit, { parseTraffitPage } from '../../providers/traffit.mjs';

const post = (over = {}) => ({
  url: 'https://acme.traffit.com/public/an/abc123?source=career_page', id: 1, awarded: false,
  valid_start: '2026-10-01 10:00:00',
  advert: { name: 'Senior Product Designer', values: [{ field_id: 'geolocation', value: JSON.stringify({ locality: 'Warszawa', country: 'Polska' }) }] },
  options: { remote: '0' }, ...over,
});

function ctxFor(pages, { totalPages, calls }) {
  return {
    sleep: async () => {},
    fetchResponse: async (url, opts) => {
      calls.push({ url, opts });
      const page = Number(opts.headers['X-Request-Current-Page']);
      const body = pages[page - 1] ?? [];
      const headers = new Headers(totalPages === undefined ? {} : { 'x-result-total-pages': String(totalPages) });
      return new Response(JSON.stringify(body), { status: 200, headers });
    },
  };
}

test('traffit: id + detect on *.traffit.com only', () => {
  assert.equal(traffit.id, 'traffit');
  assert.deepEqual(traffit.detect({ careers_url: 'https://acme.traffit.com/career/' }), { url: 'https://acme.traffit.com/public/job_posts/published' });
  for (const u of ['http://acme.traffit.com', 'https://evil.example/acme.traffit.com', 'https://acme.traffit.com.evil.io', 'https://cdn3.traffit.com/x', 'https://www.traffit.com', 'not a url', null, 7]) {
    assert.equal(traffit.detect({ careers_url: u }), null, String(u));
  }
  assert.equal(traffit.detect({}), null);
});

test('traffit: parse normalizes, skips awarded and malformed rows', () => {
  const jobs = parseTraffitPage([
    post(), post({ awarded: true, url: 'https://acme.traffit.com/public/an/x2' }),
    post({ advert: { name: '' } }), post({ url: 'http://acme.traffit.com/x' }),
    post({ url: 'https://acme.traffit.com/public/an/r', options: { remote: '1' }, advert: { name: 'Engineer', values: [] } }),
  ], 'Acme');
  assert.equal(jobs.length, 2);
  assert.deepEqual(jobs[0], { title: 'Senior Product Designer', url: 'https://acme.traffit.com/public/an/abc123?source=career_page', company: 'Acme', location: 'Warszawa, Polska', postedAt: Date.parse('2026-10-01T00:00:00Z') });
  assert.equal(jobs[1].location, 'Remote');
  assert.deepEqual(parseTraffitPage([], 'Acme'), []);
  assert.throws(() => parseTraffitPage({ jobs: [] }, 'Acme'), /expected an array/);
  assert.throws(() => parseTraffitPage('', 'Acme'), /expected an array/);
});

test('traffit: paginates via request headers, redirect:error, stops on total pages', async () => {
  const calls = [];
  const full = [...Array(100)].map((_, i) => post({ url: `https://acme.traffit.com/public/an/p${i}` }));
  const jobs = await traffit.fetch({ name: 'Acme', careers_url: 'https://acme.traffit.com' }, ctxFor([full, [post()]], { totalPages: 2, calls }));
  assert.equal(jobs.length, 101);
  assert.equal(calls.length, 2);
  for (const c of calls) {
    assert.equal(c.opts.redirect, 'error');
    assert.equal(c.opts.headers['X-Request-Page-Size'], '100');
    assert.equal(c.url, 'https://acme.traffit.com/public/job_posts/published');
  }
  assert.deepEqual(calls.map(c => c.opts.headers['X-Request-Current-Page']), ['1', '2']);
});

test('traffit: probe (maxPages:1) issues exactly one request; untrusted host never fetches', async () => {
  const calls = [];
  const full = [...Array(100)].map((_, i) => post({ url: `https://acme.traffit.com/public/an/p${i}` }));
  await traffit.fetch({ name: 'Acme', careers_url: 'https://acme.traffit.com' }, { ...ctxFor([full, full], { totalPages: 5, calls }), maxPages: 1 });
  assert.equal(calls.length, 1);
  const none = [];
  await assert.rejects(traffit.fetch({ name: 'X', careers_url: 'https://evil.example' }, ctxFor([], { calls: none })), /cannot derive/);
  assert.equal(none.length, 0);
});
