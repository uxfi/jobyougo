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
