// Report 692 (Consensys, Senior Product Manager – Universal KYC, 2026-10-13)
// was saved as 1.0/5 SKIP "LLM hard-fail (see report)" for three reasons
// these tests pin:
//
// 1. The URL was re-added without a note, so the Greenhouse API guess only
//    tried the host ("job-boards") and missed. The pipeline fell back to the
//    HTML page, which (without JavaScript) carries the application form and
//    its privacy notice, not the posting. Qwen read the form question "Are
//    you legally authorized to work in the country in which you are
//    currently domiciled?" as a residency lock and the privacy notice's
//    legal address as a Fort Worth, TX office. The API says
//    "EMEA - Remote, UNITED STATES - Remote".
// 2. The enforcement block had no rule telling Qwen that form questions are
//    not requirements, nor that an office city must come from the posting.
// 3. The output looped (the same 13 bullets until max_tokens) and still
//    passed validateReportContent, so a tracker SKIP row was written.
//
// The same chain scored two on-site offers instead of a hard pass: Safran.AI
// (report 708, "télétravail jusqu'à 3 jours/semaine", the work-mode detector
// read English only) and what3words (report 709, Ho Chi Minh City office with
// a "6 week remote working" perk). Reports 692, 708 and 709 also read the
// candidate's residence from the CV instead of the profile.
//
// ui/server.mjs starts on import: its helpers are evaluated from the source
// text in a sandbox, like tests/server-profile-routes.test.mjs does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import {
  DUPLICATE_LINE_RATIO_MAX,
  REPEATED_LINE_MAX,
  REPETITION_LOOP_CODE,
  detectRepetitionLoop,
  extractEvaluationScore,
  validateReportContent,
} from '../lib/report-validation.mjs';
import {
  isUnusableJobDescriptionText,
  parseGreenhousePostingUrl,
  stripApplicationFormHtml,
  stripApplicationFormText,
} from '../lib/ats-jd.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = readFileSync(join(ROOT, 'ui/server.mjs'), 'utf8');

function sourceOf(name) {
  const start = server.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, `${name} is defined`);
  const end = server.indexOf('\n}\n', start);
  return server.slice(start, end + 2);
}

// The named server functions, evaluated together; `context` stubs the rest.
function serverFunctions(names, context = {}) {
  return vm.runInNewContext(`${names.map(sourceOf).join('\n')}\n({ ${names.join(', ')} })`, { URL, ...context });
}

const { extractTextFromHtml } = serverFunctions(['extractTextFromHtml']);

// ── Extract of reports/692-consensys-2026-10-13.md ──────────────────────────
const REPORT_692_HEAD = `# Evaluation — Senior Product Manager – Universal KYC (MetaMask Passport)

**Date:** 2026-10-13
**URL:** https://job-boards.greenhouse.io/consensys/jobs/7903661
**Score:** 1.0/5

---

# Evaluation: Consensys — Senior Product Manager – Universal KYC (MetaMask Passport)

**Score:** 1.0/5 (hard fail: résidence en Thaïlande, pas de sponsorship requis, mais l'annonce exige "authorized to work in the country in which you are currently domiciled" et ne mentionne pas la Thaïlande comme pays autorisé)

## A) Résumé du rôle
Product Manager senior pour un produit d'identité décentralisée (Universal KYC) au sein de MetaMask, poste basé à Fort Worth, Texas, États-Unis, avec exigence explicite de travail légal dans le pays de résidence actuelle. Le poste n'est pas indiqué comme remote, et la localisation de l'entreprise est aux États-Unis. Aucune mention de télétravail ou de flexibilité géographique. Le candidat réside en Thaïlande, ce qui constitue un écart majeur.

## B) Match CV
- **Exigence : "authorized to work in the country in which you are currently domiciled"** → le candidat est résident en Thaïlande, citoyen français (UE), sans sponsorship requis, mais l’annonce ne mentionne pas la Thaïlande comme pays autorisé. Aucune preuve dans le CV que le candidat est autorisé à travailler légalement en Thaïlande pour une entreprise américaine. Le CV ne mentionne pas de statut de travail en Thaïlande, ni de visa ou autorisation locale.
- **Exigence : "Do you now, or will you in the future, require sponsorship for employment work permit or visa status to work legally for our Company?"** → le candidat indique "no sponsorship required", mais cela ne garantit pas qu’il est autorisé à travailler légalement dans le pays où il réside (Thaïlande) pour une entreprise basée aux États-Unis.
- **Exigence : "Can you describe a time you shipped a platform or infrastructure product that was adopted across multiple teams"** → le candidat a mené des projets SaaS multi-équipes (LVMH, Société Générale, Renault, BMW), avec design systems, workflows internes, et adoption croisée. Cela couvre partiellement l’exigence.
- **Exigence : "Full remote only"** → non indiqué dans l’annonce. L’annonce ne précise pas la politique de télétravail. Cependant, l’adresse de l’entreprise est à Fort Worth, TX, États-Unis, et le poste est localisé à Fort Worth.
`;

