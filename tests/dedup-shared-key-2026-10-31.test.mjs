import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dedupUrlKey, normalizeUrl } from '../url-key.mjs';
import { rolesLikelySame } from '../lib/scan-decision.mjs';
import { roleMatch } from '../lib/scan-filters.mjs';

test('dedup key: params that change per visit or locale collapse onto the bare posting', () => {
  const bare = 'https://www.welcometothejungle.com/en/companies/clerk/jobs/backend-developer-confirme_begles';
  assert.equal(dedupUrlKey(`${bare}?fromApply=true&igbTracker=972968987&referrer=vonq_opn`), bare);
  assert.equal(dedupUrlKey('https://www.behance.net/joblist/330631/UIUX-designers?locale=en_US'), 'https://www.behance.net/joblist/330631/uiux-designers');
  assert.equal(dedupUrlKey('https://xflow.bamboohr.com/careers/130?source=aWQ9MjE='), dedupUrlKey('https://xflow.bamboohr.com/careers/130'));
  assert.equal(dedupUrlKey('https://jobs.lever.co/acme/abc-123?lever-source=LinkedIn&lever-origin=applied'), dedupUrlKey('https://jobs.lever.co/acme/abc-123'));
  assert.equal(dedupUrlKey('https://www.stepstone.de/job--12345-inline.html?rltr=23_25'), dedupUrlKey('https://www.stepstone.de/job--12345-inline.html?rltr=42_17'));
});

test('dedup key: tracking params of the merge key go too, and scheme, order and path case do not matter', () => {
  assert.equal(dedupUrlKey('http://Jobs.Example.com/J/7/?utm_source=x&fbclid=y&gclid=z&trk=a'), 'https://jobs.example.com/j/7');
  assert.equal(dedupUrlKey('https://x.example/j?b=2&a=1'), dedupUrlKey('https://x.example/j?a=1&b=2'));
  assert.equal(
    dedupUrlKey('https://Kyndryl.wd5.myworkdayjobs.com/KyndrylProfessionalCareers/job/Network-Engineer_R-64949'),
    dedupUrlKey('https://kyndryl.wd5.myworkdayjobs.com/kyndrylprofessionalcareers/job/network-engineer_r-64949'),
  );
  assert.equal(dedupUrlKey('https://jobs.ashbyhq.com/secfix/3fd7/application'), dedupUrlKey('https://jobs.ashbyhq.com/secfix/3fd7'));
  assert.equal(dedupUrlKey('https://jobs.lever.co/acme/abc/apply'), dedupUrlKey('https://jobs.lever.co/acme/abc'));
});

test('dedup key: identity-bearing params and query-value case stay', () => {
  assert.notEqual(dedupUrlKey('https://boards.greenhouse.io/acme/jobs/1?gh_jid=1'), dedupUrlKey('https://boards.greenhouse.io/acme/jobs/1?gh_jid=2'));
  assert.ok(dedupUrlKey('https://boards.greenhouse.io/acme/jobs/9?gh_jid=AbC').includes('gh_jid=AbC'));
  assert.notEqual(dedupUrlKey('https://wellfound.com/jobs?job_listing_slug=4722560-a'), dedupUrlKey('https://wellfound.com/jobs?job_listing_slug=4589442-b'));
  assert.notEqual(dedupUrlKey('https://jobs.example.com/careers#/job/123'), dedupUrlKey('https://jobs.example.com/careers#/jobs/456'));
});

test('dedup key: empty, nullish, unparsable and local: input come back unchanged', () => {
  assert.equal(dedupUrlKey(''), '');
  assert.equal(dedupUrlKey(null), null);
  assert.equal(dedupUrlKey(undefined), undefined);
  assert.equal(dedupUrlKey('not a url'), 'not a url');
  assert.equal(dedupUrlKey('local:jds/acme-ai-engineer.md'), 'local:jds/acme-ai-engineer.md');
});

test('the merge key is untouched: two spellings stay two tracker identities', () => {
  assert.notEqual(
    normalizeUrl('https://xflow.bamboohr.com/careers/130?source=aWQ9MjE='),
    normalizeUrl('https://xflow.bamboohr.com/careers/130'),
  );
});

test('node scan.mjs and the dashboard compare URLs with one function', async () => {
  const { normalizeUrlForDedup } = await import('../scan.mjs');
  for (const url of [
    'https://acme.jobs.personio.com/job/2670127?language=en',
    'http://Jobs.Example.com/J/7/?utm_source=x&ref=feed',
    'https://jobs.example.com/careers#/jobs/456',
    'https://x.example/j?b=2&a=1',
    'local:jds/acme-ai-engineer.md',
    '',
  ]) {
    assert.equal(normalizeUrlForDedup(url), dedupUrlKey(url), url);
  }
});

test('role words: one must start the other, so "tech" no longer matches "fintech" or "healthtech"', () => {
  assert.equal(rolesLikelySame('HealthTech Co-Founder / Head of Product', 'Industrial Tech Co-Founder / Head of Product'), false);
  assert.equal(rolesLikelySame('Fintech Co-Founder / Head of Product', 'Industrial Tech Co-Founder / Head of Product'), false);
  assert.equal(roleMatch('Fintech Co-Founder / Head of Product', 'Industrial Tech Co-Founder / Head of Product'), false);
  // the same opening, and a word with its inflection, still match
  assert.equal(rolesLikelySame('Industrial Tech Co-Founder / Head of Product', 'Industrial Tech Co-Founder / Head of Product (100 % remote)'), true);
  assert.equal(rolesLikelySame('Product Designer', 'Senior Product Designer (UI/UX)'), true);
  assert.equal(rolesLikelySame('Product Design Lead', 'Lead Product Designer'), true);
  assert.equal(rolesLikelySame('Senior Product Designer', 'Senior Product Manager'), false);
});

// ui/server.mjs: every "is it already known?" comparison of a scan reads both sides through knownUrlKey.
const server = readFileSync(new URL('../ui/server.mjs', import.meta.url), 'utf-8');
const between = (from, to) => server.slice(server.indexOf(from), server.indexOf(to, server.indexOf(from)));

test('server: the history block, the pre-dedup and the post-Jev filter use the shared key', () => {
  const history = between('async function getBlockingScanHistoryUrlSet', 'async function getLatestScanHistoryEntryMap');
  assert.match(history, /knownUrlKey\(url\)/);
  assert.doesNotMatch(history, /normalizeUrlKey/);

  const pre = between('const knownNormalized = new Set([', 'const skippedKnown');
  assert.match(pre, /const key = knownUrlKey\(c\.url\)/);
  assert.doesNotMatch(pre, /normalizeUrlKey/);

  const post = between('const existingPipelineUrls = new Set(', 'const enrichScanEntry');
  assert.match(post, /const key = knownUrlKey\(url\)/);
  assert.match(post, /processedPipelineKeys = new Set\(\[\.\.\.await getProcessedPipelineUrlKeys/);
  assert.match(post, /normalizedReportUrls = new Set\(\[\.\.\.existingReportUrls\]\.map\(url => knownUrlKey\(url\)\)/);
});
