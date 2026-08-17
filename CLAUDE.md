@AGENTS.md

<!-- Add Claude Code-specific guidance here only when it has no AGENTS.md counterpart. -->

# jobyougo — fork-specific layer

This install is a fork of upstream career-ops (`uxfi/jobyougo`). Everything below
covers files and rules that exist ONLY here and have no counterpart in `AGENTS.md`.
Upstream updates do not manage them — `node update-system.mjs apply` leaves them
untouched, and their documentation lives here so it survives the next update.

## Local dev server

`ui/server.mjs` is the fork's web UI (portfolio + career dashboard), not upstream's
`dashboard/`. It serves on port 3210 (`PORT` env overrides).

```bash
npm run dev
```

It watches `reports/` for new files and, when Supabase is configured, boots in
`[Supabase]` mode. The `ui/`, `images/`, and `outputs/` trees belong to this server.

## Fork-only scripts

| File | Function |
|------|----------|
| `scan-fetch.mjs` | Deterministic scanner — Levels 2/4/5 (Greenhouse/Ashby/Lever boards, RSS, aggregator APIs). Distinct from upstream `scan.mjs`. |
| `lib/scan-filters.mjs` | Shared title/remote filter + dedup helpers (used by scan-fetch + verify) |
| `verify-scan-history.mjs` | Integrity check / repair (`--fix`) for `data/scan-history.tsv` |
| `verify-reports.mjs` | Validates report files are not corrupted |
| `purge-stale.mjs` | Retention purge across tracker/reports/scan-history (`--dry-run` supported) |
| `sync-supabase.mjs` | Pushes reports / pipeline / applications to Supabase |
| `supabase/schema.sql` | Supabase schema for the above |
| `migrate-admin.mjs` | One-off admin migration |
| `apply-runner.mjs` | Auto-apply: drives a VISIBLE Chrome through the application. Spawned by `POST /api/apply/start`, state in `scratch/apply-runs/{runId}/state.json`, commands (submit/rescan/abort) via `command.json` |
| `lib/apply-spec.mjs` | Builds the apply spec from a report: parses `**URL:**` + Section F Q&A, detects offer region (EU → Paris identity/CV, Asia → Bangkok identity/CV per `profile.yml` declared_policy), picks the CV PDF |
| `lib/openrouter.mjs`, `lib/pinchtab.mjs`, `lib/apply-llm.mjs` | Provider helpers for the scanner and apply runner |
| `modes/coverletter.md`, `modes/hrhv.md`, `modes/question.md` | Fork-only modes |

## Fork-only rules

- **After writing any report:** `node verify-reports.mjs`, then
  `node sync-supabase.mjs report reports/{filename}` (no-op if `USE_SUPABASE` unset).
- **To scan, run `node scan-fetch.mjs jobs` FIRST.** It owns the deterministic
  discovery levels (2/4/5) — fetch, remote+title filter, dedup, write `pipeline.md`
  + `scan-history.tsv`, update cooldown, and sync Supabase. The LLM/Playwright
  `scan` mode then only covers Level 1 (deep SPA scrape) and Level 3.
- **After each scan batch:** `node sync-supabase.mjs pipeline` (scan-fetch does this
  automatically).
- **After any status change in `applications.md`:** `node sync-supabase.mjs applications`.
- **`data/scan-history.tsv` is machine-managed** — never hand-append titles with raw
  newlines/tabs. Validate/repair with `node verify-scan-history.mjs --fix` (writes a
  `.bak` first).

## Deleting an application

**NEVER just remove a row from `applications.md`** — the scanner would re-discover
and re-add the offer. Instead:

1. Note the application's URL (from the report or `pipeline.md`).
2. Append to `data/scan-history.tsv`:
   `{url}\t{today}\tmanual-delete\t{role}\t{company}\tdeleted`
   If the URL is unknown, use `unknown:{company-slug}:{role-slug}`.
3. Append to `data/deleted-applications.tsv` (header: `company\trole\tdate_deleted\treason`):
   `{company}\t{role}\t{YYYY-MM-DD}\t{reason or "user_deleted"}`
4. **Set status to `Discarded` in `applications.md`** — do NOT remove the row.
5. `node sync-supabase.mjs applications`
6. Delete the report in `reports/` only if the user explicitly asks.

This makes future scans skip the offer permanently (URL-based and company+role
dedup) while keeping it visible in the tracker.

## Updating from upstream

`node update-system.mjs apply` overwrites the upstream system layer only. Two
fork-specific gotchas:

- The 7 `*/skills/career-ops/SKILL.md` files ship upstream as **symlinks**. Windows
  has no symlink support here, so the updater materializes them as real files and
  then reports them as "locally changed" on every run. That is expected — do not
  `--force` them.
- Keep this file's fork layer in sync when adding fork-only scripts, or the next
  update's `CLAUDE.md` overwrite will silently drop the documentation.
