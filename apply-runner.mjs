#!/usr/bin/env node
// apply-runner.mjs — drives a VISIBLE Chrome window through a job application:
// navigate to the offer, follow redirects to the real ATS form, fill fields with
// Section F answers + regional identity, upload the regional CV, then pause for
// human review/captcha before submitting.
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
import { polishApplicationAnswer, resolveUnknownFields } from './lib/apply-llm.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Compact CV digest fed to the LLM field resolver (read once, lazily).
let _cvSummary = null;
function cvSummary() {
  if (_cvSummary !== null) return _cvSummary;
  try { _cvSummary = readFileSync(join(__dirname, 'cv.md'), 'utf-8').replace(/\s+\n/g, '\n').slice(0, 3000); }
  catch { _cvSummary = ''; }
  return _cvSummary;
}

let _profileVoice = null;
function profileVoice() {
  if (_profileVoice !== null) return _profileVoice;
  try {
    const profile = readFileSync(join(__dirname, 'modes', '_profile.md'), 'utf-8');
    const match = profile.match(/\*\*Guidelines de copywriting[\s\S]*?(?=\n\*\*Sélection du projet|\n---|\n## Tes Rôles)/);
    _profileVoice = (match?.[0] || profile).replace(/\s+\n/g, '\n').slice(0, 3000);
  } catch {
    _profileVoice = '';
  }
  return _profileVoice;
}

function isComboboxField(f) {
  return f.role === 'combobox' || f.ariaAutocomplete === 'list'
    || f.ariaHaspopup === 'listbox' || (f.idAttr || '').includes('react-select');
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

function writeState() {
  state.updatedAt = new Date().toISOString();
  const tmp = join(RUN_DIR, 'state.json.tmp');
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, join(RUN_DIR, 'state.json'));
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

// True if the field currently holds non-empty content (works for input/textarea
// and contenteditable). Used to confirm a value actually landed.
async function fieldHasContent(loc) {
  try {
    const v = await loc.inputValue({ timeout: 600 }).catch(() => null);
    if (v !== null) return v.trim().length > 0;
    return await loc.evaluate(el => ((el.innerText || el.textContent || '').trim().length > 0)).catch(() => true);
  } catch { return true; } // can't tell → assume it stuck
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
    await loc.click({ timeout: 4000 });
    await sleep(rand(90, 260));             // settle after focus
    // clear any pre-filled value (cross-platform / any field type) before typing.
    // NOT Control+a — on macOS that's "line start", not select-all.
    await loc.fill('').catch(() => {});
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
  if (!str.trim() || await fieldHasContent(loc)) return true;
  try { await loc.fill(str, { timeout: 5000 }); } catch { return false; }
  return await fieldHasContent(loc);
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
  try {
    const found = await page.evaluate(() => {
      const visible = (el) => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.width > 10 && r.height > 10;
      };
      // Active challenges only — the floating reCAPTCHA badge (bottom-right on
      // every Greenhouse form) is NOT a blocker.
      const captchaSel = 'iframe[src*="recaptcha"], .g-recaptcha, iframe[src*="hcaptcha"], [class*="h-captcha"], [class*="turnstile"], iframe[src*="turnstile"]';
      const isChallenge = [...document.querySelectorAll(captchaSel)]
        .filter(el => !el.closest('.grecaptcha-badge'))
        .some(visible);
      if (isChallenge) return 'captcha';
      const bodyText = (document.body?.innerText || '').slice(0, 3000).toLowerCase();
      if (/just a moment|verify you are human|checking your browser|attention required/.test(bodyText)) return 'cloudflare';
      if (/sign in to continue|log in to apply|connectez-vous pour postuler/.test(bodyText)
          && [...document.querySelectorAll('input[type="password"]')].some(visible)) return 'login';
      return null;
    });
    return found;
  } catch { return null; }
}

// ── Apply navigation: follow links/redirects until a real form is reached ─────

const APPLY_TEXT_RE = /^(apply(\s+(now|here|for|to)\b.*)?|postuler.*|candidater.*|d[ée]poser (ma |une )?candidature|easy apply|i'?m interested|apply for this (job|position|role)|soumettre|submit application|apply on company (web)?site)$/i;

// Interstitial modals between the job page and the real form (e.g. Jobicy's
// "Sign Up and Apply / Continue as Guest") — always pick the no-account path.
const CONTINUE_TEXT_RE = /^(continue as guest|continue without (an )?account|apply without (an )?account|apply (on|via) (the )?(company|employer)('s)? (web)?site|continuer sans compte|no,? thanks.*|maybe later|skip( for now)?)$/i;

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
async function frameHasApplicationForm(frame) {
  try {
    return await frame.evaluate(() => {
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        const st = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && st.visibility !== 'hidden';
      };
      const inputs = [...document.querySelectorAll('input[type="text"], input[type="email"], input:not([type]), textarea, [contenteditable="true"], [role="textbox"]')].filter(visible);
      const files = [...document.querySelectorAll('input[type="file"]')];
      const hasIdentity = inputs.some(i => {
        const s = ((i.name || '') + (i.id || '') + (i.getAttribute('aria-label') || '') + (i.placeholder || '')).toLowerCase();
        return /name|email|mail|phone/.test(s);
      });
      return (hasIdentity && inputs.length >= 2) || (files.length > 0 && inputs.length >= 1);
    });
  } catch { return false; }
}

async function findFormFrame(page) {
  for (const frame of page.frames()) {
    if (frame.isDetached()) continue;
    if (await frameHasApplicationForm(frame)) return frame;
  }
  return null;
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
  const marked = await page.evaluate(({ reSrc, skip }) => {
    document.querySelectorAll('[data-co-click]').forEach(el => el.removeAttribute('data-co-click'));
    const re = new RegExp(reSrc, 'i');
    const skipSet = new Set(skip);
    const out = [];
    let n = 0;
    for (const el of document.querySelectorAll('a, button, [role="button"]')) {
      const r = el.getBoundingClientRect();
      if (r.width < 5 || r.height < 5) continue;
      const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
      if (!t || t.length > 80 || !re.test(t) || skipSet.has(t)) continue;
      el.setAttribute('data-co-click', String(n));
      out.push({ n, text: t, href: (el.href || '').slice(0, 100) });
      n++;
      if (n >= 8) break;
    }
    return out;
  }, { reSrc: textRe.source, skip });
  if (!marked.length) return null;

  const popupPromise = context.waitForEvent('page', { timeout: 8000 }).catch(() => null);
  let clicked = false;
  for (const cand of marked) {
    try {
      if (attempted) attempted.add(`${url}::${cand.text}`);
      await page.locator(`[data-co-click="${cand.n}"]`).click({ timeout: 5000 });
      log(`Clic sur "${cand.text}"${cand.href ? ` → ${cand.href}` : ''}`);
      clicked = true;
      break;
    } catch (err) {
      log(`Clic raté sur "${cand.text}" (${String(err.message || err).slice(0, 60)}) — élément suivant`);
    }
  }
  if (!clicked) return null;
  const popup = await popupPromise;
  const target = popup || page;
  await target.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => {});
  await sleep(2500);
  return target;
}

async function dismissCookieBanner(page) {
  try {
    const btn = page.locator('button, a').filter({
      hasText: /^(accept( all)?( cookies)?|i (agree|accept)|tout accepter|accepter( tout)?|allow all|got it|ok|j'accepte)$/i,
    }).first();
    if (await btn.isVisible({ timeout: 800 })) {
      await btn.click({ timeout: 2000 });
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
  for (let hop = 0; hop < 9; hop++) {
    state.currentUrl = page.url();
    writeState();

    const blocker = await detectBlocker(page);
    if (blocker) return { page, frame: null, blocker };

    await dismissCookieBanner(page);

    // SPAs (Ashby, Greenhouse new UI…) render the form well after
    // domcontentloaded — poll instead of checking once.
    let frame = null;
    for (let w = 0; w < 6 && !frame; w++) {
      frame = await findFormFrame(page);
      if (!frame) await sleep(1500);
    }
    if (frame) return { page, frame, blocker: null };

    // Known ATS URL that just needs normalization (lever → /apply, ashby → /application)
    const normalized = normalizeAtsUrl(page.url());
    if (normalized !== page.url()) {
      log(`URL ATS normalisée → ${normalized}`);
      await page.goto(normalized, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await sleep(2500);
      continue;
    }

    // No form yet → advance one step. Priority: guest/no-account modal, then an
    // apply button, then a generic wizard "next/start/continue" (only safe here
    // because the page has no form). `attempted` blocks re-clicking a no-op.
    const next = await clickApplyAndFollow(context, page, CONTINUE_TEXT_RE, attempted)
      || await clickApplyAndFollow(context, page, APPLY_TEXT_RE, attempted)
      || await clickApplyAndFollow(context, page, PROGRESS_TEXT_RE, attempted);
    if (!next) {
      log('Aucun bouton de progression cliquable — formulaire non atteint.');
      return { page, frame: null, blocker: null };
    }
    page = next;
  }
  log('Limite de pages intermédiaires atteinte (9) sans trouver le formulaire.');
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
      const fr = await findFormFrame(p);
      if (fr) return { page: p, frame: fr, blocker: null };
    }
    await sleep(1000);
  }
  log('Aucun formulaire sur les onglets ouverts — navigation complète.');
  return reachApplicationForm(context, page);
}

// ── Field collection & classification ─────────────────────────────────────────

async function collectFields(frame) {
  return await frame.evaluate(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      // opacity check: react-select pairs each combobox with an invisible
      // required <input style="opacity:0"> used for validation — not a field
      return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none'
        && st.opacity !== '0' && el.getAttribute('aria-hidden') !== 'true';
    };
    const labelFor = (el) => {
      const parts = [];
      if (el.id) {
        const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (l) parts.push(l.innerText);
      }
      const wrap = el.closest('label');
      if (wrap) parts.push(wrap.innerText);
      if (el.getAttribute('aria-label')) parts.push(el.getAttribute('aria-label'));
      const lblBy = el.getAttribute('aria-labelledby');
      if (lblBy) {
        lblBy.split(/\s+/).forEach(id => {
          const n = document.getElementById(id);
          if (n) parts.push(n.innerText);
        });
      }
      if (!parts.filter(p => p && p.trim()).length) {
        // walk up: many ATS wrap field + label in a small container
        let node = el.parentElement;
        for (let d = 0; d < 3 && node; d++, node = node.parentElement) {
          const lab = node.querySelector('label, legend, [class*="label" i]');
          if (lab && !lab.contains(el)) { parts.push(lab.innerText); break; }
          const txt = (node.innerText || '').trim();
          if (txt && txt.length < 220) { parts.push(txt); break; }
        }
      }
      if (!parts.filter(p => p && p.trim()).length) {
        // preceding-sibling label: layouts (Airtable, stacked forms) put the
        // label as a sibling block right before the editable cell, not an ancestor
        let prev = el.previousElementSibling;
        for (let d = 0; d < 3 && prev; d++, prev = prev.previousElementSibling) {
          const t = (prev.innerText || '').trim();
          if (t && t.length < 160 && !prev.querySelector('input, textarea, select, [contenteditable="true"]')) { parts.push(t); break; }
        }
      }
      // placeholder LAST: it's often just "Select..." / "Type here..." and
      // must not shadow the real label
      if (el.placeholder) parts.push(el.placeholder);
      return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().slice(0, 300);
    };
    let i = 0;
    const out = [];
    // Include contenteditable / role=textbox fields: Airtable forms, Notion-style
    // and rich-text ATS render long-answer inputs as <div contenteditable> rather
    // than <textarea>, so a plain input/textarea/select query misses them.
    for (const el of document.querySelectorAll('input, textarea, select, [contenteditable="true"], [role="textbox"]')) {
      const tag = el.tagName.toLowerCase();
      let isCE = (tag !== 'input' && tag !== 'textarea' && tag !== 'select')
        && (el.getAttribute('contenteditable') === 'true' || el.getAttribute('role') === 'textbox');
      if (isCE) {
        // skip rich-text engine helpers (Quill's off-screen .ql-clipboard, etc.)
        // and wrappers that contain another field — keep only the real leaf input
        const cls = (el.className || '').toString();
        const r = el.getBoundingClientRect();
        if (/clipboard/i.test(cls) || r.left < -1000 || r.top < -5000) continue;
        if (el.querySelector('input, textarea, [contenteditable="true"], [role="textbox"]')) continue;
      }
      const type = isCE ? 'textarea' : (el.type || tag).toLowerCase();
      if (['hidden', 'submit', 'button', 'image', 'reset'].includes(type)) continue;
      const isFile = type === 'file';
      if (!isFile && !visible(el)) continue;
      el.setAttribute('data-co-i', String(i));
      const label = labelFor(el);
      const required = el.required || el.getAttribute('aria-required') === 'true' || /[*✱]/.test(label);
      const entry = {
        i, type,
        tag,
        contentEditable: isCE,
        label,
        name: el.name || '',
        idAttr: el.id || '',
        required,
        value: type === 'checkbox' || type === 'radio' ? '' : (isCE ? (el.innerText || '').trim() : (el.value || '')),
        checked: !!el.checked,
        role: el.getAttribute('role') || '',
        ariaAutocomplete: el.getAttribute('aria-autocomplete') || '',
        ariaHaspopup: el.getAttribute('aria-haspopup') || '',
        multiple: !!el.multiple || el.getAttribute('aria-multiselectable') === 'true'
          || !!el.closest('[class*="multi-value"],[class*="is-multi"],[class*="multiselect" i]'),
        options: el.tagName === 'SELECT'
          ? [...el.options].map(o => ({ value: o.value, text: o.innerText.trim() }))
          : null,
      };
      out.push(entry);
      i++;
    }
    return out;
  });
}

const STOPWORDS = new Set(['the', 'a', 'an', 'to', 'of', 'in', 'for', 'and', 'or', 'you', 'your', 'is', 'are', 'do', 'does', 'this', 'that', 'with', 'us', 'we', 'at', 'on', 'what', 'why', 'how', 'about', 'tell', 'please', 'would', 'be', 'it', 'le', 'la', 'les', 'de', 'des', 'un', 'une', 'vous', 'pour', 'et']);

function tokens(s) {
  return new Set(String(s).toLowerCase().replace(/[^a-z0-9àâéèêëîïôùûüç\s]/gi, ' ').split(/\s+/).filter(w => w.length > 2 && !STOPWORDS.has(w)));
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
  // Pronouns are handled separately: many ATS make them required.
  if (/gender|race|ethnic|veteran|disab|diversity|origine|sexe/.test(s) && !/pronoun/.test(s)) {
    return { skip: 'question démographique (laissée vide)' };
  }

  if (f.type === 'checkbox') {
    if (/privacy|consent|gdpr|rgpd|terms|conditions|politique de confidentialité|j'accepte|i (agree|consent|acknowledge)/.test(s) && f.required) return { check: true };
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
  if (m(/first\s*name|pr[ée]nom|given name/)) return { value: id.firstName };
  if (m(/last\s*name|family name|surname|nom de famille/)) return { value: id.lastName };
  if (m(/full\s*name|your name|^name\b|legal name|^nom\b/) && !m(/company|file/)) return { value: id.fullName };
  if (m(/e-?mail|courriel/)) return { value: id.email };
  if (m(/phone|t[ée]l[ée]phone|mobile/)) return { value: id.phone, optionalEmpty: !id.phone };
  if (m(/linkedin/)) return { value: id.linkedin };
  if (m(/github/)) return { value: id.github };
  if (m(/portfolio|website|site (web|internet)|personal site|\burl\b/)) return { value: id.portfolio };
  if (m(/current location|where (are you|do you) (based|live)|city|ville|location|address|adresse/)) return { value: id.location };
  if (m(/country|pays/)) return { value: id.country, selectMatch: id.country };
  if (m(/time\s*zone|fuseau/)) return { value: id.timezone };
  if (m(/salary|compensation|r[ée]mun[ée]ration|expected pay|pay expectation|pretension|daily rate|tjm/)) return { value: id.salary };
  if (m(/notice period|pr[ée]avis/)) return { value: id.noticePeriod };
  if (m(/start date|available (to start|from)|disponibilit|when can you start/)) return { value: id.startDate };
  if (m(/how did you (hear|find)|source|referr|comment avez-vous/)) return { value: id.howDidYouHear, selectText: 'Other', selectPrefer: /other|job board|search|website|autre/i };
  if (m(/reference/) && !m(/referr/)) return { value: id.references };

  // Factual yes/no questions ("Do you…", "Have you…") must never receive a
  // Section F motivation answer, even when token overlap is high (company
  // name + "work" match "why do you want to work at …"). Strip any leading
  // numbering / asterisk / bullet so "* Do you…" or "1. Have you…" still match.
  const cleanLabel = (f.label || '').replace(/^[\s*••\-–—.)\d:]+/, '').trim();
  if (/^(do|did|does|have|has|are|were|will|would|can|is) (you|your)\b/i.test(cleanLabel)) return null;

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
    const contains = usable.find(o => lower(o.text).includes(needle) || needle.includes(lower(o.text)));
    if (contains) return contains;
  }
  return null;
}

// Open a custom dropdown and scrape its rendered options (react-select, Ashby…)
// so the LLM resolver can pick a valid one. Best-effort; restores closed state.
async function scrapeComboboxOptions(frame, f) {
  try {
    const loc = frame.locator(`[data-co-i="${f.i}"]`);
    await loc.click({ timeout: 3000 });
    await sleep(700);
    const opts = await frame.evaluate(() => {
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
    });
    await loc.press('Escape').catch(() => {});
    return opts.map(t => ({ value: t, text: t }));
  } catch { return []; }
}

// Robustly select an option in a searchable/autocomplete dropdown (react-select,
// Ashby, Greenhouse new UI): open → type the query with REAL keystrokes (so the
// list filters) → wait for options → CLICK the matching option via Playwright
// (react-select reacts to mouse events, not a programmatic value set / lone
// Enter). Returns the selected option text, or null if nothing matched.
async function selectComboboxOption(frame, f, query) {
  const loc = frame.locator(`[data-co-i="${f.i}"]`);
  const q = String(query).slice(0, 60);
  try {
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    await sleep(rand(120, 320));
    await loc.click({ timeout: 4000 }).catch(() => {});
    await sleep(rand(180, 420));
    // Typing is best-effort: pure listbox comboboxes have no text input, but the
    // click above already opened the menu so the option scan/click still works.
    await loc.fill('').catch(() => {});
    await loc.pressSequentially(q, { delay: rand(55, 130) }).catch(() => loc.fill(q).catch(() => {}));
    await sleep(rand(700, 1100)); // let the menu filter/render

    // Tag the best-matching rendered option, then click it through Playwright.
    // NEVER blindly pick the first option — that silently submits a wrong value
    // on unfiltered/listbox dropdowns. Only an exact/substring match is trusted.
    const result = await frame.evaluate(({ want }) => {
      const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
      const low = (s) => norm(s).toLowerCase();
      const isPlaceholder = (t) => /^(select\b|choose\b|--|please\b|s[ée]lectionn|aucun)/i.test(t);
      document.querySelectorAll('[data-co-opt]').forEach(e => e.removeAttribute('data-co-opt'));
      let cands = [...document.querySelectorAll('[role="option"], [id*="-option-"], [class*="select__option"], li[class*="option"], [class*="-menu"] li, [class*="menuList" i] > *, [class*="menu-list" i] > *')]
        .filter(n => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && norm(n.innerText); });
      // keep only leaf options (drop wrapper containers that hold other options)
      cands = cands.filter(n => !cands.some(o => o !== n && n.contains(o)));
      if (!cands.length) return { matched: null, count: 0 };
      const w = low(want);
      let idx = cands.findIndex(n => low(n.innerText) === w);
      if (idx < 0) idx = cands.findIndex(n => { const t = low(n.innerText); return !isPlaceholder(t) && t.includes(w); });
      if (idx < 0) idx = cands.findIndex(n => { const t = low(n.innerText); return t.length >= 4 && w.includes(t); });
      const real = cands.filter(n => !isPlaceholder(low(n.innerText)));
      if (idx < 0) return { matched: null, count: real.length };
      cands[idx].setAttribute('data-co-opt', '1');
      return { matched: norm(cands[idx].innerText).slice(0, 80), count: real.length };
    }, { want: q });

    if (result.matched) {
      try {
        await frame.locator('[data-co-opt="1"]').click({ timeout: 3000 });
        return result.matched;
      } catch { await loc.press('Escape').catch(() => {}); return null; }
    }
    // No text match. Trust Enter only when typing filtered the menu down to a
    // single real option; otherwise give up rather than submit a wrong value.
    if (result.count === 1) { await loc.press('Enter').catch(() => {}); return q; }
    await loc.press('Escape').catch(() => {});
    return null;
  } catch {
    return null;
  }
}

// A field is multi-select when the DOM says so OR the label asks for several
// ("select up to 3", "select all that apply"). Kept in sync with the same
// heuristic in lib/apply-llm.mjs so the model's array answers map correctly.
function fieldIsMulti(f) {
  return !!f.multiple || /\b(select|choose).{0,20}(all|up to|that apply|multiple|[2-9])\b/i.test(f.label || '');
}

// Write a resolved answer into any field type. `answer` may be a string or, for
// multi-selects, an array of option texts. Returns the displayed value on
// success, or false if nothing was actually applied.
async function fillValueIntoField(frame, f, answer) {
  const loc = frame.locator(`[data-co-i="${f.i}"]`);
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
    const want = values[0].trim().toLowerCase();
    const ok = await frame.evaluate(({ name, want }) => {
      const radios = [...document.querySelectorAll(`input[type="radio"][name="${CSS.escape(name)}"]`)];
      let best = null;
      for (const r of radios) {
        const t = (r.closest('label')?.innerText || r.value || '').trim().toLowerCase();
        if (t === want || t.includes(want) || want.includes(t)) { best = r; break; }
      }
      if (best) { best.click(); return true; }
      return false;
    }, { name: f.name, want });
    return ok ? values[0] : false;
  }

  if (isComboboxField(f)) {
    // type → click the matching option, once per value. Only count picks that
    // actually landed on a real option (selectComboboxOption returns null else).
    const done = [];
    for (const v of values) {
      const sel = await selectComboboxOption(frame, f, v);
      if (sel) done.push(sel);
    }
    if (!done.length) return false;
    const shown = done.join(', ');
    return shown.length > 60 ? shown.slice(0, 60) + '…' : shown;
  }

  // text / textarea / contenteditable
  const text = polishApplicationAnswer(multi ? values.join(', ') : values[0]);
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
        if (f.required) unresolved.push(f);
        continue;
      }
      if (plan.check) {
        await loc.check({ timeout: 4000 }).catch(async () => { await loc.click({ timeout: 3000 }); });
        filled.push({ label: labelShort, value: '☑' });
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
        if (plan.yesNo) {
          const ok = await frame.evaluate(({ name, want }) => {
            const radios = [...document.querySelectorAll(`input[type="radio"][name="${CSS.escape(name)}"]`)];
            for (const r of radios) {
              const t = (r.closest('label')?.innerText || r.value || '').trim().toLowerCase();
              if ((want === 'yes' && /^(yes|oui|true)/.test(t)) || (want === 'no' && /^(no|non|false)/.test(t))) { r.click(); return true; }
            }
            return false;
          }, { name: f.name, want: plan.yesNo });
          if (ok) filled.push({ label: labelShort, value: plan.yesNo });
          else if (f.required) unresolved.push(f);
        } else if (f.required) {
          unresolved.push(f);
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
        const sel = await selectComboboxOption(frame, f, query);
        if (sel) filled.push({ label: labelShort, value: sel });
        else if (f.required) unresolved.push(f); // couldn't confirm a real option → LLM/human
        continue;
      }
      if (!value) {
        if (f.required && !plan.optionalEmpty) unresolved.push(f);
        continue;
      }
      if (f.value && f.value.trim() && f.value.trim() === value.trim()) continue; // already filled
      const textValue = polishApplicationAnswer(value);
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
      if (ff) targets.push(ff); // else the field was hidden by a conditional → skip
    }
    // enumerate options for custom dropdowns so the model picks a valid one
    for (const f of targets) {
      if ((!f.options || !f.options.length) && isComboboxField(f)) {
        f.options = await scrapeComboboxOptions(frame, f);
      }
    }
    let answers = {};
    try {
      answers = await resolveUnknownFields({
        fields: targets.map(f => ({ i: f.i, label: f.label, kind: llmKind(f), required: f.required, multiple: fieldIsMulti(f), options: f.options })),
        spec,
        cvSummary: cvSummary(),
        styleGuide: profileVoice(),
      });
    } catch (err) {
      log(`LLM indisponible (${String(err.message || err).slice(0, 70)}) — champs laissés au humain.`);
    }
    for (const f of targets) {
      const labelShort = (f.label || f.name || f.type).slice(0, 80);
      const ans = answers[String(f.i)];
      if (!ans) { if (f.required) pending.push({ label: labelShort, reason: 'sans réponse — à remplir manuellement' }); continue; }
      try {
        const shown = await fillValueIntoField(frame, f, ans);
        if (shown) filled.push({ label: labelShort, value: typeof shown === 'string' ? shown : String(ans), llm: true });
        else if (f.required) pending.push({ label: labelShort, reason: 'option proposée introuvable' });
      } catch (err) {
        if (f.required) pending.push({ label: labelShort, reason: `échec: ${String(err.message || err).slice(0, 60)}` });
      }
    }
  }

  return { filled, pending };
}

