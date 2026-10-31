// Real addresses first, few guesses, each with its status and source; the
// candidate's own address and no-reply never come back. Fixtures, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { domainAcceptsMail, findContacts, MAX_GUESSES, mxVerdict, peopleForPage } from '../lib/contact-finder.mjs';

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

// FP4: one person per line, so each is read.
const teamSite = {
  'https://acme.io': '<html><body><a href="/contact">Contact</a><a href="/team">Team</a> Acme builds tools.</body></html>',
  'https://acme.io/contact': '<p>Write to <a href="mailto:jobs@acme.io">jobs@acme.io</a></p>',
  'https://acme.io/team': '<p>Marie Dupont, Head of Design</p><p>Paul Martin, CEO</p><p>Julie Bernard, CTO</p><p>Leo Petit, Head of Product</p><p>Anna Roux, VP Engineering</p>',
};
const teamFetch = async (url) => {
  const key = url.replace(/\/$/, '');
  const html = teamSite[key];
  return html ? { ok: true, url: key, html, text: html.replace(/<[^>]+>/g, '\n') } : { ok: false, status: 404, url };
};

test('MX unknown (DNS error): up to MAX_GUESSES guesses kept and tagged; the cap note names who was left out', async () => {
  const r = await findContacts({ ...base }, { fetchPage: teamFetch, resolveMx: async () => null });
  const guessed = r.contacts.filter(c => c.status === 'guessed');
  assert.equal(guessed.length, MAX_GUESSES);
  assert.ok(guessed.every(c => c.mx === null && c.tags.includes('MX non vérifiable')));
  assert.ok(r.notes.some(note => /au-delà des 3 plus probables \(/.test(note)));
  assert.ok(!r.notes.some(note => /ne reçoit pas de mail/.test(note)));
  assert.equal(r.best.email, 'jobs@acme.io');
  const thrown = await findContacts({ ...base }, { fetchPage: teamFetch, resolveMx: async () => { throw new Error('ESERVFAIL'); } });
  assert.equal(thrown.contacts.filter(c => c.status === 'guessed').length, MAX_GUESSES);
});

test('no MX: a printed address stays listed, tagged, never best; guesses dropped with their own note', async () => {
  const r = await findContacts({ ...base }, { fetchPage: teamFetch, resolveMx: async () => false });
  const jobs = r.contacts.find(c => c.email === 'jobs@acme.io');
  assert.ok(jobs);
  assert.ok(jobs.tags.includes('domaine sans MX'));
  assert.equal(r.best, null);
  assert.ok(r.notes.some(note => /devinée\(s\) écartée\(s\) : le domaine ne reçoit pas de mail/.test(note)));
  assert.ok(r.notes.some(note => /choisie d'office \(domaine sans MX\)/.test(note)));
});

test('domainAcceptsMail: null MX is false, A record without MX is unknown, DNS errors are unknown', async () => {
  const fail = code => async () => { const err = new Error(code); err.code = code; throw err; };
  const resolver = over => ({ resolveMx: async () => [{ exchange: 'mx.acme.io', priority: 10 }], resolve4: fail('ENODATA'), resolve6: fail('ENODATA'), ...over });
  assert.equal(await domainAcceptsMail('acme.io', { resolver: resolver({}) }), true);
  assert.equal(await domainAcceptsMail('example.com', { resolver: resolver({ resolveMx: async () => [{ exchange: '', priority: 0 }] }) }), false);
  assert.equal(await domainAcceptsMail('example.com', { resolver: resolver({ resolveMx: async () => [{ exchange: '.', priority: 0 }] }) }), false);
  assert.equal(await domainAcceptsMail('neverssl.com', { resolver: resolver({ resolveMx: fail('ENODATA'), resolve4: async () => ['34.223.124.45'] }) }), null);
  assert.equal(await domainAcceptsMail('v6only.io', { resolver: resolver({ resolveMx: fail('ENODATA'), resolve6: async () => ['2001:db8::1'] }) }), null);
  assert.equal(await domainAcceptsMail('nothing.io', { resolver: resolver({ resolveMx: fail('ENODATA') }) }), false);
  assert.equal(await domainAcceptsMail('nxdomain.io', { resolver: resolver({ resolveMx: fail('ENOTFOUND') }) }), false);
  assert.equal(await domainAcceptsMail('slow.io', { resolver: resolver({ resolveMx: fail('ETIMEOUT') }) }), null);
  assert.equal(mxVerdict([{ exchange: 'mx1.acme.io' }, { exchange: '.' }]), true);
  assert.equal(mxVerdict([], null, { hasAddress: true }), null);
});

test("the candidate's own address is never a contact", async () => {
  const r = await findContacts({ ...base, jobText: 'Contact hugo@acme.io', ownEmails: ['Hugo@acme.io'] }, { fetchPage, resolveMx: async () => true });
  assert.ok(!r.contacts.some(c => c.email === 'hugo@acme.io'));
});

// FP7: the route aborts the run when the modal closes and bounds it with a deadline.
test('FP7: an already aborted signal makes no page fetch, no search and no model call', async () => {
  const calls = { fetch: 0, search: 0, model: 0 };
  const controller = new AbortController();
  controller.abort();
  const r = await findContacts({ ...base, jobText: 'Apply: talent@acme.io. You will report to Marie Dupont, Head of Design.', jobUrl: 'https://jobs.ashbyhq.com/acme/1' }, {
    fetchPage: async (url) => { calls.fetch += 1; return teamFetch(url); },
    webSearch: async () => { calls.search += 1; return []; },
    extractPeople: async () => { calls.model += 1; return []; },
    judgePeople: async () => { calls.model += 1; return []; },
    resolveMx: async () => true,
    signal: controller.signal,
  });
  assert.deepEqual(calls, { fetch: 0, search: 0, model: 0 });
  assert.equal(r.stopped, 'aborted');
  assert.deepEqual(r.contacts, []);
  assert.equal(r.best, null);
  assert.ok(r.notes.some(note => note.startsWith('Recherche interrompue')));
  assert.ok(Array.isArray(r.diagnostics.queries) && r.diagnostics.queries.length === 0);
});

test('FP7: closing the page mid-run stops before the next search or page; a fetch in flight is let go', async () => {
  const controller = new AbortController();
  let searches = 0;
  let fetchesAfterAbort = 0;
  const r = await findContacts({ ...base }, {
    fetchPage: async (url) => { if (controller.signal.aborted) fetchesAfterAbort += 1; return teamFetch(url); },
    webSearch: async () => { searches += 1; controller.abort(); return []; },
    resolveMx: async () => true,
    signal: controller.signal,
  });
  assert.equal(searches, 1, 'the people searches after the first one never run');
  assert.equal(fetchesAfterAbort, 0);
  assert.equal(r.stopped, 'aborted');
  assert.deepEqual(r.contacts, []);

  // A page that never answers: the abort releases the run at once.
  const hanging = new AbortController();
  const started = Date.now();
  setTimeout(() => hanging.abort(), 30);
  const stuck = await findContacts({ ...base }, { fetchPage: () => new Promise(() => {}), resolveMx: async () => true, signal: hanging.signal });
  assert.ok(Date.now() - started < 2000, `released in ${Date.now() - started} ms`);
  assert.equal(stuck.stopped, 'aborted');
});

test('FP7: past deadlineMs the remaining searches are skipped, with the partial-search note', async () => {
  const queries = [];
  const slowSearch = async (query) => { queries.push(query); await new Promise(resolve => setTimeout(resolve, 100)); return []; };
  const noSite = async (url) => ({ ok: false, status: 404, url });
  // No site known: the official-site search starts at once, then the deadline has passed.
  const r = await findContacts({ company: 'Acme', role: 'Product Designer' }, { fetchPage: noSite, webSearch: slowSearch, resolveMx: async () => false, deadlineMs: 50 });
  assert.equal(queries.length, 1, 'only the search already started');
  assert.equal(r.stopped, 'deadline');
  assert.ok(r.notes.some(note => note.startsWith('Temps limite atteint : recherche partielle')));
  // Without a deadline the three people searches follow.
  const all = [];
  const full = await findContacts({ company: 'Acme', role: 'Product Designer' }, { fetchPage: noSite, webSearch: async (query) => { all.push(query); return []; }, resolveMx: async () => false });
  assert.ok(all.length >= 4, `${all.length} searches`);
  assert.equal(full.stopped, '');
  assert.ok(!full.notes.some(note => note.startsWith('Temps limite')));
});

test('FP7: past the deadline no new page is fetched; what was read is still ranked', async () => {
  // A clock that moves 20 ms per page fetch.
  let clock = 0;
  const fetchedAt = [];
  const timedFetch = async (url) => { fetchedAt.push(clock); clock += 20; return teamFetch(url); };
  const r = await findContacts({ ...base, jobText: 'Apply: talent@acme.io' }, { fetchPage: timedFetch, resolveMx: async () => true, now: () => clock, deadlineMs: 50 });
  assert.ok(fetchedAt.length >= 2, 'the home page and a page were read');
  assert.ok(fetchedAt.every(at => at < 50), 'every fetch started before the deadline');
  assert.equal(r.stopped, 'deadline');
  assert.ok(r.notes.some(note => note.startsWith('Temps limite atteint')));
  assert.ok(r.contacts.some(c => c.email === 'talent@acme.io'), 'the posting address is kept');
  const fullFetches = [];
  await findContacts({ ...base, jobText: 'Apply: talent@acme.io' }, { fetchPage: async (url) => { fullFetches.push(url); return teamFetch(url); }, resolveMx: async () => true });
  assert.ok(fullFetches.length > fetchedAt.length, `${fullFetches.length} fetches without a deadline, ${fetchedAt.length} with`);
});

test('FP7: a site the user types is the domain (bare domain too); a job board typed there is refused', async () => {
  const r = await findContacts({ company: 'Acme', role: 'Designer', companyUrlHint: 'acme.io' }, { fetchPage: teamFetch, resolveMx: async () => true });
  assert.equal(r.company.domain, 'acme.io');
  assert.equal(r.company.source, 'hint');
  assert.equal(r.company.confirmed, true);
  const board = await findContacts({ company: 'Acme', role: 'Designer', companyUrlHint: 'https://www.welcometothejungle.com/fr/companies/acme' }, { fetchPage: async (url) => ({ ok: false, status: 404, url }), resolveMx: async () => false });
  assert.notEqual(board.company.domain, 'welcometothejungle.com');
  assert.ok(board.notes.some(note => note.includes('Le site indiqué (www.welcometothejungle.com)')));
});

test('FP7: peopleForPage lists the employer\'s own mentions first, 30 at most, with hasAddress', () => {
  const found = {
    contacts: [{ email: 'marie.dupont@acme.io', firstName: 'Marie', lastName: 'Dupont' }, { email: 'jobs@acme.io', firstName: '', lastName: '' }],
    people: [
      { firstName: 'Zoe', lastName: 'Kim', title: 'Engineer', persona: 'unknown', queryPersona: 'founder', linkedinUrl: 'https://www.linkedin.com/in/zoe-kim', sources: [{ type: 'search', url: 'https://www.linkedin.com/in/zoe-kim' }] },
      { firstName: 'Paul', lastName: 'Martin', title: 'CEO', persona: 'founder', sources: [{ type: 'site', url: 'https://acme.io/team' }] },
      { firstName: 'Marie', lastName: 'Dupont', title: 'Head of Design', persona: 'hiring-manager', sources: [{ type: 'posting', url: 'https://jobs.example/1' }, { type: 'site', url: 'https://acme.io/team' }] },
      { firstName: 'Léa', lastName: 'Roux', title: 'Talent Partner', persona: 'recruiter', sources: [{ type: 'theorg', url: 'https://theorg.com/org/acme' }] },
      { firstName: '', lastName: 'Nobody', title: 'x', persona: 'unknown', sources: [] },
    ],
  };
  const list = peopleForPage(found);
  assert.deepEqual(list.map(person => person.firstName), ['Marie', 'Paul', 'Léa', 'Zoe']);
  assert.deepEqual(list[0], { firstName: 'Marie', lastName: 'Dupont', title: 'Head of Design', persona: 'hiring-manager', queryPersona: '', linkedinUrl: '', sources: ['posting', 'site'], sourceUrl: 'https://jobs.example/1', hasAddress: true });
  assert.equal(list[1].hasAddress, false);
  assert.equal(list[2].sourceUrl, 'https://theorg.com/org/acme');
  assert.equal(list[3].queryPersona, 'founder', 'a role only the query suggested');
  assert.equal(list[3].sourceUrl, '', 'a search hit is no page of the employer');
  assert.equal(list[3].linkedinUrl, 'https://www.linkedin.com/in/zoe-kim');
  const crowd = { contacts: [], people: Array.from({ length: 45 }, (_, i) => ({ firstName: `Ann${i}`, lastName: 'Lee', title: 'Engineer', persona: 'unknown', sources: [{ type: 'site', url: 'https://acme.io/team' }] })) };
  assert.equal(peopleForPage(crowd).length, 30);
  assert.equal(peopleForPage(crowd, { max: 5 }).length, 5);
  assert.deepEqual(peopleForPage({}), []);
});