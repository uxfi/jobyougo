// Work mode of a posting (remote / hybrid / onsite / unknown) for the
// pipeline profile gate (evaluateOfferAgainstProfile in ui/server.mjs), which
// hard-rejects non-remote offers for a full-remote profile before Jev and Qwen.
//
// The ATS's own field comes first: Ashby workplaceType/isRemote, Lever
// workplaceType, Workable workplace/remote, the Greenhouse location name. The
// JD text regexes only run when no field says anything. On 2026-10-16 the text
// rejected n8n "Internal AI Enablement Lead", `workplaceType: Remote` on Ashby,
// because its description said "some roles… are hybrid". When the text says
// both (a fully remote role with "quarterly on-site meetups"), the mode is
// 'unknown' with `ambiguous: true`, so Jev reads the posting instead of a
// hard reject.
import { placesIn } from './apply-places.mjs';

function normalizeInline(value = '') {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

export function inferWorkModeFromText(text = '') {
  // One line: descriptions keep their line breaks, and ".{0,40}" windows stop at them.
  const content = String(text || '').replace(/\s+/g, ' ');
  const lower = content.toLowerCase();
  const snippets = [];

  const collect = (patterns, source = lower) => {
    for (const pattern of patterns) {
      const match = source.match(pattern);
      if (match) {
        const start = Math.max(0, match.index - 40);
        const end = Math.min(content.length, match.index + match[0].length + 80);
        snippets.push(normalizeInline(content.slice(start, end)));
      }
    }
  };

  // "Hybrid" that is not this job's mode (2026-10-16: n8n, a remote role,
  // "some roles, like sales in the US, are hybrid"; Melio "hybrid UX and UI";
  // Valtech "remote and hybrid work options"). Blanked at the same length so
  // evidence snippets still line up with `content`.
  const blank = (match) => ' '.repeat(match.length);
  const hybridText = lower
    .replace(/\bhybrid\s+(?:ux|ui|pm|product|design(?:er)?|profiles?|skill ?sets?|backgrounds?|apps?|mobile|cloud|architecture|infrastructure|search|ai|ml|vehicles?|cars?|engines?)\b/g, blank)
    .replace(/\bsome (?:of our )?(?:roles|positions|teams)\b[^.]{0,80}\bhybrid\b/g, blank)
    .replace(/\bremote\s*(?:and|or|\/|&|,)\s*hybrid\b|\bhybrid\s*(?:and|or|\/|&|,)\s*remote\b/g, (match) => 'remote'.padEnd(match.length));
  // "N days a week" needs its "a"/"per": "4 day week" (4dayweek.io, a
  // compressed week) says nothing about the office.
  const hybridPatterns = [
    /\bhybrid\b/,
    /\b\d+\s*(?:-|to)\s*\d+\s*days?\s*(?:a|per)\s*week\b/,
    /\b\d+\s*days?\s*(?:a|per)\s*week\b/,
    /\bin[- ]office\b/,
    /\bon-?site\b/,
    /\boffice[- ]based\b/,
    // French postings: "télétravail jusqu'à 3 jours/semaine", "2 jours sur site".
    /\b(?:mode|travail|poste|format|rythme|t[ée]l[ée]travail) hybride\b|\ben hybride\b/,
    /\bt[ée]l[ée]travail\s*:?\s*(?:partiel|jusqu['’]?(?:à|a)\s*\d|\d+\s*jours?)/,
    /\b\d+\s*jours?(?:\s*(?:\/|par)\s*semaine)?\s*(?:de\s+)?t[ée]l[ée]travail\b/,
    /\b\d+\s*jours?(?:\s*(?:\/|par)\s*semaine)?\s*(?:sur site|au bureau|en pr[ée]sentiel|dans nos locaux)\b/,
  ];
  const fullyRemotePatterns = [
    /\bfull(?:y)? remote\b/,
    /\bremote[- ]first\b/,
    // French: "100 % télétravail", "télétravail complet", "full télétravail".
    /\b(?:100\s*%|full|total)\s*(?:en\s+)?t[ée]l[ée]travail\b|\bt[ée]l[ée]travail\s*(?:complet|total|(?:à|a)\s*100\s*%)/,
  ];
  // A remote allowance ("6 week remote working policy", "work from anywhere
  // 4 weeks a year") is a perk of an office job, unless the posting is fully remote.
  const remoteAllowance = /\b\d+[- ]?weeks?\s+(?:of\s+)?(?:remote|work(?:ing)? from anywhere)\b|\b(?:remote|work(?:ing)? from anywhere)\b.{0,40}\b\d+\s*weeks?\s*(?:a|per)\s*year\b/;
  // "Must be based in Paris" is attendance. "Must be based in the EU" or "in
  // France" is a residency clause (inferResidencyLockFromText): the role stays
  // remote. A city-state (Singapore) reads as the country.
  const cityClause = [...lower.matchAll(/\bmust be (?:based|located) (?:in|near)\s+([^.;:()]{2,80})/g)]
    .find(([, clause]) => placesIn(clause.split(/,|\/|\bor\b|\band\b/)[0]).cities.some(({ city, country }) => city !== country.toLowerCase()));
  const onsitePatterns = [
    /\bon-?site only\b/,
    /\bfully on-?site\b/,
    /\bmust relocate\b/,
    /\brelocation required\b/,
    /\b5\s*days?\s*(?:a|per)\s*week\b/,
    /\b(?:at|out of) our [a-z ]+ office\b/,
    /\b(?:based|located) in our [a-z ]+ office\b/,
    ...(cityClause ? [new RegExp(cityClause[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))] : []),
    /\b(?:100\s*%|full|poste en)\s*pr[ée]sentiel\b/,
    ...(fullyRemotePatterns.some(pattern => pattern.test(lower)) ? [] : [remoteAllowance]),
  ];
  // "Remote" that names a method or a tool, not where the job is done (2026-10-26:
  // HeyMax, a Singapore role, read as remote because of "remote unmoderated tests").
  const remoteWordText = lower
    .replace(/\bremote\s+(?:unmoderated|moderated|usability|user|testing|tests?|research|interviews?|sessions?|access|desktop|control|server|monitoring|sensing|debugging|repositor(?:y|ies))\b/g, blank)
    .replace(/\b(?:unmoderated|moderated)\s+remote\b/g, blank);
  const remotePatterns = [
    ...fullyRemotePatterns,
    /\bwork from anywhere\b/,
    /\bdistributed team\b/,
    /\bremote within\b/,
    /\bremote role\b/,
    /\bremote\b/,
  ];

  // Wording that makes the role itself remote. Bare "remote" and "work from
  // anywhere" are not enough: hybrid postings use both ("2 days remote",
  // "work from anywhere 4 weeks a year"). "Not a fully remote role" is no claim.
  const strongRemotePatterns = [
    ...fullyRemotePatterns,
    /\b100\s*%\s*remote\b/,
    /\bremote role\b/,
    /\bremote within\b/,
    /\b(?:this|the) (?:role|position|job) is (?:a )?remote\b/,
  ];
  const remoteClaimText = lower.replace(/\b(?:not|never|no longer|isn['’]t)\s+(?:an?\s+)?(?:full(?:y)?\s+|100\s*%\s*)?remote\b[- \w]{0,12}/g, blank);
  const strongRemote = strongRemotePatterns.some(pattern => pattern.test(remoteClaimText));
  // A remote claim next to office wording ("fully remote, with quarterly
  // on-site meetups"): no deterministic answer, Jev reads the posting.
  const ambiguous = (patterns, source) => {
    collect(patterns, source);
    collect(strongRemotePatterns, remoteClaimText);
    return { mode: 'unknown', ambiguous: true, evidence: snippets.slice(0, 4) };
  };

  if (onsitePatterns.some(pattern => pattern.test(lower))) {
    if (strongRemote) return ambiguous(onsitePatterns, lower);
    collect(onsitePatterns);
    return { mode: 'onsite', evidence: snippets.slice(0, 3) };
  }
  if (hybridPatterns.some(pattern => pattern.test(hybridText))) {
    if (strongRemote) return ambiguous(hybridPatterns, hybridText);
    collect(hybridPatterns, hybridText);
    return { mode: 'hybrid', evidence: snippets.slice(0, 3) };
  }
  if (remotePatterns.some(pattern => pattern.test(remoteWordText))) {
    collect(remotePatterns, remoteWordText);
    return { mode: 'remote', evidence: snippets.slice(0, 3) };
  }
  return { mode: 'unknown', evidence: [] };
}

// Where a posting puts its attendance: the location lines and the sentences
// that set a hybrid or on-site work mode ("This role is based in our Bangkok
// office"). A city named elsewhere ("teams in Bangkok") or in a negated
// sentence ("Not open to candidates in Bangkok") is not where the job is.
export function attendancePlaceText(text = '') {
  return String(text || '')
    .split(/\n+|(?<=[.!?;])\s+/)
    .filter(part => !/\b(?:no|not|never|except|pas|jamais|sauf)\b/i.test(part))
    .filter(part => /^\s*(?:[-*•]\s*)?(?:\*\*)?(?:job\s+)?(?:location|lieu|localisation)\b[^:]{0,20}:/i.test(part)
      || ['hybrid', 'onsite'].includes(inferWorkModeFromText(part).mode))
    .join('\n');
}

// Okta Barcelona, HelloFresh Berlin and Deliveroo London (reports 734-736,
// 2026-10-15) say nothing about where the work happens: only the location
// field names a city. The work mode read "unknown", the gate let them through,
// and Qwen spent a full evaluation to reject them as on-site. A posting whose
// location lines name a city, with no remote wording anywhere, is an office
// job. A country or region alone ("Spain", "EMEA") stays unknown, since remote
// postings often carry one; a city-state (Singapore) reads as the country.
export function impliedOfficeModeFromText(text = '') {
  const content = String(text || '');
  if (/\bremote\b|\banywhere\b|\bwork(?:ing)? from home\b|\bhome[- ]based\b|\bt[ée]l[ée]travail\b|(?:à|a) distance\b/i.test(content)) {
    return { mode: 'unknown', evidence: [] };
  }
  const lines = content.split(/\n+/)
    .map(line => line.match(/^\s*(?:[-*•]\s*)?(?:\*\*)?(?:job\s+)?(?:locations?|lieu|localisation)\b[^:]{0,20}:\s*(?:\*\*)?\s*(.+)$/i)?.[1]?.trim())
    .filter(Boolean);
  const offices = lines.filter(line =>
    placesIn(line).cities.some(({ city, country }) => city !== country.toLowerCase()));
  if (!offices.length) return { mode: 'unknown', evidence: [] };
  return { mode: 'onsite', implied: true, evidence: offices.slice(0, 3).map(line => `Location: ${normalizeInline(line)}`) };
}

const WORK_MODES = { remote: 'remote', hybrid: 'hybrid', onsite: 'onsite', inoffice: 'onsite', office: 'onsite' };

// "Remote", "OnSite", "on_site", "on-site", "In office" → the gate's modes.
// Anything else ("unspecified", empty) is no answer.
function workModeValue(value) {
  return WORK_MODES[String(value ?? '').toLowerCase().replace(/[^a-z]/g, '')] || '';
}

// A free location name ("Remote - EMEA", "Hybrid - London", "Berlin") as a
// mode. A city alone says nothing here: the text's implied-office rule reads it.
function workModeFromLocationName(name = '') {
  const lower = String(name || '').toLowerCase();
  const remote = /\bremote\b|\banywhere\b|\bwork from home\b/.test(lower);
  const office = /\bhybrid\b/.test(lower) ? 'hybrid' : /\bon-?site\b|\bin[- ]office\b/.test(lower) ? 'onsite' : '';
  if (remote && office) return { mode: 'unknown', ambiguous: true };
  return { mode: remote ? 'remote' : office || 'unknown' };
}

const uniqueNames = values => [...new Set(values.map(normalizeInline).filter(Boolean))];

/**
 * The work mode the ATS states for one posting, from its raw API JSON:
 * { mode, source, locations, evidence, ambiguous? }. mode is 'unknown' when
 * the posting carries no usable field.
 *   ashby       one entry of /posting-api/job-board/{org} `jobs`
 *   lever       /v0/postings/{slug}/{id}?mode=json
 *   workable    /api/v2/accounts/{account}/jobs/{shortcode}
 *   greenhouse  /v1/boards/{board}/jobs/{id}
 */
export function structuredWorkMode(source, job) {
  const empty = { mode: 'unknown', source, locations: [], evidence: [] };
  if (!job || typeof job !== 'object') return empty;
  let mode = '';
  let field = '';
  let ambiguous = false;
  let locations = [];
  if (source === 'ashby') {
    // isRemote is false on hybrid and on-site postings alike: only true counts.
    mode = workModeValue(job.workplaceType) || (job.isRemote === true ? 'remote' : '');
    field = job.workplaceType ? `workplaceType: ${job.workplaceType}` : 'isRemote: true';
    const secondary = Array.isArray(job.secondaryLocations) ? job.secondaryLocations.map(entry => entry?.location) : [];
    locations = uniqueNames([job.location, ...secondary]);
  } else if (source === 'lever') {
    mode = workModeValue(job.workplaceType);
    field = `workplaceType: ${job.workplaceType}`;
    const categories = job.categories || {};
    locations = uniqueNames(Array.isArray(categories.allLocations) && categories.allLocations.length ? categories.allLocations : [categories.location]);
  } else if (source === 'workable') {
    mode = workModeValue(job.workplace) || (job.remote === true ? 'remote' : '');
    field = job.workplace ? `workplace: ${job.workplace}` : 'remote: true';
    const places = Array.isArray(job.locations) && job.locations.length ? job.locations : [job.location];
    locations = uniqueNames(places.map(place => [place?.city, place?.region, place?.country].filter(Boolean).join(', ')));
  } else if (source === 'greenhouse') {
    const name = normalizeInline(job.location?.name || '');
    ({ mode, ambiguous = false } = workModeFromLocationName(name));
    field = `location: ${name}`;
    const offices = Array.isArray(job.offices) ? job.offices.map(office => office?.location || office?.name) : [];
    locations = uniqueNames([name, ...offices]);
  } else {
    return empty;
  }
  if (!mode || mode === 'unknown') return { ...empty, locations, ...(ambiguous ? { ambiguous, evidence: [`${source} ${field}`] } : {}) };
  return {
    mode,
    source,
    locations,
    evidence: [`${source} ${field}`, ...(locations.length ? [`Location: ${locations.slice(0, 6).join(' · ')}`] : [])],
  };
}

/**
 * The gate's work mode: the ATS field when it states one, else the JD text
 * (stated wording, then the implied-office rule). An ambiguous field or
 * ambiguous text stays 'unknown' so the gate lets Jev decide.
 */
export function resolveWorkMode(text = '', structured = null) {
  if (structured && ['remote', 'hybrid', 'onsite'].includes(structured.mode)) return { ...structured, structured: true };
  if (structured?.ambiguous) return { mode: 'unknown', ambiguous: true, source: structured.source, evidence: structured.evidence || [], structured: true };
  const stated = inferWorkModeFromText(text);
  if (stated.mode !== 'unknown' || stated.ambiguous) return { ...stated, source: 'text' };
  return { ...impliedOfficeModeFromText(text), source: 'text' };
}
