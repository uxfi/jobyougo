// Contact finder review fixes, third round (2026-10-25): posting fields are
// no people (FL3-1), a namesake's sibling-country inbox and its CEO are not
// taken from an unconfirmed site (FL3-2), a job page's JSON-LD pointing at
// an unlisted board is no employer site (FL3-3), a domain sharing only the
// name's first word stays unconfirmed (FL3-4), German and French sales,
// privacy and one-word support inboxes are never best (FL3-5), a user's own
// site pick never reaches another account's draft (F1), a long team page
// keeps its middle cards (FLV-1), the forward target ignores best (F2) and
// accents do not split a person (FLV-2). Fixtures only, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  MAX_STAFF_CONTACTS,
  bestBlocker,
  companyWebsiteFromHtml,
  domainNameAffinity,
  extractNamedPeople,
  findContacts,
  homepageNamesCompany,
  labelSaysAvoid,
  pageText,
  pickForwardTarget,
  preDecodeHtml,
  rankContacts,
  slimHtml,
} from '../lib/contact-finder.mjs';

const ok = (url, html, finalUrl = url) => ({ ok: true, status: 200, html, text: pageText(html), url: finalUrl });
const missing = (url, status = 404) => ({ ok: false, status, html: '', text: '', url, error: `HTTP ${status}` });
// pages: { url: html }; statuses: { url: status } for pages that answer an error.
function fetcher(pages, { statuses = {}, seen = [] } = {}) {
  return async (url) => {
    const key = String(url).replace(/\/+$/, '');
    seen.push(key);
    if (pages[key] !== undefined) return ok(key, pages[key]);
    return missing(key, statuses[key] || 404);
  };
}
const theOrg = (name, url, employees) => `<script type="application/ld+json">${JSON.stringify({ '@type': 'Organization', name, url, employee: employees.map(([person, jobTitle]) => ({ '@type': 'Person', name: person, jobTitle })) })}</script>`;

// ── FL3-1 ───────────────────────────────────────────────────────────────────

test('FL3-1: a posting\'s "Field: value" lines are no people', () => {
  const lines = [
    'Reports To: Head of Design',
    'Reporting To: VP of Product',
    'Reporting Line: Head of Product Design',
    'Interview Process: Recruiter Screen → Portfolio Review → Team Interviews',
    'Next Steps: Hiring Manager Interview',
    'Start Date: Talent Partner to confirm',
    'Working Hours: Team Lead availability',
    'Job Family: Product Manager',
  ];
  for (const line of lines) {
    assert.deepEqual(extractNamedPeople(line, { sourceUrl: 'https://jobs.lever.co/acme/1', teamLike: false }), [], line);
  }
  // A person the posting names still counts, either order.
  const posting = 'You will report to Claire Martin, Head of Design.\nHiring Manager: Jane Smith';
  assert.deepEqual(extractNamedPeople(posting, { sourceUrl: 'https://jobs.lever.co/acme/1', teamLike: false }).map(p => `${p.firstName} ${p.lastName}`).sort(), ['Claire Martin', 'Jane Smith']);
  // On a site page "Name: Title" stays a person; a field label never is one.
  const team = extractNamedPeople('Anna Schmidt: Head of People\nReports To: Head of Design', { sourceUrl: 'https://acme.io/team' });
  assert.deepEqual(team.map(p => `${p.firstName} ${p.lastName}|${p.title}`), ['Anna Schmidt|Head of People']);
  // A hiring step is nobody's title, wherever it is read.
  assert.deepEqual(extractNamedPeople('Claire Martin - Hiring Manager Interview', { sourceUrl: 'https://acme.io/team' }), []);
  assert.deepEqual(extractNamedPeople('Claire Martin, Interview Lead', { sourceUrl: 'https://acme.io/team' }).map(p => p.title), ['Interview Lead']);
});

