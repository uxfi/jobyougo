import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync as read } from 'node:fs';
import { needsLongerWait, createSolveCooldown, createDetailBudget, CONSENT_DISMISS_SCRIPT } from '../lib/scan-careers-wait.mjs';
import { createEngineBackoff, createQuerySpacer } from '../lib/scan-engine-backoff.mjs';
import { createScanLogger } from '../lib/scan-log.mjs';
import { loadPortalsForProfile, titleRecallPatterns } from '../lib/scan-targeting.mjs';
import { explainTitle } from '../lib/scan-decision.mjs';
import { isNonJobTitle } from '../lib/scan-title-junk.mjs';

test('(B) an empty or loading page gets one extra wait, a page with real text does not', () => {
  assert.equal(needsLongerWait(''), true);
  assert.equal(needsLongerWait('Careers'), true);
  assert.equal(needsLongerWait(`Loading ${'x '.repeat(400)}`), true);
  assert.equal(needsLongerWait('Our open roles and culture. '.repeat(40)), false);
  assert.match(CONSENT_DISMISS_SCRIPT, /accept/);
});

test('(B) the server polls, dismisses consent once, extends once, and returns at once when listings exist', () => {
  const src = read(new URL('../ui/server.mjs', import.meta.url), 'utf8');
  assert.equal((src.match(/CONSENT_DISMISS_SCRIPT/g) || []).length >= 3, true);
  assert.match(src, /needsLongerWait\(bodyText\)/);
  assert.match(src, /extended: true/);
  assert.match(src, /if \(jobs\.length\) \{\n\s+if \(attempts > 1\)/);
});

test('(C) a blocked engine rests with doubling, jittered backoff and is cleared by a success', () => {
  let t = 1000;
  const b = createEngineBackoff({ baseMs: 1000, maxMs: 8000, jitter: 0, now: () => t });
  assert.equal(b.cooling('brave'), false);
  assert.equal(b.fail('brave'), 1000);
  assert.equal(b.cooling('brave'), true);
  assert.equal(b.fail('brave'), 2000);
  t += 2001;
  assert.equal(b.cooling('brave'), false);
  for (let i = 0; i < 6; i++) b.fail('brave');
  assert.ok(b.remainingMs('brave') <= 8000);
  b.ok('brave');
  assert.equal(b.cooling('brave'), false);
  const j = createEngineBackoff({ baseMs: 1000, jitter: 0.25, rand: () => 1, now: () => 0 });
  assert.equal(j.fail('g'), 1250);
});

test('(C) query spacing waits spacingMs with jitter and is off at 0', async () => {
  let t = 0; const slept = [];
  const space = createQuerySpacer({ spacingMs: 400, jitter: 0, now: () => t, sleep: async ms => { slept.push(ms); t += ms; } });
  await space();
  t += 100;
  await space();
  assert.deepEqual(slept, [400, 300]);
  assert.equal(await createQuerySpacer({ spacingMs: 0 })(), 0);
});

test('(C) the engine loop skips a cooling engine for another one and logs why', () => {
  const src = read(new URL('../ui/server.mjs', import.meta.url), 'utf8');
  assert.match(src, /engineBackoff\.cooling\(id\) && engines\.some/);
  assert.match(src, /blocked \(challenge\/captcha\): resting \$\{Math\.round\(restMs \/ 1000\)\}s, next engine/);
  assert.match(src, /await querySpacer\(\)/);
});

test('(B/C) a failed challenge solve is not retried on the same host for a while; detail pages stop on budget or two timeouts', () => {
  let t = 0;
  const c = createSolveCooldown({ ttlMs: 1000, now: () => t });
  assert.equal(c.blocked('https://grab.careers/jobs'), false);
  c.fail('https://grab.careers/jobs');
  assert.equal(c.blocked('https://grab.careers/other'), true);
  t = 1001;
  assert.equal(c.blocked('https://grab.careers/jobs'), false);
  const b = createDetailBudget({ budgetMs: 100, maxConsecutiveFails: 2, now: () => t });
  assert.equal(b.ok(), true);
  b.note(false); assert.equal(b.ok(), true);
  b.note(true); b.note(false); assert.equal(b.ok(), true);
  b.note(false); assert.equal(b.ok(), false);
  const slow = createDetailBudget({ budgetMs: 100, now: () => t });
  t += 101; assert.equal(slow.ok(), false);
});

test('(D) the scan log is written per day, capped, pruned, with a per-company summary', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scanlog-'));
  let now = new Date('2026-10-19T05:00:00Z');
  const log = createScanLogger({ dir, keepDays: 2, maxBytes: 200, now: () => now });
  writeFileSync(join(dir, 'scan-2026-10-10.log'), 'old');
  assert.equal(log.line('log', '[scan] [pinchtab] "Retool" 50 jobs, 0 after filter'), true);
  assert.ok(!existsSync(join(dir, 'scan-2026-10-10.log')));
  assert.match(readFileSync(join(dir, 'scan-2026-10-19.log'), 'utf8'), /2026-10-19T05:00:00.000Z LOG \[scan\] \[pinchtab\] "Retool"/);
  for (let i = 0; i < 10; i++) log.line('warn', '[scan] ' + 'x'.repeat(40));
  assert.ok(readFileSync(join(dir, 'scan-2026-10-19.log'), 'utf8').length < 600);
  assert.equal(log.summary({ company: 'Webflow', engine: 'pinchtab', found: 10, afterFilter: 2, junkIgnored: 8 }), true);
  const row = JSON.parse(readFileSync(join(dir, 'scan-companies.jsonl'), 'utf8').trim());
  assert.deepEqual([row.company, row.found, row.afterFilter, row.junkIgnored], ['Webflow', 10, 2, 8]);
  now = new Date('2026-10-20T05:00:00Z');
  log.line('log', '[scan] next day');
  assert.ok(readdirSync(dir).includes('scan-2026-10-20.log'));
  const small = createScanLogger({ dir, maxSummaryLines: 3 });
  for (let i = 0; i < 6; i++) small.summary({ i });
  assert.equal(readFileSync(join(dir, 'scan-companies.jsonl'), 'utf8').trim().split('\n').length, 3);
});

