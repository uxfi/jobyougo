import { pass, fail } from './helpers.mjs';
import {
  extractPipelineNoteParts,
  formatPipelineNote,
  overlayPipelineRecord,
  pipelineItemNeedsJevTriage,
  pipelineItemReadyForEval,
  pipelineItemToJevCandidate,
  pipelineRecordFromEntry,
  insertPipelineMarkdownLines,
  pipelineUrlsReadyForEval,
  removePipelineMarkdownUrls,
} from '../lib/pipeline-record.mjs';

console.log('\nPipeline Jev triage');

if (!pipelineItemNeedsJevTriage({ url: 'https://jobs.example.com/1', jev_status: 'unverified' })) {
  fail('unverified pipeline items must go through Jev again');
} else pass('unverified items are queued for Jev');

if (pipelineItemNeedsJevTriage({ url: 'https://jobs.example.com/2', jev_status: 'kept', jev_keep: 0.82 })) {
  fail('already-kept items should not be rescored');
} else pass('a kept score is not sent to Jev again');

if (!pipelineItemNeedsJevTriage({ url: 'https://jobs.example.com/3', title: 'Product Manager' })) {
  fail('items without a Jev score must be triaged');
} else pass('unscored items are queued for Jev');

const candidate = pipelineItemToJevCandidate({
  url: 'https://jobs.example.com/4',
  title: 'Senior Product Manager',
  company: 'Acme',
  location: 'Remote Europe',
  published_at: '2026-10-05',
  source: 'Jobicy',
  remote_verdict: 'compatible',
  remote_reason: 'remote europe',
  remote_confidence: 0.95,
  note: 'Acme | Senior Product Manager | posted: 2026-10-05',
});

if (
  candidate.title === 'Senior Product Manager'
  && candidate.company === 'Acme'
  && candidate.publishedAt === '2026-10-05'
  && candidate.remoteDisposition === 'keep'
) {
  pass('pipeline fields become a Jev candidate without fetching the JD');
} else fail(`candidate mapping missed stored fields: ${JSON.stringify(candidate)}`);

const review = pipelineItemToJevCandidate({
  url: 'https://jobs.example.com/5',
  title: 'Product Manager',
  remote_verdict: 'unclear',
});
if (review.remoteDisposition === 'review') pass('an unclear remote verdict stays review for Jev');
else fail(`expected review, got ${review.remoteDisposition}`);

const note = formatPipelineNote(pipelineRecordFromEntry({
  url: 'https://jobs.example.com/4',
  company: 'Acme',
  title: 'Senior Product Manager',
  jevKeep: 0.8,
  jevOutcome: 'validated',
}));
if (note.startsWith('Acme |') && !note.includes('https://') && note.includes('jev: 0.80 kept')) {
  pass('Supabase note keeps the Jev score and drops the URL prefix');
} else fail(`unexpected pipeline note: ${note}`);

const scoredNote = 'Tether | Senior TPM | posted: 2026-10-05 | source: Ashby | jev: 0.76 kept | remote_verdict: compatible — remote europe';
if (pipelineItemNeedsJevTriage({ url: 'https://jobs.example.com/6', note: scoredNote })) {
  fail('a jev: kept score in the pipeline note must not be sent to Jev again');
} else pass('kept scores written only in the note are skipped');

if (!pipelineItemNeedsJevTriage({ url: 'https://jobs.example.com/7', note: 'Tether | Senior TPM | jev: unverified' })) {
  fail('jev: unverified in the note must still be retried');
} else pass('unverified notes stay in the Jev queue');

const parsedNote = extractPipelineNoteParts('jev: unverified | Group Product Director | posted: 2026-10-05');
if (parsedNote.company === 'Group Product Director' && parsedNote.jev_status === 'unverified' && parsedNote.title === '') {
  pass('a leading jev: tag is not treated as the company');
} else fail(`jev tag leaked into company/title: ${JSON.stringify(parsedNote)}`);

const fromNote = pipelineItemToJevCandidate({
  url: 'https://jobs.example.com/8',
  note: 'Northflank | Senior Product Manager | posted: 2026-10-04 | remote_verdict: compatible — remote europe',
});
if (fromNote.title === 'Senior Product Manager' && fromNote.company === 'Northflank' && fromNote.publishedAt === '2026-10-04' && fromNote.remoteDisposition === 'keep') {
  pass('title, company, date and remote are recovered from the note when fields are empty');
} else fail(`note-only candidate mapping failed: ${JSON.stringify(fromNote)}`);

const internCandidate = pipelineItemToJevCandidate({
  url: 'https://www.welcometothejungle.com/en/companies/galadrim/jobs/product-manager-stage-de-fin-d-etudes_paris',
  title: 'Product Manager - Stage de fin d\'études',
  company: 'Galadrim',
});
if (internCandidate.seniority === 'intern' && internCandidate.contract === 'internship') {
  pass('an internship title is marked intern for Jev');
} else fail(`intern mapping failed: ${JSON.stringify(internCandidate)}`);

