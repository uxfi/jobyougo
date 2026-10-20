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
import { join } from 'node:path';
import { load as yamlLoad } from 'js-yaml';

export const ATS_EXPLORER_DEFAULTS = Object.freeze({
  enabled: true,
  max_queries: 6,      // web queries per run (keeps pressure on blocked engines low)
  max_add: 10,         // companies added per run
  max_verify: 40,      // board endpoints checked per run
  min_roles: 2,        // a board with fewer open roles is treated as empty
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

export function buildExplorerQueries({ cursor = 0, budget = ATS_EXPLORER_DEFAULTS.max_queries } = {}) {
  const all = [];
  for (const term of EXPLORER_ROLE_TERMS) for (const site of EXPLORER_SITES) all.push(`site:${site} ${term}`);
  // interleave sites so one run spreads across ATS: order by (termIdx + siteIdx) walk
  const out = [];
  const n = Math.max(0, Math.min(budget, all.length));
  for (let i = 0; i < n; i++) {
    const k = (cursor + i) % all.length;
    const site = EXPLORER_SITES[k % EXPLORER_SITES.length];
    const term = EXPLORER_ROLE_TERMS[Math.floor(k / EXPLORER_SITES.length) % EXPLORER_ROLE_TERMS.length];
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
];
// vendor hosts (not tenants) per ATS, on top of RESERVED
const ATS_RESERVED = {
  traffit: new Set(['cdn3', 'knowledge']),
  dvinci: new Set(['static']),
  hirehive: new Set(['status', 'docs']),
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

export const normName = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');

/** Index tracked companies by every ATS slug they reference and by normalized name. */
export function indexTrackedCompanies(tracked = []) {
  const bySlug = new Map();
  const byName = new Map();
  for (const e of tracked) {
    if (!e || typeof e !== 'object') continue;
    for (const k of ['careers_url', 'api', 'url']) {
      const v = e[k];
      if (typeof v !== 'string') continue;
      for (const { slug } of extractAtsSlugs(v)) if (!bySlug.has(slug)) bySlug.set(slug, e);
    }
    if (e.name) byName.set(normName(e.name), e);
  }
  return { bySlug, byName };
}

export function findTracked(index, { slug, name }) {
  return index.bySlug.get(slug) || index.byName.get(normName(slug)) || (name ? index.byName.get(normName(name)) : null) || null;
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
export function classifyCandidate({ slug, name = '', titles = [], minRoles = 1 }) {
  if (AGENCY_SLUGS.has(slug) || AGENCY_NAME_RE.test(name)) return { ok: false, reason: 'agency_or_job_board' };
  if (AMBIGUOUS_SLUG_RE.test(slug)) return { ok: false, reason: 'ambiguous_slug' };
  if (!titles.length || titles.length < minRoles) return { ok: false, reason: 'empty_board' };
  if (OFF_PROFILE_NAME_RE.test(name)) return { ok: false, reason: 'off_profile_sector' };
  const hw = titles.filter(t => HARDWARE_TITLE_RE.test(t)).length;
  const tech = titles.filter(t => TECH_TITLE_RE.test(t) && !HARDWARE_TITLE_RE.test(t)).length;
  if (titles.length >= 3 && hw / titles.length >= 0.5) return { ok: false, reason: 'off_profile_sector', techCount: tech };
  if (!tech) return { ok: false, reason: 'no_tech_product_role', techCount: 0 };
  // a big non-tech board (retail, field ops) with one stray tech title is off profile
  if (tech < 3 && tech / titles.length < 0.1) return { ok: false, reason: 'no_tech_product_role', techCount: tech };
  return { ok: true, reason: 'ok', techCount: tech };
}

// ── Board verification (public, read-only endpoints) ────────────────────────
function decodeEntities(s) {
  return String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
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
    default: return null;
  }
}

/** Fetch a board and return { status, name, titles }. `fetchImpl` is injectable for tests. */
export async function verifyBoard({ ats, slug }, { fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
  const ep = boardEndpoints(ats, slug);
  if (!ep) return { status: 0, titles: [], name: null };
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
  if (status !== 200) return { status, titles: [], name: null };
  let titles = []; let name = null;
  try {
    if (ats === 'personio') {
      titles = [...text.matchAll(/<position>[\s\S]*?<name>([\s\S]*?)<\/name>/g)].map(m => decodeEntities(m[1].trim()));
      name = (text.match(/<subcompany>([^<]+)<\/subcompany>/) || [])[1] || null;
    } else if (ats === 'teamtailor') {
      titles = [...text.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>/g)].map(m => decodeEntities(m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim()));
      name = ((text.match(/<channel>[\s\S]*?<title>([\s\S]*?)<\/title>/) || [])[1] || '').replace(/<!\[CDATA\[|\]\]>/g, '').trim() || null;
    } else {
      const j = JSON.parse(text);
      if (ats === 'ashby') titles = (j.jobs || []).map(x => x.title);
      else if (ats === 'greenhouse') titles = (j.jobs || []).map(x => x.title);
      else if (ats === 'lever') titles = (Array.isArray(j) ? j : []).map(x => x.text);
      else if (ats === 'workable') { titles = (j.jobs || []).map(x => x.title); name = j.name || null; }
      else if (ats === 'smartrecruiters') { titles = (j.content || []).map(x => x.name); name = j.content?.[0]?.company?.name || null; }
      else if (ats === 'recruitee') { titles = (j.offers || []).map(x => x.title); name = j.offers?.[0]?.company_name || null; }
      else if (ats === 'traffit') titles = (Array.isArray(j) ? j : []).filter(x => x && x.awarded !== true).map(x => x.advert?.name);
      else if (ats === 'dvinci') titles = (Array.isArray(j) ? j : []).map(x => x?.position);
      else if (ats === 'hirehive') titles = (Array.isArray(j?.items) ? j.items : []).map(x => x?.title);
    }
  } catch { return { status: 200, titles: [], name: null, parseError: true }; }
  if (!name && ats === 'ashby') {
    const page = await get(`https://jobs.ashbyhq.com/${encodeURIComponent(slug)}`);
    const t = (page.text.match(/<title>([^<]+)<\/title>/i) || [])[1];
    name = t ? decodeEntities(t).replace(/\s*(?:jobs|careers)\s*$/i, '').trim() || null : null;
  }
  if (!name && ats === 'greenhouse') {
    const meta = await get(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}`);
    try { name = meta.status === 200 ? JSON.parse(meta.text).name || null : null; } catch { /* ignore */ }
  }
  return { status, titles: titles.filter(t => typeof t === 'string' && t.trim()), name: name ? String(name).trim() : null };
}

export function displayName(name, slug) {
  let n = String(name || '').replace(/\s*\((?:an? [^)]*company|yc [^)]*)\)\s*/gi, ' ')
    .replace(/^careers at\s+/i, '').replace(/\s+(careers|jobs|job board)$/i, '').replace(/[\u200e\u200f]/g, '').replace(/\s+/g, ' ').trim();
  if (!n || /^jobs?$/i.test(n)) n = slug.replace(/%20/g, ' ').replace(/[-_.]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
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

function acquireLock(lockPath, { staleMs = 120000 } = {}) {
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
      if (findTracked(index, { slug: e.slug, name: e.name })) { skipped.push({ ...e, reason: 'already_tracked' }); continue; }
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
  fetchImpl = globalThis.fetch, log = console.log, now = new Date(), dryRun = false,
} = {}) {
  const cfg = resolveExplorerConfig(config, env);
  const summary = { queries: 0, blocked: 0, found: 0, verified: 0, added: 0, skipped: 0, addedNames: [], backupPath: null, disabled: false };
  if (!cfg.enabled) { summary.disabled = true; log('[scan] [explorer] disabled (ats_explorer.enabled=false or ATS_EXPLORER=0)'); return summary; }
  const statePath = join(dataDir, 'ats-explorer-state.json');
  const state = readState(statePath);
  const origin = new Map(); // key -> query or 'scan'

  for (const c of extractAtsSlugs(offerUrls)) origin.set(`${c.ats}|${c.slug}`, { ...c, via: 'scan offers' });

  let nextCursor = state.cursor || 0;
  if (search && cfg.active && cfg.max_queries > 0) {
    const { queries, nextCursor: nc } = buildExplorerQueries({ cursor: state.cursor || 0, budget: cfg.max_queries });
    nextCursor = nc;
    for (const q of queries) {
      summary.queries++;
      let res;
      try { res = await search(q); } catch (err) { res = { blocked: true, error: err.message }; }
      if (res?.blocked) { summary.blocked++; log(`[scan] [explorer] engine blocked/paused on "${q}" - stopping active queries for this run`); break; }
      for (const c of extractAtsSlugs([...(res?.urls || []), res?.text || ''])) {
        const k = `${c.ats}|${c.slug}`;
        if (!origin.has(k)) origin.set(k, { ...c, via: q });
      }
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
    if (excluded.has(`${c.ats}|${c.slug}`) || excluded.has(c.slug)) return false;
    const r = rejected[`${c.ats}|${c.slug}`];
    return !(r && Date.now() - Date.parse(r) < 14 * 86400000); // re-check rejected boards after 14 days
  });
  summary.found = fresh.length;

  const date = now.toISOString().slice(0, 10);
  const accepted = []; const records = [];
  for (const c of fresh.slice(0, cfg.max_verify)) {
    if (accepted.length >= cfg.max_add) break;
    const v = await verifyBoard(c, { fetchImpl });
    summary.verified++;
    let verdict;
    if (v.status !== 200) verdict = { ok: false, reason: `http_${v.status || 'error'}` };
    else verdict = classifyCandidate({ slug: c.slug, name: v.name || '', titles: v.titles, minRoles: cfg.min_roles });
    const name = displayName(v.name, c.slug);
    if (verdict.ok && findTracked(index, { slug: c.slug, name })) verdict = { ok: false, reason: 'already_tracked' };
    records.push({ ts: now.toISOString(), ats: c.ats, slug: c.slug, name, via: c.via, status: v.status, open_roles: v.titles.length, tech_roles: verdict.techCount ?? 0, decision: verdict.ok ? 'added' : 'skipped', reason: verdict.reason });
    if (!verdict.ok) { summary.skipped++; rejected[`${c.ats}|${c.slug}`] = now.toISOString(); continue; }
    const ep = boardEndpoints(c.ats, c.slug);
    accepted.push({ slug: c.slug, name, careers_url: ep.careers_url, api: ep.api, provider: ep.provider,
      notes: `auto-explored ${date} via ${c.via} - public ${c.ats} board verified live; ${v.titles.length} open roles (${verdict.techCount} tech/product).` });
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
    const tmp = `${statePath}.tmp`;
    writeFileSync(tmp, JSON.stringify({ cursor: nextCursor, lastRun: now.toISOString(), excluded: state.excluded || [], rejected: keep }, null, 2));
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

