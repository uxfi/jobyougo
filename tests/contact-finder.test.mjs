import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPattern,
  companyDomainFromJobUrl,
  companyPartMatches,
  companyTokens,
  companyWebsiteFromHtml,
  detectPattern,
  domainMatchesCompany,
  domainsFromText,
  emailCandidates,
  extractEmails,
  extractNamedPeople,
  findContacts,
  inferPattern,
  isJobHost,
  nameOnPage,
  pageText,
  parseSearchPerson,
  peopleQueries,
  pickBest,
  pickCrawlLinks,
  pickDomainFromSearch,
  rankContacts,
  registrableDomain,
  roleLeadTitles,
  scoreContact,
} from '../lib/contact-finder.mjs';

test('registrableDomain strips careers/jobs/www prefixes and keeps co.uk', () => {
  assert.equal(registrableDomain('jobs.acme-group.co.uk'), 'acme-group.co.uk');
  assert.equal(registrableDomain('www.tryriot.com'), 'tryriot.com');
  assert.equal(registrableDomain('careers.doctolib.fr'), 'doctolib.fr');
  assert.equal(registrableDomain('app.lemlist.com'), 'lemlist.com');
  assert.equal(registrableDomain('127.0.0.1'), '');
  assert.equal(registrableDomain('localhost'), '');
});

test('companyDomainFromJobUrl ignores ATS and job boards', () => {
  assert.equal(companyDomainFromJobUrl('https://jobs.ashbyhq.com/dust/123'), '');
  assert.equal(companyDomainFromJobUrl('https://www.welcometothejungle.com/en/companies/riot/jobs/x'), '');
  assert.equal(companyDomainFromJobUrl('https://boards.greenhouse.io/affirm/jobs/1'), '');
  assert.equal(companyDomainFromJobUrl('https://careers.qonto.com/jobs/product-designer'), 'qonto.com');
  assert.equal(companyDomainFromJobUrl('https://www.frog.co/careers/jobs/123'), 'frog.co');
  assert.equal(companyDomainFromJobUrl('not a url'), '');
  assert.ok(isJobHost('jobs.eu.lever.co'));
  assert.ok(!isJobHost('lemlist.com'));
});

test('companyTokens and domainMatchesCompany tolerate legal suffixes and prefixes', () => {
  assert.deepEqual(companyTokens('Riot SAS'), ['riot']);
  assert.deepEqual(companyTokens('Acme Labs Inc.'), ['acme']);
  assert.ok(domainMatchesCompany('tryriot.com', 'Riot'));
  assert.ok(domainMatchesCompany('lemlist.com', 'lemlist'));
  assert.ok(domainMatchesCompany('acme-group.co.uk', 'Acme Group'));
  assert.ok(!domainMatchesCompany('google.com', 'Riot'));
});

test('companyWebsiteFromHtml reads hiringOrganization.sameAs from JSON-LD', () => {
  const html = '<html><script type="application/ld+json">{"@context":"https://schema.org","@type":"JobPosting","title":"Designer","description":"x","hiringOrganization":{"@type":"Organization","name":"Riot","sameAs":"www.tryriot.com"}}</script></html>';
  assert.equal(companyWebsiteFromHtml(html), 'https://www.tryriot.com');
  const social = html.replace('www.tryriot.com', 'https://www.linkedin.com/company/riot');
  assert.equal(companyWebsiteFromHtml(social), '');
  assert.equal(companyWebsiteFromHtml('<p>no json</p>'), '');
});

test('domainsFromText ranks the company domain found in the posting', () => {
  const ranked = domainsFromText('Send your CV to jobs@tryriot.com or read more on https://www.welcometothejungle.com/x and https://google.com', 'Riot');
  assert.equal(ranked[0].domain, 'tryriot.com');
  assert.ok(ranked[0].via.includes('email'));
  assert.ok(!ranked.some(item => item.domain === 'welcometothejungle.com'));
});

test('pickDomainFromSearch skips job boards, social sites and unrelated domains', () => {
  const picked = pickDomainFromSearch([
    { title: 'Riot - LinkedIn', url: 'https://www.linkedin.com/company/riot' },
    { title: 'Riot jobs - Welcome to the Jungle', url: 'https://www.welcometothejungle.com/en/companies/riot' },
    { title: 'Riot: Cybersecurity awareness for employees', url: 'https://tryriot.com/' },
  ], 'Riot');
  assert.equal(picked.domain, 'tryriot.com');
  assert.equal(pickDomainFromSearch([{ title: 'Weather', url: 'https://weather.com' }], 'Riot'), null);
});

