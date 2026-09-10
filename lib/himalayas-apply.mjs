/**
 * Pure helpers for the Himalayas apply preamble (login → captcha → Apply).
 * Kept free of Playwright so edge-case decisions are unit-testable.
 */

export function isHimalayasHost(url) {
  try {
    return /(^|\.)himalayas\.app$/i.test(new URL(String(url || '')).hostname);
  } catch {
    return false;
  }
}

export function isHimalayasLoginPath(url) {
  try {
    const path = new URL(String(url || '')).pathname.replace(/\/+$/, '') || '/';
    return path === '/login';
  } catch {
    return false;
  }
}

/**
 * Only run the Himalayas login preamble while we are still on himalayas.app.
 * Once Apply redirects to Greenhouse/Ashby/Lever/etc., session work is done —
 * calling ensure again would yank the browser off the employer form.
 */
export function shouldEnsureHimalayasSession({ jobUrl, currentUrl } = {}) {
  if (!isHimalayasHost(currentUrl)) return false;
  // Current page is Himalayas. Prefer ensuring when the tracked offer is also
  // Himalayas, but also when a mid-flow hop lands on himalayas.app (login).
  return isHimalayasHost(jobUrl) || isHimalayasLoginPath(currentUrl);
}

/** Strip hash + trailing slash for "are we already on the offer?" checks. */
export function samePageUrl(a, b) {
  const norm = (u) => {
    try {
      const parsed = new URL(String(u || ''));
      parsed.hash = '';
      let path = parsed.pathname.replace(/\/+$/, '');
      if (!path) path = '/';
      parsed.pathname = path;
      return parsed.toString();
    } catch {
      return String(u || '').split('#')[0].replace(/\/+$/, '');
    }
  };
  return norm(a) === norm(b);
}

/**
 * Decide logged-in from DOM signals collected by the runner.
 * - Explicit Log in / Sign in CTA ⇒ logged out
 * - Otherwise on Himalayas (and not /login) ⇒ treat as logged in
 *   (avatar-only headers have no logout text until the menu opens)
 */
export function inferHimalayasLoggedIn({ currentUrl, hasNavLoginCta } = {}) {
  if (!isHimalayasHost(currentUrl)) return false;
  if (isHimalayasLoginPath(currentUrl)) return false;
  if (hasNavLoginCta) return false;
  return true;
}

/**
 * Cap automated credential submits so a bad password cannot burn the hop budget
 * re-opening /login forever inside reachApplicationForm.
 */
export function canAttemptHimalayasLogin(attemptsSoFar, maxAttempts = 2) {
  const n = Number(attemptsSoFar) || 0;
  const max = Math.max(1, Number(maxAttempts) || 2);
  return n < max;
}

/** Visible login-form error copy (wrong password / unknown account). */
export function looksLikeHimalayasLoginError(bodyText = '') {
  const t = String(bodyText || '').toLowerCase();
  return /invalid (email|password|credentials)|incorrect (email|password)|wrong password|couldn't sign you in|could not sign you in|login failed|unable to log in|identifiants? (invalides?|incorrects?)|mot de passe incorrect|e-?mail ou mot de passe/.test(t);
}
