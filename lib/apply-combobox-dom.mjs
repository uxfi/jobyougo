/**
 * In-page combobox helpers. Self-contained for frame.evaluate() — Playwright
 * serializes this function; pass `sel` in the argument object (do not close
 * over module imports). apply-runner always sends COMBOBOX_OPTION_SEL.
 *
 * mode: 'snapshot' → { count, sig }
 * mode: 'list'     → { count, texts }
 * mode: 'match'    → { matched, count, seen } and stamps data-co-match="1"
 */
import { COMBOBOX_OPTION_SEL } from './apply-combobox-sel.mjs';

export { COMBOBOX_OPTION_SEL, COMBOBOX_OPTION_SEL_PARTS, COMBOBOX_WRAPPER_SEL } from './apply-combobox-sel.mjs';

export function COMBOBOX_OPTION_QUERY({ mode, i, want, allowGlobal, sel }) {
  const PLACEHOLDER = /^(select\b|choose\b|--|please\b|s[ée]lectionn|aucun|loading|searching|chargement|recherche|no options|no results|aucun r[ée]sultat|start typing|type to search)/i;
  // Prefer caller-supplied sel (injected via evaluate args). Fallback string is
  // a minimal safety net if a call site forgets — keep apply-combobox-sel.mjs
  // as the source of truth for the full list.
  const SEL = sel || '[role="option"], [role="menuitem"], [role="menuitemradio"], [id*="-option-"], [class*="select__option"], li[class*="option"], [class*="-menu"] li, [class*="MuiMenuItem"], [class*="MuiAutocomplete-option"], [class*="ant-select-item-option"], mat-option, .select2-results__option, .el-select-dropdown__item, [data-automation-id*="promptOption" i], .pac-item, [class*="-option" i], [class*="menu-item" i], [role="listbox"] li';
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const labelOf = (n) => norm(n.innerText || n.getAttribute?.('aria-label') || n.getAttribute?.('title') || '');
  const isPh = (t) => PLACEHOLDER.test(t);
  const deepQueryAll = (root, selector) => {
    const out = [];
    const visit = (node) => {
      if (!node?.querySelectorAll) return;
      try { out.push(...node.querySelectorAll(selector)); } catch { /* bad sel in shadow */ }
      for (const el of node.querySelectorAll('*')) {
        if (el.shadowRoot) visit(el.shadowRoot);
      }
    };
    visit(root);
    return out;
  };
  const el = document.querySelector(`[data-co-i="${i}"]`);
  let cands = deepQueryAll(document, SEL)
    .filter(n => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && labelOf(n); });
  cands = cands.filter(n => !cands.some(o => o !== n && n.contains(o)));
  const all = cands;
  if (el) {
    const ids = `${el.getAttribute('aria-controls') || ''} ${el.getAttribute('aria-owns') || ''}`.trim().split(/\s+/).filter(Boolean);
    const boxes = ids.map(id => document.getElementById(id)).filter(Boolean);
    const owned = boxes.length ? cands.filter(n => boxes.some(b => b.contains(n))) : [];
    if (owned.length) {
      cands = owned;
    } else {
      const r = el.getBoundingClientRect();
      // Symmetric above/below — menus flip upward near the bottom of long forms.
      const near = cands.filter(n => {
        const b = n.getBoundingClientRect();
        return b.top >= r.top - 420 && b.top <= r.bottom + 420
          && b.left < r.right + 80 && b.right > r.left - 80;
      });
      cands = near.length || !allowGlobal ? near : all;
    }
  }
  const real = cands.filter(n => !isPh(labelOf(n)));
  if (mode === 'list') {
    return { count: real.length, texts: real.map(n => labelOf(n).slice(0, 120)) };
  }
  if (mode !== 'match') {
    const texts = real.map(n => labelOf(n).slice(0, 80));
    const top = real[0] ? Math.round(real[0].getBoundingClientRect().top) : 0;
    return { count: real.length, sig: `${texts.join('\0')}@${top}` };
  }
  document.querySelectorAll('[data-co-match]').forEach(e => e.removeAttribute('data-co-match'));
  if (!cands.length) return { matched: null, count: 0 };
  const raw = norm(want);
  const wLow = raw.toLowerCase();
  const yesHead = /^(yes|oui|y|yeah|true)\b/i;
  const noHead = /^(no|non|n|false)\b/i;
  const kind = /^(yes|oui|y|true)$/i.test(raw) ? 'yes' : /^(no|non|n|false)$/i.test(raw) ? 'no' : null;
  // Compact country aliases (mirrors lib/apply-option-match.mjs) for when
  // match mode runs without a prior pickMatchingOption pass.
  const COUNTRY = {
    france: ['france', 'french republic', 'république française', 'republique francaise', 'fr'],
    thailand: ['thailand', 'thaïlande', 'thailande', 'th'],
    'united states': ['united states', 'usa', 'us', 'united states of america'],
    'united kingdom': ['united kingdom', 'uk', 'great britain', 'england'],
    germany: ['germany', 'deutschland', 'de'],
    singapore: ['singapore', 'sg'],
  };
  const countryHit = (optLow) => {
    for (const aliases of Object.values(COUNTRY)) {
      if (aliases.includes(wLow) && aliases.some(a => optLow === a || optLow.includes(a))) return true;
    }
    return false;
  };
  const scoreOf = (n) => {
    const t = labelOf(n);
    const low = t.toLowerCase();
    if (!t) return 0;
    if (low === wLow) return 100;
    if (kind === 'yes' && yesHead.test(t) && !noHead.test(t)) return 90;
    if (kind === 'no' && noHead.test(t) && !/^non-?binary\b/i.test(t) && !/^none\b/i.test(t)) return 90;
    if (kind) return 0;
    if (countryHit(low)) return 85;
    if (raw.length >= 2) {
      const bounded = new RegExp(`(^|\\W)${raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\W|$)`, 'i');
      if (bounded.test(t)) return raw.length >= 4 ? 70 : 55;
    }
    // Query longer than the option ("Senior Product Manager" → "Product Manager").
    // Word-bounded so "Male" does not hit "Female".
    if (low.length >= 4 && wLow.includes(low)) {
      const asWord = new RegExp(`(^|\\W)${low.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\W|$)`, 'i');
      if (asWord.test(raw)) return 55;
    }
    return 0;
  };
  let idx = -1;
  let best = 0;
  for (let i = 0; i < cands.length; i++) {
    const s = scoreOf(cands[i]);
    if (s > best) { best = s; idx = i; }
  }
  const seen = cands.map(n => labelOf(n).slice(0, 30));
  if (idx < 0 || best < 50) return { matched: null, count: real.length, seen };
  cands[idx].setAttribute('data-co-match', '1');
  return { matched: labelOf(cands[idx]).slice(0, 80), count: real.length, seen };
}

