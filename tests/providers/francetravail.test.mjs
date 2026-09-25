import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — francetravail');

const html = `<ul class="result-list"><li data-id-offre="211QHCQ" class="result"><a href="/offres/recherche/detail/211QHCQ"><h2><span class="media-heading-title">Product Designer Senior (H/F)</span></h2><p class="subtext">BRAIN LOGIC&nbsp;-&nbsp;<span>75 - Paris 12e</span></p><p class="description">Projets digitaux.</p></a></li><li data-id-offre="NOPE" class="other">skip</li></ul>`;

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/francetravail.mjs')).href);
  const provider = mod.default;
  const { parseFrancetravailConfig, buildFrancetravailSearchUrl, parseFrancetravailResults, resolveFrancetravailRedirect } = mod;

  if (provider.id === 'francetravail') pass('francetravail.id');
  else fail(`id = ${provider.id}`);

  const claimed = provider.detect({ careers_url: 'https://candidat.francetravail.fr/rechercheoffre/emploi' });
  if (claimed?.url === 'https://candidat.francetravail.fr/offres/recherche') pass('detect() claims the public candidate host');
  else fail(`detect() = ${JSON.stringify(claimed)}`);
  if (provider.detect({ careers_url: 'https://example.com/jobs' }) === null) pass('detect() ignores other hosts');
  else fail('detect() should ignore other hosts');

  const cfg = parseFrancetravailConfig({
    francetravail: { keywords: [' Product Designer ', '', 'Product Designer', 'UX Designer'], max_pages: 99 },
  });
  if (JSON.stringify(cfg.keywords) === JSON.stringify(['Product Designer', 'UX Designer']) && cfg.maxPages === 5) {
    pass('parseFrancetravailConfig dedups keywords and clamps pages');
  } else fail(`config = ${JSON.stringify(cfg)}`);

  const url = new URL(buildFrancetravailSearchUrl({ keyword: 'Product Designer', page: 1 }));
  if (
    url.hostname === 'candidat.francetravail.fr'
    && url.searchParams.get('motsCles') === 'Product Designer'
    && url.searchParams.get('range') === '20-39'
    && url.searchParams.get('offresPartenaires') === 'true'
  ) pass('buildFrancetravailSearchUrl() pages by 20');
  else fail(`url = ${url.href}`);

  const jobs = parseFrancetravailResults(html);
  if (
    jobs.length === 1
    && jobs[0].title === 'Product Designer Senior (H/F)'
    && jobs[0].company === 'BRAIN LOGIC'
    && jobs[0].location === '75 - Paris 12e, France'
    && jobs[0].url === 'https://candidat.francetravail.fr/offres/recherche/detail/211QHCQ'
    && jobs[0].description === 'Projets digitaux.'
  ) pass('parseFrancetravailResults() maps a public result card');
  else fail(`jobs = ${JSON.stringify(jobs)}`);

  const search = 'https://candidat.francetravail.fr/offres/recherche?motsCles=Product+Manager';
  const followed = resolveFrancetravailRedirect(search, 301, '/offres/emploi/product-manager/s28m17');
  const refused = resolveFrancetravailRedirect(search, 301, 'https://evil.example/offres');
  if (
    followed === 'https://candidat.francetravail.fr/offres/emploi/product-manager/s28m17'
    && refused === null
    && resolveFrancetravailRedirect(search, 200, '/offres/emploi/product-manager/s28m17') === null
  ) pass('resolveFrancetravailRedirect() follows only a same-host hop');
  else fail(`redirect followed=${followed} refused=${refused}`);

  if (parseFrancetravailResults('<li data-id-offre="A1" class="result"><span class="media-heading-title"></span></li>').length === 0) {
    pass('parseFrancetravailResults() drops a card without a title');
  } else fail('empty title should be dropped');
} catch (err) {
  fail(`francetravail suite threw: ${err.message}`);
}
