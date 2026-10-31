// Redraws the plugin's layer data as HTML and screenshots chosen screens, to compare with the
// real prototype before running the plugin in Figma.   node figma/bereal/preview.cjs <outDir> [name...]
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(process.env.APPDATA, 'npm/node_modules/playwright-core'));

const code = fs.readFileSync(path.resolve(__dirname, '../../output/figma-bereal-plugin/code.js'), 'utf8');
const json = code.slice(code.indexOf('const DATA = ') + 13, code.indexOf(';\n\nconst SW'));
const DATA = JSON.parse(json);
const out = process.argv[2];
const pick = process.argv.slice(3);
const css = c => c ? `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${c.a ?? 1})` : 'transparent';
const stops = s => s.map(x => `${css(x.color)} ${(x.position * 100).toFixed(1)}%`).join(',');
function fill(f) {
  if (f.type === 'SOLID') return css(f.color);
  if (f.type === 'IMAGE') return `center/cover no-repeat url(data:image/jpeg;base64,${DATA.images[f.img]})`;
  if (f.type === 'GRADIENT_LINEAR') return `linear-gradient(${f.deg}deg,${stops(f.stops)})`;
  if (f.type === 'GRADIENT_RADIAL') return `radial-gradient(${(f.rx * 100).toFixed(1)}% ${(f.ry * 100).toFixed(1)}% at ${(f.cx * 100).toFixed(1)}% ${(f.cy * 100).toFixed(1)}%,${stops(f.stops)})`;
  return '';
}
function html(n) {
  const pos = `position:absolute;left:${n.x}px;top:${n.y}px;width:${n.w}px;height:${n.h}px;`;
  if (n.t === 'text') {
    const fam = n.font.families.map(f => `'${f}'`).join(',');
    return `<div style="${pos}${n.wrap ? '' : 'white-space:nowrap;'}font-family:${fam},Inter,sans-serif;font-weight:${n.font.weight};font-style:${n.font.italic ? 'italic' : 'normal'};font-size:${n.size}px;line-height:${n.lh}px;letter-spacing:${n.ls}px;color:${css(n.color)};text-align:${n.align.toLowerCase()}">${n.chars.replace(/</g, '&lt;')}</div>`;
  }
  if (n.t === 'svg') return `<div style="${pos}${n.opacity != null ? `opacity:${n.opacity};` : ''}">${n.svg}</div>`;
  const bg = (n.fills || []).slice().reverse().map(fill).filter(Boolean);
  const r = n.radius ? `border-radius:${n.radius.map(v => v + 'px').join(' ')};` : '';
  const sh = (n.effects || []).filter(e => e.type.endsWith('SHADOW')).map(e => `${e.type === 'INNER_SHADOW' ? 'inset ' : ''}${e.x}px ${e.y}px ${e.blur}px ${e.spread}px ${css(e.color)}`).join(',');
  const blur = (n.effects || []).find(e => e.type === 'BACKGROUND_BLUR');
  const st = n.strokes ? `outline:${n.sw}px ${n.dash ? 'dashed' : 'solid'} ${css(n.strokes[0].color)};outline-offset:-${n.sw}px;` : '';
  const rot = n.rot ? `transform:rotate(${n.rot}deg);` : '';
  return `<div style="${pos}${bg.length ? `background:${bg.join(',')};` : ''}${r}${sh ? `box-shadow:${sh};` : ''}${blur ? `backdrop-filter:blur(${blur.radius}px);` : ''}${st}${rot}${n.opacity != null ? `opacity:${n.opacity};` : ''}${n.clip ? 'overflow:hidden;' : ''}">${(n.children || []).map(html).join('')}</div>`;
}
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1 });
  for (const s of DATA.screens.filter(s => !pick.length || pick.includes(s.name))) {
    const doc = `<!doctype html><html><head><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=Caveat:wght@700&family=Inter:wght@400;500;600;700&family=DM+Serif+Display:ital@0;1&family=Space+Mono:wght@700&display=swap" rel="stylesheet"><style>body{margin:0;background:${css(s.bg)}}#r{position:relative;width:${s.w}px;height:${s.h}px;overflow:hidden}</style></head><body><div id="r">${s.children.map(html).join('')}</div></body></html>`;
    await page.setContent(doc, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const file = path.join(out, s.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.png');
    await page.screenshot({ path: file });
    console.log('saved', file);
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
