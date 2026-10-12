// The dashboard (ui/index.html) and the sign-in page (ui/login.html) have no
// build step, so their profile, onboarding-gate and sign-out code is checked
// two ways: source assertions for the wiring, and behaviour tests on the pure
// helpers, cut out of the page source and run in a vm with a fake DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import * as yaml from 'js-yaml';
import { mergeProfileSections, sanitizeProfileInput } from '../lib/profile-shape.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const INDEX = read('ui/index.html');
const LOGIN = read('ui/login.html');

// ─── Source extraction ─────────────────────────────────────────────────────
// A small scanner that skips strings, template literals and comments, so a
// brace inside them does not end a declaration early.

function skipString(src, i) {
  const quote = src[i];
  i++;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\') { i += 2; continue; }
    if (quote === '`' && ch === '$' && src[i + 1] === '{') { i = skipBalanced(src, i + 1); continue; }
    if (ch === quote) return i + 1;
    i++;
  }
  throw new Error('unterminated string');
}

function skipBalanced(src, i) {
  let depth = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\'' || ch === '"' || ch === '`') { i = skipString(src, i); continue; }
    if (ch === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); continue; }
    if (ch === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 2; continue; }
    if (ch === '(' || ch === '{' || ch === '[') depth++;
    else if (ch === ')' || ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  throw new Error('unbalanced brackets');
}

function extractFunction(src, name) {
  const at = src.indexOf(`function ${name}(`);
  assert.ok(at >= 0, `function ${name} exists`);
  const start = src.startsWith('async ', at - 6) ? at - 6 : at;
  const paramsEnd = skipBalanced(src, src.indexOf('(', at));
  const end = skipBalanced(src, src.indexOf('{', paramsEnd));
  return src.slice(start, end);
}

function extractConst(src, name) {
  const at = src.indexOf(`const ${name} = `);
  assert.ok(at >= 0, `const ${name} exists`);
  let i = at + `const ${name} = `.length;
  i = src[i] === '{' || src[i] === '[' ? skipBalanced(src, i) : skipString(src, i);
  return `${src.slice(at, i)};`;
}

function loadHelpers(src, { consts = [], functions = [], globals = {} }) {
  const code = [
    ...consts.map(name => extractConst(src, name)),
    ...functions.map(name => extractFunction(src, name)),
    `({ ${[...consts, ...functions].join(', ')} })`,
  ].join('\n');
  return vm.runInContext(code, vm.createContext({ ...globals }));
}

// ─── Fake DOM ──────────────────────────────────────────────────────────────

function fakeElement(value = '') {
  return { value, style: {}, innerHTML: '' };
}

function fakeRow(orig, values) {
  return { __orig: orig, querySelector: (selector) => ({ value: values[selector] ?? '' }) };
}

function fakeDocument({ archRows = [], proofCards = [] } = {}) {
  const elements = new Map();
  return {
    elements,
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, fakeElement());
      return elements.get(id);
    },
    querySelectorAll(selector) {
      if (selector === '.arch-row') return archRows;
      if (selector === '#proofpoints-list .proof-card') return proofCards;
      return [];
    },
  };
}

const LIST_FIELDS = [
  ['prof-primary-roles', (p) => p.target_roles?.primary],
  ['prof-superpowers', (p) => p.narrative?.superpowers],
  ['prof-search-contract-types', (p) => p.search?.contract_types],
  ['prof-search-sectors', (p) => p.search?.sector_preferences],
  ['prof-search-geography', (p) => p.search?.geography_preferences],
  ['prof-search-must-haves', (p) => p.search?.must_haves],
  ['prof-search-nice-to-haves', (p) => p.search?.nice_to_haves],
  ['prof-search-deal-breakers', (p) => p.search?.deal_breakers],
];

// Puts a profile into the fake form the way renderProfile() does: list
// textareas through setProfileList(), archetype and proof-point rows carrying
// their original item as __orig.
function renderIntoFakeForm(profile) {
  const archRows = (profile.target_roles?.archetypes || []).map(a => fakeRow(a, {
    '.arch-name': a.name || '', '.arch-level': a.level || '', '.arch-fit': a.fit || 'primary',
  }));
  const proofCards = (profile.narrative?.proof_points || []).map(p => fakeRow(p, {
    '.proof-name': p.name || '', '.proof-metric': p.hero_metric || '', '.proof-url': p.url || '',
  }));
  const document = fakeDocument({ archRows, proofCards });
  const helpers = loadHelpers(INDEX, {
    functions: ['profileListLabel', 'restoreProfileList', 'setProfileList', 'getProfileList', 'rowOriginal', 'collectProfile'],
    globals: { document },
  });
  for (const [id, pick] of LIST_FIELDS) helpers.setProfileList(id, pick(profile));
  return { document, helpers, archRows, proofCards };
}

