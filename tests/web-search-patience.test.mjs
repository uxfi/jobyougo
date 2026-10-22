// 2026-10-21: Brave was the only web-search engine answering and rested ~60 s after
// each challenge. Queries that arrived meanwhile failed in milliseconds ("every
// web-search engine is resting") and were never retried, among them one of the best
// ATS-wide queries (12 of 95). A query now waits for the engine that has been
// answering, and the ones a rest still cut short are replayed once.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { cooldownWaitMs } from '../lib/web-search-circuit-probe.mjs';

const NL = '\n';
const server = readFileSync(new URL('../ui/server.mjs', import.meta.url), 'utf8');

test('a query waits for the engine that has been answering, not for ones that never do', () => {
  const rest = { brave: 62000, duckduckgo: 0, google: 130000 };
  const remaining = (id) => rest[id];
  const engines = ['brave', 'duckduckgo', 'google'];
  assert.equal(cooldownWaitMs(engines, remaining, new Set()), 0, 'nothing has answered yet: nothing to wait for');
  assert.equal(cooldownWaitMs(engines, remaining, new Set(['brave'])), 62000, 'Brave answered and rests: wait for it, not for DuckDuckGo (always 0) or Google');
  assert.equal(cooldownWaitMs(engines, remaining, new Set(['brave', 'duckduckgo'])), 0, 'an answering engine that is ready serves the query now');
  assert.equal(cooldownWaitMs(engines, remaining, new Set(['brave', 'google'])), 62000, 'the shortest rest among the answering engines');
  assert.equal(cooldownWaitMs(engines, remaining, new Set(['google']), { maxWaitMs: 100000 }), 0, 'longer than the patience cap: no wait (the probe and the replay take over)');
  assert.equal(cooldownWaitMs(engines, remaining, new Set(['google'])), 130000, 'the default cap is 150 s');
  assert.equal(cooldownWaitMs(['brave'], () => 0, new Set(['brave'])), 0);
  assert.equal(cooldownWaitMs(['brave'], () => 0.4, new Set(['brave'])), 0.4, 'a sub-millisecond rest still counts as a rest');
});

function between(startMarker, endMarker) {
  const a = server.indexOf(startMarker);
  const b = server.indexOf(endMarker, a);
  assert.ok(a >= 0 && b > a, `${startMarker} is in the server source`);
  return server.slice(a, b);
}

function loadReplay({ answer, wedged = false, up = true } = {}) {
  const calls = [];
  const ctx = {
    console: { log() {}, warn() {} },
    _webSearchConsecFail: 9,
    webSearchProbe: { wedged },
    pinchtabIsUp: async () => up,
    isWebSearchEngineBlocked: (r) => !r || Boolean(r.error),
    fetchPinchtabEnginesMerged: async (source, opts) => {
      calls.push({ name: source.name, opts });
      return answer(source);
    },
  };
  const code = between('const WEB_SEARCH_REPLAY_MAX', 'async function fetchWebSearchSectionsSequential');
  const api = vm.runInNewContext(`${code}${NL}({ cutShortByPause, replayPausedQueries, WEB_SEARCH_REPLAY_MAX })`, ctx);
  return { ...api, calls, ctx };
}

const good = (name) => ({ ok: true, empty: false, jobs: [{ title: `${name} Product Designer`, url: `https://x.test/${name}` }], engine: 'pinchtab-brave', paused: false });
const paused = { ok: false, jobs: [], engine: 'pinchtab', paused: true, error: 'every web-search engine is resting (brave:cooldown)' };
const ok = (value) => ({ status: 'fulfilled', value });

test('only what a rest cut short is replayed: paused results and circuit skips, not wedged or finished ones', () => {
  const { cutShortByPause } = loadReplay({ answer: () => null });
  assert.equal(cutShortByPause({ paused: true }), true);
  assert.equal(cutShortByPause({ skipped: 'circuit-breaker', note: 'circuit-breaker (engines resting 200s)' }), true);
  assert.equal(cutShortByPause({ skipped: 'circuit-breaker', note: 'search browser cannot open tabs' }), false, 'a PinchTab that cannot open tabs is not a rest');
  assert.equal(cutShortByPause({ ok: true, jobs: [], paused: false }), false);
  assert.equal(cutShortByPause({ ok: false, error: 'HTTP 500' }), false);
  assert.equal(cutShortByPause(null), false);
});

