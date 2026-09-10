import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { ROOT, pass, fail } from './helpers.mjs';

try {
  const source = readFileSync(join(ROOT, 'ui/server.mjs'), 'utf8');
  const extract = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  const calls = [];
  const context = vm.createContext({
    process: { env: {} }, SERPAPI_KEY: '', console: { log() {}, warn() {}, error() {} },
    webSearchCircuitOpen: () => false, serpApiCircuitOpen: () => false, isWebSearchEngineBlocked: r => !!r.error,
    recordWebSearchOutcome() {}, pinchtabIsUp: async () => true,
    fetchPinchtabBraveSection: async () => { calls.push('pinchtab'); return { ok: true, jobs: [{}] }; },
    fetchLocalBrowserGoogleSection: async () => { calls.push('playwright'); return { ok: true, jobs: [{}] }; },
  });
  vm.runInContext(extract('async function fetchWebSearchSection(', '\nasync function fetchWebSearchSectionsSequential('), context);
  await context.fetchWebSearchSection({ name: 'test', query: 'jobs' });
  assert.deepEqual(calls, ['pinchtab']);
  pass('Web search uses PinchTab without launching Playwright when available');
  calls.length = 0;
  context.pinchtabIsUp = async () => false;
  await context.fetchWebSearchSection({ name: 'test', query: 'jobs' });
  assert.deepEqual(calls, ['playwright']);
  pass('Web search retains Playwright fallback when PinchTab is unavailable');

  let closed = false;
  const browser = { ctx: { pages: () => [{ goto: async () => ({ status: () => 502 }) }], close: async () => { closed = true; } } };
  Object.assign(context, { IS_VERCEL: false, pinchtabSearchThrottle: async () => {}, launchLocalBrowserContext: async () => browser });
  vm.runInContext(extract('async function fetchLocalBrowserGoogleSection(', '\nconst PINCHTAB_BRAVE_SEARCH_EXTRACT_SCRIPT'), context);
  const result = await context.fetchLocalBrowserGoogleSection({ name: 'test', query: 'jobs' });
  assert.equal(result.ok, false);
  assert.match(result.error, /502/);
  assert.equal(closed, true);
  pass('Google 502 is reported as failure and owned browser is closed');
} catch (error) { fail(`Browser flow: ${error.stack}`); }
