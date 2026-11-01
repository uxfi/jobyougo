/* v2 studio, live bestiary, animals 5 to 7: the hummingbird (e-commerce), the octopus (marketplaces), the swan (luxury).
   Silhouette in lofted geometry, form in relief and instanced feathers and suckers, micro detail in maps. See agence-bestiary.js. */
(function () {
  'use strict';
  const B = (window.AgenceBestiary = window.AgenceBestiary || { animals: {} });
  const TAU = Math.PI * 2;
  const PI = Math.PI;
  const DEG = PI / 180;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const lerp = (a, b, t) => a + (b - a) * t;

  /* ───────── 5. The hummingbird · e-commerce · it hovers where the lift equals the weight ───────── */
  const HUM = { hover: 55, slow: 10 }; /* wingbeats a second at which it hovers (about), slow-motion factor on screen */
  B.animals.ecommerce = {
    id: 'ecommerce',
    frame: { r: 1.5, cx: 0.6, cy: 0.42, floor: -1.05, shadow: 2.8, yaw: 0.55, pitch: 0.16 },
    x: 55,
    build(K) {
      const T = K.T; const P = K.PAL; const V = K.V; const rig = K.rig(); const UP = V(0, 1, 0);
      const wingsP = rig.part('wings', [0, 0.9, 0]); const bodyP = rig.part('body', [0, 0, 0]); const billP = rig.part('bill', [0.7, 0.25, 0.9]);
      const mv = [wingsP, bodyP, billP].map((p) => { const g = new T.Group(); p.group.add(g); return g; });
      const put = (g, m, x, y, z) => { g.position.set(x, y, z); mv[m].add(g); return g; };
      const GREEN = '#7fd0b4';

      /* body: one lofted spindle, rows of small feathers over back, belly and a rose throat patch (the gorget) */
      const bSpec = { len: 1.05, n: 40, ru: 2, rv: 2, a: () => 0.95, r: (s) => 0.006 + 0.17 * Math.pow(Math.sin(PI * Math.pow(s, 0.85)), 0.6) * (1 - 0.25 * s) };
      const body = K.glass(bodyP, K.loft(bSpec), GREEN, { op: 0.88, bump: 'plumage', bumpScale: 1.2, detached: true }); put(body, 1, 0, 0, 0);
      const bSurf = K.surf(bSpec); const fe = K.feather(0.075, 0.03, { curl: 0.1 });
      put(K.coat(bodyP, { surf: bSurf, geo: fe, hex: GREEN, rows: 46, cols: 18, s0: 0.06, s1: 0.92, th0: -1.5, th1: 1.5, size: [0.85, 1.1], lift: [0.12, 0.3], seed: 4, vary: 0.2 }), 1, 0, 0, 0);
      put(K.coat(bodyP, { surf: bSurf, geo: fe, hex: P.cream, rows: 32, cols: 12, s0: 0.15, s1: 0.7, th0: PI - 1.1, th1: PI + 1.1, size: [0.8, 1], lift: [0.12, 0.3], seed: 6, vary: 0.14 }), 1, 0, 0, 0);
      put(K.coat(bodyP, { surf: bSurf, geo: fe, hex: '#f06aa6', rows: 16, cols: 12, s0: 0.7, s1: 0.94, th0: PI - 0.95, th1: PI + 0.95, size: [0.6, 0.8], lift: [0.12, 0.3], seed: 8, vary: 0.12 }), 1, 0, 0, 0);
      const head = K.glass(bodyP, K.uvScale(K.ball(0.21, 0.18, 0.18, 28), 2, 2), GREEN, { op: 0.9, bump: 'plumage', bumpScale: 1.1, detached: true }); put(head, 1, 0.64, 0.1, 0);
      [1, -1].forEach((s) => {
        const ry = s > 0 ? 0.9 : PI - 0.9;
        const e = K.eye(bodyP, { r: 0.054, iris: '#3a2418' }); put(e, 1, 0.73, 0.15, s * 0.125); e.rotation.y = ry;
        const ring = K.glass(bodyP, new T.TorusGeometry(0.06, 0.009, 6, 18), P.cream, { op: 0.9, detached: true }); put(ring, 1, 0.73, 0.15, s * 0.123); ring.rotation.y = ry;
      });
      /* tail: six pointed feathers fanned flat; two tiny feet */
      put(K.thin(bodyP, K.feather(1, 0.11, { curl: 0.02, tip: 0.6 }), P.lav, { op: 0.82, bump: 'feather', bumpScale: 1.8, detached: true, instances: K.fan(Array.from({ length: 9 }, (_, i) => { const f = (i - 4) * 0.13; return { p: V(-0.5, -0.02, 0), dir: V(-1, -0.12, f * 0.8), len: 0.62 - Math.abs(i - 4) * 0.025, nHint: UP }; })) }), 1, 0, 0, 0);
      [1, -1].forEach((s) => {
        put(K.glass(bodyP, new T.CylinderGeometry(0.012, 0.009, 0.12, 6).translate(0, -0.06, 0), P.ink, { op: 0.95, detached: true }), 1, 0.05, -0.15, s * 0.07);
        put(K.glass(bodyP, K.ball(0.025, 0.012, 0.03, 8), P.ink, { op: 0.95, detached: true }), 1, 0.06, -0.28, s * 0.07);
      });

      /* bill: a long tapered tube slightly curved, a shorter lower half, a tongue with a forked tip */
      const bill = K.tube(14, 10); const bc = new T.CatmullRomCurve3([V(0, 0, 0), V(0.45, -0.015, 0), V(0.92, -0.07, 0)]).getPoints(14);
      bill.set(bc, bc.map((_, i) => 0.034 * (1 - i / 14) + 0.005), V(0, 1, 0), bc.map(() => 0.85));
      put(K.glass(billP, bill.geo, P.ink, { op: 0.95, detached: true }), 2, 0.8, 0.1, 0);
      const low = K.tube(10, 8); const lc = new T.CatmullRomCurve3([V(0, -0.03, 0), V(0.3, -0.05, 0), V(0.62, -0.1, 0)]).getPoints(10);
      low.set(lc, lc.map((_, i) => 0.024 * (1 - i / 10) + 0.004), V(0, 1, 0), lc.map(() => 0.85));
      put(K.glass(billP, low.geo, '#4a3f8f', { op: 0.95, detached: true }), 2, 0.8, 0.1, 0);
      const tongue = K.solid(billP, new T.CylinderGeometry(0.011, 0.008, 1, 6).rotateZ(PI / 2).translate(0.5, 0, 0), P.coral, { detached: true }); put(tongue, 2, 0.8, 0.1, 0);
      const tines = [1, -1].map((s) => { const g = K.solid(billP, new T.ConeGeometry(0.006, 0.09, 5).rotateZ(-PI / 2), P.coral, { detached: true }); tongue.add(g); g.position.set(1.04, 0, s * 0.012); return g; });

      /* the flower it feeds on: a stem with veined leaves, a green calyx, five curved petals, stamens tipped with pollen, a drop of nectar */
      const FX = 1.52; const FY = 0.45;
      const stem = K.thin(billP, new T.CylinderGeometry(0.024, 0.03, 1.5, 10), P.mint, { op: 0.82, bump: 'wrinkle', bumpScale: 0.8, detached: true }); stem.position.set(FX, FY - 0.78, 0); billP.group.add(stem);
      const lf = K.leaf(8, 5, (u, v, o) => { const w = 0.11 * Math.sin(PI * Math.pow(u, 0.65)); o.x = u * 0.42; o.y = v * w + 0.05 * u * u; o.z = 0; });
      billP.group.add(K.thin(billP, lf, P.mint, { op: 0.92, bump: 'veins', bumpScale: 1.2, instances: K.fan([{ p: V(FX, -0.45, 0), dir: V(0.8, 0.5, 0.2), len: 1, nHint: V(0, 0, 1) }, { p: V(FX, -0.15, 0), dir: V(-0.8, 0.45, -0.2), len: 0.9, nHint: V(0, 0, 1) }]) }));
      const calyx = K.glass(billP, new T.ConeGeometry(0.1, 0.18, 10, 1, true), P.mint, { op: 0.9, detached: true }); calyx.position.set(FX, FY - 0.04, 0); calyx.rotation.x = PI; billP.group.add(calyx);
      const petalG = K.leaf(9, 6, (u, v, o) => { const w = (0.09 + 0.12 * Math.sin(PI * Math.pow(u, 0.55))) * (1 - 0.15 * u); o.x = 0.05 + u * 0.22 + 0.16 * u * u; o.y = u * 0.52; o.z = v * w; });
      const petalM = Array.from({ length: 5 }, (_, i) => new T.Matrix4().compose(V(FX, FY, 0), new T.Quaternion().setFromAxisAngle(UP, (i / 5) * TAU), V(1, 1, 1)));
      billP.group.add(K.thin(billP, petalG, '#f4a0c4', { op: 0.94, bump: 'wrinkle', bumpScale: 0.5, iri: 0.4, instances: petalM }));
      const stam = []; const pol = [];
      for (let i = 0; i < 5; i++) { const an = (i / 5) * TAU + 0.3; const x = Math.cos(an) * 0.05; const z = Math.sin(an) * 0.05; stam.push(new T.Matrix4().makeTranslation(FX + x, FY + 0.14, z)); pol.push(new T.Matrix4().makeTranslation(FX + x * 1.8, FY + 0.28, z * 1.8)); }
      billP.group.add(K.thin(billP, new T.CylinderGeometry(0.005, 0.005, 0.28, 5), P.gold, { op: 0.9, instances: stam }));
      billP.group.add(K.thin(billP, new T.SphereGeometry(0.016, 8, 6), '#f5c242', { op: 0.96, instances: pol }));
      const drop = K.glass(billP, K.ball(0.05, 0.045, 0.05, 14), P.gold, { op: 0.95, detached: true }); drop.position.set(FX, FY + 0.06, 0); billP.group.add(drop);

      /* wings: an arm bone and three tiers of feathers (primaries, secondaries, coverts), all rigid with the wing */
      const armC = new T.CatmullRomCurve3([V(0, 0, 0), V(-0.04, 0.02, 0.45), V(-0.14, 0.03, 1.0), V(-0.3, 0.02, 1.2)]);
      const primG = K.feather(1, 0.16, { curl: 0.05, tip: 0.8 }); const covG = K.feather(1, 0.17, { curl: 0.07 });
      const prim = Array.from({ length: 15 }, (_, i) => { const th = 0.1 + i * 0.052; return { p: V(-0.04 - i * 0.0085, 0.012, 0.4 + i * 0.052), dir: V(-Math.cos(th), 0, Math.sin(th)), len: 0.52 + i * 0.016, nHint: UP }; });
      const sec = Array.from({ length: 10 }, (_, i) => ({ p: V(-0.01, 0.01, 0.06 + i * 0.034), dir: V(-Math.cos(0.05), 0, Math.sin(0.05)), len: 0.42 + i * 0.008, nHint: UP }));
      const cov = Array.from({ length: 42 }, (_, i) => { const r2 = Math.floor(i / 14); const j = i % 14; const th = 0.1 + j * 0.05; return { p: V(-0.02 - r2 * 0.08, 0.024 + r2 * 0.007, 0.2 + j * 0.066), dir: V(-Math.cos(th), 0, Math.sin(th)), len: 0.2 - r2 * 0.025, nHint: UP }; });
      const wings = [1, -1].map((s) => {
        const outer = new T.Group(); put(outer, 0, 0.14, 0.14, s * 0.1); outer.scale.z = s;
        const inner = new T.Group(); outer.add(inner);
        inner.add(K.glass(wingsP, new T.TubeGeometry(armC, 24, 0.014, 6), P.peri, { op: 0.9, detached: true }));
        inner.add(K.thin(wingsP, primG, s > 0 ? P.peri : P.lav, { op: 0.8, bump: 'feather', bumpScale: 2, instances: K.fan(prim) }));
        inner.add(K.thin(wingsP, primG, P.lav, { op: 0.76, bump: 'feather', bumpScale: 2, instances: K.fan(sec) }));
        inner.add(K.thin(wingsP, covG, P.sky, { op: 0.8, bump: 'feather', bumpScale: 1.6, instances: K.fan(cov) }));
        return { outer, inner, s };
      });

      const st = { t: 0, ph: 0 };
      const pose = (f, t) => {
        const dt = Math.min(0.1, Math.max(0, t - st.t)); st.t = t;
        st.ph = (st.ph + (f / HUM.slow) * dt) % 1000;
        const lift = Math.pow(f / HUM.hover, 2);
        const y = clamp((lift - 1) * 0.55, -0.62, 0.72) + 0.02 * Math.sin(TAU * 0.7 * t);
        mv.forEach((m) => { m.position.y = y; m.rotation.z = 0.5; });
        const A = 70 * DEG;
        wings.forEach((w) => {
          w.outer.rotation.y = w.s * A * Math.sin(TAU * st.ph);
          w.inner.rotation.z = 0.9 * Math.cos(TAU * st.ph);
        });
        const lick = 0.5 + 0.5 * Math.sin(TAU * 3 * t); tongue.scale.x = 0.85 + 0.3 * lick;
        tines.forEach((g, i) => { g.rotation.y = (i ? -1 : 1) * 0.3 * lick; });
      };
      return {
        root: rig.root, parts: rig.parts, pose,
      };
    },
  };

  /* ───────── 6. The octopus · marketplaces · eight arms, each with its own small brain ───────── */
  const OCT = { neurons: 41.7, suckers: 240 }; /* million neurons per arm (about two thirds of 500 million, over eight), suckers per arm (about) */
  B.animals.marketplace = {
    id: 'marketplace',
    frame: { r: 2.5, cy: 0.62, floor: -0.04, shadow: 5.2, yaw: 0.5, pitch: 0.52 },
    x: 3,
    build(K) {
      const T = K.T; const P = K.PAL; const V = K.V; const rig = K.rig();
      const armsP = rig.part('arms', [0, -0.3, 0]); const bodyP = rig.part('body', [0, 0.9, 0]); const heartP = rig.part('heart', [0, 0.45, 1.0]);
      const at = (g, parent, x, y, z) => { g.position.set(x, y, z); parent.add(g); return g; };

      /* mantle: a lofted sac leaning back, chromatophore mottling and skin bumps; the head, two eyes with slit pupils, a siphon */
      const mG = at(new T.Group(), bodyP.group, -0.1, 1.0, 0); mG.rotation.z = PI / 2 + 0.38;
      const mSpec = { len: 1.55, n: 46, ru: 3, rv: 3, a: () => 0.94, r: (s) => 0.012 + 0.6 * Math.pow(Math.sin(PI * Math.pow(s, 0.7)), 0.62) };
      const mantle = K.glass(bodyP, K.loft(mSpec), P.lav, { op: 0.86, map: 'mottle', bump: 'pebble', bumpScale: 1.3, detached: true }); mG.add(mantle);
      at(K.glass(bodyP, K.uvScale(K.ball(0.52, 0.42, 0.5, 32), 3, 3), P.rose, { op: 0.88, map: 'mottle', bump: 'pebble', bumpScale: 1.2, detached: true }), bodyP.group, 0.2, 0.66, 0);
      [1, -1].forEach((s) => {
        const ry = s > 0 ? 0.7 : PI - 0.7;
        const e = K.eye(bodyP, { r: 0.13, iris: '#f4a64a', slit: true }); at(e, bodyP.group, 0.5, 0.78, s * 0.34); e.rotation.y = ry;
        const lid = K.glass(bodyP, new T.TorusGeometry(0.145, 0.028, 8, 24), P.rose, { op: 0.92, bump: 'pebble', detached: true }); at(lid, bodyP.group, 0.5, 0.78, s * 0.34); lid.rotation.y = ry;
      });
      at(K.glass(bodyP, new T.ConeGeometry(0.075, 0.22, 12).rotateZ(PI / 2 + 0.7), P.rose, { op: 0.9, bump: 'pebble', detached: true }), bodyP.group, 0.42, 0.42, 0.18);
      const hearts = [[0, 0.92, 0], [0.12, 0.8, 0.14], [0.12, 0.8, -0.14]].map((p) => at(K.solid(heartP, K.ball(0.1, 0.09, 0.09, 14), P.coral, { detached: true }), heartP.group, p[0], p[1], p[2]));
      const brain = at(K.solid(heartP, K.ball(0.2, 0.12, 0.22, 16), P.peri, { detached: true }), heartP.group, 0.38, 0.8, 0);
      [1, -1].forEach((s) => at(K.solid(heartP, K.ball(0.16, 0.2, 0.05, 12), P.cream, { detached: true }), heartP.group, -0.1, 1.0, s * 0.3));

      /* eight arms: tubes re-shaped every frame, two rows of suckers on the underside (one draw call), webbing at the base,
         */
      const NA = 28; const arms = []; const webs = [];
      for (let i = 0; i < 8; i++) {
        const tube = K.tube(NA, 14, 5, 6); K.glass(armsP, tube.geo, i % 2 ? P.rose : P.lav, { op: 0.86, map: 'mottle', bump: 'pebble', bumpScale: 1.2 });
        const al = (i + 0.5) * (TAU / 8);
        const pts = Array.from({ length: NA + 1 }, () => new T.Vector3()); const rad = new Array(NA + 1);
        arms.push({ tube, al, pts, rad, i });
      }
      for (let i = 0; i < 8; i++) {
        const g = K.leaf(6, 4, () => {}); webs.push({ g, A0: arms[i], A1: arms[(i + 1) % 8] });
        armsP.group.add(K.thin(armsP, g, P.rose, { op: 0.5, bump: 'pebble', bumpScale: 0.6, detached: true }));
      }
      const NS = 20; const sMats = Array.from({ length: 8 * 2 * NS }, () => new T.Matrix4());
      const suckers = K.thin(armsP, new T.TorusGeometry(1, 0.4, 8, 14), P.cream, { op: 0.92, instances: sMats, detached: true }); armsP.group.add(suckers);
      const tip = at(new T.Group(), armsP.group, 0, 0, 0);
      const hint = new T.Vector3(0, 1, 0); const dummy = new T.Object3D(); const Z = V(0, 0, 1); const qq = new T.Quaternion(); const dir = V(0, 0, 0); const bn = V(0, 0, 0);

      const pose = (x, t) => {
        let sc = 0;
        arms.forEach((a) => {
          const k = smooth(0, 1, clamp(x - a.i, 0, 1));
          const ca = Math.cos(a.al); const sa = Math.sin(a.al);
          for (let j = 0; j <= NA; j++) {
            const s = j / NA;
            const om = (PI - 0.2) - s * TAU * 1.6; const rho = 0.44 * (1 - 0.82 * s);
            const rr = 0.95 + rho * Math.cos(om); const ry = 0.26 + rho * Math.sin(om);
            const gr = 0.35 + s * 2.2; const gy = 0.3 - 0.24 * s + 0.2 * Math.sin(PI * s) * (1 - 0.3 * s);
            const r = lerp(rr, gr, k); const y = lerp(ry, gy, k);
            const lat = (lerp(0.1, 0.022, k)) * Math.sin(TAU * (0.4 * t + a.i * 0.13) + s * 5) * Math.sin(PI * s);
            a.pts[j].set(r * ca - lat * sa, y, r * sa + lat * ca);
            a.rad[j] = 0.155 * Math.pow(1 - s, 0.9) + 0.016;
          }
          a.tube.set(a.pts, a.rad, hint);
          if (a.i === 2) tip.position.copy(a.pts[16]);
          /* suckers: two rows along the underside of the arm, smaller toward the tip */
          const tn = a.tube.tan; const nr = a.tube.nor; const cc = a.tube.c;
          for (let row = 0; row < 2; row++) {
            const sg = row ? -1 : 1;
            for (let n = 0; n < NS; n++) {
              const j = Math.round(3 + n * ((NA - 5) / (NS - 1))); const q3 = j * 3; const rj = a.rad[j];
              bn.set(tn[q3 + 1] * nr[q3 + 2] - tn[q3 + 2] * nr[q3 + 1], tn[q3 + 2] * nr[q3] - tn[q3] * nr[q3 + 2], tn[q3] * nr[q3 + 1] - tn[q3 + 1] * nr[q3]);
              dir.set(-nr[q3] * 0.9 + bn.x * 0.42 * sg, -nr[q3 + 1] * 0.9 + bn.y * 0.42 * sg, -nr[q3 + 2] * 0.9 + bn.z * 0.42 * sg).normalize();
              qq.setFromUnitVectors(Z, dir);
              dummy.position.set(cc[q3] + dir.x * rj * 0.96, cc[q3 + 1] + dir.y * rj * 0.96, cc[q3 + 2] + dir.z * rj * 0.96);
              dummy.quaternion.copy(qq); dummy.scale.setScalar(Math.max(0.011, rj * 0.4)); dummy.updateMatrix();
              suckers.setMatrixAt(sc++, dummy.matrix);
            }
          }
        });
        suckers.instanceMatrix.needsUpdate = true;
        webs.forEach((w) => {
          w.g.userData.set((u, v, o) => {
            const j = 1 + Math.round(u * 6); const tt = (v + 1) / 2; const a0 = w.A0.pts[j]; const a1 = w.A1.pts[j];
            o.x = lerp(a0.x, a1.x, tt); o.z = lerp(a0.z, a1.z, tt); o.y = lerp(a0.y, a1.y, tt) - 0.05 * Math.sin(PI * tt) * (1 - u * 0.5);
          });
        });
        const br = 1 + 0.03 * Math.sin(TAU * 0.5 * t);
        mantle.scale.set(1, br, br);
        hearts.forEach((h, i) => { const b = 1 + 0.16 * Math.pow(Math.max(0, Math.sin(TAU * 1.1 * t + i * 0.8)), 3); h.scale.setScalar(b); });
        brain.scale.setScalar(1 + 0.02 * Math.sin(TAU * 0.3 * t));
      };
      return {
        root: rig.root, parts: rig.parts, pose,
      };
    },
  };

  /* ───────── 7. The swan · luxury · the same neck, 24 vertebrae, from a curve to a line ───────── */
  const SW = { n: 24, seg: 0.12, cm: 25 }; /* vertebrae, length of one in model units, centimetres per model unit */
  const swanChain = (ext) => {
    const A = 90 * (1 - ext) * DEG; const D = 40 * (1 - ext) * DEG; const th0 = (30 + 50 * ext) * DEG;
    const pts = [{ x: 0, y: 0 }]; let x = 0; let y = 0; let prev = th0; let maxBend = 0; let ang = th0;
    for (let i = 0; i < SW.n; i++) {
      const tau = (i + 0.5) / SW.n;
      ang = th0 + A * (tau < 0.5 ? Math.sin(TAU * tau) : 0.45 * Math.sin(TAU * tau)) - D * tau;
      maxBend = Math.max(maxBend, Math.abs(ang - prev)); prev = ang;
      x += SW.seg * Math.cos(ang); y += SW.seg * Math.sin(ang); pts.push({ x, y });
    }
    return { pts, maxBend, endAng: ang };
  };
  const SW_BASE = { x: 0.92, y: 0.52 };
  B.animals.luxury = {
    id: 'luxury',
    frame: { r: 2.75, cx: 0.25, cy: 1.35, floor: -0.3, shadow: 4.6, yaw: 0.62, pitch: 0.2 },
    x: 0.5,
    build(K) {
      const T = K.T; const P = K.PAL; const V = K.V; const rig = K.rig(); const UP = V(0, 1, 0);
      const neckP = rig.part('neck', [0, 1.0, 0.2]); const wingsP = rig.part('wings', [0, 0.8, 0.9]); const bodyP = rig.part('body', [0, -0.15, 0]);
      const at = (g, parent, x, y, z) => { g.position.set(x, y, z); parent.add(g); return g; };
      const SWB = '#f3eefc'; /* a white swan on a pale page: a light lavender with dark back faces so the edges read */

      /* body: a lofted hull with an upswept tail and a deep chest, rows of feathers along the flanks and back */
      const bSpec = { len: 2.5, n: 52, ru: 3, rv: 3, a: () => 1.15, y: (s) => 0.3 + 0.32 * Math.pow(1 - s, 3), r: (s) => 0.008 + 0.5 * Math.pow(Math.sin(PI * Math.pow(s, 0.8)), 0.62) * (1 + 0.12 * smooth(0.6, 0.9, s)) };
      at(K.glass(bodyP, K.loft(bSpec), SWB, { op: 0.88, backOp: 0.55, bump: 'plumage', bumpScale: 1.0, detached: true }), bodyP.group, 0, 0, 0);
      const bSurf = K.surf(bSpec); const fe = K.feather(0.16, 0.055, { curl: 0.09 });
      [PI / 2, 1.5 * PI].forEach((c0, k) => bodyP.group.add(K.coat(bodyP, { surf: bSurf, geo: fe, hex: SWB, rows: 36, cols: 20, s0: 0.12, s1: 0.9, th0: c0 - 1.05, th1: c0 + 1.05, size: [0.85, 1.1], lift: [0.1, 0.25], seed: 31 + k, vary: 0.1 })));
      bodyP.group.add(K.coat(bodyP, { surf: bSurf, geo: fe, hex: SWB, rows: 32, cols: 20, s0: 0.1, s1: 0.85, th0: -1.0, th1: 1.0, size: [0.85, 1.1], lift: [0.1, 0.25], seed: 37, vary: 0.1 }));
      bodyP.group.add(K.thin(bodyP, K.feather(1, 0.1, { curl: 0.02, tip: 0.6 }), SWB, { op: 0.82, bump: 'feather', bumpScale: 1.8, instances: K.fan(Array.from({ length: 12 }, (_, i) => { const f = (i - 5.5) * 0.07; return { p: V(-1.15, 0.66, 0), dir: V(-1, 0.3, f), len: 0.52 - Math.abs(i - 5.5) * 0.012, nHint: UP }; })) }));

      /* wings: a lofted wing on each flank, rows of layered coverts, long primaries lying over the tail */
      const wSpec = { x0: -1.0, len: 1.7, n: 30, ru: 1, rv: 2, a: () => 0.2, r: (s) => 0.01 + 0.3 * Math.pow(Math.sin(PI * Math.pow(s, 0.7)), 0.7) };
      const wSurf = K.surf(wSpec); const covG = K.feather(0.17, 0.058, { curl: 0.08 }); const primG = K.feather(1, 0.12, { curl: 0.03, tip: 0.7 });
      [1, -1].forEach((s) => {
        const wg = at(new T.Group(), wingsP.group, -0.2, 0.6, s * 0.55); wg.rotation.set(0, -s * 0.12, 0.1);
        wg.add(K.glass(wingsP, K.loft(wSpec), '#e6defa', { op: 1, bump: 'plumage', bumpScale: 1.2, detached: true }));
        wg.add(K.coat(wingsP, { surf: wSurf, geo: covG, hex: '#f0eafc', rows: 24, cols: 18, s0: 0.1, s1: 0.88, th0: (PI / 2) * s - 0.9, th1: (PI / 2) * s + 0.9, size: [0.85, 1.1], lift: [0.1, 0.25], seed: 51 + s, vary: 0.08 }));
        wg.add(K.thin(wingsP, primG, '#e9e2fb', { op: 1, bump: 'feather', bumpScale: 1.8, instances: K.fan(Array.from({ length: 14 }, (_, i) => ({ p: V(-1.0 + i * 0.012, (i - 6.5) * 0.022, s * 0.02), dir: V(-1, -0.05, s * (i - 6.5) * 0.022), len: 0.46 + 0.12 * Math.sin((PI * i) / 13), nHint: UP }))) }));
      });
      /* legs and webbed feet, seen through the water */
      [-0.1].forEach((x) => [1, -1].forEach((s) => { /* one pair of legs */
        at(K.glass(bodyP, new T.CylinderGeometry(0.03, 0.022, 0.15, 8).translate(0, -0.075, 0), '#e6a690', { op: 0.9, detached: true }), bodyP.group, x, -0.18, s * 0.28);
        at(K.thin(bodyP, K.leaf(7, 6, (u, v, o) => { o.x = u * 0.3; o.y = 0; o.z = v * 0.17 * Math.pow(u, 0.7); }), '#e6a690', { op: 0.8, bump: 'rays', bumpScale: 1.6, detached: true }), bodyP.group, x, -0.33, s * 0.28);
      }));
      const water = K.thin(bodyP, new T.CircleGeometry(2.9, 64), P.sky, { op: 0.2, detached: true }); water.rotation.x = -PI / 2; water.position.y = -0.3; bodyP.group.add(water);
      const ripples = [0, 1, 2].map(() => { const r = K.thin(bodyP, new T.RingGeometry(0.985, 1, 72), P.peri, { op: 0.5, detached: true }); r.rotation.x = -PI / 2; r.position.y = -0.295; bodyP.group.add(r); return r; });

      /* neck: a feathered tube with a ruff of feathers at its base, a head with a black eye patch, an orange bill with a black knob */
      const neck = K.tube(SW.n, 18, 3, 7); K.glass(neckP, neck.geo, SWB, { op: 0.9, backOp: 0.55, bump: 'plumage', bumpScale: 0.6 });
      const ruff = Array.from({ length: 32 }, (_, i) => { const a = (i / 32) * TAU; return { p: V(SW_BASE.x + Math.cos(a) * 0.04, SW_BASE.y + 0.05, Math.sin(a) * 0.17), dir: V(-0.5, -0.25, Math.sin(a) * 0.8), len: 0.14, nHint: UP, wide: 0.8 }; });
      neckP.group.add(K.thin(neckP, K.feather(1, 0.14, { curl: 0.1 }), SWB, { op: 0.84, bump: 'feather', bumpScale: 1.6, instances: K.fan(ruff) }));
      const head = new T.Group(); neckP.group.add(head);
      head.add(K.glass(neckP, K.uvScale(K.ball(0.18, 0.085, 0.085, 26), 2, 2), SWB, { op: 0.92, backOp: 0.5, bump: 'plumage', bumpScale: 0.7, detached: true }));
      const bill = K.glass(neckP, K.loft({ len: 0.34, x0: 0, n: 18, radial: 16, ru: 2, rv: 1, a: () => 1.5, r: (s) => 0.006 + 0.05 * Math.pow(Math.sin(PI * Math.pow(s, 0.8)), 0.5) * (1 - 0.35 * s) }), '#f2784a', { op: 0.95, bump: 'pebble', bumpScale: 0.8, detached: true }); bill.position.set(0.14, -0.02, 0); head.add(bill);
      const knob = K.glass(neckP, K.ball(0.045, 0.04, 0.04, 12), '#2b2a55', { op: 0.96, detached: true }); knob.position.set(0.2, 0.05, 0); head.add(knob);
      [1, -1].forEach((s) => {
        const patch = K.glass(neckP, K.ball(0.07, 0.035, 0.03, 10), '#2b2a55', { op: 0.9, detached: true }); patch.position.set(0.12, 0.02, s * 0.065); head.add(patch);
        const e = K.eye(neckP, { r: 0.026, iris: '#6a4a2a' }); e.position.set(0.09, 0.03, s * 0.078); e.rotation.y = s > 0 ? 1.2 : PI - 1.2; head.add(e);
        const nos = K.glass(neckP, K.ball(0.01, 0.008, 0.008, 6), '#2b2a55', { op: 0.96, detached: true }); nos.position.set(0.28, 0.02, s * 0.03); head.add(nos);
      });
      const verts = Array.from({ length: SW.n }, (_, i) => { const m = K.solid(neckP, K.ball(0.054, 0.054, 0.054, 10), i % 2 ? P.cream : P.lav, { detached: true }); neckP.group.add(m); return m; });

      const Pn = Array.from({ length: SW.n + 1 }, () => new T.Vector3()); const Rn = new Array(SW.n + 1); const An = new Array(SW.n + 1).fill(0.9);
      const hint = new T.Vector3(0, 0, 1);
      const pose = (x, t) => {
        const c = swanChain(x);
        for (let i = 0; i <= SW.n; i++) { Pn[i].set(SW_BASE.x + c.pts[i].x, SW_BASE.y + c.pts[i].y, 0); Rn[i] = 0.062 + 0.085 * Math.pow(1 - i / SW.n, 1.7); }
        neck.set(Pn, Rn, hint, An);
        for (let i = 0; i < SW.n; i++) verts[i].position.set((Pn[i].x + Pn[i + 1].x) / 2, (Pn[i].y + Pn[i + 1].y) / 2, 0);
        head.position.copy(Pn[SW.n]); head.rotation.z = c.endAng - 0.45 * (1 - x) - 0.05 * Math.sin(TAU * 0.3 * t);
        ripples.forEach((r, i) => { const ph = (t * 0.1 + i / 3) % 1; r.scale.setScalar(1.3 + 1.5 * ph); r.material.opacity = 0.5 * (1 - ph); });
      };
      return {
        root: rig.root, parts: rig.parts, pose,
      };
    },
  };
})();
