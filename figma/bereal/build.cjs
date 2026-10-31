// Builds the Figma plugin that recreates every screen of the BeReal. prototype as editable layers.
//   node figma/bereal/build.cjs            -> output/figma-bereal-plugin/{manifest.json, code.js}
// Needs the global playwright-core and the installed Chrome (same setup as the screen export).
// Each state is set up in the real prototype, then snapshot-dom.js reads #app into a layer tree.
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { pathToFileURL, fileURLToPath } = require('url');
const { chromium } = require(path.join(process.env.APPDATA, 'npm/node_modules/playwright-core'));

const ROOT = path.resolve(__dirname, '../..');
const PROTO = pathToFileURL(path.join(ROOT, 'ui/demos/bereal/index.html')).href;
const OUT = path.join(ROOT, 'output/figma-bereal-plugin');
const TMP = path.join(OUT, '.img');
const wait = ms => new Promise(r => setTimeout(r, ms));

// group, name, setup(page). Order = order on the canvas.
const STATES = [
  ['Start', 'First open', async p => { await load(p); }],
  ['Camera', 'Camera', async p => { await load(p, '?step=capture'); }],
  ['Camera', 'Timer explained', async p => { await load(p, '?step=capture'); await p.click('#timer'); await wait(300); }],
  ['Camera', 'Selfie hidden', async p => { await load(p, '?step=capture'); await dragPip(p); }],
  ['Camera', 'Recording', async p => { await load(p, '?step=capture'); const s = await p.locator('#shoot').boundingBox(); await p.mouse.move(s.x + s.width / 2, s.y + s.height / 2); await p.mouse.down(); await wait(3300); p.__release = true; }],
  ['Camera', 'No live selfie', async p => { await load(p, '?step=capture&multicam=0'); }],
  ['Context', 'Preview', async p => { await load(p, '?step=context'); await p.evaluate(() => { const B = window.__bereal; B.state.ctx = {}; B.renderCtx(); }); await wait(300); }],
  ['Context', 'Caption', async p => { await load(p, '?step=context'); await p.evaluate(() => { const B = window.__bereal; B.state.ctx = { caption: 'sunday reset ☀️' }; B.renderCtx(); }); await p.click('.tool[data-tool="caption"]'); await wait(500); }],
  ['Context', 'Place', async p => { await ctx(p, { caption: 'sunday reset ☀️' }); await p.click('.tool[data-tool="location"]'); await wait(500); }],
  ['Context', 'Music', async p => { await ctx(p, { caption: 'sunday reset ☀️', location: 'Paris 11e' }); await p.click('.tool[data-tool="music"]'); await wait(500); }],
  ['Context', 'Tag', async p => { await ctx(p, { caption: 'sunday reset ☀️', location: 'Paris 11e', music: '♪ Golden hour' }); await p.click('.tool[data-tool="tag"]'); await wait(500); }],
  ['Context', 'Stickers, Film', async p => { await ctx(p, FULL); await p.evaluate(() => window.__bereal.setFlt(1, true)); await wait(1200); }],
  ['Context', 'Drag to the trash', async p => { await ctx(p, { caption: 'sunday reset ☀️', location: 'Paris 11e', music: '♪ Golden hour' }); await dragToTrash(p); p.__release = true; }],
  ['Context', 'All songs, preview', async p => { await ctx(p, { caption: 'sunday reset ☀️', location: 'Paris 11e' }); await p.click('.tool[data-tool="music"]'); await wait(400); await p.click('#suggAll'); await wait(500); await p.click('.pk-play >> nth=1'); await wait(2500); }],
  ['Context', 'All friends to tag', async p => { await ctx(p, { caption: 'sunday reset ☀️', location: 'Paris 11e', music: '♪ Golden hour' }); await p.click('.tool[data-tool="tag"]'); await wait(400); await p.click('#suggAll'); await wait(500); }],
  ['Audience', 'Pick a circle', async p => { await ctx(p, FULL); await p.click('#audOpen'); await wait(700); }],
  ['Audience', 'Two circles', async p => { await ctx(p, FULL); await p.click('#audOpen'); await wait(600); await p.click('.opt[data-aud="close"]'); await wait(200); await p.click('.opt[data-aud="family"]'); await wait(700); }],
  ['Audience', 'Edit a circle', async p => { await ctx(p, FULL); await p.click('#audOpen'); await wait(600); await p.click('.opt[data-aud="room"] .edit-l'); await wait(900); }],
  ['Audience', 'New circle', async p => { await ctx(p, FULL); await p.click('#audOpen'); await wait(600); await p.click('#newC'); await wait(900); }],
  ['Post', 'Sent', async p => { await ctx(p, FULL); await p.click('#audOpen'); await wait(600); await p.click('.opt[data-aud="close"]'); await wait(200); await p.click('#postBtn'); await wait(700); }],
  ['Feed', 'Feed', async p => { await feed(p); }],
  ['Feed', 'RealMojis', async p => { await feed(p); await p.evaluate(() => { const f = document.querySelector('.feed'); const q = document.querySelector('.post'); f.scrollTop = q.offsetTop - 90; }); await wait(300); await p.click('.post .rm-btn'); await wait(600); }],
  ['Feed', 'Circles only', async p => { await feed(p); await p.click('[data-f="circle"]'); await wait(600); }],
  ['Feed', 'My BeReal.', async p => { await feed(p); await p.click('#mineDual'); await wait(700); }],
  ['Feed', 'Options', async p => { await feed(p); await p.click('#mineDual'); await wait(600); await p.click('#odMore'); await wait(600); }],
  ['Feed', 'Seen by', async p => { await feed(p); await p.click('#mineDual'); await wait(600); await p.click('#odMore'); await wait(500); await p.click('[data-os="seen"]'); await wait(600); }],
];
const FULL = { caption: 'sunday reset ☀️', location: 'Paris 11e', music: '♪ Golden hour', tag: '@julie.d' };

