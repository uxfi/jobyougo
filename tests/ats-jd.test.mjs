import {
  parseAshbyPostingUrl,
  findAshbyJobOnBoard,
  parseLeverPostingUrl,
  parseDeelJobUrl,
  extractJsonLdJobPosting,
  flattenJsonLdJobLocation,
  extractZohoRecruitJob,
  isUnusableJobDescriptionText,
} from '../lib/ats-jd.mjs';
import { pass, fail } from './helpers.mjs';

console.log('\nATS JD prefetch helpers');

const bjak = parseAshbyPostingUrl(
  'https://jobs.ashbyhq.com/bjakcareer/9542fbe7-fd31-4a0f-8b31-04ff2df56857/application',
);
if (bjak && bjak.org === 'bjakcareer' && bjak.jobId === '9542fbe7-fd31-4a0f-8b31-04ff2df56857') {
  pass('parseAshbyPostingUrl keeps board slug + UUID from /application URLs');
} else {
  fail(`parseAshbyPostingUrl(bjak application) = ${JSON.stringify(bjak)}`);
}

const dotted = parseAshbyPostingUrl(
  'https://jobs.ashbyhq.com/WON.ai/1333d008-639e-43f6-92a4-af3c40d5069c?utm_source=x',
);
if (dotted && dotted.org === 'WON.ai' && dotted.jobId === '1333d008-639e-43f6-92a4-af3c40d5069c') {
  pass('parseAshbyPostingUrl preserves dotted board slugs and strips query params');
} else {
  fail(`parseAshbyPostingUrl(dotted) = ${JSON.stringify(dotted)}`);
}

if (parseAshbyPostingUrl('https://jobs.ashbyhq.com/bjakcareer') === null) {
  pass('parseAshbyPostingUrl returns null for a board URL without a job id');
} else {
  fail('parseAshbyPostingUrl should reject board-only URLs');
}

if (parseAshbyPostingUrl('https://jobs.deel.com/offsec/job-details/ea27d925-53c5-4f19-87f3-74d32ff7adf1/application') === null) {
  pass('parseAshbyPostingUrl returns null for non-Ashby hosts (no invented Deel mapping)');
} else {
  fail('parseAshbyPostingUrl must not claim jobs.deel.com');
}

const board = {
  jobs: [
    {
      id: '9542fbe7-fd31-4a0f-8b31-04ff2df56857',
      title: 'Product Designer (UI/UX)',
      descriptionPlain: 'ABOUT BJAK '.repeat(80),
      jobUrl: 'https://jobs.ashbyhq.com/bjakcareer/9542fbe7-fd31-4a0f-8b31-04ff2df56857',
    },
    {
      id: 'other-id',
      title: 'By URL only',
      applyUrl: 'https://jobs.ashbyhq.com/bjakcareer/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/application',
    },
  ],
};

const byId = findAshbyJobOnBoard(board, '9542FBE7-FD31-4A0F-8B31-04FF2DF56857');
if (byId && byId.title === 'Product Designer (UI/UX)') {
  pass('findAshbyJobOnBoard matches posting id case-insensitively');
} else {
  fail(`findAshbyJobOnBoard(id) = ${JSON.stringify(byId)}`);
}

