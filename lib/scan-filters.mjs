/**
 * lib/scan-filters.mjs — Shared, pure helpers for the deterministic scanner.
 *
 * Used by verify-scan-history.mjs, purge-stale.mjs, and the UI server's scanner.
 * No side effects, no I/O except loadPortals(). Mirrors the title/remote
 * rules described in modes/scan.md (§9 remote, §10 title) so the script and
 * the LLM stay consistent.
 */

import { readFileSync } from 'fs';
import * as yaml from 'js-yaml';
import { assessRemote, explainTitle } from './scan-decision.mjs';

// ─── Config ────────────────────────────────────────────────────────────────

export function loadPortals(portalsPath) {
  return yaml.load(readFileSync(portalsPath, 'utf-8')) || {};
}

// ─── String safety / normalization ───────────────────────────────────────────

/**
 * Make a string safe to drop into a single TSV / pipeline cell.
 * Collapses tabs and newlines into spaces — this is the ROOT-CAUSE fix for the
 * corruption seen in scan-history.tsv (a raw \n inside a title split the row).
 */
export function tsvSafe(s) {
  return String(s ?? '')
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeCompany(name) {
  return String(name ?? '').toLowerCase()
    .replace(/[()]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .trim();
}

export function normalizeRole(role) {
  return String(role ?? '').toLowerCase()
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 /]/g, '')
    .trim();
}

/** ≥2 overlapping significant words → same role (matches dedup-tracker.mjs). */
export function roleMatch(a, b) {
  const wordsA = normalizeRole(a).split(/\s+/).filter(w => w.length > 3);
  const wordsB = normalizeRole(b).split(/\s+/).filter(w => w.length > 3);
  const overlap = wordsA.filter(w => wordsB.some(wb => wb.includes(w) || w.includes(wb)));
  return overlap.length >= 2;
}

export function slugify(s) {
  return String(s ?? '').toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'unknown';
}

// ─── Filters ─────────────────────────────────────────────────────────────────

/**
 * Title filter. Delegates to lib/scan-decision.mjs so the app and the CLI
 * share one gate (keywords + configurable patterns).
 */
export function passesTitle(title, titleFilter = {}) {
  const result = explainTitle(title, titleFilter);
  return { ok: result.ok, matched: result.matched, blockedBy: result.blockedBy };
}

/**
 * Remote filter. Same assessRemote() as the app and the CLI.
 * ambiguous_policy: reject | review | keep_but_downrank | keep.
 * `skip` is treated as reject. Default when the policy is absent: reject.
 */
export function passesRemote(text, remoteFilter = {}, opts = {}) {
  const policy = opts.ambiguousPolicy || remoteFilter.ambiguous_policy || 'reject';
  const result = assessRemote(
    { title: text, location: text, description: text, remoteEvidence: text },
    { ...remoteFilter, ambiguous_policy: policy },
  );
  return {
    ok: result.disposition !== 'reject',
    reason: result.reason,
    disposition: result.disposition,
    confidence: result.confidence,
  };
}
