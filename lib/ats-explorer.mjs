// ATS explorer: finds companies hiring in tech/product on public ATS boards and
// adds them to portals.yml `tracked_companies`.
//
// Two inputs feed the same pipeline:
//  - passive: job URLs already seen by a scan (aggregators, web search, history)
//  - active ("explorer"): a small, rotating budget of `site:<ats>` web queries run
//    through the caller's existing search engine (rotation, pauses and captcha
//    circuits stay with that engine; nothing here bypasses them).
// Each candidate slug is deduplicated against every tracked company (enabled AND
// disabled; a disabled entry is never re-enabled), its public board endpoint is
// checked (HTTP 200 + open roles), and it is only added when at least one open
// role is tech/product (engineering/IT, product, design, data/AI) and no
// exclusion applies (agencies, job boards, ambiguous slugs, off-profile sectors).
// portals.yml is edited as text (comments preserved), under a lock file, with an
// atomic rename, after a timestamped backup, capped per run.

import { readFileSync, writeFileSync, renameSync, openSync, closeSync, unlinkSync, statSync, appendFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { load as yamlLoad } from 'js-yaml';
import { explainTitle } from './scan-decision.mjs';
import {
  PROVIDER_BOARD_ATS, extractWorkdayBoards, extractComeetBoards, extractComeetApiUids, comeetUid,
  providerBoardEndpoints, verifyBoardViaProvider, verifyComeetBoard,
} from './ats-provider-board.mjs';

export const ATS_EXPLORER_DEFAULTS = Object.freeze({
  enabled: true,
  max_queries: 6,      // web queries per run (keeps pressure on blocked engines low)
  max_add: 10,         // companies added per run
  max_verify: 40,      // board endpoints checked per run
  min_roles: 2,        // a board with fewer open roles is treated as empty
  max_gh_lookups: 15,  // employer sites resolved to their Greenhouse board per run (gh_jid links)
});

// Broad tech/product queries, rotated across runs (state file keeps the cursor).
export const EXPLORER_ROLE_TERMS = [
  '"product designer" remote', '"senior product designer" remote', '"design systems" remote',
  '"ux designer" remote', '"head of design" remote', '"product manager" remote',
  '"software engineer" remote', '"machine learning engineer" remote', '"AI engineer" remote',
  '"frontend engineer" remote', '"data engineer" remote', '"design engineer" remote',
];
export const EXPLORER_SITES = [
  'jobs.ashbyhq.com', 'job-boards.greenhouse.io', 'jobs.lever.co', 'apply.workable.com',
  'recruitee.com', 'jobs.personio.de', 'teamtailor.com', 'jobs.smartrecruiters.com',
];
// Opt-in (ats_explorer.longtail_queries: true): spreads the few queries of a run over more sites,
// so the default rotation stays on the vendors with the best hit rate.
export const EXPLORER_LONGTAIL_SITES = ['bamboohr.com/careers', 'breezy.hr', 'pinpointhq.com', 'ats.rippling.com', 'join.com/companies', 'comeet.com/jobs'];

/**
 * Search terms of the explorer: ats_explorer.role_terms, else the role terms of
 * the profile (title filter positives of a profile-filled portals config), else
 * the built-in tech/product list. Plain words only: regex positives belong to
 * the title gate, not to a search engine.
 */
export function explorerTerms(config = {}) {
  const clean = (list) => (Array.isArray(list) ? list : [])
    .map((t) => String(t || '').trim())
    .filter((t) => t.length >= 3 && t.length <= 60 && !/[\\^$*+?()[\]{}|]/.test(t));
  const own = clean(config?.ats_explorer?.role_terms);
  if (own.length) return own.slice(0, 12).map((t) => `"${t}"`);
  const fromProfile = clean(config?.title_filter?.positive);
  if (fromProfile.length) return fromProfile.slice(0, 12).map((t) => `"${t}"`);
  return EXPLORER_ROLE_TERMS;
}

export function buildExplorerQueries({ cursor = 0, budget = ATS_EXPLORER_DEFAULTS.max_queries, terms = EXPLORER_ROLE_TERMS, sites = EXPLORER_SITES } = {}) {
  const roleTerms = terms.length ? terms : EXPLORER_ROLE_TERMS;
  const all = [];
  for (const term of roleTerms) for (const site of sites) all.push(`site:${site} ${term}`);
  // interleave sites so one run spreads across ATS: order by (termIdx + siteIdx) walk
  const out = [];
  const n = Math.max(0, Math.min(budget, all.length));
  for (let i = 0; i < n; i++) {
    const k = (cursor + i) % all.length;
    const site = sites[k % sites.length];
    const term = roleTerms[Math.floor(k / sites.length) % roleTerms.length];
    out.push(`site:${site} ${term}`);
  }
  return { queries: out, nextCursor: (cursor + n) % all.length };
}

const SLUG = '([A-Za-z0-9][A-Za-z0-9._-]{1,80})';
const PATTERNS = [
  ['ashby', new RegExp(`(?:jobs\\.ashbyhq\\.com|api\\.ashbyhq\\.com/posting-api/job-board)/${SLUG}`, 'gi')],
  ['greenhouse', new RegExp(`(?:boards|job-boards(?:\\.eu)?)\\.greenhouse\\.io/(?:embed/job_board\\?for=)?${SLUG}`, 'gi')],
  ['greenhouse', new RegExp(`boards-api\\.greenhouse\\.io/v1/boards/${SLUG}`, 'gi')],
  ['lever', new RegExp(`(?:jobs(?:\\.eu)?\\.lever\\.co|api\\.lever\\.co/v0/postings)/${SLUG}`, 'gi')],
  ['workable', new RegExp(`apply\\.workable\\.com/(?!api/|j/)${SLUG}`, 'gi')],
  ['smartrecruiters', new RegExp(`(?:jobs|careers)\\.smartrecruiters\\.com/${SLUG}`, 'gi')],
  ['recruitee', /\b([a-z0-9][a-z0-9-]{1,60})\.recruitee\.com/gi],
  ['personio', /\b([a-z0-9][a-z0-9-]{1,60})\.jobs\.personio\.(?:de|com)/gi],
  ['teamtailor', /\b([a-z0-9][a-z0-9-]{1,60})\.teamtailor\.com/gi],
  ['traffit', /\b([a-z0-9][a-z0-9-]{1,60})\.traffit\.com/gi],
  ['dvinci', /\b([a-z0-9][a-z0-9-]{1,60})\.dvinci-hr\.com/gi],
  ['hirehive', /\b([a-z0-9][a-z0-9-]{1,60})\.hirehive\.com/gi],
  ['bamboohr', /\b([a-z0-9][a-z0-9-]{1,60})\.bamboohr\.com/gi],
  ['breezy', /\b([a-z0-9][a-z0-9-]{1,60})\.breezy\.hr/gi],
  ['pinpoint', /\b([a-z0-9][a-z0-9-]{1,60})\.pinpointhq\.com/gi],
  ['rippling', new RegExp(`ats\\.rippling\\.com/(?!api/)${SLUG}`, 'gi')],
  ['join', new RegExp(`join\\.com/companies/${SLUG}`, 'gi')],
];
// vendor hosts (not tenants) per ATS, on top of RESERVED
const ATS_RESERVED = {
  traffit: new Set(['cdn3', 'knowledge']),
  dvinci: new Set(['static']),
  hirehive: new Set(['status', 'docs']),
  bamboohr: new Set(['documentation', 'marketplace', 'partners', 'status']),
  breezy: new Set(['status', 'developer', 'api-docs']),
  pinpoint: new Set(['developers', 'status', 'docs']),
};
// Traffit career widgets embedded on a company's own site (jobseek traffit monitor markers)
const TRAFFIT_HTML_MARKERS = [/cdn3\.traffit\.com/i, /traffit-an-list/i, /data-name=["']traffit["']/i, /traffit\.com\/public\/an\/generateJs/i];
/** True when a page's HTML carries a Traffit career-widget marker. */
export function hasTraffitMarkers(html) {
  return typeof html === 'string' && TRAFFIT_HTML_MARKERS.some(re => re.test(html));
}
const RESERVED = new Set(['www', 'jobs', 'apply', 'api', 'embed', 'careers', 'job-boards', 'boards', 'j', 'v0', 'v1',
  'search', 'share', 'app', 'static', 'assets', 'cdn', 'help', 'support', 'login', 'signup', 'blog', 'na', 'oauth']);

/** Extract unique {ats, slug} pairs from URLs or free text. */
export function extractAtsSlugs(input) {
  const texts = Array.isArray(input) ? input : [input];
  const seen = new Map();
  for (const t of texts) {
    if (typeof t !== 'string' || !t) continue;
    let text = t;
    try { text = decodeURIComponent(t); } catch { /* keep raw */ }
    for (const [ats, re] of PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        const slug = m[1].toLowerCase().replace(/[._-]+$/, '');
        if (!slug || RESERVED.has(slug) || ATS_RESERVED[ats]?.has(slug) || /\.(js|css|png|svg|jpg|ico)$/.test(slug)) continue;
        const key = `${ats}|${slug}`;
        if (!seen.has(key)) seen.set(key, { ats, slug });
      }
    }
  }
  return [...seen.values()];
}

/** Boards named in URLs or text: the slug patterns above plus Workday ({slug:'tenant:wdN:Site'}) and Comeet ({slug:'name:uid'}) links. */
export function extractBoards(input) {
  return [...extractAtsSlugs(input), ...extractWorkdayBoards(input), ...extractComeetBoards(input)];
}

export const normName = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');

/** Index tracked companies by every ATS slug they reference and by normalized name. */
export function indexTrackedCompanies(tracked = []) {
  const bySlug = new Map();
  const byName = new Map();
  const put = (key, e) => { if (!bySlug.has(key)) bySlug.set(key, e); };
  for (const e of tracked) {
    if (!e || typeof e !== 'object') continue;
    for (const k of ['careers_url', 'api', 'url']) {
      const v = e[k];
      if (typeof v !== 'string') continue;
      for (const { ats, slug } of extractBoards(v)) {
        put(slug, e);
        if (ats === 'comeet') put(`comeet:${comeetUid(slug)}`, e);
      }
      // a Comeet entry usually points at the positions API, which names the uid but not the branded page
      for (const uid of extractComeetApiUids(v)) put(`comeet:${uid}`, e);
    }
    if (e.name) byName.set(normName(e.name), e);
  }
  return { bySlug, byName };
}

export function findTracked(index, { ats, slug, name }) {
  const uid = ats === 'comeet' ? comeetUid(slug) : '';
  return index.bySlug.get(slug) || (uid && index.bySlug.get(`comeet:${uid}`)) || index.byName.get(normName(slug)) || (name ? index.byName.get(normName(name)) : null) || null;
}

// ── Employer sites that embed Greenhouse ────────────────────────────────────
// A company that runs its careers page on its own domain but posts through
// Greenhouse tags every job link with ?gh_jid=<job id>. The id carries no
// company, but Greenhouse's public embed URL redirects it to the board that
// owns the job (…/embed/job_app?for=<slug>&token=<id>): one request per site.
const GH_JID_RE = /[?&]gh_jid=(\d{5,14})(?:[&#]|$)/;
const GH_HOST_MEMO_DAYS = { found: 180, missed: 30 };

/** First gh_jid job id per host, for links that are not on Greenhouse itself. */
export function embeddedGreenhouseJobs(urls = []) {
  const byHost = new Map();
  for (const u of urls) {
    if (typeof u !== 'string') continue;
    const m = GH_JID_RE.exec(u);
    if (!m) continue;
    let host;
    try { host = new URL(u).hostname.toLowerCase(); } catch { continue; }
    if (!host.includes('.') || /(?:^|\.)greenhouse\.io$/.test(host)) continue;
    if (!byHost.has(host)) byHost.set(host, m[1]);
  }
  return byHost;
}

/**
 * Greenhouse boards behind employer sites that carry gh_jid links.
 * `known` is the memo of earlier lookups ({host: {slug|null, at}}): a hit is kept
 * for 180 days (no request), a miss for 30. Returns { boards, memo } where memo
 * holds the hosts looked up (or reused) in this call.
 */
export async function resolveEmbeddedGreenhouse(urls, { fetchImpl = globalThis.fetch, known = {}, now = Date.now(), max = ATS_EXPLORER_DEFAULTS.max_gh_lookups, timeoutMs = 10000 } = {}) {
  const boards = []; const memo = {};
  let lookups = 0;
  for (const [host, id] of embeddedGreenhouseJobs(urls)) {
    const prev = known[host];
    const age = prev ? (now - Date.parse(prev.at)) / 86400000 : Infinity;
    if (prev?.slug && age < GH_HOST_MEMO_DAYS.found) { boards.push({ ats: 'greenhouse', slug: prev.slug, via: `gh_jid on ${host}` }); memo[host] = prev; continue; }
    if (prev && !prev.slug && age < GH_HOST_MEMO_DAYS.missed) { memo[host] = prev; continue; }
    if (lookups >= max) continue;
    lookups++;
    let slug = null;
    try {
      const r = await fetchImpl(`https://boards.greenhouse.io/embed/job_app?token=${id}`, {
        redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': 'jobyougo-ats-explorer/1.0' },
      });
      const where = r?.headers?.get?.('location') || '';
      slug = ((/[?&]for=([A-Za-z0-9][A-Za-z0-9_-]{1,80})/.exec(where) || [])[1] || '').toLowerCase() || null;
    } catch { /* a site that does not answer is retried after the miss window */ }
    memo[host] = { slug, at: new Date(now).toISOString() };
    if (slug && !RESERVED.has(slug)) boards.push({ ats: 'greenhouse', slug, via: `gh_jid on ${host}` });
  }
  return { boards, memo };
}

// ── Passive input from the scan files ───────────────────────────────────────
// The scan files add up to ~120 MB (scan-decisions.jsonl alone is 115 MB) and
// running every vendor pattern over them blocks for ~10 s. Only the URLs around
// an ATS host (or a gh_jid link) can name a board, so those are cut out first.
const HISTORY_HOST_RE = /(?:ashbyhq\.com|greenhouse\.io|lever\.co|workable\.com|smartrecruiters\.com|recruitee\.com|personio\.(?:de|com)|teamtailor\.com|traffit\.com|dvinci-hr\.com|hirehive\.com|bamboohr\.com|breezy\.hr|pinpointhq\.com|rippling\.com|join\.com|myworkdayjobs\.com|comeet\.(?:com|co))/gi;
const HISTORY_GH_JID_RE = /gh_jid=\d{5,14}/g;
const URL_BREAK = /[\s"'<>\\(),]/;

function grabAround(text, re, out, { left, right }) {
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text))) {
    let a = m.index; let b = m.index + m[0].length;
    const lo = Math.max(0, a - left); const hi = Math.min(text.length, b + right);
    while (a > lo && !URL_BREAK.test(text[a - 1])) a--;
    while (b < hi && !URL_BREAK.test(text[b])) b++;
    out.add(text.slice(a, b));
    re.lastIndex = Math.max(b, m.index + 1);
  }
}

/** URLs naming an ATS board (or carrying a gh_jid) in the scan files of `dataDir`, yielding between files. */
export async function collectHistoryUrls(dataDir) {
  const out = new Set();
  let files = [];
  try { files = await readdir(dataDir); } catch { return []; }
  for (const f of files) {
    if (!/\.(jsonl|md|tsv)$/.test(f) || f === 'discovered-companies.jsonl') continue;
    let text = '';
    try { text = await readFile(join(dataDir, f), 'utf8'); } catch { continue; }
    grabAround(text, HISTORY_HOST_RE, out, { left: 120, right: 240 });
    grabAround(text, HISTORY_GH_JID_RE, out, { left: 400, right: 120 });
    await new Promise((resolve) => setImmediate(resolve));
  }
  return [...out];
}

// ── Exclusions ──────────────────────────────────────────────────────────────
const AGENCY_SLUGS = new Set(['huzzle', 'jobrack', 'pavago', 'remotebase', 'remote-recruitment', 'workana-premium', 'medvirtual',
  'hirehire', 'jobgether', 'weloglobal', 'worksterjobs', 'nexton', 'gofasti', 'humansignal', 'turing', 'toptal', 'crossover',
  'andela', 'braintrust-talent', 'outlier', 'mercor', 'micro1', 'dataannotation', 'remote', 'remoteok', 'wellfound']);
const AGENCY_NAME_RE = /\b(recruit\w*|staffing|headhunt\w*|talent (?:solutions|partners|agency|network)|executive search|job ?board|jobs? (?:portal|network)|placement|outsourc\w*|virtual assistants?|employer of record)\b/i;
const AMBIGUOUS_SLUG_RE = /^(?:[a-z]{1,2}|\d+|test\w*|demo\w*|\w*demo-?\d*|template\w*|sandbox\w*|capital|visit|jobs?|careers?|hiring|team|company|general|referrals?\w*)$/i;
const OFF_PROFILE_NAME_RE = /\b(semiconductor|foundry|construction|bauunternehmen|btp|mining|oil ?& ?gas|defen[cs]e systems|aerospace|shipyard|hospital|clinic)\b/i;
const HARDWARE_TITLE_RE = /\b(asic|rtl|fpga|pcb|analog|mixed[- ]signal|silicon|photonic|cryogenic|mechanical|electrical engineer|hardware|firmware|avionics|propulsion|manufacturing|technician|warehouse|forklift|driver|nurse|physician|clinician|pharmacist|construction|site supervisor|welder|machinist|cnc|hvac|plumber|electrician|store (?:manager|associate)|cashier|chef|cook)\b/i;
export const TECH_TITLE_RE = /\b(engineer\w*|engineering|developer|software|swe|sre|devops|platform|backend|back-end|frontend|front-end|full[- ]?stack|mobile|ios|android|web|cloud|infrastructure|security|data|analytics|machine learning|ml|ai|llm|research scientist|scientist|architect|qa|test automation|product|design\w*|ux|ui|it|sysadmin|system administrator|technical|tech lead|cto)\b/i;

/**
 * Decide whether a verified board qualifies. Returns { ok, reason, techCount }.
 */
const escapeWord = (w) => String(w).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordIn = (text, words) => words.some((w) => w && new RegExp(`(?:^|[^a-z])${escapeWord(w)}(?:[^a-z]|$)`).test(text));

/**
 * Whether a posting's location text can be worked from the profile's geography
 * (geoPolicyFrom): reachable unless it names a rejected place ("US only",
 * "Latin America") and nothing the profile may work from. No location text,
 * or no policy, never rejects.
 */
export function locationReachable(location, geoPolicy) {
  const text = String(location || '').toLowerCase().trim();
  if (!text || !geoPolicy) return true;
  if (wordIn(text, geoPolicy.allowed || [])) return true;
  return !wordIn(text, geoPolicy.rejected || []);
}

/**
 * A board whose relevant postings all carry a location the profile cannot work
 * from is out of reach. Needs at least two located postings to say so, so one
 * odd row never rejects a company.
 */
function geoVerdict(indexes, locations, geoPolicy) {
  if (!geoPolicy || !locations?.length) return null;
  const located = indexes.map((i) => locations[i]).filter((l) => String(l || '').trim());
  if (located.length < 2) return null;
  return located.some((l) => locationReachable(l, geoPolicy)) ? null : { ok: false, reason: 'no_reachable_location' };
}

export function classifyCandidate({ slug, name = '', titles = [], minRoles = 1, titleFilter = null, locations = [], geoPolicy = null }) {
  if (AGENCY_SLUGS.has(slug) || AGENCY_NAME_RE.test(name)) return { ok: false, reason: 'agency_or_job_board' };
  if (AMBIGUOUS_SLUG_RE.test(slug)) return { ok: false, reason: 'ambiguous_slug' };
  if (!titles.length || titles.length < minRoles) return { ok: false, reason: 'empty_board' };
  if (titleFilter) {
    // Profile mode: a title counts when the account's own title gate accepts it,
    // so a non-tech profile is not judged by the tech/product list.
    const gate = {
      positive: titleFilter.positive, positive_patterns: titleFilter.positive_patterns,
      negative: titleFilter.negative, negative_patterns: titleFilter.negative_patterns,
    };
    const idx = titles.map((t, i) => (explainTitle(t, gate).ok ? i : -1)).filter((i) => i >= 0);
    const hit = idx.length;
    if (!hit || (hit < 3 && hit / titles.length < 0.1)) return { ok: false, reason: 'no_matching_role', techCount: hit };
    const geo = geoVerdict(idx, locations, geoPolicy);
    return geo ? { ...geo, techCount: hit } : { ok: true, reason: 'ok', techCount: hit };
  }
  if (OFF_PROFILE_NAME_RE.test(name)) return { ok: false, reason: 'off_profile_sector' };
  const hw = titles.filter(t => HARDWARE_TITLE_RE.test(t)).length;
  const tech = titles.filter(t => TECH_TITLE_RE.test(t) && !HARDWARE_TITLE_RE.test(t)).length;
  if (titles.length >= 3 && hw / titles.length >= 0.5) return { ok: false, reason: 'off_profile_sector', techCount: tech };
  if (!tech) return { ok: false, reason: 'no_tech_product_role', techCount: 0 };
  // a big non-tech board (retail, field ops) with one stray tech title is off profile
  if (tech < 3 && tech / titles.length < 0.1) return { ok: false, reason: 'no_tech_product_role', techCount: tech };
  const idx = titles.map((t, i) => (TECH_TITLE_RE.test(t) && !HARDWARE_TITLE_RE.test(t) ? i : -1)).filter((i) => i >= 0);
  const geo = geoVerdict(idx, locations, geoPolicy);
  return geo ? { ...geo, techCount: tech } : { ok: true, reason: 'ok', techCount: tech };
}

// ── Board verification (public, read-only endpoints) ────────────────────────
// One pass, so "&amp;lt;" reads "&lt;" and not "<"; named, decimal and hex entities ("J&amp;B", "&#39;", "&#x27;").
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(s) {
  return String(s).replace(/&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));/gi, (match, hex, dec, named) => {
    if (named) return NAMED_ENTITIES[named.toLowerCase()] ?? match;
    const code = hex ? parseInt(hex, 16) : Number(dec);
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

export function boardEndpoints(ats, slug) {
  const s = encodeURIComponent(slug);
  switch (ats) {
    case 'ashby': return { careers_url: `https://jobs.ashbyhq.com/${s}`, api: `https://api.ashbyhq.com/posting-api/job-board/${s}` };
    case 'greenhouse': return { careers_url: `https://job-boards.greenhouse.io/${s}`, api: `https://boards-api.greenhouse.io/v1/boards/${s}/jobs` };
    case 'lever': return { careers_url: `https://jobs.lever.co/${s}`, api: `https://api.lever.co/v0/postings/${s}?mode=json` };
    case 'workable': return { careers_url: `https://apply.workable.com/${s}/`, probe: `https://apply.workable.com/api/v1/widget/accounts/${s}` };
    case 'smartrecruiters': return { careers_url: `https://careers.smartrecruiters.com/${s}`, provider: 'smartrecruiters', probe: `https://api.smartrecruiters.com/v1/companies/${s}/postings` };
    case 'recruitee': return { careers_url: `https://${s}.recruitee.com`, probe: `https://${s}.recruitee.com/api/offers/` };
    case 'personio': return { careers_url: `https://${s}.jobs.personio.de/`, probe: `https://${s}.jobs.personio.de/xml` };
    case 'teamtailor': return { careers_url: `https://${s}.teamtailor.com/jobs`, probe: `https://${s}.teamtailor.com/jobs.rss` };
    case 'traffit': return { careers_url: `https://${s}.traffit.com/career/`, probe: `https://${s}.traffit.com/public/job_posts/published` };
    case 'dvinci': return { careers_url: `https://${s}.dvinci-hr.com/`, probe: `https://${s}.dvinci-hr.com/jobPublication/list.json` };
    case 'hirehive': return { careers_url: `https://${s}.hirehive.com/`, probe: `https://${s}.hirehive.com/api/v2/jobs?page=1&page_size=100` };
    default: return providerBoardEndpoints(ats, slug);
  }
}

/** Fetch a board and return { status, name, titles }. `fetchImpl` is injectable for tests. */
export async function verifyBoard({ ats, slug }, { fetchImpl = globalThis.fetch, timeoutMs = 15000, providers = null } = {}) {
  const ep = boardEndpoints(ats, slug);
  if (!ep) return { status: 0, titles: [], name: null };
  // Comeet: token and uid come from the branded page, then the positions API answers.
  if (ats === 'comeet') return verifyComeetBoard({ slug }, { fetchImpl, timeoutMs });
  // BambooHR, Breezy, Pinpoint, Rippling, JOIN, Workday: read through their providers/ plugin.
  if (PROVIDER_BOARD_ATS.includes(ats)) return verifyBoardViaProvider({ ats, slug }, { providers });
  const url = ep.api || ep.probe;
  const get = async (u) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const headers = { 'User-Agent': 'jobyougo-ats-explorer/1.0', Accept: 'application/json, text/xml, */*' };
      if (ats === 'traffit') { headers['X-Request-Page-Size'] = '100'; headers['X-Request-Current-Page'] = '1'; }
      const r = await fetchImpl(u, { signal: ctrl.signal, headers, redirect: 'follow' });
      return { status: r.status, text: r.status === 200 ? await r.text() : '' };
    } catch { return { status: 0, text: '' }; } finally { clearTimeout(timer); }
  };
  const { status, text } = await get(url);
  if (status !== 200) return { status, titles: [], name: null, sample: '' };
  let titles = []; let name = null;
  let locs = []; // location text per posting, same order as titles; [] when the vendor gives none
  const place = (...parts) => parts.filter(x => typeof x === 'string' && x.trim()).join(', ');
  // Lever and Ashby boards carry no company name: the first postings' own text
  // is the only way to tell whose board a guessed slug points at.
  let sample = '';
  const sampleOf = (jobs, keys) => (Array.isArray(jobs) ? jobs : []).slice(0, 3)
    .map(x => keys.map(k => (typeof x?.[k] === 'string' ? x[k] : '')).join(' ')).join(' ').slice(0, 20000);
  try {
    if (ats === 'personio') {
      titles = [...text.matchAll(/<position>[\s\S]*?<name>([\s\S]*?)<\/name>/g)].map(m => decodeEntities(m[1].trim()));
      const sub = (text.match(/<subcompany>([^<]+)<\/subcompany>/) || [])[1];
      name = sub ? decodeEntities(sub) : null;
    } else if (ats === 'teamtailor') {
      titles = [...text.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>/g)].map(m => decodeEntities(m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim()));
      name = decodeEntities(((text.match(/<channel>[\s\S]*?<title>([\s\S]*?)<\/title>/) || [])[1] || '').replace(/<!\[CDATA\[|\]\]>/g, '').trim()) || null;
    } else {
      const j = JSON.parse(text);
      if (ats === 'ashby') { titles = (j.jobs || []).map(x => x.title); locs = (j.jobs || []).map(x => place(x.location, x.isRemote ? 'remote' : '')); sample = sampleOf(j.jobs, ['descriptionPlain']); }
      else if (ats === 'greenhouse') { titles = (j.jobs || []).map(x => x.title); locs = (j.jobs || []).map(x => place(x.location?.name)); }
      else if (ats === 'lever') { titles = (Array.isArray(j) ? j : []).map(x => x.text); locs = (Array.isArray(j) ? j : []).map(x => place(x.categories?.location, x.workplaceType === 'remote' ? 'remote' : '')); sample = sampleOf(j, ['descriptionPlain', 'additionalPlain']); }
      else if (ats === 'workable') { titles = (j.jobs || []).map(x => x.title); locs = (j.jobs || []).map(x => place(x.city, x.state, x.country, x.telecommuting ? 'remote' : '')); name = j.name || null; }
      else if (ats === 'smartrecruiters') { titles = (j.content || []).map(x => x.name); locs = (j.content || []).map(x => place(x.location?.city, x.location?.country, x.location?.remote ? 'remote' : '')); name = j.content?.[0]?.company?.name || null; }
      else if (ats === 'recruitee') { titles = (j.offers || []).map(x => x.title); locs = (j.offers || []).map(x => place(x.city, x.country, x.remote ? 'remote' : '')); name = j.offers?.[0]?.company_name || null; }
      else if (ats === 'traffit') titles = (Array.isArray(j) ? j : []).filter(x => x && x.awarded !== true).map(x => x.advert?.name);
      else if (ats === 'dvinci') titles = (Array.isArray(j) ? j : []).map(x => x?.position);
      else if (ats === 'hirehive') titles = (Array.isArray(j?.items) ? j.items : []).map(x => x?.title);
    }
  } catch { return { status: 200, titles: [], locations: [], name: null, sample: '', parseError: true }; }
  if (!name && ats === 'ashby') {
    const page = await get(`https://jobs.ashbyhq.com/${encodeURIComponent(slug)}`);
    const t = (page.text.match(/<title>([^<]+)<\/title>/i) || [])[1];
    name = t ? decodeEntities(t).replace(/\s*(?:jobs|careers)\s*$/i, '').trim() || null : null;
  }
  if (!name && ats === 'greenhouse') {
    const meta = await get(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}`);
    try { name = meta.status === 200 ? JSON.parse(meta.text).name || null : null; } catch { /* ignore */ }
  }
  const kept = titles.map((t, i) => [t, locs[i] || '']).filter(([t]) => typeof t === 'string' && t.trim());
  return { status, titles: kept.map(([t]) => t), locations: locs.length ? kept.map(([, l]) => l) : [], name: name ? String(name).trim() : null, sample };
}

export function displayName(name, slug) {
  let n = decodeEntities(String(name || '')).replace(/\s*\((?:an? [^)]*company|yc [^)]*)\)\s*/gi, ' ')
    .replace(/^careers at\s+/i, '').replace(/\s+(careers|jobs|job board)$/i, '').replace(/[\u200e\u200f]/g, '').replace(/\s+/g, ' ').trim();
  // A Workday slug ("tenant:wdN:Site") and a Comeet slug ("name:uid") name the company in their first part only.
  if (!n || /^jobs?$/i.test(n)) n = String(slug).split(':')[0].replace(/%20/g, ' ').replace(/[-_.]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
  return n;
}

// ── portals.yml writing ─────────────────────────────────────────────────────
function yamlScalar(s) {
  const v = String(s);
  return /^[A-Za-z0-9 .,'()&/+@-]+$/.test(v) && !/^[-?:,\[\]{}#&*!|>'"%@`]/.test(v) && !/: |\s#/.test(v) ? v : JSON.stringify(v);
}

