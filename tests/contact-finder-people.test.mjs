// FP5: named people on the employer's own pages. Card and legal-heading
// passes, case-sensitive names, guards against testimonials and invented
// surnames, the model pass on the real team page, the LinkedIn poster.
// Fixtures are the page shapes quoted by the finder lenses (no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractNamedPeople,
  findContacts,
  isTeamLikePage,
  pageText,
  parseLinkedInPoster,
} from '../lib/contact-finder.mjs';

const names = people => people.map(p => `${p.firstName} ${p.lastName}`);
const byName = people => Object.fromEntries(people.map(p => [`${p.firstName} ${p.lastName}`, p]));

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

test('cards: AssessFirst leaders on /leadership-management-team, six people with their titles', () => {
  const text = [
    'Leadership & Management Team',
    'David Bernard', 'CEO & Founder',
    'Simon Baron', 'Chief Product Officer',
    'Alexandre Collignon', 'Chief Operating Officer',
    'Arthur Bequin', 'Chief Financial Officer',
    'Quentin Cervelle', 'Chief Revenue Officer',
    'Jean-Baptiste Comte', 'Chief Technical Officer',
    'Book a demo',
  ].join('\n');
  const people = extractNamedPeople(text, { sourceUrl: 'https://www.assessfirst.com/en/leadership-management-team', company: 'AssessFirst' });
  assert.deepEqual(names(people), ['David Bernard', 'Simon Baron', 'Alexandre Collignon', 'Arthur Bequin', 'Quentin Cervelle', 'Jean-Baptiste Comte']);
  const map = byName(people);
  assert.equal(map['David Bernard'].title, 'CEO & Founder');
  assert.equal(map['David Bernard'].persona, 'founder');
  assert.equal(map['Simon Baron'].title, 'Chief Product Officer');
  // The same cards on a page that is not about the team, with no heading
  // that says so, give nobody.
  const cardsOnly = text.split('\n').slice(1).join('\n');
  assert.deepEqual(extractNamedPeople(cardsOnly, { sourceUrl: 'https://www.assessfirst.com/en/blog/hiring-tips', company: 'AssessFirst' }), []);
});

test('cards: AppTweak team page gives its recruiters; "Front End / Tech Lead" is no person', () => {
  const text = [
    'Notre équipe',
    'Martin Techy', 'Engineering Manager',
    'Jade Clot', 'HR People Operations',
    'Front End', 'Tech Lead',
    'Madeleine Le Sergent', 'Head of People',
    'Alice Caputo', 'Talent Acquisition Specialist',
    'Ramzi Salem', 'Head of Product Design',
    'Nicolas Beraudo', 'Co-CEO, Customer Journey',
  ].join('\n');
  const people = extractNamedPeople(text, { sourceUrl: 'https://www.apptweak.com/fr/about/our-team', company: 'AppTweak', domain: 'apptweak.com' });
  const map = byName(people);
  assert.equal(map['Madeleine Le Sergent'].title, 'Head of People');
  assert.equal(map['Madeleine Le Sergent'].persona, 'recruiter');
  assert.equal(map['Alice Caputo'].persona, 'recruiter');
  assert.equal(map['Jade Clot'].persona, 'recruiter');
  assert.equal(map['Ramzi Salem'].persona, 'hiring-manager');
  // A comma tail that is a field, not a company, stays in the title.
  assert.equal(map['Nicolas Beraudo'].title, 'Co-CEO, Customer Journey');
  assert.ok(!people.some(p => /Front|Tech/.test(p.firstName)));
});

test('same line without a separator: "Philipp Schröder Co-Founder & Chief Executive Officer" on a team page', () => {
  const text = [
    'Philipp Schröder Co-Founder & Chief Executive Officer',
    'Carsten Buchberger Chief People Officer',
    'Maxine von Grumbkow VP Communications',
  ].join('\n');
  const map = byName(extractNamedPeople(text, { sourceUrl: 'https://1komma5.com/en/team/' }));
  assert.equal(map['Philipp Schröder'].title, 'Co-Founder & Chief Executive Officer');
  assert.equal(map['Philipp Schröder'].persona, 'founder');
  assert.equal(map['Carsten Buchberger'].persona, 'recruiter');
  // The particle stays in the surname, lower case.
  assert.equal(map['Maxine von Grumbkow'].lastName, 'von Grumbkow');
  // One such line on a page about something else is a caption, not a team.
  assert.deepEqual(extractNamedPeople('Pressefotos Europace Vorstand', { sourceUrl: 'https://europace.de/presse' }), []);
});

