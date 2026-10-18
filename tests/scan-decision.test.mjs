// requires-user-layer: portals.yml
import { pass, fail } from './helpers.mjs';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';
import {
  assessFreshness,
  assessRemote,
  belowTargetLevelReason,
  collapseDuplicateTitles,
  contractMismatchReason,
  dedupeCandidates,
  evaluateCandidate,
  explicitDateFromText,
  geoPolicyFrom,
  internOrJuniorReason,
  jevDropOverrideReason,
  jevEvalOverrideReason,
  levelGateReason,
  levelPolicyFrom,
  listingPageReason,
  relativeDateFromText,
  resolvePublishedDate,
  roleFamilyPattern,
  runTitleDryRun,
  explainTitle,
  selectRoster,
} from '../lib/scan-decision.mjs';
import { resolveLocationProfile } from '../lib/candidate-location.mjs';
import { buildJevScanResponse, classifyJevOutcome } from '../lib/jev.mjs';
import { extractScanEntriesFromResponse } from '../lib/scan-parse.mjs';
import { ROOT } from './helpers.mjs';

// The role family and level policy come from the profile (roleFamilyPattern,
// levelPolicyFrom). These checks use the owner's 2026-10 targeting.
const OWNER_TARGETING = {
  archetypes: [
    { name: 'Product Designer', level: 'Senior/Lead', fit: 'primary' },
    { name: 'UX/UI Designer', level: 'Senior', fit: 'primary' },
    { name: 'AI Product Designer', level: 'Senior/Lead', fit: 'primary' },
    { name: 'Founding Product Designer', level: 'Senior', fit: 'primary' },
    { name: 'AI Product Builder', level: 'Senior', fit: 'primary' },
    { name: 'Product Manager', level: 'Product scope dependent', fit: 'secondary' },
  ],
  primaryRoles: ['Senior Product Designer', 'Lead Product Designer', 'AI Product Designer', 'Founding Product Designer', 'AI Product Builder'],
  rejectInternships: true,
};
const ownerDrop = (candidate, contractTypes = []) => jevDropOverrideReason(candidate, { contractTypes, targeting: OWNER_TARGETING });
const ownerEval = (input) => jevEvalOverrideReason({ ...input, targeting: OWNER_TARGETING });

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

const narrative = resolvePublishedDate(
  { title: 'Senior Product Manager', description: 'Il y a 3 mois, nous avons lance la plateforme.' },
  '2026-10-06',
);
if (!narrative) pass('a narrative "il y a 3 mois," is not a publication date');
else fail(`narrative French date became ${narrative}`);

const publishedAgo = resolvePublishedDate(
  { title: 'Senior Product Manager', description: 'We published 3 months ago a new design system.' },
  '2026-10-06',
);
if (!publishedAgo) pass('a sentence about something published months ago is not the posting date');
else fail(`published-ago sentence became ${publishedAgo}`);

const version = explicitDateFromText('Senior Product Manager t1/2026', '2026-10-06');
if (!version) pass('a version token t1/2026 is not a Vietnamese posting month');
else fail(`version token became ${version}`);

const postedComma = relativeDateFromText('Posted 20 days ago, remote EU', '2026-10-06');
if (postedComma === '2026-09-16') pass('a posted badge stays a date when a comma follows');
else fail(`posted badge with comma became ${postedComma}`);

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

if (internOrJuniorReason('Product Manager - Stage de fin d\'études', 'https://www.welcometothejungle.com/en/companies/galadrim/jobs/product-manager-stage-de-fin-d-etudes_paris')) {
  pass('a French internship title is rejected before Jev');
} else fail('stage de fin d\'études should be intern/junior');

if (internOrJuniorReason('Product Designer Intern', 'https://jobs.example.com/intern')) {
  pass('an intern title is rejected before Jev');
} else fail('intern title should be intern/junior');

if (internOrJuniorReason('Alternante(e) UX/UI designer (H/F/D) (H/F)', '') && internOrJuniorReason('Apprentie Product Designer', '')) {
  pass('feminine French apprenticeship titles are rejected before Jev');
} else fail('alternante / apprentie should be intern/junior');

