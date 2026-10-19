// The Eyzee posting (justjoin.it, 2026-10-19) was evaluated twice as the
// candidate's own employer, OneAsset, rejected by validation, and queued again
// on every run. Plus the same run's title, score and sync findings.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import justjoin, { formatJustJoinOffer, justJoinOfferSlug, justJoinOfferApiUrl, parseJustJoinResponse } from '../providers/justjoin.mjs';
import { detectJdLanguage, offerTaskLine, jdSufficiency } from '../lib/jd-sufficiency.mjs';
import { assembleUiPrompt } from '../lib/prompt-budget.mjs';
import { buildEvalRepairPrompt } from '../lib/eval-draft.mjs';
import { pipelineOfferIdentity } from '../lib/pipeline-record.mjs';
import { failuresFor, recordEvalFailure, validationFailureAction, MAX_VALIDATION_RETRIES } from '../lib/eval-attempts.mjs';
import { gateDropRecord } from '../lib/gate-drops.mjs';
import { computeGlobalScore, ownEmployerConfusion } from '../lib/report-validation.mjs';
import { scanMemoryPaths } from '../lib/scan-memory.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = readFileSync(join(ROOT, 'ui/server.mjs'), 'utf8');
const EYZEE = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/justjoin-eyzee-offer.json'), 'utf8'));
const URL_EYZEE = 'https://justjoin.it/job-offer/eyzee-s-a--specjalista-ux-ui-warszawa-ux-a5f3829a';
const html = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

function sourceOf(name) {
  const start = server.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, `${name} is defined`);
  return server.slice(start, server.indexOf('\n}\n', start) + 2);
}

test('justjoin: offer slug and API URL only for justjoin.it offer pages', () => {
  assert.equal(justJoinOfferSlug(URL_EYZEE), 'eyzee-s-a--specjalista-ux-ui-warszawa-ux-a5f3829a');
  assert.equal(justJoinOfferApiUrl(justJoinOfferSlug(URL_EYZEE)), 'https://justjoin.it/api/candidate-api/offers/eyzee-s-a--specjalista-ux-ui-warszawa-ux-a5f3829a');
  assert.equal(justJoinOfferSlug('https://evil.example/job-offer/eyzee'), '');
  assert.equal(justJoinOfferSlug('http://justjoin.it/job-offer/eyzee-s-a'), '');
  assert.equal(justJoinOfferSlug('https://justjoin.it/job-offers/all-locations'), '');
  assert.equal(justJoinOfferApiUrl('../../etc'), '');
  assert.equal(justjoin.id, 'justjoin');
});

test('justjoin: the API offer keeps the body lists, salary in its own currency, skills and remote', () => {
  const offer = formatJustJoinOffer(EYZEE);
  assert.equal(offer.title, 'Specjalista UX/UI');
  assert.equal(offer.companyName, 'Eyzee S.A.');
  assert.equal(offer.workMode, 'remote');
  assert.match(offer.location, /^Remote \(PL\); cities listed: Warszawa/);
  assert.match(offer.description, /<li>projektowanie i rozwój interfejsów/);
  assert.doesNotMatch(offer.description, /<li>\s*<p>/);
  assert.match(offer.description, /Salary \(b2b: 7000–8190 PLN \/ month\)/);
  assert.doesNotMatch(offer.description, /USD|GBP|CHF/);
  assert.match(offer.description, /Required skills: HTML5 \(3\/5\), CSS 3 \(3\/5\), Figma \(3\/5\)/);
  assert.match(offer.description, /Experience level: mid/);
  assert.equal(formatJustJoinOffer({ data: EYZEE }).title, 'Specjalista UX/UI');
  assert.equal(formatJustJoinOffer({ title: 'x' }), null);
  // The API text names the company and the role: no thin-JD park.
  assert.equal(jdSufficiency(html(offer.description), { company: 'Eyzee S.A.', title: 'Specjalista UX/UI' }).ok, true);
});

test('justjoin: listing titles get one space per run', () => {
  const [row] = parseJustJoinResponse({ data: [{ slug: 'dcv', title: 'Senior Product  UX/UI Designer   with Fluent Japanese', companyName: ' DCV  Technologies ', workplaceType: 'remote', city: 'Poland  Remote' }] });
  assert.equal(row.title, 'Senior Product UX/UI Designer with Fluent Japanese');
  assert.equal(row.company, 'DCV Technologies');
  assert.equal(row.location, 'remote, Poland Remote');
  const identity = pipelineOfferIdentity({ url: 'https://justjoin.it/job-offer/dcv', note: 'DCV Technologies | Senior Product  UX/UI Designer   with Fluent Japanese' });
  assert.equal(identity.title, 'Senior Product UX/UI Designer with Fluent Japanese');
});

