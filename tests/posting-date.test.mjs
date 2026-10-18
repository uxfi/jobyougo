// lib/posting-date.mjs: dates for web-search postings, which passed the scan's
// age filter undated (154 of 159 rows, 2026-10-07..15) even when months old.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { datePostedFromHtml, postingDateFromPage, postingStatusFromApi } from '../lib/posting-date.mjs';
import { assessFreshness, coerceIsoDate, evaluateCandidate, isUndatedReview, resolvePublishedDate, UNDATED_REVIEW_REASON } from '../lib/scan-decision.mjs';
import { buildJevScanResponse } from '../lib/jev.mjs';

function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url, init });
    const hit = Object.entries(routes).find(([prefix]) => String(url).startsWith(prefix));
    if (!hit) return new Response('not found', { status: 404 });
    const body = hit[1];
    return typeof body === 'string'
      ? new Response(body, { status: 200, headers: { 'content-type': 'text/html' } })
      : new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  impl.calls = calls;
  return impl;
}

test('JSON-LD datePosted, nested in @graph, gives the day', () => {
  const html = `<script type="application/ld+json">{"@graph":[{"@type":"Organization"},{"@type":"JobPosting","datePosted":"2026-08-02T10:00:00Z"}]}</script>`;
  assert.equal(datePostedFromHtml(html), '2026-08-02');
  assert.equal(datePostedFromHtml('<p>no date</p>'), null);
});

test('Workable, SmartRecruiters and Rippling answer from their APIs', async () => {
  const fetchImpl = fakeFetch({
    'https://apply.workable.com/api/v2/accounts/jobrack/jobs/6AEF096971': { published: '2026-09-30T00:00:00.000Z' },
    'https://api.smartrecruiters.com/v1/companies/carousellgroup/postings/744000149236549': { releasedDate: '2026-09-14T04:49:47.928Z' },
    'https://api.rippling.com/platform/api/ats/v1/board/acme/jobs/e6d4ad42-f8f4-4654-99d7-7892da8c628d': { createdOn: '2026-08-18T14:58:15.871000-07:00' },
  });
  const open = (date) => ({ date, closed: false });
  assert.deepEqual(await postingStatusFromApi('https://apply.workable.com/jobrack/j/6AEF096971/apply/', { fetchImpl }), open('2026-09-30'));
  assert.deepEqual(await postingStatusFromApi('https://jobs.smartrecruiters.com/carousellgroup/744000149236549-senior-product-manager', { fetchImpl }), open('2026-09-14'));
  assert.deepEqual(await postingStatusFromApi('https://ats.rippling.com/acme/jobs/e6d4ad42-f8f4-4654-99d7-7892da8c628d', { fetchImpl }), open('2026-08-18'));
});

test('a board API that no longer has the posting closes it; other errors do not', async () => {
  const closed = { date: null, closed: true };
  const gone = fakeFetch({});
  assert.deepEqual(await postingStatusFromApi('https://job-boards.greenhouse.io/octave/jobs/8389784002', { fetchImpl: gone }), closed);
  assert.deepEqual(await postingStatusFromApi('https://apply.workable.com/jobrack/j/6AEF096971', { fetchImpl: gone }), closed);

  const busy = async () => new Response('slow down', { status: 429 });
  assert.deepEqual(
    await postingStatusFromApi('https://job-boards.greenhouse.io/octave/jobs/8389784002', { fetchImpl: busy }),
    { date: null, closed: false },
  );

  const ashby = 'https://jobs.ashbyhq.com/preply/ecef6699-977a-46c8-898a-147740811f05';
  const findAshbyJob = (board, id) => board.jobs.find(job => job.id === id);
  const board = { jobs: [{ id: 'ecef6699-977a-46c8-898a-147740811f05', publishedAt: '2026-10-05T16:31:12.219+00:00' }] };
  assert.deepEqual(await postingStatusFromApi(ashby, { getAshbyBoard: async () => board, findAshbyJob }), { date: '2026-10-05', closed: false });
  assert.deepEqual(await postingStatusFromApi(ashby, { getAshbyBoard: async () => ({ jobs: [] }), findAshbyJob }), closed);
  assert.deepEqual(
    await postingStatusFromApi(ashby, { getAshbyBoard: async () => ({}), findAshbyJob }),
    { date: null, closed: false },
    'an unreadable board says nothing',
  );
});

test('Greenhouse uses original first_published and never treats updated_at as publication', async () => {
  const url = 'https://job-boards.greenhouse.io/acme/jobs/123';
  const both = fakeFetch({
    'https://boards-api.greenhouse.io/v1/boards/acme/jobs/123': {
      first_published: '2026-04-17T09:00:00Z',
      updated_at: '2026-10-17T09:00:00Z',
    },
  });
  assert.deepEqual(await postingStatusFromApi(url, { fetchImpl: both }), { date: '2026-04-17', closed: false });

  const onlyUpdated = fakeFetch({
    'https://boards-api.greenhouse.io/v1/boards/acme/jobs/123': { updated_at: '2026-10-17T09:00:00Z' },
  });
  assert.deepEqual(await postingStatusFromApi(url, { fetchImpl: onlyUpdated }), { date: null, closed: false });
});