// ─── GATE-F1: no tab-wide deferral flag ────────────────────────────────────

test('dashboard and login read only the per-account deferral, never the tab-wide flag', () => {
  for (const [page, html] of [['index', INDEX], ['login', LOGIN]]) {
    assert.ok(!html.includes("'jobyougo:onboarding-deferred'"), `${page}: no tab-wide deferral key`);
    assert.ok(!/sessionStorage\.\w+\(\s*'jobyougo:onboarding/.test(html), `${page}: no onboarding state in sessionStorage`);
  }
  assert.ok(INDEX.includes('localStorage.getItem(`jobyougo:onboarding-deferred:${session.user.id}`)'), 'dashboard gate reads the per-account key');
  assert.ok(LOGIN.includes('localStorage.getItem(`jobyougo:onboarding-deferred:${userId}`)'), 'login reads the per-account key');
});

test('login: a tab-wide flag left by another account no longer defers this one', () => {
  const session = new Map([['jobyougo:onboarding-deferred', '1']]);
  const local = new Map();
  const storage = (map) => ({ getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)) });
  const { onboardingDeferred } = loadHelpers(LOGIN, {
    functions: ['onboardingDeferred'],
    globals: { sessionStorage: storage(session), localStorage: storage(local), Date, Number },
  });
  assert.equal(onboardingDeferred('user-b'), false, 'user B is not deferred by the old session flag');
  assert.equal(onboardingDeferred(null), false);

  local.set('jobyougo:onboarding-deferred:user-a', String(Date.now() - 60_000));
  assert.equal(onboardingDeferred('user-a'), true, 'user A deferred an hour ago');
  assert.equal(onboardingDeferred('user-b'), false, 'the deferral stays with its account');

  local.set('jobyougo:onboarding-deferred:user-a', String(Date.now() - 8 * 24 * 60 * 60 * 1000));
  assert.equal(onboardingDeferred('user-a'), false, 'the deferral lapses after 7 days');
});

// ─── GATE-F2: banner for deferred accounts ─────────────────────────────────

test('deferred accounts with an incomplete profile get the banner on the first dashboard render', () => {
  const redirect = INDEX.indexOf("window.location.href = '/onboarding';");
  const banner = INDEX.indexOf('if (!status.complete) showOnboardingBanner(onboardingStepsFromStatus(status.missing));');
  assert.ok(redirect > 0 && banner > redirect, 'banner shown after the redirect check, from status.missing');
  assert.ok(banner < INDEX.indexOf('window.loadAll()', banner), 'before the app loads');
  assert.ok(INDEX.includes('<a class="btn btn-accent btn-sm" href="/onboarding">Run the guided setup</a>'), 'the banner links to the guided setup');
});

test('the banner lists the missing required items and hides when nothing is missing', () => {
  const document = fakeDocument();
  const h = loadHelpers(INDEX, {
    consts: ['ONBOARDING_STEP_LABELS'],
    functions: ['onboardingStepsFromStatus', 'showOnboardingBanner', 'normalizeProfileData', 'checkOnboarding'],
    globals: { document },
  });
  const steps = h.onboardingStepsFromStatus(['identity', 'target_roles', 'location', 'cv', 'not-a-check']);
  assert.equal(steps.length, 4);
  assert.ok(steps.includes('Set your target roles'));
  assert.ok(steps.includes('Add where you are based'));
  assert.equal(h.onboardingStepsFromStatus(undefined).length, 0);

  h.showOnboardingBanner(steps);
  const bannerEl = document.getElementById('onboarding-banner');
  assert.equal(bannerEl.style.display, 'block');
  assert.ok(document.getElementById('onboarding-steps').innerHTML.includes('Add where you are based'));
  h.showOnboardingBanner([]);
  assert.equal(bannerEl.style.display, 'none');

  // checkOnboarding (Profile page) agrees with the server that a missing
  // location leaves the profile incomplete.
  const cv = 'x'.repeat(200);
  h.checkOnboarding({ candidate: { full_name: 'Ana', linkedin: 'in/ana' }, target_roles: { primary: ['PM'] } }, cv);
  assert.equal(bannerEl.style.display, 'block');
  assert.ok(document.getElementById('onboarding-steps').innerHTML.includes('Add where you are based'));
  h.checkOnboarding({ candidate: { full_name: 'Ana', linkedin: 'in/ana' }, target_roles: { primary: ['PM'] }, location: { country: 'France' } }, cv);
  assert.equal(bannerEl.style.display, 'none');
});

