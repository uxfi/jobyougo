import { readFile } from 'fs/promises';
import { load as yamlLoad } from 'js-yaml';
import { join } from 'path';
import { parseHeading } from './prompt-budget.mjs';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function hasOwn(obj, key) {
  return Boolean(obj) && Object.prototype.hasOwnProperty.call(obj, key);
}

function compactLabel(value, max = 28) {
  const text = cleanString(value);
  if (!text || text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 3)).trim()}...`;
}

function ensureUrl(value, fallbackProtocol = 'https://') {
  const raw = cleanString(value);
  if (!raw) return '';
  if (/^[a-z]+:\/\//i.test(raw)) return raw;
  return `${fallbackProtocol}${raw.replace(/^\/+/, '')}`;
}

function displayFromUrl(value) {
  const url = ensureUrl(value);
  if (!url) return '';
  return url.replace(/^https?:\/\//i, '').replace(/\/$/, '');
}

function normalizeLinkedIn(value, fallback = {}, preferFallback = false) {
  const raw = preferFallback
    ? cleanString(value) || cleanString(fallback.linkedin_url) || cleanString(fallback.linkedin)
    : cleanString(value);
  const url = ensureUrl(raw);
  const display = url ? url.replace(/^https?:\/\//i, '').replace(/\/$/, '') : '';
  return {
    linkedin: display,
    linkedin_url: url,
    linkedin_display: display,
  };
}

function normalizeTwitter(value, fallback = {}, preferFallback = false) {
  const raw = preferFallback
    ? cleanString(value) || cleanString(fallback.twitter_url) || cleanString(fallback.twitter)
    : cleanString(value);
  if (!raw) {
    return { twitter: '', twitter_url: '', twitter_display: '' };
  }

  const handle = raw
    .replace(/^https?:\/\/(www\.)?(twitter|x)\.com\//i, '')
    .replace(/^@/, '')
    .replace(/\/.*$/, '')
    .trim();

  if (!handle) {
    return { twitter: '', twitter_url: '', twitter_display: '' };
  }

  return {
    twitter: handle,
    twitter_url: `https://twitter.com/${handle}`,
    twitter_display: `@${handle}`,
  };
}

function normalizePortfolio(value, fallback = {}, preferFallback = false) {
  const raw = preferFallback
    ? cleanString(value) || cleanString(fallback.portfolio)
    : cleanString(value);
  const url = ensureUrl(raw);
  return {
    portfolio: url,
    portfolio_display: displayFromUrl(url) || 'View Portfolio',
  };
}

function buildLocation(candidate = {}, location = {}, fallback = '') {
  if (cleanString(candidate.location)) return cleanString(candidate.location);
  const parts = [cleanString(location.city), cleanString(location.country)].filter(Boolean);
  return parts.join(', ') || fallback;
}

function buildSummary(profileConfig = {}, baseProfile = {}) {
  const narrative = profileConfig.narrative || {};
  const exitStory = cleanString(narrative.exit_story);
  return exitStory || cleanString(baseProfile.summary);
}

function buildHighlights(profileConfig = {}, baseProfile = {}) {
  const narrative = profileConfig.narrative || {};
  const proofPoints = cleanArray(narrative.proof_points);

  const mapped = proofPoints
    .map((point) => {
      const name = cleanString(point?.name);
      const metric = cleanString(point?.hero_metric);
      if (!name && !metric) return '';
      return [name, metric].filter(Boolean).join(': ');
    })
    .filter(Boolean)
    .slice(0, 3);

  if (mapped.length) return mapped;

  const superpowers = cleanArray(narrative.superpowers).map(cleanString).filter(Boolean).slice(0, 3);
  if (superpowers.length) return superpowers;

  return cleanArray(baseProfile.highlights);
}

function buildAvailabilityTags(profileConfig = {}, baseProfile = {}) {
  return cleanArray(baseProfile.availability_tags).map((tag) => ({ ...tag }));
}

function buildSkillSections(baseProfile = {}, baseShared = {}) {
  const profileSections = cleanArray(baseProfile.skill_sections);
  if (profileSections.length) return profileSections;

  const skills = baseShared.skills || {};
  return [
    { title: 'AI & LLM Systems', items: cleanArray(skills.ai) },
    { title: 'Product & Design', items: cleanArray(skills.design) },
    { title: 'Build Stack', items: cleanArray(skills.tech) },
  ].filter(section => cleanArray(section.items).length);
}

