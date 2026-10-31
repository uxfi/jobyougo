// Contact finder review fixes (2026-10-24): two-word role inboxes are no
// people, a refuted platform's inbox is never the pick, another company's
// founders and title-first team cards, the person in line for the role
// (recruiter, team lead, founder) as the best contact, the guess slots and
// the forward target, "I'm Grigory" is no surname, plus the low-severity
// items (vendor domains, entities, hostile pages, Lever case, German HR, the
// replay cache and the search stop). Name-guess cases live in
// contact-finder-sources.test.mjs. Fixtures only, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  addressNamePrinted,
  extractEmails,
  extractNamedPeople,
  findContacts,
  labelSaysAvoid,
  nameFromLocal,
  pageText,
  patternEvidence,
  pickCrawlLinks,
  pickForwardTarget,
  preDecodeHtml,
  roleRank,
  scoreContact,
} from '../lib/contact-finder.mjs';
import { isNotEmployerHost } from '../lib/non-employer-hosts.mjs';
import { ashbyAppData, atsSiteLookups, cleanOwnerName, linkedinCompanyPage } from '../lib/employer-site-sources.mjs';

const lines = people => people.map(p => `${p.firstName} ${p.lastName} | ${p.title}`);

function siteFetcher(pages, seen = []) {
  return async (url) => {
    const key = String(url).replace(/\/$/, '');
    seen.push(key);
    const html = pages[key];
    return html === undefined
      ? { ok: false, status: 404, html: '', text: '', url: key, error: 'HTTP 404' }
      : { ok: true, status: 200, html, text: pageText(html), url: key };
  };
}

// A team page of cards: name, title, and the person's address when given.
const cards = list => `<h1>Our team</h1>${list.map(([name, title, email]) => `<div><h3>${name}</h3><p>${title}</p>${email ? `<p>${email}</p>` : ''}</div>`).join('')}`;
const theOrg = (name, url, employees) => `<script type="application/ld+json">${JSON.stringify({ '@type': 'Organization', name, url, employee: employees.map(([person, jobTitle]) => ({ '@type': 'Person', name: person, jobTitle })) })}</script>`;

// ── FL-1 ────────────────────────────────────────────────────────────────────

test('FL-1: two-word role inboxes are no people, and their labels send them away', () => {
  const roleLocals = ['donnees.personnelles', 'vie.privee', 'data.protection', 'protection.donnees', 'new.business', 'business.development', 'accounts.payable', 'data.requests', 'mentions.legales', 'assistance.technique'];
  const html = `${roleLocals.map(local => `<p>${local}@acme.fr</p>`).join('')}<p>marie.dupont@acme.fr</p>`;
  const kinds = Object.fromEntries(extractEmails(html, { domain: 'acme.fr' }).map(item => [item.local, item.kind]));
  for (const local of roleLocals) {
    assert.notEqual(kinds[local], 'person', local);
    assert.deepEqual(nameFromLocal(local), { firstName: '', lastName: '' }, local);
  }
  assert.equal(kinds['marie.dupont'], 'person');
  // Two role inboxes are no first.last evidence.
  assert.equal(patternEvidence([], [{ email: 'donnees.personnelles@acme.fr' }, { email: 'accounts.payable@acme.fr' }]).pattern, '');
  for (const label of ['New business — x@acme.io', 'Données personnelles : x@acme.io', 'Vie privée : x@acme.io', 'Privacy questions: x@acme.io', 'Fournisseurs : x@acme.io']) {
    assert.ok(labelSaysAvoid(label, 'x@acme.io'), label);
  }
  assert.ok(!labelSaysAvoid('Everything else — x@acme.io', 'x@acme.io'));
});

