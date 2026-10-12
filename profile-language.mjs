import * as yaml from 'js-yaml';

const DEFAULT_OUTPUT_LANGUAGE = 'en';

function normalizeOutputLanguage(value) {
  if (typeof value !== 'string') return DEFAULT_OUTPUT_LANGUAGE;
  const language = value.trim();
  if (!language || language.length > 64 || /[\r\n\0]/.test(language)) {
    return DEFAULT_OUTPUT_LANGUAGE;
  }
  return language;
}

/**
 * language.output, plus WHY that is the answer.
 *
 * The catch below folds three different situations into `en`: no profile, no
 * language key, and a profile that does not parse. The first two are correct —
 * English is the documented default. The third is not something the caller
 * should be unable to distinguish: a user who set `output: ja` and has a YAML
 * typo elsewhere in the file gets every report, cover letter and outreach
 * message in English, and the only signal is noticing the wrong language in
 * finished work.
 *
 * `source` makes that inspectable without changing what any existing caller
 * receives. `doctor.mjs` is the primary signal now (checkProfileShape reports
 * an unparseable profile on the first message of every session); this is for a
 * caller that wants to say so at generation time.
 *
 * @param {string} profileYaml
 * @returns {{language: string, source: 'configured'|'default'|'unparseable'}}
 */
export function describeOutputLanguage(profileYaml) {
  let profile;
  try {
    profile = yaml.load(String(profileYaml ?? '')) || {};
  } catch {
    return { language: DEFAULT_OUTPUT_LANGUAGE, source: 'unparseable' };
  }
  return describeProfileOutputLanguage(profile);
}

/**
 * Same as describeOutputLanguage, for a profile that is already parsed: the
 * nested shape getProfile() returns for both the local YAML and a Supabase row
 * (lib/profile-shape.mjs lifts preferences.language to the top level).
 *
 * @param {object} profile
 * @returns {{language: string, source: 'configured'|'default'}}
 */
export function describeProfileOutputLanguage(profile) {
  const raw = profile?.language?.output;
  const language = normalizeOutputLanguage(raw);
  // 'configured' only when the file actually asked for what it got — a value
  // that normalizes away (too long, embedded newline) is a default, not a
  // setting the user made.
  const configured = typeof raw === 'string' && raw.trim() === language;
  return { language, source: configured ? 'configured' : 'default' };
}

/**
 * language.output when the user set one, '' otherwise. The web prompts keep
 * their historical language when this is '' (French evaluations, letters in
 * the posting's language, answers in the question's language), so a profile
 * without the key gets exactly the prompts it got before.
 *
 * @param {object} profile parsed profile (getProfile shape)
 * @returns {string}
 */
export function configuredOutputLanguage(profile) {
  const { language, source } = describeProfileOutputLanguage(profile);
  return source === 'configured' ? language : '';
}

// Names for the codes the onboarding offers: a 30B model follows "French"
// more reliably than "fr".
const LANGUAGE_NAMES = {
  en: 'English',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  it: 'Italian',
  pt: 'Portuguese',
  nl: 'Dutch',
  ja: 'Japanese',
  zh: 'Chinese',
  'zh-cn': 'Simplified Chinese',
};

/** English name of a language code ("fr" → "French"), or the tag itself when unknown. */
export function outputLanguageName(language) {
  const tag = normalizeOutputLanguage(language);
  return LANGUAGE_NAMES[tag.toLowerCase()] || tag;
}

/** "French (fr)": the name for the model, the code for anyone reading the prompt. */
export function outputLanguageLabel(language) {
  const tag = normalizeOutputLanguage(language);
  const name = outputLanguageName(tag);
  return name === tag ? tag : `${name} (${tag})`;
}

/**
 * Parse language.output from profile YAML, falling back to English.
 *
 * Contract unchanged — returns the language string. Use describeOutputLanguage
 * when the reason matters.
 */
export function parseOutputLanguage(profileYaml) {
  return describeOutputLanguage(profileYaml).language;
}

/** Build the canonical output-language rule injected into every model prompt. */
export function outputLanguageInstruction(language) {
  const outputLanguage = normalizeOutputLanguage(language);
  return [
    `Write all human-facing output in ${outputLanguage}, including the full A–G`,
    `evaluation and the machine-readable summary's free-text fields, regardless`,
    `of the language of these instructions or the job description. Keep`,
    `market-specific terms when relevant, but explain them in ${outputLanguage}`,
    `when needed. The configured language.output always wins over the job`,
    `description's language.`,
  ].join(' ');
}

/**
 * Language of an application email (POST /api/application-email).
 *
 * The form's own selector wins (fr / en). "Auto (offer / company)" keeps its
 * meaning: the posting's language, else the company site's. Only when there is
 * neither does the email fall back to the profile's language.output, where it
 * used to fall back to English. The email writer and its guards know French
 * and English only, so another configured language keeps that English fallback.
 *
 * @param {{requested?: string, profileLanguage?: string, hasJob?: boolean, hasCompany?: boolean}} opts
 * @returns {'fr'|'en'|'auto'}
 */
export function applicationEmailLanguage({ requested = 'auto', profileLanguage = '', hasJob = false, hasCompany = false } = {}) {
  if (requested === 'fr' || requested === 'en') return requested;
  if (hasJob || hasCompany) return 'auto';
  const code = String(profileLanguage || '').trim().toLowerCase();
  if (/^fr\b/.test(code)) return 'fr';
  if (/^en\b/.test(code)) return 'en';
  return 'auto';
}

/**
 * The same rule for text written in the candidate's name (cover letters, form
 * answers, apply notes): AGENTS.md wording, without the evaluation blocks.
 */
export function writingLanguageInstruction(language) {
  const label = outputLanguageLabel(language);
  return [
    `Write all human-facing output in ${label}, regardless of the language of`,
    `these instructions, the job description or the question asked. Keep`,
    `market-specific terms when relevant, but explain them in ${label} when`,
    `needed. The configured language.output always wins.`,
  ].join(' ');
}
