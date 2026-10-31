// Report 1216 (2026-10-31) evaluated a Glassdoor search page, "328 ux ui designer Jobs in Remote,
// October 2026", as an offer and scored it 4.6/5. The five digits of its SRCH_ id read as a posting
// id, so the title patterns never looked at it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { listingPageReason } from '../lib/scan-decision.mjs';

const SEARCH_URL = 'https://www.glassdoor.com/Job/remote-ux-ui-designer-jobs-SRCH_IL.0,6_IS11047_KO7,21.htm';

test('a Glassdoor search results page is a listing, by its URL and by its counted title', () => {
  assert.match(listingPageReason({ url: SEARCH_URL, title: '328 ux ui designer Jobs in Remote, October 2026' }), /not a job posting/);
  assert.match(listingPageReason({ url: SEARCH_URL, title: 'Whatever the page is called' }), /listing or profile URL/, 'the URL alone is enough');
  assert.match(listingPageReason({ url: 'https://www.glassdoor.co.uk/Job/london-product-designer-jobs-SRCH_IL.0,6_IC2671300_KO7,24.htm', title: 'x' }), /listing or profile URL/);
});

test('a counted result-list title is a listing even when the URL holds a long number', () => {
  const url = 'https://jobs.example.com/search/12345';
  for (const title of ['328 ux ui designer Jobs in Remote, October 2026', '1,204 Product Designer Jobs near Paris', '57+ remote design Jobs at startups']) {
    assert.match(listingPageReason({ url, title }), /listing page title/, title);
  }
});

test('real postings stay', () => {
  // Glassdoor postings live under /job-listing/ and carry JV_KO
  assert.equal(listingPageReason({
    url: 'https://www.glassdoor.com/job-listing/senior-product-designer-property-meld-JV_KO0,23_KE24,37.htm?jl=1010126705123',
    title: 'Property Meld hiring Senior Product Designer Job in Remote / Glassdoor',
  }), '');
  assert.equal(listingPageReason({ url: 'https://jobs.lever.co/acme/8a43d593-8341-4bb8-ab61-6c03a12ca1fe', title: '3D Designer - Remote' }), '', 'a title that starts with a digit is not a count');
  assert.equal(listingPageReason({ url: 'https://boards.greenhouse.io/acme/jobs/4523845', title: '10x Engineer, Jobs Platform' }), '');
  assert.equal(listingPageReason({ url: 'https://remotive.com/remote-jobs/design/ux-designer-3789495', title: 'UX Designer - Remote Jobs for Humanity' }), '');
});