// Re-check which required fields are still empty (after human edits or our fill).
async function remainingRequired(frame) {
  try {
    const fields = await collectFields(frame);
    return fields
      .filter(f => f.required && f.type !== 'checkbox' && f.type !== 'radio' && f.type !== 'file' && !f.value)
      .map(f => ({ label: (f.label || f.name).slice(0, 80), reason: 'requis et vide' }));
  } catch { return []; }
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
    await loc.click({ timeout: 6000 });
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
      const errorCount = textErrs.length + invalidFields.length;
      const stillForm = !!document.querySelector('input[type="file"], textarea, select, [role="combobox"]')
        && !!document.querySelector('form');
      const sample = (textErrs[0]?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80);
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

    setState('finding_form', 'Recherche du formulaire de candidature…');
    let { page: formPage, frame, blocker } = await reachApplicationForm(context, page);
    await screenshot(formPage, 'landing');

    let activePage = formPage;

    for (;;) {
      if (blocker) {
        setState('needs_human', blocker === 'captcha' ? '🤖 Captcha détecté — résous-le dans la fenêtre Chrome.'
          : blocker === 'login' ? '🔐 Connexion requise — connecte-toi dans la fenêtre Chrome.'
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
          const fr = await findFormFrame(p);
          if (fr) { activePage = p; frame = fr; break; }
        }
        if (!frame) continue;
      }

      setState('filling', 'Remplissage du formulaire…');
      const { filled, pending } = await fillFields(frame, spec);
      state.filled = filled;
      const stillRequired = await remainingRequired(frame);
      // exclude already-handled fields: custom comboboxes keep an empty input
      // value even once an option is selected
      const seen = new Set(pending.map(p => p.label));
      for (const f of filled) seen.add(f.label);
      for (const r of stillRequired) if (!seen.has(r.label)) pending.push(r);
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
