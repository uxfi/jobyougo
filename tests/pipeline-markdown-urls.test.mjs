import { pass, fail } from './helpers.mjs';
import { removePipelineMarkdownUrls } from '../lib/pipeline-record.mjs';

console.log('\nPipeline markdown URL delete');

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
