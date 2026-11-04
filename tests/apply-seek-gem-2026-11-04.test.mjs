// 2026-11-04 auto-apply batch: three of four runs ended unfinished.
// - Two JobsDB (SEEK) runs stopped on "no Apply or Next button" with
//   "Quick apply" on screen: the entry vocabulary did not have it.
// - A Gem form filled only the CV: its six text boxes have no id, name,
//   placeholder or aria, their label is a <span> beside a wrapper three levels
//   up, so they all came out as "text", merged into one optional field, and
//   the run never sent ("aucun email rempli").
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { APPLY_TEXT_RE, AUTO_APPLY_TEXT_RE, SUBMIT_TEXT_RE } from '../lib/apply-progression.mjs';
import { AUTH_AVOID_TEXT_RE } from '../lib/form-detect.mjs';
import { COLLECT_FIELDS } from '../lib/apply-collect-fields.mjs';

test('SEEK "Quick apply" is an entry button, never a send or a board auto-apply', () => {
  for (const label of ['Quick apply', 'Quick Apply', 'สมัครด่วน', 'สมัครงาน', 'สมัคร']) {
    assert.equal(APPLY_TEXT_RE.test(label), true, label);
  }
  assert.equal(AUTO_APPLY_TEXT_RE.test('Quick apply'), false);
  assert.equal(SUBMIT_TEXT_RE.test('Quick apply'), false);
  // the Thai sign-up word starts like "apply" and must not be taken for it
  assert.equal(APPLY_TEXT_RE.test('สมัครสมาชิก'), false);
});

test('Thai sign-in and sign-up labels are avoided; English ones still are', () => {
  for (const label of ['เข้าสู่ระบบ', 'สมัครสมาชิก', 'ลงทะเบียน', 'Sign in', 'Create an account', 'Se connecter']) {
    assert.equal(AUTH_AVOID_TEXT_RE.test(label), true, label);
  }
  for (const label of ['Quick apply', 'สมัครด่วน', 'Apply now', 'Signing bonus details']) {
    assert.equal(AUTH_AVOID_TEXT_RE.test(label), false, label);
  }
});

async function launchBrowser() {
  try {
    return await chromium.launch({ headless: true, channel: 'chrome' });
  } catch {
    return await chromium.launch({ headless: true });
  }
}

test('Gem: a label beside a wrapper names the box inside it', async (t) => {
  const browser = await launchBrowser();
  t.after(() => browser.close());
  const page = await browser.newPage();
  // Gem's markup (jobs.gem.com, 2026-11-04), trimmed to the structure
  const field = (label) => `<div class="flex-30" style="display:flex;flex-direction:column">
      <span class="bodyImportant-47">${label}<span class="requiredAsterisk-76"> *</span></span>
      <div class="textField-77"><div class="inputWrapper-80"><div class="inputElementAndIconWrapper-81">
        <input data-1p-ignore="true" class="input-84" type="text" value="" style="width:200px;height:24px">
      </div></div></div>
    </div>`;
  await page.setContent(`<!doctype html><html><body><div class="form-38">
    ${['First name', 'Last name', 'Email', 'Phone number'].map(field).join('')}
  </div></body></html>`);
  const fields = await page.evaluate(COLLECT_FIELDS);
  assert.deepEqual(fields.map((f) => f.label), ['First name *', 'Last name *', 'Email *', 'Phone number *']);
  assert.ok(fields.every((f) => f.required), JSON.stringify(fields.map((f) => [f.label, f.required])));
});

test('a wrapper holding another box does not lend its neighbour label', async (t) => {
  const browser = await launchBrowser();
  t.after(() => browser.close());
  const page = await browser.newPage();
  // Two bare boxes share one wrapper: the walk must stop there instead of
  // naming both after the span above the pair.
  await page.setContent(`<!doctype html><html><body>
    <div><span>Start and end dates</span>
      <div class="pair"><div><input type="text" style="width:120px;height:24px"></div><div><input type="text" style="width:120px;height:24px"></div></div>
    </div></body></html>`);
  const fields = await page.evaluate(COLLECT_FIELDS);
  assert.equal(fields.some((f) => f.label === 'Start and end dates'), false, JSON.stringify(fields.map((f) => f.label)));
});
