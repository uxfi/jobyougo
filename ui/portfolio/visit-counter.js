/* Portfolio footer: weekly visits + live presence (api/visits.mjs on Vercel).
 * Hidden unless the endpoint answers with a configured store. No cookie, no storage:
 * the server derives a salted, daily-rotating anonymous id from IP + user agent.
 * Heartbeat every 30 s while the tab is visible; paused when hidden. */
(function () {
  'use strict';
  var root = document.getElementById('footer-visits');
  if (!root || !window.fetch) return;
  var ENDPOINT = '/api/visits';
  var BEAT_MS = 30000;
  var MAX_FAILS = 3;
  var weekEl = root.querySelector('[data-visits="week"]');
  var liveEl = root.querySelector('[data-visits="live"]');
  var liveText = root.querySelector('[data-visits="live-text"]');
  var sepEl = root.querySelector('.footer-visits-sep');
  var timer = null;
  var fails = 0;
  var stopped = false;
  var last = null;
  var FALLBACK = {
    en: { visits_week: '{n} visits this week', visits_week_one: '{n} visit this week', visits_live: '{n} on the site right now' },
    fr: { visits_week: '{n} visites cette semaine', visits_week_one: '{n} visite cette semaine', visits_live: '{n} sur le site en ce moment' }
  };

  function lang() { return document.documentElement.lang === 'fr' ? 'fr' : 'en'; }
  function label(key, n) {
    var l = lang();
    var pack = (typeof TRANSLATIONS !== 'undefined' && TRANSLATIONS && TRANSLATIONS[l]) || null;
    var tpl = (pack && pack[key]) || FALLBACK[l][key];
    var num;
    try { num = new Intl.NumberFormat(l === 'fr' ? 'fr-FR' : 'en-US').format(n); } catch (_) { num = String(n); }
    return tpl.replace('{n}', num);
  }

  function render() {
    if (!last) return;
    var week = last.week, live = last.live;
    if (weekEl) {
      weekEl.textContent = label(week === 1 ? 'visits_week_one' : 'visits_week', week);
      weekEl.hidden = !(week > 0);
    }
    if (liveEl) {
      if (liveText) liveText.textContent = label('visits_live', live);
      liveEl.hidden = !(live > 0);
    }
    if (sepEl) sepEl.hidden = !(week > 0 && live > 0);
    root.hidden = !(week > 0 || live > 0);
  }

  function stop() {
    stopped = true;
    if (timer) { clearInterval(timer); timer = null; }
  }

  function handle(data) {
    if (!data || data.configured === false) { stop(); root.hidden = true; return; }
    if (!data.ok) { fail(); return; }
    fails = 0;
    last = { week: Math.max(0, Number(data.week) || 0), live: Math.max(0, Number(data.live) || 0) };
    render();
  }

  function fail() {
    fails += 1;
    if (fails >= MAX_FAILS) { stop(); if (!last) root.hidden = true; }
  }

  function ping(event) {
    if (stopped) return;
    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ e: event }),
      credentials: 'omit',
      cache: 'no-store',
      keepalive: event === 'leave'
    }).then(function (r) {
      if (r.status === 404) return { configured: false }; // local dev server: no endpoint
      return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status));
    }).then(handle, fail);
  }

  function start() {
    if (stopped || timer || document.visibilityState === 'hidden') return;
    timer = setInterval(function () { ping('beat'); }, BEAT_MS);
  }

  document.addEventListener('visibilitychange', function () {
    if (stopped) return;
    if (document.visibilityState === 'hidden') {
      if (timer) { clearInterval(timer); timer = null; }
    } else {
      ping('beat');
      start();
    }
  });

  window.addEventListener('pagehide', function () {
    if (stopped || !last) return;
    try {
      if (navigator.sendBeacon) navigator.sendBeacon(ENDPOINT, new Blob([JSON.stringify({ e: 'leave' })], { type: 'text/plain' }));
    } catch (_) { /* best effort */ }
  });
  window.addEventListener('pageshow', function (ev) {
    if (ev.persisted && !stopped) { ping('beat'); start(); }
  });

  // Re-render when the EN/FR switch updates <html lang>.
  if (window.MutationObserver) {
    new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  }

  function boot() {
    if (document.visibilityState === 'hidden') { start(); return; }
    ping('view');
    start();
  }
  if ('requestIdleCallback' in window) requestIdleCallback(boot, { timeout: 2500 });
  else setTimeout(boot, 800);
})();
