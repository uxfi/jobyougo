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

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  try {
    ws = new WebSocket(BRIDGE_URL);
  } catch {
    scheduleReconnect();
    return;
  }
  ws.addEventListener('open', () => {
    console.log('[jobyougo-bridge] connected to', BRIDGE_URL);
    send({
      type: 'hello',
      extension: 'jobyougo-apply-bridge-poc',
      version: chrome.runtime.getManifest().version,
      // Lets the bridge skip messages an older build would never answer.
      capabilities: ['page-helper', 'read-options'],
    });
  });
  ws.addEventListener('close', scheduleReconnect);
  // Connection refused is reported by Chrome on the WebSocket constructor
  // itself. It is not an exception: the server was not listening yet.
  ws.addEventListener('error', () => { try { ws.close(); } catch { /* already closing */ } });
  ws.addEventListener('message', onMessage);
}

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

    if (msg.type === 'click-submit' && msg.tabId && msg.reSrc) {
      const result = await clickSubmitInTab(msg.tabId, msg.reSrc);
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

    // The bridge matches replies by requestId only; the type is informative.
    reply(rid, `${msg.type || 'request'}-result`, false, { error: `unsupported message: ${msg.type}` });
  } catch (err) {
    reply(rid, `${msg.type || 'request'}-result`, false, { error: String(err?.message || err) });
  }
}

function waitForTabComplete(tabId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('tab did not finish loading in time'));
    }, timeoutMs);
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
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
  const txt = (el) => ((el.innerText || el.value || '')).replace(/\s+/g, ' ').trim();
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 5 && r.height > 5 && !el.disabled && el.getAttribute('aria-disabled') !== 'true';
  };
  const all = deepQueryAll(document, 'button, input[type="submit"], input[type="button"], [role="button"]')
    .filter(visible)
    .filter((el) => !/apply for this (job|position|role)/i.test(txt(el)));
  const target = all.find((el) => strong.test(txt(el)))
    || [...all].reverse().find((el) => (el.type || '').toLowerCase() === 'submit')
    || all.find((el) => re.test(txt(el)));
  if (!target) return null;
  const tier = strong.test(txt(target)) ? 2 : ((target.type || '').toLowerCase() === 'submit' ? 1 : 0);
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
  const stillForm = files.length > 0 || otherFillable.some(visible);
  let sample = (textErrs[0]?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!sample && banner) sample = bodyText.slice(banner.index, banner.index + 120).trim();
  return { errorCount, stillForm, sample };
}

