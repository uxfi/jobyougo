// Web-search circuit breaker, half-open: after it trips, the run does not
// give up the remaining queries for good when an engine was only resting
// (Brave's 70 s challenge cooldown, 2026-10-19: 68 queries skipped while
// Brave would have answered a minute later). Up to `maxProbes` times per run
// it waits for the shortest engine cooldown (capped) and lets one query
// through; a good answer closes the circuit, a bad one re-opens it.
export function createCircuitProbe({ maxProbes = 2, maxWaitMs = 150000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let probes = 0;
  let wedged = false;
  return {
    reset() { probes = 0; wedged = false; },
    markWedged() { wedged = true; },
    get probes() { return probes; },
    /**
     * @param {number[]} cooldownsMs remaining cooldown per configured engine (0 = ready)
     * @returns {Promise<{ probe: boolean, waitedMs: number, reason: string }>}
     */
    async next(cooldownsMs = []) {
      if (wedged) return { probe: false, waitedMs: 0, reason: 'search browser cannot open tabs' };
      if (probes >= maxProbes) return { probe: false, waitedMs: 0, reason: `circuit-breaker (${probes} probe(s) already failed)` };
      const list = (cooldownsMs || []).map((v) => Math.max(0, Number(v) || 0));
      const wait = list.length ? Math.min(...list) : 0;
      if (wait > maxWaitMs) return { probe: false, waitedMs: 0, reason: `circuit-breaker (engines resting ${Math.round(wait / 1000)}s)` };
      if (wait > 0) await sleep(wait);
      probes += 1;
      return { probe: true, waitedMs: wait, reason: '' };
    },
  };
}