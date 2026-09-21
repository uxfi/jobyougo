import { normalizeUrl } from '../url-key.mjs';

function looksLikeDate(value = '') {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
}

function normalizeUrlKey(rawUrl = '') {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return '';
  return normalizeUrl(trimmed) || trimmed;
}

const URLS_TO_ADD_RE = /(?:##\s*)?URLs_À_AJOUTER[^\n]*\n(?:```+[^\n]*\n)?([\s\S]*?)(?:```+\n)?(?:\n##|\n---\s*$|$)/i;
const NONE_LINE_RE = /^(?:AUCUNE|NONE|NIL)\s*$/i;

export function extractScanSelectionSection(fullResponse = '') {
  const text = String(fullResponse || '');
  const sectionMatch = text.match(URLS_TO_ADD_RE);
  return sectionMatch ? sectionMatch[1].trim() : '';
}

export function isScanSelectionComplete(fullResponse = '') {
  const text = String(fullResponse || '');
  if (URLS_TO_ADD_RE.test(text)) return true;
  return /https?:\/\//i.test(text);
}

export function scanResponseDeclaresNone(fullResponse = '') {
  const section = extractScanSelectionSection(fullResponse);
  const body = section || String(fullResponse || '').trim();
  if (!body) return false;
  const firstLine = body.split('\n').map(line => line.trim()).find(Boolean) || '';
  if (NONE_LINE_RE.test(firstLine)) return true;
  return NONE_LINE_RE.test(body) && !/https?:\/\//i.test(body);
}

export function extractScanEntriesFromResponse(fullResponse = '', scanUrlPublishedAt = new Map()) {
  const section = extractScanSelectionSection(fullResponse);
  const rawLines = section
    ? section.split('\n')
    : String(fullResponse || '').split('\n').filter(line => /https?:\/\//i.test(line));

  const seen = new Set();
  const results = [];

  rawLines.forEach(rawLine => {
    const line = String(rawLine || '').replace(/^[-*]\s*/, '').trim();
    if (!line || NONE_LINE_RE.test(line)) return;

    const markdownUrl = line.match(/\((https?:\/\/[^)\s]+)\)/i)?.[1] || '';
    const bareUrl = line.match(/https?:\/\/[^\s|)]+/i)?.[0] || '';
    const url = markdownUrl || bareUrl;
    if (!url || seen.has(url)) return;
    seen.add(url);

    const normalizedLine = line
      .replace(/\[[^\]]+\]\((https?:\/\/[^)\s]+)\)/gi, '$1')
      .replace(/\s+[—–]\s+/g, ' | ');
    const pieces = normalizedLine.split('|').map(part => part.trim()).filter(Boolean);
    const rest = pieces.filter(part => part !== url);
    let note = rest.join(' | ');

    const lastPart = rest[rest.length - 1] || '';
    const hasDateAlready = looksLikeDate(lastPart);
    if (!hasDateAlready && scanUrlPublishedAt?.size) {
      const key = normalizeUrlKey(url);
      const publishedAt = scanUrlPublishedAt.get(url) || scanUrlPublishedAt.get(key) || '';
      if (publishedAt) {
        note = note ? `${note} | ${publishedAt}` : publishedAt;
      }
    }

    results.push({ url, note });
  });

  return results;
}

export function buildScanLlmPrefetch({ recapLines = [], rosterText = '' } = {}) {
  const recap = (recapLines || []).map(line => String(line || '').trim()).filter(Boolean).join('\n');
  const roster = String(rosterText || '').trim();
  const parts = [];
  if (recap) {
    parts.push(
      '## Fetch recap (already crawled by the server — not a job list; do not invent URLs from it)',
      recap,
    );
  }
  parts.push(roster || '## Candidate Roster\nTotal prefetched candidates after title + remote filter: 0');
  return parts.join('\n\n');
}
