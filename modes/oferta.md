# Mode: oferta - Lean Offer Evaluation

When the candidate pastes an offer, JD text, or URL, the goal is to answer 3 things quickly:

1. Does this offer match the search criteria?
2. What are the blockers, strengths, and unknowns?
3. What score and next action should be recorded?

This mode is report-only. Do not scan application forms, draft application answers, write cover letters, generate tailored CV JSON, or request a tailored PDF. Those belong to the explicit `apply`, `question`, `coverletter`, and `pdf` modes.

## Non-goals

- No tailored CV section.
- No `TAILORED_CV_JSON`.
- No application form scanning.
- No fallback generic application questions.
- No cover letter.
- No interview prep.
- No compensation web research unless reliable data is already present in the provided context.

If JD content is missing or too thin to evaluate, do not invent. Produce a short blocked result only if the caller explicitly requires a report; otherwise ask for the JD text.

## Step 0 - Archetype Detection

Classify the offer into one closest archetype from `_shared.md`. If the role is hybrid, name the 2 closest archetypes, but keep the rest of the report concise.

## Block A - Role Snapshot

Use a compact table:

| Attribute | Details |
|-----------|---------|
| Detected archetype | ... |
| Domain | ... |
| Function | ... |
| Seniority | ... |
| Remote / location | ... |
| Contract | ... |
| TL;DR | 1 sentence |

Write `Unknown` only when the JD truly does not say. Do not pad the report with speculation.

## Block B - Criteria Gate

Read the profile and structured criteria. Check only the criteria that matter for the decision:

| Criterion | Requirement | Evidence in offer | Verdict |
|-----------|-------------|-------------------|---------|
| Remote policy | ... | ... | yes / warning / no / unknown |
| Geography / timezone | ... | ... | yes / warning / no / unknown |
| Compensation fit | ... | ... | yes / warning / no / unknown |
| Product ownership | ... | ... | yes / warning / no / unknown |
| AI / tech dimension | ... | ... | yes / warning / no / unknown |
| Archetype fit | ... | ... | yes / warning / no / unknown |

Then add:

**Deal-breakers:** one line with any hard blocker. If none are explicit, write `None explicit`.

Early exit rule:
- If a hard deal-breaker fails, cap the score according to the profile, skip Block C if the JD is too thin, and go straight to Block E.
- If the JD did not load and critical data is unknown, cap the score at 2.0 and mark the report as `Blocked: missing JD content`.

## Block C - CV Match

Keep this short. Map the most important JD requirements to real CV evidence:

| JD requirement | Candidate evidence | Strength |
|----------------|--------------------|----------|
| ... | exact project/company/proof point from CV | strong / partial / gap |

Maximum 6 rows. If there is no usable JD content, write one sentence: `Cannot assess CV match without JD content.`

## Block D - Practical Signals

Use only the JD and context already provided. Do not run broad company research in this mode.

Short bullets:
- **Comp:** stated range, target fit, or `Unknown`.
- **Remote risk:** explicit policy or `Unknown`.
- **Role risk:** execution-only, vague ownership, weak AI signal, etc.
- **Application effort:** low / medium / high, based only on the available context.

## Block E - Score and Decision

Use the standard scoring dimensions:

| Dimension | Score | Justification |
|-----------|-------|---------------|
| CV match | X/5 | 1 line |
| North Star alignment | X/5 | 1 line |
| Comp | X/5 | 1 line |
| Cultural / operating signals | X/5 | 1 line |
| Red flags | -X | 1 line |
| Global | X.X/5 | 1 line |

End with:

**Verdict:** apply / maybe / skip / blocked.

Use `blocked` when the system could not load enough JD content to make a real decision. Do not recommend applying from a blocked report.

## Output Format

```markdown
# Evaluation: {Company} - {Role}

**Date:** {YYYY-MM-DD}
**Archetype:** {detected}
**Score:** {X.X/5}
**PDF:** Not generated (evaluation only)
**URL:** {URL if known}

---

## A) Role Snapshot
...

## B) Criteria Gate
...

## C) CV Match
...

## D) Practical Signals
...

## E) Score and Decision
...
```

Do not add sections after E. Do not add application questions. Do not add tailored CV data.

## Post-evaluation

The server saves the report and tracker entry. The report must be complete before it is written.

Tracker entry:
- Status: `Evaluated` unless a hard blocker or missing JD makes the verdict `skip` or `blocked`.
- PDF: `❌`
- Notes: one short reason, especially for blocked reports.
