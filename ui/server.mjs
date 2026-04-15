import 'dotenv/config';
import { createServer } from 'http';
import { readFile, writeFile, readdir, stat } from 'fs/promises';
import { watch } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { load as yamlLoad, dump as yamlDump } from 'js-yaml';
import { supabase, isEnabled as useSupabase } from '../lib/supabase.mjs';
import { chatStream, MODELS } from '../lib/openrouter.mjs';
import { loadCvTemplateData } from '../lib/cv-template-data.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PORT = process.env.PORT || 3210;
const activePlaywrightBrowsers = new Set();
let isShuttingDown = false;

function buildPlaywrightResult(company = {}, overrides = {}) {
  return {
    ok: false,
    section: null,
    jobs: [],
    engine: 'playwright',
    company: company.name,
    ...overrides,
  };
}

function markPlaywrightBrowser(browser) {
  if (!browser) return () => {};
  activePlaywrightBrowsers.add(browser);

  const cleanup = () => {
    activePlaywrightBrowsers.delete(browser);
  };

  browser.on?.('disconnected', cleanup);
  return cleanup;
}

function isPlaywrightShutdownError(err) {
  const message = String(err?.message || err || '');
  return /Target page, context or browser has been closed|Target closed|Browser has been closed|browser has been disconnected/i.test(message);
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
      [...activePlaywrightBrowsers].map(browser => browser.close().catch(() => {}))
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

function getMarkdownTableRowNumber(line = '') {
  const match = String(line).match(/^\|\s*([^|]+?)\s*\|/);
  return match ? match[1].trim() : '';
}

function isAppliedStatus(status = '') {
  const s = String(status || '').trim();
  return ['Applied', 'Aplicado', 'Interview', 'Offer', 'Responded'].includes(s);
}

function lineLooksAppliedApplication(line = '') {
  return /\|\s*(Applied|Aplicado|Interview|Offer|Responded)\s*\|\s*(?:✓|✅|❌|—|-)?\s*\|/i.test(String(line || ''));
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

async function enrichApplicationsWithJobUrl(apps) {
  return Promise.all((apps || []).map(async (app) => {
    const existingUrl = app.JobURL ?? app.job_url ?? app.jobUrl ?? '';
    if (existingUrl) return app;

    const reportCell = app.Report ?? app.report ?? '';
    const filename = extractReportFilename(reportCell);
    if (!filename) return app;

    try {
      const reportContent = await getReport(filename);
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

async function getApplications() {
  if (useSupabase) {
    const { data, error } = await supabase
      .from('applications')
      .select('*')
      .order('num', { ascending: true });
    if (error) throw error;
    return enrichApplicationsWithJobUrl(data);
  }
  try {
    const raw = await readFile(join(ROOT, 'data/applications.md'), 'utf-8');
    return enrichApplicationsWithJobUrl(parseMarkdownTable(raw));
  } catch { return []; }
}

async function getPipeline() {
  if (useSupabase) {
    const { data, error } = await supabase
      .from('pipeline')
      .select('*')
      .eq('processed', false)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data || []).map(normalizePipelineItem);
  }
  try {
    const raw = await readFile(join(ROOT, 'data/pipeline.md'), 'utf-8');
    return parsePipeline(raw).map(normalizePipelineItem);
  } catch { return []; }
}

async function getReports() {
  if (useSupabase) {
    const { data, error } = await supabase
      .from('reports')
      .select('filename, num, company, date')
      .order('num', { ascending: false });
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
async function getReport(filename) {
  if (filename.includes('/') || filename.includes('..')) throw new Error('Invalid filename');
  if (useSupabase) {
    const { data, error } = await supabase
      .from('reports')
      .select('content')
      .eq('filename', filename)
      .single();
    if (error) throw error;
    return data.content;
  }
  return readFile(join(ROOT, 'reports', filename), 'utf-8');
}

async function addToPipeline(url, note) {
  if (useSupabase) {
    const { error } = await supabase
      .from('pipeline')
      .upsert({ url, note, processed: false }, { onConflict: 'url' });
    if (error) throw error;
    return;
  }
  const raw = await readFile(join(ROOT, 'data/pipeline.md'), 'utf-8');
  const entry = note ? `${url} — ${note}` : url;
  await writeFile(join(ROOT, 'data/pipeline.md'), raw.trimEnd() + '\n' + entry + '\n', 'utf-8');
}

// ─── Portals (portals.yml) ────────────────────────────────────────────────────

const PORTALS_FILE = join(ROOT, 'portals.yml');
const DIRECT_JOB_FILTER_REGEX = /AI|Product|Manager|Deployed|Solution|Agent|LLM|Automation/i;
const SERPAPI_KEY = process.env.SERPAPI_KEY || process.env.SEARCHAPI_KEY || '';
const DUCKDUCKGO_HTML_SEARCH_URL = 'https://html.duckduckgo.com/html/';

// Circuit breaker: once SearchAPI/SerpApi returns 401 in a scan run, skip it for all remaining queries
let serpApiCircuitOpen = false;
function resetSerpApiCircuit() { serpApiCircuitOpen = false; }
function tripSerpApiCircuit() {
  if (!serpApiCircuitOpen) {
    console.warn('[scan] [circuit-breaker] SearchAPI/SerpApi returned 401 — skipping it for all remaining queries this run');
    serpApiCircuitOpen = true;
  }
}

async function readPortalsYaml() {
  const raw = await readFile(PORTALS_FILE, 'utf-8');
  return { raw, parsed: yamlLoad(raw) };
}

function inferGreenhouseApiUrl(company = {}) {
  if (company.api) return company.api;
  const careersUrl = company.careers_url || '';
  const match = careersUrl.match(/^https:\/\/job-boards(?:\.eu)?\.greenhouse\.io\/([^/?#]+)/i);
  if (!match?.[1]) return '';
  return `https://boards-api.greenhouse.io/v1/boards/${match[1]}/jobs`;
}

function getCompanyScanAccess(company = {}) {
  const apiUrl = inferGreenhouseApiUrl(company);
  if (apiUrl) {
    return {
      mode: 'api',
      apiUrl,
      apiKind: company.api ? 'explicit' : 'derived_greenhouse',
    };
  }

  if ((company.scan_method || '').toLowerCase() === 'websearch' && company.scan_query) {
    return { mode: 'websearch', query: company.scan_query };
  }

  return { mode: 'playwright' };
}

function isAggregatorConfigured(aggregator = {}) {
  const haystack = `${aggregator.name || ''} ${aggregator.notes || ''}`.toLowerCase();
  if (haystack.includes('serpapi')) return Boolean(SERPAPI_KEY);
  if (haystack.includes('searchapi')) return Boolean(process.env.SEARCHAPI_KEY);
  if (haystack.includes('theirstack') || haystack.includes('their stack')) {
    return Boolean(process.env.THEIR_STACK_API_KEY);
  }
  return false;
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
    ambiguousPolicy: cleanString(raw.ambiguous_policy || 'skip').toLowerCase() || 'skip',
  };
}

function candidateRemoteAssessment(candidate = {}, remoteFilterRaw = {}) {
  const remoteFilter = normalizeRemoteFilterConfig(remoteFilterRaw);
  const strictMode = remoteFilter.mode === 'strict_full_remote_only';
  const text = [
    cleanString(candidate.title),
    cleanString(candidate.location),
    cleanString(candidate.remoteEvidence),
    cleanString(candidate.url),
  ].filter(Boolean).join(' | ');
  const lower = text.toLowerCase();

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

  const rejectedMatch = [...remoteFilter.rejectedAny, ...defaultRejectedTerms]
    .map(term => cleanString(term).toLowerCase())
    .find(term => term && lower.includes(term));
  if (rejectedMatch) {
    return { keep: false, reason: `matched rejected remote term "${rejectedMatch}"`, evidence: rejectedMatch };
  }

  const requiredMatch = remoteFilter.requiredAny
    .map(term => cleanString(term).toLowerCase())
    .find(term => term && lower.includes(term));
  if (requiredMatch) {
    return { keep: true, reason: `matched required remote term "${requiredMatch}"`, evidence: requiredMatch };
  }

  if (!strictMode) {
    return { keep: true, reason: 'remote filter not strict', evidence: '' };
  }

  return {
    keep: remoteFilter.ambiguousPolicy !== 'skip',
    reason: 'remote status is ambiguous',
    evidence: '',
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

async function loadPlaywrightChromium() {
  const mod = await import('playwright');
  return mod.chromium;
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

async function fetchSourceSection({ name, url, type }) {
  console.log(`[scan] [${type.toUpperCase()}] Fetching "${name}" → ${url}`);
  let r;
  try {
    r = await fetch(url, { signal: AbortSignal.timeout(10000) });
  } catch (err) {
    console.error(`[scan] [${type.toUpperCase()}] TIMEOUT/ERROR "${name}": ${err.message}`);
    return { ok: false, section: null };
  }
  if (!r.ok) {
    console.error(`[scan] [${type.toUpperCase()}] HTTP ${r.status} "${name}"`);
    return { ok: false, section: null };
  }

  let jobs = [];
  if (type === 'json') {
    const data = await r.json();
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
    console.log(`[scan] [JSON] "${name}" → ${jobs.length} jobs total, ${jobs.filter(j => DIRECT_JOB_FILTER_REGEX.test(j.title)).length} after title filter`);
  } else if (type === 'rss') {
    const txt = await r.text();
    const itemRe = /<item>([\s\S]*?)<\/item>/gi;
    let match;
    while ((match = itemRe.exec(txt)) !== null) {
      const section = match[1];
      const titleMatch = section.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i)
        || section.match(/<title>([\s\S]*?)<\/title>/i);
      const linkMatch = section.match(/<link>([\s\S]*?)<\/link>/i);
      const dateMatch = section.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)
        || section.match(/<published>([\s\S]*?)<\/published>/i)
        || section.match(/<updated>([\s\S]*?)<\/updated>/i)
        || section.match(/<dc:date>([\s\S]*?)<\/dc:date>/i);
      if (titleMatch && linkMatch) {
        jobs.push({
          title: titleMatch[1].trim(),
          url: linkMatch[1].trim(),
          publishedAt: normalizeDateValue(dateMatch?.[1]?.trim() || ''),
        });
      }
    }
    console.log(`[scan] [RSS] "${name}" → ${jobs.length} items, ${jobs.filter(j => DIRECT_JOB_FILTER_REGEX.test(j.title)).length} after title filter`);
  }

  return { ok: true, section: buildJobSection(name, jobs), jobs };
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
    if (r.status === 401 || r.status === 403) tripSerpApiCircuit();
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

  console.log(`[scan] [DuckDuckGo] "${name}" → q: ${query.slice(0, 80)}...`);
  const params = new URLSearchParams({ q: query, kl: 'wt-wt' });
  let r;
  try {
    r = await fetch(`${DUCKDUCKGO_HTML_SEARCH_URL}?${params.toString()}`, {
      signal: AbortSignal.timeout(15000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; career-ops/1.0; +https://career-ops.local)',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
  } catch (err) {
    console.error(`[scan] [DuckDuckGo] TIMEOUT/ERROR "${name}": ${err.message}`);
    return { ok: false, section: null };
  }
  if (!r.ok) {
    console.error(`[scan] [DuckDuckGo] HTTP ${r.status} "${name}"`);
    return { ok: false, section: null };
  }

  const html = await r.text();
  if (/anomaly-modal|Select all squares containing a duck/i.test(html)) {
    console.warn(`[scan] [DuckDuckGo] Challenge page detected for "${name}"`);
    return { ok: false, section: null, jobs: [], engine: 'duckduckgo-html' };
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
  const apiKey = process.env.THEIRSTACK_API_KEY;
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

async function fetchWebSearchSection(source) {
  if (!serpApiCircuitOpen && (SERPAPI_KEY || process.env.SEARCHAPI_KEY)) {
    try {
      const result = await fetchSerpApiSection(source);
      if (result.ok && result.section) return result;
      console.warn(`[scan] [WebSearch] SearchAPI/SerpApi failed for "${source.name}", falling back...`);
    } catch (err) {
      console.warn(`[scan] [WebSearch] SearchAPI/SerpApi threw for "${source.name}": ${err.message}, falling back...`);
    }
  }

  if (process.env.BRAVE_API_KEY) {
    try {
      const result = await fetchBraveSection(source);
      if (result.ok && result.section) return result;
      console.warn(`[scan] [WebSearch] Brave failed for "${source.name}", falling back to DuckDuckGo`);
    } catch (err) {
      console.warn(`[scan] [WebSearch] Brave threw for "${source.name}": ${err.message}, falling back to DuckDuckGo`);
    }
  } else if (!SERPAPI_KEY && !process.env.SEARCHAPI_KEY) {
    console.log(`[scan] [WebSearch] No API key — using DuckDuckGo fallback for "${source.name}"`);
  }

  const duckDuckGoResult = await fetchDuckDuckGoSection(source);
  if (duckDuckGoResult.ok && duckDuckGoResult.section) return duckDuckGoResult;
  if (source?.careers_url) {
    console.warn(`[scan] [WebSearch] Falling back to careers_url Playwright for "${source.name}"`);
    return fetchCareersUrlFallback(source);
  }
  return duckDuckGoResult;
}

async function fetchPlaywrightSections(companies = []) {
  if (!companies.length) return [];
  if (isShuttingDown) {
    return companies.map(company => buildPlaywrightResult(company, {
      error: 'Cancelled because the UI server is restarting or shutting down',
      cancelled: true,
    }));
  }

  let chromium;
  try {
    chromium = await loadPlaywrightChromium();
  } catch (err) {
    console.error(`[scan] [Playwright] Failed to load Playwright: ${err.message}`);
    return companies.map(company => buildPlaywrightResult(company, { error: err.message }));
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (err) {
    console.error(`[scan] [Playwright] Failed to launch Chromium: ${err.message}`);
    return companies.map(company => buildPlaywrightResult(company, { error: err.message }));
  }
  const unmarkBrowser = markPlaywrightBrowser(browser);

  const results = [];
  for (let index = 0; index < companies.length; index += 1) {
    const company = companies[index];
    if (isShuttingDown || !browser.isConnected()) {
      cancelRemainingPlaywrightResults(
        results,
        companies,
        index,
        'Cancelled because the UI server is restarting or the browser disconnected'
      );
      break;
    }

    let page;
    try {
      page = await browser.newPage();
      console.log(`[scan] [Playwright] Fetching "${company.name}" → ${company.careers_url}`);
      await page.goto(company.careers_url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(1200);
      await page.evaluate(async () => {
        for (let i = 0; i < 6; i += 1) {
          window.scrollTo(0, document.body.scrollHeight);
          await new Promise(resolve => setTimeout(resolve, 250));
        }
        window.scrollTo(0, 0);
      });

      const jobs = await page.evaluate(() => {
        const normalizeText = value => String(value || '').replace(/\s+/g, ' ').trim();
        const parseDate = value => {
          const raw = normalizeText(value);
          if (!raw) return '';
          const parsed = new Date(raw);
          return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
        };
        const host = window.location.hostname;
        const navLike = /^(home|jobs|careers|open roles|open positions|learn more|view all|see all|apply now)$/i;
        const isLikelyJobHref = href => /\/job(s)?\/|\/positions?\/|\/open-roles?\/|jobs\.ashbyhq\.com|jobs\.lever\.co|apply\.workable\.com/i.test(href);
        const results = [];
        const seen = new Set();
        const pushJob = entry => {
          const title = normalizeText(entry?.title);
          const url = normalizeText(entry?.url);
          if (!title || !url || navLike.test(title)) return;
          const key = `${url}::${title.toLowerCase()}`;
          if (seen.has(key)) return;
          seen.add(key);
          results.push({
            title,
            url,
            location: normalizeText(entry?.location),
            publishedAt: normalizeText(entry?.publishedAt),
          });
        };

        if (host.includes('jobs.lever.co')) {
          document.querySelectorAll('a.posting, a[href*="jobs.lever.co"]').forEach(anchor => {
            const title = normalizeText(
              anchor.querySelector('h5, h4, [class*="posting-title"]')?.textContent ||
              anchor.textContent
            );
            const location = normalizeText(
              anchor.querySelector('.sort-by-location, [class*="location"]')?.textContent || ''
            );
            pushJob({ title, url: anchor.href, location });
          });
        } else if (host.includes('jobs.ashbyhq.com')) {
          const ashbyMeta = new Map(
            ((window.__appData && window.__appData.jobBoard && window.__appData.jobBoard.jobPostings) || []).map(posting => [
              `${normalizeText(posting.title)}::${normalizeText(posting.locationName)}`,
              {
                location: normalizeText(posting.locationName),
                publishedAt: parseDate(posting.publishedDate || posting.updatedAt || ''),
              },
            ])
          );
          document.querySelectorAll('a[href*="/job/"], a[href*="jobs.ashbyhq.com"]').forEach(anchor => {
            const card = anchor.closest('a, article, li, section, div');
            const title = normalizeText(
              anchor.querySelector('h1, h2, h3, h4, h5, [class*="title"]')?.textContent ||
              anchor.textContent
            );
            const domLocation = normalizeText(
              card?.querySelector('[class*="location"], [data-testid*="location"]')?.textContent || ''
            );
            const meta = ashbyMeta.get(`${title}::${domLocation}`) || ashbyMeta.get(`${title}::`) || null;
            const publishedAt = meta?.publishedAt || parseDate(
              card?.querySelector('time')?.getAttribute('datetime') ||
              card?.querySelector('time')?.textContent ||
              ''
            );
            pushJob({ title, url: anchor.href, location: meta?.location || domLocation, publishedAt });
          });
        } else {
          document.querySelectorAll('a[href]').forEach(anchor => {
            const href = anchor.href || '';
            if (!isLikelyJobHref(href)) return;
            const title = normalizeText(
              anchor.querySelector('h1, h2, h3, h4, h5, [class*="title"]')?.textContent ||
              anchor.textContent
            );
            if (title.length < 4 || title.length > 160) return;
            const card = anchor.closest('a, article, li, section, div');
            const location = normalizeText(
              card?.querySelector('[class*="location"], [data-testid*="location"]')?.textContent || ''
            );
            const publishedAt = parseDate(
              card?.querySelector('time')?.getAttribute('datetime') ||
              card?.querySelector('time')?.textContent ||
              ''
            );
            pushJob({ title, url: href, location, publishedAt });
          });
        }

        return results.map(job => ({
          title: job.location ? `${job.title} (${job.location})` : job.title,
          location: job.location,
          remoteEvidence: job.location,
          url: job.url,
          publishedAt: job.publishedAt,
        }));
      });

      console.log(`[scan] [Playwright] "${company.name}" → ${jobs.length} jobs, ${jobs.filter(j => DIRECT_JOB_FILTER_REGEX.test(j.title)).length} after filter`);
      results.push({
        ok: true,
        section: buildJobSection(company.name, jobs),
        jobs,
        engine: 'playwright',
        company: company.name,
      });
    } catch (err) {
      if (isShuttingDown || isPlaywrightShutdownError(err) || !browser.isConnected()) {
        const reason = isShuttingDown
          ? 'Cancelled because the UI server is restarting or shutting down'
          : 'Cancelled because the Playwright browser was closed during the scan';
        console.warn(`[scan] [Playwright] Stopping "${company.name}": ${reason}`);
        results.push(buildPlaywrightResult(company, {
          error: reason,
          cancelled: true,
        }));
        cancelRemainingPlaywrightResults(results, companies, index + 1, reason);
        break;
      }

      console.error(`[scan] [Playwright] Failed "${company.name}": ${err.message}`);
      results.push(buildPlaywrightResult(company, { error: err.message }));
    } finally {
      await page?.close().catch(() => {});
    }
  }

  unmarkBrowser();
  await browser.close().catch(() => {});
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
  list.push(entry);
  parsed.tracked_companies = list;
  await writeFile(PORTALS_FILE, yamlDump(parsed, { lineWidth: 120, quotingType: '"' }), 'utf-8');
}

async function updatePortal(originalName, company) {
  const { parsed } = await readPortalsYaml();
  const list = parsed.tracked_companies || [];
  const idx = list.findIndex(c => c.name === originalName);
  if (idx === -1) throw new Error('Company not found');
  const entry = { name: company.name, careers_url: company.careers_url, enabled: company.enabled !== false };
  if (company.api)         entry.api = company.api;
  if (company.scan_method) entry.scan_method = company.scan_method;
  if (company.scan_query)  entry.scan_query = company.scan_query;
  if (company.notes)       entry.notes = company.notes;
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

const SCAN_STATE_FILE      = join(ROOT, 'data/scan-state.json');
const SCAN_SELECTION_FILE  = join(ROOT, 'data/scan-selection.json');

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
        lastScanned: scanState[c.name] || null,
      };
    });
  const rss = (parsed.rss_feeds || [])
    .filter(r => r.enabled !== false)
    .map(r => ({ name: r.name, lastScanned: scanState[r.name] || null }));
  const queries = [...(parsed.search_queries || []), ...(parsed.eu_job_boards || [])]
    .filter(q => q.enabled !== false)
    .map(q => ({ name: q.name, lastScanned: scanState[q.name] || null }));
  const aggregators = (parsed.api_aggregators || [])
    .filter(a => a.enabled !== false)
    .map(a => ({
      name: a.name,
      configured: isAggregatorConfigured(a),
      requiresKey: true,
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
  const scanHistoryFile = join(ROOT, 'data/scan-history.tsv');
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

async function appendScanHistoryEntries(entries = []) {
  if (!entries.length) return;
  const scanHistoryFile = join(ROOT, 'data/scan-history.tsv');
  const existingRows = await getScanHistoryRows();
  const payload = `${existingRows.join('\n').replace(/\n+$/,'')}\n${entries.join('\n')}\n`;
  await writeFile(scanHistoryFile, payload, 'utf-8');
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

async function getProfile() {
  const raw = await readFile(PROFILE_FILE, 'utf-8');
  return yamlLoad(raw);
}

async function saveProfile(data) {
  await writeFile(PROFILE_FILE, yamlDump(data, { lineWidth: 120, quotingType: '"' }), 'utf-8');
}

async function getProfileContext() {
  return readFile(PROFILE_CONTEXT_FILE, 'utf-8').catch(() => '');
}

async function saveProfileContext(markdown = '') {
  const normalized = String(markdown ?? '').replace(/\r\n/g, '\n');
  await writeFile(PROFILE_CONTEXT_FILE, normalized, 'utf-8');
}

async function saveProfileBundle(payload = {}) {
  const profile = payload?.profile ?? payload;
  const hasContext = Object.prototype.hasOwnProperty.call(payload || {}, 'context_markdown');

  if (!hasContext) {
    await saveProfile(profile);
    return;
  }

  const previousProfile = await readFile(PROFILE_FILE, 'utf-8').catch(() => null);
  const previousContext = await readFile(PROFILE_CONTEXT_FILE, 'utf-8').catch(() => null);
  const nextProfile = yamlDump(profile, { lineWidth: 120, quotingType: '"' });
  const nextContext = String(payload?.context_markdown ?? '').replace(/\r\n/g, '\n');

  try {
    await writeFile(PROFILE_FILE, nextProfile, 'utf-8');
    await writeFile(PROFILE_CONTEXT_FILE, nextContext, 'utf-8');
  } catch (error) {
    if (previousProfile !== null) {
      await writeFile(PROFILE_FILE, previousProfile, 'utf-8').catch(() => {});
    }
    if (previousContext !== null) {
      await writeFile(PROFILE_CONTEXT_FILE, previousContext, 'utf-8').catch(() => {});
    }
    throw error;
  }
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

async function removeFromPipeline(url) {
  if (useSupabase) {
    const { error } = await supabase
      .from('pipeline')
      .update({ processed: true })
      .eq('url', url);
    if (error) console.error('Supabase update error:', error);
    // Don't return here! Fall through to sync local file as well
  }
  const raw = await readFile(join(ROOT, 'data/pipeline.md'), 'utf-8');
  const updated = raw
    .split('\n')
    .filter(l => {
      const trimmed = l.trim();
      // Remove line if it contains the URL directly or if the URL part within markers matches
      const cleanUrlOnLine = trimmed.replace(/^[-*+]\s*(\[[ xX]\]\s*)?/, '').trim().split(/\s+(?:[—–|]|-(?!\s*[\w]))\s+/)[0];
      return cleanUrlOnLine !== url && !trimmed.startsWith(url) && !trimmed.includes(url);
    })
    .join('\n');
  await writeFile(join(ROOT, 'data/pipeline.md'), updated, 'utf-8');
}

// ─── Script runner ────────────────────────────────────────────────────────────

const ALLOWED_SCRIPTS = {
  'merge':     'node merge-tracker.mjs',
  'normalize': 'node normalize-statuses.mjs',
  'dedup':     'node dedup-tracker.mjs',
  'verify':    'node verify-pipeline.mjs',
  'verify-reports': 'node verify-reports.mjs',
  'sync-check':'node cv-sync-check.mjs',
  'pdf-gen':   'node generate-pdf.mjs',
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

  // Check 4: Must have at least 2 structured sections (A-F blocks)
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

  // 2. Process IF blocks (with {{else}} support)
  pos = 0;
  while ((pos = res.indexOf('{{#if')) !== -1) {
    const endOpen = res.indexOf('}}', pos);
    const path = res.slice(pos + 5, endOpen).trim();
    const closePos = tplFindClosingTag(res, '{{#if', '{{/if}}', endOpen + 2);
    if (closePos === -1) break;
    const inner = res.slice(endOpen + 2, closePos);
    const val = tplGetValue(context, path, globalData);
    const truthy = val && (!Array.isArray(val) || val.length > 0);
    const elseIdx = inner.indexOf('{{else}}');
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
async function renderPremiumCV(profileKey = 'ai_builder', tailoredData = {}) {
  const templateContent = await readFile(join(ROOT, 'templates/premium-cv.html'), 'utf-8');
  const data = await loadCvTemplateData(ROOT, profileKey, tailoredData);

  let html = tplRender(templateContent, data, data);

  // Inject preview download bar
  const pdfFilename = `Hugo_Vermot_CV_${profileKey}.pdf`;
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
  <a href="/output/${pdfFilename}" download="${pdfFilename}">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
    Download PDF
  </a>
</div>`;
  html = html.replace('<body>', `<body>\n${downloadBar}`);
  return html;
}

async function renderBaseCV(profileKey = 'ai_builder') {
  const [template, cvSource, data] = await Promise.all([
    readFile(join(ROOT, 'templates/cv-template.html'), 'utf-8'),
    readFile(join(ROOT, 'cv.md'), 'utf-8'),
    loadCvTemplateData(ROOT, profileKey)
  ]);

  const email = cvSource.match(/Email:\*\*\s*([^\s\n]+)/)?.[1] || data.shared.contact.email;
  const linkedin = cvSource.match(/LinkedIn:\*\*\s*\[([^\]]+)\]\(([^)]+)\)/);
  
  // Base template uses flat {{VAR}} syntax
  let html = template
    .replace(/{{LANG}}/g, 'en')
    .replace(/{{PAGE_WIDTH}}/g, '210mm')
    .replace(/{{NAME}}/g, data.shared.contact.name || 'Hugo Vermot')
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

// ─── Server ───────────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://localhost:${PORT}`);
  const path = urlObj.pathname;
  const method = req.method;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  try {
    // Static files
    if (path === '/' || path === '/index.html') {
      const html = await readFile(join(__dirname, 'index.html'), 'utf-8');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.writeHead(200);
      res.end(html);
      return;
    }

    if (path === '/portfolio' || path === '/portfolio.html') {
      const html = await readFile(join(__dirname, 'portfolio.html'), 'utf-8');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.writeHead(200);
      res.end(html);
      return;
    }

    if (path.startsWith('/covers/') && path.match(/\.jpe?g$/i)) {
      try {
        const file = await readFile(join(__dirname, decodeURIComponent(path)));
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.writeHead(200);
        res.end(file);
        return;
      } catch { /* fall through to 404 */ }
    }

    // API routes
    if (path === '/api/applications' && method === 'GET') {
      return json(res, await getApplications());
    }

    if (path.startsWith('/api/applications/') && method === 'PATCH') {
      const num = decodeURIComponent(path.slice('/api/applications/'.length));
      const { status } = await readBody(req);
      if (!status) return json(res, { error: 'status is required' }, 400);
      if (useSupabase) {
        const { error } = await supabase
          .from('applications')
          .update({ status })
          .eq('num', Number(num));
        if (error) return json(res, { error: error.message }, 500);

        // Also update applications.md to keep it in sync with Supabase
        try {
          const appFile = join(ROOT, 'data/applications.md');
          const raw = await readFile(appFile, 'utf-8');
          const newLines = raw.split('\n').map(line => {
            if (!line.trim().startsWith('|')) return line;
            const rowNum = getMarkdownTableRowNumber(line);
            if (!rowNum || rowNum === '#' || rowNum !== String(num)) return line;
            const cells = line.split('|');
            if (cells.length < 7) return line;
            cells[6] = ` ${status} `;
            return cells.join('|');
          });
          await writeFile(appFile, newLines.join('\n'), 'utf-8');
        } catch { /* applications.md may not exist, ignore */ }

        return json(res, { ok: true });
      }
      const appFile = join(ROOT, 'data/applications.md');
      const raw = await readFile(appFile, 'utf-8');
      const lines = raw.split('\n');
      let updated = false;
      const newLines = lines.map(line => {
        if (!line.trim().startsWith('|')) return line;
        const rowNum = getMarkdownTableRowNumber(line);
        if (!rowNum || rowNum === '#') return line;
        const cells = line.split('|');
        if (cells.length < 7) return line;
        if (rowNum !== String(num)) return line;
        cells[6] = ` ${status} `;
        updated = true;
        return cells.join('|');
      });
      if (!updated) return json(res, { error: 'Application not found' }, 404);
      await writeFile(appFile, newLines.join('\n'), 'utf-8');
      return json(res, { ok: true });
    }

    if (path.startsWith('/api/applications/') && method === 'DELETE') {
      const num = decodeURIComponent(path.slice('/api/applications/'.length));
      if (useSupabase) {
        const { data: existing, error: fetchError } = await supabase
          .from('applications')
          .select('*')
          .eq('num', Number(num))
          .maybeSingle();
        if (fetchError) return json(res, { error: fetchError.message }, 500);
        if (!existing) return json(res, { error: 'Application not found' }, 404);
        if (isAppliedStatus(existing.status)) {
          return json(res, { error: 'Applied applications cannot be deleted' }, 409);
        }

        const { error } = await supabase
          .from('applications')
          .delete()
          .eq('num', Number(num));
        if (error) return json(res, { error: error.message }, 500);

        // Also remove from applications.md so merge-tracker doesn't re-add it
        try {
          const appFile = join(ROOT, 'data/applications.md');
          const raw = await readFile(appFile, 'utf-8');
          const newLines = raw.split('\n').filter(line => {
            if (!line.trim().startsWith('|')) return true;
            const rowNum = getMarkdownTableRowNumber(line);
            return !rowNum || rowNum === '#' || rowNum !== String(num);
          });
          await writeFile(appFile, newLines.join('\n'), 'utf-8');
        } catch { /* applications.md may not exist, ignore */ }

        // Add to scan-history so future scans skip it
        const jobUrl = existing.job_url ?? existing.JobURL ?? existing.report;
        if (jobUrl && jobUrl.startsWith('http')) {
          const today = new Date().toISOString().slice(0, 10);
          await appendScanHistoryEntries([`${jobUrl}\t${today}\t—\t(deleted)\t—\tdeleted`]).catch(() => {});
        }
        return json(res, { ok: true });
      }

      const appFile = join(ROOT, 'data/applications.md');
      const raw = await readFile(appFile, 'utf-8');
      const lines = raw.split('\n');
      const targetLine = lines.find(line => getMarkdownTableRowNumber(line) === String(num));
      if (!targetLine) return json(res, { error: 'Application not found' }, 404);
      if (lineLooksAppliedApplication(targetLine)) {
        return json(res, { error: 'Applied applications cannot be deleted' }, 409);
      }

      // Extract report filename from the row (column format: [num](reports/xxx.md))
      const reportMatch = targetLine.match(/\[[\d]+\]\(reports\/([^)]+\.md)\)/);
      if (reportMatch) {
        try {
          const reportContent = await readFile(join(ROOT, 'reports', reportMatch[1]), 'utf-8');
          const urlMatch = reportContent.match(/^\*\*URL:\*\*\s*(.+)$/m);
          if (urlMatch) {
            const jobUrl = urlMatch[1].trim();
            const today = new Date().toISOString().slice(0, 10);
            await appendScanHistoryEntries([`${jobUrl}\t${today}\t—\t(deleted)\t—\tdeleted`]);
          }
        } catch { /* report may not exist, skip silently */ }
      }

      let deleted = false;
      const newLines = lines.filter(line => {
        if (!line.trim().startsWith('|')) return true;
        const rowNum = getMarkdownTableRowNumber(line);
        if (!rowNum || rowNum === '#') return true;
        if (rowNum !== String(num)) return true;
        deleted = true;
        return false;
      });

      if (!deleted) return json(res, { error: 'Application not found' }, 404);
      await writeFile(appFile, newLines.join('\n'), 'utf-8');
      return json(res, { ok: true });
    }

    if (path === '/api/pipeline') {
      if (method === 'GET') return json(res, await getPipeline());
      if (method === 'POST') {
        const { url, note } = await readBody(req);
        if (!url?.startsWith('http')) return json(res, { error: 'Invalid URL' }, 400);
        await addToPipeline(url, note || '');
        return json(res, { ok: true });
      }
      if (method === 'DELETE') {
        const { url } = await readBody(req);
        await removeFromPipeline(url);
        return json(res, { ok: true });
      }
    }

    if (path === '/api/reports' && method === 'GET') {
      return json(res, await getReports());
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
        const profileKey = urlParams.get('profile') || 'ai_builder';
        const renderedContent = await renderPremiumCV(profileKey);

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
      if (method === 'GET') return json(res, await getProfile());
      if (method === 'PUT') {
        const body = await readBody(req);
        await saveProfileBundle(body);
        return json(res, { ok: true });
      }
    }

    if (path === '/api/profile/context') {
      if (method === 'GET') return json(res, { markdown: await getProfileContext() });
      if (method === 'PUT') {
        const body = await readBody(req);
        await saveProfileContext(body?.markdown ?? '');
        return json(res, { ok: true });
      }
    }

    if (path.startsWith('/api/run/') && method === 'POST') {
      const script = path.slice('/api/run/'.length);
      const result = await runScript(script);
      return json(res, result, result.ok ? 200 : 500);
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

      const html = await renderPremiumCV('ai_builder', tailoredData);
      const htmlPath = join(ROOT, 'batch/temp', `cv-${companySlug}.html`);
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
      const profileData = await getProfile().catch(() => ({}));
      const today = new Date().toISOString().slice(0, 10);
      const companySlug = slugify(company);
      const roleSlug = slugify(role).slice(0, 40);
      const baseName = `cover-letter-${companySlug}-${roleSlug}-${today}`;
      const htmlPath = join(ROOT, 'batch/temp', `${baseName}.html`);
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
          readFile(join(ROOT, 'cv.md'), 'utf-8').catch(() => ''),
          readFile(join(ROOT, 'modes/_profile.md'), 'utf-8').catch(() => ''),
          readFile(join(ROOT, 'config/profile.yml'), 'utf-8').catch(() => ''),
          readFile(join(ROOT, 'data/applications.md'), 'utf-8').catch(() => ''),
          readFile(join(ROOT, 'data/pipeline.md'), 'utf-8').catch(() => ''),
          readFile(join(ROOT, 'article-digest.md'), 'utf-8').catch(() => ''),
        ]);

        // ── Pre-fetch for scan & pipeline ───
        const profileStruct = profileConfig ? (yamlLoad(profileConfig) || {}) : {};
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
          send('status', { text: 'Fetching direct scan sources...' });
          const { parsed: portalsConfig } = await readPortalsYaml();
          const selection = await getScanSelection();
          // sel = null means scan all enabled sources
          const sel = selection && !selection.all ? selection : null;

          const inSel = (key, name) => !sel || (sel[key]?.includes(name));

          // ── Direct fetch sources (Greenhouse API + RSS) ───────────────────
          const directSources = [];
          const webSearchSources = [];
          const playwrightCos = [];
          const selectedCompanies = (portalsConfig.tracked_companies || [])
            .filter(c => c.enabled !== false && inSel('companies', c.name));

          selectedCompanies.forEach(company => {
            const access = getCompanyScanAccess(company);
            if (access.mode === 'api' && access.apiUrl) {
              directSources.push({ name: company.name, url: access.apiUrl, type: 'json' });
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

          const allQueries = [...(portalsConfig.search_queries || []), ...(portalsConfig.eu_job_boards || [])];
          allQueries
            .filter(q => q.enabled !== false && inSel('queries', q.name))
            .forEach(q => webSearchSources.push({ name: q.name, query: q.query }));

          const selectedAggregators = (portalsConfig.api_aggregators || [])
            .filter(a => a.enabled !== false && inSel('aggregators', a.name));
          const runnableAggregators = selectedAggregators
            .filter(aggregator => /theirstack/i.test(aggregator.name || ''));
          const scannedSourceNames = [
            ...directSources.map(source => source.name),
            ...webSearchSources.map(source => source.name),
            ...playwrightCos.map(company => company.name),
            ...runnableAggregators.map(aggregator => aggregator.name),
          ];

          const directResults = await Promise.allSettled(directSources.map(source => fetchSourceSection(source)));
          const serpApiConfigured = Boolean(SERPAPI_KEY || process.env.SEARCHAPI_KEY);
          const webSearchResults = await Promise.allSettled(webSearchSources.map(source => fetchWebSearchSection(source)));
          const playwrightResults = await fetchPlaywrightSections(playwrightCos);
          const aggregatorResults = await Promise.allSettled(runnableAggregators.map(aggregator =>
            fetchTheirStackSection(aggregator, portalsConfig)
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
                ? buildScanCandidateRecords(directSources[index]?.name, result.value.jobs)
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
          // Filter out URLs already in pipeline, scan-history, or reports (before Claude sees them)
          {
            const [existingPipeline, existingHistory, existingReports] = await Promise.all([
              getPipeline().catch(() => []),
              getScanHistoryUrlSet().catch(() => new Set()),
              getReportUrlSet().catch(() => new Set()),
            ]);
            const knownNormalized = new Set([
              ...existingPipeline.map(e => normalizeUrlKey(String(e?.url || ''))).filter(Boolean),
              ...[...existingHistory].map(u => normalizeUrlKey(u)).filter(Boolean),
              ...[...existingReports].map(u => normalizeUrlKey(u)).filter(Boolean),
            ]);
            const beforeCount = verifiedCandidates.length;
            const freshCandidates = verifiedCandidates.filter(c => {
              const key = c.normalizedUrl || normalizeUrlKey(c.url);
              return key && !knownNormalized.has(key);
            });
            const skippedCount = beforeCount - freshCandidates.length;
            if (skippedCount > 0) {
              console.log(`[scan] [pre-dedup] ${skippedCount} already-known URL(s) removed before manifest (pipeline/history/reports)`);
            }
            scanCandidates = freshCandidates;
          }

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
          const pipe = await getPipeline();
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

          // JS-rendered job boards (Greenhouse embeds, Lever, Ashby, Workday, etc.)
          // need Playwright — a plain fetch() returns empty shell HTML
          const JS_RENDERED_PATTERNS = [
            /[?&]gh_jid=/i,           // Greenhouse embedded widget
            /jobs\.greenhouse\.io/i,
            /job-boards\.greenhouse\.io/i,
            /jobs\.lever\.co/i,
            /jobs\.ashbyhq\.com/i,
            /apply\.workable\.com/i,
            /careers\.smartrecruiters\.com/i,
            /boards\.eu\.greenhouse\.io/i,
          ];
          const needsPlaywright = JS_RENDERED_PATTERNS.some(p => p.test(pipelineTarget.url));

          const extractTextFromHtml = html =>
            html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
                .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
                .replace(/<[^>]+>/g, ' ')
                .replace(/\s+/g, ' ').trim();

          if (needsPlaywright) {
            try {
              const chromium = await loadPlaywrightChromium();
              const browser = await chromium.launch({ headless: true });
              const unmark = markPlaywrightBrowser(browser);
              try {
                const page = await browser.newPage();
                await page.goto(pipelineTarget.url, { waitUntil: 'networkidle', timeout: 25000 });
                await page.waitForTimeout(1500);
                const html = await page.content();
                const textContent = extractTextFromHtml(html);
                prefetchData = `## Job Description from ${pipelineTarget.url}\n${pipelineTarget.note ? `Context note: ${pipelineTarget.note}\n` : ''}\n${textContent.slice(0, 15000)}`;
                console.log(`[pipeline] [Playwright] fetched ${textContent.length} chars for ${pipelineTarget.url}`);
              } finally {
                await browser.close().catch(() => {});
                unmark();
              }
            } catch (err) {
              console.warn(`[pipeline] [Playwright] failed for ${pipelineTarget.url}: ${err.message}`);
              prefetchData = `## Job Description from ${pipelineTarget.url}\nFailed to load content (${err.message}). Assess based on URL and Note: ${pipelineTarget.note || 'None'}`;
            }
          } else {
            try {
              const r = await fetch(pipelineTarget.url, { signal: AbortSignal.timeout(10000) });
              if (r.ok) {
                const html = await r.text();
                const textContent = extractTextFromHtml(html);
                prefetchData = `## Job Description from ${pipelineTarget.url}\n${pipelineTarget.note ? `Context note: ${pipelineTarget.note}\n` : ''}\n${textContent.slice(0, 15000)}`;
              } else {
                prefetchData = `## Job Description from ${pipelineTarget.url}\nFailed to load content (Status ${r.status}). Assess based on URL and Note: ${pipelineTarget.note || 'None'}`;
              }
            } catch (err) {
              prefetchData = `## Job Description from ${pipelineTarget.url}\nFailed to load content (${err.message}). Assess based on URL and Note: ${pipelineTarget.note || 'None'}`;
            }
          }
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
          const applications = await getApplications();
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
            reportContent = await getReport(reportFilename);
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
              const r = await fetch(jobUrl, { signal: AbortSignal.timeout(10000) });
              if (r.ok) {
                const html = await r.text();
                rawJD = html
                  .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
                  .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
                  .replace(/<[^>]+>/g, ' ')
                  .replace(/\s+/g, ' ').trim()
                  .slice(0, 12000);
              }
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
        const parts = [
          `## CV du candidat\n${cv}`,
          `## Profil personnalisé\n${profile}`,
          `## Profil structuré (config/profile.yml)\n${profileConfig}`,
          `## Critères de matching dérivés du profil\n${profileCriteriaBlock}`,
          `## Tracker actuel\n${apps}`,
          `## Pipeline actuel\n${pipeline}`,
        ];
        if (articleDigest) parts.push(`## Proof points détaillés (article-digest.md)\n${articleDigest}`);
        if (prefetchData) parts.push(`## Offres récupérées en direct\n${prefetchData}`);
        if (mode === 'scan') {
          parts.push(`---\nRÈGLES STRICTES :
1. Travaille UNIQUEMENT avec les offres présentes dans "## Offres récupérées en direct" ci-dessus. N'invente PAS d'offres et n'ajoute pas d'URL qui n'apparaît pas déjà dans ces sections.
1b. La section "## Candidate Roster" est la source de vérité la plus fiable. Si tu gardes une offre, son URL doit apparaître telle quelle dans cette section.
1c. Pour le remote: garde UNIQUEMENT les offres avec preuve EXPLICITE de remote dans les données récupérées. Si le remote est "probable", "compatible", "à confirmer", "remote-friendly", ou simplement supposé, EXCLUS l'offre.
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
- garde le format A-F suffisamment structuré pour que le report reste exploitable
- conclusion explicite: HARD PASS / DO NOT APPLY`);
          } else {
            parts.push(`---\nExécute l'évaluation complète (mode oferta) sur l'offre récupérée ci-dessus. L'URL est ${pipelineTarget.url}. Vérifie l'offre contre TOUS les critères dérivés du profil avant de scorer. Si une contrainte dure du profil est violée, rejette l'offre immédiatement. Génère directement le rapport final de A à F avec le bon format. Ne mentionne pas tes actions au préalable, sois direct et commence avec "# Evaluation: {Company} — {Role}".`);
          }
        } else if (mode === 'apply') {
          parts.push(`---\nTu démarres le mode apply pour une offre déjà sélectionnée. Utilise le report complet fourni ci-dessus pour préparer un starter pack d'application: résumé ciblé de l'offre, 3-5 angles forts à réutiliser, pièces à joindre, valeurs probables pour les champs standards (salaire, préavis, visa/remote) basées sur profile.yml si disponibles, puis une liste concise de ce qu'il faut partager ensuite (screenshot ou copier-coller des questions). N'invente aucun champ de formulaire non visible et ne prétends pas voir le formulaire tant qu'il n'a pas été fourni.`);
        } else if (mode === 'question') {
          const userQuestion = urlObj.searchParams.get('question')?.trim() || '';
          parts.push(`---
Tu dois répondre à une question de formulaire de candidature pour l'offre ci-dessus.

**Question posée dans le formulaire :**
${userQuestion || '(aucune question fournie — demande à l\'utilisateur de la préciser)'}

SOURCES À UTILISER (par ordre de priorité) :
1. Le report d'évaluation ci-dessus — blocs B (proof points calés sur la JD), F (STAR stories), G (drafts si présents)
2. article-digest.md — proof points détaillés avec métriques réelles
3. cv.md — expériences, projets, stack
4. _profile.md — archétypes, narrative de transition, avantage distinctif, style de travail, scripts de négociation
5. profile.yml — données factuelles (salaire cible, remote, notice period, localisation)

RÈGLES DE COPYWRITING :
1. Première personne, voix active — aucun passif.
2. 2–5 phrases max sauf si la question demande clairement plus (ex: "décrivez un projet en détail").
3. Lead avec un fait concret ou une métrique — JAMAIS "Je suis passionné par…" ou "I would love the opportunity to…".
4. Ancre dans le spécifique : cite quelque chose de précis du JD/report ET un proof point réel du candidat.
5. Ton "I'm choosing you" : confiant, direct, pas arrogant. On postule parce qu'on a analysé et que ça matche — pas par désespoir.
6. Adapte l'archétype au contexte du rôle (cf. _profile.md section "Framing Adaptatif").
7. Langue = celle de la question (FR si FR, EN si EN).
8. Zéro corporate speak, zéro filler, zéro générique.
9. N'invente aucune expérience ni métrique — si un gap existe, contourne intelligemment.

CLASSIFICATION DE LA QUESTION :
- Motivation ("Pourquoi nous / ce rôle ?") → signal spécifique de l'offre + proof point qui y mappe directement
- Expérience / projet → une STAR story du report bloc F réduite à 2 phrases (situation + résultat chiffré)
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
        let fullResponse = '';
        try {
          for await (const chunk of chatStream({
            model: MODELS.GPT4_1_MINI,
            messages: [{ role: 'user', content: parts.join('\n\n') }],
            systemPrompt,
            max_tokens: 8192,
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
          const currentPipeline = await getPipeline().catch(() => []);
          const existingPipelineUrls = new Set(
            currentPipeline
              .map(entry => String(entry?.url || '').trim())
              .filter(Boolean)
          );
          const existingHistoryUrls = await getScanHistoryUrlSet().catch(() => new Set());
          const existingReportUrls = await getReportUrlSet().catch(() => new Set());
          const isKnown = (url) => existingPipelineUrls.has(url) || existingHistoryUrls.has(url) || existingReportUrls.has(url);
          const newEntries = validParsed.filter(({ url }) => !isKnown(url));
          const duplicateEntries = validParsed.filter(({ url }) => isKnown(url));

          if (newEntries.length) {
            await Promise.all(newEntries.map(({ url, note }) => addToPipeline(url, note)));
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
            await writeFile(join(ROOT, `reports/${filename}`), reportContent, 'utf-8');

            // TSV entry
            const tsvDir = join(ROOT, 'batch/tracker-additions');
            console.log(`[${mode}] writing TSV → batch/tracker-additions/${num}-${company}.tsv`);
            await writeFile(join(tsvDir, `${num}-${company}.tsv`),
              `${parseInt(num)}\t${today}\t${companyMatch?.[1]?.trim() || 'Unknown'}\t${role}\t${trackerStatus}\t${scoreRaw}\t❌\t[${parseInt(num)}](reports/${filename})\t${trackerNote}\n`
            );
            await runScript('merge');
            saves.push(`Report saved: ${filename}`);
            saves.push(`Tracker updated`);

            if (mode === 'pipeline' && pipelineTarget) {
              await removeFromPipeline(pipelineTarget.url);
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
                readFile(join(ROOT, 'cv.md'), 'utf-8'),
              ]);

              // 3. Extract profile info from cv.md
              const email = cvSource.match(/Email:\*\*\s*([^\s\n]+)/)?.[1] || 'chilka.v@gmail.com';
              const linkedin = cvSource.match(/LinkedIn:\*\*\s*\[([^\]]+)\]\(([^)]+)\)/);
              
              // 4. Populate template
              let html = template
                .replace(/{{LANG}}/g, 'en')
                .replace(/{{PAGE_WIDTH}}/g, '210mm')
                .replace(/{{NAME}}/g, 'Hugo Vermot')
                .replace(/{{EMAIL}}/g, email)
                .replace(/{{LINKEDIN_URL}}/g, linkedin?.[2] || '')
                .replace(/{{LINKEDIN_DISPLAY}}/g, linkedin?.[1] || '')
                .replace(/{{PORTFOLIO_URL}}/g, 'https://www.figma.com/deck/EtKxJy1KsPXtr7nUhYSp1B/PRESENTATION?node-id=19-1888&viewport=-100%2C-23%2C0.48&t=3HnbXZU4NVQcKZXJ-1&scaling=min-zoom&content-scaling=fixed&page-id=0%3A1')
                .replace(/{{PORTFOLIO_DISPLAY}}/g, 'figma.com/deck/EtKxJy1KsPXtr7nUhYSp1B/PRESENTATION')
                .replace(/{{LOCATION}}/g, 'Based in Paris & Bangkok')
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
              
              const tempDir = join(ROOT, 'batch/temp');
              const htmlPath = join(tempDir, `cv-${companySlug}.html`);
              const pdfPath = join(ROOT, `output/cv-hugo-vermot-${companySlug}-${today}.pdf`);

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
      const content = await getReport(filename);
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.writeHead(200);
      res.end(content);
      return;
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
        const content = await readFile(join(ROOT, 'images', filename));
        const ext = filename.split('.').pop().toLowerCase();
        const types = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml' };
        res.setHeader('Content-Type', types[ext] || 'application/octet-stream');
        res.writeHead(200);
        res.end(content);
        return;
      } catch { /* fall through to 404 */ }
    }

    if (path.match(/\.(jpg|png|woff2)$/)) {
      try {
        // Strip leading slash to join correctly within ROOT
        const decodedPath = decodeURIComponent(path);
        const relPath = decodedPath.startsWith('/') ? decodedPath.slice(1) : decodedPath;
        const fullPath = join(ROOT, relPath);
        const content = await readFile(fullPath);
        const ext = decodedPath.split('.').pop().toLowerCase();
        const types = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', woff2: 'font/woff2' };
        res.setHeader('Content-Type', types[ext] || 'application/octet-stream');
        res.writeHead(200);
        res.end(content);
        return;
      } catch (err) {
        console.error(`Failed to serve static file: ${path}`, err);
        /* fall through to 404 */ 
      }
    }

    // ── HRHV: Agent RH de Hugo Vermot ─────────────────────────────────────────
    if (path === '/api/hrhv' && method === 'POST') {
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

server.listen(PORT, () => {
  const mode = useSupabase ? 'Supabase' : 'markdown files';
  console.log(`\n  Career Ops UI  →  http://localhost:${PORT}  [${mode}]\n`);
});

setupGracefulShutdown(server);

// ─── Reports watcher (auto-sync nouveaux rapports → Supabase) ─────────────────

if (useSupabase) {
  const reportsDir = join(ROOT, 'reports');
  const pending = new Set();

  async function syncReport(filename) {
    if (!filename.endsWith('.md')) return;
    try {
      const content = await readFile(join(reportsDir, filename), 'utf-8');
      const parts = filename.replace('.md', '').split('-');
      const num = parseInt(parts[0], 10);
      const date = parts.slice(-3).join('-');
      const company = parts.slice(1, -3).join('-');
      const { error } = await supabase
        .from('reports')
        .upsert({ filename, content, num, company, date }, { onConflict: 'filename' });
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

  console.log(`  👁️  Watching reports/ for new files...\n`);
}
