/* Portfolio app logic */
function initNeuralVortexBackground() {
  const canvasEl = document.getElementById('ait-vortex-canvas');
  const sectionEl = canvasEl?.closest('.ai-transformation');
  if (!canvasEl || !sectionEl) return;

  const gl = canvasEl.getContext('webgl', { alpha: true, antialias: false }) ||
             canvasEl.getContext('experimental-webgl', { alpha: true, antialias: false });
  if (!gl) return;

  const pointer = {
    x: sectionEl.clientWidth * 0.5,
    y: sectionEl.clientHeight * 0.5,
    tX: sectionEl.clientWidth * 0.5,
    tY: sectionEl.clientHeight * 0.5,
  };
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let animationFrame = null;
  let isVisible = true;

  const vsSource = `
    precision mediump float;
    attribute vec2 a_position;
    varying vec2 vUv;
    void main() {
      vUv = .5 * (a_position + 1.);
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  const fsSource = `
    precision mediump float;
    varying vec2 vUv;
    uniform float u_time;
    uniform float u_ratio;
    uniform vec2 u_pointer_position;
    uniform float u_scroll_progress;

    vec2 rotate(vec2 uv, float th) {
      return mat2(cos(th), sin(th), -sin(th), cos(th)) * uv;
    }

    float neuro_shape(vec2 uv, float t, float p) {
      vec2 sine_acc = vec2(0.);
      vec2 res = vec2(0.);
      float scale = 8.;
      for (int j = 0; j < 15; j++) {
        uv = rotate(uv, 1.);
        sine_acc = rotate(sine_acc, 1.);
        vec2 layer = uv * scale + float(j) + sine_acc - t;
        sine_acc += sin(layer) + 2.4 * p;
        res += (.5 + .5 * cos(layer)) / scale;
        scale *= (1.2);
      }
      return res.x + res.y;
    }

    void main() {
      vec2 uv = .5 * vUv;
      uv.x *= u_ratio;
      vec2 pointer = vUv - u_pointer_position;
      pointer.x *= u_ratio;
      float p = clamp(length(pointer), 0., 1.);
      p = .5 * pow(1. - p, 2.);
      float t = .001 * u_time;
      vec3 color = vec3(0.);
      float noise = neuro_shape(uv, t, p);
      noise = 1.0 * pow(noise, 3.);
      noise += 0.55 * pow(noise, 10.);
      noise = max(.0, noise - .5);
      noise *= (1. - length(vUv - .5));
      color = vec3(0.04, 0.34, 0.24);
      color = mix(color, vec3(0.20, 0.62, 0.44), 0.22 + 0.10 * sin(2.0 * u_scroll_progress + 1.2));
      color += vec3(0.0, 0.36, 0.22) * sin(2.0 * u_scroll_progress + 1.5);
      color = color * noise;
      gl_FragColor = vec4(color, noise);
    }
  `;

  function compileShader(source, type) {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  const vertexShader = compileShader(vsSource, gl.VERTEX_SHADER);
  const fragmentShader = compileShader(fsSource, gl.FRAGMENT_SHADER);
  if (!vertexShader || !fragmentShader) return;

  const program = gl.createProgram();
  if (!program) return;
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
  gl.useProgram(program);

  const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
  const vertexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

  const positionLocation = gl.getAttribLocation(program, 'a_position');
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

  const uTime = gl.getUniformLocation(program, 'u_time');
  const uRatio = gl.getUniformLocation(program, 'u_ratio');
  const uPointerPosition = gl.getUniformLocation(program, 'u_pointer_position');
  const uScrollProgress = gl.getUniformLocation(program, 'u_scroll_progress');

  let sectionAbsoluteTop = 0;
  let sectionWidth = 0;
  let sectionHeight = 0;
  let sectionLeft = 0;
  function refreshSectionGeometry() {
    const rect = sectionEl.getBoundingClientRect();
    sectionAbsoluteTop = rect.top + window.scrollY;
    sectionWidth = rect.width;
    sectionHeight = rect.height;
    sectionLeft = rect.left;
  }

  function resizeCanvas() {
    refreshSectionGeometry();
    const dpr = 1; // cap to 1: noise pattern doesn't need retina, saves ~4x GPU on retina
    canvasEl.width = Math.max(1, Math.floor(sectionWidth * dpr));
    canvasEl.height = Math.max(1, Math.floor(sectionHeight * dpr));
    gl.viewport(0, 0, canvasEl.width, canvasEl.height);
    gl.uniform1f(uRatio, canvasEl.width / canvasEl.height);
  }

  function updatePointer(event) {
    if (!isVisible) return;
    const point = event.touches?.[0] || event;
    if (!point) return;
    pointer.tX = point.clientX - sectionLeft;
    pointer.tY = point.clientY - (sectionAbsoluteTop - window.scrollY);
  }

  function render() {
    const viewportTop = sectionAbsoluteTop - window.scrollY;
    const sectionProgress = (window.innerHeight - viewportTop) / (window.innerHeight + sectionHeight);
    const scrollProgress = Math.max(0, Math.min(1, sectionProgress));

    pointer.x += (pointer.tX - pointer.x) * 0.2;
    pointer.y += (pointer.tY - pointer.y) * 0.2;

    gl.uniform1f(uTime, performance.now());
    gl.uniform2f(
      uPointerPosition,
      pointer.x / Math.max(1, sectionWidth),
      1 - pointer.y / Math.max(1, sectionHeight)
    );
    gl.uniform1f(uScrollProgress, scrollProgress);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    if (!prefersReducedMotion && isVisible) {
      animationFrame = requestAnimationFrame(render);
    }
  }

  function start() {
    if (animationFrame || prefersReducedMotion) return;
    isVisible = true;
    render();
  }

  function stop() {
    isVisible = false;
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = null;
  }

  resizeCanvas();
  render();
  window.addEventListener('resize', resizeCanvas, { passive: true });
  window.addEventListener('pointermove', updatePointer, { passive: true });
  window.addEventListener('touchmove', updatePointer, { passive: true });

  if ('IntersectionObserver' in window && !prefersReducedMotion) {
    const observer = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting) start();
      else stop();
    }, { rootMargin: '160px' });
    observer.observe(sectionEl);
  }
}

// Defer canvas/WebGL setup (context creation, shader compile) until the
// section is close to the viewport — saves main-thread + GPU work at load.
function initWhenNearViewport(selector, init) {
  const el = document.querySelector(selector);
  if (!el) return;
  if (!('IntersectionObserver' in window)) { init(); return; }
  const observer = new IntersectionObserver(entries => {
    if (entries[0]?.isIntersecting) {
      observer.disconnect();
      init();
    }
  }, { rootMargin: '400px' });
  observer.observe(el);
}

function initAiProductsMatrix() {
  const canvasEl = document.getElementById('ai-products-matrix');
  const sectionEl = canvasEl?.closest('.ai-products-section');
  if (!canvasEl || !sectionEl) return;

  const ctx = canvasEl.getContext('2d', { alpha: true });
  if (!ctx) return;

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const glyphs = '01AI<>/{}[]UXLLM';
  let width = 0;
  let height = 0;
  let columns = [];
  let animationFrame = null;
  let isVisible = true;

  function resizeCanvas() {
    const rect = sectionEl.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    width = Math.max(1, Math.floor(rect.width));
    height = Math.max(1, Math.floor(rect.height));
    canvasEl.width = Math.floor(width * dpr);
    canvasEl.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const columnWidth = width < 640 ? 18 : 24;
    const count = Math.ceil(width / columnWidth);
    columns = Array.from({ length: count }, (_, index) => ({
      x: index * columnWidth + Math.random() * 8,
      y: Math.random() * height,
      speed: 0.35 + Math.random() * 1.1,
      size: width < 640 ? 10 : 12 + Math.random() * 4,
      alpha: 0.16 + Math.random() * 0.3,
    }));
  }

  function draw(now = 0) {
    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(4, 5, 10, 0.28)';
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'lighter';
    ctx.font = '600 12px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textBaseline = 'top';

    columns.forEach((column, columnIndex) => {
      const trail = width < 640 ? 12 : 18;
      for (let i = 0; i < trail; i++) {
        const y = (column.y - i * column.size * 1.35 + height) % height;
        const charIndex = (columnIndex + i + Math.floor(now / 160)) % glyphs.length;
        const alpha = column.alpha * (1 - i / trail);

        ctx.font = `600 ${column.size}px ui-monospace, SFMono-Regular, Menlo, monospace`;
        // Matrix green
        ctx.fillStyle = `rgba(0, 255, 65, ${alpha})`;
        ctx.fillText(glyphs[charIndex], column.x, y);
      }

      column.y += column.speed;
      if (column.y > height + trail * column.size) {
        column.y = -Math.random() * 140;
        column.speed = 0.35 + Math.random() * 1.1;
      }
    });

    const pulse = 0.2 + 0.1 * Math.sin(now / 900);
    const glow = ctx.createRadialGradient(width * 0.5, height * 0.28, 0, width * 0.5, height * 0.28, Math.max(width, height) * 0.58);
    glow.addColorStop(0, `rgba(0, 255, 65, ${pulse})`);
    glow.addColorStop(0.36, 'rgba(0, 255, 65, 0.04)');
    glow.addColorStop(1, 'rgba(4, 5, 10, 0)');
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    if (!prefersReducedMotion && isVisible) {
      animationFrame = requestAnimationFrame(draw);
    }
  }

  function start() {
    if (animationFrame || prefersReducedMotion) return;
    isVisible = true;
    draw();
  }

  function stop() {
    isVisible = false;
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = null;
  }

  resizeCanvas();
  draw();
  window.addEventListener('resize', () => {
    resizeCanvas();
    if (prefersReducedMotion || !animationFrame) draw();
  }, { passive: true });

  if ('IntersectionObserver' in window && !prefersReducedMotion) {
    const observer = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting) start();
      else stop();
    }, { rootMargin: '180px' });
    observer.observe(sectionEl);
  }
}

function isAnyModalOpen() {
  const ifaceOpen = document.getElementById('iface-modal')?.classList.contains('open');
  const storyOpen = document.getElementById('story-modal')?.classList.contains('open');
  const contactOpen = document.getElementById('contact-modal')?.classList.contains('is-open');
  return ifaceOpen || storyOpen || contactOpen;
}

/* ═══════════════════════════════════════════
   HERO STAT REPULSION
═══════════════════════════════════════════ */
const heroStatRepelItems = Array.from(document.querySelectorAll('.hero-stat')).map(el => ({
  el,
  x: 0,
  y: 0,
  r: 0,
  tx: 0,
  ty: 0,
  tr: 0,
}));
let heroStatRepelRaf = null;
const heroStatRepelMedia = window.matchMedia('(max-width: 900px)');
const heroStatReduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function resetHeroStatRepelTargets() {
  heroStatRepelItems.forEach(item => {
    item.tx = 0;
    item.ty = 0;
    item.tr = 0;
  });
  if (heroStatRepelItems.length && !heroStatRepelRaf) {
    heroStatRepelRaf = requestAnimationFrame(animateHeroStatRepel);
  }
}

function updateHeroStatRepel(clientX, clientY) {
  if (!heroStatRepelItems.length || heroStatRepelMedia.matches || heroStatReduceMotion.matches || isAnyModalOpen()) {
    resetHeroStatRepelTargets();
    return;
  }

  const radius = 168;
  const maxPush = 16;
  const maxRotate = 1.1;
  let hasMotion = false;

  heroStatRepelItems.forEach(item => {
    const rect = item.el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = cx - clientX;
    const dy = cy - clientY;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const strength = Math.max(0, 1 - distance / radius);
    const eased = strength * strength;

    item.tx = (dx / distance) * maxPush * eased;
    item.ty = (dy / distance) * maxPush * eased;
    item.tr = (item.tx / maxPush) * maxRotate * eased;
    hasMotion = hasMotion || eased > 0.001 || Math.abs(item.x) > 0.05 || Math.abs(item.y) > 0.05;
  });

  if (hasMotion && !heroStatRepelRaf) {
    heroStatRepelRaf = requestAnimationFrame(animateHeroStatRepel);
  }
}

function animateHeroStatRepel() {
  let keepGoing = false;
  heroStatRepelItems.forEach(item => {
    item.x += (item.tx - item.x) * 0.18;
    item.y += (item.ty - item.y) * 0.18;
    item.r += (item.tr - item.r) * 0.18;

    if (Math.abs(item.tx - item.x) < 0.02) item.x = item.tx;
    if (Math.abs(item.ty - item.y) < 0.02) item.y = item.ty;
    if (Math.abs(item.tr - item.r) < 0.01) item.r = item.tr;

    item.el.style.setProperty('--hero-stat-repel-x', `${item.x.toFixed(2)}px`);
    item.el.style.setProperty('--hero-stat-repel-y', `${item.y.toFixed(2)}px`);
    item.el.style.setProperty('--hero-stat-repel-rotate', `${item.r.toFixed(3)}deg`);

    keepGoing = keepGoing ||
      Math.abs(item.tx - item.x) > 0.02 ||
      Math.abs(item.ty - item.y) > 0.02 ||
      Math.abs(item.tr - item.r) > 0.01;
  });

  heroStatRepelRaf = keepGoing ? requestAnimationFrame(animateHeroStatRepel) : null;
}

document.addEventListener('mousemove', e => {
  updateHeroStatRepel(e.clientX, e.clientY);
}, { passive: true });

document.addEventListener('mouseleave', resetHeroStatRepelTargets);
window.addEventListener('scroll', resetHeroStatRepelTargets, { passive: true });

/* ═══════════════════════════════════════════
   ROUTER
═══════════════════════════════════════════ */
let projStage3DToken = 0;
let currentProjectId = null;

function disposeProjStages() {
  if (Array.isArray(window._projStage3DList)) {
    window._projStage3DList.forEach(s => { try { s?.dispose(); } catch {} });
  }
  window._projStage3DList = [];
}

function whenMethod3DReady(fn) {
  if (window.scheduleStage3DInit && window.mountMethodIcon3D) {
    window.scheduleStage3DInit(fn);
    return;
  }
  const started = Date.now();
  const tick = () => {
    if (window.scheduleStage3DInit && window.mountMethodIcon3D) {
      window.scheduleStage3DInit(fn);
      return;
    }
    if (Date.now() - started < 5000) requestAnimationFrame(tick);
  };
  tick();
}

function mountProjectMethodIcons(p, mountToken) {
  const steps = PROJECT_METHODS[p.id];
  if (!steps || !steps.length) return;
  if (window.matchMedia('(max-width: 768px)').matches) return;
  whenMethod3DReady(async () => {
    if (mountToken !== projStage3DToken) return;
    for (let i = 0; i < steps.length; i++) {
      const meta = METHOD_STEPS[steps[i].type];
      if (!meta) continue;
      const stage = document.getElementById(`method-stage-${i}`);
      if (!stage) continue;
      let instance = null;
      if (meta.src && window.mountStage3D) {
        const iso = stage.querySelector('.method-obj');
        if (iso) iso.hidden = true;
        instance = await window.mountStage3D({
          stage,
          variants: [{
            id: meta.id,
            label: meta.label.en,
            src: meta.src,
            exposure: 2.5,
            ambient: 1.3,
            key: 3.4,
            rim: 2.4,
            fill: 1.3,
          }],
          storageKey: `methodIcon_${meta.id}`,
          targetSize: 1.7,
        });
      } else if (window.mountMethodIcon3D) {
        instance = await window.mountMethodIcon3D({
          stage,
          type: meta.id,
        });
      }
      if (mountToken !== projStage3DToken) {
        instance?.dispose();
        return;
      }
      if (instance) window._projStage3DList.push(instance);
    }
  });
}

function goHome() {
  window.disconnectLazyVideos?.(document.getElementById('proj-page-content'));
  currentProjectId = null;
  projStage3DToken += 1;
  disposeProjStages();
  document.getElementById('view-home').classList.remove('hidden');
  document.getElementById('view-project').classList.add('hidden');
  document.getElementById('nav-links').style.display = '';
  window.scrollTo(0, 0);
  document.title = 'Hugo Vermot, Product Manager | AI Products';
  if (history.pushState) history.pushState(null, '', '#');
}

function openProject(id) {
  const p = publicProjects().find(x => x.id === id);
  if (!p) return;
  currentProjectId = id;
  projStage3DToken += 1;
  const mountToken = projStage3DToken;
  disposeProjStages();
  document.getElementById('view-home').classList.add('hidden');
  document.getElementById('nav-links').style.display = 'none';
  document.getElementById('proj-page-content').innerHTML = renderProject(p);
  document.getElementById('view-project').classList.remove('hidden');
  window.scrollTo(0, 0);
  document.title = `${p.company} | Hugo Vermot`;
  if (history.pushState) history.pushState(null, '', `#project/${id}`);
  if (p.models3d && p.models3d.variants && !window.matchMedia('(max-width: 768px)').matches) {
    window.scheduleStage3DInit?.(async () => {
      if (mountToken !== projStage3DToken) return;
      for (let i = 0; i < p.models3d.variants.length; i++) {
        const v = p.models3d.variants[i];
        const stage = document.getElementById(`aw-model-stage-${i}`);
        if (!stage) continue;
        const variant = {
          ...v,
          src: String(v.src || '').replace(/^\.\.\/images\//, '/images/'),
        };
        const instance = await window.mountStage3D({
          stage,
          variants: [variant],
          storageKey: `awModel_${v.id}`,
          rimColor: p.models3d.rimColor,
          fillColor: p.models3d.fillColor,
        });
        if (mountToken !== projStage3DToken) {
          instance?.dispose();
          return;
        }
        window._projStage3DList.push(instance);
      }
    });
  }
  mountProjectMethodIcons(p, mountToken);
  window.observeLazyVideos?.(document.getElementById('proj-page-content'));
}

function scrollToSection(anchor) {
  const el = document.querySelector(anchor);
  if (el) el.scrollIntoView({ behavior: 'smooth' });
}

function syncPageLock() {
  const ifaceOpen = document.getElementById('iface-modal')?.classList.contains('open');
  const storyOpen = document.getElementById('story-modal')?.classList.contains('open');
  const shouldLock = ifaceOpen || storyOpen;

  document.body.style.overflow = shouldLock ? 'hidden' : '';
  document.documentElement.style.overflow = shouldLock ? 'hidden' : '';

  const chatToggle = document.getElementById('hrhv-toggle-wrap');
  if (chatToggle) chatToggle.style.display = shouldLock ? 'none' : '';
}

/* ═══════════════════════════════════════════
   RENDER PROJECT DETAIL
═══════════════════════════════════════════ */
function renderTextBlockContent(b) {
  return `
    ${b.label ? `<div class="proj-n-label">${b.label}</div>` : ''}
    ${b.title ? `<div class="proj-n-title">${b.title}</div>` : ''}
    ${b.body  ? `<div class="proj-n-body">${b.body}</div>` : ''}`;
}

function groupNarrativeForLayout(blocks) {
  const grouped = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const next = blocks[i + 1];
    if (b.type === 'text' && next && next.type === 'text') {
      grouped.push({ kind: 'text-pair', blocks: [b, next] });
      i++;
    } else {
      grouped.push({ kind: 'single', block: b });
    }
  }
  return grouped;
}

