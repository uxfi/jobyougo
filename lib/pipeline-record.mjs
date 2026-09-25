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

export function extractPipelineNoteParts(note = '') {
  const raw = String(note || '').trim();
  if (!raw) return { note: '', company: '', title: '', publishedAt: '' };

  const parts = raw.split('|').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return { note: raw, company: '', title: '', publishedAt: '' };

  const postedPart = parts.find((part) => /^posted:\s*\d{4}-\d{2}-\d{2}/i.test(part));
  const lastPart = parts[parts.length - 1];
  const trailingDate = !postedPart && dateOnly(lastPart) === lastPart.slice(0, 10) && /^\d{4}-\d{2}-\d{2}$/.test(lastPart)
    ? lastPart
    : '';
  const publishedAt = postedPart
    ? postedPart.replace(/^posted:\s*/i, '').slice(0, 10)
    : trailingDate;

  const mainParts = parts.filter((part) => part !== postedPart && part !== trailingDate);
  const [company = '', title = '', ...rest] = mainParts;
  return {
    company,
    title,
    publishedAt,
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
  const jevKeepRaw = entry.jevKeep ?? entry.jev_keep;
  const jevFitRaw = entry.jevFit ?? entry.jev_fit;
  const jevKeep = jevKeepRaw == null || jevKeepRaw === '' || !Number.isFinite(Number(jevKeepRaw))
    ? null
    : Number(jevKeepRaw);
  const jevFit = jevFitRaw == null || jevFitRaw === '' || !Number.isFinite(Number(jevFitRaw))
    ? null
    : Number(jevFitRaw);
  let jevStatus = String(entry.jevStatus || entry.jev_status || '').trim();
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
    source: String(entry.source || '').trim(),
    engine: String(entry.engine || '').trim(),
    jev_keep: jevKeep,
    jev_fit: jevFit,
    jev_status: jevStatus,
    remote_verdict: String(entry.remoteVerdict || entry.remote_verdict || '').trim(),
    remote_reason: String(entry.remoteReason || entry.remote_reason || '').trim(),
    remote_confidence: remoteConfidenceRaw == null || remoteConfidenceRaw === '' || !Number.isFinite(Number(remoteConfidenceRaw))
      ? null
      : Number(remoteConfidenceRaw),
    status: entry.status || 'pending',
  };
}

export function overlayPipelineRecord(item = {}, record) {
  if (!record || record.status === 'removed') return item;
  return {
    ...item,
    company: item.company || record.company || '',
    title: item.title || record.title || '',
    published_at: item.published_at || record.posted_at || '',
    created_at: item.created_at || String(record.scanned_at || '').slice(0, 10),
    source: record.source || item.source || '',
    engine: record.engine || '',
    jev_keep: record.jev_keep,
    jev_fit: record.jev_fit,
    jev_status: record.jev_status || '',
    remote_verdict: record.remote_verdict || '',
    remote_reason: record.remote_reason || '',
    remote_confidence: record.remote_confidence ?? null,
    scanned_at: record.scanned_at || '',
    location: record.location || item.location || '',
  };
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