function buildSharedContact(profileConfig = {}, baseShared = {}) {
  const candidate = profileConfig.candidate || {};
  const location = profileConfig.location || {};
  const baseContact = baseShared.contact || {};
  const fullName = hasOwn(candidate, 'full_name') ? cleanString(candidate.full_name) : cleanString(baseContact.name);
  const email = hasOwn(candidate, 'email') ? cleanString(candidate.email) : cleanString(baseContact.email);
  const phone = hasOwn(candidate, 'phone') ? cleanString(candidate.phone) : cleanString(baseContact.phone);
  const rawLocation = hasOwn(candidate, 'location')
    ? cleanString(candidate.location)
    : buildLocation(candidate, location, cleanString(baseContact.location));

  return {
    ...baseContact,
    name: fullName,
    email,
    phone,
    location: rawLocation || buildLocation({}, location, ''),
    ...normalizeLinkedIn(candidate.linkedin, baseContact, !hasOwn(candidate, 'linkedin')),
    ...normalizeTwitter(candidate.twitter, baseContact, !hasOwn(candidate, 'twitter')),
    ...normalizePortfolio(candidate.portfolio_url, baseContact, !hasOwn(candidate, 'portfolio_url')),
    ...(candidate.portfolio_display ? { portfolio_display: cleanString(candidate.portfolio_display) } : {}),
    github: hasOwn(candidate, 'github') ? cleanString(candidate.github) : cleanString(baseContact.github),
  };
}

function mergeTemplateData(baseData, tailoredData = {}) {
  const baseProfile = baseData.profile || {};
  const baseShared = baseData.shared || {};
  const profileOverride = tailoredData.profile || {};
  const sharedOverride = tailoredData.shared || {};

  return {
    profile: {
      ...baseProfile,
      ...profileOverride,
    },
    shared: {
      ...baseShared,
      ...sharedOverride,
      contact: {
        ...(baseShared.contact || {}),
        ...(sharedOverride.contact || {}),
      },
    },
  };
}

export async function loadCvTemplateData(rootDir, profileKey = 'ai_builder', tailoredData = {}) {
  const profilesData = yamlLoad(await readFile(join(rootDir, 'data/cv-profiles.yml'), 'utf-8'));
  const baseProfile = profilesData[profileKey] || profilesData.ai_builder || {};
  const baseShared = profilesData.shared || {};

  let profileConfig = {};
  try {
    profileConfig = yamlLoad(await readFile(join(rootDir, 'config/profile.yml'), 'utf-8')) || {};
  } catch {
    profileConfig = {};
  }

  const useProfileConfig = baseProfile.use_profile_config !== false;
  const resolvedProfile = {
    ...baseProfile,
    headline: useProfileConfig
      ? cleanString(profileConfig?.narrative?.headline) || cleanString(baseProfile.headline)
      : cleanString(baseProfile.headline),
    summary: useProfileConfig ? buildSummary(profileConfig, baseProfile) : cleanString(baseProfile.summary),
    target_roles: useProfileConfig && cleanArray(profileConfig?.target_roles?.primary).length
      ? cleanArray(profileConfig.target_roles.primary)
      : cleanArray(baseProfile.target_roles),
    highlights: useProfileConfig ? buildHighlights(profileConfig, baseProfile) : cleanArray(baseProfile.highlights),
    highlights_title: cleanString(baseProfile.highlights_title) || 'Key Achievement Highlights',
    projects_title: cleanString(baseProfile.projects_title) || 'Products & Ventures',
    availability_tags: buildAvailabilityTags(profileConfig, baseProfile),
    skill_sections: buildSkillSections(baseProfile, baseShared),
    experience: cleanArray(baseProfile.experience).length
      ? cleanArray(baseProfile.experience)
      : cleanArray(baseShared.experience),
  };

  const resolvedShared = {
    ...baseShared,
    contact: buildSharedContact(profileConfig, baseShared),
  };

  return mergeTemplateData(
    {
      profile: resolvedProfile,
      shared: resolvedShared,
    },
    tailoredData,
  );
}

// ─── Template data from an account's own profile + CV markdown ──────────────
//
// data/cv-profiles.yml and config/profile.yml describe one person: the
// repository owner. A signed-in account on the hosted dashboard has neither —
// its profile lives in public.profiles and its CV in profiles.cv_markdown — so
// the PDF route used to render the owner's CV for every other account.
// buildCvTemplateDataFromProfile() derives the same {profile, shared} contract
// loadCvTemplateData() returns, from the account's data alone. Nothing is
// invented: an empty section stays empty and the template hides it.

