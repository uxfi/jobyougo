import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load as yamlLoad } from 'js-yaml';
import {
  extractAtsSlugs, classifyCandidate, buildExplorerQueries, insertIntoTrackedCompanies,
  renderEntries, runAtsExplorer, resolveExplorerConfig, displayName,
} from '../lib/ats-explorer.mjs';

const PORTALS = `# top comment
scan_max_age_days: 7
tracked_companies:
  # keep this comment
  - name: Linear
    careers_url: https://jobs.ashbyhq.com/linear
    api: https://api.ashbyhq.com/posting-api/job-board/linear
    enabled: true
  - name: Old Co
    careers_url: https://job-boards.greenhouse.io/oldco
    enabled: false
eu_job_boards:
  - name: Board
    query: x
`;

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'ats-explorer-'));
  const portalsPath = join(dir, 'portals.yml');
  writeFileSync(portalsPath, PORTALS);
  return { dir, portalsPath, dataDir: join(dir, 'data') };
}

const json = (body, status = 200) => ({ status, text: async () => JSON.stringify(body) });
function fakeFetch(map) {
  return async (url) => {
    for (const [k, v] of Object.entries(map)) if (url.startsWith(k)) return typeof v === 'function' ? v() : v;
    return { status: 404, text: async () => '' };
  };
}

test('extractAtsSlugs covers every supported ATS and skips reserved paths', () => {
  const got = extractAtsSlugs([
    'https://jobs.ashbyhq.com/acme/123', 'https://job-boards.greenhouse.io/beta/jobs/9', 'https://boards.greenhouse.io/embed/job_board?for=gamma',
    'https://jobs.lever.co/delta/abc', 'https://apply.workable.com/epsilon/j/ABC', 'https://apply.workable.com/api/v1/x',
    'https://jobs.smartrecruiters.com/Zeta/744', 'https://eta.recruitee.com/o/x', 'https://theta.jobs.personio.de/job/1', 'https://iota.teamtailor.com/jobs/1',
    'https://jobs.ashbyhq.com/jobs',
  ]).map(x => `${x.ats}:${x.slug}`);
  assert.deepEqual(got.sort(), ['ashby:acme', 'greenhouse:beta', 'greenhouse:gamma', 'lever:delta', 'personio:theta', 'recruitee:eta', 'smartrecruiters:zeta', 'teamtailor:iota', 'workable:epsilon'].sort());
});

test('classifyCandidate: tech/product required, agencies/ambiguous/hardware excluded', () => {
  assert.equal(classifyCandidate({ slug: 'acme', titles: ['Senior Software Engineer', 'Accountant'] }).ok, true);
  assert.equal(classifyCandidate({ slug: 'acme', titles: ['Product Manager'] }).ok, true);
  assert.equal(classifyCandidate({ slug: 'acme', titles: ['Accountant', 'Sales Director'] }).reason, 'no_tech_product_role');
  assert.equal(classifyCandidate({ slug: 'acme', titles: [] }).reason, 'empty_board');
  assert.equal(classifyCandidate({ slug: 'acme', titles: ['Software Engineer'], minRoles: 2 }).reason, 'empty_board');
  assert.equal(classifyCandidate({ slug: 'shop', titles: [...Array(30)].map((_, i) => `Sales Associate ${i}`).concat(['Web Developer']) }).reason, 'no_tech_product_role');
  assert.equal(classifyCandidate({ slug: 'huzzle', titles: ['Software Engineer'] }).reason, 'agency_or_job_board');
  assert.equal(classifyCandidate({ slug: 'x1', name: 'Acme Recruitment', titles: ['Software Engineer'] }).reason, 'agency_or_job_board');
  assert.equal(classifyCandidate({ slug: 'leverdemo-8', titles: ['Software Engineer'] }).reason, 'ambiguous_slug');
  assert.equal(classifyCandidate({ slug: 'chipco', titles: ['RTL Design Engineer', 'ASIC Architect', 'PCB Layout Engineer', 'Software Engineer'] }).reason, 'off_profile_sector');
});

