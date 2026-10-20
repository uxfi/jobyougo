// Non-regression: Traffit / d.vinci / HireHive wired into autodetect + ATS explorer,
// existing ATS behaviour unchanged. Offline fixtures only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectAtsProvider } from '../lib/ats-autodetect.mjs';
import { jobBoardProviders } from '../lib/scan-job-boards.mjs';
import { extractAtsSlugs, boardEndpoints, verifyBoard, hasTraffitMarkers, runAtsExplorer, EXPLORER_SITES } from '../lib/ats-explorer.mjs';

test('autodetect routes the new hosts and still routes the old ones', () => {
  const cases = [['traffit', 'https://acme.traffit.com/career/'], ['dvinci', 'https://acme.dvinci-hr.com/de/jobs'], ['hirehive', 'https://acme.hirehive.com/'],
    ['recruitee', 'https://acme.recruitee.com'], ['pinpoint', 'https://acme.pinpointhq.com'], ['softgarden', 'https://acme.softgarden.io/']];
  for (const [id, url] of cases) assert.equal(detectAtsProvider({ name: 'Acme', careers_url: url }, jobBoardProviders), id, url);
  for (const url of ['http://acme.traffit.com', 'https://acme.traffit.com.evil.io/', 'https://www.hirehive.com/', 'https://evil.com/acme.dvinci-hr.com']) {
    assert.equal(detectAtsProvider({ name: 'x', careers_url: url }, jobBoardProviders), '', url);
  }
});

test('explorer extracts the new ATS slugs, skips vendor hosts, old ATS unchanged', () => {
  const got = extractAtsSlugs([
    'https://acme.traffit.com/public/an/abc', 'https://cdn3.traffit.com/x.js', 'https://knowledge.traffit.com/a', 'https://www.traffit.com/',
    'https://beta.dvinci-hr.com/de/jobs/1/x', 'https://static.dvinci-hr.com/a', 'https://gamma.hirehive.com/job-x', 'https://status.hirehive.com',
    'https://eta.recruitee.com/o/x', 'https://iota.teamtailor.com/jobs/1',
  ]).map(x => `${x.ats}:${x.slug}`).sort();
  assert.deepEqual(got, ['dvinci:beta', 'hirehive:gamma', 'recruitee:eta', 'teamtailor:iota', 'traffit:acme']);
  assert.deepEqual(EXPLORER_SITES, ['jobs.ashbyhq.com', 'job-boards.greenhouse.io', 'jobs.lever.co', 'apply.workable.com', 'recruitee.com', 'jobs.personio.de', 'teamtailor.com', 'jobs.smartrecruiters.com'], 'active query rotation unchanged');
});

test('Traffit HTML markers are recognised', () => {
  for (const html of ['<script src="https://cdn3.traffit.com/x.js">', '<div class="traffit-an-list">', '<div data-name="traffit">', '<script src="https://acme.traffit.com/public/an/generateJs?x">']) assert.ok(hasTraffitMarkers(html), html);
  assert.equal(hasTraffitMarkers('<html>careers</html>'), false);
  assert.equal(hasTraffitMarkers(null), false);
});

test('verifyBoard reads the new public endpoints (Traffit page headers, awarded skipped)', async () => {
  const seen = [];
  const fetchImpl = async (url, opts) => {
    seen.push({ url, headers: opts.headers });
    if (url.includes('traffit')) return { status: 200, text: async () => JSON.stringify([{ advert: { name: 'Software Engineer' }, awarded: false }, { advert: { name: 'Old Role' }, awarded: true }]) };
    if (url.includes('dvinci')) return { status: 200, text: async () => JSON.stringify([{ position: 'Data Engineer' }]) };
    return { status: 200, text: async () => JSON.stringify({ meta: {}, items: [{ title: 'Product Designer' }] }) };
  };
  assert.deepEqual((await verifyBoard({ ats: 'traffit', slug: 'acme' }, { fetchImpl })).titles, ['Software Engineer']);
  assert.equal(seen[0].url, 'https://acme.traffit.com/public/job_posts/published');
  assert.equal(seen[0].headers['X-Request-Current-Page'], '1');
  assert.deepEqual((await verifyBoard({ ats: 'dvinci', slug: 'acme' }, { fetchImpl })).titles, ['Data Engineer']);
  assert.deepEqual((await verifyBoard({ ats: 'hirehive', slug: 'acme' }, { fetchImpl })).titles, ['Product Designer']);
  assert.equal(seen[1].headers['X-Request-Current-Page'], undefined, 'page headers only for Traffit');
  assert.equal(boardEndpoints('hirehive', 'acme').careers_url, 'https://acme.hirehive.com/');
  assert.equal(boardEndpoints('recruitee', 'acme').probe, 'https://acme.recruitee.com/api/offers/');
});

test('explorer adds a verified Traffit board end-to-end (passive input)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ats-new-'));
  const portalsPath = join(dir, 'portals.yml');
  writeFileSync(portalsPath, 'tracked_companies:\n  - name: Old\n    careers_url: https://old.traffit.com/career/\n    enabled: false\n');
  const fetchImpl = async () => ({ status: 200, text: async () => JSON.stringify([{ advert: { name: 'Senior Product Designer' }, awarded: false }, { advert: { name: 'Frontend Engineer' }, awarded: false }]) });
  const s = await runAtsExplorer({ portalsPath, dataDir: join(dir, 'data'), offerUrls: ['https://acme.traffit.com/public/an/1', 'https://old.traffit.com/public/an/2'], fetchImpl, log: () => {}, env: {} });
  assert.equal(s.added, 1);
  const text = readFileSync(portalsPath, 'utf8');
  assert.match(text, /careers_url: https:\/\/acme\.traffit\.com\/career\//);
  assert.equal((text.match(/old\.traffit/g) || []).length, 1, 'disabled entry not duplicated');
});
