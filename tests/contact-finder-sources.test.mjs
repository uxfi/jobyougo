// Free employer-site sources before any web search (FP3): the offer's own ATS
// account or board (Ashby publicWebsite, Greenhouse board, Lever header logo,
// Workable account, WTTJ organisation), the LinkedIn company page, and a
// guess from the name checked by MX and the home page. The board owner
// replaces a tracker company it contradicts ("Lindy" on Ashby board
// bjakcareer is a Bjak offer). Recorded fixture bodies only, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { companyWebsiteFromHtml, findContacts, registrableDomain } from '../lib/contact-finder.mjs';
import {
  ashbyAppData,
  atsSiteLookups,
  atsSlugDomain,
  cleanOwnerName,
  greenhouseBoard,
  greenhouseJobsSite,
  guessDomainsFromName,
  isParkedPage,
  leverHeaderLogo,
  linkedinCompanyPage,
  linksToBoard,
  lookupEmployerSite,
  siteRoot,
  tenantSite,
  workableAccount,
  workableJob,
  wttjOrganization,
} from '../lib/employer-site-sources.mjs';

const page = (url, html) => ({ ok: true, status: 200, url, html, text: html.replace(/<[^>]+>/g, '\n').replace(/\n+/g, '\n').trim() });
const json = (url, body) => ({ ok: true, status: 200, url, json: body });
const missing = (url) => ({ ok: false, status: 404, html: '', text: '', url, error: 'HTTP 404' });
const host = (url) => registrableDomain(new URL(url).hostname);

// The board page as Ashby serves it (2026-10-23 capture of jobs.ashbyhq.com/bjakcareer, trimmed).
const ashbyPage = (name, site, slug) => `<!DOCTYPE html><html lang="en"><head><title>Jobs</title></head><body><div id="root"><div class="spinner"></div></div>
    <script nonce="GlJIguGH4KxfVtMM7yk48AGIJ7HzahpGnRiSNlCAP9s">
      window.__appData = {"ddRumApplicationId":"80e0bf43","environment":"production","maintenanceMode":false,"organization":{"organizationId":"cfdb13fd-7d62-4b21-a335-caf230b55bd2","name":${JSON.stringify(name)},"publicWebsite":${site ? JSON.stringify(site) : 'null'},"customJobsPageUrl":null,"hostedJobsPageSlug":"${slug}","allowJobPostIndexing":true,"isDemoOrg":false,"theme":{"colors":{"version":"1","colorPrimary600":"#000"}}},"posting":null};
    </script></body></html>`;

