/**
 * After a CV upload, some ATS copy name/email out of the file.
 * Wait only until that lands or a timeout fires — then the caller fills
 * the blanks itself and overwrites values that do not match the profile.
 *
 * snapshotIdentityFields runs in the page (no module scope).
 */

export const AUTOFILL_WAIT_MS = 4500;

export function snapshotIdentityFields() {
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
  return deepAll(document, 'input, textarea').slice(0, 120).map((el) => ({
    label: el.getAttribute('aria-label') || '',
    name: el.name || '',
    idAttr: el.id || '',
    autocomplete: el.getAttribute('autocomplete') || '',
    type: (el.type || '').toLowerCase(),
    value: String(el.value || '').trim().slice(0, 160),
  }));
}

export function identityFieldKind(f) {
  const s = `${f?.label || ''} ${f?.name || ''} ${f?.idAttr || ''} ${f?.id || ''} ${f?.autocomplete || ''} ${f?.type || ''}`.toLowerCase();
  if (f?.type === 'email' || /\be-?mail\b|courriel/.test(s)) return 'email';
  if (/company|entreprise|employeur|employer|organization|organisation|school|university|filename|resume|\bcv\b|username|user name|\bfile\b/.test(s)) {
    return null;
  }
  if (/first[\s_-]*name|given[\s_-]*name|pr[ée]nom|\bfname\b/.test(s)) return 'firstName';
  if (/last[\s_-]*name|family[\s_-]*name|surname|nom de famille|\blname\b/.test(s)) return 'lastName';
  if (/full[\s_-]*name|legal[\s_-]*name|\byour name\b/.test(s)) return 'fullName';
  if (/(^|[^a-z])name([^a-z]|$)/.test(s)) return 'fullName';
  return null;
}

function sameText(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

function valuesMatch(kind, got, want) {
  if (!want) return true;
  if (kind === 'email') return sameText(got, want);
  return sameText(got, want);
}

/**
 * @returns {{ status: 'matched'|'mismatch'|'partial'|'empty'|'absent', mismatches: Array, manualFill: boolean }}
 */
export function judgeAutofillSnapshot(fields, identity = {}) {
  const want = {
    email: identity.email || '',
    firstName: identity.firstName || '',
    lastName: identity.lastName || '',
    fullName: identity.fullName || '',
  };
  const groups = { email: [], firstName: [], lastName: [], fullName: [] };
  for (const f of fields || []) {
    const kind = identityFieldKind(f);
    if (!kind || !want[kind]) continue;
    groups[kind].push(String(f.value || '').trim());
  }
  const tracked = Object.entries(groups).filter(([, values]) => values.length);
  if (!tracked.length) {
    return { status: 'absent', mismatches: [], manualFill: true };
  }
  const mismatches = [];
  let filled = 0;
  let empty = 0;
  for (const [kind, values] of tracked) {
    const present = values.filter(Boolean);
    if (!present.length) {
      empty += 1;
      continue;
    }
    filled += 1;
    const got = present[0];
    if (!valuesMatch(kind, got, want[kind])) {
      mismatches.push({ kind, got, want: want[kind] });
    }
  }
  if (mismatches.length) {
    return { status: 'mismatch', mismatches, manualFill: true };
  }
  if (filled && empty) return { status: 'partial', mismatches: [], manualFill: true };
  if (filled) return { status: 'matched', mismatches: [], manualFill: false };
  return { status: 'empty', mismatches: [], manualFill: true };
}

/** Keep polling while the ATS may still be writing. A wrong value ends the wait. */
export function autofillShouldKeepWaiting(status) {
  return status === 'empty' || status === 'absent' || status === 'partial';
}