if (internOrJuniorReason('Senior Product Designer', 'https://jobs.example.com/spd')) {
  fail('a senior title must not be treated as intern/junior');
} else pass('a senior title is not intern/junior');

if (internOrJuniorReason('Early-stage Product Designer', '')) {
  fail('early-stage in a title must not be treated as an internship');
} else pass('early-stage is not an internship');

if (internOrJuniorReason('', 'https://www.welcometothejungle.com/en/companies/galadrim/jobs/product-manager-stage-de-fin-d-etudes_paris')) {
  pass('a WTTJ internship slug is rejected even without a title');
} else fail('URL slug stage-de-fin should be intern/junior');

if (ownerDrop({ title: 'Product Design', url: 'https://jobs.ashbyhq.com/axle-careers/c0bc06e2-6e73-486d-ac83-3fe1059b327e' }) === 'target role family') {
  pass('a Product Design title is a keep even without Senior in the name');
} else fail('Product Design must override a Jev drop');

// Product Manager is a secondary archetype in profile.yml (scope dependent):
// Jev decides PM titles, the override no longer force-keeps them.
for (const pmTitle of [
  'Senior Product Manager B2C',
  'Product Pricing Manager',
  'Product Assurance Manager',
  'Technical Product Owner',
  'Head of Product',
  'Product Lead',
]) {
  if (!ownerDrop({ title: pmTitle, url: 'https://careers.example.com/jobs/8468369-role' })) {
    pass(`a Jev drop of "${pmTitle}" stands (PM titles are not force-kept)`);
  } else fail(`"${pmTitle}" must not override a Jev drop any more`);
}

for (const designTitle of [
  'Senior Product Designer',
  'Lead Product Designer, Payments',
  'Staff Product Designer',
  'Principal Product Designer',
  'Head of Product Design',
  'UX/UI Designer',
  'UI Designer',
  'User Experience Designer',
  'AI Product Builder',
]) {
  if (ownerDrop({ title: designTitle, url: 'https://careers.example.com/jobs/8468369-role' }) === 'target role family') {
    pass(`"${designTitle}" is in the design family and overrides a Jev drop`);
  } else fail(`"${designTitle}" should override a Jev drop`);
}

if (!ownerEval({
  title: 'Senior Product Manager',
  url: 'https://careers.example.com/jobs/8468369-senior-product-manager',
  jdText: 'Senior Product Manager, pricing platform. Fully remote, Europe.',
})) {
  pass('a PM title no longer forces the eval gate open');
} else fail('the eval override must not apply to a PM title');

for (const [levelTitle, expected] of [
  ['Assistant Product Designer', 'below target level (assistant)'],
  ['Design Assistant', 'below target level (assistant)'],
  ['Assistant(e) Chef de projet digital', 'below target level (assistant)'],
  ['UI/UX Designer (Mid Level)', 'below target level (mid-level)'],
  ['Mid-Level Product Designer', 'below target level (mid-level)'],
  ['Midweight UX Designer', 'below target level (mid-level)'],
  ['Intermediate UX Designer', 'below target level (mid-level)'],
]) {
  const got = belowTargetLevelReason(levelTitle);
  if (got === expected) pass(`"${levelTitle}" is below the target level`);
  else fail(`"${levelTitle}": expected "${expected}", got "${got}"`);
}

for (const keepTitle of [
  'Senior Product Designer, AI Assistant',
  'Product Designer - Voice Assistant',
  'Assistant Vice President, Product Design',
  'Mid/Senior Product Designer',
  'Mid-Level to Senior Product Designer',
  'Mid-Senior Product Designer',
  'Mid Senior Product Designer',
  'Product Designer (Intermediate/Senior)',
  'Mid-Market Product Manager',
  'Senior Product Designer',
]) {
  const got = belowTargetLevelReason(keepTitle);
  if (!got) pass(`"${keepTitle}" is not below the target level`);
  else fail(`"${keepTitle}" wrongly flagged: ${got}`);
}

