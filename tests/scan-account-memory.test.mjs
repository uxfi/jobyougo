// A scan run by another account on the local server read and wrote the
// owner's scan files: postings the owner had seen were skipped for it, and
// its results landed in the owner's history and changed the owner's next
// scan. Each account now has its own scan memory (lib/scan-memory.mjs), and
// the owner keeps the files under data/ exactly as before. The server starts
// on import, so its functions are evaluated from the source text in a
// sandbox over a temporary folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { withPipelineLock } from '../pipeline-lock.mjs';
import {
  ACCOUNTS_DIR,
  SCAN_HISTORY_RETENTION_DAYS,
  ensureScanMemoryDir,
  pruneScanHistoryLines,
  scanHistoryCutoff,
  scanMemoryPaths,
} from '../lib/scan-memory.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = readFileSync(join(ROOT, 'ui/server.mjs'), 'utf8');

function sourceOf(name) {
  const start = server.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, `${name} is defined`);
  const end = server.indexOf('\n}\n', start);
  return server.slice(start, end + 2);
}

// Values built inside the sandbox carry its own Array/Object prototypes.
const plain = value => JSON.parse(JSON.stringify(value));

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const HEADER = 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus';
const TODAY = new Date().toISOString().slice(0, 10);
const OLD = '2020-01-01';

function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'jyg-scan-memory-'));
  mkdirSync(join(root, 'data'), { recursive: true });
  return root;
}

// The scan-memory functions of the server, over `root` as WRITE_ROOT, with
// ownsLocalData answering like the real one (Supabase on, OWNER is the admin).
function scanServer(root, { portals = {}, extra = {} } = {}) {
  const calls = { appendPipelineRecords: [], editPipelineMarkdown: 0, supabase: [], getReport: [], getApplications: [] };
  const ctx = vm.createContext({
    WRITE_ROOT: root,
    ROOT: root,
    useSupabase: true,
    scanMemoryPaths,
    ensureScanMemoryDir,
    pruneScanHistoryLines,
    scanHistoryCutoff,
    SCAN_HISTORY_RETENTION_DAYS,
    withPipelineLock,
    readFile, writeFile, appendFile, mkdir, join, dirname,
    Date, Number, String, Boolean, JSON, Map, Set, Promise, console,
    ownsLocalData: async (userId) => !userId || userId === OWNER,
    readPortalsYaml: async () => ({ parsed: portals }),
    normalizeUrlKey: url => String(url || '').trim().replace(/\/+$/, '').toLowerCase(),
    knownUrlKey: url => String(url || '').trim().replace(/\/+$/, '').toLowerCase(),
    normalizeCompany: name => String(name || '').trim().toLowerCase(),
    tsvSafe: value => String(value ?? '').replace(/[\t\r\n]+/g, ' ').trim(),
    appendPipelineRecords: async (records) => { calls.appendPipelineRecords.push(plain(records)); },
    editPipelineMarkdown: async () => { calls.editPipelineMarkdown += 1; },
    getApplications: async (userId) => { calls.getApplications.push(userId); return extra.apps?.[userId] || []; },
    getReport: async (filename, userId) => { calls.getReport.push([filename, userId]); return extra.reports?.[`${userId}:${filename}`] ?? Promise.reject(new Error('Report not found')); },
    ...extra.ctx,
  });
  const names = [
    'scanMemoryOf', 'getScanState', 'updateScanState', 'getScanSelection', 'saveScanSelection', 'logScanSelectionReset',
    'getScanHistoryRows', 'scanHistoryStatusBlocksReadd', 'getBlockingScanHistoryUrlSet', 'getLatestScanHistoryEntryMap',
    'scanHistoryRetentionDays', 'appendScanHistoryEntries', 'appendDeletedApplicationEntries', 'getCompanyRoleExclusions',
    'recordManualApplicationDelete', 'recordPipelineChange', 'getEvaluatedUrlSet', 'findPostingUrlFromReportLink',
  ];
  vm.runInContext([
    "const DELETED_APPLICATIONS_HEADER = 'company\\trole\\tdate_deleted\\treason';",
    'const OWNER_SCAN_MEMORY = scanMemoryPaths(WRITE_ROOT);',
    'async function getReportUrlSet() { return new Set(["https://owner.example/reports-url"]); }',
    ...names.map(sourceOf),
    `this.api = { OWNER_SCAN_MEMORY, ${names.join(', ')} };`,
  ].join('\n'), ctx);
  return { api: ctx.api, calls };
}

