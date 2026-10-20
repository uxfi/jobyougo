// The Job Boards tab lists every portals.yml section the scan picker reads
// besides companies (getScanSources): web-search queries, EU/Asia boards,
// freelance portals and API/RSS job boards. The last two are read + on/off
// only here (no edit/delete); they used to be invisible in the Portals page,
// so a disabled job board could not be turned back on from the UI.
export const QUERY_SECTIONS = ['search_queries', 'eu_job_boards', 'freelance_portals', 'job_boards'];
export const READ_ONLY_QUERY_SECTIONS = new Set(['freelance_portals', 'job_boards']);

export function queryDisplayTarget(q) {
  if (q.query) return String(q.query);
  const target = q.url || q.feed || q.api || q.careers_url || '';
  return [q.provider, target].filter(Boolean).join(' · ');
}

export function listQuerySources(parsed = {}) {
  return QUERY_SECTIONS.flatMap(section => (parsed[section] || [])
    .filter(q => q && q.name)
    .map(q => ({
      name:    q.name    || '',
      query:   queryDisplayTarget(q),
      enabled: q.enabled !== false,
      section,
      ...(READ_ONLY_QUERY_SECTIONS.has(section) ? { readOnly: true } : {}),
    })));
}
