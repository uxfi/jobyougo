// tests/providers/huggingface-openapply.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — huggingface-openapply');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/huggingface-openapply.mjs')).href);
  const openapply = mod.default;
  const { parseOpenApplyConfig, buildOpenApplyRowsUrl, stripOpenApplyHtml, normalizeOpenApplyRow } = mod;

  if (openapply.id === 'huggingface-openapply') pass('huggingface-openapply.id is "huggingface-openapply"');
  else fail(`huggingface-openapply.id is ${JSON.stringify(openapply.id)}`);

  const hit = openapply.detect({ provider: 'huggingface-openapply' });
  if (hit?.url?.startsWith('https://datasets-server.huggingface.co/rows?')) pass('detect() claims explicit provider entries');
  else fail(`detect() = ${JSON.stringify(hit)}`);

  const cfg = parseOpenApplyConfig({
    huggingface_openapply: { keywords: [' AI ', '', 7, 'Product'], remote_only: false, length: 999, max_pages: 999 },
  });
  if (JSON.stringify(cfg.keywords) === JSON.stringify(['AI', 'Product']) && cfg.remoteOnly === false && cfg.length === 100 && cfg.maxPages === 20) {
    pass('parseOpenApplyConfig trims keywords and clamps row paging');
  } else {
    fail(`parseOpenApplyConfig = ${JSON.stringify(cfg)}`);
  }

  const rowsUrl = new URL(buildOpenApplyRowsUrl({ offset: 200, length: 50 }));
  if (
    rowsUrl.hostname === 'datasets-server.huggingface.co'
    && rowsUrl.searchParams.get('dataset') === 'edwarddgao/open-apply-jobs'
    && rowsUrl.searchParams.get('offset') === '200'
    && rowsUrl.searchParams.get('length') === '50'
  ) {
    pass('buildOpenApplyRowsUrl() pins the dataset-server rows endpoint');
  } else {
    fail(`buildOpenApplyRowsUrl() = ${rowsUrl.href}`);
  }

  if (stripOpenApplyHtml('<script>x</script><p>Build &amp; launch</p>') === 'Build & launch') {
    pass('stripOpenApplyHtml() strips markup and decodes entities');
  } else {
    fail(`stripOpenApplyHtml() = ${JSON.stringify(stripOpenApplyHtml('<p>x</p>'))}`);
  }

  const row = {
    id: 'ashby:acme:1',
    source_slug: 'acme-ai',
    title: ' AI Product Manager ',
    apply_url: 'https://jobs.ashbyhq.com/acme/1',
    description_html: '<p>Build remote AI products</p>',
    department: 'Product',
    locations: ['Remote', 'Europe'],
    posted_at: '2026-09-01T12:00:00Z',
    salary_min: 90000,
    salary_max: 120000,
    salary_currency: 'eur',
  };
  const norm = normalizeOpenApplyRow(row);
  if (
    norm?.title === 'AI Product Manager'
    && norm.url === 'https://jobs.ashbyhq.com/acme/1'
    && norm.company === 'Acme Ai'
    && norm.location === 'Remote, Europe'
    && norm.description === 'Build remote AI products'
    && norm.postedAt === Date.parse('2026-09-01T12:00:00Z')
    && norm.salary?.min === 90000
    && norm.salary?.max === 120000
    && norm.salary?.currency === 'EUR'
  ) {
    pass('normalizeOpenApplyRow() maps dataset fields into the Job shape');
  } else {
    fail(`normalizeOpenApplyRow() = ${JSON.stringify(norm)}`);
  }
  if (normalizeOpenApplyRow({ ...row, apply_url: 'http://jobs.ashbyhq.com/acme/1' }) === null) {
    pass('normalizeOpenApplyRow() rejects non-https apply URLs');
  } else {
    fail('normalizeOpenApplyRow() should reject non-https URLs');
  }

  const calls = [];
  const fetched = await openapply.fetch(
    { name: 'HF', huggingface_openapply: { keywords: ['AI'], remote_only: true, length: 2, max_pages: 2 } },
    {
      fetchJson: async (url) => {
        calls.push(url);
        const offset = Number(new URL(url).searchParams.get('offset'));
        return {
          rows: offset === 0
            ? [
                { row },
                { row: { ...row, apply_url: 'https://jobs.ashbyhq.com/acme/1' } },
              ]
            : [
                { row: { ...row, title: 'Onsite AI PM', apply_url: 'https://jobs.ashbyhq.com/acme/2', locations: ['Paris'], description_html: '<p>Office role</p>' } },
              ],
        };
      },
    },
  );
  if (fetched.length === 1 && fetched[0].url === 'https://jobs.ashbyhq.com/acme/1' && calls.length === 2) {
    pass('huggingface-openapply.fetch() pages, filters remote hits, and dedups URLs');
  } else {
    fail(`huggingface-openapply.fetch() result=${JSON.stringify(fetched)}, calls=${calls.length}`);
  }
} catch (e) {
  fail(`huggingface-openapply provider tests crashed: ${e.message}`);
}
