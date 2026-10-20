#!/usr/bin/env node
// Standalone ATS explorer run (same pipeline as the scan step).
//   node scripts/ats-explorer.mjs [--dry-run] [--passive-only] [--max-add N] [--max-queries N]
// Passive input: ATS job URLs already in data/ (pipeline, scan history, decisions).
// Active input: only through a sanctioned search API when a key is configured
// (BRAVE_API_KEY -> Brave Search API, SEARCHAPI_KEY -> SearchAPI.io). Without a key
// the browser engines live in the UI scan; this script then stays passive.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as yamlLoad } from 'js-yaml';
import { runAtsExplorer, makeApiSearch } from '../lib/ats-explorer.mjs';
import { isMainModule } from '../lib/is-main-module.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };

export function collectHistoryText(dataDir) {
  const out = [];
  if (!existsSync(dataDir)) return out;
  for (const f of readdirSync(dataDir)) {
    if (!/\.(jsonl|md|tsv)$/.test(f) || f === 'discovered-companies.jsonl') continue;
    try { out.push(readFileSync(join(dataDir, f), 'utf8')); } catch { /* unreadable */ }
  }
  return out;
}

async function main() {
  const portalsPath = join(ROOT, 'portals.yml');
  const config = yamlLoad(readFileSync(portalsPath, 'utf8')) || {};
  const env = { ...process.env };
  if (opt('--max-add')) env.ATS_EXPLORER_MAX_ADD = opt('--max-add');
  if (opt('--max-queries')) env.ATS_EXPLORER_MAX_QUERIES = opt('--max-queries');
  const search = flag('--passive-only') ? null : makeApiSearch(env);
  if (!search && !flag('--passive-only')) console.log('[scan] [explorer] no search API key (BRAVE_API_KEY / SEARCHAPI_KEY) - passive discovery only; active queries run inside the UI scan');
  const s = await runAtsExplorer({ portalsPath, dataDir: join(ROOT, 'data'), offerUrls: collectHistoryText(join(ROOT, 'data')), search, config, env, dryRun: flag('--dry-run') });
  if (s.backupPath) console.log(`backup: ${s.backupPath}`);
  if (flag('--dry-run')) for (const r of s.records || []) console.log(`${r.decision.padEnd(7)} ${r.ats}/${r.slug} - ${r.name} (${r.open_roles} roles, ${r.tech_roles} tech) ${r.reason}`);
}

if (isMainModule(import.meta.url)) {
  main().catch(err => { console.error(`[scan] [explorer] failed: ${err.message}`); process.exit(1); });
}
