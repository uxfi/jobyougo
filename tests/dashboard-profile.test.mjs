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
import { resolveLocationProfile } from '../lib/candidate-location.mjs';

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

function fakeDocument({ archRows = [], proofCards = [], eduRows = [], answerRows = [] } = {}) {
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
      if (selector === '#education-list .edu-row') return eduRows;
      if (selector === '#custom-answers-list .answer-row') return answerRows;
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

// The single-value fields renderProfile() fills, for a Save without edits.
const TEXT_FIELDS = [
  ['prof-name', (p) => p.candidate?.full_name], ['prof-email', (p) => p.candidate?.email],
  ['prof-phone', (p) => p.candidate?.phone], ['prof-location', (p) => p.candidate?.location],
  ['prof-linkedin', (p) => p.candidate?.linkedin], ['prof-portfolio', (p) => p.candidate?.portfolio_url],
  ['prof-github', (p) => p.candidate?.github], ['prof-twitter', (p) => p.candidate?.twitter],
  ['prof-headline', (p) => p.narrative?.headline], ['prof-exit-story', (p) => p.narrative?.exit_story],
  ['prof-target-range', (p) => p.compensation?.target_range], ['prof-minimum', (p) => p.compensation?.minimum],
  ['prof-currency', (p) => p.compensation?.currency], ['prof-employment-type', (p) => p.compensation?.employment_type],
  ['prof-location-flex', (p) => p.compensation?.location_flexibility],
  ['prof-country', (p) => p.location?.country], ['prof-city', (p) => p.location?.city],
  ['prof-timezone', (p) => p.location?.timezone], ['prof-visa', (p) => p.location?.visa_status],
  ['prof-remote-policy', (p) => p.location?.remote_policy], ['prof-search-onsite', (p) => p.search?.onsite_availability],
];

// Everything collectProfile() reaches, for the vm.
const PROFILE_CONSTS = ['PROFILE_EXTRA_FIELDS', 'EDUCATION_KEYS', 'CUSTOM_ANSWER_KEYS', 'RELOCATION_VALUES', 'PROFILE_SECTION_KEYS'];
const PROFILE_FUNCTIONS = [
  'profileListLabel', 'restoreProfileList', 'setProfileList', 'getProfileList', 'rowOriginal', 'collectProfile',
  'isPlainObject', 'plainObject', 'fieldText', 'sameFieldText', 'isBlankProfileValue', 'sameProfileValue', 'languageLabel', 'placeLabel',
  'listText', 'yesNoChoice', 'yesNoValue', 'relocationChoice', 'licenceHeld', 'foldPlace', 'secondBaseIndex',
  'nextLocationBases', 'entriesFromRows', 'rowsFromEntries', 'profileExtrasForm', 'profileExtrasPatch',
  'mergeStoredProfile', 'storedPartOfSave', 'readProfileExtrasForm',
];

function profileHelpers(globals = {}) {
  return loadHelpers(INDEX, { consts: PROFILE_CONSTS, functions: PROFILE_FUNCTIONS, globals: { profileStored: {}, ...globals } });
}

// Puts a profile into the fake form the way renderProfile() does: text
// fields, list textareas through setProfileList(), archetype, proof-point,
// education and answer rows carrying their original item as __orig, and the
// onboarding sections through profileExtrasForm() with profileStored set.
function renderIntoFakeForm(profile) {
  const archRows = (profile.target_roles?.archetypes || []).map(a => fakeRow(a, {
    '.arch-name': a.name || '', '.arch-level': a.level || '', '.arch-fit': a.fit || 'primary',
  }));
  const proofCards = (profile.narrative?.proof_points || []).map(p => fakeRow(p, {
    '.proof-name': p.name || '', '.proof-metric': p.hero_metric || '', '.proof-url': p.url || '',
  }));
  const eduRows = [];
  const answerRows = [];
  const document = fakeDocument({ archRows, proofCards, eduRows, answerRows });
  const helpers = profileHelpers({ document, profileStored: JSON.parse(JSON.stringify(profile)) });
  for (const [id, pick] of TEXT_FIELDS) document.getElementById(id).value = String(pick(profile) ?? '');
  for (const [id, pick] of LIST_FIELDS) helpers.setProfileList(id, pick(profile));
  const form = helpers.profileExtrasForm(profile);
  for (const [id, key] of helpers.PROFILE_EXTRA_FIELDS) document.getElementById(id).value = form[key];
  for (const r of form.education) {
    eduRows.push(fakeRow(r.orig, { '.edu-degree': r.degree, '.edu-field': r.field, '.edu-school': r.school, '.edu-year': r.end_year }));
  }
  for (const r of form.custom_answers) answerRows.push(fakeRow(r.orig, { '.answer-question': r.question, '.answer-text': r.answer }));
  return { document, helpers, archRows, proofCards, eduRows, answerRows };
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

// ─── Onboarding-only fields on the Profile page ────────────────────────────
// The onboarding writes nationality, bases, authorization, travel, languages,
// education, availability and the form answers; the Profile page used to show
// none of them. It now edits them and sends only the values changed there.

// A new account right after the onboarding (cleanProfileForSave's shapes).
const ONBOARDED = {
  candidate: {
    full_name: 'Léa Martin', email: 'lea@example.com', phone: '+33 6 12 34 56 78', location: 'Lyon, France',
    linkedin: 'linkedin.com/in/lea-martin', portfolio_url: '', github: 'github.com/leamartin', twitter: '', years_experience: 6,
    languages: ['French (Native)', 'English (C1)'],
    education: [{ degree: 'Master', field: 'Computer science', school: 'INSA Lyon', end_year: '2018' }],
    ai_proficiency: 'Practitioner',
    people_management: { max_direct_reports: 3, context: 'Data lead at Acme, 2022-2024' },
  },
  target_roles: { primary: ['Data Engineer'], archetypes: [{ name: 'Data Engineer', level: 'Senior', fit: 'primary' }] },
  narrative: { headline: 'Data engineer, streaming pipelines', exit_story: 'Six years of data platforms.', superpowers: ['Streaming pipelines'], proof_points: [] },
  compensation: { target_range: '60K-70K', currency: 'EUR', minimum: '55K', employment_type: 'Full-time salaried', location_flexibility: '' },
  location: {
    country: 'France', city: 'Lyon', postal_code: '69003', timezone: 'CET / CEST (Paris, Berlin, Madrid)', nationality: 'French',
    visa_status: 'EU citizen', authorized_in: ['France', 'European Union'],
    remote_policy: 'Full remote preferred; occasional on-site sessions acceptable',
    onsite_exceptions: ['Lisbon, Portugal'], relocation: 'bases', needs_sponsorship: true,
    bases: [
      { city: 'Lyon', country: 'France', default: true, timezone: 'CET / CEST (Paris, Berlin, Madrid)', postal_code: '69003' },
      { city: 'Lisbon', country: 'Portugal', default: false, timezone: 'GMT / BST (London, Lisbon)', phone: '+351 912 345 678' },
    ],
    travel: { offsites: true },
  },
  search: {
    current_role: { title: 'Data Engineer', company: 'Acme', start_month: '03', start_year: '2022', current: true },
    contract_types: ['Permanent (CDI)'], sector_preferences: [], geography_preferences: [], onsite_availability: '',
    must_haves: ['Remote friendly'], nice_to_haves: [], deal_breakers: [],
  },
  availability: { notice_period: '3 months', start_date: '2027-01-01', current_employment: 'Employed, actively looking', days_per_week: 5 },
  screening: {
    how_did_you_hear: 'LinkedIn', references: 'Available upon request', security_clearance: 'None',
    custom_answers: [{ question: 'Why remote?', answer: 'Long focus blocks.' }],
    driving_licence: true, non_compete: false, consents: { future_roles: true }, eeo: { gender: 'Woman' },
  },
  language: { output: 'en' },
  spend_tier: 'standard',
  writing_voice: 'Short sentences, first person.',
  outreach_rules: 'Never name my current employer.',
};

// A hand-written YAML profile: structured entries the page shows as one line.
const STRUCTURED = {
  candidate: {
    full_name: 'Sam Rivera', email: 'sam@example.com', phone: '+34 600 000 000', location: 'Madrid',
    languages: [{ name: 'Spanish', level: 'Native', cefr: 'C2' }, { name: 'English', level: 'Professional', cefr: 'C1' }, { name: 'Thai', cefr: 'A1' }],
    education: [{ degree: 'Bachelor', field: 'Design', school: 'IED Madrid', country: 'Spain', start_year: 2010, end_year: 2013 }],
    ai_proficiency: 'Builder (ships LLM features)',
    people_management: { max_direct_reports: 7, current_direct_reports: 0, context: 'Studio founder, 2018-2022', source: 'cv.md' },
    nationalities: ['Spanish'],
  },
  location: {
    country: 'Spain', city: 'Madrid', timezone: 'CET or SGT, depending on the offer', visa_status: 'EU citizen',
    authorized_in: ['Spain', 'European Union', 'Singapore'], needs_sponsorship: false, remote_policy: 'Full remote required',
    nationality: 'Spanish',
    bases: [
      { city: 'Madrid', country: 'Spain', timezone: 'Europe/Madrid', default: true, status: 'citizen' },
      { city: 'Singapore', country: 'Singapore', timezone: 'Asia/Singapore', phone: '+65 8000 0000', regions: ['APAC'], status: 'authorized' },
    ],
    onsite_exceptions: [{ city: 'Singapore', country: 'Singapore', modes: ['onsite', 'hybrid'] }],
    relocation: false,
    travel: { offsites: true, note: 'Team offsites anywhere' },
  },
  availability: { current_employment: 'Salaried at Studio', start_date: 'After 1 week notice', notice_period: '1 week', notice_period_days: 7, days_per_week: 5, source: 'user, 2026-09-23' },
  screening: {
    references: 'Available upon request', background_check_ok: true, non_compete: false, consents: { future_roles: false, marketing: false },
    driving_licence: { has: true, categories: ['B'] }, security_clearance: 'None',
    eeo: { gender: 'Man', disability: 'No', race_ethnicity: 'Prefer not to say' }, custom_answers: [],
  },
};

const ONBOARDING_IDS = [
  'prof-nationality', 'prof-postal', 'prof-base2-city', 'prof-base2-country', 'prof-base2-timezone', 'prof-base2-phone',
  'prof-authorized-in', 'prof-sponsorship', 'prof-onsite-places', 'prof-relocation', 'prof-offsites',
  'prof-languages', 'prof-ai-level', 'prof-reports-max', 'prof-reports-context',
  'prof-notice', 'prof-start-date', 'prof-days-week', 'prof-current-situation',
  'prof-hear', 'prof-references', 'prof-clearance', 'prof-gender', 'prof-licence', 'prof-noncompete', 'prof-future-roles',
  'prof-writing-voice', 'prof-outreach-rules', 'education-list', 'custom-answers-list', 'add-education-btn', 'add-answer-btn',
];

const plain = (v) => JSON.parse(JSON.stringify(v));

// Every key the stored section had keeps its value through a Save.
function assertKeepsStored(stored, merged, label) {
  for (const section of ['candidate', 'location', 'availability', 'screening', 'search', 'compensation', 'narrative', 'target_roles']) {
    for (const [key, value] of Object.entries(stored[section] || {})) {
      assert.deepEqual(merged[section]?.[key], value, `${label}: ${section}.${key} kept`);
    }
  }
  for (const key of ['writing_voice', 'outreach_rules', 'language', 'spend_tier']) {
    if (key in stored) assert.deepEqual(merged[key], stored[key], `${label}: ${key} kept`);
  }
}

function saveWithoutEdits(stored, label) {
  const { helpers } = renderIntoFakeForm(stored);
  const collected = plain(helpers.collectProfile());
  for (const key of ['availability', 'screening', 'writing_voice', 'outreach_rules']) {
    assert.ok(!(key in collected), `${label}: ${key} not sent when unchanged`);
  }
  assert.deepEqual(Object.keys(collected.location).sort(), ['city', 'country', 'remote_policy', 'timezone', 'visa_status'], `${label}: only the legacy location keys`);
  assert.deepEqual(Object.keys(collected.candidate).sort(), ['email', 'full_name', 'github', 'linkedin', 'location', 'phone', 'portfolio_url', 'twitter'], `${label}: only the legacy candidate keys`);
  const merged = mergeProfileSections(stored, sanitizeProfileInput(collected));
  assertKeepsStored(stored, merged, label);
  return merged;
}

test('the Profile page has a field for every onboarding-only value', () => {
  for (const id of ONBOARDING_IDS) {
    assert.equal(INDEX.split(`id="${id}"`).length, 2, `#${id} exists once`);
  }
  const { PROFILE_EXTRA_FIELDS } = profileHelpers();
  for (const [id] of PROFILE_EXTRA_FIELDS) assert.ok(INDEX.includes(`id="${id}"`), `${id} is in the page`);
  assert.ok(INDEX.includes('<a href="#sec-background" data-anchor="sec-background">Background</a>'));
  assert.ok(INDEX.includes('<a href="#sec-forms" data-anchor="sec-forms">Forms</a>'));
  assert.ok(INDEX.includes('href="/onboarding" style="margin-top:12px;align-self:flex-start">Run the guided setup again</a>'), 'the guided setup stays one click away');
  const render = extractFunction(INDEX, 'renderProfile');
  assert.ok(render.includes('profileStored = JSON.parse(JSON.stringify(data || {}));') && render.includes('fillProfileExtras(profileStored);'), 'renderProfile fills the onboarding fields');
});

test('the onboarding answers of a new account show on the Profile page', () => {
  const form = plain(profileHelpers().profileExtrasForm(ONBOARDED));
  assert.equal(form.nationality, 'French');
  assert.equal(form.postal_code, '69003');
  assert.deepEqual([form.base2_city, form.base2_country, form.base2_timezone, form.base2_phone], ['Lisbon', 'Portugal', 'GMT / BST (London, Lisbon)', '+351 912 345 678']);
  assert.equal(form.authorized_in, 'France\nEuropean Union');
  assert.equal(form.needs_sponsorship, 'yes');
  assert.equal(form.onsite_places, 'Lisbon, Portugal');
  assert.equal(form.relocation, 'bases');
  assert.equal(form.offsites, 'yes');
  assert.equal(form.languages, 'French (Native)\nEnglish (C1)');
  assert.equal(form.ai_proficiency, 'Practitioner');
  assert.deepEqual([form.reports_max, form.reports_context], ['3', 'Data lead at Acme, 2022-2024']);
  assert.deepEqual([form.notice_period, form.start_date, form.days_per_week, form.current_employment], ['3 months', '2027-01-01', '5', 'Employed, actively looking']);
  assert.deepEqual([form.how_did_you_hear, form.references, form.security_clearance], ['LinkedIn', 'Available upon request', 'None']);
  assert.deepEqual([form.driving_licence, form.non_compete, form.future_roles, form.gender], ['yes', 'no', 'yes', 'Woman']);
  assert.deepEqual(form.education.map(({ orig, ...rest }) => rest), [{ degree: 'Master', field: 'Computer science', school: 'INSA Lyon', end_year: '2018' }]);
  assert.deepEqual(form.custom_answers.map(({ orig, ...rest }) => rest), [{ question: 'Why remote?', answer: 'Long focus blocks.' }]);
  assert.equal(form.writing_voice, 'Short sentences, first person.');
  assert.equal(form.outreach_rules, 'Never name my current employer.');

  // Structured YAML entries read as one line each.
  const yamlForm = plain(profileHelpers().profileExtrasForm(STRUCTURED));
  assert.equal(yamlForm.languages, 'Spanish (Native)\nEnglish (Professional)\nThai (A1)');
  assert.equal(yamlForm.onsite_places, 'Singapore, Singapore');
  assert.deepEqual([yamlForm.relocation, yamlForm.offsites, yamlForm.driving_licence, yamlForm.needs_sponsorship], ['no', 'yes', 'yes', 'no']);
  assert.deepEqual([yamlForm.base2_city, yamlForm.base2_timezone], ['Singapore', 'Asia/Singapore']);
  assert.equal(yamlForm.education[0].end_year, '2013');
});

test('a Save without edits sends none of the onboarding fields and keeps every one', () => {
  saveWithoutEdits(ONBOARDED, 'onboarded');
  saveWithoutEdits(STRUCTURED, 'structured');
  const { helpers } = renderIntoFakeForm({});
  assert.deepEqual(plain(helpers.profileExtrasPatch({}, helpers.profileExtrasForm({}), {})), {}, 'an empty profile gets no empty keys');
});

test('a Save without edits keeps the local config/profile.yml onboarding fields', { skip: !existsSync(OWNER_PROFILE) && 'no local config/profile.yml' }, () => {
  saveWithoutEdits(yaml.load(readFileSync(OWNER_PROFILE, 'utf8')), 'config/profile.yml');
});

test('edits on the Profile page reach the profile and leave the keys it does not show', () => {
  const { helpers, document, eduRows, answerRows } = renderIntoFakeForm(STRUCTURED);
  const set = (id, value) => { document.getElementById(id).value = value; };
  set('prof-base2-phone', '+65 9000 0000');
  set('prof-languages', 'Spanish (Native)\nEnglish (Professional)\nThai (A1)\nFrench (B1)');
  set('prof-notice', '1 month');
  set('prof-offsites', 'no');
  set('prof-licence', 'no');
  set('prof-future-roles', 'yes');
  set('prof-gender', '');
  set('prof-postal', '28001');
  set('prof-writing-voice', 'Plain words.');
  set('prof-days-week', '4');
  set('prof-reports-context', 'Studio founder, 2018-2023');
  eduRows[0] = fakeRow(eduRows[0].__orig, { '.edu-degree': 'BA', '.edu-field': 'Design', '.edu-school': 'IED Madrid', '.edu-year': '2013' });
  answerRows.push(fakeRow({}, { '.answer-question': 'Why us?', '.answer-text': 'Your design culture.' }));

  const collected = plain(helpers.collectProfile());
  const merged = mergeProfileSections(STRUCTURED, sanitizeProfileInput(collected));
  const loc = merged.location;
  assert.deepEqual(loc.bases[1], { city: 'Singapore', country: 'Singapore', timezone: 'Asia/Singapore', phone: '+65 9000 0000', regions: ['APAC'], status: 'authorized' }, 'same place: regions and status kept');
  assert.deepEqual(loc.bases[0], STRUCTURED.location.bases[0], 'the default base is untouched');
  assert.equal(loc.postal_code, '28001');
  assert.deepEqual(loc.travel, { offsites: false, note: 'Team offsites anywhere' }, 'the travel note stays');
  assert.deepEqual(loc.onsite_exceptions, STRUCTURED.location.onsite_exceptions, 'the structured exception keeps its modes');
  assert.deepEqual(merged.candidate.languages, [...STRUCTURED.candidate.languages, 'French (B1)'], 'untouched languages keep their cefr');
  assert.deepEqual(merged.candidate.education, [{ ...STRUCTURED.candidate.education[0], degree: 'BA' }], 'an edited degree keeps country and years');
  assert.deepEqual(merged.candidate.people_management, { ...STRUCTURED.candidate.people_management, context: 'Studio founder, 2018-2023' });
  assert.deepEqual(merged.candidate.nationalities, ['Spanish']);
  assert.equal(merged.availability.notice_period, '1 month');
  assert.equal(merged.availability.notice_period_days, null, 'a new notice period drops the stale day count');
  assert.equal(merged.availability.days_per_week, 4);
  assert.equal(merged.availability.source, 'user, 2026-09-23');
  assert.deepEqual(merged.screening.driving_licence, { has: false, categories: ['B'] });
  assert.deepEqual(merged.screening.consents, { future_roles: true, marketing: false });
  assert.deepEqual(merged.screening.eeo, { gender: '', disability: 'No', race_ethnicity: 'Prefer not to say' });
  assert.deepEqual(merged.screening.custom_answers, [{ question: 'Why us?', answer: 'Your design culture.' }]);
  assert.equal(merged.screening.background_check_ok, true);
  assert.equal(merged.writing_voice, 'Plain words.');
  assert.ok(!('outreach_rules' in collected), 'an untouched empty field is not sent');
});

test('the second base: added, moved, removed, and the default base follows City and Country', () => {
  const h = profileHelpers();
  const home = { city: 'Lyon', country: 'France', timezone: 'CET', postal_code: '69003' };
  // First second base: the default one comes from the Location fields.
  assert.deepEqual(plain(h.nextLocationBases(undefined, home, { city: 'Lisbon', country: 'Portugal', phone: '+351 1' })), [
    { city: 'Lyon', country: 'France', default: true, timezone: 'CET', postal_code: '69003' },
    { city: 'Lisbon', country: 'Portugal', phone: '+351 1', default: false },
  ]);
  assert.deepEqual(plain(h.nextLocationBases([], home, {})), [], 'nothing entered, nothing stored');
  const stored = STRUCTURED.location.bases;
  // Another place: the old place's regions and status go.
  assert.deepEqual(plain(h.nextLocationBases(stored, home, { city: 'Tokyo', country: 'Japan' }))[1], { city: 'Tokyo', country: 'Japan' });
  // Cleared: removed, a third base kept.
  const third = { city: 'Dubai', country: 'United Arab Emirates' };
  assert.deepEqual(plain(h.nextLocationBases([...stored, third], home, { city: '', country: '' })), [stored[0], third]);

  // City and Country changed on the page: bases stay as stored, and the
  // engine reads the new city as the default base, second base intact.
  const { helpers, document } = renderIntoFakeForm(STRUCTURED);
  document.getElementById('prof-city').value = 'Barcelona';
  const merged = mergeProfileSections(STRUCTURED, sanitizeProfileInput(plain(helpers.collectProfile())));
  assert.deepEqual(merged.location.bases, stored);
  const resolved = resolveLocationProfile(merged);
  assert.equal(resolved.defaultBase.city, 'Barcelona');
  assert.ok(resolved.bases.some(b => b.city === 'Singapore'), 'the second base still resolves');
});

test('tri-state answers: cleared is null, sponsorship can change but not be cleared', () => {
  const { helpers, document } = renderIntoFakeForm(ONBOARDED);
  document.getElementById('prof-noncompete').value = '';
  document.getElementById('prof-relocation').value = 'no';
  document.getElementById('prof-sponsorship').value = '';
  let collected = plain(helpers.collectProfile());
  assert.equal(collected.screening.non_compete, null, 'not answered is null, never false');
  assert.equal(collected.location.relocation, false);
  assert.ok(!('needs_sponsorship' in collected.location), 'a stored sponsorship answer is not cleared');
  document.getElementById('prof-sponsorship').value = 'no';
  collected = plain(helpers.collectProfile());
  assert.equal(collected.location.needs_sponsorship, false);
  const fill = extractFunction(INDEX, 'fillProfileExtras');
  assert.ok(fill.includes("unanswered.disabled = form.needs_sponsorship !== '';"), 'the page cannot offer "Not answered" once answered');

  // A stored value outside a select's options gets its own option.
  assert.ok(extractFunction(INDEX, 'setSelectValue').includes('el.appendChild(opt);'));
  const custom = plain(helpers.profileExtrasForm({ location: { relocation: 'Only within the EU' } }));
  assert.equal(custom.relocation, 'Only within the EU');
  assert.deepEqual(plain(helpers.profileExtrasPatch({ location: { relocation: 'Only within the EU' } }, custom, {})), {});

  // A stored multi-line value shown in a single-line input is not an edit.
  const multiLine = { candidate: { ai_proficiency: 'Builder:\nships LLM features' } };
  const shown = { ...plain(helpers.profileExtrasForm(multiLine)), ai_proficiency: 'Builder: ships LLM features' };
  assert.deepEqual(plain(helpers.profileExtrasPatch(multiLine, shown, {})), {});

  // Clearing both management fields removes the fact.
  const pm = plain(helpers.profileExtrasPatch(ONBOARDED, { ...plain(helpers.profileExtrasForm(ONBOARDED)), reports_max: '', reports_context: '' }, {}));
  assert.equal(pm.candidate.people_management, null);
});

test('after a Save the page compares with what is stored, and a degraded save resends its answers', () => {
  const h = profileHelpers();
  const sent = { location: { city: 'Lyon', bases: [] }, candidate: { languages: ['French'] }, availability: { notice_period: '1 month' }, writing_voice: 'Plain.' };
  // Same merge as the server.
  assert.deepEqual(plain(h.mergeStoredProfile(ONBOARDED, sent)), plain(mergeProfileSections(ONBOARDED, sent)));
  // Without the jsonb columns, the candidate, availability and preferences parts were not stored.
  assert.deepEqual(plain(h.storedPartOfSave(sent, ['candidate', 'availability', 'preferences'])), { location: sent.location });
  assert.deepEqual(plain(h.storedPartOfSave(sent, [])), sent);

  const handler = INDEX.slice(INDEX.indexOf("document.getElementById('profile-save-btn').addEventListener"));
  assert.ok(handler.includes('const profilePayload = collectProfile();') && handler.includes('profile: profilePayload,'), 'the sent profile is the one remembered');
  assert.ok(handler.includes('profileStored = mergeStoredProfile(profileStored, storedPartOfSave(profilePayload, profileResult.value?.missing_columns));'));
  const remembered = handler.indexOf('profileStored = mergeStoredProfile(');
  assert.ok(handler.lastIndexOf('if (profileSaved) {', remembered) > 0, 'only once the PUT succeeded');
});