/** Convenience for Node-side calls that forget `sel`. */
export function comboboxQueryArgs(extra = {}) {
  return { sel: COMBOBOX_OPTION_SEL, ...extra };
}

// react-select, Downshift and MUI commit on mousedown of the option row.
// A real mouse move toward that row leaves the menu and closes it first,
// so the click never lands. Fire the events on the stamped node itself.
export function ACTIVATE_MATCHED_OPTION() {
  const el = document.querySelector('[data-co-match="1"]');
  if (!el) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  const opts = {
    bubbles: true,
    cancelable: true,
    view: window,
    button: 0,
    buttons: 1,
    clientX: r.left + r.width / 2,
    clientY: r.top + Math.min(r.height / 2, 12),
  };
  try { el.scrollIntoView({ block: 'nearest' }); } catch { /* already in view */ }
  const fire = (type, Ctor) => {
    try { el.dispatchEvent(new Ctor(type, opts)); } catch { /* PointerEvent unsupported */ }
  };
  fire('pointerdown', PointerEvent);
  fire('mousedown', MouseEvent);
  fire('pointerup', PointerEvent);
  fire('mouseup', MouseEvent);
  fire('click', MouseEvent);
  return true;
}

// Read what a custom list actually committed. Passed to frame.evaluate.
export function LIST_SELECTION_STATE({ i }) {
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const el = document.querySelector(`[data-co-i="${i}"]`);
  if (!el) return { inputValue: '', displayed: '', selectedOption: '', shadowValue: '', buttonText: '', expanded: null };
  let shadow = '';
  let root = el.parentElement;
  let node = el.parentElement;
  for (let d = 0; d < 6 && node; d++, node = node.parentElement) {
    const hit = node.querySelector('input[aria-hidden="true"][required], [class*="requiredInput" i]');
    if (hit) { shadow = hit.value || ''; root = node; break; }
    if (node.querySelector('[class*="singleValue" i], [class*="single-value" i]')) root = node;
  }
  const shownEl = root?.querySelector?.('[class*="singleValue" i], [class*="single-value" i]');
  const activeId = el.getAttribute('aria-activedescendant') || '';
  const active = activeId ? document.getElementById(activeId) : null;
  const selected = [...document.querySelectorAll('[role="option"][aria-selected="true"], [role="option"][aria-checked="true"]')]
    .find(n => {
      const r = n.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
  const selectedOption = norm(
    (active && (active.getAttribute('role') === 'option' || active.getAttribute('aria-selected') === 'true') ? (active.innerText || '') : '')
    || selected?.innerText
    || '',
  );
  const popup = (el.getAttribute('aria-haspopup') || '').toLowerCase();
  const buttonText = (el.tagName === 'BUTTON' || popup === 'listbox' || popup === 'menu')
    ? norm(el.innerText || el.textContent || '')
    : '';
  const expandedAttr = el.getAttribute('aria-expanded');
  return {
    inputValue: norm(el.value || ''),
    displayed: shownEl ? norm(shownEl.textContent || '') : '',
    selectedOption,
    shadowValue: norm(shadow),
    buttonText,
    expanded: expandedAttr == null ? null : expandedAttr === 'true',
  };
}