function renderNarrativeItems(narrative, stepsHTML, p) {
  return groupNarrativeForLayout(narrative).map(item => {
    if (item.kind === 'text-pair') {
      return `<div class="proj-n-block proj-n-text-pair">
        <div class="proj-n-text-pair-col">${renderTextBlockContent(item.blocks[0])}</div>
        <div class="proj-n-text-pair-col">${renderTextBlockContent(item.blocks[1])}</div>
      </div>`;
    }
    return renderNarrativeBlock(item.block, stepsHTML, p);
  }).join('');
}

function renderNarrativeBlock(b, stepsHTML, p) {
  switch (b.type) {
    case 'text':
      return `<div class="proj-n-block">${renderTextBlockContent(b)}</div>`;
    case 'aw-models': {
      const variants = (p && p.models3d && p.models3d.variants) || [];
      return `<div class="proj-n-block">
        ${b.label ? `<div class="proj-n-label">${b.label}</div>` : ''}
        ${b.title ? `<div class="proj-n-title">${b.title}</div>` : ''}
        ${b.body  ? `<div class="proj-n-body">${b.body}</div>` : ''}
        <div class="aw-models">
          ${variants.map((v, i) => `
            <div class="aw-model-frame">
              <div class="aw-model-grid-bg"></div>
              <div class="aw-model-stage" id="aw-model-stage-${i}"></div>
              <div class="aw-model-label">
                <span class="aw-model-dot" style="color:${v.dot || '#fbbf24'}"></span>
                <span class="aw-model-name">${v.label}</span>
                <span class="aw-model-hint">Drag to rotate</span>
              </div>
            </div>`).join('')}
        </div>
      </div>`;
    }
    case 'image-full': {
      const imgCls = b.borderless ? ' proj-n-img--borderless' : '';
      const bleedCls = b.bleed ? ' proj-n-block--bleed' : '';
      const imgEl = `<img class="proj-n-img${imgCls}" src="${b.src}" alt="${b.caption||''}" loading="lazy" decoding="async">`;
      const inner = b.link
        ? `<a href="${b.link}" target="_blank" rel="noopener" class="proj-n-img-link" style="position:relative;display:block">${imgEl}</a>`
        : imgEl;

      if (b.bleed) {
        // Bleed images: wrapped with gradient masks to integrate into page
        if (b.caption) {
          // Has caption: side-by-side layout on desktop (image + caption column)
          return `<div class="proj-n-block${bleedCls}">
            <div class="proj-n-bleed-split">
              <div class="proj-n-bleed-wrap">
                <div class="proj-n-bleed-fade-top"></div>
                <div class="proj-n-bleed-fade-bot"></div>
                ${inner}
              </div>
              <div class="proj-n-bleed-split-text">
                <div class="proj-n-bleed-split-caption">${b.caption}</div>
              </div>
            </div>
          </div>`;
        } else {
          // No caption: contained image with gradient side+top/bottom masks
          return `<div class="proj-n-block${bleedCls}">
            <div class="proj-n-bleed-wrap">
              <div class="proj-n-bleed-fade-top"></div>
              <div class="proj-n-bleed-fade-bot"></div>
              ${inner}
            </div>
          </div>`;
        }
      }

      // Non-bleed: standard rendering
      return `<div class="proj-n-block${bleedCls}">
        ${b.caption ? `<div class="proj-n-bleed-split"><div>${inner}</div><div class="proj-n-bleed-split-text"><div class="proj-n-bleed-split-caption">${b.caption}</div></div></div>` : inner}
        ${b.caption ? '' : ''}
      </div>`;
    }
    case 'browser-window': {
      // A web-window chrome whose viewport scrolls through a full-length page screenshot.
      // With b.srcAlt set, a CSS-only Dark / White switch in the chrome bar swaps the capture.
      const url = b.url || '';
      if (b.srcAlt) {
        const tid = 'bw-' + b.src.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');
        return `<div class="proj-n-block">
          <div class="browser-window">
            <input type="checkbox" id="${tid}" class="bw-toggle-input" checked aria-label="Switch the marketing site between its dark and white themes">
            <div class="browser-bar">
              <span class="browser-dots"><i></i><i></i><i></i></span>
              <span class="browser-url-wrap">${url ? `<span class="browser-url">${url}</span>` : ''}</span>
              <label class="bw-seg" for="${tid}" title="Toggle the marketing site theme">
                <span class="bw-seg-opt bw-seg-opt--dark">Dark</span>
                <span class="bw-seg-opt bw-seg-opt--light">White</span>
              </label>
            </div>
            <div class="browser-viewport">
              <img class="bw-img bw-img--dark" src="${b.src}" alt="${b.caption || ''}" loading="lazy" decoding="async">
              <img class="bw-img bw-img--light" src="${b.srcAlt}" alt="${b.caption ? b.caption + ' (white theme)' : 'White theme'}" loading="lazy" decoding="async">
            </div>
          </div>
          ${b.caption ? `<div class="proj-n-caption">${b.caption}</div>` : ''}
        </div>`;
      }
      return `<div class="proj-n-block">
        <div class="browser-window">
          <div class="browser-bar">
            <span class="browser-dots"><i></i><i></i><i></i></span>
            <span class="browser-url-wrap">${url ? `<span class="browser-url">${url}</span>` : ''}</span>
            <span class="browser-bar-spacer"></span>
          </div>
          <div class="browser-viewport">
            <img src="${b.src}" alt="${b.caption || ''}" loading="lazy" decoding="async">
          </div>
        </div>
        ${b.caption ? `<div class="proj-n-caption">${b.caption}</div>` : ''}
      </div>`;
    }
    case 'video': {
      const bleedCls = b.bleed ? ' proj-n-block--bleed' : '';
      return `<div class="proj-n-block${bleedCls}">
        <video class="proj-n-video js-lazy-video" data-src="${b.src}" muted loop playsinline preload="none"></video>
        ${b.caption && !b.bleed ? `<div class="proj-n-caption">${b.caption}</div>` : ''}
      </div>`;
    }
    case 'image-grid': {
      const mod = b.modifier ? ` proj-n-grid-2--${b.modifier}` : '';
      const imgCls = b.borderless ? ' proj-n-img--borderless' : '';
      return `<div class="proj-n-block">
        ${b.label ? `<div class="proj-n-label">${b.label}</div>` : ''}
        <div class="proj-n-grid-2${mod}">
          ${b.images.map(img => `
            <div class="proj-n-grid-item">
              <img class="proj-n-img${imgCls}" src="${img.src}" alt="${img.caption||''}" loading="lazy" decoding="async">
              ${img.caption ? `<div class="proj-n-caption">${img.caption}</div>` : ''}
            </div>`).join('')}
        </div>
      </div>`;
    }
    case 'tiles':
      return `<div class="proj-n-block">
        ${b.label ? `<div class="proj-n-label">${b.label}</div>` : ''}
        <div class="proj-n-tiles">
          ${b.images.map(img => `
            <div class="proj-n-tile">
              <img src="${img.src}" alt="${img.caption||''}" loading="lazy" decoding="async">
            </div>`).join('')}
        </div>
        ${b.caption ? `<div class="proj-n-caption" style="margin-top:12px">${b.caption}</div>` : ''}
      </div>`;
    case 'image-bg':
      return `<div class="proj-n-block" style="padding:0; border-top:1px solid var(--rule)">
        <div class="proj-n-bg" style="background-image:url(${b.src})">
          <div class="proj-n-bg-inner">
            ${b.label ? `<div class="proj-n-label">${b.label}</div>` : ''}
            ${b.title ? `<div class="proj-n-title">${b.title}</div>` : ''}
            ${b.body  ? `<div class="proj-n-body">${b.body}</div>` : ''}
          </div>
        </div>
      </div>`;
    case 'text-image': {
      const tiImgCls = b.borderless ? ' proj-n-img--borderless' : '';
      return `<div class="proj-n-block">
        <div class="proj-n-text-image${b.flip ? ' flip' : ''}">
          <div>
            ${b.label ? `<div class="proj-n-label">${b.label}</div>` : ''}
            ${b.title ? `<div class="proj-n-title">${b.title}</div>` : ''}
            ${b.body  ? `<div class="proj-n-body">${b.body}</div>` : ''}
          </div>
          <div>
            <img class="proj-n-img${tiImgCls}" src="${b.src}" alt="${b.caption||''}" loading="lazy" decoding="async">
            ${b.caption ? `<div class="proj-n-caption">${b.caption}</div>` : ''}
          </div>
        </div>
      </div>`;
    }
    case 'before-after':
      return `<div class="proj-n-block">
        ${b.label ? `<div class="proj-n-label">${b.label}</div>` : ''}
        <div class="proj-before-after">
          ${b.images.map(img => `
            <div class="proj-ba-item">
              <span class="proj-ba-tag ${img.label.toLowerCase()}">${img.label}</span>
              <img class="proj-ba-img" src="${img.src}" alt="${img.label}" loading="lazy" decoding="async">
              ${img.caption ? `<div class="proj-n-caption">${img.caption}</div>` : ''}
            </div>`).join('')}
        </div>
      </div>`;
    case 'schema-split': {
      const flip = b.flip ? ' flip' : '';
      return `<div class="proj-n-block">
        <div class="proj-n-schema-split${flip}">
          <div class="proj-n-schema-visual">${b.visual || ''}</div>
          <div class="proj-n-schema-text">
            ${b.label ? `<div class="proj-n-label">${b.label}</div>` : ''}
            ${b.title ? `<div class="proj-n-schema-title">${b.title}</div>` : ''}
            ${b.body  ? `<div class="proj-n-body">${b.body}</div>` : ''}
          </div>
        </div>
      </div>`;
    }
    case 'panfy-screenshots':
      return `<div class="proj-n-block panfy-section">
        <div class="panfy-section-head">
          <div>
            ${b.label ? `<div class="proj-n-label">${b.label}</div>` : ''}
            ${b.title ? `<div class="proj-n-title">${b.title}</div>` : ''}
            ${b.body ? `<div class="proj-n-body">${b.body}</div>` : ''}
          </div>
          <div class="panfy-section-kpis">
            <div class="panfy-mini-kpi"><span>Source</span><strong>HL</strong><em>Live feed</em></div>
            <div class="panfy-mini-kpi"><span>Mode</span><strong>AI</strong><em>Signals layer</em></div>
            <div class="panfy-mini-kpi"><span>Token</span><strong>$PAN</strong><em>Ecosystem layer</em></div>
          </div>
        </div>
        <div class="panfy-screens panfy-screens--full">
          ${(b.images || []).map(img => `
            <a class="panfy-screen-card" href="${img.src}" target="_blank" rel="noopener">
              <img src="${img.src}" alt="${img.caption || img.title || 'Panfy screenshot'}" loading="lazy" decoding="async">
              <div class="panfy-screen-caption"><strong>${img.title || 'Panfy screen'}</strong>${img.caption || ''}</div>
            </a>`).join('')}
        </div>
      </div>`;
    case 'panfy-flow':
      return `<div class="proj-n-block panfy-section">
        <div class="panfy-section-head">
          <div>
            ${b.label ? `<div class="proj-n-label">${b.label}</div>` : ''}
            ${b.title ? `<div class="proj-n-title">${b.title}</div>` : ''}
            ${b.body ? `<div class="proj-n-body">${b.body}</div>` : ''}
          </div>
          <div class="panfy-chip-row">
            <span class="panfy-chip green">HyperLiquid API</span>
            <span class="panfy-chip">Market regime</span>
            <span class="panfy-chip red">Risk flags</span>
            <span class="panfy-chip">Trader ranking</span>
          </div>
        </div>
        <div class="panfy-panel">
          <div class="panfy-panel-top">
            <div class="panfy-panel-title"><span class="panfy-led"></span> PANFY Intelligence Pipeline</div>
            <div class="panfy-chip-row"><span class="panfy-chip green">Streaming</span><span class="panfy-chip">Decision ready</span></div>
          </div>
          <div class="panfy-flow">
            <div class="panfy-flow-card">
              <div class="panfy-flow-num">01 · ingest</div>
              <div class="panfy-flow-title">Live market data</div>
              <div class="panfy-flow-desc">Prices, 24h changes, volume, market cap, BTC dominance and Fear & Greed are normalized into one market state.</div>
              <div class="panfy-bars"><span class="panfy-bar"><i style="--w:82%"></i></span><span class="panfy-bar"><i style="--w:56%"></i></span><span class="panfy-bar"><i style="--w:68%"></i></span></div>
            </div>
            <div class="panfy-flow-card">
              <div class="panfy-flow-num">02 · map</div>
              <div class="panfy-flow-title">Hyperliquid context</div>
              <div class="panfy-flow-desc">Top traders, token lists, gainer/loser tables and ecosystem movements are mapped to actionable context.</div>
              <div class="panfy-bars"><span class="panfy-bar"><i style="--w:72%"></i></span><span class="panfy-bar"><i style="--w:89%"></i></span><span class="panfy-bar"><i style="--w:48%"></i></span></div>
            </div>
            <div class="panfy-flow-card">
              <div class="panfy-flow-num">03 · score</div>
              <div class="panfy-flow-title">AI signal layer</div>
              <div class="panfy-flow-desc">The AI layer classifies trend quality, volatility pressure, momentum, RSI/MACD states and opportunity windows.</div>
              <div class="panfy-bars"><span class="panfy-bar"><i style="--w:92%"></i></span><span class="panfy-bar"><i style="--w:61%"></i></span><span class="panfy-bar"><i style="--w:78%"></i></span></div>
            </div>
            <div class="panfy-flow-card">
              <div class="panfy-flow-num">04 · act</div>
              <div class="panfy-flow-title">Trading decision UI</div>
              <div class="panfy-flow-desc">Signals become a fast interface: dashboard, technical analysis, Hyperliquid depth, AI opportunities and token intelligence.</div>
              <div class="panfy-bars"><span class="panfy-bar"><i style="--w:76%"></i></span><span class="panfy-bar"><i style="--w:58%"></i></span><span class="panfy-bar"><i style="--w:86%"></i></span></div>
            </div>
          </div>
        </div>
      </div>`;
    case 'panfy-analysis':
      return `<div class="proj-n-block panfy-section">
        <div class="panfy-section-head">
          <div>
            ${b.label ? `<div class="proj-n-label">${b.label}</div>` : ''}
            ${b.title ? `<div class="proj-n-title">${b.title}</div>` : ''}
            ${b.body ? `<div class="proj-n-body">${b.body}</div>` : ''}
          </div>
          <div class="panfy-section-kpis">
            <div class="panfy-mini-kpi"><span>RSI</span><strong>43.0</strong><em>Neutral</em></div>
            <div class="panfy-mini-kpi"><span>MACD</span><strong>-0.0007</strong><em>Bearish</em></div>
            <div class="panfy-mini-kpi"><span>Depth</span><strong>0.32</strong><em class="red">Sell pressure</em></div>
          </div>
        </div>
        <div class="panfy-panel">
          <div class="panfy-panel-top">
            <div class="panfy-panel-title"><span class="panfy-led"></span> Technical + AI Console</div>
            <div class="panfy-chip-row"><span class="panfy-chip green">Hover cards</span><span class="panfy-chip">Click tabs</span></div>
          </div>
          <div class="panfy-analysis">
            <div class="panfy-tabs">
              <input id="panfy-tab-market" name="panfy-analysis-tab" type="radio" checked>
              <input id="panfy-tab-tech" name="panfy-analysis-tab" type="radio">
              <input id="panfy-tab-ai" name="panfy-analysis-tab" type="radio">
              <label for="panfy-tab-market">Market</label>
              <label for="panfy-tab-tech">Technical</label>
              <label for="panfy-tab-ai">AI analysis</label>
              <div class="panfy-analysis-content">
                <div class="panfy-tab-panel panfy-chart market">
                  ${Array.from({length:18}).map((_, i) => `<i class="panfy-candle" style="--h:${[34,58,82,68,104,76,116,88,62,96,70,44,60,48,72,38,54,90][i]}%;--c:${i % 3 === 0 ? '#ff3752' : '#05d092'};--d:${i * .04}s"></i>`).join('')}
                </div>
                <div class="panfy-tab-panel panfy-chart tech">
                  ${Array.from({length:18}).map((_, i) => `<i class="panfy-candle" style="--h:${[72,66,58,52,49,46,43,41,38,36,34,29,25,31,28,33,37,42][i]}%;--c:${i > 10 ? '#ff3752' : '#05d092'};--d:${i * .04}s"></i>`).join('')}
                </div>
                <div class="panfy-tab-panel panfy-chart ai">
                  ${Array.from({length:18}).map((_, i) => `<i class="panfy-candle" style="--h:${[42,46,51,55,61,64,69,74,79,76,72,68,70,75,81,86,82,88][i]}%;--c:${i % 4 === 0 ? '#ffb74a' : '#22ff4b'};--d:${i * .04}s"></i>`).join('')}
                </div>
                <div class="panfy-side-stack">
                  <div class="panfy-price-card">
                    <span>Current price</span>
                    <strong>$61,752.50</strong>
                    <div class="panfy-depth">
                      <div>Bid depth <b>42.18</b></div>
                      <div>Ask depth <b>130.36</b></div>
                    </div>
                  </div>
                  <div class="panfy-signal-card">
                    <span>Signal stack</span>
                    <div class="panfy-signal-list">
                      <div class="panfy-signal-row"><b>RSI (14)</b><em class="panfy-badge blue">Neutral</em></div>
                      <div class="panfy-signal-row"><b>MACD</b><em class="panfy-badge red">Bearish</em></div>
                      <div class="panfy-signal-row"><b>Bollinger</b><em class="panfy-badge">Tight</em></div>
                      <div class="panfy-signal-row"><b>Opportunity</b><em class="panfy-badge green">Watch</em></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>`;
    case 'creads-vitrine':
      return `<div class="proj-n-block creads-section">
        <div class="creads-section-head">
          <div>
            ${b.label ? `<div class="proj-n-label">${b.label}</div>` : ''}
            ${b.title ? `<div class="proj-n-title">${b.title}</div>` : ''}
            ${b.body ? `<div class="proj-n-body">${b.body}</div>` : ''}
          </div>
          <div class="creads-section-kpis">
            <div class="creads-mini-kpi"><span>Pages</span><strong>95</strong><em>Marketing + app</em></div>
            <div class="creads-mini-kpi"><span>Components</span><strong>260+</strong><em class="purple">React · Next 15</em></div>
            <div class="creads-mini-kpi"><span>Version</span><strong>1.7.0</strong><em>Live · creads.io</em></div>
          </div>
        </div>
        <div class="creads-panel">
          <div class="creads-panel-top">
            <div class="creads-panel-title"><span class="creads-led"></span> creads.io — Landing hero</div>
            <div class="creads-chip-row"><span class="creads-chip green">Live recreation</span><span class="creads-chip">Hover the ads</span></div>
          </div>
          <div class="creads-hero">
            <div class="creads-hero-badge">-20% launch offer</div>
            <h3 class="creads-hero-h1">Generate creative <span class="creads-hero-word"><span>Ads</span><span>Brief</span><span>Video</span><span>Image</span></span><br>Made for your business</h3>
            <p class="creads-hero-sub">Use your brand information to generate creative briefs and ad visuals. Review each output against the brief before using it.</p>
            <div class="creads-hero-ctas">
              <a class="creads-btn primary" href="https://www.creads.io/" target="_blank" rel="noopener">Create Ads</a>
              <a class="creads-btn ghost" href="https://www.creads.io/" target="_blank" rel="noopener">Book demo</a>
            </div>
          </div>
          <div class="creads-hero-strip">
            <div class="creads-ad-tile edge" style="background:linear-gradient(135deg,#f43f5e,#ec4899)"><span>Fashion</span></div>
            <div class="creads-ad-tile" style="background:linear-gradient(135deg,#3b82f6,#8b5cf6)"><span>E-Commerce</span></div>
            <div class="creads-ad-tile" style="background:linear-gradient(135deg,#10b981,#0d9488)"><span>Wellness</span></div>
            <div class="creads-ad-tile center" style="background:linear-gradient(135deg,#a855f7,#ec4899)"><span>Beauty</span></div>
            <div class="creads-ad-tile" style="background:linear-gradient(135deg,#f59e0b,#ef4444)"><span>Food & Bev</span></div>
            <div class="creads-ad-tile" style="background:linear-gradient(135deg,#6366f1,#2563eb)"><span>Tech</span></div>
            <div class="creads-ad-tile edge" style="background:linear-gradient(135deg,#10b981,#3b82f6)"><span>SaaS</span></div>
          </div>
        </div>
      </div>`;
    case 'creads-brand':
      return `<div class="proj-n-block creads-section">
        <div class="creads-section-head">
          <div>
            ${b.label ? `<div class="proj-n-label">${b.label}</div>` : ''}
            ${b.title ? `<div class="proj-n-title">${b.title}</div>` : ''}
            ${b.body ? `<div class="proj-n-body">${b.body}</div>` : ''}
          </div>
          <div class="creads-section-kpis">
            <div class="creads-mini-kpi"><span>Radius</span><strong>2px</strong><em>Sharp by design</em></div>
            <div class="creads-mini-kpi"><span>Surfaces</span><strong>#050505</strong><em class="purple">Dark-first</em></div>
            <div class="creads-mini-kpi"><span>Typefaces</span><strong>×3</strong><em>Sansation · Readex · TikTok</em></div>
          </div>
        </div>
        <div class="creads-panel">
          <div class="creads-panel-top">
            <div class="creads-panel-title"><span class="creads-led"></span> Creads Design System</div>
            <div class="creads-chip-row"><span class="creads-chip green">Agent status</span><span class="creads-chip purple">AI logic</span><span class="creads-chip">Glass blur</span></div>
          </div>
          <div class="creads-brand-grid">
            <div class="creads-brand-col">
              <div class="creads-brand-card">
                <div class="creads-brand-card-label">Color system · Deep space</div>
                <div class="creads-swatches">
                  <div class="creads-swatch"><i style="--c:#050505"></i><b>Void</b><small>#050505</small></div>
                  <div class="creads-swatch"><i style="--c:#0a0a0a"></i><b>Surface</b><small>#0a0a0a</small></div>
                  <div class="creads-swatch"><i style="--c:#141414"></i><b>Hover</b><small>#141414</small></div>
                  <div class="creads-swatch"><i style="--c:#1e1e1e"></i><b>Border</b><small>#1e1e1e</small></div>
                  <div class="creads-swatch"><i style="--c:#f0f0f0"></i><b>Text</b><small>#f0f0f0</small></div>
                  <div class="creads-swatch"><i style="--c:#a0a0a0"></i><b>Muted</b><small>#a0a0a0</small></div>
                  <div class="creads-swatch glow"><i style="--c:#34d399;--g:rgba(5,5,5,.45)"></i><b>Agent</b><small>#34d399</small></div>
                  <div class="creads-swatch glow"><i style="--c:#a855f7;--g:rgba(5,5,5,.45)"></i><b>AI logic</b><small>#a855f7</small></div>
                </div>
              </div>
              <div class="creads-brand-card">
                <div class="creads-brand-card-label">Logo · White on void</div>
                <div class="creads-logo-tile"><img src="../images/creads-logo.webp" alt="Creads logo" loading="lazy" decoding="async"></div>
              </div>
            </div>
            <div class="creads-brand-col">
              <div class="creads-brand-card">
                <div class="creads-brand-card-label">Typography</div>
                <div class="creads-type-row">
                  <div class="creads-type-sample sansation">Creative Director</div>
                  <div class="creads-type-meta"><b>Sansation</b><small>Bold italic · titles</small></div>
                </div>
                <div class="creads-type-row">
                  <div class="creads-type-sample readex">Brand DNA, decoded</div>
                  <div class="creads-type-meta"><b>Readex Pro</b><small>400 / 600 · display</small></div>
                </div>
                <div class="creads-type-row">
                  <div class="creads-type-sample tiktok">Generate. Score. Learn.</div>
                  <div class="creads-type-meta"><b>TikTok Sans</b><small>Body · UI</small></div>
                </div>
              </div>
              <div class="creads-brand-card">
                <div class="creads-brand-card-label">Tokens</div>
                <div class="creads-tokens">
                  <div class="creads-token">
                    <div class="creads-token-demo"><div style="width:34px;height:34px;border-radius:2px;border:1px solid #34d399;background:#141414"></div></div>
                    <b>Radius</b><small>2px everywhere</small>
                  </div>
                  <div class="creads-token">
                    <div class="creads-token-demo"><div style="width:52px;height:34px;border-radius:2px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.06);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)"></div></div>
                    <b>Glass</b><small>blur · white .08</small>
                  </div>
                  <div class="creads-token">
                    <div class="creads-token-demo"><div style="width:56px;height:18px;border-radius:2px;background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,0));border:1px solid #1e1e1e"></div></div>
                    <b>Glow</b><small>top gradient</small>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>`;
    case 'creads-console':
      return `<div class="proj-n-block creads-section">
        <div class="creads-section-head">
          <div>
            ${b.label ? `<div class="proj-n-label">${b.label}</div>` : ''}
            ${b.title ? `<div class="proj-n-title">${b.title}</div>` : ''}
            ${b.body ? `<div class="proj-n-body">${b.body}</div>` : ''}
          </div>
          <div class="creads-section-kpis">
            <div class="creads-mini-kpi"><span>Memory</span><strong>5,000</strong><em class="purple">Tokens · 6 modules</em></div>
            <div class="creads-mini-kpi"><span>Smart Match</span><strong>87/100</strong><em>Quality gate: pass</em></div>
            <div class="creads-mini-kpi"><span>Render styles</span><strong>×5</strong><em>Flux · Seedream</em></div>
          </div>
        </div>
        <div class="creads-panel">
          <div class="creads-panel-top">
            <div class="creads-panel-title"><span class="creads-led"></span> Creative Intelligence Console</div>
            <div class="creads-chip-row"><span class="creads-chip green">Click tabs</span><span class="creads-chip">3 surfaces</span></div>
          </div>
          <div class="creads-console">
            <div class="creads-tabs">
              <input id="creads-tab-dna" name="creads-console-tab" type="radio" checked>
              <input id="creads-tab-match" name="creads-console-tab" type="radio">
              <input id="creads-tab-gen" name="creads-console-tab" type="radio">
              <label for="creads-tab-dna">Brand DNA</label>
              <label for="creads-tab-match">Smart Match</label>
              <label for="creads-tab-gen">Generation</label>
              <div class="creads-console-content">
                <div class="creads-tab-panel creads-terminal dna">
                  <div class="creads-term-line" style="--d:.1s"><b class="t-cmd">➜</b> creads crawl https://yourbrand.com</div>
                  <div class="creads-term-line" style="--d:.5s"><b class="t-info">ℹ</b> 42 pages parsed · products, reviews, tone of voice</div>
                  <div class="creads-term-line" style="--d:.9s"><b class="t-ok">✔</b> business type classified · positioning mapped</div>
                  <div class="creads-term-line" style="--d:1.3s"><b class="t-ok">✔</b> visual identity extracted — palettes, type, codes</div>
                  <div class="creads-term-line" style="--d:1.7s"><b class="t-ok">✔</b> 3 personas: Ideal Buyer · Rational Skeptic · Status Seeker</div>
                  <div class="creads-term-line" style="--d:2.1s"><b class="t-cmd">➜</b> writing agent memory … 6 modules · 5,000 tokens</div>
                  <div class="creads-term-line" style="--d:2.5s"><b class="t-ok">✔</b> BRAND_DB: CONNECTED — ready in 3m42s <span class="creads-cursor"></span></div>
                </div>
                <div class="creads-tab-panel creads-axes match">
                  <div class="creads-axis"><span>Hook <b>92</b></span><div class="creads-axis-bar"><i style="--w:92%;--d:.05s"></i></div></div>
                  <div class="creads-axis"><span>Concept <b>84</b></span><div class="creads-axis-bar"><i style="--w:84%;--d:.15s"></i></div></div>
                  <div class="creads-axis"><span>Emotion <b>88</b></span><div class="creads-axis-bar"><i style="--w:88%;--d:.25s"></i></div></div>
                  <div class="creads-axis"><span>Bias <b>76</b></span><div class="creads-axis-bar"><i style="--w:76%;--d:.35s"></i></div></div>
                  <div class="creads-axis"><span>Wording <b>90</b></span><div class="creads-axis-bar"><i style="--w:90%;--d:.45s"></i></div></div>
                  <div class="creads-axis"><span>Composition <b>81</b></span><div class="creads-axis-bar"><i style="--w:81%;--d:.55s"></i></div></div>
                </div>
                <div class="creads-tab-panel creads-gen gen">
                  <div class="creads-ad-mock">
                    <div class="creads-ad-mock-tag">A/B · V2 — Feed 4:5</div>
                    <div>
                      <div class="creads-ad-mock-head">JUST<br>DO IT.</div>
                      <div class="creads-ad-mock-sub">Engineered for the morning run.</div>
                    </div>
                    <div class="creads-ad-mock-foot"><i style="background:#ff4d4d"></i><i style="background:#f0f0f0"></i><i style="background:#34d399"></i><span>nike.com</span></div>
                  </div>
                  <div class="creads-gen-meta">
                    <div class="creads-gen-meta-label">Render styles</div>
                    <div class="creads-chip-row"><span class="creads-chip green">Photographic</span><span class="creads-chip">3D</span><span class="creads-chip">Illustration</span><span class="creads-chip">Hybrid</span><span class="creads-chip">Infographic</span></div>
                    <div class="creads-gen-meta-label">Formats</div>
                    <div class="creads-chip-row"><span class="creads-chip">Feed 1:1</span><span class="creads-chip green">Feed 4:5</span><span class="creads-chip">Stories 9:16</span><span class="creads-chip">Reels</span></div>
                    <div class="creads-gen-meta-label">Engine</div>
                    <div class="creads-chip-row"><span class="creads-chip purple">fal.ai Flux</span><span class="creads-chip">Seedream 4.0</span><span class="creads-chip">Overlay compositor</span></div>
                  </div>
                </div>
                <div class="creads-side-stack">
                  <div class="creads-score-card">
                    <span>Smart Match score</span>
                    <strong class="creads-score-val">87<small style="font-size:14px;-webkit-text-fill-color:#787878">/100</small></strong>
                    <div class="creads-gate">Quality gate <b>PASS — to production</b></div>
                  </div>
                  <div class="creads-plan-card">
                    <span>Plans & credits</span>
                    <div class="creads-plan-row"><b>Free</b><em class="creads-badge">5 credits</em></div>
                    <div class="creads-plan-row"><b>Starter</b><em class="creads-badge green">100 credits</em></div>
                    <div class="creads-plan-row"><b>Professional</b><em class="creads-badge purple">500 credits</em></div>
                    <div class="creads-plan-row"><b>Yearly billing</b><em class="creads-badge">−20%</em></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>`;
    case 'upviral-vitrine':
      return `<div class="proj-n-block upviral-section">
        <div class="upviral-section-head">
          <div>
            ${b.label ? `<div class="proj-n-label">${b.label}</div>` : ''}
            ${b.title ? `<div class="proj-n-title">${b.title}</div>` : ''}
            ${b.body ? `<div class="proj-n-body">${b.body}</div>` : ''}
          </div>
          <div class="upviral-section-kpis">
            <div class="upviral-mini-kpi"><span>Businesses</span><strong>32,600</strong><em>Active customers</em></div>
            <div class="upviral-mini-kpi"><span>Leads generated</span><strong>72.7M</strong><em class="purple">Across campaigns</em></div>
            <div class="upviral-mini-kpi"><span>Trial</span><strong>$1</strong><em>Risk-free entry</em></div>
          </div>
        </div>
        <div class="upviral-panel">
          <div class="upviral-panel-top">
            <div class="upviral-panel-title"><span class="upviral-led"></span> upviral.com — Landing hero</div>
            <div class="upviral-chip-row"><span class="upviral-chip teal">Live recreation</span><span class="upviral-chip">Hover the campaigns</span></div>
          </div>
          <div class="upviral-hero">
            <div class="upviral-hero-badge">Risk-free trial — only $1</div>
            <h3 class="upviral-hero-h1">Join <em>32,600</em> businesses who have generated <em class="purple">72,786,714</em> leads with UpViral</h3>
            <p class="upviral-hero-sub">Build referral campaigns with templates, a drag-and-drop editor, four presentation styles and referral tracking.</p>
            <div class="upviral-hero-ctas">
              <a class="upviral-btn primary" href="https://upviral.com" target="_blank" rel="noopener">Get started for only $1</a>
              <a class="upviral-btn ghost" href="https://upviral.com" target="_blank" rel="noopener">Check out live examples</a>
            </div>
          </div>
          <div class="upviral-camp-strip">
            <div class="upviral-camp-tile" style="--c:#1bbcbd"><i></i>Sweepstakes</div>
            <div class="upviral-camp-tile" style="--c:#6d60b0"><i></i>Giveaway</div>
            <div class="upviral-camp-tile" style="--c:#c75080"><i></i>Waitlist</div>
            <div class="upviral-camp-tile" style="--c:#f59e0b"><i></i>Product launch</div>
            <div class="upviral-camp-tile" style="--c:#3b82f6"><i></i>Seasonal</div>
            <div class="upviral-camp-tile" style="--c:#10b981"><i></i>Fill your event</div>
            <div class="upviral-camp-tile" style="--c:#8b5cf6"><i></i>Newsletter</div>
          </div>
        </div>
      </div>`;
    case 'upviral-brand':
      return `<div class="proj-n-block upviral-section">
        <div class="upviral-section-head">
          <div>
            ${b.label ? `<div class="proj-n-label">${b.label}</div>` : ''}
            ${b.title ? `<div class="proj-n-title">${b.title}</div>` : ''}
            ${b.body ? `<div class="proj-n-body">${b.body}</div>` : ''}
          </div>
          <div class="upviral-section-kpis">
            <div class="upviral-mini-kpi"><span>Typeface</span><strong>Poppins</strong><em>400 – 900</em></div>
            <div class="upviral-mini-kpi"><span>Site primary</span><strong>#1bbcbd</strong><em class="purple">App: #6d60b0</em></div>
            <div class="upviral-mini-kpi"><span>Shape</span><strong>Rounded</strong><em>Pills · 12px cards</em></div>
          </div>
        </div>
        <div class="upviral-panel">
          <div class="upviral-panel-top">
            <div class="upviral-panel-title"><span class="upviral-led"></span> UpViral Design System</div>
            <div class="upviral-chip-row"><span class="upviral-chip teal">Site: teal</span><span class="upviral-chip purple">App: violet</span><span class="upviral-chip">Soft shadows</span></div>
          </div>
          <div class="upviral-brand-grid">
            <div class="upviral-brand-col">
              <div class="upviral-brand-card">
                <div class="upviral-brand-card-label">Color system · Light-first</div>
                <div class="upviral-swatches">
                  <div class="upviral-swatch"><i style="--c:#1bbcbd"></i><b>Teal</b><small>#1bbcbd</small></div>
                  <div class="upviral-swatch"><i style="--c:#6d60b0"></i><b>Violet</b><small>#6d60b0</small></div>
                  <div class="upviral-swatch"><i style="--c:#c75080"></i><b>Raspberry</b><small>#c75080</small></div>
                  <div class="upviral-swatch"><i style="--c:#283848"></i><b>Navy ink</b><small>#283848</small></div>
                  <div class="upviral-swatch"><i style="--c:#b6c3cf"></i><b>Cloud</b><small>#b6c3cf</small></div>
                  <div class="upviral-swatch"><i style="--c:#eef2f7;border-bottom:1px solid rgba(40,56,72,.08)"></i><b>Canvas</b><small>#eef2f7</small></div>
                </div>
              </div>
              <div class="upviral-brand-card">
                <div class="upviral-brand-card-label">Logo · On light canvas</div>
                <div class="upviral-logo-tile"><img src="../images/upviral.png" alt="UpViral logo" loading="lazy" decoding="async"></div>
              </div>
            </div>
            <div class="upviral-brand-col">
              <div class="upviral-brand-card">
                <div class="upviral-brand-card-label">Typography · Poppins</div>
                <div class="upviral-type-row">
                  <div class="upviral-type-sample w800">Grow your list forever</div>
                  <div class="upviral-type-meta"><b>Poppins 800</b><small>Hero · headlines</small></div>
                </div>
                <div class="upviral-type-row">
                  <div class="upviral-type-sample w600">Drag, drop, go viral.</div>
                  <div class="upviral-type-meta"><b>Poppins 600</b><small>Sections · cards</small></div>
                </div>
                <div class="upviral-type-row">
                  <div class="upviral-type-sample w400">Referral tracking, built in.</div>
                  <div class="upviral-type-meta"><b>Poppins 400</b><small>Body · UI</small></div>
                </div>
              </div>
              <div class="upviral-brand-card">
                <div class="upviral-brand-card-label">Tokens</div>
                <div class="upviral-tokens">
                  <div class="upviral-token">
                    <div class="upviral-token-demo"><div style="width:58px;height:26px;border-radius:999px;background:#1bbcbd"></div></div>
                    <b>Pills</b><small>Buttons · chips</small>
                  </div>
                  <div class="upviral-token">
                    <div class="upviral-token-demo"><div style="width:38px;height:34px;border-radius:12px;border:1px solid rgba(40,56,72,.14);background:#fff"></div></div>
                    <b>Radius</b><small>12px cards</small>
                  </div>
                  <div class="upviral-token">
                    <div class="upviral-token-demo"><div style="width:48px;height:30px;border-radius:10px;background:#fff;box-shadow:0 10px 22px rgba(40,56,72,.18)"></div></div>
                    <b>Shadow</b><small>Soft · diffuse</small>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>`;
    case 'upviral-builder':
      return `<div class="proj-n-block upviral-section">
        <div class="upviral-section-head">
          <div>
            ${b.label ? `<div class="proj-n-label">${b.label}</div>` : ''}
            ${b.title ? `<div class="proj-n-title">${b.title}</div>` : ''}
            ${b.body ? `<div class="proj-n-body">${b.body}</div>` : ''}
          </div>
          <div class="upviral-section-kpis">
            <div class="upviral-mini-kpi"><span>Flow</span><strong>×3</strong><em>Set up · Promote · Reports</em></div>
            <div class="upviral-mini-kpi"><span>Editor</span><strong>D&D</strong><em class="purple">Drag & drop widgets</em></div>
            <div class="upviral-mini-kpi"><span>Loop</span><strong>Referral</strong><em>Points · rewards</em></div>
          </div>
        </div>
        <div class="upviral-panel">
          <div class="upviral-panel-top">
            <div class="upviral-panel-title"><span class="upviral-led"></span> Campaign Builder — redesigned flow</div>
            <div class="upviral-chip-row"><span class="upviral-chip teal">Click tabs</span><span class="upviral-chip">3 steps</span></div>
          </div>
          <div class="upviral-console">
            <div class="upviral-tabs">
              <input id="upviral-tab-setup" name="upviral-console-tab" type="radio" checked>
              <input id="upviral-tab-promote" name="upviral-console-tab" type="radio">
              <input id="upviral-tab-reports" name="upviral-console-tab" type="radio">
              <label for="upviral-tab-setup">1 · Set up</label>
              <label for="upviral-tab-promote">2 · Promote</label>
              <label for="upviral-tab-reports">3 · Reports</label>
              <div class="upviral-console-content">
                <div class="upviral-tab-panel upviral-editor setup">
                  <div class="upviral-editor-rail">
                    <div><i></i>Video</div>
                    <div><i></i>Photo</div>
                    <div><i></i>Spacer</div>
                    <div><i></i>FB opt-in</div>
                    <div class="active"><i></i>Referral incentive</div>
                    <div><i></i>Timer</div>
                    <div><i></i>Terms</div>
                  </div>
                  <div class="upviral-canvas">
                    <div class="upviral-widget selected">
                      <div class="upviral-widget-ico" style="--c1:#f59e0b;--c2:#c75080"></div>
                      <b>Exclusive 40% discount</b>
                      <p>Get a 40% discount on your next order for any of our top-selling products.</p>
                      <span class="upviral-widget-btn">Unlock reward</span>
                    </div>
                    <div class="upviral-widget">
                      <div class="upviral-widget-ico" style="--c1:#6d60b0;--c2:#3b82f6"></div>
                      <b>Demo access</b>
                      <p>Get a code to try our product for 7 days.</p>
                    </div>
                  </div>
                  <div class="upviral-props">
                    <div class="upviral-props-title">Property options</div>
                    <div class="upviral-prop"><span>Title size · 24px</span><div class="upviral-prop-slider"><i style="--w:62%"></i><em style="--w:62%"></em></div></div>
                    <div class="upviral-prop"><span>Subtitle size · 16px</span><div class="upviral-prop-slider"><i style="--w:38%"></i><em style="--w:38%"></em></div></div>
                    <div class="upviral-prop"><span>Alignment</span><div class="upviral-prop-seg"><div></div><div class="on"></div><div></div></div></div>
                    <div class="upviral-prop"><span>Incentive level</span><div class="upviral-prop-seg"><div class="on"></div><div></div><div></div></div></div>
                  </div>
                </div>
                <div class="upviral-tab-panel upviral-share promote">
                  <div class="upviral-share-card">
                    <h4>Congrats! You're now one step away from winning <em>[Referral Incentive]</em></h4>
                    <div class="upviral-share-url"><span>upvir.al/ref/u92xk41</span><b>Copy</b></div>
                  </div>
                  <div class="upviral-share-row">
                    <div class="upviral-share-mini"><i style="--c1:#1bbcbd;--c2:#3b82f6"></i><b>Copy your link</b></div>
                    <div class="upviral-share-mini"><i style="--c1:#6d60b0;--c2:#c75080"></i><b>Send to your friends</b></div>
                    <div class="upviral-share-mini"><i style="--c1:#f59e0b;--c2:#c75080"></i><b>Win a [referral incentive]</b></div>
                  </div>
                </div>
                <div class="upviral-tab-panel upviral-reports reports">
                  <div class="upviral-funnel-row"><span>Visits</span><div class="upviral-funnel-bar"><i style="--w:96%;--d:.05s"></i></div><b>28,407</b></div>
                  <div class="upviral-funnel-row"><span>Sign-ups</span><div class="upviral-funnel-bar"><i style="--w:64%;--d:.15s"></i></div><b>10,948</b></div>
                  <div class="upviral-funnel-row"><span>Shares</span><div class="upviral-funnel-bar"><i style="--w:46%;--d:.25s"></i></div><b>7,612</b></div>
                  <div class="upviral-funnel-row"><span>Referrals</span><div class="upviral-funnel-bar"><i style="--w:34%;--d:.35s"></i></div><b>5,230</b></div>
                  <div class="upviral-funnel-row"><span>New leads</span><div class="upviral-funnel-bar"><i style="--w:28%;--d:.45s"></i></div><b>4,116</b></div>
                </div>
                <div class="upviral-side-stack">
                  <div class="upviral-stat-card">
                    <span>Viral loop — demo campaign</span>
                    <strong class="upviral-stat-val">38%</strong>
                    <div class="upviral-stat-foot">Leads from referrals <b>K-factor 1.4</b></div>
                  </div>
                  <div class="upviral-ref-card">
                    <span>Top referrers</span>
                    <div class="upviral-ref-row"><b>sarah@…</b><em class="upviral-badge teal">1,240 pts</em></div>
                    <div class="upviral-ref-row"><b>mike@…</b><em class="upviral-badge purple">980 pts</em></div>
                    <div class="upviral-ref-row"><b>lena@…</b><em class="upviral-badge">760 pts</em></div>
                    <div class="upviral-ref-row"><b>Reward tiers</b><em class="upviral-badge">×4</em></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>`;
    case 'oneasset-vitrine':
      return `<div class="proj-n-block xsec xsec--oa">
        <div class="xsec-head">
          <div>
            ${b.label ? `<div class="proj-n-label">${b.label}</div>` : ''}
            ${b.title ? `<div class="proj-n-title">${b.title}</div>` : ''}
            ${b.body ? `<div class="proj-n-body">${b.body}</div>` : ''}
          </div>
          <div class="xsec-kpis">
            <div class="x-kpi"><span>Min. ticket</span><strong>$10,000</strong><em>Fractional access</em></div>
            <div class="x-kpi"><span>Yield</span><strong>Daily</strong><em>USDC distributions</em></div>
            <div class="x-kpi"><span>Rail</span><strong>Base</strong><em>ERC-3643</em></div>
          </div>
        </div>
      </div>`;
    case 'oneasset-shares':
      return `<div class="proj-n-block xsec xsec--oa">
        <div class="xsec-head">
          <div>
            ${b.label ? `<div class="proj-n-label">${b.label}</div>` : ''}
            ${b.title ? `<div class="proj-n-title">${b.title}</div>` : ''}
            ${b.body ? `<div class="proj-n-body">${b.body}</div>` : ''}
          </div>
          <div class="xsec-kpis">
            <div class="x-kpi"><span>Model</span><strong>Shares</strong><em>Building divided</em></div>
            <div class="x-kpi"><span>Price / share</span><strong>$10K</strong><em>Fixed entry</em></div>
            <div class="x-kpi"><span>Custody</span><strong>Self</strong><em>Non-custodial</em></div>
          </div>
        </div>
        <div class="x-panel">
          <div class="x-panel-top">
            <div class="x-panel-title"><span class="x-led"></span> Fractional purchase selector</div>
            <div class="x-chip-row"><span class="x-chip acc">Lit floors = owned parts</span></div>
          </div>
          <div class="oa-shares">
            <div class="oa-bld-stage">
              <div class="oa-bld-3d">
                <div class="oa-bld-box" aria-hidden="true">
                  <div class="oa-bface oa-bface-top"></div>
                  <div class="oa-bface oa-bface-side"></div>
                  <div class="oa-bface oa-bface-front">
                    ${[true,false,true,false,true,false].map(lit => `<span class="oa-bld-part${lit ? ' is-lit' : ''}">${lit ? '<span class="oa-part-node"></span>' : ''}</span>`).join('')}
                  </div>
                </div>
                <span class="oa-bld-pad" aria-hidden="true"></span>
              </div>
            </div>
            <div class="oa-selector">
              <div class="oa-sel-title">Buy shares</div>
              <div class="oa-sel-row"><span>Shares</span><span class="oa-sel-count"><i>−</i><b>3</b><i>+</i></span></div>
              <div class="oa-sel-row"><span>Price per share</span><b>$10,000</b></div>
              <div class="oa-sel-row"><span>Total allocation</span><b>$30,000</b></div>
              <div class="oa-sel-row"><span>Distribution</span><b class="green">Daily · USDC</b></div>
              <div class="oa-sel-row"><span>Standard</span><b>ERC-3643 · Base</b></div>
              <span class="oa-cta primary" style="text-align:center; margin-top:6px;">Continue to KYC</span>
            </div>
          </div>
        </div>
      </div>`;
    case 'oneasset-workspace':
      return `<div class="proj-n-block xsec xsec--oa">
        <div class="xsec-head">
          <div>
            ${b.label ? `<div class="proj-n-label">${b.label}</div>` : ''}
            ${b.title ? `<div class="proj-n-title">${b.title}</div>` : ''}
            ${b.body ? `<div class="proj-n-body">${b.body}</div>` : ''}
          </div>
          <div class="xsec-kpis">
            <div class="x-kpi"><span>Workspace</span><strong>6</strong><em>PM modules</em></div>
            <div class="x-kpi"><span>KYB</span><strong>5 steps</strong><em>Guided onboarding</em></div>
            <div class="x-kpi"><span>Reports</span><strong>Monthly</strong><em>Per asset class</em></div>
          </div>
        </div>
        <div class="x-panel">
          <div class="x-panel-top">
            <div class="x-panel-title"><span class="x-led"></span> Property Manager workspace</div>
            <div class="x-chip-row"><span class="x-chip acc">Click the tabs</span></div>
          </div>
          <div class="x-tabs">
            <input type="radio" id="oa-tab-ov" name="oa-ws-tab" checked>
            <input type="radio" id="oa-tab-rep" name="oa-ws-tab">
            <input type="radio" id="oa-tab-kyb" name="oa-ws-tab">
            <div class="x-tab-labels">
              <label for="oa-tab-ov">Overview</label>
              <label for="oa-tab-rep">Reports</label>
              <label for="oa-tab-kyb">KYB Admission</label>
            </div>
            <div class="x-tab-content">
              <div class="x-tab-panel">
                <div class="oa-ws-list">
                  <div class="oa-ws-row"><span>Compliance status<br><small>All licenses verified</small></span><span class="oa-badge ok">Compliant</span></div>
                  <div class="oa-ws-row"><span>Reporting due this month<br><small>Commercial · rent roll, income &amp; expense</small></span><span class="oa-badge warn">Due in 6 days</span></div>
                  <div class="oa-ws-row"><span>Active payment locks<br><small>1 payout blocked pending documents</small></span><span class="oa-badge lock">1 lock</span></div>
                  <div class="oa-ws-row"><span>Pending UOA requests<br><small>Additional bank statement requested</small></span><span class="oa-badge warn">1 pending</span></div>
                  <div class="oa-ws-row"><span>Upcoming payout<br><small>Vault deposit · distribution mode: daily</small></span><span class="oa-badge ok">Eligible</span></div>
                </div>
              </div>
              <div class="x-tab-panel">
                <div class="oa-ws-list">
                  <div class="oa-ws-row"><span>March — Monthly report<br><small>Rent roll · tenancy · occupancy · SPV statements</small></span><span class="oa-badge ok">Published</span></div>
                  <div class="oa-ws-row"><span>April — Monthly report<br><small>Income &amp; expense flagged for detail</small></span><span class="oa-badge warn">Needs info</span></div>
                  <div class="oa-ws-row"><span>May — Monthly report<br><small>2 sections returned for revision</small></span><span class="oa-badge lock">Corrections</span></div>
                  <div class="oa-ws-row"><span>June — Monthly report<br><small>Hospitality asset · ADR, RevPAR, occupancy</small></span><span class="oa-badge warn">Draft</span></div>
                </div>
              </div>
              <div class="x-tab-panel">
                <div class="oa-kyb">
                  <div class="oa-kyb-step done"><span class="oa-kyb-num">✓</span><span>Business info &amp; profile</span><span class="oa-badge ok">Complete</span></div>
                  <div class="oa-kyb-step done"><span class="oa-kyb-num">✓</span><span>Contact authority</span><span class="oa-badge ok">Complete</span></div>
                  <div class="oa-kyb-step"><span class="oa-kyb-num">3</span><span>Compliance licensing</span><span class="oa-badge warn">In review</span></div>
                  <div class="oa-kyb-step todo"><span class="oa-kyb-num">4</span><span>Financial banking</span><span></span></div>
                  <div class="oa-kyb-step todo"><span class="oa-kyb-num">5</span><span>Documents</span><span></span></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>`;
    case 'jarvos-pipeline':
      return `<div class="proj-n-block xsec xsec--jv">
        <div class="xsec-head">
          <div>
            ${b.label ? `<div class="proj-n-label">${b.label}</div>` : ''}
            ${b.title ? `<div class="proj-n-title">${b.title}</div>` : ''}
            ${b.body ? `<div class="proj-n-body">${b.body}</div>` : ''}
          </div>
          <div class="xsec-kpis">
            <div class="x-kpi"><span>Agents</span><strong>10</strong><em>Specialized keys</em></div>
            <div class="x-kpi"><span>Routing</span><strong>0</strong><em>Keyword rules</em></div>
            <div class="x-kpi"><span>Truth</span><strong>Backend</strong><em>Supabase + pgvector</em></div>
          </div>
        </div>
        <div class="x-panel">
          <div class="x-panel-top">
            <div class="x-panel-title"><span class="x-led"></span> Semantic dispatch pipeline</div>
            <div class="x-chip-row"><span class="x-chip acc">No keyword routing</span><span class="x-chip">LLM proposes · backend decides</span></div>
          </div>
          <div class="x-flow">
            <div class="x-flow-card">
              <div class="x-flow-num">01 · dispatch</div>
              <div class="x-flow-title">Infer the goal</div>
              <div class="x-flow-desc">"Post this on X", "publish as a tweet" and "share on my profile" resolve to the same capability through semantic intent inference — never string matching.</div>
              <div class="x-bars"><span class="x-bar"><i style="--w:84%"></i></span><span class="x-bar"><i style="--w:58%;--d:.1s"></i></span></div>
            </div>
            <div class="x-flow-card">
              <div class="x-flow-num">02 · resolve</div>
              <div class="x-flow-title">Capabilities → tools</div>
              <div class="x-flow-desc">Required capabilities are retrieved, then resolved against the tool catalog. Model-proposed tools are classified: resolved, hallucinated, unavailable, suggested.</div>
              <div class="x-bars"><span class="x-bar"><i style="--w:72%;--d:.15s"></i></span><span class="x-bar"><i style="--w:90%;--d:.25s"></i></span></div>
            </div>
            <div class="x-flow-card">
              <div class="x-flow-num">03 · plan + run</div>
              <div class="x-flow-title">Execute with gates</div>
              <div class="x-flow-desc">The planner builds steps persisted in Supabase. Executor drivers run them — coding, browser, composio, local PC — behind approval gates and risk classes.</div>
              <div class="x-bars"><span class="x-bar"><i style="--w:66%;--d:.3s"></i></span><span class="x-bar"><i style="--w:78%;--d:.4s"></i></span></div>
            </div>
            <div class="x-flow-card">
              <div class="x-flow-num">04 · verify</div>
              <div class="x-flow-title">Prove it happened</div>
              <div class="x-flow-desc">A verifier checks quality, security and completeness with execution logs and evidence, scores confidence, then the orchestrator responds.</div>
              <div class="x-bars"><span class="x-bar"><i style="--w:92%;--d:.45s"></i></span><span class="x-bar"><i style="--w:61%;--d:.55s"></i></span></div>
            </div>
          </div>
        </div>
      </div>`;
    case 'flemme-pipeline':
      return `<div class="proj-n-block xsec xsec--jv">
        <div class="xsec-head">
          <div>
            ${b.label ? `<div class="proj-n-label">${b.label}</div>` : ''}
            ${b.title ? `<div class="proj-n-title">${b.title}</div>` : ''}
            ${b.body ? `<div class="proj-n-body">${b.body}</div>` : ''}
          </div>
          <div class="xsec-kpis">
            <div class="x-kpi"><span>Leads</span><strong>200</strong><em>Per click, qualified</em></div>
            <div class="x-kpi"><span>Platforms</span><strong>3</strong><em>X, Threads, Instagram</em></div>
            <div class="x-kpi"><span>Detection</span><strong>2-tier</strong><em>Local CDP + cloud Playwright</em></div>
          </div>
        </div>
        <div class="x-panel">
          <div class="x-panel-top">
            <div class="x-panel-title"><span class="x-led"></span> Four agents, one dashboard</div>
            <div class="x-chip-row"><span class="x-chip acc">Live product</span><span class="x-chip">flemme-three.vercel.app</span></div>
          </div>
          <div class="x-flow">
            <div class="x-flow-card">
              <div class="x-flow-num">01 · social monitor</div>
              <div class="x-flow-title">Scan before you post</div>
              <div class="x-flow-desc">Grok-assisted discovery scans roughly 40 posts per feed pass across X, Threads and Instagram, auto-selecting only the ones under 30 likes with no video or GIF — signal over noise, not a full-feed dump.</div>
              <div class="x-bars"><span class="x-bar"><i style="--w:80%"></i></span><span class="x-bar"><i style="--w:55%;--d:.1s"></i></span></div>
            </div>
            <div class="x-flow-card">
              <div class="x-flow-num">02 · deepflow</div>
              <div class="x-flow-title">Content pipeline</div>
              <div class="x-flow-desc">Automated content creation and scheduling across Twitter, Instagram and Threads: AI-generated posts, replies and follow-up content triggered directly off Social Monitor's signals.</div>
              <div class="x-bars"><span class="x-bar"><i style="--w:70%;--d:.15s"></i></span><span class="x-bar"><i style="--w:85%;--d:.25s"></i></span></div>
            </div>
            <div class="x-flow-card">
              <div class="x-flow-num">03 · dm prospection</div>
              <div class="x-flow-title">Outreach that reads the profile first</div>
              <div class="x-flow-desc">Playwright and Firecrawl pull contact data from target sites; Claude and OpenRouter draft contextual DMs and lead-warming sequences per prospect. Up to 200 qualified leads per click.</div>
              <div class="x-bars"><span class="x-bar"><i style="--w:90%;--d:.3s"></i></span><span class="x-bar"><i style="--w:60%;--d:.4s"></i></span></div>
            </div>
            <div class="x-flow-card">
              <div class="x-flow-num">04 · ad library</div>
              <div class="x-flow-title">Feed the creative back in</div>
              <div class="x-flow-desc">Discovered content and outreach results feed a shared creative library, closing the loop between what's working on the timeline and what gets published or sent next.</div>
              <div class="x-bars"><span class="x-bar"><i style="--w:65%;--d:.45s"></i></span><span class="x-bar"><i style="--w:75%;--d:.55s"></i></span></div>
            </div>
          </div>
        </div>
      </div>`;
    case 'vloggy-timeline':
      return `<div class="proj-n-block xsec xsec--jv">
        <div class="xsec-head">
          <div>
            ${b.label ? `<div class="proj-n-label">${b.label}</div>` : ''}
            ${b.title ? `<div class="proj-n-title">${b.title}</div>` : ''}
            ${b.body ? `<div class="proj-n-body">${b.body}</div>` : ''}
          </div>
          <div class="xsec-kpis">
            <div class="x-kpi"><span>Raised</span><strong>€100K</strong><em>Seed round</em></div>
            <div class="x-kpi"><span>Editing</span><strong>1080p</strong><em>24-min in-app</em></div>
            <div class="x-kpi"><span>Comments</span><strong>10s</strong><em>Video replies</em></div>
          </div>
        </div>
        <div class="x-panel">
          <div class="x-panel-top">
            <div class="x-panel-title"><span class="x-led"></span> Founded, funded, shipped, shut down</div>
            <div class="x-chip-row"><span class="x-chip acc">2017 – 2020</span><span class="x-chip">iOS · Android</span></div>
          </div>
          <div class="x-flow">
            <div class="x-flow-card">
              <div class="x-flow-num">01 · sep 2017</div>
              <div class="x-flow-title">Founded</div>
              <div class="x-flow-desc">Co-founded with Moussa Koita and Nader Loussaief, targeting the gap between YouTube's editing depth and TikTok's accessibility.</div>
              <div class="x-bars"><span class="x-bar"><i style="--w:75%"></i></span><span class="x-bar"><i style="--w:50%;--d:.1s"></i></span></div>
            </div>
            <div class="x-flow-card">
              <div class="x-flow-num">02 · product</div>
              <div class="x-flow-title">Built</div>
              <div class="x-flow-desc">Full iOS and Android experience: video feed, a 24-minute 1080p in-app editor, 10-second video comments and a creator monetization dashboard.</div>
              <div class="x-bars"><span class="x-bar"><i style="--w:85%;--d:.15s"></i></span><span class="x-bar"><i style="--w:65%;--d:.25s"></i></span></div>
            </div>
            <div class="x-flow-card">
              <div class="x-flow-num">03 · seed round</div>
              <div class="x-flow-title">€100K raised</div>
              <div class="x-flow-desc">Raised from Columbus BlueSky Holding, backed by CM-CIC, BNP Paribas Développement and Harwanne/Covéa, on an investor deck and product demo I built.</div>
              <div class="x-bars"><span class="x-bar"><i style="--w:90%;--d:.3s"></i></span><span class="x-bar"><i style="--w:55%;--d:.4s"></i></span></div>
            </div>
            <div class="x-flow-card">
              <div class="x-flow-num">04 · 2020</div>
              <div class="x-flow-title">Delivery, then shutdown</div>
              <div class="x-flow-desc">Reached delivery stage, then ceased operations when funding ran out against TikTok-scale competition. The clearest lesson in when to stop, not just how to build.</div>
              <div class="x-bars"><span class="x-bar"><i style="--w:60%;--d:.45s"></i></span><span class="x-bar"><i style="--w:40%;--d:.55s"></i></span></div>
            </div>
          </div>
        </div>
      </div>`;
    case 'jarvos-console':
      return `<div class="proj-n-block xsec xsec--jv">
        <div class="xsec-head">
          <div>
            ${b.label ? `<div class="proj-n-label">${b.label}</div>` : ''}
            ${b.title ? `<div class="proj-n-title">${b.title}</div>` : ''}
            ${b.body ? `<div class="proj-n-body">${b.body}</div>` : ''}
          </div>
          <div class="xsec-kpis">
            <div class="x-kpi"><span>Stream</span><strong>SSE</strong><em>Token + tool events</em></div>
            <div class="x-kpi"><span>Resolver</span><strong>4</strong><em>Tool classes</em></div>
            <div class="x-kpi"><span>Gates</span><strong>Risk</strong><em>Approval required</em></div>
          </div>
        </div>
        <div class="x-panel">
          <div class="x-panel-top">
            <div class="x-panel-title"><span class="x-led"></span> Jarvos cockpit — live internals</div>
            <div class="x-chip-row"><span class="x-chip acc">Click the tabs</span></div>
          </div>
          <div class="x-tabs">
            <input type="radio" id="jv-tab-chat" name="jv-console-tab" checked>
            <input type="radio" id="jv-tab-tools" name="jv-console-tab">
            <input type="radio" id="jv-tab-appr" name="jv-console-tab">
            <div class="x-tab-labels">
              <label for="jv-tab-chat">Chat stream</label>
              <label for="jv-tab-tools">Tool resolver</label>
              <label for="jv-tab-appr">Approval gate</label>
            </div>
            <div class="x-tab-content">
              <div class="x-tab-panel">
                <div class="jv-term" style="margin:0;">
                  <div class="jv-line" style="--d:.1s"><span class="t-dim">POST</span> /api/messages/stream <span class="t-dim">clientRequestId=9f2e…</span></div>
                  <div class="jv-line" style="--d:.4s"><span class="t-evt">event: meta</span> <span class="t-dim">→ context + memory + tool catalog loaded</span></div>
                  <div class="jv-line" style="--d:.7s"><span class="t-evt">event: token</span> Working on it — planning 3 steps…</div>
                  <div class="jv-line" style="--d:1s"><span class="t-evt">event: tool_start</span> <span class="t-tool">browser.navigate</span> <span class="t-dim">(local-worker · residential IP)</span></div>
                  <div class="jv-line" style="--d:1.3s"><span class="t-evt">event: tool_end</span> <span class="t-tool">browser.navigate</span> <span class="t-ok">ok · 1.2s</span></div>
                  <div class="jv-line" style="--d:1.6s"><span class="t-evt">event: tool_start</span> <span class="t-tool">composio.gmail.send</span> <span class="t-dim">(awaiting approval)</span></div>
                  <div class="jv-line" style="--d:1.9s"><span class="t-evt">event: tool_end</span> <span class="t-tool">composio.gmail.send</span> <span class="t-ok">approved · sent</span></div>
                  <div class="jv-line" style="--d:2.2s"><span class="t-evt">event: done</span> <span class="t-ok">verifier: confidence 0.93</span></div>
                </div>
              </div>
              <div class="x-tab-panel">
                <div class="jv-rows">
                  <div class="jv-row"><span><code>composio.twitter.post</code><br><small>capability: social.publish</small></span><span class="jv-b res">resolved</span></div>
                  <div class="jv-row"><span><code>browser.navigate</code><br><small>capability: web.browse · local worker</small></span><span class="jv-b res">resolved</span></div>
                  <div class="jv-row"><span><code>magic.full_refund_api</code><br><small>proposed by model — not in catalog</small></span><span class="jv-b hal">hallucinated</span></div>
                  <div class="jv-row"><span><code>composio.linkedin.dm</code><br><small>integration not connected for this user</small></span><span class="jv-b una">unavailable</span></div>
                  <div class="jv-row"><span><code>local_pc.exec</code><br><small>capability: machine.control · gated</small></span><span class="jv-b res">resolved</span></div>
                </div>
              </div>
              <div class="x-tab-panel">
                <div class="jv-approval">
                  <div class="jv-appr-head"><span class="jv-appr-title">Approval required</span><span class="jv-b hal">risk: high</span></div>
                  <div class="jv-appr-row"><span>Action</span><code>local_pc.exec — install dependency</code></div>
                  <div class="jv-appr-row"><span>Agent</span><code>coding → local_worker</code></div>
                  <div class="jv-appr-row"><span>Scope</span><code>~/dev/project · no network</code></div>
                  <div class="jv-appr-row"><span>Evidence</span><code>plan step 2/3 · execution log attached</code></div>
                  <div class="jv-appr-actions"><span class="jv-btn ok">Approve once</span><span class="jv-btn no">Deny</span></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>`;
    case 'aw-console':
      return `<div class="proj-n-block xsec xsec--aw">
        <div class="xsec-head">
          <div>
            ${b.label ? `<div class="proj-n-label">${b.label}</div>` : ''}
            ${b.title ? `<div class="proj-n-title">${b.title}</div>` : ''}
            ${b.body ? `<div class="proj-n-body">${b.body}</div>` : ''}
          </div>
          <div class="xsec-kpis">
            <div class="x-kpi"><span>Quests</span><strong>15</strong><em>31 objectives</em></div>
            <div class="x-kpi"><span>Itemization</span><strong>V1</strong><em>Audit clean</em></div>
            <div class="x-kpi"><span>Source of truth</span><strong>SQL</strong><em>Supabase · aw schema</em></div>
          </div>
        </div>
        <div class="x-panel">
          <div class="x-panel-top">
            <div class="x-panel-title"><span class="x-led"></span> Game systems — backed by Postgres</div>
            <div class="x-chip-row"><span class="x-chip acc">Click the tabs</span><span class="x-chip">Live from aw.* tables</span></div>
          </div>
          <div class="x-tabs">
            <input type="radio" id="aw-tab-inv" name="aw-console-tab" checked>
            <input type="radio" id="aw-tab-loot" name="aw-console-tab">
            <input type="radio" id="aw-tab-quest" name="aw-console-tab">
            <div class="x-tab-labels">
              <label for="aw-tab-inv">Inventory</label>
              <label for="aw-tab-loot">Loot tables</label>
              <label for="aw-tab-quest">Quest log</label>
            </div>
            <div class="x-tab-content">
              <div class="x-tab-panel">
                <div class="aw-inv">
                  <div class="aw-slot common" title="sun_drachma · currency"><img src="../images/aw-item-coins.png" alt="Sun drachma" loading="lazy" decoding="async"><b>320</b></div>
                  <div class="aw-slot common" title="desert_sage · crafting material"><img src="../images/aw-item-herbs.png" alt="Desert sage" loading="lazy" decoding="async"><b>x12</b></div>
                  <div class="aw-slot common" title="desert_hide · crafting material"><img src="../images/aw-item-hide.png" alt="Desert hide" loading="lazy" decoding="async"><b>x8</b></div>
                  <div class="aw-slot uncommon" title="bound_quest_scroll · quest item"><img src="../images/aw-item-scroll.png" alt="Quest scroll" loading="lazy" decoding="async"></div>
                  <div class="aw-slot uncommon" title="medium_health_potion · consumable"><img src="../images/aw-item-potion-green.png" alt="Health potion" loading="lazy" decoding="async"><b>x5</b></div>
                  <div class="aw-slot rare" title="solar_vigor_elixir · consumable"><img src="../images/aw-item-potion-red.png" alt="Solar vigor elixir" loading="lazy" decoding="async"><b>x3</b></div>
                  <div class="aw-slot rare" title="jaguar_fang_charm · relic"><img src="../images/aw-item-fang-necklace.png" alt="Jaguar fang charm" loading="lazy" decoding="async"></div>
                  <div class="aw-slot epic" title="sealed_solar_relic · relic · very rare"><img src="../images/aw-item-solar-relic.png" alt="Sealed solar relic" loading="lazy" decoding="async"></div>
                  <div class="aw-slot legendary" title="amulet_of_the_jaguar · card · super rare"><img src="../images/aw-item-jaguar-amulet.png" alt="Amulet of the Jaguar" loading="lazy" decoding="async"></div>
                  <div class="aw-slot common"></div>
                  <div class="aw-slot common"></div>
                  <div class="aw-slot common"></div>
                </div>
              </div>
              <div class="x-tab-panel">
                <div class="aw-loot">
                  <div class="aw-loot-row"><span><span class="aw-loot-name">desert_hide <small>· crafting material</small></span><span class="x-bar"><i style="--w:38%"></i></span></span><span class="aw-loot-rate">38%</span></div>
                  <div class="aw-loot-row"><span><span class="aw-loot-name">ancient_wood <small>· crafting material</small></span><span class="x-bar"><i style="--w:22%;--d:.1s"></i></span></span><span class="aw-loot-rate">22%</span></div>
                  <div class="aw-loot-row"><span><span class="aw-loot-name">medium_health_potion <small>· consumable</small></span><span class="x-bar"><i style="--w:14%;--d:.2s"></i></span></span><span class="aw-loot-rate">14%</span></div>
                  <div class="aw-loot-row"><span><span class="aw-loot-name">jaguar_relic_fragment <small>· relic · very rare</small></span><span class="x-bar"><i style="--w:2.4%;--d:.3s"></i></span></span><span class="aw-loot-rate">2.4%</span></div>
                  <div class="aw-loot-row"><span><span class="aw-loot-name">card_of_the_solar_dawn <small>· card · super rare</small></span><span class="x-bar"><i style="--w:0.6%;--d:.4s"></i></span></span><span class="aw-loot-rate">0.6%</span></div>
                </div>
              </div>
              <div class="x-tab-panel">
                <div class="aw-quests">
                  <div class="aw-quest">
                    <div class="aw-quest-name">Arrival at Sunfall Oasis <code>main_001</code></div>
                    <div class="aw-obj done">Speak with Nema Sunwatcher</div>
                    <div class="aw-obj done">Collect 3 waterskins for the camp</div>
                    <div class="aw-obj">Clear the scarab nest near the oasis</div>
                    <div class="aw-reward">Rewards: 50 XP · 5 gold (pending grant)</div>
                  </div>
                  <div class="aw-quest">
                    <div class="aw-quest-name">First Steps of the Sun <code>main_002</code></div>
                    <div class="aw-obj">Reach level 5</div>
                    <div class="aw-obj">Teleport to the faction capital</div>
                    <div class="aw-reward">Unlocks: weapon specialization</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>`;
    case 'aw-pyramidion':
      return `<div class="proj-n-block xsec xsec--aw">
        <div class="xsec-head">
          <div>
            ${b.label ? `<div class="proj-n-label">${b.label}</div>` : ''}
            ${b.title ? `<div class="proj-n-title">${b.title}</div>` : ''}
            ${b.body ? `<div class="proj-n-body">${b.body}</div>` : ''}
          </div>
          <div class="xsec-kpis">
            <div class="x-kpi"><span>Classes</span><strong>3</strong><em>Solar Energy</em></div>
            <div class="x-kpi"><span>Factions</span><strong>2+1</strong><em>Dynastyless neutral</em></div>
            <div class="x-kpi"><span>Endgame</span><strong>Cyclic</strong><em>Seasonal PvPvE</em></div>
          </div>
        </div>
        <div class="x-panel">
          <div class="x-panel-top">
            <div class="x-panel-title"><span class="x-led"></span> The Pyramidion — faction reconstruction race</div>
            <div class="x-chip-row"><span class="x-chip acc">Season 1</span><span class="x-chip">PvPvE</span></div>
          </div>
          <div class="aw-war">
            <div class="aw-fac sun">
              <div class="aw-fac-name">Empire of the Sun</div>
              <div class="aw-fac-bar"><i style="--w:64%"></i></div>
              <div class="aw-fac-sub">Fragments recovered · divine solar order</div>
            </div>
            <div class="aw-pyra"></div>
            <div class="aw-fac jaguar">
              <div class="aw-fac-name">Children of the Jaguar</div>
              <div class="aw-fac-bar"><i style="--w:51%"></i></div>
              <div class="aw-fac-sub">Fragments recovered · ancestral freedom</div>
            </div>
          </div>
          <div class="aw-cycle">
            <span>Explore pyramids</span><span class="now">Recover shards</span><span>Reconstruct</span><span>Escort the ritual</span><span>Seal the Pyramidion</span>
          </div>
        </div>
      </div>`;
    case 'obx-glass':
      return `<div class="proj-n-block xsec xsec--obx">
        <div class="xsec-head">
          <div>
            ${b.label ? `<div class="proj-n-label">${b.label}</div>` : ''}
            ${b.title ? `<div class="proj-n-title">${b.title}</div>` : ''}
            ${b.body ? `<div class="proj-n-body">${b.body}</div>` : ''}
          </div>
          <div class="xsec-kpis">
            <div class="x-kpi"><span>Components</span><strong>10</strong><em>Glass system</em></div>
            <div class="x-kpi"><span>Principle</span><strong>Stateful</strong><em>Not wallpaper</em></div>
            <div class="x-kpi"><span>Banned from</span><strong>Data</strong><em>Tables · legal · KYC</em></div>
          </div>
        </div>
        <div class="x-panel">
          <div class="x-panel-top">
            <div class="x-panel-title"><span class="x-led"></span> Glass guidelines — do / don't</div>
            <div class="x-chip-row"><span class="x-chip green">Real backdrop-filter</span><span class="x-chip acc">Hover the pills</span></div>
          </div>
          <div class="obx-split">
            <div class="obx-stage">
              <div class="obx-glass-label">Glass — stateful interaction layer</div>
              <div class="obx-pills">
                <span class="obx-pill">Markets</span><span class="obx-pill on">Futures</span><span class="obx-pill">AI Bots</span><span class="obx-pill">Rewards</span>
              </div>
              <div class="obx-toggle"><span>Spot</span><span class="on">Cross</span><span>Isolated</span></div>
              <div class="obx-glass-label" style="margin-top:4px;">Leverage</div>
              <div class="obx-slider"></div>
              <div class="obx-pills" style="margin-top:4px;">
                <span class="obx-pill on">Deposit USDT</span><span class="obx-pill">Copy bot</span>
              </div>
            </div>
            <div class="obx-book">
              <div class="obx-book-title"><b>No-glass zone — order book</b><span class="x-chip red">Readability first</span></div>
              <div class="obx-row h"><span>Price</span><span>Size</span><span>Total</span></div>
              <div class="obx-row ask" style="--w:62%"><span>64,318.5</span><span>0.842</span><span>54,156</span></div>
              <div class="obx-row ask" style="--w:38%"><span>64,310.0</span><span>0.512</span><span>32,926</span></div>
              <div class="obx-row ask" style="--w:21%"><span>64,302.5</span><span>0.281</span><span>18,069</span></div>
              <div class="obx-row bid" style="--w:44%"><span>64,295.0</span><span>0.594</span><span>38,191</span></div>
              <div class="obx-row bid" style="--w:58%"><span>64,287.5</span><span>0.773</span><span>49,694</span></div>
              <div class="obx-row bid" style="--w:74%"><span>64,280.0</span><span>0.986</span><span>63,380</span></div>
              <div class="obx-note">Dense market data, small financial numbers, order books, KYC and legal text stay on crisp, opaque surfaces. Glass is reserved for stateful controls — where delight does not cost legibility.</div>
            </div>
          </div>
        </div>
      </div>`;
    case 'tools-row':
      return `<div class="proj-n-block">
        ${b.label ? `<div class="proj-n-label">${b.label}</div>` : ''}
        ${b.title ? `<div class="proj-n-title">${b.title}</div>` : ''}
        <div class="x-chip-row x-tools-row">
          ${(b.tools || []).map(t => `<span class="x-chip">${t.icon ? `<img class="x-chip-icon" src="${t.icon}" alt="${t.name}" loading="lazy">` : ''}${t.name}</span>`).join('')}
        </div>
      </div>`;
    case 'process':
      return `<div class="proj-n-block">
        <div class="proj-n-label">Process</div>
        <div class="proj-n-title">${b.title || 'How I approached it'}</div>
        <div class="proj-steps">${stepsHTML}</div>
      </div>`;
    case 'outcome':
      return `<div class="proj-n-block">
        <div class="proj-n-outcome">
          ${b.stat ? `<div class="proj-n-outcome-stat">${b.stat}</div>` : ''}
          <div>
            <div class="proj-outcome-label">Key outcome</div>
            <div class="proj-n-outcome-text"><strong>${b.text}</strong></div>
          </div>
        </div>
      </div>`;
    default: return '';
  }
}

