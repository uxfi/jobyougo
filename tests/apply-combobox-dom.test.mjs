import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { COMBOBOX_OPTION_QUERY } from '../lib/apply-combobox-dom.mjs';

async function launchBrowser() {
  try {
    return await chromium.launch({ headless: true, channel: 'chrome' });
  } catch {
    return await chromium.launch({ headless: true });
  }
}

const browser = await launchBrowser();
const page = await browser.newPage();

async function withContent(html) {
  await page.setContent(`<!doctype html><html><body>${html}</body></html>`);
}

// Regression coverage for the live bug this file's SEL fix addressed: Google
// Places Autocomplete ("Current location"-style fields on Lever/Greenhouse)
// renders suggestions as .pac-item with no role/aria-* markers, so before
// .pac-item was added to SEL, the dropdown was invisible to this function —
// the field fell through to plain keystroke typing, which filled the visible
// text but never fired the widget's own selection handler, leaving the
// field's native required validation unsatisfied ("Please fill out this
// field.") despite a "filled" bookkeeping entry.

test('snapshot mode counts .pac-item rows as options', async () => {
  await withContent(`
    <input data-co-i="0">
    <div class="pac-container">
      <div class="pac-item">Paris, France</div>
      <div class="pac-item">Paris, TX, USA</div>
    </div>
  `);
  const result = await page.evaluate(COMBOBOX_OPTION_QUERY, { mode: 'snapshot', i: 0, allowGlobal: false });
  assert.equal(result.count, 2);
  assert.match(result.sig, /Paris, France/);
});

test('snapshot mode excludes an empty/placeholder .pac-item (still loading)', async () => {
  await withContent(`
    <input data-co-i="0">
    <div class="pac-container">
      <div class="pac-item"></div>
    </div>
  `);
  const result = await page.evaluate(COMBOBOX_OPTION_QUERY, { mode: 'snapshot', i: 0, allowGlobal: false });
  assert.equal(result.count, 0);
});

test('match mode finds a .pac-item by text and stamps data-co-match (not data-co-opt)', async () => {
  await withContent(`
    <input data-co-i="0">
    <div class="pac-container">
      <div class="pac-item">Paris, France</div>
      <div class="pac-item">Lyon, France</div>
    </div>
  `);
  const result = await page.evaluate(COMBOBOX_OPTION_QUERY, { mode: 'match', i: 0, want: 'Paris, France', allowGlobal: false });
  assert.equal(result.matched, 'Paris, France');
  const stamped = await page.evaluate(() => ({
    match: document.querySelector('[data-co-match="1"]')?.textContent,
    opt: document.querySelector('[data-co-opt]'),
  }));
  assert.equal(stamped.match, 'Paris, France');
  assert.equal(stamped.opt, null, 'must not stamp the radio-group data-co-opt attribute');
});

// Regression for the separate data-co-opt/data-co-match collision bug: this
// function used to wipe data-co-opt page-wide (the same attribute
// apply-collect-fields.mjs stamps on radio-group members), silently breaking
// unrelated nameless radio groups filled earlier in the same pass.
test('match mode never touches a pre-existing data-co-opt marker elsewhere on the page', async () => {
  await withContent(`
    <input data-co-i="0">
    <div class="pac-container">
      <div class="pac-item">Paris, France</div>
    </div>
    <button data-co-opt="3:0">Yes</button>
  `);
  await page.evaluate(COMBOBOX_OPTION_QUERY, { mode: 'match', i: 0, want: 'Paris, France', allowGlobal: false });
  const optStillThere = await page.evaluate(() => document.querySelector('[data-co-opt="3:0"]') !== null);
  assert.equal(optStillThere, true);
});

test('list mode returns visible option texts including .pac-item', async () => {
  await withContent(`
    <input data-co-i="0">
    <div class="pac-container">
      <div class="pac-item">Paris, France</div>
      <div class="pac-item">Lyon, France</div>
    </div>
  `);
  const result = await page.evaluate(COMBOBOX_OPTION_QUERY, { mode: 'list', i: 0, allowGlobal: false });
  assert.equal(result.count, 2);
  assert.deepEqual(result.texts, ['Paris, France', 'Lyon, France']);
});

test('match mode picks "No, I don\'t require sponsorship" over "None of the above"', async () => {
  await withContent(`
    <input data-co-i="0">
    <div role="listbox">
      <div role="option">None of the above</div>
      <div role="option">Non-binary</div>
      <div role="option">No, I don't require sponsorship</div>
      <div role="option">Yes</div>
    </div>
  `);
  const result = await page.evaluate(COMBOBOX_OPTION_QUERY, { mode: 'match', i: 0, want: 'No', allowGlobal: false });
  assert.equal(result.matched, "No, I don't require sponsorship");
  const stamped = await page.evaluate(() => document.querySelector('[data-co-match="1"]')?.textContent);
  assert.equal(stamped, "No, I don't require sponsorship");
});

test.after(async () => {
  await browser.close();
});
