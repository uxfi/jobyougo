// The profile routes of ui/server.mjs: the server starts on import, so the
// routes are checked from the source and the helpers they use are run on
// their own (readBody is evaluated from the source text in a sandbox).
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { CV_IMAGES_MAX_CHARS, validateCvParseRequest } from '../lib/cv-import.mjs';
import { isMissingColumnError, mergeProfileSections, missingColumnName, profileToRow, sanitizeProfileInput } from '../lib/profile-shape.mjs';

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

const readBody = vm.runInNewContext(`(${sourceOf('readBody')})`, { Buffer, JSON, Error, Math, Promise });

function fakeRequest(chunks) {
  const req = new EventEmitter();
  req.resume = () => {};
  setImmediate(() => {
    for (const chunk of chunks) req.emit('data', chunk);
    req.emit('end');
  });
  return req;
}

test('readBody decodes UTF-8 once, so a character split across chunks survives', async () => {
  const bytes = Buffer.from(JSON.stringify({ markdown: 'Expérience — Zürich 日本' }), 'utf8');
  const cut = bytes.indexOf(Buffer.from('é')) + 1;
  const body = await readBody(fakeRequest([bytes.subarray(0, cut), bytes.subarray(cut)]));
  assert.equal(body.markdown, 'Expérience — Zürich 日本');
  assert.deepEqual(await readBody(fakeRequest([])), {});
});

test('readBody refuses an oversized body with 413 and bad JSON with 400', async () => {
  await assert.rejects(readBody(fakeRequest([Buffer.alloc(600), Buffer.alloc(600)]), { limit: 1000 }), err => err.statusCode === 413);
  await assert.rejects(readBody(fakeRequest([Buffer.from('{oops')])), err => err.statusCode === 400 && err.message === 'Invalid JSON');
});

test('thrown statuses reach the client; others stay 500', () => {
  assert.match(server, /const ERROR_STATUSES = new Set\(\[400, 404, 409, 413, 422, 429, 502, 503\]\)/);
  assert.match(server, /const status = ERROR_STATUSES\.has\(err\?\.statusCode\) \? err\.statusCode : 500;\n\s+if \(status === 500\) console\.error\(err\);\n\s+json\(res, \{ error: err\?\.message \|\| 'Server error' \}, status\);/);
});

test('signed-in reads of the view-only profile paths resolve the user', () => {
  // The optional resolution now covers every view-only GET, the profile
  // paths included (tests/server-view-only-routes.test.mjs has the rest).
  assert.ok(server.includes('if (useSupabase && isViewOnlyGet) {'));
  const guard = server.slice(server.indexOf('if (useSupabase && isViewOnlyGet) {'), server.indexOf('// ── Monetization'));
  assert.ok(guard.includes("startsWith('Bearer ')") && guard.includes("has('_token')"), 'header or _token');
  assert.ok(guard.includes('const user = await getRequestUser(req);'));
  assert.ok(guard.includes("if (!user) return json(res, { error: 'Unauthorized' }, 401);"), 'a bad token is not an anonymous read');
  assert.ok(guard.includes('req.userId = user.id;') && guard.includes('req.userEmail = user.email;'));
  // The apply PDF routes always need the account (no anonymous read).
  assert.ok(server.includes("const AUTH_REQUIRED_PROFILE_PATHS = new Set(['/api/profile/status', '/api/profile/cv-parse', '/api/profile/apply-cv', '/api/profile/apply-cv/file']);"));
  for (const route of ["if (path === '/api/profile') {", "if (path === '/api/profile/cv') {", "if (path === '/api/profile/context') {"]) {
    assert.ok(!routeBlock(route).includes('viewOnlyScope'), `${route} reads the account's own profile, the admin's included`);
  }
});