test('readers: each ATS answer gives the employer site and the account name', () => {
  const ashby = ashbyAppData(ashbyPage('Bjak ', 'https://bjak.my/en/about-us', 'bjakcareer'));
  assert.equal(host(ashby.website), 'bjak.my');
  assert.equal(ashby.ownerName, 'Bjak');
  // A blob cut short by the page size cap is still read by pattern.
  const cut = ashbyPage('Secfix', 'https://secfix.com', 'secfix');
  assert.equal(host(ashbyAppData(cut.slice(0, cut.indexOf('"allowJobPostIndexing"'))).website), 'secfix.com');
  assert.equal(ashbyAppData(ashbyPage('Acme', '', 'acme')).website, '', 'no publicWebsite');

  assert.equal(host(workableAccount({ name: 'MLabs', url: 'https://mlabs.city' }).website), 'mlabs.city');
  assert.equal(workableAccount({ name: 'MLabs', url: 'https://mlabs.city' }).ownerName, 'MLabs');
  assert.equal(host(workableJob({ title: 'Product Designer', company: { name: 'MLabs', website: 'https://mlabs.city' } }).website), 'mlabs.city');

  const gh = greenhouseJobsSite({ jobs: [
    { title: 'Designer', absolute_url: 'https://job-boards.greenhouse.io/datadog/jobs/1' },
    { title: 'Designer', absolute_url: 'https://careers.datadoghq.com/detail/123/?gh_jid=123', company_name: 'Datadog' },
  ] });
  assert.equal(host(gh.website), 'datadoghq.com');
  assert.equal(siteRoot(gh.website), 'https://datadoghq.com', 'a careers subdomain is not the site to crawl');
  assert.equal(gh.ownerName, 'Datadog');
  const board = greenhouseBoard({ name: 'Doctolib', content: '&lt;p&gt;Learn more on &lt;a href=&quot;https://www.doctolib.com/&quot;&gt;our site&lt;/a&gt; or &lt;a href=&quot;https://www.linkedin.com/company/doctolib&quot;&gt;LinkedIn&lt;/a&gt;&lt;/p&gt;' });
  assert.equal(board.ownerName, 'Doctolib');
  assert.equal(host(board.website), 'doctolib.com');

  assert.equal(host(wttjOrganization({ media_website_url: 'https://alan.com/' }).website), 'alan.com');
  assert.deepEqual(wttjOrganization({ organization: { name: 'Hubvisory', media_website_url: 'https://hubvisory.com' } }), { website: 'https://hubvisory.com/', ownerName: 'Hubvisory' });

  const palantir = leverHeaderLogo('<div class="main-header-content"><a href="https://jobs.lever.co/palantir" class="main-header-logo"><img alt="Palantir logo" src="https://lever-client-logos.s3.amazonaws.com/p.png"></a></div>');
  assert.equal(palantir.website, '', 'a logo linking back to lever.co is no site');
  assert.equal(palantir.ownerName, 'Palantir');
  assert.equal(host(leverHeaderLogo('<a class="main-header-logo" href="http://spotifyjobs.com"><img alt="Spotify logo" src="s.png"></a>').website), 'spotifyjobs.com');
  assert.equal(leverHeaderLogo('<title>Deliverect</title><p>no logo link</p>').ownerName, 'Deliverect');

  const teamtailor = '<meta property="og:site_name" content="Deezer"><a href="https://www.facebook.com/deezerfr">Facebook</a><a href="https://www.teamtailor.com/privacy">Privacy</a><a href="https://www.deezer.com/fr/">deezer.com</a>';
  assert.deepEqual(tenantSite(teamtailor, 'https://deezer.teamtailor.com/', ''), { website: 'https://www.deezer.com', ownerName: 'Deezer' });
  assert.equal(host(tenantSite('<title>Careers</title>', 'https://careers.bunq.com/', 'bunq').website), 'bunq.com', 'a tenant that redirects off the vendor');
  assert.equal(tenantSite('<a href="https://other-agency.com">x</a>', 'https://acme.recruitee.com/', 'Acme').website, '');
});

test('readers: an error or an unexpected shape gives empty fields quietly', () => {
  const empty = { website: '', ownerName: '' };
  for (const value of [null, undefined, '', 42, 'not json', [], { jobs: 'x' }, { organization: 'x' }, { company: null }, { name: { first: 'x' } }]) {
    for (const read of [greenhouseBoard, greenhouseJobsSite, workableAccount, workableJob, wttjOrganization]) assert.deepEqual(read(value), empty, `${read.name}(${JSON.stringify(value)})`);
  }
  for (const value of [null, '', '<html></html>', 'window.__appData = {"organization":', '<a class="main-header-logo">']) {
    assert.deepEqual(ashbyAppData(value), empty);
    assert.equal(leverHeaderLogo(value).website, '');
    assert.deepEqual(tenantSite(value, 'not a url', ''), empty);
  }
  // A site field that is a board, a social profile or not a URL is no site.
  assert.equal(workableAccount({ name: 'Acme', url: 'https://apply.workable.com/acme/' }).website, '');
  assert.equal(wttjOrganization({ name: 'Acme', media_website_url: 'https://www.linkedin.com/company/acme' }).website, '');
  assert.equal(workableJob({ company: { name: 'Acme', website: 'javascript:alert(1)' } }).website, '');
});

