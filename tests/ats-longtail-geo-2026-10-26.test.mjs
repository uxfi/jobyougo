// Long-tail ATS boards (BambooHR, Breezy, Pinpoint, Rippling, JOIN, Workday), the
// location gate of the explorer, and the platform shortlist written after a scan.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  extractAtsSlugs, extractBoards, boardEndpoints, verifyBoard, locationReachable, classifyCandidate, indexTrackedCompanies,
} from '../lib/ats-explorer.mjs';
import { extractWorkdayBoards, providerBoardEndpoints, verifyBoardViaProvider, PROVIDER_BOARD_URLS } from '../lib/ats-provider-board.mjs';
import { recordPlatformCandidates } from '../lib/platform-candidates.mjs';

test('extractAtsSlugs reads BambooHR, Breezy, Pinpoint, Rippling and JOIN boards', () => {
  const got = extractAtsSlugs('https://acme.bamboohr.com/careers https://beta.breezy.hr/p/1 https://gamma.pinpointhq.com/en/postings https://ats.rippling.com/delta-co/jobs https://join.com/companies/epsilon');
  assert.deepEqual(got.map((g) => `${g.ats}|${g.slug}`).sort(), ['bamboohr|acme', 'breezy|beta', 'join|epsilon', 'pinpoint|gamma', 'rippling|delta-co']);
  assert.deepEqual(extractAtsSlugs('https://www.bamboohr.com/ https://documentation.bamboohr.com/'), []);
});

test('Workday boards come from careers-page links, with the site name kept as written', () => {
  const links = 'x https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/1 y https://acme.wd1.myworkdayjobs.com/Careers';
  assert.deepEqual(extractWorkdayBoards(links).map((b) => b.slug).sort(), ['acme:wd1:Careers', 'nvidia:wd5:NVIDIAExternalCareerSite']);
  assert.deepEqual(extractWorkdayBoards('https://acme.wd1.myworkdayjobs.com/wday/cxs/acme'), []);
  assert.ok(extractBoards(links).some((b) => b.ats === 'workday'));
  assert.deepEqual(providerBoardEndpoints('workday', 'nvidia:wd5:NVIDIAExternalCareerSite'), { careers_url: 'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite', provider: 'workday' });
  assert.equal(providerBoardEndpoints('workday', 'bad slug'), null);
  assert.equal(providerBoardEndpoints('bamboohr', 'a/b'), null);
  assert.equal(boardEndpoints('breezy', 'Beta').careers_url, 'https://beta.breezy.hr');
  assert.equal(boardEndpoints('breezy', 'Beta').careers_url, PROVIDER_BOARD_URLS.breezy('Beta'));
});

test('a tracked Workday entry is indexed so the explorer does not add it twice', () => {
  const idx = indexTrackedCompanies([{ name: 'Nvidia', careers_url: 'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite', provider: 'workday' }]);
  assert.ok(idx.bySlug.has('nvidia:wd5:NVIDIAExternalCareerSite'));
});

test('verifyBoardViaProvider asks the vendor provider for the postings', async () => {
  const providers = new Map([['breezy', {
    id: 'breezy',
    detect: (e) => /breezy\.hr/.test(e.careers_url),
    fetch: async () => [{ title: 'Designer', location: 'Paris, France', description: 'Acme builds things' }, { title: '', location: '' }],
  }]]);
  const ok = await verifyBoardViaProvider({ ats: 'breezy', slug: 'acme' }, { providers, ctx: {} });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.titles, ['Designer']);
  assert.deepEqual(ok.locations, ['Paris, France']);
  assert.match(ok.sample, /Acme builds/);
  const none = await verifyBoardViaProvider({ ats: 'pinpoint', slug: 'acme' }, { providers, ctx: {} });
  assert.equal(none.status, 0);
  const broken = new Map([['breezy', { id: 'breezy', detect: () => ({}), fetch: async () => { throw Object.assign(new Error('nope'), { status: 404 }); } }]]);
  assert.equal((await verifyBoardViaProvider({ ats: 'breezy', slug: 'acme' }, { providers: broken, ctx: {} })).status, 404);
  // verifyBoard routes the long tail to the provider layer
  assert.equal((await verifyBoard({ ats: 'breezy', slug: 'acme' }, { providers })).titles[0], 'Designer');
});

test('verifyBoard returns the location of each posting', async () => {
  const jobs = { jobs: [{ title: 'Product Designer', location: { name: 'Remote - US' } }, { title: '', location: { name: 'x' } }, { title: 'Engineer', location: { name: 'Paris' } }] };
  const fetchImpl = async () => ({ status: 200, text: async () => JSON.stringify(jobs) });
  const v = await verifyBoard({ ats: 'greenhouse', slug: 'acme' }, { fetchImpl });
  assert.deepEqual(v.titles, ['Product Designer', 'Engineer']);
  assert.deepEqual(v.locations, ['Remote - US', 'Paris']);
});

