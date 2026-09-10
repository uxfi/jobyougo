/**
 * In-page combobox helpers. Self-contained for frame.evaluate() — Playwright
 * cannot close over sibling functions, so snapshot and match share one entry.
 *
 * mode: 'snapshot' → { count, sig }
 * mode: 'match'    → { matched, count, seen } and stamps data-co-opt="1"
 */
export function COMBOBOX_OPTION_QUERY({ mode, i, want, allowGlobal }) {
  const PLACEHOLDER = /^(select\b|choose\b|--|please\b|s[ée]lectionn|aucun|loading|searching|chargement|recherche|no options|no results|aucun r[ée]sultat|start typing|type to search)/i;
  const SEL = '[role="option"], [id*="-option-"], [class*="select__option"], li[class*="option"], [class*="-menu"] li, [class*="menuList" i] > *, [class*="menu-list" i] > *';
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
  if (mode !== 'match') {
    const texts = real.map(n => norm(n.innerText).slice(0, 80));
    const top = real[0] ? Math.round(real[0].getBoundingClientRect().top) : 0;
    return { count: real.length, sig: `${texts.join('\0')}@${top}` };
  }
  document.querySelectorAll('[data-co-opt]').forEach(e => e.removeAttribute('data-co-opt'));
  if (!cands.length) return { matched: null, count: 0 };
  const w = norm(want).toLowerCase();
  const low = (n) => norm(n.innerText).toLowerCase();
  let idx = cands.findIndex(n => low(n) === w);
  if (idx < 0) idx = cands.findIndex(n => { const t = low(n); return !isPh(t) && t.includes(w); });
  if (idx < 0) idx = cands.findIndex(n => { const t = low(n); return t.length >= 4 && w.includes(t); });
  const seen = cands.map(n => norm(n.innerText).slice(0, 30));
  if (idx < 0) return { matched: null, count: real.length, seen };
  cands[idx].setAttribute('data-co-opt', '1');
  return { matched: norm(cands[idx].innerText).slice(0, 80), count: real.length, seen };
}
