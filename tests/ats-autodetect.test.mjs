import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detectAtsProvider, ATS_HOSTS } from '../lib/ats-autodetect.mjs';
import { jobBoardProviders } from '../lib/scan-job-boards.mjs';

const fixture = (id, url) => ({ name: 'Acme', careers_url: url, _id: id });

test('every auto-detected ATS has a provider plugin with detect()', () => {
  for (const id of Object.keys(ATS_HOSTS)) {
    assert.ok(jobBoardProviders.get(id), id);
    assert.equal(typeof jobBoardProviders.get(id).detect, 'function', id);
  }
});

test('careers_url on a known ATS host is routed to its provider', () => {
  const cases = [
    ['workable', 'https://apply.workable.com/withings'],
    ['smartrecruiters', 'https://careers.smartrecruiters.com/canva'],
    ['recruitee', 'https://bunq.recruitee.com'],
    ['teamtailor', 'https://deezer.teamtailor.com/jobs'],
    ['breezy', 'https://acme.breezy.hr/'],
    ['join', 'https://join.com/companies/acme'],
    ['rippling', 'https://ats.rippling.com/rippling/jobs'],
    ['softgarden', 'https://acme.softgarden.io/'],
  ];
  for (const [id, url] of cases) assert.equal(detectAtsProvider(fixture(id, url), jobBoardProviders), id, url);
});

test('look-alike, non-https, vendor marketing and unrelated hosts are not routed', () => {
  for (const url of ['https://acme.com/careers', 'http://acme.recruitee.com', 'https://evil.com/acme.recruitee.com', 'https://www.recruitee.com/', 'https://recruitee.com.evil.io/x', 'https://acme.wd5.myworkdayjobs.com/Ext', 'https://acme.jobs.personio.de', 'not a url']) {
    assert.equal(detectAtsProvider({ name: 'x', careers_url: url }, jobBoardProviders), '', url);
  }
  assert.equal(detectAtsProvider({ careers_url: 'https://acme.recruitee.com' }, new Map()), '', 'no plugin -> no route');
  assert.equal(detectAtsProvider({ careers_url: 'https://acme.recruitee.com' }, new Map([['recruitee', { detect: () => { throw new Error('x'); } }]])), '');
});

test('the server routes auto-detected ATS before web search and logs found/after-filter per provider company', () => {
  const src = readFileSync(new URL('../ui/server.mjs', import.meta.url), 'utf8');
  const access = src.slice(src.indexOf('function getCompanyScanAccess('), src.indexOf('function isAggregatorConfigured('));
  assert.ok(access.indexOf('detectAtsProvider(company, jobBoardProviders)') < access.indexOf("=== 'websearch'"));
  assert.match(src, /providerCompanies\.push\(\{ \.\.\.company, provider: access\.provider \}\)/);
  assert.match(src, /return \{ ok: true, empty: jobs\.length === 0, jobs, engine: aggregator\.provider,/);
});