// Report 702: "Senior Freelance Product Designer (Fractional)" was force-kept
// for a profile that asks for a salaried role (search.contract_types).
const clera = { title: 'Senior Freelance Product Designer (Fractional)', url: 'https://jobs.example.com/clera/1234567' };
if (contractMismatchReason(clera.title, ['Salaried']) === 'freelance role, candidate wants Salaried'
  && contractMismatchReason('Product Designer - 6-month contract', ['Salaried'])
  && !contractMismatchReason(clera.title, ['Salaried', 'Freelance'])
  && !contractMismatchReason(clera.title, [])
  && !contractMismatchReason('Senior Product Designer', ['Salaried'])) {
  pass('contractMismatchReason flags freelance/contract titles only for a salaried-only profile');
} else fail('contractMismatchReason should reuse detectContract against the profile contract types');

// detectContract used to read "Permanent contract" as a contract role, and a
// CDD (salaried, fixed-term) as one too.
const permanentTitle = 'Staff Product Designer – Dropbox – Permanent contract – Fully-remote';
const permanentDecision = evaluateCandidate(
  { url: 'https://example.com/jobs/551102', title: permanentTitle, location: 'Remote - Europe' },
  { title_filter: { positive: ['Product Designer'] } },
  { today: '2026-10-13' },
);
if (!contractMismatchReason(permanentTitle, ['Salaried'])
  && permanentDecision.signals.contract === 'permanent'
  && !contractMismatchReason('Product Designer CDD 6 mois', ['Salaried'])) {
  pass('"Permanent contract" and CDD titles are salaried, not contractor roles');
} else fail(`permanent/CDD misread: ${permanentDecision.signals.contract}`);

if (!ownerDrop(clera, ['Salaried']) && ownerDrop(clera) === 'target role family') {
  pass('a freelance design title is not force-kept for a salaried profile');
} else fail('the override must skip a contract type the candidate refuses');

if (!ownerEval({ ...clera, jdText: 'Fractional, fully remote, 2 days a week.', contractTypes: ['Salaried'] })) {
  pass('the eval override does not open the gate for a refused contract type');
} else fail('the eval override must pass the contract types to the drop override');

if (levelGateReason('Junior Product Designer', '') === 'junior title'
  && levelGateReason('Assistant Product Designer', '') === 'below target level (assistant)'
  && !levelGateReason('Lead Product Designer', '')) {
  pass('levelGateReason chains intern/junior then assistant/mid-level');
} else fail('levelGateReason should chain internOrJuniorReason and belowTargetLevelReason');

if (!ownerDrop({ title: 'Assistant Product Designer', url: 'https://jobs.example.com/1234567' })
  && !ownerDrop({ title: 'UI/UX Designer (Mid Level)', url: 'https://jobs.example.com/1234567' })) {
  pass('assistant and mid-level design titles are not force-kept');
} else fail('a below-level design title must not override a Jev drop');

const levelGate = { title_filter: { positive: ['Product Designer', 'UX Designer'] } };
const assistantDecision = evaluateCandidate(
  { url: 'https://example.com/jobs/551100', title: 'Assistant Product Designer', location: 'Remote - Europe' },
  levelGate,
  { today: '2026-10-13' },
);
if (assistantDecision.disposition === 'reject' && assistantDecision.reasonCode === 'level') {
  pass('the scan gate rejects an assistant title before Jev');
} else fail(`expected level reject, got ${assistantDecision.disposition}/${assistantDecision.reasonCode}`);

const seniorDecision = evaluateCandidate(
  { url: 'https://example.com/jobs/551101', title: 'Senior Product Designer', location: 'Remote - Europe' },
  levelGate,
  { today: '2026-10-13' },
);
if (seniorDecision.reasonCode !== 'level') pass('the scan gate keeps a senior design title');
else fail(`senior title rejected by the level gate: ${seniorDecision.reasons.join('; ')}`);

if (!ownerDrop({ title: 'Product Design Intern', url: 'https://jobs.example.com/intern' })) {
  pass('an intern Product Design title is still dropped');
} else fail('intern Product Design should not override');

