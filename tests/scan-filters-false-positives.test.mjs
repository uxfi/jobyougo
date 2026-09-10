// tests/scan-filters-false-positives.test.mjs — guard high-noise title terms.
import { pathToFileURL } from 'url';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nScanner — title false positives');

const { loadPortals, passesTitle } = await import(pathToFileURL(join(ROOT, 'lib/scan-filters.mjs')).href);
const portals = loadPortals(join(ROOT, 'portals.yml'));

const rejected = [
  'L1 Hosting Tech Support Agent',
  'Helpdesk Support Agent 6-Month Fixed-Term Contract',
  'Luxury Goods Consultant - Fully Remote',
  'Professional Services Consultant, GRC',
];

for (const title of rejected) {
  const result = passesTitle(title, portals.title_filter);
  if (!result.ok) pass(`rejects noisy title: ${title}`);
  else fail(`expected noisy title to be rejected: ${title}`);
}

const accepted = [
  'AI Agent Product Manager',
  'Conversational Agent Designer',
  'Principal AI & Agent Systems Engineer',
  'Senior Product Manager, AI and Endpoint',
];

for (const title of accepted) {
  const result = passesTitle(title, portals.title_filter);
  if (result.ok) pass(`keeps relevant title: ${title}`);
  else fail(`expected relevant title to pass: ${title} (blocked by ${result.blockedBy || 'no positive match'})`);
}
