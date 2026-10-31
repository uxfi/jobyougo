/* v2 studio, the live bestiary (/agence/services).
   Each type of business has its spirit animal (the painted bestiary in /images/bestiary). Here the same animal is built
   in code, in real units, as a small teardown simulator: ONE input (a slider), a model that is a pure function of that
   input (and of time for the idle motion), and everything on screen reads that model: the pose, the three live numbers,
   the curve under the slider, the callouts. Nothing is animated by hand and no number on screen is typed in.

   This file is the engine: Three.js (self-hosted r160, imported on demand), a glass-and-iridescence kit, drag to turn,
   three views (shell, x-ray, exploded), isolate a subsystem, callouts with leader lines, the console.
   The animals live in agence-bestiary-*.js and register themselves in window.AgenceBestiary.animals[id]:
     { id, tint, frame:{r, cy, floor, shadow, yaw, pitch}, input:{min, max, def, d, unit, label:{en,fr}, period},
       parts:[{id, en, fr}], ro:[{en, fr, unit, d}], plot: <index of the numeric readout drawn under the slider>,
       model(x) -> [three values], note:{en, fr}, build(K) -> { root, parts, anchors, pose(x, t) } }
   Markup comes from ui/agence/services.html (#bz-stage and #bz-console); agence-work.js announces the chosen animal with
   the "biz-animal" event. Language follows <html lang>. */
