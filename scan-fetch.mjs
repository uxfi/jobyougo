#!/usr/bin/env node
/**
 * scan-fetch.mjs — Deterministic portal scanner (modes/scan.md Levels 2, 4, 5)
 *
 * Replaces the LLM-driven WebFetch loop for the *deterministic* discovery levels:
 *   L2  Greenhouse boards-api  (tracked_companies[].api)
 *   L4  RSS / Atom feeds        (rss_feeds[])
 *   L5  Aggregator APIs         (api_aggregators[]: remotive, jobicy, himalayas,
 *                                arbeitnow, searchapi/serpapi, theirstack)
 *
 * For each enabled, off-cooldown source it fetches listings, applies the remote
 * filter then the title filter (lib/scan-filters.mjs — same rules as scan.md
 * §9/§10), deduplicates against scan-history.tsv / pipeline.md / applications.md /
 * deleted-applications.tsv, and appends new offers to pipeline.md + scan-history.tsv
 * with TSV-safe fields (the corruption that hit scan-history can't recur here).
 *
 * Levels 1 (Playwright SPA scraping) and 3 (WebSearch discovery of NEW companies
 * + freelance `missions`) stay LLM-driven — they need a browser / the open web.
 *
 * Usage:
 *   node scan-fetch.mjs [jobs|missions] [--dry-run] [--source="NAME"] [--max=N]
 *     jobs (default)   run L2/L4/L5
 *     missions         nothing to do here (freelance = WebSearch, LLM-only) → exits
 *     --dry-run        fetch + filter + print, write NOTHING
 *     --source="NAME"  only the source whose `name` matches (case-insensitive)
 *     --max=N          cap NEW offers added to the pipeline this run (default 50)
 *
 * Run from the career-ops root.
 */

import 'dotenv/config';
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import {
  loadPortals, passesTitle, passesRemote,
  tsvSafe, normalizeCompany, roleMatch,
} from './lib/scan-filters.mjs';

const ROOT = new URL('.', import.meta.url).pathname;
const P = {
  portals: join(ROOT, 'portals.yml'),
  pipeline: join(ROOT, 'data/pipeline.md'),
  history: join(ROOT, 'data/scan-history.tsv'),
  apps: join(ROOT, 'data/applications.md'),
  deleted: join(ROOT, 'data/deleted-applications.tsv'),
  state: join(ROOT, 'data/scan-state.json'),
};

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const COOLDOWN_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT = 20000;
const CONCURRENCY = 5;

// ─── CLI args ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const DEBUG = argv.includes('--debug');
const mode = argv.find(a => a === 'jobs' || a === 'missions') || 'jobs';
const sourceArg = (argv.find(a => a.startsWith('--source=')) || '').split('=').slice(1).join('=').replace(/^["']|["']$/g, '').toLowerCase() || null;
const maxArg = parseInt((argv.find(a => a.startsWith('--max=')) || '').split('=')[1], 10);
const MAX_NEW = Number.isFinite(maxArg) ? maxArg : 300;
const maxAgeArg = parseInt((argv.find(a => a.startsWith('--max-age=')) || '').split('=')[1], 10);

const today = new Date().toISOString().slice(0, 10);
const nowMs = Date.now();
const skips = [];       // sources skipped (cooldown / missing creds / unsupported)
const errors = [];      // sources that errored

if (mode === 'missions') {
  console.log('ℹ️  `missions` mode = freelance portals via WebSearch (Level 3), which stays LLM-driven.');
  console.log('   scan-fetch.mjs only handles the deterministic levels (Greenhouse / RSS / Aggregator APIs).');
  console.log('   Run a `jobs` scan here, or use the LLM `scan` mode for missions.');
  process.exit(0);
}

const portals = loadPortals(P.portals);

// ─── HTTP ────────────────────────────────────────────────────────────────────
async function httpFetch(url, { text = false, method = 'GET', headers = {}, body = null } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, {
      method, body, signal: ctrl.signal,
      headers: { 'User-Agent': UA, 'Accept': text ? 'application/rss+xml, application/xml, text/xml, */*' : 'application/json', ...headers },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return text ? res.text() : res.json();
  } finally {
    clearTimeout(t);
  }
}

async function mapPool(items, n, fn) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

// ─── Parsers (defensive: tolerate missing fields) ────────────────────────────
function stripCdata(s) { return String(s).replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, ''); }
function unescapeXml(s) {
  return String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&#x?\d+;/g, ' ');
}
function stripHtml(s) { return String(s).replace(/<[^>]+>/g, ' '); }
// Coerce a date field (ISO string, RFC822, epoch sec or ms) to epoch ms, or null.
function toMs(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  const s = String(v).trim();
  if (/^\d+$/.test(s)) { const n = Number(s); return n < 1e12 ? n * 1000 : n; }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}
function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return m ? stripCdata(m[1]).trim() : '';
}

