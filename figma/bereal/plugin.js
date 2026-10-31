// BeReal. Design Challenge: rebuilds every screen of the coded prototype as editable layers
// (frames, text, vector icons, photos), lays them out by flow step and links the main path
// as a clickable Figma prototype. Generated into output/figma-bereal-plugin/ by figma/bereal/build.cjs.
const DATA = /*__DATA__*/null;

const SW = 393, SH = 852, GAP = 72, LABEL = 44, ROW_GAP = 220;
const GROUPS = ['Start', 'Camera', 'Context', 'Audience', 'Post', 'Feed'];

// ---------- fonts ----------
const SYSTEM = ['SF Pro Text', 'SF Pro', 'Inter'];
const ALIAS = { '-apple-system': SYSTEM, BlinkMacSystemFont: SYSTEM, 'SF Pro Text': SYSTEM, 'SF Pro Rounded': ['SF Pro Rounded', 'SF Pro', 'Inter'] };
const WEIGHT_WORDS = { 100: ['thin', 'hairline'], 200: ['extralight', 'ultralight'], 300: ['light'], 400: ['regular', 'normal', 'book', 'roman'], 500: ['medium'], 600: ['semibold', 'demibold'], 700: ['bold'], 800: ['extrabold', 'ultrabold'], 900: ['black', 'heavy'] };
const norm = s => s.toLowerCase().replace(/[\s_-]/g, '');
let fontIndex = new Map();
const fontCache = new Map();

async function indexFonts() {
  for (const f of await figma.listAvailableFontsAsync()) {
    const fam = f.fontName.family;
    if (!fontIndex.has(fam)) fontIndex.set(fam, []);
    fontIndex.get(fam).push(f.fontName.style);
  }
}
function pickStyle(styles, weight, italic) {
  const own = styles.filter(s => /italic|oblique/i.test(s) === italic);
  const pool = own.length ? own : styles;
  const order = Object.keys(WEIGHT_WORDS).map(Number).sort((a, b) => Math.abs(a - weight) - Math.abs(b - weight));
  for (const w of order) {
    for (const word of WEIGHT_WORDS[w]) {
      const hit = pool.find(s => norm(s).replace(/italic|oblique/g, '') === word);
      if (hit) return hit;
    }
  }
  return pool.find(s => /regular/i.test(s)) || pool[0];
}
function resolveFont(f) {
  const key = `${f.families.join('|')}|${f.weight}|${f.italic}`;
  if (fontCache.has(key)) return fontCache.get(key);
  let family = null;
  for (const name of f.families) {
    for (const cand of ALIAS[name] || [name]) if (fontIndex.has(cand)) { family = cand; break; }
    if (family) break;
  }
  if (!family) family = 'Inter';
  const styles = fontIndex.get(family) || ['Regular'];
  const font = { family, style: pickStyle(styles, Math.round((f.weight || 400) / 100) * 100, !!f.italic) };
  fontCache.set(key, font);
  return font;
}
async function loadFonts(fonts) {
  const seen = new Map();
  for (const f of fonts) seen.set(`${f.family}|${f.style}`, f);
  for (const [key, f] of seen) {
    try { await figma.loadFontAsync(f); } catch (e) {
      // swap every request that resolved to this font for Inter
      for (const [k, v] of fontCache) if (`${v.family}|${v.style}` === key) fontCache.set(k, { family: 'Inter', style: 'Regular' });
    }
  }
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
}

