// Complementary AI for auto-apply navigation. Deterministic regexes run first.
// This module is only asked when they miss: pick one visible button, or decide
// the current page is a review / verification step. It cannot invent a control,
// and auth / back buttons are rejected even if the model names them.

import { chat, MODELS } from './openrouter.mjs';
import { extractJsonObject } from './apply-llm.mjs';
import { AUTH_AVOID_TEXT_RE } from './form-detect.mjs';

const ACTIONS = new Set(['click', 'review', 'fill', 'human']);

/** Back, edit, and cancel never advance an application. */
export const NAV_BACK_RE = /^(back|previous|pr[ée]c[ée]dent|retour|edit|modifier|cancel|annuler|close|fermer)\b/i;

export function filterNavButtons(buttons, skipTexts = []) {
  const skip = new Set((skipTexts || []).map((s) => String(s).trim().toLowerCase()));
  const out = [];
  for (const b of buttons || []) {
    const text = String(b?.text || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length > 80) continue;
    if (AUTH_AVOID_TEXT_RE.test(text) || NAV_BACK_RE.test(text)) continue;
    if (skip.has(text.toLowerCase())) continue;
    out.push({
      n: Number.isInteger(b?.n) ? b.n : out.length,
      text,
      href: String(b?.href || '').slice(0, 100),
    });
    if (out.length >= 12) break;
  }
  return out;
}

/**
 * @returns {{ action: 'click'|'review'|'fill'|'human', index?: number, text?: string, reason: string }}
 */
export function parseNavDecision(raw, buttons = []) {
  const parsed = extractJsonObject(raw);
  const action = String(parsed.action || '').toLowerCase();
  const reason = String(parsed.reason || '').slice(0, 180);
  if (!ACTIONS.has(action)) return { action: 'human', reason: reason || 'réponse IA invalide' };
  if (action !== 'click') return { action, reason };
  const index = Number(parsed.index);
  if (!Number.isInteger(index) || index < 0 || index >= buttons.length) {
    return { action: 'human', reason: 'index de bouton invalide' };
  }
  const text = String(buttons[index]?.text || '').replace(/\s+/g, ' ').trim();
  if (!text || AUTH_AVOID_TEXT_RE.test(text) || NAV_BACK_RE.test(text)) {
    return { action: 'human', reason: 'bouton refusé' };
  }
  return { action: 'click', index, text, reason };
}

export function navDecisionLog(decision) {
  if (!decision || decision.skipped) return '';
  if (decision.action === 'click') return `IA nav: clic ${decision.index} « ${decision.text} »`;
  if (decision.action === 'review') return 'IA nav: page de vérification';
  if (decision.action === 'fill') return 'IA nav: formulaire déjà affiché';
  return `IA nav: arrêt (${decision.reason || 'humain'})`;
}

export function exactControlPattern(text) {
  const esc = String(text || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${esc}$`, 'i');
}

/**
 * @param {object} args
 * @param {'navigate'|'review'|'stuck'} args.phase
 * @param {Array<{text: string}>} args.buttons buttons the model is allowed to pick
 * @param {Function} [args.chat] injected for tests; defaults to OpenRouter
 */
export async function resolveNavAction({
  phase = 'navigate',
  url = '',
  heading = '',
  bodySnippet = '',
  buttons = [],
  fieldsSummary = '',
  chat: chatFn,
} = {}) {
  const list = filterNavButtons(buttons);
  if (phase !== 'review' && !list.length) {
    return { action: 'human', reason: 'aucun bouton', skipped: true };
  }
  const lines = list.map((b, i) => `${i}=${JSON.stringify(b.text)}`).join('\n') || '(none)';
  const phaseRule = phase === 'review'
    ? 'Decide if this page is a review / verification / summary step BEFORE the final send. action "review" when it is. action "click" only for a forward or submit control in the list. action "fill" if this is still a data-entry form. action "human" if unsure.'
    : phase === 'stuck'
      ? 'A Next/Continue click did not change the step. action "review" if this is already the confirmation screen. action "click" for the real forward or submit control, never a control already tried. action "human" if unsure.'
      : 'No Apply/Next regex matched. action "click" for the control that opens the application or continues WITHOUT creating an account. action "fill" if the application form is already on screen. action "human" if the only path is login or you are unsure.';

  const prompt = `You help complete a job application by choosing the next UI action. Use ONLY the numbered buttons. Never invent a label.

URL: ${String(url).slice(0, 200)}
HEADING: ${String(heading).slice(0, 300)}
PAGE TEXT: ${String(bodySnippet).slice(0, 500)}
FIELDS: ${fieldsSummary || 'unknown'}

${phaseRule}

HARD RULES:
- Never choose Sign in, Sign up, Log in, Register, Create account, or Continue with Google/LinkedIn/Apple/Facebook.
- Never choose Back, Previous, Edit, Cancel, or Close.
- "click" must use the button NUMBER from the list, not its text.
- If unsure, action "human".

Return ONLY JSON: {"action":"click"|"review"|"fill"|"human","index":0,"reason":"short"}
"index" is required only for action "click".

BUTTONS:
${lines}`;

  try {
    const raw = await (chatFn || chat)({
      model: MODELS.QWEN,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: 180,
    });
    return parseNavDecision(raw, list);
  } catch {
    return { action: 'human', reason: 'ia indisponible' };
  }
}
