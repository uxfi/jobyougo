// Hosts that are never an employer's own site: job boards and aggregators,
// ATS and HR tenants, company directories, review sites, data brokers,
// freelance marketplaces, forums, newswires and shared-hosting platforms.
// A page on one of them is ABOUT a company (or lists its offers). Taking such
// a domain for the employer's drafted applications to support@jobgether.com
// and built address guesses @scamdoc.com (contact finder, 2026-10-23).
//
// One list, no imports, so scan code can share it later. Not yet migrated
// (they change scan behaviour): HOST_SKIP in lib/ats-board-resolver.mjs and
// atsHost in identityFromUrlSlug (lib/posting-identity.mjs) still carry their
// own shorter copies.

// Job boards, ATS and search engines (moved from contact-finder.mjs; isJobHost
// still reads this one alone, unchanged).
export const JOB_HOST_RE = /(?:^|\.)(?:greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com|welcometothejungle\.com|linkedin\.com|indeed\.[a-z.]+|glassdoor\.[a-z.]+|wellfound\.com|angel\.co|himalayas\.app|remoteok\.com|remotive\.com|weworkremotely\.com|myworkdayjobs\.com|workday\.com|icims\.com|teamtailor\.com|recruitee\.com|bamboohr\.com|jobvite\.com|breezy\.hr|successfactors\.(?:com|eu)|taleo\.net|personio\.(?:de|com)|join\.com|jobteaser\.com|apec\.fr|hellowork\.com|otta\.com|ycombinator\.com|dover\.com|rippling\.com|gem\.com|pinpointhq\.com|applytojob\.com|jazz\.co|jazzhr\.com|zohorecruit\.com|freshteam\.com|homerun\.co|recruitcrm\.io|monster\.[a-z.]+|stepstone\.[a-z.]+|xing\.com|jobup\.ch|jobs\.ch|seek\.com\.au|jobsdb\.com|jora\.com|jobstreet\.[a-z.]+|google\.com|notion\.site|notion\.so|interamt\.de|talent\.com|jooble\.org|careerjet\.[a-z.]+|ziprecruiter\.com|dice\.com|hired\.com|remoteco\.com|workatastartup\.com|eu\.greenhouse\.io|wttj\.co|lesjeudis\.com|cadremploi\.fr|regionsjob\.com|keljob\.com|jobijoba\.com|welcomekit\.co|hireflix\.com|factorial\.[a-z]+)$/i;

// Social networks, press, company databases and big platforms (moved from
// contact-finder.mjs; isSocialHost still reads this one alone, unchanged).
export const SOCIAL_HOST_RE = /(?:^|\.)(?:facebook\.com|twitter\.com|x\.com|instagram\.com|youtube\.com|tiktok\.com|github\.com|medium\.com|wikipedia\.org|crunchbase\.com|pitchbook\.com|bloomberg\.com|reuters\.com|techcrunch\.com|lesechos\.fr|maddyness\.com|frenchweb\.fr|societe\.com|pappers\.fr|infogreffe\.fr|verif\.com|trustpilot\.com|g2\.com|capterra\.com|producthunt\.com|apple\.com|play\.google\.com|amazon\.[a-z.]+|microsoft\.com|slideshare\.net|vimeo\.com|dribbble\.com|behance\.net|zoominfo\.com|rocketreach\.co|signalhire\.com|apollo\.io|lusha\.com|kaspr\.io|contactout\.com|theorg\.com|craft\.co|owler\.com|cbinsights\.com|glassdoor\.[a-z.]+|lemlist\.com)$/i;

// A country or generic suffix for brands that run one site per market
// (foundit.sg, malt.fr, yelp.co.uk), tighter than [a-z.]+ so a subdomain such
// as malt.acme.com stays the employer's.
const TLD = '[a-z]{2,6}(?:\\.[a-z]{2})?';

const hostGroup = (hosts) => new RegExp(`(?:^|\\.)(?:${hosts.join('|')})$`, 'i');

