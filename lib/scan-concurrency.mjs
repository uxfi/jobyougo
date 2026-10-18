/**
 * scan-concurrency.mjs — bounded, deadline-guarded fan-out for the scan.
 *
 * The UI scan used to start every API board at once (Promise.all over ~280
 * Greenhouse/Ashby/Lever sources). Hundreds of multi-MB downloads in parallel
 * pushed bodies past their timeout, and a fetch that never settled held the
 * whole scan forever, since nothing after the fan-out runs until every source
 * is done.
 *
 * settleWithLimit runs at most `limit` workers at a time and gives each one a
 * hard deadline. A source past its deadline is reported as rejected and frees
 * its slot; its promise is left to finish in the background and ignored.
 * The result has Promise.allSettled's shape and order, so callers keep their
 * existing `status === 'fulfilled'` handling.
 */

export class SourceDeadlineError extends Error {
  constructor(ms) {
    super(`no answer after ${Math.round(ms / 1000)}s`);
    this.name = 'SourceDeadlineError';
    this.deadlineMs = ms;
  }
}

/**
 * @template T, R
 * @param {T[]} items
 * @param {(item: T, index: number) => Promise<R>} worker
 * @param {{ limit?: number, deadlineMs?: number, onDeadline?: (item: T, ms: number) => void }} [options]
 * @returns {Promise<PromiseSettledResult<R>[]>}
 */
export async function settleWithLimit(items, worker, { limit = 8, deadlineMs = 0, onDeadline } = {}) {
  const list = Array.from(items || []);
  const results = new Array(list.length);
  const width = Math.max(1, Math.min(Math.floor(limit) || 1, list.length));
  let next = 0;

  const runOne = async (index) => {
    const item = list[index];
    let timer = null;
    const work = Promise.resolve().then(() => worker(item, index));
    const guarded = deadlineMs > 0
      ? Promise.race([
          work,
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              try { onDeadline?.(item, deadlineMs); } catch {}
              reject(new SourceDeadlineError(deadlineMs));
            }, deadlineMs);
          }),
        ])
      : work;
    // A late rejection from an abandoned worker must not surface as unhandled.
    work.catch(() => {});
    try {
      results[index] = { status: 'fulfilled', value: await guarded };
    } catch (reason) {
      results[index] = { status: 'rejected', reason };
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const lanes = Array.from({ length: list.length ? width : 0 }, async () => {
    while (next < list.length) await runOne(next++);
  });
  await Promise.all(lanes);
  return results;
}
