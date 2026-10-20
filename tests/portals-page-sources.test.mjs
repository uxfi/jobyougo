import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { listQuerySources, QUERY_SECTIONS } from '../lib/portal-query-sources.mjs';
import { createEngineRotation, createEngineBackoff } from '../lib/scan-engine-backoff.mjs';
import { REQUEST_TIMEOUT_MS as WTTJ_TIMEOUT } from '../providers/wttj.mjs';
import { REQUEST_TIMEOUT_MS as NFJ_TIMEOUT } from '../providers/nofluffjobs.mjs';

const parsed = {
  tracked_companies: [{ name: 'Acme', careers_url: 'https://acme.test' }],
  search_queries: [{ name: 'Q1', query: 'site:a.test designer' }],
  eu_job_boards: [{ name: 'EU1', query: 'site:eu.test', enabled: false }],
  freelance_portals: [{ name: 'F1', query: 'site:f.test', enabled: false }],
  job_boards: [{ name: 'B1', provider: 'jobicy', enabled: false }, { name: 'B2', provider: 'rss', feed: 'https://b.test/feed' }],
};

test('Portals Job Boards tab lists every non-company section the scan picker reads, enabled and disabled', () => {
  assert.deepEqual(QUERY_SECTIONS, ['search_queries', 'eu_job_boards', 'freelance_portals', 'job_boards']);
  const rows = listQuerySources(parsed);
  assert.deepEqual(rows.map(r => r.name), ['Q1', 'EU1', 'F1', 'B1', 'B2']);
  assert.equal(rows.find(r => r.name === 'B1').enabled, false);
  assert.equal(rows.find(r => r.name === 'B2').query, 'rss · https://b.test/feed');
  assert.equal(rows.find(r => r.name === 'F1').readOnly, true);
  assert.equal(rows.find(r => r.name === 'B1').readOnly, true);
  assert.equal(rows.find(r => r.name === 'Q1').readOnly, undefined);
});

test('server toggles and bulk on/off reach the new sections; dashboard counts from /api/scan-sources', () => {
  const server = readFileSync(new URL('../ui/server.mjs', import.meta.url), 'utf8');
  assert.match(server, /async function toggleQuery[\s\S]{0,120}for \(const section of QUERY_SECTIONS\)/);
  assert.match(server, /setPortalsEnabled\(QUERY_SECTIONS, bulk\.names/);
  const html = readFileSync(new URL('../ui/index.html', import.meta.url), 'utf8');
  assert.match(html, /api\('\/api\/scan-sources'\)\.catch\(\(\) => null\)/);
  assert.match(html, /freelance_portals: 'Freelance'/);
  assert.match(html, /job_boards: 'API & RSS job boards'/);
  assert.match(html, /p\.readOnly \? '' :/);
});

test('engine rotation: waits for the shortest cooldown only when every ready engine keeps answering empty', () => {
  let t = 0;
  const backoff = createEngineBackoff({ baseMs: 60000, jitter: 0, now: () => t });
  const rot = createEngineRotation({ emptyLimit: 3, maxWaitMs: 90000 });
  const engines = ['brave', 'duckduckgo', 'google'];
  backoff.fail('brave');
  backoff.fail('google'); backoff.fail('google');
  assert.equal(rot.waitMs(engines, backoff), 0);
  for (let i = 0; i < 3; i++) rot.note('duckduckgo', 0);
  assert.equal(rot.waitMs(engines, backoff), 60000);
  rot.note('duckduckgo', 2);
  assert.equal(rot.waitMs(engines, backoff), 0);
  assert.deepEqual(rot.order(engines, backoff).slice(-2), ['brave', 'google']);
  t = 200000;
  const first = rot.order(engines, backoff)[0];
  const second = rot.order(engines, backoff)[0];
  assert.notEqual(first, second);
});

test('slow boards get a longer request deadline than the shared 10s', () => {
  assert.equal(WTTJ_TIMEOUT, 30000);
  assert.equal(NFJ_TIMEOUT, 30000);
  for (const f of ['../providers/wttj.mjs', '../providers/nofluffjobs.mjs']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.ok((src.match(/timeoutMs: REQUEST_TIMEOUT_MS/g) || []).length >= 1, f);
  }
});
