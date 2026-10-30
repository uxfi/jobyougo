import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AGENCE_SUBPAGES,
  PORTFOLIO_CSS_MARKER,
  agenceRedirectTarget,
  agenceSubpageId,
  agencyLanguageInstruction,
  buildAgencyChatPrompt,
  firstHeadStyle,
  isAgencePagePath,
  loadAgencyOffers,
  renderAgencePage,
  renderAgenceSubpage,
  resolveChatPersona,
} from '../lib/agence-site.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'agence-site-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Move a file's mtime to a fixed, distinct value so cache keys change deterministically.
function touch(file, seconds) {
  utimesSync(file, seconds, seconds);
}

test('agenceRedirectTarget: aliases go to /agence with the query preserved', () => {
  for (const p of ['/agency', '/agency/', '/agence/', '/agency.html']) {
    assert.equal(agenceRedirectTarget(p, ''), '/agence');
    assert.equal(agenceRedirectTarget(p, '?utm_source=x&a=1'), '/agence?utm_source=x&a=1');
  }
  for (const p of ['/agence', '/agence.html', '/agence/layout-x', '/agence/showcase', '/portfolio', '/', '/agencyx', '/api/hrhv']) {
    assert.equal(agenceRedirectTarget(p, '?q=1'), null, p);
  }
  assert.equal(agenceRedirectTarget('/agence/services/', '?lang=fr'), '/agence/services?lang=fr');
  assert.equal(agenceRedirectTarget('/agence/secret-touch/', ''), '/agence/secret-touch');
  assert.equal(agenceRedirectTarget('/agence/nope/', ''), null);
});

test('agenceSubpageId', () => {
  for (const slug of ['showcase', 'services', 'pricing', 'secret-touch']) {
    assert.equal(agenceSubpageId('/agence/' + slug), slug);
  }
  for (const p of ['/agence', '/agence/', '/agence/showcase/', '/agence/other', '/agency/services', undefined]) {
    assert.equal(agenceSubpageId(p), null, String(p));
  }
});

test('renderAgenceSubpage: splices the fragment and the slug', async (t) => {
  const dir = tempDir(t);
  mkdirSync(join(dir, 'agence'));
  writeFileSync(join(dir, 'agence', 'page.html'), '<html><!--@navtone-->|<!--@slug-->|<!--@main-->|<!--@slug--></html>');
  writeFileSync(join(dir, 'agence', 'services.html'), '<section id="services">four ways</section>');
  const html = await renderAgenceSubpage(dir, 'services');
  assert.equal(html, '<html>on-light|services|<section id="services">four ways</section>|services</html>');
  assert.equal(await renderAgenceSubpage(dir, 'services'), html);
  assert.equal(await renderAgenceSubpage(dir, 'showcase'), null);
  assert.equal(await renderAgenceSubpage(dir, 'nope'), null);
});

test('renderAgenceSubpage: the order thanks page is not indexed; other pages add nothing to the head', async (t) => {
  const dir = tempDir(t);
  mkdirSync(join(dir, 'agence'));
  writeFileSync(join(dir, 'agence', 'page.html'), '<head><!--@head--></head><body class="<!--@navtone-->"><!--@main--></body>');
  writeFileSync(join(dir, 'agence', 'thanks.html'), '<section id="thanks"></section>');
  writeFileSync(join(dir, 'agence', 'pricing.html'), '<section id="pricing"></section>');
  assert.equal(agenceSubpageId('/agence/thanks'), 'thanks');
  assert.equal(await renderAgenceSubpage(dir, 'thanks'), '<head><meta name="robots" content="noindex"></head><body class="on-light"><section id="thanks"></section></body>');
  assert.equal(await renderAgenceSubpage(dir, 'pricing'), '<head></head><body class="on-light"><section id="pricing"></section></body>');
});

test('loadAgencyOffers: the offers block of the real data file, cached; undefined without it', async (t) => {
  const offers = await loadAgencyOffers(ROOT);
  assert.ok(offers && offers.offers.some((o) => o.id === 'refonte'));
  assert.equal(await loadAgencyOffers(ROOT), offers, 'same object while the file is unchanged');
  assert.equal(await loadAgencyOffers(tempDir(t)), undefined);
});

