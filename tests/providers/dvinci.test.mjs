// d.vinci provider — offline fixtures only (fictional tenants).
import test from 'node:test';
import assert from 'node:assert/strict';
import dvinci, { parseDvinciResponse } from '../../providers/dvinci.mjs';

const pub = (over = {}) => ({ id: 1, position: 'Software Engineer (m/w/d)', jobPublicationURL: 'https://acme.dvinci-hr.com/de/jobs/1/software-engineer', jobOpening: { locations: [{ name: 'Berlin' }, { name: 'Hamburg' }, { name: 'Berlin' }], createdDate: '2026-10-14T15:15:49.906Z' }, ...over });

test('dvinci: id + detect on *.dvinci-hr.com only', () => {
  assert.equal(dvinci.id, 'dvinci');
  assert.deepEqual(dvinci.detect({ careers_url: 'https://acme.dvinci-hr.com/de/jobs' }), { url: 'https://acme.dvinci-hr.com/jobPublication/list.json' });
  for (const u of ['http://acme.dvinci-hr.com', 'https://evil.example/acme.dvinci-hr.com', 'https://acme.dvinci-hr.com.evil.io', 'https://www.dvinci-hr.com', 'x', undefined]) {
    assert.equal(dvinci.detect({ careers_url: u }), null, String(u));
  }
});

test('dvinci: parse normalizes, dedups locations, drops malformed rows; envelope checked', () => {
  const jobs = parseDvinciResponse([pub(), pub({ position: '' }), pub({ jobPublicationURL: 'javascript:x' }), pub({ jobOpening: { location: 'throughout Germany' } })], 'Acme');
  assert.equal(jobs.length, 2);
  assert.deepEqual(jobs[0], { title: 'Software Engineer (m/w/d)', url: 'https://acme.dvinci-hr.com/de/jobs/1/software-engineer', company: 'Acme', location: 'Berlin / Hamburg', postedAt: Date.parse('2026-10-14T15:15:49.906Z') });
  assert.equal(jobs[1].location, 'throughout Germany');
  assert.equal(jobs[1].postedAt, undefined);
  assert.deepEqual(parseDvinciResponse([], 'Acme'), []);
  assert.throws(() => parseDvinciResponse({ items: [] }, 'Acme'), /expected an array/);
});

test('dvinci: one request with redirect:error; untrusted host never fetches', async () => {
  const calls = [];
  const ctx = { sleep: async () => {}, fetchJson: async (url, opts) => { calls.push({ url, opts }); return [pub()]; } };
  const jobs = await dvinci.fetch({ name: 'Acme', careers_url: 'https://acme.dvinci-hr.com/' }, ctx);
  assert.equal(jobs.length, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.redirect, 'error');
  calls.length = 0;
  await assert.rejects(dvinci.fetch({ name: 'X', careers_url: 'https://evil.example' }, ctx), /cannot derive/);
  assert.equal(calls.length, 0);
});
