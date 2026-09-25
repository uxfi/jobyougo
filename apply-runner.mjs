#!/usr/bin/env node
// apply-runner.mjs — drives a VISIBLE Chrome window through a job application:
// navigate to the offer, follow redirects to the real ATS form, fill fields with
// Section F answers + regional identity, upload the regional CV, then submit
// when autoSubmit is enabled. It uses PinchTab for captcha / verification
// pages when enabled, and pauses only if the solver fails or manual gaps remain.
//
// Usage: node apply-runner.mjs --run-dir scratch/apply-runs/<runId>
// The run dir must contain spec.json (built by lib/apply-spec.mjs).
// Protocol (file-based, survives server restarts):
//   - state.json   ← runner writes status after every step (server polls it)
//   - command.json ← server writes {action: submit|rescan|abort|manual_sent|close}, runner consumes it

import 'dotenv/config';
import { readFileSync, writeFileSync, renameSync, existsSync, unlinkSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { resolveUnknownFields } from './lib/apply-llm.mjs';
import { classifyField } from './lib/apply-classify.mjs';
import { pickDeclineOption, pickSelectOption, llmKind } from './lib/apply-select.mjs';
import { polishApplicationAnswer, hasUnresolvedPlaceholder, loadApplicationVoice } from './lib/application-writing.mjs';
import { looksLikeTypeahead, isComboboxField, shouldSpeculativeProbe, shouldHumanType, fieldIsMulti, skipComboboxProbe, shouldFillField, isResumeFileField, shouldReplaceFilledValue, locationTypeaheadHint } from './lib/apply-fill-guards.mjs';
import { blockerProbe, BLOCKER_PROBE_ARGS } from './lib/apply-blocker-probe.mjs';
import { fieldCompletionIssue, fieldMatchesAnswer, looksReadyToSubmit } from './lib/apply-completion.mjs';
import { COLLECT_FIELDS } from './lib/apply-collect-fields.mjs';
import { watchApplicationTransition, exploreApplicationInterface } from './lib/apply-navigation.mjs';
import { ACTIVATE_MATCHED_OPTION, COMBOBOX_OPTION_QUERY, COMBOBOX_OPTION_SEL, LIST_SELECTION_STATE } from './lib/apply-combobox-dom.mjs';
import { pickMatchingOption, choiceKind, selectionLooksCommitted } from './lib/apply-option-match.mjs';
import {
  PINCHTAB_URL,
  pinchtabClose,
  pinchtabCookies,
  pinchtabHealth,
  pinchtabNavigate,
  pinchtabSolve,
  pinchtabSolveSucceeded,
} from './lib/pinchtab.mjs';
import { APPLICATION_FORM_PROBE, AUTH_AVOID_TEXT_RE, GUEST_TEXT_RE, LIST_VISIBLE_NAV_BUTTONS, MARK_PROGRESSION_CONTROLS, PAGE_SHOWS_APPLY_ENTRY, PAGE_STEP_SNAPSHOT } from './lib/form-detect.mjs';
import { normalizeAtsUrl } from './extension/apply-ats.mjs';
import {
  AUTOFILL_WAIT_MS,
  autofillShouldKeepWaiting,
  judgeAutofillSnapshot,
  snapshotIdentityFields,
} from './extension/apply-autofill.mjs';
import { collectUploadSignals, judgeUploadSignals } from './extension/apply-upload-signals.mjs';
import { APPLY_TEXT_RE, PROGRESS_TEXT_RE, SUBMIT_TEXT_RE, countEditableApplyFields, fieldsFingerprint, isBlockingApplyPending, pageLooksLikeReviewStep, reviewStepNeedsAi } from './lib/apply-progression.mjs';
import { exactControlPattern, filterNavButtons, navDecisionLog, resolveNavAction } from './lib/apply-nav-llm.mjs';
import {
  isHimalayasHost,
  isHimalayasLoginPath,
  shouldEnsureHimalayasSession,
  samePageUrl,
  inferHimalayasLoggedIn,
  canAttemptHimalayasLogin,
  looksLikeHimalayasLoginError,
} from './lib/himalayas-apply.mjs';
import { computeStartDateISO as toIsoDate } from './lib/apply-spec.mjs';
import {
  basenamePath,
  chromeClosedMessage,
  isTargetClosedError,
  looksLikePostApplyPath,
  POST_APPLY_PATH_RE_SOURCE,
  postApplyMessage,
} from './lib/apply-runtime.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Compact CV digest fed to the LLM field resolver (read once, lazily).
let _cvSummary = null;
function cvSummary() {
  if (_cvSummary !== null) return _cvSummary;
  try { _cvSummary = readFileSync(join(__dirname, 'cv.md'), 'utf-8').replace(/\s+\n/g, '\n').slice(0, 3000); }
  catch { _cvSummary = ''; }
  return _cvSummary;
}

function profileVoice() {
  return loadApplicationVoice(__dirname);
}

const ROOT = __dirname;

const runDirArg = process.argv.indexOf('--run-dir');
if (runDirArg === -1 || !process.argv[runDirArg + 1]) {
  console.error('Usage: node apply-runner.mjs --run-dir <dir>');
  process.exit(1);
}
const RUN_DIR = join(ROOT, process.argv[runDirArg + 1]);
mkdirSync(RUN_DIR, { recursive: true });
const spec = JSON.parse(readFileSync(join(RUN_DIR, 'spec.json'), 'utf-8'));
const AUTO_SOLVE_CHALLENGES = spec.solveChallenges !== false && process.env.APPLY_SOLVE_CHALLENGES !== '0';
const SOLVE_MAX_RUN_ATTEMPTS = Math.max(1, Number.parseInt(process.env.APPLY_SOLVE_MAX_ATTEMPTS || '2', 10) || 2);
const SOLVE_TIMEOUT_MS = Math.max(15000, Number.parseInt(process.env.APPLY_SOLVE_TIMEOUT_MS || '40000', 10) || 40000);
const STATE_WRITE_RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

// ── State management ──────────────────────────────────────────────────────────

const state = {
  runId: basenamePath(RUN_DIR),
  state: 'launching',
  message: '',
  company: spec.company,
  role: spec.role,
  region: spec.region,
  cv: basenamePath(spec.cvPath),
  jobUrl: spec.jobUrl,
  currentUrl: '',
  steps: [],
  filled: [],
  pending: [],
  screenshots: [],
  confirmed: false,
  updatedAt: null,
};

async function writeStateNow() {
  state.updatedAt = new Date().toISOString();
  const finalPath = join(RUN_DIR, 'state.json');
  const payload = JSON.stringify(state, null, 2);
  let lastErr = null;

  for (let attempt = 0; attempt < 8; attempt++) {
    const tmp = join(RUN_DIR, `state.json.${process.pid}.${Date.now()}.${attempt}.tmp`);
    try {
      writeFileSync(tmp, payload);
      renameSync(tmp, finalPath);
      return;
    } catch (err) {
      lastErr = err;
      try { if (existsSync(tmp)) unlinkSync(tmp); } catch {}
      if (!STATE_WRITE_RETRY_CODES.has(err?.code)) throw err;
      await sleep(40 + attempt * 45);
    }
  }

  // Windows can briefly reject an atomic rename when the dashboard/AV is reading
  // the state file. Keep the runner alive and publish the latest state anyway.
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      writeFileSync(finalPath, payload);
      return;
    } catch (err) {
      lastErr = err;
      if (!STATE_WRITE_RETRY_CODES.has(err?.code)) throw err;
      await sleep(80 + attempt * 80);
    }
  }

  throw lastErr;
}

// Serializes writes behind a queue: writeStateNow's retry backoff uses
// `await sleep` (not a blocking Atomics.wait), which means two overlapping
// calls (one retrying on a Windows file lock, a fresher one from a later
// log()/setState() landing in the meantime) could otherwise interleave —
// the retrying call's payload was captured before the fresher one wrote, so
// it would finish LAST and silently overwrite state.json with stale data.
// Queuing means writeStateNow only ever starts (and captures `state`) after
// every earlier call has fully settled, restoring the write-ordering
// guarantee the old blocking implementation gave for free. The queue link
// itself must never reject (a .catch swallows it) or every later call would
// permanently inherit that rejection instead of running its own write.
let writeQueue = Promise.resolve();
function writeState() {
  const task = writeQueue.then(writeStateNow);
  writeQueue = task.catch(() => {});
  return task;
}

function setState(s, message = '') {
  state.state = s;
  if (message) state.message = message;
  log(`[${s}] ${message}`);
}

const MAX_LOG_STEPS = 500;
function log(text) {
  state.steps.push({ ts: new Date().toISOString(), text });
  // Defense in depth against any future runaway loop (the circuit breaker
  // above targets one specific known cause, not every possible one): a run
  // stuck live for 3 days once pushed state.json to 103MB / 2.86M lines from
  // this array alone. Keep only the most recent steps so a stuck run stays
  // cheap to write and readable, instead of growing without bound.
  if (state.steps.length > MAX_LOG_STEPS) state.steps = state.steps.slice(-MAX_LOG_STEPS);
  console.log(text);
  // log() is called from many non-async call sites, so this write is
  // fire-and-forget; total failure (retries exhausted) is still surfaced
  // loudly instead of vanishing into an unhandled rejection.
  writeState().catch(err => console.error('[apply] échec définitif de l’écriture d’état:', err?.message || err));
}

// Diagnostic trace for the dropdown machinery — stdout only, never written into
// state.json (the UI timeline should stay readable). Enable with APPLY_DEBUG=1
// when a specific field won't fill and you need to see what the widget actually
// exposed at each step.
const DEBUG = process.env.APPLY_DEBUG === '1';
function dbg(text) {
  if (DEBUG) console.log(`  [dbg] ${text}`);
}

function readCommand() {
  const cmdPath = join(RUN_DIR, 'command.json');
  if (!existsSync(cmdPath)) return null;
  try {
    const cmd = JSON.parse(readFileSync(cmdPath, 'utf-8'));
    unlinkSync(cmdPath);
    return cmd?.action || null;
  } catch { return null; }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const rand = (min, max) => Math.floor(min + Math.random() * (max - min));
const jitter = (ms, pct = 0.35) => sleep(Math.round(ms * (1 - pct + Math.random() * pct * 2)));

// Move the mouse toward the target before clicking instead of Playwright's
// default instant teleport-then-click — cheap, and applied to every primary
// interaction (apply/submit buttons, field focus, dropdown open).
async function humanClick(loc, opts = {}) {
  try {
    const page = loc.page();
    const box = await loc.boundingBox();
    if (box && page?.mouse) {
      const x = box.x + box.width * (0.3 + Math.random() * 0.4);
      const y = box.y + box.height * (0.3 + Math.random() * 0.4);
      await page.mouse.move(x + rand(-50, 50), y + rand(-40, 40), { steps: rand(3, 6) });
      await sleep(rand(40, 140));
      await page.mouse.move(x, y, { steps: rand(6, 14) });
      await sleep(rand(30, 110));
    }
  } catch { /* best effort — the click below still fires if the pre-move failed */ }
  await loc.click(opts);
}

// toIsoDate = lib/apply-spec.mjs's computeStartDateISO (imported above,
// aliased): same DD/MM/YYYY-vs-ISO parsing this file used to duplicate, now
// used here for LLM/plan date answers instead of only the spec's own
// availability.start_date.

// Answers "is there DEFINITELY still a value here"
// — an unreadable field reports false so callers keep the human-typing path
// rather than falling back to fill() on every exotic widget.
async function fieldStillHasValue(loc) {
  const v = await loc.inputValue({ timeout: 600 }).catch(() => null);
  if (v !== null) return v.trim().length > 0;
  return await loc.evaluate(el => ((el.innerText || el.textContent || '').trim().length > 0)).catch(() => false);
}

// Empty a field and confirm it is empty. fill('') handles standard inputs;
// controlled React inputs and rich-text editors (Quill/Slate) ignore it, so
// retry with a real select-all + Delete, which they do process.
// NOT Control+a on macOS — there that's "line start", not select-all.
async function clearField(loc) {
  await loc.fill('').catch(() => {});
  if (!(await fieldStillHasValue(loc))) return true;
  await loc.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a').catch(() => {});
  await loc.press('Delete').catch(() => {});
  return !(await fieldStillHasValue(loc));
}

// Type text like a human into an input / textarea / contenteditable: focus the
// field, type with a per-word-varying delay, pause occasionally as if thinking,
// and clear any existing content first. Emits real keydown/keyup/input events
// (unlike fill(), which populates a field with zero keystrokes — a classic bot
// signal). VERIFIES the value landed (rich-text engines can swallow keystrokes)
// and falls back to fill(). Returns true only if content actually stuck.
async function humanType(loc, text, f) {
  const str = String(text);
  try {
    await loc.scrollIntoViewIfNeeded({ timeout: 1200 }).catch(() => {});
    await sleep(rand(120, 380));            // glance at the field before clicking
    await humanClick(loc, { timeout: 4000 });
    await sleep(rand(90, 260));             // settle after focus
    // Clear any pre-filled value before typing. This is load-bearing:
    // pressSequentially() appends, so typing into a field that still holds a
    // value (Ashby/Greenhouse "autofill from resume" populates the form in
    // Phase A, browser autofill, or an earlier fillFields pass after a
    // "Re-scanner") writes the answer twice. clearField is best-effort: on
    // the controlled React inputs / rich-text editors (Quill/Slate) it exists
    // to catch, it can fail to confirm empty even after both its techniques —
    // type anyway, since pressSequentially below is the one technique
    // documented to work on exactly those widgets, and the cleanup pass at
    // the end of this function wipes any resulting old+new concatenation if
    // it doesn't end up matching.
    await clearField(loc);
    // longer answers get a faster cadence so a full form still finishes in a
    // reasonable time, but every keystroke is still a real event. Split on
    // whitespace/word runs (lossless — keeps leading/internal whitespace).
    const [lo, hi] = str.length > 120 ? [8, 24] : [45, 110];
    for (const chunk of (str.match(/\s+|\S+/g) || [str])) {
      await loc.pressSequentially(chunk, { delay: rand(lo, hi) });
      if (/\S/.test(chunk) && Math.random() < 0.2) await sleep(rand(110, 460)); // think-pause
    }
    await sleep(rand(120, 320));
  } catch { /* fall through to verify + fallback */ }
  // confirm it stuck; rich-text editors (Quill/Slate) sometimes swallow keys
  if (await fieldMatchesAnswer(loc, str, f?.type)) return true;
  try { await loc.fill(str, { timeout: 5000 }); } catch { return false; }
  if (await fieldMatchesAnswer(loc, str, f?.type)) return true;
  // Both techniques failed to land the answer. If clearField couldn't
  // confirm empty earlier, pressSequentially may have appended onto
  // whatever was already there — leave the field genuinely empty (an
  // unambiguous "needs attention" a human can spot at a glance) rather than
  // a garbled old+new concatenation they'd have to untangle by hand.
  await clearField(loc).catch(() => {});
  return false;
}

const UPLOAD_SETTLE_MS = 2000;

// Identity / short answers: Playwright fill() (one input event). Long prose
// still goes through humanType so rich-text widgets and anti-bot checks see
// real keystrokes.
async function putText(loc, text, f) {
  const str = String(text);
  if (shouldHumanType(f, str)) return humanType(loc, str, f);
  try {
    await loc.scrollIntoViewIfNeeded({ timeout: 1200 }).catch(() => {});
    await loc.fill(str, { timeout: 4000 });
    if (await fieldMatchesAnswer(loc, str, f?.type)) return true;
  } catch { /* controlled / custom widgets often ignore fill() */ }
  return humanType(loc, str, f);
}

async function waitForFormResettle(frame, timeoutMs = UPLOAD_SETTLE_MS) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  let hits = 0;
  while (Date.now() < deadline) {
    const snap = await frame.evaluate(() => ({
      n: document.querySelectorAll('input, select, textarea, [role="combobox"]').length,
      files: [...document.querySelectorAll('input[type="file"]')]
        .map(el => [...(el.files || [])].map(f => f.name).join(',')).join('|'),
      busy: !!(document.querySelector('[aria-busy="true"]') || document.querySelector('[class*="uploading" i]')),
      len: document.body?.innerText?.length || 0,
    })).catch(() => null);
    if (!snap) return;
    const sig = `${snap.n}:${snap.files}:${snap.len}`;
    if (!snap.busy && sig === last) {
      hits += 1;
      if (hits >= 2) return;
    } else {
      hits = 0;
      last = sig;
    }
    await sleep(200);
  }
}

