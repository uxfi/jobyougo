/**
 * page-helper-registry.mjs — the in-page functions the bridge may run by name
 * (extension message 'page-helper'), and how their per-frame results combine.
 *
 * The bridge used to send function SOURCE, run in the tab's isolated world
 * with `new Function` — which MV3's CSP forbids ('unsafe-eval'). Every probe,
 * autofill snapshot and button listing silently came back empty. These are
 * real functions that chrome.scripting serializes itself, and only the names
 * listed here can run: the bridge never sends code.
 *
 * Copies of lib functions come from page-helpers.mjs (generated). The
 * bridge-only helpers below have no lib counterpart. No chrome.* here, so
 * tests can import this module.
 */

import {
  APPLICATION_FORM_PROBE,
  LIST_VISIBLE_NAV_BUTTONS,
  PAGE_SHOWS_APPLY_ENTRY,
  PAGE_STEP_SNAPSHOT,
  snapshotIdentityFields,
} from './page-helpers.mjs';

/** Visible, enabled control labels: the wizard's Next / Submit / Review. */
export function listActionLabelsInPage() {
  const deep = (root, sel) => {
    const out = [];
    const walk = (n) => {
      if (!n || !n.querySelectorAll) return;
      try { out.push(...n.querySelectorAll(sel)); } catch { /* invalid in this root */ }
      for (const el of n.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot);
    };
    walk(root);
    return out;
  };
  const disabled = (el) => !!(el.disabled || el.getAttribute('aria-disabled') === 'true'
    || (el.closest && el.closest('[disabled],[aria-disabled="true"],[inert]')));
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 5 && r.height > 5;
  };
  const label = (el) => String(el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || '')
    .replace(/\s+/g, ' ').trim();
  const labels = [];
  for (const el of deep(document, 'a, button, [role="button"], input[type="submit"], input[type="button"]')) {
    if (disabled(el) || !visible(el)) continue;
    const t = label(el);
    if (!t || t.length > 80) continue;
    labels.push(t);
  }
  return [...new Set(labels)].slice(0, 40);
}

/**
 * Ashby sometimes hides the resume input so hard that COLLECT_FIELDS misses
 * it: stamp the likeliest raw file input so the upload can still target it.
 * The frame is filled in by the 'first-with-frame' merge.
 */
export function forceResumeSlotInPage() {
  const deep = (root, sel) => {
    const out = [];
    const walk = (n) => {
      if (!n?.querySelectorAll) return;
      try { out.push(...n.querySelectorAll(sel)); } catch { /* invalid in this root */ }
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
    frameId: 0,
    fileCount: el.files?.length || 0,
    fileChip: el.files?.[0]?.name || '',
  };
}

/** Raw HTML + URL, so the bridge runs extractEmbeddedApplyUrl from lib itself. */
export function pageHtmlInPage() {
  return { html: document.documentElement.innerHTML, url: location.href };
}

// frames: 'main' (frame 0 only) or 'all'. merge: see mergeFrameResults.
// Main-frame-only helpers match what apply-runner evaluates (page.evaluate).
export const PAGE_HELPERS = {
  APPLICATION_FORM_PROBE: { func: APPLICATION_FORM_PROBE, frames: 'all', merge: 'probe' },
  PAGE_SHOWS_APPLY_ENTRY: { func: PAGE_SHOWS_APPLY_ENTRY, frames: 'all', merge: 'any' },
  LIST_VISIBLE_NAV_BUTTONS: { func: LIST_VISIBLE_NAV_BUTTONS, frames: 'all', merge: 'concat', key: (b) => b?.text },
  PAGE_STEP_SNAPSHOT: { func: PAGE_STEP_SNAPSHOT, frames: 'main', merge: 'first' },
  IDENTITY_SNAPSHOT: { func: snapshotIdentityFields, frames: 'all', merge: 'concat' },
  ACTION_LABELS: { func: listActionLabelsInPage, frames: 'all', merge: 'concat', key: (t) => t, limit: 40 },
  FORCE_RESUME_SLOT: { func: forceResumeSlotInPage, frames: 'all', merge: 'first-with-frame' },
  PAGE_HTML: { func: pageHtmlInPage, frames: 'main', merge: 'first' },
};

const NO_PROBE = { verdict: 'none', score: 0, signals: [], blockers: [] };

/**
 * Combine chrome.scripting results ({ frameId, result }[]) into one answer.
 * The main frame comes first; subframe order from Chrome is not stable. A
 * frame whose script threw reports null and is skipped.
 *
 *   probe             application_form wins, then auth_wall, then top score
 *   any               true when any frame returned true
 *   concat            arrays joined, de-duplicated by `key`, capped at `limit`
 *   first             the first frame's result
 *   first-with-frame  the first result, tagged with the frame it came from
 */
export function mergeFrameResults(spec, entries = []) {
  const rows = (entries || [])
    .filter((e) => e && e.result != null)
    .sort((a, b) => (a.frameId ?? 0) - (b.frameId ?? 0));
  switch (spec?.merge) {
    case 'probe': {
      let best = NO_PROBE;
      for (const { result: probe } of rows) {
        if (probe.verdict === 'application_form') return probe;
        if (probe.verdict === 'auth_wall' && best.verdict === 'none') best = probe;
        if ((probe.score || 0) > (best.score || 0)) best = probe;
      }
      return best;
    }
    case 'any':
      return rows.some((r) => r.result === true);
    case 'concat': {
      const out = [];
      const seen = new Set();
      for (const { result } of rows) {
        for (const item of Array.isArray(result) ? result : []) {
          const k = spec.key ? spec.key(item) : undefined;
          if (k !== undefined) {
            if (seen.has(k)) continue;
            seen.add(k);
          }
          out.push(item);
          if (spec.limit && out.length >= spec.limit) return out;
        }
      }
      return out;
    }
    case 'first-with-frame':
      return rows.length ? { ...rows[0].result, frameId: rows[0].frameId ?? 0 } : null;
    default:
      return rows.length ? rows[0].result : null;
  }
}
