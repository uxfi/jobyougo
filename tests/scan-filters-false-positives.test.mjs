// requires-user-layer: portals.yml, config/profile.yml
// tests/scan-filters-false-positives.test.mjs — guard high-noise title terms.
import { pathToFileURL } from 'url';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nScanner — title false positives');

const { passesTitle } = await import(pathToFileURL(join(ROOT, 'lib/scan-filters.mjs')).href);
const { loadPortalsForProfile } = await import(pathToFileURL(join(ROOT, 'lib/scan-targeting.mjs')).href);
// The title filter the scan really runs: portals.yml platforms + the profile's roles (since 2026-10-13
// the positive list lives in config/profile.yml, not in portals.yml).
const portals = loadPortalsForProfile(join(ROOT, 'portals.yml'), join(ROOT, 'config/profile.yml'));

const rejected = [
  'L1 Hosting Tech Support Agent',
  'Helpdesk Support Agent 6-Month Fixed-Term Contract',
  'Luxury Goods Consultant - Fully Remote',
  'Professional Services Consultant, GRC',
  // AI is a qualifier, not a role family: an AI engineering title has no
  // product/design keyword and stays out.
  'Principal AI & Agent Systems Engineer',
];

for (const title of rejected) {
  const result = passesTitle(title, portals.title_filter);
  if (!result.ok) pass(`rejects noisy title: ${title}`);
  else fail(`expected noisy title to be rejected: ${title}`);
}

const accepted = [
  'AI Agent Product Manager',
  'Conversational Agent Designer',
  'Senior Product Manager, AI and Endpoint',
  'AI Product Designer',
  'Senior Product Designer',
];

for (const title of accepted) {
  const result = passesTitle(title, portals.title_filter);
  if (result.ok) pass(`keeps relevant title: ${title}`);
  else fail(`expected relevant title to pass: ${title} (blocked by ${result.blockedBy || 'no positive match'})`);
}
