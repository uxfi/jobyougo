# Mode: pipeline — URL Inbox (Second Brain)

Processes job URLs accumulated in `data/pipeline.md`. The user adds URLs at any time and then runs `/career-ops pipeline` to process them all.

## CRITICAL — Report Integrity Rules

**NEVER write raw tool_call, tool_response, browser_snapshot JSON, or internal reasoning into a report file.**

A report file in `reports/` MUST contain ONLY the structured A-E evaluation output (see `modes/oferta.md`). If the evaluation hasn't been completed yet, DO NOT create the report file.

**Validation checklist before writing any report:**
1. ✅ Report starts with `# Evaluation: {Company} — {Role}`
2. ✅ Report has `**Score:** X.X/5` (a real number, not `—`)
3. ✅ Report has at least sections A, B, C with real content
4. ✅ Report does NOT contain `<tool_call>`, `<tool_response>`, `browser_snapshot`, or raw JSON
5. ✅ Report has `**URL:**` field in header

If ANY of these fail, DO NOT write the file. Fix the content first.

**After writing reports, run validation:** `node verify-reports.mjs`

## Workflow

1. **Read** `data/pipeline.md` → search for `- [ ]` items in the "Pending" section
2. **Selection step (MANDATORY)** — let the user tick the offers to scan, one by one, with checkboxes. Use the `AskUserQuestion` tool with `multiSelect: true`.

   - **0 pending URLs** → tell the user and stop.
   - **1–4 pending URLs** → ONE `AskUserQuestion` call. `question`: `"Quelles offres scanner ?"`. `header`: `"Offres"`. `multiSelect: true`. One option per pending URL: `label` = `"{company} — {title}"` (≤ 60 chars, truncate with `…`), `description` = the URL. The user ticks the ones to process.
   - **5+ pending URLs** → paginate in batches of 4. Ask multiple questions in the SAME `AskUserQuestion` call (up to 4 questions per call, 4 options each = 16 URLs per round). For each question: `question` = `"Lot N/M — coche les offres à scanner"`, `header` = `"Lot N/M"`, `multiSelect: true`, options = up to 4 URLs from that batch. If more than 16 URLs, do successive `AskUserQuestion` calls until all batches are covered. Always cap at 4 questions per call and 4 options per question — these are hard schema limits.
   - **Skipping a batch** → if the user picks nothing in a batch, that's a valid "none from this batch", continue to the next batch.
   - **Bypass the picker** — if the user explicitly invokes the mode with a selection (e.g. `/career-ops pipeline 1,3-5` or `/career-ops pipeline all`), skip the picker and use that selection directly. Indices are 1-based against the pending list at read time.
   - **Empty selection across all batches** → tell the user "Rien à scanner." and stop.

3. **For each URL in the selection** (in the order given):
   a. Calculate next sequential `REPORT_NUM` (read `reports/`, take highest number + 1)
   b. **Extract JD** using Playwright (browser_navigate + browser_snapshot) → WebFetch → WebSearch
   c. If the URL is not accessible → mark as `- [!]` with a note and continue
   d. **Run lean auto-pipeline** following score thresholds:
      - **Deal-breaker hit (Block B)** → early exit. Report .md only. No PDF, no form scan. Tracker status: `SKIP`
      - **score < 3.0** → Report .md only. No PDF. Tracker status: `SKIP`
      - **score >= 3.0** → Report .md only. No PDF and no form scan. Tracker status: `Evaluated`
   e. **Validate report** before proceeding: check that the file does NOT contain raw logs (tool_call, JSON, etc.)
   f. **Move from "Pending" to "Processed"**: `- [x] #NNN | URL | Company | Role | Score/5 | PDF ✅/❌`
4. **Process sequentially** — one URL at a time within the selection. Complete the ENTIRE A-E evaluation for each URL, write the report, then move to the next. DO NOT run parallel agents as they risk writing raw logs into reports.
5. **URLs not in the selection stay pending** — do not touch them, do not move them to "Processed".
6. **Upon completion**, show summary table (only for the URLs scanned in this run):

```
| # | Company | Role | Score | PDF | Recommended action |
```

## pipeline.md Format

```markdown
## Pending
- [ ] https://jobs.example.com/posting/123
- [ ] https://boards.greenhouse.io/company/jobs/456 | Company Inc | Senior PM
- [!] https://private.url/job — Error: login required

## Processed
- [x] #143 | https://jobs.example.com/posting/789 | Acme Corp | AI PM | 4.2/5 | PDF ✅
- [x] #144 | https://boards.greenhouse.io/xyz/jobs/012 | BigCo | SA | 2.1/5 | PDF ❌
```

## Smart JD Detection from URL

1. **Playwright (preferred):** `browser_navigate` + `browser_snapshot`. Works with all SPAs.
2. **WebFetch (fallback):** For static pages or when Playwright is unavailable.
3. **WebSearch (last resort):** Search on secondary portals that index the JD.

**Special cases:**
- **LinkedIn**: May require login → mark `[!]` and ask user to paste text
- **PDF**: If URL points to a PDF, read it directly with Read tool
- **`local:` prefix**: Read local file. Example: `local:jds/linkedin-pm-ai.md` → read `jds/linkedin-pm-ai.md`

## Automatic Numbering

1. List all files in `reports/`
2. Extract number from prefix (e.g., `142-medispend...` → 142)
3. New number = maximum found + 1

## Source Synchronization

Before processing any URL, verify sync:
```bash
node cv-sync-check.mjs
```
If out of sync, warn the user before continuing.
