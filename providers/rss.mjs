import { decodeEntities } from './_html-entities.mjs';
// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
/** @typedef {import('./_types.js').Job} Job */

// Generic public RSS/Atom job-feed provider.
//
// Opt-in only via `provider: rss` + `api:` (preferred) or `careers_url:` pointing
// at a feed URL. Host must be on the allowlist below — no open SSRF surface.
// Job item links may point at employer ATS hosts (aggregators); only the feed
// fetch is host-pinned.
//
// Wire in via a `job_boards:` entry:
//   provider: rss
//   api: https://example.com/jobs.rss

/** @type {ReadonlySet<string>} */
const ALLOWED_FEED_HOSTS = new Set([
  'realworkfromanywhere.com',
  'www.realworkfromanywhere.com',
  'authenticjobs.com',
  'www.authenticjobs.com',
  'cryptojobslist.com',
  'www.cryptojobslist.com',
  'chainjobs.io',
  'www.chainjobs.io',
  'blockchainjobs.uk',
  'www.blockchainjobs.uk',
  'jobscollider.com',
  'www.jobscollider.com',
]);

/**
 * @param {unknown} value
 * @returns {string}
 */
function assertFeedUrl(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('rss: entry needs api: or careers_url: with an HTTPS feed URL');
  }
  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error(`rss: invalid feed URL: ${value}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`rss: feed URL must use HTTPS: ${value}`);
  }
  const host = parsed.hostname.toLowerCase();
  if (!ALLOWED_FEED_HOSTS.has(host)) {
    throw new Error(`rss: untrusted feed host "${host}" — add it to ALLOWED_FEED_HOSTS if intentional`);
  }
  return parsed.href;
}

/**
 * Resolve the feed URL from a portals.yml entry.
 * @param {Record<string, unknown>} entry
 * @returns {string}
 */
export function resolveFeedUrl(entry) {
  const raw = entry?.api ?? entry?.careers_url;
  return assertFeedUrl(raw);
}

// NaN-safe Date.parse — `|| undefined` would also coerce a valid epoch 0.
function toEpochMs(value) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function extractText(inner) {
  const cdata = inner.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  if (cdata) return decodeEntities(cdata[1]).trim();
  return decodeEntities(inner).trim();
}

function tagText(block, tag) {
  const m = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? extractText(m[1]) : '';
}

/**
 * Prefer <link>text</link>, then Atom href=, then guid/id when absolute https.
 * @param {string} block
 * @returns {string}
 */
function itemLink(block) {
  const textLink = tagText(block, 'link');
  if (isHttpsUrl(textLink)) return textLink.trim();
  const href = block.match(/<link\b[^>]*\bhref=["']([^"']+)["']/i);
  if (href && isHttpsUrl(href[1])) return href[1].trim();
  for (const tag of ['guid', 'id']) {
    const v = tagText(block, tag);
    if (isHttpsUrl(v)) return v.trim();
  }
  return '';
}

function isHttpsUrl(value) {
  if (!value || typeof value !== 'string') return false;
  try {
    return new URL(value.trim()).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Heuristic company extraction from common title shapes.
 * @param {string} rawTitle
 * @param {string} fallback
 * @returns {{ title: string, company: string }}
 */
export function splitTitle(rawTitle, fallback = '') {
  const text = rawTitle.trim();
  const at = text.toLowerCase().lastIndexOf(' at ');
  if (at > 0) {
    const title = text.slice(0, at).trim();
    const company = text.slice(at + 4).trim();
    if (title && company) return { title, company };
  }
  const colon = text.indexOf(':');
  if (colon > 0 && colon < 80) {
    const company = text.slice(0, colon).trim();
    const title = text.slice(colon + 1).trim();
    if (company && title && company.length < 60) return { title, company };
  }
  return { title: text, company: fallback };
}

function fallbackCompany(entry) {
  return typeof entry?.name === 'string' && entry.name.trim() ? entry.name.trim() : '';
}

/**
 * Parse a generic RSS 2.0 / Atom jobs feed. Exported for unit tests.
 * @param {string} xml
 * @param {string} [defaultCompany]
 * @returns {Job[]}
 */
export function parseGenericRssFeed(xml, defaultCompany = '') {
  if (typeof xml !== 'string') return [];
  const fallback = typeof defaultCompany === 'string' ? defaultCompany.trim() : '';
  /** @type {Job[]} */
  const jobs = [];
  const blocks = xml.match(/<(?:item|entry)\b[^>]*>[\s\S]*?<\/(?:item|entry)>/gi) || [];

  for (const item of blocks) {
    const url = itemLink(item);
    if (!url) continue;

    const rawTitle = tagText(item, 'title');
    if (!rawTitle) continue;

    const { title, company } = splitTitle(rawTitle, fallback);
    const location = [
      tagText(item, 'region'),
      tagText(item, 'country'),
      tagText(item, 'job:location'),
      tagText(item, 'location'),
    ].filter(Boolean).join(', ');

    const description =
      tagText(item, 'content:encoded') ||
      tagText(item, 'description') ||
      tagText(item, 'content') ||
      tagText(item, 'summary');

    const postedAt = toEpochMs(
      tagText(item, 'pubDate') ||
      tagText(item, 'published') ||
      tagText(item, 'updated') ||
      tagText(item, 'dc:date'),
    );

    /** @type {Job} */
    const job = {
      title,
      url,
      company,
      location,
    };
    if (description) job.description = description;
    if (postedAt !== undefined) job.postedAt = postedAt;
    jobs.push(job);
  }

  return jobs;
}

/** @type {Provider} */
export default {
  id: 'rss',

  detect(entry) {
    if (entry?.provider !== 'rss') return null;
    try {
      return { url: resolveFeedUrl(entry) };
    } catch {
      return null;
    }
  },

  async fetch(entry, ctx) {
    const feedUrl = resolveFeedUrl(entry);
    const text = await ctx.fetchText(feedUrl, { redirect: 'error' });
    return parseGenericRssFeed(text, fallbackCompany(entry));
  },
};
