/**
 * Renders the playground covers (ui/covers/iface-*) from the interfaces in ui/interfaces/ (2026-10-19).
 * Each cover keeps its file name, format and size, so story-ifaces.js needs no change beyond its cover version.
 *
 *   node scripts/capture-iface-covers.mjs                 every visible interface
 *   node scripts/capture-iface-covers.mjs hr-dashboard …  only these ids
 *
 * Serves the files itself on 127.0.0.1:3305 (never ui/server.mjs). Pages render with reduced motion, so the
 * capture shows each page's settled state, not a frame of its entrance. Desktop interfaces are shot at 1260 px
 * wide (1440 for the wide heroes) at 2x and scaled down; mobile ones are two 390 px screens set in phone frames
 * side by side, like the existing covers. Needs network for the Google Fonts some interfaces load.
 */
import { chromium } from 'playwright';
import sharp from 'sharp';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UI = join(ROOT, 'ui');
const PORT = Number(process.env.COVERS_PORT || 3305);

// id → cover. Mobile entries list their two screens (the order shown in the showcase).
const COVERS = [
  { id: 'revenue-command-center', file: 'iface-revenue-command-center.webp' },
  { id: 'accounting-dashboard', file: 'iface-accounting-dashboard.jpg' },
  { id: 'fleet-tracker', file: 'iface-fleet-tracker.jpg' },
  { id: 'upload-drop-glow', file: 'iface-upload-drop-glow.jpg' },
  { id: 'finvest-convert', file: 'iface-finvest-convert.jpg' },
  { id: 'lyon-saas', file: 'iface-lyon-saas.jpg', wide: true },
  { id: 'munsit-voice-flow', file: 'iface-munsit-voice-flow.webp', screens: ['munsit-compose', 'munsit-studio'], labels: ['Dashboard', 'TTS Studio'], bg: '#111111' },
  { id: 'motion-hero', file: 'iface-motion-hero.jpg', wide: true },
  { id: 'food-details', file: 'iface-food-details.jpg', screens: ['food-home', 'food-details'], bg: '#1b2616' },
  { id: 'medical-dashboard', file: 'iface-medical-dashboard.jpg' },
  { id: 'hr-dashboard', file: 'iface-hr-dashboard.jpg' },
  { id: 'opero-hero', file: 'iface-opero-hero.jpg', wide: true },
  { id: 'maritana-hero', file: 'iface-maritana-hero.webp', wide: true },
  { id: 'n8n-workflow', file: 'iface-n8n-workflow.jpg' },
  { id: 'health-overview', file: 'iface-health-overview.jpg', screens: ['health-overview', 'health-dashboard'], bg: '#1b2616' },
  { id: 'expo-sdk-grid', file: 'iface-expo-sdk-grid.jpg' },
  { id: 'synaptix-hero', file: 'iface-synaptix-hero.jpg', wide: true },
  { id: 'sobers-hero', file: 'iface-sobers-hero.jpg', wide: true },
  { id: 'analytics-card', file: 'iface-analytics-card.jpg' },
  { id: 'devpilot-hero', file: 'iface-devpilot-hero.jpg', wide: true },
  { id: 'bento-features', file: 'iface-bento-features.jpg' },
  { id: 'viora-health', file: 'iface-viora-health-v2.jpg' },
  { id: 'remoterecruit-redesign', file: 'iface-remoterecruit-redesign-v2.jpg' },
  { id: 'linkedin-jobs-playground', file: 'iface-linkedin-jobs-playground-v2.jpg' },
];

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.webm': 'video/webm' };
// The same short URLs the real server answers: /interfaces, /effects, /portfolio, /covers live under ui/; /images at the root.
function fileFor(urlPath) {
  const p = decodeURIComponent(urlPath.split('?')[0]);
  const rel = normalize(p).replace(/^[/\\]+/, '');
  if (rel.startsWith('..')) return null;
  if (/^ui[/\\]/.test(rel)) return [join(ROOT, rel)];
  if (/^images[/\\]/.test(rel)) return [join(ROOT, rel), join(UI, rel)];
  return [join(UI, rel), join(ROOT, rel)];
}
function serve() {
  const server = createServer(async (req, res) => {
    for (const f of fileFor(req.url) || []) {
      try {
        if (!(await stat(f)).isFile()) continue;
        res.writeHead(200, { 'Content-Type': TYPES[extname(f).toLowerCase()] || 'application/octet-stream' });
        res.end(await readFile(f));
        return;
      } catch { /* try the next root */ }
    }
    res.writeHead(404).end();
  });
  return new Promise((ok) => server.listen(PORT, '127.0.0.1', () => ok(server)));
}

