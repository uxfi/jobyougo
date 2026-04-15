# Mode: pipeline — URL Inbox (Second Brain)

Processes job URLs accumulated in `data/pipeline.md`. The user adds URLs at any time and then runs `/career-ops pipeline` to process them all.

## CRITICAL — Report Integrity Rules

**NEVER write raw tool_call, tool_response, browser_snapshot JSON, or internal reasoning into a report file.**

A report file in `reports/` MUST contain ONLY the structured A-F evaluation output (see `modes/oferta.md`). If the evaluation hasn't been completed yet, DO NOT create the report file.

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
2. **For each pending URL**:
   a. Calculate next sequential `REPORT_NUM` (read `reports/`, take highest number + 1)
   b. **Extract JD** using Playwright (browser_navigate + browser_snapshot) → WebFetch → WebSearch
   c. If the URL is not accessible → mark as `- [!]` with a note and continue
   d. **Run full auto-pipeline** following score thresholds:
      - **score < 3.0** → Report .md only. No PDF. Tracker status: `SKIP`
      - **score 3.0–4.4** → Report .md + PDF. Tracker status: `Evaluated`
      - **score >= 4.5** → Report .md + PDF + Draft application answers. Tracker status: `Evaluated`
   e. **Validate report** before proceeding: check that the file does NOT contain raw logs (tool_call, JSON, etc.)
   f. **Move from "Pending" to "Processed"**: `- [x] #NNN | URL | Company | Role | Score/5 | PDF ✅/❌`
3. **Process sequentially** — one URL at a time. Complete the ENTIRE A-F evaluation for each URL, write the report, then move to the next. DO NOT run parallel agents as they risk writing raw logs into reports.
4. **Upon completion**, show summary table:

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
