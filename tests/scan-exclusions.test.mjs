// tests/scan-exclusions.test.mjs — what counts as "already seen" for a scan:
// the same role at one company, and the same posting under another URL.
import { roleMatch } from '../lib/scan-filters.mjs';
import { dedupeCandidates, rolesLikelySame } from '../lib/scan-decision.mjs';
import { normalizeUrl } from '../url-key.mjs';
import { pass, fail } from './helpers.mjs';

console.log('\nScanner — same role, same posting');

const sameRole = [
  ['Senior Product Designer (Growth)', 'Senior Product Designer, Growth'],
  ['Product Designer', 'Product Designer (UI/UX)'],
  ['Staff Product Designer', 'Senior Product Designer'],
  ['Senior Product Manager- Messenger', 'Senior Product Manager, Messenger'],
  ['Senior UX Designer', 'Senior UX Designer'],
  ['UX/UI Designer', 'UX/UI Designer'],
  ['Product Designer (Confirmed/Senior) - Remote Europe', 'Founding Product Designer'],
  ['Product Manager, Agent Development', 'Product Manager, Agent Development (German speaking)'],
];
// Level words used to make these match: a tracked or deleted PM row hid every
// design role at that company.
const differentRole = [
  ['Senior Product Manager- Messenger', 'Senior Product Designer'],
  ['Lead Product Designer', 'Lead Product Manager, Payments'],
  ['Head of Design', 'Head of Product'],
  ['Engineering Manager', 'Product Manager'],
  ['Senior Product Designer', 'Senior Software Engineer'],
  // Same family, different jobs at one company (real tracked-board titles).
  ['Product Designer, Evals & Prompts', 'Product Designer, Design Systems'],
  ['Technical Product Lead - AI Finance', 'Technical Product Lead - AI Neobank'],
  ['Senior Product Manager- Messenger', 'Senior Forward Deployed Product Manager'],
  ['Staff/Principal Product Manager, Infrastructure Platform', 'Staff/Principal Product Manager (Agent Management Platform)'],
  ['UX Designer', 'UI Designer'],
  // A bare family title must not swallow a specific opening (Glean, 5 PM roles).
  ['Product Manager', 'Product Manager, AI Quality'],
  ['Design Lead', 'Design Lead, Growth'],
];

for (const [a, b] of sameRole) {
  if (roleMatch(a, b) && rolesLikelySame(a, b)) pass(`same role: ${a} = ${b}`);
  else fail(`expected the same role: ${a} | ${b}`);
}
for (const [a, b] of differentRole) {
  if (!roleMatch(a, b) && !rolesLikelySame(a, b)) pass(`different roles: ${a} ≠ ${b}`);
  else fail(`expected different roles: ${a} | ${b}`);
}

const deduped = dedupeCandidates([
  { url: 'https://job-boards.greenhouse.io/intercom/jobs/1', title: 'Senior Product Manager', company: 'Intercom' },
  { url: 'https://job-boards.greenhouse.io/intercom/jobs/2', title: 'Senior Product Designer', company: 'Intercom' },
]);
if (deduped.length === 2) pass('scan dedup keeps a design role next to a PM role at the same company');
else fail(`scan dedup collapsed different roles: ${deduped.map(c => c.title).join(', ')}`);

const samePosting = [
  ['https://jobs.ashbyhq.com/bjakcareer/b34ac3f3-02db-4256-bf2b-0c05e960bd1e', 'https://jobs.ashbyhq.com/bjakcareer/b34ac3f3-02db-4256-bf2b-0c05e960bd1e/application'],
  ['https://jobs.lever.co/acme/1234-abcd', 'https://jobs.lever.co/acme/1234-abcd/apply'],
  ['https://jobs.eu.lever.co/acme/1234-abcd', 'https://jobs.eu.lever.co/acme/1234-abcd/apply/'],
];
for (const [a, b] of samePosting) {
  if (normalizeUrl(a) === normalizeUrl(b)) pass(`apply page keys like its posting: ${b.replace(/^https:\/\//, '')}`);
  else fail(`different keys: ${normalizeUrl(a)} vs ${normalizeUrl(b)}`);
}
if (normalizeUrl('https://example.com/careers/application') === 'https://example.com/careers/application') {
  pass('other hosts keep an /application path');
} else fail('an /application path was stripped outside Ashby');