test('FL3-1: a US HR-template posting keeps its real leaders in the guess slots and the forward target', async () => {
  const posting = `Senior Product Designer
Acme Health
Job Title: Senior Product Designer
Department: Design
Reports To: Director of Product Design
Location: Austin, TX (Hybrid)
About Acme Health
Acme Health builds scheduling software for community clinics across the United States.
Interview Process: Recruiter Screen → Portfolio Review → Team Interviews
Questions? Write to careers@acmehealth.com`;
  const out = await findContacts({ company: 'Acme Health', role: 'Senior Product Designer', jobUrl: 'https://jobs.lever.co/acmehealth/5c1d2e3f', jobText: posting }, {
    fetchPage: fetcher({
      'https://acmehealth.com': '<html lang="en"><head><title>Acme Health | Scheduling for community clinics</title></head><body><a href="/about">About</a><p>Acme Health builds scheduling software for community clinics.</p><footer>© 2026 Acme Health, Inc.</footer></body></html>',
      'https://acmehealth.com/about': '<html><body><h1>About us</h1><h2>Leadership</h2><p>Maria Lopez</p><p>CEO &amp; Co-founder</p><p>David Chen</p><p>Head of Product</p></body></html>',
    }),
    resolveMx: async (domain) => domain === 'acmehealth.com',
    maxPages: 3,
  });
  const names = out.people.map(p => `${p.firstName} ${p.lastName}`);
  assert.ok(!names.some(name => /Reports|Interview|Process|Steps/.test(name)), names.join(', '));
  assert.ok(!out.contacts.some(c => /^(?:reports|interview)\./.test(c.email)));
  assert.deepEqual(out.contacts.filter(c => c.status === 'guessed').map(c => c.email).sort(), ['david.chen@acmehealth.com', 'maria.lopez@acmehealth.com']);
  assert.equal(out.best?.email, 'careers@acmehealth.com');
  assert.equal(pickForwardTarget(out)?.firstName, 'David');
});

// ── FL3-2 ───────────────────────────────────────────────────────────────────

test('FL3-2: an unconfirmed namesake\'s sibling-country inbox is not best, and its CEO is no forward target', async () => {
  const lindyCom = `<!doctype html><html lang="en"><head><title>LINDY - Connectivity Solutions | Cables, Adapters, KVM</title></head><body>
<a href="/about-us">About us</a>
<p>Lindy has supplied high quality connectivity products since 1932, with offices across Europe and the UK.</p>
<footer><p>Germany: info@lindy.de · France: info@lindy.fr</p><p>© 2026 Lindy Electronics Ltd</p></footer></body></html>`;
  const about = '<html><body><h1>About us</h1><h2>Management team</h2><p>Peter Lindy</p><p>CEO</p><p>Sarah Becker</p><p>Head of Marketing</p></body></html>';
  const posting = 'Product Designer\nLindy\nRemote (US)\nAbout Lindy\nLindy lets anyone build AI agents that automate their work: email triage, meeting notes, CRM updates.\nThe role\nYou will design the agent builder end to end and work with our founders.';
  const out = await findContacts({ company: 'Lindy', role: 'Product Designer', jobUrl: 'https://www.indeed.com/viewjob?jk=77aa88bb99cc', jobText: posting }, {
    fetchPage: fetcher({ 'https://lindy.com': lindyCom, 'https://lindy.com/about-us': about }, { statuses: { 'https://lindy.ai': 403 } }),
    webSearch: async () => [],
    resolveMx: async (domain) => ['lindy.com', 'lindy.ai', 'lindy.de', 'lindy.fr'].includes(domain),
    maxPages: 3,
  });
  assert.equal(out.company.domain, 'lindy.com');
  assert.equal(out.company.confirmed, false);
  const sibling = out.contacts.find(c => c.email === 'info@lindy.de');
  assert.ok(sibling, 'the sibling inbox is still listed');
  assert.equal(bestBlocker(sibling, { domainConfirmed: false, domain: 'lindy.com' }), 'site non confirmé');
  assert.equal(out.best, null);
  assert.equal(pickForwardTarget(out), null);
  assert.ok(out.notes.some(note => /site non confirmé/.test(note)));
});