// ---------- paints and effects ----------
const rgb = c => ({ r: c.r, g: c.g, b: c.b });
function stopsOf(list) { return list.map(s => ({ position: s.position, color: { r: s.color.r, g: s.color.g, b: s.color.b, a: s.color.a } })); }
function paint(f, hashes, w, h) {
  if (f.type === 'SOLID') return { type: 'SOLID', color: rgb(f.color), opacity: f.color.a };
  if (f.type === 'IMAGE') {
    const hash = hashes[f.img];
    if (!hash) return null;
    const p = { type: 'IMAGE', imageHash: hash, scaleMode: 'FILL' };
    if (f.filters && Object.keys(f.filters).length) p.filters = f.filters;
    return p;
  }
  if (f.type === 'GRADIENT_LINEAR') {
    // CSS angle (0 = to top, clockwise) in pixel terms: the gradient line has length
    // |w·sinθ| + |h·cosθ| and runs through the center, as in the browser
    const t = f.deg * Math.PI / 180, W = w || 1, H = h || 1;
    const L = Math.abs(W * Math.sin(t)) + Math.abs(H * Math.cos(t)) || 1;
    const a = W * Math.sin(t) / L, b = -H * Math.cos(t) / L;
    return { type: 'GRADIENT_LINEAR', gradientTransform: [[a, b, 0.5 - (a + b) / 2], [-b, a, 0.5 - (a - b) / 2]], gradientStops: stopsOf(f.stops) };
  }
  if (f.type === 'GRADIENT_RADIAL') {
    const rx = Math.max(f.rx, 0.01), ry = Math.max(f.ry, 0.01);
    return { type: 'GRADIENT_RADIAL', gradientTransform: [[0.5 / rx, 0, 0.5 - 0.5 * f.cx / rx], [0, 0.5 / ry, 0.5 - 0.5 * f.cy / ry]], gradientStops: stopsOf(f.stops) };
  }
  return null;
}
function effectOf(e) {
  if (e.type === 'DROP_SHADOW') return { type: 'DROP_SHADOW', color: { r: e.color.r, g: e.color.g, b: e.color.b, a: e.color.a }, offset: { x: e.x, y: e.y }, radius: Math.max(0, e.blur), spread: e.spread || 0, visible: true, blendMode: 'NORMAL' };
  if (e.type === 'INNER_SHADOW') return { type: 'INNER_SHADOW', color: { r: e.color.r, g: e.color.g, b: e.color.b, a: e.color.a }, offset: { x: e.x, y: e.y }, radius: Math.max(0, e.blur), spread: e.spread || 0, visible: true, blendMode: 'NORMAL' };
  // a CSS blur(x) is a standard deviation; Figma's blur radius is about twice that
  if (e.type === 'LAYER_BLUR' || e.type === 'BACKGROUND_BLUR') return { type: e.type, radius: Math.max(0, e.radius * 2), visible: true };
  return null;
}
// CSS outline rings (box-shadow 0 0 0 Npx) only render in Figma with spread on clipping frames:
// the first ring becomes a stroke, the rest stay shadows
const isRing = e => /SHADOW/.test(e.type) && !e.x && !e.y && !e.blur && e.spread > 0;
function setEffects(node, list) {
  const fx = list.map(effectOf).filter(Boolean);
  try { node.effects = fx; } catch (e) {
    // newer API versions want a blurType on blurs
    try { node.effects = fx.map(x => x.type.endsWith('BLUR') ? Object.assign({ blurType: 'NORMAL' }, x) : x); } catch (e2) { stats.effectErrors++; }
  }
}

