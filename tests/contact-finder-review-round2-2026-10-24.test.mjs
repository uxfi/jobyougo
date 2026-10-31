// Contact finder review fixes, second round (2026-10-24): words shared with
// the posting never confirm a name guess (FLR-1), longer tracker names and
// Asian/Indian legal forms still reach the employer's site (FLR-2), a staff
// member's own address is no shared inbox (FL-1), a title word is no first
// name (FL-2), a TheOrg page listing an old domain that redirects here is
// this company's (FL-3), plus redirected home pages (FLR-4), customer-care
// desks (FLR-5), providers past the deadline (FLR-7), the replay key (FI-4)
// and the people list order (FL-4). Fixtures only, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  bestBlocker,
  companyTokens,
  domainNameAffinity,
  findContacts,
  pageText,
  pairAddressesWithPeople,
  peopleForPage,
  pickBest,
} from '../lib/contact-finder.mjs';
import { companyNameWords } from '../lib/non-employer-hosts.mjs';

const ok = (url, html, finalUrl = url) => ({ ok: true, status: 200, html, text: pageText(html), url: finalUrl });
const missing = (url, status = 404) => ({ ok: false, status, html: '', text: '', url, error: `HTTP ${status}` });
// pages: { url: html | { html, url } } (url: where a redirect landed).
function fetcher(pages, seen = []) {
  return async (url) => {
    const key = String(url).replace(/\/+$/, '');
    seen.push(key);
    const entry = pages[key];
    if (entry === undefined) return missing(key);
    return typeof entry === 'string' ? ok(key, entry) : ok(key, entry.html, entry.url);
  };
}
const theOrg = (name, url, employees) => `<script type="application/ld+json">${JSON.stringify({ '@type': 'Organization', name, url, employee: employees.map(([person, jobTitle]) => ({ '@type': 'Person', name: person, jobTitle })) })}</script>`;

// ── FLR-1 ───────────────────────────────────────────────────────────────────

// rv-logic/riot.mjs: Riot (security awareness, tryriot.com behind a 403) and
// riot.co, a London studio whose page shares everyday words with the posting.
const riotPosting = `Product Designer
Riot
Paris, France (Hybrid)
About Riot
Riot is building the cybersecurity awareness platform that employees actually enjoy. Our conversational assistant Albert trains teams to spot phishing.
The role
You will own the end-to-end design of new features, from discovery interviews to polished interfaces. You will work closely with engineers and the founders.
Why join us
Competitive salary, equity, and an ambitious team backed by top investors.`;
const riotStudio = `<!doctype html><html><head><title>Riot — Creative Studio</title><meta name="description" content="Riot is an independent creative studio crafting brands, interfaces and campaigns for ambitious companies."></head><body>
<h1>We design brands people actually enjoy.</h1>
<p>Riot is an independent design studio in London. We partner with ambitious founders on brand identity, product interfaces and campaigns.</p>
<footer><p>Say hello: hello@riot.co</p><p>© 2026 Riot Studio Ltd.</p></footer></body></html>`;
const riotJob = { company: 'Riot', role: 'Product Designer', jobUrl: 'https://fr.indeed.com/viewjob?jk=8f2a91c0d1e2', jobText: riotPosting };
const riotMx = async (domain) => ['riot.co', 'tryriot.com'].includes(domain);

test('FLR-1: a namesake sharing everyday words with the posting is no confirmed site; the official-site search runs', async () => {
  const queries = [];
  const out = await findContacts(riotJob, {
    fetchPage: async (url) => (url === 'https://riot.co' ? ok(url, riotStudio) : missing(url, url.includes('tryriot') ? 403 : 404)),
    webSearch: async (query) => { queries.push(query); return /official/.test(query) ? [{ title: 'Riot - Cybersecurity awareness', url: 'https://tryriot.com/' }] : []; },
    resolveMx: riotMx,
    maxPages: 2,
  });
  assert.ok(queries.some(query => /official website/.test(query)), 'the official-site search is not pre-empted');
  assert.equal(out.company.domain, 'riot.co');
  assert.equal(out.company.confirmed, false);
  assert.equal(out.best, null, 'the studio\'s inbox is never drafted to');

  // The search's own pick, readable and naming Riot, wins over the guess.
  const found = await findContacts(riotJob, {
    fetchPage: fetcher({
      'https://riot.co': riotStudio,
      'https://tryriot.com': '<title>Riot - Cybersecurity awareness training</title><p>Phishing simulations on Slack. © 2026 Riot</p><p>jobs@tryriot.com</p>',
    }),
    webSearch: async (query) => (/official/.test(query) ? [{ title: 'Riot - Cybersecurity awareness', url: 'https://tryriot.com/' }] : []),
    resolveMx: riotMx,
    maxPages: 2,
  });
  assert.equal(found.company.domain, 'tryriot.com');
  assert.equal(found.company.source, 'search');
  assert.equal(found.company.confirmed, true);
});

