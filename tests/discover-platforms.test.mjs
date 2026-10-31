// Unknown-host collector (lib/unknown-hosts.mjs + discover-platforms.mjs):
// offline, scratch data dir, stub providers. Never touches the real user layer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  hostOf, registrableDomain, buildHostClassifier, collectHosts, rankCandidates, guessShape, renderTable,
} from '../lib/unknown-hosts.mjs';
import { ROOT, NODE } from './helpers.mjs';

const PORTALS = `
tracked_companies:
  - name: Linear
    careers_url: https://jobs.ashbyhq.com/linear
  - name: Frog
    careers_url: https://www.frog.co/careers
job_boards:
  - name: Remotive
    url: https://remotive.com/api/remote-jobs
excluded_domains:
  - upwork.com
`;

const stubProviders = new Map([
  ['himalayas', { id: 'himalayas', fetch() {}, detect: (e) => /himalayas\.app/.test(e.careers_url || '') ? { url: e.careers_url } : null }],
]);

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'discover-platforms-'));
  const dataDir = join(dir, 'data');
  mkdirSync(dataDir);
  const portalsPath = join(dir, 'portals.yml');
  writeFileSync(portalsPath, PORTALS);
  const rows = [
    // unknown multi-tenant ATS: three tenants, three employers
    { ts: '2026-10-01T00:00:00Z', url: 'https://acme.newats.io/jobs/1', company: 'Acme', source: 'web' },
    { ts: '2026-10-02T00:00:00Z', url: 'https://beta.newats.io/jobs/2', company: 'Beta Labs', source: 'web' },
    { ts: '2026-10-03T00:00:00Z', url: 'https://gamma.newats.io/jobs/3', company: 'Gamma GmbH', source: 'Remotive' },
    // unknown job board: one host, many employers, /job/ path
    { ts: '2026-10-04T00:00:00Z', url: 'https://www.coolboard.com/job/111', company: 'One', source: 'web' },
    { ts: '2026-10-04T00:00:00Z', url: 'https://www.coolboard.com/job/222', company: 'Two', source: 'web' },
    { ts: '2026-10-05T00:00:00Z', url: 'https://www.coolboard.com/job/333', company: 'Three', source: 'web' },
    // claimed: ATS already read, provider, configured source, tracked employer, excluded, non-employer
    { ts: '2026-10-05T00:00:00Z', url: 'https://jobs.ashbyhq.com/linear/abc', company: 'Linear' },
    { ts: '2026-10-05T00:00:00Z', url: 'https://jobs.lever.co/foo/abc', company: 'Foo' },
    { ts: '2026-10-05T00:00:00Z', url: 'https://himalayas.app/companies/x/jobs/y', company: 'X' },
    { ts: '2026-10-05T00:00:00Z', url: 'https://himalayas.app/companies/z/jobs/w', company: 'Z' },
    { ts: '2026-10-05T00:00:00Z', url: 'https://remotive.com/remote-jobs/1', company: 'R1' },
    { ts: '2026-10-05T00:00:00Z', url: 'https://remotive.com/remote-jobs/2', company: 'R2' },
    { ts: '2026-10-05T00:00:00Z', url: 'https://www.frog.co/careers/jobs/1', company: 'frog' },
    { ts: '2026-10-05T00:00:00Z', url: 'https://www.upwork.com/jobs/1', company: 'U1' },
    { ts: '2026-10-05T00:00:00Z', url: 'https://www.upwork.com/jobs/2', company: 'U2' },
    { ts: '2026-10-05T00:00:00Z', url: 'https://www.linkedin.com/jobs/view/1', company: 'L1' },
    { ts: '2026-10-05T00:00:00Z', url: 'https://www.linkedin.com/jobs/view/2', company: 'L2' },
    // single-employer unknown host, met once: below thresholds
    { ts: '2026-10-05T00:00:00Z', url: 'https://hr.lonely.xyz/apply/1', company: 'Lonely' },
    // junk
    { ts: '2026-10-05T00:00:00Z', url: 'mailto:jobs@acme.com', company: 'Acme' },
    { ts: '2026-10-05T00:00:00Z', url: 'not a url', company: 'Acme' },
  ];
  writeFileSync(join(dataDir, 'scan-decisions.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\nnot json\n');
  writeFileSync(join(dataDir, 'scan-history.tsv'), [
    'url\tfirst_seen\tportal\ttitle\tcompany\tstatus',
    'https://www.coolboard.com/job/444\t2026-09-20\tmanual\tDesigner\tFour\tnew',
    'https://old.newats.io/jobs/9\t2026-09-01\tmanual\tPM\tOld Co\tdeleted',
  ].join('\n') + '\n');
  writeFileSync(join(dataDir, 'pipeline.jsonl'), JSON.stringify({ url: 'https://www.coolboard.com/job/555', status: 'new', scanned_at: '2026-10-06T00:00:00Z' }) + '\n');
  return { dir, dataDir, portalsPath };
}

