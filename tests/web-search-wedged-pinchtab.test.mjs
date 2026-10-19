// A PinchTab that cannot open tabs must stop the web-search pass at the first
// engine, not after 8 queries × 3 engines of timeouts. Runs the server's own
// circuit code in a vm (importing ui/server.mjs would start the server).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { ROOT } from './helpers.mjs';
import { createEngineBackoff, createQuerySpacer } from '../lib/scan-engine-backoff.mjs';
import { createCircuitProbe } from '../lib/web-search-circuit-probe.mjs';
import { serpDiagnostic } from '../lib/serp-page-check.mjs';

const source = readFileSync(join(ROOT, 'ui/server.mjs'), 'utf8');
const extract = (start, end) => {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `missing ${start}`);
  return source.slice(from, source.indexOf(end, from));
};

function load(engines) {
  const calls = [];
  const context = vm.createContext({
    console: { log() {}, warn() {} },
    process: { env: { SCAN_QUERY_SPACING_MS: '0' } },
    createEngineBackoff,
    createQuerySpacer,
    createCircuitProbe,
    serpDiagnostic,
    Number,
    Math,
    webSearchConfig: { engines: Object.keys(engines), minResults: 15 },
    PINCHTAB_SEARCH_ENGINES: Object.fromEntries(Object.entries(engines).map(([id, result]) => [id, async () => { calls.push(id); return typeof result === 'function' ? result() : result; }])),
    isWebSearchEngineBlocked: result => Boolean(result?.error),
    normalizeUrlKey: url => url,
    cleanString: value => String(value || ''),
    buildJobSection: () => 'section',
    portalsTitleFilter: { test: () => true },
  });
  vm.runInContext(`${extract('let _webSearchConsecFail', '\n// Whether an engine attempt')}
${extract('const ENGINE_DEAD_AFTER', '\n// Run the configured PinchTab engines')}
${extract('async function fetchPinchtabEnginesMerged(', '\nfunction buildTheirStackPayload(')}
this.api = { fetchPinchtabEnginesMerged, webSearchCircuitOpen };`, context);
  return { ...context.api, calls };
}

test('a wedged PinchTab trips the web-search circuit at the first engine', async () => {
  const wedged = { ok: false, jobs: [], engine: 'pinchtab-brave', error: 'pinchtab POST /navigate → HTTP 500: browser did not open a new tab within 10s — it may be out of memory or overloaded' };
  const { fetchPinchtabEnginesMerged, webSearchCircuitOpen, calls } = load({ brave: wedged, duckduckgo: { ok: true, jobs: [{ url: 'https://x/1', title: 'Designer' }] } });
  const result = await fetchPinchtabEnginesMerged({ name: 'q', query: 'q' });
  assert.equal(result.ok, false);
  assert.deepEqual(calls, ['brave']);
  assert.equal(webSearchCircuitOpen(), true);
});

test('an ordinary challenge page still falls through to the next engine', async () => {
  const { fetchPinchtabEnginesMerged, webSearchCircuitOpen, calls } = load({
    brave: { ok: false, jobs: [], error: 'challenge page' },
    duckduckgo: { ok: true, jobs: [{ url: 'https://x/1', title: 'Designer' }] },
  });
  const result = await fetchPinchtabEnginesMerged({ name: 'q', query: 'q' });
  assert.equal(result.jobs.length, 1);
  assert.deepEqual(calls, ['brave', 'duckduckgo']);
  assert.equal(webSearchCircuitOpen(), false);
});

test('queries that merge nothing trip the circuit even when one engine loads empty', async () => {
  const { fetchPinchtabEnginesMerged, webSearchCircuitOpen } = load({
    brave: { ok: false, jobs: [], error: 'challenge page' },
    duckduckgo: { ok: false, jobs: [] },
    google: { ok: false, jobs: [], error: 'challenge page' },
  });
  for (let i = 0; i < 7; i++) await fetchPinchtabEnginesMerged({ name: `q${i}`, query: 'q' });
  assert.equal(webSearchCircuitOpen(), false);
  await fetchPinchtabEnginesMerged({ name: 'q7', query: 'q' });
  assert.equal(webSearchCircuitOpen(), true);
});

test('clean 0-hit answers from every engine never trip the circuit', async () => {
  const { fetchPinchtabEnginesMerged, webSearchCircuitOpen } = load({
    brave: { ok: false, jobs: [] },
    duckduckgo: { ok: false, jobs: [] },
  });
  for (let i = 0; i < 12; i++) await fetchPinchtabEnginesMerged({ name: `q${i}`, query: 'q' });
  assert.equal(webSearchCircuitOpen(), false);
});

test('one query with results resets the empty streak', async () => {
  let hits = false;
  const { fetchPinchtabEnginesMerged, webSearchCircuitOpen } = load({
    brave: { ok: false, jobs: [], error: 'challenge page' },
    duckduckgo: () => (hits ? { ok: true, jobs: [{ url: 'https://x/1', title: 'Designer' }] } : { ok: false, jobs: [] }),
  });
  for (let i = 0; i < 7; i++) await fetchPinchtabEnginesMerged({ name: `q${i}`, query: 'q' });
  hits = true;
  await fetchPinchtabEnginesMerged({ name: 'hit', query: 'q' });
  hits = false;
  for (let i = 0; i < 7; i++) await fetchPinchtabEnginesMerged({ name: `r${i}`, query: 'q' });
  assert.equal(webSearchCircuitOpen(), false);
});
