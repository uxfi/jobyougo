import 'dotenv/config';
import { createServer } from 'http';
import { readFile, writeFile, readdir, stat, mkdir, mkdtemp, rm } from 'fs/promises';
import { watch } from 'fs';
import { join, dirname, resolve, sep } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { gzipSync, brotliCompressSync, constants as zlibConstants } from 'zlib';
import { spawn } from 'child_process';
import { load as yamlLoad, dump as yamlDump } from 'js-yaml';
import { supabase, isEnabled as useSupabase } from '../lib/supabase.mjs';
import { chat, chatStream, MODELS } from '../lib/openrouter.mjs';
import { aggregateUsageEvents, readAiUsageEvents } from '../lib/ai-usage-log.mjs';
import { loadCvTemplateData } from '../lib/cv-template-data.mjs';
import { buildApplySpec, detectRegion } from '../lib/apply-spec.mjs';
import { loadCanonicalStates, resolveCanonicalState } from '../tracker-utils.mjs';
import { detectChallenge, matchChallengeText } from '../lib/challenge-detect.mjs';
import {
  PINCHTAB_URL,
  pinchtabClose as pinchtabCloseRaw,
  pinchtabEvaluate,
  pinchtabHealth,
  pinchtabNavigate as pinchtabNavigateRaw,
  pinchtabSolve as pinchtabSolveRaw,
  pinchtabSolveSucceeded,
} from '../lib/pinchtab.mjs';
import { STYLE_RULES, polishApplicationAnswer, loadApplicationVoice } from '../lib/application-writing.mjs';
import { normalizeCompany, roleMatch, tsvSafe } from '../lib/scan-filters.mjs';
import { getScanAggregators, fetchJobBoard, jobBoardProviders } from '../lib/scan-job-boards.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PORT = process.env.PORT || 3210;

// On Vercel, the deployment dir is read-only. Redirect all writes to /tmp.
const IS_VERCEL = !!process.env.VERCEL || ROOT.startsWith('/var/task');
const WRITE_ROOT = IS_VERCEL ? '/tmp/career-ops' : ROOT;

// Ensure writable dirs exist on Vercel
if (IS_VERCEL) {
  import('fs').then(({ mkdirSync }) => {
    for (const dir of ['reports', 'batch/tracker-additions', 'data', 'output']) {
      try { mkdirSync(join(WRITE_ROOT, dir), { recursive: true }); } catch {}
    }
  });
}
// ─── Static path containment ──────────────────────────────────────────────────
// URL parsing collapses a literal "../", but a percent-encoded one ("%2e%2e")
// survives it and only becomes ".." at decodeURIComponent time — after the
// prefix check. Every path built from a decoded URL segment goes through this.
function safeJoin(base, ...segments) {
  const root = resolve(base);
  const target = resolve(root, ...segments.map(s => String(s).replace(/^[/\\]+/, '')));
  return target === root || target.startsWith(root + sep) ? target : null;
}

// ─── Text responses: ETag revalidation + gzip/brotli ──────────────────────────
// portfolio.html alone is ~600 KB of HTML; uncompressed it dominates first load.
const COMPRESS_MIN_BYTES = 1024;
const compressedCache = new Map(); // `${encoding}:${etag}` -> Buffer

function weakHash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

function sendText(req, res, body, status = 200) {
  const etag = `W/"${weakHash(body)}-${body.length.toString(36)}"`;
  res.setHeader('ETag', etag);
  res.setHeader('Vary', 'Accept-Encoding');
  if (req.headers['if-none-match'] === etag) { res.writeHead(304); res.end(); return; }

  const accept = req.headers['accept-encoding'] || '';
  const rawBytes = Buffer.byteLength(body);
  let encoding = null;
  if (rawBytes >= COMPRESS_MIN_BYTES) {
    if (/\bbr\b/.test(accept)) encoding = 'br';
    else if (/\bgzip\b/.test(accept)) encoding = 'gzip';
  }

  let payload;
  if (encoding) {
    const key = `${encoding}:${etag}`;
    payload = compressedCache.get(key);
    if (!payload) {
      payload = encoding === 'br'
        ? brotliCompressSync(body, { params: {
            [zlibConstants.BROTLI_PARAM_QUALITY]: 9, // ~113 KB in 27ms for portfolio.html, then cached
            [zlibConstants.BROTLI_PARAM_SIZE_HINT]: rawBytes,
          } })
        : gzipSync(body, { level: 6 });
      if (compressedCache.size > 32) compressedCache.clear();
      compressedCache.set(key, payload);
    }
    res.setHeader('Content-Encoding', encoding);
  } else {
    payload = Buffer.from(body);
  }
  res.setHeader('Content-Length', payload.length);
  res.writeHead(status);
  res.end(payload);
}

// ─── Per-IP rate limit (public LLM route) ─────────────────────────────────────
const HRHV_WINDOW_MS = 10 * 60 * 1000;
const HRHV_MAX_REQUESTS = Number(process.env.HRHV_RATE_LIMIT || 30);
const hrhvHits = new Map(); // ip -> timestamps[]

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

function hrhvRateLimited(req) {
  if (!Number.isFinite(HRHV_MAX_REQUESTS) || HRHV_MAX_REQUESTS <= 0) return false;
  const now = Date.now();
  const ip = clientIp(req);
  const hits = (hrhvHits.get(ip) || []).filter(t => now - t < HRHV_WINDOW_MS);
  if (hits.length >= HRHV_MAX_REQUESTS) { hrhvHits.set(ip, hits); return true; }
  hits.push(now);
  hrhvHits.set(ip, hits);
  if (hrhvHits.size > 5000) {
    for (const [key, stamps] of hrhvHits) {
      if (!stamps.some(t => now - t < HRHV_WINDOW_MS)) hrhvHits.delete(key);
    }
  }
  return false;
}

const SUPABASE_URL_VALUE  = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_VALUE = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const activePinchtabTabs = new Set();
let isShuttingDown = false;

// ─── PinchTab wrappers (shared client in lib/pinchtab.mjs) ─────────────────────
async function pinchtabNavigate(url, opts = {}) {
  const tabId = await pinchtabNavigateRaw(url, opts);
  activePinchtabTabs.add(tabId);
  return tabId;
}

async function pinchtabClose(tabId) {
  if (!tabId) return;
  activePinchtabTabs.delete(tabId);
  await pinchtabCloseRaw(tabId);
}

let _pinchtabSolveConsecFail = 0;
const PINCHTAB_SOLVE_FAIL_BUDGET = 5;
function pinchtabSolveCircuitOpen() {
  return _pinchtabSolveConsecFail >= PINCHTAB_SOLVE_FAIL_BUDGET;
}
function resetPinchtabSolveCircuit() {
  if (_pinchtabSolveConsecFail) {
    console.log(`[scan] [pinchtab-solve] resetting circuit-breaker (had ${_pinchtabSolveConsecFail} consecutive failures)`);
  }
  _pinchtabSolveConsecFail = 0;
}
function notePinchtabSolveResult(ok) {
  if (ok) {
    _pinchtabSolveConsecFail = 0;
    return true;
  }
  _pinchtabSolveConsecFail += 1;
  if (_pinchtabSolveConsecFail === PINCHTAB_SOLVE_FAIL_BUDGET) {
    console.warn(`[scan] [pinchtab-solve] circuit-breaker tripped after ${PINCHTAB_SOLVE_FAIL_BUDGET} consecutive failures — skipping further solve attempts this run`);
  }
  return false;
}
async function pinchtabSolve(tabId, { maxAttempts = 6, timeout = 40000 } = {}) {
  if (!tabId || pinchtabSolveCircuitOpen()) return false;
  try {
    return notePinchtabSolveResult(pinchtabSolveSucceeded(await pinchtabSolveRaw(tabId, { maxAttempts, timeout })));
  } catch {
    return notePinchtabSolveResult(false);
  }
}

// One health probe per scan run. Without this, every failed web-search query
// hits localhost:9867 twice (Brave then Google) and logs the same miss.
let _pinchtabHealthCache = null;
function resetPinchtabHealthCache() { _pinchtabHealthCache = null; }
async function pinchtabIsUp() {
  if (_pinchtabHealthCache !== null) return _pinchtabHealthCache;
  _pinchtabHealthCache = await pinchtabHealth().catch(() => false);
  if (!_pinchtabHealthCache) {
    console.log(`[scan] [pinchtab] daemon not reachable at ${PINCHTAB_URL}`);
  }
  return _pinchtabHealthCache;
}

let _interfaceShowcaseCache = null;

// ─── Admin user lookup (Supabase) ─────────────────────────────────────────────
let _adminUserId = null;
async function getAdminUserId() {
  if (_adminUserId) return _adminUserId;
  if (!useSupabase || !supabase) return null;
  const adminEmail = process.env.ADMIN_EMAIL;
  if (adminEmail) {
    const { data } = await supabase.auth.admin.listUsers().catch(() => ({ data: null }));
    const found = (data?.users || []).find(u => u.email === adminEmail);
    if (found) { _adminUserId = found.id; return _adminUserId; }
  }
  const { data } = await supabase.from('applications').select('user_id').not('user_id', 'is', null).limit(1).single().catch(() => ({ data: null }));
  if (data?.user_id) { _adminUserId = data.user_id; return _adminUserId; }
  return null;
}

function buildPlaywrightResult(company = {}, overrides = {}) {
  return {
    ok: false,
    section: null,
    jobs: [],
    engine: 'pinchtab',
    company: company.name,
    ...overrides,
  };
}

function cancelRemainingPlaywrightResults(results, companies, startIndex, reason) {
  const remaining = companies.slice(startIndex);
  if (!remaining.length) return;

  console.warn(`[scan] [Playwright] Aborting ${remaining.length} remaining source(s): ${reason}`);
  remaining.forEach(company => {
    results.push(buildPlaywrightResult(company, {
      error: reason,
      cancelled: true,
    }));
  });
}

function setupGracefulShutdown(server) {
  let shutdownInFlight = false;

  const shutdown = async (signal) => {
    if (shutdownInFlight) return;
    shutdownInFlight = true;
    isShuttingDown = true;
    console.log(`[server] ${signal} received, shutting down gracefully...`);

    server.close(() => {
      process.exit(0);
    });

    await Promise.allSettled(
      [...activePinchtabTabs].map(tabId => pinchtabClose(tabId))
    );

    setTimeout(() => process.exit(0), 5000).unref();
  };

  process.on('SIGTERM', () => { shutdown('SIGTERM'); });
  process.on('SIGINT', () => { shutdown('SIGINT'); });
}

// ─── Markdown Parsers ────────────────────────────────────────────────────────

function parseMarkdownTable(content) {
  const lines = content.split('\n').filter(l => l.trim().startsWith('|'));
  if (lines.length < 3) return [];
  const headers = lines[0].split('|').map(h => h.trim()).filter(Boolean);
  return lines.slice(2)
    .map(row => {
      const cells = row.split('|').map(c => c.trim()).filter(Boolean);
      const obj = {};
      headers.forEach((h, i) => { obj[h] = cells[i] ?? ''; });
      return obj;
    })
    .filter(row => Object.values(row).some(v => v));
}

async function loadInterfaceShowcaseData() {
  if (_interfaceShowcaseCache) return _interfaceShowcaseCache;

  const html = await readFile(join(__dirname, 'portfolio.html'), 'utf-8');
  const match = html.match(/const INTERFACES\s*=\s*\[([\s\S]*?)\];\s*\n\s*\/\*/);
  if (!match) throw new Error('Could not find INTERFACES array in portfolio.html');

  const arrayText = `[${match[1]}]`;
  const interfaces = new Function(`return ${arrayText}`)();
  _interfaceShowcaseCache = interfaces;
  return interfaces;
}

function renderInterfaceLayoutPage(iface, pathname) {
  const title = escapeHtml(iface.name || iface.id);
  const tag = escapeHtml(iface.tag || '');
  const shareUrl = escapeHtml(pathname);
  const thumb = iface.thumb ? `/${iface.thumb.replace(/^\/+/, '')}` : '';
  const screens = Array.isArray(iface.screens) ? iface.screens : [];
  const isMobile = iface.type === 'mobile';
  const desktopSrc = iface.src ? `/${iface.src.replace(/^\/+/, '')}` : '';
  const mobileShells = screens.map((screen) => {
    const src = `/${String(screen.src || '').replace(/^\/+/, '')}`;
    const label = screens.length > 1
      ? `<div class="phone-label">${escapeHtml(screen.label || iface.name)}</div>`
      : '';

    return `
      <div class="phone-wrap">
        <div class="phone-shell">
          <iframe src="${src}" sandbox="allow-scripts allow-same-origin"></iframe>
        </div>
        ${label}
      </div>
    `;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  ${thumb ? `<meta property="og:image" content="${thumb}">` : ''}
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #0d0d10;
      --panel: rgba(255,255,255,.05);
      --panel-2: rgba(255,255,255,.08);
      --text: rgba(255,255,255,.94);
      --muted: rgba(255,255,255,.56);
      --border: rgba(255,255,255,.1);
    }
    html, body { width: 100%; min-height: 100%; background: var(--bg); color: var(--text); font-family: Inter, -apple-system, BlinkMacSystemFont, sans-serif; }
    body { display: flex; flex-direction: column; }
    .bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
      padding: 18px 22px;
      border-bottom: 1px solid var(--border);
      background: rgba(10,10,12,.88);
      backdrop-filter: blur(18px);
      position: sticky;
      top: 0;
      z-index: 10;
    }
    .meta { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
    .title { font-size: 15px; font-weight: 600; white-space: nowrap; }
    .tag { font-size: 11px; color: var(--muted); white-space: nowrap; }
    .url {
      margin-left: auto;
      min-width: 0;
      max-width: min(720px, 60vw);
      padding: 9px 12px;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: var(--panel);
      color: rgba(255,255,255,.72);
      font-size: 12px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .main {
      flex: 1;
      min-height: 0;
      padding: 18px;
      display: flex;
      align-items: stretch;
      justify-content: center;
    }
    .browser {
      width: 100%;
      min-height: calc(100vh - 92px);
      border-radius: 16px;
      overflow: hidden;
      border: 1px solid var(--border);
      background: #111;
      box-shadow: 0 30px 80px rgba(0,0,0,.35);
    }
    .browser iframe {
      width: 100%;
      height: calc(100vh - 128px);
      border: none;
      background: #fff;
      display: block;
    }
    .phones {
      width: 100%;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      gap: 28px;
      padding: 18px 0 28px;
      flex-wrap: wrap;
    }
    .phone-wrap { display: flex; flex-direction: column; align-items: center; gap: 12px; }
    .phone-shell {
      width: 300px;
      height: 612px;
      border-radius: 44px;
      overflow: hidden;
      border: 8px solid #1e1e22;
      background: #141417;
      box-shadow: 0 26px 60px rgba(0,0,0,.38);
      position: relative;
    }
    .phone-shell::before {
      content: '';
      position: absolute;
      top: 11px;
      left: 50%;
      transform: translateX(-50%);
      width: 76px;
      height: 5px;
      border-radius: 999px;
      background: #111;
      z-index: 2;
    }
    .phone-shell iframe {
      width: 100%;
      height: 100%;
      border: none;
      background: #fff;
      display: block;
    }
    .phone-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: .08em;
      color: var(--muted);
    }
    @media (max-width: 900px) {
      .bar { flex-wrap: wrap; }
      .url { max-width: 100%; width: 100%; }
      .main { padding: 12px; }
      .browser iframe { height: calc(100vh - 174px); }
    }
  </style>
</head>
<body>
  <div class="bar">
    <div class="meta">
      <div class="title">${title}</div>
      <div class="tag">${tag}</div>
    </div>
    <div class="url">${shareUrl}</div>
  </div>
  <main class="main">
    ${isMobile
      ? `<div class="phones">${mobileShells}</div>`
      : `<div class="browser"><iframe src="${desktopSrc}" sandbox="allow-scripts allow-same-origin"></iframe></div>`}
  </main>
</body>
</html>`;
}

function getMarkdownTableRowNumber(line = '') {
  const match = String(line).match(/^\|\s*([^|]+?)\s*\|/);
  return match ? match[1].trim() : '';
}

// templates/states.yml, read once per process. A broken/missing file yields an
// empty list, which makes resolveCanonicalState reject everything — failing
// closed is right here: better to refuse a status change than to write an
// unvalidated one into the tracker.
let _canonicalStatesCache = null;
function canonicalApplicationStates() {
  if (_canonicalStatesCache) return _canonicalStatesCache;
  try {
    _canonicalStatesCache = loadCanonicalStates(join(ROOT, 'templates', 'states.yml'));
  } catch {
    _canonicalStatesCache = [];
  }
  return _canonicalStatesCache;
}

const IN_PROGRESS_APPLICATION_STATES = new Set(['Applied', 'Responded', 'Interview', 'Offer', 'Hired']);
const CLOSED_APPLICATION_STATES = new Set(['Discarded', 'SKIP']);

function deleteApplicationBlockReason(status = '') {
  const canonical = resolveCanonicalState(status, canonicalApplicationStates());
  if (IN_PROGRESS_APPLICATION_STATES.has(canonical)) {
    return 'Applications already in progress cannot be deleted';
  }
  if (CLOSED_APPLICATION_STATES.has(canonical)) {
    return 'Application is already discarded';
  }
  return null;
}

// Recover a deleted offer's posting URL from its evaluation report, so the
// scan-history row carries the real URL (URL-exact dedup) instead of the
// `unknown:{company}:{role}` placeholder (company+role dedup only).
//
// Accepts BOTH link shapes that occur in data/applications.md: the legacy
// root-relative `[8](reports/…)` and the normalized `[14](../reports/…)` that
// merge-tracker.mjs writes relative to the tracker's own directory. The old
// regex only matched the legacy form, so URL capture failed on every correctly
// normalized row.
async function findPostingUrlFromReportLink(reportLink = '') {
  const match = String(reportLink || '').match(/\[\d+\]\((?:\.\.\/)?reports\/([^)]+\.md)\)/);
  if (!match) return '';
  try {
    const reportContent = await readFile(join(ROOT, 'reports', match[1]), 'utf-8');
    const urlMatch = reportContent.match(/^\*\*URL:\*\*\s*(.+)$/m);
    const url = urlMatch ? urlMatch[1].trim() : '';
    return url.startsWith('http') ? url : '';
  } catch {
    return ''; // report may have been deleted or never written
  }
}

function parsePipeline(content) {
  return content
    .split('\n')
    .map(l => l.trim())
    // Keep lines that aren't comments/headers
    .filter(l => l && !l.startsWith('#') && !l.startsWith('<!--') && l !== '---' && l !== '>')
    // Exclude processed items (- [x]) and error items (- [!])
    .filter(l => !l.match(/^[-*+]\s*\[[xX!]\]/))
    .map(l => {
      // Handle both " - [ ] " and " - " prefixes common in manuals/outputs
      let clean = l.replace(/^[-*+]\s*(\[[ xX]\]\s*)?/, '').trim();
      
      // Handle different separators: " — " (em-dash), " — " (en-dash), " | ", or " - " (regular dash)
      const parts = clean.split(/\s+(?:[—–|]|-(?!\s*[\w]))\s+/);
      const url = parts[0].trim();
      const note = parts.slice(1).join(' | ').trim();
      
      return { url, note };
    })
    .filter(e => e.url.startsWith('http'));
}

function normalizeDateValue(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{10,13}$/.test(raw)) {
    const millis = raw.length === 10 ? Number(raw) * 1000 : Number(raw);
    const parsedNumeric = new Date(millis);
    if (!Number.isNaN(parsedNumeric.getTime())) return parsedNumeric.toISOString().split('T')[0];
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toISOString().split('T')[0];
}

function normalizeUrlKey(rawUrl = '') {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    const pathname = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.origin}${pathname}`;
  } catch {
    return trimmed;
  }
}

function looksLikeDate(value = '') {
  const raw = String(value || '').trim();
  return Boolean(raw) && normalizeDateValue(raw) !== raw
    ? true
    : /^\d{4}-\d{2}-\d{2}$/.test(raw);
}

function extractPipelineNoteParts(note = '') {
  const raw = String(note || '').trim();
  if (!raw) return { note: '', company: '', title: '', publishedAt: '' };

  const parts = raw.split('|').map(part => part.trim()).filter(Boolean);
  if (parts.length < 2) {
    return { note: raw, company: '', title: '', publishedAt: '' };
  }

  const lastPart = parts[parts.length - 1];
  const hasTrailingDate = looksLikeDate(lastPart);
  const publishedAt = hasTrailingDate ? normalizeDateValue(lastPart) : '';
  const mainParts = hasTrailingDate ? parts.slice(0, -1) : parts;
  const [company = '', title = '', ...rest] = mainParts;

  return {
    company,
    title,
    publishedAt,
    note: rest.join(' | '),
  };
}

function normalizePipelineItem(entry = {}) {
  const url = String(entry.url || entry.URL || '').trim();
  const rawNote = String(entry.note || entry.Note || '').trim();
  const extracted = extractPipelineNoteParts(rawNote);
  const publishedAt = normalizeDateValue(
    entry.published_at ||
    entry.publishedAt ||
    entry.posted_at ||
    entry.postedAt ||
    entry.date_published ||
    entry.datePublished ||
    entry.publication_date ||
    entry.publicationDate ||
    extracted.publishedAt ||
    ''
  );
  const createdAt = normalizeDateValue(entry.created_at || entry.createdAt || '');
  const company = String(entry.company || entry.Company || extracted.company || '').trim();
  const title = String(entry.title || entry.Title || entry.role || entry.Role || extracted.title || '').trim();
  const displayNote = String(entry.display_note || entry.displayNote || extracted.note || '').trim();

  return {
    ...entry,
    url,
    note: rawNote,
    company,
    title,
    published_at: publishedAt,
    created_at: createdAt,
    display_note: displayNote,
  };
}

function extractReportFilename(reportCell = '') {
  const match = String(reportCell).match(/\(([^)]+)\)/);
  return match ? match[1].split('/').pop() : '';
}

function normalizeLookup(value = '') {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function normalizeCompanyName(value = '') {
  return normalizeLookup(value).replace(/\bai\b/g, ' ').replace(/\s+/g, ' ').trim();
}

function companyMatches(a = '', b = '') {
  const left = normalizeCompanyName(a);
  const right = normalizeCompanyName(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function normalizeRoleText(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/\(\d+\)/g, ' ')
    .replace(/\bpm\b/g, ' product manager ')
    .replace(/\bai pm\b/g, ' ai product manager ')
    .replace(/\bsa\b/g, ' solutions architect ')
    .replace(/\bfde\b/g, ' forward deployed engineer ')
    .replace(/\beng\b/g, ' engineer ')
    .replace(/\bvalue eng\b/g, ' value engineering ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function roleTokens(value = '') {
  const stopwords = new Set(['senior', 'lead', 'staff', 'principal', 'head', 'mid', 'jr', 'sr', 'the', 'and']);
  return normalizeRoleText(value)
    .split(' ')
    .map(t => t.trim())
    .filter(Boolean)
    .filter(token => !stopwords.has(token));
}

function scoreRoleMatch(target = '', candidate = '') {
  const targetNorm = normalizeRoleText(target);
  const candidateNorm = normalizeRoleText(candidate);
  if (!targetNorm || !candidateNorm) return 0;
  if (targetNorm === candidateNorm) return 100;

  let score = 0;
  if (targetNorm.includes(candidateNorm) || candidateNorm.includes(targetNorm)) score += 30;

  const targetSet = new Set(roleTokens(target));
  const candidateSet = new Set(roleTokens(candidate));
  let overlap = 0;
  for (const token of targetSet) {
    if (candidateSet.has(token)) overlap += 1;
  }
  score += overlap * 10;

  const targetLastTwo = [...targetSet].slice(-2).join(' ');
  const candidateLastTwo = [...candidateSet].slice(-2).join(' ');
  if (targetLastTwo && targetLastTwo === candidateLastTwo) score += 10;

  score -= Math.abs(targetSet.size - candidateSet.size) * 2;
  return score;
}

function extractJobUrlFromReport(content = '') {
  const explicitUrl = content.match(/\*\*URL:\*\*\s*(https?:\/\/\S+)/i);
  if (explicitUrl) return explicitUrl[1].trim();

  const xmlParamUrl = content.match(/<parameter\s+name="url">\s*(https?:\/\/[^<\s]+)\s*<\/parameter>/i);
  if (xmlParamUrl) return xmlParamUrl[1].trim();

  const markdownLinkUrl = content.match(/\[[^\]]+\]\((https?:\/\/[^)\s]+)\)/i);
  if (markdownLinkUrl) return markdownLinkUrl[1].trim();

  const firstBareUrl = content.match(/https?:\/\/[^\s)<>"']+/i);
  return firstBareUrl ? firstBareUrl[0].trim() : '';
}

function extractRoleUrlCandidatesFromReport(content = '') {
  const candidates = [];
  const directHeader = content.match(/#\s*Evaluation:\s*([^-—\n|]+)\s*[-—|]\s*([^\n*]+)/i);
  const directUrl = content.match(/\*\*URL:\*\*\s*(https?:\/\/\S+)/i);
  if (directHeader && directUrl) {
    candidates.push({
      company: directHeader[1].trim(),
      role: directHeader[2].trim(),
      url: directUrl[1].trim(),
    });
  }

  let currentCompany = '';
  for (const line of content.split('\n')) {
    const headingMatch = line.match(/^###\s+([A-Za-z0-9 .&/-]+?)(?:\s*\(|\s*$)/);
    if (headingMatch) {
      currentCompany = headingMatch[1].trim();
      continue;
    }

    const tableMatch = line.match(/^\|\s*[^|]+\s*\|\s*([^|]+?)\s*\|\s*\[[^\]]+\]\((https?:\/\/[^)\s]+)\)\s*\|/i);
    if (tableMatch) {
      candidates.push({
        company: currentCompany,
        role: tableMatch[1].trim(),
        url: tableMatch[2].trim(),
      });
    }
  }

  return candidates;
}

let historicRoleUrlIndexPromise = null;

async function getHistoricRoleUrlIndex() {
  if (!historicRoleUrlIndexPromise) {
    historicRoleUrlIndexPromise = (async () => {
      const files = await readdir(join(ROOT, 'reports')).catch(() => []);
      const entries = [];
      await Promise.all(files
        .filter(filename => filename.endsWith('.md'))
        .map(async (filename) => {
          try {
            const content = await getReport(filename);
            extractRoleUrlCandidatesFromReport(content).forEach(candidate => {
              if (candidate.url) entries.push({ ...candidate, source: filename });
            });
          } catch {
            // Ignore broken report reads in fallback index.
          }
        }));
      return entries;
    })();
  }
  return historicRoleUrlIndexPromise;
}

async function findHistoricJobUrl(company = '', role = '') {
  const entries = await getHistoricRoleUrlIndex();
  const scored = entries
    .filter(entry => !entry.company || companyMatches(company, entry.company))
    .map(entry => ({
      ...entry,
      score: scoreRoleMatch(role, entry.role),
      lengthDelta: Math.abs(normalizeRoleText(role).length - normalizeRoleText(entry.role).length),
    }))
    .filter(entry => entry.score >= 18)
    .sort((a, b) => b.score - a.score || a.lengthDelta - b.lengthDelta);

  return scored[0]?.url || '';
}

async function enrichApplicationsWithJobUrl(apps, userId) {
  return Promise.all((apps || []).map(async (app) => {
    const existingUrl = app.JobURL ?? app.job_url ?? app.jobUrl ?? '';
    if (existingUrl) return app;

    const reportCell = app.Report ?? app.report ?? '';
    const filename = extractReportFilename(reportCell);
    if (!filename) return app;

    try {
      const reportContent = await getReport(filename, userId);
      const jobUrl = extractJobUrlFromReport(reportContent);
      const fallbackUrl = jobUrl || await findHistoricJobUrl(app.Company ?? app.company ?? '', app.Role ?? app.role ?? '');
      if (!fallbackUrl) return app;
      return app.Report !== undefined || app.JobURL !== undefined
        ? { ...app, JobURL: fallbackUrl }
        : { ...app, job_url: fallbackUrl };
    } catch {
      const fallbackUrl = await findHistoricJobUrl(app.Company ?? app.company ?? '', app.Role ?? app.role ?? '');
      if (!fallbackUrl) return app;
      return app.Report !== undefined || app.JobURL !== undefined
        ? { ...app, JobURL: fallbackUrl }
        : { ...app, job_url: fallbackUrl };
    }
  }));
}

// ─── Data Accessors ───────────────────────────────────────────────────────────

async function getApplications(userId) {
  if (useSupabase) {
    let q = supabase.from('applications').select('*').order('num', { ascending: true });
    if (userId) q = q.eq('user_id', userId);
    const { data, error } = await q;
    if (error) throw error;
    return enrichApplicationsWithJobUrl(data, userId);
  }
  try {
    const raw = await readFile(join(ROOT, 'data/applications.md'), 'utf-8');
    return enrichApplicationsWithJobUrl(parseMarkdownTable(raw));
  } catch { return []; }
}

async function getPipeline(userId) {
  if (useSupabase) {
    let q = supabase.from('pipeline').select('*').eq('processed', false).order('created_at', { ascending: true });
    if (userId) q = q.eq('user_id', userId);
    const { data, error } = await q;
    if (error) throw error;
    const pipeline = (data || []).map(normalizePipelineItem);
    const includeLocalOrphans = await shouldIncludeLocalScanHistoryOrphans(userId);
    const orphaned = includeLocalOrphans
      ? await getOrphanedScanPipelineItems(pipeline).catch(() => [])
      : [];
    return [...pipeline, ...orphaned];
  }
  try {
    const raw = await readFile(join(ROOT, 'data/pipeline.md'), 'utf-8');
    const pipeline = parsePipeline(raw).map(normalizePipelineItem);
    const orphaned = await getOrphanedScanPipelineItems(pipeline).catch(() => []);
    return [...pipeline, ...orphaned];
  } catch {
    return getOrphanedScanPipelineItems([]).catch(() => []);
  }
}

async function getReports(userId) {
  if (useSupabase) {
    let q = supabase.from('reports').select('filename, num, company, date').order('num', { ascending: false });
    if (userId) q = q.eq('user_id', userId);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  }
  try {
    const files = await readdir(join(ROOT, 'reports'));
    return files
      .filter(f => f.endsWith('.md'))
      .sort()
      .reverse()
      .map(f => {
        const [num, ...rest] = f.replace('.md', '').split('-');
        const date = rest.slice(-3).join('-');
        const company = rest.slice(0, -3).join(' ');
        return { filename: f, num, company, date };
      });
  } catch { return []; }
}

async function getCVs() {
  try {
    const files = await readdir(join(ROOT, 'output'));
    const pdfs = files.filter(f => f.toLowerCase().endsWith('.pdf'));
    const cvs = [];
    for (const f of pdfs) {
      const stats = await stat(join(ROOT, 'output', f));
      cvs.push({
        filename: f,
        date: stats.mtime.toISOString().split('T')[0],
        size: stats.size
      });
    }
    return cvs.sort((a,b) => new Date(b.date) - new Date(a.date));
  } catch { return []; }
}
async function getReport(filename, userId) {
  if (filename.includes('/') || filename.includes('..')) throw new Error('Invalid filename');
  if (useSupabase) {
    // Try with user_id first
    if (userId) {
      const { data } = await supabase.from('reports').select('content').eq('filename', filename).eq('user_id', userId).single();
      if (data?.content) return data.content;
    }
    // Fallback: try without user_id filter (covers reports synced before user_id was added)
    const { data } = await supabase.from('reports').select('content').eq('filename', filename).single();
    if (data?.content) return data.content;
    // Last resort: read from disk
    return readFile(join(ROOT, 'reports', filename), 'utf-8');
  }
  return readFile(join(ROOT, 'reports', filename), 'utf-8');
}

// Atomic batch insert: single Supabase upsert OR single read+write of pipeline.md.
// Avoids the read-modify-write race that occurs when callers Promise.all([addToPipeline, ...]).
async function addManyToPipeline(entries = [], userId) {
  const clean = (entries || []).filter(e => e?.url);
  if (!clean.length) return;

  if (useSupabase) {
    const rows = clean.map(({ url, note }) => {
      const row = { url, note: note || '', processed: false };
      if (userId) row.user_id = userId;
      return row;
    });
    const { error } = await supabase
      .from('pipeline')
      .upsert(rows, { onConflict: 'url,user_id' });
    if (error) throw error;
    return;
  }
  const raw = await readFile(join(ROOT, 'data/pipeline.md'), 'utf-8');
  const lines = clean.map(({ url, note }) => note ? `${url} — ${note}` : url);
  await writeFile(join(WRITE_ROOT, 'data/pipeline.md'), raw.trimEnd() + '\n' + lines.join('\n') + '\n', 'utf-8');
}

async function addToPipeline(url, note, userId) {
  return addManyToPipeline([{ url, note }], userId);
}

// ─── Portals (portals.yml) ────────────────────────────────────────────────────

const PORTALS_FILE = join(ROOT, 'portals.yml');
const DIRECT_JOB_POSITIVE_PATTERNS = [
  /\b(ai|artificial intelligence|genai|generative ai|llm|agentic|agent\s+builder|automation)\b/i,
  /\b(product\s+(manager|designer|lead|director|owner|strategist)|head\s+of\s+product|vp\s+product)\b/i,
  /\b(ux|ui|ux\/ui|ui\/ux)\s+(designer|lead|director|researcher)\b/i,
  /\b(product\s+design|design\s+lead|head\s+of\s+design|design\s+director)\b/i,
  /\b(solutions?\s+(architect|engineer|consultant)|forward\s+deployed|deployed\s+engineer|field\s+(cto|engineer))\b/i,
  /\b(no-?code|low-?code|transformation|consultant|fractional|freelance|contract)\b/i,
];
const DIRECT_JOB_NEGATIVE_PATTERNS = [
  /\b(engineering|sales|account|customer|community|office|people|finance|legal|recruit|talent|marketing|operations|support|success)\s+manager\b/i,
  /\b(program|project|delivery|partner|channel|vendor|incident|release|site reliability)\s+manager\b/i,
  /\b(junior|intern|internship|working student|graduate)\b/i,
  /\b(android|ios|php|ruby|embedded|firmware|fpga|asic|mainframe|cobol)\b/i,
  /\b(blockchain|web3|crypto)\b/i,
  /\b(data scientist|ml engineer|mlops|research scientist)\b/i,
];
const DIRECT_JOB_FILTER_REGEX = {
  test(title = '') {
    return isDirectJobTitleMatch(title);
  },
};
const SERPAPI_KEY = process.env.SERPAPI_KEY || process.env.SEARCHAPI_KEY || '';
const DUCKDUCKGO_HTML_SEARCH_URL = 'https://html.duckduckgo.com/html/';

function isDirectJobTitleMatch(title = '') {
  const value = cleanString(title);
  if (!value) return false;
  if (DIRECT_JOB_NEGATIVE_PATTERNS.some(pattern => pattern.test(value))) return false;
  return DIRECT_JOB_POSITIVE_PATTERNS.some(pattern => pattern.test(value));
}

// ── DuckDuckGo anti-bot ────────────────────────────────────────────────────
// DDG blocks requests that arrive in burst (all parallel) or with bot UAs.
// Fix: serialize via a throttle queue + rotate realistic browser UAs.
const DDG_USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:125.0) Gecko/20100101 Firefox/125.0',
];
let _ddgUaIndex = Math.floor(Math.random() * DDG_USER_AGENTS.length);
function nextDdgUserAgent() {
  _ddgUaIndex = (_ddgUaIndex + 1) % DDG_USER_AGENTS.length;
  return DDG_USER_AGENTS[_ddgUaIndex];
}
// Shared throttle: min 4s + up to 3s jitter between DDG requests.
// DDG aggressively rate-limits; with the previous 2-3.5s window we routinely
// hit "challenge page" walls. Raising to 4-7s typically lets the IP cool down.
const DDG_MIN_DELAY_MS = 4000;
const DDG_JITTER_MS   = 3000;
let _ddgLastRequest = 0;
let _ddgThrottleChain = Promise.resolve();
function ddgThrottle() {
  _ddgThrottleChain = _ddgThrottleChain.then(() => new Promise(resolve => {
    const elapsed = Date.now() - _ddgLastRequest;
    const wait = DDG_MIN_DELAY_MS + Math.floor(Math.random() * DDG_JITTER_MS);
    const remaining = Math.max(0, wait - elapsed);
    setTimeout(() => { _ddgLastRequest = Date.now(); resolve(); }, remaining);
  }));
  return _ddgThrottleChain;
}
// ─────────────────────────────────────────────────────────────────────────────

// ── PinchTab search anti-burst ───────────────────────────────────────────────
// Browser-backed Google/Brave fallback is more resilient than raw HTTP, but the
// fast pace was triggering the same rate-limit that pushed us off DDG. Raising
// the floor reduces the rate of challenges we have to solve in the first place.
const PINCHTAB_SEARCH_MIN_DELAY_MS = 3000;
const PINCHTAB_SEARCH_JITTER_MS = 2000;
let _pinchtabSearchLastRequest = 0;
let _pinchtabSearchChain = Promise.resolve();
function pinchtabSearchThrottle() {
  _pinchtabSearchChain = _pinchtabSearchChain.then(() => new Promise(resolve => {
    const elapsed = Date.now() - _pinchtabSearchLastRequest;
    const wait = PINCHTAB_SEARCH_MIN_DELAY_MS + Math.floor(Math.random() * PINCHTAB_SEARCH_JITTER_MS);
    const remaining = Math.max(0, wait - elapsed);
    setTimeout(() => {
      _pinchtabSearchLastRequest = Date.now();
      resolve();
    }, remaining);
  }));
  return _pinchtabSearchChain;
}
// ─────────────────────────────────────────────────────────────────────────────

// Circuit breaker: once SearchAPI/SerpApi is unavailable in a scan run, skip it for all remaining queries.
let _serpApiCircuitOpen = false;
function serpApiCircuitOpen() { return _serpApiCircuitOpen; }
function resetSerpApiCircuit() { _serpApiCircuitOpen = false; }
function tripSerpApiCircuit(reason = 'unavailable') {
  if (!_serpApiCircuitOpen) {
    console.warn(`[scan] [circuit-breaker] SearchAPI/SerpApi ${reason} — skipping it for all remaining queries this run`);
    _serpApiCircuitOpen = true;
  }
}

// Per-run web-search circuit breaker. When SearchAPI is rate-limited and DDG /
// PinchTab solver are blocked by anti-bot, every webSearch query becomes a slow
// no-op: throttled DDG fetch (timeout) → throttled PinchTab/Brave nav (challenge)
// → throttled PinchTab/Google nav (challenge). With 90 enabled queries this can
// cost 10+ minutes for zero results. After N consecutive empty results, stop.
let _webSearchConsecFail = 0;
const WEB_SEARCH_FAIL_BUDGET = 8;
function webSearchCircuitOpen() { return _webSearchConsecFail >= WEB_SEARCH_FAIL_BUDGET; }
function resetWebSearchCircuit() {
  if (_webSearchConsecFail) console.log(`[scan] [websearch] resetting circuit-breaker (had ${_webSearchConsecFail} consecutive failures)`);
  _webSearchConsecFail = 0;
}
function recordWebSearchOutcome(ok) {
  if (ok) {
    _webSearchConsecFail = 0;
    return;
  }
  _webSearchConsecFail += 1;
  if (_webSearchConsecFail === WEB_SEARCH_FAIL_BUDGET) {
    console.warn(`[scan] [websearch] circuit-breaker tripped after ${WEB_SEARCH_FAIL_BUDGET} consecutive failures — skipping remaining web-search queries this run`);
  }
}

// Whether an engine attempt was actually BLOCKED (timeout, HTTP error, unsolved
// challenge) as opposed to having loaded/parsed the page cleanly but simply
// found 0 titles matching the filter this round — a normal, frequent outcome
// for niche site: queries that must NOT count against the circuit breaker.
// duckduckgo-html / playwright-fallback ("pinchtab" engine) already report
// ok:true whenever the page loaded, regardless of match count, and set
// `.error` only on a real failure — so `!ok` is an accurate blocked signal for
// them. pinchtab-brave / pinchtab-google instead key `ok` off "found jobs", so
// for those only an explicit `.error` (unsolved challenge / exception) counts.
function isWebSearchEngineBlocked(result) {
  if (!result) return true;
  if (result.error) return true;
  // pinchtab-brave / pinchtab-google key `ok` off "found jobs", so a clean
  // parse with 0 matches must NOT count as blocked. Daemon-down / challenge
  // paths MUST set `.error` so they still trip the circuit.
  if (result.engine === 'pinchtab-brave' || result.engine === 'pinchtab-google') return false;
  return !result.ok;
}

// Pre-flight probe: test the SearchAPI/SerpApi key BEFORE dispatching all parallel queries.
// Without this, all ~90 parallel calls go out before the first 401 trips the circuit.
async function probeSearchApi() {
  const key = process.env.SEARCHAPI_KEY || process.env.SERPAPI_KEY;
  if (!key) return;
  const useSearchApi = Boolean(process.env.SEARCHAPI_KEY);
  const baseUrl = useSearchApi
    ? 'https://www.searchapi.io/api/v1/search'
    : 'https://serpapi.com/search.json';
  const params = new URLSearchParams({ engine: 'google', q: 'test', hl: 'en', api_key: key, num: '1' });
  try {
    const r = await fetch(`${baseUrl}?${params.toString()}`, { signal: AbortSignal.timeout(8000) });
    if (r.status === 401 || r.status === 403 || r.status === 429) {
      console.warn(`[scan] [pre-flight] SearchAPI/SerpApi unavailable (HTTP ${r.status}) — skipping all web searches via API`);
      tripSerpApiCircuit(`returned HTTP ${r.status}`);
    }
  } catch {
    // Timeout or network error — let individual calls handle it
  }
}

async function readPortalsYaml() {
  const raw = await readFile(PORTALS_FILE, 'utf-8');
  return { raw, parsed: yamlLoad(raw) };
}

function inferGreenhouseApiUrl(company = {}) {
  const careersUrl = company.careers_url || '';
  const match = careersUrl.match(/^https:\/\/job-boards(?:\.eu)?\.greenhouse\.io\/([^/?#]+)/i);
  if (!match?.[1]) return '';
  return `https://boards-api.greenhouse.io/v1/boards/${match[1]}/jobs`;
}

function inferAshbyApiUrl(company = {}) {
  const careersUrl = company.careers_url || '';
  const match = careersUrl.match(/^https:\/\/jobs\.ashbyhq\.com\/([^/?#]+)/i);
  if (!match?.[1]) return '';
  return `https://api.ashbyhq.com/posting-api/job-board/${match[1]}`;
}

function inferLeverApiUrl(company = {}) {
  const careersUrl = company.careers_url || '';
  const match = careersUrl.match(/^https:\/\/jobs(\.eu)?\.lever\.co\/([^/?#]+)/i);
  if (!match?.[2]) return '';
  const baseUrl = match[1] ? 'https://api.eu.lever.co' : 'https://api.lever.co';
  return `${baseUrl}/v0/postings/${match[2]}?mode=json`;
}

function inferApiProviderFromUrl(url = '') {
  const value = String(url || '');
  if (/boards-api\.greenhouse\.io/i.test(value) || /job-boards(?:\.eu)?\.greenhouse\.io/i.test(value)) return 'greenhouse';
  if (/api\.ashbyhq\.com\/posting-api\/job-board/i.test(value) || /jobs\.ashbyhq\.com/i.test(value)) return 'ashby';
  if (/api(?:\.eu)?\.lever\.co\/v0\/postings/i.test(value) || /jobs(?:\.eu)?\.lever\.co/i.test(value)) return 'lever';
  return '';
}

function getCompanyScanAccess(company = {}) {
  if (company.api) {
    return {
      mode: 'api',
      apiUrl: company.api,
      apiKind: inferApiProviderFromUrl(company.api || company.careers_url || '') || 'json',
      apiSource: 'explicit',
    };
  }

  const apiUrl = inferGreenhouseApiUrl(company);
  if (apiUrl) {
    return {
      mode: 'api',
      apiUrl,
      apiKind: 'greenhouse',
      apiSource: 'derived_greenhouse',
    };
  }

  const ashbyApiUrl = inferAshbyApiUrl(company);
  if (ashbyApiUrl) {
    return {
      mode: 'api',
      apiUrl: ashbyApiUrl,
      apiKind: 'ashby',
      apiSource: 'derived_ashby',
    };
  }

  const leverApiUrl = inferLeverApiUrl(company);
  if (leverApiUrl) {
    return {
      mode: 'api',
      apiUrl: leverApiUrl,
      apiKind: 'lever',
      apiSource: 'derived_lever',
    };
  }

  if ((company.scan_method || '').toLowerCase() === 'websearch' && company.scan_query) {
    return { mode: 'websearch', query: company.scan_query };
  }

  return { mode: 'playwright' };
}

function isAggregatorConfigured(aggregator = {}) {
  if (aggregator.sourceKind === 'job_board') return jobBoardProviders.has(aggregator.provider);
  const provider = getAggregatorProvider(aggregator);
  if (provider === 'serpapi') return Boolean(SERPAPI_KEY || process.env.SEARCHAPI_KEY);
  if (provider === 'searchapi') return Boolean(process.env.SEARCHAPI_KEY || SERPAPI_KEY);
  if (provider === 'theirstack') {
    return Boolean(process.env.THEIRSTACK_API_KEY || process.env.THEIR_STACK_API_KEY);
  }
  if (provider === 'adzuna') return Boolean(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY);
  if (provider === 'jooble') return Boolean(process.env.JOOBLE_API_KEY);
  if (provider === 'careerjet') return Boolean(process.env.CAREERJET_AFFID || process.env.CAREERJET_AFFILIATE_ID);
  if (['remotive', 'jobicy', 'himalayas', 'arbeitnow', 'remoteok'].includes(provider)) return true;
  return false;
}

function aggregatorRequiresKey(aggregator = {}) {
  if (aggregator.sourceKind === 'job_board') return false;
  const provider = getAggregatorProvider(aggregator);
  return !['remotive', 'jobicy', 'himalayas', 'arbeitnow', 'remoteok'].includes(provider);
}

function getAggregatorProvider(aggregator = {}) {
  const value = `${aggregator.provider || ''} ${aggregator.name || ''} ${aggregator.api_url || ''} ${aggregator.notes || ''}`.toLowerCase();
  if (value.includes('theirstack') || value.includes('their stack')) return 'theirstack';
  if (value.includes('remoteok') || value.includes('remote ok')) return 'remoteok';
  if (value.includes('searchapi')) return 'searchapi';
  if (value.includes('serpapi')) return 'serpapi';
  if (value.includes('adzuna')) return 'adzuna';
  if (value.includes('jooble')) return 'jooble';
  if (value.includes('careerjet')) return 'careerjet';
  if (value.includes('remotive')) return 'remotive';
  if (value.includes('jobicy')) return 'jobicy';
  if (value.includes('himalayas')) return 'himalayas';
  if (value.includes('arbeitnow')) return 'arbeitnow';
  return '';
}

function buildJobSection(name, jobs, { includeCompany = false } = {}) {
  const seen = new Set();
  const lines = (jobs || [])
    .filter(job => job?.title && job?.url)
    .filter(job => DIRECT_JOB_FILTER_REGEX.test(job.title))
    .filter(job => {
      const key = `${job.url}::${job.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(job => {
      const location = cleanString(job.location);
      const locationLabel = location && location.length <= 80 && !job.title.toLowerCase().includes(location.toLowerCase())
        ? ` (${location})`
        : '';
      const title = `${job.title}${locationLabel}`;
      return includeCompany && job.company
        ? `${title} @ ${job.company} | ${job.url}`
        : `${title} | ${job.url}`;
    });

  return lines.length > 0 ? `### ${name}\n${lines.join('\n')}` : null;
}

function buildScanCandidateRecords(sourceName, jobs = [], { includeCompany = false, engine = '' } = {}) {
  return (jobs || [])
    .filter(job => job?.title && job?.url)
    .filter(job => DIRECT_JOB_FILTER_REGEX.test(job.title))
    .map(job => ({
      source: cleanString(sourceName),
      engine: cleanString(engine),
      company: cleanString(job.company || (includeCompany ? sourceName : '')),
      title: cleanString(job.title),
      location: cleanString(job.location),
      remoteEvidence: cleanString(job.remoteEvidence).slice(0, 160),
      publishedAt: normalizeDateValue(job.publishedAt || ''),
      url: cleanString(job.url),
      normalizedUrl: normalizeUrlKey(job.url),
    }));
}

function dedupeScanCandidates(candidates = []) {
  const seen = new Set();
  return candidates.filter(candidate => {
    const urlKey = candidate.normalizedUrl || candidate.url;
    const key = `${urlKey}::${candidate.title.toLowerCase()}`;
    if (!urlKey || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Published-date enrichment ────────────────────────────────────────────────
// API/RSS sources already include publishedAt. WebSearch results (Brave/Google/
// DDG) only have a URL — for those we look up the date via the per-posting ATS
// API when possible (Greenhouse/Lever/Ashby), or by extracting JSON-LD from the
// rendered page via PinchTab.

const DEFAULT_SCAN_MAX_AGE_DAYS = 7;
const PUBLISHED_DATE_CACHE_PATH = join(WRITE_ROOT, 'data', 'published-dates-cache.json');
const PUBLISHED_DATE_NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000;

let _publishedDateCache = null;
async function loadPublishedDateCache() {
  if (_publishedDateCache) return _publishedDateCache;
  try {
    _publishedDateCache = JSON.parse(await readFile(PUBLISHED_DATE_CACHE_PATH, 'utf-8'));
  } catch { _publishedDateCache = {}; }
  return _publishedDateCache;
}
async function savePublishedDateCache() {
  if (!_publishedDateCache) return;
  await writeFile(PUBLISHED_DATE_CACHE_PATH, JSON.stringify(_publishedDateCache, null, 2)).catch(() => {});
}

const _ashbyBoardCache = new Map();
async function getAshbyBoardCached(slug) {
  if (_ashbyBoardCache.has(slug)) return _ashbyBoardCache.get(slug);
  let data = {};
  try {
    const r = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${slug}`, { signal: AbortSignal.timeout(8000) });
    if (r.ok) data = await r.json().catch(() => ({}));
  } catch {}
  _ashbyBoardCache.set(slug, data);
  return data;
}

async function tryApiPublishedDate(url) {
  let m = url.match(/^https:\/\/job-boards(?:\.eu)?\.greenhouse\.io\/([^/]+)\/jobs\/(\d+)/i);
  if (m) {
    try {
      const r = await fetch(`https://boards-api.greenhouse.io/v1/boards/${m[1]}/jobs/${m[2]}`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return null;
      const d = await r.json().catch(() => ({}));
      const raw = d.first_published || d.updated_at || '';
      return raw ? String(raw).slice(0, 10) : null;
    } catch { return null; }
  }
  m = url.match(/^https:\/\/jobs(\.eu)?\.lever\.co\/([^/]+)\/([a-f0-9-]+)/i);
  if (m) {
    try {
      const base = m[1] ? 'https://api.eu.lever.co' : 'https://api.lever.co';
      const r = await fetch(`${base}/v0/postings/${m[2]}/${m[3]}?mode=json`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return null;
      const d = await r.json().catch(() => ({}));
      return d.createdAt ? new Date(d.createdAt).toISOString().slice(0, 10) : null;
    } catch { return null; }
  }
  m = url.match(/^https:\/\/jobs\.ashbyhq\.com\/([^/]+)\/([a-f0-9-]+)/i);
  if (m) {
    const board = await getAshbyBoardCached(m[1]);
    const job = (board.jobs || []).find(j => (j.jobUrl || j.applyUrl || '').includes(m[2]));
    return job?.publishedAt ? String(job.publishedAt).slice(0, 10) : null;
  }
  return null;
}

const PINCHTAB_DATE_EXTRACT_SCRIPT = `(() => {
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(s.textContent || '{}');
      const arr = Array.isArray(data) ? data : [data];
      for (const o of arr) {
        if (o && o.datePosted) return String(o.datePosted);
        if (o && o['@graph']) {
          for (const g of o['@graph']) if (g && g.datePosted) return String(g.datePosted);
        }
      }
    } catch (e) {}
  }
  const t = document.querySelector('time[datetime]');
  if (t && /^\\d{4}-\\d{2}-\\d{2}/.test(t.getAttribute('datetime') || '')) return t.getAttribute('datetime');
  const m = document.querySelector('meta[property="article:published_time"], meta[name="date"], meta[itemprop="datePosted"]');
  if (m && /^\\d{4}-\\d{2}-\\d{2}/.test(m.getAttribute('content') || '')) return m.getAttribute('content');
  return null;
})()`;

async function tryPinchtabPublishedDate(url) {
  if (!(await pinchtabIsUp())) return null;
  let tabId;
  try {
    tabId = await pinchtabNavigate(url, { timeout: 20000 });
    await new Promise(r => setTimeout(r, 1500));
    const raw = await pinchtabEvaluate(tabId, PINCHTAB_DATE_EXTRACT_SCRIPT, { awaitPromise: false, timeout: 10000 });
    if (!raw) return null;
    const m = String(raw).match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : null;
  } catch { return null; }
  finally { await pinchtabClose(tabId); }
}

async function lookupPublishedDate(url) {
  if (!url) return null;
  const cache = await loadPublishedDateCache();
  const cached = cache[url];
  if (cached) {
    if (cached.publishedAt) return cached.publishedAt;
    if (cached.fetchedAt && Date.now() - new Date(cached.fetchedAt).getTime() < PUBLISHED_DATE_NEGATIVE_TTL_MS) {
      return null;
    }
  }
  let date = await tryApiPublishedDate(url).catch(() => null);
  if (!date) date = await tryPinchtabPublishedDate(url).catch(() => null);
  cache[url] = { publishedAt: date || null, fetchedAt: new Date().toISOString() };
  return date || null;
}

async function enrichCandidatesWithPublishedDates(candidates = [], { concurrency = 5 } = {}) {
  const undated = candidates.filter(c => !c.publishedAt && c.url);
  if (!undated.length) return candidates;
  const pinchOk = await pinchtabIsUp();
  const ATS_RE = /^https:\/\/(job-boards(?:\.eu)?\.greenhouse\.io|jobs(?:\.eu)?\.lever\.co|jobs\.ashbyhq\.com)\//i;
  const atsCount = undated.filter(c => ATS_RE.test(c.url)).length;
  console.log(`[scan] [date-enrich] looking up dates for ${undated.length} candidate(s) (ats-api=${atsCount}, pinchtab=${pinchOk ? 'up' : 'down'})`);
  let i = 0, hits = 0;
  const workers = Array.from({ length: Math.min(concurrency, undated.length) }, async () => {
    while (i < undated.length) {
      const c = undated[i++];
      const date = await lookupPublishedDate(c.url);
      if (date) { c.publishedAt = date; hits += 1; }
    }
  });
  await Promise.all(workers);
  await savePublishedDateCache();
  if (hits === 0 && undated.length > 0) {
    const reason = !pinchOk && atsCount === 0
      ? 'Pinchtab is down and no candidate URLs match Greenhouse/Lever/Ashby APIs'
      : !pinchOk
      ? 'Pinchtab is down (only ATS-API candidates were attempted)'
      : 'no dates found via ATS APIs or Pinchtab';
    console.warn(`[scan] [date-enrich] resolved 0/${undated.length} dates — ${reason}`);
  } else {
    console.log(`[scan] [date-enrich] resolved ${hits}/${undated.length} dates`);
  }
  return candidates;
}

function applyAgeFilter(candidates = [], { maxAgeDays = DEFAULT_SCAN_MAX_AGE_DAYS } = {}) {
  // Match scan-fetch.mjs: jobs with no published date are KEPT (unknown ≠ old).
  if (!maxAgeDays || maxAgeDays <= 0) return candidates;
  const cutoff = new Date(Date.now() - maxAgeDays * 86400 * 1000).toISOString().slice(0, 10);
  let droppedOld = 0, keptUnknown = 0;
  const kept = candidates.filter(c => {
    if (!c.publishedAt) { keptUnknown += 1; return true; }
    if (c.publishedAt < cutoff) { droppedOld += 1; return false; }
    return true;
  });
  console.log(`[scan] [age-filter] kept ${kept.length}/${candidates.length} (max age ${maxAgeDays}d, cutoff ${cutoff}); dropped ${droppedOld} old, kept ${keptUnknown} unknown-date`);
  return kept;
}

function buildScanCandidateManifest(candidates = [], limit = 120) {
  const lines = candidates.slice(0, limit).map(candidate => {
    const meta = [
      candidate.company ? `company=${candidate.company}` : '',
      candidate.location ? `location=${candidate.location}` : '',
      candidate.remoteEvidence ? `remote_evidence=${candidate.remoteEvidence}` : '',
      candidate.publishedAt ? `published_at=${candidate.publishedAt}` : '',
      candidate.source ? `source=${candidate.source}` : '',
      candidate.engine ? `engine=${candidate.engine}` : '',
    ].filter(Boolean).join(' | ');
    return `- ${candidate.url} | ${candidate.title}${meta ? ` | ${meta}` : ''}`;
  });
  if (!lines.length) return '';
  const hiddenCount = Math.max(0, candidates.length - limit);
  return [
    '## Candidate Roster',
    `Total prefetched candidates after title + remote filter: ${candidates.length}`,
    ...lines,
    ...(hiddenCount ? [`- ... ${hiddenCount} more candidate(s) omitted for brevity`] : []),
  ].join('\n');
}

function normalizeTitleFilterConfig(raw = {}) {
  return {
    positive: Array.isArray(raw.positive) ? raw.positive.map(cleanString).filter(Boolean) : [],
    negative: Array.isArray(raw.negative) ? raw.negative.map(cleanString).filter(Boolean) : [],
    seniorityBoost: Array.isArray(raw.seniority_boost) ? raw.seniority_boost.map(cleanString).filter(Boolean) : [],
  };
}

function normalizeRemoteFilterConfig(raw = {}) {
  return {
    mode: cleanString(raw.mode || ''),
    requiredAny: Array.isArray(raw.required_any) ? raw.required_any.map(cleanString).filter(Boolean) : [],
    rejectedAny: Array.isArray(raw.rejected_any) ? raw.rejected_any.map(cleanString).filter(Boolean) : [],
    allowedGeoAny: Array.isArray(raw.allowed_geo_any) ? raw.allowed_geo_any.map(cleanString).filter(Boolean) : [],
    rejectedGeoAny: Array.isArray(raw.rejected_geo_any) ? raw.rejected_geo_any.map(cleanString).filter(Boolean) : [],
    ambiguousPolicy: cleanString(raw.ambiguous_policy || 'skip').toLowerCase() || 'skip',
  };
}

function normalizeMatchText(value = '') {
  return normalizeInline(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function escapeRegex(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function phraseInText(text = '', phrase = '') {
  const cleanPhrase = normalizeMatchText(phrase);
  if (!cleanPhrase) return false;

  const pattern = cleanPhrase
    .split(/\s+/)
    .map(escapeRegex)
    .join('[\\s\\-/_,.()]+');

  return new RegExp(`(^|[^a-z0-9])${pattern}([^a-z0-9]|$)`, 'i').test(text);
}

function firstPhraseMatch(text = '', phrases = []) {
  return phrases.map(cleanString).find(phrase => phrase && phraseInText(text, phrase)) || '';
}

function candidateRemoteAssessment(candidate = {}, remoteFilterRaw = {}) {
  const remoteFilter = normalizeRemoteFilterConfig(remoteFilterRaw);
  const strictMode = remoteFilter.mode === 'strict_full_remote_only';
  const titleText = cleanString(candidate.title);
  const locationText = cleanString(candidate.location);
  const evidenceText = cleanString(candidate.remoteEvidence);
  const urlText = cleanString(candidate.url);
  const remoteSignalText = [
    titleText,
    locationText,
    evidenceText,
    urlText,
  ].filter(Boolean).join(' | ');
  const geoSignalText = [
    locationText,
    evidenceText,
    urlText,
  ].filter(Boolean).join(' | ');
  const lower = normalizeMatchText(remoteSignalText);
  const geoLower = normalizeMatchText(geoSignalText);
  const titleLower = normalizeMatchText(titleText);

  const explicitTitleGeoPhrases = [
    'remote worldwide',
    'worldwide remote',
    'remote global',
    'global remote',
    'remote europe',
    'europe remote',
    'remote emea',
    'emea remote',
    'remote eu',
    'eu remote',
    'remote asia',
    'asia remote',
    'remote apac',
    'apac remote',
    'remote dubai',
    'dubai remote',
    'remote uae',
    'uae remote',
    'work from anywhere',
  ];
  const titleGeoMatch = firstPhraseMatch(titleLower, explicitTitleGeoPhrases);
  const titleGeoTerms = titleGeoMatch
    ? titleGeoMatch
        .split(/\s+/)
        .filter(term => term !== 'remote')
    : [];

  const defaultRejectedTerms = [
    'remote-friendly',
    'remote friendly',
    'remote possible',
    'remote option',
    'optional office',
    'flexible location',
    'partially remote',
    'partly remote',
  ];

  const rejectedMatch = firstPhraseMatch(lower, [...remoteFilter.rejectedAny, ...defaultRejectedTerms]);
  if (rejectedMatch) {
    return { keep: false, reason: `matched rejected remote term "${rejectedMatch}"`, evidence: rejectedMatch };
  }

  if (!strictMode) {
    return { keep: true, reason: 'remote filter not strict', evidence: '' };
  }

  const requiredMatch = firstPhraseMatch(lower, remoteFilter.requiredAny);
  if (!requiredMatch) {
    return {
      keep: remoteFilter.ambiguousPolicy !== 'skip',
      reason: 'remote status is ambiguous',
      evidence: '',
    };
  }

  const defaultAllowedGeoTerms = [
    'worldwide',
    'global',
    'globally',
    'work from anywhere',
    'anywhere in the world',
    'europe',
    'european',
    'european union',
    'eu',
    'eea',
    'emea',
    'cet',
    'cest',
    'france',
    'paris',
    'spain',
    'madrid',
    'barcelona',
    'portugal',
    'lisbon',
    'germany',
    'berlin',
    'netherlands',
    'amsterdam',
    'belgium',
    'brussels',
    'italy',
    'milan',
    'ireland',
    'dublin',
    'uk',
    'united kingdom',
    'london',
    'switzerland',
    'zurich',
    'asia',
    'apac',
    'asean',
    'singapore',
    'hong kong',
    'japan',
    'tokyo',
    'thailand',
    'bangkok',
    'malaysia',
    'kuala lumpur',
    'indonesia',
    'philippines',
    'vietnam',
    'india',
    'dubai',
    'uae',
    'united arab emirates',
  ];
  const defaultRejectedGeoTerms = [
    'us only',
    'u.s. only',
    'usa only',
    'united states only',
    'only us',
    'only usa',
    'only united states',
    'remote us',
    'remote usa',
    'remote u.s.',
    'remote united states',
    'us remote',
    'usa remote',
    'u.s. remote',
    'united states remote',
    'based in us',
    'based in the us',
    'based in usa',
    'based in the usa',
    'based in united states',
    'based in the united states',
    'united states',
    'usa',
    'u.s.',
    'us-based',
    'us based',
    'canada only',
    'only canada',
    'remote canada',
    'canada',
    'latam',
    'latin america',
    'south america',
    'americas',
    'north america',
  ];
  const allowedGeoMatch =
    firstPhraseMatch(geoLower, [...remoteFilter.allowedGeoAny, ...defaultAllowedGeoTerms]) ||
    firstPhraseMatch(titleGeoTerms.join(' '), [...remoteFilter.allowedGeoAny, ...defaultAllowedGeoTerms]);
  const rejectedGeoMatch = firstPhraseMatch(lower, [...remoteFilter.rejectedGeoAny, ...defaultRejectedGeoTerms]);
  const vagueAllowedGeo = ['work from anywhere'].includes(normalizeMatchText(allowedGeoMatch));
  if (rejectedGeoMatch && (!allowedGeoMatch || vagueAllowedGeo)) {
    return { keep: false, reason: `matched rejected remote geography "${rejectedGeoMatch}"`, evidence: rejectedGeoMatch };
  }

  if (allowedGeoMatch) {
    return {
      keep: true,
      reason: `matched required remote term "${requiredMatch}" and allowed geo "${allowedGeoMatch}"`,
      evidence: [requiredMatch, allowedGeoMatch].filter(Boolean).join(' / '),
    };
  }

  if (rejectedGeoMatch) {
    return { keep: false, reason: `matched rejected remote geography "${rejectedGeoMatch}"`, evidence: rejectedGeoMatch };
  }

  return {
    keep: remoteFilter.ambiguousPolicy !== 'skip',
    reason: 'remote geography is ambiguous',
    evidence: requiredMatch,
  };
}

function filterScanCandidatesByRemotePolicy(candidates = [], remoteFilterRaw = {}) {
  const kept = [];
  const dropped = [];

  for (const candidate of candidates) {
    const assessment = candidateRemoteAssessment(candidate, remoteFilterRaw);
    if (assessment.keep) {
      kept.push({
        ...candidate,
        remoteEvidence: candidate.remoteEvidence || assessment.evidence || candidate.location || '',
      });
    } else {
      dropped.push({ ...candidate, remoteRejectReason: assessment.reason });
    }
  }

  return { kept, dropped };
}

async function verifyJobLinks(candidates = [], { concurrency = 10, timeoutMs = 6000 } = {}) {
  if (!candidates.length) return { alive: [], dead: [] };

  const alive = [];
  const dead = [];

  // Dead-link redirect patterns: job boards redirect closed postings to these paths
  const DEAD_REDIRECT_PATTERNS = [
    /\/jobs\/?$/i,
    /\/careers\/?$/i,
    /\/jobs\/search/i,
    /\/en\/jobs\/?$/i,
    /\/en\/careers\/?$/i,
    /welcometothejungle\.com\/?$/i,
    /lever\.co\/[^/]+\/?$/i,
    /ashbyhq\.com\/[^/]+\/?$/i,
    /greenhouse\.io\/[^/]+\/?$/i,
  ];

  const isDeadRedirect = (finalUrl, originalUrl) => {
    if (!finalUrl || finalUrl === originalUrl) return false;
    const orig = new URL(originalUrl);
    const final = new URL(finalUrl);
    // If it redirected to a different path that looks like a homepage/listing
    if (orig.hostname === final.hostname && DEAD_REDIRECT_PATTERNS.some(p => p.test(final.pathname + final.search))) return true;
    return false;
  };

  const checkOne = async (candidate) => {
    const url = candidate.url;
    if (!url || !url.startsWith('http')) { alive.push(candidate); return; }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(url, {
        method: 'HEAD',
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; career-ops/1.0)' },
      }).finally(() => clearTimeout(timer));

      const status = res.status;
      const finalUrl = res.url;

      if (status === 404 || status === 410 || status === 403 && url.includes('greenhouse')) {
        dead.push({ ...candidate, deadReason: `HTTP ${status}` });
      } else if (isDeadRedirect(finalUrl, url)) {
        dead.push({ ...candidate, deadReason: `redirect → ${finalUrl}` });
      } else {
        alive.push(candidate);
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        // Timeout → assume alive (better to let Claude evaluate than miss valid jobs)
        alive.push(candidate);
      } else {
        alive.push(candidate); // Network error → assume alive
      }
    }
  };

  // Process with concurrency limit
  for (let i = 0; i < candidates.length; i += concurrency) {
    await Promise.all(candidates.slice(i, i + concurrency).map(checkOne));
  }

  if (dead.length) {
    console.log(`[scan] [link-check] ${dead.length} dead link(s) filtered:`);
    dead.forEach(c => console.log(`[scan]   ✗ ${c.url} (${c.deadReason}) — ${c.title}`));
  }
  console.log(`[scan] [link-check] ${alive.length} alive / ${dead.length} dead out of ${candidates.length} candidates`);

  return { alive, dead };
}

function stripHtmlTags(value = '') {
  return String(value).replace(/<[^>]+>/g, ' ');
}

function decodeHtmlEntities(value = '') {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function normalizeSearchResultTitle(value = '') {
  return decodeHtmlEntities(stripHtmlTags(value)).replace(/\s+/g, ' ').trim();
}

function decodeDuckDuckGoResultUrl(rawUrl = '') {
  if (!rawUrl) return '';
  const decodedHref = decodeHtmlEntities(rawUrl).trim();
  try {
    const parsed = new URL(decodedHref, 'https://duckduckgo.com');
    const uddg = parsed.searchParams.get('uddg');
    if (uddg) return decodeURIComponent(uddg);
    return parsed.href;
  } catch {
    return decodedHref;
  }
}

const JOB_DESCRIPTION_BROWSER_PATTERNS = [
  /[?&]gh_jid=/i,
  /jobs\.greenhouse\.io/i,
  /job-boards\.greenhouse\.io/i,
  /boards\.eu\.greenhouse\.io/i,
  /jobs\.lever\.co/i,
  /jobs\.ashbyhq\.com/i,
  /apply\.workable\.com/i,
  /careers\.smartrecruiters\.com/i,
  /(?:^|\/\/)(?:[a-z]{2}\.)?jobsdb\.com\//i,
];

const WEWORKREMOTELY_RSS_FEEDS = [
  'https://weworkremotely.com/remote-jobs.rss',
  'https://weworkremotely.com/categories/remote-product-jobs.rss',
  'https://weworkremotely.com/categories/remote-design-jobs.rss',
  'https://weworkremotely.com/categories/remote-programming-jobs.rss',
  'https://weworkremotely.com/categories/remote-sales-and-marketing-jobs.rss',
  'https://weworkremotely.com/categories/remote-management-and-finance-jobs.rss',
  'https://weworkremotely.com/categories/all-other-remote-jobs.rss',
];

function shouldUseBrowserForJobDescription(url = '') {
  return JOB_DESCRIPTION_BROWSER_PATTERNS.some(pattern => pattern.test(url));
}

function isWeWorkRemotelyJobUrl(url = '') {
  try {
    const parsed = new URL(String(url || ''));
    return /(^|\.)weworkremotely\.com$/i.test(parsed.hostname) && parsed.pathname.startsWith('/remote-jobs/');
  } catch {
    return false;
  }
}

function extractTextFromHtml(html = '') {
  return String(html || '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function readXmlTag(section = '', tag = '') {
  const match = String(section || '').match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  if (!match) return '';
  return decodeHtmlEntities(match[1].trim().replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '')).trim();
}

function decodeHtmlEntitiesDeep(value = '') {
  let out = String(value || '');
  for (let i = 0; i < 3; i += 1) {
    const next = decodeHtmlEntities(out);
    if (next === out) break;
    out = next;
  }
  return out;
}

function parseWeWorkRemotelyRssItem(section = '', sourceUrl = '') {
  const titleRaw = readXmlTag(section, 'title');
  const link = readXmlTag(section, 'link') || readXmlTag(section, 'guid');
  const descriptionHtml = decodeHtmlEntitiesDeep(readXmlTag(section, 'description'));
  const descriptionText = extractTextFromHtml(descriptionHtml);
  const region = readXmlTag(section, 'region');
  const country = readXmlTag(section, 'country');
  const state = readXmlTag(section, 'state');
  const category = readXmlTag(section, 'category');
  const type = readXmlTag(section, 'type');
  const publishedAt = normalizeDateValue(readXmlTag(section, 'pubDate'));
  const expiresAt = normalizeDateValue(readXmlTag(section, 'expires_at'));
  const [companyPart, ...roleParts] = titleRaw.split(':');
  const company = roleParts.length ? cleanString(companyPart) : '';
  const role = cleanString(roleParts.length ? roleParts.join(':') : titleRaw);
  const locationParts = [region, country, state].map(cleanString).filter(Boolean);
  const location = [...new Set(locationParts)].join(', ');
  const metaLines = [
    `Source: We Work Remotely RSS (${sourceUrl})`,
    company ? `Company: ${company}` : '',
    role ? `Role: ${role}` : '',
    category ? `Category: ${category}` : '',
    type ? `Job type: ${type}` : '',
    location ? `WWR region/location: ${location}` : '',
    publishedAt ? `Published: ${publishedAt}` : '',
    expiresAt ? `Apply before: ${expiresAt}` : '',
  ].filter(Boolean);

  return {
    title: titleRaw,
    link,
    location,
    text: [
      '## We Work Remotely metadata',
      metaLines.join('\n'),
      '',
      '## Job description',
      descriptionText,
    ].join('\n').trim(),
  };
}

async function fetchWeWorkRemotelyJobDescriptionFromRss(jobUrl, { maxChars = 15000 } = {}) {
  if (!isWeWorkRemotelyJobUrl(jobUrl)) return null;
  const targetKey = normalizeUrlKey(jobUrl);
  for (const feedUrl of WEWORKREMOTELY_RSS_FEEDS) {
    let response;
    try {
      response = await fetch(feedUrl, {
        signal: AbortSignal.timeout(12000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; career-ops/1.0; +https://weworkremotely.com/rss)',
          'Accept': 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8',
        },
      });
    } catch (err) {
      console.warn(`[pipeline] [wwr-rss] failed ${feedUrl}: ${err.message}`);
      continue;
    }
    if (!response.ok) {
      console.warn(`[pipeline] [wwr-rss] HTTP ${response.status} ${feedUrl}`);
      continue;
    }

    const xml = await response.text();
    const itemRe = /<item>([\s\S]*?)<\/item>/gi;
    let match;
    while ((match = itemRe.exec(xml)) !== null) {
      const item = parseWeWorkRemotelyRssItem(match[1], feedUrl);
      const itemKeys = [item.link, readXmlTag(match[1], 'guid')].map(normalizeUrlKey).filter(Boolean);
      if (!itemKeys.includes(targetKey)) continue;
      return {
        ok: true,
        text: item.text.slice(0, maxChars),
        mode: 'wwr-rss',
        status: 200,
      };
    }
  }
  return null;
}

const SOURCE_JD_CACHE = new Map();

async function fetchJsonWithSourceCache(url, { timeoutMs = 20000 } = {}) {
  const key = String(url || '');
  if (!SOURCE_JD_CACHE.has(key)) {
    SOURCE_JD_CACHE.set(key, fetchJsonWithTimeout(key, { timeoutMs }));
  }
  return SOURCE_JD_CACHE.get(key);
}

function parseJobicyId(url = '') {
  try {
    const parsed = new URL(String(url || ''));
    const match = parsed.pathname.match(/\/jobs\/(\d+)(?:[-/]|$)/i);
    return match?.[1] || '';
  } catch {
    return '';
  }
}

function parseHimalayasPath(url = '') {
  try {
    const parsed = new URL(String(url || ''));
    const match = parsed.pathname.match(/\/companies\/([^/]+)\/jobs\/([^/?#]+)/i);
    return {
      companySlug: match?.[1] || '',
      jobSlug: match?.[2] || '',
    };
  } catch {
    return { companySlug: '', jobSlug: '' };
  }
}

function parseRemoteFirstPath(url = '') {
  try {
    const parsed = new URL(String(url || ''));
    const match = parsed.pathname.match(/\/companies\/([^/]+)\/jobs\/([^/?#]+)/i);
    if (!match) return { company: '', title: '' };
    const titleSlug = match[2].replace(/-\d+$/, '');
    return {
      company: match[1].split('-').map(part => part ? part[0].toUpperCase() + part.slice(1) : '').join(' '),
      title: titleSlug.split('-').map(part => part ? part[0].toUpperCase() + part.slice(1) : '').join(' '),
    };
  } catch {
    return { company: '', title: '' };
  }
}

function normalizeLoose(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function titleCompanyMatch(job = {}, hints = {}) {
  const title = normalizeLoose(job.title || job.jobTitle || job.name || job.text || job.job_title || '');
  const company = normalizeLoose(job.companyName || job.company?.name || job.company || job.company_name || '');
  const hintTitle = normalizeLoose(hints.title || '');
  const hintCompany = normalizeLoose(hints.company || '');
  const titleOk = !hintTitle || title.includes(hintTitle) || hintTitle.includes(title);
  const companyOk = !hintCompany || company.includes(hintCompany) || hintCompany.includes(company);
  return titleOk && companyOk;
}

function hasStrongJobHints(hints = {}) {
  return Boolean(normalizeLoose(hints.title || '') && normalizeLoose(hints.company || ''));
}

function formatSourceJobDescription(source, job = {}, targetUrl = '', { maxChars = 15000 } = {}) {
  const title = cleanString(job.title || job.jobTitle || job.name || job.text || job.job_title || '');
  const company = cleanString(job.companyName || job.company?.name || job.company || job.company_name || '');
  const location = cleanString(
    job.jobGeo ||
    job.location ||
    job.country ||
    (Array.isArray(job.locationRestrictions) ? job.locationRestrictions.join(', ') : '') ||
    (Array.isArray(job.timezoneRestrictions) ? `Timezone UTC ${job.timezoneRestrictions.join(', ')}` : '')
  );
  const jobType = cleanString(
    Array.isArray(job.jobType) ? job.jobType.join(', ') : (job.jobType || job.employmentType || job.type || '')
  );
  const salaryParts = [
    job.salaryMin || job.minSalary,
    job.salaryMax || job.maxSalary,
    job.salaryCurrency || job.currency,
    job.salaryPeriod,
  ].map(value => cleanString(value)).filter(Boolean);
  const publishedAt = normalizeDateValue(job.pubDate || job.publishedAt || job.createdAt || job.publication_date || '');
  const applyUrl = cleanString(
    job.url ||
    job.guid ||
    job.applicationLink ||
    job.applicationUrl ||
    job.link ||
    ((job.apply_options || []).find(opt => opt?.link) || {}).link ||
    ''
  );
  const rawDescription =
    job.jobDescription ||
    job.description ||
    job.content ||
    job.descriptionPlain ||
    job.jobExcerpt ||
    job.excerpt ||
    job.snippet ||
    '';
  const description = extractTextFromHtml(decodeHtmlEntitiesDeep(rawDescription));
  if (!description || description.length < 250) return null;

  const metaLines = [
    `Source fallback: ${source}`,
    targetUrl ? `Requested URL: ${targetUrl}` : '',
    applyUrl ? `Source/apply URL: ${applyUrl}` : '',
    company ? `Company: ${company}` : '',
    title ? `Role: ${title}` : '',
    location ? `Location / remote: ${location}` : '',
    jobType ? `Job type: ${jobType}` : '',
    salaryParts.length ? `Compensation: ${salaryParts.join(' ')}` : '',
    publishedAt ? `Published: ${publishedAt}` : '',
  ].filter(Boolean);

  return [
    '## Job metadata',
    metaLines.join('\n'),
    '',
    '## Job description',
    description,
  ].join('\n').slice(0, maxChars);
}

function isJobicyUrl(url = '') {
  try {
    return /(^|\.)jobicy\.com$/i.test(new URL(String(url || '')).hostname);
  } catch {
    return false;
  }
}

function isHimalayasUrl(url = '') {
  try {
    return /(^|\.)himalayas\.app$/i.test(new URL(String(url || '')).hostname);
  } catch {
    return false;
  }
}

function isRemotiveUrl(url = '') {
  try {
    return /(^|\.)remotive\.com$/i.test(new URL(String(url || '')).hostname);
  } catch {
    return false;
  }
}

function isRemoteFirstJobsUrl(url = '') {
  try {
    return /(^|\.)remotefirstjobs\.com$/i.test(new URL(String(url || '')).hostname);
  } catch {
    return false;
  }
}

async function fetchJobicyJobDescriptionFromApi(jobUrl, { maxChars = 15000, hints = {} } = {}) {
  if (!isJobicyUrl(jobUrl)) return null;
  const targetKey = normalizeUrlKey(jobUrl);
  const targetId = parseJobicyId(jobUrl);
  const tags = [...new Set(['product', 'design', 'management'])];
  const geos = ['', 'emea', 'europe', 'apac'];

  for (const tag of tags) {
    for (const geo of geos) {
      const params = new URLSearchParams({ count: '100', tag });
      if (geo) params.set('geo', geo);
      const data = await fetchJsonWithSourceCache(`https://jobicy.com/api/v2/remote-jobs?${params.toString()}`).catch(() => null);
      for (const job of (data?.jobs || [])) {
        const keys = [job.url, job.jobUrl, job.guid].map(normalizeUrlKey).filter(Boolean);
        const idOk = targetId && String(job.id || '') === targetId;
        const hintedOk = hasStrongJobHints(hints) && titleCompanyMatch(job, hints);
        if (!idOk && !keys.includes(targetKey) && !hintedOk) continue;
        const text = formatSourceJobDescription('Jobicy API', job, jobUrl, { maxChars });
        if (text) return { ok: true, text, mode: 'jobicy-api', status: 200 };
      }
    }
  }
  return null;
}

async function fetchHimalayasJobDescriptionFromApi(jobUrl, { maxChars = 15000, hints = {} } = {}) {
  if (!isHimalayasUrl(jobUrl)) return null;
  const targetKey = normalizeUrlKey(jobUrl);
  const { companySlug, jobSlug } = parseHimalayasPath(jobUrl);
  const queries = [...new Set([
    hints.title,
    jobSlug.split('-').join(' '),
    [hints.company, hints.title].filter(Boolean).join(' '),
  ].map(cleanString).filter(Boolean))];

  const considerJobs = (records = []) => {
    for (const job of records) {
      const keys = [job.applicationLink, job.applicationUrl, job.guid, job.url, job.link]
        .map(normalizeUrlKey)
        .filter(Boolean);
      const slugOk = jobSlug && (
        cleanString(job.guid).includes(`/jobs/${jobSlug}`) ||
        cleanString(job.applicationLink).includes(`/jobs/${jobSlug}`) ||
        slugify(job.title || '') === jobSlug
      );
      const companyOk = !companySlug || !job.companySlug || cleanString(job.companySlug) === companySlug;
      const hintedOk = hasStrongJobHints(hints) && titleCompanyMatch(job, hints);
      if (!keys.includes(targetKey) && !(slugOk && companyOk) && !hintedOk) continue;
      const text = formatSourceJobDescription('Himalayas API', job, jobUrl, { maxChars });
      if (text) return { ok: true, text, mode: 'himalayas-api', status: 200 };
    }
    return null;
  };

  for (const query of queries.slice(0, 4)) {
    const params = new URLSearchParams({ q: query, limit: '20', worldwide: 'true' });
    const data = await fetchJsonWithSourceCache(`https://himalayas.app/jobs/api/search?${params.toString()}`).catch(() => null);
    const records = Array.isArray(data) ? data : (data?.jobs || data?.data || []);
    const found = considerJobs(records);
    if (found) return found;
  }

  for (let offset = 0; offset < 500; offset += 20) {
    const data = await fetchJsonWithSourceCache(`https://himalayas.app/jobs/api?limit=20&offset=${offset}`).catch(() => null);
    const records = Array.isArray(data) ? data : (data?.jobs || data?.data || []);
    const found = considerJobs(records);
    if (found) return found;
    if (records.length < 20) break;
  }

  return null;
}

async function fetchRemotiveJobDescriptionFromApi(jobUrl, { maxChars = 15000, hints = {} } = {}) {
  if (!isRemotiveUrl(jobUrl)) return null;
  const targetKey = normalizeUrlKey(jobUrl);
  const data = await fetchJsonWithSourceCache('https://remotive.com/api/remote-jobs').catch(() => null);
  for (const job of (data?.jobs || [])) {
    const keys = [job.url].map(normalizeUrlKey).filter(Boolean);
    const hintedOk = hasStrongJobHints(hints) && titleCompanyMatch(job, hints);
    if (!keys.includes(targetKey) && !hintedOk) continue;
    const text = formatSourceJobDescription('Remotive API', job, jobUrl, { maxChars });
    if (text) return { ok: true, text, mode: 'remotive-api', status: 200 };
  }
  return null;
}

async function fetchGreenhouseJobDescriptionFromGuessedApi(jobUrl, { maxChars = 15000, hints = {} } = {}) {
  let parsed;
  try {
    parsed = new URL(String(jobUrl || ''));
  } catch {
    return null;
  }
  const jobId = parsed.searchParams.get('gh_jid') || (parsed.pathname.match(/\/jobs\/(\d+)/i) || [])[1] || '';
  if (!jobId) return null;
  const hostSlug = parsed.hostname.replace(/^www\./, '').split('.')[0];
  const candidates = [...new Set([
    hostSlug,
    hostSlug.replace(/[^a-z0-9]/gi, ''),
    slugify(hints.company || '').replace(/-/g, ''),
    slugify(hints.company || ''),
  ].map(value => cleanString(value).toLowerCase()).filter(Boolean))];

  for (const board of candidates) {
    const data = await fetchJsonWithSourceCache(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${jobId}`).catch(() => null);
    if (!data?.id && !data?.title) continue;
    const text = formatSourceJobDescription('Greenhouse API', {
      ...data,
      title: data.title,
      companyName: hints.company || board,
      location: data.location?.name || '',
      description: data.content || data.description || '',
      url: data.absolute_url || jobUrl,
      publishedAt: data.updated_at || data.first_published || '',
    }, jobUrl, { maxChars });
    if (text) return { ok: true, text, mode: 'greenhouse-api', status: 200 };
  }
  return null;
}

async function fetchGoogleJobsDescriptionFromHints(jobUrl, { maxChars = 15000, hints = {} } = {}) {
  const title = cleanString(hints.title || '');
  const company = cleanString(hints.company || '');
  const key = process.env.SEARCHAPI_KEY || SERPAPI_KEY;
  if (!key || !hasStrongJobHints(hints)) return null;

  const useSearchApi = Boolean(process.env.SEARCHAPI_KEY) && !SERPAPI_KEY;
  const baseUrl = useSearchApi
    ? 'https://www.searchapi.io/api/v1/search'
    : 'https://serpapi.com/search.json';
  const query = [title && `"${title}"`, company && `"${company}"`].filter(Boolean).join(' ');
  const params = new URLSearchParams({ engine: 'google_jobs', q: query, hl: 'en', api_key: key });
  const data = await fetchJsonWithSourceCache(`${baseUrl}?${params.toString()}`, { timeoutMs: 15000 }).catch(() => null);
  const records = data?.jobs_results || data?.jobs || [];
  for (const job of records) {
    if (!titleCompanyMatch({
      title: job.title,
      companyName: job.company_name,
    }, hints)) continue;
    const text = formatSourceJobDescription(`${useSearchApi ? 'SearchAPI' : 'SerpApi'} Google Jobs`, {
      ...job,
      companyName: job.company_name || company,
      description: job.description || job.snippet || '',
      location: job.location || (job.detected_extensions?.work_from_home ? 'Remote' : ''),
      url: ((job.apply_options || []).find(opt => opt?.link) || {}).link || job.share_link || job.link || jobUrl,
      publishedAt: job.detected_extensions?.posted_at || job.detected_extensions?.posted || job.posted_at || '',
    }, jobUrl, { maxChars });
    if (text) return { ok: true, text, mode: useSearchApi ? 'searchapi-google-jobs' : 'serpapi-google-jobs', status: 200 };
  }
  return null;
}

async function fetchKnownSourceJobDescription(jobUrl, { maxChars = 15000, logLabel = 'pipeline', hints = {} } = {}) {
  const attempts = [
    ['jobicy-api', () => fetchJobicyJobDescriptionFromApi(jobUrl, { maxChars, hints })],
    ['himalayas-api', () => fetchHimalayasJobDescriptionFromApi(jobUrl, { maxChars, hints })],
    ['remotive-api', () => fetchRemotiveJobDescriptionFromApi(jobUrl, { maxChars, hints })],
    ['greenhouse-api', () => fetchGreenhouseJobDescriptionFromGuessedApi(jobUrl, { maxChars, hints })],
    ['google-jobs', () => fetchGoogleJobsDescriptionFromHints(jobUrl, { maxChars, hints })],
  ];

  for (const [mode, run] of attempts) {
    try {
      const result = await run();
      if (result?.ok && result.text) {
        console.log(`[${logLabel}] [${mode}] fetched ${result.text.length} chars for ${jobUrl}`);
        return result;
      }
    } catch (err) {
      console.warn(`[${logLabel}] [${mode}] failed for ${jobUrl}: ${err.message}`);
    }
  }
  return null;
}

// Marker lists and the tiering rule live in lib/challenge-detect.mjs — one
// source of truth for every detector here (see tests/challenge-detect.test.mjs).
function isBlockedJobDescriptionResponse({ url = '', status = 200, html = '', text = '' } = {}) {
  const rawHtml = String(html || '');
  const bodyText = String(text || extractTextFromHtml(rawHtml));
  if (!bodyText) return true;
  if (detectChallenge({ status, html: rawHtml, text: bodyText }).blocked) return true;
  return /jobsdb\.com/i.test(url) && bodyText.length < 800;
}

// Headed-Chrome fallback for anti-bot / Cloudflare-protected job pages (LOCAL ONLY —
// never on Vercel serverless). Reuses the SAME persistent profile the apply-runner
// drives (data/chrome-profile), so a cf_clearance cookie solved once during an
// auto-apply run is reused here for free. If that profile is locked by a running
// Chrome, falls back to a dedicated persistent JD profile that accumulates its own
// clearance cookies. When a challenge is present, polls so a human can solve it once
// in the visible window; subsequent fetches on the same domain then pass automatically.
let _playwrightChromium = null;
async function getChromium() {
  if (!_playwrightChromium) ({ chromium: _playwrightChromium } = await import('playwright'));
  return _playwrightChromium;
}

async function fetchJobDescriptionViaBrowser(url, { maxChars = 15000, logLabel = 'pipeline', timeoutMs = 75000 } = {}) {
  if (IS_VERCEL) return { ok: false, status: 0, html: '', text: '', blocked: true, error: 'browser fallback unavailable on Vercel' };
  let chromium;
  try { chromium = await getChromium(); }
  catch (err) { return { ok: false, status: 0, html: '', text: '', blocked: true, error: `playwright unavailable: ${err.message}` }; }

  const profiles = [join(ROOT, 'data', 'chrome-profile'), join(WRITE_ROOT, 'data', 'chrome-jd-profile')];
  const launchOpts = { headless: process.env.SCAN_BROWSER_HEADLESS !== '0', viewport: null, args: ['--disable-blink-features=AutomationControlled', '--window-size=1280,920'] };
  let ctx = null, usedIsolated = false, lastErr;
  for (let i = 0; i < profiles.length && !ctx; i++) {
    for (const channel of ['chrome', undefined]) {
      try {
        ctx = await chromium.launchPersistentContext(profiles[i], channel ? { ...launchOpts, channel } : launchOpts);
        usedIsolated = i > 0;
        break;
      } catch (err) { lastErr = err; }
    }
  }
  if (!ctx) return { ok: false, status: 0, html: '', text: '', blocked: true, error: `browser launch failed: ${lastErr?.message || 'unknown'}` };

  try {
    await ctx.addInitScript(() => {
      try {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        window.chrome = window.chrome || { runtime: {} };
      } catch { /* best effort */ }
    }).catch(() => {});
    const page = ctx.pages()[0] || await ctx.newPage();
    console.log(`[${logLabel}] [browser] navigating (${usedIsolated ? 'isolated JD' : 'shared apply'} profile) → ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});

    const deadline = Date.now() + timeoutMs;
    let html = '', text = '', blocked = true, announced = false;
    do {
      await page.waitForTimeout(2500);
      html = await page.content().catch(() => '');
      text = extractTextFromHtml(html);
      blocked = isBlockedJobDescriptionResponse({ url, status: 200, html, text });
      if (!blocked && text && text.length > 400) {
        console.log(`[${logLabel}] [browser] challenge cleared — ${text.length} chars for ${url}`);
        return { ok: true, status: 200, html, text, blocked: false };
      }
      if (blocked && !announced) {
        console.log(`[${logLabel}] [browser] anti-bot challenge present — solve it in the Chrome window (waiting up to ${Math.round(timeoutMs / 1000)}s)…`);
        announced = true;
      }
    } while (Date.now() < deadline);
    return { ok: !blocked, status: 200, html, text, blocked };
  } finally {
    await ctx.close().catch(() => {});
  }
}

async function fetchJobDescriptionText(jobUrl, { maxChars = 15000, logLabel = 'pipeline', hintCompany = '', hintTitle = '', note = '' } = {}) {
  const url = String(jobUrl || '').trim();
  if (!url) return { ok: false, text: '', mode: 'none', error: 'Missing URL' };
  const noteParts = extractPipelineNoteParts(note || '');
  const remoteFirstParts = parseRemoteFirstPath(url);
  const hints = {
    company: cleanString(hintCompany || noteParts.company || remoteFirstParts.company || ''),
    title: cleanString(hintTitle || noteParts.title || remoteFirstParts.title || ''),
  };

  if (isWeWorkRemotelyJobUrl(url)) {
    const rssResult = await fetchWeWorkRemotelyJobDescriptionFromRss(url, { maxChars });
    if (rssResult?.ok && rssResult.text) {
      console.log(`[${logLabel}] [wwr-rss] fetched ${rssResult.text.length} chars for ${url}`);
      return rssResult;
    }
  }

  const knownSourceResult = await fetchKnownSourceJobDescription(url, { maxChars, logLabel, hints });
  if (knownSourceResult?.ok && knownSourceResult.text) {
    return knownSourceResult;
  }

  const fetchViaHttp = async () => {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; career-ops/1.0)',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    const html = await response.text();
    const text = extractTextFromHtml(html);
    return {
      ok: response.ok,
      status: response.status,
      html,
      text,
      blocked: isBlockedJobDescriptionResponse({ url, status: response.status, html, text }),
    };
  };

  const fetchViaPinchtab = async () => {
    if (!(await pinchtabHealth())) {
      throw new Error('pinchtab daemon not reachable');
    }
    let tabId;
    try {
      tabId = await pinchtabNavigate(url, { timeout: 25000 });
      await new Promise(resolve => setTimeout(resolve, 1500));
      let html = await pinchtabEvaluate(tabId, 'document.documentElement.outerHTML', { timeout: 10000 });
      let text = extractTextFromHtml(String(html || ''));
      let blocked = isBlockedJobDescriptionResponse({ url, status: 200, html, text });
      if (blocked && !pinchtabSolveCircuitOpen()) {
        console.log(`[${logLabel}] [pinchtab] challenge detected, attempting solve for ${url}`);
        const solved = await pinchtabSolve(tabId);
        if (solved) {
          await new Promise(resolve => setTimeout(resolve, 1200));
          html = await pinchtabEvaluate(tabId, 'document.documentElement.outerHTML', { timeout: 10000 });
          text = extractTextFromHtml(String(html || ''));
          blocked = isBlockedJobDescriptionResponse({ url, status: 200, html, text });
        }
      }
      return {
        ok: true,
        status: 200,
        html: String(html || ''),
        text,
        blocked,
      };
    } finally {
      await pinchtabClose(tabId);
    }
  };

  const preferBrowser = shouldUseBrowserForJobDescription(url);
  const attempts = preferBrowser
    ? [
        { mode: 'pinchtab', run: fetchViaPinchtab },
        { mode: 'fetch', run: fetchViaHttp },
      ]
    : [
        { mode: 'fetch', run: fetchViaHttp },
        { mode: 'pinchtab', run: fetchViaPinchtab },
      ];

  let lastError = '';
  for (const attempt of attempts) {
    try {
      const result = await attempt.run();
      if (result.ok && !result.blocked && result.text) {
        console.log(`[${logLabel}] [${attempt.mode}] fetched ${result.text.length} chars for ${url}`);
        return {
          ok: true,
          text: result.text.slice(0, maxChars),
          mode: attempt.mode,
          status: result.status,
        };
      }

      lastError = result.blocked
        ? `Blocked by anti-bot/challenge (${attempt.mode}, status ${result.status})`
        : `Failed to load content (${attempt.mode}, status ${result.status})`;
      console.warn(`[${logLabel}] [${attempt.mode}] ${lastError} for ${url}`);
    } catch (err) {
      lastError = `${attempt.mode}: ${err.message}`;
      console.warn(`[${logLabel}] [${attempt.mode}] failed for ${url}: ${err.message}`);
    }
  }

  const lateKnownSourceResult = await fetchKnownSourceJobDescription(url, { maxChars, logLabel, hints });
  if (lateKnownSourceResult?.ok && lateKnownSourceResult.text) {
    return lateKnownSourceResult;
  }

  // Last resort: headed Chrome with the persistent (apply-runner) profile — the only
  // path that clears Cloudflare/anti-bot challenges. Local only; skipped on Vercel.
  if (!IS_VERCEL) {
    try {
      const browserResult = await fetchJobDescriptionViaBrowser(url, { maxChars, logLabel });
      if (browserResult.ok && !browserResult.blocked && browserResult.text) {
        console.log(`[${logLabel}] [browser] fetched ${browserResult.text.length} chars for ${url}`);
        return { ok: true, text: browserResult.text.slice(0, maxChars), mode: 'browser', status: browserResult.status };
      }
      lastError = browserResult.error || `Blocked by anti-bot/challenge (browser, status ${browserResult.status})`;
      console.warn(`[${logLabel}] [browser] ${lastError} for ${url}`);
    } catch (err) {
      lastError = `browser: ${err.message}`;
      console.warn(`[${logLabel}] [browser] failed for ${url}: ${err.message}`);
    }
  }

  return { ok: false, text: '', mode: 'failed', error: lastError || 'Unknown fetch error' };
}

function mergePublishedDates(index, jobs = []) {
  jobs.forEach(job => {
    const publishedAt = normalizeDateValue(job?.publishedAt || '');
    if (!publishedAt || !/^\d{4}-\d{2}-\d{2}$/.test(publishedAt)) return;
    const urlRaw = String(job?.url || '').trim();
    if (!urlRaw) return;
    const keys = [urlRaw, normalizeUrlKey(urlRaw)].filter(Boolean);
    keys.forEach(key => {
      const existing = index.get(key);
      if (!existing || publishedAt < existing) index.set(key, publishedAt);
    });
  });
}

async function fetchSourceSection(source = {}) {
  const { name, url, type, query = '', careers_url = '' } = source;
  const provider = inferApiProviderFromUrl(url);
  const logType = provider || type;
  const fallbackSource = {
    name,
    query,
    careers_url,
  };
  const fallbackToSecondarySource = async (reason) => {
    if (fallbackSource.query) {
      console.warn(`[scan] [${logType.toUpperCase()}] Falling back to web search for "${name}" (${reason})`);
      return fetchWebSearchSection(fallbackSource);
    }
    if (fallbackSource.careers_url) {
      console.warn(`[scan] [${logType.toUpperCase()}] Falling back to careers_url pinchtab for "${name}" (${reason})`);
      return fetchCareersUrlFallback(fallbackSource);
    }
    return { ok: false, section: null, jobs: [], engine: `${logType}-api`, error: reason };
  };

  console.log(`[scan] [${logType.toUpperCase()}] Fetching "${name}" → ${url}`);
  // Some feeds (e.g. Jobicy RSS) reject default Node requests with HTTP 403.
  // Send a realistic browser UA + Accept header tuned to the source type.
  const fetchHeaders = {
    'User-Agent': nextDdgUserAgent(),
    'Accept': type === 'json'
      ? 'application/json, */*;q=0.5'
      : 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5',
    'Accept-Language': 'en-US,en;q=0.9',
  };
  let r;
  try {
    r = await fetch(url, { signal: AbortSignal.timeout(20000), headers: fetchHeaders });
  } catch (err) {
    console.error(`[scan] [${logType.toUpperCase()}] TIMEOUT/ERROR "${name}": ${err.message}`);
    return fallbackToSecondarySource(`network error: ${err.message}`);
  }
  if (!r.ok) {
    console.error(`[scan] [${logType.toUpperCase()}] HTTP ${r.status} "${name}"`);
    return fallbackToSecondarySource(`HTTP ${r.status}`);
  }

  let jobs = [];
  if (type === 'json') {
    let data;
    try {
      data = await r.json();
    } catch (err) {
      console.error(`[scan] [${logType.toUpperCase()}] Invalid JSON "${name}": ${err.message}`);
      return fallbackToSecondarySource(`invalid JSON: ${err.message}`);
    }

    if (provider === 'ashby') {
      jobs = (data.jobs || [])
        .filter(job => job?.isListed !== false)
        .map(job => {
          const secondaryLocations = Array.isArray(job.secondaryLocations)
            ? job.secondaryLocations.map(location => cleanString(location?.location || '')).filter(Boolean)
            : [];
          const location = cleanString([job.location, ...secondaryLocations].filter(Boolean).join(', '));
          const remoteEvidence = cleanString([...new Set([
            location,
            job.workplaceType || '',
            job.isRemote ? 'Remote' : '',
          ].filter(Boolean))].join(' | '));
          return {
            title: cleanString(job.title || ''),
            url: cleanString(job.jobUrl || job.applyUrl || ''),
            location,
            remoteEvidence,
            publishedAt: normalizeDateValue(job.publishedAt || ''),
          };
        });
    } else if (provider === 'lever') {
      const records = Array.isArray(data) ? data : (data.data || data.postings || []);
      jobs = records.map(job => {
        const categories = job.categories || {};
        const allLocations = Array.isArray(categories.allLocations) ? categories.allLocations : [];
        const location = cleanString(
          categories.location ||
          allLocations.join(', ') ||
          job.location ||
          ''
        );
        const remoteEvidence = cleanString([
          location,
          job.workplaceType || '',
          job.descriptionPlain || '',
        ].filter(Boolean).join(' | ')).slice(0, 240);
        return {
          title: cleanString(job.text || job.title || ''),
          url: cleanString(job.hostedUrl || job.applyUrl || job.url || ''),
          location,
          remoteEvidence,
          publishedAt: normalizeDateValue(job.createdAt || job.updatedAt || ''),
        };
      });
    } else {
      jobs = (data.jobs || []).map(job => ({
        title: job.title || '',
        url: job.absolute_url || '',
        location: cleanString(
          job.location?.name ||
          job.location ||
          (Array.isArray(job.offices)
            ? job.offices
                .map(office => cleanString(office?.name || office?.location?.name || office?.location || ''))
                .filter(Boolean)
                .join(', ')
            : '')
        ),
        remoteEvidence: cleanString(
          job.location?.name ||
          job.location ||
          (Array.isArray(job.offices)
            ? job.offices
                .map(office => cleanString(office?.name || office?.location?.name || office?.location || ''))
                .filter(Boolean)
                .join(', ')
            : '')
        ),
        publishedAt: normalizeDateValue(
          job.published_at ||
          job.publishedAt ||
          job.created_at ||
          job.createdAt ||
          job.updated_at ||
          job.updatedAt ||
          job.date_posted ||
          job.datePosted ||
          ''
        ),
      }));
    }
    console.log(`[scan] [${logType.toUpperCase()}] "${name}" → ${jobs.length} jobs total, ${jobs.filter(j => DIRECT_JOB_FILTER_REGEX.test(j.title)).length} after title filter`);
  } else if (type === 'rss') {
    const txt = await r.text();
    const itemRe = /<(item|entry)[^>]*>([\s\S]*?)<\/\1>/gi;
    let match;
    while ((match = itemRe.exec(txt)) !== null) {
      const section = match[2];
      const title = readXmlTag(section, 'title');
      let link = readXmlTag(section, 'link');
      if (!link) {
        const hrefMatch = section.match(/<link[^>]+href=["']([^"']+)["']/i);
        if (hrefMatch) link = hrefMatch[1];
      }
      if (!link) {
        link = readXmlTag(section, 'guid') || readXmlTag(section, 'id');
      }
      const publishedAt = readXmlTag(section, 'pubDate') ||
        readXmlTag(section, 'published') ||
        readXmlTag(section, 'updated') ||
        readXmlTag(section, 'dc:date');
      if (title && link) {
        const region = readXmlTag(section, 'region');
        const country = readXmlTag(section, 'country');
        const state = readXmlTag(section, 'state');
        const rawDesc = readXmlTag(section, 'content:encoded') ||
          readXmlTag(section, 'description') ||
          readXmlTag(section, 'content') ||
          readXmlTag(section, 'summary');
        const descriptionText = extractTextFromHtml(decodeHtmlEntitiesDeep(rawDesc));
        const location = [...new Set([region, country, state].map(cleanString).filter(Boolean))].join(', ');
        jobs.push({
          title,
          url: link,
          location,
          remoteEvidence: cleanString([location, descriptionText].filter(Boolean).join(' | ')).slice(0, 240),
          publishedAt: normalizeDateValue(publishedAt),
        });
      }
    }
    console.log(`[scan] [RSS] "${name}" → ${jobs.length} items, ${jobs.filter(j => DIRECT_JOB_FILTER_REGEX.test(j.title)).length} after title filter`);
  }

  return { ok: true, section: buildJobSection(name, jobs), jobs, engine: provider ? `${provider}-api` : type };
}

async function fetchSerpApiSection({ name, query }) {
  const useSearchApi = Boolean(process.env.SEARCHAPI_KEY) && !process.env.SERPAPI_KEY;
  const selectedApiKey = useSearchApi ? process.env.SEARCHAPI_KEY : SERPAPI_KEY;
  if (!selectedApiKey || !query) return { ok: false, section: null };
  const useOrganicSearch = /\bsite:|jobs\.(ashbyhq|lever)\.com|job-boards\.greenhouse\.io|careers\b/i.test(query);

  const baseUrl = useSearchApi
    ? 'https://www.searchapi.io/api/v1/search'
    : 'https://serpapi.com/search.json';
  const engine = useOrganicSearch ? 'google' : 'google_jobs';
  const apiLabel = useSearchApi ? 'SearchAPI' : 'SerpApi';

  console.log(`[scan] [${apiLabel}/${engine}] "${name}" → q: ${query.slice(0, 80)}...`);

  const params = new URLSearchParams({
    engine,
    q: query,
    hl: 'en',
    api_key: selectedApiKey,
  });

  let r;
  try {
    r = await fetch(`${baseUrl}?${params.toString()}`, { signal: AbortSignal.timeout(15000) });
  } catch (err) {
    console.error(`[scan] [${apiLabel}] TIMEOUT/ERROR "${name}": ${err.message}`);
    return { ok: false, section: null };
  }
  if (!r.ok) {
    const errText = await r.text().catch(() => '');
    console.error(`[scan] [${apiLabel}] HTTP ${r.status} "${name}": ${errText.slice(0, 200)}`);
    if (r.status === 401 || r.status === 403 || r.status === 429) tripSerpApiCircuit(`returned HTTP ${r.status}`);
    return { ok: false, section: null };
  }

  const data = await r.json();
  if (useOrganicSearch) {
    const jobs = (data.organic_results || []).map(result => ({
      title: result.title || '',
      url: result.link || '',
      location: cleanString(result.snippet || ''),
      remoteEvidence: cleanString(result.snippet || ''),
    }));
    console.log(`[scan] [${apiLabel}/organic] "${name}" → ${jobs.length} results, ${jobs.filter(j => DIRECT_JOB_FILTER_REGEX.test(j.title)).length} after filter`);
    return { ok: true, section: buildJobSection(name, jobs), jobs, engine: `${apiLabel.toLowerCase()}-organic` };
  }

  const jobs = (data.jobs_results || data.jobs || []).map(job => ({
    title: job.title || '',
    company: job.company_name || '',
    url: (job.apply_options || []).find(opt => opt?.link)?.link || job.share_link || job.link || '',
    location: cleanString(
      job.location ||
      job.detected_extensions?.schedule_type ||
      (job.detected_extensions?.work_from_home ? 'Remote' : '')
    ),
    remoteEvidence: cleanString(
      job.location ||
      job.detected_extensions?.schedule_type ||
      (job.detected_extensions?.work_from_home ? 'Remote' : '')
    ),
    publishedAt: normalizeDateValue(
      job.detected_extensions?.posted_at ||
      job.detected_extensions?.posted ||
      job.posted_at ||
      job.created_at ||
      ''
    ),
  }));
  console.log(`[scan] [${apiLabel}/jobs] "${name}" → ${jobs.length} results, ${jobs.filter(j => DIRECT_JOB_FILTER_REGEX.test(j.title)).length} after filter`);
  return { ok: true, section: buildJobSection(name, jobs, { includeCompany: true }), jobs, engine: `${apiLabel.toLowerCase()}-jobs` };
}

async function fetchDuckDuckGoSection({ name, query }) {
  if (!query) return { ok: false, section: null };

  // Serialize + throttle: DDG challenge pages are triggered by parallel bursts
  await ddgThrottle();

  console.log(`[scan] [DuckDuckGo] "${name}" → q: ${query.slice(0, 80)}...`);
  // POST is less flagged than GET on the HTML endpoint
  const body = new URLSearchParams({ q: query, kl: 'wt-wt', b: '', df: '' });
  const ua = nextDdgUserAgent();
  let r;
  try {
    r = await fetch(DUCKDUCKGO_HTML_SEARCH_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(20000),
      headers: {
        'User-Agent': ua,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': 'https://duckduckgo.com',
        'Referer': 'https://duckduckgo.com/',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-User': '?1',
      },
      body: body.toString(),
    });
  } catch (err) {
    console.error(`[scan] [DuckDuckGo] TIMEOUT/ERROR "${name}": ${err.message}`);
    return { ok: false, section: null, jobs: [], engine: 'duckduckgo-html', error: err.message };
  }
  if (!r.ok) {
    console.error(`[scan] [DuckDuckGo] HTTP ${r.status} "${name}"`);
    return { ok: false, section: null, jobs: [], engine: 'duckduckgo-html', error: `HTTP ${r.status}` };
  }

  const html = await r.text();
  if (detectChallenge({ html, text: html }).blocked) {
    console.warn(`[scan] [DuckDuckGo] Challenge page detected for "${name}"`);
    return { ok: false, section: null, jobs: [], engine: 'duckduckgo-html', error: 'challenge page' };
  }
  const resultAnchors = [
    ...html.matchAll(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi),
    ...html.matchAll(/<a[^>]*class="[^"]*result-link[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi),
  ];
  const jobs = resultAnchors.map(([, href, title]) => ({
    title: normalizeSearchResultTitle(title),
    url: decodeDuckDuckGoResultUrl(href),
  })).filter(job => /^https?:\/\//i.test(job.url));

  console.log(`[scan] [DuckDuckGo] "${name}" → ${jobs.length} results, ${jobs.filter(j => DIRECT_JOB_FILTER_REGEX.test(j.title)).length} after filter`);
  return { ok: true, section: buildJobSection(name, jobs), jobs, engine: 'duckduckgo-html' };
}

async function fetchBraveSection({ name, query }) {
  const braveKey = process.env.BRAVE_API_KEY;
  if (!braveKey || !query) return { ok: false, section: null, jobs: [], engine: 'brave' };

  console.log(`[scan] [Brave] "${name}" → q: ${query.slice(0, 80)}...`);
  const params = new URLSearchParams({ q: query, count: '10', search_lang: 'en' });
  let r;
  try {
    r = await fetch(`https://api.search.brave.com/res/v1/web/search?${params.toString()}`, {
      signal: AbortSignal.timeout(15000),
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': braveKey,
      },
    });
  } catch (err) {
    console.error(`[scan] [Brave] TIMEOUT/ERROR "${name}": ${err.message}`);
    return { ok: false, section: null, jobs: [], engine: 'brave' };
  }
  if (!r.ok) {
    const errText = await r.text().catch(() => '');
    console.error(`[scan] [Brave] HTTP ${r.status} "${name}": ${errText.slice(0, 200)}`);
    return { ok: false, section: null, jobs: [], engine: 'brave' };
  }

  const data = await r.json();
  const jobs = (data.web?.results || []).map(result => ({
    title: result.title || '',
    url: result.url || '',
    location: cleanString(result.description || ''),
    remoteEvidence: cleanString(result.description || ''),
  }));
  console.log(`[scan] [Brave] "${name}" → ${jobs.length} results, ${jobs.filter(j => DIRECT_JOB_FILTER_REGEX.test(j.title)).length} after filter`);
  return { ok: jobs.length > 0, section: buildJobSection(name, jobs), jobs, engine: 'brave' };
}

async function fetchCareersUrlFallback(source) {
  if (!source?.careers_url) return { ok: false, section: null, jobs: [], engine: 'playwright-fallback' };
  const [result] = await fetchPlaywrightSections([{ name: source.name, careers_url: source.careers_url }]);
  return result || { ok: false, section: null, jobs: [], engine: 'playwright-fallback' };
}

async function launchLocalBrowserContext({ profilePrefix = 'career-ops-browser-profile-' } = {}) {
  if (IS_VERCEL) throw new Error('local browser unavailable on Vercel');
  const chromium = await getChromium();
  const persistentProfiles = [
    join(WRITE_ROOT, 'data', 'chrome-search-profile'),
    join(WRITE_ROOT, 'data', 'chrome-scan-profile'),
    join(ROOT, 'data', 'chrome-profile'),
  ];
  const launchOpts = {
    headless: process.env.SCAN_BROWSER_HEADLESS !== '0',
    viewport: null,
    args: ['--disable-blink-features=AutomationControlled', '--window-size=1280,920'],
  };

  let tempProfile = null;
  try {
    tempProfile = await mkdtemp(join(tmpdir(), profilePrefix));
  } catch {
    tempProfile = null;
  }

  let ctx = null;
  let lastErr = null;
  for (const profile of [...persistentProfiles, tempProfile].filter(Boolean)) {
    for (const channel of ['chrome', undefined]) {
      try {
        ctx = await chromium.launchPersistentContext(profile, channel ? { ...launchOpts, channel } : launchOpts);
        return { ctx, tempProfile, headless: launchOpts.headless };
      } catch (err) {
        lastErr = err;
      }
    }
  }

  if (tempProfile) await rm(tempProfile, { recursive: true, force: true }).catch(() => {});
  throw new Error(lastErr?.message || 'browser launch failed');
}

async function fetchLocalBrowserGoogleSection({ name, query }, sharedBrowser = null) {
  if (!query) return { ok: false, section: null, jobs: [], engine: 'local-browser-google' };
  if (IS_VERCEL) return { ok: false, section: null, jobs: [], engine: 'local-browser-google', error: 'local browser unavailable on Vercel' };

  await pinchtabSearchThrottle();

  let local = null;
  let ownBrowser = false;
  try {
    local = sharedBrowser || await launchLocalBrowserContext({ profilePrefix: 'career-ops-search-profile-' });
    ownBrowser = !sharedBrowser;
    const page = local.ctx.pages()[0] || await local.ctx.newPage();
    const searchUrl = `https://www.google.com/search?hl=en&num=10&q=${encodeURIComponent(query)}`;
    console.log(`[scan] [Chrome/Google] "${name}" → q: ${query.slice(0, 80)}...`);
    const response = await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (response && response.status() >= 400) throw new Error(`Google HTTP ${response.status()}`);
    await page.waitForTimeout(2200);

    let result = await page.evaluate(PINCHTAB_GOOGLE_SEARCH_EXTRACT_SCRIPT).catch(() => ({}));
    let jobs = Array.isArray(result?.jobs) ? result.jobs : [];
    let bodyText = cleanString(result?.bodyText || await page.evaluate(PAGE_BODY_TEXT_EXPR).catch(() => '') || '');

    if (!jobs.length && looksLikeChallengePage(bodyText) && !local.headless) {
      console.log(`[scan] [Chrome/Google] "${name}" challenge wall — solve it in the Chrome window (waiting up to 45s)…`);
      const deadline = Date.now() + 45000;
      while (Date.now() < deadline && !jobs.length && !isShuttingDown) {
        await page.waitForTimeout(3000);
        result = await page.evaluate(PINCHTAB_GOOGLE_SEARCH_EXTRACT_SCRIPT).catch(() => ({}));
        jobs = Array.isArray(result?.jobs) ? result.jobs : [];
        bodyText = cleanString(result?.bodyText || await page.evaluate(PAGE_BODY_TEXT_EXPR).catch(() => '') || '');
        if (!looksLikeChallengePage(bodyText)) break;
      }
    }

    if (!jobs.length && looksLikeChallengePage(bodyText)) {
      console.warn(`[scan] [Chrome/Google] Challenge page detected for "${name}"`);
      return { ok: false, section: null, jobs: [], engine: 'local-browser-google', error: 'challenge page' };
    }

    jobs = await enrichLocalJobsWithDetails(local.ctx, jobs, name);

    console.log(`[scan] [Chrome/Google] "${name}" → ${jobs.length} results, ${jobs.filter(j => DIRECT_JOB_FILTER_REGEX.test(j.title)).length} after filter`);
    return { ok: true, section: buildJobSection(name, jobs), jobs, engine: 'local-browser-google' };
  } catch (err) {
    console.error(`[scan] [Chrome/Google] Failed "${name}": ${err.message}`);
    return { ok: false, section: null, jobs: [], engine: 'local-browser-google', error: err.message };
  } finally {
    if (ownBrowser) {
      await local?.ctx?.close().catch(() => {});
      if (local?.tempProfile) await rm(local.tempProfile, { recursive: true, force: true }).catch(() => {});
    }
  }
}

const PINCHTAB_GOOGLE_SEARCH_EXTRACT_SCRIPT = `(() => {
  const normalizeText = value => String(value || '').replace(/\\s+/g, ' ').trim();
  const navLike = /^(read more|learn more|apply now|view all|see all|more)$/i;
  const decodeHref = href => {
    try {
      const parsed = new URL(String(href || ''), window.location.origin);
      if (parsed.pathname === '/url') {
        return parsed.searchParams.get('q') || '';
      }
      return parsed.href || '';
    } catch {
      return String(href || '');
    }
  };
  const isGoogleHost = host => /(^|\\.)google\\./i.test(host || '');
  const seen = new Set();
  const results = [];

  document.querySelectorAll('a[href]').forEach(anchor => {
    const title = normalizeText(
      (anchor.querySelector('h3') || {}).textContent ||
      anchor.getAttribute('aria-label') ||
      anchor.textContent
    );
    if (!title || title.length < 4 || title.length > 220) return;
    if (navLike.test(title)) return;

    const decodedHref = decodeHref(anchor.getAttribute('href') || anchor.href || '');
    if (!/^https?:\\/\\//i.test(decodedHref)) return;

    let host = '';
    try { host = new URL(decodedHref).hostname || ''; } catch {}
    if (!host || isGoogleHost(host)) return;

    const card = anchor.closest('div[data-snc], div.g, div[lang], article, section, div');
    const snippet = normalizeText((card && card.innerText) || '').replace(title, '').trim();
    const key = decodedHref + '::' + title.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);

    results.push({
      title,
      url: decodedHref,
      location: snippet,
      remoteEvidence: snippet,
    });
  });

  return {
    title: document.title || '',
    bodyText: normalizeText(document.body && document.body.innerText || '').slice(0, 4000),
    jobs: results.slice(0, 20),
  };
})()`;

const PINCHTAB_BRAVE_SEARCH_EXTRACT_SCRIPT = `(() => {
  const normalizeText = value => String(value || '').replace(/\\s+/g, ' ').trim();
  const seen = new Set();
  const results = [];
  document.querySelectorAll('.snippet[data-type="web"]').forEach(snippet => {
    const anchor = snippet.querySelector('a[href]');
    if (!anchor) return;
    const url = anchor.href || '';
    if (!/^https?:\\/\\//i.test(url)) return;
    let host = '';
    try { host = new URL(url).hostname || ''; } catch {}
    if (/(^|\\.)brave\\./i.test(host)) return;
    const title = normalizeText(
      (snippet.querySelector('.title') || {}).textContent ||
      anchor.getAttribute('aria-label') ||
      anchor.textContent
    );
    if (!title || title.length < 4 || title.length > 220) return;
    const desc = normalizeText((snippet.querySelector('.snippet-description') || {}).textContent || '');
    const key = url + '::' + title.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    results.push({ title, url, location: desc, remoteEvidence: desc });
  });
  return {
    title: document.title || '',
    bodyText: normalizeText(document.body && document.body.innerText || '').slice(0, 4000),
    jobs: results.slice(0, 20),
  };
})()`;

const PAGE_BODY_TEXT_EXPR = '(document.body && document.body.innerText || "").slice(0, 2000)';

function looksLikeChallengePage(bodyText = '') {
  return matchChallengeText(bodyText) !== null;
}

async function smartSolveAndReExtract({ tabId, jobs, bodyText, extractScript, label }) {
  if (jobs.length || !looksLikeChallengePage(bodyText)) return jobs;
  if (pinchtabSolveCircuitOpen()) {
    return jobs;
  }
  console.log(`[scan] [${label}] challenge detected, attempting solve...`);
  let solved = await pinchtabSolve(tabId);
  if (!solved && !pinchtabSolveCircuitOpen()) {
    // Brief cooldown then retry once — some Turnstile/reCAPTCHA flows accept the
    // second attempt after the iframe has settled. Skip if circuit is now open.
    console.log(`[scan] [${label}] first solve attempt failed, cooling down 4s and retrying...`);
    await new Promise(r => setTimeout(r, 4000));
    solved = await pinchtabSolve(tabId, { maxAttempts: 4, timeout: 30000 });
  }
  if (!solved) {
    console.warn(`[scan] [${label}] solve failed`);
    return jobs;
  }
  console.log(`[scan] [${label}] solved, re-extracting...`);
  await new Promise(r => setTimeout(r, 1200));
  const retry = await pinchtabEvaluate(tabId, extractScript, { awaitPromise: false, timeout: 12000 }) || {};
  return Array.isArray(retry.jobs) ? retry.jobs : jobs;
}

async function fetchPinchtabBraveSection({ name, query }) {
  if (!query) return { ok: false, section: null, jobs: [], engine: 'pinchtab-brave' };
  if (!(await pinchtabIsUp())) {
    return { ok: false, section: null, jobs: [], engine: 'pinchtab-brave', error: 'pinchtab daemon not reachable' };
  }

  await pinchtabSearchThrottle();

  let tabId;
  try {
    const searchUrl = `https://search.brave.com/search?q=${encodeURIComponent(query)}`;
    console.log(`[scan] [PinchTab/Brave] "${name}" → q: ${query.slice(0, 80)}...`);
    tabId = await pinchtabNavigate(searchUrl, { timeout: 25000 });
    await new Promise(resolve => setTimeout(resolve, 1500));
    const result = await pinchtabEvaluate(tabId, PINCHTAB_BRAVE_SEARCH_EXTRACT_SCRIPT, { awaitPromise: false, timeout: 12000 }) || {};
    let jobs = Array.isArray(result.jobs) ? result.jobs : [];
    const bodyText = cleanString(result.bodyText || '');
    jobs = await smartSolveAndReExtract({ tabId, jobs, bodyText, extractScript: PINCHTAB_BRAVE_SEARCH_EXTRACT_SCRIPT, label: 'PinchTab/Brave' });

    if (!jobs.length && looksLikeChallengePage(bodyText)) {
      console.warn(`[scan] [PinchTab/Brave] Challenge page detected for "${name}" (solve unsuccessful)`);
      return { ok: false, section: null, jobs: [], engine: 'pinchtab-brave', error: 'challenge page' };
    }

    console.log(`[scan] [PinchTab/Brave] "${name}" → ${jobs.length} results, ${jobs.filter(j => DIRECT_JOB_FILTER_REGEX.test(j.title)).length} after filter`);
    return { ok: jobs.length > 0, section: buildJobSection(name, jobs), jobs, engine: 'pinchtab-brave' };
  } catch (err) {
    console.error(`[scan] [PinchTab/Brave] Failed "${name}": ${err.message}`);
    return { ok: false, section: null, jobs: [], engine: 'pinchtab-brave', error: err.message };
  } finally {
    await pinchtabClose(tabId);
  }
}

async function fetchPinchtabSearchSection({ name, query }) {
  if (!query) return { ok: false, section: null, jobs: [], engine: 'pinchtab-google' };
  if (!(await pinchtabIsUp())) {
    return { ok: false, section: null, jobs: [], engine: 'pinchtab-google', error: 'pinchtab daemon not reachable' };
  }

  await pinchtabSearchThrottle();

  let tabId;
  try {
    const searchUrl = `https://www.google.com/search?hl=en&num=10&q=${encodeURIComponent(query)}`;
    console.log(`[scan] [PinchTab/Google] "${name}" → q: ${query.slice(0, 80)}...`);
    tabId = await pinchtabNavigate(searchUrl, { timeout: 25000 });
    await new Promise(resolve => setTimeout(resolve, 1800));
    const result = await pinchtabEvaluate(tabId, PINCHTAB_GOOGLE_SEARCH_EXTRACT_SCRIPT, { awaitPromise: false, timeout: 12000 }) || {};
    let jobs = Array.isArray(result.jobs) ? result.jobs : [];
    const bodyText = cleanString(result.bodyText || '');
    if (/server encountered a temporary error|502\.?\s+that.s an error|503 service unavailable/i.test(bodyText)) {
      throw new Error('Google returned a temporary server error');
    }
    jobs = await smartSolveAndReExtract({ tabId, jobs, bodyText, extractScript: PINCHTAB_GOOGLE_SEARCH_EXTRACT_SCRIPT, label: 'PinchTab/Google' });

    if (!jobs.length && looksLikeChallengePage(bodyText)) {
      console.warn(`[scan] [PinchTab/Google] Challenge page detected for "${name}" (solve unsuccessful)`);
      return { ok: false, section: null, jobs: [], engine: 'pinchtab-google', error: 'challenge page' };
    }

    console.log(`[scan] [PinchTab/Google] "${name}" → ${jobs.length} results, ${jobs.filter(j => DIRECT_JOB_FILTER_REGEX.test(j.title)).length} after filter`);
    return { ok: jobs.length > 0, section: buildJobSection(name, jobs), jobs, engine: 'pinchtab-google' };
  } catch (err) {
    console.error(`[scan] [PinchTab/Google] Failed "${name}": ${err.message}`);
    return { ok: false, section: null, jobs: [], engine: 'pinchtab-google', error: err.message };
  } finally {
    await pinchtabClose(tabId);
  }
}

function buildTheirStackPayload(portalsConfig = {}) {
  const titleFilter = normalizeTitleFilterConfig(portalsConfig.title_filter || {});
  const jobTitleOr = [...new Set([...titleFilter.positive, ...titleFilter.seniorityBoost])].slice(0, 25);
  const jobTitleNot = [...new Set(titleFilter.negative)].slice(0, 25);

  return {
    page: 0,
    limit: 25,
    posted_at_max_age_days: 14,
    job_title_or: jobTitleOr,
    job_title_not: jobTitleNot,
    property_exists_or: ['final_url'],
  };
}

async function fetchTheirStackSection(aggregator = {}, portalsConfig = {}) {
  const apiKey = process.env.THEIRSTACK_API_KEY || process.env.THEIR_STACK_API_KEY;
  const apiUrl = aggregator.api_url || 'https://api.theirstack.com/v1/jobs/search';
  if (!apiKey) return { ok: false, section: null, jobs: [], engine: 'theirstack' };

  const payload = buildTheirStackPayload(portalsConfig);
  console.log(`[scan] [TheirStack] "${aggregator.name || 'TheirStack'}" → POST ${apiUrl}`);

  let response;
  try {
    response = await fetch(apiUrl, {
      method: 'POST',
      signal: AbortSignal.timeout(20000),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error(`[scan] [TheirStack] TIMEOUT/ERROR "${aggregator.name || 'TheirStack'}": ${err.message}`);
    return { ok: false, section: null, jobs: [], engine: 'theirstack', error: err.message };
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    console.error(`[scan] [TheirStack] HTTP ${response.status} "${aggregator.name || 'TheirStack'}": ${errText.slice(0, 200)}`);
    return { ok: false, section: null, jobs: [], engine: 'theirstack', error: `HTTP ${response.status}` };
  }

  const data = await response.json();
  const jobs = (data.data || []).map(job => ({
    title: cleanString(job.job_title || ''),
    company: cleanString(job.company || job.company_object?.name || ''),
    url: cleanString(job.final_url || job.url || ''),
    publishedAt: normalizeDateValue(job.date_posted || ''),
  })).filter(job => job.title && job.url);

  console.log(`[scan] [TheirStack] "${aggregator.name || 'TheirStack'}" → ${jobs.length} results, ${jobs.filter(j => DIRECT_JOB_FILTER_REGEX.test(j.title)).length} after filter`);
  return {
    ok: true,
    section: buildJobSection(aggregator.name || 'TheirStack', jobs, { includeCompany: true }),
    jobs,
    engine: 'theirstack',
  };
}

const DEFAULT_AGGREGATOR_KEYWORDS = [
  'AI Product Manager',
  'Head of AI',
  'Product Manager AI',
  'Solutions Architect AI',
  'Forward Deployed',
  'AI Engineer',
  'Agentic',
  'LLM',
  'Automation',
  'Product Designer AI',
  'UX AI',
];
const DEFAULT_AGGREGATOR_LOCATIONS = [
  'Remote',
  'Europe',
  'EMEA',
  'Asia',
  'APAC',
  'Singapore',
  'Hong Kong',
  'Japan',
  'India',
];

function getAggregatorKeywords(aggregator = {}, { asArray = false } = {}) {
  const configured = cleanList(aggregator.keywords);
  if (configured.length) return asArray ? configured : configured.join(' OR ');
  if (aggregator.what) return asArray ? [cleanString(aggregator.what)] : cleanString(aggregator.what);
  if (aggregator.query) return asArray ? [cleanString(aggregator.query)] : cleanString(aggregator.query);
  return asArray ? DEFAULT_AGGREGATOR_KEYWORDS : DEFAULT_AGGREGATOR_KEYWORDS.join(' OR ');
}

function getAggregatorLocations(aggregator = {}) {
  const configured = cleanList(aggregator.locations);
  if (configured.length) return configured;
  if (aggregator.where) return [cleanString(aggregator.where)];
  return DEFAULT_AGGREGATOR_LOCATIONS;
}

function buildAggregatorSearchQuery(aggregator = {}) {
  if (aggregator.query) return cleanString(aggregator.query);
  const keywords = getAggregatorKeywords(aggregator, { asArray: true }).map(keyword => `"${keyword}"`).join(' OR ');
  const locations = getAggregatorLocations(aggregator).map(location => `"${location}"`).join(' OR ');
  return `(${keywords}) ("full remote" OR "fully remote" OR remote OR "remote-first" OR distributed) (${locations})`;
}

async function fetchJsonWithTimeout(url, { method = 'GET', headers = {}, body, timeoutMs = 20000 } = {}) {
  const response = await fetch(url, {
    method,
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; career-ops/1.0)',
      ...headers,
    },
    body,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 180)}`);
  }
  return text ? JSON.parse(text) : {};
}

function pushUniqueJobs(target, jobs = []) {
  const seen = new Set(target.map(job => `${normalizeUrlKey(job.url)}::${cleanString(job.title).toLowerCase()}`));
  for (const job of jobs) {
    const key = `${normalizeUrlKey(job.url)}::${cleanString(job.title).toLowerCase()}`;
    if (!job?.title || !job?.url || seen.has(key)) continue;
    seen.add(key);
    target.push(job);
  }
}

async function fetchSearchApiAggregatorSection(aggregator = {}) {
  const query = buildAggregatorSearchQuery(aggregator);
  return fetchSerpApiSection({ name: aggregator.name || 'SearchAPI Google Jobs', query });
}

async function fetchAdzunaSection(aggregator = {}) {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) return { ok: false, section: null, jobs: [], engine: 'adzuna', error: 'missing ADZUNA_APP_ID/ADZUNA_APP_KEY' };

  const countries = cleanList(aggregator.countries).length
    ? cleanList(aggregator.countries)
    : ['gb', 'fr', 'de', 'nl', 'be', 'es', 'it', 'at', 'pl', 'ch', 'se', 'dk', 'no', 'fi', 'in', 'sg', 'hk', 'jp'];
  const what = getAggregatorKeywords(aggregator);
  const where = cleanString(aggregator.where || 'remote');
  const resultsPerPage = String(aggregator.results_per_page || 20);
  const jobs = [];

  for (const country of countries.slice(0, 24)) {
    const params = new URLSearchParams({
      app_id: appId,
      app_key: appKey,
      results_per_page: resultsPerPage,
      what,
      where,
      'content-type': 'application/json',
    });
    const url = `https://api.adzuna.com/v1/api/jobs/${country}/search/1?${params.toString()}`;
    try {
      const data = await fetchJsonWithTimeout(url);
      pushUniqueJobs(jobs, (data.results || []).map(job => ({
        title: cleanString(job.title || ''),
        company: cleanString(job.company?.display_name || ''),
        url: cleanString(job.redirect_url || ''),
        location: cleanString(job.location?.display_name || (job.location?.area || []).join(', ')),
        remoteEvidence: cleanString([where, job.location?.display_name, job.description].filter(Boolean).join(' | ')).slice(0, 240),
        publishedAt: normalizeDateValue(job.created || ''),
      })));
    } catch (err) {
      console.warn(`[scan] [Adzuna] ${country} failed: ${err.message}`);
    }
  }

  console.log(`[scan] [Adzuna] "${aggregator.name || 'Adzuna'}" → ${jobs.length} results, ${jobs.filter(j => DIRECT_JOB_FILTER_REGEX.test(j.title)).length} after filter`);
  return { ok: jobs.length > 0, section: buildJobSection(aggregator.name || 'Adzuna', jobs, { includeCompany: true }), jobs, engine: 'adzuna' };
}

async function fetchJoobleSection(aggregator = {}) {
  const apiKey = process.env.JOOBLE_API_KEY;
  if (!apiKey) return { ok: false, section: null, jobs: [], engine: 'jooble', error: 'missing JOOBLE_API_KEY' };

  const keywords = getAggregatorKeywords(aggregator);
  const locations = getAggregatorLocations(aggregator).slice(0, 12);
  const jobs = [];
  const url = `https://jooble.org/api/${encodeURIComponent(apiKey)}`;

  for (const location of locations) {
    try {
      const data = await fetchJsonWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keywords,
          location,
          radius: cleanString(aggregator.radius || '80'),
          page: '1',
          ResultOnPage: Number(aggregator.results_per_page || 20),
          companysearch: 'false',
        }),
      });
      pushUniqueJobs(jobs, (data.jobs || []).map(job => ({
        title: cleanString(job.title || ''),
        company: cleanString(job.company || ''),
        url: cleanString(job.link || ''),
        location: cleanString(job.location || location),
        remoteEvidence: cleanString([location, job.location, job.type, job.snippet].filter(Boolean).join(' | ')).slice(0, 240),
        publishedAt: normalizeDateValue(job.updated || ''),
      })));
    } catch (err) {
      console.warn(`[scan] [Jooble] ${location} failed: ${err.message}`);
    }
  }

  console.log(`[scan] [Jooble] "${aggregator.name || 'Jooble'}" → ${jobs.length} results, ${jobs.filter(j => DIRECT_JOB_FILTER_REGEX.test(j.title)).length} after filter`);
  return { ok: jobs.length > 0, section: buildJobSection(aggregator.name || 'Jooble', jobs, { includeCompany: true }), jobs, engine: 'jooble' };
}

async function fetchCareerjetSection(aggregator = {}) {
  const affid = process.env.CAREERJET_AFFID || process.env.CAREERJET_AFFILIATE_ID;
  if (!affid) return { ok: false, section: null, jobs: [], engine: 'careerjet', error: 'missing CAREERJET_AFFID' };

  const locales = cleanList(aggregator.locales).length
    ? cleanList(aggregator.locales)
    : ['en_GB', 'fr_FR', 'de_DE', 'es_ES', 'it_IT', 'nl_NL', 'en_IN', 'en_SG', 'en_HK'];
  const keywords = getAggregatorKeywords(aggregator);
  const location = cleanString(aggregator.location || aggregator.where || 'remote');
  const jobs = [];

  for (const locale of locales.slice(0, 18)) {
    const params = new URLSearchParams({
      locale,
      affid,
      keywords,
      location,
      pagesize: String(aggregator.results_per_page || 20),
      page: '1',
      user_ip: '127.0.0.1',
      user_agent: 'career-ops/1.0',
    });
    const url = `https://public.api.careerjet.net/search?${params.toString()}`;
    try {
      const data = await fetchJsonWithTimeout(url);
      pushUniqueJobs(jobs, (data.jobs || []).map(job => ({
        title: cleanString(job.title || ''),
        company: cleanString(job.company || ''),
        url: cleanString(job.url || ''),
        location: cleanString(job.locations || location),
        remoteEvidence: cleanString([location, job.locations, job.description].filter(Boolean).join(' | ')).slice(0, 240),
        publishedAt: normalizeDateValue(job.date || ''),
      })));
    } catch (err) {
      console.warn(`[scan] [Careerjet] ${locale} failed: ${err.message}`);
    }
  }

  console.log(`[scan] [Careerjet] "${aggregator.name || 'Careerjet'}" → ${jobs.length} results, ${jobs.filter(j => DIRECT_JOB_FILTER_REGEX.test(j.title)).length} after filter`);
  return { ok: jobs.length > 0, section: buildJobSection(aggregator.name || 'Careerjet', jobs, { includeCompany: true }), jobs, engine: 'careerjet' };
}

async function fetchRemotiveSection(aggregator = {}) {
  const queries = cleanList(aggregator.queries).length ? cleanList(aggregator.queries) : getAggregatorKeywords(aggregator, { asArray: true }).slice(0, 8);
  const jobs = [];
  for (const query of queries) {
    const params = new URLSearchParams({ search: query });
    const url = `https://remotive.com/api/remote-jobs?${params.toString()}`;
    try {
      const data = await fetchJsonWithTimeout(url);
      pushUniqueJobs(jobs, (data.jobs || []).map(job => ({
        title: cleanString(job.title || ''),
        company: cleanString(job.company_name || ''),
        url: cleanString(job.url || ''),
        location: cleanString(job.candidate_required_location || 'Remote'),
        remoteEvidence: cleanString(['Remote', job.candidate_required_location, job.job_type, job.description].filter(Boolean).join(' | ')).slice(0, 240),
        publishedAt: normalizeDateValue(job.publication_date || ''),
      })));
    } catch (err) {
      console.warn(`[scan] [Remotive] ${query} failed: ${err.message}`);
    }
  }

  console.log(`[scan] [Remotive] "${aggregator.name || 'Remotive'}" → ${jobs.length} results, ${jobs.filter(j => DIRECT_JOB_FILTER_REGEX.test(j.title)).length} after filter`);
  return { ok: jobs.length > 0, section: buildJobSection(aggregator.name || 'Remotive', jobs, { includeCompany: true }), jobs, engine: 'remotive' };
}

async function fetchJobicySection(aggregator = {}) {
  // Jobicy v2 API: valid geo slugs are emea, europe, americas, apac, usa, canada, uk, australia.
  // 'anywhere' / 'all' / '' must be sent as an omitted geo param (not as a value).
  // tag must be 3-50 chars.
  const VALID_JOBICY_GEOS = new Set(['emea', 'europe', 'americas', 'apac', 'usa', 'canada', 'uk', 'australia']);
  const ALL_GEO_TOKENS = new Set(['anywhere', 'all', 'worldwide', 'global', '']);

  const rawGeos = cleanList(aggregator.geos).length ? cleanList(aggregator.geos) : ['emea', 'europe', 'apac', 'all'];
  const rawTag = cleanString(aggregator.tag || 'product');
  const tag = rawTag.length < 3 ? 'product' : rawTag.slice(0, 50);
  if (rawTag !== tag) console.warn(`[scan] [Jobicy] tag "${rawTag}" invalid (must be 3-50 chars) — using "${tag}"`);

  const jobs = [];

  for (const geoRaw of rawGeos.slice(0, 8)) {
    const geo = String(geoRaw || '').toLowerCase();
    const params = new URLSearchParams({ count: String(aggregator.results_per_page || 50), tag });
    let label = geo;
    if (ALL_GEO_TOKENS.has(geo)) {
      label = '(no-geo)';
      // intentionally do not append geo param
    } else if (!VALID_JOBICY_GEOS.has(geo)) {
      console.warn(`[scan] [Jobicy] skipping unknown geo "${geo}" (valid: ${[...VALID_JOBICY_GEOS].join(', ')})`);
      continue;
    } else {
      params.set('geo', geo);
    }
    const url = `https://jobicy.com/api/v2/remote-jobs?${params.toString()}`;
    try {
      const data = await fetchJsonWithTimeout(url);
      pushUniqueJobs(jobs, (data.jobs || []).map(job => ({
        title: cleanString(job.jobTitle || job.title || ''),
        company: cleanString(job.companyName || job.company || ''),
        url: cleanString(job.url || job.jobUrl || ''),
        location: cleanString(job.jobGeo || geo || 'Remote'),
        remoteEvidence: cleanString(['Remote', job.jobGeo, job.jobIndustry, job.jobDescription].filter(Boolean).join(' | ')).slice(0, 240),
        publishedAt: normalizeDateValue(job.pubDate || ''),
      })));
    } catch (err) {
      console.warn(`[scan] [Jobicy] ${label} failed: ${err.message}`);
    }
  }

  console.log(`[scan] [Jobicy] "${aggregator.name || 'Jobicy'}" → ${jobs.length} results, ${jobs.filter(j => DIRECT_JOB_FILTER_REGEX.test(j.title)).length} after filter`);
  return { ok: jobs.length > 0, section: buildJobSection(aggregator.name || 'Jobicy', jobs, { includeCompany: true }), jobs, engine: 'jobicy' };
}

async function fetchHimalayasSection(aggregator = {}) {
  const queries = cleanList(aggregator.queries).length ? cleanList(aggregator.queries) : getAggregatorKeywords(aggregator, { asArray: true }).slice(0, 8);
  const jobs = [];

  for (const query of queries) {
    const params = new URLSearchParams({
      q: query,
      limit: String(Math.min(Number(aggregator.results_per_page || 20), 20)),
      worldwide: 'true',
    });
    const url = `https://himalayas.app/jobs/api/search?${params.toString()}`;
    try {
      const data = await fetchJsonWithTimeout(url);
      const records = Array.isArray(data) ? data : (data.jobs || data.data || []);
      pushUniqueJobs(jobs, records.map(job => ({
        title: cleanString(job.title || job.name || ''),
        company: cleanString(job.companyName || job.company?.name || job.company || ''),
        url: cleanString(job.applicationLink || job.applicationUrl || job.url || job.link || ''),
        location: cleanString(job.location || job.country || job.countries?.join?.(', ') || 'Remote'),
        remoteEvidence: cleanString(['Remote', job.location, job.country, job.timezone, job.description].filter(Boolean).join(' | ')).slice(0, 240),
        publishedAt: normalizeDateValue(job.publishedAt || job.createdAt || ''),
      })));
    } catch (err) {
      console.warn(`[scan] [Himalayas] ${query} failed: ${err.message}`);
    }
  }

  console.log(`[scan] [Himalayas] "${aggregator.name || 'Himalayas'}" → ${jobs.length} results, ${jobs.filter(j => DIRECT_JOB_FILTER_REGEX.test(j.title)).length} after filter`);
  return { ok: jobs.length > 0, section: buildJobSection(aggregator.name || 'Himalayas', jobs, { includeCompany: true }), jobs, engine: 'himalayas' };
}

async function fetchArbeitnowSection(aggregator = {}) {
  const url = aggregator.api_url || 'https://www.arbeitnow.com/api/job-board-api';
  try {
    const data = await fetchJsonWithTimeout(url);
    const records = Array.isArray(data) ? data : (data.data || data.jobs || []);
    const jobs = records.map(job => ({
      title: cleanString(job.title || ''),
      company: cleanString(job.company_name || job.company || ''),
      url: cleanString(job.url || job.slug && `https://www.arbeitnow.com/jobs/${job.slug}` || ''),
      location: cleanString(job.location || (job.remote ? 'Remote, Europe' : '')),
      remoteEvidence: cleanString([job.remote ? 'Remote, Europe' : '', job.location, ...(Array.isArray(job.tags) ? job.tags : [])].filter(Boolean).join(' | ')).slice(0, 240),
      publishedAt: normalizeDateValue(job.created_at || job.createdAt || ''),
    }));
    console.log(`[scan] [Arbeitnow] "${aggregator.name || 'Arbeitnow'}" → ${jobs.length} results, ${jobs.filter(j => DIRECT_JOB_FILTER_REGEX.test(j.title)).length} after filter`);
    return { ok: jobs.length > 0, section: buildJobSection(aggregator.name || 'Arbeitnow', jobs, { includeCompany: true }), jobs, engine: 'arbeitnow' };
  } catch (err) {
    console.warn(`[scan] [Arbeitnow] failed: ${err.message}`);
    return { ok: false, section: null, jobs: [], engine: 'arbeitnow', error: err.message };
  }
}

async function fetchRemoteOkSection(aggregator = {}) {
  const apiUrl = aggregator.api_url || 'https://remoteok.com/api';
  try {
    const data = await fetchJsonWithTimeout(apiUrl);
    const rows = Array.isArray(data) ? data : [];
    const jobs = rows
      .filter(row => row && typeof row === 'object' && row.position)
      .map(row => {
        const tags = Array.isArray(row.tags)
          ? row.tags.filter(t => typeof t === 'string' || typeof t === 'number').join(' ')
          : (typeof row.tags === 'string' ? row.tags : '');
        return {
          title: cleanString(row.position || ''),
          company: cleanString(row.company || aggregator.name || 'RemoteOK'),
          url: cleanString(row.apply_url || row.url || ''),
          location: cleanString(`remote ${row.location || ''} ${tags}`),
          remoteEvidence: 'Remote',
          publishedAt: normalizeDateValue(row.epoch || row.date || ''),
        };
      })
      .filter(job => job.title && job.url);
    console.log(`[scan] [RemoteOK] "${aggregator.name || 'RemoteOK'}" → ${jobs.length} results, ${jobs.filter(j => DIRECT_JOB_FILTER_REGEX.test(j.title)).length} after filter`);
    return { ok: jobs.length > 0, section: buildJobSection(aggregator.name || 'RemoteOK', jobs, { includeCompany: true }), jobs, engine: 'remoteok' };
  } catch (err) {
    console.warn(`[scan] [RemoteOK] failed: ${err.message}`);
    return { ok: false, section: null, jobs: [], engine: 'remoteok', error: err.message };
  }
}

async function fetchAggregatorSection(aggregator = {}, portalsConfig = {}) {
  if (aggregator.sourceKind === 'job_board') {
    try {
      const jobs = (await fetchJobBoard(aggregator)).map(job => ({
        ...job, publishedAt: normalizeDateValue(job.publishedAt),
      }));
      console.log(`[scan] [${aggregator.provider}] ${aggregator.name}: ${jobs.length} jobs`);
      return { ok: true, jobs, engine: aggregator.provider,
        section: buildJobSection(aggregator.name, jobs, { includeCompany: true }) };
    } catch (error) {
      console.warn(`[scan] [${aggregator.provider}] ${aggregator.name}: ${error.message}`);
      return { ok: false, jobs: [], section: null, engine: aggregator.provider, error: error.message };
    }
  }
  const provider = getAggregatorProvider(aggregator);
  if (!isAggregatorConfigured(aggregator)) {
    return { ok: false, section: null, jobs: [], engine: provider || 'aggregator', error: 'missing credentials or unsupported provider' };
  }
  if (provider === 'theirstack') return fetchTheirStackSection(aggregator, portalsConfig);
  if (provider === 'searchapi' || provider === 'serpapi') return fetchSearchApiAggregatorSection(aggregator, portalsConfig);
  if (provider === 'adzuna') return fetchAdzunaSection(aggregator, portalsConfig);
  if (provider === 'jooble') return fetchJoobleSection(aggregator, portalsConfig);
  if (provider === 'careerjet') return fetchCareerjetSection(aggregator, portalsConfig);
  if (provider === 'remotive') return fetchRemotiveSection(aggregator, portalsConfig);
  if (provider === 'jobicy') return fetchJobicySection(aggregator, portalsConfig);
  if (provider === 'himalayas') return fetchHimalayasSection(aggregator, portalsConfig);
  if (provider === 'arbeitnow') return fetchArbeitnowSection(aggregator, portalsConfig);
  if (provider === 'remoteok') return fetchRemoteOkSection(aggregator);
  return { ok: false, section: null, jobs: [], engine: 'aggregator', error: 'unsupported provider' };
}

async function fetchWebSearchSection(source, sharedBrowser = null) {
  if (webSearchCircuitOpen()) {
    return { ok: false, section: null, error: 'web-search circuit open' };
  }

  const takeIfLoaded = (result) => {
    if (isWebSearchEngineBlocked(result)) return null;
    recordWebSearchOutcome(true);
    return result;
  };

  if (!serpApiCircuitOpen() && (SERPAPI_KEY || process.env.SEARCHAPI_KEY)) {
    try {
      const taken = takeIfLoaded(await fetchSerpApiSection(source));
      if (taken) return taken;
    } catch (err) {
      console.warn(`[scan] [WebSearch] SearchAPI/SerpApi threw for "${source.name}": ${err.message}, falling back...`);
    }
  }

  if (process.env.BRAVE_API_KEY) {
    try {
      const taken = takeIfLoaded(await fetchBraveSection(source));
      if (taken) return taken;
    } catch (err) {
      console.warn(`[scan] [WebSearch] Brave threw for "${source.name}": ${err.message}, falling back...`);
    }
  }

  if (webSearchCircuitOpen()) return { ok: false, section: null, jobs: [], error: 'web-search circuit open' };
  if (await pinchtabIsUp()) {
    if (webSearchCircuitOpen()) return { ok: false, section: null, jobs: [], error: 'web-search circuit open' };
    const pinchtabBraveResult = await fetchPinchtabBraveSection(source);
    const braveTaken = takeIfLoaded(pinchtabBraveResult);
    if (braveTaken) return braveTaken;

    if (webSearchCircuitOpen()) return { ok: false, section: null, jobs: [], error: 'web-search circuit open' };
    const pinchtabSearchResult = await fetchPinchtabSearchSection(source);
    const googleTaken = takeIfLoaded(pinchtabSearchResult);
    if (googleTaken) return googleTaken;

    if (source?.careers_url) {
      console.warn(`[scan] [WebSearch] Falling back to careers_url for "${source.name}"`);
      const fallback = await fetchCareersUrlFallback(source);
      recordWebSearchOutcome(!isWebSearchEngineBlocked(fallback));
      return fallback;
    }
    recordWebSearchOutcome(false);
    return pinchtabSearchResult;
  }

  const chromeGoogleResult = await fetchLocalBrowserGoogleSection(source, sharedBrowser);
  if (!isWebSearchEngineBlocked(chromeGoogleResult)) {
    recordWebSearchOutcome(true);
    if (!chromeGoogleResult.jobs?.length && source?.careers_url) return fetchCareersUrlFallback(source);
    return chromeGoogleResult;
  }

  if (source?.careers_url) {
    console.warn(`[scan] [WebSearch] Falling back to careers_url for "${source.name}"`);
    const fallback = await fetchCareersUrlFallback(source);
    recordWebSearchOutcome(!isWebSearchEngineBlocked(fallback));
    return fallback;
  }

  if (process.env.SCAN_WEBSEARCH_DDG === '1') {
    if (webSearchCircuitOpen()) return { ok: false, section: null, jobs: [], error: 'web-search circuit open' };
    const duckDuckGoResult = await fetchDuckDuckGoSection(source);
    const ddgTaken = takeIfLoaded(duckDuckGoResult);
    if (ddgTaken) return ddgTaken;
    recordWebSearchOutcome(false);
    return duckDuckGoResult;
  }

  recordWebSearchOutcome(false);
  return chromeGoogleResult;
}

async function fetchWebSearchSectionsSequential(sources = []) {
  const results = [];
  let sharedBrowser = null;
  try {
    if (!IS_VERCEL && sources.length && !(await pinchtabIsUp())) {
      try {
        sharedBrowser = await launchLocalBrowserContext({ profilePrefix: 'career-ops-search-profile-' });
      } catch (err) {
        console.warn(`[scan] [Chrome/Google] shared browser unavailable: ${err.message}`);
      }
    }

    for (const source of sources) {
      if (webSearchCircuitOpen()) {
        results.push({ status: 'fulfilled', value: { ok: false, section: null, jobs: [], engine: 'web-search', error: 'web-search circuit open' } });
        continue;
      }
      try {
        results.push({ status: 'fulfilled', value: await fetchWebSearchSection(source, sharedBrowser) });
      } catch (err) {
        results.push({ status: 'rejected', reason: err });
      }
    }
  } finally {
    await sharedBrowser?.ctx?.close().catch(() => {});
    if (sharedBrowser?.tempProfile) await rm(sharedBrowser.tempProfile, { recursive: true, force: true }).catch(() => {});
  }
  return results;
}

const PINCHTAB_SCROLL_SCRIPT = `(async () => {
  for (let i = 0; i < 6; i += 1) {
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  window.scrollTo(0, 0);
  return true;
})()`;

const PINCHTAB_EXTRACT_SCRIPT = `(() => {
  const normalizeText = value => String(value || '').replace(/\\s+/g, ' ').trim();
  const parseDate = value => {
    const raw = normalizeText(value);
    if (!raw) return '';
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
  };
  const host = window.location.hostname;
  const navLike = /^(home|jobs|careers|open roles|open positions|learn more|view all|see all|apply now)$/i;
  const isLikelyJobHref = href => !/\\/blog\\//i.test(href) && /\\/jobs?\\/|\\/positions?\\/|\\/open-roles?\\/|\\/projects?\\/|\\/missions?\\/|\\/job-mission\\/|jobs\\.ashbyhq\\.com|jobs\\.lever\\.co|apply\\.workable\\.com/i.test(href);
  const results = [];
  const seen = new Set();
  const pushJob = entry => {
    const title = normalizeText(entry && entry.title);
    const url = normalizeText(entry && entry.url);
    if (!title || !url || navLike.test(title)) return;
    const key = url + '::' + title.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    results.push({
      title,
      url,
      location: normalizeText(entry && entry.location),
      publishedAt: normalizeText(entry && entry.publishedAt),
    });
  };

  if (host.includes('jobs.lever.co')) {
    document.querySelectorAll('a.posting, a[href*="jobs.lever.co"]').forEach(anchor => {
      const title = normalizeText(
        (anchor.querySelector('h5, h4, [class*="posting-title"]') || {}).textContent ||
        anchor.textContent
      );
      const location = normalizeText(
        (anchor.querySelector('.sort-by-location, [class*="location"]') || {}).textContent || ''
      );
      pushJob({ title, url: anchor.href, location });
    });
  } else if (host.includes('jobs.ashbyhq.com')) {
    const boardSlug = window.location.pathname.split('/').filter(Boolean)[0] || '';
    const toAshbyUrl = posting => {
      const raw = normalizeText(
        posting.jobUrl ||
        posting.applyUrl ||
        posting.hostedUrl ||
        posting.url ||
        posting.absoluteUrl ||
        ''
      );
      if (/^https?:\\/\\//i.test(raw)) return raw;
      const id = normalizeText(posting.id || posting.jobId || posting.externalId || '');
      if (id && boardSlug) return new URL('/' + boardSlug + '/' + id, window.location.origin).href;
      return raw ? new URL(raw, window.location.href).href : '';
    };
    const normalizeAshbyLocation = posting => normalizeText(
      posting.locationName ||
      posting.primaryLocation ||
      posting.primaryLocationName ||
      (posting.location && posting.location.name) ||
      (typeof posting.location === 'string' ? posting.location : '') ||
      ''
    );
    const normalizeAshbyDate = posting => parseDate(
      posting.publishedDate ||
      posting.publishedAt ||
      posting.createdAt ||
      posting.updatedAt ||
      ''
    );
    const addAshbyPosting = posting => {
      if (!posting || typeof posting !== 'object') return;
      pushJob({
        title: normalizeText(posting.title || posting.name || posting.jobTitle || ''),
        url: toAshbyUrl(posting),
        location: normalizeAshbyLocation(posting),
        publishedAt: normalizeAshbyDate(posting),
      });
    };
    const collectAshbyPostings = value => {
      const stack = [value];
      const visited = new Set();
      while (stack.length) {
        const current = stack.pop();
        if (!current || typeof current !== 'object' || visited.has(current)) continue;
        visited.add(current);
        if (Array.isArray(current)) {
          const looksLikeJobs = current.some(item =>
            item && typeof item === 'object' &&
            normalizeText(item.title || item.name || item.jobTitle) &&
            (normalizeText(item.jobUrl || item.applyUrl || item.hostedUrl || item.url || item.absoluteUrl || item.id || item.jobId))
          );
          if (looksLikeJobs) current.forEach(addAshbyPosting);
          else current.forEach(item => stack.push(item));
          continue;
        }
        Object.values(current).forEach(item => {
          if (item && typeof item === 'object') stack.push(item);
        });
      }
    };

    collectAshbyPostings(window.__appData);
    collectAshbyPostings(window.__NEXT_DATA__);
    document.querySelectorAll('script[type="application/json"], script:not([src])').forEach(script => {
      const text = script.textContent || '';
      if (!/jobPostings|jobBoard|posting-api|publishedAt|publishedDate|ashby/i.test(text)) return;
      try { collectAshbyPostings(JSON.parse(text)); } catch {}
    });

    document.querySelectorAll('a[href]').forEach(anchor => {
      const href = anchor.href || '';
      if (!/jobs\\.ashbyhq\\.com/i.test(href)) return;
      const parsedPath = (() => {
        try { return new URL(href).pathname.split('/').filter(Boolean); } catch { return []; }
      })();
      if (parsedPath.length < 2 && !/\\/job\\//i.test(href)) return;
      const card = anchor.closest('[data-testid*="job"], [class*="job"], article, li, a, section, div');
      const title = normalizeText(
        (anchor.querySelector('h1, h2, h3, h4, h5, [class*="title"], [data-testid*="title"]') || {}).textContent ||
        (card && (card.querySelector('h1, h2, h3, h4, h5, [class*="title"], [data-testid*="title"]') || {}).textContent) ||
        anchor.textContent
      );
      if (title.length < 4 || title.length > 180) return;
      const domLocation = normalizeText(
        (card && (card.querySelector('[class*="location"], [data-testid*="location"], [class*="Location"]') || {}).textContent) || ''
      );
      const time = card && card.querySelector('time');
      const publishedAt = parseDate(
        (time && time.getAttribute('datetime')) || (time && time.textContent) || ''
      );
      pushJob({ title, url: href, location: domLocation, publishedAt });
    });
  } else {
    document.querySelectorAll('a[href]').forEach(anchor => {
      const href = anchor.href || '';
      if (!isLikelyJobHref(href)) return;
      const title = normalizeText(
        (anchor.querySelector('h1, h2, h3, h4, h5, [class*="title"]') || {}).textContent ||
        anchor.textContent
      );
      if (title.length < 4 || title.length > 160) return;
      const card = anchor.closest('a, article, li, section, div');
      const location = normalizeText(
        (card && card.querySelector('[class*="location"], [data-testid*="location"]') || {}).textContent || ''
      );
      const time = card && card.querySelector('time');
      const publishedAt = parseDate(
        (time && time.getAttribute('datetime')) || (time && time.textContent) || ''
      );
      pushJob({ title, url: href, location, publishedAt });
    });
  }

  return results.map(job => ({
    title: job.location ? job.title + ' (' + job.location + ')' : job.title,
    location: job.location,
    remoteEvidence: job.location,
    url: job.url,
    publishedAt: job.publishedAt,
  }));
})()`;

const SCAN_CAREERS_WAIT_MS = Math.max(6000, Number.parseInt(process.env.SCAN_CAREERS_WAIT_MS || '14000', 10) || 14000);
const SCAN_CAREERS_DETAIL_LIMIT = Math.max(0, Number.parseInt(process.env.SCAN_CAREERS_DETAIL_LIMIT || '8', 10) || 8);
const SCAN_CAREERS_DETAIL_WAIT_MS = Math.max(2500, Number.parseInt(process.env.SCAN_CAREERS_DETAIL_WAIT_MS || '9000', 10) || 9000);

async function extractJobsFromLocalPage(page, companyName, { maxWaitMs = SCAN_CAREERS_WAIT_MS } = {}) {
  const started = Date.now();
  let jobs = [];
  let bodyText = '';
  let attempts = 0;

  while (Date.now() - started < maxWaitMs && !isShuttingDown) {
    attempts += 1;
    await page.evaluate(PINCHTAB_SCROLL_SCRIPT).catch(() => {});
    jobs = (await page.evaluate(PINCHTAB_EXTRACT_SCRIPT).catch(() => [])) || [];
    if (jobs.length) {
      if (attempts > 1) {
        console.log(`[scan] [local-browser] "${companyName}" jobs appeared after ${Math.round((Date.now() - started) / 1000)}s`);
      }
      return { jobs, bodyText, challenge: false };
    }

    bodyText = String(await page.evaluate(PAGE_BODY_TEXT_EXPR).catch(() => '') || '');
    if (looksLikeChallengePage(bodyText)) return { jobs, bodyText, challenge: true };
    await page.waitForTimeout(attempts <= 2 ? 1200 : 1800);
  }

  return { jobs, bodyText, challenge: false };
}

async function extractJobsFromPinchtab(tabId, companyName, { maxWaitMs = SCAN_CAREERS_WAIT_MS } = {}) {
  const started = Date.now();
  let jobs = [];
  let bodyText = '';
  let attempts = 0;

  while (Date.now() - started < maxWaitMs && !isShuttingDown) {
    attempts += 1;
    await pinchtabEvaluate(tabId, PINCHTAB_SCROLL_SCRIPT, { awaitPromise: true, timeout: 10000 }).catch(() => {});
    jobs = (await pinchtabEvaluate(tabId, PINCHTAB_EXTRACT_SCRIPT, { awaitPromise: false, timeout: 10000 }).catch(() => [])) || [];
    if (jobs.length) {
      if (attempts > 1) {
        console.log(`[scan] [pinchtab] "${companyName}" jobs appeared after ${Math.round((Date.now() - started) / 1000)}s`);
      }
      return { jobs, bodyText, challenge: false };
    }

    bodyText = String(await pinchtabEvaluate(tabId, PAGE_BODY_TEXT_EXPR, { awaitPromise: false, timeout: 5000 }).catch(() => '') || '');
    if (looksLikeChallengePage(bodyText)) return { jobs, bodyText, challenge: true };
    await new Promise(resolve => setTimeout(resolve, attempts <= 2 ? 1200 : 1800));
  }

  return { jobs, bodyText, challenge: false };
}

function scanDetailEvidenceSnippet(text = '') {
  const body = cleanString(text);
  if (!body) return '';
  const match = body.match(/.{0,90}\b(remote|remotely|work from anywhere|distributed|worldwide|global|emea|europe|european|eu|apac|asia|timezone|utc)\b.{0,140}/i);
  return cleanString(match?.[0] || body.slice(0, 260));
}

function usableDetailTitle(title = '') {
  const value = cleanString(title);
  if (value.length < 4 || value.length > 180) return false;
  if (/^(apply|apply now|view role|learn more|jobs?|careers?|open roles?|open positions?|job details?)$/i.test(value)) return false;
  return true;
}

async function enrichLocalJobsWithDetails(ctx, jobs = [], companyName = '') {
  if (!SCAN_CAREERS_DETAIL_LIMIT || !jobs.length) return jobs;
  const candidates = jobs
    .filter(job => job?.url && (DIRECT_JOB_FILTER_REGEX.test(job.title) || !cleanString(job.remoteEvidence || job.location)))
    .slice(0, SCAN_CAREERS_DETAIL_LIMIT);
  if (!candidates.length) return jobs;

  const byKey = new Map(jobs.map(job => [normalizeUrlKey(job.url) || job.url, job]));
  const detailPage = await ctx.newPage();
  try {
    for (const job of candidates) {
      if (isShuttingDown) break;
      const key = normalizeUrlKey(job.url) || job.url;
      try {
        console.log(`[scan] [local-browser] "${companyName}" opening detail → ${cleanString(job.title).slice(0, 70)}`);
        await detailPage.goto(job.url, { waitUntil: 'domcontentloaded', timeout: SCAN_CAREERS_DETAIL_WAIT_MS }).catch(() => {});
        await detailPage.waitForTimeout(1200);
        await detailPage.waitForLoadState('networkidle', { timeout: 2500 }).catch(() => {});
        const detail = await detailPage.evaluate(() => {
          const normalizeText = value => String(value || '').replace(/\s+/g, ' ').trim();
          const textOf = selector => normalizeText((document.querySelector(selector) || {}).textContent || '');
          const title = textOf('h1') || textOf('[data-testid*="title" i], [class*="job-title" i], [class*="posting-title" i]');
          const location = textOf('[data-testid*="location" i], [class*="location" i], [class*="Location" i]');
          const bodyText = normalizeText((document.body && document.body.innerText) || '').slice(0, 1800);
          const time = document.querySelector('time[datetime]');
          const publishedAt = (time && time.getAttribute('datetime')) || '';
          return { title, location, bodyText, publishedAt };
        }).catch(() => ({}));
        const current = byKey.get(key);
        if (!current) continue;
        if (usableDetailTitle(detail.title)) {
          current.title = cleanString(detail.title);
        }
        current.url = detailPage.url() || current.url;
        current.location = cleanString(detail.location || current.location);
        current.remoteEvidence = cleanString([
          current.location,
          scanDetailEvidenceSnippet(detail.bodyText),
          current.remoteEvidence,
        ].filter(Boolean).join(' | ')).slice(0, 240);
        if (!current.publishedAt && detail.publishedAt) current.publishedAt = normalizeDateValue(detail.publishedAt);
      } catch (err) {
        console.warn(`[scan] [local-browser] "${companyName}" detail skipped: ${err.message}`);
      }
    }
  } finally {
    await detailPage.close().catch(() => {});
  }
  return jobs;
}

async function enrichPinchtabJobsWithDetails(jobs = [], companyName = '') {
  if (!SCAN_CAREERS_DETAIL_LIMIT || !jobs.length) return jobs;
  const candidates = jobs
    .filter(job => job?.url && (DIRECT_JOB_FILTER_REGEX.test(job.title) || !cleanString(job.remoteEvidence || job.location)))
    .slice(0, SCAN_CAREERS_DETAIL_LIMIT);
  if (!candidates.length) return jobs;

  for (const job of candidates) {
    if (isShuttingDown) break;
    let detailTabId = null;
    try {
      console.log(`[scan] [pinchtab] "${companyName}" opening detail → ${cleanString(job.title).slice(0, 70)}`);
      detailTabId = await pinchtabNavigate(job.url, { timeout: SCAN_CAREERS_DETAIL_WAIT_MS });
      await new Promise(resolve => setTimeout(resolve, 1600));
      const detail = await pinchtabEvaluate(detailTabId, `(() => {
        const normalizeText = value => String(value || '').replace(/\\s+/g, ' ').trim();
        const textOf = selector => normalizeText((document.querySelector(selector) || {}).textContent || '');
        const title = textOf('h1') || textOf('[data-testid*="title" i], [class*="job-title" i], [class*="posting-title" i]');
        const location = textOf('[data-testid*="location" i], [class*="location" i], [class*="Location" i]');
        const bodyText = normalizeText((document.body && document.body.innerText) || '').slice(0, 1800);
        const time = document.querySelector('time[datetime]');
        const publishedAt = (time && time.getAttribute('datetime')) || '';
        return { title, location, bodyText, publishedAt, url: location.href };
      })()`, { awaitPromise: false, timeout: 10000 }).catch(() => ({}));
      if (usableDetailTitle(detail.title)) {
        job.title = cleanString(detail.title);
      }
      job.url = cleanString(detail.url || job.url);
      job.location = cleanString(detail.location || job.location);
      job.remoteEvidence = cleanString([
        job.location,
        scanDetailEvidenceSnippet(detail.bodyText),
        job.remoteEvidence,
      ].filter(Boolean).join(' | ')).slice(0, 240);
      if (!job.publishedAt && detail.publishedAt) job.publishedAt = normalizeDateValue(detail.publishedAt);
    } catch (err) {
      console.warn(`[scan] [pinchtab] "${companyName}" detail skipped: ${err.message}`);
    } finally {
      await pinchtabClose(detailTabId);
    }
  }
  return jobs;
}

// Local-Chromium careers-page fallback when PinchTab is unavailable.
// Drives the Playwright chromium that is already a dependency
// (postinstall pulls it) instead of an external HTTP service, so scanning works
// with zero paid API and zero extra binary to install. Runs the exact same
// scroll + extract scripts as the daemon path, so results are identical.
//
// One window is opened for the whole batch and reused across companies. It runs
// Headless by default to keep background scans from opening desktop windows; set
// SCAN_BROWSER_HEADLESS=0 only when a visible browser is needed.
async function fetchPlaywrightSectionsLocal(companies = []) {
  if (IS_VERCEL) {
    const reason = 'local browser crawler unavailable on Vercel';
    return companies.map(company => buildPlaywrightResult(company, { error: reason }));
  }

  let chromium;
  try { chromium = await getChromium(); }
  catch (err) {
    const reason = `playwright unavailable: ${err.message}`;
    console.error(`[scan] [local-browser] ${reason}`);
    return companies.map(company => buildPlaywrightResult(company, { error: reason }));
  }

  // Prefer a scan-dedicated profile so a concurrent auto-apply run holding the
  // shared profile lock does not block the scan (and vice versa).
  const persistentProfiles = [join(WRITE_ROOT, 'data', 'chrome-scan-profile'), join(ROOT, 'data', 'chrome-profile')];
  const launchOpts = {
    headless: process.env.SCAN_BROWSER_HEADLESS !== '0',
    viewport: null,
    args: ['--disable-blink-features=AutomationControlled', '--window-size=1280,920'],
  };
  let ctx = null, lastErr, tempProfile = null;
  const profiles = [...persistentProfiles];
  try {
    tempProfile = await mkdtemp(join(tmpdir(), 'career-ops-scan-profile-'));
    profiles.push(tempProfile);
  } catch {
    tempProfile = null;
  }
  let usedProfile = null;
  for (const profile of profiles) {
    for (const channel of ['chrome', undefined]) {
      try {
        ctx = await chromium.launchPersistentContext(profile, channel ? { ...launchOpts, channel } : launchOpts);
        usedProfile = profile;
        break;
      } catch (err) { lastErr = err; }
    }
    if (ctx) break;
  }
  if (!ctx) {
    const reason = `browser launch failed: ${lastErr?.message || 'unknown'}`;
    console.error(`[scan] [local-browser] ${reason}`);
    if (tempProfile) await rm(tempProfile, { recursive: true, force: true }).catch(() => {});
    return companies.map(company => buildPlaywrightResult(company, { error: reason }));
  }

  const results = [];
  try {
    await ctx.addInitScript(() => {
      try {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        window.chrome = window.chrome || { runtime: {} };
      } catch { /* best effort */ }
    }).catch(() => {});
    const page = ctx.pages()[0] || await ctx.newPage();

    for (let index = 0; index < companies.length; index += 1) {
      const company = companies[index];
      if (isShuttingDown) {
        cancelRemainingPlaywrightResults(results, companies, index, 'Cancelled because the UI server is restarting');
        break;
      }
      try {
        console.log(`[scan] [local-browser] Fetching "${company.name}" → ${company.careers_url}`);
        await page.goto(company.careers_url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
        let extracted = await extractJobsFromLocalPage(page, company.name);
        let jobs = extracted.jobs;

        // Nothing extracted may just mean the page is still behind a wall. Give
        // a headed run a short window for the operator to clear it by hand; in
        // headless mode there is nobody to ask, so move on immediately.
        if (!jobs.length && !launchOpts.headless && extracted.challenge) {
          console.log(`[scan] [local-browser] "${company.name}" challenge wall — solve it in the Chrome window (waiting up to 45s)…`);
          const deadline = Date.now() + 45000;
          while (Date.now() < deadline && !jobs.length && !isShuttingDown) {
            await page.waitForTimeout(3000);
            const text = String(await page.evaluate(PAGE_BODY_TEXT_EXPR).catch(() => '') || '');
            if (looksLikeChallengePage(text)) continue;
            extracted = await extractJobsFromLocalPage(page, company.name, { maxWaitMs: 8000 });
            jobs = extracted.jobs;
            break;
          }
        }
        if (!jobs.length && !extracted.challenge) {
          console.warn(`[scan] [local-browser] "${company.name}" no jobs after waiting for client-rendered listings`);
        }
        jobs = await enrichLocalJobsWithDetails(ctx, jobs, company.name);

        console.log(`[scan] [local-browser] "${company.name}" → ${jobs.length} jobs, ${jobs.filter(j => DIRECT_JOB_FILTER_REGEX.test(j.title)).length} after filter`);
        results.push({
          ok: true,
          section: buildJobSection(company.name, jobs),
          jobs,
          engine: 'local-browser',
          company: company.name,
        });
      } catch (err) {
        if (isShuttingDown) {
          const reason = 'Cancelled because the UI server is restarting or shutting down';
          console.warn(`[scan] [local-browser] Stopping "${company.name}": ${reason}`);
          results.push(buildPlaywrightResult(company, { error: reason, cancelled: true, engine: 'local-browser' }));
          cancelRemainingPlaywrightResults(results, companies, index + 1, reason);
          break;
        }
        console.error(`[scan] [local-browser] Failed "${company.name}": ${err.message}`);
        results.push(buildPlaywrightResult(company, { error: err.message, engine: 'local-browser' }));
      }
    }
  } finally {
    await ctx.close().catch(() => {});
    if (tempProfile) {
      await rm(tempProfile, { recursive: true, force: true }).catch(() => {});
    }
  }

  return results;
}

async function fetchPlaywrightSections(companies = []) {
  if (!companies.length) return [];
  if (isShuttingDown) {
    return companies.map(company => buildPlaywrightResult(company, {
      error: 'Cancelled because the UI server is restarting or shutting down',
      cancelled: true,
    }));
  }

  // pinchtab is optional: when its daemon is not running, drive the local
  // Playwright chromium instead of failing the whole batch.
  if (!(await pinchtabIsUp())) {
    console.log(`[scan] [pinchtab] using the local browser crawler instead`);
    return fetchPlaywrightSectionsLocal(companies);
  }

  const results = [];
  for (let index = 0; index < companies.length; index += 1) {
    const company = companies[index];
    if (isShuttingDown) {
      cancelRemainingPlaywrightResults(results, companies, index, 'Cancelled because the UI server is restarting');
      break;
    }

    let tabId;
    try {
      console.log(`[scan] [pinchtab] Fetching "${company.name}" → ${company.careers_url}`);
      tabId = await pinchtabNavigate(company.careers_url, { timeout: 20000 });
      let extracted = await extractJobsFromPinchtab(tabId, company.name);
      let jobs = extracted.jobs;

      // If empty, check for a challenge wall and try solving once before giving up.
      if (!jobs.length && extracted.challenge) {
        console.log(`[scan] [pinchtab] "${company.name}" challenge detected, attempting solve...`);
        const solved = await pinchtabSolve(tabId);
        if (solved) {
          console.log(`[scan] [pinchtab] "${company.name}" solved, re-scrolling + extracting...`);
          extracted = await extractJobsFromPinchtab(tabId, company.name, { maxWaitMs: 8000 });
          jobs = extracted.jobs;
        } else {
          console.warn(`[scan] [pinchtab] "${company.name}" solve failed`);
        }
      }
      if (!jobs.length && !extracted.challenge) {
        console.warn(`[scan] [pinchtab] "${company.name}" no jobs after waiting for client-rendered listings`);
      }
      jobs = await enrichPinchtabJobsWithDetails(jobs, company.name);

      console.log(`[scan] [pinchtab] "${company.name}" → ${jobs.length} jobs, ${jobs.filter(j => DIRECT_JOB_FILTER_REGEX.test(j.title)).length} after filter`);
      results.push({
        ok: true,
        section: buildJobSection(company.name, jobs),
        jobs,
        engine: 'pinchtab',
        company: company.name,
      });
    } catch (err) {
      if (isShuttingDown) {
        const reason = 'Cancelled because the UI server is restarting or shutting down';
        console.warn(`[scan] [pinchtab] Stopping "${company.name}": ${reason}`);
        results.push(buildPlaywrightResult(company, { error: reason, cancelled: true }));
        cancelRemainingPlaywrightResults(results, companies, index + 1, reason);
        break;
      }
      console.error(`[scan] [pinchtab] Failed "${company.name}": ${err.message}`);
      results.push(buildPlaywrightResult(company, { error: err.message }));
    } finally {
      await pinchtabClose(tabId);
    }
  }

  return results;
}

async function getPortals() {
  const { parsed } = await readPortalsYaml();
  return (parsed.tracked_companies || []).map(c => ({
    name: c.name || '',
    careers_url: c.careers_url || '',
    api: c.api || '',
    scan_method: c.scan_method || '',
    scan_query: c.scan_query || '',
    notes: c.notes || '',
    kind: c.kind === 'freelance' ? 'freelance' : 'job',
    enabled: c.enabled !== false,
  }));
}

async function addPortal(company) {
  const { parsed } = await readPortalsYaml();
  const list = parsed.tracked_companies || [];
  if (list.find(c => c.name === company.name)) throw new Error('Company already exists');
  const entry = { name: company.name, careers_url: company.careers_url, enabled: company.enabled !== false };
  if (company.api)         entry.api = company.api;
  if (company.scan_method) entry.scan_method = company.scan_method;
  if (company.scan_query)  entry.scan_query = company.scan_query;
  if (company.notes)       entry.notes = company.notes;
  if (company.kind === 'freelance') entry.kind = 'freelance';
  list.push(entry);
  parsed.tracked_companies = list;
  await writeFile(PORTALS_FILE, yamlDump(parsed, { lineWidth: 120, quotingType: '"' }), 'utf-8');
}

async function updatePortal(originalName, company) {
  const { parsed } = await readPortalsYaml();
  const list = parsed.tracked_companies || [];
  const idx = list.findIndex(c => c.name === originalName);
  if (idx === -1) throw new Error('Company not found');
  const previous = list[idx] || {};
  const entry = { name: company.name, careers_url: company.careers_url, enabled: company.enabled !== false };
  if (company.api)         entry.api = company.api;
  if (company.scan_method) entry.scan_method = company.scan_method;
  if (company.scan_query)  entry.scan_query = company.scan_query;
  if (company.notes)       entry.notes = company.notes;
  const nextKind = company.kind ?? previous.kind;
  if (nextKind === 'freelance') entry.kind = 'freelance';
  list[idx] = entry;
  parsed.tracked_companies = list;
  await writeFile(PORTALS_FILE, yamlDump(parsed, { lineWidth: 120, quotingType: '"' }), 'utf-8');
}

async function deletePortal(name) {
  const { parsed } = await readPortalsYaml();
  const list = parsed.tracked_companies || [];
  const idx = list.findIndex(c => c.name === name);
  if (idx === -1) throw new Error('Company not found');
  list.splice(idx, 1);
  parsed.tracked_companies = list;
  await writeFile(PORTALS_FILE, yamlDump(parsed, { lineWidth: 120, quotingType: '"' }), 'utf-8');
}

// ─── Scan State (data/scan-state.json) ───────────────────────────────────────

const SCAN_STATE_FILE      = join(WRITE_ROOT, 'data/scan-state.json');
const SCAN_SELECTION_FILE  = join(WRITE_ROOT, 'data/scan-selection.json');

async function getScanState() {
  try {
    const raw = await readFile(SCAN_STATE_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch { return {}; }
}

async function updateScanState(sourceNames = [], scannedAt = new Date().toISOString()) {
  if (!sourceNames.length) return;
  const current = await getScanState();
  sourceNames
    .map(name => String(name || '').trim())
    .filter(Boolean)
    .forEach(name => {
      current[name] = scannedAt;
    });
  await writeFile(SCAN_STATE_FILE, JSON.stringify(current, null, 2), 'utf-8');
}

async function getScanSources() {
  const { parsed } = await readPortalsYaml();
  const scanState  = await getScanState();
  const companies = (parsed.tracked_companies || [])
    .filter(c => c.enabled !== false)
    .map(c => {
      const access = getCompanyScanAccess(c);
      return {
        name: c.name,
        access: access.mode,
        hasApi: access.mode === 'api',
        apiKind: access.apiKind || '',
        kind: c.kind === 'freelance' ? 'freelance' : 'job',
        lastScanned: scanState[c.name] || null,
      };
    });
  const rss = (parsed.rss_feeds || [])
    .filter(r => r.enabled !== false)
    .map(r => ({ name: r.name, kind: 'job', lastScanned: scanState[r.name] || null }));
  const queries = [
    ...((parsed.search_queries  || []).map(q => ({ ...q, kind: 'job' }))),
    ...((parsed.eu_job_boards   || []).map(q => ({ ...q, kind: 'job' }))),
    ...((parsed.freelance_portals || []).map(q => ({ ...q, kind: 'freelance' }))),
  ]
    .filter(q => q.enabled !== false)
    .map(q => ({ name: q.name, kind: q.kind, lastScanned: scanState[q.name] || null }));
  const aggregators = getScanAggregators(parsed)
    .filter(a => a.enabled !== false)
    .map(a => ({
      name: a.name,
      configured: isAggregatorConfigured(a),
      requiresKey: aggregatorRequiresKey(a),
      kind: 'job',
      lastScanned: scanState[a.name] || null,
    }));
  return { companies, rss, queries, aggregators };
}

async function getScanSelection() {
  try { return JSON.parse(await readFile(SCAN_SELECTION_FILE, 'utf-8')); }
  catch { return null; }
}

async function saveScanSelection(sel) {
  await writeFile(SCAN_SELECTION_FILE, JSON.stringify(sel, null, 2), 'utf-8');
}

async function getScanHistoryRows() {
  const scanHistoryFile = join(WRITE_ROOT, 'data/scan-history.tsv');
  try {
    const raw = await readFile(scanHistoryFile, 'utf-8');
    return raw.split('\n').filter(Boolean);
  } catch {
    return ['url\tfirst_seen\tportal\ttitle\tcompany\tstatus'];
  }
}

async function getScanHistoryUrlSet() {
  const rows = await getScanHistoryRows();
  return new Set(
    rows
      .map(line => line.split('\t')[0]?.trim())
      .filter(url => url && url !== 'url')
  );
}

function scanHistoryStatusBlocksReadd(status = '') {
  const s = String(status || '').trim().toLowerCase();
  if (!s) return true;
  return !['added', 'skipped_dup'].includes(s);
}

async function getBlockingScanHistoryUrlSet() {
  const rows = await getScanHistoryRows();
  const latestStatusByUrl = new Map();
  rows.forEach(line => {
    const cells = line.split('\t');
    const url = cells[0]?.trim();
    if (!url || url === 'url') return;
    const status = cells[5]?.trim() || '';
    latestStatusByUrl.set(normalizeUrlKey(url), status);
  });
  return new Set(
    [...latestStatusByUrl.entries()]
      .filter(([, status]) => scanHistoryStatusBlocksReadd(status))
      .map(([url]) => url)
  );
}

async function getLatestScanHistoryEntryMap() {
  const rows = await getScanHistoryRows();
  const latestByUrl = new Map();
  rows.forEach(line => {
    const cells = line.split('\t');
    const url = cells[0]?.trim();
    if (!url || url === 'url') return;
    latestByUrl.set(normalizeUrlKey(url), {
      url,
      first_seen: cells[1]?.trim() || '',
      portal: cells[2]?.trim() || '',
      title: cells[3]?.trim() || '',
      company: cells[4]?.trim() || '',
      status: cells[5]?.trim() || '',
    });
  });
  return latestByUrl;
}

async function getReportUrlSet() {
  try {
    const files = await readdir(join(ROOT, 'reports'));
    const mdFiles = files.filter(f => f.endsWith('.md'));
    const urls = await Promise.all(
      mdFiles.map(async f => {
        try {
          const content = await readFile(join(ROOT, 'reports', f), 'utf-8');
          const m = content.match(/^\*\*URL:\*\*\s*(.+)$/m);
          return m ? m[1].trim() : null;
        } catch { return null; }
      })
    );
    return new Set(urls.filter(Boolean));
  } catch { return new Set(); }
}

async function getOrphanedScanPipelineItems(existingPipeline = []) {
  const [latestHistory, reportUrls] = await Promise.all([
    getLatestScanHistoryEntryMap().catch(() => new Map()),
    getReportUrlSet().catch(() => new Set()),
  ]);
  const knownUrls = new Set([
    ...(existingPipeline || []).map(item => normalizeUrlKey(item?.url || '')).filter(Boolean),
    ...[...reportUrls].map(url => normalizeUrlKey(url)).filter(Boolean),
  ]);

  return [...latestHistory.values()]
    .filter(entry => String(entry.status || '').trim().toLowerCase() === 'added')
    .filter(entry => {
      const key = normalizeUrlKey(entry.url);
      return key && !knownUrls.has(key);
    })
    .map(entry => normalizePipelineItem({
      url: entry.url,
      note: [entry.company, entry.title, entry.first_seen].filter(Boolean).join(' | '),
      company: entry.company,
      title: entry.title,
      created_at: entry.first_seen,
      scan_history_orphan: true,
      source: entry.portal,
    }));
}

async function shouldIncludeLocalScanHistoryOrphans(userId) {
  if (!useSupabase) return true;
  if (!userId) return true;
  const adminId = await getAdminUserId().catch(() => null);
  return Boolean(adminId && userId === adminId);
}

async function appendScanHistoryEntries(entries = []) {
  if (!entries.length) return;
  const scanHistoryFile = join(WRITE_ROOT, 'data/scan-history.tsv');
  const existingRows = await getScanHistoryRows();
  const payload = `${existingRows.join('\n').replace(/\n+$/,'')}\n${entries.join('\n')}\n`;
  await writeFile(scanHistoryFile, payload, 'utf-8');
}

const DELETED_APPLICATIONS_HEADER = 'company\trole\tdate_deleted\treason';

async function appendDeletedApplicationEntries(entries = []) {
  const rows = (entries || [])
    .map(e => ({
      company: tsvSafe(e.company),
      role: tsvSafe(e.role),
      date: tsvSafe(e.date || new Date().toISOString().slice(0, 10)),
      reason: tsvSafe(e.reason || 'user_deleted'),
    }))
    .filter(e => e.company && e.role);
  if (!rows.length) return;

  const deletedFile = join(WRITE_ROOT, 'data/deleted-applications.tsv');
  let existing = '';
  try {
    existing = await readFile(deletedFile, 'utf-8');
  } catch {
    existing = `${DELETED_APPLICATIONS_HEADER}\n`;
  }
  if (!existing.trim()) existing = `${DELETED_APPLICATIONS_HEADER}\n`;
  else if (!existing.startsWith('company\t')) {
    existing = `${DELETED_APPLICATIONS_HEADER}\n${existing.replace(/^\n+/, '')}`;
  }

  const payload = `${existing.replace(/\n+$/, '')}\n${rows.map(r => `${r.company}\t${r.role}\t${r.date}\t${r.reason}`).join('\n')}\n`;
  await writeFile(deletedFile, payload, 'utf-8');
}

async function getCompanyRoleExclusions(userId) {
  const exclusions = [];

  try {
    const apps = await getApplications(userId);
    for (const app of apps || []) {
      const company = app.Company ?? app.company ?? '';
      const role = app.Role ?? app.role ?? '';
      if (company && role) exclusions.push({ company: String(company), role: String(role) });
    }
  } catch { /* ignore */ }

  try {
    const deletedFile = join(WRITE_ROOT, 'data/deleted-applications.tsv');
    const raw = await readFile(deletedFile, 'utf-8');
    for (const line of raw.split('\n').slice(1)) {
      if (!line.trim()) continue;
      const [company, role] = line.split('\t');
      if (company && role) exclusions.push({ company, role });
    }
  } catch { /* file may not exist yet */ }

  const byCompany = new Map();
  for (const e of exclusions) {
    const key = normalizeCompany(e.company);
    if (!key) continue;
    if (!byCompany.has(key)) byCompany.set(key, []);
    byCompany.get(key).push(e.role);
  }
  return byCompany;
}

function isCompanyRoleExcluded(company, role, exclusionsByCompany) {
  if (!exclusionsByCompany?.size) return false;
  const roles = exclusionsByCompany.get(normalizeCompany(company));
  if (!roles?.length) return false;
  return roles.some(r => roleMatch(r, role));
}

function setApplicationStatusInMarkdown(raw, num, status) {
  let updated = false;
  const newLines = String(raw || '').split('\n').map(line => {
    if (!line.trim().startsWith('|')) return line;
    const rowNum = getMarkdownTableRowNumber(line);
    if (!rowNum || rowNum === '#' || rowNum !== String(num)) return line;
    const cells = line.split('|');
    if (cells.length < 7) return line;
    cells[6] = ` ${status} `;
    updated = true;
    return cells.join('|');
  });
  return { content: newLines.join('\n'), updated };
}

function setApplicationStatusesInMarkdown(raw, nums, status) {
  let updated = false;
  const newLines = String(raw || '').split('\n').map(line => {
    if (!line.trim().startsWith('|')) return line;
    const rowNum = getMarkdownTableRowNumber(line);
    if (!rowNum || rowNum === '#' || !nums.has(String(rowNum))) return line;
    const cells = line.split('|');
    if (cells.length < 7) return line;
    cells[6] = ` ${status} `;
    updated = true;
    return cells.join('|');
  });
  return { content: newLines.join('\n'), updated };
}

async function writeMarkdownApplicationStatus(num, status) {
  const appFile = join(WRITE_ROOT, 'data/applications.md');
  const raw = await readFile(appFile, 'utf-8');
  const { content, updated } = setApplicationStatusInMarkdown(raw, num, status);
  if (!updated) return false;
  await writeFile(appFile, content, 'utf-8');
  return true;
}

async function recordManualApplicationDelete({ company, role, jobUrl, date }) {
  const historyUrl = (jobUrl && String(jobUrl).startsWith('http'))
    ? String(jobUrl).trim()
    : `unknown:${tsvSafe(company) || 'company'}:${tsvSafe(role) || 'role'}`;
  await appendScanHistoryEntries([
    `${historyUrl}\t${date}\tmanual-delete\t${tsvSafe(role)}\t${tsvSafe(company)}\tdeleted`,
  ]).catch(() => {});
  if (company && role) {
    await appendDeletedApplicationEntries([
      { company, role, date, reason: 'user_deleted' },
    ]).catch(() => {});
  }
}

function extractScanEntriesFromResponse(fullResponse = '', scanUrlPublishedAt = new Map()) {
  const sectionMatch = fullResponse.match(
    /(?:##\s*)?URLs_À_AJOUTER[^\n]*\n(?:```+[^\n]*\n)?([\s\S]*?)(?:```+\n)?(?:\n##|\n---\s*$|$)/i
  );
  const rawLines = sectionMatch
    ? sectionMatch[1].trim().split('\n')
    : fullResponse.split('\n').filter(line => /https?:\/\//i.test(line));

  const seen = new Set();
  const results = [];

  rawLines.forEach(rawLine => {
    const line = String(rawLine || '').replace(/^[-*]\s*/, '').trim();
    if (!line) return;

    const markdownUrl = line.match(/\((https?:\/\/[^)\s]+)\)/i)?.[1] || '';
    const bareUrl = line.match(/https?:\/\/[^\s|)]+/i)?.[0] || '';
    const url = markdownUrl || bareUrl;
    if (!url || seen.has(url)) return;
    seen.add(url);

    const normalizedLine = line
      .replace(/\[[^\]]+\]\((https?:\/\/[^)\s]+)\)/gi, '$1')
      .replace(/\s+[—–]\s+/g, ' | ');
    const pieces = normalizedLine.split('|').map(part => part.trim()).filter(Boolean);
    const rest = pieces.filter(part => part !== url);
    let note = rest.join(' | ');

    const lastPart = rest[rest.length - 1] || '';
    const hasDateAlready = looksLikeDate(lastPart);
    if (!hasDateAlready && scanUrlPublishedAt?.size) {
      const key = normalizeUrlKey(url);
      const publishedAt = scanUrlPublishedAt.get(url) || scanUrlPublishedAt.get(key) || '';
      if (publishedAt) {
        note = note ? `${note} | ${publishedAt}` : publishedAt;
      }
    }

    results.push({ url, note });
  });

  return results;
}

// ─── Search Queries (search_queries + eu_job_boards) ─────────────────────────

async function getQueries() {
  const { parsed } = await readPortalsYaml();
  const sq = (parsed.search_queries || []).map(q => ({ ...q, section: 'search_queries' }));
  const eu = (parsed.eu_job_boards  || []).map(q => ({ ...q, section: 'eu_job_boards'  }));
  return [...sq, ...eu].map(q => ({
    name:    q.name    || '',
    query:   q.query   || '',
    enabled: q.enabled !== false,
    section: q.section,
  }));
}

async function addQuery(entry) {
  const { parsed } = await readPortalsYaml();
  const section = entry.section === 'eu_job_boards' ? 'eu_job_boards' : 'search_queries';
  const list = parsed[section] || [];
  if (list.find(q => q.name === entry.name)) throw new Error('Query with this name already exists');
  list.push({ name: entry.name, query: entry.query, enabled: entry.enabled !== false });
  parsed[section] = list;
  await writeFile(PORTALS_FILE, yamlDump(parsed, { lineWidth: 120, quotingType: '"' }), 'utf-8');
}

async function updateQuery(originalName, entry) {
  const { parsed } = await readPortalsYaml();
  for (const section of ['search_queries', 'eu_job_boards']) {
    const list = parsed[section] || [];
    const idx = list.findIndex(q => q.name === originalName);
    if (idx !== -1) {
      // If section changed, move it
      const targetSection = entry.section === 'eu_job_boards' ? 'eu_job_boards' : 'search_queries';
      list.splice(idx, 1);
      parsed[section] = list;
      const targetList = parsed[targetSection] || [];
      targetList.push({ name: entry.name, query: entry.query, enabled: entry.enabled !== false });
      parsed[targetSection] = targetList;
      await writeFile(PORTALS_FILE, yamlDump(parsed, { lineWidth: 120, quotingType: '"' }), 'utf-8');
      return;
    }
  }
  throw new Error('Query not found');
}

async function deleteQuery(name) {
  const { parsed } = await readPortalsYaml();
  for (const section of ['search_queries', 'eu_job_boards']) {
    const list = parsed[section] || [];
    const idx = list.findIndex(q => q.name === name);
    if (idx !== -1) {
      list.splice(idx, 1);
      parsed[section] = list;
      await writeFile(PORTALS_FILE, yamlDump(parsed, { lineWidth: 120, quotingType: '"' }), 'utf-8');
      return;
    }
  }
  throw new Error('Query not found');
}

async function toggleQuery(name, enabled) {
  const { parsed } = await readPortalsYaml();
  for (const section of ['search_queries', 'eu_job_boards']) {
    const list = parsed[section] || [];
    const entry = list.find(q => q.name === name);
    if (entry) {
      entry.enabled = enabled;
      parsed[section] = list;
      await writeFile(PORTALS_FILE, yamlDump(parsed, { lineWidth: 120, quotingType: '"' }), 'utf-8');
      return;
    }
  }
  throw new Error('Query not found');
}

// ─── Profile (config/profile.yml) ────────────────────────────────────────────

const PROFILE_FILE = join(ROOT, 'config/profile.yml');
const PROFILE_CONTEXT_FILE = join(ROOT, 'modes/_profile.md');

async function getProfile(userId) {
  if (useSupabase && userId) {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
    if (error && error.code !== 'PGRST116') throw error;
    return data || {};
  }
  const raw = await readFile(PROFILE_FILE, 'utf-8');
  return yamlLoad(raw);
}

async function saveProfile(data, userId) {
  if (useSupabase && userId) {
    // Le frontend envoie le format imbriqué YAML — on l'aplatit pour la table profiles
    const candidate = data.candidate || {};
    const row = {
      id:           userId,
      full_name:    candidate.full_name  || data.full_name  || '',
      email:        candidate.email      || data.email      || '',
      location:     candidate.location   || '',
      linkedin:     candidate.linkedin   || data.linkedin   || '',
      target_roles:   data.target_roles    || null,
      narrative:      data.narrative       || null,
      compensation:   data.compensation    || null,
      search_prefs:   data.search          || data.search_prefs || null,
      location_prefs: data.location        || null,
    };
    const { error } = await supabase.from('profiles').upsert(row);
    if (error) throw error;
    return;
  }
  await writeFile(PROFILE_FILE, yamlDump(data, { lineWidth: 120, quotingType: '"' }), 'utf-8');
}

async function getProfileContext(userId) {
  if (useSupabase && userId) {
    const { data } = await supabase.from('profiles').select('profile_context').eq('id', userId).single();
    return data?.profile_context || '';
  }
  return readFile(PROFILE_CONTEXT_FILE, 'utf-8').catch(() => '');
}

async function saveProfileContext(markdown = '', userId) {
  const normalized = String(markdown ?? '').replace(/\r\n/g, '\n');
  if (useSupabase && userId) {
    const { error } = await supabase.from('profiles').upsert({ id: userId, profile_context: normalized });
    if (error) throw error;
    return;
  }
  await writeFile(PROFILE_CONTEXT_FILE, normalized, 'utf-8');
}

async function getCvMarkdown(userId) {
  if (useSupabase && userId) {
    const { data } = await supabase.from('profiles').select('cv_markdown').eq('id', userId).single();
    return data?.cv_markdown || '';
  }
  return readFile(join(ROOT, 'cv.md'), 'utf-8').catch(() => '');
}

async function saveCvMarkdown(markdown = '', userId) {
  const normalized = String(markdown ?? '').replace(/\r\n/g, '\n');
  if (useSupabase && userId) {
    const { error } = await supabase.from('profiles').upsert({ id: userId, cv_markdown: normalized });
    if (error) throw error;
    return;
  }
  await writeFile(join(WRITE_ROOT, 'cv.md'), normalized, 'utf-8');
}

async function saveProfileBundle(payload = {}, userId) {
  const profile = payload?.profile ?? payload;
  const hasContext = Object.prototype.hasOwnProperty.call(payload || {}, 'context_markdown');

  if (!hasContext) {
    await saveProfile(profile, userId);
    return;
  }

  // Supabase path : tout en une seule upsert atomique
  if (useSupabase && userId) {
    await saveProfile(profile, userId);
    await saveProfileContext(payload.context_markdown, userId);
    return;
  }

  // Fichiers locaux : rollback en cas d'erreur
  const previousProfile = await readFile(PROFILE_FILE, 'utf-8').catch(() => null);
  const previousContext = await readFile(PROFILE_CONTEXT_FILE, 'utf-8').catch(() => null);
  const nextProfile = yamlDump(profile, { lineWidth: 120, quotingType: '"' });
  const nextContext = String(payload?.context_markdown ?? '').replace(/\r\n/g, '\n');
  try {
    await writeFile(PROFILE_FILE, nextProfile, 'utf-8');
    await writeFile(PROFILE_CONTEXT_FILE, nextContext, 'utf-8');
  } catch (error) {
    if (previousProfile !== null) await writeFile(PROFILE_FILE, previousProfile, 'utf-8').catch(() => {});
    if (previousContext !== null) await writeFile(PROFILE_CONTEXT_FILE, previousContext, 'utf-8').catch(() => {});
    throw error;
  }
}

// ─── Profile completeness ────────────────────────────────────────────────────

function isMissing(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

async function getProfileStatus(userId) {
  const data = await getProfile(userId).catch(() => ({}));
  const cv = await getCvMarkdown(userId).catch(() => '');
  const candidate = data.candidate || data || {};
  const targetRoles = data.target_roles || {};
  const primary = Array.isArray(targetRoles.primary) ? targetRoles.primary : [];
  // location is stored under `location_prefs` in DB (jsonb) or `location` in YAML
  const loc = data.location_prefs || data.location || {};

  const missing = [];
  if (isMissing(data.full_name) && isMissing(candidate.full_name)) missing.push('identity');
  if (isMissing(primary)) missing.push('target_roles');
  if (isMissing(loc.country) && isMissing(candidate.location)) missing.push('location');
  if (isMissing(cv)) missing.push('cv');

  return { complete: missing.length === 0, missing };
}

// ─── CV parsing via OpenRouter ───────────────────────────────────────────────

const CV_PARSE_SYSTEM_PROMPT = `You extract structured profile data from a candidate's CV.

Return ONLY a JSON object — no prose, no markdown fences, no commentary. Match this exact shape:

{
  "candidate": {
    "full_name": "string",
    "email": "string",
    "phone": "string",
    "location": "string",
    "linkedin": "string (just the URL or handle, no prefix)",
    "portfolio_url": "string",
    "github": "string",
    "twitter": "string"
  },
  "target_roles": {
    "primary": ["array of 1-3 role titles inferred from the CV's most recent / strongest experience"],
    "archetypes": [
      { "name": "role family", "level": "Junior|Mid|Senior|Staff|Principal", "fit": "primary|secondary|adjacent" }
    ]
  },
  "narrative": {
    "headline": "one-line professional headline (max 80 chars)",
    "exit_story": "1-2 sentences on what makes this candidate unique",
    "superpowers": ["3-5 short capabilities, one phrase each"],
    "proof_points": [
      { "name": "project name", "url": "string or empty", "hero_metric": "concrete metric or outcome" }
    ]
  },
  "compensation": {
    "target_range": "",
    "currency": "infer from location, e.g. EUR/USD/GBP",
    "minimum": "",
    "location_flexibility": ""
  },
  "location": {
    "country": "string",
    "city": "string",
    "timezone": "string (e.g. CET, PST)",
    "visa_status": "",
    "remote_policy": ""
  },
  "search": {
    "contract_types": [],
    "sector_preferences": [],
    "geography_preferences": [],
    "must_haves": [],
    "nice_to_haves": [],
    "deal_breakers": []
  }
}

Rules:
- If a field is unknown, use "" or [] — never guess or invent.
- Never invent metrics, companies, or projects. Only extract what's literally in the CV.
- Keep strings concise. No newlines inside string values.
- Respond with the raw JSON object only.`;

async function parseCvForProfile(cvText) {
  const trimmed = String(cvText || '').trim();
  if (!trimmed) throw new Error('CV text is empty');
  const truncated = trimmed.length > 30000 ? trimmed.slice(0, 30000) : trimmed;

  const response = await chat({
    model: MODELS.CLAUDE_HAIKU,
    systemPrompt: CV_PARSE_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `CV content:\n\n${truncated}` }],
    temperature: 0.1,
    max_tokens: 3000,
  });

  let raw = String(response || '').trim();
  // Strip markdown fences if model added them despite instructions
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    raw = raw.slice(firstBrace, lastBrace + 1);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse CV JSON: ${err.message}`);
  }
  return parsed;
}

function slugify(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'document';
}

function cleanString(value = '') {
  return String(value ?? '').trim();
}

function cleanList(value) {
  return Array.isArray(value) ? value.map(item => cleanString(item)).filter(Boolean) : [];
}

function normalizeInline(value = '') {
  return cleanString(value).replace(/\s+/g, ' ');
}

function inferProfileMatchingRules(profileData = {}, profileMarkdown = '') {
  const candidate = profileData.candidate || {};
  const targetRoles = profileData.target_roles || {};
  const narrative = profileData.narrative || {};
  const compensation = profileData.compensation || {};
  const location = profileData.location || {};
  const search = profileData.search || {};

  const primaryRoles = cleanList(targetRoles.primary);
  const archetypes = Array.isArray(targetRoles.archetypes)
    ? targetRoles.archetypes
        .map(entry => ({
          name: cleanString(entry?.name),
          level: cleanString(entry?.level),
          fit: cleanString(entry?.fit) || 'secondary',
        }))
        .filter(entry => entry.name)
    : [];

  const remotePolicy = normalizeInline(location.remote_policy || compensation.location_flexibility);
  const profileText = `${remotePolicy}\n${profileMarkdown}`.toLowerCase();
  const fullRemoteOnly =
    /full remote/.test(profileText) &&
    /(required|obligatoire|only|obligatoire\.|mandatory|full remote only)/.test(profileText);
  const noRelocation = /no relocation|sans relocalisation|pas de relocalisation/.test(profileText);
  const occasionalOnsiteOk = /occasional on-?site|on-?site occasionnel|sessions on-?site occasionnelles|exceptional opportunity|opportunité exceptionnelle/.test(profileText);

  return {
    candidate: {
      location: normalizeInline(candidate.location),
      country: normalizeInline(location.country),
      city: normalizeInline(location.city),
      timezone: normalizeInline(location.timezone),
      visaStatus: normalizeInline(location.visa_status),
    },
    targeting: {
      primaryRoles,
      archetypes,
      headline: normalizeInline(narrative.headline),
      superpowers: cleanList(narrative.superpowers),
    },
    compensation: {
      targetRange: normalizeInline(compensation.target_range),
      minimum: normalizeInline(compensation.minimum),
      employmentType: normalizeInline(compensation.employment_type),
      locationFlexibility: normalizeInline(compensation.location_flexibility),
    },
    search: {
      contractTypes: cleanList(search.contract_types),
      sectorPreferences: cleanList(search.sector_preferences),
      geographyPreferences: cleanList(search.geography_preferences),
      onsiteAvailability: normalizeInline(search.onsite_availability),
      mustHaves: cleanList(search.must_haves),
      niceToHaves: cleanList(search.nice_to_haves),
      dealBreakers: cleanList(search.deal_breakers),
    },
    location: {
      remotePolicy,
      fullRemoteOnly,
      noRelocation,
      occasionalOnsiteOk,
    },
  };
}

function buildProfileCriteriaBlock(profileData = {}, profileMarkdown = '') {
  const rules = inferProfileMatchingRules(profileData, profileMarkdown);
  const archetypeLines = rules.targeting.archetypes.length
    ? rules.targeting.archetypes.map(entry => `- ${entry.name}${entry.level ? ` (${entry.level})` : ''} — fit ${entry.fit}`).join('\n')
    : '- none';
  const superpowers = rules.targeting.superpowers.length
    ? rules.targeting.superpowers.map(item => `- ${item}`).join('\n')
    : '- none';
  const contractTypes = rules.search.contractTypes.length
    ? rules.search.contractTypes.map(item => `- ${item}`).join('\n')
    : '- none';
  const sectors = rules.search.sectorPreferences.length
    ? rules.search.sectorPreferences.map(item => `- ${item}`).join('\n')
    : '- none';
  const geography = rules.search.geographyPreferences.length
    ? rules.search.geographyPreferences.map(item => `- ${item}`).join('\n')
    : '- none';
  const mustHaves = rules.search.mustHaves.length
    ? rules.search.mustHaves.map(item => `- ${item}`).join('\n')
    : '- none';
  const niceToHaves = rules.search.niceToHaves.length
    ? rules.search.niceToHaves.map(item => `- ${item}`).join('\n')
    : '- none';
  const dealBreakers = rules.search.dealBreakers.length
    ? rules.search.dealBreakers.map(item => `- ${item}`).join('\n')
    : '- none';

  return [
    '### Hard Matching Rules',
    `- Remote policy: ${rules.location.remotePolicy || 'not specified'}`,
    `- Full remote only: ${rules.location.fullRemoteOnly ? 'yes' : 'no'}`,
    `- No relocation: ${rules.location.noRelocation ? 'yes' : 'no'}`,
    `- Occasional on-site acceptable: ${rules.location.occasionalOnsiteOk ? 'yes' : 'no'}`,
    `- Employment type: ${rules.compensation.employmentType || 'not specified'}`,
    `- Minimum compensation: ${rules.compensation.minimum || 'not specified'}`,
    `- Target compensation: ${rules.compensation.targetRange || 'not specified'}`,
    `- Visa status: ${rules.candidate.visaStatus || 'not specified'}`,
    '',
    '### Target Roles',
    ...(rules.targeting.primaryRoles.length ? rules.targeting.primaryRoles.map(role => `- ${role}`) : ['- none']),
    '',
    '### Archetypes',
    archetypeLines,
    '',
    '### Candidate Context',
    `- Headline: ${rules.targeting.headline || 'not specified'}`,
    `- Location: ${[rules.candidate.location, rules.candidate.city, rules.candidate.country].filter(Boolean).join(' / ') || 'not specified'}`,
    `- Timezone: ${rules.candidate.timezone || 'not specified'}`,
    '',
    '### Strong Proof Areas',
    superpowers,
    '',
    '### Search Criteria',
    `- On-site availability: ${rules.search.onsiteAvailability || 'not specified'}`,
    'Contract types:',
    contractTypes,
    'Sector preferences:',
    sectors,
    'Geography preferences:',
    geography,
    'Must-haves:',
    mustHaves,
    'Nice-to-haves:',
    niceToHaves,
    'Deal-breakers:',
    dealBreakers,
    '',
    '### Enforcement',
    '- Any offer that violates a hard rule must be rejected immediately.',
    '- If the profile says full remote only and the JD is hybrid or on-site, hard pass directly.',
    '- If a profile criterion is not visible in the JD, do not invent it; mark it as unknown.',
  ].join('\n');
}

function inferWorkModeFromText(text = '') {
  const content = String(text || '');
  const lower = content.toLowerCase();
  const snippets = [];

  const collect = (patterns) => {
    for (const pattern of patterns) {
      const match = lower.match(pattern);
      if (match) {
        const start = Math.max(0, match.index - 40);
        const end = Math.min(content.length, match.index + match[0].length + 80);
        snippets.push(normalizeInline(content.slice(start, end)));
      }
    }
  };

  const hybridPatterns = [
    /\bhybrid\b/,
    /\b\d+\s*(?:-|to)\s*\d+\s*days?\s*(?:a|per)?\s*week\b/,
    /\b\d+\s*days?\s*(?:a|per)?\s*week\b/,
    /\bin[- ]office\b/,
    /\bon-?site\b/,
    /\boffice[- ]based\b/,
  ];
  const onsitePatterns = [
    /\bon-?site only\b/,
    /\bfully on-?site\b/,
    /\bmust be based in\b/,
    /\bmust relocate\b/,
    /\brelocation required\b/,
    /\b5\s*days?\s*(?:a|per)?\s*week\b/,
    /\bat our [a-z ]+ office\b/,
  ];
  const remotePatterns = [
    /\bfull(?:y)? remote\b/,
    /\bremote[- ]first\b/,
    /\bwork from anywhere\b/,
    /\bdistributed team\b/,
    /\bremote within\b/,
    /\bremote role\b/,
    /\bremote\b/,
  ];

  if (onsitePatterns.some(pattern => pattern.test(lower))) {
    collect(onsitePatterns);
    return { mode: 'onsite', evidence: snippets.slice(0, 3) };
  }
  if (hybridPatterns.some(pattern => pattern.test(lower))) {
    collect(hybridPatterns);
    return { mode: 'hybrid', evidence: snippets.slice(0, 3) };
  }
  if (remotePatterns.some(pattern => pattern.test(lower))) {
    collect(remotePatterns);
    return { mode: 'remote', evidence: snippets.slice(0, 3) };
  }
  return { mode: 'unknown', evidence: [] };
}

function evaluateOfferAgainstProfile(jdText = '', profileData = {}, profileMarkdown = '') {
  const rules = inferProfileMatchingRules(profileData, profileMarkdown);
  const workMode = inferWorkModeFromText(jdText);
  const reasons = [];

  if (rules.location.fullRemoteOnly && (workMode.mode === 'hybrid' || workMode.mode === 'onsite')) {
    reasons.push(`Profile requires full remote, but the JD looks ${workMode.mode}.`);
  }

  return {
    hardReject: reasons.length > 0,
    reasons,
    workMode,
    rules,
  };
}

async function togglePortal(name, enabled) {
  const { parsed } = await readPortalsYaml();
  const list = parsed.tracked_companies || [];
  const company = list.find(c => c.name === name);
  if (!company) throw new Error('Company not found');
  company.enabled = enabled;
  parsed.tracked_companies = list;
  await writeFile(PORTALS_FILE, yamlDump(parsed, { lineWidth: 120, quotingType: '"' }), 'utf-8');
}

// Atomic batch remove: one Supabase update + one read+write of pipeline.md +
// one appendScanHistoryEntries call. Replaces parallel removeFromPipeline calls
// that clobbered each other on pipeline.md.
async function removeManyFromPipeline(urls = [], userId, { historyStatus = 'deleted', historyPortal = 'manual-delete' } = {}) {
  const cleanUrls = (urls || []).map(u => String(u || '').trim()).filter(u => u.startsWith('http'));
  if (!cleanUrls.length) return;
  const removeSet = new Set(cleanUrls);

  // Fetch metadata for scan-history before we mutate anything
  const itemsByUrl = new Map();
  if (useSupabase) {
    let q = supabase.from('pipeline').select('*').in('url', cleanUrls);
    if (userId) q = q.eq('user_id', userId);
    const { data } = await q;
    (data || []).forEach(d => itemsByUrl.set(d.url, normalizePipelineItem(d)));
  } else {
    const all = await getPipeline().catch(() => []);
    all.forEach(it => { if (removeSet.has(it.url)) itemsByUrl.set(it.url, it); });
  }

  // Mark processed in Supabase. Use one equality update per URL: PostgREST's
  // `in` filter treats commas inside some real posting URLs as separators and
  // returns a bare Bad Request, which previously left the UI unchanged.
  if (useSupabase) {
    for (const url of cleanUrls) {
      let q = supabase.from('pipeline').update({ processed: true }).eq('url', url);
      if (userId) q = q.eq('user_id', userId);
      const { error } = await q;
      if (error) {
        console.error('Supabase update error:', error);
        throw new Error(`Supabase pipeline sync failed: ${error.message}`);
      }
    }
  }

  // Single read+write of pipeline.md
  const raw = await readFile(join(ROOT, 'data/pipeline.md'), 'utf-8');
  const updated = raw
    .split('\n')
    .filter(l => {
      const trimmed = l.trim();
      const cleanUrlOnLine = trimmed.replace(/^[-*+]\s*(\[[ xX]\]\s*)?/, '').trim().split(/\s+(?:[—–|]|-(?!\s*[\w]))\s+/)[0];
      if (removeSet.has(cleanUrlOnLine)) return false;
      for (const url of cleanUrls) {
        if (trimmed.startsWith(url) || trimmed.includes(url)) return false;
      }
      return true;
    })
    .join('\n');
  await writeFile(join(WRITE_ROOT, 'data/pipeline.md'), updated, 'utf-8');

  // Append all scan-history entries in one shot
  const today = new Date().toISOString().split('T')[0];
  const historyRows = cleanUrls.map(url => {
    const item = itemsByUrl.get(url);
    return `${url}\t${today}\t${historyPortal}\t${item?.title || ''}\t${item?.company || ''}\t${historyStatus}`;
  });
  await appendScanHistoryEntries(historyRows)
    .catch(err => console.warn('[pipeline] Failed to append to scan-history:', err.message));
}

async function removeFromPipeline(url, userId, opts) {
  return removeManyFromPipeline([url], userId, opts);
}

// ─── Script runner ────────────────────────────────────────────────────────────

const ALLOWED_SCRIPTS = {
  'merge':     'node merge-tracker.mjs',
  'normalize': 'node normalize-statuses.mjs',
  'dedup':     'node dedup-tracker.mjs',
  'verify-reports': 'node verify-reports.mjs',
  'pdf-gen':   'node generate-pdf.mjs',
  'purge-stale': 'node purge-stale.mjs',
  'sync-apps': 'node sync-supabase.mjs applications',
};

function runScript(scriptKey, extraArgs = []) {
  return new Promise((resolve) => {
    const cmd = ALLOWED_SCRIPTS[scriptKey];
    if (!cmd) return resolve({ ok: false, error: 'Unknown script' });
    const [bin, ...args] = cmd.split(' ');
    const finalArgs = [...args, ...extraArgs];
    const proc = spawn(bin, finalArgs, { cwd: ROOT });
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => stderr += d);
    proc.on('close', code => resolve({ ok: code === 0, stdout, stderr, code }));
  });
}

/** Parse applications.md into Supabase-shaped rows. */
function parseApplicationsMarkdown(content = '') {
  const lines = String(content).split('\n').filter(l => l.trim().startsWith('|'));
  if (lines.length < 3) return [];
  const headers = lines[0].split('|').map(h => h.trim()).filter(Boolean);
  return lines.slice(2)
    .map(row => {
      const cells = row.split('|').map(c => c.trim());
      // Keep empty trailing cells — do NOT filter(Boolean) (drops empty Notes).
      const values = cells.slice(1, -1);
      const obj = {};
      headers.forEach((h, i) => { obj[h] = values[i] ?? ''; });
      return obj;
    })
    .filter(row => Object.values(row).some(v => v))
    .map(row => ({
      num:     parseInt(row['#'] || row['num'], 10),
      date:    row['Date']    || row['date'] || '',
      company: row['Company'] || row['company'] || '',
      role:    row['Role']    || row['role'] || '',
      score:   row['Score']   || row['score'] || '',
      status:  row['Status']  || row['status'] || '',
      pdf:     row['PDF']     || row['pdf'] || '',
      report:  row['Report']  || row['report'] || '',
      notes:   row['Notes']   || row['notes'] || '',
    }))
    .filter(r => !isNaN(r.num));
}

/**
 * Push local applications.md → Supabase using the logged-in user id when available.
 * This is the missing link that made evaluated offers invisible in the UI.
 */
async function syncLocalApplicationsToSupabase(userId) {
  if (!useSupabase || !supabase) return { ok: true, skipped: true, count: 0 };
  const appFile = join(WRITE_ROOT, 'data/applications.md');
  let raw = '';
  try {
    raw = await readFile(appFile, 'utf-8');
  } catch {
    return { ok: false, error: 'applications.md missing', count: 0 };
  }
  const rows = parseApplicationsMarkdown(raw);
  if (!rows.length) return { ok: true, count: 0 };

  const uid = userId || await getAdminUserId().catch(() => null);
  if (uid) rows.forEach(r => { r.user_id = uid; });

  const { error } = await supabase.from('applications').upsert(rows, { onConflict: 'num' });
  if (error) {
    console.error('[sync-apps] Supabase upsert failed:', error.message);
    return { ok: false, error: error.message, count: 0 };
  }
  console.log(`[sync-apps] ${rows.length} application(s) synced to Supabase (user=${uid || 'none'})`);
  return { ok: true, count: rows.length };
}

// ── Report Integrity ─────────────────────────────────────────────────────────

const CORRUPTION_PATTERNS = [
  '<tool_call>', '<tool_response>', '</tool_call>', '</tool_response>',
  '"name": "browser_navigate"', '"name": "browser_snapshot"',
  '"name": "bash"', '"name": "WebFetch"', '"name": "WebSearch"',
  'Taking a screenshot...', '</thinking>', '<thinking>',
];

const REPORT_SECTION_PATTERNS = [
  /^## (?:A\)|Block A|Bloque A|Resumen del Rol|Résumé)/m,
  /^## (?:B\)|Block B|Bloque B|Match)/m,
  /^## (?:C\)|Block C|Bloque C|Nivel|Stratégie|Niveau)/m,
  /^## (?:D\)|Block D|Bloque D|Comp)/m,
  /^## (?:E\)|Block E|Bloque E|Personali)/m,
  /^## (?:F\)|Block F|Bloque F|Entrevista|Interview|Préparation)/m,
  /^## (?:Scoring|Score|Recommand|Disqualification|🚨)/m,
];

/**
 * Validates that report content is a proper structured evaluation,
 * not raw LLM conversation logs or corrupted output.
 * Returns { valid: boolean, reason?: string }
 */
function validateReportContent(content, scoreRaw, company, role) {
  // Check 1: No corruption patterns (raw tool_call/tool_response logs)
  const foundCorruption = CORRUPTION_PATTERNS.filter(p => content.includes(p));
  if (foundCorruption.length > 0) {
    return { valid: false, reason: `Contains raw LLM logs: ${foundCorruption.slice(0, 3).join(', ')}` };
  }

  // Check 2: Score must be a real number, not a placeholder dash
  if (!scoreRaw || scoreRaw === '—' || scoreRaw === '-') {
    return { valid: false, reason: `Score is placeholder (${scoreRaw}) — evaluation was not completed` };
  }

  // Check 3: Company and role must not be default placeholders
  if (company === 'unknown' && role === 'role') {
    return { valid: false, reason: 'Could not extract company/role from response — evaluation may have failed' };
  }

  // Check 4: Must have at least 2 structured evaluation sections
  const sectionCount = REPORT_SECTION_PATTERNS.filter(p => p.test(content)).length;
  if (sectionCount < 2) {
    return { valid: false, reason: `Only ${sectionCount} evaluation sections found (need at least 2)` };
  }

  return { valid: true };
}

function parseCoverLetterSections(markdown = '') {
  const getSection = (heading) => {
    const regex = new RegExp(`##\\s+${heading}\\s*([\\s\\S]*?)(?=\\n##\\s+|$)`, 'i');
    return markdown.match(regex)?.[1]?.trim() || '';
  };

  const shortVersion = getSection('Version courte');
  const emailVersion = getSection('Version email');
  const personalize = getSection('Points à personnaliser')
    .split('\n')
    .map(line => line.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean);

  return { shortVersion, emailVersion, personalize };
}

function escapeHtml(value = '') {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatCoverLetterUrl(value = '') {
  const raw = cleanString(value);
  if (!raw) return '';

  try {
    const parsed = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    const host = parsed.hostname.replace(/^www\./, '');
    const path = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '');
    const search = parsed.search ? '?' : '';
    const compact = `${host}${path}${search}`;
    return compact.length > 48 ? `${compact.slice(0, 45)}...` : compact;
  } catch {
    return raw.length > 48 ? `${raw.slice(0, 45)}...` : raw;
  }
}

function formatCoverLetterContactItems(candidate = {}, location = {}) {
  const entries = [
    cleanString(candidate.email),
    cleanString(candidate.phone),
    formatCoverLetterUrl(candidate.linkedin),
    formatCoverLetterUrl(candidate.portfolio_url),
    formatCoverLetterUrl(candidate.github),
    cleanString(candidate.location || location.city || location.country),
  ].filter(Boolean);

  return entries;
}

function textToParagraphsHtml(text = '') {
  return text
    .split(/\n\s*\n/)
    .map(block => block.trim())
    .filter(Boolean)
    .map(block => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

async function renderCoverLetterPdfHtml({ company = '', role = '', markdown = '', profileData = {} }) {
  const candidate = profileData.candidate || {};
  const location = profileData.location || {};
  const { shortVersion } = parseCoverLetterSections(markdown);
  const today = new Date().toISOString().slice(0, 10);
  const headerName = cleanString(candidate.full_name) || 'Candidate';
  const contacts = formatCoverLetterContactItems(candidate, location);
  const letterBody = cleanString(shortVersion || markdown);
  const hasClosing = /\b(best|regards|sincerely|cheers|thank you|kind regards|warm regards)\b[\s,!.\-]*$/i.test(letterBody);
  const signatureHtml = hasClosing
    ? ''
    : `<div class="signature">
         <div>Best regards,</div>
         <div class="signature-name">${escapeHtml(headerName)}</div>
       </div>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Cover Letter — ${company} — ${role}</title>
  <style>
    @font-face {
      font-family: 'Space Grotesk';
      src: url('./fonts/space-grotesk-latin.woff2') format('woff2');
      font-weight: 300 700;
      font-style: normal;
      font-display: swap;
    }
    @font-face {
      font-family: 'DM Sans';
      src: url('./fonts/dm-sans-latin.woff2') format('woff2');
      font-weight: 100 1000;
      font-style: normal;
      font-display: swap;
    }
    @page { size: A4; margin: 16mm 16mm 14mm; }
    :root {
      --ink: #1a1a2e;
      --muted: #5b6472;
      --line: #d9dee7;
      --accent: hsl(187, 74%, 32%);
      --accent-2: hsl(270, 70%, 45%);
      --paper: #ffffff;
    }
    * { box-sizing: border-box; }
    html {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    body {
      margin: 0;
      background: var(--paper);
      color: var(--ink);
      font-family: 'DM Sans', sans-serif;
      font-size: 11px;
      line-height: 1.58;
    }
    .page {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .header {
      padding-bottom: 10px;
      border-bottom: 1px solid var(--line);
    }
    .name {
      font-family: 'Space Grotesk', sans-serif;
      font-size: 24px;
      font-weight: 700;
      letter-spacing: -0.02em;
      margin-bottom: 4px;
    }
    .header-gradient {
      height: 2px;
      width: 100%;
      background: linear-gradient(to right, var(--accent), var(--accent-2));
      border-radius: 999px;
      margin-bottom: 8px;
    }
    .meta {
      color: var(--muted);
      font-size: 9.8px;
      display: flex;
      flex-wrap: wrap;
      gap: 4px 14px;
    }
    .meta span {
      overflow-wrap: anywhere;
    }
    .topline {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: flex-start;
    }
    .date-block {
      min-width: 120px;
      text-align: right;
      color: var(--muted);
      font-size: 10px;
      padding-top: 4px;
    }
    .recipient {
      display: flex;
      flex-direction: column;
      gap: 1px;
      font-size: 10.5px;
      color: var(--muted);
    }
    .recipient strong {
      color: var(--ink);
      font-family: 'Space Grotesk', sans-serif;
      font-size: 12px;
    }
    .title-block h1 {
      margin: 0;
      font-family: 'Space Grotesk', sans-serif;
      font-size: 15px;
      line-height: 1.2;
      letter-spacing: -0.01em;
    }
    .subtitle {
      color: var(--muted);
      font-size: 10px;
    }
    .letter {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .letter-intro {
      color: var(--muted);
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    p {
      margin: 0 0 8px;
      color: #2b3140;
    }
    p:last-child { margin-bottom: 0; }
    .signature {
      padding-top: 6px;
      color: #2b3140;
    }
    .signature-name {
      margin-top: 10px;
      font-family: 'Space Grotesk', sans-serif;
      font-weight: 700;
      color: var(--ink);
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div class="name">${escapeHtml(headerName)}</div>
      <div class="header-gradient"></div>
      <div class="meta">${contacts.map(item => `<span>${escapeHtml(item)}</span>`).join('')}</div>
    </div>
    <div class="topline">
      <div class="recipient">
        <strong>Application for ${escapeHtml(role || 'Role')}</strong>
        <span>${escapeHtml(company || 'Company')}</span>
      </div>
      <div class="date-block">
        <div>${escapeHtml(today)}</div>
        <div>${escapeHtml(cleanString(candidate.location || location.city || location.country || ''))}</div>
      </div>
    </div>
    <div class="title-block">
      <h1>Cover Letter</h1>
      <div class="subtitle">${escapeHtml(company || 'Company')} • ${escapeHtml(role || 'Role')}</div>
    </div>
    <div class="letter">
      <div class="letter-intro">Tailored letter</div>
      ${textToParagraphsHtml(letterBody)}
      ${signatureHtml}
    </div>
  </div>
</body>
</html>`;
}

// ─── Template Engine (shared by preview + PDF generation) ─────────────────────

function tplGetValue(obj, path, globalData) {
  if (path === 'this') return obj;
  if (path.startsWith('this.')) {
    const key = path.slice(5).trim();
    return obj && typeof obj === 'object' ? obj[key] : undefined;
  }
  return path.split('.').reduce((prev, curr) => prev ? prev[curr] : undefined, globalData);
}

function tplFindClosingTag(content, openTag, closeTag, startIndex) {
  let depth = 1;
  let pos = startIndex;
  while (depth > 0 && pos < content.length) {
    const nextOpen = content.indexOf(openTag, pos);
    const nextClose = content.indexOf(closeTag, pos);
    if (nextClose === -1) return -1;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      pos = nextOpen + openTag.length;
    } else {
      depth--;
      pos = nextClose + closeTag.length;
      if (depth === 0) return nextClose;
    }
  }
  return -1;
}

function tplRender(template, context, globalData) {
  let res = template;

  // 1. Process EACH blocks
  let pos = 0;
  while ((pos = res.indexOf('{{#each')) !== -1) {
    const endOpen = res.indexOf('}}', pos);
    const path = res.slice(pos + 7, endOpen).trim();
    const closePos = tplFindClosingTag(res, '{{#each', '{{/each}}', endOpen + 2);
    if (closePos === -1) break;
    const inner = res.slice(endOpen + 2, closePos);
    const list = tplGetValue(context, path, globalData);
    const rendered = Array.isArray(list) ? list.map(item => tplRender(inner, item, globalData)).join('') : '';
    res = res.slice(0, pos) + rendered + res.slice(closePos + 9);
  }

  // 2. Process IF blocks (with nesting-aware {{else}} support)
  while (true) {
    let pos = res.indexOf('{{#if');
    if (pos === -1) break;
    const endOpen = res.indexOf('}}', pos);
    const path = res.slice(pos + 5, endOpen).trim();
    const closePos = tplFindClosingTag(res, '{{#if', '{{/if}}', endOpen + 2);
    if (closePos === -1) {
      res = res.slice(0, pos) + '<!-- BROKEN IF: ' + path + ' -->' + res.slice(endOpen + 2);
      continue;
    }
    let inner = res.slice(endOpen + 2, closePos);
    const val = tplGetValue(context, path, globalData);
    const truthy = val && (!Array.isArray(val) || val.length > 0);
    
    let elseIdx = -1;
    let depth = 0;
    for (let i = 0; i < inner.length - 8; i++) {
      if (inner.slice(i, i + 5) === '{{#if') depth++;
      if (inner.slice(i, i + 7) === '{{/if}}') depth--;
      if (depth === 0 && inner.slice(i, i + 8) === '{{else}}') {
        elseIdx = i;
        break;
      }
    }

    let rendered;
    if (elseIdx !== -1) {
      rendered = truthy ? tplRender(inner.slice(0, elseIdx), context, globalData) : tplRender(inner.slice(elseIdx + 8), context, globalData);
    } else {
      rendered = truthy ? tplRender(inner, context, globalData) : '';
    }
    res = res.slice(0, pos) + rendered + res.slice(closePos + 7);
  }

  // 3. Variables
  res = res.replace(/\{\{([^#\/][^}]*)\}\}/g, (match, path) => {
    const val = tplGetValue(context, path.trim(), globalData);
    return val !== undefined ? val : '';
  });

  return res;
}

/**
 * Render premium-cv.html with template defaults merged with config/profile.yml.
 * @param {string} profileKey - e.g. 'ai_builder'
 * @param {object} tailoredData - Overrides passed from LLM (e.g. customized summary/experience)
 * @returns {Promise<string>} rendered HTML
 */
async function renderPremiumCV(profileKey = 'complete_paris', tailoredData = {}) {
  const templateContent = await readFile(join(ROOT, 'templates/premium-cv.html'), 'utf-8');
  const data = await loadCvTemplateData(ROOT, profileKey, tailoredData);

  let html = tplRender(templateContent, data, data);

  // Inject preview download bar
  const candidateName = (data.shared.contact.name || 'Candidate').replace(/\s+/g, '_');
  const pdfFilename = `${candidateName}_CV_${profileKey}.pdf`;
  const downloadBar = `
<style>
  .preview-bar {
    position: fixed; top: 0; left: 0; right: 0; z-index: 9999;
    background: #0f172a; padding: 10px 24px;
    display: flex; align-items: center; justify-content: space-between;
    font-family: 'Space Grotesk', sans-serif; font-size: 12px; color: #94a3b8;
    box-shadow: 0 2px 12px rgba(0,0,0,0.3);
  }
  .preview-bar span { font-weight: 600; color: #e2e8f0; letter-spacing: 0.02em; }
  .preview-bar a {
    background: #2d31fa; color: #fff; padding: 7px 18px; border-radius: 8px;
    text-decoration: none; font-weight: 700; font-size: 12px; letter-spacing: 0.02em;
    display: flex; align-items: center; gap: 8px;
  }
  .preview-bar a:hover { background: #1e21b5; }
  body { padding-top: 44px !important; }
  @media print { .preview-bar { display: none !important; } body { padding-top: 0 !important; } }
</style>
<div class="preview-bar">
  <span>Preview — ${pdfFilename}</span>
  <a href="#" onclick="(window.top || window).open('/output/${pdfFilename}', '_blank'); return false;">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
    Download PDF
  </a>
</div>`;
  html = html.replace('<body>', `<body>\n${downloadBar}`);
  return html;
}

async function renderBaseCV(profileKey = 'complete_paris', userId) {
  const [template, cvSource, data] = await Promise.all([
    readFile(join(ROOT, 'templates/cv-template.html'), 'utf-8'),
    getCvMarkdown(userId),
    loadCvTemplateData(ROOT, profileKey)
  ]);

  const email = cvSource.match(/Email:\*\*\s*([^\s\n]+)/)?.[1] || data.shared.contact.email;
  const linkedin = cvSource.match(/LinkedIn:\*\*\s*\[([^\]]+)\]\(([^)]+)\)/);
  
  // Base template uses flat {{VAR}} syntax
  let html = template
    .replace(/{{LANG}}/g, 'en')
    .replace(/{{PAGE_WIDTH}}/g, '210mm')
    .replace(/{{NAME}}/g, data.shared.contact.name || '')
    .replace(/{{EMAIL}}/g, email)
    .replace(/{{LINKEDIN_URL}}/g, linkedin?.[2] || data.shared.contact.linkedin_url || '')
    .replace(/{{LINKEDIN_DISPLAY}}/g, linkedin?.[1] || data.shared.contact.linkedin_display || '')
    .replace(/{{PORTFOLIO_URL}}/g, data.shared.contact.portfolio || '')
    .replace(/{{PORTFOLIO_DISPLAY}}/g, data.shared.contact.portfolio_display || 'Portfolio')
    .replace(/{{LOCATION}}/g, data.shared.contact.location || '')
    .replace(/{{SECTION_SUMMARY}}/g, 'Professional Summary')
    .replace(/{{SUMMARY_TEXT}}/g, data.profile.summary || '')
    .replace(/{{SECTION_COMPETENCIES}}/g, 'Core Competencies')
    .replace(/{{COMPETENCIES}}/g, (data.profile.highlights || []).map(h => `<span class="competency-tag">${h}</span>`).join(''))
    .replace(/{{SECTION_EXPERIENCE}}/g, 'Work Experience')
    .replace(/{{EXPERIENCE}}/g, (data.shared.experience || []).map(exp => `
      <div class="job">
        <div class="job-header">
          <span class="job-company">${exp.company}</span>
          <span class="job-period">${exp.period}</span>
        </div>
        <div class="job-role">${exp.role}</div>
        <ul>
          ${(exp.bullets || []).map(b => `<li>${b}</li>`).join('')}
        </ul>
      </div>
    `).join(''))
    .replace(/{{SECTION_PROJECTS}}/g, 'Projects')
    .replace(/{{PROJECTS}}/g, (data.profile.projects || []).map(p => `
      <div class="project">
        <div class="project-title">${p.name} <span class="project-badge">${p.tag || ''}</span></div>
        <div class="project-desc">${p.desc}</div>
      </div>
    `).join(''))
    .replace(/{{SECTION_EDUCATION}}/g, 'Education')
    .replace(/{{EDUCATION}}/g, (data.shared.education || []).map(e => `
      <div class="edu-item">
        <div class="edu-header">
          <span class="edu-title">${e.degree}</span>
          <span class="edu-org">${e.school}</span>
          <span class="edu-year">${e.year}</span>
        </div>
      </div>
    `).join(''))
    .replace(/{{SECTION_SKILLS}}/g, 'Skills')
    .replace(/{{SKILLS}}/g, ''); // Simplified for now

  // Fix relative paths for fonts since we're serving from /api/template-preview
  html = html.replace(/\.\/fonts\//g, '/fonts/');

  return html;
}

// ─── JSON helpers ─────────────────────────────────────────────────────────────

function json(res, data, status = 200) {
  res.setHeader('Content-Type', 'application/json');
  res.writeHead(status);
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

// ─── Public AI usage snapshot ─────────────────────────────────────────────────

const AI_USAGE_CACHE_TTL_MS = 10 * 60 * 1000;
let aiUsageCache = null;

function getTodayRange() {
  const end = new Date();
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);

  return {
    start,
    end,
    startUnix: Math.floor(start.getTime() / 1000),
    endUnix: Math.floor(end.getTime() / 1000),
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    window: '24h',
  };
}

function emptyProvider(id, name, status, note = '') {
  return {
    id,
    name,
    status,
    note,
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    requests: 0,
    cost_usd: null,
    models: [],
  };
}

function addNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function flattenUsageResults(payload) {
  const buckets = Array.isArray(payload?.data) ? payload.data : [];
  return buckets.flatMap(bucket => Array.isArray(bucket?.results) ? bucket.results : []);
}

function estimateTokensFromUsd(costUsd, usdPerMillionTokens = 1.5) {
  const cost = addNumber(costUsd);
  const rate = addNumber(usdPerMillionTokens) || 1.5;
  return cost > 0 ? Math.round((cost / rate) * 1_000_000) : 0;
}

function applyLocalUsage(provider, localUsage = {}, noteWhenPresent = '') {
  if (!localUsage.total_tokens) return provider;
  provider.input_tokens += localUsage.input_tokens;
  provider.output_tokens += localUsage.output_tokens;
  provider.total_tokens += localUsage.total_tokens;
  provider.requests += localUsage.requests;
  provider.cost_usd = typeof localUsage.cost_usd === 'number' ? (provider.cost_usd || 0) + localUsage.cost_usd : provider.cost_usd;
  provider.models = [...new Set([...(provider.models || []), ...(localUsage.models || [])])].slice(0, 8);
  provider.status = localUsage.estimated ? 'estimated' : 'tracked';
  if (noteWhenPresent) provider.note = noteWhenPresent;
  return provider;
}

async function getOpenAiCosts(range) {
  const key = process.env.OPENAI_ADMIN_KEY || process.env.OPENAI_MANAGEMENT_KEY || process.env.OPENAI_ORG_ADMIN_KEY || process.env.OPENAI_API_ADMIN_KEY || '';
  if (!key) return null;

  const params = new URLSearchParams({
    start_time: String(range.startUnix),
    end_time: String(range.endUnix),
    bucket_width: '1d',
    limit: '1',
  });

  const data = await fetchJsonWithTimeout(`https://api.openai.com/v1/organization/costs?${params}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  return flattenUsageResults(data).reduce((sum, row) => sum + addNumber(row.amount?.value), 0);
}

async function getOpenAiUsage(range) {
  const key = process.env.OPENAI_ADMIN_KEY || process.env.OPENAI_MANAGEMENT_KEY || process.env.OPENAI_ORG_ADMIN_KEY || process.env.OPENAI_API_ADMIN_KEY || '';
  const provider = emptyProvider('openai', 'OpenAI', key ? 'live' : 'missing_key', key ? '' : 'Set OPENAI_ADMIN_KEY');
  if (!key) return provider;

  const params = new URLSearchParams({
    start_time: String(range.startUnix),
    end_time: String(range.endUnix),
    bucket_width: '1d',
    limit: '1',
  });
  params.append('group_by[]', 'model');

  try {
    const data = await fetchJsonWithTimeout(`https://api.openai.com/v1/organization/usage/completions?${params}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    for (const row of flattenUsageResults(data)) {
      const input = addNumber(row.input_tokens);
      const output = addNumber(row.output_tokens);
      provider.input_tokens += input;
      provider.output_tokens += output;
      provider.total_tokens += input + output;
      provider.requests += addNumber(row.num_model_requests);
      if (row.model && !provider.models.includes(row.model)) provider.models.push(row.model);
    }
    try {
      provider.cost_usd = await getOpenAiCosts(range);
    } catch (costErr) {
      provider.cost_note = costErr.message;
    }
    provider.status = 'live';
  } catch (err) {
    provider.status = 'error';
    provider.note = err.message;
  }
  return provider;
}

function sumOpenRouterKeyUsage(keys = []) {
  return keys.reduce((acc, key) => {
    acc.usage_daily += addNumber(key.usage_daily) + addNumber(key.byok_usage_daily);
    acc.usage_weekly += addNumber(key.usage_weekly) + addNumber(key.byok_usage_weekly);
    acc.usage_monthly += addNumber(key.usage_monthly) + addNumber(key.byok_usage_monthly);
    acc.usage_all_time += addNumber(key.usage) + addNumber(key.byok_usage);
    acc.key_count += 1;
    return acc;
  }, { usage_daily: 0, usage_weekly: 0, usage_monthly: 0, usage_all_time: 0, key_count: 0 });
}

async function getOpenRouterManagedUsage(managementKey) {
  const keys = [];
  for (let offset = 0; offset < 500; offset += 100) {
    const params = new URLSearchParams({ offset: String(offset) });
    const data = await fetchJsonWithTimeout(`https://openrouter.ai/api/v1/keys?${params}`, {
      headers: { Authorization: `Bearer ${managementKey}` },
    });
    const page = Array.isArray(data?.data) ? data.data : [];
    keys.push(...page);
    if (page.length < 100) break;
  }
  return sumOpenRouterKeyUsage(keys);
}

async function getOpenRouterUsage(range, localEvents = []) {
  const managementKey = process.env.OPENROUTER_MANAGEMENT_KEY || process.env.OPENROUTER_MANAGEMENT_API_KEY || process.env.OPENROUTER_ADMIN_KEY || '';
  const key = process.env.OPENROUTER_ADMIN_KEY || process.env.OPENROUTER_API_KEY || '';
  const localUsage = aggregateUsageEvents(localEvents, 'openrouter');
  const provider = emptyProvider(
    'openrouter',
    'OpenRouter',
    managementKey || key ? 'limited' : 'missing_key',
    managementKey
      ? 'Account-level spend across OpenRouter API keys via Management key. Tokens are estimated from spend.'
      : (key ? 'Current API key spend only. Set OPENROUTER_MANAGEMENT_KEY to sum every OpenRouter key.' : 'Set OPENROUTER_API_KEY or OPENROUTER_MANAGEMENT_KEY')
  );
  if (!managementKey && !key) return applyLocalUsage(provider, localUsage, 'Tracked from local app calls.');

  try {
    if (managementKey) {
      const managed = await getOpenRouterManagedUsage(managementKey);
      provider.account_scope = 'all_keys';
      provider.key_count = managed.key_count;
      provider.cost_usd = managed.usage_daily;
      provider.usage_daily_usd = managed.usage_daily;
      provider.usage_weekly_usd = managed.usage_weekly;
      provider.usage_monthly_usd = managed.usage_monthly;
    } else {
      const data = await fetchJsonWithTimeout('https://openrouter.ai/api/v1/key', {
        headers: { Authorization: `Bearer ${key}` },
      });
      provider.account_scope = 'current_key';
      provider.credit_remaining = data?.data?.limit_remaining ?? null;
      provider.credit_limit = data?.data?.limit ?? null;
      provider.cost_usd = addNumber(data?.data?.usage_daily) + addNumber(data?.data?.byok_usage_daily);
      provider.usage_daily_usd = provider.cost_usd;
      provider.usage_weekly_usd = addNumber(data?.data?.usage_weekly) + addNumber(data?.data?.byok_usage_weekly);
      provider.usage_monthly_usd = addNumber(data?.data?.usage_monthly) + addNumber(data?.data?.byok_usage_monthly);
    }
    if (!localUsage.total_tokens && provider.cost_usd > 0) {
      provider.total_tokens = estimateTokensFromUsd(provider.cost_usd);
      provider.status = 'estimated';
      provider.note = managementKey
        ? 'Spend-based estimate across OpenRouter account keys. Exact account-level tokens are not exposed by the key list API.'
        : 'Spend-based estimate for this OpenRouter key only. Use OPENROUTER_MANAGEMENT_KEY for all account keys.';
    } else {
      provider.status = 'limited';
    }
  } catch (err) {
    provider.status = 'error';
    provider.note = err.message;
  }
  return applyLocalUsage(provider, localUsage, localUsage.estimated ? 'Estimated from local app calls.' : 'Tracked from OpenRouter generation stats for local app calls.');
}

async function getAiUsageToday({ force = false } = {}) {
  const now = Date.now();
  if (!force && aiUsageCache && now - aiUsageCache.cachedAt < AI_USAGE_CACHE_TTL_MS) return aiUsageCache.data;

  const range = getTodayRange();
  const localEvents = await readAiUsageEvents({ start: range.startIso, end: range.endIso });
  const providers = await Promise.all([
    getOpenAiUsage(range),
    getOpenRouterUsage(range, localEvents),
  ]);

  const totals = providers.reduce((acc, provider) => {
    acc.input_tokens += provider.input_tokens;
    acc.output_tokens += provider.output_tokens;
    acc.total_tokens += provider.total_tokens;
    acc.requests += provider.requests;
    if (typeof provider.cost_usd === 'number') acc.cost_usd += provider.cost_usd;
    return acc;
  }, { input_tokens: 0, output_tokens: 0, total_tokens: 0, requests: 0, cost_usd: 0 });

  const data = {
    ok: true,
    generated_at: new Date().toISOString(),
    range: { start: range.startIso, end: range.endIso, window: range.window },
    totals,
    providers,
  };
  aiUsageCache = { cachedAt: now, data };
  return data;
}

// ─── Auth helper ─────────────────────────────────────────────────────────────

async function getRequestUser(req) {
  if (!useSupabase || !supabase) return null;
  // Header (fetch/XHR)
  const auth = req.headers['authorization'] || '';
  let token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  // Query param fallback pour EventSource (SSE) qui ne supporte pas les headers
  if (!token) {
    const urlObj = new URL(req.url, `http://localhost`);
    token = urlObj.searchParams.get('_token') || '';
  }
  if (!token) return null;
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  return user;
}

// ─── Server ───────────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://localhost:${PORT}`);
  const path = urlObj.pathname;
  const method = req.method;
  const APP_ROUTES = new Set([
    '/index.html',
    '/dashboard',
    '/applications',
    '/pipeline',
    '/reports',
    '/portals',
    '/cvs',
    '/profile',
  ]);
  const LANDING_ROUTES = new Set(['/', '/landing', '/landing.html']);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');

  if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  try {
    // Public landing page (homepage)
    if (LANDING_ROUTES.has(path)) {
      let html = await readFile(join(__dirname, 'landing.html'), 'utf-8');
      html = html.replace('__SUPABASE_URL__', SUPABASE_URL_VALUE)
                 .replace('__SUPABASE_ANON_KEY__', SUPABASE_ANON_VALUE);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      sendText(req, res, html);
      return;
    }

    // Authenticated SPA (dashboard, applications, etc.)
    if (APP_ROUTES.has(path)) {
      let html = await readFile(join(__dirname, 'index.html'), 'utf-8');
      html = html.replace('__SUPABASE_URL__', SUPABASE_URL_VALUE)
                 .replace('__SUPABASE_ANON_KEY__', SUPABASE_ANON_VALUE);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      sendText(req, res, html);
      return;
    }

    if (path === '/login' || path === '/login.html') {
      let html = await readFile(join(__dirname, 'login.html'), 'utf-8');
      html = html.replace('__SUPABASE_URL__', SUPABASE_URL_VALUE)
                 .replace('__SUPABASE_ANON_KEY__', SUPABASE_ANON_VALUE);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      sendText(req, res, html);
      return;
    }

    if (path === '/onboarding' || path === '/onboarding.html') {
      let html = await readFile(join(__dirname, 'onboarding.html'), 'utf-8');
      html = html.replace('__SUPABASE_URL__', SUPABASE_URL_VALUE)
                 .replace('__SUPABASE_ANON_KEY__', SUPABASE_ANON_VALUE);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      sendText(req, res, html);
      return;
    }

    if (path === '/portfolio' || path === '/portfolio.html' || path.startsWith('/portfolio/layout-')) {
      const html = await readFile(join(__dirname, 'portfolio.html'), 'utf-8');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      sendText(req, res, html);
      return;
    }

    if (path.startsWith('/interfaces/') && path.endsWith('.html')) {
      try {
        const safeName = path.slice('/interfaces/'.length).replace(/[^a-z0-9\-_.]/gi, '');
        const html = await readFile(join(__dirname, 'interfaces', safeName), 'utf-8');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');
        sendText(req, res, html);
      } catch {
        res.writeHead(404); res.end('Not found');
      }
      return;
    }

    if (path === '/api/ai-usage/today' && method === 'GET') {
      const force = urlObj.searchParams.get('refresh') === '1';
      return json(res, await getAiUsageToday({ force }));
    }

    // ── Auth guard (toutes les routes /api/* sauf /api/hrhv) ─────────────────
    // Read-only GET routes are accessible without auth (view-only mode)
    const VIEW_ONLY_PATHS = ['/api/applications', '/api/pipeline', '/api/reports', '/api/cvs', '/api/portals', '/api/queries', '/api/profile', '/api/scan-state', '/api/scan-sources'];
    const AUTH_REQUIRED_PROFILE_PATHS = new Set(['/api/profile/status', '/api/profile/cv-parse']);
    const isViewOnlyGet = method === 'GET'
      && !AUTH_REQUIRED_PROFILE_PATHS.has(path)
      && VIEW_ONLY_PATHS.some(p => path === p || path.startsWith(p + '/'));

    if (path.startsWith('/api/') && path !== '/api/hrhv' && path !== '/api/template-preview' && !path.startsWith('/api/cvs/') && useSupabase && !isViewOnlyGet) {
      const user = await getRequestUser(req);
      if (!user) {
        json(res, { error: 'Unauthorized' }, 401);
        return;
      }
      req.userId = user.id;
      req.userEmail = user.email;
    }

    // ── /api/me ───────────────────────────────────────────────────────────────
    if (path === '/api/me' && method === 'GET') {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email, is_admin, location, linkedin, target_roles, narrative, compensation')
        .eq('id', req.userId)
        .single();
      if (error) return json(res, { error: error.message }, 500);
      return json(res, data);
    }

    if (path.startsWith('/covers/') && path.match(/\.(jpe?g|png|svg|webp)$/i)) {
      try {
        const coverPath = safeJoin(join(__dirname, 'covers'), decodeURIComponent(path).slice('/covers/'.length));
        if (!coverPath) { res.writeHead(403); res.end('Forbidden'); return; }
        const file = await readFile(coverPath);
        const ext = path.split('.').pop().toLowerCase();
        const types = {
          png: 'image/png',
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          svg: 'image/svg+xml',
          webp: 'image/webp'
        };
        res.setHeader('Content-Type', types[ext] || 'application/octet-stream');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.writeHead(200);
        res.end(file);
        return;
      } catch { /* fall through to 404 */ }
    }

    if (path.startsWith('/assets/')) {
      try {
        const assetPath = decodeURIComponent(path.slice('/assets/'.length));
        const assetFile = safeJoin(join(__dirname, 'assets'), assetPath);
        if (!assetFile) { res.writeHead(403); res.end('Forbidden'); return; }
        const file = await readFile(assetFile);
        const ext = assetPath.split('.').pop().toLowerCase();
        const types = {
          png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
          svg: 'image/svg+xml', webp: 'image/webp',
          css: 'text/css; charset=utf-8',
          woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf',
          mp4: 'video/mp4', webm: 'video/webm'
        };
        res.setHeader('Content-Type', types[ext] || 'application/octet-stream');
        res.setHeader('Cache-Control', ext === 'css' ? 'no-cache' : 'public, max-age=31536000, immutable');
        res.writeHead(200);
        res.end(file);
        return;
      } catch { /* fall through to 404 */ }
    }

    // API routes
    if (path === '/api/applications' && method === 'GET') {
      return json(res, await getApplications(req.userId));
    }

    if (path.startsWith('/api/applications/') && method === 'PATCH') {
      const num = decodeURIComponent(path.slice('/api/applications/'.length));
      const { status: rawStatus } = await readBody(req);
      if (!rawStatus) return json(res, { error: 'status is required' }, 400);
      // AGENTS.md: "All statuses MUST be canonical (see templates/states.yml)".
      // This route used to write whatever string it was handed, so a typo or a
      // stale client could put a non-canonical value straight into the tracker
      // (and into Supabase) with nothing to catch it. resolveCanonicalState is
      // the strict resolver — it maps aliases/case to the canonical label and
      // returns null on anything it doesn't recognize.
      const status = resolveCanonicalState(rawStatus, canonicalApplicationStates());
      if (!status) {
        return json(res, {
          error: `"${rawStatus}" is not a canonical state`,
          valid: canonicalApplicationStates().map(s => s.label),
        }, 400);
      }
      if (useSupabase) {
        const { error } = await supabase
          .from('applications')
          .update({ status })
          .eq('num', Number(num));
        if (error) return json(res, { error: error.message }, 500);

        await writeMarkdownApplicationStatus(num, status).catch(() => {});
        return json(res, { ok: true });
      }
      const updated = await writeMarkdownApplicationStatus(num, status).catch(() => false);
      if (!updated) return json(res, { error: 'Application not found' }, 404);
      return json(res, { ok: true });
    }

    if (path.startsWith('/api/applications/') && method === 'DELETE') {
      const num = decodeURIComponent(path.slice('/api/applications/'.length));
      const today = new Date().toISOString().slice(0, 10);

      // Soft-delete: keep the tracker row as Discarded and exclude it from future scans.
      if (useSupabase) {
        const { data: existing, error: fetchError } = await supabase
          .from('applications')
          .select('*')
          .eq('num', Number(num))
          .maybeSingle();
        if (fetchError) return json(res, { error: fetchError.message }, 500);
        if (!existing) return json(res, { error: 'Application not found' }, 404);
        const blockReason = deleteApplicationBlockReason(existing.status);
        if (blockReason) return json(res, { error: blockReason }, 409);

        const company = String(existing.company ?? existing.Company ?? '').trim();
        const role = String(existing.role ?? existing.Role ?? '').trim();
        const jobUrl = await findPostingUrlFromReportLink(existing.report ?? '');

        const { error } = await supabase
          .from('applications')
          .update({ status: 'Discarded' })
          .eq('num', Number(num));
        if (error) return json(res, { error: error.message }, 500);

        await writeMarkdownApplicationStatus(num, 'Discarded').catch(() => {});
        await recordManualApplicationDelete({ company, role, jobUrl, date: today });
        return json(res, { ok: true, status: 'Discarded' });
      }

      const appFile = join(ROOT, 'data/applications.md');
      const raw = await readFile(appFile, 'utf-8');
      const targetLine = raw.split('\n').find(line => getMarkdownTableRowNumber(line) === String(num));
      if (!targetLine) return json(res, { error: 'Application not found' }, 404);
      const cells = targetLine.split('|').map(c => c.trim());
      const company = cells[3] || '';
      const role = cells[4] || '';
      const blockReason = deleteApplicationBlockReason(cells[6] || '');
      if (blockReason) return json(res, { error: blockReason }, 409);

      const updated = await writeMarkdownApplicationStatus(num, 'Discarded');
      if (!updated) return json(res, { error: 'Application not found' }, 404);

      const jobUrl = await findPostingUrlFromReportLink(targetLine);
      await recordManualApplicationDelete({ company, role, jobUrl, date: today });
      return json(res, { ok: true, status: 'Discarded' });
    }

    if (path === '/api/applications/bulk-discard-stale' && method === 'POST') {
      const body = await readBody(req);
      const nums = [...new Set((Array.isArray(body?.nums) ? body.nums : [])
        .map(value => Number(value)).filter(value => Number.isInteger(value) && value > 0))];
      if (!nums.length) return json(res, { error: 'No application numbers provided' }, 400);
      const today = new Date().toISOString().slice(0, 10);
      let rows = [];

      if (useSupabase) {
        let q = supabase.from('applications').select('*').in('num', nums);
        if (req.userId) q = q.eq('user_id', req.userId);
        const { data, error: fetchError } = await q;
        if (fetchError) return json(res, { error: fetchError.message }, 500);
        rows = data || [];
        if (rows.length) {
          let update = supabase.from('applications').update({ status: 'Discarded' }).in('num', rows.map(row => row.num));
          if (req.userId) update = update.eq('user_id', req.userId);
          const { error } = await update;
          if (error) return json(res, { error: `Supabase application sync failed: ${error.message}` }, 500);
        }
      } else {
        const raw = await readFile(join(WRITE_ROOT, 'data/applications.md'), 'utf-8');
        const wanted = new Set(nums.map(String));
        const changed = setApplicationStatusesInMarkdown(raw, wanted, 'Discarded');
        if (changed.updated) await writeFile(join(WRITE_ROOT, 'data/applications.md'), changed.content, 'utf-8');
        rows = nums.map(num => ({ num }));
      }

      for (const row of rows) {
        const company = String(row.company ?? row.Company ?? '').trim();
        const role = String(row.role ?? row.Role ?? '').trim();
        const jobUrl = await findPostingUrlFromReportLink(row.report ?? row.Report ?? '');
        await recordManualApplicationDelete({ company, role, jobUrl, date: today });
        if (!useSupabase) continue;
        await writeMarkdownApplicationStatus(row.num, 'Discarded').catch(() => {});
      }
      return json(res, { ok: true, updated: rows.length, status: 'Discarded' });
    }

    if (path === '/api/pipeline') {
      if (method === 'GET') return json(res, await getPipeline(req.userId));
      if (method === 'POST') {
        const { url, note } = await readBody(req);
        if (!url?.startsWith('http')) return json(res, { error: 'Invalid URL' }, 400);
        await addToPipeline(url, note || '', req.userId);
        return json(res, { ok: true });
      }
      if (method === 'DELETE') {
        const { url, urls } = await readBody(req);
        const targets = Array.isArray(urls) ? urls : [url];
        const validUrls = targets
          .map(value => String(value || '').trim())
          .filter(value => value.startsWith('http'));
        if (!validUrls.length) return json(res, { error: 'Invalid URL' }, 400);
        await removeManyFromPipeline(validUrls, req.userId);
        return json(res, { ok: true });
      }
    }

    if (path === '/api/reports' && method === 'GET') {
      return json(res, await getReports(req.userId));
    }

    if (path === '/api/cvs' && method === 'GET') {
      return json(res, await getCVs());
    }
    if (path.startsWith('/api/cvs/') && method === 'GET') {
      const filename = decodeURIComponent(path.slice('/api/cvs/'.length));
      if (filename.includes('/') || filename.includes('..')) return json(res, { error: 'Invalid filename' }, 400);
      try {
        const fileContent = await readFile(join(ROOT, 'output', filename));
        res.setHeader('Content-Type', 'application/pdf');
        res.writeHead(200);
        res.end(fileContent);
        return;
      } catch (e) {
        return json(res, { error: 'File not found' }, 404);
      }
    }

    if (path === '/api/template-preview' && method === 'GET') {
      try {
        const urlParams = new URL('http://localhost' + req.url).searchParams;
        const profileKey = urlParams.get('profile') || 'complete_paris';
        const location = cleanString(urlParams.get('location') || '');
        const tailoredData = location
          ? { shared: { contact: { location } } }
          : {};
        const renderedContent = await renderPremiumCV(profileKey, tailoredData);

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.writeHead(200);
        res.end(renderedContent);
        return;
      } catch (e) {
        console.error(e);
        return json(res, { error: 'Template not found' }, 404);
      }
    }

    // Scan State
    if (path === '/api/scan-state') {
      if (method === 'GET') return json(res, await getScanState());
    }

    // Scan Sources (for selector modal)
    if (path === '/api/scan-sources' && method === 'GET') {
      return json(res, await getScanSources());
    }

    // Scan Selection
    if (path === '/api/scan-selection') {
      if (method === 'GET')  return json(res, await getScanSelection());
      if (method === 'POST') {
        const sel = await readBody(req);
        await saveScanSelection(sel);
        return json(res, { ok: true });
      }
    }

    // Portals CRUD
    if (path === '/api/portals') {
      if (method === 'GET')  return json(res, await getPortals());
      if (method === 'POST') {
        const body = await readBody(req);
        if (!body.name?.trim()) return json(res, { error: 'Name is required' }, 400);
        if (!body.careers_url?.startsWith('http')) return json(res, { error: 'Invalid careers_url' }, 400);
        await addPortal(body);
        return json(res, { ok: true });
      }
    }

    if (path.startsWith('/api/portals/')) {
      const name = decodeURIComponent(path.slice('/api/portals/'.length));
      if (method === 'PUT') {
        const body = await readBody(req);
        if (!body.name?.trim()) return json(res, { error: 'Name is required' }, 400);
        if (!body.careers_url?.startsWith('http')) return json(res, { error: 'Invalid careers_url' }, 400);
        await updatePortal(name, body);
        return json(res, { ok: true });
      }
      if (method === 'DELETE') {
        await deletePortal(name);
        return json(res, { ok: true });
      }
      if (method === 'PATCH') {
        const { enabled } = await readBody(req);
        await togglePortal(name, Boolean(enabled));
        return json(res, { ok: true });
      }
    }

    // Queries CRUD (search_queries + eu_job_boards)
    if (path === '/api/queries') {
      if (method === 'GET')  return json(res, await getQueries());
      if (method === 'POST') {
        const body = await readBody(req);
        if (!body.name?.trim())  return json(res, { error: 'Name is required' }, 400);
        if (!body.query?.trim()) return json(res, { error: 'Query is required' }, 400);
        await addQuery(body);
        return json(res, { ok: true });
      }
    }

    if (path.startsWith('/api/queries/')) {
      const name = decodeURIComponent(path.slice('/api/queries/'.length));
      if (method === 'PUT') {
        const body = await readBody(req);
        if (!body.name?.trim())  return json(res, { error: 'Name is required' }, 400);
        if (!body.query?.trim()) return json(res, { error: 'Query is required' }, 400);
        await updateQuery(name, body);
        return json(res, { ok: true });
      }
      if (method === 'DELETE') {
        await deleteQuery(name);
        return json(res, { ok: true });
      }
      if (method === 'PATCH') {
        const { enabled } = await readBody(req);
        await toggleQuery(name, Boolean(enabled));
        return json(res, { ok: true });
      }
    }

    if (path === '/api/profile') {
      if (method === 'GET') return json(res, await getProfile(req.userId));
      if (method === 'PUT') {
        const body = await readBody(req);
        await saveProfileBundle(body, req.userId);
        return json(res, { ok: true });
      }
    }

    if (path === '/api/profile/context') {
      if (method === 'GET') return json(res, { markdown: await getProfileContext(req.userId) });
      if (method === 'PUT') {
        const body = await readBody(req);
        await saveProfileContext(body?.markdown ?? '', req.userId);
        return json(res, { ok: true });
      }
    }

    if (path === '/api/profile/cv') {
      if (method === 'GET') return json(res, { markdown: await getCvMarkdown(req.userId) });
      if (method === 'PUT') {
        const body = await readBody(req);
        await saveCvMarkdown(body?.markdown ?? '', req.userId);
        return json(res, { ok: true });
      }
    }

    if (path === '/api/profile/status' && method === 'GET') {
      return json(res, await getProfileStatus(req.userId));
    }

    if (path === '/api/profile/cv-parse' && method === 'POST') {
      const body = await readBody(req);
      const markdown = String(body?.markdown ?? '').trim();
      if (!markdown) return json(res, { error: 'markdown is required' }, 400);
      try {
        const parsed = await parseCvForProfile(markdown);
        return json(res, { ok: true, profile: parsed, cv_markdown: markdown });
      } catch (err) {
        return json(res, { error: err.message || 'Parse failed' }, 500);
      }
    }

    if (path.startsWith('/api/run/') && method === 'POST') {
      const script = path.slice('/api/run/'.length);
      const result = await runScript(script);
      return json(res, result, result.ok ? 200 : 500);
    }

    // ── Auto-apply (Playwright headed runner) ────────────────────────────────
    // Older reports have no "F) Application Form Questions" section — generate
    // standard answers on the fly from the report so the runner can still fill
    // free-text questions. Best-effort: returns [] if no OpenRouter key.
    async function generateFallbackAnswers(spec) {
      let reportText = '';
      try { reportText = await readFile(join(ROOT, 'reports', spec.report), 'utf-8'); } catch { return []; }
      const candidateCv = await readFile(join(ROOT, 'cv.md'), 'utf-8').catch(() => '');
      if (!candidateCv.trim()) return [];
      const voice = loadApplicationVoice(ROOT);
      const regionLine = spec.region === 'asia'
        ? 'The candidate is based in Bangkok, Thailand (ICT, UTC+7).'
        : 'The candidate is based in Paris, France (CET/CEST).';
      const prompt = `Here is an evaluation report for a job offer (company: ${spec.company}, role: ${spec.role}):\n\n${reportText.slice(0, 9000).replace(/\s*[—–]\s*/g, ', ')}\n\n${regionLine}\nSalary target: ${spec.identity.salary}. Availability: ${spec.identity.startDate}.\n\nWrite application-form answers for these standard questions, as the candidate (first person), using only the candidate CV and explicit identity facts for personal claims. The report describes the role, not verified candidate history. Omit an answer if the facts are insufficient.\n\n${STYLE_RULES}\n\nCANDIDATE CV (source of personal facts):\n${candidateCv.slice(0, 14000)}\n\nUSER WRITING PREFERENCES:\n${voice}\n\nEach of the 7 answers must be DISTINCT. Questions 1, 2 and 4 are different angles: role scope, the company and its product, overall fit. Never reuse the same sentences across them.\n\nReply with ONLY a JSON array: [{"question": "...", "answer": "..."}] for these questions:\n1. Why are you interested in this role?\n2. Why do you want to work at ${spec.company}?\n3. Tell us about a relevant project or achievement\n4. What makes you a good fit for this position?\n5. Salary expectations\n6. Notice period / availability\n7. Cover letter (a short standalone letter; do not concatenate the other answers)`;
      try {
        const raw = await chat({
          model: MODELS.CLAUDE_HAIKU,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.5,
          max_tokens: 1800,
        });
        const jsonText = raw.match(/\[[\s\S]*\]/)?.[0];
        const parsed = JSON.parse(jsonText || '[]');
        return Array.isArray(parsed)
          ? parsed.filter(a => a?.question && a?.answer).map(a => ({ question: String(a.question), answer: String(a.answer) }))
              .map(a => ({ ...a, answer: polishApplicationAnswer(a.answer) }))
          : [];
      } catch (err) {
        console.warn('[apply] fallback answers generation failed:', err.message);
        return [];
      }
    }

    if (path === '/api/apply/start' && method === 'POST') {
      if (IS_VERCEL) return json(res, { error: 'Auto-apply requires a local server (visible Chrome)' }, 400);
      const body = await readBody(req);
      const report = cleanString(body.report);
      if (!report || report.includes('/') || report.includes('..')) {
        return json(res, { error: 'report filename is required' }, 400);
      }
      try {
        const spec = await buildApplySpec({
          root: ROOT,
          reportFilename: report,
          company: cleanString(body.company),
          role: cleanString(body.role),
          region: cleanString(body.region) || undefined,
          // Auto-submit by default (matches the dashboard checkbox's default
          // state) — only an explicit `false` from the client falls back to
          // the pause-before-submit review flow.
          autoSubmit: body.autoSubmit !== false,
          solveChallenges: body.solveChallenges !== false,
        });
        if (!spec.answers.length) {
          spec.answers = await generateFallbackAnswers(spec);
        }
        const runId = `${Date.now().toString(36)}-${slugify(spec.company || 'offer').slice(0, 30)}`;
        const runDir = join(ROOT, 'scratch/apply-runs', runId);
        await mkdir(runDir, { recursive: true });
        await writeFile(join(runDir, 'spec.json'), JSON.stringify(spec, null, 2), 'utf-8');
        const child = spawn('node', ['apply-runner.mjs', '--run-dir', `scratch/apply-runs/${runId}`], {
          cwd: ROOT,
          detached: true,
          stdio: 'ignore',
        });
        child.unref();
        return json(res, {
          ok: true,
          runId,
          region: spec.region,
          cv: spec.cvPath.split('/').pop(),
          answersCount: spec.answers.length,
          jobUrl: spec.jobUrl,
        });
      } catch (err) {
        return json(res, { error: String(err?.message || err) }, 500);
      }
    }

    if (path.startsWith('/api/apply/runs/')) {
      const parts = path.slice('/api/apply/runs/'.length).split('/');
      const runId = decodeURIComponent(parts[0] || '').replace(/[^a-z0-9_-]/gi, '');
      if (!runId) return json(res, { error: 'runId required' }, 400);
      const runDir = join(ROOT, 'scratch/apply-runs', runId);

      if (method === 'GET' && parts[1] === 'shots' && parts[2]) {
        try {
          const shot = decodeURIComponent(parts[2]).replace(/[^a-z0-9.-]/gi, '');
          const img = await readFile(join(runDir, shot));
          res.setHeader('Content-Type', 'image/png');
          res.setHeader('Cache-Control', 'no-cache');
          res.writeHead(200);
          res.end(img);
        } catch {
          res.writeHead(404); res.end('Not found');
        }
        return;
      }
      if (method === 'GET') {
        try {
          const raw = await readFile(join(runDir, 'state.json'), 'utf-8');
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(200);
          res.end(raw);
        } catch {
          json(res, { error: 'run not found or not started yet', runId }, 404);
        }
        return;
      }
      if (method === 'POST' && parts[1] === 'command') {
        const body = await readBody(req);
        const action = cleanString(body.action);
        if (!['submit', 'rescan', 'abort'].includes(action)) {
          return json(res, { error: 'action must be submit | rescan | abort' }, 400);
        }
        await writeFile(join(runDir, 'command.json'), JSON.stringify({ action, ts: Date.now() }), 'utf-8');
        return json(res, { ok: true });
      }
    }

    if (path === '/api/cv-pdf' && method === 'POST') {
      const body = await readBody(req);
      const company = cleanString(body.company) || 'company';
      const role = cleanString(body.role) || 'role';
      const response = cleanString(body.response) || '';
      const today = new Date().toISOString().slice(0, 10);
      const companySlug = slugify(company);

      let tailoredData = {};
      const tailoredJsonMatch = response.match(/### TAILORED_CV_JSON[\s\S]*?```json\s*(.*?)\s*```/is) || response.match(/### TAILORED_CV_JSON\s*({[\s\S]*?})/is);
      if (tailoredJsonMatch) {
        try { tailoredData = JSON.parse(tailoredJsonMatch[1]); } catch {}
      }

      const region = detectRegion(`${company} ${role} ${response}`);
      const basedProfileKey = region === 'asia' ? 'complete_bangkok' : 'complete_paris';
      const html = await renderPremiumCV(basedProfileKey, tailoredData);
      const htmlPath = join(WRITE_ROOT, 'batch/temp', `cv-${companySlug}.html`);
      const pdfFilename = `cv-hugo-vermot-${companySlug}-${today}.pdf`;
      const pdfPath = join(ROOT, 'output', pdfFilename);

      await writeFile(htmlPath, html, 'utf-8');
      const result = await runScript('pdf-gen', [htmlPath, pdfPath, '--format=a4']);
      if (!result.ok) return json(res, { error: result.stderr || 'PDF generation failed' }, 500);

      return json(res, { ok: true, filename: pdfFilename, url: `/output/${pdfFilename}` });
    }

    if (path === '/api/cover-letter-pdf' && method === 'POST') {
      const body = await readBody(req);
      const markdown = cleanString(body.markdown);
      if (!markdown) return json(res, { error: 'Cover letter markdown is required' }, 400);

      const company = cleanString(body.company) || 'company';
      const role = cleanString(body.role) || 'role';
      const profileData = await getProfile(req.userId).catch(() => ({}));
      const today = new Date().toISOString().slice(0, 10);
      const companySlug = slugify(company);
      const roleSlug = slugify(role).slice(0, 40);
      const baseName = `cover-letter-${companySlug}-${roleSlug}-${today}`;
      const htmlPath = join(WRITE_ROOT, 'batch/temp', `${baseName}.html`);
      const pdfPath = join(ROOT, 'output', `${baseName}.pdf`);

      const html = await renderCoverLetterPdfHtml({ company, role, markdown, profileData });
      await writeFile(htmlPath, html, 'utf-8');
      const result = await runScript('pdf-gen', [htmlPath, pdfPath, '--format=a4']);
      if (!result.ok) {
        return json(res, { error: result.stderr || 'PDF generation failed' }, 500);
      }

      return json(res, {
        ok: true,
        filename: `${baseName}.pdf`,
        url: `/output/${baseName}.pdf`,
      });
    }

    // ── SSE: stream Claude response for a career-ops mode ──────────────────
    if (path.startsWith('/api/claude/') && method === 'GET') {
      const mode = path.slice('/api/claude/'.length);
      const ALLOWED_MODES = ['scan','pipeline','tracker','oferta','pdf','deep','contacto','apply','coverletter','question'];
      if (!ALLOWED_MODES.includes(mode)) { res.writeHead(400); res.end('Unknown mode'); return; }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.writeHead(200);

      const send = (evt, data) => res.write(`event: ${evt}\ndata: ${JSON.stringify(data)}\n\n`);
      const heartbeat = setInterval(() => res.write(': ping\n\n'), 20000);
      req.on('close', () => clearInterval(heartbeat));

      try {
        // ── Load context ──────────────────────────────────────────────────
        const activeModeFile = mode === 'pipeline' ? 'oferta' : mode;
        const [shared, modeFile, cv, profile, profileConfig, apps, pipeline, articleDigest] = await Promise.all([
          readFile(join(ROOT, 'modes/_shared.md'), 'utf-8').catch(() => ''),
          readFile(join(ROOT, `modes/${activeModeFile}.md`), 'utf-8').catch(() => ''),
          getCvMarkdown(req.userId),
          getProfileContext(req.userId),
          // profileConfig : données structurées depuis Supabase (objet) ou fichier YAML (string)
          (async () => {
            if (useSupabase && req.userId) {
              const data = await getProfile(req.userId);
              return (data && Object.keys(data).length) ? data : {};
            }
            return readFile(join(ROOT, 'config/profile.yml'), 'utf-8').catch(() => '');
          })(),
          readFile(join(ROOT, 'data/applications.md'), 'utf-8').catch(() => ''),
          readFile(join(ROOT, 'data/pipeline.md'), 'utf-8').catch(() => ''),
          readFile(join(ROOT, 'article-digest.md'), 'utf-8').catch(() => ''),
        ]);

        // ── Pre-fetch for scan & pipeline ───
        const profileStruct = !profileConfig
          ? {}
          : typeof profileConfig === 'object'
            ? profileConfig
            : (yamlLoad(profileConfig) || {});
        const profileCriteriaBlock = buildProfileCriteriaBlock(profileStruct, profile);

        let prefetchData = '';
        let scanUrlPublishedAt = new Map();
        let scanCandidates = [];
        let pipelineTarget = null;
        let applyTarget = null;
        let coverLetterTarget = null;
        let profileGate = null;
        if (mode === 'scan') {
          resetSerpApiCircuit();
          resetPinchtabSolveCircuit();
          resetWebSearchCircuit();
          resetPinchtabHealthCache();
          send('status', { text: 'Fetching direct scan sources...' });
          const { parsed: portalsConfig } = await readPortalsYaml();
          const selection = await getScanSelection();
          // sel = null means scan all enabled sources
          const sel = selection && !selection.all ? selection : null;

          const inSel = (key, name) => !sel || (sel[key]?.includes(name));

          // ── Direct fetch sources (Greenhouse/Ashby/Lever APIs + RSS) ──────
          const directSources = [];
          const webSearchSources = [];
          const playwrightCos = [];
          const selectedCompanies = (portalsConfig.tracked_companies || [])
            .filter(c => c.enabled !== false && inSel('companies', c.name));

          selectedCompanies.forEach(company => {
            const access = getCompanyScanAccess(company);
            if (access.mode === 'api' && access.apiUrl) {
              directSources.push({
                name: company.name,
                url: access.apiUrl,
                type: 'json',
                query: company.scan_query || '',
                careers_url: company.careers_url || '',
              });
              return;
            }
            if (access.mode === 'websearch' && access.query) {
              webSearchSources.push({ name: company.name, query: access.query, careers_url: company.careers_url || '' });
              return;
            }
            playwrightCos.push(company);
          });

          (portalsConfig.rss_feeds || []).forEach(r => {
            if (r.enabled !== false && r.url && inSel('rss', r.name))
              directSources.push({ name: r.name, url: r.url, type: 'rss' });
          });

          const allQueries = [
            ...(portalsConfig.search_queries || []),
            ...(portalsConfig.eu_job_boards || []),
            ...(portalsConfig.freelance_portals || []),
          ];
          allQueries
            .filter(q => q.enabled !== false && inSel('queries', q.name))
            .forEach(q => webSearchSources.push({ name: q.name, query: q.query }));

          const selectedAggregators = getScanAggregators(portalsConfig)
            .filter(a => a.enabled !== false && inSel('aggregators', a.name));
          const runnableAggregators = selectedAggregators.filter(isAggregatorConfigured);
          const scannedSourceNames = [
            ...directSources.map(source => source.name),
            ...webSearchSources.map(source => source.name),
            ...playwrightCos.map(company => company.name),
            ...runnableAggregators.map(aggregator => aggregator.name),
          ];

          const directResults = await Promise.allSettled(directSources.map(source => fetchSourceSection(source)));
          const serpApiConfigured = Boolean(SERPAPI_KEY || process.env.SEARCHAPI_KEY);
          // Pre-flight: validate API key once before dispatching all parallel web searches
          if (serpApiConfigured) await probeSearchApi();
          const webSearchResults = await fetchWebSearchSectionsSequential(webSearchSources);
          const playwrightResults = await fetchPlaywrightSections(playwrightCos);
          const aggregatorResults = await Promise.allSettled(runnableAggregators.map(aggregator =>
            fetchAggregatorSection(aggregator, portalsConfig)
          ));
          await updateScanState(scannedSourceNames).catch(err => {
            console.warn(`[scan] Failed to update scan-state.json: ${err.message}`);
          });

          scanUrlPublishedAt = new Map();
          directResults
            .filter(r => r.status === 'fulfilled' && r.value?.jobs?.length)
            .forEach(r => mergePublishedDates(scanUrlPublishedAt, r.value.jobs));
          webSearchResults
            .filter(r => r.status === 'fulfilled' && r.value?.jobs?.length)
            .forEach(r => mergePublishedDates(scanUrlPublishedAt, r.value.jobs));
          playwrightResults
            .filter(r => r.ok && r.jobs?.length)
            .forEach(r => mergePublishedDates(scanUrlPublishedAt, r.jobs));
          aggregatorResults
            .filter(r => r.status === 'fulfilled' && r.value?.jobs?.length)
            .forEach(r => mergePublishedDates(scanUrlPublishedAt, r.value.jobs));

          const allScanCandidates = dedupeScanCandidates([
            ...directResults.flatMap((result, index) =>
              result.status === 'fulfilled' && result.value?.jobs?.length
                ? buildScanCandidateRecords(directSources[index]?.name, result.value.jobs, {
                    engine: result.value.engine || '',
                  })
                : []
            ),
            ...webSearchResults.flatMap((result, index) =>
              result.status === 'fulfilled' && result.value?.jobs?.length
                ? buildScanCandidateRecords(webSearchSources[index]?.name, result.value.jobs, {
                    engine: result.value.engine || '',
                  })
                : []
            ),
            ...playwrightResults.flatMap(result =>
              result.ok && result.jobs?.length
                ? buildScanCandidateRecords(result.company, result.jobs, { includeCompany: true, engine: 'playwright' })
                : []
            ),
            ...aggregatorResults.flatMap((result, index) =>
              result.status === 'fulfilled' && result.value?.jobs?.length
                ? buildScanCandidateRecords(runnableAggregators[index]?.name, result.value.jobs, {
                    includeCompany: true,
                    engine: result.value.engine || '',
                  })
                : []
            ),
          ]);
          const remoteFilteredCandidates = filterScanCandidatesByRemotePolicy(
            allScanCandidates,
            portalsConfig.remote_filter || {}
          );

          // Verify that job URLs are still alive (filter out 404s, expired postings)
          const today = new Date().toISOString().slice(0, 10);
          const { alive: verifiedCandidates, dead: deadCandidates } = await verifyJobLinks(remoteFilteredCandidates.kept);
          if (deadCandidates.length) {
            const deadEntries = deadCandidates.map(c =>
              `${c.url}\t${today}\tscan-link-check\t${c.title || ''}\t${c.company || ''}\texpired`
            );
            await appendScanHistoryEntries(deadEntries).catch(err =>
              console.warn(`[scan] Failed to append dead links to scan-history: ${err.message}`)
            );
          }
          // Filter out URLs already in pipeline, scan-history, or reports, and
          // company+role pairs already tracked / permanently deleted.
          {
            const [existingPipeline, existingHistory, existingReports, companyRoleExclusions] = await Promise.all([
              getPipeline().catch(() => []),
              getBlockingScanHistoryUrlSet().catch(() => new Set()),
              getReportUrlSet().catch(() => new Set()),
              getCompanyRoleExclusions(req.userId).catch(() => new Map()),
            ]);
            const knownNormalized = new Set([
              ...existingPipeline.map(e => normalizeUrlKey(String(e?.url || ''))).filter(Boolean),
              ...[...existingHistory].map(u => normalizeUrlKey(u)).filter(Boolean),
              ...[...existingReports].map(u => normalizeUrlKey(u)).filter(Boolean),
            ]);
            const beforeCount = verifiedCandidates.length;
            const freshCandidates = verifiedCandidates.filter(c => {
              const key = c.normalizedUrl || normalizeUrlKey(c.url);
              if (!key || knownNormalized.has(key)) return false;
              if (isCompanyRoleExcluded(c.company || '', c.title || '', companyRoleExclusions)) return false;
              return true;
            });
            const skippedCount = beforeCount - freshCandidates.length;
            if (skippedCount > 0) {
              console.log(`[scan] [pre-dedup] ${skippedCount} already-known URL(s)/company+role removed before manifest (pipeline/history/reports/apps/deleted)`);
            }
            scanCandidates = freshCandidates;
          }

          // Look up missing publishedAt (API for Greenhouse/Lever/Ashby URLs,
          // PinchTab JSON-LD fallback) then drop anything older than max_age_days.
          const maxAgeDays = Number.isFinite(portalsConfig.scan_max_age_days)
            ? portalsConfig.scan_max_age_days
            : DEFAULT_SCAN_MAX_AGE_DAYS;
          await enrichCandidatesWithPublishedDates(scanCandidates);
          scanCandidates = applyAgeFilter(scanCandidates, { maxAgeDays });

          const sections = [
            ...directResults.filter(r => r.status === 'fulfilled' && r.value?.section).map(r => r.value.section),
            ...webSearchResults.filter(r => r.status === 'fulfilled' && r.value?.section).map(r => r.value.section),
            ...playwrightResults.filter(r => r.ok && r.section).map(r => r.section),
            ...aggregatorResults.filter(r => r.status === 'fulfilled' && r.value?.section).map(r => r.value.section),
            buildScanCandidateManifest(scanCandidates),
          ];
          prefetchData = sections.join('\n\n');

          const fetchedDirectCount = directResults.filter(r => r.status === 'fulfilled' && r.value?.ok).length;
          const fetchedWebCount = webSearchResults.filter(r => r.status === 'fulfilled' && r.value?.ok).length;
          const fetchedPlaywrightCount = playwrightResults.filter(r => r.ok).length;
          const fetchedAggregatorCount = aggregatorResults.filter(r => r.status === 'fulfilled' && r.value?.ok).length;
          const failedDirect = directResults.filter(r => r.status === 'rejected' || !r.value?.ok);
          const failedWeb = webSearchResults.filter(r => r.status === 'rejected' || !r.value?.ok);
          const failedPlaywright = playwrightResults.filter(r => !r.ok);
          const failedAggregators = aggregatorResults.filter(r => r.status === 'rejected' || !r.value?.ok);

          // Console recap
          console.log(`[scan] ── Fetch recap ──────────────────────────────`);
          console.log(`[scan] API/RSS: ${fetchedDirectCount}/${directSources.length} OK${failedDirect.length ? ` | ${failedDirect.length} failed` : ''}`);
          directResults.forEach((r, i) => {
            const src = directSources[i];
            if (r.status === 'rejected') console.error(`[scan]   ✗ ${src?.name}: ${r.reason?.message || r.reason}`);
            else if (!r.value?.ok) console.warn(`[scan]   ✗ ${src?.name}: returned ok=false`);
            else console.log(`[scan]   ✓ ${src?.name}`);
          });
          console.log(`[scan] WebSearch: ${fetchedWebCount}/${webSearchSources.length} OK${failedWeb.length ? ` | ${failedWeb.length} failed` : ''}`);
          webSearchResults.forEach((r, i) => {
            const src = webSearchSources[i];
            const engine = r.value?.engine || '?';
            if (r.status === 'rejected') console.error(`[scan]   ✗ ${src?.name}: ${r.reason?.message || r.reason}`);
            else if (!r.value?.ok) console.warn(`[scan]   ✗ ${src?.name}: returned ok=false`);
            else console.log(`[scan]   ✓ ${src?.name} [${engine}]`);
          });
          console.log(`[scan] Playwright: ${fetchedPlaywrightCount}/${playwrightCos.length} OK${failedPlaywright.length ? ` | ${failedPlaywright.length} failed` : ''}`);
          playwrightResults.forEach(result => {
            if (!result.ok) {
              const marker = result.cancelled ? '↺' : '✗';
              console.warn(`[scan]   ${marker} ${result.company}: ${result.error || 'returned ok=false'}`);
            }
            else console.log(`[scan]   ✓ ${result.company} [playwright]`);
          });
          console.log(`[scan] Aggregators: ${fetchedAggregatorCount}/${runnableAggregators.length} OK${failedAggregators.length ? ` | ${failedAggregators.length} failed` : ''}`);
          aggregatorResults.forEach((result, i) => {
            const source = runnableAggregators[i];
            if (result.status === 'rejected') console.error(`[scan]   ✗ ${source?.name}: ${result.reason?.message || result.reason}`);
            else if (!result.value?.ok) console.warn(`[scan]   ✗ ${source?.name}: ${result.value?.error || 'returned ok=false'}`);
            else console.log(`[scan]   ✓ ${source?.name} [${result.value?.engine || '?'}]`);
          });
          console.log(`[scan] Total sections built: ${sections.length} | prefetchData: ${prefetchData.length} chars`);
          console.log(`[scan] ─────────────────────────────────────────────`);

          const apiLabel = process.env.SEARCHAPI_KEY && !process.env.SERPAPI_KEY ? 'SearchAPI' : 'SerpApi';
          const statusParts = [];
          statusParts.push(`${fetchedDirectCount}/${directSources.length} source${directSources.length !== 1 ? 's' : ''} API/RSS fetchée${directSources.length !== 1 ? 's' : ''}`);
          if (webSearchSources.length) {
            const fallbackLabel = serpApiConfigured
              ? `via ${apiLabel} (+ fallback HTML si besoin)`
              : process.env.BRAVE_API_KEY
              ? 'via Brave Search (+ fallback HTML si besoin)'
              : 'via fallback HTML (sans clé API)';
            statusParts.push(
              `${fetchedWebCount}/${webSearchSources.length} source${webSearchSources.length !== 1 ? 's' : ''} WebSearch préfetchée${webSearchSources.length !== 1 ? 's' : ''} ${fallbackLabel}`
            );
          }
          if (playwrightCos.length) {
            statusParts.push(`${fetchedPlaywrightCount}/${playwrightCos.length} source${playwrightCos.length !== 1 ? 's' : ''} Playwright fetchée${playwrightCos.length !== 1 ? 's' : ''}`);
          }
          if (runnableAggregators.length) {
            statusParts.push(`${fetchedAggregatorCount}/${runnableAggregators.length} agrégateur${runnableAggregators.length !== 1 ? 's' : ''} fetché${runnableAggregators.length !== 1 ? 's' : ''}`);
          }
          if (scanCandidates.length) {
            statusParts.push(`${scanCandidates.length} candidat${scanCandidates.length !== 1 ? 's' : ''} préfiltré${scanCandidates.length !== 1 ? 's' : ''} remote strict`);
          }
          if (remoteFilteredCandidates.dropped.length) {
            statusParts.push(`${remoteFilteredCandidates.dropped.length} exclu${remoteFilteredCandidates.dropped.length !== 1 ? 's' : ''} par filtre remote`);
          }
          send('status', { text: statusParts.join(' • ') });

          if (!prefetchData) prefetchData = 'Aucune offre pré-filtrée trouvée cette fois.';

          // Clear selection after use so next scan defaults to all
          await writeFile(SCAN_SELECTION_FILE, JSON.stringify({ all: true }), 'utf-8').catch(() => {});

          send('status', { text: 'Analyzing filtered results with Claude...' });
        } else if (mode === 'pipeline') {
          const pipe = await getPipeline(req.userId);
          if (pipe.length === 0) {
            send('done', { ok: true, saves: ['Pipeline is empty'] });
            res.end();
            return;
          }
          const selectedPipelineUrl = urlObj.searchParams.get('url')?.trim() || '';
          pipelineTarget = selectedPipelineUrl
            ? pipe.find(entry => entry.url === selectedPipelineUrl) || null
            : pipe[0];
          if (!pipelineTarget) {
            throw new Error('Selected pipeline item was not found. Refresh and try again.');
          }
          send('status', { text: `Fetching JD for: ${pipelineTarget.url}...` });
          const pipelineNoteParts = extractPipelineNoteParts(pipelineTarget.note || '');
          const jdResult = await fetchJobDescriptionText(pipelineTarget.url, {
            maxChars: 15000,
            logLabel: 'pipeline',
            note: pipelineTarget.note || '',
            hintCompany: pipelineNoteParts.company,
            hintTitle: pipelineNoteParts.title,
          });
          if (!jdResult.ok || !String(jdResult.text || '').trim()) {
            // Even the headed-Chrome fallback couldn't load it (dead URL, or the
            // anti-bot challenge wasn't solved in time). Park it as `skipped_blocked`
            // so it leaves the active queue instead of re-failing on every scan.
            await removeFromPipeline(pipelineTarget.url, req.userId, { historyStatus: 'skipped_blocked', historyPortal: 'pipeline-blocked' })
              .catch(err => console.warn(`[pipeline] failed to park blocked URL: ${err.message}`));
            const message = `JD not loaded for ${pipelineTarget.url}: ${jdResult.error || 'empty content'}. Parked as blocked and removed from the active queue — re-add the URL to retry.`;
            console.warn(`[pipeline] ${message}`);
            send('warning', { text: message });
            send('chunk', {
              text: [
                `# Evaluation blocked`,
                '',
                `**URL:** ${pipelineTarget.url}`,
                pipelineTarget.note ? `**Note:** ${pipelineTarget.note}` : '',
                '',
                'The job description could not be loaded, even with the visible-Chrome fallback, so I did not generate a score, report, tracker row, or application-answer fallback.',
                'This URL has been parked (status `skipped_blocked`) and removed from the active queue so it no longer blocks the pipeline. Paste the JD text, or re-add the URL to retry when the page is accessible.',
              ].filter(Boolean).join('\n')
            });
            send('done', { ok: false, blocked: true, saves: ['Evaluation blocked: JD content missing. URL parked as skipped_blocked (removed from active queue).'] });
            res.end();
            return;
          }
          prefetchData = `## Job Description from ${pipelineTarget.url}\n${pipelineTarget.note ? `Context note: ${pipelineTarget.note}\n` : ''}\n${jdResult.text}`;
          console.log(`[pipeline] prefetchData length: ${prefetchData.length} chars`);
          profileGate = evaluateOfferAgainstProfile(prefetchData, profileStruct, profile);
          console.log(`[pipeline] profileGate: hardReject=${profileGate.hardReject}, reasons=${JSON.stringify(profileGate.reasons)}`);
          if (profileGate.hardReject) {
            send('status', { text: `Hard pass détecté avant évaluation: ${profileGate.reasons.join(' ')}` });
          } else {
            send('status', { text: 'Evaluating with Claude...' });
          }
        } else if (mode === 'apply' || mode === 'coverletter' || mode === 'question') {
          const selectedCompany = urlObj.searchParams.get('company')?.trim() || '';
          const selectedRole = urlObj.searchParams.get('role')?.trim() || '';
          const selectedReport = urlObj.searchParams.get('report')?.trim() || '';

          if (!selectedCompany && !selectedRole && !selectedReport) {
            send('start', { mode });
            send('chunk', {
              text: [
                mode === 'apply' ? '# Apply to Offer' : mode === 'question' ? '# Answer Question' : '# Cover Letter',
                '',
                mode === 'apply'
                  ? 'Select an offer from the Applications table with the row-level Apply button so the report can be preloaded.'
                  : mode === 'question'
                  ? 'Select an offer from the Applications table with the row-level Q? button to answer an application question.'
                  : 'Select an offer from the Applications table with the row-level Cover Letter button so the report can be preloaded.',
              ].join('\n')
            });
            send('done', { ok: true, saves: [] });
            res.end();
            return;
          }

          send('status', { text: 'Loading selected offer context...' });
          const applications = await getApplications(req.userId);
          const companyKey = normalizeLookup(selectedCompany);
          const roleKey = normalizeLookup(selectedRole);

          const selectedTarget = applications.find(app => {
            const appCompany = app.Company ?? app.company ?? '';
            const appRole = app.Role ?? app.role ?? '';
            const appReport = extractReportFilename(app.Report ?? app.report ?? '');
            return (selectedReport && appReport === selectedReport) ||
              (companyKey && roleKey &&
                normalizeLookup(appCompany) === companyKey &&
                normalizeLookup(appRole) === roleKey);
          }) || null;
          if (mode === 'apply') applyTarget = selectedTarget;
          if (mode === 'coverletter') coverLetterTarget = selectedTarget;
          // question: no separate target needed, reportContent is enough

          const reportFilename = selectedReport || extractReportFilename(selectedTarget?.Report ?? selectedTarget?.report ?? '');
          if (!reportFilename) {
            throw new Error(mode === 'apply'
              ? 'No report found for the selected offer. Evaluate the offer first so Apply has context.'
              : mode === 'question'
              ? 'No report found for the selected offer. Evaluate the offer first so the question answer has context.'
              : 'No report found for the selected offer. Evaluate the offer first so Cover Letter has context.');
          }

          let reportContent = '';
          try {
            reportContent = await getReport(reportFilename, req.userId);
          } catch {
            throw new Error(`Selected report not found: ${reportFilename}`);
          }

          const company = selectedCompany || selectedTarget?.Company || selectedTarget?.company || 'Unknown';
          const role = selectedRole || selectedTarget?.Role || selectedTarget?.role || 'Unknown';
          const status = selectedTarget?.Status || selectedTarget?.status || 'Unknown';
          const score = selectedTarget?.Score || selectedTarget?.score || 'Unknown';

          // Extract job URL from report header (**URL:** line) or tracker
          const urlFromReport = (reportContent.match(/\*\*URL:\*\*\s*(https?:\/\/\S+)/i) || [])[1] || '';
          const jobUrl = urlFromReport || selectedTarget?.JobURL || selectedTarget?.job_url || '';

          // For cover letter: fetch the raw JD so Claude can mirror exact keywords
          let rawJD = '';
          if (mode === 'coverletter' && jobUrl) {
            send('status', { text: `Fetching JD for cover letter: ${jobUrl}...` });
            try {
              const jdResult = await fetchJobDescriptionText(jobUrl, {
                maxChars: 12000,
                logLabel: 'coverletter',
              });
              if (jdResult.ok) rawJD = jdResult.text;
            } catch (_) {
              // fallback: report already has JD summary
            }
          }

          prefetchData = [
            '## Selected application',
            `Company: ${company}`,
            `Role: ${role}`,
            `Status: ${status}`,
            `Score: ${score}`,
            `Report: ${reportFilename}`,
            jobUrl ? `Job URL: ${jobUrl}` : '',
            '',
            rawJD ? `## Raw Job Description (source: ${jobUrl})\n${rawJD}` : '',
            '## Full evaluation report',
            reportContent,
          ].filter(Boolean).join('\n');

          send('status', { text: mode === 'apply' ? 'Preparing apply starter pack...' : mode === 'question' ? 'Generating answer...' : 'Generating tailored cover letter...' });
        }

        // ── Build prompt ──────────────────────────────────────────────────
        const systemPrompt = [shared, modeFile].filter(Boolean).join('\n\n---\n\n');
        const leanEvaluationModes = new Set(['scan', 'oferta', 'pipeline']);
        const includeGlobalTrackingContext = !['apply', 'coverletter', 'question', 'scan', 'oferta', 'pipeline'].includes(mode);
        const includeCvContext = mode !== 'scan';
        const includeArticleDigest = articleDigest && !leanEvaluationModes.has(mode);
        const parts = [
          `## Profil personnalisé\n${profile}`,
          `## Profil structuré (config/profile.yml)\n${profileConfig}`,
          `## Critères de matching dérivés du profil\n${profileCriteriaBlock}`,
        ];
        if (includeCvContext) {
          parts.unshift(`## CV du candidat\n${cv}`);
        }
        if (includeGlobalTrackingContext) {
          parts.push(`## Tracker actuel\n${apps}`);
          parts.push(`## Pipeline actuel\n${pipeline}`);
        }
        if (includeArticleDigest) parts.push(`## Proof points détaillés (article-digest.md)\n${articleDigest}`);
        if (prefetchData) parts.push(`## Offres récupérées en direct\n${prefetchData}`);
        if (mode === 'scan') {
          parts.push(`---\nRÈGLES STRICTES :
1. Travaille UNIQUEMENT avec les offres présentes dans "## Offres récupérées en direct" ci-dessus. N'invente PAS d'offres et n'ajoute pas d'URL qui n'apparaît pas déjà dans ces sections.
1b. La section "## Candidate Roster" est la source de vérité la plus fiable. Si tu gardes une offre, son URL doit apparaître telle quelle dans cette section.
1c. Pour le remote: garde UNIQUEMENT les offres avec preuve EXPLICITE de remote dans les données récupérées. Si le remote est "probable", "compatible", "à confirmer", "remote-friendly", ou simplement supposé, EXCLUS l'offre.
1d. Pour le full remote: garde UNIQUEMENT worldwide/global, Europe/EMEA/EU, Asia/APAC, ou Dubai/UAE. EXCLUS les offres remote US-only, Canada-only, LATAM/Latin America, Americas/North America/South America, même si elles disent "fully remote".
2. FILTRE: garde uniquement les offres qui correspondent aux critères du profil. Si une offre viole une contrainte dure du profil, exclue-la immédiatement. Si l'offre n'est pas explicitement full remote / remote, hard pass direct.
2b. EXCLUS immédiatement toute URL qui est une page catégorie, une page entreprise, une page de listing, ou une page de recherche (ex: /role/r/*, /companies/*, /web3-companies/*, /jobs?*, /search?*). Seules les URLs pointant vers UN poste précis sont valides.
2c. EXCLUS les offres junior (Associate, Junior, "entry-level") si le profil cible des rôles senior. EXCLUS les offres hors domaine produit/design/AI (marketing, finance, juridique, RH, payroll) sauf si le lien avec l'AI est central et explicite.
3. Pour chaque offre retenue, indique: titre | entreprise | URL | preuve remote exacte | pourquoi pertinent par rapport aux rôles cibles et au profil.
4. Dans la sortie, liste UNIQUEMENT les offres retenues (celles qui seront ajoutées). Ne liste pas les offres exclues — mentionne juste le nombre total exclu en une ligne.
5. Si tu ne retiens aucune offre, écris quand même la section "## URLs_À_AJOUTER" puis juste en dessous la ligne exacte "AUCUNE".
6. À la fin, liste les URLs à ajouter sous l'en-tête EXACT "## URLs_À_AJOUTER", une URL par ligne au format "URL | Company | Role". Ne pose aucune question de confirmation — un script extrait et ajoute automatiquement.`);
        } else if (mode === 'pipeline') {
          if (profileGate?.hardReject) {
            parts.push(`---\nCONTRAINTE DURE DÉTECTÉE AVANT ÉVALUATION :
- ${profileGate.reasons.join('\n- ')}
- Work mode détecté: ${profileGate.workMode.mode}
${profileGate.workMode.evidence.length ? `- Evidence: ${profileGate.workMode.evidence.join(' | ')}` : ''}

Tu dois produire une évaluation de disqualification immédiate.
Règles:
- commence par "# Evaluation: {Company} — {Role}"
- score global entre 1.0/5 et 2.0/5 maximum
- indique clairement que l'offre est rejetée parce qu'elle viole les critères du profil
- la politique remote du profil est une contrainte dure ici
- ne cherche pas à sauver l'offre ni à proposer d'exception
- garde le format A-D suffisamment structuré pour que le report reste exploitable
- conclusion explicite: HARD PASS / DO NOT APPLY`);
          } else {
            parts.push(`---\nExécute l'évaluation complète (mode oferta) sur l'offre récupérée ci-dessus. L'URL est ${pipelineTarget.url}. Vérifie l'offre contre TOUS les critères dérivés du profil avant de scorer. Si une contrainte dure du profil est violée, rejette l'offre immédiatement. Génère directement le rapport final de A à D avec le bon format (Résumé du rôle, Match CV, Niveau et stratégie, Comp et demande) — n'inclus PAS de plan de personnalisation CV/LinkedIn, ce n'est pas le rôle de cette évaluation. Ne scanne pas le formulaire de candidature, ne génère pas de questions/réponses de candidature, ne génère pas de JSON de CV tailoré et ne demande pas de PDF. Ne mentionne pas tes actions au préalable, sois direct et commence avec "# Evaluation: {Company} — {Role}".`);
          }
        } else if (mode === 'apply') {
          parts.push(`---\nTu démarres le mode apply pour une offre déjà sélectionnée. Utilise le report complet fourni ci-dessus pour préparer un starter pack d'application: résumé ciblé de l'offre, 3-5 angles forts à réutiliser, pièces à joindre, valeurs probables pour les champs standards (salaire, préavis, visa/remote) basées sur profile.yml si disponibles, puis une liste concise de ce qu'il faut partager ensuite (screenshot ou copier-coller des questions). N'invente aucun champ de formulaire non visible et ne prétends pas voir le formulaire tant qu'il n'a pas été fourni.`);
        } else if (mode === 'question') {
          const userQuestion = urlObj.searchParams.get('question')?.trim() || '';
          parts.push(`---
Tu dois répondre à une question de formulaire de candidature pour l'offre ci-dessus.

**Question posée dans le formulaire :**
${userQuestion || '(aucune question fournie — demande à l\'utilisateur de la préciser)'}

SOURCES À UTILISER :
1. Pour les questions d'expérience / produit / projet : cv.md + article-digest.md + _profile.md d'abord. Le report sert à reprendre le vocabulaire de la JD, pas à inventer des analogies.
2. Pour les questions de motivation : report d'évaluation ci-dessus — blocs B/C/D (critères, match CV, signaux pratiques)
3. Pour les questions factuelles : profile.yml

RÈGLES DE FOND :
1. Réponds à la question LITTÉRALEMENT. Si elle contient plusieurs sous-questions, couvre-les toutes dans le même ordre.
2. Pour une question d'expérience, cite un produit ou projet réel dès la première phrase.
3. Si l'expérience exacte demandée n'existe pas, dis-le clairement en une courte clause, puis bascule vers l'expérience adjacente la plus crédible.
4. Ne transforme jamais une expérience adjacente en expérience directe.
5. N'invente jamais les utilisateurs. Nomme les vrais users du projet cité.
6. N'utilise jamais du langage de translation flou du type "maps closely to", "similar infrastructure field", "this experience translates to", "internal AI operators", "robust pipeline orchestration", sauf si c'est un fait exact présent dans les sources.
7. Privilégie une réponse simple, concrète, courte. 40 à 110 mots par défaut.
8. Si la question demande produit + utilisateurs + problème + impact, réponds exactement dans cet ordre.

RÈGLES DE COPYWRITING :
1. Première personne, voix active — aucun passif.
2. 2–4 phrases max sauf si la question demande clairement plus (ex: "décrivez un projet en détail").
3. Lead avec un fait concret ou une métrique — JAMAIS "Je suis passionné par…" ou "I would love the opportunity to…".
4. Ancre dans le spécifique : cite quelque chose de précis du JD/report ET un proof point réel du candidat, mais sans détourner la question.
5. Ton "I'm choosing you" : confiant, direct, pas arrogant. On postule parce qu'on a analysé et que ça matche — pas par désespoir.
6. Adapte l'archétype au contexte du rôle (cf. _profile.md section "Framing Adaptatif").
7. Langue = celle de la question (FR si FR, EN si EN).
8. Zéro corporate speak, zéro filler, zéro générique.
9. N'invente aucune expérience ni métrique — si un gap existe, contourne intelligemment.
10. Pour les questions niche ou domaine spécifique, l'honnêteté factuelle passe avant le framing.

CLASSIFICATION DE LA QUESTION :
- Motivation ("Pourquoi nous / ce rôle ?") → signal spécifique de l'offre + proof point qui y mappe directement
- Expérience / projet → réponds d'abord "direct" ou "adjacent", puis : produit construit → utilisateurs → problème résolu → impact réel
- Compétence ("Comment gérez-vous X ?") → méthode concrète + outcome, pas de liste générique
- Valeurs / style de travail → honnête + cohérent avec _profile.md (autonomie, systèmes, ownership)
- Factuel (salaire, préavis, remote, visa) → réponse directe depuis profile.yml
- Open-ended ("Parlez-nous de vous") → archétype + meilleur proof point + fit spécifique à cette offre

Format de sortie — UNIQUEMENT ceci, prêt à coller :

## ${urlObj.searchParams.get('company') || 'Company'} — ${urlObj.searchParams.get('role') || 'Role'}
**Question :** [question exacte reprise telle quelle]

[Réponse]

---
_Note : [uniquement si quelque chose doit être vérifié ou personnalisé avant envoi — sinon, omets complètement cette ligne]_`);
        } else if (mode === 'coverletter') {
          parts.push(`---
Génère une cover letter ultra ciblée pour cette offre. Tu as accès à la JD brute (si disponible) ET au report d'évaluation complet.

RÈGLES STRICTES :
1. Réponds aux TERMES EXACTS de la JD — réutilise le vocabulaire de l'offre (titres de section, keywords techniques, verbes d'action). Si la JD dit "RAG pipelines", tu dis "RAG pipelines", pas "LLM workflows".
2. Identifie les 2-3 PROJETS DU CANDIDAT les plus pertinents pour cette offre spécifique et mets-les en avant avec preuve concrète (metric ou démo dispo).
3. Identifie les CAPACITÉS qui matchent les exigences clés de la JD et cite-les directement — pas de liste générique de skills.
4. Structure exacte à respecter :

# Cover Letter — {Company} — {Role}

## Version courte
[120-180 mots — prête à coller dans un formulaire, sans salutation ni signature, commence par une preuve concrète]

## Version email
Subject: {Role} — {Prénom} {Nom}

Hi {Prénom du hiring manager ou "there"},

[Corps — 3 paragraphes : accroche spécifique à l'offre / proof point + capacité clé / closing avec CTA]

Best,
{Nom complet}

## Version longue
[350-450 mots — formelle, avec salutation, structure complète]

## Projets mis en avant
- [Nom du projet] — [pourquoi pertinent pour CETTE offre, en 1 ligne]
(liste les 2-3 projets sélectionnés avec justification)

Contraintes :
- Langue = celle de la JD (EN par défaut)
- Ton direct, senior, "I'm choosing you" — jamais "I am passionate about"
- Ne jamais inventer d'expérience ou de metric
- Si un gap existe dans le report, le contourner intelligemment sans mentir`);
        } else {
          parts.push(`---\nExécute le mode **${mode}**. Sois direct et actionnable.`);
        }

        send('start', { mode });

        // ── Stream response ───────────────────────────────────────────────
        const promptLength = parts.join('\n\n').length;
        console.log(`[${mode}] sending prompt to Claude — ${promptLength} chars, systemPrompt=${systemPrompt?.length || 0} chars`);
        const generationModel = MODELS.GPT4_1_MINI;
        const generationTemperature = mode === 'question' ? 0.1 : 0.3;
        const generationMaxTokens = mode === 'question'
          ? 2048
          : (mode === 'scan' || mode === 'oferta' || mode === 'pipeline')
            ? 4096
            : 8192;
        let fullResponse = '';
        try {
          for await (const chunk of chatStream({
            model: generationModel,
            messages: [{ role: 'user', content: parts.join('\n\n') }],
            systemPrompt,
            temperature: generationTemperature,
            max_tokens: generationMaxTokens,
          })) {
            fullResponse += chunk;
            send('chunk', { text: chunk });
          }
        } catch (streamErr) {
          console.error(`[${mode}] chatStream error: ${streamErr.message}`, streamErr);
          throw streamErr;
        }
        console.log(`[${mode}] stream complete — ${fullResponse.length} chars received`);

        // ── Post-processing: persist results ──────────────────────────────
        const saves = [];

        // SCAN → extract URLs and add to pipeline.md
        if (mode === 'scan') {
          const parsed = extractScanEntriesFromResponse(fullResponse, scanUrlPublishedAt);
          const candidateUrlIndex = new Map(
            scanCandidates.flatMap(candidate => {
              const entries = [];
              if (candidate.url) entries.push([candidate.url, candidate]);
              if (candidate.normalizedUrl) entries.push([candidate.normalizedUrl, candidate]);
              return entries;
            })
          );
          const validParsed = parsed.filter(({ url }) => candidateUrlIndex.has(url) || candidateUrlIndex.has(normalizeUrlKey(url)));
          const rejectedParsed = parsed.filter(({ url }) => !(candidateUrlIndex.has(url) || candidateUrlIndex.has(normalizeUrlKey(url))));
          const currentPipeline = await getPipeline(req.userId).catch(() => []);
          const existingPipelineUrls = new Set(
            currentPipeline
              .map(entry => normalizeUrlKey(String(entry?.url || '').trim()))
              .filter(Boolean)
          );
          const existingHistoryUrls = await getBlockingScanHistoryUrlSet().catch(() => new Set());
          const existingReportUrls = await getReportUrlSet().catch(() => new Set());
          const normalizedReportUrls = new Set([...existingReportUrls].map(url => normalizeUrlKey(url)).filter(Boolean));
          const isKnown = (url) => {
            const key = normalizeUrlKey(url);
            return existingPipelineUrls.has(key) || existingHistoryUrls.has(key) || normalizedReportUrls.has(key);
          };
          const newEntries = validParsed.filter(({ url }) => !isKnown(url));
          const duplicateEntries = validParsed.filter(({ url }) => isKnown(url));

          if (newEntries.length) {
            await addManyToPipeline(newEntries, req.userId);
          }

          if (validParsed.length) {
            const today = new Date().toISOString().slice(0, 10);
            const historyRows = [
              ...newEntries.map(({ url, note }) => {
                const parts = extractPipelineNoteParts(note);
                return [url, today, 'scan-ui', parts.title || '', parts.company || '', 'added'].join('\t');
              }),
              ...duplicateEntries.map(({ url, note }) => {
                const parts = extractPipelineNoteParts(note);
                return [url, today, 'scan-ui', parts.title || '', parts.company || '', 'skipped_dup'].join('\t');
              }),
            ];
            await appendScanHistoryEntries(historyRows).catch(err => {
              console.warn(`[scan] Failed to append scan-history.tsv: ${err.message}`);
            });
          }

          if (rejectedParsed.length) {
            const rejectedList = rejectedParsed.slice(0, 5).map(entry => entry.url).join(', ');
            const message = `Ignored ${rejectedParsed.length} URL(s) that were not in the scanned candidate roster${rejectedList ? `: ${rejectedList}` : ''}`;
            saves.push(message);
            send('warning', { text: message });
          }

          if (newEntries.length) {
            saves.push(`${newEntries.length} URLs added to pipeline! (${validParsed.length - newEntries.length} duplicates skipped)`);
          } else if (validParsed.length > 0) {
            saves.push(`Found ${validParsed.length} valid scanned URLs, but all were already known (pipeline or scan history)`);
          } else if (scanCandidates.length > 0) {
            const message = `Claude selected 0 URL from ${scanCandidates.length} scanned candidate(s)`;
            saves.push(message);
            send('warning', { text: message });
          } else {
            const message = 'No URLs could be extracted from the scan response';
            saves.push(message);
            send('warning', { text: message });
          }
        }

        // OFERTA/PIPELINE → save report + TSV tracker entry (WITH VALIDATION)
        if (['oferta', 'pipeline'].includes(mode) && fullResponse.length > 500) {
          console.log(`[${mode}] post-processing report — fullResponse=${fullResponse.length} chars`);
          // Get next report number
          const reportFiles = await readdir(join(ROOT, 'reports')).catch(() => []);
          const maxNum = reportFiles
            .map(f => parseInt(f.match(/^(\d+)/)?.[1] || '0'))
            .reduce((a, b) => Math.max(a, b), 0);
          const num = String(maxNum + 1).padStart(3, '0');
          const today = new Date().toISOString().slice(0, 10);

          // Extract company/role/score from response with multiple fallback patterns
          const headerMatch  = fullResponse.match(/(?:#\s*)?Evaluation[:\s]+\*?\*?([^-—\|]+)\s*[-—\|]\s*([^\n\*]+)/i);
          const companyMatch = headerMatch || fullResponse.match(/\*\*Company[:\*]+\s*(.+?)[\*\n]/i) || fullResponse.match(/\*\*Empresa[:\*]+\s*(.+?)[\*\n]/i) || fullResponse.match(/entreprise[:\s]+\*?\*?([^\n\*]+)/i);
          const roleMatch    = (headerMatch ? { 1: headerMatch[2] } : null) || fullResponse.match(/\*\*Role[:\*]+\s*(.+?)[\*\n]/i) || fullResponse.match(/\*\*Rol[:\*]+\s*(.+?)[\*\n]/i) || fullResponse.match(/rôle[:\s]+\*?\*?([^\n\*]+)/i);
          const scoreMatch   = fullResponse.match(/\*\*Score[:\*]+\s*([\d.]+(?:\/5)?)/i) || fullResponse.match(/Score[:\s]+\*?\*?([\d.]+(?:\/5)?)/i) || fullResponse.match(/\*\*Global\*\*[^|]*\|\s*\*\*([\d.]+\/5)\*\*/i) || fullResponse.match(/([\d.]+)\/5/);
          
          const company  = (companyMatch?.[1] || 'unknown').trim().replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 30);
          const role     = (roleMatch?.[1]    || 'role').trim().slice(0, 70);
          let scoreRaw   = scoreMatch?.[1] || '—';
          if (scoreRaw.includes('/') && !scoreRaw.endsWith('/5')) scoreRaw = scoreRaw.split('/')[0] + '/5';
          if (!scoreRaw.includes('/') && scoreRaw !== '—') scoreRaw += '/5';
          const hardReject = Boolean(profileGate?.hardReject);
          let numericScore = parseFloat(scoreRaw);
          if (hardReject && (!Number.isFinite(numericScore) || numericScore > 2)) {
            scoreRaw = '1.0/5';
            numericScore = 1.0;
          }
          const trackerStatus = hardReject ? 'Discarded' : 'Evaluated';
          const trackerNote = hardReject ? profileGate.reasons.join(' ') : '';

          const filename = `${num}-${company}-${today}.md`;

          // Build the full report content
          const reportUrlLine = mode === 'pipeline' && pipelineTarget?.url
            ? `**URL:** ${pipelineTarget.url}\n`
            : '';
          const reportContent = `# Evaluation — ${role}\n\n**Date:** ${today}\n${reportUrlLine}**Score:** ${scoreRaw}\n\n---\n\n${fullResponse}`;

          // ── VALIDATE before writing ──────────────────────────────────────
          const validation = validateReportContent(reportContent, scoreRaw, company, role);

          console.log(`[${mode}] validation: valid=${validation.valid}, reason=${validation.reason || 'none'}`);
          console.log(`[${mode}] parsed: company=${company}, role=${role.slice(0, 40)}, score=${scoreRaw}, status=${trackerStatus}`);
          if (validation.valid) {
            console.log(`[${mode}] writing report → reports/${filename}`);
            await writeFile(join(WRITE_ROOT, `reports/${filename}`), reportContent, 'utf-8');

            // On Vercel, also sync report directly to Supabase (watcher can't run there)
            if (IS_VERCEL && useSupabase) {
              const parts = filename.replace('.md', '').split('-');
              const rNum = parseInt(parts[0], 10);
              const rDate = parts.slice(-3).join('-');
              const rCompany = parts.slice(1, -3).join('-');
              const adminId = await getAdminUserId().catch(() => null);
              const row = { filename, content: reportContent, num: rNum, company: rCompany, date: rDate };
              if (adminId) row.user_id = adminId;
              await supabase.from('reports').upsert(row, { onConflict: 'filename' });
            }

            // TSV entry
            const tsvDir = join(WRITE_ROOT, 'batch/tracker-additions');
            console.log(`[${mode}] writing TSV → batch/tracker-additions/${num}-${company}.tsv`);
            await writeFile(join(tsvDir, `${num}-${company}.tsv`),
              `${parseInt(num)}\t${today}\t${companyMatch?.[1]?.trim() || 'Unknown'}\t${role}\t${trackerStatus}\t${scoreRaw}\t❌\t[${parseInt(num)}](reports/${filename})\t${trackerNote}\n`
            );
            saves.push(`Report saved: ${filename}`);
            if (!IS_VERCEL) {
              const mergeResult = await runScript('merge');
              const summary = mergeResult.stdout.match(/📊 Summary: \+(\d+) added, 🔄(\d+) updated, ⏭️(\d+) skipped/);
              const [, addedCount = '0', updatedCount = '0', skippedCount = '0'] = summary || [];
              if (!mergeResult.ok) {
                console.error(`[${mode}] merge-tracker failed: ${mergeResult.stderr || mergeResult.stdout}`);
                saves.push(`⚠️ Tracker merge FAILED — check server logs (report was saved, but not added to applications.md)`);
              } else if (addedCount !== '0' || updatedCount !== '0') {
                saves.push(`Tracker updated (+${addedCount} added, ${updatedCount} updated)`);
              } else if (skippedCount !== '0') {
                saves.push(`⚠️ Tracker NOT updated — merge-tracker detected this as a duplicate of an existing entry and skipped it (existing score was equal or higher)`);
              } else {
                saves.push(`Tracker updated`);
              }

              // Always push applications.md → Supabase with the request user id.
              // merge-tracker also syncs, but often under the wrong/missing user_id,
              // which made new evaluations invisible in the dashboard list.
              const syncResult = await syncLocalApplicationsToSupabase(req.userId);
              if (!syncResult.ok && !syncResult.skipped) {
                saves.push(`⚠️ Applications list sync failed: ${syncResult.error}`);
              } else if (syncResult.count) {
                saves.push(`Applications list synced (${syncResult.count})`);
              }
            } else {
              // Vercel: write the row directly to Supabase
              const adminId = await getAdminUserId().catch(() => null);
              const uid = req.userId || adminId;
              const row = {
                num: parseInt(num, 10),
                date: today,
                company: companyMatch?.[1]?.trim() || 'Unknown',
                role,
                score: scoreRaw,
                status: trackerStatus,
                pdf: '❌',
                report: `[${parseInt(num, 10)}](reports/${filename})`,
                notes: trackerNote,
              };
              if (uid) row.user_id = uid;
              const { error: appErr } = await supabase.from('applications').upsert(row, { onConflict: 'num' });
              if (appErr) saves.push(`⚠️ Tracker sync failed: ${appErr.message}`);
              else saves.push(`Tracker updated`);
            }

            if (mode === 'pipeline' && pipelineTarget) {
              await removeFromPipeline(pipelineTarget.url, req.userId, { historyStatus: 'evaluated', historyPortal: 'pipeline' });
              saves.push(`Removed URL from pipeline queue`);
            }

          } else {
            // Report failed validation — DO NOT write corrupted file
            console.error(`❌ Report validation failed for ${filename}: ${validation.reason}`);
            saves.push(`⚠️ Report NOT saved — ${validation.reason}`);
            send('warning', { text: `Report not saved: ${validation.reason}. Evaluation must be restarted.` });
          }
        }

        // PDF → automatic generation
        if (mode === 'pdf' && fullResponse.length > 500) {
          try {
            // 1. Extract content from markers
            const getText = (marker) => {
              const regex = new RegExp(`### ${marker}\\s*([\\s\\S]*?)(?=###|$)`, 'i');
              return fullResponse.match(regex)?.[1]?.trim();
            };

            const summary_text = getText('SUMMARY_TEXT');
            const experience = getText('EXPERIENCE');

            if (summary_text && experience) {
              send('status', { text: 'Génération du PDF en cours...' });

              // 2. Load template & sources
              const [template, cvSource] = await Promise.all([
                readFile(join(ROOT, 'templates/cv-template.html'), 'utf-8'),
                getCvMarkdown(req.userId),
              ]);

              // 3. Load normalized contact info via existing utility
              const profileData = await loadCvTemplateData(ROOT);
              const contact = profileData.shared.contact;
              const profileName = contact.name || '';
              const profileEmail = contact.email || '';
              const linkedinUrl = contact.linkedin_url || '';
              const linkedinDisplay = contact.linkedin_display || '';
              const portfolioUrl = contact.portfolio || '';
              const portfolioDisplay = contact.portfolio_display || '';
              const profileLocation = contact.location || '';

              // 4. Populate template
              let html = template
                .replace(/{{LANG}}/g, 'en')
                .replace(/{{PAGE_WIDTH}}/g, '210mm')
                .replace(/{{NAME}}/g, profileName)
                .replace(/{{EMAIL}}/g, profileEmail)
                .replace(/{{LINKEDIN_URL}}/g, linkedinUrl)
                .replace(/{{LINKEDIN_DISPLAY}}/g, linkedinDisplay)
                .replace(/{{PORTFOLIO_URL}}/g, portfolioUrl)
                .replace(/{{PORTFOLIO_DISPLAY}}/g, portfolioDisplay)
                .replace(/{{LOCATION}}/g, profileLocation)
                .replace(/{{SECTION_SUMMARY}}/g, 'Professional Summary')
                .replace(/{{SUMMARY_TEXT}}/g, summary_text)
                .replace(/{{SECTION_COMPETENCIES}}/g, 'Core Competencies')
                .replace(/{{COMPETENCIES}}/g, (getText('COMPETENCIES') || '').replace(/ — /g, ': '))
                .replace(/{{SECTION_EXPERIENCE}}/g, 'Work Experience')
                .replace(/{{EXPERIENCE}}/g, experience)
                .replace(/{{SECTION_PROJECTS}}/g, 'Projects')
                .replace(/{{PROJECTS}}/g, getText('PROJECTS') || '')
                .replace(/{{SECTION_EDUCATION}}/g, 'Education')
                .replace(/{{EDUCATION}}/g, getText('EDUCATION') || '')
                .replace(/{{SECTION_CERTIFICATIONS}}/g, 'Certifications')
                .replace(/{{CERTIFICATIONS}}/g, getText('CERTIFICATIONS') || '')
                .replace(/{{SECTION_SKILLS}}/g, 'Skills')
                .replace(/{{SKILLS}}/g, getText('SKILLS') || '');

              // 5. Paths
              const today = new Date().toISOString().slice(0, 10);
              const companyMatch = fullResponse.match(/Step 10:.*cv-candidate-([a-z0-9-]+)\.html/i) || fullResponse.match(/### COMPANY\s*(.+)/i);
              const companySlug = companyMatch ? (companyMatch[1] || companyMatch[0]).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') : 'custom';
              
              const tempDir = join(WRITE_ROOT, 'batch/temp');
              const htmlPath = join(tempDir, `cv-${companySlug}.html`);
              const nameSlug = profileName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || 'candidate';
              const pdfPath = join(ROOT, `output/cv-${nameSlug}-${companySlug}-${today}.pdf`);

              await writeFile(htmlPath, html, 'utf-8');

              // 6. Generate PDF
              const result = await runScript('pdf-gen', [htmlPath, pdfPath, '--format=a4']);
              if (result.ok) {
                saves.push(`CV PDF généré: ${pdfPath.split('/').pop()}`);
                send('status', { text: 'PDF généré avec succès !' });
              } else {
                console.error('PDF generation failed:', result.stderr);
                send('warning', { text: 'Échec de la génération du PDF (vérifiez les logs).' });
              }
            }
          } catch (e) {
            console.error('Error in PDF post-processing:', e);
          }
        }

        send('done', { ok: true, saves });
      } catch (err) {
        console.error(`[${mode || 'unknown'}] FATAL ERROR: ${err.message}`, err.stack || '');
        send('error', { message: err.message });
      } finally {
        clearInterval(heartbeat);
      }
      res.end();
      return;
    }

    if (path.startsWith('/api/reports/') && method === 'GET') {
      const filename = decodeURIComponent(path.slice('/api/reports/'.length));
      const content = await getReport(filename, req.userId);
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.writeHead(200);
      res.end(content);
      return;
    }

    if (path === '/Hugo_Vermot_CV_Paris.pdf' || path === '/Hugo_Vermot_CV.pdf') {
      try {
        const filename = 'Hugo_Vermot_CV_Paris.pdf';
        const content = await readFile(join(__dirname, filename));
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.writeHead(200);
        res.end(content);
        return;
      } catch { /* fall through to 404 */ }
    }

    if (path.startsWith('/output/') && path.endsWith('.pdf')) {
      const filename = decodeURIComponent(path.slice('/output/'.length));
      try {
        const content = await readFile(join(ROOT, 'output', filename));
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.writeHead(200);
        res.end(content);
        return;
      } catch { /* fall through to 404 */ }
    }

    if (path.startsWith('/images/')) {
      const filename = decodeURIComponent(path.slice('/images/'.length));
      try {
        const imageFile = safeJoin(join(ROOT, 'images'), filename);
        if (!imageFile) { res.writeHead(403); res.end('Forbidden'); return; }
        const content = await readFile(imageFile);
        const ext = filename.split('.').pop().toLowerCase();
        const types = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', mp4: 'video/mp4', webm: 'video/webm', glb: 'model/gltf-binary', gltf: 'model/gltf+json' };
        res.setHeader('Content-Type', types[ext] || 'application/octet-stream');
        // Images & videos are versioned by filename — long-lived cache
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.writeHead(200);
        res.end(content);
        return;
      } catch { /* fall through to 404 */ }
    }

    if (path.match(/\.(jpg|jpeg|png|svg|webp|css|woff2|woff|ttf|otf|mp4|webm)$/)) {
      try {
        // Strip leading slash to join correctly within ROOT
        const decodedPath = decodeURIComponent(path);
        const relPath = decodedPath.startsWith('/') ? decodedPath.slice(1) : decodedPath;
        const fullPath = safeJoin(ROOT, relPath);
        if (!fullPath) { res.writeHead(403); res.end('Forbidden'); return; }
        const content = await readFile(fullPath);
        const ext = decodedPath.split('.').pop().toLowerCase();
        const types = {
          png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
          svg: 'image/svg+xml', webp: 'image/webp',
          css: 'text/css; charset=utf-8',
          woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf',
          mp4: 'video/mp4', webm: 'video/webm'
        };
        res.setHeader('Content-Type', types[ext] || 'application/octet-stream');
        res.setHeader('Cache-Control', ext === 'css' ? 'no-cache' : 'public, max-age=31536000, immutable');
        res.writeHead(200);
        res.end(content);
        return;
      } catch (err) {
        console.error(`Failed to serve static file: ${path}`, err);
        /* fall through to 404 */
      }
    }

    // ── HRHV: Personal HR Agent ────────────────────────────────────────────────
    if (path === '/api/hrhv' && method === 'POST') {
      // Public route (portfolio chatbot) → the only unauthenticated endpoint that
      // spends LLM credits. Per-IP sliding window on top of the per-request caps.
      if (hrhvRateLimited(req)) {
        res.setHeader('Retry-After', String(Math.ceil(HRHV_WINDOW_MS / 1000)));
        res.writeHead(429); res.end('Too many requests'); return;
      }
      const body = await readBody(req);

      // Validate & sanitize messages
      const MAX_TURNS = 10;        // max user messages per session (enforced client-side too)
      const MAX_MSG_CHARS = 400;   // max chars per message
      const HISTORY_WINDOW = 6;    // only send last 6 messages to the LLM

      const rawMessages = Array.isArray(body?.messages) ? body.messages : [];
      if (rawMessages.length > MAX_TURNS * 2) {
        res.writeHead(429); res.end('Too many messages'); return;
      }
      const messages = rawMessages
        .filter(m => m && typeof m.role === 'string' && typeof m.content === 'string')
        .map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content.slice(0, MAX_MSG_CHARS) }))
        .slice(-HISTORY_WINDOW);

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.writeHead(200);

      const send = (evt, data) => res.write(`event: ${evt}\ndata: ${JSON.stringify(data)}\n\n`);
      const heartbeat = setInterval(() => res.write(': ping\n\n'), 20000);
      req.on('close', () => clearInterval(heartbeat));

      try {
        // Only load hrhv.md — it already contains all key facts about Hugo
        const hrhvPrompt = await readFile(join(ROOT, 'modes/hrhv.md'), 'utf-8').catch(() => '');

        for await (const chunk of chatStream({
          model: MODELS.CLAUDE_HAIKU,
          messages,
          systemPrompt: hrhvPrompt,
          temperature: 0.6,
          max_tokens: 512,
        })) {
          send('chunk', { text: chunk });
        }
        send('done', {});
      } catch (err) {
        send('error', { message: err.message });
      } finally {
        clearInterval(heartbeat);
        res.end();
      }
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  } catch (err) {
    console.error(err);
    json(res, { error: err.message }, 500);
  }
});

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', chunk => { stdout += chunk; });
    child.stderr?.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => resolve({ code, stdout, stderr }));
  });
}

async function findListeningPids(port) {
  if (process.platform === 'win32') {
    const result = await runCommand('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `(Get-NetTCPConnection -LocalPort ${Number(port)} -State Listen -ErrorAction SilentlyContinue).OwningProcess`,
    ]);
    return [...new Set(result.stdout.split(/\s+/).map(Number).filter(Number.isInteger))];
  }

  const result = await runCommand('lsof', ['-tiTCP:' + Number(port), '-sTCP:LISTEN']);
  return [...new Set(result.stdout.split(/\s+/).map(Number).filter(Number.isInteger))];
}

async function isCareerOpsServer(pid) {
  if (pid === process.pid) return false;

  if (process.platform === 'win32') {
    const result = await runCommand('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `(Get-CimInstance Win32_Process -Filter \"ProcessId = ${pid}\").CommandLine`,
    ]);
    return /(?:^|[\\/ ])ui[\\/]server\.mjs(?:\s|$)/i.test(result.stdout);
  }

  const result = await runCommand('ps', ['-p', String(pid), '-o', 'command=']);
  return /(?:^|[\\/ ])ui[\\/]server\.mjs(?:\s|$)/i.test(result.stdout);
}

function waitForPortRelease(port, timeoutMs = 8000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const probe = () => {
      const probeServer = createServer();
      probeServer.once('error', err => {
        probeServer.close();
        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error(`Le port ${port} est toujours occupé après l'arrêt de l'ancienne instance.`));
          return;
        }
        setTimeout(probe, 150);
      });
      probeServer.listen(port, '::', () => {
        probeServer.close(() => resolve());
      });
    };
    probe();
  });
}

function listenOnce(port) {
  return new Promise((resolve, reject) => {
    const onError = err => {
      server.removeListener('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port);
  });
}

async function startServer() {
  try {
    await listenOnce(PORT);
  } catch (err) {
    if (err.code !== 'EADDRINUSE') throw err;

    const pids = await findListeningPids(PORT).catch(() => []);
    const oldServers = [];
    for (const pid of pids) {
      if (await isCareerOpsServer(pid).catch(() => false)) oldServers.push(pid);
    }

    if (!oldServers.length) {
      throw new Error(`Le port ${PORT} est déjà utilisé par une autre application.`);
    }

    console.log(`[server] Ancienne instance détectée (${oldServers.join(', ')}), arrêt en cours...`);
    for (const pid of oldServers) {
      try { process.kill(pid, 'SIGTERM'); } catch (killError) {
        if (killError.code !== 'ESRCH') throw killError;
      }
    }
    await waitForPortRelease(PORT);
    await listenOnce(PORT);
  }

  const mode = useSupabase ? 'Supabase' : 'markdown files';
  console.log(`\n  Career Ops UI  →  http://localhost:${PORT}  [${mode}]\n`);

  // Startup maintenance (local only): drop dead offers >20d, then heal apps sync.
  if (!IS_VERCEL) {
    setTimeout(async () => {
      try {
        const purge = await runScript('purge-stale', ['--days=20']);
        if (purge.stdout) console.log(purge.stdout.trim());
        if (!purge.ok) console.warn('[purge] failed:', purge.stderr || purge.error);
      } catch (err) {
        console.warn('[purge] error:', err.message);
      }
      try {
        const sync = await syncLocalApplicationsToSupabase(null);
        if (!sync.ok && !sync.skipped) console.warn('[startup-sync] apps sync failed:', sync.error);
      } catch (err) {
        console.warn('[startup-sync] error:', err.message);
      }
    }, 1500);
  }
}

startServer().catch(err => {
  console.error(`[server] Impossible de démarrer : ${err.message}`);
  process.exitCode = 1;
});

setupGracefulShutdown(server);

// ─── Local watchers (auto-sync → Supabase) ────────────────────────────────────
// Local-dev only: on Vercel the deployment dir is read-only and `reports/` is
// excluded from the bundle, so fs.watch('/var/task/reports') throws ENOENT and
// crashes the function at module load (FUNCTION_INVOCATION_FAILED). Serverless
// functions are ephemeral anyway, so a filesystem watcher would never fire.
//
// Both watchers are required: reports alone made evaluations look "done" in the
// UI while tracker rows stayed invisible until a manual sync or the UI
// oferta/pipeline path called syncLocalApplicationsToSupabase.

if (useSupabase && !IS_VERCEL) {
  const reportsDir = join(ROOT, 'reports');
  const dataDir = join(WRITE_ROOT, 'data');
  const pending = new Set();

  const adminUserIdCache = { value: null };
  async function getWatcherUserId() {
    if (adminUserIdCache.value) return adminUserIdCache.value;
    adminUserIdCache.value = await getAdminUserId().catch(() => null);
    return adminUserIdCache.value;
  }

  async function syncReport(filename) {
    if (!filename.endsWith('.md')) return;
    try {
      const content = await readFile(join(reportsDir, filename), 'utf-8');
      const parts = filename.replace('.md', '').split('-');
      const num = parseInt(parts[0], 10);
      const date = parts.slice(-3).join('-');
      const company = parts.slice(1, -3).join('-');
      const row = { filename, content, num, company, date };
      const userId = await getWatcherUserId();
      if (userId) row.user_id = userId;
      const { error } = await supabase
        .from('reports')
        .upsert(row, { onConflict: 'filename' });
      if (error) throw error;
      console.log(`  ☁️  Report synced → Supabase: ${filename}`);
    } catch (err) {
      console.error(`  ❌  Sync report failed (${filename}):`, err.message);
    }
  }

  watch(reportsDir, (event, filename) => {
    if (!filename || !filename.endsWith('.md')) return;
    // Debounce: fichier souvent écrit en plusieurs passes
    if (pending.has(filename)) return;
    pending.add(filename);
    setTimeout(() => { pending.delete(filename); syncReport(filename); }, 800);
  });

  // Watch the data/ dir (not the file): writeFileAtomic renames a temp file into
  // place, and file-level watches miss that on Windows.
  let appsPending = false;
  watch(dataDir, (event, filename) => {
    if (!filename || filename !== 'applications.md') return;
    if (appsPending) return;
    appsPending = true;
    setTimeout(async () => {
      appsPending = false;
      try {
        const sync = await syncLocalApplicationsToSupabase(null);
        if (!sync.ok && !sync.skipped) {
          console.error(`  ❌  Apps sync failed: ${sync.error}`);
        } else if (sync.count) {
          console.log(`  ☁️  Applications synced → Supabase (${sync.count})`);
        }
      } catch (err) {
        console.error(`  ❌  Apps sync failed: ${err.message}`);
      }
    }, 800);
  });

  console.log(`  👁️  Watching reports/ + data/applications.md for Supabase sync...\n`);
}
