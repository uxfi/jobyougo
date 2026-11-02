// A run whose opener closed took any open tab with a form and two title words:
// on 2026-11-02 an "AuraOne Human Data" row (a Glassdoor search page) sent the
// CV and three answers to BoondManager's form on Welcome to the Jungle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptAdoptCandidate, tabNamesCompany } from '../extension/apply-tab-match.mjs';

const aura = {
  originUrl: 'https://www.glassdoor.com/Job/remote-ux-ui-designer-jobs-SRCH_IL.0,6_IS11047_KO7,21.htm',
  role: '328 ux ui designer Jobs in Remote, October 2026',
  company: 'AuraOne Human Data',
};
const boond = {
  url: 'https://www.welcometothejungle.com/fr/companies/boondmanager/jobs/senior-product-designer-full-remote',
  title: 'Senior Product Designer Jobs - BoondManager',
  hasForm: true,
  tabId: 5,
};

test('another company\'s open form is refused, whatever its score', () => {
  const verdict = acceptAdoptCandidate(boond, aura);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.hardReject, 'autre-entreprise');
  assert.ok(verdict.score >= 40, 'it used to pass on score alone');
});

test('another company on the same board is refused too', () => {
  const ctx = { originUrl: 'https://www.welcometothejungle.com/fr/companies/thiga/jobs/pm_paris', role: 'Product Designer', company: 'Thiga' };
  assert.equal(acceptAdoptCandidate(boond, ctx).hardReject, 'autre-entreprise');
});

test('the offer\'s own tab is still adopted', () => {
  const ctx = { ...aura, company: 'BoondManager', role: 'Senior Product Designer' };
  assert.equal(acceptAdoptCandidate(boond, ctx).ok, true, 'company in the URL and title');
  assert.equal(acceptAdoptCandidate({ url: 'https://apply.workable.com/j/ABC123', title: 'Lead Designer - Hilo by Aktiia', hasForm: true }, { originUrl: 'https://jobs.workable.com/view/x', role: 'Lead Designer', company: 'Hilo by Aktiia' }).ok, true, 'company in the title');
  assert.equal(acceptAdoptCandidate({ url: 'https://jobs.lever.co/hilobyaktiia/123', title: '', hasForm: true }, { originUrl: 'https://www.arbeitnow.com/jobs/x', role: 'Lead Designer', company: 'Hilo by Aktiia' }).ok, true, 'company written together in the path');
  assert.equal(acceptAdoptCandidate({ url: 'https://ewor.teamtailor.com/jobs/1/applications/new', title: 'Apply', hasForm: true }, { originUrl: 'https://uiuxjobsboard.com/job/1', role: 'Designer', company: 'EWOR GmbH' }).ok, true, 'legal suffix ignored');
});

test('the same posting is adopted even when the company is written differently', () => {
  const origin = 'https://job-boards.greenhouse.io/acme/jobs/4567890';
  assert.equal(acceptAdoptCandidate({ url: `${origin}/apply`, title: 'Apply', hasForm: true }, { originUrl: origin, role: 'Designer', company: 'Totally Other Name' }).ok, true, 'same job id');
  assert.equal(acceptAdoptCandidate({ url: 'https://acme.teamtailor.com/jobs/apply', title: 'Apply', hasForm: true }, { originUrl: 'https://acme.teamtailor.com/jobs/1-role', role: 'Designer', company: 'Totally Other Name' }).ok, true, 'same employer host');
  assert.equal(acceptAdoptCandidate({ url: 'https://other.example.com/form', title: 'Apply', hasForm: true }, { originUrl: 'https://board.example.org/x', expectedHref: 'https://other.example.com/start', role: 'Designer', company: 'Totally Other Name' }).ok, true, 'the host the button pointed at');
});

test('a tab the click itself opened stays trusted', () => {
  assert.equal(acceptAdoptCandidate(boond, aura, { trustedChild: true }).ok, true);
});

test('an offer with no company keeps the old scoring', () => {
  assert.equal(tabNamesCompany(boond, ''), null);
  assert.equal(acceptAdoptCandidate(boond, { ...aura, company: '' }).ok, true);
});

test('a login redirect naming the origin in its query does not count', () => {
  const tab = { url: 'https://example-ats.com/form?originationURL=https%3A%2F%2Fauraone.ai', title: '' };
  assert.equal(tabNamesCompany(tab, 'AuraOne Human Data'), false);
});
