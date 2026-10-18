// Fixes from the 2026-10-17 run audit. The in-page and bridge code cannot be
// imported without Chrome, so these read the source for the rules that must
// not drift, and run the one regex that carries logic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BRIDGE = readFileSync(join(ROOT, 'extension/apply-bridge-lib.mjs'), 'utf8');
const BACKGROUND = readFileSync(join(ROOT, 'extension/background.js'), 'utf8');

test('a Next inside a form never follows a header link or a link to another site', () => {
  assert.match(BRIDGE, /clickProgression\(run\.tabId, PROGRESS_TEXT_RE, \[\], \{ scrollFirst: true, formStep: true \}\)/);
  assert.match(BACKGROUND, /msg\.formStep === true/);
  const fn = BACKGROUND.slice(BACKGROUND.indexOf('function markAndClickInPage('), BACKGROUND.indexOf('const candidates = []'));
  assert.match(fn, /formStep = false/);
  const consider = BACKGROUND.slice(BACKGROUND.indexOf('const consider = (el) =>'), BACKGROUND.indexOf('const t = labelOf(el)'));
  assert.match(consider, /if \(formStep\)/);
  assert.match(consider, /header, nav, \[role="banner"\], \[role="navigation"\]/);
  assert.match(consider, /to\.origin !== location\.origin/);
});

test('the navigation model only clicks controls that read as a way into an application', () => {
  const m = BRIDGE.match(/const NAV_CTA_WORD_RE = (\/.+\/i);/);
  assert.ok(m, 'NAV_CTA_WORD_RE exists');
  const re = new RegExp(m[1].slice(1, m[1].lastIndexOf('/')), 'i');
  for (const ok of ['Apply now', 'Postuler', 'Continue', 'Get started', 'View job', 'I agree', 'OK']) assert.ok(re.test(ok), ok);
  for (const no of ['Kraken', 'Senior Product Designer', 'Stripe', 'Toktok']) assert.ok(!re.test(no), no);
  assert.match(BRIDGE, /!NAV_CTA_WORD_RE\.test\(ai\.text\)/);
});

test('a send with no confirmation waits for the user instead of marking the run sent', () => {
  const block = BRIDGE.slice(BRIDGE.indexOf('clicked.stillForm && clicked.urlChanged === false'), BRIDGE.indexOf("await push(`Envoyé: « ${clicked.text || 'Submit'} »`, {"));
  assert.match(block, /state: 'needs_human'/);
  assert.doesNotMatch(block, /state: 'submitted'/);
  assert.match(block, /return false;/);
});

test('after a verification code the run waits for the page before sending again', () => {
  const block = BRIDGE.slice(BRIDGE.indexOf('A solved captcha or a typed code often sends the form'), BRIDGE.indexOf('Formulaire toujours affiché après la vérification'));
  assert.match(block, /for \(let wait = 0; wait < 6 && page\.kind === 'none'; wait\+\+\)/);
});

test('a virtualised list is scrolled until the answer is rendered', () => {
  const block = BACKGROUND.slice(BACKGROUND.indexOf('1b) Virtualised lists'), BACKGROUND.indexOf('2) Search lists'));
  assert.match(block, /scroller\.scrollTop \+= /);
  assert.match(block, /scroller\.scrollTop = from;/, 'the list is put back when nothing matched');
  assert.match(block, /const redrawn = async/, 'it never scrolls on before the list has redrawn');
  assert.match(block, /if \(!\(await redrawn\(\)\)\) break;/);
});

test('a typeahead is typed into even when the page-wide scan found rows of another control', () => {
  assert.match(BACKGROUND, /const searchOnly = typable && \/list\|both\/i\.test\(el\.getAttribute\('aria-autocomplete'\)/);
  assert.match(BACKGROUND, /listIsComplete\(shown\.nodes\) && !searchOnly/);
});

// Real page: the click helper itself, lifted from background.js, on a form whose
// question text links to the employer's sign-up page (Kraken, 2026-10-17).
test('inside a form, Next ignores a header link and a link to another site but keeps the real button', async (t) => {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true, channel: 'chrome' }).catch(() => chromium.launch({ headless: true })).catch(() => null);
  if (!browser) return t.skip('no browser available');
  try {
    const start = BACKGROUND.indexOf('function markAndClickInPage(');
    let depth = 0;
    let end = -1;
    for (let k = BACKGROUND.indexOf('{', start); k < BACKGROUND.length; k++) {
      if (BACKGROUND[k] === '{') depth++;
      else if (BACKGROUND[k] === '}' && !--depth) { end = k + 1; break; }
    }
    const fn = BACKGROUND.slice(start, end);
    const page = await browser.newPage();
    const html = (button) => `<header><a href="https://www.kraken.com/sign-up">Get started</a></header>
      <form><p>Used a product? <a href="https://www.kraken.com/sign-up" target="_blank">get started</a>.</p>${button}</form>`;
    const re = '^(continue|next|get[ ]started)$';
    const pick = async (button, formStep) => {
      await page.setContent(html(button));
      return page.evaluate(({ src, re, formStep }) => {
        const r = (0, eval)(`(${src})`)(re, [], 'NEVERMATCH_xyz', formStep);
        return { clicked: !!r.clicked, text: r.text || '', marked: (r.marked || []).map((m) => m.text) };
      }, { src: fn, re, formStep });
    };
    assert.ok((await pick('', false)).marked.length > 0, 'without formStep the link is a candidate');
    assert.deepEqual((await pick('', true)).marked, [], 'with formStep neither link is');
    const real = await pick('<button type="button">Continue</button>', true);
    assert.equal(real.text, 'Continue');
    assert.equal(real.clicked, true);
  } finally {
    await browser.close();
  }
});
