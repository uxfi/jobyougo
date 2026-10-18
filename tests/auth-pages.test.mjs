// The server injects the Supabase URL and anon key with a single-occurrence
// String.replace() per page. A page that mentions a placeholder twice ships
// the literal '__SUPABASE_ANON_KEY__' to the browser and the auth client
// silently fails. This guard keeps every auth page at exactly one of each,
// and checks the routes and links the auth flow depends on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const count = (text, needle) => text.split(needle).length - 1;

const AUTH_PAGES = ['ui/login.html', 'ui/onboarding.html', 'ui/reset-password.html', 'ui/index.html', 'ui/landing.html'];

for (const page of AUTH_PAGES) {
  test(`${page} carries each Supabase placeholder exactly once`, () => {
    const html = read(page);
    assert.equal(count(html, '__SUPABASE_URL__'), 1, 'SUPABASE_URL placeholder');
    assert.equal(count(html, '__SUPABASE_ANON_KEY__'), 1, 'SUPABASE_ANON_KEY placeholder');
  });
}

test('server serves the reset-password page and injects its keys', () => {
  const server = read('ui/server.mjs');
  assert.ok(server.includes("path === '/reset-password'"), 'route');
  assert.ok(server.includes("readFile(join(__dirname, 'reset-password.html'), 'utf-8')"), 'file');
});

test('login page wires the password-reset and confirmation flows to the right pages', () => {
  const login = read('ui/login.html');
  assert.ok(login.includes("resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` })"), 'reset redirect');
  assert.ok(login.includes("emailRedirectTo: `${window.location.origin}/login?confirmed=1`"), 'signup confirmation redirect');
  assert.ok(login.includes("supabase.auth.resend({ type: 'signup'"), 'resend confirmation');
  assert.ok(login.includes("identities.length === 0"), 'existing-account detection on signup');
  assert.ok(login.includes("'/api/profile/status'"), 'onboarding gate after sign-in');
  assert.ok(!login.includes('#5e6ad2'), 'old purple brand colour is gone');
});

test('reset page updates the password through the recovery session', () => {
  const page = read('ui/reset-password.html');
  assert.ok(page.includes("event === 'PASSWORD_RECOVERY'"));
  assert.ok(page.includes('supabase.auth.updateUser({ password })'));
});

test('onboarding posts the completion flag and never wipes the strategic notes', () => {
  const page = read('ui/onboarding.html');
  assert.ok(page.includes('onboarding_completed: true'), 'completion flag');
  assert.ok(!page.includes("context_markdown: ''"), 'no empty context_markdown');
  for (const field of ['authorized_in', 'needs_sponsorship', 'years_experience', 'notice_period', 'remote_policy', 'onsite_availability', 'employment_type']) {
    assert.ok(page.includes(field), `collects ${field}`);
  }
  assert.ok(page.includes("'/api/profile/cv-parse'"), 'CV import endpoint');
  assert.ok(page.includes("window.location.replace('/login?next=/onboarding')"), 'auth gate');
});

test('server no longer hard-codes the owner in the evaluation enforcement block', () => {
  const server = read('ui/server.mjs');
  assert.ok(!server.includes('outside Thailand'), 'Thailand');
  assert.ok(!server.includes('cv-hugo-vermot-${companySlug}'), 'owner CV filename');
  assert.ok(server.includes('homeLocationLabel(profileData)'));
  assert.ok(server.includes('normalizeProfileRow(data || {})'), 'profiles row is normalized at read time');
});

test('review fixes: on-site rule, admin by verified email, no double decode, gate deferral', () => {
  const server = read('ui/server.mjs');
  assert.ok(server.includes('search.onsite_availability || location.onsite_availability'), 'on-site availability read from both places');
  assert.ok(server.includes('onsiteFailRule'), 'hard-fail carve-out comes from the on-site availability');
  assert.ok(server.includes("if (adminEmail) return String(email || '').trim().toLowerCase() === adminEmail;"), 'admin decided by the verified auth email');
  assert.ok(server.includes('loadCvTemplateDataForUser(req.userId, basedProfileKey, tailoredData, req.userEmail)'), 'cv-pdf passes the auth email');

  const login = read('ui/login.html');
  const reset = read('ui/reset-password.html');
  assert.ok(!login.includes('decodeURIComponent('), 'login: no double decode of link errors');
  assert.ok(!reset.includes('decodeURIComponent('), 'reset: no double decode of link errors');
  assert.ok(login.includes('if (res.status === 401) return null;'), 'login: a rejected session does not loop');
  assert.ok(login.indexOf("msg.includes('email rate limit')") < login.indexOf("msg.includes('rate limit')"), 'email rate limit tested first');

  const onboarding = read('ui/onboarding.html');
  assert.ok(onboarding.includes("['loc_onsite', 'search.onsite_availability']"), 'on-site availability saved where the evaluator reads it');
  assert.ok(onboarding.includes('if (!stepValid(i))'), 'finish validates every step');
  assert.ok(onboarding.includes('localStorage.setItem(DEFER_KEY, String(Date.now()))'), 'save & finish later sets the per-account deferral');
});

