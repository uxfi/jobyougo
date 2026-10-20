// Builds the application spec consumed by apply-runner.mjs:
// offer URL + identity fields + report answers + regional CV/location.
import { readFile, readdir, stat } from 'fs/promises';
import { basename, join } from 'path';
import { load as yamlLoad } from 'js-yaml';
import { parseApplicationAnswersSection, parseDraftAnswersBlockH } from '../application-answers.mjs';
import { annualSalaryForForm, dailyRateForForm } from './apply-salary.mjs';
import { formDialCode, derivePractice } from './apply-fill-guards.mjs';
import { candidateNameRe, offerLocationFromText, offerPartOfReport } from './apply-policy.mjs';
import { countryOf, isEuCountry } from './apply-places.mjs';
import { authorizedFor, resolveLocationProfile, selectBase } from './candidate-location.mjs';
import { clipReportForFormAnswer, educationFromText, experienceYearsFromText, indexCareer, languagesFromText } from './prompt-budget.mjs';

const ASIA_SIGNALS = /\b(asia|apac|asie|bangkok|thailand|tha[iï]lande|singapore|singapour|hong\s*kong|tokyo|japan|japon|seoul|korea|taipei|taiwan|kuala\s*lumpur|malaysia|jakarta|indonesia|vietnam|hanoi|ho\s*chi\s*minh|manila|philippines|india|bangalore|ict\b|utc\s*\+\s*[789]|gmt\s*\+\s*[789]|jobsdb)\b/i;
// Africa shares the Paris/EU identity (declared_policy: unspecified/global →
// Paris) — listed explicitly rather than relying on the "no signal → Europe"
// fallback, so a report mentioning only an African city still resolves on
// purpose, not by accident. Deliberately no bare TZ abbreviations (CAT/EAT/WAT
// are common English words — "cat", "eat" — and would false-positive constantly.
const EU_SIGNALS = /\b(europe|eu\b|ue\b|europ[ée]en(?:ne)?s?|allemagne|royaume[- ]uni|pays[- ]bas|espagne|irlande|italie|italy|belgique|belgium|suisse|switzerland|emea|paris|france|cet\b|cest\b|berlin|germany|london|uk\b|united\s*kingdom|amsterdam|netherlands|madrid|spain|lisbon|portugal|dublin|ireland|vienna|wien|austria|autriche|österreich|utc\s*\+\s*[012]\b|gmt\s*\+\s*[012]\b|european|africa|nigeria|lagos|kenya|nairobi|south\s*africa|johannesburg|cape\s*town|egypt|cairo|morocco|casablanca|ghana|accra|tunisia|tunis|rwanda|kigali|senegal|dakar|ethiopia|addis\s*ababa|c[oô]te\s*d'ivoire|ivory\s*coast|abidjan)\b/i;

// Countries that take the Bangkok identity (APAC → ICT, profile.yml
// timezone_context). Every other named country takes the Paris one.
const ASIA_COUNTRIES = new Set(['Thailand', 'Singapore', 'Malaysia', 'Indonesia', 'Philippines', 'Vietnam', 'Japan', 'South Korea', 'China', 'Hong Kong', 'Taiwan', 'India', 'Australia', 'New Zealand']);

// Region from the job's own countries (offerLocationFromText). '' when the
// offer names none, or names both an Asian and a non-Asian country.
export function regionFromOfferLocation(offerLocation = {}) {
  const countries = (offerLocation?.countries || []).map((c) => countryOf(c) || c).filter(Boolean);
  if (!countries.length) return '';
  const asia = countries.filter((c) => ASIA_COUNTRIES.has(c)).length;
  if (asia === countries.length) return 'asia';
  if (asia === 0) return 'europe';
  return '';
}

// Report lines about the candidate (their own location, policy or name) are
// not about the offer. `candidateName` is the profile's full name, so a
// report sentence "<Full Name> est basé à …" does not locate the job.
export function offerLinesOf(reportText = '', candidateName = '') {
  const nameRe = candidateNameRe(candidateName);
  return offerPartOfReport(reportText)
    .split('\n')
    .filter(l => !/candidat|declared|profile\.yml|localisation actuelle|current location/i.test(l) && !(nameRe && nameRe.test(l)))
    .join('\n');
}

export function detectRegion(reportText, candidateName = '') {
  // Only count geography signals describing the OFFER — lines about the
  // candidate's own location/policy would otherwise contaminate the result.
  // French reports say "Candidat … Localisation actuelle : Thaïlande".
  const offerText = offerLinesOf(reportText, candidateName);
  const asiaHits = (offerText.match(new RegExp(ASIA_SIGNALS.source, 'gi')) || []).length;
  const euHits = (offerText.match(new RegExp(EU_SIGNALS.source, 'gi')) || []).length;
  if (asiaHits > euHits) return 'asia';
  return 'europe'; // default per profile.yml declared_policy (unspecified/global → Paris)
}

export function parseReportHeader(reportText) {
  const get = (re) => (reportText.match(re)?.[1] || '').trim();
  return {
    url: get(/\*\*URL:\*\*\s*(\S+)/i),
    date: get(/\*\*Date:\*\*\s*([0-9-]+)/i),
    score: get(/\*\*Score:\*\*\s*([\d.]+)/i),
  };
}

// Section F format: `1. **Question** *(type)*` followed by `> answer` lines.
export function parseSectionF(reportText) {
  // Newer reports: "## F) Application Form Questions & Draft Answers".
  // Match the questions section by name (letter may vary); old reports
  // ("F) Interview Plan") simply have no pre-written answers.
  const fMatch = reportText.match(/##\s*\w?\)?\s*(?:Application Form|Form Questions|Questions du formulaire)[^\n]*\n([\s\S]*?)(?=\n#\s|\n##\s|\n---\s*\n#|$)/i);
  if (!fMatch) return [];
  const block = fMatch[1];
  const items = [];
  const itemRe = /^\s*\d+\.\s+\*\*(.+?)\*\*[^\n]*\n((?:\s*>.*\n?)+)/gm;
  let m;
  while ((m = itemRe.exec(block)) !== null) {
    const question = m[1].trim();
    const answer = m[2]
      .split('\n')
      .map(l => l.replace(/^\s*>\s?/, '').trim())
      .filter(Boolean)
      .join('\n')
      .trim();
    if (question && answer) items.push({ question, answer });
  }
  return items;
}

function qaPair(item = {}) {
  const question = String(item.question || item.field || '').trim();
  const answer = String(item.answer || item.value || '').trim();
  if (!question || !answer) return null;
  return { question, answer };
}

// Prefer answers the report already paid for. Do not invent a second set of
// why-this-role / why-this-company drafts at apply time.
export function parseReportAnswers(reportText) {
  const seen = new Set();
  const out = [];
  const add = (items) => {
    for (const item of items || []) {
      const pair = qaPair(item);
      if (!pair) continue;
      const key = pair.question.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(pair);
    }
  };
  const recorded = parseApplicationAnswersSection(reportText);
  add(recorded?.freeText);
  add(recorded?.fieldValues);
  add(parseSectionF(reportText));
  add(parseDraftAnswersBlockH(reportText)?.freeText);
  return out;
}

async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}

// "Immediately available"-style free text has no literal date; native
// <input type="date"> pickers need a real ISO value, so unparseable text
// resolves to today plus the notice ("After 1 week notice" → in 7 days).
// Local calendar date, not UTC — toISOString() converts to UTC first, which
// silently shifts the day by one near midnight in any timezone ahead of or
// behind UTC. A date input must reflect the date as read locally.
function localIsoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function computeStartDateISO(raw, noticeDaysCount = 0) {
  const s = String(raw || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // DD/MM/YYYY (French convention) parsed explicitly — new Date() would assume
  // US MM/DD/YYYY for a slash-separated date and silently swap day and month.
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const [, d, mo, y] = dmy;
    if (+mo <= 12 && +d <= 31) return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const d = new Date(s);
  if (s && !Number.isNaN(d.getTime())) return localIsoDate(d);
  const start = new Date();
  start.setDate(start.getDate() + (Number(noticeDaysCount) || 0));
  return localIsoDate(start);
}

/** The apply CV the profile names (candidate.apply_cv or cv.apply_pdf); '' when none. */
// The owner's apply CV is the one config/profile.yml names: the stored
// account row can still carry an older file name, and a stored value wins
// over the local file everywhere else (2026-10-19: the Flying Bisons run
// uploaded Hugo_Vermot_CV-PRODUCT-AI-DESIGNER_compressed.pdf, the stored
// name, instead of apply_cv: Hugo_Vermot_CV.pdf).
export function preferLocalApplyCv(profile = {}, local = {}, { log = null } = {}) {
  const localName = applyCvNameOf(local);
  const current = applyCvNameOf(profile);
  if (!localName || localName === current) return profile;
  if (current && typeof log === 'function') log(`apply CV: config/profile.yml names ${localName}, the stored profile ${current}; using ${localName}`);
  return {
    ...profile,
    candidate: { ...(profile?.candidate || {}), apply_cv: localName },
    cv: profile?.cv ? { ...profile.cv, apply_pdf: localName } : profile?.cv,
  };
}
export function applyCvNameOf(profile = {}) {
  return String(profile?.candidate?.apply_cv || profile?.cv?.apply_pdf || '').trim();
}

// The slug /api/cover-letter-pdf writes (ui/server.mjs slugify): lower case,
// every other character a dash, accents too ("L'Oréal" → "l-or-al").
function letterSlug(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

// One apply CV for every offer: the PDF the profile names. Location and
// company-tailored PDFs never replace it, and no other file is guessed: in a
// shared output/ folder a guess could attach another person's CV.
/**
 * The newest cover letter PDF generated for this company and role
 * (output/cover-letter-{company-slug}-{role-slug}-{date}.pdf, written by
 * /api/cover-letter-pdf). null when none exists: the apply run then reports
 * a cover-letter slot instead of silently leaving it empty.
 */
export async function pickCoverLetterPath(root, company, role = '', dir = join(root, 'output')) {
  const companySlug = letterSlug(company);
  if (!companySlug) return null;
  // Company and role exactly, then the date: "Acme" never takes an
  // "Acme Robotics" letter. The writer names an empty role "role".
  const prefix = `cover-letter-${companySlug}-${letterSlug(role || 'role').slice(0, 40)}-`;
  try {
    const dated = (await readdir(dir))
      .map((file) => ({ file, date: file.toLowerCase().startsWith(prefix) ? (file.slice(prefix.length).match(/^(\d{4}-\d{2}-\d{2})\.pdf$/i) || [])[1] : '' }))
      .filter((row) => row.date)
      .sort((a, b) => a.date.localeCompare(b.date));
    return dated.length ? join(dir, dated[dated.length - 1].file) : null;
  } catch { return null; }
}

export async function pickCvPath(root, _company, _region, preferredName = '') {
  const name = String(preferredName || '').trim();
  // A file name only, and a PDF: a profile value never reaches another file
  // ("../config/profile.yml", "../cv.md") that the run would upload.
  if (!name || name !== basename(name) || /[\\/]/.test(name) || name.startsWith('.') || !/\.pdf$/i.test(name)) return null;
  for (const dir of [join(root, 'output'), join(root, 'ui'), root]) {
    const p = join(dir, name);
    if (await exists(p)) return p;
  }
  try {
    const exact = (await readdir(join(root, 'output'))).find((f) => f.toLowerCase() === name.toLowerCase());
    if (exact) return join(root, 'output', exact);
  } catch { /* output/ may not exist */ }
  return null;
}

/**
 * availability.current_employment, as a status the screening rules can use.
 * The onboarding saves one of five choices (CURRENT_EMPLOYMENT_VALUES in
 * lib/profile-shape.mjs); a hand-written profile.yml may hold free text
 * ("Salaried at OneAsset"). '' when nothing is known.
 *
 * @returns {''|'employed'|'employed-discreet'|'freelancing'|'between-jobs'|'student'}
 */
export function employmentStatusFrom(text) {
  const s = String(text || '').trim().toLowerCase();
  if (!s) return '';
  if (/discreet|discr[eè]te?ment|confidential/.test(s)) return 'employed-discreet';
  if (/between jobs|available now|unemployed|not (currently )?employed|sans emploi|entre deux (postes|emplois)/.test(s)) return 'between-jobs';
  if (/student|graduat|[ée]tudiant|alternan/.test(s)) return 'student';
  if (/freelanc|self[- ]employed|independent|ind[ée]pendant|contractor/.test(s)) return 'freelancing';
  if (/employed|salaried|salari[ée]|en poste|\bcdi\b/.test(s)) return 'employed';
  return '';
}

// Candidate identity for one application, from any profile (config/profile.yml
// or a Supabase account normalized by lib/profile-shape.mjs). The base the
// candidate applies from is chosen per offer among location.bases
// (lib/candidate-location.mjs selectBase): its city, country, zone and phone
// fill the form. `region` ('asia' | 'europe') is the old dashboard override and
// still picks the APAC or the European base. Nothing here is a person's
// default: a field the profile leaves empty stays empty.
export function buildIdentity(profile, region, { offerText = '', offerCountries = [] } = {}) {
  const candidate = profile?.candidate || {};
  const compensation = profile?.compensation || {};
  const location = profile?.location || {};
  const availability = profile?.availability || {};
  const search = profile?.search || {};
  const screening = profile?.screening || {};
  const currentRole = search.current_role || {};

  const loc = resolveLocationProfile(profile || {});
  const { base } = selectBase(loc, { text: offerText, countries: offerCountries, legacyRegion: region });
  const regional = base
    ? { city: base.city, country: base.country, locationLabel: base.label, timezone: base.timezoneLabel }
    : {
        city: String(location.city || ''),
        country: String(location.country || ''),
        locationLabel: String(candidate.location || [location.city, location.country].filter(Boolean).join(', ')),
        timezone: String(location.timezone || ''),
      };

  const nameParts = String(candidate.full_name || '').trim().split(/\s+/).filter(Boolean);
  const currentEmployment = String(availability.current_employment || '').trim();
  const employmentStatus = employmentStatusFrom(currentEmployment);
  // "Between jobs, available now" has no notice to serve.
  const availableNow = employmentStatus === 'between-jobs';
  const notice = String(availability.notice_period || '').trim();
  const salaryFormAnnual = annualSalaryForForm(compensation);
  const salaryFormDaily = dailyRateForForm(compensation);
  const phone = base?.phone || candidate.phone || '';
  // Sponsorship for the base this application is made from: none where the
  // candidate may already work, else what the profile says.
  const baseAuthorized = base ? authorizedFor(loc, base.country) : null;
  const needsSponsorship = baseAuthorized === false || (baseAuthorized == null && location.needs_sponsorship === true);
  // The onboarding edits location.nationality: it wins over the YAML-only
  // candidate.nationalities.
  const splitNationality = (text) => text.split(/\s*[,/&]\s*|\s+and\s+/).filter(Boolean);
  const nationalities = String(location.nationality || '').trim() ? splitNationality(String(location.nationality).trim())
    : list(candidate.nationalities).length ? list(candidate.nationalities)
      : (loc.nationality ? splitNationality(loc.nationality) : []);
  const noticePeriodDays = Number(availability.notice_period_days) || noticeDays(notice) || (availableNow ? 0 : null);

  return {
    fullName: candidate.full_name || '',
    firstName: candidate.first_name || nameParts[0] || '',
    lastName: candidate.last_name || nameParts.slice(1).join(' '),
    preferredName: candidate.preferred_name || '',
    email: candidate.email || '',
    phone,
    whatsapp: candidate.whatsapp === true ? phone : String(candidate.whatsapp || ''),
    location: regional.locationLabel,
    city: regional.city,
    country: regional.country,
    postal: base?.postalCode || location.postal_code || location.postal || candidate.postal_code || '',
    address: location.address && typeof location.address === 'object' ? location.address : null,
    usState: String(location.us_state || (base && base.country !== 'United States' ? 'Outside US' : '')),
    timezone: regional.timezone,
    utcOffset: base?.utcOffset ?? null,
    base: base ? { id: base.id, label: base.label, city: base.city, country: base.country, status: base.status, regions: base.regions } : null,
    linkedin: candidate.linkedin ? (candidate.linkedin.startsWith('http') ? candidate.linkedin : `https://${candidate.linkedin}`) : '',
    portfolio: candidate.portfolio_url || '',
    github: candidate.github || '',
    twitter: candidate.twitter || '',
    website: candidate.website || '',
    resumeUrl: candidate.resume_url || '',
    introVideoUrl: candidate.intro_video_url || '',
    pronouns: candidate.pronouns || screening.eeo?.pronouns || '',
    // screening.eeo.gender is the onboarding's answer; an empty one is its
    // "Prefer not to say" and declines, whatever the YAML-only candidate.gender says.
    gender: screening.eeo && typeof screening.eeo === 'object' && 'gender' in screening.eeo
      ? String(screening.eeo.gender ?? '').trim()
      : String(candidate.gender || ''),
    nationality: nationalities[0] || '',
    nationalities,
    salary: compensation.target_range || '',
    salaryMinimum: compensation.minimum || '',
    salaryCurrency: String(compensation.currency || '').toUpperCase(),
    salaryFormAnnual: salaryFormAnnual != null ? String(salaryFormAnnual) : '',
    salaryFormDaily: salaryFormDaily != null ? String(salaryFormDaily) : '',
    salaryExpectations: Array.isArray(compensation.expectations) ? compensation.expectations.filter((e) => e && typeof e === 'object') : [],
    currentSalary: compensation.current && typeof compensation.current === 'object' ? compensation.current : null,
    fxRates: compensation.fx_rates && typeof compensation.fx_rates === 'object' ? compensation.fx_rates : {},
    // candidate.apply_portfolio_file: cv = a required portfolio FILE slot gets the CV PDF.
    portfolioFile: String(candidate.apply_portfolio_file || '').trim().toLowerCase(),
    dialCode: formDialCode(phone, regional.country),
    // "Which type of contract do you prefer?" / "Full-time or part-time?"
    engagement: [
      availability.desired_engagement || search.employment_preference || '',
      Array.isArray(search.contract_types) && search.contract_types.length ? `contract: ${search.contract_types.join(', ')}` : '',
    ].filter(Boolean).join('; '),
    contractTypes: list(search.contract_types),
    sectors: list(search.sector_preferences),
    targetRoles: targetRolesOf(profile?.target_roles),
    noticePeriod: notice || (availableNow ? 'None, available now' : ''),
    noticePeriodDays,
    startDate: availability.start_date || (availableNow ? 'Immediately' : (notice ? `After ${notice} notice` : '')),
    startDateISO: computeStartDateISO(availability.start_date, noticePeriodDays),
    daysPerWeek: Number(availability.days_per_week) || null,
    hoursPerWeek: Number(availability.hours_per_week) || null,
    // Only when the profile says something: identity stays the same object
    // for a profile without availability.current_employment.
    ...(currentEmployment ? { currentEmployment, employmentStatus } : {}),
    visaStatus: location.visa_status || '',
    workAuthEU: Boolean(base && isEuCountry(base.country) && baseAuthorized !== false),
    needsSponsorship,
    needsSponsorshipElsewhere: location.needs_sponsorship === true,
    workStatus: base?.status || '',
    references: String(screening.references || 'Available upon request'),
    howDidYouHear: String(screening.how_did_you_hear || 'Found the role while researching companies matching my criteria.'),
    yearsExperience: Number(candidate.years_experience || candidate.experience_years) || undefined,
    languages: normalizeLanguages(profile?.languages || candidate.languages),
    education: normalizeEducation(candidate.education),
    certifications: list(candidate.certifications),
    skills: normalizeSkills(candidate.skills),
    aiProficiency: String(candidate.ai_proficiency || ''),
    // "How many people have you managed?" is answered from this fact or not
    // at all: without it the model wrote "No direct reports" for a founder
    // who managed seven designers.
    management: candidate.people_management && typeof candidate.people_management === 'object'
      ? {
          maxDirectReports: Number(candidate.people_management.max_direct_reports) || 0,
          currentDirectReports: Number(candidate.people_management.current_direct_reports) || 0,
          context: String(candidate.people_management.context || '').trim(),
        }
      : undefined,
    // Answers forms ask beyond the CV (profile `screening` section).
    screening: normalizeScreening(screening),
    // What screening answers follow from (lib/apply-policy.mjs): where the
    // candidate may work without sponsorship, where they can be based, the
    // remote stance, the on-site exceptions, travel and relocation.
    policy: {
      authorizedIn: Array.isArray(location.authorized_in) ? location.authorized_in.map(String) : [],
      remote: String(location.remote_policy || compensation.location_flexibility || ''),
      onsite: loc.onsiteText,
      fullRemoteOnly: loc.fullRemoteOnly,
      onsiteExceptions: loc.onsiteExceptions.map(({ city, country, modes }) => ({ city, country, modes })),
      travel: loc.travel,
      relocation: loc.relocation,
      bases: loc.bases.map((b) => ({ city: b.city, country: b.country })),
    },
    employment: {
      company: currentRole.company || '',
      title: currentRole.title || '',
      startMonth: currentRole.start_month || '',
      startYear: currentRole.start_year != null && currentRole.start_year !== ''
        ? String(currentRole.start_year)
        : '',
      // Between jobs: the last role is not current unless the profile says so
      // ("I currently work here" stays unticked).
      current: availableNow ? currentRole.current === true : currentRole.current !== false,
    },
    employmentHistory: normalizeHistory(candidate.employment_history),
  };
}

function list(value) {
  if (Array.isArray(value)) return value.map((v) => String(v ?? '').trim()).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return value.split(/\s*[,;]\s*/).filter(Boolean);
  return [];
}

// target_roles.primary and the archetype names; a Supabase row may hold the list itself.
function targetRolesOf(roles) {
  if (Array.isArray(roles) || typeof roles === 'string') return list(roles);
  if (!roles || typeof roles !== 'object') return [];
  const archetypes = Array.isArray(roles.archetypes) ? roles.archetypes.map((a) => (a && typeof a === 'object' ? a.name : a)) : [];
  return [...list(roles.primary), ...list(archetypes)];
}

// "1 week" → 7, "1 month" / "1 mois" → 30, "2 semaines" → 14; null when unreadable.
export function noticeDays(text) {
  const m = String(text || '').toLowerCase().match(/(\d+(?:[.,]\d+)?)\s*(day|jour|week|semaine|month|mois)/);
  if (!m) return /immediate|available now|imm[ée]diat|none|aucun/.test(String(text || '').toLowerCase()) ? 0 : null;
  const n = Number.parseFloat(m[1].replace(',', '.'));
  const unit = m[2];
  return Math.round(n * (/day|jour/.test(unit) ? 1 : /week|semaine/.test(unit) ? 7 : 30));
}

// CEFR level a spoken level stands for, for "English level (A1–C2)" lists.
const CEFR_OF_LEVEL = [
  [/native|maternel|mother tongue|bilingu/i, 'C2'],
  [/fluent|courant|full professional|c2/i, 'C2'],
  [/professional|advanced|avanc|c1/i, 'C1'],
  [/upper[- ]intermediate|b2/i, 'B2'],
  [/intermediate|interm[ée]diaire|conversational|b1/i, 'B1'],
  [/basic|elementary|notion|beginner|d[ée]butant|a2|a1/i, 'A2'],
];

// Languages as {name, level, cefr}: objects, "French: Native" or the
// onboarding's "French (native)".
export function normalizeLanguages(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      let name = '';
      let level = '';
      let cefr = '';
      if (typeof row === 'string') {
        const paren = row.match(/^\s*([^()]+?)\s*\(([^)]+)\)\s*$/);
        const parts = paren ? [paren[1], paren[2]] : row.split(/[:–—-]/);
        [name, level] = parts.map((p) => String(p || '').trim());
      } else {
        name = String(row?.name || row?.language || '').trim();
        level = String(row?.level || row?.proficiency || '').trim();
        cefr = String(row?.cefr || '').trim().toUpperCase();
      }
      if (!name || !level) return null;
      cefr = /^[ABC][12]$/.test(cefr) ? cefr : (CEFR_OF_LEVEL.find(([re]) => re.test(level))?.[1] || '');
      return { name, level, ...(cefr ? { cefr } : {}) };
    })
    .filter(Boolean);
}