test('legal headings: Geschäftsführer, Managing Directors, Vorstand, Represented by, with their name lists', () => {
  const gf = extractNamedPeople('Impressum\nGeschäftsführer\nPhilipp Schröder, Micha Grüber\nHandelsregister: HRB 1234', { sourceUrl: 'https://1komma5.com/impressum' });
  assert.deepEqual(names(gf), ['Philipp Schröder', 'Micha Grüber']);
  assert.ok(gf.every(p => p.persona === 'founder' && p.title === 'Geschäftsführer'));
  const md = extractNamedPeople('Managing Directors: Christoph Berner, Fritz Cramer, Maximilian Seifert', { sourceUrl: 'https://www.cosuno.com/en/imprint' });
  assert.deepEqual(names(md), ['Christoph Berner', 'Fritz Cramer', 'Maximilian Seifert']);
  const board = extractNamedPeople('Vorstand\nStefan Münter, Thomas Heiserowski\nAufsichtsrat', { sourceUrl: 'https://europace.de/impressum' });
  assert.deepEqual(names(board), ['Stefan Münter', 'Thomas Heiserowski']);
  const secfix = extractNamedPeople('Represented by:\nFabiola Munguia\nGrigory Emelianov\nRegister court: Berlin', { sourceUrl: 'https://www.secfix.com/legal/imprint' });
  assert.deepEqual(names(secfix), ['Fabiola Munguia', 'Grigory Emelianov']);
  // Both directors, honorific aside (only the first was kept before).
  const zollsoft = extractNamedPeople('Geschäftsführer: Dr. Andreas Zollmann, Johannes Zollmann', { sourceUrl: 'https://zollsoft.de/impressum' });
  assert.deepEqual(names(zollsoft), ['Andreas Zollmann', 'Johannes Zollmann']);
});

test('French and English lines: Directrice de la publication, a recruiter title, a particle surname', () => {
  const theodo = extractNamedPeople('Directrice de la publication : Madame Noémie Parker, Présidente', { sourceUrl: 'https://www.theodo.com/mentions-legales' });
  assert.deepEqual(names(theodo), ['Noémie Parker']);
  assert.equal(theodo[0].persona, 'founder');
  const anna = extractNamedPeople('Anna Schmidt, Talent Acquisition Manager');
  assert.equal(anna[0].title, 'Talent Acquisition Manager');
  assert.equal(anna[0].persona, 'recruiter');
  assert.equal(extractNamedPeople('Anna Schmidt, Co-Founder & CEO')[0].title, 'Co-Founder & CEO');
  const fontaine = extractNamedPeople('Jean de La Fontaine, CEO');
  assert.equal(fontaine[0].firstName, 'Jean');
  assert.equal(fontaine[0].lastName, 'de La Fontaine');
  assert.equal(extractNamedPeople('Société Acme SAS, représentée par son Président, M. Jean Dupont')[0].lastName, 'Dupont');
});