// The cycle Block B repeated until max_tokens (5 full passes in the report).
const REPORT_692_CYCLE = `- **Exigence : "Must be authorized to work in the country of residence"** → le candidat réside en Thaïlande, mais l’annonce ne mentionne pas la Thaïlande comme pays autorisé. Aucune preuve que le candidat est autorisé à travailler en Thaïlande pour une entreprise américaine.
- **Exigence : "No sponsorship required"** → le candidat indique "no sponsorship required", mais cela ne suffit pas si le pays de résidence n’est pas autorisé.
- **Exigence : "No I-9, E-Verify"** → non indiqué.
- **Exigence : "Must live in the US"** → non dit, mais l’adresse de l’entreprise est aux États-Unis, et le poste est à Fort Worth, TX.
- **Exigence : "Remote-first"** → non indiqué.
- **Exigence : "Remote-only"** → non indiqué.
- **Exigence : "No office days"** → non indiqué.
- **Exigence : "No hybrid"** → non indiqué.
- **Exigence : "No on-site"** → non indiqué.
- **Exigence : "No travel"** → non indiqué.
- **Exigence : "No relocation"** → non indiqué.
- **Exigence : "No sponsorship"** → le candidat indique "no sponsorship required", mais cela ne suffit pas si le pays de résidence n’est pas autorisé.
- **Exigence : "No I-9, E-Verify"** → non indiqué.
`;

const REPORT_692 = REPORT_692_HEAD + REPORT_692_CYCLE.repeat(5);

test('report 692: the looped Qwen output is rejected with a repetition_loop reason', () => {
  assert.equal(extractEvaluationScore(REPORT_692), '1.0/5', 'the loop still parses as a 1.0/5 hard fail');
  const loop = detectRepetitionLoop(REPORT_692);
  assert.equal(loop.looped, true);
  assert.equal(loop.line, '- **Exigence : "No I-9, E-Verify"** → non indiqué.');
  assert.equal(loop.count, 10);
  assert.ok(loop.duplicateRatio > DUPLICATE_LINE_RATIO_MAX, `duplicate ratio ${loop.duplicateRatio}`);

  const validation = validateReportContent(REPORT_692, '1.0/5', 'consensys', 'Senior Product Manager');
  assert.equal(validation.valid, false);
  assert.equal(validation.code, REPETITION_LOOP_CODE);
  assert.equal(validation.loop.count, 10);
  assert.match(validation.reason, /Output looped: the same line repeats 10 times/);
  assert.match(validation.reason, /relaunch the evaluation/);
});

test('report 692 without the loop (one pass of the cycle) still validates', () => {
  const once = REPORT_692_HEAD + REPORT_692_CYCLE;
  assert.equal(detectRepetitionLoop(once).looped, false);
  assert.deepEqual(validateReportContent(once, '1.0/5', 'consensys', 'Senior Product Manager'), { valid: true });
});