// ---------- layers ----------
const stats = { frames: 0, texts: 0, svgs: 0, svgErrors: 0, effectErrors: 0, errors: 0 };
function place(node, n) {
  if (!n.rot) { node.x = n.x; node.y = n.y; return; }
  // CSS rotates clockwise; Figma's rotation is counterclockwise. Rotate about the same center.
  const p = -n.rot * Math.PI / 180, c = Math.cos(p), s = Math.sin(p);
  const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
  node.relativeTransform = [[c, s, cx - (c * n.w / 2 + s * n.h / 2)], [-s, c, cy - (-s * n.w / 2 + c * n.h / 2)]];
}
function buildText(n, parent) {
  const t = figma.createText();
  parent.appendChild(t);
  t.fontName = resolveFont(n.font);
  t.fontSize = Math.max(1, n.size);
  t.characters = n.chars;
  t.lineHeight = { unit: 'PIXELS', value: Math.max(1, n.lh) };
  t.letterSpacing = { unit: 'PIXELS', value: n.ls || 0 };
  const c = n.color || { r: 0, g: 0, b: 0, a: 1 };
  t.fills = [{ type: 'SOLID', color: rgb(c), opacity: c.a }];
  t.textAlignHorizontal = n.align || 'LEFT';
  t.name = n.name;
  if (n.wrap) {
    t.textAutoResize = 'HEIGHT';
    t.resize(Math.max(1, n.w + 1), Math.max(1, n.h));
    t.x = n.x; t.y = n.y;
  } else {
    // one line: let Figma size it, then align it inside the box the browser drew
    // (ctr: centred by its layout rather than by text-align)
    t.textAutoResize = 'WIDTH_AND_HEIGHT';
    const dx = n.align === 'CENTER' || n.ctr ? (n.w - t.width) / 2 : n.align === 'RIGHT' ? n.w - t.width : 0;
    t.x = n.x + dx; t.y = n.y + (n.h - t.height) / 2;
  }
  stats.texts++;
}
function buildSvg(n, parent) {
  let node;
  try { node = figma.createNodeFromSvg(n.svg); } catch (e) { stats.svgErrors++; return; }
  parent.appendChild(node);
  node.name = n.name;
  if (Math.abs(node.width - n.w) > 0.5 || Math.abs(node.height - n.h) > 0.5) node.resize(Math.max(0.01, n.w), Math.max(0.01, n.h));
  node.x = n.x; node.y = n.y;
  if (n.opacity != null) node.opacity = n.opacity;
  stats.svgs++;
}
function buildFrame(n, parent, hashes) {
  const f = figma.createFrame();
  parent.appendChild(f);
  f.name = n.name;
  f.resize(Math.max(0.01, n.w), Math.max(0.01, n.h));
  const fills = (n.fills || []).map(p => paint(p, hashes, n.w, n.h)).filter(Boolean);
  f.fills = fills;
  let effects = (n.effects || []).slice();
  if (n.strokes) {
    f.strokes = n.strokes.map(p => paint(p, hashes, n.w, n.h)).filter(Boolean);
    f.strokeWeight = n.sw || 1;
    f.strokeAlign = 'INSIDE';
    if (n.dash) f.dashPattern = n.dash;
  } else {
    const ring = effects.find(isRing);
    if (ring) {
      f.strokes = [{ type: 'SOLID', color: rgb(ring.color), opacity: ring.color.a }];
      f.strokeWeight = ring.spread;
      f.strokeAlign = ring.type === 'INNER_SHADOW' ? 'INSIDE' : 'OUTSIDE';
      effects = effects.filter(e => e !== ring);
    }
  }
  if (n.radius) {
    f.topLeftRadius = n.radius[0]; f.topRightRadius = n.radius[1];
    f.bottomRightRadius = n.radius[2]; f.bottomLeftRadius = n.radius[3];
  }
  // shadows with spread need a clipping frame with a fill; when this frame can't clip
  // (children overflow, or no fill), a rectangle underneath carries the fill and the shadows
  const spread = effects.some(e => /SHADOW/.test(e.type) && e.spread);
  const fits = (n.children || []).every(c => c.x >= -0.5 && c.y >= -0.5 && c.x + c.w <= n.w + 0.5 && c.y + c.h <= n.h + 0.5);
  let clip = !!n.clip;
  if (spread && !clip && fits && fills.length) clip = true;
  if (spread && !clip) {
    const r = figma.createRectangle();
    f.appendChild(r);
    r.name = 'shape';
    r.resize(Math.max(0.01, n.w), Math.max(0.01, n.h));
    r.fills = fills;
    if (n.radius) { r.topLeftRadius = n.radius[0]; r.topRightRadius = n.radius[1]; r.bottomRightRadius = n.radius[2]; r.bottomLeftRadius = n.radius[3]; }
    setEffects(r, effects);
    f.fills = [];
    effects = [];
  }
  if (effects.length) setEffects(f, effects);
  if (n.opacity != null) f.opacity = n.opacity;
  f.clipsContent = clip;
  place(f, n);
  stats.frames++;
  for (const c of n.children || []) build(c, f, hashes);
  return f;
}
// one layer that Figma refuses must not stop the other two thousand
function build(n, parent, hashes) {
  try {
    if (n.t === 'text') return buildText(n, parent);
    if (n.t === 'svg') return buildSvg(n, parent);
    return buildFrame(n, parent, hashes);
  } catch (e) {
    stats.errors++;
    if (stats.errors <= 5) console.warn('layer skipped:', n.name, e && e.message);
  }
}
function collectFonts(n, out) {
  if (n.t === 'text') out.push(resolveFont(n.font));
  (n.children || []).forEach(c => collectFonts(c, out));
}
function label(parent, chars, x, y, size, font, color, opacity) {
  const t = figma.createText();
  parent.appendChild(t);
  t.fontName = font; t.fontSize = size; t.characters = chars;
  t.fills = [{ type: 'SOLID', color, opacity: opacity == null ? 1 : opacity }];
  t.x = x; t.y = y;
  return t;
}

// ---------- prototype links ----------
const LINKS = [
  ['First open', '.cta', 'Camera'],
  ['Camera', '#shoot', 'Preview'],
  ['Camera', '#timer', 'Timer explained'],
  ['Timer explained', '#timer', 'Camera'],
  ['Preview', '#audOpen', 'Pick a circle'],
  ['Stickers, Film', '#audOpen', 'Pick a circle'],
  ['Pick a circle', '#postBtn', 'Sent'],
  ['Two circles', '#postBtn', 'Sent'],
  ['Feed', '#mineDual', 'My BeReal.'],
  ['My BeReal.', '#odMore', 'Options'],
];
async function react(node, dest, trigger) {
  const action = { type: 'NODE', destinationId: dest.id, navigation: 'NAVIGATE', transition: { type: 'DISSOLVE', easing: { type: 'EASE_OUT' }, duration: 0.25 }, preserveScrollPosition: false };
  const reaction = { trigger, actions: [action] };
  try {
    if (node.setReactionsAsync) await node.setReactionsAsync([reaction]);
    else node.reactions = [{ trigger, action }];
    return true;
  } catch (e) { return false; }
}

