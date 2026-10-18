// The Started status: an apply run on an Evaluated offer marks it, a confirmed
// send moves it on to Applied, and the list says how each offer's last run
// ended. ui/server.mjs starts on import, so its functions are evaluated from the
// source text in a sandbox, the same way server-view-only-routes.test.mjs does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { ROOT, rmSync } from './helpers.mjs';
import { loadCanonicalStates, resolveCanonicalState } from '../tracker-utils.mjs';

const server = readFileSync(join(ROOT, 'ui/server.mjs'), 'utf8');
const page = readFileSync(join(ROOT, 'ui/index.html'), 'utf8');
const STATES = loadCanonicalStates(join(ROOT, 'templates', 'states.yml'));

function sourceOf(name, src = server) {
  const start = src.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, `${name} is defined`);
  const end = src.indexOf('\n}\n', start);
  return src.slice(start, end + 2);
}

function routeBlock(condition) {
  const start = server.indexOf(condition);
  assert.ok(start >= 0, `route ${condition}`);
  const next = server.indexOf('\n    if (path', start + condition.length);
  return server.slice(start, next);
}

const plain = value => JSON.parse(JSON.stringify(value));

const TRACKER = [
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|---|---|---|---|---|---|---|---|',
  '| 7 | 2026-10-18 | Acme | Designer | 4.0/5 | Evaluated | ❌ | [7](x) |  |',
  '| 8 | 2026-10-18 | Beta | PM | 3.0/5 | Applied | ❌ | [8](x) |  |',
  '| 9 | 2026-10-18 | Gamma | PM | 3.0/5 | Started | ❌ | [9](x) |  |',
  '| 10 | 2026-10-18 | Delta | PM | 3.0/5 | Hold | ❌ | [10](x) |  |',
].join('\n');

function setterContext() {
  const ctx = vm.createContext({
    resolveCanonicalState, canonicalApplicationStates: () => STATES,
  });
  vm.runInContext([
    sourceOf('getMarkdownTableRowNumber'),
    sourceOf('trackerStatusCellIndex'),
    sourceOf('setApplicationStatusesInMarkdown'),
  ].join('\n'), ctx);
  return ctx;
}

test('states.yml: Started sits between Evaluated and Applied', () => {
  const labels = STATES.map(s => s.label);
  assert.equal(labels.indexOf('Started'), labels.indexOf('Evaluated') + 1);
  assert.equal(labels.indexOf('Applied'), labels.indexOf('Started') + 1);
  assert.equal(resolveCanonicalState('started', STATES), 'Started');
  assert.equal(resolveCanonicalState('In progress', STATES), 'Started');
});

test('hand-written status lists carry every state, and the subset lists know Started', () => {
  const quoted = (block) => new Set([...block.matchAll(/'([^']+)'/g)].map(m => m[1]));
  const block = (file, re) => readFileSync(join(ROOT, file), 'utf8').match(re)?.[1] || '';
  const labels = STATES.map(s => s.label);
  const full = [
    ['merge-tracker.mjs', /const CANONICAL_STATES = \[([^\]]*)\]/, labels],
    ['stats.mjs', /const CANONICAL_STATUSES = \[([^\]]*)\]/, labels],
    ['normalize-statuses.mjs', /const canonical = \[([^\]]*)\]/, labels],
    ['verify-pipeline.mjs', /const CANONICAL_STATUSES = \[([^\]]*)\]/, STATES.map(s => s.id)],
    ['analyze-patterns.mjs', /const FUNNEL_ORDER = \[([^\]]*)\]/, STATES.map(s => s.id)],
  ];
  for (const [file, re, want] of full) {
    const have = quoted(block(file, re));
    const missing = want.filter(w => !have.has(w));
    assert.deepEqual(missing, [], `${file} lists every state`);
  }
  // Lists that hold some states on purpose, but must place Started.
  assert.match(block('purge-stale.mjs', /const KEPT_STATUSES = new Set\(\[([^\]]*)\]/), /'started'/);
  assert.match(block('dedup-tracker.mjs', /const STATUS_RANK = \{([\s\S]*?)\};/), /'started': 2\.5/);
  assert.match(block('invite-match.mjs', /const STATUS_PRIORITY = \{([\s\S]*?)\};/), /started: 2\.5/);
  for (const file of ['merge-tracker.mjs', 'verify-pipeline.mjs', 'tracker-sync-check.mjs']) {
    assert.match(readFileSync(join(ROOT, file), 'utf8'), /'en cours': '[Ss]tarted'/, `${file} knows the Started aliases`);
  }
});