test('FL-1: the shape of person addresses makes the pattern likely only when their names are printed beside them', () => {
  assert.ok(addressNamePrinted('Marie Dupont — marie.dupont@acme.io', 'marie.dupont'));
  assert.ok(addressNamePrinted('Dupont, Marie : marie.dupont@acme.io', 'marie.dupont'));
  assert.ok(addressNamePrinted('Hélène Dupont', 'helene.dupont'));
  assert.ok(addressNamePrinted('Paul Dupont, CTO', 'p.dupont'));
  assert.ok(!addressNamePrinted('New business — new.business@acme.io', 'new.business'));
  assert.ok(!addressNamePrinted('Paul: paul.martin@acme.io', 'paul.martin'));
  const printed = [{ email: 'marie.dupont@acme.io', printed: true }, { email: 'paul.martin@acme.io', printed: true }];
  assert.equal(patternEvidence([], printed).confidence, 'likely');
  assert.equal(patternEvidence([], printed.map(item => ({ ...item, printed: false }))).confidence, 'guess');
});

test('FL-1: the agency\'s new.business@ is never best nor greeted "New"; a legal notice\'s role inboxes make no likely pattern', async () => {
  const agency = await findContacts({ company: 'Greater Studio', role: 'Product Designer', companyUrlHint: 'https://greater.studio' }, {
    fetchPage: siteFetcher({
      'https://greater.studio': '<html lang="en"><title>Greater Studio</title><a href="/contact">Contact</a><p>Greater Studio is a design agency for climate companies across Europe.</p></html>',
      'https://greater.studio/contact': '<h1>Contact</h1><p>New business — new.business@greater.studio</p><p>Everything else — hello@greater.studio</p>',
    }),
    resolveMx: async () => true,
  });
  assert.equal(agency.best.email, 'hello@greater.studio');
  assert.ok(!agency.contacts.some(c => c.firstName === 'New'));

  const legal = await findContacts({ company: 'Acme', role: 'Product Designer', companyUrlHint: 'https://acme.fr' }, {
    fetchPage: siteFetcher({
      'https://acme.fr': '<a href="/mentions-legales">Mentions légales</a><a href="/equipe">Équipe</a><p>Acme conçoit des logiciels de paie pour les petites équipes en Europe.</p>',
      'https://acme.fr/mentions-legales': '<p>Écrire à donnees.personnelles@acme.fr</p><p>Comptabilité : accounts.payable@acme.fr</p><p>contact@acme.fr</p>',
      'https://acme.fr/equipe': '<p>Claire Martin, Head of Design</p>',
    }),
    resolveMx: async () => true,
  });
  assert.notEqual(legal.patternEvidence.confidence, 'likely');
  assert.equal(legal.contacts.find(c => c.email === 'claire.martin@acme.fr')?.confidence, 'guess');
  assert.ok(!legal.contacts.some(c => ['Donnees', 'Accounts'].includes(c.firstName)));
  assert.equal(legal.best.email, 'contact@acme.fr');
});

// ── FL-3 ────────────────────────────────────────────────────────────────────

