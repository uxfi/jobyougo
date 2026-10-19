// Savings found in the 2026-10-17 scan/pipeline audit: dead search engines rest
// for the run, an unchanged tracker is not pushed to Supabase again. The server
// starts on import, so the helpers are read from its source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createEngineBackoff, createQuerySpacer } from '../lib/scan-engine-backoff.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = readFileSync(join(ROOT, 'ui/server.mjs'), 'utf8');
const NL = String.fromCharCode(10);

function between(startMarker, endMarker) {
  const a = server.indexOf(startMarker);
  const b = server.indexOf(endMarker, a);
  assert.ok(a >= 0 && b > a, `${startMarker} is in the server source`);
  return server.slice(a, b);
}

test('an engine blocked or empty five times in a row rests, and is retried now and then', () => {
  const code = between('const ENGINE_DEAD_AFTER', 'async function fetchPinchtabEnginesMerged');
  const h = vm.runInNewContext(`${code}${NL}({ engineIsResting, noteEngineResult, resetEngineHealth, ENGINE_DEAD_AFTER, ENGINE_RETRY_EVERY })`, { process: { env: {} }, createEngineBackoff, createQuerySpacer });
  const ALL = ['brave', 'duckduckgo', 'google'];
  for (let i = 0; i < h.ENGINE_DEAD_AFTER - 1; i++) h.noteEngineResult('duckduckgo', false);
  assert.equal(h.engineIsResting('duckduckgo', ALL), false, 'four misses are not enough');
  h.noteEngineResult('duckduckgo', false);
  const tries = [];
  for (let i = 0; i < h.ENGINE_RETRY_EVERY * 2; i++) tries.push(!h.engineIsResting('duckduckgo', ALL));
  assert.equal(tries.filter(Boolean).length, 2, 'one try in every ENGINE_RETRY_EVERY queries');
  // One useful answer clears it.
  h.noteEngineResult('duckduckgo', true);
  assert.equal(h.engineIsResting('duckduckgo', ALL), false);
  // Another engine is not affected, and a new scan starts clean.
  for (let i = 0; i < 6; i++) h.noteEngineResult('google', false);
  assert.equal(h.engineIsResting('brave', ALL), false);
  // With every engine dead nothing rests: the circuit breaker decides.
  for (const id of ALL) for (let i = 0; i < 6; i++) h.noteEngineResult(id, false);
  assert.equal(h.engineIsResting('google', ALL), false);
  h.resetEngineHealth();
  assert.equal(h.engineIsResting('google', ALL), false);
});

test('the merged search skips resting engines and the scan resets the health at its start', () => {
  const merged = between('async function fetchPinchtabEnginesMerged', 'function buildTheirStackPayload');
  assert.match(merged, /if \(engineIsResting\(id, engines\)\) \{ engineLog\.push\(`\$\{id\}:resting`\); continue; \}/);
  assert.match(merged, /noteEngineResult\(id, false\)/);
  assert.match(merged, /noteEngineResult\(id, added > 0\)/);
  assert.match(server, /resetWebSearchCircuit\(\);\s*resetEngineHealth\(\);/);
});

test('an identical tracker is not pushed to Supabase twice', () => {
  const fn = between('async function syncLocalApplicationsToSupabase', 'function parseCoverLetterSections');
  assert.match(fn, /createHash\('sha1'\)\.update\(JSON\.stringify\(rows\)\)/);
  assert.match(fn, /lastAppsSyncHash\.get\(syncKey\) === rowsHash\) return \{ ok: true, count: rows\.length, unchanged: true \}/);
  // Remembered only after a successful upsert, so a failed push is retried.
  const hashSet = fn.indexOf('lastAppsSyncHash.set(');
  const upsertFail = fn.indexOf("console.error('[sync-apps] Supabase upsert failed:'");
  assert.ok(hashSet > upsertFail, 'the hash is stored after the failure branch returns');
});
