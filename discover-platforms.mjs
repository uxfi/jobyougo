#!/usr/bin/env node
/**
 * discover-platforms.mjs — candidate NEW platforms (ATS vendors, job boards,
 * aggregator APIs) from the job URLs the scanner already met.
 *
 * The ATS explorer and board resolver add COMPANIES on vendors the scanner can
 * already read. This is the other direction: hostnames that keep appearing in
 * scanned offers (through aggregators, web search, manual rows) while no
 * provider claims them, no portals.yml source names them and no exclusion
 * covers them. Grouped by registrable domain and ranked by how many distinct
 * employers each serves, they are the shortlist of hosts worth a provider.
 *
 * Reads (user layer, read-only): data/scan-decisions.jsonl, data/scan-history.tsv,
 * data/pipeline.jsonl, data/gate-drops.jsonl, portals.yml. Loads providers/ for
 * detect() only. Zero network, zero LLM tokens, WRITES NOTHING unless --out.
 *
 * Usage:
 *   node discover-platforms.mjs                    # top 40 candidates, human table
 *   node discover-platforms.mjs --since 30         # only URLs recorded in the last 30 days
 *   node discover-platforms.mjs --min-companies 3  # a platform must serve ≥3 employers (default 2)
 *   node discover-platforms.mjs --include-single   # also list single-employer unknown hosts
 *   node discover-platforms.mjs --all              # append the claimed domains with their kind
 *   node discover-platforms.mjs --json             # machine-readable envelope
 *   node discover-platforms.mjs --out candidates.json   # also save the JSON envelope
 *   node discover-platforms.mjs --data-dir <dir> --portals <file>   # scratch copies (tests)
 *
 * Hand-off: pick a domain, open a sample URL, check whether the site exposes a
 * public JSON/RSS/XML feed, then follow providers/ADDING_A_PROVIDER.md and the
 * listing policy in docs/SOURCE_INDEXING_LOG.md. Nothing here decides for you.
 */

import { createReadStream, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as yamlLoad } from 'js-yaml';
import { loadProviders } from './providers/_registry.mjs';
import { getJobYouGoRoot } from './path-resolver.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import {
  UNKNOWN_HOSTS_DEFAULTS, buildHostClassifier, collectHosts, providerDomainsFromSources, rankCandidates, renderTable,
} from './lib/unknown-hosts.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROVIDERS_DIR = join(HERE, 'providers');

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d = null) => {
  const i = args.indexOf(f);
  if (i === -1) return d;
  const v = args[i + 1];
  if (v === undefined || v.startsWith('--')) { console.error(`ERROR: ${f} requires a value`); process.exit(1); }
  return v;
};
const num = (f, d) => { const v = val(f); if (v === null) return d; const n = Number(v); if (!Number.isFinite(n)) { console.error(`ERROR: ${f} must be a number`); process.exit(1); } return n; };

if (isMainModule(import.meta.url) && (has('--help') || has('-h'))) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 32).map(l => l.replace(/^ \*\/?\s?/, '')).join('\n'));
  process.exit(0);
}

/** Stream a .jsonl file into {url, company, source, ts} records; a bad line is skipped. */
export async function readJsonlRecords(file, pick, { sinceMs = 0 } = {}) {
  const out = [];
  if (!existsSync(file)) return out;
  const rl = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line || line[0] !== '{') continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    const r = pick(o);
    if (!r?.url) continue;
    if (sinceMs && r.ts && Date.parse(r.ts) < sinceMs) continue;
    out.push(r);
  }
  return out;
}

/** scan-history.tsv: url, first_seen, portal, title, company, status. */
export function readScanHistory(file, { sinceMs = 0 } = {}) {
  const out = [];
  if (!existsSync(file)) return out;
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  const header = (lines[0] || '').split('\t');
  const col = (name) => header.indexOf(name);
  const iUrl = col('url'), iDate = col('first_seen'), iPortal = col('portal'), iCompany = col('company');
  if (iUrl < 0) return out;
  for (const line of lines.slice(1)) {
    if (!line) continue;
    const cells = line.split('\t');
    const ts = iDate >= 0 ? cells[iDate] : '';
    if (sinceMs && ts && Date.parse(ts) < sinceMs) continue;
    out.push({ url: cells[iUrl], company: iCompany >= 0 ? cells[iCompany] : '', source: iPortal >= 0 ? cells[iPortal] : 'scan-history', ts });
  }
  return out;
}