export function renderEntries(entries, eol = '\n') {
  const lines = [];
  for (const e of entries) {
    lines.push(`  - name: ${yamlScalar(e.name)}`);
    lines.push(`    careers_url: ${e.careers_url}`);
    if (e.api) lines.push(`    api: ${e.api}`);
    if (e.provider) lines.push(`    provider: ${e.provider}`);
    lines.push(`    notes: ${yamlScalar(e.notes)}`);
    lines.push('    enabled: true');
  }
  return lines.join(eol) + eol;
}

/** Insert rendered entries at the end of the tracked_companies block (text-level, comments kept). */
export function insertIntoTrackedCompanies(text, block) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const start = text.search(/^tracked_companies:[ \t]*$/m);
  if (start === -1) throw new Error('tracked_companies: section not found');
  const after = text.slice(start).search(/\n(?=[A-Za-z_][\w-]*:)/);
  const end = after === -1 ? text.length : start + after + 1;
  let head = text.slice(0, end);
  const tail = text.slice(end);
  head = head.replace(/(\r?\n)*$/, '') + eol;
  return head + block.replace(/\r?\n/g, eol) + (tail ? eol : '') + tail;
}

export function acquireLock(lockPath, { staleMs = 120000 } = {}) {
  try {
    const fd = openSync(lockPath, 'wx'); closeSync(fd); return true;
  } catch {
    try { if (Date.now() - statSync(lockPath).mtimeMs > staleMs) { unlinkSync(lockPath); const fd = openSync(lockPath, 'wx'); closeSync(fd); return true; } } catch { /* busy */ }
    return false;
  }
}

