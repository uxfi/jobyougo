import { pass, fail } from './helpers.mjs';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';
import {
  assessFreshness,
  assessRemote,
  collapseDuplicateTitles,
  dedupeCandidates,
  evaluateCandidate,
  explicitDateFromText,
  relativeDateFromText,
  resolvePublishedDate,
  runTitleDryRun,
  explainTitle,
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
if (explicitDateFromText('Tuyển dụng Product Manager [Update 23/06/2026]') === '2026-06-23') {
  pass('a day/month/year in the title is a published date');
} else fail(`expected 2026-06-23, got ${explicitDateFromText('Tuyển dụng Product Manager [Update 23/06/2026]')}`);
if (explicitDateFromText('606 Senior Product Manager Ai Job Vacancies In July 2026') === '2026-07-31') {
  pass('a month and year in the title uses the last day of that month');
} else fail(`expected 2026-07-31, got ${explicitDateFromText('606 Senior Product Manager Ai Job Vacancies In July 2026')}`);

const titledOld = evaluateCandidate(
  { url: 'https://example.com/jobs/991122', title: 'Senior Product Manager Update 23/06/2026', location: 'Remote' },
  { scan_max_age_days: 7, title_filter: { positive: ['Product Manager'] } },
  { today: '2026-10-06' },
);
if (titledOld.reasonCode === 'age' && titledOld.disposition === 'reject') {
  pass('a title date older than scan_max_age_days is rejected');
} else fail(`expected age reject, got ${titledOld.disposition}/${titledOld.reasonCode} ${titledOld.reasons.join('; ')}`);

const ageGate = { scan_max_age_days: 7, title_filter: { positive: ['Product Manager'] } };
const postedAgo = evaluateCandidate(
  { url: 'https://example.com/jobs/441100', title: 'Senior Product Manager', description: 'Posted 20 days ago' },
  ageGate,
  { today: '2026-10-06' },
);
if (postedAgo.reasonCode === 'age') pass('a "posted N days ago" badge older than the window is rejected');
else fail(`expected age reject for posted 20 days ago, got ${postedAgo.disposition}/${postedAgo.reasonCode}`);

const weeksAgo = relativeDateFromText('il y a 3 semaines', '2026-10-06');
if (weeksAgo === '2026-09-15') pass('il y a 3 semaines resolves to 21 days before today');
else fail(`expected 2026-09-15, got ${weeksAgo}`);

const fromUrl = resolvePublishedDate({ url: 'https://blog.example.com/2026/05/02/senior-product-manager', title: 'Senior Product Manager' }, '2026-10-06');
if (fromUrl === '2026-05-02') pass('a /YYYY/MM/DD path is a published date');
else fail(`expected 2026-05-02 from the URL, got ${fromUrl}`);

const experience = evaluateCandidate(
  { url: 'https://example.com/jobs/441101', title: 'Senior Product Manager', description: 'Plus de 3 mois d\'expérience et 5 years of experience.' },
  ageGate,
  { today: '2026-10-06' },
);
if (experience.reasonCode !== 'age') pass('experience length is not treated as a publication date');
else fail(`experience text was read as a publication date: ${experience.reasons.join('; ')}`);

const hier = resolvePublishedDate(
  { title: 'Senior Product Manager', description: 'Hier, l equipe a livre un prototype.' },
  '2026-10-06',
);
if (!hier) pass('a French sentence starting with Hier is not a publication date');
else fail(`Hier sentence became ${hier}`);

const history = resolvePublishedDate(
  { title: 'Senior Product Manager', publishedAt: '2026-10-05', description: 'We published the design system in March 2020.' },
  '2026-10-06',
);
if (history === '2026-10-05') pass('a source date is kept when the description mentions an older publication');
else fail(`source date was replaced by ${history}`);

const futureTitle = resolvePublishedDate(
  { title: 'Product Manager — you may join in October 2026' },
  '2026-10-06',
);
if (!futureTitle) pass('a future month in the title is not a publication date');
else fail(`future title date became ${futureTitle}`);

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
  { url: 'https://jobs.example.com/b', title: 'Product Manager (Remote)', company: 'Acme' },
]);
if (deduped.length === 1) pass('canonical URL and fuzzy company/title collapse the same posting');
else fail(`expected 1 deduped offer, got ${deduped.length}`);
// A bare "Product Manager" is not every PM opening at the company.
const distinct = dedupeCandidates([
  { url: 'https://jobs.example.com/a', title: 'Senior Product Manager', company: 'Acme' },
  { url: 'https://jobs.example.com/b', title: 'Product Manager, AI Platform', company: 'Acme' },
]);
if (distinct.length === 2) pass('a specific opening survives next to a bare family title');
else fail(`expected 2 offers, got ${distinct.length}`);

const collapsed = collapseDuplicateTitles([
  { url: 'https://jobs.example.com/sg', title: 'Product Lead - AI Finance', source: 'Bjak', location: 'Singapore' },
  { url: 'https://jobs.example.com/de', title: 'Product Lead - AI Finance', source: 'Bjak', location: 'Germany' },
  { url: 'https://jobs.example.com/invest', title: 'Product Lead - AI Investing', source: 'Bjak', location: 'Germany' },
]);
if (collapsed.length === 2 && collapsed[0].url.endsWith('/sg') && collapsed[1].url.endsWith('/invest')) {
  pass('same title from one board collapses to a single location');
} else fail(`expected 2 collapsed titles, got ${collapsed.map(item => item.url).join(', ')}`);

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