export async function loadRecords(dataDir, { sinceDays = 0 } = {}) {
  // Negative days move the cutoff into the future (keeps nothing) — used by tests.
  const sinceMs = Number.isFinite(sinceDays) && sinceDays !== 0 ? Date.now() - sinceDays * 86400_000 : 0;
  const [decisions, pipeline, gate] = await Promise.all([
    readJsonlRecords(join(dataDir, 'scan-decisions.jsonl'), o => ({ url: o.url, company: o.company, source: o.source || 'scan-decisions', ts: o.ts }), { sinceMs }),
    readJsonlRecords(join(dataDir, 'pipeline.jsonl'), o => ({ url: o.url, company: o.company, source: 'pipeline', ts: o.scanned_at || o.ts }), { sinceMs }),
    readJsonlRecords(join(dataDir, 'gate-drops.jsonl'), o => ({ url: o.url, company: o.company, source: `gate:${o.gate || ''}`, ts: o.at }), { sinceMs }),
  ]);
  const history = readScanHistory(join(dataDir, 'scan-history.tsv'), { sinceMs });
  return {
    records: [...decisions, ...history, ...pipeline, ...gate],
    counts: { 'scan-decisions.jsonl': decisions.length, 'scan-history.tsv': history.length, 'pipeline.jsonl': pipeline.length, 'gate-drops.jsonl': gate.length },
  };
}

export async function discoverPlatforms({ dataDir, portalsPath, providers, sinceDays = 0, providerDomains, ...rankOpts } = {}) {
  const portalsConfig = existsSync(portalsPath) ? (yamlLoad(readFileSync(portalsPath, 'utf8')) || {}) : {};
  // With providers loaded, the hosts their source files fetch from count as read too.
  const domains = providerDomains || (providers?.size ? providerDomainsFromSources(PROVIDERS_DIR) : new Map());
  const classify = buildHostClassifier({ providers: providers || new Map(), portalsConfig, providerDomains: domains });
  const { records, counts } = await loadRecords(dataDir, { sinceDays });
  const byDomain = collectHosts(records, { classify });
  const ranked = rankCandidates(byDomain, rankOpts);
  return { ...ranked, inputs: counts, records: records.length, since_days: sinceDays || null, data_dir: dataDir, portals: portalsPath };
}

async function main() {
  const root = getJobYouGoRoot();
  const dataDir = resolve(val('--data-dir', join(root, 'data')));
  const portalsPath = resolve(val('--portals', process.env.JOBYOUGO_PORTALS || join(root, 'portals.yml')));
  const providers = has('--no-providers') ? new Map() : await loadProviders(PROVIDERS_DIR);

  const result = await discoverPlatforms({
    dataDir, portalsPath, providers,
    sinceDays: num('--since', 0),
    min_companies: num('--min-companies', UNKNOWN_HOSTS_DEFAULTS.min_companies),
    min_hosts: num('--min-hosts', UNKNOWN_HOSTS_DEFAULTS.min_hosts),
    min_urls: num('--min-urls', UNKNOWN_HOSTS_DEFAULTS.min_urls),
    limit: num('--limit', UNKNOWN_HOSTS_DEFAULTS.limit),
    include_single: has('--include-single'),
    all: has('--all'),
  });
  result.providers_loaded = providers.size;
  result.written = null;

  if (val('--out')) {
    const out = resolve(val('--out'));
    writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
    result.written = out;
  }

  if (has('--json')) { console.log(JSON.stringify(result, null, 2)); return; }

  const inputs = Object.entries(result.inputs).map(([k, v]) => `${k} ${v}`).join(', ');
  console.log(`Unknown-host collector — ${result.records} URL records (${inputs})${result.since_days ? `, last ${result.since_days} days` : ''}`);
  console.log(`${result.domains} domains · ${Object.entries(result.summary).map(([k, v]) => `${k} ${v}`).join(' · ')} · providers loaded: ${result.providers_loaded}`);
  console.log(`\nCandidate platforms (unknown hosts, ${result.candidates.length} of ${result.total_candidates}):\n`);
  console.log(renderTable(result.candidates));
  if (result.claimed.length) {
    console.log(`\nClaimed domains (already known), ${result.claimed.length}:\n`);
    console.log(renderTable(result.claimed, { kind: true }));
  }
  console.log(`\nPreview only — nothing written${result.written ? ` except ${result.written}` : ''}. Next: open a sample URL, look for a public JSON/RSS feed, then providers/ADDING_A_PROVIDER.md.`);
}

if (isMainModule(import.meta.url)) {
  main().catch(err => { console.error(`discover-platforms failed: ${err.message}`); process.exit(1); });
}
