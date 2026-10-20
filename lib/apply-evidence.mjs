/**
 * Candidate evidence for screening questions: the public portfolio's own
 * English copy (ui/portfolio/data.js), read once per mtime. cv.md, profile.yml
 * and screening.custom_answers reach the resolver through the spec and the
 * career index; this adds the project write-ups (Shiseido eCommerce, OneAsset,
 * Creads.io…) the CV only names.
 */
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const cache = new Map();
const KEYS = 'en|tagline|desc|challenge|goals|solution|outcome|subtitle|body|title|company|role|tag|team';

/** Plain text of the portfolio's English strings (pure, for tests). */
export function portfolioTextFromSource(src, maxChars = 14000) {
  const out = [];
  const seen = new Set();
  const re = new RegExp(`\\b(?:${KEYS})\\s*:\\s*(?:'((?:[^'\\\\]|\\\\.){3,600})'|"((?:[^"\\\\]|\\\\.){3,600})")`, 'g');
  let m;
  while ((m = re.exec(String(src || '')))) {
    const s = (m[1] ?? m[2] ?? '').replace(/\\(['"\\])/g, '$1').replace(/\s+/g, ' ').trim();
    if (s.length < 3 || /^\.\.?\//.test(s) || /^#[0-9a-f]{3,8}$/i.test(s) || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out.join(' | ').slice(0, maxChars);
}

/** The owner's portfolio text, '' when there is none. */
export function portfolioEvidenceFor(spec = {}, root = process.cwd()) {
  // Another account's stored CV: Hugo's portfolio is not theirs.
  if (typeof spec?.cvMarkdown === 'string') return '';
  const path = join(root, 'ui', 'portfolio', 'data.js');
  try {
    const mtime = statSync(path).mtimeMs;
    const hit = cache.get(path);
    if (hit && hit.mtime === mtime) return hit.text;
    const text = portfolioTextFromSource(readFileSync(path, 'utf8'));
    cache.set(path, { mtime, text });
    return text;
  } catch {
    return '';
  }
}