function methodLangText(dict) {
  if (!dict) return '';
  if (typeof dict === 'string') return dict;
  return dict[currentLang] || dict.en || '';
}

function box3d(color, w, h, d) {
  return `<div class="box3d ${color}" style="--w:${w}px;--h:${h}px;--d:${d}px"><i class="f-front"></i><i class="f-back"></i><i class="f-left"></i><i class="f-right"></i><i class="f-top"></i><i class="f-bot"></i></div>`;
}
function cyl3d(color, r, h) {
  const n = 12;
  const seg = (2 * Math.PI * r / n + 0.8).toFixed(1);
  const segs = Array.from({ length: n }, (_, i) =>
    `<i class="cyl-seg" style="transform:rotateY(${i * (360 / n)}deg) translateZ(${r}px)"></i>`
  ).join('');
  return `<div class="cyl3d ${color}" style="--r:${r}px;--h:${h}px;--seg:${seg}px">${segs}<i class="cyl-cap cap-top"></i><i class="cyl-cap cap-bot"></i></div>`;
}
function pyr3d(color, w, h) {
  return `<div class="pyr3d ${color}" style="--w:${w}px;--h:${h}px"><i class="pyr-f" style="transform:rotateY(0deg) rotateX(26deg)"></i><i class="pyr-f" style="transform:rotateY(90deg) rotateX(26deg)"></i><i class="pyr-f" style="transform:rotateY(180deg) rotateX(26deg)"></i><i class="pyr-f" style="transform:rotateY(270deg) rotateX(26deg)"></i></div>`;
}
function ball3d(color, r) {
  return `<div class="ball3d ${color}" style="--r:${r}px"></div>`;
}
function s3dItem(x, y, z, rot, html) {
  return `<div class="s3d-item" style="transform:translate3d(${x}px,${y}px,${z}px) ${rot || ''}">${html}</div>`;
}

