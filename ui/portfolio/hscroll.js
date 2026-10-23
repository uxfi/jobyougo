/* Horizontal scrollers: arrows instead of a scrollbar, drag with the mouse, swipe on touch.
   Every element matching SCROLLERS is enhanced once, including ones rendered later
   (case studies, testimonials and modals are built by JS). Arrows only show on devices
   with a mouse, and only on the side where there is more to see. DRAG_ONLY rows (tab
   strips) lose their scrollbar and get drag, without arrows. */
(() => {
  const SCROLLERS = [
    '.br-tear', '.br-dec-screens', '.proj-method-track', '.oa-states-row', '.gh-activity',
    '.voices-list', '.timeline-scroller', '.iface-phones-row', '[data-hscroll]',
  ].join(',');
  const DRAG_ONLY = '.br-tabs';
  const RM = matchMedia('(prefers-reduced-motion: reduce)');

  const css = `
    .hs, .hs-drag { scrollbar-width: none !important; }
    .hs::-webkit-scrollbar, .hs-drag::-webkit-scrollbar { display: none !important; }
    .hs-wrap { position: relative; min-width: 0; max-width: 100%; }
    .hs.is-grab, .hs-drag.is-grab { cursor: grab; }
    .hs.is-dragging, .hs-drag.is-dragging { cursor: grabbing; scroll-snap-type: none !important; user-select: none; }
    .hs.is-dragging *, .hs-drag.is-dragging * { pointer-events: none; }
    .hs-btn {
      position: absolute; top: 50%; z-index: 5; width: 42px; height: 42px; margin-top: -21px;
      display: grid; place-items: center; padding: 0; border: 0; border-radius: 50%; cursor: pointer;
      color: #fff; background: rgba(20,20,22,.72);
      -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
      box-shadow: 0 6px 18px rgba(0,0,0,.22), inset 0 0 0 1px rgba(255,255,255,.14);
      opacity: 0; pointer-events: none; transform: scale(.85);
      transition: opacity .2s ease, transform .3s cubic-bezier(.34,1.56,.64,1), background .2s;
    }
    .hs-btn svg { width: 18px; height: 18px; }
    .hs-btn:hover { background: rgba(20,20,22,.9); }
    .hs-btn:focus-visible { outline: 2px solid #fff; outline-offset: 2px; box-shadow: 0 0 0 4px rgba(0,0,0,.6); }
    .hs-btn.prev { left: 10px; } .hs-btn.next { right: 10px; }
    .hs-btn.on { opacity: 1; pointer-events: auto; transform: none; }
    @media (hover: none) { .hs-btn { display: none; } }
    /* the interface modal's phone row is a flex child: its wrapper takes its place */
    #iface-modal.mobile .hs-wrap:has(> .iface-phones-row) { flex: 1; min-height: 0; display: flex; flex-direction: column; }
    #iface-modal:not(.mobile) .hs-wrap:has(> .iface-phones-row) { display: none; }
    @media (prefers-reduced-motion: reduce) { .hs-btn { transition: none; } }
  `;
  const style = document.createElement('style');
  style.id = 'hscroll-css';
  style.textContent = css;
  document.head.appendChild(style);

  const ARROW = d => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  // mouse drag (touch keeps native swipe); a drag never fires the click underneath
  function dragify(el) {
    let st = null, moved = false;
    el.classList.add('is-grab');
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      if (e.target.closest('input, textarea, select, iframe, [contenteditable]')) return;
      st = { x: e.clientX, left: el.scrollLeft, t: performance.now(), v: 0, lx: e.clientX };
      moved = false;
    });
    window.addEventListener('pointermove', (e) => {
      if (!st) return;
      const dx = e.clientX - st.x;
      if (!moved && Math.abs(dx) < 6) return;
      if (!moved) { moved = true; el.classList.add('is-dragging'); }
      el.scrollLeft = st.left - dx;
      const now = performance.now();
      st.v = (e.clientX - st.lx) / Math.max(1, now - st.t); st.lx = e.clientX; st.t = now;
    });
    window.addEventListener('pointerup', () => {
      if (!st) return;
      const v = st.v; st = null;
      if (!moved) return;
      el.classList.remove('is-dragging');
      if (!RM.matches && Math.abs(v) > 0.3) el.scrollBy({ left: -v * 220, behavior: 'smooth' });
    });
    el.addEventListener('click', (e) => { if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; } }, true);
    el.addEventListener('dragstart', (e) => e.preventDefault());
  }

  function enhance(el) {
    if (el.dataset.hsReady) return;
    el.dataset.hsReady = '1';
    el.classList.add('hs');
    const wrap = document.createElement('div');
    wrap.className = 'hs-wrap';
    el.parentNode.insertBefore(wrap, el);
    wrap.appendChild(el);
    const mk = (cls, label, d) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = `hs-btn ${cls}`; b.setAttribute('aria-label', label); b.innerHTML = ARROW(d);
      wrap.appendChild(b);
      return b;
    };
    const prev = mk('prev', 'Scroll left', 'M15 5l-7 7 7 7');
    const next = mk('next', 'Scroll right', 'M9 5l7 7-7 7');
    const step = () => Math.max(160, el.clientWidth * 0.8);
    const go = dir => el.scrollBy({ left: dir * step(), behavior: RM.matches ? 'auto' : 'smooth' });
    prev.addEventListener('click', () => go(-1));
    next.addEventListener('click', () => go(1));
    const sync = () => {
      const max = el.scrollWidth - el.clientWidth;
      const scrollable = max > 4 && getComputedStyle(el).overflowX !== 'visible';
      prev.classList.toggle('on', scrollable && el.scrollLeft > 4);
      next.classList.toggle('on', scrollable && el.scrollLeft < max - 4);
    };
    el.addEventListener('scroll', sync, { passive: true });
    if ('ResizeObserver' in window) new ResizeObserver(sync).observe(el);
    // content arrives later (images, rendered rows), so resync when children change
    new MutationObserver(sync).observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    dragify(el);
    sync();
  }

  function scan(root) {
    if (!root.querySelectorAll) return;
    if (root.matches && root.matches(SCROLLERS)) enhance(root);
    root.querySelectorAll(SCROLLERS).forEach(enhance);
    const drags = [...root.querySelectorAll(DRAG_ONLY)];
    if (root.matches && root.matches(DRAG_ONLY)) drags.push(root);
    drags.forEach((el) => { if (!el.dataset.hsReady) { el.dataset.hsReady = '1'; el.classList.add('hs-drag'); dragify(el); } });
  }

  const start = () => {
    scan(document.body);
    new MutationObserver((muts) => muts.forEach(m => m.addedNodes.forEach(n => n.nodeType === 1 && scan(n))))
      .observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
