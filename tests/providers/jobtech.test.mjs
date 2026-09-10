// tests/providers/jobtech.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — jobtech');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/jobtech.mjs')).href);
  const jobtech = mod.default;
  const { parseJobtechConfig, buildJobtechSearchUrl, normalizeJobtechLocation, normalizeJobtechJob } = mod;

  if (jobtech.id === 'jobtech') pass('jobtech.id is "jobtech"');
  else fail(`jobtech.id is ${JSON.stringify(jobtech.id)}`);

  const hit = jobtech.detect({ provider: 'jobtech' });
  if (hit?.url === 'https://jobsearch.api.jobtechdev.se/search') pass('jobtech.detect() claims explicit provider entries');
  else fail(`jobtech.detect() = ${JSON.stringify(hit)}`);
  if (jobtech.detect({ provider: 'remoteok' }) === null) pass('jobtech.detect() ignores other providers');
  else fail('jobtech.detect() should ignore other providers');

  const cfg = parseJobtechConfig({
    jobtech: { keywords: [' AI ', '', 7, 'Product Manager', 'AI'], remote: true, limit: 999, max_pages: 999 },
  });
  if (JSON.stringify(cfg.keywords) === JSON.stringify(['AI', 'Product Manager']) && cfg.remote === true && cfg.limit === 100 && cfg.maxPages === 50) {
    pass('parseJobtechConfig trims/dedups keywords and clamps limits');
  } else {
    fail(`parseJobtechConfig = ${JSON.stringify(cfg)}`);
  }

  const url = new URL(buildJobtechSearchUrl({ q: 'AI Product', remote: true, limit: 50, offset: 100 }));
  if (
    url.hostname === 'jobsearch.api.jobtechdev.se'
    && url.searchParams.get('q') === 'AI Product'
    && url.searchParams.get('remote') === 'true'
    && url.searchParams.get('limit') === '50'
    && url.searchParams.get('offset') === '100'
  ) {
    pass('buildJobtechSearchUrl() builds the pinned search URL');
  } else {
    fail(`buildJobtechSearchUrl() = ${url.href}`);
  }

  const loc = normalizeJobtechLocation({
    workplace_model: { label: 'Distansarbete' },
    workplace_addresses: [
      { city: 'Stockholm', region: 'Stockholm County', country: 'Sweden' },
      { city: 'Malmo', country: 'Sweden' },
    ],
  });
  if (loc === 'Remote / Stockholm, Stockholm County, Sweden / Malmo, Sweden') pass('normalizeJobtechLocation() combines remote model and addresses');
  else fail(`normalizeJobtechLocation() = ${JSON.stringify(loc)}`);

  const norm = normalizeJobtechJob({
    headline: ' AI Product Manager ',
    webpage_url: 'https://arbetsformedlingen.se/platsbanken/annonser/123',
    employer: { name: ' Acme ' },
    description: { text: 'Build AI products' },
    publication_date: '2026-09-01T12:00:00Z',
    workplace_address: { city: 'Stockholm', country: 'Sweden' },
  });
  if (
    norm?.title === 'AI Product Manager'
    && norm.company === 'Acme'
    && norm.location === 'Stockholm, Sweden'
    && norm.description === 'Build AI products'
    && norm.postedAt === Date.parse('2026-09-01T12:00:00Z')
  ) {
    pass('normalizeJobtechJob() maps API fields to the Job shape');
  } else {
    fail(`normalizeJobtechJob() = ${JSON.stringify(norm)}`);
  }
  if (normalizeJobtechJob({ headline: '', webpage_url: 'https://x.test' }) === null
      && normalizeJobtechJob({ headline: 'X', webpage_url: 'http://example.com/x' }) === null) {
    pass('normalizeJobtechJob() drops missing titles and non-https URLs');
  } else {
    fail('normalizeJobtechJob() should drop invalid rows');
  }

  const mkHit = (id, title) => ({
    id,
    headline: title,
    webpage_url: `https://arbetsformedlingen.se/platsbanken/annonser/${id}`,
    employer: { name: 'Co' },
    workplace_address: { city: 'Stockholm', country: 'Sweden' },
  });
  const calls = [];
  const fetched = await jobtech.fetch(
    { name: 'JobTech', jobtech: { keywords: ['AI', 'Design'], limit: 2, max_pages: 2 } },
    {
      fetchJson: async (url) => {
        calls.push(url);
        const sp = new URL(url).searchParams;
        const q = sp.get('q');
        const offset = Number(sp.get('offset'));
        if (q === 'AI' && offset === 0) return { total: { value: 3 }, hits: [mkHit(1, 'AI PM'), mkHit(2, 'AI Designer')] };
        if (q === 'AI' && offset === 2) return { total: { value: 3 }, hits: [mkHit(3, 'AI Lead')] };
        if (q === 'Design') return { total: { value: 1 }, hits: [mkHit(2, 'AI Designer')] };
        return { total: { value: 0 }, hits: [] };
      },
    },
  );
  if (fetched.length === 3 && new Set(fetched.map(j => j.url)).size === 3 && calls.length === 3) {
    pass('jobtech.fetch() paginates per keyword and dedups by URL');
  } else {
    fail(`jobtech.fetch() result=${JSON.stringify(fetched)}, calls=${calls.length}`);
  }
} catch (e) {
  fail(`jobtech provider tests crashed: ${e.message}`);
}
