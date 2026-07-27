# Mode: scan — Portal Scanner (Job & Mission Discovery)

Scans configured job/mission portals, filters by title relevance, and adds new offers to the pipeline for later evaluation.

## Scan Mode Selection (FIRST STEP — MANDATORY)

Before doing anything else, ask the user which type of scan to run:

> "Quel type de scan ? `jobs` (postes salariés) ou `missions` (freelance) ?"

Accepted answers:
- `jobs`, `job`, `salaried`, `salarié`, empty/no answer → **jobs mode**
- `missions`, `mission`, `freelance`, `contract` → **missions mode**

Mode determines which sources are scanned:

| Mode | Sources scanned |
|------|-----------------|
| `jobs` | `tracked_companies` (Level 1+2) + `search_queries` + `eu_job_boards` (Level 3) + `rss_feeds` (Level 4) + `api_aggregators` (Level 5). **Excludes `freelance_portals`.** |
| `missions` | `freelance_portals` only. All other source lists are skipped. |

The two modes are strictly disjoint to avoid overlap. If the user wants both, run two separate scans.

## Recommended Execution

Run as a subagent to avoid consuming main context:

```
Agent(
    subagent_type="general-purpose",
    prompt="[content of this file + specific data]",
    run_in_background=True
)
```

## Configuration

Read `portals.yml` which contains:
- `search_queries`: List of WebSearch queries with `site:` filters per portal (broad discovery)
- `eu_job_boards`: Europe/Asia public and commercial job-board WebSearch queries
- `freelance_portals`: Freelance/contract WebSearch queries, executed like `search_queries`
- `tracked_companies`: Specific companies with `careers_url` for direct navigation
- `rss_feeds`: Public RSS/XML feeds
- `api_aggregators`: Aggregator/public API sources with a `provider`
- `title_filter`: Keywords (positive/negative/seniority_boost) for title filtering
- `remote_filter`: Strict remote policy. Only explicit full-remote offers may pass.

## Discovery Strategy (5 Levels)

### ⚡ Levels 2, 4, 5 are now DETERMINISTIC — run `scan-fetch.mjs` FIRST

Before doing any LLM/Playwright work, run the deterministic scanner:

```bash
node scan-fetch.mjs jobs           # or: node scan-fetch.mjs jobs --dry-run   to preview
```

It handles **Level 2 (Greenhouse / Ashby / Lever boards), Level 4 (RSS), Level 5 (aggregator APIs)** in code: fetch → **freshness cutoff** (`scan_max_age_days` in portals.yml; jobs with no date are kept; `--max-age=N` / `0` to override) → remote filter → title filter → dedup (against scan-history.tsv + pipeline.md + applications.md + deleted-applications.tsv) → append to `pipeline.md` + `scan-history.tsv` (TSV-safe) → update `data/scan-state.json` (24h cooldown per source) → `sync-supabase.mjs pipeline`. Remote filter honors `remote_filter.ambiguous_policy` (kept for worldwide remote-only boards, required-explicit-geo for company boards) and the expanded EU/Asia `allowed_geo_any`. Filtering/dedup logic lives in `lib/scan-filters.mjs`. Use `--source="NAME"` for one source (bypasses cooldown), `--max=N` to cap new offers, `--debug` for per-source counts.

**After it runs, the LLM only needs Levels 1 and 3** (below) — the parts that genuinely need a browser or open-web discovery:
- **Level 1 (Playwright)** — deep scrape of `tracked_companies` SPAs (catches roles the strict deterministic remote filter skips as ambiguous).
- **Level 3 (WebSearch)** — discover NEW companies not yet in `tracked_companies`, and **all `missions` (freelance) scanning** (scan-fetch does not handle missions).

`scan-fetch.mjs` records only `added` rows in `scan-history.tsv` (re-filtering is free in code, so it does not bloat the file with `skipped_*` rows). It never hand-writes titles, so the newline/tab corruption that broke scan-history in the past cannot recur. Validate/repair the file anytime with `node verify-scan-history.mjs --fix`.

### Level 1 — Direct Playwright (PRIMARY)

**For every company in `tracked_companies`:** Navigate to their `careers_url` using Playwright (`browser_navigate` + `browser_snapshot`), read ALL visible job listings, and extract title + URL for each. This is the most reliable method because:
- Sees the page in real-time (not cached Google results)
- Works with SPAs (Ashby, Lever, Workday)
- Detects new offers instantly
- Does not depend on Google indexing

**Every company MUST have a `careers_url` in portals.yml.** If missing, search for it once, save it, and use it in future scans.

### Level 2 — Greenhouse API (COMPLEMENTARY)

