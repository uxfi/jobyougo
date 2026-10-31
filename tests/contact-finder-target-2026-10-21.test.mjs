// The finder's target company comes from the offer, never from the
// candidate's own CV (Glassdoor Vertech run searched "OneAsset"). Offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { boardOwnerDisagrees, companyFromJobUrl, companyLooksLikeRole, companyNameFromJobText, ownCompanyNames, isOwnCompany, searchableCompanyName, targetCompany } from '../lib/contact-finder.mjs';

const GD = 'https://www.glassdoor.com/job-listing/ux-ui-designer-vertech-industrial-systems-JV_KO0,14_KE15,41.htm?jl=1010148788011';
const career = {
  employers: [
    '- Senior Product Designer / Product Lead : OneAsset (Feb 2026 – Present): Salaried; product lead.',
    '- Product Designer / Product Manager : UpViral (Jul 2024 – Dec 2025): SaaS marketing platform.',
    '- Freelance Senior Product Designer / UX Consultant (Aug 2016 – Present): Independent : BNP Paribas, Cdiscount.',
  ],
  sideNames: ['Creads.io', 'JobYouGo'],
};
// What a signed-in Glassdoor page reads like: the user's own header first.
const signedInText = 'Hugo V\nSenior Product Designer at OneAsset\nUX/UI Designer\nVertech Industrial Systems\nRemote';

test('Glassdoor URL: the employer from the KE range', () => {
  assert.equal(companyFromJobUrl(GD), 'Vertech Industrial Systems');
  assert.equal(companyFromJobUrl('https://jobs.ashbyhq.com/darkroom/7f7a'), '');
  assert.equal(companyFromJobUrl('not a url'), '');
});

test('own companies: employers and side projects, not the freelance client list', () => {
  const own = ownCompanyNames(career);
  assert.deepEqual(own, ['OneAsset', 'UpViral', 'Creads.io', 'JobYouGo']);
  assert.ok(isOwnCompany('oneasset', own));
  assert.ok(!isOwnCompany('Vertech Industrial Systems', own));
});

test('Vertech / OneAsset: the target is Vertech, OneAsset is rejected', () => {
  assert.equal(companyNameFromJobText(signedInText), 'OneAsset', 'the old guess, kept as is');
  const own = ownCompanyNames(career);
  const t = targetCompany({ company: '', jobUrl: GD, jobText: signedInText, own });
  assert.equal(t.company, 'Vertech Industrial Systems');
  assert.equal(t.source, 'job-url');
  const noUrl = targetCompany({ company: '', jobUrl: 'https://example-board.com/job/1', jobText: signedInText, own });
  assert.equal(noUrl.company, '', 'the own employer is never searched');
  assert.deepEqual(noUrl.rejected, ['OneAsset']);
  const given = targetCompany({ company: 'OneAsset', jobUrl: GD, jobText: '', own });
  assert.equal(given.company, 'Vertech Industrial Systems');
});

test('unchanged: a given company and the "Company:" line still win', () => {
  const own = ownCompanyNames(career);
  assert.equal(targetCompany({ company: 'Darkroom', jobUrl: GD, own }).company, 'Darkroom');
  assert.equal(targetCompany({ jobText: 'Company: Acme Corp\nDesigner', own }).company, 'Acme Corp');
  assert.equal(targetCompany({ jobText: 'Lead Designer at Mindera\nPorto', own }).company, 'Mindera');
});

// The /api/contact-finder route block, read as text (server.mjs is never imported).
function routeBlock(src) {
  const i = src.indexOf("path === '/api/contact-finder'");
  assert.ok(i > 0, 'route found');
  const end = src.indexOf('// ── SSE: stream a Qwen response', i);
  return src.slice(i, end > i ? end : i + 12000);
}

test('the server takes the target through targetCompany (no CV company fallback)', () => {
  const src = readFileSync(new URL('../ui/server.mjs', import.meta.url), 'utf8');
  const block = routeBlock(src);
  assert.match(block, /targetCompany\(\{ company, jobUrl, jobText, own \}\)/);
  assert.doesNotMatch(block, /company = companyNameFromJobText\(jobText\)/);
  // The finder only drafts: nothing is sent from the server.
  assert.doesNotMatch(block, /sendMail|send_message|smtp/i);
});

