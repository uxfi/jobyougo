/**
 * Title and company of a job posting, for pipeline rows added by URL alone.
 *
 * A manual add used to enter the pipeline with an empty title and company, so
 * Jev triaged it on the URL alone (2026-10-13: Pencil "Product Researcher" was
 * kept at 0.63 from `jobs.ashbyhq.com/pencil/<uuid>`). The server fetches the
 * posting (ATS APIs, JSON-LD, page title) and these pure helpers read the
 * identity out of what came back. No network here.
 */
import { parseAshbyPostingUrl, parseGreenhousePostingUrl, parseLeverPostingUrl } from './ats-jd.mjs';
import { extractPipelineNoteParts } from './pipeline-record.mjs';

const MAX_FIELD = 140;

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function clip(value) {
  const text = clean(value);
  return text.length > MAX_FIELD ? `${text.slice(0, MAX_FIELD - 1).trim()}…` : text;
}

function decodeEntities(value = '') {
  return String(value || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

/** "pencil" → "Pencil", "acme-corp" → "Acme Corp"; a name with capitals stays as is. */
export function prettifySlug(slug = '') {
  const text = clean(String(slug || '').replace(/[-_]+/g, ' '));
  if (!text || /[A-Z]/.test(text)) return text;
  return text.replace(/\b[a-z]/g, letter => letter.toUpperCase());
}

function companyName(value = '') {
  const text = clean(value);
  return /^[a-z0-9][a-z0-9_-]*$/.test(text) ? prettifySlug(text) : text;
}

/**
 * The "## Job metadata" block written by formatSourceJobDescription (ATS APIs,
 * JSON-LD, LinkedIn): "Company: …", "Role: …", "Location / remote: …".
 */
export function identityFromJobText(text = '') {
  const head = String(text || '').split('\n').slice(0, 25).join('\n');
  const field = (re) => clean(head.match(re)?.[1] || '');
  return {
    title: clip(field(/^Role:\s*(.+)$/im)),
    company: clip(companyName(field(/^Company:\s*(.+)$/im))),
    location: clip(field(/^Location \/ remote:\s*(.+)$/im)),
  };
}

const SITE_SEGMENT = /^(?:linkedin|indeed(?:\.com)?|glassdoor|welcome to the jungle|wttj|wellfound|angellist(?: talent)?|otta|jobs?|careers?|career site|job board|job details|offre d['’]emploi|emploi|recrutement|recruitee|teamtailor|workable|lever|greenhouse|ashby|personio|smartrecruiters|bamboohr|breezy(?: hr)?|join(?:\.com)?|remotive|himalayas|jobicy|we work remotely|apply|postuler)$/i;
const ROLE_WORD = /\b(?:designer|design|manager|lead|owner|engineer|developer|director|head|researcher|builder|consultant|architect|analyst|specialist|strategist|writer|scientist|officer|intern|associate|product|ux|ui|graphiste|concepteur|conceptrice|d[ée]veloppeur|d[ée]veloppeuse|responsable|chef de projet|webdesigner|int[ée]grateur)\b/i;

/**
 * Title and company out of a page or tab title: Greenhouse "Job Application
 * for X at Y", LinkedIn "Y hiring X in Z | LinkedIn", Lever "Y - X",
 * "X | Y", "X at Y", "Careers at Y".
 */
export function identityFromPageTitle(raw = '', siteName = '') {
  const text = clean(decodeEntities(raw));
  if (!text) return { title: '', company: '', location: '' };
  let match = text.match(/^job application for (.+?) at (.+)$/i);
  if (match) return { title: clip(match[1]), company: clip(match[2]), location: '' };
  match = text.match(/^(.+?) hiring (.+?)(?: in (.+?))?\s*\|\s*linkedin$/i);
  if (match) return { title: clip(match[2]), company: clip(match[1]), location: clip(match[3] || '') };

  const segments = text.split(/\s+[|·•–—-]\s+/).map(clean).filter(Boolean);
  let title = '';
  let company = '';
  for (const segment of segments) {
    const careersAt = segment.match(/^(?:careers?|jobs?)\s+(?:at|@|chez)\s+(.+)$/i);
    if (careersAt) {
      company ||= careersAt[1];
      continue;
    }
    if (SITE_SEGMENT.test(segment)) continue;
    const at = segment.match(/^(.+?)\s+(?:@|at|chez)\s+(.+)$/i);
    if (!title && at && ROLE_WORD.test(at[1])) {
      title = at[1];
      company ||= at[2];
      continue;
    }
    if (!title && ROLE_WORD.test(segment)) title = segment;
    else if (!company && !ROLE_WORD.test(segment)) company = segment;
  }
  if (!company && siteName && !SITE_SEGMENT.test(clean(siteName))) company = clean(siteName);
  return { title: clip(title), company: clip(company), location: '' };
}

function metaContent(html, attr, name) {
  const re = new RegExp(`<meta[^>]+${attr}=["']${name}["'][^>]*>`, 'i');
  const tag = String(html || '').match(re)?.[0] || '';
  // Same quote on both ends: content="Chef d'équipe Design" holds an apostrophe.
  return decodeEntities(tag.match(/content=(["'])(.*?)\1/i)?.[2] || '');
}

/**
 * og:title / twitter:title / <title>, with og:site_name as the company. The
 * JSON-LD JobPosting is read upstream: textFromFetchedHtml turns it into the
 * metadata block identityFromJobText parses.
 */
export function identityFromHtml(html = '') {
  const source = String(html || '');
  if (!source) return { title: '', company: '', location: '' };
  const pageTitle = metaContent(source, 'property', 'og:title')
    || metaContent(source, 'name', 'twitter:title')
    || decodeEntities(source.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
  return identityFromPageTitle(pageTitle, metaContent(source, 'property', 'og:site_name'));
}

/**
 * What the URL alone says: the board slug of an ATS (Ashby, Lever,
 * Greenhouse, Workable, subdomain boards) and, for Welcome to the Jungle and
 * "/companies/<org>/jobs/<slug>" boards, the title slug.
 */
export function identityFromUrl(url = '') {
  let parsed;
  try { parsed = new URL(String(url || '')); } catch { return { title: '', company: '', location: '' }; }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const parts = parsed.pathname.split('/').filter(Boolean).map(part => {
    try { return decodeURIComponent(part); } catch { return part; }
  });
  const result = (company = '', title = '') => ({ title: clip(title), company: clip(prettifySlug(company)), location: '' });

  const ats = parseAshbyPostingUrl(url)?.org || parseLeverPostingUrl(url)?.slug || parseGreenhousePostingUrl(url)?.board;
  if (ats) return result(ats);
  if (host === 'apply.workable.com' && parts[0]) return result(parts[0]);
  const subdomain = host.match(/^([a-z0-9-]+)\.(?:recruitee\.com|teamtailor\.com|bamboohr\.com|breezy\.hr|pinpointhq\.com|jobs\.personio\.(?:de|com))$/);
  if (subdomain && !['www', 'jobs', 'careers', 'app'].includes(subdomain[1])) return result(subdomain[1]);
  const companiesIdx = parts.indexOf('companies');
  if (companiesIdx >= 0 && parts[companiesIdx + 2] === 'jobs' && parts[companiesIdx + 1] && parts[companiesIdx + 3]) {
    // WTTJ slugs end in _<city>; remotefirstjobs slugs in -<id>.
    const titleSlug = parts[companiesIdx + 3].replace(/_[a-z0-9-]+$/i, '').replace(/-\d+$/, '');
    return result(parts[companiesIdx + 1], prettifySlug(titleSlug));
  }
  return result();
}

/** First non-empty value per field, in argument order. */
export function mergePostingIdentity(...sources) {
  const pick = (key) => clip(sources.map(source => source?.[key]).find(value => clean(value)) || '');
  return { title: pick('title'), company: pick('company'), location: pick('location') };
}

/**
 * The pipeline note for a manual add: "Company | Title" (the note format
 * extractPipelineNoteParts reads), with the user's own note kept after it.
 * A note that already names a company and a title is left alone. "?" stands
 * for an unknown company, the tracker's convention, so the title never slides
 * into the company slot.
 */
export function noteWithIdentity(note = '', identity = {}) {
  const raw = clean(note);
  const parts = extractPipelineNoteParts(raw);
  if (parts.company && parts.title) return raw;
  const title = clean(parts.title || identity.title);
  if (!title) return raw;
  const fetchedCompany = clean(identity.company);
  const company = fetchedCompany || clean(parts.company) || '?';
  const extras = [];
  if (fetchedCompany && parts.company && parts.company.toLowerCase() !== fetchedCompany.toLowerCase()) extras.push(parts.company);
  if (parts.note) extras.push(parts.note);
  return [company, title, ...extras].map(value => clean(value).replace(/\|/g, '/')).join(' | ');
}