// ── FLR-2 ───────────────────────────────────────────────────────────────────

test('FLR-2: Vertech Industrial Systems keeps vertech.com, whose home page calls itself "Vertech"', async () => {
  // Report 1052: Glassdoor offer, unreadable posting, search returns vertech.com.
  const home = '<html><head><title>Vertech | Industrial Automation &amp; Controls</title></head><body><a href="/contact">Contact</a><p>Industrial automation done right.</p><footer>© 2026 Vertech. All rights reserved.</footer></body></html>';
  const contact = '<html><body><h1>Contact</h1><p>Careers: jobs@vertech.com</p><p>info@vertech.com</p></body></html>';
  const out = await findContacts({ company: 'Vertech Industrial Systems', role: 'UX/UI Designer', jobUrl: 'https://www.glassdoor.com/job-listing/ux-ui-designer-vertech-industrial-systems-JV_KO0,14_KE15,41.htm?jl=1010148788011', jobText: '' }, {
    fetchPage: fetcher({ 'https://www.vertech.com': home, 'https://www.vertech.com/contact': contact }),
    webSearch: async (query) => (/official website/.test(query) ? [{ title: 'Vertech | Industrial Automation & Controls', url: 'https://www.vertech.com/' }, { title: 'Vertech Industrial Systems | LinkedIn', url: 'https://www.linkedin.com/company/vertech-industrial-systems' }] : []),
    resolveMx: async (domain) => domain === 'vertech.com',
    maxPages: 3,
  });
  assert.equal(out.company.domain, 'vertech.com');
  assert.equal(out.company.source, 'search');
  assert.ok(!out.notes.some(note => /ne mentionne pas/.test(note)));
  // Only the first word in common and nothing tying it to the offer (FL3-4):
  // listed unconfirmed, the user picks jobs@vertech.com.
  assert.equal(out.company.confirmed, false);
  assert.equal(out.best, null);
  assert.ok(out.contacts.some(c => c.email === 'jobs@vertech.com'));
  // The posting page linking the domain ties it to the offer: confirmed, drafted to.
  const named = await findContacts({ company: 'Vertech Industrial Systems', role: 'UX/UI Designer', jobUrl: 'https://www.glassdoor.com/job-listing/ux-ui-designer-vertech-industrial-systems-JV_KO0,14_KE15,41.htm?jl=1010148788011', jobText: '', jobHtml: '<p>UX/UI Designer</p><p>Learn more: <a href="https://www.vertech.com/">www.vertech.com</a></p>' }, {
    fetchPage: fetcher({ 'https://www.vertech.com': home, 'https://www.vertech.com/contact': contact }),
    webSearch: async (query) => (/official website/.test(query) ? [{ title: 'Vertech | Industrial Automation & Controls', url: 'https://www.vertech.com/' }] : []),
    resolveMx: async (domain) => domain === 'vertech.com',
    maxPages: 3,
  });
  assert.equal(named.company.domain, 'vertech.com');
  assert.equal(named.company.confirmed, true);
  assert.equal(named.best?.email, 'jobs@vertech.com');
});

