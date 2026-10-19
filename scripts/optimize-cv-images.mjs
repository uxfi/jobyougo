#!/usr/bin/env node
// Writes size-optimized copies of the images used by templates/premium-cv.html into
// images/cv/ (originals are never touched) plus images/cv/manifest.json, which
// scripts/build-premium-cv.mjs uses to swap ../images/X for ../images/cv/X.
// Needs `sharp`, which is not a project dependency:  npm i sharp --no-save
import { readFile, writeFile, mkdir, copyFile, stat } from 'fs/promises';
import { join, dirname, extname, basename } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'images');
const OUT = join(SRC, 'cv');
const sharp = (await import('sharp')).default;

// name -> { w: max width (about 2x the size it prints at), kind }
const PLAN = {
  'hugo_vermot.optimized.jpg': { w: 360, kind: 'photo' },
  'oneasset-cover.png': { w: 560, kind: 'shot' },
  'screenshot_creads.webp': { w: 560, kind: 'shot' },
  'lvmh-screenshot.webp': { w: 560, kind: 'shot' },
  'renault-screens.png': { w: 560, kind: 'shot' },
  'favicon.png': { w: 96, kind: 'logo' },
  'logo-HV.jpg': { w: 96, kind: 'logo-jpg' },
  'oneasset-logo.png': { w: 160, kind: 'logo' },
  'creads-logo.webp': { w: 96, kind: 'logo' },
  'bmw.png': { w: 96, kind: 'logo' },
};

await mkdir(OUT, { recursive: true });
const manifest = {};
for (const [name, { w, kind }] of Object.entries(PLAN)) {
  const input = join(SRC, name);
  const ext = extname(name).toLowerCase();
  const base = basename(name, ext);
  let img = sharp(input).resize({ width: w, withoutEnlargement: true });
  let outName;
  if (kind === 'photo' || kind === 'logo-jpg') { outName = `${base}.jpg`; img = img.jpeg({ quality: 86, mozjpeg: true }); }
  else if (kind === 'shot') { outName = `${base}.jpg`; img = img.flatten({ background: '#ffffff' }).jpeg({ quality: 80, mozjpeg: true }); }
  else if (ext === '.webp') { outName = `${base}.webp`; img = img.webp({ quality: 85 }); }
  else { outName = `${base}.png`; img = img.png({ compressionLevel: 9, palette: true }); }
  await img.toFile(join(OUT, outName));
  manifest[name] = outName;
  console.log(name, (await stat(input)).size, '->', outName, (await stat(join(OUT, outName))).size);
}
await writeFile(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