function renderMethodObject(type) {
  const shapes = {
    research:
      s3dItem(-16, 18, -12, '', box3d('paper', 54, 70, 8)) +
      s3dItem(10, -8, 8, 'rotateX(78deg)', cyl3d('gold', 32, 11)) +
      s3dItem(34, 28, 16, 'rotateZ(38deg) rotateX(8deg)', box3d('gold', 11, 46, 11)) +
      s3dItem(38, 48, 16, '', ball3d('gold', 7)),
    'user-research':
      s3dItem(-28, -24, 0, '', ball3d('skin', 15)) +
      s3dItem(-28, 16, 0, '', box3d('teal', 28, 36, 20)) +
      s3dItem(26, -30, 12, '', ball3d('skin', 17)) +
      s3dItem(26, 12, 12, '', box3d('blue', 30, 40, 22)),
    workshops:
      s3dItem(-22, 14, -14, 'rotateY(-28deg) rotateX(10deg)', box3d('orange', 70, 8, 70)) +
      s3dItem(-8, 2, 2, 'rotateY(-8deg)', box3d('yellow', 70, 8, 70)) +
      s3dItem(18, -12, 14, 'rotateY(24deg) rotateX(-8deg)', box3d('mint', 70, 8, 70)) +
      s3dItem(8, -28, 18, '', ball3d('pink', 6)),
    'user-flows':
      s3dItem(-36, 12, 14, '', box3d('gold', 30, 30, 30)) +
      s3dItem(22, -22, -8, '', box3d('blue', 40, 30, 40)) +
      s3dItem(8, 32, 24, '', box3d('teal', 26, 26, 26)),
    ia:
      s3dItem(0, -32, 0, '', box3d('ink', 88, 20, 40)) +
      s3dItem(-32, 16, 0, '', box3d('paper', 32, 28, 32)) +
      s3dItem(0, 22, 4, '', box3d('gold', 24, 36, 24)) +
      s3dItem(32, 16, 0, '', box3d('paper', 32, 28, 32)),
    wireframe:
      s3dItem(-12, 18, -20, '', box3d('frame paper', 92, 64, 8)) +
      s3dItem(0, 2, 0, '', box3d('frame paper', 92, 64, 8)) +
      s3dItem(12, -14, 20, '', box3d('frame paper', 92, 64, 8)),
    prototype:
      s3dItem(0, 0, 0, 'rotateX(-8deg) rotateY(12deg)', box3d('night phone', 50, 102, 14)),
    'user-tests':
      s3dItem(0, 10, 0, '', box3d('paper clip', 74, 94, 10)) +
      s3dItem(0, -44, 8, '', box3d('green', 28, 16, 18)),
    'ui-design':
      s3dItem(0, 4, 0, '', box3d('paper window', 110, 74, 14)),
    'design-system':
      s3dItem(-26, 16, -22, '', box3d('orange', 34, 34, 34)) +
      s3dItem(24, 16, -22, '', box3d('blue', 34, 34, 34)) +
      s3dItem(-26, 16, 20, '', box3d('green', 34, 34, 34)) +
      s3dItem(24, -6, 20, '', box3d('pink', 34, 52, 34)),
    'ai-vibe-code':
      s3dItem(0, 22, -6, '', box3d('night', 92, 62, 14)) +
      s3dItem(0, 10, 4, '', box3d('purple', 76, 42, 6)) +
      s3dItem(-22, 2, 12, '', box3d('mint', 22, 7, 5)) +
      s3dItem(8, 10, 12, '', box3d('pink', 30, 7, 5)) +
      s3dItem(24, -6, 12, '', box3d('gold', 18, 7, 5)) +
      s3dItem(-28, -4, 12, '', box3d('mint', 8, 18, 5)) +
      s3dItem(40, -30, 26, '', pyr3d('purple', 24, 34)) +
      s3dItem(-40, -26, 22, '', ball3d('mint', 8)) +
      s3dItem(18, -34, 18, '', ball3d('pink', 6)),
    audit:
      s3dItem(-18, 18, -10, '', box3d('paper', 58, 78, 10)) +
      s3dItem(-18, -28, 0, '', box3d('orange', 22, 12, 12)) +
      s3dItem(-28, 2, 8, '', box3d('orange', 28, 6, 5)) +
      s3dItem(-10, 12, 8, '', box3d('yellow', 34, 6, 5)) +
      s3dItem(-18, 22, 8, '', box3d('green', 22, 6, 5)) +
      s3dItem(28, -6, 18, 'rotateX(18deg) rotateZ(-12deg)', cyl3d('gold', 22, 8)) +
      s3dItem(28, -6, 18, 'rotateX(18deg) rotateZ(-12deg)', cyl3d('paper', 14, 4)) +
      s3dItem(42, 18, 22, 'rotateZ(38deg) rotateX(10deg)', box3d('gold', 8, 36, 8)) +
      s3dItem(-6, -8, 20, '', ball3d('orange', 7)) +
      s3dItem(8, 6, 16, '', ball3d('yellow', 5)),
    handoff:
      s3dItem(-34, 10, -8, 'rotateY(22deg)', box3d('frame paper', 52, 68, 8)) +
      s3dItem(-34, 0, 0, 'rotateY(22deg)', box3d('blue', 28, 18, 4)) +
      s3dItem(-34, 18, 0, 'rotateY(22deg)', box3d('teal', 20, 10, 4)) +
      s3dItem(-2, 4, 6, 'rotateZ(90deg)', cyl3d('gold', 5, 26)) +
      s3dItem(8, 4, 6, '', box3d('gold', 10, 10, 10)) +
      s3dItem(36, 8, 4, 'rotateY(-18deg)', box3d('night', 54, 64, 12)) +
      s3dItem(36, -2, 12, 'rotateY(-18deg)', box3d('mint', 30, 6, 4)) +
      s3dItem(36, 8, 12, 'rotateY(-18deg)', box3d('blue', 38, 6, 4)) +
      s3dItem(36, 18, 12, 'rotateY(-18deg)', box3d('gold', 22, 6, 4)),
    brand:
      s3dItem(0, 18, 0, '', cyl3d('paper', 42, 12)) +
      s3dItem(-20, -8, 12, '', ball3d('orange', 10)) +
      s3dItem(20, -12, -8, '', ball3d('blue', 11)) +
      s3dItem(4, -4, 22, '', ball3d('green', 9)) +
      s3dItem(-4, -18, 4, '', ball3d('pink', 8)),
    'product-vision':
      s3dItem(0, 34, 0, '', box3d('paper', 70, 10, 70)) +
      s3dItem(0, 24, 0, 'rotateX(90deg)', cyl3d('gold', 34, 5)) +
      s3dItem(0, 20, 0, 'rotateX(90deg)', cyl3d('paper', 22, 5)) +
      s3dItem(0, 16, 0, 'rotateX(90deg)', cyl3d('gold', 10, 6)) +
      s3dItem(0, -8, 0, '', box3d('ink', 14, 44, 14)) +
      s3dItem(0, -34, 0, '', ball3d('yellow', 9)) +
      s3dItem(32, -18, 18, '', box3d('gold', 10, 10, 10)),
    'journey-mapping':
      s3dItem(-42, 26, 12, '', box3d('teal', 30, 12, 30)) +
      s3dItem(-6, 4, 0, '', box3d('blue', 30, 12, 30)) +
      s3dItem(34, -22, -12, '', box3d('gold', 30, 12, 30)) +
      s3dItem(-42, 8, 12, '', ball3d('mint', 9)) +
      s3dItem(-6, -14, 0, '', ball3d('blue', 9)) +
      s3dItem(34, -40, -12, '', ball3d('gold', 10)) +
      s3dItem(-24, 14, 6, 'rotateZ(38deg) rotateX(8deg)', cyl3d('teal', 3.5, 40)) +
      s3dItem(14, -10, -6, 'rotateZ(40deg) rotateX(-10deg)', cyl3d('blue', 3.5, 42)) +
      s3dItem(34, -52, -12, '', box3d('yellow', 12, 8, 12)),
    automation:
      s3dItem(-22, 6, 0, 'rotateX(72deg)', cyl3d('green', 20, 14)) +
      s3dItem(-22, 6, 30, 'rotateX(72deg)', box3d('green', 12, 14, 16)) +
      s3dItem(-22, 6, -30, 'rotateX(72deg)', box3d('green', 12, 14, 16)) +
      s3dItem(4, 6, 0, 'rotateX(72deg)', box3d('green', 16, 14, 12)) +
      s3dItem(-48, 6, 0, 'rotateX(72deg)', box3d('green', 16, 14, 12)) +
      s3dItem(-22, 6, 0, 'rotateX(72deg)', cyl3d('night', 7, 16)) +
      s3dItem(30, 16, 16, 'rotateX(72deg)', cyl3d('mint', 14, 12)) +
      s3dItem(30, 16, 36, 'rotateX(72deg)', box3d('mint', 9, 12, 12)) +
      s3dItem(30, 16, -4, 'rotateX(72deg)', box3d('mint', 9, 12, 12)) +
      s3dItem(48, 16, 16, 'rotateX(72deg)', box3d('mint', 12, 12, 9)) +
      s3dItem(12, 16, 16, 'rotateX(72deg)', box3d('mint', 12, 12, 9)) +
      s3dItem(30, 16, 16, 'rotateX(72deg)', cyl3d('night', 5, 14)) +
      s3dItem(4, 10, 8, 'rotateZ(90deg)', cyl3d('gold', 4, 20)),
    'data-ops':
      s3dItem(0, 30, 0, '', cyl3d('green', 34, 14)) +
      s3dItem(0, 10, 0, '', cyl3d('green', 40, 14)) +
      s3dItem(0, -10, 0, '', cyl3d('mint', 44, 14)),
    'project-mgmt':
      s3dItem(0, 16, -8, '', box3d('paper', 92, 8, 64)) +
      s3dItem(-28, 4, 4, '', box3d('ink', 22, 58, 40)) +
      s3dItem(0, 4, 8, '', box3d('orange', 22, 58, 40)) +
      s3dItem(28, 4, 2, '', box3d('mint', 22, 58, 40)) +
      s3dItem(-28, -18, 18, '', box3d('yellow', 16, 10, 22)),
    'dev-follow':
      s3dItem(0, 10, 0, '', box3d('night', 92, 68, 12)) +
      s3dItem(-22, 4, 12, '', box3d('green', 16, 16, 16)) +
      s3dItem(0, -2, 12, '', box3d('mint', 16, 28, 16)) +
      s3dItem(22, 0, 12, '', box3d('green', 16, 22, 16)),
    marketing:
      s3dItem(-8, 34, 0, '', box3d('orange', 72, 10, 48)) +
      s3dItem(-8, 16, 0, '', box3d('yellow', 54, 10, 40)) +
      s3dItem(-8, -2, 0, '', box3d('gold', 36, 10, 32)) +
      s3dItem(-8, -20, 0, '', box3d('night', 22, 10, 24)) +
      s3dItem(42, 4, 16, '', box3d('pink', 12, 48, 12)) +
      s3dItem(58, 12, 16, '', box3d('orange', 12, 32, 12)) +
      s3dItem(74, 20, 16, '', box3d('yellow', 12, 18, 12)) +
      s3dItem(-48, -22, 18, '', ball3d('pink', 8)) +
      s3dItem(20, -34, 20, '', ball3d('yellow', 6)),
    'game-3d':
      s3dItem(0, 34, 0, '', box3d('night', 78, 12, 78)) +
      s3dItem(0, 6, 0, '', pyr3d('gold', 58, 78)) +
      s3dItem(-34, 16, 26, '', box3d('teal', 16, 30, 16)) +
      s3dItem(36, 18, 22, '', box3d('orange', 14, 26, 14)) +
      s3dItem(0, -36, 6, '', ball3d('yellow', 9)) +
      s3dItem(28, -8, 30, '', ball3d('gold', 6)),
  };
  return `<div class="s3d-shadow"></div><div class="s3d-scene">${shapes[type] || shapes.research}</div>`;
}

