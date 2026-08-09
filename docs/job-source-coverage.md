# Job Source Coverage

Last checked: 2026-07-28 (previous check: 2026-06-14).

## 2026-07-28 Health Check

Ran `node scan-fetch.mjs jobs --dry-run --debug --max-age=0` (Windows checkout, after fixing a
cross-platform path bug in 7 scripts that used `new URL('.', import.meta.url).pathname`, which
resolves to a broken doubled path like `C:\C:\...` on Windows — replaced with
`dirname(fileURLToPath(import.meta.url))`).

Found and fixed 2 dead sources (of 62 previously configured):

- **RunPod** (`tracked_companies`): Greenhouse board (`boards-api.greenhouse.io/v1/boards/runpod/jobs`)
  returns HTTP 404 — RunPod moved ATS. Confirmed their careers page now 301-redirects to
  `jobs.ashbyhq.com/runpod`. Updated the entry to the Ashby API
  (`api.ashbyhq.com/posting-api/job-board/runpod`).
- **RemoteOK — All Remote / AI / Design / Product** (`rss_feeds`): all 4 category RSS feeds
  (`remoteok.com/remote-*-jobs.rss`) return HTTP 410 (Gone) — permanently retired, not transient.
  Disabled all 4. RemoteOK's JSON API (`remoteok.com/api`) is still live and was already the P0
  recommendation in `job-ingestion-sources-corrigees.md`; added a `remoteok` provider under
  `api_aggregators` (wired into `scan-fetch.mjs`'s `parseRemoteOk`/`aggregatorFetcher`) to replace
  the dead feeds with the source the earlier audit actually pointed at.

Post-fix: 59/59 eligible sources fetched successfully (0 errors), 4,837 listings seen, 193 new
offers matched (`--max-age=0` to bypass the 7-day freshness cutoff for this audit run).

This scanner is designed to maximize Europe and Asia coverage without depending on restricted job-board scraping. The strongest strategy is additive:

1. Direct ATS APIs and company career pages: Greenhouse, Ashby, Lever, Workable/custom pages.
2. Search discovery: Google Jobs/SearchAPI, SerpApi, Brave/DuckDuckGo fallbacks, and `site:` queries.
3. Public remote feeds: Remotive, Jobicy, Himalayas, Arbeitnow, RemoteOK, We Work Remotely.
4. Official or partner aggregators: Adzuna, Jooble, Careerjet, TheirStack.
5. National/public job boards through search queries first, then official APIs where credentials are available.

Current configured coverage in `portals.yml`:

- `55` enabled company/direct sources.
- `110` enabled search query sources across `search_queries` (31), `eu_job_boards` (37), and `freelance_portals` (42).
- `15` enabled RSS feeds.
- `5` enabled aggregator/API sources.

`scan_max_age_days` is currently `7`, so candidates older than seven days are dropped when a publish date is available.

## Enabled Without Keys

- Remotive Public API: `https://remotive.com/api/remote-jobs`
- Jobicy Public API: `https://jobicy.com/api/v2/remote-jobs?count=100` (the `jobs-rss-feed` RSS path is disabled in `portals.yml` — Cloudflare has returned intermittent 403 challenges and the API already covers the same content)
- Himalayas Public API/RSS: `https://himalayas.app/jobs/api` (paginated via `limit`/`offset`), `https://himalayas.app/jobs/rss`
- Arbeitnow Europe API: `https://www.arbeitnow.com/api/job-board-api`
- RemoteOK and We Work Remotely RSS feeds
- Web-search queries for Indeed, LinkedIn, Glassdoor, EURES, France Travail, Arbeitsagentur, Sweden, Norway, Finland, JobStreet, JobsDB, Naukri, Foundit, Glints, VietnamWorks, TopCV, Japan, and Korea boards

## Enabled With Existing Search Key

- `SearchAPI Google Jobs` runs when `SEARCHAPI_KEY` is present.
- `SerpApi Google Jobs` can be enabled as an alternative when `SERPAPI_KEY` is present.
- Generic web-search sources fall back through SearchAPI/SerpApi, Brave, DuckDuckGo, and browser-backed search where available.

## Optional Keys

- `SEARCHAPI_KEY`: enables SearchAPI Google Jobs/search.
- `SERPAPI_KEY`: enables SerpApi Google Jobs/search.
- `THEIRSTACK_API_KEY` or `THEIR_STACK_API_KEY`: enables TheirStack.
- `ADZUNA_APP_ID` and `ADZUNA_APP_KEY`: enables Adzuna country-market searches.
- `JOOBLE_API_KEY`: enables Jooble REST API.
- `CAREERJET_AFFID` or `CAREERJET_AFFILIATE_ID`: enables Careerjet partner API.

## Restricted Big Platforms

- Indeed: no broad public job-search API for collecting all listings. Use partner routes or search discovery.
- LinkedIn: job APIs are restricted to approved partners and are not a public job-search feed.
- Glassdoor: public/legacy access is limited; treat as search discovery unless a partner feed is approved.

## Scanner Notes

- `api_aggregators` now supports `provider` values: `searchapi`, `serpapi`, `theirstack`, `adzuna`, `jooble`, `careerjet`, `remotive`, `jobicy`, `himalayas`, `arbeitnow`.
- `freelance_portals` is included in scan query execution.
- `/api/scan-sources` exposes companies, RSS feeds, search queries, freelance portals, and aggregators so the UI reflects the same sources the scanner executes.
- Source `name` values must be unique across all sections because scan state and cooldown use `name` as the key.
- API sources that require credentials should stay `enabled: false` until the matching environment variables exist.
- Remote filtering is intentionally strict: worldwide/global, Europe/EMEA/EU, Asia/APAC, Singapore, Hong Kong, Japan, Thailand, Dubai/UAE pass; US-only, Canada-only, LATAM, Americas, North America, and South America are rejected.
- Remote/geography evidence must come from extracted title, location, or remote text. URLs and domains are not proof, and `Global` in a title is not enough unless the listing also confirms worldwide/global remote.

## Adding A Source

For direct company tracking, add an entry to `tracked_companies` with `name`, `careers_url`, and optional `api` or `scan_query`.

For broad search, add a unique `name` and `query` to `search_queries`, `eu_job_boards`, or `freelance_portals`.

For public APIs, add an `api_aggregators` entry with a supported `provider`. Public providers can be enabled immediately; credentialed providers should stay disabled until the matching environment variables are configured.

For RSS feeds, add `name`, `url`, and `enabled` under `rss_feeds`. Keep the name unique even if there is already a search query for the same platform.
