/* v2 studio, live bestiary, animals 8 and 9: the horse (mobility and travel), the elephant (large groups).
   See agence-bestiary.js for the contract. */
(function () {
  'use strict';
  const B = (window.AgenceBestiary = window.AgenceBestiary || { animals: {} });
  const TAU = Math.PI * 2;
  const DEG = Math.PI / 180;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const lerp = (a, b, t) => a + (b - a) * t;

  /* ───────── 8. The horse · mobility and travel · one speed, four gaits ───────── */
  const GAITS = [ /* beat offsets for [left hind, left fore, right hind, right fore], as a fraction of the stride */
    [0, 0.25, 0.5, 0.75], /* walk: four beats, lateral sequence */
    [0, 0.5, 0.5, 0], /* trot: two beats, diagonal pairs */
    [0.33, 0.66, 0, 0.33], /* canter: three beats */
    [0.12, 0.62, 0, 0.5], /* gallop: four beats, with a moment in the air */
  ];
  const CUTS = [2.2, 5.5, 9]; /* m/s where walk gives way to trot, canter, gallop (about) */
  const wrap = (d) => d - Math.round(d);
  const gaitOffsets = (v) => {
    const o = GAITS[0].slice();
    for (let j = 0; j < 3; j++) { const s = smooth(CUTS[j] - 0.5, CUTS[j] + 0.5, v); for (let i = 0; i < 4; i++) o[i] += wrap(GAITS[j + 1][i] - o[i]) * s; }
    return o;
  };
  const STRIDE = [[0, 0], [1.7, 0.9], [4, 1.3], [7, 1.8], [16, 2.4]]; /* speed m/s to strides a second, about */
  const stride = (v) => { for (let i = 1; i < STRIDE.length; i++) if (v <= STRIDE[i][0]) return lerp(STRIDE[i - 1][1], STRIDE[i][1], (v - STRIDE[i - 1][0]) / (STRIDE[i][0] - STRIDE[i - 1][0])); return 2.4; };
  const heartRate = (v) => 36 + 184 * Math.pow(clamp(v / 16, 0, 1), 0.9);
  const gaitName = (v) => (v < 0.2 ? { en: 'Standing', fr: 'À l’arrêt' } : v < CUTS[0] ? { en: 'Walk · 4 beats', fr: 'Pas · 4 temps' } : v < CUTS[1] ? { en: 'Trot · 2 beats', fr: 'Trot · 2 temps' } : v < CUTS[2] ? { en: 'Canter · 3 beats', fr: 'Canter · 3 temps' } : { en: 'Gallop · 4 beats', fr: 'Galop · 4 temps' });
  B.animals.mobility = {
    id: 'mobility',
    frame: { r: 3.1, cx: 0.4, cy: 1.65, floor: 0, shadow: 5.4, yaw: 0.82, pitch: 0.14 },
    input: { min: 0, max: 16, def: 5, d: 1, unit: 'm/s', step: 0.05, period: 26, label: { en: 'Speed', fr: 'Vitesse' }, fmt: (x, n) => `${n(x, 1)} m/s` },
    parts: [
      { id: 'legs', en: 'Four legs', fr: 'Quatre jambes' }, { id: 'body', en: 'Body & neck', fr: 'Corps et encolure' }, { id: 'heart', en: 'Heart & spine', fr: 'Cœur et colonne' },
    ],
    ro: [
      { en: 'Speed', fr: 'Vitesse', unit: 'km/h', d: 0 }, { en: 'Strides a second', fr: 'Foulées par seconde', unit: 'Hz', d: 1 }, { en: 'Gait', fr: 'Allure', unit: '' },
    ],
    plot: 1,
    model(v) { return [v * 3.6, stride(v), gaitName(v)]; },
    note: {
      en: 'Rounded figures: walk up to about 2 m/s, trot to 5, canter to 9, gallop beyond (a racehorse passes 16). The heart goes from about 36 beats a minute at rest towards 220 flat out.',
      fr: 'Chiffres arrondis : pas jusqu’à 2 m/s environ, trot jusqu’à 5, canter jusqu’à 9, galop au-delà (un cheval de course dépasse 16). Le cœur passe d’environ 36 battements par minute au repos à près de 220 à fond.',
    },
    build(K) {
      const T = K.T; const P = K.PAL; const rig = K.rig();
      const legsP = rig.part('legs', [0, -0.75, 0]); const bodyP = rig.part('body', [0, 0, 0]); const heartP = rig.part('heart', [0, 1.1, 1.0]);
      const mv = [legsP, bodyP, heartP].map((p) => { const g = new T.Group(); p.group.add(g); return g; });
      const put = (g, m, x, y, z) => { g.position.set(x, y, z); mv[m].add(g); return g; };

      /* body */
      put(K.glass(bodyP, K.ball(1.2, 0.58, 0.5, 38), P.peri, { op: 0.84, detached: true }), 1, 0, 2.05, 0);
      put(K.glass(bodyP, K.ball(0.62, 0.62, 0.5, 26), P.peri, { op: 0.84, detached: true }), 1, -0.78, 2.06, 0);
      put(K.glass(bodyP, K.ball(0.5, 0.62, 0.46, 26), P.peri, { op: 0.84, detached: true }), 1, 0.78, 2.02, 0);
      const neckCurve = new T.CatmullRomCurve3([new T.Vector3(0.85, 2.25, 0), new T.Vector3(1.2, 2.72, 0), new T.Vector3(1.55, 3.1, 0), new T.Vector3(1.84, 3.38, 0)]);
      const neck = K.tube(10, 14); const nPts = neckCurve.getPoints(10); neck.set(nPts, nPts.map((_, i) => 0.44 - 0.27 * (i / 10)), new T.Vector3(0, 0, 1));
      put(K.glass(bodyP, neck.geo, P.peri, { op: 0.84, detached: true }), 1, 0, 0, 0);
      const head = new T.Group(); put(head, 1, 2.17, 3.2, 0); head.rotation.z = -0.95;
      head.add(K.glass(bodyP, K.ball(0.5, 0.21, 0.19, 26), P.peach, { op: 0.86, detached: true }));
      [1, -1].forEach((s) => {
        const e = K.glass(bodyP, K.ball(0.035, 0.035, 0.035, 8), P.ink, { op: 0.98, detached: true }); e.position.set(0.12, 0.1, s * 0.16); head.add(e);
        const ear = K.glass(bodyP, new T.ConeGeometry(0.07, 0.3, 10), P.peach, { op: 0.86, detached: true }); put(ear, 1, 1.86, 3.58, s * 0.13); ear.rotation.z = 0.15;
      });
      const mane = [];
      for (let i = 0; i < 7; i++) {
        const p = nPts[2 + i]; const leaf = K.thin(bodyP, K.leaf(5, 3, (u, v, o) => { o.x = -u * 0.38; o.y = -u * 0.12; o.z = v * 0.07; }), P.lav, { op: 0.7, detached: true });
        put(leaf, 1, p.x - 0.1, p.y + 0.2 + 0.06 * (i % 2), 0); mane.push({ leaf, i });
      }
      const tail = K.tube(12, 8); put(K.glass(bodyP, tail.geo, P.lav, { op: 0.84, detached: true }), 1, 0, 0, 0);
      const tailP = Array.from({ length: 13 }, () => new T.Vector3()); const tailR = new Array(13);

      /* legs: hip, knee, hoof; order left hind, left fore, right hind, right fore */
      const legs = [[-0.85, 0.3, false], [0.85, 0.27, true], [-0.85, -0.3, false], [0.85, -0.27, true]].map(([x, z, fore]) => {
        const hip = new T.Group(); put(hip, 0, x, 1.82, z);
        hip.add(K.glass(legsP, new T.CylinderGeometry(0.14, 0.1, 0.86, 12).translate(0, -0.43, 0), P.peach, { op: 0.86, detached: true }));
        const knee = new T.Group(); knee.position.y = -0.85; hip.add(knee);
        knee.add(K.glass(legsP, new T.CylinderGeometry(0.085, 0.065, 0.9, 12).translate(0, -0.45, 0), P.peach, { op: 0.86, detached: true }));
        knee.add(K.glass(legsP, new T.CylinderGeometry(0.1, 0.12, 0.1, 12).translate(0, -0.93, 0), P.ink, { op: 0.92, detached: true }));
        return { hip, knee, fore };
      });
      const tickM = []; for (let i = 0; i < 24; i++) { const m = new T.Matrix4(); tickM.push(m); }
      const ticks = K.thin(legsP, new T.PlaneGeometry(0.34, 0.02).rotateX(-Math.PI / 2), P.ink, { op: 0.28, instances: tickM, detached: true }); legsP.group.add(ticks);

      /* inside: heart, lungs, spine */
      const heart = K.solid(heartP, K.ball(0.22, 0.25, 0.19, 18), P.coral, { detached: true }); put(heart, 2, 0.55, 1.92, 0);
      [1, -1].forEach((s) => put(K.solid(heartP, K.ball(0.4, 0.32, 0.2, 16), P.rose, { detached: true }), 2, 0.3, 2.2, s * 0.22));
      const sp = new T.CatmullRomCurve3([new T.Vector3(1.82, 3.32, 0), new T.Vector3(1.35, 2.95, 0), new T.Vector3(0.9, 2.62, 0), new T.Vector3(0.3, 2.56, 0), new T.Vector3(-0.4, 2.58, 0), new T.Vector3(-1.1, 2.44, 0)]);
      mv[2].add(K.solid(heartP, new T.TubeGeometry(sp, 44, 0.05, 8), P.cream, { detached: true }));

      const st = { t: 0, phi: 0, hp: 0, dist: 0 };
      const pose = (v, t) => {
        const dt = Math.min(0.1, Math.max(0, t - st.t)); st.t = t;
        st.phi = (st.phi + stride(v) * dt) % 1000; st.hp += (heartRate(v) / 60) * dt; st.dist += v * dt * 0.45;
        const o = gaitOffsets(v); const duty = lerp(0.68, 0.28, smooth(1.5, 12, v)); const A = lerp(0.32, 0.72, smooth(1.5, 11, v)) * smooth(0, 0.7, v);
        legs.forEach((l, i) => {
          const p = (((st.phi + o[i]) % 1) + 1) % 1; let al; let lift = 0;
          if (p < duty) al = A * (1 - (2 * p) / duty);
          else { const u = (p - duty) / (1 - duty); al = -A + 2 * A * smooth(0, 1, u); lift = Math.sin(Math.PI * u); }
          l.hip.rotation.z = al; l.knee.rotation.z = -lift * (1.05 + 0.5 * smooth(2, 10, v)) * (l.fore ? 1 : 0.9);
        });
        const run = smooth(2, 10, v);
        const bob = (0.015 + 0.05 * run) * Math.cos(TAU * st.phi * 2); const pitch = (0.01 + 0.025 * run) * Math.sin(TAU * st.phi * 2 + 0.5);
        mv.forEach((m) => { m.position.y = bob; m.rotation.z = pitch; });
        heart.scale.setScalar(1 + 0.2 * Math.pow(Math.max(0, Math.sin(TAU * st.hp)), 3));
        const dl = lerp(1.3, 0.25, smooth(0, 12, v));
        let x = -1.08; let y = 2.18;
        for (let j = 0; j <= 12; j++) {
          const s = j / 12; tailP[j].set(x, y, 0); tailR[j] = 0.05 + 0.075 * Math.sin(Math.PI * Math.min(1, s * 1.15)) + 0.012;
          const dj = dl + 0.35 * s * Math.sin(TAU * (st.phi * 0.5 - s) + 0.4);
          x -= (1.15 / 12) * Math.cos(dj); y -= (1.15 / 12) * Math.sin(dj);
        }
        tail.set(tailP, tailR, new T.Vector3(0, 0, 1));
        mane.forEach((m) => { m.leaf.rotation.z = 0.12 + 0.25 * run + 0.1 * Math.sin(TAU * (st.phi * 0.5 + 0.1 * m.i)); });
        const tm = new T.Matrix4();
        for (let i = 0; i < 24; i++) { const row = i < 12 ? 1.25 : -1.25; const k = i % 12; const px = ((((k * 0.62 - st.dist) % 7.44) + 7.44) % 7.44) - 3.72; tm.makeTranslation(px, 0.004, row); ticks.setMatrixAt(i, tm); }
        ticks.instanceMatrix.needsUpdate = true;
      };
      return {
        root: rig.root, parts: rig.parts, pose,
        anchors: [
          { part: 'legs', obj: legs[1].knee, off: [0, -0.55, 0.1], dx: 70, dy: 54, en: 'Gait', fr: 'Allure', live: (v) => pickName(gaitName(v)) },
          { part: 'heart', obj: heart, off: [0, 0, 0.15], dx: -80, dy: -64, en: 'Heart', fr: 'Cœur', live: (v) => `${Math.round(heartRate(v))} bpm` },
          { part: 'body', obj: head, off: [0.2, 0.15, 0.1], dx: 70, dy: -40, en: 'Body & neck', fr: 'Corps et encolure' },
        ],
      };
    },
  };
  const pickName = (o) => (document.documentElement.lang === 'fr' ? o.fr : o.en).split(' · ')[0];

  /* ───────── 9. The elephant · large groups · a trunk with no bone, from a hang to a reach ───────── */
  const EL = { n: 30, seg: 0.0635, bx: 1.95, by: 2.3, m: 1.05 }; /* trunk joints, length of one, base of the trunk, metres per model unit */
  const trunkChain = (x) => {
    const thb = lerp(-78, 26, x) * DEG; const C = 140 * (1 - x) * DEG;
    const pts = [{ x: 0, y: 0 }]; let px = 0; let py = 0; let prev = thb; let turn = 0;
    for (let i = 0; i < EL.n; i++) {
      const tau = (i + 0.5) / EL.n;
      const ang = thb + C * Math.pow(tau, 2.2) + 12 * DEG * x * tau * tau + 0.16 * (1 - x) * Math.sin(TAU * tau);
      turn += Math.abs(ang - prev); prev = ang;
      px += EL.seg * Math.cos(ang); py += EL.seg * Math.sin(ang); pts.push({ x: px, y: py });
    }
    return { pts, turn, end: prev };
  };
  B.animals.enterprise = {
    id: 'enterprise',
    frame: { r: 3.3, cx: 0.95, cy: 1.8, floor: 0, shadow: 6.6, yaw: 0.42, pitch: 0.16 },
    input: { min: 0, max: 1, def: 0.5, d: 2, unit: '%', step: 0.005, period: 18, label: { en: 'How far the trunk reaches', fr: 'Portée de la trompe' }, fmt: (x, n) => `${n(x * 100, 0)} %` },
    parts: [
      { id: 'trunk', en: 'Trunk, no bone', fr: 'Trompe, sans os' }, { id: 'body', en: 'Body & legs', fr: 'Corps et pattes' }, { id: 'ears', en: 'Ears & tusks', fr: 'Oreilles et défenses' },
    ],
    ro: [
      { en: 'Tip above the ground', fr: 'Bout au-dessus du sol', unit: 'm', d: 1 }, { en: 'Reach ahead of the head', fr: 'Portée devant la tête', unit: 'm', d: 1 }, { en: 'Turn along the trunk', fr: 'Courbure le long de la trompe', unit: '°', d: 0 },
    ],
    plot: 0,
    model(x) { const c = trunkChain(x); const e = c.pts[EL.n]; return [(EL.by + e.y) * EL.m, e.x * EL.m, c.turn / DEG]; },
    note: {
      en: 'There is no bone in an elephant’s trunk: it is muscle and skin, about 2 m long, and the herd moves on the memory of its matriarch. Same length from hang to reach; only the bend changes. Proportions stylised.',
      fr: 'La trompe d’un éléphant n’a aucun os : c’est du muscle et de la peau, environ 2 m de long, et le troupeau avance sur la mémoire de sa matriarche. Même longueur de l’arrêt à la portée ; seule la courbure change. Proportions stylisées.',
    },
    build(K) {
      const T = K.T; const P = K.PAL; const rig = K.rig();
      const trunkP = rig.part('trunk', [0.9, 0.5, 0]); const bodyP = rig.part('body', [0, -0.2, 0]); const earsP = rig.part('ears', [0, 0.6, 1.0]);
      const at = (g, parent, x, y, z) => { g.position.set(x, y, z); parent.add(g); return g; };

      const barrel = K.glass(bodyP, K.ball(1.6, 1.08, 0.98, 42), P.lav, { op: 0.84, detached: true }); at(barrel, bodyP.group, -0.1, 2.35, 0);
      const head = K.glass(bodyP, K.ball(0.9, 0.95, 0.74, 34), P.lav, { op: 0.84, detached: true }); at(head, bodyP.group, 1.42, 2.62, 0);
      at(K.glass(bodyP, K.ball(0.55, 0.5, 0.58, 24), P.lav, { op: 0.84, detached: true }), bodyP.group, 1.15, 3.12, 0);
      [1, -1].forEach((s) => {
        at(K.glass(bodyP, K.ball(0.04, 0.04, 0.04, 8), P.ink, { op: 0.98, detached: true }), bodyP.group, 1.88, 2.92, s * 0.5);
        [[0.88, 0.62], [-0.98, 0.64]].forEach(([x, z]) => {
          at(K.glass(bodyP, new T.CylinderGeometry(0.4, 0.36, 1.55, 18).translate(0, 0.78, 0), P.lav, { op: 0.84, detached: true }), bodyP.group, x, 0, s * z);
          at(K.glass(bodyP, K.ball(0.44, 0.13, 0.44, 16), P.apricot, { op: 0.9, detached: true }), bodyP.group, x + 0.04, 0.1, s * z);
        });
      });
      const tailT = K.glass(bodyP, new T.CylinderGeometry(0.05, 0.02, 1.1, 8).translate(0, -0.55, 0), P.lav, { op: 0.86, detached: true }); at(tailT, bodyP.group, -1.65, 2.3, 0); tailT.rotation.z = 0.12;

      /* the trunk: a tube re-bent every frame, with muscle fibres winding round it (seen by the x-ray) */
      const trunk = K.tube(EL.n, 18); K.glass(trunkP, trunk.geo, P.peach, { op: 0.88 });
      const NF = 8; const fpos = new Float32Array(NF * EL.n * 2 * 3);
      const fgeo = new T.BufferGeometry(); fgeo.setAttribute('position', new T.BufferAttribute(fpos, 3));
      K.lines(trunkP, fgeo, P.cream, 0.85);
      const twig = K.thin(trunkP, new T.CylinderGeometry(0.03, 0.02, 1.2, 8).rotateZ(1.0), P.apricot, { op: 0.85, detached: true }); at(twig, trunkP.group, 3.7, 3.55, 0);
      for (let i = 0; i < 6; i++) {
        const leaf = K.thin(trunkP, K.leaf(6, 4, (u, v, o) => { o.x = u * 0.42; o.y = v * 0.13 * Math.sin(Math.PI * Math.pow(u, 0.8)); o.z = 0; }), P.mint, { op: 0.75, detached: true });
        at(leaf, trunkP.group, 3.3 + 0.18 * i, 3.18 + 0.1 * ((i * 7) % 3), (i % 2 ? 1 : -1) * 0.05); leaf.rotation.set(0, (i - 2.5) * 0.45, -0.9 + i * 0.35);
      }

      /* ears (they flap) and tusks */
      const ears = [1, -1].map((s) => {
        const hinge = new T.Group(); at(hinge, earsP.group, 1.12, 2.92, s * 0.7);
        hinge.add(K.thin(earsP, K.leaf(10, 10, (u, v, o) => { const h = 0.78 * Math.sqrt(Math.max(0, 1 - (2 * u - 1) * (2 * u - 1))) + 0.05; o.x = -u * 1.1; o.y = v * h - 0.15 * u; o.z = 0.1 * Math.sin(Math.PI * u); }), P.peri, { op: 0.66, detached: true }));
        const tusk = K.glass(earsP, new T.TubeGeometry(new T.CatmullRomCurve3([new T.Vector3(1.8, 2.2, s * 0.38), new T.Vector3(2.2, 1.9, s * 0.46), new T.Vector3(2.62, 1.95, s * 0.42), new T.Vector3(2.86, 2.28, s * 0.32)]), 18, 0.065, 10), P.cream, { op: 0.95, detached: true });
        earsP.group.add(tusk);
        return { hinge, s };
      });

      const Pn = Array.from({ length: EL.n + 1 }, () => new T.Vector3()); const Rn = new Array(EL.n + 1);
      const hint = new T.Vector3(0, 0, 1); const tip = at(new T.Group(), trunkP.group, 0, 0, 0);
      const pose = (x, t) => {
        const c = trunkChain(x);
        for (let i = 0; i <= EL.n; i++) {
          const sway = 0.05 * (1 - 0.6 * x) * Math.sin(TAU * 0.3 * t + (i / EL.n) * 3) * (i / EL.n);
          Pn[i].set(EL.bx + c.pts[i].x, EL.by + c.pts[i].y + sway, 0);
          Rn[i] = 0.04 + 0.19 * Math.pow(1 - i / EL.n, 1.1);
        }
        trunk.set(Pn, Rn, hint);
        let q = 0;
        for (let f = 0; f < NF; f++) {
          const ph = (f / NF) * TAU;
          for (let i = 0; i < EL.n; i++) {
            for (let e = 0; e < 2; e++) {
              const k = i + e; const tw = ph + k * 0.22; const r = Rn[k] * 0.8; const a = Math.cos(tw) * r; const b = Math.sin(tw) * r;
              const nx = trunk.nor[k * 3]; const ny = trunk.nor[k * 3 + 1]; const nz = trunk.nor[k * 3 + 2];
              const tx = trunk.tan[k * 3]; const ty = trunk.tan[k * 3 + 1]; const tz = trunk.tan[k * 3 + 2];
              const bx = ty * nz - tz * ny; const by = tz * nx - tx * nz; const bz = tx * ny - ty * nx;
              fpos[q++] = Pn[k].x + a * nx + b * bx; fpos[q++] = Pn[k].y + a * ny + b * by; fpos[q++] = Pn[k].z + a * nz + b * bz;
            }
          }
        }
        fgeo.attributes.position.needsUpdate = true;
        tip.position.copy(Pn[EL.n]);
        ears.forEach((e) => { e.hinge.rotation.y = e.s * (0.14 + 0.2 * Math.sin(TAU * 0.5 * t + (e.s > 0 ? 0 : 0.5))); });
        barrel.scale.y = 1 + 0.012 * Math.sin(TAU * 0.25 * t);
        tailT.rotation.z = 0.12 + 0.12 * Math.sin(TAU * 0.35 * t);
      };
      return {
        root: rig.root, parts: rig.parts, pose,
        anchors: [
          { part: 'trunk', obj: tip, off: [0, 0, 0], dx: 74, dy: 52, en: 'Trunk tip', fr: 'Bout de la trompe', live: (x) => `${((EL.by + trunkChain(x).pts[EL.n].y) * EL.m).toFixed(1)} m` },
          { part: 'ears', obj: ears[0].hinge, off: [-0.6, 0.35, 0], dx: -80, dy: -52, en: 'Ears & tusks', fr: 'Oreilles et défenses' },
          { part: 'body', obj: barrel, off: [-0.5, 0.3, 0.7], dx: -84, dy: 54, en: 'Body & legs', fr: 'Corps et pattes' },
        ],
      };
    },
  };
})();