// Education as [{degree, field, school, country, start_year, end_year, level}].
function normalizeEducation(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row) => row && typeof row === 'object')
    .map((row) => ({
      degree: String(row.degree || '').trim(),
      field: String(row.field || row.discipline || '').trim(),
      school: String(row.school || row.institution || '').trim(),
      country: String(row.country || '').trim(),
      startYear: String(row.start_year || '').trim(),
      endYear: String(row.end_year || row.graduation_year || '').trim(),
      level: String(row.level || '').trim(),
    }))
    .filter((row) => row.degree || row.school);
}

// Skills or tools with their years: [{name, years, level}].
function normalizeSkills(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => (typeof row === 'string' ? { name: row.trim() } : row && typeof row === 'object' ? row : null))
    .filter((row) => row && String(row.name || '').trim())
    .map((row) => ({ name: String(row.name).trim(), years: Number(row.years) || null, level: String(row.level || '').trim() }));
}

function normalizeHistory(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row) => row && typeof row === 'object' && (row.company || row.title))
    .map((row) => ({
      company: String(row.company || '').trim(),
      title: String(row.title || '').trim(),
      start: String(row.start || '').trim(),
      end: String(row.end || '').trim(),
      current: row.current === true,
      location: String(row.location || '').trim(),
    }));
}

