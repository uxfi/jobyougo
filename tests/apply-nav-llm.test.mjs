import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterNavButtons,
  parseNavDecision,
  resolveNavAction,
  navDecisionLog,
} from '../lib/apply-nav-llm.mjs';

test('filterNavButtons drops auth, back, and already tried labels', () => {
  const out = filterNavButtons([
    { text: 'Continue with Google' },
    { text: 'Sign in' },
    { text: 'Back' },
    { text: 'Next' },
    { text: 'Apply without account' },
  ], ['Next']);
  assert.deepEqual(out.map((b) => b.text), ['Apply without account']);
});

test('parseNavDecision maps a click index to the button text', () => {
  const d = parseNavDecision(
    '{"action":"click","index":1,"reason":"opens the form"}',
    [{ text: 'Save draft' }, { text: 'Start application' }],
  );
  assert.equal(d.action, 'click');
  assert.equal(d.index, 1);
  assert.equal(d.text, 'Start application');
});

test('parseNavDecision refuses auth and back even if they are listed', () => {
  assert.equal(parseNavDecision('{"action":"click","index":0}', [{ text: 'Sign in' }]).action, 'human');
  assert.equal(parseNavDecision('{"action":"click","index":0}', [{ text: 'Edit' }]).action, 'human');
  assert.equal(parseNavDecision('{"action":"click","index":4}', [{ text: 'Next' }]).action, 'human');
  assert.equal(parseNavDecision('not json', []).action, 'human');
});

test('parseNavDecision accepts review and fill without an index', () => {
  assert.equal(parseNavDecision('{"action":"review","reason":"summary"}', []).action, 'review');
  assert.equal(parseNavDecision('{"action":"fill"}', []).action, 'fill');
});

test('resolveNavAction renumbers after dropping auth and does not call the model with no buttons', async () => {
  const decision = await resolveNavAction({
    phase: 'navigate',
    buttons: [{ text: 'Sign in' }, { text: 'Apply without account' }],
    chat: async () => '{"action":"click","index":0,"reason":"guest"}',
  });
  assert.equal(decision.action, 'click');
  assert.equal(decision.text, 'Apply without account');
  assert.match(navDecisionLog(decision), /Apply without account/);

  let called = false;
  const skipped = await resolveNavAction({
    phase: 'navigate',
    buttons: [{ text: 'Log in' }],
    chat: async () => { called = true; return '{}'; },
  });
  assert.equal(called, false);
  assert.equal(skipped.action, 'human');
  assert.equal(skipped.skipped, true);
  assert.equal(navDecisionLog(skipped), '');
});

test('resolveNavAction returns human when the model is down', async () => {
  const d = await resolveNavAction({
    phase: 'review',
    buttons: [],
    chat: async () => { throw new Error('offline'); },
  });
  assert.equal(d.action, 'human');
  assert.match(d.reason, /indisponible/);
});
