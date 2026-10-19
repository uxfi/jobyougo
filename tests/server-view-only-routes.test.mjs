// Whose rows the view-only GETs of ui/server.mjs return. The server starts on
// import, so the guard and the routes are checked from the source, and the
// data accessors are evaluated from the source text in a sandbox over a fake
// Supabase client: a non-admin account gets its own rows only, while the
// admin's dashboard and anonymous view-only callers read what they read before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = readFileSync(join(ROOT, 'ui/server.mjs'), 'utf8');

function sourceOf(name) {
  const start = server.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, `${name} is defined`);
  const end = server.indexOf('\n}\n', start);
  return server.slice(start, end + 2);
}

function routeBlock(condition) {
  const start = server.indexOf(condition);
  assert.ok(start >= 0, `route ${condition}`);
  const next = server.indexOf('\n    if (path', start + condition.length);
  return server.slice(start, next);
}

// Values built inside the sandbox carry its own Array/Object prototypes.
const plain = value => JSON.parse(JSON.stringify(value));

const ADMIN = 'admin-id';
const OTHER = 'other-id';

// A chainable stand-in for the supabase-js query builder over in-memory
// tables: eq() filters, single() and await answer like PostgREST. A table set
// to an Error fails every read.
function fakeSupabase(tables, calls = []) {
  return {
    from(table) {
      const filters = [];
      const rows = () => (tables[table] || []).filter(row => filters.every(([column, value]) => row[column] === value));
      const query = {
        select(columns) { calls.push({ table, op: 'select', columns }); return query; },
        eq(column, value) { filters.push([column, value]); calls.push({ table, op: 'eq', column, value }); return query; },
        order() { return query; },
        async single() {
          const found = rows();
          return found.length === 1 ? { data: found[0], error: null } : { data: null, error: { code: 'PGRST116' } };
        },
        then(resolve, reject) {
          const answer = tables[table] instanceof Error ? { data: null, error: tables[table] } : { data: rows(), error: null };
          return Promise.resolve(answer).then(resolve, reject);
        },
        async upsert(payload, opts) { calls.push({ table, op: 'upsert', rows: plain(payload), opts }); return { error: null }; },
      };
      return query;
    },
  };
}

function ownsLocalDataIn({ useSupabase = true, adminId = ADMIN } = {}) {
  return vm.runInNewContext(`(${sourceOf('ownsLocalData')})`, {
    useSupabase,
    getAdminUserId: async () => { if (adminId instanceof Error) throw adminId; return adminId; },
  });
}

test('the guard tells view-only GETs from authenticated routes', () => {
  const start = server.indexOf('const VIEW_ONLY_PATHS');
  const end = server.indexOf('\n\n', server.indexOf('const isViewOnlyGet'));
  const classify = vm.runInNewContext(`(method, path) => { ${server.slice(start, end)}; return isViewOnlyGet; }`, { Set });
  for (const path of ['/api/applications', '/api/pipeline', '/api/reports', '/api/reports/277-acme-2026-09-30.md', '/api/cvs', '/api/cvs/cv.pdf', '/api/portals', '/api/queries', '/api/scan-state', '/api/scan-sources', '/api/profile', '/api/profile/cv', '/api/profile/context', '/api/monetization/affiliates', '/api/apply/bridge-status', '/api/apply/extension.zip']) {
    assert.equal(classify('GET', path), true, `GET ${path} answers without a token`);
  }
  for (const [method, path] of [['GET', '/api/profile/status'], ['POST', '/api/pipeline'], ['PATCH', '/api/portals'], ['GET', '/api/apply/preview'], ['GET', '/api/apply/runs/abc'], ['POST', '/api/apply/start'], ['GET', '/api/me']]) {
    assert.equal(classify(method, path), false, `${method} ${path} needs a token`);
  }
});

