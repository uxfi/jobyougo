// Google result links (2026-10-31): every outbound link is google.com/goto?url=<opaque>,
// answering 302 with the posting. The extractor reads them as { gotoHref } and
// lib/serp-redirects.mjs follows them, sparingly. Offline: simulated network and a stub DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { isGoogleGotoUrl, resolveGoogleGoto, resetGoogleGotoCooldown } from '../lib/serp-redirects.mjs';

const GOTO = (id) => `https://www.google.com/goto?url=CAES${id}`;
const redirect = (location, status = 302) => ({ status, headers: { get: (h) => (h.toLowerCase() === 'location' ? location : null) } });
const noRedirect = { status: 200, headers: { get: () => null } };
const fast = { pauseMs: 0 };

function network(map) {
  const asked = [];
  const fetchImpl = async (url, opts) => {
    asked.push(url);
    assert.equal(opts.redirect, 'manual', 'the redirect is read, never followed');
    const answer = map[url];
    if (answer instanceof Error) throw answer;
    return answer || noRedirect;
  };
  return { fetchImpl, asked };
}

test('isGoogleGotoUrl: only an https Google /goto link is ever fetched', () => {
  assert.equal(isGoogleGotoUrl(GOTO('a')), true);
  assert.equal(isGoogleGotoUrl('https://www.google.co.th/goto?url=x'), true);
  assert.equal(isGoogleGotoUrl('https://www.google.com.au/goto?url=x'), true);
  assert.equal(isGoogleGotoUrl('https://www.google.de/goto?url=x'), true);
  assert.equal(isGoogleGotoUrl('https://mail.google.com/goto?url=x'), false);
  assert.equal(isGoogleGotoUrl('http://www.google.com/goto?url=x'), false);
  assert.equal(isGoogleGotoUrl('https://evil.example/goto?url=x'), false);
  assert.equal(isGoogleGotoUrl('https://www.google.com.evil.example/goto?url=x'), false);
  assert.equal(isGoogleGotoUrl('https://www.google.com/search?q=x'), false);
  assert.equal(isGoogleGotoUrl(''), false);
  assert.equal(isGoogleGotoUrl('not a url'), false);
});

test('resolveGoogleGoto turns /goto results into posting URLs, in order, and drops what it cannot resolve', async () => {
  resetGoogleGotoCooldown();
  const { fetchImpl, asked } = network({
    [GOTO('1')]: redirect('https://jobs.lever.co/acme/aaa'),
    [GOTO('3')]: redirect('https://boards.greenhouse.io/beta/jobs/9'),
    [GOTO('4')]: Object.assign(new Error('network down'), { name: 'TypeError' }),
  });
  const res = await resolveGoogleGoto([
    { title: 'One', url: '', gotoHref: GOTO('1'), location: 'x' },
    { title: 'Two (direct)', url: 'https://apply.workable.com/gamma/j/1', gotoHref: '' },
    { title: 'Three', url: '', gotoHref: GOTO('3') },
    { title: 'Four (network error)', url: '', gotoHref: GOTO('4') },
    { title: 'Five (not a goto link)', url: '', gotoHref: 'https://evil.example/goto?url=x' },
    null,
  ], { fetchImpl, ...fast });
  assert.deepEqual(res.jobs.map((j) => [j.title, j.url]), [
    ['One', 'https://jobs.lever.co/acme/aaa'],
    ['Two (direct)', 'https://apply.workable.com/gamma/j/1'],
    ['Three', 'https://boards.greenhouse.io/beta/jobs/9'],
  ]);
  assert.ok(res.jobs.every((j) => !('gotoHref' in j)), 'the token does not travel on');
  assert.equal(res.jobs[0].location, 'x', 'the rest of a result is kept');
  assert.equal(res.unresolved, 1, 'only the network error: a link that is not Google\'s is not followed at all');
  assert.equal(res.blocked, false);
  assert.ok(!asked.some((u) => u.includes('evil.example')), 'a link that is not Google\'s is never requested');
});