test('atsSiteLookups: the public endpoints a job URL lets the finder ask', () => {
  const plan = url => atsSiteLookups(url).map(item => `${item.kind} ${item.url} ${item.read}`);
  assert.deepEqual(plan('https://jobs.ashbyhq.com/bjakcareer/7451bd8d-56cd-4ac3-9240-eb774486d576/application'), ['html https://jobs.ashbyhq.com/bjakcareer ashbyAppData']);
  assert.equal(atsSiteLookups('https://jobs.ashbyhq.com/bjakcareer/1')[0].slim, false, 'the Ashby blob is an inline script');
  assert.deepEqual(plan('https://job-boards.eu.greenhouse.io/prolific/jobs/4831281101'), [
    'json https://boards-api.greenhouse.io/v1/boards/prolific greenhouseBoard',
    'json https://boards-api.greenhouse.io/v1/boards/prolific/jobs greenhouseJobsSite',
  ]);
  assert.equal(atsSiteLookups('https://boards.greenhouse.io/embed/job_app?for=acme&token=1')[0].slug, 'acme');
  assert.deepEqual(plan('https://jobs.eu.lever.co/acme/123'), ['html https://jobs.eu.lever.co/acme leverHeaderLogo']);
  assert.deepEqual(plan('https://apply.workable.com/mlabs/j/ABC123/'), ['json https://apply.workable.com/api/v1/accounts/mlabs workableAccount']);
  assert.deepEqual(plan('https://jobs.workable.com/view/qwN1GeTcELCZiCDL9PABoA/remote-product-designer-in-poland-at-mlabs'), ['json https://jobs.workable.com/api/v1/jobs/qwN1GeTcELCZiCDL9PABoA workableJob']);
  assert.deepEqual(plan('https://www.welcometothejungle.com/fr/companies/alan/jobs/product-designer_paris'), ['json https://api.welcometothejungle.com/api/v1/organizations/alan wttjOrganization']);
  assert.deepEqual(plan('https://busuu.teamtailor.com/jobs/123-designer'), ['html https://busuu.teamtailor.com/ tenantSite']);
  assert.deepEqual(plan('https://aerolab.recruitee.com/o/designer'), ['html https://aerolab.recruitee.com/ tenantSite']);
  assert.deepEqual(plan('https://uk.indeed.com/viewjob?jk=411b'), []);
  assert.deepEqual(plan('https://www.linkedin.com/jobs/view/1?url=https://jobs.lever.co/acme'), [], 'a board quoted in the query string is not the offer\'s');
  assert.deepEqual(plan('not a url'), []);
  assert.deepEqual(atsSlugDomain('https://jobs.ashbyhq.com/kraken.com/123'), { domain: 'kraken.com', ats: 'ashby' });
  assert.equal(atsSlugDomain('https://jobs.ashbyhq.com/lindy/1'), null);
  assert.equal(atsSlugDomain('https://jobs.ashbyhq.com/jobgether.com/1'), null, 'a board named after a job board is no hint');
});

test('lookupEmployerSite: two requests at most, a time budget, and the caller decides on the site', async () => {
  const calls = [];
  const fetchPage = async (url, opts) => { calls.push([url, opts]); return json(url, url.endsWith('/jobs') ? { jobs: [{ absolute_url: 'https://www.acme.io/jobs/1' }] } : { name: 'Acme' }); };
  const out = await lookupEmployerSite('https://job-boards.greenhouse.io/acme/jobs/1', { fetchPage });
  assert.deepEqual(calls.map(([url, opts]) => [url, opts.as]), [['https://boards-api.greenhouse.io/v1/boards/acme', 'json'], ['https://boards-api.greenhouse.io/v1/boards/acme/jobs', 'json']]);
  assert.deepEqual({ website: out.website, ownerName: out.ownerName, ats: out.ats, requests: out.requests }, { website: 'https://www.acme.io', ownerName: 'Acme', ats: 'greenhouse', requests: 2 });

  const refused = await lookupEmployerSite('https://job-boards.greenhouse.io/acme/jobs/1', { fetchPage, accept: () => false });
  assert.equal(refused.website, '');
  assert.equal(refused.ownerName, 'Acme');

  const one = await lookupEmployerSite('https://job-boards.greenhouse.io/acme/jobs/1', { fetchPage: async url => { calls.push([url]); return missing(url); }, maxRequests: 1 });
  assert.equal(one.requests, 1);

  const started = Date.now();
  const slow = await lookupEmployerSite('https://jobs.ashbyhq.com/acme/1', { fetchPage: () => new Promise(() => {}), budgetMs: 30 });
  assert.ok(Date.now() - started < 1000, 'the budget ends the lookup');
  assert.equal(slow.website, '');

  const thrown = await lookupEmployerSite('https://jobs.ashbyhq.com/acme/1', { fetchPage: async () => { throw new Error('boom'); } });
  assert.equal(thrown.website, '');
  assert.deepEqual(await lookupEmployerSite('https://uk.indeed.com/viewjob?jk=1', { fetchPage }), { website: '', ownerName: '', ats: '', slug: '', requests: 0 });
});

