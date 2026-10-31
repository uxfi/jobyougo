// tests/public-url-guard.test.mjs — the offer reader must not be pointed at a
// private address (SSRF): the link is typed by a user, the server reads it.
//
// Before: fetchJobDescriptionText (ui/server.mjs) did a bare fetch() on that
// link, redirects followed, so /api/contact-finder?jobUrl=http://169.254.169.254/…
// or a public page redirecting to http://localhost:3210/… was read and its text
// handed back through the contact finder and the draft. The finder's own page
// reader (createPageFetcher) was already guarded; this one was not.
//
// OFFLINE: DNS and fetch are injected, the one real socket is a loopback server.
//
// Run:  node --test tests/public-url-guard.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const spec = (rel) => pathToFileURL(join(ROOT, rel)).href;

const { assertPublicHttpUrl, fetchPublicUrl, isPublicHttpUrl, isBlockedUrlError } = await import(spec('lib/public-url-guard.mjs'));
const { providerFetchContext } = await import(spec('providers/_ip-guard.mjs'));

const PUBLIC_V4 = [{ address: '93.184.216.34', family: 4 }];
const publicLookup = async () => PUBLIC_V4;
const noLookup = async (host) => { throw new Error(`lookup must not run for ${host}`); };
// jobs.example.com is public; internal-app.example.com is a public name with a private record.
const splitLookup = async (host) => (host === 'internal-app.example.com' ? [{ address: '10.0.0.7', family: 4 }] : PUBLIC_V4);

test('refuses loopback, LAN, cloud metadata and internal names without any DNS lookup', async () => {
  for (const link of [
    'http://127.0.0.1/',
    'http://127.0.0.1:3210/api/profile',
    'http://localhost:3210/api/profile',
    'http://LOCALHOST./',
    'http://[::1]/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::ffff:169.254.169.254]/',
    'http://[::ffff:7f00:1]/',
    'http://10.0.0.5/',
    'http://172.16.0.1/',
    'http://192.168.1.1/admin',
    'http://100.64.0.1/',
    'http://2130706433/',      // decimal 127.0.0.1, normalised by the URL parser
    'http://0x7f.1/',
    'http://intranet/',        // a single label
    'http://printer.local/',
    'http://nas.lan/',
    'http://service.internal/',
    'http://router.home.arpa/',
  ]) {
    await assert.rejects(() => assertPublicHttpUrl(link, { lookup: noLookup }), (err) => isBlockedUrlError(err), `${link} should be refused`);
  }
});

test('refuses anything that is not an http(s) URL', async () => {
  for (const link of ['file:///etc/passwd', 'ftp://example.com/', 'javascript:alert(1)', 'data:text/html,hi', 'local:jds/offer.pdf', 'not a url', '']) {
    await assert.rejects(() => assertPublicHttpUrl(link, { lookup: noLookup }), (err) => isBlockedUrlError(err), `${JSON.stringify(link)} should be refused`);
  }
});

test('accepts public IP literals and names that resolve to public addresses only', async () => {
  assert.equal((await assertPublicHttpUrl('https://93.184.216.34/jobs/1', { lookup: noLookup })).href, 'https://93.184.216.34/jobs/1');
  assert.equal((await assertPublicHttpUrl('https://[2606:2800:220:1:248:1893:25c8:1946]/', { lookup: noLookup })).hostname, '[2606:2800:220:1:248:1893:25c8:1946]');
  const url = await assertPublicHttpUrl('https://jobs.example.com/offer?id=3', { lookup: publicLookup });
  assert.equal(url.href, 'https://jobs.example.com/offer?id=3');
});

test('refuses a public name when any address it resolves to is private (mixed or empty answers too)', async () => {
  const mixed = async () => [{ address: '93.184.216.34', family: 4 }, { address: '10.1.2.3', family: 4 }];
  await assert.rejects(() => assertPublicHttpUrl('https://rebind.example.com/', { lookup: mixed }), (err) => isBlockedUrlError(err) && err.address === '10.1.2.3');
  const metadata = async () => [{ address: '169.254.169.254', family: 4 }];
  await assert.rejects(() => assertPublicHttpUrl('https://meta.example.com/', { lookup: metadata }), (err) => isBlockedUrlError(err));
  const none = async () => [];
  await assert.rejects(() => assertPublicHttpUrl('https://nothing.example.com/', { lookup: none }), (err) => isBlockedUrlError(err));
});

test('fails closed on a DNS error, which is not reported as a blocked address', async () => {
  const notFound = async () => { throw Object.assign(new Error('getaddrinfo ENOTFOUND nope.example.com'), { code: 'ENOTFOUND' }); };
  await assert.rejects(() => assertPublicHttpUrl('https://nope.example.com/', { lookup: notFound }), (err) => err.code === 'ENOTFOUND' && !isBlockedUrlError(err));
});

test('isPublicHttpUrl gives the same verdict as a boolean', async () => {
  assert.equal(await isPublicHttpUrl('https://jobs.example.com/a', { lookup: publicLookup }), true);
  assert.equal(await isPublicHttpUrl('http://localhost:3210/', { lookup: publicLookup }), false);
  assert.equal(await isPublicHttpUrl('https://internal-app.example.com/', { lookup: splitLookup }), false);
  assert.equal(await isPublicHttpUrl('chrome-error://chromewebdata/', { lookup: publicLookup }), false);
});