test('resolveGoogleGoto follows only the results the caller keeps, and at most `max`', async () => {
  resetGoogleGotoCooldown();
  const { fetchImpl, asked } = network(Object.fromEntries([1, 2, 3, 4, 5].map((n) => [GOTO(n), redirect(`https://jobs.lever.co/acme/${n}`)])));
  const jobs = [1, 2, 3, 4, 5].map((n) => ({ title: n % 2 ? `Designer ${n}` : `Accountant ${n}`, url: '', gotoHref: GOTO(n) }));
  const kept = await resolveGoogleGoto(jobs, { fetchImpl, keep: (j) => /designer/i.test(j.title), ...fast });
  assert.deepEqual(kept.jobs.map((j) => j.title), ['Designer 1', 'Designer 3', 'Designer 5']);
  assert.equal(asked.length, 3, 'a result nobody wants costs no request');

  asked.length = 0;
  const capped = await resolveGoogleGoto(jobs, { fetchImpl, max: 2, ...fast });
  assert.equal(asked.length, 2);
  assert.equal(capped.jobs.length, 2);
});

test('resolveGoogleGoto stops when Google refuses a batch, then rests', async () => {
  resetGoogleGotoCooldown();
  let clock = 1_000_000;
  const now = () => clock;
  const asked = [];
  const refusing = async (url) => { asked.push(url); return noRedirect; }; // an interstitial page, no Location
  const jobs = [1, 2, 3, 4, 5, 6, 7].map((n) => ({ title: `Designer ${n}`, url: '', gotoHref: GOTO(n) }));

  const first = await resolveGoogleGoto(jobs, { fetchImpl: refusing, concurrency: 3, now, cooldownMs: 600000, ...fast });
  assert.equal(first.blocked, true);
  assert.deepEqual(first.jobs, []);
  assert.equal(asked.length, 3, 'one refused batch ends the loop');

  asked.length = 0;
  clock += 60_000;
  const resting = await resolveGoogleGoto(jobs, { fetchImpl: refusing, now, cooldownMs: 600000, ...fast });
  assert.equal(asked.length, 0, 'no request while the cooldown runs');
  assert.equal(resting.blocked, true);

  clock += 600_000;
  const { fetchImpl } = network({ [GOTO(1)]: redirect('https://jobs.lever.co/acme/1') });
  const later = await resolveGoogleGoto(jobs.slice(0, 1), { fetchImpl, now, ...fast });
  assert.deepEqual(later.jobs.map((j) => j.url), ['https://jobs.lever.co/acme/1'], 'after the cooldown it asks again');
});

test('resolveGoogleGoto reads a redirect to Google\'s own "sorry" page as a refusal', async () => {
  resetGoogleGotoCooldown();
  const { fetchImpl } = network({ [GOTO('1')]: redirect('https://www.google.com/sorry/index?continue=x') });
  const res = await resolveGoogleGoto([{ title: 'Designer', url: '', gotoHref: GOTO('1') }], { fetchImpl, ...fast });
  assert.deepEqual(res.jobs, []);
  assert.equal(res.blocked, true);
  resetGoogleGotoCooldown();
});

