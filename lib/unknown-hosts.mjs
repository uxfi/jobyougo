// Unknown-host collector: the platform-level counterpart of the ATS explorer.
//
// The explorer (lib/ats-explorer.mjs) finds new COMPANIES on ATS vendors the
// scanner already supports. Nothing watched the other direction: a job URL whose
// host no provider claims, no portals.yml entry names and no exclusion covers.
// Those hosts are where a new ATS vendor, job board or aggregator API shows up
// first, because the scanner keeps meeting them through aggregators, web search
// and manual rows without ever being able to read them directly.
//
// This module reads URLs the scanner already recorded (scan-decisions.jsonl,
// scan-history.tsv, pipeline.jsonl, gate-drops.jsonl), groups them by
// registrable domain, drops everything the project already knows, and ranks
// what is left by how many distinct employers it serves. Zero network, zero
// tokens, writes nothing: the CLI (discover-platforms.mjs) prints a preview and
// a human decides which host deserves a provider.
//
// A domain is "claimed" when any of these holds:
//   provider    a providers/*.mjs detect() accepts a sample URL (already readable)
//   ats         the host matches lib/ats-autodetect.mjs ATS_HOSTS or an explorer
//               URL pattern (ATS vendors the scanner already reads)
//   configured  a portals.yml source (job_boards, api_aggregators, rss_feeds,
//               eu_job_boards, freelance_portals) points at that domain
//   tracked     a tracked_companies careers_url lives on that domain
//               (an employer's own site, not a platform)
//   excluded    portals.yml excluded_domains names it (the paid-platform ban)
//   non_employer lib/non-employer-hosts.mjs lists it (a board, ATS, social
//               network or directory the project already decided about)
// Everything else is `unknown` and becomes a candidate.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveProvider } from '../providers/_registry.mjs';
import { ATS_HOSTS } from './ats-autodetect.mjs';
import { extractAtsSlugs } from './ats-explorer.mjs';
import { NON_EMPLOYER_HOST_RE, companyNameWords } from './non-employer-hosts.mjs';

export const UNKNOWN_HOSTS_DEFAULTS = Object.freeze({
  min_companies: 2,   // a platform serves at least two employers
  min_hosts: 2,       // or at least two tenant subdomains (acme.vendor.com, beta.vendor.com)
  min_urls: 2,        // and was met more than once
  sample_urls: 3,     // sample URLs kept per domain (also the ones detect() is asked about)
  limit: 40,
});

export const HOST_KINDS = Object.freeze([
  'provider', 'ats', 'configured', 'tracked', 'excluded', 'non_employer', 'unknown',
]);

// Second-level labels under which the registrable domain is three labels long
// (acme.co.uk, acme.com.sg). Small on purpose: the scanner's URLs are job pages,
// and a wrong split only merges or separates two rows in a preview table.
const PUBLIC_SECOND_LEVELS = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'ltd.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'com.sg', 'gov.sg', 'edu.sg', 'com.my', 'com.hk', 'com.tw', 'com.vn', 'co.id', 'co.th', 'co.in', 'co.jp', 'co.kr', 'co.nz', 'co.za',
  'com.br', 'com.mx', 'com.ar', 'com.co', 'com.pe', 'com.tr', 'com.ph', 'com.pl', 'com.ua', 'com.cn', 'com.ng', 'com.eg',
  'co.il', 'co.ke', 'org.br', 'gov.br', 'com.pk', 'com.bd', 'co.ao',
]);

/** Lowercase hostname of an http(s) URL, '' for anything else (mailto:, javascript:, IPs, localhost). */
export function hostOf(url) {
  if (typeof url !== 'string' || !url) return '';
  let u;
  try { u = new URL(url.trim()); } catch { return ''; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host.includes('.')) return '';
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.startsWith('[')) return '';
  return host;
}

/** acme.jobs.vendor.com → vendor.com; acme.co.uk → acme.co.uk. */
export function registrableDomain(host) {
  const h = String(host || '').toLowerCase();
  const labels = h.split('.').filter(Boolean);
  if (labels.length <= 2) return h;
  const lastTwo = labels.slice(-2).join('.');
  const n = PUBLIC_SECOND_LEVELS.has(lastTwo) ? 3 : 2;
  return labels.slice(-n).join('.');
}

const normCompany = (name) => companyNameWords(name).join(' ');

/** Hostname → first path segment, '' at the root. */
function firstSegment(url) {
  try {
    const seg = new URL(url).pathname.split('/').filter(Boolean)[0] || '';
    return seg.length > 40 ? '' : seg.toLowerCase();
  } catch { return ''; }
}

