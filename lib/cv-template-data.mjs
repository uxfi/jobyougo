import { readFile } from 'fs/promises';
import { load as yamlLoad } from 'js-yaml';
import { join } from 'path';

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

  const resolvedProfile = {
    ...baseProfile,
    headline: cleanString(profileConfig?.narrative?.headline) || cleanString(baseProfile.headline),
    summary: buildSummary(profileConfig, baseProfile),
    target_roles: cleanArray(profileConfig?.target_roles?.primary).length
      ? cleanArray(profileConfig.target_roles.primary)
      : cleanArray(baseProfile.target_roles),
    highlights: buildHighlights(profileConfig, baseProfile),
    availability_tags: buildAvailabilityTags(profileConfig, baseProfile),
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