// Boards and aggregators measured in the 2026-10 reports and in
// data-static/aggregator-domains.txt, plus the slugs posting-identity skips.
const BOARD_HOST_RE = hostGroup([
  'jobgether\\.com', 'arbeitnow\\.com', 'justjoin\\.it', 'francetravail\\.fr', 'pole-emploi\\.fr', 'remotefront\\.(?:com|io)',
  'realworkfromanywhere\\.com', 'jobicy\\.com', 'remotefirstjobs\\.com', 'erecruiter\\.pl', 'cryptojobslist\\.com', 'thehub\\.io',
  'mycareersfuture\\.gov\\.sg', `foundit\\.${TLD}`, 'impactpool\\.org', `simplyhired\\.${TLD}`, 'levels\\.fyi', 'builtin[a-z]*\\.com',
  'recruit\\.net', 'zippia\\.com', 'expertini\\.com', `adzuna\\.${TLD}`, `neuvoo\\.${TLD}`, `jobisjob\\.${TLD}`, 'jobrapido\\.com',
  `trovit\\.${TLD}`, 'jobtome\\.com', 'lensa\\.com', 'jobg8\\.com', 'geebo\\.com', 'careerbuilder\\.com', 'naukri\\.com',
  'techinasia\\.com', 'coroflot\\.com', 'remote\\.co', 'getonbrd\\.com', 'whatjobs\\.com', 'jobleads\\.com', 'web3\\.career',
  'nofluffjobs\\.com', 'workingnomads\\.com', 'jobspresso\\.co', 'euremotejobs\\.com', 'bebee\\.com', 'jobright\\.ai',
  'theladders\\.com', 'teamblind\\.com', 'jobsora\\.com', 'tealhq\\.com', `jobted\\.${TLD}`, 'careerbliss\\.com',
  // Still kept as the employer's host by the 2026-10-24 census of the reports.
  'jackandjill\\.ai', 'crosstalent\\.io', 'torentify\\.com', 'cryptocurrencyjobs\\.co', '4dayweek\\.io', 'mynavi\\.jp',
  'jobs\\.nhs\\.uk', 'designproject\\.io', 'wikitechy\\.com', 'tinycto\\.tv',
]);

// ATS and HR platforms whose tenants host offers (acme.hibob.com is Acme's
// board, never its mail domain).
const ATS_TENANT_HOST_RE = hostGroup([
  'oraclecloud\\.com', 'traffit\\.com', 'hibob\\.com', 'deel\\.com', 'keka\\.com', 'sage\\.hr', `factorialhr\\.${TLD}`,
  'careers-page\\.com', 'recruitis\\.io', 'screenloop\\.com', 'hiresome\\.ai',
]);

// Pages ABOUT a company: review and scam-check sites, directories and data
// brokers, address finders, freelance marketplaces, forums and newswires.
const DIRECTORY_HOST_RE = hostGroup([
  'scamdoc\\.com', 'scamadviser\\.com', 'scam-detector\\.com', 'sitejabber\\.com', `yelp\\.${TLD}`, 'bbb\\.org', 'kununu\\.com',
  'comparably\\.com', 'trustradius\\.com', 'getapp\\.com', 'softwareadvice\\.com', 'saasworthy\\.com', 'alternativeto\\.net',
  'tracxn\\.com', 'dealroom\\.co', 'f6s\\.com', 'eu-startups\\.com', 'startupblink\\.com', 'clutch\\.co', 'goodfirms\\.co',
  'designrush\\.com', `sortlist\\.${TLD}`, 'themanifest\\.com', 'dnb\\.com', 'opencorporates\\.com', 'bizapedia\\.com', 'manta\\.com',
  `northdata\\.${TLD}`, 'companieshouse\\.gov\\.uk', 'company-information\\.service\\.gov\\.uk', 'annuaire-entreprises\\.data\\.gouv\\.fr',
  'societeinfo\\.com', 'corporama\\.com', 'manageo\\.fr', 'kompass\\.com', `europages\\.${TLD}`, 'pagesjaunes\\.fr', `yellowpages\\.${TLD}`,
  'similarweb\\.com', 'semrush\\.com', 'builtwith\\.com', 'growjo\\.com', 'datanyze\\.com', 'leadiq\\.com', 'golden\\.com',
  'email-format\\.com', `mailmo\\.${TLD}`, `truelist\\.${TLD}`, 'anymailfinder\\.com', `malt\\.${TLD}`, 'upwork\\.com', 'fiverr\\.com',
  'toptal\\.com', 'reddit\\.com', 'quora\\.com', 'substack\\.com', 'prnewswire\\.com', 'businesswire\\.com', 'globenewswire\\.com',
  'wikidata\\.org',
]);

// Shared hosting: the label left of these is a tenant, and the registrable
// domain is the platform (acme.github.io → github.io), never a mail domain.
const SHARED_HOST_RE = hostGroup([
  'github\\.io', 'gitlab\\.io', 'webflow\\.io', 'framer\\.(?:website|ai|app)', 'wixsite\\.com', 'squarespace\\.com', 'carrd\\.co',
  'vercel\\.app', 'netlify\\.app', 'pages\\.dev', 'herokuapp\\.com', 'super\\.site', 'notion\\.site', 'blogspot\\.com',
  'wordpress\\.com', 'gouv\\.fr',
]);

const sources = [JOB_HOST_RE, SOCIAL_HOST_RE, BOARD_HOST_RE, ATS_TENANT_HOST_RE, DIRECTORY_HOST_RE, SHARED_HOST_RE];

