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
//   - command.json ← server writes {action: submit|rescan|abort|close}, runner consumes it

import 'dotenv/config';
import { readFileSync, writeFileSync, renameSync, existsSync, unlinkSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { resolveUnknownFields } from './lib/apply-llm.mjs';
import { polishApplicationAnswer, hasUnresolvedPlaceholder, loadApplicationVoice } from './lib/application-writing.mjs';
import { looksLikeTypeahead, isComboboxField, shouldSpeculativeProbe } from './lib/apply-fill-guards.mjs';
import { blockerProbe, BLOCKER_PROBE_ARGS } from './lib/apply-blocker-probe.mjs';
import { fieldCompletionIssue, fieldMatchesAnswer } from './lib/apply-completion.mjs';
import { COLLECT_FIELDS } from './lib/apply-collect-fields.mjs';
import { watchApplicationTransition, exploreApplicationInterface } from './lib/apply-navigation.mjs';
import { COMBOBOX_OPTION_QUERY } from './lib/apply-combobox-dom.mjs';
import {
  PINCHTAB_URL,
  pinchtabClose,
  pinchtabCookies,
  pinchtabHealth,
  pinchtabNavigate,
  pinchtabSolve,
  pinchtabSolveSucceeded,
} from './lib/pinchtab.mjs';
import { APPLICATION_FORM_PROBE, AUTH_AVOID_TEXT_RE, GUEST_TEXT_RE, MARK_PROGRESSION_CONTROLS } from './lib/form-detect.mjs';
import {
  isHimalayasHost,
  isHimalayasLoginPath,
  shouldEnsureHimalayasSession,
  samePageUrl,
  inferHimalayasLoggedIn,
  canAttemptHimalayasLogin,
  looksLikeHimalayasLoginError,
} from './lib/himalayas-apply.mjs';

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
  runId: RUN_DIR.split('/').pop(),
  state: 'launching',
  message: '',
  company: spec.company,
  role: spec.role,
  region: spec.region,
  cv: spec.cvPath.split('/').pop(),
  jobUrl: spec.jobUrl,
  currentUrl: '',
  steps: [],
  filled: [],
  pending: [],
  screenshots: [],
  confirmed: false,
  updatedAt: null,
};

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function writeState() {
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
      sleepSync(40 + attempt * 45);
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
      sleepSync(80 + attempt * 80);
    }
  }

  throw lastErr;
}

function setState(s, message = '') {
  state.state = s;
  if (message) state.message = message;
  log(`[${s}] ${message}`);
}