/**
 * Append entries to portals.yml: lock, re-read, re-dedupe, backup, atomic rename.
 * Returns { added: [...], skipped: [...], backupPath }.
 */
export function appendCompaniesToPortals(portalsPath, entries, { now = new Date(), dryRun = false } = {}) {
  if (!entries.length) return { added: [], skipped: [], backupPath: null };
  const lockPath = `${portalsPath}.explorer.lock`;
  if (!dryRun && !acquireLock(lockPath)) return { added: [], skipped: entries.map(e => ({ ...e, reason: 'portals_locked' })), backupPath: null };
  try {
    const text = readFileSync(portalsPath, 'utf8');
    const parsed = yamlLoad(text) || {};
    const index = indexTrackedCompanies(parsed.tracked_companies || []);
    const fresh = []; const skipped = [];
    for (const e of entries) {
      if (findTracked(index, { ats: e.ats, slug: e.slug, name: e.name })) { skipped.push({ ...e, reason: 'already_tracked' }); continue; }
      fresh.push(e); index.byName.set(normName(e.name), e); index.bySlug.set(e.slug, e);
    }
    if (!fresh.length || dryRun) return { added: dryRun ? fresh : [], skipped, backupPath: null };
    const next = insertIntoTrackedCompanies(text, renderEntries(fresh));
    const check = yamlLoad(next);
    if (!Array.isArray(check?.tracked_companies) || check.tracked_companies.length !== (parsed.tracked_companies || []).length + fresh.length) {
      throw new Error('portals.yml insert check failed - file left untouched');
    }
    const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
    const backupPath = `${portalsPath}.bak-explorer-${stamp}`;
    copyFileSync(portalsPath, backupPath);
    const tmp = `${portalsPath}.explorer.tmp`;
    writeFileSync(tmp, next, 'utf8');
    renameSync(tmp, portalsPath);
    return { added: fresh, skipped, backupPath };
  } finally {
    if (!dryRun) { try { unlinkSync(lockPath); } catch { /* already gone */ } }
  }
}

