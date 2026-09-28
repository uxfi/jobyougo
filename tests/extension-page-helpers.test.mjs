/**
 * The Chrome extension runs in-page helpers as real functions, never as
 * source strings: its MV3 isolated world forbids eval, which is why the old
 * probe-form / eval-in-tab path always came back empty. These tests keep the
 * generated copies fresh, keep the service worker loadable, and check the
 * helpers and the per-frame merge in a real Chromium.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { chromium } from 'playwright';
import { OUTPUTS } from '../scripts/sync-extension-page-helpers.mjs';
import {
  PAGE_HELPERS,
  mergeFrameResults,
  listActionLabelsInPage,
  forceResumeSlotInPage,
  pageHtmlInPage,
} from '../extension/page-helper-registry.mjs';
import { APPLICATION_FORM_PROBE } from '../extension/page-helpers.mjs';
import { extractEmbeddedApplyUrl } from '../lib/apply-navigation.mjs';

async function launchBrowser() {
  try {
    return await chromium.launch({ headless: true, channel: 'chrome' });
  } catch {
    return await chromium.launch({ headless: true });
  }
}

const browser = await launchBrowser();
const page = await browser.newPage();
const load = (html) => page.setContent(`<!doctype html><html><body>${html}</body></html>`);

test.after(async () => {
  await browser.close();
});

test('generated extension copies match their lib source', () => {
  for (const [rel, render] of OUTPUTS) {
    const onDisk = readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
    assert.equal(onDisk, render(), `${rel} is stale — run \`npm run sync:extension\``);
  }
});

test('the service worker only imports files inside extension/', () => {
  // One ../ import (lib/ is the tempting one) and Chrome refuses to register
  // the worker: the whole bridge goes dark with no error in the dashboard.
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = readFileSync(new URL(`../extension/${file}`, import.meta.url), 'utf8');
    const specs = [
      ...src.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g),
      ...src.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm),
      ...src.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
    ].map((m) => m[1]);
    for (const spec of specs) {
      assert.match(spec, /^\.\/[\w.-]+$/, `${file} imports "${spec}", outside extension/`);
      visit(spec.slice(2));
    }
  };
  visit('background.js');
  assert.ok(seen.has('page-helper-registry.mjs') && seen.has('page-helpers.mjs'), [...seen].join(', '));
});

test('every registered helper is a function with a known frame scope and merge', () => {
  const merges = new Set(['probe', 'any', 'concat', 'first', 'first-with-frame']);
  for (const [name, spec] of Object.entries(PAGE_HELPERS)) {
    assert.equal(typeof spec.func, 'function', name);
    assert.ok(['main', 'all'].includes(spec.frames), `${name}: frames ${spec.frames}`);
    assert.ok(merges.has(spec.merge), `${name}: merge ${spec.merge}`);
  }
});

test('probe merge: a form in any frame wins, then an auth wall, then the top score', () => {
  const merge = (entries) => mergeFrameResults({ merge: 'probe' }, entries);
  assert.equal(merge([
    { frameId: 0, result: { verdict: 'none', score: 2 } },
    { frameId: 7, result: { verdict: 'application_form', score: 5 } },
  ]).verdict, 'application_form');
  assert.equal(merge([
    { frameId: 0, result: { verdict: 'none', score: 0 } },
    { frameId: 3, result: { verdict: 'auth_wall', score: 0 } },
  ]).verdict, 'auth_wall');
  assert.equal(merge([
    { frameId: 0, result: { verdict: 'none', score: 1 } },
    { frameId: 2, result: { verdict: 'none', score: 2 } },
  ]).score, 2);
  // A frame whose script threw reports null.
  assert.deepEqual(merge([{ frameId: 0, result: null }]), { verdict: 'none', score: 0, signals: [], blockers: [] });
});

test('any / concat / first merges put the main frame first whatever Chrome returns', () => {
  assert.equal(mergeFrameResults({ merge: 'any' }, [{ frameId: 4, result: false }, { frameId: 0, result: true }]), true);
  assert.equal(mergeFrameResults({ merge: 'any' }, [{ frameId: 0, result: false }]), false);

  const entries = [
    { frameId: 5, result: ['Submit', 'Back'] },
    { frameId: 0, result: ['Next', 'Submit'] },
  ];
  assert.deepEqual(mergeFrameResults({ merge: 'concat', key: (t) => t }, entries), ['Next', 'Submit', 'Back']);
  assert.deepEqual(mergeFrameResults({ merge: 'concat', key: (t) => t, limit: 2 }, entries), ['Next', 'Submit']);
  assert.deepEqual(mergeFrameResults({ merge: 'concat' }, entries), ['Next', 'Submit', 'Submit', 'Back']);

  assert.equal(mergeFrameResults({ merge: 'first' }, [{ frameId: 9, result: 'iframe' }, { frameId: 0, result: 'main' }]), 'main');
  assert.equal(mergeFrameResults({ merge: 'first' }, []), null);
  assert.deepEqual(
    mergeFrameResults({ merge: 'first-with-frame' }, [{ frameId: 0, result: null }, { frameId: 6, result: { i: 9901, frameId: 0 } }]),
    { i: 9901, frameId: 6 },
  );
});

test('the generated APPLICATION_FORM_PROBE still tells a form from an auth wall', async () => {
  await load(`
    <div id="application_form"><h1>Apply for this job</h1>
      <input name="first_name"><input type="email" name="email"><input type="file" name="resume">
    </div>`);
  assert.equal((await page.evaluate(APPLICATION_FORM_PROBE)).verdict, 'application_form');
  await load(`
    <h1>Sign in</h1>
    <input type="email" name="email"><input type="password" name="password">
    <button>Log in</button>`);
  assert.equal((await page.evaluate(APPLICATION_FORM_PROBE)).verdict, 'auth_wall');
});

test('action labels: visible, enabled, de-duplicated, submit inputs included', async () => {
  await load(`
    <button>Back</button>
    <button>Next</button><button>Next</button>
    <button disabled>Submit application</button>
    <div aria-disabled="true"><button>Save draft</button></div>
    <button style="display:none">Hidden</button>
    <input type="submit" value="Review">`);
  assert.deepEqual(await page.evaluate(listActionLabelsInPage), ['Back', 'Next', 'Review']);
});

test('forced resume slot prefers the resume input over a cover letter, and stamps it', async () => {
  await load(`
    <input type="file" name="cover_letter" style="display:none">
    <input type="file" name="resume" accept=".pdf" style="display:none">`);
  const slot = await page.evaluate(forceResumeSlotInPage);
  assert.equal(slot.name, 'resume');
  assert.equal(slot.type, 'file');
  assert.equal(await page.getAttribute('[data-co-i="9901"]', 'name'), 'resume');
  await load('<p>No upload here</p>');
  assert.equal(await page.evaluate(forceResumeSlotInPage), null);
});

test('page HTML hands the embedded applicationLink to the lib parser', async () => {
  await load(`<button>Apply</button>
    <script type="application/json">{"applicationLink":"https:\\/\\/jobs.lever.co\\/acme\\/abc\\/apply"}</script>`);
  const snap = await page.evaluate(pageHtmlInPage);
  assert.match(snap.html, /applicationLink/);
  assert.equal(extractEmbeddedApplyUrl(snap.html, 'https://cryptojobslist.com/jobs/x'), 'https://jobs.lever.co/acme/abc/apply');
});