const hostMatchesDomain = (host, domain) => host === domain || host.endsWith(`.${domain}`);

function sourceHostsOf(portalsConfig = {}) {
  const hosts = new Set();
  const lists = ['job_boards', 'api_aggregators', 'rss_feeds', 'eu_job_boards', 'freelance_portals'];
  for (const list of lists) {
    for (const e of portalsConfig[list] || []) {
      if (!e || typeof e !== 'object') continue;
      for (const k of ['url', 'careers_url', 'api', 'feed', 'feed_url', 'rss', 'base_url', 'host']) {
        const v = e[k];
        if (typeof v !== 'string') continue;
        const host = hostOf(/^https?:/i.test(v) ? v : `https://${v}`);
        if (host) hosts.add(registrableDomain(host));
      }
    }
  }
  return hosts;
}

function trackedHostsOf(portalsConfig = {}) {
  const hosts = new Set();
  for (const e of portalsConfig.tracked_companies || []) {
    if (!e || typeof e !== 'object') continue;
    for (const k of ['careers_url', 'api', 'url']) {
      const host = hostOf(e[k]);
      if (host) hosts.add(host);
    }
  }
  return hosts;
}

function excludedDomainsOf(portalsConfig = {}) {
  return new Set((portalsConfig.excluded_domains || [])
    .map(d => String(d || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, ''))
    .filter(Boolean));
}

const EXPLORER_ATS_RE = /(?:^|\.)(?:ashbyhq\.com|greenhouse\.io|lever\.co|workable\.com|smartrecruiters\.com|recruitee\.com|personio\.(?:de|com)|teamtailor\.com|traffit\.com|dvinci-hr\.com|hirehive\.com|myworkdayjobs\.com|comeet\.(?:com|co))$/i;

// An employer's own careers site that posts through Greenhouse tags its job links
// with gh_jid: a single employer, not a platform. The explorer resolves its board
// (lib/ats-explorer.mjs resolveEmbeddedGreenhouse).
const EMBEDDED_ATS_LINK_RE = /[?&]gh_jid=\d/i;

/**
 * Build a host classifier from what the project already knows.
 * `providers` is the id→provider Map from providers/_registry.mjs loadProviders()
 * (or any Map whose values have detect()); pass an empty Map to skip that check.
 */
// Hosts a provider file names without reading jobs from them (docs links, public APIs it only calls).
const PROVIDER_DOMAIN_IGNORE = new Set(['youtube.com', 'google.com', 'github.com', 'w3.org', 'schema.org', 'algolia.com', 'example.com', 'cloudflare.com', 'mozilla.org']);

/**
 * Domains the providers/*.mjs files read, by provider id. detect() only accepts
 * the URL shape a portals.yml entry carries, so a job-board provider (vdab,
 * arbeitsagentur, themuse, agentic-jobs) rejects the offer URLs the scan meets
 * and the host looked unknown. The provider's own source names the host it
 * fetches from: every https URL on a code line (comment lines skipped) counts.
 */
export function providerDomainsFromSources(dir) {
  const out = new Map();
  if (!dir || !existsSync(dir)) return out;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.mjs') && !f.startsWith('_')).sort()) {
    let src;
    try { src = readFileSync(join(dir, file), 'utf8'); } catch { continue; }
    const id = (src.match(/\bid:\s*['"]([^'"]+)['"]/) || [])[1] || file.replace(/\.mjs$/, '');
    const code = src.split('\n').filter((line) => !/^\s*(?:\/\/|\*|\/\*)/.test(line)).join('\n');
    for (const m of code.matchAll(/https?:\/\/([a-z0-9][a-z0-9.-]*\.[a-z]{2,})/gi)) {
      const domain = registrableDomain(m[1]);
      if (!PROVIDER_DOMAIN_IGNORE.has(domain) && !out.has(domain)) out.set(domain, id);
    }
  }
  return out;
}