test('a token sent to any view-only GET is resolved, and a bad one is a 401', () => {
  assert.ok(!server.includes('OPTIONAL_AUTH_PROFILE_PATHS'), 'no longer limited to the profile paths');
  const guard = server.slice(server.indexOf('if (useSupabase && isViewOnlyGet) {'), server.indexOf('// ── Monetization'));
  assert.ok(guard.length > 0 && guard.length < 1200, 'the optional-auth block sits right before the monetization routes');
  assert.ok(guard.includes("String(req.headers['authorization'] || '').startsWith('Bearer ') || urlObj.searchParams.has('_token')"));
  assert.ok(guard.includes("if (!user) return json(res, { error: 'Unauthorized' }, 401);"));
  assert.ok(guard.includes('req.userId = user.id;') && guard.includes('req.userEmail = user.email;'));
  assert.ok(guard.includes('req.isAdmin = await isAdminUser(user.id, user.email);'));
});

test('viewOnlyScope: the admin and anonymous callers read unscoped, any other account its own rows', () => {
  const viewOnlyScope = vm.runInNewContext(`(${sourceOf('viewOnlyScope')})`, {});
  assert.equal(viewOnlyScope({}), undefined, 'anonymous view-only (and local mode)');
  assert.equal(viewOnlyScope({ userId: ADMIN, isAdmin: true }), undefined, "the admin's dashboard, as before");
  assert.equal(viewOnlyScope({ userId: OTHER, isAdmin: false }), OTHER);
});

test('the view-only row routes read through viewOnlyScope, never req.userId', () => {
  const routes = {
    "if (path === '/api/applications' && method === 'GET')": 'getApplications(viewOnlyScope(req))',
    "if (path === '/api/reports' && method === 'GET')": 'getReports(viewOnlyScope(req))',
    "if (path.startsWith('/api/reports/') && method === 'GET')": 'getReport(filename, viewOnlyScope(req))',
    "if (path === '/api/monetization/affiliates' && method === 'GET')": 'getReport(report, viewOnlyScope(req))',
  };
  for (const [condition, call] of Object.entries(routes)) {
    const block = routeBlock(condition);
    assert.ok(block.includes(call), `${condition} → ${call}`);
    assert.ok(!block.includes('req.userId'), `${condition} does not read req.userId`);
  }
  const pipeline = routeBlock("if (path === '/api/pipeline') {");
  assert.ok(pipeline.includes("if (method === 'GET') return json(res, await getPipeline(viewOnlyScope(req)));"));
  assert.ok(pipeline.includes("addToPipeline(url, note || '', req.userId)") && pipeline.includes('removeManyFromPipeline(validUrls, req.userId)'), 'writes stay on the account');
});

test("output/ PDFs are the owner's: a scoped account lists none and opens none", () => {
  const list = routeBlock("if (path === '/api/cvs' && method === 'GET')");
  assert.ok(list.indexOf('if (viewOnlyScope(req)) return json(res, []);') >= 0);
  assert.ok(list.indexOf('if (viewOnlyScope(req)) return json(res, []);') < list.indexOf('getCVs()'));
  const file = routeBlock("if (path.startsWith('/api/cvs/') && method === 'GET')");
  assert.ok(file.indexOf("if (viewOnlyScope(req)) return json(res, { error: 'File not found' }, 404);") >= 0);
  assert.ok(file.indexOf("if (viewOnlyScope(req)) return json(res, { error: 'File not found' }, 404);") < file.indexOf('readFile('));
});

test('ownsLocalData: the files on disk belong to unscoped reads and the admin only', async () => {
  assert.equal(await ownsLocalDataIn({ useSupabase: false })(OTHER), true, 'local single-user mode');
  const owns = ownsLocalDataIn();
  assert.equal(await owns(undefined), true);
  assert.equal(await owns(ADMIN), true);
  assert.equal(await owns(OTHER), false);
  assert.equal(await ownsLocalDataIn({ adminId: null })(OTHER), false, 'no admin found: nobody but an unscoped read');
  assert.equal(await ownsLocalDataIn({ adminId: new Error('network') })(ADMIN), false, 'a failed lookup never opens the files');
});

const REMOTE_APPS = [
  { num: 1, company: 'Owner Co', user_id: ADMIN },
  { num: 2, company: 'Other Co', user_id: OTHER },
];
const MARKDOWN_APPS = [{ '#': '1', Company: 'Owner Co' }, { '#': '3', Company: 'Owner local only' }];

