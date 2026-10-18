/**
 * apply-submit.mjs — find the send button of a filled application form, and
 * read what the page says around the send: captcha, e-mail code, closed
 * offer, confirmation.
 *
 * The send used to be a label regex over the first 40 buttons of the page:
 * a form whose button read "Apply now" or "Je postule" never auto-sent, and a
 * tag chip ("Industrial Design") or a chat widget ("Send reply") inside the
 * form could be clicked as the send. Here the page lists every control with
 * where it sits (the form just filled, after its fields, a header, a cookie
 * banner…), and the choice is a score over label AND place. Only an unclear
 * case goes to the model, which picks among the listed controls.
 *
 * In-page functions (SUBMIT_CANDIDATES, APPLY_PAGE_SIGNALS) are serialized
 * alone by chrome.scripting: no closure over this module. They are copied to
 * extension/page-helpers.mjs by `npm run sync:extension`.
 */

import { chat, MODELS } from './openrouter.mjs';
import { extractJsonObject } from './apply-llm.mjs';
import { classifyActionLabel } from './apply-progression.mjs';
import { AUTH_AVOID_TEXT_RE } from './form-detect.mjs';
import { CHALLENGE_TEXT_MARKERS, WEAK_TEXT_MARKERS, INTERSTITIAL_MAX_TEXT_LENGTH } from './challenge-detect.mjs';
import { classifyLiveness } from '../liveness-core.mjs';

// ─── In-page: controls ──────────────────────────────────────────────────────

/**
 * Runs in each frame. Stamps every visible control with `data-co-sc` and
 * returns it with its place on the page. `data-co-i` marks the fields the
 * last collect saw, so "the form just filled" is known without guessing.
 */
