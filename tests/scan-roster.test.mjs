import test from 'node:test';
import assert from 'node:assert/strict';
import { prioritizeScanRoster, rosterSignals } from '../lib/scan-roster.mjs';
import { resolveConfiguredMaxAgeDays } from '../scan.mjs';

test('resolveConfiguredMaxAgeDays prefers scan_max_age_days over the CLI legacy key', () => {
  assert.equal(resolveConfiguredMaxAgeDays({ scan_max_age_days: 7, max_posting_age_days: 45 }), 7);
  assert.equal(resolveConfiguredMaxAgeDays({ max_posting_age_days: 45 }), 45);
  assert.equal(resolveConfiguredMaxAgeDays({}), null);
});

test('rosterSignals ranks explicit remote and allowed geo above an ambiguous offer', () => {
  const explicit = rosterSignals(
    { title: 'AI Product Manager', publishedAt: '2026-09-20' },
    { reason: 'matched required remote term "remote" and allowed geo "europe"' },
  );
  const ambiguous = rosterSignals(
    { title: 'AI Product Manager' },
    { reason: 'remote status is ambiguous' },
  );
  assert.ok(explicit.rank > ambiguous.rank);
  assert.ok(explicit.freshness > 0);
  assert.equal(ambiguous.freshness, 0);
});

test('prioritizeScanRoster caps a fast source at half until the rest of the pool is used', () => {
  const fast = Array.from({ length: 80 }, (_, i) => ({
    source: 'api',
    title: `Fast ${i}`,
    url: `https://example.com/fast/${i}`,
    publishedAt: '',
  }));
  const slow = Array.from({ length: 30 }, (_, i) => ({
    source: 'playwright',
    title: `Slow ${i}`,
    url: `https://example.com/slow/${i}`,
    publishedAt: '2026-09-20',
  }));
  const roster = prioritizeScanRoster([...fast, ...slow], {
    limit: 120,
    scoreOf: (candidate) => rosterSignals(
      candidate,
      candidate.source === 'playwright'
        ? { reason: 'matched required remote term "remote" and allowed geo "europe"' }
        : { reason: 'remote status is ambiguous' },
    ),
  });
  assert.equal(roster.length, 110);
  assert.equal(roster.filter(c => c.source === 'playwright').length, 30);
  assert.equal(roster.filter(c => c.source === 'api').length, 80);
  assert.ok(roster.slice(0, 30).every(c => c.source === 'playwright'));
});

test('prioritizeScanRoster does not let one source occupy the whole cap while others remain', () => {
  const fast = Array.from({ length: 200 }, (_, i) => ({
    source: 'api',
    title: `Fast ${i}`,
    url: `https://example.com/a/${i}`,
  }));
  const other = Array.from({ length: 70 }, (_, i) => ({
    source: 'board',
    title: `Board ${i}`,
    url: `https://example.com/b/${i}`,
  }));
  const roster = prioritizeScanRoster([...fast, ...other], {
    limit: 120,
    scoreOf: () => ({ rank: 1, freshness: 0 }),
  });
  assert.equal(roster.length, 120);
  assert.equal(roster.filter(c => c.source === 'api').length, 60);
  assert.equal(roster.filter(c => c.source === 'board').length, 60);
});