For companies using Greenhouse, the JSON API (`boards-api.greenhouse.io/v1/boards/{slug}/jobs`) returns clean structured data. Use as a fast complement to Level 1 — it's faster than Playwright but only works with Greenhouse.

### Level 3 — WebSearch Queries (BROAD DISCOVERY)

`search_queries`, `eu_job_boards`, and `freelance_portals` with `site:` filters cover portals across companies (all Ashby, all Greenhouse, Indeed, LinkedIn, Glassdoor, EURES, national boards, Asia boards, freelance marketplaces, etc.). Useful for discovering NEW companies not yet in `tracked_companies`, though results may be outdated.

### Level 4 — RSS Feeds (REAL-TIME UPDATES)

Read sources from the `rss_feeds` list in `portals.yml` (e.g., Jobicy, Himalayas, RemoteOK, We Work Remotely, Authentic Jobs). This is the fastest method to integrate without blocks, searching XML directly. Extract `{title, url, company, location_text, remote_text, published_at}` when available.

### Level 5 — Aggregator APIs (MASSIVE COVERAGE)

Read APIs defined in the `api_aggregators` list in `portals.yml`. Supported providers are `searchapi`, `serpapi`, `theirstack`, `adzuna`, `jooble`, `careerjet`, `remotive`, `jobicy`, `himalayas`, and `arbeitnow`.

Public providers (`remotive`, `jobicy`, `himalayas`, `arbeitnow`) can run without credentials. Credentialed providers require their matching environment variables and should stay disabled until configured.

**Execution Priority:**

In **`jobs` mode**:
0. **`node scan-fetch.mjs jobs`** → Levels 2 (Greenhouse/Ashby/Lever), 4 (RSS), 5 (aggregator APIs), with filtering + dedup + writes handled in code. **Do this first.**
1. Level 1: Playwright → all `tracked_companies` with `careers_url` (deeper than the API; catches ambiguous-remote roles)
2. Level 3: WebSearch → all `search_queries` and `eu_job_boards` with `enabled: true` to discover NEW companies (NOT `freelance_portals`)

(Levels 2, 4, 5 are no longer run by hand — `scan-fetch.mjs` owns them.)

In **`missions` mode**:
- Only Level 3: WebSearch → all `freelance_portals` with `enabled: true`. Levels 1, 2, 4, 5 are skipped.

Within the selected mode, levels are additive — all are executed, results are merged and deduplicated.

## Workflow

**CRITICAL RULE - BATCH PROCESSING (BULK OF 20):**
Because `portals.yml` contains a massive list of entries, you MUST NOT scan everything in a single run. You will run out of context or timeout.
Instead, you must segment the work in **bulks of 20 maximum items** (across all sources: queries, companies, feeds):
- Scan your 20 items.
- Write/append the results to `pipeline.md` and `scan-history.tsv`.
- Stop and ask the user: *"Batch X complete (20 items processed). Y items remaining. Proceed to next batch?"*

0. **Determine scan mode**: ask the user (`jobs` or `missions`) — see "Scan Mode Selection" above. The mode gates which source lists are read in subsequent steps.
1. **Read config**: `portals.yml` (including `remote_filter`). In `missions` mode, only `freelance_portals`, `title_filter`, and `remote_filter` are needed; ignore `tracked_companies`, `search_queries`, `eu_job_boards`, `rss_feeds`, `api_aggregators`.
2. **Read history**: `data/scan-history.tsv` → URLs already seen
3. **Read dedup sources**: `data/applications.md` + `data/pipeline.md`
4. **Read scan state**: `data/scan-state.json` → last scan timestamp per source (create if missing: `{}`)
5. **Apply cooldown filter (24h)**: For each source eligible in the current mode (see table above), check `scan-state.json`. If `last_scanned` exists and is less than 24 hours ago, **skip that source entirely** — do not scan it, do not count it in the batch. Print a summary of skipped sources at the start:
   > `⏭ Skipped (cooldown): Vercel (3h ago), Ashby — AI PM EU (11h ago), ...`
   > `→ X sources eligible for scan today.`
   If ALL sources are within cooldown, tell the user and stop:
   > `All sources were scanned in the last 24h. Nothing to do. Next scan available at {earliest_next_time}.`
6. **Identify the next 20 items** (enabled: true, cooldown not active, **eligible in current mode**) that haven't been processed in the current session.

