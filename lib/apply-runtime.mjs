// Shared apply-runner helpers that must stay importable from tests.
// apply-runner.mjs itself exits when --run-dir is missing, so nothing
// Playwright-specific lives here.

export const POST_APPLY_PATH_RE_SOURCE = [
  'thank[-_]?you',
  'application[-_/]?(submitted|received|complete[d]?)',
  'apply[-_/]?(success|submitted|complete[d]?)',
  'job[-_]?application[-_/]?(success|complete[d]?)',
  'email[-_]?verification[-_]?needed',
  'verify[-_]?your[-_]?email',
].join('|');

export function looksLikePostApplyPath(urlOrPath = '') {
  const raw = String(urlOrPath || '');
  if (!raw) return false;
  let path = raw;
  try {
    if (/^https?:\/\//i.test(raw)) path = new URL(raw).pathname;
  } catch {
    return false;
  }
  return new RegExp(`(?:^|/)(?:${POST_APPLY_PATH_RE_SOURCE})(?:/|$|\\b)`, 'i').test(path.toLowerCase());
}

export function isTargetClosedError(err) {
  const msg = String(err?.message || err || '');
  return /target (closed|page|context)|browser has been closed|session closed|has been closed/i.test(msg);
}

export function basenamePath(p = '') {
  return String(p || '').split(/[/\\]/).filter(Boolean).pop() || '';
}

export function postApplyMessage(url = '') {
  if (/email[-_]?verif|verify[-_]?your[-_]?email/i.test(String(url))) {
    return '🎉 Candidature envoyée — vérifie ta boîte mail pour confirmer ton adresse.';
  }
  return '🎉 Candidature envoyée — confirmation détectée sur la page.';
}

export function chromeClosedMessage() {
  return 'Chrome a été fermé pendant la candidature. Relance pour réessayer.';
}