function getApplicationsIn({ remote = REMOTE_APPS, vercel = false, calls = [] } = {}) {
  return vm.runInNewContext(`(${sourceOf('getApplications')})`, {
    useSupabase: true,
    IS_VERCEL: vercel,
    supabase: fakeSupabase({ applications: remote }, calls),
    readMarkdownApplications: async () => { calls.push({ op: 'markdown' }); return MARKDOWN_APPS; },
    applicationIdentityNum: vm.runInNewContext(`(${sourceOf('applicationIdentityNum')})`, { parseInt, Number }),
    enrichApplicationsWithJobUrl: async apps => apps,
    ownsLocalData: ownsLocalDataIn(),
    console: { warn() {} },
  });
}

const nums = apps => plain(apps).map(app => Number(app.num ?? app['#']));

test("getApplications: another account gets its own rows, never the owner's tracker", async () => {
  const calls = [];
  assert.deepEqual(nums(await getApplicationsIn({ calls })(OTHER)), [2]);
  assert.ok(calls.some(c => c.op === 'eq' && c.column === 'user_id' && c.value === OTHER));
  assert.ok(!calls.some(c => c.op === 'markdown'), 'data/applications.md is not even read');

  const failed = [];
  await assert.rejects(getApplicationsIn({ remote: new Error('supabase down'), calls: failed })(OTHER), /supabase down/);
  assert.ok(!failed.some(c => c.op === 'markdown'), 'no fallback to the owner tracker');
});

test('getApplications: the unscoped read and the admin id keep the local tracker rows', async () => {
  assert.deepEqual(nums(await getApplicationsIn()(undefined)), [1, 2, 3], 'unscoped, as the admin dashboard reads it');
  assert.deepEqual(nums(await getApplicationsIn()(ADMIN)), [1, 3], "the admin's authenticated routes, unchanged");
  assert.deepEqual(nums(await getApplicationsIn({ remote: new Error('down') })(ADMIN)), [1, 3], 'markdown fallback for the owner');
});

test("enrichApplicationsWithJobUrl: no URL from the owner's report history for another account", async () => {
  const lookups = [];
  const enrich = userId => vm.runInNewContext(`(${sourceOf('enrichApplicationsWithJobUrl')})`, {
    ownsLocalData: ownsLocalDataIn(),
    extractReportFilename: cell => cell,
    getReport: async () => { throw new Error('Report not found'); },
    extractJobUrlFromReport: () => '',
    findHistoricJobUrl: async (company, role) => { lookups.push([company, role]); return 'https://jobs.example/owner-history'; },
    Promise,
  })([{ Company: 'Acme', Role: 'Designer', Report: '007-acme.md' }], userId);
  assert.deepEqual(plain(await enrich(OTHER)), [{ Company: 'Acme', Role: 'Designer', Report: '007-acme.md' }]);
  assert.equal(lookups.length, 0);
  assert.equal(plain(await enrich(undefined))[0].JobURL, 'https://jobs.example/owner-history');
});

const REPORTS = [
  { filename: '001-owner.md', content: 'owner report', user_id: ADMIN },
  { filename: '002-other.md', content: 'other report', user_id: OTHER },
  { filename: '000-legacy.md', content: 'legacy report', user_id: null },
];

function getReportIn(calls = []) {
  return vm.runInNewContext(`(${sourceOf('getReport')})`, {
    useSupabase: true,
    supabase: fakeSupabase({ reports: REPORTS }, calls),
    ownsLocalData: ownsLocalDataIn(),
    readFile: async file => {
      calls.push({ op: 'disk', file });
      if (file === 'root/reports/099-disk-only.md') return 'disk report';
      throw Object.assign(new Error(`ENOENT: ${file}`), { code: 'ENOENT' });
    },
    join: (...parts) => parts.join('/'),
    ROOT: 'root',
    Object,
    Error,
  });
}