test('a storage failure never reads as an empty profile or CV', () => {
  const save = sourceOf('saveProfile');
  assert.ok(save.includes('const existing = await getProfile(userId);'), 'no .catch(() => ({})) before the merge');
  assert.ok(!/getProfile\(userId\)\.catch/.test(save));
  assert.ok(save.includes('const existing = await readLocalProfile();'));
  assert.ok(save.includes('return { profile: merged, degraded: true, missingColumns: [...profileMissingColumns] };')
    && save.includes('return { profile: merged, degraded: true, missingColumns: Object.keys(extended) };')
    && save.includes('return { profile: merged, degraded: false, missingColumns: [] };'), 'a partial save names the columns it left out');
  const local = sourceOf('readLocalProfile');
  assert.ok(local.includes("if (err?.code === 'ENOENT') return {};") && local.includes('throw err;'), 'only a missing file is {}');
  const cv = sourceOf('getCvMarkdown');
  assert.ok(cv.includes("if (error && error.code !== 'PGRST116') throw error;"));
  const status = sourceOf('getProfileStatus');
  assert.ok(!status.includes('.catch('), 'no swallowed errors');
  const route = routeBlock("if (path === '/api/profile/status' && method === 'GET')");
  assert.ok(route.includes('}, 503);'));
  const bundle = sourceOf('saveProfileBundle');
  assert.equal((bundle.match(/return \{ degraded/g) || []).length, 3, 'every save path reports degraded');
});

test('a table without the screening column keeps the other sections and names the missing one', async () => {
  const upserts = [];
  const saveProfile = vm.runInNewContext(`(${sourceOf('saveProfile')})`, {
    useSupabase: true, Date, Object, console: { warn() {} },
    profileExtendedColumnsMissing: false, profileExtendedColumnsCheckedAt: 0, profileMissingColumns: new Set(),
    getProfile: async () => ({}), mergeProfileSections, profileToRow, isMissingColumnError, missingColumnName,
    supabase: {
      from: () => ({
        async upsert(row) {
          upserts.push(Object.keys(row));
          return 'screening' in row
            ? { error: { code: 'PGRST204', message: "Could not find the 'screening' column of 'profiles' in the schema cache" } }
            : { error: null };
        },
      }),
    },
  });
  const result = await saveProfile({ candidate: { full_name: 'Ada' }, screening: { how_did_you_hear: 'LinkedIn' } }, 'user-1');
  assert.equal(result.degraded, true);
  assert.deepEqual([...result.missingColumns], ['screening']);
  assert.ok(upserts[1].includes('candidate') && !upserts[1].includes('screening'), 'the retry keeps the other extended columns');
});

test('PUT /api/profile sanitizes the body and reports a degraded save and the new updated_at', () => {
  const route = routeBlock("if (path === '/api/profile') {");
  assert.ok(route.includes('readBody(req, { limit: 3 * 1024 * 1024 })'), 'room for an inline photo');
  assert.ok(route.includes('profile: sanitizeProfileInput(body?.profile ?? body)'));
  const put = route.slice(route.indexOf("if (method === 'PUT')"));
  assert.ok(put.indexOf('await saveProfileBundle(bundle, req.userId)') < put.indexOf('getProfileUpdatedAt(req.userId)'), 'read after the write');
  assert.ok(put.includes('return json(res, { ok: true, degraded: Boolean(degraded), missing_columns: missingColumns || [], updated_at: await getProfileUpdatedAt(req.userId) });'));
  assert.equal((sourceOf('saveProfileBundle').match(/return \{ degraded, missingColumns \};/g) || []).length, 2, 'both Supabase paths pass the missing columns on');
});

test('GET /api/profile gives the local profile an account.updated_at too', () => {
  const route = routeBlock("if (path === '/api/profile') {");
  const get = route.slice(route.indexOf("if (method === 'GET')"), route.indexOf("if (method === 'PUT')"));
  assert.ok(get.includes('if (!useSupabase) return json(res, { ...profile, account: { updated_at: await getProfileUpdatedAt(req.userId) } });'));
  assert.ok(get.includes('return json(res, profile);'), 'the Supabase row already carries account.updated_at');
});

function updatedAtIn(context) {
  return vm.runInNewContext(`(${sourceOf('getProfileUpdatedAt')})`, { PROFILE_FILE: '', ...context });
}

function fakeSupabase(answer, calls = []) {
  const query = {
    select(columns) { calls.push(['select', columns]); return query; },
    eq(column, value) { calls.push(['eq', column, value]); return query; },
    async single() { if (answer instanceof Error) throw answer; return answer; },
  };
  return { from(table) { calls.push(['from', table]); return query; } };
}

test('getProfileUpdatedAt reads the row or the file, and a failed read is null', async () => {
  const calls = [];
  const remote = updatedAtIn({ useSupabase: true, supabase: fakeSupabase({ data: { updated_at: '2026-10-09T10:00:00+00:00' }, error: null }, calls) });
  assert.equal(await remote('u1'), '2026-10-09T10:00:00+00:00');
  assert.deepEqual(calls, [['from', 'profiles'], ['select', 'updated_at'], ['eq', 'id', 'u1']]);
  assert.equal(await updatedAtIn({ useSupabase: true, supabase: fakeSupabase({ data: null, error: { code: '500' } }) })('u1'), null);
  assert.equal(await updatedAtIn({ useSupabase: true, supabase: fakeSupabase(new Error('network')) })('u1'), null);
  assert.equal(await updatedAtIn({ useSupabase: true, supabase: fakeSupabase({ data: { updated_at: 'x' } }) })(undefined), null, 'no account, no row');

  const dir = mkdtempSync(join(tmpdir(), 'jobyougo-profile-mtime-'));
  try {
    const file = join(dir, 'profile.yml');
    writeFileSync(file, 'candidate: {}\n');
    const local = updatedAtIn({ useSupabase: false, stat, PROFILE_FILE: file });
    assert.equal(await local(undefined), statSync(file).mtime.toISOString());
    const missing = updatedAtIn({ useSupabase: false, stat, PROFILE_FILE: join(dir, 'none.yml') });
    assert.equal(await missing(undefined), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a 2.5 MB inline photo fits the PUT /api/profile body and survives the sanitizer', async () => {
  const photo = `data:image/jpeg;base64,${'A'.repeat(2_500_000 - 23)}`;
  const raw = Buffer.from(JSON.stringify({ profile: { candidate: { full_name: 'Jane', photo }, narrative: { exit_story: 'e'.repeat(9000) } } }), 'utf8');
  const body = await readBody(fakeRequest([raw]), { limit: 3 * 1024 * 1024 });
  const clean = sanitizeProfileInput(body.profile);
  assert.equal(clean.candidate.photo, photo);
  assert.equal(clean.narrative.exit_story.length, 9000);
});

test('PUT /api/profile/cv caps the size and refuses an accidental erase in words a user can act on', () => {
  const route = routeBlock("if (path === '/api/profile/cv') {");
  assert.ok(route.includes('readBody(req, { limit: 512 * 1024 })'));
  assert.ok(route.includes('markdown.length > 300_000') && route.includes('}, 413);'));
  assert.ok(route.includes('if (!markdown.trim() && body?.clear !== true) {') && route.includes('}, 409);'));
  assert.ok(route.includes("'Your stored CV was not erased: an empty CV can only replace it when you confirm the removal.'"));
  assert.ok(!route.includes('Send clear: true'), 'no API instruction in the message');
  // { markdown: '', clear: true } skips the guard and stores the empty CV.
  assert.ok(route.indexOf('await saveCvMarkdown(markdown, req.userId);') > route.indexOf('}, 409);'));
});

test('saveCvMarkdown stores an empty CV when asked to clear it', async () => {
  const written = [];
  const local = vm.runInNewContext(`(${sourceOf('saveCvMarkdown')})`, {
    String, useSupabase: false, WRITE_ROOT: 'root', join: (...parts) => parts.join('/'),
    writeFile: async (file, text) => { written.push([file, text]); },
  });
  await local('', undefined);
  assert.deepEqual(written, [['root/cv.md', '']]);
  const upserts = [];
  const remote = vm.runInNewContext(`(${sourceOf('saveCvMarkdown')})`, {
    String, useSupabase: true, supabase: { from: () => ({ upsert: async row => { upserts.push({ ...row }); return { error: null }; } }) },
  });
  await remote('', 'u1');
  assert.deepEqual(upserts, [{ id: 'u1', cv_markdown: '' }]);
});

test('POST /api/profile/cv-parse goes through lib/cv-import.mjs', () => {
  const route = routeBlock("if (path === '/api/profile/cv-parse' && method === 'POST')");
  assert.ok(route.includes('readBody(req, { limit: 6 * 1024 * 1024 })'));
  assert.ok(route.includes('validateCvParseRequest(body)'));
  assert.ok(route.indexOf('input.text.length < CV_MIN_CHARS') < route.indexOf('takeCvParseSlot('), 'short text is refused before it costs a slot');
  assert.equal((route.match(/takeCvParseSlot\(/g) || []).length, 1, 'one slot per request');
  assert.ok(route.includes('parseCvWithLlm({') && route.includes('chat,') && route.includes('models: MODELS,') && route.includes('now: new Date(),'));
  assert.ok(route.includes(': 502;'), 'model failures answer 502');
  assert.ok(!server.includes('CV_PARSE_SYSTEM_PROMPT') && !server.includes('parseCvForProfile'), 'the old prompt is gone');
  assert.match(server, /const CV_PARSE_PER_HOUR = 12;/);
});

test('validateCvParseRequest follows the contract', () => {
  const text = 'x'.repeat(300);
  const ok = validateCvParseRequest({
    markdown: `${text}\r\n`,
    links: ['https://linkedin.com/in/jane', 'mailto:j@x.io', 'javascript:alert(1)', 'file:///etc/passwd', 42, 'https://x.io/'.padEnd(600, 'a')],
    file_name: 'cv.pdf',
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.text, text);
  assert.deepEqual(ok.links, ['https://linkedin.com/in/jane', 'mailto:j@x.io', 'https://x.io/'.padEnd(500, 'a')], 'odd links are dropped, long ones clipped');
  assert.equal(ok.fileName, 'cv.pdf');
  assert.equal(validateCvParseRequest({ markdown: text, links: Array.from({ length: 60 }, (_, i) => `https://x.io/${i}`) }).links.length, 40);

  const image = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
  assert.equal(validateCvParseRequest({ markdown: '', images: [image] }).ok, true, 'a scan needs no text');
  assert.equal(validateCvParseRequest({ images: [image, image, image, image, image] }).status, 400);
  assert.equal(validateCvParseRequest({ images: ['data:image/gif;base64,R0lGOD=='] }).status, 400);
  assert.equal(validateCvParseRequest({ images: ['https://example.com/cv.png'] }).status, 400);
  const big = `data:image/png;base64,${'A'.repeat(CV_IMAGES_MAX_CHARS)}`;
  assert.equal(validateCvParseRequest({ images: [big] }).status, 413);
  assert.equal(validateCvParseRequest({ markdown: 12 }).status, 400);
  assert.equal(validateCvParseRequest({ links: 'https://x.io' , markdown: text }).status, 400);
  assert.equal(validateCvParseRequest({}).status, 400);
  assert.equal(validateCvParseRequest(null).status, 400);
});

test('chat() passes response_format through, fills meta, and estimates image calls sanely', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jobyougo-openrouter-'));
  process.env.AI_USAGE_LOG_PATH = join(dir, 'ledger.jsonl');
  process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
  const realFetch = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, opts) => {
    sent.push({ url, body: JSON.parse(opts.body) });
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ model: 'test/served-model', choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'length' }] }),
    };
  };
  try {
    const { chat, MODELS } = await import('../lib/openrouter.mjs');
    assert.equal(MODELS.QWEN_VL, 'qwen/qwen3-vl-30b-a3b-instruct');
    const meta = {};
    const image = `data:image/png;base64,${'A'.repeat(400_000)}`;
    const out = await chat({
      model: 'test/model',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'read' }, { type: 'image_url', image_url: { url: image } }] }],
      response_format: { type: 'json_object' },
      meta,
    });
    assert.equal(out, '{"ok":true}');
    assert.deepEqual(meta, { finish_reason: 'length', model: 'test/served-model' });
    assert.equal(sent.length, 1, 'no other request (no generation id, no stats lookup)');
    assert.deepEqual(sent[0].body.response_format, { type: 'json_object' });
    assert.equal(sent[0].body.messages[0].content[1].image_url.url, image, 'the image itself is sent untouched');
    await chat({ model: 'test/model', messages: [{ role: 'user', content: 'plain' }] });
    assert.equal('response_format' in sent[1].body, false, 'absent unless asked for');
    const ledger = readFileSync(process.env.AI_USAGE_LOG_PATH, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.ok(ledger[0].input_tokens < 1000, `estimated ${ledger[0].input_tokens} input tokens for one image, not the base64 length`);
  } finally {
    globalThis.fetch = realFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});