function renderMethodMinis(id, extraClass) {
  const steps = PROJECT_METHODS[id];
  if (!steps || !steps.length) return '';
  const names = steps.map(step => {
    const meta = METHOD_STEPS[step.type];
    return meta ? methodLangText(meta.label) : '';
  }).filter(Boolean).join(', ');
  const cls = extraClass ? `proj-list-methods ${extraClass}` : 'proj-list-methods';
  return `<div class="${cls}" aria-label="${names.replace(/"/g, '&quot;')}">${steps.map((step, i) => {
    const meta = METHOD_STEPS[step.type];
    if (!meta) return '';
    const name = methodLangText(meta.label).replace(/"/g, '&quot;');
    return `<div class="proj-list-method" data-type="${step.type}" title="${name}">
      <div class="method-obj" data-type="${step.type}" style="--d:${(i * 0.18).toFixed(2)}s">${renderMethodObject(step.type)}</div>
    </div>`;
  }).join('')}</div>`;
}

function getUsedMethodTypes() {
  const used = new Set();
  Object.values(PROJECT_METHODS).forEach(steps => {
    steps.forEach(step => {
      if (METHOD_STEPS[step.type]) used.add(step.type);
    });
  });
  return Object.keys(METHOD_STEPS).filter(type => used.has(type));
}