async function load(p, q = '') {
  await p.goto(PROTO + q);
  await p.evaluate(() => document.fonts.ready);
  await p.addStyleTag({ content: '.restart { display:none !important; }' });
  await wait(1200);
}
async function ctx(p, c) {
  await load(p, '?step=context');
  await p.evaluate(c => { const B = window.__bereal; B.state.ctx = c; B.renderCtx(); }, c);
  await wait(1500);
}
async function feed(p) {
  await ctx(p, FULL);
  await p.click('#audOpen'); await wait(600);
  await p.click('.opt[data-aud="close"]'); await wait(200);
  await p.click('#postBtn'); await wait(3800);
}
async function dragPip(p) {
  const b = await p.locator('#camPip').boundingBox();
  await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await p.mouse.down();
  for (let i = 1; i <= 10; i++) { await p.mouse.move(b.x + b.width / 2 - i * 18, b.y + b.height / 2 + i); await wait(16); }
  await p.mouse.up(); await wait(900);
}
async function dragToTrash(p) {
  const s = await p.locator('#chips .s-mus').boundingBox();
  const cam = await p.locator('#editDual').boundingBox();
  await p.mouse.move(s.x + s.width / 2, s.y + s.height / 2); await p.mouse.down();
  const tx = cam.x + cam.width / 2, ty = cam.y + cam.height - 41;
  for (let i = 1; i <= 14; i++) { await p.mouse.move(s.x + s.width / 2 + (tx - s.x - s.width / 2) * i / 14, s.y + s.height / 2 + (ty - s.y - s.height / 2) * i / 14); await wait(20); }
  await wait(500);
}

// prototype images (WebP) become JPEG for Figma, once each
function convertImages(urls) {
  fs.mkdirSync(TMP, { recursive: true });
  return urls.map((u, i) => {
    const src = fileURLToPath(u);
    const out = path.join(TMP, `${i}.jpg`);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-vf', "scale='min(1100,iw)':-2", '-q:v', '3', out]);
    return fs.readFileSync(out).toString('base64');
  });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const snapJs = fs.readFileSync(path.join(__dirname, 'snapshot-dom.js'), 'utf8');
  const screens = [];
  for (const [group, name, setup] of STATES) {
    page.__release = false;
    await setup(page);
    await page.addScriptTag({ content: snapJs });
    const tree = await page.evaluate(() => window.__figmaSnap());
    if (page.__release) { await page.mouse.up(); await wait(300); }
    screens.push({ group, name, ...tree });
    console.log('snap', group, '/', name);
  }
  await browser.close();

  // swap image URLs for ids
  const urls = [];
  const visit = n => {
    // inline data: images (film grain, tiny check marks) stay out: only real photos travel
    if (n.fills) n.fills = n.fills.filter(f => f.type !== 'IMAGE' || f.url.startsWith('file:'));
    for (const f of n.fills || []) if (f.type === 'IMAGE') { let i = urls.indexOf(f.url); if (i < 0) { i = urls.push(f.url) - 1; } f.img = i; delete f.url; }
    (n.children || []).forEach(visit);
  };
  screens.forEach(visit);
  const images = convertImages(urls);
  const data = { title: 'BeReal. Design Challenge', author: 'Hugo Vermot', screens, images };
  const json = JSON.stringify(data);
  const plugin = fs.readFileSync(path.join(__dirname, 'plugin.js'), 'utf8').replace('/*__DATA__*/null', () => json);
  fs.writeFileSync(path.join(OUT, 'code.js'), plugin);
  fs.copyFileSync(path.join(__dirname, 'manifest.json'), path.join(OUT, 'manifest.json'));
  fs.rmSync(TMP, { recursive: true, force: true });
  const count = n => 1 + (n.children || []).reduce((a, c) => a + count(c), 0);
  console.log(`${screens.length} screens, ${screens.reduce((a, s) => a + count(s) - 1, 0)} layers, ${images.length} images, code.js ${(Buffer.byteLength(plugin) / 1e6).toFixed(1)} MB`);
  console.log(errors.length ? 'PAGE ERRORS:\n' + [...new Set(errors)].join('\n') : 'no page errors');
})().catch(e => { console.error(e); process.exit(1); });