test('FLR-2: Pvt Ltd, Sdn Bhd, Pte Ltd, Pty Ltd, LLP and Private Limited are legal forms, not the name', async () => {
  assert.deepEqual(companyNameWords('Maven Workforce Pvt Ltd'), ['maven', 'workforce']);
  assert.deepEqual(companyNameWords('Monee SG Private Limited'), ['monee', 'sg']);
  assert.deepEqual(companyNameWords('DCONSTRUCT PLUS PTE. LTD.'), ['dconstruct', 'plus']);
  assert.deepEqual(companyTokens('Bjak Sdn Bhd'), ['bjak']);
  assert.deepEqual(companyTokens('HIPSTER PRIVATE LIMITED'), ['hipster']);
  assert.deepEqual(companyTokens('Acme ApS'), ['acme']);
  // Never the first word: "APS Group" and "AB InBev" keep their names.
  assert.deepEqual(companyNameWords('APS Group'), ['aps', 'group']);
  assert.deepEqual(companyNameWords('AB InBev'), ['ab', 'inbev']);
  assert.deepEqual(companyTokens('Private Wealth Partners'), ['private', 'wealth', 'partners']);
  assert.equal(domainNameAffinity('mavenworkforce.com', 'Maven Workforce Pvt Ltd'), 'exact');
  assert.equal(domainNameAffinity('koruuxdesign.com', 'Koru UX Design LLP'), 'exact');

  for (const [company, site, title] of [
    ['Maven Workforce Pvt Ltd', 'mavenworkforce.com', 'Maven Workforce | IT Staffing'],
    ['Bjak Sdn Bhd', 'bjak.my', 'Bjak | Insurance'],
    ['Acme Pte Ltd', 'acme.sg', 'Acme'],
    ['Acme Pty Ltd', 'acme.com.au', 'Acme'],
    ['Acme LLP', 'acme.co.uk', 'Acme'],
    ['Acme Private Limited', 'acme.in', 'Acme'],
  ]) {
    const home = `<html><head><title>${title}</title></head><body><a href="/contact">Contact</a><footer>© 2026 ${title.split(' |')[0]}</footer></body></html>`;
    const out = await findContacts({ company, role: 'Designer', jobUrl: 'https://www.glassdoor.com/job-listing/x-JV_KO0,1_KE2,3.htm', jobText: '' }, {
      fetchPage: fetcher({ [`https://www.${site}`]: home, [`https://www.${site}/contact`]: `<p>Careers: careers@${site}</p>` }),
      webSearch: async (query) => (/official website/.test(query) ? [{ title, url: `https://www.${site}/` }] : []),
      resolveMx: async (domain) => domain === site,
      maxPages: 2,
    });
    assert.equal(out.company.domain, site, company);
    assert.equal(out.best?.email, `careers@${site}`, company);
  }
});

// ── FL-1 ────────────────────────────────────────────────────────────────────

// finder-live-after/repro/aji.mjs: RoomPriceGenie's /genies/ cards, each
// with its Envelope link; Ahmad Aji Santoso writes from aji@.
const genies = `<html><body><h2>Meet the genies</h2><nav><a href='/genies/'>Our team</a></nav>
<div><h3>Adina Popa</h3><p>Manager of Executive Operations</p><a href="mailto:adina@acme-genie.com">Envelope</a></div>
<div><h3>Aidin Tavvafi</h3><p>Sr. Backend Developer</p><a href="mailto:aidin@acme-genie.com">Envelope</a></div>
<div><h3>Ahmad Aji Santoso</h3><p>Mid-level Frontend Engineer</p><a href="mailto:aji@acme-genie.com">Envelope</a></div>
</body></html>`;
const geniePeople = [
  { firstName: 'Adina', lastName: 'Popa', title: 'Manager of Executive Operations' },
  { firstName: 'Aidin', lastName: 'Tavvafi', title: 'Sr. Backend Developer' },
  { firstName: 'Ahmad', lastName: 'Aji Santoso', title: 'Mid-level Frontend Engineer' },
];
const genieRun = (people = geniePeople) => findContacts({ company: 'Acme Genie', role: 'Product Leader', jobUrl: 'https://acme-genie.com/careers/?ashby_jid=1', jobText: 'Product Leader at Acme Genie. Shape our product.' }, {
  fetchPage: fetcher({ 'https://acme-genie.com': genies.replace('Meet the genies', 'Acme Genie revenue management for hotels'), 'https://acme-genie.com/genies': genies }),
  extractPeople: async (text, options) => (options?.source === 'posting' ? [] : people),
  resolveMx: async () => true,
});

