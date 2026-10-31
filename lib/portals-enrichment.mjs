// On-demand portals enrichment: what the "Find companies" button runs.
//
// A scan already ends with two passes that grow portals.yml: the ATS explorer
// (finds companies hiring on public ATS boards) and the board resolver (gives
// tracked companies that fall back to search engines their public board).
// Both run on a small budget so a scan stays cheap. This module runs the same
// two passes once, on demand, with a wider budget and the scan files as extra
// input, and returns one summary for the UI. Nothing here writes portals.yml
// itself: it goes through the explorer's and resolver's own locked, backed-up,
// atomic writers.

import { runAtsExplorer, collectHistoryUrls } from './ats-explorer.mjs';
import { runAtsBoardResolver } from './ats-board-resolver.mjs';

// Explicit ats_explorer settings in portals.yml still win over these.
export const MANUAL_EXPLORER_BUDGET = Object.freeze({
  max_queries: 12,        // a scan runs 6
  max_add: 25,            // a scan adds at most 10
  max_verify: 80,         // a scan checks 40 boards
  max_gh_lookups: 60,     // a scan resolves 15 employer sites
  longtail_queries: true, // BambooHR, Breezy, Pinpoint, Rippling, JOIN, Comeet too
});

/** Rejection reasons of an explorer run, counted: { no_matching_role: 7, empty_board: 2 }. */
export function rejectionCounts(records = []) {
  const out = {};
  for (const r of records) if (r?.decision === 'skipped' && r.reason) out[r.reason] = (out[r.reason] || 0) + 1;
  return out;
}

/**
 * One enrichment pass.
 * @param {object} o
 * @param {string} o.portalsPath
 * @param {string} o.dataDir
 * @param {object} [o.config]       portals config as the scan sees it (profile-filled when available)
 * @param {object} [o.geoPolicy]    geoPolicyFrom(profile location)
 * @param {Function|null} [o.search] active input: (query) => { urls, text, blocked }; null stays passive
 * @param {Function} [o.accessOf]   the scan's getCompanyScanAccess (the resolver tells search-only companies from board readers by it)
 * @param {(phase:string)=>void} [o.onPhase]
 */
export async function runPortalsEnrichment({
  portalsPath, dataDir, config = {}, geoPolicy = null, search = null, accessOf, onPhase = () => {},
  fetchImpl = globalThis.fetch, env = process.env, log = console.log, now = new Date(), dryRun = false,
} = {}) {
  const budgeted = { ...config, ats_explorer: { ...MANUAL_EXPLORER_BUDGET, ...(config?.ats_explorer || {}) } };

  onPhase('history');
  const offerUrls = await collectHistoryUrls(dataDir);

  onPhase('explore');
  const explorer = await runAtsExplorer({ portalsPath, dataDir, config: budgeted, offerUrls, search, geoPolicy, fetchImpl, env, log, now, dryRun });

  onPhase('resolve');
  let resolver = null;
  let resolverError = null;
  try {
    resolver = await runAtsBoardResolver({ portalsPath, dataDir, accessOf, config, fetchImpl, env, log, now, dryRun });
  } catch (err) {
    resolverError = err.message;
    log(`[scan] [resolver] skipped: ${err.message}`);
  }

  // appliedNames also lists the entries the resolver switched off; only repointed ones count as resolved
  const resolvedNames = (resolver?.records || []).filter((r) => r.decision === 'resolved' || r.decision === 'repaired').map((r) => r.company);

  return {
    disabled: Boolean(explorer.disabled),
    searched: Boolean(search),
    queries: explorer.queries,
    blocked: explorer.blocked,
    found: explorer.found,
    checked: explorer.verified,
    added: explorer.added,
    addedNames: explorer.addedNames,
    rejected: rejectionCounts(explorer.records),
    resolved: resolvedNames.length,
    resolvedNames,
    duplicatesDisabled: resolver ? resolver.duplicates : 0,
    removed: resolver ? resolver.removed : 0,
    removedNames: resolver ? resolver.removedNames : [],
    resolverError,
    backups: [explorer.backupPath, resolver?.backupPath].filter(Boolean),
  };
}
