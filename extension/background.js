// background.js — MV3 service worker (module). Connects to a local bridge over
// WebSocket and drives ONE tab in the user's own already-running Chrome
// window (chrome.tabs.create — no separate automated browser process):
//
//   open-tab              → create tab, wait for load, return tabId + url
//   detect-fields         → open URL + collect fields (legacy / one-shot)
//   detect-fields-in-tab  → re-collect fields in an existing tab (no new tab)
//   fill-fields           → write {i, value} into data-co-i markers; an update
//                           with readOptions only opens the list and returns
//                           its option texts
//   upload-file           → CV upload through chrome.debugger
//   page-helper           → run a named in-page helper (page-helper-registry.mjs)
//   click-progression     → mark + click Apply/Next/Guest controls
//   click-submit          → click the send button, report ATS rejections
//   navigate-tab          → chrome.tabs.update to a URL (ATS normalize)
//   get-tab               → url / status of a tab
//   list-window-tabs      → HTTP tabs of the focused window (lost-tab recovery)
//   scroll-tab            → human-like scroll before looking for CTAs
//   dismiss-cookies       → best-effort cookie banner click
//   show-helper           → draw the quick-fill helper over the offer tab
//                           (apply-helper-overlay.js), kept across navigations
//
// Any other message type is answered with ok:false at once, so the bridge
// never waits out its timeout on a request this build does not know.
//
// File upload uses chrome.debugger DOM.setFileInputFiles (shows a brief
// "debugging" banner). Submit is driven by the bridge when autoSubmit is on
// or when the UI sends action=submit.

import { collectUploadSignals, judgeUploadSignals, mergeUploadSignals } from './apply-upload-signals.mjs';
import { PAGE_HELPERS, mergeFrameResults } from './page-helper-registry.mjs';

// Dashboard only. Port 8934 is the optional standalone dev-bridge; probing it
// while it is down makes Chrome log ERR_CONNECTION_REFUSED on every retry.
const BRIDGE_URL = 'ws://127.0.0.1:3210/apply-bridge';
const RECONNECT_MS = 2000;
const KEEPALIVE_ALARM = 'jobyougo-bridge-keepalive';
// Idempotent: recreating the same alarm on every SW wake used to be fine, but
// we only need one. get→create avoids alarm storms if the worker restarts often.
chrome.alarms.get(KEEPALIVE_ALARM, (existing) => {
  if (!existing) chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.4 }); // ~24s
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== KEEPALIVE_ALARM) return;
  // Touch the worker + ensure the socket is up without flipping candidates.
  if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
    connect();
  }
});

let ws = null;
let reconnectTimer = null;
let bridgePhase = 'off';
let bridgeError = '';
const bridgePorts = new Set();
const runBadges = new Map();
const runBadgeTimers = new Map();

function quiet(result) {
  if (result && typeof result.then === 'function') result.catch(() => {});
}

function bridgeSnapshot() {
  return {
    ok: true,
    phase: bridgePhase,
    connected: bridgePhase === 'on',
    error: bridgeError,
    url: BRIDGE_URL,
    version: chrome.runtime.getManifest().version,
  };
}

function paintBadge() {
  const text = bridgePhase === 'on' ? '' : bridgePhase === 'connecting' ? '…' : '!';
  const color = bridgePhase === 'on' ? '#1f9d6e' : bridgePhase === 'connecting' ? '#3d6f8f' : '#8a6230';
  const title = bridgePhase === 'on'
    ? 'JobYouGo connected'
    : bridgePhase === 'connecting'
      ? 'JobYouGo connecting'
      : 'JobYouGo disconnected';
  quiet(chrome.action.setBadgeText({ text }));
  quiet(chrome.action.setBadgeBackgroundColor({ color }));
  quiet(chrome.action.setTitle({ title }));
}

function publishBridge() {
  paintBadge();
  const snap = { type: 'bridge-changed', ...bridgeSnapshot() };
  for (const port of bridgePorts) {
    try { port.postMessage(snap); } catch { bridgePorts.delete(port); }
  }
}

function setPhase(phase, error) {
  bridgePhase = phase;
  if (typeof error === 'string') bridgeError = error;
  if (phase === 'on') bridgeError = '';
  publishBridge();
}

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  setPhase('connecting');
  let socket;
  try {
    socket = new WebSocket(BRIDGE_URL);
  } catch (err) {
    setPhase('off', err?.message || 'Could not open the socket');
    scheduleReconnect();
    return;
  }
  ws = socket;
  const current = () => ws === socket;
  socket.addEventListener('open', () => {
    if (!current()) return;
    console.log('[jobyougo-bridge] connected to', BRIDGE_URL);
    setPhase('on');
    send({
      type: 'hello',
      extension: 'jobyougo-apply-bridge-poc',
      version: chrome.runtime.getManifest().version,
      // Lets the bridge skip messages an older build would never answer.
      capabilities: ['page-helper', 'read-options', 'apply-helper', 'submit-pick'],
    });
  });
  socket.addEventListener('close', () => {
    if (!current()) return;
    setPhase('off');
    scheduleReconnect();
  });
  // Connection refused is reported by Chrome on the WebSocket constructor
  // itself. It is not an exception: the server was not listening yet.
  socket.addEventListener('error', () => {
    if (!current()) return;
    bridgeError = 'Dashboard is not reachable on port 3210';
    try { socket.close(); } catch { /* already closing */ }
  });
  socket.addEventListener('message', (event) => {
    if (!current()) return;
    onMessage(event);
  });
}

function connectNow() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws && ws.readyState === WebSocket.CONNECTING) {
    publishBridge();
    return bridgeSnapshot();
  }
  if (ws) {
    const old = ws;
    ws = null;
    try { old.close(); } catch { /* already closed */ }
  }
  connect();
  return bridgeSnapshot();
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'bridge-ui') return;
  bridgePorts.add(port);
  port.onDisconnect.addListener(() => bridgePorts.delete(port));
  port.onMessage.addListener((msg) => {
    if (msg?.type === 'ui-role') {
      port.jygRole = msg.role === 'popup' ? 'popup' : '';
      return;
    }
    if (msg?.type === 'bridge-connect') connectNow();
    else if (msg?.type === 'scan-apply-tab') quiet(runScanApplyOnTab(port, msg));
    else if (msg?.type === 'scan-apply-progress') {
      quiet(paintRunBadge(msg.tabId, { phase: msg.phase, text: msg.text }));
    } else if (msg?.type === 'scan-apply-status') {
      const badge = runBadges.get(Number(msg.tabId));
      try {
        port.postMessage({
          type: 'scan-apply-progress',
          tabId: Number(msg.tabId),
          phase: badge?.phase || '',
          text: badge?.text || '',
        });
      } catch { /* popup closed */ }
    } else port.postMessage({ type: 'bridge-changed', ...bridgeSnapshot() });
  });
  port.postMessage({ type: 'bridge-changed', ...bridgeSnapshot() });
});

function scheduleReconnect() {
  ws = null;
  // Debounce: a close+error pair (or SW wake while closing) must not stack
  // multiple connect() timers — that was the rapid connect/hello spam in the
  // dashboard log.
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, RECONNECT_MS);
}

function send(payload) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function reply(requestId, type, ok, extra = {}) {
  send({ type, requestId, ok, ...extra });
}

async function onMessage(event) {
  let msg;
  try { msg = JSON.parse(event.data); } catch { return; }
  const rid = msg.requestId;

  try {
    if (msg.type === 'open-tab' && msg.url) {
      const tab = await openTab(msg.url);
      reply(rid, 'tab-result', true, { tabId: tab.id, url: tab.url || msg.url });
      return;
    }

    if (msg.type === 'detect-fields' && msg.url) {
      const { tabId, fields } = await detectFieldsInNewTab(msg.url);
      reply(rid, 'fields-result', true, { url: msg.url, tabId, fields });
      return;
    }

    if (msg.type === 'detect-fields-in-tab' && msg.tabId) {
      const fields = await collectFieldsInTab(msg.tabId);
      reply(rid, 'fields-result', true, { tabId: msg.tabId, fields });
      return;
    }

    if (msg.type === 'fill-fields' && msg.tabId && Array.isArray(msg.updates)) {
      const outcomes = await fillFieldsInTab(msg.tabId, msg.updates);
      reply(rid, 'fill-result', true, { tabId: msg.tabId, outcomes });
      return;
    }

    if (msg.type === 'upload-file' && msg.tabId && msg.path != null && msg.i != null) {
      const result = await uploadFileInTab(msg.tabId, {
        i: msg.i,
        frameId: msg.frameId ?? 0,
        path: msg.path,
        fileBase64: msg.fileBase64 || null,
        fileName: msg.fileName || null,
      });
      // Transport always succeeds (ok:true). Upload success is uploadOk — do NOT
      // put a failing `ok` in extra (it would overwrite and reject the waiter).
      reply(rid, 'upload-result', true, {
        tabId: msg.tabId,
        uploadOk: !!result?.ok,
        error: result?.error || null,
        fileName: result?.fileName || null,
      });
      return;
    }

    if (msg.type === 'page-helper' && msg.tabId && msg.name) {
      const result = await runPageHelper(msg.tabId, msg.name, msg.args);
      reply(rid, 'helper-result', true, { tabId: msg.tabId, result });
      return;
    }

    if (msg.type === 'click-progression' && msg.tabId && msg.reSrc && msg.avoidSrc) {
      const result = await clickProgressionInTab(
        msg.tabId,
        msg.reSrc,
        msg.avoidSrc,
        msg.skip || [],
        { scrollFirst: msg.scrollFirst !== false },
      );
      reply(rid, 'click-result', true, { tabId: msg.tabId, ...result });
      return;
    }

    if (msg.type === 'click-submit' && msg.tabId && (msg.reSrc || msg.pick)) {
      const result = await clickSubmitInTab(msg.tabId, msg.reSrc, msg.pick || null);
      reply(rid, 'click-result', true, { tabId: msg.tabId, ...result });
      return;
    }

    if (msg.type === 'navigate-tab' && msg.tabId && msg.url) {
      const tab = await navigateTab(msg.tabId, msg.url);
      reply(rid, 'tab-result', true, { tabId: tab.id, url: tab.url || msg.url });
      return;
    }

    if (msg.type === 'get-tab' && msg.tabId) {
      const tab = await chrome.tabs.get(msg.tabId);
      reply(rid, 'tab-result', true, { tabId: tab.id, url: tab.url || '', status: tab.status });
      return;
    }

    if (msg.type === 'list-window-tabs') {
      reply(rid, 'tabs-result', true, { tabs: await listHttpTabs(msg.windowId) });
      return;
    }

    if (msg.type === 'scroll-tab' && msg.tabId) {
      await chrome.scripting.executeScript({
        target: { tabId: msg.tabId },
        func: (y) => window.scrollBy(0, y),
        args: [msg.deltaY || 650],
      });
      reply(rid, 'scroll-result', true, { tabId: msg.tabId });
      return;
    }

    if (msg.type === 'dismiss-cookies' && msg.tabId) {
      const clicked = await dismissCookiesInTab(msg.tabId);
      reply(rid, 'click-result', true, { tabId: msg.tabId, clicked, text: clicked || null });
      return;
    }

    if (msg.type === 'show-helper' && msg.tabId && msg.helper) {
      await setHelper(msg.tabId, { ...msg.helper, minimized: false });
      await injectHelper(msg.tabId);
      reply(rid, 'helper-shown', true, { tabId: msg.tabId });
      return;
    }

    // The bridge matches replies by requestId only; the type is informative.
    reply(rid, `${msg.type || 'request'}-result`, false, { error: `unsupported message: ${msg.type}` });
  } catch (err) {
    reply(rid, `${msg.type || 'request'}-result`, false, { error: String(err?.message || err) });
  }
}

// ── Quick-fill helper over the offer tab ────────────────────────────────────
// One helper per tab, in session storage so a service-worker restart keeps it.
// A tab opened from a helper tab (Apply → ATS in a new tab) inherits it.

const HELPER_KEY = (tabId) => `helper:${tabId}`;
// Same pages as the dashboard-bridge.js content script in manifest.json.
const DASHBOARD_URLS = ['http://127.0.0.1:3210/*', 'http://localhost:3210/*'];

async function getHelper(tabId) {
  const key = HELPER_KEY(tabId);
  return (await chrome.storage.session.get(key))[key] || null;
}

function setHelper(tabId, helper) {
  return chrome.storage.session.set({ [HELPER_KEY(tabId)]: helper });
}

async function injectHelper(tabId) {
  const helper = await getHelper(tabId);
  if (!helper) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (data) => { self.__jobyougoHelperData = data; },
      args: [helper],
    });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['apply-helper-overlay.js'] });
  } catch (err) {
    // chrome:// pages, the Web Store, a tab closed meanwhile: nothing to draw on.
    console.log('[jobyougo-bridge] helper not injected:', err?.message || err);
  }
}

async function setHelperHidden(tabId, hidden) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (hide) => {
        document.getElementById('jobyougo-apply-helper')?.style.setProperty('visibility', hide ? 'hidden' : 'visible');
      },
      args: [hidden],
    });
  } catch { /* no panel to move */ }
}

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status !== 'complete') return;
  quiet(injectHelper(tabId));
  if (runBadges.has(tabId)) quiet(paintRunBadge(tabId, runBadges.get(tabId), { force: true }));
});

chrome.tabs.onCreated.addListener(async (tab) => {
  if (tab.openerTabId == null) return;
  const helper = await getHelper(tab.openerTabId);
  if (helper) await setHelper(tab.id, helper);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  quiet(chrome.storage.session.remove(HELPER_KEY(tabId)));
  runBadges.delete(tabId);
  const timer = runBadgeTimers.get(tabId);
  if (timer) clearTimeout(timer);
  runBadgeTimers.delete(tabId);
});

// Buttons of the panel. "Fill" brings the dashboard forward and asks it to
// open the auto-apply modal on this tab.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  if (tabId == null || !/^helper-/.test(msg?.type || '')) return false;
  (async () => {
    const helper = await getHelper(tabId);
    if (!helper) return { ok: false };
    if (msg.type === 'helper-close') {
      await chrome.storage.session.remove(HELPER_KEY(tabId));
      return { ok: true };
    }
    if (msg.type === 'helper-minimize' || msg.type === 'helper-restore') {
      await setHelper(tabId, { ...helper, minimized: msg.type === 'helper-minimize' });
      return { ok: true };
    }
    if (msg.type === 'helper-fill') {
      // Looked up per click rather than through bridgePorts: a worker restart
      // drops those ports and the dashboard page does not reopen its own.
      const dashboards = await chrome.tabs.query({ url: DASHBOARD_URLS });
      const request = {
        type: 'helper-fill',
        tabId,
        company: helper.company || '',
        role: helper.role || '',
        report: helper.report || '',
        num: helper.num || '',
      };
      for (const dash of dashboards) {
        try {
          const ack = await chrome.tabs.sendMessage(dash.id, request);
          if (!ack?.ok) continue;
          await chrome.tabs.update(dash.id, { active: true });
          await chrome.windows.update(dash.windowId, { focused: true });
          return { ok: true };
        } catch { /* dashboard opened before the extension loaded: no listener */ }
      }
      return { ok: false };
    }
    return { ok: false };
  })().then(sendResponse, () => sendResponse({ ok: false }));
  return true;
});

function waitForTabComplete(tabId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      if (!settled) reject(new Error('tab did not finish loading in time'));
      settled = true;
    }, timeoutMs);
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') finish();
    }
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === 'complete') finish();
    }).catch(() => {});
  });
}

async function listHttpTabs(windowId) {
  const query = windowId ? { windowId } : { lastFocusedWindow: true };
  const tabs = await chrome.tabs.query(query);
  return tabs
    .filter((t) => /^https?:\/\//i.test(t.url || t.pendingUrl || ''))
    .map((t) => ({
      tabId: t.id,
      url: t.url || t.pendingUrl || '',
      title: t.title || '',
      active: !!t.active,
      openerTabId: t.openerTabId ?? null,
    }));
}

async function currentWindowId() {
  const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
  const focused = windows.find((w) => w.focused) || windows[0];
  return focused?.id;
}

const DASHBOARD_OPEN_URL = 'http://127.0.0.1:3210/dashboard';

function offerTextFromPage() {
  const root = document.querySelector('main, [role="main"], article') || document.body;
  const text = (root?.innerText || '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 20000);
  return { text, title: document.title || '' };
}

async function readOfferText(tabId) {
  const [injected] = await chrome.scripting.executeScript({
    target: { tabId },
    func: offerTextFromPage,
  });
  return injected?.result || { text: '', title: '' };
}

function tellPopup(port, payload) {
  try { port.postMessage({ type: 'scan-apply-result', ...payload }); } catch { /* popup already closed */ }
}

function tellPopups(payload) {
  for (const port of bridgePorts) {
    if (port.jygRole !== 'popup') continue;
    try { port.postMessage(payload); } catch { /* popup closed */ }
  }
}

// Drawn on the offer tab. Kept off <body> so a later read of the posting
// does not scrape this label back into the scan.
function drawRunBadge(state) {
  const id = 'jobyougo-run-status';
  document.getElementById(id)?.remove();
  if (!state?.text) return;
  const phase = state.phase || 'run';
  const tone = phase === 'bad' ? '#ef6b6b' : (phase === 'wait' || phase === 'warn') ? '#e8b86d' : '#2dd4a0';
  const host = document.createElement('div');
  host.id = id;
  host.setAttribute('role', 'status');
  host.style.cssText = `all:initial;position:fixed;z-index:2147483646;top:16px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:8px;max-width:min(520px,calc(100vw - 32px));padding:9px 14px;border-radius:999px;background:#07090a;color:#f2f5f3;border:1px solid ${tone};box-shadow:0 12px 32px rgba(0,0,0,.5);font:600 13px/1.35 Inter,system-ui,sans-serif;pointer-events:none;`;
  const mark = document.createElement('span');
  if (phase === 'run') {
    const style = document.createElement('style');
    style.textContent = '@keyframes jobyougo-run-spin{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){#jobyougo-run-status span{animation:none !important}}';
    host.appendChild(style);
    mark.style.cssText = 'all:initial;width:12px;height:12px;box-sizing:border-box;border-radius:50%;border:2px solid rgba(45,212,160,.35);border-top-color:#2dd4a0;display:inline-block;flex:none;animation:jobyougo-run-spin .7s linear infinite;';
  } else {
    mark.style.cssText = `all:initial;width:8px;height:8px;border-radius:50%;background:${tone};display:inline-block;flex:none;`;
  }
  const label = document.createElement('span');
  label.textContent = state.text;
  label.style.cssText = 'all:initial;font:inherit;color:#f2f5f3;';
  host.append(mark, label);
  document.documentElement.appendChild(host);
}

async function paintRunBadge(tabId, status, { force = false } = {}) {
  const id = Number(tabId);
  if (!id) return;
  const next = status?.text
    ? { phase: status.phase || 'run', text: String(status.text).slice(0, 160) }
    : null;
  const prev = runBadges.get(id);
  if (!force && prev && next && prev.phase === next.phase && prev.text === next.text) return;
  if (next) runBadges.set(id, next);
  else runBadges.delete(id);
  const pending = runBadgeTimers.get(id);
  if (pending) {
    clearTimeout(pending);
    runBadgeTimers.delete(id);
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId: id }, func: drawRunBadge, args: [next] });
  } catch { /* closed tab, or a page the extension cannot script */ }
  tellPopups({ type: 'scan-apply-progress', tabId: id, phase: next?.phase || '', text: next?.text || '' });
  if (next && next.phase !== 'run' && next.phase !== 'wait') {
    runBadgeTimers.set(id, setTimeout(() => {
      runBadgeTimers.delete(id);
      const cur = runBadges.get(id);
      if (cur && cur.text === next.text) paintRunBadge(id, null, { force: true });
    }, 8000));
  }
}

