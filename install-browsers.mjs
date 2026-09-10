import { execSync } from 'node:child_process';

// Vercel's build container has no apt-get, so a Playwright browser install
// always fails there and (being a postinstall step) takes the whole build
// down with it. The deployed piece is ui/server.mjs, which never launches a
// browser, so skip entirely when running in Vercel's build.
if (!process.env.VERCEL) {
  try {
    execSync('npx playwright install chromium --with-deps', { stdio: 'inherit' });
  } catch {
    execSync('npx playwright install chromium --with-deps', { stdio: 'inherit' });
  }
}
