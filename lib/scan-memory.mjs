/**
 * What a scan remembers between runs, and whose memory it is.
 *
 *   scan-history.tsv           URLs seen (dedup, first_seen for undated offers,
 *                              jev_dropped / expired / deleted blocks)
 *   scan-decisions.jsonl       why each posting was rejected or kept
 *   scan-state.json            when each source last ran
 *   scan-selection.json        the source picker's choice for the next scan
 *   scan-selection-log.jsonl   the choices a scan reset
 *   web-search-yield.json      web queries resting after empty runs
 *   deleted-applications.tsv   company+role pairs deleted from the tracker
 *   gate-drops.jsonl           pipeline offers dropped before Qwen, with the
 *                              reason (lib/gate-drops.mjs)
 *
 * The files under data/ are the owner's (local mode, the admin account).
 * Every other account keeps the same files in data/accounts/<account id>/:
 * its scans never skip a posting because the owner saw it, and never change
 * the owner's next scan. Supabase has no scan-history table, so the folder is
 * on the server that runs the scan.
 */

import { mkdir } from 'fs/promises';
import { join } from 'path';

export const ACCOUNTS_DIR = join('data', 'accounts');

// purge-stale.mjs keeps the owner's history this long (portals.yml
// retention_days overrides it).
export const SCAN_HISTORY_RETENTION_DAYS = 20;

const SUPABASE_USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The scan files of the owner (no account id) or of one account. The folder
 * comes from the signed-in account's id only: anything but a Supabase user id
 * could climb out of data/accounts/, so it throws.
 */
export function scanMemoryPaths(root, accountId = null) {
  let account = null;
  if (accountId != null) {
    if (typeof accountId !== 'string' || !SUPABASE_USER_ID.test(accountId)) throw new Error('invalid account id');
    account = accountId.toLowerCase();
  }
  const dir = account ? join(root, ACCOUNTS_DIR, account) : join(root, 'data');
  return Object.freeze({
    account,
    dir,
    history: join(dir, 'scan-history.tsv'),
    decisions: join(dir, 'scan-decisions.jsonl'),
    state: join(dir, 'scan-state.json'),
    selection: join(dir, 'scan-selection.json'),
    selectionLog: join(dir, 'scan-selection-log.jsonl'),
    queryYield: join(dir, 'web-search-yield.json'),
    deleted: join(dir, 'deleted-applications.tsv'),
    gateDrops: join(dir, 'gate-drops.jsonl'),
  });
}

/** data/ is there on the owner's install; an account's folder is made on its first write. */
export async function ensureScanMemoryDir(memory) {
  if (memory?.account) await mkdir(memory.dir, { recursive: true });
}

/** YYYY-MM-DD, retentionDays before today (YYYY-MM-DD). */
export function scanHistoryCutoff(today, retentionDays = SCAN_HISTORY_RETENTION_DAYS) {
  const days = Number(retentionDays);
  const keep = Number.isFinite(days) && days > 0 ? days : SCAN_HISTORY_RETENTION_DAYS;
  const base = new Date(`${String(today).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return '';
  return new Date(base.getTime() - keep * 864e5).toISOString().slice(0, 10);
}

/**
 * The rows purge-stale.mjs would keep: first seen on or after the cutoff, or
 * `deleted` (a manual delete keeps blocking the URL). The header and rows
 * without a readable date stay. An account's history has no purge run, so it
 * drops these rows itself as it grows.
 */
export function pruneScanHistoryLines(lines = [], cutoffIso = '') {
  if (!cutoffIso) return [...lines];
  return lines.filter(line => {
    const cells = String(line || '').split('\t');
    const url = cells[0]?.trim();
    if (!url || url === 'url') return true;
    const firstSeen = /^\d{4}-\d{2}-\d{2}/.test(cells[1]?.trim() || '') ? cells[1].trim().slice(0, 10) : '';
    const status = (cells[5] || '').trim().toLowerCase();
    return !(firstSeen && firstSeen < cutoffIso && status !== 'deleted');
  });
}
