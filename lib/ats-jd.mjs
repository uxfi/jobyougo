/**
 * ATS posting URL parsers + JD usability guards for the pipeline prefetch.
 *
 * Ashby/Lever/Greenhouse job pages are JS SPAs. The public JSON APIs return
 * the real posting body; a raw HTML GET only sees "enable JavaScript".
 */

const ASHBY_HOST = 'jobs.ashbyhq.com';
const ASHBY_ORG_RE = /^[A-Za-z0-9._-]+$/;
const ASHBY_JOB_ID_RE = /^[A-Za-z0-9._-]+$/;

/**
 * @param {string} jobUrl
 * @returns {{ org: string, jobId: string } | null}
 */
export function parseAshbyPostingUrl(jobUrl) {
  let parsed;
  try {
    parsed = new URL(String(jobUrl || ''));
  } catch {
    return null;
  }
  if (parsed.hostname.toLowerCase() !== ASHBY_HOST) return null;
  const match = parsed.pathname.match(/^\/([^/]+)\/([^/]+)(?:\/application)?\/?$/i);
  if (!match) return null;
  const org = match[1];
  const jobId = match[2];
  if (!ASHBY_ORG_RE.test(org) || !ASHBY_JOB_ID_RE.test(jobId)) return null;
  if (jobId.toLowerCase() === 'application') return null;
  return { org, jobId };
}

/**
 * @param {any} board
 * @param {string} jobId
 * @returns {any | null}
 */
export function findAshbyJobOnBoard(board, jobId) {
  const target = String(jobId || '').toLowerCase();
  if (!target) return null;
  const jobs = Array.isArray(board?.jobs) ? board.jobs : [];
  return jobs.find((job) => {
    if (typeof job?.id === 'string' && job.id.toLowerCase() === target) return true;
    const urls = [job?.jobUrl, job?.applyUrl];
    return urls.some((value) => String(value || '').toLowerCase().includes(target));
  }) || null;
}

/**
 * @param {string} jobUrl
 * @returns {{ tenant: string, jobId: string, overviewUrl: string } | null}
 */
export function parseDeelJobUrl(jobUrl) {
  let parsed;
  try {
    parsed = new URL(String(jobUrl || ''));
  } catch {
    return null;
  }
  if (!/^jobs\.deel\.com$/i.test(parsed.hostname)) return null;
  const match = parsed.pathname.match(/^\/([^/]+)\/job-details\/([a-f0-9-]+)/i);
  if (!match) return null;
  return {
    tenant: match[1],
    jobId: match[2],
    overviewUrl: `https://jobs.deel.com/${match[1]}/job-details/${match[2]}/overview`,
  };
}

function jsonLdNodes(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(jsonLdNodes);
  if (value && typeof value === 'object' && Array.isArray(value['@graph'])) {
    return value['@graph'].flatMap(jsonLdNodes);
  }
  return [value];
}

function isJsonLdJobPosting(node) {
  const type = node?.['@type'];
  const types = Array.isArray(type) ? type : [type];
  return types.some((entry) => String(entry || '').toLowerCase() === 'jobposting');
}

/**
 * Read a schema.org JobPosting from embedded JSON-LD (Deel career pages, etc.).
 * Visible SPA text is often just the title; the description lives in these scripts.
 *
 * @param {string} html
 * @returns {any | null}
 */
export function extractJsonLdJobPosting(html = '') {
  const blocks = String(html || '').matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block[1].trim());
      const posting = jsonLdNodes(parsed).find((node) => isJsonLdJobPosting(node) && node.title && node.description);
      if (posting) return posting;
    } catch {
      // skip malformed JSON-LD
    }
  }
  return null;
}

/**
 * @param {any} posting
 * @returns {string}
 */
export function flattenJsonLdJobLocation(posting) {
  const raw = posting?.jobLocation;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const parts = [];
  for (const loc of list) {
    const address = loc?.address && typeof loc.address === 'object' ? loc.address : {};
    for (const key of ['addressLocality', 'addressRegion', 'addressCountry']) {
      const value = String(address[key] || '').trim();
      if (value) parts.push(value);
    }
  }
  const locationType = String(posting?.jobLocationType || '').trim();
  if (locationType) parts.push(locationType === 'TELECOMMUTE' ? 'Remote' : locationType);
  return [...new Set(parts)].join(' · ');
}