async function clickSubmitInTab(tabId, reSrc) {
  const injected = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: markSubmitCandidateInPage,
    args: [reSrc],
  });
  let best = null;
  for (const entry of injected) {
    const r = entry.result;
    if (r && (!best || r.tier > best.tier)) best = { ...r, frameId: entry.frameId };
  }
  if (!best) return { clicked: false };
  await chrome.scripting.executeScript({
    target: { tabId, frameIds: [best.frameId] },
    func: clickMarkedSubmitInPage,
  });

  await new Promise((r) => setTimeout(r, 1800));
  let rejection = { errorCount: 0, stillForm: false, sample: '' };
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
        sample: rejection.sample || r.sample,
      };
    }
  } catch {
    // Page likely navigated to a confirmation page mid-evaluate — no form
    // left to reject anything, which is the good outcome.
  }
  return {
    clicked: true,
    text: best.text,
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
  const PLACEHOLDER_OPT = /^(select\b|choose\b|--|please\b|s[ée]lectionn|aucun|loading|searching|chargement|recherche|no options|no results|aucun r[ée]sultat|start typing|type to search)/i;
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
    const yesHead = /^(yes|oui|y|yeah|true)\b/i;
    const noHead = /^(no|non|n|false)\b/i;
    const kind = /^(yes|oui|y|true)$/i.test(raw) ? 'yes' : /^(no|non|n|false)$/i.test(raw) ? 'no' : null;
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
    if (wLow.length >= 4 && (low.includes(wLow) || (low.length >= 4 && wLow.includes(low)))) return 55;
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
    if (nodes.length === 1 && normText(want).length >= 2) {
      const only = normText(nodes[0].innerText || nodes[0].getAttribute?.('aria-label')).toLowerCase();
      const q = normText(want).toLowerCase();
      if (only && (only.includes(q) || q.includes(only) || only.startsWith(q.slice(0, 3)))) return nodes[0];
    }
    return null;
  };

  const committedText = (fieldEl) => {
    let node = fieldEl.parentElement;
    // Stay inside the field's own wrapper. Searched from the <form>, the
    // first hidden input belongs to some other control — a Radix checkbox's
    // bubble input reads "on" — and every eRecruiter pick was judged failed.
    for (let d = 0; d < 6 && node && node.tagName !== 'FORM'; d++, node = node.parentElement) {
      const shown = node.querySelector?.('[class*="singleValue" i], [class*="single-value" i]');
      if (shown) return normText(shown.textContent);
      const shadow = node.querySelector?.('input[aria-hidden="true"]:not([type="checkbox"]):not([type="radio"])');
      if (shadow && String(shadow.value || '').trim()) return normText(shadow.value);
    }
    if (fieldEl.tagName === 'BUTTON' || fieldEl.getAttribute('aria-haspopup')) {
      // <input type="button" aria-haspopup="listbox"> (Revolut) keeps the pick
      // in .value; native <button> pickers use innerText.
      return normText(fieldEl.innerText || fieldEl.textContent || fieldEl.value || '');
    }
    return normText(fieldEl.value || '');
  };

  // A typed filter ("Ban") is not a selection of "Bangkok". The visible value
  // has to be the option, not a prefix still sitting in the box.
  const selectionMatches = (fieldEl, pickedText) => {
    const want = normText(pickedText).toLowerCase();
    // Multi-select lists show each pick as a chip beside the input, not as one value.
    const valueBox = fieldEl.closest?.('[class*="value-container" i], [class*="valueContainer" i]');
    const chips = valueBox ? [...valueBox.querySelectorAll('[class*="multi-value" i], [class*="multiValue" i]')] : [];
    if (chips.length) return chips.some((c) => normText(c.textContent).toLowerCase() === want);
    const got = committedText(fieldEl).toLowerCase();
    if (!got || !want || PLACEHOLDER_OPT.test(got) || got === 'select...') return false;
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
    const control = fieldEl.closest?.(
      '[class*="select__control"], [class*="Select-control"], [class*="control" i], [class*="select-shell"], spl-select, [class*="dropdown" i]',
    ) || fieldEl;
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
    alternates = [], typeQuery = '', prefer = null, rank = [], label = '', budgetMs = 9000, many = [],
  } = {}) => {
    const wants = [want, ...alternates].map(normText).filter((x, k, all) => x && all.indexOf(x) === k);
    const out = { picked: null, listOpened: false, clicked: '', options: [], typed: false };
    if (!wants.length && !prefer && !rank.length) return out;
    const deadline = Date.now() + budgetMs;
    // Yes/No is never typed ("No" filters down to "None").
    const binary = /^(yes|oui|y|true|no|non|n|false)$/i.test(wants[0] || '');

    const matchIn = (nodes) => {
      for (const q of wants) {
        const hit = pickBestOption(nodes, q);
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
        if (/^(yes|oui)\b/i.test(t)) yes = true;
        else if (/^(no|non)\b/i.test(t) && !/^non-?binary/i.test(t) && !/^none\b/i.test(t)) no = true;
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
        if (ticked(node) || selectionMatches(el, label)) return label;
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

    // Multi-select: tick every chosen option, reopening if a pick closed it.
    if (shown && many.length > 1) {
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

    if (shown && !(yesNoOnly(shown.nodes) && !binary)) {
      const hit = matchIn(shown.nodes);
      if (hit) {
        const got = await clickAndCheck(hit);
        if (got) {
          out.picked = got;
          return out;
        }
      }
    }

    // 2) Search lists: type the query, pick among the results.
    const query = normText(typeQuery).slice(0, 40);
    const typable = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
    if (!out.clicked && query.length >= 2 && !binary && typable && Date.now() < deadline
        && !(shown && listIsComplete(shown.nodes))) {
      await typeIntoFilter(el, query);
      out.typed = true;
      // Async lists (Greenhouse location) answer after a network round trip:
      // wait for results, stop once they hold still (not before the search
      // had time to replace what was on screen).
      let hit = null;
      let lastSig = '';
      const typedAt = Date.now();
      const until = Math.min(deadline, typedAt + 3200);
      while (Date.now() < until) {
        await sleep(160);
        const snap = optionSnapshot(el, true);
        if (!snap.count) continue;
        hit = matchIn(snap.nodes);
        if (!hit && snap.nodes.length === 1 && labelOfNode(snap.nodes[0]).toLowerCase().includes(query.toLowerCase())) {
          hit = snap.nodes[0];
        }
        if (hit || (snap.sig === lastSig && Date.now() - typedAt > 900)) break;
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
    if (out.typed) clearFilter(el);
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

  const pickOption = (options, want) => {
    const w = String(want || '').toLowerCase().trim();
    if (!w) return null;
    return options.find((o) => (o.text || '').toLowerCase() === w || (o.value || '').toLowerCase() === w)
      || options.find((o) => (o.text || '').toLowerCase().includes(w) || (o.value || '').toLowerCase().includes(w))
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
          let node = el;
          for (let d = 0; d < 7 && node; d++, node = node.parentElement) {
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
          const wantYes = /^(yes|oui|y|true|1)$/i.test(want);
          const wantNo = /^(no|non|n|false|0)$/i.test(want);
          let hit = pool.find((o) => textOf(o).toLowerCase() === want || (o.value || '').toLowerCase() === want);
          if (!hit && wantYes) {
            hit = pool.find((o) => /^(yes|oui)\b/i.test(labelOf(o)) || o.getAttribute?.('data-option') === 'yes');
          }
          if (!hit && wantNo) {
            hit = pool.find((o) => (/^(no|non)\b/i.test(labelOf(o)) && !/^non-?binary/i.test(labelOf(o)) && !/^none\b/i.test(labelOf(o)))
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
          if (el.checked !== wantOn) el.click();
          const on = !!el.checked;
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
      const looksCombobox = strongCombobox
        || el.getAttribute('aria-autocomplete') === 'list'
        || el.getAttribute('aria-autocomplete') === 'both';
      if (looksCombobox) {
        const want = String(selectText || value || '');
        // An older bridge sends no typeQuery: then only place / organisation
        // lists may be searched.
        const typeQuery = u.typeQuery !== undefined
          ? String(u.typeQuery || '')
          : (/\b(city|ville|country|pays|location|localisation|school|universit\w*|college|company|employer)\b/i.test(u.label || '') ? filterQuery(want) : '');
        const res = await selectComboboxOption(el, want, {
          alternates: Array.isArray(u.alternates) ? u.alternates : [],
          typeQuery,
          prefer: preferRe(u),
          rank: rankRes(u),
          label: u.label || '',
          many: Array.isArray(u.selectMany) ? u.selectMany : [],
          budgetMs: 9000 + (Array.isArray(u.selectMany) ? u.selectMany.length * 1200 : 0),
        });
        if (res.picked) {
          results.push({ i, frameId, ok: true, actualValue: res.picked });
          continue;
        }
        if (strongCombobox) {
          // Closed-option widget: typed text is never a value. The trusted
          // CDP retry only helps when the list stayed shut or the click did
          // not stick — options that were on screen and did not match will
          // not match any better.
          const seen = res.options.slice(0, 12).join(' | ');
          let reason = `option introuvable — liste non ouverte pour « ${want} »`;
          if (res.clicked) reason = `option introuvable — « ${res.clicked} » cliquée mais non retenue`;
          else if (res.listOpened) reason = `option introuvable pour « ${want} »${seen ? ` (liste : ${seen})` : ''}`;
          else if (res.typed) reason = `option introuvable — aucun résultat pour « ${typeQuery} »`;
          results.push({
            i,
            frameId,
            ok: false,
            reason,
            cdpRetry: !!res.clicked || !res.listOpened,
            want,
            typeQuery,
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
  return outcomes;
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
async function fillComboboxViaCdp(tabId, { i, frameId = 0, want, alternates = [], typeQuery = '' }) {
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
  const query = /^(yes|oui|y|true|no|non|n|false)$/i.test(norm(want)) ? '' : norm(typeQuery).slice(0, 40);
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
    const PLACEHOLDER = /^(select\\b|choose\\b|--|please\\b|s[ée]lectionn|aucun|loading|searching|chargement|recherche|no options|no results|aucun r[ée]sultat|start typing|type to search)/i;
    const SEL = '[role="option"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="treeitem"], [id*="-option-"], [part="option"], [class*="select__option"], [class*="SelectOption"], [class*="Select-option"], li[class*="option"], [class*="-menu"] li, [class*="menuList" i] > *, [class*="menu-list" i] > *, [class*="MuiMenuItem"], [class*="MuiAutocomplete-option"], [class*="ant-select-item-option"], mat-option, .ng-option, [cmdk-item], [data-radix-collection-item], [data-highlighted], [class*="dropdown-item" i], [class*="DropdownMenuItem" i], .select2-results__option, [class*="select2-results__option"], .choices__item--choice, .vs__dropdown-option, .el-select-dropdown__item, [class*="el-select-dropdown__item"], [data-automation-id*="promptOption" i], [data-automation-id*="option" i], spl-option, oc-option, [class*="spl-option" i], [class*="v-list-item" i], [role="listbox"] li, .pac-item, [class*="-option" i], [class*="menu-item" i]';
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
      if (owned.length) {
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
      const kind = /^(yes|oui|y|true)$/i.test(want) ? 'yes' : /^(no|non|n|false)$/i.test(want) ? 'no' : null;
      if (kind === 'yes' && /^(yes|oui)\\b/i.test(t) && !/^(no|non)\\b/i.test(t)) return 90;
      if (kind === 'no' && /^(no|non)\\b/i.test(t) && !/^non-?binary\\b/i.test(t) && !/^none\\b/i.test(t)) return 90;
      if (kind) return 0;
      if (wLow.length >= 4 && (low.includes(wLow) || (low.length >= 4 && wLow.includes(low)))) return 55;
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
      hit = cands[0];
      best = 50;
    }
    if (!hit || best < 50) return { ok: false, count: cands.length, seen: cands.slice(0, 8).map((n) => norm(n.innerText).slice(0, 40)) };
    const r = hit.getBoundingClientRect();
    return { ok: true, text: norm(hit.innerText || (hit.getAttribute && hit.getAttribute('aria-label'))), x: r.x, y: r.y, width: r.width, height: r.height, count: cands.length };
  })()`;

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
    const cleanup = async () => {
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

    let option = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      for (const session of [fieldSession, ...sessions.filter((s) => s !== fieldSession)]) {
        const found = await evalInSession(session, optionRectFn(typed));
        if (found?.ok && found.width > 0) {
          option = { session, ...found };
          break;
        }
      }
      if (option) break;
      // Search lists only: the server's query, never the answer.
      if (attempt === 1 && query.length >= 2 && !typed) {
        await evalInSession(fieldSession, `(() => { ${FIND_FIELD} if (field) field.focus(); return !!field; })()`);
        for (const ch of query) {
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
        continue;
      }
      await sleep(typed ? 400 : 200);
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
    return { ok: false, error: String(err?.message || err) };
  } finally {
    chrome.debugger.onEvent.removeListener(onEvent);
    if (attached) {
      try { await chrome.debugger.detach(target); } catch { /* ignore */ }
    }
  }
}

connect();
