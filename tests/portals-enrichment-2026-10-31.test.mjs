// "Find companies" (2026-10-31): Comeet boards, gh_jid employer sites, the filtered
// scan-file input, and the on-demand pass (lib/portals-enrichment.mjs). Offline:
// scratch directories and a simulated network only; the real portals.yml and data/ are never read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load as yamlLoad } from 'js-yaml';
import {
  extractBoards, indexTrackedCompanies, findTracked, verifyBoard, boardEndpoints,
  embeddedGreenhouseJobs, resolveEmbeddedGreenhouse, collectHistoryUrls, runAtsExplorer, displayName,
} from '../lib/ats-explorer.mjs';
import { extractComeetBoards, extractComeetApiUids, providerBoardEndpoints } from '../lib/ats-provider-board.mjs';
import { buildHostClassifier } from '../lib/unknown-hosts.mjs';
import { runPortalsEnrichment, rejectionCounts, MANUAL_EXPLORER_BUDGET } from '../lib/portals-enrichment.mjs';

const PORTALS = `# top comment
tracked_companies:
  # keep this comment
  - name: Linear
    careers_url: https://jobs.ashbyhq.com/linear
    api: https://api.ashbyhq.com/posting-api/job-board/linear
    enabled: true
eu_job_boards:
  - name: Board
    query: x
`;

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'portals-enrichment-'));
  const portalsPath = join(dir, 'portals.yml');
  writeFileSync(portalsPath, PORTALS);
  const dataDir = join(dir, 'data');
  mkdirSync(dataDir);
  return { dir, portalsPath, dataDir };
}

const json = (body, status = 200) => ({ status, text: async () => JSON.stringify(body) });
const TOKEN = '6BF287AD7E1AFCD7E2F39D7E287A21BB1AFC';
const comeetPage = (uid) => ({ status: 200, text: async () => `<script>var c = {"company_name": "4M Analytics Ltd", "company_uid": "${uid}", "token": "${TOKEN}", "slug": "4Manalytics"}</script>` });
const POSITIONS = [
  { name: 'Senior Algorithm Engineer', location: { name: 'Austin, TX', is_remote: true } },
  { name: 'Forward Deployed Product Lead', location: { name: 'Atlanta, GA' } },
];
const ghRedirect = (slug) => ({ status: 301, headers: { get: (h) => (h.toLowerCase() === 'location' ? `https://job-boards.greenhouse.io/embed/job_app?for=${slug}&token=1` : null) } });

function network({ comeetUid = 'B6.00F', ghSlug = 'ghco', extra = {} } = {}) {
  const calls = { ghEmbed: 0 };
  const fetchImpl = async (url) => {
    for (const [prefix, answer] of Object.entries(extra)) if (url.startsWith(prefix)) return typeof answer === 'function' ? answer() : answer;
    if (url.startsWith('https://boards.greenhouse.io/embed/job_app')) { calls.ghEmbed++; return ghSlug ? ghRedirect(ghSlug) : { status: 404, headers: { get: () => null } }; }
    if (url === `https://boards-api.greenhouse.io/v1/boards/${ghSlug}`) return json({ name: 'GH Co' });
    if (url.startsWith(`https://boards-api.greenhouse.io/v1/boards/${ghSlug}/jobs`)) return json({ jobs: [{ title: 'Software Engineer', location: { name: 'Remote' } }, { title: 'Data Engineer', location: { name: 'Remote' } }] });
    if (url.startsWith('https://www.comeet.com/jobs/')) return comeetPage(comeetUid);
    if (url.startsWith('https://www.comeet.co/careers-api/2.0/company/')) return json(POSITIONS);
    return { status: 404, text: async () => '' };
  };
  return { fetchImpl, calls };
}

test('Comeet boards: slug keeps its case, endpoints and API uids', () => {
  const url = 'https://www.comeet.com/jobs/4Manalytics/B6.00F/senior-forward-deployed-product-builder/D5.F64';
  assert.deepEqual(extractComeetBoards(url), [{ ats: 'comeet', slug: '4Manalytics:B6.00F' }]);
  assert.deepEqual(extractBoards(url).filter((b) => b.ats === 'comeet'), [{ ats: 'comeet', slug: '4Manalytics:B6.00F' }]);
  assert.deepEqual(extractComeetBoards('https://www.comeet.com/jobs/acme'), [], 'a company page without a uid is not a board');
  assert.deepEqual(providerBoardEndpoints('comeet', '4Manalytics:B6.00F'), { careers_url: 'https://www.comeet.com/jobs/4Manalytics/B6.00F', provider: 'comeet' });
  assert.equal(providerBoardEndpoints('comeet', 'B6.00F'), null, 'a uid alone cannot build the page');
  assert.equal(providerBoardEndpoints('comeet', 'a/b:uid'), null);
  assert.deepEqual(extractComeetApiUids('https://www.comeet.co/careers-api/2.0/company/B6.00F/positions?token=abc'), ['B6.00F']);
});

