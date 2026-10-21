// Per-query yield memory for web-search scan queries (data/web-search-yield.json).
//
// Measured 2026-10-13 over 20 scans: 15 of 30 enabled web queries never
// returned a single title-matched posting, yet each one still cost up to three
// throttled search-engine page loads per scan. A query that came back empty on
// EMPTY_RUNS_BEFORE_SKIP loaded runs in a row rests for RETRY_AFTER_DAYS, then
// gets one more try. Runs where every engine was blocked say nothing about the
// query and are not counted. Keys are the query text, so a reworded or newly
// generated query starts with a clean slate.
import { readFile, writeFile } from 'node:fs/promises';

export const EMPTY_RUNS_BEFORE_SKIP = 3;
export const RETRY_AFTER_DAYS = 7;
const FORGET_AFTER_DAYS = 60;

export function queryYieldKey(query = '') {
  return String(query).replace(/\s+/g, ' ').trim().toLowerCase();
}

function daysBetween(from, to) {
  return Math.floor((Date.parse(to) - Date.parse(from)) / 86400000);
}

export function shouldSkipQuery(store, query, today) {
  const entry = store[queryYieldKey(query)];
  if (!entry || entry.empty < EMPTY_RUNS_BEFORE_SKIP) return false;
  return daysBetween(entry.lastRun, today) < RETRY_AFTER_DAYS;
}

// Run order. A scan can lose the rest of its web queries to a search-engine
// challenge (2026-10-21: 61 of 95 skipped), and the config order put ~25
// per-company fallback queries (3.3 matching titles each that day) ahead of
// the `site:` ATS queries that return 13 to 19 per run. Best first, so what a
// block costs is the weakest queries. A query never run yet scores between
// proven ones and companies: it gets a fair first try without cutting the line.
export const NEW_QUERY_SCORE = 6;
export const COMPANY_QUERY_SCORE = 3;

export function webSearchScore(store, source) {
  if (source?.isCompany) return COMPANY_QUERY_SCORE;
  const entry = store[queryYieldKey(source?.query)];
  return entry && entry.runs > 0 ? entry.hits / entry.runs : NEW_QUERY_SCORE;
}

/** New array, highest expected hits per run first; ties keep the config order. */
export function orderWebSearchSources(sources = [], store = {}) {
  return sources
    .map((source, index) => ({ source, index, score: webSearchScore(store, source) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ source }) => source);
}

export function recordQueryYield(store, query, { hits = 0, blocked = false } = {}, today) {
  const key = queryYieldKey(query);
  if (!key || blocked) return store;
  const entry = store[key] || { runs: 0, empty: 0, hits: 0, lastRun: '', lastHit: '' };
  entry.runs += 1;
  entry.hits += hits;
  entry.empty = hits > 0 ? 0 : entry.empty + 1;
  entry.lastRun = today;
  if (hits > 0) entry.lastHit = today;
  store[key] = entry;
  return store;
}

export async function loadQueryYield(path) {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf-8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export async function saveQueryYield(path, store, today) {
  const kept = Object.fromEntries(Object.entries(store)
    .filter(([, entry]) => entry?.lastRun && daysBetween(entry.lastRun, today) <= FORGET_AFTER_DAYS));
  await writeFile(path, `${JSON.stringify(kept, null, 2)}\n`);
}
