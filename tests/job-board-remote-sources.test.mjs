import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import remotive, { remotiveFeedUrl } from '../providers/remotive.mjs';
import workingnomads from '../providers/workingnomads.mjs';
import { createSourceThrottle, minIntervalMinutes, sourceThrottleKey } from '../lib/job-board-throttle.mjs';
import { fetchJobBoard, fetchJobBoardPolite, jobBoardProviders } from '../lib/scan-job-boards.mjs';
import { dedupeCandidates } from '../lib/scan-decision.mjs';

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/job-boards/${name}`, import.meta.url), 'utf8'));
const ctxFor = (payload, seen = []) => ({ fetchJson: async (url, opts) => { seen.push({ url, opts }); return payload; } });

test('remotive: category slug narrows the feed, invalid slugs are refused', () => {
  assert.equal(remotiveFeedUrl({}), 'https://remotive.com/api/remote-jobs');
  assert.equal(remotiveFeedUrl({ category: 'Design' }), 'https://remotive.com/api/remote-jobs?category=design');
  assert.throws(() => remotiveFeedUrl({ category: 'design&x=1' }), /invalid category/);
});

test('remotive: maps fixture jobs with UTC date, description, remote evidence and attribution', async () => {
  const seen = [];
  const jobs = await remotive.fetch({ name: 'Remotive Design', category: 'design' }, ctxFor(fixture('remotive-design.json'), seen));
  assert.equal(seen[0].url, 'https://remotive.com/api/remote-jobs?category=design');
  assert.equal(seen[0].opts.redirect, 'error');
  assert.equal(jobs.length, 2);
  const [a, b] = jobs;
  assert.equal(a.title, 'Senior Product Designer');
  assert.equal(a.company, 'Acme Labs');
  assert.equal(a.postedAt, Date.parse('2026-10-17T16:04:29Z'));
  assert.match(a.description, /Senior Product Designer to own end-to-end flows/);
  assert.match(a.description, /Design systems\n/);
  assert.equal(a.remoteEvidence, 'Remote (Europe)');
  assert.equal(a.via, 'Remotive');
  assert.match(a.url, /^https:\/\/remotive\.com\/remote-jobs\//, 'keeps the Remotive link (API terms)');
  assert.equal(b.company, 'Remotive Design');
  assert.equal(b.postedAt, undefined, 'unparseable date stays undated, not epoch 0');
  assert.equal(b.description, undefined);
});

test('remotive declares its attribution and a 6 h default interval', () => {
  assert.deepEqual(remotive.attribution, { name: 'Remotive', url: 'https://remotive.com' });
  assert.equal(minIntervalMinutes({}, remotive), 360);
  assert.equal(minIntervalMinutes({ min_interval_minutes: 0 }, remotive), 0, 'config can disable the throttle');
  assert.equal(minIntervalMinutes({ min_interval_minutes: 720 }, remotive), 720);
  assert.equal(minIntervalMinutes({}, workingnomads), 0);
});

test('workingnomads: keeps pub_date (with offset) and remote evidence', async () => {
  const jobs = await workingnomads.fetch({ name: 'Working Nomads' }, ctxFor(fixture('workingnomads.json')));
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].postedAt, Date.parse('2026-10-15T18:12:21Z'));
  assert.equal(jobs[0].remoteEvidence, 'Remote (Europe)');
  assert.equal(jobs[1].postedAt, undefined);
  assert.equal(jobs[1].remoteEvidence, 'Remote');
});

test('fetchJobBoard strips utm parameters and stamps the attribution source', async () => {
  const jobs = await fetchJobBoard({ name: 'Remotive Design', provider: 'remotive', category: 'design' },
    { providers: new Map([['remotive', remotive]]), ctx: ctxFor(fixture('remotive-design.json')) });
  assert.equal(jobs[0].url, 'https://remotive.com/remote-jobs/design/senior-product-designer-2091001');
  assert.equal(jobs[0].via, 'Remotive');
  assert.equal(jobs[0].publishedAt, Date.parse('2026-10-17T16:04:29Z'));
});

test('throttle: skips a source fetched within its interval, persists across instances', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jb-throttle-'));
  try {
    const statePath = join(dir, 'data', 'job-board-throttle.json');
    let now = Date.parse('2026-10-19T10:00:00Z');
    const entry = { name: 'Remotive Design', provider: 'remotive', category: 'design' };
    const t1 = createSourceThrottle({ statePath, now: () => now });
    assert.equal(t1.check(entry, remotive).skip, false, 'first fetch allowed');
    t1.record(entry);
    assert.ok(existsSync(statePath));
    now += 60 * 60_000;
    const t2 = createSourceThrottle({ statePath, now: () => now });
    const verdict = t2.check(entry, remotive);
    assert.equal(verdict.skip, true);
    assert.match(verdict.reason, /360 min.*next in ~300 min/);
    assert.equal(t2.check({ ...entry, category: 'product' }, remotive).skip, false, 'each category is its own source');
    assert.equal(t2.check({ ...entry, provider: 'workingnomads' }, workingnomads).skip, false, 'no default interval');
    now += 5 * 60 * 60_000;
    assert.equal(t2.check(entry, remotive).skip, false, 'allowed again after the interval');
    assert.notEqual(sourceThrottleKey(entry), sourceThrottleKey({ ...entry, name: 'Other' }));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('throttle: a corrupt state file is ignored, not fatal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jb-throttle-'));
  try {
    const statePath = join(dir, 'state.json');
    writeFileSync(statePath, '{not json');
    assert.equal(createSourceThrottle({ statePath }).check({ provider: 'remotive' }, remotive).skip, false);
    const t = createSourceThrottle({ statePath: join(dir, 'missing', 'x.json') });
    assert.equal(t.check({ provider: 'remotive' }, remotive).skip, false);
    assert.ok(statePath);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('fetchJobBoardPolite: a throttled source makes no request', async () => {
  let calls = 0;
  const providers = new Map([['remotive', { ...remotive, fetch: async () => { calls += 1; return []; } }]]);
  const throttle = { check: () => ({ skip: true, reason: 'fetched less than 360 min ago' }), record: () => { throw new Error('must not record'); } };
  const res = await fetchJobBoardPolite({ provider: 'remotive', name: 'R' }, { throttle, providers, ctx: {} });
  assert.deepEqual(res, { skipped: true, reason: 'fetched less than 360 min ago', jobs: [] });
  assert.equal(calls, 0);
  let recorded = 0;
  const open = { check: () => ({ skip: false }), record: () => { recorded += 1; } };
  const ok = await fetchJobBoardPolite({ provider: 'remotive', name: 'R' }, { throttle: open, providers, ctx: {} });
  assert.equal(ok.skipped, false);
  assert.equal(recorded, 1);
});

test('fetchJobBoardPolite: a failed fetch is not recorded (retried next scan)', async () => {
  let recorded = 0;
  const providers = new Map([['remotive', { ...remotive, fetch: async () => { throw new Error('HTTP 429'); } }]]);
  await assert.rejects(fetchJobBoardPolite({ provider: 'remotive' }, { throttle: { check: () => ({ skip: false }), record: () => { recorded += 1; } }, providers, ctx: {} }), /429/);
  assert.equal(recorded, 0);
});

test('cross-source dedup: the same role from Remotive and Working Nomads is kept once', () => {
  const kept = dedupeCandidates([
    { title: 'Senior Product Designer', company: 'Acme Labs', url: 'https://remotive.com/remote-jobs/design/senior-product-designer-2091001', source: 'Remotive' },
    { title: 'Senior Product Designer', company: 'Acme Labs', url: 'https://www.workingnomads.com/job/go/1944999/', source: 'Working Nomads' },
    { title: 'Senior Product Designer', company: 'Acme Labs', url: 'https://remotive.com/remote-jobs/design/senior-product-designer-2091001?utm_source=x', source: 'Remotive' },
  ]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].source, 'Remotive');
});

test('board providers used by the remote design sources are registered', () => {
  for (const id of ['remotive', 'workingnomads', 'weworkremotely', 'nodesk', 'himalayas', 'jobicy', 'hackernews']) {
    assert.ok(jobBoardProviders.has(id), id);
  }
});
test('validate-portals: rejects a bad min_interval_minutes or Remotive category', async () => {
  const { validatePortalsConfig } = await import('../validate-portals.mjs');
  const providerIds = new Set(['remotive', 'workingnomads']);
  const ok = await validatePortalsConfig({ job_boards: [{ name: 'Remotive', provider: 'remotive', category: 'design', min_interval_minutes: 360 }] }, { providerIds });
  assert.equal(ok.errors.length, 0, JSON.stringify(ok.errors));
  const bad = await validatePortalsConfig({ job_boards: [
    { name: 'Remotive', provider: 'remotive', category: 'design&x=1' },
    { name: 'WN', provider: 'workingnomads', min_interval_minutes: -5 },
  ] }, { providerIds });
  const text = JSON.stringify(bad.errors);
  assert.match(text, /category/);
  assert.match(text, /min_interval_minutes/);
});