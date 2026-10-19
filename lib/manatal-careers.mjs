// Manatal "Careers Page" (careers-page.com) fetcher - no browser needed.
//  - www.careers-page.com/<slug>   -> public JSON  /api/v1.0/c/<slug>/jobs/
//  - <slug>.careers-page.com       -> server-rendered HTML job cards (no JSON
//    API exists for these); we use its server-side `?search=` and `?page=`.
const UA = 'Mozilla/5.0 (compatible; jobyougo-scan)';
export const MANATAL_SEARCH_TERMS = ['designer', 'ux', 'product design', 'user research'];

export function parseManatalUrl(url = '') {
  let u;
  try { u = new URL(String(url)); } catch { return null; }
  const host = u.hostname.toLowerCase();
  if (host !== 'careers-page.com' && !host.endsWith('.careers-page.com')) return null;
  const sub = host.replace(/\.?careers-page\.com$/, '').replace(/^www$/, '');
  if (sub) return { kind: 'subdomain', slug: sub, base: `https://${host}` };
  const slug = u.pathname.split('/').filter(Boolean)[0];
  return slug ? { kind: 'path', slug, base: 'https://www.careers-page.com' } : null;
}

export const isManatalUrl = url => parseManatalUrl(url) !== null;

const decode = s => String(s || '').replace(/&amp;/g, '&').replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

export function parseManatalApi(json, slug) {
  return (json?.results || []).filter(r => r?.hash && r?.position_name).map(r => ({
    title: decode(r.position_name),
    url: `https://www.careers-page.com/${slug}/job/${r.hash}`,
    location: decode(r.location_display || [r.city, r.state, r.country].filter(Boolean).join(', ')),
    department: decode(r.organization_name),
  }));
}

export function parseManatalHtml(html, base) {
  const jobs = [];
  const seen = new Set();
  const re = /<a\b[^>]*href="\/?jobs\/([0-9a-f-]{36})"[^>]*>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const tag = m[0];
    if (seen.has(m[1]) || !/job-title-link|data-job-title/.test(tag)) continue;
    const attr = n => decode((tag.match(new RegExp(`data-job-${n}="([^"]*)"`)) || [])[1]);
    const title = attr('title');
    if (!title) continue;
    seen.add(m[1]);
    jobs.push({ title, url: `${base}/jobs/${m[1]}`, location: [attr('city'), attr('country')].filter(Boolean).join(', ') });
  }
  return jobs;
}

async function getText(fetchImpl, url, accept, timeoutMs) {
  const res = await fetchImpl(url, { headers: { 'user-agent': UA, accept }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}

export async function fetchManatalJobs(careersUrl, { fetchImpl = fetch, searchTerms = MANATAL_SEARCH_TERMS, maxPages = 3, timeoutMs = 15000, spacingMs = 500 } = {}) {
  const info = parseManatalUrl(careersUrl);
  if (!info) throw new Error('not a careers-page.com URL');
  if (info.kind === 'path') {
    const out = [];
    let next = `${info.base}/api/v1.0/c/${encodeURIComponent(info.slug)}/jobs/`;
    for (let i = 0; next && i < 10; i += 1) {
      const json = JSON.parse(await getText(fetchImpl, next, 'application/json', timeoutMs));
      out.push(...parseManatalApi(json, info.slug));
      next = json.next || null;
    }
    return { source: 'api', jobs: out };
  }
  const byUrl = new Map();
  let partial = false;
  outer: for (const term of searchTerms) {
    for (let page = 1; page <= maxPages; page += 1) {
      if (byUrl.size || page > 1 || term !== searchTerms[0]) await new Promise(r => setTimeout(r, spacingMs));
      let html;
      try {
        html = await getText(fetchImpl, `${info.base}/?search=${encodeURIComponent(term)}&page=${page}`, 'text/html', timeoutMs);
      } catch (err) {
        if (!byUrl.size) throw err;
        partial = true; // rate-limited mid-way: keep what we have
        break outer;
      }
      const jobs = parseManatalHtml(html, info.base);
      const before = byUrl.size;
      jobs.forEach(j => byUrl.set(j.url, j));
      if (jobs.length < 10 || byUrl.size === before) break;
    }
  }
  return { source: 'html-search', partial, jobs: [...byUrl.values()] };
}
