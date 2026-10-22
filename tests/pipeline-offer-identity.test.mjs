/**
 * Report 739 (2026-10-15): Qwen evaluated a Deliveroo posting as the CV's own
 * OneAsset job ("# Evaluation: OneAsset — Senior Product Designer / Product
 * Lead", 4.8/5) and that header became the tracker row. The pipeline entry
 * now names the offer, and a scored evaluation of the candidate's own
 * employer is refused.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractPipelineNoteParts,
  formatPipelineMarkdown,
  parsePipeline,
  pipelineOfferIdentity,
  pipelineRecordFromEntry,
} from '../lib/pipeline-record.mjs';
import { buildJevScanResponse } from '../lib/jev.mjs';
import { extractScanEntriesFromResponse } from '../lib/scan-parse.mjs';
import { ownEmployerConfusion } from '../lib/report-validation.mjs';

const OWN = ['OneAsset', 'Société Générale', 'BMW Group', 'Creads.io'];

test('a board entry names the offer, not the model header', () => {
  const entry = {
    url: 'https://job-boards.greenhouse.io/deliveroo/jobs/8258301',
    company: 'Deliveroo',
    title: 'Staff Product Designer (Motion)',
    source: 'Deliveroo',
    engine: 'greenhouse-api',
  };
  assert.deepEqual(pipelineOfferIdentity(entry), { company: 'Deliveroo', title: 'Staff Product Designer (Motion)' });
});

test('a board row that stored the title as company takes the board name', () => {
  const entry = {
    company: 'Product Designer (UI/UX)',
    title: 'Product Designer (UI/UX)',
    source: 'Bjak',
    engine: 'ashby-api',
  };
  assert.deepEqual(pipelineOfferIdentity(entry), { company: 'Bjak', title: 'Product Designer (UI/UX)' });
});

test('search-engine rows give no company, so the model header stays', () => {
  const entry = {
    company: 'Best Remote Lead Product Designer Jobs 2026',
    title: 'Best Remote Lead Product Designer Jobs 2026 (listing)',
    source: 'Built In — design',
    engine: 'pinchtab-brave',
  };
  assert.equal(pipelineOfferIdentity(entry).company, '');
});

test('a pipeline.md note supplies company and title', () => {
  const entry = { note: 'Deliveroo | Staff Product Designer (Motion) | posted: 2026-10-06' };
  assert.deepEqual(pipelineOfferIdentity(entry), { company: 'Deliveroo', title: 'Staff Product Designer (Motion)' });
});

test("the candidate's own employer in the header of another company's offer is caught", () => {
  assert.equal(ownEmployerConfusion('OneAsset', 'Deliveroo', OWN), 'OneAsset');
  assert.equal(ownEmployerConfusion('Societe Generale', 'Deliveroo', OWN), 'Société Générale');
});

test('a matching or unknown offer company is not flagged', () => {
  assert.equal(ownEmployerConfusion('Deliveroo', 'Deliveroo', OWN), '');
  assert.equal(ownEmployerConfusion('BMW Group', 'BMW', OWN), '', 'an offer from a former employer');
  assert.equal(ownEmployerConfusion('OneAsset', '', OWN), '', 'no trusted offer company');
  assert.equal(ownEmployerConfusion('Zepz', 'WorldRemit', OWN), '', 'brand vs parent is not an own employer');
});

// A web-search hit has no company. Its note used to read "title | date", so
// the title landed in the company slot of every row (557 by 2026-10-15).
const WEB_HIT = {
  url: 'https://www.linkedin.com/jobs/view/senior-product-designer-123',
  company: '',
  title: 'Senior Product Designer',
  publishedAt: '2026-10-13',
};

test('a Jev selection line without a company keeps the title out of the company slot', () => {
  const response = buildJevScanResponse({ kept: [WEB_HIT], considered: 1 });
  const [entry] = extractScanEntriesFromResponse(response);
  const parts = extractPipelineNoteParts(entry.note);
  assert.equal(parts.company, '');
  assert.equal(parts.title, 'Senior Product Designer');
  const record = pipelineRecordFromEntry({ ...entry, company: '', title: WEB_HIT.title });
  assert.equal(record.company, '');
});

test('a pipeline.md line without a company reads back with an empty company', () => {
  const line = formatPipelineMarkdown({ url: WEB_HIT.url, company: '', title: WEB_HIT.title, posted_at: '2026-10-13' });
  const [entry] = parsePipeline(line);
  assert.deepEqual(
    [extractPipelineNoteParts(entry.note).company, extractPipelineNoteParts(entry.note).title],
    ['', 'Senior Product Designer'],
  );
});

test('a known company is written and read unchanged', () => {
  const line = formatPipelineMarkdown({ url: WEB_HIT.url, company: 'Deliveroo', title: WEB_HIT.title });
  assert.equal(extractPipelineNoteParts(parsePipeline(line)[0].note).company, 'Deliveroo');
});

// 2026-10-21: web-search hits on Glassdoor / Indeed have no company in the entry.
// The model got no readable posting, headed its report with the CV's own job
// (OneAsset) and scored it 4.8 to 5.0/5: #1040, #1042, #1045, #1052, plus #848,
// #990 and #1018 earlier.
const glassdoor = (slug, title) => ({
  url: `https://www.glassdoor.com/job-listing/${slug}-JV_KO0,14_KE15,41.htm?jl=1010148788011`,
  company: '',
  title,
  engine: 'pinchtab-brave',
  source: 'Glassdoor — Europe Remote AI',
});

test('a Glassdoor "X hiring Y Job in Z" title names the employer and the role', () => {
  assert.deepEqual(
    pipelineOfferIdentity(glassdoor('ux-ui-designer-vertech-industrial-systems', 'Vertech Industrial Systems hiring UX/UI Designer Job in Remote | Glassdoor')),
    { company: 'Vertech Industrial Systems', title: 'UX/UI Designer' },
  );
  assert.deepEqual(
    pipelineOfferIdentity(glassdoor('product-designer-design-systems-chess-com', 'Chess.com hiring Product Designer, Design Systems Job in Remote | Glassdoor')),
    { company: 'Chess.com', title: 'Product Designer, Design Systems' },
  );
  assert.deepEqual(
    pipelineOfferIdentity(glassdoor('senior-product-designerin-europace', 'Europace hiring (Senior) Product Designerin - remote (w/m/d) Job in Home office')),
    { company: 'Europace', title: '(Senior) Product Designerin - remote (w/m/d)' },
  );
});

test('a Glassdoor title without the employer takes it from the address, after the role', () => {
  assert.deepEqual(
    pipelineOfferIdentity(glassdoor('sr-ux-ui-designer-maven-workforce-pvt-ltd', 'Sr. UX/UI Designer Job in Remote | Glassdoor')),
    { company: 'Maven Workforce Pvt Ltd', title: 'Sr. UX/UI Designer Job in Remote | Glassdoor' },
    'the role is left as scanned when only the address named the employer',
  );
  assert.equal(pipelineOfferIdentity(glassdoor('product-designer', 'Product Designer Job in Remote | Glassdoor')).company, '', 'nothing after the role in the address');
  assert.equal(pipelineOfferIdentity(glassdoor('designer-remote-job', 'Designer Job | Glassdoor')).company, '', 'filler words are not a company');
});

test('"Role @ Company" names the employer; Indeed and other pages that name none stay unknown', () => {
  assert.deepEqual(
    pipelineOfferIdentity({ url: 'https://jobs.ashbyhq.com/tentens/1', company: '', title: 'Product Designer (UI/UX) @ TENTENS Tech', engine: 'pinchtab-brave' }),
    { company: 'TENTENS Tech', title: 'Product Designer (UI/UX)' },
  );
  for (const title of ['Product Designer - Remote - Indeed.com', 'Graphic cum Product Designer Design Jobs Singapore', 'UI/UX Design for Global Dating App Startup :: Behance']) {
    assert.equal(pipelineOfferIdentity({ url: 'https://www.indeed.com/viewjob?jk=ec29970ce9410d04', company: '', title, engine: 'pinchtab-brave' }).company, '', title);
  }
  assert.equal(pipelineOfferIdentity({ url: 'https://www.linkedin.com/jobs/view/1', company: '', title: 'We are hiring a Senior Product Designer | LinkedIn', engine: 'pinchtab-brave' }).company, '', '"We are" is not an employer');
});

test('a structured entry keeps its own company over anything read from the title', () => {
  const entry = { url: 'https://www.glassdoor.com/job-listing/x', company: 'Acme', title: 'Other Co hiring Designer Job in Remote', engine: 'greenhouse-api', source: 'Acme' };
  assert.deepEqual(pipelineOfferIdentity(entry), { company: 'Acme', title: 'Other Co hiring Designer Job in Remote' });
});

test("a report headed with the candidate's own employer needs a posting that names it", () => {
  const posting = 'Vertech Industrial Systems is hiring a UX/UI Designer. Remote.';
  // unknown offer company + evidence: the posting never mentions OneAsset
  assert.equal(ownEmployerConfusion('OneAsset', '', OWN, posting), 'OneAsset');
  assert.equal(ownEmployerConfusion('One Asset', '', OWN, ''), '', 'a different spelling is not the same name: no flag without that name');
  assert.equal(ownEmployerConfusion('OneAsset', '', OWN, ''), 'OneAsset', 'no posting text at all');
  // a posting that really is about that employer is left alone
  assert.equal(ownEmployerConfusion('OneAsset', '', OWN, 'OneAsset is hiring a Product Designer in Paris'), '');
  assert.equal(ownEmployerConfusion('OneAsset', '', OWN, 'Senior Product Designer at oneasset.io'), '', 'case and punctuation do not matter');
  // the header names another company: not this guard's business
  assert.equal(ownEmployerConfusion('Vertech Industrial Systems', '', OWN, posting), '');
  // without evidence the old contract holds (callers that do not pass any)
  assert.equal(ownEmployerConfusion('OneAsset', '', OWN), '');
  // a known offer company keeps the earlier behaviour whatever the evidence says
  assert.equal(ownEmployerConfusion('OneAsset', 'Deliveroo', OWN, 'OneAsset OneAsset OneAsset'), 'OneAsset');
});

test('the evaluation passes the posting to the own-employer guard', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../ui/server.mjs', import.meta.url), 'utf8');
  assert.match(src, /pipelineJdText = String\(jdResult\.text \|\| ''\);/);
  assert.match(src, /const offerEvidence = mode === 'pipeline' && pipelineTarget\s*\?\s*\[pipelineJdText, pipelineTarget\.title, pipelineTarget\.note, pipelineTarget\.url\]/);
  assert.match(src, /\.filter\(Boolean\), offerEvidence\)/);
});
