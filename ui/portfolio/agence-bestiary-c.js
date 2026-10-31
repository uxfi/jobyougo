/* v2 studio, live bestiary, animals 5 to 7: the hummingbird (e-commerce), the octopus (marketplaces), the swan (luxury).
   See agence-bestiary.js for the contract. */
(function () {
  'use strict';
  const B = (window.AgenceBestiary = window.AgenceBestiary || { animals: {} });
  const TAU = Math.PI * 2;
  const DEG = Math.PI / 180;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const lerp = (a, b, t) => a + (b - a) * t;

  /* ───────── 5. The hummingbird · e-commerce · it hovers where the lift equals the weight ───────── */
  const HUM = { hover: 55, slow: 10 }; /* wingbeats a second at which it hovers (about), slow-motion factor on screen */
  B.animals.ecommerce = {
    id: 'ecommerce',
    frame: { r: 1.5, cx: 0.6, cy: 0.42, floor: -1.05, shadow: 2.8, yaw: 0.55, pitch: 0.16 },
    input: { min: 20, max: 80, def: 55, d: 0, unit: 'Hz', step: 1, period: 16, label: { en: 'Wingbeats a second', fr: 'Battements d’ailes par seconde' }, fmt: (x, n) => `${n(x, 0)} Hz` },
    parts: [
      { id: 'wings', en: 'Wings, figure of eight', fr: 'Ailes, en huit' }, { id: 'body', en: 'Body & tail', fr: 'Corps et queue' }, { id: 'bill', en: 'Bill & tongue', fr: 'Bec et langue' },
    ],
    ro: [
      { en: 'Strokes a minute', fr: 'Battements par minute', unit: 'thousand', d: 1 }, { en: 'One stroke lasts', fr: 'Un battement dure', unit: 'ms', d: 1 }, { en: 'Lift ÷ weight', fr: 'Portance ÷ poids', unit: '×', d: 2 },
    ],
    plot: 2,
    model(f) { return [(f * 60) / 1000, 1000 / f, Math.pow(f / HUM.hover, 2)]; },
    note: {
      en: 'About 55 wingbeats a second to hover (it varies by species). Lift grows with the square of the beat rate, so below that it sinks and above it climbs. The wings are shown ten times slower.',
      fr: 'Environ 55 battements par seconde pour faire du sur-place (selon l’espèce). La portance croît avec le carré de la fréquence : en dessous l’oiseau descend, au-dessus il monte. Les ailes sont dix fois ralenties.',
    },
    build(K) {
      const T = K.T; const P = K.PAL; const rig = K.rig();
      const wingsP = rig.part('wings', [0, 0.9, 0]); const bodyP = rig.part('body', [0, 0, 0]); const billP = rig.part('bill', [0.7, 0.25, 0.9]);
      const mv = [wingsP, bodyP, billP].map((p) => { const g = new T.Group(); p.group.add(g); return g; });
      const put = (g, m, x, y, z) => { g.position.set(x, y, z); mv[m].add(g); return g; };

      const body = K.glass(bodyP, K.ball(0.55, 0.2, 0.2, 30), P.peri, { op: 0.86, detached: true }); put(body, 1, 0, 0, 0);
      put(K.glass(bodyP, K.ball(0.21, 0.18, 0.18, 24), P.mint, { op: 0.86, detached: true }), 1, 0.63, 0.1, 0);
      put(K.glass(bodyP, K.ball(0.22, 0.12, 0.17, 20), P.rose, { op: 0.85, detached: true }), 1, 0.55, -0.07, 0);
      [1, -1].forEach((s) => put(K.glass(bodyP, K.ball(0.04, 0.04, 0.04, 10), P.ink, { op: 0.98, detached: true }), 1, 0.7, 0.16, s * 0.12));
      const tailLeaf = K.leaf(8, 4, (u, v, o) => { o.x = -u * 0.75; o.z = v * (0.05 + 0.13 * u); o.y = -0.03 * u; });
      [-0.2, 0, 0.2].forEach((yw) => { const f = K.thin(bodyP, tailLeaf, P.lav, { op: 0.62, detached: true }); put(f, 1, -0.5, -0.02, 0); f.rotation.y = yw; });

      /* the bill reaches into a flower that stays where it is: the bird rises and sinks around it */
      const bill = K.thin(billP, new T.ConeGeometry(0.032, 0.92, 8).rotateZ(-Math.PI / 2).translate(0.46, 0, 0), P.ink, { op: 0.92, detached: true }); put(bill, 2, 0.78, 0.1, 0);
      const tongue = K.solid(billP, new T.CylinderGeometry(0.012, 0.009, 1, 6).rotateZ(Math.PI / 2).translate(0.5, 0, 0), P.coral, { detached: true }); put(tongue, 2, 0.8, 0.1, 0);
      const stem = K.thin(billP, new T.CylinderGeometry(0.025, 0.025, 1.5, 8), P.mint, { op: 0.8, detached: true }); stem.position.set(1.52, -0.28, 0); billP.group.add(stem);
      const cup = K.thin(billP, new T.CylinderGeometry(0.26, 0.07, 0.5, 20, 1, true), P.rose, { op: 0.7, detached: true }); cup.position.set(1.52, 0.72, 0); billP.group.add(cup);

      const wingGeo = K.leaf(12, 5, (u, v, o) => { const w = 0.3 * Math.sin(Math.PI * Math.pow(u, 0.6)) * (1 - 0.5 * u) + 0.02; o.z = u * 1.25; o.x = v * w - u * 0.28; o.y = 0.06 * u * u; });
      const wings = [1, -1].map((s) => {
        const outer = new T.Group(); put(outer, 0, 0.14, 0.14, s * 0.1); outer.scale.z = s;
        const inner = new T.Group(); outer.add(inner);
        inner.add(K.thin(wingsP, wingGeo, s > 0 ? P.peri : P.lav, { op: 0.8, detached: true }));
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
        tongue.scale.x = 0.85 + 0.3 * (0.5 + 0.5 * Math.sin(TAU * 3 * t));
      };
      return {
        root: rig.root, parts: rig.parts, pose,
        anchors: [
          { part: 'wings', obj: wings[0].outer, off: [-0.1, 0.05, 0.95], dx: 70, dy: -50, en: 'Wings', fr: 'Ailes', live: (f) => `${Math.round(f)} Hz` },
          { part: 'body', obj: body, off: [-0.2, -0.1, 0.18], dx: -86, dy: 52, en: 'Lift ÷ weight', fr: 'Portance ÷ poids', live: (f) => `${Math.pow(f / HUM.hover, 2).toFixed(2)}×` },
          { part: 'bill', obj: tongue, off: [0.9, 0, 0], dx: 66, dy: 46, en: 'Tongue', fr: 'Langue' },
        ],
      };
    },
  };

  /* ───────── 6. The octopus · marketplaces · eight arms, each with its own small brain ───────── */
  const OCT = { neurons: 41.7, suckers: 240 }; /* million neurons per arm (about two thirds of 500 million, over eight), suckers per arm (about) */
  B.animals.marketplace = {
    id: 'marketplace',
    frame: { r: 3.05, cy: 0.62, floor: -0.04, shadow: 6.2, yaw: 0.5, pitch: 0.52 },
    input: { min: 0, max: 8, def: 3, d: 1, unit: 'arms', step: 0.01, period: 22, label: { en: 'Arms reaching a side of the market', fr: 'Bras qui rejoignent un côté du marché' }, fmt: (x, n) => `${n(x, 1)} / 8` },
    parts: [
      { id: 'arms', en: 'Eight arms', fr: 'Huit bras' }, { id: 'body', en: 'Mantle & eyes', fr: 'Manteau et yeux' }, { id: 'heart', en: '3 hearts & brain', fr: '3 cœurs et cerveau' },
    ],
    ro: [
      { en: 'Arms out', fr: 'Bras déployés', unit: 'of 8', d: 0 }, { en: 'Neurons in those arms', fr: 'Neurones dans ces bras', unit: 'million ≈', d: 0 }, { en: 'Suckers in play', fr: 'Ventouses en jeu', unit: '≈', d: 0 },
    ],
    plot: 1,
    model(x) { const n = clamp(x, 0, 8); return [Math.floor(n + 1e-6), n * OCT.neurons, Math.round((n * OCT.suckers) / 10) * 10]; },
    note: {
      en: 'About two thirds of an octopus’s roughly 500 million neurons sit in its arms, so each arm decides for itself. About 240 suckers an arm. Common octopus, rounded.',
      fr: 'Environ les deux tiers des quelque 500 millions de neurones d’une pieuvre sont dans ses bras : chaque bras décide pour lui-même. Environ 240 ventouses par bras. Pieuvre commune, arrondi.',
    },
    build(K) {
      const T = K.T; const P = K.PAL; const rig = K.rig();
      const armsP = rig.part('arms', [0, -0.3, 0]); const bodyP = rig.part('body', [0, 0.9, 0]); const heartP = rig.part('heart', [0, 0.45, 1.0]);
      const at = (g, parent, x, y, z) => { g.position.set(x, y, z); parent.add(g); return g; };

      const mantle = K.glass(bodyP, K.ball(0.6, 0.74, 0.58, 34), P.lav, { op: 0.84, detached: true }); at(mantle, bodyP.group, -0.12, 1.12, 0); mantle.rotation.z = 0.28;
      at(K.glass(bodyP, K.ball(0.5, 0.4, 0.5, 28), P.rose, { op: 0.86, detached: true }), bodyP.group, 0.2, 0.66, 0);
      [1, -1].forEach((s) => {
        at(K.glass(bodyP, K.ball(0.13, 0.13, 0.1, 14), '#f4a64a', { op: 0.95, detached: true }), bodyP.group, 0.52, 0.76, s * 0.33);
        at(K.glass(bodyP, K.ball(0.06, 0.06, 0.05, 10), P.ink, { op: 0.98, detached: true }), bodyP.group, 0.6, 0.76, s * 0.34);
      });
      const hearts = [[0, 0.92, 0], [0.12, 0.8, 0.14], [0.12, 0.8, -0.14]].map((p) => at(K.solid(heartP, K.ball(0.1, 0.09, 0.09, 14), P.coral, { detached: true }), heartP.group, p[0], p[1], p[2]));
      const brain = at(K.solid(heartP, K.ball(0.2, 0.12, 0.22, 16), P.peri, { detached: true }), heartP.group, 0.38, 0.8, 0);

      /* eight arms (tubes re-shaped every frame) and eight stalls of the market on the ground */
      const NA = 28; const arms = []; const nodes = [];
      for (let i = 0; i < 8; i++) {
        const tube = K.tube(NA, 10); K.glass(armsP, tube.geo, i % 2 ? P.rose : P.lav, { op: 0.84 });
        const al = (i + 0.5) * (TAU / 8);
        const pts = Array.from({ length: NA + 1 }, () => new T.Vector3()); const rad = new Array(NA + 1);
        arms.push({ tube, al, pts, rad, i });
        const node = new T.Group(); at(node, armsP.group, Math.cos(al) * 2.55, 0.03, Math.sin(al) * 2.55);
        const ring = K.thin(armsP, new T.TorusGeometry(0.17, 0.035, 10, 28).rotateX(Math.PI / 2), P.mint, { op: 0.75, detached: true }); node.add(ring);
        const gem = K.glass(armsP, K.ball(0.07, 0.07, 0.07, 12), P.gold, { op: 0.92, detached: true }); gem.position.y = 0.06; node.add(gem);
        nodes.push(node);
      }
      const tip = at(new T.Group(), armsP.group, 0, 0, 0);
      const hint = new T.Vector3(0, 1, 0);

      const pose = (x, t) => {
        arms.forEach((a) => {
          const k = smooth(0, 1, clamp(x - a.i, 0, 1));
          const ca = Math.cos(a.al); const sa = Math.sin(a.al);
          for (let j = 0; j <= NA; j++) {
            const s = j / NA;
            const om = (Math.PI - 0.2) - s * TAU * 1.6; const rho = 0.62 * (1 - 0.82 * s);
            const rr = 0.95 + rho * Math.cos(om); const ry = 0.3 + rho * Math.sin(om);
            const gr = 0.35 + s * 2.2; const gy = 0.45 - 0.35 * s + 0.55 * Math.sin(Math.PI * s) * (1 - 0.3 * s);
            const r = lerp(rr, gr, k); const y = lerp(ry, gy, k);
            const lat = (lerp(0.1, 0.022, k)) * Math.sin(TAU * (0.4 * t + a.i * 0.13) + s * 5) * Math.sin(Math.PI * s);
            a.pts[j].set(r * ca - lat * sa, y, r * sa + lat * ca);
            a.rad[j] = 0.155 * Math.pow(1 - s, 0.9) + 0.016;
          }
          a.tube.set(a.pts, a.rad, hint);
          nodes[a.i].scale.setScalar(1 + 0.5 * k);
          if (a.i === 2) tip.position.copy(a.pts[16]);
        });
        const br = 1 + 0.03 * Math.sin(TAU * 0.5 * t);
        mantle.scale.set(br, 1 / br, br);
        hearts.forEach((h, i) => { const b = 1 + 0.16 * Math.pow(Math.max(0, Math.sin(TAU * 1.1 * t + i * 0.8)), 3); h.scale.setScalar(b); });
        brain.scale.setScalar(1 + 0.02 * Math.sin(TAU * 0.3 * t));
      };
      return {
        root: rig.root, parts: rig.parts, pose,
        anchors: [
          { part: 'arms', obj: tip, off: [0, 0, 0], dx: 70, dy: 52, en: 'Arms out', fr: 'Bras déployés', live: (x) => `${Math.floor(clamp(x, 0, 8) + 1e-6)} / 8` },
          { part: 'body', obj: mantle, off: [-0.2, 0.5, 0.1], dx: -84, dy: -38, en: 'Mantle', fr: 'Manteau' },
          { part: 'heart', obj: brain, off: [0.1, 0.1, 0.1], dx: 80, dy: -46, en: 'Brain & 3 hearts', fr: 'Cerveau et 3 cœurs' },
        ],
      };
    },
  };

  /* ───────── 7. The swan · luxury · the same neck, 24 vertebrae, from a curve to a line ───────── */
  const SW = { n: 24, seg: 0.086, cm: 29 }; /* vertebrae, length of one in model units, centimetres per model unit */
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
    frame: { r: 2.35, cx: 0.25, cy: 1.1, floor: -0.06, shadow: 4.4, yaw: 0.62, pitch: 0.2 },
    input: { min: 0, max: 1, def: 0.35, d: 2, unit: '%', step: 0.005, period: 16, label: { en: 'How far the neck is stretched', fr: 'Étirement du cou' }, fmt: (x, n) => `${n(x * 100, 0)} %` },
    parts: [
      { id: 'neck', en: 'Neck, 24 vertebrae', fr: 'Cou, 24 vertèbres' }, { id: 'wings', en: 'Wings', fr: 'Ailes' }, { id: 'body', en: 'Body & water', fr: 'Corps et eau' },
    ],
    ro: [
      { en: 'Head above the water', fr: 'Tête au-dessus de l’eau', unit: 'cm', d: 0 }, { en: 'Reach ahead of the chest', fr: 'Portée devant la poitrine', unit: 'cm', d: 0 }, { en: 'Biggest bend, one joint', fr: 'Plus grand pli, une vertèbre', unit: '°', d: 1 },
    ],
    plot: 0,
    model(x) {
      const c = swanChain(x); const e = c.pts[SW.n];
      return [(SW_BASE.y + e.y) * SW.cm, e.x * SW.cm, c.maxBend / DEG];
    },
    note: {
      en: 'A mute swan has about 24 neck vertebrae (a human has 7). The neck keeps the same length from curl to line: only the angle at each joint changes. Proportions stylised, 1 unit is about 29 cm.',
      fr: 'Un cygne tuberculé a environ 24 vertèbres cervicales (l’humain en a 7). Le cou garde la même longueur de la courbe à la ligne : seul l’angle de chaque articulation change. Proportions stylisées, 1 unité vaut environ 29 cm.',
    },
    build(K) {
      const T = K.T; const P = K.PAL; const rig = K.rig();
      const neckP = rig.part('neck', [0, 1.0, 0.2]); const wingsP = rig.part('wings', [0, 0.8, 0.9]); const bodyP = rig.part('body', [0, -0.15, 0]);
      const at = (g, parent, x, y, z) => { g.position.set(x, y, z); parent.add(g); return g; };

      const SWB = '#d9cffb'; /* a white swan on a pale page: a light lavender with dark back faces so the edges read */
      at(K.glass(bodyP, K.ball(1.2, 0.56, 0.62, 40), SWB, { op: 0.88, backOp: 0.55, detached: true }), bodyP.group, 0, 0.3, 0);
      at(K.glass(bodyP, K.ball(0.5, 0.52, 0.46, 24), SWB, { op: 0.88, backOp: 0.5, detached: true }), bodyP.group, 0.78, 0.5, 0);
      const tail = K.glass(bodyP, new T.ConeGeometry(0.22, 0.85, 16).rotateZ(Math.PI / 2 - 0.3), SWB, { op: 0.88, backOp: 0.5, detached: true }); at(tail, bodyP.group, -1.45, 0.62, 0);
      [1, -1].forEach((s) => {
        const w = K.glass(wingsP, K.ball(0.9, 0.36, 0.13, 28), P.peri, { op: 0.85, backOp: 0.5, detached: true }); at(w, wingsP.group, -0.15, 0.56, s * 0.5); w.rotation.set(0, -s * 0.2, 0.14);
      });
      const water = K.thin(bodyP, new T.CircleGeometry(2.9, 64), P.sky, { op: 0.2, detached: true }); water.rotation.x = -Math.PI / 2; bodyP.group.add(water);
      const ripples = [0, 1, 2].map(() => { const r = K.thin(bodyP, new T.RingGeometry(0.985, 1, 72), P.peri, { op: 0.5, detached: true }); r.rotation.x = -Math.PI / 2; r.position.y = 0.005; bodyP.group.add(r); return r; });

      const neck = K.tube(SW.n, 16); K.glass(neckP, neck.geo, SWB, { op: 0.9, backOp: 0.55 });
      const head = new T.Group(); neckP.group.add(head);
      head.add(K.glass(neckP, K.ball(0.18, 0.085, 0.085, 22), SWB, { op: 0.92, backOp: 0.5, detached: true }));
      const bill = K.glass(neckP, new T.ConeGeometry(0.06, 0.3, 12).rotateZ(-Math.PI / 2).scale(1, 0.8, 1.4), P.coral, { op: 0.95, detached: true }); bill.position.x = 0.3; head.add(bill);
      const knob = K.glass(neckP, K.ball(0.04, 0.04, 0.04, 10), P.ink, { op: 0.98, detached: true }); knob.position.set(0.2, 0.08, 0); head.add(knob);
      [1, -1].forEach((s) => { const e = K.glass(neckP, K.ball(0.025, 0.025, 0.025, 8), P.ink, { op: 0.98, detached: true }); e.position.set(0.1, 0.03, s * 0.07); head.add(e); });
      const verts = Array.from({ length: SW.n }, (_, i) => { const m = K.solid(neckP, K.ball(0.052, 0.052, 0.052, 10), i % 2 ? P.cream : P.lav, { detached: true }); neckP.group.add(m); return m; });

      const Pn = Array.from({ length: SW.n + 1 }, () => new T.Vector3()); const Rn = new Array(SW.n + 1);
      const hint = new T.Vector3(0, 0, 1);
      const pose = (x, t) => {
        const c = swanChain(x);
        for (let i = 0; i <= SW.n; i++) { Pn[i].set(SW_BASE.x + c.pts[i].x, SW_BASE.y + c.pts[i].y, 0); Rn[i] = 0.062 + 0.085 * Math.pow(1 - i / SW.n, 1.7); }
        neck.set(Pn, Rn, hint);
        for (let i = 0; i < SW.n; i++) verts[i].position.set((Pn[i].x + Pn[i + 1].x) / 2, (Pn[i].y + Pn[i + 1].y) / 2, 0);
        head.position.copy(Pn[SW.n]); head.rotation.z = c.endAng - 0.45 * (1 - x) - 0.05 * Math.sin(TAU * 0.3 * t);
        ripples.forEach((r, i) => { const ph = (t * 0.1 + i / 3) % 1; r.scale.setScalar(1.3 + 1.5 * ph); r.userData.base = 0.5 * (1 - ph); });
      };
      return {
        root: rig.root, parts: rig.parts, pose,
        anchors: [
          { part: 'neck', obj: head, off: [0.1, 0.1, 0.05], dx: -92, dy: 34, en: 'Head above the water', fr: 'Tête au-dessus de l’eau', live: (x) => `${Math.round((SW_BASE.y + swanChain(x).pts[SW.n].y) * SW.cm)} cm` },
          { part: 'wings', obj: wingsP.group, off: [-0.4, 0.62, 0.55], dx: -90, dy: -50, en: 'Wings', fr: 'Ailes' },
          { part: 'body', obj: tail, off: [-0.3, -0.1, 0.1], dx: -84, dy: 56, en: 'Body & water', fr: 'Corps et eau' },
        ],
      };
    },
  };
})();