5. **Execute the assigned batch of 20** (following the method rules below):
6. **Level 1 — Playwright scan** (parallel in batches of 3-5) — **`jobs` mode only, skip in `missions`**:
   For each company in `tracked_companies` with `enabled: true` and defined `careers_url` (up to the batch limit):
   a. `browser_navigate` to `careers_url`
   b. `browser_snapshot` to read all job listings
   c. If the page has filters/departments, navigate relevant sections
   d. For each job listing extract: `{title, url, company, location_text, remote_text}` whenever visible
   e. If the page paginates results, navigate additional pages
   f. Accumulate in candidate list
   g. If `careers_url` fails (404, redirect), try `scan_query` as fallback and note for URL update

7. **Level 2 — Greenhouse APIs** (parallel) — **`jobs` mode only, skip in `missions`**:
   For each company in `tracked_companies` with defined `api:` and `enabled: true`:
   a. WebFetch the API URL → JSON with job list
   b. For each job extract: `{title, url, company, location_text, remote_text}` from API fields when available
   c. Accumulate in candidate list (dedup with Level 1)

6. **Level 3 — WebSearch queries** (parallel if possible):
   - In `jobs` mode: iterate `search_queries` and `eu_job_boards` with `enabled: true`. Skip `freelance_portals`.
   - In `missions` mode: iterate **only** `freelance_portals` with `enabled: true`. Skip `search_queries` and `eu_job_boards`.

   For each query selected:
   a. Execute WebSearch with the defined `query`
   b. From each result extract: `{title, url, company, location_text, remote_text}`
      - **title**: from the result title (before " @ " or " | ")
      - **url**: result URL
      - **company**: after " @ " in title, or extract from domain/path
      - If remote status is not explicit in the title/snippet, open the job URL and inspect the listing page before keeping the result
   c. Accumulate in candidate list (dedup with Level 1+2)

7. **Level 4 — RSS Feeds** (parallel) — **`jobs` mode only, skip in `missions`**:
   For each feed in `rss_feeds` with `enabled: true`:
   a. Fetch the feed URL (RSS/XML/JSON).
   b. Parse new offers and extract `{title, url, company, location_text, remote_text}`.
   c. Accumulate in candidate list (dedup with Level 1-3).

8. **Level 5 — Aggregator APIs** (parallel) — **`jobs` mode only, skip in `missions`**:
   For each API in `api_aggregators` with `enabled: true`:
   a. Dispatch by `provider` when available; request `api_url` if the provider needs one.
   b. Extract `{title, url, company, location_text, remote_text}` for AI / Agentic / Product positions.
   c. Accumulate in candidate list (dedup with Levels 1-4).

   Supported environment variables:
   - `SEARCHAPI_KEY` for SearchAPI Google Jobs/search
   - `SERPAPI_KEY` for SerpApi Google Jobs/search
   - `THEIRSTACK_API_KEY` or `THEIR_STACK_API_KEY` for TheirStack
   - `ADZUNA_APP_ID` and `ADZUNA_APP_KEY` for Adzuna
   - `JOOBLE_API_KEY` for Jooble
   - `CAREERJET_AFFID` or `CAREERJET_AFFILIATE_ID` for Careerjet

9. **Apply remote filter FIRST** using `remote_filter` from `portals.yml`:
   - Keep ONLY offers explicitly marked as full remote / fully remote / remote-first / distributed / work-from-anywhere AND geographically compatible.
   - Compatible full-remote geographies: worldwide/global, Europe/EMEA/EU/EEA, Asia/APAC/ASEAN, Singapore, Hong Kong, Japan, Thailand, Dubai/UAE, or explicit compatible countries/cities in `allowed_geo_any`.
   - Reject remote geographies that are US-only, Canada-only, LATAM/Latin America, Americas, North America, or South America, even when the listing says `fully remote`.
   - Reject offers marked `hybrid`, `on-site`, `onsite`, `office-based`, `in office`, `relocation required`, or any listing with mandatory office attendance
   - Reject offers that only list a city/country with no explicit remote wording
   - Do not use the URL/domain as evidence for remote or geography. A URL containing `remote` or `.eu` is not enough.
   - Do not treat `Global` in a job title as a geography by itself. It must appear in location/remote evidence, or the title must explicitly say something like `Remote Global` / `Global Remote`.
   - For WebSearch/RSS/API results, if remote status is unclear from metadata, open the job page and verify it before keeping the offer
   - If remote status is still ambiguous after verification, skip it conservatively

10. **Filter by title** using `title_filter` from `portals.yml`:
   - At least 1 `positive` keyword must appear in the title (case-insensitive)
   - 0 `negative` keywords must appear
   - `seniority_boost` keywords give priority but are not mandatory

