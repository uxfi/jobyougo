# Free Job APIs For JobYouGo

Last checked: 2026-09-04.

This file separates free sources that can run directly in `scan.mjs` from free
sources that still require an issued key, OAuth client, or partner approval.

## Integrated In `scan.mjs`

These are configured under `job_boards:` in `portals.yml` and resolve through
`providers/*.mjs`.

| Region | Source | Provider | Auth | Notes |
| --- | --- | --- | --- | --- |
| Global remote | Remotive | `remotive` | none | Public remote jobs API. |
| Global remote / EMEA / APAC | Jobicy | `jobicy` | none | Public remote jobs API. |
| Global remote | Himalayas | `himalayas` | none | Public remote jobs API. |
| Europe / DACH | Arbeitnow | `arbeitnow` | none | Public Europe-heavy job-board API. |
| Global remote | RemoteOK | `remoteok` | none | Public JSON API replacing retired RSS category feeds. |
| Global remote | We Work Remotely | `weworkremotely` | none | Public RSS feed. |
| Global remote | Working Nomads | `workingnomads` | none | Public JSON feed. |
| Global remote | NoDesk | `nodesk` | none | Public RSS feed. |
| Global remote | Jobspresso | `jobspresso` | none | Public RSS feed. |
| Global remote | 4 Day Week | `4dayweek` | none | Public JSON API for reduced-hours and remote roles. |
| AI / agentic roles | Agentic Engineering Jobs | `agentic-jobs` | none | Public REST API. |
| ATS aggregate | EchoJobs | `echojobs` | none | Public API; rows point back to original ATS jobs. |
| Startup portfolios | a16z Speedrun Talent Network | `a16z-speedrun-talent` | none | Public API, narrowed with `q: AI` and page capped. |
| ATS aggregate | Flowxtra Central Jobs | `flowxtra` | none | Public cross-tenant live jobs API. |
| Global | The Muse | `themuse` | none | Public jobs API; `max_pages` keeps scans bounded. |
| Web3 remote | CryptocurrencyJobs | `cryptocurrencyjobs` | none | Public remote-only RSS feed. |
| Tech niche | LaraJobs | `larajobs` | none | Public Laravel/PHP RSS feed. |
| Higher education | HigherEdJobs | `higheredjobs` | none | Public RSS category feed. |
| GitHub/Hugging Face discovery | Hugging Face Open Apply Jobs | `huggingface-openapply` | none | Public HF dataset via datasets-server; bounded to avoid scanning the full dataset. |
| Startups | Hacker News Who Is Hiring | `hackernews` | none | Public Algolia HN API. |
| Nordics / EU | The Hub | `thehub` | none | Public API with EU and remote passes. |
| Europe tech | Landing.jobs | `landingjobs` | none | Public tech jobs API. |
| Europe | Welcome to the Jungle | `wttj` | none | Public Algolia index; client key is resolved from WTTJ's public env endpoint. |
| Spain / Europe | getManfred | `manfred` | none | Public API; keeps ACTIVE offers only. |
| Poland / Europe tech | JustJoin.it | `justjoin` | none | Public candidate offers API. |
| Europe tech | No Fluff Jobs | `nofluffjobs` | none | Public search posting API. |
| Switzerland remote | Remotli | `remotli` | none | Public API; emits employer apply URLs when available. |
| Germany | Bundesagentur fuer Arbeit | `arbeitsagentur` | public client key | Official Jobsuche REST API used by the public site. |
| Sweden | JobTech / Arbetsformedlingen | `jobtech` | none | Official search API with free-text, remote, limit, and offset. |
| Norway | NAV Arbeidsplassen | `nav` | rotating public token | Official vacancy feed; supports If-Modified-Since and detail entries. |
| Belgium / Flanders | VDAB | `vdab` | public frontend key | Public search/detail endpoints with bounded detail enrichment. |
| France | France Travail | `francetravail` | none | Public candidate search HTML at candidat.francetravail.fr. The partner OAuth API stays unused. |
| Southeast Asia | Glints SG/ID/VN | `glints` | none | Public GraphQL job-search endpoint. |
| Southeast Asia | JobStreet SG/MY/ID | `jobstreet` | none | Public SEEK/JobStreet v5 search API. |
| Taiwan | Taiwan Jobs Open Data | `taiwanjobs` | none | Official open-data datastore, filtered locally. |
| Remote fallback | Get on Board | `getonbrd` | none | Public tech jobs API; lower Europe/Asia focus but useful as a fallback. |

## Free But Not Auto-Enabled

These are useful for JobYouGo but are not active in `providers/` because the
core provider layer is intended for zero-auth/public endpoints.

| Region | Source | Why not enabled by default |
| --- | --- | --- |
| South Korea | Work24 / work.go.kr Open API | Free public employment API, but requires an issued service key/account approval. |
| Finland | Job Market Finland / KEHA interfaces | Free interfaces exist, but credentials are issued after verification/testing. |
| Global | Adzuna, Jooble, Careerjet | Free or partner tiers may exist, but they require API keys and are already disabled under `api_aggregators`. |

## Runtime Notes

- `scan.mjs` reads `job_boards:` and `tracked_companies:`. The older
  `api_aggregators:` block (plus `rss_feeds:`) is only consumed by the UI
  server's own scanner now — `scan-fetch.mjs` was removed.
- `location_filter:` is now set to prefer Europe/Asia/global remote listings
  and block US/Canada/Americas-only locations.
- Hugging Face is intentionally bounded (`length` and `max_pages`) because the
  source dataset is large and should be treated as discovery, not a full mirror.