(function () {
  'use strict';
  const B = (window.AgenceBestiary = window.AgenceBestiary || { animals: {} });
  const d = document;
  const root = d.documentElement;
  const stageEl = d.getElementById('bz-stage');
  const consoleEl = d.getElementById('bz-console');
  if (!stageEl || !consoleEl) return;

  const REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const THREE_URL = '/portfolio/vendor/three-0.160.0/build/three.module.min.js';
  const lang = () => (root.lang === 'fr' ? 'fr' : 'en');
  const tx = (v) => (typeof agTrDeep === 'function' ? agTrDeep(v) : v);
  const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const pick = (o) => tx(o ? (o[lang()] || o.en || '') : '');

  const UI = {
    en: { shell: 'Shell', xray: 'X-ray', exploded: 'Exploded', view: 'View', parts: 'Isolate a subsystem', play: 'Play the sweep', pause: 'Pause the sweep', scene: 'Live 3D model of', drag: 'Drag to turn' },
    fr: { shell: 'Coque', xray: 'Rayons X', exploded: 'Éclaté', view: 'Vue', parts: 'Isoler un sous-système', play: 'Lancer le balayage', pause: 'Mettre le balayage en pause', scene: 'Modèle 3D en direct :', drag: 'Glisser pour tourner' },
  };
  const ui = (k) => tx((UI[lang()] || UI.en)[k] || UI.en[k] || '');

  let T = null;
  let K = null;
  let renderer = null;
  let scene = null;
  let cam = null;
  let shadowMesh = null;
  const cache = {};
  const S = {
    ready: false, want: '', cur: null, fading: [], view: 'shell', iso: null, x: 0,
    auto: !REDUCED, resume: !REDUCED, idleAt: 0, autoT: 0, autoPhase: 0,
    yaw: 0.55, pitch: 0.16, tYaw: 0.55, tPitch: 0.16, dragging: false, lastX: 0, lastY: 0,
    xr: 0, ex: 0, t: 0, visible: false, w: 0, h: 0, activeUntil: 0, tags: [], pr: 0, ft: 16, nf: 0,
  };
  const kick = () => { S.activeUntil = performance.now() + 1600; };

  /* ───────────────────────── the kit (needs THREE, built after the import) ───────────────────────── */
  function makeKit(THREE) {
    const k = { T: THREE };
    k.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    k.lerp = (a, b, t) => a + (b - a) * t;
    k.smooth = (a, b, x) => { const t = k.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
    /* The house palette of the painted bestiary: lavender and periwinkle in the shadows, peach, apricot and rose in the
       lights, a touch of mint, a warm cream for bone. */
    k.PAL = {
      lav: '#b7a6f2', peri: '#8ea4f0', sky: '#9cc9f2', peach: '#f5b69a', apricot: '#f6c389', rose: '#f0a0c0', mint: '#98e0c4',
      cream: '#fbf4e6', ink: '#2b2a55', gold: '#f5d58a', coral: '#f08a7e',
    };

    /* One piece of a subsystem: groups its meshes so the engine can fade, isolate and explode them. */
    class Part {
      constructor(id, ex) {
        this.id = id; this.group = new THREE.Group(); this.group.name = id; this.items = [];
        this.explode = new THREE.Vector3(); if (ex) this.explode.set(ex[0], ex[1], ex[2]);
        this.base = new THREE.Vector3();
      }
      reg(mesh, kind, order) {
        mesh.userData.kind = kind; mesh.userData.base = mesh.material.opacity; mesh.renderOrder = order; mesh.frustumCulled = false;
        this.items.push(mesh); return mesh;
      }
    }
    k.rig = () => {
      const rootG = new THREE.Group(); const parts = [];
      return { root: rootG, parts, part(id, ex) { const p = new Part(id, ex); parts.push(p); rootG.add(p.group); return p; } };
    };

    const frontMat = (hex, o) => new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(hex), roughness: o.rough == null ? 0.2 : o.rough, metalness: 0,
      clearcoat: 1, clearcoatRoughness: 0.16, iridescence: o.iri == null ? 1 : o.iri, iridescenceIOR: 1.35, iridescenceThicknessRange: [140, 540],
      transparent: true, opacity: o.op == null ? 0.82 : o.op, depthWrite: false, envMapIntensity: 1.35, side: o.side || THREE.FrontSide,
    });
    /* Volume glass: a dark-tinted back face drawn first, then the iridescent front face over it. */
    k.glass = (part, geom, hex, o = {}) => {
      const g = new THREE.Group();
      const back = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({
        color: new THREE.Color(hex).lerp(new THREE.Color(k.PAL.ink), 0.5), transparent: true, opacity: o.backOp == null ? 0.34 : o.backOp, side: THREE.BackSide, depthWrite: false,
      }));
      const front = new THREE.Mesh(geom, frontMat(hex, o));
      part.reg(back, 'back', 2); part.reg(front, 'shell', 3);
      g.add(back, front); if (!o.detached) part.group.add(g);
      return g;
    };
    /* Thin glass: feathers, wings, fins. One double-sided sheet. */
    k.thin = (part, geom, hex, o = {}) => {
      const mat = frontMat(hex, { op: o.op == null ? 0.6 : o.op, side: THREE.DoubleSide, rough: 0.28, iri: 1 });
      let m;
      if (o.instances) { /* many copies of one shape (the cells of a comb): one draw call */
        m = new THREE.InstancedMesh(geom, mat, o.instances.length);
        o.instances.forEach((mx, i) => m.setMatrixAt(i, mx)); m.instanceMatrix.needsUpdate = true;
      } else m = new THREE.Mesh(geom, mat);
      part.reg(m, 'thin', 3); if (!o.detached) part.group.add(m);
      return m;
    };
    /* Inside parts (bones, organs): opaque pastel, shown by the x-ray. */
    k.solid = (part, geom, hex, o = {}) => {
      const m = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({
        color: new THREE.Color(hex), roughness: o.rough == null ? 0.5 : o.rough, metalness: 0.02,
        emissive: new THREE.Color(hex), emissiveIntensity: 0.1, transparent: true, opacity: 1, side: o.side || THREE.FrontSide,
      }));
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

    /* A swept tube whose centre line and radius change every frame (necks, trunks, arms, fish bodies, tails). */
    class Tube {
      constructor(n, radial) {
        this.n = n; this.radial = radial;
        const ring = radial + 1;
        const vc = (n + 1) * ring + 2;
        this.pos = new Float32Array(vc * 3);
        this.tan = new Float32Array((n + 1) * 3); this.nor = new Float32Array((n + 1) * 3); this.c = new Float32Array((n + 1) * 3);
        this.cs = new Float32Array(ring); this.sn = new Float32Array(ring);
        for (let j = 0; j <= radial; j++) { const a = (j / radial) * Math.PI * 2; this.cs[j] = Math.cos(a); this.sn[j] = Math.sin(a); }
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
        this.geo.setIndex(idx);
      }
      /* P: n+1 Vector3 along the axis; R: n+1 radii; hint: a Vector3 for the first "up" of the section. */
      set(P, R, hint) {
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
          const r = R[i];
          for (let j = 0; j <= rad; j++) {
            const cs = this.cs[j] * r; const sn = this.sn[j] * r; const q = (i * ring + j) * 3;
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
    k.tube = (n, radial = 14) => new Tube(n, radial);

    /* A sheet from a function: fn(u, v, out) with u along 0..1 and v across -1..1. Static or re-set every frame. */
    k.leaf = (nu, nv, fn) => {
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array((nu + 1) * (nv + 1) * 3); const idx = [];
      for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const a = i * (nv + 1) + j; const b = a + nv + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setIndex(idx);
      const out = { x: 0, y: 0, z: 0 };
      geo.userData.set = (f) => {
        let q = 0;
        for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) { f(i / nu, (j / nv) * 2 - 1, out); pos[q++] = out.x; pos[q++] = out.y; pos[q++] = out.z; }
        geo.attributes.position.needsUpdate = true; geo.computeVertexNormals();
      };
      if (fn) geo.userData.set(fn);
      return geo;
    };
    k.V = (x, y, z) => new THREE.Vector3(x, y, z);
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
    inst.parts.forEach((p) => p.base.copy(p.group.position));
    return { id, def, inst, life: 0, target: 1, x: def.input.def };
  }

  function setLive(on) {
    const art = d.getElementById('biz-art');
    if (art) art.classList.toggle('bz-live', on);
    consoleEl.dataset.state = on ? 'ready' : 'off';
    stageEl.dataset.state = on ? 'ready' : 'off';
  }

  function show(id) {
    if (!id) return;
    S.want = id;
    if (!S.ready) return;
    const def = B.animals[id];
    if (!def) { setLive(false); return; }
    if (S.cur && S.cur.id === id) return;
    if (S.cur) { S.cur.target = 0; S.fading.push(S.cur); }
    let a = cache[id];
    if (!a) { a = cache[id] = makeAnimal(id, def); scene.add(a.inst.root); }
    S.fading = S.fading.filter((o) => o !== a);
    a.target = 1; a.x = S.cur && S.cur.id === id ? a.x : def.input.def;
    S.cur = a; S.iso = null; S.x = a.x; S.autoT = 0; S.autoPhase = phaseFor(def, S.x);
    S.tYaw = (def.frame.yaw == null ? 0.55 : def.frame.yaw); S.tPitch = (def.frame.pitch == null ? 0.16 : def.frame.pitch);
    setLive(true);
    const cap = d.getElementById('biz-caption'); /* the chapter colours of the chosen type, set by agence-work.js */
    if (cap) [consoleEl, stageEl].forEach((el) => { el.style.setProperty('--bc', cap.style.getPropertyValue('--bc')); el.style.setProperty('--bc2', cap.style.getPropertyValue('--bc2')); });
    buildConsole(a); buildTags(a); fit(); kick();
  }

  function phaseFor(def, x) {
    const f = k01((x - def.input.min) / (def.input.max - def.input.min));
    return Math.acos(1 - 2 * f);
  }
  const k01 = (v) => Math.max(0, Math.min(1, v));

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

  /* ───────────────────────── console ───────────────────────── */
  const ref = { views: [], chips: [], range: null, out: null, ros: [], dot: null, play: null };
  function buildConsole(a) {
    const def = a.def; const inp = def.input;
    const views = ['shell', 'xray', 'exploded'];
    consoleEl.innerHTML = `
      <div class="bz-top">
        <div class="bz-views" role="group" aria-label="${esc(ui('view'))}">${views.map((v) => `<button type="button" data-view="${v}" aria-pressed="${S.view === v}">${esc(ui(v))}</button>`).join('')}</div>
        <span class="bz-hint" aria-hidden="true">${esc(ui('drag'))}</span>
      </div>
      <div class="bz-in">
        <label class="bz-in-l" for="bz-range">${esc(pick(inp.label))}</label>
        <div class="bz-in-row">
          <button type="button" class="bz-play" aria-label="${esc(ui(S.auto ? 'pause' : 'play'))}" aria-pressed="${S.auto}"><i aria-hidden="true"></i></button>
          <div class="bz-track">
            <svg class="bz-plot" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><path class="bz-plot-line"/><line class="bz-plot-drop" x1="0" x2="0" y1="0" y2="30"/></svg>
            <i class="bz-dot" aria-hidden="true"></i>
            <input id="bz-range" type="range" min="${inp.min}" max="${inp.max}" step="${inp.step || (inp.max - inp.min) / 200}" value="${S.x}">
          </div>
          <output class="bz-out" for="bz-range"></output>
        </div>
      </div>
      <div class="bz-ros">${def.ro.map((r, i) => `<div class="bz-ro" data-i="${i}"><b></b><span class="bz-u">${esc(r.unit || '')}</span><small>${esc(pick(r))}</small></div>`).join('')}</div>
      <div class="bz-chips" role="group" aria-label="${esc(ui('parts'))}">${def.parts.map((p) => `<button type="button" class="bz-chip" data-part="${p.id}" aria-pressed="${S.iso === p.id}">${esc(pick(p))}</button>`).join('')}</div>
      <p class="bz-note">${esc(pick(def.note))}</p>`;
    ref.views = Array.from(consoleEl.querySelectorAll('[data-view]'));
    ref.chips = Array.from(consoleEl.querySelectorAll('.bz-chip'));
    ref.range = consoleEl.querySelector('#bz-range');
    ref.out = consoleEl.querySelector('.bz-out');
    ref.play = consoleEl.querySelector('.bz-play');
    ref.dot = consoleEl.querySelector('.bz-dot');
    ref.ros = Array.from(consoleEl.querySelectorAll('.bz-ro')).map((el) => ({ el, b: el.querySelector('b'), last: '' }));
    ref.line = consoleEl.querySelector('.bz-plot-line');
    ref.drop = consoleEl.querySelector('.bz-plot-drop');
    ref.outLast = '';
    /* The curve under the slider: the first numeric readout over the whole range of the input, from the model itself. */
    const pi = def.plot || 0; const N = 56; const ys = [];
    for (let i = 0; i <= N; i++) ys.push(def.model(inp.min + ((inp.max - inp.min) * i) / N)[pi]);
    const lo = Math.min(...ys); const hi = Math.max(...ys); const span = hi - lo || 1;
    ref.line.setAttribute('d', ys.map((y, i) => `${i ? 'L' : 'M'}${((i / N) * 100).toFixed(2)} ${(27 - ((y - lo) / span) * 24).toFixed(2)}`).join(' '));
    ref.plot = { lo, span };
    updateConsole(true);
  }
  function fmtNum(v, dp) { return Number(v).toLocaleString(root.lang || 'en', { minimumFractionDigits: dp || 0, maximumFractionDigits: dp || 0 }); }
  function updateConsole(force) {
    const a = S.cur; if (!a || !ref.range) return;
    const def = a.def; const inp = def.input;
    if (S.auto || force) ref.range.value = S.x;
    const frac = k01((S.x - inp.min) / (inp.max - inp.min));
    const out = inp.fmt ? inp.fmt(S.x, fmtNum) : `${fmtNum(S.x, inp.d || 0)} ${inp.unit || ''}`;
    if (out !== ref.outLast) { ref.out.textContent = out; ref.outLast = out; }
    const vals = def.model(S.x);
    def.ro.forEach((r, i) => {
      const v = vals[i]; const slot = ref.ros[i]; if (!slot) return;
      const txt = typeof v === 'number' ? fmtNum(v, r.d) : pick(v);
      if (txt !== slot.last) { slot.b.textContent = txt; slot.last = txt; }
    });
    const pv = vals[def.plot || 0];
    const px = frac * 100;
    ref.dot.style.left = `calc(8px + (100% - 16px) * ${frac.toFixed(4)})`;
    ref.dot.style.top = `${((27 - ((pv - ref.plot.lo) / ref.plot.span) * 24) / 30) * 100}%`;
    ref.drop.setAttribute('x1', px.toFixed(2)); ref.drop.setAttribute('x2', px.toFixed(2));
    const lf = ref.range.style; lf.setProperty('--f', `${(frac * 100).toFixed(2)}%`);
  }

  /* ───────────────────────── callouts ───────────────────────── */
  const NS = 'http://www.w3.org/2000/svg';
  function buildTags(a) {
    const box = stageEl.querySelector('.bz-tags'); const svg = stageEl.querySelector('.bz-leaders');
    box.innerHTML = ''; svg.innerHTML = ''; S.tags = [];
    (a.inst.anchors || []).forEach((an) => {
      const el = d.createElement('button'); el.type = 'button'; el.className = 'bz-tag'; el.dataset.part = an.part; el.tabIndex = -1; /* the chips below do the same job for the keyboard */
      const live = an.live ? '<i></i>' : '';
      el.innerHTML = `<span>${esc(pick(an))}</span>${live}`;
      box.appendChild(el);
      const line = d.createElementNS(NS, 'line'); const dot = d.createElementNS(NS, 'circle'); dot.setAttribute('r', '2.6');
      svg.appendChild(line); svg.appendChild(dot);
      S.tags.push({ an, el, line, dot, live: el.querySelector('i'), last: '' });
    });
  }
  const _v = () => new T.Vector3();
  function placeTags(a) {
    if (!S.tags.length) return;
    const v = S.v || (S.v = _v());
    const iso = S.iso;
    for (const tg of S.tags) {
      const an = tg.an;
      an.obj.updateWorldMatrix(true, false);
      v.set(an.off[0], an.off[1], an.off[2]); an.obj.localToWorld(v); v.project(cam);
      const x = (v.x * 0.5 + 0.5) * S.w; const y = (-v.y * 0.5 + 0.5) * S.h;
      const lx = x + an.dx; const ly = y + an.dy;
      const pf = iso ? (iso === an.part ? 1 : 0.1) : 1;
      const o = pf * a.life;
      tg.el.style.transform = `translate(${lx.toFixed(1)}px, ${ly.toFixed(1)}px) translate(${an.dx < 0 ? '-100%' : '0'}, -50%)`;
      tg.el.style.opacity = o.toFixed(2);
      tg.el.style.visibility = o < 0.03 ? 'hidden' : 'visible';
      tg.line.setAttribute('x1', x.toFixed(1)); tg.line.setAttribute('y1', y.toFixed(1)); tg.line.setAttribute('x2', lx.toFixed(1)); tg.line.setAttribute('y2', ly.toFixed(1));
      tg.dot.setAttribute('cx', x.toFixed(1)); tg.dot.setAttribute('cy', y.toFixed(1));
      tg.line.style.opacity = tg.dot.style.opacity = o.toFixed(2);
      if (tg.live) {
        const txt = an.live(S.x);
        if (txt !== tg.last) { tg.live.textContent = txt; tg.last = txt; }
      }
    }
  }

  /* ───────────────────────── frame ───────────────────────── */
  function applyVis(a, isCur) {
    const iso = isCur ? S.iso : null;
    for (const p of a.inst.parts) {
      const pf = iso ? (iso === p.id ? 1 : 0.06) : 1;
      const xe = iso === p.id ? Math.max(S.xr, 0.92) : S.xr;
      for (const m of p.items) {
        const kd = m.userData.kind;
        const f = kd === 'shell' ? 1 - 0.8 * xe : kd === 'back' ? 1 - 0.86 * xe : kd === 'thin' ? 1 - 0.5 * xe : K.smooth(0.04, 0.7, xe);
        const op = m.userData.base * f * pf * a.life;
        m.material.opacity = op; m.visible = op > 0.012;
        if (kd === 'inner') m.material.depthWrite = op > 0.97;
      }
      p.group.position.copy(p.base).addScaledVector(p.explode, S.ex * (isCur ? 1 : 0));
    }
  }

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
    if (a) {
      const def = a.def; const inp = def.input;
      if (!S.auto && S.resume && !S.dragging && now - S.idleAt > 25000) { S.auto = true; S.autoPhase = phaseFor(def, S.x); S.autoT = 0; syncPlay(); }
      if (S.auto) {
        S.autoT += dt;
        const f = 0.5 - 0.5 * Math.cos(S.autoPhase + (S.autoT * Math.PI * 2) / (inp.period || 16));
        S.x = inp.min + f * (inp.max - inp.min);
      }
      a.x = S.x;
      const tgt = S.view === 'shell' ? 0 : 1; const tex = S.view === 'exploded' ? 1 : 0;
      const kk = 1 - Math.exp(-dt * 6);
      S.xr += (tgt * (S.view === 'exploded' ? 0.8 : 1) - S.xr) * kk; S.ex += (tex - S.ex) * kk;
      if (!S.dragging && !REDUCED) S.tYaw += Math.sin(S.t * 0.22) * dt * 0.05;
      const ky = 1 - Math.exp(-dt * 7);
      S.yaw += (S.tYaw - S.yaw) * ky; S.pitch += (S.tPitch - S.pitch) * ky;
      const f = def.frame;
      const cx = f.cx || 0; /* the animal's own centre, when it is not at the origin (a long trunk, a flower) */
      cam.position.set(cx + Math.sin(S.yaw) * Math.cos(S.pitch) * S.dist, f.cy + Math.sin(S.pitch) * S.dist, Math.cos(S.yaw) * Math.cos(S.pitch) * S.dist);
      cam.lookAt(cx, f.cy, 0);
      shadowMesh.position.set(cx, f.floor, 0); shadowMesh.scale.setScalar(f.shadow * (1 + 0.25 * S.ex)); shadowMesh.material.opacity = a.life;
    }
    const all = a ? [a].concat(S.fading) : S.fading;
    for (const o of all) {
      o.life += (o.target - o.life) * (1 - Math.exp(-dt * 5.5));
      o.inst.root.visible = o.life > 0.01;
      o.inst.root.scale.setScalar(0.94 + 0.06 * o.life);
      if (o.inst.root.visible) { o.inst.pose(o.x, S.t); applyVis(o, o === a); }
    }
    S.fading = S.fading.filter((o) => o.target > 0 || o.life > 0.01);
    renderer.render(scene, cam);
    if (a) { placeTags(a); updateConsole(false); }
  }

  /* ───────────────────────── input ───────────────────────── */
  function syncPlay() {
    if (!ref.play) return;
    ref.play.setAttribute('aria-pressed', String(S.auto));
    ref.play.setAttribute('aria-label', ui(S.auto ? 'pause' : 'play'));
  }
  function touchIdle() { if (S.auto) { S.auto = false; syncPlay(); } S.idleAt = performance.now(); kick(); }
  function setView(v) {
    S.view = v; ref.views.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
    kick();
  }
  function setIso(id) {
    S.iso = S.iso === id ? null : id;
    ref.chips.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.part === S.iso)));
    kick();
  }
  consoleEl.addEventListener('click', (e) => {
    const v = e.target.closest('[data-view]'); if (v) { setView(v.dataset.view); return; }
    const c = e.target.closest('.bz-chip'); if (c) { setIso(c.dataset.part); return; }
    if (e.target.closest('.bz-play')) {
      S.auto = !S.auto; S.resume = S.auto; S.idleAt = performance.now();
      if (S.auto && S.cur) { S.autoPhase = phaseFor(S.cur.def, S.x); S.autoT = 0; }
      syncPlay(); kick();
    }
  });
  consoleEl.addEventListener('input', (e) => {
    if (e.target.id !== 'bz-range') return;
    touchIdle(); S.resume = true; S.x = parseFloat(e.target.value);
  });
  stageEl.addEventListener('click', (e) => { const t = e.target.closest('.bz-tag'); if (t) { setIso(t.dataset.part); } });
  const canvasEl = stageEl.querySelector('canvas');
  canvasEl.addEventListener('pointerdown', (e) => {
    S.dragging = true; S.lastX = e.clientX; S.lastY = e.clientY; touchIdle(); S.resume = true;
    try { canvasEl.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    stageEl.classList.add('is-drag');
  });
  canvasEl.addEventListener('pointermove', (e) => {
    if (!S.dragging) return;
    S.tYaw -= (e.clientX - S.lastX) * 0.008; S.tPitch = Math.max(-0.2, Math.min(0.85, S.tPitch + (e.clientY - S.lastY) * 0.005));
    S.lastX = e.clientX; S.lastY = e.clientY; kick();
  });
  const endDrag = () => { S.dragging = false; S.idleAt = performance.now(); stageEl.classList.remove('is-drag'); };
  canvasEl.addEventListener('pointerup', endDrag);
  canvasEl.addEventListener('pointercancel', endDrag);

  /* ───────────────────────── wiring ───────────────────────── */
  d.addEventListener('biz-animal', (e) => { if (e.detail && e.detail.id) show(e.detail.id); });
  new MutationObserver(() => { if (S.cur) { buildConsole(S.cur); buildTags(S.cur); } }).observe(root, { attributes: true, attributeFilter: ['lang'] });
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(stageEl); else window.addEventListener('resize', resize);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((en) => { S.visible = en.some((x) => x.isIntersecting); if (S.visible) kick(); }, { threshold: 0 }).observe(stageEl);
  } else S.visible = true;

  function start() {
    const art = d.getElementById('biz-art');
    S.want = (art && art.dataset.cur) || 'saas';
    const go = () => { boot(); };
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 400));
    if (d.readyState === 'complete') idle(go); else window.addEventListener('load', () => idle(go), { once: true });
  }
  start();
})();
