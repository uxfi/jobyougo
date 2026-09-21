/**
 * remote-eligibility-core.mjs — zero-token remote/location-eligibility classifier.
 *
 * Born from #github-issue-pending: an ad-hoc, unsaved LLM prompt was asked to
 * pick "Product Manager/Product Designer roles with explicit proof of
 * internationally-allowed remote work" out of a freshly-scanned pipeline and
 * returned 0 matches out of a candidate count that didn't even correspond to
 * any real file in the project. Re-deriving the same judgment by hand against
 * the actual `data/pipeline.md` found 60+ postings that plainly qualify
 * (explicit "Remote", "Anywhere", or a named region already covered by
 * `config/profile.yml`'s `location.authorized_in`). The failure wasn't the
 * *rule* — the rule is simple and already lives in profile.yml — it was that
 * nothing durable ever implemented it: a natural-language prompt re-judges
 * the same postings differently every run and leaves no trace when it gets
 * them wrong. This module is that rule as code: deterministic, testable, and
 * versioned like every other zero-token classifier in this project
 * (liveness-core.mjs, skill-extract.mjs).
 *
 * Scope, deliberately narrow: this classifies LOCATION TEXT ALREADY CAPTURED
 * by the scanner (title/location/comp — the same fields `docs/AUTOMATION.md`'s
 * triage recipe judges from). It never opens a URL — that stays a job for a
 * human or an explicit WebFetch/WebSearch pass on the (usually short) `unclear`
 * bucket this leaves behind. Title/role relevance is a separate concern
 * (semantic judgment suits an LLM better than regex); this file only answers
 * "does the location text rule this OUT, IN, or leave it genuinely unclear."
 *
 * Three-way result, not two, on purpose: collapsing `unclear` into either
 * `compatible` or `incompatible` is exactly the false-confidence failure this
 * module exists to avoid. A posting with no remote/location signal at all
 * (e.g. a bare city with no "remote" keyword) is NOT proof of an on-site
 * requirement — scanners frequently capture only the office/hub city even for
 * fully remote roles (see AGENTS.md → Offer Verification) — so it is reported
 * as `unclear`, never silently dropped or silently accepted.
 */

// ── Country/region gazetteer ─────────────────────────────────────────
//
// EU + EEA member states, spelled the way job boards actually write them.
// This list only matters for the ALIAS EXPANSION below (treating "EU" /
// "EMEA" / "Europe" as compatible once the candidate is authorized in ANY
// member state) — it is not itself a restriction list.
const EU_EEA_COUNTRIES = [
  'austria', 'belgium', 'bulgaria', 'croatia', 'cyprus', 'czech republic', 'czechia',
  'denmark', 'estonia', 'finland', 'france', 'germany', 'greece', 'hungary', 'ireland',
  'italy', 'latvia', 'lithuania', 'luxembourg', 'malta', 'netherlands', 'poland',
  'portugal', 'romania', 'slovakia', 'slovenia', 'spain', 'sweden',
  'norway', 'iceland', 'liechtenstein',
];

// EMEA/Europe as used in postings is understood broadly enough to include the
// UK in practice (a "Remote - EMEA" or "Remote Europe" posting routinely
// accepts UK-based candidates, Brexit notwithstanding — this is a remote-work
// eligibility signal, not a legal work-authorization determination). Only
// activated alongside the EU/EEA alias, never on its own.
const UK_TOKENS = ['united kingdom', 'uk', 'england', 'scotland', 'wales', 'northern ireland'];

const EU_EEA_ALIAS_WORDS = ['eu', 'european union', 'eea', 'european economic area', 'emea', 'europe', 'european'];

// Universal compatible signals — true regardless of the candidate's
// authorized_in, because they assert no residency restriction at all.
const GLOBAL_RE = /\b(anywhere|worldwide|global|international)\b/i;