test('findContacts: the Ashby account gives the site, so no official-site search runs', async () => {
  const calls = [];
  const fetchPage = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (url === 'https://jobs.ashbyhq.com/secfix') return page(url, opts.slim === false ? ashbyPage('Secfix', 'https://secfix.com', 'secfix') : '<div id="root"></div>');
    if (url === 'https://secfix.com') return page(url, '<title>Secfix | Compliance automation</title><p>Questions? hello@secfix.com</p>');
    return missing(url);
  };
  const queries = [];
  const webSearch = async (query) => { queries.push(query); return []; };
  const out = await findContacts({ company: 'Secfix', role: 'Product Designer', jobUrl: 'https://jobs.ashbyhq.com/secfix/3fd72701-4c0e-4f1c-9d8a-6a1e2c5b9f10', jobText: 'Product Designer\nSecfix\nRemote' }, { fetchPage, webSearch, resolveMx: async () => true });
  assert.equal(out.company.source, 'ats:ashby');
  assert.equal(out.company.domain, 'secfix.com');
  assert.equal(out.company.confirmed, true);
  assert.equal(out.company.overridden, '');
  assert.deepEqual(out.domainChoices, []);
  assert.deepEqual(calls[0], { url: 'https://jobs.ashbyhq.com/secfix', opts: { slim: false } }, 'the board page is read unslimmed, first');
  assert.ok(!queries.some(query => /official website|site officiel/.test(query)), 'no search for the site');
  assert.ok(out.contacts.some(contact => contact.email === 'hello@secfix.com' && contact.status === 'found'));
});

test('findContacts: the board owner replaces a tracker company it contradicts, not one it agrees with', async () => {
  const fetchPage = async (url, opts = {}) => {
    if (url === 'https://jobs.ashbyhq.com/bjakcareer' && opts.slim === false) return page(url, ashbyPage('Bjak ', 'https://bjak.my/en/about-us', 'bjakcareer'));
    if (url === 'https://bjak.my') return page(url, '<title>BJAK | Compare insurance</title><p>Hello from Bjak.</p>');
    if (url === 'https://boards-api.greenhouse.io/v1/boards/ddome' && opts.as === 'json') return json(url, { name: 'DataDome', content: '<p>Bot protection</p>' });
    if (url === 'https://boards-api.greenhouse.io/v1/boards/ddome/jobs' && opts.as === 'json') return json(url, { jobs: [{ absolute_url: 'https://job-boards.greenhouse.io/ddome/jobs/1' }, { absolute_url: 'https://datadome.co/careers/?gh_jid=2' }] });
    if (url === 'https://datadome.co') return page(url, '<title>DataDome | Bot protection</title>');
    return missing(url);
  };
  const queries = [];
  const webSearch = async (query) => { queries.push(query); return []; };
  const lindy = await findContacts({ company: 'Lindy', role: 'Product Designer (UX), HCI', jobUrl: 'https://jobs.ashbyhq.com/bjakcareer/7451bd8d-56cd-4ac3-9240-eb774486d576/application', jobText: 'Product Designer (UX), HCI @ Bjak' }, { fetchPage, webSearch, resolveMx: async () => true });
  assert.equal(lindy.company.name, 'Bjak');
  assert.equal(lindy.company.overridden, 'Lindy');
  assert.equal(lindy.company.domain, 'bjak.my');
  assert.equal(lindy.company.source, 'ats:ashby');
  assert.ok(lindy.notes.some(note => /« Lindy » ne correspond pas au compte ATS « Bjak » : recherche sur Bjak/.test(note)));
  assert.ok(queries.length && queries.every(query => !/Lindy/.test(query)), 'every search is about Bjak');

  const datadome = await findContacts({ company: 'DataDome', role: 'Product Designer', jobUrl: 'https://job-boards.greenhouse.io/ddome/jobs/5551234', jobText: 'Product Designer\nDataDome' }, { fetchPage, webSearch: null, resolveMx: async () => true });
  assert.equal(datadome.company.name, 'DataDome');
  assert.equal(datadome.company.overridden, '');
  assert.equal(datadome.company.domain, 'datadome.co');
  assert.equal(datadome.company.source, 'ats:greenhouse');

  // A job title stored as the company falls back to the board, then to its owner's own name.
  const titled = await findContacts({ company: 'Senior Technical Product Manager', role: 'AI Agents, Evals & Reliability', jobUrl: 'https://jobs.ashbyhq.com/bjakcareer/1', jobText: '' }, { fetchPage, webSearch: null, resolveMx: async () => true });
  assert.equal(titled.company.name, 'Bjak');
  assert.equal(titled.company.overridden, '');
  assert.equal(titled.company.domain, 'bjak.my');
});

