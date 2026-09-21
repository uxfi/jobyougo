// Builds the application spec consumed by apply-runner.mjs:
// offer URL + identity fields + Section F answers + regional CV/location.
import { readFile, readdir, stat } from 'fs/promises';
import { join } from 'path';
import { load as yamlLoad } from 'js-yaml';
import { annualSalaryForForm, dailyRateForForm } from './apply-salary.mjs';
import { formDialCode } from './apply-fill-guards.mjs';

const ASIA_SIGNALS = /\b(asia|apac|asie|bangkok|thailand|tha[iï]lande|singapore|singapour|hong\s*kong|tokyo|japan|japon|seoul|korea|taipei|taiwan|kuala\s*lumpur|malaysia|jakarta|indonesia|vietnam|hanoi|ho\s*chi\s*minh|manila|philippines|india|bangalore|ict\b|utc\s*\+\s*[789]|gmt\s*\+\s*[789]|jobsdb)\b/i;
// Africa shares the Paris/EU identity (declared_policy: unspecified/global →
// Paris) — listed explicitly rather than relying on the "no signal → Europe"
// fallback, so a report mentioning only an African city still resolves on
// purpose, not by accident. Deliberately no bare TZ abbreviations (CAT/EAT/WAT
// are common English words — "cat", "eat" — and would false-positive constantly.
const EU_SIGNALS = /\b(europe|eu\b|emea|paris|france|cet\b|cest\b|berlin|germany|london|uk\b|united\s*kingdom|amsterdam|netherlands|madrid|spain|lisbon|portugal|dublin|ireland|utc\s*\+\s*[012]\b|gmt\s*\+\s*[012]\b|european|africa|nigeria|lagos|kenya|nairobi|south\s*africa|johannesburg|cape\s*town|egypt|cairo|morocco|casablanca|ghana|accra|tunisia|tunis|rwanda|kigali|senegal|dakar|ethiopia|addis\s*ababa|c[oô]te\s*d'ivoire|ivory\s*coast|abidjan)\b/i;

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

function slugify(value = '') {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// CV priority: offer-tailored PDF in output/, then regional complete CV, then ui/ defaults.
export async function pickCvPath(root, company, region) {
  const companySlug = slugify(company);
  const regionLabel = region === 'asia' ? 'Bangkok' : 'Paris';
  if (companySlug) {
    try {
      const files = (await readdir(join(root, 'output')))
        .filter(f => f.toLowerCase().endsWith('.pdf') && !f.startsWith('cover-letter') && f.toLowerCase().includes(companySlug))
        .sort()
        .reverse();
      if (files.length) return join(root, 'output', files[0]);
    } catch { /* output/ may not exist */ }
  }
  const candidates = [
    join(root, 'output', `Hugo_Vermot_CV_Complete_${regionLabel}.pdf`),
    join(root, 'ui', `Hugo_Vermot_CV_${regionLabel}.pdf`),
    join(root, 'ui', 'Hugo_Vermot_CV.pdf'),
  ];
  for (const c of candidates) {
    if (await exists(c)) return c;
  }
  return null;
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
  const candidate = profile?.candidate || {};
  const compensation = profile?.compensation || {};
  const location = profile?.location || {};
  const availability = profile?.availability || {};
  const narrative = profile?.narrative || {};

  const region = (regionOverride === 'asia' || regionOverride === 'europe')
    ? regionOverride
    : detectRegion(reportText);

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

  const cvPath = await pickCvPath(root, company, region);
  if (!cvPath) throw new Error('No CV PDF found (output/ or ui/)');

  const search = profile?.search || {};
  const currentRole = search.current_role || {};
  const nameParts = String(candidate.full_name || '').trim().split(/\s+/).filter(Boolean);
  const salaryFormAnnual = annualSalaryForForm(compensation);
  const salaryFormDaily = dailyRateForForm(compensation);
  const phone = (region === 'asia' ? candidate.phone_asia : candidate.phone) || candidate.phone || '';

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
    identity: {
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
      salaryFormAnnual: salaryFormAnnual != null ? String(salaryFormAnnual) : '',
      salaryFormDaily: salaryFormDaily != null ? String(salaryFormDaily) : '',
      dialCode: formDialCode(phone, regional.country),
      noticePeriod: availability.notice_period || 'Immediate',
      startDate: availability.start_date || 'Immediately available',
      startDateISO: computeStartDateISO(availability.start_date),
      visaStatus: location.visa_status || '',
      workAuthEU: region === 'europe',
      // Never requires sponsorship under either declared identity: EU = French
      // citizen, Asia = already holds a work visa in Bangkok. So sponsorship /
      // "visa transfer" questions always answer No, eligibility answers Yes.
      needsSponsorship: false,
      references: 'Available upon request',
      howDidYouHear: 'Found the role while researching companies matching my criteria.',
      employment: {
        company: currentRole.company || 'OneAsset',
        title: currentRole.title || 'Senior Product Designer / Product Lead',
        startMonth: currentRole.start_month || 2,
        startYear: String(currentRole.start_year || 2026),
        current: currentRole.current !== false,
      },
    },
    answers: parseSectionF(reportText),
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