// A parenthetical "(X only)" or a leading "X-only" is the most common way a
// board narrows an otherwise-generic "Remote" label to one region. Captures X
// so it can be checked against the compatible set instead of hardcoding every
// possible restricted country/city as its own pattern.
const ONLY_QUALIFIER_RE = /\(([a-z][a-z .,'-]{1,40})\s+only\)|\b([a-z][a-z .'-]{1,30})[- ]only\b/i;

// Well-known broad-region restrictions that show up as free text (not always
// paired with "only"). Kept as a short, generic list — these phrasings are
// job-board boilerplate independent of which career-ops user is running this,
// unlike a full country gazetteer for the "compatible" side (which genuinely
// depends on the candidate's own authorized_in).
// Mirrors modes/_custom.md's own "US / must live in the US — SKIP" list
// verbatim where possible — that section is this project's existing,
// hand-tuned authority on which US signals are a hard stop, so the
// zero-token classifier and the LLM evaluation pass judge the same postings
// the same way instead of disagreeing with each other.
const KNOWN_RESTRICTIONS = [
  {
    re: /\bus[- ]?only\b|\bremote[- ]us\b(?!\s*or)|\bus remote\b(?!\s*or)|\bunited states only\b|\bus[- ]based\b/i,
    label: 'United States',
  },
  { re: /\bcanada[- ]?only\b/i, label: 'Canada' },
  { re: /\blatam\b|\blatin america\b/i, label: 'LATAM' },
  { re: /\bamericas[- ]?only\b/i, label: 'Americas' },
  {
    re: /\bmust\s+(?:live|reside|be based|be located)\s+in\s+(?:the\s+us\b|a\s+us\s+city)|\bi-9\b|\be-verify\b|\bus citizen\b|\bgreen card\b/i,
    label: 'United States (work authorization)',
  },
  {
    re: /\bus (?:pacific|eastern|central|mountain) time\b|\b(?:est|pst|cst|mst)[- ]only\b/i,
    label: 'United States (timezone)',
  },
];

const REMOTE_RE = /\bremote\b/i;
const HYBRID_OR_ONSITE_RE = /\bhybrid\b|\bon[- ]?site\b|\bin[- ]office\b/i;

// Words that can appear next to "Remote" in a location field without being a
// place name at all ("Remote - Full Time", "Remote Position") — excluded so
// the named-incompatible-region fallback below doesn't mistake them for an
// unrecognized country and reject a genuinely unspecified-remote posting.
const NON_PLACE_STOPWORDS = new Set([
  'remote', 'full time', 'part time', 'flexible', 'position', 'role', 'team',
  'friendly', 'first', 'only', 'based', 'timezone', 'hours', 'contract',
  'freelance', 'permanent', 'fulltime', 'parttime', 'hybrid',
]);

/**
 * A token from a location field is presumptively a place name if it looks
 * like one syntactically — location fields exist to hold places, so the bar
 * is "not obviously something else" rather than a full gazetteer match.
 */
function looksLikePlace(token) {
  const t = token.trim();
  if (t.length < 2 || t.length > 40) return false;
  if (!/^[a-z][a-z .'-]*$/i.test(t)) return false;
  if (NON_PLACE_STOPWORDS.has(normalize(t))) return false;
  return true;
}

function normalize(text) {
  return String(text || '').toLowerCase();
}

/**
 * Builds the set of location-text tokens this candidate's profile makes
 * compatible, derived from `config/profile.yml`'s `location.authorized_in`.
 * Generic by design: any career-ops user's own authorized_in drives this,
 * not anything specific to one person's bases.
 *
 * @param {string[]} authorizedIn - profile.location.authorized_in, e.g.
 *   ['France', 'European Union', 'European Economic Area', 'Thailand'].
 * @returns {{ words: Set<string>, hasEuEea: boolean }}
 */
export function buildCompatibleAliases(authorizedIn) {
  const list = Array.isArray(authorizedIn) ? authorizedIn : [];
  const words = new Set(list.map((c) => normalize(c)).filter(Boolean));
  const hasEuEea =
    [...words].some((w) => EU_EEA_ALIAS_WORDS.includes(w) || EU_EEA_COUNTRIES.includes(w));
  if (hasEuEea) {
    for (const w of EU_EEA_ALIAS_WORDS) words.add(w);
    for (const w of EU_EEA_COUNTRIES) words.add(w);
    for (const w of UK_TOKENS) words.add(w);
  }
  return { words, hasEuEea };
}

/**
 * Splits a location string on the separators postings actually use to offer
 * several regional remote options ("UNITED STATES - Remote, EMEA - Remote,
 * CANADA - Remote, LATAM - Remote", "Remote US or Remote EU"). Only splits on
 * top-level separators, not inside an "(X only)" parenthetical.
 */
function splitRegionOptions(text) {
  return text
    .split(/,| or |\/|·|\s[-–—]\s/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Substring matching is right for a full word like "germany" or "emea", but
// wrong for a 2-3 letter alias ("eu", "uk"): plain .includes() would match
// "eu" inside "Bureau" or "museum". Same defect class scan.mjs's own
// compileKeyword() already guards against for title_filter keywords — short
// tokens get word-boundary anchoring here for the identical reason.
function tokenIsCompatible(token, aliases) {
  const t = normalize(token);
  if (GLOBAL_RE.test(t)) return true;
  for (const w of aliases.words) {
    if (!w) continue;
    if (w.length <= 3) {
      if (new RegExp(`\\b${w}\\b`).test(t)) return true;
    } else if (t.includes(w)) {
      return true;
    }
  }
  return false;
}

function tokenIsKnownRestriction(token) {
  const t = normalize(token);
  for (const r of KNOWN_RESTRICTIONS) {
    if (r.re.test(t)) return r.label;
  }
  return null;
}

/**
 * Classifies one posting's location text against a profile's remote/location
 * rules. Pure function, zero network/LLM calls.
 *
 * @param {string} locationText - the `location` field already captured by
 *   the scanner (title/location/comp only — see docs/AUTOMATION.md).
 * @param {{ location?: { authorized_in?: string[] } }} profile - parsed
 *   config/profile.yml (only `location.authorized_in` is read).
 * @returns {{ status: 'compatible'|'incompatible'|'unclear', reason: string }}
 */
export function classifyLocation(locationText, profile) {
  const text = String(locationText || '').trim();
  if (!text) return { status: 'unclear', reason: 'no location text captured' };

  const aliases = buildCompatibleAliases(profile?.location?.authorized_in);

  if (GLOBAL_RE.test(text)) {
    return { status: 'compatible', reason: 'explicit worldwide/anywhere remote' };
  }

  // "(X only)" / "X-only" qualifiers: compatible only if X itself resolves to
  // a compatible token (e.g. "(France only)" for an EU-authorized candidate),
  // otherwise a hard restriction regardless of any "remote" elsewhere in the
  // string — the qualifier overrides a bare "remote" label.
  const onlyMatch = text.match(ONLY_QUALIFIER_RE);
  if (onlyMatch) {
    const restrictedTo = onlyMatch[1] || onlyMatch[2];
    if (tokenIsCompatible(restrictedTo, aliases)) {
      return { status: 'compatible', reason: `restricted to "${restrictedTo.trim()}", which is in authorized_in` };
    }
    return { status: 'incompatible', reason: `restricted to "${restrictedTo.trim()}" only, not in authorized_in` };
  }

  // Hybrid/on-site is an absolute disqualifier and must be checked BEFORE any
  // region-compatibility shortcut: "Berlin, Germany (Hybrid)" contains a
  // compatible country name (Germany) but is not full-remote at all, and the
  // must-have is full remote regardless of which country the office sits in.
  if (HYBRID_OR_ONSITE_RE.test(text) && !REMOTE_RE.test(text)) {
    return { status: 'incompatible', reason: 'hybrid/on-site required, no remote option stated' };
  }

  const restriction = tokenIsKnownRestriction(text);
  const options = splitRegionOptions(text);
  const nonRemoteOptions = options.filter((o) => !/^remote$/i.test(o));

  // Multi-option postings ("Remote US or Remote EU", "UNITED STATES - Remote,
  // EMEA - Remote, CANADA - Remote, LATAM - Remote"): compatible if ANY listed
  // option resolves to a compatible token, even when incompatible options are
  // also listed — the candidate only needs one workable door, not all of them.
  const compatibleOption = nonRemoteOptions.find((o) => tokenIsCompatible(o, aliases));
  if (compatibleOption) {
    return { status: 'compatible', reason: `compatible among the regions listed ("${compatibleOption.trim()}")` };
  }

  if (restriction) {
    return { status: 'incompatible', reason: `restricted to ${restriction}, not in authorized_in` };
  }

  if (!REMOTE_RE.test(text)) {
    // No "remote" keyword at all: scanners frequently capture only an office
    // city even for genuinely remote roles (AGENTS.md's own truncated-read
    // warning applies here too) — reporting "incompatible" would be a false
    // negative, "compatible" a false positive. Neither is honest from title +
    // location alone.
    return { status: 'unclear', reason: 'no explicit remote/on-site signal in location text' };
  }

  // Explicit "remote" IS present, no compatible region matched, and no fixed
  // KNOWN_RESTRICTIONS phrase matched either — but a specific, unrecognized
  // place name may still be sitting right next to it ("Remote - India"),
  // which a full country gazetteer isn't needed to catch: a location field
  // exists to hold places, so a token that syntactically looks like a place
  // and isn't one of this candidate's compatible ones is presumptively a
  // restriction, not a coincidence. Only fires when EVERY non-"remote" token
  // looks place-shaped — a token that doesn't (stray punctuation, "Full
  // Time") means the string isn't cleanly a named-region posting, so this
  // falls through to the unspecified-remote default below instead of
  // guessing.
  if (nonRemoteOptions.length > 0 && nonRemoteOptions.every(looksLikePlace)) {
    return {
      status: 'incompatible',
      reason: `restricted to "${nonRemoteOptions[0]}", not in authorized_in`,
    };
  }

  // Explicit "remote", nothing else named at all: the documented default
  // (config/profile.yml's own location.timezone_context rule — "EU/EMEA/
  // Africa/unspecified global remote" is treated as workable).
  return { status: 'compatible', reason: 'explicit remote, unspecified region (treated as workable by default)' };
}
