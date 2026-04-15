# Mode: oferta — Full A-F Evaluation

When the candidate pastes an offer (text or URL), ALWAYS deliver the 6 blocks:

## Step 0 — Archetype Detection

Classify the offer into one of the 6 archetypes (see `_shared.md`). If it's a hybrid, indicate the 2 closest ones. This determines:
- Which proof points to prioritize in Block B
- How to rewrite the summary in Block E
- Which STAR stories to prepare in Block F

## Block A — Role Summary

Table with:
- Detected Archetype
- Domain (platform/agentic/LLMOps/ML/enterprise)
- Function (build/consult/manage/deploy)
- Seniority
- Remote (full/hybrid/onsite)
- Team size (if mentioned)
- TL;DR in 1 sentence

## Block B — Match with CV

Read `cv.md`. Create a table with each JD requirement mapped to exact lines from the CV.

**Adapted to archetype:**
- If FDE → prioritize fast delivery and client-facing proof points
- If SA → prioritize systems design and integrations
- If PM → prioritize product discovery and metrics
- If LLMOps → prioritize evals, observability, pipelines
- If Agentic → prioritize multi-agent, HITL, orchestration
- If Transformation → prioritize change management, adoption, scaling

**Gaps** section with mitigation strategy for each. For every gap:
1. Is it a hard blocker or a nice-to-have?
2. Can the candidate demonstrate adjacent experience?
3. Is there a portfolio project covering this gap?
4. Concrete mitigation plan (sentence for cover letter, quick project, etc.)

## Block C — Level and Strategy

1. **Level detected** in the JD vs **candidate's natural level for that archetype**
2. **"Sell senior without lying" plan**: specific phrases adapted to the archetype, concrete achievements to highlight, how to position founder experience as an advantage
3. **"If they downlevel me" plan**: accept if comp is fair, negotiate 6-month review, clear promotion criteria

## Block D — Comp and Demand

Use WebSearch for:
- Current salaries for the role (Glassdoor, Levels.fyi, Blind)
- Company's compensation reputation
- Role demand trend

Table with data and cited sources. If no data, state it rather than inventing.

## Block E — Customization Plan

| # | Section | Current state | Proposed change | Rationale |
|---|---------|---------------|-----------------|-----------|
| 1 | Summary | ... | ... | ... |
| ... | ... | ... | ... | ... |

Top 5 changes to CV + Top 5 changes to LinkedIn to maximize match.

## Block F — Interview Plan

6-10 STAR+R stories mapped to JD requirements (STAR + **Reflection**):

| # | JD Requirement | STAR+R Story | S | T | A | R | Reflection |
|---|-----------------|--------------|---|---|---|---|------------|

The **Reflection** column captures what was learned or what would be done differently. This signals seniority — junior candidates describe what happened, senior candidates extract lessons.

**Story Bank:** If `interview-prep/story-bank.md` exists, check if any of these stories are already there. If not, append new ones. Over time this builds a reusable bank of 5-10 master stories that can be adapted to any interview question.

**Selected and framed according to archetype:**
- FDE → emphasize delivery speed and client-facing
- SA → emphasize architectural decisions
- PM → emphasize discovery and trade-offs
- LLMOps → emphasize metrics, evals, production hardening
- Agentic → emphasize orchestration, error handling, HITL
- Transformation → emphasize adoption, organizational change

Also include:
- 1 recommended case study (which project to present and how)
- Red-flag questions and how to answer them (e.g., "why did you sell your company?", "do you have a team of reports?")

## Block G — Tailored CV Data

To auto-generate a highly tailored PDF CV for this application, output a JSON block overriding key profile data. Re-write the Summary, the Key Achievement Highlights, and adapt the Experience bullets to perfectly match the JD keywords and Archetype priorities.

**Copywriting rules — apply to ALL generated text:**
- **Action verbs first:** Start every bullet with a strong verb (Built, Led, Designed, Shipped, Drove, Reduced, Increased, Launched…). Never "Responsible for" or "Was involved in".
- **Metric-driven:** Include a number, % or outcome wherever possible. "Redesigned onboarding" → "Redesigned onboarding flow, reducing drop-off by 30%".
- **Mirror JD language:** Use the exact keywords from the job description — ATS and recruiters scan for them.
- **One idea per bullet:** No conjunctions chaining 3 things. Split into separate bullets.
- **No filler:** Remove "effectively", "successfully", "various", "multiple", "key". Every word earns its place.
- **Summary tone:** Confident, first-person, no passive voice. 3 short paragraphs max. Each starts with a different angle (who you are / what you do / why this role).
- **Highlights:** Each one must be a standalone proof point — role + action + result. Max 1.5 lines. Think "recruiter skims in 5 seconds".

**Important:** Provide ONLY the keys you want to override. Keep the JSON valid.

```json
### TAILORED_CV_JSON
{
  "profile": {
    "summary": "Rewritten 3-4 lines summary highlighting exact JD keywords and tone...",
    "highlights": [
      "Top achievement directly relevant to this role — metric-driven, specific to JD.",
      "Second achievement showing the exact skill/domain they're hiring for.",
      "Third proof point matching their team/product context."
    ]
  },
  "shared": {
    "experience": [
      {
        "company": "UpViral",
        "period": "Jul 2024 – Present (Remote)",
        "role": "Product Designer / Manager",
        "bullets": [
           "Tailored bullet point 1 mapping to JD keywords...",
           "Tailored bullet point 2 mapping to JD..."
        ]
      }
    ]
  }
}
```

---

## Post-evaluation

**ALWAYS** after generating blocks A-F:

### 1. Save report .md

Save the full evaluation in `reports/{###}-{company-slug}-{YYYY-MM-DD}.md`.

After writing the file, sync it to Supabase:
```bash
node sync-supabase.mjs report reports/{###}-{company-slug}-{YYYY-MM-DD}.md
```
This is a no-op if `USE_SUPABASE` is not set — always safe to run.

- `{###}` = next sequential number (3 digits, zero-padded)
- `{company-slug}` = company name in lowercase, no spaces (use hyphens)
- `{YYYY-MM-DD}` = current date

**⚠️ ATOMIC WRITE RULE:** Build the ENTIRE report content in memory first (all blocks A-F, scoring, header with real Score). Then write the file in ONE operation. NEVER create a placeholder file and append to it later. NEVER write raw tool_call/tool_response/JSON into the report.

**Report format (STRICT):**

```markdown
# Evaluation: {Company} — {Role}

**Date:** {YYYY-MM-DD}
**Archetype:** {detected}
**Score:** {X.X/5}
**PDF:** {path or pending}

---

## A) Role Summary
...
```

**CRITICAL:** The line `**Score:** {X.X/5}` must be exactly like this (e.g. `**Score:** 3.9/5`) to be parsed by the system. Do NOT put the score inside a table or further down; it MUST be in the header metadata.

### 2. Register in tracker

**ALWAYS** register in `data/applications.md`:
- Next sequential number
- Current date
- Company
- Role
- Score: match average (1-5)
- Status: `Evaluated`
- PDF: ❌ (or ✅ if auto-pipeline generated PDF)
- Report: relative link to the report .md (e.g., `[001](reports/001-company-2026-01-01.md)`)

**Tracker format:**

```markdown
| # | Date | Company | Role | Score | Status | PDF | Report |
```
