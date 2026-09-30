/**
 * Capture OneAsset portfolio screenshots in the white (light) theme.
 * Usage: node scripts/capture-oneasset-light.mjs
 * Requires the portfolio UI server (default http://127.0.0.1:3210).
 */
import { chromium } from 'playwright';
import { mkdir, writeFile, rename, copyFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'images');
const BASE = process.env.OA_BASE || 'http://127.0.0.1:3210/demos/oneasset/';
const THEME = 'light';

// file → query (actor/screen or site). fullPage for tall scroll captures.
const SHOTS = [
  { file: 'oneasset-v2-inv-dashboard.webp', q: 'actor=investor&screen=dashboard' },
  { file: 'oneasset-v2-inv-market.webp', q: 'actor=investor&screen=market' },
  { file: 'oneasset-v2-inv-portfolio.webp', q: 'actor=investor&screen=portfolio' },
  { file: 'oneasset-v2-inv-funds.webp', q: 'actor=investor&screen=funds' },
  { file: 'oneasset-v2-inv-deal.webp', q: 'actor=investor&screen=market', clickFirstDeal: true },
  { file: 'oneasset-v2-inv-deal-full.webp', q: 'actor=investor&screen=market', clickFirstDeal: true, fullPage: true },
  { file: 'oneasset-v2-pm-dashboard.webp', q: 'actor=pmMain&screen=dashboard' },
  { file: 'oneasset-v2-pm-properties.webp', q: 'actor=pmMain&screen=properties' },
  { file: 'oneasset-v2-pm-reports.webp', q: 'actor=pmMain&screen=reports' },
  { file: 'oneasset-v2-pm-kyb.webp', q: 'actor=pmMain&screen=pm-onboarding&step=1' },
  { file: 'oneasset-v2-pmgr-portfolio.webp', q: 'actor=portfolioManager&screen=pmgr-portfolio' },
  { file: 'oneasset-v2-pmgr-waterfall.webp', q: 'actor=portfolioManager&screen=pmgr-waterfall' },
  { file: 'oneasset-v2-ops-listings.webp', q: 'actor=opsListing&screen=listing-listings' },
  { file: 'oneasset-v2-comp-dashboard.webp', q: 'actor=compliance&screen=compliance-dashboard' },
  { file: 'oneasset-v2-comp-review.webp', q: 'actor=compliance&screen=compliance-queue' },
  { file: 'oneasset-v2-admin-payouts.webp', q: 'actor=admin&screen=admin-payouts' },
  { file: 'oneasset-v2-partner-dashboard.webp', q: 'actor=partnerOpen&screen=dashboard' },
  { file: 'oneasset-v2-design-system.webp', q: 'actor=pmMain&screen=design-system-v2' },
  { file: 'oneasset-v2-cover.webp', q: 'actor=investor&screen=dashboard', coverCrop: true },
];

function urlFor(q) {
  return `${BASE}?${q}&theme=${THEME}`;
}

async function waitReady(page) {
  await page.waitForTimeout(800);
  await page.waitForSelector('.shell, .marketing-site, [data-oa-root], #root', { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1800);
}

async function ensureLight(page) {
  await page.evaluate(() => {
    const shell = document.querySelector('.shell');
    if (shell && !shell.classList.contains('light')) {
      shell.classList.add('light');
      shell.classList.remove('dark');
    }
    document.documentElement.dataset.theme = 'light';
    document.documentElement.classList.add('light');
    document.documentElement.classList.remove('dark');
  });
}

async function clickFirstDeal(page) {
  const selectors = [
    '.oa-listing-card-inner',
    '.properties-card-grid .properties-card-photo',
    '[class*="listing-card"]',
    'a[href*="property"]',
    '[data-property-id]',
  ];
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (await el.count().catch(() => 0)) {
      try {
        await el.click({ timeout: 5000 });
        await page.waitForTimeout(2800);
        return true;
      } catch {}
    }
  }
  return false;
}

async function pngToWebp(pngPath, webpPath) {
  // Prefer sharp if present; else keep png and rename attempt via magick; else copy png→webp name (browser ok? no).
  try {
    const sharp = (await import('sharp')).default;
    await sharp(pngPath).webp({ quality: 82 }).toFile(webpPath);
    return;
  } catch {}
  try {
    execFileSync('magick', [pngPath, '-quality', '82', webpPath], { stdio: 'ignore' });
    return;
  } catch {}
  // Last resort: store as PNG with .webp name is bad; keep .png sibling and copy bytes won't decode as webp.
  // Use Chrome CDP to encode? Simpler: write a tiny node canvas-free approach — just use playwright screenshot type jpeg then... 
  // Actually Playwright can only do png. Install sharp on the fly is heavy.
  // Fallback: leave as .png then rename extension for now — browsers may fail.
  // Better: use PowerShell/Windows Imaging? Unreliable for webp.
  await copyFile(pngPath, webpPath.replace(/\.webp$/, '.png'));
  throw new Error(`No webp encoder (install sharp). PNG saved beside ${webpPath}`);
}

async function captureOne(page, shot) {
  let q = shot.q;
  const url = urlFor(q);
  console.log('→', shot.file, url);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await waitReady(page);
  await ensureLight(page);

  // If primary screen 404s-ish empty, try alts
  if (shot.altScreens?.length) {
    const empty = await page.evaluate(() => {
      const main = document.querySelector('main');
      return !main || main.innerText.trim().length < 40;
    });
    if (empty) {
      for (const alt of shot.altScreens) {
        const aq = q.replace(/screen=[^&]+/, `screen=${alt}`);
        await page.goto(urlFor(aq), { waitUntil: 'domcontentloaded', timeout: 120000 });
        await waitReady(page);
        await ensureLight(page);
        const ok = await page.evaluate(() => {
          const main = document.querySelector('main');
          return main && main.innerText.trim().length > 40;
        });
        if (ok) { q = aq; break; }
      }
    }
  }

  if (shot.clickFirstDeal) {
    const ok = await clickFirstDeal(page);
    console.log('  deal click:', ok);
    await ensureLight(page);
  }

  const png = join(OUT, `_${shot.file}.png`);
  const webp = join(OUT, shot.file);

  if (shot.coverCrop) {
    await page.screenshot({ path: png, clip: { x: 0, y: 0, width: 1440, height: 720 } });
  } else if (shot.fullPage) {
    await page.screenshot({ path: png, fullPage: true });
  } else {
    await page.screenshot({ path: png });
  }

  try {
    await pngToWebp(png, webp);
    console.log('  saved', shot.file);
  } catch (e) {
    console.warn('  webp fail:', e.message);
    // Keep PNG with temporary name; caller may convert later
  }
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  // Hide cursor / stabilize
  await page.addInitScript(() => {
    localStorage.setItem('oneasset-theme', 'light');
  });

  const failed = [];
  for (const shot of SHOTS) {
    try {
      await captureOne(page, shot);
    } catch (e) {
      console.error('FAIL', shot.file, e.message);
      failed.push(shot.file);
    }
  }

  await browser.close();
  if (failed.length) {
    console.error('Failed:', failed.join(', '));
    process.exitCode = 1;
  } else {
    console.log('All light screenshots captured.');
  }
}

main();
