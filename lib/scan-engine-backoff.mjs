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