test('extractEmails keeps company addresses, classifies them and reads mailto + obfuscation', () => {
  const html = `<p>Write to <a href="mailto:jobs@tryriot.com?subject=hi">our team</a> or contact [at] tryriot [dot] com. DPO: dpo@tryriot.com. Marie: marie.dupont@tryriot.com. Not us: hello@gmail.com, x@example.com, logo@2x.png</p>`;
  const found = extractEmails(html, { domain: 'tryriot.com', sourceUrl: 'https://tryriot.com/contact' });
  const byEmail = Object.fromEntries(found.map(item => [item.email, item.kind]));
  assert.equal(byEmail['jobs@tryriot.com'], 'hiring');
  assert.equal(byEmail['contact@tryriot.com'], 'generic');
  assert.equal(byEmail['dpo@tryriot.com'], 'avoid');
  assert.equal(byEmail['marie.dupont@tryriot.com'], 'person');
  assert.equal(byEmail['hello@gmail.com'], undefined);
  assert.equal(byEmail['x@example.com'], undefined);
  assert.ok(found.find(item => item.email === 'jobs@tryriot.com').context.includes('Write to'));
});

test('extractEmails survives hostile pages: bad entities, 400 KB letter runs, odd tokens', () => {
  const long = 'a'.repeat(400000);
  const started = Date.now();
  const found = extractEmails(`<p>&#1114112; &#xFFFFFFFF; ${long} jobs@acme.io ${long}@</p>`, { domain: 'acme.io' });
  assert.ok(Date.now() - started < 2000, 'scan stays fast on a long letter run');
  assert.deepEqual(found.map(item => item.email), ['jobs@acme.io']);
  assert.equal(pageText('<p>&#1114112;x&#65;</p>'), '&#1114112;xA');
});

test('nameOnPage needs the full name, not a stray last name', () => {
  assert.ok(nameOnPage('Our team\nClaire Martin\nHead of Design', { firstName: 'Claire', lastName: 'Martin' }));
  assert.ok(nameOnPage('Martin, Claire · CEO', { firstName: 'Claire', lastName: 'Martin' }));
  assert.ok(!nameOnPage('12 Martin Street, Paris. Contact Claire for press.', { firstName: 'John', lastName: 'Martin' }));
  assert.ok(!nameOnPage('Clairemont Martin', { firstName: 'Claire', lastName: 'Martin' }));
  assert.ok(nameOnPage('Louis, our CTO', { firstName: 'Louis', lastName: '' }));
});

test('pickCrawlLinks keeps internal contact/about/legal links, contact first', () => {
  const html = `<a href="/about/">About</a><a href="https://tryriot.com/privacy/">Privacy</a><a href="/blog/post">Post</a><a href="/contact">Contact us</a><a href="https://twitter.com/riot">Twitter</a><a href="/mentions-legales">Mentions légales</a>`;
  const links = pickCrawlLinks(html, 'https://tryriot.com/');
  assert.deepEqual(links, ['https://tryriot.com/contact', 'https://tryriot.com/about', 'https://tryriot.com/mentions-legales', 'https://tryriot.com/privacy']);
});

test('extractNamedPeople reads French legal notices and English team lines', () => {
  const people = extractNamedPeople([
    'Mentions légales',
    'Directeur de la publication : M. Jean-Pierre Durand',
    'Hébergeur : OVH SAS',
    'Claire Martin, Head of Design',
    'CTO: Paul Lemaire',
    'Capital social : 10 000 €',
  ].join('\n'), { sourceUrl: 'https://acme.fr/mentions-legales' });
  const byName = Object.fromEntries(people.map(p => [`${p.firstName} ${p.lastName}`, p]));
  assert.equal(byName['Jean-Pierre Durand'].persona, 'founder');
  assert.equal(byName['Claire Martin'].title, 'Head of Design');
  assert.equal(byName['Claire Martin'].persona, 'hiring-manager');
  assert.equal(byName['Paul Lemaire'].title, 'CTO');
  assert.equal(byName['Paul Lemaire'].persona, 'founder');
  assert.equal(people.some(p => /OVH|Capital/.test(`${p.firstName} ${p.lastName}`)), false);
});

