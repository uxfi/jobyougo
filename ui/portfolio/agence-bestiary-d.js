/* v2 studio, live bestiary, animals 8 and 9: the horse (mobility and travel), the elephant (large groups).
   Silhouette in lofted geometry, form in relief, strands and nails in instances, micro detail in maps. See agence-bestiary.js. */
(function () {
  'use strict';
  const B = (window.AgenceBestiary = window.AgenceBestiary || { animals: {} });
  const TAU = Math.PI * 2;
  const PI = Math.PI;
  const DEG = PI / 180;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const lerp = (a, b, t) => a + (b - a) * t;
  const g2 = (s, c, w) => Math.exp(-Math.pow((s - c) / w, 2));
  const env = (s) => Math.pow(Math.sin(PI * Math.pow(s, 0.55)), 0.55);

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
  const pickName = (o) => (document.documentElement.lang === 'fr' ? o.fr : o.en).split(' · ')[0];
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
      const T = K.T; const P = K.PAL; const V = K.V; const rig = K.rig(); const UP = V(0, 1, 0);
      const legsP = rig.part('legs', [0, -0.75, 0]); const bodyP = rig.part('body', [0, 0, 0]); const heartP = rig.part('heart', [0, 1.1, 1.0]);
      const mv = [legsP, bodyP, heartP].map((p) => { const g = new T.Group(); p.group.add(g); return g; });
      const put = (g, m, x, y, z) => { g.position.set(x, y, z); mv[m].add(g); return g; };
      const COAT = '#c6cff2'; const HIDE = { op: 0.88, map: 'dapple', bump: 'fuzz', bumpScale: 0.5 };

      /* body: one lofted barrel with a dipped back, a deep chest and a round croup; dappled grey coat with short hair */
      const bSpec = { len: 2.5, n: 60, ru: 3, rv: 3, a: () => 0.86, y: (s) => 2.0 + 0.07 * smooth(0.55, 0.85, s) + 0.06 * (1 - smooth(0, 0.3, s)), r: (s) => 0.006 + (0.5 + 0.07 * g2(s, 0.8, 0.12) + 0.08 * g2(s, 0.2, 0.14) - 0.03 * g2(s, 0.5, 0.2)) * env(s) };
      put(K.glass(bodyP, K.loft(bSpec), COAT, { ...HIDE, detached: true }), 1, 0, 0, 0);

      /* neck: a swept tube, narrower than it is deep; a mane of flowing strands along the crest (they move) */
      const nCurve = new T.CatmullRomCurve3([V(0.95, 2.3, 0), V(1.22, 2.74, 0), V(1.55, 3.1, 0), V(1.84, 3.36, 0)]);
      const nPts = nCurve.getPoints(14); const nR = nPts.map((_, i) => 0.46 - 0.29 * (i / 14));
      const neck = K.tube(14, 22, 3, 3); neck.set(nPts, nR, V(0, 1, 0), nPts.map(() => 0.74));
      put(K.glass(bodyP, neck.geo, COAT, { ...HIDE, detached: true }), 1, 0, 0, 0);
      const NM = 26; const maneG = K.feather(1, 0.1, { curl: 0.12, tip: 0.9 });
      const mane = K.thin(bodyP, maneG, P.lav, { op: 0.82, bump: 'feather', bumpScale: 1.6, instances: Array.from({ length: NM }, () => new T.Matrix4()), detached: true }); put(mane, 1, 0, 0, 0);

      /* head: lofted, tilted down; eyes with a glint and a brow, nostrils, cheek, lips, two pointed ears with an inner ear, a forelock */
      const hSpec = { x0: 0, len: 0.95, n: 40, ru: 2, rv: 2, a: (s) => 0.72 + 0.12 * s, r: (s) => 0.006 + (0.19 - 0.08 * smooth(0.2, 1, s)) * Math.pow(Math.sin(PI * Math.pow(s, 0.4)), 0.5) };
      const head = new T.Group(); put(head, 1, 1.8, 3.36, 0); head.rotation.z = -0.95;
      head.add(K.glass(bodyP, K.loft(hSpec), COAT, { op: 0.9, map: 'dapple', bump: 'fuzz', bumpScale: 0.4, detached: true }));
      [1, -1].forEach((s) => {
        const e = K.eye(bodyP, { r: 0.05, iris: '#7a4a30' }); e.position.set(0.26, 0.1, s * 0.14); e.rotation.y = s > 0 ? 0.5 : PI - 0.5; head.add(e);
        const brow = K.glass(bodyP, K.ball(0.07, 0.025, 0.05, 10), COAT, { op: 0.9, detached: true }); brow.position.set(0.26, 0.17, s * 0.12); head.add(brow);
        const nos = K.glass(bodyP, K.ball(0.034, 0.024, 0.02, 8), P.ink, { op: 0.96, detached: true }); nos.position.set(0.88, 0.02, s * 0.06); head.add(nos);
        const cheek = K.glass(bodyP, K.ball(0.2, 0.16, 0.06, 14), COAT, { op: 0.86, detached: true }); cheek.position.set(0.18, -0.07, s * 0.1); head.add(cheek);
        const ear = K.glass(bodyP, new T.ConeGeometry(0.07, 0.3, 12), P.peri, { op: 0.88, detached: true }); ear.position.set(-0.04, 0.22, s * 0.08); ear.rotation.set(s * 0.1, 0, -0.35); head.add(ear);
        const inner = K.glass(bodyP, new T.ConeGeometry(0.04, 0.22, 10), P.cream, { op: 0.9, detached: true }); inner.position.set(-0.03, 0.2, s * 0.09); inner.rotation.set(s * 0.1, 0, -0.35); head.add(inner);
      });
      const lips = K.glass(bodyP, K.ball(0.1, 0.035, 0.07, 12), P.rose, { op: 0.9, detached: true }); lips.position.set(0.9, -0.02, 0); head.add(lips);
      head.add(K.thin(bodyP, maneG, P.lav, { op: 0.84, bump: 'feather', bumpScale: 1.6, instances: K.fan([[-0.02, 0.2, 0, 0.2], [-0.02, 0.2, 0.03, 0.5], [-0.02, 0.2, -0.03, -0.1]].map(([x, y, z, a]) => ({ p: V(x, y, z), dir: V(0.5, -0.4 - a, a * 0.6), len: 0.3, nHint: V(0, 0, 1), wide: 0.5 }))) }));

      /* tail: a tube plus a fan of strands, re-shaped every frame */
      const tail = K.tube(12, 10, 2, 4); const tailP = Array.from({ length: 13 }, () => new T.Vector3()); const tailR = new Array(13);
      put(K.glass(bodyP, tail.geo, P.lav, { op: 0.86, bump: 'fuzz', bumpScale: 0.8, detached: true }), 1, 0, 0, 0);
      const NT = 30; const tailS = K.thin(bodyP, maneG, P.lav, { op: 0.8, bump: 'feather', bumpScale: 1.6, instances: Array.from({ length: NT }, () => new T.Matrix4()), detached: true }); put(tailS, 1, 0, 0, 0);
      const tailRnd = Array.from({ length: NT }, (_, i) => { const r = K.rng(40 + i); return { i: 1 + (i % 10), a: (r() - 0.5) * 0.9, b: (r() - 0.5) * 0.7, len: 0.4 + r() * 0.3 }; });

      /* legs: forearm or thigh, a knee, a cannon with its fetlock and pastern, a hoof with a coronet ring */
      const upSpec = { x0: 0, len: 0.86, n: 18, radial: 18, ru: 2, rv: 2, a: () => 0.95, r: (s) => 0.17 - 0.075 * smooth(0, 0.9, s) + 0.012 * smooth(0.86, 1, s) };
      const loSpec = { x0: 0, len: 0.92, n: 22, radial: 16, ru: 2, rv: 2, a: () => 0.95, r: (s) => 0.088 - 0.028 * smooth(0, 0.3, s) + 0.027 * g2(s, 0.78, 0.05) - 0.012 * smooth(0.84, 1, s) };
      const legs = [[-0.85, 0.3, false], [0.85, 0.27, true], [-0.85, -0.3, false], [0.85, -0.27, true]].map(([x, z, fore]) => {
        const hip = new T.Group(); put(hip, 0, x, 1.82, z);
        const ug = new T.Group(); ug.rotation.z = -PI / 2; hip.add(ug); ug.add(K.glass(legsP, K.loft(upSpec), COAT, { ...HIDE, detached: true }));
        const knee = new T.Group(); knee.position.y = -0.85; hip.add(knee);
        knee.add(K.glass(legsP, K.ball(0.1, 0.1, 0.09, 14), COAT, { op: 0.9, bump: 'fuzz', detached: true }));
        const lg = new T.Group(); lg.rotation.z = -PI / 2; knee.add(lg); lg.add(K.glass(legsP, K.loft(loSpec), COAT, { op: 0.9, map: 'dapple', bump: 'fuzz', bumpScale: 0.4, detached: true }));
        const hoof = K.glass(legsP, new T.CylinderGeometry(0.1, 0.128, 0.12, 20).translate(0, -0.97, 0), '#3a3470', { op: 0.95, bump: 'wrinkle', bumpScale: 0.8, detached: true }); knee.add(hoof);
        const cor = K.glass(legsP, new T.TorusGeometry(0.1, 0.014, 8, 20).rotateX(PI / 2), P.cream, { op: 0.92, detached: true }); cor.position.y = -0.915; knee.add(cor);
        return { hip, knee, fore };
      });
      const tickM = Array.from({ length: 24 }, () => new T.Matrix4());
      const ticks = K.thin(legsP, new T.PlaneGeometry(0.34, 0.02).rotateX(-PI / 2), P.ink, { op: 0.28, instances: tickM, detached: true }); legsP.group.add(ticks);

      /* inside: heart, lungs, spine, a cage of ribs */
      const heart = K.solid(heartP, K.ball(0.22, 0.25, 0.19, 18), P.coral, { detached: true }); put(heart, 2, 0.55, 1.92, 0);
      [1, -1].forEach((s) => put(K.solid(heartP, K.ball(0.4, 0.32, 0.2, 16), P.rose, { detached: true }), 2, 0.3, 2.2, s * 0.22));
      const sp = new T.CatmullRomCurve3([V(1.82, 3.32, 0), V(1.35, 2.95, 0), V(0.9, 2.62, 0), V(0.3, 2.56, 0), V(-0.4, 2.58, 0), V(-1.1, 2.44, 0)]);
      put(K.solid(heartP, new T.TubeGeometry(sp, 44, 0.05, 8), P.cream, { detached: true }), 2, 0, 0, 0);
      const ribM = Array.from({ length: 9 }, (_, i) => new T.Matrix4().compose(V(-0.55 + i * 0.16, 2.28, 0), new T.Quaternion(), V(0.4, 0.44 - Math.abs(i - 3.5) * 0.015, 0.4)));
      put(K.solid(heartP, new T.TorusGeometry(1, 0.05, 6, 14, PI).rotateY(PI / 2).rotateX(PI), P.cream, { instances: ribM, detached: true }), 2, 0, 0, 0);

      const st = { t: 0, phi: 0, hp: 0, dist: 0 };
      const tmp = new T.Object3D(); const lm = new T.Matrix4(); const qy = new T.Quaternion();
      const pose = (v, t) => {
        const dt = Math.min(0.1, Math.max(0, t - st.t)); st.t = t;
        st.phi = (st.phi + stride(v) * dt) % 1000; st.hp += (heartRate(v) / 60) * dt; st.dist += v * dt * 0.45;
        const o = gaitOffsets(v); const duty = lerp(0.68, 0.28, smooth(1.5, 12, v)); const A = lerp(0.32, 0.72, smooth(1.5, 11, v)) * smooth(0, 0.7, v);
        legs.forEach((l, i) => {
          const p = (((st.phi + o[i]) % 1) + 1) % 1; let al; let lift = 0;
          if (p < duty) al = A * (1 - (2 * p) / duty);
          else { const u = (p - duty) / (1 - duty); al = -A + 2 * A * smooth(0, 1, u); lift = Math.sin(PI * u); }
          l.hip.rotation.z = al; l.knee.rotation.z = -lift * (1.05 + 0.5 * smooth(2, 10, v)) * (l.fore ? 1 : 0.9);
        });
        const run = smooth(2, 10, v);
        const bob = (0.015 + 0.05 * run) * Math.cos(TAU * st.phi * 2); const pitch = (0.01 + 0.025 * run) * Math.sin(TAU * st.phi * 2 + 0.5);
        mv.forEach((m) => { m.position.y = bob; m.rotation.z = pitch; });
        heart.scale.setScalar(1 + 0.2 * Math.pow(Math.max(0, Math.sin(TAU * st.hp)), 3));
        /* the tail trails further back the faster the horse goes */
        const dl = lerp(1.3, 0.25, smooth(0, 12, v));
        let x = -1.08; let y = 2.18;
        for (let j = 0; j <= 12; j++) {
          const s = j / 12; tailP[j].set(x, y, 0); tailR[j] = 0.04 + 0.04 * Math.sin(PI * Math.min(1, s * 1.15)) + 0.01;
          const dj = dl + 0.35 * s * Math.sin(TAU * (st.phi * 0.5 - s) + 0.4);
          x -= (1.15 / 12) * Math.cos(dj); y -= (1.15 / 12) * Math.sin(dj);
        }
        tail.set(tailP, tailR, new T.Vector3(0, 0, 1));
        tailRnd.forEach((r, j) => {
          tail.place(tmp, r.i); tmp.updateMatrix();
          qy.setFromEuler(new T.Euler(r.b * 0.5, r.b, r.a)); lm.compose(V(0, (r.a * 0.05), r.b * 0.05), qy, V(r.len, r.len * 0.35, r.len));
          tailS.setMatrixAt(j, new T.Matrix4().multiplyMatrices(tmp.matrix, lm));
        });
        tailS.instanceMatrix.needsUpdate = true;
        /* the mane lifts and streams with the stride */
        const items = [];
        for (let j = 0; j < NM; j++) {
          const i = 1 + Math.round((j / (NM - 1)) * 12); const q = i * 3; const rr = nR[i] * 0.98;
          const sw = Math.sin(TAU * (st.phi * 0.5 + j * 0.07)) * (0.2 + 0.3 * run);
          items.push({ p: V(neck.c[q] + neck.nor[q] * rr, neck.c[q + 1] + neck.nor[q + 1] * rr, neck.c[q + 2] + neck.nor[q + 2] * rr), dir: V(-0.35 - 0.5 * run + sw * 0.3, -0.55 + 0.35 * run + sw * 0.2, 0.38 + 0.15 * Math.sin(TAU * st.phi + j)), len: 0.42 + 0.12 * ((j * 7) % 5) / 5, nHint: V(0, 0, 1), wide: 0.55 });
        }
        K.fan(items).forEach((m, j) => mane.setMatrixAt(j, m)); mane.instanceMatrix.needsUpdate = true;
        const tm = new T.Matrix4();
        for (let i = 0; i < 24; i++) { const row = i < 12 ? 1.25 : -1.25; const k = i % 12; const px = ((((k * 0.62 - st.dist) % 7.44) + 7.44) % 7.44) - 3.72; tm.makeTranslation(px, 0.004, row); ticks.setMatrixAt(i, tm); }
        ticks.instanceMatrix.needsUpdate = true;
      };
      return {
        root: rig.root, parts: rig.parts, pose,
        anchors: [
          { part: 'legs', obj: legs[1].knee, off: [0, -0.55, 0.1], dx: 70, dy: 54, en: 'Gait', fr: 'Allure', live: (v) => pickName(gaitName(v)) },
          { part: 'heart', obj: heart, off: [0, 0, 0.15], dx: -80, dy: -64, en: 'Heart', fr: 'Cœur', live: (v) => `${Math.round(heartRate(v))} bpm` },
          { part: 'body', obj: head, off: [0.5, 0.15, 0.1], dx: 70, dy: -40, en: 'Body & neck', fr: 'Corps et encolure' },
        ],
      };
    },
  };

  /* ───────── 9. The elephant · large groups · a trunk with no bone, from a hang to a reach ───────── */
  const EL = { n: 30, seg: 0.0635, bx: 2.15, by: 2.25, m: 1.05 }; /* trunk joints, length of one, base of the trunk, metres per model unit */
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
      const T = K.T; const P = K.PAL; const V = K.V; const rig = K.rig(); const UP = V(0, 1, 0);
      const trunkP = rig.part('trunk', [0.9, 0.5, 0]); const bodyP = rig.part('body', [0, -0.2, 0]); const earsP = rig.part('ears', [0, 0.6, 1.0]);
      const at = (g, parent, x, y, z) => { g.position.set(x, y, z); parent.add(g); return g; };
      const SKIN = '#b8a8ec'; /* a grey hide, in lavender so it holds against the pale page */

      /* body and head: lofted, folds of thick skin, a ridge of stiff hair along the back, temporal glands, eyes with lashes */
      const bG = at(new T.Group(), bodyP.group, -0.1, 0, 0);
      const bSpec = { len: 3.3, n: 60, ru: 3, rv: 4, a: () => 0.93, y: (s) => 2.35 + 0.09 * g2(s, 0.78, 0.15), r: (s) => 0.006 + (1.02 + 0.06 * g2(s, 0.78, 0.15) - 0.05 * g2(s, 0.4, 0.2)) * env(s) };
      const barrel = K.glass(bodyP, K.loft(bSpec), SKIN, { op: 0.9, backOp: 0.5, bump: 'wrinkle', bumpScale: 1.8, detached: true }); bG.add(barrel);
      bG.add(K.fuzz(bodyP, { surf: K.surf(bSpec), count: 90, s0: 0.1, s1: 0.9, th0: -0.5, th1: 0.5, hex: P.ink, len: 0.08, r: 0.01, lean: 0.4, op: 0.7 }));
      const hSpec = { x0: 0, len: 1.55, n: 44, ru: 2, rv: 3, a: () => 0.82, y: (s) => 2.72 - 0.32 * smooth(0.35, 1, s), r: (s) => 0.006 + (0.9 - 0.5 * smooth(0.5, 1, s)) * Math.pow(Math.sin(PI * Math.pow(s, 0.5)), 0.5) * (1 + 0.1 * g2(s, 0.3, 0.15)) };
      const headG = at(new T.Group(), bodyP.group, 0.72, 0, 0);
      headG.add(K.glass(bodyP, K.loft(hSpec), SKIN, { op: 0.86, bump: 'wrinkle', bumpScale: 1.4, detached: true }));
      const lashes = [];
      [1, -1].forEach((s) => {
        at(K.glass(bodyP, K.ball(0.07, 0.11, 0.05, 12), SKIN, { op: 0.88, bump: 'wrinkle', detached: true }), headG, 1.1, 2.76, s * 0.6);
        const e = K.eye(bodyP, { r: 0.052, iris: '#7a4a2a' }); at(e, headG, 1.0, 2.6, s * 0.57); e.rotation.y = s > 0 ? 1.2 : PI - 1.2;
        for (let k = 0; k < 6; k++) { const a = -0.9 + k * 0.36; lashes.push({ p: V(1.0 + Math.cos(a + 1.3) * 0.0, 2.6 + 0.045 + Math.sin(1.0) * 0.0, s * 0.575), dir: V(0.2 * Math.cos(a), 0.9, s * (0.3 + 0.5 * Math.sin(a))), len: 0.07, nHint: V(0, 0, 1), wide: 0.3 }); }
      });
      headG.add(K.thin(bodyP, new T.ConeGeometry(0.008, 1, 4).rotateZ(-PI / 2).translate(0.5, 0, 0), P.ink, { op: 0.9, instances: K.fan(lashes) }));

      /* four columnar legs: folds of skin, a flared foot and four toenails each; a tail with a tuft of hair */
      const legSpec = { x0: 0, len: 1.5, n: 24, radial: 22, ru: 2, rv: 5, a: () => 1.0, r: (s) => (0.4 - 0.07 * s + 0.06 * smooth(0.88, 0.98, s)) * (1 - smooth(0.985, 1, s)) + 0.006 };
      const nailG = new T.ConeGeometry(0.045, 0.12, 6).rotateZ(-PI / 2);
      [[0.9, 0.6], [0.9, -0.6], [-1.0, 0.62], [-1.0, -0.62]].forEach(([x, z]) => {
        const lg = at(new T.Group(), bodyP.group, x, 1.5, z); lg.rotation.z = -PI / 2;
        lg.add(K.glass(bodyP, K.loft(legSpec), SKIN, { op: 0.86, bump: 'wrinkle', bumpScale: 1.8, detached: true }));
        at(K.glass(bodyP, K.ball(0.44, 0.1, 0.42, 20), SKIN, { op: 0.88, bump: 'wrinkle', detached: true }), bodyP.group, x + 0.04, 0.1, z);
        bodyP.group.add(K.thin(bodyP, nailG, '#fff3dd', { op: 0.96, instances: [-0.24, -0.08, 0.08, 0.24].map((dz) => new T.Matrix4().compose(V(x + 0.43, 0.12, z + dz), new T.Quaternion().setFromEuler(new T.Euler(0, dz * 1.4, 0)), V(1, 1, 1))) }));
      });
      const tailG = at(new T.Group(), bodyP.group, -1.82, 2.4, 0);
      const tt = K.tube(10, 10); const tpts = new T.CatmullRomCurve3([V(0, 0, 0), V(-0.06, -0.35, 0), V(-0.1, -0.75, 0), V(-0.12, -1.1, 0), V(-0.12, -1.4, 0)]).getPoints(10);
      tt.set(tpts, tpts.map((_, i) => 0.06 - 0.03 * (i / 10)), V(0, 0, 1)); tailG.add(K.glass(bodyP, tt.geo, SKIN, { op: 0.88, bump: 'wrinkle', detached: true }));
      tailG.add(K.thin(bodyP, new T.ConeGeometry(0.01, 0.22, 4).rotateX(PI), P.ink, { op: 0.9, instances: Array.from({ length: 16 }, (_, i) => new T.Matrix4().compose(V(-0.12 + Math.cos(i) * 0.025, -1.42 - (i % 3) * 0.03, Math.sin(i * 1.7) * 0.03), new T.Quaternion().setFromEuler(new T.Euler(Math.sin(i * 2.1) * 0.25, 0, Math.cos(i * 1.3) * 0.25)), V(1, 1 + (i % 4) * 0.2, 1))) }));

      /* the trunk: a tube re-bent every frame with rings of skin, a fingered tip with nostrils, and muscle fibres winding round it */
      const trunk = K.tube(EL.n, 22, 3, 14); K.glass(trunkP, trunk.geo, P.peach, { op: 0.88, bump: 'wrinkle', bumpScale: 2.2 });
      const tipG = new T.Group(); trunkP.group.add(tipG);
      const fingerU = K.glass(trunkP, new T.ConeGeometry(0.04, 0.13, 8).rotateZ(-PI / 2 - 0.25), P.peach, { op: 0.92, detached: true }); fingerU.position.set(0.04, 0.03, 0); tipG.add(fingerU);
      const fingerL = K.glass(trunkP, new T.ConeGeometry(0.03, 0.09, 8).rotateZ(-PI / 2 + 0.3), P.peach, { op: 0.92, detached: true }); fingerL.position.set(0.03, -0.035, 0); tipG.add(fingerL);
      [1, -1].forEach((s) => { const n = K.glass(trunkP, K.ball(0.012, 0.016, 0.012, 6), P.ink, { op: 0.96, detached: true }); n.position.set(0.06, -0.0, s * 0.028); tipG.add(n); });
      const NF = 8; const fpos = new Float32Array(NF * EL.n * 2 * 3);
      const fgeo = new T.BufferGeometry(); fgeo.setAttribute('position', new T.BufferAttribute(fpos, 3));
      K.lines(trunkP, fgeo, P.cream, 0.85);
      const twig = K.thin(trunkP, new T.CylinderGeometry(0.03, 0.02, 1.2, 8).rotateZ(1.0), P.apricot, { op: 0.88, bump: 'wrinkle', detached: true }); at(twig, trunkP.group, 3.7, 3.55, 0);
      const leafG = K.leaf(8, 5, (u, v, o) => { const w = 0.13 * Math.sin(PI * Math.pow(u, 0.7)); o.x = u * 0.44; o.y = v * w; o.z = 0.04 * u * u; });
      trunkP.group.add(K.thin(trunkP, leafG, P.mint, { op: 0.8, bump: 'feather', bumpScale: 1.8, instances: K.fan(Array.from({ length: 9 }, (_, i) => ({ p: V(3.15 + 0.14 * i, 3.1 + 0.1 * ((i * 7) % 4), (i % 2 ? 1 : -1) * 0.05), dir: V(Math.cos(-0.9 + i * 0.35), Math.sin(-0.9 + i * 0.35) + 0.2, (i - 4) * 0.12), len: 1, nHint: V(0, 0, 1) }))) }));

      /* ears (they flap) with their veins, and tusks that taper from a thick root to a point */
      const earG = K.leaf(14, 14, (u, v, o) => { const h = 0.8 * Math.sqrt(Math.max(0, 1 - (2 * u - 1) * (2 * u - 1))) + 0.06; o.x = -u * 1.15; o.y = v * h - 0.15 * u + 0.025 * Math.sin(v * 22) * u; o.z = 0.1 * Math.sin(PI * u) + 0.03 * Math.sin(v * 9) * u; });
      const ears = [1, -1].map((s) => {
        const hinge = new T.Group(); at(hinge, earsP.group, 1.12, 2.95, s * 0.72);
        hinge.add(K.thin(earsP, earG, P.peri, { op: 0.72, bump: 'veins', bumpScale: 2.2, detached: true }));
        const tk = K.tube(18, 12); const tc = new T.CatmullRomCurve3([V(1.95, 2.05, s * 0.4), V(2.4, 1.72, s * 0.5), V(2.85, 1.8, s * 0.46), V(3.12, 2.15, s * 0.34)]).getPoints(18);
        tk.set(tc, tc.map((_, i) => 0.1 * Math.pow(1 - i / 18, 0.9) + 0.01), V(0, 1, 0)); earsP.group.add(K.glass(earsP, tk.geo, P.cream, { op: 0.95, bump: 'wrinkle', bumpScale: 0.6, detached: true }));
        return { hinge, s };
      });

      const Pn = Array.from({ length: EL.n + 1 }, () => new T.Vector3()); const Rn = new Array(EL.n + 1);
      const hint = new T.Vector3(0, 0, 1); const tip = at(new T.Group(), trunkP.group, 0, 0, 0);
      const pose = (x, t) => {
        const c = trunkChain(x);
        for (let i = 0; i <= EL.n; i++) {
          const s = i / EL.n; const sway = 0.05 * (1 - 0.6 * x) * Math.sin(TAU * 0.3 * t + s * 3) * s;
          Pn[i].set(EL.bx + c.pts[i].x, EL.by + c.pts[i].y + sway, 0);
          Rn[i] = (0.1 + 0.15 * Math.pow(1 - s, 0.85)) * (1 + 0.06 * Math.sin(i * 2.4) * (1 - 0.5 * s));
        }
        trunk.set(Pn, Rn, hint);
        trunk.place(tipG, EL.n);
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
        tailG.rotation.z = 0.08 * Math.sin(TAU * 0.35 * t);
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
