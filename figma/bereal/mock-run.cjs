// Runs the generated plugin against a small stand-in of the Figma plugin API, to catch runtime
// errors and obviously wrong values before a real run.   node figma/bereal/mock-run.cjs
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const code = fs.readFileSync(path.resolve(__dirname, '../../output/figma-bereal-plugin/code.js'), 'utf8');
const problems = [];
const bad = (n, msg) => { if (problems.length < 40) problems.push(`${n.type} "${n.name}": ${msg}`); };
const loaded = new Set();
const AVAILABLE = [
  ['Inter', ['Regular', 'Medium', 'Semi Bold', 'Bold', 'Extra Bold', 'Italic']],
  ['Bricolage Grotesque', ['Regular', 'Medium', 'SemiBold', 'Bold', 'ExtraBold']],
  ['Caveat', ['Regular', 'Medium', 'SemiBold', 'Bold']],
  ['DM Serif Display', ['Regular', 'Italic']],
  ['Space Mono', ['Regular', 'Bold', 'Italic', 'Bold Italic']],
];
let id = 0, count = { FRAME: 0, TEXT: 0, SVG: 0 };
const finite = v => typeof v === 'number' && Number.isFinite(v);
function node(type) {
  const n = { id: `${++id}:1`, type, name: '', children: [], x: 0, y: 0, width: 100, height: 100, parent: null, opacity: 1, reactions: [] };
  n.appendChild = c => { if (c.parent) c.parent.children = c.parent.children.filter(x => x !== c); c.parent = n; n.children.push(c); };
  n.resize = (w, h) => { if (!finite(w) || !finite(h) || w < 0.01 || h < 0.01) bad(n, `resize ${w}x${h}`); n.width = w; n.height = h; };
  n.findOne = f => { const walk = x => { for (const c of x.children) { if (f(c)) return c; const r = walk(c); if (r) return r; } return null; }; return walk(n); };
  n.setReactionsAsync = async r => { n.reactions = r; };
  return new Proxy(n, {
    set(t, k, v) {
      if (['x', 'y', 'opacity', 'strokeWeight', 'fontSize', 'topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius'].includes(k) && !finite(v)) bad(t, `${k} = ${v}`);
      if (k === 'fills' || k === 'strokes') for (const p of v) {
        if (p.type === 'SOLID' && (!['r', 'g', 'b'].every(c => finite(p.color[c]) && p.color[c] >= 0 && p.color[c] <= 1) || 'a' in p.color)) bad(t, `bad solid ${JSON.stringify(p)}`);
        if (p.type === 'IMAGE' && !p.imageHash) bad(t, 'image without hash');
        if (p.type && p.type.startsWith('GRADIENT') && (!p.gradientStops.length || p.gradientTransform.flat().some(x => !finite(x)))) bad(t, 'bad gradient');
      }
      if (k === 'effects') for (const e of v) if ((e.type.endsWith('SHADOW') && (!finite(e.radius) || !finite(e.offset.x))) || (e.type.endsWith('BLUR') && !finite(e.radius))) bad(t, `bad effect ${JSON.stringify(e)}`);
      if (k === 'characters' && t.type === 'TEXT' && !loaded.has(`${t.fontName.family}|${t.fontName.style}`)) bad(t, `characters before font ${JSON.stringify(t.fontName)} loaded`);
      if (k === 'fontName' && !AVAILABLE.some(([f, s]) => f === v.family && s.includes(v.style))) bad(t, `unknown font ${JSON.stringify(v)}`);
      if (k === 'relativeTransform' && v.flat().some(x => !finite(x))) bad(t, 'bad transform');
      if (k === 'characters') { t.width = Math.max(1, v.length * t.fontSize * 0.5); t.height = t.fontSize * 1.2; }
      t[k] = v; return true;
    },
  });
}
const pages = [];
const figma = {
  listAvailableFontsAsync: async () => AVAILABLE.flatMap(([family, styles]) => styles.map(style => ({ fontName: { family, style } }))),
  loadFontAsync: async f => { if (!AVAILABLE.some(([fa, s]) => fa === f.family && s.includes(f.style))) throw new Error('no font ' + JSON.stringify(f)); loaded.add(`${f.family}|${f.style}`); },
  createFrame: () => { count.FRAME++; return node('FRAME'); },
  createRectangle: () => { count.RECT = (count.RECT || 0) + 1; return node('RECTANGLE'); },
  createText: () => { count.TEXT++; const n = node('TEXT'); n.fontName = { family: 'Inter', style: 'Regular' }; n.fontSize = 12; return n; },
  createPage: () => { const p = node('PAGE'); pages.push(p); return p; },
  createNodeFromSvg: s => { if (!/^<svg[\s>]/.test(s) || !/<\/svg>$/.test(s)) throw new Error('bad svg'); count.SVG++; const n = node('FRAME'); const w = /width="([\d.]+)"/.exec(s), h = /height="([\d.]+)"/.exec(s); n.width = +(w && w[1]) || 100; n.height = +(h && h[1]) || 100; return n; },
  createImage: bytes => { if (!bytes || !bytes.length) throw new Error('empty image'); return { hash: 'h' + bytes.length }; },
  base64Decode: s => Buffer.from(s, 'base64'),
  setCurrentPageAsync: async p => { figma.currentPage = p; },
  notify: (m, o) => console.log('notify:', m, o && o.error ? '(error)' : ''),
  closePlugin: m => { console.log('closePlugin:', m); done(); },
  viewport: { scrollAndZoomIntoView: () => {} },
  currentPage: null,
};
let done;
new Promise(r => { done = r; }).then(() => {
  const page = pages[0];
  const frames = page ? page.children.filter(c => /^\d\d /.test(c.name)) : [];
  console.log(`pages ${pages.length}, screens ${frames.length}, frames ${count.FRAME}, rects ${count.RECT || 0}, texts ${count.TEXT}, svgs ${count.SVG}`);
  console.log('reactions', frames.reduce((a, f) => { let n = 0; const walk = x => { if (x.reactions && x.reactions.length) n++; x.children.forEach(walk); }; walk(f); return a + n; }, 0), 'flow', JSON.stringify(page && page.flowStartingPoints));
  console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'no problems found');
});
vm.runInNewContext(code, { figma, console, Promise, setTimeout, Math, JSON, Object, Array, Map, Set, Number, String, Boolean, Error });
