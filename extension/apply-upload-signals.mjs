/**
 * CV upload is confirmed only when several signals agree and no rejection
 * is visible. A non-empty FileList is one signal, not the only one: ATS
 * widgets clear the input after accept, hide it in an iframe / shadow root,
 * or show a chip while a spinner or an error arrives a moment later.
 *
 * collectUploadSignals runs in the page (no module scope).
 */

const ERROR_RE = /too large|exceeds the|file (is )?too|size limit|maximum size|max size|invalid file|unsupported format|not supported|wrong format|must be (a )?(pdf|doc)|only pdf|virus|malware|could not upload|upload failed|failed to upload|unable to upload|rejected|not a valid|trop volumineux|taille maximale|format (non reconnu|invalide|non support)|échec de l|echec de l|fichier refus/i;

export function collectUploadSignals(expectedName) {
  const deepAll = (root, sel) => {
    const out = [];
    const visit = (node) => {
      if (!node?.querySelectorAll) return;
      try { out.push(...node.querySelectorAll(sel)); } catch { /* ignore */ }
      for (const el of node.querySelectorAll('*')) {
        if (el.shadowRoot) visit(el.shadowRoot);
      }
    };
    visit(root);
    return out;
  };
  const visible = (el) => {
    try {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      const st = getComputedStyle(el);
      return st.visibility !== 'hidden' && st.display !== 'none';
    } catch {
      return false;
    }
  };

  const tip = String(expectedName || '').trim();
  let fileCount = 0;
  let fileName = '';
  for (const el of deepAll(document, 'input[type="file"]')) {
    const n = el.files?.length || 0;
    if (n > 0) {
      fileCount += n;
      fileName = fileName || el.files[0]?.name || '';
    }
  }

  const body = (document.body?.innerText || '').slice(0, 20000);
  const stem = tip.replace(/\.[a-z0-9]{2,5}$/i, '');
  const bodyHasFileName = (tip.length >= 5 && body.includes(tip))
    || (stem.length >= 4 && body.toLowerCase().includes(stem.toLowerCase()));

  let errorText = '';
  for (const el of deepAll(document, '[role="alert"], [aria-live="assertive"], [class*="error" i], [class*="invalid" i]')) {
    if (!visible(el)) continue;
    const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
    if (t && ERROR_RE.test(t)) {
      errorText = t.slice(0, 160);
      break;
    }
  }

  let spinner = false;
  for (const el of deepAll(document, '[aria-busy="true"], [class*="uploading" i], [class*="spinner" i], [role="progressbar"]')) {
    if (el === document.body || el === document.documentElement) continue;
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    const hint = `${el.className || ''} ${el.getAttribute('aria-label') || ''} ${(el.innerText || '').slice(0, 80)}`.toLowerCase();
    const uploadHint = /upload|resume|\bcv\b|analys|spinner|charg/.test(hint);
    if (el.getAttribute('aria-busy') === 'true' && r.width > 420 && r.height > 220 && !uploadHint) continue;
    if (el.getAttribute('aria-busy') === 'true' || uploadHint || /progress/.test(hint)) {
      spinner = true;
      break;
    }
  }

  let chip = false;
  for (const el of deepAll(document, '[class*="file" i], [class*="upload" i], [class*="attachment" i], [data-testid*="file" i], [data-testid*="resume" i]')) {
    if (!el || el.tagName === 'INPUT' || el.tagName === 'SCRIPT') continue;
    if (!visible(el)) continue;
    const t = (el.innerText || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
    if (!t || t.length > 180) continue;
    const cls = `${el.className || ''} ${el.getAttribute('data-testid') || ''}`.toLowerCase();
    const looksUpload = /upload|attachment|resume|\bcv\b|file-name|filename|filechip|file-chip/.test(cls);
    const stem = tip.replace(/\.[a-z0-9]{2,5}$/i, '');
    if ((tip && t.includes(tip)) || (stem.length >= 4 && t.toLowerCase().includes(stem.toLowerCase())) || (looksUpload && /\.(pdf|docx?|rtf)\b/i.test(t))) {
      chip = true;
      break;
    }
  }

  let hiddenFileId = false;
  for (const el of deepAll(document, 'input[type="hidden"]')) {
    const blob = `${el.name || ''} ${el.id || ''}`.toLowerCase();
    if (!/resume|attachment|file.?id|upload|cv.?id|document.?id/.test(blob)) continue;
    const v = String(el.value || '').trim();
    if (v && v !== '0' && v.length >= 4 && v.length <= 80 && !/^(null|none|undefined|false|true)$/i.test(v)) {
      hiddenFileId = true;
      break;
    }
  }

  return { fileCount, fileName, bodyHasFileName, chip, hiddenFileId, errorText, spinner };
}

export function mergeUploadSignals(parts) {
  const list = (parts || []).filter(Boolean);
  return {
    fileCount: list.reduce((n, s) => n + (s.fileCount || 0), 0),
    fileName: list.map((s) => s.fileName).find(Boolean) || '',
    bodyHasFileName: list.some((s) => s.bodyHasFileName),
    chip: list.some((s) => s.chip),
    hiddenFileId: list.some((s) => s.hiddenFileId),
    errorText: list.map((s) => s.errorText).find(Boolean) || '',
    spinner: list.some((s) => s.spinner),
    networkOk: list.some((s) => s.networkOk),
  };
}

/**
 * @returns {{ ok: boolean, pending: boolean, error: boolean, reason: string, hits: string[] }}
 */
export function judgeUploadSignals(signals = {}, { expectedName = '' } = {}) {
  const errorText = String(signals.errorText || '').trim();
  if (errorText) {
    return {
      ok: false,
      pending: false,
      error: true,
      reason: `upload rejeté: ${errorText.slice(0, 100)}`,
      hits: [],
    };
  }
  const hits = [];
  if ((signals.fileCount || 0) > 0) hits.push('fichier-input');
  if (signals.fileName) hits.push('nom-input');
  if (signals.bodyHasFileName) hits.push('nom-visible');
  if (signals.chip) hits.push('carte-fichier');
  if (signals.hiddenFileId) hits.push('id-fichier');
  if (signals.networkOk) hits.push('reseau');
  if (signals.spinner) {
    return { ok: false, pending: true, error: false, reason: 'spinner encore actif', hits };
  }
  if (!hits.length) {
    return {
      ok: false,
      pending: false,
      error: false,
      reason: expectedName ? 'aucun signal d’upload' : 'aucun signal d’upload',
      hits,
    };
  }
  return {
    ok: true,
    pending: false,
    error: false,
    reason: hits.join(', '),
    hits,
    fileName: signals.fileName || expectedName || '',
  };
}
