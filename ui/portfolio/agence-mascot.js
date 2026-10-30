/* v2 studio (/agence): the mascot, an ink sprite. 2026-10-18.
   The drawing and its CSS states (wink on hover, squash on press) live in agence.html / agence/page.html and
   agence-story.css. The nav logo is the original; the contact dock (bottom right) gets a copy of that same
   drawing, made here, so the two are always the same mascot. This script adds what CSS cannot, to both:
   - their eyes follow the pointer (fine pointers only);
   - they blink every few seconds, at an irregular pace, together;
   - the easter egg: rub the pointer back and forth over the logo or the dock mascot, or tap the logo three
     times, and it purrs (happy eyes, blush, a hop, three hearts). The console tells curious visitors about it.
   The mascot is decorative (aria-hidden), so nothing here changes what the logo link or the dock button does.
   Under prefers-reduced-motion the eyes stay still and it never blinks on its own; petting still shows the
   happy face. */
(function () {
  'use strict';

  const d = document;
  const logo = d.querySelector('.nav .wordmark');
  const svg = logo && logo.querySelector('.mascot');
  if (!svg) return;
  const reducedMq = window.matchMedia('(prefers-reduced-motion: reduce)');
  const fineMq = window.matchMedia('(hover: hover) and (pointer: fine)');
  const PET_MS = 2400;

  /* ── The dock's mascot: the logo's SVG, copied, with its ids renamed so its gradients and clips stay its own.
     The <img> it replaces is the fallback without JavaScript. ── */
  const dockFab = d.getElementById('dock-fab');
  function copyIntoDock() {
    if (!dockFab) return null;
    const copy = svg.cloneNode(true);
    copy.querySelectorAll('[id]').forEach((el) => { el.id += '-dock'; });
    copy.querySelectorAll('*').forEach((el) => {
      for (const name of ['fill', 'stroke', 'clip-path', 'mask', 'filter']) {
        const v = el.getAttribute(name);
        if (v && v.includes('url(#')) el.setAttribute(name, v.replace(/url\(#([^)]+)\)/g, 'url(#$1-dock)'));
      }
    });
    copy.removeAttribute('width');
    copy.removeAttribute('height');
    const img = dockFab.querySelector('img');
    if (img) img.replaceWith(copy);
    else dockFab.prepend(copy);
    return copy;
  }
  const mascots = [svg, copyIntoDock()].filter(Boolean);
  const each = (fn) => mascots.forEach(fn);

  /* ── Eyes: look toward the pointer, at most 2 units sideways and 1.4 up or down (the face is 25 wide) ── */
  const boxes = new Map();
  let raf = 0;
  let px = 0;
  let py = 0;
  function setLook(m, x, y) {
    m.style.setProperty('--ex', x.toFixed(2));
    m.style.setProperty('--ey', y.toFixed(2));
  }
  function look() {
    raf = 0;
    each((m) => {
      // The nav and the dock are fixed, so a mascot only moves when the window is resized.
      let box = boxes.get(m);
      if (!box || !box.width) { box = m.getBoundingClientRect(); boxes.set(m, box); }
      const dx = px - (box.left + box.width * 0.51); // the face centre sits at x 32.5 of 64
      const dy = py - (box.top + box.height * 0.5);
      const dist = Math.hypot(dx, dy) || 1;
      const reach = Math.min(1, dist / 120); // a pointer right on the face gets a softer look
      setLook(m, (dx / dist) * 2 * reach, (dy / dist) * 1.4 * reach);
    });
  }
  window.addEventListener('pointermove', (e) => {
    if (!fineMq.matches || reducedMq.matches || e.pointerType === 'touch') return;
    px = e.clientX;
    py = e.clientY;
    if (!raf) raf = requestAnimationFrame(look);
  }, { passive: true });
  d.documentElement.addEventListener('pointerleave', () => each((m) => setLook(m, 0, 0)));
  window.addEventListener('resize', () => boxes.clear(), { passive: true });
  reducedMq.addEventListener('change', () => { if (reducedMq.matches) each((m) => setLook(m, 0, 0)); });

  /* ── Blink: every 2.8 to 7 s, now and then twice ── */
  function blink(then) {
    each((m) => m.classList.add('is-blink'));
    setTimeout(() => { each((m) => m.classList.remove('is-blink')); if (then) setTimeout(then, 140); }, 130);
  }
  function scheduleBlink() {
    setTimeout(() => {
      if (!reducedMq.matches && !d.hidden && !svg.classList.contains('is-petted')) {
        blink(Math.random() < 0.25 ? () => blink() : null);
      }
      scheduleBlink();
    }, 2800 + Math.random() * 4200);
  }
  scheduleBlink();

  /* ── The easter egg: petting ── */
  let petT = 0;
  function pet() {
    if (svg.classList.contains('is-petted')) return;
    each((m) => m.classList.add('is-petted'));
    clearTimeout(petT);
    petT = setTimeout(() => each((m) => m.classList.remove('is-petted')), PET_MS);
  }
  // Rubbing: four changes of horizontal direction within 1.2 s while the pointer is over the mascot.
  function rubbable(el) {
    let lastX = null;
    let dir = 0;
    let flips = [];
    el.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      if (lastX === null) { lastX = e.clientX; return; }
      const dx = e.clientX - lastX;
      if (Math.abs(dx) < 3) return;
      lastX = e.clientX;
      const nd = Math.sign(dx);
      if (dir && nd !== dir) {
        const now = performance.now();
        flips = flips.filter((t) => now - t < 1200);
        flips.push(now);
        if (flips.length >= 4) { flips = []; pet(); }
      }
      dir = nd;
    });
    el.addEventListener('pointerleave', () => { lastX = null; dir = 0; flips = []; });
  }
  rubbable(logo);
  if (dockFab && mascots.length > 1) rubbable(dockFab);
  // Three clicks or taps within 0.9 s on the logo. The link still does its job (back to the top on the home
  // page). The dock mascot opens its bubbles on a tap, so it is petted by rubbing only.
  let taps = [];
  logo.addEventListener('click', () => {
    const now = performance.now();
    taps = taps.filter((t) => now - t < 900);
    taps.push(now);
    if (taps.length >= 3) { taps = []; pet(); }
  });

  // For later moments that deserve a happy mascot (an order sent, for instance).
  window.agenceMascot = { pet, blink: () => blink() };

  try {
    console.log('%c(•ᴗ•)%c  Hello, curious one. The ink sprite in the corner likes to be petted: rub it, or tap it three times.',
      'font: 600 14px system-ui, sans-serif; color: #6eb4ef', 'font: 13px system-ui, sans-serif');
  } catch (e) { /* no console */ }
})();
