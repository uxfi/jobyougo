// The employer's domain: strict name affinity, one non-employer host list, a
// ranked search pick checked on its home page (scamdoc.com was taken for
// TripleTen, builtin.com for Bellwood Labs, jobgether.com for its own
// offers). Fixtures only, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  companyDomainFromJobUrl,
  companyWebsiteFromHtml,
  domainMatchesCompany,
  domainNameAffinity,
  findContacts,
  homepageNamesCompany,
  isJobHost,
  isSocialHost,
  pickDomainFromSearch,
  rankDomainCandidates,
} from '../lib/contact-finder.mjs';
import { isNotEmployerHost, NON_EMPLOYER_HOST_RE } from '../lib/non-employer-hosts.mjs';

const page = (url, html) => ({ ok: true, status: 200, url, html, text: html.replace(/<[^>]+>/g, '\n').replace(/\n+/g, '\n').trim() });
const missing = (url) => ({ ok: false, status: 404, html: '', text: '', url, error: 'HTTP 404' });

const SCAMDOC_HOME = '<title>ScamDoc - Vérifiez la fiabilité d\'un site</title><meta property="og:site_name" content="ScamDoc"><p>Contact us: contact@scamdoc.com</p><p>Latest: tripleten.com</p><footer>&copy; 2026 ScamDoc</footer>';
const BUILTIN_HOME = '<title>Built In: Tech Jobs and Startup Companies</title><p>Bellwood Labs is hiring. Email support@builtin.com</p><footer>© 2026 Built In</footer>';

test('domainNameAffinity: exact, affix and token forms match', () => {
  const cases = [
    ['tryriot.com', 'Riot', 'affix'],
    ['getalan.com', 'Alan', 'affix'],
    ['datadoghq.com', 'Datadog', 'affix'],
    ['linear.app', 'Linear', 'exact'],
    ['acme-group.co.uk', 'Acme Group', 'exact'],
    ['chess.com', 'Chess Com', 'exact'],
    ['bellwoodlabs.com', 'Bellwood Labs', 'exact'],
    ['vertech.com', 'Vertech Industrial Systems', 'token'],
    ['qonto.com', 'Qonto', 'exact'],
    ['mlabs.city', 'MLabs', 'exact'],
    ['bjak.my', 'Bjak', 'exact'],
    ['acme.io', 'Acme Labs SAS', 'exact'],
  ];
  for (const [domain, company, affinity] of cases) assert.equal(domainNameAffinity(domain, company), affinity, `${domain} ~ ${company}`);
});

test('domainNameAffinity: substrings, namesakes and generic words do not match', () => {
  const cases = [
    ['bell.ca', 'Bellwood Labs'],
    ['wood.com', 'Bellwood Labs'],
    ['europa.eu', 'Europace'],
    ['riotgames.com', 'Riot'],
    ['lindyhop.com', 'Lindy'],
    ['datadog.com', 'Data Solutions'],
    ['smartsheet.com', 'Smart Studio'],
    ['scamdoc.com', 'Doc Labs'],
    ['builtin.com', 'Built Technologies'],
    ['onecom.com', 'One'],
    ['google.com', 'Riot'],
    ['', 'Riot'],
    ['acme.io', ''],
  ];
  for (const [domain, company] of cases) {
    assert.equal(domainNameAffinity(domain, company), '', `${domain} ~ ${company}`);
    assert.equal(domainMatchesCompany(domain, company), false, `${domain} ~ ${company}`);
  }
});