test('findContacts: an ATS site without the name, or a board named after a domain', async () => {
  // publicWebsite points at a parent brand that carries neither name: not taken.
  const parent = await findContacts({ company: 'Acme', role: 'Designer', jobUrl: 'https://jobs.ashbyhq.com/acme/1', jobText: 'Designer at Acme.' }, {
    fetchPage: async (url, opts = {}) => (url === 'https://jobs.ashbyhq.com/acme' && opts.slim === false ? page(url, ashbyPage('Acme', 'https://holding-group.com', 'acme')) : missing(url)),
    webSearch: null,
    resolveMx: async () => false,
  });
  assert.equal(parent.company.domain, '');
  assert.equal(parent.company.name, 'Acme');

  const kraken = await findContacts({ company: 'Kraken', role: 'Designer', jobUrl: 'https://jobs.ashbyhq.com/kraken.com/123', jobText: 'Designer at Kraken.' }, { fetchPage: async url => missing(url), webSearch: null, resolveMx: async () => true });
  assert.equal(kraken.company.domain, 'kraken.com');
  assert.equal(kraken.company.source, 'ats:ashby');
  // A board named after another company's domain is not taken for "Lindy".
  const careerswift = await findContacts({ company: 'Lindy', role: 'Designer', jobUrl: 'https://jobs.ashbyhq.com/careerswift.ai/1', jobText: 'Designer at Lindy.' }, {
    fetchPage: async url => (url === 'https://careerswift.ai' ? page(url, '<title>CareerSwift | AI career coach</title>') : missing(url)),
    webSearch: null,
    resolveMx: async () => false,
  });
  assert.equal(careerswift.company.domain, '');
  assert.ok(careerswift.notes.some(note => /careerswift\.ai » ne mentionne pas « Lindy »/.test(note)));
});

test('findContacts: the LinkedIn company page gives the site through its JSON-LD sameAs', async () => {
  const jobHtml = '<section class="top-card-layout"><h1 class="top-card-layout__title">Product Designer</h1><a class="topcard__org-name-link topcard__flavor--black-link" href="https://fr.linkedin.com/company/glassnode?trk=public_jobs_topcard-org-name" data-tracking-control-name="public_jobs_topcard-org-name">Glassnode</a></section>';
  assert.equal(linkedinCompanyPage(jobHtml), 'https://fr.linkedin.com/company/glassnode/');
  assert.equal(linkedinCompanyPage('<a href="https://fr.linkedin.com/company/glassnode">Glassnode</a>'), '', 'only the top card link');
  const companyPage = '<script type="application/ld+json">{"@context":"http://schema.org","@type":"Organization","name":"Glassnode","url":"https://www.linkedin.com/company/glassnode","sameAs":"https://glassnode.com/","description":"On-chain market intelligence"}</script><h1>Glassnode</h1>';
  assert.equal(companyWebsiteFromHtml(companyPage, 'Glassnode'), '', 'only hiringOrganization by default');
  assert.equal(companyWebsiteFromHtml(companyPage, { company: 'Glassnode', organization: true }), 'https://glassnode.com/');
  const calls = [];
  const fetchPage = async (url) => {
    calls.push(url);
    if (url === 'https://fr.linkedin.com/company/glassnode/') return page(url, companyPage);
    if (url === 'https://glassnode.com') return page(url, '<title>Glassnode | On-chain data</title>');
    return missing(url);
  };
  const out = await findContacts({ company: 'Glassnode', role: 'Product Designer', jobUrl: 'https://www.linkedin.com/jobs/view/4470893067', jobText: 'Product Designer\nGlassnode', jobHtml }, { fetchPage, webSearch: null, resolveMx: async () => true });
  assert.equal(out.company.domain, 'glassnode.com');
  assert.equal(out.company.source, 'linkedin');
  assert.equal(out.company.confirmed, true);
  assert.equal(calls.filter(url => /linkedin\.com/.test(url)).length, 1, 'the company page is fetched once');
});

