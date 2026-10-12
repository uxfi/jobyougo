/* v2 studio (/agence) page behaviours. Classic script, loaded last (after marquee.js).
   window.AgencePage.render(lang) (re)renders every language-dependent block that the shared
   scripts do not own: pricing, services, proof, the 12-point ledger, the process timeline,
   FAQ (+ FAQPage JSON-LD) and founder facts. Called from SITE.onLangChange (setLang) and once
   on DOMContentLoaded. Never throws: every lookup is guarded. */
(function agencePage() {
  'use strict';

  const CAL = typeof AGENCY_CALENDLY === 'string' ? AGENCY_CALENDLY : 'https://calendly.com/chilka-v/30min';
  const EMAIL = typeof AGENCY_EMAIL === 'string' ? AGENCY_EMAIL : 'chilka.v@gmail.com';
  const OFFERS = (typeof AGENCY_OFFERS !== 'undefined' && AGENCY_OFFERS) ? AGENCY_OFFERS : { offers: [], addons: [] };
  const $ = (id) => document.getElementById(id);
  const mqReduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const reduced = () => !!(mqReduce && mqReduce.matches);
  const wide = (min) => window.matchMedia ? window.matchMedia(`(min-width: ${min}px)`).matches : true;

  const lang = (l) => (typeof agLang === 'function' ? agLang(l) : (l === 'fr' ? 'fr' : 'en'));
  const t = (key, l) => (typeof agT === 'function' ? agT(key, l) : '');
  const esc = (s) => (typeof agEsc === 'function' ? agEsc(s) : String(s == null ? '' : s));
  const fill = (s, v) => (typeof agFill === 'function' ? agFill(s, v) : String(s || ''));
  const price = (n, l, monthly) => (typeof agPrice === 'function' ? agPrice(n, l, monthly) : '$' + n);

  /* Page-chrome keys not in the spec copy table. agence-i18n.js carries them too; this map is only
     a fallback in case that file fails to load. */
  const AG_FALLBACK = {
    en: {
      ag_chat_send_aria: 'Send',
      ag_skip_link: 'Skip to content',
      ag_nav_home_aria: 'v2 studio, back to the top',
      ag_shape_switch_aria: 'Switch the 3D shape',
      ag_iface_modal_aria: 'Interface study preview',
      ag_mail_to: 'To:',
      ag_mail_subject: 'Subject:',
      ag_copy_failed: 'Copy failed. Select the text below and copy it.',
      ag_iface_frame_title: 'Interface study',
      ag_timeline_aria: 'The five steps, scroll sideways',
    },
    fr: {
      ag_chat_send_aria: 'Envoyer',
      ag_skip_link: 'Aller au contenu',
      ag_nav_home_aria: 'v2 studio, retour en haut',
      ag_shape_switch_aria: 'Changer la forme 3D',
      ag_iface_modal_aria: 'Aperçu de l’étude d’interface',
      ag_mail_to: 'À :',
      ag_mail_subject: 'Objet :',
      ag_copy_failed: 'La copie a échoué. Sélectionnez le texte ci-dessous et copiez-le.',
      ag_iface_frame_title: 'Étude d’interface',
      ag_timeline_aria: 'Les cinq étapes, défilement horizontal',
    },
  };
  /** Escaped label whose trailing arrow can nudge on hover. */
  const arrowize = (text) => {
    const s = String(text || '');
    const m = s.match(/^(.*?)\s*→\s*$/);
    return m ? `${esc(m[1])}<span class="ag-arrow" aria-hidden="true">→</span>` : esc(s);
  };
  const ta = (key, l) => t(key, l) || (AG_FALLBACK[lang(l)] && AG_FALLBACK[lang(l)][key]) || AG_FALLBACK.en[key] || '';

  const ARROW = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4"/></svg>';
  const CHECK = '<svg class="ag-check" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg>';
  const CHEVRON = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>';

  /* ── Helpers: scroll + pulse ── */
  function pulse(el) {
    if (!el) return;
    el.classList.remove('ag-pulse');
    void el.offsetWidth; // restart the animation
    el.classList.add('ag-pulse');
    setTimeout(() => el.classList.remove('ag-pulse'), 700);
  }

  function homeVisible() {
    const home = $('view-home');
    return !(home && home.classList.contains('hidden'));
  }

  /** Move keyboard focus to a scroll target without scrolling again (tabindex -1 when needed). */
  function focusTarget(el) {
    if (!el || typeof el.focus !== 'function') return;
    if (!el.matches('a[href], button, input, select, textarea, summary, [tabindex]')) el.setAttribute('tabindex', '-1');
    try { el.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
  }
  function focusSection(id) {
    const section = $(id);
    if (!section) return;
    focusTarget(section.querySelector('h2') || section);
  }

  /* app.js navToSection always scrolls smoothly; with reduced motion, jump instead (nav links call it inline). */
  function wrapNavToSection() {
    const orig = window.navToSection;
    if (typeof orig !== 'function' || orig.__agWrapped) return;
    const wrapped = function navToSectionAgency(id, event) {
      if (!reduced()) return orig.apply(this, arguments);
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      try { if (typeof window.setNavMenu === 'function') window.setNavMenu(false); } catch (_) { /* ignore */ }
      const wasProject = !homeVisible();
      if (wasProject && typeof window.goHome === 'function') window.goHome();
      const go = () => {
        const target = $(id);
        if (!target) return;
        target.scrollIntoView({ block: 'start' });
        if (history.pushState) history.pushState(null, '', '#' + id);
      };
      if (wasProject) requestAnimationFrame(go); else go();
      return false;
    };
    wrapped.__agWrapped = true;
    window.navToSection = wrapped;
  }

  /** Scroll to a section id; reuses app.js navToSection (it handles the case-study view). */
  function scrollToId(id, event) {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (typeof window.navToSection === 'function') {
      window.navToSection(id);
    } else {
      const el = $(id);
      if (el) el.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
    }
    return false;
  }

  /** Scroll to the price card of an offer, pulse it once and move focus to it. 'custom' targets the custom row. */
  function goToOffer(offer) {
    const go = () => {
      const card = $(offer === 'custom' ? 'price-custom' : 'price-' + offer) || $('pricing');
      if (!card) return;
      card.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' });
      focusTarget(card.id === 'pricing' ? (card.querySelector('h2') || card) : card);
      setTimeout(() => pulse(card), reduced() ? 0 : 520);
    };
    if (!homeVisible() && typeof window.goHome === 'function') {
      window.goHome();
      requestAnimationFrame(() => requestAnimationFrame(go));
    } else {
      go();
    }
    return false;
  }

  /** Case-study CTA "Compare the packages": back home, to #pricing, pulse the matching card. */
  function comparePackages(offer) {
    if (typeof window.navToSection === 'function') window.navToSection('pricing');
    else scrollToId('pricing');
    setTimeout(() => goToOffer(offer || 'refonte'), reduced() ? 60 : 650);
    return false;
  }

  function storyToPricing() {
    if (typeof window.closeStoryModal === 'function') window.closeStoryModal();
    setTimeout(() => { scrollToId('pricing'); focusSection('pricing'); }, 80);
  }

  /* ── Pricing ── */
  function renderPricing(l) {
    const grid = $('price-grid');
    if (grid) {
      const openState = {};
      grid.querySelectorAll('details[data-offer]').forEach((d) => { openState[d.dataset.offer] = d.open; });
      const openByDefault = wide(900);
      // One column (≤900px): the highlighted card comes first in the DOM too, so focus and reading order match.
      const offers = wide(901) ? OFFERS.offers : OFFERS.offers.slice().sort((a, b) => Number(!!b.highlighted) - Number(!!a.highlighted));
      grid.dataset.layout = wide(901) ? 'grid' : 'stack';
      grid.innerHTML = offers.map((o) => {
        const monthly = o.cadence === 'month';
        const list = (field) => ((o[field] && o[field][l]) || []);
        const featured = !!o.highlighted;
        const isOpen = Object.prototype.hasOwnProperty.call(openState, o.id) ? openState[o.id] : openByDefault;
        const detail = [o.delivery_detail && o.delivery_detail[l], o.revisions_detail && o.revisions_detail[l]].filter(Boolean).join(' ');
        return `
        <article class="price-card${featured ? ' price-card--featured' : ''}" id="price-${o.id}" data-offer="${o.id}" aria-labelledby="price-${o.id}-name" tabindex="-1">
          ${featured ? `<span class="price-card-tag">${esc(t('price_featured_tag', l))}</span>` : ''}
          <h3 class="price-card-name" id="price-${o.id}-name">${esc(o.name[l])}</h3>
          <p class="price-card-for"><span class="ag-sr">${esc(t('price_for', l))}${l === 'fr' ? ' : ' : ': '}</span>${esc(o.for[l])}</p>
          <div class="price-card-price">
            <span class="price-card-amount">${esc(price(o.price, l, false))}</span> <span class="price-card-cadence">${esc(t(monthly ? 'price_month' : 'price_oneoff', l))}</span>
          </div>
          ${o.note ? `<p class="price-card-note">${esc(o.note[l])}</p>` : ''}
          <div class="price-card-block">
            <p class="price-card-label">${esc(t('price_includes', l))}</p>
            <ul class="price-card-includes">${list('includes').map(item => `<li>${CHECK}<span>${esc(item)}</span></li>`).join('')}</ul>
          </div>
          <div class="price-card-meta">
            <div class="price-meta-tile"><span>${esc(t('price_delivery', l))}</span> <strong>${esc(o.delivery[l])}</strong></div>
            <div class="price-meta-tile"><span>${esc(t('price_revisions', l))}</span> <strong>${esc(o.revisions[l])}</strong></div>
          </div>
          ${detail ? `<p class="price-card-meta-detail">${esc(detail)}</p>` : ''}
          <details class="price-card-excl" data-offer="${o.id}"${isOpen ? ' open' : ''}>
            <summary><span>${esc(t('price_not_included', l))}</span>${CHEVRON}</summary>
            <ul>${list('not_included').map(item => `<li><span class="ag-minus" aria-hidden="true"></span><span>${esc(item)}</span></li>`).join('')}</ul>
          </details>
          <button type="button" class="price-card-cta" onclick="openContactModal('${o.id}')">${esc(o.cta[l])}</button>
          <a class="price-card-call" href="${CAL}" target="_blank" rel="noopener noreferrer">${esc(t('price_or_call', l))}</a>
        </article>`;
      }).join('');
    }

    const addons = $('addon-chips');
    if (addons) {
      addons.innerHTML = (OFFERS.addons || []).map((a) => {
        const name = t('addon_' + a.id.replace(/-/g, '_'), l) || (a.name && a.name[l]) || '';
        return `<li class="addon-chip">${esc(name)} · <strong>${esc(price(a.price, l, false))}</strong></li>`;
      }).join('');
    }
    const note = $('addon-note');
    if (note) note.textContent = t('addons_audit_note', l) || (OFFERS.auditDeductionNote && OFFERS.auditDeductionNote[l]) || '';

    const how = $('pricing-how');
    if (how) {
      const steps = [1, 2, 3].map(n => t('pricing_how_' + n, l)).filter(Boolean);
      how.innerHTML = steps.length
        ? steps.map((s, i) => `<li><span class="pricing-how-num" aria-hidden="true">${i + 1}</span><span>${esc(s)}</span></li>`).join('')
        : `<li><span>${esc(t('pricing_how', l))}</span></li>`;
    }
  }

  /* ── Services (4 cards, 56px 3D stages) ── */
  const svcInstances = [];
  let svcMountObserver = null;

  function disposeServiceStages() {
    while (svcInstances.length) {
      const inst = svcInstances.pop();
      try { inst && inst.dispose && inst.dispose(); } catch (_) { /* ignore */ }
    }
  }

  function canMount3D() {
    return wide(769) && !reduced();
  }

  function mountServiceStages() {
    const grid = $('svc-grid');
    if (!grid || !canMount3D()) return;
    const started = Date.now();
    const attempt = () => {
      if (typeof window.mountMethodIcon3D !== 'function') {
        if (Date.now() - started < 5000) setTimeout(attempt, 150);
        return;
      }
      const token = grid.dataset.renderToken;
      grid.querySelectorAll('.svc-stage[data-type]').forEach(async (stage) => {
        if (stage.dataset.mounted) return;
        stage.dataset.mounted = '1';
        try {
          const inst = await window.mountMethodIcon3D({ stage, type: stage.dataset.type });
          if (!inst) return;
          if (grid.dataset.renderToken !== token || !stage.isConnected) { inst.dispose && inst.dispose(); return; }
          svcInstances.push(inst);
          const obj = stage.querySelector('.method-obj');
          if (obj) obj.hidden = true;
        } catch (err) {
          console.warn('Service icon', err);
        }
      });
    };
    attempt();
  }

  function scheduleServiceStages() {
    const grid = $('svc-grid');
    if (!grid || !canMount3D()) return;
    if (svcMountObserver) svcMountObserver.disconnect();
    if (!('IntersectionObserver' in window)) { mountServiceStages(); return; }
    svcMountObserver = new IntersectionObserver((entries) => {
      if (entries.some(e => e.isIntersecting)) {
        svcMountObserver.disconnect();
        svcMountObserver = null;
        mountServiceStages();
      }
    }, { rootMargin: '300px 0px' });
    svcMountObserver.observe(grid);
  }

  function renderServices(l) {
    const grid = $('svc-grid');
    if (!grid || typeof AGENCY_SERVICES === 'undefined') return;
    disposeServiceStages();
    const openEvidence = new Set([...grid.querySelectorAll('.svc-evidence.is-open')].map(ev => ev.closest('.svc-card')?.id).filter(Boolean));
    grid.dataset.renderToken = String(Date.now());
    const staticObj = (type) => (typeof window.renderMethodObject === 'function'
      ? `<div class="method-obj" data-type="${type}">${window.renderMethodObject(type)}</div>` : '');
    grid.innerHTML = AGENCY_SERVICES.map((s) => {
      const k = (suffix) => t(`svc_${s.n}_${suffix}`, l);
      const dels = [];
      for (let i = 1; i <= 8; i += 1) { const d = k('del_' + i); if (!d) break; dels.push(d); }
      return `
      <article class="svc-card" id="${s.id}">
        <div class="svc-card-top">
          <div class="svc-stage" data-type="${s.icon}" aria-hidden="true">${staticObj(s.icon)}</div>
          <p class="svc-kicker">${esc(k('kicker'))}</p>
        </div>
        <h3 class="svc-title">${esc(k('title'))}</h3>
        <p class="svc-promise">${esc(k('promise'))}</p>
        <ul class="svc-deliverables">${dels.map(d => `<li>${esc(d)}</li>`).join('')}</ul>
        <div class="svc-evidence${openEvidence.has(s.id) ? ' is-open' : ''}">
          <button type="button" class="svc-proof-tag" aria-expanded="${openEvidence.has(s.id) ? 'true' : 'false'}" aria-controls="${s.id}-ev">${esc(t('svc_proof_tag', l))}</button>
          <p class="svc-evidence-text" id="${s.id}-ev">${esc(k('evidence'))}</p>
        </div>
        <button type="button" class="svc-link" data-offer="${s.offer}">${arrowize(t('svc_link', l))}</button>
      </article>`;
    }).join('');
    scheduleServiceStages();
  }

  function bindServices() {
    const grid = $('svc-grid');
    if (!grid || grid.dataset.bound) return;
    grid.dataset.bound = '1';
    grid.addEventListener('click', (e) => {
      const tag = e.target.closest('.svc-proof-tag');
      if (tag) {
        const open = tag.getAttribute('aria-expanded') !== 'true';
        tag.setAttribute('aria-expanded', open ? 'true' : 'false');
        tag.closest('.svc-evidence')?.classList.toggle('is-open', open);
        return;
      }
      const link = e.target.closest('.svc-link');
      if (link) goToOffer(link.dataset.offer || 'refonte');
    });
    // The 3D icon animates on hover only; let the whole card drive it (the stage ignores the pointer).
    const forward = (type) => (e) => {
      const card = e.target.closest && e.target.closest('.svc-card');
      if (!card || (e.relatedTarget && card.contains(e.relatedTarget))) return;
      const stage = card.querySelector('.svc-stage');
      if (stage) stage.dispatchEvent(new Event(type));
    };
    grid.addEventListener('pointerover', forward('pointerenter'));
    grid.addEventListener('pointerout', forward('pointerleave'));
  }

  /* A named case file, or the screenshot already stored on the case. No stand-in. */
  function proofImage(card) {
    const named = card && typeof card.image === 'string' ? card.image : '';
    if (named && !named.includes('..') && !/[\\/]/.test(named)) return '/images/' + named;
    const list = typeof PROJECTS !== 'undefined' ? PROJECTS : null;
    const project = list && list.find((x) => x && x.id === card.caseId);
    const raw = project && (project.screenshot || project.heroCover);
    if (typeof raw !== 'string' || !raw) return '';
    const file = raw.split('/').filter(Boolean).pop();
    if (!file || file.includes('..') || /[\\/]/.test(file)) return '';
    return '/images/' + file;
  }

  /* ── Proof cards ── */
  function renderProof(l) {
    const grid = $('proof-grid');
    if (!grid || typeof AGENCY_PROOF === 'undefined') return;
    grid.innerHTML = AGENCY_PROOF.map((c) => {
      const k = (suffix) => t(`proof_${c.n}_${suffix}`, l);
      const years = k('years');
      const meta = [k('kicker'), years].filter(Boolean).join(' · ');
      const src = proofImage(c);
      const focus = typeof c.focus === 'string' && /^[a-z0-9%.\s-]+$/i.test(c.focus) ? c.focus : '';
      const shotClass = 'proof-shot' + (c.fit === 'contain' ? ' proof-shot--contain' : '');
      const shot = src
        ? `<span class="${shotClass}"${focus ? ` style="--proof-focus:${esc(focus)}"` : ''}><img src="${esc(src)}" alt=""></span>`
        : '';
      const lead = c.lead ? ' proof-card--lead' : '';
      return `
      <article class="lens-card proof-card${lead}" id="proof-${c.caseId}">
        <button type="button" class="proof-open" onclick="openProject('${c.caseId}')">
          ${shot}
          <span class="proof-body">
            <span class="proof-name">${esc(k('name'))}</span>
            <span class="proof-meta">${esc(meta)}</span>
            <span class="lens-answer">${esc(k('done'))}</span>
            <span class="proof-foot">
              <span class="proof-stat"><span class="proof-stat-val">${esc(k('stat'))}</span><span class="proof-stat-label">${esc(k('label'))}</span></span>
              <span class="proof-link">${arrowize(t('proof_read_case', l))}</span>
            </span>
          </span>
        </button>
      </article>`;
    }).join('');
  }

  /* ── 12-point ledger ── */
  function renderLedger(l) {
    const ledger = $('detail-ledger');
    if (!ledger) return;
    const openRows = new Set([...ledger.querySelectorAll('.detail-row.is-open')].map(r => r.dataset.n));
    const n = typeof AGENCY_CHECK_COUNT === 'number' ? AGENCY_CHECK_COUNT : 12;
    const rows = [];
    for (let i = 1; i <= n; i += 1) {
      const k = (suffix) => t(`check_${i}_${suffix}`, l);
      const idx = String(i).padStart(2, '0');
      const open = openRows.has(String(i));
      rows.push(`
      <div class="detail-row${open ? ' is-open' : ''}" data-n="${i}" style="--i:${i - 1}">
        <button type="button" class="detail-row-btn" id="detail-btn-${i}" aria-expanded="${open ? 'true' : 'false'}" aria-controls="detail-panel-${i}">
          <span class="detail-idx" aria-hidden="true">${idx}</span>
          <span class="detail-main">
            <span class="detail-title">${esc(k('title'))}</span> <span class="detail-line">${esc(k('desc'))}</span>
          </span>
          <svg class="detail-tick" width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M3.5 9.5l3.6 3.6L14.5 5.4"/></svg>
        </button>
        <div class="detail-panel" id="detail-panel-${i}">
          <div class="detail-panel-inner"><div class="detail-panel-body">
            <p class="detail-ba"><span class="proj-ba-tag before">${esc(t('details_before', l))}</span><span class="detail-ba-text">${esc(k('before'))}</span></p>
            <p class="detail-ba"><span class="proj-ba-tag after">${esc(t('details_after', l))}</span><span class="detail-ba-text">${esc(k('after'))}</span></p>
          </div></div>
        </div>
      </div>`);
    }
    ledger.innerHTML = rows.join('');
    paintHandTicks();

    if (!ledger.dataset.bound) {
      ledger.dataset.bound = '1';
      ledger.addEventListener('click', (e) => {
        const btn = e.target.closest('.detail-row-btn');
        if (!btn) return;
        const row = btn.closest('.detail-row');
        const open = btn.getAttribute('aria-expanded') !== 'true';
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        row.classList.toggle('is-open', open);
      });
    }
  }

  /* ── Process timeline ── */
  function renderTimeline(l) {
    const track = $('timeline');
    if (!track) return;
    const n = typeof AGENCY_STEP_COUNT === 'number' ? AGENCY_STEP_COUNT : 5;
    const refund = typeof AGENCY_REFUND_STEP === 'number' ? AGENCY_REFUND_STEP : 3;
    const steps = [];
    for (let i = 1; i <= n; i += 1) {
      const k = (suffix) => t(`step_${i}_${suffix}`, l);
      const isRefund = i === refund;
      steps.push(`
      <li class="timeline-step${isRefund ? ' is-refund' : ''}">
        <span class="timeline-pill">${esc(k('marker'))}</span>
        <div class="proj-step timeline-card">
          <h3 class="proj-step-title">${esc(k('title'))}</h3>
          <p class="proj-step-desc">${esc(k('body'))}</p>
          ${isRefund ? `<a class="timeline-refund-tag" href="#guarantee" data-scroll="guarantee">${esc(t('process_refund_tag', l))}</a>` : ''}
        </div>
      </li>`);
    }
    track.innerHTML = steps.join('');

    const note = $('process-note');
    if (note) note.textContent = t('process_note', l);
    const weeks = $('process-weeks');
    if (weeks) {
      const w = t('process_week', l);
      weeks.innerHTML = [1, 2, 3, 4].map(i => `<li><span class="process-week-dot" aria-hidden="true"></span>${esc(w)} ${i}</li>`).join('');
    }
    updateTimelineFill();
    syncTimelineScroller(l);
  }

  /* 601 to 1099px: the timeline scrolls sideways, so the scroller becomes a focusable, named region.
     Elsewhere it does not scroll and stays out of the tab order. */
  function syncTimelineScroller(l) {
    const scroller = document.querySelector('#timeline-wrap .timeline-scroller');
    if (!scroller) return;
    const scrolls = scroller.scrollWidth > scroller.clientWidth + 1;
    if (scrolls) {
      scroller.setAttribute('tabindex', '0');
      scroller.setAttribute('role', 'region');
      scroller.setAttribute('aria-label', ta('ag_timeline_aria', l));
    } else {
      scroller.removeAttribute('tabindex');
      scroller.removeAttribute('role');
      scroller.removeAttribute('aria-label');
    }
  }

  let timelineRaf = 0;
  function updateTimelineFill() {
    const section = $('process');
    const wrap = $('timeline-wrap');
    if (!section || !wrap) return;
    if (reduced()) { wrap.style.setProperty('--tl-progress', '1'); return; }
    const rect = section.getBoundingClientRect();
    const vh = window.innerHeight || 800;
    const start = vh * 0.85;
    const span = Math.max(1, rect.height * 0.7);
    const p = Math.min(1, Math.max(0, (start - rect.top) / span));
    wrap.style.setProperty('--tl-progress', p.toFixed(3));
  }
  function onScrollTimeline() {
    if (timelineRaf) return;
    timelineRaf = requestAnimationFrame(() => { timelineRaf = 0; updateTimelineFill(); paintHandTicks(); });
  }

  /* Signature move: each of the 12 checks is drawn by the scroll, one stroke per row.
     The pen is the wheel. A row finishes as it crosses the reading line. */
  function paintHandTicks() {
    const ledger = $('detail-ledger');
    if (!ledger) return;
    const rows = ledger.querySelectorAll('.detail-row');
    if (!rows.length) return;
    if (reduced()) {
      rows.forEach((row) => row.style.setProperty('--tick', '1'));
      return;
    }
    const vh = window.innerHeight || 1;
    const start = vh * 0.8;
    const end = vh * 0.46;
    const span = start - end || 1;
    rows.forEach((row) => {
      const top = row.getBoundingClientRect().top;
      const p = Math.max(0, Math.min(1, (start - top) / span));
      row.style.setProperty('--tick', p.toFixed(3));
    });
  }

  /* ── FAQ + JSON-LD ── */
  function renderFaq(l) {
    const list = $('faq-list');
    if (!list || typeof AGENCY_FAQ_SLUGS === 'undefined') return;
    const openIds = new Set([...list.querySelectorAll('details[open]')].map(d => d.id));
    const hash = (location.hash || '').slice(1);
    const items = AGENCY_FAQ_SLUGS.map((slug) => ({ slug, q: t(`faq_${slug}_q`, l), a: t(`faq_${slug}_a`, l) })).filter(x => x.q && x.a);
    list.innerHTML = items.map((x) => {
      const id = 'faq-' + x.slug;
      const open = openIds.has(id) || hash === id;
      return `
      <details class="faq-item" id="${id}"${open ? ' open' : ''}>
        <summary><span class="faq-q">${esc(x.q)}</span><span class="faq-plus" aria-hidden="true"></span></summary>
        <div class="faq-a lens-answer"><p>${esc(x.a)}</p></div>
      </details>`;
    }).join('');

    const ld = {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      inLanguage: l,
      mainEntity: items.map(x => ({ '@type': 'Question', name: x.q, acceptedAnswer: { '@type': 'Answer', text: x.a } })),
    };
    let script = $('faq-jsonld');
    if (!script) {
      script = document.createElement('script');
      script.type = 'application/ld+json';
      script.id = 'faq-jsonld';
      document.head.appendChild(script);
    }
    script.textContent = JSON.stringify(ld).replace(/</g, '\\u003c');
  }

  function openFaqFromHash(scroll) {
    const hash = (location.hash || '').slice(1);
    if (!/^faq-[a-z]+$/.test(hash)) return;
    const item = $(hash);
    if (!item || item.tagName !== 'DETAILS') return;
    item.open = true;
    if (scroll) requestAnimationFrame(() => item.scrollIntoView({ behavior: 'auto', block: 'center' }));
  }

  /* ── Founder facts + static attributes ── */
  function renderFounder(l) {
    const facts = $('founder-facts');
    if (facts) {
      facts.innerHTML = [1, 2, 3, 4].map((i) => {
        const val = t(`founder_fact_${i}_val`, l);
        const label = t(`founder_fact_${i}_label`, l);
        if (!val && !label) return '';
        return `<li class="founder-fact"><strong>${esc(val)}</strong> <span>${esc(label)}</span></li>`;
      }).join('');
    }
    const photo = $('founder-photo');
    if (photo) {
      const alt = t('founder_photo_alt', l);
      if (alt) photo.alt = alt;
    }
  }

  function renderAttributes(l) {
    const set = (id, attr, key) => { const el = $(id); const v = ta(key, l); if (el && v) el.setAttribute(attr, v); };
    set('hrhv-send', 'aria-label', 'ag_chat_send_aria');
    set('nav-logo', 'aria-label', 'ag_nav_home_aria');
    set('hero-shape-toggle', 'aria-label', 'ag_shape_switch_aria');
    set('hero-shape-toggle-check', 'aria-label', 'ag_shape_switch_aria');
    set('iface-modal', 'aria-label', 'ag_iface_modal_aria');
    set('iface-modal-frame', 'title', 'ag_iface_frame_title');
    const skip = $('ag-skip');
    if (skip) skip.textContent = ta('ag_skip_link', l);
    const hint = $('contact-copy-status');
    if (hint && hint.dataset.state) hint.textContent = '';
    const chatInput = $('hrhv-input');
    if (chatInput && !chatInput.disabled) {
      const ph = t('chat_placeholder', l);
      if (ph) chatInput.setAttribute('placeholder', ph);
    }
  }

  /* Re-render the shared lists so chips, badges and labels follow the language. */
  function rerenderShared() {
    try { if (typeof window.renderProjList === 'function') window.renderProjList(); } catch (err) { console.warn('renderProjList', err); }
    try { if (typeof window.renderAiBento === 'function') window.renderAiBento(); } catch (err) { console.warn('renderAiBento', err); }
  }

  /* An open case study is rendered once by app.js openProject(); on a language switch, swap the
     page-owned parts (banner, end CTA) and the hero / footer labels without re-opening the view. */
  function refreshOpenCase(l) {
    const view = $('view-project');
    const content = $('proj-page-content');
    if (!view || !content || view.classList.contains('hidden')) return;
    const id = typeof currentProjectId === 'string' ? currentProjectId : null; // app.js global
    const p = id && typeof PROJECTS !== 'undefined' ? PROJECTS.find(x => x && x.id === id) : null;
    const site = window.SITE || {};
    if (!p) return;
    const swap = (selector, hook) => {
      const el = content.querySelector(selector);
      if (!el || typeof site[hook] !== 'function') return;
      let html = '';
      try { html = site[hook](p, l); } catch (err) { console.warn('SITE.' + hook, err); return; }
      if (typeof html !== 'string' || !html.trim()) return;
      const tpl = document.createElement('template');
      tpl.innerHTML = html.trim();
      const node = tpl.content.firstElementChild;
      if (node) el.replaceWith(node);
    };
    swap('.ag-case-banner', 'renderProjectBanner');
    swap('.ag-case-cta', 'renderProjectCta');
    const metaKeys = ['proj_role', 'proj_duration', 'proj_team', 'proj_platform'];
    content.querySelectorAll('.proj-meta-row .proj-meta-key').forEach((el, i) => {
      const v = metaKeys[i] ? t(metaKeys[i], l) : '';
      const textNode = [...el.childNodes].reverse().find(n => n.nodeType === 3 && n.nodeValue.trim());
      if (v && textNode) textNode.nodeValue = v;
    });
    const setText = (selector, key) => {
      const v = t(key, l);
      if (v) content.querySelectorAll(selector).forEach((el) => { el.textContent = v; });
    };
    setText('.proj-next-kicker', 'proj_up_next');
    setText('.proj-next-all', 'proj_all_work');

    // Prev / next / then cards: direction label and the card's accessible name.
    content.querySelectorAll('.proj-next-card').forEach((card) => {
      const key = card.classList.contains('is-prev') ? 'proj_prev' : card.classList.contains('is-next') ? 'proj_next' : 'proj_then';
      const dir = t(key, l);
      const dirEl = card.querySelector('.proj-next-dir');
      if (!dir || !dirEl) return;
      dirEl.textContent = dir;
      const name = card.querySelector('.proj-next-name');
      if (name) card.setAttribute('aria-label', `${dir}: ${name.textContent.trim()}`);
    });
    // Gallery labels: match the current text against both languages to know which key it is.
    const known = (key, literal) => [t(key, 'en'), t(key, 'fr'), literal].filter(Boolean);
    const galleryKeys = [['proj_before_after', 'Before / After'], ['proj_design_work', 'Design work']];
    content.querySelectorAll('.proj-gallery-label').forEach((el) => {
      const now = el.textContent.trim();
      const hit = galleryKeys.find(([key, literal]) => known(key, literal).includes(now));
      const v = hit ? t(hit[0], l) : '';
      if (v) el.textContent = v;
    });
    // "View result" (link) / "View the landing page" (button): first text node only, the icon stays.
    content.querySelectorAll('.proj-url-btn').forEach((el) => {
      const v = t(el.tagName === 'A' ? 'proj_view_result' : 'proj_view_landing', l);
      const textNode = [...el.childNodes].find(n => n.nodeType === 3 && n.nodeValue.trim());
      if (v && textNode) textNode.nodeValue = `\n        ${v} `;
    });
  }

  let renderedOnce = false;
  let lastLang = null;
  function render(langArg, opts) {
    const l = lang(langArg);
    if (renderedOnce && lastLang === l && !(opts && opts.force)) {
      renderAttributes(l);
      document.documentElement.classList.remove('i18n-pending');
      return;
    }
    const steps = [renderPricing, renderServices, renderProof, renderLedger, renderTimeline, renderFaq, renderFounder, renderAttributes];
    steps.forEach((fn) => {
      try { fn(l); } catch (err) { console.error('AgencePage.' + fn.name, err); }
    });
    if (renderedOnce && lastLang !== l) {
      rerenderShared();
      try { refreshOpenCase(l); } catch (err) { console.warn('refreshOpenCase', err); }
    }
    if (!renderedOnce) openFaqFromHash(true);
    renderedOnce = true;
    lastLang = l;
    // At boot the static [data-i18n] text is still English: keep FR copy hidden until setLang
    // (DOMContentLoaded) has swapped it in and calls back through SITE.onLangChange.
    if (!(opts && opts.boot) || l === 'en') document.documentElement.classList.remove('i18n-pending');
    mountScrollCraft();
  }

  let scApi = null;
  function mountScrollCraft() {
    if (!window.ScrollCraft || typeof window.ScrollCraft.mount !== 'function') return;
    const root = document.getElementById('view-home');
    if (!root) return;
    if (scApi && typeof scApi.destroy === 'function') scApi.destroy();
    scApi = window.ScrollCraft.mount(root);
  }

  /* ── Contact modal: preset offer (default 'unsure'), Escape, focus, Copy the message ── */
  let inertSiblings = [];
  /** aria-modal alone does not keep Tab inside the dialog: make everything else inert while it is open. */
  function setBackgroundInert(on) {
    const modal = $('contact-modal');
    if (!modal || !('inert' in HTMLElement.prototype)) return;
    if (on) {
      if (inertSiblings.length) return;
      inertSiblings = [...document.body.children].filter(el => el !== modal && el.tagName !== 'SCRIPT' && !el.inert);
      inertSiblings.forEach((el) => { el.inert = true; });
    } else {
      inertSiblings.forEach((el) => { el.inert = false; });
      inertSiblings = [];
    }
  }
  function wrapContactModal() {
    const modal = $('contact-modal');
    const orig = window.openContactModal;
    if (!modal || typeof orig !== 'function' || orig.__agWrapped) return;
    let opener = null;
    const valid = typeof AGENCY_OFFER_IDS !== 'undefined' ? AGENCY_OFFER_IDS : ['refonte', 'creation', 'accompagnement', 'custom', 'unsure'];
    const wrapped = function openContactModalAgency(arg) {
      let offer = '';
      if (typeof arg === 'string') offer = arg;
      else if (arg && Object.prototype.toString.call(arg) === '[object Object]' && typeof arg.offer === 'string') offer = arg.offer;
      if (!valid.includes(offer)) offer = '';
      opener = document.activeElement;
      try { orig.call(window, offer ? { offer } : undefined); } catch (err) { console.error('openContactModal', err); }
      const select = $('contact-offer');
      if (select) select.value = offer || 'unsure';
      const status = $('contact-copy-status');
      if (status) { status.textContent = ''; delete status.dataset.state; }
      setBackgroundInert(true);
      const firstField = offer ? select : $('contact-name');
      setTimeout(() => { try { firstField && firstField.focus({ preventScroll: true }); } catch (_) { /* ignore */ } }, 320);
      if (offer && typeof window.setFocused === 'function') {
        window.setFocused(true);
        setTimeout(() => { if (document.activeElement !== select) window.setFocused(false); }, 1200);
      }
    };
    wrapped.__agWrapped = true;
    window.openContactModal = wrapped;

    const origClose = window.closeContactModal;
    if (typeof origClose === 'function' && !origClose.__agWrapped) {
      const closeWrapped = function closeContactModalAgency() {
        try { origClose.apply(window, arguments); } catch (err) { console.error('closeContactModal', err); }
        setBackgroundInert(false);
        if (opener && typeof opener.focus === 'function' && document.contains(opener)) {
          try { opener.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
        }
        opener = null;
      };
      closeWrapped.__agWrapped = true;
      window.closeContactModal = closeWrapped;
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.classList.contains('is-open') && typeof window.closeContactModal === 'function') {
        window.closeContactModal();
      }
    });

    const copyBtn = $('contact-copy-btn');
    if (copyBtn && !copyBtn.dataset.bound) {
      copyBtn.dataset.bound = '1';
      copyBtn.addEventListener('click', copyMessage);
    }
  }

  function draftText() {
    const val = (id) => { const el = $(id); return el ? el.value : ''; };
    const l = lang();
    const select = $('contact-offer');
    const offer = (select && select.value) || 'unsure';
    const contact = (window.SITE && window.SITE.contact) || {};
    const args = { name: val('contact-name'), email: val('contact-email'), link: val('contact-link'), message: val('contact-message'), offer, offerLabel: '', lang: l };
    let subject = 'v2 studio';
    let body = '';
    try { if (typeof contact.subject === 'function') subject = contact.subject(args) || subject; } catch (_) { /* keep default */ }
    try { if (typeof contact.body === 'function') body = contact.body(args) || ''; } catch (_) { /* keep empty */ }
    return `${ta('ag_mail_to', l)} ${contact.email || EMAIL}\n${ta('ag_mail_subject', l)} ${subject}\n\n${body}`;
  }

  async function copyMessage() {
    const status = $('contact-copy-status');
    const text = draftText();
    let ok = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch (_) { ok = false; }
    if (!ok) {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
      area.remove();
    }
    if (status) {
      status.dataset.state = ok ? 'ok' : 'fail';
      status.textContent = ok ? t('contact_copied') : ta('ag_copy_failed');
      if (!ok) {
        const pre = document.createElement('textarea');
        pre.className = 'contact-copy-fallback contact-form-input';
        pre.value = text;
        pre.readOnly = true;
        pre.rows = 6;
        status.appendChild(pre);
        pre.select();
      }
    }
  }

  /* ── Delegated links: [data-scroll] and in-page anchors to agency sections ── */
  function bindScrollLinks() {
    document.addEventListener('click', (e) => {
      const a = e.target.closest && e.target.closest('[data-scroll]');
      if (!a) return;
      const id = a.getAttribute('data-scroll');
      if (!id || !$(id)) return;
      e.preventDefault();
      if (id === 'pricing' || id === 'guarantee' || id === 'faq' || id === 'process' || id === 'services' || id === 'work') {
        scrollToId(id);
      } else {
        $(id).scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
      }
      focusSection(id);
    });
  }

  /* ── Case-study text: app.js bespoke modules carry en/em dashes and straight apostrophes in their
     own templates (text and alt / title / aria-label). This page shows none (agTidyText in agence-data.js). ── */
  const TIDY_ATTRS = ['alt', 'title', 'aria-label'];
  const tidy = (s, label) => (typeof agTidyText === 'function' ? agTidyText(s, label) : s);
  const NEEDS_TIDY = /[–—]|[A-Za-zÀ-ÿ]'[A-Za-zÀ-ÿ]/;
  function tidyTextNode(node) {
    const v = node.nodeValue;
    if (!v || !NEEDS_TIDY.test(v)) return;
    const next = tidy(v, v.trim().length <= 60);
    if (next !== v) node.nodeValue = next;
  }
  function tidyAttributes(el) {
    TIDY_ATTRS.forEach((attr) => {
      const v = el.getAttribute(attr);
      if (!v || !NEEDS_TIDY.test(v)) return;
      const next = tidy(v, true);
      if (next !== v) el.setAttribute(attr, next);
    });
  }
  function cleanTextNodes(root) {
    if (!root) return;
    if (root.nodeType === 3) { tidyTextNode(root); return; }
    if (root.nodeType !== 1 || root.tagName === 'SCRIPT' || root.tagName === 'STYLE') return;
    tidyAttributes(root);
    root.querySelectorAll('[alt], [title], [aria-label]').forEach(tidyAttributes);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentNode;
      if (parent && (parent.nodeName === 'SCRIPT' || parent.nodeName === 'STYLE')) continue;
      tidyTextNode(node);
    }
  }
  function observeCaseText() {
    const content = $('proj-page-content');
    if (!content || !('MutationObserver' in window)) return;
    cleanTextNodes(content);
    new MutationObserver((records) => {
      records.forEach((rec) => {
        if (rec.type === 'characterData') cleanTextNodes(rec.target);
        else if (rec.type === 'attributes') tidyAttributes(rec.target);
        else rec.addedNodes.forEach(cleanTextNodes);
      });
    }).observe(content, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: TIDY_ATTRS });
  }

  /* ── Playground names ("Brand — Subject") follow the same typography; story-ifaces.js rendered the
     grid before this script ran, so tidy the data and render it again. ── */
  function tidyInterfaces() {
    if (typeof INTERFACES === 'undefined' || !Array.isArray(INTERFACES)) return; // story-ifaces.js global
    let changed = false;
    INTERFACES.forEach((iface) => {
      if (!iface) return;
      ['name', 'tag'].forEach((k) => {
        if (typeof iface[k] !== 'string') return;
        const next = tidy(iface[k], true);
        if (next !== iface[k]) { iface[k] = next; changed = true; }
      });
    });
    if (changed && typeof window.renderIfaceGrid === 'function') {
      try { window.renderIfaceGrid(); } catch (err) { console.warn('renderIfaceGrid', err); }
    }
  }

  /* ── Keyboard access: work rows, AI bento tiles and playground cards are <div onclick> in the
     shared renderers. Give them a tab stop, a role and Enter / Space here (page-only). ── */
  const CLICKABLE = '.proj-list-item, .ai-bento-tile, .iface-card';
  function enhanceClickables(host) {
    host.querySelectorAll(CLICKABLE).forEach((el) => {
      if (el.dataset.agKey) return;
      el.dataset.agKey = '1';
      el.setAttribute('tabindex', '0');
      el.setAttribute('role', el.classList.contains('iface-card') ? 'button' : 'link');
      const text = (sel) => [...el.querySelectorAll(sel)].map(n => n.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
      const name = text('.proj-list-name, .ai-bento-name, .iface-card-name')[0];
      if (!name) return;
      const parts = [name, ...text('.proj-list-badge'), ...text('.proj-list-subtitle')];
      el.setAttribute('aria-label', parts.join(', '));
    });
  }
  function bindClickables() {
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const el = e.target;
      if (!el || typeof el.matches !== 'function' || !el.matches(CLICKABLE)) return;
      if (e.key === ' ' && el.getAttribute('role') === 'link') return; // links activate on Enter only
      e.preventDefault();
      el.click();
    });
    ['proj-list-el', 'ai-bento-el', 'ai-bento-wide-el', 'ifaces-grid-el'].forEach((id) => {
      const host = $(id);
      if (!host) return;
      enhanceClickables(host);
      if ('MutationObserver' in window) new MutationObserver(() => enhanceClickables(host)).observe(host, { childList: true });
    });
  }

  /* ── Boot ── */
  function boot() {
    observeCaseText();
    tidyInterfaces();
    wrapNavToSection();
    wrapContactModal();
    bindClickables();
    bindServices();
    bindScrollLinks();
    render(typeof currentLang === 'string' ? currentLang : undefined, { boot: true });
    window.addEventListener('scroll', onScrollTimeline, { passive: true });
    window.addEventListener('resize', onScrollTimeline, { passive: true });
    let resizeTimer = 0;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => syncTimelineScroller(lang(typeof currentLang === 'string' ? currentLang : undefined)), 150);
    }, { passive: true });
    if (window.matchMedia) {
      const mqStack = window.matchMedia('(min-width: 901px)');
      const reorder = () => { try { renderPricing(lang(typeof currentLang === 'string' ? currentLang : undefined)); } catch (err) { console.warn('renderPricing', err); } };
      if (typeof mqStack.addEventListener === 'function') mqStack.addEventListener('change', reorder);
    }
    window.addEventListener('hashchange', () => openFaqFromHash(true));
    if (mqReduce && typeof mqReduce.addEventListener === 'function') {
      mqReduce.addEventListener('change', () => render(typeof currentLang === 'string' ? currentLang : undefined, { force: true }));
    }
  }

  window.AgencePage = { render, pulse, goToOffer, comparePackages, storyToPricing, scrollToId };

  // Safety net for the anti-flash rule: never keep the copy hidden.
  setTimeout(() => document.documentElement.classList.remove('i18n-pending'), 2500);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