test('hostOf / registrableDomain', () => {
  assert.equal(hostOf('https://Acme.Jobs.Vendor.com/x?y=1'), 'acme.jobs.vendor.com');
  assert.equal(hostOf('mailto:a@b.com'), '');
  assert.equal(hostOf('https://127.0.0.1/x'), '');
  assert.equal(hostOf('https://localhost/x'), '');
  assert.equal(registrableDomain('acme.jobs.vendor.com'), 'vendor.com');
  assert.equal(registrableDomain('careers.acme.co.uk'), 'acme.co.uk');
  assert.equal(registrableDomain('jobs.acme.com.sg'), 'acme.com.sg');
  assert.equal(registrableDomain('vendor.io'), 'vendor.io');
});

test('classifier knows ATS, providers, configured sources, tracked employers, exclusions, non-employer hosts', () => {
  const { portalsPath } = fixture();
  const { load } = { load: (p) => import('js-yaml').then(m => m.load(readFileSync(p, 'utf8'))) };
  return load(portalsPath).then((portalsConfig) => {
    const classify = buildHostClassifier({ providers: stubProviders, portalsConfig });
    assert.equal(classify('jobs.ashbyhq.com', ['https://jobs.ashbyhq.com/linear/abc']).kind, 'ats');
    assert.equal(classify('jobs.lever.co', ['https://jobs.lever.co/foo/abc']).kind, 'ats');
    assert.equal(classify('acme.recruitee.com', []).kind, 'ats');
    assert.deepEqual(classify('himalayas.app', ['https://himalayas.app/companies/x/jobs/y']), { kind: 'provider', detail: 'himalayas' });
    assert.equal(classify('remotive.com', ['https://remotive.com/remote-jobs/1']).kind, 'configured');
    assert.equal(classify('www.frog.co', ['https://www.frog.co/careers/jobs/1']).kind, 'tracked');
    assert.equal(classify('www.upwork.com', []).kind, 'excluded');
    assert.equal(classify('www.linkedin.com', []).kind, 'non_employer');
    assert.equal(classify('acme.newats.io', ['https://acme.newats.io/jobs/1']).kind, 'unknown');
  });
});

