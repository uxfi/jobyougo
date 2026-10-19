/**
 * Per-account scan targeting.
 *
 * portals.yml lists platforms only: companies, boards, feeds, web queries.
 * Where a source takes search words it carries a placeholder, filled from the
 * scanning account's profile on every scan (nothing stored):
 *
 *   {roles}    in a query: ("Backend Engineer" OR "Data Engineer" ...)
 *              as a list item (keywords, queries): the profile's terms
 *   {role}     the first term, URL-encoded inside an http(s) URL
 *
 * The title filter's positives come from the profile too (terms + the role
 * family of lib/scan-decision.mjs); the file keeps generic negatives only.
 *
 *   node lib/scan-targeting.mjs --templatize [portals.yml] [--write]
 *     rewrites a file that still spells roles out (portalsForProfile does
 *     the same on the fly, so an unconverted file still scans per account).
 */
import { copyFileSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import * as yaml from 'js-yaml';
import { explainTitle, roleFamilyPattern } from './scan-decision.mjs';
import { getJobYouGoRoot } from '../path-resolver.mjs';
import { isMainModule } from './is-main-module.mjs';

// Level words a search phrase does not need: "Product Designer" finds
// "Senior Product Designer".
const LEVEL_WORDS = /\b(?:senior|sr|junior|jr|lead|staff|principal|founding|mid|associate)\b\.?/gi;
// Terms in one boolean web query (longer OR chains return nothing on
// Brave/DuckDuckGo, scan audit 2026-10-13); keyword lists cost one request per term.
const QUERY_TERMS = 4;
const LIST_TERMS = 10;
const LIST_KEYS = new Set(['keywords', 'queries', 'job_board_keywords']);
const WORD_KEYS = new Set(['q', 'searchKeywords']);
const URL_SEARCH_PARAM = /([?&](?:q|query|search|keywords?|what|term|kw)=)[^&#\s]*/gi;
// Titles a profile that targets junior roles must not lose to a level negative.
const JUNIOR_PROBES = ['junior', 'intern', 'internship', 'alternance', 'apprenti', 'stagiaire', 'graduate', 'entry-level'];

/**
 * Search phrases for the profile's roles: primary roles, primary archetypes,
 * target_roles.search_terms, then (unless `secondary: false`) secondary
 * archetypes; level words dropped, deduplicated. "UX/UI Designer" also gives
 * "UX Designer" and "UI Designer"; a phrase that contains another one ("AI Product Designer" next to "Product
 * Designer") is dropped since the shorter one already finds it.
 */
export function scanTermsFrom(targeting, { secondary = true } = {}) {
  if (!targeting) return [];
  const archetypes = targeting.archetypes || [];
  const names = [
    ...(targeting.primaryRoles || []),
    ...archetypes.filter((entry) => entry.fit !== 'secondary').map((entry) => entry.name),
    ...(targeting.searchTerms || []),
    ...(secondary ? archetypes.filter((entry) => entry.fit === 'secondary').map((entry) => entry.name) : []),
  ];
  const terms = [];
  const add = (term) => {
    if (term.length >= 3 && !terms.some((t) => t.toLowerCase() === term.toLowerCase())) terms.push(term);
  };
  for (const name of names) {
    const full = String(name || '').replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
    const stripped = full.replace(LEVEL_WORDS, ' ').replace(/\s+/g, ' ').trim();
    // "Lead Designer" → "Designer" would search every designer.
    const term = stripped.includes(' ') ? stripped : full;
    add(term);
    const slash = term.match(/^(\w+)\s*\/\s*(\w+)\s+(.+)$/);
    if (slash) [slash[1], slash[2]].forEach((head) => add(`${head} ${slash[3]}`));
  }
  const contains = (long, short) => long !== short && ` ${long} `.includes(` ${short} `);
  const lower = terms.map((t) => t.toLowerCase());
  return terms.filter((_, i) => !lower.some((other) => contains(lower[i], other)));
}

/** The targeting a profile.yml-shaped object gives (the CLI reads config/profile.yml). */
export function targetingFromProfile(profile = {}) {
  const roles = profile?.target_roles || {};
  const list = (value) => (Array.isArray(value) ? value.map((item) => String(item || '').trim()).filter(Boolean) : []);
  return {
    primaryRoles: list(roles.primary),
    archetypes: (Array.isArray(roles.archetypes) ? roles.archetypes : [])
      .map((entry) => ({ name: String(entry?.name || '').trim(), level: String(entry?.level || '').trim(), fit: String(entry?.fit || '').trim() || 'secondary' }))
      .filter((entry) => entry.name),
    searchTerms: list(roles.search_terms),
  };
}

/**
 * The shared title negatives minus the ones that would block this profile:
 * a negative hit by one of its terms ("Data Scientist" for a data scientist),
 * a junior word when it targets junior roles, or a place it may work in
 * ("US Remote" for a US base).
 */
function negativesFor(titleFilter, { probes, geoWords }) {
  let negative = [...(titleFilter.negative || [])];
  let negativePatterns = [...(titleFilter.negative_patterns || [])];
  for (const probe of probes) {
    for (let guard = 0; guard < 50; guard++) {
      const hit = explainTitle(probe, { negative, negative_patterns: negativePatterns });
      if (!hit.blockedBy) break;
      if (hit.via === 'keyword') negative = negative.filter((word) => String(word).trim().toLowerCase() !== hit.blockedBy);
      else negativePatterns = negativePatterns.filter((pattern) => String(pattern).trim() !== hit.blockedBy);
    }
  }
  const namesPlace = (word) => geoWords.some((place) => new RegExp(`(^|[^a-z])${place.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(String(word).toLowerCase()));
  return { negative: negative.filter((word) => !namesPlace(word)), negative_patterns: negativePatterns };
}

/**
 * Title shapes a keyword list misses for a design / research profile, as
 * patterns (the negatives still veto first):
 *   "Designer, Product Experience", "Designer (Product)", "Design Systems
 *   Designer", "Conversation Designer", "User Researcher", "UX Research Lead";
 *   "Senior / Staff / Principal / Lead Designer" only when the title itself
 *   says product / UX / digital / software (never a bare "Senior Designer",
 *   never graphic, industrial, fashion, interior, brand or motion design).
 */
export function titleRecallPatterns(terms = []) {
  const text = terms.join(' | ').toLowerCase();
  const out = [];
  if (/\bdesign/.test(text)) {
    out.push(
      String.raw`\bdesigner\s*(?:,|\(|\[|:|\u2013|-)\s*(?:product|ux|ui|user experience|digital|interaction|design systems?|experience)\b`,
      String.raw`\bdesign\s+systems?\s+designer\b`,
      String.raw`\bconversation(?:al)?\s+designer\b`,
      String.raw`^(?=.*\b(?:product|ux|ui|digital|software|saas|platform|app|web|ai)\b)(?!.*\b(?:graphic|industrial|fashion|interior|landscape|packaging|print|jewel\w*|textile|furniture|brand(?:ing)?|motion|game|3d|architect\w*|exhibition|set)\b).*\b(?:senior|sr\.?|staff|principal|lead)\s+designer\b`,
    );
  }
  if (/research/.test(text) || /\bux\b|\buser experience\b/.test(text)) {
    out.push(String.raw`\b(?:ux|user)\s+research(?:ers?)?\b`);
  }
  return out;
}

/**
 * Chip and electronics design titles a design profile's "design engineer"
 * keyword lets through ("DFT Engineer - GPU Logic Design Engineer", Intel,
 * 2026-10-19). Only for a profile whose own terms are not hardware; a pattern
 * that would block one of the profile's terms is dropped.
 */
const HARDWARE_TERMS_RE = /\b(asic|fpga|rtl|vlsi|silicon|semiconductor|chip|hardware|circuit|pcb|dft|soc|verilog|analog)\b/i;
export function hardwareDesignNegatives(terms = []) {
  const list = (terms || []).map(String);
  if (!list.some((term) => /design/i.test(term)) || list.some((term) => HARDWARE_TERMS_RE.test(term))) return [];
  const patterns = [
    String.raw`\b(?:logic|asic|rtl|fpga|soc|dft|circuit|chip|silicon|analog|mixed[- ]signal|pcb|vlsi|gpu|cpu|semiconductor|integrated circuit|hardware)\s+design`,
    String.raw`\bphysical\s+design\s+(?:engineer|lead|manager|architect)`,
    String.raw`\bdesign\s+verification\b`,
    String.raw`\bdesign[- ]for[- ]test`,
    String.raw`(?:^|[^a-z])dft\s+(?:engineer|lead|architect|manager)`,
  ];
  return patterns.filter((source) => !list.some((term) => new RegExp(source, 'i').test(term)));
}

/**
 * portals.yml for one account: placeholders filled with its terms, title
 * positives from its roles, negatives that would block it removed.
 * `targeting` is inferProfileMatchingRules().targeting (or
 * targetingFromProfile), `geoPolicy` geoPolicyFrom() of its location. A
 * file that still spells roles out (templates/portals.example.yml, a file
 * not migrated) is templated first. Web queries search the primary terms
 * only: a secondary archetype ("Product Manager" on a design profile) passes
 * the scan gate only with a primary scope word, so it would waste the short
 * OR group. A profile without roles gets no keyword search at all: every
 * source that holds a placeholder is turned off.
 */
export function portalsForProfile(config = {}, { targeting = null, geoPolicy = null } = {}) {
  const terms = scanTermsFrom(targeting);
  if (!terms.length) return withoutPlaceholders(templatePortals(config));
  const primary = scanTermsFrom(targeting, { secondary: false });
  const group = `(${(primary.length ? primary : terms).slice(0, QUERY_TERMS).map((term) => `"${term}"`).join(' OR ')})`;
  const fill = (value, key) => {
    if (Array.isArray(value)) return value.flatMap((item) => (item === '{roles}' ? terms.slice(0, LIST_TERMS) : [fill(item, '')]));
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, k === 'title_filter' ? v : fill(v, k)]));
    }
    if (typeof value !== 'string' || !value.includes('{role')) return value;
    const role = /^https?:\/\//i.test(value) ? encodeURIComponent(terms[0]) : terms[0];
    return value.replaceAll('{roles}', group).replaceAll('{role}', role);
  };
  const out = fill(templatePortals(config), '');
  const titleFilter = config.title_filter || {};
  const family = roleFamilyPattern(targeting);
  const probes = [...terms, ...(targeting.rejectInternships === false ? JUNIOR_PROBES : [])];
  out.title_filter = {
    ...titleFilter,
    positive: [...terms],
    positive_patterns: [...(family ? [family.source] : []), ...titleRecallPatterns(terms)],
    ...negativesFor(titleFilter, { probes, geoWords: geoPolicy?.allowed || [] }),
  };
  const hardware = hardwareDesignNegatives(terms);
  if (hardware.length) {
    out.title_filter.negative_patterns = [...new Set([...(out.title_filter.negative_patterns || []), ...hardware])];
  }
  return out;
}

// Sources that need search words are turned off; bare {roles} list items go.
function withoutPlaceholders(value) {
  const holds = (item) => /\{roles?\}/.test(JSON.stringify(item));
  if (Array.isArray(value)) {
    return value.filter((item) => item !== '{roles}')
      .map((item) => (item && typeof item === 'object' && !Array.isArray(item) && holds(item) ? { ...item, enabled: false } : withoutPlaceholders(item)));
  }
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, withoutPlaceholders(v)]));
  return value;
}

/** portals.yml filled for the local profile (config/profile.yml): the CLI scanners. */
export function loadPortalsForProfile(portalsPath, profilePath) {
  const root = getJobYouGoRoot();
  const config = yaml.load(readFileSync(portalsPath || path.join(root, 'portals.yml'), 'utf-8')) || {};
  let profile = {};
  try {
    profile = yaml.load(readFileSync(profilePath || path.join(root, 'config/profile.yml'), 'utf-8')) || {};
  } catch { /* no profile: placeholders stay */ }
  return portalsForProfile(config, { targeting: targetingFromProfile(profile) });
}

// ── One-off migration: role words → placeholders ────────────────────────────

/**
 * Whether a search word names a role of the file: it matches its title
 * positives, is a board keyword, or is a single word of one (queries written
 * as "Solutions" OR "AI").
 */
function roleTermTest(config) {
  const tf = config.title_filter || {};
  const positive = { positive: tf.positive, positive_patterns: tf.positive_patterns };
  const boardTerms = (config.job_board_keywords || []).map((word) => String(word).trim().toLowerCase());
  const boardWords = new Set(boardTerms.flatMap((term) => term.split(/\s+/)).filter((word) => word.length >= 2 && word !== 'of'));
  return (value) => {
    const word = String(value || '').trim().replace(/^"|"$/g, '').trim().toLowerCase();
    return Boolean(word) && (boardTerms.includes(word) || boardWords.has(word) || Boolean(explainTitle(word, positive).matched));
  };
}

/** A query with each OR group (parenthesised, or a bare run of quoted phrases) that names a role as {roles}. */
function templateQuery(query, isRole) {
  const swap = (whole, inner) => (inner.split(/\s+OR\s+/i).some(isRole) ? '{roles}' : whole);
  return String(query)
    .replace(/\(([^()]*)\)/g, swap)
    .replace(/"[^"]*"(?:\s+OR\s+"[^"]*")*/g, (run) => swap(run, run))
    .replace(/\{roles\}(?:\s+\{roles\})+/g, '{roles}');
}

/**
 * The file with its role words replaced by placeholders and its title
 * positives removed: role OR groups in queries → {roles}, keyword lists that
 * name a role → ["{roles}"], role scalars (q, searchKeywords) and URL search
 * parameters → {role}. Category feeds and filters stay as they are.
 */
export function templatePortals(config = {}) {
  const isRole = roleTermTest(config);
  const convert = (value, key) => {
    if (Array.isArray(value)) {
      if (LIST_KEYS.has(key) && value.some((item) => typeof item === 'string' && isRole(item))) return ['{roles}'];
      return value.map((item) => convert(item, ''));
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, k === 'title_filter' ? v : convert(v, k)]));
    }
    if (typeof value !== 'string') return value;
    if (WORD_KEYS.has(key) && isRole(value)) return '{role}';
    if (key === 'query' || key === 'scan_query') return templateQuery(value, isRole);
    if (/url$|^api$/i.test(key)) return value.replace(URL_SEARCH_PARAM, '$1{role}');
    return value;
  };
  const out = convert(config, '');
  if (config.title_filter) {
    const { positive, positive_patterns: positivePatterns, ...rest } = config.title_filter;
    out.title_filter = rest;
  }
  return out;
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  if (!args.includes('--templatize')) {
    console.error('Usage: node lib/scan-targeting.mjs --templatize [portals.yml] [--write]');
    process.exitCode = 1;
  } else {
    const file = args.find((arg) => !arg.startsWith('--')) || path.join(getJobYouGoRoot(), 'portals.yml');
    const before = yaml.load(readFileSync(file, 'utf-8')) || {};
    const after = templatePortals(before);
    const dumped = yaml.dump(after, { lineWidth: 120, quotingType: '"' });
    if (args.includes('--write')) {
      const backup = `${file}.bak-${new Date().toISOString().slice(0, 10)}`;
      copyFileSync(file, backup);
      writeFileSync(file, dumped, 'utf-8');
      console.log(`${file} templated (backup ${backup})`);
    } else {
      process.stdout.write(dumped);
    }
  }
}