test('verifyBoard reads a Comeet board through the token on its own page', async () => {
  const { fetchImpl } = network();
  const v = await verifyBoard({ ats: 'comeet', slug: '4Manalytics:B6.00F' }, { fetchImpl });
  assert.equal(v.status, 200);
  assert.equal(v.name, '4M Analytics Ltd');
  assert.deepEqual(v.titles, ['Senior Algorithm Engineer', 'Forward Deployed Product Lead']);
  assert.deepEqual(v.locations, ['Austin, TX, remote', 'Atlanta, GA']);
  assert.equal(v.api, `https://www.comeet.co/careers-api/2.0/company/B6.00F/positions?token=${TOKEN}`);
  assert.equal(boardEndpoints('comeet', '4Manalytics:B6.00F').api, undefined, 'the token only exists once the page was read');

  // a page that names another company (redirect to a different tenant) is not this board
  const other = await verifyBoard({ ats: 'comeet', slug: '4Manalytics:B6.00F' }, { fetchImpl: network({ comeetUid: 'Z9.999' }).fetchImpl });
  assert.equal(other.status, 0);
  // no token on the page: nothing to ask the API with
  const noToken = await verifyBoard({ ats: 'comeet', slug: '4Manalytics:B6.00F' }, { fetchImpl: async () => ({ status: 200, text: async () => '<html></html>' }) });
  assert.equal(noToken.status, 0);
  const gone = await verifyBoard({ ats: 'comeet', slug: '4Manalytics:B6.00F' }, { fetchImpl: async () => ({ status: 404, text: async () => '' }) });
  assert.equal(gone.status, 404);
});

test('a tracked Comeet entry is found by its API uid or its page, not by an unrelated uid', () => {
  const index = indexTrackedCompanies([
    { name: 'Acme', careers_url: 'https://www.acme.com/careers', api: 'https://www.comeet.co/careers-api/2.0/company/B6.00F/positions?token=abc' },
    { name: 'Beta', careers_url: 'https://www.comeet.com/jobs/beta/C1.23A' },
  ]);
  assert.equal(findTracked(index, { ats: 'comeet', slug: '4Manalytics:B6.00F', name: 'Unrelated' })?.name, 'Acme');
  assert.equal(findTracked(index, { ats: 'comeet', slug: 'beta:C1.23A', name: 'Unrelated' })?.name, 'Beta');
  assert.equal(findTracked(index, { ats: 'comeet', slug: 'Other:Z9.999', name: 'Unrelated' }), null);
  assert.equal(findTracked(index, { slug: '4Manalytics:B6.00F', name: 'Unrelated' }), null, 'the uid lookup is Comeet-only');
});

test('gh_jid links: one job id per employer host, Greenhouse itself skipped', () => {
  const hosts = embeddedGreenhouseJobs([
    'https://sumup.com/careers/positions/8634286002?gh_jid=8634286002',
    'https://sumup.com/careers/positions/9999999999?gh_jid=9999999999',
    'https://boards.greenhouse.io/x/jobs/1?gh_jid=1234567',
    'https://example.com/job?gh_jid=12',
    'https://example.com/job',
    'not a url?gh_jid=1234567',
  ]);
  assert.deepEqual([...hosts], [['sumup.com', '8634286002']]);
});

test('resolveEmbeddedGreenhouse follows the redirect, remembers hits and misses, and caps lookups', async () => {
  const urls = ['https://a.example/j?gh_jid=1111111', 'https://b.example/j?gh_jid=2222222', 'https://c.example/j?gh_jid=3333333'];
  const asked = [];
  const fetchImpl = async (url, opts) => {
    asked.push(url);
    assert.equal(opts.redirect, 'manual', 'the redirect is read, never followed');
    return url.endsWith('1111111') ? ghRedirect('company-a') : { status: 404, headers: { get: () => null } };
  };
  const now = Date.parse('2026-10-31T10:00:00Z');
  const first = await resolveEmbeddedGreenhouse(urls, { fetchImpl, now, max: 2 });
  assert.deepEqual(first.boards, [{ ats: 'greenhouse', slug: 'company-a', via: 'gh_jid on a.example' }]);
  assert.equal(asked.length, 2, 'max caps the lookups');
  assert.equal(first.memo['a.example'].slug, 'company-a');
  assert.equal(first.memo['b.example'].slug, null);
  assert.equal(first.memo['c.example'], undefined, 'a host left over is retried next time');

  asked.length = 0;
  const later = await resolveEmbeddedGreenhouse(urls, { fetchImpl, known: first.memo, now: now + 10 * 86400000, max: 5 });
  assert.deepEqual(asked.map((u) => u.slice(-7)), ['3333333'], 'hit and recent miss come from the memo, only the new host is asked');
  assert.deepEqual(later.boards.map((b) => b.slug), ['company-a']);

  asked.length = 0;
  await resolveEmbeddedGreenhouse(urls, { fetchImpl, known: first.memo, now: now + 40 * 86400000, max: 5 });
  assert.ok(asked.some((u) => u.endsWith('2222222')), 'a miss is retried after 30 days');
});

