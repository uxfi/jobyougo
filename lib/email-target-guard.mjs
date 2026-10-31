/**
 * Guards on the application email's target, kept apart from the email
 * writer (lib/application-email.mjs):
 * - the company hint is never one of the candidate's own companies (tracker
 *   row 1052 recorded "OneAsset", Hugo's employer, for a Vertech offer);
 * - the tracker's company and role are cleaned before they reach the writer
 *   (cleanOfferIdentity);
 * - with neither posting nor company page read, a sentence that describes
 *   the company has no source: it is cut. That guard now lives in the writer
 *   (generateApplicationEmail runs it) and is re-exported here; importing
 *   this module from the writer would close the cycle application-email →
 *   email-target-guard → contact-finder → application-email.
 */
import { indexCareer } from './prompt-budget.mjs';
import { ownCompanyNames, isOwnCompany, searchableCompanyName, companyLooksLikeRole } from './contact-finder.mjs';
import { companyFromListing } from './pipeline-record.mjs';

export { stripUnsourcedCompanyBlurb } from './application-email.mjs';

export function safeCompanyHint(companyHint, cv = '') {
  const hint = String(companyHint || '').trim();
  if (!hint) return '';
  return isOwnCompany(hint, ownCompanyNames(indexCareer(String(cv || '')))) ? '' : hint;
}

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ── The offer as the tracker row names it ──────────────────────────────────
// The tracker keeps what the scan read. 16 of the 406 applied or evaluated
// rows (2026-10-23) store a page title as the role ("Chess.com hiring Product
// Designer, Design Systems Job in Remote", "Lead UX Designer - Remote -
// Indeed.com"), and 7 the candidate's own employer as the company.

