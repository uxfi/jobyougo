// lib/pinchtab.mjs: the sweep after a timed-out navigate must not close the
// blank or search tabs of navigations other callers still have in flight
// (2026-10-17, five date lookups at once during a scan).
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.PINCHTAB_URL = 'http://pinchtab.test';
process.env.PINCHTAB_TOKEN = 'test-token';
const { pinchtabClose, pinchtabCloseStaleTabs } = await import('../lib/pinchtab.mjs');

const TARGET = 'https://www.coinbase.com/careers/positions/8114474?gh_jid=8114474';
const TABS = [
  { id: 'T_TARGET', url: TARGET },
  { id: 'T_BLANK', url: 'about:blank' },
  { id: 'T_SEARCH', url: 'https://duckduckgo.com/?q=designer' },
  { id: 'T_OTHER', url: 'https://example.com/job/1' },
  { id: 'T_KEEP', url: TARGET },
];

function stubFetch({ closeFails = false } = {}) {
  const closed = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/tabs') return Response.json({ tabs: TABS });
    if (path === '/close') {
      if (closeFails) return new Response('busy', { status: 500 });
      closed.push(JSON.parse(init.body).tabId);
      return Response.json({ ok: true });
    }
    return new Response('not found', { status: 404 });
  };
  return closed;
}

test('onlyUrls closes the timed-out URL alone', async () => {
  const closed = stubFetch();
  await pinchtabCloseStaleTabs({ urls: new Set([TARGET]), keep: new Set(['T_KEEP']), onlyUrls: true });
  assert.deepEqual(closed, ['T_TARGET']);
});

test('the default sweep still closes blank and search tabs', async () => {
  const closed = stubFetch();
  await pinchtabCloseStaleTabs({ urls: new Set([TARGET]), keep: new Set(['T_KEEP']) });
  assert.deepEqual(closed, ['T_TARGET', 'T_BLANK', 'T_SEARCH']);
});

test('pinchtabClose says whether the daemon closed the tab', async () => {
  stubFetch();
  assert.equal(await pinchtabClose('T_OTHER'), true);
  stubFetch({ closeFails: true });
  assert.equal(await pinchtabClose('T_OTHER'), false);
  assert.equal(await pinchtabClose(undefined), true);
});