const overlaid = overlayPipelineRecord(
  { url: 'https://jobs.example.com/9', jev_status: 'kept', jev_keep: 0.8, note: scoredNote },
  { url: 'https://jobs.example.com/9', jev_status: '', jev_keep: null, status: 'pending' },
);
if (overlaid.jev_status === 'kept' && overlaid.jev_keep === 0.8) {
  pass('an empty jsonl record does not wipe a kept Jev score');
} else fail(`overlay wiped Jev: ${JSON.stringify({ status: overlaid.jev_status, keep: overlaid.jev_keep })}`);

if (overlayPipelineRecord({ url: 'https://jobs.example.com/9' }, { url: 'https://jobs.example.com/9', status: 'removed' }) != null) {
  fail('a removed jsonl record must hide the pipeline item');
} else pass('removed jsonl records drop the item from the pipeline view');

if (pipelineItemReadyForEval({ jev_status: 'unverified' }) || pipelineItemReadyForEval({ note: 'Acme | PM | jev: unverified' })) {
  fail('unverified items must not go to Claude');
} else pass('unverified items are blocked before Claude');

if (pipelineItemReadyForEval({ url: 'https://jobs.example.com/10', title: 'Product Manager' })) {
  fail('an item without a kept Jev score must not go to Claude');
} else pass('unscored items are blocked before Claude');

if (!pipelineItemReadyForEval({ jev_status: 'kept', jev_keep: 0.8 })) {
  fail('a kept score must be allowed through to Claude');
} else pass('kept items with a score can go to Claude');

if (pipelineItemNeedsJevTriage({ url: 'https://jobs.example.com/11', jev_status: 'kept', jev_keep: 0.55 })) {
  fail('Process must not resend an already-kept item to Jev');
} else pass('Process skips Jev for a previous keep');

if (!pipelineItemNeedsJevTriage({ url: 'https://jobs.example.com/12', jev_status: 'kept', jev_keep: 0.55 }, { rescoreKept: true })) {
  fail('rescoreKept still queues a previous keep when explicitly requested');
} else pass('rescoreKept=true can still re-score a previous keep');

const readyUrls = pipelineUrlsReadyForEval([
  { url: 'https://jobs.example.com/kept', jev_status: 'kept', jev_keep: 0.76 },
  { url: 'https://jobs.example.com/new', jev_status: 'kept', jev_keep: 0.4 },
  { url: 'https://jobs.example.com/dropped', jev_status: 'kept', jev_keep: 0.9 },
], ['https://jobs.example.com/dropped']);
if (readyUrls.join(' ') === 'https://jobs.example.com/kept https://jobs.example.com/new') {
  pass('already-kept offers stay in the Process queue unless this run dropped them');
} else fail(`ready URLs = ${readyUrls.join(', ')}`);

const prepended = insertPipelineMarkdownLines(
  '# Pipeline — Pending\n\n## Pending\n\n- [ ] https://jobs.example.com/old | Old Co | Old role\n',
  ['- [ ] https://jobs.example.com/new | New Co | New role'],
  true,
);
if (
  prepended.indexOf('## Pending') < prepended.indexOf('https://jobs.example.com/new')
  && prepended.indexOf('https://jobs.example.com/new') < prepended.indexOf('https://jobs.example.com/old')
  && prepended.startsWith('# Pipeline')
) {
  pass('a manual URL is inserted at the top of the pipeline markdown');
} else fail(`manual prepend failed: ${prepended}`);

const listingMd = [
  '# Pipeline',
  '',
  '- [ ] https://builtin.com/jobs/remote/product | Builtin | Product',
  '- [ ] https://builtin.com/jobs/remote/product/search/head-of-product | Builtin | Head of Product',
  '- [ ] http://jobs.example.com/keep/ | Acme | PM',
].join('\n');
const afterListingDelete = removePipelineMarkdownUrls(listingMd, ['https://builtin.com/jobs/remote/product']);
if (
  afterListingDelete.includes('https://builtin.com/jobs/remote/product/search/head-of-product')
  && afterListingDelete.includes('http://jobs.example.com/keep/')
  && !afterListingDelete.includes('- [ ] https://builtin.com/jobs/remote/product |')
) {
  pass('deleting a listing URL leaves longer offer URLs in the pipeline');
} else fail(`listing delete wiped the wrong lines:\n${afterListingDelete}`);

const afterSlashDelete = removePipelineMarkdownUrls(
  '- [ ] https://jobs.example.com/a/ | Acme | PM\n- [ ] https://jobs.example.com/ab | Other | PM\n',
  ['http://jobs.example.com/a'],
);
if (afterSlashDelete.includes('https://jobs.example.com/ab') && !afterSlashDelete.includes('jobs.example.com/a/')) {
  pass('pipeline delete matches the same posting across http, https and a trailing slash');
} else fail(`slash delete failed:\n${afterSlashDelete}`);