11. **Deduplicate** against 4 sources:
    - `scan-history.tsv` → Exact URL already seen (includes `deleted` status — never re-add)
    - `applications.md` → Normalized company + role already evaluated
    - `pipeline.md` → Exact URL already pending or processed
    - `data/deleted-applications.tsv` → Company + role permanently excluded (deleted applications). If this file exists, skip any offer whose normalized company+role matches an entry here.

12. **For each new offer passing filters**:
    a. Add to `pipeline.md` in "Pending" section: `- [ ] {url} | {company} | {title}`
    b. Register in `scan-history.tsv`: `{url}\t{date}\t{query_name}\t{title}\t{company}\tadded`

13. **After writing to `pipeline.md`** (end of each batch), sync to Supabase:
    ```bash
    node sync-supabase.mjs pipeline
    ```
    This is a no-op if `USE_SUPABASE` is not set — always safe to run.

14. **Offers filtered by remote policy**: register in `scan-history.tsv` with status `skipped_remote`
14. **Offers filtered by title**: register in `scan-history.tsv` with status `skipped_title`
15. **Duplicate offers**: register with status `skipped_dup`
16. **After scanning each source**: update `data/scan-state.json` immediately with the current ISO timestamp:
    ```json
    { "Vercel": "2026-04-07T14:32:00Z", "Ashby — AI PM EU": "2026-04-07T14:35:00Z" }
    ```
    Use the source's `name` field as the key. Write the file after each source (not at the end) so a crash mid-scan doesn't lose the cooldown state.

## Title and Company Extraction (WebSearch results)

WebSearch results come in format: `"Job Title @ Company"` or `"Job Title | Company"` or `"Job Title — Company"`.

Extraction patterns by portal:
- **Ashby**: `"Senior AI PM (Remote) @ EverAI"` → title: `Senior AI PM`, company: `EverAI`
- **Greenhouse**: `"AI Engineer at Anthropic"` → title: `AI Engineer`, company: `Anthropic`
- **Lever**: `"Product Manager - AI @ Temporal"` → title: `Product Manager - AI`, company: `Temporal`

Generic Regex: `(.+?)(?:\s*[@|—–-]\s*|\s+at\s+)(.+?)$`

## Private URLs

If a non-publicly accessible URL is found:
1. Save JD to `jds/{company}-{role-slug}.md`
2. Add to pipeline.md as: `- [ ] local:jds/{company}-{role-slug}.md | {company} | {title}`

## Scan History

`data/scan-history.tsv` tracks ALL seen URLs:

```
url	first_seen	portal	title	company	status
https://...	2026-02-10	Ashby — AI PM	PM AI	Acme	added
https://...	2026-02-10	Greenhouse — SA	Staff Product	ExampleCo	skipped_remote
https://...	2026-02-10	Greenhouse — SA	Junior Dev	BigCo	skipped_title
https://...	2026-02-10	Ashby — AI PM	SA AI	OldCo	skipped_dup
```

## Output Summary (At the end of each Bulk of 20)

```
Portal Scan — Mode: {jobs|missions} — Batch X — {YYYY-MM-DD}
━━━━━━━━━━━━━━━━━━━━━━━━━━
Items processed in this bulk: 20
Offers found: N total
Filtered by remote: N strict full-remote only
Filtered by title: N relevant
Duplicates: N (already evaluated or in pipeline)
New added to pipeline.md: N

  + {company} | {title} | {query_name}
  ...

→ Batch complete. Proceed to next bulk of 20? (Type 'yes')
```

## Careers URL Management

Every company in `tracked_companies` should have a `careers_url` — the direct link to their job board. This avoids searching every time.

**Known platform patterns:**
- **Ashby:** `https://jobs.ashbyhq.com/{slug}`
- **Greenhouse:** `https://job-boards.greenhouse.io/{slug}` or `https://job-boards.eu.greenhouse.io/{slug}`
- **Lever:** `https://jobs.lever.co/{slug}`
- **Custom:** Company's own URL (e.g., `https://openai.com/careers`)

**If `careers_url` missing** for a company:
1. Try the known platform pattern
2. If fails, perform quick WebSearch: `"{company}" careers jobs`
3. Navigate with Playwright to confirm it works
4. **Save the found URL in portals.yml** for future scans

**If `careers_url` returns 404 or redirect:**
1. Note in output summary
2. Try scan_query as fallback
3. Mark for manual update

## portals.yml Maintenance

- **ALWAYS save `careers_url`** when adding a new company
- Add new queries as interesting portals or roles are discovered
- Deactivate queries with `enabled: false` if they generate too much noise
- Adjust filtering keywords as target roles evolve
- Add companies to `tracked_companies` when you want to track them closely
- Periodically verify `careers_url` — companies change ATS platforms
