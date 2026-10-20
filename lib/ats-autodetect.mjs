// Auto-detect a tracked company's ATS from its careers_url so the server scan
// uses the existing provider plugin (providers/*.mjs: public JSON/RSS/XML, own
// retry/backoff) instead of a browser crawl or a web search. Greenhouse, Ashby
// and Lever are derived separately (api mode); careers-page.com and Personio go
// through lib/careers-feeds.mjs. Workday is left to an explicit `provider:`
// (large tenants page slowly; see the live check in tests).
export const ATS_HOSTS = {
  workable: /^(?:apply|jobs)\.workable\.com$|^[a-z0-9-]+\.workable\.com$/i,
  smartrecruiters: /^(?:careers|jobs)\.smartrecruiters\.com$/i,
  recruitee: /^[a-z0-9-]+\.recruitee\.com$/i,
  teamtailor: /^[a-z0-9-]+\.teamtailor\.com$/i,
  bamboohr: /^[a-z0-9-]+\.bamboohr\.com$/i,
  breezy: /^[a-z0-9-]+\.breezy\.hr$/i,
  join: /^join\.com$/i,
  pinpoint: /^[a-z0-9-]+\.pinpointhq\.com$/i,
  rippling: /^ats\.rippling\.com$/i,
  softgarden: /^[a-z0-9-]+\.softgarden\.io$/i,
  traffit: /^[a-z0-9-]+\.traffit\.com$/i,
  dvinci: /^[a-z0-9-]+\.dvinci-hr\.com$/i,
  hirehive: /^[a-z0-9-]+\.hirehive\.com$/i,
};

const RESERVED = /^(?:www|api|app|help|support|blog|status|docs)\./i;

export function detectAtsProvider(company = {}, providers) {
  let host;
  try {
    const u = new URL(String(company.careers_url || ''));
    if (u.protocol !== 'https:') return '';
    host = u.hostname;
  } catch { return ''; }
  if (RESERVED.test(host)) return '';
  for (const [id, re] of Object.entries(ATS_HOSTS)) {
    if (!re.test(host)) continue;
    const provider = providers?.get?.(id);
    if (!provider) return '';
    try { return provider.detect?.(company) ? id : ''; } catch { return ''; }
  }
  return '';
}