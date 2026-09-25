import test from 'node:test';
import assert from 'node:assert/strict';
import { ATS_CATALOG, identifyAts, normalizeAtsUrl } from '../extension/apply-ats.mjs';
import { acceptAdoptCandidate, extractJobTokens } from '../extension/apply-tab-match.mjs';
import { judgeUploadSignals } from '../extension/apply-upload-signals.mjs';
import {
  autofillShouldKeepWaiting,
  identityFieldKind,
  judgeAutofillSnapshot,
} from '../extension/apply-autofill.mjs';

const IDS = [
  'lever', 'ashby', 'workable', 'greenhouse', 'smartrecruiters', 'workday',
  'icims', 'oracle-taleo', 'successfactors', 'recruitee', 'teamtailor',
  'bamboohr', 'jazzhr', 'breezy', 'welcometothejungle', 'linkedin', 'indeed',
  'wellfound', 'otta', 'welcomekit',
];

test('catalogue couvre les ATS demandés et reste extensible', () => {
  for (const id of IDS) {
    const entry = ATS_CATALOG.find((e) => e.id === id);
    assert.ok(entry, id);
    assert.ok(entry.hosts?.length, id);
    assert.ok(entry.domSignatures?.length, id);
    assert.ok(entry.expectedButtons?.length, id);
    assert.ok(entry.expectedFields?.length, id);
    assert.ok(entry.behaviors?.length, id);
  }
  ATS_CATALOG.push({
    id: 'fixture-ats',
    hosts: [/fixture-ats\.test$/],
    domSignatures: ['#fixture'],
    expectedButtons: ['Apply'],
    expectedFields: ['email'],
    behaviors: ['normalize-url'],
    urlNormalize: (url) => `${String(url).replace(/\/$/, '')}/apply`,
  });
  try {
    assert.equal(identifyAts('https://jobs.fixture-ats.test/123')?.id, 'fixture-ats');
    assert.equal(normalizeAtsUrl('https://jobs.fixture-ats.test/123'), 'https://jobs.fixture-ats.test/123/apply');
  } finally {
    ATS_CATALOG.pop();
  }
});

test('normalise les chemins connus sans casser la query', () => {
  const lever = 'https://jobs.lever.co/acme/11111111-1111-1111-1111-111111111111?ref=site';
  assert.equal(
    normalizeAtsUrl(lever),
    'https://jobs.lever.co/acme/11111111-1111-1111-1111-111111111111/apply?ref=site',
  );
  assert.equal(normalizeAtsUrl('https://jobs.lever.co/acme/11111111-1111-1111-1111-111111111111/apply'), 'https://jobs.lever.co/acme/11111111-1111-1111-1111-111111111111/apply');
  assert.match(normalizeAtsUrl('https://jobs.ashbyhq.com/acme/job-1'), /\/application$/);
  assert.match(normalizeAtsUrl('https://jobs.ashbyhq.com/acme/job-1/application'), /\/application$/);
  assert.match(normalizeAtsUrl('https://apply.workable.com/acme/j/ABCD123'), /\/apply$/);
  assert.equal(
    normalizeAtsUrl('https://job-boards.greenhouse.io/acme/jobs/4567890'),
    'https://job-boards.greenhouse.io/acme/jobs/4567890',
  );
  assert.equal(
    normalizeAtsUrl('https://jobs.smartrecruiters.com/Visa/743999936123456?trid=1'),
    'https://jobs.smartrecruiters.com/oneclick-ui/company/Visa/publication/743999936123456?trid=1',
  );
  assert.match(
    normalizeAtsUrl('https://acme.wd1.myworkdayjobs.com/en-US/External/job/Toronto/Role_R260010125'),
    /\/apply$/,
  );
  assert.match(
    normalizeAtsUrl('https://acme.wd1.myworkdayjobs.com/en-US/External/job/Toronto/Role_R260010125/apply'),
    /\/apply$/,
  );
  assert.equal(
    normalizeAtsUrl('https://acme.taleo.net/careersection/2/jobdetail.ftl?job=ABC123'),
    'https://acme.taleo.net/careersection/2/jobapply.ftl?job=ABC123',
  );
  assert.match(normalizeAtsUrl('https://acme.recruitee.com/o/senior-pm'), /\/c\/new$/);
  assert.match(normalizeAtsUrl('https://acme.teamtailor.com/jobs/12345-senior-pm'), /\/applications\/new$/);
  assert.match(normalizeAtsUrl('https://acme.bamboohr.com/careers/42'), /\/apply$/);
  assert.match(normalizeAtsUrl('https://acme.breezy.hr/p/abc123'), /\/apply$/);
  assert.equal(
    normalizeAtsUrl('https://careers-acme.icims.com/jobs/1234/job'),
    'https://careers-acme.icims.com/jobs/1234/job',
  );
  assert.equal(
    normalizeAtsUrl('https://www.linkedin.com/jobs/view/1234567890'),
    'https://www.linkedin.com/jobs/view/1234567890',
  );
  assert.equal(normalizeAtsUrl('https://example.com/jobs/1'), 'https://example.com/jobs/1');
  assert.equal(normalizeAtsUrl('pas une url'), 'pas une url');
});

test('identifyAts distingue une offre LinkedIn du fil', () => {
  assert.equal(identifyAts('https://www.linkedin.com/jobs/view/123')?.id, 'linkedin');
  assert.equal(identifyAts('https://www.linkedin.com/feed/'), null);
  assert.equal(identifyAts('https://wellfound.com/jobs/3234567')?.behaviors.includes('new-tab-apply'), true);
});

