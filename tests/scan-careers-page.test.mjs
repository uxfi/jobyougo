// tests/scan-careers-page.test.mjs — Level 1 Playwright careers-page scraping.
import { createServer } from 'http';
import { pathToFileURL } from 'url';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nScanner — careers page');

const { scrapeCareersPage } = await import(pathToFileURL(join(ROOT, 'lib/scan-careers-page.mjs')).href);

const server = createServer((req, res) => {
  if (req.url !== '/') {
    res.writeHead(404);
    res.end('not found');
    return;
  }

  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html>
    <html>
      <body>
        <nav><a href="/careers">Careers</a></nav>
        <main id="jobs"></main>
        <script>
          setTimeout(() => {
            document.getElementById('jobs').innerHTML = '<article><h2>Senior AI Product Manager</h2><p>Remote - Europe</p><a href="/jobs/senior-ai-product-manager">View role</a></article>';
          }, 1200);
        </script>
      </body>
    </html>`);
});

try {
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', resolve);
    server.on('error', reject);
  });
  const { port } = server.address();
  const jobs = await scrapeCareersPage(`http://127.0.0.1:${port}/`, 'Slow SPA Co', {
    timeoutMs: 12000,
    maxResults: 5,
    headless: true,
  });

  if (jobs.length === 1 && jobs[0].title === 'Senior AI Product Manager') {
    pass('scrapeCareersPage waits for delayed posting-shaped links before extracting');
  } else {
    fail(`scrapeCareersPage returned ${JSON.stringify(jobs)}, expected one delayed job`);
  }

  if (jobs[0]?.location?.includes('Remote - Europe')) {
    pass('scrapeCareersPage keeps nearby card text for remote/geo filtering');
  } else {
    fail(`scrapeCareersPage location context = ${JSON.stringify(jobs[0]?.location)}`);
  }
} catch (e) {
  fail(`scan-careers-page test crashed: ${e.message}`);
} finally {
  await new Promise(resolve => server.close(resolve));
}
