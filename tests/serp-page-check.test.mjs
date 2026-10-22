// Web-search engines that answered "0 results" to every query (DuckDuckGo
// and Google, 2026-10-19 scan) and the circuit breaker that gave up the rest
// of the run while Brave only rested 70 s.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyEmptySerp, serpDiagnostic } from '../lib/serp-page-check.mjs';
import { createCircuitProbe, probeCooldowns } from '../lib/web-search-circuit-probe.mjs';

const filler = ' '.repeat(10) + 'Settings Privacy Feedback All Images News Videos Maps Shopping '.repeat(6);

test('a genuine empty search stays "0 results"', () => {
  assert.equal(classifyEmptySerp({ url: 'https://www.google.com/search?q=x', title: 'x - Google Search', bodyText: `Your search - "x" - did not match any documents. ${filler}` }).kind, 'no-results');
  assert.equal(classifyEmptySerp({ url: 'https://duckduckgo.com/?q=x', title: 'x at DuckDuckGo', bodyText: `No results found for x. ${filler}` }).kind, 'no-results');
});

test('consent, unusual-traffic and bot pages are blocked, not empty', () => {
  assert.deepEqual(classifyEmptySerp({ url: 'https://consent.google.com/m?continue=x', title: 'Before you continue to Google', bodyText: 'Before you continue to Google We use cookies' }), { kind: 'blocked', reason: 'consent page' });
  assert.equal(classifyEmptySerp({ url: 'https://www.google.com/sorry/index?continue=x', title: 'https://www.google.com/search', bodyText: 'Our systems have detected unusual traffic from your computer network.' }).reason, 'unusual-traffic page');
  assert.equal(classifyEmptySerp({ url: 'https://www.google.com/search?q=x', title: 'Google Search', bodyText: "If you're having trouble accessing Google Search, please click here" }).reason, 'javascript-required page');
  assert.equal(classifyEmptySerp({ url: 'https://duckduckgo.com/?q=x', title: 'DuckDuckGo', bodyText: 'Unfortunately, bots use DuckDuckGo too. Please complete the following challenge' }).reason, 'bot challenge');
});

test('a results page the selectors read nothing from is an error, not a fake 0', () => {
  const page = { url: 'https://duckduckgo.com/?q=site%3Ajobs.lever.co+%22Product+Designer%22', title: 'site:jobs.lever.co "Product Designer" at DuckDuckGo', bodyText: `Senior Product Designer - Acme jobs.lever.co/acme ${filler}` };
  assert.deepEqual(classifyEmptySerp(page), { kind: 'blocked', reason: 'unparsed results page' });
  assert.equal(classifyEmptySerp({ url: 'https://duckduckgo.com/?q=x', title: '', bodyText: '' }).reason, 'blank page');
  assert.match(serpDiagnostic(page), /^duckduckgo\.com\/ title="site:jobs\.lever\.co/);
  assert.doesNotMatch(serpDiagnostic(page), /anchors=/);
  assert.match(serpDiagnostic({ ...page, diag: { anchors: 40, headings: 9 } }), /body=".*" anchors=40 headings=9$/);
});

test('Google reads an unparsed results page a second time before resting', () => {
  const src = readFileSync(new URL('../ui/server.mjs', import.meta.url), 'utf8');
  assert.match(src, /read on the second pass \(late render\)/);
  assert.match(src, /reason === 'unparsed results page'/);
  assert.match(src, /serpDiagnostic\(\{ url: result\?\.url, title: result\?\.title, bodyText, diag: result\?\.diag \}\)/);
});

test('the half-open probe waits for the shortest cooldown, at most twice per run', async () => {
  const waits = [];
  const probe = createCircuitProbe({ maxProbes: 2, maxWaitMs: 90000, sleep: async (ms) => { waits.push(ms); } });
  assert.deepEqual(await probe.next([65000, 0 + 120000]), { probe: true, waitedMs: 65000, reason: '' });
  assert.equal((await probe.next([0])).probe, true);
  const third = await probe.next([0]);
  assert.equal(third.probe, false);
  assert.match(third.reason, /circuit-breaker/);
  assert.deepEqual(waits, [65000]);
  probe.reset();
  assert.equal((await probe.next([200000])).probe, false, 'engines resting longer than the cap are not waited for');
  probe.markWedged();
  assert.equal((await probe.next([0])).probe, false, 'a PinchTab that cannot open tabs gets no probe');
});

test('the probe waits for the engine that answers, not for one that only returns empty', async () => {
  // 2026-10-21: Brave rested 67 s, Google 105 s, DuckDuckGo (answering 0, never
  // blocked) had no cooldown: the shortest one was 0 and both probes fired at once.
  const cooldown = { brave: 67000, google: 105000, duckduckgo: 0 };
  const remaining = (id) => cooldown[id];
  const engines = ['brave', 'duckduckgo', 'google'];
  assert.deepEqual(probeCooldowns(engines, remaining, new Set(['brave'])), [67000]);
  assert.deepEqual(probeCooldowns(engines, remaining, new Set()), [67000, 105000], 'nobody answered yet: only real cooldowns count');
  assert.deepEqual(probeCooldowns(engines, () => 0, new Set()), [0], 'nothing cooling: probe now');
  assert.deepEqual(probeCooldowns(engines, remaining, new Set(['brave', 'duckduckgo'])), [67000, 0], 'a ready engine that answers means no wait');

  const waits = [];
  const probe = createCircuitProbe({ maxProbes: 2, maxWaitMs: 150000, sleep: async (ms) => { waits.push(ms); } });
  const gate = await probe.next(probeCooldowns(engines, remaining, new Set(['brave'])));
  assert.deepEqual(gate, { probe: true, waitedMs: 67000, reason: '' });
  assert.deepEqual(waits, [67000]);
});

test('a real answer clears the failed probes, so a later challenge gets probed again', async () => {
  const probe = createCircuitProbe({ maxProbes: 2, sleep: async () => {} });
  assert.equal((await probe.next([0])).probe, true);
  assert.equal((await probe.next([0])).probe, true);
  assert.equal((await probe.next([0])).probe, false);
  probe.ok();
  assert.equal((await probe.next([0])).probe, true);
});

test('the scan recap counts circuit-breaker skips apart and shows the real error', () => {
  const src = readFileSync(new URL('../ui/server.mjs', import.meta.url), 'utf8');
  assert.match(src, /skipped: 'circuit-breaker'/);
  assert.match(src, /skipped \(circuit-breaker\)/);
  assert.match(src, /webSearchProbe\.next\(cooldowns\)/);
  assert.match(src, /probeCooldowns\(webSearchConfig\.engines/);
  assert.match(src, /every web-search engine is resting/);
  assert.match(src, /orderWebSearchSources\(webSearchSources, queryYield\)/);
  assert.match(src, /classifyEmptySerp\(/);
  assert.match(src, /const selectionNote = sel/);
  assert.doesNotMatch(src, /✗ \$\{src\?\.name\}: returned ok=false`\);/);
});