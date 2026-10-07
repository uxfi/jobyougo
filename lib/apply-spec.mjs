// Builds the application spec consumed by apply-runner.mjs:
// offer URL + identity fields + report answers + regional CV/location.
import { readFile, readdir, stat } from 'fs/promises';
import { join } from 'path';
import { load as yamlLoad } from 'js-yaml';
import { parseApplicationAnswersSection, parseDraftAnswersBlockH } from '../application-answers.mjs';
import { annualSalaryForForm, dailyRateForForm } from './apply-salary.mjs';
import { formDialCode, derivePractice } from './apply-fill-guards.mjs';
import { offerLocationFromText } from './apply-policy.mjs';
import { clipReportForFormAnswer, educationFromText, experienceYearsFromText, indexCareer, languagesFromText } from './prompt-budget.mjs';

const ASIA_SIGNALS = /\b(asia|apac|asie|bangkok|thailand|tha[iï]lande|singapore|singapour|hong\s*kong|tokyo|japan|japon|seoul|korea|taipei|taiwan|kuala\s*lumpur|malaysia|jakarta|indonesia|vietnam|hanoi|ho\s*chi\s*minh|manila|philippines|india|bangalore|ict\b|utc\s*\+\s*[789]|gmt\s*\+\s*[789]|jobsdb)\b/i;
// Africa shares the Paris/EU identity (declared_policy: unspecified/global →
// Paris) — listed explicitly rather than relying on the "no signal → Europe"
// fallback, so a report mentioning only an African city still resolves on
// purpose, not by accident. Deliberately no bare TZ abbreviations (CAT/EAT/WAT
// are common English words — "cat", "eat" — and would false-positive constantly.
const EU_SIGNALS = /\b(europe|eu\b|emea|paris|france|cet\b|cest\b|berlin|germany|london|uk\b|united\s*kingdom|amsterdam|netherlands|madrid|spain|lisbon|portugal|dublin|ireland|vienna|wien|austria|autriche|österreich|utc\s*\+\s*[012]\b|gmt\s*\+\s*[012]\b|european|africa|nigeria|lagos|kenya|nairobi|south\s*africa|johannesburg|cape\s*town|egypt|cairo|morocco|casablanca|ghana|accra|tunisia|tunis|rwanda|kigali|senegal|dakar|ethiopia|addis\s*ababa|c[oô]te\s*d'ivoire|ivory\s*coast|abidjan)\b/i;

export function detectRegion(reportText) {
  // Only count geography signals describing the OFFER — lines about the
  // candidate's own location/policy would otherwise contaminate the result.
  const offerText = reportText
    .split('\n')
    .filter(l => !/candidate|declared|profile\.yml|hugo/i.test(l))
    .join('\n');
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
// resolves to today.
// Local calendar date, not UTC — toISOString() converts to UTC first, which
// silently shifts the day by one near midnight in any timezone ahead of or
// behind UTC. A date input must reflect the date as read locally.
function localIsoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function computeStartDateISO(raw) {
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
  return localIsoDate(new Date());
}

export const APPLY_CV_FILENAME = 'Hugo_Vermot_CV-PRODUCT-AI-DESIGNER_compressed.pdf';

function applyCvName(preferredName = '') {
  return String(preferredName || APPLY_CV_FILENAME).trim() || APPLY_CV_FILENAME;
}

// One apply CV for every offer. Location (Paris / Bangkok) and company-tailored
// PDFs must not replace Hugo_Vermot_CV-PRODUCT-AI-DESIGNER_compressed.pdf.
export async function pickCvPath(root, _company, _region, preferredName = '') {
  const name = applyCvName(preferredName);
  const dirs = [join(root, 'output'), join(root, 'ui'), root];
  for (const dir of dirs) {
    const p = join(dir, name);
    if (await exists(p)) return p;
  }
  try {
    const files = (await readdir(join(root, 'output')))
      .filter((f) => f.toLowerCase().endsWith('.pdf') && /product[-_]?ai[-_]?designer/i.test(f));
    const exact = files.find((f) => f.toLowerCase() === name.toLowerCase());
    if (exact) return join(root, 'output', exact);
    if (files.length) return join(root, 'output', files[0]);
  } catch { /* output/ may not exist */ }
  return null;
}

// Candidate identity from config/profile.yml, resolved for a region ('asia'
// | 'europe'). Extracted out of buildApplySpec() so a caller with just a
// parsed profile + region (no report file — e.g. the apply-bridge extension
// POC probing an arbitrary test URL) can get the same fields buildApplySpec
// hands the real apply flow, instead of a second, drifting copy of this
// mapping. buildApplySpec below is the only in-repo caller today; identical
// behavior before and after this extraction.
export function buildIdentity(profile, region) {
  const candidate = profile?.candidate || {};
  const compensation = profile?.compensation || {};
  const location = profile?.location || {};
  const availability = profile?.availability || {};
  const search = profile?.search || {};
  const currentRole = search.current_role || {};

  const regional = region === 'asia'
    ? {
        city: location.asia_city || 'Bangkok',
        country: location.asia_country || 'Thailand',
        locationLabel: `${location.asia_city || 'Bangkok'}, ${location.asia_country || 'Thailand'}`,
        timezone: 'ICT (UTC+7)',
      }
    : {
        city: location.default_city || 'Paris',
        country: location.default_country || 'France',
        locationLabel: `${location.default_city || 'Paris'}, ${location.default_country || 'France'}`,
        timezone: 'CET/CEST',
      };

  const nameParts = String(candidate.full_name || '').trim().split(/\s+/).filter(Boolean);
  const salaryFormAnnual = annualSalaryForForm(compensation);
  const salaryFormDaily = dailyRateForForm(compensation);
  const phone = (region === 'asia' ? candidate.phone_asia : candidate.phone) || candidate.phone || '';

  return {
    fullName: candidate.full_name || '',
    firstName: nameParts[0] || '',
    lastName: nameParts.slice(1).join(' '),
    email: candidate.email || '',
    phone,
    location: regional.locationLabel,
    city: regional.city,
    country: regional.country,
    postal: location.postal_code || location.postal || candidate.postal_code || '',
    timezone: regional.timezone,
    linkedin: candidate.linkedin ? (candidate.linkedin.startsWith('http') ? candidate.linkedin : `https://${candidate.linkedin}`) : '',
    portfolio: candidate.portfolio_url || '',
    github: candidate.github || '',
    twitter: candidate.twitter || '',
    pronouns: candidate.pronouns || '',
    gender: candidate.gender || '',
    salary: compensation.target_range || '',
    salaryMinimum: compensation.minimum || '',
    salaryCurrency: String(compensation.currency || '').toUpperCase(),
    salaryFormAnnual: salaryFormAnnual != null ? String(salaryFormAnnual) : '',
    salaryFormDaily: salaryFormDaily != null ? String(salaryFormDaily) : '',
    dialCode: formDialCode(phone, regional.country),
    // "Which type of contract do you prefer?" / "Full-time or part-time?"
    engagement: [
      availability.desired_engagement || search.employment_preference || '',
      Array.isArray(search.contract_types) && search.contract_types.length ? `contract: ${search.contract_types.join(', ')}` : '',
    ].filter(Boolean).join('; '),
    noticePeriod: availability.notice_period || '1 week',
    startDate: availability.start_date || 'After 1 week notice',
    startDateISO: computeStartDateISO(availability.start_date),
    visaStatus: location.visa_status || '',
    workAuthEU: region === 'europe',
    // Never requires sponsorship under either declared identity: EU = French
    // citizen, Asia = already holds a work visa in Bangkok. So sponsorship /
    // "visa transfer" questions always answer No, eligibility answers Yes.
    needsSponsorship: false,
    references: 'Available upon request',
    howDidYouHear: 'Found the role while researching companies matching my criteria.',
    yearsExperience: Number(candidate.years_experience || candidate.experience_years) || undefined,
    languages: normalizeLanguages(profile?.languages || candidate.languages),
    // What screening answers follow from (lib/apply-policy.mjs): where the
    // candidate may work without sponsorship, where they can be based, and
    // the remote / on-site / travel stance in their own words.
    policy: {
      authorizedIn: Array.isArray(location.authorized_in) ? location.authorized_in.map(String) : [],
      remote: String(location.remote_policy || compensation.location_flexibility || ''),
      onsite: String(location.onsite_availability || search.onsite_availability || ''),
      bases: [
        { city: location.default_city || 'Paris', country: location.default_country || 'France' },
        (location.asia_city || location.asia_country)
          ? { city: location.asia_city || '', country: location.asia_country || '' }
          : null,
      ].filter(Boolean),
    },
    employment: {
      company: currentRole.company || '',
      title: currentRole.title || '',
      startMonth: currentRole.start_month || '',
      startYear: currentRole.start_year != null && currentRole.start_year !== ''
        ? String(currentRole.start_year)
        : '',
      current: currentRole.current !== false,
    },
  };
}

function normalizeLanguages(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      if (typeof row === 'string') {
        const [name, level] = row.split(/[:–—-]/).map((p) => p.trim());
        return name && level ? { name, level } : null;
      }
      const name = String(row?.name || row?.language || '').trim();
      const level = String(row?.level || row?.proficiency || '').trim();
      return name && level ? { name, level } : null;
    })
    .filter(Boolean);
}

