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
import { applicationVoiceFor, cvSummaryFor } from '../lib/application-writing.mjs';
import { careerIndexFor } from '../lib/form-answer.mjs';
import { portfolioEvidenceFor } from '../lib/apply-evidence.mjs';
import {
  shouldFillField,
  isSubstantiveOptionalQuestion,
  isResumeFileField,
  isGenericDocumentSlot,
  cvFallbackFor,
  isComboboxField,
  listTypeQuery, dialAnswerCountry, labelIsOnlyPlaceholder,
  listTypeQueryAlt,
  fieldIsMulti,
  shouldReplaceFilledValue,
  fieldHasCommittedValue,
  formHasPhoneDialPicker,
  formHasSurnameField,
  formHasGivenNameField,
  looksLikeDialCodeField,
  looksLikePhoneNumberField,
  isCoreApplicationIdentity,
  isPlaceIdentityField,
  fieldLooksRequired,
  isApplicationGateConsent,
} from '../lib/apply-fill-guards.mjs';
import { choiceKind, optionsAreYesNo, optionsLookLikeWorkPolicy, placeWantedOnYesNoList, remotePolicyPlan } from '../lib/apply-option-match.mjs';
import { pickDeclineOption, pickSelectOption, llmKind, yesNoText, DECLINE_RE, isDemographicLabel } from '../lib/apply-select.mjs';
import {
  fieldCompletionIssue,
  looksReadyToSubmit,
  shouldUploadFileField,
  fieldLabel,
  completionIssues,
  mergeFilled,
  mergePending,
  settleCheckboxGroups,
  skippedFields,
} from '../lib/apply-completion.mjs';
import {
  rankSubmitCandidates,
  askSubmitPick,
  classifyApplyPage,
  pageStateMessage,
  pageShowsIdentity,
  waitsForHuman,
} from '../lib/apply-submit.mjs';
import { COMMAND_IDLE_MS, UI_BUTTONS } from '../lib/apply-runtime.mjs';
import { computeStartDateISO as toIsoDate } from '../lib/apply-spec.mjs';
import { extractEmbeddedApplyUrl } from '../lib/apply-navigation.mjs';
import {
  MAX_FIELD_ATTEMPTS,
  createRunMemory,
  displayValue,
  ensureOrdinals,
  hasShownValue,
  failedAttempts,
  fieldKey,
  forgetAnswer,
  knownAnswer,
  knownOptions,
  listNeedsChange,
  listShowsAnswer,
  noteFailedAttempt,
  planWant,
  readBackMatches,
  readBackTruncated,
  reconCandidates,
  rematchFields,
  rememberAnswer,
  rememberOptions,
  retryTargets,
  stillContradicted,
  slotKey,
  stableKey,
  withOrdinals,
} from '../lib/apply-refill.mjs';
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
  AUTO_APPLY_TEXT_RE,
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

const RESUME_LABEL_RE = /resume|\bcv\b|curriculum|autofill|_systemfield_resume|choose a file|drop (it|file) here|attach/i;
const resumeUploaded = (labels = []) => labels.some((l) => RESUME_LABEL_RE.test(String(l)));

