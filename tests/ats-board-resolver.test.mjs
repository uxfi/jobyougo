// Board resolver (lib/ats-board-resolver.mjs): slug guesses are only kept when the
// board's own data names the company, and portals.yml is edited as text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load as yamlLoad } from 'js-yaml';
import {
  applyPortalsPatches,
  approxAccess,
  companyKey,
  domainLabels,
  findRedundantEntries,
  guessSlugs,
  judgeBoard,
  patchPortalsText,
  resolveCompanyBoard,
  runAtsBoardResolver,
  selectResolveTargets,
  BOARD_RESOLVER_DEFAULTS,
} from '../lib/ats-board-resolver.mjs';

const board = (over = {}) => ({ status: 200, titles: ['A', 'B', 'C', 'D'], name: null, sample: '', ...over });

test('company keys drop legal and generic words, not the brand', () => {
  assert.equal(companyKey('Gong.io'), 'gong');
  assert.equal(companyKey('Gong'), 'gong');
  assert.equal(companyKey('Grab Holdings Inc.'), 'grab');
  assert.equal(companyKey('Clarity AI'), 'clarity');
  assert.notEqual(companyKey('Gong Media'), companyKey('Gong'), 'a different company stays different');
  assert.equal(companyKey('Weights & Biases'), companyKey('Weights and Biases'));
  assert.equal(companyKey('AI Group'), 'aigroup', 'a name made only of generic words keeps them');
});

test('slugs come from the name and the company domain, best first', () => {
  assert.deepEqual(guessSlugs({ name: 'Clarity AI', careers_url: 'https://jobs.lever.co/clarity-ai', scan_query: 'site:clarity.ai/careers' }), ['clarity', 'clarityai', 'clarity-ai']);
  assert.deepEqual(domainLabels({ careers_url: 'https://www.twilio.com/en-us/company/jobs' }), ['twilio']);
  assert.deepEqual(domainLabels({ careers_url: 'https://www.grab.careers/en/' }), ['grab']);
  assert.deepEqual(domainLabels({ careers_url: 'https://www.acme.co.uk/jobs' }), ['acme']);
  assert.deepEqual(domainLabels({ careers_url: 'https://apply.workable.com/acme/', scan_query: '"ada.cx" OR "ada" site:jobs.ashbyhq.com' }), ['ada']);
  assert.ok(guessSlugs({ name: 'Ab' }).every(s => s.length >= 3), 'two-letter slugs are never guessed');
});

test('a board is the company\'s only when its own data says so', () => {
  const gong = { name: 'Gong', careers_url: 'https://www.gong.io/careers' };
  assert.equal(judgeBoard(gong, board({ name: 'Gong.io' })).ok, true);
  assert.deepEqual(judgeBoard(gong, board({ name: 'Gong Media' })), { ok: false, reason: 'name_mismatch', boardName: 'Gong Media' }, 'SmartRecruiters "gong" is a journalism internship');
  const wb = { name: 'Weights & Biases', scan_query: 'site:coreweave.com/careers' };
  assert.equal(judgeBoard(wb, board({ name: 'CoreWeave' })).reason, 'name_mismatch', 'the acquirer\'s board is not W&B\'s');
  // Lever and Ashby carry no name: the postings must name the company twice
  const ada = { name: 'Ada' };
  assert.deepEqual(judgeBoard(ada, board({ sample: 'About Ada. Ada builds customer service AI.' })), { ok: true, reason: 'ok', confidence: 'text', boardName: null });
  assert.equal(judgeBoard(ada, board({ sample: 'We are hiring in Toronto. Ada is mentioned once.' })).reason, 'no_identity_signal');
  assert.equal(judgeBoard(ada, board()).reason, 'no_identity_signal');
  assert.equal(judgeBoard(gong, board({ name: 'Gong', titles: ['A', 'B'] })).reason, 'small_board');
  assert.equal(judgeBoard(gong, board({ name: 'Gong', titles: [] })).reason, 'empty_board');
  assert.equal(judgeBoard(gong, { status: 404, titles: [] }).reason, 'http_404');
});