test('negatives: lowercase prose, lead-in words, testimonials, feature lists, cookie footers, a lone card', () => {
  assert.deepEqual(extractNamedPeople('gemeinsam mit der Geschäftsführung an der strategischen Unternehmensentwicklung', { sourceUrl: 'https://zollsoft.de/jobs/business-development/' }), []);
  const alex = extractNamedPeople('Découvrez Alex, CTO chez AppTweak\nRencontrez Frank, architecte produit chez AppTweak', { sourceUrl: 'https://www.apptweak.com/fr/about/our-tech-stack', company: 'AppTweak' });
  assert.ok(!alex.some(p => p.firstName === 'Alex' || p.firstName === 'Découvrez' || p.lastName === 'Alex'));
  assert.deepEqual(alex, []);
  const testimonials = 'Greg Isenberg | Founder, Late Checkout\nMarion Decaen | HR Development Manager at UGC';
  assert.deepEqual(extractNamedPeople(testimonials, { sourceUrl: 'https://www.lindy.ai/', company: 'Lindy' }), []);
  assert.deepEqual(extractNamedPeople('Greg Isenberg\nFounder, Late Checkout\nMarion Decaen\nHR Development Manager at UGC', { sourceUrl: 'https://www.lindy.ai/team', company: 'Lindy' }), []);
  assert.deepEqual(extractNamedPeople('Streamline your\nrecruitment\nLearn More\nProduct Manager', { sourceUrl: 'https://acme.io/team' }), []);
  assert.deepEqual(extractNamedPeople('We use cookies to improve your experience.\nAccept all\nCookie Settings\nPrivacy Policy\nManage Preferences', { sourceUrl: 'https://acme.io/team' }), []);
  assert.deepEqual(extractNamedPeople('Our team\nDavid Bernard\nCEO & Founder\nJoin us', { sourceUrl: 'https://acme.io/team' }), []);
});

test('guards: quotes, job listings, board members, the GDPR controller, a card title above the next name', () => {
  // A customer's quote on the home page; the company's own CEO quoting is kept.
  assert.deepEqual(extractNamedPeople('« Les informations d’AppTweak changent la donne. »\nMike Reese , Responsable Applications Mobiles', { company: 'AppTweak' }), []);
  const own = extractNamedPeople('" Open source gives organizations transparent building blocks. "\nFlorian Douetteau , CEO and co-founder, Dataiku', { company: 'Dataiku' });
  assert.equal(own[0].title, 'CEO and co-founder');
  // "Title - Department" is an opening on a careers page; a C-level before a dash is a person.
  assert.deepEqual(extractNamedPeople('Team Lead - Enterprise Delivery\nProduct Manager – XTM Hub', { sourceUrl: 'https://www.deliverect.com/en/careers' }), []);
  assert.equal(extractNamedPeople('CEO – Anna Schmidt')[0].lastName, 'Schmidt');
  assert.deepEqual(extractNamedPeople('Peter Campbell\nFormer Chief Financial Officer of Mimecast\nMaxwell Long\nChief Revenue Officer', { sourceUrl: 'https://www.dataiku.com/company/leadership' }).map(p => p.lastName), []);
  assert.deepEqual(extractNamedPeople('Établissement de Santé, responsable du traitement des données personnelles'), []);
  // UpMetrics: "Managing Director" is Kyle's card title, not a heading for Stephen.
  const up = byName(extractNamedPeople('Our Team\nKyle Lukianuk\nManaging Director\nStephen Minix\nVice President of Community', { sourceUrl: 'https://upmetrics.com/team', company: 'UpMetrics' }));
  assert.equal(up['Kyle Lukianuk'].title, 'Managing Director');
  assert.equal(up['Stephen Minix'].title, 'Vice President of Community');
  // An about page counts its cards under a heading that names the team.
  const cureety = extractNamedPeople("L'équipe dirigeante\nFrançois-Guirec CHAMPOISEAU\nPrésident\nHugo BREITWILLER\nDirecteur Produit", { sourceUrl: 'https://www.cureety.com/a-propos' });
  assert.deepEqual(names(cureety), ['François-Guirec Champoiseau', 'Hugo Breitwiller']);
  assert.equal(byName(cureety)['Hugo Breitwiller'].title, 'Directeur Produit');
  assert.deepEqual(extractNamedPeople('Jean Dupont\nCEO\nMarie Curie\nCTO', { sourceUrl: 'https://acme.io/blog/our-story' }), []);
});