test('FL3-2: a site-only address is blocked only while the site is unconfirmed; a posting address at a name-carrying domain is not', () => {
  const sibling = { email: 'info@acme.de', firstName: '', lastName: '', kind: 'generic', persona: 'inbox', confidence: 'verified', sources: [{ type: 'site', url: 'https://acme.com' }], mx: true };
  assert.equal(bestBlocker(sibling, { domainConfirmed: false, domain: 'acme.com' }), 'site non confirmé');
  assert.equal(bestBlocker(sibling, { domainConfirmed: true, domain: 'acme.com' }), '');
  const posting = { ...sibling, email: 'jobs@acme-careers.com', kind: 'hiring', persona: 'recruiter', sources: [{ type: 'posting', url: 'https://jobs.lever.co/acme/1' }] };
  assert.equal(bestBlocker(posting, { domainConfirmed: false, domain: 'acme.com' }), '');
  // The forward target: the posting's person stays, the unconfirmed site's goes.
  const people = [
    { firstName: 'Peter', lastName: 'Lindy', title: 'CEO', persona: 'founder', roleRank: 3, sources: [{ type: 'site', url: 'https://lindy.com/about-us' }] },
  ];
  assert.equal(pickForwardTarget({ company: { domain: 'lindy.com', confirmed: false }, best: null, people }), null);
  assert.equal(pickForwardTarget({ company: { domain: 'lindy.com', confirmed: true }, best: null, people })?.firstName, 'Peter');
  const named = [...people, { firstName: 'Flo', lastName: 'Crivello', title: 'CEO', persona: 'founder', roleRank: 3, sources: [{ type: 'posting', url: 'https://www.indeed.com/viewjob?jk=1' }] }];
  assert.equal(pickForwardTarget({ company: { domain: 'lindy.com', confirmed: false }, best: null, people: named })?.firstName, 'Flo');
});

// ── FL3-3 ───────────────────────────────────────────────────────────────────

const kinetikJobHtml = (sameAs) => `<html><head><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'JobPosting', title: 'Product Designer', hiringOrganization: { '@type': 'Organization', name: 'Kinetik Labs', sameAs } })}</script></head><body><h1>Product Designer</h1></body></html>`;
const kinetikText = 'Product Designer\nKinetik Labs\nKinetik Labs builds motion analytics for physiotherapists. You will design the clinician app.';

test('FL3-3: a JSON-LD sameAs on an unlisted board\'s company page is no employer site', async () => {
  assert.equal(companyWebsiteFromHtml(kinetikJobHtml('https://www.remoterocketship.com/company/kinetik-labs'), 'Kinetik Labs'), '');
  assert.equal(companyWebsiteFromHtml(kinetikJobHtml('https://www.somenewboard.io/companies/kinetik-labs'), 'Kinetik Labs'), '');
  // The employer's own site on such a path still counts when it carries the name.
  assert.equal(companyWebsiteFromHtml(kinetikJobHtml('https://kinetiklabs.com/company/about'), 'Kinetik Labs'), 'https://kinetiklabs.com/company/about');
  const board = '<html><head><title>Remote Rocketship | 100k+ remote jobs</title></head><body><a href="/contact">Contact</a><footer>Questions? hello@remoterocketship.com · © 2026 Remote Rocketship</footer></body></html>';
  const out = await findContacts({ company: 'Kinetik Labs', role: 'Product Designer', jobUrl: 'https://www.remoterocketship.com/company/kinetik-labs/jobs/product-designer-123', jobText: kinetikText, jobHtml: kinetikJobHtml('https://www.remoterocketship.com/company/kinetik-labs') }, {
    fetchPage: fetcher({ 'https://www.remoterocketship.com': board }),
    resolveMx: async () => true,
    maxPages: 2,
  });
  assert.notEqual(out.company.domain, 'remoterocketship.com');
  assert.ok(!out.contacts.some(c => c.email.endsWith('@remoterocketship.com')));
  assert.equal(out.best, null);
});

