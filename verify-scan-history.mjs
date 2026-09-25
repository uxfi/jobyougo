#!/usr/bin/env node
/**
 * verify-scan-history.mjs — Integrity check & repair for data/scan-history.tsv
 *
 * scan-history.tsv is the URL-exact dedup backbone of the scanner (modes/scan.md
 * §11). It is appended to by hand today, and a raw newline inside a title field
 * has split rows in the past (e.g. "...dele\nted", "...Soluti\nons Engineer").
 * Nothing validated this file — verify-pipeline.mjs only covers applications.md.
 *
 * Expected format: append-only, 6 to N tab-separated columns (N = current
 * SCAN_HISTORY_HEADER width in scan.mjs — today 12: url, first_seen, portal,
 * title, company, status, location, fingerprint, posted_at, trust_score,
 * trust_flags, normalized_company). Older rows keep their narrower shape
 * forever (appendToScanHistory never rewrites existing rows), so a mix of
 * row widths in the same file is normal, not corruption — this validates
 * against scan.mjs's own header constant instead of a fixed column count so
 * the next schema widening can't silently desync the two again (it did once:
 * a 6-column check flagged every current-format row as malformed).
 *
 * Usage:
 *   node verify-scan-history.mjs           → report only, exit 1 if malformed found
 *   node verify-scan-history.mjs --fix     → backup .bak, repair, rewrite
 *
 * Repair policy for malformed rows (the URL is unrecoverable once a row is split):
 *   - A fragment that still carries a company + a `deleted` status (≥3 fields)
 *     is recovered into data/deleted-applications.tsv as a company+role exclusion
 *     — the mechanism that actually prevents a deleted offer from being re-added
 *     (scan-history dedup is URL-exact and the URL is lost). The fragment is then
 *     removed from scan-history.tsv.
 *   - Pure noise (no recoverable company, e.g. "ted") is dropped and logged.
 * Duplicate URLs are reported (informational) but NOT collapsed — the file is an
 * audit log of every seen URL, and added→deleted transitions are legitimate.
 *
 * Run from the career-ops root: node verify-scan-history.mjs [--fix]
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tsvSafe, slugify } from './lib/scan-filters.mjs';
import { SCAN_HISTORY_HEADER } from './scan.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const HISTORY = join(ROOT, 'data/scan-history.tsv');
const DELETED = join(ROOT, 'data/deleted-applications.tsv');
const FIX = process.argv.includes('--fix');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Legacy floor (pre-`location` column) — old rows already written keep this
// shape forever, so it stays hardcoded; only the ceiling tracks scan.mjs.
const MIN_COLS = 6;
const MAX_COLS = SCAN_HISTORY_HEADER.trim().split('\t').length;
const KNOWN_STATUSES = new Set([
  'added', 'deleted', 'expired',
  'skipped_remote', 'skipped_title', 'skipped_dup', 'skipped_blocked', 'recovered',
]);

function today() {
  return new Date().toISOString().slice(0, 10);
}

if (!existsSync(HISTORY)) {
  console.error(`❌  ${HISTORY} not found.`);
  process.exit(1);
}

const raw = readFileSync(HISTORY, 'utf-8');
const physicalLines = raw.split('\n');

const valid = [];        // kept verbatim
const malformed = [];    // { lineNo, line, fields }
const urlCounts = new Map();

physicalLines.forEach((line, i) => {
  if (line.trim() === '') return; // ignore blank / trailing newline
  const fields = line.split('\t');
  // Header row (same `cols[0] === 'url'` check scan.mjs/stats.mjs use to
  // detect it) is structural, not a data row — keep it verbatim, don't run
  // it through the data-row shape check (its own cells, e.g. "first_seen",
  // never match DATE_RE).
  if (fields[0] === 'url') {
    valid.push(line);
    return;
  }
  const isValid = fields.length >= MIN_COLS && fields.length <= MAX_COLS && DATE_RE.test(fields[1]);
  if (isValid) {
    valid.push(line);
    urlCounts.set(fields[0], (urlCounts.get(fields[0]) || 0) + 1);
  } else {
    malformed.push({ lineNo: i + 1, line, fields });
  }
});

const duplicates = [...urlCounts.entries()].filter(([, n]) => n > 1);

// ─── Report ──────────────────────────────────────────────────────────────────

console.log(`scan-history.tsv integrity — ${HISTORY.replace(/^.*career-ops-main\//, '')}`);
console.log('━'.repeat(60));
console.log(`Valid rows:      ${valid.length}`);
console.log(`Malformed rows:  ${malformed.length}`);
console.log(`Duplicate URLs:  ${duplicates.length} (informational, not collapsed)`);

if (malformed.length) {
  console.log('\nMalformed lines:');
  for (const m of malformed) {
    console.log(`  L${m.lineNo} (NF=${m.fields.length})  ${m.line}`);
  }
}

if (!malformed.length) {
  console.log('\n✅  No malformed rows. Nothing to repair.');
  process.exit(0);
}

if (!FIX) {
  console.log('\n⚠️  Run with --fix to repair (a .bak backup is written first).');
  process.exit(1);
}

// ─── Repair (--fix) ────────────────────────────────────────────────────────────

copyFileSync(HISTORY, `${HISTORY}.bak`);
console.log(`\n💾  Backup → ${HISTORY}.bak`);

const recovered = []; // { company, role }
const dropped = [];   // line

for (const m of malformed) {
  const f = m.fields;
  const status = f[f.length - 1]?.trim();
  // Recoverable only when a `deleted` fragment keeps a company (≥3 fields):
  // [...titleTail, company, status]. URL is lost, so the company+role exclusion
  // in deleted-applications.tsv is the right home for it.
  if (f.length >= 3 && status === 'deleted') {
    const company = tsvSafe(f[f.length - 2]);
    const role = tsvSafe(f.slice(0, f.length - 2).join(' '));
    if (company.length >= 3 && /[a-zA-Z]/.test(company)) {
      recovered.push({ company, role });
      continue;
    }
  }
  dropped.push(m.line);
}

// Rewrite scan-history.tsv with only the valid rows (malformed removed).
writeFileSync(HISTORY, valid.join('\n') + '\n', 'utf-8');
console.log(`🧹  Rewrote scan-history.tsv with ${valid.length} valid rows (removed ${malformed.length} malformed).`);

// Preserve the dedup signal for recovered deleted offers.
if (recovered.length) {
  if (!existsSync(DELETED)) {
    writeFileSync(DELETED, 'company\trole\tdate_deleted\treason\n', 'utf-8');
    console.log(`📄  Created ${DELETED.replace(/^.*career-ops-main\//, '')} (header).`);
  }
  const d = today();
  const rows = recovered
    .map(r => `${r.company}\t${r.role}\t${d}\trecovered_from_corrupted_scan_history`)
    .join('\n') + '\n';
  appendFileSync(DELETED, rows, 'utf-8');
  console.log(`\n♻️  Recovered ${recovered.length} deleted offer(s) → deleted-applications.tsv (company+role exclusion):`);
  recovered.forEach(r => console.log(`     + ${r.company} | ${r.role}`));
}

if (dropped.length) {
  console.log(`\n🗑  Dropped ${dropped.length} unrecoverable fragment(s) (no company/URL):`);
  dropped.forEach(l => console.log(`     - ${JSON.stringify(l)}`));
}

console.log('\n✅  Repair complete. Re-run without --fix to confirm 0 malformed.');
process.exit(0);