test('a crowded page keeps 40 people at most, recruiters first in line', () => {
  const firsts = ['Anna', 'Bruno', 'Clara', 'David', 'Emma', 'Felix', 'Greta', 'Hugo', 'Ines'];
  const lasts = ['Martin', 'Bernard', 'Dubois', 'Thomas', 'Robert'];
  const cards = [];
  for (const last of lasts) for (const first of firsts) cards.push(`${first} ${last}`, 'Account Manager');
  cards[cards.length - 1] = 'Talent Acquisition Specialist';
  const people = extractNamedPeople(['Meet the team', ...cards].join('\n'), { sourceUrl: 'https://acme.io/team', role: 'Product Designer' });
  assert.equal(people.length, 40);
  assert.ok(people.some(p => p.firstName === 'Ines' && p.lastName === 'Robert' && p.persona === 'recruiter'));
  assert.equal(`${people[0].firstName} ${people[0].lastName}`, 'Anna Martin');
});

test('isTeamLikePage: team words in the path or the label, never in a product or blog section', () => {
  assert.ok(isTeamLikePage('https://www.assessfirst.com/en/leadership-management-team'));
  assert.ok(isTeamLikePage('https://www.apptweak.com/fr/about/our-team'));
  assert.ok(isTeamLikePage('https://acme.de/ueber-uns'));
  assert.ok(isTeamLikePage('https://acme.io/fr/about/who-we-are'));
  assert.ok(isTeamLikePage('https://roompricegenie.com/genies/', 'Meet the Genies'));
  assert.ok(!isTeamLikePage('https://www.secfix.com/product/people-management'));
  assert.ok(!isTeamLikePage('https://acme.io/contact'));
  assert.ok(!isTeamLikePage('https://acme.io/'));
});

test('model post-check: a title read as a surname is refused on the site, kept as a first name in the posting', async () => {
  const site = {
    'https://acme.io': '<a href="/equipe">Équipe</a><p>Acme builds data products for retail teams across Europe.</p>',
    'https://acme.io/equipe': '<h1>Notre équipe</h1><p>Benoit, Cofondateur &amp; Head of AI</p><p>Romain, Director &amp; Head of Training</p><p>Claire Martin, Head of Design</p>',
  };
  const out = await findContacts({ company: 'Acme', role: 'Product Designer', companyUrlHint: 'https://acme.io', jobText: 'Ton contact : Benoit, Cofondateur & Head of AI.' }, {
    fetchPage: siteFetcher(site),
    resolveMx: async () => true,
    extractPeople: async (text, { source } = {}) => (source === 'posting'
      ? [{ firstName: 'Benoit', lastName: 'Cofondateur', title: 'Cofondateur & Head of AI' }]
      : [{ firstName: 'Benoit', lastName: 'Cofondateur', title: 'Cofondateur & Head of AI' }, { firstName: 'Romain', lastName: 'Training', title: 'Director & Head of Training' }, { firstName: 'Claire', lastName: 'Martin', title: 'Head of Design' }]),
  });
  assert.ok(!out.people.some(p => /Cofondateur|Training|Director/.test(p.lastName)));
  assert.ok(!out.contacts.some(c => /cofondateur|training|director/.test(c.email)));
  const benoit = out.people.find(p => p.firstName === 'Benoit');
  assert.equal(benoit.lastName, '');
  assert.equal(benoit.title, 'Cofondateur & Head of AI');
  assert.ok(out.people.some(p => p.firstName === 'Claire' && p.lastName === 'Martin'));
});