test('FL-3: an ATS platform the run set aside never gives the best address; a hiring inbox in the posting text still does', async () => {
  const jobHtml = '<h1>Product Designer</h1><p>Acme Santé</p><footer>Une question sur la plateforme ? <a href="mailto:contact@taleez.com">contact@taleez.com</a> · <a href="mailto:hello@digitalrecruiters.com">hello@digitalrecruiters.com</a></footer>';
  const fetchPage = siteFetcher({ 'https://taleez.com': '<title>Taleez - logiciel de recrutement</title><p>contact@taleez.com</p>' });
  const deps = { fetchPage, webSearch: async () => [], resolveMx: async () => true };
  const taleez = await findContacts({ company: 'Acme Santé', role: 'Product Designer', jobUrl: 'https://acme-sante.taleez.com/jobs/product-designer-123', jobText: 'Product Designer\nAcme Santé\nLyon', jobHtml }, deps);
  assert.ok(taleez.notes.some(note => /taleez\.com ne mentionne pas « Acme Santé »/.test(note)));
  assert.ok(!taleez.contacts.some(c => c.email === 'contact@taleez.com'), 'the refuted platform\'s inbox is dropped');
  assert.equal(taleez.best, null, 'another vendor\'s footer inbox is no employer address either');

  const other = await findContacts({ company: 'Acme Santé', role: 'Product Designer', jobUrl: 'https://app.digitalrecruiters.com/acme/offre/123', jobText: 'Product Designer\nAcme Santé\nLyon', jobHtml }, deps);
  assert.equal(other.best, null);
  assert.ok(other.notes.some(note => /employeur non vérifié/.test(note)));

  const gouv = await findContacts({ company: 'Ministère de la Culture', role: 'Designer UX', jobUrl: 'https://choisirleservicepublic.gouv.fr/offre-emploi/123', jobText: 'Designer UX\nMinistère de la Culture\nCandidature : recrutement.design@culture.gouv.fr' }, deps);
  assert.equal(gouv.best?.email, 'recrutement.design@culture.gouv.fr');
});

test('FL-3: an unnamed company ("?") reads the posting\'s host but never confirms it', async () => {
  const out = await findContacts({ company: '?', role: 'Product Designer', jobUrl: 'https://www.remoterocketship.com/company/acme/jobs/product-designer-123', jobText: 'Product Designer\nRemote\nWe are a fast growing startup.' }, {
    fetchPage: siteFetcher({ 'https://remoterocketship.com': '<title>Remote Rocketship - remote jobs</title><p>Questions? hello@remoterocketship.com</p>' }),
    webSearch: async () => [],
    resolveMx: async () => true,
  });
  assert.equal(out.company.domain, 'remoterocketship.com');
  assert.equal(out.company.confirmed, false);
  assert.equal(out.best, null);
  assert.ok(out.notes.some(note => /Employeur inconnu/.test(note)));
});

// ── FL-4 ────────────────────────────────────────────────────────────────────

test('FL-4: "Founder of Globex", "CEO of Initech", "fondateur de BlaBlaCar" are another company\'s; team "of" titles stay', async () => {
  const people = extractNamedPeople([
    'Advisors',
    'John Smith, Founder of Globex',
    'Jane Roe, CEO of Initech',
    'Pierre Martin, fondateur de BlaBlaCar',
    'Anna Schmidt, Co-founder & CEO of Globex',
    'Claire Martin, Head of Engineering',
    'Paul Durand, VP of Sales',
    'Marie Curie, Founder of Acme',
  ].join('\n'), { company: 'Acme', domain: 'acme.com', teamLike: false });
  assert.deepEqual(lines(people), ['Claire Martin | Head of Engineering', 'Paul Durand | VP of Sales', 'Marie Curie | Founder']);
  // A board seat: "Vice President of …" is a team title, not a president's.
  assert.equal(extractNamedPeople('Stephen Minix, Vice President of Community', { company: 'Acme' })[0].title, 'Vice President of Community');

  const out = await findContacts({ company: 'Acme', role: 'Product Designer', companyUrlHint: 'https://acme.com' }, {
    fetchPage: siteFetcher({
      'https://acme.com': '<a href="/about">About</a><p>Acme builds payroll software for small teams in Europe.</p><p>contact@acme.com</p>',
      'https://acme.com/about': '<h2>Advisors</h2><p>John Smith, Founder of Globex</p><p>Jane Roe, CEO of Initech</p>',
    }),
    resolveMx: async () => true,
  });
  assert.ok(!out.contacts.some(c => /john\.smith|jane\.roe/.test(c.email)), 'no address is built for another company\'s advisors');
  assert.equal(pickForwardTarget(out), null);
});

// ── FL-5 ────────────────────────────────────────────────────────────────────