async function waitForResumeAutofill(frame, identity = {}, timeoutMs = AUTOFILL_WAIT_MS) {
  const read = () => frame.evaluate(snapshotIdentityFields).catch(() => []);
  const deadline = Date.now() + timeoutMs;
  let last = judgeAutofillSnapshot([], identity);
  while (Date.now() < deadline) {
    last = judgeAutofillSnapshot(await read(), identity);
    if (!autofillShouldKeepWaiting(last.status)) break;
    await sleep(200);
  }
  if (autofillShouldKeepWaiting(last.status)) {
    last = judgeAutofillSnapshot(await read(), identity);
  }
  const timedOut = autofillShouldKeepWaiting(last.status);
  if (last.status === 'matched') await sleep(400);
  return { ...last, timedOut, manualFill: last.status !== 'matched' };
}

async function confirmFrameUpload(frame, expectedName) {
  const page = frame.page();
  let networkOk = false;
  const onResponse = (res) => {
    try {
      const status = res.status();
      const method = res.request().method();
      const url = res.url();
      if (status >= 200 && status < 300 && /^(POST|PUT|PATCH)$/i.test(method) && /upload|resume|attachment|\bcv\b|\/file|document/i.test(url)) {
        networkOk = true;
      }
    } catch { /* detached */ }
  };
  page.on('response', onResponse);
  const deadline = Date.now() + 6000;
  let stable = 0;
  let last = judgeUploadSignals({}, { expectedName });
  try {
    while (Date.now() < deadline) {
      const raw = await frame.evaluate(collectUploadSignals, expectedName).catch(() => null);
      last = judgeUploadSignals({ ...(raw || {}), networkOk }, { expectedName });
      if (last.error) return last;
      if (last.ok && !last.pending) {
        stable += 1;
        if (stable >= 2) return last;
      } else {
        stable = 0;
      }
      await sleep(400);
    }
  } finally {
    page.off('response', onResponse);
  }
  if (last.pending && last.hits?.length) {
    return { ok: true, pending: false, error: false, reason: last.hits.join(', '), hits: last.hits };
  }
  if (last.pending) return { ok: false, reason: last.reason || 'spinner encore actif' };
  return last;
}

let shotCount = 0;
async function screenshot(page, label) {
  try {
    shotCount += 1;
    const name = `shot-${String(shotCount).padStart(2, '0')}-${label}.png`;
    await page.screenshot({ path: join(RUN_DIR, name), fullPage: false });
    state.screenshots.push(name);
    await writeState();
  } catch { /* page may be navigating */ }
}

// ── Browser ───────────────────────────────────────────────────────────────────