test('the real sub-page shell has a head slot, and every sub-page has a fragment', () => {
  const shell = readFileSync(join(ROOT, 'ui', 'agence', 'page.html'), 'utf8');
  assert.ok(shell.includes('<!--@head-->'), 'page.html carries <!--@head-->');
  for (const slug of Object.keys(AGENCE_SUBPAGES)) {
    assert.ok(readFileSync(join(ROOT, 'ui', 'agence', slug + '.html'), 'utf8').trim().length > 0, slug);
  }
});

/* ── Legal pages (/agence/terms, /agence/legal) ── */

const LEGAL_SLUGS = ['terms', 'legal'];
const legalFragment = (slug) => readFileSync(join(ROOT, 'ui', 'agence', slug + '.html'), 'utf8');

/** { en, fr }: the inner HTML of each language's <article>. */
function legalArticles(html) {
  const out = {};
  for (const lang of ['en', 'fr']) {
    const found = [...html.matchAll(new RegExp(`<article\\b[^>]*data-legal-lang="${lang}"[^>]*>([\\s\\S]*?)</article>`, 'g'))];
    assert.equal(found.length, 1, `one ${lang} article`);
    out[lang] = found[0][1];
  }
  return out;
}
const plain = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;| | /g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const usdEn = (n) => '$' + Number(n).toLocaleString('en-US');
const usdFr = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' $';

test('agenceSubpageId: the terms of sale and the legal notices are sub-pages', () => {
  for (const slug of LEGAL_SLUGS) {
    assert.equal(agenceSubpageId('/agence/' + slug), slug);
    assert.equal(agenceRedirectTarget('/agence/' + slug + '/', '?lang=fr'), '/agence/' + slug + '?lang=fr');
  }
});

test('the real terms and legal pages render through the shell, with both languages and their own assets', async () => {
  for (const slug of LEGAL_SLUGS) {
    const html = await renderAgenceSubpage(join(ROOT, 'ui'), slug);
    assert.ok(html, slug);
    assert.ok(html.includes(`<link rel="canonical" href="https://jobyougo.xyz/agence/${slug}">`), `${slug}: canonical`);
    assert.ok(html.includes('<link rel="stylesheet" href="/portfolio/agence-legal.css'), `${slug}: stylesheet`);
    assert.ok(html.includes('<script src="/portfolio/agence-legal.js'), `${slug}: title script`);
    assert.ok(html.includes(`<section class="legal" data-tone="light" id="${slug}">`), `${slug}: fragment spliced`);
    assert.ok(!html.includes('<!--@'), `${slug}: no marker left`);
    const { en, fr } = legalArticles(html);
    assert.ok(plain(en).length > 1500 && plain(fr).length > 1500, `${slug}: both languages written`);
  }
  for (const file of ['agence-legal.css', 'agence-legal.js']) {
    assert.ok(readFileSync(join(ROOT, 'ui', 'portfolio', file), 'utf8').length > 0, file);
  }
});

test('legal pages: ids are unique and every in-page or cross-page anchor has a target', () => {
  const ids = {};
  for (const slug of LEGAL_SLUGS) {
    const list = [...legalFragment(slug).matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(new Set(list).size, list.length, `${slug}: duplicate id`);
    ids[slug] = new Set(list);
  }
  for (const slug of LEGAL_SLUGS) {
    for (const [, page, anchor] of legalFragment(slug).matchAll(/href="(?:\/agence\/(terms|legal))?#([^"]+)"/g)) {
      assert.ok(ids[page || slug].has(anchor), `${slug}: #${anchor} on ${page || slug}`);
    }
  }
});

test('the /agence pages load no font from Google: JetBrains Mono is self-hosted like the other two', () => {
  for (const file of ['ui/agence.html', 'ui/agence/page.html']) {
    assert.doesNotMatch(readFileSync(join(ROOT, file), 'utf8'), /fonts\.(googleapis|gstatic)\.com/, `${file}: the legal notices no longer list Google Fonts`);
  }
  const css = readFileSync(join(ROOT, 'ui', 'portfolio', 'agence-story.css'), 'utf8');
  for (const [, family, url] of css.matchAll(/@font-face\s*\{[^}]*font-family:\s*'([^']+)'[^}]*src:\s*url\('([^']+)'\)/g)) {
    assert.ok(url.startsWith('/portfolio/fonts/'), `${family}: self-hosted`);
    assert.ok(readFileSync(join(ROOT, 'ui', url.slice(1))).length > 10_000, `${family}: ${url} exists`);
  }
  assert.match(css, /font-family:\s*'JetBrains Mono';\s*src:\s*url\('\/portfolio\/fonts\/jetbrains-mono-var\.woff2'\)/);
});