async function shoot(page, id, width, height, scale) {
  await page.setViewportSize({ width, height });
  await page.goto(`http://127.0.0.1:${PORT}/interfaces/${id}.html`, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
  await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
  await page.waitForTimeout(1800);
  return page.screenshot({ type: 'png', clip: { x: 0, y: 0, width, height }, scale: scale === 1 ? 'css' : 'device' });
}

function encode(img, file) {
  return /\.webp$/.test(file) ? img.webp({ quality: 84 }) : img.jpeg({ quality: 84, mozjpeg: true });
}

// Two phones side by side, the same composition as the existing mobile covers.
async function phones(shots, { w, h, bg, labels }) {
  const labelsH = labels ? Math.round(h * 0.06) : 0;
  const phoneH = Math.round((h - labelsH) * (labels ? 0.94 : 0.97));
  const phoneW = Math.round(phoneH * 0.49);
  const gap = Math.round(w * 0.04);
  const left = Math.round((w - (phoneW * 2 + gap)) / 2);
  const top = labels ? Math.round(h * 0.02) : Math.round(h * 0.025);
  const bezel = Math.max(6, Math.round(phoneW * 0.035));
  const radius = Math.round(phoneW * 0.16);
  const layers = [];
  for (let i = 0; i < 2; i++) {
    const x = left + i * (phoneW + gap);
    const frame = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${phoneW}" height="${phoneH}"><rect x="1" y="1" width="${phoneW - 2}" height="${phoneH - 2}" rx="${radius}" fill="#1c1c1e" stroke="#3a3a3c" stroke-width="2"/></svg>`);
    const sw = phoneW - bezel * 2;
    const sh = phoneH - bezel * 2;
    const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${sw}" height="${sh}"><rect width="${sw}" height="${sh}" rx="${radius - bezel}" fill="#fff"/></svg>`);
    const screen = await sharp(shots[i]).resize(sw, sh, { fit: 'cover', position: 'top' }).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
    layers.push({ input: frame, left: x, top }, { input: screen, left: x + bezel, top: top + bezel });
    if (labels) {
      const lbl = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${phoneW}" height="${labelsH}"><text x="50%" y="70%" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="${Math.round(labelsH * 0.42)}" fill="#6b6b6b">${labels[i]}</text></svg>`);
      layers.push({ input: lbl, left: x, top: top + phoneH + 2 });
    }
  }
  return sharp({ create: { width: w, height: h, channels: 3, background: bg } }).composite(layers);
}

sharp.cache(false);
const only = new Set(process.argv.slice(2));
const list = COVERS.filter((c) => !only.size || only.has(c.id) || (c.screens || []).some((s) => only.has(s)));
const server = await serve();
const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, reducedMotion: 'reduce', colorScheme: 'light' });
const page = await ctx.newPage();
page.on('dialog', (d) => d.dismiss().catch(() => {}));
try {
  for (const c of list) {
    const out = join(UI, 'covers', c.file);
    // read through a buffer: on Windows sharp keeps a file it opened locked, and the write below would fail
    const meta = await readFile(out).then((b) => sharp(b).metadata()).catch(() => ({ width: 840, height: 570 }));
    const w = meta.width || 840;
    const h = meta.height || 570;
    try {
      let img;
      if (c.screens) {
        const shots = [];
        for (const s of c.screens) shots.push(await shoot(page, s, 390, 844, 2));
        img = await phones(shots, { w, h, bg: c.bg || '#111111', labels: c.labels });
      } else {
        const vw = c.wide ? 1440 : 1260;
        const vh = Math.round(vw * h / w);
        img = sharp(await shoot(page, c.id, vw, vh, 2)).resize(w, h, { fit: 'cover', position: 'top' });
      }
      await encode(img, c.file).toFile(out);
      console.log('ok  ', c.file, `${w}x${h}`);
    } catch (err) {
      console.log('FAIL', c.file, err.message.split('\n')[0]);
    }
  }
} finally {
  await browser.close();
  server.close();
}