test('classifyCandidate: a board closed to the profile geography is rejected, a doubtful one is not', () => {
  const geoPolicy = { allowed: ['europe', 'france', 'worldwide'], rejected: ['united states', 'us only', 'canada'] };
  assert.equal(locationReachable('Remote - United States', geoPolicy), false);
  assert.equal(locationReachable('Paris, France', geoPolicy), true);
  assert.equal(locationReachable('Remote, Europe or United States', geoPolicy), true);
  assert.equal(locationReachable('Lisbon', geoPolicy), true);
  assert.equal(locationReachable('', geoPolicy), true);
  const titles = ['Software Engineer', 'Product Manager', 'Data Engineer'];
  const closed = classifyCandidate({ slug: 'acme', titles, locations: ['Remote - United States', 'New York, United States', 'United States'], geoPolicy });
  assert.equal(closed.reason, 'no_reachable_location');
  assert.equal(classifyCandidate({ slug: 'acme', titles, locations: ['Remote - United States', 'Paris, France', 'United States'], geoPolicy }).ok, true);
  assert.equal(classifyCandidate({ slug: 'acme', titles, locations: ['United States', '', ''], geoPolicy }).ok, true); // one located posting is not enough to say
  assert.equal(classifyCandidate({ slug: 'acme', titles, locations: ['United States', 'United States', 'United States'] }).ok, true); // no policy
  const tf = { positive: ['engineer'] };
  assert.equal(classifyCandidate({ slug: 'acme', titles, titleFilter: tf, locations: ['Canada', 'x', 'Canada'], geoPolicy }).reason, 'no_reachable_location');
});

test('recordPlatformCandidates writes the shortlist and reports what is new', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'plat-'));
  try {
    await mkdir(join(dir, 'data'));
    const now = new Date().toISOString();
    const lines = [];
    for (const [company, host] of [['A', 'jobs.newats.io'], ['B', 'careers.newats.io'], ['C', 'x.newats.io']]) {
      lines.push(JSON.stringify({ url: `https://${host}/job/1`, company, source: 'web', ts: now }));
      lines.push(JSON.stringify({ url: `https://${host}/job/2`, company, source: 'web', ts: now }));
    }
    await writeFile(join(dir, 'data', 'scan-decisions.jsonl'), lines.join('\n') + '\n');
    await writeFile(join(dir, 'portals.yml'), 'tracked_companies: []\n');
    const logs = [];
    const run = () => recordPlatformCandidates({ dataDir: join(dir, 'data'), portalsPath: join(dir, 'portals.yml'), providers: new Map(), log: (m) => logs.push(m), env: {} });
    const first = await run();
    assert.ok(first.written?.endsWith('platform-candidates.json'));
    assert.ok(first.top.some((c) => c.domain === 'newats.io'), JSON.stringify(first.top.map((c) => c.domain)));
    assert.deepEqual(first.fresh, ['newats.io']);
    const second = await run();
    assert.deepEqual(second.fresh, []);
    const off = await recordPlatformCandidates({ dataDir: join(dir, 'data'), portalsPath: join(dir, 'portals.yml'), providers: new Map(), log() {}, env: { PLATFORM_CANDIDATES: '0' } });
    assert.equal(off.disabled, true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('platform shortlist: a domain a provider reads is claimed, even for an offer URL detect() rejects', async () => {
  const { providerDomainsFromSources, buildHostClassifier } = await import('../lib/unknown-hosts.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'prov-'));
  try {
    await writeFile(join(dir, 'vdabish.mjs'), [
      '// docs: https://www.youtube.com/watch?v=x and https://old.example.org/ are comments',
      "export default { id: 'vdabish', detect: () => null, fetch: async () => [] };",
      "const API = 'https://www.vdabish.be/rest/jobs';",
      "const DOCS = 'https://www.youtube.com/watch?v=x';",
    ].join('\n'));
    await writeFile(join(dir, '_helper.mjs'), "const x = 'https://hidden.example.net/';");
    const domains = providerDomainsFromSources(dir);
    assert.equal(domains.get('vdabish.be'), 'vdabish');
    assert.equal(domains.has('youtube.com'), false);
    assert.equal(domains.has('example.org'), false);
    assert.equal(domains.has('example.net'), false);
    const classify = buildHostClassifier({ providers: new Map(), portalsConfig: {}, providerDomains: domains });
    assert.deepEqual(classify('www.vdabish.be', ['https://www.vdabish.be/vindeenjob/vacatures/74611425']), { kind: 'provider', detail: 'vdabish' });
    assert.equal(classify('www.newboard.io', ['https://www.newboard.io/job/1']).kind, 'unknown');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
