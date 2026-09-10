import {
  CHALLENGE_HTML_MARKERS,
  CHALLENGE_TEXT_MARKERS,
  INTERSTITIAL_MAX_TEXT_LENGTH,
  WEAK_TEXT_MARKERS,
} from './challenge-detect.mjs';

// Marker lists live in lib/challenge-detect.mjs — passed in as evaluate()
// arguments because Playwright serializes this function into each frame and
// cannot close over ESM imports.
export const BLOCKER_PROBE_ARGS = {
  strongHtmlMarkers: CHALLENGE_HTML_MARKERS,
  strongTextMarkers: CHALLENGE_TEXT_MARKERS,
  weakTextMarkers: WEAK_TEXT_MARKERS,
  interstitialMaxLen: INTERSTITIAL_MAX_TEXT_LENGTH,
  // Default true so callers that probe a single page/frame (tests, ad-hoc
  // checks) keep the old single-frame behavior; apply-runner.mjs overrides
  // this per frame when scanning page.frames().
  isMainFrame: true,
};

// In-page blocker detection, shared with browser regression tests.
export function blockerProbe({ strongHtmlMarkers, strongTextMarkers, weakTextMarkers, interstitialMaxLen, isMainFrame = true }) {
  const visible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return r.width > 10 && r.height > 10 && style.visibility !== 'hidden'
      && style.display !== 'none' && style.opacity !== '0'
      && !el.closest('[hidden], [aria-hidden="true"], [inert]');
  };
  const includesAny = (haystack, needles) => needles.some((n) => haystack.includes(n));
  // Active challenges only — the floating reCAPTCHA badge (bottom-right on
  // every Greenhouse form) is NOT a blocker. Covers the widget-based challenge
  // providers seen in practice on ATS/career sites: reCAPTCHA, hCaptcha,
  // Cloudflare Turnstile, DataDome, PerimeterX/HUMAN, Arkose Labs (FunCaptcha),
  // AWS WAF captcha, Friendly Captcha, and GeeTest.
  const captchaSel = [
    'iframe[src*="recaptcha"]', '.g-recaptcha',
    'iframe[src*="hcaptcha"]', '[class*="h-captcha"]',
    'iframe[src*="turnstile"]', '[class*="turnstile"]',
    'iframe[src*="datadome"]', '[id*="datadome"]', '[class*="datadome"]',
    'iframe[src*="perimeterx"]', '#px-captcha', '[class*="px-captcha"]',
    'iframe[src*="arkoselabs"]', '#FunCaptcha', '[class*="funcaptcha"]',
    'iframe[src*="captcha.awswaf"]', '[id*="awswaf-captcha"]',
    'iframe[src*="friendlycaptcha"]', '.frc-captcha',
    '.geetest_holder', 'iframe[src*="geetest"]',
  ].join(', ');
  const isChallenge = [...document.querySelectorAll(captchaSel)]
    .filter(el => !el.closest('.grecaptcha-badge'))
    .some(visible);
  if (isChallenge) {
    // Checkbox-style widgets (reCAPTCHA v2, hCaptcha, Turnstile) stay in the DOM
    // after the human solves them — only the hidden response token changes.
    // Without this check the runner would see the same widget forever and
    // never auto-resume once the challenge is actually cleared.
    const solved = [...document.querySelectorAll(
      'textarea[name="g-recaptcha-response"], input[name="h-captcha-response"], textarea[name="h-captcha-response"], input[name="cf-turnstile-response"]'
    )].some(el => (el.value || '').trim().length > 10);
    if (!solved) return 'captcha';
  }
  const html = (document.documentElement?.outerHTML || '').toLowerCase();
  const fullBodyText = (document.body?.innerText || '').toLowerCase();
  if (includesAny(html, strongHtmlMarkers) || includesAny(fullBodyText, strongTextMarkers)) return 'cloudflare';
  // Weak markers (bare words like "captcha") are only trustworthy on the
  // top-level page. Third-party ad/analytics iframes (Google's ad-fraud
  // recaptcha/api2/aframe, DoubleClick, etc.) routinely ship short boilerplate
  // containing these words with no relation to the site's own bot-check state
  // — checking them there false-positives a perfectly loaded page as blocked.
  if (isMainFrame && fullBodyText.length < interstitialMaxLen && includesAny(fullBodyText, weakTextMarkers)) return 'cloudflare';
  if (/sign in to continue|log in to apply|sign in to apply|log in to continue|connectez-vous pour postuler|sign in to himalayas|log in to himalayas/.test(fullBodyText)
      && [...document.querySelectorAll('input[type="password"]')].some(visible)) return 'login';
  return null;
}
