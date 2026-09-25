import { pass, fail } from './helpers.mjs';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';
import {
  assessFreshness,
  assessRemote,
  dedupeCandidates,
  explainTitle,
  runTitleDryRun,
  selectRoster,
} from '../lib/scan-decision.mjs';
import { buildJevScanResponse, classifyJevOutcome } from '../lib/jev.mjs';
import { extractScanEntriesFromResponse } from '../lib/scan-parse.mjs';
import { ROOT } from './helpers.mjs';

console.log('\nShared scan decision engine');

const portals = yaml.load(readFileSync(join(ROOT, 'portals.yml'), 'utf-8'));
const dry = runTitleDryRun();
if (dry.mismatches === 0) pass(`title dry-run matches ${dry.accepted + dry.rejected} examples`);
else {
  fail(`title dry-run mismatches ${dry.mismatches}`);
  for (const row of dry.rows.filter(item => !item.ok)) console.log(`      ${row.expected} ${row.title} → ${row.detail}`);
}

const strictRemote = portals.remote_filter;
const ambiguous = assessRemote({ title: 'Product Manager', location: 'Lyon, France' }, strictRemote);
if (ambiguous.disposition === 'review' && ambiguous.confidence < 0.5) {
  pass('strict mode sends a missing remote signal to review');
} else fail(`expected review for ambiguous remote, got ${ambiguous.disposition} ${ambiguous.confidence}`);

const hybrid = assessRemote({ title: 'Product Manager', location: 'Paris', description: 'Hybrid, 3 days on-site' }, strictRemote);
if (hybrid.disposition === 'reject' && hybrid.confidence === 0) pass('hybrid is rejected');
else fail(`expected hybrid reject, got ${hybrid.disposition}`);

const europe = assessRemote({ title: 'Senior Product Manager', location: 'Remote - Europe' }, strictRemote);
if (europe.disposition === 'keep' && europe.confidence >= 0.9) pass('explicit remote Europe stays a strict keep');
else fail(`expected strict remote keep, got ${europe.disposition} ${europe.confidence}`);

const title = explainTitle('UX Researcher', portals.title_filter);
if (title.ok) pass('UX Researcher matches a configured pattern');
else fail(`UX Researcher rejected: ${title.reason}`);

const manager = explainTitle('Engineering Manager', portals.title_filter);
if (!manager.ok) pass('Engineering Manager is blocked by a configured pattern');
else fail('Engineering Manager should be rejected');

const today = '2026-09-24';
const fresh = assessFreshness({ publishedAt: '', firstSeen: '', maxAgeDays: 7, today });
if (fresh.ok && fresh.source === 'proxy' && fresh.freshness < 0.5) pass('undated offer uses a first_seen proxy and is downranked');
else fail(`expected proxy downrank, got ${JSON.stringify(fresh)}`);

const stale = assessFreshness({ publishedAt: '', firstSeen: '2026-08-01', maxAgeDays: 7, today });
if (!stale.ok && stale.reason.includes('first seen')) pass('an undated offer expires after the proxy window');
else fail(`expected stale proxy, got ${JSON.stringify(stale)}`);

const roster = selectRoster([
  { url: 'https://a.example/1', source: 'Board', preScore: 0.2, publishedAt: '2026-09-01' },
  { url: 'https://a.example/2', source: 'Board', preScore: 0.95, publishedAt: '2026-09-20' },
  { url: 'https://b.example/1', source: 'Other', preScore: 0.9, publishedAt: '2026-09-20' },
  { url: 'https://a.example/3', source: 'Board', preScore: 0.5, publishedAt: '2026-09-02' },
], { limit: 2, maxShare: 0.5 });
const urls = roster.selected.map(item => item.url);
if (urls[0] === 'https://a.example/2' && urls.includes('https://b.example/1') && !urls.includes('https://a.example/1')) {
  pass('roster follows pre-score and keeps a second source inside the cap');
} else fail(`unexpected roster ${urls.join(', ')}`);

const deduped = dedupeCandidates([
  { url: 'https://jobs.example.com/a?utm_source=x', title: 'Senior Product Manager', company: 'Acme' },
  { url: 'https://jobs.example.com/a', title: 'Senior Product Manager', company: 'Acme' },
  { url: 'https://jobs.example.com/b', title: 'Product Manager, AI Platform', company: 'Acme' },
]);
if (deduped.length === 1) pass('canonical URL and fuzzy company/title collapse the same posting');
else fail(`expected 1 deduped offer, got ${deduped.length}`);

if (classifyJevOutcome({ error: 'timeout' }) === 'unverified') pass('Jev failure is unverified');
else fail('Jev failure should be unverified');
if (classifyJevOutcome({ keepProb: 0.9, threshold: 0.55 }) === 'validated') pass('Jev score above threshold is validated');
else fail('high Jev score should validate');
if (classifyJevOutcome({ keepProb: null }) === 'unverified') pass('missing Jev score is unverified');
else fail('missing Jev score should be unverified');

const response = buildJevScanResponse({
  considered: 2,
  kept: [{ url: 'https://example.com/keep', company: 'Acme', title: 'PM', publishedAt: '2026-09-20', jevKeep: 0.8 }],
  unverified: [{ url: 'https://example.com/unverified', company: 'Beta', title: 'Designer' }],
  review: [{ url: 'https://example.com/review', company: 'Gamma', title: 'Lead' }],
});
const extracted = extractScanEntriesFromResponse(response).map(entry => entry.url);
if (extracted.length === 1 && extracted[0] === 'https://example.com/keep' && response.includes('URLs_NON_QUALIFIEES')) {
  pass('unverified and review URLs stay out of the validated add list');
} else fail(`validated extract leaked: ${extracted.join(', ')}`);