const read = path => readFileSync(path, 'utf8');

test('the owner keeps the historical files; another account gets data/accounts/<id>/', () => {
  const root = join('srv', 'jobyougo');
  const owner = scanMemoryPaths(root);
  assert.equal(owner.account, null);
  assert.equal(owner.history, join(root, 'data/scan-history.tsv'));
  assert.equal(owner.decisions, join(root, 'data', 'scan-decisions.jsonl'));
  assert.equal(owner.state, join(root, 'data/scan-state.json'));
  assert.equal(owner.selection, join(root, 'data/scan-selection.json'));
  assert.equal(owner.selectionLog, join(root, 'data/scan-selection-log.jsonl'));
  assert.equal(owner.queryYield, join(root, 'data', 'web-search-yield.json'));
  assert.equal(owner.deleted, join(root, 'data/deleted-applications.tsv'));

  const other = scanMemoryPaths(root, OTHER.toUpperCase());
  assert.equal(other.account, OTHER);
  assert.equal(other.dir, join(root, ACCOUNTS_DIR, OTHER));
  for (const key of ['history', 'decisions', 'state', 'selection', 'selectionLog', 'queryYield', 'deleted']) {
    assert.equal(dirname(other[key]), other.dir, `${key} is in the account folder`);
    assert.notEqual(other[key], owner[key]);
  }
  for (const bad of ['', 'local', '../../data', `${OTHER}/..`, 'admin-id', 42, {}]) {
    assert.throws(() => scanMemoryPaths(root, bad), /invalid account id/, `rejects ${JSON.stringify(bad)}`);
  }
});

test('an account history drops what purge-stale drops from the owner one', () => {
  assert.equal(SCAN_HISTORY_RETENTION_DAYS, 20);
  assert.equal(scanHistoryCutoff('2026-10-13', 20), '2026-09-23');
  assert.equal(scanHistoryCutoff('2026-10-13T22:10:00Z', 0), '2026-09-23', 'a bad value keeps the default');
  const lines = [
    HEADER,
    'https://a.example/1\t2026-09-22\tscan-ui\tDesigner\tA\tjev_dropped',
    'https://a.example/2\t2026-09-23\tscan-ui\tDesigner\tA\tadded',
    'https://a.example/3\t2026-01-01\tmanual-delete\tDesigner\tA\tdeleted',
    'https://a.example/4\t\tscan-ui\tDesigner\tA\texpired',
    'https://a.example/5\t2026-10-12\tscan-link-check\tDesigner\tA\texpired',
  ];
  assert.deepEqual(pruneScanHistoryLines(lines, '2026-09-23'), [lines[0], lines[2], lines[3], lines[4], lines[5]]);
  assert.deepEqual(pruneScanHistoryLines(lines, ''), lines, 'no cutoff (the owner) keeps every row');
});

