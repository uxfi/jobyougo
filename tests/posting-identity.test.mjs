import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  identityFromHtml,
  identityFromJobText,
  identityFromPageTitle,
  identityFromUrl,
  mergePostingIdentity,
  noteWithIdentity,
  prettifySlug,
} from '../lib/posting-identity.mjs';
import { extractPipelineNoteParts, pipelineItemToJevCandidate, pipelineRecordFromEntry } from '../lib/pipeline-record.mjs';

test('ATS API metadata gives the title, a readable company and the location', () => {
  // formatSourceJobDescription output for the 2026-10-13 Pencil manual add.
  const text = [
    '## Job metadata',
    'Source fallback: Ashby API',
    'Requested URL: https://jobs.ashbyhq.com/pencil/0c3f4a8e-1111-2222-3333-444455556666',
    'Company: pencil',
    'Role: Product Researcher',
    'Location / remote: Remote · Europe',
    '',
    '## Job description',
    'We are looking for…',
  ].join('\n');
  assert.deepEqual(identityFromJobText(text), { title: 'Product Researcher', company: 'Pencil', location: 'Remote · Europe' });
  assert.deepEqual(identityFromJobText(''), { title: '', company: '', location: '' });
});

test('page titles from the common boards split into title and company', () => {
  const cases = [
    ['Job Application for Senior Product Designer at Consensys', 'Senior Product Designer', 'Consensys'],
    ['Acme hiring Senior Product Designer in Paris, France | LinkedIn', 'Senior Product Designer', 'Acme'],
    ['Acme - Senior Product Designer', 'Senior Product Designer', 'Acme'],
    ['Lead Product Designer | Doctolib', 'Lead Product Designer', 'Doctolib'],
    ['Senior UX Designer at Qonto', 'Senior UX Designer', 'Qonto'],
    ['Product Designer - Careers at Alan', 'Product Designer', 'Alan'],
    ['Senior Product Designer - Lemlist - CDI à Paris | Welcome to the Jungle', 'Senior Product Designer', 'Lemlist'],
  ];
  for (const [raw, title, company] of cases) {
    const got = identityFromPageTitle(raw);
    assert.equal(got.title, title, raw);
    assert.equal(got.company, company, raw);
  }
  assert.equal(identityFromPageTitle('Senior Product Designer', 'Pennylane').company, 'Pennylane');
});

test('HTML reads og:title with og:site_name, else <title>', () => {
  const title = '<html><head><title>Job Application for Staff Product Designer at Dropbox</title></head></html>';
  assert.deepEqual(identityFromHtml(title), { title: 'Staff Product Designer', company: 'Dropbox', location: '' });
  const og = '<meta property="og:title" content="Product Designer &amp; Researcher"><meta property="og:site_name" content="Pennylane">';
  assert.deepEqual(identityFromHtml(og), { title: 'Product Designer & Researcher', company: 'Pennylane', location: '' });
  assert.deepEqual(identityFromHtml(''), { title: '', company: '', location: '' });
});

test('the URL alone names the board company, and the title on WTTJ-style paths', () => {
  assert.equal(identityFromUrl('https://jobs.ashbyhq.com/pencil/0c3f4a8e-1111-2222-3333-444455556666').company, 'Pencil');
  assert.equal(identityFromUrl('https://jobs.eu.lever.co/acme-corp/abcd-ef12').company, 'Acme Corp');
  assert.equal(identityFromUrl('https://job-boards.greenhouse.io/consensys/jobs/1234567').company, 'Consensys');
  assert.equal(identityFromUrl('https://apply.workable.com/qonto/j/ABC123/').company, 'Qonto');
  assert.equal(identityFromUrl('https://alan.recruitee.com/o/product-designer').company, 'Alan');
  assert.deepEqual(
    identityFromUrl('https://www.welcometothejungle.com/fr/companies/lemlist/jobs/senior-product-designer_paris'),
    { title: 'Senior Product Designer', company: 'Lemlist', location: '' },
  );
  assert.deepEqual(identityFromUrl('https://example.com/careers/123'), { title: '', company: '', location: '' });
  assert.deepEqual(identityFromUrl('not a url'), { title: '', company: '', location: '' });
});

test('mergePostingIdentity keeps the first value per field', () => {
  assert.deepEqual(
    mergePostingIdentity({ title: 'Product Researcher', company: '' }, { title: 'Other', company: 'Pencil', location: 'Remote' }),
    { title: 'Product Researcher', company: 'Pencil', location: 'Remote' },
  );
  assert.equal(prettifySlug('acme-corp'), 'Acme Corp');
  assert.equal(prettifySlug('BlaBlaCar'), 'BlaBlaCar');
});

test('noteWithIdentity writes "Company | Title" and keeps the user note', () => {
  assert.equal(noteWithIdentity('', { title: 'Product Researcher', company: 'Pencil' }), 'Pencil | Product Researcher');
  assert.equal(noteWithIdentity('via Pierre', { title: 'Product Researcher', company: 'Pencil' }), 'Pencil | Product Researcher | via Pierre');
  assert.equal(noteWithIdentity('', { title: 'Product Researcher', company: '' }), '? | Product Researcher');
  assert.equal(noteWithIdentity('Acme | Lead Designer', { title: 'Other', company: 'Other' }), 'Acme | Lead Designer');
  assert.equal(noteWithIdentity('hello', {}), 'hello');
  const parts = extractPipelineNoteParts(noteWithIdentity('', { title: 'Lead | Designer', company: 'Acme' }));
  assert.equal(parts.title, 'Lead / Designer');
});

test('a manual add with a fetched identity reaches Jev with a title, not the URL alone', () => {
  const url = 'https://jobs.ashbyhq.com/pencil/0c3f4a8e-1111-2222-3333-444455556666';
  const identity = { title: 'Product Researcher', company: 'Pencil', location: 'Remote · Europe' };
  const record = pipelineRecordFromEntry({ url, note: noteWithIdentity('', identity), ...identity }, '2026-10-13T08:00:00.000Z');
  assert.equal(record.title, 'Product Researcher');
  assert.equal(record.company, 'Pencil');
  const candidate = pipelineItemToJevCandidate({ url, note: noteWithIdentity('', identity) });
  assert.equal(candidate.title, 'Product Researcher');
  assert.equal(candidate.company, 'Pencil');
});
