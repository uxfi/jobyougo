/**
 * Files an apply run attaches, kept per account: the CV PDF and the cover
 * letters, under data/apply-files/<account id>/. The folder comes from the
 * signed-in account's id, never from a profile value, so a run can only ever
 * upload its own account's files. The shared output/ folder stays the
 * owner's (lib/apply-spec.mjs pickCvPath).
 *
 *   data/apply-files/<id>/cv/<Name>.pdf          one file, the apply CV
 *   data/apply-files/<id>/letters/cover-letter-{company}-{role}-{date}.pdf
 */

import { mkdir, readdir, readFile, rm, stat, writeFile } from 'fs/promises';
import { basename, join } from 'path';

export const APPLY_FILES_DIR = join('data', 'apply-files');
// LinkedIn Easy Apply takes 2 MB, most boards 5 to 10 MB.
export const APPLY_CV_MAX_BYTES = 5 * 1024 * 1024;

// A Supabase user id (uuid) or 'local' (no accounts). Anything else could
// climb out of data/apply-files/.
export function isAccountId(id) {
  return typeof id === 'string' && (id === 'local' || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
}

export function accountFilesDir(root, accountId) {
  if (!isAccountId(accountId)) throw new Error('invalid account id');
  return join(root, APPLY_FILES_DIR, accountId.toLowerCase());
}

export function accountCvDir(root, accountId) {
  return join(accountFilesDir(root, accountId), 'cv');
}

export function accountLettersDir(root, accountId) {
  return join(accountFilesDir(root, accountId), 'letters');
}

/**
 * The name the PDF keeps on the recruiter's side ("Jane_Doe_CV.pdf"). A file
 * name only: no folder, no leading dot, plain characters, ends in .pdf.
 */
export function safePdfName(name, fallback = 'CV.pdf') {
  const base = basename(String(name || '').replace(/\\/g, '/'))
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/\.pdf$/i, '')
    .replace(/[^A-Za-z0-9._ -]+/g, '_')
    .replace(/^[.\s_-]+|[.\s]+$/g, '')
    .slice(0, 96);
  return base ? `${base}.pdf` : fallback;
}

/** The account's apply CV: { path, fileName, size, updatedAt }, or null. */
export async function readAccountCv(root, accountId) {
  if (!isAccountId(accountId)) return null;
  const dir = accountCvDir(root, accountId);
  let files;
  try { files = await readdir(dir); } catch { return null; }
  const pdf = files.filter((f) => /\.pdf$/i.test(f) && !f.startsWith('.')).sort()[0];
  if (!pdf) return null;
  const path = join(dir, pdf);
  try {
    const info = await stat(path);
    if (!info.isFile()) return null;
    return { path, fileName: pdf, size: info.size, updatedAt: info.mtime.toISOString() };
  } catch { return null; }
}

/** Throws a message the dashboard can show when `bytes` is not a usable CV PDF. */
export function assertCvPdf(bytes) {
  if (!bytes?.length) throw new Error('The file is empty.');
  if (bytes.length > APPLY_CV_MAX_BYTES) throw new Error('That PDF is over 5 MB. Most job boards refuse it: export a lighter one.');
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('That file is not a PDF.');
}

/** Replaces the account's apply CV with `bytes` (a PDF). */
export async function saveAccountCv(root, accountId, { fileName, bytes }) {
  assertCvPdf(bytes);
  const dir = accountCvDir(root, accountId);
  await mkdir(dir, { recursive: true });
  const name = safePdfName(fileName);
  // One CV per account: the previous one goes, whatever its name.
  for (const old of await readdir(dir).catch(() => [])) {
    if (old !== name) await rm(join(dir, old), { force: true }).catch(() => {});
  }
  await writeFile(join(dir, name), bytes);
  return readAccountCv(root, accountId);
}

export async function deleteAccountCv(root, accountId) {
  await rm(accountCvDir(root, accountId), { recursive: true, force: true });
}

export async function readAccountCvBytes(root, accountId) {
  const cv = await readAccountCv(root, accountId);
  return cv ? { ...cv, bytes: await readFile(cv.path) } : null;
}
