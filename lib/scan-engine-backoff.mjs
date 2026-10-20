/**
 * Per-engine cooldown for the web-search engines (Brave challenge, Google
 * captcha, DuckDuckGo empty): each failure rests the engine for baseMs x 2^n
 * (capped) with jitter; one success clears it. A resting engine is skipped
 * without a request, so a query never waits on a wall.
 */
export function createEngineBackoff({ baseMs = 60000, maxMs = 15 * 60 * 1000, jitter = 0.25, now = () => Date.now(), rand = Math.random } = {}) {
  const state = new Map();
  return {
    fail(id) {
      const s = state.get(id) || { fails: 0, until: 0 };
      s.fails += 1;
      const raw = Math.min(maxMs, baseMs * 2 ** (s.fails - 1));
      s.until = now() + Math.round(raw * (1 - jitter + rand() * 2 * jitter));
      state.set(id, s);
      return s.until - now();
    },
    ok(id) { state.delete(id); },
    remainingMs(id) { const s = state.get(id); return s ? Math.max(0, s.until - now()) : 0; },
    cooling(id) { return this.remainingMs(id) > 0; },
    reset() { state.clear(); },
  };
}

/** Slight spacing between queries to the same engines: spacingMs +/- jitter. */
export function createQuerySpacer({ spacingMs = 400, jitter = 0.5, now = () => Date.now(), rand = Math.random, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let last = 0;
  return async function space() {
    if (spacingMs <= 0) return 0;
    const gap = Math.round(spacingMs * (1 - jitter + rand() * 2 * jitter));
    const wait = Math.max(0, last + gap - now());
    if (wait) await sleep(wait);
    last = now();
    return wait;
  };
}

/**
 * Rotation + spacing across web-search engines (2026-10-20: Brave on a
 * captcha, Google paused, DuckDuckGo answering 0 for every query, so each of
 * the 95 queries was burnt in ~3 s). Tracks a per-engine empty streak and
 * rotates which ready engine is asked first. When every engine that is not
 * cooling has answered empty `emptyLimit` times in a row while another engine
 * is cooling, the next query waits for the shortest cooldown (capped) instead
 * of being spent on an engine that only ever returns nothing. It never retries
 * a blocked engine early and never touches a challenge page.
 */
export function createEngineRotation({ emptyLimit = 3, maxWaitMs = 90000 } = {}) {
  const empty = new Map();
  let turn = 0;
  return {
    order(engines = [], backoff) {
      const list = [...engines];
      const ready = list.filter(id => !backoff?.cooling(id));
      const cooling = list.filter(id => backoff?.cooling(id));
      const start = ready.length ? turn % ready.length : 0;
      turn += 1;
      return [...ready.slice(start), ...ready.slice(0, start), ...cooling];
    },
    note(id, added) {
      if (added > 0) empty.delete(id);
      else empty.set(id, (empty.get(id) || 0) + 1);
    },
    emptyStreak(id) { return empty.get(id) || 0; },
    waitMs(engines = [], backoff) {
      const cooling = engines.map(id => backoff?.remainingMs(id) || 0).filter(ms => ms > 0);
      if (!cooling.length) return 0;
      const ready = engines.filter(id => !backoff?.cooling(id));
      if (ready.some(id => (empty.get(id) || 0) < emptyLimit)) return 0;
      return Math.min(maxWaitMs, Math.min(...cooling));
    },
    reset() { empty.clear(); turn = 0; },
  };
}