test('a line repeated exactly REPEATED_LINE_MAX times is not a loop', () => {
  // Real reports go up to 4 (650-moon-active repeats "✅ **Match confirmé.**").
  const lines = ['# Evaluation: Acme — Designer', '**Score:** 4.0/5', '## A) Role Summary', 'Remote EMEA.', '## B) Match'];
  for (let i = 0; i < REPEATED_LINE_MAX; i++) lines.push(`- Requirement ${i}`, '✅ **Match confirmé.**');
  const text = lines.join('\n');
  assert.equal(detectRepetitionLoop(text).count, REPEATED_LINE_MAX);
  assert.equal(validateReportContent(text, '4.0/5', 'acme', 'Designer').valid, true);

  const once_more = `${text}\n✅ **Match confirmé.**`;
  assert.equal(validateReportContent(once_more, '4.0/5', 'acme', 'Designer').code, REPETITION_LOOP_CODE);
});

test('rules, table separators and short lines do not count as repeats', () => {
  const rows = Array.from({ length: 12 }, (_, i) => `| Criterion ${i} | ok |\n|---|---|\n---\n- ✅`).join('\n');
  const text = `# Evaluation: Acme — Designer\n**Score:** 4.0/5\n## A) Role Summary\nRemote.\n## B) Match\n${rows}`;
  assert.equal(detectRepetitionLoop(text).looped, false);
  assert.equal(validateReportContent(text, '4.0/5', 'acme', 'Designer').valid, true);
});

test('more than 30% duplicate lines is a loop even when no line passes the per-line cap', () => {
  const cycle = ['- Remote policy → not stated.', '- Sponsorship → not stated.', '- Relocation → not stated.'];
  const unique = Array.from({ length: 8 }, (_, i) => `- Unique finding number ${i}`);
  const lines = ['# Evaluation: Acme — Designer', '**Score:** 2.0/5', '## A) Role Summary', '## B) Match', ...unique];
  // 24 lines, 15 distinct: 9 repeats (37%), no line above 4 occurrences.
  for (let i = 0; i < REPEATED_LINE_MAX; i++) lines.push(...cycle);
  const loop = detectRepetitionLoop(lines.join('\n'));
  assert.equal(loop.count, REPEATED_LINE_MAX);
  assert.ok(loop.duplicateRatio > DUPLICATE_LINE_RATIO_MAX);
  assert.equal(loop.looped, true);
});

test('a short report is not judged on its duplicate ratio', () => {
  const text = '# Evaluation: Acme — Designer\n**Score:** 3.0/5\n## A) Role Summary\n- Not stated.\n## B) Match\n- Not stated.\n- Not stated.';
  assert.equal(detectRepetitionLoop(text).looped, false);
});

// ── Greenhouse JD: the posting, not the application form ────────────────────
test('parseGreenhousePostingUrl reads the board from the path or the embed query', () => {
  assert.deepEqual(parseGreenhousePostingUrl('https://job-boards.greenhouse.io/consensys/jobs/7903661'), { board: 'consensys', jobId: '7903661' });
  assert.deepEqual(parseGreenhousePostingUrl('https://job-boards.eu.greenhouse.io/acme/jobs/123?gh_src=x'), { board: 'acme', jobId: '123' });
  assert.deepEqual(parseGreenhousePostingUrl('https://boards.greenhouse.io/stripe/jobs/777'), { board: 'stripe', jobId: '777' });
  assert.deepEqual(parseGreenhousePostingUrl('https://boards.greenhouse.io/embed/job_app?for=stripe&token=555'), { board: 'stripe', jobId: '555' });
  assert.equal(parseGreenhousePostingUrl('https://boards.greenhouse.io/embed/job_app?token=555'), null);
  assert.equal(parseGreenhousePostingUrl('https://stripe.com/jobs?gh_jid=1'), null);
  assert.equal(parseGreenhousePostingUrl('https://jobs.lever.co/acme/abc'), null);
  assert.equal(parseGreenhousePostingUrl('not a url'), null);
});

