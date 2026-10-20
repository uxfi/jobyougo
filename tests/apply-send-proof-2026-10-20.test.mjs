import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sentStateFields } from '../extension/apply-bridge-lib.mjs';
import { applyRelaunchBlock } from '../lib/apply-send-proof.mjs';
import { classifyApplyPage } from '../lib/apply-submit.mjs';

test('only a confirmation read on the page marks a send as confirmed', () => {
  const ok = sentStateFields('thanks for applying');
  assert.equal(ok.state, 'submitted');
  assert.equal(ok.confirmed, true);
  assert.equal(ok.unconfirmed, false);
  assert.equal(ok.confirmEvidence, 'thanks for applying');
});

test('a vanished form or a click with nothing read stays "sent?" (dashboard keeps it Started)', () => {
  for (const ev of ['', 'formulaire disparu', undefined]) {
    const f = sentStateFields(ev);
    assert.equal(f.state, 'submitted');
    assert.equal(f.unconfirmed, true);
    assert.equal(f.confirmed, false);
    assert.match(f.message, /Sent\?/); // the dashboard's isUnconfirmedSend reads this too
  }
});

test('AssessFirst: "verify your email to complete the application" after send is not a sent application', () => {
  const page = classifyApplyPage([{ frameId: 0, title: 'AssessFirst', headings: ['Almost there'], text: 'Verify your email to complete the application for Senior Product Designer. We sent you a link.', fieldCount: 0 }], { stage: 'sent' });
  assert.equal(page.kind, 'email_link');
});

test('"Thank you for your interest" on a posting is not a confirmation', () => {
  const bg = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
  assert.ok(!/thank you for \([^)]*your interest/.test(bg), 'background.js confirmation regex must not accept "your interest"');
  const runner = readFileSync(new URL('../apply-runner.mjs', import.meta.url), 'utf8');
  const en = runner.match(/const CONFIRM_TEXT_EN = "([^"]+)"/)[1];
  const re = new RegExp(en, 'i');
  assert.equal(re.test('thank you for your interest in acme. apply below'), false);
  assert.equal(re.test('thank you for applying to acme!'), true);
  assert.equal(re.test('your application has been submitted'), true);
  const page = classifyApplyPage([{ frameId: 0, title: 'Designer', headings: ['Senior Designer'], text: 'About us ... Thank you for your interest in Acme.', fieldCount: 6 }], { stage: 'sent' });
  assert.notEqual(page.kind, 'confirmed');
});

test('relaunch guard: an offer already sent is not launched again without force', () => {
  assert.equal(applyRelaunchBlock(null), null);
  assert.equal(applyRelaunchBlock({ state: 'needs_human', runId: 'a' }), null);
  const conf = applyRelaunchBlock({ state: 'submitted', runId: 'r1', unconfirmed: false });
  assert.equal(conf.alreadySubmitted, true);
  assert.match(conf.error, /already sent/i);
  const unconf = applyRelaunchBlock({ state: 'submitted', runId: 'r2', unconfirmed: true });
  assert.match(unconf.error, /already sent once.*check the tab or your inbox/i);
});