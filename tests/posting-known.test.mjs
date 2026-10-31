import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyTrackerBlock, manualAddBlock, trackerRowsForPosting } from '../lib/posting-known.mjs';

// Rows as ui/server.mjs getApplications returns them (markdown or Supabase).
const apps = [
  { num: 222, Company: 'Secfix', Role: 'Senior Product Designer', Status: 'Applied', Report: '[1199](../reports/1199-secfix-2026-10-30.md)', JobURL: 'https://jobs.ashbyhq.com/secfix/3fd72701-24db-48a3-a3df-9c889d26b86b' },
  { num: 124, Company: 'X', Role: 'FLOW — UI/UX Design Lead', Status: 'Applied', Report: '[124](../reports/124-x-2026-09-17.md)', JobURL: 'https://xflow.bamboohr.com/careers/130?source=aWQ9MjE=' },
  { num: 789, Company: 'X-FLOW', Role: 'UI/UX Design Lead', Status: 'Evaluated', Report: '[789](../reports/789-x-flow-2026-10-16.md)', JobURL: 'https://xflow.bamboohr.com/careers/130?source=aWQ9MjE=' },
  { num: 1140, Company: 'Spate', Role: 'Product Designer (Intl. - Full-time)', Status: 'Started', Report: '[1140](../reports/1140-spate-2026-10-29.md)', JobURL: 'https://spate.example/jobs/1' },
  { num: 138, company: 'Carousell Group', role: 'Product Designer', status: 'Respondido', report: '[138](../reports/138-carousell-2026-09-20.md)', job_url: 'https://carousell.example/jobs/7' },
];

const canonical = (s) => ({ respondido: 'Responded' }[String(s).toLowerCase()] || s);