function parseGreenhouse(json, company) {
  return (json.jobs || []).map(j => ({
    title: j.title || '',
    url: j.absolute_url || '',
    company,
    location: (j.location && j.location.name) || '',
    postedAt: toMs(j.updated_at || j.first_published),
  }));
}

function parseAshby(json, company) {
  return (json.jobs || []).map(x => {
    const sec = (x.secondaryLocations || []).map(s => (typeof s === 'string' ? s : (s.location || ''))).join(' ');
    const country = (x.address && x.address.postalAddress && x.address.postalAddress.addressCountry) || '';
    return {
      title: x.title || '',
      url: x.jobUrl || x.applyUrl || '',
      company,
      location: `${x.isRemote ? 'remote ' : ''}${x.workplaceType || ''} ${x.location || ''} ${sec} ${country}`,
      postedAt: toMs(x.publishedAt),
    };
  });
}

function parseLever(arr, company) {
  return (Array.isArray(arr) ? arr : []).map(x => {
    const cat = x.categories || {};
    const locs = [cat.location, ...(cat.allLocations || [])].filter(Boolean).join(' ');
    return {
      title: x.text || '',
      url: x.hostedUrl || x.applyUrl || '',
      company,
      location: `${x.workplaceType || ''} ${locs} ${x.country || ''}`,
      postedAt: toMs(x.createdAt),
    };
  });
}

// Pull a company out of a feed title when the feed has no author field.
// Safe connectors first ("Role at/@/| Company"); colon form ("Company: Role")
// only when the prefix is ≤2 words (matches WeWorkRemotely "EverAI: …" without
// misreading "Senior Product Manager: Checkout" as a company).
function splitTitleCompany(rawTitle, companyFromFeed) {
  const title0 = String(rawTitle).trim();
  if (companyFromFeed) return { title: title0, company: companyFromFeed };
  let m = title0.match(/^(.+?)\s+(?:at|@|\|)\s+(.+)$/i);
  if (m) return { title: m[1].trim(), company: m[2].trim() };
  m = title0.match(/^([^:]{1,40}):\s+(.+)$/);
  if (m && m[1].trim().split(/\s+/).length <= 2) return { title: m[2].trim(), company: m[1].trim() };
  return { title: title0, company: '' };
}

