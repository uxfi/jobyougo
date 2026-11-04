// Contact finder, 2026-11-04: provider name lookups capped and cached, the
// kept guesses checked by the provider's verifier.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_PROVIDER_FINDS,
  MAX_VERIFY_CALLS,
  findContacts,
  hunterProvider,
  pageText,
} from '../lib/contact-finder.mjs';

const siteFetcher = pages => async (url) => {
  const html = pages[String(url).replace(/\/$/, '')];
  return html ? { ok: true, status: 200, html, text: pageText(html), url } : { ok: false, status: 404, html: '', text: '', url };
};
const acme = (team) => siteFetcher({
  'https://acme.io': '<a href="/team">Team</a><p>Acme builds payroll software for small teams in Europe.</p>',
  'https://acme.io/team': team,
});
const run = (fetchPage, options = {}) => findContacts({ company: 'Acme', role: 'Product Designer', companyUrlHint: 'https://acme.io' }, {
  fetchPage, resolveMx: async () => true, providerOutages: new Map(), providerCache: new Map(), ...options,
});
// A verifier that knows which addresses exist; every call is logged.
const verifier = (valid, { catchAll = false } = {}) => {
  const calls = [];
  return {
    calls,
    provider: {
      name: 'checker',
      async verifyEmail(email) {
        calls.push(email);
        if (catchAll) return { status: 'likely', catchAll: true };
        return { status: valid.includes(email) ? 'verified' : 'invalid' };
      },
    },
  };
};

test('2026-11-04: a guess the verifier confirms is found and drafted for; a bouncing spelling gives way to its alternative', async () => {
  const check = verifier(['jmartin@acme.io']);
  const out = await run(acme('<p>Julie Martin, Talent Acquisition Manager</p>'), { providers: [check.provider] });
  // julie.martin@ and julie@ bounce, jmartin@ exists.
  assert.deepEqual(check.calls, ['julie.martin@acme.io', 'julie@acme.io', 'jmartin@acme.io']);
  assert.equal(out.best?.email, 'jmartin@acme.io');
  assert.equal(out.best.confidence, 'verified');
  assert.equal(out.best.status, 'found');
  assert.ok(out.best.sources.some(source => source.type === 'provider' && source.url === 'checker'));
  assert.ok(!out.contacts.some(contact => ['julie.martin@acme.io', 'julie@acme.io'].includes(contact.email)));
});

test('2026-11-04: a guess whose every spelling bounces is dropped', async () => {
  const check = verifier([]);
  const out = await run(acme('<p>Julie Martin, Talent Acquisition Manager</p>'), { providers: [check.provider] });
  assert.equal(check.calls.length, 3);
  assert.ok(!out.contacts.some(contact => contact.firstName === 'Julie'));
  assert.equal(out.best, null);
  assert.ok(out.notes.some(note => note.includes('invalides')));
});

test('2026-11-04: a catch-all domain leaves the guesses as guesses and is asked once', async () => {
  const check = verifier([], { catchAll: true });
  const out = await run(acme('<p>Julie Martin, Talent Acquisition Manager</p><p>Marc Petit, Head of Design</p>'), { providers: [check.provider] });
  assert.equal(check.calls.length, 1);
  const guesses = out.contacts.filter(contact => contact.kind === 'person');
  assert.ok(guesses.length >= 2);
  for (const contact of guesses) {
    assert.equal(contact.status, 'guessed');
    assert.ok(contact.tags.includes('domaine catch-all'));
  }
  assert.equal(out.best, null);
  assert.ok(out.notes.some(note => note.includes('accepte toutes les adresses')));
});

test('2026-11-04: name lookups go to the first people in line only, checks stay within their budget', async () => {
  const finds = [];
  const verifies = [];
  const provider = {
    name: 'finder',
    async findEmail({ firstName, lastName }) { finds.push(`${firstName} ${lastName}`); return { email: '', status: 'notfound' }; },
    async verifyEmail(email) { verifies.push(email); return { status: 'invalid' }; },
  };
  const team = [
    'Julie Martin, Talent Acquisition Manager', 'Marc Petit, Head of Design', 'Anne Dubois, Head of Product',
    'Paul Durand, Head of Sales', 'Léa Roux, Head of Finance', 'Hugo Blanc, Head of Marketing',
  ].map(line => `<p>${line}</p>`).join('');
  await run(acme(team), { providers: [provider] });
  assert.equal(finds.length, MAX_PROVIDER_FINDS);
  // Recruiter and the role's leads first; sales, finance and marketing never cost a lookup.
  assert.ok(!finds.some(name => /Durand|Roux|Blanc/.test(name)));
  assert.ok(verifies.length <= MAX_VERIFY_CALLS);
  assert.ok(!verifies.some(email => /durand|roux|blanc/.test(email)));
});

test('2026-11-04: provider answers are reused from the cache on the next run', async () => {
  const calls = [];
  const provider = {
    name: 'finder',
    async findEmail() { calls.push('find'); return { email: '', status: 'notfound' }; },
    async verifyEmail(email) { calls.push(`verify ${email}`); return { status: email === 'julie.martin@acme.io' ? 'verified' : 'invalid' }; },
  };
  const providerCache = new Map();
  const fetchPage = acme('<p>Julie Martin, Talent Acquisition Manager</p>');
  const first = await run(fetchPage, { providers: [provider], providerCache });
  const before = calls.length;
  const second = await run(fetchPage, { providers: [provider], providerCache });
  assert.ok(before > 0);
  assert.equal(calls.length, before);
  assert.equal(first.best?.email, 'julie.martin@acme.io');
  assert.equal(second.best?.email, 'julie.martin@acme.io');
});

test('2026-11-04: Hunter\'s verifier reports accept_all as a catch-all', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ data: { status: 'accept_all' } }) });
  const answer = await hunterProvider({ apiKey: 'test', fetchImpl }).verifyEmail('julie@acme.io');
  assert.equal(answer.catchAll, true);
  assert.notEqual(answer.status, 'verified');
  const valid = await hunterProvider({ apiKey: 'test', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ data: { status: 'valid' } }) }) }).verifyEmail('julie@acme.io');
  assert.deepEqual([valid.status, valid.catchAll], ['verified', false]);
});