async function launchBrowser() {
  const mainProfile = join(ROOT, 'data', 'chrome-profile');
  // The shared profile keeps logins/cookies between runs, but Chrome locks it:
  // a concurrent run falls back to an isolated per-run profile.
  const profiles = [mainProfile, join(RUN_DIR, 'chrome-profile')];
  const opts = {
    headless: false,
    viewport: null,
    args: ['--disable-blink-features=AutomationControlled', '--window-size=1440,960'],
  };
  let lastErr;
  for (const profileDir of profiles) {
    for (const channel of ['chrome', undefined]) {
      try {
        const ctx = await chromium.launchPersistentContext(profileDir, channel ? { ...opts, channel } : opts);
        // Mask automation signals before any page script runs. Each one below
        // is a documented detector a real ATS bot-check (Cloudflare, DataDome,
        // PerimeterX-style) is known to probe:
        await ctx.addInitScript(() => {
          try {
            // navigator.webdriver=true is the #1 tell. A getter override is
            // itself detectable (its toString() isn't native code) — deleting
            // the property from the prototype is what real, non-automated
            // Chrome looks like: the property simply doesn't exist there.
            delete Object.getPrototypeOf(navigator).webdriver;

            // Any function we DO have to override needs to lie about its own
            // toString() too, or `fn.toString()` gives away the patch. Wrap
            // once, reuse below.
            const nativeToString = Function.prototype.toString;
            const patched = new WeakMap();
            Function.prototype.toString = function toString() {
              if (patched.has(this)) return `function ${patched.get(this)}() { [native code] }`;
              return nativeToString.call(this);
            };
            const markNative = (fn, name) => { patched.set(fn, name); return fn; };

            if (!navigator.languages || !navigator.languages.length) {
              Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
            }
            window.chrome = window.chrome || { runtime: {} };

            // A blank plugins/mimeTypes array is a classic headless/automation
            // tell — real Chrome always ships the built-in PDF plugins.
            if (!navigator.plugins || navigator.plugins.length === 0) {
              const fakePlugins = [
                { name: 'PDF Viewer', filename: 'internal-pdf-viewer' },
                { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer' },
                { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer' },
                { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer' },
                { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer' },
              ];
              Object.defineProperty(navigator, 'plugins', { get: () => fakePlugins });
              Object.defineProperty(navigator, 'mimeTypes', { get: () => fakePlugins.map(p => ({ type: 'application/pdf', description: p.name })) });
            }

            // navigator.permissions.query('notifications') answers 'denied' in
            // headless/automated Chrome even when Notification.permission is
            // still 'default' — a real browser never disagrees with itself
            // like this (a known Puppeteer/Playwright fingerprint check).
            if (window.navigator.permissions && window.navigator.permissions.query) {
              const originalQuery = window.navigator.permissions.query.bind(window.navigator.permissions);
              window.navigator.permissions.query = markNative((parameters) => (
                parameters?.name === 'notifications'
                  ? Promise.resolve({ state: Notification.permission, onchange: null })
                  : originalQuery(parameters)
              ), 'query');
            }

            // WebGL vendor/renderer leaking "Google SwiftShader" (the software
            // rasterizer some automated/virtualized Chrome falls back to)
            // instead of a real GPU string is another documented check. Only
            // override when that leak is actually present — channel:'chrome'
            // with hardware acceleration normally reports real values already,
            // so this is a fallback, not a blanket spoof.
            const patchWebglVendor = (proto) => {
              if (!proto) return;
              const getParameter = proto.getParameter;
              proto.getParameter = markNative(function (parameter) {
                const value = getParameter.call(this, parameter);
                if (typeof value === 'string' && /swiftshader|llvmpipe|software/i.test(value)) {
                  if (parameter === 37445) return 'Google Inc. (Intel)'; // UNMASKED_VENDOR_WEBGL
                  if (parameter === 37446) return 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0)'; // UNMASKED_RENDERER_WEBGL
                }
                return value;
              }, 'getParameter');
            };
            patchWebglVendor(window.WebGLRenderingContext?.prototype);
            patchWebglVendor(window.WebGL2RenderingContext?.prototype);
          } catch { /* best effort */ }
        }).catch(() => {});
        if (profileDir !== mainProfile) log('Profil principal verrouillé (autre run en cours) — profil isolé pour ce run.');
        return ctx;
      } catch (err) { lastErr = err; }
    }
  }
  throw lastErr;
}

// ── Blocker detection (captcha / cloudflare / login wall) ─────────────────────

function pageIsGone(page) {
  try { return !page || page.isClosed() === true; } catch { return true; }
}

function frameAlive(frame) {
  try { return !!frame && frame.isDetached() !== true; } catch { return false; }
}

function currentPageUrl(page) {
  try {
    if (!pageIsGone(page)) return page.url();
  } catch { /* closed */ }
  return state.currentUrl || '';
}

async function detectBlocker(page) {
  // Scan every frame, not just the top page: some ATS embed the whole
  // application form (and any captcha rendered inside it) in a cross-origin
  // iframe that top-level page.evaluate() can never see into. Playwright's
  // frame.evaluate() runs inside each frame's own execution context, so it
  // works regardless of origin.
  if (pageIsGone(page)) return null;
  try {
    const mainFrame = page.mainFrame();
    for (const frame of page.frames()) {
      if (frame.isDetached()) continue;
      try {
        const found = await frame.evaluate(blockerProbe, { ...BLOCKER_PROBE_ARGS, isMainFrame: frame === mainFrame });
        if (found) return found;
      } catch { /* frame navigating/detached mid-check — skip, next poll retries */ }
    }
  } catch (err) {
    if (isTargetClosedError(err)) return null;
    throw err;
  }
  return null;
}

function blockerLabel(blocker) {
  if (blocker === 'captcha') return 'captcha';
  if (blocker === 'cloudflare') return 'page de vérification';
  if (blocker === 'login') return 'connexion';
  if (blocker === 'auth_wall') return 'création de compte requise';
  return 'vérification';
}

function normalizePinchtabCookieList(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.cookies)) return raw.cookies;
  if (Array.isArray(raw?.result)) return raw.result;
  return [];
}

function cookieMatchesHost(cookie, hostname) {
  const domain = String(cookie?.domain || '').replace(/^\./, '').toLowerCase();
  if (!domain) return true;
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function toPlaywrightCookie(cookie, url) {
  if (!cookie?.name || cookie.value == null) return null;
  const out = {
    name: String(cookie.name),
    value: String(cookie.value),
    path: cookie.path || '/',
  };
  if (cookie.domain) out.domain = cookie.domain;
  else out.url = new URL(url).origin;
  const expires = Number(cookie.expires ?? cookie.expirationDate ?? cookie.expiresAt);
  if (Number.isFinite(expires) && expires > 0) out.expires = expires;
  if (cookie.httpOnly != null) out.httpOnly = !!cookie.httpOnly;
  if (cookie.secure != null) out.secure = !!cookie.secure;
  if (['Strict', 'Lax', 'None'].includes(cookie.sameSite)) out.sameSite = cookie.sameSite;
  return out;
}

async function importPinchtabCookies(context, tabId, currentUrl) {
  try {
    const hostname = new URL(currentUrl).hostname.toLowerCase();
    const cookies = normalizePinchtabCookieList(await pinchtabCookies(tabId))
      .filter(c => cookieMatchesHost(c, hostname))
      .map(c => toPlaywrightCookie(c, currentUrl))
      .filter(Boolean);
    if (!cookies.length) return 0;
    await context.addCookies(cookies);
    return cookies.length;
  } catch (err) {
    dbg(`pinchtab cookie import failed: ${String(err.message || err).slice(0, 100)}`);
    return 0;
  }
}

/** Per-run cap so a bad password cannot loop /login across reachApplicationForm hops. */
let himalayasLoginAttempts = 0;

async function frameHasHimalayasLoginFields(frame) {
  try {
    return await frame.evaluate(() => {
      const visible = (el) => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.width > 10 && r.height > 10 && getComputedStyle(el).visibility !== 'hidden';
      };
      const email = [...document.querySelectorAll('input[type="email"], input[placeholder*="Email" i]')]
        .some(visible);
      const pass = [...document.querySelectorAll('input[type="password"]')].some(visible);
      return email && pass;
    });
  } catch {
    return false;
  }
}

/** True when the Himalayas chrome looks logged-in (no header Log in CTA). */
async function isHimalayasLoggedIn(page) {
  if (!isHimalayasHost(page.url())) return false;
  if (isHimalayasLoginPath(page.url())) return false;
  try {
    const hasNavLoginCta = await page.evaluate(() =>
      [...document.querySelectorAll('a, button')].some((el) => {
        const t = String(el.innerText || el.getAttribute('aria-label') || '').trim();
        return /^(log[\s-]?in|sign[\s-]?in|login)$/i.test(t);
      })
    );
    return inferHimalayasLoggedIn({ currentUrl: page.url(), hasNavLoginCta });
  } catch {
    return false;
  }
}

/**
 * PinchTab-only challenge solver (captcha / cloudflare). Separated from
 * Himalayas login so ensureHimalayasSession can clear a wall BEFORE filling
 * credentials without recursing into itself.
 */
async function solvePinchtabChallenge(context, page, blocker, phase = 'navigation') {
  if (!AUTO_SOLVE_CHALLENGES || !['captcha', 'cloudflare'].includes(blocker)) return false;
  const currentUrl = page.url();
  if (!(await pinchtabHealth())) {
    log(`Solveur PinchTab indisponible à ${PINCHTAB_URL} — intervention humaine requise pour ${blockerLabel(blocker)}.`);
    return false;
  }

  for (let attempt = 1; attempt <= SOLVE_MAX_RUN_ATTEMPTS; attempt += 1) {
    let tabId = null;
    try {
      setState('solving_challenge', `Résolution automatique ${blockerLabel(blocker)} (${attempt}/${SOLVE_MAX_RUN_ATTEMPTS})…`);
      log(`Challenge détecté (${blockerLabel(blocker)}, ${phase}) — tentative PinchTab ${attempt}/${SOLVE_MAX_RUN_ATTEMPTS}.`);
      tabId = await pinchtabNavigate(currentUrl, { timeout: 30000 });
      await sleep(1500);
      const result = await pinchtabSolve(tabId, { maxAttempts: 6, timeout: SOLVE_TIMEOUT_MS });
      if (!pinchtabSolveSucceeded(result)) {
        log(`PinchTab n'a pas résolu la vérification (solver=${result?.solver || 'auto'}, attempts=${result?.attempts ?? 0}).`);
        continue;
      }
      const copied = await importPinchtabCookies(context, tabId, currentUrl);
      log(`Vérification résolue via PinchTab${copied ? ` · ${copied} cookie(s) de challenge transféré(s)` : ''}.`);
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      await sleep(2500);
      const stillBlocked = await detectBlocker(page);
      // Only a truly clear page counts as solved. clearChallengeWalls already
      // re-detects the blocker before every call into this function and
      // treats "not captcha/cloudflare anymore" as its own job being done
      // (login/auth_wall are left alone by design) — reporting success here
      // too meant a captcha giving way to a login wall was logged as solved.
      if (!stillBlocked) return true;
      blocker = stillBlocked;
      log(`Vérification encore visible après reprise (${blockerLabel(stillBlocked)}).`);
    } catch (err) {
      log(`Tentative PinchTab échouée (${String(err.message || err).slice(0, 120)}).`);
    } finally {
      await pinchtabClose(tabId);
    }
  }
  return false;
}

/** Clear captcha/cloudflare up to 3 times; leave login/auth_wall alone. */
async function clearChallengeWalls(context, page, phase) {
  for (let i = 0; i < 3; i += 1) {
    const blocker = await detectBlocker(page);
    if (blocker !== 'captcha' && blocker !== 'cloudflare') return true;
    if (!(await solvePinchtabChallenge(context, page, blocker, `${phase}:${i + 1}`))) return false;
  }
  const leftover = await detectBlocker(page);
  return leftover !== 'captcha' && leftover !== 'cloudflare';
}

async function fillHimalayasLoginForm(page, email, password) {
  const emailBox = page.getByRole('textbox', { name: /^email$/i })
    .or(page.getByPlaceholder(/email/i));
  const passBox = page.getByRole('textbox', { name: /^password$/i })
    .or(page.locator('input[type="password"]').first());
  const loginBtn = page.getByRole('button', { name: /^log[\s-]?in$/i });

  try {
    await emailBox.first().waitFor({ state: 'visible', timeout: 8000 });
    await emailBox.first().fill('');
    await emailBox.first().fill(email);
    await passBox.first().fill('');
    await passBox.first().fill(password);
    await Promise.all([
      page.waitForLoadState('domcontentloaded').catch(() => {}),
      loginBtn.first().click({ timeout: 5000 }),
    ]);
    return true;
  } catch (err) {
    let filled = false;
    for (const frame of page.frames()) {
      if (frame.isDetached()) continue;
      try {
        filled = await frame.evaluate(({ email, password }) => {
          const visible = (el) => {
            if (!el) return false;
            const r = el.getBoundingClientRect();
            return r.width > 10 && r.height > 10 && getComputedStyle(el).visibility !== 'hidden';
          };
          const setVal = (el, v) => {
            el.focus();
            const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
            if (proto?.set) proto.set.call(el, v);
            else el.value = v;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          };
          const emailInput = [...document.querySelectorAll('input[type="email"], input[placeholder*="Email" i]')]
            .find(visible);
          const passInput = [...document.querySelectorAll('input[type="password"]')].find(visible);
          if (!emailInput || !passInput) return false;
          setVal(emailInput, email);
          setVal(passInput, password);
          const re = /^(sign[\s-]?in|log[\s-]?in|login|connexion|se connecter)$/i;
          const btn = [...document.querySelectorAll('button, input[type="submit"]')]
            .find(b => visible(b) && re.test(String(b.innerText || b.value || '').trim()));
          if (btn) btn.click();
          return true;
        }, { email, password });
        if (filled) return true;
      } catch { /* next frame */ }
    }
    log(`Remplissage login Himalayas échoué (${String(err.message || err).slice(0, 100)}).`);
    return false;
  }
}

/**
 * Dedicated Himalayas apply preamble:
 *   detect → /login → clear captcha → fill credentials → clear captcha again
 *   → return to the job URL so Apply can open the company ATS / screening form.
 */
async function ensureHimalayasSession(context, page) {
  // Critical: once Apply leaves himalayas.app for Greenhouse/Ashby/…, do nothing.
  if (!shouldEnsureHimalayasSession({ jobUrl: spec.jobUrl, currentUrl: page.url() })) {
    return true;
  }

  const email = String(process.env.HIMALAYAS_EMAIL || '').trim();
  const password = String(process.env.HIMALAYAS_PASSWORD || '');
  if (!email || !password) {
    log('Identifiants Himalayas absents (.env: HIMALAYAS_EMAIL / HIMALAYAS_PASSWORD) — connexion manuelle.');
    return false;
  }

  const returnTo = spec.jobUrl || page.url();

  if (await isHimalayasLoggedIn(page)) {
    log('Session Himalayas déjà active.');
    if (returnTo && !samePageUrl(page.url(), returnTo)) {
      await page.goto(returnTo, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      await sleep(2000);
    }
    return true;
  }

  if (!canAttemptHimalayasLogin(himalayasLoginAttempts)) {
    log(`Auto-login Himalayas plafonné (${himalayasLoginAttempts} tentative(s)) — intervention humaine.`);
    return false;
  }

  setState('logging_in', 'Himalayas détecté — connexion…');
  log('Offre Himalayas détectée — ouverture du formulaire de login.');
  himalayasLoginAttempts += 1;

  if (!isHimalayasLoginPath(page.url()) || !(await frameHasHimalayasLoginFields(page.mainFrame()))) {
    await page.goto('https://himalayas.app/login', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await sleep(1500);
  }

  if (!(await clearChallengeWalls(context, page, 'himalayas-login-pre'))) {
    log('Captcha Himalayas non résolu avant login — intervention humaine requise.');
    return false;
  }

  if (!(await frameHasHimalayasLoginFields(page.mainFrame()))) {
    await page.goto('https://himalayas.app/login', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await sleep(1500);
  }

  setState('logging_in', 'Saisie des identifiants Himalayas…');
  if (!(await fillHimalayasLoginForm(page, email, password))) return false;

  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    await sleep(900);
    const blocker = await detectBlocker(page);
    if (blocker === 'captcha' || blocker === 'cloudflare') {
      if (!(await solvePinchtabChallenge(context, page, blocker, 'himalayas-login-post'))) {
        log('Captcha Himalayas non résolu après login — intervention humaine requise.');
        return false;
      }
      continue;
    }

    const bodyText = await page.evaluate(() => (document.body?.innerText || '').slice(0, 2500)).catch(() => '');
    if (isHimalayasLoginPath(page.url()) && looksLikeHimalayasLoginError(bodyText)) {
      log('Login Himalayas refusé (identifiants invalides) — corrige .env ou connecte-toi à la main.');
      return false;
    }

    if (/\/(onboarding|welcome|verify)/i.test(new URL(page.url()).pathname)) {
      log('Onboarding Himalayas détecté après login — poursuite vers l\'offre.');
      break;
    }

    if (await isHimalayasLoggedIn(page)) break;
    if (!isHimalayasLoginPath(page.url()) && blocker !== 'login') break;
  }

  if (isHimalayasLoginPath(page.url()) && !(await isHimalayasLoggedIn(page))) {
    const bodyText = await page.evaluate(() => (document.body?.innerText || '').slice(0, 2500)).catch(() => '');
    if (looksLikeHimalayasLoginError(bodyText)) {
      log('Login Himalayas refusé (identifiants invalides) — corrige .env ou connecte-toi à la main.');
    } else {
      log('Auto-login Himalayas échoué (toujours sur /login) — connecte-toi dans Chrome, puis Re-scanner.');
    }
    return false;
  }

  log('Session Himalayas OK — retour à l\'offre pour Apply.');
  setState('finding_form', 'Retour à l\'offre Himalayas…');
  await page.goto(returnTo, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await sleep(2500);

  if (!(await clearChallengeWalls(context, page, 'himalayas-job'))) {
    log('Captcha sur la page offre Himalayas — intervention humaine requise.');
    return false;
  }
  return true;
}

// Site-specific login/session preambles: some boards require establishing a
// session (or clearing a login wall) before Apply can proceed at all, in ways
// the generic navigation/blocker flow below can't do on its own. Each entry
// is self-contained (own credentials, retry cap, login-form handling) — a
// second such board is a new row here, not a new branch in
// tryAutoSolveBlocker / reachApplicationForm / main.
const SITE_SESSION_HANDLERS = [
  {
    appliesTo: (currentUrl) => shouldEnsureHimalayasSession({ jobUrl: spec.jobUrl, currentUrl }),
    ensureSession: ensureHimalayasSession,
  },
];

function findSiteSessionHandler(currentUrl) {
  return SITE_SESSION_HANDLERS.find(h => h.appliesTo(currentUrl)) || null;
}

async function tryAutoSolveBlocker(context, page, blocker, phase = 'navigation') {
  if (blocker === 'login' || blocker === 'auth_wall') {
    const handler = findSiteSessionHandler(page.url());
    if (handler) return handler.ensureSession(context, page);
  }
  return solvePinchtabChallenge(context, page, blocker, phase);
}

// ── Apply navigation: follow links/redirects until a real form is reached ─────

// APPLY_TEXT_RE / PROGRESS_TEXT_RE → lib/apply-progression.mjs (shared with bridge)

// Interstitial modals between the job page and the real form (e.g. Jobicy's
// "Sign Up and Apply / Continue as Guest") — always pick the no-account path.
// GUEST_TEXT_RE lives in lib/form-detect.mjs alongside AUTH_AVOID_TEXT_RE, so
// the "take this path" and "never take that path" vocabularies stay in sync.
const CONTINUE_TEXT_RE = GUEST_TEXT_RE;

// normalizeAtsUrl lives in extension/apply-ats.mjs (query string stays on the URL).

// A frame "has a form" when it shows fillable application fields.
// Scored verdict from lib/form-detect.mjs. The old inline predicate
// ((hasIdentity && inputs>=2) || (files>0 && inputs>=1)) returned TRUE for a
// signup wall and for a newsletter footer — verified in a real Chromium — so
// the runner believed it had arrived and began filling a signup form with the
// candidate's CV data. See tests/form-detect.test.mjs.
async function probeFrameForm(frame) {
  try {
    return await frame.evaluate(APPLICATION_FORM_PROBE);
  } catch {
    return { verdict: 'none', score: 0, signals: [], blockers: [] };
  }
}

async function frameHasApplicationForm(frame) {
  return (await probeFrameForm(frame)).verdict === 'application_form';
}

/**
 * Scan every frame once. Returns the form frame when one exists, otherwise
 * reports whether what we DID find is an auth wall — so the caller can offer
 * the guest path or hand over to the human instead of typing into a signup box.
 */
async function findFormFrame(page) {
  if (pageIsGone(page)) return { frame: null, authWall: null };
  let authWall = null;
  try {
    for (const frame of page.frames()) {
      if (frame.isDetached()) continue;
      const r = await probeFrameForm(frame);
      if (r.verdict === 'application_form') {
        dbg(`formulaire détecté (score ${r.score}: ${r.signals.join(', ')})`);
        return { frame, authWall: null };
      }
      if (r.verdict === 'auth_wall' && !authWall) authWall = r;
    }
  } catch (err) {
    if (isTargetClosedError(err)) return { frame: null, authWall: null };
    throw err;
  }
  return { frame: null, authWall };
}

async function clickApplyAndFollow(context, page, textRe = APPLY_TEXT_RE, attempted = null) {
  // Playwright's hasText regex is NOT whitespace-normalized (a trailing space
  // in textContent breaks ^…$ anchors), so candidates are found in-page on
  // normalized innerText, tagged, then clicked through Playwright for trusted
  // events + popup handling. `attempted` (Set of "url::text") prevents
  // re-clicking the same button across hops (avoids no-op loops). Returns the
  // page that should contain the form.
  if (pageIsGone(page)) return null;
  let url;
  try { url = page.url(); } catch (err) {
    if (isTargetClosedError(err)) return null;
    throw err;
  }
  const skip = attempted ? [...attempted].filter(k => k.startsWith(url + '::')).map(k => k.slice((url + '::').length)) : [];
  // Let sticky headers, lazy CTAs and client-side route data settle before
  // concluding that the page has no progression control. Many ATS pages only
  // reveal the real Apply button after a human-like scroll.
  await page.mouse.wheel(0, 650).catch(() => {});
  await sleep(900);
  let marked;
  try {
    marked = await page.evaluate(MARK_PROGRESSION_CONTROLS, {
      reSrc: textRe.source,
      skip,
      avoidSrc: AUTH_AVOID_TEXT_RE.source,
    });
  } catch (err) {
    if (isTargetClosedError(err)) return null;
    throw err;
  }
  if (!marked.length) {
    await page.mouse.wheel(0, -500).catch(() => {});
    await sleep(700);
    let retry;
    try {
      retry = await page.evaluate(MARK_PROGRESSION_CONTROLS, {
        reSrc: textRe.source,
        skip,
        avoidSrc: AUTH_AVOID_TEXT_RE.source,
      });
    } catch (err) {
      if (isTargetClosedError(err)) return null;
      throw err;
    }
    if (!retry.length) return null;
    marked.push(...retry);
  }

  const transition = watchApplicationTransition(page, { findForm: findFormFrame });
  let clicked = false;
  for (const cand of marked) {
    try {
      if (attempted) attempted.add(`${url}::${cand.text}`);
      await humanClick(page.locator(`[data-co-click="${cand.n}"]`), { timeout: 5000 });
      log(`Clic sur "${cand.text}"${cand.href ? ` → ${cand.href}` : ''}`);
      clicked = true;
      break;
    } catch (err) {
      log(`Clic raté sur "${cand.text}" (${String(err.message || err).slice(0, 60)}) — élément suivant`);
    }
  }
  // Check clicked BEFORE awaiting the transition watch: nothing navigated, so
  // there is nothing to wait for — awaiting first blocked this function for
  // the full watch timeout on every failed hop. `transition` is left
  // unawaited here; it always resolves (never throws) and just finishes its
  // poll loop in the background.
  if (!clicked) return null;
  const observed = await transition;
  if (!observed.frame) log('Formulaire encore absent après le clic — poursuite de l’exploration.');
  return observed.page;
}

async function dismissCookieBanner(page) {
  try {
    const btn = page.locator('button, a').filter({
      hasText: /^(accept( all)?( cookies)?|i (agree|accept)|tout accepter|accepter( tout)?|allow all|got it|ok|j'accepte)$/i,
    }).first();
    if (await btn.isVisible({ timeout: 800 })) {
      await humanClick(btn, { timeout: 2000 });
      await sleep(600);
    }
  } catch { /* no banner */ }
}

const navAiBudget = { nav: 0, review: 0 };

async function askPageNavAi(page, {
  phase = 'navigate',
  skipTexts = [],
  fields = [],
  heading = '',
  bodySnippet = '',
} = {}) {
  const bucket = phase === 'review' ? 'review' : 'nav';
  const max = phase === 'review' ? 3 : 2;
  if (navAiBudget[bucket] >= max) return { action: 'human', reason: 'plafond', skipped: true };
  let listed = [];
  try {
    listed = await page.evaluate(LIST_VISIBLE_NAV_BUTTONS, {
      avoidSrc: AUTH_AVOID_TEXT_RE.source,
      skip: skipTexts,
    });
  } catch { listed = []; }
  const buttons = filterNavButtons(listed || [], skipTexts);
  if (phase !== 'review' && !buttons.length) return { action: 'human', reason: 'aucun bouton', skipped: true };
  navAiBudget[bucket] += 1;
  const decision = await resolveNavAction({
    phase,
    url: currentPageUrl(page),
    heading,
    bodySnippet,
    buttons,
    fieldsSummary: `${(fields || []).length} champs, ${countEditableApplyFields(fields || [])} éditables`,
  });
  const line = navDecisionLog(decision);
  if (line) log(line);
  return decision;
}

async function clickListedNav(page, decision) {
  if (!decision?.text) return false;
  const stamp = await page.evaluate((text) => {
    const want = String(text).replace(/\s+/g, ' ').trim().toLowerCase();
    const hit = [...document.querySelectorAll('[data-co-nav]')].find((el) => {
      const t = (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || '')
        .replace(/\s+/g, ' ').trim().toLowerCase();
      return t === want;
    });
    return hit ? hit.getAttribute('data-co-nav') : null;
  }, decision.text).catch(() => null);
  if (stamp == null) return false;
  try {
    await humanClick(page.locator(`[data-co-nav="${stamp}"]`), { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function clickExactLabelOnPage(page, text) {
  if (!text) return false;
  const loc = page.locator('a, button, [role="button"], input[type="submit"], input[type="button"]')
    .filter({ hasText: exactControlPattern(text) })
    .first();
  try {
    await humanClick(loc, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function reachApplicationForm(context, page) {
  // Walk through any number of intermediate pages (aggregator redirect → job
  // page → "apply" → guest modal → wizard "next/start" → form). Each hop:
  // detect blocker, look for the real form, else normalize the ATS URL, else
  // click the highest-priority progression control we haven't tried yet.
  const attempted = new Set();
  const inspectedUrls = new Set();

  // A board with a session handler: establish it BEFORE trying Apply (login →
  // captcha → job). Only while still on that board's own domain — never after
  // redirect to the employer's ATS (see SITE_SESSION_HANDLERS' appliesTo).
  if (pageIsGone(page)) return { page, frame: null, blocker: null };
  const preambleHandler = findSiteSessionHandler(currentPageUrl(page));
  if (preambleHandler) {
    if (!(await preambleHandler.ensureSession(context, page))) {
      return { page, frame: null, blocker: 'login' };
    }
  }

  for (let hop = 0; hop < 15; hop++) {
    if (pageIsGone(page)) return { page, frame: null, blocker: null };
    try {
      state.currentUrl = page.url();
    } catch (err) {
      if (isTargetClosedError(err)) return { page, frame: null, blocker: null };
      throw err;
    }
    await writeState();

    const blocker = await detectBlocker(page);
    if (blocker) {
      if (await tryAutoSolveBlocker(context, page, blocker, `hop ${hop + 1}`)) continue;
      return { page, frame: null, blocker };
    }

    await dismissCookieBanner(page);

    // SPAs (Ashby, Greenhouse new UI…) render the form well after
    // domcontentloaded — poll instead of checking once.
    let frame = null;
    let authWall = null;
    for (let w = 0; w < 10 && !frame; w++) {
      ({ frame, authWall } = await findFormFrame(page));
      if (!frame) await sleep(1800);
    }
    if (frame) return { page, frame, blocker: null };

    // An auth wall is NOT the form. A board with a session handler (no guest
    // apply there) forces the login preamble; elsewhere try the no-account
    // path first.
    if (authWall) {
      const wallHandler = findSiteSessionHandler(page.url());
      if (wallHandler) {
        log(`Mur d'authentification (${authWall.blockers.join(', ')}) — connexion obligatoire.`);
        if (await wallHandler.ensureSession(context, page)) continue;
        return { page, frame: null, blocker: 'login' };
      }
      log(`Mur d'inscription/connexion détecté (${authWall.blockers.join(', ')}) — recherche d'un accès invité.`);
      const guest = await clickApplyAndFollow(context, page, GUEST_TEXT_RE, attempted);
      if (guest) { page = guest; continue; }
      const guestUrl = currentPageUrl(page);
      const guestAi = await askPageNavAi(page, {
        phase: 'navigate',
        skipTexts: [...attempted].filter((k) => k.startsWith(`${guestUrl}::`)).map((k) => k.slice(guestUrl.length + 2)),
      });
      if (guestAi?.action === 'click' && await clickListedNav(page, guestAi)) {
        attempted.add(`${guestUrl}::${guestAi.text}`);
        const observed = await watchApplicationTransition(page, { findForm: findFormFrame });
        page = observed.page;
        if (observed.frame) return { ...observed, blocker: null };
        continue;
      }
      log('Aucun accès invité proposé — connexion manuelle requise.');
      return { page, frame: null, blocker: 'auth_wall' };
    }

    // Known ATS URL that just needs normalization (lever → /apply, ashby → /application)
    const normalized = normalizeAtsUrl(page.url());
    if (normalized !== page.url()) {
      log(`URL ATS normalisée → ${normalized}`);
      await page.goto(normalized, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      await sleep(3500);
      continue;
    }

    // No form yet → advance one step. Priority: guest/no-account modal, then an
    // apply button, then a generic wizard "next/start/continue" (only safe here
    // because the page has no form). `attempted` blocks re-clicking a no-op.
    const next = await clickApplyAndFollow(context, page, CONTINUE_TEXT_RE, attempted)
      || await clickApplyAndFollow(context, page, APPLY_TEXT_RE, attempted)
      || await clickApplyAndFollow(context, page, PROGRESS_TEXT_RE, attempted);
    if (!next) {
      let hopUrl = '';
      try { hopUrl = page.url(); } catch { hopUrl = ''; }
      const skipTexts = [...attempted].filter((k) => k.startsWith(`${hopUrl}::`)).map((k) => k.slice(hopUrl.length + 2));
      const navAi = await askPageNavAi(page, { phase: 'navigate', skipTexts });
      if (navAi?.action === 'fill') {
        const again = await findFormFrame(page);
        if (again.frame) return { page, frame: again.frame, blocker: null };
      }
      if (navAi?.action === 'click' && await clickListedNav(page, navAi)) {
        attempted.add(`${hopUrl}::${navAi.text}`);
        const observed = await watchApplicationTransition(page, { findForm: findFormFrame });
        if (observed.frame) return { ...observed, blocker: null };
        page = observed.page;
        continue;
      }
      const currentUrl = page.url();
      if (!inspectedUrls.has(currentUrl)) {
        inspectedUrls.add(currentUrl);
        log('Navigation directe bloquée — inspection interactive PinchTab.');
        try {
          const discovered = await exploreApplicationInterface(currentUrl, { log });
          if (discovered && /^https?:\/\//i.test(discovered)) {
            await page.goto(discovered, { waitUntil: 'domcontentloaded', timeout: 45000 });
            const observed = await watchApplicationTransition(page, { findForm: findFormFrame });
            if (observed.frame) return { ...observed, blocker: null };
            page = observed.page;
            log('Parcours PinchTab trouvé, mais formulaire non confirmé dans la session de candidature.');
          }
        } catch (err) {
          log(`Inspection PinchTab interrompue : ${String(err.message || err).slice(0, 160)}`);
        }
      }
      log('Aucun bouton de progression cliquable — formulaire non atteint.');
      return { page, frame: null, blocker: null };
    }
    page = next;
  }
  log('Limite de pages intermédiaires atteinte (15) sans trouver le formulaire.');
  return { page, frame: null, blocker: null };
}

// Rescan (user clicked "Re-scanner"): the user is already ON the form, possibly
// after fixing fields by hand. Re-detect the form on the current page and any
// open tab WITHOUT clicking apply/next buttons (which would navigate away from
// the form they just fixed). Only if nothing is found do we fall back to full
// navigation.
async function rescanForm(context, page) {
  for (let w = 0; w < 4; w++) {
    for (const p of context.pages()) {
      if (p.isClosed?.()) continue;
      const { frame: fr } = await findFormFrame(p);
      if (fr) return { page: p, frame: fr, blocker: null };
    }
    await sleep(1000);
  }
  log('Aucun formulaire sur les onglets ouverts — navigation complète.');
  return reachApplicationForm(context, page);
}

// ── Field collection & classification ─────────────────────────────────────────

async function collectFields(frame) {
  return await frame.evaluate(COLLECT_FIELDS);
}

// classifyField / bestAnswerFor → lib/apply-classify.mjs

// ── Fill engine ───────────────────────────────────────────────────────────────

// Every ATS demographic dropdown (gender, race/ethnicity, veteran, disability,
// LGBTQIA+…) offers some non-disclosure option, but the exact wording is never
// standardized ("Prefer not to say", "I don't wish to answer", "Decline to
// self-identify", "Rather not disclose"…). An LLM asked to pick one tends to
// paraphrase a generic-sounding version of that option instead of copying the
// real string verbatim, which then fails exact/substring matching against the
// actual DOM text (found in live testing on Agoda/Greenhouse: LLM said "Prefer
// not to disclose", the real option read "I don't wish to answer" — zero
// substring overlap, so the field was reported unfillable). Matching against
// this pattern directly, deterministically, skips the paraphrase risk entirely.
// pickSelectOption / pickDeclineOption → lib/apply-select.mjs

// Open a custom dropdown and scrape its rendered options (react-select, Ashby…)
// so the LLM resolver can pick a valid one. Best-effort; restores closed state.
//
// Polls for the menu instead of sleeping a fixed 700ms, and re-opens once if
// nothing rendered. A single blind sleep made this return [] whenever the
// widget was a beat slow — and an empty option list silently degrades the
// field to "LLM guesses blind", which is exactly how a plain Yes/No dropdown
// ended up unanswerable in live testing despite having an obvious "Yes".
async function listNearbyOptions(frame, i, allowGlobal) {
  const listed = await frame.evaluate(COMBOBOX_OPTION_QUERY, { mode: 'list', i, allowGlobal: !!allowGlobal, sel: COMBOBOX_OPTION_SEL })
    .catch(() => ({ count: 0, texts: [] }));
  return (listed.texts || []).map(t => ({ value: t, text: t }));
}

async function scrapeComboboxOptions(frame, f) {
  const loc = frame.locator(`[data-co-i="${f.i}"]`);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await loc.click({ timeout: 2500 });
      // poll up to ~0.6s for the menu to render (was ~2.4s)
      let opts = [];
      for (let i = 0; i < 5; i++) {
        await sleep(120);
        opts = await listNearbyOptions(frame, f.i, isComboboxField(f));
        if (opts.length) break;
      }
      await loc.press('Escape').catch(() => {});
      dbg(`scrape "${String(f.label).slice(0, 40)}" attempt=${attempt} → ${opts.length} option(s) ${JSON.stringify(opts.slice(0, 6).map(o => o.text))}`);
      if (opts.length) return opts;
      await sleep(rand(200, 400)); // let the widget settle before re-opening
    } catch (err) { dbg(`scrape "${String(f.label).slice(0, 40)}" threw: ${String(err.message || err).slice(0, 60)}`); return []; }
  }
  return [];
}

// Open the list, click a real option. Typing is only a short filter once the
// menu is already open — never the answer written into a closed field.
// Known comboboxes retry once if the first open found nothing.
async function selectComboboxOption(frame, f, query) {
  const first = await selectComboboxOptionOnce(frame, f, query);
  if (first.matched || first.hadOptions) return first;
  if (!isComboboxField(f)) return first;
  await sleep(rand(250, 500));
  const second = await selectComboboxOptionOnce(frame, f, query);
  return { matched: second.matched, hadOptions: second.hadOptions || first.hadOptions };
}

async function nearbyOptionSnapshot(frame, i) {
  return await frame.evaluate(COMBOBOX_OPTION_QUERY, { mode: 'snapshot', i, allowGlobal: false, sel: COMBOBOX_OPTION_SEL })
    .catch(() => ({ count: 0, sig: '' }));
}

async function pollUntil(fn, times, lo, hi) {
  for (let n = 0; n < times; n++) {
    await sleep(rand(lo, hi));
    if (await fn()) return true;
  }
  return false;
}

async function clickStampedComboboxOption(frame, f, loc, want, allowGlobal, filterTyped = '') {
  const result = await frame.evaluate(COMBOBOX_OPTION_QUERY, { mode: 'match', want, i: f.i, allowGlobal, sel: COMBOBOX_OPTION_SEL });
  if (!result.matched) return { ...result, clicked: false };
  const extra = { query: want, clickedText: result.matched, filterTyped };
  try {
    // In-page mousedown. humanClick moves the pointer off the menu first,
    // which closes it, so the option is gone before the click arrives.
    await frame.evaluate(ACTIVATE_MATCHED_OPTION);
    let ok = await comboboxSelectionRegistered(frame, f, extra);
    if (!ok) {
      await frame.locator('[data-co-match="1"]').click({ force: true, timeout: 1500 }).catch(() => {});
      ok = await comboboxSelectionRegistered(frame, f, extra);
    }
    dbg(`  → clicked "${result.matched}", registered=${!!ok}`);
    if (ok) return { ...result, clicked: true, matched: ok };
  } catch (err) {
    dbg(`  → click failed: ${String(err.message || err).slice(0, 60)}`);
  }
  return { ...result, clicked: false };
}

async function selectComboboxOptionOnce(frame, f, query, contains = '') {
  const loc = frame.locator(`[data-co-i="${f.i}"]`);
  const q = String(query).slice(0, 60);
  const known = isComboboxField(f);
  const binary = !!choiceKind(q);
  let filterTyped = '';
  try {
    await loc.scrollIntoViewIfNeeded({ timeout: 1200 }).catch(() => {});
    await sleep(rand(120, 320));
    const before = await nearbyOptionSnapshot(frame, f.i);
    await humanClick(loc, { timeout: 4000 }).catch(() => {});

    const menuOpened = async () => {
      const snap = await nearbyOptionSnapshot(frame, f.i);
      return snap.count > 0 && snap.sig !== before.sig;
    };
    let hadOptionsOnOpen = await pollUntil(menuOpened, 4, 70, 130);
    if (!hadOptionsOnOpen) {
      await loc.press('ArrowDown').catch(() => {});
      hadOptionsOnOpen = await pollUntil(menuOpened, 3, 70, 130);
    }
    if (!hadOptionsOnOpen && known) {
      await loc.press('Alt+ArrowDown').catch(() => {});
      hadOptionsOnOpen = await pollUntil(menuOpened, 3, 70, 130);
    }

    // City / country widgets hide the menu until a few letters are typed.
    // The prefix is cleared again if no option is clicked.
    if (!hadOptionsOnOpen && looksLikeTypeahead(f) && q.length >= 2 && !binary) {
      filterTyped = q.slice(0, Math.min(3, q.length));
      await loc.fill('').catch(() => {});
      await loc.pressSequentially(filterTyped, { delay: rand(55, 130) }).catch(() => {});
      hadOptionsOnOpen = await pollUntil(menuOpened, 4, 70, 130);
    }

    const abandon = async () => {
      await loc.press('Escape').catch(() => {});
      await clearField(loc);
      return { matched: null, hadOptions: hadOptionsOnOpen };
    };

    if (!hadOptionsOnOpen) {
      dbg(`combobox "${String(f.label).slice(0, 40)}" no menu → not writing "${q}"`);
      return abandon();
    }

    const tryPickVisible = async () => {
      const listed = await listNearbyOptions(frame, f.i, known);
      const matchWant = contains || q;
      let picked = pickMatchingOption(listed, matchWant);
      if (!picked && contains) {
        const needle = String(contains).toLowerCase();
        const hit = listed.find((o) => String(o.text || o.value || '').toLowerCase().includes(needle));
        if (hit) picked = hit.text ? hit : { text: String(hit), value: String(hit) };
      }
      if (!picked) {
        // Visible rows the text scorer refused still get one DOM match+click.
        const stamped = await clickStampedComboboxOption(frame, f, loc, matchWant, known, filterTyped);
        return { listed, picked: null, clicked: stamped.clicked, matched: stamped.matched };
      }
      const stamped = await clickStampedComboboxOption(frame, f, loc, picked.text, known, filterTyped);
      return { listed, picked, clicked: stamped.clicked, matched: stamped.matched };
    };

    const first = await tryPickVisible();
    if (first.clicked) {
      dbg(`combobox "${String(f.label).slice(0, 40)}" q="${q}" open-match="${first.matched}"`);
      return { matched: first.matched, hadOptions: true };
    }

    // Filter the open menu with a short prefix. Never type the whole answer.
    if (!binary && !filterTyped && q.length >= 2) {
      filterTyped = q.slice(0, Math.min(3, q.length));
      await loc.fill('').catch(() => {});
      await loc.pressSequentially(filterTyped, { delay: rand(55, 130) }).catch(() => {});
      await pollUntil(menuOpened, 3, 70, 130);
      const filtered = await tryPickVisible();
      if (filtered.clicked) {
        dbg(`combobox "${String(f.label).slice(0, 40)}" q="${q}" typed-match="${filtered.matched}"`);
        return { matched: filtered.matched, hadOptions: true };
      }
    }

    const listed = await listNearbyOptions(frame, f.i, known);
    if (listed.length === 1) {
      const stamped = await clickStampedComboboxOption(frame, f, loc, listed[0].text, known, filterTyped);
      if (stamped.clicked) return { matched: stamped.matched, hadOptions: true };
    }
    dbg(`combobox "${String(f.label).slice(0, 40)}" q="${q}" menu open but no committed option`);
    return abandon();
  } catch {
    try { await frame.locator(`[data-co-i="${f.i}"]`).press('Escape'); } catch { /* already gone */ }
    return { matched: null, hadOptions: false };
  }
}

// True only when the widget committed an option. A click used to count as
// success whenever the control had no hidden react-select input — the typed
// filter then stayed in the field and looked filled.
async function comboboxSelectionRegistered(frame, f, extra = {}) {
  const probe = async () => {
    try {
      const state = await frame.evaluate(LIST_SELECTION_STATE, { i: f.i });
      return selectionLooksCommitted({ ...state, ...extra });
    } catch { return null; }
  };
  const first = await probe();
  if (first) return first;
  await sleep(400);
  return probe();
}

// Deterministic decline selection for a required demographic dropdown, tried
// BEFORE handing the field to the LLM. Two wins over the LLM route: (1) no
// paraphrase-mismatch risk — see DECLINE_RE's comment — because the option
// text clicked is read directly off the real DOM, never guessed; (2) no API
// round-trip for what is, across Greenhouse/Ashby/Lever, the single most
// common category of required-but-sensitive field on any application form.
async function fillDeclineDropdown(frame, f) {
  if (f.tag === 'select') {
    const opt = pickDeclineOption(f.options || []);
    if (!opt) return null;
    try {
      await frame.locator(`[data-co-i="${f.i}"]`).selectOption(opt.value, { timeout: 4000 });
      return opt.text;
    } catch { return null; }
  }
  if (!isComboboxField(f)) return null;
  const scraped = (f.options && f.options.length) ? f.options : await scrapeComboboxOptions(frame, f);
  const opt = pickDeclineOption(scraped);
  if (!opt) return null;
  // Query with the option's OWN text (not a guess) so selectComboboxOption's
  // exact-match branch always succeeds — the field is opened once more here,
  // but that's the only reliable way to actually click a real DOM option via
  // react-select's mouse-event-driven selection.
  const { matched } = await selectComboboxOption(frame, f, opt.text);
  return matched;
}

// Select one option of a radio group. Playwright's own check()/click() can't be
// used here: the native input is usually invisible (styled proxy on top), and
// forcing a click at its coordinates would hit whatever is painted over it.
// An in-page .click() toggles the real input and still fires the events React &
// co. listen to. Returns true only once the input reports itself checked, so a
// click a controlled component ignored is reported as a failure, not a success.
async function clickRadioOption(frame, f, want, isYesNo = false) {
  return await frame.evaluate(async ({ i, name, want, isYesNo, options }) => {
    const norm = (s) => (s || '').trim().toLowerCase();
    const wanted = norm(want);
    // Matching runs in three passes over the WHOLE group, strictest first.
    // A plain `includes` on the first option wins the race in a way that is
    // silently wrong: "female".includes("male") is true, so asking for Male
    // selected Female (caught on Kittl's live form). Pass 2 is word-boundary
    // anchored, which rejects that pair while still matching "No, I don't
    // require sponsorship" for "No".
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const passes = [
      (t) => t === wanted,
      (t) => new RegExp(`(^|\\W)${esc(wanted)}(\\W|$)`).test(t),
      (t) => t.includes(wanted) || wanted.includes(t),
    ];
    const yesNoMatch = (t) => (wanted === 'yes' && /^(yes|oui|true)\b/.test(t))
      || (wanted === 'no' && /^(no|non|false)\b/.test(t) && !/^non-?binary\b/.test(t) && !/^none\b/.test(t));
    const isPressed = (el) => el.getAttribute('aria-pressed') === 'true';
    const isChecked = (el) => !!(el.checked || el.getAttribute('aria-checked') === 'true');
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // React (and similar VDOM libs) can commit a state update asynchronously
    // even though el.click() dispatches synchronously, so a single read right
    // after the click can observe the stale pre-click value (root cause of
    // "option introuvable" on forms that actually did register the click).
    // Poll briefly instead of trusting the first read.
    const waitFor = async (check) => {
      for (let n = 0; n < 10; n++) {
        if (check()) return true;
        await sleep(30);
      }
      return check();
    };
    const activate = async (el) => {
      if (!el) return false;
      // Idempotent: if this option is already the active one, don't click it
      // again. A second click on an aria-pressed toggle button un-presses it
      // (it's not a true radio), which is how a field can end up recorded as
      // "filled" from an earlier successful click yet show unchecked later —
      // some later pass (a retry, a duplicate field resolution) re-clicked
      // the same already-correct option and flipped it back off.
      if (el.hasAttribute('aria-pressed')) {
        if (isPressed(el)) return true;
        el.click();
        return await waitFor(() => isPressed(el));
      }
      if (isChecked(el)) return true;
      el.click();
      if (await waitFor(() => isChecked(el))) return true;
      if (el.id) {
        document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.click();
        return await waitFor(() => isChecked(el));
      }
      return false;
    };
    // Prefer the markers stamped during collectFields — they survive nameless
    // radios and [role=radio] widgets that a name= selector would miss.
    const fromKeys = (options || []).map(o => {
      const el = o.key ? document.querySelector(`[data-co-opt="${o.key}"]`) : null;
      return el ? { el, text: norm(o.text || '') } : null;
    }).filter(Boolean);
    let live = fromKeys.length ? fromKeys : (name ? [...document.querySelectorAll(
      `input[type="radio"][name="${CSS.escape(name)}"]`,
    )].map((r) => {
      const lbl = r.id ? document.querySelector(`label[for="${CSS.escape(r.id)}"]`) : null;
      return { el: r, text: norm(lbl?.innerText || r.closest('label')?.innerText || r.value) };
    }) : []);
    if (isYesNo) {
      const hit = live.find(o => yesNoMatch(o.text));
      if (hit && (await activate(hit.el))) return true;
    } else {
      for (const pass of passes) {
        const hit = live.find(o => o.text && pass(o.text));
        if (hit && (await activate(hit.el))) return true;
      }
    }
    // Plugin parity: Ashby Yes/No is a hidden checkbox + button[data-option].
    // Collect stamps can vanish on re-render; walk ancestors for the buttons.
    const root = (i != null && document.querySelector(`[data-co-i="${i}"]`)) || null;
    let node = root;
    for (let d = 0; d < 7 && node; d++, node = node.parentElement) {
      const ashby = node.matches?.('.ashby-application-form-input-yesno, [class*="yesno" i], [class*="YesNo"]')
        ? node
        : node.querySelector?.('.ashby-application-form-input-yesno, [class*="yesno" i]');
      const scope = ashby || node;
      const btns = [...(scope.querySelectorAll?.('button[data-option], [data-option="yes"], [data-option="no"]') || [])];
      const yesNo = btns.filter((b) => /^(yes|no)$/i.test(b.getAttribute('data-option') || ''));
      if (yesNo.length < 2) continue;
      const wantYes = wanted === 'yes' || /^(yes|oui|y|true|1)$/i.test(wanted);
      const wantNo = wanted === 'no' || /^(no|non|n|false|0)$/i.test(wanted);
      const labelOf = (o) => (
        `${o.getAttribute?.('data-option') || ''} ${o.innerText || ''} ${o.getAttribute?.('aria-label') || ''}`
      ).replace(/\s+/g, ' ').trim().toLowerCase();
      let hit = yesNo.find((o) => {
        const t = labelOf(o);
        return t === wanted || (wanted.length >= 2 && t.includes(wanted));
      });
      if (!hit && wantYes) hit = yesNo.find((o) => o.getAttribute('data-option') === 'yes' || /^(yes|oui)\b/i.test(labelOf(o)));
      if (!hit && wantNo) hit = yesNo.find((o) => o.getAttribute('data-option') === 'no' || (/^(no|non)\b/i.test(labelOf(o)) && !/^non-?binary/i.test(labelOf(o))));
      if (hit && (await activate(hit))) return true;
    }
    return false;
  }, { i: f.i, name: f.name, want, isYesNo, options: f.options || [] });
}

// Tick a checkbox. Same visibility problem as radios, same escalation ladder:
// normal check → forced check → in-page click on the input, then its label.
async function checkBox(frame, f) {
  const sel = `[data-co-i="${f.i}"]`;
  const loc = frame.locator(sel);
  try {
    await loc.check({ timeout: 3000 });
  } catch {
    try { await loc.check({ timeout: 2000, force: true }); } catch { /* handled in page below */ }
  }
  return await frame.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return false;
    // Yes/No toggle widgets: the checkbox is a display:none value holder and
    // the real control is a pair of Yes/No buttons beside it. Clicking the
    // input flips `checked` — which reads as success — but the framework never
    // sees it, so the form still rejects the field as missing. Found on n8n's
    // Ashby form, where the submit bounced on "Missing entry for required
    // field" even though the runner reported the box ticked.
    const siblings = [...(el.parentElement?.children || [])].filter(c => c !== el);
    const affirmative = siblings.find(c => /^(yes|oui|true|agree|i agree)$/i.test((c.innerText || '').trim()));
    const isActive = (n) => !!n && (/(^|[\s_-])(active|selected|checked)/i.test((n.className || '').toString())
      || n.getAttribute('aria-checked') === 'true' || n.getAttribute('aria-pressed') === 'true');
    const ok = () => !!(el.checked || el.getAttribute('aria-checked') === 'true' || isActive(affirmative));
    if (ok()) return true;
    // The input is the value holder the framework binds to, even when it is
    // display:none behind a Yes/No button pair — clicking it flips the widget
    // for real, whereas clicking the visible button does nothing on its own
    // (verified on n8n's Ashby toggle). Input first, visible option last.
    el.click();
    if (ok()) return true;
    if (el.id) document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.click();
    if (ok()) return true;
    affirmative?.click();
    return ok();
  }, sel);
}

// Write a resolved answer into any field type. `answer` may be a string or, for
// multi-selects, an array of option texts. Returns the displayed value on
// success, or false if nothing was actually applied.
async function fillValueIntoField(frame, f, answer) {
  const loc = frame.locator(`[data-co-i="${f.i}"]`);
  if (f.type === 'date') {
    const iso = toIsoDate(Array.isArray(answer) ? answer[0] : answer);
    try { await loc.fill(iso, { timeout: 4000 }); return iso; } catch { return false; }
  }
  const multi = fieldIsMulti(f);
  let values = (Array.isArray(answer) ? answer.map(String) : [String(answer)]).filter(v => v && v.trim());
  if (!multi) values = values.slice(0, 1); // coerce stray array → single for non-multi fields
  if (!values.length) return false;

  if (f.tag === 'select') {
    if (multi) {
      const picked = values.map(v => pickSelectOption(f.options || [], { selectText: v, value: v }, f.label)).filter(Boolean);
      if (!picked.length) return false;
      await loc.selectOption(picked.map(o => o.value), { timeout: 4000 });
      return picked.map(o => o.text).join(', ');
    }
    const opt = pickSelectOption(f.options || [], { selectText: values[0], value: values[0] }, f.label);
    if (!opt) return false;
    await loc.selectOption(opt.value, { timeout: 4000 });
    return opt.text;
  }

  if (f.type === 'radio') {
    // Prefer the group's real option text over the raw answer string: an LLM
    // answer of "No" must land on the option labelled "No, I don't require
    // sponsorship", and the reported value should be what the form now shows.
    const opt = pickSelectOption(f.options || [], { selectText: values[0], value: values[0] }, f.label);
    const want = opt ? opt.text : values[0].trim();
    const ok = await clickRadioOption(frame, f, want);
    return ok ? want : false;
  }
  if (f.type === 'checkbox') {
    const answer = values[0].trim().toLowerCase();
    const affirmative = /^(yes|oui|true|checked?|coch|agree|accept|✓|☑|1)/.test(answer);
    // In a "tick all that apply" group each option is its own field, and the
    // resolver answers every one of them with the option it judges correct.
    // So this box is ticked only when that answer IS this box's own option —
    // otherwise all four location options would fight over one answer.
    const own = String(f.label || '').split('—').pop().trim().toLowerCase();
    // Word-order-independent fallback: an LLM paraphrase of the option text
    // ("Prefer to Not Disclose" for an option literally labelled "Prefer Not
    // to Disclose") fails both substring directions despite being the same
    // answer, leaving every sibling checkbox in the group unresolved.
    const normWords = (s) => s.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
    const matchesOwnOption = own.length > 6 && (own.includes(answer) || answer.includes(own) || normWords(own) === normWords(answer));
    if (!affirmative && !matchesOwnOption) return false;
    return (await checkBox(frame, f)) ? '☑' : false;
  }

  const knownCombobox = isComboboxField(f) && !skipComboboxProbe(f);
  if (knownCombobox) {
    // type → click the matching option, once per value. Only count picks that
    // actually landed on a real option (selectComboboxOption returns null else).
    const done = [];
    for (const v of values) {
      const { matched } = await selectComboboxOption(frame, f, v);
      if (matched) done.push(matched);
    }
    if (!done.length) return false;
    const shown = done.join(', ');
    return shown.length > 60 ? shown.slice(0, 60) + '…' : shown;
  }

  // Last-resort: click and see if a list opens. Must not type the answer unless
  // it did — otherwise every text field is filled twice.
  if (shouldSpeculativeProbe(f)) {
    const probe = await selectComboboxOption(frame, f, multi ? values.join(', ') : values[0]);
    if (probe.hadOptions) return probe.matched || false;
  }

  // text / textarea / contenteditable
  const text = polishApplicationAnswer(multi ? values.join(', ') : values[0]);
  // Never type an unsubstituted template ("[Company]", "{{role}}") into a real
  // form — that's an obvious, embarrassing error, not just an AI-sounding
  // sentence. Fail the fill so the field is flagged for a human instead.
  if (hasUnresolvedPlaceholder(text)) return false;
  const typed = await putText(loc, text, f);
  if (!typed) return false;
  return text.length > 70 ? text.slice(0, 70) + '…' : text;
}

async function fillFields(frame, spec) {
  const filled = [];
  const pending = [];
  const unresolved = []; // required fields the deterministic pass couldn't fill → LLM

  // Phase A — file uploads first: ATS like Ashby ("Autofill from resume")
  // re-render the whole form after parsing the CV, which invalidates the
  // data-co-i markers of every other field. Re-collect between each upload
  // for the same reason.
  const doneFiles = new Set();
  let uploaded = false;
  let sawResumeSlot = false;
  for (let pass = 0; pass < 4; pass++) {
    let fileFields = (await collectFields(frame)).filter(f => f.type === 'file');
    // Plugin parity: Ashby sometimes hides the resume input so hard that
    // collect misses it — probe raw file inputs and synthesize a slot.
    if (!fileFields.length && pass === 0 && spec.cvPath) {
      const probe = await frame.evaluate(() => {
        const deep = (root, sel) => {
          const out = [];
          const walk = (n) => {
            if (!n?.querySelectorAll) return;
            try { out.push(...n.querySelectorAll(sel)); } catch { /* */ }
            for (const el of n.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot);
          };
          walk(root);
          return out;
        };
        const files = deep(document, 'input[type="file"]');
        const score = (el) => {
          const blob = `${el.name || ''} ${el.id || ''} ${el.accept || ''} ${el.getAttribute('aria-label') || ''}`.toLowerCase();
          let s = 0;
          if (/resume|\bcv\b|curriculum|autofill|_systemfield_resume/.test(blob)) s += 50;
          if (/pdf|msword|officedocument/.test(el.accept || '')) s += 20;
          if (/cover|lettre|reference|diploma|other/.test(blob) && !/resume|\bcv\b/.test(blob)) s -= 80;
          return s;
        };
        files.sort((a, b) => score(b) - score(a));
        const el = files.find((f) => score(f) > 0) || files[0];
        if (!el) return null;
        el.setAttribute('data-co-i', '9901');
        el.setAttribute('data-co-upload', '1');
        return {
          i: 9901,
          type: 'file',
          tag: 'input',
          label: el.getAttribute('aria-label') || el.name || 'Resume/CV',
          name: el.name || '_systemfield_resume',
          required: true,
          fileCount: el.files?.length || 0,
        };
      }).catch(() => null);
      if (probe?.type === 'file') {
        fileFields = [probe];
        log(`CV slot forcé (input caché): ${probe.label || probe.name}`);
      }
    }
    const todo = fileFields.find(f => !doneFiles.has((f.label || f.name || 'file').slice(0, 80)));
    if (!todo) break;
    const labelShort = (todo.label || todo.name || 'file').slice(0, 80);
    doneFiles.add(labelShort);
    if (todo.required || isResumeFileField(todo)) sawResumeSlot = true;
    const plan = classifyField(todo, spec);
    if (!shouldFillField(todo) && !isResumeFileField(todo)) {
      if (todo.required) pending.push({ label: labelShort, reason: plan?.skip || 'fichier non géré' });
      continue;
    }
    if (!plan || plan.skip || !plan.upload) {
      if (todo.required || isResumeFileField(todo)) {
        pending.push({ label: labelShort, reason: plan?.skip || 'fichier non géré' });
      }
      continue;
    }
    const sel = `[data-co-i="${todo.i}"]`;
    const loc = frame.locator(sel);
    try {
      try {
        await loc.setInputFiles(plan.upload, { timeout: 8000 });
      } catch {
        await frame.evaluate((s) => {
          const el = document.querySelector(s);
          if (el) { el.style.display = 'block'; el.style.visibility = 'visible'; el.style.opacity = '1'; }
        }, sel);
        await loc.setInputFiles(plan.upload, { timeout: 8000 });
      }
      const upload = await confirmFrameUpload(frame, basenamePath(plan.upload));
      if (upload.ok) {
        filled.push({ label: labelShort, value: `📎 ${basenamePath(plan.upload)}` });
        uploaded = true;
        await waitForFormResettle(frame, UPLOAD_SETTLE_MS);
      } else {
        pending.push({ label: labelShort, reason: `upload échoué: ${upload.reason || 'aucun signal'}` });
      }
    } catch (err) {
      pending.push({ label: labelShort, reason: `upload échoué: ${String(err.message || err).slice(0, 60)}` });
    }
  }
  if (uploaded) {
    await waitForFormResettle(frame, UPLOAD_SETTLE_MS);
    const auto = await waitForResumeAutofill(frame, spec?.identity || {});
    if (auto.status === 'matched') log('Autofill ATS: nom ou email recopié.');
    else if (auto.status === 'mismatch') {
      const detail = (auto.mismatches || []).map((m) => m.kind).join(', ') || 'identité';
      log(`Autofill ATS incorrect (${detail}) — correction avec le profil.`);
    } else if (auto.status === 'partial') log('Autofill ATS partiel — les champs vides seront remplis.');
    else if (auto.manualFill) log('Autofill ATS absent après le délai — remplissage manuel des champs identité.');
  }

  // Phase B — re-collect (fresh markers after any re-render) and fill the rest
  const fields = await collectFields(frame);
  const usedAnswers = new Set();

  let actedCount = 0;
  for (const f of fields) {
    if (f.type === 'file') continue;
    // Required checkboxes (consent / factual claims) must not be skipped just
    // because shouldFillField returns false for optional marketing ticks —
    // same exception as the Chrome plugin bridge.
    if (!shouldFillField(f) && !(f.type === 'checkbox' && f.required)) continue;
    // Skip already-answered choice widgets (plugin parity).
    if (f.type === 'checkbox' && f.checked) continue;
    if (f.type === 'radio' && f.groupChecked) continue;
    const alreadyFilled = f.value && f.type !== 'radio' && f.type !== 'checkbox';
    if (alreadyFilled) {
      // Still allow identity overwrite via reconcile later; skip first pass.
      continue;
    }
    const sel = `[data-co-i="${f.i}"]`;
    const loc = frame.locator(sel);
    const plan = classifyField(f, spec, usedAnswers);
    if (plan?.fromQuestion) usedAnswers.add(plan.fromQuestion);
    // brief pause between fields so the form isn't completed in one instant
    if (plan && !plan.skip && actedCount > 0) await jitter(rand(280, 950));
    if (plan && !plan.skip) actedCount++;
    const labelShort = (f.label || f.name || f.type).slice(0, 80);

    try {
      if (!plan) {
        if (f.required && !f.value) unresolved.push(f);
        continue;
      }
      if (plan.skip) {
        // Explicit demographic match (label/name/id literally said "gender",
        // "race", etc.) — the field's own decline option, when it has one, is
        // known-good here since classifyField already recognized the question
        // as sensitive. Only ONE extra open/close cycle, and only for fields
        // we already know are demographic — never for the many unrelated
        // unclassified dropdowns on a typical form (was tried broadly before,
        // but that added a disruptive extra click to every one of them, which
        // is almost certainly what made an unrelated Yes/No field on this
        // same Agoda form flaky in live testing).
        if (plan.declinePreferred && f.required && (f.tag === 'select' || isComboboxField(f))) {
          const declined = await fillDeclineDropdown(frame, f);
          if (declined) { filled.push({ label: labelShort, value: declined, declined: true }); continue; }
        }
        // Same reasoning for a required radio group (Ashby renders gender as
        // radios, not a dropdown): its options are already scraped, so the
        // non-disclosure choice can be picked deterministically instead of
        // burning an LLM call on a question we deliberately don't answer.
        if (plan.declinePreferred && f.required && f.type === 'radio' && f.options?.length) {
          const decline = pickDeclineOption(f.options);
          if (decline && await clickRadioOption(frame, f, decline.text)) {
            filled.push({ label: labelShort, value: decline.text, declined: true });
            continue;
          }
        }
        // End date while "current role" is checked: leave blank on purpose
        // (ATS usually clears required once the checkbox is ticked).
        if (plan.currentRoleEnd) continue;
        // No inventable profile data (postal / US state without Outside-US option):
        // surface as manual for REQUIRED fields; do not send to the LLM.
        if (plan.leaveBlank) {
          if (f.required) {
            pending.push({
              label: labelShort,
              reason: plan.skip || 'requis — pas de donnée profil (à remplir manuellement)',
            });
          }
          continue;
        }
        if (f.required) unresolved.push(f);

        continue;
      }
      if (plan.check) {
        if (await checkBox(frame, f)) filled.push({ label: labelShort, value: '☑' });
        else if (f.required) unresolved.push(f);

        continue;
      }
      if (plan.resume) {
        const cv = cvSummary();
        if (cv) { await loc.fill(cv, { timeout: 5000 }); filled.push({ label: labelShort, value: '📄 CV (texte)' }); }
        else if (f.required) unresolved.push(f);
        continue;
      }
      if (f.tag === 'select') {
        const opt = pickSelectOption(f.options || [], plan, f.label);
        if (opt) {
          await loc.selectOption(opt.value, { timeout: 4000 });
          filled.push({ label: labelShort, value: opt.text });
        } else if (f.required && plan.leaveBlank) {
          pending.push({ label: labelShort, reason: 'requis — option hors profil introuvable (à remplir manuellement)' });
        } else if (f.required) {
          unresolved.push(f);
        }
        continue;
      }
      if (f.type === 'radio') {
        // Radios now carry an `options` list (like <select>) since collectFields
        // dedupes each yes/no or multi-choice group to one entry — so a 3+
        // option group (work-authorization status, EEOC categories) can match
        // via the same pickSelectOption logic as selects/comboboxes, not just
        // a plain yes/no.
        const opt = (f.options && f.options.length) ? pickSelectOption(f.options, plan, f.label) : null;
        const isYesNo = !opt && !!plan.yesNo;
        const want = opt ? opt.text : (isYesNo ? plan.yesNo : null);
        if (want) {
          const ok = await clickRadioOption(frame, f, want, isYesNo);
          if (ok) filled.push({ label: labelShort, value: want });
          else if (f.required && plan.leaveBlank) {
            pending.push({ label: labelShort, reason: 'requis — choix hors profil introuvable (à remplir manuellement)' });
          } else if (f.required) unresolved.push(f);
        } else if (f.required && plan.leaveBlank) {
          pending.push({ label: labelShort, reason: 'requis — choix hors profil introuvable (à remplir manuellement)' });
        } else if (f.required) {
          unresolved.push(f);
        }
        continue;
      }
      if (f.type === 'date') {
        // Native date picker: fill() writes the ISO value straight into the
        // input's value property, which is how Chromium expects date inputs to
        // be set regardless of the page's display locale — typing digits via
        // pressSequentially() is unreliable across locales/formats here.
        const iso = toIsoDate(plan.dateISO || plan.value || '');
        try {
          await loc.fill(iso, { timeout: 4000 });
          filled.push({ label: labelShort, value: iso });
        } catch (err) {
          if (f.required) unresolved.push(f);
        }
        continue;
      }
      // text-like inputs, textareas, and custom react-select comboboxes.
      // Comboboxes are handled BEFORE the empty-value guard: a yes/no or
      // selectText-only plan (e.g. non-compete → No) has no free-text `value`
      // but must still drive the dropdown.
      const value = plan.value || '';
      if (isComboboxField(f) && !skipComboboxProbe(f)) {
        // searchable dropdown (Ashby, Greenhouse new UI): type the query, then
        // CLICK the matching option. selectText = the short query that filters
        // to the right option; fall back to the yes/no literal, then free text.
        let query = plan.selectText
          || (plan.yesNo ? (plan.yesNo === 'yes' ? 'Yes' : 'No') : value.slice(0, 60));
        // selectPrefer-only plans (e.g. US state → Outside US): scrape options
        // and pick before typing a free-text guess.
        if (!query && plan.selectPrefer) {
          const opts = (f.options && f.options.length) ? f.options : await scrapeComboboxOptions(frame, f);
          const opt = pickSelectOption(opts, plan, f.label);
          if (opt) query = opt.text;
          else if (plan.leaveBlank) {
            if (f.required) {
              pending.push({ label: labelShort, reason: 'requis — option hors profil introuvable (à remplir manuellement)' });
            }
            continue;
          } else if (f.required) { unresolved.push(f); continue; }
        }
        if (!query) {
          if (f.required && plan.leaveBlank) {
            pending.push({ label: labelShort, reason: 'requis — pas de donnée profil (à remplir manuellement)' });
          } else if (f.required && !plan.leaveBlank) unresolved.push(f);
          continue;
        }
        const { matched } = await selectComboboxOption(frame, f, query);
        if (matched) {
          filled.push({ label: labelShort, value: matched });
          continue;
        }
        const hint = locationTypeaheadHint(f, spec.identity || {});
        if (hint) {
          const loose = await selectComboboxOptionOnce(frame, f, hint.prefix, hint.contains);
          if (loose.matched) {
            filled.push({ label: labelShort, value: loose.matched });
            continue;
          }
        }
        if (f.required && plan.leaveBlank) {
          pending.push({ label: labelShort, reason: 'requis — option hors profil introuvable (à remplir manuellement)' });
        } else if (f.required && !plan.leaveBlank) unresolved.push(f);
        continue;
      }
      if (!value) {
        if (f.required && plan.leaveBlank) {
          pending.push({ label: labelShort, reason: plan.skip || 'requis — pas de donnée profil (à remplir manuellement)' });
        } else if (f.required && !plan.optionalEmpty && !plan.leaveBlank) unresolved.push(f);
        continue;
      }
      // Already filled? Compare against the polished text too — that is what
      // actually gets typed, so comparing only the raw plan value let a second
      // pass (re-scan, blocker resolved) re-type a field it had just filled.
      const textValue = polishApplicationAnswer(value);
      const current = (f.value || '').trim();
      if (current && !f.ariaInvalid && !shouldReplaceFilledValue(f, current, textValue)) continue;

      // Last-resort: click and see if a list opens. Must not type unless it did.
      if (shouldSpeculativeProbe(f)) {
        const probe = await selectComboboxOption(frame, f, value.slice(0, 60));
        if (probe.hadOptions) {
          if (probe.matched) filled.push({ label: labelShort, value: probe.matched });
          else if (f.required) unresolved.push(f);
          continue;
        }
      }

      // An unsubstituted template ("[Company]", "{{role}}") in a Section F
      // draft answer is a real error, not a style nit — never type it, send
      // the field to the LLM/human fallback instead.
      if (hasUnresolvedPlaceholder(textValue)) {
        if (f.required) unresolved.push(f);
        continue;
      }
      const typed = await putText(loc, textValue, f);
      if (typed) filled.push({ label: labelShort, value: textValue.length > 70 ? textValue.slice(0, 70) + '…' : textValue, fromQuestion: plan.fromQuestion });
      else if (f.required) unresolved.push(f); // typing + fallback both failed → LLM/human
    } catch (err) {
      if (f.required) pending.push({ label: labelShort, reason: `échec: ${String(err.message || err).slice(0, 80)}` });
    }
  }

  // Phase C — LLM fallback: answer every required field the deterministic pass
  // couldn't handle (unanticipated questions, custom dropdowns, sensitive
  // selects). Guarantees no required field is left empty when the LLM is up.
  if (unresolved.length) {
    log(`Résolution intelligente de ${unresolved.length} champ(s) restant(s)…`);
    // Re-collect: Phase B fills can re-render the form (conditional reveals),
    // which invalidates the data-co-i markers captured earlier. Re-match each
    // unresolved field to its FRESH marker by (label, type, name) so we never
    // act on a stale/renumbered element.
    const fresh = await collectFields(frame);
    const freshByKey = new Map();
    for (const ff of fresh) {
      const key = `${ff.label}|${ff.type}|${ff.name}`;
      if (!freshByKey.has(key)) freshByKey.set(key, []);
      freshByKey.get(key).push(ff);
    }
    const targets = [];
    for (const f of unresolved) {
      const bucket = freshByKey.get(`${f.label}|${f.type}|${f.name}`);
      const ff = bucket && bucket.shift(); // consume so duplicate labels map 1:1
      if (ff) { targets.push(ff); continue; }
      // No fresh match: either a conditional hid the field, or its label
      // changed on re-render. Harmless for an optional field, but a REQUIRED
      // one must not vanish from both lists — that is exactly how a blank
      // mandatory consent reached "0 en attente" on a live run.
      if (f.required) {
        pending.push({ label: (f.label || f.name || f.type).slice(0, 80), reason: 'champ introuvable après re-rendu — à vérifier dans Chrome' });
      }
    }
    // enumerate options for custom dropdowns so the model picks a valid one
    for (const f of targets) {
      if ((!f.options || !f.options.length) && isComboboxField(f)) {
        f.options = await scrapeComboboxOptions(frame, f);
      }
    }
    // A required dropdown whose own option list already offers a decline/
    // opt-out choice ("Prefer not to say", "I don't wish to answer"…) gets
    // that option directly, without asking the LLM — cheaper, and skips the
    // paraphrase-mismatch failure mode entirely (see DECLINE_RE's comment).
    // This is what catches a demographic-style question the label regex
    // didn't recognize (e.g. "How do you identify?" carries no "gender" /
    // "race" keyword, yet its options are the same self-ID choices as fields
    // that DO get caught). Reuses the scrape just above — no extra open/close
    // cycle added beyond what already happened for every other combobox
    // target, unlike an earlier version of this fix that probed every
    // unclassified dropdown up front and made an unrelated Yes/No field on
    // this same Agoda form flaky in live testing.
    const declineTargets = [];
    const llmTargets = [];
    for (const f of targets) {
      const opt = pickDeclineOption(f.options || []);
      if (opt) declineTargets.push({ f, opt }); else llmTargets.push(f);
    }
    for (const { f, opt } of declineTargets) {
      const labelShort = (f.label || f.name || f.type).slice(0, 80);
      try {
        let shown;
        if (f.tag === 'select') {
          await frame.locator(`[data-co-i="${f.i}"]`).selectOption(opt.value, { timeout: 4000 });
          shown = opt.text;
        } else if (f.type === 'radio') {
          shown = (await clickRadioOption(frame, f, opt.text)) ? opt.text : null;
        } else {
          shown = (await selectComboboxOption(frame, f, opt.text)).matched;
        }
        if (shown) { filled.push({ label: labelShort, value: shown, declined: true }); continue; }
      } catch { /* fall through to LLM below */ }
      llmTargets.push(f);
    }
    let answers = {};
    try {
      answers = await resolveUnknownFields({
        fields: llmTargets.map(f => ({ i: f.i, label: f.label, kind: llmKind(f), required: f.required, multiple: fieldIsMulti(f), options: f.options })),
        spec,
        cvSummary: cvSummary(),
        styleGuide: profileVoice(),
      });
    } catch (err) {
      log(`LLM indisponible (${String(err.message || err).slice(0, 70)}) — champs laissés au humain.`);
    }
    for (const f of llmTargets) {
      const labelShort = (f.label || f.name || f.type).slice(0, 80);
      const ans = answers[String(f.i)];
      if (!ans) { if (f.required) pending.push({ label: labelShort, reason: 'sans réponse — à remplir manuellement' }); continue; }
      try {
        const shown = await fillValueIntoField(frame, f, ans);
        if (shown) filled.push({ label: labelShort, value: typeof shown === 'string' ? shown : String(ans), llm: true });
        // Surface the attempted answer in the reason: a human re-checking this
        // field in Chrome sees exactly what the AI guessed and why it didn't
        // land, instead of a generic "not found" that gives no starting point.
        else if (f.required) pending.push({ label: labelShort, reason: `réponse suggérée "${String(Array.isArray(ans) ? ans.join(', ') : ans).slice(0, 60)}" — option introuvable dans la liste` });
      } catch (err) {
        if (f.required) pending.push({ label: labelShort, reason: `échec: ${String(err.message || err).slice(0, 60)}` });
      }
    }
  }

  await reconcileProfileFields(frame, spec, filled);

  // "Tick all that apply" groups expose every option as its own field with the
  // SAME label, and the resolver answers only the ones that actually apply. The
  // unanswered siblings of an option we did tick are not gaps to fix by hand —
  // reporting them made a complete n8n form look like it had 5 missing fields.
  const filledLabels = new Set(filled.map(f => f.label));
  return {
    filled,
    pending: pending.filter(p => !filledLabels.has(p.label)),
    sawResumeSlot: sawResumeSlot || filled.some(x => String(x.value || '').includes('📎')),
  };
}

async function reconcileProfileFields(frame, spec, filled) {
  if (!frameAlive(frame)) return;
  let fields;
  try { fields = await collectFields(frame); } catch { return; }
  for (const f of fields) {
    if (f.type === 'file' || f.type === 'checkbox' || f.type === 'radio') continue;
    if (!shouldFillField(f)) continue;
    const plan = classifyField(f, spec);
    if (!plan || plan.skip || plan.check || plan.resume) continue;
    const want = polishApplicationAnswer(plan.value || plan.selectText || (plan.yesNo === 'yes' ? 'Yes' : plan.yesNo === 'no' ? 'No' : ''));
    if (!want || !shouldReplaceFilledValue(f, f.value, want)) continue;
    try {
      const shown = await fillValueIntoField(frame, f, want);
      if (!shown) continue;
      const labelShort = (f.label || f.name || f.type).slice(0, 80);
      const rec = { label: labelShort, value: String(shown), reconciled: true };
      const idx = filled.findIndex(x => x.label === labelShort);
      if (idx >= 0) filled[idx] = rec;
      else filled.push(rec);
    } catch { /* remainingCompletionIssues will surface it */ }
  }
}

// Re-read missing fields and validation errors after filling or manual edits.
async function remainingCompletionIssues(frame, uploadedLabels = []) {
  if (!frameAlive(frame)) return null;
  try {
    const fields = await collectFields(frame);
    return fields.flatMap(f => {
      const reason = fieldCompletionIssue(f, { uploadedLabels });
      return reason ? [{ label: (f.label || f.name || f.type).slice(0, 80), reason }] : [];
    });
  } catch (err) {
    if (isTargetClosedError(err)) return null;
    // Never fail silently: an exception here used to return "nothing missing",
    // which reads exactly like a clean form.
    log(`Vérification des champs requis impossible (${String(err.message || err).slice(0, 60)}) — relis le formulaire dans Chrome.`);
    return [{ label: 'vérification des champs requis', reason: 'échec du contrôle — relire le formulaire' }];
  }
}

function mergeFillResults(first, second) {
  const byLabel = new Map();
  for (const row of [...(first.filled || []), ...(second.filled || [])]) {
    byLabel.set(row.label, row);
  }
  const filled = [...byLabel.values()];
  const filledLabels = new Set(filled.map(f => f.label));
  const pending = [];
  const seen = new Set();
  for (const row of [...(first.pending || []), ...(second.pending || [])]) {
    if (filledLabels.has(row.label) || seen.has(row.label)) continue;
    seen.add(row.label);
    pending.push(row);
  }
  return {
    filled,
    pending,
    sawResumeSlot: !!(first.sawResumeSlot || second.sawResumeSlot
      || filled.some(x => String(x.value || '').includes('📎'))),
  };
}

// One automatic refill only on real fill failures (upload/exception/option
// click missed). Empty leaveBlank / manual gaps do not trigger a full 2nd pass.
const RETRYABLE_PENDING_RE = /upload échoué|^échec:|option introuvable dans la liste|champ introuvable après re-rendu/i;

async function fillFieldsWithRequiredRetry(frame, spec) {
  let result = await fillFields(frame, spec);
  const uploadedLabels = result.filled.filter(x => String(x.value || '').includes('📎')).map(x => x.label);
  let issues = await remainingCompletionIssues(frame, uploadedLabels);
  if (issues === null) return { ...result, completionIssues: null };

  const failed = (result.pending || []).filter(p => RETRYABLE_PENDING_RE.test(p.reason));
  // Also retry when a required file still looks missing after we thought we uploaded it.
  const fileStillMissing = (issues || []).some(i => /fichier requis/i.test(i.reason));
  if (!failed.length && !fileStillMissing) return { ...result, completionIssues: issues };

  const n = failed.length + (fileStillMissing ? 1 : 0);
  log(`Relance automatique: ${n} échec(s) de remplissage…`);
  await sleep(rand(150, 350));
  const second = await fillFields(frame, spec);
  result = mergeFillResults(result, second);
  const uploaded2 = result.filled.filter(x => String(x.value || '').includes('📎')).map(x => x.label);
  issues = await remainingCompletionIssues(frame, uploaded2);
  return { ...result, completionIssues: issues };
}

// ── Submit ────────────────────────────────────────────────────────────────────

// SUBMIT_TEXT_RE → lib/apply-progression.mjs (shared with bridge)

async function clickSubmit(frame, page) {
  if (!frameAlive(frame)) return false;
  // Same normalized-innerText matching as clickApplyAndFollow (hasText regex
  // breaks on un-trimmed textContent). Text match first, then any [type=submit].
  let found;
  try {
    found = await frame.evaluate((reSrc) => {
    document.querySelectorAll('[data-co-submit]').forEach(el => el.removeAttribute('data-co-submit'));
    const re = new RegExp(reSrc, 'i');
    const txt = (el) => ((el.innerText || el.value || '')).replace(/\s+/g, ' ').trim();
    const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 5 && r.height > 5 && !el.disabled; };
    const all = [...document.querySelectorAll('button, input[type="submit"], input[type="button"]')]
      .filter(visible)
      .filter(el => !/apply for this (job|position|role)/i.test(txt(el)));
    // Priority: explicit submit/send wording → a type=submit control (last one,
    // usually the form's primary action) → any apply/postuler wording. This
    // avoids clicking a leftover sticky "Apply" header button.
    const strong = /^(submit|send|envoyer|soumettre|valider|finish)\b/i;
    const target = all.find(el => strong.test(txt(el)))
      || [...all].reverse().find(el => (el.type || '').toLowerCase() === 'submit')
      || all.find(el => re.test(txt(el)));
    if (!target) return null;
    target.setAttribute('data-co-submit', '1');
    return txt(target).slice(0, 60) || 'submit';
    }, SUBMIT_TEXT_RE.source);
  } catch (err) {
    if (isTargetClosedError(err)) return false;
    log(`Clic d'envoi raté (${String(err.message || err).slice(0, 60)})`);
    return false;
  }
  if (!found) return false;
  try {
    const loc = frame.locator('[data-co-submit="1"]');
    await loc.scrollIntoViewIfNeeded({ timeout: 1200 }).catch(() => {});
    await sleep(rand(200, 600)); // brief pause before the irreversible click, as if re-checking the form
    await humanClick(loc, { timeout: 6000 });
    log(`Clic sur le bouton d'envoi "${found}"`);
    return true;
  } catch (err) {
    if (isTargetClosedError(err)) return false;
    log(`Clic d'envoi raté (${String(err.message || err).slice(0, 60)})`);
    return false;
  }
}

// After clicking submit, tell whether the form REJECTED us (validation errors,
// form still on screen) versus actually went through. Returns the count of
// visible error markers + whether an application form is still present.
//
// Rejection-banner phrasing per supported market (AGENTS.md's market table:
// EN default, FR/DE/AR/JA/TR/HI) — kept as separate named sources, joined
// below, so one market's wording can be audited or fixed without touching an
// unrelated language buried in the same alternation. Best-effort common
// phrasing, not exhaustive per ATS vendor.
const REJECTION_BANNER_EN = "needs? correction|missing entry for required field|please correct|fix the (errors?|following)";
const REJECTION_BANNER_FR = "corrigez|champs? (obligatoires?|requis) manquants?";
const REJECTION_BANNER_DE = "bitte (korrigieren|überprüfen) sie|pflichtfeld(er)? fehlen|füllen sie alle pflichtfelder aus";
const REJECTION_BANNER_AR = "يرجى تصحيح|حقل مطلوب|يرجى إكمال جميع الحقول المطلوبة";
const REJECTION_BANNER_JA = "必須項目|入力してください|正しく入力されていません";
const REJECTION_BANNER_TR = "lütfen (düzeltin|kontrol edin)|zorunlu alan|lütfen (tüm )?zorunlu alanları doldurun";
const REJECTION_BANNER_HI = "कृपया सही करें|आवश्यक फ़ील्ड|कृपया सभी आवश्यक फ़ील्ड भरें";
const REJECTION_BANNER_RE_SOURCE = [
  REJECTION_BANNER_EN, REJECTION_BANNER_FR, REJECTION_BANNER_DE,
  REJECTION_BANNER_AR, REJECTION_BANNER_JA, REJECTION_BANNER_TR, REJECTION_BANNER_HI,
].join('|');

async function detectSubmitRejection(page) {
  try {
    return await page.evaluate((bannerReSrc) => {
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return false;
        const st = getComputedStyle(el);
        return st.visibility !== 'hidden' && st.display !== 'none';
      };
      const errRe = /required|invalid|please|select|complete|must |enter |provide |champ|obligatoire|manquant|requis|veuillez|compl[ée]t|remplir|saisir|s[ée]lectionn|invalide|pflichtfeld|erforderlich|ungültig|ausfüllen/i;
      // Text-bearing error markers…
      const textErrs = [...document.querySelectorAll(
        '.error, .field-error, [class*="error" i], [class*="invalid" i], [role="alert"], [aria-live="assertive"]'
      )].filter(el => visible(el) && errRe.test((el.innerText || '').trim()));
      // …plus fields flagged invalid even when the message is only a red border
      // (an attribute, not scraped copy — works regardless of page language).
      const invalidFields = [...document.querySelectorAll('[aria-invalid="true"]')].filter(visible);
      // Class-name matching alone misses ATS that hash their CSS modules: Ashby
      // renders "Your form needs corrections / Missing entry for required
      // field: …" in a banner whose class carries no "error" substring, so a
      // bounced submit was reported as "probably sent" (live on n8n).
      const bodyText = (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 6000);
      const bannerRe = new RegExp(bannerReSrc, 'i');
      const banner = bodyText.match(bannerRe);
      const errorCount = textErrs.length + invalidFields.length + (banner ? 1 : 0);
      // Not gated on a literal <form> element: many SPA-built ATS (React, no
      // native form wrapper) render fillable controls without one, and a
      // rejected submit there used to fall through to "probably sent" instead
      // of being reported as rejected. File inputs are checked unfiltered
      // (not `.some(visible)`): a native <input type=file> is routinely
      // display:none, triggered by a styled "Upload" button — same reason
      // form-detect.mjs's hasVisibleField skips visibility for file inputs.
      const files = [...document.querySelectorAll('input[type="file"]')];
      const otherFillable = [...document.querySelectorAll('textarea, select, [role="combobox"]')];
      const stillForm = files.length > 0 || otherFillable.some(visible);
      let sample = (textErrs[0]?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      if (!sample && banner) sample = bodyText.slice(banner.index, banner.index + 120).trim();
      return { errorCount, stillForm, sample };
    }, REJECTION_BANNER_RE_SOURCE);
  } catch { return { errorCount: 0, stillForm: false, sample: '' }; }
}

// Confirmation-page phrasing per supported market, same rationale/structure
// as the rejection banner above.
const CONFIRM_TEXT_EN = "thank you|application (received|submitted|sent)|we('|’)ve received|successfully (submitted|applied)|your application has been";
const CONFIRM_TEXT_FR = "merci pour votre candidature|candidature (envoyée|reçue|bien reçue)";
const CONFIRM_TEXT_DE = "vielen dank für (ihre|deine) bewerbung|bewerbung (wurde |ist )?(erfolgreich )?(eingegangen|übermittelt|versendet|eingereicht)|wir haben (ihre|deine) bewerbung erhalten";
const CONFIRM_TEXT_AR = "شكرا لتقديم طلبك|تم استلام طلبك|تم تقديم طلبك بنجاح";
const CONFIRM_TEXT_JA = "応募(いただき)?ありがとうございます|応募を受け付けました|応募が完了しました";
const CONFIRM_TEXT_TR = "başvurunuz (için )?teşekkür ederiz|başvurunuz alındı|başvurunuz başarıyla (gönderildi|iletildi)";
const CONFIRM_TEXT_HI = "आपके आवेदन के लिए धन्यवाद|आपका आवेदन प्राप्त हो गया है|आवेदन सफलतापूर्वक (जमा|सबमिट) हो गया";
const CONFIRM_TEXT_RE_SOURCE = [
  CONFIRM_TEXT_EN, CONFIRM_TEXT_FR, CONFIRM_TEXT_DE,
  CONFIRM_TEXT_AR, CONFIRM_TEXT_JA, CONFIRM_TEXT_TR, CONFIRM_TEXT_HI,
].join('|');

async function detectConfirmation(page, preSubmitUrl = '') {
  try {
    return await page.evaluate(({ textReSrc, pathReSrc, preUrl }) => {
      const t = (document.body?.innerText || '').toLowerCase().slice(0, 6000);
      const textMatch = new RegExp(textReSrc, 'i').test(t);
      if (textMatch) return true;
      // Language-agnostic fallback: many ATS redirect to a dedicated
      // confirmation URL regardless of the page's own language. Only trusted
      // when (a) the page actually navigated away from the pre-submit URL —
      // a path merely containing one of these words with no navigation is
      // not evidence anything happened — and (b) the word list is specific
      // to an application outcome: bare "confirmation"/"confirmed"/"thanks"
      // used to match unrelated interstitials (an "email-confirmation" step,
      // a "review & confirm" page BEFORE the real submit), false-reporting
      // an unfinished application as sent.
      if (!preUrl || location.href === preUrl) return false;
      const path = location.pathname.toLowerCase();
      return new RegExp('(?:^|/)(?:' + pathReSrc + ')(?:/|$|\\b)', 'i').test(path);
    }, { textReSrc: CONFIRM_TEXT_RE_SOURCE, pathReSrc: POST_APPLY_PATH_RE_SOURCE, preUrl: preSubmitUrl });
  } catch { return false; }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function recoverPostApply(page, preUrl = spec.jobUrl) {
  const url = currentPageUrl(page);
  if (state.filled.length && looksLikePostApplyPath(url)) return url;
  if (pageIsGone(page)) return '';
  try {
    if (await detectConfirmation(page, preUrl)) return currentPageUrl(page) || url;
  } catch (err) {
    if (!isTargetClosedError(err)) throw err;
  }
  return '';
}

async function waitForCommand(page, frame, { allowAutoResume = false } = {}) {
  // Poll command.json; if a blocker disappears, signal auto-resume.
  for (;;) {
    const cmd = readCommand();
    if (cmd) return cmd;
    if (pageIsGone(page)) return 'browser_closed';
    try {
      if (allowAutoResume) {
        const blocker = await detectBlocker(page);
        if (!blocker) return 'rescan';
      }
      state.currentUrl = page.url();
    } catch (err) {
      if (isTargetClosedError(err)) return 'browser_closed';
      throw err;
    }
    await writeState();
    await sleep(1500);
  }
}

async function waitForStepChange(page, previousFp, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = await findFormFrame(page).catch(() => ({ frame: null }));
    if (found?.frame) {
      const fields = await collectFields(found.frame).catch(() => []);
      let url = '';
      let heading = '';
      try { url = page.url(); } catch { url = ''; }
      try {
        const snap = await page.evaluate(PAGE_STEP_SNAPSHOT);
        heading = snap?.heading || '';
      } catch { heading = ''; }
      const sig = fieldsFingerprint(fields, { url, heading });
      if (sig && previousFp && sig !== previousFp) return { frame: found.frame, sig };
    }
    await sleep(400);
  }
  return null;
}

async function main() {
  function finish(s, msg) {
    setState(s, msg);
  }
  function stopFromCommand(cmd) {
    if (cmd === 'manual_sent') return finish('submitted', '📨 Envoi confirmé manuellement.');
    if (cmd === 'abort') return finish('aborted', 'Annulé par l\'utilisateur.');
    if (cmd === 'browser_closed') {
      const url = state.currentUrl || '';
      if (state.filled.length && looksLikePostApplyPath(url)) {
        return finish('submitted', postApplyMessage(url));
      }
      return finish('aborted', chromeClosedMessage());
    }
  }

  await writeState();
  log(`Candidature: ${spec.company} — ${spec.role} [région: ${spec.region === 'asia' ? 'Asie → Bangkok' : 'Europe → Paris'}]`);
  log(`CV: ${basenamePath(spec.cvPath)} · ${spec.answers.length} réponse(s) pré-écrites`);

  const context = await launchBrowser();
  context.setDefaultTimeout(15000);
  const page = context.pages()[0] || await context.newPage();

  try {
    setState('navigating', `Ouverture de l'offre…`);
    await page.goto(spec.jobUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(3000);

    const sessionHandler = findSiteSessionHandler(currentPageUrl(page));
    if (sessionHandler) {
      log('Préambule de connexion requis avant Apply.');
      if (!(await sessionHandler.ensureSession(context, page))) {
        setState('needs_human', '🔐 Connexion requise — connecte-toi dans Chrome, puis Re-scanner.');
        const cmd = await waitForCommand(page, null, { allowAutoResume: true });
        if (cmd === 'abort' || cmd === 'browser_closed' || cmd === 'manual_sent') return stopFromCommand(cmd);
        if (!(await sessionHandler.ensureSession(context, page))) {
          return finish('needs_human', 'Connexion non établie.');
        }
      }
    }

    setState('finding_form', 'Recherche du formulaire de candidature…');
    let { page: formPage, frame, blocker } = await reachApplicationForm(context, page);
    await screenshot(formPage, 'landing');

    let activePage = formPage;
    // Circuit breaker for a specific runaway pattern seen live (#tether-ops,
    // 3 days / 476k log lines / 103MB state.json): a permanently-stuck
    // preamble (e.g. Himalayas' login-attempt cap reached) makes
    // reachApplicationForm set a synthetic blocker every time, but
    // waitForCommand's allowAutoResume checks detectBlocker() — a DOM probe
    // that never produced this synthetic blocker in the first place, so it
    // can't see it clear either, and kept returning 'rescan' instantly (no
    // sleep on that path) forever. After a few consecutive repeats of the
    // SAME blocker, stop auto-resuming and genuinely wait on a human command
    // (waitForCommand's normal 1.5s poll) instead of re-looping blind.
    let lastBlockerType = null;
    let sameBlockerStreak = 0;
    // Consecutive-streak alone isn't enough: a blocker that momentarily
    // clears (reachApplicationForm sees none, fillFields resumes) and then
    // re-triggers the SAME wall a cycle later resets the streak every time
    // without ever tripping the >=3 check — observed live as a captcha that
    // kept "clearing" into a fill pass and reappearing right after, cycling
    // for 24+ minutes and re-spending an LLM call each lap. This total is a
    // per-type count that never resets, as a hard ceiling under the streak.
    const blockerTotals = new Map();
    const MAX_BLOCKER_TOTAL = 5;
    let aiSubmitText = '';
    navAiBudget.nav = 0;
    navAiBudget.review = 0;

    for (;;) {
      if (blocker) {
        if (blocker === lastBlockerType) sameBlockerStreak++;
        else { lastBlockerType = blocker; sameBlockerStreak = 1; }
        blockerTotals.set(blocker, (blockerTotals.get(blocker) || 0) + 1);

        if (await tryAutoSolveBlocker(context, activePage, blocker, 'main-loop')) {
          blocker = null;
          lastBlockerType = null;
          sameBlockerStreak = 0;
          ({ page: activePage, frame, blocker } = await reachApplicationForm(context, activePage));
          continue;
        }
        setState('needs_human', blocker === 'captcha' ? '🤖 Captcha détecté — résous-le dans la fenêtre Chrome.'
          : blocker === 'login' ? '🔐 Connexion requise — connecte-toi dans la fenêtre Chrome.'
          : blocker === 'auth_wall' ? '👤 Ce site exige un compte et ne propose pas d\'accès invité — crée le compte ou connecte-toi dans Chrome, puis clique "Re-scanner".'
          : '🛡️ Protection anti-bot — passe la vérification dans la fenêtre Chrome.');
        const totalForType = blockerTotals.get(blocker) || 0;
        const autoResume = sameBlockerStreak < 3 && totalForType < MAX_BLOCKER_TOTAL;
        if (!autoResume) {
          log(`⚠️ Blocker "${blocker}" toujours présent (${sameBlockerStreak} d'affilée, ${totalForType} au total) — reprise automatique désactivée, clique "Re-scanner" une fois résolu.`);
        }
        const cmd = await waitForCommand(activePage, frame, { allowAutoResume: autoResume });
        if (cmd === 'abort' || cmd === 'browser_closed' || cmd === 'manual_sent') return stopFromCommand(cmd);
        blocker = null;
        ({ page: activePage, frame, blocker } = await reachApplicationForm(context, activePage));
        // Genuine resolution (auto-detected by waitForCommand or fixed by hand)
        // resets the streak too, not just a tryAutoSolveBlocker success above —
        // otherwise the SAME blocker type recurring 3 separate times across a
        // run, each one legitimately solved in seconds, permanently disables
        // auto-resume for that type even though nothing was ever actually stuck.
        // blockerTotals deliberately does NOT reset here — see comment above.
        if (!blocker) { lastBlockerType = null; sameBlockerStreak = 0; }
        continue;
      }

      if (!frameAlive(frame)) {
        const outcomeUrl = await recoverPostApply(activePage);
        if (outcomeUrl) return finish('submitted', postApplyMessage(outcomeUrl));
        await screenshot(activePage, 'no-form');
        setState('needs_human', '❓ Formulaire introuvable automatiquement — navigue manuellement jusqu\'au formulaire dans Chrome, puis clique "Re-scanner".');
        const cmd = await waitForCommand(activePage, frame);
        if (cmd === 'abort' || cmd === 'browser_closed' || cmd === 'manual_sent') return stopFromCommand(cmd);
        // after manual navigation, the form may be in any open tab
        for (const p of context.pages()) {
          const { frame: fr } = await findFormFrame(p);
          if (fr) { activePage = p; frame = fr; break; }
        }
        if (!frameAlive(frame)) continue;
      }

      setState('filling', 'Remplissage du formulaire…');
      let filled;
      let pending;
      let completionIssues;
      let sawResumeSlot = false;
      try {
        ({ filled, pending, completionIssues, sawResumeSlot } = await fillFieldsWithRequiredRetry(frame, spec));
      } catch (err) {
        if (!isTargetClosedError(err)) throw err;
        const outcomeUrl = await recoverPostApply(activePage);
        if (outcomeUrl) return finish('submitted', postApplyMessage(outcomeUrl));
        log('Formulaire fermé pendant le remplissage — nouvelle détection.');
        ({ page: activePage, frame, blocker } = await rescanForm(context, activePage));
        continue;
      }
      state.filled = filled;
      if (completionIssues === null) {
        const outcomeUrl = await recoverPostApply(activePage);
        if (outcomeUrl) return finish('submitted', postApplyMessage(outcomeUrl));
        log('Formulaire disparu après remplissage — nouvelle détection.');
        ({ page: activePage, frame, blocker } = await rescanForm(context, activePage));
        continue;
      }
      // Merge fillFields pending + live browser required check. Browser wins on
      // emptiness; keep the more specific manual reason when both exist.
      {
        const byLabel = new Map();
        for (const p of pending) byLabel.set(p.label, p);
        for (const r of completionIssues) {
          if (!byLabel.has(r.label)) byLabel.set(r.label, r);
        }
        const stillBroken = new Set(completionIssues.map(i => i.label));
        pending = [...byLabel.values()].filter(p => {
          if (stillBroken.has(p.label)) return true;
          // Filled successfully and the form no longer flags it (e.g. Current
          // role cleared end-date required) → drop.
          if (filled.some(f => f.label === p.label)) return false;
          // leaveBlank / manual gap that collectFields did not mark required
          // (no asterisk in DOM yet) — keep so the UI still asks the human.
          return /manuellement|profil|hors profil/.test(p.reason || '');
        });
      }
      state.pending = pending;
      log(`${filled.length} champ(s) rempli(s), ${pending.length} requis en attente`);
      await screenshot(activePage, 'filled');

      const newBlocker = await detectBlocker(activePage);
      if (newBlocker) { blocker = newBlocker; continue; }

      const applyEntryVisible = await activePage.evaluate(PAGE_SHOWS_APPLY_ENTRY).catch(() => false);
      let ready = looksReadyToSubmit({ filled, pending, applyEntryVisible });
      // Plugin parity: never auto-submit when a resume slot was seen but 📎 never landed.
      const hasCvAttached = filled.some((f) => /📎/.test(String(f.value || '')));
      let cvBlocksSubmit = !!sawResumeSlot && !hasCvAttached;
      if (cvBlocksSubmit) {
        const already = pending.some((p) => /resume|\bcv\b|upload|fichier|CV /i.test(`${p.reason || ''} ${p.label || ''}`));
        if (!already) {
          pending = [...pending, { label: 'Resume/CV', reason: 'CV manquant — upload non confirmé' }];
          state.pending = pending;
        }
        log('CV manquant — envoi bloqué jusqu’à upload réussi.');
      }

      aiSubmitText = '';
      let stepFields = [];
      try { stepFields = await collectFields(frame); } catch { stepFields = []; }
      const chip = stepFields.find((f) => f.type === 'file' && String(f.fileChip || '').trim());
      if (chip && !filled.some((f) => /📎/.test(String(f.value || '')))) {
        filled = [...filled, {
          label: String(chip.label || chip.name || 'Resume/CV').slice(0, 80),
          value: `📎 ${chip.fileChip}`,
        }];
        state.filled = filled;
        pending = pending.filter((p) => !/CV manquant|fichier requis|upload non confirmé/i.test(String(p.reason || '')));
        state.pending = pending;
        cvBlocksSubmit = false;
      }
      let snap = { heading: '', bodySnippet: '' };
      try { snap = await activePage.evaluate(PAGE_STEP_SNAPSHOT) || snap; } catch { /* page gone */ }
      const editableCount = countEditableApplyFields(stepFields);
      let isReviewStep = pageLooksLikeReviewStep({
        heading: snap.heading || '',
        bodySnippet: snap.bodySnippet || '',
        fieldCount: stepFields.length,
        editableCount,
      });
      if (!isReviewStep && reviewStepNeedsAi({
        heading: snap.heading || '',
        bodySnippet: snap.bodySnippet || '',
        fieldCount: stepFields.length,
        editableCount,
      })) {
        const d = await askPageNavAi(activePage, {
          phase: 'review',
          fields: stepFields,
          heading: snap.heading || '',
          bodySnippet: snap.bodySnippet || '',
        });
        if (d?.action === 'review' || (d?.action === 'click' && SUBMIT_TEXT_RE.test(d.text || ''))) {
          isReviewStep = true;
          if (d.action === 'click') aiSubmitText = d.text;
        } else if (d?.action === 'click' && d.text && await clickListedNav(activePage, d)) {
          await sleep(1000);
          const again = await findFormFrame(activePage);
          const afterFp = again.frame ? fieldsFingerprint(await collectFields(again.frame).catch(() => [])) : '';
          if (afterFp && afterFp !== fieldsFingerprint(stepFields)) {
            frame = again.frame;
            continue;
          }
        }
      }
      if (isReviewStep) {
        log('Étape de vérification / récapitulatif détectée');
        pending = pending.filter((p) => isBlockingApplyPending(p.reason));
        state.pending = pending;
      }

      const hardBlock = pending.some((p) => isBlockingApplyPending(p.reason));
      const stepFp = fieldsFingerprint(stepFields, {
        url: currentPageUrl(activePage),
        heading: snap.heading || '',
      });
      if (!isReviewStep && !hardBlock && !cvBlocksSubmit && !applyEntryVisible && filled.length >= 1) {
        const nxt = await clickApplyAndFollow(context, activePage, PROGRESS_TEXT_RE);
        if (nxt) {
          const changed = await waitForStepChange(nxt, stepFp, 8000);
          if (changed?.frame) {
            activePage = nxt;
            frame = changed.frame;
            blocker = null;
            continue;
          }
          log('Next sans changement — correction des champs invalides puis second Next…');
          try { await fillFieldsWithRequiredRetry(frame, spec); } catch (err) {
            if (!isTargetClosedError(err)) log(String(err?.message || err).slice(0, 120));
          }
          const nxt2 = await clickApplyAndFollow(context, activePage, PROGRESS_TEXT_RE);
          const page2 = nxt2 || activePage;
          const changed2 = await waitForStepChange(page2, stepFp, 8000);
          if (changed2?.frame) {
            activePage = page2;
            frame = changed2.frame;
            blocker = null;
            continue;
          }
          log('Next sans changement d’étape — tentative d’envoi une fois.');
        }
      }

      ready = looksReadyToSubmit({ filled, pending, applyEntryVisible });

      if (pending.length) {
        setState('needs_human', cvBlocksSubmit
          ? `✋ CV manquant (${pending.length} champ(s) à compléter). Attache le CV dans Chrome puis Re-scanner.`
          : `✋ ${pending.length} champ(s) à compléter manuellement dans Chrome, puis "Re-scanner" ou "Envoyer".`);
      } else if (applyEntryVisible) {
        log('Bouton « Apply for this job » encore visible — le formulaire n’est pas ouvert, pas d’envoi.');
        const next = await clickApplyAndFollow(context, activePage, APPLY_TEXT_RE)
          || await clickApplyAndFollow(context, activePage, PROGRESS_TEXT_RE);
        if (next) {
          activePage = next;
          ({ page: activePage, frame, blocker } = await reachApplicationForm(context, activePage));
          continue;
        }
        setState('needs_human', '✋ Le formulaire n’est pas ouvert (Apply encore visible). Clique Apply dans Chrome puis « Re-scanner ».');
      } else if (!ready) {
        log('Identité absente — envoi automatique bloqué (pending=0 n’est pas une candidature complète).');
        setState('needs_human', '✋ Formulaire incomplet (email/identité manquants). Vérifie dans Chrome puis Re-scanner ou Envoyer.');
      } else if (spec.autoSubmit && !cvBlocksSubmit) {
        log('Aucun champ en attente — envoi automatique activé.');
      } else {
        setState('ready_to_review', '✅ Formulaire rempli — vérifie dans Chrome puis clique "Confirmer l\'envoi", ou "J\'ai envoyé" si tu as déjà validé.');
      }

      let cmd;
      if (spec.autoSubmit && ready && !cvBlocksSubmit) {
        cmd = 'submit';
      } else {
        cmd = await waitForCommand(activePage, frame);
      }
      if (cmd === 'abort' || cmd === 'browser_closed' || cmd === 'manual_sent') return stopFromCommand(cmd);
      if (cmd === 'rescan') {
        ({ page: activePage, frame, blocker } = await rescanForm(context, activePage));
        continue;
      }
      if (cmd !== 'submit') continue;

      // Submit retry loop — re-click only (never re-fill, so a manual fix isn't
      // overwritten). Every iteration either returns, breaks to the outer loop
      // (rescan/blocker), or blocks on a user command, so it can't busy-spin and
      // never falls through to a re-fill.
      let outerAction = null;
      let submitHealUsed = false;
      for (;;) {
        // Re-verify right before the click, not just once after filling: a
        // required radio/checkbox group can read as checked immediately after
        // fillFields yet be unchecked again by the time clickSubmit finishes
        // scrolling the page to find the button — observed live on an Ashby
        // form where a native-only `checked` flag didn't survive the section
        // scrolling out of and back into view. Catching that here costs one
        // cheap DOM scan and skips a real (and then-rejected) submit attempt.
        const staleIssues = await remainingCompletionIssues(frame, (state.filled || []).filter(x => String(x.value || '').includes('📎')).map(x => x.label));
        if (staleIssues === null) {
          const outcomeUrl = await recoverPostApply(activePage);
          if (outcomeUrl) return finish('submitted', postApplyMessage(outcomeUrl));
          outerAction = 'rescan';
          break;
        }
        if (staleIssues.length) {
          state.pending = staleIssues;
          setState('needs_human', `✋ ${staleIssues.length} champ(s) à compléter manuellement dans Chrome, puis "Re-scanner" ou "Envoyer".`);
          const c1 = await waitForCommand(activePage, frame);
          if (c1 === 'abort' || c1 === 'browser_closed' || c1 === 'manual_sent') return stopFromCommand(c1);
          if (c1 === 'rescan') { outerAction = 'rescan'; break; }
          continue; // 'submit' = user fixed it manually → re-verify from the top
        }
        setState('submitting', 'Envoi de la candidature…');
        const preSubmitUrl = currentPageUrl(activePage);
        let clicked = await clickSubmit(frame, activePage);
        if (!clicked && aiSubmitText) clicked = await clickExactLabelOnPage(activePage, aiSubmitText);
        if (!clicked) {
          const outcomeUrl = await recoverPostApply(activePage, preSubmitUrl);
          if (outcomeUrl) return finish('submitted', postApplyMessage(outcomeUrl));
          const d = await askPageNavAi(activePage, { phase: 'stuck' });
          if (d?.action === 'click' && d.text) {
            clicked = await clickListedNav(activePage, d) || await clickExactLabelOnPage(activePage, d.text);
          }
        }
        if (!clicked) {
          setState('needs_human', '❓ Bouton d\'envoi introuvable — clique sur Submit dans Chrome, puis "J\'ai envoyé".');
          const c2 = await waitForCommand(activePage, frame);
          if (c2 === 'abort' || c2 === 'browser_closed' || c2 === 'manual_sent') return stopFromCommand(c2);
          if (c2 === 'rescan') { outerAction = 'rescan'; break; }
          // 'submit' = user clicked Submit manually → verify below
        }
        await sleep(1500);

        const postBlocker = await detectBlocker(activePage);
        if (postBlocker) { blocker = postBlocker; outerAction = 'blocker'; break; }

        state.confirmed = await detectConfirmation(activePage, preSubmitUrl);
        if (!state.confirmed) {
          const outcomeUrl = await recoverPostApply(activePage, preSubmitUrl);
          if (outcomeUrl) {
            state.confirmed = true;
            await screenshot(activePage, 'after-submit');
            return finish('submitted', postApplyMessage(outcomeUrl));
          }
        }
        await screenshot(activePage, 'after-submit');
        if (state.confirmed) return finish('submitted', postApplyMessage(currentPageUrl(activePage)));

        // No confirmation → did the form reject us (validation errors shown)?
        const rejection = await detectSubmitRejection(activePage);
        if (rejection.stillForm && rejection.errorCount > 0) {
          if (!submitHealUsed && frameAlive(frame)) {
            submitHealUsed = true;
            log('Envoi refusé — correction des champs invalides puis second envoi…');
            try { await fillFieldsWithRequiredRetry(frame, spec); } catch (err) {
              if (!isTargetClosedError(err)) log(String(err?.message || err).slice(0, 120));
            }
            continue;
          }
          setState('needs_human', `⚠️ Envoi refusé — ${rejection.errorCount} champ(s) invalide(s)${rejection.sample ? ` (« ${rejection.sample} »)` : ''}. Corrige dans Chrome puis clique "Envoyer" (ou "Re-scanner" pour me laisser recompléter).`);
          const c3 = await waitForCommand(activePage, frame);
          if (c3 === 'abort' || c3 === 'browser_closed' || c3 === 'manual_sent') return stopFromCommand(c3);
          if (c3 === 'rescan') { outerAction = 'rescan'; break; }
          if (c3 === 'submit') continue; // user fixed it → re-click submit only
        }
        return finish('submitted', '📨 Candidature probablement envoyée — pas de message de confirmation détecté, vérifie la fenêtre Chrome.');
      }
      if (outerAction === 'rescan') {
        ({ page: activePage, frame, blocker } = await rescanForm(context, activePage));
      }
      continue;
    }
  } catch (err) {
    if (isTargetClosedError(err)) {
      const url = state.currentUrl || '';
      if (state.filled.length && looksLikePostApplyPath(url)) {
        finish('submitted', postApplyMessage(url));
      } else {
        finish('aborted', chromeClosedMessage());
      }
    } else {
      setState('error', `Erreur: ${String(err?.message || err).slice(0, 300)}`);
    }
  } finally {
    await writeState();
    // leave the window open briefly so the user can see the final page
    await sleep(state.state === 'submitted' ? 8000 : 2000);
    await context.close().catch(() => {});
  }
}

main().catch(async (err) => {
  if (isTargetClosedError(err)) {
    const url = state.currentUrl || '';
    if (state.filled.length && looksLikePostApplyPath(url)) {
      setState('submitted', postApplyMessage(url));
    } else {
      setState('aborted', chromeClosedMessage());
    }
  } else {
    setState('error', `Erreur fatale: ${String(err?.message || err).slice(0, 300)}`);
  }
  // setState()'s own log() call writes state fire-and-forget; wait for the
  // queue to drain before the hard exit below, or process.exit() can kill
  // the process mid-retry and the final error state never reaches disk.
  await writeState().catch(() => {});
  process.exit(isTargetClosedError(err) ? 0 : 1);
});
