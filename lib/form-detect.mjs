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
  // SmartRecruiters oneclick-ui keeps real inputs inside open shadow roots
  // (SPL-INPUT / SPL-DROPZONE). Light-DOM-only querySelectorAll misses them.
  const deepQueryAll = (root, selector) => {
    const out = [];
    const visit = (node) => {
      if (!node?.querySelectorAll) return;
      out.push(...node.querySelectorAll(selector));
      for (const el of node.querySelectorAll('*')) {
        if (el.shadowRoot) visit(el.shadowRoot);
      }
    };
    visit(root);
    return out;
  };
  const shadowHost = (el) => {
    const root = el.getRootNode?.();
    return root && root !== document && root.host ? root.host : null;
  };
  const visible = (el) => {
    if (!el || el.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none' && st.opacity !== '0';
  };
  const controlVisible = (el) => {
    if (visible(el)) return true;
    const host = shadowHost(el);
    return !!host && visible(host);
  };
  const textOf = (el) => ((el && el.innerText) || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const inViewport = (el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    return r.width >= 8 && r.height >= 8
      && r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw
      && st.visibility !== 'hidden' && st.display !== 'none' && st.opacity !== '0';
  };
  const inClosedTab = (el) => {
    const panel = el.closest('[role="tabpanel"]');
    if (!panel) return false;
    if (panel.hidden || panel.getAttribute('hidden') != null) return true;
    if (panel.getAttribute('aria-hidden') === 'true') return true;
    const tabId = panel.getAttribute('aria-labelledby');
    if (tabId) {
      const tab = document.getElementById(tabId);
      if (tab && tab.getAttribute('aria-selected') === 'false') return true;
    }
    return false;
  };
  const looksLikeDropzone = (t) =>
    /click or drag|drag (and|&) drop|choose a file|drop it here|upload (a |your )?(file|resume|cv)|parcourir/.test(t)
    || (/\bupload\b/.test(t) && t.length < 80)
    || /\bresume\b|\bcv\b|curriculum/.test(t);

  const allInputs = deepQueryAll(document,
    'input[type="text"], input[type="email"], input[type="tel"], input:not([type]), textarea, [contenteditable="true"], [role="textbox"]',
  ).filter(controlVisible);
  const files = deepQueryAll(document, 'input[type="file"]');
  const fileProxyVisible = (el) => {
    if (el.closest('[hidden], [aria-hidden="true"], [inert]') || inClosedTab(el)) return false;
    if (visible(el) || inViewport(el)) return true;
    const labelled = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
    if (labelled && (visible(labelled) || inViewport(labelled))) return true;
    const wrap = el.closest('label');
    if (wrap && (visible(wrap) || inViewport(wrap))) return true;
    // Light parents + shadow hosts (SPL-DROPZONE on SmartRecruiters oneclick-ui).
    const chain = [];
    let node = el.parentElement;
    for (let d = 0; d < 6 && node; d++, node = node.parentElement) chain.push(node);
    let host = shadowHost(el);
    for (let d = 0; d < 6 && host; d++) {
      chain.push(host);
      const next = shadowHost(host);
      host = next || host.parentElement;
      if (!next && host === chain[chain.length - 1]) break;
    }
    for (const n of chain) {
      if (n.closest?.('[hidden], [aria-hidden="true"], [inert]') || inClosedTab(n)) continue;
      const st = getComputedStyle(n);
      if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') continue;
      if (!(visible(n) || inViewport(n))) continue;
      if (/DROPZONE|FILE-UPLOAD|UPLOAD/i.test(n.tagName || '')) return true;
      const t = (n.innerText || n.getAttribute?.('aria-label') || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (!t || t.length > 280) continue;
      if (looksLikeDropzone(t)) return true;
    }
    return false;
  };
  const usableFiles = files.filter(fileProxyVisible);
  const passwords = deepQueryAll(document, 'input[type="password"]').filter(controlVisible);

  const descriptorOf = (i) => (
    (i.name || '') + ' ' + (i.id || '') + ' ' + (i.getAttribute('aria-label') || '') + ' ' +
    (i.placeholder || '') + ' ' + (i.getAttribute('autocomplete') || '')
  ).toLowerCase();
  const isSearchish = (el) => /\bsearch\b|\bfilter\b|\bkeyword\b|find (a )?job/.test(
    `${descriptorOf(el)} ${(el.placeholder || '').toLowerCase()}`,
  );
  const inputs = allInputs.filter(el => !isSearchish(el));
  const descriptors = inputs.map(descriptorOf).join(' | ');

  const pageText = textOf(document.body).slice(0, 4000);
  const headings = deepQueryAll(document, 'h1, h2, [role="heading"]').map(textOf).join(' | ');
  const buttons = deepQueryAll(document, 'button, [type="submit"], [role="button"], spl-button, oc-button')
    .filter(controlVisible).map(textOf).join(' | ');
  const url = String(location.href).toLowerCase();

  const signals = [];
  const blockers = [];
  let score = 0;

  // ── Strong positives: things only a real application form carries ────────
  if (usableFiles.length > 0) { score += 3; signals.push('file_upload'); }
  if (/resume|r[ée]sum[ée]|\bcv\b|cover.?letter|lettre de motivation/.test(descriptors)) {
    score += 3; signals.push('resume_or_cover_field');
  }
  if (/linkedin|portfolio|github|website/.test(descriptors)) { score += 1; signals.push('profile_link_field'); }
  // ATS form containers (incl. SmartRecruiters oneclick-ui custom elements).
  if (document.querySelector(
    '#application_form, #application, [id*="greenhouse"], [class*="greenhouse"], ' +
    '[data-ui="application_form"], [class*="ashby"], [id*="lever"], [class*="posting-apply"], ' +
    '[data-automation-id*="applicationPage"], [id*="icims"], [class*="workday"], ' +
    'spl-dropzone, spl-input, [class*="oneclick" i], [class*="smartrecruiters" i]',
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
    return usableFiles.length > 0 || /resume|cover.?letter/.test(descriptors);
  }

  // ── Verdict ──────────────────────────────────────────────────────────────
  // 3 is one strong application-only signal, or the combination of an
  // apply URL with identity fields. Identity fields alone score 1-2 and
  // never qualify — that is the whole point.
  // ATS styling also appears on overview pages. Never stop navigation until
  // there is an actual visible field. Hidden <input type=file> (display:none
  // behind a dropzone) counts only when that dropzone is itself visible —
  // otherwise a marketing / Overview tab with a preloaded Application panel
  // is mistaken for the form and the runner never clicks Apply.
  const applyEntryCta = deepQueryAll(document, 'a, button, [role="button"], spl-button, oc-button')
    .filter(controlVisible)
    .some(el => /^(apply for this (job|position|role)|postuler à cette offre)$/i.test(textOf(el)));
  const identityInputs = inputs.filter(i => /name|email|mail|phone|tel\b/.test(descriptorOf(i)));
  if (applyEntryCta && identityInputs.length < 2 && inputs.length < 3) {
    blockers.push('job_preview_cta');
    return { verdict: 'none', score, signals, blockers };
  }

  const hasVisibleField = inputs.length > 0 || usableFiles.length > 0
    || deepQueryAll(document, 'select, [role="combobox"]').some(el => controlVisible(el) && !inClosedTab(el));
  return { verdict: score >= 3 && hasVisibleField ? 'application_form' : 'none', score, signals, blockers };
};

// Visible "Apply for this job" means the application form is not open yet
// (Deel/Ashby Overview). Injected by the runner before auto-submit.
export const PAGE_SHOWS_APPLY_ENTRY = () => {
  const txt = (el) => ((el.innerText || el.value || '')).replace(/\s+/g, ' ').trim();
  const visible = (el) => {
    if (!el || el.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 8 && r.height > 8 && st.visibility !== 'hidden' && st.display !== 'none' && st.opacity !== '0';
  };
  const re = /^(apply for this (job|position|role)|postuler à cette offre)$/i;
  return [...document.querySelectorAll('a, button, [role="button"]')].some(el => visible(el) && re.test(txt(el)));
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
  const labelOf = (el) => ((el.innerText || el.value || el.getAttribute('aria-label') || '')).replace(/\s+/g, ' ').trim();
  const isDisabled = (el) => el.disabled || el.getAttribute('aria-disabled') === 'true'
    || !!el.closest('[disabled], [aria-disabled="true"], [inert]');
  for (const el of document.querySelectorAll('a, button, [role="button"], [role="tab"], input[type="submit"], input[type="button"]')) {
    const r = el.getBoundingClientRect();
    if (r.width < 5 || r.height < 5) continue;
    if (isDisabled(el)) continue;
    const t = labelOf(el);
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

/**
 * Visible controls for the navigation AI. Stamps `data-co-nav` in DOM order.
 * Auth / already-tried labels are dropped here so the model never sees them.
 * No progression regex — that failure is why this list exists.
 */
export const LIST_VISIBLE_NAV_BUTTONS = ({ avoidSrc, skip = [] } = {}) => {
  document.querySelectorAll('[data-co-nav]').forEach((el) => el.removeAttribute('data-co-nav'));
  const avoid = new RegExp(avoidSrc, 'i');
  const skipSet = new Set((skip || []).map((s) => String(s).trim().toLowerCase()));
  const labelOf = (el) => ((el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || '')).replace(/\s+/g, ' ').trim();
  const isDisabled = (el) => el.disabled || el.getAttribute('aria-disabled') === 'true'
    || !!el.closest('[disabled], [aria-disabled="true"], [inert]');
  const out = [];
  let n = 0;
  for (const el of document.querySelectorAll('a, button, [role="button"], [role="tab"], input[type="submit"], input[type="button"]')) {
    const r = el.getBoundingClientRect();
    if (r.width < 5 || r.height < 5) continue;
    if (isDisabled(el)) continue;
    const t = labelOf(el);
    if (!t || t.length > 80) continue;
    if (avoid.test(t) || skipSet.has(t.toLowerCase())) continue;
    el.setAttribute('data-co-nav', String(n));
    out.push({ n, text: t, href: (el.href || '').slice(0, 100) });
    n++;
    if (n >= 12) break;
  }
  return out;
};

/** Heading + short body for review-step classification. Injected as-is. */
export const PAGE_STEP_SNAPSHOT = () => {
  const pick = (sel) => [...document.querySelectorAll(sel)]
    .map((el) => (el.innerText || '').replace(/\s+/g, ' ').trim())
    .filter((t) => t && t.length < 160)
    .slice(0, 8);
  const heading = pick('h1, h2, h3, [role="heading"], legend').join(' | ');
  const bodySnippet = (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 900);
  return { heading, bodySnippet };
};