test('parseSearchPerson reads LinkedIn result titles in both orders and uses the snippet', () => {
  const a = parseSearchPerson({ title: 'Marie Dupont - Head of Design - Riot | LinkedIn', url: 'https://fr.linkedin.com/in/marie-dupont-123', snippet: '' }, { company: 'Riot', domain: 'tryriot.com' });
  assert.equal(a.firstName, 'Marie');
  assert.equal(a.lastName, 'Dupont');
  assert.equal(a.title, 'Head of Design');
  assert.equal(a.persona, 'hiring-manager');
  const b = parseSearchPerson({ title: 'Paul Martin – Riot – Talent Acquisition Manager', url: 'https://www.linkedin.com/in/paulmartin?trk=x', snippet: '' }, { company: 'Riot' });
  assert.equal(b.title, 'Talent Acquisition Manager');
  assert.equal(b.persona, 'recruiter');
  assert.equal(b.linkedinUrl, 'https://www.linkedin.com/in/paulmartin');
  const c = parseSearchPerson({ title: 'Léa Bernard | LinkedIn', url: 'https://www.linkedin.com/in/lea-bernard', snippet: 'Co-founder & CEO at Riot · Experience: Riot · Location: Paris' }, { company: 'Riot' });
  assert.equal(c.title, 'Co-founder & CEO');
  assert.equal(c.persona, 'founder');
  assert.equal(parseSearchPerson({ title: 'Someone Else - Head of Design - Acme | LinkedIn', url: 'https://www.linkedin.com/in/x', snippet: 'Acme' }, { company: 'Riot' }), null);
  assert.equal(parseSearchPerson({ title: 'Riot careers', url: 'https://tryriot.com/careers' }, { company: 'Riot' }), null);
});

test('companyPartMatches is exact: Riot is not Riot Games, but the domain word and legal suffixes are fine', () => {
  assert.ok(companyPartMatches('Riot', 'Riot', 'tryriot.com'));
  assert.ok(companyPartMatches('Riot SAS', 'Riot'));
  assert.ok(companyPartMatches('tryriot', 'Riot', 'tryriot.com'));
  assert.ok(companyPartMatches('Acme Labs Inc', 'Acme Labs'));
  assert.ok(!companyPartMatches('Riot Games', 'Riot', 'tryriot.com'));
  assert.ok(!companyPartMatches('Acme Bank', 'Acme Labs'));
  // A truncated title ("… - Riot ...") hides the rest of the name: not a match.
  assert.ok(!companyPartMatches('Riot ...', 'Riot', 'tryriot.com'));
  assert.ok(!companyPartMatches('Riot …', 'Riot'));
  assert.equal(parseSearchPerson({ title: 'Joshua Parker - Senior Combat Tech Design Lead @ Riot ...', url: 'https://www.linkedin.com/in/jp', snippet: '' }, { company: 'Riot', domain: 'tryriot.com' }), null);
  assert.equal(parseSearchPerson({ title: 'Michael White - Design Lead, Valorant - Riot Games | LinkedIn', url: 'https://www.linkedin.com/in/mwhite', snippet: 'Design Lead at Riot Games' }, { company: 'Riot', domain: 'tryriot.com' }), null);
  assert.equal(parseSearchPerson({ title: 'Ben N. - CEO - Riot | LinkedIn', url: 'https://www.linkedin.com/in/ben-n', snippet: '' }, { company: 'Riot' }), null);
  const lower = parseSearchPerson({ title: 'nicolo laurent - Head of Design - Riot | LinkedIn', url: 'https://www.linkedin.com/in/nl', snippet: '' }, { company: 'Riot' });
  assert.equal(lower.firstName, 'Nicolo');
  assert.equal(lower.lastName, 'Laurent');
  const inTitle = parseSearchPerson({ title: 'Jane Roe - Talent Partner at Riot | LinkedIn', url: 'https://www.linkedin.com/in/janeroe', snippet: '' }, { company: 'Riot' });
  assert.equal(inTitle.title, 'Talent Partner');
  assert.equal(inTitle.persona, 'recruiter');
});

