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
import { AUTH_AVOID_TEXT_RE, GUEST_TEXT_RE } from '../lib/form-detect.mjs';
import { classifyField } from '../lib/apply-classify.mjs';
import { resolveUnknownFields, polishApplicationAnswer, hasUnresolvedPlaceholder } from '../lib/apply-llm.mjs';
import { loadApplicationVoice, loadCvSummary } from '../lib/application-writing.mjs';
import {
  shouldFillField,
  isResumeFileField,
  isComboboxField,
  listTypeQuery,
  fieldIsMulti,
  shouldReplaceFilledValue,
  fieldLooksRequired,
  isApplicationGateConsent,
} from '../lib/apply-fill-guards.mjs';
import { choiceKind } from '../lib/apply-option-match.mjs';
import { pickDeclineOption, pickSelectOption, llmKind, yesNoText, DECLINE_RE } from '../lib/apply-select.mjs';
import {
  fieldCompletionIssue,
  looksReadyToSubmit,
  shouldUploadFileField,
  fieldLabel,
  completionIssues,
  mergeFilled,
  mergePending,
} from '../lib/apply-completion.mjs';
import { COMMAND_IDLE_MS, UI_BUTTONS } from '../lib/apply-runtime.mjs';
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
  askNavDecision,
  exactControlPattern,
} from '../lib/apply-nav-llm.mjs';
import { identifyAts, normalizeAtsUrl } from './apply-ats.mjs';
import { acceptAdoptCandidate } from './apply-tab-match.mjs';
import { waitForAutofill, autofillLogLine } from './apply-autofill.mjs';

export { normalizeAtsUrl, identifyAts };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Identity-only value for one field (extension/dev-bridge.mjs smoke test). */
export function classifySimpleField(f, identity) {
  return classifyField(f, { identity, answers: [] })?.value ?? null;
}

const isTabGone = (err) => /No tab with id/i.test(String(err?.message || err || ''));
const isTimeout = (err) => /timed out/i.test(String(err?.message || err || ''));

/** One control on the page: frame + collect index (data-co-i restarts per frame). */
const slotKey = (x) => `${x?.frameId ?? 0}:${x?.i}`;

/** Same field across re-collects, when the collect index may have moved. */
const fieldKey = (f) => `${f?.frameId ?? 0}:${String(f?.label || f?.name || '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 80)}`;

const RESUME_LABEL_RE = /resume|\bcv\b|curriculum|autofill|_systemfield_resume|choose a file|drop (it|file) here|attach/i;
const resumeUploaded = (labels = []) => labels.some((l) => RESUME_LABEL_RE.test(String(l)));

// Extra wait after a fill's own budget before reading the result off the page.
const FILL_GRACE_MS = 60000;
// Dashboard button names, quoted in the messages that tell the user what to click.
const RESCAN_BTN = UI_BUTTONS.rescan;
const SEND_BTN = UI_BUTTONS.send;

/** Serialize a RegExp (or string) for the extension fill payload. */
export function serializePrefer(re) {
  if (!re) return null;
  if (re instanceof RegExp) return { source: re.source, flags: re.flags || 'i' };
  return { source: String(re), flags: 'i' };
}

/** A custom dropdown (react-select, Ashby, SmartRecruiters…), not a native select or radio group. */
function isCustomList(f) {
  const tag = String(f?.tag || '').toLowerCase();
  const type = String(f?.type || '').toLowerCase();
  return tag !== 'select' && type !== 'radio' && isComboboxField(f);
}

/**
 * List fields in an update carry `list: true` and `typeQuery`: the only text
 * the extension may type into the widget's search box ('' = pick-only). An
 * exact option text is a safe query; otherwise only search lists (city,
 * country, employer, school, dial code) get one.
 */
function listPayload(f, { optionText = '', plan = {}, identity = {} } = {}) {
  if (!isCustomList(f)) return {};
  // Yes/No screens are pick-only — typing "Yes" into a search box is noise and
  // "hiring location" questions used to type Paris via listTypeQuery.
  if (plan.yesNo || choiceKind(optionText) || choiceKind(plan.selectText) || choiceKind(plan.value)) {
    return { list: true, typeQuery: '' };
  }
  const text = String(optionText || '').trim();
  return { list: true, typeQuery: text ? (text.length <= 40 ? text : '') : listTypeQuery(f, plan, identity) };
}

/**
 * Time one fill-fields call may take. The extension runs the updates back to
 * back inside the tab: a list can need ~13 s (open, search, trusted-click
 * retry) and long answers are typed in small chunks. A flat 45 s cut the N26
 * form off halfway — the run ended in error while the tab kept typing.
 */
export function fillTimeoutMs(updates = []) {
  let ms = 20000;
  for (const u of updates || []) {
    if (u.list) ms += 15000 + (u.selectMany?.length || 0) * 1500;
    else if (u.check || u.choice || u.selectText != null || u.selectPrefer) ms += 2500;
    else ms += 1500 + Math.min(20000, String(u.value || '').length * 15);
  }
  return Math.min(ms, 300000);
}

/**
 * Turn a classifyField plan into a fill-fields update payload for the extension.
 * Returns null when the field should be left blank / unresolved / skipped.
 */
export function planToUpdate(f, plan, identity = {}) {
  if (!plan || plan.skip) return null;
  const label = fieldLabel(f);
  if (plan.upload) {
    return { i: f.i, frameId: f.frameId ?? 0, upload: plan.upload, label };
  }
  if (plan.resume) {
    const cv = loadCvSummary(ROOT);
    if (!cv) return null;
    return { i: f.i, frameId: f.frameId ?? 0, value: cv, label, resume: true };
  }
  if (plan.check) {
    return { i: f.i, frameId: f.frameId ?? 0, value: 'yes', check: true, label };
  }

  const tag = String(f.tag || '').toLowerCase();
  const type = String(f.type || '').toLowerCase();

  if (tag === 'select' || type === 'radio' || isComboboxField(f)) {
    const opt = (f.options && f.options.length) ? pickSelectOption(f.options, plan, f.label) : null;
    const text = opt?.text || plan.selectText || yesNoText(plan) || plan.value;
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
        ...(isCustomList(f) ? { list: true, typeQuery: '' } : {}),
      };
    }
    if (!text) return null;
    // Other spellings of the same answer to look for in the open list
    // ("Bangkok, Thailand" → "Bangkok"). Matched only, never typed.
    const alternates = [plan.selectMatch, plan.selectText, plan.value]
      .map((v) => String(v ?? '').trim())
      .filter((v, k, all) => v && v !== text && v.length <= 60 && all.indexOf(v) === k);
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
      alternates: alternates.length ? alternates : undefined,
      ...listPayload(f, { optionText: opt?.text, plan, identity }),
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

  const raw = plan.value ?? plan.selectText ?? yesNoText(plan);
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

// A list that showed its options and none matched fails the same way on a
// second pass — retrying it only typed into the dropdown again. A list that
// never opened, or a click that did not stick, is worth another try.
const RETRYABLE_PENDING_RE = /upload échoué|échec fill|radio option not found|FileList|valeur non retenue|element not found|liste non ouverte|cliquée mais non retenue|remplissage interrompu/i;

