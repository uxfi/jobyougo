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
import {
  authorizedFor,
  locationSummaryLines,
  onsiteExceptionsLabel,
  onsitePlacesFromText,
  resolveLocationProfile,
  workModeAllowed,
} from '../lib/candidate-location.mjs';
import { placesIn, regionCountriesIn } from '../lib/apply-places.mjs';
import { attendancePlaceText, inferWorkModeFromText, resolveWorkMode, structuredWorkMode } from '../lib/work-mode.mjs';
import { assessFreshness } from '../lib/scan-decision.mjs';

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
    structuredWorkMode,
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
    location: { remotePolicy: 'Full remote required', fullRemoteOnly: true, noRelocation: true, occasionalOnsiteOk: false, onsitePlaces: [], authorizedIn, needsSponsorship: true, usAuthorized: false },
    compensation: { employmentType: '', minimum: '', targetRange: '' },
    candidate: { visaStatus: 'No sponsorship needed -- French / EU citizen', location: '', city: 'Paris', country: 'France', timezone: '' },
    targeting: { archetypes: [], superpowers: [], primaryRoles: [], headline: '' },
    search: { onsiteAvailability: '', contractTypes: [], sectorPreferences: [], geographyPreferences: [], mustHaves: [], niceToHaves: [], dealBreakers: [] },
  };
  const { buildProfileCriteriaBlock } = serverFunctions(['buildProfileCriteriaBlock'], {
    inferProfileMatchingRules: () => rules,
    homeLocationLabel: () => 'Paris, France',
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
  const start = server.indexOf('const validation = ownEmployer');
  assert.ok(start >= 0, 'pipeline post-processing validates the report');
  assert.ok(server.indexOf(': validateReportContent(reportContent, scoreRaw, company, role);', start) > start);
  const invalidStart = server.indexOf('console.error(`❌ Report validation failed for ${filename}', start);
  assert.ok(invalidStart > start);
  const validBranch = server.slice(start, invalidStart);
  assert.match(validBranch, /if \(validation\.valid\) \{/);
  assert.match(validBranch, /batch\/tracker-additions/, 'the tracker row is written in the valid branch only');

  const invalidBranch = server.slice(invalidStart, server.indexOf('// PDF → automatic generation', invalidStart));
  assert.doesNotMatch(invalidBranch, /writeFile\(|tracker-additions/);
  // The URL stays queued, except the needs_review park after the retry
  // (lib/eval-attempts.mjs, Eyzee 2026-10-19).
  const removes = invalidBranch.match(/removeFromPipeline\([^\n]*/g) || [];
  assert.deepEqual(removes, ["removeFromPipeline(pipelineTarget.url, req.userId, { historyStatus: 'needs_review', historyPortal: 'pipeline-review' });"]);
  assert.match(invalidBranch, /if \(validationFailureAction\(sameReason\) === 'park'\) \{\s*await removeFromPipeline/);
  assert.match(invalidBranch, /validation\.code === REPETITION_LOOP_CODE/);
  assert.match(invalidBranch, /send\('warning', \{ text: `Evaluation discarded: the model output looped/);
  assert.match(invalidBranch, /No report and no tracker row were written\.\$\{kept\} Relaunch the evaluation\./);
  assert.match(server, /import \{ OWN_EMPLOYER_CODE, REPETITION_LOOP_CODE, extractEvaluationScore, ownEmployerConfusion, resolveEvaluationScore, validateReportContent \} from '\.\.\/lib\/report-validation\.mjs';/);
});

// ── Work mode: the deterministic hard pass before Qwen ──────────────────────
// The location helpers the server imports from lib/ (candidate-location, apply-places).
// The work-mode decision lives in lib/work-mode.mjs and is imported, not read
// from the server source.
const LOCATION_LIB = {
  resolveLocationProfile, workModeAllowed, authorizedFor, locationSummaryLines, onsiteExceptionsLabel, placesIn, regionCountriesIn,
  attendancePlaceText, resolveWorkMode,
};
const workModeGate = {
  ...serverFunctions([
    'cleanString', 'cleanList', 'normalizeInline', 'inferProfileMatchingRules',
    'inferUsConstraintFromText', 'onsiteAllowedFor', 'inferResidencyLockFromText', 'evaluateOfferAgainstProfile',
  ], LOCATION_LIB),
  attendancePlaceText,
};
const workMode = text => inferWorkModeFromText(text).mode;
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

test('2026-10-16 gate rejects: "hybrid" that is not the job\'s own mode', () => {
  // n8n, a remote Europe role, read hybrid from its company-wide perks text.
  assert.equal(workMode('Berlin Office Remote. A remote-first company. Some roles, like sales in the US, are hybrid—please check.'), 'remote');
  assert.equal(workMode('Experience with end-to-end (hybrid UX and UI) product design.'), 'unknown');
  assert.equal(workMode('Remote, Tallinn. Experience in a hybrid PM/design role.'), 'remote');
  assert.equal(workMode('This is a hybrid role based in London.'), 'hybrid');
  assert.equal(workMode('Portugal - Remote. Flexibility, with remote and hybrid work options (country-dependent).'), 'remote');
  // 4dayweek.io: a compressed week, not office days.
  assert.equal(workMode('4dayweek.io: Senior Product Designer, 4 day week. Remote · UK'), 'remote');
  // Still hybrid.
  assert.equal(workMode('Enjoy our Hybrid working model, combining onsite collaboration and remote work.'), 'hybrid');
  assert.equal(workMode('Working Model: Remote / hybrid. Regular time on-site in Bremen.'), 'hybrid');
  assert.equal(workMode('Staff UX Researcher. Barcelona, Spain. Hybrid.'), 'hybrid');
  assert.equal(workMode('In the office 3 days a week.'), 'hybrid');
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

  const places = (onsite, location = OWNER_PROFILE.location) => [...onsitePlacesFromText(onsite, resolveLocationProfile({ location }).bases)];
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
    'cleanString', 'cleanList', 'normalizeInline', 'inferProfileMatchingRules',
    'buildProfileCriteriaBlock',
  ], { ...LOCATION_LIB, homeLocationLabel: () => 'Paris, France' });
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

test('residency clauses: every alternative counts, working-hours asks are not residency', () => {
  for (const jd of [
    'Senior Product Designer. Remote. You must be based in the UK or the EU.',
    'Remote role. Must be based in the US or Europe.',
    'Remote. Applicants must be located within US or European time zones.',
    'Remote. You should be located in a time zone compatible with US Eastern hours.',
    'Remote within EMEA. Candidates must be based in the EU.',
  ]) assert.equal(ownerGate(jd).hardReject, false, jd);
  const usOnly = ownerGate('Remote. Candidates must be based in Canada.');
  assert.equal(usOnly.hardReject, true);
  assert.match(usOnly.reasons[0], /restricts residence to Canada/);
});

test('US-only location variants and structured ATS locations follow the same eligibility gate', () => {
  const reject = workModeGate.evaluateOfferAgainstProfile;
  for (const phrase of ['Remote US', 'US Remote', 'US-only remote', 'Remote - US']) {
    const gate = reject(`Senior Product Designer. ${phrase}.`, OWNER_PROFILE, '');
    assert.equal(gate.hardReject, true, phrase);
    assert.match(gate.reasons.join(' '), /US residency or US work authorization/);
  }
  const fromEu = reject('Senior Product Designer. Fully remote within Europe.', OWNER_PROFILE, '');
  assert.equal(fromEu.hardReject, false, 'a European remote location is compatible with the Paris/EU base');
  const usCompanyEuEligible = reject('Senior Product Designer. US company, remote in the US or Europe.', OWNER_PROFILE, '');
  assert.equal(usCompanyEuEligible.hardReject, false, 'a US employer that explicitly hires remotely from Europe remains eligible');
  const globalRemote = reject('Senior Product Designer. Remote worldwide.', OWNER_PROFILE, '');
  assert.equal(globalRemote.hardReject, false, 'global remote is not made US-only by the employer headquarters');
  const fromThailand = reject('Senior Product Designer. Remote in Thailand.', OWNER_PROFILE, '');
  assert.equal(fromThailand.hardReject, false, 'a Thailand remote location is compatible with the Bangkok base');

  const atsUs = reject('Senior Product Designer. The role is fully remote.', OWNER_PROFILE, '', {
    atsWorkMode: { mode: 'remote', source: 'workable', locations: ['Remote - US'], evidence: ['workplace: remote'] },
  });
  assert.equal(atsUs.hardReject, true, 'structured ATS country restriction is checked even when absent from JD text');
});

test('pipeline age gate uses the posting date before the recent scan timestamp', async () => {
  const removed = [];
  const { dropStalePipelineItems } = serverFunctions(['dropStalePipelineItems'], {
    DEFAULT_SCAN_MAX_AGE_DAYS: 7,
    assessFreshness,
    readPortalsYaml: async () => ({ parsed: { scan_max_age_days: 7 } }),
    resolvePipelineItemPublishedAt: item => item.published_at,
    removeManyFromPipeline: async urls => removed.push(...urls),
    console: { log() {}, warn() {} },
  });
  const today = new Date().toISOString().slice(0, 10);
  const result = await dropStalePipelineItems([{
    url: 'https://jobs.example.test/old',
    published_at: '2026-09-01',
    scanned_at: today,
  }], 'user-1');
  assert.equal(result.stale.length, 1, 'a fresh scan must not make an old posting fresh');
  assert.deepEqual(removed, ['https://jobs.example.test/old']);
});

test('a US base counts as US work authorization in the gate', () => {
  const us = { location: { city: 'Austin', country: 'United States', remote_policy: 'Full remote required' } };
  const gate = workModeGate.evaluateOfferAgainstProfile('Remote. Must be based in the US. E-Verify employer.', us, '');
  assert.equal(gate.hardReject, false);
});

// ── Review fixes: residency clauses, work mode, unknown US status ───────────
const { buildProfileCriteriaBlock: criteriaBlock } = serverFunctions([
  'cleanString', 'cleanList', 'normalizeInline', 'inferProfileMatchingRules', 'buildProfileCriteriaBlock',
], { ...LOCATION_LIB, homeLocationLabel: () => 'not specified' });
const enforcementOf = profile => {
  const block = criteriaBlock(profile, '');
  return block.slice(block.indexOf('### Enforcement'));
};

test('residency needs a modal: pay and hiring-entity sentences are not a lock', () => {
  for (const jd of [
    'Remote. For candidates based in the US, the salary range is $150k-$180k.',
    'Remote within Europe. Candidates located in the UK are hired via our UK entity.',
    'Remote. Candidates who must be based in Canada are hired through our Canadian payroll.',
  ]) {
    assert.deepEqual([...workModeGate.inferResidencyLockFromText(jd).countries], [], jd);
    assert.equal(ownerGate(jd).hardReject, false, jd);
  }
  assert.deepEqual([...workModeGate.inferResidencyLockFromText('Remote. Candidates need to be located in Canada.').countries], ['Canada']);
});

test('"must be based in" a city or "in our X office" is on-site; a country or region stays residency', () => {
  assert.equal(workMode('Senior Product Designer. Must be based in our Paris office.'), 'onsite');
  assert.equal(workMode('Senior Product Designer. You must be based in Paris, France.'), 'onsite');
  assert.equal(workMode('This role is based in our Bangkok office.'), 'onsite');
  assert.equal(workMode('Remote. You must be based in France.'), 'remote');
  assert.equal(workMode('Remote. Must be based in the EU or the UK.'), 'remote');
  assert.equal(workMode('Remote. Must be based in Singapore.'), 'remote', 'a city-state reads as the country');
  assert.equal(ownerGate('Senior Product Designer. Must be based in Paris.').hardReject, true);
  assert.equal(ownerGate('Senior Product Designer. Must be based in Bangkok.').hardReject, false);
});

test('on-site places come from the location line and the attendance sentences, never a negated one', () => {
  assert.equal(ownerGate('Hybrid, 3 days a week in our Paris office. Our design teams sit in Bangkok and Singapore.').hardReject, true);
  assert.equal(ownerGate('On-site in Bangkok is not possible. This role is on-site in our Paris office, 5 days a week.').hardReject, true);
  // Still opened: the attendance sentence or the location line names Bangkok.
  assert.equal(ownerGate('Lead Designer. Hybrid, 3 days a week. This role is based in our Bangkok office.').hardReject, false);
  assert.equal(ownerGate('Lead Designer\nLocation: Bangkok, Thailand\nHybrid, 3 days a week in the office.').hardReject, false);
  assert.equal(workModeGate.attendancePlaceText('Remote-friendly team.\nLocation: Bangkok\nOur sales team is in Paris.'), 'Location: Bangkok');
});

test('no base and no authorized country: US status is unknown, never a hard fail', () => {
  const empty = { location: { remote_policy: 'Full remote required' } };
  assert.equal(workModeGate.inferProfileMatchingRules(empty, '').location.usAuthorized, null);
  assert.equal(workModeGate.evaluateOfferAgainstProfile('Remote - US. Must live in the United States. E-Verify employer.', empty, '').hardReject, false);
  const enforcement = enforcementOf(empty);
  assert.match(enforcement, /US work authorization \(I-9, E-Verify, authorized to work in the US\) is unknown/);
  assert.match(enforcement, /the candidate's US status is unknown \(no base or authorized country in the profile\)\. Mark it unknown, never a hard fail\./);
  assert.doesNotMatch(enforcement, /→ Score 1\.0\/5 and SKIP/);
});

test('the US lines of the enforcement block follow usAuthorized: a US base, the owner', () => {
  const us = enforcementOf({ location: { city: 'Austin', country: 'United States', remote_policy: 'Full remote required' } });
  assert.match(us, /US work authorization \(I-9, E-Verify, authorized to work in the US\) is met: the candidate is authorized in the United States\./);
  assert.doesNotMatch(us, /unless authorized_in includes the United States/);
  assert.match(us, /US-only remote or US residency requirements are acceptable/);
  const owner = enforcementOf(OWNER_PROFILE);
  assert.match(owner, /no US work authorization \(I-9, E-Verify, authorized to work in the US\): the candidate is not authorized in the United States\./);
  assert.match(owner, /US-only remote, must live\/reside in the US, or US work-auth → Score 1\.0\/5 and SKIP/);
});

test('a stated remote policy wins over "full remote … only" in the profile notes', () => {
  const notes = '## Notes\nFull remote is what I prefer; only open to senior roles.';
  assert.equal(workModeGate.inferProfileMatchingRules({ location: { remote_policy: 'Hybrid OK, 2 days a week' } }, notes).location.fullRemoteOnly, false);
  assert.equal(workModeGate.inferProfileMatchingRules({ location: {} }, notes).location.fullRemoteOnly, true);
});

test('a city alone states no work authorization: no residency hard pass until the profile says so', () => {
  const berlin = { location: { city: 'Berlin', country: 'Germany', remote_policy: 'Full remote required' } };
  for (const jd of ['Remote. You must be based in the UK.', 'Remote. Candidates must be located in APAC.']) {
    assert.equal(workModeGate.evaluateOfferAgainstProfile(jd, berlin, '').hardReject, false, jd);
  }
  const sponsored = workModeGate.evaluateOfferAgainstProfile('Remote. You must be based in the UK.', { location: { ...berlin.location, needs_sponsorship: true } }, '');
  assert.equal(sponsored.hardReject, true);
  assert.match(sponsored.reasons[0], /restricts residence to United Kingdom; the candidate can work only in Germany/);
  const withStatus = { location: { bases: [{ city: 'Berlin', country: 'Germany', status: 'citizen' }], remote_policy: 'Full remote required' } };
  assert.equal(workModeGate.evaluateOfferAgainstProfile('Remote. You must be based in the UK.', withStatus, '').hardReject, true);
});

test('the evaluation context carries the profile AI level and skills', () => {
  const rules = {
    location: { remotePolicy: '', fullRemoteOnly: false, noRelocation: false, occasionalOnsiteOk: false, onsitePlaces: [], authorizedIn: [], needsSponsorship: false, usAuthorized: null },
    compensation: { employmentType: '', minimum: '', targetRange: '' },
    candidate: { visaStatus: '', location: '', city: '', country: '', timezone: '' },
    targeting: { archetypes: [], superpowers: [], primaryRoles: [], headline: '' },
    search: { onsiteAvailability: '', contractTypes: [], sectorPreferences: [], geographyPreferences: [], mustHaves: [], niceToHaves: [], dealBreakers: [] },
  };
  const { buildProfileCriteriaBlock } = serverFunctions(['buildProfileCriteriaBlock'], {
    inferProfileMatchingRules: () => rules,
    homeLocationLabel: () => '',
  });
  const block = buildProfileCriteriaBlock({ candidate: { ai_proficiency: 'Expert (ships AI products)', skills: [{ name: 'Figma', years: 8 }, 'LLM prompting'] } }, '');
  assert.match(block, /- AI proficiency \(from the profile\): Expert \(ships AI products\)/);
  assert.match(block, /- Skills \(from the profile\): Figma, LLM prompting/);
  assert.doesNotMatch(buildProfileCriteriaBlock({}, ''), /AI proficiency|Skills \(from/);
});

// ── Work mode implied by the location field (reports 734-736, 2026-10-15) ───
// Okta Barcelona, HelloFresh Berlin and Deliveroo London never mention a work
// mode: the Greenhouse location field is the only clue. The gate read
// "unknown", Jev passed them, and Qwen spent a full evaluation to reject them.
// Extracts shaped like normalizeGreenhouseJob output (browser-extract.mjs).
const OKTA_734 = '## Job Description from https://www.okta.com/company/careers/opportunity/8242153?gh_jid=8242153\n\nLocation: Barcelona, Spain\n\nProduct Design Manager. Our global community, spanning over 20 offices worldwide, is united by a drive to innovate. Your journey begins with an immersive, in-person onboarding experience.';
const HELLOFRESH_735 = 'Location: Berlin, Berlin, Germany\n\nDirector UX Design. You will lead the design organisation across our customer-facing products.';
const DELIVEROO_736 = 'Location: London, England\nReq ID: 8202562\n\nStaff Product Designer. Help us shape the future of food delivery.';

test('reports 734-736: a city in the location field and no remote wording is an office job', () => {
  for (const [jd, place] of [[OKTA_734, 'Barcelona, Spain'], [HELLOFRESH_735, 'Berlin, Berlin, Germany'], [DELIVEROO_736, 'London, England']]) {
    assert.equal(workMode(jd), 'unknown', 'the JD text states no work mode');
    const gate = ownerGate(jd);
    assert.equal(gate.workMode.mode, 'onsite');
    assert.equal(gate.workMode.implied, true);
    assert.equal(gate.hardReject, true, place);
    assert.equal(gate.reasons[0], `Profile requires full remote (on-site only in Thailand, Bangkok), but the JD names only an office location (${place}) and never mentions remote work.`);
  }
  assert.equal(workModeGate.evaluateOfferAgainstProfile(DELIVEROO_736, FULL_REMOTE_PROFILE, '').hardReject, true);
});

test('implied office: remote wording, a country, a region or an allowed city still go to Qwen', () => {
  for (const jd of [
    'Location: London, England\n\nThis role can be performed remote within the UK.',
    'Location: Remote - London\n\nStaff Product Designer.',
    'Location: Paris, France\n\nPoste en 100 % télétravail.',
    'Location: Lyon\n\nTélétravail complet possible.',
    'Location: Spain\n\nProduct Designer.',
    'Location: EMEA\n\nProduct Designer.',
    'Location: Singapore\n\nProduct Designer.',
    'Location: Bangkok, Thailand\n\nSenior Product Designer.',
    'Senior Product Designer. Our teams in London and Berlin build the product.',
  ]) assert.equal(ownerGate(jd).hardReject, false, jd);
  // Not a full-remote profile: the implied office never rejects.
  assert.equal(workModeGate.evaluateOfferAgainstProfile(DELIVEROO_736, { location: { country: 'France' } }, '').hardReject, false);
});

test('French full-remote wording reads as remote', () => {
  assert.equal(workMode('Poste en 100 % télétravail.'), 'remote');
  assert.equal(workMode('Télétravail complet.'), 'remote');
  assert.equal(workMode('Full télétravail depuis la France.'), 'remote');
  assert.equal(workMode('Télétravail jusqu’à 2 jours par semaine.'), 'hybrid', 'partial télétravail stays hybrid');
});

// ── Structured ATS work mode (lib/work-mode.mjs) ────────────────────────────
// n8n "Internal AI Enablement Lead" (2026-10-16): Ashby says Remote, the text
// mentions hybrid roles elsewhere at the company. The field wins.
const N8N_JD = 'Location / remote: Berlin Office · Germany · Remote\nWorkplace: Remote\n\nInternal AI Enablement Lead. Some roles, like sales in the US, are hybrid, with 2 days a week in the office.';
const atsGate = (jd, source, job) => workModeGate.evaluateOfferAgainstProfile(jd, OWNER_PROFILE, '', { atsWorkMode: structuredWorkMode(source, job) });

test('gate: an ATS Remote field passes even when the text reads hybrid', () => {
  const gate = atsGate(N8N_JD, 'ashby', { workplaceType: 'Remote', isRemote: true, location: 'Berlin Office', secondaryLocations: [{ location: 'Germany' }] });
  assert.equal(gate.hardReject, false);
  assert.equal(gate.workMode.mode, 'remote');
  assert.equal(gate.workMode.source, 'ashby');
  assert.equal(ownerGate('Internal AI Enablement Lead. Hybrid, 2 days a week in our Berlin office.').hardReject, true, 'the same text without the field is rejected');
});

test('gate: an ATS hybrid or on-site field rejects outside the on-site places and names the field', () => {
  const gate = atsGate('Senior Product Designer. Join a remote-friendly culture.', 'lever', { workplaceType: 'hybrid', categories: { location: 'Mexico City' } });
  assert.equal(gate.hardReject, true);
  assert.equal(gate.reasons[0], 'Profile requires full remote (on-site only in Thailand, Bangkok), but the JD is hybrid per the ATS field (lever workplaceType: hybrid; Location: Mexico City).');
  // The ATS location list opens an allowed on-site place.
  assert.equal(atsGate('Senior Product Designer.', 'workable', { workplace: 'on_site', location: { city: 'Bangkok', country: 'Thailand' } }).hardReject, false);
});

test('gate: ambiguous text or an ambiguous field goes to Jev, not a hard reject', () => {
  assert.equal(ownerGate('This is a fully remote role. We meet for quarterly on-site offsites in Lisbon.').hardReject, false);
  const gate = atsGate('Hybrid, 3 days a week in our London office.', 'greenhouse', { location: { name: 'London (Hybrid) or Remote UK' } });
  assert.equal(gate.hardReject, false);
  assert.equal(gate.workMode.ambiguous, true);
});

test('the pipeline passes the fetched ATS work mode to the gate', () => {
  assert.match(server, /evaluateOfferAgainstProfile\(gateText, profileStruct, profile, \{ atsWorkMode: jdResult\.workMode \|\| null, remoteVerdict: pipelineTarget\.remote_verdict \|\| '' \}\)/);
  for (const [fn, source] of [
    ['fetchAshbyJobDescriptionFromApi', 'ashby'],
    ['fetchGreenhouseJobDescriptionFromGuessedApi', 'greenhouse'],
    ['fetchLeverJobDescriptionFromApi', 'lever'],
    ['fetchWorkableJobDescriptionFromApi', 'workable'],
  ]) assert.ok(sourceOf(fn).includes(`workMode: structuredWorkMode('${source}', `), fn);
  assert.match(sourceOf('fetchKnownSourceJobDescription'), /\['workable-api', \(\) => fetchWorkableJobDescriptionFromApi\(/);
});

test('the Workable API fetcher carries the workplace field', async () => {
  const calls = [];
  const { fetchWorkableJobDescriptionFromApi } = serverFunctions(['fetchWorkableJobDescriptionFromApi'], {
    structuredWorkMode,
    fetchJsonWithSourceCache: async url => {
      calls.push(url);
      return { title: 'Senior Product Designer (Remote in Europe)', remote: true, workplace: 'remote', location: { city: '', country: 'Czechia' }, description: '<p>Posting</p>' };
    },
    formatSourceJobDescription: (source, job) => `${source} | ${job.companyName} | ${job.location} | ${job.workplaceType}`,
  });
  const result = await fetchWorkableJobDescriptionFromApi('https://apply.workable.com/cloudtalk/j/2B7FA6A0F6/', { hints: {} });
  assert.equal(calls[0], 'https://apply.workable.com/api/v2/accounts/cloudtalk/jobs/2B7FA6A0F6');
  assert.equal(result.text, 'Workable API | cloudtalk | Czechia | remote');
  assert.equal(result.workMode.mode, 'remote');
  assert.equal(await fetchWorkableJobDescriptionFromApi('https://example.com/jobs/1'), null);
});

// 76 of the 104 offers the scan called "remote: unclear" ended as LLM hard fails
// after a full call (2026-10-16/17). With no remote word in the posting at all,
// the gate gives that answer before the call.
test('an unclear-remote posting that never mentions remote work is a hard pass before the model call', () => {
  const quiet = 'Senior Product Designer. Join our product team to shape the next generation of our platform. You will own flows end to end and work with engineers and researchers.';
  const gate = (jd, remoteVerdict) => workModeGate.evaluateOfferAgainstProfile(jd, OWNER_PROFILE, '', { remoteVerdict });
  assert.equal(gate(quiet, 'unclear').hardReject, true);
  assert.match(gate(quiet, 'unclear').reasons[0], /never mentions it/);
  // The scan was sure, or the text says remote: the model decides.
  assert.equal(gate(quiet, 'compatible').hardReject, false);
  assert.equal(gate(quiet, '').hardReject, false);
  assert.equal(gate(`${quiet} Location: Remote, Europe.`, 'unclear').hardReject, false);
  assert.equal(gate(`${quiet} Télétravail possible.`, 'unclear').hardReject, false);
});

// OpenAI "Product Designer, Youth" (San Francisco HQ): the scan's own note says
// "remote_verdict: unclear — remote status is ambiguous". Read as part of the
// posting, that note made the work mode remote and the gate let an on-site role
// reach the model, which hard-failed it.
test('the scan note never counts as posting text: an on-site role stays on-site for the gate', () => {
  const jd = 'Product Designer, Youth. Product Design - San Francisco. This role is based in our San Francisco HQ. We offer relocation assistance to new employees.';
  const note = 'Context note: source: Search | jev: 0.50 kept | remote_verdict: unclear — remote status is ambiguous';
  const gate = text => workModeGate.evaluateOfferAgainstProfile(text, OWNER_PROFILE, '', { remoteVerdict: 'unclear' });
  assert.equal(workModeGate.evaluateOfferAgainstProfile(`${note}\n${jd}`, OWNER_PROFILE, '').hardReject, false, 'the pollution this test guards against');
  assert.equal(gate(`Location: San Francisco\n${jd}`).hardReject, true);
  assert.match(server, /const gateText = \[pipelineTarget\.location/);
});
