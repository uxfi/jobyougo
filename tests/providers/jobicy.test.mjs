// tests/providers/jobicy.test.mjs — moved verbatim from test-all.mjs (#1440).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — jobicy');

try {
  const jobicyModule = await import(pathToFileURL(join(ROOT, 'providers/jobicy.mjs')).href);
  const jobicy = jobicyModule.default;
  const { parseJobicyResponse } = jobicyModule;

  if (jobicy.id === 'jobicy') pass('jobicy.id is "jobicy"');
  else fail(`jobicy.id is ${JSON.stringify(jobicy.id)}`);

  const hit = jobicy.detect({ name: 'Jobicy Board', provider: 'jobicy' });
  if (hit && hit.url === 'https://jobicy.com/api/v2/remote-jobs?count=50') {
    pass('jobicy.detect() claims explicit provider config');
  } else {
    fail(`jobicy.detect() returned ${JSON.stringify(hit)}`);
  }

  if (jobicy.detect({ name: 'Remote Board', provider: 'remoteok' }) === null) {
    pass('jobicy.detect() ignores other provider ids');
  } else {
    fail('jobicy.detect() should only claim provider: jobicy');
  }

  const sample = {
    jobs: [
      {
        jobTitle: 'Senior AI Engineer',
        companyName: 'Acme Corp',
        jobGeo: 'Worldwide',
        url: 'https://jobicy.com/jobs/senior-ai-engineer',
        pubDate: '2026-06-27T10:00:00',
      },
      {
        jobTitle: 'Staff Backend Developer',
        companyName: 'Globex',
        jobGeo: 'Europe',
        url: 'https://jobicy.com/jobs/staff-backend-developer',
        pubDate: '2026-06-25T12:00:00Z',
      },
      {
        jobTitle: 'Role With Missing URL',
        companyName: 'Incomplete',
        jobGeo: 'USA',
        pubDate: '2026-06-24T08:00:00Z',
      },
      {
        jobTitle: 'Role With Invalid URL',
        companyName: 'Invalid',
        url: 'not-a-valid-url',
        jobGeo: 'USA',
      },
      {
        jobTitle: '',
        companyName: 'Empty Title',
        url: 'https://jobicy.com/jobs/empty-title',
        jobGeo: 'USA',
      }
    ]
  };

  const jobs = parseJobicyResponse(sample, 'Jobicy Board');

  if (jobs.length === 2) pass('parseJobicyResponse keeps 2 jobs (drops missing/invalid url and empty title)');
  else fail(`parseJobicyResponse returned ${jobs.length} jobs (expected 2)`);

  if (jobs[0]?.company === 'Acme Corp' && jobs[0]?.title === 'Senior AI Engineer') {
    pass('parseJobicyResponse maps jobTitle -> title, companyName -> company');
  } else {
    fail(`row 0 title/company = ${JSON.stringify({ title: jobs[0]?.title, company: jobs[0]?.company })}`);
  }

  if (jobs[0]?.url === 'https://jobicy.com/jobs/senior-ai-engineer') {
    pass('parseJobicyResponse maps url to url');
  } else {
    fail(`row 0 url = ${JSON.stringify(jobs[0]?.url)}`);
  }

  if (jobs[0]?.location === 'Worldwide') {
    pass('parseJobicyResponse maps jobGeo to location');
  } else {
    fail(`row 0 location = ${JSON.stringify(jobs[0]?.location)}`);
  }

  if (jobs[0]?.postedAt === Date.parse('2026-06-27T10:00:00')) {
    pass('parseJobicyResponse parses pubDate -> postedAt');
  } else {
    fail(`row 0 postedAt = ${JSON.stringify(jobs[0]?.postedAt)}`);
  }

  if (jobs[1]?.company === 'Globex' && jobs[1]?.title === 'Staff Backend Developer') {
    pass('parseJobicyResponse parses second job correctly');
  } else {
    fail(`row 1 = ${JSON.stringify(jobs[1])}`);
  }

  if (parseJobicyResponse('', 'X').length === 0 && parseJobicyResponse(null, 'X').length === 0) {
    pass('parseJobicyResponse empty / non-object payload -> empty result (no crash)');
  } else {
    fail('parseJobicyResponse empty / non-object payload should yield empty result');
  }

  let capturedUrl = null;
  let capturedOpts = null;
  const fetched = await jobicy.fetch(
    { name: 'Jobicy Board', provider: 'jobicy' },
    { fetchJson: async (url, opts) => { capturedUrl = url; capturedOpts = opts; return sample; } },
  );

  if (capturedUrl === 'https://jobicy.com/api/v2/remote-jobs?count=50') {
    pass('jobicy.fetch() requests the pinned JSON feed URL');
  } else {
    fail(`jobicy.fetch() requested ${JSON.stringify(capturedUrl)}`);
  }

  if (capturedOpts && capturedOpts.redirect === 'error') {
    pass('jobicy.fetch() passes redirect:"error" to fetchJson');
  } else {
    fail(`jobicy.fetch() should pass redirect:"error", got: ${JSON.stringify(capturedOpts)}`);
  }

  if (fetched[0]?.company === 'Acme Corp' && fetched[0]?.title === 'Senior AI Engineer') {
    pass('provider: jobicy config returns normalized jobs');
  } else {
    fail(`jobicy.fetch() normalized row = ${JSON.stringify(fetched[0])}`);
  }

  // Server-side narrowing: industry / tag / geo / count from a `jobicy:` block
  // (or flat keys) land on the feed URL; the bare entry keeps the old URL.
  const { buildJobicyUrl } = jobicyModule;
  const narrowed = buildJobicyUrl({ provider: 'jobicy', jobicy: { industry: 'design-multimedia', geo: 'europe', count: 500 } });
  if (narrowed === 'https://jobicy.com/api/v2/remote-jobs?count=100&industry=design-multimedia&geo=europe') {
    pass('buildJobicyUrl() applies industry/geo and clamps count to 100');
  } else {
    fail(`buildJobicyUrl() returned ${narrowed}`);
  }
  const flat = buildJobicyUrl({ provider: 'jobicy', tag: ' product ' });
  if (flat === 'https://jobicy.com/api/v2/remote-jobs?count=50&tag=product') pass('buildJobicyUrl() accepts flat keys and trims the tag');
  else fail(`buildJobicyUrl() flat returned ${flat}`);
  let shortTagThrew = false;
  try { buildJobicyUrl({ jobicy: { tag: 'ux' } }); } catch { shortTagThrew = true; }
  if (shortTagThrew) pass('buildJobicyUrl() rejects a tag shorter than 3 characters (server 400)');
  else fail('buildJobicyUrl() should reject a 2-character tag');
  const detected = jobicy.detect({ provider: 'jobicy', jobicy: { industry: 'design-multimedia' } });
  if (detected?.url === 'https://jobicy.com/api/v2/remote-jobs?count=50&industry=design-multimedia') pass('jobicy.detect() reports the narrowed feed URL');
  else fail(`jobicy.detect() narrowed returned ${JSON.stringify(detected)}`);
  let narrowedUrl = null;
  await jobicy.fetch({ name: 'Jobicy Design', provider: 'jobicy', jobicy: { industry: 'design-multimedia' } }, { fetchJson: async (url) => { narrowedUrl = url; return sample; } });
  if (narrowedUrl === 'https://jobicy.com/api/v2/remote-jobs?count=50&industry=design-multimedia') pass('jobicy.fetch() requests the narrowed feed URL');
  else fail(`jobicy.fetch() narrowed requested ${JSON.stringify(narrowedUrl)}`);

} catch (e) {
  fail(`jobicy provider tests crashed: ${e.message}`);
}
