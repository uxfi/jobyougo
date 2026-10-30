/* v2 studio (/agence): brands, the playground reel, client words, delivery dates and capacity. 2026-10-18.
   Loads after agence-data.js (AGENCY_BRANDS, AGENCY_REEL, AGENCY_TESTIMONIALS, AGENCY_AVAILABILITY, AGENCY_OFFERS)
   on the home and the /agence/<page> documents. Every claim it prints is real:
   - brands are past employers and clients of the people behind the studio, worded "we've worked with" (past),
     never "our clients" or "they trust us"; the brands section adds "Before v2 studio" and each role;
   - the reel plays recordings of the live interface pages (images/reel/), each with a link to the page itself;
   - client words render only from real entries in AGENCY_TESTIMONIALS (the section stays hidden while it is empty);
   - "delivered by" dates are computed from the delivery time written on each package (business days, Mon–Fri);
   - capacity shows only when AGENCY_AVAILABILITY holds both numbers for the current or a coming month.
   Copy lives here (EN/FR) and re-renders when agence-story.js rewrites <html lang>. Motion stops under
   prefers-reduced-motion: the reel shows posters and plays only on request. */
(function () {
  'use strict';

  const d = document;
  const root = d.documentElement;
  const BRANDS = typeof AGENCY_BRANDS !== 'undefined' && Array.isArray(AGENCY_BRANDS) ? AGENCY_BRANDS : [];
  const REEL = typeof AGENCY_REEL !== 'undefined' && Array.isArray(AGENCY_REEL) ? AGENCY_REEL : [];
  const WORDS = typeof AGENCY_TESTIMONIALS !== 'undefined' && Array.isArray(AGENCY_TESTIMONIALS) ? AGENCY_TESTIMONIALS.filter((w) => w && w.name && w.quote) : [];
  const AVAIL = typeof AGENCY_AVAILABILITY === 'object' && AGENCY_AVAILABILITY ? AGENCY_AVAILABILITY : {};
  const OFFERS = typeof AGENCY_OFFERS === 'object' && AGENCY_OFFERS ? AGENCY_OFFERS : { offers: [] };
  const reducedMq = window.matchMedia('(prefers-reduced-motion: reduce)');
  const MEDIA_V = '1';

  const COPY = {
    en: {
      hb_label: 'We’ve worked with',
      reel_title: 'Not mockups.<br><em>Interfaces that move.</em>',
      reel_lede: 'Six interfaces we designed and coded, recorded as they run in a browser. Swipe through them, or open one live.',
      car_prev: 'Previous interface',
      car_next: 'Next interface',
      reel_all: 'All the interfaces',
      contact_founder: 'Your message goes to Hugo, the founder, not to a sales team.',
      brands_kicker: 'Before v2 studio',
      brands_title: 'Brands we’ve worked with.',
      brands_note: 'In-house and freelance work. The logos belong to their brands.',
      reel_list: 'Interfaces in the reel',
      reel_open: 'Open it live',
      reel_pause: 'Pause the reel',
      reel_play: 'Play the reel',
      reel_play_one: 'Play {name}',
      reel_now: 'Playing',
      voices_title: 'In their<br><em>own words.</em>',
      voices_lede: 'What clients said once the work shipped, published with their permission.',
      eta: 'Brief in today, delivered by {date}',
      eta_aria: 'If your brief and files arrive today, delivery by {date}',
      slots: '{left} of {total} project slots left for {month}',
      slots_last: 'Last project slot for {month}',
      slots_full: '{month} is fully booked. Orders now start with the next free slot.',
    },
    fr: {
      hb_label: 'Nous avons travaillé avec',
      reel_title: 'Pas des maquettes.<br><em>Des interfaces qui bougent.</em>',
      reel_lede: 'Six interfaces que nous avons conçues et codées, filmées telles qu’elles tournent dans un navigateur. Faites-les défiler, ou ouvrez-en une en vrai.',
      car_prev: 'Interface précédente',
      car_next: 'Interface suivante',
      reel_all: 'Toutes les interfaces',
      contact_founder: 'Votre message arrive chez Hugo, le fondateur, pas chez un commercial.',
      brands_kicker: 'Avant v2 studio',
      brands_title: 'Des marques avec lesquelles nous avons travaillé.',
      brands_note: 'Missions en interne et en freelance. Les logos appartiennent à leurs marques.',
      reel_list: 'Interfaces du film',
      reel_open: 'L’ouvrir en vrai',
      reel_pause: 'Mettre le film en pause',
      reel_play: 'Lire le film',
      reel_play_one: 'Lire {name}',
      reel_now: 'En lecture',
      voices_title: 'Avec leurs<br><em>propres mots.</em>',
      voices_lede: 'Ce que les clients ont dit une fois le travail livré, publié avec leur accord.',
      eta: 'Brief reçu aujourd’hui, livré le {date}',
      eta_aria: 'Si votre brief et vos fichiers arrivent aujourd’hui, livraison le {date}',
      slots: 'Plus que {left} créneaux sur {total} en {month}',
      slots_last: 'Dernier créneau projet en {month}',
      slots_full: '{month} est complet. Une commande passée maintenant démarre au prochain créneau libre.',
    },
  };

  const lang = () => (root.lang === 'fr' ? 'fr' : 'en');
  // Visitors in other languages read the English copy through the machine translation (agTrDeep, agence shells).
  const tx = (v) => (typeof agTrDeep === 'function' ? agTrDeep(v) : v);
  const t = (k) => { const v = COPY[lang()][k]; return tx(v != null ? v : COPY.en[k]); };
  const fill = (s, vars) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
  const pick = (o) => (o && typeof o === 'object' ? tx(o[lang()] != null ? o[lang()] : o.en) : o);
  const intl = () => (window.SITE && SITE.intl) || (lang() === 'fr' ? 'fr-FR' : 'en-US');
  const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const $ = (id) => d.getElementById(id);
  const pad = (n) => String(n).padStart(2, '0');

  /* ── Dates: business days, Monday to Friday ── */
  // Day 1 is the business day after the brief, so N business days from today lands on the delivery day.
  function addBusinessDays(from, n) {
    const dt = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    let left = n;
    while (left > 0) {
      dt.setDate(dt.getDate() + 1);
      const w = dt.getDay();
      if (w !== 0 && w !== 6) left -= 1;
    }
    return dt;
  }
  function offerDays(o) {
    const m = /(\d+)/.exec(String((o && o.delivery && o.delivery.en) || ''));
    return m ? Number(m[1]) : 0;
  }
  function fmtDate(dt) {
    try {
      return new Intl.DateTimeFormat(intl(), { weekday: 'long', day: 'numeric', month: 'long' }).format(dt);
    } catch (e) {
      return dt.toDateString();
    }
  }
  /** Delivery day for a one-off package ordered today, or null. Shared with agence-checkout.js. */
  function etaFor(offerId) {
    const o = (OFFERS.offers || []).find((x) => x && x.id === offerId);
    if (!o || o.cadence !== 'one-off') return null;
    const n = offerDays(o);
    return n ? addBusinessDays(new Date(), n) : null;
  }
  function monthName(ym) {
    const m = /^(\d{4})-(\d{2})$/.exec(String(ym || ''));
    if (!m) return '';
    try {
      return new Intl.DateTimeFormat(intl(), { month: 'long' }).format(new Date(Number(m[1]), Number(m[2]) - 1, 1));
    } catch (e) {
      return ym;
    }
  }
  /** { left, total, month } when the capacity numbers are set and the month has not passed, else null. */
  function capacity() {
    const total = Number(AVAIL.slots_per_month);
    const left = Number(AVAIL.slots_left);
    if (!Number.isInteger(total) || total <= 0 || !Number.isInteger(left) || left < 0 || left > total) return null;
    const m = /^(\d{4})-(\d{2})$/.exec(String(AVAIL.month || ''));
    if (!m) return null;
    const now = new Date();
    if (Number(m[1]) * 12 + Number(m[2]) < now.getFullYear() * 12 + now.getMonth() + 1) return null;
    return { left, total, month: monthName(AVAIL.month) };
  }
  function capacityLine(c) {
    if (!c) return '';
    const text = c.left === 0 ? fill(t('slots_full'), c) : c.left === 1 ? fill(t('slots_last'), c) : fill(t('slots'), c);
    const dots = Array.from({ length: c.total }, (_, i) => `<i${i < c.total - c.left ? ' class="is-taken"' : ''}></i>`).join('');
    return `<span class="avail-dots" aria-hidden="true">${dots}</span><span>${esc(text)}</span>`;
  }
  window.agenceExtras = { etaFor, fmtDate, capacity, capacityLine };

  /* ── Brands ── */
  function brandImg(b, extra) {
    return `<img src="/images/brands/${esc(b.logo)}?v=${MEDIA_V}" alt="${esc(b.name)}" data-w="${esc(b.w || 'word')}" loading="lazy" decoding="async"${extra || ''}>`;
  }
  function renderHeroBrands() {
    const label = d.querySelector('#hero-brands [data-x="hb_label"]');
    if (label) label.textContent = t('hb_label');
  }
  function renderBrandBand() {
    const proof = d.querySelector('#proof .wrap');
    if (!proof || !BRANDS.length) return;
    let host = $('brands');
    if (!host) {
      host = d.createElement('div');
      host.className = 'brands';
      host.id = 'brands';
      const foot = proof.querySelector('.proof-foot');
      proof.insertBefore(host, foot || null);
    }
    host.setAttribute('aria-labelledby', 'brands-title');
    host.innerHTML = `<div class="brands-head">
        <p class="brands-kicker">${esc(t('brands_kicker'))}</p>
        <h3 class="brands-title" id="brands-title">${esc(t('brands_title'))}</h3>
      </div>
      <ul class="brands-grid" role="list">${BRANDS.map((b, i) => `<li class="brand" style="--i:${i}">
        <span class="brand-mark">${brandImg(b)}</span>
      </li>`).join('')}</ul>
      <p class="brands-note">${esc(t('brands_note'))}</p>`;
    revealOnce(host, '.brand');
  }

  /* One-time entry: children get .is-in when the host scrolls in (immediately under reduced motion). */
  function revealOnce(host, sel) {
    const items = host.querySelectorAll(sel);
    if (reducedMq.matches || !('IntersectionObserver' in window)) { items.forEach((el) => el.classList.add('is-in')); return; }
    if (host.dataset.revealed === '1') { items.forEach((el) => el.classList.add('is-in')); return; }
    // a fast scroll can jump from below the host to above it between two frames: the observer then never fires
    const onScroll = () => {
      if (host.dataset.revealed === '1') { window.removeEventListener('scroll', onScroll); return; }
      const r = host.getBoundingClientRect();
      if (r.height > 0 && r.bottom < 0) {
        host.dataset.revealed = '1';
        host.querySelectorAll(sel).forEach((el) => el.classList.add('is-in'));
        io.disconnect();
        window.removeEventListener('scroll', onScroll);
      }
    };
    const io = new IntersectionObserver((entries) => {
      // on screen, or already scrolled past (a fast scroll can skip the host between two frames)
      if (!entries.some((e) => e.isIntersecting || e.boundingClientRect.bottom <= (e.rootBounds ? e.rootBounds.top : 0))) return;
      host.dataset.revealed = '1';
      host.querySelectorAll(sel).forEach((el) => el.classList.add('is-in'));
      io.disconnect();
    }, { rootMargin: '0px 0px -12% 0px' });
    io.observe(host);
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ── The reel as a carousel (2026-10-18): one card per interface, its recording playing in a browser frame.
     Cards in view play and the others wait; swipe, drag, the arrow keys or the buttons move along. The videos
     load as their card comes near. Under reduced motion every card shows its poster and plays only when asked. ── */
  const car = { built: false, playing: !reducedMq.matches, idx: 0, sectionIn: false, cards: [], seen: new Map() };
  const mp4 = (it) => `/images/reel/${it.id}.mp4?v=${MEDIA_V}`;
  const poster = (it) => `/images/reel/${it.id}.jpg?v=${MEDIA_V}`;
  const liveUrl = (it) => `jobyougo.xyz${String(it.src || '').replace(/\.html$/, '')}`;

  function buildReel(host) {
    host.innerHTML = `<div class="car">
        <div class="car-track" id="car-track" role="list" tabindex="0">${REEL.map((x, i) => `<article class="car-card" role="listitem" data-i="${i}" data-tone-ui="${esc(x.tone || 'dark')}">
          <div class="car-screen">
            <span class="car-chrome" aria-hidden="true"><span class="car-dots"><i></i><i></i><i></i></span><span class="car-url">${esc(liveUrl(x))}</span></span>
            <div class="car-media">
              <video class="car-video" muted loop playsinline preload="none" poster="${esc(poster(x))}" disablepictureinpicture disableremoteplayback tabindex="-1" aria-hidden="true"></video>
              <button type="button" class="car-play" data-play="${i}"><span aria-hidden="true"></span></button>
            </div>
          </div>
          <div class="car-meta">
            <span class="car-n">${pad(i + 1)}</span>
            <span class="car-txt"><b>${esc(x.name)}</b><span class="car-tag"></span></span>
            <a class="car-open" href="${esc(x.src)}" target="_blank" rel="noopener"></a>
          </div>
        </article>`).join('')}</div>
        <div class="car-nav">
          <button type="button" class="car-btn" data-step="-1"><span aria-hidden="true">←</span></button>
          <span class="car-count" id="car-count"></span>
          <button type="button" class="car-btn" data-step="1"><span aria-hidden="true">→</span></button>
          <button type="button" class="car-toggle" id="car-toggle"></button>
        </div>
      </div>`;
    const track = $('car-track');
    car.cards = Array.from(track.querySelectorAll('.car-card'));
    host.addEventListener('click', onCarClick);
    track.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      goCard(car.idx + (e.key === 'ArrowRight' ? 1 : -1));
    });
    dragScroll(track);
    watchCarousel(host, track);
    car.built = true;
  }

  function renderReel() {
    const host = $('reel-ui');
    if (!host || !REEL.length) return;
    if (!car.built) buildReel(host);
    const track = $('car-track');
    track.setAttribute('aria-label', t('reel_list'));
    car.cards.forEach((card, i) => {
      const x = REEL[i];
      card.querySelector('.car-tag').textContent = pick(x.tag);
      const open = card.querySelector('.car-open');
      open.innerHTML = `${esc(t('reel_open'))}<span aria-hidden="true">↗</span>`;
      open.setAttribute('aria-label', `${t('reel_open')}: ${x.name}`);
      card.querySelector('.car-play').setAttribute('aria-label', fill(t('reel_play_one'), { name: x.name }));
    });
    const [prev, next] = $('reel-ui').querySelectorAll('.car-btn');
    prev.setAttribute('aria-label', t('car_prev'));
    next.setAttribute('aria-label', t('car_next'));
    syncCar();
  }

  /* Index, buttons, count, and which videos play. */
  function syncCar() {
    const n = car.cards.length;
    const count = $('car-count');
    if (count) count.textContent = `${pad(car.idx + 1)} / ${pad(n)}`;
    const btns = $('reel-ui') ? $('reel-ui').querySelectorAll('.car-btn') : [];
    if (btns.length) {
      /* En bout de piste, les dernières tuiles sont déjà visibles mais aucune ne peut plus s'aligner
         au bord gauche : couper la flèche sur la position réelle du scroll, sinon elle avancerait
         le compteur sans rien défiler (visible depuis les tuiles réduites, ~2,7 à l'écran). */
      const track = $('car-track');
      const atEnd = !!track && track.scrollLeft >= track.scrollWidth - track.clientWidth - 2;
      btns[0].disabled = car.idx <= 0;
      btns[1].disabled = car.idx >= n - 1 || atEnd;
    }
    const toggle = $('car-toggle');
    if (toggle) {
      toggle.textContent = car.playing ? '❚❚' : '▶';
      toggle.setAttribute('aria-label', car.playing ? t('reel_pause') : t('reel_play'));
      toggle.setAttribute('aria-pressed', car.playing ? 'false' : 'true');
    }
    car.cards.forEach((card, i) => {
      const v = card.querySelector('video');
      const inView = (car.seen.get(card) || 0) >= 0.55;
      card.classList.toggle('is-on', i === car.idx);
      const shouldPlay = car.playing && car.sectionIn && inView && !d.hidden;
      card.classList.toggle('is-paused', !shouldPlay);
      if (shouldPlay) {
        loadCard(card);
        const p = v.play();
        if (p && p.catch) p.catch(() => { card.classList.add('is-paused'); });
      } else if (!v.paused) {
        v.pause();
      }
    });
  }
  function loadCard(card) {
    const v = card.querySelector('video');
    if (v.getAttribute('src')) return;
    v.preload = reducedMq.matches ? 'metadata' : 'auto';
    v.src = mp4(REEL[Number(card.dataset.i)]);
  }
  function goCard(i) {
    const n = car.cards.length;
    const to = Math.max(0, Math.min(n - 1, i));
    const track = $('car-track');
    const card = car.cards[to];
    if (!track || !card) return;
    track.scrollTo({ left: card.offsetLeft - track.firstElementChild.offsetLeft, behavior: reducedMq.matches ? 'auto' : 'smooth' });
    car.idx = to;
    syncCar();
  }
  function onCarClick(e) {
    if (car.dragged) { e.preventDefault(); e.stopPropagation(); car.dragged = false; return; }
    const step = e.target.closest('[data-step]');
    if (step) { goCard(car.idx + Number(step.dataset.step)); return; }
    if (e.target.closest('#car-toggle')) { car.playing = !car.playing; syncCar(); return; }
    const play = e.target.closest('[data-play]');
    if (play) {
      car.playing = true;
      const card = car.cards[Number(play.dataset.play)];
      loadCard(card);
      car.seen.set(card, 1);
      syncCar();
    }
  }
  /* Mouse drag scrolls the track (touch and trackpads scroll it natively). Snapping waits until the drag ends. */
  function dragScroll(track) {
    let x0 = 0;
    let left0 = 0;
    let active = false;
    track.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0 || e.target.closest('a, button')) return;
      active = true;
      car.dragged = false;
      x0 = e.clientX;
      left0 = track.scrollLeft;
    });
    window.addEventListener('pointermove', (e) => {
      if (!active) return;
      const dx = e.clientX - x0;
      if (!car.dragged && Math.abs(dx) > 5) { car.dragged = true; track.classList.add('is-drag'); }
      if (car.dragged) track.scrollLeft = left0 - dx;
    });
    window.addEventListener('pointerup', () => {
      if (!active) return;
      active = false;
      track.classList.remove('is-drag');
      // a click right after a drag is not a click (cleared on the next real one)
      setTimeout(() => { car.dragged = false; }, 0);
    });
  }
  function watchCarousel(host, track) {
    if (!('IntersectionObserver' in window)) {
      car.sectionIn = true;
      car.cards.forEach((c) => car.seen.set(c, 1));
      syncCar();
      return;
    }
    // the section on screen (videos only play while it is)
    new IntersectionObserver((entries) => {
      car.sectionIn = entries.some((x) => x.isIntersecting);
      syncCar();
    }, { threshold: 0.2 }).observe(host);
    // each card inside the track: how much of it shows, and which one leads
    const io = new IntersectionObserver((entries) => {
      entries.forEach((x) => car.seen.set(x.target, x.intersectionRatio));
      const lead = car.cards.findIndex((c) => (car.seen.get(c) || 0) >= 0.55);
      if (lead >= 0) car.idx = lead;
      syncCar();
    }, { root: track, threshold: [0, 0.55, 1] });
    car.cards.forEach((c) => io.observe(c));
    // load a card's video a little before it scrolls in, sideways or from below
    new IntersectionObserver((entries) => {
      if (!entries.some((x) => x.isIntersecting)) return;
      car.cards.slice(0, 3).forEach(loadCard);
    }, { rootMargin: '600px 0px' }).observe(host);
    const near = new IntersectionObserver((entries) => {
      entries.forEach((x) => { if (x.isIntersecting && car.sectionIn) loadCard(x.target); });
    }, { root: track, rootMargin: '0px 60% 0px 60%' });
    car.cards.forEach((c) => near.observe(c));
    d.addEventListener('visibilitychange', syncCar);
  }

  /* ── Client words (real ones only) ── */
  function initials(name) {
    return String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  }
  function renderWords() {
    const sec = $('voices');
    if (!sec) return;
    if (!WORDS.length) { sec.hidden = true; return; }
    sec.hidden = false;
    const title = $('voices-title');
    if (title) title.innerHTML = t('voices_title');
    const lede = $('voices-lede');
    if (lede) lede.textContent = t('voices_lede');
    const host = $('voices-list');
    if (!host) return;
    host.classList.toggle('is-row', WORDS.length > 2);
    host.innerHTML = WORDS.map((w, i) => {
      const avatar = w.photo
        ? `<img class="voice-photo" src="${esc(w.photo)}" alt="" width="48" height="48" loading="lazy" decoding="async">`
        : `<span class="voice-photo voice-photo--initials" aria-hidden="true">${esc(initials(w.name))}</span>`;
      const logo = w.logo ? `<img class="voice-logo" src="/images/brands/${esc(w.logo)}?v=${MEDIA_V}" alt="${esc(w.company || '')}" loading="lazy" decoding="async">` : '';
      return `<figure class="voice" style="--i:${i}">
        <blockquote><p>${esc(pick(w.quote))}</p></blockquote>
        <figcaption>${avatar}<span class="voice-who"><b>${esc(w.name)}</b><span>${esc([pick(w.role), w.company].filter(Boolean).join(' · '))}</span></span>${logo}</figcaption>
      </figure>`;
    }).join('');
    revealOnce(host, '.voice');
  }

  /* ── Pricing: delivery date on each one-off card, capacity ── */
  function decoratePrices() {
    const host = $('prices');
    if (!host) return;
    host.querySelectorAll('.price[data-card]').forEach((card) => {
      const id = card.dataset.card;
      const eta = etaFor(id);
      const act = card.querySelector('.price-act');
      if (!eta || !act) return;
      let line = card.querySelector('.price-eta');
      if (!line) {
        line = d.createElement('p');
        line.className = 'price-eta';
        act.insertBefore(line, act.firstChild);
      }
      const date = fmtDate(eta);
      line.innerHTML = `<i class="eta-pulse" aria-hidden="true"></i><span>${esc(fill(t('eta'), { date: '' }).trim())} <b>${esc(date)}</b></span>`;
      line.setAttribute('aria-label', fill(t('eta_aria'), { date }));
    });
  }
  function renderPricingExtras() {
    const sec = $('pricing');
    if (!sec) return;
    const head = sec.querySelector('.sec-head');
    const cap = capacity();
    let av = $('avail');
    if (cap) {
      if (!av && head) {
        av = d.createElement('p');
        av.className = 'avail';
        av.id = 'avail';
        const lede = head.querySelector('.lede');
        (lede || head).insertAdjacentElement(lede ? 'afterend' : 'beforeend', av);
      }
      if (av) { av.innerHTML = capacityLine(cap); av.classList.toggle('is-full', cap.left === 0); }
    } else if (av) {
      av.remove();
    }
    decoratePrices();
  }

  /* agence-story.js re-renders the cards on language and track changes: put the dates back each time. */
  function watchPrices() {
    const host = $('prices');
    if (!host || host.dataset.etaWatch) return;
    host.dataset.etaWatch = '1';
    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        const cards = host.querySelectorAll('.price[data-card]');
        if (Array.prototype.some.call(cards, (c) => etaFor(c.dataset.card) && !c.querySelector('.price-eta'))) decoratePrices();
      });
    }).observe(host, { childList: true, subtree: true });
  }

  /* Static copy in the markup: [data-x] text, [data-xh] trusted HTML from COPY. */
  function applyCopy() {
    d.querySelectorAll('[data-x]').forEach((el) => { const v = t(el.dataset.x); if (typeof v === 'string') el.textContent = v; });
    d.querySelectorAll('[data-xh]').forEach((el) => { const v = t(el.dataset.xh); if (typeof v === 'string') el.innerHTML = v; });
  }

  function renderAll() {
    applyCopy();
    renderHeroBrands();
    renderBrandBand();
    renderReel();
    renderWords();
    renderPricingExtras();
  }

  function boot() {
    renderAll();
    watchPrices();
    new MutationObserver(renderAll).observe(root, { attributes: true, attributeFilter: ['lang'] });
    // A midnight rollover moves every "delivered by" date: refresh when the tab comes back.
    d.addEventListener('visibilitychange', () => { if (!d.hidden) decoratePrices(); });
    reducedMq.addEventListener && reducedMq.addEventListener('change', () => { if (reducedMq.matches) { car.playing = false; if (car.built) syncCar(); } });
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', boot); else boot();
})();