test('guessDomainsFromName: joined and hyphenated names on the posting language\'s TLDs, 8 at most', () => {
  assert.deepEqual(guessDomainsFromName('TripleTen'), ['tripleten.com', 'tripleten.io', 'tripleten.ai', 'tripleten.co', 'tripleten.app', 'gettripleten.com', 'trytripleten.com']);
  assert.deepEqual(guessDomainsFromName('Prolific', { language: 'fr' }), ['prolific.fr', 'prolific.com', 'prolific.io', 'prolific.co', 'getprolific.com', 'tryprolific.com']);
  assert.deepEqual(guessDomainsFromName('Europace AG', { language: 'de' }), ['europace.de', 'europace.com', 'europace.io', 'geteuropace.com', 'tryeuropace.com']);
  const mueller = guessDomainsFromName('Müller Design', { language: 'de' });
  assert.equal(mueller[0], 'muellerdesign.de', 'ü → ue');
  assert.ok(mueller.includes('mueller-design.de'));
  assert.ok(guessDomainsFromName('Vertech Industrial Systems Inc').length <= 8);
  assert.deepEqual(guessDomainsFromName('Chess.com'), ['chess.com'], 'a name that is a domain is that domain alone');
  assert.deepEqual(guessDomainsFromName(''), []);
  assert.deepEqual(guessDomainsFromName('X'), []);
});

test('home-page checks: parked pages and links back to the offer\'s board', () => {
  assert.ok(isParkedPage('<title>tripleten.ai is for sale</title><p>Buy this domain</p>'));
  assert.ok(isParkedPage('<title>lindy.io</title><p>This domain may be for sale.</p>'));
  assert.ok(!isParkedPage('<title>TripleTen: Online Coding Bootcamp</title>'));
  const gh = 'https://job-boards.eu.greenhouse.io/prolific/jobs/4831281101';
  assert.ok(linksToBoard('<a href="https://job-boards.eu.greenhouse.io/prolific">Careers</a>', gh));
  assert.ok(!linksToBoard('<a href="https://job-boards.greenhouse.io/prolificacademy">Careers</a>', gh), 'another board that starts the same');
  assert.ok(linksToBoard('<a href="https://jobs.ashbyhq.com/secfix?utm_source=site">Jobs</a>', 'https://jobs.ashbyhq.com/secfix/1'));
  assert.ok(linksToBoard('<a href="https://busuu.teamtailor.com/jobs">Jobs</a>', 'https://busuu.teamtailor.com/jobs/1-designer'));
  assert.ok(linksToBoard('<a href="https://www.welcometothejungle.com/en/companies/alan">Jobs</a>', 'https://www.welcometothejungle.com/fr/companies/alan/jobs/designer'));
  assert.ok(!linksToBoard('<a href="https://www.linkedin.com/company/lindy">LinkedIn</a>', 'https://www.linkedin.com/jobs/view/1'), 'every site links LinkedIn');
  assert.ok(!linksToBoard('<a href="https://x.com">x</a>', 'not a url'));
  assert.equal(cleanOwnerName('Careers at Acme'), 'Acme');
  assert.equal(cleanOwnerName('Acme Careers'), 'Acme');
  assert.equal(cleanOwnerName('Hirejobs'), 'Hirejobs', 'a name ending in jobs keeps it');
  assert.equal(cleanOwnerName('Jobs'), '');
});

