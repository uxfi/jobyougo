import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCandidate, excludedDomainReason } from '../lib/scan-decision.mjs';

const DOMAINS = ['remotive.com', 'upwork.com', 'apps.apple.com', 'www.4dayweek.io'];

test('a host or any subdomain of an excluded domain is matched', () => {
  assert.equal(excludedDomainReason('https://remotive.com/remote-jobs/design/x-123', DOMAINS), 'excluded domain (remotive.com)');
  assert.equal(excludedDomainReason('https://www.upwork.com/freelance-jobs/apply/x', DOMAINS), 'excluded domain (upwork.com)');
  assert.equal(excludedDomainReason('https://4dayweek.io/remote-job/x', DOMAINS), 'excluded domain (4dayweek.io)');
  assert.equal(excludedDomainReason('https://apps.apple.com/app/id1', DOMAINS), 'excluded domain (apps.apple.com)');
});

test('look-alike hosts, other Apple pages and an empty list pass', () => {
  assert.equal(excludedDomainReason('https://notremotive.com/jobs/1', DOMAINS), '');
  assert.equal(excludedDomainReason('https://jobs.apple.com/en-us/details/1', DOMAINS), '');
  assert.equal(excludedDomainReason('https://remotive.com/x', []), '');
  assert.equal(excludedDomainReason('not a url', DOMAINS), '');
});

test('evaluateCandidate rejects an excluded posting before any other gate', () => {
  const candidate = { title: 'Senior Product Designer', url: 'https://remotive.com/remote-jobs/design/senior-product-designer-1', location: 'Remote', publishedAt: '2026-10-12' };
  const config = { title_filter: { positive: ['Product Designer'] }, excluded_domains: DOMAINS, scan_max_age_days: 7 };
  const decision = evaluateCandidate(candidate, config, { today: '2026-10-13' });
  assert.equal(decision.disposition, 'reject');
  assert.equal(decision.reasonCode, 'excluded_domain');
  const kept = evaluateCandidate({ ...candidate, url: 'https://jobs.ashbyhq.com/acme/1' }, config, { today: '2026-10-13' });
  assert.notEqual(kept.reasonCode, 'excluded_domain');
});
