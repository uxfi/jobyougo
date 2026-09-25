/**
 * Extensible ATS catalogue: URL rewrite, DOM signatures, expected controls,
 * and navigation behaviors. Add a vendor by pushing an entry — host match is
 * first-hit, so keep specific hosts above broad ones.
 *
 * urlNormalize must preserve query strings (URL.pathname, never string append).
 */

function parseUrl(url) {
  try { return new URL(String(url || '')); } catch { return null; }
}

function withSuffix(url, suffix) {
  const u = parseUrl(url);
  if (!u) return url;
  const extra = suffix.startsWith('/') ? suffix : `/${suffix}`;
  const path = u.pathname.replace(/\/$/, '');
  if (path.endsWith(extra.replace(/\/$/, '')) || path.includes(`${extra}/`) || path.endsWith(extra)) return url;
  u.pathname = `${path}${extra}`;
  return u.toString();
}

export const ATS_CATALOG = [
  {
    id: 'lever',
    hosts: [/jobs\.lever\.co$/i, /jobs\.eu\.lever\.co$/i],
    domSignatures: ['.postings-btn-wrapper', '[data-qa="btn-apply"]', '.application-form'],
    expectedButtons: ['Apply', 'Submit application'],
    expectedFields: ['name', 'email', 'phone', 'resume'],
    behaviors: ['normalize-url', 'resume-autofill'],
    urlNormalize(url) {
      const u = parseUrl(url);
      if (!u) return url;
      const p = u.pathname.replace(/\/$/, '');
      if (/\/[0-9a-f-]{36}$/i.test(p)) {
        u.pathname = `${p}/apply`;
        return u.toString();
      }
      return url;
    },
  },
  {
    id: 'ashby',
    hosts: [/jobs\.ashbyhq\.com$/i],
    domSignatures: ['[class*="ashby"]', '[name*="_systemfield_"]'],
    expectedButtons: ['Apply', 'Submit application'],
    expectedFields: ['name', 'email', 'resume'],
    behaviors: ['normalize-url', 'scroll-to-form', 'resume-autofill'],
    urlNormalize(url) {
      const u = parseUrl(url);
      if (!u) return url;
      const p = u.pathname.replace(/\/$/, '');
      if (p && !/\/application(?:\/|$)/.test(p)) {
        u.pathname = `${p}/application`;
        return u.toString();
      }
      return url;
    },
  },
  {
    id: 'workable',
    hosts: [/apply\.workable\.com$/i, /jobs\.workable\.com$/i],
    domSignatures: ['[data-ui="application-form"]', '.careers-apply'],
    expectedButtons: ['Apply', 'Submit'],
    expectedFields: ['name', 'email', 'phone', 'resume'],
    behaviors: ['normalize-url'],
    urlNormalize(url) {
      const u = parseUrl(url);
      if (!u) return url;
      if (!/apply\.workable\.com$/i.test(u.hostname)) return url;
      const p = u.pathname.replace(/\/$/, '');
      if (/\/j\//.test(p) && !/\/apply$/.test(p)) {
        u.pathname = `${p}/apply`;
        return u.toString();
      }
      return url;
    },
  },
  {
    id: 'greenhouse',
    hosts: [/greenhouse\.io$/i],
    domSignatures: ['#application', '#application_form', '[id*="greenhouse"]'],
    expectedButtons: ['Apply', 'Submit application'],
    expectedFields: ['first name', 'last name', 'email', 'resume'],
    behaviors: ['scroll-to-form', 'resume-autofill'],
  },
  {
    id: 'smartrecruiters',
    hosts: [/smartrecruiters\.com$/i],
    domSignatures: ['spl-dropzone', 'spl-input', '[class*="oneclick" i]'],
    expectedButtons: ['Apply', "I'm interested"],
    expectedFields: ['name', 'email', 'phone', 'resume'],
    behaviors: ['normalize-url', 'wait-spa'],
    urlNormalize(url) {
      const u = parseUrl(url);
      if (!u) return url;
      if (!/^jobs\.smartrecruiters\.com$/i.test(u.hostname)) return url;
      if (/oneclick-ui/i.test(u.pathname)) return url;
      const m = u.pathname.match(/^\/([^/]+)\/(\d{6,})\/?$/);
      if (!m) return url;
      u.pathname = `/oneclick-ui/company/${m[1]}/publication/${m[2]}`;
      return u.toString();
    },
  },
  {
    id: 'workday',
    hosts: [/myworkdayjobs\.com$/i, /myworkdaysite\.com$/i],
    domSignatures: ['[data-automation-id="jobPostingPage"]', '[data-automation-id*="apply"]'],
    expectedButtons: ['Apply', 'Apply Manually'],
    expectedFields: ['name', 'email', 'phone', 'resume'],
    behaviors: ['normalize-url', 'wait-spa'],
    urlNormalize(url) {
      const u = parseUrl(url);
      if (!u) return url;
      const p = u.pathname.replace(/\/$/, '');
      if (!/\/job\//.test(p)) return url;
      if (/\/apply(\/applyManually)?$/.test(p)) return url;
      u.pathname = `${p}/apply`;
      return u.toString();
    },
  },
  {
    id: 'icims',
    hosts: [/icims\.com$/i],
    domSignatures: ['#iCIMS_content', '[id*="icims"]', 'iframe[src*="icims"]'],
    expectedButtons: ['Apply', 'Apply for this job'],
    expectedFields: ['name', 'email', 'resume'],
    behaviors: ['wait-spa'],
  },
  {
    id: 'oracle-taleo',
    hosts: [/taleo\.net$/i],
    domSignatures: ['#requisitionDescriptionInterface', '.taleoContent'],
    expectedButtons: ['Apply', 'Apply Online'],
    expectedFields: ['name', 'email', 'resume'],
    behaviors: ['normalize-url'],
    urlNormalize(url) {
      const u = parseUrl(url);
      if (!u) return url;
      if (!/jobdetail\.ftl/i.test(u.pathname)) return url;
      u.pathname = u.pathname.replace(/jobdetail\.ftl/i, 'jobapply.ftl');
      return u.toString();
    },
  },
  {
    id: 'successfactors',
    hosts: [/successfactors\.(com|eu)$/i, /sapsf\.(com|eu)$/i, /jobs2web\.com$/i],
    domSignatures: ['[data-help-id]', '.rcmFormElement'],
    expectedButtons: ['Apply', 'Apply now'],
    expectedFields: ['name', 'email', 'resume'],
    behaviors: ['wait-spa'],
  },
  {
    id: 'recruitee',
    hosts: [/recruitee\.com$/i],
    domSignatures: ['[data-testid*="application"]', '.application-form'],
    expectedButtons: ['Apply', 'Submit application'],
    expectedFields: ['name', 'email', 'phone', 'resume'],
    behaviors: ['normalize-url'],
    urlNormalize(url) {
      const u = parseUrl(url);
      if (!u) return url;
      const p = u.pathname.replace(/\/$/, '');
      if (!/^\/o\/[^/]+$/.test(p)) return url;
      u.pathname = `${p}/c/new`;
      return u.toString();
    },
  },
  {
    id: 'teamtailor',
    hosts: [/teamtailor\.com$/i],
    domSignatures: ['[data-controller*="application"]', '.application-form'],
    expectedButtons: ['Apply', 'Send application'],
    expectedFields: ['name', 'email', 'phone', 'resume'],
    behaviors: ['normalize-url'],
    urlNormalize(url) {
      const u = parseUrl(url);
      if (!u) return url;
      const p = u.pathname.replace(/\/$/, '');
      if (!/\/jobs\/[^/]+$/.test(p) || /\/applications\//.test(p)) return url;
      u.pathname = `${p}/applications/new`;
      return u.toString();
    },
  },
  {
    id: 'bamboohr',
    hosts: [/bamboohr\.com$/i],
    domSignatures: ['#careerApplicationForm', '.BambooHR-ATS'],
    expectedButtons: ['Apply for this Job', 'Submit'],
    expectedFields: ['name', 'email', 'phone', 'resume'],
    behaviors: ['normalize-url', 'scroll-to-form'],
    urlNormalize(url) {
      const u = parseUrl(url);
      if (!u) return url;
      const p = u.pathname.replace(/\/$/, '');
      if (!/^\/careers\/[^/]+$/.test(p)) return url;
      return withSuffix(url, '/apply');
    },
  },
  {
    id: 'jazzhr',
    hosts: [/applytojob\.com$/i, /jazz\.co$/i],
    domSignatures: ['#resumator-apply', '.resumator-application'],
    expectedButtons: ['Apply', 'Submit application'],
    expectedFields: ['name', 'email', 'phone', 'resume'],
    behaviors: ['scroll-to-form'],
  },
  {
    id: 'breezy',
    hosts: [/breezy\.hr$/i],
    domSignatures: ['.apply-form', '[class*="breezy"]'],
    expectedButtons: ['Apply', 'Submit'],
    expectedFields: ['name', 'email', 'resume'],
    behaviors: ['normalize-url'],
    urlNormalize(url) {
      const u = parseUrl(url);
      if (!u) return url;
      const p = u.pathname.replace(/\/$/, '');
      if (!/^\/p\/[^/]+$/.test(p)) return url;
      return withSuffix(url, '/apply');
    },
  },
  {
    id: 'welcometothejungle',
    hosts: [/welcometothejungle\.com$/i],
    path: /\/jobs\//i,
    domSignatures: ['[data-testid*="apply"]', 'a[href*="apply"]'],
    expectedButtons: ['Apply', 'Postuler'],
    expectedFields: ['name', 'email', 'resume'],
    behaviors: ['external-apply'],
  },
  {
    id: 'linkedin',
    hosts: [/linkedin\.com$/i],
    path: /\/jobs\/view\//i,
    domSignatures: ['.jobs-easy-apply-modal', '[data-test-modal="easy-apply"]'],
    expectedButtons: ['Easy Apply', 'Submit application', 'Next'],
    expectedFields: ['phone', 'resume'],
    behaviors: ['modal-apply'],
  },
  {
    id: 'indeed',
    hosts: [/indeed\.com$/i, /indeed\.fr$/i],
    path: /\/viewjob/i,
    domSignatures: ['#indeedApplyButton', '[id*="indeed-apply"]'],
    expectedButtons: ['Apply now', 'Postuler', 'Indeed Apply'],
    expectedFields: ['name', 'email', 'resume'],
    behaviors: ['modal-apply'],
  },
  {
    id: 'wellfound',
    hosts: [/wellfound\.com$/i, /angel\.co$/i],
    path: /\/jobs\/|\/l\//i,
    domSignatures: ['[data-test="JobApplication"]', 'button[data-test*="apply" i]'],
    expectedButtons: ['Apply', 'Apply now'],
    expectedFields: ['name', 'email', 'resume'],
    behaviors: ['new-tab-apply'],
  },
  {
    id: 'otta',
    hosts: [/otta\.com$/i],
    path: /\/jobs\//i,
    domSignatures: ['[data-testid*="apply"]'],
    expectedButtons: ['Apply', 'Easy apply'],
    expectedFields: ['name', 'email', 'resume'],
    behaviors: ['external-apply'],
  },
  {
    id: 'welcomekit',
    hosts: [/welcomekit\.co$/i],
    domSignatures: ['.job-application', '[class*="application-form"]'],
    expectedButtons: ['Apply', 'Postuler'],
    expectedFields: ['name', 'email', 'phone', 'resume'],
    behaviors: ['scroll-to-form'],
  },
];

const AGGREGATOR_IDS = new Set([
  'welcometothejungle', 'linkedin', 'indeed', 'wellfound', 'otta', 'welcomekit',
]);

export function identifyAts(url) {
  const u = parseUrl(url);
  if (!u) return null;
  const host = u.hostname;
  const pathAndQuery = `${u.pathname}${u.search}`;
  for (const entry of ATS_CATALOG) {
    if (!entry.hosts.some((re) => re.test(host))) continue;
    if (entry.path && !entry.path.test(pathAndQuery)) continue;
    return entry;
  }
  return null;
}

export function isAggregatorAts(url) {
  const entry = identifyAts(url);
  return !!(entry && AGGREGATOR_IDS.has(entry.id));
}

/** Rewrite a known job URL onto its application path. Unknown URLs pass through. */
export function normalizeAtsUrl(url) {
  const entry = identifyAts(url);
  if (!entry?.urlNormalize) return url;
  try {
    const next = entry.urlNormalize(url);
    return typeof next === 'string' && next ? next : url;
  } catch {
    return url;
  }
}