test('resolveCompanyBoard keeps the verified board and drops same-slug traps', async () => {
  const company = { name: 'Gong', careers_url: 'https://www.gong.io/careers' };
  const answers = {
    'smartrecruiters|gong': board({ name: 'Gong Media', titles: ['Journalism internship', 'Editor', 'Writer'] }),
    'recruitee|gong': board({ name: 'Gong Verlag' }),
    'greenhouse|gongio': board({ name: 'Gong.io', titles: Array.from({ length: 40 }, (_, i) => `Role ${i}`) }),
  };
  const calls = [];
  const verify = async ({ ats, slug }) => { calls.push(`${ats}|${slug}`); return answers[`${ats}|${slug}`] || { status: 404, titles: [], name: null }; };
  const res = await resolveCompanyBoard(company, { verify, hints: [{ ats: 'greenhouse', slug: 'gongio' }] });
  assert.equal(res.best.ats, 'greenhouse');
  assert.equal(res.best.slug, 'gongio');
  assert.deepEqual(res.rejected.map(r => `${r.ats}:${r.slug}=${r.verdict.reason}`).sort(), ['recruitee:gong=name_mismatch', 'smartrecruiters:gong=name_mismatch']);
  assert.equal(calls[0], 'greenhouse|gongio', 'hints are asked first');
  assert.equal(new Set(calls).size, calls.length, 'no board is asked twice');
});

test('targets: dead boards first, boards without any next, recently probed ones wait', () => {
  const tracked = [
    { name: 'Alpha', careers_url: 'https://alpha.example/careers', scan_method: 'websearch', scan_query: 'q', enabled: true },
    { name: 'Ada', careers_url: 'https://job-boards.greenhouse.io/ada', enabled: true },
    { name: 'Beta', careers_url: 'https://beta.example/jobs', enabled: true },
    { name: 'Gamma', careers_url: 'https://gamma.example/jobs', enabled: false },
    { name: 'Delta', careers_url: 'https://jobs.lever.co/delta', enabled: true },
    { name: 'Epsilon', careers_url: 'https://epsilon.example', provider: 'rss', enabled: true },
    { name: 'JobsDB — AI Roles', careers_url: 'https://jobsdb.example', enabled: true },
    { name: 'Recent', careers_url: 'https://recent.example', enabled: true },
  ];
  const now = Date.parse('2026-10-21T10:00:00Z');
  const state = { tried: { Recent: '2026-10-20T10:00:00Z', Ada: '2026-10-20T10:00:00Z' } };
  const pick = (stale) => selectResolveTargets(tracked, { stale, state, cfg: BOARD_RESOLVER_DEFAULTS, now }).map(t => `${t.why}:${t.company.name}`);
  assert.deepEqual(pick(new Map()), ['missing:Alpha', 'missing:Beta']);
  assert.deepEqual(pick(new Map([['Ada', {}]])), ['missing:Alpha', 'missing:Beta'], 'a dead board probed yesterday waits 3 days');
  assert.deepEqual(selectResolveTargets(tracked, { stale: new Map([['Ada', {}]]), state: {}, cfg: BOARD_RESOLVER_DEFAULTS, now }).map(t => `${t.why}:${t.company.name}`), ['stale:Ada', 'missing:Alpha', 'missing:Beta', 'missing:Recent']);
  assert.equal(approxAccess(tracked[1]).mode, 'api', 'a Greenhouse careers_url is already an API source');
});

test('a second entry for a company whose board is already scanned is redundant', () => {
  const tracked = [
    { name: 'Gong', careers_url: 'https://www.gong.io/careers', scan_method: 'websearch', scan_query: 'q', enabled: true },
    { name: 'Gong.io', careers_url: 'https://job-boards.greenhouse.io/gongio', api: 'https://boards-api.greenhouse.io/v1/boards/gongio/jobs', enabled: true },
    { name: 'Solo', careers_url: 'https://solo.example/jobs', enabled: true },
  ];
  assert.deepEqual(findRedundantEntries(tracked).map(r => `${r.company.name}<-${r.keeper.name}`), ['Gong<-Gong.io']);
  assert.deepEqual(findRedundantEntries(tracked, { stale: new Map([['Gong.io', {}]]) }), [], 'a dead board is no reason to switch the other entry off');
});

