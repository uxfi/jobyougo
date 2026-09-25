/**
 * Shared Apply / Next / Submit button vocabularies for apply-runner and the
 * Chrome extension bridge. Keep wording here so multi-step wizards and
 * landing-page CTAs cannot drift between the two drivers.
 */

// Landing / job-page CTAs that open the application form.
export const APPLY_TEXT_RE = /^(apply(\s+(now|here|for|to)\b.*)?|postuler.*|candidater.*|d[ée]poser (ma |une )?candidature|easy apply|i'?m interested|apply for this (job|position|role)|soumettre|submit application|apply on company (web)?site)$/i;

// Multi-step wizard + interstitial progression (NOT final submit).
// Includes "continue to review" / "verify details" which advance TO the
// verification step — final "Confirm and submit" lives in SUBMIT_TEXT_RE.
export const PROGRESS_TEXT_RE = /^(continue(\s+(to|with|on)\b[\w\s]{0,40})?|next(\s+(step|page|section|question))?|save\s*(&|and)\s*(continue|next|review)|go\s+to\s+(next(\s+step)?|application)|proceed(\s+to\b[\w\s]{0,40})?|start(\s+your)?(\s+application)?|get\s+started|begin(\s+application)?|view\s+application|start\s+now|application|candidature|commencer|continuer(\s+vers\b[\w\s]{0,40})?|suivant|[ée]tape\s+suivante|passer\s+[àa]\s+la\s+suite|d[ée]marrer|acc[ée]der\s+au\s+formulaire|review(\s+(your\s+)?(application|details|answers|information))?|review\s+(&|and)\s+continue|continue\s+to\s+(review|confirmation|summary|submit)|preview(\s+(application|summary))?|verify(\s+(information|details|answers))?|check(\s+your)?(\s+(answers|information|details))?|confirm(\s+(details|information))|weiter|siguiente|avanti|pr[oó]ximo|continue\s+application|next\s*>|v[ée]rifier|aper[cç]u|r[ée]capitulatif)$/i;

// Final send — must NOT also match bare "Next" / "Review application".
export const SUBMIT_TEXT_RE = /^(submit(\s+application)?|send(\s+application)?|envoyer(\s+ma\s+candidature)?|postuler|apply|soumettre|finish|valider|review\s+(&|and)\s+submit|confirm\s+(&|and)\s+submit|confirm(\s+(my\s+)?)?application|verify\s+(&|and)\s+submit|complete(\s+application)?|finalize|finaliser|looks?\s+good|i'?m\s+done|envoyer\s+ma\s+candidature|confirmer(\s+(et\s+envoyer|la\s+candidature))?)$/i;

/** Pending reasons that must block clicking Next / auto-submit. */
export function isBlockingApplyPending(reason = '') {
  const r = String(reason);
  // A required box with no profile data (postal, hiring manager, school) is
  // filled with N/A or left blank on purpose. It must not freeze the wizard.
  if (/pas de donnée profil|code postal non renseigné|middle name|laissé vide|tiers \(laissé/i.test(r)) return false;
  return /upload échoué|CV introuvable|CV manquant|fichier requis|no matching option|option introuvable|introuvable|choix requis|upload non confirmé|requis et vide|valeur invalide|\brequired\b/i
    .test(r);
}

function normFingerprintText(value, max = 80) {
  return String(value || '')
    .replace(/[*✱]/g, '')
    .replace(/\b(required|requis|obligatoire)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, max);
}

function skipUnstableField(f) {
  const type = String(f?.type || '').toLowerCase();
  if (type === 'hidden') return true;
  const name = String(f?.name || '').toLowerCase();
  return /csrf|authenticity|viewstate|verificationtoken|requestverification|_token|nonce|timestamp|captcha/.test(name);
}

function optionSignature(f) {
  const opts = Array.isArray(f?.options) ? f.options : [];
  return opts
    .map((o) => normFingerprintText(typeof o === 'string' ? o : (o?.text || o?.label || '')))
    .filter(Boolean)
    .sort()
    .join(',');
}

function checkedSignature(f) {
  const type = String(f?.type || '').toLowerCase();
  const role = String(f?.role || '').toLowerCase();
  const isCheck = type === 'checkbox' || type === 'radio' || role === 'checkbox' || role === 'radio' || role === 'switch';
  if (!isCheck) return '';
  if (type === 'radio' || role === 'radio') return f.groupChecked ? '1' : '0';
  return (f.checked || f.groupChecked) ? '1' : '0';
}

function fileSignature(f) {
  if (String(f?.type || '').toLowerCase() !== 'file') return '';
  return (Number(f.fileCount) > 0 || String(f.fileChip || '').trim()) ? '1' : '0';
}

function valueSignature(f) {
  const type = String(f?.type || '').toLowerCase();
  if (type === 'hidden' || type === 'file' || type === 'checkbox' || type === 'radio') return '';
  return normFingerprintText(f?.value, 160);
}

function stableStepUrl(url) {
  return String(url || '').split('#')[0].split('?')[0].trim().toLowerCase().replace(/\/$/, '');
}

/**
 * Fingerprint used to tell a wizard step change from a re-render.
 * Field identity uses name, normalized label, type, visible value, checked
 * state, option texts, attached file, and invalid flag. DOM ids, CSRF /
 * hidden inputs, query tokens, option values, and field order are ignored.
 * URL path and heading stay so a SPA that only swaps the title still counts.
 */
export function fieldsFingerprint(fields = [], { url = '', heading = '' } = {}) {
  const body = (fields || [])
    .filter((f) => f && !skipUnstableField(f))
    .map((f) => [
      String(f.name || '').trim().toLowerCase(),
      normFingerprintText(f.label),
      String(f.type || '').toLowerCase(),
      valueSignature(f),
      checkedSignature(f),
      optionSignature(f),
      fileSignature(f),
      (f.invalid || f.ariaInvalid) ? '1' : '0',
    ].join('|'))
    .sort()
    .join('\n');
  const step = `${stableStepUrl(url)}\n${normFingerprintText(heading, 120)}`;
  return `${step}\n${body}`;
}

const REVIEW_HEADING_RE = /review (your )?(application|answers|information|details|submission)|verify (your )?(application|information|details|answers)|confirm (your )?(application|details|submission|information)|almost done|ready to (submit|send)|check your (application|answers|information)|r[ée]capitulatif|v[ée]rification|aper[cç]u de (votre )?candidature|pr[êe]t[e]? [àa] (envoyer|soumettre)/;

/**
 * Heuristic: page is a review / verification / confirmation step before the
 * final Submit (summary with few or no editable fields).
 */
export function pageLooksLikeReviewStep({
  heading = '',
  bodySnippet = '',
  fieldCount = 0,
  editableCount = 0,
} = {}) {
  const t = `${heading} ${bodySnippet}`.toLowerCase().replace(/\s+/g, ' ');
  if (/review (your )?(application|answers|information|details|submission)|verify (your )?(application|information|details|answers)|confirm (your )?(application|details|submission|information)|almost done|ready to (submit|send)|check your (application|answers|information)|r[ée]capitulatif|v[ée]rification|aper[cç]u de (votre )?candidature|pr[êe]t[e]? [àa] (envoyer|soumettre)/.test(t)) {
    return true;
  }
  // Summary screens often expose 0–2 controls (consent + submit only).
  if (fieldCount <= 2 && editableCount <= 1
      && /(review|verify|confirm your|r[ée]capitulatif|ready to submit|almost done|check your)/.test(t)) {
    return true;
  }
  return false;
}

/**
 * `high` when the heading itself is a review / verify screen.
 * A match that only lives in the body is `low` — not enough to send.
 */
export function reviewStepConfidence({
  heading = '',
  bodySnippet = '',
  fieldCount = 0,
  editableCount = 0,
} = {}) {
  const head = String(heading || '').toLowerCase().replace(/\s+/g, ' ');
  if (REVIEW_HEADING_RE.test(head)) return 'high';
  if (pageLooksLikeReviewStep({ heading, bodySnippet, fieldCount, editableCount })) return 'low';
  return 'none';
}

const ACTION_SUBMIT_RE = /\b(submit|send|envoyer|soumettre)\b|\bconfirm\s+(and|&)\s+submit\b|\bfinal(ise|iser|ize)?\b/;
const ACTION_REVIEW_AND_SUBMIT_RE = /\b(review|verify)\s+(and|&)\s+submit\b/;
const ACTION_PROGRESS_LEAD_RE = /^(continue|next|suivant|continuer|proceed|go\s+to|save\s+(and|&)\s+(continue|next))\b/;

/**
 * Score a visible button label.
 * submit: submit / send / confirm and submit / final, or review+submit.
 * review-nav: review+application without submit, or verify / preview / confirm details.
 * ambiguous: never an automatic send (e.g. "Confirm application").
 */
export function classifyActionLabel(raw = '') {
  const t = String(raw || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!t || t.length > 80) return { kind: 'ignore', confidence: 'none', autoSubmit: false };

  const explicitSend = ACTION_REVIEW_AND_SUBMIT_RE.test(t) || /^(submit|send|envoyer|soumettre|finish|finaliser|finalize)\b/.test(t);
  if (ACTION_PROGRESS_LEAD_RE.test(t) && !explicitSend) {
    return { kind: 'progress', confidence: 'high', autoSubmit: false };
  }
  if (ACTION_REVIEW_AND_SUBMIT_RE.test(t) || (/\breview\b/.test(t) && ACTION_SUBMIT_RE.test(t))) {
    return { kind: 'submit', confidence: 'high', autoSubmit: true };
  }
  if (ACTION_SUBMIT_RE.test(t)) {
    return { kind: 'submit', confidence: 'high', autoSubmit: true };
  }
  if (/\breview\b/.test(t) && /\b(application|candidature)\b/.test(t)) {
    return { kind: 'review-nav', confidence: 'high', autoSubmit: false };
  }
  if (/\b(verify|preview)\b/.test(t) || /\bconfirm\s+(details|information)\b/.test(t) || /\bv[ée]rifier\b/.test(t) || /\baper[cç]u\b/.test(t)) {
    return { kind: 'review-nav', confidence: 'high', autoSubmit: false };
  }
  if (/\breview\b/.test(t) || /\br[ée]capitulatif\b/.test(t)) {
    return { kind: 'review-nav', confidence: 'medium', autoSubmit: false };
  }
  if (/\bconfirm\b/.test(t) && /\b(application|candidature)\b/.test(t)) {
    return { kind: 'ambiguous', confidence: 'low', autoSubmit: false };
  }
  if (PROGRESS_TEXT_RE.test(t)) {
    return { kind: 'progress', confidence: 'high', autoSubmit: false };
  }
  if (SUBMIT_TEXT_RE.test(t)) {
    return { kind: 'submit', confidence: 'medium', autoSubmit: true };
  }
  return { kind: 'ignore', confidence: 'none', autoSubmit: false };
}

export function progressionButtonVisible(labels = []) {
  return (labels || []).some((text) => {
    const c = classifyActionLabel(text);
    return c.kind === 'progress' || c.kind === 'review-nav';
  });
}

/** Next / Continue only. A "Review application" label does not count. */
export function forwardProgressVisible(labels = []) {
  return (labels || []).some((text) => classifyActionLabel(text).kind === 'progress');
}

export function wizardControlsKnown(labels = []) {
  return (labels || []).some((text) => {
    const c = classifyActionLabel(text);
    return c.kind === 'progress' || c.kind === 'review-nav' || c.kind === 'submit' || c.kind === 'ambiguous';
  });
}

/** High-confidence send label, or a medium one that is not ambiguous. */
export function submitChoice(labels = []) {
  let ambiguous = false;
  let ambiguousText = '';
  let text = '';
  let confidence = 'none';
  for (const label of labels || []) {
    const c = classifyActionLabel(label);
    if (c.kind === 'ambiguous') {
      ambiguous = true;
      if (!ambiguousText) ambiguousText = label;
    }
    if (c.kind === 'submit' && c.autoSubmit && (c.confidence === 'high' || !text)) {
      if (!text || c.confidence === 'high') {
        text = label;
        confidence = c.confidence;
      }
    }
  }
  // A clear Submit wins. Ambiguity blocks only when that clear label is absent.
  if (confidence === 'high') {
    return { allow: true, ambiguous: false, ambiguousText, text, confidence };
  }
  return { allow: !!text && !ambiguous, ambiguous, ambiguousText, text, confidence };
}

/**
 * A step with no empty required field may advance even when nothing was
 * typed on this page (intro, consent, legal, prefilled declaration, Continue only).
 */
export function canAdvanceWizardStep({
  hardBlock = false,
  isReview = false,
  requiredEmpty = false,
  nextVisible = false,
  nextVisibilityKnown = false,
  previousClickNoEffect = false,
} = {}) {
  if (hardBlock || isReview || requiredEmpty || previousClickNoEffect) return false;
  if (nextVisibilityKnown && !nextVisible) return false;
  return true;
}

export function isRequiredEmptyReason(reason = '') {
  return /requis et vide|choix requis|fichier requis|CV manquant/i.test(String(reason));
}

/**
 * A Next click that did not change the step must not become a send.
 * Submit only when a real Submit control is the way forward, or the page
 * is a high-confidence review screen, and no required field is still empty.
 * If Next is still the visible progression control, this was a navigation failure.
 */
export function shouldAttemptSubmitAfterNoopNext({
  submitButtonVisible = false,
  reviewConfidence = 'none',
  requiredEmpty = false,
  hardBlock = false,
  progressStillVisible = false,
} = {}) {
  if (hardBlock || requiredEmpty) return false;
  if (progressStillVisible && reviewConfidence !== 'high') return false;
  if (reviewConfidence === 'high') return true;
  if (submitButtonVisible) return true;
  return false;
}

/**
 * True when the review heuristic missed, but the page is still worth one AI
 * look: a heading that sounds like a summary, or a nearly empty step whose
 * first lines do. Body text alone is not enough — privacy blurbs say "confirm".
 */
export function reviewStepNeedsAi({
  heading = '',
  bodySnippet = '',
  fieldCount = 0,
  editableCount = 0,
} = {}) {
  if (pageLooksLikeReviewStep({ heading, bodySnippet, fieldCount, editableCount })) return false;
  const head = String(heading).toLowerCase().replace(/\s+/g, ' ');
  const loose = /\b(review|verify|verification|confirm|summary|r[ée]capitul|almost done|check your|aper[cç]u|final step|last step|avant d'envoyer|derni[eè]re [ée]tape)\b/;
  if (loose.test(head) && editableCount <= 4) return true;
  const lead = `${head} ${String(bodySnippet).slice(0, 280).toLowerCase()}`;
  if (editableCount <= 1 && fieldCount <= 3 && loose.test(lead)) return true;
  return false;
}

/** Count fields that still look like data-entry (not consent-only review). */
export function countEditableApplyFields(fields = []) {
  return (fields || []).filter((f) => {
    const type = String(f.type || '').toLowerCase();
    if (type === 'hidden' || type === 'file') return false;
    if (type === 'checkbox' || type === 'radio') return false;
    return true;
  }).length;
}