test('people named in the posting become contacts, a first name alone gives first@domain', async () => {
  const out = await findContacts({
    company: 'Acme',
    role: 'Product Designer',
    jobUrl: 'https://jobs.lever.co/acme/1',
    jobText: 'Product Designer at Acme. You will report to Claire Martin, Head of Design. Questions: Louis, our Talent Acquisition Manager, is happy to help.',
    companyUrlHint: 'https://acme.io',
  }, {
    fetchPage: async (url) => (/acme\.io\/?$/.test(url) ? { ok: true, status: 200, html: '<p>Acme</p>', text: 'Acme', url } : { ok: false, status: 404, html: '', text: '', url, error: 'HTTP 404' }),
    webSearch: null,
    extractPeople: async (text, { source }) => (source === 'posting' ? [{ firstName: 'Louis', lastName: '', title: 'Talent Acquisition Manager' }, { firstName: 'Nobody', lastName: 'Here', title: 'CEO' }] : []),
    resolveMx: async () => true,
  });
  const byEmail = Object.fromEntries(out.contacts.map(c => [c.email, c]));
  assert.equal(byEmail['claire.martin@acme.io'].persona, 'hiring-manager');
  assert.ok(byEmail['claire.martin@acme.io'].sources.some(s => s.type === 'posting'));
  assert.equal(byEmail['louis@acme.io'].persona, 'recruiter');
  assert.equal(byEmail['louis@acme.io'].confidence, 'guess');
  assert.equal(byEmail['nobody.here@acme.io'], undefined);
});

