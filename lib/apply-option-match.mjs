// Pure option matching for selects / radios / comboboxes.
// Kept Playwright-free so Yes/No and country aliases stay unit-testable.

import { salaryNumberMatchScore } from './apply-salary.mjs';
import { placesIn } from './apply-places.mjs';

const YES_HEAD = /^(yes|oui|y|yeah|true)\b/i;
const NO_HEAD = /^(no|non|n|false)\b/i;
const NON_BINARY = /^non-?binary\b/i;
const NONE_OF = /^none\b/i;

const COUNTRY_ALIASES = {
  france: ['france', 'french republic', 'république française', 'republique francaise', 'fr'],
  thailand: ['thailand', 'thaïlande', 'thailande', 'th'],
  austria: ['austria', 'österreich', 'osterreich', 'autriche', 'at'],
  australia: ['australia', 'au'],
  'united states': ['united states', 'usa', 'us', 'united states of america'],
  'united kingdom': ['united kingdom', 'uk', 'great britain', 'england'],
  germany: ['germany', 'deutschland', 'de'],
  spain: ['spain', 'españa', 'espana', 'es'],
  italy: ['italy', 'italia', 'it'],
  netherlands: ['netherlands', 'holland', 'nl', 'the netherlands'],
  belgium: ['belgium', 'belgique', 'belgië', 'be'],
  portugal: ['portugal', 'pt'],
  singapore: ['singapore', 'sg'],
};

// Greenhouse month dropdowns use "February", "Feb", "2", or "02".
const MONTH_ALIASES = {
  january: ['january', 'jan', '01', '1'],
  february: ['february', 'feb', '02', '2'],
  march: ['march', 'mar', '03', '3'],
  april: ['april', 'apr', '04', '4'],
  may: ['may', '05', '5'],
  june: ['june', 'jun', '06', '6'],
  july: ['july', 'jul', '07', '7'],
  august: ['august', 'aug', '08', '8'],
  september: ['september', 'sep', 'sept', '09', '9'],
  october: ['october', 'oct', '10'],
  november: ['november', 'nov', '11'],
  december: ['december', 'dec', '12'],
};

