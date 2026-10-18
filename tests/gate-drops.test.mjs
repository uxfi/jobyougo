// lib/gate-drops.mjs: pipeline offers dropped before Qwen keep a visible reason.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendGateDrop, gateDropRecord, parseGateDrops, readGateDrops } from '../lib/gate-drops.mjs';
import { scanMemoryPaths } from '../lib/scan-memory.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Never import ui/server.mjs: it starts the server and stops the live one.
const SERVER = readFileSync(join(ROOT, 'ui/server.mjs'), 'utf8');
const INDEX = readFileSync(join(ROOT, 'ui/index.html'), 'utf8');

test('every pipeline gate that drops an offer logs it with its reason', () => {
  assert.match(SERVER, /historyStatus: 'profile_dropped'[\s\S]{0,400}logGateDrops\(req\.userId, \[\{[\s\S]{0,200}gate: 'profile',\s*reasons: profileGate\.reasons/);
  assert.equal((SERVER.match(/historyStatus: 'jev_dropped',\s*historyPortal: 'pipeline-jev',\s*\}\);\s*(?:const offer = pipelineOfferIdentity\(pipelineTarget\);\s*)?await logGateDrops\(/g) || []).length, 2, 'both Jev drop sites');
  assert.match(SERVER, /path === '\/api\/pipeline\/dropped' && method === 'GET'[\s\S]{0,200}readGateDrops\(await scanMemoryOf\(viewOnlyScope\(req\)\)\)/);
});

test('a gate reject skips report writing instead of failing validation', () => {
  assert.match(SERVER, /const pipelineHardSkip = mode === 'pipeline' && profileGate\?\.hardReject;\s*if \(pipelineHardSkip\) \{/);
  assert.doesNotMatch(SERVER, /jevHardPass/);
});

test('the pipeline view lists dropped offers with a re-add button', () => {
  assert.match(INDEX, /api\('\/api\/pipeline\/dropped'\)/);
  assert.match(INDEX, /id="pipeline-dropped-list"/);
  const render = INDEX.slice(INDEX.indexOf('function renderPipelineDrops('), INDEX.indexOf('function renderPipeline('));
  assert.match(render, /!queued\.has\(drop\.url\)/, 'an offer back in the queue leaves the list');
  assert.match(render, /escapeHtml\(\(drop\.reasons \|\| \[\]\)\.join\(' '\)\)/, 'the reason is escaped');
  assert.match(render, /data-readd-url=/);
  assert.match(INDEX, /renderPipeline\(\);\s*renderPipelineDrops\(\);/);
});

test('a drop record keeps url, identity, gate and reasons', () => {
  const record = gateDropRecord({
    url: 'https://jobs.ashbyhq.com/n8n/fea09cae',
    title: 'Internal AI Enablement Lead',
    company: 'n8n',
    gate: 'profile',
    reasons: ['Profile requires full remote, but the JD looks hybrid.'],
    at: '2026-10-16T07:00:00.000Z',
  });
  assert.equal(record.gate, 'profile');
  assert.deepEqual(record.reasons, ['Profile requires full remote, but the JD looks hybrid.']);
  assert.equal(gateDropRecord({ url: 'javascript:alert(1)' }), null, 'only http(s) URLs');
  assert.equal(gateDropRecord({ url: 'https://a.example', gate: 'other' }).gate, 'profile');
});

test('newest first, one row per URL, old rows and bad lines skipped', () => {
  const now = Date.parse('2026-10-16T12:00:00Z');
  const raw = [
    JSON.stringify({ url: 'https://a.example', gate: 'jev', reasons: ['old'], at: '2026-08-01T00:00:00Z' }),
    JSON.stringify({ url: 'https://b.example', gate: 'profile', reasons: ['first'], at: '2026-10-15T00:00:00Z' }),
    'not json',
    JSON.stringify({ url: 'https://b.example', gate: 'jev', reasons: ['latest'], at: '2026-10-16T00:00:00Z' }),
    JSON.stringify({ url: 'https://c.example', gate: 'profile', reasons: ['c'], at: '2026-10-15T12:00:00Z' }),
  ].join('\n');
  const drops = parseGateDrops(raw, { now });
  assert.deepEqual(drops.map(drop => drop.url), ['https://b.example', 'https://c.example']);
  assert.deepEqual(drops[0].reasons, ['latest']);
});

test('append then read in an account folder', async () => {
  const root = mkdtempSync(join(tmpdir(), 'gate-drops-'));
  try {
    const memory = scanMemoryPaths(root, '11111111-2222-3333-4444-555555555555');
    await appendGateDrop(memory, { url: 'https://d.example', title: 'Designer', gate: 'jev', reasons: ['Jev: below threshold'] });
    const drops = await readGateDrops(memory);
    assert.equal(drops.length, 1);
    assert.equal(drops[0].title, 'Designer');
    assert.deepEqual(await readGateDrops(scanMemoryPaths(root)), [], 'the owner folder is separate');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
