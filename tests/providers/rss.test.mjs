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

  // Dribbble's feed shape: "{Company} is hiring for a position of {Role} in {Place}".
  const hiring = splitTitle('Phillips & Associates is hiring for a position of In House Web Developer in Miami or New York', 'Dribbble');
  if (hiring.company === 'Phillips & Associates' && hiring.title === 'In House Web Developer' && hiring.location === 'Miami or New York') {
    pass('splitTitle parses the "is hiring for a position of … in …" shape');
  } else {
    fail(`splitTitle hiring shape: ${JSON.stringify(hiring)}`);
  }
  const hiringNoPlace = splitTitle('Acme is hiring a Senior Product Designer', 'Board');
  if (hiringNoPlace.company === 'Acme' && hiringNoPlace.title === 'Senior Product Designer' && !hiringNoPlace.location) {
    pass('splitTitle parses "is hiring a {Role}" without a place');
  } else {
    fail(`splitTitle hiring (no place): ${JSON.stringify(hiringNoPlace)}`);
  }

  if (rss.detect({ provider: 'rss', api: 'https://dribbble.com/jobs.rss' })?.url === 'https://dribbble.com/jobs.rss' &&
      rss.detect({ provider: 'rss', api: 'https://www.awwwards.com/jobs/feed/' })?.url === 'https://www.awwwards.com/jobs/feed/') {
    pass('rss.detect() allowlists the Dribbble and Awwwards job feeds');
  } else {
    fail('rss.detect() should allowlist dribbble.com and www.awwwards.com');
  }

  const dribbble = `<?xml version="1.0"?><rss xmlns:dc="http://purl.org/dc/elements/1.1/"><channel>
    <item>
      <title>Phillips &amp; Associates is hiring for a position of In House Web Developer in Miami or New York</title>
      <description><![CDATA[]]></description>
      <dc:creator>Phillips &amp; Associates</dc:creator>
      <pubDate>Thu, 08 Oct 2026 15:54:04 -0400</pubDate>
      <link>https://dribbble.com/jobs/311033-In-House-Web-Developer?source=feed</link>
    </item>
    <item>
      <title>Digital Brand Designer</title>
      <dc:creator>Roboto Studio</dc:creator>
      <link>https://www.awwwards.com/jobs/digital-brand-designer</link>
    </item>
  </channel></rss>`;
  const designJobs = parseGenericRssFeed(dribbble, 'Dribbble');
  if (designJobs[0]?.title === 'In House Web Developer' && designJobs[0]?.company === 'Phillips & Associates' && designJobs[0]?.location === 'Miami or New York') {
    pass('parseGenericRssFeed splits the Dribbble title into role, company and location');
  } else {
    fail(`parseGenericRssFeed dribbble row0 = ${JSON.stringify(designJobs[0])}`);
  }
  if (designJobs[1]?.company === 'Roboto Studio' && designJobs[1]?.title === 'Digital Brand Designer') {
    pass('parseGenericRssFeed uses dc:creator as the company when the title names none');
  } else {
    fail(`parseGenericRssFeed dc:creator row1 = ${JSON.stringify(designJobs[1])}`);
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
