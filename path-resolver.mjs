import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync, realpathSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Older checkouts used CAREER_OPS_* and .career-ops-data. Read those only when
// the JobYouGo name is unset, so an existing data root keeps resolving.
for (const name of ['ROOT', 'DATA_DIR', 'TRACKER']) {
  const next = `JOBYOUGO_${name}`;
  const prev = `CAREER_OPS_${name}`;
  if (!process.env[next]?.trim() && process.env[prev]?.trim()) process.env[next] = process.env[prev];
}

function readMarker(file) {
  if (!existsSync(file)) return '';
  try { return readFileSync(file, 'utf-8').trim(); } catch { return ''; }
}

/**
 * Returns the resolved JobYouGo data directory root.
 * Priority: process.env.JOBYOUGO_ROOT or process.env.JOBYOUGO_DATA_DIR >
 * .jobyougo-data marker file > codebase root (__dirname).
 *
 * @returns {string} Absolute path to the data root
 */
export function getJobYouGoRoot() {
  const env = process.env.JOBYOUGO_ROOT?.trim() || process.env.JOBYOUGO_DATA_DIR?.trim();
  if (env) return resolve(__dirname, env);
  const content = readMarker(join(__dirname, '.jobyougo-data')) || readMarker(join(__dirname, '.career-ops-data'));
  if (content) return resolve(__dirname, content);
  return __dirname;
}

/**
 * Canonicalize a tracker path: absolute + realpath (macOS's symlinked tmpdir
 * among others). This must be applied by EVERY resolver of the same tracker:
 * two implementations briefly coexisted, the un-canonicalized one derived
 * different lock paths (/var vs /private/var) for the same file, and shared
 * writer exclusion silently broke. This module is the single source of truth;
 * tracker-utils.mjs re-exports from here so both import paths agree.
 * Deliberately dependency-light (fs/path only): test fixtures copy this file
 * standalone next to the scripts they exercise.
 */
export function canonicalizeTrackerPath(path) {
  const absolutePath = resolve(path);
  try {
    return realpathSync(absolutePath);
  } catch {
    return absolutePath;
  }
}

/**
 * Returns the canonical path to the tracker applications.md file for reading.
 * Priority: process.env.JOBYOUGO_TRACKER > root/data/applications.md > root/applications.md.
 *
 * @param {string} rootDir The jobyougo data root directory
 * @returns {string} Canonical absolute path to the tracker file
 */
export function resolveTrackerPath(rootDir) {
  const env = process.env.JOBYOUGO_TRACKER?.trim();
  const raw = env
    ? env
    : existsSync(join(rootDir, 'data/applications.md'))
      ? join(rootDir, 'data/applications.md')
      : join(rootDir, 'applications.md');
  return canonicalizeTrackerPath(raw);
}

/**
 * Returns the resolved path to the tracker applications.md file for writing.
 * Priority: process.env.JOBYOUGO_TRACKER > root/data/applications.md.
 * Does not check for file existence, providing a deterministic write target.
 * 
 * @param {string} root The jobyougo data root directory
 * @returns {string} Absolute path to the tracker file for writing
 */
export function resolveTrackerPathForWrite(root) {
  const env = process.env.JOBYOUGO_TRACKER?.trim();
  if (env) {
    // Same canonicalization as the read path (see the re-export above): an
    // un-canonicalized env override derives divergent lock paths on symlinked
    // tmpdirs and breaks shared writer exclusion.
    return canonicalizeTrackerPath(env);
  }
  return join(root, 'data/applications.md');
}