// The tab-wide sessionStorage flag was tied to no account: after one user
// deferred and signed out, the next account signing in on the same tab skipped
// the onboarding. Only the per-account localStorage key defers now.
test('onboarding deferral is per account only; the tab-wide flag is gone', () => {
  const legacy = /sessionStorage\.(getItem|setItem)\(\s*['"`]jobyougo:onboarding-deferred['"`]/;
  for (const page of ['ui/onboarding.html', 'ui/index.html', 'ui/login.html']) {
    assert.ok(!legacy.test(read(page)), `${page} neither reads nor sets the tab-wide deferral flag`);
  }
  const onboarding = read('ui/onboarding.html');
  assert.ok(!/sessionStorage\.(getItem|setItem)\(/.test(onboarding), 'onboarding keeps nothing in sessionStorage');
  assert.ok(onboarding.includes("sessionStorage.removeItem('jobyougo:onboarding-deferred')"), 'a leftover flag from an older version is removed');
  assert.ok(onboarding.includes('const DEFER_KEY = `jobyougo:onboarding-deferred:${userId}`;'), 'per-account key');
  assert.ok(read('ui/index.html').includes('`jobyougo:onboarding-deferred:${session.user.id}`'), 'dashboard reads the per-account key');
  assert.ok(read('ui/login.html').includes('`jobyougo:onboarding-deferred:${userId}`'), 'login reads the per-account key');
});

// The CV import was dead for PDFs: the classic pdf.js 4.0.379 build the page
// loaded is a 404 on the CDN, so every PDF failed before reaching the server.
test('onboarding reads PDF, Word, text and photos, then analyses without an extra click', () => {
  const page = read('ui/onboarding.html');
  assert.ok(page.includes("'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/legacy/build/'"), 'pdf.js 6 legacy build');
  assert.ok(page.includes("import(PDFJS_BASE + 'pdf.min.mjs')"), 'pdf.js loaded lazily as ESM');
  assert.ok(page.includes("PDFJS_BASE + 'pdf.worker.min.mjs'"), 'matching ESM worker');
  assert.ok(!page.includes('build/pdf.min.js'), 'the dead classic build is gone');
  assert.ok(page.includes('isEvalSupported: false'), 'no eval in the PDF reader');
  assert.ok(page.includes("a.subtype === 'Link' && (a.url || a.unsafeUrl)"), 'link annotations are collected');
  assert.ok(page.includes("'https://cdn.jsdelivr.net/npm/mammoth@1.12.3/mammoth.browser.min.js'"), 'Word reader');
  assert.ok(page.includes('new DOMParser().parseFromString(html'), 'converted Word HTML is parsed, never inserted');
  assert.ok(page.includes('createImageBitmap(file'), 'photos are read');

  const accept = page.match(/id="cv-file" accept="([^"]+)"/)?.[1] || '';
  for (const ext of ['.pdf', '.docx', '.txt', '.md', '.jpg', '.jpeg', '.png', '.webp']) assert.ok(accept.split(',').includes(ext), `accept lists ${ext}`);
  for (const mime of ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png', 'image/webp']) {
    assert.ok(accept.split(',').includes(mime), `accept lists ${mime}`);
  }
  assert.ok(page.includes('PDF, Word, text or a photo · up to 5 MB'), 'dropzone copy');

  // Upload starts the analysis; the request carries the extracted links and,
  // for a scan or a photo, the page images (shared contract with the server).
  assert.ok(/async function importFile\(file\)[\s\S]*?await runImport\(/.test(page), 'upload runs the import directly');
  assert.ok(page.includes("authFetch('/api/profile/cv-parse'"), 'CV import endpoint');
  assert.ok(page.includes('lastFilePayload = { markdown: read.markdown, links: read.links, images: read.images, file_name: file.name };'), 'links + images sent');
  assert.ok(page.includes('new AbortController()') && page.includes("id=\"cv-cancel\""), 'the analysis can be cancelled');
  assert.ok(page.includes('IMPORT_TIMEOUT_MS = 240_000'), 'client timeout');
});

test('onboarding applies an import with provenance and never clobbers typed answers', () => {
  const page = read('ui/onboarding.html');
  assert.ok(page.includes('state.imported'), 'provenance of imported values');
  assert.ok(page.includes('id="cv-replace"'), 'explicit "replace what I entered" opt-in');
  assert.ok(page.includes("? !str(current).trim() || sameText(current, userEmail) || untouched || replace"), 'CV email replaces only an empty or account email');
  assert.ok(page.includes("if (untouched && path !== 'candidate.email') setByPath(path, emptyValueOf(path));"), 'empty CV values never clear typed answers or the email');
  assert.ok(page.includes("badge.textContent = 'From your CV'"), 'From your CV badges');
  assert.ok(page.includes("'Use the original text instead'") || page.includes('>Use the original text instead<'), 'structured / original CV toggle');
  assert.ok(!page.includes('mergeParsedProfile'), 'old merge removed');
});

test('onboarding binds the new fields and keeps drafts per account', () => {
  const page = read('ui/onboarding.html');
  assert.ok(page.includes("['current_title', 'search.current_role.title']"), 'current title bound');
  assert.ok(page.includes("['current_company', 'search.current_role.company']"), 'current company bound');
  assert.ok(page.includes("['loc_postal', 'location.postal_code']"), 'postal code bound');
  assert.ok(page.includes("['email', 'candidate.email']"), 'email bound');
  assert.ok(/<input id="email"[^>]*>/.test(page) && !/<input id="email"[^>]*disabled/.test(page), 'email is editable');
  assert.ok(!/^\s*p\.candidate\.email = userEmail;$/m.test(page), 'the account email no longer overwrites the profile email');
  assert.ok(page.includes('p.candidate.email = str(p.candidate.email).trim() || userEmail;'), 'saved email defaults to the account email only when empty');
  assert.ok(page.includes('<option value="">Choose…</option>\n            <option value="EUR">'), 'currency starts unset');
  assert.ok(page.includes("if (typeof p.location.needs_sponsorship !== 'boolean') delete p.location.needs_sponsorship;"), 'sponsorship sent only when known');
  assert.ok(page.includes('`jobyougo:onboarding-draft:v2:${userId}`'), 'draft key v2');
  assert.ok(page.includes('localStorage.removeItem(LEGACY_DRAFT_KEY)'), 'old draft key removed');
  assert.ok(page.includes('if (booted) saveDraft();'), 'a 401 before boot does not overwrite the draft');
  assert.ok(page.includes('`jobyougo:onboarding-deferred:${userId}`'), 'per-account deferral');
  assert.ok(page.includes("if (!state.loaded) throw new Error("), 'a failed load never saves over the stored profile');
  assert.ok(page.includes('result?.degraded === true'), 'degraded saves are reported');
});

test('dashboard and login honour the per-account deferral; dashboard profile page escapes and guards saves', () => {
  const index = read('ui/index.html');
  assert.ok(index.includes('`jobyougo:onboarding-deferred:${session.user.id}`'), 'dashboard gate');
  assert.ok(index.includes('value="${escapeHtml(arch.name || \'\')}"'), 'archetype name escaped');
  assert.ok(index.includes('value="${escapeHtml(p.name || \'\')}"'), 'proof point name escaped');
  assert.ok(index.includes('if (!profileFormLoaded) {'), 'no save from a form that never loaded');
  assert.ok(index.includes('if (cvMarkdown.trim() || profileCvLoaded) {'), 'no empty CV PUT when the CV never loaded');

  const login = read('ui/login.html');
  assert.ok(login.includes('`jobyougo:onboarding-deferred:${userId}`'), 'login honours the deferral');
  assert.ok(login.includes("return onboardingDeferred(userId) ? (safeNext() || '/dashboard') : '/onboarding';"), 'deferred accounts land on the dashboard');
});

// ── Onboarding review fixes (OB-F1…F11, GATE-F1/F4/F8) ─────────────────
// The page has no build step and no module boundary, so its small pure
// helpers are run here straight from its source.
// Top-level functions of the module script sit at a two-space indent and end
// at the first line that is exactly "  }".
function pageFunction(page, name) {
  const at = page.indexOf(`function ${name}(`);
  assert.ok(at >= 0, `function ${name} is in the page`);
  const start = page.lastIndexOf('\n', at) + 1;
  return page.slice(start, page.indexOf('\n  }\n', at) + 4);
}
function pageConst(page, name) {
  const start = page.indexOf(`  const ${name} = `);
  assert.ok(start >= 0, `const ${name} is in the page`);
  return page.slice(start, page.indexOf('\n', start));
}
function draftHelpers() {
  const page = read('ui/onboarding.html');
  const start = page.indexOf('/* draft-helpers:start */');
  const end = page.indexOf('/* draft-helpers:end */');
  assert.ok(start > 0 && end > start, 'draft-helpers markers');
  return new Function(`'use strict';\n${page.slice(start, end)}\nreturn { sameStamp, draftRestore, fitText };`)();
}

test('OB-F1/GATE-F4: a draft restores its answers only over the stored profile it was based on', () => {
  const { sameStamp, draftRestore } = draftHelpers();
  const at = '2026-10-09T10:00:00.123456+00:00';
  assert.ok(sameStamp(at, '2026-10-09T10:00:00.123+00:00'), 'same instant written differently');
  assert.ok(!sameStamp(at, '2026-10-09T10:01:00+00:00'));
  assert.ok(sameStamp(null, ''), 'no stored row on either side');
  assert.ok(!sameStamp(null, at) && !sameStamp(at, undefined), 'one stamp missing');

  const profile = { location: { remote_policy: 'On-site acceptable' }, compensation: { target_range: '60K' } };
  const draft = { savedAt: Date.parse(at) + 60_000, serverUpdatedAt: at, profile, cv_markdown: '# Jane' };
  assert.deepEqual(draftRestore(draft, { loaded: true, serverStamp: at }), { answers: true, stale: false });
  // Edited on the dashboard 30 s after the draft's base, even though the
  // client clock saved the draft later: the stored profile wins.
  assert.deepEqual(draftRestore(draft, { loaded: true, serverStamp: '2026-10-09T10:00:30Z' }), { answers: false, stale: true });
  assert.deepEqual(draftRestore({ ...draft, serverUpdatedAt: null }, { loaded: true, serverStamp: at }), { answers: false, stale: true });
  // After Save & finish later only the provenance is kept, whatever the stamps say.
  const synced = { savedAt: 1, synced: true, serverUpdatedAt: at, imported: {}, step: 3 };
  assert.deepEqual(draftRestore(synced, { loaded: true, serverStamp: '2026-10-09T11:00:00Z' }), { answers: false, stale: false });
  assert.deepEqual(draftRestore({ ...synced, profile }, { loaded: true, serverStamp: at }), { answers: false, stale: false });
  // Nothing to compare while the stored profile cannot be loaded.
  assert.deepEqual(draftRestore(draft, { loaded: false, serverStamp: '' }), { answers: true, stale: false });
  // Answers typed while the load failed, and drafts from before the stamp:
  // the time of the last edit decides, with no grace window.
  const blind = { savedAt: Date.parse(at) + 1000, loadFailed: true, serverUpdatedAt: null, profile };
  assert.equal(draftRestore(blind, { loaded: true, serverStamp: at }).answers, true);
  assert.equal(draftRestore({ ...blind, savedAt: Date.parse(at) - 1000 }, { loaded: true, serverStamp: at }).stale, true);
  assert.equal(draftRestore({ savedAt: Date.parse(at) - 1000, profile }, { loaded: true, serverStamp: at }).stale, true);
  assert.equal(draftRestore({ savedAt: 5, profile }, { loaded: true, serverStamp: null }).answers, true, 'new account without a row');
  assert.deepEqual(draftRestore(null, { loaded: true, serverStamp: at }), { answers: false, stale: false });

  const page = read('ui/onboarding.html');
  assert.ok(!page.includes('120_000'), 'no client-clock grace window');
  assert.ok(page.includes('state.serverUpdatedAt = str(result?.updated_at).trim() || null;'), 'stamp refreshed from the PUT answer');
  const provenance = page.match(/const provenance = \{([^}]*)\};/)?.[1] || '';
  assert.ok(provenance.includes('serverUpdatedAt: state.serverUpdatedAt'), 'stamp saved in the draft');
  assert.ok(!/\bprofile:|cv_markdown:/.test(provenance), 'provenance carries no answers');
  assert.ok(page.includes('? { ...provenance, synced: true }'), 'a synced draft is provenance only');
  assert.ok(page.includes('saveDraft({ synced: !degraded });'), 'save & finish later leaves a synced draft, unless the save was partial');
  assert.ok(!page.includes('the draft wins on return'));
  assert.ok(page.includes('const restore = draftRestore(draft, { loaded: existing.ok, serverStamp });'));
  assert.ok(/if \(restore\.answers\) \{\s+absorbProfile\(draft\.profile/.test(page), 'answers absorbed only from a fresh draft');
  assert.ok(page.includes('} else if (restore.stale) {'), '"updated elsewhere" notice');
});

test('OB-F2: a failed or cancelled re-import never replaces the CV of a successful import', () => {
  const page = read('ui/onboarding.html');
  assert.ok(page.includes('keepExtractedText(run.extracted, run.reason);'));
  const make = new Function('state', 'cvText', '$', [
    pageConst(page, 'str'), pageConst(page, 'sameCv'),
    'const MIN_CV_CHARS = 200; const renderCvVersion = () => {}; const scheduleDraft = () => {};',
    pageFunction(page, 'keepExtractedText'), 'return keepExtractedText;',
  ].join('\n'));
  const setup = (cv, extra = {}) => {
    const state = { cv_markdown: cv, imported: { cv_markdown: cv }, cvSource: 'text of file A', cvStructured: cv, keptExtracted: '', ...extra };
    const box = { value: '' }; const field = { value: cv };
    return { state, box, keep: make(state, box, (id) => (id === 'cv_markdown' ? field : null)) };
  };
  const A = `# Jane Smith\n\n## Experience\n${'Built the design system. '.repeat(12)}`;
  const B = `Jane Smith raw text of an older file ${'more words '.repeat(30)}`;
  const C = `Another failed read ${'words '.repeat(50)}`;

  // Import A succeeded, then file B failed (429, 502, timeout): A stays.
  let { state, box, keep } = setup(A);
  keep(B, 'timeout');
  assert.equal(state.cv_markdown, A);
  assert.equal(state.cvStructured, A, 'the structured version stays available');
  assert.equal(state.cvSource, 'text of file A');
  assert.equal(box.value, B.trim(), 'the text read is still offered in the paste box');

  // A cancelled import (often the wrong file) only fills the paste box.
  ({ state, box, keep } = setup('', { imported: {}, cvSource: '', cvStructured: '' }));
  keep(B, 'cancel');
  assert.equal(state.cv_markdown, '');
  assert.equal(box.value, B.trim());

  // An empty CV takes the text read; a later failed import may replace that text.
  ({ state, box, keep } = setup('', { imported: {}, cvSource: '', cvStructured: '' }));
  keep(B, '');
  assert.equal(state.cv_markdown, B.trim());
  assert.equal(state.keptExtracted, B.trim());
  assert.equal(state.imported.cv_markdown, B.trim(), 'a later successful import may replace it');
  assert.equal(state.cvSource, '', 'no CV version is invented from a failed import');
  keep(C, '');
  assert.equal(state.cv_markdown, C.trim());

  // Text the user typed is never replaced.
  state.cv_markdown = `My own CV ${'typed '.repeat(50)}`;
  keep(B, '');
  assert.ok(state.cv_markdown.startsWith('My own CV'));

  assert.ok(page.includes("state.keptExtracted = '';"), 'a successful import clears the kept text');
});

test('OB-F4: answers typed while the profile did not load never carry the empty shell defaults', () => {
  const page = read('ui/onboarding.html');
  const absorb = pageFunction(page, 'absorbProfile');
  assert.ok(absorb.includes('sameValue(value, defaults[section][key])'), 'the sign-in email default is skipped');
  assert.ok(absorb.includes('!(skipEmpty && src.spend_tier === defaults.spend_tier)'), 'the standard tier default is skipped');
  assert.ok(page.includes('absorbProfile(draft.profile, { skipEmpty: draft.loadFailed === true });'));
});

test('OB-F5: role-family and proof-point rows without a name do not block the CV values', () => {
  const page = read('ui/onboarding.html');
  const { isEmptyField } = new Function([
    pageConst(page, 'isObj'), pageConst(page, 'str'), pageFunction(page, 'isEmptyValue'),
    pageConst(page, 'NAMED_ROW_PATHS'), pageFunction(page, 'isEmptyField'), 'return { isEmptyField };',
  ].join('\n'))();
  assert.equal(isEmptyField('target_roles.archetypes', [{ name: '', level: '', fit: 'secondary' }]), true);
  assert.equal(isEmptyField('narrative.proof_points', [{ name: '  ', url: '', hero_metric: '' }]), true);
  assert.equal(isEmptyField('target_roles.archetypes', [{ name: '', fit: 'secondary' }, { name: 'Product Designer' }]), false);
  assert.equal(isEmptyField('narrative.proof_points', []), true);
  assert.equal(isEmptyField('candidate.phone', ' '), true);
  assert.equal(isEmptyField('target_roles.primary', ['Designer']), false);
  const apply = pageFunction(page, 'applyImport');
  assert.ok(apply.includes(': isEmptyField(path, current) || untouched || replace || sameValue(current, incoming);'), 'import write rule');
  assert.ok(pageFunction(page, 'hasUserData').includes('!isEmptyField(path, getByPath(path))'));
  assert.ok(pageFunction(page, 'isFromImport').includes('if (isEmptyField(path, current)) return false;'));
});

test('OB-F6: a headline longer than 120 characters is cut at a word boundary', () => {
  const { fitText } = draftHelpers();
  const tagline = 'Senior product designer turned AI builder — 10 years shipping B2B software for fintech, insurance | public sector teams in Europe';
  assert.ok(tagline.length > 120 && tagline.length <= 160);
  const cut = fitText(tagline, 120);
  assert.ok(cut.length <= 120, cut);
  assert.ok(tagline.startsWith(cut), 'a prefix of the CV text');
  assert.ok(/[\s|—–,]/.test(tagline[cut.length]), 'cut at a boundary, not mid-word');
  assert.ok(!/[\s|—–\-,;:·/&+(]$/.test(cut), 'no trailing separator');
  assert.equal(fitText('Designer, builder | mentor — speaker', 24), 'Designer, builder');
  assert.equal(fitText('  Product   designer ', 120), 'Product designer');
  assert.equal(fitText('x'.repeat(130), 120), 'x'.repeat(120), 'no space: hard cut');
  assert.equal(fitText(null, 120), '');
  const page = read('ui/onboarding.html');
  assert.ok(page.includes("if (path === 'narrative.headline') return fitText(v, 120);"), 'imported headline');
  assert.ok(page.includes('const text = fitText(state.suggestions[key], max);'), 'suggested headline and story');
  assert.ok(!page.includes('.slice(0, 120)'));
});

test('OB-F7/OB-F9: no horizontal scroll from a long file name; dropped files never open in the tab', () => {
  const page = read('ui/onboarding.html');
  assert.ok(/\.dropzone-file \{[^}]*max-width: 100%; overflow-wrap: anywhere;/.test(page), 'file name wraps');
  assert.ok(page.includes('.shell { grid-template-columns: minmax(0, 1fr);'), 'mobile shell track can shrink');
  assert.ok(page.includes('.grid, .import-grid, .review, .parsed-summary { grid-template-columns: minmax(0, 1fr); }'));
  assert.ok(!/\.dropzone\.is-busy[^{]*\{[^}]*pointer-events: none/.test(page), 'the busy zone still receives the drop');
  assert.ok(page.includes("['dragover', 'drop'].forEach(evt => document.addEventListener(evt, (e) => {"), 'document-level guard');
  assert.ok(page.includes(".includes('Files')) e.preventDefault();"), 'only file drags are stopped');
  assert.ok(page.includes("if (currentImport) { showCvAlert('An import is already running."), 'a drop during an import is refused out loud');
});

test('OB-F8: import progress is announced once per stage and the outcome gets focus', () => {
  const page = read('ui/onboarding.html');
  assert.ok(page.includes('id="cv-elapsed" aria-hidden="true"'), 'the seconds counter is not read out');
  assert.ok(page.includes('<div class="rail-track" aria-hidden="true"><div class="rail-fill" id="cv-progress-fill">'));
  assert.ok(page.includes("if ($('cv-stage').textContent !== label) $('cv-stage').textContent = label;"), 'stage rewritten only when it changes');
  assert.ok(page.includes('title.tabIndex = -1;'), 'the result heading can take focus');
  assert.ok(page.includes("focusAfterImport($('cv-result').querySelector('.import-result-title'));"), 'success focuses the result');
  assert.ok(page.includes('focusAfterImport(cvAlert);'), 'failure and cancel focus the alert');
  assert.ok(page.includes('id="cv-alert" role="status" aria-live="polite" tabindex="-1"'));
  assert.ok(page.includes('showStep(1, { focusSummary: followFocus });'), 'focus follows the automatic jump');
});

test('OB-F10: retrying from the paste box resends the file name and links of the file read', () => {
  const page = read('ui/onboarding.html');
  assert.ok(page.includes('const file = lastFilePayload && sameCv(text, lastFilePayload.markdown) ? lastFilePayload : null;'));
  assert.ok(page.includes('runImport(async () => file || { markdown: text }, { fromFile: Boolean(file) });'));
  assert.ok(pageFunction(page, 'importFile').includes('lastFilePayload = null;'), 'a new file forgets the previous one');
});

test('GATE-F8: signing out never leaves the answers on the device without asking', () => {
  const page = read('ui/onboarding.html');
  const signout = page.slice(page.indexOf("$('signout-link').addEventListener("), page.indexOf('// ── Step 0: import'));
  assert.ok(signout.includes('if (saved) removeDraft();'), 'saved: the draft goes');
  assert.ok(signout.includes("if (confirm('Keep an unsaved copy of your answers on this device?')) saveDraft(); else removeDraft();"), 'unsaved: the user decides');
  assert.ok(!/\bif \(saved\) removeDraft\(\); else saveDraft\(\);/.test(signout), 'no silent copy left behind');
  assert.ok(signout.includes('saved = !(await pushProfile({ complete: false })).degraded;'), 'a partial save asks too');
});

test('a partial profile save names the missing sections and keeps the draft answers', () => {
  const page = read('ui/onboarding.html');
  assert.ok(!page.includes('phone, links, languages, availability.'), 'no fixed list of sections');
  assert.ok(page.includes('missingColumns: Array.isArray(result?.missing_columns) ? result.missing_columns.map(String) : []'));
  const start = page.indexOf('const DEGRADED_SECTIONS = {');
  const end = page.indexOf("draft.`;", start) + "draft.`;".length;
  assert.ok(start > 0 && end > start, 'degraded message helpers');
  const { degradedMessage } = new Function(`${page.slice(start, end)}\nreturn { degradedMessage };`)();
  assert.match(degradedMessage(['screening']), /: application-form answers\. Your answers stay in this browser's draft\.$/);
  assert.match(degradedMessage(['candidate', 'new_column']), /: phone, links, languages and education, new_column\./);
  const submit = pageFunction(page, 'submit');
  assert.ok(submit.includes('if (degraded) saveDraft(); else removeDraft();'), 'finishing with a partial save keeps the answers');
  assert.ok(submit.indexOf('if (degraded) saveDraft()') < submit.indexOf('leaving = true;'), 'saved before leaving blocks the draft');
});

// The pages have no build step: a stray backtick or brace in an inline script
// only shows up as a blank page in the browser. Parse them here.
test('inline scripts of the auth pages parse', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jobyougo-pages-'));
  try {
    for (const page of ['ui/onboarding.html', 'ui/login.html', 'ui/index.html', 'ui/reset-password.html']) {
      const html = read(page);
      let modules = 0;
      for (const [, attrs, body] of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
        if (/\bsrc=/.test(attrs) || !body.trim()) continue;
        if (/type="module"/.test(attrs)) {
          // Top-level await is valid in a module: check it as an .mjs file.
          const file = join(dir, `${page.replace(/\W+/g, '-')}-${modules++}.mjs`);
          writeFileSync(file, body);
          execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
        } else {
          assert.doesNotThrow(() => new vm.Script(body, { filename: page }), `${page} classic script`);
        }
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
