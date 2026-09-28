import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  activeSponsors,
  adsTxt,
  adsenseHeadHtml,
  adsenseSlotHtml,
  clientIpFromRequest,
  extractGapText,
  fetchSponsoredJobs,
  isPublicIp,
  loadMonetizationConfig,
  matchAffiliateOffers,
  monetizationEventKeys,
  normalizeMonetizationConfig,
  publicMonetizationConfig,
  recordMonetizationEvent,
  resetMonetizationCaches,
  resolveViewerIp,
  sponsoredQuery,
  withUtm,
} from './monetization.mjs';

const ROOT = join(import.meta.dirname, '..');

test('the shipped config keeps every channel off', async () => {
  const { config, warnings } = await loadMonetizationConfig(ROOT);
  assert.deepEqual(warnings, []);
  assert.equal(config.sponsoredJobs.enabled, false);
  assert.equal(config.affiliates.enabled, false);
  assert.equal(config.sponsors.enabled, false);
  assert.equal(config.adsense.enabled, false);
  // Placeholder offers without a link are dropped, not shown.
  assert.equal(config.affiliates.offers.length, 0);
  const pub = publicMonetizationConfig(config, { env: { CAREERJET_API_KEY: 'k', JOOBLE_API_KEY: 'k' } });
  assert.equal(pub.sponsoredJobs.enabled, false);
  assert.equal(pub.affiliates.enabled, false);
  assert.deepEqual(pub.sponsors.items, []);
});

