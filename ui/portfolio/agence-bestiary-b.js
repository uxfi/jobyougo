/* v2 studio, live bestiary, animals 2 to 4: the owl (AI products), the koi (fintech), the tortoise (real estate).
   See agence-bestiary.js for the contract. */
(function () {
  'use strict';
  const B = (window.AgenceBestiary = window.AgenceBestiary || { animals: {} });
  const TAU = Math.PI * 2;
  const DEG = Math.PI / 180;

  /* ───────── 2. The owl · AI products · it sees clearly because the whole head turns ───────── */
  B.animals.ai = {
    id: 'ai',
    frame: { r: 1.85, cy: 1.18, floor: -0.02, shadow: 2.8, yaw: 0.3, pitch: 0.1 },
    input: {
      min: -135, max: 135, def: 0, d: 0, unit: '°', step: 1, period: 15, label: { en: 'Head turn', fr: 'Rotation de la tête' },
      fmt: (x) => `${x > 0.5 ? '+' : ''}${Math.round(x)}°`,
    },
    parts: [
      { id: 'head', en: 'Head & eyes', fr: 'Tête et yeux' }, { id: 'neck', en: 'Neck, 14 vertebrae', fr: 'Cou, 14 vertèbres' }, { id: 'body', en: 'Body & wings', fr: 'Corps et ailes' },
    ],
    ro: [
      { en: 'Head turn', fr: 'Rotation', unit: '°', d: 0 }, { en: 'Per vertebra', fr: 'Par vertèbre', unit: '°', d: 1 }, { en: 'Looking', fr: 'Regard', unit: '' },
    ],
    plot: 0,
    model(x) {
      const a = Math.abs(x);
      return [a, a / 14, a < 35 ? { en: 'Ahead', fr: 'Devant' } : a < 95 ? { en: 'Sideways', fr: 'De côté' } : { en: 'Over the shoulder', fr: 'Par-dessus l’épaule' }];
    },
    note: {
      en: 'An owl has 14 neck vertebrae (a human has 7) and turns its head about 270° in all: 135° each way. Its eyes are fixed in the skull, so the head does the looking.',
      fr: 'Une chouette a 14 vertèbres cervicales (l’humain en a 7) et tourne la tête d’environ 270° en tout : 135° de chaque côté. Ses yeux sont fixes dans le crâne, c’est la tête qui regarde.',
    },
    build(K) {
      const T = K.T; const P = K.PAL; const rig = K.rig();
      const headP = rig.part('head', [0, 1.0, 0.35]); const neckP = rig.part('neck', [0, 0.38, 1.0]); const bodyP = rig.part('body', [0, -0.5, 0]);
      const at = (g, parent, x, y, z) => { g.position.set(x, y, z); parent.add(g); return g; };

      const perch = K.glass(bodyP, new T.CylinderGeometry(0.07, 0.07, 2.7, 14).rotateZ(Math.PI / 2), P.apricot, { op: 0.88, detached: true }); at(perch, bodyP.group, 0, -0.01, 0);
      const body = K.glass(bodyP, K.ball(0.64, 0.86, 0.56, 36), P.peri, { op: 0.86, detached: true }); at(body, bodyP.group, 0, 0.92, -0.04);
      [1, -1].forEach((s) => {
        const wing = K.glass(bodyP, K.ball(0.13, 0.72, 0.4, 24), P.lav, { op: 0.82, detached: true }); at(wing, bodyP.group, s * 0.6, 0.9, -0.12); wing.rotation.z = -s * 0.08;
        const foot = K.glass(bodyP, K.ball(0.1, 0.055, 0.18, 14), P.apricot, { op: 0.9, detached: true }); at(foot, bodyP.group, s * 0.2, 0.07, 0.2);
      });
      const tail = K.glass(bodyP, K.ball(0.28, 0.55, 0.07, 20), P.lav, { op: 0.8, detached: true }); at(tail, bodyP.group, 0, 0.28, -0.52); tail.rotation.x = -0.42;
      const belly = K.glass(bodyP, K.ball(0.36, 0.5, 0.2, 20), P.cream, { op: 0.55, detached: true }); at(belly, bodyP.group, 0, 0.85, 0.34);

      const headPiv = at(new T.Group(), headP.group, 0, 1.95, 0);
      at(K.glass(headP, K.ball(0.54, 0.43, 0.47, 32), P.peri, { op: 0.86, detached: true }), headPiv, 0, 0, 0);
      [1, -1].forEach((s) => {
        const disc = K.glass(headP, K.ball(0.23, 0.26, 0.07, 22), P.cream, { op: 0.8, detached: true }); at(disc, headPiv, s * 0.22, -0.02, 0.4); disc.rotation.y = -s * 0.36;
        at(K.glass(headP, K.ball(0.13, 0.13, 0.1, 18), '#f4a64a', { op: 0.95, detached: true }), headPiv, s * 0.21, 0.02, 0.45);
        at(K.glass(headP, K.ball(0.06, 0.06, 0.05, 12), P.ink, { op: 0.98, detached: true }), headPiv, s * 0.21, 0.02, 0.52);
        const tuft = K.glass(headP, new T.ConeGeometry(0.09, 0.34, 10), P.lav, { op: 0.85, detached: true }); at(tuft, headPiv, s * 0.31, 0.43, 0); tuft.rotation.z = -s * 0.36;
      });
      const beak = K.glass(headP, new T.ConeGeometry(0.075, 0.22, 10).rotateX(Math.PI / 2), P.apricot, { op: 0.95, detached: true }); at(beak, headPiv, 0, -0.1, 0.52);

      /* the neck: 14 discs with a small spur at the front so the twist can be read, one per vertebra */
      const discs = [];
      for (let i = 0; i < 14; i++) {
        const g = at(new T.Group(), neckP.group, 0, 1.4 + i * (0.5 / 13), 0);
        const r = 0.17 - 0.012 * Math.sin((i / 13) * Math.PI);
        g.add(K.solid(neckP, new T.CylinderGeometry(r, r, 0.034, 18), P.cream, { detached: true }));
        const nub = K.solid(neckP, new T.BoxGeometry(0.06, 0.03, 0.1), P.coral, { detached: true }); nub.position.z = r + 0.02; g.add(nub);
        discs.push(g);
      }
      at(K.solid(neckP, new T.CylinderGeometry(0.02, 0.02, 0.6, 8), P.lav, { detached: true }), neckP.group, 0, 1.72, 0);

      const st = { t: 0 };
      const pose = (x, t) => {
        const th = x * DEG;
        headPiv.rotation.y = th;
        discs.forEach((g, i) => { g.rotation.y = th * (i / 13); });
        body.scale.y = 1 + 0.012 * Math.sin(TAU * 0.35 * t);
        headPiv.rotation.x = 0.03 * Math.sin(TAU * 0.2 * t);
        st.t = t;
      };
      return {
        root: rig.root, parts: rig.parts, pose,
        anchors: [
          { part: 'head', obj: headPiv, off: [0.5, 0.28, 0.2], dx: 76, dy: -44, en: 'Head', fr: 'Tête', live: (x) => `${x > 0.5 ? '+' : ''}${Math.round(x)}°` },
          { part: 'neck', obj: discs[7], off: [-0.17, 0, 0], dx: -84, dy: 14, en: '14 vertebrae', fr: '14 vertèbres' },
          { part: 'body', obj: body, off: [-0.6, 0.2, 0.15], dx: -82, dy: 70, en: 'Wings folded', fr: 'Ailes repliées' },
        ],
      };
    },
  };

  /* ───────── 3. The koi · fintech · a wave that travels down the body; the faster it swims, the better it pays ───────── */
  const KOI = { len: 0.7, f: (v) => 0.6 + 1.5 * v }; /* body length in metres, tail beats per second */
  B.animals.fintech = {
    id: 'fintech',
    frame: { r: 1.75, cy: 0, floor: -0.62, shadow: 3.6, yaw: 0.25, pitch: 0.7 },
    input: { min: 0, max: 2, def: 0.8, d: 1, unit: 'BL/s', step: 0.01, period: 16, label: { en: 'Swimming speed', fr: 'Vitesse de nage' }, fmt: (x, n) => `${n(x, 1)} BL/s` },
    parts: [
      { id: 'body', en: 'Body wave', fr: 'Onde du corps' }, { id: 'fins', en: 'Fins', fr: 'Nageoires' }, { id: 'spine', en: 'Spine & bladder', fr: 'Colonne et vessie' },
    ],
    ro: [
      { en: 'Speed (a 70 cm koi)', fr: 'Vitesse (koï de 70 cm)', unit: 'km/h', d: 1 }, { en: 'Tail beats', fr: 'Battements de queue', unit: 'Hz', d: 1 }, { en: 'Propulsive efficiency', fr: 'Rendement de propulsion', unit: '%', d: 0 },
    ],
    plot: 2,
    model(v) {
      const f = KOI.f(v);
      return [v * KOI.len * 3.6, f, 50 * (1 + v / f)];
    },
    note: {
      en: 'Speed is in body lengths a second (BL/s). The wave runs head to tail at one body length per cycle; efficiency is Lighthill’s slender-body estimate, (1 + U/c) / 2. Rounded, stylised.',
      fr: 'La vitesse est en longueurs de corps par seconde (BL/s). L’onde court de la tête à la queue, une longueur par cycle ; le rendement est l’estimation de Lighthill pour un corps élancé, (1 + U/c) / 2. Arrondi, stylisé.',
    },
    build(K) {
      const T = K.T; const P = K.PAL; const rig = K.rig();
      const bodyP = rig.part('body', [0, 0, 0]); const finsP = rig.part('fins', [0, 0.85, 0]); const spineP = rig.part('spine', [0, -0.7, 0]);
      const N = 40; const L = 2.4; const ds = L / N;
      const body = K.tube(N, 18); const spine = K.tube(N, 6); const bladder = K.tube(12, 12);
      K.glass(bodyP, body.geo, P.peach, { op: 0.84 });
      K.solid(spineP, spine.geo, P.cream); K.solid(spineP, bladder.geo, P.mint);
      const radius = (s) => Math.max(0.014, 0.3 * Math.pow(Math.sin(Math.PI * Math.pow(s, 0.62)), 0.9) * (1 - 0.32 * s));

      /* head: eyes and a heart, all placed on the moving axis */
      const eyes = new T.Group(); bodyP.group.add(eyes);
      [1, -1].forEach((s) => {
        const e = K.glass(bodyP, K.ball(0.05, 0.05, 0.05, 12), P.ink, { op: 0.96, detached: true }); e.position.set(0.0, 0.08, s * 0.125); eyes.add(e);
      });
      const heart = new T.Group(); spineP.group.add(heart);
      const hm = K.solid(spineP, K.ball(0.09, 0.08, 0.08, 14), P.coral, { detached: true }); hm.position.set(0.05, -0.12, 0); heart.add(hm);

      /* fins: tail (re-shaped every frame), dorsal, two pectorals */
      const tailGeo = K.leaf(10, 6, () => {});
      const tailFin = new T.Group(); finsP.group.add(tailFin);
      tailFin.add(K.thin(finsP, tailGeo, P.rose, { op: 0.62, detached: true }));
      const dorsal = new T.Group(); finsP.group.add(dorsal);
      dorsal.add(K.thin(finsP, K.leaf(8, 5, (u, v, o) => { const vv = (v + 1) / 2; const h = 0.3 * Math.sin(Math.PI * Math.pow(u, 0.8)); o.x = u * 0.8 - vv * 0.2; o.y = 0.26 + vv * h; o.z = 0; }), P.lav, { op: 0.6, detached: true }));
      const pec = [1, -1].map((s) => {
        const place = new T.Group(); finsP.group.add(place);
        const flap = new T.Group(); place.add(flap);
        const f = K.thin(finsP, K.leaf(7, 5, (u, vv0, o) => { const v = (vv0 + 1) / 2; o.x = u * 0.24 * (1 - 0.6 * v) + v * 0.34; o.y = -0.1 - 0.06 * v; o.z = 0.2 + v * 0.38; }), P.mint, { op: 0.62, detached: true });
        if (s < 0) f.scale.z = -1; flap.add(f);
        return { place, flap, s };
      });

      const P3 = Array.from({ length: N + 1 }, () => new T.Vector3()); const R = new Array(N + 1);
      const PB = Array.from({ length: 13 }, () => new T.Vector3()); const RB = new Array(13);
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
          P3[i].set(x, 0, z); zPrev = z; R[i] = radius(s);
        }
        const shift = -P3[N].x / 2;
        for (let i = 0; i <= N; i++) P3[i].x += shift;
        body.set(P3, R, hint);
        spine.set(P3, R.map((r) => Math.max(0.012, r * 0.14)), hint);
        for (let i = 0; i <= 12; i++) { const k = Math.round(10 + i * (12 / 12) * 1.1); PB[i].copy(P3[Math.min(N, k)]); RB[i] = 0.13 * Math.sin(Math.PI * (i / 12)) + 0.01; }
        bladder.set(PB, RB, hint);
        body.place(eyes, 2); body.place(heart, 7);
        body.place(tailFin, N);
        tailGeo.userData.set((u, vv, o) => {
          const h = 0.05 + 0.46 * Math.pow(u, 1.1) * (1 - 0.22 * u);
          o.x = u * 0.8 * (1 + 0.2 * Math.abs(vv) * u); o.y = vv * h;
          o.z = 0.1 * Math.sin(TAU * (st.ph * 1.0 - 0.9 * u)) * u * u * (0.5 + 0.5 * Math.abs(vv));
        });
        body.place(dorsal, 14);
        pec.forEach((p) => { body.place(p.place, 8); p.flap.rotation.x = p.s * (0.2 + 0.25 * Math.sin(TAU * st.ph * 0.5)); });
      };
      return {
        root: rig.root, parts: rig.parts, pose,
        anchors: [
          { part: 'fins', obj: tailFin, off: [0.62, 0.12, 0], dx: -76, dy: -48, en: 'Tail fin', fr: 'Nageoire caudale', live: (v) => `${KOI.f(v).toFixed(1)} Hz` },
          { part: 'spine', obj: heart, off: [0.05, -0.12, 0], dx: 70, dy: 50, en: 'Spine & swim bladder', fr: 'Colonne et vessie natatoire' },
          { part: 'body', obj: eyes, off: [0, 0.1, 0.12], dx: 66, dy: -52, en: 'Body wave', fr: 'Onde du corps' },
        ],
      };
    },
  };

  /* ───────── 4. The tortoise · real estate · the same design from the first year to the hundredth ───────── */
  const TORT = { len: (y) => 6 + 100 * (1 - Math.exp(-y / 25)), grow: (y) => 4 * Math.exp(-y / 25), kg: (cm) => 170 * Math.pow(cm / 100, 3) };
  B.animals.proptech = {
    id: 'proptech',
    frame: { r: 2.0, cy: 0.5, floor: 0, shadow: 3.4, yaw: 0.6, pitch: 0.36 },
    input: { min: 0, max: 120, def: 40, d: 0, unit: 'years', step: 1, period: 22, label: { en: 'Age of the tortoise', fr: 'Âge de la tortue' }, fmt: (x, n) => `${n(x, 0)} ${x < 1.5 ? 'year' : 'years'}` },
    parts: [
      { id: 'shell', en: 'Shell, 13 plates', fr: 'Carapace, 13 plaques' }, { id: 'body', en: 'Head & legs', fr: 'Tête et pattes' }, { id: 'bones', en: 'Ribs fused to the shell', fr: 'Côtes soudées à la carapace' },
    ],
    ro: [
      { en: 'Shell length', fr: 'Longueur de carapace', unit: 'cm', d: 0 }, { en: 'Weight', fr: 'Poids', unit: 'kg', d: 0 }, { en: 'Growth this year', fr: 'Croissance cette année', unit: 'cm', d: 1 },
    ],
    plot: 0,
    model(y) { const l = TORT.len(y); return [l, TORT.kg(l), TORT.grow(y)]; },
    note: {
      en: 'A stylised growth curve for a Galápagos tortoise (about 6 cm at hatching, over a metre as an adult), rounded. The shell keeps the same design: 5 central plates and 4 side plates a side. Drawn from 22% to 100% of life size so the hatchling stays visible.',
      fr: 'Une courbe de croissance stylisée pour une tortue des Galápagos (environ 6 cm à l’éclosion, plus d’un mètre adulte), arrondie. La carapace garde le même dessin : 5 plaques centrales et 4 plaques latérales de chaque côté. Dessinée de 22 % à 100 % de la taille réelle pour que le nouveau-né reste visible.',
    },
    build(K) {
      const T = K.T; const P = K.PAL; const rig = K.rig();
      const shellP = rig.part('shell', [0, 0.9, 0]); const bodyP = rig.part('body', [0, -0.5, 0]); const bonesP = rig.part('bones', [0, 0.35, 0.9]);
      const mv = [shellP, bodyP, bonesP].map((p) => { const g = new T.Group(); p.group.add(g); return g; });
      const a = 1.25; const b = 0.85; const c = 0.95;
      const onDome = (x, z) => b * Math.sqrt(Math.max(0, 1 - (x / a) * (x / a) - (z / c) * (z / c))) * 1.006;

      const dome = new T.SphereGeometry(1, 56, 28, 0, TAU, 0, Math.PI / 2); dome.scale(a, b, c);
      mv[0].add(K.glass(shellP, dome, P.mint, { op: 0.86, detached: true, side: T.DoubleSide }));
      const plast = K.glass(shellP, K.ball(1.14, 0.1, 0.88, 30), P.lav, { op: 0.8, detached: true }); mv[0].add(plast);

      /* the plates: 5 along the spine, 4 a side, and the ring of marginals */
      const seg = [];
      const poly = (pts) => { for (let i = 0; i < pts.length - 1; i++) seg.push(pts[i], pts[i + 1]); };
      const strip = 0.27 * c; const xs = [-0.6, -0.2, 0.2, 0.6].map((k) => k * a);
      [1, -1].forEach((s) => { const line = []; for (let i = 0; i <= 16; i++) { const x = (-0.86 + (1.72 * i) / 16) * a; line.push(new T.Vector3(x, onDome(x, s * strip), s * strip)); } poly(line); });
      xs.forEach((x) => {
        const cross = []; for (let i = 0; i <= 8; i++) { const z = -strip + (2 * strip * i) / 8; cross.push(new T.Vector3(x, onDome(x, z), z)); } poly(cross);
        [1, -1].forEach((s) => {
          const out = []; for (let i = 0; i <= 10; i++) {
            const k = i / 10; let xx = x * (1 + 0.28 * k); let zz = s * (strip + (0.9 * c - strip) * k);
            const r = Math.hypot(xx / a, zz / c); if (r > 0.93) { xx *= 0.93 / r; zz *= 0.93 / r; }
            out.push(new T.Vector3(xx, onDome(xx, zz), zz));
          } poly(out);
        });
      });
      const ring = []; for (let i = 0; i <= 64; i++) { const ang = (i / 64) * TAU; const xx = Math.cos(ang) * a * 0.93; const zz = Math.sin(ang) * c * 0.93; ring.push(new T.Vector3(xx, onDome(xx, zz), zz)); } poly(ring);
      mv[0].add(K.lines(shellP, new T.BufferGeometry().setFromPoints(seg), '#4a3f8f', 0.5, { kind: 'thin', detached: true }));

      /* the adult outline on the ground: how far the shell still has to grow */
      const outline = K.lines(shellP, new T.BufferGeometry().setFromPoints(Array.from({ length: 97 }, (_, i) => { const ang = (i / 96) * TAU; return new T.Vector3(Math.cos(ang) * 1.3, 0.004, Math.sin(ang) * 1.0); }).flatMap((p, i, arr) => (i < arr.length - 1 ? [p, arr[i + 1]] : []))), P.ink, 0.28, { kind: 'thin', detached: true });
      shellP.group.add(outline);

      /* head, neck, four legs, tail */
      const head = new T.Group(); head.position.set(1.42, 0.38, 0); mv[1].add(head);
      head.add(K.glass(bodyP, K.ball(0.3, 0.2, 0.2, 24), P.peach, { op: 0.88, detached: true }));
      [1, -1].forEach((s) => { const e = K.glass(bodyP, K.ball(0.045, 0.045, 0.045, 10), P.ink, { op: 0.98, detached: true }); e.position.set(0.14, 0.07, s * 0.15); head.add(e); });
      const neck = K.glass(bodyP, K.ball(0.5, 0.21, 0.21, 24), P.peach, { op: 0.86, detached: true }); neck.position.set(1.06, 0.3, 0); mv[1].add(neck);
      const legs = [];
      [[0.7, 0.62, 0], [0.7, -0.62, 0.5], [-0.72, 0.6, 0.5], [-0.72, -0.6, 0]].forEach(([x, z, ph]) => {
        const hip = new T.Group(); hip.position.set(x, 0.22, z); mv[1].add(hip);
        const leg = K.glass(bodyP, new T.CapsuleGeometry(0.19, 0.28, 6, 14).translate(0, -0.26, 0), P.peach, { op: 0.88, detached: true }); hip.add(leg);
        legs.push({ hip, ph });
      });
      const tailG = K.glass(bodyP, new T.ConeGeometry(0.1, 0.34, 10).rotateZ(Math.PI / 2), P.peach, { op: 0.88, detached: true }); tailG.position.set(-1.28, 0.2, 0); mv[1].add(tailG);

      /* the skeleton seen by the x-ray: a spine and eight pairs of ribs fused into the dome */
      mv[2].add(K.solid(bonesP, new T.CylinderGeometry(0.045, 0.045, 2.3, 10).rotateZ(Math.PI / 2).translate(0, 0.62, 0), P.cream, { detached: true }));
      for (let k = 0; k < 8; k++) {
        const x = (-0.72 + k * 0.205) * a;
        [1, -1].forEach((s) => {
          const pts = []; for (let i = 0; i <= 10; i++) { const z = s * c * 0.86 * (i / 10); const rr = 1 - (x / a) * (x / a) - (z / (c * 0.86)) * (z / (c * 0.86)); pts.push(new T.Vector3(x, 0.05 + 0.58 * Math.sqrt(Math.max(0, rr)) * 1.0, z)); }
          mv[2].add(K.solid(bonesP, new T.TubeGeometry(new T.CatmullRomCurve3(pts), 14, 0.03, 6), P.cream, { detached: true }));
        });
      }

      const pose = (y, t) => {
        const sc = TORT.len(y) / 106; const vs = 0.22 + 0.78 * sc;
        mv.forEach((m) => { m.scale.setScalar(vs); m.position.y = 0.37 * vs; });
        const kid = 1 + 0.55 * (1 - sc); /* the young have a bigger head and longer legs for their shell */
        head.scale.setScalar(kid); head.position.x = 1.42 + 0.05 * Math.sin(TAU * 0.3 * t); head.rotation.z = 0.06 * Math.sin(TAU * 0.3 * t + 1);
        legs.forEach((l) => { l.hip.rotation.z = 0.2 * Math.sin(TAU * 0.28 * t + l.ph * TAU); l.hip.scale.setScalar(1 + 0.25 * (1 - sc)); });
        mv[0].rotation.z = 0.012 * Math.sin(TAU * 0.28 * t);
        outline.visible = true;
      };
      return {
        root: rig.root, parts: rig.parts, pose,
        anchors: [
          { part: 'shell', obj: mv[0], off: [-0.1, 0.8, 0.2], dx: 78, dy: -60, en: 'Shell, 13 plates', fr: 'Carapace, 13 plaques', live: (y) => `${TORT.len(y).toFixed(0)} cm` },
          { part: 'bones', obj: mv[2], off: [0.4, 0.5, 0.5], dx: -88, dy: -44, en: 'Fused ribs', fr: 'Côtes soudées' },
          { part: 'body', obj: head, off: [0.2, 0.1, 0.2], dx: 72, dy: 54, en: 'Head & legs', fr: 'Tête et pattes' },
        ],
      };
    },
  };
})();
