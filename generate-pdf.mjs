#!/usr/bin/env node

/**
 * generate-pdf.mjs — HTML → PDF via Playwright
 *
 * Usage:
 *   node career-ops/generate-pdf.mjs <input.html> <output.pdf> [--format=letter|a4]
 *
 * Requires: @playwright/test (or playwright) installed.
 * Uses Chromium headless to render the HTML and produce a clean, ATS-parseable PDF.
 */

import { chromium } from 'playwright';
import { resolve, dirname, extname } from 'path';
import { readFile, access } from 'fs/promises';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function generatePDF() {
  const args = process.argv.slice(2);

  // Parse arguments
  let inputPath, outputPath, format = 'a4';

  for (const arg of args) {
    if (arg.startsWith('--format=')) {
      format = arg.split('=')[1].toLowerCase();
    } else if (!inputPath) {
      inputPath = arg;
    } else if (!outputPath) {
      outputPath = arg;
    }
  }

  if (!inputPath || !outputPath) {
    console.error('Usage: node generate-pdf.mjs <input.html> <output.pdf> [--format=letter|a4]');
    process.exit(1);
  }

  inputPath = resolve(inputPath);
  outputPath = resolve(outputPath);

  // Validate format
  const validFormats = ['a4', 'letter'];
  if (!validFormats.includes(format)) {
    console.error(`Invalid format "${format}". Use: ${validFormats.join(', ')}`);
    process.exit(1);
  }

  console.log(`📄 Input:  ${inputPath}`);
  console.log(`📁 Output: ${outputPath}`);
  console.log(`📏 Format: ${format.toUpperCase()}`);

  // Read HTML to inject font paths as absolute file:// URLs
  let html = await readFile(inputPath, 'utf-8');

  // Resolve font paths relative to career-ops/fonts/
  const fontsDir = resolve(__dirname, 'fonts');
  html = html.replace(
    /url\(['"]?\.\.?\/fonts\//g,
    `url('file://${fontsDir}/`
  );
  // Close any unclosed quotes from the replacement
  html = html.replace(
    /file:\/\/([^'")]+)\.woff2['"]\)/g,
    `file://$1.woff2')`
  );

  // Inline all images as base64 data URIs (most reliable for file:// PDF rendering)
  const imagesDir = resolve(__dirname, 'images');
  const mimeTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp' };

  async function toDataURI(imgPath) {
    try {
      await access(imgPath);
      const ext = extname(imgPath).toLowerCase();
      if (ext === '.svg') {
        const buf = await readFile(imgPath);
        return `data:image/svg+xml;base64,${buf.toString('base64')}`;
      }
      const filename = imgPath.split('/').pop();
      const isScreenshot = filename.startsWith('screenshot_');
      const isPortrait  = filename === 'hugo_vermot.png';
      const isLogo      = !isScreenshot && !isPortrait;
      let pipeline = sharp(imgPath).rotate(); // auto-orient
      if (isScreenshot) pipeline = pipeline.resize({ width: 800, withoutEnlargement: true });
      else if (isPortrait) pipeline = pipeline.resize({ width: 200, height: 200, fit: 'cover' });
      else if (isLogo)     pipeline = pipeline.resize({ width: 80, height: 80, fit: 'inside', withoutEnlargement: true });
      const compressed = await pipeline.jpeg({ quality: 82, mozjpeg: true }).toBuffer();
      return `data:image/jpeg;base64,${compressed.toString('base64')}`;
    } catch { return null; }
  }

  // Replace src="../images/xxx" and src="/images/xxx"
  const srcMatches = [...new Set(html.match(/src=["'](?:\.\.?\/)?images\/([^"']+)["']/g) || [])];
  for (const match of srcMatches) {
    const filename = match.match(/images\/([^"']+)/)[1];
    const dataUri = await toDataURI(resolve(imagesDir, filename));
    if (dataUri) html = html.replaceAll(match, match.replace(/src=["'](?:\.\.?\/)?images\/[^"']+["']/, `src="${dataUri}"`));
  }

  // Replace url('../images/xxx') and url('/images/xxx') in CSS
  const urlMatches = [...new Set(html.match(/url\(['"]?(?:\.\.?\/)?images\/[^'")]+['"]?\)/g) || [])];
  for (const match of urlMatches) {
    const filename = match.match(/images\/([^'")]+)/)[1];
    const dataUri = await toDataURI(resolve(imagesDir, filename));
    if (dataUri) html = html.replaceAll(match, `url('${dataUri}')`);
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Set content with file base URL for any relative resources
  await page.setContent(html, {
    waitUntil: 'networkidle',
    baseURL: `file://${dirname(inputPath)}/`,
  });

  // Wait for fonts to load
  await page.evaluate(() => document.fonts.ready);

  // Generate PDF
  const pdfBuffer = await page.pdf({
    format: format,
    printBackground: true,
    margin: {
      top: '0',
      right: '0',
      bottom: '0',
      left: '0',
    },
    preferCSSPageSize: false,
  });

  // Write PDF
  const { writeFile } = await import('fs/promises');
  await writeFile(outputPath, pdfBuffer);

  // Count pages (approximate from PDF structure)
  const pdfString = pdfBuffer.toString('latin1');
  const pageCount = (pdfString.match(/\/Type\s*\/Page[^s]/g) || []).length;

  await browser.close();

  console.log(`✅ PDF generated: ${outputPath}`);
  console.log(`📊 Pages: ${pageCount}`);
  console.log(`📦 Size: ${(pdfBuffer.length / 1024).toFixed(1)} KB`);

  return { outputPath, pageCount, size: pdfBuffer.length };
}

generatePDF().catch((err) => {
  console.error('❌ PDF generation failed:', err.message);
  process.exit(1);
});