test('FL-1: a middle name pairs aji@ with Ahmad Aji Santoso, so no ahmad@ guess and no "inbox" best', async () => {
  const pairs = pairAddressesWithPeople([{ email: 'aji@acme-genie.com', url: 'u' }, { email: 'adina@acme-genie.com', url: 'u' }], geniePeople);
  assert.deepEqual(pairs.map(pair => `${pair.email}=${pair.person.firstName}/${pair.pattern}`), ['aji@acme-genie.com=Ahmad/middle', 'adina@acme-genie.com=Adina/first']);
  // Two people with that middle name: no pair.
  assert.deepEqual(pairAddressesWithPeople([{ email: 'aji@x.io' }], [{ firstName: 'Ahmad', lastName: 'Aji Santoso' }, { firstName: 'Budi', lastName: 'Aji Putra' }]), []);

  const out = await genieRun();
  const aji = out.contacts.find(c => c.email === 'aji@acme-genie.com');
  assert.equal(aji.kind, 'person');
  assert.equal(aji.firstName, 'Ahmad');
  assert.ok(!out.contacts.some(c => c.email === 'ahmad@acme-genie.com'), 'no guess for a person already paired');
  assert.equal(out.patternEvidence.pattern, 'first', 'the middle name casts no vote');
  assert.notEqual(out.best?.email, 'aji@acme-genie.com');
});

test('FL-1: an unpaired single word on a first@ site, or a word of a found name, is someone\'s own address', async () => {
  // "Ahmad Santoso" goes by aji@: no name pairs it, but adina@ shows first@.
  const out = await genieRun(geniePeople.map(p => (p.firstName === 'Ahmad' ? { ...p, lastName: 'Santoso' } : p)));
  const aji = out.contacts.find(c => c.email === 'aji@acme-genie.com');
  assert.equal(aji.kind, 'generic');
  assert.equal(out.best, null);
  assert.ok(out.notes.some(note => /adresse personnelle non identifiée/.test(note)));

  const inbox = email => ({ email, kind: 'generic', persona: 'inbox', confidence: 'verified', mx: true, sources: [{ type: 'site', url: 'https://acme-genie.com/genies' }] });
  const first = { namePattern: 'first', nameTokens: new Set() };
  assert.equal(bestBlocker(inbox('aji@acme-genie.com'), first), 'adresse personnelle non identifiée');
  assert.equal(bestBlocker(inbox('aji@acme-genie.com'), {}), '', 'without evidence an unknown word stays an inbox');
  assert.equal(bestBlocker(inbox('nicolas@acme.io'), { nameTokens: new Set(['nicolas', 'begin']) }), 'adresse personnelle non identifiée');
  assert.equal(bestBlocker(inbox('milan.novak@acme.io'), {}), 'adresse personnelle non identifiée', 'first.last kept from the people by its city word');
  assert.equal(bestBlocker(inbox('boutique.paris@acme.io'), {}), '');
  // Real inboxes and the company's own name stay pickable.
  for (const email of ['hello@acme-genie.com', 'contact@acme-genie.com', 'jobs@acme-genie.com', 'acmegenie@acme-genie.com', 'genie@acme-genie.com']) {
    assert.equal(bestBlocker(inbox(email), first), '', email);
  }
  assert.equal(pickBest([inbox('aji@acme-genie.com'), inbox('hello@acme-genie.com')], first)?.email, 'hello@acme-genie.com');
});

// ── FL-2 ────────────────────────────────────────────────────────────────────

test('FL-2: the model\'s "Frontend Lead" read as Frontend / Lead is no person and builds no frontend@', async () => {
  const jobText = 'MLabs is hiring a Senior Frontend Engineer. You will be reporting directly to the Frontend Lead and work with our product team in London.';
  const out = await findContacts({ company: 'MLabs', role: 'Senior Frontend Engineer', jobUrl: 'https://jobs.ashbyhq.com/mlabs/abc', jobText, companyUrlHint: 'https://mlabs.city' }, {
    fetchPage: fetcher({ 'https://mlabs.city': '<html><head><title>MLabs</title></head><body><h1>MLabs</h1></body></html>' }),
    extractPeople: async (text, { source }) => (source === 'posting' ? [{ firstName: 'Frontend', lastName: 'Lead', title: 'Frontend Lead' }, { firstName: 'Benoit', lastName: '', title: 'Cofondateur' }] : []),
    resolveMx: async () => true,
  });
  assert.ok(!out.people.some(p => p.firstName === 'Frontend'));
  assert.ok(!out.contacts.some(c => c.email.startsWith('frontend@')));
});

