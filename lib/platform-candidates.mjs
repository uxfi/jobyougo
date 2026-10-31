// Platform candidates at the end of a scan: the hosts the scanner keeps meeting
// that no provider, portals.yml source or exclusion covers (discover-platforms.mjs
// does the ranking). The scan used to leave that to a manual CLI run, so a new ATS
// vendor or job board could sit in the history for weeks. Now the shortlist is
// refreshed after every scan in data/platform-candidates.json, and the log says
// which domains are new since the previous run.
//
// Read-only on the scan data, zero network, zero tokens. A candidate is only a
// pointer: adding a provider stays a human decision (providers/ADDING_A_PROVIDER.md).

import { readFileSync, renameSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverPlatforms } from '../discover-platforms.mjs';
import { loadProviders } from '../providers/_registry.mjs';

const PROVIDERS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'providers');
const KEEP = 20;

const readJson = (path) => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } };

/**
 * @param {object} o
 * @param {string} o.dataDir      scan data directory (reads its jsonl/tsv, writes platform-candidates.json)
 * @param {string} o.portalsPath
 * @param {Map}    [o.providers]  id→provider map; loaded from providers/ when omitted
 * @returns {Promise<{total:number, fresh:string[], top:object[], written:string|null}>}
 */
export async function recordPlatformCandidates({
  dataDir, portalsPath, providers = null, sinceDays = 30, log = console.log, env = process.env, dryRun = false,
} = {}) {
  if (/^(0|false|off|no)$/i.test(env.PLATFORM_CANDIDATES || '')) return { total: 0, fresh: [], top: [], written: null, disabled: true };
  const registry = providers || await loadProviders(PROVIDERS_DIR);
  const result = await discoverPlatforms({ dataDir, portalsPath, providers: registry, sinceDays });
  const top = (result.candidates || []).slice(0, KEEP);
  const outPath = join(dataDir, 'platform-candidates.json');
  const before = new Set((readJson(outPath)?.candidates || []).map((c) => c.domain));
  const fresh = top.filter((c) => !before.has(c.domain)).map((c) => c.domain);
  let written = null;
  if (!dryRun) {
    mkdirSync(dataDir, { recursive: true });
    const tmp = `${outPath}.tmp`;
    writeFileSync(tmp, JSON.stringify({ generated: new Date().toISOString(), since_days: sinceDays, candidates: top }, null, 2) + '\n');
    renameSync(tmp, outPath);
    written = outPath;
  }
  if (top.length) {
    const head = top.slice(0, 3).map((c) => `${c.domain} (${c.companies} employers)`).join(', ');
    log(`[scan] [platforms] ${top.length} unknown platform${top.length > 1 ? 's' : ''} met${fresh.length ? `, ${fresh.length} new (${fresh.slice(0, 3).join(', ')})` : ''}: ${head}`);
  }
  return { total: (result.candidates || []).length, fresh, top, written };
}
