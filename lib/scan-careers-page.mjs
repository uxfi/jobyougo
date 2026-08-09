/**
 * Level 1 — deep scrape of a company careers page with Playwright.
 *
 * modes/scan.md describes this level as PRIMARY, but scan-fetch.mjs had no
 * Playwright at all: any tracked_company without a deterministic `api` board
 * (Greenhouse/Ashby/Lever) was dropped by `if (!c.enabled || !c.api) continue`
 * without even a skip message. That silently hid 29 of 97 tracked companies —
 * OpenAI, Hugging Face, Salesforce, Twilio, Gong, Genesys, Retool, and the
 * JobsDB/Jora Asia boards — from every scan.
 *
 * Deliberately generic: these 29 targets span hand-rolled SPAs, Workable,
 * Workday and regional job boards, so rather than write 29 scrapers we extract
 * every anchor that structurally looks like a job posting and let the caller's
 * existing title/remote filters do the discrimination they already do for
 * every other level.
 */
import { chromium } from 'playwright';

// Href shapes used by job postings across ATS platforms and hand-rolled career
// pages. Matched against the URL, not the link text, because link text is
// unreliable (icons, nested spans) while posting URLs are consistently namespaced.
const JOB_HREF_RE = /\/(jobs?|careers?|positions?|openings?|vacanc(y|ies)|opportunit(y|ies)|role)s?[\/?#]|gh_jid=|\/job-detail|jobsdb\.com\/job\/|jora\.com\/job\/|boards\.greenhouse\.io\/[^/]+\/jobs\/|jobs\.lever\.co\/[^/]+\/|jobs\.ashbyhq\.com\/[^/]+\/|apply\.workable\.com\/[^/]+\/j\//i;

// Anchors that match JOB_HREF_RE but are navigation or per-row action buttons,
// not the posting title itself. Prefix-anchored (not full-string) because these
// carry trailing noise in practice: OpenAI renders one "Apply now (opens in a
// new window)" link per job, and an "Apply"-only full-string test misses it.
const NAV_TEXT_RE = /^(jobs?|careers?|open (roles|positions)|all jobs|view all|see all|search|browse|apply|learn more|read more|back|next|previous|home|life at|why join|benefits|culture|teams?|departments?|locations?|filters?|sign in|log ?in|skip to|opens in a new)/i;

function normalize(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

/**
 * @returns {Promise<Array<{title,url,company,location,postedAt}>>}
 */
export async function scrapeCareersPage(careersUrl, companyName, opts = {}) {
  const { timeoutMs = 30000, maxResults = 120, headless = true } = opts;
  let browser;
  try {
    // Prefer the locally installed Chrome, exactly like apply-runner.mjs does:
    // Playwright's own chromium build is not downloaded in this environment
    // ("Executable doesn't exist at ...ms-playwright\chromium"), so launching
    // without a channel fails outright. Fall back to the bundled build for
    // environments where Chrome is absent but `playwright install` was run.
    for (const channel of ['chrome', 'msedge', undefined]) {
      try {
        browser = await chromium.launch(channel ? { headless, channel } : { headless });
        break;
      } catch (err) {
        if (channel === undefined) throw err;
      }
    }
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      viewport: { width: 1366, height: 900 },
    });
    const page = await context.newPage();
    // 'domcontentloaded' rather than 'networkidle': analytics/chat widgets keep
    // sockets open on many careers pages, so networkidle routinely never fires
    // and the whole source times out with zero results.
    await page.goto(careersUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    // Give client-rendered listings (Ashby/Lever/Workday SPAs) a beat to paint,
    // then settle — bounded so a hanging site can't stall the whole scan.
    await page.waitForTimeout(2500);
    try {
      await page.waitForSelector('a[href]', { timeout: 4000 });
    } catch { /* no anchors at all — fall through and return [] */ }

    const rows = await page.evaluate(({ jobHrefSrc, navTextSrc, cap }) => {
      const jobHref = new RegExp(jobHrefSrc, 'i');
      const navText = new RegExp(navTextSrc, 'i');
      const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const out = [];
      const seen = new Set();
      const CARD_SEL = 'li, tr, article, [class*="job" i], [class*="card" i], [class*="posting" i]';
      for (const a of document.querySelectorAll('a[href]')) {
        const href = a.href;
        if (!href || !jobHref.test(href)) continue;
        if (seen.has(href)) continue;
        const card = a.closest(CARD_SEL) || a.parentElement;
        const cardText = norm(card ? card.innerText : '');
        // Many boards (Workable, and any "stretched link" card pattern) render
        // an EMPTY overlay anchor covering the whole card, with the title as a
        // sibling outside the <a> — reading only anchor text returns nothing
        // and silently yields zero jobs for the entire company. Fall back to
        // the card's own heading, then to its first line.
        let text = norm(a.innerText || a.textContent);
        if (!text && card) {
          const heading = card.querySelector('h1, h2, h3, h4, h5, [class*="title" i], [class*="heading" i]');
          text = norm(heading?.innerText) || cardText.split('\n')[0] || '';
        }
        if (!text || text.length < 5 || text.length > 140) continue;
        if (navText.test(text)) continue;
        seen.add(href);
        // Nearby text often carries the location ("Remote — Europe"); pass the
        // whole card so the caller's remote+geo filter has something to work
        // with instead of an empty location.
        out.push({ title: text, url: href, location: cardText.slice(0, 300) });
        if (out.length >= cap) break;
      }
      return out;
    }, { jobHrefSrc: JOB_HREF_RE.source, navTextSrc: NAV_TEXT_RE.source, cap: maxResults });

    return rows.map(r => ({
      title: normalize(r.title),
      url: r.url,
      company: companyName || '',
      // Location text is best-effort card context; the caller's remote/geo
      // filter reads it exactly like the location field of any other level.
      location: normalize(r.location),
      postedAt: null, // careers pages rarely expose a machine-readable date
    }));
  } finally {
    await browser?.close().catch(() => {});
  }
}
