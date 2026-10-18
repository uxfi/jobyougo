import test from 'node:test';
import assert from 'node:assert/strict';
import { explainTitle, geoPolicyFrom } from '../lib/scan-decision.mjs';
import { portalsForProfile, scanTermsFrom, targetingFromProfile, templatePortals } from '../lib/scan-targeting.mjs';

// A cut of the owner's portals.yml before 2026-10-13: role words everywhere.
const LEGACY = {
  title_filter: {
    positive: ['Product Designer', 'UX Designer', 'UI Designer', 'UX/UI', 'Product Manager', 'Design Lead', 'Web Designer'],
    negative: ['Junior', 'Intern', 'Data Scientist', 'Java ', 'customer support', 'United States', 'US Remote', 'Toronto'],
    positive_patterns: ['\\bproduct\\s+(manager|designer|builder)\\b'],
    negative_patterns: ['\\b(engineering|sales|account)\\s+manager\\b', '\\b(junior|intern)\\b'],
    seniority_boost: ['Senior', 'Lead'],
  },
  job_board_keywords: ['Product Designer', 'UX Designer', 'Solutions Architect', 'Forward Deployed'],
  search_queries: [
    { name: 'Ashby — Design EU', query: 'site:jobs.ashbyhq.com ("Product Designer" OR "UX Designer" OR "Solutions Architect") ("full remote" OR remote) (Europe OR EMEA)' },
    { name: 'Voice AI — FDE', query: '("Voice AI" OR "Conversational AI") ("Solutions Architect" OR "Forward Deployed") remote' },
    { name: 'Webflow', query: '(site:webflow.com/jobs) ("Webflow Expert") freelance' },
  ],
  job_boards: [
    { name: 'France Travail', provider: 'francetravail', francetravail: { keywords: ['Product Designer', 'UX Designer'], max_pages: 1 } },
    { name: 'Jobicy', provider: 'jobicy', jobicy: { industry: 'design-multimedia' } },
    { name: 'a16z', provider: 'a16z-speedrun-talent', q: 'Product Designer' },
    { name: 'JobStreet', provider: 'jobstreet', searchKeywords: 'Product Designer UX Designer Solutions Architect' },
  ],
  tracked_companies: [
    { name: 'Retool', scan_query: 'site:retool.com/careers "Deployed" OR "AI" OR "Solutions"' },
    { name: 'Ada', scan_query: '"ada.cx" OR "ada" "Solutions" OR "Engineer" site:jobs.ashbyhq.com' },
    { name: 'Michael Page', careers_url: 'https://www.michaelpage.fr/jobs?search=product%20designer&sort=date' },
    { name: 'Acme', careers_url: 'https://jobs.ashbyhq.com/acme' },
  ],
};

const OWNER = targetingFromProfile({
  target_roles: {
    primary: ['Senior Product Designer', 'Lead Product Designer', 'AI Product Designer', 'Founding Product Designer', 'AI Product Builder'],
    archetypes: [
      { name: 'Product Designer', level: 'Senior/Lead', fit: 'primary' },
      { name: 'UX/UI Designer', level: 'Senior', fit: 'primary' },
      { name: 'AI Product Builder', level: 'Senior', fit: 'primary' },
      { name: 'Product Manager', level: 'Product scope dependent', fit: 'secondary' },
    ],
    search_terms: ['Design Lead'],
  },
});

const BACKEND = {
  primaryRoles: ['Senior Backend Engineer'],
  archetypes: [
    { name: 'Backend Engineer', level: 'Senior', fit: 'primary' },
    { name: 'Engineering Manager', level: '', fit: 'secondary' },
  ],
  rejectInternships: true,
};

test('scanTermsFrom: roles then search_terms, no level words, slash forms split, contained phrases dropped', () => {
  assert.deepEqual(scanTermsFrom(OWNER), ['Product Designer', 'AI Product Builder', 'UX/UI Designer', 'UX Designer', 'UI Designer', 'Design Lead', 'Product Manager']);
  assert.equal(scanTermsFrom(OWNER, { secondary: false }).includes('Product Manager'), false);
  assert.deepEqual(scanTermsFrom({ primaryRoles: ['Lead Designer', 'Senior Engineer'] }), ['Lead Designer', 'Senior Engineer']);
  assert.deepEqual(scanTermsFrom(null), []);
});