// Shape of job-boards.greenhouse.io/consensys/jobs/7903661 as the server's
// fetch receives it, trimmed: the form and its privacy notice, no posting.
const GREENHOUSE_FORM_ONLY_PAGE = `<html><head><title>Job Application for Senior Product Manager – Universal KYC (MetaMask Passport) at MetaMask</title></head>
<body><main class="main font-secondary job-post"><div class="job-post-container">
<div><p class="body body--medium">Create a Job Alert</p></div>
<div class="application--container"><div class="application--header"><div class="application--header--title"><h2 class="section-header">Apply for this job</h2></div>
<div class="application--header--required">* indicates a required field</div></div>
<form method="get" action="/consensys/jobs/7903661" id="application-form" class="application--form">
<div class="application--questions"><label id="first_name-label">First Name</label><input id="first_name">
<div class="question-description" id="question_66614056-description"><p>PRIVACY NOTICE - CANDIDATES. ${'This Privacy Notice explains how we process candidate data. '.repeat(20)}</p>
<p><strong>Contact Details</strong> Consensys Software Inc. is located at 5049 Edwards Ranch Road, Fort Worth, TX, USA.</p></div>
<label id="question_67122929-label">Have you directly owned or led the build of a KYC, identity verification, or onboarding product?</label>
<label id="question_66614059-label">Are you legally authorized to work in the country in which you are currently domiciled?</label>
<label id="question_66614060-label">Do you now, or will you in the future, require sponsorship for employment work permit or visa status to work legally for our Company?</label>
</div></form><div class="application--submit"><button>Submit application</button></div></div>
</div></main></body></html>`;

test('stripApplicationFormHtml drops the Greenhouse form: no domicile question, no Fort Worth', () => {
  const before = extractTextFromHtml(GREENHOUSE_FORM_ONLY_PAGE);
  assert.match(before, /currently domiciled/);
  assert.match(before, /Fort Worth/);
  assert.equal(isUnusableJobDescriptionText(before), false, 'before the fix the form passed as a JD');

  const after = extractTextFromHtml(stripApplicationFormHtml(GREENHOUSE_FORM_ONLY_PAGE));
  assert.doesNotMatch(after, /domiciled|sponsorship|Fort Worth|KYC, identity verification/);
  assert.equal(isUnusableJobDescriptionText(after), true, 'a form-only page now falls through to the next source');
});

test('stripApplicationFormHtml keeps the posting around the form and leaves non-ATS forms alone', () => {
  const withPosting = GREENHOUSE_FORM_ONLY_PAGE.replace(
    '<div class="application--container">',
    '<div class="job__description body"><p>Location: EMEA - Remote. Build MetaMask Passport, a reusable KYC credential.</p></div><div class="application--container">',
  );
  const kept = extractTextFromHtml(stripApplicationFormHtml(withPosting));
  assert.match(kept, /EMEA - Remote\. Build MetaMask Passport/);
  assert.doesNotMatch(kept, /domiciled/);

  const legacy = '<div id="content"><p>Remote, Europe.</p></div><form id="application_form" action="/x"><label>Are you legally authorized to work in the country in which you are currently domiciled?</label></form>';
  assert.equal(extractTextFromHtml(stripApplicationFormHtml(legacy)), 'Remote, Europe.');

  // ASP.NET wraps the whole page in one form: it must survive.
  const aspnet = '<form id="aspnetForm" action="/job.aspx"><h1>Product Designer</h1><p>Fully remote within the EU.</p></form>';
  assert.equal(stripApplicationFormHtml(aspnet), aspnet);
});

test('stripApplicationFormText cuts an open-tab capture at the Greenhouse form header', () => {
  const tab = 'Senior Product Manager – Universal KYC\nEMEA - Remote, UNITED STATES - Remote\nAbout the role...\n\nApply for this job\n\n*\n\nindicates a required field\nAre you legally authorized to work in the country in which you are currently domiciled?';
  const cut = stripApplicationFormText(tab);
  assert.equal(cut, 'Senior Product Manager – Universal KYC\nEMEA - Remote, UNITED STATES - Remote\nAbout the role...');
  assert.equal(stripApplicationFormText('No form here.'), 'No form here.');
});