// ─── GATE-F3 / SRV-F4 / GATE-F5 / SRV-F3: save outcome ─────────────────────

function saveHelpers() {
  return loadHelpers(INDEX, {
    consts: ['PROFILE_DEGRADED_MESSAGE'],
    functions: ['cvSaveBody', 'asSentence', 'describeProfileSave'],
  });
}
const ok = (value) => ({ status: 'fulfilled', value });
const fail = (message) => ({ status: 'rejected', reason: new Error(message) });

test('an emptied CV is removed only after confirmation, with clear: true', async () => {
  const { cvSaveBody } = saveHelpers();
  let asked = 0;
  const yes = async () => { asked++; return true; };
  const no = async () => { asked++; return false; };

  assert.deepEqual({ ...(await cvSaveBody('# CV', 'old', yes)) }, { markdown: '# CV' });
  assert.equal(asked, 0, 'a non-empty CV is saved without asking');
  assert.deepEqual({ ...(await cvSaveBody('  \n', '# Stored CV', yes)) }, { markdown: '', clear: true });
  assert.equal(await cvSaveBody('', '# Stored CV', no), null, 'declined: nothing is sent');
  assert.equal(asked, 2);
  assert.equal(await cvSaveBody('', '', yes), null, 'nothing stored: nothing to remove');
  assert.equal(asked, 2, 'no question when there is no stored CV');
});

test('the save handler reports the profile and the CV apart and sends clear only after confirming', () => {
  const handler = INDEX.slice(INDEX.indexOf("document.getElementById('profile-save-btn').addEventListener"));
  assert.ok(handler.includes('await Promise.allSettled(['), 'saves settle independently');
  assert.ok(!handler.slice(0, 4000).includes('await Promise.all(saves)'), 'no all-or-nothing save');
  assert.ok(handler.includes("title: 'Remove your stored CV?'") && handler.includes("message: 'Evaluations need a CV.'"), 'removal is confirmed');
  assert.ok(handler.includes('describeProfileSave(profileResult, cvResult'), 'one outcome from both results');
  assert.ok(INDEX.includes('profileCvStored = cvMarkdown;'), 'the loaded CV is remembered');
});

test('save outcome: full, degraded, CV refused, profile failed, CV removed or kept', () => {
  const { describeProfileSave, PROFILE_DEGRADED_MESSAGE } = saveHelpers();

  let out = describeProfileSave(ok({ ok: true, degraded: false }), ok({ ok: true }));
  assert.deepEqual({ ...out }, { state: 'saved', label: 'Saved', message: 'Profile saved', error: false });

  out = describeProfileSave(ok({ ok: true, degraded: true, updated_at: '2026-10-09T10:00:00Z' }), null);
  assert.equal(out.label, 'Partly saved');
  assert.equal(out.error, true);
  assert.ok(out.message.includes(PROFILE_DEGRADED_MESSAGE));
  assert.ok(/phone, links, languages, availability/.test(PROFILE_DEGRADED_MESSAGE));

  const refusal = 'Your stored CV was kept: an empty CV cannot replace it.';
  out = describeProfileSave(ok({ ok: true, degraded: false }), fail(refusal));
  assert.equal(out.label, 'Partly saved', 'the profile part is not reported as failed');
  assert.ok(out.message.startsWith('Profile saved.'));
  assert.ok(out.message.includes(refusal));
  assert.ok(!out.message.includes('..'), 'no doubled full stop');

  out = describeProfileSave(fail('Profile storage is unavailable right now'), ok({ ok: true }));
  assert.equal(out.label, 'Save failed');
  assert.ok(out.message.includes('Your profile was not saved: Profile storage is unavailable right now.'));
  assert.ok(out.message.includes('Your CV was saved.'));

  out = describeProfileSave(fail('Network down'), fail('Network down'));
  assert.ok(out.message.includes('Your CV was not saved either'));

  out = describeProfileSave(ok({ ok: true }), ok({ ok: true }), { cvCleared: true });
  assert.equal(out.message, 'Profile saved and CV removed');
  out = describeProfileSave(ok({ ok: true }), fail('Nope'), { cvCleared: true });
  assert.ok(out.message.includes('Your CV was not removed: Nope.'));
  out = describeProfileSave(ok({ ok: true }), null, { cvKept: true });
  assert.equal(out.state, 'saved');
  assert.ok(out.message.includes('Your stored CV was kept.'));
});