if (!ownerDrop({ title: 'Product Designer', url: 'https://yoailabs.careers-page.com/jobs/6e74bd57-3dee-4402-a921-2cb264549dfb/apply' })) {
  pass('an /apply URL is left for Jev to drop');
} else fail('/apply pages must not be force-kept');

if (!ownerEval({ title: 'Senior Product Designer', url: 'https://www.welcometothejungle.com/en/companies/lemlist/jobs/senior-product-designer_paris', jdText: '' })) {
  pass('eval override waits for a real job description');
} else fail('empty JD must not force Claude');

if (!ownerEval({
  title: 'Senior Product Designer',
  url: 'https://www.welcometothejungle.com/en/companies/lemlist/jobs/senior-product-designer_paris',
  jdText: 'Hybrid role, 3 days on-site in Paris. Relocation required.',
})) {
  pass('eval override does not force a hybrid/onsite JD');
} else fail('verbatim attendance must still skip eval');

if (ownerEval({
  title: 'Senior Staff Product Designer',
  url: 'https://www.welcometothejungle.com/en/companies/omnidoc/jobs/senior-staff-product-designer-full-time',
  jdText: 'Senior Staff Product Designer. Fully remote, Europe.',
}) === 'role family, no verbatim attendance lock') {
  pass('a designer JD without an attendance lock can pass the eval gate');
} else fail('designer JD without attendance lock should override a timid eval score');

if (explainTitle('Product Manager - Stage de fin d\'études', portals.title_filter).ok) {
  fail('title filter should drop a stage de fin d\'études');
} else pass('title filter drops French internships');

// Without targeting nothing is force-kept; another profile gets its own family.
if (!jevDropOverrideReason({ title: 'Senior Product Designer', url: 'https://jobs.example.com/1234567' })) {
  pass('no targeting: no role family override');
} else fail('a profile without targeting must not force-keep design titles');
{
  const engineer = { archetypes: [{ name: 'Senior Backend Engineer', level: 'Senior', fit: 'primary' }], primaryRoles: ['Staff Software Engineer'], rejectInternships: true };
  const keepsBackend = jevDropOverrideReason({ title: 'Backend Engineer', url: 'https://jobs.example.com/1234567' }, { targeting: engineer }) === 'target role family';
  const skipsDesign = !jevDropOverrideReason({ title: 'Senior Product Designer', url: 'https://jobs.example.com/1234567' }, { targeting: engineer });
  if (keepsBackend && skipsDesign) pass('an engineer profile force-keeps its own family only');
  else fail(`engineer family override: backend=${keepsBackend} designSkipped=${skipsDesign}`);
}
{
  const junior = { archetypes: [{ name: 'Data Analyst', level: 'Junior', fit: 'primary' }], primaryRoles: ['Junior Data Analyst'], rejectInternships: false };
  const policy = levelPolicyFrom(junior);
  if (!levelGateReason('Junior Data Analyst', '', policy) && !levelGateReason('Data Analyst (Mid Level)', '', policy)) {
    pass('a junior profile keeps junior and mid-level titles');
  } else fail('levelPolicyFrom should open junior/mid-level titles for a junior target');
}

