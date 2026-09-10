/**
 * lib/form-detect.mjs — telling an application form apart from everything that
 * merely looks like one, plus the vocabulary for walking to it.
 *
 * The previous predicate in apply-runner.mjs was:
 *
 *   (hasIdentity && inputs.length >= 2) || (files.length > 0 && inputs.length >= 1)
 *
 * Verified against a real Chromium, that returns TRUE for a signup wall
 * ("Full name" + "Email" + a password field) and for a newsletter footer
 * ("Your name" + "Email"). The runner therefore believed it had arrived, and
 * started filling a signup form with the candidate's CV data.
 *
 * This module replaces the binary heuristic with a scored verdict that also
 * reports WHY, so the runner can stop and say "signup required" instead of
 * quietly creating an account.
 *
 * `APPLICATION_FORM_PROBE` is a self-contained function meant for
 * `frame.evaluate()` — no imports, no closures over module scope.
 */

/**
 * Runs in the page. Returns:
 *   {
 *     verdict: 'application_form' | 'auth_wall' | 'none',
 *     score: number,
 *     signals: string[],   // what pushed it towards a form
 *     blockers: string[],  // what pushed it away
 *   }
 */
export const APPLICATION_FORM_PROBE = () => {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
  };
  const textOf = (el) => ((el && el.innerText) || '').replace(/\s+/g, ' ').trim().toLowerCase();

  const inputs = [...document.querySelectorAll(
    'input[type="text"], input[type="email"], input[type="tel"], input:not([type]), textarea, [contenteditable="true"], [role="textbox"]',
  )].filter(visible);
  const files = [...document.querySelectorAll('input[type="file"]')];
  const passwords = [...document.querySelectorAll('input[type="password"]')].filter(visible);

  const descriptorOf = (i) => (
    (i.name || '') + ' ' + (i.id || '') + ' ' + (i.getAttribute('aria-label') || '') + ' ' +
    (i.placeholder || '') + ' ' + (i.getAttribute('autocomplete') || '')
  ).toLowerCase();
  const descriptors = inputs.map(descriptorOf).join(' | ');

  const pageText = textOf(document.body).slice(0, 4000);
  const headings = [...document.querySelectorAll('h1, h2, [role="heading"]')].map(textOf).join(' | ');
  const buttons = [...document.querySelectorAll('button, [type="submit"], [role="button"]')]
    .filter(visible).map(textOf).join(' | ');
  const url = String(location.href).toLowerCase();

  const signals = [];
  const blockers = [];
  let score = 0;

  // ── Strong positives: things only a real application form carries ────────
  if (files.length > 0) { score += 3; signals.push('file_upload'); }
  if (/resume|r[ée]sum[ée]|\bcv\b|cover.?letter|lettre de motivation/.test(descriptors)) {
    score += 3; signals.push('resume_or_cover_field');
  }
  if (/linkedin|portfolio|github|website/.test(descriptors)) { score += 1; signals.push('profile_link_field'); }
  // ATS form containers.
  if (document.querySelector(
    '#application_form, #application, [id*="greenhouse"], [class*="greenhouse"], ' +
    '[data-ui="application_form"], [class*="ashby"], [id*="lever"], [class*="posting-apply"], ' +
    '[data-automation-id*="applicationPage"], [id*="icims"], [class*="workday"]',
  )) { score += 3; signals.push('ats_container'); }
  if (/\/apply|\/application|application-form|job-application/.test(url)) { score += 2; signals.push('apply_url'); }
  if (/apply|application|candidature|postuler|bewerbung|solicitud/.test(headings)) {
    score += 1; signals.push('apply_heading');
  }

  // ── Identity fields: necessary but nowhere near sufficient ───────────────
  const hasIdentity = /name|email|mail|phone|tel\b/.test(descriptors);
  if (hasIdentity && inputs.length >= 2) { score += 1; signals.push('identity_fields'); }
  if (inputs.length >= 5) { score += 1; signals.push('many_fields'); }

  // ── Auth wall ────────────────────────────────────────────────────────────
  // A password field is the single clearest tell. Paired with signup/login
  // copy it is decisive: an application form never asks for a password.
  const authCopy = /sign ?up|sign ?in|log ?in|create (an )?account|register|already have an account|forgot (your )?password|cr[ée]er un compte|se connecter|s'inscrire|mot de passe oubli[ée]/;
  const authInCopy = authCopy.test(headings) || authCopy.test(buttons);
  if (passwords.length > 0) { blockers.push('password_field'); }
  if (authInCopy) { blockers.push('auth_copy'); }

  // Decisive when the page offers a password AND talks like auth, or when it
  // talks like auth and carries none of the application-only signals.
  const applicationOnly = signals.some(s => ['file_upload', 'resume_or_cover_field', 'ats_container'].includes(s));
  if ((passwords.length > 0 && authInCopy) || (authInCopy && !applicationOnly && inputs.length <= 4)) {
    return { verdict: 'auth_wall', score, signals, blockers };
  }
  if (passwords.length > 0 && !applicationOnly) {
    return { verdict: 'auth_wall', score, signals, blockers };
  }

  // ── Newsletter / marketing capture ───────────────────────────────────────
  // "Your name" + "Email" in a footer scores the same as an application form
  // under the old heuristic. Require it to be outside footer/aside context.
  const subscribeCopy = /subscribe|newsletter|stay (up to date|informed)|join our mailing|get job alerts|s'abonner|infolettre/;
  const inSubscribeContext = inputs.length > 0 && inputs.every((i) => {
    const scope = i.closest('footer, aside, [class*="newsletter"], [class*="subscribe"], [id*="newsletter"], [id*="subscribe"]');
    return Boolean(scope);
  });
  if (!applicationOnly && (inSubscribeContext || (subscribeCopy.test(pageText) && inputs.length <= 3 && !hasIdentityFileOrCover()))) {
    blockers.push('subscribe_context');
    return { verdict: 'none', score, signals, blockers };
  }
  function hasIdentityFileOrCover() {
    return files.length > 0 || /resume|cover.?letter/.test(descriptors);
  }

  // ── Verdict ──────────────────────────────────────────────────────────────
  // 3 is one strong application-only signal, or the combination of an
  // apply URL with identity fields. Identity fields alone score 1-2 and
  // never qualify — that is the whole point.
  // ATS styling also appears on overview pages. Never stop navigation until
  // there is an actual visible field, including file-only application steps.
  const hasVisibleField = inputs.length > 0 || files.some(visible)
    || [...document.querySelectorAll('select, [role="combobox"]')].some(visible);
  return { verdict: score >= 3 && hasVisibleField ? 'application_form' : 'none', score, signals, blockers };
};