// EEO choices default to declining; consents to the conservative choice.
const EEO_DECLINE = 'Prefer not to say';
function normalizeScreening(s = {}) {
  const eeo = s.eeo && typeof s.eeo === 'object' ? s.eeo : {};
  const consents = s.consents && typeof s.consents === 'object' ? s.consents : {};
  const pick = (value) => String(value ?? '').trim();
  return {
    howDidYouHear: pick(s.how_did_you_hear),
    referredBy: s.referred_by && typeof s.referred_by === 'object' ? s.referred_by : (pick(s.referred_by) ? { name: pick(s.referred_by) } : null),
    knowsEmployees: s.knows_employees === true,
    relativesAtCompany: s.relatives_at_company === true,
    previouslyApplied: Array.isArray(s.previously_applied) ? s.previously_applied.filter((row) => row && typeof row === 'object') : [],
    previouslyEmployedAt: list(s.previously_employed_at),
    backgroundCheckOk: s.background_check_ok !== false,
    referenceCheckOk: s.reference_check_ok !== false,
    nonCompete: s.non_compete === true || (s.non_compete && typeof s.non_compete === 'object' && s.non_compete.bound === true),
    securityClearance: pick(s.security_clearance?.held ?? s.security_clearance),
    drivingLicence: s.driving_licence && typeof s.driving_licence === 'object' ? s.driving_licence : (s.driving_licence === true ? { has: true } : null),
    isAdult: s.is_adult !== false,
    consents: {
      // null: never answered (the run's consentOptIn decides).
      futureRoles: typeof consents.future_roles === 'boolean' ? consents.future_roles : null,
      marketing: consents.marketing === true,
      dataRetention: consents.data_retention === true,
      profileVisibility: pick(consents.profile_visibility),
    },
    eeo: {
      gender: pick(eeo.gender),
      raceEthnicity: pick(eeo.race_ethnicity) || EEO_DECLINE,
      veteran: pick(eeo.veteran) || EEO_DECLINE,
      disability: pick(eeo.disability) || EEO_DECLINE,
      sexualOrientation: pick(eeo.sexual_orientation) || EEO_DECLINE,
      religion: pick(eeo.religion) || EEO_DECLINE,
      ageRange: pick(eeo.age_range) || EEO_DECLINE,
      declinePhrases: list(eeo.decline_phrases),
    },
    customAnswers: Array.isArray(s.custom_answers)
      ? s.custom_answers
        .filter((row) => row && typeof row === 'object' && pick(row.question) && pick(row.answer))
        .map((row) => ({
          question: pick(row.question),
          answer: pick(row.answer),
          // Optional: a regex for the questions it answers and the list rows it picks.
          ...(pick(row.match) ? { match: pick(row.match) } : {}),
          ...(list(row.prefer_options).length ? { preferOptions: list(row.prefer_options).map((o) => String(o)).filter(Boolean) } : {}),
        }))
      : [],
  };
}