function renderMethodsCarousel() {
  const root = document.getElementById('methods-carousel');
  const track = document.getElementById('methods-carousel-track');
  if (!root || !track) return;
  const types = getUsedMethodTypes();
  if (!types.length) {
    track.innerHTML = '';
    return;
  }
  const itemsHTML = types.map((type, i) => {
    const meta = METHOD_STEPS[type];
    const name = methodLangText(meta.label);
    return `<div class="methods-carousel-item" data-type="${type}">
      <div class="methods-carousel-visual" aria-hidden="true">
        <div class="method-obj" data-type="${type}" style="--d:${(i * 0.16).toFixed(2)}s">${renderMethodObject(type)}</div>
      </div>
      <div class="methods-carousel-label" data-method-type-label="${type}">${name}</div>
    </div>`;
  }).join('');
  // Duplicate for seamless infinite scroll
  track.innerHTML = itemsHTML + itemsHTML;

  if (root.dataset.carouselReady === '1') return;
  root.dataset.carouselReady = '1';

  let offset = 0;
  let halfWidth = 0;
  let dragging = false;
  let pointerId = null;
  let startX = 0;
  let startOffset = 0;
  let lastX = 0;
  let lastT = 0;
  let velocity = 0;
  let resumeTimer = null;
  let autoPaused = false;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const autoSpeed = 0.45;

  function measure() {
    halfWidth = track.scrollWidth / 2;
  }

  function normalize() {
    if (!halfWidth) return;
    while (offset <= -halfWidth) offset += halfWidth;
    while (offset > 0) offset -= halfWidth;
  }

  function apply() {
    normalize();
    track.style.transform = `translate3d(${offset}px, 0, 0)`;
  }

  function pauseAuto(ms = 1800) {
    autoPaused = true;
    clearTimeout(resumeTimer);
    resumeTimer = setTimeout(() => { autoPaused = false; }, ms);
  }

  function onPointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    dragging = true;
    pointerId = e.pointerId;
    startX = e.clientX;
    startOffset = offset;
    lastX = e.clientX;
    lastT = performance.now();
    velocity = 0;
    autoPaused = true;
    clearTimeout(resumeTimer);
    root.classList.add('is-dragging');
    try { root.setPointerCapture(pointerId); } catch {}
  }

  function onPointerMove(e) {
    if (!dragging || e.pointerId !== pointerId) return;
    const now = performance.now();
    const dx = e.clientX - startX;
    offset = startOffset + dx;
    const dt = Math.max(1, now - lastT);
    velocity = (e.clientX - lastX) / dt;
    lastX = e.clientX;
    lastT = now;
    apply();
  }

  function onPointerUp(e) {
    if (!dragging || e.pointerId !== pointerId) return;
    dragging = false;
    pointerId = null;
    root.classList.remove('is-dragging');
    offset += velocity * 120;
    apply();
    pauseAuto(2200);
  }

  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerup', onPointerUp);
  root.addEventListener('pointercancel', onPointerUp);
  root.addEventListener('wheel', (e) => {
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (!delta) return;
    e.preventDefault();
    offset -= delta;
    apply();
    pauseAuto(1600);
  }, { passive: false });

  window.addEventListener('resize', () => {
    measure();
    apply();
  }, { passive: true });

  requestAnimationFrame(() => {
    measure();
    apply();
  });

  function tick() {
    if (!dragging && !autoPaused && !reduceMotion && halfWidth) {
      offset -= autoSpeed;
      apply();
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function renderMethodSchema(p) {
  const steps = PROJECT_METHODS[p.id];
  if (!steps || !steps.length) return '';
  return `
    <section class="proj-method" aria-label="Method">
      <div class="proj-method-head">
        <div class="proj-block-label" data-i18n="method_label">Method</div>
        <div class="proj-method-title" data-i18n="method_title">How this project was made</div>
      </div>
      <div class="proj-method-board">
        <ol class="proj-method-track">
          ${steps.map((step, i) => {
            const meta = METHOD_STEPS[step.type];
            if (!meta) return '';
            const num = String(i + 1).padStart(2, '0');
            const name = methodLangText(meta.label);
            const note = methodLangText(step.note);
            const noteEn = (step.note && step.note.en) || '';
            const noteFr = (step.note && step.note.fr) || noteEn;
            return `<li class="proj-method-card" data-type="${step.type}">
              <div class="method-visual">
                <span class="method-frame-num">${num}</span>
                <div class="method-token-stage" id="method-stage-${i}" data-method-type="${step.type}">
                  <div class="method-obj" data-type="${step.type}" style="--d:${(i * 0.22).toFixed(2)}s">${renderMethodObject(step.type)}</div>
                </div>
              </div>
              <div class="method-caption">
                <strong class="proj-method-name" data-method-type-label="${step.type}">${name}</strong>
                <p class="proj-method-note" data-note-en="${noteEn.replace(/"/g, '&quot;')}" data-note-fr="${noteFr.replace(/"/g, '&quot;')}">${note}</p>
              </div>
            </li>`;
          }).join('')}
        </ol>
      </div>
    </section>`;
}

function renderProject(p) {
  const visible = publicProjects();
  const idx = visible.findIndex(x => x.id === p.id);
  const prev = idx > 0 ? visible[idx - 1] : null;
  const next = idx < visible.length - 1 ? visible[idx + 1] : null;

  const isLightAccent = p.accent === '#8cff2f' || p.accent === 'rgb(140, 255, 47)';
  const accentText = isLightAccent ? '#000000' : '#ffffff';

  const stepsHTML = p.steps.map(s => `
    <div class="proj-step">
      <div class="proj-step-line"></div>
      <div class="proj-step-num">${s.num}</div>
      <div class="proj-step-title">${s.title}</div>
      <div class="proj-step-desc">${s.desc}</div>
    </div>`).join('');

  const outcomeHTML = p.outcomeStat
    ? `<div class="proj-outcome-stat">${p.outcomeStat}</div>
       <div><div class="proj-outcome-label">Key outcome</div><div class="proj-outcome-text"><strong>${p.outcome}</strong></div></div>`
    : `<div style="grid-column:1/-1"><div class="proj-outcome-label">Key outcome</div><div class="proj-outcome-text"><strong>${p.outcome}</strong></div></div>`;

  // Before/after — rendered early (after goals/solution, before process)
  const galleryBeforeAfterHTML = p.gallery && p.gallery.beforeAfter ? `
    <div class="proj-gallery" style="padding-bottom:0; border-top:1px solid var(--rule);">
      <div class="proj-gallery-label">Before / After</div>
      <div class="proj-before-after">
        ${p.gallery.beforeAfter.map(img => `
          <div class="proj-ba-item">
            <span class="proj-ba-tag ${img.label.toLowerCase()}">${img.label}</span>
            <img class="proj-ba-img" src="${img.src}" alt="${img.label}" loading="lazy" decoding="async">
            <div class="proj-screen-caption">${img.caption}</div>
          </div>`).join('')}
      </div>
    </div>` : '';

  // Screens + sections — rendered after process
  const galleryHTML = p.gallery && (p.gallery.screens || p.gallery.sections) ? `
    <div class="proj-gallery">
      <div class="proj-gallery-label">Design work</div>
      ${p.gallery.screens && p.gallery.screens.length ? `
        <div class="proj-screens-grid">
          ${p.gallery.screens.map(img => `
            <div class="proj-screen-item">
              <img class="proj-screen-img" src="${img.src}" alt="${img.caption}" loading="lazy" decoding="async">
              <div class="proj-screen-caption">${img.caption}</div>
            </div>`).join('')}
        </div>` : ''}
      ${p.gallery.sections ? p.gallery.sections.map(sec => `
        <div class="proj-gallery-section proj-gallery-section--${sec.type}">
          ${sec.label ? `<div class="proj-gallery-section-label">${sec.label}</div>` : ''}
          <div class="proj-gallery-section-grid">
            ${sec.images.map(img => `
              <div class="proj-screen-item">
                <img class="proj-screen-img" src="${img.src}" alt="${img.caption}" loading="lazy" decoding="async">
                ${img.caption ? `<div class="proj-screen-caption">${img.caption}</div>` : ''}
              </div>`).join('')}
          </div>
        </div>`).join('') : ''}
    </div>` : '';

  const urlBtn = p.url
    ? `<a class="proj-url-btn" href="${p.url}" target="_blank" rel="noopener noreferrer" style="display:inline-flex; align-items:center; gap:8px;">
        View result 
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
      </a>`
    : '';

  const landingBtn = p.landingIfaceId
    ? `<button class="proj-url-btn" type="button" onclick="openIfaceModal('${p.landingIfaceId}')" style="display:inline-flex; align-items:center; gap:8px;">
        Voir la landing
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 20h8"/><path d="M12 18v2"/></svg>
      </button>`
    : '';

  const prevBtn = prev
    ? `<div class="proj-nav-btn" onclick="openProject('${prev.id}')">
         <div class="proj-nav-arr">←</div>
         <div><div class="proj-nav-dir">Previous</div><div class="proj-nav-co">${prev.company}</div></div>
       </div>`
    : `<div></div>`;

  const nextBtn = next
    ? `<div class="proj-nav-btn next" onclick="openProject('${next.id}')">
         <div><div class="proj-nav-dir">Next</div><div class="proj-nav-co">${next.company}</div></div>
         <div class="proj-nav-arr">→</div>
       </div>`
    : `<div></div>`;

  const platformStr = p.platforms.join(', ');

  return `
  <div style="--proj-accent:${p.accent}; --proj-accent-text:${accentText}">
    <div class="proj-hero${(p.video || p.heroCover) ? ' has-cover' : ''}" style="--proj-accent:${p.accent}${p.heroCover ? `; background-image: url('${p.heroCover}');` : ''}">
      ${p.video ? `<video class="proj-hero-video js-lazy-video" data-src="${p.video}"${p.screenshot || p.cover || p.heroCover ? ` poster="${p.screenshot || p.cover || p.heroCover}"` : ''} muted loop playsinline preload="none"></video>` : ''}
      ${(p.video || p.heroCover) ? `<div class="proj-hero-cover-overlay"></div>` : ''}
      <div class="proj-hero-accent-bar"></div>
      <div class="proj-hero-glow"></div>
      <div class="proj-hero-content" style="max-width:100%;">
        <div class="proj-hero-tag">${p.tag} · ${p.year}</div>
        <div class="proj-hero-title-row">
          ${p.logo ? `<img class="proj-hero-logo" src="${p.logo}" alt="${p.company}" loading="eager">` : ''}
          <div class="proj-hero-name">${p.company}</div>
        </div>
        <div class="proj-hero-tagline">${p.tagline}</div>
        <div class="proj-hero-desc" style="max-width:800px;">${p.desc}</div>
        <div class="proj-hero-footer" style="display:flex; justify-content:space-between; align-items:flex-end; gap:32px; margin-top:32px; flex-wrap:wrap; width:100%;">
          <div class="proj-meta-row" style="margin-top:0;">
            <div class="proj-meta-item"><div class="proj-meta-key"><svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="12" height="8" rx="1"/><path d="M5 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>Role</div><div class="proj-meta-val">${p.role}</div></div>
            <div class="proj-meta-item"><div class="proj-meta-key"><svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="11" rx="1"/><path d="M2 7h12M5 2v2M11 2v2"/></svg>Duration</div><div class="proj-meta-val">${p.duration}</div></div>
            <div class="proj-meta-item"><div class="proj-meta-key"><svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 14v-1a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v1"/><circle cx="8" cy="5" r="3"/></svg>Team</div><div class="proj-meta-val">${p.team}</div></div>
            <div class="proj-meta-item"><div class="proj-meta-key"><svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="8" rx="1"/><path d="M6 13h4M8 11v2"/></svg>Platform</div><div class="proj-meta-val">${platformStr}</div></div>
          </div>
          ${(urlBtn || landingBtn) ? `<div class="proj-hero-actions" style="margin-top:0;">${urlBtn}${landingBtn}</div>` : ''}
        </div>
      </div>
    </div>

    <div class="proj-body">
      ${renderMethodSchema(p)}
      ${p.narrative ? `
      <div class="proj-narrative">
        ${renderNarrativeItems(
          p.video
            ? p.narrative.filter((b, i) => !(i === 0 && (b.type === 'image-bg' || (b.type === 'image-full' && b.bleed))))
            : p.narrative,
          stepsHTML, p
        )}
      </div>
      ` : `
      <div class="proj-challenge-block">
        <div class="proj-block-label">Challenge</div>
        <div class="proj-challenge-text">${p.challenge}</div>
      </div>

      <div class="proj-2col">
        <div>
          <div class="proj-col-label">Specific goals</div>
          <div class="proj-col-text">${p.goals}</div>
        </div>
        <div>
          <div class="proj-col-label">My solution</div>
          <div class="proj-col-text">${p.solution}</div>
        </div>
      </div>

      ${galleryBeforeAfterHTML}

      <div class="proj-process">
        <div class="proj-block-label">Process</div>
        <div class="proj-process-title">How I approached it</div>
        <div class="proj-steps">${stepsHTML}</div>
      </div>

      ${galleryHTML}

      <div class="proj-outcome">
        ${outcomeHTML}
      </div>
      `}

      <div style="height:64px"></div>
    </div>

    <div class="proj-nav-bar">
      ${prevBtn}
      <div class="proj-nav-all" onclick="goHome()">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 12h12M2 8h12M2 4h12"/></svg>
        All work
      </div>
      ${nextBtn}
    </div>
  </div>`;
}

/* ═══════════════════════════════════════════
   RENDER HOME
═══════════════════════════════════════════ */
function renderProjList() {
  const AI_IDS = ['uxfi','panfy','flemme','jarvos','ancient-world'];
  const featuredOrder = ['oneasset','creads','lvmh','renault','sg'];
  const RESULT_TAGS = {
    galian: [{ value: '+40%', label: 'SaaS efficiency' }],
    sg: [
      { value: '+12%', label: 'Investment' },
    ],
    shiseido: [{ value: '+20%', label: 'Loyalty Q1' }],
    bmw: [{ value: '+12%', label: 'Engagement' }],
    renault: [{ value: '-20%', label: 'Dev time' }],
  };
  const el = document.getElementById('proj-list-el');
  el.innerHTML = publicProjects().filter(p => !AI_IDS.includes(p.id)).sort((a, b) => {
    const rank = p => featuredOrder.includes(p.id) ? featuredOrder.indexOf(p.id) : featuredOrder.length;
    return rank(a) - rank(b);
  }).map(p => {
    // Hardcoded taxonomy mapping requested by user
    const derivedTags = [];
    const id = p.id;
    const co = p.company.toLowerCase();

    if (id === 'vloggy') derivedTags.push('Social Video');
    else if (id === 'bmw') derivedTags.push('Retail', 'B2C');
    else if (id === 'casino') derivedTags.push('Retail');
    else if (id === 'shiseido') derivedTags.push('E-Commerce');
    else if (id === 'skiset') derivedTags.push('B2C', 'E-Commerce');
    else if (id === 'sg') derivedTags.push('B2C', 'FinTech');
    else if (id === 'arlequin') derivedTags.push('FinTech', 'Web3');
    else if (id === 'upviral') derivedTags.push('B2B', 'SaaS');
    else if (id === 'edenred') derivedTags.push('B2B', 'FinTech');
    else if (id === 'oneasset') derivedTags.push('AI Product');
    else if (p.group === 'automation') derivedTags.push('Automation', 'CRM Ops');
    else if (p.group === 'ai') derivedTags.push('AI Product');
    else if (p.group === 'enterprise') derivedTags.push('B2B Enterprise');

    const PLATFORM_TAGS = new Set(['mobile app', 'web platform', 'desktop', 'mobile', 'app']);
    const allTags = [...(p.badges || []), ...derivedTags]
      .filter(t => !PLATFORM_TAGS.has(String(t).toLowerCase().trim()))
      .slice(0, 3);
    
    const BUSINESS_BADGE_CLASS = {
      'b2b': 'badge-biz-b2b',
      'b2b enterprise': 'badge-biz-b2b',
      'b2c': 'badge-biz-b2c',
      'saas': 'badge-biz-saas',
      'fintech': 'badge-biz-fintech',
      'finance': 'badge-biz-fintech',
      'crypto': 'badge-biz-web3',
      'web3': 'badge-biz-web3',
      'e-commerce': 'badge-biz-commerce',
      'retail': 'badge-biz-commerce',
      'automation': 'badge-biz-automation',
      'crm ops': 'badge-biz-automation',
      'ai product': 'badge-biz-ai',
      'web platform': 'badge-biz-platform',
      'mobile app': 'badge-biz-mobile',
      'social video': 'badge-biz-social',
      'ads ecom': 'badge-biz-ads',
      'side project': 'badge-biz-side',
      'game': 'badge-biz-game',
    };

    const getBusinessBadgeClass = (txt) => BUSINESS_BADGE_CLASS[txt.toLowerCase().trim()] || '';

    const getTagIcon = (txt) => {
      const low = txt.toLowerCase();
      if (low.includes('mobile')) return `<svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="1" width="8" height="14" rx="1.5"/><path d="M8 12h0"/></svg>`;
      if (low.includes('web') || low.includes('platform')) return `<svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="8" rx="1"/><path d="M6 13h4M8 11v2"/></svg>`;
      if (low.includes('ai') || low.includes('product')) return `<svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1v4M8 11v4M1 8h4M11 8h4M4.5 4.5l2 2M9.5 9.5l2 2"/></svg>`;
      if (low.includes('b2b') || low.includes('enterprise')) return `<svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 14V3a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v11M10 5h3a1 1 0 0 1 1 1v8"/></svg>`;
      if (low.includes('saas')) return `<svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 13h8a4 4 0 0 0 0-8 3 3 0 0 0-5.5-2.5A4 4 0 0 0 4 13z"/></svg>`;
      if (low.includes('finance') || low.includes('fintech')) return `<svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M8 5v6M6 7h4"/></svg>`;
      if (low.includes('retail') || low.includes('e-commerce') || low.includes('b2c')) return `<svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2l-2 3v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V5l-2-3H4z"/><path d="M2 5h12M8 8a3 3 0 0 1-6 0"/></svg>`;
      if (low.includes('video') || low.includes('social')) return `<svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="7"/><path d="M6.5 5.5l5 2.5-5 2.5v-5z"/></svg>`;
      return '';
    };

    const allBadgesHTML = [
      ...(p.role ? [`<span class="proj-list-badge badge-role">${p.role}</span>`] : []),
      ...allTags.map(t => {
        const bizClass = getBusinessBadgeClass(t);
        const icon = getTagIcon(t);
        const classes = ['proj-list-badge', bizClass].filter(Boolean).join(' ');
        return `<span class="${classes}">${icon}${t}</span>`;
      }),
      ...(RESULT_TAGS[p.id] || []).map(tag => `<span class="proj-list-badge badge-green">${tag.value} ${tag.label}</span>`)
    ].join('');

    return `
    <div class="proj-list-item" onclick="openProject('${p.id}')">
      ${p.logo ? `<img class="proj-list-logo" src="${p.logo}" alt="${p.company}" loading="${featuredOrder.includes(p.id) ? 'eager' : 'lazy'}"${featuredOrder.indexOf(p.id) === 0 ? ' fetchpriority="high"' : ''} decoding="async">` : `<div class="proj-list-logo-placeholder"></div>`}
      <div class="proj-list-preview-trigger">
        <div class="proj-list-title-block">
          <div class="proj-list-name-wrap">
            <span class="proj-list-name">${p.company}</span>
            <div class="proj-list-badges">${allBadgesHTML}</div>
          </div>
          <p class="proj-list-subtitle">${p.subtitle || p.desc.replace(/[.!?]+$/, '')}</p>
          ${renderMethodMinis(p.id)}
        </div>
      </div>
      <div class="proj-list-year" style="display:flex; align-items:center; justify-content:flex-end; gap:16px;">
        ${p.url ? `<a class="proj-list-link" href="${p.url}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" style="margin-right: 8px; display:inline-flex; align-items:center; gap:4px;">
          Website <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
        </a>` : ''}
        <div style="display:flex; align-items:center; gap:6px; opacity:0.6;">
          <span style="font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.05em;">Details</span>
          <span class="proj-list-arrow" style="font-size:16px;">→</span>
        </div>
      </div>
    </div>`;
  }).join('');
}

const AI_PROJECT_IDS = ['uxfi','panfy','flemme'];
function renderAiBento() {
  const el = document.getElementById('ai-bento-el');
  if (!el) return;
  const aiProjects = PROJECTS.filter(p => AI_PROJECT_IDS.includes(p.id));
  el.innerHTML = aiProjects.map(p => {
    const bgSrc = p.screenshot || p.cover;
    return `
    <div class="ai-bento-tile" onclick="openProject('${p.id}')">
      <img class="ai-bento-bg" src="${bgSrc}" alt="${p.company}" loading="lazy" decoding="async">
      <div class="ai-bento-overlay"></div>
      <div class="ai-bento-content">
        <div class="ai-bento-name">${p.company}</div>
        <div class="ai-bento-desc">${p.subtitle || p.desc}</div>
      </div>
    </div>`;
  }).join('');

  // Wide landscape tiles: Jarvos + Ancient World (side projects)
  const wideEl = document.getElementById('ai-bento-wide-el');
  if (!wideEl) return;
  const WIDE_TILES = [
    { id: 'jarvos', accent: '#a78bfa', soft: 'rgba(124,58,237,.2)' },
    { id: 'ancient-world', accent: '#fbbf24', soft: 'rgba(217,119,6,.2)' },
  ];
  wideEl.innerHTML = WIDE_TILES.map(w => {
    const p = PROJECTS.find(x => x.id === w.id);
    if (!p) return '';
    return `
    <div class="ai-bento-tile ai-wide-tile" style="--wt:${w.accent};--wt-soft:${w.soft}" onclick="openProject('${p.id}')">
      <div class="ai-wide-content">
        <div class="ai-bento-name">${p.company}</div>
        <div class="ai-bento-desc">${p.subtitle || p.desc}</div>
        <div class="ai-bento-cta" style="color:${w.accent}">View case study →</div>
      </div>
      <div class="ai-wide-visual${p.heroCover ? ' ai-wide-visual--cover' : ''}"${p.heroCover ? ` style="background-image:url('${p.heroCover}')"` : ''}>
        ${p.heroCover ? '' : (p.logo ? `<img src="${p.logo}" alt="${p.company}" loading="lazy" decoding="async">` : '')}
      </div>
    </div>`;
  }).join('');
}

function renderClientsTable() {
  const el = document.getElementById('clients-tbody');
  el.innerHTML = EXP_LIST.map(e => `
    <tr>
      <td class="ct-num">${e.num}</td>
      <td class="ct-logo">${e.logo ? `<img src="${e.logo}" alt="${e.company}" loading="lazy" decoding="async">` : `<div class="ct-logo-placeholder"></div>`}</td>
      <td class="ct-co">${e.company}</td>
      <td class="ct-role">${e.role}</td>
      <td class="ct-type">${e.type}</td>
      <td class="ct-year">${e.year}</td>
    </tr>`).join('');
}

/* ═══════════════════════════════════════════
   INIT — Selected work + method 3D tags first; heavy sections wait.
═══════════════════════════════════════════ */
renderProjList();
renderMethodsCarousel();
document.dispatchEvent(new Event('portfolio:work-ready'));
window.__portfolioWorkReady = true;

const deferSecondarySections = () => {
  renderAiBento();
  renderClientsTable();
  initWhenNearViewport('.ai-transformation', initNeuralVortexBackground);
  initWhenNearViewport('.ai-products-section', initAiProductsMatrix);
  initWhenNearViewport('.contact-section', () => {
    document.querySelector('.contact-section')?.classList.add('bg-loaded');
  });
};
if ('requestIdleCallback' in window) {
  requestIdleCallback(deferSecondarySections, { timeout: 900 });
} else {
  requestAnimationFrame(() => setTimeout(deferSecondarySections, 0));
}

// Nav typing — after Selected work is ready
(function() {
  const phrases = [
    "I can do more than what you see here",
    "This is just an overview of my work",
    "I actively follow the latest AI trends",
    "I ship faster than you'd expect...",
    "Last month I worked with 8 different LLMs",
    "4.5B tokens used on average per month"
  ];
  const el = document.getElementById('nav-typing-text');
  if (!el) return;

  let phraseIdx = 0;
  let charIdx = 0;
  let isDeleting = false;
  let typingSpeed = 60;

  function type() {
    const current = phrases[phraseIdx];
    
    if (isDeleting) {
      el.textContent = current.substring(0, charIdx - 1);
      charIdx--;
      typingSpeed = 30;
    } else {
      el.textContent = current.substring(0, charIdx + 1);
      charIdx++;
      typingSpeed = 60;
    }

    if (!isDeleting && charIdx === current.length) {
      isDeleting = true;
      typingSpeed = 2500; // Pause at end
    } else if (isDeleting && charIdx === 0) {
      isDeleting = false;
      phraseIdx = (phraseIdx + 1) % phrases.length;
      typingSpeed = 500; // Pause at start
    }

    setTimeout(type, typingSpeed);
  }
  type();
})();

(function() {
  const hash = window.location.hash;
  if (hash.startsWith('#project/')) {
    const id = hash.replace('#project/', '');
    if (publicProjects().find(p => p.id === id)) openProject(id);
  }
})();

window.addEventListener('popstate', function() {
  const hash = window.location.hash;
  if (!hash || hash === '#') goHome();
  else if (hash.startsWith('#project/')) {
    const id = hash.replace('#project/', '');
    if (publicProjects().find(p => p.id === id)) openProject(id);
    else goHome();
  }
});


// Nav — glass compact on scroll
(function() {
  const nav = document.getElementById('site-nav');
  if (!nav) return;
  const THRESHOLD = 60;
  function onScroll() {
    nav.classList.toggle('nav--scrolled', window.scrollY > THRESHOLD);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();

// Nav AI usage dashboard
(function() {
  const root = document.getElementById('nav-usage');
  if (!root) return;

  const trigger = document.getElementById('nav-usage-trigger');
  const totalEl = document.getElementById('nav-usage-total');
  const panelTotalEl = document.getElementById('usage-panel-total');
  const inputEl = document.getElementById('usage-input');
  const outputEl = document.getElementById('usage-output');
  const requestsEl = document.getElementById('usage-requests');
  const costEl = document.getElementById('usage-cost');
  const dateEl = document.getElementById('usage-panel-date');
  const providersEl = document.getElementById('usage-provider-list');

  function compactNumber(value) {
    const n = Number(value || 0);
    if (!Number.isFinite(n) || n <= 0) return '0';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, '') + 'K';
    return String(Math.round(n));
  }

  function compactUsd(value) {
    const n = Number(value || 0);
    if (!Number.isFinite(n) || n <= 0) return '$0';
    if (n < 0.01) return '<$0.01';
    return '$' + n.toFixed(n >= 10 ? 0 : 2).replace(/\.00$/, '');
  }

  function statusLabel(provider) {
    if (provider.status === 'live') return compactNumber(provider.total_tokens);
    if (provider.status === 'tracked') return compactNumber(provider.total_tokens);
    if (provider.status === 'estimated') return compactNumber(provider.total_tokens) + ' est.';
    if (provider.id === 'openrouter') {
      if (Number(provider.cost_usd || 0) > 0) return compactUsd(provider.cost_usd);
      if (Number(provider.usage_monthly_usd || 0) > 0) return compactUsd(provider.usage_monthly_usd);
      if (Number(provider.usage_weekly_usd || 0) > 0) return compactUsd(provider.usage_weekly_usd);
    }
    if (provider.status === 'limited') return 'Connected';
    if (provider.status === 'logging_required') return 'Logging needed';
    if (provider.status === 'org_required') return 'Org needed';
    if (provider.status === 'missing_key') return 'No key';
    return 'Error';
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char]));
  }

  function providerActivity(provider = {}) {
    return Number(provider.total_tokens || 0)
      || Number(provider.cost_usd || 0)
      || Number(provider.usage_weekly_usd || 0)
      || Number(provider.usage_monthly_usd || 0)
      || 0;
  }

  function renderProviders(providers = [], total = 0) {
    const fallbackTotal = providers.reduce((sum, provider) => sum + providerActivity(provider), 0);
    providersEl.innerHTML = providers.map(provider => {
      const activity = providerActivity(provider);
      const shareBase = total > 0 ? total : fallbackTotal;
      const share = activity > 0 && shareBase > 0 ? Math.max(6, Math.round((activity / shareBase) * 100)) : 0;
      const shouldShowNote = provider.status === 'missing_key' || provider.status === 'error';
      const note = shouldShowNote && provider.note
        ? `<div class="usage-provider-note">${escapeHtml(provider.note)}</div>`
        : '';
      return `
        <div class="usage-provider">
          <div class="usage-provider-top">
            <span>${escapeHtml(provider.name)}</span>
            <span class="usage-provider-status">${escapeHtml(statusLabel(provider))}</span>
          </div>
          <div class="usage-provider-bar"><span class="usage-provider-fill" style="--usage-share:${share}%"></span></div>
          ${note}
        </div>
      `;
    }).join('');
  }

  function latestSpendSummary(providers = []) {
    const monthly = providers.reduce((sum, provider) => sum + Number(provider.usage_monthly_usd || 0), 0);
    const weekly = providers.reduce((sum, provider) => sum + Number(provider.usage_weekly_usd || 0), 0);
    if (monthly > 0) return { label: '30d estimate', value: compactUsd(monthly), date: 'Last 30 days', spend: monthly };
    if (weekly > 0) return { label: '7d estimate', value: compactUsd(weekly), date: 'Last 7 days', spend: weekly };
    return null;
  }

  function estimateUsageFromSpend(spendUsd) {
    const totalTokens = Math.round((Number(spendUsd || 0) / 1.5) * 1_000_000);
    if (!totalTokens) return null;
    return {
      input: Math.round(totalTokens * 0.65),
      output: Math.round(totalTokens * 0.35),
      calls: Math.max(1, Math.round(totalTokens / 4000))
    };
  }

  async function loadUsage() {
    try {
      const response = await fetch('/api/ai-usage/today');
      if (!response.ok) throw new Error('Usage unavailable');
      const data = await response.json();
      const totals = data.totals || {};
      const providers = Array.isArray(data.providers) ? data.providers : [];
      const total = totals.total_tokens || 0;
      const spendSummary = total > 0 ? null : latestSpendSummary(providers);
      const estimatedUsage = spendSummary ? estimateUsageFromSpend(spendSummary.spend) : null;

      totalEl.textContent = spendSummary ? spendSummary.value : compactNumber(total);
      panelTotalEl.textContent = spendSummary ? spendSummary.value : compactNumber(total) + ' tokens';
      inputEl.textContent = estimatedUsage ? compactNumber(estimatedUsage.input) + ' est.' : compactNumber(totals.input_tokens);
      outputEl.textContent = estimatedUsage ? compactNumber(estimatedUsage.output) + ' est.' : compactNumber(totals.output_tokens);
      requestsEl.textContent = estimatedUsage ? compactNumber(estimatedUsage.calls) + ' est.' : compactNumber(totals.requests);
      costEl.textContent = spendSummary ? spendSummary.value : compactUsd(totals.cost_usd);
      dateEl.textContent = spendSummary ? spendSummary.label + ' · ' + spendSummary.date : 'Last 30 days';
      renderProviders(providers, total);
    } catch (err) {
      totalEl.textContent = '--';
      panelTotalEl.textContent = 'Not connected';
      inputEl.textContent = '--';
      outputEl.textContent = '--';
      requestsEl.textContent = '--';
      costEl.textContent = '--';
      providersEl.innerHTML = '<div class="usage-provider-note">Connect an OpenAI admin key to show live monthly usage.</div>';
    }
  }

  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    const open = root.classList.toggle('open');
    trigger.setAttribute('aria-expanded', String(open));
  });

  document.addEventListener('click', (event) => {
    if (!root.contains(event.target)) {
      root.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      root.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
    }
  });

  loadUsage();
})();