test('FL-5: team cards that print the title above the name pair each person with their own title', () => {
  const titleFirst = extractNamedPeople('Our team\nCEO\nJean Dupont\nCTO\nPaul Martin\nHead of Design\nMarie Curie\nTalent Acquisition Manager\nLea Roux', { sourceUrl: 'https://acme.io/team', company: 'Acme' });
  assert.deepEqual(lines(titleFirst), ['Jean Dupont | CEO', 'Paul Martin | CTO', 'Marie Curie | Head of Design', 'Lea Roux | Talent Acquisition Manager']);
  const nameFirst = extractNamedPeople('Our team\nJean Dupont\nCEO\nPaul Martin\nCTO\nMarie Curie\nHead of Design', { sourceUrl: 'https://acme.io/team', company: 'Acme' });
  assert.deepEqual(lines(nameFirst), ['Jean Dupont | CEO', 'Paul Martin | CTO', 'Marie Curie | Head of Design']);
  // A heading that reads like a title over name-first cards pairs as many
  // both ways: names first, the common layout.
  const headed = extractNamedPeople('Directors\nJean Dupont\nCEO\nPaul Martin\nCTO', { sourceUrl: 'https://acme.io/team', company: 'Acme' });
  assert.deepEqual(lines(headed), ['Jean Dupont | CEO', 'Paul Martin | CTO']);
  // Department and menu headings over a title are nobody.
  assert.deepEqual(extractNamedPeople('Customer Success\nHead of Customer Success\nCase Studies\nHead of Content\nPress Kit\nLead Generation', { sourceUrl: 'https://acme.io/team', company: 'Acme' }), []);
});

test('FL-5: the model\'s title wins over the card pass when it sits right beside the name', async () => {
  // Title-first cards closed by a title-like line pair as many both ways:
  // the card pass reads names first; the model reads them right.
  const team = 'Leadership\nCEO\nJean Dupont\nCTO\nPaul Martin\nHead of Design';
  const out = await findContacts({ company: 'Acme', role: 'Product Designer', companyUrlHint: 'https://acme.io' }, {
    fetchPage: siteFetcher({
      'https://acme.io': '<a href="/team">Team</a><p>Acme builds payroll software for small teams in Europe.</p>',
      'https://acme.io/team': team.split('\n').map(line => `<p>${line}</p>`).join(''),
    }),
    extractPeople: async () => [{ firstName: 'Jean', lastName: 'Dupont', title: 'CEO' }, { firstName: 'Paul', lastName: 'Martin', title: 'CTO' }],
    resolveMx: async () => true,
  });
  const byName = Object.fromEntries(out.people.map(p => [`${p.firstName} ${p.lastName}`, p]));
  assert.equal(byName['Jean Dupont'].title, 'CEO');
  assert.equal(byName['Paul Martin'].title, 'CTO');
});

// ── FL-A1, FL-A2, FL-A3 ─────────────────────────────────────────────────────

test('FL-A1: roleRank puts the recruiter, then the role\'s team lead, then a founder before other managers', () => {
  const ranking = { role: 'Product Leader & AI Builder' };
  assert.equal(roleRank({ title: 'Talent Acquisition Specialist', persona: 'recruiter' }, ranking), 1);
  assert.equal(roleRank({ title: 'Chief Product Officer', persona: 'hiring-manager' }, ranking), 2);
  assert.equal(roleRank({ title: 'CEO & Co-founder', persona: 'founder' }, ranking), 3);
  assert.equal(roleRank({ title: 'Head of Software Development', persona: 'hiring-manager' }, ranking), 4);
  assert.equal(roleRank({ title: 'Head of Global Partnerships', persona: 'hiring-manager' }, ranking), 5);
  assert.equal(roleRank({ title: 'Sales & Revenue Manager', persona: 'hiring-manager' }, ranking), 5);
  // A sales role's own lead is no other department; the posting's reporting line is a lead.
  assert.equal(roleRank({ title: 'VP Sales', persona: 'hiring-manager' }, { role: 'Account Executive' }), 2);
  assert.equal(roleRank({ title: 'VP of Product', persona: 'hiring-manager' }, { role: 'Lead Product Designer', reportTitle: 'VP of Product' }), 2);
  // A designer's team is often led by product.
  assert.equal(roleRank({ title: 'Chief Product Officer', persona: 'hiring-manager' }, { role: 'Senior Product Designer' }), 2);
  // TheOrg's +1 never decides between two printed addresses.
  const printed = { email: 'a@x.io', kind: 'person', persona: 'hiring-manager', confidence: 'verified', mx: true, sources: [{ type: 'site' }] };
  assert.equal(scoreContact({ ...printed, sources: [{ type: 'site' }, { type: 'theorg' }] }), scoreContact(printed));
});

