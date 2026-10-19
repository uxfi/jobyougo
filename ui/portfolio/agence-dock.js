/* v2 studio (/agence): the contact dock, bottom right. 2026-10-18.
   The mascot opens four bubbles around it: the assistant (the bubble keeps id="chat-toggle", so agence-story.js
   still opens and closes the chat), a 30-min call on Calendly, LinkedIn, and the project form (data-offer, also
   handled by agence-story.js). This script only folds and unfolds them:
   - the mascot toggles the bubbles; while the assistant is open, it closes the assistant instead;
   - picking a bubble, Escape, or a press anywhere else folds them back;
   - when the assistant closes, focus returns to the mascot (its own bubble is folded away by then);
   - the dock shows only over the sections with a background video (.is-over-video), and while it is open,
     the assistant is open or it has focus (agence-story.css). The mascot drawing is the nav logo's, copied
     in by agence-mascot.js. */
(function () {
  'use strict';

  const d = document;
  const dock = d.getElementById('dock');
  const fab = d.getElementById('dock-fab');
  const menu = d.getElementById('dock-menu');
  if (!dock || !fab || !menu) return;
  const chatToggle = d.getElementById('chat-toggle');
  const chat = d.getElementById('chat');

  // Copy from agence-i18n.js through agT (agence-data.js), machine-translated for other languages.
  const label = (key, fallback) => {
    const v = typeof agT === 'function' ? agT(key, (window.SITE && SITE.initialLang) || 'en') : '';
    return v || fallback;
  };
  const isOpen = () => dock.classList.contains('is-open');
  const chatOpen = () => !!(chat && !chat.hidden);

  function setOpen(open, focusFab) {
    dock.classList.toggle('is-open', open);
    fab.setAttribute('aria-expanded', open ? 'true' : 'false');
    fab.setAttribute('aria-label', open ? label('dock_close_aria', 'Close the contact options') : label('dock_open_aria', 'Contact options'));
    if (!open && focusFab) fab.focus({ preventScroll: true });
  }

  fab.addEventListener('click', () => {
    if (chatOpen() && chatToggle) { chatToggle.click(); return; }
    setOpen(!isOpen());
  });
  // Any choice folds the bubbles back; the bubble's own action (chat, link, form) still runs.
  menu.addEventListener('click', (e) => { if (e.target.closest('.dock-item')) setOpen(false); });
  d.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen()) setOpen(false, true); });
  d.addEventListener('pointerdown', (e) => { if (isOpen() && !dock.contains(e.target)) setOpen(false); });

  if (chatToggle && chat) {
    new MutationObserver(() => {
      const open = chatToggle.getAttribute('aria-expanded') === 'true';
      dock.classList.toggle('is-chat', open);
      if (open) return;
      const a = d.activeElement;
      if (!a || a === d.body || menu.contains(a) || chat.contains(a)) fab.focus({ preventScroll: true });
    }).observe(chatToggle, { attributes: true, attributeFilter: ['aria-expanded'] });
  }

  /* Over a background video only: the scrubbed scenes (the hero dive, the fox atelier), not the reel's clips.
     The section behind the mascot is the last one, in page order, whose box spans the mascot's height: later
     sections paint over earlier ones. A dab cover (the scene after the hero) lies over the hero while still shut
     and opens through a growing dab; it counts once the dab holds half the screen (agence-story.js keeps that
     share in section._open). The sub-pages have no such section, so the dock stays folded away there. */
  const sections = [...d.querySelectorAll('main > section')];
  const withVideo = new Set(sections.filter((s) => s.querySelector('video.scrub')));
  let tick = 0;
  function checkBehind() {
    tick = 0;
    const box = dock.getBoundingClientRect();
    const y = box.top + box.height / 2;
    let behind = null;
    for (const s of sections) {
      if (s.hidden || s.classList.contains('is-shut')) continue;
      if (s.classList.contains('is-opening') && !(s._open >= 0.5)) continue;
      const r = s.getBoundingClientRect();
      if (r.height && r.top <= y && r.bottom > y) behind = s;
    }
    dock.classList.toggle('is-over-video', !!behind && withVideo.has(behind));
  }
  const queue = () => { if (!tick) tick = requestAnimationFrame(checkBehind); };
  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', queue, { passive: true });
  window.addEventListener('load', queue);
  checkBehind();
})();