// ─── GATE-F6: apply helper cache ───────────────────────────────────────────

test('a successful save drops the profile cached for the apply helper', () => {
  const handler = INDEX.slice(INDEX.indexOf("document.getElementById('profile-save-btn').addEventListener"));
  const reset = handler.indexOf('profileData = null;');
  assert.ok(reset > 0, 'profileData reset in the save handler');
  assert.ok(handler.lastIndexOf('if (profileSaved) {', reset) > 0, 'only once the profile PUT succeeded');
  assert.ok(INDEX.includes("profileData || api('/api/profile').then((p) => (profileData = p))"), 'the helper refetches when the cache is empty');
});

// ─── GATE-F7: per-item keys and non-string list entries ────────────────────

test('list labels never print [object Object] and stay on one line', () => {
  const { profileListLabel } = loadHelpers(INDEX, { functions: ['profileListLabel'] });
  assert.equal(profileListLabel('Builder culture'), 'Builder culture');
  assert.equal(profileListLabel('Four years\n  of products'), 'Four years of products');
  assert.equal(profileListLabel({ 'Facilitate UX with AI': 'Cursor prototypes' }), 'Facilitate UX with AI: Cursor prototypes');
  assert.equal(profileListLabel(2024), '2024');
  assert.equal(profileListLabel(null), '');
  assert.ok(!profileListLabel({ a: { b: 1 } }).includes('[object Object]'));
});

test('untouched list lines give back the original entries; edits become strings', () => {
  const { restoreProfileList, profileListLabel } = loadHelpers(INDEX, { functions: ['profileListLabel', 'restoreProfileList'] });
  const mapping = { 'Facilitate UX with AI': 'Cursor prototypes' };
  const originals = ['Ship fast', mapping, 'Two\nlines', 7, 'Ship fast'];
  const text = originals.map(profileListLabel).join('\n');
  // Arrays from the vm realm compare by structure, not prototype.
  assert.deepEqual(JSON.parse(JSON.stringify(restoreProfileList(text, originals))), originals);

  const edited = text.replace('Facilitate UX with AI: Cursor prototypes', 'Facilitate UX with AI: Cursor and Claude Code');
  const out = restoreProfileList(`${edited}\nNew line`, originals);
  assert.equal(out[1], 'Facilitate UX with AI: Cursor and Claude Code');
  assert.equal(out[2], 'Two\nlines', 'the untouched multi-line string is kept as written');
  assert.equal(out.at(-1), 'New line');
  assert.equal(out.length, 6);

  const deleted = restoreProfileList('Ship fast\n7', originals);
  assert.deepEqual(JSON.parse(JSON.stringify(deleted)), ['Ship fast', 7]);
  assert.deepEqual(JSON.parse(JSON.stringify(restoreProfileList('a\n\n b ', undefined))), ['a', 'b']);
});