test('model page selection: the real team page from just before its cards, never the home page whose menu says Team', async () => {
  const filler = Array.from({ length: 100 }, (_, i) => `<p>we build tools that help small teams plan their week, line ${i} of our long story.</p>`).join('');
  const cards = '<div><h3>Claire Martin</h3><p>Head of Design</p></div><div><h3>Paul Durand</h3><p>Talent Acquisition Manager</p></div><div><h3>Léa Bernard</h3><p>CTO</p></div><div><h3>Hugo Petit</h3><p>Head of Product</p></div>';
  const site = {
    'https://acme.io': '<nav><a href="/our-team">Team</a><a href="/contact">Contact</a></nav><p>Acme builds payroll software for small teams across Europe and beyond.</p>',
    'https://acme.io/our-team': `<h1>Our team</h1>${filler}${cards}<p>Join us</p>`,
    'https://acme.io/contact': '<p>Write to hello@acme.io for anything at all.</p>',
  };
  assert.ok(pageText(site['https://acme.io/our-team']).indexOf('Claire Martin') > 7000);
  const recorded = [];
  const out = await findContacts({ company: 'Acme', role: 'Product Designer', companyUrlHint: 'https://acme.io' }, {
    fetchPage: siteFetcher(site),
    resolveMx: async () => true,
    extractPeople: async (text) => { recorded.push(text); return []; },
  });
  assert.ok(recorded.length >= 1 && recorded.length <= 3);
  assert.ok(recorded[0].includes('Claire Martin') && recorded[0].includes('Hugo Petit'));
  assert.ok(recorded[0].length <= 6000);
  assert.ok(!recorded.some(text => text.includes('payroll software')));
  // The deterministic card pass found them all the same.
  assert.ok(out.people.some(p => p.firstName === 'Paul' && p.persona === 'recruiter'));
});

test('model page selection: a page whose cards already gave 5+ people is not sent; two calls a page at most', async () => {
  const cards = ['Claire Martin', 'Paul Durand', 'Léa Bernard', 'Hugo Petit', 'Inès Moreau', 'Marc Lefebvre']
    .map((name, i) => `<div><h3>${name}</h3><p>${['Head of Design', 'Recruiter', 'CTO', 'Head of Product', 'VP Sales', 'Engineering Manager'][i]}</p></div>`).join('');
  const long = Array.from({ length: 400 }, (_, i) => `<p>our people story goes on, chapter ${i} of the long read.</p>`).join('');
  const site = {
    'https://acme.io': '<a href="/team">Team</a><a href="/about">About</a><p>Acme builds payroll software for small teams across Europe.</p>',
    'https://acme.io/team': `<h1>Team</h1>${cards}`,
    'https://acme.io/about': `<h1>About</h1>${long}`,
  };
  const recorded = [];
  await findContacts({ company: 'Acme', companyUrlHint: 'https://acme.io' }, {
    fetchPage: siteFetcher(site),
    resolveMx: async () => true,
    extractPeople: async (text) => { recorded.push(text); return []; },
  });
  assert.ok(!recorded.some(text => text.includes('Claire Martin')));
  // The long about page: two 6000-character windows, no more.
  assert.equal(recorded.length, 2);
  assert.ok(recorded.every(text => text.length <= 6000 && text.includes('chapter')));
});

test('guesses: recruiters and the lead of the role\'s team take the three slots before account managers', async () => {
  const card = ([name, title]) => `<div><h3>${name}</h3><p>${title}</p></div>`;
  const cards = [['Anna Martin', 'Account Manager'], ['Bruno Petit', 'Customer Success Manager'], ['Clara Dubois', 'Office Manager'], ['David Moreau', 'Sales Manager'], ['Emma Laurent', 'Head of Product Design'], ['Felix Simon', 'Talent Acquisition Specialist']];
  const site = {
    'https://acme.io': '<a href="/team">Team</a><p>Acme builds payroll software for small teams across Europe.</p>',
    'https://acme.io/team': `<h1>Team</h1>${cards.map(card).join('')}`,
  };
  const out = await findContacts({ company: 'Acme', role: 'Senior Product Designer', companyUrlHint: 'https://acme.io' }, { fetchPage: siteFetcher(site), resolveMx: async () => true });
  const emails = out.contacts.map(c => c.email);
  assert.ok(emails.includes('felix.simon@acme.io'));
  assert.ok(emails.includes('emma.laurent@acme.io'));
  assert.ok(!emails.includes('bruno.petit@acme.io') && !emails.includes('david.moreau@acme.io'));
  // "Chief Technical Officer" leads a backend team as a CTO would.
  const leaders = [['David Bernard', 'CEO & Founder'], ['Simon Baron', 'Chief Product Officer'], ['Alexandre Collignon', 'Chief Operating Officer'], ['Arthur Bequin', 'Chief Financial Officer'], ['Jean-Baptiste Comte', 'Chief Technical Officer']];
  const backend = await findContacts({ company: 'Acme', role: 'Backend Engineer', companyUrlHint: 'https://acme.io' }, {
    fetchPage: siteFetcher({ ...site, 'https://acme.io/team': `<h1>Leadership team</h1>${leaders.map(card).join('')}` }),
    resolveMx: async () => true,
  });
  assert.ok(backend.contacts.some(c => c.email === 'jeanbaptiste.comte@acme.io'));
});

