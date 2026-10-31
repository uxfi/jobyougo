// Entries that do not work are removed from portals.yml, not switched off
// (2026-10-31): dead boards (404/410, no replacement) after two passes 3+ days
// apart, auto-added boards empty for 3 weeks. Offline, scratch directory only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load as yamlLoad } from 'js-yaml';
import { patchPortalsText, applyPortalsPatches, markStale, runAtsBoardResolver } from '../lib/ats-board-resolver.mjs';

const TEXT = `# head
tracked_companies:
  # first block
  - name: Keep
    careers_url: https://jobs.lever.co/keep
    enabled: true
  # Section: crypto
  - name: Dead
    careers_url: https://job-boards.greenhouse.io/dead
    api: https://boards-api.greenhouse.io/v1/boards/dead/jobs
    notes: x
    enabled: true
  - name: Last
    careers_url: https://jobs.ashbyhq.com/last
    enabled: true

# trailing section comment
eu_job_boards:
  - name: Board
    query: x
`;

const names = (text) => yamlLoad(text).tracked_companies.map((c) => c.name);

test('patchPortalsText removes a whole entry and keeps the comments around it', () => {
  const mid = patchPortalsText(TEXT, [{ name: 'Dead', remove: true, expect: { careers_url: 'https://job-boards.greenhouse.io/dead' } }]);
  assert.deepEqual(mid.applied.map((p) => p.name), ['Dead']);
  assert.deepEqual(names(mid.text), ['Keep', 'Last']);
  assert.ok(mid.text.includes('  # Section: crypto'), 'the comment before the next entry stays');
  assert.ok(!/boards\/dead|notes: x/.test(mid.text), 'none of its fields is left behind');

  const last = patchPortalsText(TEXT, [{ name: 'Last', remove: true }]);
  assert.deepEqual(names(last.text), ['Keep', 'Dead']);
  assert.ok(last.text.includes('# trailing section comment'), 'the comment of the next section stays');
  assert.deepEqual(yamlLoad(last.text).eu_job_boards.map((b) => b.name), ['Board']);

  const first = patchPortalsText(TEXT, [{ name: 'Keep', remove: true }]);
  assert.ok(first.text.includes('  # Section: crypto'));
  assert.deepEqual(names(first.text), ['Dead', 'Last']);

  const crlf = patchPortalsText(TEXT.replace(/\n/g, '\r\n'), [{ name: 'Dead', remove: true }]);
  assert.deepEqual(names(crlf.text), ['Keep', 'Last']);
  assert.ok(!/[^\r]\n/.test(crlf.text), 'line endings stay CRLF');

  const guarded = patchPortalsText(TEXT, [{ name: 'Dead', remove: true, expect: { careers_url: 'https://elsewhere.test' } }, { name: 'Nobody', remove: true }]);
  assert.deepEqual(guarded.skipped.map((s) => s.reason), ['changed_meanwhile', 'entry_not_found']);
  assert.equal(guarded.text, TEXT);
});

test('applyPortalsPatches writes a removal after a backup and re-reads it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'board-removal-'));
  const portalsPath = join(dir, 'portals.yml');
  writeFileSync(portalsPath, TEXT);
  const res = applyPortalsPatches(portalsPath, [{ name: 'Dead', remove: true }, { name: 'Keep', set: { enabled: false } }]);
  assert.deepEqual(res.applied.map((p) => p.name), ['Dead', 'Keep']);
  const after = yamlLoad(readFileSync(portalsPath, 'utf8')).tracked_companies;
  assert.deepEqual(after.map((c) => c.name), ['Keep', 'Last']);
  assert.equal(after[0].enabled, false);
  assert.ok(readdirSync(dir).some((f) => f.startsWith('portals.yml.bak-resolver-')), 'the entry is recoverable from the backup');
  assert.ok(!existsSync(`${portalsPath}.explorer.lock`));
});

test('markStale: a dead board is confirmed over days, and starts over after a long gap', () => {
  const stale = {};
  const t0 = new Date('2026-11-01T00:00:00Z');
  const day = 86400000;
  assert.equal(markStale(stale, 'Co', t0).days, 0);
  assert.equal(markStale(stale, 'Co', new Date(t0.getTime() + 3 * day)).days, 3);
  assert.equal(markStale(stale, 'Co', new Date(t0.getTime() + 6 * day)).days, 6, 'the clock keeps running while the board stays dead');
  const back = markStale(stale, 'Co', new Date(t0.getTime() + 30 * day));
  assert.equal(back.days, 0, 'not seen dead for two weeks: it came back, so the clock restarts');
});

const dead404 = async () => ({ status: 404, text: async () => '' });

function resolverFixture(entries) {
  const dir = mkdtempSync(join(tmpdir(), 'board-removal-'));
  const portalsPath = join(dir, 'portals.yml');
  const body = entries.map((e) => `  - name: ${e.name}\n    careers_url: ${e.careers_url}\n${e.api ? `    api: ${e.api}\n` : ''}${e.notes ? `    notes: ${JSON.stringify(e.notes)}\n` : ''}    enabled: true\n`).join('');
  writeFileSync(portalsPath, `# top\ntracked_companies:\n${body}`);
  const dataDir = join(dir, 'data');
  mkdirSync(dataDir);
  return { portalsPath, dataDir };
}