test('the tracker writer moves a row only from the canonical states it is told to', () => {
  const ctx = setterContext();
  const set = (num, onlyFrom) => plain(ctx.setApplicationStatusesInMarkdown(TRACKER, new Set([String(num)]), 'Started', { onlyFrom }));

  const moved = set(7, ['Evaluated']);
  assert.equal(moved.updated, true);
  assert.match(moved.content, /\| 7 \|.*\| Started \|/);
  assert.deepEqual(moved.changes, [{ num: 7, from: 'Evaluated', to: 'Started' }]);
  assert.equal(set(8, ['Evaluated']).updated, false, 'an Applied row is never walked back to Started');
  assert.equal(set(9, ['Evaluated']).updated, false, 'a Started row is left alone');
  assert.equal(set(10, ['Evaluated']).updated, true, 'an alias states.yml resolves to Evaluated moves too');
  // Without onlyFrom the writer behaves as before: the row is set.
  assert.equal(set(8).updated, true);
});

test('the tracker writer reads the Status column from the header (Via layout)', () => {
  const ctx = setterContext();
  const via = [
    '| # | Date | Company | Via | Role | Score | Status | PDF | Report | Notes |',
    '|---|---|---|---|---|---|---|---|---|---|',
    '| 7 | 2026-10-18 | Acme | Hays | Designer | 4.0/5 | Evaluated | ❌ | [7](x) |  |',
  ].join('\n');
  const out = plain(ctx.setApplicationStatusesInMarkdown(via, new Set(['7']), 'Started', { onlyFrom: ['Evaluated'] }));
  assert.equal(out.updated, true);
  assert.match(out.content, /\| 4\.0\/5 \| Started \|/, 'the Score cell is untouched');
});

test('tracker writes run one at a time, so concurrent writes both land', async () => {
  let file = TRACKER;
  const logged = [];
  const ctx = vm.createContext({
    resolveCanonicalState, canonicalApplicationStates: () => STATES,
    join, WRITE_ROOT: '/w', Promise, Set, Number, String,
    // The read and the replace are split by a tick, as a real lock wait would be.
    openTrackerTransaction: async () => ({
      read: () => file,
      replace: (content) => { file = content; },
      close: () => null,
    }),
    logApplicationStatusChanges: async (changes) => { logged.push(...changes); },
  });
  vm.runInContext([
    'let trackerWriteQueue = Promise.resolve();',
    sourceOf('getMarkdownTableRowNumber'),
    sourceOf('trackerStatusCellIndex'),
    sourceOf('setApplicationStatusesInMarkdown'),
    sourceOf('writeMarkdownApplicationStatuses'),
    sourceOf('writeMarkdownApplicationStatus'),
  ].join('\n'), ctx);
  const [a, b] = await Promise.all([
    ctx.writeMarkdownApplicationStatus(7, 'Applied', { via: 'ui-mark-applied' }),
    ctx.writeMarkdownApplicationStatus(10, 'Applied', { via: 'ui-mark-applied' }),
  ]);
  assert.equal(a, true);
  assert.equal(b, true);
  assert.match(file, /\| 7 \|.*\| Applied \|/);
  assert.match(file, /\| 10 \|.*\| Applied \|/);
  assert.equal(logged.length, 2);
});