test('the Greenhouse API guess tries the board from the URL path first (URL-only re-add)', async () => {
  const calls = [];
  const { fetchGreenhouseJobDescriptionFromGuessedApi } = serverFunctions(['slugify', 'cleanString', 'fetchGreenhouseJobDescriptionFromGuessedApi'], {
    parseGreenhousePostingUrl,
    fetchJsonWithSourceCache: async url => {
      calls.push(url);
      return url.includes('/boards/consensys/')
        ? { id: 7903661, title: 'Senior Product Manager – Universal KYC (MetaMask Passport)', company_name: 'Consensys', location: { name: 'EMEA - Remote, UNITED STATES - Remote' }, content: '&lt;p&gt;Posting&lt;/p&gt;' }
        : { status: 404, error: 'Job not found' };
    },
    formatSourceJobDescription: (source, job) => `${source} | ${job.companyName} | ${job.location}`,
  });
  const result = await fetchGreenhouseJobDescriptionFromGuessedApi('https://job-boards.greenhouse.io/consensys/jobs/7903661', { hints: {} });
  assert.equal(calls[0], 'https://boards-api.greenhouse.io/v1/boards/consensys/jobs/7903661');
  assert.equal(calls.length, 1);
  assert.equal(result.mode, 'greenhouse-api');
  assert.equal(result.text, 'Greenhouse API | Consensys | EMEA - Remote, UNITED STATES - Remote');
});

