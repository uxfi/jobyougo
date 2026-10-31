/* v2 studio, live bestiary, animal 1: the bee (SaaS). The owl, the koi and the tortoise are in agence-bestiary-b.js.
   One input, a model that is a pure function of it, a mechanism built from it. See agence-bestiary.js. */
(function () {
  'use strict';
  const B = (window.AgenceBestiary = window.AgenceBestiary || { animals: {} });
  const TAU = Math.PI * 2;
  const PI = Math.PI;
  const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  /* ───────── 1. The bee · SaaS · the waggle dance: the length of the run says how far the flowers are ───────── */
  const BEE = { run: 1.0, speed: 6.7, beat: 230 }; /* s of waggle per km (about), flight m/s, wingbeats per s */
  B.animals.saas = {
    id: 'saas',
    frame: { r: 1.7, cy: 0.3, floor: -0.02, shadow: 3.6, yaw: 0.5, pitch: 0.44 },
    x: 1.4,
    build(K) {
      const T = K.T; const P = K.PAL; const V = K.V;
      const rig = K.rig();
      const wingsP = rig.part('wings', [0, 1.05, 0]);
      const bodyP = rig.part('body', [0, 0, 0]);
      const engP = rig.part('engine', [0.1, 0.62, 0.95]);
      const combP = rig.part('comb', [0, -0.55, 0]);
      const BEE_S = 1.45; /* the bee is drawn larger than the cells so it reads at a glance */
      const mv = [wingsP, bodyP, engP].map((p) => { const g = new T.Group(); g.scale.setScalar(BEE_S); p.group.add(g); return g; });
      const put = (obj, m, x, y, z) => { obj.position.set(x, y, z); mv[m].add(obj); return obj; };

      /* ── the comb: thick hexagonal cells with a bevelled rim, a third full of honey, some capped with wax ── */
      const rc = 0.2; const s3 = Math.sqrt(3) * rc; const RR = 3; const rnd = K.rng(11);
      const hexPts = (r) => Array.from({ length: 6 }, (_, i) => { const a = PI / 2 + (i * PI) / 3; return new T.Vector2(Math.cos(a) * r, Math.sin(a) * r); });
      const outer = new T.Shape(hexPts(rc * 0.985)); outer.holes.push(new T.Path(hexPts(rc * 0.8).reverse()));
      const ringGeo = new T.ExtrudeGeometry(outer, { depth: 0.15, bevelEnabled: true, bevelThickness: 0.014, bevelSize: 0.012, bevelSegments: 2 }).rotateX(-PI / 2).translate(0, -0.075, 0);
      const cells = []; const honey = []; const caps = [];
      for (let q = -RR; q <= RR; q++) for (let r = -RR; r <= RR; r++) {
        if (Math.abs(q + r) > RR) continue;
        const x = q * s3 + r * s3 * 0.5; const z = r * s3 * 0.8660254;
        cells.push(new T.Matrix4().makeTranslation(x, 0, z));
        const dice = rnd();
        if (dice < 0.34) honey.push(new T.Matrix4().makeTranslation(x, -0.01 + rnd() * 0.05, z));
        else if (dice < 0.5) caps.push(new T.Matrix4().makeTranslation(x, 0.062, z));
      }
      K.thin(combP, ringGeo, P.apricot, { op: 0.92, instances: cells });
      K.thin(combP, new T.CylinderGeometry(rc * 0.8, rc * 0.8, 0.06, 6), P.gold, { op: 0.9, instances: honey, bump: 'pebble', bumpScale: 0.4 });
      K.thin(combP, new T.CylinderGeometry(rc * 0.82, rc * 0.82, 0.03, 6), P.cream, { op: 0.9, instances: caps, bump: 'wrinkle', bumpScale: 0.6 });
      const floor = K.thin(combP, new T.CircleGeometry(1.5, 56), P.gold, { op: 0.3, detached: true });
      floor.rotation.x = -PI / 2; floor.position.y = -0.085; combP.group.add(floor);

      /* ── the body: three lofted segments, hair on the thorax, a striped and ridged abdomen ── */
      const thSpec = { len: 0.58, r: (s) => 0.006 + 0.23 * Math.pow(Math.sin(PI * Math.pow(s, 0.85)), 0.55), ru: 2, rv: 2 };
      put(K.glass(bodyP, K.loft(thSpec), '#e2b266', { op: 1, rough: 0.6, clear: 0.15, iri: 0.1, bump: 'fuzz', bumpScale: 0.5, detached: true }), 1, 0, 0, 0);

      const headSpec = { len: 0.3, r: (s) => 0.006 + 0.15 * Math.pow(Math.sin(PI * Math.pow(s, 0.9)), 0.5), a: () => 1.16, ru: 2, rv: 1 };
      const head = K.glass(bodyP, K.loft(headSpec), '#d9a65a', { op: 1, rough: 0.6, clear: 0.15, iri: 0.1, bump: 'fuzz', bumpScale: 0.5, detached: true }); put(head, 1, 0.45, -0.005, 0);

      const abSpec = {
        len: 0.76, n: 60, ru: 1, rv: 1, a: () => 1.04,
        r: (s) => (0.006 + (s < 0.62 ? 0.21 * Math.pow(Math.sin(((PI / 2) * s) / 0.62), 0.85) : 0.21 - 0.135 * sm(0, 1, (s - 0.62) / 0.38))) * (1 + 0.045 * Math.cos(TAU * 5.4 * s - TAU * 0.98)),
      };
      const abdomen = K.glass(bodyP, K.loft(abSpec), '#fff3da', { op: 0.9, map: 'bands', bump: 'fuzz', bumpScale: 0.7, detached: true }); put(abdomen, 1, -0.64, -0.02, 0); abdomen.rotation.z = -0.08;
      const sting = K.glass(bodyP, new T.ConeGeometry(0.02, 0.16, 8).rotateZ(PI / 2), '#2b2a55', { op: 0.95, detached: true }); sting.position.set(-0.4, 0, 0); abdomen.add(sting);

      /* compound eyes with their lens facets and a glint, three simple eyes, mandibles, a proboscis */
      [1, -1].forEach((s) => {
        const e = K.glass(bodyP, K.uvScale(K.ball(0.1, 0.125, 0.075, 26), 5, 4), '#7d66c9', { op: 0.96, backOp: 0.3, bump: 'facets', bumpScale: 1.1, detached: true }); put(e, 1, 0.5, 0.03, s * 0.125); e.rotation.y = -s * 0.25;
        const sp = K.spark(bodyP, 0.016); sp.position.set(0.55, 0.09, s * 0.14); mv[1].add(sp);
        put(K.glass(bodyP, new T.ConeGeometry(0.022, 0.1, 8).rotateZ(-PI / 2 - 0.5), '#4a3f8f', { op: 0.95, detached: true }), 1, 0.6, -0.1, s * 0.045);
      });
      [[0.46, 0.15, 0], [0.43, 0.14, 0.05], [0.43, 0.14, -0.05]].forEach(([x, y, z]) => put(K.glass(bodyP, K.ball(0.016, 0.016, 0.016, 8), '#2b2a55', { op: 0.96, detached: true }), 1, x, y, z));
      put(K.glass(bodyP, new T.TubeGeometry(new T.CatmullRomCurve3([V(0.56, -0.08, 0), V(0.66, -0.13, 0), V(0.74, -0.19, 0)]), 8, 0.015, 6), P.apricot, { op: 0.95, detached: true }), 1, 0, 0, 0);

      /* antennae: ten jointed segments, they sway */
      const ants = [1, -1].map((s) => {
        const g = new T.Group(); put(g, 1, 0.52, 0.12, s * 0.05);
        const curve = new T.CatmullRomCurve3([V(0, 0, 0), V(0.1, 0.12, s * 0.04), V(0.26, 0.2, s * 0.09), V(0.4, 0.17, s * 0.15), V(0.46, 0.06, s * 0.19)]);
        g.add(K.glass(bodyP, new T.TubeGeometry(curve, 30, 0.01, 6), '#4a3f8f', { op: 0.95, detached: true }));
        const joints = []; for (let i = 1; i <= 10; i++) joints.push(new T.Matrix4().compose(curve.getPoint(i / 11), new T.Quaternion(), V(1, 1, 1)));
        g.add(K.thin(bodyP, new T.SphereGeometry(0.017, 8, 6), '#4a3f8f', { op: 0.95, instances: joints, detached: true }));
        return { g, s };
      });

      /* six legs: coxa, femur, tibia, a three-piece foot and a claw; the hind pair carries a pollen basket */
      const legs = [];
      const leg = (rTop, rBot, len) => new T.CylinderGeometry(rTop, rBot, len, 8).translate(0, -len / 2, 0);
      [1, -1].forEach((s) => [0.18, 0, -0.17].forEach((hx, i) => {
        const hip = new T.Group(); put(hip, 1, hx, -0.15, s * 0.11);
        hip.add(K.glass(bodyP, K.ball(0.04, 0.04, 0.04, 10), P.peach, { op: 0.95, detached: true }));
        const up = new T.Group(); hip.add(up); up.rotation.x = -s * 0.95;
        up.add(K.glass(bodyP, leg(0.026, 0.02, 0.2), P.peach, { op: 0.9, detached: true }));
        const low = new T.Group(); low.position.y = -0.2; up.add(low); low.rotation.x = s * 1.25;
        low.add(K.glass(bodyP, K.ball(0.026, 0.026, 0.026, 8), P.apricot, { op: 0.95, detached: true }));
        low.add(K.glass(bodyP, leg(0.02, 0.014, 0.24), P.peach, { op: 0.9, detached: true }));
        if (i === 2) { const basket = K.glass(bodyP, K.uvScale(K.ball(0.05, 0.1, 0.035, 14), 3, 3), P.gold, { op: 0.96, bump: 'pebble', bumpScale: 1.6, detached: true }); basket.position.set(0, -0.12, s * 0.02); low.add(basket); }
        const foot = new T.Group(); foot.position.y = -0.24; low.add(foot);
        [0, 1, 2].forEach((k2) => { const seg = K.glass(bodyP, leg(0.012 - k2 * 0.002, 0.009 - k2 * 0.0015, 0.045), P.apricot, { op: 0.92, detached: true }); seg.position.y = -k2 * 0.045; seg.rotation.x = k2 * 0.12; foot.add(seg); });
        const claw = K.glass(bodyP, new T.ConeGeometry(0.008, 0.04, 6).rotateX(PI), '#2b2a55', { op: 0.95, detached: true }); claw.position.y = -0.15; foot.add(claw);
        legs.push({ up, ph: (i + (s > 0 ? 0 : 1)) * 0.5 * PI, s });
      }));

      /* wings: two pairs with their veins, flapped about the body axis */
      const fore = K.leaf(14, 6, (u, v, o) => { const w = 0.17 * Math.sin(PI * Math.pow(u, 0.75)) + 0.02; o.z = u * 0.8; o.x = v * w - u * 0.17; o.y = 0.1 * u * u; });
      const hind = K.leaf(12, 5, (u, v, o) => { const w = 0.1 * Math.sin(PI * Math.pow(u, 0.75)) + 0.015; o.z = u * 0.52; o.x = v * w - 0.06 - u * 0.2; o.y = 0.06 * u * u; });
      const wings = [];
      [1, -1].forEach((s) => {
        const pv = new T.Group(); put(pv, 0, 0.06, 0.17, s * 0.07); pv.scale.z = s;
        pv.add(K.thin(wingsP, fore, P.sky, { op: 0.6, bump: 'veins', bumpScale: 2.2, detached: true }));
        const ph = new T.Group(); ph.position.set(-0.06, -0.02, 0); pv.add(ph);
        ph.add(K.thin(wingsP, hind, P.lav, { op: 0.58, bump: 'veins', bumpScale: 2.2, detached: true }));
        wings.push({ pv, s, ph });
      });

      /* the engine: striated flight muscles, a honey stomach, the nerve cord with its ganglia, the heart tube */
      const musc = K.solid(engP, K.ball(0.17, 0.14, 0.16, 22), P.coral, { detached: true }); put(musc, 2, 0.02, 0.04, 0);
      const fib = []; for (let i = 0; i < 26; i++) { const a = (i / 26) * TAU; const y = 0.1 * Math.sin(a); fib.push(V(-0.12, 0.04 + y, 0.12 * Math.cos(a)), V(0.16, 0.04 + y * 0.7, 0.1 * Math.cos(a))); }
      put(K.lines(engP, new T.BufferGeometry().setFromPoints(fib), '#ffe0d4', 0.7, { detached: true }), 2, 0, 0, 0);
      const honeyS = K.solid(engP, K.ball(0.22, 0.16, 0.16, 22), P.gold, { detached: true }); put(honeyS, 2, -0.62, -0.03, 0);
      put(K.solid(engP, new T.CylinderGeometry(0.014, 0.014, 1.3, 8).rotateZ(PI / 2), P.lav, { detached: true }), 2, -0.2, -0.05, 0);
      const gang = []; for (let i = 0; i < 7; i++) gang.push(new T.Matrix4().makeTranslation(-0.75 + i * 0.19, -0.05, 0));
      mv[2].add(K.solid(engP, new T.SphereGeometry(0.026, 10, 8), P.peri, { instances: gang, detached: true }));
      put(K.solid(engP, new T.TubeGeometry(new T.CatmullRomCurve3([V(0.4, 0.1, 0), V(0.1, 0.17, 0), V(-0.3, 0.16, 0), V(-0.9, 0.1, 0)]), 30, 0.012, 6), P.rose, { detached: true }), 2, 0, 0, 0);
      [1, -1].forEach((s) => put(K.solid(engP, K.ball(0.09, 0.06, 0.07, 12), P.cream, { detached: true }), 2, -0.34, 0.02, s * 0.14));

      const st = { f: 0, t: 0, beta: null, wg: 0, lp: 0, wp: 0, gp: 0 }; /* phases are integrated, never recomputed from t, so a change of rate cannot make them jump */
      const Y = 0.78; const PHI = 0.5; const RHO = 0.2; const TL = 2.0; /* a calmer dance: a smaller figure, a slower loop */ /* bee height, axis angle, loop width, loop seconds */
      const pose = (x, t) => {
        const dt = Math.min(0.1, Math.max(0, t - st.t)); st.t = t;
        const Tr = Math.max(0.15, x * BEE.run); const L = 0.3 * x; const cyc = 2 * (Tr + TL);
        st.f = (st.f + dt / cyc) % 1;
        const fr = Tr / cyc; const fl = TL / cyc; const f = st.f;
        let u; let w; let du; let dw; let waggle = 0;
        if (f < fr) { const a = f / fr; u = -L / 2 + L * a * a * (3 - 2 * a); w = 0; du = 1; dw = 0; waggle = 1; }
        else if (f < fr + fl) { const a = (f - fr) / fl; const al = PI * (a * a * (3 - 2 * a)); u = (L / 2) * Math.cos(al); w = RHO * Math.sin(al); du = -(L / 2) * Math.sin(al); dw = RHO * Math.cos(al); }
        else if (f < 2 * fr + fl) { const a = (f - fr - fl) / fr; u = -L / 2 + L * a * a * (3 - 2 * a); w = 0; du = 1; dw = 0; waggle = 1; }
        else { const a = (f - 2 * fr - fl) / fl; const al = PI * (a * a * (3 - 2 * a)); u = (L / 2) * Math.cos(al); w = -RHO * Math.sin(al); du = -(L / 2) * Math.sin(al); dw = -RHO * Math.cos(al); }
        const c = Math.cos(PHI); const sN = Math.sin(PHI);
        const X = u * c - w * sN; const Z = u * sN + w * c; const dX = du * c - dw * sN; const dZ = du * sN + dw * c;
        /* the bee turns into each loop instead of snapping 90 degrees, and the waggle fades in and out */
        const aim = Math.atan2(dZ, dX);
        st.beta = st.beta == null ? aim : st.beta + Math.atan2(Math.sin(aim - st.beta), Math.cos(aim - st.beta)) * (1 - Math.exp(-dt * 2.2));
        const beta = st.beta;
        st.wg += (waggle - st.wg) * (1 - Math.exp(-dt * 10));
        st.gp += dt * TAU * 8; st.wp += dt * TAU * 10; st.lp += dt * TAU * 4 * (waggle ? 0.5 : 1);
        const wag = st.wg * 0.08 * Math.sin(st.gp);
        const ph = st.wp; /* wings and waggle are slowed to rates the eye can follow at 60 frames a second */
        mv.forEach((m) => { m.position.set(X, Y + 0.006 * Math.sin(ph * 0.5), Z); m.rotation.set(0, -beta + wag, 0); });
        wings.forEach((o) => { const th = 0.18 + 0.55 * Math.sin(ph); o.pv.rotation.x = -o.s * th; o.ph.rotation.x = 0.08 * Math.sin(ph - 0.7) * o.s; });
        legs.forEach((l) => { l.up.rotation.z = 0.18 * Math.sin(st.lp + l.ph); });
        ants.forEach((a) => { a.g.rotation.z = 0.08 * Math.sin(TAU * 1.3 * t + a.s); a.g.rotation.y = a.s * 0.06 * Math.sin(TAU * 0.9 * t); });
        const k = 1 + 0.07 * Math.sin(ph * 2);
        musc.scale.set(k, 1 / k, k); honeyS.scale.setScalar(1 + 0.02 * Math.sin(ph * 0.5));
        const br = 1 + 0.025 * Math.sin(TAU * 1.1 * t); abdomen.scale.set(1, br, br);
      };
      return {
        root: rig.root, parts: rig.parts, pose,
      };
    },
  };
})();
