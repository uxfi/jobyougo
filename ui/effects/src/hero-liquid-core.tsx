/* Liquid-glass water lettering for the hero's last line ("customers notice" / "les remarquent").
 * simple-liquid-text 0.4.0 + simple-liquid-glass 5.4.0 (MIT), bundled locally: the glyphs refract the live,
 * scroll-scrubbed whale video through WebGL. The library has no "splash"; we ramp its refraction / dispersion /
 * specular on a damped wobble (splash()) and let it settle. Bevel is held: changing it rebuilds the glyph map. */
import { useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import LiquidGlass from 'simple-liquid-glass';
import { LiquidGlassText } from 'simple-liquid-text';
// @ts-expect-error: bundled as text by esbuild (--loader:.css=text), injected once below
import libCss from 'simple-liquid-text/styles.css';

export interface LiquidHandle {
  destroy(): void;
  splash(amount?: number): void;
  readonly em: HTMLElement;
}
export interface LiquidOptions {
  onLive(live: boolean): void;
}

const REST = { r: 88, d: 1.5, s: 0.8 }; // the library defaults

type Params = typeof REST;
interface Api { set: ((p: Params) => void) | null }

function ensureCss() {
  if (document.getElementById('hero-liquid-css')) return;
  const st = document.createElement('style');
  st.id = 'hero-liquid-css';
  st.textContent = libCss as string;
  document.head.appendChild(st);
}

function Glass({ text, api }: { text: string; api: Api }) {
  const [p, setP] = useState<Params>(REST);
  useEffect(() => { api.set = setP; return () => { api.set = null; }; }, [api]);
  // Library defaults throughout (bevel 8, border 1, fill .1, blur .3, tint .04); only the renderer is forced to WebGL so the
  // glyphs refract the scrubbed video itself, whatever the ancestors' opacity/transform do. Verified identical to native on GPU Chrome.
  return (
    <LiquidGlassText renderer="webgl" backdropSelector="#text-background" borderWidth={0.5} refraction={p.r} dispersion={p.d} specular={p.s}>
      {text}
    </LiquidGlassText>
  );
}
export function mountLiquid(em: HTMLElement, opts: LiquidOptions): LiquidHandle | null {
  const text = (em.textContent || '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  ensureCss();
  const original = em.innerHTML;
  const host = document.createElement('span');
  host.className = 'hl-host';
  em.textContent = '';
  em.appendChild(host);
  em.classList.add('has-liquid-text');

  const api: Api = { set: null };
  let root: Root | null = createRoot(host);
  root.render(<Glass text={text} api={api} />);

  // The library reports its state on data-renderer: "webgl" once the video frame is on the glyphs.
  let live = false;
  const report = () => {
    const el = host.querySelector('.slgf-layout');
    const r = el?.getAttribute('data-renderer');
    const now = r === 'webgl' || r === 'native';
    if (now !== live) { live = now; opts.onLive(now); if (now) splash(1); }
  };
  const mo = new MutationObserver(report);
  mo.observe(host, { subtree: true, attributes: true, attributeFilter: ['data-renderer'], childList: true });

  // Splash: attack, then a damped wobble. E in 0..1 scales the ramp above REST.
  let amp = 0, t0 = 0, raf = 0;
  const smooth = (x: number) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
  const energy = (now: number) => {
    const t = (now - t0) / 1000;
    return amp * smooth(t / 0.16) * Math.exp(-t / 0.8) * (0.6 + 0.4 * Math.cos((2 * Math.PI * t) / 0.62));
  };
  const loop = (now: number) => {
    raf = 0;
    if (!root) return;
    const e = energy(now);
    const t = (now - t0) / 1000;
    if (t > 2.6) { api.set?.(REST); return; }
    api.set?.({ r: REST.r + 90 * e, d: REST.d + 2.2 * e, s: REST.s + 0.5 * e });
    raf = requestAnimationFrame(loop);
  };
  function splash(amount = 1) {
    if (!root || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const now = performance.now();
    amp = Math.max(energy(now), amount);
    t0 = now;
    if (!raf) raf = requestAnimationFrame(loop);
  }

  return {
    em,
    splash,
    destroy() {
      if (!root) return;
      cancelAnimationFrame(raf); raf = 0;
      mo.disconnect();
      const r = root; root = null;
      opts.onLive(false);
      try { r.unmount(); } catch { /* already gone */ }
      if (em.isConnected && host.parentNode === em) { em.innerHTML = original; }
      em.classList.remove('has-liquid-text');
    },
  };
}

/* ── The hero's main call to action ─────────────────────────────────────────────────────────────────────────
 * The real <a> stays the control (label, focus ring, click, data-order, i18n). Behind its label we mount one glass
 * surface (simple-liquid-glass, WebGL) that refracts the same scrubbed video; the brand gradient is a translucent
 * layer painted over it by CSS (html.has-liquid-btn .btn-glass), so the hues stay visible through the glass. */
export interface ButtonHandle { destroy(): void }
const REST_LENS = [
  { strength: 0.34, depth: 0.7, bendWidth: 0.16, sheen: 1.1, specular: 1.3 },   // rest
  { strength: 0.42, depth: 0.7, bendWidth: 0.16, sheen: 1.3, specular: 1.6 },   // hover / focus
  { strength: 0.52, depth: 0.7, bendWidth: 0.18, sheen: 1.5, specular: 1.9 },   // pressed
];
function ButtonGlass({ api, onLive }: { api: { set: ((k: number) => void) | null }; onLive(live: boolean): void }) {
  const [k, setK] = useState(0);
  useEffect(() => { api.set = setK; return () => { api.set = null; }; }, [api]);
  return (
    <LiquidGlass
      renderer="webgl" backdropSelector="#text-background" material="clear" lensProfile="player"
      lensOptions={REST_LENS[k]} radius={10} dispersion={1.5} reveal="immediate"
      onDiagnosticsChange={(d) => onLive(d.strategy === 'webgl')}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
    />
  );
}
export function mountGlassButton(a: HTMLElement, opts: { onLive(live: boolean): void }): ButtonHandle {
  ensureCss();
  const host = document.createElement('span');
  host.className = 'hl-btn-glass';
  host.setAttribute('aria-hidden', 'true');
  a.insertBefore(host, a.firstChild);
  const api: { set: ((k: number) => void) | null } = { set: null };
  let root: Root | null = createRoot(host);
  root.render(<ButtonGlass api={api} onLive={opts.onLive} />);
  let hover = false, press = false;
  const apply = () => api.set?.(press ? 2 : hover ? 1 : 0);
  const on = (ev: string, fn: () => void) => { a.addEventListener(ev, fn); return () => a.removeEventListener(ev, fn); };
  const offs = [
    on('pointerenter', () => { hover = true; apply(); }), on('pointerleave', () => { hover = false; press = false; apply(); }),
    on('pointerdown', () => { press = true; apply(); }), on('pointerup', () => { press = false; apply(); }),
    on('pointercancel', () => { press = false; apply(); }),
    on('focus', () => { hover = true; apply(); }), on('blur', () => { hover = false; apply(); }),
  ];
  return {
    destroy() {
      if (!root) return;
      offs.forEach((f) => f());
      const r = root; root = null;
      opts.onLive(false);
      try { r.unmount(); } catch { /* already gone */ }
      host.remove();
    },
  };
}