const EXPERIENCE_HEADINGS = /experience|work history|employment|career|positions|missions/i;
const EDUCATION_HEADINGS = /education|formation|studies|academic/i;
const SKILLS_HEADINGS = /skills|competenc|stack|tools|technolog|expertise/i;
const SUMMARY_HEADINGS = /summary|profile|about|overview/i;
const PROJECT_HEADINGS = /projects|selected work|portfolio|side projects|ventures/i;
const LANGUAGE_HEADINGS = /^languages?$|^langues?$/i;
const CERT_HEADINGS = /certifications?|awards?|honou?rs|distinctions/i;
const ROLE_WORDS = /engineer|designer|manager|developer|lead|head|director|founder|consultant|analyst|architect|scientist|product|marketing|sales|intern|officer|specialist|owner|cto|ceo|coo|vp\b/i;
const DATE_LINE = /(\b(19|20)\d{2}\b|\bpresent\b|\bcurrent\b|\btoday\b|\bnow\b|\ben cours\b)/i;
const YEAR_TAIL = /\(?((?:19|20)\d{2}(?:\s*[-–—]\s*(?:(?:19|20)\d{2}|present))?)\)?\s*$/i;

// Only emphasis markers go: an underscore inside a word ("jane_doe",
// "scikit_learn") or a URL is content, not markup.
function stripInlineMarkdown(text = '') {
  const raw = String(text);
  // The emphasis and link patterns below backtrack quadratically on runs of
  // '[', '*' or spaces; a line this long is body text, so only the markers go.
  if (raw.length > 500) {
    return raw
      .replace(/\[([^\]\n]{0,300})\]\([^)\s]{0,500}\)/g, '$1')
      .replace(/[*_`]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return raw
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(^|[\s(["'])\*(?=\S)(.+?)(?<=\S)\*(?=$|[\s).,;:!?'"\]])/g, '$1$2')
    .replace(/(^|[\s(["'])_(?=\S)(.+?)(?<=\S)_(?=$|[\s).,;:!?'"\]])/g, '$1$2')
    .replace(/^\*+\s*|\s*\*+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// templates/premium-cv.html is rendered by a plain {{path}} substitution with
// no escaping, so every string from the account's own CV and profile is
// escaped here: "<5% churn" or "R&D" must not break the page, and a quote in
// a URL must not break out of an href.
function escapeHtmlDeep(value) {
  if (typeof value === 'string') {
    return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  if (Array.isArray(value)) return value.map(escapeHtmlDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, escapeHtmlDeep(v)]));
  }
  return value;
}

function splitH2Sections(markdown = '') {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  const sections = [];
  let current = { title: '', lines: [] };
  for (const line of lines) {
    const h2 = parseHeading(line, 2);
    if (h2 !== null) {
      sections.push(current);
      current = { title: h2, lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  sections.push(current);
  return sections;
}

function isBullet(line = '') {
  return /^\s*[-*•]\s+/.test(line);
}

function bulletText(line = '') {
  return stripInlineMarkdown(line.replace(/^\s*[-*•]\s+/, ''));
}

// Read by hand (lib/prompt-budget.mjs): the regex form backtracked cubically
// on a long run of spaces in a heading line.
function h3Title(line = '') {
  return parseHeading(line, 3);
}

function splitYearTail(text = '') {
  const m = text.match(YEAR_TAIL);
  if (!m) return { body: text, year: '' };
  const body = text.slice(0, text.lastIndexOf(m[0])).replace(/[,\s—–-]+$/, '').trim();
  return { body, year: m[1].trim() };
}

/**
 * "### Company" / "**Role**" / "2021 - Present" / bullets — the layout
 * AGENTS.md asks for in cv.md. Also accepts "### Role — Company" and
 * "### Role at Company" headings and a "Role | Company | 2021-2023" line.
 */
function parseExperience(lines = []) {
  const entries = [];
  let entry = null;
  const flush = () => { if (entry && (entry.company || entry.role)) entries.push(entry); entry = null; };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const heading = h3Title(line);
    if (heading !== null) {
      flush();
      const text = stripInlineMarkdown(heading);
      entry = { company: '', role: '', period: '', bullets: [] };
      const split = text.split(/\s+(?:—|–|-|@|at|\|)\s+/i);
      if (split.length >= 2) {
        const roleFirst = ROLE_WORDS.test(split[0]);
        entry.role = roleFirst ? split[0] : split[1];
        entry.company = roleFirst ? split[1] : split[0];
        const tail = split.slice(2).join(' ');
        if (tail && DATE_LINE.test(tail)) entry.period = tail;
      } else {
        entry.company = text;
      }
      continue;
    }
    if (!entry) {
      // Section without H3s: "**Role**, Company (2020-2022)" lines.
      if (isBullet(line) && entries.length) { entries[entries.length - 1].bullets.push(bulletText(line)); continue; }
      const bold = line.match(/^\*\*(.+?)\*\*\s*[,—–-]?\s*(.*)$/);
      if (bold) {
        const { body, year } = splitYearTail(stripInlineMarkdown(bold[2]));
        entries.push({ role: stripInlineMarkdown(bold[1]), company: body, period: year, bullets: [] });
      }
      continue;
    }
    if (isBullet(line)) { entry.bullets.push(bulletText(line)); continue; }
    const bold = line.match(/^\*\*(.+?)\*\*\s*(.*)$/);
    if (bold && !entry.role) {
      entry.role = stripInlineMarkdown(bold[1]);
      const rest = stripInlineMarkdown(bold[2]).replace(/^[,—–|-]\s*/, '');
      if (rest && DATE_LINE.test(rest) && !entry.period) entry.period = rest;
      continue;
    }
    const pipeLine = line.split('|').map(s => stripInlineMarkdown(s)).filter(Boolean);
    if (pipeLine.length >= 2 && !entry.role) {
      entry.role = pipeLine[0];
      if (!entry.company) entry.company = pipeLine[1];
      if (pipeLine[2] && DATE_LINE.test(pipeLine[2])) entry.period = pipeLine[2];
      continue;
    }
    if (DATE_LINE.test(line) && !entry.period && line.length <= 60) { entry.period = stripInlineMarkdown(line); continue; }
    if (!entry.role && line.length <= 90) { entry.role = stripInlineMarkdown(line); continue; }
    if (line.length > 3) entry.bullets.push(stripInlineMarkdown(line));
  }
  flush();
  return entries.map(e => ({ ...e, bullets: e.bullets.filter(Boolean).slice(0, 8) }));
}

function parseEducation(lines = []) {
  const out = [];
  let pending = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const heading = h3Title(line);
    const text = stripInlineMarkdown(heading !== null ? heading : line.replace(/^\s*[-*•]\s+/, ''));
    if (!text) continue;
    if (heading !== null) { pending = { degree: text, school: '', year: '' }; out.push(pending); continue; }
    if (pending && !pending.school && !isBullet(raw)) {
      const { body, year } = splitYearTail(text);
      pending.school = body;
      pending.year = year;
      pending = null;
      continue;
    }
    const { body, year } = splitYearTail(text);
    const parts = body.split(/\s*(?:—|–|,|\|| at )\s*/).filter(Boolean);
    out.push({ degree: parts[0] || body, school: parts.slice(1).join(', '), year });
    pending = null;
  }
  return out.filter(e => e.degree).slice(0, 6);
}

function parseSkillSections(lines = []) {
  const sections = [];
  let current = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const heading = h3Title(line);
    if (heading !== null) { current = { title: stripInlineMarkdown(heading), items: [] }; sections.push(current); continue; }
    const text = line.replace(/^\s*[-*•]\s+/, '');
    const labelled = text.match(/^\*{0,2}([^:*]{2,40})\*{0,2}\s*:\s*(.+)$/);
    const items = (labelled ? labelled[2] : text)
      .split(/\s*[,;·•|]\s*/)
      .map(stripInlineMarkdown)
      .filter(item => item && item.length <= 40);
    if (!items.length) continue;
    if (labelled) {
      sections.push({ title: stripInlineMarkdown(labelled[1]), items });
      current = null;
    } else if (current) {
      current.items.push(...items);
    } else {
      current = { title: 'Skills', items };
      sections.push(current);
    }
  }
  return sections
    .map(s => ({ title: s.title || 'Skills', items: [...new Set(s.items)].slice(0, 14) }))
    .filter(s => s.items.length)
    .slice(0, 5);
}

function parseProjects(lines = []) {
  const out = [];
  let current = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const heading = h3Title(line);
    if (heading !== null) {
      const link = heading.match(/\[([^\]]+)\]\(([^)]+)\)/);
      current = { name: stripInlineMarkdown(link ? link[1] : heading), url: link ? link[2] : '', desc: '', bullets: [] };
      out.push(current);
      continue;
    }
    if (!current) {
      if (isBullet(line)) {
        const text = line.replace(/^\s*[-*•]\s+/, '');
        const bold = text.match(/^\*\*(.+?)\*\*\s*[—–:-]?\s*(.*)$/);
        const link = text.match(/\[([^\]]+)\]\(([^)]+)\)/);
        out.push({
          name: stripInlineMarkdown(bold ? bold[1] : (link ? link[1] : text.split(/[—–:]/)[0])),
          url: link ? link[2] : '',
          desc: stripInlineMarkdown(bold ? bold[2] : text.replace(/^[^—–:]*[—–:]\s*/, '')),
          bullets: [],
        });
      }
      continue;
    }
    if (isBullet(line)) current.bullets.push(bulletText(line));
    else if (!current.desc) current.desc = stripInlineMarkdown(line);
    else current.bullets.push(stripInlineMarkdown(line));
  }
  return out.filter(p => p.name).map(p => ({
    name: p.name,
    url: p.url,
    desc: p.desc || p.bullets[0] || '',
    bullets: p.desc ? p.bullets.slice(0, 4) : p.bullets.slice(1, 5),
    tag: '',
  })).slice(0, 6);
}

function parseLanguageLines(lines = []) {
  const out = [];
  for (const raw of lines) {
    const text = stripInlineMarkdown(raw.replace(/^\s*[-*•]\s+/, ''));
    if (!text) continue;
    for (const part of text.split(/\s*[,;|]\s*/)) {
      const m = part.match(/^([^(:–—-]+?)\s*(?:[(:–—-]\s*([^)]+?)\)?)?$/);
      if (m && m[1]) out.push({ name: m[1].trim(), level: (m[2] || '').trim() });
    }
  }
  return out.slice(0, 8);
}

function parseSummary(lines = []) {
  return lines.map(l => l.trim()).filter(Boolean).filter(l => !/^#/.test(l)).map(stripInlineMarkdown).join(' ').trim();
}

/** The structured parts of a cv.md the premium template can show. */
export function parseCvMarkdownForTemplate(markdown = '') {
  const sections = splitH2Sections(markdown);
  const result = { summary: '', experience: [], education: [], skill_sections: [], projects: [], languages: [], certifications: [] };
  for (const section of sections) {
    const title = section.title;
    if (!title) {
      // Preamble under the H1: a paragraph there is the summary if no section claims it.
      const text = parseSummary(section.lines.filter(l => !/^\*\*[A-Za-z ]+:\*\*/.test(l) && !/^#\s/.test(l)));
      if (text && !result.summary) result.summary = text;
      continue;
    }
    if (SUMMARY_HEADINGS.test(title) && !EXPERIENCE_HEADINGS.test(title)) result.summary = parseSummary(section.lines) || result.summary;
    else if (EXPERIENCE_HEADINGS.test(title)) result.experience.push(...parseExperience(section.lines));
    else if (EDUCATION_HEADINGS.test(title)) result.education.push(...parseEducation(section.lines));
    else if (LANGUAGE_HEADINGS.test(title.trim())) result.languages.push(...parseLanguageLines(section.lines));
    else if (SKILLS_HEADINGS.test(title)) result.skill_sections.push(...parseSkillSections(section.lines));
    else if (PROJECT_HEADINGS.test(title)) result.projects.push(...parseProjects(section.lines));
    else if (CERT_HEADINGS.test(title)) result.certifications.push(...section.lines.filter(isBullet).map(bulletText));
  }
  return result;
}

const TAG_STYLE = { bg: '#ecfdf5', color: '#047857', border: '#a7f3d0' };

function phoneLink(phone = '') {
  return String(phone).replace(/[^0-9+]/g, '');
}

function languageEntries(candidateLanguages, parsedLanguages) {
  const fromProfile = cleanArray(candidateLanguages).map((entry) => {
    if (typeof entry === 'string') {
      const m = entry.match(/^([^(]+?)\s*(?:\(([^)]+)\))?\s*$/);
      return m ? { name: m[1].trim(), level: (m[2] || '').trim(), flag: '' } : null;
    }
    if (entry && typeof entry === 'object') {
      const name = cleanString(entry.name || entry.language);
      return name ? { name, level: cleanString(entry.level || entry.proficiency), flag: cleanString(entry.flag) } : null;
    }
    return null;
  }).filter(Boolean);
  const source = fromProfile.length ? fromProfile : parsedLanguages.map(l => ({ ...l, flag: '' }));
  return source.slice(0, 8);
}

/**
 * {profile, shared} for templates/premium-cv.html from a nested profile
 * (config/profile.yml shape — see lib/profile-shape.mjs) and the account's CV
 * markdown. `tailoredData` overrides win, like in loadCvTemplateData().
 */
export function buildCvTemplateDataFromProfile(profileConfig = {}, cvMarkdown = '', tailoredData = {}) {
  const config = profileConfig && typeof profileConfig === 'object' ? profileConfig : {};
  const candidate = config.candidate || {};
  const narrative = config.narrative || {};
  const targetRoles = config.target_roles || {};
  const location = config.location || {};
  const compensation = config.compensation || {};
  const availability = config.availability || {};
  const parsed = parseCvMarkdownForTemplate(cvMarkdown);

  const primaryRoles = cleanArray(targetRoles.primary).map(cleanString).filter(Boolean);
  const headline = cleanString(narrative.headline) || cleanString(candidate.title) || primaryRoles[0] || '';
  const summary = cleanString(narrative.exit_story) || parsed.summary;

  const proofPoints = cleanArray(narrative.proof_points)
    .map(p => ({ name: cleanString(p?.name), url: cleanString(p?.url), metric: cleanString(p?.hero_metric) }))
    .filter(p => p.name || p.metric);
  const superpowers = cleanArray(narrative.superpowers).map(cleanString).filter(Boolean);
  const highlights = proofPoints.length
    ? proofPoints.map(p => [p.name, p.metric].filter(Boolean).join(': ')).slice(0, 4)
    : superpowers.slice(0, 4);

  const projects = parsed.projects.length
    ? parsed.projects
    : proofPoints.filter(p => p.name).map(p => ({ name: p.name, url: p.url, desc: p.metric, tag: '', bullets: [] })).slice(0, 6);

  const availabilityTags = [];
  const remote = cleanString(location.remote_policy || compensation.location_flexibility);
  if (/remote/i.test(remote)) availabilityTags.push({ label: /only|required|mandatory/i.test(remote) ? 'Full remote' : 'Remote-friendly', ...TAG_STYLE });
  else if (/hybrid/i.test(remote)) availabilityTags.push({ label: 'Hybrid', ...TAG_STYLE });
  const employment = cleanString(compensation.employment_type || availability.desired_engagement);
  if (employment) availabilityTags.push({ label: employment.slice(0, 24), ...TAG_STYLE });
  const start = cleanString(availability.start_date || availability.notice_period);
  if (start) availabilityTags.push({ label: `Start: ${start}`.slice(0, 30), ...TAG_STYLE });

  const stats = [];
  const years = Number.parseInt(String(candidate.years_experience ?? ''), 10);
  if (Number.isFinite(years) && years > 0) stats.push({ value: `${years}+`, label: years === 1 ? 'Year' : 'Years', sub: 'experience' });
  if (parsed.experience.length >= 2) stats.push({ value: String(parsed.experience.length), label: 'Roles', sub: 'on the CV' });
  if (projects.length >= 2) stats.push({ value: String(projects.length), label: 'Projects', sub: 'shipped' });

  const skillSections = parsed.skill_sections.length
    ? parsed.skill_sections
    : (superpowers.length ? [{ title: 'Strengths', items: superpowers.slice(0, 10) }] : []);

  const resolvedProfile = {
    use_profile_config: true,
    headline,
    summary,
    target_roles: primaryRoles,
    highlights_title: proofPoints.length ? 'Proof Points' : 'Strengths',
    highlights,
    projects_title: parsed.projects.length ? 'Selected work' : 'Proof points',
    projects,
    availability_tags: availabilityTags.slice(0, 3),
    stats: stats.slice(0, 3),
    skill_sections: skillSections,
    experience: parsed.experience.slice(0, 8),
    experience_note: '',
    maxim: '',
    phone: cleanString(candidate.phone),
    phone_link: phoneLink(candidate.phone),
    portrait: cleanString(candidate.photo),
    tool_logos_hidden: true,
    certifications: parsed.certifications.slice(0, 6),
  };

  const resolvedShared = {
    contact: buildSharedContact(config, {}),
    education: parsed.education,
    languages: languageEntries(candidate.languages || config.languages, parsed.languages),
    skills: {},
  };

  return escapeHtmlDeep(mergeTemplateData({ profile: resolvedProfile, shared: resolvedShared }, tailoredData));
}
