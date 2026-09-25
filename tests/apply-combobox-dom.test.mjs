import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { COMBOBOX_OPTION_QUERY, COMBOBOX_OPTION_SEL, comboboxQueryArgs } from '../lib/apply-combobox-dom.mjs';

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

async function q(extra) {
  return page.evaluate(COMBOBOX_OPTION_QUERY, comboboxQueryArgs(extra));
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
  const result = await q({ mode: 'snapshot', i: 0, allowGlobal: false });
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
  const result = await q({ mode: 'snapshot', i: 0, allowGlobal: false });
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
  const result = await q({ mode: 'match', i: 0, want: 'Paris, France', allowGlobal: false });
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
  await q({ mode: 'match', i: 0, want: 'Paris, France', allowGlobal: false });
  const optStillThere = await page.evaluate(() => document.querySelector('[data-co-opt="3:0"]') !== null);
  assert.equal(optStillThere, true);
});

// Regression: a dropdown near the bottom of the viewport commonly flips
// UPWARD (react-select/Radix/MUI all do this) to stay on screen. Before the
// "near" window was made symmetric above/below the field, an upward menu
// (rendered well above the field's own top edge) was invisible to an
// unrecognized combobox (allowGlobal:false) and the runner fell through to
// typing raw text into the field instead of clicking the real option.
test('snapshot mode finds an upward-flipped menu (options rendered ABOVE the field)', async () => {
  await withContent(`
    <div style="height:500px"></div>
    <div style="position:relative">
      <div class="pac-container" style="position:absolute; top:-200px; left:0;">
        <div class="pac-item">Paris, France</div>
      </div>
      <input data-co-i="0">
    </div>
  `);
  const result = await q({ mode: 'snapshot', i: 0, allowGlobal: false });
  assert.equal(result.count, 1);
  assert.match(result.sig, /Paris, France/);
});

test('list mode returns visible option texts including .pac-item', async () => {
  await withContent(`
    <input data-co-i="0">
    <div class="pac-container">
      <div class="pac-item">Paris, France</div>
      <div class="pac-item">Lyon, France</div>
    </div>
  `);
  const result = await q({ mode: 'list', i: 0, allowGlobal: false });
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
  const result = await q({ mode: 'match', i: 0, want: 'No', allowGlobal: false });
  assert.equal(result.matched, "No, I don't require sponsorship");
  const stamped = await page.evaluate(() => document.querySelector('[data-co-match="1"]')?.textContent);
  assert.equal(stamped, "No, I don't require sponsorship");
});

test('snapshot counts MUI / Ant / menuitem / mat-option rows', async () => {
  await withContent(`
    <input data-co-i="0">
    <ul>
      <li class="MuiMenuItem-root">France</li>
      <li class="ant-select-item-option">Germany</li>
      <div role="menuitem">Spain</div>
      <mat-option>Italy</mat-option>
    </ul>
  `);
  const result = await q({ mode: 'list', i: 0, allowGlobal: true });
  assert.ok(result.count >= 4, JSON.stringify(result));
  assert.ok(result.texts.some((t) => /France/i.test(t)));
  assert.ok(result.texts.some((t) => /Italy/i.test(t)));
});

test('match mode uses aria-label when option has no visible text', async () => {
  await withContent(`
    <input data-co-i="0">
    <div role="listbox">
      <div role="option" aria-label="Yes, I am authorized" style="width:200px;height:32px"></div>
      <div role="option" aria-label="No, I am not authorized" style="width:200px;height:32px"></div>
    </div>
  `);
  const result = await q({ mode: 'match', i: 0, want: 'Yes', allowGlobal: false });
  assert.equal(result.matched, 'Yes, I am authorized');
});

test('match mode finds Radix / cmdk collection items', async () => {
  await withContent(`
    <input data-co-i="0">
    <div>
      <div data-radix-collection-item>Remote</div>
      <div cmdk-item>Hybrid</div>
      <div class="dropdown-item">On-site</div>
    </div>
  `);
  const remote = await q({ mode: 'match', i: 0, want: 'Remote', allowGlobal: true });
  assert.equal(remote.matched, 'Remote');
  const hybrid = await q({ mode: 'match', i: 0, want: 'Hybrid', allowGlobal: true });
  assert.equal(hybrid.matched, 'Hybrid');
});

test('match mode finds Select2 / Element / Workday-style option rows', async () => {
  await withContent(`
    <input data-co-i="0">
    <ul class="select2-results__options">
      <li class="select2-results__option">Paris</li>
    </ul>
    <li class="el-select-dropdown__item">Lyon</li>
    <div data-automation-id="promptOption-Berlin">Berlin</div>
  `);
  const paris = await q({ mode: 'match', i: 0, want: 'Paris', allowGlobal: true });
  assert.equal(paris.matched, 'Paris');
  const berlin = await q({ mode: 'match', i: 0, want: 'Berlin', allowGlobal: true });
  assert.equal(berlin.matched, 'Berlin');
});

test('match mode accepts containment (Senior Product Manager ↔ Product Manager)', async () => {
  await withContent(`
    <input data-co-i="0">
    <div role="listbox">
      <div role="option">Intern</div>
      <div role="option">Product Manager</div>
      <div role="option">Engineering Manager</div>
    </div>
  `);
  const result = await q({ mode: 'match', i: 0, want: 'Senior Product Manager', allowGlobal: false });
  assert.equal(result.matched, 'Product Manager');
});

test('match mode resolves France country aliases', async () => {
  await withContent(`
    <input data-co-i="0">
    <div role="listbox">
      <div role="option">Germany</div>
      <div role="option">France</div>
      <div role="option">Spain</div>
    </div>
  `);
  const result = await q({ mode: 'match', i: 0, want: 'FR', allowGlobal: false });
  assert.equal(result.matched, 'France');
});

test('COMBOBOX_OPTION_SEL includes Workday and Select2 tokens', () => {
  assert.match(COMBOBOX_OPTION_SEL, /select2-results__option/);
  assert.match(COMBOBOX_OPTION_SEL, /promptOption/i);
  assert.match(COMBOBOX_OPTION_SEL, /el-select-dropdown__item/);
  assert.match(COMBOBOX_OPTION_SEL, /spl-option/);
});

test.after(async () => {
  await browser.close();
});
