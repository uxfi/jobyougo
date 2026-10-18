// lib/pinchtab.mjs: a browser that stops opening tabs (2026-10-16, ~44 h up,
// 4 tabs open) gets one soft restart, then the navigation is retried.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.PINCHTAB_URL = 'http://pinchtab.test';
process.env.PINCHTAB_TOKEN = 'test-token';
const { pinchtabCannotOpenTabs, pinchtabNavigate } = await import('../lib/pinchtab.mjs');

const NO_TAB = '{"code":"error","error":"new tab: create tab: browser did not open a new tab within 10s"}';
const HEALTH = { status: 'ok', defaultInstance: { id: 'inst_1', status: 'running' } };

function stubFetch(navigateAnswers) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    calls.push(`${init.method || 'GET'} ${path}`);
    if (path === '/health') return Response.json(HEALTH);
    if (path === '/instances/inst_1/restart') return new Response('', { status: 200 });
    if (path === '/navigate') {
      const next = navigateAnswers.shift();
      return next === 'broken' ? new Response(NO_TAB, { status: 500 }) : Response.json({ tabId: next });
    }
    return new Response('not found', { status: 404 });
  };
  return calls;
}

test('the "no new tab" error is recognised', () => {
  assert.ok(pinchtabCannotOpenTabs(new Error(`pinchtab POST /navigate → HTTP 500: ${NO_TAB}`)));
  assert.ok(!pinchtabCannotOpenTabs(new Error('pinchtab POST /navigate → HTTP 500: net::ERR_NAME_NOT_RESOLVED')));
});

test('one restart, then the navigation is retried; no second restart inside the cooldown', async () => {
  const calls = stubFetch(['broken', 'TAB1', 'broken']);
  assert.equal(await pinchtabNavigate('https://example.com'), 'TAB1');
  assert.equal(calls.filter(call => call === 'POST /instances/inst_1/restart').length, 1);

  await assert.rejects(pinchtabNavigate('https://example.org'), /did not open a new tab/);
  assert.equal(calls.filter(call => call === 'POST /instances/inst_1/restart').length, 1, 'cooldown: no restart loop');
});