test('JD language: Polish posting is detected, English is English, short text is unknown', () => {
  assert.equal(detectJdLanguage(html(EYZEE.body)).code, 'pl');
  assert.equal(detectJdLanguage('We are looking for a senior product designer to join our remote team. You will work with the product and engineering teams and you are expected to own the design system. '.repeat(3)).code, 'en');
  assert.equal(detectJdLanguage('Specjalista UX/UI. Aplikuj.').code, '');
});

test('task line names the offer, the exact header, the CV employers and the language', () => {
  const line = offerTaskLine({ company: 'Eyzee S.A.', title: 'Specjalista UX/UI', url: URL_EYZEE, language: 'pl', ownEmployers: ['OneAsset', 'OneAsset', 'Creads.io', 'Eyzee S.A.'] });
  assert.match(line, /Évalue l'offre « Eyzee S\.A\. — Specjalista UX\/UI »/);
  assert.match(line, /Première ligne exacte : # Evaluation: Eyzee S\.A\. — Specjalista UX\/UI/);
  assert.match(line, /L'entreprise évaluée est Eyzee S\.A\. OneAsset, Creads\.io : employeurs ou projets du candidat \(CV\), jamais l'offre/);
  assert.match(line, /rédigée en polonais/);
  assert.doesNotMatch(line, /ci-dessus\. URL/);
  assert.doesNotMatch(offerTaskLine({ company: 'Acme', title: 'Designer', language: 'en' }), /rédigée en/);
});

test('pipeline prompt: the fenced offer comes after the CV facts, right before the task line', () => {
  const cv = '# Hugo\n\n## Experience\n\n### OneAsset\n**Senior Product Designer** | Feb 2026 - Present\n- Figma (10/10)\n';
  const { parts } = assembleUiPrompt({ mode: 'pipeline', cv, prefetch: `## Job Description\n${EYZEE.body}` });
  const facts = parts.findIndex(p => p.startsWith('## Faits confirmés du CV'));
  const offer = parts.findIndex(p => p.startsWith('## Offre'));
  assert.ok(facts >= 0 && offer === parts.length - 1 && facts < offer, 'offer is the last context block');
  assert.match(parts[offer], /^## Offre\n=== DÉBUT DE L'OFFRE ===\n[\s\S]*\n=== FIN DE L'OFFRE ===$/);
  const letter = assembleUiPrompt({ mode: 'coverletter', cv, prefetch: '## Report\nx' });
  assert.doesNotMatch(letter.parts.join('\n'), /DÉBUT DE L'OFFRE/, 'only evaluations are fenced');
});

test('repair prompt carries the offer company: it used to see only the CV facts and "{Company}"', () => {
  const facts = '- Postes :\n  - Senior Product Designer : OneAsset (Feb 2026 - Present)';
  const prompt = buildEvalRepairPrompt('# Evaluation: Eyzee S.A. — Specjalista UX/UI\nFigma implicite', facts, { offer: { company: 'Eyzee S.A.', title: 'Specjalista  UX/UI' } });
  assert.match(prompt, /- Ligne 1 : # Evaluation: Eyzee S\.A\. — Specjalista UX\/UI\n/);
  assert.match(prompt, /L'offre évaluée est celle de Eyzee S\.A\. Les employeurs du CV/);
  assert.match(buildEvalRepairPrompt('d', facts), /Ligne 1 : # Evaluation: \{Company\} — \{Role\}/);
  assert.equal(ownEmployerConfusion('OneAsset', 'Eyzee S.A.', ['OneAsset']), 'OneAsset');
});

test('validation failures: one retry, then the URL is parked for review', async () => {
  assert.equal(MAX_VALIDATION_RETRIES, 1);
  assert.equal(validationFailureAction(1), 'retry');
  assert.equal(validationFailureAction(2), 'park');
  const dir = mkdtempSync(join(tmpdir(), 'eval-failures-'));
  try {
    mkdirSync(join(dir, 'data'));
    const memory = scanMemoryPaths(dir);
    assert.ok(memory.evalFailures.endsWith('eval-failures.jsonl'));
    const failure = { url: URL_EYZEE, code: 'own_employer', reason: 'the model evaluated OneAsset' };
    assert.equal((await recordEvalFailure(memory, failure)).length, 1);
    const second = await recordEvalFailure(memory, { ...failure, url: `${URL_EYZEE}/` });
    assert.equal(second.length, 2, 'same URL with a trailing slash');
    assert.equal(validationFailureAction(second.filter(f => f.code === 'own_employer').length), 'park');
    assert.equal(failuresFor(readFileSync(memory.evalFailures, 'utf8'), 'https://justjoin.it/job-offer/other').length, 0);
    const old = JSON.stringify({ url: URL_EYZEE, code: 'own_employer', at: '2020-01-01T00:00:00Z' });
    assert.equal(failuresFor(old, URL_EYZEE).length, 0, 'older than 30 days');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(gateDropRecord({ url: URL_EYZEE, gate: 'review', reasons: ['x'] }).gate, 'review');
});

test('server: a rejected pipeline report is counted, parked after the retry, and never written', () => {
  const start = server.indexOf("console.error(`❌ Report validation failed for ${filename}: ${validation.reason}`);");
  const block = server.slice(start, server.indexOf('// PDF → automatic generation', start));
  assert.match(block, /recordEvalFailure\(memory, \{ url: pipelineTarget\.url/);
  assert.match(block, /validationFailureAction\(sameReason\) === 'park'/);
  assert.match(block, /removeFromPipeline\(pipelineTarget\.url, req\.userId, \{ historyStatus: 'needs_review', historyPortal: 'pipeline-review' \}\)/);
  assert.match(block, /gate: 'review'/);
  assert.doesNotMatch(block, /writeFile\(|supabase\.from\(|runScript\('merge'\)/, 'no report, TSV, tracker or Supabase row');
  assert.match(server, /buildEvalRepairPrompt\(fullResponse, facts, \{ outputLanguage, offer: mode === 'pipeline' && pipelineTarget \? pipelineOfferIdentity\(pipelineTarget\) : null \}\)/);
  assert.match(server, /parts\.push\(offerTaskLine\(\{/);
  assert.doesNotMatch(server, /Évalue l'offre ci-dessus\. URL/);
  assert.match(sourceOf('fetchKnownSourceJobDescription'), /\['justjoin-api', \(\) => fetchJustJoinJobDescriptionFromApi/);
  assert.match(sourceOf('fetchJustJoinJobDescriptionFromApi'), /redirect: 'error'/);
});

test('server: the parsed role is the full title, one space per run, and the log does not cut it', () => {
  assert.match(server, /const role {5}= String\(offer\.title \|\| roleMatch\?\.\[1\] \|\| 'role'\)\.replace\(\/\\s\+\/g, ' '\)\.trim\(\)\.slice\(0, 200\);/);
  assert.match(server, /parsed: company=\$\{company\}, role=\$\{role\}, score=/);
  const identity = pipelineOfferIdentity({ url: 'https://weworkremotely.com/remote-jobs/current-senior-product-designer-webflow-temp-to-perm', company: 'Current', title: 'Senior Product Designer (Webflow) Temp to Perm', engine: 'weworkremotely' });
  assert.deepEqual(identity, { company: 'Current', title: 'Senior Product Designer (Webflow) Temp to Perm' });
});

test('Notation Global: the weighted mean of reports 960-962, rounded half up', () => {
  // dcv (962): 2*.4 + 5*.25 + 3*.1 + 2*.1 + 2*.15 = 2.85, capped at 3.0 by red flags 2.
  assert.equal(computeGlobalScore({ match: 2, northStar: 5, comp: 3, culture: 2, redFlags: 2 }), 2.9);
  // current (961): .8 + .75 + .5 + .3 + .45 = 2.8
  assert.equal(computeGlobalScore({ match: 2, northStar: 3, comp: 5, culture: 3, redFlags: 3 }), 2.8);
  // flying-bisons (960): 2 + 1.25 + .2 + .5 + .75 = 4.7
  assert.equal(computeGlobalScore({ match: 5, northStar: 5, comp: 2, culture: 5, redFlags: 5 }), 4.7);
  // abzorba (958): 2.95, red flags 2 caps at 3.0
  assert.equal(computeGlobalScore({ match: 3, northStar: 3, comp: 3, culture: 4, redFlags: 2 }), 3.0);
  assert.equal(computeGlobalScore({ match: 1, northStar: 1, comp: 1, culture: 1, redFlags: 1 }), 1.0);
});

test('applications sync: the watcher and the evaluation push the same tracker once', async () => {
  const upserts = [];
  const supabase = {
    from: () => ({
      upsert: async (rows) => {
        upserts.push(rows.length);
        await new Promise(resolve => setTimeout(resolve, 30));
        return { error: null };
      },
    }),
  };
  const logs = [];
  const sync = vm.runInNewContext(`(${sourceOf('syncLocalApplicationsToSupabase')})`, {
    useSupabase: true,
    LOCAL_SYNC_DISABLED: false,
    supabase,
    createHash,
    lastAppsSyncHash: new Map(),
    appsSyncInFlight: new Map(),
    join: (...parts) => parts.join('/'),
    WRITE_ROOT: 'root',
    readFile: async () => '| # |',
    parseApplicationsMarkdown: () => [{ num: 961, job_url: '' }, { num: 962, job_url: 'https://x/962' }],
    ownsLocalData: async () => false,
    getAdminUserId: async () => 'admin',
    console: { log: (m) => logs.push(m), error() {} },
    Promise,
    setTimeout,
  });
  const [a, b] = await Promise.all([sync('admin'), sync(null)]);
  assert.equal(upserts.length, 1, 'one upsert for two concurrent calls');
  assert.equal(logs.filter(m => /synced to Supabase/.test(m)).length, 1);
  assert.ok(a.ok && b.ok);
  assert.ok(a.unchanged || b.unchanged);
});