test('rankDomainCandidates: the official site ranks first, directories never qualify', () => {
  const tripleten = rankDomainCandidates([
    { title: 'tripleten.com : avis et fiabilité | ScamDoc', url: 'https://www.scamdoc.com/view/1093431' },
    { title: 'TripleTen: Online Coding Bootcamp', url: 'https://tripleten.com/' },
  ], 'TripleTen');
  assert.equal(tripleten[0].domain, 'tripleten.com');
  assert.equal(tripleten[0].origin, 'https://tripleten.com');
  assert.equal(tripleten[0].affinity, 'exact');
  assert.ok(!tripleten.some(item => item.domain === 'scamdoc.com'));

  const bellwood = rankDomainCandidates([
    { title: 'Bellwood Labs | Built In', url: 'https://builtin.com/company/bellwood-labs' },
    { title: 'Bellwood Labs', url: 'https://www.bellwoodlabs.com/' },
  ], 'Bellwood Labs');
  assert.deepEqual(bellwood.map(item => item.domain), ['bellwoodlabs.com']);

  const riot = rankDomainCandidates([
    { title: 'Riot Games', url: 'https://www.riotgames.com/' },
    { title: 'Riot', url: 'https://tryriot.com/' },
  ], 'Riot');
  assert.equal(riot[0].domain, 'tryriot.com');
  assert.equal(riot.length, 1);

  assert.deepEqual(rankDomainCandidates([
    { title: 'Acme Studio | Malt', url: 'https://www.malt.fr/profile/acme' },
    { title: 'Acme Studio — Pappers', url: 'https://www.pappers.fr/entreprise/acme' },
    { title: 'Acme Studio | Built In', url: 'https://builtin.com/company/acme-studio' },
  ], 'Acme Studio'), []);
});

test('rankDomainCandidates keeps one entry per domain, home page above a page about the company', () => {
  const ranked = rankDomainCandidates([
    { title: 'Acme reviews', url: 'https://acme.io/company/acme-reviews' },
    { title: 'Acme | Payroll APIs', url: 'https://acme.io/' },
    { title: 'Acme HQ', url: 'https://acmehq.com/about' },
  ], 'Acme');
  assert.deepEqual(ranked.map(item => item.domain), ['acme.io', 'acmehq.com']);
  assert.equal(ranked[0].url, 'https://acme.io/');
  assert.ok(ranked[0].score > ranked[1].score);
  assert.equal(pickDomainFromSearch([{ title: 'Bellwood Labs | Built In', url: 'https://builtin.com/company/bellwood-labs' }], 'Bellwood Labs'), null);
});

test('non-employer hosts: boards, ATS tenants, directories and shared hosting, with a same-name escape hatch', () => {
  for (const host of ['jobgether.com', 'www.arbeitnow.com', 'justjoin.it', 'candidat.francetravail.fr', 'builtinnyc.com', 'acme.hibob.com', 'www.scamdoc.com', 'kununu.com', 'clutch.co', 'malt.fr', 'acme.github.io', 'acme.webflow.io', 'x.gouv.fr', 'levels.fyi', 'foundit.sg']) {
    assert.ok(isNotEmployerHost(host), host);
  }
  for (const host of ['acme.io', 'tryriot.com', 'careers.qonto.com', 'malt.acme.com']) assert.ok(!isNotEmployerHost(host), host);
  // A company literally named like the platform owns it; a tenant page never does.
  assert.ok(!isNotEmployerHost('clutch.co', { company: 'Clutch' }));
  assert.ok(!isNotEmployerHost('www.deel.com', { company: 'Deel Inc.' }));
  assert.ok(isNotEmployerHost('clutch.co', { company: 'MLabs' }));
  assert.ok(isNotEmployerHost('acme.github.io', { company: 'GitHub' }));
  assert.ok(NON_EMPLOYER_HOST_RE.test('jobs.lever.co'));
  // isJobHost / isSocialHost keep their old, narrower meaning.
  assert.ok(isJobHost('jobs.eu.lever.co'));
  assert.ok(!isJobHost('jobgether.com'));
  assert.ok(isSocialHost('pappers.fr'));
  assert.ok(!isSocialHost('scamdoc.com'));
});