const POSTER_HTML = `<section class="core-section-container">
<div class="message-the-recruiter">
  <h3 class="message-the-recruiter__title">Contactez l’auteur de l’offre d’emploi</h3>
  <div class="base-main-card flex flex-wrap py-2 relative base-main-card--link">
    <a class="base-card__full-link absolute" href="https://fr.linkedin.com/in/lo%C3%AFck-macquart-moulin-1a2b3c4d?trk=public_jobs_topcard_hiring-team&amp;refId=x" data-tracking-control-name="public_jobs_topcard_hiring-team">
      <span class="sr-only">Loïck Macquart-moulin</span>
    </a>
    <div class="base-main-card__info self-center">
      <h3 class="base-main-card__title font-sans text-[16px] font-bold">
        Loïck Macquart-moulin
      </h3>
      <h4 class="base-main-card__subtitle body-text text-color-text">
        Responsable RH chez Mon-Marché.fr
      </h4>
    </div>
  </div>
</div>
</section>`;

test('parseLinkedInPoster: the person who posted the offer, as a recruiter with a profile link', () => {
  const poster = parseLinkedInPoster(POSTER_HTML, { company: 'Mon-Marché' });
  assert.equal(poster.firstName, 'Loïck');
  assert.equal(poster.lastName, 'Macquart-moulin');
  assert.equal(poster.title, 'Responsable RH');
  assert.equal(poster.persona, 'recruiter');
  assert.equal(poster.linkedinUrl, 'https://fr.linkedin.com/in/lo%C3%AFck-macquart-moulin-1a2b3c4d');
  // An agency recruiter (another company in the subtitle), no block, an initial: nothing.
  assert.equal(parseLinkedInPoster(POSTER_HTML.replace('Responsable RH chez Mon-Marché.fr', 'Recruiter at Michael Page'), { company: 'Mon-Marché' }), null);
  assert.equal(parseLinkedInPoster('<div class="show-more-less-html__markup">Rejoignez-nous</div>', { company: 'Mon-Marché' }), null);
  assert.equal(parseLinkedInPoster(POSTER_HTML.replace(/Loïck Macquart-moulin\n/, 'Loïck M.\n'), { company: 'Mon-Marché' }), null);
});

test('findContacts: the LinkedIn poster joins the people from the posting; a page without the card changes nothing', async () => {
  const site = { 'https://mon-marche.fr': '<p>Mon-Marché livre des produits frais à Paris et en Île-de-France.</p>' };
  const base = { company: 'Mon-Marché', role: 'Product Designer', jobUrl: 'https://www.linkedin.com/jobs/view/4470893067', jobText: 'Product Designer chez Mon-Marché.', companyUrlHint: 'https://mon-marche.fr' };
  const deps = { fetchPage: siteFetcher(site), resolveMx: async () => true };
  const out = await findContacts({ ...base, jobHtml: POSTER_HTML }, deps);
  const poster = out.people.find(p => p.firstName === 'Loïck');
  assert.equal(poster.persona, 'recruiter');
  assert.equal(poster.linkedinUrl, 'https://fr.linkedin.com/in/lo%C3%AFck-macquart-moulin-1a2b3c4d');
  assert.ok(poster.sources.some(s => s.type === 'posting'));
  assert.ok(out.contacts.some(c => c.firstName === 'Loïck' && c.linkedinUrl === poster.linkedinUrl));
  const without = await findContacts({ ...base, jobHtml: '<div class="show-more-less-html__markup">Product Designer chez Mon-Marché.</div>' }, deps);
  assert.deepEqual(without.people, []);
});