test('every HTML fallback and the open-tab capture strip the application form', () => {
  assert.match(sourceOf('textFromFetchedHtml'), /extractTextFromHtml\(stripApplicationFormHtml\(html\)\)/);
  const fetchJd = sourceOf('fetchJobDescriptionText');
  assert.match(fetchJd, /stripApplicationFormText\(snapshot\?\.text/);
  assert.match(fetchJd, /!isUnusableJobDescriptionText\(snapshotText\)/);
});

// ── Enforcement block of the Qwen evaluation prompt ─────────────────────────
function renderEnforcement(authorizedIn) {
  const rules = {
    location: { remotePolicy: 'Full remote required', fullRemoteOnly: true, noRelocation: true, occasionalOnsiteOk: false, onsitePlaces: [], authorizedIn, needsSponsorship: true },
    compensation: { employmentType: '', minimum: '', targetRange: '' },
    candidate: { visaStatus: 'No sponsorship needed -- French / EU citizen', location: '', city: 'Paris', country: 'France', timezone: '' },
    targeting: { archetypes: [], superpowers: [], primaryRoles: [], headline: '' },
    search: { onsiteAvailability: '', contractTypes: [], sectorPreferences: [], geographyPreferences: [], mustHaves: [], niceToHaves: [], dealBreakers: [] },
  };
  const { buildProfileCriteriaBlock } = serverFunctions(['buildProfileCriteriaBlock'], {
    inferProfileMatchingRules: () => rules,
    homeLocationLabel: () => 'Paris, France',
    candidateAuthorizedInUs: () => false,
  });
  const block = buildProfileCriteriaBlock({}, '');
  return block.slice(block.indexOf('### Enforcement'));
}

test('the enforcement block says form questions are not residency requirements', () => {
  const enforcement = renderEnforcement(['France', 'European Union', 'European Economic Area', 'Thailand']);
  assert.match(enforcement, /Application-form questions are not job requirements/);
  assert.match(enforcement, /"Are you legally authorized to work in the country in which you are currently domiciled\?"/);
  assert.match(enforcement, /require sponsorship\?"/);
  assert.match(enforcement, /never a residency lock, a job location, a requirement to score in Block B, or a hard-fail reason/);
  assert.match(enforcement, /is met when authorized_in \(France, European Union, European Economic Area, Thailand\) covers the country the candidate lives in/);
  assert.match(enforcement, /Never invent an office city: a company legal address, HQ or privacy-notice address is not the job location/);
  assert.match(enforcement, /The candidate lives where Candidate Context says\. Never infer residence, a home country or a nomad status from the CV\./);
});

test('without authorized_in the domicile question is unknown, never a hard fail', () => {
  const enforcement = renderEnforcement([]);
  assert.match(enforcement, /with authorized_in not specified, mark it unknown, never a hard fail/);
  assert.doesNotMatch(enforcement, /authorized_in \(\)/);
});

// ── Server: a looped evaluation writes nothing and asks for a relaunch ──────
test('a repetition_loop validation failure writes no report or tracker row and warns to relaunch', () => {
  const start = server.indexOf('const validation = validateReportContent(reportContent, scoreRaw, company, role);');
  assert.ok(start >= 0, 'pipeline post-processing validates the report');
  const invalidStart = server.indexOf('console.error(`❌ Report validation failed for ${filename}', start);
  assert.ok(invalidStart > start);
  const validBranch = server.slice(start, invalidStart);
  assert.match(validBranch, /if \(validation\.valid\) \{/);
  assert.match(validBranch, /batch\/tracker-additions/, 'the tracker row is written in the valid branch only');

  const invalidBranch = server.slice(invalidStart, server.indexOf('// PDF → automatic generation', invalidStart));
  assert.doesNotMatch(invalidBranch, /writeFile\(|tracker-additions|removeFromPipeline/);
  assert.match(invalidBranch, /validation\.code === REPETITION_LOOP_CODE/);
  assert.match(invalidBranch, /send\('warning', \{ text: `Evaluation discarded: the model output looped/);
  assert.match(invalidBranch, /No report and no tracker row were written\.\$\{kept\} Relaunch the evaluation\./);
  assert.match(server, /import \{ REPETITION_LOOP_CODE, resolveEvaluationScore, validateReportContent \} from '\.\.\/lib\/report-validation\.mjs';/);
});

// ── Work mode: the deterministic hard pass before Qwen ──────────────────────
const workModeGate = serverFunctions([
  'cleanString', 'cleanList', 'normalizeInline', 'inferProfileMatchingRules', 'onsitePlacesFromProfile', 'mentionsPlace',
  'inferWorkModeFromText', 'candidateAuthorizedInUs', 'inferUsConstraintFromText', 'onsiteAllowedFor', 'evaluateOfferAgainstProfile',
]);
const workMode = text => workModeGate.inferWorkModeFromText(text).mode;
// The location policy of config/profile.yml.
const FULL_REMOTE_PROFILE = { location: { remote_policy: 'Full remote required', authorized_in: ['France', 'European Union', 'European Economic Area', 'Thailand'] } };

// Extract of the Safran.AI posting behind report 708 (WTTJ, Paris).
const SAFRAN_708 = 'AI Product Manager (H/F) — Safran.AI, Paris. Le poste est basé à Paris, avec télétravail jusqu’à 3 jours/semaine. La personne retenue fera l’objet d’une procédure d’habilitation.';
// Extract of the what3words posting behind report 709 (Himalayas API).
const WHAT3WORDS_709 = 'Based in Vietnam out of our centrally located Ho Chi Minh City office, we’re looking for a talented Product Designer. Benefits: Competitive salary, Flexible working, 6 week remote working (work from anywhere) policy, 25 days holiday.';

test('report 708: a French hybrid posting is a hard pass for a full-remote profile', () => {
  assert.equal(workMode(SAFRAN_708), 'hybrid');
  const gate = workModeGate.evaluateOfferAgainstProfile(SAFRAN_708, FULL_REMOTE_PROFILE, '');
  assert.equal(gate.hardReject, true);
  assert.match(gate.reasons[0], /the JD looks hybrid/);
});

test('French hybrid and on-site wording, but not "hybride" outside a work rhythm', () => {
  assert.equal(workMode("Jusqu'à 2 jours de télétravail par semaine."), 'hybrid');
  assert.equal(workMode('Organisation : 3 jours/semaine sur site à Lyon.'), 'hybrid');
  assert.equal(workMode('Mode hybride, bureaux à Nantes.'), 'hybrid');
  assert.equal(workMode('Télétravail partiel possible.'), 'hybrid');
  assert.equal(workMode('Télétravail : jusqu’à 2 jours par semaine.'), 'hybrid');
  assert.equal(workMode('Poste en présentiel à Toulouse.'), 'onsite');
  assert.equal(workMode('Full remote. Nous construisons une IA hybride pour le cloud.'), 'remote');
});

test('report 709: an office job with a weeks-per-year remote perk is on-site', () => {
  assert.equal(workMode(WHAT3WORDS_709), 'onsite');
  assert.equal(workMode('Benefits: work from anywhere for up to 4 weeks a year.'), 'onsite');
  assert.equal(workModeGate.evaluateOfferAgainstProfile(WHAT3WORDS_709, FULL_REMOTE_PROFILE, '').hardReject, true);
  // On a fully remote posting the same perk is travel time, not an office.
  assert.equal(workMode('Fully remote within Europe, plus 4 weeks a year of work from anywhere.'), 'remote');
});

test('without a full-remote policy the gate never hard-passes on work mode', () => {
  // The live Supabase profile had no remote_policy and an empty profile_context.
  assert.equal(workModeGate.evaluateOfferAgainstProfile(SAFRAN_708, { location: { country: 'France' } }, '').hardReject, false);
});

// ── Work mode: places the on-site availability opens ────────────────────────
// Once the owner's Supabase row was synced from config/profile.yml
// (2026-10-13), fullRemoteOnly turned true and the gate hard-passed on-site
// jobs in Thailand too, although the profile accepts them.
const OWNER_PROFILE = {
  location: {
    country: 'France', city: 'Paris', default_city: 'Paris', default_country: 'France',
    asia_city: 'Bangkok', asia_country: 'Thailand',
    authorized_in: ['France', 'European Union', 'European Economic Area', 'Thailand'],
    needs_sponsorship: true,
    remote_policy: 'Full remote required',
    onsite_availability: 'Open to on-site if based in Thailand; comfortable traveling for multi-day team-building/offsite events anywhere',
  },
};
const ownerGate = jd => workModeGate.evaluateOfferAgainstProfile(jd, OWNER_PROFILE, '');

test('on-site availability opens the places it names and the profile base they belong to', () => {
  const rules = workModeGate.inferProfileMatchingRules(OWNER_PROFILE, '');
  assert.equal(rules.location.fullRemoteOnly, true);
  assert.deepEqual([...rules.location.onsitePlaces], ['Thailand', 'Bangkok']);

  const places = (onsite, location = OWNER_PROFILE.location) => [...workModeGate.onsitePlacesFromProfile(location, onsite)];
  assert.deepEqual(places('On-site OK in Lisbon or Porto, hybrid at Berlin'), ['Lisbon', 'Porto', 'Berlin']);
  assert.deepEqual(places('Sur site possible à Lyon ou en Suisse'), ['Lyon', 'Suisse']);
  // A lower-case country still brings the profile base it names.
  assert.deepEqual(places('on-site ok if based in thailand'), ['Bangkok', 'Thailand']);
  // Negated clauses and travel open nothing; the home base is not implied.
  assert.deepEqual(places('No on-site in France; traveling to Paris for offsites is fine'), []);
  assert.deepEqual(places('Comfortable traveling for offsites in Paris'), []);
  assert.deepEqual(places(''), []);
});

test('onsiteAllowedFor: hybrid/on-site only where the on-site availability opens a place', () => {
  const owner = workModeGate.inferProfileMatchingRules(OWNER_PROFILE, '');
  const allowed = (rules, input) => workModeGate.onsiteAllowedFor(rules, input);
  assert.equal(allowed(owner, { mode: 'onsite', place: 'Bangkok' }), true);
  assert.equal(allowed(owner, { mode: 'hybrid', place: 'Phuket, Thailand' }), true);
  assert.equal(allowed(owner, { mode: 'hybrid', place: 'Paris, France' }), false);
  assert.equal(allowed(owner, { mode: 'onsite', place: 'New York, NY' }), false);
  // The work-mode evidence counts when the place field is a region label.
  assert.equal(allowed(owner, { mode: 'onsite', place: 'APAC', evidence: ['on-site role in our Bangkok office, 5 days a week'] }), true);
  assert.equal(allowed(owner, { mode: 'hybrid' }), false);
  // Remote or unknown attendance, or a profile that is not full remote, is never refused.
  assert.equal(allowed(owner, { mode: 'remote', place: 'Paris' }), true);
  assert.equal(allowed(owner, { mode: 'unknown' }), true);
  const notFullRemote = workModeGate.inferProfileMatchingRules({ location: { country: 'France' } }, '');
  assert.equal(allowed(notFullRemote, { mode: 'onsite', place: 'Paris' }), true);
});

test('full remote + on-site in Thailand: Paris hybrid is a hard pass', () => {
  const gate = ownerGate(SAFRAN_708);
  assert.equal(gate.workMode.mode, 'hybrid');
  assert.equal(gate.hardReject, true);
  assert.equal(gate.reasons[0], 'Profile requires full remote (on-site only in Thailand, Bangkok), but the JD looks hybrid.');
});

test('full remote + on-site in Thailand: a Bangkok on-site job goes to Qwen', () => {
  const jd = 'Senior Product Designer — Agoda. Location / remote: Bangkok. This is an on-site role in our Bangkok office, 5 days a week.';
  const gate = ownerGate(jd);
  assert.equal(gate.workMode.mode, 'onsite');
  assert.equal(gate.hardReject, false);
  assert.equal(gate.reasons.length, 0);
});

test('full remote + on-site in Thailand: a Phuket, Thailand hybrid job goes to Qwen', () => {
  const jd = 'Lead Product Designer. Location: Phuket, Thailand. Hybrid: 3 days a week in the office.';
  const gate = ownerGate(jd);
  assert.equal(gate.workMode.mode, 'hybrid');
  assert.equal(gate.hardReject, false);
});

test('full remote + on-site in Thailand: US and Vietnam on-site jobs are a hard pass', () => {
  const us = ownerGate('Senior Product Designer, New York, NY. This role is on-site 5 days a week at our New York office.');
  assert.equal(us.workMode.mode, 'onsite');
  assert.equal(us.hardReject, true);
  assert.equal(ownerGate(WHAT3WORDS_709).hardReject, true);
});

test('full remote + on-site in Thailand: a bare remote job is not rejected', () => {
  const gate = ownerGate('Senior Product Designer. Remote. Join a distributed design team.');
  assert.equal(gate.workMode.mode, 'remote');
  assert.equal(gate.hardReject, false);
});

test('an Asia base without on-site availability opens no place', () => {
  const { onsite_availability, ...location } = OWNER_PROFILE.location;
  const gate = workModeGate.evaluateOfferAgainstProfile('This role is fully on-site in our Bangkok office.', { location }, '');
  assert.equal(gate.hardReject, true);
  assert.equal(gate.reasons[0], 'Profile requires full remote, but the JD looks onsite.');
});

test('the enforcement block names the same on-site places as the gate', () => {
  const { buildProfileCriteriaBlock } = serverFunctions([
    'cleanString', 'cleanList', 'normalizeInline', 'inferProfileMatchingRules', 'onsitePlacesFromProfile', 'mentionsPlace',
    'candidateAuthorizedInUs', 'buildProfileCriteriaBlock',
  ], { homeLocationLabel: () => 'Paris, France' });
  const block = buildProfileCriteriaBlock(OWNER_PROFILE, '');
  const enforcement = block.slice(block.indexOf('### Enforcement'));
  const onsite = OWNER_PROFILE.location.onsite_availability;
  assert.ok(enforcement.includes(`full remote only (hybrid/on-site attendance outside Thailand, Bangkok (on-site availability: "${onsite}") is a hard fail)`));
  assert.ok(enforcement.includes('the JD explicitly says hybrid or on-site (outside Thailand, Bangkok), hard pass directly.'));
  assert.ok(enforcement.includes('- Hybrid or on-site work based in Thailand, Bangkok is within the candidate\'s on-site availability: not a hard fail and no work-mode penalty.'));

  // Without on-site availability the rule stays the home base, with no extra line.
  const { onsite_availability, ...location } = OWNER_PROFILE.location;
  const homeOnly = buildProfileCriteriaBlock({ location }, '');
  assert.ok(homeOnly.includes('full remote only (hybrid/on-site attendance outside Paris, France is a hard fail)'));
  assert.doesNotMatch(homeOnly, /within the candidate's on-site availability/);
});