test('collect + rank: unknown multi-employer domains are the candidates, claimed ones are not', async () => {
  const { dataDir, portalsPath } = fixture();
  const { discoverPlatforms } = await import('../discover-platforms.mjs');
  const r = await discoverPlatforms({ dataDir, portalsPath, providers: stubProviders });
  assert.equal(r.inputs['scan-decisions.jsonl'], 20);
  assert.equal(r.inputs['scan-history.tsv'], 2);
  assert.equal(r.inputs['pipeline.jsonl'], 1);
  const domains = r.candidates.map(c => c.domain);
  assert.deepEqual(domains.sort(), ['coolboard.com', 'newats.io']);
  const ats = r.candidates.find(c => c.domain === 'newats.io');
  assert.equal(ats.shape, 'multi-tenant ATS');
  assert.equal(ats.hosts, 4);          // acme, beta, gamma + old from scan-history
  assert.equal(ats.companies, 4);
  assert.equal(ats.first_seen, '2026-09-01');
  assert.equal(ats.last_seen, '2026-10-03');
  const board = r.candidates.find(c => c.domain === 'coolboard.com');
  assert.equal(board.shape, 'job board');
  assert.equal(board.urls, 5);
  assert.equal(board.companies, 4);    // pipeline.jsonl row has no company
  assert.match(board.hint, /\/job\//);
  // claimed and sub-threshold domains are reported in the summary, not as candidates
  assert.equal(r.claimed.length, 0);   // --all not set
  assert.equal(r.summary.unknown, 3);  // newats, coolboard, lonely.xyz
  assert.equal(r.summary.ats, 2);
  assert.equal(r.summary.provider, 1);
  assert.equal(r.summary.configured, 1);
  assert.equal(r.summary.tracked, 1);
  assert.equal(r.summary.excluded, 1);
  assert.equal(r.summary.non_employer, 1);
});

test('--all lists claimed domains with kind; --include-single admits single-employer hosts; --since filters', async () => {
  const { dataDir, portalsPath } = fixture();
  const { discoverPlatforms } = await import('../discover-platforms.mjs');
  const all = await discoverPlatforms({ dataDir, portalsPath, providers: stubProviders, all: true, include_single: true });
  assert.ok(all.candidates.some(c => c.domain === 'lonely.xyz' && c.shape === 'single employer'));
  const kinds = Object.fromEntries(all.claimed.map(c => [c.domain, c.kind]));
  assert.equal(kinds['himalayas.app'], 'provider');
  assert.equal(kinds['upwork.com'], 'excluded');
  assert.equal(kinds['frog.co'], 'tracked');
  // a cutoff far in the future keeps nothing
  const none = await discoverPlatforms({ dataDir, portalsPath, providers: stubProviders, sinceDays: -1 });
  assert.equal(none.records, 0);
  assert.equal(none.candidates.length, 0);
});

test('guessShape and renderTable', () => {
  const shape = guessShape({ hosts: new Set(['a.v.com', 'b.v.com', 'c.v.com']), companies: new Set(['a', 'b', 'c']), segments: new Map([['jobs', 3]]) });
  assert.equal(shape.shape, 'multi-tenant ATS');
  const board = guessShape({ hosts: new Set(['www.b.com']), companies: new Set(['a', 'b', 'c']), segments: new Map([['job', 3], ['', 1]]) });
  assert.equal(board.shape, 'job board');
  const table = renderTable([{ domain: 'v.com', shape: 'job board', hint: 'x', companies: 3, hosts: 1, urls: 4, samples: ['https://v.com/job/1'], sources: ['web'], first_seen: '2026-10-01', last_seen: '2026-10-02' }]);
  assert.match(table, /v\.com\s+job board\s+3\s+1\s+4\s+2026-10-01→2026-10-02\s+https:\/\/v\.com\/job\/1/);
  assert.equal(renderTable([]), '(none)');
});

test('CLI: preview writes nothing, --out writes the JSON envelope, --json prints it', () => {
  const { dir, dataDir, portalsPath } = fixture();
  const cli = join(ROOT, 'discover-platforms.mjs');
  const base = [cli, '--data-dir', dataDir, '--portals', portalsPath, '--no-providers'];
  const text = execFileSync(NODE, base, { encoding: 'utf8', cwd: ROOT });
  assert.match(text, /Candidate platforms/);
  assert.match(text, /newats\.io/);
  assert.match(text, /coolboard\.com/);
  assert.match(text, /nothing written/);
  assert.ok(!existsSync(join(dir, 'candidates.json')));
  const out = join(dir, 'candidates.json');
  const json = JSON.parse(execFileSync(NODE, [...base, '--json', '--out', out], { encoding: 'utf8', cwd: ROOT }));
  assert.equal(json.written, out);
  assert.ok(existsSync(out));
  assert.equal(JSON.parse(readFileSync(out, 'utf8')).candidates.length, 2);
  // himalayas.app is unknown without providers: the stub is what claimed it above
  assert.ok(json.candidates.every(c => c.kind === 'unknown'));
});