test('a missing config file means everything off', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mz-'));
  try {
    const { config } = await loadMonetizationConfig(dir);
    assert.equal(config.adsense.enabled, false);
    assert.deepEqual(config.sponsoredJobs.providers, ['careerjet', 'jooble']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('an explicit config path wins over config/monetization.yml', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mz-path-'));
  try {
    const file = join(dir, 'staging.yml');
    await writeFile(file, 'sponsors:\n  enabled: true\n  items:\n    - { id: acme, title: ACME, url: "https://acme.example" }\n');
    const { config } = await loadMonetizationConfig(ROOT, { path: file });
    assert.equal(config.sponsors.enabled, true);
    assert.deepEqual(config.sponsors.items.map(i => i.id), ['acme']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('invalid entries are dropped with a warning, never shipped', () => {
  const { config, warnings } = normalizeMonetizationConfig({
    sponsored_jobs: { enabled: true, providers: ['careerjet', 'indeed'] },
    affiliates: {
      enabled: true,
      offers: [
        { id: 'ok', label: 'Courses', url: 'https://aff.example/c?ref=me', keywords: ['Figma'] },
        { id: 'js', label: 'Bad', url: 'javascript:alert(1)', keywords: ['x'] },
        { id: 'nokw', label: 'No keywords', url: 'https://aff.example/n' },
      ],
    },
    sponsors: {
      enabled: true,
      items: [{ id: 'acme', title: 'ACME', url: 'https://acme.example', logo: 'https://cdn.example/logo.png' }],
    },
    adsense: { enabled: true, client: 'pub-123', landing_slot: 'abc' },
  });
  assert.deepEqual(config.sponsoredJobs.providers, ['careerjet']);
  assert.deepEqual(config.affiliates.offers.map(o => o.id), ['ok']);
  assert.deepEqual(config.affiliates.offers[0].keywords, ['figma']);
  assert.equal(config.sponsors.items[0].logo, '');
  assert.equal(config.adsense.enabled, false);
  assert.ok(warnings.some(w => w.includes('indeed')));
  assert.ok(warnings.some(w => w.includes('nokw')));
  assert.ok(warnings.some(w => w.includes('logo')));
  assert.ok(warnings.some(w => w.includes('ca-pub')));
});

test('sponsored jobs need both the switch and a provider key', () => {
  const { config } = normalizeMonetizationConfig({ sponsored_jobs: { enabled: true, providers: ['jooble'] } });
  assert.equal(publicMonetizationConfig(config, { env: {} }).sponsoredJobs.enabled, false);
  assert.equal(publicMonetizationConfig(config, { env: { JOOBLE_API_KEY: 'k' } }).sponsoredJobs.enabled, true);
  // A Careerjet key does not switch on a config that only lists Jooble.
  assert.equal(publicMonetizationConfig(config, { env: { CAREERJET_API_KEY: 'k' } }).sponsoredJobs.enabled, false);
});

test('sponsor cards respect their dates and get UTM tags', () => {
  const { config } = normalizeMonetizationConfig({
    sponsors: {
      enabled: true,
      items: [
        { id: 'now', title: 'Now', url: 'https://a.example/p?x=1', start: '2026-09-01', end: '2026-09-30' },
        { id: 'later', title: 'Later', url: 'https://b.example', start: '2026-10-01' },
        { id: 'past', title: 'Past', url: 'https://c.example', end: '2026-09-01' },
      ],
    },
  });
  const now = new Date('2026-09-28T10:00:00Z');
  assert.deepEqual(activeSponsors(config.sponsors.items, now).map(i => i.id), ['now']);
  const [card] = publicMonetizationConfig(config, { now }).sponsors.items;
  const url = new URL(card.url);
  assert.equal(url.searchParams.get('x'), '1');
  assert.equal(url.searchParams.get('utm_source'), 'jobyougo');
  assert.equal(url.searchParams.get('utm_medium'), 'sponsor');
  assert.equal(url.searchParams.get('utm_campaign'), 'now');
  // Existing UTM values chosen by the sponsor are kept.
  assert.equal(new URL(withUtm('https://d.example/?utm_source=partner', { medium: 'sponsor' })).searchParams.get('utm_source'), 'partner');
});

// Gap lines copied from a real report (reports/259-cello-2026-09-28.md).
const REPORT = `# Evaluation: Cello — Senior Product Designer
## B) Match CV
- **Compétences techniques (Figma, prototypage)** : Figma est explicitement cité dans les outils du CV.
- **Pensée systémique / design de composants** : Le CV ne mentionne pas directement le design de systèmes ou de composants réutilisables.
- **Travail en équipe / culture async** : Le candidat est décrit comme « digital nomad » avec une gestion de timezone.
- **Anglais** : niveau non précisé.`;

test('gap text keeps only the lines that flag a gap', () => {
  const gaps = extractGapText(REPORT);
  assert.match(gaps, /design de systemes/);
  assert.doesNotMatch(gaps, /figma est explicitement/);
});

test('affiliate offers match gap lines, or the whole report when asked', () => {
  const offers = normalizeMonetizationConfig({
    affiliates: {
      offers: [
        { id: 'figma', label: 'Figma course', url: 'https://aff.example/f', keywords: ['figma'] },
        { id: 'systems', label: 'Design systems', url: 'https://aff.example/s', keywords: ['design de systemes', 'prototyp*'] },
        { id: 'nomad', label: 'Insurance', url: 'https://aff.example/n', match_on: 'report', keywords: ['digital nomad'] },
        { id: 'english', label: 'English', url: 'https://aff.example/e', keywords: ['anglais'] },
      ],
    },
  }).config.affiliates.offers;
  const matches = matchAffiliateOffers(offers, REPORT, { max: 5 });
  // Figma is a strength here (no gap marker on its line), so it is not pushed;
  // "Anglais : niveau non précisé" has no gap marker either.
  assert.deepEqual(matches.map(m => m.id), ['systems', 'nomad']);
  assert.deepEqual(matches[0].matched, ['design de systemes']);
  assert.equal(matchAffiliateOffers(offers, REPORT, { max: 1 }).length, 1);
  assert.deepEqual(matchAffiliateOffers(offers, ''), []);
});

test('prefix keywords match word starts only', () => {
  const [offer] = normalizeMonetizationConfig({
    affiliates: { offers: [{ id: 'p', label: 'P', url: 'https://aff.example', keywords: ['prototyp*'] }] },
  }).config.affiliates.offers;
  assert.equal(matchAffiliateOffers([offer], 'Gap: no prototyping shown').length, 1);
  assert.equal(matchAffiliateOffers([offer], 'Gap: antiprototype').length, 0);
});

test('public IP detection rejects loopback, private and link-local ranges', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.10', '169.254.3.4', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '', 'nope']) {
    assert.equal(isPublicIp(ip), false, ip);
  }
  for (const ip of ['8.8.8.8', '172.32.0.1', '2a01:cb00::1', '::ffff:1.2.3.4']) {
    assert.equal(isPublicIp(ip), true, ip);
  }
  assert.equal(clientIpFromRequest({ headers: { 'x-forwarded-for': '10.0.0.1, 9.9.9.9' }, socket: { remoteAddress: '127.0.0.1' } }), '9.9.9.9');
  assert.equal(clientIpFromRequest({ headers: {}, socket: { remoteAddress: '127.0.0.1' } }), '127.0.0.1');
});

test('local requests look the public IP up once and cache it', async () => {
  resetMonetizationCaches();
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return new Response('{"ip":"81.2.69.160"}'); };
  const req = { headers: {}, socket: { remoteAddress: '127.0.0.1' } };
  assert.equal(await resolveViewerIp(req, { lookupUrl: 'https://ip.example', fetchImpl, now: 1000 }), '81.2.69.160');
  assert.equal(await resolveViewerIp(req, { lookupUrl: 'https://ip.example', fetchImpl, now: 2000 }), '81.2.69.160');
  assert.equal(calls, 1);
  assert.equal(await resolveViewerIp(req, { lookupUrl: '', fetchImpl, now: 3000 }), '');
  // A hosted request already carries a public IP: no lookup at all.
  assert.equal(await resolveViewerIp({ headers: { 'x-forwarded-for': '9.9.9.9' } }, { lookupUrl: 'https://ip.example', fetchImpl }), '9.9.9.9');
  assert.equal(calls, 1);
});

test('the sponsored query comes from the config, else the first target role', () => {
  const sj = normalizeMonetizationConfig({ sponsored_jobs: {} }).config.sponsoredJobs;
  const q = sponsoredQuery(sj, { target_roles: { primary: ['Senior Product Designer', 'Lead Product Designer'] } });
  assert.equal(q.keyword, 'Senior Product Designer');
  assert.equal(q.careerjet.keywords, 'Senior Product Designer remote');
  assert.equal(q.jooble.location, 'Remote');
  assert.equal(sponsoredQuery(sj, { target_roles: ['UX Lead'] }).keyword, 'UX Lead');
  const pinned = normalizeMonetizationConfig({ sponsored_jobs: { keywords: ['AI designer'], location: 'Paris', remote_only: false } }).config.sponsoredJobs;
  assert.deepEqual(sponsoredQuery(pinned, {}).careerjet, { keywords: 'AI designer', location: 'Paris' });
});

function fakeProviders(calls) {
  return async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    if (String(url).startsWith('https://search.api.careerjet.net/v4/query')) {
      return Response.json({
        type: 'JOBS',
        jobs: [
          { title: 'Senior Product Designer', company: 'Acme', locations: 'Remote', url: 'https://jobviewtrack.com/cj1', date: '2026-09-27' },
          { title: 'Lead Designer', company: 'Beta', locations: 'Berlin', url: 'https://jobviewtrack.com/cj2' },
        ],
      });
    }
    if (String(url).startsWith('https://jooble.org/api/')) {
      return Response.json({
        jobs: [
          { title: 'Senior Product Designer', company: 'Acme', location: 'Remote', link: 'https://jooble.org/desc/1' },
          { title: 'Product Designer', company: 'Gamma', location: 'Remote', link: 'https://jooble.org/desc/2' },
        ],
      });
    }
    throw new Error(`unexpected ${url}`);
  };
}

test('sponsored jobs call both publisher APIs correctly and interleave the results', async () => {
  resetMonetizationCaches();
  const sj = normalizeMonetizationConfig({ sponsored_jobs: { enabled: true, limit: 3 } }).config.sponsoredJobs;
  const calls = [];
  const { items, errors } = await fetchSponsoredJobs({
    sponsoredJobs: sj,
    profile: { target_roles: { primary: ['Senior Product Designer'] } },
    userIp: '81.2.69.160',
    userAgent: 'Mozilla/5.0 Test',
    env: { CAREERJET_API_KEY: 'cj-key', JOOBLE_API_KEY: 'jb-key' },
    fetchImpl: fakeProviders(calls),
  });
  assert.deepEqual(errors, []);
  // Acme appears on both networks: kept once, from the first provider.
  assert.deepEqual(items.map(i => `${i.provider}:${i.company}`), ['careerjet:Acme', 'careerjet:Beta', 'jooble:Gamma']);

  const cj = calls.find(c => c.url.includes('careerjet'));
  const params = new URL(cj.url).searchParams;
  assert.equal(params.get('user_ip'), '81.2.69.160');
  assert.equal(params.get('user_agent'), 'Mozilla/5.0 Test');
  assert.equal(params.get('keywords'), 'Senior Product Designer remote');
  assert.equal(cj.opts.headers.Authorization, `Basic ${Buffer.from('cj-key:').toString('base64')}`);
  const jb = calls.find(c => c.url.includes('jooble'));
  assert.equal(jb.url, 'https://jooble.org/api/jb-key');
  assert.deepEqual(JSON.parse(jb.opts.body), { keywords: 'Senior Product Designer', location: 'Remote', page: '1', ResultOnPage: 3 });
});

test('sponsored jobs are cached, and Careerjet is skipped without a public IP', async () => {
  resetMonetizationCaches();
  const sj = normalizeMonetizationConfig({ sponsored_jobs: { enabled: true } }).config.sponsoredJobs;
  const calls = [];
  const args = {
    sponsoredJobs: sj,
    profile: { target_roles: { primary: ['Designer'] } },
    userIp: '127.0.0.1',
    env: { CAREERJET_API_KEY: 'k', JOOBLE_API_KEY: 'k' },
    fetchImpl: fakeProviders(calls),
  };
  const first = await fetchSponsoredJobs({ ...args, now: 0 });
  assert.ok(first.errors[0].startsWith('careerjet'));
  assert.ok(first.items.every(i => i.provider === 'jooble'));
  assert.equal(calls.length, 1);
  await fetchSponsoredJobs({ ...args, now: 30 * 60_000 });
  assert.equal(calls.length, 1);
  await fetchSponsoredJobs({ ...args, now: 61 * 60_000 });
  assert.equal(calls.length, 2);
});

test('AdSense markup and ads.txt only exist when a valid publisher ID is set', () => {
  const off = normalizeMonetizationConfig({ adsense: { enabled: false, client: 'ca-pub-1234567890123456' } }).config.adsense;
  assert.equal(adsenseHeadHtml(off), '');
  assert.equal(adsTxt(off), '');
  const auto = normalizeMonetizationConfig({ adsense: { enabled: true, client: 'ca-pub-1234567890123456' } }).config.adsense;
  assert.match(adsenseHeadHtml(auto), /adsbygoogle\.js\?client=ca-pub-1234567890123456/);
  assert.equal(adsenseSlotHtml(auto), '');
  assert.equal(adsTxt(auto), 'google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n');
  const unit = normalizeMonetizationConfig({ adsense: { enabled: true, client: 'ca-pub-1234567890123456', landing_slot: '9876543210' } }).config.adsense;
  assert.match(adsenseSlotHtml(unit), /data-ad-slot="9876543210"/);
  assert.match(adsenseSlotHtml(unit), /Advertisement/);
});

test('events aggregate per day and channel, and bad events are refused', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mz-stats-'));
  const file = join(dir, 'data', 'monetization-stats.json');
  try {
    const now = new Date('2026-09-28T09:00:00Z');
    await Promise.all([
      recordMonetizationEvent(file, { type: 'impression', channel: 'sponsor', id: 'acme' }, { now }),
      recordMonetizationEvent(file, { type: 'impression', channel: 'sponsor', id: 'acme' }, { now }),
      recordMonetizationEvent(file, { type: 'click', channel: 'sponsor', id: 'acme' }, { now }),
      recordMonetizationEvent(file, { type: 'impression', channel: 'sponsored_job', id: 'jooble' }, { now }),
    ]);
    const stats = JSON.parse(await readFile(file, 'utf-8'));
    assert.deepEqual(stats.days['2026-09-28']['sponsor:acme'], { impressions: 2, clicks: 1 });
    assert.deepEqual(stats.days['2026-09-28']['sponsored_job:jooble'], { impressions: 1, clicks: 0 });
    await assert.rejects(recordMonetizationEvent(file, { type: 'view', channel: 'sponsor', id: 'acme' }));
    await assert.rejects(recordMonetizationEvent(file, { type: 'click', channel: 'adsense', id: 'x' }));
    await assert.rejects(recordMonetizationEvent(file, { type: 'click', channel: 'sponsor', id: '../etc' }));

    // With the config's keys, only placements it can display are counted.
    const { config } = normalizeMonetizationConfig({
      sponsors: { items: [{ id: 'acme', title: 'ACME', url: 'https://acme.example' }] },
      sponsored_jobs: { providers: ['jooble'] },
    });
    const allowedKeys = monetizationEventKeys(config);
    assert.deepEqual([...allowedKeys].sort(), ['sponsor:acme', 'sponsored_job:jooble']);
    await recordMonetizationEvent(file, { type: 'click', channel: 'sponsor', id: 'acme' }, { now, allowedKeys });
    await assert.rejects(recordMonetizationEvent(file, { type: 'click', channel: 'sponsor', id: 'made-up' }, { now, allowedKeys }));
    await assert.rejects(recordMonetizationEvent(file, { type: 'click', channel: 'sponsored_job', id: 'careerjet' }, { now, allowedKeys }));
    const after = JSON.parse(await readFile(file, 'utf-8'));
    assert.deepEqual(after.days['2026-09-28']['sponsor:acme'], { impressions: 2, clicks: 2 });
    assert.equal(after.days['2026-09-28']['sponsor:made-up'], undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
