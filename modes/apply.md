# Mode: apply — Live Application Assistant

Interactive mode to fill out a job application form. You share screenshots of the form, Claude generates copy-paste answers based on the existing report and CV.

## How it works

Claude does NOT control your browser. You open the form yourself, share screenshots, Claude reads them and generates answers ready to paste. You paste, scroll, share the next screenshot if needed.

**Required:** A report must exist in `reports/` for this offer (run auto-pipeline first if not).

## Workflow

```
1. LOAD      → Find the report for this offer in reports/
2. SCREENSHOT → You share a screenshot of the form (or paste questions as text)
3. ANALYZE   → Claude identifies all visible questions
4. GENERATE  → Claude generates a copy-paste answer for each question
5. ITERATE   → You scroll, share next screenshot, Claude continues
6. CONFIRM   → You send the application → Claude updates the tracker
```

## Step 1 — Find the report

You provide: company name, role title, or job URL.

Claude searches `reports/` (grep by company name), loads the full report + Section G (draft answers generated during evaluation if score was >= 4.5).

If no report exists:
> "No report found for [Company]. Run auto-pipeline first so I have context to generate good answers."

## Step 2 — Share the form

Three options (in order of preference):

1. **Screenshot** — take a screenshot of the form page, share the file path. Claude reads it with the Read tool (supports images).
2. **Paste questions** — copy the visible questions as text and paste them here.
3. **URL only** — Claude fetches the page with WebFetch. Works for static pages, not for SPAs or forms behind login.

## Step 3 — Analyze questions

For each visible question, classify it:

- **Free text** (cover letter, "why this role", "tell us about yourself") → generate a full answer
- **Dropdown** (how did you hear, work authorization, notice period) → suggest the value
- **Yes/No** (relocation, visa sponsorship) → answer based on profile.yml
- **Salary field** → use target range from `config/profile.yml`
- **Upload field** (resume, cover letter PDF) → remind which file to attach from `output/`

## Step 4 — Generate answers

For each free-text question:

1. Check if Section G already has a draft for this question → use it as base, refine
2. If no draft → generate from scratch using report (block B proof points, block F STAR stories) + cv.md
3. Apply "I'm choosing you" tone (see below)
4. Keep it specific: reference something real from the JD, something real from the candidate's experience

**Tone — "I'm choosing you"**

- Confident, not arrogant: "I've spent the past year building production AI agent systems — your role is where I want to apply that next."
- Selective, not pretentious: "I've been deliberate about finding a team where I can contribute meaningfully from day one."
- Specific and concrete: always reference something real from the JD and something real from experience
- Direct, no filler: 2–4 sentences per answer. No "I'm passionate about…" or "I would love the opportunity to…"
- Lead with proof, not claims: instead of "I'm great at X", say "I built X that does Y"

**Framework per question type:**
- **Why this role?** → "Your [specific thing] maps directly to [specific thing I built]."
- **Why this company?** → Mention something concrete. "I've been using [product] for [time/purpose]."
- **Relevant experience?** → One quantified proof point. "Built [X] that [metric]."
- **Good fit?** → "I sit at the intersection of [A] and [B], which is exactly where this role lives."
- **How did you hear?** → Honest: "Found it while researching AI companies in [region], evaluated it against my criteria."

**Output format:**

```
## Answers for [Company] — [Role]

Based on: Report #NNN | Score: X.X/5

---

### 1. [Exact question from the form]
> [Answer ready to paste]

### 2. [Next question]
> [Answer]

---

Notes:
- [Anything to double-check or personalize before sending]
```

## Step 5 — Iterate

If the form has more questions below the fold:
- Scroll down, take another screenshot, share it
- Claude continues generating answers for the new questions

Repeat until the full form is covered.

## Step 6 — Post-apply

Once you confirm the application was sent:
1. Update `data/applications.md`: status `Evaluated` → `Applied`
2. Update Section G of the report with the final answers used
3. Suggest next step: `/career-ops contacto` for LinkedIn outreach to someone at the company
