// What a company page yields and which pages get read: Cloudflare-protected
// addresses, footers past 400 KB, JSON-LD and split addresses, a clean
// company brief, and a crawl that spends its pages on contact, team and the
// Impressum instead of 404s, duplicates and JS shells. Fixtures, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  companyBrief,
  createPageFetcher,
  decodeCfEmail,
  defaultCrawlPaths,
  extractEmails,
  findContacts,
  htmlLang,
  pageText,
  pickCrawlLinks,
  pickSitemapLinks,
  preDecodeHtml,
  registrableDomain,
  slimHtml,
} from '../lib/contact-finder.mjs';

// Cloudflare's encoding: one key byte, then each UTF-8 byte XOR the key, in hex.
const cfEncode = (email, key = 0x5a) => key.toString(16).padStart(2, '0') + [...Buffer.from(email, 'utf8')].map(byte => (byte ^ key).toString(16).padStart(2, '0')).join('');
const emails = found => found.map(item => item.email);
const filler = (word, count = 40) => Array.from({ length: count }, (_, i) => `${word} ${i}`).join(' ');

test('decodeCfEmail decodes Cloudflare protection and ignores malformed input', () => {
  const hex = cfEncode('nicolas@cureety.com');
  assert.equal(hex.slice(0, 2), '5a');
  assert.equal(decodeCfEmail(hex), 'nicolas@cureety.com');
  assert.equal(decodeCfEmail(hex.slice(0, -1)), '', 'odd length');
  assert.equal(decodeCfEmail('5azz1234'), '', 'not hex');
  assert.equal(decodeCfEmail(''), '');
  assert.equal(decodeCfEmail(cfEncode('not an address')), '', 'decodes to something that is not an address');
  assert.equal(decodeCfEmail(cfEncode('jobs@acme.io?subject=Candidature')), 'jobs@acme.io');
});

test('extractEmails reads data-cfemail elements and email-protection links', () => {
  const html = `<p>Directeur de la publication : Nicolas Bégin, <a href="/cdn-cgi/l/email-protection" class="__cf_email__" data-cfemail="${cfEncode('nicolas@cureety.com')}">[email&#160;protected]</a></p>`
    + `<p><a href="https://www.cureety.com/cdn-cgi/l/email-protection#${cfEncode('contact@cureety.com')}">Nous écrire</a></p>`;
  const found = extractEmails(html, { domain: 'cureety.com', sourceUrl: 'https://www.cureety.com/mentions-legales' });
  const byEmail = Object.fromEntries(found.map(item => [item.email, item]));
  assert.ok(byEmail['nicolas@cureety.com'], 'element decoded');
  assert.match(byEmail['nicolas@cureety.com'].context, /Nicolas Bégin/);
  assert.equal(byEmail['contact@cureety.com']?.kind, 'generic', 'href decoded to a mailto');
  assert.match(preDecodeHtml(`<a href="/cdn-cgi/l/email-protection#${cfEncode('yo@collective.work')}">x</a>`), /href="mailto:yo@collective\.work"/);
  // Broken hex never throws and yields nothing.
  const broken = `<span data-cfemail="5a3">[email protected]</span><a href="/cdn-cgi/l/email-protection#zz99">x</a>`;
  assert.deepEqual(extractEmails(broken, { domain: 'cureety.com' }), []);
  assert.equal(preDecodeHtml(broken), broken);
});

