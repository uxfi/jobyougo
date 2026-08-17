/**
 * lib/challenge-detect.mjs — anti-bot / captcha detection, single source of truth.
 *
 * Two detectors used to live in ui/server.mjs with independent, overlapping
 * keyword lists. Both leaned on substrings that ordinary pages contain, which
 * cost real work:
 *
 *   - `'cloudflare'` matched against RAW HTML. Cloudflare injects
 *     /cdn-cgi/scripts/<hash>/cloudflare-static/email-decode.min.js into any
 *     page carrying an email address, so live 200-OK postings were parked as
 *     `skipped_blocked` and the headed-Chrome fallback sat waiting 75s for an
 *     interstitial that was never on screen.
 *   - `/robot/i` with no word boundary matches "Robotics", "Robotic",
 *     "roboter" — i.e. the careers page of every robotics company.
 *   - `'cloudflare'` in visible text matches Cloudflare's own careers page.
 *
 * The rule this module enforces: a marker may only be matched against the
 * surface where it cannot occur innocently.
 *
 *   HTML markers  → challenge INFRASTRUCTURE (script paths, cookies, headers).
 *                   Never plain words.
 *   TEXT markers  → challenge COPY, matched against EXTRACTED TEXT only.
 *   WEAK markers  → phrases a real posting can legitimately contain. Trusted
 *                   only on a short page, since an interstitial carries almost
 *                   no copy while a real posting carries plenty.
 */

// ─── Markers ────────────────────────────────────────────────────────────────

/**
 * Challenge infrastructure. These ship only with an actual interstitial or
 * bot-management vendor, so they are safe against raw HTML.
 */
export const CHALLENGE_HTML_MARKERS = [
  // Cloudflare challenge platform (NOT the bare word "cloudflare")
  'cf-mitigated',
  '/cdn-cgi/challenge-platform/',
  'cf_chl_opt',
  'cf-browser-verification',
  '__cf_chl',
  // Captcha widgets
  'g-recaptcha',
  'grecaptcha.',
  'www.google.com/recaptcha/',
  'hcaptcha.com/captcha',
  'h-captcha',
  'challenges.cloudflare.com/turnstile',
  'cf-turnstile',
  // Commercial bot management
  '_px_captcha',        // PerimeterX
  'perimeterx.net',
  'captcha-delivery.com', // DataDome
  'datadome',
  '_incapsula_resource', // Imperva / Incapsula
  'kasada',
  'ak_bmsc',            // Akamai Bot Manager
  '/akam/',
];

/**
 * Unambiguous challenge copy. Matched against EXTRACTED TEXT only.
 * Every entry is a full phrase — no bare words that a posting could contain.
 */
export const CHALLENGE_TEXT_MARKERS = [
  'just a moment',
  'enable javascript and cookies',
  'verify you are human',
  'verifying you are human',
  'checking your browser',
  'checking if the site connection is secure',
  "i'm not a robot",
  'i am not a robot',
  'are you a robot',
  'robot check',
  'unusual traffic from your computer',
  'your request has been blocked',
  'attention required! | cloudflare',
  'select all squares containing',
  'anomaly-modal',
];

/**
 * Phrases a genuine job posting can legitimately contain — a security-role JD,
 * an access-policy blurb, a page about captchas. Only trusted on a short page.
 */
export const WEAK_TEXT_MARKERS = [
  'security check',
  'access denied',
  'captcha',
];

/**
 * An interstitial is short. Above this much extracted text, a WEAK marker is
 * far more likely to be real content than a wall.
 */
export const INTERSTITIAL_MAX_TEXT_LENGTH = 1500;

/** HTTP statuses that mean "blocked" regardless of body. */
const BLOCKING_STATUSES = new Set([401, 403, 429]);

// ─── Detection ──────────────────────────────────────────────────────────────

function includesAny(haystack, needles) {
  for (const n of needles) if (haystack.includes(n)) return n;
  return null;
}

/**
 * Infrastructure check against raw HTML.
 * @returns {string|null} the marker that matched, or null.
 */
export function matchChallengeHtml(html = '') {
  return includesAny(String(html || '').toLowerCase(), CHALLENGE_HTML_MARKERS);
}

/**
 * Copy check against extracted/visible text.
 * `textLength` defaults to the text's own length; pass the FULL page text
 * length when handing in a truncated sample, so the short-page rule stays honest.
 * @returns {string|null} the marker that matched, or null.
 */
export function matchChallengeText(text = '', { textLength = null } = {}) {
  const t = String(text || '').toLowerCase();
  if (!t) return null;
  const strong = includesAny(t, CHALLENGE_TEXT_MARKERS);
  if (strong) return strong;
  const len = textLength == null ? t.length : textLength;
  return len < INTERSTITIAL_MAX_TEXT_LENGTH ? includesAny(t, WEAK_TEXT_MARKERS) : null;
}

/**
 * Is this a challenge page? Combines both surfaces.
 * @returns {{blocked: boolean, reason: string|null, marker: string|null}}
 */
export function detectChallenge({ status = 200, html = '', text = '', textLength = null } = {}) {
  if (BLOCKING_STATUSES.has(Number(status))) {
    return { blocked: true, reason: 'http_status', marker: String(status) };
  }
  const htmlHit = matchChallengeHtml(html);
  if (htmlHit) return { blocked: true, reason: 'html_marker', marker: htmlHit };

  const textHit = matchChallengeText(text, { textLength });
  if (textHit) return { blocked: true, reason: 'text_marker', marker: textHit };

  return { blocked: false, reason: null, marker: null };
}
