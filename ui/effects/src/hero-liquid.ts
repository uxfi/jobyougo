/* Hero water lettering: loader. Small and always on; the ~400 KB WebGL/React core is only fetched when the
 * device can carry it. Anything that fails leaves the CSS aurora gradient on the words (html.has-liquid is
 * only set while the glass is really painting). ?liquid=0 turns it off, ?liquid=1 skips the device gate.  */
import type { LiquidHandle, ButtonHandle } from './hero-liquid-core';

const root = document.documentElement;
const hero = document.querySelector<HTMLElement>('.hero[data-scene="hero"]');
const wave = hero?.querySelector<HTMLElement>('.hero-wave');

/* The bottom wave only animates while the hero is on screen. */
if (hero && wave && 'IntersectionObserver' in window) {
  new IntersectionObserver((es) => {
    wave.classList.toggle('is-off', !es[es.length - 1].isIntersecting);
  }, { threshold: 0 }).observe(hero);
}

function webglOk(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl') || c.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch { return false; }
}

function deviceOk(force: boolean): boolean {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  if (matchMedia('(forced-colors: active), (prefers-reduced-transparency: reduce)').matches) return false;
  if (!webglOk()) return false;
  if (force) return true;
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  if (nav.connection?.saveData) return false;
  if (nav.deviceMemory && nav.deviceMemory <= 2) return false;
  if (nav.hardwareConcurrency && nav.hardwareConcurrency <= 2) return false;
  return true;
}

async function start(force: boolean) {
  const h1 = document.getElementById('hero-title');
  const video = hero?.querySelector<HTMLVideoElement>('video.scrub');
  const beat = hero?.querySelector<HTMLElement>('.hero-beat--1');
  if (!hero || !h1 || !video || !beat) return;
  const core = await import('./hero-liquid-core');

  let handle: LiquidHandle | null = null;
  let btn: ButtonHandle | null = null;
  const beatTitles = Array.from(hero.querySelectorAll<HTMLElement>('.beat-title'));
  const beatHandles = new Map<HTMLElement, LiquidHandle>();
  let dead = false;
  let lastSplash = 0;
  const hoverAmt = 0.5;

  const setLive = (live: boolean) => {
    root.classList.toggle('has-liquid', live);
    if (live) watchFps();
  };

  function mountBeat(title: HTMLElement) {
    beatHandles.get(title)?.destroy();
    beatHandles.delete(title);
    const em = title.querySelector<HTMLElement>('em');
    // Same glass as the first line. onLive stays quiet so a hidden beat cannot switch the headline back to the gradient.
    if (!em || root.classList.contains('i18n-mt') || !em.textContent?.trim()) return;
    const next = core.mountLiquid(em, { onLive() {} });
    if (next) beatHandles.set(title, next);
  }

  function mount() {
    if (dead) return;
    handle?.destroy(); handle = null;
    const em = h1!.querySelector<HTMLElement>('em');
    // Machine-translated copy may wrap onto two lines: the lettering is single-line, keep the gradient there.
    if (!em || root.classList.contains('i18n-mt') || !em.textContent?.trim()) return;
    handle = core.mountLiquid(em, { onLive: setLive });
    beatTitles.forEach(mountBeat);
  }

  /* Splash on entrance happens when the glass goes live. Re-mount when the copy is rewritten (language switch). */
  let pending = 0;
  new MutationObserver(() => {
    const em = h1.querySelector('em');
    if (handle && em === handle.em && em.isConnected) return;
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => { pending = requestAnimationFrame(mount); });
  }).observe(h1, { childList: true });
  beatTitles.forEach((title) => {
    new MutationObserver(() => {
      const em = title.querySelector('em');
      const current = beatHandles.get(title);
      if (current && em === current.em && em.isConnected) return;
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => { pending = requestAnimationFrame(() => mountBeat(title)); });
    }).observe(title, { childList: true });
  });
  new MutationObserver(() => {
    if (!root.classList.contains('i18n-mt')) return;
    if (handle) { handle.destroy(); handle = null; }
    beatHandles.forEach((h) => h.destroy());
    beatHandles.clear();
  }).observe(root, { attributes: true, attributeFilter: ['class'] });

  const splash = (amt: number, gap: number) => {
    const now = performance.now();
    if (!handle || now - lastSplash < gap) return;
    if (parseFloat(beat.style.opacity || '1') < 0.6) return;
    lastSplash = now;
    handle.splash(amt);
  };

  /* Hover / touch: the beat is pointer-events:none, so test the pointer against the words' own box. */
  let inside = false;
  const hit = (x: number, y: number) => {
    const em = handle?.em;
    if (!em) return false;
    const r = em.getBoundingClientRect();
    return x >= r.left - 6 && x <= r.right + 6 && y >= r.top - 10 && y <= r.bottom + 10;
  };
  window.addEventListener('pointermove', (e) => {
    const now = hit(e.clientX, e.clientY);
    if (now && !inside) splash(hoverAmt, 900);
    inside = now;
  }, { passive: true });
  window.addEventListener('pointerdown', (e) => { if (hit(e.clientX, e.clientY)) splash(0.7, 500); }, { passive: true });

  /* Back to the top of the page: the words arrive again. */
  let lastY = scrollY;
  window.addEventListener('scroll', () => {
    const y = scrollY;
    if (lastY > 220 && y < 30) splash(0.85, 1200);
    lastY = y;
  }, { passive: true });

  /* If the glass makes the page crawl (software GL, old phone), give the gradient back for good. */
  let watched = false;
  function watchFps() {
    if (watched || force) return;
    watched = true;
    setTimeout(() => {
      let n = 0, slow = 0, prev = performance.now();
      const tick = (t: number) => {
        const dt = t - prev; prev = t; n++;
        if (dt > 42) slow++;
        if (dead) return;
        if (n < 150) { requestAnimationFrame(tick); return; }
        if (slow / n > 0.45 && !document.hidden) {
          dead = true; handle?.destroy(); handle = null; btn?.destroy(); btn = null;
          beatHandles.forEach((h) => h.destroy());
          beatHandles.clear();
          console.info('hero-liquid: frame rate too low, using the gradient');
        }
      };
      requestAnimationFrame(tick);
    }, 2500);
  }

  /* The main CTA: the real link gets a glass surface behind its label; html.has-liquid-btn switches the CSS over. */
  const cta = hero.querySelector<HTMLElement>('.hero-beat--1 a.btn-glass');
  if (cta) {
    btn = core.mountGlassButton(cta, { onLive: (live) => root.classList.toggle('has-liquid-btn', live) });
    window.addEventListener('pagehide', () => { btn?.destroy(); btn = null; }, { once: true });
  }

  mount();
  (window as unknown as { __heroLiquid: unknown }).__heroLiquid = { splash: (a = 1) => handle?.splash(a), get live() { return root.classList.contains('has-liquid'); }, get btnLive() { return root.classList.contains('has-liquid-btn'); } };
}

const q = new URLSearchParams(location.search).get('liquid');
if (q !== '0' && hero && deviceOk(q === '1')) {
  const go = () => { start(q === '1').catch((e) => console.warn('hero-liquid:', e)); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go, { once: true }); else go();
}