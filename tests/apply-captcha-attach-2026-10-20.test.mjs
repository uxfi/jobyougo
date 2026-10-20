// Captcha on an extension-filled form: PinchTab attached to the user's Chrome
// solves it in that tab; otherwise the old wait for the user is unchanged.
// PinchTab is simulated: no network, no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { solveInAttachedTab, attachCdpUrl, pickAttachedTab } from '../lib/apply-captcha-attach.mjs';
import { ApplyBridge } from '../extension/apply-bridge-lib.mjs';

const ENV = { PINCHTAB_ATTACH_CDP_URL: 'http://127.0.0.1:9222' };
const FORM = 'https://jobs.ashbyhq.com/darkroom/7f7a/application';
const deps = (over = {}) => ({
  health: async () => true,
  instances: async () => [],
  attach: async () => ({ id: 'inst_1' }),
  instanceTabs: async () => [{ id: 'T9', url: 'https://other.example/' }, { id: 'T1', url: FORM }],
  solve: async (tabId) => ({ solved: tabId === 'T1', challengeType: 'recaptcha-v2' }),
  ...over,
});

test('attach not configured: unavailable, nothing called', async () => {
  let called = false;
  const r = await solveInAttachedTab({ url: FORM, kind: 'captcha', env: {}, deps: deps({ health: async () => { called = true; return true; } }) });
  assert.equal(r.available, false);
  assert.equal(called, false);
});

test('only a loopback CDP URL is accepted', () => {
  assert.equal(attachCdpUrl({ PINCHTAB_ATTACH_CDP_URL: 'http://10.0.0.5:9222' }), '');
  assert.equal(attachCdpUrl(ENV), 'http://127.0.0.1:9222');
});

test('solved in the form tab found by URL', async () => {
  const r = await solveInAttachedTab({ url: FORM, kind: 'captcha', env: ENV, deps: deps() });
  assert.deepEqual([r.available, r.solved], [true, true]);
  assert.equal(pickAttachedTab([{ id: 'A', url: FORM + '/' }], FORM), 'A');
});

test('an existing attached instance is reused, not attached twice', async () => {
  let attached = 0;
  const r = await solveInAttachedTab({ url: FORM, kind: 'challenge', env: ENV, deps: deps({ instances: async () => [{ id: 'inst_7', name: 'jobyougo-chrome', status: 'running' }], attach: async () => { attached++; return { id: 'x' }; } }) });
  assert.equal(r.solved, true);
  assert.equal(attached, 0);
});

test('PinchTab down, tab missing or error: unavailable (old path)', async () => {
  for (const over of [{ health: async () => false }, { instanceTabs: async () => [] }, { attach: async () => { throw new Error('403 attach disabled'); } }]) {
    const r = await solveInAttachedTab({ url: FORM, kind: 'captcha', env: ENV, deps: deps(over) });
    assert.equal(r.available, false);
  }
  const notCaptcha = await solveInAttachedTab({ url: FORM, kind: 'email_code', env: ENV, deps: deps() });
  assert.equal(notCaptcha.available, false, 'an e-mail code is never sent to PinchTab');
});

function bridgeWith({ solveResult, after }) {
  const b = Object.create(ApplyBridge.prototype);
  b.pageSignals = async () => [{ frameId: 0, url: FORM }];
  b.pageState = async () => after;
  b.solveCaptcha = async () => solveResult;
  return b;
}
const run = () => { const msgs = []; return { tabId: 1, originUrl: FORM, msgs, push: async (m) => { msgs.push(m); } }; };

test('bridge: solved and gone → resolved, no wait', async () => {
  const r = run();
  const out = await bridgeWith({ solveResult: { available: true, solved: true, reason: 'recaptcha-v2' }, after: { kind: 'none' } })._solveViaAttach(r, { kind: 'captcha' }, 'form');
  assert.equal(out.status, 'resolved');
  assert.match(r.msgs[0], /résolu via PinchTab/);
});

test('bridge: failure or still shown → null (the old wait runs)', async () => {
  const r = run();
  assert.equal(await bridgeWith({ solveResult: { available: true, solved: false }, after: { kind: 'none' } })._solveViaAttach(r, { kind: 'captcha' }, 'form'), null);
  assert.equal(await bridgeWith({ solveResult: { available: true, solved: true }, after: { kind: 'captcha' } })._solveViaAttach(r, { kind: 'captcha' }, 'form'), null);
});

test('bridge: attach unavailable → null and no message (behaviour unchanged)', async () => {
  const r = run();
  assert.equal(await bridgeWith({ solveResult: { available: false }, after: { kind: 'none' } })._solveViaAttach(r, { kind: 'captcha' }, 'form'), null);
  assert.equal(r.msgs.length, 0);
  assert.equal(await bridgeWith({ solveResult: { available: true, solved: true }, after: { kind: 'none' } })._solveViaAttach(r, { kind: 'email_code' }, 'sent'), null, 'e-mail codes still wait for Hugo');
});
test('an attached instance listed without a name (live /instances shape) is reused', async () => {
  let attached = 0;
  const r = await solveInAttachedTab({ url: FORM, kind: 'captcha', env: ENV, deps: deps({
    instances: async () => [{ id: 'inst_59b2', status: 'running', attached: false, mode: 'headless' }, { id: 'inst_att', status: 'running', attached: true }],
    attach: async () => { attached++; return { id: 'new' }; },
    instanceTabs: async (id) => (id === 'inst_att' ? [{ id: 'T1', instanceId: id, title: 'x', url: FORM }] : []),
  }) });
  assert.equal(attached, 0);
  assert.equal(r.solved, true);
});

test('only the headless default instance: attach is called once', async () => {
  let attached = 0;
  await solveInAttachedTab({ url: FORM, kind: 'captcha', env: ENV, deps: deps({
    instances: async () => [{ id: 'inst_59b2', status: 'running', attached: false }],
    attach: async () => { attached++; return { id: 'inst_1' }; },
  }) });
  assert.equal(attached, 1);
});
