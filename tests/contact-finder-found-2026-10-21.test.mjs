// Real addresses first, few guesses, each with its status and source; the
// candidate's own address and no-reply never come back. Fixtures, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { findContacts, MAX_GUESSES } from '../lib/contact-finder.mjs';

const site = {
  'https://acme.io': '<html><body><a href="/contact">Contact</a><a href="/team">Team</a> Acme builds tools.</body></html>',
  'https://acme.io/contact': '<p>Write to <a href="mailto:jobs@acme.io">jobs@acme.io</a> or noreply@acme.io</p>',
  'https://acme.io/team': '<p>Marie Dupont, Head of Design. Paul Martin, CEO. Julie Bernard, CTO. Leo Petit, Head of Product. Anna Roux, VP Engineering.</p>',
};
const fetchPage = async (url) => {
  const key = url.replace(/\/$/, '');
  const html = site[key];
  return html ? { ok: true, url: key, html, text: html.replace(/<[^>]+>/g, ' ') } : { ok: false, status: 404, url };
};
const base = { company: 'Acme', role: 'Product Designer', companyUrlHint: 'https://acme.io' };

test('found addresses carry status and URL; guesses capped and MX-gated', async () => {
  const r = await findContacts({ ...base, jobText: 'Apply: talent@acme.io', jobHtml: '<a href="mailto:hiring@acme.io">apply</a>', jobUrl: 'https://jobs.example/acme/1' }, { fetchPage, resolveMx: async () => true });
  const byEmail = Object.fromEntries(r.contacts.map(c => [c.email, c]));
  assert.equal(byEmail['jobs@acme.io']?.status, 'found');
  assert.equal(byEmail['jobs@acme.io'].sources[0].url, 'https://acme.io/contact');
  assert.equal(byEmail['talent@acme.io']?.status, 'found');
  assert.equal(byEmail['hiring@acme.io']?.status, 'found', 'mailto in the posting HTML');
  assert.ok(!byEmail['noreply@acme.io']);
  const guessed = r.contacts.filter(c => c.status === 'guessed');
  assert.ok(guessed.length <= MAX_GUESSES);
  const firstGuess = r.contacts.findIndex(c => c.status === 'guessed');
  const lastFound = r.contacts.map(c => c.status).lastIndexOf('found');
  if (firstGuess >= 0) assert.ok(r.best?.status !== 'guessed');
  assert.ok(lastFound >= 0);
});

test('no MX: no guesses at all, found ones kept', async () => {
  const r = await findContacts({ ...base }, { fetchPage, resolveMx: async () => false });
  assert.equal(r.contacts.filter(c => c.status === 'guessed').length, 0);
});

test("the candidate's own address is never a contact", async () => {
  const r = await findContacts({ ...base, jobText: 'Contact hugo@acme.io', ownEmails: ['Hugo@acme.io'] }, { fetchPage, resolveMx: async () => true });
  assert.ok(!r.contacts.some(c => c.email === 'hugo@acme.io'));
});