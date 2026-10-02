/**
 * Capture Creads portfolio screenshots from the local portfolio-demo server.
 * Usage: Creads already running with PORTFOLIO_DEMO=1 / NEXT_PUBLIC_PORTFOLIO_DEMO=1 on :3000
 *   node scripts/capture-creads.mjs
 */
import { chromium } from 'playwright';
import { mkdir, unlink } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'images');
const BASE = process.env.CR_BASE || 'http://127.0.0.1:3000';

const DEMO_TOKEN =
  'eyJhbGciOiJub25lIn0.eyJzdWIiOiJwb3J0Zm9saW8tZGVtbyIsIm5hbWUiOiJDcmVhZHMgUG9ydGZvbGlvIiwiZW1haWwiOiJkZW1vQGNyZWFkcy5pbyIsInBvcnRmb2xpbyI6dHJ1ZX0.portfolio';

const PUBLIC_SHOTS = [
  { file: 'creads-live-hero.webp', path: '/?portfolio=1', clip: { x: 0, y: 0, width: 1440, height: 900 } },
  { file: 'screenshot_creads.webp', path: '/?portfolio=1', clip: { x: 0, y: 0, width: 1440, height: 900 } },
  { file: 'creads-v2-home-full.webp', path: '/?portfolio=1', fullPage: true },
];

const APP_SHOTS = [
  { file: 'creads-v2-dashboard.webp', path: '/dashboard?portfolio=1', need: '/dashboard' },
  { file: 'creads-v2-studio.webp', path: '/dashboard/studio?portfolio=1', need: '/dashboard/studio' },
  { file: 'creads-v2-brand.webp', path: '/dashboard/brand?portfolio=1', need: '/dashboard/brand' },
  { file: 'creads-v2-analyse.webp', path: '/dashboard/analyse?portfolio=1', need: '/dashboard/analyse', alt: ['/dashboard/studio/analyses?portfolio=1'] },
  { file: 'creads-v2-inspiration.webp', path: '/dashboard/products?portfolio=1', need: '/dashboard/products' },
  { file: 'creads-live-feature.webp', path: '/dashboard?portfolio=1', clip: { x: 0, y: 0, width: 1440, height: 900 }, need: '/dashboard' },
  { file: 'creads-admin.png', path: '/dashboard/products?portfolio=1', need: '/dashboard/products', asPng: true },
  { file: 'creads-bot.png', path: '/dashboard/ai?portfolio=1', need: '/dashboard/ai', alt: ['/dashboard/studio?portfolio=1'], asPng: true },
];

async function dismissOverlays(page) {
  for (const label of ['Accept All', 'Reject', 'Close']) {
    const btn = page.getByRole('button', { name: label }).first();
    if (await btn.count()) {
      try { await btn.click({ timeout: 1500 }); await page.waitForTimeout(300); } catch {}
    }
  }
}

async function goto(page, path) {
  const url = `${BASE}${path}`;
  console.log('→', url);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(4500);
  await dismissOverlays(page);
  await page.waitForTimeout(1000);
}

async function saveShot(page, shot) {
  const png = join(OUT, `_${shot.file}.tmp.png`);
  const opts = shot.fullPage
    ? { path: png, fullPage: true, timeout: 90000 }
    : shot.clip
      ? { path: png, clip: shot.clip, timeout: 90000 }
      : { path: png, timeout: 90000 };
  await page.screenshot(opts);
  const out = join(OUT, shot.file);
  if (shot.asPng || shot.file.endsWith('.png')) {
    await sharp(png).png().toFile(out);
  } else {
    await sharp(png).webp({ quality: 82 }).toFile(out);
  }
  try { await unlink(png); } catch {}
  console.log('  saved', shot.file, 'from', page.url());
}

async function capturePublic(browser) {
  // No auth seed — marketing must stay on /
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => {
    try {
      localStorage.removeItem('meta_auth_token');
      localStorage.removeItem('creads_portfolio_demo');
      localStorage.removeItem('selected_account');
    } catch {}
  });
  const page = await context.newPage();
  const failed = [];
  for (const shot of PUBLIC_SHOTS) {
    try {
      await goto(page, shot.path);
      if (page.url().includes('/dashboard')) throw new Error('redirected to dashboard');
      await saveShot(page, shot);
    } catch (e) {
      console.error('FAIL', shot.file, e.message);
      failed.push(shot.file);
    }
  }
  await context.close();
  return failed;
}

async function captureApp(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(({ token }) => {
    try {
      localStorage.setItem('creads_portfolio_demo', '1');
      localStorage.setItem('meta_auth_token', token);
      localStorage.setItem('creads_onboarding_completed', 'true');
      localStorage.setItem('creads_current_user_id', 'portfolio-demo');
    } catch {}
  }, { token: DEMO_TOKEN });
  const page = await context.newPage();
  const failed = [];
  for (const shot of APP_SHOTS) {
    try {
      let ok = false;
      for (const p of [shot.path, ...(shot.alt || [])]) {
        await goto(page, p);
        const url = page.url();
        const bodyLen = await page.evaluate(() => (document.body?.innerText || '').trim().length);
        const need = shot.need;
        if (bodyLen > 40 && (!need || url.includes(need.split('?')[0]))) {
          ok = true;
          break;
        }
        console.warn('  skip', p, 'url=', url, 'len=', bodyLen);
      }
      if (!ok) throw new Error(`Could not load ${shot.file}`);
      await saveShot(page, shot);
    } catch (e) {
      console.error('FAIL', shot.file, e.message);
      failed.push(shot.file);
    }
  }
  await context.close();
  return failed;
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const failed = [
  ...(await capturePublic(browser)),
  ...(await captureApp(browser)),
];
await browser.close();
if (failed.length) {
  console.error('Failed:', failed.join(', '));
  process.exitCode = 1;
} else {
  console.log('All Creads screenshots captured.');
}
