import { chromium } from 'playwright';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SHOTS = [
  { id: 'upviral',  url: 'https://upviral.com' },
  { id: 'creads',   url: 'https://www.creads.io/' },
];

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});

for (const { id, url } of SHOTS) {
  const page = await context.newPage();
  try {
    console.log(`📸 ${id} → ${url}`);
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(1500);
    const out = join(__dirname, 'ui/covers', `${id}.jpg`);
    await page.screenshot({ path: out, type: 'jpeg', quality: 85, clip: { x: 0, y: 0, width: 1440, height: 900 } });
    console.log(`   ✅ saved`);
  } catch (err) {
    console.warn(`   ⚠️  ${err.message}`);
  }
  await page.close();
}

await browser.close();
console.log('\nDone.');