// The click happened on `tabId`. Read that page, then ask the dashboard to
// evaluate it and apply on the same tab. The dashboard is not focused: the
// offer tab stays the one the user is looking at.
async function runScanApplyOnTab(port, msg) {
  const tabId = msg?.tabId;
  const url = String(msg?.url || '');
  if (!tabId || !/^https?:\/\//i.test(url)) {
    tellPopup(port, { ok: false, error: 'Open a job offer, then click the button.' });
    return;
  }
  await paintRunBadge(tabId, { phase: 'run', text: 'Reading this offer…' });
  let page;
  try {
    page = await readOfferText(tabId);
  } catch (err) {
    await paintRunBadge(tabId, { phase: 'bad', text: 'This tab cannot be read.' });
    tellPopup(port, { ok: false, error: 'This tab cannot be read.' });
    return;
  }
  const text = String(page?.text || '');
  if (text.length < 400) {
    await paintRunBadge(tabId, { phase: 'bad', text: 'This tab does not have enough offer text to scan.' });
    tellPopup(port, { ok: false, error: 'This tab does not have enough offer text to scan.' });
    return;
  }
  let dashboards = await chrome.tabs.query({ url: DASHBOARD_URLS });
  if (!dashboards.length) {
    const opened = await chrome.tabs.create({ url: DASHBOARD_OPEN_URL, active: false });
    await waitForTabComplete(opened.id).catch(() => {});
    dashboards = await chrome.tabs.query({ url: DASHBOARD_URLS });
  }
  const request = {
    type: 'scan-apply-tab',
    tabId,
    url,
    title: msg.title || page.title || '',
    text,
  };
  for (let attempt = 0; attempt < 8; attempt++) {
    for (const dash of dashboards) {
      try {
        const ack = await chrome.tabs.sendMessage(dash.id, request);
        if (ack?.ok) {
          await paintRunBadge(tabId, { phase: 'run', text: 'Scanning this offer…' });
          tellPopup(port, { ok: true });
          return;
        }
      } catch { /* content script not in yet */ }
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  await paintRunBadge(tabId, { phase: 'bad', text: 'Open the JobYouGo dashboard in this Chrome, then try again.' });
  tellPopup(port, { ok: false, error: 'Open the JobYouGo dashboard in this Chrome, then try again.' });
}

async function openTab(url) {
  const windowId = await currentWindowId();
  const tab = await chrome.tabs.create(windowId ? { url, active: true, windowId } : { url, active: true });
  console.log('[jobyougo-bridge] tab created:', { requestedWindowId: windowId, tabId: tab.id, actualWindowId: tab.windowId });
  await waitForTabComplete(tab.id);
  await new Promise((r) => setTimeout(r, 1500));
  return chrome.tabs.get(tab.id);
}

async function navigateTab(tabId, url) {
  await chrome.tabs.update(tabId, { url, active: true });
  await waitForTabComplete(tabId);
  await new Promise((r) => setTimeout(r, 1500));
  return chrome.tabs.get(tabId);
}

async function collectFieldsInTab(tabId) {
  // allFrames: Greenhouse/Ashby forms often live in an iframe — main-frame-only
  // collection was why identity fields looked "missing" on real applies.
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ['collect-fields.js'],
  });
  const injected = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => {
      try {
        return typeof collectFields === 'function' ? collectFields() : [];
      } catch {
        return [];
      }
    },
  });
  const fields = [];
  for (const entry of injected) {
    const frameId = entry.frameId ?? 0;
    const list = Array.isArray(entry.result) ? entry.result : [];
    for (const f of list) {
      fields.push({ ...f, frameId });
    }
  }
  return fields;
}

async function detectFieldsInNewTab(url) {
  const tab = await openTab(url);
  const fields = await collectFieldsInTab(tab.id);
  return { tabId: tab.id, fields };
}

// Run a registered in-page helper and merge its per-frame results. Only names
// in PAGE_HELPERS exist: the bridge picks a helper, it never sends code (the
// old source-string path needed new Function, which this world forbids).
async function runPageHelper(tabId, name, args = []) {
  const spec = Object.hasOwn(PAGE_HELPERS, name) ? PAGE_HELPERS[name] : null;
  if (!spec) throw new Error(`unknown page helper "${name}"`);
  const injected = await chrome.scripting.executeScript({
    target: spec.frames === 'main' ? { tabId, frameIds: [0] } : { tabId, allFrames: true },
    func: spec.func,
    args: Array.isArray(args) ? args : [],
  });
  return mergeFrameResults(spec, injected);
}

// Mirrors lib/form-detect.mjs MARK_PROGRESSION_CONTROLS, then clicks the first
// match. Lives here so the service worker can click without round-tripping
// the mark source every time (server still sends reSrc/avoidSrc).
function markAndClickInPage(reSrc, skip, avoidSrc) {
  document.querySelectorAll('[data-co-click]').forEach((el) => el.removeAttribute('data-co-click'));
  const re = new RegExp(reSrc, 'i');
  const avoid = new RegExp(avoidSrc, 'i');
  const skipSet = new Set(skip || []);
  const deepQueryAll = (root, selector) => {
    const out = [];
    const visit = (node) => {
      if (!node?.querySelectorAll) return;
      out.push(...node.querySelectorAll(selector));
      for (const el of node.querySelectorAll('*')) {
        if (el.shadowRoot) visit(el.shadowRoot);
      }
    };
    visit(root);
    return out;
  };
  const isDisabled = (el) => {
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return true;
    if (el.closest('[disabled], [aria-disabled="true"], [inert]')) return true;
    const st = getComputedStyle(el);
    if (st.pointerEvents === 'none' || Number(st.opacity) === 0) return true;
    return false;
  };
  const labelOf = (el) => (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || '')
    .replace(/\s+/g, ' ').trim();

  const candidates = [];
  const consider = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 5 || r.height < 5) return;
    if (isDisabled(el)) return;
    const t = labelOf(el);
    if (!t || t.length > 80 || !re.test(t) || skipSet.has(t)) return;
    if (avoid.test(t)) return;
    // Prefer bottom-of-form primary CTAs (Next / Continue) over header duplicates.
    const score = r.bottom + (r.right / 20) + (r.width > 80 ? 30 : 0);
    candidates.push({ el, text: t, href: el.href || '', score, top: r.top });
  };

  for (const el of deepQueryAll(document, 'a, button, [role="button"], [role="tab"], input[type="submit"], input[type="button"]')) {
    consider(el);
  }
  // Custom hosts that expose the label on the host when the inner button is 0×0.
  if (!candidates.length) {
    for (const el of deepQueryAll(document, 'spl-button, oc-button, [class*="button" i]')) {
      consider(el);
    }
  }
  if (!candidates.length) return { clicked: false, marked: [] };

  candidates.sort((a, b) => b.score - a.score);
  const picked = candidates.slice(0, 8);
  const out = picked.map((c, n) => {
    c.el.setAttribute('data-co-click', String(n));
    return { n, text: c.text, href: c.href };
  });
  const first = picked[0].el;
  const href = first.href || '';
  const ownTarget = (first.target || first.getAttribute('target') || '').toLowerCase();
  const baseTarget = first.tagName === 'A'
    ? (document.querySelector('base[target]')?.getAttribute('target') || '').toLowerCase()
    : '';
  const target = ownTarget || baseTarget;
  // target=_blank is opened by the service worker (chrome.tabs.create). A
  // synthetic .click() is not a user gesture, so the popup is often blocked
  // and the bridge never sees the new tab.
  let sameDoc = false;
  try {
    sameDoc = !!href && new URL(href).href.split('#')[0] === location.href.split('#')[0];
  } catch { sameDoc = false; }
  if (/^https?:/i.test(href) && !sameDoc && (target === '_blank' || target === '_new')) {
    return { clicked: false, openHref: href, text: out[0].text, href, target, marked: out };
  }
  // Buttons that call window.open() hit the popup blocker. Capture the URL
  // and let the service worker open that one tab when the popup is blocked.
  // Only works in the page's MAIN world (see clickProgressionInTab).
  const origOpen = window.open;
  let captured = '';
  let popupBlocked = false;
  let patched = false;
  try {
    window.open = function (url, ...rest) {
      try {
        const abs = new URL(String(url || ''), location.href).href;
        const here = location.href.split('#')[0];
        if (/^https?:/i.test(abs) && abs.split('#')[0] !== here) captured = abs;
      } catch { /* ignore non-URLs */ }
      const win = origOpen.apply(this, [url, ...rest]);
      if (!win) popupBlocked = true;
      return win;
    };
    patched = window.open !== origOpen;
  } catch { /* page locked window.open — click without capture */ }
  try {
    try { first.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch { /* ignore */ }
    const base = { bubbles: true, cancelable: true, composed: true, view: window, button: 0, buttons: 1 };
    first.dispatchEvent(new PointerEvent('pointerdown', { ...base, pointerId: 1, pointerType: 'mouse' }));
    first.dispatchEvent(new MouseEvent('mousedown', base));
    first.dispatchEvent(new PointerEvent('pointerup', { ...base, pointerId: 1, pointerType: 'mouse' }));
    first.dispatchEvent(new MouseEvent('mouseup', base));
    first.click();
  } finally {
    if (patched) window.open = origOpen;
  }
  if (captured && popupBlocked) {
    return { clicked: false, openHref: captured, text: out[0].text, href: captured, target: 'window.open', marked: out };
  }
  return { clicked: true, text: out[0].text, href: href || captured, target, marked: out };
}

function httpUrlOf(tab, fallback = '') {
  const url = tab?.url || '';
  const pending = tab?.pendingUrl || '';
  if (/^https?:\/\//i.test(url)) return url;
  if (/^https?:\/\//i.test(pending)) return pending;
  if (/^https?:\/\//i.test(fallback)) return fallback;
  return url || pending || fallback || '';
}

async function waitForHttpTab(tabId, timeoutMs = 12000) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    try {
      last = await chrome.tabs.get(tabId);
    } catch {
      return last;
    }
    const url = last.url || '';
    if (/^https?:\/\//i.test(url) && last.status === 'complete') return last;
    await new Promise((r) => setTimeout(r, 200));
  }
  return last;
}

function beginChildTabWatch(openerTabId) {
  let child = null;
  const onCreated = (tab) => {
    if (tab.openerTabId === openerTabId) child = tab;
  };
  chrome.tabs.onCreated.addListener(onCreated);
  return {
    stop() { chrome.tabs.onCreated.removeListener(onCreated); },
    async take(timeoutMs = 1200) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (child) {
          this.stop();
          return await waitForHttpTab(child.id, 12000) || child;
        }
        await new Promise((r) => setTimeout(r, 150));
      }
      this.stop();
      return null;
    },
  };
}

async function openHrefInNewTab(openerTabId, url) {
  let windowId;
  try { windowId = (await chrome.tabs.get(openerTabId)).windowId; } catch { windowId = await currentWindowId(); }
  const tab = await chrome.tabs.create({
    url,
    active: true,
    openerTabId,
    ...(windowId ? { windowId } : {}),
  });
  return await waitForHttpTab(tab.id, 15000) || tab;
}

async function clickProgressionInTab(tabId, reSrc, avoidSrc, skip, { scrollFirst = true } = {}) {
  let windowId;
  try { windowId = (await chrome.tabs.get(tabId)).windowId; } catch { windowId = await currentWindowId(); }

  const adoptIfOpenerGone = async (result) => {
    if (!result?.clicked) return result;
    try {
      await chrome.tabs.get(tabId);
      return result;
    } catch {
      // The opener is gone. Do not grab whichever tab is focused — return the
      // HTTP tabs in this window so the bridge can match domain, URL, job id
      // and form before adopting one.
      const adoptCandidates = (await listHttpTabs(windowId)).filter((t) => t.tabId !== tabId);
      return { ...result, openerGone: true, adoptCandidates };
    }
  };

  const tryClick = async () => {
    const watch = beginChildTabWatch(tabId);
    let result;
    try {
      // MAIN world: the window.open capture in markAndClickInPage must wrap
      // the page's own window.open. An isolated-world override is invisible
      // to page scripts, so JustJoin.it's Apply (window.open → eRecruiter)
      // was popup-blocked with nothing captured and the run stalled.
      const [{ result: pageResult }] = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: markAndClickInPage,
        args: [reSrc, skip, avoidSrc],
      });
      result = pageResult;
    } catch (err) {
      watch.stop();
      // Opener already closed during inject — try adopt active tab.
      try {
        await chrome.tabs.get(tabId);
      } catch {
        return adoptIfOpenerGone({ clicked: true, text: 'Apply', href: '' });
      }
      throw err;
    }
    if (result?.openHref) {
      watch.stop();
      const opened = await openHrefInNewTab(tabId, result.openHref);
      return {
        clicked: true,
        text: result.text,
        href: result.openHref,
        openedTabId: opened.id,
        openedUrl: httpUrlOf(opened, result.openHref),
        marked: result.marked || [],
      };
    }
    if (result?.clicked) {
      const child = await watch.take(2500);
      if (child && child.id !== tabId) {
        return {
          ...result,
          openedTabId: child.id,
          openedUrl: httpUrlOf(child, result.href || ''),
        };
      }
      watch.stop();
      return adoptIfOpenerGone(result);
    }
    watch.stop();
    return result;
  };

  let result = null;
  if (!scrollFirst) {
    result = await tryClick();
    if (result?.clicked) {
      if (result.openedTabId) return result;
      await new Promise((r) => setTimeout(r, 1500));
      return adoptIfOpenerGone(result);
    }
  }

  // Scroll only when needed (form already mid-screen must not be shoved away).
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => window.scrollBy(0, 650),
    });
    await new Promise((r) => setTimeout(r, 700));
  } catch {
    return adoptIfOpenerGone({ clicked: true, text: 'Apply', href: '' });
  }
  result = await tryClick();
  if (!result?.clicked) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => window.scrollBy(0, -400),
      });
      await new Promise((r) => setTimeout(r, 500));
      result = await tryClick();
    } catch {
      return adoptIfOpenerGone({ clicked: true, text: 'Apply', href: '' });
    }
  }
  if (result?.openedTabId) return result;
  if (result?.clicked) {
    await new Promise((r) => setTimeout(r, 1500));
    try { await waitForTabComplete(tabId, 8000); } catch { /* spa or tab gone */ }
    return adoptIfOpenerGone(result);
  }
  return result || { clicked: false, marked: [] };
}

