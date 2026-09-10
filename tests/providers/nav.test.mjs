// tests/providers/nav.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — nav');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/nav.mjs')).href);
  const nav = mod.default;
  const { parseNavConfig, extractPublicToken, normalizeNavFeedItem, normalizeNavDetail } = mod;

  if (nav.id === 'nav') pass('nav.id is "nav"');
  else fail(`nav.id is ${JSON.stringify(nav.id)}`);

  const hit = nav.detect({ provider: 'nav' });
  if (hit?.url === 'https://pam-stilling-feed.nav.no/api/v1/feed') pass('nav.detect() claims explicit provider entries');
  else fail(`nav.detect() = ${JSON.stringify(hit)}`);

  const cfg = parseNavConfig({
    nav: { keywords: [' AI ', '', 42, 'Product'], modified_since_days: 999, max_pages: 999, detail_limit: 999, fetch_details: false },
  });
  if (
    JSON.stringify(cfg.keywords) === JSON.stringify(['AI', 'Product'])
    && cfg.modifiedSinceDays === 183
    && cfg.maxPages === 50
    && cfg.detailLimit === 100
    && cfg.fetchDetails === false
  ) {
    pass('parseNavConfig trims keywords and clamps feed/detail caps');
  } else {
    fail(`parseNavConfig = ${JSON.stringify(cfg)}`);
  }

  const token = extractPublicToken('Current public token:\n\neyJabc.def.ghi\n');
  if (token === 'eyJabc.def.ghi') pass('extractPublicToken() extracts the JWT line');
  else fail(`extractPublicToken() = ${JSON.stringify(token)}`);
  let tokenThrew = false;
  try { extractPublicToken('no jwt here'); } catch { tokenThrew = true; }
  if (tokenThrew) pass('extractPublicToken() throws when no JWT is present');
  else fail('extractPublicToken() should throw without a JWT');

  const header = normalizeNavFeedItem({
    id: 'uuid-1',
    url: '/api/v1/feedentry/uuid-1',
    title: 'Fallback title',
    date_modified: '2026-08-05T07:03:29.811434+02:00',
    content_text: 'Stillingsannonse',
    _feed_entry: {
      uuid: 'uuid-1',
      status: 'ACTIVE',
      title: 'AI Product Lead',
      businessName: 'Acme AS',
      municipal: 'OSLO',
    },
  });
  if (
    header?.title === 'AI Product Lead'
    && header.url === 'https://arbeidsplassen.nav.no/stillinger/stilling/uuid-1'
    && header.company === 'Acme AS'
    && header.location === 'OSLO, Norway'
    && header.postedAt === Date.parse('2026-08-05T07:03:29.811434+02:00')
  ) {
    pass('normalizeNavFeedItem() maps ACTIVE feed items to header jobs');
  } else {
    fail(`normalizeNavFeedItem() = ${JSON.stringify(header)}`);
  }
  if (normalizeNavFeedItem({ _feed_entry: { status: 'INACTIVE', title: 'X', uuid: 'x' } }) === null) {
    pass('normalizeNavFeedItem() drops inactive feed entries');
  } else {
    fail('normalizeNavFeedItem() should drop inactive entries');
  }

  const detail = normalizeNavDetail({
    status: 'ACTIVE',
    ad_content: {
      title: 'AI Product Lead',
      published: '2026-08-04T09:27:04+02:00',
      description: '<p>Build &amp; launch AI products</p>',
      applicationUrl: 'https://example.com/apply',
      employer: { name: 'Acme Detail AS' },
      workLocations: [{ city: 'OSLO', county: 'OSLO', country: 'NORGE' }],
    },
  }, header);
  if (
    detail.title === 'AI Product Lead'
    && detail.url === 'https://example.com/apply'
    && detail.company === 'Acme Detail AS'
    && detail.location === 'OSLO, OSLO, Norway'
    && detail.description === 'Build & launch AI products'
    && detail.postedAt === Date.parse('2026-08-04T09:27:04+02:00')
  ) {
    pass('normalizeNavDetail() enriches URL/company/location/description/date');
  } else {
    fail(`normalizeNavDetail() = ${JSON.stringify(detail)}`);
  }

  const calls = [];
  const fetched = await nav.fetch(
    { name: 'NAV', nav: { keywords: ['AI'], max_pages: 2, detail_limit: 1 } },
    {
      fetchText: async (url) => {
        calls.push(url);
        return 'Current public token:\neyJtoken.part.sig';
      },
      fetchJson: async (url) => {
        calls.push(url);
        if (url.endsWith('/api/v1/feed')) {
          return {
            items: [
              {
                id: 'a',
                url: '/api/v1/feedentry/a',
                _feed_entry: { uuid: 'a', status: 'ACTIVE', title: 'AI Product Manager', businessName: 'Acme', municipal: 'OSLO' },
              },
              {
                id: 'b',
                url: '/api/v1/feedentry/b',
                _feed_entry: { uuid: 'b', status: 'ACTIVE', title: 'Chef', businessName: 'Kitchen', municipal: 'BERGEN' },
              },
            ],
            next_url: '/api/v1/feed/page-2',
          };
        }
        if (url.endsWith('/api/v1/feed/page-2')) return { items: [], next_url: null };
        if (url.endsWith('/api/v1/feedentry/a')) {
          return { ad_content: { title: 'AI Product Manager', applicationUrl: 'https://example.com/a', employer: { name: 'Acme' } } };
        }
        throw new Error(`unexpected ${url}`);
      },
    },
  );
  if (fetched.length === 1 && fetched[0].url === 'https://example.com/a' && calls.some(u => u.endsWith('/api/v1/feedentry/a'))) {
    pass('nav.fetch() uses the public token, filters ACTIVE keyword hits, and enriches bounded details');
  } else {
    fail(`nav.fetch() result=${JSON.stringify(fetched)}, calls=${JSON.stringify(calls)}`);
  }
} catch (e) {
  fail(`nav provider tests crashed: ${e.message}`);
}
