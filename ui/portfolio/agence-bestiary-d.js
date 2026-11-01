/* v2 studio, live bestiary, animals 8 and 9: the jaguar (mobility and travel), the elephant (large groups).
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

  /* ───────── 8. The jaguar · mobility and travel · it moves with intent ───────── */
  B.animals.mobility = {
    id: 'mobility',
    frame: { r: 2.15, cx: 0.3, cy: 1.0, floor: 0, shadow: 4.6, yaw: 0.95, pitch: 0.12 },
    x: 1,
    build(K) {
      const T = K.T; const P = K.PAL; const V = K.V; const rig = K.rig();
      const legsP = rig.part('legs', [0, -0.75, 0]); const bodyP = rig.part('body', [0, 0, 0]);
      const mv = [legsP, bodyP].map((p) => { const g = new T.Group(); p.group.add(g); return g; });
      const put = (g, m, x, y, z) => { g.position.set(x, y, z); mv[m].add(g); return g; };
      const CY = 1.1; const HIP = 0.93; const W = '#ffffff';
      const SKIN = { op: 1, rough: 0.6, clear: 0.08, iri: 0.04, detached: true };
      const SK = { ...SKIN, map: 'jagSkin' };
      const DARKC = '#2a1c14'; const PALE = '#f3e6cc';

      /* body: a long, deep, muscular cat. Heavy shoulders and chest, a tucked waist, strong haunches, a back that dips between them. */
      const bSpec = { len: 2.6, n: 64, radial: 36, ru: 1, rv: 1, a: () => 1.0, y: (s) => CY + 0.05 * g2(s, 0.76, 0.12) + 0.04 * (1 - smooth(0, 0.35, s)) - 0.03 * g2(s, 0.46, 0.14), r: (s) => 0.006 + (0.43 + 0.06 * g2(s, 0.8, 0.12) + 0.04 * g2(s, 0.64, 0.1) - 0.055 * g2(s, 0.4, 0.11) + 0.07 * g2(s, 0.15, 0.12)) * env(s) };
      put(K.glass(bodyP, K.loft(bSpec), W, { ...SKIN, map: 'jagBody' }), 1, 0, 0, 0);

      /* neck and head: a thick, short neck; a broad skull, a short muzzle, a strong jaw, round ears, gold eyes, whiskers */
      const nCurve = new T.CatmullRomCurve3([V(0.85, CY + 0.07, 0), V(1.18, CY + 0.15, 0), V(1.5, CY + 0.18, 0)]);
      const nPts = nCurve.getPoints(10); const nR = nPts.map((_, i) => 0.4 - 0.1 * Math.pow(i / 10, 1.1));
      const neck = K.tube(10, 26, 2, 0.8); neck.set(nPts, nR, V(0, 1, 0), nPts.map(() => 1.02));
      put(K.glass(bodyP, neck.geo, W, { ...SK }), 1, 0, 0, 0);
      const head = new T.Group(); put(head, 1, 1.62, CY + 0.17, 0); head.rotation.z = -0.16;
      const hb = (rx, ry, rz, x, y, z, hex, extra) => { const m = K.glass(bodyP, K.uvScale(K.ball(rx, ry, rz, 26), 2, 1.2), hex, extra || { ...SK }); m.position.set(x, y, z); head.add(m); return m; };
      hb(0.34, 0.28, 0.31, 0, 0, 0, W);
      hb(0.22, 0.15, 0.17, 0.36, -0.05, 0, W);
      hb(0.2, 0.07, 0.12, 0.34, -0.17, 0, PALE, { ...SKIN });
      [1, -1].forEach((s) => {
        hb(0.15, 0.17, 0.1, -0.02, -0.1, s * 0.22, W); /* cheek */
        hb(0.12, 0.06, 0.075, 0.4, -0.1, s * 0.075, PALE, { ...SKIN }); /* whisker pad */
        hb(0.1, 0.06, 0.07, 0.2, 0.13, s * 0.16, W); /* brow */
        const ry = s > 0 ? 1.0 : PI - 1.0;
        const e = K.eye(bodyP, { r: 0.048, iris: '#d3a62c' }); e.position.set(0.2, 0.07, s * 0.228); e.rotation.y = ry; head.add(e);
        const lid = K.glass(bodyP, new T.TorusGeometry(0.054, 0.0085, 8, 22), DARKC, { op: 1, detached: true }); lid.position.set(0.2, 0.07, s * 0.226); lid.rotation.y = ry; head.add(lid);
        const ear = K.glass(bodyP, K.ball(0.07, 0.095, 0.034, 16), DARKC, { op: 1, detached: true }); ear.position.set(-0.08, 0.255, s * 0.17); ear.rotation.set(s * 0.45, 0, 0.1); head.add(ear);
        const spot = K.glass(bodyP, K.ball(0.034, 0.05, 0.012, 12), PALE, { op: 1, detached: true }); spot.position.set(-0.075, 0.262, s * 0.192); spot.rotation.set(s * 0.45, 0, 0.1); head.add(spot);
        for (let d = 0; d < 4; d++) { const dot = K.glass(bodyP, K.ball(0.008, 0.008, 0.008, 6), DARKC, { op: 1, detached: true }); dot.position.set(0.37 + (d % 2) * 0.045, -0.085 + Math.floor(d / 2) * 0.04, s * (0.12 + (d % 2) * 0.03)); head.add(dot); }
      });
      const nose = K.glass(bodyP, K.ball(0.042, 0.032, 0.06, 14), '#c9786f', { op: 1, detached: true }); nose.position.set(0.56, -0.01, 0); head.add(nose);
      const mouth = K.glass(bodyP, new T.TorusGeometry(0.1, 0.006, 6, 18, PI).rotateX(PI / 2).rotateY(PI / 2), DARKC, { op: 1, detached: true }); mouth.position.set(0.5, -0.1, 0); mouth.scale.set(1, 1, 1); head.add(mouth);
      const wMat = []; const q = new T.Quaternion(); const eul = new T.Euler();
      [1, -1].forEach((s) => { for (let k = 0; k < 6; k++) { eul.set(0, s * (0.55 + k * 0.1), -0.1 - 0.05 * (k % 3)); q.setFromEuler(eul); wMat.push(new T.Matrix4().compose(V(0.44, -0.08 + (k % 3) * 0.02, s * 0.1), q, V(1, 1, 1))); } });
      head.add(K.thin(bodyP, new T.CylinderGeometry(0.002, 0.0008, 0.2, 4).rotateZ(-PI / 2).translate(0.1, 0, 0), '#f8f4ea', { op: 0.95, instances: wMat }));

      /* tail: a thick, ringed rope that follows the walk and lifts a little at the end */
      const tail = K.tube(14, 14, 1, 3); const tailP = Array.from({ length: 15 }, () => new T.Vector3()); const tailR = new Array(15);
      put(K.glass(bodyP, tail.geo, W, { ...SK }), 1, 0, 0, 0);

      /* legs: heavy forearms and thighs, an elbow or hock, a thick wrist, a broad paw with toes; they swing from inside the body */
      const upSpec = (top) => ({ x0: 0, len: 0.43, n: 16, radial: 22, ru: 1, rv: 0.4, a: () => 1.0, r: (s) => top * 1.08 - (top * 1.08 - 0.105) * smooth(0, 0.95, s) + 0.035 * g2(s, 0.2, 0.16) });
      const loSpec = { x0: 0, len: 0.42, n: 16, radial: 20, ru: 1, rv: 0.35, a: () => 1.0, r: (s) => 0.098 - 0.014 * smooth(0, 0.6, s) + 0.012 * smooth(0.75, 1, s) };
      const legs = [[-0.82, 0.3, false], [0.82, 0.3, true], [-0.82, -0.3, false], [0.82, -0.3, true]].map(([x, z, fore]) => {
        const hip = new T.Group(); put(hip, 0, x, HIP, z);
        const ug = new T.Group(); ug.rotation.z = -PI / 2; hip.add(ug); ug.add(K.glass(legsP, K.loft(upSpec(fore ? 0.2 : 0.23)), W, { ...SK }));
        const knee = new T.Group(); knee.position.y = -0.43; hip.add(knee);
        knee.add(K.glass(legsP, K.ball(0.108, 0.108, 0.1, 18), W, { ...SK }));
        const lg = new T.Group(); lg.rotation.z = -PI / 2; knee.add(lg); lg.add(K.glass(legsP, K.loft(loSpec), W, { ...SK }));
        const paw = K.glass(legsP, K.ball(0.17, 0.078, 0.118, 22), W, { ...SK }); paw.position.set(0.07, -0.42, 0); knee.add(paw);
        [-1, 0, 1].forEach((d) => { const toe = K.glass(legsP, K.ball(0.05, 0.05, 0.05, 12), W, { ...SK }); toe.position.set(0.2, -0.41, d * 0.062); knee.add(toe); });
        return { hip, knee, fore };
      });
      const tickM = Array.from({ length: 24 }, () => new T.Matrix4());
      const ticks = K.thin(legsP, new T.PlaneGeometry(0.34, 0.02).rotateX(-PI / 2), P.ink, { op: 0.28, instances: tickM, detached: true }); legsP.group.add(ticks);

      const st = { t: 0, phi: 0, dist: 0 };
      const tmp = new T.Matrix4(); const OFF = [0, 0.25, 0.5, 0.75]; /* a four-beat walk, left hind, left fore, right hind, right fore */
      const pose = (v, t) => {
        const dt = Math.min(0.1, Math.max(0, t - st.t)); st.t = t;
        st.phi = (st.phi + 0.5 * v * dt) % 1000; st.dist += 0.5 * v * dt;
        const duty = 0.66; const A = 0.34;
        legs.forEach((l, i) => {
          const p = (((st.phi + OFF[i]) % 1) + 1) % 1; let al; let lift = 0;
          if (p < duty) al = A * (1 - (2 * p) / duty);
          else { const u = (p - duty) / (1 - duty); al = -A + 2 * A * smooth(0, 1, u); lift = Math.sin(PI * u); }
          l.hip.rotation.z = al; l.knee.rotation.z = -lift * 1.0;
        });
        const bob = 0.012 * Math.cos(TAU * st.phi * 2); const roll = 0.012 * Math.sin(TAU * st.phi * 2 + 0.5);
        mv.forEach((m) => { m.position.y = bob; m.rotation.z = roll; });
        head.rotation.z = -0.16 + 0.025 * Math.sin(TAU * st.phi * 2 + 1.2); head.rotation.y = 0.12 * Math.sin(TAU * 0.12 * t);
        let x = -1.28; let y = CY + 0.06;
        for (let j = 0; j <= 14; j++) {
          const s = j / 14; tailP[j].set(x, y, 0.16 * Math.sin(TAU * (st.phi * 0.5 - s * 0.8)) * s); tailR[j] = 0.1 - 0.035 * s + 0.01;
          const a = PI + 0.3 + 0.35 * Math.sin(TAU * (st.phi * 0.5 - s * 0.7)) * s - 1.1 * Math.pow(s, 2.2);
          x += (1.5 / 14) * Math.cos(a); y += (1.5 / 14) * Math.sin(a);
        }
        tail.set(tailP, tailR, new T.Vector3(0, 0, 1));
        for (let i = 0; i < 24; i++) { const row = i < 12 ? 1.25 : -1.25; const k = i % 12; const px = ((((k * 0.62 - st.dist) % 7.44) + 7.44) % 7.44) - 3.72; tmp.makeTranslation(px, 0.004, row); ticks.setMatrixAt(i, tmp); }
        ticks.instanceMatrix.needsUpdate = true;
      };
      return {
        root: rig.root, parts: rig.parts, pose,
      };
    },
  };

  /* The jaguar as a modelled file (models/jaguar.glb, 2 MB: 32k triangles-vertices, three 1024 px maps). The mesh is still, so the whole animal
     breathes and sways; the coded jaguar above stands in if the file does not load. It is laid along +x like the other animals. */
  B.animals.mobility.glb = '/portfolio/models/jaguar.glb';
  B.animals.mobility.frameGlb = { r: 1.9, cx: 0, cy: 0.75, floor: 0, shadow: 3.4, yaw: 0.8, pitch: 0.12 };
  B.animals.mobility.buildGlb = (K, gltf) => {
    const T = K.T; const root = new T.Group(); const turn = new T.Group(); const body = gltf.scene;
    const box = new T.Box3().setFromObject(body); const size = box.getSize(new T.Vector3()); const mid = box.getCenter(new T.Vector3());
    const sc = 2.5 / Math.max(size.x, size.z);
    body.position.set(-mid.x, -box.min.y, -mid.z); const fit = new T.Group(); fit.add(body); fit.scale.setScalar(sc);
    if (size.z >= size.x) fit.rotation.y = Math.PI / 2;
    body.traverse((o) => { if (o.isMesh) { o.material.side = T.FrontSide; o.material.envMapIntensity = 0.7; o.material.metalness = Math.min(o.material.metalness, 0.15); o.frustumCulled = false; } });
    turn.add(fit); root.add(turn);
    const pose = (x, t) => {
      turn.position.y = 0.012 * Math.sin(t * 1.9);
      turn.rotation.z = 0.012 * Math.sin(t * 0.95 + 0.6);
      turn.rotation.y = 0.05 * Math.sin(t * 0.31);
      turn.scale.set(1, 1 + 0.006 * Math.sin(t * 1.9), 1);
    };
    return { root, parts: {}, pose };
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
    frame: { r: 3.3, cx: 0.95, cy: 2.2, floor: 0, shadow: 6.6, yaw: 0.42, pitch: 0.16 },
    x: 0.5,
    build(K) {
      const T = K.T; const P = K.PAL; const V = K.V; const rig = K.rig(); const UP = V(0, 1, 0);
      const trunkP = rig.part('trunk', [0.9, 0.5, 0]); const bodyP = rig.part('body', [0, -0.2, 0]); const earsP = rig.part('ears', [0, 0.6, 1.0]);
      const at = (g, parent, x, y, z) => { g.position.set(x, y, z); parent.add(g); return g; };
      const SKIN = '#b8a8ec'; /* a grey hide, in lavender so it holds against the pale page */

      /* body and head: lofted, folds of thick skin, a ridge of stiff hair along the back, temporal glands, eyes with lashes */
      const bG = at(new T.Group(), bodyP.group, -0.1, 0, 0);
      const bSpec = { len: 3.3, n: 60, ru: 3, rv: 4, a: () => 0.93, y: (s) => 2.35 + 0.09 * g2(s, 0.78, 0.15), r: (s) => 0.006 + (1.02 + 0.06 * g2(s, 0.78, 0.15) - 0.05 * g2(s, 0.4, 0.2)) * env(s) };
      const barrel = K.glass(bodyP, K.loft(bSpec), SKIN, { op: 0.9, backOp: 0.5, bump: 'wrinkle', bumpScale: 1.8, detached: true }); bG.add(barrel);
      bG.add(K.fuzz(bodyP, { surf: K.surf(bSpec), count: 300, s0: 0.1, s1: 0.9, th0: -0.5, th1: 0.5, hex: '#8576c4', len: 0.055, r: 0.007, lean: 0.9 }));
      const hSpec = { x0: 0, len: 1.55, n: 44, ru: 2, rv: 3, a: () => 0.82, y: (s) => 2.72 - 0.32 * smooth(0.35, 1, s), r: (s) => 0.006 + (0.9 - 0.5 * smooth(0.5, 1, s)) * Math.pow(Math.sin(PI * Math.pow(s, 0.5)), 0.5) * (1 + 0.1 * g2(s, 0.3, 0.15) + 0.14 * g2(s, 0.42, 0.14)) };
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
      /* each leg starts inside the flank with a rounded thigh (no flat top showing), is thick at the top, plain below, and flares into the foot */
      const legR = (s) => 0.37 + 0.12 * (1 - smooth(0, 0.5, s)) + 0.03 * g2(s, 0.55, 0.08) - 0.025 * smooth(0.68, 0.84, s) * (1 - smooth(0.88, 0.98, s)) + 0.06 * smooth(0.88, 0.98, s);
      const legSpec = { x0: 0, len: 2.0, n: 30, radial: 22, ru: 2, rv: 5, a: () => 1.0, r: (s) => legR(s) * Math.sqrt(Math.max(0, 1 - Math.pow(1 - Math.min(1, s / 0.16), 2))) * (1 - smooth(0.985, 1, s)) + 0.006 };
      const nailG = new T.ConeGeometry(0.045, 0.12, 6).rotateZ(-PI / 2);
      [[0.5, 0.5], [0.5, -0.5], [-1.0, 0.55], [-1.0, -0.55]].forEach(([x, z]) => {
        const lg = at(new T.Group(), bodyP.group, x, 2.05, z); lg.rotation.z = -PI / 2;
        lg.add(K.glass(bodyP, K.loft(legSpec), SKIN, { op: 0.86, bump: 'wrinkle', bumpScale: 1.8, detached: true }));
        at(K.glass(bodyP, K.ball(0.44, 0.1, 0.42, 20), SKIN, { op: 0.88, bump: 'wrinkle', detached: true }), bodyP.group, x + 0.04, 0.1, z);
        bodyP.group.add(K.thin(bodyP, nailG, '#fff3dd', { op: 0.96, instances: [-0.24, -0.08, 0.08, 0.24].map((dz) => new T.Matrix4().compose(V(x + 0.43, 0.12, z + dz), new T.Quaternion().setFromEuler(new T.Euler(0, dz * 1.4, 0)), V(1, 1, 1))) }));
      });
      const tailG = at(new T.Group(), bodyP.group, -1.82, 2.4, 0);
      const tt = K.tube(10, 10); const tpts = new T.CatmullRomCurve3([V(0, 0, 0), V(-0.06, -0.35, 0), V(-0.1, -0.75, 0), V(-0.12, -1.1, 0), V(-0.12, -1.4, 0)]).getPoints(10);
      tt.set(tpts, tpts.map((_, i) => 0.06 - 0.03 * (i / 10)), V(0, 0, 1)); tailG.add(K.glass(bodyP, tt.geo, SKIN, { op: 0.88, bump: 'wrinkle', detached: true }));
      tailG.add(K.thin(bodyP, K.hair(0.22, 0.014, { curl: 0.25, wave: 0.1 }).rotateZ(-PI / 2), P.ink, { op: 1, instances: Array.from({ length: 80 }, (_, i) => new T.Matrix4().compose(V(-0.12 + Math.cos(i) * 0.025, -1.42 - (i % 3) * 0.03, Math.sin(i * 1.7) * 0.03), new T.Quaternion().setFromEuler(new T.Euler(Math.sin(i * 2.1) * 0.25, 0, Math.cos(i * 1.3) * 0.25)), V(1, 1 + (i % 4) * 0.2, 1))) }));

      /* the trunk: a tube re-bent every frame with rings of skin, a fingered tip with nostrils, and muscle fibres winding round it */
      const trunk = K.tube(EL.n, 22, 3, 14); K.glass(trunkP, trunk.geo, SKIN, { op: 1, bump: 'wrinkle', bumpScale: 2.2 });
      const tipG = new T.Group(); trunkP.group.add(tipG);
      const fingerU = K.glass(trunkP, new T.ConeGeometry(0.04, 0.13, 8).rotateZ(-PI / 2 - 0.25), SKIN, { op: 1, detached: true }); fingerU.position.set(0.04, 0.03, 0); tipG.add(fingerU);
      const fingerL = K.glass(trunkP, new T.ConeGeometry(0.03, 0.09, 8).rotateZ(-PI / 2 + 0.3), SKIN, { op: 1, detached: true }); fingerL.position.set(0.03, -0.035, 0); tipG.add(fingerL);
      [1, -1].forEach((s) => { const n = K.glass(trunkP, K.ball(0.012, 0.016, 0.012, 6), P.ink, { op: 0.96, detached: true }); n.position.set(0.06, -0.0, s * 0.028); tipG.add(n); });
      const NF = 8; const fpos = new Float32Array(NF * EL.n * 2 * 3);
      const fgeo = new T.BufferGeometry(); fgeo.setAttribute('position', new T.BufferAttribute(fpos, 3));
      K.lines(trunkP, fgeo, P.cream, 0.85);
      const twig = K.thin(trunkP, new T.CylinderGeometry(0.03, 0.02, 1.2, 8).rotateZ(1.0), P.apricot, { op: 0.88, bump: 'wrinkle', detached: true }); at(twig, trunkP.group, 3.7, 3.55, 0);
      const leafG = K.leaf(8, 5, (u, v, o) => { const w = 0.13 * Math.sin(PI * Math.pow(u, 0.7)); o.x = u * 0.44; o.y = v * w; o.z = 0.04 * u * u; });
      trunkP.group.add(K.thin(trunkP, leafG, P.mint, { op: 0.92, bump: 'veins', bumpScale: 1.2, instances: K.fan(Array.from({ length: 9 }, (_, i) => ({ p: V(3.15 + 0.14 * i, 3.1 + 0.1 * ((i * 7) % 4), (i % 2 ? 1 : -1) * 0.05), dir: V(Math.cos(-0.9 + i * 0.35), Math.sin(-0.9 + i * 0.35) + 0.2, (i - 4) * 0.12), len: 1, nHint: V(0, 0, 1) }))) }));

      /* ears (they flap) with their veins, and tusks that taper from a thick root to a point */
      const earG = K.leaf(14, 14, (u, v, o) => { const h = 0.8 * Math.sqrt(Math.max(0, 1 - (2 * u - 1) * (2 * u - 1))) + 0.06; o.x = -u * 1.3; o.y = v * h - 0.15 * u + 0.025 * Math.sin(v * 22) * u; o.z = 0.1 * Math.sin(PI * u) + 0.03 * Math.sin(v * 9) * u; });
      const ears = [1, -1].map((s) => {
        const hinge = new T.Group(); at(hinge, earsP.group, 1.12, 2.95, s * 0.72);
        hinge.add(K.thin(earsP, earG, '#a99be3', { op: 0.94, bump: 'veins', bumpScale: 2.2, detached: true }));
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
          Rn[i] = (0.1 + 0.19 * Math.pow(1 - s, 0.85)) * (1 + 0.06 * Math.sin(i * 2.4) * (1 - 0.5 * s));
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
      };
    },
  };
})();
