// ATS board resolver: finds the public ATS board of tracked companies that have
// none, and repairs the ones whose board answers 404.
//
// Measured 2026-10-21: of 25 tracked companies that fell back to the (blocked)
// web-search engines, 7 had a public board under a guessable slug (OpenAI,
// Stripe, Grab, Twilio, Temporal, Webflow, LivePerson), and three boards were
// dead (Ada, Lindy, Clarity AI). Guessing the slug and asking the board's own
// public JSON API needs no search engine and no browser.
//
// A guessed slug is only a guess: `gong` on SmartRecruiters is a journalism
// internship, `lindy` on Recruitee is a German staffing firm. A board is only
// taken when its own data names the company (judgeBoard):
//  - the board reports a name (Greenhouse, Workable, SmartRecruiters, Recruitee,
//    Ashby page title, Teamtailor, Personio) and it equals the company name once
//    legal and generic words are dropped ("Gong.io" = "Gong", "Gong Media" is not), or
//  - it reports none (Lever, Ashby) and its first postings name the company
//    at least twice.
// Everything else is recorded and left alone.
//
// Outcomes, all written to portals.yml as text edits (comments kept) under
// the explorer's lock, after a timestamped backup, capped per run:
//  - missing: a websearch/playwright company gets the board's careers_url
//    (+ api/provider) instead;
//  - stale:   a Greenhouse/Ashby/Lever board that answered 404/410 is repointed;
//  - dead:    a stale board with no replacement (or whose company another entry
//    already covers) is REMOVED once it has answered 404/410 across two passes
//    at least `dead_days` apart; a board that works again resets the clock;
//  - empty:   an auto-added entry whose board stays empty for `empty_days` is REMOVED;
//  - duplicate: a websearch/playwright entry for a company that another entry
//    already scans through its board (explorer added "Gong.io" next to "Gong")
//    is switched off.
// A removed entry stays in data/resolved-boards.jsonl (with its careers_url) and
// in the portals.yml.bak-resolver-* backup of that run.
// Nothing here touches the web-search engines.

