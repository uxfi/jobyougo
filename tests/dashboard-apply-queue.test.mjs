// The applications list can tick several offers and apply them one after
// another (ui/index.html, no build step): a check box per queueable row, a
// sticky bulk bar, and a chain that opens the apply modal per offer and reads
// back how each one ended. Source assertions keep that wiring from drifting.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = readFileSync(join(ROOT, 'ui/index.html'), 'utf8');

test('applications state carries the selection and the running chain', () => {
  assert.match(INDEX, /selectedApplicationNums: new Set\(\)/);
  assert.match(INDEX, /applyChain: null/);
  assert.match(INDEX, /deferredApplyRuns: \[\]/);
});

test('a human-blocked offer can be deferred, monitored, and resumed without relaunching it', () => {
  const modal = INDEX.slice(INDEX.indexOf('function openAutoApplyModal('), INDEX.indexOf('async function openApplyHelper('));
  assert.match(modal, /upsertDeferredApplyRun\(deferredRun\)/);
  assert.match(modal, /resumeRunId\)\s*\{/);
  assert.match(modal, /runId = app\.resumeRunId/);
  assert.match(INDEX, /function resumeDeferredApply\(run\)/);
  assert.match(INDEX, /data-resume-apply=/);
  assert.match(INDEX, /if \(consecutiveErrors >= 5\) return/);
});

test('the last offer labels the defer action as finishing the queue', () => {
  assert.match(INDEX, /chain\.current >= chain\.total \? 'Finish queue' : 'Next offer'/);
  assert.match(INDEX, /result\.state === 'deferred'\) chain\.deferred \+= 1/);
});

test('the bulk bar sits between the filters and the list', () => {
  const filters = INDEX.indexOf('id="app-filters"');
  const bar = INDEX.indexOf('id="app-bulk-bar"');
  const list = INDEX.indexOf('id="app-tbody"');
  assert.ok(filters > 0 && bar > filters && list > bar, 'filters → bulk bar → list');
});

test('only offers with a report, not sent and not closed, get a check box', () => {
  const fn = INDEX.slice(INDEX.indexOf('function canQueueApply('), INDEX.indexOf('function applySelectButtonLabel('));
  assert.match(fn, /extractReportFilename\(app\.Report\)/);
  assert.match(fn, /!isAppliedStatus\(status\)/);
  assert.match(fn, /!isClosedApplicationStatus\(status\)/);
  assert.match(INDEX, /data-app-select="\$\{numAttr\}"/);
  assert.match(INDEX, /class="app-select-spacer"/, 'rows that cannot be queued keep the column aligned');
});

test('the queue runs the modals in turn and reuses the first offer\'s choices', () => {
  const chain = INDEX.slice(INDEX.indexOf('async function applySelectedOffers('), INDEX.indexOf('function openAutoApplyModal('));
  assert.match(chain, /for \(const num of queue\)/);
  assert.match(chain, /await new Promise\(resolve => \{\s*openAutoApplyModal\(\{/);
  assert.match(chain, /autostart: Boolean\(chain\.presets\)/);
  assert.match(chain, /result\.state === 'stopped'/);
  assert.match(chain, /two errors in a row/);

  const modal = INDEX.slice(INDEX.indexOf('function openAutoApplyModal('), INDEX.indexOf('async function openApplyHelper('));
  assert.match(modal, /if \(chain && !chain\.presets\) chain\.presets = choices;/);
  assert.match(modal, /id="aa-skip"/);
  assert.match(modal, /id="aa-stop-queue"/);
  assert.match(modal, /finish\(outcome \|\| \{ ok: false, state: 'stopped' \}\)/, 'closing early stops the queue');
  assert.match(modal, /if \(e\.target === overlay && !chain\) close\(\);/, 'a backdrop click never stops a queue');
  for (const state of ['manual_sent', 'discarded', 'skipped']) {
    assert.match(modal, new RegExp(`state: '${state}'`), `${state} is reported to the queue`);
  }
});

test('while a queue runs, an extension message cannot replace its modal and orphan the chain', () => {
  const modal = INDEX.slice(INDEX.indexOf('function openAutoApplyModal('), INDEX.indexOf('async function openApplyHelper('));
  const guard = modal.indexOf('if (state.applyChain && !app.chain) {');
  assert.ok(guard > 0 && guard < modal.indexOf("getElementById('auto-apply-overlay')?.remove()"), 'refused before the open modal is removed');
  assert.match(modal, /return false;\s*\}/);
  assert.match(modal, /\n {2}return true;\n\}\n/);
  // The tab the plugin started from is told, not left on "Applying…".
  const onTab = INDEX.slice(INDEX.indexOf('async function continueApplyOnTab('), INDEX.indexOf("window.addEventListener('message'"));
  assert.match(onTab, /const opened = openAutoApplyModal\(/);
  assert.match(onTab, /reportOfferTab\(runId, opened \? 'run' : 'warn'/);
});

test('a queue never waits on a stalled, closed or failed offer', () => {
  const modal = INDEX.slice(INDEX.indexOf('function openAutoApplyModal('), INDEX.indexOf('async function openApplyHelper('));
  assert.match(modal, /abandonStalled\('the run stopped reporting'\)/);
  assert.match(modal, /abandonStalled\('this offer took too long'\)/);
  assert.match(modal, /abandonStalled\('the run never reported back'\)/);
  assert.match(modal, /if \(chain && closedOffer\)/);
  assert.match(modal, /Inside a queue a failed or cancelled offer must not wait for a click/);
});