// A stand-in for supabase-js update(): rows come back only after .select(),
// as with the real client; `error` makes every call fail.
function fakeSupabase(rows, calls, { error = null } = {}) {
  return {
    from(table) {
      const filters = [];
      let payload = null;
      let selected = false;
      const builder = {
        update(p) { payload = p; return builder; },
        eq(column, value) { filters.push(['eq', column, value]); return builder; },
        in(column, values) { filters.push(['in', column, [...values]]); return builder; },
        select() { selected = true; return builder; },
        then(resolve, reject) {
          calls.push({ table, payload, filters: plain(filters) });
          if (error) return Promise.resolve({ data: null, error }).then(resolve, reject);
          const hit = rows.filter(row => filters.every(([op, column, value]) => (op === 'eq' ? row[column] === value : value.includes(row[column]))));
          hit.forEach(row => Object.assign(row, payload));
          return Promise.resolve({ data: selected ? hit.map(row => ({ num: row.num })) : null, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

function statusMovesIn({ rows = [], owner = true, error = null } = {}) {
  const calls = [];
  const writes = [];
  const ctx = vm.createContext({
    useSupabase: true,
    supabase: fakeSupabase(rows, calls, { error }),
    canonicalApplicationStates: () => STATES,
    ownsLocalData: async () => owner,
    writeMarkdownApplicationStatus: async (...args) => { writes.push(plain(args)); return true; },
    console: { warn() {} },
  });
  vm.runInContext([
    sourceOf('statusSpellings'),
    sourceOf('moveApplicationStatus'),
    sourceOf('markApplyStarted'),
    sourceOf('markApplySent'),
  ].join('\n'), ctx);
  return { ctx, calls, writes };
}

test('markApplyStarted: only Evaluated rows turn Started, and the owner tracker follows', async () => {
  const rows = [
    { num: 7, user_id: 'u1', status: 'Evaluated' },
    { num: 8, user_id: 'u1', status: 'Applied' },
  ];
  const { ctx, calls, writes } = statusMovesIn({ rows });
  await ctx.markApplyStarted({ num: 7, userId: 'u1', runId: 'r1' });
  await ctx.markApplyStarted({ num: 8, userId: 'u1', runId: 'r2' });
  assert.equal(rows[0].status, 'Started');
  assert.equal(rows[1].status, 'Applied', 'an Applied row stays Applied');
  const inFilter = calls[0].filters.find(([op]) => op === 'in');
  assert.ok(inFilter[2].includes('Evaluated') && inFilter[2].includes('Evaluada') && !inFilter[2].includes('Applied'));
  assert.deepEqual(writes[0], [7, 'Started', { via: 'apply-start', runId: 'r1' }, { onlyFrom: ['Evaluated'] }]);
});

test('markApplySent: Started or Evaluated rows turn Applied, later states stay', async () => {
  const rows = [
    { num: 7, user_id: 'u1', status: 'Started' },
    { num: 8, user_id: 'u1', status: 'Rejected' },
  ];
  const { ctx, writes } = statusMovesIn({ rows });
  await ctx.markApplySent({ num: 7, userId: 'u1', runId: 'r1' });
  await ctx.markApplySent({ num: 8, userId: 'u1', runId: 'r2' });
  assert.equal(rows[0].status, 'Applied');
  assert.equal(rows[1].status, 'Rejected');
  assert.deepEqual(writes[0], [7, 'Applied', { via: 'apply-sent', runId: 'r1' }, { onlyFrom: ['Evaluated', 'Started'] }]);
});

test("another account: Supabase only, and the answer says whether its row moved", async () => {
  const rows = [{ num: 7, user_id: 'u2', status: 'Evaluated' }];
  const moved = statusMovesIn({ rows, owner: false });
  assert.equal(await moved.ctx.markApplyStarted({ num: 7, userId: 'u2', runId: 'r1' }), true);
  assert.deepEqual(moved.writes, []);
  const failed = statusMovesIn({ rows: [{ num: 7, user_id: 'u2', status: 'Evaluated' }], owner: false, error: { message: 'boom' } });
  assert.equal(await failed.ctx.markApplyStarted({ num: 7, userId: 'u2', runId: 'r1' }), false);
});

test('status moves ignore a missing or bad row number', async () => {
  const { ctx, calls, writes } = statusMovesIn();
  for (const num of [undefined, 'abc', 0]) assert.equal(await ctx.markApplyStarted({ num }), false);
  assert.deepEqual(calls, []);
  assert.deepEqual(writes, []);
});

test('the start route records the row, marks it Started alongside the launch, and Applied on a plugin send', () => {
  const start = routeBlock("if (path === '/api/apply/start' && method === 'POST')");
  assert.ok(start.includes('JSON.stringify({ userId: req.userId || null, at: new Date().toISOString(), num, report })'));
  assert.ok(start.includes('const startedMark = num ? markApplyStarted({ num, userId: req.userId, runId })'));
  assert.equal(start.split('started: await startedMark,').length - 1, 2, 'both browser modes report it');
  assert.ok(start.includes("state.state === 'submitted' && !applyRunUnconfirmed(state)"));
  assert.ok(start.includes('startedMark.then(() => markApplySent({ num, userId: req.userId, runId }))'));
});

test('the bulk stale sweep only discards rows still Evaluated', () => {
  const bulk = routeBlock("if (path === '/api/applications/bulk-discard-stale' && method === 'POST')");
  assert.ok(bulk.includes("const sweepFrom = ['Evaluated'];"));
  assert.ok(bulk.includes('rows = (data || []).filter(row => sweepFrom.includes(resolveCanonicalState(row.status, states)));'));
  assert.ok(bulk.includes("await writeMarkdownApplicationStatuses(nums, 'Discarded', source, { onlyFrom: sweepFrom })"));
});

test('last runs: newest run per report, unconfirmed sends flagged, missing owner.json remembered', async () => {
  const root = mkdtempSync(join(tmpdir(), 'last-runs-'));
  try {
    const run = (id, owner, spec, state) => {
      const dir = join(root, 'scratch/apply-runs', id);
      mkdirSync(dir, { recursive: true });
      if (owner) writeFileSync(join(dir, 'owner.json'), JSON.stringify(owner));
      if (spec) writeFileSync(join(dir, 'spec.json'), JSON.stringify(spec, null, 2));
      if (state) writeFileSync(join(dir, 'state.json'), JSON.stringify(state));
      return dir;
    };
    // Older run: the report is only in spec.json.
    run('a-old', { userId: null, at: '2026-10-17T10:00:00Z' },
      { company: 'Acme', report: '7-acme.md', cvMarkdown: 'x'.repeat(100000) },
      { state: 'aborted', message: 'Stopped after 6 hours with no action.', pending: [] });
    // Newer run of the same report: the report is in owner.json.
    run('b-new', { userId: null, at: '2026-10-18T03:00:00Z', num: 7, report: '7-acme.md' }, { report: '7-acme.md' },
      { state: 'needs_human', message: 'Form — 11 filled, 4 left.', pending: [{}, {}, {}, {}], updatedAt: '2026-10-18T03:01:00Z' });
    // Probably sent, never confirmed (Playwright runner).
    run('c-unconfirmed', { userId: null, at: '2026-10-18T04:00:00Z', report: '9-gamma.md' }, { report: '9-gamma.md' },
      { state: 'submitted', unconfirmed: true, message: '📨 Candidature probablement envoyée — pas de message de confirmation détecté.' });
    // No state yet: skipped. No owner.json and an hour old: remembered as nothing.
    run('d-nostate', { userId: null, at: '2026-10-18T05:00:00Z', report: '10-delta.md' }, { report: '10-delta.md' }, null);
    const legacy = run('e-legacy', null, { report: '11-old.md' }, { state: 'submitted' });
    const hourAgo = new Date(Date.now() - 3600_000);
    utimesSync(legacy, hourAgo, hourAgo);

    const ctx = vm.createContext({
      ROOT: root, join, readdir, readFile, stat, JSON, String, Array, Object, Promise, Date,
      applyRunMetaCache: new Map(),
      applyRunVisibleTo: async () => true,
    });
    vm.runInContext([sourceOf('applyRunMeta'), sourceOf('applyRunUnconfirmed'), sourceOf('latestApplyRunsByReport')].join('\n'), ctx);
    const runs = plain(await ctx.latestApplyRunsByReport('u1'));
    assert.deepEqual(Object.keys(runs).sort(), ['7-acme.md', '9-gamma.md']);
    assert.equal(runs['7-acme.md'].runId, 'b-new');
    assert.equal(runs['7-acme.md'].pending, 4);
    assert.equal(runs['7-acme.md'].unconfirmed, false);
    assert.equal(runs['9-gamma.md'].unconfirmed, true);
    assert.equal(ctx.applyRunMetaCache.get(legacy), null, 'an old folder without owner.json is not read again');
    assert.equal(ctx.applyRunMetaCache.get(join(root, 'scratch/apply-runs', 'a-old')).report, '7-acme.md');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('applyRunVisibleTo uses the owner.json it is handed', async () => {
  const ctx = vm.createContext({
    useSupabase: true,
    ownsLocalData: async () => false,
    readFile: async () => { throw new Error('must not read owner.json again'); },
    join, JSON, Boolean,
  });
  vm.runInContext(sourceOf('applyRunVisibleTo'), ctx);
  assert.equal(await ctx.applyRunVisibleTo('/run', 'u1', { userId: 'u1' }), true);
  assert.equal(await ctx.applyRunVisibleTo('/run', 'u2', { userId: 'u1' }), false);
});

test('dashboard: unconfirmed sends stay Started, Started rows stay out of select-all and the stale sweep', () => {
  assert.ok(page.includes("'Started':   'badge-started',"));
  assert.ok(page.includes('.badge-started {'));
  assert.ok(page.includes("const selectAllTakes = a => canQueueApply(a) && (state.filter === 'Started' || !isStartedStatus(a.Status));"));
  assert.ok(page.includes('isOlderThan14Days(item.Date) && canDeleteApplication(item.Status) && !isStartedStatus(item.Status)'));
  assert.ok(page.includes("if (s.state === 'submitted' && !unconfirmed && !appliedMarked && app.num) {"));
  assert.ok(page.includes('if (num && !isUnconfirmedSend(status)) {'));
  assert.ok(page.includes('num: app.num || undefined,'));
  assert.ok(page.includes("api('/api/apply/last-runs')"));
});

test('dashboard: the apply note reads both runners and dead runs', () => {
  const labels = vm.runInNewContext(`(${page.match(/const AUTO_APPLY_STATE_LABELS = (\{[\s\S]*?\n\});/)[1]})`);
  const ctx = vm.createContext({ AUTO_APPLY_STATE_LABELS: labels, Date });
  vm.runInContext([
    sourceOf('isUnconfirmedSend', page),
    page.match(/const APPLY_RUN_LIVE_STATES = .*;/)[0],
    page.match(/const APPLY_RUN_STALE_MS = .*;/)[0],
    sourceOf('applyRunSummary', page),
  ].join('\n'), ctx);
  const say = run => ctx.applyRunSummary(run);
  assert.equal(say({ state: 'submitted', unconfirmed: true, message: '' }), 'Apply · send not confirmed');
  assert.equal(say({ state: 'submitted', message: '📨 Candidature probablement envoyée' }), 'Apply · send not confirmed');
  assert.equal(say({ state: 'submitted', message: 'Application sent.' }), 'Apply · application sent');
  assert.equal(say({ state: 'aborted', message: 'Suivi arrêté après 6 h sans action — la fenêtre Chrome se ferme.' }), 'Apply · stopped, no action');
  assert.equal(say({ state: 'needs_human', message: '⚠️ Envoi refusé — 2 champ(s) invalide(s)', pending: 2 }), 'Apply · the form refused the send');
  assert.equal(say({ state: 'needs_human', message: 'Form — 11 filled, 4 left.', pending: 4 }), 'Apply · 4 fields left to fill');
  assert.equal(say({ state: 'filling', message: '', updatedAt: '2026-01-01T00:00:00Z' }), 'Apply · stopped');
  assert.equal(say({ state: 'aborted', message: 'Application cancelled.' }), 'Apply · cancelled');
});