const byUrl = findAshbyJobOnBoard(board, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
if (byUrl && byUrl.title === 'By URL only') {
  pass('findAshbyJobOnBoard falls back to jobUrl/applyUrl containing the id');
} else {
  fail(`findAshbyJobOnBoard(url) = ${JSON.stringify(byUrl)}`);
}

if (findAshbyJobOnBoard(board, 'missing-id') === null && findAshbyJobOnBoard({}, 'x') === null) {
  pass('findAshbyJobOnBoard returns null when the posting is absent or the board shape is empty');
} else {
  fail('findAshbyJobOnBoard should return null for misses');
}

const lever = parseLeverPostingUrl('https://jobs.lever.co/acme/463e2769-bb85-4429-96a3-3a175eb228cd/apply');
if (lever && lever.apiHost === 'api.lever.co' && lever.slug === 'acme' && lever.id === '463e2769-bb85-4429-96a3-3a175eb228cd') {
  pass('parseLeverPostingUrl maps jobs.lever.co/{slug}/{id} to api.lever.co');
} else {
  fail(`parseLeverPostingUrl = ${JSON.stringify(lever)}`);
}

const leverEu = parseLeverPostingUrl('https://jobs.eu.lever.co/acme/abc-123');
if (leverEu && leverEu.apiHost === 'api.eu.lever.co') {
  pass('parseLeverPostingUrl uses api.eu.lever.co for EU boards');
} else {
  fail(`parseLeverPostingUrl(eu) = ${JSON.stringify(leverEu)}`);
}

if (isUnusableJobDescriptionText('You need to enable JavaScript to run this app.')) {
  pass('SPA noscript shell is unusable as a job description');
} else {
  fail('isUnusableJobDescriptionText should reject the CRA JavaScript shell');
}

if (isUnusableJobDescriptionText('x'.repeat(78))) {
  pass('sub-250-char prefetch text is unusable');
} else {
  fail('isUnusableJobDescriptionText should reject 78-char stubs');
}

const realJd = 'ABOUT BJAK The original mission of BJAK is we believe people deserve smarter ways to plan, save and grow their money. '.repeat(20);
if (!isUnusableJobDescriptionText(realJd) && realJd.length > 250) {
  pass('a real Ashby descriptionPlain body is usable');
} else {
  fail('isUnusableJobDescriptionText rejected a real JD');
}

const deelApp = parseDeelJobUrl(
  'https://jobs.deel.com/offsec/job-details/ea27d925-53c5-4f19-87f3-74d32ff7adf1/application?source=linkedin',
);
if (
  deelApp
  && deelApp.tenant === 'offsec'
  && deelApp.jobId === 'ea27d925-53c5-4f19-87f3-74d32ff7adf1'
  && deelApp.overviewUrl === 'https://jobs.deel.com/offsec/job-details/ea27d925-53c5-4f19-87f3-74d32ff7adf1/overview'
) {
  pass('parseDeelJobUrl rewrites /application to /overview and keeps tenant + posting id');
} else {
  fail(`parseDeelJobUrl = ${JSON.stringify(deelApp)}`);
}

if (parseDeelJobUrl('https://jobs.ashbyhq.com/bjakcareer/9542fbe7-fd31-4a0f-8b31-04ff2df56857') === null) {
  pass('parseDeelJobUrl returns null for non-Deel hosts');
} else {
  fail('parseDeelJobUrl must not claim Ashby URLs');
}

const deelHtml = `<html><head>
<script type="application/ld+json">{"@type":"JobPosting","title":"UI/UX Designer","description":"<p>About OffSec Founded in 2006 by the creators of Kali Linux. ${'Hands-on cybersecurity training. '.repeat(20)}</p>","hiringOrganization":{"name":"Offsec Services"},"jobLocation":[{"address":{"addressLocality":"Philippines"}},{"address":{"addressLocality":"Remote"}}],"employmentType":["FULL_TIME"]}</script>
<script type="application/ld+json">{"@type":"BreadcrumbList","itemListElement":[]}</script>
</head><body>UI/UX Designer @ Offsec Services</body></html>`;
const posting = extractJsonLdJobPosting(deelHtml);
if (posting && posting.title === 'UI/UX Designer' && String(posting.description).includes('Kali Linux')) {
  pass('extractJsonLdJobPosting reads JobPosting JSON-LD and ignores BreadcrumbList');
} else {
  fail(`extractJsonLdJobPosting = ${JSON.stringify(posting)?.slice(0, 200)}`);
}

const loc = flattenJsonLdJobLocation(posting);
if (loc.includes('Philippines') && loc.includes('Remote')) {
  pass('flattenJsonLdJobLocation joins Deel localities including Remote');
} else {
  fail(`flattenJsonLdJobLocation = ${JSON.stringify(loc)}`);
}

if (isUnusableJobDescriptionText('UI/UX Designer @ Offsec Services')) {
  pass('title-only Deel visible text is unusable without JSON-LD');
} else {
  fail('title-only Deel shell should be unusable');
}

const zohoHtml = String.raw`var payload = \x22Job_Opening_Name\x22:\x22Sr. UI\/UX Designer\x22,\x22Job_Type\x22:\x22Full time\x22,\x22Job_Description\x22:\x22<html><body><p>This is a remote position.<\/p><p>${'Design product flows for a distributed team. '.repeat(12)}<\/p><\/body><\/html>\x22,\x22Country\x22:\x22Australia\x22,\x22id\x22:\x22776047000012055081\x22`;
const zoho = extractZohoRecruitJob(zohoHtml);
if (zoho && zoho.title === 'Sr. UI/UX Designer' && zoho.description.includes('remote position') && zoho.country === 'Australia') {
  pass('extractZohoRecruitJob decodes \\x22 Job_Description payloads');
} else {
  fail(`extractZohoRecruitJob = ${JSON.stringify(zoho)?.slice(0, 240)}`);
}