test('manual add: a URL a tracker row carries is refused as already evaluated', () => {
  const block = manualAddBlock({ url: 'https://jobs.ashbyhq.com/secfix/3fd72701-24db-48a3-a3df-9c889d26b86b?utm_source=linkedin', apps, canonical });
  assert.equal(block.reason, 'evaluated');
  assert.equal(block.existing.num, 222);
  assert.equal(block.existing.status, 'Applied');
  assert.equal(block.existing.report, '1199-secfix-2026-10-30.md');
  assert.match(block.message, /Already evaluated \(#222, Applied\)/);
});

test('manual add: an unknown URL passes', () => {
  assert.equal(manualAddBlock({ url: 'https://jobs.ashbyhq.com/secfix/another-posting', apps, canonical }), null);
});

test('manual add: the same employer and role under another URL is refused as already tracked', () => {
  const block = manualAddBlock({ url: 'https://linkedin.example/jobs/9', company: 'Carousell Group', title: 'Senior Product Designer', apps, canonical });
  assert.equal(block.reason, 'tracked');
  assert.equal(block.existing.num, 138);
  assert.equal(block.existing.status, 'Responded');
});

test('manual add: another role at a tracked employer, another employer, or no title passes', () => {
  assert.equal(manualAddBlock({ url: 'https://x.example/1', company: 'Carousell Group', title: 'Product Manager', apps, canonical }), null);
  assert.equal(manualAddBlock({ url: 'https://x.example/2', company: 'Other Co', title: 'Product Designer', apps, canonical }), null);
  assert.equal(manualAddBlock({ url: 'https://x.example/3', company: 'Carousell Group', title: '', apps, canonical }), null);
  assert.equal(manualAddBlock({ url: 'https://x.example/4', company: '', title: 'Product Designer', apps, canonical }), null);
});

test('manual add: no tracker rows passes', () => {
  assert.equal(manualAddBlock({ url: 'https://x.example/1', company: 'A', title: 'B', apps: [] }), null);
});

test('rows of a posting: by row number, by report file, by URL', () => {
  assert.deepEqual(trackerRowsForPosting(apps, { num: 222 }).map((r) => r.num), [222]);
  assert.deepEqual(trackerRowsForPosting(apps, { report: '124-x-2026-09-17.md' }).map((r) => r.num), [124]);
  assert.deepEqual(trackerRowsForPosting(apps, { url: 'https://xflow.bamboohr.com/careers/130?source=aWQ9MjE=' }).map((r) => r.num), [124, 789]);
  assert.deepEqual(trackerRowsForPosting(apps, {}), []);
});

test('apply: a row already Applied blocks its own run', () => {
  const block = applyTrackerBlock({ apps, num: 222, report: '1199-secfix-2026-10-30.md', canonical });
  assert.equal(block.alreadySubmitted, true);
  assert.equal(block.reason, 'applied');
  assert.match(block.error, /^Already applied \(tracker #222, Applied\)/);
});

test('apply: xflow, an Evaluated row whose posting another row already applied to', () => {
  const block = applyTrackerBlock({ apps, num: 789, report: '789-x-flow-2026-10-16.md', jobUrl: 'https://xflow.bamboohr.com/careers/130?source=aWQ9MjE=', canonical });
  assert.equal(block.existing.num, 124);
  assert.match(block.error, /tracker #124/);
});

test('apply: Evaluated and Started rows are free to apply', () => {
  assert.equal(applyTrackerBlock({ apps, num: 789, report: '789-x-flow-2026-10-16.md', jobUrl: '', canonical }), null);
  assert.equal(applyTrackerBlock({ apps, num: 1140, report: '1140-spate-2026-10-29.md', jobUrl: 'https://spate.example/jobs/1', canonical }), null);
});

test('apply: the states after Applied count as sent, in any spelling the canonical map resolves', () => {
  const block = applyTrackerBlock({ apps, num: 138, report: '138-carousell-2026-09-20.md', canonical });
  assert.equal(block.existing.status, 'Responded');
  const rejected = [{ num: 5, Company: 'A', Role: 'B', Status: 'Rejected', Report: '[5](../reports/5-a.md)' }];
  assert.ok(applyTrackerBlock({ apps: rejected, num: 5 }));
});

test('apply: no rows, or no match, passes', () => {
  assert.equal(applyTrackerBlock({ apps: [], num: 1 }), null);
  assert.equal(applyTrackerBlock({ apps, num: 9999, report: 'nope.md', jobUrl: 'https://nowhere.example/x', canonical }), null);
});

// ui/server.mjs wiring. The double-send guard once sat in /api/apply/preview, a
// GET handler with no `body`, and /api/apply/start had none.
const server = readFileSync(new URL('../ui/server.mjs', import.meta.url), 'utf-8');
const previewBlock = server.slice(server.indexOf("path === '/api/apply/preview'"), server.indexOf("path === '/api/apply/start'"));
const startBlock = server.slice(server.indexOf("path === '/api/apply/start'"), server.indexOf("path === '/api/apply/last-runs'"));

test('server: /api/apply/preview does not read a request body it does not have', () => {
  assert.ok(previewBlock.length > 200);
  assert.doesNotMatch(previewBlock, /\bbody\b/);
  assert.doesNotMatch(previewBlock, /applyRelaunchBlock/);
});

test('server: /api/apply/start refuses a second send unless forced, before it builds the spec', () => {
  assert.match(startBlock, /body\.force !== true/);
  assert.match(startBlock, /applyRelaunchBlock\(prior\)/);
  assert.match(startBlock, /applyTrackerBlockFor\(/);
  assert.ok(startBlock.indexOf('applyTrackerBlockFor(') < startBlock.indexOf('buildApplySpec('));
  assert.match(startBlock, /json\(res, block, 409\)/);
});

test('server: POST /api/pipeline passes force through and the manual add checks the tracker', () => {
  assert.match(server, /const \{ url, note, force \} = await readBody\(req\);/);
  assert.match(server, /addToPipeline\(url, note \|\| '', req\.userId, \{ force: force === true \}\)/);
  const add = server.slice(server.indexOf('async function addToPipeline('), server.indexOf('// ─── Portals (portals.yml)'));
  assert.match(add, /manualAddBlock\(\{ url, apps/);
  assert.ok(add.indexOf('manualAddBlock(') < add.indexOf('lookupPostingIdentity('), 'URL check runs before the network lookup');
  assert.match(add, /const apps = force \? \[\] : await getApplications/);
});