test('templatePortals: role words become placeholders, platforms stay', () => {
  const out = templatePortals(LEGACY);
  assert.equal(out.search_queries[0].query, 'site:jobs.ashbyhq.com {roles} ("full remote" OR remote) (Europe OR EMEA)');
  assert.equal(out.search_queries[1].query, '("Voice AI" OR "Conversational AI") {roles} remote');
  assert.equal(out.search_queries[2].query, LEGACY.search_queries[2].query);
  assert.deepEqual(out.job_board_keywords, ['{roles}']);
  assert.deepEqual(out.job_boards[0].francetravail, { keywords: ['{roles}'], max_pages: 1 });
  assert.deepEqual(out.job_boards[1], LEGACY.job_boards[1]);
  assert.equal(out.job_boards[2].q, '{role}');
  assert.equal(out.job_boards[3].searchKeywords, '{role}');
  assert.equal(out.tracked_companies[0].scan_query, 'site:retool.com/careers {roles}');
  assert.equal(out.tracked_companies[1].scan_query, '"ada.cx" OR "ada" {roles} site:jobs.ashbyhq.com');
  assert.equal(out.tracked_companies[2].careers_url, 'https://www.michaelpage.fr/jobs?search={role}&sort=date');
  assert.equal(out.tracked_companies[3].careers_url, LEGACY.tracked_companies[3].careers_url);
  assert.equal(out.title_filter.positive, undefined);
  assert.equal(out.title_filter.positive_patterns, undefined);
  assert.deepEqual(out.title_filter.negative, LEGACY.title_filter.negative);
  // Idempotent: a templated file has nothing left to convert.
  assert.deepEqual(templatePortals(out), out);
});

test('portalsForProfile: no roles turns off every source that needs search words', () => {
  for (const file of [LEGACY, templatePortals(LEGACY)]) {
    const out = portalsForProfile(file, { targeting: targetingFromProfile({}) });
    const live = JSON.stringify(out, (key, value) => (value && value.enabled === false ? undefined : value));
    assert.doesNotMatch(live, /\{roles?\}/);
    assert.equal(out.search_queries[2].enabled, undefined);
    assert.deepEqual(out.job_boards[1], LEGACY.job_boards[1]);
    assert.equal(out.tracked_companies[3].enabled, undefined);
    assert.deepEqual(out.job_board_keywords, []);
  }
});

test('portalsForProfile: a backend profile searches backend roles on the same platforms', () => {
  const geoPolicy = geoPolicyFrom({ bases: [{ city: 'Toronto', country: 'Canada' }], authorizedCountries: new Set(['Canada']) });
  // A legacy file and its templated form give the same result.
  for (const file of [LEGACY, templatePortals(LEGACY)]) {
    const out = portalsForProfile(file, { targeting: BACKEND, geoPolicy });
    // The secondary archetype stays out of the short query group.
    const group = '("Backend Engineer")';
    assert.equal(out.search_queries[0].query, `site:jobs.ashbyhq.com ${group} ("full remote" OR remote) (Europe OR EMEA)`);
    assert.equal(out.search_queries[1].query, `("Voice AI" OR "Conversational AI") ${group} remote`);
    assert.deepEqual(out.job_board_keywords, ['Backend Engineer', 'Engineering Manager']);
    assert.deepEqual(out.job_boards[0].francetravail, { keywords: ['Backend Engineer', 'Engineering Manager'], max_pages: 1 });
    assert.equal(out.job_boards[2].q, 'Backend Engineer');
    assert.equal(out.tracked_companies[0].scan_query, `site:retool.com/careers ${group}`);
    assert.equal(out.tracked_companies[2].careers_url, 'https://www.michaelpage.fr/jobs?search=Backend%20Engineer&sort=date');

    const tf = out.title_filter;
    assert.equal(explainTitle('Senior Backend Engineer', tf).ok, true);
    assert.equal(explainTitle('Backend Engineering Lead', tf).ok, true);
    assert.equal(explainTitle('Engineering Manager, Platform', tf).ok, true);
    assert.equal(explainTitle('Senior Product Designer', tf).ok, false);
    assert.equal(explainTitle('Junior Backend Engineer', tf).ok, false);
    assert.equal(explainTitle('Senior Backend Engineer (Toronto)', tf).ok, true);
    assert.equal(explainTitle('Backend Engineer - customer support tooling', tf).ok, false);
    assert.deepEqual(tf.seniority_boost, ['Senior', 'Lead']);
  }
  assert.deepEqual(LEGACY.job_boards[0].francetravail.keywords, ['Product Designer', 'UX Designer']);
});

test('portalsForProfile: the owner keeps his design searches and title gate', () => {
  const out = portalsForProfile(templatePortals(LEGACY), { targeting: OWNER });
  assert.equal(out.search_queries[0].query.split(') (')[0], 'site:jobs.ashbyhq.com ("Product Designer" OR "AI Product Builder" OR "UX/UI Designer" OR "UX Designer"');
  for (const title of ['Senior Product Designer', 'Lead UX/UI Designer', 'Design Lead', 'Senior AI Product Builder']) {
    assert.equal(explainTitle(title, out.title_filter).ok, true, title);
  }
});

test('portalsForProfile: negatives that name the profile\'s role or level are dropped', () => {
  const out = portalsForProfile(LEGACY, {
    targeting: { primaryRoles: ['Junior Data Scientist'], archetypes: [], rejectInternships: false },
  });
  assert.equal(explainTitle('Junior Data Scientist', out.title_filter).ok, true);
  assert.equal(explainTitle('Data Scientist Intern', out.title_filter).ok, true);
  assert.equal(explainTitle('Data Scientist (United States)', out.title_filter).ok, false);
});
