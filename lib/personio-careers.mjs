// Personio public XML feed (no browser, no auth): https://<slug>.jobs.personio.(de|com)/xml
// Detects tenant URLs (board root or a /job/<id> page) or an explicit `personio: <slug>`.
// Keeps descriptions (HTML -> text), all offices, remote hints and createdAt.
// When the tenant disables /xml (404), falls back to the server-rendered board
// (providers/personio.mjs parsePersonioHtml).
import { decodeEntities } from '../providers/_html-entities.mjs';
import { parsePersonioHtml } from '../providers/personio.mjs';
import { cleanFetchUrl, retryPolicy, backoffDelayMs } from './fetch-politeness.mjs';

const HOST_RE = /^([a-z0-9][a-z0-9-]{0,62})\.jobs\.personio\.(de|com)$/i;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/i;
const UA = 'Mozilla/5.0 (compatible; jobyougo-scan)';

export function parsePersonioUrl(url = '', { slug = '' } = {}) {
  if (slug && SLUG_RE.test(String(slug).trim())) {
    const s = String(slug).trim().toLowerCase();
    return { slug: s, host: `${s}.jobs.personio.de` };
  }
  let u;
  try { u = new URL(String(url)); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const m = u.hostname.toLowerCase().match(HOST_RE);
  if (!m) return null;
  const jobId = (u.pathname.match(/^\/job\/(\d+)/) || [])[1] || '';
  return { slug: m[1], host: u.hostname.toLowerCase(), ...(jobId ? { jobId } : {}) };
}

export const isPersonioUrl = (url, opts) => parsePersonioUrl(url, opts) !== null;

/** Shape problems validate-portals reports for a Personio-looking URL (null = fine / not Personio). */
export function personioUrlProblem(url = '') {
  let u;
  try { u = new URL(String(url)); } catch { return null; }
  if (!/(^|\.)jobs\.personio\.(de|com)$/i.test(u.hostname)) return null;
  if (u.protocol !== 'https:') return 'Personio careers_url must use https';
  if (!HOST_RE.test(u.hostname)) return 'Personio careers_url must be https://<slug>.jobs.personio.de (tenant subdomain missing)';
  return null;
}

// Placeholder CDATA bodies first: a description may hold a literal "</position>".
function protectCdata(xml) {
  const parts = [];
  const text = String(xml || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, body) => `\u0000${parts.push(body) - 1}\u0000`);
  return { text, restore: s => s.replace(/\u0000(\d+)\u0000/g, (_, i) => parts[Number(i)]) };
}

export function htmlToText(html = '') {
  let s = String(html || '')
    .replace(/<\s*(script|style)\b[\s\S]*?<\/\s*\1\s*>/gi, ' ')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*li\b[^>]*>/gi, '\n- ')
    .replace(/<\/\s*(p|div|ul|ol|h[1-6]|tr)\s*>/gi, '\n');
  let prev;
  do { prev = s; s = s.replace(/<[^>]*>/g, ''); } while (s !== prev);
  return decodeEntities(s).replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

const REMOTE_RE = /\b(remote|fully remote|remote-first|work from anywhere|home ?office|homeoffice|télétravail|teletravail|mobiles arbeiten)\b/i;

export function parsePersonioFeed(xml, { companyName = '', host = '' } = {}) {
  const { text, restore } = protectCdata(xml);
  const field = (block, tag) => {
    const m = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`));
    return m ? htmlToText(restore(m[1])) : '';
  };
  const jobs = [];
  for (const [block] of text.matchAll(/<position\b[^>]*>[\s\S]*?<\/position>/g)) {
    const descBlock = (block.match(/<jobDescriptions\b[^>]*>([\s\S]*?)<\/jobDescriptions>/) || [])[1] || '';
    const scalar = block.replace(/<jobDescriptions\b[^>]*>[\s\S]*?<\/jobDescriptions>/, '');
    const id = field(scalar, 'id');
    const title = field(scalar, 'name');
    if (!title || !/^\d+$/.test(id)) continue;
    const offices = [];
    for (const om of scalar.matchAll(/<office\b[^>]*>([\s\S]*?)<\/office>/g)) {
      const name = htmlToText(restore(om[1]));
      if (name && !offices.includes(name)) offices.push(name);
    }
    const sections = [];
    for (const [, d] of descBlock.matchAll(/<jobDescription\b[^>]*>([\s\S]*?)<\/jobDescription>/g)) {
      const name = field(d, 'name');
      const value = field(d, 'value');
      if (value) sections.push(name ? `${name}\n${value}` : value);
    }
    const description = sections.join('\n\n');
    const schedule = field(scalar, 'schedule');
    const remote = offices.some(o => REMOTE_RE.test(o)) || REMOTE_RE.test(title) || REMOTE_RE.test(schedule);
    const location = [...offices, ...(remote && !offices.some(o => REMOTE_RE.test(o)) ? ['Remote'] : [])].join(', ');
    const createdAt = field(scalar, 'createdAt');
    jobs.push({
      title,
      url: `https://${host}/job/${id}`,
      company: companyName || field(scalar, 'subcompany'),
      location,
      ...(remote ? { remoteEvidence: 'Personio feed: remote office/schedule', workMode: 'remote' } : {}),
      publishedAt: /^\d{4}-\d{2}-\d{2}/.test(createdAt) ? createdAt : '',
      department: field(scalar, 'department'),
      employmentType: field(scalar, 'employmentType'),
      seniority: field(scalar, 'seniority'),
      description,
    });
  }
  return jobs;
}

async function politeGet(fetchImpl, url, { timeoutMs, accept }) {
  const target = cleanFetchUrl(url);
  const policy = retryPolicy(target);
  for (let attempt = 1; ; attempt += 1) {
    const res = await fetchImpl(target, { redirect: 'error', headers: { 'user-agent': UA, accept }, signal: AbortSignal.timeout(timeoutMs) });
    if ((res.status === 429 || res.status >= 500) && attempt < policy.attempts) {
      await new Promise(r => setTimeout(r, backoffDelayMs(attempt, { baseMs: policy.baseMs, retryAfter: res.headers?.get?.('retry-after') || '' })));
      continue;
    }
    return res;
  }
}

export async function fetchPersonioJobs(careersUrl, { slug = '', companyName = '', fetchImpl = fetch, timeoutMs = 15000, language = 'en' } = {}) {
  const info = parsePersonioUrl(careersUrl, { slug });
  if (!info) throw new Error('not a Personio URL');
  const lang = language ? `?language=${encodeURIComponent(language)}` : '';
  const res = await politeGet(fetchImpl, `https://${info.host}/xml${lang}`, { timeoutMs, accept: 'application/xml,text/xml' });
  if (res.ok) {
    const xml = await res.text();
    if (!/<workzag-jobs\b/i.test(xml)) throw new Error('Personio feed: unexpected body (no <workzag-jobs>)');
    return { source: 'xml', jobs: parsePersonioFeed(xml, { companyName, host: info.host }) };
  }
  if (res.status !== 404) throw new Error(`Personio feed HTTP ${res.status}`);
  const page = await politeGet(fetchImpl, `https://${info.host}/${lang}`, { timeoutMs, accept: 'text/html' });
  if (!page.ok) throw new Error(`Personio board HTTP ${page.status}`);
  return { source: 'html', jobs: parsePersonioHtml(await page.text(), companyName, info.host).map(j => ({ ...j, publishedAt: '', description: '' })) };
}