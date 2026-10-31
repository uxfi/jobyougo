#!/usr/bin/env node

/**
 * resolve-boards.mjs - find the public ATS board of tracked companies that have
 * none (they fall back to the search engines or a browser crawl) and repair the
 * Greenhouse/Ashby/Lever boards that answer 404. A board that stays dead (two
 * passes 3+ days apart, no replacement) and an auto-added board that stays empty
 * for 3 weeks are removed from portals.yml, not switched off. Same code as the
 * end of a UI scan (lib/ats-board-resolver.mjs); this is the way to preview or
 * run it by hand.
 *
 * A guessed slug is only kept when the board's own data names the company, so
 * "gong" on SmartRecruiters (a journalism internship) is rejected.
 *
 * Usage:
 *   node resolve-boards.mjs                      # preview: probes, prints, writes nothing
 *   node resolve-boards.mjs --apply              # rewrite portals.yml (backup portals.yml.bak-resolver-*)
 *   node resolve-boards.mjs --stale              # also ask every Greenhouse/Ashby/Lever board whether it is dead (~600 requests)
 *   node resolve-boards.mjs --company "Twilio"   # one company (repeatable)
 *   node resolve-boards.mjs --max 40             # companies probed in this run (default 25)
 *
 * Preview writes nothing, not even the state file, so it can be re-run freely.
 */

import { dirname } from 'node:path';
import { runAtsBoardResolver } from './lib/ats-board-resolver.mjs';
import { PORTALS_PATH, PIPELINE_PATH } from './scan.mjs';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const values = (name) => argv.flatMap((a, i) => (a === name && argv[i + 1] ? [argv[i + 1]] : []));

const apply = flag('--apply');
const only = values('--company');
const max = Number.parseInt(values('--max')[0] ?? '', 10);

const summary = await runAtsBoardResolver({
  portalsPath: PORTALS_PATH,
  dataDir: dirname(PIPELINE_PATH),
  probeStale: flag('--stale'),
  only: only.length ? only : null,
  config: Number.isFinite(max) ? { ats_board_resolver: { max_companies: max } } : {},
  dryRun: !apply,
  log: (line) => console.log(line.replace(/^\[scan\] /, '')),
});

if (summary.disabled) process.exit(0);
for (const r of summary.records) {
  const where = r.ats ? `${r.ats}:${r.slug}${r.open_roles ? ` (${r.open_roles} roles, ${r.confidence})` : ''}` : '';
  const why = r.rejected?.length ? ` [${r.rejected.join('; ')}]` : '';
  console.log(`${r.decision.padEnd(12)} ${String(r.company).padEnd(30)} ${where}${r.decision === 'no_board' || r.decision === 'not_written' || r.decision === 'duplicate_of' || r.decision === 'disabled' || r.decision === 'removed' ? ` ${r.reason}` : ''}${why}`);
}
console.log(apply
  ? (summary.backupPath ? `\nWritten to ${PORTALS_PATH}. Backup: ${summary.backupPath}` : '\nNothing written.')
  : '\nPreview only. Re-run with --apply to write these changes.');