// ── Submit: stricter than click-progression ─────────────────────────────────
// Mirrors apply-runner.mjs's clickSubmit(): includes <input type="submit"> /
// <input type="button"> (markAndClickInPage's `a, button, [role="button"]`
// query never finds these — common on legacy/non-React ATS forms), excludes
// disabled controls, excludes a leftover sticky "Apply for this job" header
// button that also matches loose submit wording, and prefers strong wording
// (Submit/Send/Envoyer/Valider) over a bare anchored-regex match when several
// candidates are on screen.
//
// Split into a mark-only finder + a separate clicker (rather than one
// function that both finds and clicks) because the search itself runs with
// allFrames:true — Greenhouse/Ashby/Lever forms are routinely embedded in a
// cross-origin iframe, same as the CV upload input — and clicking in every
// frame that happens to contain SOME matching button (e.g. a "Send" chat
// widget in the main frame while the real submit lives in the iframe) would
// risk firing more than one control. The caller ranks candidates across all
// frames first and clicks in exactly one.
function markSubmitCandidateInPage(reSrc) {
  document.querySelectorAll('[data-co-submit]').forEach((el) => el.removeAttribute('data-co-submit'));
  const re = new RegExp(reSrc, 'i');
  const strong = /^(submit|send|envoyer|soumettre|valider|finish)\b/i;
  const deepQueryAll = (root, selector) => {
    const out = [];
    const visit = (node) => {
      if (!node?.querySelectorAll) return;
      out.push(...node.querySelectorAll(selector));
      for (const el of node.querySelectorAll('*')) {
        if (el.shadowRoot) visit(el.shadowRoot);
      }
    };
    visit(root);
    return out;
  };
  // Never a send: cookie / consent / settings / navigation / auth / chat
  // buttons. Kraken's "Submit Application" was disabled, and the last
  // type=submit on the page — the cookie banner's "Manage Cookie Settings" —
  // got clicked and reported as sent.
  const never = /cookie|consent|pr[ée]f[ée]rences?|preferences|settings|param[èe]tres|\bmanage\b|g[ée]rer|search|rechercher|filtr|log ?in|sign ?(in|up)|connexion|se connecter|register|inscription|\bmenu\b|close|fermer|cancel|annuler|\bback\b|retour|previous|pr[ée]c[ée]dent|clear|reset|skip|dismiss|share|partager|print|imprimer|download|t[ée]l[ée]charger|subscribe|newsletter|send (a )?message|envoyer un message|\bchat\b|\breply\b|r[ée]pondre|\bconnect\b|\bfollow\b|upload|attach|\badd\b|ajouter|remove|supprimer/i;
  const bannerSel = '[id*="cookie" i], [class*="cookie" i], [id*="consent" i], [class*="consent" i], [id*="gdpr" i], [class*="gdpr" i], [id*="onetrust" i], [class*="onetrust" i], [id*="cybot" i], [class*="cc-window" i]';
  const txt = (el) => ((el.innerText || el.value || '')).replace(/\s+/g, ' ').trim();
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 5 && r.height > 5;
  };
  const enabled = (el) => !el.disabled && el.getAttribute('aria-disabled') !== 'true';
  const candidates = deepQueryAll(document, 'button, input[type="submit"], input[type="button"], [role="button"]')
    .filter(visible)
    .filter((el) => !/apply for this (job|position|role)/i.test(txt(el)))
    .filter((el) => !never.test(txt(el)));
  const isSubmitType = (el) => (el.type || '').toLowerCase() === 'submit';
  // The form that holds the fields just filled: its own buttons come first,
  // and a cookie banner that happens to wrap it is not a banner to exclude.
  const fieldForm = deepQueryAll(document, '[data-co-i]').map((f) => f.closest?.('form')).find(Boolean) || null;
  const inBanner = (el) => {
    const banner = el.closest?.(bannerSel);
    return !!banner && !(fieldForm && banner.contains(fieldForm));
  };
  const inForm = (el) => !fieldForm || fieldForm.contains(el);
  const usable = candidates.filter((el) => !inBanner(el));
  const all = usable.filter(enabled);
  // The real send is on the page but disabled: the form still misses
  // something, and no other button stands in for it — not even a "Send"
  // outside the form (a chat widget's).
  const strongInForm = all.find((el) => strong.test(txt(el)) && inForm(el));
  let strongEnabled = strongInForm;
  if (!strongInForm) {
    const disabled = usable.find((el) => !enabled(el) && inForm(el) && (strong.test(txt(el)) || re.test(txt(el))))
      || (!fieldForm ? usable.find((el) => !enabled(el) && strong.test(txt(el))) : null);
    if (disabled) return { tier: -1, disabled: true, text: txt(disabled).slice(0, 60) || 'submit' };
    strongEnabled = all.find((el) => strong.test(txt(el)));
  }
  const submitTyped = [...all].reverse().filter(isSubmitType);
  const target = strongEnabled
    // Any <button> inside a form is type=submit by default: a tag chip
    // ("Industrial Design") was clicked as the send. Blank or send-like only.
    || (fieldForm ? submitTyped.find((el) => fieldForm.contains(el) && (!txt(el) || re.test(txt(el)))) : null)
    || submitTyped.find((el) => inForm(el) && (!txt(el) || re.test(txt(el))))
    || all.find((el) => inForm(el) && re.test(txt(el)))
    || all.find((el) => re.test(txt(el)));
  if (!target) return null;
  const tier = strong.test(txt(target)) ? 2 : (isSubmitType(target) ? 1 : 0);
  target.setAttribute('data-co-submit', '1');
  return { tier, text: txt(target).slice(0, 60) || 'submit' };
}

function clickMarkedSubmitInPage() {
  const deepQuery = (sel) => {
    const visit = (node) => {
      if (!node?.querySelectorAll) return null;
      const hit = node.querySelector(sel);
      if (hit) return hit;
      for (const el of node.querySelectorAll('*')) {
        if (el.shadowRoot) {
          const nested = visit(el.shadowRoot);
          if (nested) return nested;
        }
      }
      return null;
    };
    return visit(document);
  };
  const el = deepQuery('[data-co-submit="1"]') || document.querySelector('[data-co-submit="1"]');
  if (!el) return false;
  el.click();
  return true;
}

// A successful .click() proves nothing about whether the ATS accepted the
// data — apply-runner.mjs verifies this on the Playwright side
// (detectSubmitRejection); the extension path had no equivalent, so a
// submit that bounced back with validation errors was still reported to the
// dashboard as "Candidature envoyée" with no way for the user to notice.
function detectSubmitRejectionInPage() {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const st = getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none';
  };
  const errRe = /required|invalid|please|select|complete|must |enter |provide |champ|obligatoire|manquant|requis|veuillez|compl[ée]t|remplir|saisir|s[ée]lectionn|invalide/i;
  const textErrs = [...document.querySelectorAll(
    '.error, .field-error, [class*="error" i], [class*="invalid" i], [role="alert"], [aria-live="assertive"]',
  )].filter((el) => visible(el) && errRe.test((el.innerText || '').trim()));
  const invalidFields = [...document.querySelectorAll('[aria-invalid="true"]')].filter(visible);
  const bodyText = (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 6000);
  const bannerRe = /needs? correction|missing entry for required field|please correct|fix the (errors?|following)|corrigez|champs? (obligatoires?|requis) manquants?/i;
  const banner = bodyText.match(bannerRe);
  const errorCount = textErrs.length + invalidFields.length + (banner ? 1 : 0);
  const files = [...document.querySelectorAll('input[type="file"]')];
  const otherFillable = [...document.querySelectorAll('textarea, select, [role="combobox"]')];
  // A form made of text boxes only (name, e-mail, phone) is still a form:
  // the fields this run filled (data-co-i) are still on screen. A
  // confirmation page's newsletter or search boxes are not.
  const filledStill = [...document.querySelectorAll('[data-co-i]')].filter(visible);
  const stillForm = files.length > 0 || otherFillable.some(visible) || filledStill.length >= 2;
  const confirmed = /thank you for (applying|your application|your interest)|application (has been |was )?(submitted|received|sent|complete)|successfully (submitted|applied|sent)|we('ve| have) received your application|candidature (envoy[ée]e|re[çc]ue|transmise|enregistr[ée]e)|merci (pour|de) (votre|ta) candidature|gracias por (tu|su) (candidatura|solicitud)|vielen dank f[üu]r (ihre|deine) bewerbung|grazie per (la tua|la sua) candidatura/i.test(bodyText);
  let sample = (textErrs[0]?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!sample && banner) sample = bodyText.slice(banner.index, banner.index + 120).trim();
  return { errorCount, stillForm, confirmed, sample };
}

// The control the bridge chose (SUBMIT_CANDIDATES stamps data-co-sc). Null
// when it left the page or became disabled since the listing.
function clickStampedSubmitInPage(n) {
  const visit = (node) => {
    if (!node?.querySelector) return null;
    const hit = node.querySelector(`[data-co-sc="${n}"]`);
    if (hit) return hit;
    for (const el of node.querySelectorAll('*')) {
      if (el.shadowRoot) {
        const nested = visit(el.shadowRoot);
        if (nested) return nested;
      }
    }
    return null;
  };
  const el = visit(document);
  if (!el) return null;
  const text = ((el.innerText || el.value || el.getAttribute('aria-label') || '')).replace(/\s+/g, ' ').trim().slice(0, 60) || 'submit';
  if (el.disabled || el.getAttribute('aria-disabled') === 'true') return { disabled: true, text };
  try { el.scrollIntoView({ block: 'center' }); } catch { /* detached */ }
  el.click();
  return { clicked: true, text };
}

async function clickSubmitInTab(tabId, reSrc, pick = null) {
  let best = null;
  const urlBefore = (await chrome.tabs.get(tabId).catch(() => null))?.url || '';
  if (pick && Number.isInteger(pick.n)) {
    const [entry] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [pick.frameId ?? 0] },
      func: clickStampedSubmitInPage,
      args: [pick.n],
    }).catch(() => [null]);
    const r = entry?.result;
    if (!r) return { clicked: false, lost: true };
    if (r.disabled) return { clicked: false, disabled: true, text: r.text };
    best = { tier: 2, text: r.text, frameId: pick.frameId ?? 0 };
  } else {
    const injected = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: markSubmitCandidateInPage,
      args: [reSrc],
    });
    for (const entry of injected) {
      const r = entry.result;
      if (r && (!best || r.tier > best.tier)) best = { ...r, frameId: entry.frameId };
    }
    if (!best) return { clicked: false };
    // Only a disabled send button was found: nothing to click yet.
    if (best.tier < 0) return { clicked: false, disabled: true, text: best.text };
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [best.frameId] },
      func: clickMarkedSubmitInPage,
    });
  }

  // Slow validation (Workday, Ashby) shows its errors seconds after the
  // click: keep reading while the form is still there and nothing says
  // either way, up to ~8 s.
  const readRejection = async () => {
    let rejection = { errorCount: 0, stillForm: false, confirmed: false, sample: '' };
    try {
      const rejInjected = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: detectSubmitRejectionInPage,
      });
      // Aggregate across frames: whichever frame the click landed in, error
      // banners or a still-present form could show up in the main frame, the
      // iframe, or both.
      for (const entry of rejInjected) {
        const r = entry.result;
        if (!r) continue;
        rejection = {
          errorCount: rejection.errorCount + (r.errorCount || 0),
          stillForm: rejection.stillForm || r.stillForm,
          confirmed: rejection.confirmed || !!r.confirmed,
          sample: rejection.sample || r.sample,
        };
      }
    } catch {
      // Page likely navigated to a confirmation page mid-evaluate — no form
      // left to reject anything, which is the good outcome.
    }
    return rejection;
  };
  await new Promise((r) => setTimeout(r, 1800));
  let rejection = await readRejection();
  let urlChanged = ((await chrome.tabs.get(tabId).catch(() => null))?.url || '') !== urlBefore;
  for (let k = 0; k < 4 && rejection.stillForm && !rejection.errorCount && !rejection.confirmed && !urlChanged; k++) {
    await new Promise((r) => setTimeout(r, 1500));
    rejection = await readRejection();
    urlChanged = ((await chrome.tabs.get(tabId).catch(() => null))?.url || '') !== urlBefore;
  }
  return {
    clicked: true,
    text: best.text,
    tier: best.tier,
    stillForm: rejection.stillForm,
    confirmed: rejection.confirmed,
    urlChanged,
    rejected: rejection.stillForm && rejection.errorCount > 0,
    errorCount: rejection.errorCount,
    sample: rejection.sample,
  };
}

async function dismissCookiesInTab(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const re = /^(accept( all)?( cookies)?|i (agree|accept)|tout accepter|accepter( tout)?|allow all|got it|ok|j'accepte)$/i;
      for (const el of document.querySelectorAll('button, a')) {
        const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
        if (!t || t.length > 40 || !re.test(t)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 5 || r.height < 5) continue;
        el.click();
        return t;
      }
      return null;
    },
  });
  if (result) await new Promise((r) => setTimeout(r, 600));
  return result;
}