test('findContacts: a guess from the name is taken only when one candidate names the company', async () => {
  const queries = [];
  const webSearch = async (query) => { queries.push(query); return []; };
  // The posting and the home page share "coding bootcamp", but shared words
  // never confirm a guess (FLR-1): the search runs, then the lone pick is kept unconfirmed.
  const tripletenJob = { company: 'TripleTen', role: 'Product Designer', jobUrl: 'https://uk.indeed.com/viewjob?jk=411b', jobText: 'Sr. Product Designer\nTripleTen\nTripleTen is an online coding bootcamp. We are looking for a designer.' };
  const tripletenPages = async (url) => {
    if (url === 'https://tripleten.com') return page(url, '<title>TripleTen: Online Coding Bootcamp</title>');
    if (url === 'https://tripleten.ai') return page(url, '<title>tripleten.ai is for sale</title><p>Buy this domain today.</p>');
    return missing(url);
  };
  const tripletenMx = async (domain) => ['tripleten.com', 'tripleten.ai'].includes(domain);
  const tripleten = await findContacts(tripletenJob, { fetchPage: tripletenPages, webSearch, resolveMx: tripletenMx });
  assert.equal(tripleten.company.domain, 'tripleten.com');
  assert.equal(tripleten.company.source, 'name-guess');
  assert.equal(tripleten.company.confirmed, false);
  assert.deepEqual(tripleten.domainChoices, []);
  assert.ok(queries.some(query => /official website/.test(query)));
  // The official-site search finds it too: then it is confirmed by its home page.
  const searched = await findContacts(tripletenJob, {
    fetchPage: tripletenPages,
    webSearch: async (query) => (/official website/.test(query) ? [{ title: 'TripleTen: Online Coding Bootcamp', url: 'https://tripleten.com/' }] : []),
    resolveMx: tripletenMx,
  });
  assert.equal(searched.company.domain, 'tripleten.com');
  assert.equal(searched.company.source, 'search');
  assert.equal(searched.company.confirmed, true);

  // Namesakes: both name Lindy, neither links the offer's board → the user chooses.
  const lindy = await findContacts({ company: 'Lindy', role: 'Designer', jobUrl: 'https://www.linkedin.com/jobs/view/4470893067', jobText: 'Designer at Lindy.' }, {
    fetchPage: async (url) => {
      if (url === 'https://lindy.com') return page(url, '<title>Lindy Electronics | Cables &amp; Adapters</title>');
      if (url === 'https://lindy.ai') return page(url, '<title>Lindy | Hire an AI Employee</title>');
      return missing(url);
    },
    webSearch: async () => [],
    resolveMx: async () => true,
  });
  assert.equal(lindy.company.domain, '');
  assert.deepEqual(lindy.domainChoices, [
    { domain: 'lindy.com', title: 'Lindy Electronics | Cables & Adapters' },
    { domain: 'lindy.ai', title: 'Lindy | Hire an AI Employee' },
  ]);
  assert.ok(lindy.notes.some(note => /Plusieurs sites portent le nom « Lindy » \(lindy\.com, lindy\.ai\)/.test(note)));

  // prolific.fr is an association that also names Prolific; prolific.com links the offer's board.
  const prolific = await findContacts({
    company: 'Prolific',
    role: 'Product Designer',
    jobUrl: 'https://job-boards.eu.greenhouse.io/prolific/jobs/4831281101',
    jobText: 'Product Designer\nProlific\nNous recherchons un designer pour notre équipe et vous travaillerez avec nous dans les projets de la plateforme.',
  }, {
    fetchPage: async (url, opts = {}) => {
      if (url === 'https://boards-api.greenhouse.io/v1/boards/prolific' && opts.as === 'json') return json(url, { name: 'Prolific', content: '' });
      if (url === 'https://boards-api.greenhouse.io/v1/boards/prolific/jobs' && opts.as === 'json') return json(url, { jobs: [{ absolute_url: 'https://job-boards.eu.greenhouse.io/prolific/jobs/4831281101', company_name: 'Prolific' }] });
      if (url === 'https://prolific.fr') return page(url, '<title>Association PrOlific</title>');
      if (url === 'https://prolific.com') return page(url, '<title>Prolific | Quickly find research participants</title><a href="https://job-boards.eu.greenhouse.io/prolific">Careers</a>');
      return missing(url);
    },
    webSearch: async () => [],
    resolveMx: async (domain) => ['prolific.fr', 'prolific.com'].includes(domain),
  });
  assert.equal(prolific.company.domain, 'prolific.com');
  assert.equal(prolific.company.source, 'name-guess');
  assert.deepEqual(prolific.domainChoices, []);
});

// FL-2 (2026-10-24 review): for "Riot" (tryriot.com) riot.ai, riot.co,
// riot.app and tryriot.com all receive mail; three home pages were read, so
// tryriot.com never was, and riot.co (a studio) became the confirmed site.
const riotJob = { company: 'Riot', role: 'Product Designer', jobUrl: 'https://www.workingnomads.com/jobs/product-designer-riot', jobText: 'Product Designer\nRiot\nRemote, Europe. Riot builds security awareness training for companies.' };
const riotMx = async (domain) => ['riot.ai', 'riot.co', 'riot.app', 'tryriot.com'].includes(domain);