// `consentOptIn` = the user explicitly approved ticking this form's optional
// recruiting consents (data retention, "contact me about future roles"…).
// Off by default: consents are the candidate's call, never a silent default.
//
// `profile`, `cvMarkdown` and `reportText` come from the signed-in account
// (getProfile / getCvMarkdown / its report); without them the local files
// under `root` are read (config/profile.yml, cv.md, reports/). `digest` goes
// with a stored CV: null reads the owner's article-digest.md, '' has none.
//
// `accountCvPath` / `letterDir`: the account's own attachments
// (lib/apply-account-files.mjs). undefined reads the shared output/ folder
// (local mode, the owner); a null accountCvPath means the account has no CV
// PDF, and output/ is never searched for one.
export async function buildApplySpec({
  root, reportFilename, company, role, region: regionOverride,
  autoSubmit = true, solveChallenges = true, consentOptIn = false,
  profile: profileInput = null, cvMarkdown = null, reportText: reportInput = null, voice = null, digest = '',
  accountCvPath = undefined, letterDir = undefined,
}) {
  const reportText = typeof reportInput === 'string' && reportInput
    ? reportInput
    : await readFile(join(root, 'reports', reportFilename), 'utf-8');
  const header = parseReportHeader(reportText);
  if (!header.url) throw new Error(`No **URL:** found in report ${reportFilename}`);

  let profile = profileInput;
  if (!profile) {
    try {
      profile = yamlLoad(await readFile(join(root, 'config', 'profile.yml'), 'utf-8'));
    } catch (err) {
      throw new Error(`config/profile.yml is invalid (${err.message})`);
    }
  }
  const narrative = profile?.narrative || {};
  const candidateName = profile?.candidate?.full_name || '';

  // The job's own countries pick the base; word counts over the report only
  // when it names none. A French report on a German job counted "Thaïlande"
  // from the candidate lines and no "Allemagne", so the job got the Asian base.
  const offerLocation = offerLocationFromText({ role, url: header.url, reportText, candidateName });
  const legacyRegion = (regionOverride === 'asia' || regionOverride === 'europe') ? regionOverride : '';
  const offerText = [role, offerLinesOf(reportText, candidateName).split('\n').filter((l) => /locali|location|remote|hybrid|on-?site|based|bureau|office|lieu/i.test(l)).slice(0, 12).join('\n')]
    .filter(Boolean).join('\n');

  const ownFiles = accountCvPath !== undefined;
  const applyCv = ownFiles ? '' : applyCvNameOf(profile);
  const cvPath = ownFiles ? (accountCvPath || null) : await pickCvPath(root, company, legacyRegion, applyCv);
  if (!cvPath) {
    throw new Error(ownFiles
      ? 'No CV PDF on your account yet: add the PDF sent with every application (Profile, or the onboarding CV step).'
      : applyCv
        ? `CV PDF introuvable : ${applyCv} (output/ ou ui/).`
        : 'Aucun CV d’apply dans le profil : renseigne candidate.apply_cv (le PDF envoyé avec chaque candidature).');
  }
  const coverLetterPath = await pickCoverLetterPath(root, company, role, letterDir || join(root, 'output'));

  let sideNames = [];
  let employerNames = [];
  let cvText = typeof cvMarkdown === 'string' ? cvMarkdown : '';
  if (!cvText && cvMarkdown == null) {
    try { cvText = await readFile(join(root, 'cv.md'), 'utf-8'); } catch { /* no markdown CV */ }
  }
  if (cvText) {
    const indexed = indexCareer(cvText);
    sideNames = indexed.sideNames;
    employerNames = indexed.employerNames;
  }

  const identity = buildIdentity(profile, legacyRegion, { offerText, offerCountries: offerLocation.countries });
  identity.yearsExperience = identity.yearsExperience || experienceYearsFromText(cvText) || undefined;
  if (!identity.languages?.length) identity.languages = languagesFromText(cvText);
  // Structured education from the profile first, else the CV's first entry.
  if (!identity.education?.length) identity.education = educationFromText(cvText);
  identity.practice = derivePractice(profile, cvText);
  // The legacy region switch still drives the dashboard and the CV PDF name.
  const region = identity.base?.regions?.includes('APAC') ? 'asia' : 'europe';

  return {
    company: company || '',
    role: role || '',
    report: reportFilename,
    jobUrl: header.url,
    region,
    baseId: identity.base?.id || '',
    autoSubmit: !!autoSubmit,
    solveChallenges: solveChallenges !== false,
    consentOptIn: !!consentOptIn,
    cvPath,
    // Latest generated letter for this company, or null (lib/apply-fill-guards
    // fileUploadPlan uploads it on a cover-letter slot).
    coverLetterPath,
    identity,
    // Where the job is, for "authorized to work in the country of the role?"
    // and "can you work from our office?" (lib/apply-policy.mjs).
    offerLocation,
    answers: parseReportAnswers(reportText),
    reportSlice: clipReportForFormAnswer(reportText, 3200).replace(/\s*[—–]\s*/g, ', '),
    sideNames,
    employerNames,
    // The account's own CV and writing voice for free-text answers. null:
    // the engines read the local files (local mode, or the owner).
    cvMarkdown: typeof cvMarkdown === 'string' ? cvText : null,
    digest: digest === null ? null : String(digest || ''),
    voice: typeof voice === 'string' ? voice : null,
    // Structured "who you are" facts from the profile — fed to the LLM fallback
    // resolver so unanticipated free-text questions ("why you?", "what makes you
    // unique?") draw on real differentiators instead of generic filler.
    narrative: {
      headline: narrative.headline || '',
      exitStory: narrative.exit_story || '',
      nextRole: narrative.next_role || '',
      superpowers: Array.isArray(narrative.superpowers) ? narrative.superpowers : [],
      proofPoints: Array.isArray(narrative.proof_points)
        ? narrative.proof_points.map(p => ({ name: p?.name || '', heroMetric: p?.hero_metric || '' })).filter(p => p.name)
        : [],
    },
  };
}