/** Every non-employer host above in one pattern, anchored on a label boundary. */
export const NON_EMPLOYER_HOST_RE = new RegExp(`(?:${sources.map(re => re.source).join('|')})`, 'i');

// Legal-entity words only: "Acme Labs SAS" keeps "labs" (that is the name),
// drops "sas"; "Maven Workforce Pvt Ltd", "Bjak Sdn Bhd", "Acme Pte Ltd".
// Never the first word: "APS Group" and "AB InBev" keep their names.
const LEGAL_ENTITY_WORDS = new Set([
  'inc', 'incorporated', 'llc', 'ltd', 'limited', 'plc', 'gmbh', 'ag', 'sas', 'sasu', 'sa', 'sarl', 'bv', 'nv',
  'pvt', 'pte', 'pty', 'llp', 'sdn', 'bhd', 'kk', 'aps',
]);

/**
 * The words of a company name, lowercase and unaccented, without parentheses
 * and legal-entity suffixes: "Acme Labs S.A. (Paris)" → ["acme", "labs"],
 * "Monee SG Private Limited" → ["monee", "sg"].
 */
export function companyNameWords(company) {
  return String(company || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\bsp\.?\s*z\.?\s*o\.?\s*o\b\.?/g, ' ')
    .replace(/\bs\.\s?a\b\.?/g, ' ')
    .replace(/(?<=[a-z0-9][^a-z0-9]+)\bprivate\s+(?:limited|ltd)\b\.?/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .filter((word, index) => index === 0 || !LEGAL_ENTITY_WORDS.has(word));
}

const TRAILING_TLD_WORD = /^(?:com|io|ai|co|app|net|org)$/;
// Words a vendor's own domain adds to its name (ashbyhq.com, factorialhr.com).
const OWN_DOMAIN_SUFFIXES = ['hq', 'hr', 'app', 'apps', 'inc', 'labs', 'group'];

// "Clutch" → clutch; "Hunter.io" → hunterio and hunter; "A & B" → ab and aandb.
function joinedNames(company) {
  const words = companyNameWords(company);
  if (!words.length) return [];
  const names = [words.join('')];
  if (words.length >= 2 && TRAILING_TLD_WORD.test(words[words.length - 1])) names.push(words.slice(0, -1).join(''));
  if (String(company || '').includes('&')) names.push(companyNameWords(String(company).replace(/&/g, ' and ')).join(''));
  return names;
}

function cleanHost(host) {
  let value = String(host || '').trim().toLowerCase();
  if (value.includes('://')) {
    try { value = new URL(value).hostname; } catch { return ''; }
  }
  return value.replace(/:\d+$/, '').replace(/\.$/, '');
}

// Same second-level rule as registrableDomain in contact-finder.mjs, kept
// here so this module has no imports: jobs.acme-group.co.uk → acme-group.co.uk.
function registrableHost(host) {
  const labels = host.split('.').filter(Boolean);
  if (labels.length < 2) return host;
  const secondLevel = labels.length >= 3 && /^(?:co|com|org|net|gov|ac|edu|ltd|plc|asso)$/.test(labels[labels.length - 2]);
  return labels.slice(-(secondLevel ? 3 : 2)).join('.');
}

/**
 * Is this host a tenant of shared hosting (acme.github.io, culture.gouv.fr)?
 * The platform is never the employer's domain, but a mail address at a
 * tenant (recrutement@culture.gouv.fr) is the tenant's own. The platform
 * itself (support@wordpress.com) is not a tenant.
 */
export function isSharedHostTenant(host) {
  const hostname = cleanHost(host).replace(/^www\./, '');
  return Boolean(hostname) && SHARED_HOST_RE.test(hostname) && hostname !== registrableHost(hostname);
}

/**
 * Is this host (or URL) never the employer's own site? Tests the full
 * hostname and its registrable domain. When the company is given and the
 * domain's core is its name, alone or with a vendor suffix, the host is its
 * own (Clutch owns clutch.co, Deel deel.com, Ashby ashbyhq.com, Factorial
 * factorialhr.com), except on shared hosting.
 */
export function isNotEmployerHost(host, { company = '' } = {}) {
  const hostname = cleanHost(host);
  if (!hostname) return false;
  const site = registrableHost(hostname);
  if (!NON_EMPLOYER_HOST_RE.test(hostname) && !NON_EMPLOYER_HOST_RE.test(site)) return false;
  if (company && !SHARED_HOST_RE.test(hostname)) {
    const core = site.split('.')[0].replace(/-/g, '');
    const names = joinedNames(company);
    if (core && names.some(name => core === name || (name.length >= 3 && OWN_DOMAIN_SUFFIXES.some(suffix => core === `${name}${suffix}`)))) return false;
  }
  return true;
}