// ── Review fixes: neutral geography, US rejects, Americas parts, level, family, on-site exceptions
{
  const strictUs = { mode: 'strict_full_remote_only', required_any: ['remote'], rejected_any: ['hybrid', 'on-site', 'must live in the us', 'i-9', 'e-verify'], ambiguous_policy: 'review' };
  const usOffer = { title: 'Senior Product Designer', location: 'Remote', description: 'Remote. Must live in the US. E-Verify employer.' };

  const unknown = geoPolicyFrom(resolveLocationProfile({}));
  if (unknown.usAuthorized === null && unknown.rejected.length === 0 && !unknown.allowed.includes('paris')) {
    pass('a profile without bases or authorized countries gets a neutral geo policy, not the built-in defaults');
  } else fail(`neutral geo policy expected, got ${JSON.stringify(unknown)}`);
  const unknownUs = assessRemote({ ...usOffer, location: 'Remote - US' }, { mode: 'strict_full_remote_only', required_any: ['remote'] }, [], unknown);
  if (unknownUs.disposition !== 'reject') pass('unknown US status is not refused on US work-auth or US geography');
  else fail(`unknown US status rejected: ${unknownUs.reason}`);
  if (geoPolicyFrom(null) === null) pass('no location profile keeps the built-in defaults');
  else fail('geoPolicyFrom(null) should be null');

  const usPolicy = geoPolicyFrom(resolveLocationProfile({ location: { city: 'Austin', country: 'United States' } }));
  const usKept = assessRemote(usOffer, strictUs, [], usPolicy);
  const ownerPolicy = geoPolicyFrom(resolveLocationProfile({ location: { city: 'Paris', country: 'France', authorized_in: ['France', 'European Union'] } }));
  const ownerDropped = assessRemote(usOffer, strictUs, [], ownerPolicy);
  if (usKept.disposition !== 'reject' && ownerDropped.disposition === 'reject') {
    pass('portals rejected_any US phrases (must live in the us, e-verify) open for a US-authorized user only');
  } else fail(`US rejected_any: us=${usKept.disposition} (${usKept.reason}) owner=${ownerDropped.disposition}`);

  const americas = { mode: 'strict_full_remote_only', required_any: ['remote'], rejected_geo_any: ['latam', 'north america'] };
  const brazilPolicy = geoPolicyFrom(resolveLocationProfile({ location: { city: 'Sao Paulo', country: 'Brazil' } }));
  const verdict = (policy, location) => assessRemote({ title: 'Product Designer', location }, americas, [], policy).disposition;
  if (verdict(usPolicy, 'Remote - LATAM') === 'reject' && verdict(usPolicy, 'Remote - North America') !== 'reject'
    && verdict(brazilPolicy, 'Remote - LATAM') !== 'reject' && verdict(brazilPolicy, 'Remote - North America') === 'reject') {
    pass('the Americas open only the user\'s own part: LATAM for Brazil, North America for the US');
  } else fail(`Americas parts: us latam=${verdict(usPolicy, 'Remote - LATAM')} us na=${verdict(usPolicy, 'Remote - North America')} br latam=${verdict(brazilPolicy, 'Remote - LATAM')} br na=${verdict(brazilPolicy, 'Remote - North America')}`);

  const midSenior = levelPolicyFrom({ archetypes: [{ name: 'Product Designer', level: 'Mid/Senior', fit: 'primary' }] });
  if (!midSenior.belowSenior && !levelGateReason('Product Designer (Mid Level)', '', midSenior)
    && levelPolicyFrom(OWNER_TARGETING).belowSenior && levelGateReason('Product Designer (Mid Level)', '', levelPolicyFrom(OWNER_TARGETING))) {
    pass('a Mid/Senior target keeps mid-level titles; a Senior/Lead target still drops them');
  } else fail(`Mid/Senior level policy: ${JSON.stringify(midSenior)}`);

  const aiEngineer = roleFamilyPattern({ archetypes: [{ name: 'AI Engineer', level: 'Senior', fit: 'primary' }] });
  const headOfProduct = roleFamilyPattern({ primaryRoles: ['Head of Product'] });
  if (aiEngineer.test('Senior AI Engineer') && !aiEngineer.test('Sales Engineer') && !aiEngineer.test('Field Service Engineer')
    && headOfProduct.test('Head of Product, Payments') && !headOfProduct.test('Product Marketing Manager')
    && roleFamilyPattern(OWNER_TARGETING).test('Product Designer')) {
    pass('a lone family word keeps its qualifiers (AI Engineer, Head of Product)');
  } else fail(`role family: ai=${aiEngineer} head=${headOfProduct}`);

  const ownerLoc = resolveLocationProfile({
    location: {
      city: 'Paris', country: 'France', asia_city: 'Bangkok', asia_country: 'Thailand',
      authorized_in: ['France', 'European Union', 'Thailand'], remote_policy: 'Full remote required',
      onsite_availability: 'Open to on-site if based in Thailand; comfortable traveling for offsites anywhere',
    },
  });
  const gateConfig = {
    title_filter: { positive: ['Product Designer'], negative: ['Hybrid', 'On-site'] },
    remote_filter: { mode: 'strict_full_remote_only', required_any: ['remote'], rejected_any: ['hybrid', 'on-site', 'onsite'], ambiguous_policy: 'review' },
  };
  const gate = (candidate, locationProfile = ownerLoc) => evaluateCandidate(
    { url: 'https://jobs.example.com/jobs/1234567', ...candidate },
    gateConfig,
    { today: '2026-10-13', locationProfile, geoPolicy: geoPolicyFrom(ownerLoc) },
  );
  const bangkok = gate({ title: 'Senior Product Designer (Hybrid)', location: 'Bangkok, Thailand (Hybrid)' });
  const paris = gate({ title: 'Senior Product Designer', location: 'Paris, France (Hybrid)' });
  const parisTitle = gate({ title: 'Senior Product Designer (Hybrid)', location: 'Paris, France (Hybrid)' });
  const noProfile = gate({ title: 'Senior Product Designer', location: 'Bangkok, Thailand (Hybrid)' }, null);
  if (bangkok.disposition === 'keep' && paris.reasonCode === 'remote' && parisTitle.reasonCode === 'title' && noProfile.disposition === 'reject') {
    pass('a posting located in an on-site exception (Bangkok hybrid) passes the scan gate; Paris hybrid does not');
  } else fail(`on-site exception: bangkok=${bangkok.disposition}/${bangkok.reasons.join('; ')} paris=${paris.reasonCode} parisTitle=${parisTitle.reasonCode} noProfile=${noProfile.disposition}`);
}

