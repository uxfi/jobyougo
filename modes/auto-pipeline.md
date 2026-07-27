# Mode: auto-pipeline - Lean Automatic Evaluation

When the user pastes a JD (text or URL) without an explicit sub-command, run the lean evaluation pipeline: extract the JD, create the A-E evaluation report, and update the tracker.

Do not generate a tailored CV/PDF, scan application forms, or draft application answers in this mode. Use `pdf`, `apply`, `question`, or `coverletter` only when the user explicitly asks.

## ⚠️ CRITICAL — Report Content Rules

**The report file MUST contain ONLY the structured A-E evaluation.** It must NEVER contain:
- Raw `<tool_call>` or `<tool_response>` XML
- Browser snapshot JSON
- Internal reasoning or planning text
- Placeholder headers like `# Evaluation — role` with `Score: —`

**Complete the FULL evaluation before creating the report file.** Do NOT create the file incrementally.

## Step 0 — Extract JD

If the input is a **URL** (not pasted JD text), use this priority order to extract content:

1. **Playwright (preferred):** Most job portals (Lever, Ashby, Greenhouse, Workday) are SPAs. Use `browser_navigate` + `browser_snapshot` to render and read the JD.
2. **WebFetch (fallback):** For static pages (ZipRecruiter, WeLoveProduct, company career pages).
3. **WebSearch (last resort):** Search role title + company on secondary portals that index the JD as static HTML.

**If no method works:** Ask the user to paste the JD manually or share a screenshot.

**If the input is JD text** (not a URL): use it directly, no fetch needed.

## Step 1 - A-E Evaluation

Run exactly as in the `oferta` mode (read `modes/oferta.md` for all A-E blocks):
- **Block B (Criteria Gate)** is the gatekeeper. If a hard deal-breaker fails, early-exit to the score and decision.
- If the JD cannot be loaded, do not produce a fake evaluation. Ask for the JD text or mark the item blocked.
- Do not create Block F or any application-answer fallback.

## Step 2 — Save Report .md

Save the full evaluation in `reports/{###}-{company-slug}-{YYYY-MM-DD}.md` (see format in `modes/oferta.md`).

**IMPORTANT: Build the ENTIRE report content in memory FIRST, then write it all at once.** Do NOT stream/append to the file. The file must be created with complete, validated content in a single write operation.

After writing, sync to Supabase:
```bash
node sync-supabase.mjs report reports/{###}-{company-slug}-{YYYY-MM-DD}.md
```

## Step 2b — Validate Report

Before continuing, verify that the written report:
1. Has `**Score:** X.X/5` (a real number, not `—`)
2. Has at least 2 A-E sections
3. Does NOT contain `<tool_call>`, `<tool_response>`, or raw browser_snapshot JSON

If validation fails, delete the file and restart the evaluation.

## Step 3 - Update Tracker

Register in `data/applications.md` with all columns including Report and PDF as `❌`.

**If any step fails**, continue with the following steps and mark the failed step as pending in the tracker.
