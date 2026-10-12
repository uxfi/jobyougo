import { internOrJuniorReason } from './scan-decision.mjs';
import { normalizeUrl } from '../url-key.mjs';

export function pipelineUrlKey(raw = '') {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  return normalizeUrl(trimmed) || trimmed;
}

export function pipelineMarkdownLineUrl(line = '') {
  const trimmed = String(line || '').trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('<!--') || trimmed === '---' || trimmed === '>') return '';
  const clean = trimmed.replace(/^[-*+]\s*(?:\[[ xX!]\]\s*)?/, '').trim();
  const match = clean.match(/https?:\/\/[^\s|]+/i);
  return match ? match[0] : '';
}

// Drop pending lines whose posting key matches. A shorter listing URL must not
// take longer offer URLs with it just because one string contains the other.
export function removePipelineMarkdownUrls(raw = '', urls = []) {
  const removeKeys = new Set((urls || []).map(pipelineUrlKey).filter(Boolean));
  if (!removeKeys.size) return String(raw ?? '');
  return String(raw ?? '')
    .split('\n')
    .filter((line) => {
      const url = pipelineMarkdownLineUrl(line);
      if (!url) return true;
      const key = pipelineUrlKey(url);
      return !key || !removeKeys.has(key);
    })
    .join('\n');
}

