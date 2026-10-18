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