const PORTALS = [
  'title_filter:',
  '  positive: [Designer]',
  'tracked_companies:',
  '  # AI infra',
  '  - name: Twilio',
  '    careers_url: https://www.twilio.com/en-us/company/jobs',
  '    scan_method: websearch',
  '    scan_query: site:twilio.com/company/jobs {roles}',
  '    notes: Voice/messaging infrastructure.',
  '    enabled: true',
  '  - name: "Gong"',
  '    careers_url: https://www.gong.io/careers',
  '    provider: stale-provider',
  '    api: https://example.test/old',
  '    enabled: true',
  '  - name: Multi',
  '    careers_url: https://multi.example/jobs',
  '    notes: >',
  '      folded text',
  '      on two lines',
  '    enabled: true',
  'job_boards:',
  '  - name: Some board',
  '    url: https://example.test/feed',
  '',
].join('\n');

test('portals.yml edits keep comments, quote notes safely and refuse what they cannot read back', () => {
  const res = patchPortalsText(PORTALS, [
    { name: 'Twilio', expect: { careers_url: 'https://www.twilio.com/en-us/company/jobs' }, set: { careers_url: 'https://job-boards.greenhouse.io/twilio', api: 'https://boards-api.greenhouse.io/v1/boards/twilio/jobs', provider: null, notes: 'auto-resolved: board "twilio" (132 roles); replaces https://x. Earlier note: Voice: messaging # infra' } },
    { name: 'Gong', expect: { careers_url: 'https://www.gong.io/careers' }, set: { careers_url: 'https://careers.smartrecruiters.com/gong', api: null, provider: null, enabled: false, notes: 'switched off' } },
    { name: 'Multi', set: { notes: 'cannot overwrite a folded block' } },
    { name: 'Nobody', set: { enabled: false } },
    { name: 'Twilio', expect: { careers_url: 'https://old.example' }, set: { enabled: false } },
  ]);
  assert.deepEqual(res.applied.map(p => p.name), ['Twilio', 'Gong']);
  assert.deepEqual(res.skipped.map(s => `${s.name}:${s.reason}`), ['Multi:notes spans several lines', 'Nobody:entry_not_found', 'Twilio:changed_meanwhile']);
  assert.ok(res.text.includes('  # AI infra'), 'comments stay');
  const list = yamlLoad(res.text).tracked_companies;
  assert.equal(list.length, 3);
  const twilio = list.find(c => c.name === 'Twilio');
  assert.equal(twilio.careers_url, 'https://job-boards.greenhouse.io/twilio');
  assert.equal(twilio.api, 'https://boards-api.greenhouse.io/v1/boards/twilio/jobs');
  assert.equal(twilio.scan_method, 'websearch', 'fields that are not touched stay');
  assert.equal(twilio.notes, 'auto-resolved: board "twilio" (132 roles); replaces https://x. Earlier note: Voice: messaging # infra');
  const gong = list.find(c => c.name === 'Gong');
  assert.equal(gong.enabled, false);
  assert.equal(gong.api, undefined, 'a null removes the field');
  assert.equal(gong.provider, undefined);
  assert.equal(gong.notes, 'switched off', 'a missing notes field is added');
  assert.deepEqual(list.find(c => c.name === 'Multi'), { name: 'Multi', careers_url: 'https://multi.example/jobs', notes: 'folded text on two lines\n', enabled: true }, 'a folded block is left alone');
  assert.equal(yamlLoad(res.text).job_boards.length, 1);
  // CRLF files stay CRLF
  const crlf = patchPortalsText(PORTALS.replace(/\n/g, '\r\n'), [{ name: 'Twilio', set: { api: 'https://a.test/x' } }]);
  assert.ok(crlf.text.includes('\r\n') && !/[^\r]\n/.test(crlf.text));
});

