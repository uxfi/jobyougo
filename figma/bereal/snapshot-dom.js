// Runs inside the prototype page (injected by build.cjs). Serializes what #app shows right now
// into a tree the Figma plugin can rebuild as editable layers:
//   frame: { t:'frame', name, x, y, w, h, rot?, fills, strokes?, sw?, dash?, radius?, effects?, opacity?, clip?, children }
//   text:  { t:'text', name, x, y, w, h, chars, font:{ families, weight, italic }, size, lh, ls, color, align, wrap, ctr? }
//   svg:   { t:'svg', name, x, y, w, h, svg, opacity? }
// Coordinates are relative to the parent node. Image fills carry the source URL; build.cjs swaps it for an id.
(() => {
  const NS = 'http://www.w3.org/2000/svg';
  const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

  function color(c) {
    const m = /rgba?\(([^)]+)\)/.exec(c || '');
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r: p[0] / 255, g: p[1] / 255, b: p[2] / 255, a: p.length > 3 ? p[3] : 1 };
  }
  // split on commas that are not inside parentheses
  function splitTop(s) {
    const out = []; let d = 0, cur = '';
    for (const ch of s) {
      if (ch === '(') d++; else if (ch === ')') d--;
      if (ch === ',' && d === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
  function stops(parts, len) {
    const out = parts.map(p => {
      const m = /^(rgba?\([^)]*\)|transparent)\s*(.*)$/.exec(p.trim());
      if (!m) return null;
      const c = m[1] === 'transparent' ? { r: 0, g: 0, b: 0, a: 0 } : color(m[1]);
      const pos = m[2].split(/\s+/).filter(Boolean).map(v => v.endsWith('%') ? num(v) / 100 : num(v) / (len || 1));
      return { c, pos: pos.length ? pos[0] : null };
    }).filter(Boolean);
    if (!out.length) return [];
    if (out[0].pos == null) out[0].pos = 0;
    if (out[out.length - 1].pos == null) out[out.length - 1].pos = 1;
    for (let i = 1; i < out.length; i++) {
      if (out[i].pos != null) continue;
      let j = i; while (out[j].pos == null) j++;
      const a = out[i - 1].pos, b = out[j].pos;
      for (let k = i; k < j; k++) out[k].pos = a + (b - a) * (k - i + 1) / (j - i + 1);
    }
    let last = 0;
    return out.map(s => { last = Math.max(last, Math.min(1, Math.max(0, s.pos))); return { color: s.c, position: last }; });
  }
  const SIDES = { top: 0, right: 90, bottom: 180, left: 270, 'top right': 45, 'right top': 45, 'bottom right': 135, 'right bottom': 135, 'bottom left': 225, 'left bottom': 225, 'top left': 315, 'left top': 315 };
  function gradient(layer, w, h) {
    const lin = /^(?:-webkit-)?linear-gradient\((.*)\)$/.exec(layer);
    if (lin) {
      const args = splitTop(lin[1]);
      let deg = 180;
      if (/deg$/.test(args[0])) deg = num(args.shift());
      else if (/^to /.test(args[0])) deg = SIDES[args.shift().slice(3).trim()] ?? 180;
      const rad = deg * Math.PI / 180;
      const len = Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad));
      const st = stops(args, len);
      return st.length ? { type: 'GRADIENT_LINEAR', deg, stops: st } : null;
    }
    const rad = /^(?:-webkit-)?radial-gradient\((.*)\)$/.exec(layer);
    if (rad) {
      const args = splitTop(rad[1]);
      let cx = .5, cy = .5, rx = .71, ry = .71;
      if (!/^(rgba?|transparent)/.test(args[0])) {
        const spec = args.shift();
        const at = /at\s+(\S+)\s+(\S+)/.exec(spec) || /at\s+(\S+)/.exec(spec);
        const pos = v => v === 'center' ? .5 : v === 'left' || v === 'top' ? 0 : v === 'right' || v === 'bottom' ? 1 : v.endsWith('%') ? num(v) / 100 : num(v) / w;
        if (at) { cx = pos(at[1]); cy = at[2] ? pos(at[2]) : .5; }
        const size = spec.split(/\s+at\s+/)[0].trim().split(/\s+/).filter(v => /\d/.test(v));
        if (size.length) {
          rx = size[0].endsWith('%') ? num(size[0]) / 100 : num(size[0]) / w;
          ry = size[1] ? (size[1].endsWith('%') ? num(size[1]) / 100 : num(size[1]) / h) : rx * w / h;
        } else {
          // farthest corner, the CSS default for both circle and ellipse
          const far = Math.hypot(Math.max(cx, 1 - cx) * w, Math.max(cy, 1 - cy) * h);
          rx = /circle/.test(spec) ? far / w : Math.max(cx, 1 - cx) * Math.SQRT2;
          ry = /circle/.test(spec) ? far / h : Math.max(cy, 1 - cy) * Math.SQRT2;
        }
      }
      const st = stops(args, Math.max(rx * w, 1));
      return st.length ? { type: 'GRADIENT_RADIAL', cx, cy, rx, ry, stops: st } : null;
    }
    return null;
  }
  function shadows(v, s) {
    if (!v || v === 'none') return [];
    return splitTop(v).map(sh => {
      const c = color(sh); if (!c || c.a === 0) return null;
      const rest = sh.replace(/rgba?\([^)]*\)/, '').trim();
      const inset = /inset/.test(rest);
      const n = rest.replace('inset', '').trim().split(/\s+/).map(num);
      return { type: inset ? 'INNER_SHADOW' : 'DROP_SHADOW', color: c, x: (n[0] || 0) * s, y: (n[1] || 0) * s, blur: (n[2] || 0) * s, spread: (n[3] || 0) * s };
    }).filter(Boolean);
  }
  function filters(v, s) {
    const fx = [], img = {};
    if (!v || v === 'none') return { fx, img };
    for (const m of v.matchAll(/([a-z-]+)\(((?:[^()]|\([^)]*\))*)\)/g)) {
      const [, fn, arg] = m;
      if (fn === 'blur') fx.push({ type: 'LAYER_BLUR', radius: num(arg) * s });
      else if (fn === 'drop-shadow') {
        const c = color(arg); const n = arg.replace(/rgba?\([^)]*\)/, '').trim().split(/\s+/).map(num);
        if (c && c.a > 0 && (n[0] || n[1] || n[2])) fx.push({ type: 'DROP_SHADOW', color: c, x: (n[0] || 0) * s, y: (n[1] || 0) * s, blur: (n[2] || 0) * s, spread: 0 });
      } else if (fn === 'grayscale') img.saturation = -Math.min(1, num(arg));
      else if (fn === 'saturate') img.saturation = Math.max(-1, Math.min(1, num(arg) - 1));
      else if (fn === 'contrast') img.contrast = Math.max(-1, Math.min(1, num(arg) - 1));
      else if (fn === 'brightness') img.exposure = Math.max(-1, Math.min(1, num(arg) - 1));
      else if (fn === 'sepia') img.temperature = Math.min(1, num(arg) * .6);
    }
    return { fx, img };
  }
  function name(el) {
    if (el.dataset && el.dataset.pseudo) return el.dataset.pseudo;
    if (el.id) return '#' + el.id;
    const c = el.getAttribute && el.getAttribute('class');
    if (c) return '.' + c.trim().split(/\s+/).join('.');
    return el.tagName.toLowerCase();
  }

  // ---------- fonts: the weight the browser actually drew ----------
  const isGeneric = f => /^(ui-|system-ui|sans-serif|serif|monospace|cursive|inherit)/.test(f);
  const faces = new Map();
  for (const f of document.fonts) {
    if (f.status !== 'loaded') continue;
    const fam = f.family.replace(/^["']|["']$/g, '');
    const [lo, hi] = String(f.weight).split(/\s+/).map(Number);
    if (!faces.has(fam)) faces.set(fam, []);
    faces.get(fam).push({ lo, hi: hi || lo, italic: f.style === 'italic' });
  }
  // CSS font matching: above 500 look heavier first, at or below 500 look lighter first
  function drawnWeight(family, want) {
    const list = faces.get(family);
    if (!list || !list.length) return want;
    if (list.some(f => want >= f.lo && want <= f.hi)) return want;
    const ws = [...new Set(list.flatMap(f => [f.lo, f.hi]))].sort((a, b) => a - b);
    const up = ws.filter(w => w > want), down = ws.filter(w => w < want).reverse();
    if (want > 500) return up[0] ?? down[0];
    if (want >= 400) { const mid = ws.find(w => w > want && w <= 500); if (mid) return mid; }
    return down[0] ?? up[0];
  }
  function font(cs) {
    const families = cs.fontFamily.split(',').map(f => f.trim().replace(/^["']|["']$/g, '')).filter(f => !isGeneric(f));
    const used = families.find(f => faces.has(f));
    const weight = num(cs.fontWeight) || 400;
    return { families, weight: used ? drawnWeight(used, weight) : weight, italic: cs.fontStyle === 'italic' };
  }

  // ---------- svg ----------
  // a dashed stroke (progress rings, the recording edge) becomes the trimmed path it draws
  function trimDashes(src, dst) {
    const s = getComputedStyle(src);
    const dash = s.strokeDasharray;
    if (!dash || dash === 'none' || typeof src.getTotalLength !== 'function') return;
    const total = src.getTotalLength();
    if (!total) return;
    const k = src.hasAttribute('pathLength') ? total / num(src.getAttribute('pathLength')) : 1;
    let pat = dash.split(/[\s,]+/).map(v => num(v) * k);
    if (pat.length % 2) pat = pat.concat(pat);
    const period = pat.reduce((a, b) => a + b, 0);
    if (!period) return;
    const off = num(s.strokeDashoffset) * k;
    const segs = [];
    let at = -(((off % period) + period) % period);
    for (let i = 0; at < total; i = (i + 1) % pat.length) {
      const len = pat[i];
      if (i % 2 === 0) { const a = Math.max(0, at), b = Math.min(total, at + len); if (b - a > .01) segs.push([a, b]); }
      at += len;
    }
    const round = s.strokeLinecap === 'round';
    let d = '';
    for (const [a, b] of segs) {
      const n = Math.max(2, Math.ceil((b - a) / 1.5));
      for (let i = 0; i <= n; i++) {
        const p = src.getPointAtLength(a + (b - a) * i / n);
        d += `${i ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
      }
      if (b - a < .5 && round) d += 'Z';
    }
    const path = document.createElementNS(NS, 'path');
    for (const at2 of dst.attributes) if (/^(stroke|fill|opacity)/.test(at2.name)) path.setAttribute(at2.name, at2.value);
    path.setAttribute('d', d || 'M0 0');
    path.setAttribute('fill', 'none');
    path.removeAttribute('stroke-dasharray'); path.removeAttribute('stroke-dashoffset');
    dst.replaceWith(path);
  }
  function svgNode(svg, rect, base) {
    const cs = getComputedStyle(svg);
    // a CSS transform on the <svg> itself (the timer ring starts at 12 o'clock) is not in its markup
    let rot = 0;
    if (cs.transform && cs.transform !== 'none') { const m = new DOMMatrixReadOnly(cs.transform); rot = Math.atan2(m.b, m.a) * 180 / Math.PI; }
    const clone = svg.cloneNode(true);
    // inline the computed paint of every shape (CSS classes don't travel with the markup)
    const src = [svg, ...svg.querySelectorAll('*')], dst = [clone, ...clone.querySelectorAll('*')];
    const hidden = [], dashed = [];
    src.forEach((el, i) => {
      if (!(el instanceof SVGElement) || el.tagName === 'symbol' || el.tagName === 'defs') return;
      const s = getComputedStyle(el), d = dst[i];
      // shapes hidden by CSS (a pause icon while it plays) must not travel with the markup
      if (i && (s.display === 'none' || s.visibility === 'hidden' || num(s.opacity) < .01)) { hidden.push(d); return; }
      if (el.tagName === 'use') return;
      for (const p of ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'fill-opacity', 'stroke-opacity', 'opacity']) {
        const v = s.getPropertyValue(p);
        if (v && v !== 'none' || p === 'fill' || p === 'stroke') d.setAttribute(p, v || 'none');
      }
      d.removeAttribute('class'); d.removeAttribute('style'); d.removeAttribute('filter');
      if (s.strokeDasharray && s.strokeDasharray !== 'none' && s.stroke !== 'none') dashed.push([el, d]);
    });
    hidden.forEach(d => d.remove());
    dashed.forEach(([el, d]) => trimDashes(el, d));
    // resolve <use href="#symbol"> into the symbol's own shapes
    clone.querySelectorAll('use').forEach(u => {
      const id = (u.getAttribute('href') || u.getAttribute('xlink:href') || '').slice(1);
      const sym = document.getElementById(id);
      if (!sym) { u.remove(); return; }
      if (!clone.getAttribute('viewBox') && sym.getAttribute('viewBox')) clone.setAttribute('viewBox', sym.getAttribute('viewBox'));
      const g = document.createElementNS(NS, 'g');
      g.innerHTML = sym.innerHTML;
      u.replaceWith(g);
    });
    clone.querySelectorAll('defs, filter, animate, title').forEach(n => n.remove());
    clone.removeAttribute('class'); clone.removeAttribute('style');
    clone.setAttribute('xmlns', NS);
    clone.setAttribute('width', rect.width.toFixed(2));
    clone.setAttribute('height', rect.height.toFixed(2));
    if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${svg.clientWidth || rect.width} ${svg.clientHeight || rect.height}`);
    if (Math.abs(rot) > .3) {
      const vb = clone.getAttribute('viewBox').split(/[\s,]+/).map(Number);
      const g = document.createElementNS(NS, 'g');
      g.setAttribute('transform', `rotate(${rot.toFixed(2)} ${vb[0] + vb[2] / 2} ${vb[1] + vb[3] / 2})`);
      while (clone.firstChild) g.appendChild(clone.firstChild);
      clone.appendChild(g);
    }
    clone.setAttribute('fill', cs.fill && cs.fill !== 'none' ? cs.fill : (svg.getAttribute('fill') || 'none'));
    let s = clone.outerHTML.replace(/currentColor/g, cs.color);
    s = s.replace(/var\(--[^)]*\)/g, cs.color);
    return { t: 'svg', name: name(svg), x: rect.left - base.left, y: rect.top - base.top, w: rect.width, h: rect.height, svg: s, opacity: num(cs.opacity) < 1 ? num(cs.opacity) : undefined };
  }

  function textItem(n, cs, base, scale) {
    let chars = n.textContent;
    if (!/\S/.test(chars)) return null;
    if (!/pre/.test(cs.whiteSpace)) chars = chars.replace(/\s+/g, ' ').trim();
    const r = document.createRange(); r.selectNodeContents(n);
    const box = r.getBoundingClientRect(), lines = r.getClientRects().length;
    if (box.width < .5 || box.height < .5) return null;
    if (cs.textTransform === 'uppercase') chars = chars.toUpperCase();
    const size = num(cs.fontSize) * scale;
    const lh = cs.lineHeight === 'normal' ? size * 1.2 : num(cs.lineHeight) * scale;
    const align = cs.textAlign === 'center' ? 'CENTER' : cs.textAlign === 'right' || cs.textAlign === 'end' ? 'RIGHT' : 'LEFT';
    // centred by flex, grid or a translate rather than text-align: keep it centred in Figma too
    const ctr = lines === 1 && align === 'LEFT' && box.width < base.width - 2 && Math.abs((box.left + box.right) / 2 - (base.left + base.right) / 2) < 1;
    return {
      t: 'text', name: chars.slice(0, 40), x: box.left - base.left, y: box.top - base.top, w: box.width, h: box.height, chars,
      font: font(cs), size, lh, ls: cs.letterSpacing === 'normal' ? 0 : num(cs.letterSpacing) * scale,
      color: color(cs.color), align, wrap: lines > 1, ctr: ctr || undefined,
    };
  }

  function inputText(el, cs, rect, base, scale) {
    const v = el.value || el.getAttribute('placeholder') || '';
    if (!v) return [];
    const size = num(cs.fontSize) * scale;
    const c = color(cs.color);
    const left = rect.left + num(cs.paddingLeft) * scale, lh = cs.lineHeight === 'normal' ? size * 1.2 : num(cs.lineHeight) * scale;
    return [{ t: 'text', name: v.slice(0, 40), x: left - base.left, y: rect.top + (rect.height - lh) / 2 - base.top, w: rect.width - num(cs.paddingLeft) * scale - num(cs.paddingRight) * scale, h: lh, chars: v,
      font: font(cs), size, lh, ls: 0, color: el.value ? c : { ...c, a: c.a * .5 }, align: 'LEFT', wrap: false }];
  }

  // own scale of an element (transform and the individual scale property), rotation removed
  function ownScale(cs) {
    let k = 1;
    if (cs.transform && cs.transform !== 'none') { const m = new DOMMatrixReadOnly(cs.transform); k *= Math.hypot(m.a, m.b) || 1; }
    if (cs.scale && cs.scale !== 'none') k *= num(cs.scale.split(' ')[0]) || 1;
    return k;
  }

  function walk(el, base, parentScale) {
    if (!(el instanceof Element)) return [];
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || num(cs.opacity) < .01) return [];
    const tag = el.tagName.toLowerCase();
    if (['script', 'style', 'template', 'symbol', 'defs'].includes(tag)) return [];
    // rotated element: measure it unrotated, rotate the Figma layer around the same center.
    // Transitions and animations would outrank the override, so they are switched off meanwhile.
    let rot = 0, undo = null;
    if (cs.transform && cs.transform !== 'none' && !(el instanceof SVGElement)) {
      const m = new DOMMatrixReadOnly(cs.transform);
      const a = Math.atan2(m.b, m.a) * 180 / Math.PI;
      if (Math.abs(a) > .3) {
        const keep = ['transform', 'transition', 'animation'].map(p => [p, el.style.getPropertyValue(p), el.style.getPropertyPriority(p)]);
        el.style.setProperty('transition', 'none', 'important');
        el.style.setProperty('animation', 'none', 'important');
        el.style.setProperty('transform', `${cs.transform} rotate(${-a}deg)`, 'important');
        rot = a;
        undo = () => { for (const [p, v, pr] of keep) { el.style.removeProperty(p); if (v) el.style.setProperty(p, v, pr); } };
      }
    }
    try {
      const rect = el.getBoundingClientRect();
      // sheets parked below or beside the screen (closed) leave a sliver on the frame edge: drop them
      const A = window.__figmaApp;
      if (A && (rect.top >= A.bottom - 8 || rect.bottom <= A.top + 8 || rect.left >= A.right - 8 || rect.right <= A.left + 8)) return [];
      if (rect.width < .5 || rect.height < .5) {
        // zero-size wrappers can still hold positioned children
        if (tag === 'svg') return [];
        return [...el.children].flatMap(c => walk(c, base, parentScale));
      }
      if (tag === 'svg') return [svgNode(el, rect, base)];
      const scale = parentScale * ownScale(getComputedStyle(el));
      const fills = [], effects = [];
      const bg = color(cs.backgroundColor);
      if (bg && bg.a > 0) fills.push({ type: 'SOLID', color: bg });
      const { fx, img } = filters(cs.filter, scale);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') {
        for (const layer of splitTop(cs.backgroundImage).reverse()) {
          const u = /^url\("?(.*?)"?\)$/.exec(layer);
          if (u) fills.push({ type: 'IMAGE', url: u[1], filters: img });
          else { const g = gradient(layer, rect.width, rect.height); if (g) fills.push(g); }
        }
      }
      if (tag === 'img' && el.currentSrc) fills.push({ type: 'IMAGE', url: el.currentSrc, filters: img });
      effects.push(...shadows(cs.boxShadow, scale), ...fx);
      const bd = /blur\(([\d.]+)px\)/.exec(cs.backdropFilter || cs.webkitBackdropFilter || '');
      if (bd) effects.push({ type: 'BACKGROUND_BLUR', radius: num(bd[1]) * scale });
      const bw = num(cs.borderTopWidth) || num(cs.borderLeftWidth);
      const bc = color(cs.borderTopStyle !== 'none' ? cs.borderTopColor : cs.borderLeftColor);
      const strokes = bw > 0 && bc && bc.a > 0 && cs.borderTopStyle !== 'none' ? [{ type: 'SOLID', color: bc }] : [];
      const corner = v => { const p = v.split(' ')[0]; return p.endsWith('%') ? Math.min(rect.width, rect.height) * num(p) / 100 : num(p) * scale; };
      const radius = [corner(cs.borderTopLeftRadius), corner(cs.borderTopRightRadius), corner(cs.borderBottomRightRadius), corner(cs.borderBottomLeftRadius)];
      const clip = cs.overflowX !== 'visible' || cs.overflowY !== 'visible';
      const opacity = num(cs.opacity);
      const visual = fills.length || strokes.length || effects.length || clip || rot || opacity < 1 || tag === 'input' || (tag === 'button' && el.id);
      const kids = [];
      // children in paint order: positioned siblings with a z-index go above, stable otherwise
      const order = [...el.childNodes].map((n, i) => {
        let z = 0;
        if (n.nodeType === 1) { const s = getComputedStyle(n); if (s.position !== 'static' && s.zIndex !== 'auto') z = num(s.zIndex); }
        return { n, i, z };
      }).sort((a, b) => a.z - b.z || a.i - b.i);
      const myBase = visual ? rect : base;
      if (tag === 'input') kids.push(...inputText(el, cs, rect, myBase, scale));
      else {
        for (const { n } of order) {
          if (n.nodeType === 3) { const t = textItem(n, cs, myBase, scale); if (t) kids.push(t); }
          else kids.push(...walk(n, myBase, scale));
        }
      }
      if (!visual) return kids;
      return [{
        t: 'frame', name: name(el), x: rect.left - base.left, y: rect.top - base.top, w: rect.width, h: rect.height,
        rot: rot || undefined, fills, strokes: strokes.length ? strokes : undefined, sw: strokes.length ? bw * scale : undefined,
        dash: strokes.length && cs.borderTopStyle === 'dashed' ? [4 * scale, 3 * scale] : undefined,
        radius: radius.some(Boolean) ? radius : undefined, effects: effects.length ? effects : undefined,
        opacity: opacity < 1 ? opacity : undefined, clip: clip || undefined, children: kids,
      }];
    } finally { if (undo) undo(); }
  }

  // ::before / ::after paint real things here (bubble tails, the lime dot on a used tool, check
  // badges, glass sheen): copy each painted one into a temporary span so the walk can see it
  const PSEUDO_CSS = '.__nob::before{content:none!important}.__noa::after{content:none!important}';
  function materializePseudos(root) {
    const style = document.createElement('style'); style.textContent = PSEUDO_CSS; document.head.appendChild(style);
    const made = [];
    for (const el of [root, ...root.querySelectorAll('*')]) {
      if (el instanceof SVGElement || ['INPUT', 'IMG', 'BR'].includes(el.tagName)) continue;
      for (const which of ['::before', '::after']) {
        const s = getComputedStyle(el, which);
        if (!s.content || s.content === 'none' || s.content === 'normal' || s.display === 'none') continue;
        const span = document.createElement('span');
        span.dataset.pseudo = name(el) + which;
        span.className = '__pseudo';
        span.style.cssText = [...s].filter(p => p !== 'content').map(p => `${p}:${s.getPropertyValue(p)}`).join(';');
        span.style.setProperty('transition', 'none', 'important');
        span.style.setProperty('animation', 'none', 'important');
        let text = '';
        const q = /^["'](.*)["']$/.exec(s.content);
        if (q) text = q[1];
        const at = /^attr\(([\w-]+)\)$/.exec(s.content);
        if (at) text = el.getAttribute(at[1]) || '';
        span.textContent = text;
        if (which === '::before') el.insertBefore(span, el.firstChild); else el.appendChild(span);
        el.classList.add(which === '::before' ? '__nob' : '__noa');
        made.push(span);
      }
    }
    return () => {
      made.forEach(s => s.remove());
      root.querySelectorAll('.__nob, .__noa').forEach(e => e.classList.remove('__nob', '__noa'));
      style.remove();
    };
  }

  window.__figmaSnap = function () {
    const app = document.getElementById('app');
    const restore = materializePseudos(app);
    try {
      const rect = app.getBoundingClientRect();
      window.__figmaApp = rect;
      const body = getComputedStyle(document.body);
      const kids = walk(app, rect, 1);
      // #app itself has no paint; the page background is black
      return { w: Math.round(rect.width), h: Math.round(rect.height), bg: color(body.backgroundColor), children: kids.length === 1 && kids[0].name === '#app' ? kids[0].children : kids };
    } finally { restore(); }
  };
})();