// ── FL-3 ────────────────────────────────────────────────────────────────────

test('FL-3: a TheOrg page listing the old prolific.co is Prolific\'s when prolific.co redirects to prolific.com', async () => {
  const team = [['Anna Lee', 'Product Design Lead'], ['Tom Ray', 'Chief People Officer']];
  const run = (oldHome) => findContacts({ company: 'Prolific', role: 'Lead Product Designer', companyUrlHint: 'https://prolific.com' }, {
    fetchPage: fetcher({
      'https://prolific.com': '<title>Prolific | Quickly find research participants</title><p>Prolific connects researchers with participants.</p>',
      'https://theorg.com/org/prolific': theOrg('Prolific', 'https://www.prolific.co', team),
      'https://www.prolific.co': oldHome,
    }),
    resolveMx: async () => true,
  });
  const moved = await run({ html: '<title>Prolific</title>', url: 'https://www.prolific.com/' });
  assert.equal(moved.diagnostics.theorg.verdict, 'accepted');
  assert.ok(moved.people.some(p => p.firstName === 'Anna' && p.sources.some(s => s.type === 'theorg')));

  // The old domain still answers on its own: another organisation.
  const stayed = await run({ html: '<title>Prolific Records</title>', url: 'https://www.prolific.co/' });
  assert.equal(stayed.diagnostics.theorg.verdict, 'another organisation (prolific.co)');
  assert.ok(!stayed.people.some(p => p.firstName === 'Anna'));
});

// ── FLR-4 ───────────────────────────────────────────────────────────────────

test('FLR-4: a search pick whose home page redirects to another company\'s domain is not taken', async () => {
  const out = await findContacts({ company: 'Acme Robotics', role: 'Designer', jobUrl: 'https://www.glassdoor.com/job-listing/x-JV_KO0,1_KE2,3.htm', jobText: '' }, {
    fetchPage: fetcher({ 'https://www.acmerobotics.com': { html: '<title>Acme Robotics is now BigCorp | BigCorp</title><p>careers@bigcorp.com</p>', url: 'https://www.bigcorp.com/' } }),
    webSearch: async (query) => (/official website/.test(query) ? [{ title: 'Acme Robotics', url: 'https://www.acmerobotics.com/' }] : []),
    resolveMx: async () => false,
  });
  assert.equal(out.company.domain, '');
  assert.ok(out.notes.some(note => /acmerobotics\.com redirige vers bigcorp\.com/.test(note)));
  assert.ok(!out.contacts.some(c => /bigcorp/.test(c.email)));
});

// ── FLR-5 ───────────────────────────────────────────────────────────────────

test('FLR-5: customer-care desks are help desks, never the best address', () => {
  const desk = email => ({ email, kind: 'generic', persona: 'inbox', confidence: 'verified', mx: true, sources: [{ type: 'site', url: 'https://acme.fr/contact' }] });
  for (const email of ['care@acme.fr', 'customer.care@acme.fr', 'sav@acme.fr', 'assistance@acme.fr', 'clients@acme.fr', 'kundenservice@acme.de']) {
    assert.equal(bestBlocker(desk(email)), 'boîte support', email);
  }
  assert.equal(bestBlocker(desk('careers@acme.fr')), '', 'careers is no care desk');
});

// ── FLR-7 ───────────────────────────────────────────────────────────────────

test('FLR-7: past the deadline no provider call starts; the guess comes from the pattern alone', async () => {
  const calls = [];
  const provider = {
    name: 'fake-provider',
    domainSearch: async () => { calls.push('domainSearch'); return { emails: [] }; },
    findEmail: async () => { calls.push('findEmail'); return {}; },
  };
  let clock = 0;
  const out = await findContacts({ company: 'Acme', role: 'Product Designer', companyUrlHint: 'https://acme.io', jobText: 'Product Designer at Acme. You will report to Marie Dupont, Head of Design.' }, {
    fetchPage: async (url) => { clock += 70000; return ok(url, '<title>Acme</title><p>Acme builds payroll software.</p>'); },
    extractPeople: async (text, { source }) => (source === 'posting' ? [{ firstName: 'Marie', lastName: 'Dupont', title: 'Head of Design' }] : []),
    providers: [provider],
    providerOutages: new Map(),
    resolveMx: async () => true,
    deadlineMs: 60000,
    now: () => clock,
  });
  assert.deepEqual(calls, []);
  assert.equal(out.stopped, 'deadline');
  assert.ok(out.contacts.some(c => c.firstName === 'Marie' && c.status === 'guessed'));
});

