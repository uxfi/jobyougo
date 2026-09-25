/**
 * Decide whether a Chrome tab is the application we just opened.
 * Being the active tab is not evidence: ads, Google, another posting, or a
 * login page can sit in front when the opener closes (Wellfound and others).
 */

import { identifyAts, isAggregatorAts } from './apply-ats.mjs';

const NOISE_HOST = /(^|\.)((google|bing|duckduckgo|facebook|instagram|youtube|doubleclick|googlesyndication|googleadservices)\.[a-z.]+|taboola\.com|outbrain\.com|adnxs\.com)$/i;
const LOGIN_PATH = /\/(login|signin|sign-in|log-in|sso|oauth)(\/|$|\?)/i;
const LOGIN_HOST = /^(accounts\.google\.|login\.microsoftonline\.|login\.live\.)/i;

const STOP_TOKENS = new Set([
  'apply', 'application', 'applications', 'jobs', 'job', 'careers', 'career',
  'en', 'fr', 'us', 'uk', 'new', 'view', 'companies', 'company',
]);

export function extractJobTokens(url) {
  let u;
  try { u = new URL(String(url || '')); } catch { return []; }
  const found = [];
  const add = (value) => {
    const s = String(value || '').trim().toLowerCase();
    if (s.length < 4 || STOP_TOKENS.has(s)) return;
    found.push(s);
  };
  for (const m of u.pathname.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi)) add(m[0]);
  for (const m of u.pathname.matchAll(/\/jobs\/(\d{4,})/gi)) add(m[1]);
  const gh = u.searchParams.get('gh_jid') || u.searchParams.get('job');
  if (gh) add(gh);
  const wd = u.pathname.match(/_([RJ]\d{4,})\b/i);
  if (wd) add(wd[1]);
  for (const seg of u.pathname.split('/')) {
    if (/^\d{6,}$/.test(seg)) add(seg);
  }
  return [...new Set(found)];
}

function titleHits(title, role) {
  const words = String(role || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
  if (words.length < 2) return false;
  const hay = String(title || '').toLowerCase();
  const hits = words.filter((w) => hay.includes(w)).length;
  return hits >= Math.min(2, words.length);
}

function companyHits(title, company) {
  const name = String(company || '').trim().toLowerCase();
  if (name.length < 3) return false;
  return String(title || '').toLowerCase().includes(name);
}

/**
 * @returns {{ score: number, hardReject: string|null, reasons: string[] }}
 */
export function scoreAdoptCandidate(candidate, ctx = {}) {
  const reasons = [];
  const raw = String(candidate?.url || '');
  if (!raw) return { score: 0, hardReject: null, reasons: ['url-vide'] };
  let u;
  try { u = new URL(raw); } catch {
    return { score: -100, hardReject: 'url-invalide', reasons: ['url-invalide'] };
  }
  if (!/^https?:$/i.test(u.protocol)) {
    return { score: -100, hardReject: 'pas-http', reasons: ['pas-http'] };
  }
  if (NOISE_HOST.test(u.hostname) || /(^|\.)google\./i.test(u.hostname)) {
    return { score: -100, hardReject: 'page-bruit', reasons: ['page-google-ou-pub'] };
  }

  const expect = (() => { try { return new URL(ctx.expectedHref); } catch { return null; } })();
  const origin = (() => { try { return new URL(ctx.originUrl); } catch { return null; } })();
  const loginExpected = !!(expect && (LOGIN_PATH.test(expect.pathname) || LOGIN_HOST.test(expect.hostname)));
  if (!loginExpected && (LOGIN_PATH.test(u.pathname) || LOGIN_HOST.test(u.hostname))) {
    return { score: -100, hardReject: 'login', reasons: ['page-login'] };
  }

  const originTokens = new Set([
    ...extractJobTokens(ctx.originUrl),
    ...extractJobTokens(ctx.expectedHref),
    ...(ctx.jobId ? [String(ctx.jobId).toLowerCase()] : []),
  ]);
  const candTokens = extractJobTokens(raw);
  const tokenHit = candTokens.some((t) => originTokens.has(t));
  const sameHostAsOrigin = !!(origin && u.hostname === origin.hostname);
  const sameHostAsExpect = !!(expect && u.hostname === expect.hostname);
  if ((sameHostAsOrigin || sameHostAsExpect) && originTokens.size && candTokens.length && !tokenHit) {
    return { score: -100, hardReject: 'autre-offre', reasons: ['identifiant-different'] };
  }

  let score = 0;
  if (tokenHit) { score += 60; reasons.push('identifiant'); }
  if (sameHostAsExpect) {
    score += 40;
    reasons.push('domaine-attendu');
    if (expect && u.pathname.replace(/\/$/, '') === expect.pathname.replace(/\/$/, '')) {
      score += 20;
      reasons.push('chemin');
    }
  } else if (sameHostAsOrigin) {
    score += 25;
    reasons.push('meme-domaine');
  }

  const ats = identifyAts(raw);
  if (ats) {
    score += 20;
    reasons.push(`ats:${ats.id}`);
    const originIsAgg = isAggregatorAts(ctx.originUrl);
    if (originIsAgg && isAggregatorAts(raw) && ats.id !== identifyAts(ctx.originUrl)?.id) {
      score -= 25;
      reasons.push('autre-agrégateur');
    }
  }
  if (candidate.hasForm) { score += 30; reasons.push('formulaire'); }
  if (titleHits(candidate.title, ctx.role)) { score += 15; reasons.push('titre'); }
  if (companyHits(candidate.title, ctx.company)) { score += 10; reasons.push('entreprise'); }
  if (candidate.active) { score += 2; reasons.push('actif'); }

  return { score, hardReject: null, reasons };
}

/**
 * Active-tab fallback must clear the score bar.
 * A tab the click actually opened (openerTabId / window.open href) is kept
 * unless it is a hard reject (Google, login, another posting on the same host).
 */
export function acceptAdoptCandidate(candidate, ctx = {}, { trustedChild = false } = {}) {
  const scored = scoreAdoptCandidate(candidate, ctx);
  if (scored.hardReject) return { ok: false, ...scored };
  if (trustedChild) return { ok: true, via: 'enfant', ...scored };
  if (!candidate?.url) return { ok: false, ...scored, hardReject: 'url-vide' };
  if (scored.score >= 40) return { ok: true, via: 'score', ...scored };
  return { ok: false, ...scored };
}