test('FL3-3: a JSON-LD site without the name counts only when its home page names the company', async () => {
  const job = { company: 'Kinetik Labs', role: 'Product Designer', jobUrl: 'https://www.indeed.com/viewjob?jk=9f9f', jobText: kinetikText, jobHtml: kinetikJobHtml('https://www.motion-rx.com') };
  const named = await findContacts(job, {
    fetchPage: fetcher({ 'https://www.motion-rx.com': '<html><head><title>Kinetik Labs | Motion analytics for physiotherapy</title></head><body><p>jobs@motion-rx.com</p></body></html>' }),
    resolveMx: async () => true,
    maxPages: 1,
  });
  assert.equal(named.company.domain, 'motion-rx.com');
  assert.equal(named.company.source, 'job-page');
  assert.equal(named.company.confirmed, true);
  assert.equal(named.best?.email, 'jobs@motion-rx.com');
  const other = await findContacts(job, {
    fetchPage: fetcher({ 'https://www.motion-rx.com': '<html><head><title>JobHub | Remote jobs</title></head><body><p>hello@motion-rx.com</p></body></html>' }),
    resolveMx: async () => true,
    maxPages: 1,
  });
  assert.notEqual(other.company.domain, 'motion-rx.com');
  assert.ok(other.notes.some(note => /motion-rx\.com \(page de l'annonce\) ne mentionne pas « Kinetik Labs »/.test(note)));
  assert.ok(!other.contacts.some(c => c.email.endsWith('@motion-rx.com')));
});

// ── FL3-4 ───────────────────────────────────────────────────────────────────

test('FL3-4: a domain or home page sharing only the first word does not carry the whole name', () => {
  assert.equal(domainNameAffinity('nova.com', 'Nova Labs'), 'exact');
  assert.equal(domainNameAffinity('nova.com', 'Nova Labs', { fullName: true }), '');
  assert.equal(domainNameAffinity('novalabs.com', 'Nova Labs', { fullName: true }), 'exact');
  assert.equal(domainNameAffinity('mercury.com', 'Mercury Systems'), 'token');
  assert.equal(domainNameAffinity('mercury.com', 'Mercury Systems', { fullName: true }), '');
  assert.equal(domainNameAffinity('tryriot.com', 'Riot', { fullName: true }), 'affix');
  const bank = '<html><head><title>Mercury | Banking for ambitious companies</title></head><body><footer>© 2026 Mercury Technologies, Inc.</footer></body></html>';
  assert.equal(homepageNamesCompany(bank, 'Mercury Systems', { fullName: true }), false);
  assert.equal(homepageNamesCompany('<title>Mercury Systems | Innovation That Matters</title>', 'Mercury Systems', { fullName: true }), true);
  assert.equal(homepageNamesCompany('<title>Nova</title>', 'Nova Labs'), true);
  assert.equal(homepageNamesCompany('<title>Nova</title>', 'Nova Labs', { fullName: true }), false);
});

test('FL3-4: Mercury Systems never confirms mercury.com, the bank; its inbox is listed, not drafted to', async () => {
  const results = [
    { title: 'Mercury Systems | Innovation That Matters', url: 'https://www.mrcy.com/' },
    { title: 'Mercury Systems - Wikipedia', url: 'https://en.wikipedia.org/wiki/Mercury_Systems' },
    { title: 'Mercury | Banking for ambitious companies', url: 'https://mercury.com/' },
  ];
  const bank = '<html lang="en"><head><title>Mercury | Banking for ambitious companies</title></head><body><a href="/careers">Careers</a><p>Mercury is a fintech company, not a bank.</p><footer>Questions? support@mercury.com · Join us: jobs@mercury.com · © 2026 Mercury Technologies, Inc.</footer></body></html>';
  const out = await findContacts({ company: 'Mercury Systems', role: 'UX Designer', jobUrl: 'https://www.indeed.com/viewjob?jk=1a2b3c4d5e6f', jobText: 'UX Designer\nMercury Systems\nAndover, MA\nMercury Systems builds secure processing subsystems for aerospace and defense.' }, {
    fetchPage: fetcher({ 'https://mercury.com': bank }),
    webSearch: async (query) => (/official/.test(query) ? results : []),
    resolveMx: async (domain) => ['mercury.com', 'mrcy.com'].includes(domain),
    maxPages: 2,
  });
  assert.equal(out.company.domain, 'mercury.com');
  assert.equal(out.company.confirmed, false);
  assert.ok(out.contacts.some(c => c.email === 'jobs@mercury.com'));
  assert.equal(out.best, null);
  assert.ok(out.notes.some(note => /mercury\.com ne porte qu'une partie du nom « Mercury Systems »/.test(note)));
});

test('FL3-4: a search pick on the stripped name is confirmed only by the full name on its home page', async () => {
  const run = (title) => findContacts({ company: 'Nova Labs', role: 'Product Designer', jobUrl: 'https://www.indeed.com/viewjob?jk=4e4e', jobText: 'Product Designer\nNova Labs\nWe build lab automation software.' }, {
    fetchPage: fetcher({ 'https://nova.com': `<html><head><title>${title}</title></head><body><p>careers@nova.com</p></body></html>` }),
    webSearch: async (query) => (/official/.test(query) ? [{ title, url: 'https://nova.com/' }] : []),
    resolveMx: async (domain) => domain === 'nova.com',
    maxPages: 1,
  });
  const namesake = await run('Nova | Electric scooters');
  assert.equal(namesake.company.domain, 'nova.com');
  assert.equal(namesake.company.confirmed, false);
  assert.equal(namesake.best, null);
  const own = await run('Nova Labs | Lab automation software');
  assert.equal(own.company.confirmed, true);
  assert.equal(own.best?.email, 'careers@nova.com');
});

// ── FL3-5 ───────────────────────────────────────────────────────────────────

test('FL3-5: German and French sales and privacy inboxes, and one-word support desks, are never best', async () => {
  const run = async (footer, lang = 'de') => findContacts({ company: 'Acme Logistik', role: 'UX Designer', jobUrl: 'https://acme-logistik.de/karriere/ux-designer', jobText: 'UX Designer (m/w/d)\nAcme Logistik GmbH\nWir suchen eine:n UX Designer für unsere Plattform.' }, {
    fetchPage: fetcher({ 'https://acme-logistik.de': `<html lang="${lang}"><head><title>Acme Logistik GmbH | Software für Spediteure</title></head><body><p>Acme Logistik entwickelt Software für mittelständische Spediteure.</p><footer>${footer}<p>© 2026 Acme Logistik GmbH</p></footer></body></html>` }),
    resolveMx: async () => true,
    maxPages: 1,
  });
  assert.equal((await run('<p>Vertrieb: vertrieb@acme-logistik.de</p><p>Kontakt: info@acme-logistik.de</p>')).best?.email, 'info@acme-logistik.de');
  assert.equal((await run('<p>Datenschutzbeauftragter: dsb@acme-logistik.de</p><p>Kontakt: info@acme-logistik.de</p>')).best?.email, 'info@acme-logistik.de');
  assert.equal((await run('<p>Ventes : ventes@acme-logistik.de</p><p>Contact : contact@acme-logistik.de</p>', 'fr')).best?.email, 'contact@acme-logistik.de');
  // The label alone sends an inbox away, whatever its local part says.
  assert.equal((await run('<p>Vertrieb: hallo@acme-logistik.de</p><p>Kontakt: info@acme-logistik.de</p>')).best?.email, 'info@acme-logistik.de');
  const desk = await run('<p>Questions? customerservice@acme-logistik.de</p>', 'en');
  assert.ok(desk.contacts.some(c => c.email === 'customerservice@acme-logistik.de'));
  assert.equal(desk.best, null);
  assert.ok(desk.notes.some(note => /boîte support/.test(note)));
  for (const label of ['Vertrieb:', 'Verkauf:', 'Einkauf:', 'Buchhaltung:', 'Rechnungen:', 'Datenschutzbeauftragter:', 'Ventes :', 'Devis :']) {
    assert.equal(labelSaysAvoid(`${label} anna@acme.de`, 'anna@acme.de'), true, label);
  }
  assert.equal(labelSaysAvoid('Kontakt: info@acme.de', 'info@acme.de'), false);
});

test('FL3-5: at equal score, contact@ or info@ goes before an inbox named by an unknown word', () => {
  const inbox = email => ({ email, firstName: '', lastName: '', kind: 'generic', persona: 'inbox', confidence: 'verified', sources: [{ type: 'site', url: 'https://acme.de' }], mx: true });
  assert.deepEqual(rankContacts([inbox('empfang@acme.de'), inbox('info@acme.de')]).map(c => c.email), ['info@acme.de', 'empfang@acme.de']);
});

// ── F1 ──────────────────────────────────────────────────────────────────────

test('F1: a site one account typed or picked never becomes the company text another account\'s draft reads', () => {
  const src = readFileSync(new URL('../ui/server.mjs', import.meta.url), 'utf8');
  const code = src.slice(src.indexOf('const contactFinderCache = new Map();'), src.indexOf('/** The contact fields the page needs'));
  const sandbox = { normalizeUrl: url => String(url).toLowerCase(), Date };
  vm.runInNewContext(`${code}\nthis.remember = rememberContactFinderResult; this.cache = contactFinderCache;`, sandbox);
  const url = 'https://jobs.example/42';
  const run = (source, domain, text) => ({ company: { domain, source }, companyText: text, contacts: [{ email: `jobs@${domain}` }], stopped: '' });
  sandbox.remember(url, { jobText: 'posting', companyText: 'about Acme', companyDomain: 'acme.io' }, { userKey: 'owner', found: run('search', 'acme.io', 'about Acme') });
  sandbox.remember(url, { jobText: 'posting', companyText: 'about Evil', companyDomain: 'evil-site.com' }, { userKey: 'user-2', found: run('hint', 'evil-site.com', 'about Evil') });
  let entry = sandbox.cache.get(url);
  assert.equal(entry.companyText, 'about Acme', 'the shared text keeps the run that found the site itself');
  assert.equal(entry.companyDomain, 'acme.io');
  assert.equal(entry.foundByUser['user-2'].found.companyText, 'about Evil', 'the account that picked the site keeps its own');
  assert.equal(entry.foundByUser.owner.found.companyText, 'about Acme');
  // A hinted run first: nothing shared rather than that account's pick.
  sandbox.remember('https://jobs.example/43', { jobText: 'posting', companyText: 'about Evil', companyDomain: 'evil-site.com' }, { userKey: 'user-2', found: run('hint', 'evil-site.com', 'about Evil') });
  assert.equal(sandbox.cache.get('https://jobs.example/43').companyText, '');
  assert.equal(sandbox.cache.get('https://jobs.example/43').companyDomain, '');
  // A later run that finds the site itself updates the shared fields again.
  sandbox.remember(url, { jobText: 'posting', companyText: 'about Acme, new', companyDomain: 'acme.io' }, { userKey: 'user-3', found: run('job-page', 'acme.io', 'about Acme, new') });
  entry = sandbox.cache.get(url);
  assert.equal(entry.companyText, 'about Acme, new');
  // The automatic draft of the account that typed the site still gets its own text.
  const route = src.slice(src.indexOf("path === '/api/contact-finder' && method === 'GET'"));
  assert.match(route.slice(0, route.indexOf("send('done', { ok: true });\n      } catch")), /companyText: found\.companyText,/);
});

// ── FLV-1 ───────────────────────────────────────────────────────────────────

const media = '<picture><source data-srcset="https://cdn.acme.com/a.webp 1x, https://cdn.acme.com/a@2x.webp 2x" class="card-media card-media--lazy"><img src="https://cdn.acme.com/a.jpg" class="lazy" style="width:100%" data-id="1"></picture>';
const letters = 'abcdefghijklmnopqrstuvwxyz';
// 400 account managers (another department) and the recruiter in the middle,
// each card heavy with image markup: 600 KB, past the 400 KB cut.
function longTeamPage(pad = 0, at = 200) {
  const list = Array.from({ length: 400 }, (_, i) => [`Ann${letters[Math.floor(i / 26)]}${letters[i % 26]}`, 'Smith', 'Account Manager']);
  list.splice(at, 0, ['Wiebke', 'Potesta', 'Talent Acquisition Specialist']);
  return `<html><body><h1>Our team</h1>${' '.repeat(pad)}${list.map(([first, last, title]) => `<div class="card" id="m-${first}">${media.repeat(6)}<h3>${first} ${last}</h3><p>${title}</p><a class="mail" href="mailto:${first.toLowerCase()}@acme.com">${first.toLowerCase()}@acme.com</a></div>`).join('\n')}</body></html>`;
}

test('FLV-1: slimHtml drops image markup and presentational attributes before cutting a long page', () => {
  const page = longTeamPage();
  assert.ok(page.length > 400000);
  const naive = `${page.slice(0, 200000)}\n${page.slice(-200000)}`;
  assert.ok(!naive.includes('Wiebke Potesta'), 'cutting first loses the middle card');
  const slim = slimHtml(page, 400000);
  assert.ok(slim.length < 400000);
  assert.ok(slim.includes('Wiebke Potesta') && slim.includes('Talent Acquisition Specialist'));
  assert.equal((slim.match(/mailto:/g) || []).length, 401, 'every address is kept');
  assert.ok(slim.includes('<a href="mailto:wiebke@acme.com">'));
  assert.ok(!/<img|<picture|<source|class=|style=|data-srcset|\sid=/.test(slim));
  // A page under the limit is left as it was (a Lever board's logo class and alt).
  const lever = '<a class="main-header-logo" href="https://acme.com"><img alt="Acme" src="logo.png"></a><p>Jobs</p>';
  assert.equal(slimHtml(lever, 400000), lever);
});

test('FLV-1: the recruiter in the middle of a long team page is best at every fetch, and staff addresses are capped', async () => {
  for (const pad of [0, 600, 3000]) {
    const pages = { 'https://acme.com': '<a href="/team">Team</a><p>Acme builds pricing software for independent hotels.</p>', 'https://acme.com/team': longTeamPage(pad) };
    // As createPageFetcher returns a page: decoded, then slimmed to 400 KB.
    const fetchPage = async (url) => {
      const key = String(url).replace(/\/+$/, '');
      if (pages[key] === undefined) return missing(key);
      const html = slimHtml(preDecodeHtml(pages[key]), 400000);
      return { ok: true, status: 200, html, text: pageText(html), url: key };
    };
    const out = await findContacts({ company: 'Acme', role: 'Product Designer', companyUrlHint: 'https://acme.com' }, { fetchPage, resolveMx: async () => true, maxPages: 2 });
    assert.equal(out.best?.email, 'wiebke@acme.com', `pad ${pad}`);
    assert.equal(out.best?.title, 'Talent Acquisition Specialist');
    assert.ok(out.contacts.length <= MAX_STAFF_CONTACTS, `${out.contacts.length} contacts listed`);
    assert.ok(out.notes.some(note => /389 adresse\(s\) du personnel non listée\(s\)/.test(note)), out.notes.join(' | '));
  }
});

// ── F2 ──────────────────────────────────────────────────────────────────────

test('F2: the forward target for a shared inbox ignores best; the page uses it for every "Write to"', () => {
  const found = {
    company: { domain: 'acme.io', confirmed: true },
    best: { email: 'claire.martin@acme.io', firstName: 'Claire', lastName: 'Martin' },
    people: [{ firstName: 'Anna', lastName: 'Petit', title: 'Talent Acquisition Manager', persona: 'recruiter', roleRank: 1, sources: [{ type: 'site', url: 'https://acme.io/team' }] }],
  };
  assert.equal(pickForwardTarget(found), null, 'the automatic draft to a named best asks no one');
  assert.equal(pickForwardTarget({ ...found, best: null })?.firstName, 'Anna');
  const src = readFileSync(new URL('../ui/server.mjs', import.meta.url), 'utf8');
  const route = src.slice(src.indexOf("path === '/api/contact-finder' && method === 'GET'"));
  assert.match(route, /mention: pickForwardTarget\(found\),/);
  assert.match(route, /forwardTarget: pickForwardTarget\(\{ \.\.\.found, best: null \}\),/);
  assert.match(route, /const mention = event\.mention;/, 'the automatic draft keeps mention');
  const html = readFileSync(new URL('../ui/index.html', import.meta.url), 'utf8');
  assert.match(html, /cfContext\.mention = data\.forwardTarget \|\| data\.mention \|\| null;/);
  assert.match(html, /const mention = data\.forwardTarget \|\| data\.mention;/);
});

// ── FLV-2 ───────────────────────────────────────────────────────────────────

test('FLV-2: an accented and an unaccented spelling are one person, asked of the provider once', async () => {
  const asked = [];
  const provider = { name: 'fake', findEmail: async ({ firstName, lastName }) => { asked.push(`${firstName} ${lastName}`); return {}; } };
  const out = await findContacts({ company: 'Acme', role: 'Product Designer', companyUrlHint: 'https://acme.io' }, {
    fetchPage: fetcher({
      'https://acme.io': '<a href="/team">Team</a><p>Acme builds payroll software for small teams in Europe.</p>',
      'https://acme.io/team': '<h1>Our team</h1><div><h3>Hélène Durand</h3><p>Head of Design</p></div><div><h3>Paul Martin</h3><p>CEO &amp; Founder</p></div>',
      'https://theorg.com/org/acme': theOrg('Acme', 'https://acme.io', [['Helene Durand', 'Head of Design']]),
    }),
    providers: [provider],
    resolveMx: async () => true,
  });
  const helene = out.people.filter(p => /^h[eé]l[eè]ne$/i.test(p.firstName));
  assert.equal(helene.length, 1);
  assert.equal(helene[0].firstName, 'Hélène', 'the site\'s spelling is kept');
  assert.deepEqual([...new Set(helene[0].sources.map(s => s.type))].sort(), ['site', 'theorg']);
  assert.equal(asked.filter(name => /durand/i.test(name)).length, 1);
});