test('collectProfile keeps the keys a row does not edit and drops a cleared url', () => {
  const proof = { name: 'Creads.io', url: 'https://creads.io', hero_metric: '1,200 users', source: 'Confirmed by the user, 2026-09-10' };
  const arch = { name: 'Product Designer', level: 'Senior', fit: 'primary', note: 'kept' };
  const { helpers, proofCards, archRows } = renderIntoFakeForm({ target_roles: { archetypes: [arch] }, narrative: { proof_points: [proof] } });

  let profile = helpers.collectProfile();
  assert.deepEqual({ ...profile.narrative.proof_points[0] }, proof);
  assert.deepEqual({ ...profile.target_roles.archetypes[0] }, arch);

  proofCards[0] = fakeRow(proof, { '.proof-name': 'Creads', '.proof-metric': '1,300 users', '.proof-url': '' });
  archRows[0] = fakeRow('Product Designer', { '.arch-name': 'PD', '.arch-level': '', '.arch-fit': 'secondary' });
  profile = helpers.collectProfile();
  assert.deepEqual({ ...profile.narrative.proof_points[0] }, { name: 'Creads', hero_metric: '1,300 users', source: proof.source });
  assert.deepEqual({ ...profile.target_roles.archetypes[0] }, { name: 'PD', level: '', fit: 'secondary' }, 'a string original is not spread into characters');
  assert.ok(INDEX.includes('row.__orig = arch;') && INDEX.includes('card.__orig = p;'), 'rows keep their original item');
  assert.ok(!INDEX.includes("(n.superpowers || []).join('\\n')"), 'superpowers go through setProfileList');
});

const SHAPES = {
  candidate: { full_name: 'Test User' },
  target_roles: {
    primary: ['Senior Product Designer'],
    archetypes: [{ name: 'Product Designer', level: 'Senior/Lead', fit: 'primary' }],
  },
  narrative: {
    // An unquoted "…with AI: Cursor…" line is a mapping once YAML parses it.
    superpowers: yaml.load('- Connect research with delivery\n- Facilitate UX with AI: Cursor prototypes, GitHub with engineering.\n'),
    proof_points: [
      { name: 'OneAsset', hero_metric: 'Shipped the product in 6 months', source: 'Scope confirmed directly by the user, 2026-09-17' },
      { name: 'Creads.io', url: 'https://creads.io', hero_metric: '1,200 users', source: 'Counts confirmed, 2026-09-10' },
    ],
  },
  search: { must_haves: ['Full remote'], deal_breakers: ['US-only remote'] },
};

function assertSaveKeepsLists(stored) {
  const { helpers } = renderIntoFakeForm(stored);
  const collected = JSON.parse(JSON.stringify(helpers.collectProfile()));
  assert.ok(!JSON.stringify(collected).includes('[object Object]'), 'no [object Object]');
  const merged = mergeProfileSections(stored, sanitizeProfileInput(collected));
  assert.deepEqual(merged.narrative.proof_points, stored.narrative.proof_points, 'proof points keep every key');
  assert.deepEqual(merged.narrative.superpowers, stored.narrative.superpowers, 'superpowers unchanged');
  assert.deepEqual(merged.target_roles.archetypes, stored.target_roles.archetypes, 'archetypes unchanged');
  for (const [id, pick] of LIST_FIELDS) {
    const before = pick(stored);
    if (Array.isArray(before)) assert.deepEqual(pick(merged), before, `${id} unchanged`);
  }
}

test('a Save without edits leaves proof-point provenance and mapping superpowers intact', () => {
  assert.equal(typeof SHAPES.narrative.superpowers[1], 'object', 'the fixture reproduces the YAML mapping');
  assertSaveKeepsLists(SHAPES);
});

const OWNER_PROFILE = join(ROOT, 'config/profile.yml');
test('a Save without edits leaves the local config/profile.yml lists intact', { skip: !existsSync(OWNER_PROFILE) && 'no local config/profile.yml' }, () => {
  assertSaveKeepsLists(yaml.load(readFileSync(OWNER_PROFILE, 'utf8')));
});

// ─── GATE-F8 / GATE-F4: onboarding draft ───────────────────────────────────

test('dashboard sign-out removes the onboarding drafts before signing out, and never writes one', () => {
  const at = INDEX.indexOf("document.getElementById('btn-signout').addEventListener('click', async () => {");
  assert.ok(at > 0);
  const handler = INDEX.slice(at, INDEX.indexOf('});', at));
  const signOut = handler.indexOf('await supabase.auth.signOut();');
  const v2 = handler.indexOf('localStorage.removeItem(`jobyougo:onboarding-draft:v2:${session.user.id}`);');
  const legacy = handler.indexOf('localStorage.removeItem(`jobyougo:onboarding-draft:${session.user.id}`);');
  assert.ok(v2 > 0 && legacy > 0 && signOut > v2 && signOut > legacy, 'drafts removed before signOut()');
  assert.ok(!/setItem\(\s*`jobyougo:onboarding-draft/.test(INDEX), 'the dashboard never writes an onboarding draft');
});