export function buildHostClassifier({ providers = new Map(), portalsConfig = {}, providerDomains = new Map() } = {}) {
  const sourceDomains = sourceHostsOf(portalsConfig);
  const trackedHosts = trackedHostsOf(portalsConfig);
  const excluded = excludedDomainsOf(portalsConfig);
  const cache = new Map();

  function classify(host, sampleUrls = []) {
    const key = host;
    if (cache.has(key)) return cache.get(key);
    const domain = registrableDomain(host);
    let result;
    if ([...excluded].some(d => hostMatchesDomain(host, d))) result = { kind: 'excluded', detail: 'portals.yml excluded_domains' };
    else if (Object.entries(ATS_HOSTS).some(([, re]) => re.test(host)) || EXPLORER_ATS_RE.test(host)
      || sampleUrls.some(u => extractAtsSlugs(u).length)) result = { kind: 'ats', detail: 'ATS the scanner already reads' };
    else if (sampleUrls.some(u => EMBEDDED_ATS_LINK_RE.test(u))) result = { kind: 'ats', detail: 'employer site embedding Greenhouse (gh_jid)' };
    else if (trackedHosts.has(host) || trackedHosts.has(`www.${host}`) || trackedHosts.has(host.replace(/^www\./, ''))) result = { kind: 'tracked', detail: 'tracked company careers_url' };
    else if (sourceDomains.has(domain)) result = { kind: 'configured', detail: 'portals.yml source' };
    else if (providerDomains.has(domain)) result = { kind: 'provider', detail: providerDomains.get(domain) };
    else {
      let providerId = '';
      for (const url of sampleUrls) {
        const hit = resolveProvider({ name: host, careers_url: url }, providers, { skipIds: ['local-parser'] });
        if (hit?.provider) { providerId = hit.provider.id; break; }
      }
      if (providerId) result = { kind: 'provider', detail: providerId };
      else if (NON_EMPLOYER_HOST_RE.test(host)) result = { kind: 'non_employer', detail: 'lib/non-employer-hosts.mjs' };
      else result = { kind: 'unknown', detail: '' };
    }
    cache.set(key, result);
    return result;
  }
  return classify;
}

/**
 * Fold scanned records ({url, company?, source?, ts?}) into per-domain stats.
 * Returns Map<domain, stat>; the classifier runs once per hostname.
 */
export function collectHosts(records, { classify, sampleUrls = UNKNOWN_HOSTS_DEFAULTS.sample_urls } = {}) {
  const byHost = new Map();
  for (const r of records || []) {
    const host = hostOf(r?.url);
    if (!host) continue;
    let h = byHost.get(host);
    if (!h) { h = { host, urls: new Set(), companies: new Set(), sources: new Set(), segments: new Map(), samples: [], first: '', last: '' }; byHost.set(host, h); }
    const url = r.url.trim();
    h.urls.add(url);
    if (h.samples.length < sampleUrls && !h.samples.includes(url)) h.samples.push(url);
    const company = normCompany(r.company);
    if (company) h.companies.add(company);
    if (r.source) h.sources.add(String(r.source));
    const seg = firstSegment(url);
    h.segments.set(seg, (h.segments.get(seg) || 0) + 1);
    const ts = typeof r.ts === 'string' ? r.ts.slice(0, 10) : '';
    if (ts) {
      if (!h.first || ts < h.first) h.first = ts;
      if (!h.last || ts > h.last) h.last = ts;
    }
  }

  const byDomain = new Map();
  for (const h of byHost.values()) {
    const domain = registrableDomain(h.host);
    const cls = classify ? classify(h.host, h.samples) : { kind: 'unknown', detail: '' };
    let d = byDomain.get(domain);
    if (!d) {
      d = { domain, hosts: new Set(), urls: 0, companies: new Set(), sources: new Set(), segments: new Map(), samples: [], first: '', last: '', kinds: new Map() };
      byDomain.set(domain, d);
    }
    d.hosts.add(h.host);
    d.urls += h.urls.size;
    for (const c of h.companies) d.companies.add(c);
    for (const s of h.sources) d.sources.add(s);
    for (const [seg, n] of h.segments) d.segments.set(seg, (d.segments.get(seg) || 0) + n);
    for (const u of h.samples) if (d.samples.length < sampleUrls) d.samples.push(u);
    if (h.first && (!d.first || h.first < d.first)) d.first = h.first;
    if (h.last && (!d.last || h.last > d.last)) d.last = h.last;
    const k = `${cls.kind}|${cls.detail}`;
    d.kinds.set(k, (d.kinds.get(k) || 0) + h.urls.size);
  }
  return byDomain;
}

// A domain counts as claimed when any of its hosts is: one provider hit on
// jobs.vendor.com makes vendor.com a known platform, whatever careers.vendor.com does.
const KIND_PRIORITY = ['provider', 'ats', 'configured', 'excluded', 'non_employer', 'tracked', 'unknown'];

function dominantKind(kinds) {
  let best = null;
  for (const key of kinds.keys()) {
    const [kind, detail] = key.split('|');
    const rank = KIND_PRIORITY.indexOf(kind);
    if (!best || rank < best.rank) best = { kind, detail, rank };
  }
  return best || { kind: 'unknown', detail: '' };
}