test('companyDomainFromJobUrl and companyWebsiteFromHtml skip boards and directories', () => {
  assert.equal(companyDomainFromJobUrl('https://jobgether.com/offer/x'), '');
  assert.equal(companyDomainFromJobUrl('https://builtin.com/job/designer/123'), '');
  assert.equal(companyDomainFromJobUrl('https://careers.qonto.com/jobs/1'), 'qonto.com');
  const ld = (org) => `<script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', title: 'Designer', hiringOrganization: { '@type': 'Organization', ...org } })}</script>`;
  assert.equal(companyWebsiteFromHtml(ld({ name: 'MindFi', sameAs: 'https://builtin.com/company/mindfi' })), '');
  assert.equal(companyWebsiteFromHtml(ld({ name: 'Acme', sameAs: ['https://linkedin.com/company/acme', 'https://acme.io'] })), 'https://acme.io');
  // The entry carrying the name wins over the first one left.
  assert.equal(companyWebsiteFromHtml(ld({ name: 'Acme', sameAs: ['https://www.agency-partner.com'], url: 'https://acme.io' })), 'https://acme.io');
  assert.equal(companyWebsiteFromHtml(ld({ name: 'Acme', sameAs: ['https://www.agency-partner.com'] })), 'https://www.agency-partner.com');
});

test('homepageNamesCompany reads title, site name, JSON-LD and the © line, never a directory', () => {
  assert.equal(homepageNamesCompany(SCAMDOC_HOME, 'TripleTen'), false);
  assert.equal(homepageNamesCompany(BUILTIN_HOME, 'Bellwood Labs'), false);
  assert.equal(homepageNamesCompany('<title>TripleTen AI Programs</title>', 'TripleTen'), true);
  assert.equal(homepageNamesCompany('<meta content="Acme" property="og:site_name"><title>Welcome</title>', 'Acme'), true);
  assert.equal(homepageNamesCompany('<title>Home</title><script type="application/ld+json">{"@type":"Organization","name":"Bellwood Labs, Inc."}</script>', 'Bellwood Labs'), true);
  assert.equal(homepageNamesCompany('<title>Welcome</title><footer>&copy; 2026 Vertech Industrial Systems LLC</footer>', 'Vertech Industrial Systems'), true);
  assert.equal(homepageNamesCompany('<title>Lindy Hop Society</title>', 'Lindy Electronics'), false);
  assert.equal(homepageNamesCompany('', 'Acme'), false);
});

test('findContacts: a jobgether offer with no search answer gets no domain and no board address', async () => {
  const fetchPage = async (url) => (/jobgether\.com\/?$/.test(url) ? page(url, '<title>Jobgether</title><footer>support@jobgether.com</footer>') : missing(url));
  const out = await findContacts({ company: 'Synthlane', role: 'Product Designer', jobUrl: 'https://jobgether.com/offer/68f1-product-designer', jobText: 'Product Designer\nSynthlane\nRemote' }, { fetchPage, webSearch: async () => [], resolveMx: async () => true });
  assert.equal(out.company.domain, '');
  assert.equal(out.company.confirmed, false);
  assert.ok(!out.contacts.some(c => c.email.endsWith('@jobgether.com')));
  assert.equal(out.best, null);
});

test('findContacts: the search pick is the named official site, read once, never the directory', async () => {
  const calls = [];
  const fetchPage = async (url) => {
    calls.push(url);
    if (/scamdoc\.com/.test(url)) return page(url, SCAMDOC_HOME);
    if (url === 'https://tripleten.com') return page(url, '<title>TripleTen AI Programs</title><a href="/contact">Contact</a>');
    if (url === 'https://tripleten.com/contact') return page(url, '<p>Careers: jobs@tripleten.com</p>');
    return missing(url);
  };
  const webSearch = async (query) => (/official website/.test(query)
    ? [{ title: 'tripleten.com : avis et fiabilité | ScamDoc', url: 'https://www.scamdoc.com/view/1093431' }, { title: 'TripleTen: Online Coding Bootcamp', url: 'https://tripleten.com/' }]
    : []);
  const out = await findContacts({ company: 'TripleTen', role: 'Product Designer', jobUrl: 'https://uk.indeed.com/viewjob?jk=411b', jobText: 'Sr. Product Designer\nTripleTen\nWe are looking for a designer.' }, { fetchPage, webSearch, resolveMx: async () => true });
  assert.equal(out.company.domain, 'tripleten.com');
  assert.equal(out.company.source, 'search');
  assert.equal(out.company.confirmed, true);
  assert.equal(out.company.website, 'https://tripleten.com');
  assert.ok(!out.contacts.some(c => c.email.endsWith('@scamdoc.com')));
  assert.ok(out.contacts.some(c => c.email === 'jobs@tripleten.com'));
  assert.equal(calls.filter(url => url === 'https://tripleten.com').length, 1, 'the accepted home page is fetched once');
  assert.ok(!calls.some(url => /scamdoc/.test(url)), 'a directory is never fetched');
});

