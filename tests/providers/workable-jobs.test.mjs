// tests/providers/workable-jobs.test.mjs — jobs.workable.com search provider.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — workable-jobs');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/workable-jobs.mjs')).href);
  const provider = mod.default;
  const { readWorkableJobsConfig, buildWorkableJobsUrl, parseWorkableJobsResponse } = mod;

  if (provider.id === 'workable-jobs' && provider.detect({ provider: 'workable-jobs' }) && provider.detect({ provider: 'workable' }) === null) {
    pass('workable-jobs claims only its explicit provider id');
  } else {
    fail('workable-jobs.detect() should claim provider: workable-jobs only');
  }

  const cfg = readWorkableJobsConfig({ workable_jobs: { keywords: ['{roles}', 'Marketing Manager', ' Marketing Manager '], workplace: 'remote', location: 'Europe', day_range: 7, max_pages: 50 } });
  if (cfg.keywords.join() === 'Marketing Manager' && cfg.workplace === 'remote' && cfg.dayRange === 7 && cfg.maxPages === 10) {
    pass('readWorkableJobsConfig() drops placeholders, dedups and caps max_pages');
  } else {
    fail(`readWorkableJobsConfig() returned ${JSON.stringify(cfg)}`);
  }
  if (readWorkableJobsConfig({ workable_jobs: { workplace: 'anywhere' } }).workplace === '') pass('readWorkableJobsConfig() ignores an unknown workplace');
  else fail('readWorkableJobsConfig() must ignore an unknown workplace');

  const url = buildWorkableJobsUrl('data analyst', cfg, 'tok');
  if (url === 'https://jobs.workable.com/api/v1/jobs?query=data+analyst&workplace=remote&location=Europe&day_range=7&pageToken=tok') {
    pass('buildWorkableJobsUrl() encodes query, filters and page token');
  } else {
    fail(`buildWorkableJobsUrl() returned ${url}`);
  }

  const page = {
    jobs: [
      { title: 'Head of Marketing', url: 'https://jobs.workable.com/view/a/remote-head', company: { title: 'Acme' }, workplace: 'remote', locations: ['TELECOMMUTE', 'Lisbon, Portugal'], created: '2026-10-13T09:42:55.463Z', description: '<p>Own <b>growth</b>.</p>' },
      { title: 'Head of Marketing', url: 'https://jobs.workable.com/view/b/remote-head', company: { title: 'Acme' }, workplace: 'remote', locations: ['TELECOMMUTE', 'Warsaw, Poland'] },
      { title: 'Accountant', url: 'https://jobs.workable.com/view/c/accountant', company: { title: 'Beta' }, workplace: 'on_site', locations: ['Athens, Greece'] },
      { title: 'Phish', url: 'https://evil.example/view/d', company: { title: 'Evil' } },
      { title: '', url: 'https://jobs.workable.com/view/e' },
      null,
    ],
  };
  const jobs = parseWorkableJobsResponse(page);
  const [head, accountant] = jobs;
  if (jobs.length === 2 && head.location === 'Remote — Lisbon, Portugal; Warsaw, Poland' && head.url.endsWith('/a/remote-head')) {
    pass('parseWorkableJobsResponse() collapses one role posted in several countries');
  } else {
    fail(`parseWorkableJobsResponse() returned ${JSON.stringify(jobs)}`);
  }
  if (head.postedAt === Date.parse('2026-10-13T09:42:55.463Z') && head.description.startsWith('Own growth') && !('workplace' in head) && accountant.location === 'On-site — Athens, Greece') {
    pass('parseWorkableJobsResponse() maps date, plain-text description and workplace label');
  } else {
    fail(`parseWorkableJobsResponse() fields: ${JSON.stringify(jobs)}`);
  }

  const calls = [];
  const pages = {
    '': { jobs: [page.jobs[0]], nextPageToken: 'p2' },
    p2: { jobs: [page.jobs[1], page.jobs[2]], nextPageToken: 'p3' },
    p3: { jobs: [], nextPageToken: '' },
  };
  const ctx = {
    fetchJson: async (u) => { calls.push(u); return pages[new URL(u).searchParams.get('pageToken') || '']; },
    sleep: async () => {},
  };
  const fetched = await provider.fetch({ name: 'W', workable_jobs: { keywords: ['marketing'], max_pages: 5 } }, ctx);
  if (calls.length === 3 && fetched.length === 2) pass('fetch() follows nextPageToken and dedups the same role across pages');
  else fail(`fetch() made ${calls.length} calls and returned ${fetched.length} jobs`);

  calls.length = 0;
  await provider.fetch({ name: 'W', workable_jobs: { keywords: ['marketing'], max_pages: 5 } }, { ...ctx, maxPages: 1 });
  if (calls.length === 1) pass('fetch() honours ctx.maxPages');
  else fail(`fetch() with maxPages hint made ${calls.length} calls`);
} catch (err) {
  fail(`workable-jobs provider test threw: ${err.message}`);
}