test('roleLeadTitles and peopleQueries scope the three searches to the company', () => {
  assert.equal(roleLeadTitles('Senior Product Designer')[0], 'Head of Design');
  assert.equal(roleLeadTitles('Lead Product Manager')[0], 'Head of Product');
  assert.equal(roleLeadTitles('Backend Engineer')[0], 'CTO');
  const queries = peopleQueries({ company: 'Riot', role: 'Product Designer', domain: 'tryriot.com' });
  assert.equal(queries.length, 3);
  assert.deepEqual(queries.map(q => q.persona), ['recruiter', 'hiring-manager', 'founder']);
  assert.match(queries[1].query, /site:linkedin\.com\/in "Riot" tryriot \("Head of Design"/);
  assert.deepEqual(peopleQueries({ company: '' }), []);
});

test('email patterns: apply, detect, infer and candidates', () => {
  assert.equal(applyPattern('first.last', 'Jean-Pierre', 'Durand'), 'jeanpierre.durand');
  assert.equal(applyPattern('flast', 'Élodie', 'Le Roux'), 'eroux');
  assert.equal(applyPattern('first', 'Marie', ''), 'marie');
  assert.equal(applyPattern('first.last', 'Marie', ''), '');
  assert.equal(detectPattern('m.dupont@acme.io', 'Marie', 'Dupont'), 'f.last');
  assert.equal(inferPattern(['marie.dupont@acme.io', 'paul.martin@acme.io', 'j.doe@acme.io']), 'first.last');
  assert.equal(inferPattern(['jobs@acme.io']), '');
  const candidates = emailCandidates({ firstName: 'Marie', lastName: 'Dupont', domain: 'acme.io', knownPattern: 'flast' });
  assert.equal(candidates[0].email, 'mdupont@acme.io');
  assert.equal(candidates[1].email, 'marie.dupont@acme.io');
  assert.deepEqual(emailCandidates({ firstName: '', lastName: 'Dupont', domain: 'acme.io' }), []);
});

test('single-word locals are inboxes, not people; lead-in verbs are dropped from names', () => {
  const found = extractEmails('<p>partenariats@acme.io boutique@acme.io marie.dupont@acme.io m.dupont@acme.io</p>', { domain: 'acme.io' });
  const kinds = Object.fromEntries(found.map(item => [item.email, item.kind]));
  assert.equal(kinds['partenariats@acme.io'], 'other');
  assert.equal(kinds['boutique@acme.io'], 'other');
  assert.equal(kinds['marie.dupont@acme.io'], 'person');
  assert.equal(kinds['m.dupont@acme.io'], 'person');
  const people = extractNamedPeople('Meet Claire Martin, Head of Design\nContact Paul Lemaire, CTO', { sourceUrl: 'x' });
  assert.deepEqual(people.map(p => `${p.firstName} ${p.lastName}`), ['Claire Martin', 'Paul Lemaire']);
});

test('a generic inbox ranks below a likely named recruiter and above a bare guess', () => {
  const ranked = rankContacts([
    { email: 'contact@acme.io', firstName: '', lastName: '', title: '', kind: 'generic', persona: 'inbox', confidence: 'verified', sources: [{ type: 'site' }], mx: true },
    { email: 'sarah.cohen@acme.io', firstName: 'Sarah', lastName: 'Cohen', title: 'Talent Partner', kind: 'person', persona: 'recruiter', confidence: 'likely', sources: [{ type: 'pattern' }, { type: 'search' }], mx: true },
    { email: 'jean@acme.io', firstName: 'Jean', lastName: 'Durand', title: 'CEO', kind: 'person', persona: 'founder', confidence: 'guess', sources: [{ type: 'pattern' }], mx: true },
  ]);
  assert.deepEqual(ranked.map(c => c.email), ['sarah.cohen@acme.io', 'contact@acme.io', 'jean@acme.io']);
});

test('an unknown job-board host is not taken for the company when the name does not match', async () => {
  // The home page does not answer: nothing says the board is the employer, so it is left out.
  const fetchPage = async (url) => ({ ok: false, status: 404, html: '', text: '', url, error: 'HTTP 404' });
  const out = await findContacts({ company: 'Acme', role: 'Designer', jobUrl: 'https://www.some-job-board.io/jobs/123', jobText: 'Designer at Acme.' }, { fetchPage, webSearch: async () => [], resolveMx: async () => true });
  assert.equal(out.company.domain, '');
  assert.equal(out.company.source, '');
  assert.equal(out.company.confirmed, false);
  assert.ok(out.notes.some(note => /some-job-board\.io/.test(note) && /ignoré/.test(note)));
  assert.equal(out.best, null);
  const own = await findContacts({ company: 'Acme', role: 'Designer', jobUrl: 'https://careers.acme.io/jobs/123', jobText: '' }, { fetchPage, webSearch: async () => [], resolveMx: async () => true });
  assert.equal(own.company.source, 'job-url');
  assert.equal(own.company.domain, 'acme.io');
  assert.equal(own.company.confirmed, true);
});

test('a posting host whose home page names the company is kept as job-url-verified', async () => {
  const fetchPage = async (url) => (url === 'https://acme-partners.io'
    ? { ok: true, status: 200, html: '<title>Acme | Payroll for teams</title><p>Write to jobs@acme-partners.io</p>', text: 'Acme | Payroll for teams\nWrite to jobs@acme-partners.io', url }
    : { ok: false, status: 404, html: '', text: '', url, error: 'HTTP 404' });
  const out = await findContacts({ company: 'Acme', role: 'Designer', jobUrl: 'https://www.acme-partners.io/jobs/123', jobText: 'Designer at Acme.' }, { fetchPage, webSearch: async () => [], resolveMx: async () => true });
  assert.equal(out.company.source, 'job-url-verified');
  assert.equal(out.company.domain, 'acme-partners.io');
  assert.equal(out.company.confirmed, true);
  assert.ok(out.contacts.some(c => c.email === 'jobs@acme-partners.io'));
});

test('ranking prefers a verified hiring inbox over a guessed founder address and never picks a guess as best', () => {
  const contacts = [
    { email: 'jobs@acme.io', firstName: '', lastName: '', title: '', kind: 'hiring', persona: 'recruiter', confidence: 'verified', sources: [{ type: 'site', url: 'https://acme.io/careers' }], mx: true },
    { email: 'jean@acme.io', firstName: 'Jean', lastName: 'Durand', title: 'CEO', kind: 'person', persona: 'founder', confidence: 'guess', sources: [{ type: 'pattern' }], mx: true },
    { email: 'dpo@acme.io', firstName: '', lastName: '', title: '', kind: 'avoid', persona: 'inbox', confidence: 'verified', sources: [{ type: 'site' }], mx: true },
    { email: 'marie.dupont@acme.io', firstName: 'Marie', lastName: 'Dupont', title: 'Head of Design', kind: 'person', persona: 'hiring-manager', confidence: 'likely', sources: [{ type: 'pattern' }, { type: 'search' }], mx: true },
    { email: 'x@dead.io', firstName: '', lastName: '', title: '', kind: 'generic', persona: 'inbox', confidence: 'verified', sources: [{ type: 'site' }], mx: false },
  ];
  const ranked = rankContacts(contacts);
  assert.deepEqual(ranked.map(c => c.email), ['jobs@acme.io', 'marie.dupont@acme.io', 'jean@acme.io']);
  assert.equal(pickBest(ranked).email, 'jobs@acme.io');
  assert.equal(pickBest(rankContacts([contacts[1]])), null);
  assert.ok(scoreContact(contacts[0]) > scoreContact(contacts[3]));
});

test('findContacts: site crawl, posting address, search people, pattern from the site, MX gate', async () => {
  const pages = {
    'https://acme.io': { html: '<html><a href="/contact">Contact</a><a href="/about">About</a><p>Acme builds payroll APIs.</p></html>' },
    'https://acme.io/contact': { html: '<p>Press: press@acme.io. Jobs: <a href="mailto:jobs@acme.io">jobs@acme.io</a>. Paul: paul.martin@acme.io</p>' },
    'https://acme.io/about': { html: '<p>Team</p><p>Claire Martin, Head of Design</p><p>CEO: Jean Durand</p>' },
  };
  const fetchPage = async (url) => {
    const key = url.replace(/\/$/, '');
    const page = pages[key];
    if (!page) return { ok: false, status: 404, html: '', text: '', url, error: 'HTTP 404' };
    const text = page.html.replace(/<[^>]+>/g, '\n').replace(/\n+/g, '\n').trim();
    return { ok: true, status: 200, html: page.html, text, url: key };
  };
  const searched = [];
  const webSearch = async (query) => {
    searched.push(query);
    if (/talent acquisition/.test(query)) return [{ title: 'Sarah Cohen - Talent Acquisition Partner - Acme | LinkedIn', url: 'https://www.linkedin.com/in/sarah-cohen', snippet: '' }];
    if (/Head of Design/.test(query)) return [{ title: 'Claire Martin - Head of Design - Acme | LinkedIn', url: 'https://www.linkedin.com/in/claire-martin', snippet: '' }];
    return [];
  };
  const out = await findContacts({
    company: 'Acme',
    role: 'Senior Product Designer',
    jobUrl: 'https://jobs.ashbyhq.com/acme/123',
    jobText: 'Senior Product Designer. Questions? Write to hiring@acme.io',
    jobHtml: '<script type="application/ld+json">{"@type":"JobPosting","title":"t","description":"d","hiringOrganization":{"@type":"Organization","name":"Acme","url":"https://acme.io"}}</script>',
  }, { fetchPage, webSearch, providers: [], resolveMx: async domain => domain === 'acme.io', maxSearches: 4 });

  assert.equal(out.company.domain, 'acme.io');
  assert.equal(out.company.source, 'job-page');
  assert.ok(out.pagesRead.includes('https://acme.io/contact'));
  assert.equal(searched.length, 3);
  const byEmail = Object.fromEntries(out.contacts.map(c => [c.email, c]));
  assert.equal(byEmail['hiring@acme.io'].confidence, 'verified');
  assert.equal(byEmail['hiring@acme.io'].sources[0].type, 'posting');
  assert.equal(byEmail['jobs@acme.io'].kind, 'hiring');
  assert.equal(byEmail['press@acme.io'], undefined);
  assert.equal(byEmail['claire.martin@acme.io'].confidence, 'likely');
  assert.equal(byEmail['claire.martin@acme.io'].persona, 'hiring-manager');
  assert.ok(byEmail['claire.martin@acme.io'].sources.some(s => s.type === 'search'));
  assert.equal(byEmail['sarah.cohen@acme.io'].persona, 'recruiter');
  assert.equal(byEmail['jean.durand@acme.io'].persona, 'founder');
  assert.equal(out.best.email, 'hiring@acme.io');
  assert.match(out.companyText, /payroll APIs/);
});

test('judgePeople drops namesakes found by search, keeps the rest', async () => {
  const out = await findContacts({ company: 'Riot', role: 'Product Designer', jobUrl: 'https://jobs.lever.co/riot/1', jobText: 'Product Designer at Riot, cybersecurity awareness.', companyUrlHint: 'https://tryriot.com' }, {
    fetchPage: async (url) => (/tryriot\.com\/?$/.test(url) ? { ok: true, status: 200, html: '<p>Riot secures teams against phishing.</p>', text: 'Riot secures teams against phishing.', url } : { ok: false, status: 404, html: '', text: '', url, error: 'HTTP 404' }),
    webSearch: async (query) => (/Head of Design/.test(query)
      ? [
        { title: 'Ezra Lynn - Design Lead - Riot | LinkedIn', url: 'https://www.linkedin.com/in/ezra', snippet: 'Design Lead at Riot · Games' },
        { title: 'Marie Dupont - Head of Design - Riot | LinkedIn', url: 'https://www.linkedin.com/in/marie', snippet: 'Head of Design at Riot · cybersecurity' },
      ]
      : []),
    judgePeople: async (candidates) => candidates.map((c, i) => (/Marie/.test(c.name) ? i : -1)).filter(i => i >= 0),
    resolveMx: async () => true,
    maxSearches: 3,
  });
  const emails = out.contacts.map(c => c.email);
  assert.ok(emails.includes('marie.dupont@tryriot.com'));
  assert.ok(!emails.includes('ezra.lynn@tryriot.com'));
});

test('findContacts without a domain only keeps posting addresses and says so', async () => {
  const out = await findContacts({ company: 'Nowhere', role: 'Designer', jobUrl: 'https://jobs.lever.co/nowhere/1', jobText: 'Apply at careers@nowhere.io' }, {
    fetchPage: async () => ({ ok: false, status: 0, html: '', text: '', url: '', error: 'no' }),
    webSearch: async () => [],
    resolveMx: async () => true,
  });
  // The posting's own address reveals the domain; the site itself is down.
  assert.equal(out.company.domain, 'nowhere.io');
  assert.equal(out.company.source, 'posting-text');
  assert.equal(out.contacts[0].email, 'careers@nowhere.io');
  assert.equal(out.contacts[0].confidence, 'verified');
  assert.ok(out.notes.some(note => /n'a pas répondu/.test(note)));

  const none = await findContacts({ company: 'Ghost', role: 'Designer', jobUrl: 'https://jobs.lever.co/ghost/1', jobText: 'No address here.' }, {
    fetchPage: async () => ({ ok: false, status: 0, html: '', text: '', url: '', error: 'no' }),
    webSearch: async () => [],
    resolveMx: async () => true,
  });
  assert.equal(none.company.domain, '');
  assert.deepEqual(none.contacts, []);
  assert.ok(none.notes.some(note => /introuvable/.test(note)));
});

test('support@ is a generic fallback, not an address to avoid; names come from first.last locals', async () => {
  const out = await findContacts({ company: 'Riot', role: 'Designer', jobUrl: 'https://www.welcometothejungle.com/en/companies/riot/jobs/x', jobText: '', companyUrlHint: 'https://www.tryriot.com' }, {
    fetchPage: async (url) => (/privacy/.test(url)
      ? { ok: true, status: 200, html: '<p>Contact: support@tryriot.com, dpo@tryriot.com, paul.martin@tryriot.com</p>', text: 'Contact: support@tryriot.com, dpo@tryriot.com, paul.martin@tryriot.com', url }
      : /tryriot\.com\/?$/.test(url) ? { ok: true, status: 200, html: '<a href="/privacy">Privacy</a>', text: 'Privacy', url } : { ok: false, status: 404, html: '', text: '', url, error: 'HTTP 404' }),
    webSearch: null,
    resolveMx: async () => true,
  });
  assert.equal(out.company.source, 'hint');
  const emails = out.contacts.map(c => c.email);
  assert.ok(emails.includes('support@tryriot.com'));
  assert.ok(!emails.includes('dpo@tryriot.com'));
  const paul = out.contacts.find(c => c.email === 'paul.martin@tryriot.com');
  assert.equal(paul.firstName, 'Paul');
  assert.equal(paul.lastName, 'Martin');
  assert.equal(paul.persona, 'unknown');
  assert.equal(out.best.email, 'paul.martin@tryriot.com');
});