test('the home page has no 3D island and loads no script from a CDN or another origin', () => {
  const page = readFileSync(join(ROOT, 'ui', 'agence.html'), 'utf8');
  assert.doesNotMatch(page, /cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com/, 'ui/agence.html: no CDN');
  assert.doesNotMatch(page, /<script\b[^>]*\ssrc="(?:https?:)?\/\//, 'ui/agence.html: no script from another origin');
  assert.doesNotMatch(page, /hero-island|agence-island\.js|<script type="importmap">/, 'ui/agence.html: the floating 3D islands were removed');
  assert.equal(existsSync(join(ROOT, 'ui', 'portfolio', 'agence-island.js')), false, 'the orphan island script is gone');
});

test('the hero water lettering is a local module with a gradient fallback, plus a pointer-proof wave', () => {
  const page = readFileSync(join(ROOT, 'ui', 'agence.html'), 'utf8');
  const css = readFileSync(join(ROOT, 'ui', 'portfolio', 'agence-story.css'), 'utf8');
  const m = page.match(/<script type="module" src="(\/effects\/dist\/hero-liquid\/hero-liquid\.js)(?:\?[^"]*)?"><\/script>/);
  assert.ok(m, 'agence.html loads the liquid-glass lettering from the local build');
  assert.ok(readFileSync(join(ROOT, 'ui', m[1].slice(1))).length > 500, 'the loader is built');
  assert.match(page, /<div class="hero-wave" aria-hidden="true">/, 'the bottom wave is decorative');
  assert.match(css, /\.hero-wave \{[^}]*pointer-events: none/, 'the wave never takes a pointer');
  assert.match(css, /html\.has-liquid \.hero h1 em \{/, 'the aurora gradient stays unless the glass is painting');
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.hero-wave \.hw \{ animation: none/, 'the wave is still for reduced motion');
  const loader = readFileSync(join(ROOT, 'ui', 'effects', 'src', 'hero-liquid.ts'), 'utf8');
  assert.match(loader, /prefers-reduced-motion/, 'the loader keeps the gradient for reduced motion');
  assert.doesNotMatch(loader + readFileSync(join(ROOT, 'ui', 'effects', 'src', 'hero-liquid-core.tsx'), 'utf8'), /https?:\/\//, 'no remote URL in the lettering sources');
});

test('the hero main CTA is a real link with a glass layer that falls back to the plain gradient button', () => {
  const page = readFileSync(join(ROOT, 'ui', 'agence.html'), 'utf8');
  const css = readFileSync(join(ROOT, 'ui', 'portfolio', 'agence-story.css'), 'utf8');
  const beat1 = page.slice(page.indexOf('hero-beat--1'), page.indexOf('hero-beat--2'));
  assert.match(beat1, /<a class="btn btn-primary btn-glass" href="#pricing" data-order=""><span class="btn-label" data-t="hero_cta_improve">/, 'the CTA stays an <a> whose i18n label lives in an inner span');
  assert.doesNotMatch(beat1, /<a [^>]*btn-glass[^>]*data-t=/, 'data-t is not on the anchor (applyText would wipe the glass host)');
  assert.equal((page.match(/btn-glass/g) || []).length, 1, 'only the hero CTA uses the glass');
  assert.match(css, /html\.has-liquid-btn \.btn-glass::before \{/, 'the tinted gradient layer is gated on html.has-liquid-btn');
  assert.match(css, /\.hl-btn-glass \{[^}]*pointer-events: none/, 'the glass host never takes a pointer');
  assert.match(css, /html\.has-liquid-btn \.btn-glass \.hl-btn-glass \{ opacity: 1/, 'the glass only shows while it is live');
  const loader = readFileSync(join(ROOT, 'ui', 'effects', 'src', 'hero-liquid.ts'), 'utf8');
  assert.match(loader, /has-liquid-btn/, 'the loader toggles the class from the glass diagnostics');
  assert.match(css, /html\.has-liquid-btn \.btn-glass \.btn-label \{ color: #fff; text-shadow:/, 'the label turns white (with a soft shadow) only while the glass button is live');
  assert.match(css, /html\.has-liquid-btn \.btn-glass::before \{ filter: brightness\(/, 'the translucent gradient is deepened so the white label stays readable');
  assert.doesNotMatch(css + readFileSync(join(ROOT, 'ui', 'effects', 'src', 'hero-liquid-core.tsx'), 'utf8'), /hl-btn-text|LabelGlass|has-liquid-btn-text/, 'the label is plain text: no glass overlay, no extra WebGL context');
  assert.match(page, /\(a\[0\]\.querySelector\('\.btn-label'\) \|\| a\[0\]\)\.textContent/, 'the French pre-paint script rewrites the label span, not the whole anchor');
});

test('a legal page with placeholders stays noindex and out of the nav and footer', () => {
  const linking = ['ui/agence/page.html', 'ui/agence.html'].map((f) => [f, readFileSync(join(ROOT, f), 'utf8')]);
  for (const slug of LEGAL_SLUGS) {
    if (!legalFragment(slug).includes('class="legal-ph"')) continue;
    assert.ok(AGENCE_SUBPAGES[slug].head.includes('<meta name="robots" content="noindex">'), `${slug}: noindex while drafted`);
    for (const [file, html] of linking) {
      assert.ok(!new RegExp(`href="(?:https://jobyougo\\.xyz)?/agence/${slug}[?#"]`).test(html), `${file} links /agence/${slug} before it is filled in`);
    }
  }
});

test('the terms quote the prices, delivery times and revisions of the offers JSON', async () => {
  const data = await loadAgencyOffers(ROOT);
  const { en, fr } = legalArticles(legalFragment('terms'));
  const text = { en: plain(en), fr: plain(fr) };
  const usd = { en: usdEn, fr: usdFr };
  const orderable = data.offers.filter((o) => o.checkout === 'card' && o.open !== false);
  assert.ok(orderable.length >= 2, 'Redesign and Build are orderable');
  for (const lang of ['en', 'fr']) {
    for (const o of orderable) {
      assert.ok(text[lang].includes(o.name[lang]), `${lang}: ${o.id} name`);
      const row = [usd[lang](o.price), o.pages[lang], o.delivery[lang], o.revisions[lang]].join(' ');
      assert.ok(text[lang].includes(row), `${lang}: ${o.id} row "${row}"`);
    }
    for (const a of data.addons.filter((x) => x.open !== false && x.for.some((id) => orderable.some((o) => o.id === id)))) {
      const row = [a.name[lang], usd[lang](a.price), a.max].join(' ');
      assert.ok(text[lang].includes(row), `${lang}: add-on row "${row}"`);
    }
    assert.ok(text[lang].includes(usd[lang](data.custom.priceFrom)), `${lang}: custom price from`);
  }
  assert.match(text.en, /paid in full before Day 1/);
  assert.match(text.en, /Every payment gets an invoice/);
  assert.match(text.fr, /en totalité avant le jour 1/);
  assert.match(text.fr, /Chaque paiement donne lieu à une facture/);
});

test('isAgencePagePath', () => {
  for (const p of ['/agence', '/agence.html', '/agence/layout-cockpit', '/agence/layout-']) {
    assert.equal(isAgencePagePath(p), true, p);
  }
  for (const p of ['/agence/', '/agency', '/agence/other', '/agencex', '/portfolio', '/agence.htm', undefined]) {
    assert.equal(isAgencePagePath(p), false, String(p));
  }
});

test('renderAgencePage: splices the first head <style> in place of the marker, once', async (t) => {
  const dir = tempDir(t);
  const portfolio = join(dir, 'portfolio.html');
  const agence = join(dir, 'agence.html');
  writeFileSync(portfolio, '<!doctype html><html><head>\n  <style>\n    :root { --a: 1; } .x::after { content: "$&"; }\n  </style>\n</head><body><style>.late{}</style></body></html>');
  writeFileSync(agence, `<html><head>${PORTFOLIO_CSS_MARKER}<style>.agency{}</style></head><body><!--keep ${'@'}portfolio-css--></body></html>`);

  const html = await renderAgencePage(dir);
  assert.ok(html.includes('<style>\n    :root { --a: 1; } .x::after { content: "$&"; }\n  </style>'));
  assert.ok(!html.includes(PORTFOLIO_CSS_MARKER));
  assert.ok(!html.includes('.late{}'), 'only the head style block is injected');
  assert.ok(html.indexOf(':root { --a: 1; }') < html.indexOf('.agency{}'), 'injected where the marker was');

  // Cache hit returns the same string.
  assert.equal(await renderAgencePage(dir), html);

  // Cache invalidation: portfolio.html changes (new mtime) → new CSS.
  writeFileSync(portfolio, '<html><head><style>.v2{}</style></head></html>');
  touch(portfolio, 2_000_000_000);
  const html2 = await renderAgencePage(dir);
  assert.ok(html2.includes('<style>.v2{}</style>'));
  assert.ok(!html2.includes('--a: 1'));

  // Cache invalidation: agence.html changes → new page.
  writeFileSync(agence, `<html><head>${PORTFOLIO_CSS_MARKER}</head><body>v3</body></html>`);
  touch(agence, 2_000_000_100);
  const html3 = await renderAgencePage(dir);
  assert.equal(html3, '<html><head><style>.v2{}</style></head><body>v3</body></html>');
});

test('renderAgencePage: only the first marker is replaced', async (t) => {
  const dir = tempDir(t);
  writeFileSync(join(dir, 'portfolio.html'), '<head><style>.a{}</style></head>');
  writeFileSync(join(dir, 'agence.html'), `${PORTFOLIO_CSS_MARKER}|${PORTFOLIO_CSS_MARKER}`);
  assert.equal(await renderAgencePage(dir), `<style>.a{}</style>|${PORTFOLIO_CSS_MARKER}`);
});

test('renderAgencePage: missing marker → unchanged; no style → marker removed; no agence.html → null', async (t) => {
  const dir = tempDir(t);
  const agence = join(dir, 'agence.html');
  const portfolio = join(dir, 'portfolio.html');

  assert.equal(await renderAgencePage(dir), null);

  writeFileSync(portfolio, '<head><style>.a{}</style></head>');
  writeFileSync(agence, '<html><head></head><body>no marker</body></html>');
  assert.equal(await renderAgencePage(dir), '<html><head></head><body>no marker</body></html>');

  writeFileSync(agence, `<head>${PORTFOLIO_CSS_MARKER}</head>`);
  touch(agence, 2_000_000_000);
  writeFileSync(portfolio, '<head><link rel="stylesheet" href="x.css"></head><body><style>.body{}</style></body>');
  touch(portfolio, 2_000_000_000);
  assert.equal(await renderAgencePage(dir), '<head></head>');

  rmSync(portfolio);
  touch(agence, 2_000_000_200);
  assert.equal(await renderAgencePage(dir), '<head></head>');
});

test('firstHeadStyle on the real portfolio.html is the design-system block', () => {
  const html = readFileSync(join(ROOT, 'ui', 'portfolio.html'), 'utf-8');
  const block = firstHeadStyle(html);
  assert.ok(block.startsWith('<style>'));
  assert.ok(block.endsWith('</style>'));
  assert.ok(block.includes(':root'), 'carries the design tokens');
  assert.ok(block.split('\n').length > 1000, 'is the large design-system block');
  assert.equal(block.match(/<\/style/gi).length, 1, 'no premature </style> inside');
  const head = html.slice(0, html.search(/<\/head\s*>/i));
  assert.ok(head.includes(block), 'comes from <head>');
});

function writeAgencyRoot(dir, { md, data }) {
  mkdirSync(join(dir, 'modes'), { recursive: true });
  mkdirSync(join(dir, 'ui', 'portfolio'), { recursive: true });
  if (md !== undefined) writeFileSync(join(dir, 'modes', 'agence.md'), md);
  if (data !== undefined) writeFileSync(join(dir, 'ui', 'portfolio', 'agence-data.js'), data);
}

const OFFERS = [{ id: 'refonte', price: { usd: 490 }, label: { fr: 'Refonte', en: 'Redesign' } }];
const DATA_JS = `window.AGENCE = { offers: /*OFFERS_JSON*/${JSON.stringify(OFFERS)}/*END_OFFERS_JSON*/ };\n`;

test('buildAgencyChatPrompt: markdown + authoritative offers JSON, cached on mtime', async (t) => {
  const dir = tempDir(t);
  writeAgencyRoot(dir, { md: '# Agency assistant\n\nRules.\n\n', data: DATA_JS });
  const prompt = await buildAgencyChatPrompt(dir);
  assert.equal(
    prompt,
    '# Agency assistant\n\nRules.\n\n## Offers (authoritative, quote prices exactly)\n' + JSON.stringify(OFFERS, null, 2),
  );

  const offers2 = [{ id: 'creation', price: { usd: 590 } }];
  writeFileSync(join(dir, 'ui', 'portfolio', 'agence-data.js'), `/*OFFERS_JSON*/${JSON.stringify(offers2)}/*END_OFFERS_JSON*/`);
  touch(join(dir, 'ui', 'portfolio', 'agence-data.js'), 2_000_000_000);
  assert.ok((await buildAgencyChatPrompt(dir)).endsWith(JSON.stringify(offers2, null, 2)));
});

test('buildAgencyChatPrompt fails closed', async (t) => {
  const cases = {
    'missing agence.md': { data: DATA_JS },
    'empty agence.md': { md: '  \n', data: DATA_JS },
    'missing agence-data.js': { md: '# A' },
    'invalid JSON': { md: '# A', data: '/*OFFERS_JSON*/[{"id":}]/*END_OFFERS_JSON*/' },
    'empty JSON': { md: '# A', data: '/*OFFERS_JSON*/  /*END_OFFERS_JSON*/' },
    'start marker missing': { md: '# A', data: `${JSON.stringify(OFFERS)}/*END_OFFERS_JSON*/` },
    'end marker missing': { md: '# A', data: `/*OFFERS_JSON*/${JSON.stringify(OFFERS)}` },
    'no markers': { md: '# A', data: 'const OFFERS = [];' },
  };
  for (const [name, files] of Object.entries(cases)) {
    const dir = tempDir(t);
    writeAgencyRoot(dir, files);
    assert.equal(await buildAgencyChatPrompt(dir), '', name);
  }
});

test('resolveChatPersona: whitelist and language', () => {
  assert.deepEqual(resolveChatPersona(undefined), { persona: 'hugo', lang: 'en' });
  assert.deepEqual(resolveChatPersona(null), { persona: 'hugo', lang: 'en' });
  assert.deepEqual(resolveChatPersona({ messages: [] }), { persona: 'hugo', lang: 'en' });
  assert.deepEqual(resolveChatPersona({ persona: 'agency', lang: 'fr' }), { persona: 'agency', lang: 'fr' });
  assert.deepEqual(resolveChatPersona({ persona: 'agency', lang: 'fr-FR' }), { persona: 'agency', lang: 'fr' });
  assert.deepEqual(resolveChatPersona({ persona: 'agency', lang: 'de' }), { persona: 'agency', lang: 'de' });
  assert.deepEqual(resolveChatPersona({ persona: 'agency', lang: 'pt' }), { persona: 'agency', lang: 'pt-BR' });
  assert.deepEqual(resolveChatPersona({ persona: 'agency', lang: 'xx' }), { persona: 'agency', lang: 'en' });
  assert.deepEqual(resolveChatPersona({ persona: 'hugo', lang: 'fr' }), { persona: 'hugo', lang: 'fr' });
  for (const persona of ['unknown', '__proto__', 'constructor', 'toString', 'Agency', ' agency', 42, ['agency'], { agency: 1 }]) {
    assert.equal(resolveChatPersona({ persona }).persona, 'hugo', String(persona));
  }
  assert.equal(resolveChatPersona({ persona: 'agency', lang: 42 }).lang, 'en');
  assert.equal(resolveChatPersona({ persona: 'agency', lang: 'french' }).lang, 'en');
});

test('agencyLanguageInstruction names the page language', () => {
  assert.match(agencyLanguageInstruction('fr'), /Answer in French/);
  assert.match(agencyLanguageInstruction('en'), /Answer in English/);
  assert.match(agencyLanguageInstruction('xx'), /Answer in English/);
});

/* ── Coaching: not on the home, a "coming soon" page of its own ── */

test('the home no longer mentions coaching, in any language', () => {
  const home = readFileSync(join(ROOT, 'ui', 'agence.html'), 'utf8');
  assert.ok(!/coach|accompagn|mentor/i.test(home), 'ui/agence.html carries no coaching copy');
  assert.ok(!home.includes('id="coach"'), 'no coaching band on the home');
  assert.ok(!/href="(?:https:\/\/jobyougo\.xyz)?\/agence\/coaching/.test(home), 'the home does not link the coaching page');
  const shell = readFileSync(join(ROOT, 'ui', 'agence', 'page.html'), 'utf8');
  assert.ok(!/href="(?:https:\/\/jobyougo\.xyz)?\/agence\/coaching/.test(shell), 'the shared header and footer do not link it either');
  const story = readFileSync(join(ROOT, 'ui', 'portfolio', 'agence-story.js'), 'utf8');
  for (const key of ['s_beat3_line', 's_pricing_pay_home', 'faq_payment_a_home', 'faq_unhappy_a_home', 'meta_desc_home']) {
    const copies = [...story.matchAll(new RegExp(`^\\s*${key}: '(.*)',$`, 'gm'))].map((m) => m[1]);
    assert.equal(copies.length, 2, `${key}: one English and one French copy`);
    for (const copy of copies) assert.ok(!/coach|accompagn|mentor/i.test(copy), `${key}: ${copy.slice(0, 40)}`);
  }
});

test('on the home, the script leaves the coaching offer, its add-on, its service row, its FAQ entry and its option out', () => {
  const story = readFileSync(join(ROOT, 'ui', 'portfolio', 'agence-story.js'), 'utf8');
  assert.match(story, /const HOME_PAGE = !!d\.getElementById\('hero-title'\);/);
  assert.match(story, /offers: \(OFFERS_ALL\.offers \|\| \[\]\)\.filter\(\(o\) => o\.id !== HOME_HIDDEN_OFFER\)/);
  assert.match(story, /AGENCY_OFFER_IDS[^\n]*\)\.filter\(\(id\) => !HOME_PAGE \|\| id !== HOME_HIDDEN_OFFER\)/);
  assert.match(story, /SERVICES\.filter\(\(s\) => s\.n !== 2 && !\(HOME_PAGE && s\.offer === HOME_HIDDEN_OFFER\)\)/);
  assert.match(story, /FAQ\.filter\(\(slug\) => !\(HOME_PAGE && slug === 'cancel'\)\)/);
  assert.equal(HOME_HIDDEN_OFFER_IN_DATA(), true, 'the offer the home hides still exists for the other pages');
});
function HOME_HIDDEN_OFFER_IN_DATA() {
  return /"id": "accompagnement"/.test(readFileSync(join(ROOT, 'ui', 'portfolio', 'agence-data.js'), 'utf8'));
}

test('/agence/coaching is a registered sub-page: noindex, a "coming soon" fragment, English and French, no form', async () => {
  assert.equal(agenceSubpageId('/agence/coaching'), 'coaching');
  assert.equal(agenceRedirectTarget('/agence/coaching/', '?lang=fr'), '/agence/coaching?lang=fr');
  assert.ok(AGENCE_SUBPAGES.coaching.head.includes('<meta name="robots" content="noindex">'));
  const html = await renderAgenceSubpage(join(ROOT, 'ui'), 'coaching');
  assert.ok(html, 'the page renders through the shell');
  assert.ok(html.includes('id="coaching-title"') && html.includes('href="/agence"'), 'a title and a way back to the home');
  assert.ok(!html.includes('<!--@'), 'no marker left');
  assert.ok(!/<form\b|<input\b|type="email"/i.test(readFileSync(join(ROOT, 'ui', 'agence', 'coaching.html'), 'utf8')), 'no form and no e-mail field');
  const story = readFileSync(join(ROOT, 'ui', 'portfolio', 'agence-story.js'), 'utf8');
  for (const key of ['s_coaching_title', 's_coaching_lede', 's_coaching_back', 'doc_title_coaching', 'meta_desc_coaching']) {
    const copies = [...story.matchAll(new RegExp(`^\\s*${key}: '(.*)',$`, 'gm'))].map((m) => m[1]);
    assert.equal(copies.length, 2, `${key}: English and French`);
    assert.notEqual(copies[0], copies[1], `${key}: the two languages differ`);
  }
  assert.match(story, /coaching: 'coaching' \}\)\[SITE\.page\]/, 'the page title and description are localised');
});
