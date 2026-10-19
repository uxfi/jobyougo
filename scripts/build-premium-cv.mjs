#!/usr/bin/env node
// Render the premium CV (templates/premium-cv.html + data/cv-profiles.yml) to HTML and PDF.
// Usage: node scripts/build-premium-cv.mjs [profileKey=complete_bangkok] [output.pdf]
import { readFile, writeFile, mkdir } from 'fs/promises';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { loadCvTemplateData } from '../lib/cv-template-data.mjs';
import { tplRender } from '../lib/cv-template-render.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const profileKey = process.argv[2] || 'complete_bangkok';
const pdfPath = resolve(process.argv[3] || join(ROOT, 'output', 'Hugo_Vermot_CV.pdf'));

const template = await readFile(join(ROOT, 'templates', 'premium-cv.html'), 'utf-8');
const data = await loadCvTemplateData(ROOT, profileKey);
const c = data.shared.contact;
// The template expects display/url fields the YAML keeps in short form.
const strip = (u = '') => String(u).replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
c.linkedin_url = c.linkedin_url || (c.linkedin ? `https://${strip(c.linkedin)}` : '');
c.linkedin_display = c.linkedin_display || strip(c.linkedin_url);
c.portfolio_display = c.portfolio_display || strip(c.portfolio);
let html = tplRender(template, data, data);
// Use the size-optimized image copies (scripts/optimize-cv-images.mjs) when present.
try {
  const manifest = JSON.parse(await readFile(join(ROOT, 'images', 'cv', 'manifest.json'), 'utf-8'));
  for (const [orig, opt] of Object.entries(manifest)) html = html.split('../images/' + orig).join('../images/cv/' + opt);
} catch { /* no optimized copies: originals are used */ }

const htmlPath = join(ROOT, 'output', `cv-premium-${profileKey}.html`) // sibling of images/ and fonts/ so ../images resolves;
await mkdir(dirname(htmlPath), { recursive: true });
await mkdir(dirname(pdfPath), { recursive: true });
await writeFile(htmlPath, html, 'utf-8');
const r = spawnSync(process.execPath, [join(ROOT, 'generate-pdf.mjs'), htmlPath, pdfPath, '--format=a4', '--max-pages=2', '--strict-pages'], { stdio: 'inherit', cwd: ROOT });
process.exit(r.status ?? 1);