test('scanMemoryOf: the owner and unscoped callers get data/, any other account its own folder', async () => {
  const root = tempRoot();
  try {
    const { api } = scanServer(root);
    assert.equal(await api.scanMemoryOf(undefined), api.OWNER_SCAN_MEMORY);
    assert.equal(await api.scanMemoryOf(OWNER), api.OWNER_SCAN_MEMORY);
    const other = await api.scanMemoryOf(OTHER);
    assert.equal(other.account, OTHER);
    assert.equal(other.history, join(root, 'data', 'accounts', OTHER, 'scan-history.tsv'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the owner's scan history is read and written exactly as before", async () => {
  const root = tempRoot();
  try {
    const history = join(root, 'data/scan-history.tsv');
    const existing = [
      HEADER,
      `https://old.example/1\t${OLD}\tscan-ui\tDesigner\tOld\tjev_dropped`,
      `https://a.example/1\t${TODAY}\tscan-ui\tDesigner\tA\tadded`,
    ].join('\n');
    writeFileSync(history, `${existing}\n\n`);
    const { api } = scanServer(root, { portals: { retention_days: 1 } });
    await api.appendScanHistoryEntries([`https://b.example/2\t${TODAY}\tscan-jev\tPM\tB\tjev_dropped`]);
    // Same payload as the pre-account code: rows kept (purge-stale trims them), trailing blank lines folded.
    assert.equal(read(history), `${existing}\nhttps://b.example/2\t${TODAY}\tscan-jev\tPM\tB\tjev_dropped\n`);
    assert.equal(existsSync(join(root, 'data', 'accounts')), false, 'no account folder');

    const blocking = plain([...await api.getBlockingScanHistoryUrlSet()]);
    assert.deepEqual(blocking.sort(), ['https://b.example/2', 'https://old.example/1']);
    const latest = await api.getLatestScanHistoryEntryMap();
    assert.equal(latest.get('https://a.example/1').first_seen, TODAY);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("another account's scan history is its own: created on first write, pruned as it grows, never the owner's", async () => {
  const root = tempRoot();
  try {
    const ownerHistory = join(root, 'data/scan-history.tsv');
    const ownerRows = `${HEADER}\nhttps://seen-by-owner.example/1\t${OLD}\tscan-jev\tDesigner\tA\tjev_dropped\n`;
    writeFileSync(ownerHistory, ownerRows);
    const { api } = scanServer(root);
    const memory = await api.scanMemoryOf(OTHER);
    const accountHistory = join(root, 'data', 'accounts', OTHER, 'scan-history.tsv');

    // The owner's drops neither block the account's scan nor date its postings.
    assert.equal((await api.getBlockingScanHistoryUrlSet(memory)).size, 0);
    assert.equal((await api.getLatestScanHistoryEntryMap(memory)).size, 0, 'no first_seen from the owner');
    assert.equal(existsSync(join(root, 'data', 'accounts')), false, 'reading makes no folder');

    await api.appendScanHistoryEntries([
      `https://old.example/1\t${OLD}\tscan-jev\tPM\tOld\tjev_dropped`,
      `https://old.example/2\t${OLD}\tmanual-delete\tPM\tOld\tdeleted`,
    ], memory);
    assert.ok(existsSync(accountHistory), 'the folder and file are made on the first write');
    await api.appendScanHistoryEntries([`https://new.example/1\t${TODAY}\tscan-link-check\tPM\tNew\texpired`], memory);

    assert.equal(read(accountHistory), [
      HEADER,
      `https://old.example/2\t${OLD}\tmanual-delete\tPM\tOld\tdeleted`,
      `https://new.example/1\t${TODAY}\tscan-link-check\tPM\tNew\texpired`,
      '',
    ].join('\n'), 'rows past retention go, deleted stays');
    assert.equal(read(ownerHistory), ownerRows, "the owner's history is untouched");
    assert.deepEqual(plain([...await api.getBlockingScanHistoryUrlSet(memory)]).sort(), ['https://new.example/1', 'https://old.example/2']);
    assert.deepEqual(plain([...await api.getBlockingScanHistoryUrlSet()]), ['https://seen-by-owner.example/1'], 'the owner is not blocked by the account');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('scan state, selection and its log follow the account', async () => {
  const root = tempRoot();
  try {
    const { api } = scanServer(root);
    const memory = await api.scanMemoryOf(OTHER);
    writeFileSync(join(root, 'data/scan-state.json'), JSON.stringify({ Ashby: '2026-10-01T00:00:00.000Z' }));
    writeFileSync(join(root, 'data/scan-selection.json'), JSON.stringify({ companies: ['Owner pick'] }));

    assert.deepEqual(plain(await api.getScanState(memory)), {}, "the owner's last-scanned dates are not the account's");
    assert.equal(await api.getScanSelection(memory), null, "nor the owner's picker choice");

    await api.saveScanSelection({ companies: ['Account pick'] }, memory);
    await api.updateScanState(['Lever'], '2026-10-13T10:00:00.000Z', memory);
    assert.deepEqual(plain(await api.getScanSelection(memory)), { companies: ['Account pick'] });
    await api.logScanSelectionReset(plain(await api.getScanSelection(memory)), memory);

    const dir = join(root, 'data', 'accounts', OTHER);
    assert.deepEqual(JSON.parse(read(join(dir, 'scan-state.json'))), { Lever: '2026-10-13T10:00:00.000Z' });
    assert.deepEqual(JSON.parse(read(join(dir, 'scan-selection.json'))), { all: true });
    assert.match(read(join(dir, 'scan-selection-log.jsonl')), /"previous":\{"companies":\["Account pick"\]\}/);

    assert.deepEqual(JSON.parse(read(join(root, 'data/scan-state.json'))), { Ashby: '2026-10-01T00:00:00.000Z' });
    assert.deepEqual(JSON.parse(read(join(root, 'data/scan-selection.json'))), { companies: ['Owner pick'] });
    assert.equal(existsSync(join(root, 'data/scan-selection-log.jsonl')), false);

    // The owner's own calls (no memory argument) still use data/.
    await api.updateScanState(['Greenhouse'], '2026-10-13T11:00:00.000Z');
    assert.deepEqual(JSON.parse(read(join(root, 'data/scan-state.json'))), { Ashby: '2026-10-01T00:00:00.000Z', Greenhouse: '2026-10-13T11:00:00.000Z' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('deleted company+role pairs: the owner reads data/, another account only its own', async () => {
  const root = tempRoot();
  try {
    writeFileSync(join(root, 'data/deleted-applications.tsv'), 'company\trole\tdate_deleted\treason\nOwnerCo\tProduct Designer\t2026-10-01\tuser_deleted\n');
    const { api, calls } = scanServer(root, {
      extra: { apps: { [OTHER]: [{ company: 'TrackedCo', role: 'Data Engineer' }] } },
    });

    const ownerExclusions = await api.getCompanyRoleExclusions(OWNER);
    assert.deepEqual(plain([...ownerExclusions.keys()]), ['ownerco']);

    const before = plain([...(await api.getCompanyRoleExclusions(OTHER)).keys()]);
    assert.deepEqual(before, ['trackedco'], "the owner's deletions do not hide postings from the account");

    await api.recordManualApplicationDelete({ company: 'GoneCo', role: 'Analytics Engineer', jobUrl: 'https://gone.example/job', date: TODAY, userId: OTHER });
    const after = plain([...(await api.getCompanyRoleExclusions(OTHER)).keys()]).sort();
    assert.deepEqual(after, ['goneco', 'trackedco']);
    const dir = join(root, 'data', 'accounts', OTHER);
    assert.match(read(join(dir, 'deleted-applications.tsv')), /^company\trole\tdate_deleted\treason\nGoneCo\tAnalytics Engineer\t/);
    assert.match(read(join(dir, 'scan-history.tsv')), /https:\/\/gone\.example\/job\t\d{4}-\d{2}-\d{2}\tmanual-delete\tAnalytics Engineer\tGoneCo\tdeleted/);
    assert.doesNotMatch(read(join(root, 'data/deleted-applications.tsv')), /GoneCo/);
    assert.equal(existsSync(join(root, 'data/scan-history.tsv')), false, 'no owner history row');
    assert.deepEqual(calls.getApplications, [OWNER, OTHER, OTHER]);

    // The owner's delete (no userId: local mode) still writes data/.
    await api.recordManualApplicationDelete({ company: 'OwnerGone', role: 'Designer', jobUrl: '', date: TODAY });
    assert.match(read(join(root, 'data/deleted-applications.tsv')), /OwnerGone\tDesigner/);
    assert.match(read(join(root, 'data/scan-history.tsv')), /^url\tfirst_seen\tportal\ttitle\tcompany\tstatus\nunknown:OwnerGone:Designer\t/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pipeline changes: the owner's jsonl gets the owner's records only", async () => {
  const root = tempRoot();
  try {
    const { api, calls } = scanServer(root);
    const row = `https://x.example/1\t${TODAY}\tscan-ui\tPM\tX\tadded`;

    await api.recordPipelineChange([{ url: 'https://x.example/1', status: 'pending' }], [row], await api.scanMemoryOf(OTHER));
    assert.equal(calls.appendPipelineRecords.length, 0, 'data/pipeline.jsonl is not written');
    assert.match(read(join(root, 'data', 'accounts', OTHER, 'scan-history.tsv')), /https:\/\/x\.example\/1/);
    assert.equal(existsSync(join(root, 'data/scan-history.tsv')), false);

    await api.recordPipelineChange([{ url: 'https://y.example/1', status: 'pending' }], [row.replace('x.example', 'y.example')]);
    assert.deepEqual(calls.appendPipelineRecords, [[{ url: 'https://y.example/1', status: 'pending' }]]);
    assert.match(read(join(root, 'data/scan-history.tsv')), /https:\/\/y\.example\/1/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("evaluated postings: the owner's reports/, another account's own tracker rows", async () => {
  const root = tempRoot();
  try {
    const { api, calls } = scanServer(root, {
      extra: { apps: { [OTHER]: [{ job_url: 'https://acct.example/1' }, { JobURL: 'https://acct.example/2' }, { job_url: '' }, { url: 'not a url' }] } },
    });
    assert.deepEqual(plain([...await api.getEvaluatedUrlSet(OWNER)]), ['https://owner.example/reports-url']);
    assert.deepEqual(plain([...await api.getEvaluatedUrlSet(OTHER, await api.scanMemoryOf(OTHER))]), ['https://acct.example/1', 'https://acct.example/2']);
    assert.deepEqual(calls.getApplications, [OTHER]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a deleted application's posting URL comes from the account's own report, never the owner's file", async () => {
  const root = tempRoot();
  try {
    mkdirSync(join(root, 'reports'), { recursive: true });
    writeFileSync(join(root, 'reports', '042-acme-2026-10-13.md'), '# Acme\n**URL:** https://owner.example/acme\n');
    const { api, calls } = scanServer(root, {
      extra: { reports: { [`${OTHER}:042-acme-2026-10-13.md`]: '# Acme\n**URL:** https://acct.example/acme\n' } },
    });
    const link = '[42](reports/042-acme-2026-10-13.md)';
    assert.equal(await api.findPostingUrlFromReportLink(link), 'https://owner.example/acme');
    assert.equal(await api.findPostingUrlFromReportLink(link, OWNER), 'https://owner.example/acme');
    assert.equal(await api.findPostingUrlFromReportLink(link, OTHER), 'https://acct.example/acme');
    assert.deepEqual(calls.getReport, [['042-acme-2026-10-13.md', OTHER]]);
    assert.equal(await api.findPostingUrlFromReportLink('[43](reports/043-other-2026-10-13.md)', OTHER), '', 'no row: no URL, no disk read');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// The pipeline writers, run with their real source over spies.
function pipelineWriters({ owner }) {
  const calls = { markdown: 0, jsonl: [], history: [], readRecords: 0, updates: [] };
  const memoryFor = userId => (userId === OWNER || !userId ? { account: null } : { account: userId });
  const updateQuery = (patch) => {
    const filters = [];
    const query = {
      eq(column, value) { filters.push([column, value]); return query; },
      then(resolve) { calls.updates.push({ patch, filters }); return Promise.resolve({ error: null }).then(resolve); },
    };
    return query;
  };
  const ctx = vm.createContext({
    useSupabase: true,
    supabase: {
      from: () => ({
        upsert: async () => ({ error: null }),
        update: patch => updateQuery(patch),
      }),
    },
    ownsLocalData: async userId => !userId || userId === OWNER,
    scanMemoryOf: async userId => memoryFor(userId),
    OWNER_SCAN_MEMORY: { account: null },
    loadPipelineRows: async () => [],
    pipelineRowsByKey: () => new Map(),
    normalizeUrlKey: url => String(url || '').trim().toLowerCase(),
    uniquePipelineEntries: entries => entries,
    updatePipelineRows: async () => [],
    normalizePipelineItem: item => item,
    getPipeline: async () => [],
    pipelineHistoryLine: (url, portal, title, company, status) => [url, TODAY, portal, title || '', company || '', status].join('\t'),
    pipelineRecordFromEntry: (entry, at) => ({ url: entry.url, status: entry.status, scanned_at: at, note: entry.note || '' }),
    pipelineSideStatus: (entry, fallback) => fallback,
    extractPipelineNoteParts: () => ({}),
    appendPipelineRecords: async records => { calls.jsonl.push(records.length); },
    appendScanHistoryEntries: async (rows, memory) => { calls.history.push({ rows: rows.length, account: memory.account }); },
    editPipelineMarkdown: async () => { calls.markdown += 1; },
    readLatestPipelineRecords: async () => { calls.readRecords += 1; return new Map(); },
    formatPipelineNote: record => `${record.company} | ${record.title} | jev: ${record.jev_keep}`,
    jevDecisionToRecord: (decision, existing) => ({ url: decision.url, company: existing.company || decision.company || '', title: existing.title || decision.title || '', jev_keep: decision.jevKeep }),
    parsePipeline: () => [],
    console,
    Date, Map, Set, Promise, String,
  });
  vm.runInContext(['addManyToPipeline', 'removeManyFromPipeline', 'recordPipelineChange', 'updatePipelineJevScores'].map(sourceOf).join('\n')
    + '\nthis.api = { addManyToPipeline, removeManyFromPipeline, updatePipelineJevScores };', ctx);
  return { api: ctx.api, calls, userId: owner ? OWNER : OTHER };
}

test("adding and removing pipeline rows writes the owner's inbox files for the owner only", async () => {
  const other = pipelineWriters({ owner: false });
  await other.api.addManyToPipeline([{ url: 'https://x.example/1', note: 'X | PM' }], other.userId);
  await other.api.removeManyFromPipeline(['https://x.example/1'], other.userId, { historyStatus: 'jev_dropped', historyPortal: 'pipeline-jev' });
  assert.equal(other.calls.markdown, 0, 'data/pipeline.md untouched');
  assert.deepEqual(other.calls.jsonl, [], 'data/pipeline.jsonl untouched');
  assert.deepEqual(plain(other.calls.history), [{ rows: 1, account: OTHER }, { rows: 1, account: OTHER }]);

  const owner = pipelineWriters({ owner: true });
  await owner.api.addManyToPipeline([{ url: 'https://x.example/1', note: 'X | PM' }], owner.userId);
  await owner.api.removeManyFromPipeline(['https://x.example/1'], owner.userId);
  assert.equal(owner.calls.markdown, 2);
  assert.deepEqual(owner.calls.jsonl, [1, 1]);
  assert.deepEqual(plain(owner.calls.history), [{ rows: 1, account: null }, { rows: 1, account: null }]);
});

test("Jev scores of another account go to its own Supabase rows, not the owner's pipeline files", async () => {
  const other = pipelineWriters({ owner: false });
  await other.api.updatePipelineJevScores(
    [{ url: 'https://x.example/1', jevKeep: 0.82, title: 'Backfilled title' }],
    other.userId,
    [{ url: 'https://x.example/1', company: 'X Corp', title: '' }],
  );
  assert.equal(other.calls.readRecords, 0);
  assert.equal(other.calls.markdown, 0);
  assert.deepEqual(other.calls.jsonl, []);
  assert.deepEqual(plain(other.calls.updates), [{
    patch: { note: 'X Corp | Backfilled title | jev: 0.82' },
    filters: [['url', 'https://x.example/1'], ['user_id', OTHER]],
  }]);

  const owner = pipelineWriters({ owner: true });
  await owner.api.updatePipelineJevScores([{ url: 'https://x.example/1', jevKeep: 0.82 }], owner.userId, []);
  assert.equal(owner.calls.readRecords, 1);
  assert.equal(owner.calls.markdown, 1);
  assert.deepEqual(owner.calls.jsonl, [1]);
});

function scanRouteBlocks() {
  const start = server.indexOf("        if (mode === 'scan') {\n          resetSerpApiCircuit();");
  const end = server.indexOf("        } else if (mode === 'pipeline') {", start);
  const saveStart = server.indexOf("        // SCAN → extract URLs and add to pipeline.md");
  const saveEnd = server.indexOf('          if (rejectedParsed.length) {', saveStart);
  const jevStart = server.indexOf('          appendDecisionLog(scanMemory.decisions, [');
  assert.ok(start > 0 && end > start && saveStart > 0 && saveEnd > saveStart && jevStart > 0);
  return { prefetch: server.slice(start, end), save: server.slice(saveStart, saveEnd) };
}

test('the scan route resolves one scan memory and uses it for every scan file', () => {
  const declarations = server.match(/\n {8}const scanMemory = .+;\n/g) || [];
  assert.equal(declarations.length, 1, 'scanMemory is declared once in the route');
  const expression = declarations[0].trim().replace(/^const scanMemory = /, '').replace(/;$/, '');
  const run = (mode, ownerFiles, userId) => vm.runInNewContext(expression, {
    mode, ownerFiles, req: { userId }, OWNER_SCAN_MEMORY: 'owner', WRITE_ROOT: 'root', scanMemoryPaths: (root, id) => `account:${id}`,
  });
  assert.equal(run('scan', true, OWNER), 'owner');
  assert.equal(run('scan', false, OTHER), `account:${OTHER}`);
  assert.equal(run('pipeline', false, OTHER), 'owner', 'other modes never build an account folder');

  const { prefetch, save } = scanRouteBlocks();
  for (const block of [prefetch, save]) {
    assert.doesNotMatch(block, /join\(WRITE_ROOT, 'data/, 'no hard-coded data/ file in the scan path');
    assert.doesNotMatch(block, /getReportUrlSet\(/, 'reports/ only through getEvaluatedUrlSet');
    assert.doesNotMatch(block, /(getBlockingScanHistoryUrlSet|getLatestScanHistoryEntryMap|getScanSelection|logScanSelectionReset)\(\)/);
    assert.doesNotMatch(block, /appendScanHistoryEntries\(\w+\)/, 'every history write passes the memory');
  }
  for (const call of [
    'getScanSelection(scanMemory)',
    'const queryYieldPath = scanMemory.queryYield;',
    'updateScanState(scannedSourceNames, new Date().toISOString(), scanMemory)',
    'getLatestScanHistoryEntryMap(scanMemory)',
    'appendDecisionLog(scanMemory.decisions, scanDecisionRecords',
    'const dedupScope = scanMemory.account ? req.userId : undefined;',
    'getPipeline(dedupScope)',
    'getBlockingScanHistoryUrlSet(scanMemory)',
    'getEvaluatedUrlSet(req.userId, scanMemory)',
    'getProcessedPipelineUrlKeys(dedupScope)',
    'appendScanHistoryEntries(deadEntries, scanMemory)',
    'logScanSelectionReset(selection, scanMemory)',
  ]) assert.ok(prefetch.includes(call), `prefetch: ${call}`);
  for (const call of [
    'getBlockingScanHistoryUrlSet(scanMemory)',
    'getEvaluatedUrlSet(req.userId, scanMemory)',
    'appendScanHistoryEntries(historyRows, scanMemory)',
    'appendScanHistoryEntries(jevDroppedRows, scanMemory)',
  ]) assert.ok(save.includes(call), `save: ${call}`);
  assert.equal((server.match(/appendDecisionLog\(join\(WRITE_ROOT/g) || []).length, 0, 'all four decision logs use the memory');
});

test('the scan state, sources and selection routes answer from the caller’s own memory', () => {
  assert.ok(server.includes("if (method === 'GET') return json(res, await getScanState(await scanMemoryOf(viewOnlyScope(req))));"));
  assert.ok(server.includes('return json(res, await getScanSources(await scanMemoryOf(viewOnlyScope(req))));'));
  assert.ok(server.includes("if (method === 'GET')  return json(res, await getScanSelection(await scanMemoryOf(req.userId)));"));
  assert.ok(server.includes('await saveScanSelection(sel, await scanMemoryOf(req.userId));'));
  assert.ok(server.includes('await recordManualApplicationDelete({ company, role, jobUrl, date: today, userId: req.userId });'));
});
