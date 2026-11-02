/* v2 studio, live bestiary, animals 2 to 4: the owl (AI products), the koi (fintech), the tortoise (real estate).
   Silhouette in lofted geometry, form in relief and instanced feathers, micro detail in maps. See agence-bestiary.js. */
(function () {
  'use strict';
  const B = (window.AgenceBestiary = window.AgenceBestiary || { animals: {} });
  const TAU = Math.PI * 2;
  const PI = Math.PI;
  const DEG = PI / 180;
  const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  /* ───────── 2. The owl · AI products · it sees clearly because the whole head turns ───────── */
  B.animals.ai = {
    id: 'ai',
    frame: { r: 1.85, cy: 1.5, floor: -0.02, shadow: 2.8, yaw: 0.3, pitch: 0.1 },
    x: (t) => 105 * Math.tanh(2.2 * Math.sin(t * 0.4)) /* the head turns to one side, holds, comes back, turns to the other */,
    build(K) {
      const T = K.T; const P = K.PAL; const V = K.V; const rig = K.rig();
      const headP = rig.part('head', [0, 0.62, 0.4]); const neckP = rig.part('neck', [0, 0.38, 1.0]); const bodyP = rig.part('body', [0, -0.5, 0]);
      const at = (g, parent, x, y, z) => { g.position.set(x, y, z); parent.add(g); return g; };
      const UP = V(0, 1, 0);

      /* perch: bark, a twig, a few leaves with veins */
      at(K.glass(bodyP, K.uvScale(new T.CylinderGeometry(0.075, 0.062, 2.9, 18).rotateZ(PI / 2), 2, 5), '#e8b07a', { op: 0.92, bump: 'pebble', bumpScale: 1.6, detached: true }), bodyP.group, 0, -0.02, 0.27);
      const twig = at(K.glass(bodyP, new T.CylinderGeometry(0.016, 0.01, 0.55, 8).translate(0, 0.27, 0), '#e8b07a', { op: 0.92, detached: true }), bodyP.group, 1.15, 0, 0.27); twig.rotation.z = -0.8;
      const leafG = K.leaf(7, 4, (u, v, o) => { const w = 0.085 * Math.sin(PI * Math.pow(u, 0.7)); o.x = u * 0.3; o.y = v * w; o.z = 0.04 * u * u; });
      bodyP.group.add(K.thin(bodyP, leafG, P.mint, {
        op: 0.92, bump: 'veins', bumpScale: 1.2,
        instances: K.fan([[1.3, 0.28, 0.29, 0.6], [1.45, 0.46, 0.25, 0.2], [1.22, 0.4, 0.3, 1.2], [1.38, 0.2, 0.27, -0.2], [1.5, 0.35, 0.29, 0.9]].map(([x, y, z, a]) => ({ p: V(x, y, z), dir: V(Math.cos(a), Math.sin(a) * 0.5 + 0.2, 0.15), len: 1, nHint: UP }))),
      }));

      /* the body: one lofted pear, barred plumage, rows of feathers over the chest and the back */
      const bodyG = at(new T.Group(), bodyP.group, 0, 0.96, -0.03); bodyG.rotation.z = PI / 2;
      const bSpec = { len: 1.7, n: 48, ru: 2, rv: 2, a: () => 0.86, r: (s) => 0.01 + 0.66 * Math.pow(Math.sin(PI * Math.pow(s, 0.7)), 0.62) * (1 - 0.1 * s) };
      bodyG.add(K.glass(bodyP, K.loft(bSpec), P.peri, { op: 0.88, bump: 'plumage', bumpScale: 1.5, map: 'barring', detached: true }));
      const bSurf = K.surf(bSpec); const feather = K.feather(0.115, 0.042, { curl: 0.1 });
      bodyG.add(K.coat(bodyP, { surf: bSurf, geo: feather, hex: P.cream, rows: 34, cols: 34, s0: 0.1, s1: 0.86, th0: PI / 2 - 1.55, th1: PI / 2 + 1.55, size: [0.9, 1.15], lift: [0.1, 0.28], seed: 3, vary: 0.22 }));
      bodyG.add(K.coat(bodyP, { surf: bSurf, geo: feather, hex: P.lav, rows: 30, cols: 34, s0: 0.18, s1: 0.9, th0: 1.5 * PI - 1.6, th1: 1.5 * PI + 1.6, size: [0.95, 1.2], lift: [0.1, 0.28], seed: 9, vary: 0.22 }));

      /* wings folded at the sides: a lofted wing, rows of coverts, a fan of long primaries */
      const wSpec = { x0: 0, len: 1.2, n: 30, ru: 1, rv: 2, a: () => 3.4, r: (s) => 0.012 + 0.06 * Math.pow(Math.sin(PI * Math.pow(s, 0.6)), 0.7) };
      const wSurf = K.surf(wSpec); const covG = K.feather(0.1, 0.036, { curl: 0.08 }); const primG = K.feather(1, 0.15, { curl: 0.04, tip: 0.75 });
      const wings = [1, -1].map((side) => {
        const wg = at(new T.Group(), bodyP.group, side * 0.66, 1.44, -0.04);
        if (side > 0) wg.rotation.z = -PI / 2 + 0.05; else wg.rotation.set(0, PI, -PI / 2 + 0.05);
        wg.add(K.glass(bodyP, K.loft(wSpec), P.lav, { op: 0.86, bump: 'plumage', bumpScale: 1.4, map: 'barring', detached: true }));
        wg.add(K.coat(bodyP, { surf: wSurf, geo: covG, hex: P.cream, rows: 16, cols: 22, s0: 0.12, s1: 0.7, th0: -1.0, th1: 1.0, size: [0.85, 1.1], lift: [0.1, 0.25], seed: 21 + side, dirFn: (dir, out) => dir.copy(out.t).multiplyScalar(0.92).addScaledVector(out.n, 0.22) }));
        const lens = [0.5, 0.56, 0.62, 0.67, 0.71, 0.73, 0.72, 0.69, 0.65, 0.6, 0.56, 0.52, 0.48, 0.44];
        wg.add(K.thin(bodyP, primG, P.lav, {
          op: 0.84, bump: 'feather', bumpScale: 1.8,
          instances: K.fan(lens.map((len, i) => { const f = (i - 6.5) * 0.055; return { p: V(0.52, 0.04, (i - 6.5) * 0.026), dir: V(Math.cos(f), 0, Math.sin(f)), len, nHint: UP }; })),
        }));
        return wg;
      });
      /* the tail: seven long feathers fanned down and back */
      bodyP.group.add(K.thin(bodyP, K.feather(1, 0.1, { curl: 0.03, tip: 0.6 }), P.lav, {
        op: 0.84, bump: 'feather', bumpScale: 1.8,
        instances: K.fan(Array.from({ length: 11 }, (_, i) => { const f = (i - 5) * 0.095; return { p: V(0, 0.4, -0.5), dir: V(Math.sin(f) * 0.5, -0.88, -0.42), len: 0.72 - Math.abs(i - 5) * 0.016, nHint: V(0, 0, 1) }; })),
      }));

      /* feathered legs and four toes with claws on each foot */
      [1, -1].forEach((s) => { at(K.glass(bodyP, K.uvScale(K.ball(0.15, 0.22, 0.14, 22), 3, 3), P.cream, { op: 0.84, bump: 'plumage', bumpScale: 1.2, detached: true }), bodyP.group, s * 0.22, 0.3, 0.2); });
      const toes = []; const claws = []; const q = new T.Quaternion();
      [1, -1].forEach((s) => [-0.5, -0.17, 0.17, 0.5, 3.1].forEach((a) => {
        const dir = V(Math.sin(a) * (a > 2 ? 0.8 : 1), -0.22, Math.cos(a) * (a > 2 ? 0.8 : 1)).normalize(); const o0 = V(s * 0.22, 0.08, 0.2); const len = a > 2 ? 0.14 : 0.2;
        q.setFromUnitVectors(UP, dir); toes.push(new T.Matrix4().compose(o0.clone().addScaledVector(dir, len / 2), q.clone(), V(1, len / 0.2, 1)));
        q.setFromUnitVectors(UP, dir.clone().add(V(0, -0.7, 0)).normalize()); claws.push(new T.Matrix4().compose(o0.clone().addScaledVector(dir, len + 0.02), q.clone(), V(1, 1, 1)));
      }));
      bodyP.group.add(K.thin(bodyP, new T.CylinderGeometry(0.028, 0.022, 0.2, 8), P.apricot, { op: 0.92, instances: toes }));
      bodyP.group.add(K.thin(bodyP, new T.ConeGeometry(0.018, 0.075, 6), '#2b2a55', { op: 0.95, instances: claws }));

      /* the head: a barred oval, two facial discs with a ruff of feathers, amber eyes with lids, a hooked beak, ear tufts */
      const headPiv = at(new T.Group(), headP.group, 0, 1.95, 0);
      headPiv.add(K.glass(headP, K.uvScale(K.ball(0.56, 0.44, 0.48, 44), 3, 2), P.peri, { op: 0.88, bump: 'plumage', bumpScale: 1.3, map: 'barring', detached: true }));
      /* a coat of small feathers over the crown, nape and sides of the head; the face stays bare for the discs and the eyes */
      const hdSurf = (s, th, out) => {
        const ph = PI * (1 - s); const sp = Math.sin(ph); const cp = Math.cos(ph); const rx = 0.56; const ry = 0.44; const rz = 0.48;
        out.p.set(rx * sp * Math.cos(th), ry * sp * Math.sin(th), rz * cp);
        out.n.set(out.p.x / (rx * rx), out.p.y / (ry * ry), out.p.z / (rz * rz)).normalize();
        out.t.set(-rx * cp * Math.cos(th), -ry * cp * Math.sin(th), rz * sp).normalize();
        return out;
      };
      headPiv.add(K.coat(headP, { surf: hdSurf, geo: K.feather(0.1, 0.038, { curl: 0.1 }), hex: P.peri, rows: 22, cols: 42, s0: 0.0, s1: 0.6, th0: 0, th1: TAU, size: [0.85, 1.1], lift: [0.1, 0.26], seed: 14, vary: 0.2 }));
      const ruff = []; const ruffG = K.feather(1, 0.15, { curl: 0.1, tip: 0.7 });
      [1, -1].forEach((s) => {
        const disc = K.glass(headP, K.uvScale(K.ball(0.25, 0.28, 0.07, 28), 2, 2), P.cream, { op: 0.84, bump: 'plumage', bumpScale: 1, detached: true }); at(disc, headPiv, s * 0.22, -0.02, 0.4); disc.rotation.y = -s * 0.36;
        for (let i = 0; i < 38; i++) { const an = (i / 38) * TAU; ruff.push({ p: V(s * (0.22 + Math.cos(an) * 0.27 * 0.95), -0.02 + Math.sin(an) * 0.3, 0.38 + Math.cos(an) * s * 0.05), dir: V(Math.cos(an) * s * 0.9, Math.sin(an), 0.18), len: 0.082, nHint: V(0, 0, 1), wide: 0.5 }); }
        const eye = K.eye(headP, { r: 0.115, iris: '#f4a64a' }); at(eye, headPiv, s * 0.21, 0.03, 0.452); eye.rotation.y = s * 0.12;
        const lid = K.glass(headP, new T.TorusGeometry(0.128, 0.02, 8, 28), P.cream, { op: 0.9, detached: true }); at(lid, headPiv, s * 0.21, 0.03, 0.455);
        [-0.1, 0, 0.1].forEach((dz) => ruff.push({ p: V(s * 0.3, 0.38, -0.02 + dz * 0.4), dir: V(s * 0.45, 1, dz), len: 0.36 + (dz === 0 ? 0.04 : 0), nHint: V(0, 0, 1), wide: 0.4 }));
      });
      headPiv.add(K.thin(headP, ruffG, P.cream, { op: 0.84, bump: 'feather', bumpScale: 1.6, instances: K.fan(ruff) }));
      const beak = K.tube(10, 12); const bp = [V(0, -0.03, 0.48), V(0, -0.04, 0.55), V(0, -0.09, 0.61), V(0, -0.16, 0.63), V(0, -0.22, 0.6)];
      const bpts = new T.CatmullRomCurve3(bp).getPoints(10); beak.set(bpts, bpts.map((_, i) => 0.055 * (1 - i / 10) + 0.006), V(1, 0, 0), bpts.map(() => 0.85));
      headPiv.add(K.glass(headP, beak.geo, P.apricot, { op: 0.96, bump: 'pebble', bumpScale: 0.6, detached: true }));
      headPiv.add(K.solid(headP, K.ball(0.4, 0.31, 0.35, 22), P.cream, { detached: true }));
      [1, -1].forEach((s) => { const sock = K.solid(headP, K.ball(0.1, 0.1, 0.07, 12), P.ink, { detached: true }); sock.position.set(s * 0.21, 0.03, 0.34); headPiv.add(sock); });

      /* the neck: 14 discs with a spur at the front so the twist can be read, one per vertebra, and the cord inside */
      const discs = [];
      for (let i = 0; i < 14; i++) {
        const g = at(new T.Group(), neckP.group, 0, 1.4 + i * (0.5 / 13), 0);
        const r = 0.17 - 0.012 * Math.sin((i / 13) * PI);
        g.add(K.solid(neckP, new T.CylinderGeometry(r, r * 0.94, 0.034, 20), P.cream, { detached: true }));
        const nub = K.solid(neckP, new T.BoxGeometry(0.06, 0.03, 0.1), P.coral, { detached: true }); nub.position.z = r + 0.02; g.add(nub);
        const wing = K.solid(neckP, new T.BoxGeometry(0.16, 0.014, 0.05), P.cream, { detached: true }); wing.position.set(0, 0, -0.01); g.add(wing);
        discs.push(g);
      }
      at(K.solid(neckP, new T.CylinderGeometry(0.02, 0.02, 0.6, 8), P.lav, { detached: true }), neckP.group, 0, 1.72, 0);

      const pose = (x, t) => {
        const th = x * DEG;
        headPiv.rotation.y = th;
        discs.forEach((g, i) => { g.rotation.y = th * (i / 13); });
        const br = 1 + 0.012 * Math.sin(TAU * 0.35 * t); bodyG.scale.set(1, br, br);
        headPiv.rotation.x = 0.03 * Math.sin(TAU * 0.2 * t);
      };
      return {
        root: rig.root, parts: rig.parts, pose,
      };
    },
  };

  /* ───────── 3. The koi · fintech · a wave that travels down the body; the faster it swims, the better it pays ───────── */
  const KOI = { len: 0.7, f: (v) => 0.6 + 1.5 * v }; /* body length in metres, tail beats per second */
  B.animals.fintech = {
    id: 'fintech',
    frame: { r: 1.75, cy: 0, floor: -0.62, shadow: 3.6, yaw: 0.25, pitch: 0.7 },
    x: 0.8,
    build(K) {
      const T = K.T; const P = K.PAL; const V = K.V; const rig = K.rig();
      const bodyP = rig.part('body', [0, 0, 0]); const finsP = rig.part('fins', [0, 0.85, 0]); const spineP = rig.part('spine', [0, -0.7, 0]);
      const N = 40; const L = 2.4; const ds = L / N;
      /* scales are a bump map that tiles, the kohaku patches a colour map drawn once (second UV set) */
      const body = K.tube(N, 28, 2.2, 1.7); const spine = K.tube(N, 6); const bladder = K.tube(12, 12);
      K.glass(bodyP, body.geo, '#fff2e4', { op: 0.9, bump: 'scales', bumpScale: 2.8, map: 'koi', mapCh: 1 });
      K.solid(spineP, spine.geo, P.cream); K.solid(spineP, bladder.geo, P.mint);
      const radius = (s) => Math.max(0.014, 0.3 * Math.pow(Math.sin(PI * Math.pow(s, 0.62)), 0.9) * (1 - 0.32 * s));
      const asp = (s) => 0.76 + 0.14 * (1 - s) * (1 - s);

      /* head: eyes with a glint, gill covers, lips, two pairs of barbels */
      const eyes = new T.Group(); bodyP.group.add(eyes);
      [1, -1].forEach((s) => { const e = K.eye(bodyP, { r: 0.062, iris: '#f2b23c' }); e.position.set(0.01, 0.075, s * 0.12); if (s < 0) e.rotation.y = PI; eyes.add(e); });
      const gillG = new T.Group(); bodyP.group.add(gillG);
      [1, -1].forEach((s) => {
        const pts = []; for (let i = 0; i <= 12; i++) { const a = -1.1 + (2.2 * i) / 12; const y = 0.17 * Math.sin(a); pts.push(V(0.06 + 0.07 * Math.cos(a), y, s * 0.205 * Math.sqrt(Math.max(0.15, 1 - (y / 0.28) * (y / 0.28))))); }
        gillG.add(K.glass(bodyP, new T.TubeGeometry(new T.CatmullRomCurve3(pts), 24, 0.008, 6), '#d0699b', { op: 0.95, detached: true }));
      });
      const mouth = new T.Group(); bodyP.group.add(mouth);
      [[0.05, 1], [0.05, -1]].forEach(([dy, s]) => { const lip = K.glass(bodyP, new T.TorusGeometry(0.05, 0.015, 8, 18).rotateY(PI / 2), P.coral, { op: 0.94, detached: true }); lip.position.set(0.02, -0.02 * s, 0); lip.scale.set(1, 0.7, 1); mouth.add(lip); });
      const barbels = new T.Group(); bodyP.group.add(barbels);
      [1, -1].forEach((s) => [[0.0, 0.18, 0.12], [0.04, 0.12, 0.08]].forEach(([x0, dz, len], k2) => {
        const c = new T.CatmullRomCurve3([V(x0, -0.05, s * 0.05), V(x0 + 0.04, -0.1 - k2 * 0.02, s * dz), V(x0 + 0.12, -0.15 - k2 * 0.03, s * (dz + 0.02))]);
        barbels.add(K.glass(bodyP, new T.TubeGeometry(c, 10, 0.007, 5), P.rose, { op: 0.94, detached: true }));
      }));

      /* fins: tail (re-shaped every frame), dorsal, two pectorals, two pelvics, an anal fin; all with fin rays */
      const tailGeo = K.leaf(12, 10, () => {});
      const tailFin = new T.Group(); finsP.group.add(tailFin);
      tailFin.add(K.thin(finsP, tailGeo, P.rose, { op: 0.64, bump: 'rays', bumpScale: 2.4, detached: true }));
      const dorsalG = K.leaf(8, 12, (u, v, o) => { const vv = (v + 1) / 2; const h = 0.32 * Math.sin(PI * Math.pow(vv, 0.8)); o.x = vv * 0.95 - u * 0.2; o.y = 0.7 * radius(Math.min(1, (14 + o.x / ds) / N)) + u * h; o.z = 0; });
      const dorsal = new T.Group(); finsP.group.add(dorsal); dorsal.add(K.thin(finsP, dorsalG, P.lav, { op: 0.62, bump: 'rays', bumpScale: 2.4, detached: true }));
      const pecG = K.leaf(10, 8, (u, vv0, o) => { const v = (vv0 + 1) / 2; const ch = 0.26 * (1 - 0.55 * u); o.x = v * ch + u * 0.34; o.y = -0.03 - 0.07 * u; o.z = 0.06 + u * 0.36; });
      const pec = [1, -1].map((s) => {
        const place = new T.Group(); finsP.group.add(place); const flap = new T.Group(); place.add(flap);
        const f = K.thin(finsP, pecG, P.mint, { op: 0.64, bump: 'rays', bumpScale: 2.2, detached: true }); if (s < 0) f.scale.z = -1; flap.add(f);
        return { place, flap, s };
      });
      const pelv = [1, -1].map((s) => { const g = new T.Group(); finsP.group.add(g); const f = K.thin(finsP, pecG, P.peach, { op: 0.62, bump: 'rays', bumpScale: 2.2, detached: true }); f.scale.set(0.7, 0.7, 0.7 * s); f.rotation.x = s * 0.55; f.position.set(0, -0.05, s * 0.02); g.add(f); return g; });
      const analG = K.leaf(8, 10, (u, v, o) => { const vv = (v + 1) / 2; const h = 0.2 * Math.sin(PI * Math.pow(vv, 0.8)); o.x = vv * 0.5 - u * 0.12; o.y = -0.7 * radius(Math.min(1, (28 + o.x / ds) / N)) - u * h; o.z = 0; });
      const anal = new T.Group(); finsP.group.add(anal); anal.add(K.thin(finsP, analG, P.peach, { op: 0.62, bump: 'rays', bumpScale: 2.2, detached: true }));

      /* the skeleton seen through the x-ray: vertebrae and ribs follow the body */
      const NV = N - 4; const vMats = Array.from({ length: NV }, () => new T.Matrix4());
      const verts = K.solid(spineP, new T.CylinderGeometry(0.04, 0.04, 0.03, 10).rotateZ(PI / 2), P.cream, { instances: vMats, detached: true }); spineP.group.add(verts);
      const NR = 13; const rMats = Array.from({ length: NR }, () => new T.Matrix4());
      const ribs = K.solid(spineP, new T.TorusGeometry(1, 0.05, 6, 12, PI).rotateY(PI / 2).rotateX(PI), P.cream, { instances: rMats, detached: true }); spineP.group.add(ribs);
      const heart = new T.Group(); spineP.group.add(heart);
      const hm = K.solid(spineP, K.ball(0.09, 0.08, 0.08, 14), P.coral, { detached: true }); hm.position.set(0.05, -0.12, 0); heart.add(hm);
      const dummy = new T.Object3D();

      const P3 = Array.from({ length: N + 1 }, () => new T.Vector3()); const R = new Array(N + 1); const Ra = new Array(N + 1); const Rs = new Array(N + 1);
      const PB = Array.from({ length: 13 }, () => new T.Vector3()); const RB = new Array(13); const AB = new Array(13).fill(0.8);
      const hint = new T.Vector3(0, 1, 0);
      const st = { ph: 0, t: 0 };
      const pose = (v, t) => {
        const dt = Math.min(0.1, Math.max(0, t - st.t)); st.t = t;
        const f = KOI.f(v); st.ph = (st.ph + f * dt) % 1000;
        const tip = (0.1 + 0.05 * v) * L;
        let x = 0; let zPrev = 0;
        for (let i = 0; i <= N; i++) {
          const s = i / N;
          const z = tip * (0.08 + 0.92 * s * s) * Math.sin(TAU * (st.ph - s));
          if (i > 0) x -= Math.sqrt(Math.max(ds * ds - (z - zPrev) * (z - zPrev), ds * ds * 0.03));
          P3[i].set(x, 0, z); zPrev = z; R[i] = radius(s); Ra[i] = asp(s); Rs[i] = Math.max(0.012, R[i] * 0.14);
        }
        const shift = -P3[N].x / 2;
        for (let i = 0; i <= N; i++) P3[i].x += shift;
        body.set(P3, R, hint, Ra); spine.set(P3, Rs, hint);
        for (let i = 0; i <= 12; i++) { const k = Math.min(N, Math.round(10 + i * 1.1)); PB[i].copy(P3[k]); RB[i] = 0.13 * Math.sin(PI * (i / 12)) + 0.01; }
        bladder.set(PB, RB, hint, AB);
        for (let i = 0; i < NV; i++) { const k = i + 2; spine.place(dummy, k); dummy.scale.setScalar(Math.max(0.3, (R[k] * 0.9) / 0.04 * 0.16)); dummy.updateMatrix(); verts.setMatrixAt(i, dummy.matrix); }
        verts.instanceMatrix.needsUpdate = true;
        for (let i = 0; i < NR; i++) { const k = 9 + i; spine.place(dummy, k); const sc = R[k] * 0.62; dummy.scale.set(sc * 0.5, sc, sc * Ra[k]); dummy.updateMatrix(); ribs.setMatrixAt(i, dummy.matrix); }
        ribs.instanceMatrix.needsUpdate = true;
        body.place(eyes, 3); body.place(gillG, 7); body.place(mouth, 0); body.place(barbels, 1); body.place(heart, 7);
        body.place(tailFin, N);
        tailGeo.userData.set((u, vv, o) => {
          const h = 0.05 + 0.46 * Math.pow(u, 1.1) * (1 - 0.22 * u);
          o.x = u * 0.8 * (1 + 0.2 * Math.abs(vv) * u); o.y = vv * h;
          o.z = 0.1 * Math.sin(TAU * (st.ph - 0.9 * u)) * u * u * (0.5 + 0.5 * Math.abs(vv)) + 0.012 * Math.sin(vv * 18 + st.ph * 6) * u;
        });
        body.place(dorsal, 14); body.place(anal, 28);
        pec.forEach((p) => { body.place(p.place, 8); p.flap.rotation.x = p.s * (0.2 + 0.25 * Math.sin(TAU * st.ph * 0.5)); });
        pelv.forEach((g) => body.place(g, 16));
      };
      return {
        root: rig.root, parts: rig.parts, pose,
      };
    },
  };

  /* ───────── 4. The tortoise · real estate · the same design from the first year to the hundredth ───────── */
  const TORT = { len: (y) => 6 + 100 * (1 - Math.exp(-y / 25)), grow: (y) => 4 * Math.exp(-y / 25), kg: (cm) => 170 * Math.pow(cm / 100, 3) };
  B.animals.proptech = {
    id: 'proptech',
    frame: { r: 2.0, cy: 0.85, floor: 0, shadow: 3.4, yaw: 0.6, pitch: 0.36 },
    x: 40,
    build(K) {
      const T = K.T; const P = K.PAL; const V = K.V; const rig = K.rig();
      const shellP = rig.part('shell', [0, 0.9, 0]); const bodyP = rig.part('body', [0, -0.5, 0]); const bonesP = rig.part('bones', [0, 0.35, 0.9]);
      const mv = [shellP, bodyP, bonesP].map((p) => { const g = new T.Group(); p.group.add(g); return g; });
      const a = 1.25; const b = 0.7; const c = 0.95; const rnd = K.rng(5);

      /* the shell: a dome whose plates stand proud of their seams (cells of a Voronoi diagram laid out like the real scutes:
         5 along the spine, 4 a side, a ring of marginals), growth rings on each plate, a tint per plate */
      const plates = [];
      for (let i = 0; i < 5; i++) plates.push({ u: -0.72 + 0.36 * i, w: 0, r: 0.2 });
      [1, -1].forEach((s) => [-0.54, -0.18, 0.18, 0.54].forEach((u) => plates.push({ u, w: s * 0.54, r: 0.21 })));
      for (let i = 0; i < 24; i++) { const an = (i / 24) * TAU; plates.push({ u: 0.935 * Math.cos(an), w: 0.935 * Math.sin(an), r: 0.12 }); }
      plates.forEach((p) => { p.h = 0.9 + 0.2 * rnd(); });
      const dome = new T.SphereGeometry(1, 150, 64, 0, TAU, 0, PI / 2);
      const pos = dome.attributes.position; const col = new Float32Array(pos.count * 3);
      const cMint = new T.Color('#7fd6b4'); const cGroove = new T.Color('#3d3478'); const cv = new T.Color(); /* vertex colours are linear: build them from Color */
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i); const y = pos.getY(i); const z = pos.getZ(i);
        let d1 = 9; let d2 = 9; let id = 0; let dr = 0;
        for (let k = 0; k < plates.length; k++) { const p = plates[k]; const dd = Math.hypot(x - p.u, z - p.w); const dn = dd / p.r; if (dn < d1) { d2 = d1; d1 = dn; id = k; dr = dd; } else if (dn < d2) d2 = dn; }
        const ridge = sm(0, 0.2, d2 - d1);
        const disp = 0.055 * ridge + 0.007 * ridge * (0.5 + 0.5 * Math.sin(dr * 90));
        pos.setXYZ(i, x * (1 + disp), y * (1 + disp * 1.1), z * (1 + disp));
        const gr = 1 - ridge;
        cv.copy(cMint).multiplyScalar(plates[id].h).lerp(cGroove, gr * 0.7); col[i * 3] = cv.r; col[i * 3 + 1] = cv.g; col[i * 3 + 2] = cv.b;
      }
      /* the shell has an opening at the front for the neck and a small one at the back for the tail */
      const di = dome.index.array; const keep = [];
      for (let i = 0; i < di.length; i += 3) {
        const ia = di[i]; const ib = di[i + 1]; const ic = di[i + 2];
        const cx = (pos.getX(ia) + pos.getX(ib) + pos.getX(ic)) / 3; const cy = (pos.getY(ia) + pos.getY(ib) + pos.getY(ic)) / 3; const cz = (pos.getZ(ia) + pos.getZ(ib) + pos.getZ(ic)) / 3;
        const front = cx > 0.7 && cy < 0.66 && Math.abs(cz) < 0.3; const rear = cx < -0.8 && cy < 0.22 && Math.abs(cz) < 0.16;
        if (!front && !rear) keep.push(ia, ib, ic);
      }
      dome.setIndex(keep);
      dome.setAttribute('color', new T.BufferAttribute(col, 3)); dome.scale(a, b, c); dome.computeVertexNormals(); K.uvScale(dome, 10, 5);
      mv[0].add(K.glass(shellP, dome, '#ffffff', { op: 0.92, vcol: true, bump: 'pebble', bumpScale: 1.0, side: T.DoubleSide, detached: true }));
      mv[0].add(K.glass(shellP, K.uvScale(K.ball(1.14, 0.1, 0.88, 44), 4, 2), P.lav, { op: 0.84, bump: 'pebble', bumpScale: 0.8, detached: true }));
      /* the adult outline on the ground: how far the shell still has to grow */
      const outline = K.lines(shellP, new T.BufferGeometry().setFromPoints(Array.from({ length: 97 }, (_, i) => { const ang = (i / 96) * TAU; return new T.Vector3(Math.cos(ang) * 1.3, 0.004, Math.sin(ang) * 1.0); }).flatMap((p, i, arr) => (i < arr.length - 1 ? [p, arr[i + 1]] : []))), P.ink, 0.28, { kind: 'thin', detached: true });
      shellP.group.add(outline);

      /* neck and head: a short neck with folds of skin that leaves by the opening in the shell, a domed skull, a snout and a jaw, a brow,
         eyes with lids and a glint, nostrils, a horny beak */
      const headG = new T.Group(); headG.position.set(1.2, 0.26, 0); headG.rotation.z = 0.2; mv[1].add(headG);
      const skin = { op: 0.94, bump: 'scales', bumpScale: 1.4, detached: true };
      headG.add(K.glass(bodyP, K.loft({ x0: -0.5, len: 0.65, n: 20, radial: 24, ru: 3, rv: 1, a: () => 1, r: (s) => 0.225 - 0.07 * Math.pow(s, 0.8) }), P.peach, { ...skin, bump: 'wrinkle', bumpScale: 0.7 }));
      [].forEach((fx) => { const fold = K.glass(bodyP, new T.TorusGeometry(0.205, 0.02, 8, 26).rotateY(PI / 2), '#eeab8c', { op: 0.94, detached: true }); fold.position.set(fx, 0, 0); headG.add(fold); });
      const skullG = K.glass(bodyP, K.uvScale(K.ball(0.27, 0.205, 0.2, 30), 3, 2), P.peach, skin); skullG.position.set(0.27, 0.03, 0); headG.add(skullG);
      const snout = K.glass(bodyP, K.uvScale(K.ball(0.17, 0.12, 0.125, 22), 2, 2), P.peach, skin); snout.position.set(0.5, 0.0, 0); headG.add(snout);
      const jaw = K.glass(bodyP, K.ball(0.19, 0.055, 0.12, 18), '#eeab8c', { op: 0.94, detached: true }); jaw.position.set(0.46, -0.1, 0); headG.add(jaw);
      [1, -1].forEach((sg) => {
        const ry = sg > 0 ? 1.0 : PI - 1.0;
        const e = K.eye(bodyP, { r: 0.055, iris: '#c9803a' }); e.position.set(0.38, 0.1, sg * 0.165); e.rotation.y = ry; headG.add(e);
        const lid = K.glass(bodyP, new T.TorusGeometry(0.063, 0.014, 8, 20), '#eeab8c', { op: 0.95, detached: true }); lid.position.set(0.38, 0.1, sg * 0.163); lid.rotation.y = ry; headG.add(lid);
        const brow = K.glass(bodyP, K.ball(0.1, 0.03, 0.07, 14), '#eeab8c', { op: 0.94, detached: true }); brow.position.set(0.34, 0.2, sg * 0.12); brow.rotation.z = -0.15; headG.add(brow);
        const cheek = K.glass(bodyP, K.ball(0.12, 0.09, 0.06, 14), P.peach, { op: 0.9, bump: 'scales', detached: true }); cheek.position.set(0.25, -0.04, sg * 0.16); headG.add(cheek);
        const nos = K.glass(bodyP, K.ball(0.014, 0.014, 0.014, 6), P.ink, { op: 0.96, detached: true }); nos.position.set(0.63, 0.05, sg * 0.03); headG.add(nos);
      });
      const beak = K.glass(bodyP, new T.ConeGeometry(0.08, 0.16, 10).rotateZ(-PI / 2 - 0.3), '#e6b07a', { op: 0.96, bump: 'pebble', detached: true }); beak.position.set(0.66, -0.02, 0); headG.add(beak);

      /* four columnar legs: lofted, big scales, a flared foot with four toenails; and a short tail */
      const legSpec = { x0: 0, len: 0.66, n: 22, radial: 20, ru: 3, rv: 1.5, a: () => 1.08, r: (s) => (0.19 - 0.045 * s + 0.05 * sm(0.8, 0.96, s)) * (1 - sm(0.975, 1, s)) + 0.005 };
      const legs = [];
      const nailG = new T.ConeGeometry(0.03, 0.085, 6).rotateZ(-PI / 2);
      [[0.62, 0.48, 0], [0.62, -0.48, 0.5], [-0.68, 0.46, 0.5], [-0.68, -0.46, 0]].forEach(([x, z, ph]) => {
        const hip = new T.Group(); hip.position.set(x, 0.3, z); mv[1].add(hip);
        const lg = new T.Group(); lg.rotation.z = -PI / 2; hip.add(lg);
        lg.add(K.glass(bodyP, K.loft(legSpec), P.peach, { op: 0.9, bump: 'scales', bumpScale: 2.2, detached: true }));
        const foot = K.glass(bodyP, K.ball(0.25, 0.07, 0.24, 18), P.peach, { op: 0.9, bump: 'pebble', bumpScale: 1, detached: true }); foot.position.set(0.05, -0.64, 0); hip.add(foot);
        const nails = [-0.15, -0.05, 0.05, 0.15].map((dz) => new T.Matrix4().compose(V(0.26, -0.67, dz * 1.1), new T.Quaternion().setFromEuler(new T.Euler(0, dz * 1.2, 0)), V(1, 1, 1)));
        hip.add(K.thin(bodyP, nailG, '#fff3dd', { op: 0.96, instances: nails }));
        legs.push({ hip, ph });
      });
      const tailG = K.glass(bodyP, new T.ConeGeometry(0.11, 0.38, 12).rotateZ(PI / 2), P.peach, { op: 0.9, bump: 'scales', detached: true }); tailG.position.set(-1.3, 0.2, 0); mv[1].add(tailG);

      /* the skeleton seen by the x-ray: a skull, a spine, eight pairs of ribs fused into the dome, a pelvis */
      mv[2].add(K.solid(bonesP, new T.CylinderGeometry(0.045, 0.045, 2.3, 10).rotateZ(PI / 2).translate(0, 0.62, 0), P.cream, { detached: true }));
      const skull = K.solid(bonesP, K.ball(0.26, 0.17, 0.17, 18), P.cream, { detached: true }); skull.position.set(1.55, 0.33, 0); mv[2].add(skull);
      const pelvis = K.solid(bonesP, K.ball(0.18, 0.14, 0.36, 14), P.cream, { detached: true }); pelvis.position.set(-0.85, 0.5, 0); mv[2].add(pelvis);
      for (let k = 0; k < 8; k++) {
        const x = (-0.72 + k * 0.205) * a;
        [1, -1].forEach((s) => {
          const pts = []; for (let i = 0; i <= 10; i++) { const z = s * c * 0.86 * (i / 10); const rr = 1 - (x / a) * (x / a) - (z / (c * 0.86)) * (z / (c * 0.86)); pts.push(new T.Vector3(x, 0.05 + 0.58 * Math.sqrt(Math.max(0, rr)), z)); }
          mv[2].add(K.solid(bonesP, new T.TubeGeometry(new T.CatmullRomCurve3(pts), 14, 0.03, 6), P.cream, { detached: true }));
        });
      }

      const pose = (y, t) => {
        const sc = TORT.len(y) / 106; const vs = 0.22 + 0.78 * sc;
        mv.forEach((m) => { m.scale.setScalar(vs); m.position.y = 0.37 * vs; });
        const kid = 1 + 0.55 * (1 - sc); /* the young have a bigger head and longer legs for their shell */
        headG.scale.setScalar(kid); headG.position.x = 1.28 + 0.05 * Math.sin(TAU * 0.3 * t); headG.rotation.z = 0.06 * Math.sin(TAU * 0.3 * t + 1);
        legs.forEach((l) => { l.hip.rotation.z = 0.2 * Math.sin(TAU * 0.28 * t + l.ph * TAU); l.hip.scale.setScalar(1 + 0.25 * (1 - sc)); });
        mv[0].rotation.z = 0.012 * Math.sin(TAU * 0.28 * t);
      };
      return {
        root: rig.root, parts: rig.parts, pose,
      };
    },
  };
  /* The owl as a modelled file (models/owl.glb): perched, it breathes and turns its head about the neck, to one side, holds, and back.
     The head is the part of the skin above the neck, twisted about a vertical axis with a weight that grows up the neck. */
  B.animals.ai.glb = '/portfolio/models/owl.glb?v=1';
  B.animals.ai.frameGlb = { r: 1.7, cx: 0, cy: 1.15, floor: 0.2, shadow: 2.6, yaw: 0.3, pitch: 0.1 };
  B.animals.ai.buildGlb = (K, gltf) => {
    const T = K.T; const root = new T.Group(); const turn = new T.Group(); const body = gltf.scene;
    const box = new T.Box3().setFromObject(body); const size = box.getSize(new T.Vector3()); const mid = box.getCenter(new T.Vector3());
    const sc = 2.4 / size.y; body.position.set(-mid.x, -box.min.y, -mid.z); const fit = new T.Group(); fit.add(body); fit.scale.setScalar(sc);
    body.traverse((o) => { if (o.isMesh) { o.material.side = T.FrontSide; o.material.envMapIntensity = 0.7; o.material.metalness = Math.min(o.material.metalness, 0.1); o.frustumCulled = false; } });
    turn.add(fit); root.add(turn);
    /* a bare branch under the talons (the toes end 0.47 above the foot of the model, about 0.15 forward) */
    const bark = new T.MeshStandardMaterial({ color: 0x6f5340, roughness: 0.92, metalness: 0, envMapIntensity: 0.5 });
    const br = new T.Mesh(new T.CylinderGeometry(0.075, 0.095, 1.7, 18).rotateZ(Math.PI / 2), bark); br.position.set(0, 0.385, 0.14); br.rotation.z = 0; root.add(br);
    const tw = new T.Mesh(new T.CylinderGeometry(0.02, 0.045, 0.55, 12), bark); tw.position.set(0.55, 0.6, 0.14); tw.rotation.z = -0.7; root.add(tw);
    let mesh = null; body.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
    const pos = mesh.geometry.attributes.position; const nor = mesh.geometry.attributes.normal; const p0 = pos.array.slice(); const n0 = nor.array.slice(); const N = pos.count;
    const sm = (a0, a1, v) => { const u = Math.min(1, Math.max(0, (v - a0) / (a1 - a0))); return u * u * (3 - 2 * u); };
    const head = []; for (let i = 0; i < N; i++) { const w = sm(0.3, 0.52, p0[i * 3 + 1]); if (w > 0) head.push([i, w]); }
    const pivZ = 0.08; let lastA = 1e9;
    const pose = (x, t) => {
      const a = (x * Math.PI) / 180 * 0.85;
      if (Math.abs(a - lastA) > 0.0005) {
        lastA = a; const P = pos.array; const Nn = nor.array;
        for (let k = 0; k < head.length; k++) {
          const i = head[k][0] * 3; const aa = a * head[k][1]; const c = Math.cos(aa); const s = Math.sin(aa); const dz = p0[i + 2] - pivZ;
          P[i] = p0[i] * c + dz * s; P[i + 2] = pivZ - p0[i] * s + dz * c;
          Nn[i] = n0[i] * c + n0[i + 2] * s; Nn[i + 2] = -n0[i] * s + n0[i + 2] * c;
        }
        pos.needsUpdate = true; nor.needsUpdate = true;
      }
      turn.scale.set(1 + 0.006 * Math.sin(t * 1.7), 1 + 0.012 * Math.sin(t * 1.7), 1 + 0.006 * Math.sin(t * 1.7));
      turn.rotation.z = 0.01 * Math.sin(t * 0.5);
    };
    return { root, parts: {}, pose };
  };
  /* The tortoise as a modelled file (models/tortoise.glb): a slow, heavy walk with the shared glbWalker rig (agence-bestiary-d.js). */
  B.animals.proptech.xGlb = 1; /* the coded tortoise reads x as a speed of 40; the modelled one walks at its own pace */
  B.animals.proptech.glb = '/portfolio/models/tortoise.glb?v=1';
  B.animals.proptech.frameGlb = { r: 1.9, cx: 0, cy: 0.5, floor: 0, shadow: 3.6, yaw: 0.8, pitch: 0.15 };
  B.animals.proptech.buildGlb = (K, gltf) => B.glbWalker({
    len: 2.3, cut: -0.2, ramp: 0.26, A: 0.4, duty: 0.75, speed: 0.12, knee: 0.25, bob: 0.004,
    legs: [{ z0: -1.0, z1: -0.5, pz: -0.78, hy: -0.2, ky: -0.33, side: -1, ph: 0 }, { z0: 0.2, z1: 0.56, pz: 0.39, hy: -0.2, ky: -0.33, side: -1, ph: 0.25 },
      { z0: -1.0, z1: -0.5, pz: -0.78, hy: -0.2, ky: -0.33, side: 1, ph: 0.5 }, { z0: 0.2, z1: 0.56, pz: 0.39, hy: -0.2, ky: -0.33, side: 1, ph: 0.75 }],
    sets: [],
    head: { z0: 0.5, z1: 0.75, y0: -0.1, y1: 0.0, py: 0.1, pz: 0.5, nod: 0.09 },
  })(K, gltf);
})();
