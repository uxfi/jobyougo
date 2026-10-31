/* v2 studio, the live bestiary (/agence/services).
   Each type of business has its spirit animal (the painted bestiary in /images/bestiary). Here the same animal is built
   in code, in real units, as a slow clean loop: lofted bodies, plumage and hair laid down in thousands of fine instances.
   Nothing to operate and nothing written on it; drag to turn it.

   This file is the engine: Three.js (self-hosted r160, imported on demand), the kit (skins, feathers, hair, swept tubes),
   drag to turn. The animals live in agence-bestiary-*.js and register themselves in
   window.AgenceBestiary.animals[id]:
     { id, frame:{r, cx, cy, floor, shadow, yaw, pitch}, x: the one number its pose is given,
       build(K) -> { root, parts, pose(x, t) } }
   Markup comes from ui/agence/services.html (#bz-stage); agence-work.js announces the chosen animal with the
   "biz-animal" event. Language follows <html lang>. */
(function () {
  'use strict';
  const B = (window.AgenceBestiary = window.AgenceBestiary || { animals: {} });
  const d = document;
  const root = d.documentElement;
  const stageEl = d.getElementById('bz-stage');
  if (!stageEl) return;

  const REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const THREE_URL = '/portfolio/vendor/three-0.160.0/build/three.module.min.js';

  let T = null;
  let K = null;
  let renderer = null;
  let scene = null;
  let cam = null;
  let shadowMesh = null;
  const cache = {};
  const S = {
    ready: false, want: '', cur: null, swapT: 0,
    yaw: 0.55, pitch: 0.16, tYaw: 0.55, tPitch: 0.16, dragging: false, lastX: 0, lastY: 0,
    t: 0, visible: false, w: 0, h: 0, activeUntil: 0, pr: 0, ft: 16, nf: 0,
  };
  const kick = () => { S.activeUntil = performance.now() + 1600; };

  /* ───────────────────────── the kit (needs THREE, built after the import) ───────────────────────── */
  function makeKit(THREE) {
    const k = { T: THREE };
    const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
    k.V = V3;
    k.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    k.lerp = (a, b, t) => a + (b - a) * t;
    k.smooth = (a, b, x) => { const t = k.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
    /* The house palette of the painted bestiary: lavender and periwinkle in the shadows, peach, apricot and rose in the
       lights, a touch of mint, a warm cream for bone. */
    k.PAL = {
      lav: '#b7a6f2', peri: '#8ea4f0', sky: '#9cc9f2', peach: '#f5b69a', apricot: '#f6c389', rose: '#f0a0c0', mint: '#98e0c4',
      cream: '#fbf4e6', ink: '#2b2a55', gold: '#f5d58a', coral: '#f08a7e',
    };
    const TAU2 = Math.PI * 2;
    const rng = (seed) => {
      let a = seed >>> 0;
      return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    };
    k.rng = rng;
    const hexRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    const mixHex = (a, b, t) => { const A = hexRgb(a); const B = hexRgb(b); return `rgb(${Math.round(A[0] + (B[0] - A[0]) * t)},${Math.round(A[1] + (B[1] - A[1]) * t)},${Math.round(A[2] + (B[2] - A[2]) * t)})`; };
    const wrap9 = (W, H, fn) => { for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) fn(dx * W, dy * H); };

    /* Micro detail lives in maps (see 3d-high-poly-models: silhouette and form in geometry, pores and barbs in material).
       Grey textures are bump maps, coloured ones multiply the glass tint. All are drawn once, tile cleanly, 128 to 512 px. */
    const TEX = {
      scales: { w: 256, h: 256, draw(g, W, H) { /* fish scales, overlapping rows */
        g.fillStyle = '#767676'; g.fillRect(0, 0, W, H);
        const nx = 8; const ny = 14; const sx = W / nx; const sy = H / ny;
        for (let row = -2; row <= ny + 1; row++) for (let col = -2; col <= nx + 1; col++) {
          const cx = (col + (row & 1 ? 0.5 : 0)) * sx; const cy = row * sy;
          const gr = g.createLinearGradient(0, cy - sy, 0, cy + sy * 1.1); gr.addColorStop(0, '#5e5e5e'); gr.addColorStop(0.55, '#b0b0b0'); gr.addColorStop(1, '#ececec');
          g.fillStyle = gr; g.beginPath(); g.ellipse(cx, cy, sx * 0.62, sy * 1.6, 0, 0, TAU2); g.fill();
          g.strokeStyle = 'rgba(30,30,30,.6)'; g.lineWidth = 1.8; g.beginPath(); g.ellipse(cx, cy, sx * 0.62, sy * 1.6, 0, 0.2, Math.PI - 0.2); g.stroke();
        }
      } },
      plumage: { w: 256, h: 256, draw(g, W, H) { /* rows of overlapping body feathers */
        g.fillStyle = '#767676'; g.fillRect(0, 0, W, H);
        const nx = 6; const ny = 9; const sx = W / nx; const sy = H / ny;
        for (let row = -2; row <= ny + 1; row++) for (let col = -2; col <= nx + 1; col++) {
          const cx = (col + (row & 1 ? 0.5 : 0)) * sx; const cy = row * sy;
          const gr = g.createLinearGradient(0, cy, 0, cy + sy * 1.5); gr.addColorStop(0, '#585858'); gr.addColorStop(0.5, '#a4a4a4'); gr.addColorStop(1, '#f0f0f0');
          g.fillStyle = gr; g.beginPath(); g.moveTo(cx - sx * 0.53, cy - sy * 0.3); g.quadraticCurveTo(cx - sx * 0.58, cy + sy * 1.3, cx, cy + sy * 1.52); g.quadraticCurveTo(cx + sx * 0.58, cy + sy * 1.3, cx + sx * 0.53, cy - sy * 0.3); g.closePath(); g.fill();
          g.strokeStyle = 'rgba(30,30,30,.55)'; g.lineWidth = 1.6; g.stroke();
          g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx, cy + sy * 1.25); g.stroke();
        }
      } },
      wrinkle: { w: 256, h: 256, draw(g, W, H, r) { /* folds of thick skin */
        g.fillStyle = '#7c7c7c'; g.fillRect(0, 0, W, H);
        const rows = 20;
        for (let q = 0; q < rows; q++) {
          const y0 = (q + 0.5) * (H / rows); const ph = r() * TAU2; const amp = 2 + r() * 3.5;
          [['#464646', 3.4, 0], ['#bcbcbc', 2.2, 3.4]].forEach(([col, lw, off]) => {
            g.strokeStyle = col; g.lineWidth = lw; g.beginPath();
            for (let x = 0; x <= W; x += 4) { const y = y0 + off + Math.sin((x / W) * TAU2 * 2 + ph) * amp + Math.sin((x / W) * TAU2 * 6 + ph * 2) * 1.2; if (x) g.lineTo(x, y); else g.moveTo(x, y); }
            g.stroke();
          });
        }
        for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(40,40,40,${0.1 + r() * 0.15})`; g.beginPath(); g.arc(r() * W, r() * H, 1 + r() * 2, 0, TAU2); g.fill(); }
      } },
      pebble: { w: 256, h: 256, draw(g, W, H, r) { /* skin bumps */
        g.fillStyle = '#7c7c7c'; g.fillRect(0, 0, W, H);
        for (let i = 0; i < 360; i++) {
          const x = r() * W; const y = r() * H; const rad = 3 + r() * 7;
          wrap9(W, H, (ox, oy) => { const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad); gr.addColorStop(0, 'rgba(232,232,232,.9)'); gr.addColorStop(1, 'rgba(124,124,124,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x + ox, y + oy, rad, 0, TAU2); g.fill(); });
        }
      } },
      fuzz: { w: 256, h: 256, draw(g, W, H, r) { /* short fur, a thorax of hair */
        g.fillStyle = '#808080'; g.fillRect(0, 0, W, H); g.lineCap = 'round'; g.lineWidth = 1.2;
        for (let i = 0; i < 800; i++) {
          const x = r() * W; const y = r() * H; const a = r() * TAU2; const l = 5 + r() * 7; g.strokeStyle = r() < 0.55 ? 'rgba(238,238,238,.38)' : 'rgba(46,46,46,.3)';
          wrap9(W, H, (ox, oy) => { g.beginPath(); g.moveTo(x + ox, y + oy); g.lineTo(x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l); g.stroke(); });
        }
      } },
      facets: { w: 256, h: 256, draw(g, W, H) { /* the lens facets of a compound eye */
        g.fillStyle = '#5c5c5c'; g.fillRect(0, 0, W, H);
        const nx = 10; const ny = 12; const sx = W / nx; const sy = H / ny;
        for (let row = -1; row <= ny + 1; row++) for (let col = -1; col <= nx + 1; col++) {
          const cx = (col + (row & 1 ? 0.5 : 0)) * sx; const cy = row * sy;
          const gr = g.createRadialGradient(cx, cy, 0, cx, cy, sx * 0.62); gr.addColorStop(0, '#f4f4f4'); gr.addColorStop(1, '#585858'); g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, sx * 0.6, 0, TAU2); g.fill();
        }
      } },
      veins: { w: 256, h: 128, draw(g, W, H, r) { /* an insect wing: leading vein, long veins, cross veins */
        g.fillStyle = '#6c6c6c'; g.fillRect(0, 0, W, H); g.lineCap = 'round';
        [[0.1, 0.1], [0.3, 0.27], [0.52, 0.47], [0.74, 0.66]].forEach(([y0, y1], i) => {
          g.strokeStyle = i === 0 ? '#fafafa' : '#dcdcdc'; g.lineWidth = i === 0 ? 5 : 2.6; g.beginPath(); g.moveTo(0, y0 * H); g.quadraticCurveTo(W * 0.55, (y0 + (y1 - y0) * 0.4) * H, W * 0.98, y1 * H); g.stroke();
        });
        g.strokeStyle = '#c4c4c4'; g.lineWidth = 1.6;
        for (let i = 0; i < 16; i++) { const x = W * (0.1 + r() * 0.8); const y = H * (0.08 + r() * 0.5); g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 10, y + H * (0.1 + r() * 0.12)); g.stroke(); }
      } },
      rays: { w: 256, h: 128, draw(g, W, H) { /* fin rays fanning from the base */
        g.fillStyle = '#767676'; g.fillRect(0, 0, W, H); g.lineCap = 'round';
        const N = 17;
        for (let i = 0; i < N; i++) { g.strokeStyle = '#f0f0f0'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(0, H * 0.5); g.lineTo(W, H * (i / (N - 1))); g.stroke(); }
        g.strokeStyle = 'rgba(40,40,40,.4)'; g.lineWidth = 1.4;
        for (let a = 0; a < 4; a++) { g.beginPath(); g.ellipse(0, H * 0.5, W * (0.4 + a * 0.2), H * 0.62, 0, -1.2, 1.2); g.stroke(); }
      } },
      feather: { w: 128, h: 128, draw(g, W, H) { /* one feather: a rachis and barbs sweeping to the tip */
        g.fillStyle = '#8a8a8a'; g.fillRect(0, 0, W, H); g.lineCap = 'round';
        g.strokeStyle = '#b8b8b8'; g.lineWidth = 1.2;
        for (let i = 0; i < 44; i++) { const x0 = (i / 44) * W; g.beginPath(); g.moveTo(x0, H / 2); g.lineTo(x0 + W * 0.16, 0); g.moveTo(x0, H / 2); g.lineTo(x0 + W * 0.16, H); g.stroke(); }
        g.strokeStyle = '#ffffff'; g.lineWidth = 3.4; g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
      } },
      plume: { w: 256, h: 128, color: true, draw(g, W, H, r) { /* one feather: a shaft, barbs that fan out and sweep to the tip, split at the edge. Alpha cuts the outline. */
        g.clearRect(0, 0, W, H); g.lineCap = 'round';
        const mid = H / 2; const N = 128;
        for (let side = -1; side <= 1; side += 2) {
          for (let i = 0; i < N; i++) {
            const f = i / N; const x0 = f * W * 0.97 + (r() - 0.5) * 1.6;
            const reach = (H / 2) * (0.97 + r() * 0.08); const sweep = W * (0.1 + r() * 0.05);
            const v = Math.round(214 + 41 * r() - 26 * (1 - f) * r());
            g.strokeStyle = `rgb(${v},${v},${v})`; g.lineWidth = 1.8 + r() * 0.9;
            g.beginPath(); g.moveTo(x0, mid); g.quadraticCurveTo(x0 + sweep * 0.3, mid + side * reach * 0.6, x0 + sweep, mid + side * reach); g.stroke();
          }
        }
        g.strokeStyle = '#ffffff'; g.lineWidth = 3.4; g.beginPath(); g.moveTo(0, mid); g.lineTo(W, mid); g.stroke();
        g.globalCompositeOperation = 'destination-out'; /* the splits a real vane has, where the barbs let go of each other */
        for (let q = 0; q < 26; q++) {
          const side = r() < 0.5 ? -1 : 1; const x = W * (0.08 + r() * 0.88); const len = 6 + r() * 16;
          g.lineWidth = 1 + r() * 1.6; g.beginPath(); g.moveTo(x, mid + side * (H / 2 + 2)); g.lineTo(x - len * 0.35, mid + side * (H / 2 - len)); g.stroke();
        }
        g.globalCompositeOperation = 'source-atop'; /* darker toward the base and along the shaft, lighter at the tip */
        let gr = g.createLinearGradient(0, 0, W, 0); gr.addColorStop(0, 'rgba(36,30,70,.42)'); gr.addColorStop(0.5, 'rgba(36,30,70,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
        gr = g.createLinearGradient(0, mid - H * 0.12, 0, mid + H * 0.12); gr.addColorStop(0, 'rgba(36,30,70,0)'); gr.addColorStop(0.5, 'rgba(36,30,70,.22)'); gr.addColorStop(1, 'rgba(36,30,70,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
        g.globalCompositeOperation = 'source-over';
      } },
      hair: { w: 256, h: 64, color: true, draw(g, W, H, r) { /* a lock of hair: fibres that part toward the tip. Alpha cuts the outline. */
        g.clearRect(0, 0, W, H); g.lineCap = 'round';
        const n = 24;
        for (let i = 0; i < n; i++) {
          const s = ((i + 0.5) / n) * 2 - 1; const v = Math.round(186 + 69 * r()); const end = W * (0.88 + 0.12 * r());
          g.strokeStyle = `rgb(${v},${v},${v})`; g.lineWidth = 1.3 + r() * 1.2;
          g.beginPath(); g.moveTo(0, H / 2 + s * H * 0.16); g.bezierCurveTo(W * 0.3, H / 2 + s * H * 0.3, W * 0.65, H / 2 + s * H * 0.46 + (r() - 0.5) * 3, end, H / 2 + s * H * 0.5); g.stroke();
        }
        g.globalCompositeOperation = 'source-atop';
        const gr = g.createLinearGradient(0, 0, W, 0); gr.addColorStop(0, 'rgba(30,24,60,.5)'); gr.addColorStop(0.6, 'rgba(30,24,60,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
        g.globalCompositeOperation = 'source-over';
      } },
      iri: { w: 128, h: 128, draw(g, W, H, r) { /* where the film is thick or thin: the painterly colour shifts */
        g.fillStyle = '#808080'; g.fillRect(0, 0, W, H);
        for (let i = 0; i < 44; i++) {
          const x = r() * W; const y = r() * H; const rad = 18 + r() * 38; const v = Math.round(55 + r() * 150);
          wrap9(W, H, (ox, oy) => { const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad); gr.addColorStop(0, `rgba(${v},${v},${v},.8)`); gr.addColorStop(1, `rgba(${v},${v},${v},0)`); g.fillStyle = gr; g.beginPath(); g.arc(x + ox, y + oy, rad, 0, TAU2); g.fill(); });
        }
      } },
      bands: { w: 64, h: 256, color: true, draw(g, W, H) { /* the striped abdomen, gold and dark violet, along the body */
        for (let y = 0; y < H; y++) {
          const t = ((y / H) * 5.4) % 1; const m = k.smooth(0.5, 0.64, t) * (1 - k.smooth(0.92, 1, t));
          g.fillStyle = mixHex('#ffe6b4', '#5a4fa6', m); g.fillRect(0, y, W, 1);
        }
      } },
      koi: { w: 512, h: 256, color: true, draw(g, W, H) { /* kohaku: orange on white, a few dark flecks */
        g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
        [[0.12, 0.22, 0.2, 0.16, '#f27a4a'], [0.62, 0.3, 0.18, 0.2, '#f27a4a'], [0.88, 0.55, 0.16, 0.26, '#f7a24f'], [0.35, 0.62, 0.2, 0.22, '#f27a4a'], [0.7, 0.82, 0.18, 0.14, '#f58b52'], [0.05, 0.7, 0.12, 0.12, '#f7a24f']].forEach(([bx, by, rx, ry, col]) => {
          [-W, 0, W].forEach((ox) => {
            g.save(); g.translate(bx * W + ox, by * H); g.scale(rx * W, ry * H);
            const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1); gr.addColorStop(0, col); gr.addColorStop(0.7, `${col}cc`); gr.addColorStop(1, `${col}00`);
            g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 1, 0, TAU2); g.fill(); g.restore();
          });
        });
        [[0.2, 0.4], [0.55, 0.15], [0.8, 0.7], [0.42, 0.88]].forEach(([bx, by]) => { g.fillStyle = 'rgba(43,42,85,.55)'; g.beginPath(); g.ellipse(bx * W, by * H, 9, 7, 0, 0, TAU2); g.fill(); });
      } },
      dapple: { w: 256, h: 256, color: true, draw(g, W, H, r) { /* a dappled grey coat */
        g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
        for (let i = 0; i < 70; i++) {
          const x = r() * W; const y = r() * H; const rad = 9 + r() * 10;
          wrap9(W, H, (ox, oy) => { const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad); gr.addColorStop(0, 'rgba(112,122,178,.5)'); gr.addColorStop(0.7, 'rgba(112,122,178,.22)'); gr.addColorStop(1, 'rgba(112,122,178,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x + ox, y + oy, rad, 0, TAU2); g.fill(); });
        }
      } },
      mottle: { w: 256, h: 256, color: true, draw(g, W, H, r) { /* an octopus's chromatophores */
        g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
        const blob = (n, r0, r1, col) => { for (let i = 0; i < n; i++) { const x = r() * W; const y = r() * H; const rad = r0 + r() * (r1 - r0); wrap9(W, H, (ox, oy) => { const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad); gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x + ox, y + oy, rad, 0, TAU2); g.fill(); }); } };
        blob(16, 26, 46, 'rgba(236,150,186,.42)'); blob(230, 2.5, 7, 'rgba(200,100,156,.6)');
      } },
      barring: { w: 256, h: 256, color: true, draw(g, W, H, r) { /* a barred plumage */
        g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
        for (let q = 0; q < 14; q++) {
          const y0 = (q + 0.5) * (H / 14); const ph = r() * TAU2; g.strokeStyle = 'rgba(112,102,186,.34)'; g.lineWidth = 4 + r() * 3; g.beginPath();
          for (let x = 0; x <= W; x += 4) { const y = y0 + Math.sin((x / W) * TAU2 * 3 + ph) * 3.5; if (x) g.lineTo(x, y); else g.moveTo(x, y); }
          g.stroke();
        }
      } },
    };
    const texCache = {};
    k.tex = (name) => {
      if (texCache[name]) return texCache[name];
      const def = TEX[name]; const c = d.createElement('canvas'); c.width = def.w; c.height = def.h;
      def.draw(c.getContext('2d'), def.w, def.h, rng(name.length * 7919 + def.w));
      const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
      if (def.color) t.colorSpace = THREE.SRGBColorSpace;
      texCache[name] = t; return t;
    };
    k.uvScale = (geo, ru, rv) => { const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * ru, uv.getY(i) * rv); uv.needsUpdate = true; return geo; };

    /* One piece of an animal (wings, body, legs...): groups its meshes. */
    class Part {
      constructor(id) { this.id = id; this.group = new THREE.Group(); this.group.name = id; this.items = []; }
      reg(mesh, kind, order) {
        mesh.userData.kind = kind; mesh.renderOrder = order; mesh.frustumCulled = false;
        if (kind === 'inner') mesh.visible = false; /* bones and organs stay in the rig but are never drawn */
        this.items.push(mesh); return mesh;
      }
    }
    k.rig = () => {
      const rootG = new THREE.Group(); const parts = [];
      return { root: rootG, parts, part(id) { const p = new Part(id); parts.push(p); rootG.add(p.group); return p; } };
    };

    /* A skin of 75% or more is painted solid; below that it stays a membrane (insect wings, fins, the web between arms, water). */
    const SOLID_FROM = 0.75;
    const frontMat = (hex, o) => {
      const op = o.op == null ? 1 : o.op; const solid = op >= SOLID_FROM;
      const m = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(hex), roughness: o.rough == null ? 0.5 : o.rough, metalness: 0,
        clearcoat: o.clear == null ? 0.35 : o.clear, clearcoatRoughness: 0.34,
        iridescence: o.iri == null ? (solid ? 0.22 : 0.85) : o.iri, iridescenceIOR: 1.3, iridescenceThicknessRange: [160, 480],
        transparent: !solid, opacity: solid ? 1 : op, depthWrite: solid, envMapIntensity: 1.05, side: o.side || THREE.FrontSide,
      });
      if (o.bump) { m.bumpMap = typeof o.bump === 'string' ? k.tex(o.bump) : o.bump; m.bumpScale = o.bumpScale == null ? 2.2 : o.bumpScale; }
      if (o.map) { m.map = typeof o.map === 'string' ? k.tex(o.map) : o.map; if (o.mapCh) { m.map = m.map.clone(); m.map.channel = o.mapCh; m.map.needsUpdate = true; } }
      if (o.vcol) m.vertexColors = true;
      if (m.iridescence > 0 && o.iriMap !== false) m.iridescenceThicknessMap = k.tex('iri');
      return m;
    };
    /* Plumage and hair: an opaque sheet whose outline is cut by the alpha of a drawn texture (barbs, fibres), so a thousand of
       them sort by depth, not by order, and the edge stays fine. */
    const plumeMat = (hex, o, name) => {
      const t = k.tex(name);
      return new THREE.MeshStandardMaterial({
        color: new THREE.Color(hex), map: t, bumpMap: t, bumpScale: Math.min(o.bumpScale == null ? 1 : o.bumpScale, 1.1),
        roughness: o.rough == null ? 0.6 : o.rough, metalness: 0, alphaTest: 0.42, alphaToCoverage: true, side: THREE.DoubleSide, envMapIntensity: 0.95,
      });
    };
    const make = (geom, mat, inst, vary) => {
      if (!inst) return new THREE.Mesh(geom, mat);
      const m = new THREE.InstancedMesh(geom, mat, inst.length);
      inst.forEach((mx, i) => m.setMatrixAt(i, mx)); m.instanceMatrix.needsUpdate = true;
      if (vary) { /* each feather or hair a little lighter or darker, a little warmer or cooler than its neighbours */
        const r = rng(inst.length * 31 + 7); const c = new THREE.Color();
        inst.forEach((_, i) => { const v = 1 - vary * r(); c.setRGB(v * (1 - 0.08 * vary * r()), v, v * (1 - 0.1 * vary * r())); m.setColorAt(i, c); });
        m.instanceColor.needsUpdate = true;
      }
      return m;
    };
    /* A solid body. A translucent one (op under 0.75) gets a dark back face drawn first, like a bubble. */
    k.glass = (part, geom, hex, o = {}) => {
      const g = new THREE.Group();
      const front = make(geom, frontMat(hex, o), o.instances, o.vary);
      if (front.material.transparent) {
        const back = make(geom, new THREE.MeshBasicMaterial({
          color: new THREE.Color(hex).lerp(new THREE.Color(k.PAL.ink), 0.5), transparent: true, opacity: o.backOp == null ? 0.34 : o.backOp, side: THREE.BackSide, depthWrite: false,
        }), o.instances);
        part.reg(back, 'back', 2); g.add(back);
      }
      part.reg(front, 'shell', 3); g.add(front); if (!o.detached) part.group.add(g);
      return g;
    };
    /* A sheet: wings, fins, petals, feathers (bump 'feather'), locks of hair (bump 'hair'). Many copies of one shape go in one draw call. */
    k.thin = (part, geom, hex, o = {}) => {
      const tex = o.bump === 'feather' ? 'plume' : o.bump === 'hair' ? 'hair' : null;
      const mat = tex ? plumeMat(hex, o, tex) : frontMat(hex, { op: o.op, side: THREE.DoubleSide, rough: o.rough == null ? 0.45 : o.rough, iri: o.iri, clear: o.clear, bump: o.bump, bumpScale: o.bumpScale, map: o.map, mapCh: o.mapCh, vcol: o.vcol });
      const m = make(geom, mat, o.instances, o.vary == null ? (tex ? 0.16 : 0) : o.vary);
      part.reg(m, 'thin', 3); if (!o.detached) part.group.add(m);
      return m;
    };
    /* Inside parts (bones, organs): kept in the rig, never drawn. */
    k.solid = (part, geom, hex, o = {}) => {
      const m = make(geom, new THREE.MeshBasicMaterial({ color: new THREE.Color(hex) }), o.instances);
      part.reg(m, 'inner', 1); if (!o.detached) part.group.add(m);
      return m;
    };
    k.lines = (part, geom, hex, op, o = {}) => {
      const m = new THREE.LineSegments(geom, new THREE.LineBasicMaterial({ color: new THREE.Color(hex), transparent: true, opacity: op == null ? 0.7 : op, depthWrite: false }));
      part.reg(m, o.kind || 'inner', 4); if (!o.detached) part.group.add(m);
      return m;
    };
    k.ball = (rx, ry, rz, seg = 28) => {
      const g = new THREE.SphereGeometry(1, seg, Math.max(12, Math.round(seg * 0.72)));
      g.scale(rx, ry == null ? rx : ry, rz == null ? rx : rz); return g;
    };
    /* A white glint: what makes an eye look alive. */
    k.spark = (part, r) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, depthWrite: false }));
      part.reg(m, 'thin', 6); return m;
    };
    /* An eye: dark glass ball, a coloured iris and a pupil that are caps of the ball, and a glint. Looks along +z. */
    k.eye = (part, o = {}) => {
      const r = o.r || 0.1; const g = new THREE.Group();
      g.add(k.glass(part, k.ball(r, r, r, 22), o.base || k.PAL.ink, { op: 1, rough: 0.05, clear: 1, iri: 0, detached: true }));
      const cap = (rad, th) => new THREE.SphereGeometry(rad, 24, 8, 0, TAU2, 0, th).rotateX(Math.PI / 2);
      g.add(k.thin(part, cap(r * 1.008, 0.72), o.iris || '#f4a64a', { op: 1, rough: 0.1, clear: 1, iri: 0, detached: true }));
      const pg = cap(r * 1.016, o.slit ? 0.5 : 0.34); if (o.slit) pg.scale(1.6, 0.28, 1);
      g.add(k.thin(part, pg, '#150f2e', { op: 1, rough: 0.08, clear: 1, iri: 0, detached: true }));
      const sp = k.spark(part, r * 0.17); sp.position.set(r * 0.3, r * 0.34, r * 0.94); g.add(sp);
      return g;
    };

    /* A swept tube whose centre line, radius and flatness change every frame (necks, trunks, arms, fish, torsos). */
    class Tube {
      constructor(n, radial, ru = 1, rv = 1) {
        this.n = n; this.radial = radial;
        const ring = radial + 1;
        const vc = (n + 1) * ring + 2;
        this.pos = new Float32Array(vc * 3);
        this.tan = new Float32Array((n + 1) * 3); this.nor = new Float32Array((n + 1) * 3); this.c = new Float32Array((n + 1) * 3);
        this.cs = new Float32Array(ring); this.sn = new Float32Array(ring);
        for (let j = 0; j <= radial; j++) { const a = (j / radial) * Math.PI * 2; this.cs[j] = Math.cos(a); this.sn[j] = Math.sin(a); }
        const uv = new Float32Array(vc * 2); const uv1 = new Float32Array(vc * 2);
        for (let i = 0; i <= n; i++) for (let j = 0; j <= radial; j++) { const q = (i * ring + j) * 2; uv[q] = (j / radial) * ru; uv[q + 1] = (i / n) * rv; uv1[q] = j / radial; uv1[q + 1] = i / n; }
        const idx = [];
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < radial; j++) {
            const a = i * ring + j; const b = a + ring;
            idx.push(a, a + 1, b, b, a + 1, b + 1);
          }
        }
        const cb = (n + 1) * ring; const ct = cb + 1;
        for (let j = 0; j < radial; j++) {
          idx.push(ct, n * ring + j, n * ring + j + 1); /* tip cap faces +t */
          idx.push(cb, j + 1, j); /* base cap faces -t */
        }
        this.geo = new THREE.BufferGeometry();
        this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
        this.geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); this.geo.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
        this.geo.setIndex(idx);
      }
      /* P: n+1 Vector3 along the axis; R: n+1 radii (the half height); hint: first "up" of the section;
         A: optional n+1 ratios, the half width over the half height (0.6 = flattened sideways). */
      set(P, R, hint, A) {
        const n = this.n; const rad = this.radial; const pos = this.pos; const ring = rad + 1;
        for (let i = 0; i <= n; i++) {
          const a = P[Math.max(0, i - 1)]; const b = P[Math.min(n, i + 1)];
          let tx = b.x - a.x; let ty = b.y - a.y; let tz = b.z - a.z;
          const l = Math.hypot(tx, ty, tz) || 1; tx /= l; ty /= l; tz /= l;
          let nx; let ny; let nz;
          if (i === 0) { nx = hint.x; ny = hint.y; nz = hint.z; } else { nx = this.nor[i * 3 - 3]; ny = this.nor[i * 3 - 2]; nz = this.nor[i * 3 - 1]; }
          let dp = nx * tx + ny * ty + nz * tz; nx -= dp * tx; ny -= dp * ty; nz -= dp * tz;
          let nl = Math.hypot(nx, ny, nz);
          if (nl < 1e-5) {
            nx = Math.abs(tx) < 0.9 ? 1 : 0; ny = nx ? 0 : 1; nz = 0;
            dp = nx * tx + ny * ty + nz * tz; nx -= dp * tx; ny -= dp * ty; nz -= dp * tz; nl = Math.hypot(nx, ny, nz);
          }
          nx /= nl; ny /= nl; nz /= nl;
          const bx = ty * nz - tz * ny; const by = tz * nx - tx * nz; const bz = tx * ny - ty * nx;
          this.tan[i * 3] = tx; this.tan[i * 3 + 1] = ty; this.tan[i * 3 + 2] = tz;
          this.nor[i * 3] = nx; this.nor[i * 3 + 1] = ny; this.nor[i * 3 + 2] = nz;
          this.c[i * 3] = P[i].x; this.c[i * 3 + 1] = P[i].y; this.c[i * 3 + 2] = P[i].z;
          const r = R[i]; const asp = A ? A[i] : 1;
          for (let j = 0; j <= rad; j++) {
            const cs = this.cs[j] * r; const sn = this.sn[j] * r * asp; const q = (i * ring + j) * 3;
            pos[q] = P[i].x + cs * nx + sn * bx; pos[q + 1] = P[i].y + cs * ny + sn * by; pos[q + 2] = P[i].z + cs * nz + sn * bz;
          }
        }
        const cb = (n + 1) * ring * 3;
        pos[cb] = P[0].x; pos[cb + 1] = P[0].y; pos[cb + 2] = P[0].z;
        pos[cb + 3] = P[n].x; pos[cb + 4] = P[n].y; pos[cb + 5] = P[n].z;
        this.geo.attributes.position.needsUpdate = true;
        this.geo.computeVertexNormals();
        const nm = this.geo.attributes.normal.array;
        for (let i = 0; i <= n; i++) { /* weld the seam so the shading has no crease */
          const q0 = i * ring * 3; const q1 = (i * ring + rad) * 3;
          const ax = nm[q0] + nm[q1]; const ay = nm[q0 + 1] + nm[q1 + 1]; const az = nm[q0 + 2] + nm[q1 + 2];
          const al = Math.hypot(ax, ay, az) || 1;
          nm[q0] = nm[q1] = ax / al; nm[q0 + 1] = nm[q1 + 1] = ay / al; nm[q0 + 2] = nm[q1 + 2] = az / al;
        }
      }
      /* Put an object on the axis at section i, its x along the axis, y along the section normal. */
      place(obj, i, scale) {
        const q = i * 3; const t = new THREE.Vector3(this.tan[q], this.tan[q + 1], this.tan[q + 2]);
        const nn = new THREE.Vector3(this.nor[q], this.nor[q + 1], this.nor[q + 2]);
        const bb = new THREE.Vector3().crossVectors(t, nn);
        obj.position.set(this.c[q], this.c[q + 1], this.c[q + 2]);
        obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(t, nn, bb));
        if (scale != null) obj.scale.setScalar(scale);
      }
    }
    k.tube = (n, radial = 14, ru = 1, rv = 1) => new Tube(n, radial, ru, rv);

    /* A static body lofted along +x from sections: r(s) half height, a(s) half width over half height, y(s) and z(s) the axis.
       s runs from the rear (0) to the front (1). k.surf(spec) walks the same skin (s along, th around) for feathers and hair. */
    k.loft = (spec) => {
      const n = spec.n || 44; const t = new Tube(n, spec.radial || 30, spec.ru || 1, spec.rv || 1);
      const start = spec.x0 == null ? -spec.len / 2 : spec.x0; const P = []; const R = []; const A = [];
      for (let i = 0; i <= n; i++) {
        const s = i / n;
        P.push(V3(start + s * spec.len, spec.y ? spec.y(s) : 0, spec.z ? spec.z(s) : 0)); R.push(Math.max(0.004, spec.r(s))); A.push(spec.a ? spec.a(s) : 1);
      }
      t.set(P, R, V3(0, 1, 0), A);
      return t.geo;
    };
    k.surf = (spec) => {
      const start = spec.x0 == null ? -spec.len / 2 : spec.x0;
      const pt = (s, th, o) => { const r = spec.r(s); const a = spec.a ? spec.a(s) : 1; return o.set(start + s * spec.len, (spec.y ? spec.y(s) : 0) + r * Math.cos(th), (spec.z ? spec.z(s) : 0) + r * a * Math.sin(th)); };
      const p0 = V3(0, 0, 0); const p1 = V3(0, 0, 0); const p2 = V3(0, 0, 0); const p3 = V3(0, 0, 0);
      return (s, th, out) => {
        pt(s, th, out.p);
        pt(Math.min(1, s + 0.004), th, p0); pt(Math.max(0, s - 0.004), th, p1); out.t.subVectors(p0, p1).normalize();
        pt(s, th + 0.02, p2); pt(s, th - 0.02, p3); p2.sub(p3).normalize();
        out.n.crossVectors(p2, out.t).normalize();
        return out;
      };
    };

    /* A sheet from a function: fn(u, v, out) with u along 0..1 and v across -1..1. Static or re-set every frame. */
    k.leaf = (nu, nv, fn) => {
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array((nu + 1) * (nv + 1) * 3); const uvs = new Float32Array((nu + 1) * (nv + 1) * 2); const idx = [];
      for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) { const q = (i * (nv + 1) + j) * 2; uvs[q] = i / nu; uvs[q + 1] = j / nv; }
      for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const a = i * (nv + 1) + j; const b = a + nv + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2)); geo.setIndex(idx);
      const out = { x: 0, y: 0, z: 0 };
      geo.userData.set = (f) => {
        let q = 0;
        for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) { f(i / nu, (j / nv) * 2 - 1, out); pos[q++] = out.x; pos[q++] = out.y; pos[q++] = out.z; }
        geo.attributes.position.needsUpdate = true; geo.computeVertexNormals();
      };
      if (fn) geo.userData.set(fn);
      return geo;
    };
    /* A feather: a pointed oval along +x, width along y, a ridge along the shaft and a camber out of the plane along z.
       The barbs themselves are in the texture (plume). */
    k.feather = (len, w, o = {}) => k.leaf(12, 2, (u, v, out) => {
      const wd = w * Math.pow(Math.sin(Math.PI * Math.pow(u, o.tip == null ? 0.72 : o.tip)), 0.8) + 0.003;
      out.x = u * len; out.y = v * wd * (v > 0 ? 1.06 : 0.94) + (o.sweep || 0) * u * len * 0.3;
      out.z = (o.curl == null ? 0.07 : o.curl) * len * u * u + wd * 0.16 * (1 - Math.abs(v));
    });
    /* A lock or a strand of hair: from the root (+x) it narrows to a point, waves a little and droops out of the plane. */
    k.hair = (len, w, o = {}) => k.leaf(o.nu || 14, o.nv || 2, (u, v, out) => {
      const wd = w * (0.3 + 0.7 * Math.sin(Math.PI * Math.pow(u, 0.6))) * (1 - Math.pow(u, 4)) + 0.0015;
      out.x = u * len; out.y = v * wd + (o.wave == null ? 0.04 : o.wave) * len * u * Math.sin(u * 5.2); out.z = (o.curl == null ? 0.1 : o.curl) * len * u * u;
    });
    /* Rows of feathers laid over a lofted skin, in ONE draw call. o: surf, geo, hex, rows, cols, s0, s1, th0, th1, size [min,max],
       lift [min,max] (radians off the skin), seed, jitter, bump, vary. They point back toward the tail, like plumage. */
    k.coat = (part, o) => {
      const rnd = rng(o.seed || 3); const out = { p: V3(0, 0, 0), n: V3(0, 0, 0), t: V3(0, 0, 0) };
      const mats = []; const rot = new THREE.Matrix4(); const q = new THREE.Quaternion(); const sc = V3(1, 1, 1);
      for (let r = 0; r < o.rows; r++) {
        const s = k.lerp(o.s0, o.s1, (r + 0.5) / o.rows);
        for (let c = 0; c < o.cols; c++) {
          const th = k.lerp(o.th0, o.th1, (c + (r & 1 ? 0.5 : 0) + 0.5 + (rnd() - 0.5) * (o.jitter == null ? 0.3 : o.jitter)) / o.cols);
          o.surf(k.clamp(s + (rnd() - 0.5) * 0.012, 0, 1), th, out);
          const lift = k.lerp(o.lift[0], o.lift[1], rnd());
          const dir = out.t.clone().multiplyScalar(-Math.cos(lift)).addScaledVector(out.n, Math.sin(lift));
          if (o.dirFn) o.dirFn(dir, out, s, th);
          dir.normalize();
          const side = V3(0, 0, 0).crossVectors(out.n, dir).normalize(); const zz = V3(0, 0, 0).crossVectors(dir, side);
          rot.makeBasis(dir, side, zz); q.setFromRotationMatrix(rot);
          const z = k.lerp(o.size[0], o.size[1], rnd()); sc.set(z, z * (o.wide || 1), z);
          mats.push(new THREE.Matrix4().compose(out.p.clone(), q.clone(), sc.clone()));
        }
      }
      return k.thin(part, o.geo, o.hex, { instances: mats, bump: o.bump || 'feather', bumpScale: o.bumpScale, rough: o.rough, vary: o.vary });
    };
    /* Matrices for a fan of feathers: each {p: origin, dir: where the length points, len, nHint: roughly the face normal, wide}. */
    k.fan = (items) => items.map((it) => {
      const d = it.dir.clone().normalize(); const side = V3(0, 0, 0).crossVectors(it.nHint, d).normalize(); const zz = V3(0, 0, 0).crossVectors(d, side);
      const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(d, side, zz));
      return new THREE.Matrix4().compose(it.p, q, V3(it.len, it.len * (it.wide || 1), it.len));
    });
    /* Fine hair standing on a lofted skin (a bee's thorax, bristles on a back): thousands of tapered curved strands, one draw call.
       o: surf, count, s0, s1, th0, th1, hex, len, r (about the root half-width), lean, seed, vary, detached. */
    k.fuzz = (part, o) => {
      const rnd = rng(o.seed || 5); const out = { p: V3(0, 0, 0), n: V3(0, 0, 0), t: V3(0, 0, 0) };
      const mats = []; const up = V3(0, 1, 0); const q = new THREE.Quaternion(); const sp = new THREE.Quaternion();
      for (let i = 0; i < o.count; i++) {
        o.surf(k.lerp(o.s0, o.s1, rnd()), k.lerp(o.th0, o.th1, rnd()), out);
        const dir = out.n.clone().addScaledVector(out.t, -(o.lean == null ? 0.6 : o.lean)).normalize(); q.setFromUnitVectors(up, dir);
        sp.setFromAxisAngle(dir, rnd() * Math.PI); q.premultiply(sp); /* turn each strand about its own axis so they do not all face one way */
        const z = k.lerp(0.65, 1.3, rnd());
        mats.push(new THREE.Matrix4().compose(out.p.clone(), q.clone(), V3(z, z * (0.8 + rnd() * 0.5), z)));
      }
      const nu = 4; const geo = k.hair(o.len || 0.09, (o.r || 0.01) * 0.8, { curl: 0.3, wave: 0.1, nu, nv: 1 }).rotateZ(Math.PI / 2);
      const col = new Float32Array(geo.attributes.position.count * 3); /* each strand is dark at the root and light at the tip */
      for (let i = 0; i < geo.attributes.position.count; i++) { const v = 0.5 + 0.5 * (Math.floor(i / 2) / nu); col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = v; }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(o.hex), vertexColors: true, roughness: 0.88, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.6 });
      const m = make(geo, mat, mats, o.vary == null ? 0.3 : o.vary);
      part.reg(m, 'thin', 3); if (!o.detached) part.group.add(m);
      return m;
    };
    return k;
  }

  /* ───────────────────────── scene ───────────────────────── */
  function makeEnv() {
    const c = d.createElement('canvas'); c.width = 512; c.height = 256; const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, '#fbf8ff'); gr.addColorStop(0.45, '#ffe6d9'); gr.addColorStop(0.7, '#d9e2ff'); gr.addColorStop(1, '#b9b4e6');
    g.fillStyle = gr; g.fillRect(0, 0, 512, 256);
    const blob = (x, y, r, a) => { const rg = g.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, `rgba(255,255,255,${a})`); rg.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = rg; g.fillRect(0, 0, 512, 256); };
    blob(110, 58, 120, 1); blob(380, 80, 70, 0.55); blob(250, 40, 50, 0.5);
    g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(300, 30, 70, 110); g.fillStyle = 'rgba(160,150,235,.5)'; g.fillRect(40, 150, 90, 70);
    const tex = new T.CanvasTexture(c); tex.mapping = T.EquirectangularReflectionMapping; tex.colorSpace = T.SRGBColorSpace;
    const pm = new T.PMREMGenerator(renderer); const rt = pm.fromEquirectangular(tex);
    scene.environment = rt.texture; tex.dispose(); pm.dispose();
  }
  function makeShadow() {
    const c = d.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
    const rg = g.createRadialGradient(64, 64, 0, 64, 64, 64); rg.addColorStop(0, 'rgba(70,58,130,.42)'); rg.addColorStop(0.55, 'rgba(70,58,130,.14)'); rg.addColorStop(1, 'rgba(70,58,130,0)');
    g.fillStyle = rg; g.fillRect(0, 0, 128, 128);
    const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace;
    shadowMesh = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    shadowMesh.rotation.x = -Math.PI / 2; shadowMesh.renderOrder = 0; scene.add(shadowMesh);
  }

  async function boot() {
    try {
      T = await import(THREE_URL);
    } catch (e) { return; }
    try {
      const canvas = stageEl.querySelector('canvas');
      renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch (e) { return; }
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = T.NoToneMapping;
    scene = new T.Scene();
    cam = new T.PerspectiveCamera(30, 1, 0.1, 100);
    K = makeKit(T);
    makeEnv(); makeShadow();
    const key = new T.DirectionalLight(0xffffff, 1.7); key.position.set(-3, 5, 4); scene.add(key);
    scene.add(new T.HemisphereLight(0xdfe3ff, 0xffe0d2, 0.85));
    S.ready = true;
    resize();
    if (S.want) show(S.want);
    requestAnimationFrame(frame);
  }

  /* ───────────────────────── animals ───────────────────────── */
  function makeAnimal(id, def) {
    const inst = def.build(K);
    return { id, def, inst, x: def.x };
  }

  function setLive(on) {
    const art = d.getElementById('biz-art');
    if (art) art.classList.toggle('bz-live', on);
    stageEl.dataset.state = on ? 'ready' : 'off';
  }

  /* Changing animal: the stage fades out, the new animal is swapped in behind it, the stage fades back in. */
  function show(id) {
    if (!id) return;
    S.want = id;
    if (!S.ready) return;
    const def = B.animals[id];
    if (!def) { setLive(false); return; }
    if (S.cur && S.cur.id === id) return;
    const swap = () => {
      if (S.want !== id) return;
      let a = cache[id];
      if (!a) {
        a = cache[id] = makeAnimal(id, def); scene.add(a.inst.root);
        try { renderer.compile(scene, cam); } catch (e) { /* the first frame compiles instead */ } /* warm the shaders before the first frame */
      }
      if (S.cur) S.cur.inst.root.visible = false;
      a.inst.root.visible = true; S.cur = a;
      S.tYaw = (def.frame.yaw == null ? 0.55 : def.frame.yaw); S.tPitch = (def.frame.pitch == null ? 0.16 : def.frame.pitch);
      if (!S.dragging) { S.yaw = S.tYaw; S.pitch = S.tPitch; }
      setLive(true);
      const cap = d.getElementById('biz-caption'); /* the chapter colours of the chosen type, set by agence-work.js */
      if (cap) { stageEl.style.setProperty('--bc', cap.style.getPropertyValue('--bc')); stageEl.style.setProperty('--bc2', cap.style.getPropertyValue('--bc2')); }
      fit(); kick();
      stageEl.classList.remove('is-swap');
    };
    clearTimeout(S.swapT);
    if (S.cur) { stageEl.classList.add('is-swap'); S.swapT = setTimeout(swap, 230); } else swap();
  }

  /* ───────────────────────── camera ───────────────────────── */
  function resize() {
    if (!S.ready) return;
    const w = Math.max(2, stageEl.clientWidth); const h = Math.max(2, stageEl.clientHeight);
    S.w = w; S.h = h;
    S.pr = S.pr ? Math.min(S.pr, window.devicePixelRatio || 1) : Math.min(window.devicePixelRatio || 1, 1.75);
    renderer.setPixelRatio(S.pr);
    renderer.setSize(w, h, false);
    cam.aspect = w / h;
    fit(); kick();
  }
  function fit() {
    if (!S.ready || !S.cur) return;
    const f = S.cur.def.frame;
    const vfov = (cam.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * cam.aspect);
    S.dist = (f.r * 1.08) / Math.sin(Math.min(vfov, hfov) / 2);
    const shift = S.w > 900 ? 0.1 : S.w > 560 ? 0.04 : 0;
    cam.setViewOffset(S.w, S.h, 0, Math.round(S.h * shift), S.w, S.h);
    cam.updateProjectionMatrix();
  }

  /* ───────────────────────── frame ───────────────────────── */
  let last = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (!S.ready) return;
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016); last = now;
    if (!S.visible || d.hidden) return;
    if (REDUCED && now > S.activeUntil) return;
    /* quality steps: if frames stay slow (about 40 fps or worse) over a second and a half, render at a lower pixel ratio */
    S.ft = S.ft * 0.96 + Math.min(100, now - (S.lastRender || now)) * 0.04; S.lastRender = now;
    if (++S.nf % 90 === 0 && S.ft > 25 && S.pr > 1) { S.pr = Math.max(1, S.pr - 0.25); renderer.setPixelRatio(S.pr); renderer.setSize(S.w, S.h, false); S.ft = 16; }
    if (!REDUCED) S.t += dt;
    const a = S.cur;
    if (!a) return;
    if (!S.dragging && !REDUCED) S.tYaw += Math.sin(S.t * 0.22) * dt * 0.05;
    const ky = 1 - Math.exp(-dt * 7);
    S.yaw += (S.tYaw - S.yaw) * ky; S.pitch += (S.tPitch - S.pitch) * ky;
    const f = a.def.frame;
    const cx = f.cx || 0; /* the animal's own centre, when it is not at the origin (a long trunk, a flower) */
    cam.position.set(cx + Math.sin(S.yaw) * Math.cos(S.pitch) * S.dist, f.cy + Math.sin(S.pitch) * S.dist, Math.cos(S.yaw) * Math.cos(S.pitch) * S.dist);
    cam.lookAt(cx, f.cy, 0);
    shadowMesh.position.set(cx, f.floor, 0); shadowMesh.scale.setScalar(f.shadow);
    a.inst.pose(typeof a.x === 'function' ? a.x(S.t) : a.x, S.t);
    renderer.render(scene, cam);
  }

  /* ───────────────────────── input: drag to turn ───────────────────────── */
  const canvasEl = stageEl.querySelector('canvas');
  canvasEl.addEventListener('pointerdown', (e) => {
    S.dragging = true; S.lastX = e.clientX; S.lastY = e.clientY; kick();
    try { canvasEl.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    stageEl.classList.add('is-drag');
  });
  canvasEl.addEventListener('pointermove', (e) => {
    if (!S.dragging) return;
    S.tYaw -= (e.clientX - S.lastX) * 0.008; S.tPitch = Math.max(-0.2, Math.min(0.85, S.tPitch + (e.clientY - S.lastY) * 0.005));
    S.lastX = e.clientX; S.lastY = e.clientY; kick();
  });
  const endDrag = () => { S.dragging = false; stageEl.classList.remove('is-drag'); };
  canvasEl.addEventListener('pointerup', endDrag);
  canvasEl.addEventListener('pointercancel', endDrag);

  /* ───────────────────────── wiring ───────────────────────── */
  d.addEventListener('biz-animal', (e) => { if (e.detail && e.detail.id) show(e.detail.id); });
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(stageEl); else window.addEventListener('resize', resize);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((en) => { S.visible = en.some((x) => x.isIntersecting); if (S.visible) kick(); }, { threshold: 0 }).observe(stageEl);
  } else S.visible = true;

  function start() {
    const art = d.getElementById('biz-art');
    S.want = (art && art.dataset.cur) || 'saas';
    /* Fetch Three.js at once, in parallel with the page; build the scene when the page has settled (2.5 s at most),
       in an idle moment (700 ms at most), so the painted hero is never kept waiting and the swap is not late. */
    import(THREE_URL).catch(() => {});
    const idle = (fn) => (window.requestIdleCallback ? window.requestIdleCallback(fn, { timeout: 700 }) : setTimeout(fn, 200));
    const settled = new Promise((res) => { if (d.readyState === 'complete') res(); else { window.addEventListener('load', res, { once: true }); setTimeout(res, 2500); } });
    settled.then(() => idle(boot));
  }
  start();
})();