// ─── Navigation vocabulary ──────────────────────────────────────────────────

/**
 * Controls that must NEVER be clicked while walking to the form: they lead
 * into account creation or a third-party identity provider, not the form.
 * Checked BEFORE the progression regexes, because a signup button very often
 * also reads "Continue" or "Apply".
 */
export const AUTH_AVOID_TEXT_RE = /^(sign ?up|sign ?in|log ?in|login|register|create (an )?account|continue with (google|linkedin|facebook|apple|github|microsoft)|s'inscrire|se connecter|cr[ée]er un compte|connexion)\b/i;

/**
 * The no-account path out of an interstitial. Tried FIRST at every hop.
 */
export const GUEST_TEXT_RE = /^(continue as (a )?guest|apply as (a )?guest|continue without (an )?account|apply without (an )?account|proceed without (an )?account|continue as visitor|apply (on|via) (the )?(company|employer)('s)? (web)?site|apply on company (web)?site|continuer sans compte|postuler sans compte|en tant qu'invit[ée]|no,? thanks.*|maybe later|not now|skip( for now)?|dismiss)$/i;

/**
 * Runs in the page. Tags the progression controls worth clicking with
 * `data-co-click` and returns them in DOM order, capped at 8.
 *
 * Lives here rather than inline in apply-runner.mjs so tests exercise the very
 * function the runner injects. It was inline, and adding `avoidSrc` to the
 * evaluate payload without adding it to the destructured parameter shipped a
 * `ReferenceError: avoidSrc is not defined` that a test re-implementing this
 * logic could not have caught.
 *
 * @param {{reSrc: string, skip: string[], avoidSrc: string}} args
 */
export const MARK_PROGRESSION_CONTROLS = ({ reSrc, skip, avoidSrc }) => {
  document.querySelectorAll('[data-co-click]').forEach(el => el.removeAttribute('data-co-click'));
  const re = new RegExp(reSrc, 'i');
  const avoid = new RegExp(avoidSrc, 'i');
  const skipSet = new Set(skip || []);
  const out = [];
  let n = 0;
  for (const el of document.querySelectorAll('a, button, [role="button"]')) {
    const r = el.getBoundingClientRect();
    if (r.width < 5 || r.height < 5) continue;
    const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
    if (!t || t.length > 80 || !re.test(t) || skipSet.has(t)) continue;
    // Account-creation and social-login controls are never a step towards the
    // form, and they frequently share wording with real progression ("Sign Up
    // and Apply", "Continue with Google"). Checked AFTER the progression regex
    // so it can veto a match, never widen one.
    if (avoid.test(t)) continue;
    el.setAttribute('data-co-click', String(n));
    out.push({ n, text: t, href: (el.href || '').slice(0, 100) });
    n++;
    if (n >= 8) break;
  }
  return out;
};