test('slimHtml keeps the footer of a 900 KB page with a 600 KB inline script', () => {
  const script = `<script>window.__STATE__=${JSON.stringify({ blob: 'x'.repeat(600000) })}</script>`;
  const body = `<main>${'<p>Our product helps teams ship faster every single day.</p>'.repeat(5000)}</main>`;
  const footer = '<footer><a href="/kontakt">Kontakt</a><a href="/impressum">Impressum</a><a href="mailto:jobs@acme.io">Jobs</a></footer>';
  const page = `<html lang="de"><head><style>${'.a{color:red}'.repeat(2000)}</style></head><body>${script}${body}${footer}</body></html>`;
  assert.ok(page.length > 900000);
  // Today's cut (first 400 000 characters) loses the footer.
  assert.deepEqual(pickCrawlLinks(page.slice(0, 400000), 'https://acme.io/'), []);
  const slim = slimHtml(page, 400000);
  assert.ok(slim.length <= 400001);
  assert.ok(!slim.includes('__STATE__') && !slim.includes('color:red'));
  assert.deepEqual(pickCrawlLinks(slim, 'https://acme.io/'), ['https://acme.io/kontakt', 'https://acme.io/impressum']);
  assert.deepEqual(emails(extractEmails(slim, { domain: 'acme.io' })), ['jobs@acme.io']);
  // JSON-LD survives the slimming; SVG, noscript and comments do not.
  const kept = slimHtml('<script type="application/ld+json">{"@type":"Organization","email":"hello@acme.io"}</script><svg><title>Logo</title></svg><noscript>x</noscript><!-- c --><p>Hi</p>');
  assert.match(kept, /application\/ld\+json/);
  assert.ok(!/<svg|<noscript|<!--/.test(kept));
});

