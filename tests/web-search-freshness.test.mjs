// FP6: the contact finder searches without the scan's recency window, and
// the scan keeps exactly the parameters it sent before. ui/server.mjs is read
// as text and only the functions under test run, in a sandbox with stubs:
// the server is never imported and nothing touches the network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createEngineBackoff } from '../lib/scan-engine-backoff.mjs';

const source = readFileSync(new URL('../ui/server.mjs', import.meta.url), 'utf8');
function extract(start, end) {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `missing ${start}`);
  const to = source.indexOf(end, from);
  assert.ok(to > from, `missing ${end}`);
  return source.slice(from, to);
}

const quiet = { log() {}, warn() {}, error() {} };
// Objects built inside the sandbox have its own prototypes: compare them as plain data.
const plain = value => JSON.parse(JSON.stringify(value));

// The freshness helpers plus the four engine functions, with the browser and
// HTTP layers stubbed: each call records the URL or the POST body it built.
function engineSandbox(config) {
  const calls = [];
  const context = vm.createContext({
    webSearchConfig: config,
    console: quiet,
    setTimeout: (fn) => { fn(); return 0; },
    URL, URLSearchParams,
    AbortSignal: { timeout: () => undefined },
    pinchtabIsUp: async () => true,
    pinchtabSearchThrottle: async () => {},
    pinchtabNavigate: async (url) => { calls.push(url); return 'tab-1'; },
    pinchtabEvaluate: async () => ({ jobs: [{ title: 'Claire Martin - Acme', url: 'https://www.linkedin.com/in/claire', location: 'Head of Design at Acme' }], bodyText: '' }),
    pinchtabClose: async () => {},
    smartSolveAndReExtract: async ({ jobs }) => jobs,
    looksLikeChallengePage: () => false,
    classifyEmptySerp: () => ({ kind: 'empty', reason: '' }),
    noteEmptySerp() {},
    cleanString: value => String(value || '').trim(),
    buildJobSection: () => null,
    portalsTitleFilter: { test: () => true },
    fetchPinchtabEngineSection: async (src, { searchUrl, engine }) => { calls.push(searchUrl); return { ok: true, jobs: [], engine }; },
    PINCHTAB_BRAVE_SEARCH_EXTRACT_SCRIPT: '',
    PINCHTAB_GOOGLE_SEARCH_EXTRACT_SCRIPT: '',
    PINCHTAB_BING_SEARCH_EXTRACT_SCRIPT: '',
    ddgThrottle: async () => {},
    nextDdgUserAgent: () => 'test-agent',
    DUCKDUCKGO_HTML_SEARCH_URL: 'https://html.duckduckgo.com/html/',
    detectChallenge: () => ({ blocked: false }),
    normalizeSearchResultTitle: value => String(value || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim(),
    decodeDuckDuckGoResultUrl: (href) => {
      const parsed = new URL(String(href).replace(/&amp;/g, '&'), 'https://duckduckgo.com');
      return parsed.searchParams.get('uddg') || parsed.href;
    },
    ddgHtml: '',
    fetch: async (url, init) => { calls.push(`POST ${init.body}`); return { ok: true, status: 200, text: async () => context.ddgHtml }; },
  });
  vm.runInContext(extract('function webSearchFreshnessWindow() {', '\nconst SERPAPI_KEY'), context);
  vm.runInContext(extract('async function fetchDuckDuckGoSection(', '\nasync function fetchBraveSection('), context);
  vm.runInContext(extract('async function fetchPinchtabBraveSection(', '\nasync function fetchPinchtabSearchSection('), context);
  vm.runInContext(extract('async function fetchPinchtabSearchSection(', '\n// Bing is the most tolerant'), context);
  vm.runInContext(extract('async function fetchPinchtabBingSection(', '\nasync function fetchPinchtabDuckDuckGoSection('), context);
  return { context, calls };
}

const source1 = { name: 'test', query: 'site:linkedin.com/in "Acme"' };
const AUTO_WEEK = { freshness: 'auto', maxAgeDays: 7 };

test('scan calls keep today\'s recency parameters: Google and Bing get the week window in auto mode, DuckDuckGo HTML its df=w', async () => {
  const { context, calls } = engineSandbox(AUTO_WEEK);
  await context.fetchPinchtabSearchSection(source1);
  await context.fetchPinchtabBingSection(source1);
  await context.fetchPinchtabBraveSection(source1);
  await context.fetchDuckDuckGoSection(source1);
  assert.match(calls[0], /^https:\/\/www\.google\.com\/search\?.*&tbs=qdr:w$/);
  assert.match(calls[1], /&count=30&setlang=en&filters=ex1%3a%22ez2%22$/);
  assert.doesNotMatch(calls[2], /tf=/, 'Brave gets no window in auto mode, as before');
  assert.equal(new URLSearchParams(calls[3].slice(5)).get('df'), 'w', 'the scan\'s DuckDuckGo body is unchanged');
  // An explicit window reaches Brave too.
  const week = engineSandbox({ freshness: 'week', maxAgeDays: 7 });
  await week.context.fetchPinchtabBraveSection(source1);
  assert.match(week.calls[0], /&tf=pw$/);
});

test('freshness: \'none\' (the contact finder) adds no recency parameter on any engine', async () => {
  for (const config of [AUTO_WEEK, { freshness: 'week', maxAgeDays: 7 }, { freshness: 'day', maxAgeDays: 1 }]) {
    const { context, calls } = engineSandbox(config);
    const none = { freshness: 'none' };
    await context.fetchPinchtabSearchSection(source1, none);
    await context.fetchPinchtabBingSection(source1, none);
    await context.fetchPinchtabBraveSection(source1, none);
    await context.fetchDuckDuckGoSection(source1, none);
    assert.doesNotMatch(calls[0], /tbs=/, config.freshness);
    assert.doesNotMatch(calls[1], /filters=/, config.freshness);
    assert.doesNotMatch(calls[2], /tf=/, config.freshness);
    assert.equal(new URLSearchParams(calls[3].slice(5)).get('df'), '', config.freshness);
  }
});

test('DuckDuckGo HTML: each result carries its own snippet in searchSnippet; location stays empty for the scan', async () => {
  const { context } = engineSandbox(AUTO_WEEK);
  context.ddgHtml = [
    '<div class="result results_links"><div class="links_main result__body"><h2 class="result__title">',
    '<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.linkedin.com%2Fin%2Fclaire&amp;rut=x">Claire Martin - Acme | LinkedIn</a></h2>',
    '<a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.linkedin.com%2Fin%2Fclaire">Head of Design at <b>Acme</b> · Experience: Acme</a></div></div>',
    '<div class="result results_links"><div class="links_main result__body"><h2 class="result__title">',
    '<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Facme.io%2F">Acme</a></h2></div></div>',
  ].join('\n');
  const out = await context.fetchDuckDuckGoSection(source1, { freshness: 'none' });
  assert.equal(out.jobs.length, 2);
  assert.equal(out.jobs[0].url, 'https://www.linkedin.com/in/claire');
  assert.equal(out.jobs[0].searchSnippet, 'Head of Design at Acme · Experience: Acme');
  assert.equal(out.jobs[1].searchSnippet, '', 'no snippet borrowed from the previous result');
  assert.equal(out.jobs[0].location, undefined);
  assert.equal(out.jobs[0].remoteEvidence, undefined);
});

// contactFinderWebSearch with every engine stubbed: answers[id] is what that
// engine returns (a section), and each call is recorded with its options.
function finderSandbox(answers, { engineBackoff = createEngineBackoff(), ddgOpen = false, searchKey = '' } = {}) {
  const calls = [];
  const engine = (id, engineName) => async (src, opts) => { calls.push({ id, query: src.query, opts }); return answers[id] || { ok: true, jobs: [], engine: engineName }; };
  const context = vm.createContext({
    console: quiet,
    IS_VERCEL: false,
    process: { env: { SEARCHAPI_KEY: searchKey } },
    SERPAPI_KEY: '',
    createEngineBackoff,
    engineBackoff,
    localDdgCircuitOpen: () => ddgOpen,
    serpApiCircuitOpen: () => false,
    isWebSearchEngineBlocked: result => !result || Boolean(result.error) || (result.engine === 'duckduckgo-html' && !result.ok),
    fetchPinchtabBraveSection: engine('brave', 'pinchtab-brave'),
    fetchPinchtabBingSection: engine('bing', 'pinchtab-bing'),
    fetchPinchtabSearchSection: engine('google', 'pinchtab-google'),
    fetchDuckDuckGoSection: engine('duckduckgo-html', 'duckduckgo-html'),
    fetchSerpApiSection: engine('searchapi', 'searchapi-organic'),
  });
  vm.runInContext(extract('const contactFinderEngineRest', '\nasync function contactFinderExtractPeople('), context);
  return { search: context.contactFinderWebSearch, calls };
}

const hit = (title, url, location = '') => ({ title, url, location, remoteEvidence: location });

test('contactFinderWebSearch: Brave, Bing, Google, then DuckDuckGo, all with freshness none; the first usable answer wins', async () => {
  const directories = { ok: true, engine: 'pinchtab-brave', jobs: [hit('Acme - Crunchbase', 'https://www.crunchbase.com/organization/acme')] };
  const site = { ok: true, engine: 'pinchtab-bing', jobs: [hit('Acme: payroll for teams', 'https://acme.io/', 'Acme builds payroll software')] };
  const { search, calls } = finderSandbox({ brave: directories, bing: site });
  const usable = results => results.some(result => !/crunchbase/.test(result.url));
  const results = await search('"Acme" official website', { num: 8, usable });
  assert.deepEqual(plain(results), [{ title: 'Acme: payroll for teams', url: 'https://acme.io/', snippet: 'Acme builds payroll software' }]);
  assert.deepEqual(calls.map(call => call.id), ['brave', 'bing'], 'Google is not asked once Bing gave a usable answer');
  assert.ok(calls.every(call => call.opts?.freshness === 'none'));

  // Nobody usable: every engine is asked and the first non-empty answer comes back.
  const none = finderSandbox({ brave: directories });
  const fallback = await none.search('"Acme" official website', { num: 8, usable });
  assert.deepEqual(none.calls.map(call => call.id), ['brave', 'bing', 'google', 'duckduckgo-html']);
  assert.equal(fallback[0].url, 'https://www.crunchbase.com/organization/acme');

  // The default `usable` is "any result"; num caps the answer.
  const many = finderSandbox({ brave: { ok: true, engine: 'pinchtab-brave', jobs: Array.from({ length: 20 }, (_, i) => hit(`P${i}`, `https://www.linkedin.com/in/p${i}`)) } });
  assert.equal((await many.search('site:linkedin.com/in "Acme"', { num: 20 })).length, 20);
  assert.equal((await many.search('site:linkedin.com/in "Acme"', { num: 10 })).length, 10);
});

test('contactFinderWebSearch: a snippet comes from searchSnippet first; SearchAPI only for site: queries', async () => {
  const ddg = { ok: true, engine: 'duckduckgo-html', jobs: [{ title: 'Claire Martin - Acme | LinkedIn', url: 'https://www.linkedin.com/in/claire', searchSnippet: 'Head of Design at Acme' }] };
  const { search } = finderSandbox({ 'duckduckgo-html': ddg });
  assert.deepEqual(plain(await search('site:linkedin.com/in "Acme"')), [{ title: 'Claire Martin - Acme | LinkedIn', url: 'https://www.linkedin.com/in/claire', snippet: 'Head of Design at Acme' }]);
  const keyed = finderSandbox({}, { searchKey: 'k' });
  await keyed.search('"Acme" official website');
  assert.ok(!keyed.calls.some(call => call.id === 'searchapi'));
  await keyed.search('site:linkedin.com/in "Acme"');
  assert.ok(keyed.calls.some(call => call.id === 'searchapi'));
  // DuckDuckGo's circuit open: not asked.
  const closed = finderSandbox({}, { ddgOpen: true });
  await closed.search('"Acme"');
  assert.ok(!closed.calls.some(call => call.id === 'duckduckgo-html'));
});

test('contactFinderWebSearch: an engine resting in the scan, or blocked on a previous finder query, is skipped while another can answer', async () => {
  const backoff = createEngineBackoff({ baseMs: 60000 });
  backoff.fail('brave');
  const answer = { ok: true, engine: 'pinchtab-bing', jobs: [hit('x', 'https://www.linkedin.com/in/x')] };
  const resting = finderSandbox({ bing: answer }, { engineBackoff: backoff });
  await resting.search('site:linkedin.com/in "Acme"');
  assert.deepEqual(resting.calls.map(call => call.id), ['bing'], 'Brave rests after the scan\'s challenge');
  assert.ok(backoff.cooling('brave'), 'the scan\'s rest is read, not changed');
  assert.ok(!backoff.cooling('bing'), 'and the finder never writes it');

  const blocked = finderSandbox({ brave: { ok: false, engine: 'pinchtab-brave', jobs: [], error: 'challenge page' }, bing: answer });
  await blocked.search('site:linkedin.com/in "Acme" recruiter');
  await blocked.search('site:linkedin.com/in "Acme" founder');
  assert.deepEqual(blocked.calls.map(call => call.id), ['brave', 'bing', 'bing'], 'the challenged engine sits out the next query');
});

test('contactFinderWebSearch: a closed modal or the finder\'s deadline stops the walk before the next engine', async () => {
  const aborted = finderSandbox({});
  assert.deepEqual(plain(await aborted.search('"Acme" official website', { signal: { aborted: true } })), []);
  assert.deepEqual(aborted.calls, [], 'no engine is asked once the modal closed');
  const late = finderSandbox({});
  await late.search('"Acme" official website', { stopAt: Date.now() - 1 });
  assert.deepEqual(late.calls, [], 'no engine is asked past the deadline');
  // Before the deadline every engine is still tried in turn.
  const inTime = finderSandbox({});
  await inTime.search('"Acme" official website', { stopAt: Date.now() + 60000 });
  assert.deepEqual(inTime.calls.map(call => call.id), ['brave', 'bing', 'google', 'duckduckgo-html']);
});
