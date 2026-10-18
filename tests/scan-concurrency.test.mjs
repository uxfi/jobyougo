// The UI scan fanned out to every API board at once, and one fetch that never
// settled held the whole scan forever. settleWithLimit bounds the fan-out and
// gives each source a deadline (lib/scan-concurrency.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { settleWithLimit, SourceDeadlineError } from '../lib/scan-concurrency.mjs';

const wait = (ms, value) => new Promise(resolve => setTimeout(resolve, ms, value));

test('keeps allSettled shape and input order', async () => {
  const results = await settleWithLimit([30, 5, 15], async (ms, i) => {
    await wait(ms);
    if (i === 1) throw new Error('boom');
    return ms;
  }, { limit: 2 });
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[0].value, 30);
  assert.equal(results[1].status, 'rejected');
  assert.equal(results[1].reason.message, 'boom');
  assert.equal(results[2].value, 15);
});

test('never runs more than limit workers at once', async () => {
  let running = 0;
  let peak = 0;
  await settleWithLimit(Array.from({ length: 20 }, (_, i) => i), async () => {
    running++;
    peak = Math.max(peak, running);
    await wait(5);
    running--;
  }, { limit: 4 });
  assert.equal(peak, 4);
});

test('a worker that never settles is cut at its deadline and frees its slot', async () => {
  const timedOut = [];
  const started = Date.now();
  const results = await settleWithLimit(['hang', 'a', 'b'], name =>
    name === 'hang' ? new Promise(() => {}) : wait(5, name), {
    limit: 1,
    deadlineMs: 60,
    onDeadline: name => timedOut.push(name),
  });
  assert.ok(Date.now() - started < 1000);
  assert.equal(results[0].status, 'rejected');
  assert.ok(results[0].reason instanceof SourceDeadlineError);
  assert.deepEqual(timedOut, ['hang']);
  assert.equal(results[1].value, 'a');
  assert.equal(results[2].value, 'b');
});

test('a late rejection from an abandoned worker is swallowed', async () => {
  let unhandled = null;
  const onUnhandled = reason => { unhandled = reason; };
  process.on('unhandledRejection', onUnhandled);
  try {
    await settleWithLimit([1], () => wait(40).then(() => { throw new Error('late'); }), { deadlineMs: 10 });
    await wait(60);
    assert.equal(unhandled, null);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('empty input resolves to an empty array', async () => {
  assert.deepEqual(await settleWithLimit([], async () => 1, { limit: 5 }), []);
});
