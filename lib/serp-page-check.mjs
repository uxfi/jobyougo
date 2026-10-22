// What an empty search-engine page really was. A results page the extractor
// read 0 links from is only a genuine "0 results" when the engine says so;
// a consent wall, a "sorry"/unusual-traffic page, a JS-required shell or a
// results layout the selectors no longer match must not pass for an empty
// search (2026-10-19: DuckDuckGo and Google answered "0 results" to every
// query of a run, including ones Brave answered with 20).

const NO_RESULTS = [
  /did not match any documents/i,
  /no results found for/i,
  /it looks like there aren.t many great matches/i,
  /not many great matches/i,
  /no more results/i,
  /aucun r[ée]sultat/i,
  /keine ergebnisse/i,
  /no results\.?$/i,
];

const BLOCKED = [
  [/before you continue to google|avant d.acc[ée]der [àa] google|consent\.google\./i, 'consent page'],
  [/our systems have detected unusual traffic|unusual traffic from your computer network|\/sorry\/index/i, 'unusual-traffic page'],
  [/if you.re having trouble accessing google search|please click here if you are not redirected|enablejs/i, 'javascript-required page'],
  [/bots use duckduckgo too|anomaly|please complete the following challenge|select all (?:squares|images)/i, 'bot challenge'],
  [/captcha|verify you are (?:a )?human|unusual activity/i, 'captcha'],
];

/**
 * @param {{ url?: string, title?: string, bodyText?: string }} page
 * @returns {{ kind: 'no-results' } | { kind: 'blocked', reason: string }}
 */
export function classifyEmptySerp({ url = '', title = '', bodyText = '' } = {}) {
  const text = `${title}\n${bodyText}`.replace(/\s+/g, ' ').trim();
  const where = `${url} ${text}`;
  for (const [re, reason] of BLOCKED) if (re.test(where)) return { kind: 'blocked', reason };
  if (/(?:^|\/\/)(?:consent|accounts)\.google\./i.test(url) || /\/sorry\//i.test(url)) return { kind: 'blocked', reason: 'consent page' };
  if (NO_RESULTS.some(re => re.test(text))) return { kind: 'no-results' };
  if (text.length < 200) return { kind: 'blocked', reason: 'blank page' };
  return { kind: 'blocked', reason: 'unparsed results page' };
}

/**
 * One short diagnostic line for the scan log. `diag` is what the page held
 * ({ anchors, headings }): a results page with headings but no readable link
 * points at the extractor's selectors, not at a block.
 */
export function serpDiagnostic({ url = '', title = '', bodyText = '', diag = null } = {}) {
  let host = '';
  try { host = new URL(url).host + new URL(url).pathname; } catch { host = String(url || '').slice(0, 60); }
  const body = String(bodyText || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  const held = diag && Number.isFinite(diag.anchors) ? ` anchors=${diag.anchors} headings=${diag.headings ?? '?'}` : '';
  return `${host} title="${String(title || '').slice(0, 80)}" body="${body}"${held}`;
}