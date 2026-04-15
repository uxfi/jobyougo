# Mode: auto-pipeline — Full Automatic Pipeline

When the user pastes a JD (text or URL) without an explicit sub-command, run the FULL pipeline in sequence.

## ⚠️ CRITICAL — Report Content Rules

**The report file MUST contain ONLY the structured A-F evaluation.** It must NEVER contain:
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

## Step 1 — A-F Evaluation

Run exactly as in the `oferta` mode (read `modes/oferta.md` for all A-F blocks).

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
2. Has at least 2 A-F sections
3. Does NOT contain `<tool_call>`, `<tool_response>`, or raw browser_snapshot JSON

If validation fails, delete the file and restart the evaluation.

## Step 3 — Generate PDF (only if score >= 3.0)

**If score < 3.0:** Skip PDF. Set tracker status to `SKIP`. Stop here — do not proceed to Step 4.

If score >= 3.0: Run the full `pdf` pipeline (read `modes/pdf.md`).

## Step 4 — Draft Application Answers (only if score >= 4.5)

If the final score is >= 4.5, generate draft answers for the application form:

1. **Extract form questions**: Use Playwright to navigate to the form and snapshot it. If unavailable, use generic questions below.
2. **Generate answers** following the tone guidelines below.
3. **Save in the report** as section `## G) Draft Application Answers`.

### Generic questions (use if form can't be extracted)

- Why are you interested in this role?
- Why do you want to work at [Company]?
- Tell us about a relevant project or achievement
- What makes you a good fit for this position?
- How did you hear about this role?

### Answer tone

**Stance: "I'm choosing you."** — the candidate has options and is choosing this company for concrete reasons.

**Rules:**
- **Confident, not arrogant**: "I've spent the past year building production AI agent systems — your role is where I want to apply that experience next"
- **Selective, not superior**: "I've been intentional about finding a team where I can contribute meaningfully from day one"
- **Specific and concrete**: Always reference something REAL from the JD or company, and something REAL from the candidate's experience
- **Direct, no filler**: 2-4 sentences per answer. No "I'm passionate about..." or "I would love the opportunity to..."
- **Lead with proof, not claims**: Instead of "I'm great at X", say "I built X that does Y"

**Framework per question:**
- **Why this role?** → "Your [specific thing] maps directly to [specific thing I built]."
- **Why this company?** → Cite something concrete about the company. "I've been using [product] for [time/purpose]."
- **Relevant experience?** → One quantified proof point. "Built [X] that [metric]."
- **Good fit?** → "I sit at the intersection of [A] and [B], which is exactly where this role lives."
- **How did you hear?** → Honest: "Found through [portal/scan], evaluated against my criteria, and it scored highest."

**Language**: Always match the JD language (EN default).

## Step 5 — Update Tracker

Register in `data/applications.md` with all columns including Report and PDF as ✅.

**If any step fails**, continue with the following steps and mark the failed step as pending in the tracker.