import { readFileSync, writeFileSync, renameSync, unlinkSync, copyFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { load as yamlLoad } from 'js-yaml';
import { acquireLock, verifyBoard, boardEndpoints, indexTrackedCompanies, extractBoards } from './ats-explorer.mjs';
import { PROVIDER_BOARD_ATS } from './ats-provider-board.mjs';
import { ATS_HOSTS } from './ats-autodetect.mjs';
import { hasCareersFeed } from './careers-feeds.mjs';

export const BOARD_RESOLVER_DEFAULTS = Object.freeze({
  enabled: true,
  max_companies: 25,      // companies probed per run (~40 public GETs each)
  max_apply: 12,          // portals.yml entries rewritten per run
  min_roles: 3,           // a board with fewer open roles is not worth a rewrite
  retry_days: 14,         // a company without a board is not probed again before this
  stale_retry_days: 3,    // a dead board is retried sooner
  concurrency: 8,
  disable_duplicates: true,
  prune_empty: true,      // remove auto-added entries whose board stays empty
  empty_days: 21,         // ... for this many days in a row
  prune_probes: 15,       // boards re-checked per run
  prune_dead: true,       // remove boards that answer 404/410 with no replacement
  dead_days: 3,           // ... on two passes at least this many days apart
  max_remove: 10,         // dead boards removed per run (an outage never empties the list)
});

const MAX_DUPLICATES_PER_RUN = 10;
// A dead board not seen dead for this long starts its clock again.
const STALE_FORGET_DAYS = 14;

// Priority when several ATS answer for the same company.
export const RESOLVE_ATS = ['greenhouse', 'ashby', 'lever', 'workable', 'smartrecruiters', 'recruitee', 'teamtailor', 'personio'];

export function resolveBoardResolverConfig(config = {}, env = process.env) {
  const c = { ...BOARD_RESOLVER_DEFAULTS, ...(config?.ats_board_resolver || {}) };
  if (/^(0|false|off|no)$/i.test(env.ATS_RESOLVER || '')) c.enabled = false;
  for (const [k, ek] of [['max_companies', 'ATS_RESOLVER_MAX_COMPANIES'], ['max_apply', 'ATS_RESOLVER_MAX_APPLY'], ['min_roles', 'ATS_RESOLVER_MIN_ROLES']]) {
    const v = Number.parseInt(env[ek] ?? '', 10);
    if (Number.isFinite(v) && v >= 0) c[k] = v;
  }
  c.enabled = c.enabled !== false;
  c.disable_duplicates = c.disable_duplicates !== false;
  c.prune_empty = c.prune_empty !== false;
  c.prune_dead = c.prune_dead !== false;
  c.exclude = Array.isArray(c.exclude) ? c.exclude.map(String) : [];
  return c;
}

/**
 * Whether a board fetch error says the board is gone (HTTP 404/410), not that it
 * had a bad moment. The scan records those boards as stale for the resolver.
 */
export function isDeadBoardError(reason) {
  return /\bHTTP\s+(?:404|410)\b/i.test(String(reason ?? ''));
}

// ── Names ───────────────────────────────────────────────────────────────────
// Words that do not tell two companies apart: legal forms and generic suffixes.
const NAME_STOP = new Set(['inc', 'llc', 'ltd', 'limited', 'gmbh', 'ag', 'sa', 'sas', 'sarl', 'bv', 'nv', 'plc', 'corp', 'corporation',
  'co', 'company', 'group', 'holdings', 'holding', 'technologies', 'technology', 'tech', 'labs', 'lab', 'software', 'solutions',
  'ai', 'io', 'hq', 'app', 'the', 'careers', 'career', 'jobs', 'job', 'team']);

function nameTokens(name) {
  return String(name || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * Comparable form of a company name: legal/generic words dropped, spacing and punctuation gone.
 * A leading "the" is kept: "The Flex" (short-term rentals) and "Flex" (a fintech) are two
 * companies with a board each, and a key that merged them would let one stand in for the other
 * when a board is attached, or when an entry is switched off or removed as a duplicate.
 * A "the" inside a name ("Bank of the West") is still dropped.
 */
export function companyKey(name) {
  const tokens = nameTokens(name);
  const kept = tokens.filter((t, i) => !NAME_STOP.has(t) || (t === 'the' && i === 0 && tokens.length > 1));
  return (kept.length ? kept : tokens).join('');
}

// ATS, social and search hosts say nothing about the company's own domain.
const HOST_SKIP = /(?:^|\.)(?:greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com|recruitee\.com|teamtailor\.com|personio\.(?:de|com)|bamboohr\.com|breezy\.hr|pinpointhq\.com|join\.com|rippling\.com|myworkdayjobs\.com|icims\.com|linkedin\.com|google\.com|indeed\.com|glassdoor\.com|welcometothejungle\.com|wellfound\.com|github\.com)$/i;

/** Own-domain labels of a company ("www.twilio.com" -> twilio, "grab.careers" -> grab) from careers_url and scan_query. */
export function domainLabels(company = {}) {
  const hosts = new Set();
  try { hosts.add(new URL(String(company.careers_url || '')).hostname); } catch { /* no usable URL */ }
  const query = String(company.scan_query || '');
  for (const m of query.matchAll(/site:([a-z0-9.-]+\.[a-z]{2,})/gi)) hosts.add(m[1]);
  for (const m of query.matchAll(/"([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})"/gi)) hosts.add(m[1]);
  const labels = [];
  for (const raw of hosts) {
    const host = String(raw).toLowerCase().replace(/^www\./, '');
    if (HOST_SKIP.test(host)) continue;
    const parts = host.split('.');
    if (parts.length < 2) continue;
    // co.uk / com.au style suffixes keep the label one step further left
    const i = parts.length >= 3 && /^(?:co|com|org|net|gov|ac)$/.test(parts[parts.length - 2]) && parts[parts.length - 1].length === 2
      ? parts.length - 3 : parts.length - 2;
    if (parts[i] && !labels.includes(parts[i])) labels.push(parts[i]);
  }
  return labels;
}

/** Board slugs worth asking about, best first (at most 5, 3+ characters). */
export function guessSlugs(company = {}) {
  const tokens = nameTokens(company.name);
  const stripped = tokens.filter(t => !NAME_STOP.has(t));
  const base = stripped.length ? stripped : tokens;
  const out = [];
  const add = (s) => {
    const slug = String(s || '').toLowerCase().replace(/^-+|-+$/g, '');
    if (slug.length >= 3 && slug.length <= 40 && !out.includes(slug)) out.push(slug);
  };
  add(base.join(''));
  add(base.join('-'));
  add(tokens.join(''));
  add(tokens.join('-'));
  domainLabels(company).forEach(add);
  return out.slice(0, 5);
}

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/**
 * How many times the company's own name appears in a text sample. Its domain
 * does not count: "Weights & Biases" carries a coreweave.com query, and
 * CoreWeave's postings naming CoreWeave say nothing about W&B.
 */
function mentions(sample, company) {
  const text = nameTokens(sample).join(' ');
  if (!text) return 0;
  const stripped = nameTokens(company.name).filter(t => !NAME_STOP.has(t));
  if (stripped.join('').length < 3) return 0;
  return (text.match(new RegExp(`(?:^| )${escapeRe(stripped.join(' '))}(?= |$)`, 'g')) || []).length;
}

/**
 * Decide whether a guessed board is the company's. Returns
 * { ok, reason, confidence?: 'name'|'text', boardName? }.
 */
export function judgeBoard(company, board, { minRoles = BOARD_RESOLVER_DEFAULTS.min_roles } = {}) {
  if (!board || board.status !== 200) return { ok: false, reason: `http_${board?.status || 'error'}` };
  const roles = board.titles?.length || 0;
  if (roles < 1) return { ok: false, reason: 'empty_board' };
  let confidence;
  if (board.name) {
    // The company's own name only: a domain label is good for guessing a slug,
    // not for proving whose board it is (an acquirer's board has its own name).
    const boardKey = companyKey(board.name);
    const wanted = companyKey(company.name);
    if (!boardKey || wanted.length < 3 || boardKey !== wanted) return { ok: false, reason: 'name_mismatch', boardName: board.name };
    confidence = 'name';
  } else if (mentions(board.sample, company) >= 2) {
    confidence = 'text';
  } else {
    return { ok: false, reason: 'no_identity_signal' };
  }
  if (roles < minRoles) return { ok: false, reason: 'small_board', confidence, boardName: board.name || null };
  return { ok: true, reason: 'ok', confidence, boardName: board.name || null };
}

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

/**
 * {ats, slug} pairs a company's own careers page points at (links, iframes,
 * embed scripts). Slug guessing misses companies whose board has an unrelated
 * slug; their own page names it. Only the company's own domain is read: an
 * ATS, social or search URL says nothing about where the company posts.
 */
export async function pageBoardHints(company = {}, { fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  let url;
  try { url = new URL(String(company.careers_url || '')); } catch { return []; }
  if (url.protocol !== 'https:' || HOST_SKIP.test(url.hostname)) return [];
  let html = '';
  try {
    const r = await fetchImpl(url.href, { signal: AbortSignal.timeout(timeoutMs), redirect: 'follow', headers: { Accept: 'text/html', 'User-Agent': 'jobyougo-ats-resolver/1.0' } });
    if (r.status !== 200) return [];
    html = (await r.text()).slice(0, 1_500_000);
  } catch { return []; }
  return extractBoards(html).filter((h) => RESOLVE_ATS.includes(h.ats) || PROVIDER_BOARD_ATS.includes(h.ats)).slice(0, 4);
}

/**
 * Ask every guessed (slug x ATS) pair for its board and keep the ones that
 * pass judgeBoard. `hints` are {ats, slug} pairs seen elsewhere (the explorer's
 * journal); they are verified exactly like guesses.
 */
export async function resolveCompanyBoard(company, {
  fetchImpl = globalThis.fetch, verify = verifyBoard, minRoles, concurrency = BOARD_RESOLVER_DEFAULTS.concurrency,
  atsList = RESOLVE_ATS, hints = [], pageHints = pageBoardHints,
} = {}) {
  const tasks = [];
  const seen = new Set();
  const push = (ats, slug) => { const k = `${ats}|${slug}`; if (!seen.has(k) && boardEndpoints(ats, slug)) { seen.add(k); tasks.push({ ats, slug }); } };
  for (const h of hints) if (h?.ats && h?.slug) push(h.ats, h.slug);
  const slugs = guessSlugs(company);
  for (const slug of slugs) for (const ats of atsList) push(ats, slug);
  const boards = await pool(tasks, concurrency, async (t) => ({ ...t, board: await verify(t, { fetchImpl, timeoutMs: 8000 }) }));
  const hits = []; const rejected = [];
  for (const r of boards) {
    if (r.board?.status !== 200) continue;
    const verdict = judgeBoard(company, r.board, { minRoles });
    (verdict.ok ? hits : rejected).push({ ats: r.ats, slug: r.slug, roles: r.board.titles.length, name: r.board.name, verdict });
  }
  hits.sort((a, b) => atsList.indexOf(a.ats) - atsList.indexOf(b.ats) || b.roles - a.roles);
  if (!hits.length && pageHints) {
    // Nothing matched by name: follow what the company's own careers page links to.
    // The link is the identity signal, so only the board's size is checked.
    const linked = (await pageHints(company, { fetchImpl })).filter((h) => !seen.has(`${h.ats}|${h.slug}`));
    const answers = await pool(linked, concurrency, async (h) => ({ ...h, board: await verify(h, { fetchImpl, timeoutMs: 8000 }) }));
    for (const r of answers) {
      if (r.board?.status !== 200) continue;
      const roles = r.board.titles?.length || 0;
      const verdict = roles >= (minRoles ?? BOARD_RESOLVER_DEFAULTS.min_roles)
        ? { ok: true, reason: 'ok', confidence: 'page', boardName: r.board.name || null }
        : { ok: false, reason: roles ? 'small_board' : 'empty_board' };
      (verdict.ok ? hits : rejected).push({ ats: r.ats, slug: r.slug, roles, name: r.board.name, verdict });
    }
    hits.sort((a, b) => b.roles - a.roles);
  }
  return { slugs, tried: tasks.length, best: hits[0] || null, alternatives: hits.slice(1), rejected };
}

// ── What to resolve ─────────────────────────────────────────────────────────
const GH_URL = /^https:\/\/(?:job-boards(?:\.eu)?|boards(?:\.eu)?)\.greenhouse\.io\/([^/?#]+)/i;
const ASHBY_URL = /^https:\/\/jobs\.ashbyhq\.com\/([^/?#]+)/i;
const LEVER_URL = /^https:\/\/jobs(\.eu)?\.lever\.co\/([^/?#]+)/i;

/**
 * Scan access of a company, close to ui/server.mjs getCompanyScanAccess. The
 * scan passes the real function; the CLI uses this one.
 */
export function approxAccess(company = {}) {
  if (typeof company.provider === 'string' && company.provider.trim()) return { mode: 'provider' };
  if (company.api) return { mode: 'api' };
  const url = String(company.careers_url || '');
  if (GH_URL.test(url) || ASHBY_URL.test(url) || LEVER_URL.test(url)) return { mode: 'api' };
  try {
    const host = new URL(url).hostname;
    if (Object.values(ATS_HOSTS).some(re => re.test(host))) return { mode: 'provider' };
  } catch { /* not a URL */ }
  return { mode: String(company.scan_method || '').toLowerCase() === 'websearch' && company.scan_query ? 'websearch' : 'playwright' };
}

// "Greenhouse — UX/UI ..." and "JobsDB & Jora" are queries and boards, not companies.
const NOT_A_COMPANY = /\s[—–]\s|\b(?:jobs?|boards?|portal|marketplace|aggregator)\b/i;

/** Tracked companies to probe: dead boards first, then those with no board at all. */
export function selectResolveTargets(tracked = [], { accessOf = approxAccess, stale = new Map(), state = {}, cfg = BOARD_RESOLVER_DEFAULTS, now = Date.now() } = {}) {
  const exclude = new Set((cfg.exclude || []).map(s => String(s).toLowerCase()));
  const out = [];
  for (const company of tracked) {
    if (!company || typeof company !== 'object' || !company.name || company.enabled === false) continue;
    if (exclude.has(String(company.name).toLowerCase()) || NOT_A_COMPANY.test(company.name)) continue;
    if (hasCareersFeed(company)) continue;
    const isStale = stale.has(company.name);
    const mode = accessOf(company)?.mode;
    if (!isStale && mode !== 'websearch' && mode !== 'playwright') continue;
    const tried = Date.parse(state.tried?.[company.name] || '');
    const waitDays = isStale ? cfg.stale_retry_days : cfg.retry_days;
    if (Number.isFinite(tried) && now - tried < waitDays * 86400000) continue;
    out.push({ company, why: isStale ? 'stale' : 'missing' });
  }
  out.sort((a, b) => (a.why === b.why ? 0 : a.why === 'stale' ? -1 : 1));
  return out.slice(0, cfg.max_companies);
}

/**
 * Entries that scan the same company a second time through search or browser
 * while another entry already reads its ATS board.
 */
export function findRedundantEntries(tracked = [], { accessOf = approxAccess, stale = new Map() } = {}) {
  const groups = new Map();
  for (const c of tracked) {
    if (!c || typeof c !== 'object' || !c.name || c.enabled === false) continue;
    const key = companyKey(c.name);
    if (key.length < 3) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  const out = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const keeper = list.find(c => !stale.has(c.name) && ['api', 'provider'].includes(accessOf(c)?.mode));
    if (!keeper) continue;
    for (const c of list) {
      if (c === keeper || hasCareersFeed(c)) continue;
      if (['websearch', 'playwright'].includes(accessOf(c)?.mode)) out.push({ company: c, keeper });
    }
  }
  return out;
}

/**
 * Entries this module family added on its own (notes "auto-explored" /
 * "auto-resolved") whose board has answered with no open role for
 * `empty_days` in a row. A board that fills up again resets its clock; an
 * entry the user edited by hand (other notes) is never touched. Bounded probes
 * per run, rotated by the oldest check first.
 */
export async function pruneEmptyAutoBoards(tracked = [], { state = {}, now = new Date(), cfg = BOARD_RESOLVER_DEFAULTS, fetchImpl = globalThis.fetch, skip = new Set(), verify = verifyBoard } = {}) {
  state.empty = state.empty || {};
  state.checked = state.checked || {};
  const auto = tracked.filter(c => c && c.name && c.enabled !== false && !skip.has(c.name)
    && /^auto-(?:explored|resolved)\b/i.test(String(c.notes || '')));
  auto.sort((a, b) => Date.parse(state.checked[a.name] || 0) - Date.parse(state.checked[b.name] || 0));
  const out = [];
  for (const company of auto.slice(0, cfg.prune_probes ?? 15)) {
    const ref = extractBoards([company.careers_url, company.api].filter(Boolean))[0];
    if (!ref || !boardEndpoints(ref.ats, ref.slug)) continue;
    const board = await verify(ref, { fetchImpl, timeoutMs: 8000 });
    state.checked[company.name] = now.toISOString();
    if (board.status !== 200 || board.parseError) continue; // trouble is not an empty board
    if (board.titles.length > 0) { delete state.empty[company.name]; continue; }
    state.empty[company.name] = state.empty[company.name] || now.toISOString();
    const days = (now.getTime() - Date.parse(state.empty[company.name])) / 86400000;
    if (days >= (cfg.empty_days ?? 21)) out.push({ company, since: state.empty[company.name].slice(0, 10) });
  }
  return out;
}

/** {ats, slug} pairs the explorer saw answering with open roles (data/discovered-companies.jsonl), by company key. */
export function readExplorerHints(dataDir) {
  const hints = new Map();
  let raw = '';
  try { raw = readFileSync(join(dataDir, 'discovered-companies.jsonl'), 'utf8'); } catch { return hints; }
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    if (!r?.ats || !r?.slug || r.status !== 200 || !(r.open_roles > 0)) continue;
    const key = companyKey(r.name);
    if (key.length < 3) continue;
    if (!hints.has(key)) hints.set(key, []);
    if (!hints.get(key).some(h => h.ats === r.ats && h.slug === r.slug)) hints.get(key).push({ ats: r.ats, slug: r.slug });
  }
  return hints;
}

/** Greenhouse/Ashby/Lever boards that answer 404/410 right now (CLI use; the scan records them as it fetches). */
export async function detectStaleBoards(tracked = [], { fetchImpl = globalThis.fetch, concurrency = BOARD_RESOLVER_DEFAULTS.concurrency } = {}) {
  const urlOf = (c) => {
    const url = String(c.careers_url || '');
    if (c.api && /greenhouse|ashbyhq|lever\.co/i.test(c.api)) return c.api;
    let m = url.match(GH_URL); if (m) return `https://boards-api.greenhouse.io/v1/boards/${m[1]}/jobs`;
    m = url.match(ASHBY_URL); if (m) return `https://api.ashbyhq.com/posting-api/job-board/${m[1]}`;
    m = url.match(LEVER_URL); if (m) return `${m[1] ? 'https://api.eu.lever.co' : 'https://api.lever.co'}/v0/postings/${m[2]}?mode=json`;
    return '';
  };
  const list = tracked.filter(c => c && c.name && c.enabled !== false && !c.provider && urlOf(c));
  const stale = new Map();
  await pool(list, concurrency, async (c) => {
    try {
      const r = await fetchImpl(urlOf(c), { signal: AbortSignal.timeout(10000), headers: { Accept: 'application/json', 'User-Agent': 'jobyougo-ats-resolver/1.0' } });
      if (r.status === 404 || r.status === 410) stale.set(c.name, { reason: `HTTP ${r.status}` });
    } catch { /* network trouble is not a dead board */ }
  });
  return stale;
}

// ── portals.yml text edits ──────────────────────────────────────────────────
const ORDER_AFTER = ['careers_url', 'api', 'provider'];

function entryRange(lines, name) {
  const start = lines.findIndex(l => /^tracked_companies:\s*$/.test(l));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^[A-Za-z_][\w-]*:/.test(lines[i])) { end = i; break; }
  let from = -1;
  for (let i = start + 1; i < end; i++) {
    const m = lines[i].match(/^ {2}- name:\s*(.*?)\s*$/);
    if (!m) continue;
    if (from >= 0) return { from, to: i };
    let value;
    try { value = yamlLoad(`n: ${m[1]}`)?.n; } catch { continue; }
    if (String(value) === name) from = i;
  }
  return from >= 0 ? { from, to: end } : null;
}

function fieldIndex(lines, range, key) {
  const re = new RegExp(`^ {4}${key}:`);
  for (let i = range.from + 1; i < range.to; i++) if (re.test(lines[i])) return i;
  return -1;
}

function renderValue(key, value) {
  if (key === 'enabled') return value ? 'true' : 'false';
  if (key === 'notes') return JSON.stringify(String(value)); // a JSON string is a valid YAML double-quoted scalar
  return String(value);
}

function setField(lines, range, key, value) {
  const idx = fieldIndex(lines, range, key);
  if (idx >= 0) {
    const v = lines[idx].slice(lines[idx].indexOf(':') + 1).trim();
    const next = idx + 1 < range.to ? lines[idx + 1] : '';
    if (/^[>|][+-]?\d*$/.test(v) || /^ {5,}\S/.test(next)) throw new Error(`${key} spans several lines`);
    if (value === null) { lines.splice(idx, 1); range.to -= 1; } else lines[idx] = `    ${key}: ${renderValue(key, value)}`;
    return;
  }
  if (value === null) return;
  // insert after the last of careers_url / api / provider that exists, else after the last field line
  let at = range.from;
  for (const k of ORDER_AFTER) { const i = fieldIndex(lines, range, k); if (i >= 0) at = Math.max(at, i); }
  if (key === 'notes' || key === 'enabled' || at === range.from) {
    for (let i = range.from + 1; i < range.to; i++) if (/^ {4}\S/.test(lines[i])) at = Math.max(at, i);
  }
  lines.splice(at + 1, 0, `    ${key}: ${renderValue(key, value)}`);
  range.to += 1;
}

/**
 * Apply patches [{ name, set: { careers_url, api, provider, notes, enabled }, expect }] to a portals.yml
 * text. A null value removes the field. A patch `{ name, remove: true }` deletes the whole entry (its
 * fields; the blank and comment lines that sit between it and the next entry stay). `expect.careers_url`
 * guards against an entry edited since it was read. Returns { text, applied, skipped }.
 */
export function patchPortalsText(text, patches = []) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  let lines = text.split(/\r?\n/);
  const applied = []; const skipped = [];
  for (const p of patches) {
    const range = entryRange(lines, p.name);
    if (!range) { skipped.push({ name: p.name, reason: 'entry_not_found' }); continue; }
    if (p.expect?.careers_url !== undefined) {
      const i = fieldIndex(lines, range, 'careers_url');
      const current = i >= 0 ? lines[i].slice(lines[i].indexOf(':') + 1).trim().replace(/^["']|["']$/g, '') : '';
      if (current !== p.expect.careers_url) { skipped.push({ name: p.name, reason: 'changed_meanwhile' }); continue; }
    }
    if (p.remove) {
      // the last entry of a block runs up to the next top-level key: keep its trailing section comments
      let to = range.to;
      while (to - 1 > range.from && /^ {0,3}(?:#.*)?$/.test(lines[to - 1])) to -= 1;
      lines = [...lines.slice(0, range.from), ...lines.slice(to)];
      applied.push(p);
      continue;
    }
    const trial = [...lines];
    const trialRange = { ...range };
    try {
      for (const key of ['careers_url', 'api', 'provider', 'notes', 'enabled']) {
        if (key in p.set) setField(trial, trialRange, key, p.set[key]);
      }
    } catch (err) { skipped.push({ name: p.name, reason: err.message }); continue; }
    lines = trial;
    applied.push(p);
  }
  return { text: lines.join(eol), applied, skipped };
}

function checkPatched(nextText, patches, expectedCount) {
  const list = yamlLoad(nextText)?.tracked_companies;
  const removals = patches.filter(p => p.remove).length;
  if (!Array.isArray(list) || list.length !== expectedCount - removals) throw new Error('tracked_companies changed size');
  for (const p of patches) {
    const entry = list.find(c => c?.name === p.name);
    if (p.remove) {
      if (entry) throw new Error(`"${p.name}" is still there after its removal`);
      continue;
    }
    if (!entry) throw new Error(`"${p.name}" vanished`);
    for (const [key, value] of Object.entries(p.set)) {
      if (value === null ? entry[key] !== undefined : entry[key] !== value) throw new Error(`"${p.name}".${key} does not read back as written`);
    }
  }
}

/** Lock, re-read, patch, re-parse, back up, atomic rename. Returns { applied, skipped, backupPath }. */
export function applyPortalsPatches(portalsPath, patches, { now = new Date(), dryRun = false } = {}) {
  if (!patches.length) return { applied: [], skipped: [], backupPath: null };
  const lockPath = `${portalsPath}.explorer.lock`; // same lock as the explorer: one writer at a time
  if (!dryRun && !acquireLock(lockPath)) return { applied: [], skipped: patches.map(p => ({ name: p.name, reason: 'portals_locked' })), backupPath: null };
  try {
    const text = readFileSync(portalsPath, 'utf8');
    const count = (yamlLoad(text)?.tracked_companies || []).length;
    const res = patchPortalsText(text, patches);
    if (!res.applied.length || dryRun) return { applied: dryRun ? res.applied : [], skipped: res.skipped, backupPath: null };
    checkPatched(res.text, res.applied, count);
    const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
    const backupPath = `${portalsPath}.bak-resolver-${stamp}`;
    copyFileSync(portalsPath, backupPath);
    const tmp = `${portalsPath}.resolver.tmp`;
    writeFileSync(tmp, res.text, 'utf8');
    renameSync(tmp, portalsPath);
    return { applied: res.applied, skipped: res.skipped, backupPath };
  } finally {
    if (!dryRun) { try { unlinkSync(lockPath); } catch { /* already gone */ } }
  }
}

// ── Orchestration ───────────────────────────────────────────────────────────
function readJson(path) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return {}; } }
const short = (s, n = 160) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/**
 * Record that a stale board was seen dead on this pass: { first, days } where
 * `first` is the start of the current run of dead sightings and `days` how long
 * it has lasted. A board not seen dead for STALE_FORGET_DAYS starts over, so a
 * board that came back and died again gets the full confirmation window.
 */
export function markStale(stale, name, now = new Date()) {
  const seen = stale[name];
  const continuing = seen && now.getTime() - Date.parse(seen.last) < STALE_FORGET_DAYS * 86400000;
  const first = continuing ? seen.first : now.toISOString();
  stale[name] = { first, last: now.toISOString() };
  return { first, days: (now.getTime() - Date.parse(first)) / 86400000 };
}

/**
 * One resolver pass over the tracked companies of portals.yml.
 * @param {object} o
 * @param {string} o.portalsPath
 * @param {string} o.dataDir     where resolved-boards.jsonl / ats-resolver-state.json live
 * @param {(company:object)=>{mode:string}} [o.accessOf]  the scan's getCompanyScanAccess
 * @param {Map<string,object>} [o.stale]  companies whose Greenhouse/Ashby/Lever board answered 404/410 in this run
 * @param {boolean} [o.probeStale]        find stale boards by asking them (CLI)
 * @param {string[]|null} [o.only]        restrict to these company names (CLI)
 */
export async function runAtsBoardResolver({
  portalsPath, dataDir, accessOf = approxAccess, stale = new Map(), probeStale = false, only = null, config = {}, env = process.env,
  fetchImpl = globalThis.fetch, log = console.log, now = new Date(), dryRun = false,
} = {}) {
  const cfg = resolveBoardResolverConfig(config, env);
  const summary = { disabled: false, targets: 0, tried: 0, resolved: 0, duplicates: 0, pruned: 0, removed: 0, removedNames: [], applied: 0, appliedNames: [], backupPath: null, records: [], skipped: [] };
  if (!cfg.enabled) { summary.disabled = true; log('[scan] [resolver] disabled (ats_board_resolver.enabled=false or ATS_RESOLVER=0)'); return summary; }

  const statePath = join(dataDir, 'ats-resolver-state.json');
  const state = readJson(statePath);
  state.tried = state.tried || {};
  state.stale = state.stale || {};
  const tracked = (yamlLoad(readFileSync(portalsPath, 'utf8')) || {}).tracked_companies || [];
  const staleMap = probeStale ? await detectStaleBoards(tracked, { fetchImpl, concurrency: cfg.concurrency }) : stale;
  const hints = readExplorerHints(dataDir);
  const index = indexTrackedCompanies(tracked);
  const date = now.toISOString().slice(0, 10);

  let targets = selectResolveTargets(tracked, { accessOf, stale: staleMap, state, cfg, now: now.getTime() });
  if (only?.length) {
    const want = new Set(only.map(n => String(n).toLowerCase()));
    targets = selectResolveTargets(tracked.filter(c => want.has(String(c?.name).toLowerCase())), { accessOf, stale: staleMap, state: {}, cfg: { ...cfg, max_companies: 1000 }, now: now.getTime() });
  }
  summary.targets = targets.length;

  const patches = [];
  let deadRemoved = 0;
  // A dead board is removed once it was seen dead on two passes `dead_days` apart (and nothing replaces it).
  const removeIfDead = (company, dead, rec, reason) => {
    if (!dead || !cfg.prune_dead || dead.days < cfg.dead_days || deadRemoved >= cfg.max_remove) return;
    patches.push({ name: company.name, remove: true, expect: { careers_url: String(company.careers_url || '') } });
    deadRemoved++;
    Object.assign(rec, { decision: 'removed', reason, careers_url: String(company.careers_url || '') });
  };
  for (const { company, why } of targets) {
    if (patches.length >= cfg.max_apply) break;
    summary.tried++;
    const res = await resolveCompanyBoard(company, { fetchImpl, minRoles: cfg.min_roles, concurrency: cfg.concurrency, hints: hints.get(companyKey(company.name)) || [] });
    state.tried[company.name] = now.toISOString();
    const dead = why === 'stale' ? markStale(state.stale, company.name, now) : null;
    const rec = { ts: now.toISOString(), company: company.name, why, probed: res.tried, decision: 'no_board', reason: res.rejected[0]?.verdict.reason || 'no_answer' };
    if (res.best) {
      const best = res.best;
      const other = index.bySlug.get(best.slug);
      Object.assign(rec, { ats: best.ats, slug: best.slug, board_name: best.name, open_roles: best.roles, confidence: best.verdict.confidence });
      if (other && other !== company) {
        // explorer already tracks that board under another entry: the duplicate pass switches a
        // search entry off; a dead board of the same company is simply redundant
        Object.assign(rec, { decision: 'duplicate_of', reason: other.name });
        removeIfDead(company, dead, rec, `dead board; the company is already tracked as "${other.name}"`);
      } else {
        delete state.stale[company.name];
        const ep = boardEndpoints(best.ats, best.slug);
        const earlier = short(company.notes);
        patches.push({
          name: company.name,
          expect: { careers_url: String(company.careers_url || '') },
          set: {
            careers_url: ep.careers_url,
            api: ep.api || null,
            provider: ep.provider || null,
            notes: `auto-resolved ${date}: public ${best.ats} board "${best.slug}" verified live (${best.roles} open roles, matched on ${best.verdict.confidence}); replaces ${company.careers_url || 'no board'}.${earlier ? ` Earlier note: ${earlier}` : ''}`,
          },
        });
        Object.assign(rec, { decision: why === 'stale' ? 'repaired' : 'resolved', reason: 'ok', careers_url: ep.careers_url });
        summary.resolved++;
      }
    } else {
      if (res.rejected.length) rec.rejected = res.rejected.slice(0, 4).map(r => `${r.ats}:${r.slug}=${r.verdict.reason}${r.verdict.boardName ? `(${short(r.verdict.boardName, 40)})` : ''}`);
      removeIfDead(company, dead, rec, dead ? `board dead since ${dead.first.slice(0, 10)}, no replacement found` : '');
    }
    summary.records.push(rec);
  }

  if (cfg.disable_duplicates) {
    const patched = new Set(patches.map(p => p.name));
    for (const { company, keeper } of findRedundantEntries(tracked, { accessOf, stale: staleMap })) {
      if (summary.duplicates >= MAX_DUPLICATES_PER_RUN || patched.has(company.name)) continue;
      const earlier = short(company.notes);
      patches.push({
        name: company.name,
        expect: { careers_url: String(company.careers_url || '') },
        set: { enabled: false, notes: `auto-disabled ${date}: same company as "${keeper.name}", which is scanned through its public ATS board.${earlier ? ` Earlier note: ${earlier}` : ''}` },
      });
      summary.duplicates++;
      summary.records.push({ ts: now.toISOString(), company: company.name, why: 'duplicate', decision: 'disabled', reason: `same company as ${keeper.name}` });
    }
  }

  if (cfg.prune_empty) {
    const patched = new Set(patches.map(p => p.name));
    const pruned = await pruneEmptyAutoBoards(tracked, { state, now, cfg, fetchImpl, skip: patched });
    for (const p of pruned) {
      patches.push({ name: p.company.name, remove: true, expect: { careers_url: String(p.company.careers_url || '') } });
      summary.pruned++;
      summary.records.push({ ts: now.toISOString(), company: p.company.name, why: 'empty_board', decision: 'removed', reason: `no open role since ${p.since}`, careers_url: String(p.company.careers_url || '') });
    }
  }

  const res = applyPortalsPatches(portalsPath, patches, { now, dryRun });
  summary.applied = res.applied.length;
  summary.appliedNames = res.applied.map(p => p.name);
  summary.removedNames = res.applied.filter(p => p.remove).map(p => p.name);
  summary.removed = summary.removedNames.length;
  summary.backupPath = res.backupPath;
  summary.skipped = res.skipped;
  for (const s of res.skipped) {
    const r = summary.records.find(x => x.company === s.name && ['resolved', 'repaired', 'disabled', 'removed'].includes(x.decision));
    if (r) { r.decision = 'not_written'; r.reason = s.reason; }
  }
  for (const name of summary.removedNames) delete state.stale[name];

  if (!dryRun) {
    mkdirSync(dataDir, { recursive: true });
    if (summary.records.length) appendFileSync(join(dataDir, 'resolved-boards.jsonl'), summary.records.map(r => JSON.stringify(r)).join('\n') + '\n');
    const keep = Object.fromEntries(Object.entries(state.tried).filter(([, t]) => now.getTime() - Date.parse(t) < 60 * 86400000));
    const names = new Set(tracked.map(c => c?.name));
    for (const name of summary.removedNames) names.delete(name);
    const known = (map) => Object.fromEntries(Object.entries(map || {}).filter(([n]) => names.has(n)));
    const tmp = `${statePath}.tmp`;
    writeFileSync(tmp, JSON.stringify({ lastRun: now.toISOString(), tried: keep, empty: known(state.empty), checked: known(state.checked), stale: known(state.stale) }, null, 2));
    renameSync(tmp, statePath);
  }
  log(`[scan] [resolver] probed=${summary.tried} resolved=${summary.resolved} duplicates=${summary.duplicates} pruned=${summary.pruned} removed=${summary.removed} ${dryRun ? 'would-write' : 'written'}=${summary.applied}${summary.appliedNames.length ? ` (${summary.appliedNames.join(', ')})` : ''}${res.skipped.length ? ` not-written=${res.skipped.length}` : ''}`);
  return summary;
}
