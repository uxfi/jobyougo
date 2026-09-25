const DEFAULT_INCLUSIVE = [
  'united states or europe',
  'us or europe',
  'us or eu',
  'united states or the eu',
  'us or emea',
  'europe or the united states',
  'europe, uk, usa',
  'worldwide',
  'work from anywhere',
  'anywhere in the world',
  'global remote',
];

function normalizeMatchText(value = '') {
  return String(value)
    .trim()
    .replace(/\s+/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function phraseInText(text = '', phrase = '') {
  const cleanPhrase = normalizeMatchText(phrase);
  if (!cleanPhrase) return false;
  const pattern = cleanPhrase
    .split(/\s+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[\\s\\-/_,.()]+');
  return new RegExp(`(^|[^a-z0-9])${pattern}([^a-z0-9]|$)`, 'i').test(text);
}

/**
 * A rejected ATS location stays rejected unless the JD body contains an
 * explicit inclusive phrase. An empty body never reopens it.
 */
export function geoRejectCanWiden(description = '', extraPhrases = []) {
  const text = normalizeMatchText(description);
  if (!text) return { widen: false, phrase: '' };
  const phrases = [...DEFAULT_INCLUSIVE, ...(Array.isArray(extraPhrases) ? extraPhrases : [])];
  const phrase = phrases.find((item) => item && phraseInText(text, item)) || '';
  return { widen: Boolean(phrase), phrase };
}