test('createPageFetcher: decoded and slimmed HTML, plus json and xml modes (fetch stubbed, no network)', async () => {
  const bodies = {
    'https://acme.io/': ['text/html; charset=utf-8', `<html><body><script>var big="${'x'.repeat(500000)}";</script><p>Hi</p><footer><a href="/impressum">Impressum</a><span data-cfemail="${cfEncode('hello@acme.io')}">[email protected]</span></footer></body></html>`],
    'https://acme.io/api': ['application/vnd.api+json', '{"name":"Acme"}'],
    'https://acme.io/broken': ['application/json', '{"name":'],
    'https://acme.io/robots.txt': ['text/plain', 'Sitemap: https://acme.io/sitemap.xml'],
    'https://acme.io/sitemap.xml': ['application/xml', '<urlset><url><loc>https://acme.io/kontakt</loc></url></urlset>'],
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const hit = bodies[String(url)];
    return hit ? new Response(hit[1], { status: 200, headers: { 'content-type': hit[0] } }) : new Response('nope', { status: 404 });
  };
  try {
    const fetchPage = createPageFetcher({ maxChars: 400000 });
    const home = await fetchPage('https://acme.io/');
    assert.equal(home.ok, true);
    assert.ok(!home.html.includes('var big'), 'inline script slimmed away');
    assert.match(home.html, /href="\/impressum"/);
    assert.match(home.text, /hello@acme\.io/, 'Cloudflare address decoded');
    const raw = await fetchPage('https://acme.io/', { slim: false });
    assert.ok(raw.html.includes('var big') && raw.html.length <= 400000);
    assert.deepEqual(await fetchPage('https://acme.io/api', { as: 'json' }), { ok: true, status: 200, json: { name: 'Acme' }, url: 'https://acme.io/api' });
    const broken = await fetchPage('https://acme.io/broken', { as: 'json' });
    assert.equal(broken.ok, false);
    assert.equal(broken.json, null);
    assert.equal((await fetchPage('https://acme.io/api')).ok, false, 'JSON is not an HTML page');
    assert.match((await fetchPage('https://acme.io/robots.txt', { as: 'xml' })).text, /Sitemap:/);
    assert.match((await fetchPage('https://acme.io/sitemap.xml', { as: 'xml' })).text, /<loc>/);
    const missing = await fetchPage('https://acme.io/nothing');
    assert.equal(missing.ok, false);
    assert.equal(missing.status, 404);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('pageText drops an unclosed style block and invisible characters', () => {
  const cut = '<html><head><title>Alan</title><style id="app-css">._48lXWx{--jVQ0-0:1.001s;flex-shrink:0;}';
  assert.equal(pageText(cut), 'Alan');
  assert.equal(pageText('<p>Thomas Heise\u00adrowski</p><p>\u200dStefan Bader</p><p>Raten&shy;kredit</p>'), 'Thomas Heiserowski\nStefan Bader\nRatenkredit');
});

test('extractEmails reads JSON-LD contact points and founders', () => {
  const html = `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': [
    { '@type': 'Organization', name: 'Hubvisory', contactPoint: { '@type': 'ContactPoint', contactType: 'Sales', email: 'contact@hubvisory.com' }, founder: [{ '@type': 'Person', name: 'Benoit Martin', email: 'mailto:benoit.martin@hubvisory.com' }] },
    { '@type': 'WebPage', email: 'webmaster@hubvisory.com' },
  ] })}</script><p>Hello</p>`;
  const found = extractEmails(html, { domain: 'hubvisory.com', sourceUrl: 'https://hubvisory.com/' });
  const byEmail = Object.fromEntries(found.map(item => [item.email, item]));
  assert.equal(byEmail['contact@hubvisory.com']?.kind, 'generic');
  assert.match(byEmail['contact@hubvisory.com'].context, /^JSON-LD ContactPoint/);
  assert.equal(byEmail['benoit.martin@hubvisory.com']?.kind, 'person');
  assert.equal(byEmail['webmaster@hubvisory.com'], undefined, 'only organisation and person nodes');
  // A posting page's own JSON-LD is the board's, skipped on request.
  assert.deepEqual(extractEmails(html, { domain: '', structured: false }), []);
});

test('extractEmails reads addresses split by inline tags, spaced, fullwidth or with invisible characters', () => {
  const cases = [
    '<p><strong>jobs</strong>@acme.io</p>',
    '<p>jobs<span>@</span>acme.io</p>',
    '<p>jobs@<wbr>acme.io</p>',
    '<p>jobs&nbsp;@&nbsp;acme.io</p>',
    '<p>jobs @ acme.io</p>',
    '<p>jobs\uff20acme.io</p>',
    '<p>jobs&commat;acme.io</p>',
    '<p>jobs{at}acme.io</p>',
    '<p>jobs [at] acme [dot] io</p>',
    '<p>jobs\u200b@acme.io</p>',
    '<p>jobs@ac\u00adme.io</p>',
  ];
  for (const html of cases) assert.deepEqual(emails(extractEmails(html, { domain: 'acme.io' })), ['jobs@acme.io'], html);
  // A bare " at " / " dot " stays prose.
  assert.deepEqual(extractEmails('<p>write to jobs at acme dot io</p>', { domain: 'acme.io' }), []);
  // Gluing never grows a visible address.
  assert.deepEqual(emails(extractEmails('<p><b>Recrutement</b><span>jobs@acme.io</span><b>Paris</b></p>', { domain: 'acme.io' })), ['jobs@acme.io']);
  const upper = extractEmails('<p>Pour postuler, écrivez à JOBS@ACME.IO avec votre CV</p>', { domain: 'acme.io' });
  assert.equal(upper[0].email, 'jobs@acme.io');
  assert.match(upper[0].context, /écrivez à JOBS@ACME\.IO avec votre CV/);
});

test('extractEmails keeps the visible address of a mailto whose href is a typo', () => {
  const html = '<p>Through email to the following address: <a href="mailto:pdpo@mindera.com">dpo@mindera.com</a></p>';
  const found = extractEmails(html, { domain: 'mindera.com', sourceUrl: 'https://mindera.com/privacy-policy' });
  assert.deepEqual(emails(found), ['dpo@mindera.com']);
  assert.equal(found[0].kind, 'avoid');
  // A plain label keeps the href; an href shown elsewhere on the page is kept too.
  assert.deepEqual(emails(extractEmails('<a href="mailto:jobs@acme.io">Write to us</a>', { domain: 'acme.io' })), ['jobs@acme.io']);
  assert.deepEqual(emails(extractEmails('<p>hr@acme.io</p><a href="mailto:hr@acme.io">jobs@acme.io</a>', { domain: 'acme.io' })).sort(), ['hr@acme.io', 'jobs@acme.io']);
});

test('extractEmails keeps a sibling ccTLD printed on the company site, nothing else', () => {
  const html = '<p>Contact us via info@cosuno.de or our partner desk info@cosuno-partner.de</p>';
  const found = extractEmails(html, { domain: 'cosuno.com', sourceUrl: 'https://www.cosuno.com/web/en/legal-notice' });
  assert.deepEqual(emails(found), ['info@cosuno.de']);
  assert.match(found[0].context, /\(domaine voisin\)$/);
  assert.equal(found[0].domain, 'cosuno.de');
  // Not on the company's own site: dropped.
  assert.deepEqual(extractEmails(html, { domain: 'cosuno.com', sourceUrl: 'https://www.some-board.io/job/1' }), []);
  assert.deepEqual(extractEmails(html, { domain: 'cosuno.com' }), []);
});

test('registrableDomain keeps a domain whose name starts like a subdomain', () => {
  assert.equal(registrableDomain('people.ai'), 'people.ai');
  assert.equal(registrableDomain('team.blue'), 'team.blue');
  assert.equal(registrableDomain('www.people.ai'), 'people.ai');
  assert.equal(registrableDomain('careers.acme.io'), 'acme.io');
  assert.equal(registrableDomain('jobs.acme.co.uk'), 'acme.co.uk');
  assert.deepEqual(emails(extractEmails('<p>jobs@people.ai</p>', { domain: 'people.ai' })), ['jobs@people.ai']);
});

test('companyBrief: the meta description and the lines no other page shares', () => {
  const nav = '<nav><p>Products Pricing Customers Resources Company Careers Contact Login and Sign up today for free</p></nav>';
  const footer = '<footer><p>Subscribe to our newsletter to get product news and tips every month</p><p>© 2026 Acme SAS. All rights reserved by the company.</p></footer>';
  const home = {
    url: 'https://acme.io/',
    html: `<html><head><title>Acme</title><meta name="description" content="Acme builds payroll APIs for European startups &amp; scale-ups."><meta property="og:description" content="Acme builds payroll APIs for European startups &amp; scale-ups."></head><body>${nav}<p>Short tagline</p><p>We run payroll for 4,000 companies in 12 countries from our office in Lyon.</p><p>We use cookies to improve your experience on this website, accept them all.</p>${footer}</body></html>`,
  };
  const about = {
    url: 'https://acme.io/about',
    html: `<html><body>${nav}<p>Acme was founded in 2019 by two engineers who hated payroll spreadsheets.</p><p>.x{a:b;c:d;e:f;g:h;i:j;k:l;m:n;o:p} .y{a:b;c:d;e:f;g:h;i:j;k:l;m:n}</p>${footer}</body></html>`,
  };
  const contact = { url: 'https://acme.io/contact', html: `<html><body>${nav}<p>Write to us any time, a human on our support team answers within a day.</p>${footer}</body></html>` };
  const brief = companyBrief({ home, pages: [contact, about] });
  assert.deepEqual(brief.split('\n'), [
    'Acme builds payroll APIs for European startups & scale-ups.',
    'We run payroll for 4,000 companies in 12 countries from our office in Lyon.',
    'Acme was founded in 2019 by two engineers who hated payroll spreadsheets.',
  ]);
  assert.ok(companyBrief({ home, pages: [about], max: 70 }).length <= 70);
  assert.equal(companyBrief({ home: '<p>Acme builds payroll APIs for European startups and scale-ups.</p>' }), 'Acme builds payroll APIs for European startups and scale-ups.');
  assert.equal(companyBrief({ home: null }), '');
  // Truncated HTML ending inside a <style>: no CSS in the brief.
  const cut = { url: 'https://alan.com/', html: `<html><head><meta name="description" content="Alan is the health insurance that takes care of you."><style id="app-css">._48lXWx{--jVQ0-0:1.001s;flex-shrink:0;}` };
  assert.equal(companyBrief({ home: cut }), 'Alan is the health insurance that takes care of you.');
});

test('pickCrawlLinks: long anchors, fragments and the German, Spanish and French words', () => {
  const megaMenu = `<a class="nav" href="/fr/contact#contact-us-form"><div class="icon">${'<span class="dot"></span>'.repeat(20)}</div><span>Contactez-nous</span></a>`;
  assert.deepEqual(pickCrawlLinks(`<html lang="fr">${megaMenu}</html>`, 'https://www.apptweak.com/fr'), ['https://www.apptweak.com/fr/contact']);
  const german = '<a href="/de/kontakt">Kontakt</a><a href="/de/ueber-uns">Über uns</a><a href="/karriere">Karriere</a><a href="mailto:info@acme.de">Mail</a><a href="tel:+49301234">Tel</a><a href="/user@acme.de">x</a>';
  assert.deepEqual(pickCrawlLinks(german, 'https://acme.de/'), ['https://acme.de/de/kontakt', 'https://acme.de/de/ueber-uns', 'https://acme.de/karriere']);
  assert.deepEqual(pickCrawlLinks('<a href="/es/contacto">Contacto</a><a href="/it/chi-siamo">Chi siamo</a>', 'https://acme.es/'), ['https://acme.es/es/contacto', 'https://acme.es/it/chi-siamo']);
  // A label read from a short link text: "Meet the Genies" is the team page.
  assert.deepEqual(pickCrawlLinks('<a href="/genies/">Meet the Genies</a>', 'https://roompricegenie.com/'), ['https://roompricegenie.com/genies']);
  // A sentence that mentions "about" is not an about link.
  assert.deepEqual(pickCrawlLinks('<a href="/products/data">Learn more about the scope of the data layer →</a><a href="/about">About</a>', 'https://glassnode.com/'), ['https://glassnode.com/about']);
});

test('pickCrawlLinks: one legal notice among /legal/* pages, one careers page, the home locale first', () => {
  const legal = ['vertrag-kuendigen', 'stromkennzeichnung', 'agb', 'widerruf', 'cookie-richtlinie', 'barrierefreiheit']
    .map(slug => `<a href="/de/legal/${slug}">${slug.replace(/-/g, ' ')}</a>`).join('');
  const komma = pickCrawlLinks(`<html lang="de">${legal}<a href="/de/legal/impressum">Impressum</a><a href="/de/legal">Rechtliches</a></html>`, 'https://1komma5.com/de');
  assert.ok(komma.includes('https://1komma5.com/de/legal/impressum'));
  assert.ok(komma.filter(url => /\/legal(?:\/|$)/.test(url)).length <= 1);

  const categories = ['entwicklung', 'vertrieb', 'support', 'design', 'marketing', 'verwaltung']
    .map(slug => `<a href="/jobs/${slug}">Jobs ${slug}</a>`).join('');
  const zollsoft = pickCrawlLinks(`<a href="/jobs">Jobs</a>${categories}<a href="/blog">Blog</a><a href="/impressum/">Impressum</a><a href="/presse/">Presse</a><a href="/kontakt/">Kontakt</a><a href="/datenschutz/">Datenschutz</a>`, 'https://zollsoft.de/');
  assert.equal(zollsoft.filter(url => /\/jobs/.test(url)).length, 1);
  assert.ok(zollsoft.includes('https://zollsoft.de/jobs'));
  for (const page of ['impressum', 'kontakt', 'presse']) assert.ok(zollsoft.slice(0, 7).includes(`https://zollsoft.de/${page}`), page);

  const both = '<a href="/en/contact">Contact</a><a href="/fr/contact">Contact</a><a href="/en/about">About</a><a href="/fr/a-propos">À propos</a>';
  assert.deepEqual(pickCrawlLinks(`<html lang="fr">${both}</html>`, 'https://acme.fr/'), ['https://acme.fr/fr/contact', 'https://acme.fr/fr/a-propos']);
  assert.deepEqual(pickCrawlLinks(both, 'https://acme.fr/en/'), ['https://acme.fr/en/contact', 'https://acme.fr/en/about']);
  assert.equal(htmlLang('<html class="x" lang="de-DE">'), 'de');
});

test('defaultCrawlPaths has a German list led by the Impressum; sitemaps are bucketed too', () => {
  assert.equal(defaultCrawlPaths('de')[0], '/impressum');
  assert.deepEqual(defaultCrawlPaths('de'), ['/impressum', '/kontakt', '/ueber-uns', '/team', '/karriere', '/datenschutz', '/presse']);
  assert.equal(defaultCrawlPaths('fr')[0], '/contact');
  const xml = '<?xml version="1.0"?><urlset><url><loc>https://acme.io/blog/hello</loc></url><url><loc>https://acme.io/about/team/</loc></url><url><loc>https://acme.io/contact</loc></url><url><loc>https://other.io/contact</loc></url></urlset>';
  assert.deepEqual(pickSitemapLinks(xml, 'https://acme.io'), ['https://acme.io/contact', 'https://acme.io/about/team']);
});

// A stub site: path → html; everything else is a 404 unless `fallback` says
// otherwise. `redirects` maps a path to the URL the fetch ends on.
function stubSite(origin, pages, { fallback = null, redirects = {} } = {}) {
  const calls = [];
  const fetchPage = async (url, options = {}) => {
    calls.push({ url, as: options.as || 'html' });
    let path = url.startsWith(origin) ? (url.slice(origin.length) || '/').replace(/(.)\/$/, '$1') : null;
    let finalUrl = url.replace(/(\w)\/$/, '$1');
    if (path !== null && redirects[path]) { finalUrl = `${origin}${redirects[path]}`; path = redirects[path]; }
    const html = path !== null && Object.hasOwn(pages, path) ? pages[path] : fallback;
    if (html === null) return { ok: false, status: 404, html: '', text: '', url, error: 'HTTP 404' };
    return { ok: true, status: 200, html, text: pageText(html), url: finalUrl };
  };
  return { fetchPage, calls };
}
const realPage = (title, extra = '') => `<html><body><h1>${title}</h1><p>${filler(title)}</p>${extra}</body></html>`;

test('findContacts crawl: 404 defaults and a duplicate body cost attempts, not pages', async () => {
  const origin = 'https://acme.io';
  const { fetchPage, calls } = stubSite(origin, {
    '/': '<html><body><a href="/contact">Contact</a><p>Acme builds payroll APIs for small teams across Europe and beyond.</p></body></html>',
    '/contact': realPage('Contact', '<p>jobs@acme.io</p>'),
    '/contact-us': realPage('Contact', '<p>jobs@acme.io</p>'),
    '/company': realPage('Company'),
    '/careers': realPage('Careers'),
    '/jobs': realPage('Jobs'),
    '/legal': realPage('Legal'),
    '/imprint': realPage('Imprint'),
    '/impressum': realPage('Impressum'),
    '/privacy': realPage('Privacy'),
  });
  const out = await findContacts({ company: 'Acme', role: 'Designer', jobUrl: 'https://jobs.lever.co/acme/1', jobText: 'Designer at Acme.', companyUrlHint: origin }, { fetchPage, webSearch: null, resolveMx: async () => true });
  assert.equal(out.pagesRead.length, 8, 'home + 7 distinct pages');
  assert.equal(new Set(out.pagesRead).size, 8);
  assert.ok(!out.pagesRead.includes(`${origin}/contact-us`), 'the duplicate body is not a page read');
  for (const missing of ['/about', '/about-us', '/team']) assert.ok(!out.pagesRead.includes(`${origin}${missing}`));
  const crawlFetches = calls.filter(call => call.as === 'html' && call.url !== origin && !/introuvable$/.test(call.url));
  assert.ok(crawlFetches.length <= 14, `${crawlFetches.length} crawl attempts`);
  assert.ok(calls.some(call => call.url === `${origin}/sitemap.xml` && call.as === 'xml'), 'the sitemap is tried before the defaults');
  assert.ok(out.contacts.some(c => c.email === 'jobs@acme.io'));
});

test('findContacts crawl: a JS shell for every path stops after 3 identical pages', async () => {
  const shell = '<html><head><title>App</title></head><body><div id="root"></div></body></html>';
  const { fetchPage, calls } = stubSite('https://hubvisory.com', {}, { fallback: shell });
  const out = await findContacts({ company: 'Hubvisory', role: 'Designer', jobUrl: 'https://jobs.lever.co/hubvisory/1', jobText: 'Designer at Hubvisory.', companyUrlHint: 'https://hubvisory.com' }, { fetchPage, webSearch: null, resolveMx: async () => true });
  assert.deepEqual(out.pagesRead, ['https://hubvisory.com']);
  assert.ok(out.notes.some(note => /site rendu en JS : pages identiques/i.test(note)));
  assert.ok(calls.length <= 8, `${calls.length} fetches`);
});

test('findContacts crawl: the soft-404 page is learned once and skipped', async () => {
  const soft = realPage('Oops, this page could not be found');
  const { fetchPage } = stubSite('https://acme.io', {
    '/': '<html><body><a href="/contact">Contact</a><a href="/team">Team</a><a href="/about">About</a></body></html>',
    '/contact': realPage('Contact', '<p>hello@acme.io</p>'),
  }, { fallback: soft });
  const out = await findContacts({ company: 'Acme', role: 'Designer', jobUrl: 'https://jobs.lever.co/acme/1', jobText: 'Designer at Acme.', companyUrlHint: 'https://acme.io' }, { fetchPage, webSearch: null, resolveMx: async () => true });
  assert.deepEqual(out.pagesRead, ['https://acme.io', 'https://acme.io/contact']);
});

test('findContacts crawl: a German site gets the sitemap pages, then German defaults under its locale', async () => {
  const origin = 'https://acme.de';
  const sitemap = `<?xml version="1.0"?><urlset><url><loc>${origin}/de/ueber-uns/team</loc></url><url><loc>${origin}/de/blog/news</loc></url></urlset>`;
  const pages = {
    '/de': '<html lang="de"><body><p>Wir bauen Software für die Logistik und mit Leidenschaft.</p></body></html>',
    '/sitemap.xml': sitemap,
    '/de/ueber-uns/team': realPage('Team', '<p>Anna Schmidt, CEO</p>'),
    '/de/impressum': realPage('Impressum', '<p>Geschäftsführer: Dr. Andreas Zollmann</p><p>info@acme.de</p>'),
  };
  // The home page answers from /de (a redirect), so the defaults go under /de.
  const { fetchPage, calls } = stubSite(origin, pages, { redirects: { '/': '/de' } });
  const out = await findContacts({ company: 'Acme', role: 'Designer', jobUrl: 'https://jobs.lever.co/acme/1', jobText: 'Designer at Acme.', companyUrlHint: origin }, { fetchPage, webSearch: null, resolveMx: async () => true });
  assert.equal(out.pagesRead[0], `${origin}/de`);
  assert.ok(out.pagesRead.includes(`${origin}/de/ueber-uns/team`), 'a sitemap page');
  assert.ok(out.pagesRead.includes(`${origin}/de/impressum`), 'a German default under /de');
  assert.ok(!calls.some(call => call.url === `${origin}/de/contact-us`), 'no English defaults on a German site');
  assert.ok(out.contacts.some(c => c.email === 'info@acme.de'));
  assert.ok(out.people.some(p => p.lastName === 'Zollmann'));
});

test('findContacts crawl: robots.txt points at the sitemap index, which leads to the page sitemap', async () => {
  const origin = 'https://acme.io';
  const pages = {
    '/': '<html><body><p>Acme builds payroll APIs for small teams across Europe and beyond.</p></body></html>',
    '/robots.txt': `User-agent: *\nSitemap: ${origin}/sitemap_index.xml\n`,
    '/sitemap_index.xml': `<sitemapindex><sitemap><loc>${origin}/post-sitemap.xml</loc></sitemap><sitemap><loc>${origin}/page-sitemap.xml</loc></sitemap></sitemapindex>`,
    '/page-sitemap.xml': `<urlset><url><loc>${origin}/kontakt</loc></url><url><loc>${origin}/leadership</loc></url><url><loc>${origin}/impressum</loc></url></urlset>`,
    '/kontakt': realPage('Kontakt', '<p>hallo@acme.io</p>'),
    '/leadership': realPage('Leadership'),
    '/impressum': realPage('Impressum'),
  };
  const { fetchPage, calls } = stubSite(origin, pages);
  const out = await findContacts({ company: 'Acme', role: 'Designer', jobUrl: 'https://jobs.lever.co/acme/1', jobText: 'Designer at Acme.', companyUrlHint: origin }, { fetchPage, webSearch: null, resolveMx: async () => true });
  for (const path of ['/kontakt', '/leadership', '/impressum']) assert.ok(out.pagesRead.includes(`${origin}${path}`), path);
  assert.ok(!calls.some(call => call.url === `${origin}/post-sitemap.xml`), 'two sitemap documents at most');
});

test('findContacts: Cloudflare-protected founder address, the brief as companyText, the team page for the model', async () => {
  const origin = 'https://cureety.com';
  const nav = '<nav><a href="/equipe">Équipe</a><a href="/mentions-legales">Mentions légales</a><a href="/contact">Contact</a></nav>';
  const pages = {
    '/': `<html lang="fr"><head><meta name="description" content="Cureety accompagne les patients atteints de cancer entre deux consultations."></head><body>${nav}<p>Notre équipe soignante suit chaque patient grâce à une application de télésurveillance.</p></body></html>`,
    '/mentions-legales': realPage('Mentions légales', `<p>Directeur de la publication : Nicolas Bégin, <a href="/cdn-cgi/l/email-protection" data-cfemail="${cfEncode('nicolas@cureety.com')}">[email&#160;protected]</a></p>${nav}`),
    '/equipe': realPage('Notre équipe', `<p>Claire Martin</p><p>Head of Design</p>${nav}`),
    '/contact': realPage('Contact', nav),
  };
  const { fetchPage } = stubSite(origin, pages);
  const modelPages = [];
  const judged = [];
  const out = await findContacts({ company: 'Cureety', role: 'Product Designer', jobUrl: 'https://jobs.lever.co/cureety/1', jobText: 'Product Designer chez Cureety.', companyUrlHint: origin }, {
    fetchPage,
    webSearch: async (query) => (/Head of Design/.test(query) ? [{ title: 'Paul Durand - Head of Design - Cureety | LinkedIn', url: 'https://www.linkedin.com/in/pd', snippet: '' }] : []),
    extractPeople: async (text, { source } = {}) => { if (source !== 'posting') modelPages.push(text); return []; },
    judgePeople: async (candidates, { companyText }) => { judged.push(companyText); return candidates.map((_, i) => i); },
    resolveMx: async () => true,
  });
  const nicolas = out.contacts.find(c => c.email === 'nicolas@cureety.com');
  assert.equal(nicolas?.confidence, 'verified');
  assert.equal(nicolas.sources[0].url, `${origin}/mentions-legales`);
  assert.match(out.companyText, /^Cureety accompagne les patients/);
  assert.match(out.companyText, /télésurveillance/);
  assert.ok(!/Mentions légales\nContact/.test(out.companyText));
  assert.deepEqual(judged, [out.companyText]);
  assert.ok(modelPages.length >= 1 && /Notre équipe/.test(modelPages[0]), 'the team page goes to the model first, not the home page');
});

test('findContacts: a near-empty page that yields nothing is not counted as read', async () => {
  const { fetchPage } = stubSite('https://acme.io', {
    '/': '<html><body><a href="/contact">Contact</a><a href="/team">Team</a><a href="/about">About</a></body></html>',
    '/contact': '<html><body><p>Loading…</p></body></html>',
    '/team': '<html><body><p>Claire Martin, Head of Design</p></body></html>',
    '/about': realPage('About'),
  });
  const out = await findContacts({ company: 'Acme', role: 'Designer', jobUrl: 'https://jobs.lever.co/acme/1', jobText: 'Designer at Acme.', companyUrlHint: 'https://acme.io' }, { fetchPage, webSearch: null, resolveMx: async () => true });
  assert.ok(!out.pagesRead.includes('https://acme.io/contact'));
  assert.ok(out.pagesRead.includes('https://acme.io/team'), 'short, but it names someone');
  assert.ok(out.pagesRead.includes('https://acme.io/about'));
});

test('findContacts: the posting page JSON-LD (the board itself) gives no contact', async () => {
  const jobHtml = `<script type="application/ld+json">${JSON.stringify({ '@type': 'Organization', name: 'Some Board', email: 'support@someboard.io' })}</script><h1>Designer</h1>`;
  const out = await findContacts({ company: 'Synthlane', role: 'Designer', jobUrl: 'https://someboard.io/job/1', jobText: 'Designer\nSynthlane', jobHtml }, { fetchPage: async url => ({ ok: false, status: 404, html: '', text: '', url }), webSearch: async () => [], resolveMx: async () => true });
  assert.ok(!out.contacts.some(c => c.email === 'support@someboard.io'));
});
