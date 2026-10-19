// Whether a fetched job description is enough to evaluate. A thin page
// (a listing shell, a cookie wall, a short teaser in another language) gives
// the model nothing about the offer, and it then scores the candidate's own
// CV instead: the Eyzee posting (justjoin.it, 2026-10-19) came back evaluated
// against OneAsset, the candidate's current employer, at 4.9/5.
// Such a JD is parked for review instead of being sent to the model.

const STOP = new Set(['the', 'and', 'for', 'with', 'des', 'les', 'une', 'sa', 's.a', 'sp', 'z', 'o.o', 'inc', 'ltd', 'llc', 'gmbh', 'sas', 'sarl', 'spa', 'srl', 'ag', 'bv', 'oy', 'ab']);

function tokens(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOP.has(t));
}

/**
 * @param {string} text fetched JD text
 * @param {{ company?: string, title?: string, minChars?: number, anchorChars?: number }} opts
 * @returns {{ ok: boolean, reason: string, chars: number, anchored: boolean }}
 */
export function jdSufficiency(text, { company = '', title = '', minChars = 1200, anchorChars = 4000 } = {}) {
  const body = String(text || '').replace(/\s+/g, ' ').trim();
  const lower = body.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const companyTokens = tokens(company);
  const titleTokens = tokens(title);
  const companyHit = companyTokens.length ? companyTokens.some((t) => lower.includes(t)) : null;
  const titleHit = titleTokens.length ? titleTokens.some((t) => lower.includes(t)) : null;
  const anchored = companyHit !== false || titleHit === true;
  const chars = body.length;
  if (chars < minChars) return { ok: false, reason: `job description too short (${chars} chars)`, chars, anchored };
  if (chars < anchorChars && companyHit === false && titleHit === false) {
    return { ok: false, reason: `job description (${chars} chars) never names the company or the role`, chars, anchored };
  }
  return { ok: true, reason: '', chars, anchored };
}

/** Header placed before the JD so the model knows which offer it scores. */
export function offerAnchor({ company = '', title = '', url = '' } = {}) {
  const who = [company, title].filter(Boolean).join(' - ');
  if (!who && !url) return '';
  return [
    '## Offer to evaluate',
    who ? `Offer: ${who}` : '',
    url ? `URL: ${url}` : '',
    "Evaluate this company and this role only. The employers listed in the candidate's CV (current or past) are not the offer.",
    '',
  ].filter((line, i, all) => line || i === all.length - 1).join('\n');
}