export function SUBMIT_CANDIDATES() {
  const deep = (root, sel) => {
    const out = [];
    const walk = (n) => {
      if (!n || !n.querySelectorAll) return;
      try { out.push(...n.querySelectorAll(sel)); } catch { /* invalid in this root */ }
      for (const el of n.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot);
    };
    walk(root);
    return out;
  };
  deep(document, '[data-co-sc]').forEach((el) => el.removeAttribute('data-co-sc'));
  const shown = (el) => {
    if (!el || (el.closest && el.closest('[hidden], [aria-hidden="true"]'))) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 6 || r.height < 6) return false;
    const st = getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity || 1) > 0.05;
  };
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const fields = deep(document, '[data-co-i]').filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 || r.height > 0 || el.type === 'file';
  });
  const fieldForms = new Set(fields.map((f) => f.form || (f.closest && f.closest('form'))).filter(Boolean));
  const dialogSel = '[role="dialog"], dialog, [aria-modal="true"]';
  const fieldDialog = fields.map((f) => f.closest && f.closest(dialogSel)).find(Boolean) || null;
  const lastField = fields[fields.length - 1] || null;
  let lastBottom = 0;
  for (const f of fields) {
    const r = f.getBoundingClientRect();
    if (r.height > 0) lastBottom = Math.max(lastBottom, r.bottom + window.scrollY);
  }
  const bannerSel = '[id*="cookie" i], [class*="cookie" i], [id*="consent" i], [class*="consent" i], [id*="gdpr" i], [class*="gdpr" i], [id*="onetrust" i], [class*="onetrust" i], [id*="cybot" i], [class*="cc-window" i], [id*="didomi" i], [class*="didomi" i], [id*="axeptio" i], [class*="axeptio" i]';
  const chromeSel = 'header, nav, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"]';
  const out = [];
  let n = 0;
  for (const el of deep(document, 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"], a')) {
    if (n >= 80) break;
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') {
      // A link that goes somewhere is navigation; a script link can be a send.
      const href = (el.getAttribute('href') || '').trim();
      if (href && !/^(#|javascript:)/i.test(href)) continue;
    }
    if (!shown(el)) continue;
    const text = clean(el.innerText || el.value || '');
    const aria = clean(el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('alt') || '');
    if ((text || aria).length > 90) continue;
    const form = el.form || (el.closest && el.closest('form')) || null;
    const btnType = tag === 'button' ? String(el.type || 'submit').toLowerCase()
      : tag === 'input' ? String(el.type || '').toLowerCase()
        : tag === 'a' ? 'link' : 'role';
    const submitType = !!form && (btnType === 'submit' || btnType === 'image');
    const inFieldForm = !!form && fieldForms.has(form);
    const banner = el.closest && el.closest(bannerSel);
    const inBanner = !!banner && ![...fieldForms].some((f) => banner.contains(f));
    const chromeBox = el.closest && el.closest(chromeSel);
    const inChrome = !!chromeBox && !inFieldForm && !fields.some((f) => chromeBox.contains(f));
    const disabled = !!(el.disabled || el.getAttribute('aria-disabled') === 'true'
      || (el.closest && el.closest('fieldset[disabled], [aria-disabled="true"], [inert]')));
    const afterFields = !!lastField && lastField !== el
      && !!(lastField.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
    const r = el.getBoundingClientRect();
    const dialog = el.closest && el.closest(dialogSel);
    el.setAttribute('data-co-sc', String(n));
    out.push({
      n,
      text: text.slice(0, 80),
      aria: aria.slice(0, 80),
      tag,
      type: btnType,
      submitType,
      disabled,
      inForm: !!form,
      inFieldForm,
      afterFields,
      dy: lastField ? Math.round(r.top + window.scrollY - lastBottom) : null,
      inChrome,
      inBanner,
      inDialog: !!dialog,
      outsideFieldDialog: !!fieldDialog && !fieldDialog.contains(el),
      hint: clean(`${el.id || ''} ${typeof el.className === 'string' ? el.className : ''} ${el.getAttribute('data-testid') || ''} ${el.getAttribute('name') || ''}`).slice(0, 140),
    });
    n++;
  }
  return { candidates: out, fieldCount: fields.length, hasFieldForm: fieldForms.size > 0 };
}

/**
 * Runs in each frame: the raw facts the page state is read from. The reading
 * itself (classifyApplyPage) stays in node, where it is tested.
 */
export function APPLY_PAGE_SIGNALS() {
  const shown = (el) => {
    if (!el || (el.closest && el.closest('[hidden], [aria-hidden="true"], [inert]'))) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return false;
    const st = getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none' && st.opacity !== '0';
  };
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  // Active challenges only: the floating reCAPTCHA badge is not one.
  const widgets = [
    ['recaptcha', 'iframe[src*="recaptcha"], .g-recaptcha'],
    ['hcaptcha', 'iframe[src*="hcaptcha"], [class*="h-captcha"]'],
    ['turnstile', 'iframe[src*="turnstile"], [class*="cf-turnstile"]'],
    ['datadome', 'iframe[src*="datadome"], [id*="datadome"]'],
    ['perimeterx', 'iframe[src*="perimeterx"], #px-captcha, [class*="px-captcha"]'],
    ['arkose', 'iframe[src*="arkoselabs"], #FunCaptcha, [class*="funcaptcha"]'],
    ['awswaf', 'iframe[src*="captcha.awswaf"], [id*="awswaf-captcha"]'],
    ['friendlycaptcha', 'iframe[src*="friendlycaptcha"], .frc-captcha'],
    ['geetest', '.geetest_holder, iframe[src*="geetest"]'],
  ];
  let captcha = '';
  for (const [kind, sel] of widgets) {
    const hit = [...document.querySelectorAll(sel)].some((el) => !el.closest('.grecaptcha-badge') && shown(el));
    if (hit) { captcha = kind; break; }
  }
  // A checkbox widget stays on screen once solved; only its token changes.
  const solved = [...document.querySelectorAll('textarea[name="g-recaptcha-response"], input[name="h-captcha-response"], textarea[name="h-captcha-response"], input[name="cf-turnstile-response"], input[name="frc-captcha-solution"]')]
    .some((el) => String(el.value || '').trim().length > 10);
  // The image challenge invisible reCAPTCHA opens after a send click.
  const challengeOpen = [...document.querySelectorAll('iframe[src*="recaptcha/api2/bframe"], iframe[src*="recaptcha/enterprise/bframe"], iframe[src*="hcaptcha.com"][src*="frame=challenge"], iframe[title*="challenge" i]')]
    .some(shown);
  const inputs = [...document.querySelectorAll('input, textarea, select')].filter((el) => {
    const t = String(el.type || '').toLowerCase();
    return !['hidden', 'submit', 'button', 'image', 'reset'].includes(t) && shown(el);
  });
  const codeRe = /otp|one.?time|verification.?code|verify.?code|security.?code|confirmation.?code|access.?code|passcode|\bpin\b|2fa|mfa|code de (v[ée]rification|confirmation|s[ée]curit[ée])|best[äa]tigungscode|verifizierungscode|c[óo]digo/i;
  const describe = (el) => `${el.name || ''} ${el.id || ''} ${el.getAttribute('autocomplete') || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('placeholder') || ''}`;
  const codeInputs = inputs.filter((el) => el.getAttribute('autocomplete') === 'one-time-code' || codeRe.test(describe(el)));
  // Split code boxes: four to eight one-character inputs side by side.
  const single = inputs.filter((el) => Number(el.maxLength) === 1 && /^(text|tel|number|password)$/i.test(el.type || 'text'));
  const otpBoxes = single.length >= 4 && single.length <= 8;
  const passwords = inputs.filter((el) => String(el.type || '').toLowerCase() === 'password').length;
  // What a signed-in platform already filled, read-only or disabled boxes
  // included (the collect skips those): the account's e-mail is often one.
  const prefilled = [...document.querySelectorAll('input, textarea')]
    .filter((el) => !['hidden', 'password', 'file', 'checkbox', 'radio', 'submit', 'button'].includes(String(el.type || '').toLowerCase()))
    .map((el) => String(el.value || '').trim())
    .filter((v) => v && v.length < 120);
  const emailValues = prefilled.filter((v) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v)).slice(0, 3);
  const main = document.querySelector('main, [role="main"], article') || document.body;
  const text = clean(main ? main.innerText : '').slice(0, 6000);
  const bodyText = clean(document.body ? document.body.innerText : '');
  const headings = [...document.querySelectorAll('h1, h2, [role="heading"], [role="alert"], [aria-live="assertive"], [aria-live="polite"]')]
    .filter(shown)
    .map((el) => clean(el.innerText))
    .filter((t) => t && t.length < 200)
    .slice(0, 8);
  return {
    url: location.href,
    title: clean(document.title).slice(0, 160),
    headings,
    text,
    bodyLength: bodyText.length,
    shortBody: bodyText.length < 1500 ? bodyText.slice(0, 1500) : '',
    captcha: captcha && !solved ? captcha : '',
    captchaSolved: !!captcha && solved,
    challengeOpen,
    codeInputs: codeInputs.length,
    otpBoxes,
    passwords,
    emailValues,
    fieldCount: inputs.length,
    filledMarks: document.querySelectorAll('[data-co-i]').length,
  };
}

// ─── Labels ─────────────────────────────────────────────────────────────────

const fold = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '')
  .replace(/[’‘`´]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();

// A control that sends, in the languages of the boards this runs on.
const SEND_LABEL_RE = new RegExp([
  '^(submit|send|envoyer|soumettre|valider|finish|finaliser|finalize|finalise|terminer|complete)\\b',
  '\\b(submit|send|complete|finish|finali[sz]e)\\s+(my\\s+|your\\s+|the\\s+)?(job\\s+)?application\\b',
  '^apply(\\s+(now|today|here))?\\s*[!→>]*$',
  '^apply (for|to) (this|the) (job|position|role|offer)$',
  '^(click to |i want to )?apply$',
  '\\bconfirm (and|&) (submit|send|apply)\\b',
  '\\b(review|verify) (and|&) submit\\b',
  '^(je )?postule(r)?( maintenant| a cette offre| a l\'offre)?\\s*[!→>]*$',
  '^(je )?candidat(er|e)( maintenant)?$',
  '\\b(envoyer|soumettre|valider|transmettre|deposer|confirmer|finaliser) (ma |la |votre |mon )?(candidature|dossier)\\b',
  '\\bbewerbung (absenden|senden|abschicken|einreichen|abschliessen)\\b',
  '^(jetzt )?bewerben$',
  '^(absenden|abschicken|senden|einreichen)$',
  '^(enviar|aplicar|postular|postularme|inscribirme|inscribirse)( (mi |la |su )?(candidatura|solicitud|postulacion))?( ahora)?$',
  '^(invia|candidati|candidarsi)( (la )?candidatura)?( ora)?$',
  '^(verzenden|versturen|solliciteer|solliciteren)( nu)?$',
  '^(wyslij|aplikuj|odeslat|skicka|ansok|sende|laheta)\\b',
  '^(candidatar|candidatar-me|enviar candidatura|submeter)$',
].join('|'), 'i');

// Never a send, whatever the place: cookie, auth, navigation, file and chat controls.
const NEVER_SEND_RE = /cookie|consent|privacy (settings|preferences)|pr[ée]f[ée]rences?|preferences|settings|param[èe]tres|\bmanage\b|g[ée]rer|search|rechercher|filtr|log ?in|sign ?(in|up)|connexion|se connecter|register|inscription|create (an )?account|\bmenu\b|^close|fermer|^cancel|annuler|^back\b|retour|previous|pr[ée]c[ée]dent|^edit\b|modifier|^clear|reset|^skip|dismiss|share|partager|print|imprimer|download|t[ée]l[ée]charger|subscribe|newsletter|abonner|message|\bchat\b|\breply\b|r[ée]pondre|connect\b|follow|suivre|^save\b|enregistrer|bookmark|favori|like|upload|attach|joindre|t[ée]l[ée]verser|^add\b|ajouter|remove|supprimer|delete|browse|parcourir|choose (a )?file|select (a )?file|autofill|import|show more|read more|see more|learn more|en savoir plus|voir plus|view (all|more|job|details)|similar|similaire|alerte|job alert|copy|report|signaler|translate|traduire|language|langue|^\+\d|play|pause|mute|next slide|carousel|^(yes|no|oui|non)$/i;

// The application as a noun, a verb that sends it (any person or tense), and
// what is done to an application without sending it.
const APP_NOUN_RE = /\b(candidature|application|bewerbung|solicitud|postulacion|candidatura|sollicitatie|aplikacj\w*|dossier)\b/;
const SEND_VERB_RE = /\b(envo[iy]\w*|soumet\w*|soumis|transmet\w*|valid\w*|depos\w*|confirm\w*|finalis\w*|termin\w*|submit\w*|send\w*|sent|sende\w*|absend\w*|abschick\w*|einreich\w*|ubermitt\w*|enviar|envi[ae]\w*|mand[ae]\w*|invi[ao]\w*|verzend\w*|verstu?ur\w*|wysl\w*|complet\w*|finish\w*|apply|postul\w*|candidat[ae]\w*|bewerb\w*)\b/;
const APP_NOT_SEND_RE = /\b(voir|view|see|edit|modifier|preview|apercu|consulter|suivre|track|status|statut|retirer|withdraw|delete|supprimer|save|enregistr\w*|draft|brouillon|download|telecharg\w*|upload|import\w*|attach\w*|joindre|ajouter|add|remove|my applications|mes candidatures|back|retour)\b/;

/**
 * What a control's label says it does: 'send' (sends the application),
 * 'apply' (an Apply wording that sends only from inside the form),
 * 'progress' (Next, Review…), 'never', 'blank' or 'other'.
 */
export function sendLabelKind(raw = '') {
  const t = fold(raw).replace(/[*✱]/g, '').trim();
  if (!t) return 'blank';
  if (AUTH_AVOID_TEXT_RE.test(t)) return 'never';
  const cls = classifyActionLabel(t);
  if (cls.kind === 'progress' || cls.kind === 'review-nav') return 'progress';
  // "Send reply", "Send message", "Save draft": refused before the send
  // vocabulary, unless the label names the application ("Save and submit").
  if (NEVER_SEND_RE.test(t) && !/\b(submit|application|candidature|bewerbung|solicitud|candidatura)\b/.test(t)) return 'never';
  // Any wording about the application itself, whatever the verb form:
  // "J’envoie ma candidature !" (Welcome to the Jungle), "Je soumets mon
  // dossier", "Bewerbung jetzt abschicken". Viewing, editing or saving it
  // is not a send.
  if (APP_NOUN_RE.test(t) && !APP_NOT_SEND_RE.test(t)) return SEND_VERB_RE.test(t) ? 'send' : 'apply';
  if (SEND_LABEL_RE.test(t)) {
    // "Apply" alone opens a form as often as it sends one: the place decides.
    return /^(click to |i want to )?apply(\s+(now|today|here))?\s*[!→>]*$|^(je )?postule(r)?\b|^(je )?candidat(er|e)\b|^(jetzt )?bewerben$|^aplicar$|^postular/.test(t) ? 'apply' : 'send';
  }
  if (cls.kind === 'submit') return 'send';
  if (NEVER_SEND_RE.test(t)) return 'never';
  if (cls.kind === 'ambiguous') return 'apply';
  return 'other';
}

// ─── Ranking ────────────────────────────────────────────────────────────────

const HINT_SUBMIT_RE = /submit|send|apply|postuler|envoyer|bewerb|enviar|primary|cta/i;

/** Score one listed control. Higher is a likelier send. */
export function scoreSubmitCandidate(c, ctx = {}) {
  const label = c.text || c.aria || '';
  const kind = sendLabelKind(label);
  let score = { send: 10, apply: 6, blank: 0, other: -2, progress: -12, never: -100 }[kind];
  const placed = c.inFieldForm || (c.afterFields && (c.dy == null || c.dy < 2500));
  if (kind === 'blank') score += c.submitType && c.inFieldForm ? 5 : -20;
  if (c.inFieldForm) score += 4;
  if (c.afterFields && (c.dy == null || (c.dy > -80 && c.dy < 2500))) score += 2;
  if (c.submitType) score += 2;
  if (HINT_SUBMIT_RE.test(c.hint || '')) score += 1;
  if (c.inChrome) score -= 8;
  if (c.inBanner) score -= 100;
  if (c.outsideFieldDialog) score -= 8;
  if (ctx.hasFieldForm && c.inForm && !c.inFieldForm) score -= 6; // another form (newsletter, search)
  if (ctx.frameHasFields === false && ctx.anyFrameHasFields) score -= 6;
  return { score, kind, placed: !!placed };
}

/**
 * Pick the send control among every frame's candidates.
 * `frames`: [{ frameId, candidates, fieldCount, hasFieldForm }].
 * Returns { pick, confidence: 'high'|'medium'|'low'|'none', disabled, ranked }.
 *   high    a send label in or right after the form
 *   medium  an Apply label or a blank submit button in the form, or the
 *           only send label on a page without form context
 *   low     something else that could be it: the model decides
 * `disabled` is the send control when it is on screen but disabled (the form
 * still misses something) and no enabled one stands in for it.
 */
export function rankSubmitCandidates(frames = []) {
  const anyFrameHasFields = frames.some((f) => (f?.fieldCount || 0) > 0);
  const ranked = [];
  for (const fr of frames || []) {
    for (const c of fr?.candidates || []) {
      const s = scoreSubmitCandidate(c, {
        hasFieldForm: !!fr.hasFieldForm,
        frameHasFields: (fr.fieldCount || 0) > 0,
        anyFrameHasFields,
      });
      ranked.push({ ...c, frameId: fr.frameId ?? 0, ...s });
    }
  }
  ranked.sort((a, b) => b.score - a.score || a.frameId - b.frameId || a.n - b.n);
  const usable = ranked.filter((c) => c.kind !== 'never' && c.kind !== 'progress' && !c.inBanner);
  const enabled = usable.filter((c) => !c.disabled);
  const sendish = (c) => c.kind === 'send' || c.kind === 'apply';
  const best = enabled[0] || null;
  const disabledSend = usable.find((c) => c.disabled && sendish(c) && c.placed && !c.inChrome) || null;

  let confidence = 'none';
  if (best) {
    const sendsOnPage = enabled.filter((c) => c.kind === 'send' && !c.inChrome);
    if (best.kind === 'send' && !best.inChrome && (best.placed || !anyFrameHasFields)) confidence = 'high';
    else if (best.kind === 'send' && !best.inChrome && sendsOnPage.length === 1) confidence = 'medium';
    else if (best.kind === 'apply' && best.placed && !best.inChrome) confidence = 'medium';
    else if (best.kind === 'blank' && best.submitType && best.inFieldForm) confidence = 'medium';
    else if (best.score > -5) confidence = 'low';
    // Two different send labels in the form, close in score: let the model read them.
    const rival = enabled.find((c) => c !== best && sendish(c) && c.placed && fold(c.text) !== fold(best.text));
    if (confidence === 'high' && rival && best.kind === rival.kind && best.score - rival.score < 2) confidence = 'medium';
  }
  // The real send is disabled and only weaker controls are enabled: the form
  // is not complete. A stand-in must not be clicked in its place.
  if (disabledSend && (!best || confidence !== 'high' || best.score < disabledSend.score)) {
    return { pick: null, confidence: 'none', disabled: disabledSend, ranked };
  }
  return { pick: confidence === 'none' ? null : best, confidence, disabled: null, ranked };
}

/** One line per control for the model, with its place. */
export function describeCandidate(c) {
  const where = [
    c.inFieldForm ? 'in the filled form' : c.inForm ? 'in another form' : '',
    c.afterFields ? 'after the fields' : 'before the fields',
    c.inChrome ? 'page header/footer' : '',
    c.inDialog ? 'in a dialog' : '',
    c.submitType ? 'submit button' : c.tag,
    c.disabled ? 'DISABLED' : '',
  ].filter(Boolean).join(', ');
  const label = c.text || (c.aria ? `[icon: ${c.aria}]` : '[no label]');
  return `${JSON.stringify(label)} (${where})`;
}

/**
 * The model picks the send control among `ranked` (rankSubmitCandidates),
 * or none. The pick is refused when it is a never-send label, a Next, a
 * banner or header control, or disabled.
 */
export async function askSubmitPick({ ranked = [], url = '', heading = '', bodySnippet = '', chat: chatFn } = {}) {
  const list = ranked.filter((c) => c.kind !== 'never' && !c.inBanner && !c.disabled).slice(0, 14);
  if (!list.length) return { pick: null, reason: 'aucun contrôle' };
  const lines = list.map((c, i) => `${i}=${describeCandidate(c)}`).join('\n');
  const prompt = `A job application form has just been filled in. Which control SENDS the application?

URL: ${String(url).slice(0, 200)}
HEADING: ${String(heading).slice(0, 300)}
PAGE TEXT: ${String(bodySnippet).slice(0, 600)}

Rules:
- Pick the control that submits THIS application: usually the main button at the end of the filled form ("Submit", "Send application", "Apply", "Postuler", "Envoyer"...).
- Never pick a filter, a tag, a chat or message button, a social or login button, an upload or "add another" button, a cookie button, or a link to another page.
- If it is a multi-step form and a forward step ("Next", "Continue") must come first, or no listed control sends, answer -1.

Controls:
${lines}

Return ONLY JSON: {"index": <number or -1>, "reason": "short"}`;
  let parsed = {};
  try {
    const raw = await (chatFn || chat)({
      model: MODELS.QWEN,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: 120,
    });
    parsed = extractJsonObject(raw) || {};
  } catch {
    return { pick: null, reason: 'ia indisponible' };
  }
  const index = Number(parsed.index);
  const reason = String(parsed.reason || '').slice(0, 160);
  if (!Number.isInteger(index) || index < 0 || index >= list.length) return { pick: null, reason: reason || 'aucun' };
  const pick = list[index];
  if (pick.kind === 'progress' || pick.inChrome || (!pick.inFieldForm && !pick.afterFields)) {
    return { pick: null, reason: `« ${pick.text || pick.aria} » refusé (hors formulaire ou étape)` };
  }
  return { pick, reason };
}

// ─── Page state ─────────────────────────────────────────────────────────────

const CONFIRMED_RE = /thank(s| you) for (applying|your (application|submission))|application (has been |was |is )?(successfully )?(submitted|received|sent|complete)|successfully (submitted|applied|sent)|(we('ve| have)|we) received your application|your application (has been|was) (sent|submitted|received)|you('ve| have) (successfully )?applied|application submitted|candidature (a bien ete |a ete |bien )?(envoyee|recue|transmise|enregistree|deposee)|merci (pour|de) (votre|ta) candidature|nous avons (bien )?recu votre candidature|votre candidature (a bien ete|a ete) (envoyee|transmise|enregistree)|gracias por (tu|su) (candidatura|solicitud|postulacion)|(solicitud|candidatura) enviada|vielen dank f(u|ue)r (ihre|deine) bewerbung|bewerbung (wurde )?(erfolgreich )?(versendet|gesendet|ubermittelt|eingegangen|abgeschickt)|grazie per (la tua|la sua) candidatura|candidatura (inviata|ricevuta)|bedankt voor (je|uw) sollicitatie|sollicitatie (is )?(verzonden|ontvangen)|obrigad[oa] pela (sua )?candidatura/;

// The page asks for a code sent by e-mail or SMS.
const CODE_ASKED_RE = /(enter|type|input|paste) (the |your )?(\d[- ]?digit )?(verification |confirmation |security |one[- ]time |access )?(code|pin)|we('ve| have)? (just )?sent (you )?(a|an|the)? ?(\d[- ]?digit )?(verification |confirmation |security |one[- ]time |login )?(code|pin)|(verification|confirmation|security|one[- ]time) code|code (sent|emailed|texted) to|(saisi(r|ssez)|entre[rz]|tape[rz]) (le|votre) code|code de (verification|confirmation|securite)|nous (vous )?avons envoye un code|best(a|ae)tigungscode|verifizierungscode|(geben sie|gib) (den|deinen) code|codigo de (verificacion|confirmacion)|introduce el codigo|codice di verifica/;

// The application waits for a click on a link sent by e-mail.
const EMAIL_LINK_RE = /(confirm|verify|validate) (your )?(e-?mail|email address)( address)? (to|in order to|before) (complete|finish|finali[sz]e|submit|send|activate)|click (on )?the (link|button) (we sent|in the e-?mail|sent to)[^.]{0,60}(confirm|verify|complete|finish)|check your (inbox|e-?mail)[^.]{0,80}(confirm|verify|complete|activate)|(confirmez|validez|verifiez) votre (adresse )?e-?mail (pour|afin de) (finaliser|valider|terminer|confirmer)|cliquez sur le lien[^.]{0,60}(confirmer|valider|finaliser)|bitte best(a|ae)tigen sie ihre e-?mail|(confirma|verifica) tu (correo|e-?mail) para/;

// Closed postings, beyond liveness-core's list (other languages, ATS copy).
const CLOSED_RE = [
  /\b(this|the) (job|position|role|posting|vacancy|opening|offer|listing)( you('re| are) looking for)? (is|has been) (no longer (available|active|open|accepting applications|listed)|closed|filled|expired|removed|archived|unpublished|taken down)\b/,
  // Phrased only: a bare "job expired" anywhere on the page stopped every
  // Himalayas run as closed (see BARE_EXPIRED_RE).
  /\b(job|position|posting|vacancy|listing) has (expired|been closed|been removed)\b/,
  /\bapplications? (for this (job|position|role) )?(are|is|have been) (now )?closed\b/,
  /\bsorry,? (this|the) (job|position|role|posting) (is )?(no longer|not) available\b/,
  /\bwe('re| are) no longer (hiring|recruiting) for this\b/,
  /\bthe (job|position|role) you('re| are) (looking for|trying to (apply|view)[a-z ]{0,10}) (is no longer|has been|could not be found|no longer exists|does not exist)/,
  /\b(job|position) (could not be|was not|cannot be) found\b/,
  /\bthis (job|position) (no longer exists|does not exist)\b/,
  /\bcette (offre|annonce|opportunite) (a ete|est) (pourvue|cloturee|fermee|archivee|expiree|supprimee|desactivee|retiree)\b/,
  /\b(les )?candidatures (sont |pour cette offre sont )?(closes|fermees|cloturees|terminees)\b/,
  /\bcette offre (a expire|n'existe plus)\b/,
  /\b(diese|die) (stelle|stellenanzeige|position|ausschreibung|anzeige) (ist )?(leider )?(nicht mehr|bereits) (verfugbar|aktiv|online|vakant|ausgeschrieben|besetzt)\b/,
  /\bbewerbungsfrist (ist )?(abgelaufen|beendet)\b/,
  /\b(esta |la )?(oferta|vacante|posicion) (ya )?no (esta|se encuentra) (disponible|activa)\b/,
  /\b(oferta|vacante) (cerrada|caducada|expirada|finalizada)\b/,
  /\b(questa |la )?(offerta|posizione|annuncio) non e piu (disponibile|attiva|aperta)\b/,
  /\b(deze )?vacature is (niet meer beschikbaar|gesloten|vervuld|verlopen)\b/,
  /\b(esta )?vaga (nao esta mais disponivel|foi encerrada|encerrada|expirou)\b/,
  /\b(oferta|ogloszenie) (wygasla|wygaslo|jest nieaktualn[ae]|nieaktualn[ae])\b/,
];
// A bare "Job expired" banner, read in the page's lead only: further down it
// is a "Similar jobs" badge, and as a question it is Himalayas' "Job
// expired?" report button, shown on every live posting.
const BARE_EXPIRED_RE = /\b(job|position|posting|vacancy|listing) expired\b(?! ?\?)/;
const NOT_FOUND_RE = /^(404\b|page not found|page introuvable|seite nicht gefunden|pagina no encontrada|pagina non trovata|not found)\b|\b(404 (error|not found)|error 404)\b/;

function firstHit(re, text) {
  const m = re.exec(text);
  return m ? m[0] : '';
}

/**
 * Read the page from APPLY_PAGE_SIGNALS rows (one per frame, main first).
 * `stage`: 'navigate' (looking for the form), 'form' (before the send) or
 * 'sent' (after a send click).
 * Returns { kind, evidence } where kind is one of
 *   captcha        a challenge widget waits for a human (or the image
 *                  challenge after a send click)
 *   challenge      a bot-check interstitial instead of the page
 *   email_code     a code sent by e-mail / SMS is asked
 *   email_link     the application waits for a link clicked in an e-mail
 *   confirmed      the application went through
 *   closed         the offer is closed / gone
 *   login          a sign-in with password
 *   none
 */
export function classifyApplyPage(frames = [], { stage = 'navigate', jobUrl = '' } = {}) {
  const rows = (frames || []).filter(Boolean);
  if (!rows.length) return { kind: 'none', evidence: '' };
  const main = rows.find((r) => (r.frameId ?? 0) === 0) || rows[0];
  const textOf = (r) => fold(`${(r.headings || []).join(' . ')} . ${r.text || ''}`);
  const allText = rows.map(textOf).join(' . ');
  const headText = fold(`${main.title || ''} . ${(main.headings || []).join(' . ')}`);
  const lead = fold(`${(main.headings || []).join(' . ')} . ${String(main.text || '').slice(0, 700)}`);
  const formOnScreen = rows.some((r) => (r.fieldCount || 0) >= 3 || (r.filledMarks || 0) >= 3);
  // Headings, alerts and the first lines of every frame: where a page says
  // what just happened. The rest of the text is the posting itself, whose
  // footer can say "thank you for applying" before anything was sent.
  const leadAll = rows.map((r) => fold(`${(r.headings || []).join(' . ')} . ${String(r.text || '').slice(0, 700)}`)).join(' . ');

  const widget = rows.find((r) => r.captcha);
  const challengeOpen = rows.some((r) => r.challengeOpen);
  if (challengeOpen) return { kind: 'captcha', evidence: 'image challenge' };
  if (widget) return { kind: 'captcha', evidence: widget.captcha };

  const strongWall = CHALLENGE_TEXT_MARKERS.find((m) => fold(main.shortBody || main.text || '').includes(m));
  const weakWall = (main.bodyLength || 0) < INTERSTITIAL_MAX_TEXT_LENGTH
    && WEAK_TEXT_MARKERS.find((m) => fold(main.shortBody || '').includes(m));
  if (!formOnScreen && (strongWall || weakWall)) return { kind: 'challenge', evidence: strongWall || weakWall };

  const codeBoxes = rows.some((r) => (r.codeInputs || 0) > 0 || r.otpBoxes);
  const codeAsked = firstHit(CODE_ASKED_RE, allText);
  // Inside a form, a code box alone is not enough ("Access code", "PIN"):
  // the page must also ask for a code that was sent.
  if (codeBoxes && (codeAsked || (stage !== 'form' && rows.every((r) => (r.fieldCount || 0) <= 4)))) {
    return { kind: 'email_code', evidence: codeAsked || 'champ code' };
  }
  const codeLead = firstHit(CODE_ASKED_RE, leadAll);
  if (codeLead && stage === 'sent') return { kind: 'email_code', evidence: codeLead };

  const link = firstHit(EMAIL_LINK_RE, formOnScreen ? leadAll : allText);
  if (link && stage !== 'form') return { kind: 'email_link', evidence: link };

  const done = firstHit(CONFIRMED_RE, leadAll) || (!formOnScreen && stage === 'sent' ? firstHit(CONFIRMED_RE, allText) : '');
  if (done && (stage === 'sent' || !formOnScreen)) return { kind: 'confirmed', evidence: done };

  // A closed offer: only where no form is being filled, or in the page's own
  // lead (a "no longer accepting applications" banner over the form).
  const closedIn = (text) => {
    const live = classifyLiveness({ status: 200, requestedUrl: jobUrl, finalUrl: main.url || '', bodyText: text, applyControls: [] });
    if (live.result === 'expired' && (live.code === 'expired_body' || live.code === 'expired_url')) {
      return live.code === 'expired_url' ? 'redirect error=true' : live.reason.replace(/^pattern matched: /, '');
    }
    for (const re of CLOSED_RE) {
      const hit = firstHit(re, text);
      if (hit) return hit;
    }
    return '';
  };
  // While still looking for the form (stage navigate) three filter or cookie boxes
  // are not a form: WTTJ's "This position is no longer available" banner sat
  // past the lead of such a page.
  const closed = (formOnScreen && stage !== 'navigate' ? closedIn(lead) : closedIn(allText)) || firstHit(BARE_EXPIRED_RE, lead);
  if (closed) return { kind: 'closed', evidence: closed };
  if (stage === 'navigate' && NOT_FOUND_RE.test(headText.replace(/^[\s.]+/, ''))) {
    return { kind: 'closed', evidence: 'page not found' };
  }

  if (rows.some((r) => (r.passwords || 0) > 0)
      && /sign in|log in|login|connexion|se connecter|anmelden|iniciar sesion|accedi|password|mot de passe/.test(allText)
      && !formOnScreen) {
    return { kind: 'login', evidence: 'mot de passe demandé' };
  }
  return { kind: 'none', evidence: '' };
}

/**
 * The candidate's identity is already on the page: an e-mail in a box the
 * platform filled (signed-in account), or the profile e-mail shown as text
 * ("Connecté en tant que …"). Counts as the identity a send needs.
 */
export function pageShowsIdentity(frames = [], email = '') {
  const mail = fold(email);
  return (frames || []).some((r) => (r?.emailValues || []).length
    || (mail && mail.includes('@') && fold(`${(r?.headings || []).join(' ')} ${r?.text || ''}`).includes(mail)));
}

/** French log line + English dashboard message for a page state. */
export function pageStateMessage(kind, evidence = '') {
  const ev = evidence ? ` (« ${String(evidence).slice(0, 80)} »)` : '';
  switch (kind) {
    case 'captcha': return {
      log: `Captcha à résoudre${ev} — en attente de toi dans l’onglet.`,
      message: '🧩 A captcha is waiting in the Chrome tab. Solve it: the run goes on by itself.',
      pending: { label: 'Captcha', reason: 'à résoudre dans l’onglet' },
    };
    case 'challenge': return {
      log: `Vérification anti-robot${ev} — en attente dans l’onglet.`,
      message: '🛡️ The site runs a bot check. Pass it in the Chrome tab: the run goes on by itself.',
      pending: { label: 'Vérification', reason: 'anti-robot à passer dans l’onglet' },
    };
    case 'email_code': return {
      log: `Code de vérification demandé${ev} — à saisir depuis ta boîte mail.`,
      message: '📧 The site sent a verification code (e-mail or SMS). Type it in the Chrome tab: the run goes on by itself.',
      pending: { label: 'Code de vérification', reason: 'code reçu par email à saisir dans l’onglet' },
    };
    case 'email_link': return {
      log: `Confirmation par email demandée${ev}.`,
      message: '📧 The application waits for a confirmation link sent by e-mail. Click it, then “I sent it”.',
      pending: { label: 'Email', reason: 'cliquer le lien de confirmation reçu par email' },
    };
    case 'closed': return {
      log: `Offre fermée${ev}.`,
      message: `🚫 This offer looks closed${ev}. If it is still open, click “Rescan the form”.`,
      pending: { label: 'Offre', reason: 'fermée ou expirée' },
    };
    case 'login': return {
      log: 'Connexion demandée (mot de passe).',
      message: 'This site wants a sign-in. Sign in, then “Rescan the form”.',
      pending: { label: 'auth', reason: 'sign-in required' },
    };
    default: return { log: '', message: '', pending: null };
  }
}

/** A state the human clears in the tab, after which the run can go on alone. */
export function waitsForHuman(kind) {
  return kind === 'captcha' || kind === 'challenge' || kind === 'email_code';
}