test('collectHistoryUrls keeps the URLs around ATS hosts and gh_jid links, and nothing else', async () => {
  const { dataDir } = fixture();
  writeFileSync(join(dataDir, 'scan-history.tsv'), '2026-10-30\thttps://jobs.lever.co/acme/123\tEngineer\n');
  writeFileSync(join(dataDir, 'pipeline.jsonl'), `${JSON.stringify({ url: 'https://example.com/careers/1?gh_jid=1234567&utm=x', note: 'see https://acme.recruitee.com/o/designer, thanks' })}\n`);
  writeFileSync(join(dataDir, 'discovered-companies.jsonl'), '{"via":"https://jobs.ashbyhq.com/zzz/1"}\n');
  writeFileSync(join(dataDir, 'notes.txt'), 'https://jobs.ashbyhq.com/ignored/1');
  writeFileSync(join(dataDir, 'noise.md'), `${'x'.repeat(50000)} no url here`);
  const urls = await collectHistoryUrls(dataDir);
  assert.deepEqual(extractBoards(urls).map((b) => `${b.ats}:${b.slug}`).sort(), ['lever:acme', 'recruitee:acme']);
  assert.ok(urls.some((u) => u === 'https://example.com/careers/1?gh_jid=1234567&utm=x'));
  assert.ok(!urls.some((u) => /zzz|ignored/.test(u)), "the explorer's own journal and non-data files are skipped");
  assert.deepEqual(await collectHistoryUrls(join(dataDir, 'missing')), []);
});

test('platform candidates: an employer site embedding Greenhouse, and Comeet, are not unknown platforms', () => {
  const classify = buildHostClassifier({ providers: new Map(), portalsConfig: {} });
  assert.equal(classify('sumup.com', ['https://sumup.com/careers/positions/8634286002?gh_jid=8634286002']).kind, 'ats');
  assert.equal(classify('www.comeet.com', ['https://www.comeet.com/jobs/acme/B6.00F/x/D5.F64']).kind, 'ats');
  assert.equal(classify('newjobs.example', ['https://newjobs.example/jobs/1']).kind, 'unknown');
});

test('runAtsExplorer adds a Comeet board and an employer-site Greenhouse board, and remembers the lookup', async () => {
  const { portalsPath, dataDir } = fixture();
  const { fetchImpl, calls } = network();
  const offerUrls = ['https://www.comeet.com/jobs/4Manalytics/B6.00F/senior-engineer/D5.F64', 'https://acme.example/careers/1?gh_jid=1234567'];
  const s = await runAtsExplorer({ portalsPath, dataDir, offerUrls, fetchImpl, log: () => {}, env: {}, now: new Date('2026-10-31T09:00:00Z') });
  assert.deepEqual(s.addedNames.sort(), ['4M Analytics Ltd', 'GH Co']);
  const y = yamlLoad(readFileSync(portalsPath, 'utf8'));
  const comeet = y.tracked_companies.find((e) => e.name === '4M Analytics Ltd');
  assert.equal(comeet.careers_url, 'https://www.comeet.com/jobs/4Manalytics/B6.00F');
  assert.equal(comeet.provider, 'comeet');
  assert.equal(comeet.api, `https://www.comeet.co/careers-api/2.0/company/B6.00F/positions?token=${TOKEN}`);
  const gh = y.tracked_companies.find((e) => e.name === 'GH Co');
  assert.equal(gh.careers_url, 'https://job-boards.greenhouse.io/ghco');
  assert.match(gh.notes, /via gh_jid on acme\.example/);
  const state = JSON.parse(readFileSync(join(dataDir, 'ats-explorer-state.json'), 'utf8'));
  assert.equal(state.ghHosts['acme.example'].slug, 'ghco');

  const again = await runAtsExplorer({ portalsPath, dataDir, offerUrls, fetchImpl, log: () => {}, env: {}, now: new Date('2026-11-01T09:00:00Z') });
  assert.equal(again.added, 0, 'both are tracked now, the Comeet one by its uid');
  assert.equal(calls.ghEmbed, 1, 'the employer site is not asked twice');
});

