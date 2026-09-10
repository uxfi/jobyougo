import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { blockerProbe, BLOCKER_PROBE_ARGS } from '../lib/apply-blocker-probe.mjs';

const browser = await chromium.launch({headless:true});
test.after(() => browser.close());
async function probe(html) {
  const page = await browser.newPage();
  try {
    await page.setContent(html);
    return await page.evaluate(blockerProbe, BLOCKER_PROBE_ARGS);
  } finally { await page.close(); }
}
test('visible unsolved challenge pauses the application', async () => {
  assert.equal(await probe('<div class="g-recaptcha" style="width:300px;height:80px"></div>'), 'captcha');
});
test('hidden widgets do not interrupt form filling', async () => {
  for (const style of ['visibility:hidden','display:none','opacity:0']) {
    assert.equal(await probe(`<div class="g-recaptcha" style="width:300px;height:80px;${style}"></div><input name="email">`), null);
  }
  assert.equal(await probe('<div aria-hidden="true"><div class="g-recaptcha" style="width:300px;height:80px"></div></div>'),null);
});
test('passive badge is not an interactive challenge', async () => {
  assert.equal(await probe('<div class="grecaptcha-badge"><div class="g-recaptcha" style="width:300px;height:80px"></div></div>'),null);
});
test('real security interstitial remains blocked', async () => {
  assert.equal(await probe('<h1>Checking your browser</h1>'),'cloudflare');
});
test('weak marker in a third-party ad iframe does not block the page', async () => {
  // Regression: Google's ad-fraud recaptcha/api2/aframe (loaded by AdSense/
  // DoubleClick slots on real job postings) ships short boilerplate copy
  // containing the bare word "captcha" — unrelated to the site's own bot
  // check. Only the main frame should trust a weak marker.
  const page = await browser.newPage();
  try {
    await page.setContent('anti-fraud and anti-abuse applications only. see google.com/recaptcha');
    const found = await page.evaluate(blockerProbe, { ...BLOCKER_PROBE_ARGS, isMainFrame: false });
    assert.equal(found, null);
  } finally { await page.close(); }
});
test('weak marker on the main frame still blocks (short page)', async () => {
  assert.equal(await probe('<p>Additional verification required</p>'), 'cloudflare');
});
