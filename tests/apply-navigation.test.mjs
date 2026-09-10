import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { navigationCandidate, watchApplicationTransition, exploreApplicationInterface } from '../lib/apply-navigation.mjs';

function browserFlow(pages) {
  let index = 0;
  const actions = [];
  const closed = [];
  return {
    actions, closed,
    async navigate() { return 'isolated-tab'; },
    async evaluate(tab, expression) {
      return expression === 'location.href' ? pages[index].url : { verdict: pages[index].verdict || 'none' };
    },
    async snapshot() { return { nodes: pages[index].nodes || [] }; },
    async action(tab, action) {
      actions.push(action);
      if (action.kind === 'click') index = Math.min(index + 1, pages.length - 1);
    },
    async close(tab) { closed.push(tab); },
  };
}

test('PinchTab follows repeated Apply labels on distinct URLs and probes the final step', async () => {
  const browser = browserFlow([
    { url: 'https://board.example/job', nodes: [{ role: 'link', name: 'Apply', ref: 'e1' }] },
    { url: 'https://ats.example/job', nodes: [{ role: 'button', name: 'Apply', ref: 'e2' }] },
    { url: 'https://ats.example/form', verdict: 'application_form' },
  ]);
  assert.equal(await exploreApplicationInterface('https://board.example/job', { browser, maxSteps: 2, settleMs: 0 }), 'https://ats.example/form');
  assert.deepEqual(browser.actions.map(a => a.ref), ['e1', 'e2']);
  assert.deepEqual(browser.closed, ['isolated-tab']);
});

test('PinchTab takes only the guest path through an auth wall', async () => {
  const browser = browserFlow([
    { url: 'https://board.example/job', verdict: 'auth_wall', nodes: [
      { role: 'button', name: 'Apply', ref: 'e1' },
      { role: 'button', name: 'Sign up', ref: 'e2' },
      { role: 'button', name: 'Continue as Guest', ref: 'e3' },
    ] },
    { url: 'https://board.example/form', verdict: 'application_form' },
  ]);
  assert.equal(await exploreApplicationInterface('https://board.example/job', { browser, settleMs: 0 }), 'https://board.example/form');
  assert.deepEqual(browser.actions.map(a => a.ref), ['e3']);
});

test('PinchTab stops at auth walls without guest access and closes its tab', async () => {
  const browser = browserFlow([{ url: 'https://board.example/login', verdict: 'auth_wall', nodes: [{ role: 'button', name: 'Apply', ref: 'e1' }] }]);
  assert.equal(await exploreApplicationInterface('https://board.example/login', { browser, settleMs: 0 }), null);
  assert.equal(browser.actions.length, 0);
  assert.deepEqual(browser.closed, ['isolated-tab']);
});

test('PinchTab avoids a no-op click loop on the same page', async () => {
  const browser = browserFlow([{ url: 'https://board.example/job', nodes: [{ role: 'button', name: 'Apply', ref: 'e1' }] }]);
  assert.equal(await exploreApplicationInterface('https://board.example/job', { browser, maxSteps: 3, settleMs: 0 }), null);
  assert.deepEqual(browser.actions.map(a => a.kind), ['click', 'scroll', 'scroll']);
});

test('PinchTab closes the isolated tab when observation fails', async () => {
  const browser = browserFlow([{ url: 'https://board.example/job' }]);
  browser.snapshot = async () => { throw new Error('connection lost'); };
  await assert.rejects(exploreApplicationInterface('https://board.example/job', { browser }), /connection lost/);
  assert.deepEqual(browser.closed, ['isolated-tab']);
});

test('navigation rejects submission and auth controls', () => {
  const nodes = ['Submit application', 'Sign up', 'Continue with Google', 'Apply'].map((name, i) => ({name, role:'button', ref:`e${i}`}));
  assert.equal(navigationCandidate(nodes, new Set()).name, 'Apply');
  assert.equal(navigationCandidate(nodes, new Set(['button:Apply'])), undefined);
});

test('watchdog follows delayed popup and removes listener', async () => {
  const page = new EventEmitter();
  page.isClosed = () => false;
  const popup = {isClosed: () => false};
  const result = watchApplicationTransition(page, {
    timeoutMs: 300, intervalMs: 5,
    findForm: async p => ({frame: p === popup ? 'form' : null}),
  });
  setTimeout(() => page.emit('popup', popup), 20);
  assert.equal((await result).page, popup);
  assert.equal(page.listenerCount('popup'), 0);
});

test('watchdog returns explicit absence on timeout', async () => {
  const page = new EventEmitter();
  page.isClosed = () => false;
  const result = await watchApplicationTransition(page, {timeoutMs:20, intervalMs:5, findForm:async()=>({})});
  assert.equal(result.frame, null);
  assert.equal(page.listenerCount('popup'), 0);
});