test('la reprise d’onglet refuse l’actif sans correspondance', () => {
  const origin = 'https://wellfound.com/jobs/3234567';
  const ctx = { originUrl: origin, role: 'Senior Product Designer', company: 'Acme' };
  const google = acceptAdoptCandidate({
    url: 'https://www.google.com/search?q=acme',
    title: 'Acme',
    active: true,
    tabId: 2,
  }, ctx);
  assert.equal(google.ok, false);
  assert.equal(google.hardReject, 'page-bruit');

  const otherJob = acceptAdoptCandidate({
    url: 'https://job-boards.greenhouse.io/acme/jobs/1111111',
    title: 'Other role',
    active: true,
    tabId: 3,
  }, { originUrl: 'https://job-boards.greenhouse.io/acme/jobs/4567890', role: 'Designer', company: 'Acme' });
  assert.equal(otherJob.hardReject, 'autre-offre');

  const sameJob = acceptAdoptCandidate({
    url: 'https://job-boards.greenhouse.io/acme/jobs/4567890',
    title: 'Designer at Acme',
    active: false,
    tabId: 4,
  }, { originUrl: 'https://job-boards.greenhouse.io/acme/jobs/4567890' });
  assert.equal(sameJob.ok, true);

  const atsForm = acceptAdoptCandidate({
    url: 'https://job-boards.greenhouse.io/acme/jobs/9999991',
    title: 'Senior Product Designer',
    hasForm: true,
    active: true,
    tabId: 5,
  }, ctx);
  assert.equal(atsForm.ok, true);
  assert.ok(atsForm.reasons.includes('formulaire'));

  const atsBare = acceptAdoptCandidate({
    url: 'https://job-boards.greenhouse.io/acme/jobs/9999991',
    title: 'Something else',
    active: true,
    tabId: 6,
  }, ctx);
  assert.equal(atsBare.ok, false);

  const login = acceptAdoptCandidate({
    url: 'https://jobs.example.com/login',
    title: 'Sign in',
    active: true,
    tabId: 7,
  }, ctx);
  assert.equal(login.hardReject, 'login');

  const childGoogle = acceptAdoptCandidate({
    url: 'https://www.google.com/aclk',
    title: 'Ad',
    tabId: 8,
  }, ctx, { trustedChild: true });
  assert.equal(childGoogle.ok, false);

  const childAts = acceptAdoptCandidate({
    url: 'https://jobs.ashbyhq.com/acme/job-1/application',
    title: '',
    tabId: 9,
  }, ctx, { trustedChild: true });
  assert.equal(childAts.ok, true);
  assert.ok(extractJobTokens('https://job-boards.greenhouse.io/acme/jobs/4567890').includes('4567890'));
});

test('l’upload exige un signal et refuse une erreur ou un spinner seul', () => {
  assert.equal(judgeUploadSignals({ fileCount: 1, fileName: 'cv.pdf' }).ok, true);
  const rejected = judgeUploadSignals({ fileCount: 1, errorText: 'File is too large' });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error, true);
  const spinning = judgeUploadSignals({ fileCount: 1, spinner: true });
  assert.equal(spinning.ok, false);
  assert.equal(spinning.pending, true);
  assert.equal(judgeUploadSignals({ chip: true }).ok, true);
  assert.equal(judgeUploadSignals({ hiddenFileId: true }).ok, true);
  assert.equal(judgeUploadSignals({ networkOk: true }).ok, true);
  assert.equal(judgeUploadSignals({ bodyHasFileName: true }).ok, true);
  assert.equal(judgeUploadSignals({}).ok, false);
  assert.equal(judgeUploadSignals({ spinner: true }).pending, true);
});

test('l’autofill s’arrête sur une valeur fausse et continue si rien n’est recopié', () => {
  const identity = { email: 'ada@example.com', firstName: 'Ada', lastName: 'Lovelace', fullName: 'Ada Lovelace' };
  const matched = judgeAutofillSnapshot([
    { type: 'email', name: 'email', value: 'ada@example.com' },
    { name: 'first_name', value: 'Ada' },
    { name: 'last_name', value: 'Lovelace' },
  ], identity);
  assert.equal(matched.status, 'matched');
  assert.equal(matched.manualFill, false);
  assert.equal(autofillShouldKeepWaiting(matched.status), false);

  const wrong = judgeAutofillSnapshot([
    { type: 'email', name: 'email', value: 'other@example.com' },
  ], identity);
  assert.equal(wrong.status, 'mismatch');
  assert.equal(wrong.mismatches[0].kind, 'email');
  assert.equal(autofillShouldKeepWaiting(wrong.status), false);

  const empty = judgeAutofillSnapshot([
    { type: 'email', name: 'email', value: '' },
    { name: 'first_name', value: '' },
  ], identity);
  assert.equal(empty.status, 'empty');
  assert.equal(empty.manualFill, true);
  assert.equal(autofillShouldKeepWaiting(empty.status), true);

  const partial = judgeAutofillSnapshot([
    { type: 'email', name: 'email', value: 'ada@example.com' },
    { name: 'first_name', value: '' },
  ], identity);
  assert.equal(partial.status, 'partial');
  assert.equal(autofillShouldKeepWaiting(partial.status), true);

  assert.equal(identityFieldKind({ name: 'company_name', value: 'Acme' }), null);
  assert.equal(judgeAutofillSnapshot([], identity).status, 'absent');
});