// ── Orchestration ───────────────────────────────────────────────────────────
export function resolveExplorerConfig(config = {}, env = process.env) {
  const c = { ...ATS_EXPLORER_DEFAULTS, ...(config?.ats_explorer || {}) };
  if (/^(0|false|off|no)$/i.test(env.ATS_EXPLORER || '')) c.enabled = false;
  if (/^(0|false|off|no)$/i.test(env.ATS_EXPLORER_ACTIVE || '')) c.active = false;
  for (const [k, ek] of [['max_queries', 'ATS_EXPLORER_MAX_QUERIES'], ['max_add', 'ATS_EXPLORER_MAX_ADD'], ['max_verify', 'ATS_EXPLORER_MAX_VERIFY'], ['min_roles', 'ATS_EXPLORER_MIN_ROLES']]) {
    const v = Number.parseInt(env[ek] ?? '', 10);
    if (Number.isFinite(v) && v >= 0) c[k] = v;
  }
  c.enabled = c.enabled !== false;
  c.active = c.active !== false;
  return c;
}

function readState(path) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return {}; } }

/**
 * Run one explorer pass.
 * @param {object} o
 * @param {string} o.portalsPath
 * @param {string} o.dataDir           where discovered-companies.jsonl / ats-explorer-state.json live
 * @param {string[]} [o.offerUrls]     passive input (URLs seen this run)
 * @param {(query:string)=>Promise<{urls?:string[], text?:string, blocked?:boolean}>} [o.search]
 *        active input: the caller's existing engine. Omit to stay passive.
 */