test('each cut-short query is replayed once; a recovered one replaces its result, a still-paused one is kept', async () => {
  const sources = ['A', 'B', 'C', 'D', 'E'].map(name => ({ name, query: `q ${name}` }));
  const before = [ok(good('A')), ok(paused), ok(paused), ok({ ok: false, skipped: 'circuit-breaker', note: 'circuit-breaker (engines resting 200s)', jobs: [] }), { status: 'rejected', reason: new Error('boom') }];
  const results = [...before];
  const { replayPausedQueries, calls, ctx } = loadReplay({ answer: (s) => (s.name === 'C' ? paused : good(s.name)) });
  assert.equal(await replayPausedQueries(sources, results), 2);
  assert.deepEqual(calls.map(c => c.name), ['B', 'C', 'D'], 'one call per cut-short query, none for finished or rejected ones');
  assert.ok(calls.every(c => c.opts.patient === true), 'the replay waits for the engine to come back');
  assert.equal(results[0], before[0]);
  assert.equal(results[1].value.jobs[0].title, 'B Product Designer');
  assert.equal(results[2], before[2], 'still paused: the first result stays');
  assert.equal(results[3].value.jobs[0].title, 'D Product Designer');
  assert.equal(results[4], before[4]);
  assert.equal(ctx._webSearchConsecFail, 0, 'the circuit starts the replay from zero');
  assert.deepEqual(results.map(r => r.status), ['fulfilled', 'fulfilled', 'fulfilled', 'fulfilled', 'rejected'], 'shape and order are unchanged');
});

test('three misses in a row stop the replay; a recovery resets the count', async () => {
  const sources = Array.from({ length: 8 }, (_, i) => ({ name: `Q${i}`, query: `q${i}` }));
  const allPaused = () => sources.map(() => ok(paused));
  let run = loadReplay({ answer: () => paused });
  assert.equal(await run.replayPausedQueries(sources, allPaused()), 0);
  assert.equal(run.calls.length, 3, 'stops after 3 in a row, the engine is still down');

  const hits = new Set(['Q2']);
  run = loadReplay({ answer: (s) => (hits.has(s.name) ? good(s.name) : paused) });
  assert.equal(await run.replayPausedQueries(sources, allPaused()), 1);
  assert.deepEqual(run.calls.map(c => c.name), ['Q0', 'Q1', 'Q2', 'Q3', 'Q4', 'Q5'], 'miss, miss, hit, then three more misses end it');
});

test('a throwing engine run counts as a miss and never breaks the scan', async () => {
  const sources = [{ name: 'A', query: 'a' }, { name: 'B', query: 'b' }];
  const run = loadReplay({ answer: (s) => { if (s.name === 'A') throw new Error('tab crashed'); return good(s.name); } });
  const results = [ok(paused), ok(paused)];
  assert.equal(await run.replayPausedQueries(sources, results), 1);
  assert.equal(results[0].value.paused, true);
  assert.equal(results[1].value.jobs[0].title, 'B Product Designer');
});

test('nothing is replayed with a wedged or absent PinchTab, and never more than the cap', async () => {
  const sources = Array.from({ length: 30 }, (_, i) => ({ name: `Q${i}`, query: `q${i}` }));
  const make = () => sources.map(() => ok(paused));
  let run = loadReplay({ answer: (s) => good(s.name), wedged: true });
  assert.equal(await run.replayPausedQueries(sources, make()), 0);
  assert.equal(run.calls.length, 0);
  run = loadReplay({ answer: (s) => good(s.name), up: false });
  assert.equal(await run.replayPausedQueries(sources, make()), 0);
  assert.equal(run.calls.length, 0);
  run = loadReplay({ answer: (s) => good(s.name) });
  assert.equal(await run.replayPausedQueries(sources, make()), run.WEB_SEARCH_REPLAY_MAX);
  assert.equal(run.calls.length, 25);
  assert.equal(new Set(run.calls.map(c => c.name)).size, 25, 'each query once');
});

test('the scan wires the wait, the pause flag, the replay and the yield memory', () => {
  assert.match(server, /async function fetchPinchtabEnginesMerged\(source, \{ patient = false \} = \{\}\)/);
  assert.match(server, /cooldownWaitMs\(engines, id => engineBackoff\.remainingMs\(id\), enginesThatAnswered, \{ maxWaitMs: ENGINE_PATIENCE_MS \}\)/);
  assert.match(server, /fetchWebSearchSection\(source, sharedBrowser, \{ patient: true \}\)/);
  assert.match(server, /fetchWebSearchSection\(\{ name: `\[explorer\] \$\{query\}`, query \}, null, \{ patient: true \}\)/);
  assert.match(server, /paused: !hasRelevantResult && Boolean\(lastBlocked \|\| skippedCooling\)/);
  assert.match(server, /\n {4}await replayPausedQueries\(sources, results\);\n {2}\} finally \{/, 'the replay runs after the main loop, before the shared browser closes');
  assert.match(server, /Boolean\(result\.value\?\.error\) \|\| Boolean\(result\.value\?\.paused\)/, 'a paused query is not an empty run for the yield memory');
});