async function fillFieldsInPage(updates) {
  const inputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  const textareaSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;

  const deepQuery = (selector) => {
    const visit = (node) => {
      if (!node?.querySelectorAll) return null;
      const hit = node.querySelector(selector);
      if (hit) return hit;
      for (const el of node.querySelectorAll('*')) {
        if (el.shadowRoot) {
          const nested = visit(el.shadowRoot);
          if (nested) return nested;
        }
      }
      return null;
    };
    return visit(document);
  };

  // Custom dropdowns (react-select, Ashby, SmartRecruiters, Google Places…).
  // The real value lands only when the widget's own option click fires —
  // typing into the filter input is not enough. Mirrors apply-runner's
  // COMBOBOX_OPTION_QUERY + open→match→click (inlined: executeScript cannot
  // close over sibling module functions).
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const normText = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  // One option, whatever its case, accents, numbering ("3. Practitioner: …")
  // or end punctuation.
  const canonText = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/[‘’]/g, "'").replace(/[“”«»]/g, '"').replace(/[–—]/g, '-')
    .replace(/^\s*(\(?\d{1,2}[.)]|[a-h][.)])\s+/, '').replace(/[.;:!?]+$/, '').replace(/\s+/g, ' ').trim();
  // Rows that are not choices. "Aucune restriction", "Recherche et
  // développement" and "Loading dock operator" are: the busy words only
  // match a whole row.
  const PLACEHOLDER_OPT = /^(select\b|choose\b|--|please\b|s[ée]lectionn|selecci[oó]n|elij?[ae]\b|elige\b|w[äa]hlen|bitte\b|scegli|selezion|kies\b|selecteer|aucun(e)? (r[ée]sultat|option|choix)|(loading|searching|chargement|recherche)(\s*(\.\.\.|…))?$|recherche en cours|no options|no results|start typing|type to search)/i;
  const OPTION_SEL = [
    '[role="option"]',
    '[role="menuitem"]',
    '[role="menuitemradio"]',
    '[role="menuitemcheckbox"]',
    '[role="treeitem"]',
    '[id*="-option-"]',
    'li[id*="option"]',
    '[part="option"]',
    '[class*="select__option"]',
    '[class*="SelectOption"]',
    '[class*="Select-option"]',
    'li[class*="option"]',
    '[class*="-menu"] li',
    '[class*="menuList" i] > *',
    '[class*="menu-list" i] > *',
    '[class*="listbox" i] [class*="option" i]',
    '[class*="listbox__option" i]',
    '[role="listbox"] li',
    'ul[id*="listbox"] li',
    '[class*="-option" i]',
    '[class*="option-" i]',
    '[class*="menu-item" i]',
    '[class*="MuiMenuItem"]',
    '[class*="MuiAutocomplete-option"]',
    '[class*="ant-select-item-option"]',
    'mat-option',
    '.ng-option',
    '[cmdk-item]',
    '[data-radix-collection-item]',
    '[data-highlighted]',
    '[class*="dropdown-item" i]',
    '[class*="DropdownMenuItem" i]',
    '.select2-results__option',
    '[class*="select2-results__option"]',
    '.choices__item--choice',
    '[class*="choices__item"]',
    '.vs__dropdown-option',
    '[class*="vs__dropdown-option"]',
    '.el-select-dropdown__item',
    '[class*="el-select-dropdown__item"]',
    '[data-automation-id*="promptOption" i]',
    '[data-automation-id*="option" i]',
    '[data-automation-id$="Option"]',
    'spl-option',
    'oc-option',
    '[class*="spl-option" i]',
    '[class*="oneclick" i] [role="option"]',
    '[class*="v-list-item" i]',
    '.pac-item',
    '.dropdown-location',
    '[class*="dropdown-location"]',
  ].join(', ');

  const deepQueryAll = (root, sel) => {
    const out = [];
    const visit = (node) => {
      if (!node?.querySelectorAll) return;
      try { out.push(...node.querySelectorAll(sel)); } catch { /* invalid sel in shadow */ }
      for (const child of node.querySelectorAll('*')) {
        if (child.shadowRoot) visit(child.shadowRoot);
      }
    };
    visit(root);
    return out;
  };

  const pointerClick = (node) => {
    if (!node) return;
    const base = { bubbles: true, cancelable: true, composed: true, view: window, button: 0, buttons: 1 };
    try { node.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch { /* ignore */ }
    node.focus?.();
    node.dispatchEvent(new PointerEvent('pointerdown', { ...base, pointerId: 1, pointerType: 'mouse' }));
    node.dispatchEvent(new MouseEvent('mousedown', base));
    node.dispatchEvent(new PointerEvent('pointerup', { ...base, pointerId: 1, pointerType: 'mouse' }));
    node.dispatchEvent(new MouseEvent('mouseup', base));
    node.dispatchEvent(new MouseEvent('click', base));
  };

  const collectOptionNodes = (fieldEl, allowGlobal) => {
    let cands = deepQueryAll(document, OPTION_SEL).filter((n) => {
      const r = n.getBoundingClientRect();
      const label = normText(n.innerText || n.getAttribute?.('aria-label') || n.getAttribute?.('title'));
      return r.width > 0 && r.height > 0 && label;
    });
    cands = cands.filter((n) => !cands.some((o) => o !== n && n.contains(o)));
    const all = cands;
    if (fieldEl) {
      const ids = `${fieldEl.getAttribute('aria-controls') || ''} ${fieldEl.getAttribute('aria-owns') || ''}`
        .trim().split(/\s+/).filter(Boolean);
      const boxes = ids.map((id) => document.getElementById(id)).filter(Boolean);
      // A list that holds its own rows (Google Forms div[role=listbox]): only
      // those. Every closed Google list shows its chosen row, so a "Yes" from
      // the list above sat inside the ±420 px window and could be clicked.
      const selfList = (fieldEl.getAttribute('role') || '').toLowerCase() === 'listbox'
        && !!fieldEl.querySelector('[role="option"]');
      if (selfList) return cands.filter((n) => fieldEl.contains(n));
      const owned = boxes.length ? cands.filter((n) => boxes.some((b) => b.contains(n))) : [];
      const visibleBox = (b) => {
        const r = b.getBoundingClientRect();
        return r.width > 8 && r.height > 8;
      };
      const expanded = fieldEl.getAttribute('aria-expanded') === 'true';
      const portals = (expanded
        ? deepQueryAll(document, '[role="listbox"], [role="menu"], .pac-container')
        : deepQueryAll(document, '.pac-container')
      ).filter(visibleBox);
      const inPortal = portals.length ? cands.filter((n) => portals.some((b) => b.contains(n))) : [];
      if (owned.length) {
        cands = owned;
      } else if (inPortal.length) {
        cands = inPortal;
      } else {
        const r = fieldEl.getBoundingClientRect();
        // Symmetric above/below — menus flip upward near the bottom of the form.
        const near = cands.filter((n) => {
          const b = n.getBoundingClientRect();
          return b.top >= r.top - 420 && b.top <= r.bottom + 420
            && b.left < r.right + 80 && b.right > r.left - 80;
        });
        cands = near.length || !allowGlobal ? near : all;
      }
    }
    // Always-visible Yes/No toggles are not the open list of a Location
    // typeahead. Keep Yes/No rows that live inside a real listbox.
    const isForeignYesNo = (n) => {
      const host = n.closest?.('.ashby-application-form-input-yesno, [class*="yesno" i], [class*="YesNo"]');
      if (host) return !(fieldEl && host.contains(fieldEl));
      if (n.closest?.('[role="listbox"], [role="menu"], .pac-container')) return false;
      const role = (n.getAttribute?.('role') || '').toLowerCase();
      if (role === 'option' || role === 'menuitem' || role === 'menuitemradio') return false;
      const dataOpt = (n.getAttribute?.('data-option') || '').toLowerCase();
      const text = normText(n.innerText || n.getAttribute?.('aria-label') || n.getAttribute?.('title'));
      const binary = /^(yes|no|oui|non)$/i.test(text) || /^(yes|no|oui|non)$/.test(dataOpt);
      if (!binary) return false;
      return n.tagName === 'BUTTON' || role === 'radio' || role === 'checkbox' || n.hasAttribute?.('data-radix-collection-item');
    };
    return cands.filter((n) => !isForeignYesNo(n) && !PLACEHOLDER_OPT.test(normText(n.innerText || n.getAttribute?.('aria-label') || n.getAttribute?.('title'))));
  };

  const optionSnapshot = (fieldEl, allowGlobal) => {
    const real = collectOptionNodes(fieldEl, allowGlobal);
    const texts = real.map((n) => normText(n.innerText || n.getAttribute?.('aria-label') || n.getAttribute?.('title')).slice(0, 80));
    const top = real[0] ? Math.round(real[0].getBoundingClientRect().top) : 0;
    return { count: real.length, sig: `${texts.join('\0')}@${top}`, nodes: real };
  };

  const scoreOption = (node, want) => {
    const raw = normText(want);
    const wLow = raw.toLowerCase();
    const t = normText(node.innerText || node.getAttribute?.('aria-label') || node.getAttribute?.('title'));
    const low = t.toLowerCase();
    if (!t) return 0;
    if (low === wLow) return 100;
    const canon = canonText;
    if (canon(t) && canon(t) === canon(raw)) return 98;
    // Long rows (a whole sentence per option) are compared word for word:
    // the resolver hands the option's own text back, spacing, quotes or
    // numbering aside (Agoda's Deloitte statement never matched by equality).
    if (raw.length > 80) {
      const words = (s) => new Set(canon(s).split(/[^a-z0-9+]+/).filter((w) => w.length >= 3));
      const a = words(raw);
      const b = words(t);
      if (!a.size || !b.size) return 0;
      let shared = 0;
      for (const w of a) if (b.has(w)) shared++;
      return shared / Math.max(a.size, b.size) >= 0.85 ? 88 : 0;
    }
    // "Paris, France" against "Paris, Île-de-France, FRA": the same city, and
    // the right country (or none) — never "Paris, TX, USA".
    const wantParts = raw.split(',').map(canon).filter(Boolean);
    const optParts = canon(t).split(',').map((p) => p.trim()).filter(Boolean);
    if (wantParts.length === 2 && optParts.length >= 2 && optParts[0] === wantParts[0] && wantParts[0].length >= 3
        && !/^(yes|no|oui|non)$/.test(wantParts[0]) && wantParts[1].split(' ').length <= 3) {
      const ISO = {
        france: ['fr', 'fra'], thailand: ['th', 'tha'], germany: ['de', 'deu'], spain: ['es', 'esp'],
        'united kingdom': ['uk', 'gb', 'gbr'], 'united states': ['us', 'usa'], portugal: ['pt', 'prt'],
        italy: ['it', 'ita'], netherlands: ['nl', 'nld'], belgium: ['be', 'bel'], austria: ['at', 'aut'],
        switzerland: ['ch', 'che'], canada: ['ca', 'can'], ireland: ['ie', 'irl'], poland: ['pl', 'pol'],
      };
      const codes = [wantParts[1], ...(ISO[wantParts[1]] || [])];
      const rest = optParts.slice(1);
      if (rest.some((p) => codes.includes(p))) return 92;
      const known = Object.entries(ISO).flatMap(([name, c]) => [name, ...c]);
      if (rest.some((p) => known.includes(p))) return 0;
      return 72;
    }
    // (?![a-zà-ÿ]) rather than \b: "í" is no word character to \b, so "Sí"
    // never ended on a boundary.
    const yesHead = /^(yes|oui|y|yeah|true|s[ií]|ja|sim)(?![a-zà-ÿ])/i;
    const noHead = /^(no|non|n|false|nein|n[aã]o)(?![a-zà-ÿ])/i;
    const kind = /^(yes|oui|y|true|s[ií]|ja|sim)(?![a-zà-ÿ])/i.test(raw) && raw.length <= 80 ? 'yes'
      : /^(no|non|n|false|nein|n[aã]o)(?![a-zà-ÿ])/i.test(raw) && !/^non-?binary\b/i.test(raw) && !/^none\b/i.test(raw) && raw.length <= 80 ? 'no'
      : null;
    if (kind === 'yes' && yesHead.test(t) && !noHead.test(t)) return 90;
    if (kind === 'no' && noHead.test(t) && !/^non-?binary\b/i.test(t) && !/^none\b/i.test(t)) return 90;
    if (kind) return 0;
    const COUNTRY = {
      france: ['france', 'french republic', 'république française', 'republique francaise', 'fr'],
      thailand: ['thailand', 'thaïlande', 'thailande', 'th'],
      'united states': ['united states', 'usa', 'us', 'united states of america'],
      'united kingdom': ['united kingdom', 'uk', 'great britain', 'england'],
      germany: ['germany', 'deutschland', 'de'],
      singapore: ['singapore', 'sg'],
    };
    // Country-code rows ("Francia +33", "France (+33)"): the code decides,
    // the name only breaks a tie (United States +1 / Canada +1). A bare
    // "France" against such rows must hit a whole word — by substring it
    // landed on "Guayana Francesa +594".
    const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const DIAL_RE = /(^|[\s(])(\+\d{1,4})(?=[\s)]|$)/;
    const dialIn = (s) => (String(s || '').match(DIAL_RE) || [])[2] || '';
    const wantCode = dialIn(raw);
    const optCode = dialIn(t);
    // The code and its brackets go: "Canada (+1)" is the name "canada".
    const DIAL_STRIP_RE = /[\s(]*\+\d{1,4}(?=[\s)]|$)[\s)]*/g;
    if (wantCode && optCode) {
      if (wantCode !== optCode) return 0;
      const name = canon(raw.replace(DIAL_STRIP_RE, ' ')).trim();
      if (!name) return 92;
      return new RegExp(`(^|\\W)${escapeRe(name)}(\\W|$)`, 'i').test(canon(t)) ? 97 : 92;
    }
    if (wantCode) {
      const name = normText(raw.replace(DIAL_STRIP_RE, ' '));
      return name ? scoreOption(node, name) : 0;
    }
    // Month lists ("February", "Feb", "02", "2") answer by alias, as in lib —
    // only when a month NAME is on one side: "10" against "10+" is a count,
    // not October.
    const MONTHS = {
      january: ['jan', '01', '1'], february: ['feb', '02', '2'], march: ['mar', '03', '3'], april: ['apr', '04', '4'],
      may: ['05', '5'], june: ['jun', '06', '6'], july: ['jul', '07', '7'], august: ['aug', '08', '8'],
      september: ['sep', 'sept', '09', '9'], october: ['oct', '10'], november: ['nov', '11'], december: ['dec', '12'],
    };
    const monthOf = (s) => Object.keys(MONTHS).find((m) => s === m || MONTHS[m].includes(s)) || '';
    const wantMonth = monthOf(wLow);
    const optMonth = monthOf(low);
    if (wantMonth && optMonth && (/[a-z]/.test(wLow) || /[a-z]/.test(low))) return wantMonth === optMonth ? 96 : 0;
    if (wantMonth && /[a-z]/.test(wLow)) return 0;
    if (/^\d{1,2}$/.test(wLow) && /^\d{1,2}$/.test(low)) return Number(wLow) === Number(low) ? 96 : 0;
    if (optCode) {
      const optName = canon(t.replace(DIAL_STRIP_RE, ' ')).trim();
      const aliases = Object.values(COUNTRY).find((a) => a.includes(wLow)) || [wLow];
      for (const a of aliases) {
        if (optName === a) return 95;
        if (a.length < 4) continue;
        if (new RegExp(`(^|\\W)${escapeRe(a)}(\\W|$)`, 'i').test(low)) return 85;
      }
      return 0;
    }
    for (const aliases of Object.values(COUNTRY)) {
      if (!aliases.includes(wLow)) continue;
      for (const a of aliases) {
        if (low === a) return 85;
        if (a.length < 4) continue;
        const boundedAlias = new RegExp(`(^|\\W)${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\W|$)`, 'i');
        if (boundedAlias.test(low)) return 85;
      }
    }
    if (raw.length >= 2) {
      const bounded = new RegExp(`(^|\\W)${raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\W|$)`, 'i');
      if (bounded.test(t)) return raw.length >= 4 ? 70 : 55;
    }
    // Substring is a hint, never a pick (same 40 as lib): "Niger" took
    // "Nigeria" and "Oman" took "Romania" at 55.
    if (wLow.length >= 4 && (low.includes(wLow) || (low.length >= 4 && wLow.includes(low)))) return 40;
    return 0;
  };

  const pickBestOption = (nodes, want) => {
    let best = 0;
    let hit = null;
    for (const n of nodes) {
      const s = scoreOption(n, want);
      if (s > best) { best = s; hit = n; }
    }
    if (best >= 50) return hit;
    return null;
  };

  // What the widget shows as its value, and where it was read: a chip or a
  // shadow input is the widget's own word; the box's .value may just be
  // what we typed.
  const committedTextWithSource = (fieldEl) => {
    let node = fieldEl.parentElement;
    // Stay inside the field's own wrapper. Searched from the <form>, the
    // first hidden input belongs to some other control — a Radix checkbox's
    // bubble input reads "on" — and every eRecruiter pick was judged failed.
    for (let d = 0; d < 6 && node && node.tagName !== 'FORM'; d++, node = node.parentElement) {
      const shown = node.querySelector?.('[class*="singleValue" i], [class*="single-value" i]');
      if (shown) return { text: normText(shown.textContent), source: 'widget' };
      const shadow = node.querySelector?.('input[aria-hidden="true"]:not([type="checkbox"]):not([type="radio"])');
      if (shadow && String(shadow.value || '').trim()) return { text: normText(shadow.value), source: 'widget' };
    }
    if (fieldEl.tagName === 'BUTTON' || fieldEl.getAttribute('aria-haspopup')) {
      // <input type="button" aria-haspopup="listbox"> (Revolut) keeps the pick
      // in .value; native <button> pickers use innerText.
      return { text: normText(fieldEl.innerText || fieldEl.textContent || fieldEl.value || ''), source: 'widget' };
    }
    return { text: normText(fieldEl.value || ''), source: 'box' };
  };
  const committedText = (fieldEl) => committedTextWithSource(fieldEl).text;

  // A typed filter ("Ban") is not a selection of "Bangkok". The visible value
  // has to be the option, not a prefix still sitting in the box — and when
  // the query IS the option's text ("Remote" typed into a plain input), the
  // box's own value proves nothing: the list has to have gone.
  const selectionMatches = (fieldEl, pickedText, { typedQuery = '', optionNode = null } = {}) => {
    const want = normText(pickedText).toLowerCase();
    // Multi-select lists show each pick as a chip beside the input, not as one value.
    const valueBox = fieldEl.closest?.('[class*="value-container" i], [class*="valueContainer" i]');
    const chips = valueBox ? [...valueBox.querySelectorAll('[class*="multi-value" i], [class*="multiValue" i]')] : [];
    if (chips.length) return chips.some((c) => normText(c.textContent).toLowerCase() === want);
    const read = committedTextWithSource(fieldEl);
    const got = read.text.toLowerCase();
    if (!got || !want || PLACEHOLDER_OPT.test(got) || got === 'select...') return false;
    if (read.source === 'box' && typedQuery && got === normText(typedQuery).toLowerCase()) {
      const listGone = fieldEl.getAttribute('aria-expanded') !== 'true'
        && !(optionNode && optionNode.isConnected && optionNode.getBoundingClientRect().height > 0);
      if (!listGone) return false;
    }
    if (got === want) return true;
    if (want.startsWith(got) && got.length < want.length) return false;
    if (want.length >= 4 && got.includes(want)) return true;
    return false;
  };

  const typeIntoFilter = async (fieldEl, text) => {
    if (!text) return;
    const tag = fieldEl.tagName;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA' && !fieldEl.isContentEditable) return;
    // Revolut listboxes are <input type="button"> — they are not editable
    // filters. Clearing/typing here wiped the committed value and never
    // narrowed the menu.
    if (tag === 'INPUT' && (fieldEl.type || '').toLowerCase() === 'button') return;
    fieldEl.focus();
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      if (inputSetter && tag === 'INPUT') inputSetter.call(fieldEl, '');
      else if (textareaSetter && tag === 'TEXTAREA') textareaSetter.call(fieldEl, '');
      else fieldEl.value = '';
      fieldEl.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'deleteContentBackward' }));
    }
    // Character-by-character so react-select / typeahead filters update.
    for (const ch of String(text).slice(0, 48)) {
      if (tag === 'INPUT' && inputSetter) inputSetter.call(fieldEl, `${fieldEl.value || ''}${ch}`);
      else if (tag === 'TEXTAREA' && textareaSetter) textareaSetter.call(fieldEl, `${fieldEl.value || ''}${ch}`);
      else if (fieldEl.isContentEditable) fieldEl.textContent = `${fieldEl.textContent || ''}${ch}`;
      fieldEl.dispatchEvent(new InputEvent('input', {
        bubbles: true, cancelable: true, inputType: 'insertText', data: ch,
      }));
      fieldEl.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ch, code: `Key${ch.toUpperCase()}` }));
      fieldEl.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ch }));
      await sleep(35);
    }
  };

  const openCombobox = (fieldEl) => {
    let control = fieldEl.closest?.(
      '[class*="select__control"], [class*="Select-control"], [class*="control" i], [class*="select-shell"], spl-select, [class*="dropdown" i]',
    ) || fieldEl;
    // The wrapper must be the field's own. A shared section matched by
    // "control" / "dropdown" holds other fields, and its first chevron opened
    // a neighbour's list: Ashby's "Location (city)" read the English-level
    // rows and "Which country" the French-level ones.
    if (control !== fieldEl) {
      const others = [...(control.querySelectorAll?.('input:not([type="hidden"]), select, textarea, [role="combobox"], [role="listbox"], button[aria-haspopup]') || [])]
        .filter((n) => n !== fieldEl && !fieldEl.contains(n) && !n.contains(fieldEl)
          && n.getAttribute('aria-hidden') !== 'true' && !/^(checkbox|radio)$/i.test(n.type || ''));
      if (others.length) control = fieldEl;
    }
    const chevron = control.querySelector?.(
      '[class*="indicatorContainer" i], [class*="dropdown-indicator" i], [class*="arrow" i], [aria-haspopup="listbox"]',
    );
    pointerClick(chevron && chevron !== fieldEl ? chevron : control);
    if (control !== fieldEl) pointerClick(fieldEl);
    // Keyboard open for widgets that ignore synthetic mouse on the input.
    fieldEl.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown', code: 'ArrowDown' }));
    fieldEl.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'ArrowDown', code: 'ArrowDown' }));
  };

  const pressEscape = (fieldEl) => {
    fieldEl.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape', code: 'Escape' }));
    fieldEl.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Escape', code: 'Escape' }));
  };

  const filterQuery = (text) => {
    const s = normText(text);
    if (!s || /^(yes|oui|y|true|no|non|n|false)$/i.test(s)) return '';
    if (s.length <= 20) return s;
    const word = s.split(/\s+/).find((w) => w.length >= 3) || s.split(/\s+/)[0];
    return word.slice(0, 16);
  };

  // Empty the search box, then close the list the empty input may reopen
  // (react-select opens its menu on any input change).
  const clearFilter = (fieldEl) => {
    const tag = fieldEl.tagName;
    if (tag === 'INPUT' && (fieldEl.type || '').toLowerCase() === 'button') {
      pressEscape(fieldEl);
      return;
    }
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      if (tag === 'INPUT' && inputSetter) inputSetter.call(fieldEl, '');
      else if (tag === 'TEXTAREA' && textareaSetter) textareaSetter.call(fieldEl, '');
      else fieldEl.value = '';
      fieldEl.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'deleteContentBackward' }));
    } else if (fieldEl.isContentEditable) {
      fieldEl.textContent = '';
      fieldEl.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'deleteContentBackward' }));
    }
    pressEscape(fieldEl);
  };

  const labelOfNode = (n) => normText(n.innerText || n.getAttribute?.('aria-label') || n.getAttribute?.('title'));

  // Every option is on screen and the box does not scroll: typing to filter
  // cannot reveal anything new.
  const listIsComplete = (nodes) => {
    if (!nodes.length || nodes.length > 15) return false;
    let node = nodes[0].parentElement;
    for (let d = 0; d < 6 && node && node !== document.body; d++, node = node.parentElement) {
      const st = getComputedStyle(node);
      if (/(auto|scroll)/.test(st.overflowY) && node.scrollHeight > node.clientHeight + 4) return false;
    }
    return true;
  };

  // Lists: open, click one of the widget's own options, check that it stuck.
  // Text goes into the search box only as `typeQuery` — the server sends one
  // for search lists (city, country, school, employer, dial code) — and not
  // when the open list already shows every option. The answer itself is never
  // typed ("Available upon request" in a Yes/No dropdown was the bug), and a
  // query that commits nothing is cleared again.
  const selectComboboxOption = async (el, want, {
    alternates = [], typeQuery = '', typeQueryAlt = '', prefer = null, rank = [], label = '', budgetMs = 9000, many = [], patient = false,
  } = {}) => {
    const wants = [want, ...alternates].map(normText).filter((x, k, all) => x && all.indexOf(x) === k);
    const out = { picked: null, listOpened: false, clicked: '', options: [], typed: false };
    let activeQuery = '';
    if (!wants.length && !prefer && !rank.length) return out;
    const deadline = Date.now() + budgetMs;
    // Yes/No is never typed ("No" filters down to "None").
    const binary = /^(yes|oui|y|true|s[ií]|ja|sim|no|non|n|false|nein|n[aã]o)(?![a-zà-ÿ])/i.test(wants[0] || '');

    // A place row the main answer rules out ("Paris, TX, USA" for "Paris,
    // France") is not picked through a looser alternate ("Paris") either:
    // async suggestions arrive in batches, and the first batch may hold only
    // the wrong Paris.
    const primaryPlace = /,/.test(wants[0] || '');
    const vetoed = (n) => primaryPlace && /,/.test(labelOfNode(n)) && scoreOption(n, wants[0]) === 0;
    const matchIn = (nodes) => {
      for (const [k, q] of wants.entries()) {
        const hit = pickBestOption(k === 0 ? nodes : nodes.filter((n) => !vetoed(n)), q);
        if (hit) return hit;
      }
      for (const re of rank) {
        const hit = nodes.find((n) => re.test(labelOfNode(n)));
        if (hit) return hit;
      }
      return prefer ? nodes.find((n) => prefer.test(labelOfNode(n))) || null : null;
    };
    const yesNoOnly = (nodes) => {
      const texts = nodes.map(labelOfNode).filter(Boolean);
      if (texts.length < 2 || texts.length > 4) return false;
      let yes = false;
      let no = false;
      for (const t of texts) {
        if (/^(yes|oui|s[ií]|ja|sim)(?![a-zà-ÿ])/i.test(t)) yes = true;
        else if (/^(no|non|nein|n[aã]o)(?![a-zà-ÿ])/i.test(t) && !/^non-?binary/i.test(t) && !/^none\b/i.test(t)) no = true;
        else return false;
      }
      return yes && no;
    };

    // Checkbox-style rows (menuitemcheckbox) say themselves whether they are
    // ticked. aria-selected is not used: some libraries set it on the row
    // under the pointer.
    const ticked = (node) => node.isConnected && node.getAttribute('aria-checked') === 'true';

    const clickAndCheck = async (node) => {
      const label = labelOfNode(node);
      out.clicked = label;
      // Already ticked in a multi-choice menu: a click would untick it.
      if (ticked(node)) return label;
      document.querySelectorAll('[data-co-match]').forEach((e) => e.removeAttribute('data-co-match'));
      node.setAttribute('data-co-match', '1');
      pointerClick(node);
      // React commits the pick after the click handler returns.
      for (let k = 0; k < 4; k++) {
        await sleep(k ? 150 : 220);
        if (ticked(node) || selectionMatches(el, label, { typedQuery: out.typed ? activeQuery : '', optionNode: node })) return label;
      }
      return null;
    };

    const waitOptions = async (beforeSig) => {
      for (let k = 0; k < 8; k++) {
        await sleep(90);
        const snap = optionSnapshot(el, true);
        if (snap.count > 0 && (snap.sig !== beforeSig || el.getAttribute('aria-expanded') === 'true')) return snap;
      }
      return null;
    };

    // 1) Open the list and look for the answer among its options. A list
    // already open is read as is: clicking a toggle trigger would shut it.
    let shown = null;
    if (el.getAttribute('aria-expanded') === 'true') {
      const snap = optionSnapshot(el, true);
      if (snap.count > 0) shown = snap;
    }
    for (let attempt = 0; attempt < 2 && !shown && Date.now() < deadline; attempt++) {
      if (attempt) {
        pressEscape(el);
        await sleep(160);
      }
      const before = optionSnapshot(el, true);
      openCombobox(el);
      shown = await waitOptions(before.sig);
    }
    if (shown) {
      out.listOpened = true;
      out.options = [...new Set(shown.nodes.map(labelOfNode).filter(Boolean))].slice(0, 40);
    }

    const WORK_POLICY = /travel frequently|move to (hamburg|berlin|munich|vienna|london)|only want to work remote|remote only|hamburg office/i;
    const REMOTE_ONLY = /only want to work remote|remote only|fully remote|i only want to work remote/i;
    const workPolicyNodes = (nodes) => (nodes || []).filter((n) => WORK_POLICY.test(labelOfNode(n)));
    const remoteNodeOf = (nodes) => (nodes || []).find((n) => REMOTE_ONLY.test(labelOfNode(n)));

    // Multi-select: tick every chosen option, reopening if a pick closed it.
    if (shown && many.length) {
      const picked = [];
      for (const target of many) {
        if (Date.now() >= deadline) break;
        let nodes = optionSnapshot(el, true).nodes;
        if (!nodes.length) {
          openCombobox(el);
          nodes = (await waitOptions(''))?.nodes || [];
          if (!nodes.length) break;
        }
        const node = pickBestOption(nodes, target);
        if (!node) continue;
        const got = await clickAndCheck(node);
        if (got) picked.push(got);
      }
      pressEscape(el);
      await sleep(120);
      if (picked.length) out.picked = picked.join(', ');
      return out;
    }

    // A Location control whose real list is Yes | No is not a city search.
    // "Paris, France" matches nothing there and the field stays empty.
    if (shown && yesNoOnly(shown.nodes) && !binary
        && /\blocation\b|\bcity\b|\bville\b|\bbased in\b|\blocated\b/i.test(label)
        && !/relocat|hear|sponsor|visa|travel/i.test(label)) {
      const yesNode = shown.nodes.find((n) => /^(yes|oui)\b/i.test(labelOfNode(n)));
      if (yesNode) {
        const got = await clickAndCheck(yesNode);
        if (got) {
          out.picked = got;
          return out;
        }
      }
    }

    if (shown) {
      const hit = matchIn(shown.nodes) || (workPolicyNodes(shown.nodes).length ? remoteNodeOf(shown.nodes) : null);
      if (hit) {
        const got = await clickAndCheck(hit);
        if (got) {
          out.picked = got;
          return out;
        }
      }
    }

    // 2) Search lists: type the query, pick among the results. A second
    // query (dial lists: the code, then the country name) runs only when the
    // first one showed nothing usable.
    const typable = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
    // Pickers whose search box lives inside the open list (intl-tel-input,
    // select2, Keka): the box is the input the widget focused, or an input
    // next to the rows. Never another form field, never the page's search bar.
    const listSearchBox = () => {
      const isText = (n) => !!n && n !== el && n.tagName === 'INPUT'
        && !/^(hidden|checkbox|radio|button|submit|file|number|tel|email|password)$/i.test(n.type || '')
        && !n.disabled && !n.hasAttribute('data-co-i')
        && n.getBoundingClientRect().width > 0 && n.getBoundingClientRect().height > 0;
      // No open list, no search box: the focused input would be the page's own.
      const nodes = optionSnapshot(el, true).nodes;
      if (!nodes.length) return null;
      const active = document.activeElement;
      if (isText(active)) return active;
      const host = nodes[0].closest?.('[role="listbox"], [role="menu"], [role="dialog"], [class*="dropdown" i], [class*="menu" i], [class*="popover" i], [class*="select" i], [class*="iti" i]');
      const listTop = nodes[0].getBoundingClientRect().top;
      for (let d = 0, box = host; d < 3 && box && box !== document.body; d++, box = box.parentElement) {
        const inp = box.querySelector?.('input[type="search"], input[type="text"], input:not([type])');
        if (isText(inp) && Math.abs(inp.getBoundingClientRect().top - listTop) < 320) return inp;
      }
      return null;
    };
    const queries = [typeQuery, typeQueryAlt].map((q) => normText(q).slice(0, 40))
      .filter((q, k, all) => q.length >= 2 && all.indexOf(q) === k);
    for (const query of queries) {
      if (out.clicked || binary || Date.now() >= deadline) break;
      if (shown && listIsComplete(shown.nodes)) break;
      const box = typable ? el : listSearchBox();
      if (!box) break;
      if (out.typed) {
        clearFilter(out.typedBox || box);
        await sleep(160);
      }
      await typeIntoFilter(box, query);
      out.typed = true;
      out.typedBox = box;
      activeQuery = query;
      // Async lists (Greenhouse location) answer after a network round trip:
      // wait for results, stop once they hold still (not before the search
      // had time to replace what was on screen).
      let hit = null;
      let lastSig = '';
      const typedAt = Date.now();
      // Place searches (Lever, Google Places) answer after a geocoding call:
      // the OLX run gave up on "Paris" while its suggestions were still coming.
      const slow = patient || el.classList?.contains('location-input');
      const until = Math.min(deadline, typedAt + (slow ? 6500 : 3200));
      while (Date.now() < until) {
        await sleep(160);
        const snap = optionSnapshot(el, true);
        if (!snap.count) continue;
        out.listOpened = true;
        out.options = [...new Set(snap.nodes.map(labelOfNode).filter(Boolean))].slice(0, 40);
        hit = matchIn(snap.nodes);
        // One row holding the query is the answer — unless it is a place
        // every want scores 0 on ("Paris, TX, USA" for "Paris, France").
        if (!hit && snap.nodes.length === 1 && labelOfNode(snap.nodes[0]).toLowerCase().includes(query.toLowerCase())) {
          const lone = snap.nodes[0];
          const foreignPlace = /,/.test(labelOfNode(lone)) && wants.length && wants.every((w) => scoreOption(lone, w) === 0);
          if (!foreignPlace) hit = lone;
        }
        if (hit || (snap.sig === lastSig && Date.now() - typedAt > (slow ? 2200 : 900))) break;
        lastSig = snap.sig;
      }
      if (hit) {
        const got = await clickAndCheck(hit);
        if (got) {
          out.picked = got;
          return out;
        }
      }
    }

    // 3) Nothing committed: leave the box as it was found.
    if (out.typed) clearFilter(out.typedBox || el);
    else pressEscape(el);
    await sleep(120);
    return out;
  };

  const fire = (el, value) => {
    el.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertReplacementText',
      data: value,
    }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  };

  const setText = (el, value) => {
    const str = String(value ?? '');
    el.focus();
    if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
      el.textContent = str;
      fire(el, str);
      return (el.innerText || el.textContent || '').trim();
    }
    const setter = el.tagName === 'TEXTAREA' ? textareaSetter : inputSetter;
    if (setter && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
      setter.call(el, str);
    } else {
      el.value = str;
    }
    fire(el, str);
    return el.value;
  };

  // Chunked typing for long answers / textareas — beats instant paste on
  // ATS that ignore synthetic InputEvents without incremental input.
  const setTextHuman = async (el, value) => {
    const str = String(value ?? '');
    if (str.length < 24 && el.tagName !== 'TEXTAREA' && !el.isContentEditable) {
      return setText(el, str);
    }
    el.focus();
    if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
      el.textContent = '';
      for (let off = 0; off < str.length; off += 4) {
        el.textContent = str.slice(0, off + 4);
        el.dispatchEvent(new InputEvent('input', {
          bubbles: true, cancelable: true, inputType: 'insertText', data: str.slice(off, off + 4),
        }));
        await sleep(8 + Math.floor(Math.random() * 22));
      }
      fire(el, str);
      return (el.innerText || el.textContent || '').trim();
    }
    const setter = el.tagName === 'TEXTAREA' ? textareaSetter : inputSetter;
    if (setter && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) setter.call(el, '');
    else el.value = '';
    for (let off = 0; off < str.length; off += 3) {
      const next = str.slice(0, off + 3);
      if (setter && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) setter.call(el, next);
      else el.value = next;
      el.dispatchEvent(new InputEvent('input', {
        bubbles: true, cancelable: true, inputType: 'insertText', data: str.slice(off, off + 3),
      }));
      await sleep(10 + Math.floor(Math.random() * 25));
    }
    fire(el, str);
    return el.value;
  };

  const preferRe = (u) => {
    if (!u?.selectPrefer?.source) return null;
    try { return new RegExp(u.selectPrefer.source, u.selectPrefer.flags || 'i'); } catch { return null; }
  };
  const rankRes = (u) => (Array.isArray(u?.selectRank) ? u.selectRank : []).flatMap((r) => {
    if (!r?.source) return [];
    try { return [new RegExp(r.source, r.flags || 'i')]; } catch { return []; }
  });

  const resolvePreferWant = async (el, u) => {
    const re = preferRe(u);
    if (!re) return '';
    if (el.tagName === 'SELECT') {
      const hit = [...el.options].find((o) => re.test(o.text || ''));
      return hit ? String(hit.text || '') : '';
    }
    try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch { /* ignore */ }
    pointerClick(el);
    el.click?.();
    el.focus?.();
    await sleep(280);
    let cands = deepQueryAll(document, OPTION_SEL).filter((n) => {
      const r = n.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && normText(n.innerText || n.getAttribute?.('aria-label'));
    });
    cands = cands.filter((n) => !cands.some((o) => o !== n && n.contains(o)));
    const hit = cands.find((n) => re.test(normText(n.innerText || n.getAttribute?.('aria-label') || '')));
    // Close it again: the pick below opens the list itself, and a toggle
    // trigger clicked while open would shut it.
    pressEscape(el);
    await sleep(120);
    return hit ? normText(hit.innerText || hit.getAttribute?.('aria-label') || '') : '';
  };

  // Native <select>: the exact row, else a Yes/No by its head, else a whole
  // word. "No" by substring took "Yes, I will need sponsorship now".
  const pickOption = (options, want) => {
    const w = String(want || '').toLowerCase().trim();
    if (!w) return null;
    const exact = options.find((o) => (o.text || '').toLowerCase().trim() === w || (o.value || '').toLowerCase().trim() === w);
    if (exact) return exact;
    const kind = /^(yes|oui|y|true|s[ií]|ja|sim)$/.test(w) ? 'yes' : /^(no|non|n|false|nein|n[aã]o)$/.test(w) ? 'no' : null;
    if (kind === 'yes') return options.find((o) => /^(yes|oui|s[ií]|ja|sim)(?![a-zà-ÿ])/i.test((o.text || '').trim())) || null;
    if (kind === 'no') return options.find((o) => /^(no|non|nein|n[aã]o)(?![a-zà-ÿ])/i.test((o.text || '').trim()) && !/^non-?binary|^none\b/i.test((o.text || '').trim())) || null;
    const bounded = new RegExp(`(^|\\W)${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\W|$)`, 'i');
    return options.find((o) => bounded.test(o.text || '') || bounded.test(o.value || ''))
      || (w.length >= 4 ? options.find((o) => (o.text || '').toLowerCase().includes(w) || (o.value || '').toLowerCase().includes(w)) : null)
      || null;
  };

  const results = [];
  for (let ui = 0; ui < updates.length; ui++) {
    const u = updates[ui];
    if (ui > 0) await sleep(35 + Math.floor(Math.random() * 110));
    let { i, value, selectText } = u;
    const el = deepQuery(`[data-co-i="${i}"]`) || document.querySelector(`[data-co-i="${i}"]`);
    if (!el) {
      results.push({ i, frameId: u.frameId ?? 0, ok: false, reason: 'element not found (page re-rendered since detect?)' });
      continue;
    }
    // Read-only: open the list the way a pick does and return its options,
    // so the bridge can ask for an answer among the real texts.
    if (u.readOptions) {
      let options = [];
      if (el.tagName === 'SELECT') {
        options = [...el.options].map((o) => normText(o.text)).filter((t) => t && !PLACEHOLDER_OPT.test(t));
      } else {
        options = (await selectComboboxOption(el, '', { prefer: /(?!)/, budgetMs: 4000 })).options;
      }
      results.push({ i, frameId: u.frameId ?? 0, ok: false, readOnly: true, options: options.slice(0, 40) });
      continue;
    }
    // selectPrefer-only plans: resolve against live <select>/combobox options.
    if (!String(selectText || value || '').trim() && u.selectPrefer) {
      const resolved = await resolvePreferWant(el, u);
      if (!resolved) {
        results.push({ i, frameId: u.frameId ?? 0, ok: false, reason: 'no option matching selectPrefer' });
        continue;
      }
      selectText = resolved;
      value = resolved;
    }
    try {
      const tag = el.tagName;
      const type = (el.type || '').toLowerCase();
      const role = (el.getAttribute('role') || '').toLowerCase();
      const frameId = u.frameId ?? 0;

      if (type === 'checkbox' || role === 'checkbox' || role === 'switch'
          || type === 'radio' || role === 'radio') {
        // Unified Yes/No + radio path. Ashby uses a hidden checkbox + two
        // button[data-option]; collect reports type=radio but the live DOM
        // element is still checkbox — always try choice widgets first.
        const want = String(selectText || value || '').toLowerCase().trim();
        const findChoicePool = () => {
          let pool = deepQueryAll(document, `[data-co-opt^="${i}:"]`);
          if (pool.length >= 2) return pool;
          // The widget has to be the field's own: once an ancestor holds
          // another collected field, its buttons are a neighbour's question
          // (a consent checkbox clicked the previous question's "Yes"). The
          // ancestor is tested, not the buttons' box: Ashby keeps its hidden
          // checkbox next to the Yes/No box, not inside it.
          const holdsOtherField = (node) => [...(node.querySelectorAll?.('[data-co-i]') || [])]
            .some((n) => n !== el && !el.contains(n) && !n.contains(el));
          let node = el;
          for (let d = 0; d < 7 && node; d++, node = node.parentElement) {
            if (holdsOtherField(node)) break;
            const ashby = node.matches?.('.ashby-application-form-input-yesno, [class*="yesno" i], [class*="YesNo"]')
              ? node
              : node.querySelector?.('.ashby-application-form-input-yesno, [class*="yesno" i]');
            const scope = ashby || node;
            const btns = [...(scope.querySelectorAll?.('button[data-option], [data-option="yes"], [data-option="no"]') || [])];
            const yesNo = btns.filter((b) => /^(yes|no)$/i.test(b.getAttribute('data-option') || ''));
            if (yesNo.length >= 2) return yesNo;
            const roleRadios = [...(scope.querySelectorAll?.('[role="radio"]') || [])].filter((r) => {
              const r2 = r.getBoundingClientRect();
              return r2.width > 0 && r2.height > 0;
            });
            if (roleRadios.length >= 2 && roleRadios.length <= 6) return roleRadios;
          }
          if (el.name && (type === 'radio' || role === 'radio' || el.type === 'radio')) {
            const named = [...document.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`)];
            if (named.length >= 2) return named;
          }
          return pool;
        };
        const pool = findChoicePool();
        const isChoiceWidget = pool.length >= 2
          || el.closest?.('.ashby-application-form-input-yesno')
          || type === 'radio'
          || role === 'radio';
        if (isChoiceWidget && pool.length >= 1) {
          // A native radio's text lives in its <label> ("Yes"), its value is
          // often "true" / "1" / a UUID — without the label "no" never matched.
          const labelOf = (o) => (
            `${o.labels?.[0]?.innerText || ''} ${o.getAttribute?.('data-option') || ''} ${o.innerText || ''} ${o.getAttribute?.('aria-label') || ''} ${o.value || ''}`
          ).replace(/\s+/g, ' ').trim().toLowerCase();
          const textOf = (o) => normText(o.labels?.[0]?.innerText || o.innerText || o.getAttribute?.('aria-label')
            || o.getAttribute?.('data-option') || o.value || '');
          const wantYes = /^(yes|oui|y|true|1|s[ií]|ja|sim)$/i.test(want);
          const wantNo = /^(no|non|n|false|0|nein|n[aã]o)$/i.test(want);
          let hit = pool.find((o) => textOf(o).toLowerCase() === want || (o.value || '').toLowerCase() === want);
          // Same row under other casing, accents or numbering: Plancraft's
          // "3. Practitioner: …" radio was reported "not found".
          if (!hit && want.length > 3) {
            const target = canonText(want);
            hit = pool.find((o) => [textOf(o), o.closest?.('label')?.innerText, o.parentElement?.innerText]
              .some((t) => t && canonText(t) === target)) || null;
          }
          if (!hit && wantYes) {
            hit = pool.find((o) => /^(yes|oui|s[ií]|ja|sim)(?![a-zà-ÿ])/i.test(labelOf(o)) || o.getAttribute?.('data-option') === 'yes');
          }
          if (!hit && wantNo) {
            hit = pool.find((o) => (/^(no|non|nein|n[aã]o)(?![a-zà-ÿ])/i.test(labelOf(o)) && !/^non-?binary/i.test(labelOf(o)) && !/^none\b/i.test(labelOf(o)))
              || o.getAttribute?.('data-option') === 'no');
          }
          // Whole words only: "no" must not pick "Yes, I know".
          if (!hit && want.length >= 2) {
            const word = new RegExp(`(^|\\W)${want.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\W|$)`, 'i');
            hit = pool.find((o) => word.test(labelOf(o)));
          }
          // Option key from update payload (survives re-render better than text alone).
          if (!hit && Array.isArray(u.options)) {
            const opt = u.options.find((o) => {
              const t = String(o.text || o.value || '').toLowerCase();
              return t === want || (wantYes && /^(yes|oui)\b/.test(t)) || (wantNo && /^(no|non)\b/.test(t) && !/^non-?binary/.test(t));
            });
            if (opt?.key) hit = document.querySelector(`[data-co-opt="${opt.key}"]`) || deepQueryAll(document, `[data-co-opt="${opt.key}"]`)[0];
          }
          // "How did you hear" often has no row named exactly "LinkedIn" /
          // "Other". Ranked patterns pick a real source before we give up.
          if (!hit) {
            for (const re of rankRes(u)) {
              hit = pool.find((o) => re.test(labelOf(o)) || re.test(textOf(o)));
              if (hit) break;
            }
          }
          if (!hit) {
            const prefer = preferRe(u);
            if (prefer) hit = pool.find((o) => prefer.test(labelOf(o)) || prefer.test(textOf(o)));
          }
          if (hit) {
            const on = (node) => node?.getAttribute?.('aria-pressed') === 'true'
              || node?.getAttribute?.('aria-checked') === 'true'
              || !!node?.checked;
            const activate = (node) => {
              if (!node || on(node)) return;
              const forLabel = node.id ? document.querySelector(`label[for="${CSS.escape(node.id)}"]`) : null;
              const wrap = node.closest?.('label');
              const target = forLabel || wrap || node;
              pointerClick(target);
              if (target !== node) node.click?.();
            };
            if (!on(hit)) activate(hit);
            let stuck = pool.some(on) || on(hit);
            if (!stuck) {
              await sleep(180);
              stuck = pool.some(on) || on(hit);
            }
            // A click that did not stick used to be reported as filled. The
            // next scan then said "choix requis" on a still-empty radio.
            if (!stuck) {
              results.push({
                i,
                frameId,
                ok: false,
                reason: `radio option not found for "${textOf(hit) || want}"`,
                options: pool.map(textOf).filter(Boolean).slice(0, 40),
              });
              continue;
            }
            const chosen = pool.find(on) || hit;
            results.push({
              i,
              frameId,
              ok: true,
              actualValue: textOf(chosen) || want,
            });
            continue;
          }
          if (type === 'radio' || role === 'radio' || el.closest?.('.ashby-application-form-input-yesno')) {
            results.push({
              i,
              frameId,
              ok: false,
              reason: `radio option not found for "${want}"`,
              options: pool.map(textOf).filter(Boolean).slice(0, 40),
            });
            continue;
          }
        }
        // Plain checkbox (not Ashby Yes/No)
        if (type === 'checkbox' || role === 'checkbox' || role === 'switch') {
          const val = String(value || '').trim();
          const own = String(u.label || '').split(/[—–]/).pop().trim();
          const same = own.length > 2 && val.length > 2 && own.toLowerCase() === val.toLowerCase();
          const wantOn = /^(1|true|yes|oui|on|checked)$/i.test(val) || same;
          // A <button role="checkbox"> has no .checked: its state is aria-checked.
          const isOn = () => (el.tagName === 'INPUT' ? !!el.checked
            : el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-pressed') === 'true');
          if (isOn() !== wantOn) {
            el.click();
            await sleep(120);
          }
          const on = isOn();
          results.push({
            i,
            frameId,
            ok: wantOn ? on : true,
            actualValue: on ? 'checked' : 'unchecked',
            reason: wantOn && !on ? 'checkbox non cochée' : undefined,
          });
          continue;
        }
        results.push({ i, frameId, ok: false, reason: `radio option not found for "${want}"` });
        continue;
      }

      if (tag === 'SELECT') {
        let want = selectText || value;
        if (!want && u.selectPrefer) {
          const re = preferRe(u);
          const hit = re && [...el.options].find((o) => re.test(o.text || ''));
          if (hit) want = hit.text;
        }
        const opts = [...el.options].map((o) => ({ value: o.value, text: o.text }));
        const prefer = preferRe(u);
        const ranks = rankRes(u);
        let match = pickOption(opts, want)
          || (Array.isArray(u.alternates) ? u.alternates.map((a) => pickOption(opts, a)).find(Boolean) : null)
          || ranks.map((re) => opts.find((o) => re.test(o.text || ''))).find(Boolean)
          || (prefer ? opts.find((o) => prefer.test(o.text || '')) : null);
        if (!match) {
          const texts = opts.map((o) => normText(o.text)).filter((t) => t && !PLACEHOLDER_OPT.test(t));
          const yesNo = texts.length >= 2 && texts.length <= 4
            && texts.every((t) => /^(yes|oui|no|non)\b/i.test(t))
            && texts.some((t) => /^(yes|oui)\b/i.test(t))
            && texts.some((t) => /^(no|non)\b/i.test(t) && !/^non-?binary/i.test(t));
          const lab = String(u.label || '');
          if (yesNo && /\blocation\b|\bcity\b|\bville\b/i.test(lab) && !/relocat|hear|sponsor|visa|travel/i.test(lab)) {
            match = opts.find((o) => /^(yes|oui)\b/i.test(o.text || ''));
          }
          if (!match && texts.some((t) => /only want to work remote|travel frequently|move to hamburg/i.test(t))) {
            match = opts.find((o) => /only want to work remote|this doesn.?t work for me/i.test(o.text || ''));
          }
        }
        if (!match) {
          // Leave the select alone: assigning a value it does not offer only
          // blanks it (selectedIndex -1).
          results.push({
            i,
            frameId,
            ok: false,
            reason: `option introuvable pour « ${want || ''} »`,
            options: opts.map((o) => normText(o.text)).filter((t) => t && !PLACEHOLDER_OPT.test(t)).slice(0, 40),
          });
          continue;
        }
        const optEl = [...el.options].find((o) => o.value === match.value);
        if (optEl) optEl.selected = true;
        el.value = match.value;
        fire(el, el.value);
        // React-controlled <select> often ignores value= without input+change.
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        results.push({ i, frameId, ok: true, actualValue: el.options[el.selectedIndex]?.text || el.value });
        continue;
      }

      const selectWrapper = el.closest(
        '[class*="select__container"], [class*="select-shell"], [class*="Select-container" i], [class*="react-select" i], [class*="Select-control"], spl-select, oc-select, [class*="oneclick" i], [class*="ant-select"], [class*="el-select"], [class*="MuiSelect"], [class*="MuiAutocomplete"], .select2-container, [class*="choices" i], [data-automation-id*="select" i], [data-automation-id*="dropdown" i]',
      );
      const strongCombobox = (role === 'combobox' && (el.getAttribute('aria-haspopup') === 'listbox' || el.getAttribute('aria-expanded') != null))
        || role === 'combobox'
        || /react-select/.test(el.id || '')
        || !!selectWrapper
        || el.getAttribute('aria-haspopup') === 'listbox'
        || el.getAttribute('aria-haspopup') === 'menu'
        // Popover picker (eRecruiter): only collected when it is a labelled
        // form control, and its text becomes the choice once one is picked.
        || (tag === 'BUTTON' && el.getAttribute('aria-haspopup') === 'dialog')
        || (tag === 'BUTTON' && /select|choose|dropdown|country|location/i.test(el.getAttribute('aria-label') || el.innerText || ''));
      const ownBits = `${el.name || ''} ${el.id || ''} ${el.className || ''} ${el.getAttribute('autocomplete') || ''}`.toLowerCase();
      const placeSuggest = !!u.placeSuggest
        || el.classList?.contains('location-input')
        || /location-input|address-level/.test(ownBits)
        || (/(^|[^a-z])(location|city)([^a-z]|$)/.test(ownBits) && !/phone|tel/.test(ownBits));
      const looksCombobox = strongCombobox
        || placeSuggest
        || el.getAttribute('aria-autocomplete') === 'list'
        || el.getAttribute('aria-autocomplete') === 'both';
      if (looksCombobox) {
        const want = String(selectText || value || '');
        const phoneLike = (s) => {
          const digits = String(s || '').replace(/\D/g, '');
          return digits.length >= 8 && digits.length >= String(s || '').replace(/\s/g, '').length * 0.5;
        };
        // An older bridge sends no typeQuery: then only place / organisation
        // lists may be searched. A location box is searched with the city,
        // never with the phone number.
        let typeQuery = u.typeQuery !== undefined
          ? String(u.typeQuery || '')
          : (/\b(city|ville|country|pays|location|localisation|school|universit\w*|college|company|employer)\b/i.test(u.label || '') ? filterQuery(want) : '');
        // The city is derived from the answer only when the bridge sent no
        // query at all; an empty one means pick-only ("Yes", "Remote" were
        // typed into a location list).
        if (placeSuggest && u.typeQuery === undefined) {
          const city = String(want).split(',')[0].replace(/\(.*?\)/g, '').trim();
          typeQuery = phoneLike(city) ? '' : city;
        } else if (placeSuggest && typeQuery) {
          typeQuery = typeQuery.split(',')[0].replace(/\(.*?\)/g, '').trim();
        }
        const typeQueryAlt = String(u.typeQueryAlt || '');
        // A list that already shows the wanted answer is not opened again:
        // every pass used to re-open it, and a multi list un-picks a chip
        // clicked a second time. Only a committed display counts (a widget
        // value or chips), never text sitting in the filter box.
        // Exact text only ("Female" must not pass for "Male"), never a regex
        // pick (selectPrefer chooses by rule, not by literal), and never an
        // input's own value, which can be filter text left by a failed pass.
        const askedMany = Array.isArray(u.selectMany) ? u.selectMany.map(String).filter(Boolean) : [];
        const wantedAll = askedMany.length ? askedMany : [want].filter(Boolean);
        const sameText = (a, b) => normText(a).toLowerCase() === normText(b).toLowerCase();
        const chipBox = el.closest?.('[class*="value-container" i], [class*="valueContainer" i]');
        const chipTexts = chipBox
          ? [...chipBox.querySelectorAll('[class*="multi-value" i], [class*="multiValue" i]')]
            .filter((c) => !/label|remove/i.test(String(c.getAttribute('class') || '')))
            .map((c) => normText(c.textContent).replace(/[×✕]/g, '').trim())
            .filter(Boolean)
          : [];
        const hasChips = chipTexts.length > 0;
        const read = committedTextWithSource(el);
        const ownInputText = el.tagName === 'INPUT' && sameText(read.text, el.value || '');
        const shows = (w) => (hasChips ? chipTexts.some((c) => sameText(c, w)) : sameText(read.text, w));
        if (wantedAll.length && !placeSuggest && !u.selectPrefer
            && (hasChips || (read.source === 'widget' && !ownInputText))
            && wantedAll.every(shows)) {
          results.push({ i, frameId, ok: true, actualValue: hasChips ? wantedAll.join(', ') : read.text, kept: true });
          continue;
        }
        const many = hasChips ? askedMany.filter((w) => !shows(w)) : askedMany;
        const pickWant = askedMany.length && many.length ? many[0] : want;
        const res = await selectComboboxOption(el, phoneLike(pickWant) && placeSuggest ? typeQuery : pickWant, {
          alternates: Array.isArray(u.alternates) ? u.alternates : [],
          typeQuery,
          typeQueryAlt,
          prefer: preferRe(u),
          rank: rankRes(u),
          label: u.label || '',
          many,
          budgetMs: (placeSuggest ? 12000 : 9000) + many.length * 1200,
          patient: placeSuggest,
        });
        if (res.picked) {
          results.push({ i, frameId, ok: true, actualValue: res.picked });
          continue;
        }
        // A "location" box that never showed a single suggestion is a plain
        // text input: the place is typed as text instead of left empty.
        const plainPlaceBox = placeSuggest && !strongCombobox && !res.listOpened && !res.clicked
          && !(res.options || []).length;
        // The box already holds a suggestion for this city ("Paris,
        // Île-de-France, FRA" picked in an earlier pass): the plain city text
        // must not overwrite it.
        const held = normText(el.value || '');
        const cityWord = normText(typeQuery || want).split(/[\s,]+/)[0].toLowerCase();
        if (plainPlaceBox && held && cityWord.length >= 3 && held.toLowerCase().startsWith(cityWord)
            && held.length > normText(typeQuery || '').length && /,/.test(held)) {
          results.push({ i, frameId, ok: true, actualValue: held, kept: true });
          continue;
        }
        if ((strongCombobox || placeSuggest) && !plainPlaceBox) {
          // Closed-option widget: typed text is never a value. The trusted
          // CDP retry only helps when the list stayed shut or the click did
          // not stick — options that were on screen and did not match will
          // not match any better.
          const seen = res.options.slice(0, 12).join(' | ');
          let reason = `option introuvable — liste non ouverte pour « ${want} »`;
          if (res.clicked) reason = `option introuvable — « ${res.clicked} » cliquée mais non retenue`;
          else if (res.listOpened) reason = `option introuvable pour « ${want} »${seen ? ` (liste : ${seen})` : ''}`;
          else if (res.typed) reason = `option introuvable — aucun résultat pour « ${[typeQuery, typeQueryAlt].filter(Boolean).join(' » / « ')} »`;
          results.push({
            i,
            frameId,
            ok: false,
            reason,
            cdpRetry: !!res.clicked || !res.listOpened,
            want,
            typeQuery,
            typeQueryAlt,
            options: res.options.length ? res.options : undefined,
          });
          continue;
        }
        // Mild signal only (plain autocomplete-attributed text input) — free
        // text is a valid answer for these, fall through to the generic path.
      }

      // date / datetime-local / month / number / email / tel / url / text / search
      let writeValue = value;
      if (type === 'date' || type === 'month') {
        const iso = String(selectText || value || '').trim();
        const mIso = iso.match(/^(\d{4}-\d{2}-\d{2})/);
        if (mIso) writeValue = type === 'month' ? mIso[1].slice(0, 7) : mIso[1];
      }
      if (type === 'number' || type === 'range') {
        const num = String(value ?? '').replace(/[^\d.,-]/g, '').replace(',', '.');
        if (num) writeValue = num;
      }

      const useHuman = !!u.humanType || !!u.resume || tag === 'TEXTAREA'
        || String(writeValue || '').length >= 48;
      let actual = useHuman ? await setTextHuman(el, writeValue) : setText(el, writeValue);
      if (String(actual || '') !== String(writeValue ?? '') && (tag === 'INPUT' || tag === 'TEXTAREA')) {
        actual = useHuman ? await setTextHuman(el, writeValue) : setText(el, writeValue);
      }
      const landed = String(el.value ?? actual ?? '').trim();
      const wantStr = String(writeValue ?? '').trim();
      let okLand = true;
      if (type === 'tel') {
        const digits = (s) => String(s).replace(/\D/g, '');
        okLand = digits(landed).length > 0 && digits(landed) === digits(wantStr);
      } else if (type === 'email' || /@/.test(wantStr)) {
        okLand = landed.toLowerCase() === wantStr.toLowerCase();
      } else if ((tag === 'INPUT' || tag === 'TEXTAREA') && wantStr) {
        okLand = landed === wantStr
          || (wantStr.length >= 12 && landed.includes(wantStr.slice(0, 12)));
      }
      results.push({
        i,
        frameId,
        ok: okLand,
        actualValue: landed,
        reason: okLand ? undefined : 'valeur non retenue par le formulaire',
      });
    } catch (err) {
      results.push({ i, frameId: u.frameId ?? 0, ok: false, reason: String(err?.message || err) });
    }
  }
  return results;
}

/** After CDP setFileInputFiles, nudge React/Ashby listeners (some ignore silent FileList). */
async function pokeFileInputEvents(session) {
  await chrome.debugger.sendCommand(session, 'Runtime.evaluate', {
    expression: `(() => {
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
      const el = deep(document, '[data-co-upload="1"]')[0]
        || deep(document, 'input[type="file"]').find((e) => (e.files?.length || 0) > 0)
        || deep(document, 'input[type="file"]')[0];
      if (!el) return false;
      try {
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } catch {}
      return (el.files?.length || 0) > 0;
    })()`,
    returnByValue: true,
  }).catch(() => null);
}

/** Search one CDP session for a marked file input and attach the local file. */
async function trySetFileInputInSession(session, i, path) {
  let searchId;
  try {
    await chrome.debugger.sendCommand(session, 'DOM.enable', {}).catch(() => {});
    await chrome.debugger.sendCommand(session, 'Runtime.enable', {}).catch(() => {});

    // Prefer data-co-upload (fresh stamp) then data-co-i, then resume heuristics.
    // Ashby re-renders between detect and upload and wipes data-co-i.
    const evalResult = await chrome.debugger.sendCommand(session, 'Runtime.evaluate', {
      expression: `(() => {
        const visit = (node, sel) => {
          if (!node?.querySelectorAll) return null;
          const hit = node.querySelector(sel);
          if (hit) return hit;
          for (const el of node.querySelectorAll('*')) {
            if (el.shadowRoot) {
              const nested = visit(el.shadowRoot, sel);
              if (nested) return nested;
            }
          }
          return null;
        };
        const deepAll = (node, sel) => {
          const out = [];
          const walk = (n) => {
            if (!n?.querySelectorAll) return;
            try { out.push(...n.querySelectorAll(sel)); } catch {}
            for (const el of n.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot);
          };
          walk(node);
          return out;
        };
        const idx = ${JSON.stringify(String(i))};
        return visit(document, '[data-co-upload="1"]')
          || visit(document, '[data-co-i="' + idx.replace(/"/g, '') + '"]')
          || deepAll(document, 'input[type="file"]').find((el) => {
            const blob = ((el.name || '') + ' ' + (el.id || '') + ' ' + (el.accept || '') + ' ' + (el.getAttribute('aria-label') || '')).toLowerCase();
            return /resume|cv|curriculum|autofill|_systemfield_resume/.test(blob)
              || /pdf|doc/.test(el.accept || '');
          })
          || deepAll(document, 'input[type="file"]')[0]
          || null;
      })()`,
      objectGroup: 'co-upload',
    }).catch(() => null);
    const objectId = evalResult?.result?.objectId;
    if (objectId) {
      try {
        const { nodeId } = await chrome.debugger.sendCommand(session, 'DOM.requestNode', { objectId });
        if (nodeId) {
          await chrome.debugger.sendCommand(session, 'DOM.setFileInputFiles', { nodeId, files: [path] });
          await pokeFileInputEvents(session);
          return { ok: true };
        }
      } catch (err) {
        // fall through to performSearch
      }
    }

    for (const query of [`[data-co-upload="1"]`, `[data-co-i="${i}"]`, 'input[type="file"]']) {
      if (searchId != null) {
        await chrome.debugger.sendCommand(session, 'DOM.discardSearchResults', { searchId }).catch(() => {});
        searchId = null;
      }
      const search = await chrome.debugger.sendCommand(session, 'DOM.performSearch', {
        query,
        includeUserAgentShadowDOM: true,
      });
      searchId = search?.searchId;
      if (!search?.resultCount) continue;
      const { nodeIds } = await chrome.debugger.sendCommand(session, 'DOM.getSearchResults', {
        searchId,
        fromIndex: 0,
        toIndex: Math.min(search.resultCount, 5),
      });
      for (const nodeId of nodeIds || []) {
        if (!nodeId) continue;
        try {
          await chrome.debugger.sendCommand(session, 'DOM.setFileInputFiles', { nodeId, files: [path] });
          await pokeFileInputEvents(session);
          return { ok: true };
        } catch {
          // try next search hit (cover letter vs resume, etc.)
        }
      }
    }
    return { ok: false };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  } finally {
    if (searchId != null) {
      await chrome.debugger.sendCommand(session, 'DOM.discardSearchResults', { searchId }).catch(() => {});
    }
  }
}

/**
 * Attach a real local file to <input type="file"> via CDP (primary) or
 * DataTransfer in the page MAIN world (fallback).
 *
 * Important: chrome.scripting defaults to the isolated world — assigning
 * input.files there does not update the page's React/Ashby listeners.
 */
async function uploadFileInTab(tabId, { i, frameId = 0, path, fileBase64 = null, fileName = null }) {
  const target = { tabId };
  let attached = false;
  const iframeSessions = [];
  const seenSessions = new Set();
  const rememberSession = (session) => {
    const key = session.sessionId || 'main';
    if (seenSessions.has(key)) return;
    seenSessions.add(key);
    iframeSessions.push(session);
  };
  let networkOk = false;
  const uploadRequestIds = new Set();
  const onEvent = (source, method, params) => {
    if (source.tabId !== tabId) return;
    if (method === 'Target.attachedToTarget' && params?.sessionId) {
      rememberSession({ tabId, sessionId: params.sessionId });
    }
    if (method === 'Network.requestWillBeSent') {
      const req = params?.request;
      if (req && /^(POST|PUT|PATCH)$/i.test(req.method || '') && /upload|resume|attachment|\bcv\b|\/file|document/i.test(req.url || '')) {
        uploadRequestIds.add(params.requestId);
      }
    }
    if (method === 'Network.responseReceived' && uploadRequestIds.has(params?.requestId)) {
      const status = params?.response?.status || 0;
      if (status >= 200 && status < 300) networkOk = true;
    }
  };

  const stampInputs = async () => {
    const prepared = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: 'MAIN',
      func: (idx) => {
        const deepAll = (root, sel) => {
          const out = [];
          const visit = (node) => {
            if (!node?.querySelectorAll) return;
            try { out.push(...node.querySelectorAll(sel)); } catch { /* ignore */ }
            for (const el of node.querySelectorAll('*')) {
              if (el.shadowRoot) visit(el.shadowRoot);
            }
          };
          visit(root);
          return out;
        };
        document.querySelectorAll('[data-co-upload]').forEach((el) => el.removeAttribute('data-co-upload'));
        const files = deepAll(document, 'input[type="file"]');
        const score = (el) => {
          const blob = `${el.name || ''} ${el.id || ''} ${el.accept || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('data-co-i') || ''}`.toLowerCase();
          let s = 0;
          if (String(el.getAttribute('data-co-i')) === String(idx)) s += 100;
          if (/resume|\bcv\b|curriculum|autofill|_systemfield_resume/.test(blob)) s += 50;
          if (/pdf|msword|officedocument/.test(el.accept || '')) s += 20;
          if (/cover|lettre|reference|diploma|other/.test(blob) && !/resume|\bcv\b/.test(blob)) s -= 80;
          return s;
        };
        files.sort((a, b) => score(b) - score(a));
        const el = files.find((f) => score(f) > 0) || files[0];
        if (!el) return { ok: false, count: 0 };
        el.setAttribute('data-co-upload', '1');
        el.setAttribute('data-co-i', String(idx));
        el.removeAttribute('hidden');
        el.removeAttribute('disabled');
        try {
          el.style.setProperty('display', 'block', 'important');
          el.style.setProperty('visibility', 'visible', 'important');
          el.style.setProperty('opacity', '1', 'important');
          el.style.setProperty('width', '120px', 'important');
          el.style.setProperty('height', '32px', 'important');
          el.style.setProperty('position', 'fixed', 'important');
          el.style.setProperty('left', '8px', 'important');
          el.style.setProperty('top', '8px', 'important');
          el.style.setProperty('z-index', '2147483647', 'important');
        } catch { /* ignore */ }
        return { ok: true, count: files.length, name: el.name || '', score: score(el) };
      },
      args: [i],
    }).catch(() => []);
    return (prepared || []).some((entry) => entry?.result?.ok);
  };

  const confirmUpload = async () => {
    const deadline = Date.now() + 6000;
    let stable = 0;
    let last = judgeUploadSignals({}, { expectedName: fileName || '' });
    while (Date.now() < deadline) {
      const check = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        world: 'MAIN',
        func: collectUploadSignals,
        args: [fileName || ''],
      }).catch(() => []);
      const merged = mergeUploadSignals((check || []).map((entry) => entry?.result));
      merged.networkOk = !!(merged.networkOk || networkOk);
      last = judgeUploadSignals(merged, { expectedName: fileName || '' });
      if (last.error) return last;
      if (last.ok && !last.pending) {
        stable += 1;
        if (stable >= 2) return last;
      } else {
        stable = 0;
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    if (last.pending && last.hits?.length) {
      return {
        ok: true,
        pending: false,
        error: false,
        reason: last.hits.join(', '),
        hits: last.hits,
        fileName: fileName || '',
      };
    }
    if (last.pending) {
      return { ok: false, pending: false, error: false, reason: last.reason || 'spinner encore actif' };
    }
    return last;
  };

  const injectViaDataTransfer = async () => {
    if (!fileBase64) return { ok: false, error: 'no file bytes for DataTransfer fallback' };
    const injected = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: 'MAIN',
      func: (b64, name, idx) => {
        const deepAll = (root, sel) => {
          const out = [];
          const visit = (node) => {
            if (!node?.querySelectorAll) return;
            try { out.push(...node.querySelectorAll(sel)); } catch { /* ignore */ }
            for (const el of node.querySelectorAll('*')) {
              if (el.shadowRoot) visit(el.shadowRoot);
            }
          };
          visit(root);
          return out;
        };
        const score = (el) => {
          const blob = `${el.name || ''} ${el.id || ''} ${el.accept || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('data-co-i') || ''}`.toLowerCase();
          let s = 0;
          if (el.getAttribute('data-co-upload') === '1') s += 200;
          if (String(el.getAttribute('data-co-i')) === String(idx)) s += 100;
          if (/resume|\bcv\b|curriculum|autofill|_systemfield_resume/.test(blob)) s += 50;
          if (/cover|lettre|reference|diploma|other/.test(blob) && !/resume|\bcv\b/.test(blob)) s -= 80;
          return s;
        };
        const files = deepAll(document, 'input[type="file"]').sort((a, b) => score(b) - score(a));
        const el = files.find((f) => score(f) > 0) || files[0];
        if (!el) return { ok: false, error: 'no file input' };
        try {
          const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          const file = new File([bin], name || 'resume.pdf', { type: 'application/pdf' });
          const dt = new DataTransfer();
          dt.items.add(file);
          el.files = dt.files;
          el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
          return { ok: (el.files?.length || 0) > 0, name: el.files?.[0]?.name || '', count: el.files?.length || 0 };
        } catch (err) {
          return { ok: false, error: String(err?.message || err) };
        }
      },
      args: [fileBase64, fileName || 'resume.pdf', i],
    }).catch((err) => [{ result: { ok: false, error: String(err?.message || err) } }]);
    const hit = (injected || []).find((e) => e?.result?.ok);
    if (hit) return { ok: true, fileName: hit.result?.name || fileName || '' };
    const err = (injected || []).map((e) => e?.result?.error).filter(Boolean)[0];
    return { ok: false, error: err || 'DataTransfer assign failed' };
  };

  try {
    if (!(await stampInputs())) {
      return { ok: false, error: `no file input found to stamp (frameId=${frameId}, i=${i})` };
    }

    // 1) CDP first — Playwright-equivalent, works across frames with absolute path.
    chrome.debugger.onEvent.addListener(onEvent);
    await chrome.debugger.attach(target, '1.3');
    attached = true;
    await chrome.debugger.sendCommand(target, 'Network.enable', {}).catch(() => {});
    await chrome.debugger.sendCommand(target, 'Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
    }).catch(() => {});
    try {
      const { targetInfos } = await chrome.debugger.sendCommand(target, 'Target.getTargets', {});
      for (const info of targetInfos || []) {
        if (info.type !== 'iframe' || !info.targetId) continue;
        const attachedTo = await chrome.debugger.sendCommand(target, 'Target.attachToTarget', {
          targetId: info.targetId,
          flatten: true,
        }).catch(() => null);
        if (attachedTo?.sessionId) rememberSession({ tabId, sessionId: attachedTo.sessionId });
      }
    } catch { /* best-effort */ }
    await new Promise((r) => setTimeout(r, 350));

    const candidates = [target, ...iframeSessions];
    const errors = [];
    for (const session of candidates) {
      // Re-stamp before each session attempt — Ashby remounts wipe markers.
      await stampInputs();
      const outcome = await trySetFileInputInSession(session, i, path);
      if (!outcome.ok) {
        if (outcome.error) errors.push(outcome.error);
        continue;
      }
      const confirmed = await confirmUpload();
      if (confirmed.ok) {
        return { ok: true, fileName: confirmed.fileName || fileName || '' };
      }
      errors.push(confirmed.reason || 'CDP setFileInputFiles ok but upload not confirmed');
    }

    // 2) MAIN-world DataTransfer (isolated world assign is invisible to React).
    if (fileBase64) {
      await stampInputs();
      const viaBytes = await injectViaDataTransfer();
      if (viaBytes.ok) {
        const confirmed = await confirmUpload();
        if (confirmed.ok) {
          return { ok: true, fileName: confirmed.fileName || viaBytes.fileName || fileName || '' };
        }
        errors.push(confirmed.reason || 'DataTransfer assigné mais upload non confirmé');
      } else if (viaBytes.error) {
        errors.push(viaBytes.error);
      }
    }

    return {
      ok: false,
      error: errors[0] || `file input not found in ${candidates.length} frame session(s)`,
    };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  } finally {
    chrome.debugger.onEvent.removeListener(onEvent);
    if (attached) {
      try { await chrome.debugger.detach(target); } catch { /* ignore */ }
    }
  }
}

async function fillFieldsInTab(tabId, updates) {
  const byFrame = new Map();
  for (const u of updates) {
    const frameId = u.frameId ?? 0;
    if (!byFrame.has(frameId)) byFrame.set(frameId, []);
    byFrame.get(frameId).push(u);
  }
  const outcomes = [];
  for (const [frameId, frameUpdates] of byFrame) {
    try {
      const injected = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [frameId] },
        func: fillFieldsInPage,
        args: [frameUpdates],
      });
      const result = injected?.[0]?.result;
      if (Array.isArray(result)) outcomes.push(...result);
      else {
        for (const u of frameUpdates) {
          outcomes.push({ i: u.i, frameId, ok: false, reason: 'fill inject returned nothing (cross-origin frame?)' });
        }
      }
    } catch (err) {
      for (const u of frameUpdates) {
        outcomes.push({ i: u.i, frameId, ok: false, reason: String(err?.message || err) });
      }
    }
  }

  // Synthetic MouseEvents are often ignored (event.isTrusted === false) by
  // react-select / Radix / SmartRecruiters. Retry with CDP
  // Input.dispatchMouseEvent (trusted hardware-like clicks) — only where that
  // can help: the list stayed shut, or the clicked option did not stick.
  // Those clicks land at viewport coordinates: the quick-fill panel steps
  // aside so it cannot catch one.
  const cdpNeeded = outcomes.some((o) => !o.ok && o.cdpRetry);
  if (cdpNeeded) await setHelperHidden(tabId, true);
  try {
    await retryCombosViaCdp(tabId, updates, outcomes);
  } finally {
    if (cdpNeeded) await setHelperHidden(tabId, false);
  }
  return outcomes;
}

async function retryCombosViaCdp(tabId, updates, outcomes) {
  for (let idx = 0; idx < outcomes.length; idx++) {
    const o = outcomes[idx];
    if (o.ok || !o.cdpRetry) continue;
    const u = updates.find((x) => x.i === o.i && (x.frameId ?? 0) === (o.frameId ?? 0));
    if (!u) continue;
    const want = String(o.want || u.selectText || u.value || '').trim();
    if (!want) continue;
    try {
      const cdp = await fillComboboxViaCdp(tabId, {
        i: u.i,
        frameId: u.frameId ?? 0,
        want,
        alternates: Array.isArray(u.alternates) ? u.alternates : [],
        typeQuery: String(o.typeQuery || ''),
        typeQueryAlt: String(o.typeQueryAlt || u.typeQueryAlt || ''),
        patient: !!u.placeSuggest,
      });
      if (cdp?.ok) {
        outcomes[idx] = { i: o.i, frameId: o.frameId ?? 0, ok: true, actualValue: cdp.actualValue || want };
      } else if (cdp?.error) {
        outcomes[idx] = { ...o, reason: `${o.reason}; cdp: ${cdp.error}` };
      }
    } catch (err) {
      outcomes[idx] = { ...o, reason: `${o.reason}; cdp: ${String(err?.message || err).slice(0, 80)}` };
    }
  }
}

/** Trusted mouse click at viewport coordinates (CDP Input domain). */
async function cdpMouseClick(session, x, y) {
  const cx = Math.round(x);
  const cy = Math.round(y);
  await chrome.debugger.sendCommand(session, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: cx, y: cy, button: 'none',
  });
  await chrome.debugger.sendCommand(session, 'Input.dispatchMouseEvent', {
    type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1,
  });
  await chrome.debugger.sendCommand(session, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: cx, y: cy, button: 'left', clickCount: 1,
  });
}

/**
 * Open a combobox, find the best matching option, click both via CDP so
 * widgets that ignore untrusted synthetic events still register the choice.
 * Same rules as the in-page pick: only `typeQuery` is ever typed, a click
 * counts once the widget shows the option, and whatever was typed is cleared
 * when nothing got committed — this path used to type the whole answer and
 * leave it in the box.
 */
async function fillComboboxViaCdp(tabId, { i, frameId = 0, want, alternates = [], typeQuery = '', typeQueryAlt = '', patient = false }) {
  const target = { tabId };
  let attached = false;
  const iframeSessions = [];
  const onEvent = (source, method, params) => {
    if (source.tabId !== tabId) return;
    if (method === 'Target.attachedToTarget' && params?.targetInfo?.type === 'iframe') {
      iframeSessions.push({ tabId, sessionId: params.sessionId });
    }
  };

  const evalInSession = async (session, expression) => {
    const res = await chrome.debugger.sendCommand(session, 'Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: false,
    });
    if (res?.exceptionDetails) {
      return { ok: false, error: res.exceptionDetails.text || 'evaluate failed' };
    }
    return res?.result?.value ?? null;
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pressKey = async (session, key, keyCode) => {
    await chrome.debugger.sendCommand(session, 'Input.dispatchKeyEvent', {
      type: 'rawKeyDown', key, code: key, windowsVirtualKeyCode: keyCode,
    }).catch(() => {});
    await chrome.debugger.sendCommand(session, 'Input.dispatchKeyEvent', {
      type: 'keyUp', key, code: key, windowsVirtualKeyCode: keyCode,
    }).catch(() => {});
  };

  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const wants = [want, ...alternates].map(norm).filter((s, k, all) => s && all.indexOf(s) === k);
  const binaryWant = /^(yes|oui|y|true|s[ií]|ja|sim|no|non|n|false|nein|n[aã]o)$/i.test(norm(want));
  const query = binaryWant ? '' : norm(typeQuery).slice(0, 40);
  const queryAlt = binaryWant ? '' : norm(typeQueryAlt).slice(0, 40);
  const FIND_FIELD = `const visit = (node, sel) => {
      if (!node?.querySelectorAll) return null;
      const hit = node.querySelector(sel);
      if (hit) return hit;
      for (const el of node.querySelectorAll('*')) {
        if (el.shadowRoot) {
          const nested = visit(el.shadowRoot, sel);
          if (nested) return nested;
        }
      }
      return null;
    };
    const field = visit(document, '[data-co-i="${String(i).replace(/"/g, '')}"]');`;

  // Focus the box and select its text (a trusted Backspace then deletes it).
  const SELECT_TEXT_FN = `(() => {
    ${FIND_FIELD}
    if (!field) return '';
    try { field.focus(); if (field.select) field.select(); } catch {}
    return String(field.value || '');
  })()`;
  const FIELD_VALUE_FN = `(() => {
    ${FIND_FIELD}
    return field ? String(field.value || '') : '';
  })()`;
  const FORCE_CLEAR_FN = `(() => {
    ${FIND_FIELD}
    if (!field || (field.tagName !== 'INPUT' && field.tagName !== 'TEXTAREA')) return '';
    // Never blank a Revolut-style listbox trigger — its .value IS the pick.
    if (field.tagName === 'INPUT' && (field.type || '').toLowerCase() === 'button') {
      return String(field.value || '');
    }
    const proto = field.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(field, ''); else field.value = '';
    field.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'deleteContentBackward' }));
    return String(field.value || '');
  })()`;
  // Did the widget take the option? Same reading as the in-page check.
  const committedFn = (picked) => `(() => {
    ${FIND_FIELD}
    if (!field) return false;
    const low = (s) => String(s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
    const want = low(${JSON.stringify(String(picked || ''))});
    if (!want) return false;
    const same = (t) => !!t && (t === want || (want.length >= 4 && t.includes(want)));
    const valueBox = field.closest('[class*="value-container" i], [class*="valueContainer" i]');
    const chips = valueBox ? [...valueBox.querySelectorAll('[class*="multi-value" i], [class*="multiValue" i]')] : [];
    if (chips.length) return chips.some((c) => low(c.textContent) === want);
    let node = field.parentElement;
    for (let d = 0; d < 6 && node && node.tagName !== 'FORM'; d++, node = node.parentElement) {
      const shown = node.querySelector('[class*="singleValue" i], [class*="single-value" i]');
      if (shown) return same(low(shown.textContent));
      const shadow = node.querySelector('input[aria-hidden="true"]:not([type="checkbox"]):not([type="radio"])');
      if (shadow && String(shadow.value || '').trim()) return same(low(shadow.value));
    }
    const own = field.tagName === 'BUTTON' || field.getAttribute('aria-haspopup')
      ? (field.innerText || field.textContent || field.value)
      : field.value;
    return same(low(own));
  })()`;

  const FIELD_RECT_FN = `(() => {
    const visit = (node, sel) => {
      if (!node?.querySelectorAll) return null;
      const hit = node.querySelector(sel);
      if (hit) return hit;
      for (const el of node.querySelectorAll('*')) {
        if (el.shadowRoot) {
          const nested = visit(el.shadowRoot, sel);
          if (nested) return nested;
        }
      }
      return null;
    };
    const el = visit(document, '[data-co-i="${String(i).replace(/"/g, '')}"]');
    if (!el) return null;
    const control = el.closest('[class*="select__control"], [class*="Select-control"], [class*="control" i], [class*="select-shell"], spl-select') || el;
    try { control.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch {}
    const r = control.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  })()`;

  // `typed`: after a search query, a lone result holding the query counts.
  const optionRectFn = (typed) => `(() => {
    const wants = ${JSON.stringify(wants)};
    const typedQuery = ${JSON.stringify(typed ? query.toLowerCase() : '')};
    const norm = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
    const PLACEHOLDER = /^(select\\b|choose\\b|--|please\\b|s[ée]lectionn|selecci[oó]n|elij?[ae]\\b|elige\\b|w[äa]hlen|bitte\\b|scegli|selezion|kies\\b|selecteer|aucun(e)? (r[ée]sultat|option|choix)|(loading|searching|chargement|recherche)(\\s*(\\.\\.\\.|…))?$|recherche en cours|no options|no results|start typing|type to search)/i;
    const SEL = '[role="option"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="treeitem"], [id*="-option-"], [part="option"], [class*="select__option"], [class*="SelectOption"], [class*="Select-option"], li[class*="option"], [class*="-menu"] li, [class*="menuList" i] > *, [class*="menu-list" i] > *, [class*="MuiMenuItem"], [class*="MuiAutocomplete-option"], [class*="ant-select-item-option"], mat-option, .ng-option, [cmdk-item], [data-radix-collection-item], [data-highlighted], [class*="dropdown-item" i], [class*="DropdownMenuItem" i], .select2-results__option, [class*="select2-results__option"], .choices__item--choice, .vs__dropdown-option, .el-select-dropdown__item, [class*="el-select-dropdown__item"], [data-automation-id*="promptOption" i], [data-automation-id*="option" i], spl-option, oc-option, [class*="spl-option" i], [class*="v-list-item" i], [role="listbox"] li, .pac-item, [class*="-option" i], [class*="menu-item" i], .dropdown-location, li[id*="option"], ul[id*="listbox"] li, [class*="option-" i]';
    const deepAll = (root, sel) => {
      const out = [];
      const visit = (node) => {
        if (!node?.querySelectorAll) return;
        try { out.push(...node.querySelectorAll(sel)); } catch {}
        for (const el of node.querySelectorAll('*')) if (el.shadowRoot) visit(el.shadowRoot);
      };
      visit(root);
      return out;
    };
    const visit = (node, sel) => {
      if (!node?.querySelectorAll) return null;
      const hit = node.querySelector(sel);
      if (hit) return hit;
      for (const el of node.querySelectorAll('*')) {
        if (el.shadowRoot) {
          const nested = visit(el.shadowRoot, sel);
          if (nested) return nested;
        }
      }
      return null;
    };
    const field = visit(document, '[data-co-i="${String(i).replace(/"/g, '')}"]');
    let cands = deepAll(document, SEL).filter((n) => {
      const r = n.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && norm(n.innerText || n.getAttribute && n.getAttribute('aria-label'));
    });
    cands = cands.filter((n) => !cands.some((o) => o !== n && n.contains(o)));
    if (field) {
      // The list the control names, when it names one; else rows near it.
      const ids = ((field.getAttribute('aria-controls') || '') + ' ' + (field.getAttribute('aria-owns') || '')).trim().split(/\\s+/).filter(Boolean);
      const boxes = ids.map((id) => document.getElementById(id)).filter(Boolean);
      const owned = boxes.length ? cands.filter((n) => boxes.some((b) => b.contains(n))) : [];
      // A list holding its own rows (Google Forms): only those, never a
      // neighbour list's chosen row.
      const selfList = (field.getAttribute('role') || '').toLowerCase() === 'listbox' && !!field.querySelector('[role="option"]');
      if (selfList) {
        cands = cands.filter((n) => field.contains(n));
      } else if (owned.length) {
        cands = owned;
      } else {
        const fr = field.getBoundingClientRect();
        const near = cands.filter((n) => {
          const b = n.getBoundingClientRect();
          return b.top >= fr.top - 420 && b.top <= fr.bottom + 420
            && b.left < fr.right + 80 && b.right > fr.left - 80;
        });
        if (near.length) cands = near;
      }
    }
    cands = cands.filter((n) => !PLACEHOLDER.test(norm(n.innerText || (n.getAttribute && n.getAttribute('aria-label')))));
    const score = (t, want) => {
      const low = t.toLowerCase();
      const wLow = want.toLowerCase();
      if (low === wLow) return 100;
      // Long rows: the option's own text, compared word for word.
      if (wLow.length > 80) {
        const words = (s) => new Set(s.toLowerCase().normalize('NFD').replace(/\\p{M}/gu, '').split(/[^a-z0-9+]+/).filter((w) => w.length >= 3));
        const a = words(want);
        const b = words(t);
        let shared = 0;
        for (const w of a) if (b.has(w)) shared++;
        return a.size && b.size && shared / Math.max(a.size, b.size) >= 0.85 ? 88 : 0;
      }
      const kind = /^(yes|oui|y|true|s[ií]|ja|sim)$/i.test(want) ? 'yes' : /^(no|non|n|false|nein|n[aã]o)$/i.test(want) ? 'no' : null;
      if (kind === 'yes' && /^(yes|oui|s[ií]|ja|sim)(?![a-zà-ÿ])/i.test(t) && !/^(no|non|nein|n[aã]o)(?![a-zà-ÿ])/i.test(t)) return 90;
      if (kind === 'no' && /^(no|non|nein|n[aã]o)(?![a-zà-ÿ])/i.test(t) && !/^non-?binary\\b/i.test(t) && !/^none\\b/i.test(t)) return 90;
      if (kind) return 0;
      // Country-code rows: the code decides; a bare name needs a whole word.
      const DIAL_RE = /(^|[\\s(])(\\+\\d{1,4})(?=[\\s)]|$)/;
      const wantCode = (want.match(DIAL_RE) || [])[2] || '';
      const optCode = (t.match(DIAL_RE) || [])[2] || '';
      if (wantCode && optCode) return wantCode === optCode ? 92 : 0;
      if (wantCode || optCode) {
        const name = (wantCode ? want.replace(DIAL_RE, ' ') : want).replace(/\\s+/g, ' ').trim();
        if (name.length < 4) return 0;
        const esc = name.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
        return new RegExp('(^|\\\\W)' + esc + '(\\\\W|$)', 'i').test(t) ? 85 : 0;
      }
      // A hint, never a pick (same 40 as lib and the in-page score).
      if (wLow.length >= 4 && (low.includes(wLow) || (low.length >= 4 && wLow.includes(low)))) return 40;
      return 0;
    };
    let best = 0; let hit = null;
    for (const n of cands) {
      const t = norm(n.innerText || (n.getAttribute && n.getAttribute('aria-label')));
      for (const w of wants) {
        const s = score(t, w);
        if (s > best) { best = s; hit = n; }
      }
    }
    if ((!hit || best < 50) && typedQuery && cands.length === 1
        && norm(cands[0].innerText).toLowerCase().includes(typedQuery)) {
      // A lone place row has to name the wanted country (or its 3-letter
      // code): "Paris, Texas, USA" is not "Paris, France".
      const rowLow = norm(cands[0].innerText).toLowerCase();
      const wantCountry = String((wants[0] || '').split(',')[1] || '').trim().toLowerCase();
      const placeOk = !wantCountry || !/,/.test(rowLow) || rowLow.includes(wantCountry) || rowLow.includes(wantCountry.slice(0, 3));
      if (placeOk) {
        hit = cands[0];
        best = 50;
      }
    }
    if (!hit || best < 50) return { ok: false, count: cands.length, seen: cands.slice(0, 8).map((n) => norm(n.innerText).slice(0, 40)) };
    const r = hit.getBoundingClientRect();
    return { ok: true, text: norm(hit.innerText || (hit.getAttribute && hit.getAttribute('aria-label'))), x: r.x, y: r.y, width: r.width, height: r.height, count: cands.length };
  })()`;

  let cleanup = async () => {};
  try {
    chrome.debugger.onEvent.addListener(onEvent);
    await chrome.debugger.attach(target, '1.3');
    attached = true;
    await chrome.debugger.sendCommand(target, 'Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
    }).catch(() => {});
    await new Promise((r) => setTimeout(r, 250));

    const sessions = [target, ...iframeSessions];
    let fieldSession = null;
    let fieldRect = null;
    for (const session of sessions) {
      await chrome.debugger.sendCommand(session, 'Runtime.enable', {}).catch(() => {});
      const rect = await evalInSession(session, FIELD_RECT_FN);
      if (rect && rect.width > 0) {
        fieldSession = session;
        fieldRect = rect;
        break;
      }
    }
    if (!fieldSession || !fieldRect) {
      return { ok: false, error: `field data-co-i=${i} not found for CDP click` };
    }

    await cdpMouseClick(
      fieldSession,
      fieldRect.x + fieldRect.width / 2,
      fieldRect.y + fieldRect.height / 2,
    );
    await new Promise((r) => setTimeout(r, 400));

    // ArrowDown via CDP as a second open signal
    await chrome.debugger.sendCommand(fieldSession, 'Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40,
    }).catch(() => {});
    await chrome.debugger.sendCommand(fieldSession, 'Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40,
    }).catch(() => {});
    await new Promise((r) => setTimeout(r, 350));

    let typed = false;
    // Leave the box as it was: empty what was typed (trusted Backspace on the
    // selected text, then the value setter) and close the list.
    cleanup = async () => {
      if (typed) {
        const left = await evalInSession(fieldSession, SELECT_TEXT_FN);
        if (typeof left === 'string' && left) {
          await pressKey(fieldSession, 'Backspace', 8);
          await sleep(150);
          const still = await evalInSession(fieldSession, FIELD_VALUE_FN);
          if (typeof still === 'string' && still) await evalInSession(fieldSession, FORCE_CLEAR_FN);
        }
      }
      await pressKey(fieldSession, 'Escape', 27);
    };

    // Search lists only: the server's queries, never the answer.
    const typeQueryViaCdp = async (text) => {
      await evalInSession(fieldSession, `(() => { ${FIND_FIELD} if (field) field.focus(); return !!field; })()`);
      for (const ch of text) {
        await chrome.debugger.sendCommand(fieldSession, 'Input.dispatchKeyEvent', {
          type: 'keyDown', text: ch, key: ch,
        }).catch(() => {});
        await chrome.debugger.sendCommand(fieldSession, 'Input.dispatchKeyEvent', {
          type: 'keyUp', key: ch,
        }).catch(() => {});
        await sleep(35);
      }
      typed = true;
      await sleep(500);
    };
    // Empty the box between two queries (trusted Backspace on the selected
    // text, then the value setter) without closing the list.
    const clearTypedViaCdp = async () => {
      const left = await evalInSession(fieldSession, SELECT_TEXT_FN);
      if (typeof left === 'string' && left) {
        await pressKey(fieldSession, 'Backspace', 8);
        await sleep(150);
        const still = await evalInSession(fieldSession, FIELD_VALUE_FN);
        if (typeof still === 'string' && still) await evalInSession(fieldSession, FORCE_CLEAR_FN);
      }
    };

    let option = null;
    const queries = [query, queryAlt].filter((q, k, all) => q.length >= 2 && all.indexOf(q) === k);
    let queried = 0;
    // Place searches (Lever, Google Places) answer a second or two after the
    // keystrokes: the OLX retry gave up on "Paris" before its suggestions came.
    const perQuery = patient ? 10 : 3;
    const altAt = 1 + perQuery;
    const maxAttempts = 2 + perQuery * (queries.length > 1 ? 2 : 1);
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      for (const session of [fieldSession, ...sessions.filter((s) => s !== fieldSession)]) {
        const found = await evalInSession(session, optionRectFn(typed));
        if (found?.ok && found.width > 0) {
          option = { session, ...found };
          break;
        }
      }
      if (option) break;
      if (attempt === 1 && queries.length && !typed) {
        await typeQueryViaCdp(queries[0]);
        queried = 1;
        continue;
      }
      // The first query showed nothing usable: try the second one.
      if (attempt === altAt && queries.length > 1 && queried === 1) {
        await clearTypedViaCdp();
        await typeQueryViaCdp(queries[1]);
        queried = 2;
        continue;
      }
      await sleep(typed ? (patient ? 550 : 400) : 200);
    }

    if (!option) {
      await cleanup();
      return { ok: false, error: `aucune option pour « ${want} »` };
    }

    await cdpMouseClick(
      option.session,
      option.x + option.width / 2,
      option.y + option.height / 2,
    );
    let committed = false;
    for (let k = 0; k < 4 && !committed; k++) {
      await sleep(k ? 150 : 250);
      committed = (await evalInSession(fieldSession, committedFn(option.text))) === true;
    }
    if (!committed) {
      await cleanup();
      return { ok: false, error: `« ${option.text} » cliquée mais non retenue` };
    }
    return { ok: true, actualValue: option.text || want };
  } catch (err) {
    // A typed filter must not stay in the box when the retry itself failed.
    try { await cleanup(); } catch { /* ignore */ }
    return { ok: false, error: String(err?.message || err) };
  } finally {
    chrome.debugger.onEvent.removeListener(onEvent);
    if (attached) {
      try { await chrome.debugger.detach(target); } catch { /* ignore */ }
    }
  }
}

connect();