test('buildExplorerQueries rotates across sites within the budget', () => {
  const a = buildExplorerQueries({ cursor: 0, budget: 3 });
  assert.equal(a.queries.length, 3);
  assert.ok(a.queries.every(q => q.startsWith('site:')));
  assert.notEqual(a.queries[0].split(' ')[0], a.queries[1].split(' ')[0]);
  const b = buildExplorerQueries({ cursor: a.nextCursor, budget: 3 });
  assert.notDeepEqual(a.queries, b.queries);
});

test('insertIntoTrackedCompanies keeps comments and other sections', () => {
  const out = insertIntoTrackedCompanies(PORTALS, renderEntries([{ name: 'New: Co', careers_url: 'https://jobs.lever.co/new', api: 'https://api.lever.co/v0/postings/new?mode=json', notes: 'auto-explored x via site:jobs.lever.co "a" remote' }]));
  assert.match(out, /# top comment/); assert.match(out, /# keep this comment/);
  const y = yamlLoad(out);
  assert.equal(y.tracked_companies.length, 3);
  assert.equal(y.tracked_companies[2].name, 'New: Co');
  assert.equal(y.eu_job_boards.length, 1);
});

test('resolveExplorerConfig: on by default, env/config switches and budgets', () => {
  assert.equal(resolveExplorerConfig({}, {}).enabled, true);
  assert.equal(resolveExplorerConfig({ ats_explorer: { enabled: false } }, {}).enabled, false);
  assert.equal(resolveExplorerConfig({}, { ATS_EXPLORER: '0' }).enabled, false);
  assert.equal(resolveExplorerConfig({}, { ATS_EXPLORER_MAX_QUERIES: '2' }).max_queries, 2);
});

test('displayName cleans board titles', () => {
  assert.equal(displayName('Careers at Tide', 'tide'), 'Tide');
  assert.equal(displayName('MaintainX (An Autodesk Company)', 'maintainx'), 'MaintainX');
  assert.equal(displayName(null, 'neptune-software'), 'Neptune Software');
});

test('runAtsExplorer end-to-end with simulated network: dedup, verify, add, log, jsonl, cap', async () => {
  const { portalsPath, dataDir } = fixture();
  const logs = [];
  const fetchImpl = fakeFetch({
    'https://api.ashbyhq.com/posting-api/job-board/newai': json({ jobs: [{ title: 'Senior Product Designer' }, { title: 'ML Engineer' }] }),
    'https://boards-api.greenhouse.io/v1/boards/salesonly/jobs': json({ jobs: [{ title: 'Account Executive' }] }),
    'https://boards-api.greenhouse.io/v1/boards/salesonly': json({ name: 'SalesOnly' }),
    'https://api.lever.co/v0/postings/emptyco': json([]),
    'https://apply.workable.com/api/v1/widget/accounts/wkco': json({ name: 'Wk Co', jobs: [{ title: 'Backend Developer' }, { title: 'Product Manager' }] }),
    'https://jobs.ashbyhq.com/newai': { status: 200, text: async () => '<html><title>NewAI Jobs</title></html>' },
  });
  const queries = [];
  const search = async (q) => { queries.push(q); return { urls: ['https://jobs.ashbyhq.com/newai/1', 'https://jobs.ashbyhq.com/linear/2', 'https://jobs.lever.co/emptyco/x'] }; };
  const s = await runAtsExplorer({
    portalsPath, dataDir, search, fetchImpl, log: (m) => logs.push(m), env: { ATS_EXPLORER_MAX_QUERIES: '2' },
    offerUrls: ['https://job-boards.greenhouse.io/salesonly/jobs/1', 'https://job-boards.greenhouse.io/oldco/jobs/2', 'https://apply.workable.com/wkco/j/1'],
    now: new Date('2026-10-20T09:00:00Z'),
  });
  assert.equal(queries.length, 2);
  assert.deepEqual(s.addedNames.sort(), ['NewAI', 'Wk Co']);
  const y = yamlLoad(readFileSync(portalsPath, 'utf8'));
  assert.equal(y.tracked_companies.find(e => e.name === 'Old Co').enabled, false, 'disabled entry never re-enabled');
  assert.ok(!y.tracked_companies.some(e => /oldco|linear/.test(e.careers_url) && e.name !== 'Old Co' && e.name !== 'Linear'));
  const added = y.tracked_companies.find(e => e.name === 'NewAI');
  assert.equal(added.api, 'https://api.ashbyhq.com/posting-api/job-board/newai');
  assert.match(added.notes, /^auto-explored 2026-10-20 via site:/);
  assert.match(logs.at(-1), /^\[scan\] \[explorer\] queries=2 found=4 added=2 skipped=2/);
  const lines = readFileSync(join(dataDir, 'discovered-companies.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(lines.length, 4);
  assert.ok(readdirSync(join(portalsPath, '..')).some(f => f.startsWith('portals.yml.bak-explorer-')));
  assert.ok(!existsSync(`${portalsPath}.explorer.lock`));
  // second run: rejected boards cached, nothing re-added
  const s2 = await runAtsExplorer({ portalsPath, dataDir, search, fetchImpl, log: () => {}, env: { ATS_EXPLORER_MAX_QUERIES: '1' } });
  assert.equal(s2.added, 0);
});

test('runAtsExplorer stops active queries when the engine is blocked and honours max_add', async () => {
  const { portalsPath, dataDir } = fixture();
  let calls = 0;
  const search = async () => { calls++; return { blocked: true }; };
  const fetchImpl = fakeFetch({ 'https://api.ashbyhq.com/posting-api/job-board/': json({ jobs: [{ title: 'Software Engineer' }, { title: 'Data Engineer' }] }) });
  const s = await runAtsExplorer({ portalsPath, dataDir, search, fetchImpl, log: () => {}, env: { ATS_EXPLORER_MAX_ADD: '1' },
    offerUrls: ['https://jobs.ashbyhq.com/aaa1/x', 'https://jobs.ashbyhq.com/bbb2/x'] });
  assert.equal(calls, 1);
  assert.equal(s.blocked, 1);
  assert.equal(s.added, 1);
});

test('runAtsExplorer disabled does nothing', async () => {
  const { portalsPath, dataDir } = fixture();
  const s = await runAtsExplorer({ portalsPath, dataDir, env: { ATS_EXPLORER: 'off' }, log: () => {} });
  assert.equal(s.disabled, true);
  assert.equal(readFileSync(portalsPath, 'utf8'), PORTALS);
});

test('a lock held by another writer leaves portals.yml untouched', async () => {
  const { portalsPath, dataDir } = fixture();
  writeFileSync(`${portalsPath}.explorer.lock`, '');
  const fetchImpl = fakeFetch({ 'https://api.ashbyhq.com/posting-api/job-board/': json({ jobs: [{ title: 'Software Engineer' }, { title: 'Data Engineer' }] }) });
  const s = await runAtsExplorer({ portalsPath, dataDir, fetchImpl, log: () => {}, offerUrls: ['https://jobs.ashbyhq.com/ccc3/x'] });
  assert.equal(s.added, 0);
  assert.equal(readFileSync(portalsPath, 'utf8'), PORTALS);
});

test('permanent exclusions in the state file are never verified or added', async () => {
  const { portalsPath, dataDir } = fixture();
  const { mkdirSync } = await import('node:fs');
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, 'ats-explorer-state.json'), JSON.stringify({ excluded: ['ashby|wayve'] }));
  let fetched = 0;
  const s = await runAtsExplorer({ portalsPath, dataDir, fetchImpl: async () => { fetched++; return { status: 404, text: async () => '' }; }, log: () => {}, offerUrls: ['https://jobs.ashbyhq.com/wayve/1'] });
  assert.equal(s.found, 0); assert.equal(fetched, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(dataDir, 'ats-explorer-state.json'), 'utf8')).excluded, ['ashby|wayve']);
});