// Skill bars — animate on scroll into view
const skillsSection = document.getElementById('skills-section');
if (skillsSection) {
  const obs = new IntersectionObserver(([e]) => {
    if (e.isIntersecting) { skillsSection.classList.add('visible'); obs.disconnect(); }
  }, { threshold: 0.3 });
  obs.observe(skillsSection);
}


function setLang(lang) {
  currentLang = lang;
  const t = TRANSLATIONS[lang];

  // Update all text elements
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (t[key] !== undefined) el.textContent = t[key];
  });

  // Update HTML elements (with inner tags)
  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    const key = el.getAttribute('data-i18n-html');
    if (t[key] !== undefined) el.innerHTML = t[key];
  });

  const contactBtn = document.getElementById('nav-contact-btn');
  if (contactBtn && t.nav_contact !== undefined) {
    contactBtn.setAttribute('aria-label', t.nav_contact);
  }

  // Toggle active flag button
  document.getElementById('btn-en').classList.toggle('active', lang === 'en');
  document.getElementById('btn-fr').classList.toggle('active', lang === 'fr');

  document.querySelectorAll('[data-method-type-label]').forEach(el => {
    const meta = METHOD_STEPS[el.getAttribute('data-method-type-label')];
    if (meta) el.textContent = methodLangText(meta.label);
  });
  document.querySelectorAll('.proj-method-note').forEach(el => {
    const text = lang === 'fr' ? (el.dataset.noteFr || el.dataset.noteEn) : el.dataset.noteEn;
    if (text) el.textContent = text;
  });
  document.querySelectorAll('.proj-list-method[data-type]').forEach(el => {
    const meta = METHOD_STEPS[el.getAttribute('data-type')];
    if (meta) el.setAttribute('title', methodLangText(meta.label));
  });
  document.querySelectorAll('.proj-list-methods').forEach(el => {
    const names = [...el.querySelectorAll('.proj-list-method[data-type]')].map(node => {
      const meta = METHOD_STEPS[node.getAttribute('data-type')];
      return meta ? methodLangText(meta.label) : '';
    }).filter(Boolean).join(', ');
    if (names) el.setAttribute('aria-label', names);
  });

  if (typeof renderStoryModalContent === 'function') renderStoryModalContent();
}

function initRippleButton() {
  const btn = document.getElementById('ripple-btn-cv');
  const ripple = document.getElementById('ripple-span-cv');
  if (!btn || !ripple) return;

  let isHovered = false;
  let isLeaving = false;

  btn.addEventListener('mouseenter', (e) => {
    isHovered = true;
    isLeaving = false;
    const rect = btn.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 2;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    ripple.style.width = `${size}px`;
    ripple.style.height = `${size}px`;
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
    ripple.style.transition = 'transform 600ms ease-out';
    ripple.style.transform = `translate(-50%, -50%) scale(1)`;
  });

  btn.addEventListener('mousemove', (e) => {
    if (!isHovered || isLeaving) return;
    const rect = btn.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
  });

  btn.addEventListener('mouseleave', (e) => {
    isHovered = false;
    isLeaving = true;
    const rect = btn.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
    ripple.style.transform = `translate(-50%, -50%) scale(0)`;
  });
}
initRippleButton();

