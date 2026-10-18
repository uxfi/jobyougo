// An evaluation another account runs on the local server used to land in the
// owner's files: the report in reports/ (the watcher pushed it to Supabase
// under the owner's id) and the row in data/applications.md (merged, then
// synced under the owner's id). The account never saw it. The server starts on
// import, so the decision and the post-processing are checked from the source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { reserveReportNumbers, releaseReportNumbers } from '../reserve-report-num.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = readFileSync(join(ROOT, 'ui/server.mjs'), 'utf8');

function sourceOf(name) {
  const start = server.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, `${name} is defined`);
  const end = server.indexOf('\n}\n', start);
  return server.slice(start, end + 2);
}

const OWNER = 'owner-id';
const OTHER = 'other-id';

test('only another account on a local Supabase server keeps its evaluations to itself', async () => {
  const decide = (env, userId) => vm.runInNewContext(`(${sourceOf('evaluationIsAccountOnly')})`, {
    ...env,
    ownsLocalData: async (id) => !env.useSupabase || !id || id === OWNER,
  })(userId);
  const local = { useSupabase: true, IS_VERCEL: false };
  assert.equal(await decide(local, OTHER), true);
  assert.equal(await decide(local, OWNER), false, 'the owner keeps reports/ and the tracker');
  assert.equal(await decide(local, undefined), false);
  assert.equal(await decide({ useSupabase: false, IS_VERCEL: false }, OTHER), false, 'markdown mode has one user');
  assert.equal(await decide({ useSupabase: true, IS_VERCEL: true }, OTHER), false, 'Vercel has its own Supabase path');
});

test("the post-processing never writes another account's evaluation to the owner's report, TSV or tracker", () => {
  const start = server.indexOf('const accountOnly = await evaluationIsAccountOnly(req.userId);');
  assert.ok(start > 0);
  const block = server.slice(start, server.indexOf("if (mode === 'pipeline' && pipelineTarget) {", start));
  assert.match(block, /if \(accountOnly\) \{[\s\S]*?reports\/\$\{num\}-account\.ref`\), ''/, 'an empty marker keeps the number taken');
  assert.match(block, /\} else \{\s*console\.log\(`\[\$\{mode\}\] writing report → reports\/\$\{filename\}`\);/, 'the report file is the owner path only');
  assert.ok(block.includes('if ((IS_VERCEL || accountOnly) && useSupabase) {'), 'the report row goes to Supabase');
  assert.ok(block.includes('const uid = req.userId || await getAdminUserId()'), 'under the account that ran it');
  assert.ok(block.indexOf('if (!accountOnly) {') < block.indexOf("join(WRITE_ROOT, 'batch/tracker-additions')"), 'no TSV for merge-tracker');
  assert.ok(block.includes('if (!IS_VERCEL && !accountOnly) {'), 'no merge-tracker, no owner sync');
  assert.ok(block.includes("upsert(row, { onConflict: 'num' })"), 'the tracker row goes to Supabase');
  assert.ok(block.indexOf('} else if (accountOnly && !reportStored) {') < block.indexOf("upsert(row, { onConflict: 'num' })"), 'no tracker row for a report that was not stored');
  // The account's scan memory (getEvaluatedUrlSet) reads evaluated postings from its tracker rows.
  assert.ok(block.includes('if (jobUrl) row.job_url = jobUrl;'), 'the row carries the posting URL');
  assert.match(block, /if \(appErr && row\.job_url && \/job_url\|schema cache\|column\/i\.test[\s\S]*?delete row\.job_url;/, 'a table without job_url still takes the row');
});

test("an account's scan memory finds its evaluations through the tracker row URL", () => {
  const fn = sourceOf('getEvaluatedUrlSet');
  assert.ok(fn.includes('getApplications(userId)') && fn.includes('job_url'), 'evaluated URLs of an account come from its rows');
});

test('an NNN-account.ref marker keeps the number from the owner allocator', async () => {
  const root = mkdtempSync(join(tmpdir(), 'jyg-account-ref-'));
  try {
    mkdirSync(join(root, 'reports'), { recursive: true });
    mkdirSync(join(root, 'data'), { recursive: true });
    writeFileSync(join(root, 'reports', '041-acme-2026-10-13.md'), '# Evaluation');
    writeFileSync(join(root, 'reports', '042-account.ref'), '');
    const reserved = await reserveReportNumbers(1, { rootDir: root });
    assert.deepEqual(reserved, [43]);
    await releaseReportNumbers(reserved, { rootDir: root });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
