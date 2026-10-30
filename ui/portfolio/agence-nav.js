/* v2 studio (/agence): nav behaviour on top of agence-story.js (which owns .is-solid, .on-light, the burger
   and the current page). 2026-10-18.
   - Hover pill: one soft pill glides between the links instead of each link lighting up on its own.
   - "Start a project" leans a few pixels toward the pointer (fine pointers only).
   - Past the hero, scrolling down tucks the bar away and any scroll up brings it back. It stays put while the
     menu is open, while keyboard focus is inside it, when the pointer reaches the top edge, and under
     prefers-reduced-motion.
   - Mobile menu: a tap outside closes it, and so does its own "Start a project" button. */
(function () {
  'use strict';

  const d = document;
  const nav = d.getElementById('nav');
  if (!nav) return;
  const reducedMq = window.matchMedia('(prefers-reduced-motion: reduce)');
  const fineMq = window.matchMedia('(hover: hover) and (pointer: fine)');
  const burger = nav.querySelector('.nav-burger');

  /* ── Hover pill ── */
  const links = nav.querySelector('.nav-links');
  if (links) {
    const pill = d.createElement('span');
    pill.className = 'nav-pill';
    pill.setAttribute('aria-hidden', 'true');
    links.appendChild(pill); // last, so the links keep their nth-child stagger in the mobile menu
    const place = (a) => {
      // Appearing: jump to the link and only fade in. Already shown: glide over.
      const fresh = !pill.classList.contains('is-on');
      if (fresh) pill.style.transitionProperty = 'opacity';
      pill.style.setProperty('--x', a.offsetLeft + 'px');
      pill.style.setProperty('--w', a.offsetWidth + 'px');
      if (fresh) { void pill.offsetWidth; pill.style.transitionProperty = ''; }
      pill.classList.add('is-on');
    };
    links.addEventListener('pointerover', (e) => {
      const a = e.target.closest('a');
      if (a && links.contains(a) && !nav.classList.contains('is-open')) place(a);
    });
    links.addEventListener('pointerleave', () => pill.classList.remove('is-on'));
    links.addEventListener('focusin', (e) => {
      const a = e.target.closest('a');
      if (a && a.matches(':focus-visible') && !nav.classList.contains('is-open')) place(a);
    });
    links.addEventListener('focusout', (e) => { if (!links.contains(e.relatedTarget)) pill.classList.remove('is-on'); });
  }

  /* ── Magnetic call to action: at most 4 px sideways, 2.5 px up or down ── */
  const cta = nav.querySelector('.nav-cta');
  if (cta) {
    cta.addEventListener('pointermove', (e) => {
      if (!fineMq.matches || reducedMq.matches || e.pointerType === 'touch') return;
      const r = cta.getBoundingClientRect();
      const mx = ((e.clientX - (r.left + r.width / 2)) / (r.width / 2)) * 4;
      const my = ((e.clientY - (r.top + r.height / 2)) / (r.height / 2)) * 2.5;
      cta.style.setProperty('--mx', Math.max(-4, Math.min(4, mx)).toFixed(1) + 'px');
      cta.style.setProperty('--my', Math.max(-2.5, Math.min(2.5, my)).toFixed(1) + 'px');
    });
    cta.addEventListener('pointerleave', () => {
      cta.style.removeProperty('--mx');
      cta.style.removeProperty('--my');
    });
  }

  /* ── Hide on scroll down, show on scroll up ── */
  const HIDE_AFTER = 28; // px of continuous downward scroll
  const SHOW_AFTER = 6; // px of upward scroll
  const TOP_ZONE = 90; // px: a pointer this close to the top edge keeps the bar out
  let lastY = Math.max(0, window.scrollY || 0);
  let run = 0;
  let ticking = false;
  let pointerAtTop = false;
  function setHidden(on) {
    if (nav.classList.contains('is-hidden') !== on) nav.classList.toggle('is-hidden', on);
  }
  function update() {
    ticking = false;
    const y = Math.max(0, window.scrollY || 0);
    const dy = y - lastY;
    lastY = y;
    if (!dy) return;
    if ((dy > 0) !== (run > 0)) run = 0;
    run += dy;
    const canHide = d.body.classList.contains('past-hero') && y > 140
      && !nav.classList.contains('is-open') && !nav.querySelector(':focus-visible')
      && !pointerAtTop && !reducedMq.matches;
    if (!canHide || run < -SHOW_AFTER) setHidden(false);
    else if (run > HIDE_AFTER) setHidden(true);
  }
  window.addEventListener('scroll', () => {
    if (!ticking) { ticking = true; requestAnimationFrame(update); }
  }, { passive: true });
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    pointerAtTop = e.clientY < TOP_ZONE;
    if (pointerAtTop) setHidden(false);
  }, { passive: true });
  nav.addEventListener('focusin', () => setHidden(false));
  reducedMq.addEventListener('change', () => { if (reducedMq.matches) setHidden(false); });

  /* ── Mobile menu ── */
  function closeMenu() {
    if (!nav.classList.contains('is-open')) return;
    nav.classList.remove('is-open');
    if (burger) burger.setAttribute('aria-expanded', 'false');
  }
  d.addEventListener('pointerdown', (e) => {
    if (nav.classList.contains('is-open') && !nav.contains(e.target)) closeMenu();
  });
  // The menu's own button opens the project form (agence-story.js); the menu folds away behind it.
  nav.addEventListener('click', (e) => { if (e.target.closest('.nav-menu-cta')) closeMenu(); });

  /* ── Language switch (2026-10-27) ──
     The server already picks the language (?lang=, cookie, browser, country; lib/agence-i18n.mjs). This menu lets a
     visitor choose: every row is a plain link to the same page with ?lang=<code>, so it works without script, search
     engines can follow it, and the server remembers the choice in a cookie. "Automatic" (?lang=auto) forgets it.
     Arrow keys, Home/End and Esc work; a tap outside, a scroll or leaving the menu with Tab closes it. */
  const LANGS = [
    ['en', 'English'], ['fr', 'Français'], ['es', 'Español'], ['de', 'Deutsch'], ['it', 'Italiano'], ['pt-BR', 'Português (Brasil)'],
    ['pt-PT', 'Português (Portugal)'], ['nl', 'Nederlands'], ['pl', 'Polski'], ['sv', 'Svenska'], ['da', 'Dansk'], ['nb', 'Norsk bokmål'],
    ['fi', 'Suomi'], ['cs', 'Čeština'], ['sk', 'Slovenčina'], ['ro', 'Română'], ['hu', 'Magyar'], ['el', 'Ελληνικά'], ['bg', 'Български'],
    ['hr', 'Hrvatski'], ['sl', 'Slovenščina'], ['lt', 'Lietuvių'], ['lv', 'Latviešu'], ['et', 'Eesti'], ['uk', 'Українська'],
    ['ru', 'Русский'], ['tr', 'Türkçe'], ['ar', 'العربية'], ['he', 'עברית'], ['fa', 'فارسی'], ['hi', 'हिन्दी'], ['bn', 'বাংলা'],
    ['id', 'Bahasa Indonesia'], ['ms', 'Bahasa Melayu'], ['th', 'ไทย'], ['vi', 'Tiếng Việt'], ['ja', '日本語'], ['ko', '한국어'],
    ['zh-Hans', '简体中文'], ['zh-Hant', '繁體中文'], ['ca', 'Català'],
  ];
  const lang = nav.querySelector('.nav-lang');
  const langBtn = lang && lang.querySelector('.nav-lang-btn');
  if (lang && langBtn) {
    const current = String((window.AG_I18N && window.AG_I18N.code) || d.documentElement.lang || 'en');
    const codeEl = langBtn.querySelector('.nav-lang-code');
    if (codeEl) codeEl.textContent = current.split('-')[0].toUpperCase();
    const href = (code) => {
      try {
        const u = new URL(window.location.href);
        u.searchParams.set('lang', code);
        return u.pathname + u.search + u.hash;
      } catch (e) {
        return '?lang=' + encodeURIComponent(code);
      }
    };
    const menu = d.createElement('div');
    menu.className = 'nav-lang-menu';
    menu.id = 'nav-lang-menu';
    menu.hidden = true;
    const row = (code, label, extra) => `<a href="${href(code)}" lang="${code === 'auto' ? '' : code}"${code === 'auto' ? '' : ` hreflang="${code}"`} rel="alternate nofollow"${code === current ? ' aria-current="true"' : ''}>${extra || ''}<span>${label}</span>${code === current ? '<i aria-hidden="true"></i>' : ''}</a>`;
    menu.innerHTML = row('auto', langBtn.dataset.auto || 'Automatic', '')
      + `<hr>` + LANGS.map(([c, n]) => row(c, n)).join('');
    lang.appendChild(menu);
    const items = () => Array.from(menu.querySelectorAll('a'));
    const setOpen = (open, focusItem) => {
      if (open === !menu.hidden) return;
      if (open) closeMenu();   // the mobile menu and this one never stay open together
      menu.hidden = !open;
      lang.classList.toggle('is-open', open);
      langBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) {
        const on = menu.querySelector('[aria-current]') || items()[0];
        // bring the current language into view inside the menu only (scrollIntoView could move the page)
        if (on) menu.scrollTop = Math.max(0, on.offsetTop - menu.clientHeight / 2 + on.offsetHeight / 2);
        if (focusItem && on) on.focus({ preventScroll: true });
      }
    };
    langBtn.addEventListener('click', () => setOpen(menu.hidden, false));
    langBtn.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true, true); }
    });
    menu.addEventListener('keydown', (e) => {
      const list = items();
      const i = list.indexOf(d.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false); langBtn.focus(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); list[Math.min(list.length - 1, i + 1)].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (i <= 0) { setOpen(false); langBtn.focus(); } else list[i - 1].focus(); }
      else if (e.key === 'Home') { e.preventDefault(); list[0].focus(); }
      else if (e.key === 'End') { e.preventDefault(); list[list.length - 1].focus(); }
    });
    lang.addEventListener('focusout', (e) => { if (!menu.hidden && e.relatedTarget && !lang.contains(e.relatedTarget)) setOpen(false); });
    d.addEventListener('pointerdown', (e) => { if (!menu.hidden && !lang.contains(e.target)) setOpen(false); });
    window.addEventListener('scroll', () => { if (!menu.hidden) setOpen(false); }, { passive: true });
    burger && burger.addEventListener('click', () => setOpen(false));
  }
})();
