// Pure option matching for selects / radios / comboboxes.
// Kept Playwright-free so Yes/No and country aliases stay unit-testable.

import { salaryNumberMatchScore } from './apply-salary.mjs';

const YES_HEAD = /^(yes|oui|y|yeah|true)\b/i;
const NO_HEAD = /^(no|non|n|false)\b/i;
const NON_BINARY = /^non-?binary\b/i;
const NONE_OF = /^none\b/i;

const COUNTRY_ALIASES = {
  france: ['france', 'french republic', 'république française', 'republique francaise', 'fr'],
  thailand: ['thailand', 'thaïlande', 'thailande', 'th'],
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

export function choiceKind(want) {
  const w = compact(want).toLowerCase();
  if (!w) return null;
  if (/^(yes|oui|y|true)$/.test(w)) return 'yes';
  if (/^(no|non|n|false)$/.test(w)) return 'no';
  return null;
}

const LIST_PLACEHOLDER = /^(select\b|choose\b|please\b|s[ée]lectionn|--)/i;

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

export function optionMatchScore(want, optionText) {
  const t = compact(optionText);
  if (!t) return 0;
  const low = t.toLowerCase();
  const raw = compact(want);
  if (!raw) return 0;
  if (raw.length > 80) return low === raw.toLowerCase() ? 100 : 0;

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

  const wantLow = raw.toLowerCase();
  if (wantLow.length >= 4 && (low.includes(wantLow) || (low.length >= 4 && wantLow.includes(low)))) return 40;
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