test('findContacts: a search candidate whose home page names someone else is dropped for the next one', async () => {
  const fetchPage = async (url) => {
    if (url === 'https://www.lindy.com') return page(url, '<title>This domain is for sale</title><footer>© 2026 Domain Brokers</footer>');
    if (url === 'https://www.getlindy.ai') return page(url, '<title>Lindy | Your AI assistant</title>');
    return missing(url);
  };
  const webSearch = async (query) => (/official website/.test(query)
    ? [{ title: 'lindy.com', url: 'https://www.lindy.com/' }, { title: 'Lindy | Your AI assistant', url: 'https://www.getlindy.ai/' }]
    : []);
  const out = await findContacts({ company: 'Lindy', role: 'Designer', jobUrl: 'https://jobs.ashbyhq.com/lindy/1', jobText: 'Designer at Lindy.' }, { fetchPage, webSearch, resolveMx: async () => true });
  assert.equal(out.company.domain, 'getlindy.ai');
  assert.equal(out.company.confirmed, true);
  assert.ok(out.notes.some(note => /lindy\.com ne mentionne pas « Lindy »/.test(note)));
});

test('findContacts: an unreadable search pick is kept only when it is the name itself, unconfirmed', async () => {
  const webSearch = async (query) => (/official website/.test(query) ? [{ title: 'Acme', url: 'https://acme.io/' }] : []);
  const exact = await findContacts({ company: 'Acme', role: 'Designer', jobUrl: 'https://jobs.ashbyhq.com/acme/1', jobText: 'Designer at Acme.' }, { fetchPage: async url => missing(url), webSearch, resolveMx: async () => true });
  assert.equal(exact.company.domain, 'acme.io');
  assert.equal(exact.company.source, 'search');
  assert.equal(exact.company.confirmed, false);
  const affixOnly = async (query) => (/official website/.test(query) ? [{ title: 'Acme', url: 'https://tryacme.io/' }] : []);
  const out = await findContacts({ company: 'Acme', role: 'Designer', jobUrl: 'https://jobs.ashbyhq.com/acme/1', jobText: 'Designer at Acme.' }, { fetchPage: async url => missing(url), webSearch: affixOnly, resolveMx: async () => true });
  assert.equal(out.company.domain, '');
});

test('findContacts: a posting address at a domain carrying the name beats search and is kept beside the chosen domain', async () => {
  const searched = [];
  const out = await findContacts({
    company: 'Acme',
    role: 'Designer',
    jobUrl: 'https://jobs.ashbyhq.com/acme/1',
    jobText: 'Designer at Acme.',
    jobHtml: '<p>Apply: <a href="mailto:talent@acmehq.com">write to us</a></p>',
  }, { fetchPage: async url => missing(url), webSearch: async (query) => { searched.push(query); return []; }, resolveMx: async () => true });
  assert.equal(out.company.domain, 'acmehq.com');
  assert.equal(out.company.source, 'posting-email');
  assert.equal(out.company.confirmed, true);
  assert.ok(!searched.some(query => /official website/.test(query)));

  const both = await findContacts({
    company: 'Acme',
    role: 'Designer',
    jobUrl: 'https://jobs.ashbyhq.com/acme/1',
    jobText: 'Designer at Acme. Questions: marie.dupont@acme-careers.com. Agency: bob@recruit-partner.com',
    companyUrlHint: 'https://acme.io',
  }, { fetchPage: async url => missing(url), webSearch: null, resolveMx: async () => true });
  const emails = both.contacts.map(c => c.email);
  assert.equal(both.company.domain, 'acme.io');
  assert.ok(emails.includes('marie.dupont@acme-careers.com'), 'another domain carrying the name is kept');
  assert.ok(!emails.includes('bob@recruit-partner.com'), 'an unrelated domain is not');
});