function parseFeed(xml) {
  const items = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || [];
  return items.map(it => {
    let url = tag(it, 'link');
    if (!url || !/^https?:\/\//.test(url)) {
      const m = it.match(/<link[^>]*href=["'](https?:\/\/[^"']+)["']/i);
      url = m ? m[1] : (tag(it, 'guid').match(/^https?:\/\//) ? tag(it, 'guid') : url);
    }
    const desc = stripHtml(unescapeXml(tag(it, 'description') || tag(it, 'summary') || tag(it, 'content')));
    const feedCompany = unescapeXml(tag(it, 'dc:creator') || tag(it, 'author'));
    const { title, company } = splitTitleCompany(unescapeXml(tag(it, 'title')), feedCompany);
    return { title, url, company, location: desc.slice(0, 600), postedAt: toMs(tag(it, 'pubDate') || tag(it, 'published') || tag(it, 'updated')) };
  });
}

function parseRemotive(j) {
  return (j.jobs || []).map(x => ({ title: x.title || '', url: x.url || '', company: x.company_name || '', location: x.candidate_required_location || '', postedAt: toMs(x.publication_date) }));
}
function parseJobicy(j) {
  return (j.jobs || []).map(x => ({ title: x.jobTitle || x.title || '', url: x.url || '', company: x.companyName || '', location: x.jobGeo || '', postedAt: toMs(x.pubDate) }));
}
function parseHimalayas(j) {
  return (j.jobs || []).map(x => {
    const geo = Array.isArray(x.locationRestrictions) ? x.locationRestrictions.join(', ') : (x.locationRestrictions || '');
    return { title: x.title || '', url: x.applicationLink || x.guid || x.url || '', company: x.companyName || x.company || '', location: geo, postedAt: toMs(x.pubDate) };
  });
}
function parseArbeitnow(j) {
  return (j.data || []).map(x => ({
    title: x.title || '', url: x.url || '', company: x.company_name || '',
    location: `${x.remote ? 'remote ' : ''}${x.location || ''} ${(x.tags || []).join(' ')}`,
    postedAt: toMs(x.created_at),
  }));
}
function parseGoogleJobs(j) {
  return (j.jobs || j.jobs_results || []).map(x => ({
    title: x.title || '',
    url: x.apply_link || (x.apply_options && x.apply_options[0] && x.apply_options[0].link) || x.link || x.share_link || '',
    company: x.company_name || '',
    location: `${x.location || ''} ${(x.detected_extensions && x.detected_extensions.work_from_home) ? 'remote' : ''}`,
    postedAt: toMs(x.detected_extensions && x.detected_extensions.posted_at),
  }));
}
function parseTheirstack(j) {
  return (j.data || j.jobs || []).map(x => ({
    title: x.job_title || x.title || '', url: x.url || x.final_url || '',
    company: (x.company_object && x.company_object.name) || x.company || x.company_name || '',
    location: `${x.remote ? 'remote ' : ''}${x.location || x.short_location || x.long_location || ''}`,
    postedAt: toMs(x.date_posted),
  }));
}

const DEFAULT_QUERY = '("AI Product Manager" OR "Head of AI" OR "Solutions Architect" OR "Forward Deployed" OR "Product Designer" OR Agentic OR LLM OR Automation) (remote OR "fully remote") (Europe OR EMEA OR EU OR Asia OR APAC OR Singapore)';

function aggregatorFetcher(a) {
  const url = a.api_url;
  switch (a.provider) {
    case 'remotive':  return async () => parseRemotive(await httpFetch('https://remotive.com/api/remote-jobs'));
    case 'jobicy':    return async () => parseJobicy(await httpFetch('https://jobicy.com/api/v2/remote-jobs?count=100'));
    case 'himalayas': return async () => {
      // API caps each page at 20 (limit param ignored) but supports offset — paginate recent-first.
      const out = [];
      for (let off = 0; off < 320; off += 20) {
        const page = parseHimalayas(await httpFetch(`https://himalayas.app/jobs/api?limit=20&offset=${off}`));
        out.push(...page);
        if (page.length < 20) break;
      }
      return out;
    };
    case 'arbeitnow': return async () => {
      const out = [];
      let next = url || 'https://www.arbeitnow.com/api/job-board-api';
      for (let p = 0; p < 5 && next; p++) {
        const j = await httpFetch(next);
        out.push(...parseArbeitnow(j));
        next = j.links && j.links.next;
      }
      return out;
    };
    case 'searchapi':
    case 'serpapi': {
      const key = process.env.SEARCHAPI_KEY || process.env.SERPAPI_KEY;
      if (!key || !url) { skips.push(`${a.name}: missing SEARCHAPI_KEY/SERPAPI_KEY`); return null; }
      const sep = url.includes('?') ? '&' : '?';
      const full = `${url}${sep}q=${encodeURIComponent(a.query || DEFAULT_QUERY)}&api_key=${key}`;
      return async () => parseGoogleJobs(await httpFetch(full));
    }
    case 'theirstack': {
      const key = process.env.THEIRSTACK_API_KEY || process.env.THEIR_STACK_API_KEY;
      if (!key || !url) { skips.push(`${a.name}: missing THEIRSTACK_API_KEY`); return null; }
      // Paid API (consumes TheirStack credits). Targets remote EU/Asia AI/product roles.
      const bdy = JSON.stringify({
        page: 0, limit: 50, remote: true, posted_at_max_age_days: 30,
        job_title_or: ['AI Product', 'Product Manager', 'Product Designer', 'Head of AI', 'Solutions Architect', 'Solutions Engineer', 'Forward Deployed', 'Agentic', 'LLM', 'Automation', 'AI Designer'],
        job_country_code_or: ['GB', 'IE', 'DE', 'FR', 'ES', 'IT', 'NL', 'PT', 'PL', 'SE', 'DK', 'NO', 'FI', 'BE', 'AT', 'CH', 'SG', 'HK', 'JP', 'IN', 'IL', 'AE', 'TH'],
      });
      return async () => parseTheirstack(await httpFetch(url, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: bdy }));
    }
    default:
      skips.push(`${a.name}: provider '${a.provider}' not supported by scan-fetch (use LLM scan)`);
      return null;
  }
}

// Boards that are remote-only by construction: their location field carries the
// geo (e.g. "Worldwide", "Europe") but not the literal word "remote", so we treat
// the remote-wording requirement as satisfied and let the geo check discriminate.
const REMOTE_ONLY_PROVIDERS = new Set(['remotive', 'jobicy', 'himalayas']);

// ─── Build source list (jobs mode) ───────────────────────────────────────────
const allSources = [];
for (const c of (portals.tracked_companies || [])) {
  if (!c.enabled || !c.api) continue;
  // Company boards span 3 ATS platforms with different JSON shapes → dispatch by host.
  // Kept strict (remoteOnly: false): a company board lists on-site roles too, so we
  // require explicit remote wording (their APIs expose isRemote/workplaceType).
  let host = ''; try { host = new URL(c.api).host; } catch { /* ignore */ }
  let level, parse;
  if (host.includes('greenhouse.io')) { level = 'L2 greenhouse'; parse = parseGreenhouse; }
  else if (host.includes('ashbyhq.com')) { level = 'L2 ashby'; parse = parseAshby; }
  else if (host.includes('lever.co')) { level = 'L2 lever'; parse = parseLever; }
  else { skips.push(`${c.name}: api host '${host}' unsupported (need Greenhouse/Ashby/Lever)`); continue; }
  allSources.push({ name: c.name, level, remoteOnly: false, run: async () => parse(await httpFetch(c.api), c.name) });
}
for (const f of (portals.rss_feeds || [])) {
  // Every configured feed is a remote-jobs board.
  if (f.enabled && f.url) allSources.push({ name: f.name, level: 'L4 rss', remoteOnly: true, run: async () => parseFeed(await httpFetch(f.url, { text: true })) });
}
for (const a of (portals.api_aggregators || [])) {
  if (!a.enabled) continue;
  const fn = aggregatorFetcher(a);
  if (fn) allSources.push({ name: a.name, level: 'L5 aggregator', remoteOnly: REMOTE_ONLY_PROVIDERS.has(a.provider), run: fn });
}

// ─── Cooldown + --source filtering ────────────────────────────────────────────
let state = {};
try { if (existsSync(P.state)) state = JSON.parse(readFileSync(P.state, 'utf-8')); } catch { state = {}; }

let sources = allSources;
if (sourceArg) sources = sources.filter(s => s.name.toLowerCase() === sourceArg);

const eligible = [];
for (const s of sources) {
  if (!sourceArg) {
    const last = state[s.name] ? Date.parse(state[s.name]) : 0;
    if (last && (nowMs - last) < COOLDOWN_MS) {
      const h = Math.round((nowMs - last) / 3.6e6);
      skips.push(`${s.name} (cooldown, ${h}h ago)`);
      continue;
    }
  }
  eligible.push(s);
}

// (No early exit when 0 eligible — fall through so the normal summary prints,
//  even when stdout is redirected. The fetch loop over [] is a no-op.)

// ─── Dedup state ──────────────────────────────────────────────────────────────
const seenUrls = new Set();
if (existsSync(P.history)) {
  for (const line of readFileSync(P.history, 'utf-8').split('\n')) {
    const url = line.split('\t')[0];
    if (url && /^(https?:|local:|unknown:)/.test(url)) seenUrls.add(url);
  }
}
if (existsSync(P.pipeline)) {
  for (const line of readFileSync(P.pipeline, 'utf-8').split('\n')) {
    if (!line.trim().startsWith('- [')) continue;
    const m = line.match(/https?:\/\/[^\s|]+|local:[^\s|]+/);
    if (m) seenUrls.add(m[0]);
  }
}

const excluded = []; // {company, role} from applications.md + deleted-applications.tsv
if (existsSync(P.apps)) {
  const lines = readFileSync(P.apps, 'utf-8').split('\n').filter(l => l.startsWith('|'));
  const header = lines.find(l => /company/i.test(l) && /role/i.test(l));
  if (header) {
    const cols = header.split('|').map(c => c.trim().toLowerCase());
    const ci = cols.indexOf('company'); const ri = cols.indexOf('role');
    for (const l of lines) {
      if (l === header || /^\|[\s|:-]+\|?$/.test(l)) continue;
      const cells = l.split('|').map(c => c.trim());
      const company = cells[ci]; const role = cells[ri];
      if (company && role && !/^company$/i.test(company)) excluded.push({ company, role });
    }
  }
}
if (existsSync(P.deleted)) {
  const lines = readFileSync(P.deleted, 'utf-8').split('\n').slice(1);
  for (const l of lines) {
    const [company, role] = l.split('\t');
    if (company && role) excluded.push({ company, role });
  }
}
const excludedByCompany = new Map();
for (const e of excluded) {
  const k = normalizeCompany(e.company);
  if (!k) continue;
  if (!excludedByCompany.has(k)) excludedByCompany.set(k, []);
  excludedByCompany.get(k).push(e.role);
}
function isExcluded(company, role) {
  const roles = excludedByCompany.get(normalizeCompany(company));
  if (!roles) return false;
  return roles.some(r => roleMatch(r, role));
}

// ─── Fetch + filter ───────────────────────────────────────────────────────────
console.log(`Portal Scan (deterministic) — Mode: jobs — ${today}`);
console.log('━'.repeat(60));
console.log(`Eligible sources: ${eligible.length}${sourceArg ? ` (filtered to "${sourceArg}")` : ''}${DRY ? '  [DRY-RUN]' : ''}`);

// Freshness cutoff (modes/scan.md / portals.yml scan_max_age_days). 0 / --max-age=0 disables.
const maxAgeDays = Number.isFinite(maxAgeArg) ? maxAgeArg : (Number(portals.scan_max_age_days) || 0);
const cutoffMs = maxAgeDays > 0 ? (nowMs - maxAgeDays * 864e5) : null;
if (cutoffMs) console.log(`Freshness: keep jobs ≤ ${maxAgeDays}d old (jobs with no date are kept).`);

const stats = { fetched: 0, candidates: 0, skipped_age: 0, skipped_remote: 0, skipped_title: 0, dup: 0, invalid: 0 };
const newOffers = [];
const fetchedNames = [];

await mapPool(eligible, CONCURRENCY, async (s) => {
  let listings;
  try {
    listings = await s.run();
  } catch (e) {
    errors.push(`${s.name} [${s.level}]: ${e.message}`);
    return;
  }
  stats.fetched++;
  fetchedNames.push(s.name);
  stats.candidates += listings.length;
  const per = { listings: listings.length, invalid: 0, age: 0, remote: 0, title: 0, dup: 0, new: 0 };
  for (const cand of listings) {
    const url = (cand.url || '').trim();
    const title = (cand.title || '').trim();
    if (!url || !title || !/^https?:\/\//.test(url)) { stats.invalid++; per.invalid++; continue; }
    if (cutoffMs && cand.postedAt && cand.postedAt < cutoffMs) { stats.skipped_age++; per.age++; continue; }
    const remoteBlob = `${s.remoteOnly ? 'remote ' : ''}${cand.location || ''} ${title}`;
    // Worldwide remote-only boards: keep ambiguous-geo remotes (likely global).
    // Company boards: ambiguous ≈ US/regional office role → require explicit EU/Asia geo.
    const ambiguousPolicy = s.remoteOnly ? 'keep' : 'skip';
    if (!passesRemote(remoteBlob, portals.remote_filter, { ambiguousPolicy }).ok) { stats.skipped_remote++; per.remote++; continue; }
    if (!passesTitle(title, portals.title_filter).ok) { stats.skipped_title++; per.title++; continue; }
    if (seenUrls.has(url)) { stats.dup++; per.dup++; continue; }
    if (isExcluded(cand.company || '', title)) { stats.dup++; per.dup++; continue; }
    seenUrls.add(url); // guard against intra-run duplicates
    newOffers.push({ url, title, company: cand.company || '', source: s.name });
    per.new++;
  }
  if (DEBUG) console.log(`   · ${s.level.padEnd(14)} ${s.name.slice(0, 38).padEnd(38)} listings=${per.listings} invalid=${per.invalid} age=${per.age} rem=${per.remote} title=${per.title} dup=${per.dup} new=${per.new}`);
});

// ─── Cap ───────────────────────────────────────────────────────────────────────
let capped = 0;
let toAdd = newOffers;
if (newOffers.length > MAX_NEW) {
  capped = newOffers.length - MAX_NEW;
  toAdd = newOffers.slice(0, MAX_NEW);
}

// ─── Write ───────────────────────────────────────────────────────────────────
if (!DRY && toAdd.length) {
  // pipeline.md
  let header = '';
  if (!existsSync(P.pipeline) || readFileSync(P.pipeline, 'utf-8').trim() === '') {
    header = '# Pipeline — Pending\n\n';
  }
  const pipeLines = toAdd.map(o =>
    `- [ ] ${o.url} | ${tsvSafe(o.company).replace(/\|/g, '/')} | ${tsvSafe(o.title).replace(/\|/g, '/')}`
  ).join('\n') + '\n';
  appendFileSync(P.pipeline, header + pipeLines, 'utf-8');

  // scan-history.tsv (only `added` rows — re-filtering is free, so no skipped_* bloat)
  const histLines = toAdd.map(o =>
    `${o.url}\t${today}\t${tsvSafe(o.source)}\t${tsvSafe(o.title)}\t${tsvSafe(o.company)}\tadded`
  ).join('\n') + '\n';
  appendFileSync(P.history, histLines, 'utf-8');
}

// scan-state.json — mark every successfully fetched source (skip in dry-run)
if (!DRY && fetchedNames.length) {
  const nowIso = new Date().toISOString();
  for (const n of fetchedNames) state[n] = nowIso;
  writeFileSync(P.state, JSON.stringify(state, null, 2) + '\n', 'utf-8');
}

// Supabase sync (no-op if USE_SUPABASE !== 'true')
if (!DRY && toAdd.length) {
  const r = spawnSync('node', ['sync-supabase.mjs', 'pipeline'], { cwd: ROOT, encoding: 'utf-8' });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.status !== 0 && r.stderr) console.log(`⚠️  sync-supabase: ${r.stderr.trim().split('\n').pop()}`);
}

// ─── Summary ───────────────────────────────────────────────────────────────────
console.log(`\nSources fetched: ${stats.fetched}/${eligible.length}   Listings seen: ${stats.candidates}`);
console.log(`Filtered — stale: ${stats.skipped_age}  remote: ${stats.skipped_remote}  title: ${stats.skipped_title}  duplicate: ${stats.dup}  invalid: ${stats.invalid}`);
console.log(`New offers${DRY ? ' (would add)' : ' added'}: ${toAdd.length}${capped ? `  (capped: +${capped} more qualified, raise --max)` : ''}`);
for (const o of toAdd) console.log(`  + ${o.company || '?'} | ${o.title}  [${o.source}]`);
if (skips.length) console.log(`\n⏭  Skipped: ${skips.join('; ')}`);
if (errors.length) console.log(`\n⚠️  Errors (source skipped, will retry next run):\n   ${errors.join('\n   ')}`);
if (DRY) console.log('\n[DRY-RUN] No files written.');
