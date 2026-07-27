# Mode: interview — Interview Preparation

Prepare for a REAL scheduled interview. This used to run during offer evaluation — it was moved here because interview prep is useless at evaluation time. Run it when the tracker status moves to `Interview` (or the user announces an interview).

## When to trigger

- "j'ai un entretien chez [Company]" / "I have an interview at [Company]"
- "prépare-moi pour l'entretien [Company]"
- `/career-ops interview [Company]`

## Step 0 — Load context

1. Find the report in `reports/` (grep company name). Load Block A (archetype), Block C (CV match + gaps), Block E (score).
2. Read `cv.md`, `modes/_profile.md` (SKILL PROFILE, narrative, framing adaptatif), `article-digest.md` (if exists), `interview-prep/story-bank.md` (if exists).
3. If no report exists, ask for the JD or run auto-pipeline first.

## Part 1 — Level and Strategy

1. **Level detected** in the JD vs **candidate's natural level for that archetype**
2. **"Sell senior without lying" plan**: specific phrases adapted to the archetype, concrete achievements to highlight, how to position founder experience as an advantage
3. **"If they downlevel me" plan**: accept if comp is fair, negotiate 6-month review, clear promotion criteria

## Part 2 — STAR+R Stories

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

## Part 3 — Case study & red flags

- 1 recommended case study (which project to present and how)
- Red-flag questions and how to answer them (e.g., "why did you sell your company?", "do you have a team of reports?")
- Gap questions: for each gap from Block C of the report, the one-line honest answer + pivot to adjacent experience

## Part 4 — Questions to ask THEM

5-7 sharp questions adapted to the archetype and what the report flagged (culture signals, red flags, comp ambiguity). Asking nothing = junior signal.

## Output

Save to `interview-prep/{company-slug}-interview-prep.md`. Update tracker status to `Interview` if not already.