function decodeZohoJsString(value = '') {
  return String(value || '')
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function unescapeJsonString(value = '') {
  return String(value || '')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\//g, '/')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

function decodeZohoField(value = '') {
  let out = decodeZohoJsString(value);
  for (let i = 0; i < 3; i += 1) out = unescapeJsonString(out);
  return out;
}

/**
 * Zoho Recruit career pages embed Job_Opening fields with \\x22 escapes.
 * Inner HTML quotes are \\\x22, so we delimit on the encoded \\x22,\\x22
 * boundary instead of parsing decoded JSON (which splits on those quotes).
 *
 * @param {string} html
 * @returns {{ title: string, description: string, jobType: string, city: string, country: string, industry: string, id: string } | null}
 */
export function extractZohoRecruitJob(html = '') {
  const raw = String(html || '');
  const readEncoded = (name) => {
    const match = raw.match(new RegExp(`\\\\x22${name}\\\\x22:\\\\x22([\\s\\S]*?)\\\\x22,\\\\x22`));
    return match ? decodeZohoField(match[1]) : '';
  };
  const description = readEncoded('Job_Description');
  if (!description) return null;
  return {
    title: readEncoded('Job_Opening_Name'),
    description,
    jobType: readEncoded('Job_Type'),
    city: readEncoded('City'),
    country: readEncoded('Country'),
    industry: readEncoded('Industry'),
    id: readEncoded('id'),
  };
}

const GREENHOUSE_BOARD_HOST_RE = /^(?:job-boards|boards)(?:\.eu)?\.greenhouse\.io$/i;
const GREENHOUSE_BOARD_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Board token + job id from a Greenhouse job-board URL. The board is in the
 * path (job-boards.greenhouse.io/consensys/jobs/7903661), not the host, or in
 * `for=` on the legacy embed URL. Guessing it from the host or a company hint
 * missed every URL added without a note, and the pipeline fell back to the
 * HTML page and its application form.
 *
 * @param {string} jobUrl
 * @returns {{ board: string, jobId: string } | null}
 */
export function parseGreenhousePostingUrl(jobUrl) {
  let parsed;
  try {
    parsed = new URL(String(jobUrl || ''));
  } catch {
    return null;
  }
  if (!GREENHOUSE_BOARD_HOST_RE.test(parsed.hostname)) return null;
  if (/^\/embed\//i.test(parsed.pathname)) {
    const board = parsed.searchParams.get('for') || '';
    const jobId = parsed.searchParams.get('token') || parsed.searchParams.get('gh_jid') || '';
    return GREENHOUSE_BOARD_RE.test(board) && /^\d+$/.test(jobId) ? { board, jobId } : null;
  }
  const match = parsed.pathname.match(/^\/([^/]+)\/jobs\/(\d+)/i);
  if (!match || !GREENHOUSE_BOARD_RE.test(match[1])) return null;
  return { board: match[1], jobId: match[2] };
}

/**
 * Drop the ATS application form from a job page before text extraction.
 * A Greenhouse job-board page renders its form server-side: the screening
 * questions ("Are you legally authorized to work in the country in which you
 * are currently domiciled?") and a privacy notice with the company's legal
 * address. Read as JD text they became a residency lock and an invented
 * Fort Worth office (report 692, Consensys). Only ATS form markers match:
 * a bare <form> can wrap a whole ASP.NET page.
 *
 * @param {string} html
 * @returns {string}
 */
export function stripApplicationFormHtml(html = '') {
  return String(html || '')
    // Greenhouse job-boards: header, questions and privacy notice share one container.
    .replace(/<div\b[^>]*class="[^"]*\bapplication--container\b[^"]*"[^>]*>[\s\S]*?<\/form>/gi, ' ')
    // Legacy Greenhouse boards (#application_form) and other ATS application forms.
    .replace(/<form\b[^>]*\b(?:id|class)="[^"]*\bapplication(?:--|[-_])form\b[^"]*"[^>]*>[\s\S]*?<\/form>/gi, ' ');
}

const APPLICATION_FORM_TEXT_RE = /Apply for this job\s*\*?\s*indicates a required field/i;

/**
 * Visible-text form of the same block (page text captured from an open tab):
 * the Greenhouse application form starts at "Apply for this job * indicates a
 * required field" and runs to the end of the page.
 *
 * @param {string} text
 * @returns {string}
 */
export function stripApplicationFormText(text = '') {
  const value = String(text || '');
  const match = value.match(APPLICATION_FORM_TEXT_RE);
  return match ? value.slice(0, match.index).trimEnd() : value;
}

export function parseLeverPostingUrl(jobUrl) {
  let parsed;
  try {
    parsed = new URL(String(jobUrl || ''));
  } catch {
    return null;
  }
  const host = parsed.hostname.match(/^jobs\.((?:eu\.)?lever\.co)$/i);
  if (!host) return null;
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const slug = parts[0];
  const id = parts[1];
  if (!ASHBY_ORG_RE.test(slug) || !ASHBY_JOB_ID_RE.test(id)) return null;
  return { apiHost: `api.${host[1]}`, slug, id };
}

/**
 * True when extracted page text is a JS shell / empty stub, not a job description.
 * Used so the pipeline parks the URL instead of scoring a CRA noscript page.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function isUnusableJobDescriptionText(text = '') {
  const trimmed = String(text || '').replace(/\s+/g, ' ').trim();
  if (!trimmed) return true;
  if (trimmed.length < 250) return true;
  const lower = trimmed.toLowerCase();
  if (trimmed.length < 800 && (
    lower.includes('enable javascript to run this app')
    || lower.includes('you need to enable javascript')
  )) return true;
  return false;
}
