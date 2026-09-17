/**
 * In-page combobox helpers. Self-contained for frame.evaluate() — Playwright
 * cannot close over sibling functions, so snapshot and match share one entry.
 *
 * mode: 'snapshot' → { count, sig }
 * mode: 'match'    → { matched, count, seen } and stamps data-co-match="1"
 *
 * data-co-match is deliberately its own attribute, distinct from the
 * data-co-opt radio-group markers stamped in apply-collect-fields.mjs: this
 * function clears every data-co-match in the page before re-stamping, and
 * sharing the name with those markers used to wipe them out mid-fill,
 * leaving later nameless radio groups impossible to locate.
 */
export function COMBOBOX_OPTION_QUERY({ mode, i, want, allowGlobal }) {
  const PLACEHOLDER = /^(select\b|choose\b|--|please\b|s[ée]lectionn|aucun|loading|searching|chargement|recherche|no options|no results|aucun r[ée]sultat|start typing|type to search)/i;
  // .pac-item: Google Places Autocomplete's suggestion rows — the widget
  // behind most "City"/"Location"/"Address" fields (Lever, Greenhouse…). It
  // predates ARIA and carries no role/aria-* markers, so without this the
  // dropdown was invisible to option-detection: the field fell through to
  // plain keystroke typing, which fills the VISIBLE text but never fires the
  // widget's own selection handler, leaving the underlying required value
  // (and the field's native validity) unset — "Please fill out this field"
  // on a field that looked filled.
  const SEL = '[role="option"], [id*="-option-"], [class*="select__option"], li[class*="option"], [class*="-menu"] li, [class*="menuList" i] > *, [class*="menu-list" i] > *, .pac-item';
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const isPh = (t) => PLACEHOLDER.test(t);
  const el = document.querySelector(`[data-co-i="${i}"]`);
  let cands = [...document.querySelectorAll(SEL)]
    .filter(n => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && norm(n.innerText); });
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
      const near = cands.filter(n => {
        const b = n.getBoundingClientRect();
        return b.top >= r.top - 16 && b.top <= r.bottom + 420
          && b.left < r.right + 80 && b.right > r.left - 80;
      });
      cands = near.length || !allowGlobal ? near : all;
    }
  }
  const real = cands.filter(n => !isPh(norm(n.innerText)));
  if (mode === 'list') {
    return { count: real.length, texts: real.map(n => norm(n.innerText).slice(0, 120)) };
  }
  if (mode !== 'match') {
    const texts = real.map(n => norm(n.innerText).slice(0, 80));
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
  const scoreOf = (n) => {
    const t = norm(n.innerText);
    const low = t.toLowerCase();
    if (!t) return 0;
    if (low === wLow) return 100;
    if (kind === 'yes' && yesHead.test(t) && !noHead.test(t)) return 90;
    if (kind === 'no' && noHead.test(t) && !/^non-?binary\b/i.test(t) && !/^none\b/i.test(t)) return 90;
    if (kind) return 0;
    if (raw.length >= 2) {
      const bounded = new RegExp(`(^|\\W)${raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\W|$)`, 'i');
      if (bounded.test(t)) return raw.length >= 4 ? 70 : 55;
    }
    if (wLow.length >= 4 && (low.includes(wLow) || (low.length >= 4 && wLow.includes(low)))) return 40;
    return 0;
  };
  let idx = -1;
  let best = 0;
  for (let i = 0; i < cands.length; i++) {
    const s = scoreOf(cands[i]);
    if (s > best) { best = s; idx = i; }
  }
  const seen = cands.map(n => norm(n.innerText).slice(0, 30));
  if (idx < 0 || best < 50) return { matched: null, count: real.length, seen };
  cands[idx].setAttribute('data-co-match', '1');
  return { matched: norm(cands[idx].innerText).slice(0, 80), count: real.length, seen };
}