test('fetchPublicUrl follows redirects by hand, vetting each hop, inside the provider-fetch context', async () => {
  const calls = [];
  const fetchImpl = async (href, init) => {
    calls.push({ href, redirect: init.redirect, signal: init.signal, inContext: providerFetchContext.getStore() !== undefined });
    if (href === 'https://jobs.example.com/a') return new Response(null, { status: 302, headers: { location: '/b?x=1' } });
    return new Response('the job description', { status: 200 });
  };
  const signal = AbortSignal.timeout(5000);
  const response = await fetchPublicUrl('https://jobs.example.com/a', { fetchImpl, lookup: publicLookup, signal, headers: { 'User-Agent': 't' } });
  assert.equal(await response.text(), 'the job description');
  assert.deepEqual(calls.map(call => call.href), ['https://jobs.example.com/a', 'https://jobs.example.com/b?x=1']);
  assert.ok(calls.every(call => call.redirect === 'manual'), 'redirects are never left to fetch');
  assert.ok(calls.every(call => call.inContext), 'the patched dns.lookup must check the dialled address');
  assert.ok(calls.every(call => call.signal === signal), 'the caller\'s timeout covers every hop');
});

test('fetchPublicUrl refuses a redirect to a private target before connecting to it', async () => {
  for (const target of [
    'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
    'http://localhost:3210/api/profile',
    'http://192.168.0.1/',
    'http://[::1]:3210/',
    'file:///etc/passwd',
    'https://internal-app.example.com/', // a public name whose record is private
  ]) {
    const hits = [];
    const fetchImpl = async (href) => {
      hits.push(href);
      return new Response(null, { status: 301, headers: { location: target } });
    };
    await assert.rejects(() => fetchPublicUrl('https://jobs.example.com/offer', { fetchImpl, lookup: splitLookup }), (err) => isBlockedUrlError(err), `${target} should be refused`);
    assert.deepEqual(hits, ['https://jobs.example.com/offer'], `${target} must never be requested`);
  }
});

test('fetchPublicUrl refuses a private first URL without calling fetch', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return new Response('secret'); };
  await assert.rejects(() => fetchPublicUrl('http://169.254.169.254/latest/meta-data/', { fetchImpl, lookup: noLookup }), (err) => isBlockedUrlError(err));
  assert.equal(called, false);
});

test('fetchPublicUrl returns a 403 or 404 as a response, like fetch, and stops a redirect loop', async () => {
  const notFound = await fetchPublicUrl('https://jobs.example.com/gone', { fetchImpl: async () => new Response('closed', { status: 404 }), lookup: publicLookup });
  assert.equal(notFound.status, 404);
  assert.equal(await notFound.text(), 'closed');

  let count = 0;
  const loop = async (href) => {
    count += 1;
    return new Response(null, { status: 302, headers: { location: href.endsWith('/a') ? 'https://jobs.example.com/b' : 'https://jobs.example.com/a' } });
  };
  await assert.rejects(() => fetchPublicUrl('https://jobs.example.com/a', { fetchImpl: loop, lookup: publicLookup, maxRedirects: 3 }), /Too many redirects/);
  assert.equal(count, 4);
});

test('a real loopback server is never contacted, by IP or by name', async () => {
  let hits = 0;
  const server = http.createServer((_req, res) => { hits += 1; res.end('SECRET-LOCAL-DATA'); }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  try {
    for (const link of [`http://127.0.0.1:${port}/`, `http://localhost:${port}/`, `http://[::ffff:127.0.0.1]:${port}/`]) {
      await assert.rejects(() => fetchPublicUrl(link), (err) => isBlockedUrlError(err), `${link} should be refused`);
    }
    assert.equal(hits, 0, 'the local server must not see a request');
  } finally {
    server.close();
  }
});

test('the offer reader in ui/server.mjs goes through the guard (source read as text)', () => {
  const source = readFileSync(join(ROOT, 'ui/server.mjs'), 'utf-8');
  const start = source.indexOf('async function fetchJobDescriptionText(');
  const end = source.indexOf('function mergePublishedDates(', start);
  assert.ok(start > 0 && end > start, 'fetchJobDescriptionText not found');
  const reader = source.slice(start, end);
  // Checked before any reader runs, the known-source APIs included.
  const guard = reader.indexOf('await assertPublicHttpUrl(url)');
  assert.ok(guard > 0, 'the link is checked on entry');
  assert.ok(guard < reader.indexOf('fetchKnownSourceJobDescription(url'), 'the check comes before the first reader');
  assert.ok(guard < reader.indexOf('fetchViaHttp'), 'the check comes before the HTTP reader');
  // The HTTP reader vets every hop, and no bare fetch is left in the function.
  assert.ok(reader.includes('await fetchPublicUrl(fetchUrl'), 'the HTTP reader uses fetchPublicUrl');
  assert.ok(!/(?<![\w.])fetch\(/.test(reader), 'no bare fetch( in the offer reader');
  assert.ok(reader.includes('if (isBlockedUrlError(err)) throw err;'), 'a refused redirect is not retried');
  // The browsers' landing page is checked after their own redirects.
  assert.ok(reader.includes("'location.href'") && reader.includes('isPublicHttpUrl(landedOn)'), 'PinchTab landing page is checked');
  const browser = source.slice(source.indexOf('async function browseJobDescription('), start);
  assert.ok(browser.includes('page.url()') && browser.includes('isPublicHttpUrl(landedOn)'), 'the Chrome page landing is checked');
  assert.ok(browser.includes('if (probe.refused) return probe;'), 'no second window after a refused redirect');
});
