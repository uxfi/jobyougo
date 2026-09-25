import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { COLLECT_FIELDS } from '../lib/apply-collect-fields.mjs';
import { ACTIVATE_MATCHED_OPTION, COMBOBOX_OPTION_QUERY, COMBOBOX_OPTION_SEL, LIST_SELECTION_STATE } from '../lib/apply-combobox-dom.mjs';
import { selectionLooksCommitted } from '../lib/apply-option-match.mjs';

async function launchBrowser() {
  try {
    return await chromium.launch({ headless: true, channel: 'chrome' });
  } catch {
    return await chromium.launch({ headless: true });
  }
}

const browser = await launchBrowser();
let page = await browser.newPage();

const WIDGET = `<!doctype html><html><body>
<label>Country</label>
<div class="select__container">
  <div class="select__single-value" hidden></div>
  <input id="country" role="combobox" aria-haspopup="listbox" aria-expanded="false" aria-controls="country-menu" autocomplete="off">
</div>
<ul id="country-menu" role="listbox" hidden>
  <li role="option">France</li>
  <li role="option">Thailand</li>
  <li role="option">Germany</li>
</ul>
<label>Years of experience</label>
<button type="button" id="years" aria-haspopup="listbox" aria-expanded="false" aria-controls="years-menu">Select...</button>
<ul id="years-menu" role="listbox" hidden>
  <li role="option">1-2 years</li>
  <li role="option">3-5 years</li>
</ul>
<script>
  const input = document.getElementById('country');
  const menu = document.getElementById('country-menu');
  const chip = document.querySelector('.select__single-value');
  const open = () => { menu.hidden = false; input.setAttribute('aria-expanded', 'true'); };
  const close = () => { menu.hidden = true; input.setAttribute('aria-expanded', 'false'); };
  input.addEventListener('click', open);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') open();
    if (e.key === 'Escape') {
      if (!menu.hidden) close();
      else {
        chip.hidden = true;
        chip.textContent = '';
        input.value = '';
      }
    }
  });
  menu.addEventListener('mousedown', (e) => {
    const opt = e.target.closest('[role="option"]');
    if (!opt) return;
    e.preventDefault();
    chip.hidden = false;
    chip.textContent = opt.textContent.trim();
    input.value = '';
    close();
  });
  const years = document.getElementById('years');
  const yearsMenu = document.getElementById('years-menu');
  years.addEventListener('click', () => {
    yearsMenu.hidden = false;
    years.setAttribute('aria-expanded', 'true');
  });
  yearsMenu.addEventListener('click', (e) => {
    const opt = e.target.closest('[role="option"]');
    if (!opt) return;
    years.textContent = opt.textContent.trim();
    yearsMenu.hidden = true;
    years.setAttribute('aria-expanded', 'false');
  });
</script>
</body></html>`;

async function load() {
  await page.close().catch(() => {});
  page = await browser.newPage();
  await page.setContent(WIDGET);
  return page.evaluate(COLLECT_FIELDS);
}

function committed(state, extra = {}) {
  return selectionLooksCommitted({ ...state, ...extra });
}

test('clicking a list option commits the chip and leaves the input empty', async () => {
  const fields = await load();
  const country = fields.find(f => f.role === 'combobox');
  assert.ok(country, JSON.stringify(fields.map(f => f.label)));
  await page.locator(`[data-co-i="${country.i}"]`).click();
  const matched = await page.evaluate(COMBOBOX_OPTION_QUERY, {
    mode: 'match', want: 'France', i: country.i, allowGlobal: true, sel: COMBOBOX_OPTION_SEL,
  });
  assert.equal(matched.matched, 'France');
  assert.equal(await page.evaluate(ACTIVATE_MATCHED_OPTION), true);
  const state = await page.evaluate(LIST_SELECTION_STATE, { i: country.i });
  assert.equal(committed(state, { query: 'France', clickedText: 'France' }), 'France');
  assert.equal(state.inputValue, '');
  assert.equal(state.displayed, 'France');
});

test('typing the answer into the closed list is not a selection', async () => {
  const fields = await load();
  const country = fields.find(f => f.role === 'combobox');
  const loc = page.locator(`[data-co-i="${country.i}"]`);
  await loc.fill('France');
  const state = await page.evaluate(LIST_SELECTION_STATE, { i: country.i });
  assert.equal(committed(state, { query: 'France', filterTyped: 'Fra' }), null);
  assert.equal(state.displayed, '');
  await loc.fill('');
  assert.equal(await loc.inputValue(), '');
});

test('Escape after a committed choice clears it, so the filler must not send Escape', async () => {
  const fields = await load();
  const country = fields.find(f => f.role === 'combobox');
  await page.locator(`[data-co-i="${country.i}"]`).click();
  const matched = await page.evaluate(COMBOBOX_OPTION_QUERY, {
    mode: 'match', want: 'France', i: country.i, allowGlobal: true, sel: COMBOBOX_OPTION_SEL,
  });
  assert.equal(matched.matched, 'France', JSON.stringify(matched));
  assert.equal(await page.evaluate(ACTIVATE_MATCHED_OPTION), true);
  const before = await page.evaluate(LIST_SELECTION_STATE, { i: country.i });
  assert.equal(before.displayed, 'France');
  await page.locator(`[data-co-i="${country.i}"]`).press('Escape');
  const after = await page.evaluate(LIST_SELECTION_STATE, { i: country.i });
  assert.equal(after.displayed, '');
  assert.equal(committed(after, { query: 'France' }), null);
});

test('a button list commits the option text, not Select...', async () => {
  const fields = await load();
  const years = fields.find(f => f.ariaHaspopup === 'listbox' && f.tag === 'button');
  assert.ok(years, JSON.stringify(fields));
  await page.locator(`[data-co-i="${years.i}"]`).click();
  const matched = await page.evaluate(COMBOBOX_OPTION_QUERY, {
    mode: 'match', want: '3-5 years', i: years.i, allowGlobal: true, sel: COMBOBOX_OPTION_SEL,
  });
  assert.equal(matched.matched, '3-5 years', JSON.stringify(matched));
  assert.equal(await page.evaluate(ACTIVATE_MATCHED_OPTION), true);
  const state = await page.evaluate(LIST_SELECTION_STATE, { i: years.i });
  assert.equal(committed(state, { query: '3-5', clickedText: '3-5 years' }), '3-5 years');
  assert.equal(state.buttonText, '3-5 years');
});

test.after(async () => {
  await browser.close();
});