// ---------- run ----------
(async () => {
  let message = '';
  try {
    figma.notify('Building the BeReal. screens…', { timeout: 4000 });
    await indexFonts();
    const fonts = [];
    DATA.screens.forEach(s => s.children.forEach(c => collectFonts(c, fonts)));
    const display = resolveFont({ families: ['Bricolage Grotesque'], weight: 800, italic: false });
    const body = resolveFont({ families: ['Inter'], weight: 500, italic: false });
    const mono = resolveFont({ families: ['Space Mono'], weight: 700, italic: false });
    fonts.push(display, body, mono);
    await loadFonts(fonts);
    const D = fontCache.get('Bricolage Grotesque|800|false') || display, B = fontCache.get('Inter|500|false') || body, M = fontCache.get('Space Mono|700|false') || mono;

    // a page of its own; the Starter plan caps files at 3 pages, so fall back to the current one,
    // to the right of whatever is already there
    let page, ox = 0, ownPage = true;
    try {
      page = figma.createPage();
      page.name = 'BeReal. screens';
      await figma.setCurrentPageAsync(page);
      page.backgrounds = [{ type: 'SOLID', color: { r: 0.94, g: 0.94, b: 0.93 } }];
    } catch (e) {
      page = figma.currentPage; ownPage = false;
      for (const c of page.children) ox = Math.max(ox, c.x + c.width + 400);
    }
    const hashes = DATA.images.map(b64 => figma.createImage(figma.base64Decode(b64)).hash);

    // cover
    const cover = figma.createFrame();
    page.appendChild(cover);
    cover.name = 'Cover';
    cover.x = ox;
    cover.resize(1600, 900);
    cover.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
    const lime = { r: 0.776, g: 0.957, b: 0.196 }, white = { r: 1, g: 1, b: 1 };
    label(cover, 'BeReal. Design Challenge', 96, 300, 104, D, white);
    label(cover, 'Posting flow: one daily post, sent to the right circle.', 100, 450, 34, B, white, 0.75);
    label(cover, `${DATA.author} · ${DATA.screens.length} screens from the coded prototype`, 100, 520, 22, B, lime);
    label(cover, 'START → CAMERA → CONTEXT → AUDIENCE → POST → FEED', 100, 780, 18, M, white, 0.5);

    // screens, one row per flow step
    const byName = new Map();
    let y = 900 + ROW_GAP, index = 0;
    for (const group of GROUPS) {
      const list = DATA.screens.filter(s => s.group === group);
      if (!list.length) continue;
      label(page, group, ox, y, 64, D, { r: 0.05, g: 0.05, b: 0.05 });
      y += 120;
      list.forEach((s, i) => {
        index++;
        const x = ox + i * (SW + GAP);
        label(page, `${String(index).padStart(2, '0')}  ${s.name}`, x, y, 22, B, { r: 0.1, g: 0.1, b: 0.1 }, 0.8);
        const frame = figma.createFrame();
        page.appendChild(frame);
        frame.name = `${String(index).padStart(2, '0')} ${group} / ${s.name}`;
        frame.resize(s.w || SW, s.h || SH);
        frame.x = x; frame.y = y + LABEL;
        frame.fills = [{ type: 'SOLID', color: s.bg ? rgb(s.bg) : { r: 0, g: 0, b: 0 } }];
        frame.clipsContent = true;
        for (const c of s.children) build(c, frame, hashes);
        byName.set(s.name, frame);
      });
      y += LABEL + SH + ROW_GAP;
    }

    // clickable main path
    let links = 0;
    for (const [from, hotspot, to] of LINKS) {
      const a = byName.get(from), b = byName.get(to);
      if (!a || !b) continue;
      const spot = a.findOne(n => n.name === hotspot);
      if (spot && await react(spot, b, { type: 'ON_CLICK' })) links++;
    }
    // Sent moves on with a tap anywhere (a timed jump has an ambiguous unit in the API)
    const sent = byName.get('Sent'), feed = byName.get('Feed');
    if (sent && feed && await react(sent, feed, { type: 'ON_CLICK' })) links++;
    const start = byName.get('First open');
    if (start) { try { page.flowStartingPoints = [{ nodeId: start.id, name: 'Posting flow' }]; } catch (e) { /* older files */ } }

    figma.viewport.scrollAndZoomIntoView([cover, ...byName.values()]);
    const warn = (stats.svgErrors ? `, ${stats.svgErrors} icons skipped` : '') + (stats.errors ? `, ${stats.errors} layers skipped` : '') + (stats.effectErrors ? `, ${stats.effectErrors} effects skipped` : '');
    message = `Done: ${byName.size} screens, ${stats.frames + stats.texts + stats.svgs} layers, ${links} prototype links${warn}.${ownPage ? '' : ' Built on this page: the file has no room for a new one.'}`;
  } catch (e) {
    console.error(e);
    message = 'Build failed: ' + (e && e.message ? e.message : e);
  } finally {
    figma.closePlugin(message);
  }
})();
