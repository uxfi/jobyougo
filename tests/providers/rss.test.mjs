// tests/providers/rss.test.mjs — generic allowlisted RSS/Atom provider.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — rss');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/rss.mjs')).href);
  const rss = mod.default;
  const { parseGenericRssFeed, splitTitle, resolveFeedUrl } = mod;

  if (rss.id === 'rss') pass('rss.id is "rss"');
  else fail(`rss.id is ${JSON.stringify(rss.id)}`);

  if (rss.detect({ provider: 'rss', api: 'https://cryptojobslist.com/rss' })?.url ===
      'https://cryptojobslist.com/rss') {
    pass('rss.detect() claims allowlisted api feed');
  } else {
    fail('rss.detect() should claim provider:rss + allowlisted api');
  }

  if (rss.detect({ provider: 'remoteok' }) === null) {
    pass('rss.detect() ignores other provider ids');
  } else {
    fail('rss.detect() should only claim provider: rss');
  }

  if (rss.detect({ provider: 'rss', api: 'https://evil.example/feed.xml' }) === null) {
    pass('rss.detect() rejects non-allowlisted hosts');
  } else {
    fail('rss.detect() must not claim untrusted hosts');
  }

  let threw = false;
  try {
    resolveFeedUrl({ api: 'http://cryptojobslist.com/rss' });
  } catch {
    threw = true;
  }
  if (threw) pass('resolveFeedUrl rejects non-HTTPS feeds');
  else fail('resolveFeedUrl should reject http:// feeds');

  if (splitTitle('Senior PM at Acme', 'Board').company === 'Acme' &&
      splitTitle('Acme: Design Lead', 'Board').title === 'Design Lead') {
    pass('splitTitle handles "at" and "Company: Role" shapes');
  } else {
    fail(`splitTitle unexpected: ${JSON.stringify(splitTitle('Senior PM at Acme', 'Board'))}`);
  }

  const sample = `<?xml version="1.0"?><rss><channel>
    <item>
      <title><![CDATA[Product Designer at SafetyWing]]></title>
      <link>https://www.realworkfromanywhere.com/jobs/product-designer-safetywing-3918</link>
      <pubDate>Mon, 01 Sep 2025 12:00:00 GMT</pubDate>
      <description><![CDATA[Remote worldwide]]></description>
    </item>
    <item>
      <title>No link item</title>
    </item>
    <entry>
      <title>Atom Role at Beta</title>
      <link href="https://jobs.ashbyhq.com/beta/abc"/>
      <published>2025-09-02T10:00:00Z</published>
    </entry>
  </channel></rss>`;

  const jobs = parseGenericRssFeed(sample, 'RWFA');
  if (jobs.length === 2) pass('parseGenericRssFeed keeps 2 items (drops link-less)');
  else fail(`parseGenericRssFeed returned ${jobs.length}, expected 2`);

  if (jobs[0]?.title === 'Product Designer' && jobs[0]?.company === 'SafetyWing' &&
      jobs[0]?.url.includes('realworkfromanywhere.com')) {
    pass('parseGenericRssFeed splits title and keeps feed link');
  } else {
    fail(`row0 = ${JSON.stringify(jobs[0])}`);
  }

  if (jobs[1]?.url === 'https://jobs.ashbyhq.com/beta/abc' && jobs[1]?.company === 'Beta') {
    pass('parseGenericRssFeed reads Atom href links to employer ATS');
  } else {
    fail(`row1 = ${JSON.stringify(jobs[1])}`);
  }

  if (typeof jobs[0]?.postedAt === 'number' && Number.isFinite(jobs[0].postedAt)) {
    pass('parseGenericRssFeed parses pubDate');
  } else {
    fail(`postedAt = ${JSON.stringify(jobs[0]?.postedAt)}`);
  }
} catch (err) {
  fail(`rss provider test crashed: ${err.message}`);
}