test("getReport: another account reads its own report and gets a 404 for anyone else's", async () => {
  assert.equal(await getReportIn()('002-other.md', OTHER), 'other report');
  for (const filename of ['001-owner.md', '000-legacy.md', '099-disk-only.md']) {
    const calls = [];
    await assert.rejects(getReportIn(calls)(filename, OTHER), err => err.statusCode === 404 && err.message === 'Report not found', filename);
    assert.equal(calls.filter(c => c.op === 'select').length, 1, `${filename}: only the user_id-filtered query`);
    assert.ok(!calls.some(c => c.op === 'disk'), `${filename}: the disk is never read`);
  }
});

test('getReport: the unscoped read and the admin keep both fallbacks', async () => {
  const read = getReportIn();
  assert.equal(await read('000-legacy.md', undefined), 'legacy report');
  assert.equal(await read('002-other.md', undefined), 'other report', 'anonymous view-only is unchanged (readiness item 1)');
  assert.equal(await read('099-disk-only.md', undefined), 'disk report');
  assert.equal(await read('001-owner.md', ADMIN), 'owner report');
  assert.equal(await read('000-legacy.md', ADMIN), 'legacy report');
  assert.equal(await read('099-disk-only.md', ADMIN), 'disk report');
});

function getPipelineIn(calls = []) {
  return vm.runInNewContext(`(${sourceOf('getPipeline')})`, {
    useSupabase: true,
    supabase: fakeSupabase({
      pipeline: [
        { url: 'https://jobs.example/a', processed: false, user_id: ADMIN },
        { url: 'https://jobs.example/b', processed: false, user_id: OTHER },
      ],
    }, calls),
    ownsLocalData: ownsLocalDataIn(),
    readLatestPipelineRecords: async () => {
      calls.push({ op: 'jsonl' });
      return new Map([['https://jobs.example/b', { jev_fit: 'scored against the owner profile' }]]);
    },
    visiblePipelineItems: (items, records) => items.map(item => ({ ...item, ...(records.get(item.url) || {}) })),
    getProcessedPipelineUrlKeys: async () => new Set(),
    getOrphanedScanPipelineItems: async () => { calls.push({ op: 'scan-history' }); return [{ url: 'https://jobs.example/orphan', scan_history_orphan: true }]; },
    withoutSuppressedOrphans: orphans => orphans,
    console: { warn() {} },
  });
}

test("getPipeline: another account gets its own rows, without the owner's triage or scan history", async () => {
  const calls = [];
  assert.deepEqual(plain(await getPipelineIn(calls)(OTHER)), [{ url: 'https://jobs.example/b', processed: false, user_id: OTHER }]);
  assert.ok(!calls.some(c => c.op === 'jsonl' || c.op === 'scan-history'));
});

test('getPipeline: the unscoped read keeps the overlay and the scan-history orphans', async () => {
  const items = plain(await getPipelineIn()(undefined));
  assert.deepEqual(items.map(item => item.url), ['https://jobs.example/a', 'https://jobs.example/b', 'https://jobs.example/orphan']);
  assert.equal(items[1].jev_fit, 'scored against the owner profile');
});

test("syncLocalApplicationsToSupabase pushes the owner's tracker under the admin id, never another account's", async () => {
  const pushedAs = async (userId, { localSyncDisabled = false, callsOut = [] } = {}) => {
    const calls = callsOut;
    await vm.runInNewContext(`(${sourceOf('syncLocalApplicationsToSupabase')})`, {
      useSupabase: true,
      LOCAL_SYNC_DISABLED: localSyncDisabled,
      supabase: fakeSupabase({}, calls),
      createHash,
      lastAppsSyncHash: new Map(),
      join: (...parts) => parts.join('/'),
      WRITE_ROOT: 'root',
      readFile: async () => '| # | Company |',
      parseApplicationsMarkdown: () => [{ num: 1, job_url: '' }, { num: 2, job_url: 'https://jobs.example/2' }],
      ownsLocalData: ownsLocalDataIn(),
      getAdminUserId: async () => ADMIN,
      console: { log() {}, error() {} },
    })(userId);
    const upsert = calls.find(c => c.op === 'upsert');
    if (localSyncDisabled) return upsert;
    assert.equal(upsert.opts.onConflict, 'num');
    return [...new Set(upsert.rows.map(row => row.user_id))];
  };
  assert.deepEqual(await pushedAs(OTHER), [ADMIN], 'the upsert on num used to hand every owner row to this account');
  assert.deepEqual(await pushedAs(ADMIN), [ADMIN]);
  assert.deepEqual(await pushedAs(null), [ADMIN], 'the watcher and the startup sync');
  const calls = [];
  assert.equal(await pushedAs(null, { localSyncDisabled: true, callsOut: calls }), undefined, 'JOBYOUGO_NO_LOCAL_SYNC: a test server never writes the owner rows');
  assert.equal(calls.length, 0);
});

