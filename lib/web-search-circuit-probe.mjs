// Web-search circuit breaker, half-open: after it trips, the run does not
// give up the remaining queries for good when an engine was only resting
// (Brave's 70 s challenge cooldown, 2026-10-19: 68 queries skipped while
// Brave would have answered a minute later). Up to `maxProbes` times in a row
// it waits for the cooldown of the engine that actually answers (capped) and
// lets one query through; a good answer closes the circuit, a bad one
// re-opens it.
export function createCircuitProbe({ maxProbes = 2, maxWaitMs = 150000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let probes = 0;
  let wedged = false;
  return {
    reset() { probes = 0; wedged = false; },
    markWedged() { wedged = true; },
    get wedged() { return wedged; },
    /** A query got a real answer: the probes that came before it no longer count. */
    ok() { probes = 0; },
    get probes() { return probes; },
    /**
     * @param {number[]} cooldownsMs remaining cooldown per engine worth waiting for (0 = ready)
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

/**
 * How long a query should wait before it starts, so it is not spent on a wall.
 * 2026-10-21: Brave was the only engine returning anything and rested ~60 s
 * after each challenge; the queries that arrived meanwhile failed within
 * milliseconds ("every web-search engine is resting") and were lost, among
 * them one of the best ATS-wide queries. When every engine that has answered
 * in this run is resting, waiting for the first one to come back is cheaper
 * than losing the query. 0 when one of them is ready, when none has answered
 * yet, or when the rest is longer than `maxWaitMs` (the half-open probe and the
 * replay then take over).
 *
 * @param {string[]} engines configured engine ids
 * @param {(id: string) => number} remainingMs remaining cooldown of an engine
 * @param {Set<string>} answered engines that returned at least one result this run
 * @returns {number}
 */
export function cooldownWaitMs(engines = [], remainingMs = () => 0, answered = new Set(), { maxWaitMs = 150000 } = {}) {
  const answering = engines.filter((id) => answered.has(id));
  if (!answering.length) return 0;
  const rest = answering.map((id) => Math.max(0, Number(remainingMs(id)) || 0));
  if (rest.some((ms) => ms === 0)) return 0;
  const wait = Math.min(...rest);
  return wait <= maxWaitMs ? wait : 0;
}

/**
 * Cooldowns the half-open probe should wait for. An engine that answers "0
 * results" to every query (DuckDuckGo, Google on 2026-10-21) is never put on
 * a cooldown, so its 0 used to win the "shortest cooldown" and both probes
 * fired within 5 s while Brave still rested for 67 s. Only engines that gave
 * results during this run count; if none did, only the engines that really
 * are cooling count, so the probe never fires straight into a wall.
 *
 * @param {string[]} engines configured engine ids
 * @param {(id: string) => number} remainingMs remaining cooldown of an engine
 * @param {Set<string>} answered engines that returned at least one result this run
 * @returns {number[]}
 */
export function probeCooldowns(engines = [], remainingMs = () => 0, answered = new Set()) {
  const useful = engines.filter((id) => answered.has(id));
  if (useful.length) return useful.map((id) => remainingMs(id));
  const cooling = engines.map((id) => remainingMs(id)).filter((ms) => ms > 0);
  return cooling.length ? cooling : [0];
}
