/**
 * Two guards on the application email's target, kept apart from the email
 * writer (lib/application-email.mjs):
 * - the company hint is never one of the candidate's own companies (tracker
 *   row 1052 recorded "OneAsset", Hugo's employer, for a Vertech offer);
 * - with neither posting nor company page read, a sentence that describes
 *   the company ("Vertech Industrial Systems designs industrial automation
 *   solutions…") has no source: it is cut.
 */
import { indexCareer } from './prompt-budget.mjs';
import { ownCompanyNames, isOwnCompany } from './contact-finder.mjs';

export function safeCompanyHint(companyHint, cv = '') {
  const hint = String(companyHint || '').trim();
  if (!hint) return '';
  return isOwnCompany(hint, ownCompanyNames(indexCareer(String(cv || '')))) ? '' : hint;
}

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const DESCRIBES = '(?:is|are|was|designs|builds|develops|provides|makes|creates|helps|offers|delivers|specializes|specialises|operates|focuses|manufactures|produces|supplies|est|conçoit|développe|propose|accompagne|aide|fabrique|produit)';

export function stripUnsourcedCompanyBlurb(body, { company = '', sourceText = '' } = {}) {
  if (String(sourceText || '').trim()) return { body: String(body || ''), removed: [] };
  // The company's name, or any capitalised name (the model may take it from the role line).
  const name = String(company || '').trim();
  const subject = name ? `(?:${escapeRe(name)}|\\p{Lu}[\\p{L}\\d&.'-]*(?:\\s+\\p{Lu}[\\p{L}\\d&.'-]*){0,5})` : `\\p{Lu}[\\p{L}\\d&.'-]*(?:\\s+\\p{Lu}[\\p{L}\\d&.'-]*){0,5}`;
  const re = new RegExp(`(^|[\\n.!?]\\s*)(?!(?:I|We|It|This|That|My|Our|They|He|She|Il|Elle|Ce|Cela|Mon|Notre|Nous|Je|J)\\b)(${subject}(?:'s)?\\s+${DESCRIBES}\\b[^.!?\\n]*[.!?])\\s*`, 'u');
  const removed = [];
  let text = String(body || '');
  for (let guard = 0; guard < 3; guard += 1) {
    const m = text.match(re);
    if (!m) break;
    removed.push(m[2].trim());
    text = text.slice(0, m.index) + m[1] + text.slice(m.index + m[0].length);
  }
  return { body: text.replace(/\n{3,}/g, '\n\n').replace(/^\s+/, ''), removed };
}