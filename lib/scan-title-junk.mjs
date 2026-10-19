/**
 * Page chrome and listing headings that careers-page scrapers read as job
 * titles. The inner pattern is written to be embedded in an anchored,
 * case-insensitive, non-unicode group (the page-side extract script and
 * ui/server.mjs build the regex from this source): no \p classes.
 *
 * Seen in a real scan: Webflow ("Skip to Main Content", "Access Careers page",
 * "Marketer", "Developer"), Michael Page FR/TH ("Ing\u00e9nieurs", "Emploi Paris",
 * "Skip to main navigation", "Find jobs", "Cancel", "Create Job Alert"),
 * Wellfound ("Find Jobs"). A search page's heading ("Emploi Product Designer
 * Paris", "54 jobs") must not replace a listing's title either: it contains
 * the design keywords the title filter looks for.
 */
export const NON_JOB_TITLE_INNER = [
  'skip\\s+to\\s+(?:the\\s+)?(?:main\\s+)?(?:content|navigation|footer|search)',
  'aller\\s+au\\s+contenu(?:\\s+principal)?',
  'access\\s+(?:the\\s+)?(?:careers?|jobs?)(?:\\s+page)?',
  'find\\s+(?:a\\s+)?(?:jobs?|roles?|work)',
  '(?:create|set\\s+up|manage)\\s+(?:a\\s+)?job\\s+alerts?',
  'job\\s+alerts?',
  '(?:cancel|close|menu|search|sign\\s*up|subscribe|submit|reset|clear(?:\\s+all)?|filters?|show\\s+(?:more|less)|annuler|fermer|rechercher)',
  // Search / category headings: "Emploi Paris", "Emploi Product Designer Paris", "Jobs in Bangkok", "54 jobs".
  'emplois?\\s+\\S.*',
  'jobs?\\s+(?:in|near|at|by|for)\\s+\\S.*',
  '.{0,80}\\b\\d+\\s+(?:jobs?|offres?|r[\u00e9e]sultats?|results?|positions?|openings?)\\b.*',
  '.{1,60}\\s+(?:jobs|careers|vacancies|openings|emplois|offres)',
  // Category names: one generic word, never a posting.
  '(?:ing[\u00e9e]nieurs?|commerciaux|d[\u00e9e]veloppeurs?|marketers?|developers?|designers?|engineers?|agency|agencies|managers?|sales|marketing|finance|legal|consultants?|data|support|operations|design|product|engineering|technology|tech|creative)',
].join('|');

export const NON_JOB_TITLE_RE = new RegExp(`^(?:${NON_JOB_TITLE_INNER})$`, 'i');

export function isNonJobTitle(title = '') {
  return NON_JOB_TITLE_RE.test(String(title).replace(/\s+/g, ' ').trim());
}

/** `base` is an anchored `^(?:...)$` source; the junk alternatives are added inside it. */
export function withNonJobTitles(baseSource) {
  return String(baseSource).replace(/\)\$$/, `|${NON_JOB_TITLE_INNER})$`);
}