function monthNeedles(want) {
  const w = compact(want).toLowerCase();
  if (!w) return [];
  for (const [canon, aliases] of Object.entries(MONTH_ALIASES)) {
    if (w === canon || aliases.includes(w)) return [canon, ...aliases];
  }
  return [];
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compact(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

// Text typed into an open list to filter it. Short answers go in whole
// ("Bangkok", "France"). Long answers only send the first word — the click
// still has to land on a real option. Never the whole essay.
export function listFilterText(want) {
  const s = compact(want);
  if (!s) return '';
  if (choiceKind(s)) return '';
  if (s.length <= 20) return s;
  const word = s.split(/\s+/).find((w) => w.length >= 3) || s.split(/\s+/)[0];
  return word.slice(0, 16);
}

const LIST_PLACEHOLDER = /^(select\b|choose\b|please\b|s[ée]lectionn|--)/i;

export function choiceKind(want) {
  const w = compact(want).toLowerCase();
  if (!w) return null;
  if (/^(yes|oui|y|true)$/.test(w)) return 'yes';
  if (/^(no|non|n|false)$/.test(w)) return 'no';
  return null;
}

// A closed list whose only real rows are Yes and No. "Paris, France" can never
// be one of those rows — the control is an eligibility question, not a city.
export function optionsAreYesNo(options) {
  const texts = (options || [])
    .map((o) => compact(typeof o === 'string' ? o : o?.text))
    .filter((t) => t && !LIST_PLACEHOLDER.test(t));
  if (texts.length < 2 || texts.length > 4) return false;
  let yes = false;
  let no = false;
  for (const t of texts) {
    if (/^(yes|oui)\b/i.test(t)) yes = true;
    else if (/^(no|non)\b/i.test(t) && !/^non-?binary/i.test(t) && !/^none\b/i.test(t)) no = true;
    else return false;
  }
  return yes && no;
}

const REMOTE_ONLY_RE = /only want to work remote|remote only|fully remote|i only want to work remote/i;
const WORK_POLICY_RE = /travel frequently|move to (hamburg|berlin|munich|vienna|london)|only want to work remote|remote only|hamburg office/i;

function optionTexts(options) {
  return (options || [])
    .map((o) => compact(typeof o === 'string' ? o : o?.text))
    .filter((t) => t && !LIST_PLACEHOLDER.test(t));
}

// Ashby "Location" whose rows are travel / Hamburg / remote — not cities.
export function optionsLookLikeWorkPolicy(options) {
  return optionTexts(options).some((t) => WORK_POLICY_RE.test(t));
}

export function pickRemotePolicyOption(options) {
  const list = Array.isArray(options) ? options : [];
  return list.find((o) => {
    const t = compact(typeof o === 'string' ? o : o?.text);
    return t && REMOTE_ONLY_RE.test(t);
  }) || null;
}

export function remotePolicyPlan(options) {
  const hit = pickRemotePolicyOption(options);
  const text = compact(typeof hit === 'string' ? hit : hit?.text);
  if (text) {
    return {
      selectText: text,
      selectMatch: text,
      selectPrefer: REMOTE_ONLY_RE,
      value: text,
    };
  }
  return {
    yesNo: 'no',
    selectText: 'No',
    selectPrefer: REMOTE_ONLY_RE,
    value: 'No',
  };
}

// Location / City labelled controls whose live list is Yes|No. Relocation,
// visa and "how did you hear" stay on their own rules.
export function placeWantedOnYesNoList(label, want) {
  if (!compact(want) || choiceKind(want)) return false;
  const s = String(label || '').toLowerCase();
  if (/relocat|hear|sponsor|visa|travel/.test(s)) return false;
  return /\blocation\b|\bcity\b|\bville\b|\bbased in\b|\blocated\b/.test(s);
}

// A list is filled only when an option is committed. The filter string still
// sitting in the input is not a selection — that is the "it typed into the
// dropdown" failure.
export function selectionLooksCommitted(state = {}) {
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const low = (s) => norm(s).toLowerCase();
  const real = (s) => {
    const t = norm(s);
    if (!t || LIST_PLACEHOLDER.test(t)) return '';
    return t;
  };
  const q = low(state.query);
  const typed = low(state.inputValue);
  const filter = low(state.filterTyped || '');
  const clicked = low(state.clickedText);
  const chip = real(state.displayed) || real(state.selectedOption) || real(state.buttonText);
  const shadow = real(state.shadowValue);
  if (chip) return chip;
  if (shadow) return shadow;
  // Widget replaced the box with the option we clicked (longer than the filter).
  if (clicked && typed === clicked && (!filter || typed !== filter)) return norm(state.inputValue) || norm(state.clickedText);
  if (typed && q && typed !== q && !q.startsWith(typed)) return norm(state.inputValue);
  return null;
}

function countryNeedles(want) {
  const w = compact(want).toLowerCase();
  if (!w) return [];
  for (const [canon, aliases] of Object.entries(COUNTRY_ALIASES)) {
    if (w === canon || aliases.includes(w)) return [canon, ...aliases];
  }
  return [w];
}

function foldOptionText(s) {
  return compact(s).toLowerCase()
    .replace(/[\u2018\u2019\u201A\u201B']/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[–—]/g, '-');
}

// Same option, whatever the accents, quotes, numbering ("3. Practitioner: …")
// or trailing punctuation.
export function canonOptionText(s) {
  return foldOptionText(s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/^\s*(\(?\d{1,2}[.)]|[a-h][.)])\s+/, '')
    .replace(/[.;:!?]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordSet(s) {
  return new Set(canonOptionText(s).split(/[^a-z0-9+]+/).filter((w) => w.length >= 3));
}

// "Paris, France" against "Paris, Île-de-France, FRA" (yes) or "Paris, TX,
// USA" (no): the same city, and no other country named.
function placeScore(want, optionText) {
  const w = placesIn(want);
  if (!w.cities.length) return 0;
  const o = placesIn(optionText, { codes: true });
  const city = w.cities[0].city;
  if (!o.cities.some((c) => c.city === city)) return 0;
  const country = w.explicit[0] || w.cities[0].country;
  // Same city name in another country: never this option.
  if (o.explicit.length && !o.explicit.includes(country)) return -1;
  return o.explicit.length ? 92 : 75;
}

export function optionMatchScore(want, optionText) {
  const t = compact(optionText);
  if (!t) return 0;
  const low = foldOptionText(t);
  const raw = compact(want);
  if (!raw) return 0;
  const rawFold = foldOptionText(raw);
  if (rawFold === low) return 100;
  if (canonOptionText(t) && canonOptionText(raw) === canonOptionText(t)) return 98;
  // Long rows (a whole sentence per option) are compared word for word: the
  // resolver hands back the option's own text, spacing or numbering aside.
  if (raw.length > 80) {
    const a = wordSet(raw);
    const b = wordSet(t);
    if (!a.size || !b.size) return 0;
    let shared = 0;
    for (const word of a) if (b.has(word)) shared++;
    return shared / Math.max(a.size, b.size) >= 0.85 ? 88 : 0;
  }

  const kind = choiceKind(raw);
  if (low === raw.toLowerCase()) return 100;

  if (kind === 'yes' && YES_HEAD.test(t) && !NO_HEAD.test(t)) return 90;
  if (kind === 'no' && NO_HEAD.test(t) && !NON_BINARY.test(t) && !NONE_OF.test(t)) return 90;
  // Yes/No never falls through to substring matching: "no" ⊂ "none" / "non-binary".
  if (kind) return 0;

  if (/^\+\d{1,4}$/.test(raw)) {
    const bounded = new RegExp(`(^|\\W)${escapeRe(raw)}(\\W|$)`);
    if (bounded.test(t)) return 92;
  }

  const months = monthNeedles(raw);
  if (months.length) {
    for (const n of months) {
      if (low === n) return 96;
      if (/^\d{1,2}$/.test(n) && /^\d{1,2}$/.test(low) && Number(n) === Number(low)) return 96;
    }
    return 0;
  }

  // Exact year (employment start/end year dropdowns).
  if (/^\d{4}$/.test(raw) && /^\d{4}$/.test(low)) {
    return raw === low ? 100 : 0;
  }

  const place = placeScore(raw, t);
  if (place) return Math.max(0, place);

  const needles = countryNeedles(raw);
  for (const n of needles) {
    if (n.length < 2) continue;
    if (low === n) return 95;
    if (n.length < 4) continue;
    const bounded = new RegExp(`(^|\\W)${escapeRe(n)}(\\W|$)`, 'i');
    if (bounded.test(t)) return 70;
  }

  const salaryScore = salaryNumberMatchScore(raw, t);
  if (salaryScore) return salaryScore;

  // Substring fallback — but never let "Austria" score on "Australia"
  // (or the reverse): one name is a contiguous substring of the other.
  const wantLow = raw.toLowerCase();
  if (wantLow.length >= 4) {
    const austriaClash =
      (wantLow.includes('austria') && /\baustralia\b/i.test(low))
      || (wantLow.includes('australia') && /\baustria\b/i.test(low));
    if (!austriaClash && (low.includes(wantLow) || (low.length >= 4 && wantLow.includes(low)))) return 40;
  }
  return 0;
}

export function pickMatchingOption(options, want) {
  const list = Array.isArray(options) ? options : [];
  let best = null;
  let bestScore = 0;
  for (const o of list) {
    const text = typeof o === 'string' ? o : o?.text;
    const score = optionMatchScore(want, text);
    if (score > bestScore) {
      bestScore = score;
      best = typeof o === 'string' ? { text: o, value: o } : o;
    }
  }
  return bestScore >= 50 ? best : null;
}