test('FL-A1: RoomPriceGenie\'s best contact is the Talent Acquisition Specialist, never Sales or Partnerships', async () => {
  // TheOrg lists Andre too: its +1 used to make him the best contact.
  const site = (list) => siteFetcher({
    'https://roompricegenie.com': '<a href="/team">Team</a><p>RoomPriceGenie builds pricing software for independent hotels.</p>',
    'https://roompricegenie.com/team': cards(list),
    'https://theorg.com/org/roompricegenie': theOrg('RoomPriceGenie', 'https://roompricegenie.com', [['Andre Kaufmann', 'Head of Global Alliances']]),
  });
  // Titles whose label does not already send the address away (a "Sales"
  // or "Partnerships" label drops it as no hiring contact).
  const sales = ['Alex Becker', 'Revenue Manager', 'alex@roompricegenie.com'];
  const partnerships = ['Andre Kaufmann', 'Head of Global Alliances', 'andre@roompricegenie.com'];
  const cpo = ['David Weber', 'Chief Product Officer', 'david@roompricegenie.com'];
  const recruiter = ['Wiebke Hansen', 'Talent Acquisition Specialist', 'wiebke@roompricegenie.com'];
  const job = { company: 'RoomPriceGenie', role: 'Product Leader & AI Builder', companyUrlHint: 'https://roompricegenie.com' };
  const full = await findContacts(job, { fetchPage: site([sales, partnerships, cpo, recruiter]), resolveMx: async () => true });
  assert.equal(full.best.email, 'wiebke@roompricegenie.com');
  assert.deepEqual(full.contacts.slice(0, 2).map(c => c.email), ['wiebke@roompricegenie.com', 'david@roompricegenie.com']);
  const lead = await findContacts(job, { fetchPage: site([sales, partnerships, cpo]), resolveMx: async () => true });
  assert.equal(lead.best.email, 'david@roompricegenie.com');
  // Only other departments' managers: no one is drafted for without asking.
  const none = await findContacts(job, { fetchPage: site([sales, partnerships]), resolveMx: async () => true });
  assert.equal(none.best, null);
  assert.ok(none.notes.some(note => /rôle sans lien avec l'offre/.test(note)));
  // ...unless the site prints a hiring inbox.
  const inbox = await findContacts(job, { fetchPage: site([sales, partnerships, ['Jobs', 'Careers', 'jobs@roompricegenie.com']]), resolveMx: async () => true });
  assert.equal(inbox.best.email, 'jobs@roompricegenie.com');
});

test('FL-A2: the guess slots follow the role\'s order; a TheOrg manager of another team never pushes out the CEO', async () => {
  const team = [
    ['Anna Petit', 'Talent Acquisition Associate'],
    ['Claire Martin', 'Head of Design'],
    ['Paul Martin', 'CEO & Founder'],
    ['Jura Rensberg', 'Head of Software Development'],
    ['Cait Abernethy', 'VP Marketing'],
  ];
  const out = await findContacts({ company: 'Acme', role: 'Senior Product Designer', companyUrlHint: 'https://acme.io' }, {
    fetchPage: siteFetcher({
      'https://acme.io': '<a href="/team">Team</a><p>Acme builds payroll software for small teams in Europe.</p>',
      'https://acme.io/team': cards(team),
      'https://theorg.com/org/acme': theOrg('Acme', 'https://acme.io', [['Jura Rensberg', 'Head of Software Development'], ['Cait Abernethy', 'VP Marketing']]),
    }),
    resolveMx: async () => true,
  });
  const guessed = out.contacts.filter(c => c.status === 'guessed').map(c => c.email).sort();
  assert.deepEqual(guessed, ['anna.petit@acme.io', 'claire.martin@acme.io', 'paul.martin@acme.io']);
  assert.ok(out.notes.some(note => /Jura Rensberg/.test(note) && /Cait Abernethy/.test(note)));

  // Hubvisory: the CPO & co-founder and the CEO, never Finance, the office or sales.
  const hub = await findContacts({ company: 'Acme', role: 'Product Manager IA', companyUrlHint: 'https://acme.io' }, {
    fetchPage: siteFetcher({
      'https://acme.io': '<a href="/team">Team</a><p>Acme builds payroll software for small teams in Europe.</p>',
      'https://acme.io/team': cards([['Elena Hattab', 'Head of Finance'], ['Remi Deltombe', 'Office Director Lille'], ['Julie Bernard', 'Sales Manager'], ['Benoit Rosier', 'CPO & Co-founder'], ['Marc Petit', 'CEO & Founder']]),
    }),
    resolveMx: async () => true,
  });
  const kept = hub.contacts.filter(c => c.status === 'guessed').map(c => c.email);
  assert.ok(kept.includes('benoit.rosier@acme.io') && kept.includes('marc.petit@acme.io'), kept.join(', '));
});

test('FL-A3: the forward target is the recruiter or the posting\'s reporting line, never an account manager or a VP Marketing', async () => {
  const prolific = await findContacts({ company: 'Acme', role: 'Lead Product Designer', companyUrlHint: 'https://acme.io', jobText: 'Lead Product Designer. You will report to the VP of Product.' }, {
    fetchPage: siteFetcher({
      'https://acme.io': '<a href="/careers">Careers</a><p>Acme builds research tools for teams across Europe.</p>',
      'https://acme.io/careers': `${cards([['Jag Singh', 'Strategic Account Manager'], ['Sara Saab', 'VP of Product']])}<p>Apply: jobs@acme.io</p>`,
    }),
    resolveMx: async () => true,
  });
  assert.equal(prolific.best.email, 'jobs@acme.io');
  assert.deepEqual(pickForwardTarget(prolific), { firstName: 'Sara', lastName: 'Saab', title: 'VP of Product', persona: 'hiring-manager', source: 'site' });

  const upmetrics = await findContacts({ company: 'Acme', role: 'Senior Product Designer', companyUrlHint: 'https://acme.io' }, {
    fetchPage: siteFetcher({
      'https://acme.io': '<a href="/team">Team</a><p>Acme builds impact reporting software for nonprofits.</p><p>hello@acme.io</p>',
      'https://acme.io/team': cards([['Cait Abernethy', 'Vice President, Marketing'], ['Emily Pham', 'Talent Acquisition Associate']]),
      'https://theorg.com/org/acme': theOrg('Acme', 'https://acme.io', [['Cait Abernethy', 'Vice President, Marketing']]),
    }),
    resolveMx: async () => true,
  });
  assert.equal(pickForwardTarget(upmetrics)?.firstName, 'Emily');
  // Nobody but other departments: no one to forward to.
  assert.equal(pickForwardTarget({ ...upmetrics, people: upmetrics.people.filter(p => p.firstName === 'Cait') }), null);
});

// ── FL-A4 ───────────────────────────────────────────────────────────────────

test('FL-A4: "Hi, I\'m Grigory, CTO" names no "I\'m Grigory" and builds no im.grigory@', async () => {
  for (const text of ["Hi — I'm Grigory, co-founder and CTO at Secfix.", "Hello! I’m Grigory, CTO at Secfix.", "Hi, I'm Marie, Head of Design."]) {
    assert.deepEqual(extractNamedPeople(text, { company: 'Secfix', domain: 'secfix.com', teamLike: false }), [], text);
  }
  assert.deepEqual(lines(extractNamedPeople("Hi, I'm Marie Dupont, Head of Design.", { teamLike: false })), ['Marie Dupont | Head of Design']);
  const out = await findContacts({ company: 'Secfix', role: 'Product Designer', companyUrlHint: 'https://secfix.com', jobText: "Hi — I'm Grigory, co-founder and CTO at Secfix. Apply: jobs@secfix.com" }, {
    fetchPage: siteFetcher({ 'https://secfix.com': '<p>Secfix automates security compliance for European startups.</p>' }),
    resolveMx: async () => true,
  });
  assert.ok(!out.contacts.some(c => /^im\./.test(c.email)));
  assert.ok(!out.people.some(p => /^I['’]m$/.test(p.firstName)));
  assert.notEqual(pickForwardTarget(out)?.firstName, "I'm");
});

// ── Low severity ────────────────────────────────────────────────────────────

test('FL-6: a vendor named like its own domain owns it (Ashby, Factorial); its tenants stay off', () => {
  assert.equal(isNotEmployerHost('ashbyhq.com', { company: 'Ashby' }), false);
  assert.equal(isNotEmployerHost('www.factorialhr.com', { company: 'Factorial' }), false);
  assert.equal(isNotEmployerHost('jobs.ashbyhq.com', { company: 'Acme' }), true);
  assert.equal(isNotEmployerHost('acme.factorialhr.com'), true);
  assert.equal(isNotEmployerHost('clutch.co', { company: 'MLabs' }), true);
  const ashby = ashbyAppData('<script>window.__appData = {"organization":{"name":"Ashby","publicWebsite":"https://www.ashbyhq.com"}};</script>');
  assert.deepEqual(ashby, { website: 'https://www.ashbyhq.com/', ownerName: 'Ashby' });
  const other = ashbyAppData('<script>window.__appData = {"organization":{"name":"Acme","publicWebsite":"https://www.ashbyhq.com"}};</script>');
  assert.equal(other.website, '', 'another account naming the vendor\'s site gets nothing');
});

test('FL-7: an out-of-range numeric entity is kept as text, never thrown', () => {
  assert.doesNotThrow(() => linkedinCompanyPage('<a class="topcard__org-name-link" href="https://www.linkedin.com/company/acme&#1114112;">Acme</a>'));
  assert.equal(cleanOwnerName('Acme &#1114112;'), 'Acme &#1114112;');
  assert.equal(cleanOwnerName('Caf&#233; Acme'), 'Café Acme');
});

test('FL-8: unclosed anchors and Cloudflare tags on a hostile page stay linear', () => {
  const anchors = '<a href="'.repeat(4000);
  let started = Date.now();
  pickCrawlLinks(anchors, 'https://acme.io/');
  pickCrawlLinks('<a href="mailto:x'.repeat(2500), 'https://acme.io/');
  assert.ok(Date.now() - started < 1500, `anchors took ${Date.now() - started} ms`);
  started = Date.now();
  preDecodeHtml('<span data-cfemail="0a"'.repeat(1700));
  assert.ok(Date.now() - started < 1500, `cfemail took ${Date.now() - started} ms`);
  // Still read: a link and a protected address.
  assert.deepEqual(pickCrawlLinks('<a class="nav" href="/contact" title="x">Contact</a>', 'https://acme.io/'), ['https://acme.io/contact']);
  const cf = (email, key = 0x2a) => key.toString(16).padStart(2, '0') + [...Buffer.from(email)].map(byte => (byte ^ key).toString(16).padStart(2, '0')).join('');
  assert.equal(preDecodeHtml(`<span class="__cf_email__" data-cfemail="${cf('jobs@acme.io')}">[email&#160;protected]</span>`), 'jobs@acme.io');
});

test('FL-A6: a Lever lookup keeps the account\'s case from the job URL', () => {
  const lookups = atsSiteLookups('https://jobs.lever.co/Deliverect/7a2c1e9b-1234');
  assert.equal(lookups.find(item => item.ats === 'lever')?.url, 'https://jobs.lever.co/Deliverect');
  assert.equal(atsSiteLookups('https://jobs.eu.lever.co/acme/1').find(item => item.ats === 'lever')?.url, 'https://jobs.eu.lever.co/acme');
});

test('FL-A7: a German HR team named in the posting is a recruiter, so it is the forward target', async () => {
  const out = await findContacts({ company: 'Acme', role: 'Product Designer', companyUrlHint: 'https://acme.de', jobText: 'Deine Ansprechpartnerin: Anna Schmidt, Personalabteilung. Bewerbung an jobs@acme.de' }, {
    fetchPage: siteFetcher({ 'https://acme.de': '<p>Acme entwickelt Software für kleine Teams in Deutschland.</p>' }),
    extractPeople: async (text, { source } = {}) => (source === 'posting' ? [{ firstName: 'Anna', lastName: 'Schmidt', title: 'Personalabteilung' }] : []),
    resolveMx: async () => true,
  });
  const anna = out.people.find(p => p.firstName === 'Anna');
  assert.equal(anna?.persona, 'recruiter');
  assert.equal(pickForwardTarget(out)?.firstName, 'Anna');
});

test('FI-3: findContacts hands its abort signal and deadline to the search, so a running search can stop', async () => {
  const seen = [];
  const controller = new AbortController();
  await findContacts({ company: 'Acme', role: 'Designer', jobUrl: 'https://jobs.lever.co/acme/1', jobText: 'Designer at Acme.' }, {
    fetchPage: siteFetcher({}),
    webSearch: async (query, opts) => { seen.push(opts); return []; },
    resolveMx: async () => false,
    signal: controller.signal,
    deadlineMs: 60000,
    now: () => 1000,
  });
  assert.ok(seen.length > 0);
  assert.ok(seen.every(opts => opts.signal === controller.signal && opts.stopAt === 61000));
});

test('FI-2: a run cut by the deadline, or one that found no address, is not replayed', () => {
  const src = readFileSync(new URL('../ui/server.mjs', import.meta.url), 'utf8');
  const code = src.slice(src.indexOf('const contactFinderCache = new Map();'), src.indexOf('/** The contact fields the page needs'));
  const sandbox = { normalizeUrl: url => String(url).toLowerCase(), Date };
  vm.runInNewContext(`${code}\nthis.remember = rememberContactFinderResult; this.cache = contactFinderCache;`, sandbox);
  const url = 'https://jobs.example/9';
  sandbox.remember(url, { jobText: 'posting' }, { userKey: 'owner', found: { contacts: [{ email: 'jobs@acme.io' }], stopped: '' } });
  assert.ok(sandbox.cache.get(url).foundByUser.owner, 'a complete run with contacts is kept');
  sandbox.remember(url, { jobText: 'posting' }, { userKey: 'owner', found: { contacts: [{ email: 'jobs@acme.io' }], stopped: 'deadline' } });
  assert.equal(sandbox.cache.get(url).foundByUser.owner, undefined, 'a deadline run replaces nothing and is not kept');
  sandbox.remember(url, { jobText: 'posting' }, { userKey: 'user-2', found: { contacts: [] } });
  assert.equal(sandbox.cache.get(url).foundByUser['user-2'], undefined, 'an empty run is not kept');
  assert.equal(sandbox.cache.get(url).jobText, 'posting', 'the posting text is cached either way');
});
