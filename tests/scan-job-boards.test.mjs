import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { pass, fail, ROOT } from './helpers.mjs';
import { getScanAggregators, fetchJobBoard, jobBoardProviders } from '../lib/scan-job-boards.mjs';

try {
  const legacy = { name: 'Legacy', provider: 'remotive' };
  const board = { name: 'Sweden', provider: 'jobtech', enabled: true, jobtech: { remote: true } };
  const sources = getScanAggregators({ api_aggregators: [legacy], job_boards: [board] });
  assert.equal(sources[0], legacy);
  assert.equal(sources[1].sourceKind, 'job_board');
  assert.equal(sources[1].jobtech.remote, true);
  assert.equal(board.sourceKind, undefined);
  pass('UI scan includes board sources and preserves legacy entries and provider options');

  let received;
  const providers = new Map([['jobtech', { fetch: async entry => {
    received = entry;
    return [{ title: 'AI designer', url: 'https://example.com/job', company: 'Example', location: 'Remote Sweden', postedAt: 1788566400000 }];
  } }]]);
  const jobs = await fetchJobBoard(sources[1], { providers, ctx: {} });
  assert.equal(received, sources[1]);
  assert.equal(jobs[0].publishedAt, 1788566400000);
  assert.equal(jobs[0].remoteEvidence, 'Remote Sweden');
  assert.equal(jobs[0].company, 'Example');
  pass('UI provider adapter preserves dates, location evidence and company');
  await assert.rejects(fetchJobBoard({ provider: 'missing' }, { providers }), /Unknown job board/);
  await assert.rejects(fetchJobBoard(board, { providers: new Map([['jobtech', { fetch: async () => { throw new Error('HTTP 403'); } }]]) }), /HTTP 403/);
  pass('UI provider adapter propagates unknown-provider and network failures');

  for (const id of ['jobtech', 'nav', 'taiwanjobs', 'huggingface-openapply']) assert.ok(jobBoardProviders.has(id), id);
  pass('All four new providers load in the UI registry');

  const server = readFileSync(join(ROOT, 'ui/server.mjs'), 'utf8');
  const start = server.indexOf('async function fetchAggregatorSection(');
  const end = server.indexOf('\nasync function fetchWebSearchSection(', start);
  const context = vm.createContext({
    fetchJobBoard: async () => jobs,
    normalizeDateValue: value => new Date(value).toISOString().slice(0, 10),
    buildJobSection: (name, values) => `${name}: ${values[0].title}`,
    console: { log() {}, warn() {} },
  });
  vm.runInContext(server.slice(start, end), context);
  const result = await context.fetchAggregatorSection(sources[1]);
  assert.equal(result.ok, true);
  assert.equal(result.engine, 'jobtech');
  assert.match(result.jobs[0].publishedAt, /^2026-/);
  assert.equal(result.section, 'Sweden: AI designer');
  context.fetchJobBoard = async () => { throw new Error('HTTP 403'); };
  const failed = await context.fetchAggregatorSection(sources[1]);
  assert.equal(failed.ok, false);
  assert.equal(failed.error, 'HTTP 403');
  pass('Actual UI dispatch builds sections and isolates provider failures');
} catch (error) {
  fail(`UI job-board integration: ${error.stack}`);
}
