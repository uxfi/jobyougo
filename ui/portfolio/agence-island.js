/* v2 studio (/agence): two enchanted islands floating over the hero clip.
   A small Three.js scene (three@0.160 from the CDN, same build as /portfolio) renders the Meshy islands
   (images/3d/floating-island/*.glb, meshopt-compressed, 30% of the triangles, their 2048 maps as JPEGs)
   on a transparent canvas above the video. agence-story.js drives it: window.agenceIsland.set(p) keeps them
   visible while the camera glides over the water and fades them out as the splash begins. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const host = document.getElementById('hero-island');
if (host) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const small = window.matchMedia('(max-width: 720px)').matches;
  const ASSET = '/images/3d/floating-island/';
  const V = '?v=6';
  /* Fade: visible until the splash (3.2 s into the 20 s clip, so 16%), gone about half a second later.
     p is a fraction of the clip: change these with the clip's length. */
  const FADE_FROM = 0.159;
  const FADE_LEN = 0.028;
  const ISLANDS = [
    // All three sit in the background, small and hazy; skyfall is the nearest and the only one that answers the pointer, gently.
    { file: 'skyfall', size: 2.3, desk: { x: 4.15, y: 1.3, z: -2.4, s: 0.8 }, mob: { x: 0.95, y: 1.9, z: -2.2, s: 0.5 }, spin: 0.045, tilt: -0.05, bob: 0.05, phase: 0, depth: 0.5, shade: 0.62, follow: true },
    // Two sanctuaries far behind, small and hazy, drifting on their own clocks.
    // `shade` darkens them with distance, on top of the night haze.
    { file: 'sanctuary', size: 2.3, desk: { x: 0.7, y: -0.3, z: -3.2, s: 0.52 }, mob: { x: 0.05, y: 0.6, z: -3.2, s: 0.3 }, spin: 0.035, tilt: -0.06, bob: 0.04, phase: 2.1, depth: 0.3, shade: 0.5 },
    { file: 'forest', size: 2.3, desk: { x: -3.1, y: 1.6, z: -3, s: 0.5 }, mob: { x: -0.8, y: 2.0, z: -3.8, s: 0.28 }, spin: -0.03, tilt: -0.1, bob: 0.035, phase: 4.2, depth: 0.2, shade: 0.42 },
  ];
  const state = { visible: 1, target: 1, p: 0, running: false, ready: 0, seen: true, t: 0, px: 0, py: 0, tx: 0, ty: 0 };

  // Without WebGL, or if a model cannot be fetched, a still of the same islands takes their place.
  function still() {
    if (host.querySelector('.hero-island-still')) return;
    host.textContent = '';
    const img = document.createElement('img');
    img.className = 'hero-island-still';
    img.src = ASSET + 'island-still.png' + V;
    img.alt = '';
    img.decoding = 'async';
    host.appendChild(img);
    window.agenceIsland = {
      set(p) { host.style.opacity = String(1 - Math.min(1, Math.max(0, (p - FADE_FROM) / FADE_LEN))); },
      refresh() {},
      snapshot() { return null; },
    };
  }
  let renderer = null;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
  } catch (e) { renderer = null; }
  if (!renderer) still();
  if (renderer) {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.5 : 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setClearColor(0x000000, 0);
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    // A faint night haze: the far islands sink into the sky, the near one stays crisp.
    scene.fog = new THREE.Fog(0x0b1a22, 9, 19);
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    camera.position.set(0, 0, 9);

    // A neutral studio environment gives the PBR materials their reflections and ambient shading;
    // three directional lights match the clip: aurora green from above and behind, a cool sky key, a faint warm fill.
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
    pmrem.dispose();
    const key = new THREE.DirectionalLight(0xe4f6ec, 1.15);
    key.position.set(-3, 5, 2);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x8cf2c4, 1.2);
    rim.position.set(2.5, 3, -4);
    scene.add(rim);
    const fill = new THREE.DirectionalLight(0x3f8fc0, 0.45); // the sea, from below
    fill.position.set(2, -3, 4);
    scene.add(fill);
    // The aurora itself lights the scene: green from the sky, deep navy bounced from the water.
    scene.add(new THREE.HemisphereLight(0x7fe3bd, 0x1b4d6e, 0.7)); // aurora green above, deep sea blue below

    // One soft disc, drawn once, serves every glow, mist wisp and spark.
    const softTex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const g = c.getContext('2d');
      const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      grd.addColorStop(0, 'rgba(255,255,255,.9)');
      grd.addColorStop(0.22, 'rgba(255,255,255,.5)'); grd.addColorStop(0.55, 'rgba(255,255,255,.14)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, 128, 128);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const sprite = (color, opacity) => new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));

    const texLoader = new THREE.TextureLoader();
    const tex = (file, srgb) => {
      const t = texLoader.load(ASSET + file + V);
      t.flipY = false;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      return t;
    };
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);

    ISLANDS.forEach((isl) => {
      // The material reproduces Meshy's export: white base colour, metalness and roughness 1 driven by one shared map.
      const mr = tex(isl.file + '-mr.jpg', false);
      const material = new THREE.MeshStandardMaterial({
        map: tex(isl.file + '-albedo.jpg', true),
        normalMap: tex(isl.file + '-normal.jpg', false),
        normalScale: new THREE.Vector2(1, -1),
        roughnessMap: mr,
        metalnessMap: mr,
        roughness: 1,
        metalness: 1,
        envMapIntensity: 0.45 * (isl.shade || 1),
      });
      // Far islands are lit less: the base colour is pulled towards the night.
      material.color.setScalar(isl.shade || 1);
      const pivot = new THREE.Group();
      isl.pivot = pivot;
      scene.add(pivot);
      // Light around the island so it belongs to the sky: an aurora halo behind it, a wisp of mist beneath,
      // and a slow cloud of sparks drifting around it.
      const s = isl.size;
      // The aura follows the island but does not spin with it, so the halo always sits behind.
      const aura = new THREE.Group();
      scene.add(aura);
      const halo = sprite(0x5fe8b6, 0.34); // aurora, above and behind
      halo.scale.set(s * 3.6, s * 2.8, 1);
      halo.position.set(0, s * 0.35, -s * 0.4);
      aura.add(halo);
      const halo2 = sprite(0x2a7fb8, 0.3); // the water's reflection, below
      halo2.scale.set(s * 3.2, s * 2.2, 1);
      halo2.position.set(0, -s * 0.55, -s * 0.3);
      aura.add(halo2);
      const mist = sprite(0x8fcbe6, 0.2);
      mist.scale.set(s * 2.2, s * 0.8, 1);
      mist.position.set(0, -s * 0.6, s * 0.1);
      aura.add(mist);
      const N = 14;
      const pos = new Float32Array(N * 3);
      const col = new Float32Array(N * 3);
      const phase = new Float32Array(N);
      for (let k = 0; k < N; k++) {
        const r = s * (0.55 + Math.random() * 0.75);
        const a = Math.random() * Math.PI * 2;
        pos[k * 3] = Math.cos(a) * r;
        pos[k * 3 + 1] = (Math.random() - 0.35) * s * 1.1;
        pos[k * 3 + 2] = Math.sin(a) * r;
        phase[k] = Math.random() * Math.PI * 2;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const sparks = new THREE.Points(geo, new THREE.PointsMaterial({ map: softTex, size: s * 0.06, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true, fog: false }));
      pivot.add(sparks);
      isl.fx = { aura, halo, halo2, mist, sparks, phase, col, pos, N };
      loader.load(ASSET + isl.file + '.glb' + V, (gltf) => {
        const model = gltf.scene;
        model.traverse((n) => { if (n.isMesh) { n.material = material; n.frustumCulled = false; } });
        // Centre the island and size it to about `size` units across, whatever the export units were.
        const box = new THREE.Box3().setFromObject(model);
        const dim = box.getSize(new THREE.Vector3());
        const centre = box.getCenter(new THREE.Vector3());
        model.position.sub(centre);
        model.scale.setScalar(isl.size / Math.max(dim.x, dim.y, dim.z));
        model.rotation.x = isl.tilt;
        pivot.add(model);
        state.ready += 1;
        place();
        renderOnce();
      }, undefined, () => { renderer.dispose(); still(); });
    });

    function place() {
      const w = host.clientWidth || 1;
      const h = host.clientHeight || 1;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
      const wide = w / h;
      ISLANDS.forEach((isl) => {
        const p = small ? isl.mob : isl.desk;
        // On wide screens the islands drift outwards with the frame, but never past the edge.
        const x = small ? p.x : Math.sign(p.x) * Math.min(Math.abs(p.x), Math.abs(p.x) / 1.6 * wide);
        isl.pivot.position.set(x, p.y, p.z || 0);
        isl.pivot.scale.setScalar(p.s);
        isl.baseX = x;
        if (isl.fx) { isl.fx.aura.position.copy(isl.pivot.position); isl.fx.aura.scale.copy(isl.pivot.scale); }
      });
    }
    function renderOnce() { if (!state.ready) return; renderer.render(scene, camera); }
    function frame(now) {
      if (!state.running) return;
      state.t = now;
      state.visible += (state.target - state.visible) * 0.16;
      host.style.opacity = state.visible.toFixed(3);
      if (state.visible < 0.004 && state.target === 0) { state.running = false; return; }
      const tsec = now / 1000;
      state.px += (state.tx - state.px) * 0.05;
      state.py += (state.ty - state.py) * 0.05;
      ISLANDS.forEach((isl) => {
        const p = small ? isl.mob : isl.desk;
        const depth = isl.depth || 1;
        // Only the main island answers the pointer; the far ones keep their own slow drift.
        const fx = isl.follow ? state.px : 0;
        const fy = isl.follow ? state.py : 0;
        isl.pivot.rotation.y = tsec * isl.spin + fx * 0.18 * depth;
        isl.pivot.rotation.z = Math.sin(tsec * 0.5 + isl.phase) * 0.025;
        isl.pivot.position.x = isl.baseX + fx * 0.12 * depth + Math.sin(tsec * 0.21 + isl.phase) * (isl.follow ? 0 : 0.08);
        isl.pivot.position.y = p.y + Math.sin(tsec * 0.8 + isl.phase) * isl.bob - state.p * 1.6 * depth + fy * 0.08 * depth;
        const efx = isl.fx;
        if (efx) {
          efx.aura.position.copy(isl.pivot.position);
          efx.aura.scale.copy(isl.pivot.scale);
          // The halo breathes with the aurora, the mist sways, the sparks twinkle and rise.
          efx.halo.material.opacity = 0.3 + 0.08 * Math.sin(tsec * 0.5 + isl.phase);
          efx.halo2.material.opacity = 0.26 + 0.07 * Math.sin(tsec * 0.4 + isl.phase + 1.3);
          efx.mist.material.opacity = 0.16 + 0.06 * Math.sin(tsec * 0.45 + isl.phase + 2);
          efx.mist.position.x = Math.sin(tsec * 0.3 + isl.phase) * isl.size * 0.08;
          const c = efx.col;
          const q = efx.pos;
          for (let k = 0; k < efx.N; k++) {
            const tw = 0.1 + 0.5 * Math.max(0, Math.sin(tsec * 1.1 + efx.phase[k]));
            const cool = k % 3 === 0;
            c[k * 3] = tw * (cool ? 0.75 : 0.5);
            c[k * 3 + 1] = tw * (cool ? 0.85 : 1);
            c[k * 3 + 2] = tw * (cool ? 1 : 0.8);
            q[k * 3 + 1] += 0.0008 * isl.size;
            if (q[k * 3 + 1] > isl.size * 0.8) q[k * 3 + 1] = -isl.size * 0.4;
          }
          efx.sparks.geometry.attributes.color.needsUpdate = true;
          efx.sparks.geometry.attributes.position.needsUpdate = true;
        }
      });
      renderOnce();
      requestAnimationFrame(frame);
    }
    function wake() {
      if (state.running || reduced || !state.seen || document.hidden) return;
      state.running = true;
      state.t = 0;
      requestAnimationFrame(frame);
    }
    window.agenceIsland = {
      set(p) {
        state.p = p;
        const k = Math.min(1, Math.max(0, (p - FADE_FROM) / FADE_LEN));
        state.target = 1 - k;
        if (state.target > 0 || state.visible > 0.004) wake();
        if (reduced) { host.style.opacity = String(state.target); renderOnce(); }
      },
      refresh() { place(); renderOnce(); },
      // One frame as a PNG data URL (the buffer is read in the same task as the render, so no preserveDrawingBuffer).
      snapshot() { if (state.ready < ISLANDS.length) return null; renderOnce(); return renderer.domElement.toDataURL('image/png'); },
    };
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches && !reduced) {
      window.addEventListener('pointermove', (e) => {
        state.tx = (e.clientX / window.innerWidth) * 2 - 1;
        state.ty = (e.clientY / window.innerHeight) * 2 - 1;
      }, { passive: true });
    }
    let rT = 0;
    window.addEventListener('resize', () => { clearTimeout(rT); rT = setTimeout(() => { place(); renderOnce(); }, 120); });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((entries) => { state.seen = entries[0].isIntersecting; if (state.seen) wake(); }).observe(host);
    }
    document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
    place();
    wake();
  }
}
