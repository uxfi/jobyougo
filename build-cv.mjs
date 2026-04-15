#!/usr/bin/env node

/**
 * build-cv.mjs — Orchestrates CV generation from YAML profiles and HTML templates.
 * 
 * Usage:
 *   node build-cv.mjs --profile=ai_builder
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { loadCvTemplateData } from './lib/cv-template-data.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const args = process.argv.slice(2);
  let profileKey = 'ai_builder'; // Default

  for (const arg of args) {
    if (arg.startsWith('--profile=')) {
      profileKey = arg.split('=')[1];
    }
  }

  const templatePath = resolve(__dirname, 'templates/premium-cv.html');
  const outputPath = resolve(__dirname, 'output/cv.html');
  const pdfOutputPath = resolve(__dirname, `output/Hugo_Vermot_CV_${profileKey}.pdf`);

  let template = readFileSync(templatePath, 'utf8');
  const data = await loadCvTemplateData(__dirname, profileKey);

  if (!data.profile || !Object.keys(data.profile).length) {
    console.error(`❌ Profile "${profileKey}" not found in data/cv-profiles.yml`);
    process.exit(1);
  }

  // Simple template engine logic
  // 1. Replace simple variables
  function getValue(obj, path, globalData) {
    if (path === 'this') return obj;
    if (path.startsWith('this.')) {
      const key = path.slice(5).trim();
      return obj && typeof obj === 'object' ? obj[key] : undefined;
    }
    return path.split('.').reduce((prev, curr) => prev ? prev[curr] : undefined, globalData);
  }

  function findClosingTag(content, openTag, closeTag, startIndex) {
    let depth = 1;
    let pos = startIndex;
    while (depth > 0 && pos < content.length) {
      const nextOpen = content.indexOf(openTag, pos);
      const nextClose = content.indexOf(closeTag, pos);
      if (nextClose === -1) return -1;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        pos = nextOpen + openTag.length;
      } else {
        depth--;
        pos = nextClose + closeTag.length;
        if (depth === 0) return nextClose;
      }
    }
    return -1;
  }

  function render(templateContent, context, globalData) {
    let res = templateContent;
    
    // 1. Process EACH blocks
    let pos = 0;
    while ((pos = res.indexOf('{{#each')) !== -1) {
      const endOpen = res.indexOf('}}', pos);
      const path = res.slice(pos + 7, endOpen).trim();
      const closePos = findClosingTag(res, '{{#each', '{{/each}}', endOpen + 2);
      if (closePos === -1) break;
      const inner = res.slice(endOpen + 2, closePos);
      const list = getValue(context, path, globalData);
      const rendered = Array.isArray(list) ? list.map(item => render(inner, item, globalData)).join('') : '';
      res = res.slice(0, pos) + rendered + res.slice(closePos + 9);
    }

    // 2. Process IF blocks (with {{else}} support)
    pos = 0;
    while ((pos = res.indexOf('{{#if')) !== -1) {
      const endOpen = res.indexOf('}}', pos);
      const path = res.slice(pos + 5, endOpen).trim();
      const closePos = findClosingTag(res, '{{#if', '{{/if}}', endOpen + 2);
      if (closePos === -1) break;
      const inner = res.slice(endOpen + 2, closePos);
      const val = getValue(context, path, globalData);
      const truthy = val && (!Array.isArray(val) || val.length > 0);
      // Split on {{else}} if present
      const elseIdx = inner.indexOf('{{else}}');
      let rendered;
      if (elseIdx !== -1) {
        const truePart = inner.slice(0, elseIdx);
        const falsePart = inner.slice(elseIdx + 8);
        rendered = truthy ? render(truePart, context, globalData) : render(falsePart, context, globalData);
      } else {
        rendered = truthy ? render(inner, context, globalData) : '';
      }
      res = res.slice(0, pos) + rendered + res.slice(closePos + 7);
    }

    // 3. Variables
    res = res.replace(/\{\{([^#\/][^}]*)\}\}/g, (match, path) => {
      const val = getValue(context, path.trim(), globalData);
      return val !== undefined ? val : '';
    });

    return res;
  }

  template = render(template, data, data);

  // Inject preview-only download button (hidden in print/PDF)
  const pdfFilename = `Hugo_Vermot_CV_${profileKey}.pdf`;
  const downloadButton = `
<style>
  .preview-bar {
    position: fixed; top: 0; left: 0; right: 0; z-index: 9999;
    background: #0f172a; padding: 10px 24px;
    display: flex; align-items: center; justify-content: space-between;
    font-family: 'Space Grotesk', sans-serif; font-size: 12px; color: #94a3b8;
    box-shadow: 0 2px 12px rgba(0,0,0,0.3);
  }
  .preview-bar span { font-weight: 600; color: #e2e8f0; letter-spacing: 0.02em; }
  .preview-bar a {
    background: #2d31fa; color: #fff; padding: 7px 18px; border-radius: 8px;
    text-decoration: none; font-weight: 700; font-size: 12px; letter-spacing: 0.02em;
    display: flex; align-items: center; gap: 8px; transition: background 0.2s;
  }
  .preview-bar a:hover { background: #1e21b5; white-space: nowrap; }
  body { padding-top: 44px; }
  @media print { .preview-bar { display: none !important; } body { padding-top: 0; } }
</style>
<div class="preview-bar">
  <span>Preview — ${pdfFilename}</span>
  <a href="${pdfFilename}" download="${pdfFilename}">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
    Download PDF
  </a>
</div>`;
  template = template.replace('<body>', `<body>\n${downloadButton}`);

  if (!existsSync(resolve(__dirname, 'output'))) {
    execSync('mkdir -p output');
  }

  writeFileSync(outputPath, template);
  console.log(`✅ HTML generated: ${outputPath}`);

  // Now call generate-pdf.mjs
  try {
    console.log(`⏳ Generating PDF for profile: ${profileKey}...`);
    const nodeBin = process.execPath;
    execSync(`"${nodeBin}" generate-pdf.mjs "${outputPath}" "${pdfOutputPath}"`, { stdio: 'inherit', cwd: __dirname });
    console.log(`\n✨ Success! CV exported to: ${pdfOutputPath}`);
  } catch (err) {
    console.error('❌ PDF generation failed:', err.message);
  }
}

main();