test('name guess: every candidate receiving mail is read; a lone pick nothing ties to the offer stays unconfirmed', async () => {
  const fetched = [];
  const pages = {
    'https://riot.ai': page('https://riot.ai', '<title>Coming soon</title>'),
    'https://riot.co': page('https://riot.co', '<title>Riot | Creative studio, Amsterdam</title><p>hello@riot.co</p>'),
    'https://riot.app': page('https://riot.app', '<title>riot.app</title><p>An app</p>'),
    'https://tryriot.com': page('https://tryriot.com', '<title>Riot - Security awareness training</title><p>Phishing simulations and security awareness training on Slack.</p>'),
  };
  const both = await findContacts(riotJob, { fetchPage: async (url) => { fetched.push(url); return pages[url] || missing(url); }, webSearch: async () => [], resolveMx: riotMx });
  assert.ok(fetched.includes('https://tryriot.com'), 'the fourth candidate is read too');
  // riot.app's title is only its host: a placeholder names no company.
  assert.deepEqual(both.domainChoices.map(choice => choice.domain), ['riot.co', 'tryriot.com']);
  assert.equal(both.company.domain, '');
  assert.equal(both.best, null);

  // riot.co alone names Riot and shares nothing with the posting: the search
  // runs, then the pick is kept unconfirmed, so its inbox is never drafted to.
  const queries = [];
  const alone = await findContacts(riotJob, {
    fetchPage: async (url) => (url === 'https://tryriot.com' ? missing(url) : pages[url] || missing(url)),
    webSearch: async (query) => { queries.push(query); return []; },
    resolveMx: riotMx,
  });
  assert.ok(queries.some(query => /official website/.test(query)), 'an uncorroborated guess does not pre-empt the search');
  assert.equal(alone.company.domain, 'riot.co');
  assert.equal(alone.company.source, 'name-guess');
  assert.equal(alone.company.confirmed, false);
  assert.ok(alone.contacts.some(c => c.email === 'hello@riot.co'));
  assert.equal(alone.best, null);
  assert.ok(alone.notes.some(note => /riot\.co porte le nom « Riot », mais rien ne le relie à l'annonce/.test(note)));

  // tryriot.com alone, sharing "security awareness training" with the
  // posting: shared words never confirm (FLR-1), so it stays unconfirmed...
  const tiedQueries = [];
  const tied = await findContacts(riotJob, {
    fetchPage: async (url) => (url === 'https://riot.co' ? missing(url) : pages[url] || missing(url)),
    webSearch: async (query) => { tiedQueries.push(query); return []; },
    resolveMx: riotMx,
  });
  assert.equal(tied.company.domain, 'tryriot.com');
  assert.equal(tied.company.confirmed, false);
  assert.ok(tiedQueries.some(query => /official website/.test(query)));
  // ...while a posting that names the domain confirms it before any search.
  const mentionedQueries = [];
  const mentioned = await findContacts({ ...riotJob, jobText: `${riotJob.jobText}\nLearn more at tryriot.com` }, {
    fetchPage: async (url) => (url === 'https://riot.co' ? missing(url) : pages[url] || missing(url)),
    webSearch: async (query) => { mentionedQueries.push(query); return []; },
    resolveMx: riotMx,
  });
  assert.equal(mentioned.company.domain, 'tryriot.com');
  assert.equal(mentioned.company.confirmed, true);
  assert.ok(!mentionedQueries.some(query => /official website/.test(query)));
});

test('name guess: a candidate that redirects to a domain without the name is out', async () => {
  const out = await findContacts(riotJob, {
    fetchPage: async (url) => (url === 'https://riot.ai'
      ? { ...page('https://www.riotgames.com/en', '<title>Riot Games</title><p>League of Legends. Security awareness training.</p>') }
      : missing(url)),
    webSearch: async () => [],
    resolveMx: async (domain) => domain === 'riot.ai',
  });
  assert.equal(out.company.domain, '', 'riotgames.com is another company than Riot');
  assert.ok(!out.contacts.some(c => /riotgames/.test(c.email)));
});

test('name guess: an unreadable posting takes its language from the title, so europace.de is tried', async () => {
  // FL-A5: Glassdoor 403, no posting text; "(w/m/d)" and "Designerin" are German.
  const out = await findContacts({ company: 'Europace', role: 'Europace hiring (Senior) Product Designerin - remote (w/m/d)', jobUrl: 'https://www.glassdoor.de/job-listing/1', jobText: '' }, {
    fetchPage: async (url) => (url === 'https://europace.de' ? page(url, '<title>Europace | Der Marktplatz für Immobilienfinanzierungen</title><p>info@europace.de</p>') : missing(url)),
    webSearch: async () => [],
    resolveMx: async (domain) => domain === 'europace.de',
  });
  assert.equal(out.company.domain, 'europace.de');
  assert.equal(out.company.source, 'name-guess');
  // No text and no marker: the usual TLDs, plus .de and .fr.
  const unknown = guessDomainsFromName('Europace', { language: '' });
  assert.ok(unknown.includes('europace.de') && unknown.includes('europace.fr') && unknown.includes('europace.com'));
  assert.ok(unknown.length <= 10);
});