test('displayName: a Workday or Comeet board without a name is called after its company, not its slug', () => {
  assert.equal(displayName(null, 'clio:wd3:ClioCareerSite'), 'Clio');
  assert.equal(displayName(null, 'campaignmonitor:wd5:marigold'), 'Campaignmonitor');
  assert.equal(displayName('', 'cloudera:wd5:External_Career'), 'Cloudera');
  assert.equal(displayName(null, '4Manalytics:B6.00F'), '4Manalytics');
  assert.equal(displayName('Careers at Postman', 'postman:wd108:Careers'), 'Postman', 'a name the board gives still wins');
  assert.equal(displayName(null, 'wisdom%20ai'), 'Wisdom Ai', 'plain slugs read as before');
  assert.equal(displayName(null, 'li.fi'), 'Li Fi');
});

test('board names are read without HTML entities (J&amp;B Hopkins)', async () => {
  assert.equal(displayName('J&amp;B Hopkins', 'jb-hopkins'), 'J&B Hopkins');
  assert.equal(displayName('Caf&#233; &#x27;Noir&#x27; &amp;lt;', 'cafe'), "Café 'Noir' &lt;", 'decimal and hex entities, decoded once');
  assert.equal(displayName('Fish &unknown; Chips', 'fish'), 'Fish &unknown; Chips', 'an unknown entity is left as it is');

  const rss = `<rss><channel><title><![CDATA[J&amp;B Hopkins]]></title><item><title>Software Engineer</title></item><item><title>Data Engineer</title></item></channel></rss>`;
  const teamtailor = await verifyBoard({ ats: 'teamtailor', slug: 'jbhopkins' }, { fetchImpl: async () => ({ status: 200, text: async () => rss }) });
  assert.equal(teamtailor.name, 'J&B Hopkins');
  const xml = `<jobs><subcompany>Smith &amp; Sons</subcompany><position><name>Product Designer</name></position></jobs>`;
  const personio = await verifyBoard({ ats: 'personio', slug: 'smithsons' }, { fetchImpl: async () => ({ status: 200, text: async () => xml }) });
  assert.equal(personio.name, 'Smith & Sons');
});

test('rejectionCounts tallies the skipped boards by reason', () => {
  assert.deepEqual(rejectionCounts([
    { decision: 'skipped', reason: 'no_matching_role' }, { decision: 'skipped', reason: 'no_matching_role' },
    { decision: 'skipped', reason: 'empty_board' }, { decision: 'added', reason: 'ok' }, null,
  ]), { no_matching_role: 2, empty_board: 1 });
});

test('runPortalsEnrichment: scan files in, one summary out, explicit settings still win', async () => {
  const { portalsPath, dataDir } = fixture();
  // verified in file order; the run stops checking once max_add boards are accepted
  writeFileSync(join(dataDir, 'scan-history.tsv'), 'https://jobs.lever.co/emptyco/x\nhttps://jobs.ashbyhq.com/newai/1\nhttps://jobs.ashbyhq.com/second/9\n');
  const board = (n) => json({ jobs: [...Array(n)].map((_, i) => ({ title: `Software Engineer ${i}`, location: 'Remote' })) });
  const { fetchImpl } = network({ extra: {
    'https://api.ashbyhq.com/posting-api/job-board/newai': board(3),
    'https://api.ashbyhq.com/posting-api/job-board/second': board(2),
    'https://api.lever.co/v0/postings/emptyco': json([]),
    'https://jobs.ashbyhq.com/newai': { status: 200, text: async () => '<title>NewAI Jobs</title>' },
    'https://jobs.ashbyhq.com/second': { status: 200, text: async () => '<title>Second Jobs</title>' },
  } });
  const phases = [];
  const r = await runPortalsEnrichment({
    portalsPath, dataDir, fetchImpl, env: {}, log: () => {}, onPhase: (p) => phases.push(p),
    accessOf: (c) => ({ mode: c.api || c.provider ? 'api' : 'playwright' }),
    config: { ats_explorer: { max_add: 1 } },
  });
  assert.deepEqual(phases, ['history', 'explore', 'resolve']);
  assert.equal(r.searched, false);
  assert.equal(r.found, 3);
  assert.equal(r.checked, 2, 'the empty board, then the first board that qualifies; max_add stops the rest');
  assert.equal(r.added, 1, 'ats_explorer.max_add from portals.yml beats the manual budget');
  assert.deepEqual(r.addedNames, ['NewAI']);
  assert.equal(MANUAL_EXPLORER_BUDGET.max_add, 25);
  assert.deepEqual(r.rejected, { empty_board: 1 });
  assert.equal(r.resolverError, null);
  assert.equal(r.resolved, 0);
  assert.equal(r.backups.length, 1);
  const names = yamlLoad(readFileSync(portalsPath, 'utf8')).tracked_companies.map((e) => e.name);
  assert.equal(names.length, 2);
  assert.ok(names.includes('Linear'));
});
