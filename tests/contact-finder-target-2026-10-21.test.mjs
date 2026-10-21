// The finder's target company comes from the offer, never from the
// candidate's own CV (Glassdoor Vertech run searched "OneAsset"). Offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { companyFromJobUrl, companyNameFromJobText, ownCompanyNames, isOwnCompany, targetCompany } from '../lib/contact-finder.mjs';

const GD = 'https://www.glassdoor.com/job-listing/ux-ui-designer-vertech-industrial-systems-JV_KO0,14_KE15,41.htm?jl=1010148788011';
const career = {
  employers: [
    '- Senior Product Designer / Product Lead : OneAsset (Feb 2026 – Present): Salaried; product lead.',
    '- Product Designer / Product Manager : UpViral (Jul 2024 – Dec 2025): SaaS marketing platform.',
    '- Freelance Senior Product Designer / UX Consultant (Aug 2016 – Present): Independent : BNP Paribas, Cdiscount.',
  ],
  sideNames: ['Creads.io', 'JobYouGo'],
};
// What a signed-in Glassdoor page reads like: the user's own header first.
const signedInText = 'Hugo V\nSenior Product Designer at OneAsset\nUX/UI Designer\nVertech Industrial Systems\nRemote';

test('Glassdoor URL: the employer from the KE range', () => {
  assert.equal(companyFromJobUrl(GD), 'Vertech Industrial Systems');
  assert.equal(companyFromJobUrl('https://jobs.ashbyhq.com/darkroom/7f7a'), '');
  assert.equal(companyFromJobUrl('not a url'), '');
});

test('own companies: employers and side projects, not the freelance client list', () => {
  const own = ownCompanyNames(career);
  assert.deepEqual(own, ['OneAsset', 'UpViral', 'Creads.io', 'JobYouGo']);
  assert.ok(isOwnCompany('oneasset', own));
  assert.ok(!isOwnCompany('Vertech Industrial Systems', own));
});

test('Vertech / OneAsset: the target is Vertech, OneAsset is rejected', () => {
  assert.equal(companyNameFromJobText(signedInText), 'OneAsset', 'the old guess, kept as is');
  const own = ownCompanyNames(career);
  const t = targetCompany({ company: '', jobUrl: GD, jobText: signedInText, own });
  assert.equal(t.company, 'Vertech Industrial Systems');
  assert.equal(t.source, 'job-url');
  const noUrl = targetCompany({ company: '', jobUrl: 'https://example-board.com/job/1', jobText: signedInText, own });
  assert.equal(noUrl.company, '', 'the own employer is never searched');
  assert.deepEqual(noUrl.rejected, ['OneAsset']);
  const given = targetCompany({ company: 'OneAsset', jobUrl: GD, jobText: '', own });
  assert.equal(given.company, 'Vertech Industrial Systems');
});

test('unchanged: a given company and the "Company:" line still win', () => {
  const own = ownCompanyNames(career);
  assert.equal(targetCompany({ company: 'Darkroom', jobUrl: GD, own }).company, 'Darkroom');
  assert.equal(targetCompany({ jobText: 'Company: Acme Corp\nDesigner', own }).company, 'Acme Corp');
  assert.equal(targetCompany({ jobText: 'Lead Designer at Mindera\nPorto', own }).company, 'Mindera');
});

test('the server takes the target through targetCompany (no CV company fallback)', () => {
  const src = readFileSync(new URL('../ui/server.mjs', import.meta.url), 'utf8');
  const i = src.indexOf("path === '/api/contact-finder'");
  const block = src.slice(i, i + 6000);
  assert.match(block, /targetCompany\(\{ company, jobUrl, jobText, own \}\)/);
  assert.doesNotMatch(block, /company = companyNameFromJobText\(jobText\)/);
  // The finder only drafts: nothing is sent from the server.
  assert.doesNotMatch(block, /sendMail|send_message|smtp/i);
});