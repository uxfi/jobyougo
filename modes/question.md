# Mode: question — Application Question Answerer

Answer a single question from a job application form. First-person, specific to the offer, grounded in the candidate's real proof points and narrative.

## When to trigger

User says something like:
- "réponds à cette question pour [Company] : [question]"
- "answer this question for [Company]: [question]"
- "question [Company] : [text]"
- Pressing `a` in the dashboard prints a command template → user fills in and runs it

## Workflow

```
1. LOAD     → Find the report for this job in reports/
2. CONTEXT  → Load report + cv.md + article-digest.md + _profile.md + profile.yml
3. CLASSIFY → Identify the question type
4. GENERATE → Write a first-person answer using the right sources
5. DELIVER  → Output only the answer, ready to paste
```

## Step 1 — Find the report

User provides: company name, role title, or job URL.

Search `reports/` for the matching report (grep company name). Load:
- Full report block B (proof points aligned to JD)
- Block F (STAR stories)
- Block G (draft answers, if present)

If no report:
> "No report found for [Company]. Run auto-pipeline first — I need the JD context to write a good answer."

## Step 2 — Load all context

Before writing anything, read ALL of these:

| Source | What to use it for |
|--------|-------------------|
| Report block B | Proof points already mapped to THIS JD — use these first |
| Report block F | STAR stories calibrated for this offer |
| Report block G | Draft answers if they exist — refine, don't rewrite from scratch |
| `article-digest.md` | Detailed proof points with real metrics — source of truth for numbers |
| `cv.md` | Full experience, projects, stack |
| `modes/_profile.md` | Archetypes, narrative de transition, avantage distinctif, style de travail, scripts de négo |
| `config/profile.yml` | Factual data: salary target, remote policy, notice period, location, visa |

## Step 3 — Classify the question

| Type | Examples | Primary source |
|------|----------|---------------|
| **Motivation** | "Why us?", "Pourquoi ce rôle ?" | Report block B + something specific from JD |
| **Experience / project** | "Describe a project", "Parlez d'une réalisation" | Report block F (STAR, 2 sentences) |
| **Skill / method** | "How do you handle X?", "Comment gérez-vous X ?" | cv.md + article-digest.md + concrete outcome |
| **Values / work style** | "What matters to you?", "Votre style de travail ?" | _profile.md (autonomie, systèmes, ownership, hands-on) |
| **Factual** | Salary, notice period, remote, visa, location | profile.yml — answer directly, no hedging |
| **Open-ended** | "Tell us about yourself", "Anything to add?" | Archetype from report + top proof point + fit signal |

## Step 4 — Generate the answer

**Copywriting rules — non-negotiable:**

1. **First person, active voice** — no passive, no "would be", no "I am looking for"
2. **Lead with proof, not claim** — "I built X that does Y" not "I'm great at X"
3. **2–5 sentences max** unless the question explicitly calls for a longer narrative (e.g. "describe a project in detail" → STAR format, still tight)
4. **Anchor in the specific** — one signal from the JD/report + one real proof point from the candidate
5. **Adaptive archetype** — frame using the archetype that maps to this role (see _profile.md Framing Adaptatif)
6. **Tone: "I'm choosing you"** — confident, deliberate, selective. Not desperate, not arrogant.
7. **Language** = language of the question. FR if FR, EN if EN.
8. **Zero filler** — no "I am passionate about", "I would love the opportunity to", "I believe I would be a great fit"
9. **Never invent** — no fake metrics, no invented experience. If a gap exists, reframe around adjacent strength.

**Templates per type:**

- **Motivation (why role/company)**
  > "[Specific signal from JD] is exactly the intersection I've been working toward. At [project], I [proof point that maps to it]. This is why [Company] is at the top of my list."

- **Experience / project**
  > "At [context], I [action + result in one sentence from STAR story]. That directly maps to what you're building with [JD element]."

- **Skill / method**
  > "I [concrete method]. At [context], that meant [measurable outcome]. Same approach applies to [JD challenge]."

- **Work style / values**
  > "I work best [honest descriptor from _profile.md]. In practice that meant [concrete example from a project]. I own the problem end-to-end before asking for help."

- **Open-ended / "tell us about yourself"**
  > "I'm a [archetype from report]. I [top proof point from article-digest or cv.md]. [Company]'s [specific thing] is why I'm here over other options right now."

- **Factual (salary)**
  > Use the script from _profile.md negotiation section. Keep it one sentence, firm but open.

## Step 5 — Output format

Output **only** the ready-to-paste block. No meta-commentary before or after unless a note is genuinely needed.

```
## [Company] — [Role]
**Question:** [exact question as given]

[Answer]

---
_Note: [only if something needs to be verified or personalized before sending — omit if not needed]_
```

## Multiple questions in one call

If the user pastes several questions, answer them all in sequence, numbered, using the same format block per question.