test('(D) the server mirrors [scan] lines and records a summary per careers company', () => {
  const src = read(new URL('../ui/server.mjs', import.meta.url), 'utf8');
  assert.match(src, /text\.startsWith\('\[scan\]'\)\) scanLog\.line\(level, text\)/);
  assert.equal((src.match(/scanLog\.summary\(\{ company: company\.name/g) || []).length, 3); // pinchtab, local-browser, manatal
});

test('(A) recall: design/product/research title shapes the keyword list missed now pass', () => {
  const tf = loadPortalsForProfile().title_filter;
  for (const title of ['Designer, Product Experience', 'Designer (Product)', 'Staff Designer, Product', 'Principal Designer, Design Systems Platform', 'Lead Designer, UX', 'Senior Designer, Digital Products', 'Design Systems Designer', 'Conversation Designer', 'User Researcher', 'UX Research Lead', 'UX Researcher', 'Product Design Lead', 'Product Design Manager', 'Head of Design']) {
    assert.equal(explainTitle(title, tf).ok, true, title);
  }
});

test('(A) recall: no graphic / industrial / fashion / interior / brand / motion / game design and no bare level + Designer', () => {
  const tf = loadPortalsForProfile().title_filter;
  for (const title of ['Senior Designer', 'Lead Designer', 'Graphic Designer', 'Senior Graphic Designer', 'Staff Industrial Designer', 'Lead Fashion Designer', 'Senior Interior Designer', 'Senior Brand Designer', 'Lead Motion Designer', 'Principal Packaging Designer', 'Senior Game Designer', 'Designer, Fashion', 'Designer, Packaging', 'Junior Product Designer', 'Senior Market Researcher']) {
    assert.equal(explainTitle(title, tf).ok, false, title);
  }
});

test('(A) recall patterns only exist for a design or research profile', () => {
  assert.deepEqual(titleRecallPatterns(['Backend Engineer']), []);
  assert.ok(titleRecallPatterns(['Product Designer']).length >= 4);
  assert.ok(titleRecallPatterns(['UX Researcher']).length >= 1);
});

test('(1) junk titles stay rejected with the new category names', () => {
  for (const title of ['Avocats', 'Juristes', 'Comptables', 'Skip to Main Content']) assert.equal(isNonJobTitle(title), true, title);
});