export class ApplyBridge {
  constructor() {
    this.socket = null;
    this.pending = new Map();
    this.reqCounter = 0;
    this.onLog = () => {};
    // From the extension's hello: messages this build answers.
    this.capabilities = new Set();
    this.extensionVersion = null;
    this._warnedNoPageHelper = false;
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
    // Until this socket's hello arrives, assume nothing (it may be a reload).
    this.capabilities = new Set();
    this.extensionVersion = null;
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
      // Connect is already logged in attachApplyBridge; only a build too old
      // for page-helper is worth a line, once.
      this.extensionVersion = msg.version || null;
      this.capabilities = new Set(Array.isArray(msg.capabilities) ? msg.capabilities : []);
      if (!this.capabilities.has('page-helper') && !this._warnedNoPageHelper) {
        this._warnedNoPageHelper = true;
        this.onLog(`extension ${msg.version || '(pre-0.0.27)'} lacks page-helper: form probe, autofill wait and nav buttons stay empty — reload it in chrome://extensions`);
      }
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

  /**
   * Write updates in the tab. Past its budget the tab is usually still typing
   * a long answer or retrying a list: wait a little longer, then read what
   * landed off the page instead of failing the whole run (the N26 / Bitpanda
   * runs ended in error while the tab kept filling).
   */
  async fillFields(tabId, updates) {
    if (!updates?.length) return { outcomes: [] };
    try {
      return await this._request('fill-fields', { tabId, updates }, fillTimeoutMs(updates) + FILL_GRACE_MS);
    } catch (err) {
      if (!isTimeout(err)) throw err;
      this.onLog(`fill-fields over budget on tab ${tabId} — reading the fields back from the page`);
      return { outcomes: await this._outcomesFromDom(tabId, updates), timedOut: true };
    }
  }

  /** Fill outcomes rebuilt from the live DOM, for a fill whose reply never came. */
  async _outcomesFromDom(tabId, updates) {
    const fields = (await this.detectFieldsInTab(tabId)).fields || [];
    const bySlot = new Map(fields.map((f) => [slotKey(f), f]));
    return updates.map((u) => {
      const f = bySlot.get(slotKey(u));
      const same = f && fieldLabel(f) === u.label;
      let value = '';
      if (same && f.type === 'checkbox') value = f.checked ? 'checked' : '';
      else if (same && f.type === 'radio') value = f.groupChecked ? String(f.value || 'checked') : '';
      else if (same) value = String(f.value || '').trim();
      return value
        ? { i: u.i, frameId: u.frameId ?? 0, ok: true, actualValue: value }
        : { i: u.i, frameId: u.frameId ?? 0, ok: false, reason: 'remplissage interrompu (délai dépassé)' };
    });
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

  /**
   * Run a named in-page helper (extension/page-helper-registry.mjs) and get
   * its merged result. Resolves null when the extension build predates
   * page-helper — its string-eval path never ran either. Request errors
   * ("No tab with id…") still reject: callers recover lost tabs from them.
   */
  async _pageHelper(tabId, name, args = []) {
    if (!this.capabilities.has('page-helper')) return null;
    const res = await this._request('page-helper', { tabId, name, args });
    return res?.result ?? null;
  }

  async pageShowsApplyEntry(tabId) {
    return (await this._pageHelper(tabId, 'PAGE_SHOWS_APPLY_ENTRY')) === true;
  }

  /** Wait for the ATS to copy name / email out of the CV (see waitForAutofill). */
  waitResumeAutofill(tabId, identity = {}) {
    return waitForAutofill(() => this._pageHelper(tabId, 'IDENTITY_SNAPSHOT'), identity);
  }

  /**
   * Open each list and read its option texts, through the code a pick uses
   * (fill-fields with readOptions): the separate scrape opened fewer widgets
   * than the fill, so the model answered lists blind ("0", "2") and the pick
   * then failed. Returns Map slotKey → option texts.
   */
  async readListOptions(tabId, fields = []) {
    if (!fields.length || !this.capabilities.has('read-options')) return new Map();
    const res = await this.fillFields(tabId, fields.map((f) => ({
      i: f.i,
      frameId: f.frameId ?? 0,
      label: fieldLabel(f),
      readOptions: true,
      list: true, // fill budget of a list pick
    })));
    return new Map((res.outcomes || [])
      .filter((o) => Array.isArray(o.options) && o.options.length)
      .map((o) => [slotKey(o), o.options]));
  }

  async probeForm(tabId) {
    const probe = await this._pageHelper(tabId, 'APPLICATION_FORM_PROBE');
    return { probe: probe || { verdict: 'none', score: 0, signals: [], blockers: [] } };
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
   * One complementary AI call (askNavDecision). Regex navigation / review
   * heuristics must have failed first. The budget lives on the run, so two
   * runs never share it; a rescan resets it.
   */
  async askNavAi(run, { url = '', skipTexts = [], ...opts } = {}) {
    let pageUrl = url;
    if (!pageUrl) {
      try { pageUrl = (await this.getTab(run.tabId))?.url || ''; } catch { pageUrl = ''; }
    }
    return askNavDecision(run.navAi, {
      ...opts,
      url: pageUrl,
      skipTexts,
      listButtons: async () => {
        const res = await this._pageHelper(run.tabId, 'LIST_VISIBLE_NAV_BUTTONS', [{
          avoidSrc: AUTH_AVOID_TEXT_RE.source,
          skip: skipTexts || [],
        }]);
        return Array.isArray(res) ? res : [];
      },
    });
  }

  /** Click an exact label, then report whether the step changed. */
  async clickExactAndSeeChange(tabId, text, previousMark) {
    const res = await this.clickExactLabel(tabId, text).catch(() => null);
    if (!res?.clicked) return { clicked: false };
    if ((res.openedTabId && res.openedTabId !== tabId) || res.openerGone) return { clicked: true, opened: res };
    return { clicked: true, changed: await this._waitStepChange(tabId, previousMark) };
  }

  /** Poll ~8 s until URL, heading or fields differ from `previousMark`. */
  async _waitStepChange(tabId, previousMark) {
    for (let k = 0; k < 20; k++) {
      await sleep(400);
      try {
        const now = await this.detectFieldsInTab(tabId);
        const mark = await this._stepMark(tabId, now.fields || []);
        if (mark && mark !== previousMark) return true;
      } catch (err) {
        if (isTabGone(err)) throw err;
      }
    }
    return false;
  }

  navigateTab(tabId, url) {
    return this._request('navigate-tab', { tabId, url });
  }

  getTab(tabId) {
    return this._request('get-tab', { tabId });
  }

  listWindowTabs(windowId) {
    return this._request('list-window-tabs', windowId ? { windowId } : {});
  }

  /** Visible button labels (disabled controls excluded). Empty when none are found. */
  async listVisibleActionLabels(tabId) {
    const labels = await this._pageHelper(tabId, 'ACTION_LABELS');
    return Array.isArray(labels) ? labels : [];
  }

  /** Heading, body, and whether the review heuristic already matched. */
  async inspectStep(tabId, fields = []) {
    let heading = '';
    let bodySnippet = '';
    try {
      const snap = await this._pageHelper(tabId, 'PAGE_STEP_SNAPSHOT');
      heading = snap?.heading || '';
      bodySnippet = snap?.bodySnippet || '';
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

  /** Rewrite the fields the ATS marked invalid. Returns false when none were. */
  async _refillInvalid(run) {
    let fields = [];
    try {
      fields = (await this.detectFieldsInTab(run.tabId)).fields || [];
    } catch (err) {
      if (isTabGone(err)) throw err;
      return false;
    }
    const bad = new Set(fields.filter((f) => fieldCompletionIssue(f, { uploadedLabels: run.uploaded })).map(slotKey));
    if (!bad.size) return false;
    await run.push(`Erreurs ATS (${bad.size}) — correction des champs invalides…`);
    // Only broken fields (+ empty file slots that still need a CV). Passing the
    // whole form used to re-upload the resume and retype already-valid inputs.
    const resumeDone = resumeUploaded(run.uploaded);
    const targets = fields.filter((f) => bad.has(slotKey(f))
      || (f.type === 'file' && shouldUploadFileField(f, { uploadedLabels: run.uploaded, resumeAlreadyUploaded: resumeDone })));
    const result = await this._fillOnce(run.tabId, run.spec, targets, { push: run.push, uploadedLabels: run.uploaded });
    run.filled = mergeFilled(run.filled, result.filled);
    run.uploaded = [...new Set([...run.uploaded, ...result.uploaded])];
    await this._tickConsents(run);
    return true;
  }

  /** Tick missing application-gate consents and record them as filled. */
  async _tickConsents(run) {
    try {
      const { count, filled } = await this.tickGateConsents(run.tabId, { push: run.push });
      if (count) run.filled = mergeFilled(run.filled, filled);
    } catch (err) {
      if (isTabGone(err)) throw err;
    }
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
    // The page hands over its HTML; the lib parser runs here, not in the tab.
    const page = await this._pageHelper(tabId, 'PAGE_HTML');
    if (!page?.html) return null;
    const url = extractEmbeddedApplyUrl(page.html, page.url || '');
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

  // ── Run driver ─────────────────────────────────────────────────────────────

  /**
   * Drive one application in `tabId`: reach the form, fill it, then wait for
   * the user's commands. A rescan loops back here (it used to recurse and
   * restart the log), and a sent application ends the run (it used to keep a
   * command loop alive forever).
   * `pollCommand` returns 'abort' | 'rescan' | 'submit' | 'manual_sent' | null.
   */
  async runApplyInTab(tabId, spec, {
    onState = async () => {},
    pollCommand = async () => null,
    maxHops = 12,
  } = {}) {
    const run = this._newRun(tabId, spec, { onState, pollCommand });
    let phase = 'navigate';
    for (;;) {
      if (phase === 'navigate') {
        const reached = await this._navigateToForm(run, { maxHops });
        if (reached === 'aborted') return this._abort(run);
        phase = reached === 'form' ? 'fill' : 'wait';
      }
      if (phase === 'fill') {
        if (await run.aborted()) return this._abort(run);
        const result = await this._fillPassSafe(run);
        if (result.aborted) return this._abort(run);
        if (result.submitted) return { ok: true, submitted: true };
      }
      const next = await this._commandLoop(run);
      if (typeof next !== 'string') return next;
      phase = next;
    }
  }

  /** Per-run state: the tab, the log, what was filled, the AI budget, commands. */
  _newRun(tabId, spec, { onState, pollCommand }) {
    const run = {
      tabId,
      spec,
      originUrl: spec?.jobUrl || '',
      steps: [],
      filled: [],
      pending: [],
      uploaded: [],
      navAi: { nav: 0, review: 0 },
      abortRequested: false,
      queued: null,
    };
    // Every write carries the full picture, so the modal shows fields as they
    // land. `fields.filled` / `fields.pending` replace the run's lists.
    run.set = async (fields = {}) => {
      if (fields.filled) run.filled = fields.filled;
      if (fields.pending) run.pending = fields.pending;
      await onState({
        browserMode: 'extension',
        ...fields,
        tabId: run.tabId,
        filled: run.filled,
        pending: run.pending,
        steps: [...run.steps],
        updatedAt: fields.updatedAt || new Date().toISOString(),
      });
    };
    run.push = async (text, fields = {}) => {
      const at = new Date().toISOString();
      run.steps.push({ at, text });
      this.onLog(text);
      await run.set({ ...fields, updatedAt: at });
    };
    // Checking for an abort reads the command file: keep any other command
    // (rescan, submit, manual_sent) for the command loop instead of dropping it.
    run.aborted = async () => {
      if (run.abortRequested) return true;
      const action = await pollCommand();
      if (action === 'abort') run.abortRequested = true;
      else if (action) run.queued = action;
      return run.abortRequested;
    };
    run.nextCommand = async () => {
      if (run.abortRequested) return 'abort';
      if (run.queued) {
        const action = run.queued;
        run.queued = null;
        return action;
      }
      return pollCommand();
    };
    run.heartbeat = () => onState({ updatedAt: new Date().toISOString() });
    return run;
  }

  async _abort(run) {
    await run.push('Annulé.', { state: 'aborted', message: 'Application cancelled.' });
    return { ok: false, aborted: true };
  }

  _adoptContext(run, { expectedHref = '', deadTabId = null } = {}) {
    return {
      originUrl: run.originUrl,
      role: run.spec?.role || '',
      company: run.spec?.company || '',
      expectedHref,
      deadTabId,
    };
  }

  /** The run's tab is gone: move to the open tab that matches this offer, if any. */
  async _recoverRunTab(run) {
    const picked = await this.recoverLostTab(run.tabId, run.push, this._adoptContext(run));
    if (!picked) return false;
    run.tabId = picked;
    await run.set();
    return true;
  }

  /**
   * A click opened a tab, or closed ours. Move the run to the tab when it
   * belongs to this offer. Returns true (moved), false (nothing was opened)
   * or 'refused' (the opened tab is not this offer's).
   */
  async _adoptOpenedTab(run, click, hopLabel = '') {
    let next = click;
    let verified = false;
    if (next?.openerGone) {
      const picked = await this.chooseAdoptTab(next.adoptCandidates || [], this._adoptContext(run, {
        expectedHref: next.href || '',
        deadTabId: run.tabId,
      }), run.push);
      if (!picked) return 'refused';
      next = { ...next, openedTabId: picked.tabId, openedUrl: picked.url || '' };
      verified = true; // chooseAdoptTab already scored it, form probe included
    }
    if (!next?.openedTabId || next.openedTabId === run.tabId) return false;
    const isHttp = (u) => /^https?:\/\//i.test(u || '');
    const dest = (isHttp(next.openedUrl) && next.openedUrl)
      || (isHttp(next.href) && next.href)
      || next.openedUrl
      || next.href
      || next.text
      || '';
    if (!verified) {
      // A tab the click itself opened is kept unless it is a hard reject
      // (Google, a login page, another posting on the same host).
      const verdict = acceptAdoptCandidate(
        { url: isHttp(dest) ? dest : '', title: next.title || '', tabId: next.openedTabId },
        this._adoptContext(run, { expectedHref: next.href || '', deadTabId: run.tabId }),
        { trustedChild: true },
      );
      if (!verdict.ok) {
        await run.push(`Nouvel onglet écarté (${verdict.hardReject || (verdict.reasons || []).join(', ')}) — ${dest}`);
        return 'refused';
      }
    }
    run.tabId = next.openedTabId;
    if (isHttp(next.href) && !isHttp(next.openedUrl)) {
      await this.navigateTab(run.tabId, next.href).catch(() => {});
    }
    await run.push(`Nouvel onglet → ${dest}${hopLabel}`, { message: 'Form opened in a new tab…' });
    // SmartRecruiters oneclick-ui (and similar SPAs) show a spinner before
    // fields exist — do not hop/scroll/give up while the form is loading.
    await this.waitForFormReady(run.tabId, { push: run.push, aborted: run.aborted, timeoutMs: 18000 });
    return true;
  }

  /** Fields + form probe of the run's tab. Only a closed tab throws. */
  async _readTab(run) {
    const read = async (what, fn, fallback) => {
      try {
        return await fn();
      } catch (err) {
        if (isTabGone(err)) throw err;
        await run.push(`${what}: ${err.message}`);
        return fallback;
      }
    };
    const fields = await read('Detect fields', async () => (await this.detectFieldsInTab(run.tabId)).fields || [], []);
    const probe = await read('Probe', async () => (await this.probeForm(run.tabId)).probe, { verdict: 'none' });
    return { fields, probe };
  }

  /**
   * Hop through the posting (Apply, guest access, ATS redirects, new tabs)
   * until an application form is on screen. Returns 'form', 'human' (the
   * state already says what the user must do) or 'aborted'.
   */
  async _navigateToForm(run, { maxHops = 12 } = {}) {
    const { push } = run;
    await push('Plugin: navigation vers le formulaire…', {
      state: 'navigating',
      message: 'Navigating in your Chrome tab…',
    });

    const attempted = new Set();
    const followedApplyLinks = new Set();
    const skipOn = (url) => [...attempted].filter((k) => k.startsWith(`${url}::`)).map((k) => k.slice(url.length + 2));
    const handOff = async (text, message, pending = []) => {
      await push(text, { state: 'needs_human', message, pending });
      return 'human';
    };
    const noTab = () => handOff(
      'Aucun onglet ouvert ne correspond à cette offre (domaine, URL, identifiant, formulaire).',
      `This tab is not the offer. Open this offer’s form, then ${RESCAN_BTN}.`,
      [{ label: 'navigation', reason: 'tab does not match this offer' }],
    );
    // Listing pages (CryptoJobsList…) hide the real ATS URL in their HTML
    // while the visible Apply opens a login modal.
    const followEmbeddedApplyLink = async () => {
      let link = null;
      try { link = await this.findEmbeddedApplyUrl(run.tabId); } catch { return false; }
      if (!link || followedApplyLinks.has(link)) return false;
      followedApplyLinks.add(link);
      await push(`Apply ouvre un lien externe → ${link}`);
      await this.navigateTab(run.tabId, link);
      await this.waitForFormReady(run.tabId, { push, aborted: run.aborted, timeoutMs: 18000 });
      return true;
    };

    for (let hop = 0; hop < maxHops; hop++) {
      if (await run.aborted()) return 'aborted';
      try { await this.dismissCookies(run.tabId); } catch { /* ignore */ }

      // 1) Fields first — if the form is already on screen, fill it. Do NOT
      //    scroll/click Apply (that was the "only scrolls" bug on Greenhouse).
      let fields;
      let probe;
      try {
        ({ fields, probe } = await this._readTab(run));
      } catch {
        if (await this._recoverRunTab(run)) continue;
        return noTab();
      }
      if (probe.verdict === 'application_form' || this.fieldsLookLikeForm(fields)) {
        await push(probe.verdict === 'application_form'
          ? `Formulaire détecté (probe score ${probe.score || '?'}: ${(probe.signals || []).join(', ') || 'ok'})`
          : `Formulaire détecté via champs (${fields.length} field(s), probe=${probe.verdict}/${probe.score || 0})`);
        return 'form';
      }
      await push(`Hop ${hop + 1}: pas encore de form (probe=${probe.verdict} score=${probe.score || 0}, fields=${fields.length})`);

      let url = '';
      try { url = (await this.getTab(run.tabId)).url || ''; } catch { /* read as unknown */ }

      if (probe.verdict === 'auth_wall') {
        await push(`Mur d’auth (${(probe.blockers || []).join(', ')}) — essai invité…`);
        let click = await this.clickProgression(run.tabId, GUEST_TEXT_RE, skipOn(url), { scrollFirst: false }).catch(() => null);
        let via = 'Clic invité';
        if (!click?.clicked) {
          const ai = await this.askNavAi(run, { phase: 'navigate', url, skipTexts: skipOn(url), fields });
          if (ai?.log && !ai.skipped) await push(ai.log);
          if (ai?.action === 'click' && ai.text) {
            click = await this.clickExactLabel(run.tabId, ai.text).catch(() => null);
            if (click?.clicked) click = { ...click, text: click.text || ai.text };
            via = 'Clic IA';
          }
        }
        if (!click?.clicked) {
          return handOff(
            'Pas d’accès invité — intervention manuelle.',
            `This site wants a sign-in. Sign in, then ${RESCAN_BTN}.`,
            [{ label: 'auth', reason: 'sign-in required' }],
          );
        }
        attempted.add(`${url}::${click.text}`);
        const adopted = await this._adoptOpenedTab(run, click);
        if (adopted === 'refused') return noTab();
        if (!adopted) {
          await push(`${via}: « ${click.text} »`);
          await sleep(2000);
        }
        continue;
      }

      const normalized = normalizeAtsUrl(url);
      if (normalized && normalized !== url) {
        await push(`URL ATS normalisée → ${normalized}`);
        await this.navigateTab(run.tabId, normalized);
        continue;
      }

      // Some ATS already render the form mid-page. Scroll it into view once
      // instead of clicking Apply (which just scrolls / no-ops).
      if (!run.originUrl) run.originUrl = url;
      if (identifyAts(url)?.behaviors?.includes('scroll-to-form') && hop === 0) {
        await this._request('scroll-tab', { tabId: run.tabId, deltaY: 900 }).catch(() => {});
        await sleep(1200);
        continue;
      }

      if (await followEmbeddedApplyLink()) continue;

      let clicked = null;
      for (const re of [GUEST_TEXT_RE, APPLY_TEXT_RE, PROGRESS_TEXT_RE]) {
        // Without scrolling first — the control may already be in view.
        for (const scrollFirst of [false, true]) {
          clicked = await this.clickProgression(run.tabId, re, skipOn(url), { scrollFirst }).catch(() => null);
          if (clicked?.clicked) break;
        }
        if (clicked?.clicked) break;
      }
      if (clicked?.clicked) {
        attempted.add(`${url}::${clicked.text}`);
      } else {
        clicked = null;
        if (await followEmbeddedApplyLink()) continue;
        // Last resort: if we saw ANY text inputs, try filling anyway.
        if (fields.length >= 2) {
          await push(`Aucun CTA — tentative de fill sur ${fields.length} champ(s) détectés`);
          return 'form';
        }
        // SPA still spinning (SmartRecruiters oneclick-ui): wait once before
        // declaring "no Apply/Next" — scrolling during load finds nothing.
        if (hop < maxHops - 1) {
          const waited = await this.waitForFormReady(run.tabId, {
            push,
            aborted: run.aborted,
            timeoutMs: identifyAts(url)?.behaviors?.includes('wait-spa') ? 18000 : 12000,
          });
          if (waited.aborted) return 'aborted';
          if (waited.ready || (waited.fields || []).length >= 2) return 'form';
        }
        const ai = await this.askNavAi(run, { phase: 'navigate', url, skipTexts: skipOn(url), fields });
        if (ai?.log && !ai.skipped) await push(ai.log);
        if (ai?.action === 'fill') {
          await push('IA nav: formulaire traité comme prêt à remplir');
          return 'form';
        }
        if (ai?.action === 'click' && ai.text) {
          const res = await this.clickExactLabel(run.tabId, ai.text).catch(() => null);
          if (res?.clicked) {
            clicked = { ...res, text: res.text || ai.text };
            attempted.add(`${url}::${clicked.text}`);
          }
        }
        if (!clicked) {
          return handOff(
            'Aucun bouton Apply/Next et pas assez de champs.',
            `Is the form on screen? If it is, click ${RESCAN_BTN}.`,
            [{ label: 'navigation', reason: 'no Apply or Next button' }],
          );
        }
      }

      const adopted = await this._adoptOpenedTab(run, clicked, ` (hop ${hop + 1})`);
      if (adopted === 'refused') return noTab();
      if (adopted) continue;

      // Same-tab navigation may have closed/replaced the tab without openedTabId.
      try {
        await this.getTab(run.tabId);
      } catch {
        if (await this._recoverRunTab(run)) continue;
        return noTab();
      }

      await push(`Clic: « ${clicked.text} »${clicked.href ? ` → ${clicked.href}` : ''} (hop ${hop + 1})`, {
        state: 'navigating',
        message: `Opening… “${clicked.text}”`,
      });
      await sleep(2000);
    }

    // One last detect before giving up.
    try {
      const { fields } = await this.detectFieldsInTab(run.tabId);
      if (this.fieldsLookLikeForm(fields) || (fields || []).length >= 3) {
        await push(`Dernière chance: ${fields.length} champ(s) — fill`);
        return 'form';
      }
    } catch { /* fall through to the hand-off */ }
    return handOff(
      'Limite de hops atteinte sans formulaire reconnu.',
      `Is the form on screen? Click ${RESCAN_BTN} to fill it.`,
    );
  }

  /**
   * _fillPass that never takes the run down: a replaced tab is followed (the
   * Hopper run died on "No tab with id" after Next), anything else hands the
   * half-filled form to the user with Rescan still working.
   */
  async _fillPassSafe(run, { recoveries = 2 } = {}) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this._fillPass(run);
      } catch (err) {
        if (isTabGone(err) && attempt < recoveries && await this._recoverRunTab(run)) {
          await run.push('Onglet remplacé pendant le remplissage — reprise sur le nouvel onglet.');
          continue;
        }
        const reason = isTabGone(err) ? 'onglet fermé' : String(err?.message || err).slice(0, 120);
        await run.push(`Remplissage interrompu: ${reason}`, {
          state: 'needs_human',
          message: `Filling stopped (${reason}). Check the tab, then ${RESCAN_BTN}.`,
          pending: mergePending(run.pending, [{ label: 'filling', reason: `stopped — ${reason}` }], run.filled),
        });
        return { submitted: false };
      }
    }
  }

  /**
   * Fill the form, page by page through wizards (up to `maxPages` steps),
   * and send it when the spec allows auto-submit. Returns { submitted } or
   * { aborted }.
   */
  async _fillPass(run, { maxPages = 8 } = {}) {
    const { spec, push } = run;
    await push('Remplissage des champs dans l’onglet…', {
      state: 'filling',
      message: 'Filling the form…',
      pending: [],
    });
    run.uploaded = [];

    let lastMark = '';
    let noopMark = '';
    let healUsed = false;
    // A new wizard step or tab: its fields start unanswered.
    const newStep = () => {
      run.pending = [];
      lastMark = '';
      noopMark = '';
      healUsed = false;
    };
    const followOpened = async (click, label) => {
      if ((await this._adoptOpenedTab(run, click, ` ${label}`)) !== true) return false;
      newStep();
      return true;
    };
    const liveFields = async () => (await this.detectFieldsInTab(run.tabId)).fields || [];
    const fillAndRecord = async (fields) => {
      const { filled, pending, uploaded } = await this._fillOnce(run.tabId, spec, fields, { push, uploadedLabels: run.uploaded });
      run.filled = mergeFilled(run.filled, filled);
      run.pending = mergePending(run.pending, pending, run.filled);
      run.uploaded = [...new Set([...run.uploaded, ...uploaded])];
      await run.set();
    };
    // The live DOM is the judge: a field the ATS still flags is pending, even
    // when a fill reported it typed (that hid the fields behind "envoi refusé").
    const noteIssues = (issues) => {
      const flagged = new Set(issues.map((x) => x.label));
      run.filled = run.filled.filter((f) => !flagged.has(f.label));
      run.pending = mergePending(run.pending, issues, run.filled);
    };
    // Click Next and wait for the step to change: 'moved', 'none' or { stuck }.
    const clickNext = async (logText) => {
      const next = await this.clickProgression(run.tabId, PROGRESS_TEXT_RE, [], { scrollFirst: true });
      if (!next?.clicked) return 'none';
      const kind = classifyActionLabel(next.text || '').kind;
      if (kind === 'submit' || kind === 'ambiguous' || SUBMIT_TEXT_RE.test(String(next.text || ''))) {
        await push(`« ${next.text} » cliqué — libellé proche d’un envoi, vérifie l’onglet.`);
        return 'none';
      }
      await push(`${logText}: « ${next.text || 'Next'} »`);
      if (await followOpened(next, '(Next)')) return 'moved';
      return (await this._waitStepChange(run.tabId, lastMark)) ? 'moved' : { stuck: next.text || '' };
    };

    for (let page = 0; page < maxPages; page++) {
      if (await run.aborted()) return { aborted: true };
      await sleep(600);

      const fields = await liveFields();
      await push(`Detect: ${fields.length} champ(s) (page ${page + 1}, frames incluses)`);
      await fillAndRecord(fields);

      // Retry what failed for a reason a second try can fix (window runner parity).
      let after = await liveFields();
      let issues = completionIssues(after, run.uploaded);
      const retryable = run.pending.filter((p) => RETRYABLE_PENDING_RE.test(String(p.reason || '')));
      if (retryable.length || issues.some((x) => /fichier requis|CV manquant/i.test(x.reason))) {
        await push(`Relance auto: ${retryable.length || 1} échec(s) de remplissage…`);
        await sleep(700);
        run.pending = run.pending.filter((p) => !RETRYABLE_PENDING_RE.test(String(p.reason || '')));
        await fillAndRecord(await liveFields());
        after = await liveFields();
        issues = completionIssues(after, run.uploaded);
      }
      noteIssues(issues);
      lastMark = await this._stepMark(run.tabId, after);

      const chip = after.find((f) => f.type === 'file' && String(f.fileChip || '').trim());
      if (chip && !run.filled.some((f) => /📎/.test(String(f.value || '')))) {
        run.filled = mergeFilled(run.filled, [{ label: fieldLabel(chip), value: `📎 ${chip.fileChip}` }]);
        run.uploaded = [...new Set([...run.uploaded, fieldLabel(chip)])];
      }

      let applyEntryVisible = false;
      try { applyEntryVisible = await this.pageShowsApplyEntry(run.tabId); } catch { /* ignore */ }

      const inspected = await this.inspectStep(run.tabId, after);
      let finalReview = reviewStepConfidence(inspected) === 'high';
      let aiSubmitText = '';
      if (!finalReview && reviewStepNeedsAi(inspected)) {
        const ai = await this.askNavAi(run, {
          phase: 'review',
          fields: after,
          heading: inspected.heading,
          bodySnippet: inspected.bodySnippet,
        });
        if (ai?.log && !ai.skipped) await push(ai.log);
        if (ai?.action === 'review') {
          finalReview = true;
        } else if (ai?.action === 'click' && ai.text) {
          const cls = classifyActionLabel(ai.text);
          if (cls.kind === 'submit' && cls.autoSubmit && cls.confidence === 'high') {
            finalReview = true;
            aiSubmitText = ai.text;
          } else if (cls.kind === 'submit' || cls.kind === 'ambiguous') {
            // A send label is never clicked as navigation.
            await push(`Libellé ambigu « ${ai.text} » — pas d’envoi automatique.`);
          } else {
            const moved = await this.clickExactAndSeeChange(run.tabId, ai.text, lastMark);
            if (moved.opened && await followOpened(moved.opened, '(IA)')) continue;
            if (moved.changed) {
              newStep();
              continue;
            }
          }
        }
      }
      if (finalReview) {
        await push('Étape de vérification / récapitulatif détectée');
        await this._tickConsents(run);
        // Optional blanks on a review screen must not block Submit.
        run.pending = run.pending.filter((p) => isBlockingApplyPending(p.reason));
      }

      // Nothing left to fill but an Apply entry is still on screen: open the form.
      if (!run.pending.length && applyEntryVisible) {
        const apply = await this.clickProgression(run.tabId, APPLY_TEXT_RE, [], { scrollFirst: true });
        if (apply?.clicked) {
          await push(`Ouverture formulaire: « ${apply.text || 'Apply'} »`);
          if (!(await followOpened(apply, '(Apply)'))) await sleep(1200);
          continue;
        }
      }

      const hardBlock = run.pending.some((p) => isBlockingApplyPending(p.reason));
      const sawResumeSlot = run.uploaded.length > 0
        || after.some((f) => f.type === 'file' && (f.required || isResumeFileField(f)));
      const cvBlocksSubmit = sawResumeSlot && !run.filled.some((f) => /📎/.test(String(f.value || '')));
      const requiredEmpty = run.pending.some((p) => isRequiredEmptyReason(p.reason));

      let actionLabels = [];
      try { actionLabels = await this.listVisibleActionLabels(run.tabId); } catch { /* controls unknown */ }
      const controlsKnown = wizardControlsKnown(actionLabels);
      const submitPick = submitChoice(actionLabels);
      // A review screen blocks Next only when Continue is not also on screen:
      // a "Review application" button there is not a way forward.
      const treatAsFinalReview = finalReview && (!controlsKnown || !forwardProgressVisible(actionLabels));
      let nextHadNoEffect = false;

      const canAdvance = page < maxPages - 1 && !(treatAsFinalReview && !hardBlock) && canAdvanceWizardStep({
        hardBlock,
        isReview: treatAsFinalReview,
        requiredEmpty,
        nextVisible: progressionButtonVisible(actionLabels),
        nextVisibilityKnown: controlsKnown,
        previousClickNoEffect: !!noopMark && noopMark === lastMark,
      });
      if (canAdvance) {
        let step = await clickNext('Étape suivante');
        if (step?.stuck !== undefined && !healUsed) {
          healUsed = true;
          if (await this._refillInvalid(run)) step = await clickNext('Nouvel essai après correction');
        }
        if (step === 'moved') {
          newStep();
          continue;
        }
        if (step?.stuck !== undefined) {
          // Next did not change the step. Do not turn that into a send.
          noopMark = lastMark;
          nextHadNoEffect = true;
          await push('Next sans effet — envoi automatique évité.');
          const ai = await this.askNavAi(run, {
            phase: 'stuck',
            fields: after,
            heading: inspected.heading,
            bodySnippet: inspected.bodySnippet,
            skipTexts: [step.stuck].filter(Boolean),
          });
          if (ai?.log && !ai.skipped) await push(ai.log);
          if (ai?.action === 'click' && ai.text) {
            const kind = classifyActionLabel(ai.text).kind;
            if (kind === 'submit' || kind === 'ambiguous') {
              await push(`« ${ai.text} » non utilisé comme envoi après un Next sans effet.`);
            } else {
              const moved = await this.clickExactAndSeeChange(run.tabId, ai.text, lastMark);
              if (moved.opened && await followOpened(moved.opened, '(IA)')) continue;
              if (moved.changed) {
                newStep();
                continue;
              }
            }
          }
          await push('Next cliqué mais même étape — validation ATS probable, on reste ici.');
        }
      }

      if (cvBlocksSubmit) {
        await push('CV manquant — envoi bloqué jusqu’à upload réussi.');
        if (!run.pending.some((p) => /resume|\bcv\b|upload|fichier/i.test(`${p.label} ${p.reason}`))) {
          run.pending = mergePending(run.pending, [{ label: 'Resume/CV', reason: 'CV manquant — upload non confirmé' }], run.filled);
        }
      }
      const ready = looksReadyToSubmit({ filled: run.filled, pending: run.pending, applyEntryVisible });
      const filledCount = run.filled.length;
      let message;
      if (run.pending.length) message = `Form — ${filledCount} filled, ${run.pending.length} left${cvBlocksSubmit ? ' (CV required)' : ''}.`;
      else if (treatAsFinalReview) message = `Review — ready to send (${filledCount} field(s)).`;
      else if (ready) message = `Form ready — ${filledCount} field(s). Review it, then send.`;
      else message = `Form — ${filledCount} field(s) filled.`;
      await run.set({ state: run.pending.length ? 'needs_human' : 'ready_to_review', message });

      // Review step OR ready form → auto-submit (identity from earlier steps counts).
      // A failed Next must not become a send, and an ambiguous label never auto-sends.
      let canSubmit = !!spec.autoSubmit
        && !run.pending.length
        && !cvBlocksSubmit
        && (ready || (treatAsFinalReview && filledCount >= 1));
      if (canSubmit && nextHadNoEffect && !shouldAttemptSubmitAfterNoopNext({
        submitButtonVisible: submitPick.allow && submitPick.confidence === 'high',
        reviewConfidence: treatAsFinalReview ? 'high' : 'none',
        requiredEmpty,
        hardBlock: hardBlock || cvBlocksSubmit,
        progressStillVisible: true,
      })) {
        canSubmit = false;
      }
      if (canSubmit && controlsKnown && submitPick.ambiguous) {
        await push(`Libellé ambigu « ${submitPick.ambiguousText} » — pas d’envoi automatique.`);
        canSubmit = false;
      } else if (controlsKnown && !submitPick.allow && !treatAsFinalReview) {
        canSubmit = false;
      }
      if (!canSubmit) return { submitted: false };

      // Last look before sending: fix what the ATS still flags, or hand over.
      await this._tickConsents(run);
      let stale = completionIssues(await liveFields(), run.uploaded);
      if (stale.length) {
        await push(`Avant envoi: ${stale.length} champ(s) invalide(s) — correction…`);
        await this._refillInvalid(run);
        stale = completionIssues(await liveFields(), run.uploaded);
      }
      if (stale.length) {
        noteIssues(stale);
        await push(`Avant envoi: ${stale.length} champ(s) encore invalide(s) — envoi reporté.`, {
          state: 'needs_human',
          message: `✋ ${stale.length} field(s) to fix before sending.`,
        });
        return { submitted: false };
      }
      return { submitted: await this._sendApplication(run, { exactText: aiSubmitText }) };
    }

    await run.set({
      state: run.pending.length ? 'needs_human' : 'ready_to_review',
      message: `Step limit reached — ${run.filled.length} field(s) filled.`,
    });
    return { submitted: false };
  }

  /**
   * Click Send. A form that rejects it gets one refill of the invalid fields
   * and one resend; a send button the regex cannot find gets one AI pick,
   * clicked only if it reads as a send label. Shared by auto-submit and the
   * dashboard's "Confirm send". Returns true once a send went through.
   */
  async _sendApplication(run, { exactText = '' } = {}) {
    const { push } = run;
    await push('Envoi de la candidature…', { state: 'submitting', message: 'Sending the application…' });
    await this._tickConsents(run);
    let clicked = await this.clickSend(run.tabId, exactText).catch((err) => {
      this.onLog(`clickSubmit failed: ${err.message}`);
      return null;
    });
    if (clicked?.rejected) {
      await this._refillInvalid(run).catch((err) => {
        if (isTabGone(err)) throw err;
        return false;
      });
      await sleep(500);
      const retry = await this.clickSubmit(run.tabId).catch(() => null);
      if (retry?.clicked) clicked = retry;
    }
    if (!clicked?.clicked) {
      const fields = (await this.detectFieldsInTab(run.tabId).catch(() => null))?.fields || [];
      const inspected = await this.inspectStep(run.tabId, fields);
      const ai = await this.askNavAi(run, {
        phase: 'stuck',
        fields,
        heading: inspected.heading,
        bodySnippet: inspected.bodySnippet,
        skipTexts: [exactText].filter(Boolean),
      });
      if (ai?.log && !ai.skipped) await push(ai.log);
      if (ai?.action === 'click' && ai.text) {
        if (classifyActionLabel(ai.text).kind === 'submit') {
          const exact = await this.clickExactLabel(run.tabId, ai.text).catch(() => null);
          if (exact?.clicked) clicked = exact;
        } else {
          await push(`« ${ai.text} » n’est pas un bouton d’envoi — non cliqué.`);
        }
      }
    }

    if (clicked?.clicked && !clicked.rejected) {
      await push(`Envoyé: « ${clicked.text || 'Submit'} »`, {
        state: 'submitted',
        message: 'Application sent. Check the confirmation in the tab.',
        pending: [],
      });
      return true;
    }
    if (clicked?.rejected) {
      const reason = `send refused — ${clicked.errorCount} invalid field(s)${clicked.sample ? ` (“${clicked.sample}”)` : ''}`;
      await push(`Form refused the send: ${reason}`, {
        state: 'needs_human',
        message: `⚠️ The form refused the send — ${clicked.errorCount} invalid field(s)${clicked.sample ? ` (“${clicked.sample}”)` : ''}. Fix them in Chrome, then ${SEND_BTN} or ${RESCAN_BTN}.`,
        pending: mergePending(run.pending, [{ label: 'Send', reason }], run.filled),
      });
      return false;
    }
    await push('Bouton Submit introuvable — confirme manuellement dans l’onglet.', {
      state: 'needs_human',
      message: `Click Submit or Send in the Chrome tab, then ${UI_BUTTONS.sent}.`,
    });
    return false;
  }

  /**
   * One fill of `fields`: A) CV uploads, B) deterministic answers from the
   * spec, C) the model for required fields B could not answer, then a
   * reconcile of profile fields the ATS autofill got wrong.
   * Returns this pass's { filled, pending, uploaded }.
   */
  async _fillOnce(tabId, spec, fields, { push, uploadedLabels = [] }) {
    const usedAnswers = new Set();
    const filled = [];
    const pending = [];
    const unresolved = [];
    const uploaded = [];
    let resumeAlreadyUploaded = resumeUploaded(uploadedLabels);
    const reCollect = async (fallback) => {
      try {
        return (await this.detectFieldsInTab(tabId)).fields || fallback;
      } catch (err) {
        if (isTabGone(err)) throw err;
        return fallback;
      }
    };

    // Phase A — file uploads first (Ashby autofill from resume). Re-collect
    // after each upload: ATS re-render invalidates data-co-i markers.
    const doneFiles = new Set();
    for (let pass = 0; pass < 4; pass++) {
      let fileFields = (await reCollect(fields)).filter((x) => x.type === 'file');
      // Ashby sometimes hides the resume input so hard that collect misses it.
      // Probe raw file inputs and synthesize a resume field when needed.
      if (!fileFields.length && pass === 0 && spec.cvPath && !resumeAlreadyUploaded) {
        try {
          const slot = await this._pageHelper(tabId, 'FORCE_RESUME_SLOT');
          if (slot?.type === 'file') {
            fileFields = [slot];
            await push(`CV slot forcé (input caché): ${fileFields[0].label || fileFields[0].name}`);
          }
        } catch { /* keep empty */ }
      }
      if (!fileFields.length && pass === 0 && !resumeAlreadyUploaded) {
        await push('Aucun champ fichier détecté — CV non tenté sur cette page.');
      }
      const knownUploaded = [...uploadedLabels, ...uploaded];
      const todo = fileFields.find((f) => !doneFiles.has(fieldLabel(f))
        && shouldUploadFileField(f, { uploadedLabels: knownUploaded, resumeAlreadyUploaded }));
      if (!todo) break;
      const labelShort = fieldLabel(todo);
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
          if (isResumeFileField(todo) || plan.upload === spec.cvPath) resumeAlreadyUploaded = true;
          await push(`CV attaché: ${basename(plan.upload)}`);
          await sleep(900);
          const autofillLine = autofillLogLine(await this.waitResumeAutofill(tabId, spec?.identity || {}));
          if (autofillLine) await push(autofillLine);
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
    const live = uploaded.length ? await reCollect(fields) : fields;

    // Phase B — deterministic classify
    const updates = [];
    for (const f of live) {
      if (f.type === 'file') continue;
      if (!shouldFillField(f) && !(f.type === 'checkbox' && f.required)) continue;
      const alreadyFilled = f.value && f.type !== 'radio' && f.type !== 'checkbox';
      if (alreadyFilled && !(f.ariaInvalid || f.invalid)) continue;
      if (f.type === 'checkbox' && f.checked) continue;
      if (f.type === 'radio' && f.groupChecked) continue;

      const plan = classifyField(f, spec, usedAnswers);
      if (plan?.fromQuestion) usedAnswers.add(plan.fromQuestion);
      const labelShort = fieldLabel(f);

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
              ...listPayload(f, { optionText: decline.text }),
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
            ...(isCustomList(f) ? { list: true, typeQuery: '' } : {}),
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

      const update = planToUpdate(f, plan, spec.identity || {});
      if (!update) {
        if (f.required) unresolved.push(f);
        continue;
      }
      updates.push(update);
    }

    // Options a failed list pick saw once it was open: the resolver gets the
    // real list without opening the dropdown a second time.
    const seenOptions = new Map();

    if (updates.length) {
      await push(`Fill: envoi de ${updates.length} valeur(s)…`);
      const result = await this.fillFields(tabId, updates);
      const labelBySlot = new Map(updates.map((u) => [slotKey(u), u.label]));
      const fieldBySlot = new Map(live.map((f) => [slotKey(f), f]));
      for (const o of result.outcomes || []) {
        const lab = labelBySlot.get(slotKey(o)) || `field#${o.i}`;
        const field = fieldBySlot.get(slotKey(o));
        // Text reads back as typed, a choice as its option's label, a
        // checkbox as "checked": an empty or "unchecked" read-back did not land.
        const landed = String(o.actualValue ?? '').trim();
        if (!o.ok && Array.isArray(o.options) && o.options.length && field) {
          seenOptions.set(fieldKey(field), o.options);
        }
        if (o.ok && landed && !/^unchecked$/i.test(landed)) {
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
      const freshFields = await reCollect(live);
      const byKey = new Map(freshFields.map((f) => [fieldKey(f), f]));
      const targets = [];
      const seen = new Set();
      for (const f of unresolved) {
        const liveF = byKey.get(fieldKey(f)) || f;
        if (seen.has(slotKey(liveF))) continue;
        seen.add(slotKey(liveF));
        targets.push(liveF);
      }
      await push(`Résolution intelligente de ${targets.length} champ(s)…`);

      // Lists collected without options: read them first (or reuse what a
      // failed Phase B pick saw), so the model picks a real entry.
      const blind = targets.filter((f) => !(f.options || []).length && (isComboboxField(f) || f.tag === 'select'));
      const toRead = blind.filter((f) => !seenOptions.get(fieldKey(f))?.length);
      const read = toRead.length ? await this.readListOptions(tabId, toRead) : new Map();
      for (const f of blind) {
        const texts = seenOptions.get(fieldKey(f)) || read.get(slotKey(f));
        if (texts?.length) f.options = texts.map((t, k) => ({ value: t, text: t, key: `${f.i}:${k}` }));
      }

      // A "prefer not to say" option answers sensitive questions without the model.
      const declineUpdates = [];
      const llmTargets = [];
      for (const f of targets) {
        const opt = pickDeclineOption(f.options || []);
        if (!opt) {
          llmTargets.push(f);
          continue;
        }
        declineUpdates.push({
          i: f.i,
          frameId: f.frameId ?? 0,
          value: opt.text,
          selectText: opt.text,
          label: fieldLabel(f),
          declined: true,
          options: f.options,
          choice: f.type === 'radio',
          ...listPayload(f, { optionText: opt.text }),
        });
      }

      const updateFor = (f, ans) => {
        const label = fieldLabel(f);
        const text = Array.isArray(ans) ? ans[0] : ans;
        if (!text) {
          if (f.required) pending.push({ label, reason: 'sans réponse — à remplir manuellement' });
          return null;
        }
        if (hasUnresolvedPlaceholder(String(text))) {
          if (f.required) pending.push({ label, reason: 'réponse LLM avec placeholder' });
          return null;
        }
        // Prefer a listed option text when the LLM paraphrases Yes/No.
        let selectText = polishApplicationAnswer(String(text));
        let optionText = '';
        if (f.options?.length) {
          const yesNo = /^(yes|oui)\b/i.test(selectText) ? 'yes' : /^(no|non)\b/i.test(selectText) ? 'no' : null;
          const picked = pickSelectOption(f.options, { yesNo, selectText, value: selectText }, f.label);
          if (picked?.text) selectText = optionText = picked.text;
        }
        // A multi-select answer is several option texts: tick them all.
        const many = Array.isArray(ans) && fieldIsMulti(f)
          ? [...new Set(ans.map((a) => String(a || '').trim()).filter(Boolean))]
          : [];
        return {
          i: f.i,
          frameId: f.frameId ?? 0,
          value: selectText,
          selectText,
          selectMany: many.length > 1 ? many : undefined,
          label,
          llm: true,
          options: f.options,
          choice: f.type === 'radio',
          // No real option: the model's words are only matched. A search list
          // (city, country…) still gets its profile query, never the answer.
          ...listPayload(f, { optionText, identity: spec.identity || {} }),
        };
      };
      const answer = async (fieldsToAnswer) => {
        if (!fieldsToAnswer.length) return [];
        let answers = {};
        try {
          answers = await resolveUnknownFields({
            fields: fieldsToAnswer.map((f) => ({
              i: f.i,
              label: f.label,
              kind: llmKind(f),
              required: f.required,
              multiple: fieldIsMulti(f),
              options: f.options,
            })),
            spec,
            cvSummary: loadCvSummary(ROOT),
            styleGuide: loadApplicationVoice(ROOT),
          });
        } catch (err) {
          await push(`LLM indisponible (${String(err.message || err).slice(0, 70)})`);
        }
        return fieldsToAnswer.map((f) => updateFor(f, answers[String(f.i)])).filter(Boolean);
      };
      // Fill; return the blind lists whose real options the widget showed.
      const fillAnswers = async (llmUpdates, blindBySlot) => {
        if (!llmUpdates.length) return [];
        const result = await this.fillFields(tabId, llmUpdates);
        const bySlot = new Map(llmUpdates.map((u) => [slotKey(u), u]));
        const again = [];
        for (const o of result.outcomes || []) {
          const u = bySlot.get(slotKey(o));
          if (!u) continue;
          if (o.ok) {
            filled.push({ label: u.label, value: o.actualValue || '', llm: true });
            continue;
          }
          const f = blindBySlot.get(slotKey(o));
          if (f && Array.isArray(o.options) && o.options.length) {
            again.push({ ...f, options: o.options.map((t, k) => ({ value: t, text: t, key: `${f.i}:${k}` })) });
          } else {
            pending.push({ label: u.label, reason: `réponse suggérée — ${o.reason || 'option introuvable'}` });
          }
        }
        return again;
      };

      const stillBlind = new Map(llmTargets.filter((f) => !(f.options || []).length).map((f) => [slotKey(f), f]));
      const again = await fillAnswers([...declineUpdates, ...(await answer(llmTargets))], stillBlind);
      if (again.length) {
        // The list opened during the fill: answer once more, among its real options.
        await push(`${again.length} liste(s) lue(s) pendant le remplissage — nouvelle réponse avec leurs options…`);
        await fillAnswers(await answer(again), new Map());
      }
    }

    // Reconcile profile fields that ATS autofill may have wrong
    try {
      const fresh = await reCollect([]);
      const recon = [];
      for (const f of fresh) {
        if (f.type === 'file' || f.type === 'checkbox' || f.type === 'radio') continue;
        if (!shouldFillField(f)) continue;
        // An empty list already had its pick above (or went to the resolver):
        // sending the profile text again only typed it into the dropdown.
        const isList = f.tag === 'select' || isComboboxField(f);
        if (isList && !String(f.value || '').trim()) continue;
        const plan = classifyField(f, spec);
        if (!plan || plan.skip || plan.check || plan.resume) continue;
        const want = polishApplicationAnswer(plan.value || plan.selectText || yesNoText(plan));
        if (!want || !shouldReplaceFilledValue(f, f.value, want)) continue;
        recon.push({
          i: f.i,
          frameId: f.frameId ?? 0,
          value: want,
          selectText: want,
          label: fieldLabel(f),
          ...(isCustomList(f) ? { list: true, typeQuery: '' } : {}),
        });
      }
      const labelBySlot = new Map(recon.map((u) => [slotKey(u), u.label]));
      const result = await this.fillFields(tabId, recon);
      for (const o of result.outcomes || []) {
        const lab = o.ok && labelBySlot.get(slotKey(o));
        if (!lab) continue;
        const rec = { label: lab, value: o.actualValue || '', reconciled: true };
        const idx = filled.findIndex((x) => x.label === lab);
        if (idx >= 0) filled[idx] = rec;
        else filled.push(rec);
      }
    } catch (err) {
      if (isTabGone(err)) throw err; // otherwise best-effort
    }

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

  /**
   * Wait for the dashboard's next command. Returns the phase a rescan
   * resumes ('fill' or 'navigate'), or the run's final result. Heartbeats
   * keep the modal's stale watchdog quiet; a run left without any command
   * for COMMAND_IDLE_MS stops instead of polling forever.
   */
  async _commandLoop(run) {
    const { push } = run;
    let idleSince = Date.now();
    for (;;) {
      await sleep(1500);
      const action = await run.nextCommand();
      if (!action) {
        if (Date.now() - idleSince > COMMAND_IDLE_MS) {
          await push('Aucune action depuis 6 h — suivi arrêté.', {
            state: 'aborted',
            message: 'Stopped after 6 hours with no action. The Chrome tab stays open.',
          });
          return { ok: false, expired: true };
        }
        await run.heartbeat();
        continue;
      }
      idleSince = Date.now();

      if (action === 'abort') return this._abort(run);
      if (action === 'manual_sent') {
        await push('Envoi confirmé manuellement.', {
          state: 'submitted',
          message: '📨 Send confirmed manually.',
        });
        return { ok: true, submitted: true };
      }
      if (action === 'submit') {
        if (await this._sendApplication(run)) return { ok: true, submitted: true };
        continue;
      }
      if (action === 'rescan') {
        await push('Re-scan demandé…', { state: 'finding_form', message: 'Rescanning the form…' });
        run.navAi = { nav: 0, review: 0 };
        let probe = { verdict: 'none' };
        try {
          probe = (await this.probeForm(run.tabId)).probe || probe;
        } catch (err) {
          if (isTabGone(err) && !(await this._recoverRunTab(run))) {
            await push('Onglet introuvable — ouvre le formulaire de l’offre dans Chrome.', {
              state: 'needs_human',
              message: `Tab closed. Open this offer’s form, then ${RESCAN_BTN}.`,
            });
            continue;
          }
        }
        // No form on screen: navigation starts over (it fills as soon as one shows).
        return probe.verdict === 'application_form' ? 'fill' : 'navigate';
      }
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