// `consentOptIn` = the user explicitly approved ticking this form's optional
// recruiting consents (data retention, "contact me about future roles"…).
// Off by default: consents are the candidate's call, never a silent default.
export async function buildApplySpec({ root, reportFilename, company, role, region: regionOverride, autoSubmit = true, solveChallenges = true, consentOptIn = false }) {
  const reportPath = join(root, 'reports', reportFilename);
  const reportText = await readFile(reportPath, 'utf-8');
  const header = parseReportHeader(reportText);
  if (!header.url) throw new Error(`No **URL:** found in report ${reportFilename}`);

  const profilePath = join(root, 'config', 'profile.yml');
  let profile;
  try {
    profile = yamlLoad(await readFile(profilePath, 'utf-8'));
  } catch (err) {
    throw new Error(`config/profile.yml is invalid (${err.message})`);
  }
  const narrative = profile?.narrative || {};

  const region = (regionOverride === 'asia' || regionOverride === 'europe')
    ? regionOverride
    : detectRegion(reportText);

  const applyCv = profile?.candidate?.apply_cv || profile?.cv?.apply_pdf || APPLY_CV_FILENAME;
  const cvPath = await pickCvPath(root, company, region, applyCv);
  if (!cvPath) {
    throw new Error(`CV PDF introuvable: ${applyCvName(applyCv)} (output/ ou ui/) — le CV d'apply ne change plus selon Paris/Bangkok`);
  }

  let sideNames = [];
  let employerNames = [];
  let cvText = '';
  try {
    cvText = await readFile(join(root, 'cv.md'), 'utf-8');
    const indexed = indexCareer(cvText);
    sideNames = indexed.sideNames;
    employerNames = indexed.employerNames;
  } catch { /* no markdown CV */ }

  const identity = buildIdentity(profile, region);
  identity.yearsExperience = identity.yearsExperience || experienceYearsFromText(cvText) || undefined;
  if (!identity.languages?.length) identity.languages = languagesFromText(cvText);
  identity.education = educationFromText(cvText);
  identity.practice = derivePractice(profile, cvText);

  return {
    company: company || '',
    role: role || '',
    report: reportFilename,
    jobUrl: header.url,
    region,
    autoSubmit: !!autoSubmit,
    solveChallenges: solveChallenges !== false,
    consentOptIn: !!consentOptIn,
    cvPath,
    identity,
    // Where the job is, for "authorized to work in the country of the role?"
    // and "can you work from our office?" (lib/apply-policy.mjs).
    offerLocation: offerLocationFromText({ role, url: header.url, reportText }),
    answers: parseReportAnswers(reportText),
    reportSlice: clipReportForFormAnswer(reportText, 3200).replace(/\s*[—–]\s*/g, ', '),
    sideNames,
    employerNames,
    // Structured "who you are" facts from profile.yml — fed to the LLM fallback
    // resolver so unanticipated free-text questions ("why you?", "what makes you
    // unique?") draw on real differentiators instead of generic filler.
    narrative: {
      headline: narrative.headline || '',
      exitStory: narrative.exit_story || '',
      superpowers: Array.isArray(narrative.superpowers) ? narrative.superpowers : [],
      proofPoints: Array.isArray(narrative.proof_points)
        ? narrative.proof_points.map(p => ({ name: p?.name || '', heroMetric: p?.hero_metric || '' })).filter(p => p.name)
        : [],
    },
  };
}
