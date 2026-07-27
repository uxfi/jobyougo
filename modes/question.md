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
- Full report block C (proof points aligned to JD)
- Block F (application form questions + draft answers, if present)

If no report:
> "No report found for [Company]. Run auto-pipeline first — I need the JD context to write a good answer."

## Step 2 — Load all context

Before writing anything, read ALL of these:

| Source | What to use it for |
|--------|-------------------|
| Report block C | Motivation and wording calibration for THIS JD — do not let it replace factual experience |
| Report block F | Draft answers if they exist — refine, don't rewrite from scratch |
| `article-digest.md` | Detailed proof points with real metrics — source of truth for numbers |
| `cv.md` | Full experience, projects, stack |
| `modes/_profile.md` | **Read FIRST — SKILL PROFILE block at top has all tools, experience, personality** |
| `config/profile.yml` | Factual data: salary target, remote policy, notice period, location, visa |

### CRITICAL FACTS — NEVER CONTRADICT, NEVER OMIT ON RELEVANT QUESTIONS

The candidate's verified facts live in `_profile.md` (SKILL PROFILE block), `cv.md`, and `article-digest.md`. Before answering, read those files and treat them as ground truth. If a question touches any topic covered there, cite the relevant fact explicitly. NEVER say "I have not used X" when X is documented in those files.

**Where to look:**
- AI tools and proficiency levels → `_profile.md` (Stack technique block) + `cv.md` (Skills block)
- Products / projects shipped → `_profile.md` (Produits livrés block) + `cv.md` (Projects block)
- Quantified outcomes → `article-digest.md` if present, otherwise `cv.md` (Experience bullets) and `_profile.md` (Impact mesurable block)

If a tool, project, or metric is asked about and you cannot find it in those files, say so plainly — do not invent.

## Step 3 — Classify the question

| Type | Examples | Primary source |
|------|----------|---------------|
| **Motivation** | "Why us?", "Pourquoi ce rôle ?" | Report block C + something specific from JD |
| **Experience / project** | "Describe a project", "Parlez d'une réalisation" | cv.md + article-digest.md + _profile.md first, report block C second |
| **Skill / method** | "How do you handle X?", "Comment gérez-vous X ?" | cv.md + article-digest.md + concrete outcome |
| **Values / work style** | "What matters to you?", "Votre style de travail ?" | _profile.md (autonomie, systèmes, ownership, hands-on) |
| **Factual** | Salary, notice period, remote, visa, location | profile.yml — answer directly, no hedging |
| **Open-ended** | "Tell us about yourself", "Anything to add?" | Archetype from report + top proof point + fit signal |

## Step 4 — Generate the answer

Before drafting, read `modes/_profile.md` → **Guidelines de copywriting** and apply the **Application answers — Hugo voice** block as the voice contract.

**Voice target:**

- Sounds like Hugo Vermot answering directly, not like an AI cover-letter generator.
- Builder/founder energy: proof first, concrete systems, real users, shipped products.
- Terse, selective, and specific. No HR polish, no "please pick me" posture.
- Natural first person with contractions. A controlled blunt sentence is OK if it is true and professional.
- Default rhythm: proof → method / trade-off → why this role or company now.

**Copywriting rules — non-negotiable:**

1. **First person, active voice** — no passive, no "would be", no "I am looking for"
2. **Lead with proof, not claim** — "I built X that does Y" not "I'm great at X"
3. **Answer the literal question** — if it has 2 or 3 sub-questions, answer all of them in the same order
4. **2–4 sentences max** unless the question explicitly calls for a longer narrative (e.g. "describe a project in detail" → STAR format, still tight)
5. **Anchor in the specific** — one signal from the JD/report + one real proof point from the candidate, without drifting away from the asked topic
6. **For experience questions, name a real product in sentence one**
7. **If the exact domain experience is missing, say so plainly in a short clause, then pivot to the closest adjacent experience**
8. **Never turn adjacent experience into direct experience**
9. **Never invent the users** — name the real users of the cited product
10. **Ban vague bridge phrases** — don't write "maps closely to", "this experience translates to", "similar infrastructure field", "internal AI operators", or other fuzzy analogies unless they are literally factual
11. **Keep it simple** — short sentences, concrete nouns, minimal abstraction
12. **If the question asks product + users + problem + impact, answer in exactly that order**
13. **Adaptive archetype** — frame using the archetype that maps to this role (see _profile.md Framing Adaptatif)
14. **Tone: "I'm choosing you"** — confident, deliberate, selective. Not desperate, not arrogant.
15. **Language** = language of the question. FR if FR, EN if EN.
16. **Zero filler** — no "I am passionate about", "I would love the opportunity to", "I believe I would be a great fit"
17. **Never invent** — no fake metrics, no invented experience. If a gap exists, reframe around adjacent strength, but stay explicit about the gap.
18. **CRITICAL — AI tools questions:** If the question mentions specific AI tools or generative AI experience, ALWAYS read `_profile.md` and `cv.md` for the candidate's documented proficiency, daily usage, and production projects, and cite that directly. Never generate a generic or hedged answer when the source files contain the proof. Lead with the strongest documented signal.
19. **No unnecessary hyphens** — write compound words without hyphens unless grammatically required.
20. **Use contractions** — "I've", "I'm", "you're", etc. Avoid stiff constructions where a contraction fits.
21. **Hugo voice check** — if the answer could be written by any senior candidate, rewrite it around a real project, a hard decision, or a verified metric.
22. **No career-coach gloss** — avoid "thrilled", "excited", "meaningful impact", "dynamic environment", "strong fit", "unique blend", unless the phrase is forced by the question.

**Templates per type:**

- **Motivation (why role/company)**
  > "[Specific signal from JD] caught my attention because it is not abstract for me. I built [project], where [proof point]. That's the kind of scope I want next: real product ownership, real AI/system complexity, and room to ship."

- **Experience / project**
  > "I built [real product]. The users were [real users], and I solved [specific problem] by [concrete action]. The impact was [real metric or concrete outcome]."

- **Skill / method**
  > "I [concrete method]. At [context], that meant [measurable outcome]. For [JD challenge], I'd use the same discipline: start with the real workflow, build the system, then measure whether it works."

- **Work style / values**
  > "I work best with clear ownership and a real problem to solve. In practice, that meant [concrete example from a project]. I own the problem end-to-end before asking for help."

- **Open-ended / "tell us about yourself"**
  > "I'm a [archetype from report] who designs the experience, architects the AI/product system, and ships it. I [top proof point from article-digest or cv.md]. [Company]'s [specific thing] is why this role is on my list right now."

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