// FP6: finder searches drop the scan's recency window; the scan's own calls
// are untouched (one argument, so each engine keeps its default).
test('the finder searches with freshness none through Bing too; the scan keeps its engine calls', () => {
  const src = readFileSync(new URL('../ui/server.mjs', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf('async function contactFinderWebSearch('), src.indexOf('async function contactFinderExtractPeople('));
  assert.match(block, /const opts = \{ freshness: 'none' \}/);
  for (const fn of ['fetchPinchtabBraveSection', 'fetchPinchtabBingSection', 'fetchPinchtabSearchSection', 'fetchDuckDuckGoSection']) {
    assert.match(block, new RegExp(`${fn}\\(\\{ name, query \\}, opts\\)`), fn);
  }
  assert.match(block, /usable = results => results\.length > 0/);
  assert.match(block, /engineBackoff\.cooling\(engine\.id\)/);
  assert.doesNotMatch(block, /engineBackoff\.(?:fail|ok)\(/, 'the scan\'s rests are never written by the finder');
  const judge = src.slice(src.indexOf('async function contactFinderJudgePeople('), src.indexOf('async function draftApplicationEmailRequest('));
  assert.match(judge, /max_tokens: 400/);
  // Every engine defaults to the scan's behaviour; the scan calls them with the source alone.
  for (const fn of ['fetchPinchtabBraveSection', 'fetchPinchtabSearchSection', 'fetchDuckDuckGoSection']) {
    assert.match(src, new RegExp(`async function ${fn}\\(\\{ name, query \\}, \\{ freshness = 'auto' \\} = \\{\\}\\)`), fn);
  }
  assert.match(src, /async function fetchPinchtabBingSection\(source, \{ freshness = 'auto' \} = \{\}\)/);
  assert.match(src, /const result = await run\(source\);/);
  assert.match(src, /const duckDuckGoResult = await fetchDuckDuckGoSection\(source\);/);
  assert.match(src, /df: freshness === 'none' \? '' : webSearchFreshnessWindow\(\)\.charAt\(0\)/);
});
// FP3 hygiene: placeholders, titles and places are no company to search.
test('target names: placeholders cleaned, a place after "at" skipped, a title passed over', () => {
  assert.equal(companyNameFromJobText('Senior Designer at Paris office\nWe are hiring'), '', 'Paris is a place');
  assert.equal(companyNameFromJobText('Product Designer\nWork at Home possible'), '');
  assert.equal(companyNameFromJobText('Lead UX at Google Cloud Platform Team'), '', 'followed by "Team"');
  assert.equal(companyNameFromJobText('Designer at Paris office\nUX Lead at Mindera'), 'Mindera', 'the next "at" guess is read');

  for (const [raw, expected] of [['Stealth Startup', ''], ['?', ''], ['Confidential', ''], ['n/a', ''], ['Our client', ''], ['Acme (Stealth)', 'Acme'], ['Acme - Remote', 'Acme'], ['Chess Com', 'Chess.com'], ['Doctolib', 'Doctolib']]) {
    assert.equal(searchableCompanyName(raw), expected, raw);
  }
  assert.deepEqual(targetCompany({ company: 'Stealth Startup' }), { company: '', source: '', rejected: [] });
  assert.equal(targetCompany({ company: '?' }).company, '');
  assert.equal(targetCompany({ company: 'Acme (Stealth)' }).company, 'Acme');
  assert.deepEqual(targetCompany({ company: '?', jobUrl: 'https://jobs.ashbyhq.com/acme/1' }), { company: 'Acme', source: 'job-url', rejected: [] });

  // A job title stored as the company falls through to the board in the URL.
  assert.ok(companyLooksLikeRole('Senior Technical Product Manager'));
  assert.ok(companyLooksLikeRole('Head of Product'));
  assert.ok(companyLooksLikeRole('Designer', 'Designer'), 'the role itself');
  assert.ok(!companyLooksLikeRole('UX Design Studio'));
  assert.ok(!companyLooksLikeRole('Product Hunt'));
  assert.deepEqual(targetCompany({ company: 'Senior Technical Product Manager', jobUrl: 'https://jobs.ashbyhq.com/bjakcareer/x' }), { company: 'Bjakcareer', source: 'job-url', rejected: [] });
  assert.equal(targetCompany({ company: 'Product Designer', role: 'Product Designer', jobUrl: GD }).company, 'Vertech Industrial Systems');
});

test('own companies match without spaces or legal letters', () => {
  const own = ownCompanyNames(career);
  assert.ok(isOwnCompany('OneAsset S.A.', own));
  assert.ok(isOwnCompany('One Asset', own));
  assert.ok(!isOwnCompany('Asset', own));
  assert.equal(targetCompany({ company: 'One Asset', jobUrl: GD, own }).company, 'Vertech Industrial Systems');
});

test('board owner vs tracker company: who disagrees', () => {
  assert.ok(boardOwnerDisagrees('Lindy', 'Bjak', 'bjakcareer'));
  assert.ok(boardOwnerDisagrees('OneAsset', 'TENTENS Tech', 'tentens-tech'));
  assert.ok(boardOwnerDisagrees('x', 'Xflow', 'xflow'), 'a name with no token of its own');
  assert.ok(!boardOwnerDisagrees('DataDome', 'DataDome', 'ddome'));
  assert.ok(!boardOwnerDisagrees('Doctolib', 'Doctolib SAS', 'doctolib'));
  assert.ok(!boardOwnerDisagrees('One Asset', 'OneAsset', 'tentens'), 'one name holds the other');
  assert.ok(!boardOwnerDisagrees('Acme', 'Globex', 'acme-careers'), 'the slug carries the given name');
  assert.ok(!boardOwnerDisagrees('Acme', '', 'acme'));
});

// FP7: the route gives the page and the writer the whole result, stops on
// disconnect and replays this user's own result. Read as text, never run.
test('FP7 route: site hint, abort on close, people and mention in the contacts event, forwardTo in the draft', () => {
  const src = readFileSync(new URL('../ui/server.mjs', import.meta.url), 'utf8');
  const block = routeBlock(src);
  // ?site= (URL or bare domain) becomes findContacts' companyUrlHint and skips the cache.
  assert.match(block, /const site = cleanString\(urlObj\.searchParams\.get\('site'\)/);
  assert.match(block, /const fresh = urlObj\.searchParams\.get\('fresh'\) === '1' \|\| Boolean\(site\)/);
  assert.match(block, /findContacts\(\{ company, role, jobUrl, jobText, jobHtml, ownEmails, companyUrlHint: site \}/);
  // Closing the page aborts the run; the deadline bounds it.
  assert.match(block, /const controller = new AbortController\(\);/);
  assert.match(block, /req\.on\('close', \(\) => \{[^}]*controller\.abort\(\);/);
  assert.match(block, /signal: controller\.signal,/);
  assert.match(block, /deadlineMs: 60000,/);
  assert.match(block, /if \(found\.stopped === 'aborted'\) return finish\(\);/);
  // The contacts event: people (30 at most), the forward-to person, the site choices.
  assert.match(block, /people: peopleForPage\(found, \{ max: 30 \}\),/);
  assert.match(block, /mention: pickForwardTarget\(found\),/);
  assert.match(block, /domainChoices: found\.domainChoices \|\| \[\],/);
  assert.match(block, /company: found\.company,/, 'company carries confirmed and overridden');
  assert.match(block, /send\('contacts', event\)/);
  // The automatic draft names the person a shared inbox can forward to.
  const draftCall = block.slice(block.indexOf('await draftApplicationEmailRequest({'));
  assert.match(draftCall, /forwardTo: mention \? \{ firstName: mention\.firstName, lastName: mention\.lastName, title: mention\.title \} : null,/);
  // One summary line per run for measuring.
  assert.match(block, /console\.log\(`\[contact-finder\] summary \$\{JSON\.stringify\(\{[^`]*source: found\.company\.source[^`]*contacts: byStatus[^`]*diagnostics: found\.diagnostics/);
  // Nothing is sent from the server.
  assert.doesNotMatch(block, /sendMail|send_message|smtp/i);
  // Both helpers come from the finder module.
  assert.match(src, /import \{[^}]*\bpeopleForPage\b[^}]*\bpickForwardTarget\b[^}]*\} from '\.\.\/lib\/contact-finder\.mjs';/);
});

test('FP7 cache: this user\'s result is replayed for 6 h without a search; the draft fields stay at the top level', () => {
  const src = readFileSync(new URL('../ui/server.mjs', import.meta.url), 'utf8');
  const block = routeBlock(src);
  const start = block.indexOf('if (jobUrl && !fresh) {');
  const readPosting = block.indexOf("let jobText = '';");
  assert.ok(start > 0 && readPosting > start, 'the replay comes before the posting is read');
  const replay = block.slice(start, readPosting);
  assert.match(replay, /entry\?\.foundByUser\?\.\[userKey\]/);
  assert.match(replay, /Date\.now\(\) - mine\.at < CONTACT_FINDER_REPLAY_MS/);
  assert.match(replay, /cached: true, at: mine\.at/);
  assert.match(replay, /return finish\(\);/);
  assert.doesNotMatch(replay, /findContacts|draftApplicationEmailRequest/);
  assert.match(block, /const userKey = req\.userId \|\| 'owner';/);
  assert.match(src, /const CONTACT_FINDER_REPLAY_MS = 6 \* 60 \* 60 \* 1000;/);
  // The store: the draft route's fields at the top level, found per user.
  assert.match(block, /rememberContactFinderResult\(jobUrl, \{ jobText, jobHtml, jobUnreadable: !jobText, companyText: found\.companyText, companyDomain: found\.company\.domain \}, \{ userKey, found, asked \}\)/);
  const remember = src.slice(src.indexOf('function rememberContactFinderResult('), src.indexOf('/** The contact fields the page needs'));
  assert.match(remember, /if \(found\) foundByUser\[userKey\] = \{ found, at, asked \};/);
  assert.match(remember, /contactFinderCache\.set\(key, \{ \.\.\.value, foundByUser, at \}\)/);
  assert.match(remember, /const prev = contactFinderCache\.get\(key\);/);
  assert.match(remember, /\.\.\.\(prev\?\.foundByUser \|\| \{\}\)/, 'other users\' results survive');
  // Run as code in a sandbox: each user's result survives the other's run,
  // and the newest run's draft fields sit at the top level.
  const code = src.slice(src.indexOf('const contactFinderCache = new Map();'), src.indexOf('/** The contact fields the page needs'));
  const sandbox = { normalizeUrl: url => String(url).toLowerCase(), Date };
  vm.runInNewContext(`${code}\nthis.remember = rememberContactFinderResult; this.cache = contactFinderCache;`, sandbox);
  sandbox.remember('https://Jobs.example/1', { jobText: 'posting A', companyText: 'about A', companyDomain: 'acme.io' }, { userKey: 'owner', found: { tag: 'owner run' } });
  sandbox.remember('https://jobs.example/1', { jobText: 'posting B', companyText: 'about B', companyDomain: 'acme.io' }, { userKey: 'user-2', found: { tag: 'user-2 run' } });
  const entry = sandbox.cache.get('https://jobs.example/1');
  assert.equal(entry.jobText, 'posting B');
  assert.equal(entry.companyText, 'about B');
  assert.equal(typeof entry.at, 'number');
  assert.equal(entry.foundByUser.owner.found.tag, 'owner run');
  assert.equal(entry.foundByUser['user-2'].found.tag, 'user-2 run');
  assert.equal(entry.found, undefined, 'no shared found at the top level');
  // The page's contact keeps the finder's tags and the policy-page flag.
  const pub = src.slice(src.indexOf('function publicContact('), src.indexOf('const contactFinderPageFetcher'));
  assert.match(pub, /tags: contact\.tags \|\| \[\],/);
  assert.match(pub, /source\.flag \? \{ flag: source\.flag \} : \{\}/);
});
