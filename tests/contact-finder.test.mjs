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
import {
  bestBlocker,
  isPolicyPage,
  labelSaysAvoid,
  lastVariants,
  mergePostingPeople,
  nameFromLocal,
  pairAddressesWithPeople,
  patternEvidence,
  pickForwardTarget,
  PROVIDER_OUTAGE_MS,
  ProviderUnavailable,
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

test('pickCrawlLinks keeps internal contact/about/legal links, contact first, the legal notice before about', () => {
  const html = `<a href="/about/">About</a><a href="https://tryriot.com/privacy/">Privacy</a><a href="/blog/post">Post</a><a href="/contact">Contact us</a><a href="https://twitter.com/riot">Twitter</a><a href="/mentions-legales">Mentions légales</a>`;
  const links = pickCrawlLinks(html, 'https://tryriot.com/');
  assert.deepEqual(links, ['https://tryriot.com/contact', 'https://tryriot.com/mentions-legales', 'https://tryriot.com/about', 'https://tryriot.com/privacy']);
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
  // FP6: the domain word is never a required term; it is an OR only for a confirmed site.
  assert.match(queries[1].query, /^site:linkedin\.com\/in "Riot" \("Head of Design"/);
  assert.match(peopleQueries({ company: 'Riot', role: 'Product Designer', domain: 'tryriot.com', confirmed: true })[1].query, /^site:linkedin\.com\/in \("Riot" OR tryriot\) \("Head of Design"/);
  assert.deepEqual(peopleQueries({ company: '' }), []);
});

test('email patterns: apply, detect, infer and candidates', () => {
  assert.equal(applyPattern('first.last', 'Jean-Pierre', 'Durand'), 'jeanpierre.durand');
  // FP4: a particle is joined to the surname ('Le Roux' → leroux), the last word is an alternative.
  assert.equal(applyPattern('flast', 'Élodie', 'Le Roux'), 'eleroux');
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
  // partenariats@ is a partnerships inbox: avoided (FL3-5), still no person.
  assert.equal(kinds['partenariats@acme.io'], 'avoid');
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
  // FP4: an address on a domain without MX stays listed (last), never best.
  assert.deepEqual(ranked.map(c => c.email), ['jobs@acme.io', 'marie.dupont@acme.io', 'jean@acme.io', 'x@dead.io']);
  assert.equal(pickBest(ranked).email, 'jobs@acme.io');
  assert.equal(pickBest(rankContacts([contacts[4]])), null);
  assert.equal(pickBest(rankContacts([contacts[1]])), null);
  assert.ok(scoreContact(contacts[0]) > scoreContact(contacts[3]));
});

test('findContacts: site crawl, posting address, search people, pattern from the site, MX gate', async () => {
  const pages = {
    'https://acme.io': { html: '<html><a href="/contact">Contact</a><a href="/about">About</a><p>Acme builds payroll APIs for small teams across Europe.</p></html>' },
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
  // FP4: one person-shaped address with no name beside it (paul.martin@) only
  // orders the guesses; it takes a paired name or 2+ agreeing addresses for 'likely'.
  assert.equal(byEmail['claire.martin@acme.io'].confidence, 'guess');
  assert.ok(byEmail['claire.martin@acme.io'].sources.some(s => s.detail === 'schéma probable : first.last (1 adresse du site)'));
  assert.equal(out.patternEvidence.basis, 'shape');
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
  // FP4: addresses printed only on a privacy page are listed, never drafted for.
  assert.ok(out.contacts.indexOf(paul) < out.contacts.findIndex(c => c.email === 'support@tryriot.com'));
  assert.ok(paul.tags.includes('page confidentialité ou presse'));
  assert.equal(out.best, null);
});

// ── FP4: pattern evidence, address-name pairing, best-pick safety ───────────
// A site served from literal pages: '/path' keys under one origin, 404 elsewhere.
function siteFetcher(pages) {
  return async (url) => {
    const key = String(url).replace(/\/$/, '');
    const html = pages[key];
    return html === undefined
      ? { ok: false, status: 404, html: '', text: '', url: key, error: 'HTTP 404' }
      : { ok: true, status: 200, html, text: pageText(html), url: key };
  };
}

test('role and department mailboxes are never people, never named, never pattern evidence', () => {
  const found = extractEmails('<p>people.ops@acme.io equipe.rh@acme.io office.manager@acme.io compta.paris@acme.io human-resources@acme.io marie.dupont@acme.io</p>', { domain: 'acme.io' });
  const kinds = Object.fromEntries(found.map(item => [item.email, item.kind]));
  assert.equal(kinds['people.ops@acme.io'], 'hiring');
  assert.equal(kinds['equipe.rh@acme.io'], 'hiring');
  assert.equal(kinds['human-resources@acme.io'], 'hiring');
  assert.equal(kinds['office.manager@acme.io'], 'department');
  assert.equal(kinds['compta.paris@acme.io'], 'department');
  assert.equal(kinds['marie.dupont@acme.io'], 'person');
  assert.equal(extractEmails('<p>jean.paris@acme.io</p>', { domain: 'acme.io' })[0].kind, 'other');
  assert.deepEqual(nameFromLocal('human-resources'), { firstName: '', lastName: '' });
  assert.deepEqual(nameFromLocal('office.manager'), { firstName: '', lastName: '' });
  assert.deepEqual(nameFromLocal('paul.martin'), { firstName: 'Paul', lastName: 'Martin' });
  assert.equal(inferPattern(['equipe.rh@x.fr', 'office.manager@x.fr']), '');
  assert.equal(patternEvidence([], [{ email: 'equipe.rh@x.fr' }, { email: 'office.manager@x.fr' }]).pattern, '');
});

test('case A: a hiring inbox printed on the site is no first.last evidence', async () => {
  const out = await findContacts({ company: 'Acme', role: 'Product Designer', companyUrlHint: 'https://acme.io' }, {
    fetchPage: siteFetcher({
      'https://acme.io': '<a href="/team">Team</a><a href="/contact">Contact</a><p>Acme builds payroll software for small teams in Europe.</p>',
      'https://acme.io/contact': '<p>Join us: people.ops@acme.io</p>',
      'https://acme.io/team': '<p>Claire Martin, Head of Design</p>',
    }),
    resolveMx: async () => true,
  });
  const byEmail = Object.fromEntries(out.contacts.map(c => [c.email, c]));
  assert.equal(byEmail['people.ops@acme.io'].kind, 'hiring');
  assert.equal(byEmail['people.ops@acme.io'].firstName, '');
  assert.equal(byEmail['people.ops@acme.io'].persona, 'recruiter');
  assert.equal(byEmail['claire.martin@acme.io'].confidence, 'guess');
  assert.equal(out.patternEvidence.pattern, '');
  assert.equal(out.best.email, 'people.ops@acme.io');
});

test('case B: nicolas@ printed beside "Nicolas Bégin" is his address and makes first@ likely for the team', async () => {
  const out = await findContacts({ company: 'Cureety', role: 'Product Designer', companyUrlHint: 'https://cureety.com' }, {
    fetchPage: siteFetcher({
      'https://cureety.com': '<a href="/mentions-legales">Mentions légales</a><a href="/equipe">Équipe</a><p>Cureety accompagne les patients atteints de cancer entre deux consultations.</p>',
      'https://cureety.com/mentions-legales': '<p>Directeur de la publication : Nicolas Bégin</p><p>Contact : nicolas@cureety.com</p><p>contact@cureety.com</p>',
      'https://cureety.com/equipe': '<p>Julie Martin, CTO</p>',
    }),
    resolveMx: async () => true,
  });
  const byEmail = Object.fromEntries(out.contacts.map(c => [c.email, c]));
  const nicolas = byEmail['nicolas@cureety.com'];
  assert.equal(nicolas.kind, 'person');
  assert.equal(nicolas.persona, 'founder');
  assert.equal(nicolas.confidence, 'verified');
  assert.equal(`${nicolas.firstName} ${nicolas.lastName}`, 'Nicolas Bégin');
  assert.ok(!out.contacts.some(c => c.email.startsWith('nicolas.') || c.email === 'nbegin@cureety.com'));
  assert.equal(byEmail['julie@cureety.com'].confidence, 'likely');
  assert.ok(byEmail['julie@cureety.com'].sources.some(s => s.detail === 'schéma du site : nicolas@ = Nicolas Bégin'));
  assert.deepEqual({ pattern: out.patternEvidence.pattern, basis: out.patternEvidence.basis, support: out.patternEvidence.support }, { pattern: 'first', basis: 'paired', support: 1 });
  assert.equal(out.best.email, 'nicolas@cureety.com');
  // Two people sharing the first name: no pair.
  assert.deepEqual(pairAddressesWithPeople([{ email: 'nicolas@x.fr' }], [{ firstName: 'Nicolas', lastName: 'Bégin' }, { firstName: 'Nicolas', lastName: 'Roy' }]), []);
});

test('a posting address beside its owner\'s name counts like a site address', async () => {
  const out = await findContacts({ company: 'Acme', role: 'Product Designer', companyUrlHint: 'https://acme.io', jobText: 'Questions? Paul Martin, Head of Talent: paul.martin@acme.io' }, {
    fetchPage: siteFetcher({
      'https://acme.io': '<a href="/team">Team</a><p>Acme builds payroll software for small teams in Europe.</p>',
      'https://acme.io/team': '<p>Claire Martin, Head of Design</p>',
    }),
    resolveMx: async () => true,
  });
  const byEmail = Object.fromEntries(out.contacts.map(c => [c.email, c]));
  assert.equal(byEmail['paul.martin@acme.io'].persona, 'recruiter');
  assert.equal(byEmail['paul.martin@acme.io'].title, 'Head of Talent');
  assert.equal(byEmail['claire.martin@acme.io'].confidence, 'likely');
  assert.ok(byEmail['claire.martin@acme.io'].sources.some(s => s.detail === 'schéma du site : paul.martin@ = Paul Martin'));
});

test('Secfix: the posting\'s "I\'m Grigory, co-founder and CTO" and the site\'s Grigory Emelianov are one person', async () => {
  const jobText = 'Hi, I\'m Grigory, co-founder and CTO at Secfix. You will design our compliance product. Final interview with Grigory.';
  const out = await findContacts({ company: 'Secfix', role: 'Product Designer', companyUrlHint: 'https://secfix.com', jobText }, {
    fetchPage: siteFetcher({
      'https://secfix.com': '<a href="/about-us">About us</a><p>Secfix automates security compliance for European startups.</p>',
      'https://secfix.com/about-us': '<p>Grigory Emelianov, CTO</p>',
    }),
    extractPeople: async (text, { source } = {}) => (source === 'posting' ? [{ firstName: 'Grigory', lastName: '', title: 'co-founder and CTO' }] : []),
    resolveMx: async () => true,
  });
  const grigories = out.people.filter(p => p.firstName === 'Grigory');
  assert.equal(grigories.length, 1);
  assert.equal(grigories[0].lastName, 'Emelianov');
  assert.equal(grigories[0].title, 'co-founder and CTO');
  assert.deepEqual([...new Set(grigories[0].sources.map(s => s.type))].sort(), ['posting', 'site']);
  const addresses = out.contacts.filter(c => c.firstName === 'Grigory');
  assert.equal(addresses.length, 1);
  assert.equal(addresses[0].email, 'grigory.emelianov@secfix.com');
  assert.equal(addresses[0].alternatives.length, 2);
  // A first name that is not unique among full names, or another role, stays apart.
  const people = new Map([
    ['anna ', { firstName: 'Anna', lastName: '', title: 'Head of Design', persona: 'hiring-manager', sources: [{ type: 'posting' }] }],
    ['anna roux', { firstName: 'Anna', lastName: 'Roux', title: 'Talent Partner', persona: 'recruiter', sources: [{ type: 'search' }] }],
  ]);
  assert.equal(mergePostingPeople(people).size, 2);
});

test('compound surnames: the particle joins the name, the last word is the alternative, and simple-name evidence leaves them a guess', async () => {
  assert.deepEqual(lastVariants('Le Roux'), ['leroux', 'roux']);
  assert.deepEqual(lastVariants('de La Fontaine'), ['delafontaine', 'fontaine']);
  assert.deepEqual(lastVariants('Dupont'), ['dupont']);
  assert.equal(detectPattern('e.roux@acme.io', 'Élodie', 'Le Roux'), 'f.last');
  assert.deepEqual(emailCandidates({ firstName: 'Élodie', lastName: 'Le Roux', domain: 'acme.io', knownPattern: 'first.last' }).slice(0, 3).map(c => c.email), ['elodie.leroux@acme.io', 'elodie.roux@acme.io', 'elodie@acme.io']);
  const out = await findContacts({ company: 'Acme', role: 'Product Designer', companyUrlHint: 'https://acme.io' }, {
    fetchPage: siteFetcher({
      'https://acme.io': '<a href="/team">Team</a><p>Acme builds payroll software for small teams in Europe.</p>',
      'https://acme.io/team': '<p>Paul Martin, CTO: paul.martin@acme.io</p><p>Élodie Le Roux, Head of Design</p><p>Marc Petit, Head of Product</p>',
    }),
    resolveMx: async () => true,
  });
  const byEmail = Object.fromEntries(out.contacts.map(c => [c.email, c]));
  assert.equal(byEmail['marc.petit@acme.io'].confidence, 'likely');
  assert.equal(byEmail['elodie.leroux@acme.io'].confidence, 'guess');
  assert.deepEqual(byEmail['elodie.leroux@acme.io'].alternatives, ['elodie.roux@acme.io', 'elodie@acme.io']);
});

test('labels: a DPO, press or partnership address is dropped; neighbours keep their own label', async () => {
  assert.equal(labelSaysAvoid('Délégué à la protection des données : paul.martin@acme.io', 'paul.martin@acme.io'), true);
  assert.equal(labelSaysAvoid('Partnerships: paul.durand@acme.io', 'paul.durand@acme.io'), true);
  assert.equal(labelSaysAvoid('Contact: support@acme.io, dpo@acme.io, paul@acme.io', 'support@acme.io'), false);
  assert.equal(labelSaysAvoid('Contact: support@acme.io, dpo@acme.io, paul@acme.io', 'paul@acme.io'), false);
  assert.equal(labelSaysAvoid('Our press kit is online. Write to hello@acme.io', 'hello@acme.io'), false);
  assert.equal(labelSaysAvoid('Administrateur délégué : jean@acme.be', 'jean@acme.be'), false);
  assert.equal(labelSaysAvoid('Anna Roux, anna@acme.io (partnerships)', 'anna@acme.io'), true);
  // Page text keeps its lines: a footer link above is not a label, a heading above an address is.
  assert.equal(labelSaysAvoid('Presse\nMentions légales\nContact\ncontact@acme.fr', 'contact@acme.fr'), false);
  assert.equal(labelSaysAvoid('Presse\nnous écrire : contact@acme.fr', 'contact@acme.fr'), false);
  assert.equal(labelSaysAvoid('Délégué à la protection des données\npaul.martin@acme.io', 'paul.martin@acme.io'), true);
  assert.ok(isPolicyPage('https://acme.io/fr/politique-de-confidentialite'));
  assert.ok(isPolicyPage('https://acme.io/legal/privacy'));
  assert.ok(isPolicyPage('https://acme.io/press'));
  assert.ok(!isPolicyPage('https://acme.io/mentions-legales'));
  assert.ok(!isPolicyPage('https://acme.io/impressum'));
  assert.ok(!isPolicyPage('https://acme.io/legal-notice'));
  const out = await findContacts({ company: 'Acme', role: 'Product Designer', companyUrlHint: 'https://acme.io', jobText: 'You will report to Claire Martin, Head of Design.' }, {
    fetchPage: siteFetcher({
      'https://acme.io': '<a href="/contact">Contact</a><a href="/privacy">Privacy</a><p>Acme builds payroll software for small teams in Europe.</p>',
      'https://acme.io/contact': '<p>Partnerships: paul.durand@acme.io</p><p>Jobs: jobs@acme.io</p>',
      'https://acme.io/privacy': '<p>Délégué à la protection des données : marc.roy@acme.io</p>',
    }),
    resolveMx: async () => true,
  });
  const emails = out.contacts.map(c => c.email);
  assert.ok(!emails.includes('paul.durand@acme.io'));
  assert.ok(!emails.includes('marc.roy@acme.io'));
  assert.ok(emails.includes('jobs@acme.io'));
  assert.equal(out.best.email, 'jobs@acme.io');
});

test('best-pick safety: a typo\'d DPO mailto, support@, a privacy page and an unconfirmed domain are never best; an Impressum inbox can be', async () => {
  const mindera = await findContacts({ company: 'Mindera', role: 'Product Designer', companyUrlHint: 'https://mindera.com' }, {
    fetchPage: siteFetcher({
      'https://mindera.com': '<a href="/privacy-policy">Privacy policy</a><p>Mindera builds software products with clients across Europe and beyond.</p>',
      'https://mindera.com/privacy-policy': '<p>Through email to the following address: <a href="mailto:pdpo@mindera.com">dpo@mindera.com</a></p><p>Questions: hello.team@mindera.com</p>',
    }),
    resolveMx: async () => true,
  });
  assert.ok(!mindera.contacts.some(c => /dpo@/.test(c.email)));
  assert.equal(mindera.best, null);
  assert.ok(mindera.notes.some(note => /choisie d'office/.test(note) && /page confidentialité ou presse/.test(note)));

  const europace = await findContacts({ company: 'Europace', role: 'Product Designer', companyUrlHint: 'https://europace.de' }, {
    fetchPage: siteFetcher({
      'https://europace.de': '<a href="/impressum">Impressum</a><p>Europace ist der Marktplatz für Immobilienfinanzierungen in Deutschland.</p>',
      'https://europace.de/impressum': '<p>Europace AG, Heidestraße 8, 10557 Berlin. E-Mail: info@europace.de</p>',
    }),
    resolveMx: async () => true,
  });
  assert.equal(europace.best.email, 'info@europace.de');

  const helpDesk = await findContacts({ company: 'Acme', role: 'Product Designer', companyUrlHint: 'https://acme.io' }, {
    fetchPage: siteFetcher({
      'https://acme.io': '<a href="/contact">Contact</a><p>Acme builds payroll software for small teams in Europe.</p>',
      'https://acme.io/contact': '<p>support@acme.io</p>',
    }),
    resolveMx: async () => true,
  });
  assert.ok(helpDesk.contacts.some(c => c.email === 'support@acme.io'));
  assert.equal(helpDesk.best, null);

  const jobs = { email: 'jobs@acme.io', firstName: '', lastName: '', kind: 'hiring', persona: 'recruiter', confidence: 'verified', sources: [{ type: 'site', url: 'https://acme.io/careers' }], mx: true };
  // The posting's address at another domain carrying the name (an address
  // only the unconfirmed site prints is blocked like its own: FL3-2).
  const elsewhere = { ...jobs, email: 'careers@acme-careers.com', sources: [{ type: 'posting', url: 'https://jobs.lever.co/acme/1' }] };
  assert.equal(pickBest(rankContacts([jobs]), { domainConfirmed: false, domain: 'acme.io' }), null);
  assert.equal(bestBlocker(jobs, { domainConfirmed: false, domain: 'acme.io' }), 'site non confirmé');
  assert.equal(pickBest(rankContacts([jobs, elsewhere]), { domainConfirmed: false, domain: 'acme.io' }).email, 'careers@acme-careers.com');
  assert.equal(pickBest(rankContacts([jobs]), { domainConfirmed: true, domain: 'acme.io' }).email, 'jobs@acme.io');
  const support = { ...jobs, email: 'support@acme.io', kind: 'generic', persona: 'inbox' };
  const contact = { ...support, email: 'contact@acme.io' };
  assert.equal(pickBest(rankContacts([support, contact])).email, 'contact@acme.io');
});

test('pickForwardTarget: the person the posting names when the best contact is an inbox, never a search-only person', async () => {
  const out = await findContacts({ company: 'Acme', role: 'Product Designer', companyUrlHint: 'https://acme.io', jobText: 'You will report to Marie Dupont, Head of Design.' }, {
    fetchPage: siteFetcher({
      'https://acme.io': '<a href="/careers">Careers</a><p>Acme builds payroll software for small teams in Europe.</p>',
      'https://acme.io/careers': '<p>Apply: jobs@acme.io</p>',
    }),
    resolveMx: async () => true,
  });
  assert.equal(out.best.email, 'jobs@acme.io');
  assert.deepEqual(pickForwardTarget(out), { firstName: 'Marie', lastName: 'Dupont', title: 'Head of Design', persona: 'hiring-manager', source: 'posting' });
  const searchOnly = { best: { email: 'jobs@acme.io', firstName: '' }, contacts: [], people: [{ firstName: 'Sarah', lastName: 'Cohen', title: 'Talent Partner', persona: 'recruiter', sources: [{ type: 'search' }] }] };
  assert.equal(pickForwardTarget(searchOnly), null);
  assert.equal(pickForwardTarget({ ...out, best: { ...out.best, firstName: 'Jean' } }), null);
  const founderLast = { best: null, contacts: [], people: [
    { firstName: 'Jean', lastName: 'Durand', title: 'CEO', persona: 'founder', sources: [{ type: 'posting' }] },
    { firstName: 'Lea', lastName: 'Morel', title: 'Design Lead', persona: 'hiring-manager', sources: [{ type: 'site' }] },
  ] };
  assert.equal(pickForwardTarget(founderLast).firstName, 'Lea');
  assert.equal(pickForwardTarget({ ...founderLast, people: founderLast.people.slice(0, 1) }).firstName, 'Jean');
});

test('an unavailable provider is noted once, then skipped for a day', async () => {
  let calls = 0;
  const lemlist = {
    name: 'lemlist',
    async domainSearch() { calls += 1; throw new ProviderUnavailable('lemlist', 'HTTP 402'); },
    async findEmail() { calls += 1; throw new ProviderUnavailable('lemlist', 'HTTP 402'); },
  };
  const providerOutages = new Map();
  const run = at => findContacts({ company: 'Acme', role: 'Product Designer', companyUrlHint: 'https://acme.io' }, {
    fetchPage: siteFetcher({ 'https://acme.io': '<p>Acme builds payroll software for small teams in Europe.</p><p>jobs@acme.io</p>' }),
    providers: [lemlist],
    providerOutages,
    now: () => at,
    resolveMx: async () => true,
  });
  const first = await run(1000);
  assert.ok(first.notes.some(note => /lemlist indisponible/.test(note)));
  assert.equal(calls, 1);
  const second = await run(2000);
  assert.ok(!second.notes.some(note => /lemlist/.test(note)));
  assert.equal(calls, 1);
  const nextDay = await run(1000 + PROVIDER_OUTAGE_MS + 1);
  assert.ok(nextDay.notes.some(note => /lemlist indisponible/.test(note)));
  assert.equal(calls, 2);
});

// ── FP6: people from search and TheOrg ──────────────────────────────────────
const linkedin = (title, snippet = '', slug = title.split(' - ')[0].toLowerCase().replace(/\W+/g, '-')) => ({ title, url: `https://www.linkedin.com/in/${slug}`, snippet });
const isPeopleQuery = query => /site:linkedin\.com\/in/.test(query);

test('parseSearchPerson: middle initials, honorifics, emoji and nicknames no longer drop the person', async () => {
  const { normalizeSearchName } = await import('../lib/contact-finder.mjs');
  const parse = title => parseSearchPerson(linkedin(title), { company: 'Acme' });
  for (const title of ['John A. Smith - VP Engineering - Acme', 'Dr. Jane Doe - CTO - Acme', 'Jane Doe 🚀 - CTO - Acme', 'Jane (Janie) Doe - CTO - Acme']) {
    const person = parse(title);
    assert.ok(person, title);
    assert.equal(person.lastName, title.startsWith('John') ? 'Smith' : 'Doe', title);
  }
  assert.equal(parse('John A. Smith - VP Engineering - Acme').firstName, 'John');
  assert.equal(parse('Dr. Jane Doe - CTO - Acme').title, 'CTO');
  // The text after an emoji is a title part, not the name.
  const headline = parse('Jane Doe ✨ Product Design - Acme | LinkedIn');
  assert.equal(`${headline.firstName} ${headline.lastName}`, 'Jane Doe');
  assert.equal(headline.title, 'Product Design');
  assert.equal(parse('Sarah Kim, PhD - Head of Data - Acme | LinkedIn').title, 'Head of Data');
  assert.equal(normalizeSearchName('Jean-Pierre A. B. Durand'), 'Jean-Pierre Durand');
  assert.equal(normalizeSearchName('Mme Claire Martin'), 'Claire Martin');
  assert.equal(normalizeSearchName('Jane Doe 🇫🇷'), 'Jane Doe');
  // Unchanged: initials alone are still no name.
  assert.equal(parse('Ben N. - CEO - Acme | LinkedIn'), null);
});

test('parseSearchPerson: titles from " · " snippets, and no persona borrowed from the query', async () => {
  const { snippetTitle, provenQueryPersona } = await import('../lib/contact-finder.mjs');
  const opts = { company: 'Europace', domain: 'europace.de' };
  const city = parseSearchPerson(linkedin('Jane Doe - Europace AG | LinkedIn', 'Berlin, Berlin, Germany · Head of Design · Europace AG · I lead the design team'), opts);
  assert.equal(city.title, 'Head of Design');
  assert.equal(city.persona, 'hiring-manager');
  const experience = parseSearchPerson(linkedin('Marc Weber | LinkedIn', 'Head of Design | Fintech | ex-N26 · Experience: Europace · Location: Berlin'), opts);
  assert.equal(experience.title, 'Head of Design');
  assert.equal(snippetTitle('Paris · Head of Design at Europace · 500+ connections', opts), 'Head of Design');
  assert.equal(snippetTitle('Experience: Europace · Education: TU Berlin · Location: Berlin', opts), '');
  assert.equal(snippetTitle('500+ connections · Europace', opts), '', 'a follower count is no title');
  // A bare company segment is enough to tie the person to the company.
  assert.ok(parseSearchPerson(linkedin('Lena Fischer | LinkedIn', 'Berlin · Product Designer · Europace AG'), opts));
  // A headline at another company is not taken for this one.
  const games = parseSearchPerson(linkedin('Léa Bernard - Riot | LinkedIn', '500+ connections · Senior Designer at Riot Games · Paris'), { company: 'Riot' });
  assert.equal(games.title, '');

  // Noah Reed from the founder query: nothing says founder, so unknown.
  const noah = parseSearchPerson(linkedin('Noah Reed - Bellwood Labs | LinkedIn', 'Experience: Bellwood Labs · Education: UT Austin · Location: Austin, Texas'), { company: 'Bellwood Labs' });
  assert.equal(noah.persona, 'unknown');
  assert.equal(provenQueryPersona('founder', `${noah.title} Experience: Bellwood Labs · Education: UT Austin`), 'unknown');
  assert.equal(provenQueryPersona('founder', 'Building Acme as its co-founder'), 'founder');
  assert.equal(provenQueryPersona('founder', 'Geschäftsführer'), 'founder');
  assert.equal(provenQueryPersona('recruiter', 'HR Business Partner'), 'recruiter');
  assert.equal(provenQueryPersona('recruiter', 'Chargée de recrutement'), 'recruiter');
  assert.equal(provenQueryPersona('recruiter', 'Software Engineer'), 'unknown');
  assert.equal(provenQueryPersona('hiring-manager', 'Head of Design'), 'unknown', 'the lead query never lends its persona');
});

test('peopleQueries: recruiter terms by language, design leads include product, the posting\'s reporting line first, no required domain word', async () => {
  const { reportingTitleFromPosting, spareLeadQuery } = await import('../lib/contact-finder.mjs');
  const fr = peopleQueries({ company: 'Doctolib', role: 'Product Designer', domain: 'doctolib.fr', confirmed: true, language: 'fr' });
  assert.equal(fr[0].query, 'site:linkedin.com/in "Doctolib" (recruteur OR recruteuse OR "chargé de recrutement" OR "chargée de recrutement" OR "talent acquisition" OR RH)');
  assert.equal(fr[1].query, 'site:linkedin.com/in "Doctolib" ("Head of Design" OR "Design Lead" OR "Design Director" OR "Head of Product" OR "CPO")', 'doctolib.fr spells the name: no OR');
  const de = peopleQueries({ company: 'Europace', role: 'UX Designer', language: 'de' });
  assert.match(de[0].query, /\(Recruiter OR Recruiterin OR "Talent Acquisition" OR "People & Culture"\)$/);
  const en = peopleQueries({ company: 'Back Market', role: 'Backend Engineer', domain: 'backmarket.com', confirmed: true });
  assert.match(en[0].query, /\(recruiter OR "talent acquisition" OR "talent partner" OR "people partner" OR "people operations"\)$/);
  assert.match(en[1].query, /^site:linkedin\.com\/in "Back Market" \("CTO" OR "VP Engineering"/);
  assert.equal(peopleQueries({ company: 'Acme', role: 'Product Manager', language: 'es' })[0].query.includes('"people operations"'), true, 'other languages fall back to English');
  // A wrong domain no longer narrows the search ('"TripleTen" scamdoc').
  for (const query of peopleQueries({ company: 'TripleTen', role: 'Designer', domain: 'scamdoc.com' })) assert.doesNotMatch(query.query, /scamdoc/);
  assert.match(peopleQueries({ company: 'Riot', role: 'Designer', domain: 'tryriot.com', confirmed: true })[2].query, /^site:linkedin\.com\/in \("Riot" OR tryriot\) \(CEO/);
  assert.doesNotMatch(peopleQueries({ company: 'Riot', role: 'Designer', domain: 'tryriot.com', confirmed: false })[2].query, /tryriot/);

  // The title the posting reports to leads the team-lead query.
  const reporting = peopleQueries({ company: 'Riot', role: 'Backend Engineer', jobText: 'You will report directly to the VP of Engineering and work with a small team.' });
  assert.match(reporting[1].query, /\("VP of Engineering" OR "CTO" OR "VP Engineering"/);
  const same = peopleQueries({ company: 'Riot', role: 'Product Designer', jobText: 'Reporting to our Head of Design, you will' });
  assert.equal((same[1].query.match(/"Head of Design"/g) || []).length, 1, 'no duplicate title');
  for (const [text, expected] of [
    ['You will report to the Head of Product Design.', 'Head of Product Design'],
    ['Reporting to our Chief Product Officer, you will own the app.', 'Chief Product Officer'],
    ['Rattaché(e) au Directeur Produit, vous serez', 'Directeur Produit'],
    ['rattachée à la Directrice du Design et vous travaillerez', 'Directrice du Design'],
    ['Du berichtest direkt an unseren Head of Design und arbeitest', 'Head of Design'],
    ['You will report to Marie Dupont, Head of Design', ''],
    ['You will report to the team lead.', ''],
    ['Nothing about reporting here.', ''],
  ]) assert.equal(reportingTitleFromPosting(text), expected, text);

  // The spare search asks for product leadership the first one did not.
  assert.equal(spareLeadQuery({ company: 'Riot', role: 'Product Designer' }).query, 'site:linkedin.com/in "Riot" ("Chief Product Officer" OR "VP Product" OR "Product Director" OR "CTO")');
  assert.match(spareLeadQuery({ company: 'Riot', role: 'Backend Engineer' }).query, /\("Head of Product" OR "CPO"/);
  assert.equal(spareLeadQuery({ company: '' }), null);
});

const THEORG_HTML = `<html><head><title>Acme Labs | Org Chart</title>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Acme Labs","url":"https://www.acme.io/","employee":[{"@type":"Person","name":"Claire Martin","jobTitle":"Head of Design"},{"@type":"Person","name":"Sarah Cohen","jobTitle":"Senior Technical Recruiter"},{"@type":"Person","name":"X","jobTitle":"CEO"}]}</script>
</head><body><h1>Acme Labs</h1></body></html>`;
const THEORG_RIOT_HTML = '<script type="application/ld+json">{"@type":"Organization","name":"Riot","url":"https://weareriot.com","employee":[{"@type":"Person","name":"Tom Baker","jobTitle":"Creative Director"}]}</script>';

test('TheOrg: slugs, the JSON-LD org chart, and a page accepted only for this company\'s domain', async () => {
  const { theOrgSlugs, parseTheOrgPage, theOrgPageMatches } = await import('../lib/contact-finder.mjs');
  assert.deepEqual(theOrgSlugs('Bellwood Labs'), ['bellwood-labs', 'bellwood']);
  assert.deepEqual(theOrgSlugs('Europace AG'), ['europace']);
  assert.deepEqual(theOrgSlugs(''), []);
  const page = parseTheOrgPage(THEORG_HTML);
  assert.equal(page.name, 'Acme Labs');
  assert.equal(page.domain, 'acme.io');
  assert.deepEqual(page.people.map(p => [p.firstName, p.lastName, p.title, p.persona]), [
    ['Claire', 'Martin', 'Head of Design', 'hiring-manager'],
    ['Sarah', 'Cohen', 'Senior Technical Recruiter', 'recruiter'],
  ]);
  assert.equal(parseTheOrgPage('<p>no org chart</p>'), null);
  assert.ok(theOrgPageMatches(page, { company: 'Acme Labs', domain: 'acme.io' }));
  assert.ok(theOrgPageMatches({ ...page, name: 'Doctolib', domain: 'doctolib.fr' }, { company: 'Doctolib', domain: 'doctolib.com' }), 'a country sibling');
  assert.ok(!theOrgPageMatches({ ...page, name: 'Lindy', domain: 'lindy.ai' }, { company: 'Lindy', domain: 'lindy.com' }), 'lindy.ai is another company');
  assert.ok(!theOrgPageMatches(parseTheOrgPage(THEORG_RIOT_HTML), { company: 'Riot', domain: 'tryriot.com' }), 'riot -> weareriot.com is not tryriot.com');
  assert.ok(!theOrgPageMatches(page, { company: 'Acme Bank', domain: 'acme.io' }), 'the name must match too');
  assert.ok(!theOrgPageMatches(page, { company: 'Acme Labs', domain: '' }));
});

test('findContacts: people searches read 20 results, so a match at index 15 is kept; one candidate per profile', async () => {
  const others = ['Alex Morgan', 'Sam Taylor', 'Chris Lee', 'Jordan Blake', 'Robin Hart', 'Casey Stone', 'Drew Fox', 'Jamie Park', 'Kim Novak', 'Lou Grant', 'Max Reid', 'Noel Ford', 'Pat Quinn', 'Remy Cole', 'Sky Dunn', 'Tess Lane', 'Val Moss', 'Wes Hale', 'Zoe Kerr'];
  const page = others.map(name => linkedin(`${name} - Engineer - Globex | LinkedIn`));
  page.splice(15, 0, linkedin('Claire Martin - Head of Design - Acme | LinkedIn'));
  assert.equal(page.length, 20);
  const asked = [];
  const judged = [];
  const out = await findContacts({ company: 'Acme', role: 'Product Designer', companyUrlHint: 'https://acme.io', jobText: 'Product Designer at Acme.' }, {
    fetchPage: siteFetcher({ 'https://acme.io': '<p>Acme builds payroll software for small teams across Europe.</p>' }),
    webSearch: async (query, { num }) => {
      asked.push({ query, num });
      if (/"Head of Design"/.test(query)) return page.slice(0, num);
      // The founder query returns the same profile under another host.
      return /CEO OR founder/.test(query) ? [{ ...page[15], url: 'https://fr.linkedin.com/in/claire-martin?trk=x' }] : [];
    },
    judgePeople: async (candidates) => { judged.push(...candidates.map(c => c.name)); return candidates.map((_, i) => i); },
    resolveMx: async () => true,
  });
  assert.ok(asked.filter(item => isPeopleQuery(item.query)).every(item => item.num === 20));
  assert.ok(out.people.some(p => p.firstName === 'Claire' && p.lastName === 'Martin' && p.title === 'Head of Design'));
  assert.ok(out.contacts.some(c => c.email === 'claire.martin@acme.io'));
  assert.deepEqual(judged, ['Claire Martin'], 'deduped by LinkedIn profile before the judge');
  const lead = out.diagnostics.queries.find(q => q.persona === 'hiring-manager');
  assert.deepEqual({ results: lead.results, parsed: lead.parsed, kept: lead.kept }, { results: 20, parsed: 1, kept: 1 });
  assert.equal(out.diagnostics.domainSource, 'hint');
  assert.equal(out.diagnostics.peopleBySource.search, 1);
});

test('findContacts: the official-site search and the people searches tell the engine which answer is usable', async () => {
  const verdicts = [];
  const site = 'https://synthlane.studio';
  await findContacts({ company: 'Synthlane', role: 'Product Designer', jobUrl: 'https://someboard.io/job/1', jobText: 'Product Designer\nSynthlane' }, {
    fetchPage: siteFetcher({ [site]: '<title>Synthlane</title><p>Synthlane builds design operations tools for product teams.</p>' }),
    webSearch: async (query, { usable }) => {
      assert.equal(typeof usable, 'function');
      if (/official website/.test(query)) {
        verdicts.push(['site', usable([{ title: 'Synthlane - Crunchbase Company Profile', url: 'https://www.crunchbase.com/organization/synthlane' }, { title: 'Synthlane | LinkedIn', url: 'https://www.linkedin.com/company/synthlane' }])]);
        verdicts.push(['site', usable([{ title: 'Synthlane: design operations', url: `${site}/` }])]);
        return [{ title: 'Synthlane: design operations', url: `${site}/` }];
      }
      verdicts.push(['people', usable([{ title: 'Synthlane', url: `${site}/team` }])]);
      verdicts.push(['people', usable([linkedin('Ana Ruiz - Synthlane | LinkedIn')])]);
      return [];
    },
    resolveMx: async () => true,
  });
  assert.deepEqual(verdicts.slice(0, 4), [['site', false], ['site', true], ['people', false], ['people', true]]);
});

test('findContacts: a founder-query hit keeps an unknown persona unless it says founder', async () => {
  const out = await findContacts({ company: 'Acme', role: 'Product Designer', companyUrlHint: 'https://acme.io', jobText: 'Product Designer at Acme.' }, {
    fetchPage: siteFetcher({ 'https://acme.io': '<p>Acme builds payroll software for small teams across Europe.</p>' }),
    webSearch: async (query) => (/CEO OR founder/.test(query) ? [
      linkedin('Noah Reed - Acme | LinkedIn', 'Experience: Acme · Education: UT Austin · Location: Austin, Texas'),
      linkedin('Léa Bernard - Acme | LinkedIn', 'Experience: Acme · Building Acme as its founder since 2019'),
    ] : []),
    resolveMx: async () => true,
  });
  const noah = out.people.find(p => p.firstName === 'Noah');
  assert.equal(noah.persona, 'unknown');
  assert.equal(noah.queryPersona, 'founder', 'kept for display');
  assert.equal(out.people.find(p => p.firstName === 'Léa').persona, 'founder');
});

test('findContacts: with the domain known, the spare search is a second lead query only when the first found nobody', async () => {
  const run = (leadHits) => {
    const queries = [];
    return findContacts({ company: 'Acme', role: 'Product Designer', companyUrlHint: 'https://acme.io', jobText: 'Product Designer at Acme.' }, {
      fetchPage: siteFetcher({ 'https://acme.io': '<p>Acme builds payroll software for small teams across Europe.</p>' }),
      webSearch: async (query) => { queries.push(query); return /"Head of Design"/.test(query) ? leadHits : []; },
      resolveMx: async () => true,
    }).then(out => ({ out, queries }));
  };
  const empty = await run([]);
  assert.equal(empty.queries.length, 4);
  assert.match(empty.queries[3], /"Chief Product Officer" OR "VP Product"/);
  assert.equal(empty.out.diagnostics.queries.length, 4);
  const found = await run([linkedin('Claire Martin - Head of Design - Acme | LinkedIn')]);
  assert.equal(found.queries.length, 3, 'the lead query found someone: no spare search');
  // No domain before step 4: the official-site search took the fourth slot.
  const queries = [];
  await findContacts({ company: 'Synthlane', role: 'Product Designer', jobUrl: 'https://someboard.io/job/1', jobText: 'Product Designer\nSynthlane' }, {
    fetchPage: siteFetcher({}),
    webSearch: async (query) => { queries.push(query); return []; },
    resolveMx: async () => true,
  });
  assert.equal(queries.length, 4);
  assert.match(queries[0], /official website/);
});

test('findContacts: TheOrg people join with source theorg, skip the judge and score like site people; a namesake page is ignored', async () => {
  const judged = [];
  const fetched = [];
  const pages = { 'https://acme.io': '<p>Acme Labs builds payroll software for small teams across Europe.</p>', 'https://theorg.com/org/acme-labs': THEORG_HTML };
  const out = await findContacts({ company: 'Acme Labs', role: 'Product Designer', companyUrlHint: 'https://acme.io', jobText: 'Product Designer at Acme Labs.' }, {
    fetchPage: async (url) => { fetched.push(url); return siteFetcher(pages)(url); },
    webSearch: async (query) => (/"Head of Design"/.test(query) ? [linkedin('Claire Martin - Head of Design - Acme Labs | LinkedIn'), linkedin('Ezra Lynn - Design Lead - Acme Labs | LinkedIn')] : []),
    judgePeople: async (candidates) => { judged.push(...candidates.map(c => c.name)); return []; },
    resolveMx: async () => true,
  });
  assert.deepEqual(judged, ['Claire Martin', 'Ezra Lynn'], 'only search candidates are judged');
  const claire = out.people.find(p => p.firstName === 'Claire');
  assert.ok(claire.sources.some(s => s.type === 'theorg' && s.url === 'https://theorg.com/org/acme-labs'));
  assert.ok(claire.linkedinUrl, 'the LinkedIn hit TheOrg confirms stays despite the judge');
  assert.ok(!out.people.some(p => p.firstName === 'Ezra'), 'the judge still drops the others');
  const sarah = out.contacts.find(c => c.email === 'sarah.cohen@acme.io');
  assert.equal(sarah.persona, 'recruiter');
  assert.ok(sarah.sources.some(s => s.type === 'theorg'));
  assert.equal(scoreContact(sarah) - scoreContact({ ...sarah, sources: sarah.sources.filter(s => s.type !== 'theorg') }), 1);
  assert.equal(out.company.domain, 'acme.io');
  assert.deepEqual(out.diagnostics.theorg, { url: 'https://theorg.com/org/acme-labs', people: 2, verdict: 'accepted' });
  assert.equal(out.diagnostics.peopleBySource.theorg, 2);
  assert.equal(fetched.filter(url => url.includes('theorg.com')).length, 1, 'one fetch when the first slug answers');

  const riot = await findContacts({ company: 'Riot', role: 'Product Designer', companyUrlHint: 'https://tryriot.com' }, {
    fetchPage: siteFetcher({ 'https://tryriot.com': '<p>Riot secures teams against phishing with short trainings.</p>', 'https://theorg.com/org/riot': THEORG_RIOT_HTML }),
    resolveMx: async () => true,
  });
  assert.ok(!riot.people.some(p => p.sources.some(s => s.type === 'theorg')));
  assert.match(riot.diagnostics.theorg.verdict, /another organisation \(weareriot\.com\)/);
  assert.equal(riot.company.domain, 'tryriot.com', 'TheOrg never changes the domain');
});

test('findContacts: TheOrg tries the second slug after a 404, never after another failure', async () => {
  const theorgFetches = async (status) => {
    const fetched = [];
    await findContacts({ company: 'Bellwood Labs', role: 'Designer', companyUrlHint: 'https://bellwood.io' }, {
      fetchPage: async (url) => {
        if (url.includes('theorg.com')) { fetched.push(url); return { ok: false, status, html: '', text: '', url }; }
        return siteFetcher({ 'https://bellwood.io': '<p>Bellwood Labs designs field software for utilities.</p>' })(url);
      },
      resolveMx: async () => true,
    });
    return fetched;
  };
  assert.deepEqual(await theorgFetches(404), ['https://theorg.com/org/bellwood-labs', 'https://theorg.com/org/bellwood']);
  assert.deepEqual(await theorgFetches(403), ['https://theorg.com/org/bellwood-labs']);
});