// Extra wait after a fill's own budget before reading the result off the page.
const FILL_GRACE_MS = 60000;
// Dashboard button names, quoted in the messages that tell the user what to click.
// Words a control needs for the navigation model's pick to be clicked.
const NAV_CTA_WORD_RE = /apply|application|postul|candidat|bewerb|aplic|continue|continuer|next|suivant|weiter|start|begin|commenc|join|proceed|submit|send|guest|visitor|invit|continu|view (the )?(job|role|position|opening|offer)|open (the )?(job|role|position)|see (the )?(job|role|position)|i['’]?m interested|interested|int[eé]ress|sollicit|candidatar|get started|accept|agree|consent|i agree|dismiss|close|\bok\b|got it|allow|reject|decline/i;
const RESCAN_BTN = UI_BUTTONS.rescan;
const SEND_BTN = UI_BUTTONS.send;

// Fields that read as an application: a candidate identity slot or a file
// input. A listing page's filter selects (country, category) are not.
function looksLikeApplicationFields(fields = []) {
  return (fields || []).some((f) => f && (f.type === 'file' || isCoreApplicationIdentity(f)));
}

/** Serialize a RegExp (or string) for the extension fill payload. */
export function serializePrefer(re) {
  if (!re) return null;
  if (re instanceof RegExp) return { source: re.source, flags: re.flags || 'i' };
  return { source: String(re), flags: 'i' };
}

function serializeRank(rank) {
  if (!Array.isArray(rank)) return undefined;
  const out = rank.map(serializePrefer).filter(Boolean);
  return out.length ? out : undefined;
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
  if (optionsLookLikeWorkPolicy(f.options) || /only want to work remote|remote only|travel frequently|move to hamburg|hamburg office/i.test(`${optionText} ${plan.selectText || ''} ${plan.value || ''}`)) {
    return { list: true, typeQuery: '' };
  }
  const text = String(optionText || '').trim();
  if (text) return { list: true, typeQuery: text.length <= 40 ? text : '' };
  const typeQuery = listTypeQuery(f, plan, identity);
  // Dial-code lists: the code first, the country name if the code found nothing.
  const typeQueryAlt = listTypeQueryAlt(f, plan, identity);
  return { list: true, typeQuery, ...(typeQueryAlt ? { typeQueryAlt } : {}) };
}

/**
 * Time one fill-fields call may take. The extension runs the updates back to
 * back inside the tab: a list can need ~13 s (open, search, trusted-click
 * retry) and long answers are typed in small chunks. A flat 45 s cut the N26
 * form off halfway — the run ended in error while the tab kept typing.
 */
/**
 * State written when a send click went through. Only a confirmation read on
 * the page (thank-you text, post-apply URL) counts as proof: a form that
 * merely disappeared, a URL that changed, or a click with nothing read is
 * "sent?" — the dashboard leaves it Started until the user confirms (an
 * AssessFirst run marked Applied had in fact stopped on "verify your email to
 * complete the application"). `evidence` is the page text that proved it.
 */
export const WEAK_SEND_EVIDENCE = new Set(['', 'formulaire disparu']);
export function sentStateFields(evidence = '') {
  const proof = String(evidence || '').trim();
  if (!WEAK_SEND_EVIDENCE.has(proof)) {
    return {
      state: 'submitted',
      confirmed: true,
      unconfirmed: false,
      confirmEvidence: proof.slice(0, 120),
      message: 'Application sent — confirmation read on the page.',
      pending: [],
    };
  }
  return {
    state: 'submitted',
    confirmed: false,
    unconfirmed: true,
    confirmEvidence: proof,
    message: '📨 Sent? The send was clicked but no confirmation was read on the page. Check the tab (or your inbox), then mark it applied.',
    pending: [],
  };
}

export function fillTimeoutMs(updates = []) {
  let ms = 20000;
  for (const u of updates || []) {
    // A place search waits for its geocoding suggestions (up to ~12 s).
    if (u.list || u.placeSuggest) ms += 15000 + (u.selectMany?.length || 0) * 1500;
    else if (u.check || u.choice || u.selectText != null || u.selectPrefer) ms += 2500;
    else ms += 1500 + Math.min(20000, String(u.value || '').length * 15);
  }
  return Math.min(ms, 300000);
}

/**
 * Turn a classifyField plan into a fill-fields update payload for the extension.
 * Returns null when the field should be left blank / unresolved / skipped.
 */
export function planToUpdate(f, plan, identity = {}, spec = {}) {
  if (!plan || plan.skip) return null;
  const label = fieldLabel(f);
  if (plan.upload) {
    return { i: f.i, frameId: f.frameId ?? 0, upload: plan.upload, label };
  }
  if (plan.resume) {
    const cv = cvSummaryFor(spec, ROOT);
    if (!cv) return null;
    return { i: f.i, frameId: f.frameId ?? 0, value: cv, label, resume: true };
  }
  if (plan.check) {
    return { i: f.i, frameId: f.frameId ?? 0, value: 'yes', check: true, label };
  }

  const tag = String(f.tag || '').toLowerCase();
  const type = String(f.type || '').toLowerCase();

  if (tag === 'select' || type === 'radio' || isComboboxField(f)) {
    // Options already scraped as Yes|No: never ship a city string at them.
    if (optionsLookLikeWorkPolicy(f.options)
        && /\blocation\b|hamburg|visit|office|hybrid|travel|relocat/i.test(String(f.label || ''))) {
      plan = { ...plan, ...remotePolicyPlan(f.options) };
    } else if (optionsAreYesNo(f.options) && placeWantedOnYesNoList(f.label, plan.selectText || plan.value)) {
      plan = { ...plan, yesNo: 'yes', selectText: 'Yes', value: 'Yes' };
    }
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
    const alternates = [plan.selectMatch, plan.selectText, plan.value, dialAnswerCountry(text)]
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
      selectRank: serializeRank(plan.selectRank),
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
  // Location typeaheads (Lever .location-input, Google Places) only commit
  // when a suggestion is clicked. The city is the search text. The phone
  // number is never that search.
  const placeHead = `${f.name || ''} ${f.idAttr || ''} ${f.autocomplete || ''} ${String(f.label || '').slice(0, 48)}`.toLowerCase();
  const mustPickSuggestion = isPlaceIdentityField(f) && !plan.yesNo && type !== 'tel'
    && /location|located|based|city|ville|address-level/.test(placeHead)
    && !/address line|street|postal|zip|code postal/.test(placeHead);
  if (mustPickSuggestion) {
    const city = String(plan.selectMatch || identity.city || value)
      .split(',')[0]
      .replace(/\(.*?\)/g, '')
      .trim();
    const query = city && !/^\+?\d[\d\s().-]{6,}$/.test(city) ? city : '';
    return {
      i: f.i,
      frameId: f.frameId ?? 0,
      value,
      selectText: value,
      label,
      fromQuestion: plan.fromQuestion,
      placeSuggest: true,
      typeQuery: query,
      alternates: [query, value].filter((v, k, all) => v && all.indexOf(v) === k),
    };
  }
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
const RETRYABLE_PENDING_RE = /upload échoué|échec fill|radio option not found|FileList|valeur non retenue|valeur tronquée|element not found|liste non ouverte|cliquée mais non retenue|remplissage interrompu/i;

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
    this.bind(socket);
    socket.on('message', (raw) => this._onMessage(raw));
    socket.on('close', () => this.release(socket));
  }

  /** Makes `socket` this bridge's extension; its messages arrive through _onMessage. */
  bind(socket) {
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
  }

  /** `socket` closed or moved to another account: forget it, fail its requests. */
  release(socket) {
    if (this.socket !== socket) return;
    this.socket = null;
    this.capabilities = new Set();
    this.extensionVersion = null;
    this._rejectAllPending(new Error('apply-bridge extension disconnected'));
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
      // Text and lists count only when they show what was sent.
      else if (same && readBackMatches(f, u)) value = displayValue(f);
      return value
        ? { i: u.i, frameId: u.frameId ?? 0, ok: true, actualValue: value }
        : { i: u.i, frameId: u.frameId ?? 0, ok: false, reason: same && readBackTruncated(f, u) ? 'valeur tronquée' : 'remplissage interrompu (délai dépassé)' };
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

  /** Click `pick` (a SUBMIT_CANDIDATES row) when given, else the Submit regex. */
  clickSubmit(tabId, pick = null) {
    const chosen = pick && this.capabilities.has('submit-pick') ? { n: pick.n, frameId: pick.frameId ?? 0 } : null;
    return this._request('click-submit', { tabId, reSrc: SUBMIT_TEXT_RE.source, ...(chosen ? { pick: chosen } : {}) });
  }

  /** Every frame's controls with their place (SUBMIT_CANDIDATES), or null on an older extension. */
  async submitCandidates(tabId) {
    if (!this.capabilities.has('submit-pick')) return null;
    try {
      const frames = await this._pageHelper(tabId, 'SUBMIT_CANDIDATES');
      return Array.isArray(frames) ? frames : null;
    } catch (err) {
      if (isTabGone(err)) throw err;
      return null;
    }
  }

  /**
   * What the page shows around the application (classifyApplyPage): captcha,
   * e-mail code, closed offer, confirmation… `{ kind: 'none' }` when the
   * extension predates the helper or the read fails.
   */
  async pageState(tabId, stage = 'navigate', jobUrl = '') {
    const frames = await this.pageSignals(tabId);
    return frames ? classifyApplyPage(frames, { stage, jobUrl }) : { kind: 'none', evidence: '' };
  }

  /** APPLY_PAGE_SIGNALS of every frame, or null (older extension, failed read). */
  async pageSignals(tabId) {
    if (!this.capabilities.has('submit-pick')) return null;
    try {
      const frames = await this._pageHelper(tabId, 'APPLY_PAGE_SIGNALS');
      return Array.isArray(frames) ? frames : null;
    } catch (err) {
      if (isTabGone(err)) throw err;
      return null;
    }
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

  clickProgression(tabId, textRe, skip = [], { scrollFirst = true, formStep = false } = {}) {
    return this._request('click-progression', {
      tabId,
      reSrc: textRe.source,
      avoidSrc: AUTH_AVOID_TEXT_RE.source,
      skip,
      scrollFirst,
      formStep,
    });
  }

  /** Click one control whose visible label is exactly `text`. Auth regex still vetoes. */
  clickExactLabel(tabId, text) {
    return this.clickProgression(tabId, exactControlPattern(text), [], { scrollFirst: false });
  }

  /** The chosen control first, then an AI-chosen send label, then the Submit regex. */
  async clickSend(tabId, exactText, pick = null) {
    if (pick) {
      const res = await this.clickSubmit(tabId, pick).catch(() => null);
      // Clicked, or the chosen control is disabled: that answer stands. A
      // control that left the page falls through to the label search.
      if (res?.clicked || res?.disabled) return res;
    }
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
      allowAutoApply: !!run.spec?.autoSubmit,
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
      fields = withOrdinals((await this.detectFieldsInTab(run.tabId)).fields || []);
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
    run.memory = run.memory || createRunMemory();
    const result = await this._fillOnce(run.tabId, run.spec, targets, {
      push: run.push,
      uploadedLabels: run.uploaded,
      memory: run.memory,
      scoped: true,
      answered: run.filled,
    });
    run.filled = mergeFilled(run.filled, result.filled);
    // What this pass could not fix stays reported: dropping it let a retry
    // Next or Send go ahead over an empty required field.
    run.pending = mergePending(run.pending, result.pending, run.filled);
    run.uploaded = [...new Set([...run.uploaded, ...result.uploaded])];
    await this._tickConsents(run);
    // A retry click is only worth it when something new was written and no
    // required field is left blocking.
    const wroteSomething = result.filled.some((r) => !r.kept && !r.same) || result.uploaded.length > 0;
    const blocked = result.pending.some((p) => isBlockingApplyPending(p.reason));
    return wroteSomething && !blocked;
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
   * Draw the quick-fill helper over the offer tab (apply-helper-overlay.js).
   * Throws when this build of the extension cannot.
   */
  async showHelper(tabId, helper) {
    if (!this.capabilities.has('apply-helper')) {
      throw new Error('the extension is too old for the on-page helper — reload it in chrome://extensions');
    }
    await this._request('show-helper', { tabId, helper }, 15000);
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
        if (reached === 'aborted' || run.abortRequested) return this._abort(run);
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

  /**
   * Hand a page state to the user (closed offer, e-mail link, sign-in…):
   * log line, dashboard message, one pending row. A closed offer gets its own
   * state, so the dashboard can offer to discard it.
   */
  async _reportPageState(run, page) {
    const info = pageStateMessage(page.kind, page.evidence);
    if (page.kind === 'closed') run.closedSeen = true;
    await run.push(info.log, {
      state: page.kind === 'closed' ? 'closed' : 'needs_human',
      message: info.message,
      pending: info.pending ? mergePending(run.pending, [info.pending], run.filled) : run.pending,
    });
  }

  /**
   * A captcha, bot check or e-mail code only the user can clear: say so, then
   * watch the tab until it is gone. Returns { status, page } where status is
   * 'resolved' (the run goes on alone), 'aborted', 'command' (a dashboard
   * command is queued), 'timeout' or 'gone' (tab closed).
   */
  async _waitHuman(run, page, stage, { timeoutMs = 15 * 60 * 1000 } = {}) {
    const info = pageStateMessage(page.kind, page.evidence);
    await this._reportPageState(run, page);
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      await sleep(2500);
      if (await run.aborted()) return { status: 'aborted', page };
      if (run.queued) return { status: 'command', page };
      let now;
      try {
        now = await this.pageState(run.tabId, stage, run.originUrl);
      } catch (err) {
        if (isTabGone(err)) return { status: 'gone', page };
        continue;
      }
      if (now.kind !== page.kind) {
        run.pending = run.pending.filter((p) => p.label !== info.pending?.label);
        await run.push(`${info.pending?.label || 'Blocage'} réglé — reprise automatique.`, {
          state: stage === 'navigate' ? 'navigating' : 'filling',
          message: 'Resuming…',
        });
        return { status: 'resolved', page: now };
      }
      await run.heartbeat();
    }
    await run.push(`${info.pending?.label || 'Blocage'} toujours là après ${Math.round(timeoutMs / 60000)} min — à toi de jouer.`);
    return { status: 'timeout', page };
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
      let cookieClosed = null;
      try { cookieClosed = await this.dismissCookies(run.tabId); } catch { /* ignore */ }
      // A cookie dialog that showed up after the Apply click swallowed it
      // (jobs.workable.com: the application modal never opened): once the
      // banner is gone, the same Apply may be clicked again.
      if (hop > 0 && (cookieClosed?.clicked || cookieClosed?.text) && attempted.size) {
        await push(`Bannière cookies fermée (« ${cookieClosed.text || cookieClosed.clicked} ») — nouvel essai du bouton Apply.`);
        attempted.clear();
      }

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

      // No form yet: the page may say why. A closed offer ends the search; a
      // captcha, bot check or e-mail code waits for the user, then goes on.
      let page = { kind: 'none' };
      try {
        page = await this.pageState(run.tabId, 'navigate', run.originUrl);
      } catch {
        if (await this._recoverRunTab(run)) continue;
        return noTab();
      }
      if (page.kind === 'closed' && !run.ignoreClosed) {
        await this._reportPageState(run, page);
        return 'closed';
      }
      if (waitsForHuman(page.kind)) {
        const waited = await this._waitHuman(run, page, 'navigate');
        if (waited.status === 'aborted') return 'aborted';
        if (waited.status === 'resolved') continue;
        return 'human';
      }

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
      // A board's auto-apply files the application through the board itself,
      // past the review and captcha gates and the tracker: only a run that
      // may send on its own tries it, and last.
      const ctas = [GUEST_TEXT_RE, APPLY_TEXT_RE, PROGRESS_TEXT_RE];
      if (run.spec?.autoSubmit) ctas.push(AUTO_APPLY_TEXT_RE);
      for (const re of ctas) {
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
        // Last resort: if we saw text inputs that read as an application
        // (a name / e-mail / phone slot or a file input), try filling anyway.
        // A job board's filter bar is not one: uiuxjobsboard's "COUNTRY"
        // select got "Thailand" and the run ended as "1 field filled".
        if (fields.length >= 2 && looksLikeApplicationFields(fields)) {
          await push(`Aucun CTA — tentative de fill sur ${fields.length} champ(s) détectés`);
          return 'form';
        }
        if (fields.length >= 2) {
          await push(`Aucun CTA — ${fields.length} champ(s) sans identité (filtres ?) — pas de fill`);
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
          if (waited.ready || ((waited.fields || []).length >= 2 && looksLikeApplicationFields(waited.fields))) return 'form';
        }
        const ai = await this.askNavAi(run, { phase: 'navigate', url, skipTexts: skipOn(url), fields });
        if (ai?.log && !ai.skipped) await push(ai.log);
        if (ai?.action === 'fill') {
          await push('IA nav: formulaire traité comme prêt à remplir');
          return 'form';
        }
        if (ai?.action === 'click' && ai.text && !NAV_CTA_WORD_RE.test(ai.text)) {
          // A job board's listing page: the model picked a company card ("Kraken")
          // and the run applied to another offer. Only a control that reads as a
          // way into an application is clicked.
          await push(`« ${ai.text} » ne ressemble pas à un bouton de candidature — non cliqué.`);
        } else if (ai?.action === 'click' && ai.text) {
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
    // Options read, answers given and failed writes, shared by every pass on
    // this step so a field is not re-opened, re-asked or retried forever.
    run.memory = createRunMemory();

    let lastMark = '';
    let noopMark = '';
    let applyNoopMark = '';
    let healUsed = false;
    // A new wizard step or tab: its fields start unanswered. The same label
    // on the next step can be another question, so the memory starts over.
    const newStep = () => {
      run.pending = [];
      run.memory = createRunMemory();
      lastMark = '';
      noopMark = '';
      applyNoopMark = '';
      healUsed = false;
    };
    const followOpened = async (click, label) => {
      if ((await this._adoptOpenedTab(run, click, ` ${label}`)) !== true) return false;
      newStep();
      return true;
    };
    // Ranked among same-label fields (see withOrdinals) on the WHOLE page, so
    // a subset passed on later keeps the keys the run memory uses.
    const liveFields = async () => withOrdinals((await this.detectFieldsInTab(run.tabId)).fields || []);
    const fillAndRecord = async (fields, { scoped = false } = {}) => {
      const { filled, pending, uploaded } = await this._fillOnce(run.tabId, spec, fields, {
        push,
        uploadedLabels: run.uploaded,
        memory: run.memory,
        scoped,
        answered: run.filled,
      });
      run.filled = mergeFilled(run.filled, filled);
      run.pending = mergePending(run.pending, pending, run.filled);
      run.uploaded = [...new Set([...run.uploaded, ...uploaded])];
      await run.set();
    };
    // The live DOM is the judge: a field the ATS still flags is pending, even
    // when a fill reported it typed (that hid the fields behind "envoi refusé").
    const noteIssues = (issues) => {
      const flaggedKeys = new Set(issues.map((x) => x.key).filter(Boolean));
      const flaggedLabels = new Set(issues.map((x) => x.label));
      run.filled = run.filled.filter((f) => (f.key ? !flaggedKeys.has(f.key) && !(flaggedLabels.has(f.label) && !issues.some((x) => x.key && x.label === f.label)) : !flaggedLabels.has(f.label)));
      run.pending = mergePending(run.pending, issues, run.filled);
    };
    // Click Next and wait for the step to change: 'moved', 'none' or { stuck }.
    const clickNext = async (logText) => {
      // formStep: inside the form a Next is a button of the page, never a header
      // or footer link, nor a link to another site (Kraken's "Get started" opened
      // its sign-up page and the run filled that).
      const next = await this.clickProgression(run.tabId, PROGRESS_TEXT_RE, [], { scrollFirst: true, formStep: true });
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
      // A "no longer accepting applications" banner over the form, or a step
      // that asks for an e-mail code: nothing to fill until that is settled.
      // A captcha widget inside the form waits for the send.
      const shown = await this.pageState(run.tabId, 'form', run.originUrl);
      if (shown.kind === 'closed' && !run.ignoreClosed) {
        await this._reportPageState(run, shown);
        return { submitted: false, closed: true };
      }
      if (shown.kind === 'email_code' || shown.kind === 'challenge') {
        const waited = await this._waitHuman(run, shown, 'form');
        if (waited.status === 'aborted') return { aborted: true };
        if (waited.status !== 'resolved') return { submitted: false };
        newStep();
        continue;
      }
      await fillAndRecord(fields);

      // Retry what failed for a reason a second try can fix — only those
      // fields. Re-running the whole page re-opened every list, asked the
      // model again and retyped what had landed.
      let after = await liveFields();
      let issues = completionIssues(after, run.uploaded);
      const isRetryable = (reason) => RETRYABLE_PENDING_RE.test(reason);
      const retryFields = retryTargets(run.pending, after, { retryable: isRetryable, hasValue: hasShownValue })
        .filter((f) => failedAttempts(run.memory, f) < MAX_FIELD_ATTEMPTS);
      // A slot with no file to give (missing on disk, no letter generated for
      // this offer, no CV configured) or not handled fails the same way on
      // every pass: it is not re-attempted.
      const noFileFor = (f) => run.pending.some((p) => p.label === fieldLabel(f)
        && /fichier introuvable|fichier non géré|aucune générée|aucun CV configuré/i.test(String(p.reason || '')));
      const cvRetry = issues.some((x) => /fichier requis|CV manquant/i.test(x.reason))
        ? after.filter((f) => f.type === 'file' && !noFileFor(f) && failedAttempts(run.memory, f) < MAX_FIELD_ATTEMPTS
          && shouldUploadFileField(f, { uploadedLabels: run.uploaded, resumeAlreadyUploaded: resumeUploaded(run.uploaded) }))
        : [];
      // Settle every retryable row now. A field that shows a value since (a
      // pick that landed after the read-back) is filled; a retried field
      // loses its row, which the retry re-adds if it fails again; a field out
      // of attempts keeps its row. A stale row used to block Next and the
      // send on a form that was complete.
      const staleRows = run.pending.filter((p) => isRetryable(String(p.reason || '')));
      if (staleRows.length) {
        const retryKeys = new Set(retryFields.map(stableKey));
        // The row's field: by key, else (ranks moved when a same-label field
        // appeared, or a label-only row) by label, the still-empty one first.
        const rowField = (p) => {
          const exact = p.key ? after.find((f) => stableKey(f) === p.key) : null;
          if (exact) return exact;
          const sameLabel = after.filter((f) => fieldLabel(f) === p.label);
          return sameLabel.find((f) => !hasShownValue(f)) || sameLabel[0] || null;
        };
        const settled = [];
        const stillPending = [];
        for (const p of staleRows) {
          const f = rowField(p);
          // The field left the page (a conditional box hidden again): no
          // ghost row may keep blocking the send. An upload row stays: a
          // forced resume slot never shows up in a collect, and dropping its
          // failure would let the form go without a CV.
          if (!f) {
            if (/upload|\bcv\b|fichier|resume/i.test(`${p.label} ${p.reason}`)) stillPending.push(p);
            continue;
          }
          if (retryKeys.has(stableKey(f))) continue;
          // A value the plan contradicts (an ATS default "Yes") whose
          // replacement failed is not an answer, even though it shows.
          if (stillContradicted(run.memory, f)) {
            const reason = `valeur pré-remplie contraire au profil (« ${displayValue(f).slice(0, 40)} ») — à corriger`;
            stillPending.push({ ...p, reason: /^requis —/.test(String(p.reason || '')) ? `requis — ${reason}` : reason });
            continue;
          }
          if (hasShownValue(f) && !(f.ariaInvalid || f.invalid)) {
            if (f.type === 'file') {
              // An upload reported failed that did attach: record it as a CV,
              // or "CV manquant" would block a form whose CV is there.
              settled.push({ label: fieldLabel(f), value: `📎 ${String(f.fileChip || '').trim() || 'fichier joint'}` });
              run.uploaded = [...new Set([...run.uploaded, fieldLabel(f)])];
            } else {
              settled.push({ label: fieldLabel(f), key: stableKey(f), value: displayValue(f), kept: true });
            }
            continue;
          }
          stillPending.push(p);
        }
        run.pending = [...run.pending.filter((p) => !isRetryable(String(p.reason || ''))), ...stillPending];
        if (settled.length) run.filled = mergeFilled(run.filled, settled);
      }
      if (retryFields.length || cvRetry.length) {
        await push(`Relance auto: ${retryFields.length + cvRetry.length} champ(s) en échec…`);
        await sleep(700);
        await fillAndRecord([...retryFields, ...cvRetry], { scoped: true });
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

      // Nothing left to fill but an Apply entry is still on screen: open the
      // form. Greenhouse keeps "Apply for this job" next to the inline form; a
      // click that only scrolls must not start a full refill of the same page.
      // Every control with its place (null on an older extension). Read once
      // here: the Apply-entry guard below and the send decision share it.
      const sendView = await this.submitCandidates(run.tabId);
      const formHasSend = !!sendView && sendView.some((fr) => (fr.candidates || [])
        .some((c) => !c.disabled && c.inFieldForm && classifyActionLabel(c.text || c.aria || '').kind === 'submit'));
      // The form's own Submit is on screen: the form is open, and the Apply
      // entry beside it must not hold the send back either.
      if (formHasSend) applyEntryVisible = false;
      if (!run.pending.length && applyEntryVisible && applyNoopMark !== lastMark) {
        const markBefore = lastMark;
        const apply = await this.clickProgression(run.tabId, APPLY_TEXT_RE, [], { scrollFirst: true });
        if (apply?.clicked) {
          await push(`Ouverture formulaire: « ${apply.text || 'Apply'} »`);
          if (await followOpened(apply, '(Apply)')) continue;
          if (await this._waitStepChange(run.tabId, markBefore)) {
            newStep();
            continue;
          }
          applyNoopMark = markBefore;
          applyEntryVisible = false;
        }
      }

      // One required question asked as several boxes: one ticked box answers
      // it, and five "requis — sans réponse" rows blocked a complete form (Mews).
      run.pending = settleCheckboxGroups(run.pending, after);
      const hardBlock = run.pending.some((p) => isBlockingApplyPending(p.reason));
      const sawResumeSlot = run.uploaded.length > 0
        || after.some((f) => f.type === 'file' && (f.required || isResumeFileField(f)))
        // A generic documents slot with the CV not attached: the send waits (AssessFirst went out without a CV).
        || (!!spec.cvPath && after.some((f) => isGenericDocumentSlot(f) && !Number(f.fileCount) && !String(f.fileChip || '').trim()));
      const cvBlocksSubmit = sawResumeSlot && !run.filled.some((f) => /📎/.test(String(f.value || '')));
      const requiredEmpty = run.pending.some((p) => isRequiredEmptyReason(p.reason));

      // Its labels in or after the form go first: the 40 labels read from the
      // top of a page (a board's header and menus) could miss the form's own Next.
      let actionLabels = [];
      try { actionLabels = await this.listVisibleActionLabels(run.tabId); } catch { /* controls unknown */ }
      if (sendView) {
        const near = sendView.flatMap((fr) => (fr.candidates || [])
          .filter((c) => !c.disabled && !c.inBanner && !c.inChrome && (c.inFieldForm || c.afterFields))
          .map((c) => c.text || c.aria)).filter(Boolean);
        actionLabels = [...new Set([...near, ...actionLabels])];
      }
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
      // Empty boxes in neither list are kept in the state for audits.
      const skipped = skippedFields(after, { filled: run.filled, pending: run.pending, spec });
      if (skipped.length) await push(`${skipped.length} champ(s) ignoré(s) : ${skipped.map((s) => s.label).join(', ')}`);
      // An e-mail the ATS copied from the CV counts as the identity too, and
      // so does what a signed-in platform already shows: a locked e-mail box
      // the collect skips, or the account e-mail written on the page.
      let liveEmail = after.some((f) => (f.type === 'email' || /e-?mail/i.test(fieldLabel(f))) && hasShownValue(f));
      if (!liveEmail && !run.pending.length && !applyEntryVisible) {
        liveEmail = pageShowsIdentity(await this.pageSignals(run.tabId), spec.identity?.email || '');
      }
      const ready = looksReadyToSubmit({ filled: run.filled, pending: run.pending, applyEntryVisible })
        || (!run.pending.length && !applyEntryVisible && liveEmail);
      const filledCount = run.filled.length;
      let message;
      if (run.pending.length) message = `Form — ${filledCount} filled, ${run.pending.length} left${cvBlocksSubmit ? ' (CV required)' : ''}.`;
      else if (treatAsFinalReview) message = `Review — ready to send (${filledCount} field(s)).`;
      else if (ready) message = `Form ready — ${filledCount} field(s). Review it, then send.`;
      else message = `Form — ${filledCount} field(s) filled.`;
      await run.set({ state: run.pending.length ? 'needs_human' : 'ready_to_review', message, skipped });

      if (!spec.autoSubmit) return { submitted: false };

      // Review step OR ready form → auto-submit (identity from earlier steps counts).
      // A failed Next must not become a send. Every reason not to send is
      // logged: a run that stopped silently on a filled form looked stuck.
      const whyNot = [];
      if (run.pending.length) {
        whyNot.push(`${run.pending.length} champ(s) à compléter (${run.pending.slice(0, 3).map((p) => `« ${String(p.label).slice(0, 40)} »`).join(', ')}${run.pending.length > 3 ? '…' : ''})`);
      }
      if (cvBlocksSubmit) whyNot.push('CV non joint');
      if (!run.pending.length && !(ready || (treatAsFinalReview && filledCount >= 1))) {
        whyNot.push(applyEntryVisible ? 'un bouton « Apply » est encore affiché (formulaire pas ouvert ?)' : 'aucun email rempli sur ce formulaire');
      }
      const rank = sendView ? rankSubmitCandidates(sendView) : null;
      const sendSeen = rank
        ? (rank.confidence === 'high' || rank.confidence === 'medium')
        : (submitPick.allow && submitPick.confidence === 'high');
      if (nextHadNoEffect && !shouldAttemptSubmitAfterNoopNext({
        submitButtonVisible: sendSeen,
        reviewConfidence: treatAsFinalReview ? 'high' : 'none',
        requiredEmpty,
        hardBlock: hardBlock || cvBlocksSubmit,
        progressStillVisible: true,
      })) {
        whyNot.push('Next sans effet (le site refuse sans doute un champ)');
      }

      // Which control sends: the ranked candidates, the model when they leave
      // a doubt, else (older extension) the label vocabulary.
      let pick = null;
      if (!whyNot.length && rank) {
        if (rank.disabled && !rank.pick) {
          pick = rank.disabled; // _sendApplication reports the disabled button
        } else if (aiSubmitText && rank.pick && rank.confidence !== 'high') {
          pick = null; // the review AI named the send label; clickSend uses it
        } else if (rank.confidence === 'high' || rank.confidence === 'medium') {
          pick = rank.pick;
          await push(`Bouton d’envoi: « ${pick.text || pick.aria || 'submit'} » (${rank.confidence === 'high' ? 'sûr' : 'probable'})`);
        } else if ((run.navAi.submit || 0) < 2) {
          run.navAi.submit = (run.navAi.submit || 0) + 1;
          let url = '';
          try { url = (await this.getTab(run.tabId))?.url || ''; } catch { /* unknown */ }
          const ai = await askSubmitPick({
            ranked: rank.ranked,
            url,
            heading: inspected.heading,
            bodySnippet: inspected.bodySnippet,
          });
          if (ai.pick) {
            pick = ai.pick;
            await push(`IA envoi: « ${pick.text || pick.aria || 'submit'} »${ai.reason ? ` (${ai.reason})` : ''}`);
          } else {
            whyNot.push(`aucun bouton d’envoi identifié${ai.reason ? ` (IA: ${ai.reason})` : ''}`);
          }
        } else {
          whyNot.push('aucun bouton d’envoi identifié');
        }
      } else if (!whyNot.length && !aiSubmitText) {
        if (controlsKnown && submitPick.ambiguous) whyNot.push(`libellé ambigu « ${submitPick.ambiguousText} »`);
        else if (controlsKnown && !submitPick.allow && !treatAsFinalReview) whyNot.push('aucun bouton d’envoi reconnu');
      }
      if (whyNot.length) {
        await push(`Pas d’envoi automatique : ${whyNot.join(' · ')}.`);
        if (!run.pending.length && !cvBlocksSubmit) {
          await run.set({
            state: 'ready_to_review',
            message: `Form filled (${filledCount} field(s)) but not sent automatically: the log says why. Send it in Chrome, then ${UI_BUTTONS.sent}, or ${SEND_BTN}.`,
          });
        }
        return { submitted: false };
      }

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
      return { submitted: await this._sendApplication(run, { exactText: aiSubmitText, pick }) };
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
  async _sendApplication(run, { exactText = '', pick = null } = {}) {
    const { push } = run;
    await push('Envoi de la candidature…', { state: 'submitting', message: 'Sending the application…' });
    await this._tickConsents(run);
    // "Confirm send" from the dashboard: rank the controls now (the user may
    // have changed the page). A low-confidence guess is left to the regex.
    if (!pick && !exactText) {
      await this.detectFieldsInTab(run.tabId).catch(() => null); // stamps the fields the ranking reads
      const view = await this.submitCandidates(run.tabId).catch(() => null);
      const rank = view ? rankSubmitCandidates(view) : null;
      if (rank?.pick && rank.confidence !== 'low') pick = rank.pick;
      else if (rank?.disabled) pick = rank.disabled;
    }
    // A captcha inside the form is solved by the user first; the send then
    // goes on by itself.
    const before = await this.pageState(run.tabId, 'form', run.originUrl);
    if (before.kind === 'captcha') {
      const waited = await this._waitHuman(run, before, 'form');
      if (waited.status !== 'resolved') return false;
      await push('Envoi de la candidature…', { state: 'submitting', message: 'Sending the application…' });
    }
    let clicked = await this.clickSend(run.tabId, exactText, pick).catch((err) => {
      this.onLog(`clickSubmit failed: ${err.message}`);
      return null;
    });
    // What the page says right after the click: a captcha or an e-mail code
    // waits for the user, a confirmation ends the run, a closed offer or an
    // e-mail link is handed over. null = nothing said, read the form as before.
    if (clicked?.clicked) {
      const said = await this._readAfterSend(run, clicked, { exactText });
      if (said !== null) return said;
    }
    // The real send button is on the page but disabled: a required field is
    // still missing. Clicking anything else (Kraken: the cookie banner's
    // "Manage Cookie Settings") would be reported as a send.
    if (clicked?.disabled) {
      await push(`Bouton « ${clicked.text} » désactivé — le formulaire attend encore un champ.`, {
        state: 'needs_human',
        message: `⚠️ The send button “${clicked.text}” is disabled: the form still misses something. Fix it in Chrome, then ${SEND_BTN} or ${RESCAN_BTN}.`,
      });
      return false;
    }
    if (clicked?.rejected) {
      const fixed = await this._refillInvalid(run).catch((err) => {
        if (isTabGone(err)) throw err;
        return false;
      });
      // Send again only when the fix wrote something; the same refused form
      // clicked twice proves nothing.
      if (fixed) {
        await sleep(500);
        const retry = await this.clickSubmit(run.tabId).catch(() => null);
        if (retry?.clicked) clicked = retry;
      }
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
      // A button matched by the loose label regex only, with the form still
      // on screen afterwards, is not a send we can vouch for.
      if (clicked.tier === 0 && clicked.stillForm) {
        await push(`Clic sur « ${clicked.text} » sans effet visible — confirme dans l’onglet.`, {
          state: 'needs_human',
          message: `❓ “${clicked.text}” was clicked but the form is still there. Check the tab, then ${SEND_BTN} or ${RESCAN_BTN}.`,
        });
        return false;
      }
      // A real send button, but the form is still on screen after ~8 s with
      // no confirmation and the same URL: sent is likely, not certain.
      if (clicked.stillForm && clicked.urlChanged === false && !clicked.confirmed) {
        // Not vouched for: marking it Applied on a guess filed unsent
        // applications. The user confirms with "I sent it".
        await push(`Envoyé ? « ${clicked.text || 'Submit'} » — formulaire encore affiché, aucune confirmation lue`, {
          state: 'needs_human',
          message: `📨 Sent? The form is still on screen and no confirmation was read. Check the tab, then ${UI_BUTTONS.sent} (or ${SEND_BTN} to click again).`,
          pending: [],
        });
        return false;
      }
      // Nothing read yet: the thank-you page (or a "verify your e-mail"
      // step) often lands a few seconds later. Read it again before deciding.
      let late = { kind: 'none', evidence: '' };
      for (let k = 0; k < 3 && late.kind === 'none'; k++) {
        await sleep(2000);
        late = await this.pageState(run.tabId, 'sent', run.originUrl).catch((err) => {
          if (isTabGone(err)) throw err;
          return { kind: 'none', evidence: '' };
        });
      }
      if (late.kind !== 'none' && late.kind !== 'confirmed' && !(late.kind === 'closed' && run.ignoreClosed)) {
        await this._reportPageState(run, late);
        return false;
      }
      const evidence = late.kind === 'confirmed' ? late.evidence : '';
      const fields = sentStateFields(evidence);
      await push(`Envoyé: « ${clicked.text || 'Submit'} »${fields.confirmed ? ` — confirmation lue (« ${String(evidence).slice(0, 60)} »)` : ' — aucune confirmation lue, à vérifier'}`, fields);
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
   * Read the page after a send click. Returns true (sent), false (handed to
   * the user) or null (the page says nothing: the caller reads the form).
   */
  async _readAfterSend(run, clicked, { exactText = '' } = {}) {
    const { push } = run;
    const read = async () => {
      try {
        return await this.pageState(run.tabId, 'sent', run.originUrl);
      } catch (err) {
        if (isTabGone(err)) throw err;
        return { kind: 'none', evidence: '' };
      }
    };
    const sent = async (text, evidence = '') => {
      const fields = sentStateFields(evidence);
      const note = fields.confirmed
        ? ` — confirmation lue (« ${String(evidence).slice(0, 60)} »)`
        : ` — aucune confirmation lue${evidence ? ` (${evidence})` : ''}, à vérifier`;
      await push(`Envoyé: « ${text || 'Submit'} »${note}`, fields);
      return true;
    };
    let page = await read();
    if (waitsForHuman(page.kind)) {
      const waited = await this._waitHuman(run, page, 'sent');
      if (waited.status !== 'resolved') return false;
      // A solved captcha or a typed code often sends the form by itself.
      await sleep(2500);
      page = await read();
      // The page may still be sending the code (Clear Street): give it time
      // to confirm or drop the form before clicking send a second time.
      for (let wait = 0; wait < 6 && page.kind === 'none'; wait++) {
        const left = (await this.detectFieldsInTab(run.tabId).catch(() => null))?.fields || [];
        if (!this.fieldsLookLikeForm(left)) break;
        await sleep(2000);
        page = await read();
      }
      if (page.kind === 'none') {
        const fields = (await this.detectFieldsInTab(run.tabId).catch(() => null))?.fields || [];
        if (!this.fieldsLookLikeForm(fields)) return sent(clicked.text, 'formulaire disparu');
        await push('Formulaire toujours affiché après la vérification — nouvel envoi.');
        const view = await this.submitCandidates(run.tabId).catch(() => null);
        const rank = view ? rankSubmitCandidates(view) : null;
        const again = await this.clickSend(run.tabId, exactText, rank?.confidence === 'high' || rank?.confidence === 'medium' ? rank.pick : null)
          .catch(() => null);
        if (!again?.clicked) {
          await push('Nouvel envoi impossible — à confirmer dans l’onglet.', {
            state: 'needs_human',
            message: `The check is done, but the form is still there. Send it in Chrome, then ${UI_BUTTONS.sent}.`,
          });
          return false;
        }
        clicked = again;
        page = await read();
        if (waitsForHuman(page.kind)) {
          await this._reportPageState(run, page);
          return false;
        }
        if (page.kind === 'none') {
          if (!again.stillForm || again.confirmed || again.urlChanged) return sent(again.text);
          await push(`« ${again.text || 'Submit'} » recliqué, formulaire toujours là — à vérifier dans l’onglet.`, {
            state: 'needs_human',
            message: `“${again.text || 'Submit'}” was clicked again but the form is still there. Check the tab, then ${UI_BUTTONS.sent} or ${SEND_BTN}.`,
          });
          return false;
        }
      }
    }
    if (page.kind === 'confirmed') return sent(clicked.text, page.evidence);
    if (page.kind === 'email_link' || (page.kind === 'closed' && !run.ignoreClosed) || page.kind === 'login') {
      await this._reportPageState(run, page);
      return false;
    }
    return null;
  }

  /**
   * One fill of `fields`: A) CV uploads, B) deterministic answers from the
   * spec, C) the model for required fields B could not answer, then a
   * reconcile of profile fields the ATS autofill got wrong.
   * Returns this pass's { filled, pending, uploaded }.
   */
  /**
   * One fill of `fields`: uploads, the deterministic plan, the resolver for
   * what is left, then a recon of profile text. `memory` (run.memory) keeps
   * options, answers and failures across passes. `scoped` means the caller
   * passed only some fields (Relance, ATS error fix): nothing outside them
   * is written, while form-wide flags still come from the whole page.
   */
  async _fillOnce(tabId, spec, fields, { push, uploadedLabels = [], memory = null, scoped = false, answered = [] }) {
    memory = memory || createRunMemory();
    const usedAnswers = new Set();
    const filled = [];
    const pending = [];
    const unresolved = [];
    const uploaded = [];
    // Slots this call wrote or tried to write: recon must not retype them
    // (a failed write retyped at once was a third, uncounted attempt).
    const written = new Set();
    let resumeAlreadyUploaded = resumeUploaded(uploadedLabels);
    const reCollect = async (fallback) => {
      try {
        const got = (await this.detectFieldsInTab(tabId)).fields || [];
        return got.length ? withOrdinals(got) : fallback;
      } catch (err) {
        if (isTabGone(err)) throw err;
        return fallback;
      }
    };
    const callerFields = ensureOrdinals(fields);
    const scopeKeys = scoped ? new Set(callerFields.map(stableKey)) : null;
    // Rows carry the field's stable key so two fields with one label stay
    // two rows (mergeFilled / mergePending used to collapse them).
    const row = (f, extra) => ({ label: fieldLabel(f), key: stableKey(f), ...extra });
    // A field that already failed MAX_FIELD_ATTEMPTS passes is left to the
    // user. One pass counts once, however many phases tried it (Phase B and
    // the resolver used to spend both attempts in a single pass, so Relance
    // never retried a list that was merely slow to open).
    const exhausted = (f) => failedAttempts(memory, f) >= MAX_FIELD_ATTEMPTS;
    const failedThisCall = new Set();
    const noteFail = (f) => {
      if (!f) return 1;
      const key = stableKey(f);
      if (!failedThisCall.has(key)) {
        failedThisCall.add(key);
        noteFailedAttempt(memory, f);
      }
      return failedAttempts(memory, f);
    };
    // Lists Phase B found showing a value the plan contradicts: if the
    // replacement fails, Phase C must not keep that value as answered.
    // Kept in the run memory: Relance and later passes must see it too.
    const contradicted = memory.contradicted || (memory.contradicted = new Map());

    // Phase A — file uploads first (Ashby autofill from resume). Re-collect
    // after each upload: ATS re-render invalidates data-co-i markers.
    const doneFiles = new Set();
    for (let pass = 0; pass < 4; pass++) {
      let fileFields = (await reCollect(fields)).filter((x) => x.type === 'file');
      // SuccessFactors hides the resume <input> until "Upload a CV" is clicked.
      if (pass === 0 && spec.cvPath && !resumeAlreadyUploaded && !fileFields.some((f) => isResumeFileField(f))) {
        try {
          const revealed = await this._pageHelper(tabId, 'REVEAL_SF_RESUME');
          if (revealed?.clicked || revealed?.ready) {
            if (revealed.clicked && !revealed.ready) await sleep(600);
            await this._pageHelper(tabId, 'REVEAL_SF_RESUME');
            fileFields = (await reCollect(fields)).filter((x) => x.type === 'file');
            if (fileFields.some((f) => isResumeFileField(f))) {
              await push('Dialogue CV SuccessFactors ouvert.');
            }
          }
        } catch { /* keep the list we have */ }
      }
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
      // A scoped pass only uploads into its own slots, and a slot that
      // failed twice is not retried (each attempt also waits for autofill).
      const todo = fileFields.find((f) => !doneFiles.has(fieldLabel(f))
        && (!scopeKeys || scopeKeys.has(stableKey(f)))
        && !exhausted(f)
        && shouldUploadFileField(f, { uploadedLabels: knownUploaded, resumeAlreadyUploaded }));
      if (!todo) break;
      const labelShort = fieldLabel(todo);
      doneFiles.add(labelShort);
      // No dedicated CV slot on the form: the CV goes into its generic "Additional files" slot.
      const cvFallback = cvFallbackFor(todo, fileFields, { spec, resumeAlreadyUploaded });
      if (cvFallback) await push(`Pas de champ CV d\u00e9di\u00e9: CV d\u00e9pos\u00e9 dans \u00ab ${labelShort} \u00bb.`);
      const plan = classifyField(todo, cvFallback ? { ...spec, cvFallbackSlot: true } : spec, usedAnswers);
      // Dropzones ("Choose a file…") count as resume slots even without HTML required.
      const slotRequired = todo.required || fieldLooksRequired(todo);
      if (!shouldFillField(todo) && !isResumeFileField(todo) && !cvFallback) {
        if (slotRequired) pending.push({ label: labelShort, reason: plan?.skip || 'fichier non géré' });
        continue;
      }
      if (!plan || plan.skip || !plan.upload) {
        if (slotRequired || isResumeFileField(todo)) {
          pending.push({ label: labelShort, reason: plan?.skip || 'fichier non géré' });
        }
        continue;
      }
      if (!existsSync(plan.upload)) {
        pending.push({ label: labelShort, reason: `fichier introuvable: ${basename(plan.upload)}` });
        continue;
      }
      const isLetter = plan.kind === 'cover-letter';
      await push(`Upload ${isLetter ? 'lettre' : 'CV'}: ${basename(plan.upload)}…`);
      try {
        const result = await this.uploadFile(tabId, {
          i: todo.i,
          frameId: todo.frameId ?? 0,
          path: plan.upload,
        });
        if (result?.uploadOk) {
          filled.push({ label: labelShort, value: `📎 ${basename(plan.upload)}` });
          uploaded.push(labelShort);
          if (!isLetter && (isResumeFileField(todo) || plan.upload === spec.cvPath)) resumeAlreadyUploaded = true;
          await push(`${isLetter ? 'Lettre attachée' : 'CV attaché'}: ${basename(plan.upload)}`);
          await sleep(900);
          if (!isLetter) {
            const autofillLine = autofillLogLine(await this.waitResumeAutofill(tabId, spec?.identity || {}));
            if (autofillLine) await push(autofillLine);
          }
        } else {
          const reason = `upload échoué: ${result?.error || 'unknown'}`;
          await push(`CV non attaché — ${reason}`);
          noteFail(todo);
          pending.push({ label: labelShort, reason });
        }
      } catch (err) {
        const reason = `upload échoué: ${String(err.message || err).slice(0, 80)}`;
        await push(`CV non attaché — ${reason}`);
        noteFail(todo);
        pending.push({ label: labelShort, reason });
      }
    }

    // Re-collect after uploads (form may have re-rendered). A scoped call
    // reads the whole page for the form-wide flags ("Nombre" next to
    // "Apellidos", a dial picker) but only writes its own fields.
    const wholeForm = (uploaded.length || scoped) ? await reCollect(callerFields) : callerFields;
    const live = scopeKeys ? wholeForm.filter((f) => scopeKeys.has(stableKey(f))) : wholeForm;
    const formSpec = { ...spec, formHasDialPicker: formHasPhoneDialPicker(wholeForm), formHasSurnameField: formHasSurnameField(wholeForm), formHasGivenNameField: formHasGivenNameField(wholeForm) };

    // Phase B — deterministic classify
    const updates = [];
    for (const f of live) {
      if (f.type === 'file') continue;
      if (!shouldFillField(f) && !(f.type === 'checkbox' && f.required)) continue;
      if (f.type === 'checkbox' && f.checked) continue;
      if (f.type === 'radio' && f.groupChecked) continue;

      const plan = classifyField(f, formSpec, usedAnswers);
      if (plan?.fromQuestion) usedAnswers.add(plan.fromQuestion);
      const wantNow = String(plan?.value || plan?.selectText || '').trim();
      const labelShort = fieldLabel(f);
      // Keep a committed value that already answers the field. Resume parse
      // junk (location policy sentence, salary 4000) still gets replaced. A
      // native select is read by its option text, and a list keeps the option
      // the plan would pick — but not an ATS default the plan contradicts.
      const shown = displayValue(f);
      const invalid = Boolean(f.ariaInvalid || f.invalid);
      if (hasShownValue(f) && !invalid) {
        const listPlan = plan && !plan.skip ? plan : null;
        // A closed react-select is collected without options: the ones this
        // run already saw decide whether its value is the plan's answer.
        const seen = knownOptions(memory, f);
        const isList = f.tag === 'select' || isComboboxField(f);
        const contradicts = isList && listNeedsChange(f, planWant(listPlan), listPlan, seen);
        const keep = isList
          ? listShowsAnswer(f, planWant(listPlan), listPlan, seen)
            || (!contradicts && !shouldReplaceFilledValue(f, shown, wantNow))
          : !shouldReplaceFilledValue(f, shown, wantNow);
        if (keep) {
          contradicted.delete(stableKey(f));
          filled.push(row(f, { value: shown, kept: true }));
          continue;
        }
        if (contradicts) contradicted.set(stableKey(f), shown);
      }
      // A scoped pass (ATS error fix) re-sends a value the form still
      // rejects: that counts as a try, or the same rejected value would be
      // typed again before every Next and every send. A field that is only
      // "invalid" because it is empty (a required box) is counted when its
      // write fails, not before.
      if (scoped && invalid && hasShownValue(f)) noteFail(f);
      if (exhausted(f)) {
        if (f.required) pending.push(row(f, { reason: `requis — non rempli après ${MAX_FIELD_ATTEMPTS} essais` }));
        continue;
      }

      if (!plan) {
        // Empty (a placeholder option counts as empty), or a resolver answer
        // the form rejected: the resolver answers again, without reusing it.
        if ((f.required || isSubstantiveOptionalQuestion(f)) && (!hasShownValue(f) || invalid)) {
          if (invalid) forgetAnswer(memory, f);
          unresolved.push(f);
        }
        continue;
      }
      if (plan.skip) {
        if (plan.answeredBlank) continue;
        if (plan.declinePreferred && f.required && (f.tag === 'select' || f.type === 'radio' || isComboboxField(f))) {
          const decline = pickDeclineOption(f.options || []);
          if (decline) {
            written.add(stableKey(f));
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
          written.add(stableKey(f));
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
          if (f.required) pending.push(row(f, { reason: plan.skip || 'requis — pas de donnée profil' }));
          continue;
        }
        // Phone and dial-code slots are identity, never a question for the model.
        if (f.required && !looksLikeDialCodeField(f) && !looksLikePhoneNumberField(f)) unresolved.push(f);
        continue;
      }

      const update = planToUpdate(f, plan, spec.identity || {}, spec);
      if (!update) {
        // Phone and dial-code slots are identity, never a question for the model.
        if (f.required && !looksLikeDialCodeField(f) && !looksLikePhoneNumberField(f)) unresolved.push(f);
        continue;
      }
      written.add(stableKey(f));
      updates.push(update);
    }

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
          // The resolver gets the real list without opening it again.
          rememberOptions(memory, field, o.options);
        }
        if (o.ok && landed && !/^unchecked$/i.test(landed)) {
          // `kept`: the page left the list as it was (it already showed the
          // answer); `same`: the value typed equals what was there. Neither is
          // a fix, so _refillInvalid does not click Next / Send again for it.
          const sameText = (a, b) => String(a || '').replace(/\s+/g, ' ').trim().toLowerCase() === String(b || '').replace(/\s+/g, ' ').trim().toLowerCase();
          const same = Boolean(field && hasShownValue(field) && sameText(displayValue(field), o.actualValue));
          const flags = { ...(o.kept ? { kept: true } : {}), ...(same ? { same: true } : {}) };
          filled.push(field ? row(field, { value: o.actualValue || '', ...flags }) : { label: lab, value: o.actualValue || '', ...flags });
          if (field) {
            written.add(stableKey(field));
            contradicted.delete(stableKey(field));
          }
          continue;
        }
        if (field) noteFail(field);
        if ((fieldLooksRequired(field) || field?.required) && !(field && looksLikeDialCodeField(field))) {
          // A dial-code list is identity, never a question for the model: the
          // resolver answered "Australia +61" (the widget's geo default) on Agoda.
          unresolved.push(field || { label: lab, required: true, i: o.i, frameId: o.frameId ?? 0, type: 'text' });
        } else {
          const reason = o.reason || (o.ok ? 'valeur non retenue par le formulaire' : 'échec fill');
          pending.push(field ? row(field, { reason }) : { label: lab, reason });
        }
      }
      await push(`Rempli ${filled.length} champ(s) (pass déterministe)`);
    }

    // Phase C — LLM for unresolved required fields
    if (unresolved.length) {
      // Re-collect so data-co-i / data-co-opt markers (and option lists) are fresh
      // after Phase B fills — Ashby remounts wipe stamps and broke radio clicks.
      // Matched by label + rank among same-label fields: by label alone, two
      // "Year" boxes collapsed into one and the empty one was never answered.
      const freshFields = await reCollect(live);
      const targets = [];
      const seen = new Set();
      for (const liveF of rematchFields(unresolved, freshFields)) {
        if (seen.has(stableKey(liveF))) continue;
        seen.add(stableKey(liveF));
        const shownNow = displayValue(liveF);
        if (hasShownValue(liveF) && !(liveF.ariaInvalid || liveF.invalid)) {
          // Phase B tried to replace a value the plan contradicts (an ATS
          // default "Yes" to sponsorship) and failed: that value is not an
          // answer. The user corrects it; it is never reported as filled.
          if (stillContradicted(memory, liveF)) {
            const reason = `valeur pré-remplie contraire au profil (« ${shownNow.slice(0, 40)} ») — à corriger`;
            pending.push(row(liveF, { reason: liveF.required ? `requis — ${reason}` : reason }));
            continue;
          }
          filled.push(row(liveF, { value: shownNow, kept: true }));
          continue;
        }
        if (exhausted(liveF)) {
          if (liveF.required) pending.push(row(liveF, { reason: `requis — non rempli après ${MAX_FIELD_ATTEMPTS} essais` }));
          continue;
        }
        if (labelIsOnlyPlaceholder(liveF)) {
          // No question text: the model would guess (two "Select... Yes No"
          // Lever questions were both answered "Yes"). The user answers it.
          pending.push(row(liveF, { reason: liveF.required ? 'requis — question illisible (libellé introuvable), à remplir manuellement' : 'question illisible (libellé introuvable) — à vérifier' }));
          continue;
        }
        targets.push(liveF);
      }
      for (const f of targets) written.add(stableKey(f));
      await push(`Résolution intelligente de ${targets.length} champ(s)…`);

      // Lists collected without options: reuse what this run already read
      // (a failed pick, an earlier pass), else read them once, so the model
      // picks a real entry without the list being opened on every pass.
      const asOptions = (f, texts) => texts.map((t, k) => ({ value: t, text: t, key: `${f.i}:${k}` }));
      const blind = targets.filter((f) => !(f.options || []).length && (isComboboxField(f) || f.tag === 'select'));
      for (const f of blind) {
        const known = knownOptions(memory, f);
        if (known?.length) f.options = asOptions(f, known);
      }
      const toRead = blind.filter((f) => !(f.options || []).length);
      const read = toRead.length ? await this.readListOptions(tabId, toRead) : new Map();
      for (const f of toRead) {
        const texts = read.get(slotKey(f));
        if (texts?.length) {
          f.options = asOptions(f, texts);
          rememberOptions(memory, f, texts);
        }
      }

      // A "prefer not to say" option answers sensitive questions without the model.
      const declineUpdates = [];
      const llmTargets = [];
      for (const f of targets) {
        // Only a demographic question takes its "prefer not to say" row; on
        // "Are you authorized…?" the same pre-pass picked "No, I do not…".
        const opt = isDemographicLabel(fieldLabel(f)) ? pickDeclineOption(f.options || []) : null;
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
          if (f.required) pending.push(row(f, { reason: 'requis — sans réponse, à remplir manuellement' }));
          return null;
        }
        if (hasUnresolvedPlaceholder(String(text))) {
          if (f.required) pending.push(row(f, { reason: 'requis — réponse LLM avec placeholder' }));
          return null;
        }
        // The model's exact option text goes out as is: polishing turned
        // "Team of 5+ people" into "" and "Senior – 5 to 8 years" into a
        // comma, and the pick then matched nothing.
        const exactRow = (f.options || []).find((o) => String(o?.text || '').trim().toLowerCase() === String(text).trim().toLowerCase());
        // Prefer a listed option text when the LLM paraphrases Yes/No.
        let selectText = exactRow ? String(exactRow.text).trim() : polishApplicationAnswer(String(text));
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
          selectMany: many.length ? many : undefined,
          label,
          llm: true,
          options: f.options,
          choice: f.type === 'radio',
          // No real option: the model's words are only matched. A search list
          // (city, country…) still gets its profile query, never the answer.
          ...listPayload(f, { optionText, identity: spec.identity || {} }),
        };
      };
      // A field answered earlier in this run gets the same answer back: the
      // model is not asked again (it gave "No" then "Yes" to one question).
      // Fields are keyed by their position in this call, not by collect
      // index, which restarts in every frame.
      const answer = async (fieldsToAnswer) => {
        if (!fieldsToAnswer.length) return [];
        const ask = fieldsToAnswer.filter((f) => knownAnswer(memory, f) == null);
        let answers = {};
        if (ask.length) try {
          answers = await resolveUnknownFields({
            fields: ask.map((f, k) => ({
              i: k,
              label: f.label,
              kind: llmKind(f),
              required: f.required,
              multiple: fieldIsMulti(f),
              options: f.options,
              maxLength: f.maxLength,
            })),
            spec,
            career: careerIndexFor(spec, ROOT),
            portfolio: portfolioEvidenceFor(spec, ROOT),
            styleGuide: applicationVoiceFor(spec, ROOT),
            // What the form already says, so "Are you located in France?"
            // agrees with the location typed two fields above — earlier
            // passes included.
            answered: mergeFilled(answered, filled),
          });
        } catch (err) {
          await push(`LLM indisponible (${String(err.message || err).slice(0, 70)})`);
        }
        // Only a usable answer is kept for later passes: an empty or
        // placeholder one is asked again next time, not replayed.
        ask.forEach((f, k) => {
          const a = answers[String(k)];
          const text = Array.isArray(a) ? a[0] : a;
          if (text && !hasUnresolvedPlaceholder(String(text))) rememberAnswer(memory, f, a);
        });
        const deduced = answers.inferred || {};
        return fieldsToAnswer.map((f) => {
          const k = ask.indexOf(f);
          const u = updateFor(f, k >= 0 ? answers[String(k)] : knownAnswer(memory, f));
          // A pick the model deduced from the CV/portfolio: shown for review.
          const why = k >= 0 ? deduced[String(k)] : null;
          if (u && why) u.inferred = [why.why, why.source && `source : ${why.source}`].filter(Boolean).join(' — ') || 'déduit';
          return u;
        }).filter(Boolean);
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
          const target = targetBySlot.get(slotKey(o));
          const landed = String(o.actualValue ?? '').trim();
          if (o.ok && landed && !/^unchecked$/i.test(landed)) {
            const flags = { llm: true, ...(o.kept ? { kept: true } : {}), ...(u.inferred ? { inferred: u.inferred } : {}) };
            filled.push(target ? row(target, { value: o.actualValue || '', ...flags }) : { label: u.label, value: o.actualValue || '', ...flags });
            if (target) written.add(stableKey(target));
            continue;
          }
          const f = blindBySlot.get(slotKey(o));
          if (f && Array.isArray(o.options) && o.options.length) {
            // The list showed its real options: the earlier answer was made
            // without them, so it is dropped and asked again among them.
            rememberOptions(memory, f, o.options);
            forgetAnswer(memory, f);
            again.push({ ...f, options: o.options.map((t, k) => ({ value: t, text: t, key: `${f.i}:${k}` })) });
            continue;
          }
          const tries = target ? noteFail(target) : 1;
          const why = o.reason || 'option introuvable';
          // The answer matched no option of the list: never replay it.
          if (target && /introuvable/i.test(why)) forgetAnswer(memory, target);
          const reason = tries >= MAX_FIELD_ATTEMPTS
            ? `réponse suggérée non retenue après ${tries} essais (${why})`
            : `réponse suggérée — ${why}`;
          const required = target?.required || u.required;
          const entry = { reason: required ? `requis — ${reason}` : reason };
          pending.push(target ? row(target, entry) : { label: u.label, ...entry });
        }
        return again;
      };
      const targetBySlot = new Map(targets.map((f) => [slotKey(f), f]));

      const stillBlind = new Map(llmTargets.filter((f) => !(f.options || []).length).map((f) => [slotKey(f), f]));
      const again = await fillAnswers([...declineUpdates, ...(await answer(llmTargets))], stillBlind);
      if (again.length) {
        // The list opened during the fill: answer once more, among its real options.
        await push(`${again.length} liste(s) lue(s) pendant le remplissage — nouvelle réponse avec leurs options…`);
        for (const f of again) targetBySlot.set(slotKey(f), f);
        await fillAnswers(await answer(again), new Map());
      }
    }

    // Recon: profile TEXT the ATS autofill may have changed after Phase B
    // (an async CV parse). Not what this call just wrote, not lists (Phase B
    // owns them; a recon pick re-opened them and could undo a resolver
    // answer), and nothing outside a scoped caller's fields.
    try {
      const fresh = await reCollect([]);
      const recon = [];
      const reconField = new Map();
      for (const f of reconCandidates(fresh, { written, scope: scopeKeys })) {
        if (!shouldFillField(f) || exhausted(f)) continue;
        const plan = classifyField(f, formSpec);
        if (!plan || plan.skip || plan.check || plan.resume) continue;
        const want = polishApplicationAnswer(plan.value || plan.selectText || yesNoText(plan));
        if (!want || !shouldReplaceFilledValue(f, f.value, want)) continue;
        reconField.set(slotKey(f), f);
        recon.push({
          i: f.i,
          frameId: f.frameId ?? 0,
          value: want,
          selectText: want,
          label: fieldLabel(f),
        });
      }
      const result = await this.fillFields(tabId, recon);
      for (const o of result.outcomes || []) {
        const f = o.ok && reconField.get(slotKey(o));
        if (!f) continue;
        const rec = row(f, { value: o.actualValue || '', reconciled: true });
        const idx = filled.findIndex((x) => (x.key || x.label) === rec.key);
        if (idx >= 0) filled[idx] = rec;
        else filled.push(rec);
      }
    } catch (err) {
      if (isTabGone(err)) throw err; // otherwise best-effort
    }

    return {
      filled,
      pending: mergePending([], pending, filled),
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
      // The loose "i agree / privacy" match only for boxes the form requires:
      // an optional talent-pool or newsletter consent stays the candidate's
      // choice (classifyField ticks it only with consentOptIn).
      if (!isApplicationGateConsent(f)
          && !((f.required || fieldLooksRequired(f)) && /privacy|i agree|by submitting/i.test(`${f.label || ''}`))) continue;
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
          confirmed: true,
          unconfirmed: false,
          confirmEvidence: 'confirmé par l’utilisateur',
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
        // A rescan after "offer closed" means the user sees it open: the
        // closed reading no longer stops this run.
        if (run.closedSeen) run.ignoreClosed = true;
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

/**
 * One ApplyBridge per account. Each Chrome extension says whose it is with
 * the pairing token the dashboard handed it (`hello` / `pair` messages carry
 * `pairToken`); `resolveAccount(token)` turns that into an account key, or
 * null. A socket nobody resolves stays unbound: no run is ever sent to it, so
 * a run only reaches the Chrome of the account that started it.
 */
export class ApplyBridgeHub {
  constructor({ resolveAccount = async () => null } = {}) {
    this.resolveAccount = resolveAccount;
    this.bridges = new Map();
    this.onLog = () => {};
    // Never bound: what an account without a paired extension gets.
    this.unpaired = new ApplyBridge();
  }

  /** The account's bridge (created on first use). A falsy key gets the unbound one. */
  forAccount(key) {
    if (!key) return this.unpaired;
    let bridge = this.bridges.get(key);
    if (!bridge) {
      bridge = new ApplyBridge();
      bridge.onLog = (m) => this.onLog(m);
      this.bridges.set(key, bridge);
    }
    return bridge;
  }

  attach(socket) {
    let bridge = null;
    let hello = null;
    let seq = 0;
    const bindTo = async (token) => {
      const mine = ++seq;
      const key = await Promise.resolve(this.resolveAccount(token || '')).catch(() => null);
      // A later hello/pair answered first: it decides.
      if (mine !== seq) return;
      const next = key ? this.forAccount(key) : null;
      if (next !== bridge) {
        bridge?.release(socket);
        bridge = next;
        bridge?.bind(socket);
        this.onLog(key ? 'extension socket paired with an account' : 'extension socket not paired (open the dashboard signed in)');
      }
      // bind() forgets the capabilities: replay this socket's hello.
      if (bridge && hello) bridge._onMessage(hello);
      try { socket.send(JSON.stringify({ type: 'paired', ok: !!key })); } catch { /* closed */ }
    };
    socket.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg?.type === 'hello' || msg?.type === 'pair') {
        if (msg.type === 'hello') hello = raw.toString();
        bindTo(typeof msg.pairToken === 'string' ? msg.pairToken : '');
        return;
      }
      bridge?._onMessage(raw);
    });
    socket.on('close', () => {
      seq++;
      bridge?.release(socket);
      bridge = null;
    });
  }
}

export function attachApplyBridge(httpServer, bridge, { path = '/apply-bridge', log = () => {} } = {}) {
  bridge.onLog = log;
  const wss = new WebSocketServer({ noServer: true });
  httpServer.on('upgrade', (req, socket, head) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { return; }
    if (url.pathname !== path) return;
    // A web page open in the same browser may dial this socket too; the
    // plugin's service worker sends a chrome-extension:// origin.
    const origin = String(req.headers?.origin || '');
    if (origin && !origin.startsWith('chrome-extension://')) {
      socket.destroy();
      return;
    }
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
