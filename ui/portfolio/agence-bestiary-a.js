/* v2 studio, live bestiary, animals 1 to 3: the bee (SaaS), the owl (AI products), the koi (fintech).
   Each one: one input, a model that is a pure function of it, a mechanism built from it. See agence-bestiary.js. */
(function () {
  'use strict';
  const B = (window.AgenceBestiary = window.AgenceBestiary || { animals: {} });
  const TAU = Math.PI * 2;

  /* ───────── 1. The bee · SaaS · the waggle dance: the length of the run says how far the flowers are ───────── */
  const BEE = { run: 1.0, speed: 6.7, beat: 230 }; /* s of waggle per km (about), flight m/s, wingbeats per s */
  B.animals.saas = {
    id: 'saas',
    frame: { r: 1.7, cy: 0.3, floor: -0.02, shadow: 3.6, yaw: 0.5, pitch: 0.44 },
    input: { min: 0.2, max: 3, def: 1.4, d: 1, unit: 'km', step: 0.01, period: 18, label: { en: 'Distance to the flowers', fr: 'Distance jusqu’aux fleurs' } },
    parts: [
      { id: 'wings', en: 'Wings', fr: 'Ailes' }, { id: 'body', en: 'Body & legs', fr: 'Corps et pattes' },
      { id: 'engine', en: 'Flight engine', fr: 'Moteur de vol' }, { id: 'comb', en: 'The comb', fr: 'Le rayon' },
    ],
    ro: [
      { en: 'Waggle run', fr: 'Course frétillante', unit: 's', d: 1 },
      { en: 'Round trip', fr: 'Aller-retour', unit: 'min', d: 1 },
      { en: 'Wing strokes on the way', fr: 'Battements d’ailes', unit: 'thousand', d: 0 },
    ],
    plot: 0,
    model(x) {
      const flight = (2 * x * 1000) / BEE.speed; /* s */
      return [x * BEE.run, flight / 60, (flight * BEE.beat) / 1000];
    },
    note: {
      en: 'Rounded textbook figures: about 1 s of waggle per km, flight at 6.7 m/s, 230 wingbeats a second. The wings are shown slowed down; the dance is real time.',
      fr: 'Chiffres de manuel arrondis : environ 1 s de frétillement par km, vol à 6,7 m/s, 230 battements d’ailes par seconde. Les ailes sont ralenties à l’image ; la danse est en temps réel.',
    },
    build(K) {
      const T = K.T; const P = K.PAL;
      const rig = K.rig();
      const wingsP = rig.part('wings', [0, 1.05, 0]);
      const bodyP = rig.part('body', [0, 0, 0]);
      const engP = rig.part('engine', [0.1, 0.62, 0.95]);
      const combP = rig.part('comb', [0, -0.55, 0]);
      const BEE_S = 1.45; /* the bee is drawn larger than the cells so it reads at a glance */
      const mv = [wingsP, bodyP, engP].map((p) => { const g = new T.Group(); g.scale.setScalar(BEE_S); p.group.add(g); return g; });
      const put = (obj, m, x, y, z) => { obj.position.set(x, y, z); mv[m].add(obj); return obj; };

      /* the comb: hexagonal cells in glass, a pale floor */
      const rc = 0.2; const s3 = Math.sqrt(3) * rc; const cells = []; const R = 3;
      for (let q = -R; q <= R; q++) for (let r = -R; r <= R; r++) {
        if (Math.abs(q + r) > R) continue;
        cells.push(new T.Matrix4().makeTranslation(q * s3 + r * s3 * 0.5, 0, r * s3 * 0.8660254));
      }
      const cellGeo = new T.CylinderGeometry(rc * 0.97, rc * 0.97, 0.15, 6, 1, true);
      K.thin(combP, cellGeo, P.apricot, { op: 0.62, instances: cells });
      const floor = K.thin(combP, new T.CircleGeometry(1.46, 56), P.gold, { op: 0.34, detached: true });
      floor.rotation.x = -Math.PI / 2; floor.position.y = -0.07; combP.group.add(floor);

      /* the body: head, thorax, abdomen with three bands, eyes, antennae */
      const thorax = K.glass(bodyP, K.ball(0.27, 0.21, 0.21), P.peach, { op: 0.85, detached: true }); put(thorax, 1, 0, 0, 0);
      const head = K.glass(bodyP, K.ball(0.15, 0.14, 0.16), P.apricot, { op: 0.85, detached: true }); put(head, 1, 0.36, -0.01, 0);
      const abdomen = K.glass(bodyP, K.ball(0.43, 0.22, 0.22), P.apricot, { op: 0.8, detached: true }); put(abdomen, 1, -0.54, -0.03, 0); abdomen.rotation.z = -0.07;
      [[-0.2, 0.2], [0.03, 0.222], [0.24, 0.185]].forEach(([dx, rr]) => {
        const ring = K.glass(bodyP, new T.TorusGeometry(rr, 0.035, 10, 28), '#4a3f8f', { op: 0.92, backOp: 0.2, detached: true });
        ring.rotation.y = Math.PI / 2; abdomen.add(ring); ring.position.set(dx, 0, 0);
      });
      [1, -1].forEach((s) => {
        const eye = K.glass(bodyP, K.ball(0.06, 0.075, 0.06, 14), '#4a3f8f', { op: 0.95, detached: true }); put(eye, 1, 0.43, 0.05, s * 0.115);
        const ant = K.thin(bodyP, new T.CylinderGeometry(0.01, 0.01, 0.34, 6).translate(0, 0.17, 0), '#4a3f8f', { op: 0.9, detached: true });
        put(ant, 1, 0.46, 0.1, s * 0.05); ant.rotation.set(s * 0.45, 0, -1.0);
      });
      const legs = [];
      [1, -1].forEach((s) => [0.18, 0, -0.17].forEach((hx, i) => {
        const hip = new T.Group(); put(hip, 1, hx, -0.15, s * 0.11);
        const up = new T.Group(); hip.add(up); up.rotation.x = -s * 0.95;
        const seg1 = K.thin(bodyP, new T.CylinderGeometry(0.02, 0.016, 0.2, 6).translate(0, -0.1, 0), P.peach, { op: 0.9, detached: true });
        up.add(seg1);
        const low = new T.Group(); low.position.y = -0.2; up.add(low); low.rotation.x = s * 1.25;
        low.add(K.thin(bodyP, new T.CylinderGeometry(0.016, 0.01, 0.24, 6).translate(0, -0.12, 0), P.peach, { op: 0.9, detached: true }));
        legs.push({ up, ph: (i + (s > 0 ? 0 : 1)) * 0.5 * Math.PI, s });
      }));

      /* the wings: two pairs, flapped about the body axis */
      const fore = K.leaf(12, 5, (u, v, o) => { const w = 0.17 * Math.sin(Math.PI * Math.pow(u, 0.75)) + 0.02; o.z = u * 0.8; o.x = v * w - u * 0.17; o.y = 0.1 * u * u; });
      const hind = K.leaf(10, 4, (u, v, o) => { const w = 0.1 * Math.sin(Math.PI * Math.pow(u, 0.75)) + 0.015; o.z = u * 0.52; o.x = v * w - 0.06 - u * 0.2; o.y = 0.06 * u * u; });
      const wings = [];
      [1, -1].forEach((s) => {
        const pv = new T.Group(); put(pv, 0, 0.06, 0.17, s * 0.07); pv.scale.z = s;
        pv.add(K.thin(wingsP, fore, P.sky, { op: 0.58, detached: true }));
        const ph = new T.Group(); ph.position.set(-0.06, -0.02, 0); pv.add(ph);
        ph.add(K.thin(wingsP, hind, P.lav, { op: 0.55, detached: true }));
        wings.push({ pv, s, ph });
      });

      /* the engine: two flight muscles, a honey stomach, the nerve cord */
      const musc = K.solid(engP, K.ball(0.16, 0.13, 0.15, 20), P.coral, { detached: true }); put(musc, 2, 0.02, 0.04, 0);
      const honey = K.solid(engP, K.ball(0.2, 0.15, 0.15, 20), P.gold, { detached: true }); put(honey, 2, -0.56, -0.03, 0);
      const cord = K.solid(engP, new T.CylinderGeometry(0.012, 0.012, 1.3, 8).rotateZ(Math.PI / 2), P.lav, { detached: true }); put(cord, 2, -0.2, -0.02, 0);

      const st = { f: 0, t: 0, lastX: 1.4 };
      const Y = 0.78; const PHI = 0.5; const RHO = 0.32; const TL = 1.1; /* bee height, axis angle, loop width, loop seconds */
      const pose = (x, t) => {
        const dt = Math.min(0.1, Math.max(0, t - st.t)); st.t = t;
        const Tr = Math.max(0.15, x * BEE.run); const L = 0.42 * x; const cyc = 2 * (Tr + TL);
        st.f = (st.f + dt / cyc) % 1;
        const fr = Tr / cyc; const fl = TL / cyc; const f = st.f;
        let u; let w; let du; let dw; let waggle = 0;
        if (f < fr) { const a = f / fr; u = -L / 2 + L * a; w = 0; du = 1; dw = 0; waggle = 1; }
        else if (f < fr + fl) { const a = (f - fr) / fl; const al = Math.PI * (a * a * (3 - 2 * a)); u = (L / 2) * Math.cos(al); w = RHO * Math.sin(al); du = -(L / 2) * Math.sin(al); dw = RHO * Math.cos(al); }
        else if (f < 2 * fr + fl) { const a = (f - fr - fl) / fr; u = -L / 2 + L * a; w = 0; du = 1; dw = 0; waggle = 1; }
        else { const a = (f - 2 * fr - fl) / fl; const al = Math.PI * (a * a * (3 - 2 * a)); u = (L / 2) * Math.cos(al); w = -RHO * Math.sin(al); du = -(L / 2) * Math.sin(al); dw = -RHO * Math.cos(al); }
        const c = Math.cos(PHI); const sN = Math.sin(PHI);
        const X = u * c - w * sN; const Z = u * sN + w * c; const dX = du * c - dw * sN; const dZ = du * sN + dw * c;
        const beta = Math.atan2(dZ, dX);
        const wag = waggle * 0.2 * Math.sin(TAU * 13 * t);
        const ph = TAU * 18 * t;
        mv.forEach((m) => { m.position.set(X, Y + 0.012 * Math.sin(ph * 0.5), Z); m.rotation.set(0, -beta + wag, 0); });
        wings.forEach((o) => { const th = 0.18 + 0.55 * Math.sin(ph); o.pv.rotation.x = -o.s * th; o.ph.rotation.x = 0.08 * Math.sin(ph - 0.7) * o.s; });
        legs.forEach((l) => { l.up.rotation.z = 0.18 * Math.sin(TAU * 4 * t * (waggle ? 0.5 : 1) + l.ph); });
        const k = 1 + 0.07 * Math.sin(ph * 2);
        musc.scale.set(k, 1 / k, k); honey.scale.setScalar(1 + 0.02 * Math.sin(ph * 0.5));
      };
      return {
        root: rig.root, parts: rig.parts, pose,
        anchors: [
          { part: 'wings', obj: wings[0].pv, off: [-0.1, 0.05, 0.72], dx: 64, dy: -52, en: 'Wings', fr: 'Ailes', live: () => `${BEE.beat} Hz` },
          { part: 'engine', obj: musc, off: [0, 0.05, 0], dx: -86, dy: -62, en: 'Flight muscles', fr: 'Muscles de vol' },
          { part: 'body', obj: abdomen, off: [-0.1, -0.18, 0.1], dx: -70, dy: 52, en: 'Waggle run', fr: 'Course frétillante', live: (x) => `${(x * BEE.run).toFixed(1)} s` },
        ],
      };
    },
  };
})();
