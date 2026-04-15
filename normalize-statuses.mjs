#!/usr/bin/env node
/**
 * normalize-statuses.mjs — Clean non-canonical states in applications.md
 *
 * Maps legacy/Spanish statuses to English canonical ones per states.yml:
 *   Evaluated, Applied, Responded, Interview, Offer, Rejected, Discarded, SKIP
 *
 * Also strips markdown bold (**) and dates from the status field,
 * moving DUPLICADO info to the notes column.
 *
 * Run: node normalize-statuses.mjs [--dry-run]
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'fs';
import { join } from 'path';

const CAREER_OPS = new URL('.', import.meta.url).pathname;
const APPS_FILE = existsSync(join(CAREER_OPS, 'data/applications.md'))
  ? join(CAREER_OPS, 'data/applications.md')
  : join(CAREER_OPS, 'applications.md');
const DRY_RUN = process.argv.includes('--dry-run');

const CANONICAL = ['Evaluated', 'Applied', 'Responded', 'Interview', 'Offer', 'Rejected', 'Discarded', 'SKIP'];

function normalizeStatus(raw) {
  const s = raw.replace(/\*\*/g, '').trim();
  const lower = s.toLowerCase();

  // Already canonical — just fix casing
  for (const c of CANONICAL) {
    if (lower === c.toLowerCase()) return { status: c };
  }

  // DUPLICADO / Repost → Discarded (move original to notes)
  if (/^(duplicado|dup\b|repost)/i.test(s)) return { status: 'Discarded', moveToNotes: s };

  // Empty / dash → Discarded
  if (!s || s === '—' || s === '-') return { status: 'Discarded' };

  // Patterns with trailing dates
  if (/^rechazado\s+\d{4}/i.test(s)) return { status: 'Rejected' };
  if (/^aplicado\s+\d{4}/i.test(s)) return { status: 'Applied' };

  // Geo blocker
  if (/geo.?blocker/i.test(s)) return { status: 'SKIP' };

  const map = {
    // Evaluated
    'evaluada': 'Evaluated', 'evaluar': 'Evaluated', 'condicional': 'Evaluated',
    'hold': 'Evaluated', 'monitor': 'Evaluated', 'verificar': 'Evaluated',
    // Applied
    'aplicado': 'Applied', 'aplicada': 'Applied', 'enviada': 'Applied', 'sent': 'Applied',
    // Responded
    'respondido': 'Responded',
    // Interview
    'entrevista': 'Interview',
    // Offer
    'oferta': 'Offer',
    // Rejected
    'rechazado': 'Rejected', 'rechazada': 'Rejected',
    // Discarded
    'descartado': 'Discarded', 'descartada': 'Discarded',
    'cerrada': 'Discarded', 'cancelada': 'Discarded',
    // SKIP
    'no aplicar': 'SKIP', 'no_aplicar': 'SKIP',
    'no apply': 'SKIP', 'no_apply': 'SKIP',
    'skip': 'SKIP',
  };

  if (map[lower]) return { status: map[lower] };

  return { status: null, unknown: true };
}

if (!existsSync(APPS_FILE)) {
  console.log('No applications.md found. Nothing to normalize.');
  process.exit(0);
}

const content = readFileSync(APPS_FILE, 'utf-8');
const lines = content.split('\n');

let changes = 0;
const unknowns = [];

for (let i = 0; i < lines.length; i++) {
  if (!lines[i].startsWith('|')) continue;

  const parts = lines[i].split('|').map(s => s.trim());
  if (parts.length < 9) continue;
  if (parts[1] === '#' || parts[1] === '---' || parts[1] === '') continue;

  const num = parseInt(parts[1]);
  if (isNaN(num)) continue;

  const rawStatus = parts[6];
  const result = normalizeStatus(rawStatus);

  if (result.unknown) {
    unknowns.push({ num, rawStatus, line: i + 1 });
    continue;
  }

  if (result.status === rawStatus) continue;

  const oldStatus = rawStatus;
  parts[6] = result.status;

  if (result.moveToNotes) {
    const existing = parts[9] || '';
    if (!existing.includes(result.moveToNotes)) {
      parts[9] = result.moveToNotes + (existing ? '. ' + existing : '');
    }
  }

  // Strip bold from score field while we're here
  if (parts[5]) parts[5] = parts[5].replace(/\*\*/g, '');

  lines[i] = '| ' + parts.slice(1, -1).join(' | ') + ' |';
  changes++;
  console.log(`#${num}: "${oldStatus}" → "${result.status}"`);
}

if (unknowns.length > 0) {
  console.log(`\n⚠️  ${unknowns.length} unknown status(es):`);
  for (const u of unknowns) {
    console.log(`  #${u.num} (line ${u.line}): "${u.rawStatus}"`);
  }
}

console.log(`\n📊 ${changes} status(es) normalized`);

if (!DRY_RUN && changes > 0) {
  copyFileSync(APPS_FILE, APPS_FILE + '.bak');
  writeFileSync(APPS_FILE, lines.join('\n'));
  console.log('✅ Written (backup: applications.md.bak)');
} else if (DRY_RUN) {
  console.log('(dry-run — no changes written)');
} else {
  console.log('✅ No changes needed');
}