// A title segment that says where the work is done: it and what follows
// ("- 100% Remote - EMEA - London") are places, not the role.
const REMOTE_SEGMENT = /^(?:\d+\s*%\s*)?(?:fully[- ]?|full[- ]?)?(?:remote|home[- ]?office|télétravail|teletravail|work from home|wfh)(?![\p{L}\d])/iu;
const CONTRACT_SEGMENT = /^(?:permanent(?: contract)?|full[- ]?time|part[- ]?time|cdi|cdd|freelance|contract|contractor|internship|stage|alternance|festanstellung|vollzeit|teilzeit)$/i;
const BOARD_SEGMENT = /^(?:indeed(?:\.com)?|linkedin|glassdoor|welcome to the jungle|wttj|behance|dribbble)$/i;
// "(m/w/d)", "(w/m/d)", "(H/F)", "(m/f/d)", "(all genders)"; never "(UI/UX)".
const GENDER_TAG = /\s*[([]\s*(?:[mwfdhx]\s*\/\s*[mwfdhx](?:\s*\/\s*[mwfdhx])?|all genders)\s*[)\]]/gi;
// "(Remote, Europe Based)", "(100% Remote Worldwide)"
const REMOTE_PAREN = /\s*\((?=[^()]*(?<!\p{L})(?:remote|home office|télétravail)(?!\p{L}))[^()]*\)/giu;
// "<Org> hiring <Role>", with "hiring" in lower case as page titles write it.
const HIRING_PREFIX = /^(.{2,70}?)\s+hiring\s+(?=\S)/;
const NOT_AN_ORG = /^(?:we(?:['’]re| are)?|now|is|are|currently|actively|urgently|who|top|best)$/i;
// "… Job in Remote", "… Jobs in Berlin", and a title cut after "Job at".
const JOB_IN_TAIL = /\s+Jobs?\s+(?:in|at|bei)(?:\s+.+)?$/i;
// Greenhouse's page title: "Job Application for Product Designer II at Extend".
const APPLICATION_FOR = /^Job Application for\s+/i;
// "H/F" and "m/w/d" written without brackets ("UX/UI Designer confirmé H/F");
// never "UI/UX".
const BARE_GENDER = /\s+(?:[HFhf]\/[HFhf](?:\/[DXdx])?|[MWFmwf]\/[MWFmwf]\/[DXdx])(?![\p{L}\d/])/gu;
// "Remote Senior Product Designer": no i flag, which would let \p{Lu} take lower case.
const REMOTE_LEAD = /^(?:[Ff]ully |100 ?% )?[Rr]emote\s+(?=\p{Lu})/u;
// A company stored with the careers page's words: "Jobs bei Saypien".
const JOBS_AT = /^(?:Jobs?|Careers?|Karriere|Stellenangebote)\s+(?:bei|at|chez|@)\s+(?=\S)/i;
const SEPARATOR = /(\s+[-–—|]\s+|\s+::\s+)/;
const compact = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\d]/gu, '');

/**
 * The company and role of an offer as the writer should read them, from a
 * tracker row: the role without the board's page-title dressing ("<Org>
 * hiring", "Job in <place>", "- Remote - Indeed.com", "(m/w/d)"), the
 * company never one of the candidate's own (then the org the title names,
 * when it names one, else ''). Only hints: a readable posting wins.
 */
export function cleanOfferIdentity({ company = '', role = '', jobUrl = '', cv = '' } = {}) {
  const own = ownCompanyNames(indexCareer(String(cv || '')));
  const usable = (value) => {
    const name = searchableCompanyName(String(value || '').trim().replace(JOBS_AT, ''));
    return name && !isOwnCompany(name, own) ? name : '';
  };
  let title = String(role || '').replace(/\s+/g, ' ').trim().replace(APPLICATION_FOR, '');
  // Glassdoor / LinkedIn titles and "Role @ Company" (lib/pipeline-record.mjs).
  // "SimpleStudy @ hirehire" for SimpleStudy: the part before "@" is the company, not a role.
  const read = companyFromListing({ title, url: jobUrl });
  const listed = read.title && compact(read.title) === compact(company) ? { company: '', title: '' } : read;
  if (listed.title) title = listed.title;
  let org = '';
  const hiring = title.match(HIRING_PREFIX);
  if (hiring && !NOT_AN_ORG.test(hiring[1].trim()) && hiring[1].trim().split(/\s+/).length <= 6) {
    org = hiring[1].trim();
    title = title.slice(hiring[0].length);
  }
  title = title.replace(JOB_IN_TAIL, '');
  let name = usable(company);
  // The company's name stored as the role ("Pennylane" / "Pennylane", 8
  // tracker rows): no role. The same text made of role words is a role
  // stored as the company, caught just below.
  if (name && compact(title) === compact(name) && !companyLooksLikeRole(name)) title = '';
  // A job title or a job board stored as the company.
  if (name && (companyLooksLikeRole(name, title) || BOARD_SEGMENT.test(name))) name = '';
  if (!name) name = usable(listed.company) || usable(org);

  // Brackets and gender tags before the segments, so that a " - " inside
  // brackets is no separator: "Design Engineer (EU/UK Based - Remote)" had
  // lost its ")", and "(m/f/d)- Physical Products" glued "Designer-".
  title = title.replace(GENDER_TAG, ' ').replace(REMOTE_PAREN, ' ').replace(BARE_GENDER, ' ')
    .replace(/\s{2,}/g, ' ').replace(/[\s,;:|–—-]+$/, '').replace(REMOTE_LEAD, '').trim();

  // Segments, the first (the role) always kept: the board's name, and the
  // location Indeed writes before it; every segment from the first place of
  // work on; then contract types and the company's own name at the end
  // ("Lead Product Design – BlaBlaCar – Permanent contract – Fully-remote").
  const parts = title.split(SEPARATOR);
  const segments = parts.filter((_, i) => i % 2 === 0).map((segment) => segment.trim());
  const separators = parts.filter((_, i) => i % 2 === 1);
  if (segments.length > 1 && BOARD_SEGMENT.test(segments[segments.length - 1])) {
    const board = segments.pop();
    if (/^indeed/i.test(board) && segments.length > 1) segments.pop();
  }
  const placeAt = segments.findIndex((segment, i) => i > 0 && REMOTE_SEGMENT.test(segment));
  if (placeAt > 0) segments.length = placeAt;
  const names = [name, org, company].map(compact).filter(Boolean);
  while (segments.length > 1 && (CONTRACT_SEGMENT.test(segments[segments.length - 1]) || names.includes(compact(segments[segments.length - 1])))) segments.pop();
  title = segments.map((segment, i) => (i ? separators[i - 1] : '') + segment).join('');

  // A role that opens on the company's name ("Infinicept UI / UX Product
  // Designer") or ends on it ("UX Designer at Multivision", and "… at
  // Baymard" for Baymard Institute: the first word of the name, at the end only).
  const firstWord = name.split(/\s+/)[0] || '';
  for (const held of [name, org].filter(Boolean)) {
    const rest = title.replace(new RegExp(`^${escapeRe(held)}\\s+`, 'i'), '');
    if (rest !== title && /^[\p{L}(]/u.test(rest) && rest.split(/\s+/).length >= 2) title = rest;
  }
  for (const held of [name, org, firstWord.length >= 4 ? firstWord : ''].filter(Boolean)) {
    title = title.replace(new RegExp(`\\s+(?:at|@|chez|bei)\\s+${escapeRe(held)}$`, 'i'), '');
  }
  title = title.replace(/\s{2,}/g, ' ').replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, '').trim();
  // A bracket a cut left open.
  if ((title.match(/\(/g) || []).length > (title.match(/\)/g) || []).length) title = title.replace(/\s*\([^()]*$/, '').trim();
  if (BOARD_SEGMENT.test(title) || /^(?:remote|home office)$/i.test(title)) title = '';
  return { company: name, role: title };
}