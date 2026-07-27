/**
 * lib/scan-filters.mjs — Shared, pure helpers for the deterministic scanner.
 *
 * Used by scan-fetch.mjs (Levels 2/4/5) and verify-scan-history.mjs.
 * No side effects, no I/O except loadPortals(). Mirrors the title/remote
 * rules described in modes/scan.md (§9 remote, §10 title) so the script and
 * the LLM stay consistent.
 */

import { readFileSync } from 'fs';
import yaml from 'js-yaml';

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

// Whole-word/phrase matching (memoized per term-array). Boundaries are
// non-alphanumeric, so "AI" matches "Senior AI Eng" / "AI/ML" / "(AI)" but NOT
// "liaison" / "available", and geo "eu" no longer matches "neural". Multi-word
// phrases and punctuated terms (".NET", "UX/UI") are escaped and matched literally.
const _matcherCache = new WeakMap();
function matcherFor(terms) {
  if (!Array.isArray(terms)) return null;
  if (_matcherCache.has(terms)) return _matcherCache.get(terms);
  const escaped = terms
    .map(t => String(t).trim().toLowerCase())
    .filter(Boolean)
    .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = escaped.length
    ? new RegExp(`(?<![a-z0-9])(?:${escaped.join('|')})(?![a-z0-9])`, 'i')
    : null;
  _matcherCache.set(terms, re);
  return re;
}

function containsAny(text, terms) {
  const re = matcherFor(terms);
  if (!re) return null;
  const hit = String(text).match(re);
  return hit ? hit[0].toLowerCase().trim() : null;
}

/**
 * Title filter (modes/scan.md §10): ≥1 positive keyword AND 0 negative keyword.
 * Case-insensitive substring match. Returns {ok, matched, blockedBy}.
 */
export function passesTitle(title, titleFilter = {}) {
  const t = String(title ?? '').toLowerCase();
  const blockedBy = containsAny(t, titleFilter.negative);
  if (blockedBy) return { ok: false, matched: null, blockedBy };
  const matched = containsAny(t, titleFilter.positive);
  return { ok: Boolean(matched), matched, blockedBy: null };
}

/**
 * Remote filter (modes/scan.md §9, strict_full_remote_only):
 *   reject if a rejected_any or rejected_geo_any term is present;
 *   reject if NO required_any (remote) wording at all;
 *   pass if an allowed_geo_any term is present (confident geo match);
 *   otherwise the geo is ambiguous → obey remote_filter.ambiguous_policy:
 *     'keep' (config default here) keeps it for max recall, 'skip' rejects it.
 * `text` should combine location/remote wording + title (+ description when available).
 * Returns {ok, reason}.
 */
export function passesRemote(text, remoteFilter = {}, opts = {}) {
  const t = String(text ?? '').toLowerCase();

  const rejected = containsAny(t, remoteFilter.rejected_any);
  if (rejected) return { ok: false, reason: `rejected_term:${rejected}` };

  const rejectedGeo = containsAny(t, remoteFilter.rejected_geo_any);
  if (rejectedGeo) return { ok: false, reason: `rejected_geo:${rejectedGeo}` };

  const required = containsAny(t, remoteFilter.required_any);
  if (!required) return { ok: false, reason: 'no_remote_wording' };

  const geo = containsAny(t, remoteFilter.allowed_geo_any);
  if (geo) return { ok: true, reason: `remote:${required}+geo:${geo}` };

  // Remote wording present, no explicit compatible geo, not explicitly rejected.
  // `opts.ambiguousPolicy` overrides the config (callers set 'keep' for worldwide
  // remote-only boards, 'skip' for company boards where ambiguous ≈ US/regional).
  const policy = opts.ambiguousPolicy || remoteFilter.ambiguous_policy || 'skip';
  if (policy === 'keep') return { ok: true, reason: `remote:${required}+geo:ambiguous` };
  return { ok: false, reason: 'no_compatible_geo' };
}
