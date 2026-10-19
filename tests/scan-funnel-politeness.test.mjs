import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanFetchUrl, retryPolicy, backoffDelayMs } from '../lib/fetch-politeness.mjs';
import { createFunnel, countBy } from '../lib/scan-funnel.mjs';

test('utm and click-id params are stripped from fetch URLs, functional ones kept', () => {
  assert.equal(cleanFetchUrl('https://yoailabs.careers-page.com/jobs/b7e44713-1293-45c4-b8d6-9aa752e0fdf4?utm_medium=free_job_board&utm_source=linkedin'), 'https://yoailabs.careers-page.com/jobs/b7e44713-1293-45c4-b8d6-9aa752e0fdf4');
  assert.equal(cleanFetchUrl('https://boards.greenhouse.io/x/jobs/1?gh_jid=123&utm_campaign=a&gclid=z'), 'https://boards.greenhouse.io/x/jobs/1?gh_jid=123');
  assert.equal(cleanFetchUrl('not a url'), 'not a url');
});

test('careers-page.com gets a longer retry policy than other hosts', () => {
  assert.ok(retryPolicy('https://yoailabs.careers-page.com/jobs/x').attempts > retryPolicy('https://example.com/x').attempts);
  assert.ok(retryPolicy('https://www.careers-page.com/bukalapak').baseMs > retryPolicy('https://example.com').baseMs);
  assert.equal(retryPolicy('https://notcareers-page.com/x').attempts, 2);
});

test('backoff grows, is jittered, honours Retry-After and is capped', () => {
  const lo = backoffDelayMs(1, { baseMs: 1000, rand: () => 0 });
  const hi = backoffDelayMs(1, { baseMs: 1000, rand: () => 1 });
  assert.ok(lo >= 750 && hi <= 1250 && lo < hi);
  assert.ok(backoffDelayMs(3, { baseMs: 1000, rand: () => 0.5 }) > backoffDelayMs(1, { baseMs: 1000, rand: () => 0.5 }));
  assert.equal(backoffDelayMs(1, { baseMs: 1000, retryAfter: '7', rand: () => 0 }), 7000);
  assert.equal(backoffDelayMs(9, { baseMs: 5000, maxMs: 20000, rand: () => 1 }), 20000);
});

test('funnel shows per-stage counts, losses and reasons', () => {
  const f = createFunnel();
  f.stage('found', 100);
  f.stage('decision', 20, countBy([{ reasonCode: 'title' }, { reasonCode: 'title' }, { reasonCode: 'age' }], c => c.reasonCode));
  f.stage('jev', 1);
  const out = f.format();
  assert.match(out, /found=100 -> decision=20 \(-80\) \[title=2 age=1\] -> jev=1 \(-19\)/);
  assert.equal(f.stages().length, 3);
});