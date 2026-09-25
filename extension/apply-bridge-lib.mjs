/**
 * apply-bridge-lib.mjs — server-side WebSocket bridge to the Chrome extension.
 *
 * Opens / navigates / fills inside the user's already-open Chrome tab so a
 * successful plugin path never needs a second Playwright window.
 *
 * Fill rules match apply-runner: shared classifyField, resolveUnknownFields,
 * CV upload via chrome.debugger, multi-step Next, and optional auto-submit.
 */

import { readFileSync, existsSync, copyFileSync } from 'fs';
import { join, dirname, basename, resolve, extname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import {
  APPLICATION_FORM_PROBE,
  AUTH_AVOID_TEXT_RE,
  GUEST_TEXT_RE,
  PAGE_SHOWS_APPLY_ENTRY,
  LIST_VISIBLE_NAV_BUTTONS,
  PAGE_STEP_SNAPSHOT,
} from '../lib/form-detect.mjs';
import { classifyField } from '../lib/apply-classify.mjs';
import { resolveUnknownFields, polishApplicationAnswer, hasUnresolvedPlaceholder } from '../lib/apply-llm.mjs';
import { loadApplicationVoice } from '../lib/application-writing.mjs';
import {
  shouldFillField,
  isResumeFileField,
  isComboboxField,
  fieldIsMulti,
  shouldReplaceFilledValue,
  fieldLooksRequired,
  isApplicationGateConsent,
} from '../lib/apply-fill-guards.mjs';
import { pickDeclineOption, pickSelectOption, llmKind, DECLINE_RE } from '../lib/apply-select.mjs';
import { fieldCompletionIssue, looksReadyToSubmit } from '../lib/apply-completion.mjs';
import { computeStartDateISO as toIsoDate } from '../lib/apply-spec.mjs';
import { extractEmbeddedApplyUrl } from '../lib/apply-navigation.mjs';
import {
  APPLY_TEXT_RE,
  PROGRESS_TEXT_RE,
  SUBMIT_TEXT_RE,
  isBlockingApplyPending,
  fieldsFingerprint,
  pageLooksLikeReviewStep,
  reviewStepNeedsAi,
  reviewStepConfidence,
  countEditableApplyFields,
  classifyActionLabel,
  progressionButtonVisible,
  forwardProgressVisible,
  wizardControlsKnown,
  submitChoice,
  canAdvanceWizardStep,
  isRequiredEmptyReason,
  shouldAttemptSubmitAfterNoopNext,
} from '../lib/apply-progression.mjs';
import {
  resolveNavAction,
  navDecisionLog,
  exactControlPattern,
  filterNavButtons,
} from '../lib/apply-nav-llm.mjs';
import { identifyAts, normalizeAtsUrl } from './apply-ats.mjs';
import { acceptAdoptCandidate } from './apply-tab-match.mjs';
import {
  AUTOFILL_WAIT_MS,
  autofillShouldKeepWaiting,
  judgeAutofillSnapshot,
  snapshotIdentityFields,
} from './apply-autofill.mjs';

export { normalizeAtsUrl, identifyAts };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let _cvSummary = null;
function cvSummaryText() {
  if (_cvSummary !== null) return _cvSummary;
  try {
    _cvSummary = readFileSync(join(ROOT, 'cv.md'), 'utf-8').replace(/\s+\n/g, '\n').slice(0, 3000);
  } catch {
    _cvSummary = '';
  }
  return _cvSummary;
}

function profileVoice() {
  return loadApplicationVoice(ROOT);
}

/** Same classifier as the Playwright runner — keep in sync via lib/apply-classify.mjs */
export function classifyBridgeField(f, spec, usedAnswers = new Set()) {
  return classifyField(f, spec, usedAnswers);
}

/** @deprecated prefer classifyBridgeField */
export function classifySimpleField(f, identity) {
  return classifyBridgeField(f, { identity, answers: [] })?.value ?? null;
}

/** Serialize a RegExp (or string) for the extension fill payload. */
export function serializePrefer(re) {
  if (!re) return null;
  if (re instanceof RegExp) return { source: re.source, flags: re.flags || 'i' };
  return { source: String(re), flags: 'i' };
}

/**
 * Turn a classifyField plan into a fill-fields update payload for the extension.
 * Returns null when the field should be left blank / unresolved / skipped.
 */
export function planToUpdate(f, plan) {
  if (!plan || plan.skip) return null;
  if (plan.upload) {
    return {
      i: f.i,
      frameId: f.frameId ?? 0,
      upload: plan.upload,
      label: (f.label || f.name || 'file').slice(0, 80),
    };
  }
  if (plan.resume) {
    const cv = cvSummaryText();
    if (!cv) return null;
    return {
      i: f.i,
      frameId: f.frameId ?? 0,
      value: cv,
      label: (f.label || f.name || `field#${f.i}`).slice(0, 80),
      resume: true,
    };
  }
  if (plan.check) {
    return {
      i: f.i,
      frameId: f.frameId ?? 0,
      value: 'yes',
      check: true,
      label: (f.label || f.name || `field#${f.i}`).slice(0, 80),
    };
  }

  const label = (f.label || f.name || `field#${f.i}`).slice(0, 80);
  const tag = String(f.tag || '').toLowerCase();
  const type = String(f.type || '').toLowerCase();

  if (tag === 'select' || type === 'radio' || isComboboxField(f)) {
    const opt = (f.options && f.options.length) ? pickSelectOption(f.options, plan, f.label) : null;
    const text = opt?.text
      || plan.selectText
      || (plan.yesNo === 'yes' ? 'Yes' : plan.yesNo === 'no' ? 'No' : null)
      || plan.value;
    // selectPrefer-only plans (US state → Outside US) must still reach the
    // extension so it can open the list and pick — window runner scrapes first.
    if (!text && plan.selectPrefer) {
      return {
        i: f.i,
        frameId: f.frameId ?? 0,
        value: '',
        selectText: '',
        selectPrefer: serializePrefer(plan.selectPrefer),
        label,
        options: Array.isArray(f.options) ? f.options : undefined,
        choice: true,
      };
    }
    if (!text) return null;
    const looseWord = String(text).trim().split(/[\s,/]+/).find((w) => w.length >= 3) || '';
    const looseContains = looseWord && /\b(city|ville|country|pays|location|timezone|fuseau)\b/i.test(`${label} ${f.name || ''}`)
      ? looseWord
      : '';
    return {
      i: f.i,
      frameId: f.frameId ?? 0,
      value: text,
      selectText: text,
      label,
      fromQuestion: plan.fromQuestion,
      options: Array.isArray(f.options) ? f.options : undefined,
      choice: type === 'radio' || !!plan.yesNo,
      selectPrefer: plan.selectPrefer ? serializePrefer(plan.selectPrefer) : undefined,
      looseContains: looseContains || undefined,
    };
  }

  if (type === 'date' || type === 'datetime-local' || type === 'month') {
    const iso = toIsoDate(plan.dateISO || plan.value || '');
    if (!iso) return null;
    return {
      i: f.i,
      frameId: f.frameId ?? 0,
      value: iso,
      selectText: iso,
      label,
    };
  }

  const raw = plan.value ?? plan.selectText ?? (plan.yesNo === 'yes' ? 'Yes' : plan.yesNo === 'no' ? 'No' : '');
  const value = polishApplicationAnswer(String(raw || ''));
  if (!value || hasUnresolvedPlaceholder(value)) return null;
  return {
    i: f.i,
    frameId: f.frameId ?? 0,
    value,
    label,
    fromQuestion: plan.fromQuestion,
    humanType: type === 'textarea' || tag === 'textarea' || value.length >= 48,
  };
}

const RETRYABLE_PENDING_RE = /upload échoué|échec fill|option introuvable|no matching option|radio option not found|FileList|valeur non retenue|element not found/i;

function mergeFilled(a, b) {
  const byLabel = new Map();
  for (const row of [...(a || []), ...(b || [])]) byLabel.set(row.label, row);
  return [...byLabel.values()];
}

function mergePending(pending, extra, filled) {
  const filledLabels = new Set((filled || []).map((f) => f.label));
  const out = [];
  const seen = new Set();
  for (const row of [...(pending || []), ...(extra || [])]) {
    if (!row?.label || filledLabels.has(row.label) || seen.has(row.label)) continue;
    seen.add(row.label);
    out.push(row);
  }
  return out;
}

export class ApplyBridge {
  constructor() {
    this.socket = null;
    this.pending = new Map();
    this.reqCounter = 0;
    this.onLog = () => {};
  }

  get connected() {
    return !!this.socket;
  }

  attach(socket) {
    // Only one live extension socket — drop a stale reconnect so pending
    // requests aren't answered on a dead channel, and so we don't keep two
    // half-open connections fighting each other (seen as rapid
    // connect/disconnect spam in the server log).
    if (this.socket && this.socket !== socket) {
      try { this.socket.close(); } catch { /* already closed */ }
      this._rejectAllPending(new Error('apply-bridge socket replaced'));
    }
    this.socket = socket;
    for (const waiter of this._connectWaiters ?? []) waiter();
    this._connectWaiters = [];
    socket.on('message', (raw) => this._onMessage(raw));
    socket.on('close', () => {
      if (this.socket === socket) {
        this.socket = null;
        this._rejectAllPending(new Error('apply-bridge extension disconnected'));
      }
    });
  }

  _rejectAllPending(err) {
    for (const [, waiter] of this.pending) {
      try { waiter.reject(err); } catch { /* ignore */ }
    }
    this.pending.clear();
  }

  waitUntilConnected(timeoutMs = 5000) {
    if (this.connected) return Promise.resolve(true);
    return new Promise((resolve) => {
      this._connectWaiters ??= [];
      const onConnect = () => { clearTimeout(timer); resolve(true); };
      const timer = setTimeout(() => {
        this._connectWaiters = (this._connectWaiters ?? []).filter((w) => w !== onConnect);
        resolve(false);
      }, timeoutMs);
      this._connectWaiters.push(onConnect);
    });
  }

  _onMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === 'hello') {
      // Identity only — connect is already logged in attachApplyBridge.
      return;
    }
    const waiter = this.pending.get(msg.requestId);
    if (!waiter) return;
    this.pending.delete(msg.requestId);
    if (msg.ok) waiter.resolve(msg);
    else waiter.reject(new Error(msg.error || 'apply-bridge request failed'));
  }

  _send(payload) {
    if (!this.socket) throw new Error('no apply-bridge extension connected');
    this.socket.send(JSON.stringify(payload));
  }

  _request(type, body, timeoutMs = 45000) {
    return new Promise((resolve, reject) => {
      const requestId = `${type}-${++this.reqCounter}`;
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`apply-bridge ${type} timed out`));
      }, timeoutMs);
      this.pending.set(requestId, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this._send({ type, requestId, ...body });
    });
  }

  openTab(url) {
    return this._request('open-tab', { url });
  }

  detectFields(url) {
    return this._request('detect-fields', { url });
  }

  detectFieldsInTab(tabId) {
    return this._request('detect-fields-in-tab', { tabId });
  }

  fillFields(tabId, updates) {
    return this._request('fill-fields', { tabId, updates });
  }

  uploadFile(tabId, { i, frameId = 0, path }) {
    // Absolute path for CDP DOM.setFileInputFiles (relative paths fail silently).
    // Copy to a short ASCII temp path — Chrome on Windows is picky with spaces/accents.
    let absPath = resolve(path);
    let fileName = basename(absPath);
    let fileBase64 = null;
    try {
      if (existsSync(absPath)) {
        const tmp = join(tmpdir(), `jobyougo-cv-${Date.now()}${extname(absPath) || '.pdf'}`);
        copyFileSync(absPath, tmp);
        absPath = tmp;
        // Keep base64 small enough for WS; 400KB PDF → ~535KB b64 — OK. Cap at 1.5MB raw.
        const raw = readFileSync(path);
        if (raw.length <= 1_500_000) fileBase64 = raw.toString('base64');
      }
    } catch { /* CDP path-only still attempted */ }
    return this._request('upload-file', {
      tabId,
      i,
      frameId,
      path: absPath,
      fileBase64,
      fileName,
    }, 90000);
  }

  clickSubmit(tabId) {
    return this._request('click-submit', { tabId, reSrc: SUBMIT_TEXT_RE.source });
  }

  pageShowsApplyEntry(tabId) {
    return this._request('eval-in-tab', {
      tabId,
      src: PAGE_SHOWS_APPLY_ENTRY.toString(),
    });
  }

  /**
   * Wait until resume autofill copies name or email, then stop.
   * A timeout, an empty form, or a wrong value never blocks the fill:
   * the caller writes the profile itself and reconcile overwrites mismatches.
   */
  async waitResumeAutofill(tabId, identity = {}, timeoutMs = AUTOFILL_WAIT_MS) {
    const read = async () => {
      try {
        const res = await this._request('eval-in-tab', {
          tabId,
          src: `(${snapshotIdentityFields.toString()})()`,
        });
        return Array.isArray(res?.result) ? res.result : [];
      } catch {
        return [];
      }
    };
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
    return {
      ...last,
      timedOut,
      manualFill: last.status !== 'matched',
    };
  }

  /** Open a combobox and list visible option texts (for LLM / selectPrefer). */
  async scrapeComboboxOptions(tabId, f) {
    try {
      const res = await this._request('eval-in-tab', {
        tabId,
        src: `(() => {
          const i = ${JSON.stringify(f.i)};
          const deep = (root, sel) => {
            const out = [];
            const walk = (n) => {
              if (!n?.querySelectorAll) return;
              try { out.push(...n.querySelectorAll(sel)); } catch {}
              for (const el of n.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot);
            };
            walk(root);
            return out;
          };
          const el = deep(document, '[data-co-i="' + i + '"]')[0]
            || document.querySelector('[data-co-i="' + i + '"]');
          if (!el) return [];
          try { el.scrollIntoView({ block: 'center' }); } catch {}
          el.click();
          el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          el.focus();
          const SEL = '[role="option"], [role="menuitem"], [role="menuitemradio"], [class*="select__option"], [class*="MuiMenuItem"], [class*="MuiAutocomplete-option"], [class*="ant-select-item-option"], .select2-results__option, [class*="-option" i], [role="listbox"] li';
          const PLACEHOLDER = /^(select\\b|choose\\b|--|please\\b|s[ée]lectionn|aucun|loading|searching|no options|no results|start typing|type to search)/i;
          const texts = deep(document, SEL)
            .filter((n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
            .map((n) => (n.innerText || n.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim())
            .filter((t) => t && t.length < 160 && !PLACEHOLDER.test(t));
          el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
          return [...new Set(texts)].slice(0, 40).map((t, k) => ({ value: t, text: t, key: i + ':' + k }));
        })()`,
      });
      return Array.isArray(res?.result) ? res.result : [];
    } catch {
      return [];
    }
  }

  probeForm(tabId) {
    return this._request('probe-form', {
      tabId,
      probeSrc: APPLICATION_FORM_PROBE.toString(),
    });
  }

  clickProgression(tabId, textRe, skip = [], { scrollFirst = true } = {}) {
    return this._request('click-progression', {
      tabId,
      reSrc: textRe.source,
      avoidSrc: AUTH_AVOID_TEXT_RE.source,
      skip,
      scrollFirst,
    });
  }

  /** Click one control whose visible label is exactly `text`. Auth regex still vetoes. */
  clickExactLabel(tabId, text) {
    return this.clickProgression(tabId, exactControlPattern(text), [], { scrollFirst: false });
  }

  /** Prefer an AI-chosen send label, then the Submit regex. */
  async clickSend(tabId, exactText) {
    if (exactText) {
      const exact = await this.clickExactLabel(tabId, exactText).catch(() => null);
      if (exact?.clicked) return exact;
    }
    return this.clickSubmit(tabId);
  }

  /**
   * One complementary AI call. Regex navigation / review heuristics must have
   * failed first. `phase` `review` is capped at 3 per run, other phases at 2.
   */
  async askNavAi(tabId, {
    phase = 'navigate',
    url = '',
    skipTexts = [],
    fields = [],
    heading = '',
    bodySnippet = '',
  } = {}) {
    if (!this._navAi) this._navAi = { nav: 0, review: 0 };
    const bucket = phase === 'review' ? 'review' : 'nav';
    const max = phase === 'review' ? 3 : 2;
    if (this._navAi[bucket] >= max) return { action: 'human', reason: 'plafond', skipped: true };

    let listed = [];
    try {
      const res = await this._request('eval-in-tab', {
        tabId,
        src: `(${LIST_VISIBLE_NAV_BUTTONS.toString()})(${JSON.stringify({
          avoidSrc: AUTH_AVOID_TEXT_RE.source,
          skip: skipTexts || [],
        })})`,
      });
      listed = Array.isArray(res?.result) ? res.result : [];
    } catch { listed = []; }

    const buttons = filterNavButtons(listed, skipTexts);
    if (phase !== 'review' && !buttons.length) {
      return { action: 'human', reason: 'aucun bouton', skipped: true };
    }
    let pageUrl = url;
    if (!pageUrl) {
      try { pageUrl = (await this.getTab(tabId))?.url || ''; } catch { pageUrl = ''; }
    }
    this._navAi[bucket] += 1;
    const fieldsSummary = `${(fields || []).length} champs, ${countEditableApplyFields(fields || [])} éditables`;
    const decision = await resolveNavAction({
      phase,
      url: pageUrl,
      heading,
      bodySnippet,
      buttons,
      fieldsSummary,
    });
    return { ...decision, log: navDecisionLog(decision) };
  }

  /** Click an exact label, then report whether the field fingerprint changed. */
  async clickExactAndSeeChange(tabId, text, previousFingerprint) {
    const res = await this.clickExactLabel(tabId, text).catch(() => null);
    if (!res?.clicked) return { clicked: false };
    if (res.openedTabId && res.openedTabId !== tabId) return { clicked: true, opened: res };
    for (let i = 0; i < 20; i++) {
      await sleep(400);
      try {
        const now = await this.detectFieldsInTab(tabId);
        const sig = await this._stepMark(tabId, now.fields || []);
        if (sig && sig !== previousFingerprint) return { clicked: true, changed: true };
      } catch { /* keep polling */ }
    }
    return { clicked: true, changed: false };
  }

  navigateTab(tabId, url) {
    return this._request('navigate-tab', { tabId, url });
  }

  getTab(tabId) {
    return this._request('get-tab', { tabId });
  }

  getActiveTab(windowId) {
    return this._request('get-active-tab', windowId ? { windowId } : {});
  }

  listWindowTabs(windowId) {
    return this._request('list-window-tabs', windowId ? { windowId } : {});
  }

  /** Visible button labels (disabled controls excluded). Empty when none are found. */
  async listVisibleActionLabels(tabId) {
    const res = await this._request('eval-in-tab', {
      tabId,
      src: `(() => {
        const deep = (root, sel) => {
          const out = [];
          const walk = (n) => {
            if (!n || !n.querySelectorAll) return;
            try { out.push(...n.querySelectorAll(sel)); } catch (e) {}
            for (const el of n.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot);
          };
          walk(root);
          return out;
        };
        const disabled = (el) => !!(el.disabled || el.getAttribute('aria-disabled') === 'true' || (el.closest && el.closest('[disabled],[aria-disabled="true"],[inert]')));
        const visible = (el) => {
          const r = el.getBoundingClientRect();
          return r.width > 5 && r.height > 5;
        };
        const label = (el) => String(el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || '').replace(/\\s+/g, ' ').trim();
        const labels = [];
        for (const el of deep(document, 'a, button, [role="button"], input[type="submit"], input[type="button"]')) {
          if (disabled(el) || !visible(el)) continue;
          const t = label(el);
          if (!t || t.length > 80) continue;
          labels.push(t);
        }
        const uniq = [...new Set(labels)].slice(0, 40);
        return uniq.length ? { labels: uniq } : null;
      })()`,
    });
    const labels = res?.result?.labels;
    return Array.isArray(labels) ? labels : [];
  }

  /** Heading, body, and whether the review heuristic already matched. */
  async inspectStep(tabId, fields = []) {
    let heading = '';
    let bodySnippet = '';
    try {
      const res = await this._request('eval-in-tab', {
        tabId,
        src: `(${PAGE_STEP_SNAPSHOT.toString()})()`,
      });
      heading = res?.result?.heading || '';
      bodySnippet = res?.result?.bodySnippet || '';
    } catch { /* heuristic can still run on field counts */ }
    const fieldCount = (fields || []).length;
    const editableCount = countEditableApplyFields(fields);
    return {
      heading,
      bodySnippet,
      fieldCount,
      editableCount,
      heuristic: pageLooksLikeReviewStep({ heading, bodySnippet, fieldCount, editableCount }),
    };
  }

  /** Fingerprint of URL + heading + fields, shared by Next and the AI click. */
  async _stepMark(tabId, fields = []) {
    let url = '';
    try { url = (await this.getTab(tabId))?.url || ''; } catch { /* keep */ }
    let heading = '';
    try {
      heading = (await this.inspectStep(tabId, fields)).heading || '';
    } catch { /* keep */ }
    return fieldsFingerprint(fields, { url, heading });
  }

  /** Rewrite fields the ATS marked invalid. Returns true when at least one was flagged. */
  async _refillInvalid(tabId, spec, { push }) {
    let fields = [];
    try { fields = (await this.detectFieldsInTab(tabId)).fields || []; } catch { return false; }
    const bad = fields.filter((f) => fieldCompletionIssue(f));
    if (!bad.length) return false;
    await push(`Erreurs ATS (${bad.length}) — correction des champs invalides…`);
    await this._fillOnce(tabId, spec, fields, { push });
    try { await this.tickGateConsents(tabId, { push }); } catch { /* ignore */ }
    return true;
  }

  /**
   * When a hop closes the opener, pick a tab that matches the offer.
   * The focused tab is not adopted on its own.
   */
  async chooseAdoptTab(candidates, ctx, push) {
    const prelim = (candidates || [])
      .map((c) => ({ c, scored: acceptAdoptCandidate(c, ctx, { trustedChild: false }) }))
      .filter((x) => !x.scored.hardReject)
      .sort((a, b) => b.scored.score - a.scored.score)
      .slice(0, 4);
    const accepted = [];
    for (const item of prelim) {
      let c = item.c;
      if (item.scored.score < 40 && c.tabId) {
        try {
          const probe = await this.probeForm(c.tabId);
          if (probe?.probe?.verdict === 'application_form') c = { ...c, hasForm: true };
          else if (probe?.probe?.verdict === 'auth_wall') continue;
        } catch { /* tab not scriptable */ }
      }
      const verdict = acceptAdoptCandidate(c, ctx, { trustedChild: false });
      if (verdict.ok) accepted.push({ ...c, verdict });
    }
    accepted.sort((a, b) => b.verdict.score - a.verdict.score);
    const best = accepted[0];
    if (!best) return null;
    if (push) {
      await push(`Onglet repris (score ${best.verdict.score}: ${best.verdict.reasons.join(', ')}) → ${best.url || best.tabId}`);
    }
    return best;
  }

  async recoverLostTab(deadTabId, push, ctx = {}) {
    try {
      const listed = await this.listWindowTabs();
      const candidates = (listed?.tabs || []).filter((t) => t.tabId !== deadTabId);
      const picked = await this.chooseAdoptTab(candidates, { ...ctx, deadTabId }, push);
      return picked?.tabId || null;
    } catch {
      return null;
    }
  }

  dismissCookies(tabId) {
    return this._request('dismiss-cookies', { tabId });
  }

  /**
   * Listing pages (CryptoJobsList and the same JSON shape) stash the real ATS
   * URL in `applicationLink` while the visible Apply button opens a login
   * modal. Returns that off-site URL, or null.
   */
  async findEmbeddedApplyUrl(tabId) {
    const src = `(${extractEmbeddedApplyUrl.toString()})(document.documentElement.innerHTML, location.href)`;
    const res = await this._request('eval-in-tab', { tabId, src });
    const url = res?.result;
    return typeof url === 'string' && /^https?:\/\//i.test(url) ? url : null;
  }

  /**
   * Poll until an application form (or enough identity fields) appears.
   * Used after adopting a new tab / navigating to an ATS SPA that still
   * shows a loading spinner when status=complete.
   */
  async waitForFormReady(tabId, { push = async () => {}, aborted = async () => false, timeoutMs = 15000 } = {}) {
    const start = Date.now();
    let lastCount = 0;
    let announced = false;
    while (Date.now() - start < timeoutMs) {
      if (await aborted()) return { ready: false, aborted: true, fields: [] };
      let fields = [];
      try {
        fields = (await this.detectFieldsInTab(tabId)).fields || [];
      } catch { /* keep polling */ }
      lastCount = fields.length;
      if (this.fieldsLookLikeForm(fields)) {
        if (announced || lastCount) {
          await push(`Formulaire prêt (${fields.length} champ(s) après attente SPA)`);
        }
        return { ready: true, fields };
      }
      let probe = { verdict: 'none' };
      try { probe = (await this.probeForm(tabId)).probe || probe; } catch { /* ignore */ }
      if (probe.verdict === 'application_form') {
        await push(`Formulaire prêt (probe) après attente SPA`);
        return { ready: true, fields, probe };
      }
      if (!announced) {
        announced = true;
        await push('Attente du formulaire SPA…');
      }
      await sleep(900);
    }
    await push(`Fin d’attente SPA — ${lastCount} champ(s) détecté(s)`);
    return { ready: false, fields: [] };
  }

  /**
   * Open the offer URL in the user's Chrome. Returns { tabId } or { error }.
   */
  async openOffer(url, { strict = false } = {}) {
    try {
      if (!(await this.waitUntilConnected())) {
        throw new Error('no apply-bridge extension connected (waited 5s)');
      }
      const opened = await this.openTab(url);
      if (!opened.tabId) throw new Error('open-tab returned no tabId');
      return { tabId: opened.tabId, url: opened.url || url };
    } catch (err) {
      if (strict) throw err;
      this.onLog(`openOffer failed: ${err.message}`);
      return { tabId: null, error: err.message };
    }
  }

  /**
   * Best-effort one-shot (legacy): open + fill identity only.
   */
  async detectAndFill(url, identity, { strict = false } = {}) {
    try {
      if (!(await this.waitUntilConnected())) {
        throw new Error('no apply-bridge extension connected (waited 5s)');
      }
      const detected = await this.detectFields(url);
      const updates = detected.fields
        .filter((f) => !f.value)
        .map((f) => ({ i: f.i, value: classifySimpleField(f, identity), label: f.label }))
        .filter((u) => u.value);
      if (!updates.length) return { tabId: detected.tabId, filled: [] };
      const result = await this.fillFields(detected.tabId, updates);
      const labelByI = new Map(updates.map((u) => [u.i, u.label]));
      return {
        tabId: detected.tabId,
        filled: (result.outcomes || []).map((o) => ({ ...o, label: labelByI.get(o.i) })),
      };
    } catch (err) {
      if (strict) throw err;
      this.onLog(`detectAndFill best-effort failure: ${err.message}`);
      return { tabId: null, filled: [], error: err.message };
    }
  }

  /**
   * True when the tab already has fillable application fields — even if the
   * scored probe says `none` (common on Greenhouse: form is on-screen but an
   * "Apply for this job" CTA still trips job_preview_cta and we scroll forever).
   */
  fieldsLookLikeForm(fields = []) {
    if (!fields.length) return false;
    const usable = fields.filter((f) => f.type !== 'hidden');
    const files = usable.filter((f) => f.type === 'file');
    const identity = usable.filter((f) => {
      const s = `${f.label} ${f.name} ${f.idAttr}`.toLowerCase();
      return /first[\s_-]*name|last[\s_-]*name|full[\s_-]*name|e-?mail|phone|tel\b|pr[ée]nom|nom de famille/.test(s)
        || f.type === 'email' || f.type === 'tel';
    });
    const textish = usable.filter((f) => ['text', 'email', 'tel', 'url', 'textarea', 'select-one', 'radio', 'checkbox'].includes(f.type)
      || f.tag === 'textarea' || f.tag === 'select' || f.contentEditable);
    if (files.length >= 1 && identity.length >= 1) return true;
    if (identity.length >= 2) return true;
    if (textish.length >= 4 && identity.length >= 1) return true;
    return false;
  }

  /**
   * Navigate inside `tabId` until an application form is found (or hops
   * exhausted), then fill what we can. Calls `onState` after each step.
   * `pollCommand` should return 'abort' | 'rescan' | 'submit' | 'manual_sent' | null.
   */
  async runApplyInTab(tabId, spec, {
    onState = async () => {},
    pollCommand = async () => null,
    maxHops = 12,
  } = {}) {
    const steps = [];
    const push = async (text, extra = {}) => {
      const at = new Date().toISOString();
      steps.push({ at, text });
      this.onLog(text);
      await onState({
        steps: [...steps],
        updatedAt: at,
        browserMode: 'extension',
        tabId,
        ...extra,
      });
    };

    const aborted = async () => (await pollCommand()) === 'abort';

    await push('Plugin: navigation vers le formulaire…', {
      state: 'navigating',
      message: 'Navigation dans l’onglet Chrome (plugin)…',
      filled: [],
      pending: [],
    });

    const attempted = new Set();
    const followedApplyLinks = new Set();
    let formFound = false;
    let originUrl = spec?.jobUrl || '';
    this._navAi = { nav: 0, review: 0 };
    const adoptContext = (extra = {}) => ({
      originUrl,
      role: spec?.role || '',
      company: spec?.company || '',
      expectedHref: extra.expectedHref || '',
      deadTabId: extra.deadTabId ?? null,
    });

    const followEmbeddedApplyLink = async () => {
      let link = null;
      try { link = await this.findEmbeddedApplyUrl(tabId); } catch { return false; }
      if (!link || followedApplyLinks.has(link)) return false;
      followedApplyLinks.add(link);
      await push(`Apply ouvre un lien externe → ${link}`);
      await this.navigateTab(tabId, link);
      await this.waitForFormReady(tabId, { push, aborted, timeoutMs: 18000 });
      return true;
    };

    const handOffRefused = async () => {
      await push('L’onglet d’origine s’est fermé et aucun onglet ouvert ne correspond à cette offre (domaine, URL, identifiant, formulaire).', {
        state: 'needs_human',
        message: 'Reprise d’onglet refusée. Ouvre le formulaire de cette offre puis « Re-scanner ».',
        pending: [{ label: 'navigation', reason: 'onglet non vérifié' }],
      });
      return this._commandLoop(tabId, spec, { onState, pollCommand, steps, push });
    };

    const adoptOpenedTab = async (click, hopLabel) => {
      let next = click;
      if (next?.openerGone) {
        const picked = await this.chooseAdoptTab(next.adoptCandidates || [], adoptContext({
          expectedHref: next.href || '',
          deadTabId: tabId,
        }), push);
        if (!picked) return 'refused';
        next = { ...next, openedTabId: picked.tabId, openedUrl: picked.url || '' };
      }
      if (!next?.openedTabId || next.openedTabId === tabId) return false;
      const dest = (/^https?:\/\//i.test(next.openedUrl || '') && next.openedUrl)
        || (/^https?:\/\//i.test(next.href || '') && next.href)
        || next.openedUrl
        || next.href
        || next.text
        || '';
      const verdict = acceptAdoptCandidate({
        url: /^https?:\/\//i.test(dest) ? dest : '',
        title: next.title || '',
        tabId: next.openedTabId,
      }, adoptContext({ expectedHref: next.href || '', deadTabId: tabId }), { trustedChild: !click?.openerGone });
      if (!verdict.ok) {
        await push(`Nouvel onglet écarté (${verdict.hardReject || (verdict.reasons || []).join(', ')}) — ${dest}`);
        return 'refused';
      }
      tabId = next.openedTabId;
      if (/^https?:\/\//i.test(next.href || '') && !/^https?:\/\//i.test(next.openedUrl || '')) {
        await this.navigateTab(tabId, next.href).catch(() => {});
      }
      await push(`Nouvel onglet → ${dest}${hopLabel}`, {
        state: 'navigating',
        message: 'Formulaire ouvert dans un nouvel onglet…',
        tabId,
      });
      // SmartRecruiters oneclick-ui (and similar SPAs) show a spinner before
      // fields exist — do not hop/scroll/give up while the form is loading.
      await this.waitForFormReady(tabId, { push, aborted, timeoutMs: 18000 });
      return true;
    };

    for (let hop = 0; hop < maxHops; hop++) {
      if (await aborted()) {
        await push('Annulé.', { state: 'aborted', message: 'Candidature annulée.' });
        return { ok: false, aborted: true };
      }

      try { await this.dismissCookies(tabId); } catch { /* ignore */ }

      // 1) Fields first — if the form is already on screen, fill it. Do NOT
      //    scroll/click Apply (that was the "only scrolls" bug on Greenhouse).
      let fields = [];
      try {
        const detected = await this.detectFieldsInTab(tabId);
        fields = detected.fields || [];
      } catch (err) {
        await push(`Detect fields: ${err.message}`);
        if (/No tab with id/i.test(String(err.message || ''))) {
          const recovered = await this.recoverLostTab(tabId, push, adoptContext());
          if (recovered) {
            tabId = recovered;
            await onState({ tabId, updatedAt: new Date().toISOString() });
            continue;
          }
          return handOffRefused();
        }
      }

      let probe = { verdict: 'none' };
      try {
        const res = await this.probeForm(tabId);
        probe = res.probe || { verdict: 'none' };
      } catch (err) {
        await push(`Probe: ${err.message}`);
        if (/No tab with id/i.test(String(err.message || ''))) {
          const recovered = await this.recoverLostTab(tabId, push, adoptContext());
          if (recovered) {
            tabId = recovered;
            await onState({ tabId, updatedAt: new Date().toISOString() });
            continue;
          }
          return handOffRefused();
        }
      }

      const fieldsOk = this.fieldsLookLikeForm(fields);
      if (probe.verdict === 'application_form' || fieldsOk) {
        formFound = true;
        await push(
          probe.verdict === 'application_form'
            ? `Formulaire détecté (probe score ${probe.score || '?'}: ${(probe.signals || []).join(', ') || 'ok'})`
            : `Formulaire détecté via champs (${fields.length} field(s), probe=${probe.verdict}/${probe.score || 0})`,
        );
        break;
      }

      await push(`Hop ${hop + 1}: pas encore de form (probe=${probe.verdict} score=${probe.score || 0}, fields=${fields.length})`);

      let tabInfo;
      try { tabInfo = await this.getTab(tabId); } catch { tabInfo = { url: '' }; }
      const url = tabInfo.url || '';

      if (probe.verdict === 'auth_wall') {
        await push(`Mur d’auth (${(probe.blockers || []).join(', ')}) — essai invité…`);
        const guestSkip = [...attempted].filter((k) => k.startsWith(`${url}::`)).map((k) => k.slice(url.length + 2));
        const guest = await this.clickProgression(tabId, GUEST_TEXT_RE, guestSkip, { scrollFirst: false }).catch(() => null);
        if (guest?.clicked) {
          attempted.add(`${url}::${guest.text}`);
          const adopted = await adoptOpenedTab(guest, '');
          if (adopted === 'refused') return handOffRefused();
          if (adopted) continue;
          await push(`Clic invité: « ${guest.text} »`);
          await sleep(2000);
          continue;
        }
        const guestAi = await this.askNavAi(tabId, {
          phase: 'navigate',
          url,
          skipTexts: guestSkip,
          fields,
        });
        if (guestAi?.log && !guestAi.skipped) await push(guestAi.log);
        if (guestAi?.action === 'click' && guestAi.text) {
          const guestClick = await this.clickExactLabel(tabId, guestAi.text).catch(() => null);
          if (guestClick?.clicked) {
            attempted.add(`${url}::${guestClick.text || guestAi.text}`);
            const adopted = await adoptOpenedTab(guestClick, '');
            if (adopted === 'refused') return handOffRefused();
            if (adopted) continue;
            await push(`Clic IA: « ${guestClick.text || guestAi.text} »`);
            await sleep(2000);
            continue;
          }
        }
        await push('Pas d’accès invité — intervention manuelle.', {
          state: 'needs_human',
          message: 'Connexion / compte requis dans l’onglet. Connecte-toi puis clique « Re-scanner ».',
          pending: [{ label: 'auth', reason: 'auth_wall' }],
        });
        return this._commandLoop(tabId, spec, { onState, pollCommand, steps, push });
      }

      const normalized = normalizeAtsUrl(url);
      if (normalized && normalized !== url) {
        await push(`URL ATS normalisée → ${normalized}`);
        await this.navigateTab(tabId, normalized);
        continue;
      }

      // Some ATS already render the form mid-page. Scroll it into view once
      // instead of clicking Apply (which just scrolls / no-ops).
      const ats = identifyAts(url);
      if (!originUrl) originUrl = url;
      if (ats?.behaviors?.includes('scroll-to-form') && hop === 0) {
        await this._request('scroll-tab', { tabId, deltaY: 900 }).catch(() => {});
        await sleep(1200);
        continue;
      }

      // Visible Apply on an aggregator often does not leave the page (login
      // modal). The destination is already in the HTML — open it here.
      if (await followEmbeddedApplyLink()) continue;

      const skipFor = (re) => [...attempted]
        .filter((k) => k.startsWith(`${url}::`))
        .map((k) => k.slice(url.length + 2));

      let clicked = null;
      for (const re of [GUEST_TEXT_RE, APPLY_TEXT_RE, PROGRESS_TEXT_RE]) {
        // Try without scroll first — form may already be in view.
        let res = await this.clickProgression(tabId, re, skipFor(re), { scrollFirst: false }).catch(() => null);
        if (!res?.clicked) {
          res = await this.clickProgression(tabId, re, skipFor(re), { scrollFirst: true }).catch(() => null);
        }
        if (res?.clicked) {
          attempted.add(`${url}::${res.text}`);
          clicked = res;
          break;
        }
      }

      if (!clicked) {
        if (await followEmbeddedApplyLink()) continue;
        // Last resort: if we saw ANY text inputs, try filling anyway.
        if (fields.length >= 2) {
          formFound = true;
          await push(`Aucun CTA — tentative de fill sur ${fields.length} champ(s) détectés`);
          break;
        }
        // SPA still spinning (SmartRecruiters oneclick-ui): wait once before
        // declaring "no Apply/Next" — scrolling during load finds nothing.
        if (hop < maxHops - 1) {
          const waited = await this.waitForFormReady(tabId, {
            push,
            aborted,
            timeoutMs: identifyAts(url)?.behaviors?.includes('wait-spa') ? 18000 : 12000,
          });
          if (waited.aborted) {
            await push('Annulé.', { state: 'aborted', message: 'Candidature annulée.' });
            return { ok: false, aborted: true };
          }
          if (waited.ready || (waited.fields || []).length >= 2) {
            formFound = true;
            break;
          }
        }
        const navAi = await this.askNavAi(tabId, {
          phase: 'navigate',
          url,
          skipTexts: [...attempted].filter((k) => k.startsWith(`${url}::`)).map((k) => k.slice(url.length + 2)),
          fields,
        });
        if (navAi?.log && !navAi.skipped) await push(navAi.log);
        if (navAi?.action === 'fill') {
          formFound = true;
          await push('IA nav: formulaire traité comme prêt à remplir');
          break;
        }
        if (navAi?.action === 'click' && navAi.text) {
          const res = await this.clickExactLabel(tabId, navAi.text).catch(() => null);
          if (res?.clicked) {
            attempted.add(`${url}::${res.text || navAi.text}`);
            clicked = res;
          }
        }
        if (!clicked) {
          await push('Aucun bouton Apply/Next et pas assez de champs.', {
            state: 'needs_human',
            message: 'Le formulaire est-il visible ? Clique « Re-scanner » si oui.',
            pending: [{ label: 'navigation', reason: 'pas de CTA' }],
          });
          return this._commandLoop(tabId, spec, { onState, pollCommand, steps, push });
        }
      }

      const adopted = await adoptOpenedTab(clicked, ` (hop ${hop + 1})`);
      if (adopted === 'refused') return handOffRefused();
      if (adopted) continue;

      // Same-tab navigation may have closed/replaced the tab without openedTabId.
      try {
        await this.getTab(tabId);
      } catch {
        const recovered = await this.recoverLostTab(tabId, push, adoptContext());
        if (recovered) {
          tabId = recovered;
          await onState({ tabId, updatedAt: new Date().toISOString() });
          continue;
        }
        return handOffRefused();
      }

      await push(`Clic: « ${clicked.text} »${clicked.href ? ` → ${clicked.href}` : ''} (hop ${hop + 1})`, {
        state: 'navigating',
        message: `Navigation… « ${clicked.text} »`,
      });
      await sleep(2000);
    }

    if (!formFound) {
      // One last detect before giving up.
      try {
        const detected = await this.detectFieldsInTab(tabId);
        if (this.fieldsLookLikeForm(detected.fields) || (detected.fields || []).length >= 3) {
          formFound = true;
          await push(`Dernière chance: ${detected.fields.length} champ(s) — fill`);
        }
      } catch { /* ignore */ }
    }

    if (!formFound) {
      await push('Limite de hops atteinte sans formulaire reconnu.', {
        state: 'needs_human',
        message: 'Formulaire visible ? Clique « Re-scanner » pour forcer le remplissage.',
      });
      return this._commandLoop(tabId, spec, { onState, pollCommand, steps, push });
    }

    if (await aborted()) {
      await push('Annulé.', { state: 'aborted', message: 'Candidature annulée.' });
      return { ok: false, aborted: true };
    }

    const fillResult = await this._fillPass(tabId, spec, { push, onState, steps });
    if (fillResult?.tabId) tabId = fillResult.tabId;
    return this._commandLoop(tabId, spec, { onState, pollCommand, steps, push });
  }

  async _fillPass(tabId, spec, { push, onState, steps }, { maxPages = 8 } = {}) {
    await push('Remplissage des champs dans l’onglet…', {
      state: 'filling',
      message: 'Remplissage (plugin)…',
    });

    let allFilled = [];
    let allPending = [];
    let uploadedLabels = [];
    let lastFingerprint = '';
    let noopFingerprint = '';
    let healUsed = false;

    const adoptIfOpened = async (click, label) => {
      if (!click?.openedTabId || click.openedTabId === tabId) return false;
      tabId = click.openedTabId;
      await push(`Nouvel onglet${label ? ` ${label}` : ''}: tab ${tabId}`);
      await onState({ tabId, updatedAt: new Date().toISOString() });
      await this.waitForFormReady(tabId, { push, timeoutMs: 15000 }).catch(() => {});
      lastFingerprint = '';
      noopFingerprint = '';
      return true;
    };

    for (let page = 0; page < maxPages; page++) {
      await sleep(600);

      const detected = await this.detectFieldsInTab(tabId);
      const fields = detected.fields || [];
      await push(`Detect: ${fields.length} champ(s) (page ${page + 1}, frames incluses)`);

      const { filled, pending, uploaded } = await this._fillOnce(tabId, spec, fields, { push });
      allFilled = mergeFilled(allFilled, filled);
      allPending = mergePending(allPending, pending, allFilled);
      uploadedLabels = [...new Set([...uploadedLabels, ...uploaded])];

      // Auto-retry fill failures (window fillFieldsWithRequiredRetry parity).
      let afterProbe = await this.detectFieldsInTab(tabId);
      let issuesProbe = (afterProbe.fields || []).flatMap((f) => {
        const reason = fieldCompletionIssue(f, { uploadedLabels });
        return reason ? [{ label: (f.label || f.name || f.type).slice(0, 80), reason }] : [];
      });
      const retryable = (allPending || []).filter((p) => RETRYABLE_PENDING_RE.test(String(p.reason || '')));
      const fileStillMissing = (issuesProbe || []).some((i) => /fichier requis|CV manquant/i.test(i.reason));
      if (retryable.length || fileStillMissing) {
        await push(`Relance auto: ${retryable.length || 1} échec(s) de remplissage…`);
        await sleep(700);
        const fields2 = (await this.detectFieldsInTab(tabId)).fields || fields;
        const second = await this._fillOnce(tabId, spec, fields2, { push });
        allFilled = mergeFilled(allFilled, second.filled);
        allPending = mergePending(
          allPending.filter((p) => !RETRYABLE_PENDING_RE.test(String(p.reason || ''))),
          second.pending,
          allFilled,
        );
        uploadedLabels = [...new Set([...uploadedLabels, ...second.uploaded])];
        afterProbe = await this.detectFieldsInTab(tabId);
        issuesProbe = (afterProbe.fields || []).flatMap((f) => {
          const reason = fieldCompletionIssue(f, { uploadedLabels });
          return reason ? [{ label: (f.label || f.name || f.type).slice(0, 80), reason }] : [];
        });
      }

      // Completion check on live DOM
      const after = afterProbe;
      const issues = issuesProbe;
      allPending = mergePending(allPending, issues, allFilled);
      lastFingerprint = await this._stepMark(tabId, after.fields || fields);

      let applyEntryVisible = false;
      try {
        const ev = await this.pageShowsApplyEntry(tabId);
        applyEntryVisible = ev?.result === true;
      } catch { /* ignore */ }

      const ready = looksReadyToSubmit({
        filled: allFilled,
        pending: allPending,
        applyEntryVisible,
      });

      const stepFields = after.fields || [];
      const chip = stepFields.find((f) => f.type === 'file' && String(f.fileChip || '').trim());
      if (chip && !allFilled.some((f) => /📎/.test(String(f.value || '')))) {
        const chipLabel = (chip.label || chip.name || 'Resume/CV').slice(0, 80);
        allFilled = mergeFilled(allFilled, [{ label: chipLabel, value: `📎 ${chip.fileChip}` }]);
        uploadedLabels = [...new Set([...uploadedLabels, chipLabel])];
      }
      const inspected = await this.inspectStep(tabId, stepFields);
      let reviewConfidence = reviewStepConfidence(inspected);
      let isReviewStep = reviewConfidence === 'high';
      let aiSubmitText = '';
      if (!isReviewStep && reviewStepNeedsAi(inspected)) {
        const ai = await this.askNavAi(tabId, {
          phase: 'review',
          fields: stepFields,
          heading: inspected.heading,
          bodySnippet: inspected.bodySnippet,
        });
        if (ai?.log && !ai.skipped) await push(ai.log);
        if (ai?.action === 'review') {
          isReviewStep = true;
          reviewConfidence = 'high';
        } else if (ai?.action === 'click' && ai.text) {
          const cls = classifyActionLabel(ai.text);
          if (cls.kind === 'submit' && cls.autoSubmit && cls.confidence === 'high') {
            isReviewStep = true;
            reviewConfidence = 'high';
            aiSubmitText = ai.text;
          } else if (cls.kind === 'ambiguous' || (cls.kind === 'submit' && !cls.autoSubmit)) {
            await push(`Libellé ambigu « ${ai.text} » — pas d’envoi automatique.`);
          } else {
            const moved = await this.clickExactAndSeeChange(tabId, ai.text, lastFingerprint);
            if (moved.opened && await adoptIfOpened(moved.opened, '(IA)')) {
              allPending = [];
              continue;
            }
            if (moved.changed) {
              allPending = [];
              lastFingerprint = '';
              noopFingerprint = '';
              continue;
            }
          }
        }
      }
      if (reviewConfidence === 'high') {
        isReviewStep = true;
        await push('Étape de vérification / récapitulatif détectée');
        try {
          const { count, filled: consentFilled } = await this.tickGateConsents(tabId, { push });
          if (count) allFilled = mergeFilled(allFilled, consentFilled);
        } catch { /* ignore */ }
        // Soft pending on a review screen (optional blanks) must not block Submit.
        allPending = allPending.filter((p) => isBlockingApplyPending(p.reason));
      }

      // Align with apply-runner: empty pending + Apply-entry still visible → open form / Next
      if (!allPending.length && applyEntryVisible) {
        const apply = await this.clickProgression(tabId, APPLY_TEXT_RE, [], { scrollFirst: true });
        if (apply?.clicked) {
          await push(`Ouverture formulaire: « ${apply.text || 'Apply'} »`);
          if (await adoptIfOpened(apply, '(Apply)')) {
            allPending = [];
            continue;
          }
          await sleep(1200);
          continue;
        }
      }

      // Multi-step wizards + review interstitial.
      // On a review/verify step, prefer Submit over Next ("Review" CTA).
      const hardBlock = allPending.some((p) => isBlockingApplyPending(p.reason));
      const hasCvAttachedEarly = allFilled.some((f) => /📎/.test(String(f.value || '')));
      const sawResumeSlotEarly = uploadedLabels.length > 0
        || stepFields.some((f) => f.type === 'file' && (f.required || isResumeFileField(f)));
      const cvBlocksSubmit = sawResumeSlotEarly && !hasCvAttachedEarly;

      let actionLabels = [];
      try { actionLabels = await this.listVisibleActionLabels(tabId); } catch { /* boutons inconnus */ }
      const controlsKnown = wizardControlsKnown(actionLabels);
      const progressVisible = progressionButtonVisible(actionLabels);
      const forwardVisible = forwardProgressVisible(actionLabels);
      const submitPick = submitChoice(actionLabels);
      const requiredEmpty = allPending.some((p) => isRequiredEmptyReason(p.reason));
      let blockAccidentalSubmit = false;
      // High-confidence review blocks Next only when Continue is not also on screen.
      // A "Review application" button on that screen is not a way forward.
      const treatAsFinalReview = reviewConfidence === 'high' && (!controlsKnown || !forwardVisible);
      const previousClickNoEffect = !!noopFingerprint && noopFingerprint === lastFingerprint;

      const canAdvance = page < maxPages - 1 && canAdvanceWizardStep({
        hardBlock,
        isReview: treatAsFinalReview,
        requiredEmpty,
        nextVisible: progressVisible,
        nextVisibilityKnown: controlsKnown,
        previousClickNoEffect,
      });

      if (treatAsFinalReview && !hardBlock) {
        // Fall through to submit path below — do not click "Review" again.
      } else if (canAdvance) {
        const next = await this.clickProgression(tabId, PROGRESS_TEXT_RE, [], { scrollFirst: true });
        const nextClass = classifyActionLabel(next?.text || '');
        if (next?.clicked && nextClass.kind !== 'submit' && nextClass.kind !== 'ambiguous' && !SUBMIT_TEXT_RE.test(String(next.text || ''))) {
          await push(`Étape suivante: « ${next.text || 'Next'} »`);
          if (await adoptIfOpened(next, '(Next)')) {
            allPending = [];
            continue;
          }
          // Wait until the wizard actually changes (URL, heading, or fields).
          let changed = false;
          for (let i = 0; i < 20; i++) {
            await sleep(400);
            try {
              const now = await this.detectFieldsInTab(tabId);
              const sig = await this._stepMark(tabId, now.fields || []);
              if (sig && sig !== lastFingerprint) { changed = true; break; }
            } catch { /* keep polling */ }
          }
          if (changed) {
            allPending = [];
            lastFingerprint = '';
            noopFingerprint = '';
            healUsed = false;
            continue;
          }
          if (!healUsed) {
            healUsed = true;
            const healed = await this._refillInvalid(tabId, spec, { push });
            if (healed) {
              const next2 = await this.clickProgression(tabId, PROGRESS_TEXT_RE, [], { scrollFirst: true });
              if (next2?.clicked && !SUBMIT_TEXT_RE.test(String(next2.text || ''))) {
                await push(`Nouvel essai après correction: « ${next2.text || 'Next'} »`);
                if (await adoptIfOpened(next2, '(Next)')) {
                  allPending = [];
                  healUsed = false;
                  continue;
                }
                let advanced = false;
                for (let i = 0; i < 20; i++) {
                  await sleep(400);
                  try {
                    const now = await this.detectFieldsInTab(tabId);
                    const sig = await this._stepMark(tabId, now.fields || []);
                    if (sig && sig !== lastFingerprint) { advanced = true; break; }
                  } catch { /* keep polling */ }
                }
                if (advanced) {
                  allPending = [];
                  lastFingerprint = '';
                  noopFingerprint = '';
                  healUsed = false;
                  continue;
                }
              }
            }
          }
          // Next did not change the step. Do not turn that into a send.
          noopFingerprint = lastFingerprint;
          blockAccidentalSubmit = true;
          await push('Next sans effet — envoi automatique évité.');
          const stuckAi = await this.askNavAi(tabId, {
            phase: 'stuck',
            fields: stepFields,
            heading: inspected.heading,
            bodySnippet: inspected.bodySnippet,
            skipTexts: [next.text].filter(Boolean),
          });
          if (stuckAi?.log && !stuckAi.skipped) await push(stuckAi.log);
          if (stuckAi?.action === 'click' && stuckAi.text) {
            const cls = classifyActionLabel(stuckAi.text);
            if (cls.kind === 'submit' || cls.kind === 'ambiguous') {
              await push(`« ${stuckAi.text} » non utilisé comme envoi après un Next sans effet.`);
            } else {
              const moved = await this.clickExactAndSeeChange(tabId, stuckAi.text, lastFingerprint);
              if (moved.opened && await adoptIfOpened(moved.opened, '(IA)')) {
                allPending = [];
                continue;
              }
              if (moved.changed) {
                allPending = [];
                lastFingerprint = '';
                noopFingerprint = '';
                blockAccidentalSubmit = false;
                continue;
              }
            }
          }
          await push('Next cliqué mais même étape — validation ATS probable, on reste ici.');
        }
      }

      const message = allPending.length
        ? `Formulaire — ${allFilled.length} rempli(s), ${allPending.length} à compléter.`
        : treatAsFinalReview
          ? `Vérification — prêt à envoyer (${allFilled.length} champ(s)).`
          : ready
            ? `Formulaire prêt — ${allFilled.length} champ(s). Vérifie puis envoie.`
            : `Formulaire — ${allFilled.length} champ(s) remplis.`;

      await onState({
        state: allPending.length ? 'needs_human' : 'ready_to_review',
        message,
        filled: allFilled,
        pending: allPending,
        steps: [...steps],
        browserMode: 'extension',
        tabId,
        updatedAt: new Date().toISOString(),
      });

      // Hard-block submit when a resume was detected/attempted but never landed.
      const resumeStillPending = allPending.some(
        (p) => isBlockingApplyPending(p.reason)
          || /resume|\bcv\b|upload|fichier|CV /i.test(String(p.reason || ''))
          || /resume|\bcv\b/i.test(String(p.label || '')),
      );
      if (cvBlocksSubmit) {
        await push('CV manquant — envoi bloqué jusqu’à upload réussi.');
        if (!resumeStillPending) {
          allPending = mergePending(
            allPending,
            [{ label: 'Resume/CV', reason: 'CV manquant — upload non confirmé' }],
            allFilled,
          );
        }
        await onState({
          state: 'needs_human',
          message: `Formulaire — ${allFilled.length} rempli(s), ${allPending.length} à compléter (CV requis).`,
          filled: allFilled,
          pending: allPending,
          steps: [...steps],
          browserMode: 'extension',
          tabId,
          updatedAt: new Date().toISOString(),
        });
      }

      // Review step OR ready form → auto-submit (identity from earlier steps counts).
      // A failed Next must not become a send, and an ambiguous label never auto-sends.
      let canSubmit = (ready || (treatAsFinalReview && allFilled.length >= 1))
        && spec.autoSubmit
        && !allPending.length
        && !cvBlocksSubmit;
      if (blockAccidentalSubmit && !shouldAttemptSubmitAfterNoopNext({
        submitButtonVisible: submitPick.allow && submitPick.confidence === 'high',
        reviewConfidence: treatAsFinalReview ? 'high' : 'none',
        requiredEmpty,
        hardBlock: hardBlock || cvBlocksSubmit,
        progressStillVisible: true,
      })) {
        canSubmit = false;
      }
      if (controlsKnown && submitPick.ambiguous) {
        if (canSubmit) await push(`Libellé ambigu « ${submitPick.ambiguousText} » — pas d’envoi automatique.`);
        canSubmit = false;
      } else if (controlsKnown && !submitPick.allow && !treatAsFinalReview) {
        canSubmit = false;
      }
      if (canSubmit) {
        try {
          const { count, filled: consentFilled } = await this.tickGateConsents(tabId, { push });
          if (count) allFilled = mergeFilled(allFilled, consentFilled);
          const pre = await this.detectFieldsInTab(tabId);
          const stale = (pre.fields || []).flatMap((f) => {
            const reason = fieldCompletionIssue(f, { uploadedLabels });
            return reason ? [{ label: (f.label || f.name || f.type).slice(0, 80), reason }] : [];
          });
          if (stale.length) {
            await push(`Avant envoi: ${stale.length} champ(s) invalide(s) — correction…`);
            await this._refillInvalid(tabId, spec, { push });
            const pre2 = await this.detectFieldsInTab(tabId);
            const stale2 = (pre2.fields || []).flatMap((f) => {
              const reason = fieldCompletionIssue(f, { uploadedLabels });
              return reason ? [{ label: (f.label || f.name || f.type).slice(0, 80), reason }] : [];
            });
            if (stale2.length) {
              allPending = mergePending(allPending, stale2, allFilled);
              await push(`Avant envoi: ${stale2.length} champ(s) encore invalide(s) — envoi reporté.`);
              await onState({
                state: 'needs_human',
                message: `✋ ${stale2.length} champ(s) à corriger avant envoi.`,
                filled: allFilled,
                pending: allPending,
                steps: [...steps],
                browserMode: 'extension',
                tabId,
                updatedAt: new Date().toISOString(),
              });
              return { filled: allFilled, pending: allPending, submitted: false, tabId };
            }
          }
        } catch { /* proceed */ }
        await push('Envoi automatique (plugin)…', { state: 'submitting', message: 'Envoi de la candidature…' });
        const clicked = await this.clickSend(tabId, aiSubmitText).catch((err) => {
          this.onLog(`clickSubmit failed: ${err.message}`);
          return null;
        });
        if (clicked?.clicked && !clicked.rejected) {
          await onState({
            state: 'submitted',
            message: 'Candidature envoyée (plugin). Vérifie la confirmation dans l’onglet.',
            filled: allFilled,
            pending: [],
            steps: [...steps],
            browserMode: 'extension',
            tabId,
            updatedAt: new Date().toISOString(),
          });
          return { filled: allFilled, pending: [], submitted: true, tabId };
        }
        if (clicked?.rejected) {
          // One targeted refill of aria-invalid fields, then Privacy, then one resend.
          let recovered = false;
          try {
            await this._refillInvalid(tabId, spec, { push });
            const { count, filled: consentFilled } = await this.tickGateConsents(tabId, { push });
            if (count) allFilled = mergeFilled(allFilled, consentFilled);
            await sleep(500);
            const retry = await this.clickSubmit(tabId).catch(() => null);
            if (retry?.clicked && !retry.rejected) {
              recovered = true;
              await onState({
                state: 'submitted',
                message: 'Candidature envoyée (plugin, après correction). Vérifie la confirmation dans l’onglet.',
                filled: allFilled,
                pending: [],
                steps: [...steps],
                browserMode: 'extension',
                tabId,
                updatedAt: new Date().toISOString(),
              });
              return { filled: allFilled, pending: [], submitted: true, tabId };
            }
          } catch { /* fall through to needs_human */ }
          if (!recovered) {
            const reason = `envoi refusé — ${clicked.errorCount} champ(s) invalide(s)${clicked.sample ? ` (« ${clicked.sample} »)` : ''}`;
            await push(`Envoi refusé par le formulaire: ${reason}`);
            allPending = mergePending(allPending, [{ label: 'Envoi', reason }], allFilled);
            await onState({
              state: 'needs_human',
              message: `⚠️ Envoi refusé — ${clicked.errorCount} champ(s) invalide(s)${clicked.sample ? ` (« ${clicked.sample} »)` : ''}. Corrige dans Chrome puis « Envoyer » ou « Re-scanner ».`,
              filled: allFilled,
              pending: allPending,
              steps: [...steps],
              browserMode: 'extension',
              tabId,
              updatedAt: new Date().toISOString(),
            });
            return { filled: allFilled, pending: allPending, submitted: false, tabId };
          }
        }
        if (!clicked?.clicked) {
          const sendAi = await this.askNavAi(tabId, {
            phase: 'stuck',
            fields: stepFields,
            heading: inspected.heading,
            bodySnippet: inspected.bodySnippet,
            skipTexts: [aiSubmitText].filter(Boolean),
          });
          if (sendAi?.log && !sendAi.skipped) await push(sendAi.log);
          if (sendAi?.action === 'click' && sendAi.text) {
            const exact = await this.clickExactLabel(tabId, sendAi.text).catch(() => null);
            if (exact?.clicked && !exact.rejected) {
              await onState({
                state: 'submitted',
                message: 'Candidature envoyée (plugin, bouton choisi par IA). Vérifie la confirmation dans l’onglet.',
                filled: allFilled,
                pending: [],
                steps: [...steps],
                browserMode: 'extension',
                tabId,
                updatedAt: new Date().toISOString(),
              });
              return { filled: allFilled, pending: [], submitted: true, tabId };
            }
          }
        }
        await push('Bouton Submit introuvable — confirme manuellement dans l’onglet.');
      }

      return { filled: allFilled, pending: allPending, submitted: false, tabId };
    }

    await onState({
      state: allPending.length ? 'needs_human' : 'ready_to_review',
      message: `Limite d’étapes — ${allFilled.length} rempli(s).`,
      filled: allFilled,
      pending: allPending,
      steps: [...steps],
      browserMode: 'extension',
      tabId,
      updatedAt: new Date().toISOString(),
    });
    return { filled: allFilled, pending: allPending, submitted: false, tabId };
  }

  async _fillOnce(tabId, spec, fields, { push }) {
    const usedAnswers = new Set();
    const filled = [];
    const pending = [];
    const unresolved = [];
    const uploaded = [];

    // Phase A — file uploads first (Ashby autofill from resume). Re-collect
    // after each upload: ATS re-render invalidates data-co-i markers.
    const doneFiles = new Set();
    for (let pass = 0; pass < 4; pass++) {
      let fileFields;
      try {
        fileFields = ((await this.detectFieldsInTab(tabId)).fields || []).filter((x) => x.type === 'file');
      } catch {
        fileFields = fields.filter((x) => x.type === 'file');
      }
      // Ashby sometimes hides the resume input so hard that collect misses it.
      // Probe raw file inputs and synthesize a resume field when needed.
      if (!fileFields.length && pass === 0 && spec.cvPath) {
        try {
          const probe = await this._request('eval-in-tab', {
            tabId,
            src: `(() => {
              const deep = (root, sel) => {
                const out = [];
                const walk = (n) => {
                  if (!n?.querySelectorAll) return;
                  try { out.push(...n.querySelectorAll(sel)); } catch {}
                  for (const el of n.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot);
                };
                walk(root);
                return out;
              };
              const files = deep(document, 'input[type="file"]');
              const score = (el) => {
                const blob = ((el.name||'')+' '+(el.id||'')+' '+(el.accept||'')+' '+(el.getAttribute('aria-label')||'')).toLowerCase();
                let s = 0;
                if (/resume|\\bcv\\b|curriculum|autofill|_systemfield_resume/.test(blob)) s += 50;
                if (/pdf|msword|officedocument/.test(el.accept||'')) s += 20;
                if (/cover|lettre|reference|diploma|other/.test(blob) && !/resume|\\bcv\\b/.test(blob)) s -= 80;
                return s;
              };
              files.sort((a,b) => score(b)-score(a));
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
                frameId: 0,
                fileCount: el.files?.length || 0,
              };
            })()`,
          });
          if (probe?.result?.type === 'file') {
            fileFields = [probe.result];
            await push(`CV slot forcé (input caché): ${fileFields[0].label || fileFields[0].name}`);
          }
        } catch { /* keep empty */ }
      }
      if (!fileFields.length && pass === 0) {
        await push('Aucun champ fichier détecté — CV non tenté sur cette page.');
      }
      const todo = fileFields.find((f) => !doneFiles.has((f.label || f.name || 'file').slice(0, 80)));
      if (!todo) break;
      const labelShort = (todo.label || todo.name || 'file').slice(0, 80);
      doneFiles.add(labelShort);
      const plan = classifyField(todo, spec, usedAnswers);
      // Dropzones ("Choose a file…") count as resume slots even without HTML required.
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
      if (!existsSync(plan.upload)) {
        pending.push({ label: labelShort, reason: `CV introuvable: ${basename(plan.upload)}` });
        continue;
      }
      await push(`Upload CV: ${basename(plan.upload)}…`);
      try {
        const result = await this.uploadFile(tabId, {
          i: todo.i,
          frameId: todo.frameId ?? 0,
          path: plan.upload,
        });
        if (result?.uploadOk) {
          filled.push({ label: labelShort, value: `📎 ${basename(plan.upload)}` });
          uploaded.push(labelShort);
          await push(`CV attaché: ${basename(plan.upload)}`);
          await sleep(900);
          const auto = await this.waitResumeAutofill(tabId, spec?.identity || {});
          if (auto.status === 'matched') {
            await push('Autofill ATS: nom ou email recopié.');
          } else if (auto.status === 'mismatch') {
            const detail = (auto.mismatches || []).map((m) => m.kind).join(', ') || 'identité';
            await push(`Autofill ATS incorrect (${detail}) — correction avec le profil.`);
          } else if (auto.status === 'partial') {
            await push('Autofill ATS partiel — les champs vides seront remplis.');
          } else if (auto.manualFill) {
            await push('Autofill ATS absent après le délai — remplissage manuel des champs identité.');
          }
        } else {
          const reason = `upload échoué: ${result?.error || 'unknown'}`;
          await push(`CV non attaché — ${reason}`);
          pending.push({ label: labelShort, reason });
        }
      } catch (err) {
        const reason = `upload échoué: ${String(err.message || err).slice(0, 80)}`;
        await push(`CV non attaché — ${reason}`);
        pending.push({ label: labelShort, reason });
      }
    }

    // Re-collect after uploads (form may have re-rendered)
    let live = fields;
    if (uploaded.length) {
      try {
        live = (await this.detectFieldsInTab(tabId)).fields || fields;
      } catch { /* keep */ }
    }

    // Phase B — deterministic classify
    const updates = [];
    for (const f of live) {
      if (f.type === 'file') continue;
      if (!shouldFillField(f) && !(f.type === 'checkbox' && f.required)) {
        // Still fill core identity even when shouldFill is false? shouldFill already covers identity.
        continue;
      }
      const alreadyFilled = f.value && f.type !== 'radio' && f.type !== 'checkbox';
      const invalid = !!(f.ariaInvalid || f.invalid);
      if (alreadyFilled && f.type !== 'checkbox' && !invalid) continue;
      if (f.type === 'checkbox' && f.checked) continue;
      if (f.type === 'radio' && f.groupChecked) continue;

      const plan = classifyField(f, spec, usedAnswers);
      if (plan?.fromQuestion) usedAnswers.add(plan.fromQuestion);
      const labelShort = (f.label || f.name || f.type).slice(0, 80);

      if (!plan) {
        if (f.required && !f.value) unresolved.push(f);
        continue;
      }
      if (plan.skip) {
        if (plan.declinePreferred && f.required && (f.tag === 'select' || f.type === 'radio' || isComboboxField(f))) {
          const decline = pickDeclineOption(f.options || []);
          if (decline) {
            updates.push({
              i: f.i,
              frameId: f.frameId ?? 0,
              value: decline.text,
              selectText: decline.text,
              label: labelShort,
              declined: true,
              choice: f.type === 'radio',
            });
            continue;
          }
          // Options not scraped yet — hand DECLINE_RE to the extension to open
          // the list and pick (stronger than window when stamps are empty).
          updates.push({
            i: f.i,
            frameId: f.frameId ?? 0,
            value: '',
            selectText: '',
            selectPrefer: serializePrefer(DECLINE_RE),
            label: labelShort,
            declined: true,
            choice: f.type === 'radio' || isComboboxField(f),
          });
          continue;
        }
        if (plan.currentRoleEnd) continue;
        if (plan.leaveBlank) {
          if (f.required) pending.push({ label: labelShort, reason: plan.skip || 'requis — pas de donnée profil' });
          continue;
        }
        if (f.required) unresolved.push(f);
        continue;
      }

      const update = planToUpdate(f, plan);
      if (!update) {
        if (f.required) unresolved.push(f);
        continue;
      }
      updates.push(update);
    }

    if (updates.length) {
      await push(`Fill: envoi de ${updates.length} valeur(s)…`);
      const result = await this.fillFields(tabId, updates.filter((u) => !u.upload));
      const labelByKey = new Map(updates.map((u) => [`${u.frameId ?? 0}:${u.i}`, u.label]));
      const fieldByKey = new Map(live.map((f) => [`${f.frameId ?? 0}:${f.i}`, f]));
      for (const o of result.outcomes || []) {
        const key = `${o.frameId ?? 0}:${o.i}`;
        const lab = labelByKey.get(key) || `field#${o.i}`;
        const field = fieldByKey.get(key);
        const update = updates.find((u) => `${u.frameId ?? 0}:${u.i}` === key);
        const landed = String(o.actualValue ?? '').trim();
        const choiceLanded = field?.type === 'radio' || update?.choice
          ? /^(yes|no|oui|non)\b/i.test(landed) || !!landed
          : false;
        const choiceOk = update?.check || (field?.type === 'checkbox' && /checked/i.test(landed)) || choiceLanded;
        if (o.ok && (landed || choiceOk) && !(field?.type === 'radio' && /^(unchecked)?$/i.test(landed))) {
          filled.push({ label: lab, value: o.actualValue || '' });
        } else if (fieldLooksRequired(field) || field?.required) {
          unresolved.push(field || { label: lab, required: true, i: o.i, frameId: o.frameId ?? 0, type: 'text' });
        } else {
          pending.push({ label: lab, reason: o.reason || (o.ok ? 'valeur non retenue par le formulaire' : 'échec fill') });
        }
      }
      await push(`Rempli ${filled.length} champ(s) (pass déterministe)`);
    }

    // Phase C — LLM for unresolved required fields
    if (unresolved.length) {
      // Re-collect so data-co-i / data-co-opt markers (and option lists) are fresh
      // after Phase B fills — Ashby remounts wipe stamps and broke radio clicks.
      let freshFields = live;
      try {
        freshFields = (await this.detectFieldsInTab(tabId)).fields || live;
      } catch { /* keep */ }
      const byLabel = new Map();
      for (const f of freshFields) {
        const k = String(f.label || f.name || '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 80);
        if (k) byLabel.set(k, f);
      }
      const rematch = (f) => {
        const k = String(f.label || f.name || '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 80);
        return (k && byLabel.get(k)) || f;
      };

      const uniq = [];
      const seen = new Set();
      for (const f of unresolved) {
        const liveF = rematch(f);
        const key = `${liveF.i}|${liveF.label}|${liveF.type}`;
        if (seen.has(key)) continue;
        seen.add(key);
        uniq.push(liveF);
      }
      await push(`Résolution intelligente de ${uniq.length} champ(s)…`);
      const declineTargets = [];
      const llmTargets = [];
      for (const f of uniq) {
        const opt = pickDeclineOption(f.options || []);
        if (opt) declineTargets.push({ f, opt });
        else llmTargets.push(f);
      }
      // Scrape combobox options before LLM (window parity) so the model picks
      // a real list entry instead of paraphrasing into a miss.
      for (const f of llmTargets) {
        if ((!f.options || !f.options.length) && (isComboboxField(f) || f.tag === 'select')) {
          const scraped = await this.scrapeComboboxOptions(tabId, f);
          if (scraped.length) f.options = scraped;
        }
      }
      // Re-route newly-scraped decline options away from the LLM.
      for (let i = llmTargets.length - 1; i >= 0; i--) {
        const f = llmTargets[i];
        const opt = pickDeclineOption(f.options || []);
        if (opt) {
          declineTargets.push({ f, opt });
          llmTargets.splice(i, 1);
        }
      }
      const llmUpdates = [];
      for (const { f, opt } of declineTargets) {
        llmUpdates.push({
          i: f.i,
          frameId: f.frameId ?? 0,
          value: opt.text,
          selectText: opt.text,
          label: (f.label || f.name || f.type).slice(0, 80),
          declined: true,
          options: f.options,
          choice: f.type === 'radio',
        });
      }
      let answers = {};
      try {
        answers = await resolveUnknownFields({
          fields: llmTargets.map((f) => ({
            i: f.i,
            label: f.label,
            kind: llmKind(f),
            required: f.required,
            multiple: fieldIsMulti(f),
            options: f.options,
          })),
          spec,
          cvSummary: cvSummaryText(),
          styleGuide: profileVoice(),
        });
      } catch (err) {
        await push(`LLM indisponible (${String(err.message || err).slice(0, 70)})`);
      }
      for (const f of llmTargets) {
        const ans = answers[String(f.i)];
        const labelShort = (f.label || f.name || f.type).slice(0, 80);
        if (!ans) {
          if (f.required) pending.push({ label: labelShort, reason: 'sans réponse — à remplir manuellement' });
          continue;
        }
        const text = Array.isArray(ans) ? ans[0] : String(ans);
        if (hasUnresolvedPlaceholder(text)) {
          if (f.required) pending.push({ label: labelShort, reason: 'réponse LLM avec placeholder' });
          continue;
        }
        // Prefer a listed option text when the LLM paraphrases Yes/No.
        let selectText = polishApplicationAnswer(text);
        if (Array.isArray(f.options) && f.options.length) {
          const picked = pickSelectOption(f.options, { yesNo: /^(yes|oui)\b/i.test(selectText) ? 'yes' : /^(no|non)\b/i.test(selectText) ? 'no' : null, selectText, value: selectText }, f.label);
          if (picked?.text) selectText = picked.text;
        }
        llmUpdates.push({
          i: f.i,
          frameId: f.frameId ?? 0,
          value: selectText,
          selectText,
          label: labelShort,
          llm: true,
          options: f.options,
          choice: f.type === 'radio',
        });
      }
      if (llmUpdates.length) {
        const result = await this.fillFields(tabId, llmUpdates);
        const labelByI = new Map(llmUpdates.map((u) => [u.i, u.label]));
        for (const o of result.outcomes || []) {
          if (o.ok) filled.push({ label: labelByI.get(o.i) || `field#${o.i}`, value: o.actualValue || '', llm: true });
          else if (llmUpdates.find((u) => u.i === o.i)) {
            pending.push({
              label: labelByI.get(o.i),
              reason: `réponse suggérée — ${o.reason || 'option introuvable'}`,
            });
          }
        }
      }
    }

    // Reconcile profile fields that ATS autofill may have wrong
    try {
      const fresh = (await this.detectFieldsInTab(tabId)).fields || [];
      const recon = [];
      for (const f of fresh) {
        if (f.type === 'file' || f.type === 'checkbox' || f.type === 'radio') continue;
        if (!shouldFillField(f)) continue;
        const plan = classifyField(f, spec);
        if (!plan || plan.skip || plan.check || plan.resume) continue;
        const want = polishApplicationAnswer(plan.value || plan.selectText || (plan.yesNo === 'yes' ? 'Yes' : plan.yesNo === 'no' ? 'No' : ''));
        if (!want || !shouldReplaceFilledValue(f, f.value, want)) continue;
        recon.push({
          i: f.i,
          frameId: f.frameId ?? 0,
          value: want,
          selectText: want,
          label: (f.label || f.name || f.type).slice(0, 80),
        });
      }
      if (recon.length) {
        const result = await this.fillFields(tabId, recon);
        for (const o of result.outcomes || []) {
          if (!o.ok) continue;
          const lab = recon.find((u) => u.i === o.i)?.label;
          if (!lab) continue;
          const rec = { label: lab, value: o.actualValue || '', reconciled: true };
          const idx = filled.findIndex((x) => x.label === lab);
          if (idx >= 0) filled[idx] = rec;
          else filled.push(rec);
        }
      }
    } catch { /* best-effort */ }

    const filledLabels = new Set(filled.map((f) => f.label));
    return {
      filled,
      pending: pending.filter((p) => !filledLabels.has(p.label)),
      uploaded,
    };
  }

  /** Tick unchecked application-gate consents; returns how many were sent. */
  async tickGateConsents(tabId, { push } = {}) {
    const live = (await this.detectFieldsInTab(tabId)).fields || [];
    const consentUpdates = [];
    for (const f of live) {
      if (f.type !== 'checkbox' && f.role !== 'checkbox' && f.role !== 'switch') continue;
      if (f.checked || f.groupChecked) continue;
      if (!isApplicationGateConsent(f) && !(/privacy|i agree|by submitting/i.test(`${f.label || ''}`))) continue;
      consentUpdates.push({
        i: f.i,
        frameId: f.frameId ?? 0,
        value: 'yes',
        check: true,
        label: (f.label || f.name || 'consent').slice(0, 80),
      });
    }
    if (!consentUpdates.length) return { count: 0, filled: [] };
    if (push) await push(`Consentement manquant — cochetage de ${consentUpdates.length} case(s)…`);
    await this.fillFields(tabId, consentUpdates);
    return {
      count: consentUpdates.length,
      filled: consentUpdates.map((u) => ({ label: u.label, value: '☑' })),
    };
  }

  async _commandLoop(tabId, spec, { onState, pollCommand, steps, push }) {
    // Keep updatedAt fresh so the UI stale-watchdog doesn't disable buttons,
    // and honour rescan / abort / submit / manual_sent (submit = click Send).
    for (;;) {
      await sleep(1500);
      const action = await pollCommand();
      const now = new Date().toISOString();

      if (action === 'abort') {
        await push('Annulé.', { state: 'aborted', message: 'Candidature annulée.', updatedAt: now });
        return { ok: false, aborted: true };
      }
      if (action === 'rescan') {
        await push('Re-scan demandé…', { state: 'finding_form', message: 'Re-scan du formulaire…', updatedAt: now });
        // Try fill on current page first; if no form, resume nav hops.
        let probe;
        try { probe = (await this.probeForm(tabId)).probe; } catch { probe = { verdict: 'none' }; }
        if (probe?.verdict === 'application_form') {
          const fillResult = await this._fillPass(tabId, spec, { push, onState, steps });
          if (fillResult?.tabId) tabId = fillResult.tabId;
        } else {
          return this.runApplyInTab(tabId, spec, { onState, pollCommand });
        }
        continue;
      }
      if (action === 'manual_sent') {
        await push('Envoi confirmé manuellement.', {
          state: 'submitted',
          message: '📨 Envoi confirmé manuellement.',
          updatedAt: now,
        });
        return { ok: true, submitted: true };
      }
      if (action === 'submit') {
        await push('Envoi demandé…', { state: 'submitting', message: 'Envoi de la candidature…', updatedAt: now });
        try {
          await this.tickGateConsents(tabId, { push });
        } catch { /* proceed */ }
        const clicked = await this.clickSubmit(tabId).catch(() => null);
        if (clicked?.clicked && !clicked.rejected) {
          await push(`Submit cliqué: « ${clicked.text || 'Submit'} »`, {
            state: 'submitted',
            message: 'Candidature envoyée (plugin). Vérifie la confirmation dans l’onglet.',
            updatedAt: new Date().toISOString(),
          });
          return { ok: true, submitted: true };
        }
        if (clicked?.rejected) {
          try {
            await this._refillInvalid(tabId, spec, { push });
            await this.tickGateConsents(tabId, { push });
            await sleep(500);
            const retry = await this.clickSubmit(tabId).catch(() => null);
            if (retry?.clicked && !retry.rejected) {
              await push(`Submit cliqué après correction: « ${retry.text || 'Submit'} »`, {
                state: 'submitted',
                message: 'Candidature envoyée (plugin, après correction). Vérifie la confirmation dans l’onglet.',
                updatedAt: new Date().toISOString(),
              });
              return { ok: true, submitted: true };
            }
          } catch { /* fall through */ }
          await push(`Envoi refusé par le formulaire (${clicked.errorCount} champ(s) invalide(s))`, {
            state: 'needs_human',
            message: `⚠️ Envoi refusé — ${clicked.errorCount} champ(s) invalide(s)${clicked.sample ? ` (« ${clicked.sample} »)` : ''}. Corrige dans Chrome puis « Envoyer » ou « Re-scanner ».`,
            updatedAt: new Date().toISOString(),
          });
          continue;
        }
        await push('Bouton Submit introuvable — confirme manuellement dans l’onglet.', {
          state: 'needs_human',
          message: 'Clique Submit / Send dans l’onglet Chrome.',
          updatedAt: now,
        });
        continue;
      }

      // Heartbeat
      await onState({ updatedAt: now, browserMode: 'extension', tabId });
    }
  }
}

export function attachApplyBridge(httpServer, bridge, { path = '/apply-bridge', log = () => {} } = {}) {
  bridge.onLog = log;
  const wss = new WebSocketServer({ noServer: true });
  httpServer.on('upgrade', (req, socket, head) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { return; }
    if (url.pathname !== path) return;
    wss.handleUpgrade(req, socket, head, (ws) => {
      // Single log line — the extension also sends `hello`; logging both made
      // every reconnect look like two separate events in the dashboard log.
      bridge.attach(ws);
      log('extension socket attached');
    });
  });
  return wss;
}

export function createStandaloneApplyBridge(bridge, { host = '127.0.0.1', port = 8934, log = () => {} } = {}) {
  bridge.onLog = log;
  const wss = new WebSocketServer({ host, port });
  wss.on('connection', (socket) => {
    log('extension connected');
    bridge.attach(socket);
  });
  wss.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      log(`port ${port} is already in use — is another dev-bridge already running?`);
      process.exit(1);
    }
    throw err;
  });
  return wss;
}