// 2026-10-13: Jev kept generic PM titles at 0.5-0.7 for a design-first
// profile whose Product Manager archetype is secondary.
{
  const policy = levelPolicyFrom(OWNER_TARGETING);
  const drops = ['Agile Product Manager', 'Product Manager (Fintech)', 'Mobile Product Manager', 'Technical Product Owner', 'Principal Product Manager, Savings (R13997)'];
  const keeps = ['AI Product Manager (H/F)', 'Product Manager, Design Systems', 'Product Owner UX', 'Senior Product Designer', 'Digital Designer'];
  const wrong = [
    ...drops.filter((t) => levelGateReason(t, '', policy) !== 'secondary role outside the primary scope'),
    ...keeps.filter((t) => levelGateReason(t, '', policy)),
  ];
  if (!wrong.length) pass('a secondary PM archetype passes only with a primary scope word (design, UX, UI, AI)');
  else fail(`secondary scope gate wrong for: ${wrong.join(' | ')}`);
  const pmFirst = levelPolicyFrom({ primaryRoles: ['Senior Product Manager'], archetypes: [{ name: 'Product Designer', fit: 'secondary' }] });
  if (!levelGateReason('Product Designer', '', pmFirst)) pass('no scope word in the primary roles: no secondary gate');
  else fail('a PM-first profile dropped a secondary designer title');
}

{
  const cases = [
    ['Senior Experience Designer (Kraków office 2 days per week), JR 747', ''],
    ['UX Designer JR-1234', ''],
    ['Staff Product Designer - Wise Assistant Experience', ''],
    ['Jr. UIUX Designer', 'junior title'],
    ['Assistant Product Designer', 'below target level (assistant)'],
  ];
  const wrong = cases.filter(([title, want]) => levelGateReason(title, '') !== want).map(([title]) => title);
  if (!wrong.length) pass('a requisition number or a product name is not a level (JR 747, Wise Assistant Experience)');
  else fail('level gate wrong for: ' + wrong.join(' | '));
}