test('a second server can turn off the startup purge, the applications sync and the reports/ watcher', () => {
  assert.match(server, /const LOCAL_SYNC_DISABLED = \/\^\(1\|true\|yes\)\$\/i\.test\(String\(process\.env\.JOBYOUGO_NO_LOCAL_SYNC/);
  assert.ok(server.includes('if (!IS_VERCEL && !LOCAL_SYNC_DISABLED) {'), 'startup purge-stale + sync');
  assert.ok(server.includes('if (useSupabase && !IS_VERCEL && LOCAL_SYNC_DISABLED) {'), 'no watcher');
});

test('maintenance scripts (/api/run/*) are the owner account\'s only', () => {
  const start = server.indexOf("if (path.startsWith('/api/run/') && method === 'POST') {");
  const block = server.slice(start, server.indexOf('const result = await runScript(script);', start));
  assert.ok(start > 0 && block.includes('if (useSupabase && !(await isAdminUser(req.userId, req.userEmail))) {'));
  assert.ok(block.indexOf('403') < block.indexOf("const script = path.slice('/api/run/'.length);"), 'refused before anything runs');
});

test('on Vercel a report row belongs to the account that ran the evaluation, like its tracker row', () => {
  const start = server.indexOf('// On Vercel, also sync report directly to Supabase');
  const block = server.slice(start, server.indexOf("await supabase.from('reports').upsert(row, { onConflict: 'filename' });", start));
  assert.ok(block.includes('const uid = req.userId || await getAdminUserId().catch(() => null);'));
  assert.ok(block.includes('if (uid) row.user_id = uid;') && !block.includes('row.user_id = adminId'));
});

test('every account may apply: each request gets its own account\'s plugin bridge', () => {
  assert.ok(!server.includes('Auto-apply is only available on the owner account'), 'the owner-only 403 is gone');
  const pick = "const applyBridge = path.startsWith('/api/apply/') ? applyBridges.forAccount(applyAccountOf(req.userId)) : null;";
  const at = server.indexOf(pick);
  assert.ok(at > server.indexOf('if (useSupabase && isViewOnlyGet) {'), 'after the auth guards set req.userId');
  for (const route of ['/api/apply/bridge-status', '/api/apply/bridge-pair', '/api/apply/open-offer', '/api/apply/show-helper', '/api/apply/preview', '/api/apply/start', "path.startsWith('/api/apply/runs/')"]) {
    const first = server.indexOf(route.startsWith('path') ? route : `'${route}'`, server.indexOf('// ── Auto-apply'));
    assert.ok(first > at, `${route} uses the account's bridge`);
  }
  // No route reaches a bridge but the account's own.
  assert.ok(!/\bapplyBridges\.(bridges|unpaired)\b/.test(server));
  assert.equal(server.match(/applyBridges\.forAccount\(/g).length, 1);
  // Every spec is built with the signed-in account's context (its CV PDF).
  let from = 0;
  for (;;) {
    const call = server.indexOf('buildApplySpec({', from);
    if (call < 0) break;
    assert.ok(server.slice(call, call + 900).includes('...(await loadApplyContext(req.userId, report)),'), 'buildApplySpec takes loadApplyContext');
    from = call + 1;
  }
});

test('an apply run records who started it before its spec, and only the owner falls back to Playwright', () => {
  const block = routeBlock("if (path === '/api/apply/start' && method === 'POST') {");
  const owner = block.indexOf("join(runDir, 'owner.json')");
  assert.ok(owner > 0 && owner < block.indexOf("join(runDir, 'spec.json')"));
  const refuse = block.indexOf('if (!tabId && !ownerRun) {');
  assert.ok(refuse > 0 && refuse < block.indexOf("spawn('node', ['apply-runner.mjs'"), 'no Playwright window for another account');
  assert.ok(refuse < block.indexOf('await mkdir(runDir'), 'refused before a run folder exists');
});

test('a run is read and steered only by the account that started it', async () => {
  const runs = server.slice(server.indexOf("if (path.startsWith('/api/apply/runs/')) {"));
  const check = runs.indexOf('if (!(await applyRunVisibleTo(runDir, req.userId))) {');
  assert.ok(check > 0);
  for (const use of ["join(runDir, shot)", "join(runDir, 'state.json')", "join(runDir, 'command.json')"]) {
    assert.ok(runs.indexOf(use) > check, `${use} after the ownership check`);
  }
  const files = { '/runs/a/owner.json': JSON.stringify({ userId: OTHER }) };
  const visible = (supabaseOn) => vm.runInNewContext(`(${sourceOf('applyRunVisibleTo')})`, {
    useSupabase: supabaseOn,
    JSON,
    Boolean,
    join: (...parts) => parts.join('/'),
    readFile: async (p) => { if (p in files) return files[p]; throw new Error('ENOENT'); },
    ownsLocalData: async (id) => id === ADMIN,
  });
  assert.equal(await visible(true)('/runs/a', OTHER), true);
  assert.equal(await visible(true)('/runs/a', ADMIN), false, 'not even the admin');
  assert.equal(await visible(true)('/runs/a', undefined), false);
  // Runs from before owner.json are the owner's.
  assert.equal(await visible(true)('/runs/old', ADMIN), true);
  assert.equal(await visible(true)('/runs/old', OTHER), false);
  assert.equal(await visible(false)('/runs/a', undefined), true, 'local mode has one user');
});

test('a plugin joins only the account whose pairing token it holds', async () => {
  const written = {};
  const ctx = {
    useSupabase: true,
    bridgePairs: null,
    BRIDGE_PAIRS_FILE: '/w/pairs.json',
    BRIDGE_PAIRS_PER_ACCOUNT: 2,
    Map, Object, JSON, Date, Buffer,
    readFile: async (p) => { if (p in written) return written[p]; throw new Error('ENOENT'); },
    writeFile: async (p, body) => { written[p] = body; },
    mkdir: async () => {},
    dirname: (p) => p.split('/').slice(0, -1).join('/'),
    randomBytes: (n) => ({ toString: () => `tok${Object.keys(written).length}-${Math.random().toString(36).slice(2)}${'x'.repeat(n)}` }),
    isAccountId: (id) => id === 'acct-a' || id === 'acct-b',
  };
  vm.createContext(ctx);
  vm.runInContext(`const hashPairToken = (token) => 'h:' + [...token].reverse().join('');\n${sourceOf('loadBridgePairs')}\n${sourceOf('issueBridgePairToken')}\n${sourceOf('accountOfPairToken')}\nthis.issue = issueBridgePairToken; this.resolve = accountOfPairToken;`, ctx);
  const a1 = await ctx.issue('acct-a');
  const b1 = await ctx.issue('acct-b');
  assert.equal(await ctx.resolve(a1), 'acct-a');
  assert.equal(await ctx.resolve(b1), 'acct-b');
  assert.equal(await ctx.resolve(''), null);
  assert.equal(await ctx.resolve('made-up'), null);
  assert.ok(!written['/w/pairs.json'].includes(a1), 'only hashes are stored');
  // Past the per-account cap the oldest token stops working.
  await ctx.issue('acct-a');
  await ctx.issue('acct-a');
  assert.equal(await ctx.resolve(a1), null);
  assert.equal(await ctx.resolve(b1), 'acct-b');
  ctx.useSupabase = false;
  assert.equal(await ctx.resolve(''), 'local');
});

test('another account applies with its own CV PDF and letters, never output/', async () => {
  const load = vm.runInNewContext(`(${sourceOf('loadApplyContext')})`, {
    useSupabase: true,
    String,
    WRITE_ROOT: '/w',
    getReport: async () => 'report',
    getProfile: async () => ({}),
    getCvMarkdown: async () => 'cv',
    ownsLocalData: async (id) => id === ADMIN,
    fillProfileGaps: (stored) => stored,
    readLocalProfile: async () => ({ candidate: { apply_cv: 'Local_CV.pdf' } }),
    preferLocalApplyCv: (profile, local) => ({ ...profile, candidate: { ...(profile.candidate || {}), apply_cv: local.candidate.apply_cv } }),
    access: async () => {},
    join: (...parts) => parts.join('/'),
    ROOT: '/r',
    console: { log() {} },
    applyAccountOf: (id) => id,
    readAccountCv: async (_root, account) => (account === OTHER ? { path: '/w/other/cv/Jane.pdf' } : null),
    accountLettersDir: (root, id) => `${root}/${id}/letters`,
  });
  const other = await load(OTHER, 'r.md');
  assert.equal(other.accountCvPath, '/w/other/cv/Jane.pdf');
  assert.equal(other.letterDir, `/w/${OTHER}/letters`);
  // The owner without an upload keeps the profile's apply_cv in output/.
  const admin = await load(ADMIN, 'r.md');
  assert.equal(admin.accountCvPath, undefined);
  assert.equal(admin.letterDir, undefined);
  // The owner's config/profile.yml apply_cv and cv.md win over the stored row.
  assert.equal(admin.profile.candidate.apply_cv, 'Local_CV.pdf');
  assert.equal(admin.cvMarkdown, null, 'owner with cv.md on disk: read it');
  assert.equal(other.cvMarkdown, 'cv');
  assert.equal(other.profile.candidate, undefined, 'another account never gets the owner apply_cv');
  const third = await load('third-id', 'r.md');
  assert.equal(third.accountCvPath, null, 'no upload: no CV, output/ is not searched');
});

test('/output/ serves files of output/ only', () => {
  const block = routeBlock("if (path.startsWith('/output/') && path.endsWith('.pdf')) {");
  assert.ok(block.includes("safeJoin(join(ROOT, 'output'), filename)"));
  assert.ok(!block.includes("readFile(join(ROOT, 'output', filename))"));
});

test('getAdminUserId matches ADMIN_EMAIL whatever its case, like isAdminUser', async () => {
  const getAdminUserId = vm.runInNewContext(`(${sourceOf('getAdminUserId')})`, {
    _adminUserId: null,
    useSupabase: true,
    String,
    process: { env: { ADMIN_EMAIL: ' Owner@Example.com ' } },
    supabase: {
      auth: { admin: { listUsers: async () => ({ data: { users: [{ id: OTHER, email: 'someone@example.com' }, { id: ADMIN, email: 'owner@example.com' }] } }) } },
      from() { throw new Error('the first-application fallback is not reached'); },
    },
  });
  assert.equal(await getAdminUserId(), ADMIN);
});

test('getAdminUserId without ADMIN_EMAIL fails closed: no owner, never the first applications row', async () => {
  const warnings = [];
  const getAdminUserId = vm.runInNewContext(`(${sourceOf('getAdminUserId')})`, {
    _adminUserId: null,
    _adminEmailWarned: false,
    useSupabase: true,
    String,
    console: { warn: message => warnings.push(message) },
    process: { env: {} },
    supabase: {
      auth: { admin: { listUsers: async () => { throw new Error('no lookup without ADMIN_EMAIL'); } } },
      from() { throw new Error('the first-application fallback is not reached'); },
    },
  });
  assert.equal(await getAdminUserId(), null);
  assert.equal(await getAdminUserId(), null);
  assert.equal(warnings.length, 1, 'warned once');
  assert.match(warnings[0], /ADMIN_EMAIL is not set/);
  assert.match(readFileSync(join(ROOT, '.env.example'), 'utf8'), /^# ADMIN_EMAIL=/m, 'documented in .env.example');
});

test('another account never writes the owner\'s data/applications.md', () => {
  const patch = routeBlock("if (path.startsWith('/api/applications/') && method === 'PATCH')");
  assert.ok(patch.includes('if (await ownsLocalData(req.userId)) await writeMarkdownApplicationStatus(num, status, statusSource).catch(() => {});'));
  const del = routeBlock("if (path.startsWith('/api/applications/') && method === 'DELETE')");
  assert.ok(del.includes("if (await ownsLocalData(req.userId)) await writeMarkdownApplicationStatus(num, 'Discarded', { via: 'ui-delete' }).catch(() => {});"));
  const bulk = routeBlock("if (path === '/api/applications/bulk-discard-stale' && method === 'POST')");
  // Supabase mode writes the owner's tracker only, in one pass after the update.
  const ownerGuard = bulk.indexOf('if (rows.length && await ownsLocalData(req.userId)) {');
  assert.ok(ownerGuard > 0 && ownerGuard < bulk.indexOf("await writeMarkdownApplicationStatuses(rows.map(row => row.num), 'Discarded', source, { onlyFrom: sweepFrom })"));
  // Besides the guarded calls, only the local (single-user) branches write it.
  for (const block of [patch, del]) {
    const calls = block.split('\n').filter(line => line.includes('writeMarkdownApplicationStatus('));
    assert.ok(calls.every(line => /ownsLocalData\(req\.userId\)|const updated = /.test(line)), calls.join(' | '));
  }
});

test('Jev triage reads the same profile as the scan: the account row, filled from profile.yml for the owner only', async () => {
  const triage = routeBlock("if (path === '/api/pipeline/jev-triage' && method === 'POST')");
  assert.ok(triage.includes('? await getAccountProfile(req.userId, await ownsLocalData(req.userId)).catch(() => ({}))'));
  assert.ok(!triage.includes("join(ROOT, 'config/profile.yml')"), 'no whole-file replacement of the row');
  assert.ok(server.includes('? getAccountProfile(req.userId, ownerFiles)'), 'the scan route uses the same helper');
  const local = { target_roles: { primary: ['Designer'] }, location: { city: 'Paris', remote_policy: 'Full remote required' } };
  const getAccountProfile = vm.runInNewContext(`(${sourceOf('getAccountProfile')})`, {
    Object,
    getProfile: async () => ({ location: { city: 'Lyon' } }),
    readLocalProfile: async () => local,
    fillProfileGaps: (stored, fallback) => ({ ...fallback, ...stored, location: { ...fallback.location, ...stored.location } }),
  });
  assert.deepEqual(plain(await getAccountProfile(ADMIN, true)).location, { city: 'Lyon', remote_policy: 'Full remote required' });
  assert.deepEqual(plain(await getAccountProfile(OTHER, false)), { location: { city: 'Lyon' } });
});

test('getRequestUser: parallel requests with one token share a single lookup; a bad token is not cached', async () => {
  const lookups = [];
  const getRequestUser = vm.runInNewContext(`(${sourceOf('getRequestUser')})`, {
    useSupabase: true,
    URL,
    Date,
    authUserCache: new Map(),
    authUserPending: new Map(),
    AUTH_CACHE_MS: 60_000,
    AUTH_CACHE_MAX: 500,
    supabase: {
      auth: {
        async getUser(token) {
          lookups.push(token);
          await new Promise(resolve => setTimeout(resolve, 5));
          return token === 'good'
            ? { data: { user: { id: OTHER, email: 'other@example.com' } }, error: null }
            : { data: { user: null }, error: { message: 'invalid JWT' } };
        },
      },
    },
  });
  const request = token => ({ url: '/api/reports', headers: { authorization: `Bearer ${token}` } });
  const users = await Promise.all(Array.from({ length: 6 }, () => getRequestUser(request('good'))));
  assert.ok(users.every(user => user?.id === OTHER));
  assert.equal(await getRequestUser(request('good')).then(user => user.id), OTHER, 'then from the cache');
  assert.deepEqual(lookups, ['good']);
  assert.equal(await getRequestUser(request('bad')), null);
  assert.equal(await getRequestUser(request('bad')), null);
  assert.deepEqual(lookups, ['good', 'bad', 'bad']);
  assert.equal(await getRequestUser({ url: '/api/reports', headers: {} }), null, 'no token, no lookup');
  assert.equal(lookups.length, 3);
});
