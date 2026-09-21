/**
 * Anti-bot / captcha detection — single source of truth for scan, apply, liveness.
 *
 * Match a marker only on the surface where it cannot occur innocently:
 *   HTML  → challenge infrastructure (script paths, widgets, headers)
 *   TEXT  → challenge copy
 *   WEAK  → phrases a real posting can contain; trusted only on a short page
 */

// ─── Markers ────────────────────────────────────────────────────────────────

/**
 * Challenge infrastructure. These ship only with an actual interstitial or
 * bot-management vendor, so they are safe against raw HTML.
 */
export const CHALLENGE_HTML_MARKERS = [
  // Cloudflare challenge platform (NOT the bare word "cloudflare"). Scoped to
  // the `/h/…/orchestrate/` path used to actually SERVE an interstitial —
  // not the bare `/cdn-cgi/challenge-platform/` prefix, which also covers
  // `scripts/jsd/main.js`: Cloudflare's passive "JS Detections" beacon that
  // Bot Management loads on every request (challenge or not) to score
  // traffic in the background. That beacon alone false-positived every
  // Cloudflare-proxied job posting that never showed a challenge at all
  // (e.g. smartrecruiters.com listings) — 0 fields filled, nothing to solve.
  'cf-mitigated',
  '/cdn-cgi/challenge-platform/h/',
  'cf_chl_opt',
  'cf-browser-verification',
  '__cf_chl',
  // Challenge-specific commercial bot-management endpoints/widgets
  '_px_captcha',        // PerimeterX
  'px-captcha',
  'captcha-delivery.com', // DataDome
  '_incapsula_resource', // Imperva / Incapsula
  'funcaptcha',
  'captcha.awswaf',     // AWS WAF
  'awswaf-captcha',
  'frc-captcha',
  'geetest_holder',     // GeeTest challenge widget
];

/**
 * Infrastructure that may also be loaded passively on a legitimate page.
 * These markers only count when the extracted page is interstitial-sized.
 */
export const WEAK_HTML_MARKERS = [
  // Captcha libraries/widgets can be preloaded by application forms.
  'g-recaptcha',
  'grecaptcha.',
  'www.google.com/recaptcha/',
  'hcaptcha.com/captcha',
  'h-captcha',
  'challenges.cloudflare.com/turnstile',
  'cf-turnstile',
  // Bot-management scripts/cookies are often present in monitor-only mode.
  'perimeterx.net',
  'datadome',
  'kasada',
  'ak_bmsc',
  '/akam/',
  // Vendor SDKs may load before an interactive challenge is actually shown.
  'arkoselabs',
  'friendlycaptcha',
  'geetest',
];

/**
 * Unambiguous challenge copy. Matched against EXTRACTED TEXT only.
 * Every entry is a full phrase — no bare words that a posting could contain.
 */
export const CHALLENGE_TEXT_MARKERS = [
  'just a moment',
  'enable javascript and cookies',
  'you need to enable javascript',
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
  'pardon our interruption',
  'request could not be satisfied',
  'performing security verification',
  'verify you are a human',
  'ray id:',
];

/**
 * Phrases a genuine job posting can contain. Trusted only on a short page.
 */
export const WEAK_TEXT_MARKERS = [
  'security check',
  'access denied',
  'captcha',
  'automated requests',
  'automated access',
  'additional verification required',
  'additional verification is required',
  'press and hold',
  'human verification',
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
 * `textLength` must describe the extracted page text, not the HTML source:
 * passive anti-bot SDKs often make HTML large while the visible page remains
 * a short challenge.
 * @returns {string|null} the marker that matched, or null.
 */
export function matchChallengeHtml(html = '', { textLength = null } = {}) {
  const h = String(html || '').toLowerCase();
  if (!h) return null;
  const strong = includesAny(h, CHALLENGE_HTML_MARKERS);
  if (strong) return strong;
  return textLength != null && textLength < INTERSTITIAL_MAX_TEXT_LENGTH
    ? includesAny(h, WEAK_HTML_MARKERS)
    : null;
}

/**
 * Copy check against extracted/visible text.
 * `textLength` defaults to the text's own length; pass the FULL page text
 * length when handing in a truncated sample, so the short-page rule stays honest.
 * Pass `allowWeak: false` to ignore length-gated markers (liveness, etc.).
 * @returns {string|null} the marker that matched, or null.
 */
export function matchChallengeText(text = '', { textLength = null, allowWeak = true } = {}) {
  const t = String(text || '').toLowerCase();
  if (!t) return null;
  const strong = includesAny(t, CHALLENGE_TEXT_MARKERS);
  if (strong) return strong;
  if (!allowWeak) return null;
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
  const pageTextLength = textLength == null ? String(text || '').length : textLength;
  const htmlHit = matchChallengeHtml(html, { textLength: pageTextLength });
  if (htmlHit) return { blocked: true, reason: 'html_marker', marker: htmlHit };

  const textHit = matchChallengeText(text, { textLength: pageTextLength });
  if (textHit) return { blocked: true, reason: 'text_marker', marker: textHit };

  return { blocked: false, reason: null, marker: null };
}
