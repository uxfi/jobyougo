import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EMPTY_RUNS_BEFORE_SKIP,
  loadQueryYield,
  queryYieldKey,
  recordQueryYield,
  saveQueryYield,
  shouldSkipQuery,
} from '../lib/web-search-yield.mjs';

const Q = 'site:jobs.lever.co ("Product Designer")  remote';

test('a query rests after three empty loaded runs, then gets one retry a week later', () => {
  const store = {};
  for (let i = 0; i < EMPTY_RUNS_BEFORE_SKIP; i += 1) {
    assert.equal(shouldSkipQuery(store, Q, '2026-10-10'), false);
    recordQueryYield(store, Q, { hits: 0 }, '2026-10-10');
  }
  assert.equal(shouldSkipQuery(store, Q, '2026-10-16'), true);
  assert.equal(shouldSkipQuery(store, Q, '2026-10-17'), false);
  recordQueryYield(store, Q, { hits: 0 }, '2026-10-17');
  assert.equal(shouldSkipQuery(store, Q, '2026-10-18'), true);
});

test('one hit resets the count; blocked runs are not counted', () => {
  const store = {};
  recordQueryYield(store, Q, { hits: 0 }, '2026-10-10');
  recordQueryYield(store, Q, { hits: 0 }, '2026-10-10');
  recordQueryYield(store, Q, { hits: 2 }, '2026-10-11');
  recordQueryYield(store, Q, { hits: 0 }, '2026-10-12');
  recordQueryYield(store, Q, { blocked: true }, '2026-10-12');
  recordQueryYield(store, Q, { blocked: true }, '2026-10-12');
  const entry = store[queryYieldKey(Q)];
  assert.deepEqual(entry, { runs: 4, empty: 1, hits: 2, lastRun: '2026-10-12', lastHit: '2026-10-11' });
  assert.equal(shouldSkipQuery(store, Q, '2026-10-12'), false);
});

test('the key ignores case and spacing; a reworded query starts fresh', () => {
  const store = {};
  for (let i = 0; i < EMPTY_RUNS_BEFORE_SKIP; i += 1) recordQueryYield(store, Q, { hits: 0 }, '2026-10-10');
  assert.equal(shouldSkipQuery(store, Q.toUpperCase().replace(/ /g, '   '), '2026-10-11'), true);
  assert.equal(shouldSkipQuery(store, `${Q} Europe`, '2026-10-11'), false);
});

test('save drops entries not run for 60 days and load tolerates a missing file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'yield-'));
  try {
    const path = join(dir, 'web-search-yield.json');
    assert.deepEqual(await loadQueryYield(path), {});
    const store = {};
    recordQueryYield(store, 'old query', { hits: 0 }, '2026-07-01');
    recordQueryYield(store, Q, { hits: 1 }, '2026-10-12');
    await saveQueryYield(path, store, '2026-10-13');
    assert.deepEqual(Object.keys(await loadQueryYield(path)), [queryYieldKey(Q)]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