export async function runAtsExplorer({
  portalsPath, dataDir, offerUrls = [], search = null, config = {}, env = process.env,
  fetchImpl = globalThis.fetch, log = console.log, now = new Date(), dryRun = false, geoPolicy = null,
} = {}) {
  const cfg = resolveExplorerConfig(config, env);
  const summary = { queries: 0, blocked: 0, found: 0, verified: 0, added: 0, skipped: 0, addedNames: [], backupPath: null, disabled: false };
  if (!cfg.enabled) { summary.disabled = true; log('[scan] [explorer] disabled (ats_explorer.enabled=false or ATS_EXPLORER=0)'); return summary; }
  const statePath = join(dataDir, 'ats-explorer-state.json');
  const state = readState(statePath);
  const origin = new Map(); // key -> query or 'scan'

  for (const c of extractBoards(offerUrls)) origin.set(`${c.ats}|${c.slug}`, { ...c, via: 'scan offers' });

  let nextCursor = state.cursor || 0;
  const searchedUrls = []; // results of the active queries, also read for gh_jid links
  if (search && cfg.active && cfg.max_queries > 0) {
    const { queries, nextCursor: nc } = buildExplorerQueries({ cursor: state.cursor || 0, budget: cfg.max_queries, terms: explorerTerms(config), sites: config?.ats_explorer?.longtail_queries === true ? [...EXPLORER_SITES, ...EXPLORER_LONGTAIL_SITES] : EXPLORER_SITES });
    nextCursor = nc;
    for (const q of queries) {
      summary.queries++;
      let res;
      try { res = await search(q); } catch (err) { res = { blocked: true, error: err.message }; }
      if (res?.blocked) { summary.blocked++; log(`[scan] [explorer] engine blocked/paused on "${q}" - stopping active queries for this run`); break; }
      searchedUrls.push(...(res?.urls || []));
      for (const c of extractBoards([...(res?.urls || []), res?.text || ''])) {
        const k = `${c.ats}|${c.slug}`;
        if (!origin.has(k)) origin.set(k, { ...c, via: q });
      }
    }
  }

  // Employer sites that post through Greenhouse behind their own domain (gh_jid links).
  let ghHosts = state.ghHosts || {};
  if (cfg.embedded_greenhouse !== false && cfg.max_gh_lookups > 0) {
    const gh = await resolveEmbeddedGreenhouse([...offerUrls, ...searchedUrls], { fetchImpl, known: ghHosts, now: now.getTime(), max: cfg.max_gh_lookups });
    ghHosts = { ...ghHosts, ...gh.memo };
    for (const c of gh.boards) {
      const k = `${c.ats}|${c.slug}`;
      if (!origin.has(k)) origin.set(k, c);
    }
  }

  const text = readFileSync(portalsPath, 'utf8');
  const parsed = yamlLoad(text) || {};
  const index = indexTrackedCompanies(parsed.tracked_companies || []);
  const rejected = state.rejected || {};
  // permanent exclusions (manual review: agencies, off-profile, ambiguous) - never re-checked
  const excluded = new Set([...(state.excluded || []), ...((cfg.exclude || []).map(String))].map(x => x.toLowerCase()));
  const fresh = [...origin.values()].filter(c => {
    if (findTracked(index, c)) return false;
    if (excluded.has(`${c.ats}|${c.slug}`.toLowerCase()) || excluded.has(c.slug.toLowerCase())) return false;
    const r = rejected[`${c.ats}|${c.slug}`];
    return !(r && Date.now() - Date.parse(r) < 14 * 86400000); // re-check rejected boards after 14 days
  });
  summary.found = fresh.length;

  const date = now.toISOString().slice(0, 10);
  // A profile-filled config (portalsForProfile) carries the account's own role
  // positives: judge boards by them. A raw config keeps the tech/product list.
  const tf = config?.title_filter || {};
  const profileGate = (Array.isArray(tf.positive) && tf.positive.length) || (Array.isArray(tf.positive_patterns) && tf.positive_patterns.length) ? tf : null;
  const accepted = []; const records = [];
  for (const c of fresh.slice(0, cfg.max_verify)) {
    if (accepted.length >= cfg.max_add) break;
    const v = await verifyBoard(c, { fetchImpl });
    summary.verified++;
    let verdict;
    if (v.status !== 200) verdict = { ok: false, reason: `http_${v.status || 'error'}` };
    else verdict = classifyCandidate({ slug: c.slug, name: v.name || '', titles: v.titles, minRoles: cfg.min_roles, titleFilter: profileGate, locations: v.locations, geoPolicy });
    const name = displayName(v.name, c.slug);
    if (verdict.ok && findTracked(index, { ats: c.ats, slug: c.slug, name })) verdict = { ok: false, reason: 'already_tracked' };
    records.push({ ts: now.toISOString(), ats: c.ats, slug: c.slug, name, via: c.via, status: v.status, open_roles: v.titles.length, tech_roles: verdict.techCount ?? 0, decision: verdict.ok ? 'added' : 'skipped', reason: verdict.reason });
    if (!verdict.ok) { summary.skipped++; rejected[`${c.ats}|${c.slug}`] = now.toISOString(); continue; }
    const ep = boardEndpoints(c.ats, c.slug);
    // api: the vendor's endpoint, or (Comeet) the positions URL the verification just read
    accepted.push({ ats: c.ats, slug: c.slug, name, careers_url: ep.careers_url, api: ep.api || v.api, provider: ep.provider,
      notes: `auto-explored ${date} via ${c.via} - public ${c.ats} board verified live; ${v.titles.length} open roles (${verdict.techCount} ${profileGate ? 'matching the profile' : 'tech/product'}).` });
    index.byName.set(normName(name), {}); index.bySlug.set(c.slug, {});
  }

  const res = appendCompaniesToPortals(portalsPath, accepted, { now, dryRun });
  summary.added = res.added.length;
  summary.addedNames = res.added.map(e => e.name);
  summary.backupPath = res.backupPath;
  summary.skipped += res.skipped.length;
  for (const s of res.skipped) { const r = records.find(x => x.slug === s.slug); if (r) { r.decision = 'skipped'; r.reason = s.reason; } }

  if (!dryRun) {
    mkdirSync(dataDir, { recursive: true });
    if (records.length) appendFileSync(join(dataDir, 'discovered-companies.jsonl'), records.map(r => JSON.stringify(r)).join('\n') + '\n');
    const keep = Object.fromEntries(Object.entries(rejected).filter(([, t]) => Date.now() - Date.parse(t) < 30 * 86400000));
    ghHosts = Object.fromEntries(Object.entries(ghHosts).filter(([, h]) => now.getTime() - Date.parse(h?.at) < GH_HOST_MEMO_DAYS.found * 86400000));
    const tmp = `${statePath}.tmp`;
    writeFileSync(tmp, JSON.stringify({ cursor: nextCursor, lastRun: now.toISOString(), excluded: state.excluded || [], rejected: keep, ghHosts }, null, 2));
    renameSync(tmp, statePath);
  }
  log(`[scan] [explorer] queries=${summary.queries} found=${summary.found} added=${summary.added} skipped=${summary.skipped}${summary.blocked ? ' engine=blocked' : ''}${summary.addedNames.length ? ` (${summary.addedNames.join(', ')})` : ''}`);
  summary.records = records;
  return summary;
}


// Sanctioned search APIs (opt-in by key) for runs outside the UI scan engine.
export function makeApiSearch(env = process.env, fetchImpl = globalThis.fetch) {
  if (env.BRAVE_API_KEY) {
    return async (q) => {
      const r = await fetchImpl(`https://api.search.brave.com/res/v1/web/search?count=20&q=${encodeURIComponent(q)}`, { headers: { Accept: 'application/json', 'X-Subscription-Token': env.BRAVE_API_KEY } });
      if (r.status === 429 || r.status === 403) return { blocked: true };
      if (r.status !== 200) return { urls: [] };
      const j = await r.json();
      return { urls: (j.web?.results || []).map(x => x.url) };
    };
  }
  if (env.SEARCHAPI_KEY) {
    return async (q) => {
      const r = await fetchImpl(`https://www.searchapi.io/api/v1/search?engine=google&num=20&q=${encodeURIComponent(q)}&api_key=${encodeURIComponent(env.SEARCHAPI_KEY)}`);
      if (r.status === 429 || r.status === 403 || r.status === 402) return { blocked: true };
      if (r.status !== 200) return { urls: [] };
      const j = await r.json();
      return { urls: (j.organic_results || []).map(x => x.link) };
    };
  }
  return null;
}

