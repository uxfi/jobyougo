#!/usr/bin/env node

/**
 * generate-pdf.mjs — HTML → PDF via PinchTab
 *
 * Usage:
 *   node career-ops/generate-pdf.mjs <input.html> <output.pdf> [--format=letter|a4]
 *
 * Requires: PinchTab daemon running at http://localhost:9867 (or PINCHTAB_URL).
 * Token is read from ~/.pinchtab/config.json or PINCHTAB_TOKEN.
 */

import { resolve, dirname, extname, join } from 'path';
import { readFile, access, writeFile, mkdtemp, rm } from 'fs/promises';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { createServer } from 'http';
import sharp from 'sharp';
import {
  pinchtabHealth,
  pinchtabNavigate,
  pinchtabEvaluate,
  pinchtabPdf,
  pinchtabClose,
} from './lib/pinchtab.mjs';

function serveStaticHtml(html) {
  return new Promise((resolveServer) => {
    const server = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      // closeAllConnections: the PinchTab tab may keep its connection alive
      // (tab close can 404 across daemon versions), which would hang server.close()
      resolveServer({ url: `http://127.0.0.1:${port}/`, close: () => new Promise(r => { server.close(r); server.closeAllConnections(); }) });
    });
  });
}

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
      const isScreenshot = filename.startsWith('screenshot_') || filename.includes('screenshot') || filename.includes('desktop');
      const isPortrait  = filename === 'hugo_vermot.png';
      const isLogo      = !isScreenshot && !isPortrait;
      let pipeline = sharp(imgPath).rotate(); // auto-orient
      if (isScreenshot) pipeline = pipeline.resize({ width: 800, withoutEnlargement: true });
      else if (isPortrait) pipeline = pipeline.resize({ width: 200, height: 200, fit: 'cover' });
      else if (isLogo)     pipeline = pipeline.resize({ width: 80, height: 80, fit: 'inside', withoutEnlargement: true });
      // Flatten transparency to white before JPEG conversion (avoids black background on transparent PNGs)
      pipeline = pipeline.flatten({ background: { r: 255, g: 255, b: 255 } });
      const compressed = await pipeline.jpeg({ quality: 82, mozjpeg: true }).toBuffer();
      return `data:image/jpeg;base64,${compressed.toString('base64')}`;
    } catch { return null; }
  }

  // Replace src="../images/xxx" and src="/images/xxx"
  const srcMatches = [...new Set(html.match(/src=["'](?:\.\.?\/)?images\/([^"']+)["']/g) || [])];
  console.log(`🔄 Found ${srcMatches.length} src images to inline.`);
  for (const match of srcMatches) {
    const filename = match.match(/images\/([^"']+)/)[1];
    console.log(`  ➡️ Inlining image: ${filename}...`);
    const dataUri = await toDataURI(resolve(imagesDir, filename));
    if (dataUri) {
      html = html.replaceAll(match, match.replace(/src=["'](?:\.\.?\/)?images\/[^"']+["']/, `src="${dataUri}"`));
      console.log(`  ✅ Inlined: ${filename} (${(dataUri.length / 1024).toFixed(1)} KB base64)`);
    }
  }

  // Replace url('../images/xxx') and url('/images/xxx') in CSS
  const urlMatches = [...new Set(html.match(/url\(['"]?(?:\.\.?\/)?images\/[^'")]+['"]?\)/g) || [])];
  console.log(`🔄 Found ${urlMatches.length} background images to inline.`);
  for (const match of urlMatches) {
    const filename = match.match(/images\/([^'")]+)/)[1];
    console.log(`  ➡️ Inlining background: ${filename}...`);
    const dataUri = await toDataURI(resolve(imagesDir, filename));
    if (dataUri) {
      html = html.replaceAll(match, `url('${dataUri}')`);
      console.log(`  ✅ Inlined bg: ${filename} (${(dataUri.length / 1024).toFixed(1)} KB base64)`);
    }
  }

  if (!(await pinchtabHealth())) {
    console.error('❌ PinchTab daemon not reachable. Start it with: pinchtab server');
    process.exit(1);
  }

  console.log('🚀 Starting ephemeral local server...');
  const staticServer = await serveStaticHtml(html);
  console.log(`🚀 Server running at ${staticServer.url}`);

  const paper = format === 'letter'
    ? { paperWidth: 8.5,  paperHeight: 11 }
    : { paperWidth: 8.27, paperHeight: 11.69 };

  let tabId;
  let pdfBuffer;
  try {
    console.log('🧭 PinchTab navigating...');
    tabId = await pinchtabNavigate(staticServer.url, { timeout: 25000 });
    console.log('🧭 Navigation success, waiting for fonts...');
    await pinchtabEvaluate(tabId, 'document.fonts.ready.then(() => true)', { awaitPromise: true, timeout: 10000 });
    console.log('🧭 Fonts loaded, rendering PDF...');

    pdfBuffer = await pinchtabPdf(tabId, {
      ...paper,
      marginTop: 0,
      marginRight: 0,
      marginBottom: 0,
      marginLeft: 0,
      printBackground: true,
      preferCSSPageSize: false,
    });
  } finally {
    await pinchtabClose(tabId);
    await staticServer.close().catch(() => {});
  }

  await writeFile(outputPath, pdfBuffer);

  // Count pages (approximate from PDF structure)
  const pdfString = pdfBuffer.toString('latin1');
  const pageCount = (pdfString.match(/\/Type\s*\/Page[^s]/g) || []).length;

  console.log(`✅ PDF generated: ${outputPath}`);
  console.log(`📊 Pages: ${pageCount}`);
  console.log(`📦 Size: ${(pdfBuffer.length / 1024).toFixed(1)} KB`);

  return { outputPath, pageCount, size: pdfBuffer.length };
}

generatePDF().catch((err) => {
  console.error('❌ PDF generation failed:', err.message);
  process.exit(1);
});