test('runAtsBoardResolver removes a dead board only on the second sighting, 3 days later', async () => {
  const { portalsPath, dataDir } = resolverFixture([
    { name: 'DeadCo', careers_url: 'https://job-boards.greenhouse.io/deadco', api: 'https://boards-api.greenhouse.io/v1/boards/deadco/jobs' },
    { name: 'Fine', careers_url: 'https://jobs.lever.co/fine' },
  ]);
  const stale = new Map([['DeadCo', { reason: 'HTTP 404' }]]);
  const t0 = new Date('2026-11-01T00:00:00Z');
  const run = (now) => runAtsBoardResolver({ portalsPath, dataDir, stale, fetchImpl: dead404, now, log: () => {}, env: {} });

  const first = await run(t0);
  assert.equal(first.removed, 0, 'one sighting is not enough');
  assert.deepEqual(names(readFileSync(portalsPath, 'utf8')), ['DeadCo', 'Fine']);
  const state = JSON.parse(readFileSync(join(dataDir, 'ats-resolver-state.json'), 'utf8'));
  assert.equal(state.stale.DeadCo.first, t0.toISOString());

  const soon = await run(new Date(t0.getTime() + 1 * 86400000));
  assert.equal(soon.tried, 0, 'a stale board is retried only after 3 days');

  const second = await run(new Date(t0.getTime() + 3 * 86400000));
  assert.deepEqual(second.removedNames, ['DeadCo']);
  assert.equal(second.removed, 1);
  assert.deepEqual(names(readFileSync(portalsPath, 'utf8')), ['Fine']);
  const journal = readFileSync(join(dataDir, 'resolved-boards.jsonl'), 'utf8').trim().split('\n').map(JSON.parse).filter((r) => r.decision === 'removed');
  assert.equal(journal.length, 1);
  assert.equal(journal[0].company, 'DeadCo');
  assert.equal(journal[0].careers_url, 'https://job-boards.greenhouse.io/deadco', 'what was removed stays on record');
  const after = JSON.parse(readFileSync(join(dataDir, 'ats-resolver-state.json'), 'utf8'));
  assert.equal(after.stale.DeadCo, undefined);
});

test('runAtsBoardResolver never removes more than max_remove dead boards in one run', async () => {
  const { portalsPath, dataDir } = resolverFixture(['A', 'B', 'C'].map((n) => ({
    name: `Dead${n}`, careers_url: `https://job-boards.greenhouse.io/dead${n.toLowerCase()}`, api: `https://boards-api.greenhouse.io/v1/boards/dead${n.toLowerCase()}/jobs`,
  })));
  const stale = new Map(['DeadA', 'DeadB', 'DeadC'].map((n) => [n, { reason: 'HTTP 404' }]));
  const config = { ats_board_resolver: { max_remove: 1 } };
  const t0 = new Date('2026-11-01T00:00:00Z');
  await runAtsBoardResolver({ portalsPath, dataDir, stale, config, fetchImpl: dead404, now: t0, log: () => {}, env: {} });
  const second = await runAtsBoardResolver({ portalsPath, dataDir, stale, config, fetchImpl: dead404, now: new Date(t0.getTime() + 3 * 86400000), log: () => {}, env: {} });
  assert.equal(second.removed, 1);
  assert.equal(names(readFileSync(portalsPath, 'utf8')).length, 2);
});

test('runAtsBoardResolver can keep dead boards (prune_dead: false)', async () => {
  const { portalsPath, dataDir } = resolverFixture([{ name: 'DeadCo', careers_url: 'https://job-boards.greenhouse.io/deadco', api: 'https://boards-api.greenhouse.io/v1/boards/deadco/jobs' }]);
  const stale = new Map([['DeadCo', { reason: 'HTTP 404' }]]);
  const config = { ats_board_resolver: { prune_dead: false } };
  const t0 = new Date('2026-11-01T00:00:00Z');
  await runAtsBoardResolver({ portalsPath, dataDir, stale, config, fetchImpl: dead404, now: t0, log: () => {}, env: {} });
  const later = await runAtsBoardResolver({ portalsPath, dataDir, stale, config, fetchImpl: dead404, now: new Date(t0.getTime() + 5 * 86400000), log: () => {}, env: {} });
  assert.equal(later.removed, 0);
  assert.deepEqual(names(readFileSync(portalsPath, 'utf8')), ['DeadCo']);
});

test('runAtsBoardResolver removes an auto-added board that stayed empty for 3 weeks, and only that kind', async () => {
  const { portalsPath, dataDir } = resolverFixture([
    { name: 'EmptyCo', careers_url: 'https://jobs.ashbyhq.com/emptyco', api: 'https://api.ashbyhq.com/posting-api/job-board/emptyco', notes: 'auto-explored 2026-10-01 via scan offers' },
    { name: 'HandMade', careers_url: 'https://jobs.ashbyhq.com/handmade', api: 'https://api.ashbyhq.com/posting-api/job-board/handmade', notes: 'added by hand' },
  ]);
  const emptyBoards = async (url) => (url.includes('/job-board/') && !url.endsWith('/job-board/emptyco') && !url.endsWith('/job-board/handmade')
    ? { status: 404, text: async () => '' }
    : { status: 200, text: async () => JSON.stringify({ jobs: [] }) });
  const t0 = new Date('2026-11-01T00:00:00Z');
  const day = 86400000;
  const run = (now) => runAtsBoardResolver({ portalsPath, dataDir, fetchImpl: emptyBoards, now, log: () => {}, env: {} });
  assert.equal((await run(t0)).removed, 0);
  assert.equal((await run(new Date(t0.getTime() + 10 * day))).removed, 0, 'not empty long enough yet');
  const done = await run(new Date(t0.getTime() + 22 * day));
  assert.deepEqual(done.removedNames, ['EmptyCo']);
  assert.deepEqual(names(readFileSync(portalsPath, 'utf8')), ['HandMade'], 'an entry written by hand is never touched');
});