{
  const pages = [
    ['https://uiuxjobsboard.com/salary/product-designer', 'Product Designer Salary Guide 2026 | Complete Pay Data'],
    ['https://lemon.io/rate-calculator/ux-ui-developers/', 'UX/UI Designer Salary & Hourly Rate 2026'],
    ['https://contra.com/hire/product-designers', 'Product Design freelancers - Hire'],
    ['https://www.upwork.com/hire/ux-designers/cost/', 'UX Designer Hourly Rates | Cost to Hire UX Designer | Upwork'],
    ['https://www.yunojuno.com/skills/ux-design', 'UX Design Freelancers: Find the best'],
    ['https://talks.freelancerepublik.com/metiers-freelances-informatique/product/ux-ui-designer/', 'Ui Ux Designer : Fiche Métier, Salaire & Tjm'],
    ['https://lemon.io/for-developers/ui-ux-designer-jobs/', 'UI/UX Designer Jobs — Vetted Remote Contracts, $25–$80/hr'],
    ['https://www.welcometothejungle.com/fr/jobs?query=ux', "Offres d'emploi de UX Designer à Montpellier (34000)"],
    ['https://example.com/blog/how-to-become-a-product-designer', 'How to become a product designer'],
    ['https://tinycto.tv/tech-careers/roles/product-designer-ui-ux', 'Product Designer (UI/UX) — Role Architecture & Career Intelligence | TinyCTO.tv'],
  ];
  const postings = [
    ['https://job-boards.greenhouse.io/clearstreet/jobs/8241353', 'Senior Product Designer — Mobile'],
    ['https://jobs.ashbyhq.com/kraken.com/6366cb5d-6d5b-4768-a2e7-9941b4dd5100', 'Senior Product Manager - Social Experience'],
    ['https://www.welcometothejungle.com/en/companies/blablacar/jobs/senior-lead-product-design_paris', 'Lead Product Design – BlaBlaCar – Permanent contract – Fully-remote'],
    ['https://jobs.lever.co/acme/1a2b3c4d-1111-2222-3333-444455556666', 'Product Designer, Salary Insights Platform'],
    ['https://agentic-engineering-jobs.com/jobs/tiger-tracks-founding-ai-engineer-contract-to-hire-LBGg5p', 'Founding AI Engineer (Contract-to-Hire)'],
  ];
  const missed = pages.filter(([url, title]) => !listingPageReason({ url, title })).map(([url]) => url);
  const wrong = postings.filter(([url, title]) => listingPageReason({ url, title })).map(([url]) => url);
  if (!missed.length && !wrong.length) pass('salary guides, hire pages, trade sheets, articles and "Jobs —" lists are not postings; real postings pass');
  else fail(`listing detector: missed ${missed.join(', ') || '-'}; wrongly flagged ${wrong.join(', ') || '-'}`);
}

{
  const targeting = {
    primaryRoles: ['Senior Product Designer'],
    archetypes: [{ name: 'Product Designer', level: 'Senior/Lead', fit: 'primary' }],
    searchTerms: ['Web Designer', 'UX Researcher', 'Head of Design', 'AI Product', 'Head of Product'],
    rejectInternships: true,
  };
  const url = 'https://jobs.example.com/1234567';
  const over = (title, t = targeting) => jevDropOverrideReason({ title, url }, { targeting: t });
  const keeps = ['Web Designer', 'Senior Web Designer (Remote)', 'UX Researcher', 'Head of Design'];
  const refuses = ['Junior Web Designer', 'Web Designer - Hybrid Paris', 'Product Marketing Manager, AI Product', 'Head of Product', 'Backend Engineer'];
  const wrong = [
    ...keeps.filter((title) => over(title) !== 'profile search term'),
    ...refuses.filter((title) => over(title)),
    // Without the terms in the profile, a Web Designer stays Jev's call.
    ...(over('Web Designer', { ...targeting, searchTerms: [] }) ? ['Web Designer without search terms'] : []),
  ];
  if (!wrong.length) pass('a title holding one of the profile\'s role search terms (Web Designer, UX Researcher) is kept past a Jev drop; topic terms and the other gates still apply');
  else fail(`search-term override wrong for: ${wrong.join(' | ')}`);
}
