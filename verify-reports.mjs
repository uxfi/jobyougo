#!/usr/bin/env node
/**
 * verify-reports.mjs — Validates report files in reports/ directory
 *
 * Checks:
 * 1. Report has proper structured header (# Evaluation or # Evaluación)
 * 2. Report has a valid Score (X.X/5 format)
 * 3. Report does NOT contain raw tool_call/tool_response logs
 * 4. Report has at least 2 of the required sections (A-F blocks)
 * 5. Report filename matches expected format: {###}-{slug}-{YYYY-MM-DD}.md
 *
 * Run: node verify-reports.mjs [--fix]
 *   --fix: Delete corrupted reports and log them for re-processing
 */

import { readFileSync, readdirSync, existsSync, unlinkSync, appendFileSync } from 'fs';
import { join, basename } from 'path';

const CAREER_OPS = new URL('.', import.meta.url).pathname;
const REPORTS_DIR = join(CAREER_OPS, 'reports');
const FIX_MODE = process.argv.includes('--fix');

let errors = 0;
let warnings = 0;
let fixed = 0;

function error(file, msg) { console.log(`❌ ${file}: ${msg}`); errors++; }
function warn(file, msg) { console.log(`⚠️  ${file}: ${msg}`); warnings++; }
function ok(msg) { console.log(`✅ ${msg}`); }

// Corruption indicators — raw LLM conversation artifacts
const CORRUPTION_PATTERNS = [
  '<tool_call>',
  '<tool_response>',
  '</tool_call>',
  '</tool_response>',
  '"name": "browser_navigate"',
  '"name": "browser_snapshot"',
  '"name": "bash"',
  '"name": "WebFetch"',
  '"name": "WebSearch"',
  'Taking a screenshot...',
  '</thinking>',
  '<thinking>',
];

// Required section patterns (at least 2 must be present for a valid report)
const SECTION_PATTERNS = [
  /^## (?:A\)|Block A|Bloque A|Resumen del Rol)/m,
  /^## (?:B\)|Block B|Bloque B|Match (?:con )?CV)/m,
  /^## (?:C\)|Block C|Bloque C|Nivel|Stratégie)/m,
  /^## (?:D\)|Block D|Bloque D|Comp)/m,
  /^## (?:E\)|Block E|Bloque E|Personali[sz]ation|Plan de)/m,
  /^## (?:F\)|Block F|Bloque F|Entrevista|Interview|Préparation)/m,
  /^## (?:Scoring|Score|Recommand|Disqualification|🚨)/m,
];

// Valid filename pattern
const FILENAME_PATTERN = /^\d{3}-[\w-]+-\d{4}-\d{2}-\d{2}\.md$/;

// Valid score pattern
const SCORE_PATTERN = /\*\*Score:\*\*\s*\d+\.?\d*\/5/;

if (!existsSync(REPORTS_DIR)) {
  console.log('\n📄 No reports/ directory found. Nothing to verify.\n');
  process.exit(0);
}

const files = readdirSync(REPORTS_DIR).filter(f => f.endsWith('.md'));

if (files.length === 0) {
  console.log('\n📄 No report files found in reports/. Nothing to verify.\n');
  process.exit(0);
}

console.log(`\n📄 Checking ${files.length} report(s) in reports/\n`);

for (const file of files) {
  if (file === '.gitkeep') continue;

  const filePath = join(REPORTS_DIR, file);
  const content = readFileSync(filePath, 'utf-8');
  let fileHasError = false;

  // Check 1: Filename format
  if (!FILENAME_PATTERN.test(file)) {
    warn(file, `Filename doesn't match expected format (###-slug-YYYY-MM-DD.md)`);
  }

  // Check 2: Corruption — raw tool_call/tool_response content
  const foundCorruption = CORRUPTION_PATTERNS.filter(p => content.includes(p));
  if (foundCorruption.length > 0) {
    error(file, `CORRUPTED — contains raw LLM logs (${foundCorruption.length} patterns: ${foundCorruption.slice(0, 3).join(', ')}...)`);
    fileHasError = true;
  }

  // Check 3: Has valid header
  if (!content.match(/^# (?:Evaluation|Evaluación|Evaluation Report)/m)) {
    error(file, `Missing proper report header (expected "# Evaluation..." or "# Evaluación...")`);
    fileHasError = true;
  }

  // Check 4: Has valid score
  if (!SCORE_PATTERN.test(content)) {
    if (content.includes('**Score:** —') || content.includes('**Score:** -')) {
      error(file, `Score is a placeholder dash — evaluation was not completed`);
      fileHasError = true;
    } else if (!content.match(/\*\*Score:\*\*/)) {
      error(file, `Missing Score field in header`);
      fileHasError = true;
    }
  }

  // Check 5: Has structured content (at least 2 evaluation sections)
  const sectionCount = SECTION_PATTERNS.filter(p => p.test(content)).length;
  if (sectionCount < 2) {
    error(file, `Only ${sectionCount} evaluation sections found (need at least 2 of A-F blocks)`);
    fileHasError = true;
  }

  // Check 6: Has URL field
  if (!content.includes('**URL:**')) {
    warn(file, `Missing **URL:** field in header`);
  }

  // Fix mode: delete any file with errors
  if (FIX_MODE && fileHasError) {
    unlinkSync(filePath);
    console.log(`   🗑️  Deleted invalid report: ${file}`);
    const logEntry = `${new Date().toISOString()}\t${file}\tINVALID\tDeleted for re-processing\n`;
    appendFileSync(join(CAREER_OPS, 'batch/logs/corrupted-reports.log'), logEntry);
    fixed++;
  }
}

// Summary
console.log('\n' + '='.repeat(50));
console.log(`📄 Report Health: ${errors} errors, ${warnings} warnings${FIX_MODE ? `, ${fixed} fixed` : ''}`);
if (errors === 0 && warnings === 0) {
  console.log('🟢 All reports are valid!');
} else if (errors === 0) {
  console.log('🟡 Reports OK with warnings');
} else {
  console.log('🔴 Reports have errors — run with --fix to clean up corrupted files');
  if (!FIX_MODE) {
    console.log('   💡 Run: node verify-reports.mjs --fix');
  }
}

process.exit(errors > 0 ? 1 : 0);
