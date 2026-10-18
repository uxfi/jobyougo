import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  accountCvDir, accountLettersDir, deleteAccountCv, isAccountId, readAccountCv, safePdfName, saveAccountCv,
} from '../lib/apply-account-files.mjs';
import { buildApplySpec, pickCoverLetterPath } from '../lib/apply-spec.mjs';
import { ApplyBridgeHub } from '../extension/apply-bridge-lib.mjs';

const A = '11111111-2222-4333-8444-555555555555';
const B = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const PDF = Buffer.from('%PDF-1.7\n% test\n');

test('account ids: a uuid or local, nothing that climbs out of the folder', () => {
  assert.ok(isAccountId(A));
  assert.ok(isAccountId('local'));
  for (const bad of ['', '..', '../x', 'owner', `${A}/..`, null, undefined, 42]) assert.equal(isAccountId(bad), false, String(bad));
  assert.throws(() => accountCvDir('/r', '../../etc'));
});

test('the PDF keeps a plain file name of its own', () => {
  assert.equal(safePdfName('Jane Doe – CV.pdf'), 'Jane Doe _ CV.pdf');
  assert.equal(safePdfName('../../config/profile.yml'), 'profile.yml.pdf');
  assert.equal(safePdfName('C:\\Users\\x\\Résumé.PDF'), 'Resume.pdf');
  assert.equal(safePdfName('.hidden.pdf'), 'hidden.pdf');
  assert.equal(safePdfName(''), 'CV.pdf');
});

test('each account keeps one CV PDF in its own folder', async () => {
  const root = await mkdtemp(join(tmpdir(), 'apply-files-'));
  assert.equal(await readAccountCv(root, A), null);
  const saved = await saveAccountCv(root, A, { fileName: 'Jane_CV.pdf', bytes: PDF });
  assert.equal(saved.path, join(accountCvDir(root, A), 'Jane_CV.pdf'));
  // Replacing it leaves a single file.
  await saveAccountCv(root, A, { fileName: 'Jane_CV_2026.pdf', bytes: PDF });
  assert.deepEqual(await readdir(accountCvDir(root, A)), ['Jane_CV_2026.pdf']);
  // Another account sees none of it.
  assert.equal(await readAccountCv(root, B), null);
  await deleteAccountCv(root, A);
  assert.equal(await readAccountCv(root, A), null);
});

test('only a real PDF under 5 MB is kept', async () => {
  const root = await mkdtemp(join(tmpdir(), 'apply-files-'));
  await assert.rejects(saveAccountCv(root, A, { fileName: 'cv.pdf', bytes: Buffer.from('<html>') }), /not a PDF/);
  await assert.rejects(saveAccountCv(root, A, { fileName: 'cv.pdf', bytes: Buffer.alloc(0) }), /empty/);
  const big = Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024)]);
  await assert.rejects(saveAccountCv(root, A, { fileName: 'cv.pdf', bytes: big }), /5 MB/);
});

async function reportRoot() {
  const root = await mkdtemp(join(tmpdir(), 'apply-spec-acct-'));
  await mkdir(join(root, 'output'));
  await writeFile(join(root, 'output', 'Owner_CV.pdf'), PDF);
  await writeFile(join(root, 'output', 'cover-letter-acme-designer-2026-10-10.pdf'), PDF);
  return root;
}
const REPORT = '# Acme — Designer\n\n**URL:** https://jobs.example.com/acme/1\n';
const PROFILE = { candidate: { full_name: 'Jane Doe', email: 'jane@example.com', apply_cv: 'Owner_CV.pdf' } };

test('an account run attaches its own CV and letters, never output/', async () => {
  const root = await reportRoot();
  const letters = accountLettersDir(root, A);
  await mkdir(letters, { recursive: true });
  await writeFile(join(letters, 'cover-letter-acme-designer-2026-10-11.pdf'), PDF);
  const cv = await saveAccountCv(root, A, { fileName: 'Jane.pdf', bytes: PDF });
  const base = { root, reportFilename: 'r.md', company: 'Acme', role: 'Designer', reportText: REPORT, profile: PROFILE, cvMarkdown: '' };
  const spec = await buildApplySpec({ ...base, accountCvPath: cv.path, letterDir: letters });
  assert.equal(spec.cvPath, cv.path);
  assert.equal(spec.coverLetterPath, join(letters, 'cover-letter-acme-designer-2026-10-11.pdf'));
  // No upload: the run refuses, even though the profile names a PDF in output/.
  await assert.rejects(buildApplySpec({ ...base, accountCvPath: null, letterDir: letters }), /No CV PDF on your account/);
  // An empty letters folder never falls back to output/.
  const spec2 = await buildApplySpec({ ...base, accountCvPath: cv.path, letterDir: join(root, 'nowhere') });
  assert.equal(spec2.coverLetterPath, null);
  // The owner (undefined) keeps the profile's apply_cv and output/ letters.
  const owner = await buildApplySpec(base);
  assert.equal(owner.cvPath, join(root, 'output', 'Owner_CV.pdf'));
  assert.equal(owner.coverLetterPath, join(root, 'output', 'cover-letter-acme-designer-2026-10-10.pdf'));
  assert.equal(await pickCoverLetterPath(root, 'Acme', 'Designer', letters), join(letters, 'cover-letter-acme-designer-2026-10-11.pdf'));
});