// ── The extractor, as ui/server.mjs ships it, on a stub of the page Google serves ────────────
const source = readFileSync(new URL('../ui/server.mjs', import.meta.url), 'utf8');
const MARK = 'const PINCHTAB_GOOGLE_SEARCH_EXTRACT_SCRIPT = `';
const from = source.indexOf(MARK) + MARK.length;
// evaluating the template literal turns "\\s" into the "\s" the page runs
const EXTRACT_SCRIPT = new Function(`return \`${source.slice(from, source.indexOf('`;', from))}\``)();

function anchor({ href, heading = '', text = heading, aria = '' }) {
  return {
    href: new URL(href, 'https://www.google.com').href,
    textContent: text,
    getAttribute: (name) => (name === 'href' ? href : name === 'aria-label' ? aria : null),
    querySelector: (selector) => (/h3/.test(selector) && heading ? { textContent: heading } : null),
    closest: () => ({ innerText: `${heading || text} some snippet` }),
  };
}

function extract(anchors) {
  const sandbox = {
    URL, Set,
    window: { location: { origin: 'https://www.google.com' } },
    location: { href: 'https://www.google.com/search?q=x' },
    document: {
      title: 'x - Google Search',
      body: { innerText: 'Search Results' },
      querySelectorAll: (selector) => (selector === 'a[href]' ? anchors : anchors.filter((a) => a.querySelector('h3'))),
    },
  };
  return JSON.parse(JSON.stringify(vm.runInNewContext(EXTRACT_SCRIPT, sandbox)));
}

test('extractor: the title link of a /goto result is read, the icon and "Read more" links are not', () => {
  const out = extract([
    anchor({ href: '/goto?url=CAESabc', heading: 'Product Design Lead - Tenpo - Teamtailor', text: 'Product Design Lead - Tenpo - TeamtailorTeamtailorhttps://tenpo.teamtailor.com › jobs › 8442099-prod...' }),
    anchor({ href: '/goto?url=CAESicon', text: '' }),
    anchor({ href: '/goto?url=CAESmore', text: 'Read more' }),
    anchor({ href: '/search?q=images', text: 'Images' }),
    anchor({ href: 'https://support.google.com/websearch', heading: 'Help' }),
  ]);
  assert.equal(out.jobs.length, 1);
  assert.deepEqual([out.jobs[0].title, out.jobs[0].url, out.jobs[0].gotoHref],
    ['Product Design Lead - Tenpo - Teamtailor', '', 'https://www.google.com/goto?url=CAESabc']);
  assert.equal(out.diag.anchors, 5);
});

test('extractor: the older direct and /url forms still work', () => {
  const out = extract([
    anchor({ href: 'https://boards.greenhouse.io/x/jobs/1', heading: 'X - Engineer' }),
    anchor({ href: '/url?q=https://jobs.lever.co/acme/123&sa=U', heading: 'Acme - Designer' }),
    anchor({ href: '/url?sa=t&url=https://apply.workable.com/gamma/j/9', heading: 'Gamma - Researcher' }),
  ]);
  assert.deepEqual(out.jobs.map((j) => [j.url, j.gotoHref]), [
    ['https://boards.greenhouse.io/x/jobs/1', ''],
    ['https://jobs.lever.co/acme/123', ''],
    ['https://apply.workable.com/gamma/j/9', ''],
  ]);
});

// The page scripts are template literals: node --check never looks inside them, so a line that
// lands in the wrong one (a staging slip put server code inside the Google, Brave and Bing
// scripts, 2026-10-31) is only a syntax error once a browser runs it. Compile every one.
test('every in-page extractor script of ui/server.mjs compiles, and holds no server-side code', () => {
  const names = [];
  const re = /const (\w+_EXTRACT_SCRIPT) = `/g;
  let match;
  while ((match = re.exec(source))) {
    const start = match.index + match[0].length;
    const body = source.slice(start, source.indexOf('`;', start));
    if (body.includes('${')) continue; // built from values at run time
    const script = new Function(`return \`${body}\``)();
    assert.doesNotThrow(() => new vm.Script(script), `${match[1]} must be valid JavaScript`);
    assert.ok(!/resolveGoogleResults|await /.test(script), `${match[1]} must not hold server code`);
    if (!/GOOGLE/.test(match[1])) assert.ok(!/gotoHref/.test(script), `${match[1]} is not Google's`);
    names.push(match[1]);
  }
  assert.ok(names.includes('PINCHTAB_GOOGLE_SEARCH_EXTRACT_SCRIPT') && names.includes('PINCHTAB_BRAVE_SEARCH_EXTRACT_SCRIPT'), `read ${names.join(', ')}`);
});

test('extractor: an opaque /url token without a heading is not a result', () => {
  assert.equal(extract([anchor({ href: '/url?sa=t&url=CAESopaque', text: 'Some link text here' })]).jobs.length, 0);
});
