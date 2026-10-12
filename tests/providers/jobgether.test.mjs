// tests/providers/jobgether.test.mjs — Jobgether AI-agent jobs endpoint provider.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — jobgether');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/jobgether.mjs')).href);
  const jobgether = mod.default;
  const { parseJobgetherResponse, buildJobgetherUrl, readJobgetherConfig } = mod;

  if (jobgether.id === 'jobgether') pass('jobgether.id is "jobgether"');
  else fail(`jobgether.id is ${JSON.stringify(jobgether.id)}`);

  if (jobgether.detect({ provider: 'jobgether' })?.url === 'https://jobgether.com/astroapi/ai/jobs.json') {
    pass('jobgether.detect() claims explicit provider config');
  } else {
    fail('jobgether.detect() should claim provider: jobgether');
  }
  if (jobgether.detect({ provider: 'jobicy' }) === null) pass('jobgether.detect() ignores other provider ids');
  else fail('jobgether.detect() should only claim provider: jobgether');

  const url = buildJobgetherUrl('product designer', 'europe', 2);
  if (url === 'https://jobgether.com/astroapi/ai/jobs.json?keyword=product+designer&locations=europe&limit=25&page=2') {
    pass('buildJobgetherUrl() encodes keyword, location, limit and page');
  } else {
    fail(`buildJobgetherUrl() returned ${url}`);
  }
  if (!buildJobgetherUrl('ux', '', 1).includes('locations=')) pass('buildJobgetherUrl() omits an empty location');
  else fail('buildJobgetherUrl() must omit locations when empty');

  const cfg = readJobgetherConfig({ jobgether: { keywords: ['a', ' a ', 'b'], locations: ['europe'], max_pages: 99 } });
  if (cfg.keywords.length === 2 && cfg.locations[0] === 'europe' && cfg.maxPages === 10) {
    pass('readJobgetherConfig() dedups keywords and caps max_pages');
  } else {
    fail(`readJobgetherConfig() returned ${JSON.stringify(cfg)}`);
  }
  const flat = readJobgetherConfig({ keywords: 'ux designer' });
  if (flat.keywords[0] === 'ux designer' && flat.locations[0] === '' && flat.maxPages === 2) {
    pass('readJobgetherConfig() accepts flat keys and defaults');
  } else {
    fail(`readJobgetherConfig() flat returned ${JSON.stringify(flat)}`);
  }

  const sample = {
    jobs: [
      { id: '1', title: 'Senior Product Designer', company: 'Amplemarket', url: 'https://jobgether.com/offer/1-senior-product-designer', location: 'Europe, EMEA', remote: 'Full Remote', postedAt: '2026-10-08T15:31:36.241Z' },
      { id: '2', title: 'UX Designer', company: '', url: 'http://jobgether.com/offer/2', location: 'Anywhere', remote: 'Full Remote' },
      { id: '3', title: '', company: 'Nope', url: 'https://jobgether.com/offer/3' },
      { id: '4', title: 'Design Lead', company: 'Evil', url: 'https://evil.example/offer/4' },
      null,
    ],
    pagination: { page: 1, limit: 25, hasMore: true },
  };
  const jobs = parseJobgetherResponse(sample, 'Jobgether');
  if (jobs.length === 1) pass('parseJobgetherResponse() keeps only https jobgether.com postings with a title');
  else fail(`parseJobgetherResponse() returned ${jobs.length} jobs: ${JSON.stringify(jobs)}`);
  const [job] = jobs;
  if (job?.company === 'Amplemarket' && job.location === 'Full Remote — Europe, EMEA' && job.postedAt === Date.parse('2026-10-08T15:31:36.241Z')) {
    pass('parseJobgetherResponse() folds remote + location and parses postedAt');
  } else {
    fail(`parseJobgetherResponse() job shape: ${JSON.stringify(job)}`);
  }
  if (parseJobgetherResponse({ nope: true }).length === 0) pass('parseJobgetherResponse() tolerates a malformed payload');
  else fail('parseJobgetherResponse() should return [] for a malformed payload');

  // fetch(): pages until hasMore is false, dedups across pages, honours the
  // ctx.maxPages hint, and never paces with a wall-clock sleep in tests.
  const calls = [];
  const pages = {
    1: { jobs: [sample.jobs[0], { id: '5', title: 'Product Designer', company: 'X', url: 'https://jobgether.com/offer/5' }], pagination: { hasMore: true } },
    2: { jobs: [{ id: '5', title: 'Product Designer', company: 'X', url: 'https://jobgether.com/offer/5' }, { id: '6', title: 'UI Designer', company: 'Y', url: 'https://jobgether.com/offer/6' }], pagination: { hasMore: true } },
    3: { jobs: [{ id: '7', title: 'Head of Design', company: 'Z', url: 'https://jobgether.com/offer/7' }], pagination: { hasMore: false } },
  };
  const ctx = {
    fetchJson: async (u) => { calls.push(u); return pages[Number(new URL(u).searchParams.get('page'))]; },
    sleep: async () => {},
  };
  const fetched = await jobgether.fetch({ name: 'JG', jobgether: { keywords: ['designer'], locations: ['europe'], max_pages: 5 } }, ctx);
  if (calls.length === 3 && fetched.length === 4) pass('fetch() walks pages until hasMore=false and dedups by url');
  else fail(`fetch() made ${calls.length} calls and returned ${fetched.length} jobs`);

  calls.length = 0;
  const hinted = await jobgether.fetch({ name: 'JG', jobgether: { keywords: ['designer'], max_pages: 5 } }, { ...ctx, maxPages: 1 });
  if (calls.length === 1 && hinted.length === 2 && !calls[0].includes('locations=')) pass('fetch() honours ctx.maxPages and an absent location');
  else fail(`fetch() with maxPages hint made ${calls.length} calls (${calls[0]}) and returned ${hinted.length} jobs`);

  const none = await jobgether.fetch({ name: 'JG' }, ctx);
  if (none.length === 0) pass('fetch() returns [] without keywords (no default query set)');
  else fail('fetch() must not scan without keywords');
} catch (err) {
  fail(`jobgether provider test threw: ${err.message}`);
}