// ── Plugin routing ───────────────────────────────────────────────────────────
class FakeSocket extends EventEmitter {
  constructor() { super(); this.sent = []; this.closed = false; }
  send(raw) { this.sent.push(JSON.parse(raw)); }
  close() { this.closed = true; this.emit('close'); }
  say(msg) { this.emit('message', Buffer.from(JSON.stringify(msg))); }
}
const tick = () => new Promise((r) => setImmediate(r));
const hello = (pairToken) => ({ type: 'hello', version: '0.0.45', capabilities: ['page-helper', 'read-options'], pairToken });

test('a plugin reaches only the account whose token it sent', async () => {
  const hub = new ApplyBridgeHub({ resolveAccount: async (t) => ({ 'tok-a': A, 'tok-b': B }[t] || null) });
  const sa = new FakeSocket();
  const sb = new FakeSocket();
  const stranger = new FakeSocket();
  hub.attach(sa); hub.attach(sb); hub.attach(stranger);
  sa.say(hello('tok-a')); sb.say(hello('tok-b')); stranger.say(hello(''));
  await tick();
  assert.equal(hub.forAccount(A).socket, sa);
  assert.equal(hub.forAccount(B).socket, sb);
  assert.ok(hub.forAccount(A).capabilities.has('read-options'), 'the hello is replayed into the bridge');
  assert.equal(hub.forAccount(A).extensionVersion, '0.0.45');
  assert.deepEqual(stranger.sent.at(-1), { type: 'paired', ok: false });
  assert.deepEqual(sa.sent.at(-1), { type: 'paired', ok: true });
  // An account without a paired plugin gets a bridge that sends nothing.
  assert.equal(hub.forAccount(null).connected, false);
  assert.throws(() => hub.forAccount(null)._send({ type: 'open-tab' }), /no apply-bridge extension/);
  assert.equal(hub.forAccount('3' + A.slice(1)).connected, false);

  // A request to A goes to A's socket only, and its answer comes back.
  const opened = hub.forAccount(A).openTab('https://jobs.example.com/1');
  const req = sa.sent.at(-1);
  assert.equal(req.type, 'open-tab');
  assert.ok(!sb.sent.some((m) => m.type === 'open-tab') && !stranger.sent.some((m) => m.type === 'open-tab'));
  sa.say({ requestId: req.requestId, ok: true, tabId: 7 });
  assert.equal((await opened).tabId, 7);
});

test('re-pairing moves a plugin to the new account; closing it disconnects it', async () => {
  const hub = new ApplyBridgeHub({ resolveAccount: async (t) => ({ 'tok-a': A, 'tok-b': B }[t] || null) });
  const s = new FakeSocket();
  hub.attach(s);
  s.say(hello('tok-a'));
  await tick();
  const failed = assert.rejects(hub.forAccount(A).openTab('https://x.example'), /disconnected/);
  s.say({ type: 'pair', pairToken: 'tok-b' });
  await tick();
  await failed;
  assert.equal(hub.forAccount(A).connected, false);
  assert.equal(hub.forAccount(B).socket, s);
  assert.ok(hub.forAccount(B).capabilities.has('page-helper'));
  s.emit('close');
  assert.equal(hub.forAccount(B).connected, false);
});

test('a later pairing answer wins over a slower earlier one', async () => {
  let release;
  const slow = new Promise((r) => { release = r; });
  const hub = new ApplyBridgeHub({ resolveAccount: (t) => (t === 'tok-a' ? slow.then(() => A) : Promise.resolve(B)) });
  const s = new FakeSocket();
  hub.attach(s);
  s.say(hello('tok-a'));
  s.say({ type: 'pair', pairToken: 'tok-b' });
  await tick();
  release();
  await tick();
  assert.equal(hub.forAccount(B).socket, s);
  assert.equal(hub.forAccount(A).connected, false);
});