function log(text) {
  state.steps.push({ ts: new Date().toISOString(), text });
  console.log(text);
  writeState();
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

// Native <input type="date"> pickers need an ISO yyyy-mm-dd value — anything
// else is silently rejected by the browser (no keystrokes to simulate against).
// "Immediately available"-style free text collapses to today's date.
// Local calendar date, not UTC — Date#toISOString() converts to UTC first,
// which silently shifts the day by one near midnight in any timezone ahead of
// or behind UTC. A date input must reflect the date as read locally.
function localIsoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function toIsoDate(value) {
  const raw = String(value ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  // DD/MM/YYYY or DD-MM-YYYY (French convention) — parsed explicitly. new Date()
  // assumes US MM/DD/YYYY for slash-separated dates, which would silently swap
  // day and month for a French profile (e.g. "01/09/2026" → Jan 9, not Sep 1).
  const dmy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const [, d, mo, y] = dmy;
    if (+mo <= 12 && +d <= 31) return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const d = new Date(raw);
  if (raw && !Number.isNaN(d.getTime())) return localIsoDate(d);
  return localIsoDate(new Date());
}

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
async function humanType(loc, text) {
  const str = String(text);
  try {
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    await sleep(rand(120, 380));            // glance at the field before clicking
    await humanClick(loc, { timeout: 4000 });
    await sleep(rand(90, 260));             // settle after focus
    // Clear any pre-filled value before typing — and VERIFY it went. This is
    // load-bearing: pressSequentially() appends, so typing into a field that
    // still holds a value (Ashby/Greenhouse "autofill from resume" populates
    // the form in Phase A, browser autofill, or an earlier fillFields pass
    // after a "Re-scanner") writes the answer twice. fill('') is a silent
    // no-op on several controlled/rich-text editors, so when it does not take
    // effect, replace the content wholesale instead of appending to it.
    if (!(await clearField(loc))) {
      try { await loc.fill(str, { timeout: 5000 }); } catch { return false; }
      return await fieldMatchesAnswer(loc, str);
    }
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
  if (await fieldMatchesAnswer(loc, str)) return true;
  try { await loc.fill(str, { timeout: 5000 }); } catch { return false; }
  return await fieldMatchesAnswer(loc, str);
}

let shotCount = 0;
async function screenshot(page, label) {
  try {
    shotCount += 1;
    const name = `shot-${String(shotCount).padStart(2, '0')}-${label}.png`;
    await page.screenshot({ path: join(RUN_DIR, name), fullPage: false });
    state.screenshots.push(name);
    writeState();
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
        // Mask the most obvious automation signals before any page script runs:
        // navigator.webdriver=true is the #1 bot tell Playwright exposes.
        await ctx.addInitScript(() => {
          try {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            if (!navigator.languages || !navigator.languages.length) {
              Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
            }
            window.chrome = window.chrome || { runtime: {} };
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

async function detectBlocker(page) {
  // Scan every frame, not just the top page: some ATS embed the whole
  // application form (and any captcha rendered inside it) in a cross-origin
  // iframe that top-level page.evaluate() can never see into. Playwright's
  // frame.evaluate() runs inside each frame's own execution context, so it
  // works regardless of origin.
  const mainFrame = page.mainFrame();
  for (const frame of page.frames()) {
    if (frame.isDetached()) continue;
    try {
      const found = await frame.evaluate(blockerProbe, { ...BLOCKER_PROBE_ARGS, isMainFrame: frame === mainFrame });
      if (found) return found;
    } catch { /* frame navigating/detached mid-check — skip, next poll retries */ }
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

function isHimalayasApply() {
  return isHimalayasHost(spec.jobUrl);
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
      if (!stillBlocked || (stillBlocked !== 'captcha' && stillBlocked !== 'cloudflare')) return true;
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

async function tryAutoSolveBlocker(context, page, blocker, phase = 'navigation') {
  if ((blocker === 'login' || blocker === 'auth_wall')
      && shouldEnsureHimalayasSession({ jobUrl: spec.jobUrl, currentUrl: page.url() })) {
    return ensureHimalayasSession(context, page);
  }
  return solvePinchtabChallenge(context, page, blocker, phase);
}

// ── Apply navigation: follow links/redirects until a real form is reached ─────

const APPLY_TEXT_RE = /^(apply(\s+(now|here|for|to)\b.*)?|postuler.*|candidater.*|d[ée]poser (ma |une )?candidature|easy apply|i'?m interested|apply for this (job|position|role)|soumettre|submit application|apply on company (web)?site)$/i;

// Interstitial modals between the job page and the real form (e.g. Jobicy's
// "Sign Up and Apply / Continue as Guest") — always pick the no-account path.
// GUEST_TEXT_RE lives in lib/form-detect.mjs alongside AUTH_AVOID_TEXT_RE, so
// the "take this path" and "never take that path" vocabularies stay in sync.
const CONTINUE_TEXT_RE = GUEST_TEXT_RE;

// Multi-step wizard progression (when there is NO form on the page yet): landing
// pages, "start application" splash screens, intro steps before the real form.
const PROGRESS_TEXT_RE = /^(continue|next|next step|start( your)?( application)?|get started|begin( application)?|proceed|go to application|apply for this (job|position|role)|view application|start now|commencer|continuer|suivant|[ée]tape suivante|d[ée]marrer|acc[ée]der au formulaire)$/i;

function normalizeAtsUrl(url) {
  // Insert the apply segment into the PATHNAME (not the raw string): appending
  // to a URL that carries a query string (e.g. Lever's ?ref=…) would glue
  // "/apply" onto the query value and produce a broken URL that reloads the
  // job page forever.
  try {
    const u = new URL(url);
    const host = u.hostname;
    const p = u.pathname.replace(/\/$/, '');
    if (/jobs\.lever\.co$/.test(host) && /\/[0-9a-f-]{36}$/i.test(p)) {
      u.pathname = p + '/apply';
      return u.toString();
    }
    if (/jobs\.ashbyhq\.com$/.test(host) && !/\/application/.test(p)) {
      u.pathname = p + '/application';
      return u.toString();
    }
    if (/apply\.workable\.com$/.test(host) && /\/j\//.test(p) && !/\/apply$/.test(p)) {
      u.pathname = p + '/apply';
      return u.toString();
    }
  } catch { /* keep original */ }
  return url;
}

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
  let authWall = null;
  for (const frame of page.frames()) {
    if (frame.isDetached()) continue;
    const r = await probeFrameForm(frame);
    if (r.verdict === 'application_form') {
      dbg(`formulaire détecté (score ${r.score}: ${r.signals.join(', ')})`);
      return { frame, authWall: null };
    }
    if (r.verdict === 'auth_wall' && !authWall) authWall = r;
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
  const url = page.url();
  const skip = attempted ? [...attempted].filter(k => k.startsWith(url + '::')).map(k => k.slice((url + '::').length)) : [];
  // Let sticky headers, lazy CTAs and client-side route data settle before
  // concluding that the page has no progression control. Many ATS pages only
  // reveal the real Apply button after a human-like scroll.
  await page.mouse.wheel(0, 650).catch(() => {});
  await sleep(900);
  const marked = await page.evaluate(MARK_PROGRESSION_CONTROLS, {
    reSrc: textRe.source,
    skip,
    avoidSrc: AUTH_AVOID_TEXT_RE.source,
  });
  if (!marked.length) {
    await page.mouse.wheel(0, -500).catch(() => {});
    await sleep(700);
    const retry = await page.evaluate(MARK_PROGRESSION_CONTROLS, {
      reSrc: textRe.source,
      skip,
      avoidSrc: AUTH_AVOID_TEXT_RE.source,
    });
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
  const observed = await transition;
  if (!clicked) return null;
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

async function reachApplicationForm(context, page) {
  // Walk through any number of intermediate pages (aggregator redirect → job
  // page → "apply" → guest modal → wizard "next/start" → form). Each hop:
  // detect blocker, look for the real form, else normalize the ATS URL, else
  // click the highest-priority progression control we haven't tried yet.
  const attempted = new Set();
  const inspectedUrls = new Set();

  // Himalayas: establish session BEFORE trying Apply (login → captcha → job).
  // Only while still on himalayas.app — never after redirect to the employer ATS.
  if (shouldEnsureHimalayasSession({ jobUrl: spec.jobUrl, currentUrl: page.url() })) {
    if (!(await ensureHimalayasSession(context, page))) {
      return { page, frame: null, blocker: 'login' };
    }
  }

  for (let hop = 0; hop < 15; hop++) {
    state.currentUrl = page.url();
    writeState();

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

    // An auth wall is NOT the form. On Himalayas there is no guest apply —
    // force the login preamble. Elsewhere try the no-account path first.
    if (authWall) {
      if (shouldEnsureHimalayasSession({ jobUrl: spec.jobUrl, currentUrl: page.url() })) {
        log(`Mur Himalayas (${authWall.blockers.join(', ')}) — connexion obligatoire.`);
        if (await ensureHimalayasSession(context, page)) continue;
        return { page, frame: null, blocker: 'login' };
      }
      log(`Mur d'inscription/connexion détecté (${authWall.blockers.join(', ')}) — recherche d'un accès invité.`);
      const guest = await clickApplyAndFollow(context, page, GUEST_TEXT_RE, attempted);
      if (guest) { page = guest; continue; }
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

const STOPWORDS = new Set(['the', 'a', 'an', 'to', 'of', 'in', 'for', 'and', 'or', 'you', 'your', 'is', 'are', 'do', 'does', 'this', 'that', 'with', 'us', 'we', 'at', 'on', 'what', 'why', 'how', 'about', 'tell', 'please', 'would', 'be', 'it', 'le', 'la', 'les', 'de', 'des', 'un', 'une', 'vous', 'pour', 'et']);

// Job-domain nouns that appear in nearly EVERY question on an application form
// and therefore carry no power to tell two questions apart. Without this, a
// single shared "role" was enough to score 0.5 and clear the 0.4 threshold:
// "What is your current role?" {current, role} matched "How did you hear about
// this role?" {did, hear, role} and the form was submitted with the
// how-did-you-hear answer in the current-role box. Dropping these leaves only
// the words that actually discriminate ("interested", "hear", "experience").
const GENERIC_TERMS = new Set(['role', 'roles', 'position', 'positions', 'job', 'jobs', 'company', 'companies', 'work', 'working', 'poste', 'entreprise', 'travail']);

function tokens(s) {
  return new Set(String(s).toLowerCase().replace(/[^a-z0-9àâéèêëîïôùûüç\s]/gi, ' ').split(/\s+/).filter(w => w.length > 2 && !STOPWORDS.has(w) && !GENERIC_TERMS.has(w)));
}

function similarity(a, b) {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.min(ta.size, tb.size);
}

function bestAnswerFor(label, answers, usedAnswers = new Set()) {
  // Prefer an unused answer when scores are close, so two similar questions
  // ("why us?" / "why this role?") don't get the exact same text.
  const scored = answers
    .map(qa => ({ qa, s: similarity(label, qa.question) }))
    .filter(x => x.s >= 0.4)
    .sort((a, b) => b.s - a.s);
  if (!scored.length) return null;
  const fresh = scored.find(x => !usedAnswers.has(x.qa.question) && x.s >= scored[0].s - 0.2);
  if (fresh) return fresh.qa;
  // The best match was already consumed by an earlier (similar) question. Don't
  // reuse it verbatim — return null so this field goes to the LLM resolver,
  // which writes a distinct answer for its specific angle.
  if (usedAnswers.has(scored[0].qa.question)) return null;
  return scored[0].qa;
}

function classifyField(f, spec, usedAnswers = new Set()) {
  const s = `${f.label} ${f.name} ${f.idAttr}`.toLowerCase();
  const id = spec.identity;

  if (f.type === 'file') {
    if (/cover|lettre/.test(s)) return { skip: 'cover letter file (non géré)' };
    return { upload: spec.cvPath };
  }
  // "Resume/CV" textarea (alternative to the file upload) → paste the CV text.
  if (f.tag === 'textarea' && /resume|curriculum|\bcv\b/.test(s) && !/cover|lettre|why|describe|experience/.test(s)) {
    return { resume: true };
  }
  // Sensitive EEO questions stay blank (usually optional / "prefer not to say").
  // Pronouns are handled separately: many ATS make them required. \bage\b is
  // word-boundary anchored so it doesn't false-positive on "message",
  // "manage", "package", "language" (seen in the wild: Ashby's optional
  // "Diversity Survey" section asks "What is your current age?").
  // A gender declared in profile.yml is an answer the candidate chose to give,
  // so use it instead of declining. Scoped to the gender question itself: the
  // LGBTQIA+ question also contains "transgender", and race/veteran/disability
  // stay blank regardless.
  const asksGender = /\bgender\b|\bsexe\b|\bgenre\b/.test(s)
    && !/lgbt|transgender community|identify as part of|race|ethnic/.test(s);
  if (asksGender && id.gender) return { value: id.gender, selectText: id.gender };
  if (/gender|race|ethnic|veteran|disab|diversity|origine|sexe|\bage\b|date of birth|birth\s*date/.test(s) && !/pronoun/.test(s)) {
    // declinePreferred: if this turns out to be required, prefer the
    // dropdown's own decline/non-disclosure option over skipping outright —
    // see fillDeclineDropdown / DECLINE_RE.
    return { skip: 'question démographique (laissée vide)', declinePreferred: true };
  }

  if (f.type === 'checkbox') {
    // Optional consents are only ticked when the user opted in for this run
    // (spec.consentOptIn) — agreeing to data retention or future contact on
    // someone's behalf is never a silent default.
    const isConsent = /privacy|consent|gdpr|rgpd|terms|conditions|politique de confidentialité|j'accepte|i (agree|consent|acknowledge)/.test(s);
    if (isConsent && (f.required || spec.consentOptIn)) return { check: true };
    // A REQUIRED checkbox that isn't a consent is a factual claim to confirm
    // ("Have you ever designed a product that leverages AI?"). Skipping it left
    // a mandatory field blank on n8n's form; hand it to the resolver, which
    // reads the CV and answers yes/no.
    if (f.required) return null;
    return { skip: 'checkbox non requise' };
  }

  const m = (re) => re.test(s);
  // visa/sponsorship BEFORE country/location: these questions usually contain
  // the word "country" ("…require sponsorship to work in the country…").
  // "authorized/eligible to work WITHOUT sponsorship?" is an eligibility yes →
  // must be caught before the generic sponsorship rule flips it to No.
  if (m(/without[^.?]{0,25}sponsor/)) {
    return { yesNo: id.needsSponsorship ? 'no' : 'yes', selectText: id.needsSponsorship ? 'No' : 'Yes', value: id.visaStatus };
  }
  // "require sponsorship / a visa transfer / a work permit" → No (he never does)
  if (m(/sponsor|visa transfer|transfer.*visa|requir[a-z]*[^.?]*\b(visa|work permit|work authori[sz])/)) {
    return { yesNo: id.needsSponsorship ? 'yes' : 'no', selectText: id.needsSponsorship ? 'Yes' : 'No', value: id.visaStatus };
  }
  // "are you legally eligible / authorized / have the right to work" → Yes
  if (m(/visa|work authori[sz]|right to work|legally (entitled|authori[sz]ed)|eligible to work|permis de travail|authori[sz]ed to work/)) {
    return { yesNo: id.needsSponsorship ? 'no' : 'yes', selectText: id.needsSponsorship ? 'No' : 'Yes', value: id.visaStatus };
  }
  if (m(/relatives?|family member/)) return { yesNo: 'no', value: 'No' };
  if (m(/pronoun/)) {
    const p = (id.pronouns || '').toLowerCase();
    return p ? { value: id.pronouns, selectText: p.split('/')[0] || id.pronouns } : { skip: 'pronoms (laissés vides)' };
  }
  if (m(/non-?compete|non-?competition|non-concurrence/)) return { yesNo: 'no', selectText: 'No' };
  // "select the status that allows you to work and live in that country" — work
  // eligibility status (distinct from the plain yes/no eligibility question).
  if (m(/status that allows you to (work|live)|allows you to (work|live) and (work|live)|immigration status|residency status/)) {
    const asia = spec.region === 'asia';
    return { value: asia ? 'Work VISA' : 'Citizen', selectText: asia ? 'Work VISA' : 'Citizen' };
  }
  // consent to interview recording / transcription (Brighthire etc.) → yes
  if (m(/consent.*(record|using this tool|transcri)|brighthire|record.*(interview|transcri)/)) {
    return { yesNo: 'yes', selectText: 'Yes' };
  }
  // Same opt-in as the checkbox rule above, for ATS that render their consents
  // as a yes/no group instead of a tickbox.
  if (spec.consentOptIn && m(/consent|do you agree|j'accepte|autoris|storing your|store your (information|data)|contact you about/)) {
    return { yesNo: 'yes', selectText: 'Yes', value: 'Yes' };
  }
  // Demographic self-ID consent: we leave the EEO fields blank, so decline the
  // consent to process self-identification data (coherent + privacy-preserving).
  if (m(/self-?identification data|consent.*self-?identif/)) {
    return { value: "I don't wish to answer", selectText: "don't wish" };
  }
  // California "Notice at Collection" — Hugo is not a California resident.
  if (m(/california/)) return { value: 'I am not a California resident', selectText: 'not a California resident' };
  // single-option acknowledgement selects (privacy notice, data-protection notice)
  if (m(/privacy notice|notice at collection|acknowledge|data (privacy|protection) notice/)) {
    return { value: 'Acknowledge', selectText: 'Acknowledge' };
  }
  if (m(/preferred\s*name|nickname|nom pr[ée]f[ée]r/)) return { value: id.firstName };
  // Combined single-input name field ("First and last name"): must be caught
  // before the first/last rules below, which both match it — the last-name rule
  // won on n8n's form and the application went out signed "Vermot".
  if (m(/first\s*(name)?\s*(and|&|\/|\+|et)\s*last\s*name|last\s*(name)?\s*(and|&|\/|\+|et)\s*first\s*name|pr[ée]nom et nom|nom et pr[ée]nom/)) {
    return { value: id.fullName };
  }
  if (m(/first\s*name|pr[ée]nom|given name/)) return { value: id.firstName };
  if (m(/last\s*name|family name|surname|nom de famille/)) return { value: id.lastName };
  if (m(/full\s*name|your name|^name\b|legal name|^nom\b/) && !m(/company|file/)) return { value: id.fullName };
  if (m(/e-?mail|courriel/)) return { value: id.email };
  if (m(/phone|t[ée]l[ée]phone|mobile/)) return { value: id.phone, optionalEmpty: !id.phone };
  if (m(/linkedin/)) return { value: id.linkedin };
  if (m(/github/)) return { value: id.github };
  // Must come BEFORE the generic portfolio/website/URL catch-all below: its
  // bare \burl\b match would otherwise swallow "Twitter URL" too and hand it
  // the portfolio link instead (a real bug found in live testing).
  if (m(/twitter|\bx\.com\b/)) return { value: id.twitter, optionalEmpty: !id.twitter };
  // Credentials are never ours to type. Ashby's "Password to portfolio link (if
  // applicable)" sits right next to the portfolio field and matched the URL rule
  // below, so the live run pasted the portfolio URL into it as a password.
  if (f.type === 'password' || m(/password|mot de passe|passcode|pass ?phrase/)) {
    return { skip: 'champ mot de passe (jamais rempli automatiquement)' };
  }
  // "Additional portfolio link (if applicable)" is a SECOND slot, not a repeat
  // of the first — filling both with the same URL is visible sloppiness. Offer
  // the other public profile if there is one, else leave it blank.
  if (m(/(additional|autre|second|other)\b/) && m(/portfolio|website|link|lien|\burl\b/)) {
    return id.github ? { value: id.github } : { skip: 'lien supplémentaire (laissé vide)' };
  }
  if (m(/portfolio|website|site (web|internet)|personal site|\burl\b/)) return { value: id.portfolio };
  // Word-boundary anchored: a bare /location/ also matches "reLOCATION", so
  // "This role requires relocation to Bangkok — are you open to it?" was being
  // classified as a city field and answered with the candidate's address
  // instead of Yes/No (caught by live tracing: the runner typed "Bangkok,
  // Thailand" into a Yes/No dropdown). Same reasoning for \bcity\b, which
  // otherwise matches "capaCITY".
  if (m(/current location|where (are you|do you) (based|live)|\bcity\b|\bville\b|\blocation\b|\baddress\b|\badresse\b/)) return { value: id.location };
  if (m(/country|pays/)) return { value: id.country, selectMatch: id.country };
  if (m(/time\s*zone|fuseau/)) return { value: id.timezone };
  if (m(/salary|compensation|r[ée]mun[ée]ration|expected pay|pay expectation|pretension|daily rate|tjm/)) {
    // A Section F draft written for THIS question beats the raw profile string
    // ("EUR70K-110K salary / EUR600-900/day freelance" reads like a config
    // value, which is exactly what got typed into Kittl's form).
    const qa = bestAnswerFor(f.label, spec.answers, usedAnswers);
    return qa ? { value: polishApplicationAnswer(qa.answer), fromQuestion: qa.question } : { value: id.salary };
  }
  if (m(/notice period|pr[ée]avis/)) return { value: id.noticePeriod };
  if (m(/start date|available (to start|from)|disponibilit|when can you start/)) return { value: id.startDate, dateISO: id.startDateISO };
  // Bare "source"/"referr" substrings used to false-positive on unrelated
  // fields (any label/name/id containing "resource", "preferred", etc.) —
  // require the fuller phrase instead.
  if (m(/how did you (hear|find)|where did you (hear|find)|referral source|how you (heard|found)|comment avez-vous (entendu|trouv[ée])/)) return { value: id.howDidYouHear, selectText: 'Other', selectPrefer: /other|job board|search|website|autre/i };
  if (m(/reference/) && !m(/referr/)) return { value: id.references };

  // Factual yes/no questions ("Do you…", "Have you…") must never receive a
  // Section F motivation answer, even when token overlap is high (company
  // name + "work" match "why do you want to work at …"). Strip any leading
  // numbering / asterisk / bullet so "* Do you…" or "1. Have you…" still match.
  const cleanLabel = (f.label || '').replace(/^[\s*••\-–—.)\d:]+/, '').trim();
  if (/^(do|did|does|have|has|are|were|will|would|can|is) (you|your)\b/i.test(cleanLabel)) return null;

  // A Section F answer is a paragraph of prose, so it can never be a valid
  // value for a closed-option widget — a <select>, radio group, or react-select
  // combobox only accepts one of its OWN options. Live tracing caught a
  // three-sentence motivation answer being typed into a Yes/No dropdown
  // ("This role requires relocation to Bangkok…"), which matched nothing.
  // Send these to the LLM resolver instead: it gets the real scraped option
  // list and picks a genuine option.
  if (f.tag === 'select' || f.type === 'radio' || isComboboxField(f)) return null;

  // Free-text questions → Section F answers
  const qa = bestAnswerFor(f.label, spec.answers, usedAnswers);
  if (qa) return { value: polishApplicationAnswer(qa.answer), fromQuestion: qa.question };
  if (m(/cover letter|lettre de motivation|motivation|why (do you want|are you interested|us|join)/) && spec.answers.length) {
    const motiv = spec.answers.slice(0, 2).map(a => a.answer).join('\n\n');
    return { value: polishApplicationAnswer(motiv), fromQuestion: 'cover letter (combinaison des réponses F)' };
  }
  return null; // unknown → left for human
}

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
const DECLINE_RE = /prefer not|decline|not to disclose|don.?t wish|rather not (to )?(say|answer|disclose)|not to (answer|say|respond|specify)|choose not to|no,? i (do not|don.t)|would rather not|not (to )?(self.?identify|specify)/i;

function pickDeclineOption(options) {
  const usable = options.filter(o => o.text && !/^(select|choose|--|please|sélection)/i.test(o.text.trim()));
  return usable.find(o => DECLINE_RE.test(o.text)) || null;
}

function pickSelectOption(options, plan, fieldLabel) {
  const lower = (t) => t.toLowerCase();
  const usable = options.filter(o => o.text && !/^(select|choose|--|please|sélection)/i.test(o.text.trim()));
  if (plan.yesNo) {
    // word-boundary anchored so "None of the above" is NOT matched as "No"
    const target = plan.yesNo === 'yes' ? /^(yes|oui|y)\b/i : /^(no|non|n)\b/i;
    const opt = usable.find(o => target.test(o.text.trim()));
    if (opt) return opt;
  }
  if (plan.selectPrefer) {
    const opt = usable.find(o => plan.selectPrefer.test(o.text));
    if (opt) return opt;
  }
  const needle = lower(plan.selectMatch || plan.selectText || plan.value || '');
  if (needle) {
    const exact = usable.find(o => lower(o.text) === needle);
    if (exact) return exact;
    // Word-boundary pass before the loose one: a bare `includes` picks "Female"
    // for "Male" (and "Non-binary" for "No"), silently answering the opposite
    // of what was asked.
    const bounded = new RegExp(`(^|\\W)${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\W|$)`);
    const word = usable.find(o => bounded.test(lower(o.text)));
    if (word) return word;
    const contains = usable.find(o => lower(o.text).includes(needle) || needle.includes(lower(o.text)));
    if (contains) return contains;
  }
  // A field asking to "decline"/"prefer not to say" that didn't match by text
  // still deserves the decline option over being left unfilled.
  if (plan.declinePreferred) {
    const decline = pickDeclineOption(usable);
    if (decline) return decline;
  }
  // Exactly one real (non-placeholder) choice exists — nothing to disambiguate,
  // so take it rather than fail a field that structurally can't be answered
  // any other way (single-option acknowledgement/consent selects).
  if (usable.length === 1) return usable[0];
  return null;
}

// Read the currently-rendered dropdown options out of the page. Shared by the
// scrape and the select path so both agree on what counts as an option.
function readRenderedOptions() {
  let nodes = [...document.querySelectorAll('[role="option"], [id*="-option-"], [class*="select__option"], li[class*="option"], [class*="-menu"] li, [class*="menuList" i] > *, [class*="menu-list" i] > *')]
    .filter(n => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  nodes = nodes.filter(n => !nodes.some(o => o !== n && n.contains(o))); // leaves only
  const seen = new Set();
  const out = [];
  for (const n of nodes) {
    const t = (n.innerText || '').replace(/\s+/g, ' ').trim();
    if (t && t.length < 120 && !seen.has(t)) { seen.add(t); out.push(t); }
  }
  return out.slice(0, 40);
}

// Open a custom dropdown and scrape its rendered options (react-select, Ashby…)
// so the LLM resolver can pick a valid one. Best-effort; restores closed state.
//
// Polls for the menu instead of sleeping a fixed 700ms, and re-opens once if
// nothing rendered. A single blind sleep made this return [] whenever the
// widget was a beat slow — and an empty option list silently degrades the
// field to "LLM guesses blind", which is exactly how a plain Yes/No dropdown
// ended up unanswerable in live testing despite having an obvious "Yes".
async function scrapeComboboxOptions(frame, f) {
  const loc = frame.locator(`[data-co-i="${f.i}"]`);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await loc.click({ timeout: 3000 });
      // poll up to ~2.4s for the menu to render
      let opts = [];
      for (let i = 0; i < 8; i++) {
        await sleep(300);
        opts = await frame.evaluate(readRenderedOptions);
        if (opts.length) break;
      }
      await loc.press('Escape').catch(() => {});
      dbg(`scrape "${String(f.label).slice(0, 40)}" attempt=${attempt} → ${opts.length} option(s) ${JSON.stringify(opts.slice(0, 6))}`);
      if (opts.length) return opts.map(t => ({ value: t, text: t }));
      await sleep(rand(200, 400)); // let the widget settle before re-opening
    } catch (err) { dbg(`scrape "${String(f.label).slice(0, 40)}" threw: ${String(err.message || err).slice(0, 60)}`); return []; }
  }
  return [];
}

// Open → type → click a searchable dropdown. hadOptions is decided from the
// menu after click (or a 2-char typeahead reveal), never by typing the answer
// into a plain text field. Known comboboxes retry once if the first open
// found nothing; speculative probes do not.
async function selectComboboxOption(frame, f, query) {
  const first = await selectComboboxOptionOnce(frame, f, query);
  if (first.matched || first.hadOptions) return first;
  if (!isComboboxField(f)) return first;
  await sleep(rand(250, 500));
  const second = await selectComboboxOptionOnce(frame, f, query);
  return { matched: second.matched, hadOptions: second.hadOptions || first.hadOptions };
}

async function nearbyOptionSnapshot(frame, i) {
  return await frame.evaluate(COMBOBOX_OPTION_QUERY, { mode: 'snapshot', i, allowGlobal: false })
    .catch(() => ({ count: 0, sig: '' }));
}

async function pollUntil(fn, times, lo, hi) {
  for (let n = 0; n < times; n++) {
    await sleep(rand(lo, hi));
    if (await fn()) return true;
  }
  return false;
}

async function selectComboboxOptionOnce(frame, f, query) {
  const loc = frame.locator(`[data-co-i="${f.i}"]`);
  const q = String(query).slice(0, 60);
  const known = isComboboxField(f);
  try {
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    await sleep(rand(120, 320));
    const before = await nearbyOptionSnapshot(frame, f.i);
    await humanClick(loc, { timeout: 4000 }).catch(() => {});

    const menuOpened = async () => {
      const snap = await nearbyOptionSnapshot(frame, f.i);
      return snap.count > 0 && snap.sig !== before.sig;
    };
    let hadOptionsOnOpen = await pollUntil(menuOpened, 5, 200, 320);

    let typedPrefix = '';
    if (!hadOptionsOnOpen && !known) {
      if (looksLikeTypeahead(f) && q.length >= 2) {
        await loc.fill('').catch(() => {});
        typedPrefix = q.slice(0, 2);
        await loc.pressSequentially(typedPrefix, { delay: rand(55, 130) }).catch(() => {});
        hadOptionsOnOpen = await pollUntil(menuOpened, 5, 180, 280);
        if (!hadOptionsOnOpen) {
          await clearField(loc);
          await loc.press('Escape').catch(() => {});
          dbg(`combobox "${String(f.label).slice(0, 40)}" typeahead reveal: no menu after "${typedPrefix}" → not a list`);
          return { matched: null, hadOptions: false };
        }
      } else {
        await loc.press('Escape').catch(() => {});
        dbg(`combobox "${String(f.label).slice(0, 40)}" speculative probe: no menu after click → not a list`);
        return { matched: null, hadOptions: false };
      }
    }

    const rest = q.slice(typedPrefix.length);
    if (!typedPrefix) await loc.fill('').catch(() => {});
    if (rest) {
      await loc.pressSequentially(rest, { delay: rand(55, 130) }).catch(() => loc.fill(q).catch(() => {}));
    }
    await sleep(rand(700, 1100));

    const result = await frame.evaluate(COMBOBOX_OPTION_QUERY, { mode: 'match', want: q, i: f.i, allowGlobal: known });
    dbg(`combobox "${String(f.label).slice(0, 40)}" q="${q}" openHadOpts=${hadOptionsOnOpen} count=${result.count} matched=${result.matched} seen=${JSON.stringify(result.seen)}`);

    const hadOptions = hadOptionsOnOpen || result.count > 0;
    const abandon = async (had) => {
      await loc.press('Escape').catch(() => {});
      await clearField(loc);
      return { matched: null, hadOptions: had };
    };
    if (result.matched) {
      try {
        await humanClick(frame.locator('[data-co-opt="1"]'), { timeout: 3000 });
        const ok = await comboboxSelectionRegistered(frame, f);
        dbg(`  → clicked "${result.matched}", registered=${ok}`);
        if (ok) return { matched: result.matched, hadOptions: true };
        return abandon(true);
      } catch (err) {
        dbg(`  → click failed: ${String(err.message || err).slice(0, 60)}`);
        return abandon(hadOptions);
      }
    }
    if (result.count === 1) {
      await loc.press('Enter').catch(() => {});
      const ok = await comboboxSelectionRegistered(frame, f);
      if (ok) return { matched: q, hadOptions: true };
      return abandon(true);
    }
    return abandon(hadOptions);
  } catch {
    return { matched: null, hadOptions: false };
  }
}

// Confirms a combobox click actually registered as a real selection, not just
// leftover typed text sitting in the filter input. When the widget exposes the
// react-select-style hidden "required" shadow input, its value is the ground
// truth (only set on a genuine onChange); otherwise fall back to trusting the
// click (no shadow input to check against).
async function comboboxSelectionRegistered(frame, f) {
  const probe = async () => {
    try {
      return await frame.evaluate((i) => {
        const el = document.querySelector(`[data-co-i="${i}"]`);
        if (!el) return true;
        // Walk up looking for the shadow input as a DESCENDANT at each level —
        // matches collectFields()'s logic; el.closest(selectorList) would stop
        // at the nearest wrapper class match, which can sit below the shadow
        // input's real parent and silently miss it.
        let shadow = null;
        let node = el.parentElement;
        for (let d = 0; d < 6 && node; d++, node = node.parentElement) {
          shadow = node.querySelector('input[aria-hidden="true"][required], [class*="requiredInput" i]');
          if (shadow) break;
        }
        if (!shadow) return true; // no shadow input on this widget → trust the click
        return !!(shadow.value || '').trim();
      }, f.i);
    } catch { return true; }
  };
  // React's onChange → shadow-input update isn't always synchronous with the
  // click resolving — retry briefly before concluding the selection failed,
  // rather than flagging a genuinely-fine field as broken from a one-shot
  // check that ran a beat too early.
  if (await probe()) return true;
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

// A field is multi-select when the DOM says so OR the label asks for several
// ("select up to 3", "select all that apply"). Kept in sync with the same
// heuristic in lib/apply-llm.mjs so the model's array answers map correctly.
function fieldIsMulti(f) {
  return !!f.multiple || /\b(select|choose).{0,20}(all|up to|that apply|multiple|[2-9])\b/i.test(f.label || '');
}

// Select one option of a radio group. Playwright's own check()/click() can't be
// used here: the native input is usually invisible (styled proxy on top), and
// forcing a click at its coordinates would hit whatever is painted over it.
// An in-page .click() toggles the real input and still fires the events React &
// co. listen to. Returns true only once the input reports itself checked, so a
// click a controlled component ignored is reported as a failure, not a success.
async function clickRadioOption(frame, f, want, isYesNo = false) {
  return await frame.evaluate(({ name, want, isYesNo, options }) => {
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
    const yesNoMatch = (t) => (wanted === 'yes' && /^(yes|oui|true)/.test(t)) || (wanted === 'no' && /^(no|non|false)/.test(t));
    const activate = (el) => {
      if (!el) return false;
      el.click();
      if (el.hasAttribute('aria-pressed')) return el.getAttribute('aria-pressed') === 'true';
      if (!(el.checked || el.getAttribute('aria-checked') === 'true') && el.id) {
        document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.click();
      }
      return !!(el.checked || el.getAttribute('aria-checked') === 'true');
    };
    // Prefer the markers stamped during collectFields — they survive nameless
    // radios and [role=radio] widgets that a name= selector would miss.
    const fromKeys = (options || []).map(o => {
      const el = o.key ? document.querySelector(`[data-co-opt="${o.key}"]`) : null;
      return el ? { el, text: norm(o.text || '') } : null;
    }).filter(Boolean);
    const live = fromKeys.length ? fromKeys : (name ? [...document.querySelectorAll(
      `input[type="radio"][name="${CSS.escape(name)}"]`,
    )].map((r) => {
      const lbl = r.id ? document.querySelector(`label[for="${CSS.escape(r.id)}"]`) : null;
      return { el: r, text: norm(lbl?.innerText || r.closest('label')?.innerText || r.value) };
    }) : []);
    if (isYesNo) {
      const hit = live.find(o => yesNoMatch(o.text));
      return !!hit && activate(hit.el);
    }
    for (const pass of passes) {
      const hit = live.find(o => o.text && pass(o.text));
      if (hit && activate(hit.el)) return true;
    }
    return false;
  }, { name: f.name, want, isYesNo, options: f.options || [] });
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
    const matchesOwnOption = own.length > 6 && (own.includes(answer) || answer.includes(own));
    if (!affirmative && !matchesOwnOption) return false;
    return (await checkBox(frame, f)) ? '☑' : false;
  }

  const knownCombobox = isComboboxField(f);
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
  const typed = await humanType(loc, text);
  if (!typed) return false;
  return text.length > 70 ? text.slice(0, 70) + '…' : text;
}

function llmKind(f) {
  if (f.tag === 'select' || isComboboxField(f)) return 'dropdown';
  if (f.type === 'radio') return 'choice';
  if (f.type === 'textarea') return 'long text';
  return 'short text';
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
  for (let pass = 0; pass < 4; pass++) {
    const fileFields = (await collectFields(frame)).filter(f => f.type === 'file');
    const todo = fileFields.find(f => !doneFiles.has((f.label || f.name || 'file').slice(0, 80)));
    if (!todo) break;
    const labelShort = (todo.label || todo.name || 'file').slice(0, 80);
    doneFiles.add(labelShort);
    const plan = classifyField(todo, spec);
    if (!plan || plan.skip) {
      if (todo.required) pending.push({ label: labelShort, reason: plan?.skip || 'fichier non géré' });
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
      filled.push({ label: labelShort, value: `📎 ${plan.upload.split('/').pop()}` });
      uploaded = true;
      await sleep(5000); // let the ATS process this upload before touching the next field
    } catch (err) {
      if (todo.required) pending.push({ label: labelShort, reason: `upload échoué: ${String(err.message || err).slice(0, 60)}` });
    }
  }
  if (uploaded) await sleep(5000); // extra settle: resume parsing may still be re-rendering

  // Phase B — re-collect (fresh markers after any re-render) and fill the rest
  const fields = await collectFields(frame);
  const usedAnswers = new Set();

  let actedCount = 0;
  for (const f of fields) {
    if (f.type === 'file') continue;
    const sel = `[data-co-i="${f.i}"]`;
    const loc = frame.locator(sel);
    const plan = classifyField(f, spec, usedAnswers);
    if (plan?.fromQuestion) usedAnswers.add(plan.fromQuestion);
    // brief pause between fields so the form isn't completed in one instant
    // burst (humans move/read between fields); skip before the very first action
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
          else if (f.required) unresolved.push(f);
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
      if (isComboboxField(f)) {
        // searchable dropdown (Ashby, Greenhouse new UI): type the query, then
        // CLICK the matching option. selectText = the short query that filters
        // to the right option; fall back to the yes/no literal, then free text.
        const query = plan.selectText
          || (plan.yesNo ? (plan.yesNo === 'yes' ? 'Yes' : 'No') : value.slice(0, 60));
        if (!query) {
          if (f.required) unresolved.push(f);
          continue;
        }
        const { matched } = await selectComboboxOption(frame, f, query);
        if (matched) filled.push({ label: labelShort, value: matched });
        else if (f.required) unresolved.push(f); // couldn't confirm a real option → LLM/human
        continue;
      }
      if (!value) {
        if (f.required && !plan.optionalEmpty) unresolved.push(f);
        continue;
      }
      // Already filled? Compare against the polished text too — that is what
      // actually gets typed, so comparing only the raw plan value let a second
      // pass (re-scan, blocker resolved) re-type a field it had just filled.
      const textValue = polishApplicationAnswer(value);
      const current = (f.value || '').trim();
      if (current && (current === value.trim() || current === textValue.trim())) continue;

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
      const typed = await humanType(loc, textValue);
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

  // "Tick all that apply" groups expose every option as its own field with the
  // SAME label, and the resolver answers only the ones that actually apply. The
  // unanswered siblings of an option we did tick are not gaps to fix by hand —
  // reporting them made a complete n8n form look like it had 5 missing fields.
  const filledLabels = new Set(filled.map(f => f.label));
  return { filled, pending: pending.filter(p => !filledLabels.has(p.label)) };
}

// Re-read missing fields and validation errors after filling or manual edits.
async function remainingCompletionIssues(frame) {
  try {
    const fields = await collectFields(frame);
    return fields.flatMap(f => {
      const reason = fieldCompletionIssue(f);
      return reason ? [{ label: (f.label || f.name || f.type).slice(0, 80), reason }] : [];
    });
  } catch (err) {
    // Never fail silently: an exception here used to return "nothing missing",
    // which reads exactly like a clean form.
    log(`Vérification des champs requis impossible (${String(err.message || err).slice(0, 60)}) — relis le formulaire dans Chrome.`);
    return [{ label: 'vérification des champs requis', reason: 'échec du contrôle — relire le formulaire' }];
  }
}

// ── Submit ────────────────────────────────────────────────────────────────────

const SUBMIT_TEXT_RE = /^(submit( application)?|send( application)?|envoyer( ma candidature)?|postuler|apply|soumettre|finish|valider)$/i;

async function clickSubmit(frame, page) {
  // Same normalized-innerText matching as clickApplyAndFollow (hasText regex
  // breaks on un-trimmed textContent). Text match first, then any [type=submit].
  const found = await frame.evaluate((reSrc) => {
    document.querySelectorAll('[data-co-submit]').forEach(el => el.removeAttribute('data-co-submit'));
    const re = new RegExp(reSrc, 'i');
    const txt = (el) => ((el.innerText || el.value || '')).replace(/\s+/g, ' ').trim();
    const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 5 && r.height > 5 && !el.disabled; };
    const all = [...document.querySelectorAll('button, input[type="submit"], input[type="button"]')].filter(visible);
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
  if (!found) return false;
  try {
    const loc = frame.locator('[data-co-submit="1"]');
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    await sleep(rand(200, 600)); // brief pause before the irreversible click, as if re-checking the form
    await humanClick(loc, { timeout: 6000 });
    log(`Clic sur le bouton d'envoi "${found}"`);
    return true;
  } catch (err) {
    log(`Clic d'envoi raté (${String(err.message || err).slice(0, 60)})`);
    return false;
  }
}

// After clicking submit, tell whether the form REJECTED us (validation errors,
// form still on screen) versus actually went through. Returns the count of
// visible error markers + whether an application form is still present.
async function detectSubmitRejection(page) {
  try {
    return await page.evaluate(() => {
      const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const errRe = /required|invalid|please|select|complete|must |enter |provide |champ|obligatoire|manquant|requis|veuillez|compl[ée]t|remplir|saisir|s[ée]lectionn|invalide/i;
      // Text-bearing error markers…
      const textErrs = [...document.querySelectorAll(
        '.error, .field-error, [class*="error" i], [class*="invalid" i], [role="alert"], [aria-live="assertive"]'
      )].filter(el => visible(el) && errRe.test((el.innerText || '').trim()));
      // …plus fields flagged invalid even when the message is only a red border.
      const invalidFields = [...document.querySelectorAll('[aria-invalid="true"]')].filter(visible);
      // Class-name matching alone misses ATS that hash their CSS modules: Ashby
      // renders "Your form needs corrections / Missing entry for required
      // field: …" in a banner whose class carries no "error" substring, so a
      // bounced submit was reported as "probably sent" (live on n8n).
      const bodyText = (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 6000);
      const bannerRe = /needs? correction|missing entry for required field|please correct|fix the (errors?|following)|corrigez|champs? (obligatoires?|requis) manquants?/i;
      const banner = bodyText.match(bannerRe);
      const errorCount = textErrs.length + invalidFields.length + (banner ? 1 : 0);
      const stillForm = !!document.querySelector('input[type="file"], textarea, select, [role="combobox"]')
        && !!document.querySelector('form');
      let sample = (textErrs[0]?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      if (!sample && banner) sample = bodyText.slice(banner.index, banner.index + 120).trim();
      return { errorCount, stillForm, sample };
    });
  } catch { return { errorCount: 0, stillForm: false, sample: '' }; }
}

async function detectConfirmation(page) {
  try {
    return await page.evaluate(() => {
      const t = (document.body?.innerText || '').toLowerCase().slice(0, 6000);
      return /thank you|application (received|submitted|sent)|we('|’)ve received|successfully (submitted|applied)|merci pour votre candidature|candidature (envoyée|reçue|bien reçue)|your application has been/.test(t);
    });
  } catch { return false; }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function waitForCommand(page, frame, { allowAutoResume = false } = {}) {
  // Poll command.json; if a blocker disappears, signal auto-resume.
  for (;;) {
    const cmd = readCommand();
    if (cmd) return cmd;
    if (allowAutoResume) {
      const blocker = await detectBlocker(page);
      if (!blocker) return 'rescan';
    }
    state.currentUrl = page.url();
    writeState();
    await sleep(1500);
  }
}

async function main() {
  writeState();
  log(`Candidature: ${spec.company} — ${spec.role} [région: ${spec.region === 'asia' ? 'Asie → Bangkok' : 'Europe → Paris'}]`);
  log(`CV: ${spec.cvPath.split('/').pop()} · ${spec.answers.length} réponse(s) pré-écrites`);

  const context = await launchBrowser();
  context.setDefaultTimeout(15000);
  const page = context.pages()[0] || await context.newPage();

  try {
    setState('navigating', `Ouverture de l'offre…`);
    await page.goto(spec.jobUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(3000);

    if (isHimalayasApply()) {
      log('Source Himalayas détectée — séquence login → captcha → Apply.');
      if (!(await ensureHimalayasSession(context, page))) {
        setState('needs_human', '🔐 Connexion Himalayas requise — connecte-toi dans Chrome, puis Re-scanner.');
        const cmd = await waitForCommand(page, null, { allowAutoResume: true });
        if (cmd === 'abort') return finish('aborted', 'Annulé par l\'utilisateur.');
        if (!(await ensureHimalayasSession(context, page))) {
          return finish('needs_human', 'Connexion Himalayas non établie.');
        }
      }
    }

    setState('finding_form', 'Recherche du formulaire de candidature…');
    let { page: formPage, frame, blocker } = await reachApplicationForm(context, page);
    await screenshot(formPage, 'landing');

    let activePage = formPage;

    for (;;) {
      if (blocker) {
        if (await tryAutoSolveBlocker(context, activePage, blocker, 'main-loop')) {
          blocker = null;
          ({ page: activePage, frame, blocker } = await reachApplicationForm(context, activePage));
          continue;
        }
        setState('needs_human', blocker === 'captcha' ? '🤖 Captcha détecté — résous-le dans la fenêtre Chrome.'
          : blocker === 'login' ? '🔐 Connexion requise — connecte-toi dans la fenêtre Chrome.'
          : blocker === 'auth_wall' ? '👤 Ce site exige un compte et ne propose pas d\'accès invité — crée le compte ou connecte-toi dans Chrome, puis clique "Re-scanner".'
          : '🛡️ Protection anti-bot — passe la vérification dans la fenêtre Chrome.');
        const cmd = await waitForCommand(activePage, frame, { allowAutoResume: true });
        if (cmd === 'abort') return finish('aborted', 'Annulé par l\'utilisateur.');
        blocker = null;
        ({ page: activePage, frame, blocker } = await reachApplicationForm(context, activePage));
        continue;
      }

      if (!frame) {
        await screenshot(activePage, 'no-form');
        setState('needs_human', '❓ Formulaire introuvable automatiquement — navigue manuellement jusqu\'au formulaire dans Chrome, puis clique "Re-scanner".');
        const cmd = await waitForCommand(activePage, frame);
        if (cmd === 'abort') return finish('aborted', 'Annulé par l\'utilisateur.');
        // after manual navigation, the form may be in any open tab
        for (const p of context.pages()) {
          const { frame: fr } = await findFormFrame(p);
          if (fr) { activePage = p; frame = fr; break; }
        }
        if (!frame) continue;
      }

      setState('filling', 'Remplissage du formulaire…');
      const { filled, pending } = await fillFields(frame, spec);
      state.filled = filled;
      const completionIssues = await remainingCompletionIssues(frame);
      // Browser validation is authoritative, including fields we just filled.
      const seen = new Set(pending.map(p => p.label));
      for (const r of completionIssues) if (!seen.has(r.label)) pending.push(r);
      state.pending = pending;
      log(`${filled.length} champ(s) rempli(s), ${pending.length} en attente`);
      await screenshot(activePage, 'filled');

      const newBlocker = await detectBlocker(activePage);
      if (newBlocker) { blocker = newBlocker; continue; }

      if (pending.length) {
        setState('needs_human', `✋ ${pending.length} champ(s) à compléter manuellement dans Chrome, puis "Re-scanner" ou "Envoyer".`);
      } else if (spec.autoSubmit) {
        log('Aucun champ en attente — envoi automatique activé.');
      } else {
        setState('ready_to_review', '✅ Formulaire rempli — vérifie dans Chrome puis clique "Confirmer l\'envoi".');
      }

      let cmd;
      if (spec.autoSubmit && !pending.length) {
        cmd = 'submit';
      } else {
        cmd = await waitForCommand(activePage, frame);
      }
      if (cmd === 'abort') return finish('aborted', 'Annulé par l\'utilisateur.');
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
      for (;;) {
        setState('submitting', 'Envoi de la candidature…');
        const clicked = await clickSubmit(frame, activePage);
        if (!clicked) {
          setState('needs_human', '❓ Bouton d\'envoi introuvable — clique sur Submit dans Chrome puis "Envoyer" pour confirmer.');
          const c2 = await waitForCommand(activePage, frame);
          if (c2 === 'abort') return finish('aborted', 'Annulé par l\'utilisateur.');
          if (c2 === 'rescan') { outerAction = 'rescan'; break; }
          // 'submit' = user clicked Submit manually → verify below
        }
        await sleep(5000);

        const postBlocker = await detectBlocker(activePage);
        if (postBlocker) { blocker = postBlocker; outerAction = 'blocker'; break; }

        state.confirmed = await detectConfirmation(activePage);
        await screenshot(activePage, 'after-submit');
        if (state.confirmed) return finish('submitted', '🎉 Candidature envoyée — confirmation détectée sur la page.');

        // No confirmation → did the form reject us (validation errors shown)?
        const rejection = await detectSubmitRejection(activePage);
        if (rejection.stillForm && rejection.errorCount > 0) {
          setState('needs_human', `⚠️ Envoi refusé — ${rejection.errorCount} champ(s) invalide(s)${rejection.sample ? ` (« ${rejection.sample} »)` : ''}. Corrige dans Chrome puis clique "Envoyer" (ou "Re-scanner" pour me laisser recompléter).`);
          const c3 = await waitForCommand(activePage, frame);
          if (c3 === 'abort') return finish('aborted', 'Annulé par l\'utilisateur.');
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
    setState('error', `Erreur: ${String(err?.message || err).slice(0, 300)}`);
  } finally {
    writeState();
    // leave the window open briefly so the user can see the final page
    await sleep(state.state === 'submitted' ? 30000 : 5000);
    await context.close().catch(() => {});
  }

  function finish(s, msg) {
    setState(s, msg);
  }
}

main().catch(err => {
  setState('error', `Erreur fatale: ${String(err?.message || err).slice(0, 300)}`);
  process.exit(1);
});
