  const scheduleStage3DInit = (callback) => {
    if ('requestIdleCallback' in window) {
      requestIdleCallback(callback, { timeout: 1800 });
      return;
    }
    window.addEventListener('load', () => setTimeout(callback, 350), { once: true });
  };
  window.scheduleStage3DInit = scheduleStage3DInit;

  const isMobile3D = () => window.matchMedia('(max-width: 768px)').matches;

  // Absolute CDN URLs: bare "three" imports break when this file is loaded as
  // an external module (import maps are unreliable across that boundary).
  const THREE_CDN = 'https://cdn.jsdelivr.net/npm/three@0.160.0';
  let threeModulesPromise = null;
  function loadThreeModules() {
    if (!threeModulesPromise) {
      threeModulesPromise = Promise.all([
        import(`${THREE_CDN}/build/three.module.js`),
        import(`${THREE_CDN}/examples/jsm/controls/ArcballControls.js`),
        import(`${THREE_CDN}/examples/jsm/loaders/GLTFLoader.js`),
        import(`${THREE_CDN}/examples/jsm/loaders/DRACOLoader.js`),
      ]);
    }
    return threeModulesPromise;
  }

  let sharedDracoLoader = null;
  function getDracoLoader(DRACOLoader) {
    if (!sharedDracoLoader) {
      sharedDracoLoader = new DRACOLoader();
      sharedDracoLoader.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/gltf/');
      sharedDracoLoader.setDecoderConfig({ type: 'js' });
    }
    return sharedDracoLoader;
  }

  function createStage3D(THREE, ArcballControls, GLTFLoader, DRACOLoader, options) {
    const {
      stage,
      objectSwitch,
      objectSwitchLabel,
      toggle,
      toggleWrap,
      variants,
      storageKey = 'stage3dObject',
      defaultVariantId = '',
      targetSize = 2.1,
      rimColor = 0x9fffd1,
      fillColor = 0xbcd4ff,
    } = options;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    camera.position.set(0, 0, 9.5);

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: false,
      powerPreference: 'low-power',
      stencil: false,
      depth: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.1));
    renderer.setSize(stage.clientWidth, stage.clientHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 2.7;
    stage.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 1.1);
    scene.add(ambient);
    const key = new THREE.DirectionalLight(0xffffff, 3.2);
    key.position.set(3, 4, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(rimColor, 2.2);
    rim.position.set(-3, 1, -3);
    scene.add(rim);
    const fill = new THREE.DirectionalLight(fillColor, 1.1);
    fill.position.set(0, -3, 2);
    scene.add(fill);

    const savedVariant = (() => {
      try { return localStorage.getItem(storageKey); } catch { return ''; }
    })();
    let currentVariant = variants.find(variant => variant.id === savedVariant)
      || variants.find(variant => variant.id === defaultVariantId)
      || variants[0];
    let model = null;
    let loadToken = 0;
    const loader = new GLTFLoader();
    loader.setDRACOLoader(getDracoLoader(DRACOLoader));

    function updateObjectSwitch(variant, loading = false) {
      const idx = variants.findIndex(v => v.id === variant.id);
      if (objectSwitch) {
        objectSwitch.dataset.object = variant.id;
        objectSwitch.classList.toggle('is-loading', loading);
        objectSwitch.setAttribute('aria-label', `Switch 3D object. Current: ${variant.label}`);
        if (objectSwitchLabel) objectSwitchLabel.textContent = loading ? 'Loading' : variant.label;
      }
      if (toggle) {
        toggle.checked = idx > 0;
        toggle.setAttribute('aria-label', `Hero 3D shape: ${variant.label}`);
      }
      if (toggleWrap) {
        toggleWrap.dataset.object = variant.id;
        toggleWrap.classList.toggle('is-loading', loading);
      }
    }

    function disposeObject(object) {
      object.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        const materials = Array.isArray(child.material) ? child.material : [child.material].filter(Boolean);
        materials.forEach((material) => {
          Object.values(material).forEach((value) => {
            if (value?.isTexture) value.dispose();
          });
          material.dispose?.();
        });
      });
    }

    function fitModelToStage(nextModel) {
      const box = new THREE.Box3().setFromObject(nextModel);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      nextModel.position.sub(center);
      const maxDim = Math.max(size.x, size.y, size.z);
      nextModel.scale.setScalar(targetSize / maxDim);
      nextModel.userData.baseY = nextModel.position.y;
    }

    function applyVariantLighting(variant) {
      renderer.toneMappingExposure = variant.exposure || 2.7;
      ambient.intensity = variant.ambient || 1.1;
      key.intensity = variant.key || 3.2;
      rim.intensity = variant.rim || 2.2;
      fill.intensity = variant.fill || 1.1;
    }

    function loadModel(variant) {
      const token = ++loadToken;
      const src = String(variant.src || '').replace(/^\.\.\/images\//, '/images/');
      applyVariantLighting(variant);
      updateObjectSwitch(variant, true);
      loader.load(
        src,
        (gltf) => {
          if (token !== loadToken) {
            disposeObject(gltf.scene);
            return;
          }
          if (model) {
            scene.remove(model);
            disposeObject(model);
          }
          model = gltf.scene;
          fitModelToStage(model);
          scene.add(model);
          currentVariant = variant;
          try { localStorage.setItem(storageKey, variant.id); } catch {}
          updateObjectSwitch(variant, false);
        },
        undefined,
        (err) => {
          console.error(`Stage 3D: failed to load ${variant.id}`, err);
          updateObjectSwitch(currentVariant, false);
        }
      );
    }

    function onSwitchClick() {
      const currentIndex = variants.findIndex(variant => variant.id === currentVariant.id);
      const nextVariant = variants[(currentIndex + 1) % variants.length];
      loadModel(nextVariant);
    }

    function onToggleChange() {
      const nextVariant = variants[toggle.checked ? 1 : 0] || variants[0];
      loadModel(nextVariant);
    }

    updateObjectSwitch(currentVariant, false);
    objectSwitch?.addEventListener('click', onSwitchClick);
    toggle?.addEventListener('change', onToggleChange);
    loadModel(currentVariant);

    const controls = new ArcballControls(camera, stage, scene);
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.enableRotate = true;
    controls.setGizmosVisible(false);

    const ro = new ResizeObserver(() => {
      const w = stage.clientWidth, h = stage.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    ro.observe(stage);

    const clock = new THREE.Clock();
    let rafId = null;
    let isVisible = true;
    function animate() {
      const t = clock.getElapsedTime();
      if (model) {
        model.position.y = model.userData.baseY + Math.sin(t * 1.6) * 0.08;
        model.rotation.y = t * 0.18;
      }
      controls.update();
      renderer.render(scene, camera);
      if (isVisible) rafId = requestAnimationFrame(animate);
    }
    function startAnim() {
      if (rafId || !isVisible) return;
      rafId = requestAnimationFrame(animate);
    }
    function stopAnim() {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
    }
    animate();

    let io = null;
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver(([entry]) => {
        isVisible = entry.isIntersecting && document.visibilityState !== 'hidden';
        if (isVisible) startAnim(); else stopAnim();
      }, { rootMargin: '80px' });
      io.observe(stage);
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        isVisible = false;
        stopAnim();
      } else if (!io) {
        isVisible = true;
        startAnim();
      } else {
        // IO callback will restart if still on screen
        const rect = stage.getBoundingClientRect();
        const onScreen = rect.bottom > 0 && rect.top < window.innerHeight;
        isVisible = onScreen;
        if (isVisible) startAnim();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return {
      dispose() {
        stopAnim();
        ro.disconnect();
        io?.disconnect();
        document.removeEventListener('visibilitychange', onVisibility);
        objectSwitch?.removeEventListener('click', onSwitchClick);
        toggle?.removeEventListener('change', onToggleChange);
        if (model) {
          scene.remove(model);
          disposeObject(model);
          model = null;
        }
        controls.dispose();
        renderer.dispose();
        renderer.forceContextLoss?.();
        if (renderer.domElement.parentNode === stage) {
          stage.removeChild(renderer.domElement);
        }
      },
    };
  }

  function methodMat(THREE, color, extra = {}) {
    return new THREE.MeshStandardMaterial({
      color,
      roughness: extra.roughness ?? 0.4,
      metalness: extra.metalness ?? 0.1,
      ...extra,
    });
  }

  function methodMesh(THREE, geo, color, extra) {
    return new THREE.Mesh(geo, methodMat(THREE, color, extra));
  }

  function buildMethodIcon(THREE, type) {
    const g = new THREE.Group();
    const parts = {};
    g.userData.parts = parts;
    g.userData.type = type;
    const C = {
      gold: 0xe8b80a, paper: 0xf7f1e6, ink: 0x1f1c19, blue: 0x3b82f6,
      green: 0x22c55e, pink: 0xec4899, purple: 0x8b5cf6, orange: 0xf97316,
      teal: 0x14b8a6, night: 0x141418, mint: 0x5eead4, yellow: 0xfacc15,
      skin: 0xe8b48c, sky: 0x38bdf8, copper: 0xc47a2c, cream: 0xfff8ee,
    };
    const metal = { metalness: 0.52, roughness: 0.24 };
    const soft = { metalness: 0.06, roughness: 0.48 };
    const glow = (color, intensity = 0.4) => ({
      emissive: color, emissiveIntensity: intensity, roughness: 0.28, metalness: 0.18,
    });
    const add = (parent, obj, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
      obj.position.set(x, y, z);
      obj.rotation.set(rx, ry, rz);
      parent.add(obj);
      obj.userData.base = obj.position.clone();
      obj.userData.baseRot = obj.rotation.clone();
      return obj;
    };
    const box = (w, h, d, color, extra) => methodMesh(THREE, new THREE.BoxGeometry(w, h, d), color, extra);
    const cyl = (rt, rb, h, color, seg = 22, extra) => methodMesh(THREE, new THREE.CylinderGeometry(rt, rb, h, seg), color, extra);
    const ball = (r, color, extra) => methodMesh(THREE, new THREE.SphereGeometry(r, 24, 18), color, extra);
    const mark = (name, obj) => { parts[name] = obj; return obj; };

    switch (type) {
      case 'research': {
        const loupe = mark('loupe', new THREE.Group());
        g.add(loupe);
        add(loupe, methodMesh(THREE, new THREE.TorusGeometry(0.4, 0.085, 18, 40), C.gold, metal), 0, 0.16, 0, 0.38, 0, 0);
        add(loupe, methodMesh(THREE, new THREE.CircleGeometry(0.32, 32), 0xfff4c0, { transparent: true, opacity: 0.38, roughness: 0.06, metalness: 0.35, emissive: 0xffe08a, emissiveIntensity: 0.18 }), 0, 0.16, 0.02, 0.38, 0, 0);
        add(loupe, cyl(0.065, 0.075, 0.62, C.gold, 14, metal), 0.38, -0.34, 0.05, 0, 0, -0.72);
        add(loupe, ball(0.08, C.gold, metal), 0.58, -0.58, 0.08);
        add(g, box(0.62, 0.8, 0.08, C.paper, soft), -0.42, -0.02, -0.22, 0, 0.35, 0);
        add(g, box(0.34, 0.06, 0.03, C.ink, soft), -0.42, -0.18, -0.16, 0, 0.35, 0);
        add(g, box(0.28, 0.05, 0.03, C.ink, soft), -0.4, 0.02, -0.16, 0, 0.35, 0);
        break;
      }
      case 'user-research': {
        const person = (name, x, z, s, bodyColor) => {
          const p = mark(name, new THREE.Group());
          g.add(p);
          p.position.set(x, 0, z);
          p.userData.base = p.position.clone();
          add(p, ball(0.2 * s, C.skin, soft), 0, 0.58 * s, 0);
          add(p, cyl(0.08 * s, 0.1 * s, 0.1 * s, C.skin, 12, soft), 0, 0.4 * s, 0);
          add(p, cyl(0.16 * s, 0.23 * s, 0.5 * s, bodyColor, 16, soft), 0, 0.12 * s, 0);
          return p;
        };
        person('p1', -0.38, 0.1, 1, C.teal);
        person('p2', 0.38, -0.1, 1.14, C.blue);
        break;
      }
      case 'workshops': {
        const note = (name, color, x, y, z, ry) => {
          const n = mark(name, new THREE.Group());
          g.add(n);
          n.position.set(x, y, z);
          n.userData.base = n.position.clone();
          n.rotation.y = ry;
          add(n, box(1.02, 0.09, 1.02, color, soft));
          add(n, ball(0.055, C.pink, metal), 0.38, 0.08, -0.38);
        };
        note('n1', C.orange, -0.16, -0.16, -0.14, -0.38);
        note('n2', C.yellow, 0.02, 0.02, 0.02, -0.1);
        note('n3', C.mint, 0.2, 0.2, 0.14, 0.34);
        break;
      }
      case 'user-flows': {
        const node = (name, w, h, d, color, x, y, z) => {
          const n = mark(name, new THREE.Group());
          g.add(n);
          n.position.set(x, y, z);
          n.userData.base = n.position.clone();
          add(n, box(w, h, d, color, soft));
          add(n, ball(0.07, C.gold, metal), 0, h / 2 + 0.02, 0);
        };
        node('n1', 0.42, 0.42, 0.42, C.gold, -0.52, -0.06, 0.16);
        node('n2', 0.54, 0.38, 0.54, C.blue, 0.3, 0.28, -0.1);
        node('n3', 0.36, 0.36, 0.36, C.teal, 0.16, -0.34, 0.28);
        const pipe = (x1, y1, z1, x2, y2, z2) => {
          const dir = new THREE.Vector3(x2 - x1, y2 - y1, z2 - z1);
          const len = dir.length();
          const p = cyl(0.04, 0.04, len, C.blue, 10, { metalness: 0.2, roughness: 0.35 });
          p.position.set((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2);
          p.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
          g.add(p);
        };
        pipe(-0.3, 0.04, 0.12, 0.1, 0.2, 0);
        pipe(0.24, 0.1, 0.06, 0.18, -0.16, 0.22);
        break;
      }
      case 'ia': {
        add(g, box(1.22, 0.2, 0.5, C.ink, { metalness: 0.2, roughness: 0.4 }), 0, 0.42, 0);
        mark('c1', add(g, box(0.38, 0.5, 0.38, C.paper, soft), -0.36, -0.04, 0));
        mark('c2', add(g, box(0.32, 0.68, 0.32, C.gold, metal), 0, 0.04, 0.04));
        mark('c3', add(g, box(0.38, 0.5, 0.38, C.paper, soft), 0.36, -0.04, 0));
        break;
      }
      case 'wireframe': {
        const frame = (name, y, z, rotY) => {
          const f = mark(name, new THREE.Group());
          g.add(f);
          f.position.set(0, y, z);
          f.rotation.y = rotY;
          const geo = new THREE.BoxGeometry(1.12, 0.76, 0.07);
          add(f, methodMesh(THREE, geo, C.paper, { transparent: true, opacity: 0.18, roughness: 0.35 }));
          f.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x1a1714 })));
          add(f, box(0.7, 0.08, 0.03, C.ink, soft), 0, 0.18, 0.05);
          add(f, box(0.32, 0.22, 0.03, C.blue, soft), -0.18, -0.08, 0.05);
          add(f, box(0.32, 0.22, 0.03, C.mint, soft), 0.18, -0.08, 0.05);
        };
        frame('f1', -0.18, -0.22, -0.2);
        frame('f2', 0.02, 0, 0);
        frame('f3', 0.22, 0.22, 0.2);
        break;
      }
      case 'prototype': {
        const phone = mark('phone', new THREE.Group());
        g.add(phone);
        add(phone, box(0.7, 1.38, 0.13, C.night, { metalness: 0.35, roughness: 0.32 }));
        mark('screen', add(phone, box(0.56, 1.06, 0.04, C.sky, glow(C.sky, 0.55)), 0, 0.06, 0.09));
        add(phone, box(0.22, 0.045, 0.03, 0x0a0a0c, soft), 0, 0.62, 0.09);
        add(phone, box(0.16, 0.04, 0.03, 0x0a0a0c, soft), 0, -0.58, 0.09);
        add(phone, box(0.03, 0.16, 0.06, C.ink, soft), 0.37, 0.18, 0);
        break;
      }
      case 'user-tests': {
        add(g, box(0.9, 1.16, 0.1, C.paper, soft));
        add(g, box(0.38, 0.16, 0.16, C.green, metal), 0, 0.62, 0.05);
        add(g, cyl(0.045, 0.045, 0.22, C.green, 10, metal), 0, 0.74, 0.05, 0, 0, 1.57);
        mark('check', add(g, box(0.12, 0.12, 0.04, C.green, glow(C.green, 0.25)), -0.26, 0.22, 0.08));
        add(g, box(0.48, 0.06, 0.03, C.teal, soft), 0.08, 0.22, 0.08);
        add(g, box(0.12, 0.12, 0.04, C.green, glow(C.green, 0.2)), -0.26, 0.0, 0.08);
        add(g, box(0.4, 0.06, 0.03, C.teal, soft), 0.06, 0.0, 0.08);
        add(g, box(0.48, 0.06, 0.03, 0xd6d0c4, soft), 0, -0.24, 0.08);
        break;
      }
      case 'ui-design': {
        add(g, box(1.26, 0.88, 0.12, C.paper, soft));
        add(g, box(1.26, 0.16, 0.13, C.ink, { metalness: 0.2, roughness: 0.38 }), 0, 0.36, 0.02);
        add(g, ball(0.035, 0xff5f57, soft), -0.5, 0.36, 0.1);
        add(g, ball(0.035, 0xfebb2e, soft), -0.4, 0.36, 0.1);
        add(g, ball(0.035, 0x28c840, soft), -0.3, 0.36, 0.1);
        mark('card1', add(g, box(0.42, 0.3, 0.05, C.pink, glow(C.pink, 0.12)), -0.28, 0.02, 0.08));
        mark('card2', add(g, box(0.42, 0.3, 0.05, C.purple, glow(C.purple, 0.12)), 0.28, 0.02, 0.08));
        add(g, box(0.9, 0.14, 0.05, C.yellow, soft), 0, -0.26, 0.08);
        break;
      }
      case 'design-system': {
        mark('c1', add(g, box(0.44, 0.44, 0.44, C.orange, soft), -0.32, -0.06, -0.26));
        mark('c2', add(g, box(0.44, 0.44, 0.44, C.blue, soft), 0.32, -0.06, -0.26));
        mark('c3', add(g, box(0.44, 0.44, 0.44, C.green, soft), -0.32, -0.06, 0.26));
        mark('c4', add(g, box(0.44, 0.64, 0.44, C.pink, soft), 0.32, 0.04, 0.26));
        add(g, methodMesh(THREE, new THREE.TorusGeometry(0.16, 0.035, 10, 24), C.gold, metal), 0, 0.42, 0, Math.PI / 2, 0, 0);
        break;
      }
      case 'ai-vibe-code': {
        add(g, box(1.12, 0.78, 0.14, C.night, { metalness: 0.3, roughness: 0.32 }), 0, 0.08, -0.08);
        add(g, box(0.94, 0.54, 0.05, 0x7c3aed, glow(0x7c3aed, 0.35)), 0, 0.04, 0.02);
        mark('line1', add(g, box(0.28, 0.07, 0.04, C.mint, glow(C.mint, 0.45)), -0.24, 0.12, 0.08));
        mark('line2', add(g, box(0.38, 0.07, 0.04, C.pink, glow(C.pink, 0.35)), 0.1, 0.0, 0.08));
        mark('line3', add(g, box(0.22, 0.07, 0.04, C.gold, metal), 0.24, -0.12, 0.08));
        add(g, box(0.08, 0.22, 0.04, C.mint, glow(C.mint, 0.4)), -0.34, -0.02, 0.08);
        const crystal = mark('crystal', methodMesh(
          THREE,
          new THREE.OctahedronGeometry(0.28, 0),
          0xc4b5fd,
          {
            metalness: 0.18,
            roughness: 0.1,
            emissive: 0x7c3aed,
            emissiveIntensity: 0.55,
            transparent: true,
            opacity: 0.94,
          }
        ));
        add(g, crystal, 0.52, -0.34, 0.28);
        add(g, ball(0.08, C.mint, glow(C.mint, 0.5)), -0.52, -0.28, 0.24);
        add(g, ball(0.06, C.pink, glow(C.pink, 0.4)), 0.22, -0.42, 0.2);
        break;
      }
      case 'audit': {
        add(g, box(0.7, 0.96, 0.1, C.paper, soft), -0.28, -0.02, -0.12, 0, 0.22, 0);
        add(g, box(0.24, 0.12, 0.12, C.orange, metal), -0.28, -0.42, -0.02, 0, 0.22, 0);
        mark('bar1', add(g, box(0.32, 0.07, 0.05, C.orange, glow(C.orange, 0.2)), -0.34, 0.18, 0.0, 0, 0.22, 0));
        mark('bar2', add(g, box(0.4, 0.07, 0.05, C.yellow, soft), -0.28, 0.04, 0.02, 0, 0.22, 0));
        mark('bar3', add(g, box(0.26, 0.07, 0.05, C.green, glow(C.green, 0.2)), -0.32, -0.1, 0.02, 0, 0.22, 0));
        const loupe = mark('loupe', new THREE.Group());
        g.add(loupe);
        loupe.position.set(0.38, 0.06, 0.22);
        loupe.userData.base = loupe.position.clone();
        add(loupe, methodMesh(THREE, new THREE.TorusGeometry(0.26, 0.05, 12, 32), C.gold, metal), 0, 0, 0, 0.2, 0, -0.15);
        add(loupe, methodMesh(THREE, new THREE.CircleGeometry(0.18, 24), 0xfff4c0, { transparent: true, opacity: 0.35, roughness: 0.08, metalness: 0.3 }), 0, 0, 0.02, 0.2, 0, -0.15);
        add(loupe, box(0.08, 0.36, 0.08, C.gold, metal), 0.22, -0.28, 0.04, 0, 0, 0.55);
        mark('dot1', add(g, ball(0.07, C.orange, glow(C.orange, 0.35)), -0.02, -0.18, 0.26));
        mark('dot2', add(g, ball(0.055, C.yellow, glow(C.yellow, 0.3)), 0.14, 0.12, 0.2));
        break;
      }
      case 'handoff': {
        const design = mark('design', new THREE.Group());
        g.add(design);
        design.position.set(-0.4, 0.02, -0.06);
        design.userData.base = design.position.clone();
        design.rotation.y = 0.28;
        add(design, box(0.68, 0.88, 0.08, C.paper, soft));
        add(design, box(0.36, 0.22, 0.04, C.blue, soft), 0, 0.08, 0.06);
        add(design, box(0.24, 0.12, 0.04, C.teal, soft), -0.08, -0.18, 0.06);
        add(design, box(0.14, 0.14, 0.04, C.gold, metal), 0.18, -0.22, 0.06);
        mark('pipe', add(g, cyl(0.045, 0.045, 0.34, C.gold, 10, metal), -0.02, 0.06, 0.08, 0, 0, 1.57));
        mark('arrow', add(g, box(0.12, 0.12, 0.12, C.gold, metal), 0.16, 0.06, 0.08, 0, 0, 0.78));
        const code = mark('code', new THREE.Group());
        g.add(code);
        code.position.set(0.42, 0.04, 0.06);
        code.userData.base = code.position.clone();
        code.rotation.y = -0.22;
        add(code, box(0.7, 0.84, 0.12, C.night, { metalness: 0.28, roughness: 0.32 }));
        mark('line1', add(code, box(0.38, 0.07, 0.04, C.mint, glow(C.mint, 0.35)), -0.04, 0.16, 0.1));
        mark('line2', add(code, box(0.48, 0.07, 0.04, C.blue, soft), 0.02, 0.0, 0.1));
        mark('line3', add(code, box(0.28, 0.07, 0.04, C.gold, metal), -0.08, -0.16, 0.1));
        break;
      }
      case 'brand': {
        add(g, cyl(0.54, 0.54, 0.12, C.paper, 36, soft), 0, -0.24, 0);
        add(g, cyl(0.16, 0.16, 0.14, C.cream, 24, soft), 0, -0.22, 0);
        const sw = mark('swatches', new THREE.Group());
        g.add(sw);
        add(sw, ball(0.12, C.orange, metal), -0.28, 0.02, 0.14);
        add(sw, ball(0.13, C.blue, metal), 0.26, 0.06, -0.1);
        add(sw, ball(0.11, C.green, metal), 0.04, 0.0, 0.28);
        add(sw, ball(0.1, C.pink, metal), -0.06, 0.08, -0.24);
        add(g, cyl(0.03, 0.03, 0.55, C.ink, 8, soft), 0.42, 0.12, 0.18, 0, 0, 0.6);
        break;
      }
      case 'product-vision': {
        add(g, box(0.96, 0.1, 0.96, C.paper, soft), 0, -0.48, 0);
        mark('ring1', add(g, methodMesh(THREE, new THREE.TorusGeometry(0.42, 0.035, 12, 48), C.gold, metal), 0, -0.36, 0, Math.PI / 2, 0, 0));
        mark('ring2', add(g, methodMesh(THREE, new THREE.TorusGeometry(0.26, 0.03, 10, 40), C.cream, soft), 0, -0.32, 0, Math.PI / 2, 0, 0));
        add(g, cyl(0.1, 0.1, 0.06, C.gold, 18, metal), 0, -0.28, 0);
        mark('obelisk', add(g, box(0.16, 0.72, 0.16, C.ink, { metalness: 0.25, roughness: 0.35 }), 0, 0.12, 0));
        add(g, ball(0.1, C.yellow, glow(C.yellow, 0.45)), 0, 0.52, 0);
        add(g, box(0.12, 0.12, 0.12, C.gold, metal), 0.38, 0.18, 0.22);
        break;
      }
      case 'journey-mapping': {
        mark('s1', add(g, box(0.36, 0.12, 0.36, C.teal, soft), -0.52, -0.28, 0.16));
        mark('s2', add(g, box(0.36, 0.12, 0.36, C.blue, soft), 0, 0.0, 0));
        mark('s3', add(g, box(0.36, 0.12, 0.36, C.gold, soft), 0.5, 0.28, -0.16));
        add(g, ball(0.1, C.mint, glow(C.mint, 0.25)), -0.52, -0.1, 0.16);
        add(g, ball(0.1, C.blue, glow(C.blue, 0.25)), 0, 0.18, 0);
        add(g, ball(0.11, C.gold, glow(C.gold, 0.3)), 0.5, 0.46, -0.16);
        const curve = new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(-0.52, -0.1, 0.16),
          new THREE.Vector3(0, 0.34, 0.08),
          new THREE.Vector3(0.5, 0.46, -0.16)
        );
        add(g, methodMesh(THREE, new THREE.TubeGeometry(curve, 28, 0.03, 8, false), C.teal, { metalness: 0.2, roughness: 0.35 }));
        add(g, box(0.14, 0.08, 0.14, C.yellow, soft), 0.5, 0.58, -0.16);
        break;
      }
      case 'automation': {
        const makeGear = (radius, teeth, color, thick) => {
          const gear = new THREE.Group();
          add(gear, cyl(radius * 0.58, radius * 0.58, thick, color, 28, { metalness: 0.25, roughness: 0.35 }));
          add(gear, cyl(radius * 0.16, radius * 0.16, thick + 0.05, C.night, 12, metal));
          for (let i = 0; i < teeth; i++) {
            const tooth = box(0.14, thick, radius * 0.38, color, { metalness: 0.25, roughness: 0.35 });
            const a = (i / teeth) * Math.PI * 2;
            tooth.position.set(Math.cos(a) * radius * 0.82, 0, Math.sin(a) * radius * 0.82);
            tooth.rotation.y = a;
            gear.add(tooth);
          }
          gear.rotation.x = Math.PI / 2;
          return gear;
        };
        const a = mark('gearA', makeGear(0.48, 10, C.green, 0.16));
        a.position.set(-0.26, 0.04, 0);
        g.add(a);
        const b = mark('gearB', makeGear(0.34, 8, C.mint, 0.14));
        b.position.set(0.36, 0.16, 0.1);
        g.add(b);
        add(g, cyl(0.04, 0.04, 0.3, C.gold, 8, metal), 0.06, 0.1, 0.04, 0, 0, 1.2);
        break;
      }
      case 'data-ops': {
        mark('d1', add(g, cyl(0.36, 0.36, 0.2, C.green, 30, { metalness: 0.15, roughness: 0.38 }), 0, -0.34, 0));
        mark('d2', add(g, cyl(0.42, 0.42, 0.2, C.green, 30, { metalness: 0.15, roughness: 0.38 }), 0, -0.06, 0));
        mark('d3', add(g, cyl(0.48, 0.48, 0.2, C.mint, 30, glow(C.mint, 0.18)), 0, 0.22, 0));
        break;
      }
      case 'project-mgmt': {
        add(g, box(1.18, 0.08, 0.78, C.paper, soft), 0, -0.46, 0);
        add(g, box(0.3, 0.86, 0.58, C.ink, soft), -0.4, 0.02, 0);
        add(g, box(0.3, 0.86, 0.58, C.orange, soft), 0, 0.02, 0.04);
        add(g, box(0.3, 0.86, 0.58, C.mint, soft), 0.4, 0.02, -0.03);
        mark('card', add(g, box(0.22, 0.12, 0.28, C.yellow, soft), -0.4, 0.18, 0.22));
        add(g, box(0.22, 0.12, 0.28, C.pink, soft), 0, -0.06, 0.26);
        add(g, box(0.22, 0.12, 0.28, C.blue, soft), 0.4, 0.1, 0.2);
        break;
      }
      case 'dev-follow': {
        add(g, box(1.18, 0.82, 0.12, C.night, { metalness: 0.25, roughness: 0.35 }));
        add(g, box(1.18, 0.1, 0.13, C.ink, soft), 0, 0.36, 0.01);
        add(g, ball(0.03, 0xff5f57, soft), -0.48, 0.36, 0.09);
        add(g, ball(0.03, 0xfebb2e, soft), -0.38, 0.36, 0.09);
        add(g, ball(0.03, 0x28c840, soft), -0.28, 0.36, 0.09);
        const bars = mark('bars', new THREE.Group());
        g.add(bars);
        bars.userData.base = bars.position.clone();
        add(bars, box(0.16, 0.18, 0.14, C.green, glow(C.green, 0.2)), -0.28, -0.08, 0.1);
        add(bars, box(0.16, 0.36, 0.14, C.mint, glow(C.mint, 0.25)), 0, -0.02, 0.1);
        add(bars, box(0.16, 0.26, 0.14, C.green, glow(C.green, 0.2)), 0.28, -0.06, 0.1);
        break;
      }
      case 'marketing': {
        mark('f1', add(g, box(0.96, 0.12, 0.62, C.orange, soft), -0.12, 0.42, 0));
        mark('f2', add(g, box(0.72, 0.12, 0.52, C.yellow, soft), -0.12, 0.2, 0));
        mark('f3', add(g, box(0.48, 0.12, 0.42, C.gold, metal), -0.12, -0.02, 0));
        mark('f4', add(g, box(0.28, 0.12, 0.32, C.night, { metalness: 0.28, roughness: 0.32 }), -0.12, -0.24, 0));
        mark('b1', add(g, box(0.14, 0.52, 0.14, C.pink, glow(C.pink, 0.25)), 0.52, 0.08, 0.22));
        mark('b2', add(g, box(0.14, 0.36, 0.14, C.orange, soft), 0.72, 0.16, 0.22));
        mark('b3', add(g, box(0.14, 0.22, 0.14, C.yellow, soft), 0.92, 0.24, 0.22));
        add(g, ball(0.08, C.pink, glow(C.pink, 0.4)), -0.58, -0.28, 0.26);
        add(g, ball(0.06, C.yellow, glow(C.yellow, 0.35)), 0.28, -0.4, 0.28);
        break;
      }
      case 'game-3d': {
        mark('pyramid', add(g, methodMesh(THREE, new THREE.ConeGeometry(0.62, 0.86, 4), C.gold, { metalness: 0.45, roughness: 0.22, emissive: 0x8a6208, emissiveIntensity: 0.15 }), 0, 0.08, 0));
        add(g, box(0.72, 0.1, 0.72, C.night, { metalness: 0.3, roughness: 0.32 }), 0, -0.42, 0);
        add(g, box(0.18, 0.18, 0.18, C.teal, soft), -0.28, -0.22, 0.28);
        const hero = mark('hero', new THREE.Group());
        g.add(hero);
        hero.position.set(0.32, -0.18, 0.34);
        hero.userData.base = hero.position.clone();
        add(hero, ball(0.1, C.gold, metal), 0, 0.2, 0);
        add(hero, cyl(0.08, 0.11, 0.2, C.teal, 12, soft), 0, 0.02, 0);
        mark('orb', add(g, ball(0.08, C.mint, glow(C.mint, 0.45)), -0.36, 0.28, 0.22));
        break;
      }
      default: {
        add(g, methodMesh(THREE, new THREE.TorusGeometry(0.4, 0.085, 18, 40), C.gold, metal), 0, 0.16, 0, 0.38, 0, 0);
        add(g, cyl(0.065, 0.075, 0.62, C.gold, 14, metal), 0.38, -0.34, 0.05, 0, 0, -0.72);
        break;
      }
    }
    g.rotation.x = -0.28;
    g.rotation.y = -0.5;
    return g;
  }

  function animateMethodParts(model, t, paused) {
    const parts = model.userData.parts || {};
    const type = model.userData.type;
    const k = paused ? 0.22 : 1;
    const baseY = (obj, amp, freq, phase = 0) => {
      if (!obj?.userData.base) return;
      obj.position.y = obj.userData.base.y + Math.sin(t * freq + phase) * amp * k;
    };
    switch (type) {
      case 'research':
        if (parts.loupe) parts.loupe.rotation.z = Math.sin(t * 1.35) * 0.14 * k;
        break;
      case 'user-research':
        baseY(parts.p1, 0.045, 1.55);
        baseY(parts.p2, 0.055, 1.55, 1.3);
        if (parts.p2) parts.p2.rotation.y = Math.sin(t * 1.1) * 0.12 * k;
        break;
      case 'workshops':
        if (parts.n1) parts.n1.rotation.y = -0.38 + Math.sin(t * 0.9) * 0.08 * k;
        if (parts.n2) parts.n2.rotation.y = -0.1 + Math.sin(t * 1.05 + 0.6) * 0.07 * k;
        if (parts.n3) parts.n3.rotation.y = 0.34 + Math.sin(t * 0.85 + 1.2) * 0.08 * k;
        break;
      case 'user-flows':
        baseY(parts.n1, 0.045, 1.7);
        baseY(parts.n2, 0.05, 1.7, 1);
        baseY(parts.n3, 0.04, 1.7, 2);
        break;
      case 'ia':
        baseY(parts.c1, 0.03, 1.25);
        baseY(parts.c2, 0.04, 1.25, 0.8);
        baseY(parts.c3, 0.03, 1.25, 1.6);
        break;
      case 'wireframe':
        if (parts.f1) parts.f1.rotation.y = -0.2 + Math.sin(t * 0.7) * 0.06 * k;
        if (parts.f3) parts.f3.rotation.y = 0.2 + Math.sin(t * 0.7 + 1) * -0.06 * k;
        break;
      case 'prototype':
        if (parts.phone) {
          parts.phone.rotation.x = Math.sin(t * 1.15) * 0.1 * k;
          parts.phone.rotation.z = Math.sin(t * 0.9) * 0.06 * k;
        }
        if (parts.screen?.material) {
          parts.screen.material.emissiveIntensity = 0.4 + Math.sin(t * 2.1) * 0.16 * k;
        }
        break;
      case 'user-tests':
        if (parts.check) {
          const s = 1 + Math.sin(t * 2.2) * 0.1 * k;
          parts.check.scale.setScalar(s);
        }
        break;
      case 'ui-design':
        baseY(parts.card1, 0.035, 1.45);
        baseY(parts.card2, 0.035, 1.45, 1.1);
        break;
      case 'design-system':
        baseY(parts.c1, 0.04, 1.35);
        baseY(parts.c2, 0.04, 1.35, 0.8);
        baseY(parts.c3, 0.04, 1.35, 1.6);
        baseY(parts.c4, 0.05, 1.35, 2.2);
        if (parts.c4) parts.c4.rotation.y = t * 0.45 * (paused ? 0.2 : 1);
        break;
      case 'ai-vibe-code': {
        const speed = paused ? 0.22 : 1;
        if (parts.crystal) {
          parts.crystal.rotation.y = t * 0.7 * speed;
          parts.crystal.rotation.x = Math.sin(t * 0.9) * 0.18 * k;
        }
        if (parts.crystal?.material) {
          parts.crystal.material.emissiveIntensity = 0.42 + Math.sin(t * 2.5) * 0.22 * k;
        }
        if (parts.line1) parts.line1.scale.x = 0.85 + Math.sin(t * 2.4) * 0.18 * k;
        if (parts.line2) parts.line2.scale.x = 0.85 + Math.sin(t * 2.1 + 0.8) * 0.2 * k;
        if (parts.line3) parts.line3.scale.x = 0.85 + Math.sin(t * 2.7 + 1.4) * 0.16 * k;
        break;
      }
      case 'audit':
        if (parts.loupe) {
          parts.loupe.rotation.z = Math.sin(t * 1.25) * 0.12 * k;
          baseY(parts.loupe, 0.035, 1.4);
        }
        if (parts.bar1) parts.bar1.scale.x = 0.82 + Math.sin(t * 1.8) * 0.18 * k;
        if (parts.bar2) parts.bar2.scale.x = 0.82 + Math.sin(t * 1.8 + 0.7) * 0.16 * k;
        if (parts.bar3) parts.bar3.scale.x = 0.82 + Math.sin(t * 1.8 + 1.4) * 0.14 * k;
        if (parts.dot1?.material) parts.dot1.material.emissiveIntensity = 0.25 + Math.sin(t * 2.4) * 0.2 * k;
        if (parts.dot2?.material) parts.dot2.material.emissiveIntensity = 0.22 + Math.sin(t * 2.1 + 1) * 0.18 * k;
        break;
      case 'handoff':
        if (parts.design?.userData.base) {
          parts.design.position.x = parts.design.userData.base.x + Math.sin(t * 1.15) * 0.03 * k;
        }
        if (parts.code?.userData.base) {
          parts.code.position.x = parts.code.userData.base.x - Math.sin(t * 1.15) * 0.03 * k;
        }
        if (parts.arrow) {
          const s = 1 + Math.sin(t * 2.2) * 0.12 * k;
          parts.arrow.scale.setScalar(s);
        }
        if (parts.line1) parts.line1.scale.x = 0.85 + Math.sin(t * 2.3) * 0.15 * k;
        if (parts.line2) parts.line2.scale.x = 0.85 + Math.sin(t * 2.0 + 0.6) * 0.18 * k;
        if (parts.line3) parts.line3.scale.x = 0.85 + Math.sin(t * 2.5 + 1.2) * 0.14 * k;
        break;
      case 'brand':
        if (parts.swatches) parts.swatches.rotation.y = t * 0.5 * (paused ? 0.2 : 1);
        break;
      case 'product-vision':
        if (parts.obelisk) parts.obelisk.rotation.y = t * 0.32 * (paused ? 0.15 : 1);
        if (parts.ring1) {
          const s = 1 + Math.sin(t * 1.6) * 0.06 * k;
          parts.ring1.scale.set(s, 1, s);
        }
        if (parts.ring2) {
          const s = 1 + Math.sin(t * 1.6 + 1) * 0.08 * k;
          parts.ring2.scale.set(s, 1, s);
        }
        break;
      case 'journey-mapping':
        baseY(parts.s1, 0.05, 1.65);
        baseY(parts.s2, 0.055, 1.65, 1);
        baseY(parts.s3, 0.05, 1.65, 2);
        break;
      case 'automation':
        if (parts.gearA) parts.gearA.rotation.z = t * 0.95 * (paused ? 0.18 : 1);
        if (parts.gearB) parts.gearB.rotation.z = -t * 1.25 * (paused ? 0.18 : 1);
        break;
      case 'data-ops':
        if (parts.d1) parts.d1.rotation.y = t * 0.4 * (paused ? 0.2 : 1);
        if (parts.d2) parts.d2.rotation.y = -t * 0.55 * (paused ? 0.2 : 1);
        if (parts.d3) parts.d3.rotation.y = t * 0.7 * (paused ? 0.2 : 1);
        break;
      case 'project-mgmt':
        baseY(parts.card, 0.05, 1.55);
        break;
      case 'dev-follow':
        if (parts.bars) {
          const s = 0.92 + Math.sin(t * 1.7) * 0.08 * k;
          parts.bars.scale.y = s;
        }
        break;
      case 'marketing':
        baseY(parts.f1, 0.02, 1.2);
        baseY(parts.f2, 0.025, 1.2, 0.5);
        baseY(parts.f3, 0.03, 1.2, 1);
        baseY(parts.f4, 0.035, 1.2, 1.5);
        if (parts.b1) parts.b1.scale.y = 0.88 + Math.sin(t * 1.7) * 0.14 * k;
        if (parts.b2) parts.b2.scale.y = 0.88 + Math.sin(t * 1.7 + 0.6) * 0.16 * k;
        if (parts.b3) parts.b3.scale.y = 0.88 + Math.sin(t * 1.7 + 1.2) * 0.18 * k;
        break;
      case 'game-3d':
        if (parts.pyramid) parts.pyramid.rotation.y = t * 0.42 * (paused ? 0.2 : 1);
        baseY(parts.hero, 0.06, 2.05);
        if (parts.orb) {
          parts.orb.position.y = (parts.orb.userData.base?.y || 0.28) + Math.sin(t * 2.2) * 0.05 * k;
          parts.orb.rotation.y = t * 1.1 * (paused ? 0.2 : 1);
        }
        break;
    }
  }
  function createMethodIcon3D(THREE, options) {
    const { stage, type } = options;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 40);
    camera.position.set(0, 0.12, 3.4);

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: false,
      powerPreference: 'low-power',
      stencil: false,
      depth: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1));
    renderer.setSize(stage.clientWidth, stage.clientHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.72;
    renderer.setClearColor(0x000000, 0);
    stage.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.88));
    const key = new THREE.DirectionalLight(0xfff4e0, 2.55);
    key.position.set(2.6, 3.4, 3.2);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fffd1, 1.65);
    rim.position.set(-2.6, 1.2, -2.4);
    scene.add(rim);
    const fill = new THREE.DirectionalLight(0xbcd4ff, 0.95);
    fill.position.set(0, -2.2, 1.6);
    scene.add(fill);

    const model = buildMethodIcon(THREE, type);
    const box3 = new THREE.Box3().setFromObject(model);
    const size = box3.getSize(new THREE.Vector3());
    const center = box3.getCenter(new THREE.Vector3());
    model.position.sub(center);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    model.scale.setScalar(1.55 / maxDim);
    model.userData.baseY = model.position.y;
    scene.add(model);

    const cssObj = stage.querySelector('.method-obj');
    if (cssObj) cssObj.hidden = true;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let paused = false;
    const onEnter = () => { paused = true; };
    const onLeave = () => { paused = false; };
    stage.addEventListener('pointerenter', onEnter);
    stage.addEventListener('pointerleave', onLeave);

    const ro = new ResizeObserver(() => {
      const w = stage.clientWidth, h = stage.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    ro.observe(stage);

    const clock = new THREE.Clock();
    let rafId = null;
    let isVisible = true;
    function animate() {
      const t = clock.getElapsedTime();
      if (!reduceMotion) {
        if (paused) {
          model.rotation.y += ((-0.5 + t * 0.12) - model.rotation.y) * 0.06;
        } else {
          model.rotation.y = -0.5 + t * 0.42;
          model.position.y = model.userData.baseY + Math.sin(t * 1.35) * 0.045;
        }
        animateMethodParts(model, t, paused);
      }
      renderer.render(scene, camera);
      if (isVisible) rafId = requestAnimationFrame(animate);
    }
    function startAnim() {
      if (rafId || !isVisible) return;
      rafId = requestAnimationFrame(animate);
    }
    function stopAnim() {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
    }
    animate();

    let io = null;
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver(([entry]) => {
        isVisible = entry.isIntersecting && document.visibilityState !== 'hidden';
        if (isVisible) startAnim(); else stopAnim();
      }, { rootMargin: '40px' });
      io.observe(stage);
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        isVisible = false;
        stopAnim();
        return;
      }
      const rect = stage.getBoundingClientRect();
      isVisible = rect.bottom > 0 && rect.top < window.innerHeight;
      if (isVisible) startAnim();
    };
    document.addEventListener('visibilitychange', onVisibility);

    function disposeObject(object) {
      object.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        const materials = Array.isArray(child.material) ? child.material : [child.material].filter(Boolean);
        materials.forEach((material) => material.dispose?.());
      });
    }

    return {
      dispose() {
        stopAnim();
        ro.disconnect();
        io?.disconnect();
        document.removeEventListener('visibilitychange', onVisibility);
        stage.removeEventListener('pointerenter', onEnter);
        stage.removeEventListener('pointerleave', onLeave);
        scene.remove(model);
        disposeObject(model);
        renderer.dispose();
        renderer.forceContextLoss?.();
        if (renderer.domElement.parentNode === stage) {
          stage.removeChild(renderer.domElement);
        }
      },
    };
  }

  window.mountStage3D = async (options) => {
    const [THREE, { ArcballControls }, { GLTFLoader }, { DRACOLoader }] = await loadThreeModules();
    return createStage3D(THREE, ArcballControls, GLTFLoader, DRACOLoader, options);
  };

  window.mountMethodIcon3D = async (options) => {
    const [THREE] = await loadThreeModules();
    return createMethodIcon3D(THREE, options);
  };

  // Hero 3D waits until Selected work has painted — work list is the critical path.
  const heroStage = document.getElementById('hero-3d-stage');
  if (heroStage && !isMobile3D()) {
    const startHero = () => {
      scheduleStage3DInit(() => {
        window.mountStage3D({
          stage: heroStage,
          toggle: document.getElementById('hero-shape-toggle-check'),
          toggleWrap: document.getElementById('hero-shape-toggle'),
          storageKey: 'hero3dObjectV2',
          defaultVariantId: 'sunstone',
          variants: [
            { id: 'emerald', label: 'Emerald', src: '/images/hero-emerald.v4.glb', exposure: 5.4, ambient: 6.2, key: 8.6, rim: 6.8, fill: 4.4 },
            { id: 'sunstone', label: 'Sunstone', src: '/images/hero-sunstone.v4.glb', exposure: 2.2, ambient: 1.2, key: 3.4, rim: 2.1, fill: 1.2 },
          ],
        });
      });
    };
    if (window.__portfolioWorkReady) {
      startHero();
    } else {
      document.addEventListener('portfolio:work-ready', startHero, { once: true });
      // Safety net if app.js fails to emit
      setTimeout(() => {
        if (!heroStage.querySelector('canvas')) startHero();
      }, 2500);
    }
  }