// ── FI-4 ────────────────────────────────────────────────────────────────────

test('FI-4: a result is replayed only for the company and role it searched with', () => {
  const src = readFileSync(new URL('../ui/server.mjs', import.meta.url), 'utf8');
  const route = src.slice(src.indexOf("path === '/api/contact-finder' && method === 'GET'"));
  const replayAt = route.indexOf('if (jobUrl && !fresh) {');
  const askedAt = route.indexOf('const asked = contactFinderAskedKey(company, role);');
  assert.ok(askedAt > 0 && askedAt < replayAt, 'the key is taken from the request before the replay');
  assert.match(route.slice(replayAt, route.indexOf("let jobText = '';")), /mine\.asked === asked/);
  assert.match(route, /\{ userKey, found, asked \}\)/);

  const code = src.slice(src.indexOf('const contactFinderCache = new Map();'), src.indexOf('/** The contact fields the page needs'));
  const sandbox = { normalizeUrl: url => String(url).toLowerCase(), Date };
  vm.runInNewContext(`${code}\nthis.key = contactFinderAskedKey; this.remember = rememberContactFinderResult; this.cache = contactFinderCache;`, sandbox);
  assert.equal(sandbox.key(' Acme  Labs ', 'Product Designer'), sandbox.key('acme labs', 'product designer'));
  assert.notEqual(sandbox.key('OneAsset', 'Product Designer'), sandbox.key('Vertech Industrial Systems', 'Product Designer'));
  sandbox.remember('https://jobs.example/7', { jobText: 'posting' }, { userKey: 'owner', found: { contacts: [{ email: 'jobs@acme.io' }], stopped: '' }, asked: sandbox.key('Acme', 'Designer') });
  assert.equal(sandbox.cache.get('https://jobs.example/7').foundByUser.owner.asked, sandbox.key('Acme', 'Designer'));
});

// ── FL-4 ────────────────────────────────────────────────────────────────────

test('FL-4: the people list follows roleRank within each source: the recruiter before a VP Marketing', () => {
  const site = [{ type: 'site', url: 'https://acme.io/team' }];
  const list = peopleForPage({ contacts: [], people: [
    { firstName: 'Cait', lastName: 'Abernethy', title: 'VP Marketing', persona: 'hiring-manager', roleRank: 5, sources: site },
    { firstName: 'Paul', lastName: 'Martin', title: 'CEO & Founder', persona: 'founder', roleRank: 3, sources: site },
    { firstName: 'Claire', lastName: 'Martin', title: 'Head of Design', persona: 'hiring-manager', roleRank: 2, sources: site },
    { firstName: 'Emily', lastName: 'Pham', title: 'Talent Acquisition Associate', persona: 'recruiter', roleRank: 1, sources: site },
    { firstName: 'Zoe', lastName: 'Kim', title: 'Recruiter', persona: 'recruiter', roleRank: 1, sources: [{ type: 'search', url: 'https://www.linkedin.com/in/zoe' }] },
  ] });
  assert.deepEqual(list.map(person => person.firstName), ['Emily', 'Claire', 'Paul', 'Cait', 'Zoe']);
  // Without a roleRank (an older result), the persona still orders them.
  const old = peopleForPage({ contacts: [], people: [
    { firstName: 'Ann', lastName: 'Lee', title: 'Engineer', persona: 'unknown', sources: site },
    { firstName: 'Paul', lastName: 'Martin', title: 'CEO', persona: 'founder', sources: site },
    { firstName: 'Emily', lastName: 'Pham', title: 'Recruiter', persona: 'recruiter', sources: site },
  ] });
  assert.deepEqual(old.map(person => person.firstName), ['Emily', 'Paul', 'Ann']);
});