const GH = (slug, titles, name) => ({ [`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`]: { jobs: titles.map(title => ({ title })) }, [`https://boards-api.greenhouse.io/v1/boards/${slug}`]: { name } });
function fakeFetch(routes) {
  return async (url) => {
    const body = routes[String(url)];
    return body === undefined
      ? { status: 404, text: async () => '' }
      : { status: 200, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
  };
}

test('end to end: board found by slug, dead board repaired from the explorer journal, duplicate switched off', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'resolver-'));
  try {
    const portalsPath = join(dir, 'portals.yml');
    const dataDir = join(dir, 'data');
    await writeFile(portalsPath, [
      'tracked_companies:',
      '  - name: Twilio',
      '    careers_url: https://www.twilio.com/en-us/company/jobs',
      '    scan_method: websearch',
      '    scan_query: site:twilio.com/company/jobs {roles}',
      '    enabled: true',
      '  - name: Gong',
      '    careers_url: https://www.gong.io/careers',
      '    scan_method: websearch',
      '    scan_query: site:gong.io/careers {roles}',
      '    enabled: true',
      '  - name: Gong.io',
      '    careers_url: https://job-boards.greenhouse.io/gongio',
      '    api: https://boards-api.greenhouse.io/v1/boards/gongio/jobs',
      '    enabled: true',
      '  - name: Ada',
      '    careers_url: https://job-boards.greenhouse.io/ada',
      '    scan_method: websearch',
      '    scan_query: "\\"ada.cx\\" {roles}"',
      '    notes: Disabled - Greenhouse API returns 404.',
      '    enabled: true',
      '  - name: Tiny Co',
      '    careers_url: https://tiny.example/jobs',
      '    enabled: true',
      '',
    ].join('\n'));
    await (await import('node:fs/promises')).mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, 'discovered-companies.jsonl'), [
      { ats: 'greenhouse', slug: 'ada18', name: 'Ada', status: 200, open_roles: 6, decision: 'skipped', reason: 'already_tracked' },
      { ats: 'greenhouse', slug: 'gongio', name: 'Gong.io', status: 200, open_roles: 99, decision: 'added', reason: 'ok' },
    ].map(r => JSON.stringify(r)).join('\n') + '\n');
    const fetchImpl = fakeFetch({
      ...GH('twilio', ['Account Executive', 'Applications Engineer', 'Product Designer', 'Support Engineer'], 'Twilio'),
      ...GH('ada18', ['Designer', 'Engineer', 'PM', 'Support', 'Sales', 'Ops'], 'Ada'),
      ...GH('gongio', Array.from({ length: 30 }, (_, i) => `Role ${i}`), 'Gong.io'),
      'https://api.smartrecruiters.com/v1/companies/gong/postings': { content: [{ name: 'Journalism internship', company: { name: 'Gong Media' } }, { name: 'Editor', company: { name: 'Gong Media' } }, { name: 'Writer', company: { name: 'Gong Media' } }] },
    });
    const stale = new Map([['Ada', { reason: 'HTTP 404' }]]);
    const logs = [];
    const common = { portalsPath, dataDir, stale, fetchImpl, log: (l) => logs.push(l), now: new Date('2026-10-21T10:00:00Z') };

    // preview: nothing is written, not even the state
    const preview = await runAtsBoardResolver({ ...common, dryRun: true });
    assert.equal(preview.applied, 3);
    assert.equal(await readFile(portalsPath, 'utf8').then(t => t.includes('auto-resolved')), false);
    assert.deepEqual((await readdir(dataDir)).sort(), ['discovered-companies.jsonl']);

    const run = await runAtsBoardResolver(common);
    assert.deepEqual(run.appliedNames.sort(), ['Ada', 'Gong', 'Twilio']);
    assert.match(run.backupPath, /portals\.yml\.bak-resolver-20261021-100000$/);
    const byDecision = Object.fromEntries(run.records.map(r => [r.company, r.decision]));
    assert.equal(byDecision.Twilio, 'resolved');
    assert.equal(byDecision.Ada, 'repaired');
    assert.equal(byDecision.Gong, 'disabled', 'Gong.io already scans that board');
    assert.equal(byDecision['Tiny Co'], 'no_board');

    const list = yamlLoad(await readFile(portalsPath, 'utf8')).tracked_companies;
    assert.equal(list.length, 5);
    const get = (n) => list.find(c => c.name === n);
    assert.equal(get('Twilio').api, 'https://boards-api.greenhouse.io/v1/boards/twilio/jobs');
    assert.equal(get('Twilio').careers_url, 'https://job-boards.greenhouse.io/twilio');
    assert.equal(get('Ada').api, 'https://boards-api.greenhouse.io/v1/boards/ada18/jobs');
    assert.match(get('Ada').notes, /^auto-resolved 2026-10-21: public greenhouse board "ada18" verified live \(6 open roles, matched on name\); replaces https:\/\/job-boards\.greenhouse\.io\/ada\. Earlier note: Disabled - Greenhouse API returns 404\.$/);
    assert.equal(get('Gong').enabled, false);
    assert.equal(get('Gong.io').enabled, true);
    assert.equal(get('Tiny Co').careers_url, 'https://tiny.example/jobs', 'no board, no change');
    assert.ok((await readdir(dir)).some(f => f.startsWith('portals.yml.bak-resolver-')));
    assert.ok(!(await readdir(dir)).some(f => f.endsWith('.lock')), 'the lock is released');

    const journal = (await readFile(join(dataDir, 'resolved-boards.jsonl'), 'utf8')).trim().split('\n').map(l => JSON.parse(l));
    assert.equal(journal.find(r => r.company === 'Tiny Co').reason, 'no_answer');
    const state = JSON.parse(await readFile(join(dataDir, 'ats-resolver-state.json'), 'utf8'));
    assert.ok(state.tried['Tiny Co'] && state.tried.Twilio);

    // the next scan does not probe the company without a board again, nor the ones already moved
    const again = await runAtsBoardResolver({ ...common, stale: new Map(), now: new Date('2026-10-22T10:00:00Z') });
    assert.equal(again.tried, 0);
    assert.equal(again.applied, 0);
    assert.ok(logs.at(-1).includes('probed=0'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('an edited portals.yml is never half written', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'resolver-'));
  try {
    const portalsPath = join(dir, 'portals.yml');
    await writeFile(portalsPath, 'tracked_companies:\n  - name: A\n    careers_url: https://a.test\n    enabled: true\n');
    const res = applyPortalsPatches(portalsPath, [{ name: 'A', expect: { careers_url: 'https://other.test' }, set: { enabled: false } }]);
    assert.equal(res.applied.length, 0);
    assert.equal(res.skipped[0].reason, 'changed_meanwhile');
    assert.equal(res.backupPath, null);
    assert.equal(await readFile(portalsPath, 'utf8'), 'tracked_companies:\n  - name: A\n    careers_url: https://a.test\n    enabled: true\n');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the scan records dead boards and runs the resolver after the explorer', async () => {
  const src = await readFile(new URL('../ui/server.mjs', import.meta.url), 'utf8');
  assert.match(src, /staleAtsBoards\.set\(name, \{ provider, reason: String\(reason\) \}\)/);
  assert.match(src, /staleAtsBoards\.clear\(\)/);
  assert.match(src, /await runAtsBoardResolver\(\{[\s\S]*?accessOf: getCompanyScanAccess,[\s\S]*?stale: staleAtsBoards,/);
  assert.ok(src.indexOf('await runAtsExplorer(') < src.indexOf('await runAtsBoardResolver('), 'the explorer adds companies first, the resolver then sees the fresh file');
});
