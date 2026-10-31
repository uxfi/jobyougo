/**
 * Is this posting already in the tracker? The two guards the dashboard puts in
 * front of a paid or irreversible step:
 *
 *   manualAddBlock     a URL typed or pasted into the pipeline that was already
 *                      evaluated (a tracker row carries its URL) or tracked
 *                      (same employer and role under another URL)
 *   applyTrackerBlock  an apply run on a posting a tracker row already shows as
 *                      sent, under any row number
 *
 * Scans have their own memory (scan-history, reports/, company+role exclusions
 * in ui/server.mjs). A manual add and an apply run never went through it:
 * 2026-10-31, Secfix #222 was evaluated six times from manual adds, and xflow
 * (#124, #789) and Remote Office (#108, #123) were each applied twice on one
 * report URL.
 *
 * Both return null when nothing stands in the way. The caller lets the user
 * override with `force`.
 */
import { normalizeUrl } from '../url-key.mjs';
import { normalizeCompany, roleMatch } from './scan-filters.mjs';

// The dashboard shows all of these as Applied (displayStatus in ui/index.html).
export const SENT_STATES = new Set(['Applied', 'Responded', 'Interview', 'Offer', 'Hired', 'Rejected']);

const jobUrlOf = (app) => app?.JobURL ?? app?.job_url ?? app?.jobUrl ?? app?.URL ?? app?.url ?? '';
const textOf = (app, upper, lower) => String(app?.[upper] ?? app?.[lower] ?? '').trim();
const numOf = (app) => {
  const n = parseInt(app?.num ?? app?.['#'] ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const reportFileOf = (app) => {
  const match = textOf(app, 'Report', 'report').match(/\(([^)]+)\)/);
  return match ? match[1].split('/').pop() : '';
};

function describe(app, canonical) {
  const raw = textOf(app, 'Status', 'status').replace(/\*/g, '').trim();
  return {
    num: numOf(app),
    status: canonical(raw) || raw,
    company: textOf(app, 'Company', 'company'),
    role: textOf(app, 'Role', 'role'),
    report: reportFileOf(app),
  };
}

/**
 * Rows of one posting: the same row number, the same report file, or the same
 * posting URL. The URL is what finds the second row of a posting evaluated twice
 * under two spellings of the employer ("X" and "X-FLOW").
 */
export function trackerRowsForPosting(apps, { url = '', num = 0, report = '' } = {}) {
  const key = normalizeUrl(url);
  const wanted = Number(num) > 0 ? Number(num) : 0;
  return (apps || []).filter((app) => {
    if (wanted && numOf(app) === wanted) return true;
    if (report && reportFileOf(app) === report) return true;
    return Boolean(key) && normalizeUrl(String(jobUrlOf(app))) === key;
  });
}

/**
 * A manual add of an offer the tracker already holds. `company` and `title` are
 * optional (known once the posting is looked up): without them only the URL is
 * compared.
 *
 * @param {{url: string, company?: string, title?: string, apps: object[], canonical?: (s: string) => string|null}} input
 */
export function manualAddBlock({ url, company = '', title = '', apps = [], canonical = (s) => s }) {
  const byUrl = trackerRowsForPosting(apps, { url })[0];
  if (byUrl) {
    const existing = describe(byUrl, canonical);
    return { reason: 'evaluated', existing, message: `Already evaluated (#${existing.num}, ${existing.status}).` };
  }
  const employer = normalizeCompany(company);
  if (!employer || !String(title).trim()) return null;
  const byRole = apps.find((app) => normalizeCompany(textOf(app, 'Company', 'company')) === employer
    && roleMatch(textOf(app, 'Role', 'role'), title));
  if (!byRole) return null;
  const existing = describe(byRole, canonical);
  return { reason: 'tracked', existing, message: `Already tracked (#${existing.num}, ${existing.status}, ${existing.company}: ${existing.role}).` };
}

/**
 * An apply run on a posting a tracker row already shows as sent. The message
 * starts with "Already applied": the dashboard asks the user before it retries
 * with `force` (and a queue never does).
 *
 * @param {{apps: object[], num?: number, report?: string, jobUrl?: string, canonical?: (s: string) => string|null}} input
 */
export function applyTrackerBlock({ apps = [], num = 0, report = '', jobUrl = '', canonical = (s) => s }) {
  const sent = trackerRowsForPosting(apps, { url: jobUrl, num, report })
    .map((app) => describe(app, canonical))
    .find((row) => SENT_STATES.has(row.status));
  if (!sent) return null;
  return {
    error: `Already applied (tracker #${sent.num}, ${sent.status}). Applying again would send a second application.`,
    alreadySubmitted: true,
    reason: 'applied',
    existing: sent,
  };
}