function sanitizeField(value = '') {
  return String(value ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
}

function dateOnly(value = '') {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  if (/^\d{10,13}$/.test(raw)) {
    const millis = raw.length === 10 ? Number(raw) * 1000 : Number(raw);
    const parsed = new Date(millis);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  }
  return '';
}

export function parseJevNotePart(part = '') {
  const raw = String(part || '').replace(/^jev:\s*/i, '').trim();
  if (!raw) return { jev_keep: null, jev_status: '' };
  const scoreMatch = raw.match(/^(\d+(?:\.\d+)?)/);
  const keep = scoreMatch ? Number(scoreMatch[1]) : null;
  const jev_keep = Number.isFinite(keep) ? keep : null;
  if (/\b(unverified|missing_noul)\b/i.test(raw)) return { jev_keep, jev_status: 'unverified' };
  if (/\b(dropped|below_threshold)\b/i.test(raw)) return { jev_keep, jev_status: 'dropped' };
  if (/\b(kept|validated)\b/i.test(raw) || jev_keep != null) return { jev_keep, jev_status: 'kept' };
  return { jev_keep, jev_status: raw.toLowerCase() };
}

function isMetaNotePart(part = '') {
  return /^(posted|source|engine|jev|remote_verdict|location):\s*/i.test(part);
}

export function extractPipelineNoteParts(note = '') {
  const raw = String(note || '').trim();
  if (!raw) return { note: '', company: '', title: '', publishedAt: '', jev_keep: null, jev_status: '', remote_verdict: '', remote_reason: '', source: '' };

  const parts = raw.split('|').map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return { note: raw, company: '', title: '', publishedAt: '', jev_keep: null, jev_status: '', remote_verdict: '', remote_reason: '', source: '' };

  const postedPart = parts.find((part) => /^posted:\s*\d{4}-\d{2}-\d{2}/i.test(part));
  const jevPart = parts.find((part) => /^jev:/i.test(part));
  const sourcePart = parts.find((part) => /^source:\s*/i.test(part));
  const remotePart = parts.find((part) => /^remote_verdict:\s*/i.test(part));
  const lastPart = parts[parts.length - 1];
  const trailingDate = !postedPart && dateOnly(lastPart) === lastPart.slice(0, 10) && /^\d{4}-\d{2}-\d{2}$/.test(lastPart)
    ? lastPart
    : '';
  const publishedAt = postedPart
    ? postedPart.replace(/^posted:\s*/i, '').slice(0, 10)
    : trailingDate;
  const parsedJev = parseJevNotePart(jevPart || '');
  const remoteRaw = remotePart ? remotePart.replace(/^remote_verdict:\s*/i, '').trim() : '';
  const [remote_verdict = '', remote_reason = ''] = remoteRaw.split(/\s+—\s+|\s+-\s+/).map((part) => part.trim());

  const mainParts = parts.filter((part) => part !== postedPart && part !== trailingDate && !isMetaNotePart(part));
  const [company = '', title = '', ...rest] = mainParts;
  return {
    company,
    title,
    publishedAt,
    jev_keep: parsedJev.jev_keep,
    jev_status: parsedJev.jev_status,
    remote_verdict,
    remote_reason,
    source: sourcePart ? sourcePart.replace(/^source:\s*/i, '').trim() : '',
    note: rest.join(' | '),
  };
}

export function parsePipeline(content) {
  return String(content || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('<!--') && line !== '---' && line !== '>')
    .filter((line) => !/^[-*+]\s*\[[xX!]\]/.test(line))
    .map((line) => {
      const clean = line.replace(/^[-*+]\s*(\[[ xX]\]\s*)?/, '').trim();
      const urlMatch = clean.match(/https?:\/\/[^\s|]+/i);
      if (!urlMatch) return { url: '', note: '' };
      const url = urlMatch[0];
      const after = clean.slice(urlMatch.index + url.length).replace(/^[\s|—–-]+/, '').trim();
      const note = after.split('|').map((part) => part.trim()).filter(Boolean).join(' | ');
      return { url, note };
    })
    .filter((entry) => entry.url.startsWith('http'));
}

export function pipelineRecordFromEntry(entry = {}, scannedAt = new Date().toISOString()) {
  const parts = extractPipelineNoteParts(entry.note || '');
  const jevKeepRaw = entry.jevKeep ?? entry.jev_keep ?? parts.jev_keep;
  const jevFitRaw = entry.jevFit ?? entry.jev_fit;
  const jevKeep = jevKeepRaw == null || jevKeepRaw === '' || !Number.isFinite(Number(jevKeepRaw))
    ? null
    : Number(jevKeepRaw);
  const jevFit = jevFitRaw == null || jevFitRaw === '' || !Number.isFinite(Number(jevFitRaw))
    ? null
    : Number(jevFitRaw);
  let jevStatus = String(entry.jevStatus || entry.jev_status || parts.jev_status || '').trim();
  if (!jevStatus && entry.jevError) jevStatus = 'unverified';
  else if (!jevStatus && entry.jevOutcome) jevStatus = entry.jevOutcome === 'validated' ? 'kept' : String(entry.jevOutcome);
  else if (!jevStatus && jevKeep != null) jevStatus = 'kept';
  const remoteConfidenceRaw = entry.remoteConfidence ?? entry.remote_confidence;

  return {
    url: String(entry.url || '').trim(),
    company: String(entry.company || parts.company || '').trim(),
    title: String(entry.title || parts.title || '').trim(),
    location: String(entry.location || '').trim(),
    posted_at: dateOnly(entry.publishedAt || entry.posted_at || parts.publishedAt || ''),
    scanned_at: scannedAt,
    source: String(entry.source || parts.source || '').trim(),
    engine: String(entry.engine || '').trim(),
    jev_keep: jevKeep,
    jev_fit: jevFit,
    jev_status: jevStatus,
    remote_verdict: String(entry.remoteVerdict || entry.remote_verdict || parts.remote_verdict || '').trim(),
    remote_reason: String(entry.remoteReason || entry.remote_reason || parts.remote_reason || '').trim(),
    remote_confidence: remoteConfidenceRaw == null || remoteConfidenceRaw === '' || !Number.isFinite(Number(remoteConfidenceRaw))
      ? null
      : Number(remoteConfidenceRaw),
    status: entry.status || 'pending',
  };
}

export function overlayPipelineRecord(item = {}, record) {
  if (!record) return item;
  if (record.status === 'removed') return null;
  return {
    ...item,
    company: item.company || record.company || '',
    title: item.title || record.title || '',
    published_at: item.published_at || record.posted_at || '',
    created_at: item.created_at || String(record.scanned_at || '').slice(0, 10),
    source: record.source || item.source || '',
    engine: record.engine || '',
    jev_keep: record.jev_keep ?? item.jev_keep ?? null,
    jev_fit: record.jev_fit ?? item.jev_fit ?? null,
    jev_status: record.jev_status || item.jev_status || '',
    remote_verdict: record.remote_verdict || item.remote_verdict || '',
    remote_reason: record.remote_reason || item.remote_reason || '',
    remote_confidence: record.remote_confidence ?? item.remote_confidence ?? null,
    scanned_at: record.scanned_at || '',
    location: record.location || item.location || '',
  };
}

export function pipelineItemJevState(item = {}) {
  const extracted = extractPipelineNoteParts(item.note || item.display_note || item.displayNote || '');
  const jev_status = String(item.jev_status || item.jevStatus || extracted.jev_status || '').trim().toLowerCase();
  const keepRaw = item.jev_keep ?? item.jevKeep ?? extracted.jev_keep;
  const keep = keepRaw == null || keepRaw === '' ? NaN : Number(keepRaw);
  return {
    jev_status,
    jev_keep: Number.isFinite(keep) ? keep : null,
  };
}

export function pipelineItemNeedsJevTriage(item = {}, { rescoreKept = false } = {}) {
  const { jev_status, jev_keep } = pipelineItemJevState(item);
  if (jev_status === 'dropped') return false;
  if (!rescoreKept && jev_status === 'kept' && jev_keep != null) return false;
  return true;
}

export function pipelineItemReadyForEval(item = {}) {
  const { jev_status, jev_keep } = pipelineItemJevState(item);
  return jev_status === 'kept' && jev_keep != null;
}

export function pipelineUrlsReadyForEval(items = [], blockedUrls = []) {
  const blocked = new Set((blockedUrls || []).map((url) => String(url || '').trim().replace(/\/+$/, '').toLowerCase()).filter(Boolean));
  return (items || [])
    .filter((item) => {
      const url = String(item?.url || '').trim();
      if (!url) return false;
      const key = url.replace(/\/+$/, '').toLowerCase();
      if (blocked.has(key) || blocked.has(url)) return false;
      return pipelineItemReadyForEval(item);
    })
    .map((item) => String(item.url).trim());
}

export function pipelineItemToJevCandidate(item = {}) {
  const extracted = extractPipelineNoteParts(item.note || item.display_note || item.displayNote || '');
  const title = String(item.title || extracted.title || '').trim();
  const company = String(item.company || extracted.company || '').trim();
  const remoteVerdict = String(item.remote_verdict || item.remoteVerdict || extracted.remote_verdict || '').toLowerCase();
  const remoteReason = String(item.remote_reason || item.remoteReason || extracted.remote_reason || '').trim();
  const remoteDisposition = remoteVerdict.includes('compatible')
    ? 'keep'
    : (remoteVerdict.includes('unclear') || remoteVerdict.includes('review') ? 'review' : '');
  const intern = internOrJuniorReason(title, item.url);
  return {
    url: String(item.url || '').trim(),
    title,
    company,
    location: String(item.location || '').trim(),
    publishedAt: dateOnly(item.published_at || item.publishedAt || item.posted_at || item.postedAt || extracted.publishedAt || ''),
    source: String(item.source || extracted.source || '').trim(),
    engine: String(item.engine || '').trim(),
    remoteEvidence: remoteReason || String(item.location || '').trim(),
    remoteDisposition,
    remoteReason,
    remoteConfidence: item.remote_confidence ?? item.remoteConfidence ?? '',
    seniority: intern ? 'intern' : '',
    contract: intern ? 'internship' : '',
    description: [title, company, remoteReason, extracted.note].filter(Boolean).join(' | '),
  };
}

export function formatPipelineNote(record = {}) {
  const line = formatPipelineMarkdown(record).replace(/^- \[ \] /, '');
  const url = sanitizeField(record.url).replace(/\|/g, '%7C');
  if (url && line.startsWith(url)) return line.slice(url.length).replace(/^\s*\|\s*/, '').trim();
  return line.trim();
}

export function formatPipelineMarkdown(record = {}) {
  const url = sanitizeField(record.url).replace(/\|/g, '%7C');
  const cells = [url, sanitizeField(record.company), sanitizeField(record.title)];
  const location = sanitizeField(record.location);
  if (location) cells.push(location);
  if (record.posted_at) cells.push(`posted: ${sanitizeField(record.posted_at)}`);
  const source = sanitizeField(record.source);
  if (source) cells.push(`source: ${source}`);
  const jevStatus = sanitizeField(record.jev_status);
  if (record.jev_keep != null && Number.isFinite(Number(record.jev_keep))) {
    const bits = [Number(record.jev_keep).toFixed(2)];
    if (jevStatus) bits.push(jevStatus);
    cells.push(`jev: ${bits.join(' ')}`);
  } else if (jevStatus) {
    cells.push(`jev: ${jevStatus}`);
  }
  const verdict = sanitizeField(record.remote_verdict);
  const reason = sanitizeField(record.remote_reason);
  if (verdict || reason) cells.push(`remote_verdict: ${[verdict, reason].filter(Boolean).join(' — ')}`);
  return `- [ ] ${cells.join(' | ')}`;
}

export function insertPipelineMarkdownLines(raw = '', lines = [], prepend = false) {
  const block = (lines || []).filter(Boolean).join('\n');
  if (!block) return String(raw || '');
  const trimmed = String(raw || '').replace(/\s+$/, '');
  if (!prepend) return trimmed ? `${trimmed}\n${block}\n` : `${block}\n`;
  const heading = trimmed.match(/^(#[^\n]*\n(?:\s*##[^\n]*\n)?\s*)/);
  if (heading) {
    const rest = trimmed.slice(heading[1].length).replace(/^\s+/, '');
    return `${heading[1].replace(/\s*$/, '\n\n')}${block}\n${rest ? `${rest}\n` : ''}`;
  }
  return trimmed ? `${block}\n${trimmed}\n` : `${block}\n`;
}