/** Guess what shape of platform a domain is, from its tenants and employers. */
export function guessShape({ hosts, companies, segments }) {
  const tenantLabels = new Set();
  for (const h of hosts) {
    const labels = h.split('.');
    const reg = registrableDomain(h).split('.').length;
    const sub = labels.slice(0, labels.length - reg).filter(l => l !== 'www');
    if (sub.length) tenantLabels.add(sub.join('.'));
  }
  const topSeg = [...segments.entries()].filter(([s]) => s).sort((a, b) => b[1] - a[1])[0];
  const segShare = topSeg ? topSeg[1] / [...segments.values()].reduce((a, b) => a + b, 0) : 0;
  if (tenantLabels.size >= 3 && tenantLabels.size >= companies.size * 0.5) return { shape: 'multi-tenant ATS', hint: `${tenantLabels.size} tenant subdomains` };
  if (companies.size >= 3 && topSeg && segShare >= 0.6) return { shape: 'job board', hint: `/${topSeg[0]}/… on ${Math.round(segShare * 100)}% of URLs` };
  if (companies.size >= 3) return { shape: 'job board', hint: `${companies.size} employers` };
  if (tenantLabels.size >= 2) return { shape: 'possible ATS', hint: `${tenantLabels.size} tenant subdomains` };
  return { shape: 'single employer', hint: '' };
}

/**
 * Turn the per-domain stats into ranked candidate rows. Unknown domains that
 * clear the thresholds come first, by distinct employers, tenant hosts, URLs.
 * With `all: true` the claimed domains are returned too (kind set), after the
 * candidates, so a reader can see what was filtered and why.
 */
export function rankCandidates(byDomain, opts = {}) {
  const o = { ...UNKNOWN_HOSTS_DEFAULTS, ...opts };
  const rows = [];
  for (const d of byDomain.values()) {
    const { kind, detail } = dominantKind(d.kinds);
    const { shape, hint } = guessShape(d);
    const row = {
      domain: d.domain, kind, detail, shape, hint,
      hosts: d.hosts.size, companies: d.companies.size, urls: d.urls,
      sources: [...d.sources].slice(0, 4), samples: d.samples, first_seen: d.first, last_seen: d.last,
      tenants: [...d.hosts].slice(0, 5),
    };
    const clears = d.urls >= o.min_urls && (d.companies.size >= o.min_companies || d.hosts.size >= o.min_hosts);
    row.candidate = kind === 'unknown' && (clears || o.include_single === true);
    rows.push(row);
  }
  const score = (r) => (r.companies * 3 + r.hosts * 2 + Math.log2(r.urls + 1));
  rows.sort((a, b) => Number(b.candidate) - Number(a.candidate) || score(b) - score(a) || a.domain.localeCompare(b.domain));
  const candidates = rows.filter(r => r.candidate);
  const claimed = rows.filter(r => !r.candidate);
  const summary = {};
  for (const r of rows) summary[r.kind] = (summary[r.kind] || 0) + 1;
  return {
    candidates: Number.isFinite(o.limit) && o.limit > 0 ? candidates.slice(0, o.limit) : candidates,
    total_candidates: candidates.length,
    claimed: o.all ? claimed : [],
    summary,
    domains: rows.length,
  };
}

const pad = (s, n) => String(s ?? '').padEnd(n).slice(0, n);

/** Human table for the CLI. */
export function renderTable(rows, { kind = false } = {}) {
  if (!rows.length) return '(none)';
  const head = `${pad('domain', 34)} ${pad(kind ? 'kind' : 'shape', 18)} ${pad('emp', 4)} ${pad('hosts', 5)} ${pad('urls', 5)} ${pad('seen', 23)} sample`;
  const lines = [head, '-'.repeat(head.length + 20)];
  for (const r of rows) {
    const seen = r.first_seen ? `${r.first_seen}→${r.last_seen}` : '';
    const label = kind ? `${r.kind}${r.detail ? `:${r.detail}` : ''}` : r.shape;
    lines.push(`${pad(r.domain, 34)} ${pad(label, 18)} ${pad(r.companies, 4)} ${pad(r.hosts, 5)} ${pad(r.urls, 5)} ${pad(seen, 23)} ${r.samples[0] || ''}`);
    if (!kind && r.hint) lines.push(`${' '.repeat(35)}${r.hint}${r.sources.length ? ` · via ${r.sources.slice(0, 2).join(', ')}` : ''}`);
  }
  return lines.join('\n');
}