test('scan routing: closed offers are rejected, undated web-search hits go to review', () => {
  const cfg = { title_filter: { positive: ['designer'] }, scan_max_age_days: 7 };
  const base = { url: 'https://example.com/jobs/1', title: 'Senior Product Designer', location: 'Remote - Europe' };
  const decide = (candidate) => evaluateCandidate(candidate, cfg, { today: '2026-10-15' });

  assert.equal(decide({ ...base, postingClosed: true }).reasonCode, 'closed');
  assert.equal(decide({ ...base, postingClosed: true }).disposition, 'reject');

  const undated = decide({ ...base, webSearch: true });
  assert.equal(undated.disposition, 'review');
  assert.ok(undated.reasons.includes(UNDATED_REVIEW_REASON));

  assert.equal(decide({ ...base, webSearch: true, publishedAt: '2026-10-14' }).disposition, 'keep', 'a dated web hit is a match');
  assert.equal(decide(base).disposition, 'keep', 'an undated board row keeps the first_seen proxy');

  assert.ok(isUndatedReview({ reasons: undated.reasons, remoteDisposition: 'keep' }));
  assert.ok(!isUndatedReview({ reasons: undated.reasons, remoteDisposition: 'review' }), 'an ambiguous remote signal is checked first');
});

test('the Jev scan summary counts undated hits apart from ambiguous remote ones', () => {
  const review = [
    { url: 'https://a.example/1', title: 'Product Designer', reasons: [UNDATED_REVIEW_REASON], remoteDisposition: 'keep' },
    { url: 'https://b.example/2', title: 'UX Designer', reasons: ['remote ambiguous'], remoteDisposition: 'review' },
  ];
  const text = buildJevScanResponse({ review });
  assert.match(text, /Remote à revoir : 1/);
  assert.match(text, /Date à vérifier \(recherche web sans date\) : 1/);
});

test('a WTTJ posting is found in the jobs index by company and title words', async () => {
  const fetchImpl = fakeFetch({
    'https://www.welcometothejungle.com/api/env': 'window.env = {"PUBLIC_ALGOLIA_APPLICATION_ID":"CSEKHVMS53","PUBLIC_ALGOLIA_API_KEY_CLIENT":"0123456789abcdef0123"}',
    'https://CSEKHVMS53-dsn.algolia.net/': { hits: [
      { slug: 'product-manager_fr_h32xwsyy', organization: { slug: 'ramp' }, published_at_timestamp: 1786666545 },
      { slug: 'product-designer_fr_faytlc25', organization: { slug: 'ramp' }, published_at_timestamp: 1783988069 },
    ] },
  });
  const status = await postingStatusFromApi('https://www.welcometothejungle.com/en/companies/ramp/jobs/product-designer_fr_faytlc25', { fetchImpl });
  assert.deepEqual(status, { date: new Date(1783988069 * 1000).toISOString().slice(0, 10), closed: false });
  const query = JSON.parse(fetchImpl.calls.at(-1).init.body).params;
  assert.match(new URLSearchParams(query).get('query'), /^ramp product designer$/);
});

test('hosts without an API are left to the page read', async () => {
  const fetchImpl = fakeFetch({
    'https://remoteok.com/remote-jobs/1': '<script type="application/ld+json">{"datePosted":"2026-07-01"}</script>',
  });
  assert.equal(await postingStatusFromApi('https://remoteok.com/remote-jobs/1', { fetchImpl }), undefined);
  assert.equal(await postingDateFromPage('https://remoteok.com/remote-jobs/1', { fetchImpl }), '2026-07-01');
  assert.equal(await postingDateFromPage('https://example.com/gone', { fetchImpl }), null);
});

test('date validation rejects impossible and future dates instead of treating them as fresh', () => {
  assert.equal(coerceIsoDate('2026-02-30'), '');
  assert.equal(coerceIsoDate('2026-10-18T09:00:00Z'), '2026-10-18');
  assert.equal(resolvePublishedDate({ publishedAt: '2026-10-18' }, '2026-10-17'), '');
  assert.equal(resolvePublishedDate({ publishedAt: '2026-02-30' }, '2026-10-17'), '');
  assert.equal(assessFreshness({ publishedAt: '2026-10-18', maxAgeDays: 7, today: '2026-10-17' }).ok, false);
  const sixMonthsOld = assessFreshness({ publishedAt: '2026-04-17', maxAgeDays: 7, today: '2026-10-17' });
  assert.equal(sixMonthsOld.ok, false);
  assert.match(sixMonthsOld.reason, /older than 7d/);
});
