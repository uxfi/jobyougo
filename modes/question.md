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
2. CONTEXT  → Load digest + cv + _profile + profile.yml + Writing Style; report A/B only
3. CLASSIFY → Identify the question type
4. GENERATE → Write a first-person answer using the right sources
5. DELIVER  → Output only the answer, ready to paste
```

## Step 1 — Find the report

User provides: company name, role title, or job URL.

Search `reports/` for the matching report (grep company name). Load only:

- Header (`**URL:**`, score, role)
- **A) Role Summary** — JD vocabulary for this offer
- **B) Match with CV** — mapped proof, not a source of new metrics
- **D) Comp and Demand** — only for salary / package questions
- **`## Application Answers`** — previous form drafts, if present
- Machine Summary / Risk Summary — logistics and knock-outs (travel, relocation, work-auth)

**Do not use as facts or as prose to rewrite:** Cover Letter Draft, Block E (Customization Plan), Block F (Interview Plan / STAR). Those are generated and often AI-slop. Ignore them unless the user asks for interview prep.

If no report:
> "No report found for [Company]. Run auto-pipeline first — I need the JD context to write a good answer."

## Step 2 — Load all context

Read these. They are the only fact sources. Section names below are the **current** headings; do not look for SKILL PROFILE / Stack technique / Produits livrés / Impact mesurable — those blocks do not exist.

| Source | What to use it for |
|--------|-------------------|
| `article-digest.md` | **Numbers.** Facts table, career timeline, case-study material. Wins over cv.md on metrics. |
| `cv.md` | Experience, products, **Skills**, languages. Use Summary + Selected evidence + the relevant project/role. |
| `modes/_profile.md` | Positioning, Framing Adaptatif, Evidence order, location/work-auth, **Writing Style**. Not a metric dump. |
| `config/profile.yml` | Salary, notice, start date, visa, `authorized_in`, `needs_sponsorship`, remote, contact URLs. |
| `modes/_custom.md` | House rules + Voix des réponses. Procedural, not facts. |
| `voice-dna.md` | Anti-slop (no em dash, no not-X-but-Y). First 2000 chars are §4 then §3 on purpose. |
| `writing-samples/` | Only if `_profile.md` has no `## Writing Style`. |
| `interview-prep/story-bank.md` | Behavioral / "tell me about a time" only. Do not paste STAR into why-us / salary / yes-no. |
| Report A + B | JD wording + which proof maps to this offer. Never a new number. |
| `## Application Answers` | Reuse a prior form answer for the same question. Refine; do not invent. |

### CRITICAL FACTS — NEVER CONTRADICT, NEVER OMIT ON RELEVANT QUESTIONS

If a question touches a topic in those files, cite the documented fact. NEVER say "I have not used X" when X is in `cv.md` Skills or article-digest.

**Where to look:**
- The candidate's own map comes first: `_profile.md` **Evidence order** (and any "Form answer sources" notes there) says which employer or client answers which kind of question. Follow it over the generic list below.
- AI tools and levels → `cv.md` → **Skills**
- Products / projects → `cv.md` Professional Experience (and Independent products only when the question names one)
- Management / leadership → `profile.yml` `candidate.people_management`, then the roles in `cv.md` that say so
- Collaboration, strategy, method → the employer roles in `cv.md` Professional Experience; `article-digest.md` when it has a matching section
- Numbers → `article-digest.md` Facts table first, else only what `cv.md` writes
- Work authorization → `profile.yml` `location.authorized_in` and the bases. **Yes** only if the job country is on that list or the role is remote from a base. **No** elsewhere. Sponsorship: **No** inside `authorized_in`; **Yes** outside it when `needs_sponsorship: true`.
- Notice / start → `profile.yml` `availability` exactly as written. Do not write Immediate unless it says so.
- Location → `profile.yml` `location.bases`: the base that matches the offer's region, else the default base.

If a tool, project, or metric is asked about and you cannot find it, say so. Do not invent.

## Step 3 — Classify the question

| Type | Examples | Primary source |
|------|----------|---------------|
| **Motivation** | "Why us?", "Pourquoi ce rôle ?" | Report A (JD detail) + one proof from B / digest / cv |
| **Experience / project** | "Describe a project", "Parlez d'une réalisation" | One employer or client from Professional Experience / Closest matches. Longer role before a short current one. Not an Independent product unless the question names it. |
| **Leadership / management** | "Have you managed people?", "How do you lead a team?" | `candidate.people_management` + the role it names. No line-management claim the CV does not make |
| **Agents / AI flow** | "Experience with agents?", "AI workflows", "LLMs" | An employer workflow from the CV with concrete practices. Personal tools are not the reference. |
| **1-to-100 / startup** | "0-to-1", "scale a product", "startup experience" | The employer or client the Evidence order names for it |
| **Strategy / UX method** | "How do you work?", "product strategy", "process" | The method the CV and `_profile.md` describe, at one employer |
| **AI facilitation / new process** | "How do you use AI in your work?", "prototyping" | The AI practices in `cv.md` Skills, at one employer |
| **Collaboration** | "How do you work with PMs / engineers / stakeholders?" | One employer role that says who the candidate worked with |
| **Compliance** | "regulated", "KYC", "compliance" | The regulated product the CV names, if any |
| **Business / data** | "business analysis", "data", "insights" | The data work the CV names. Do not claim a job title it does not hold |
| **International** | "global", "multi-market", "localisation" | The multi-country work the CV names |
| **Skill / method** | "How do you handle X?" | cv.md Skills + a matching project |
| **Values / work style** | "What matters to you?" | `_profile.md` Writing Style + one project example |
| **Factual** | Salary, notice, remote, visa, location | `profile.yml` only |
| **Behavioral** | "Tell me about a time" | `interview-prep/story-bank.md` if a matching story exists, else cv.md |
| **Open-ended** | "Tell us about yourself" | `_profile.md` Primary positioning + one proof from digest |

## Step 4 — Generate the answer

Before drafting, **read these skills in order** (do not invent a second style guide):

1. `~/.codex/skills/copywriting/SKILL.md` → section **ATS / job-application answers**
2. `~/.codex/skills/copy-editing/SKILL.md` → section **Short ATS / job-application answers** only (skip sweeps 3, 6, 7)
3. `~/.codex/skills/humanizer/SKILL.md` → signs 1–8 and 12, plus the ATS section
4. `~/.codex/skills/stop-slop/SKILL.md` → ATS section

Then read `modes/_profile.md` → **Writing Style** and `modes/_custom.md` → **Voix des réponses de candidature**. Profile voice wins on cadence. The four skills win on slop (em dashes, not-X-but-Y, staged openers, closers, sales words).

**Voice:** first person as the candidate, answering a form. Short sentences. One idea per sentence. Readable out loud, like a person writing to a person. Not a landing page, not ChatGPT. It is a job application: confident and warm, a little upbeat, the work shown in its best honest light, never invented.

**Hard rules:**

1. Answer the question first. Then stop. No motivational coda. No "that's the work I do / that's what I'd bring".
2. First person, active. First sentence: the answer itself (how you work, a call you made, what you believe). Never open with "At <employer>, I…" and do not open every answer the same way. Then the proof from Closest matches / the career. Not a product from the offer. Not "I'm great at X".
3. If the question has sub-questions, answer each part from that same career reference. A "measurable impact" part stays in words. Do not invent a number or a result at the hiring company.
4. Default: 2–4 short sentences. Longer only if the form asks for a narrative. Still one idea per sentence, max ~25 words.
5. One JD detail + one real proof point. Describe the method and scope. Do not catalogue projects. Do not paste headcounts, %, revenue, month counts, or year ranges into free-text answers.
6. Experience: one employer or client from Closest matches (Professional Experience). If several fit, prefer tenure. Current work is not the automatic lead. Name the employer only when it is widely known; describe a little-known one in a few words ("a fintech for retail investors"). Never name internal tools or internal projects. Never invent users, metrics, emotion, employers, or work at the hiring company.
6b. **Independent / personal products** (the CV Independent products section) are not references unless the question names that product or is about AI: an AI builder's own AI products are strong proof on AI/LLM questions. Do not use them for other experience or skill questions. Motivation: one short clause of interest, not a brand drop.
7. Never open with a denial ("I have not", "Je n'ai pas") when the full career already contains a relevant product, role, or skill. Read the whole history before answering, including later roles. One closest real match. A true gap stays one short positive clause about the nearest shipped work, without recasting it as the missing thing.
8. No vague bridges: "maps closely to", "this experience translates to", "similar infrastructure field".
9. If the form asks product + users + problem + impact together → name the career product first, then the user problem, the role, one decision, the outcome in words. Skip numeric impact unless Facts already document that count.
10. Language of the question (FR or EN). An English question gets an English answer, even when the notes around it are in French.
11. **No em dash (—). No en dash as a pause.** Period or comma. Numeric ranges use a hyphen (`70-110K`) only on salary/comp fields. No semicolon as a fancy comma. No hyphenated compound words, even where grammar wants one: "end to end", "AI driven", "user facing" (proper names keep theirs).
12. No not-X-but-Y. No forced triads. No staged openers ("I'm excited to", "Throughout my career", "Here's the thing").
13. Banned unless they are a product name: delve, leverage, utilize, robust, seamless, cutting-edge, passionate, thrilled, unique blend, meaningful impact, game-changer.
14. Yes / No / URL: the short value only. Do not dress them up.
15. Factual (salary, notice, visa, remote): `profile.yml`, one sentence. No persuasive closing. Dates and numbers belong here, not in motivation/experience prose.
16. AI / LLM tools: the reference is an employer workflow from the CV or the candidate's own AI products, with concrete practices (API calls, prompt design, validation, structured JSON). An internal tool is never named. Do not dump buzzwords.
17. If the facts cannot answer honestly, leave the field empty. Do not pad.
18. Optional form fields: skip unless the user asked to fill them anyway.
19. Contractions are fine ("I've", "I'm") when they match Writing Style. Do not add slang or fake typos.
20. Free-text description fields: pragmatic methods only. No "in the first N months", no headcounts or brand counts, no money amounts, no "since <year>" as proof.

**Checks before returning:**

- [ ] No `—` or clause `–`
- [ ] No sentence over ~25 words without a period
- [ ] No banned word, staged opener, or restating closer
- [ ] Every claim is in cv.md / article-digest.md / _profile.md / profile.yml
- [ ] The answer does not open on "At <employer>, I…"
- [ ] The proof is real work from Professional Experience / Closest matches, named only if the employer is widely known
- [ ] Personal projects appear only as motivation support or as proof on an AI question
- [ ] No hyphenated compound word
- [ ] The question is actually answered

**Shapes (facts only, not slogans):**

- **Motivation:** "[JD detail that draws me]. [What I would bring, with one proof in half a sentence]. [What I want to build there.]"
- **Experience:** "[The user problem or the call I made]. [My role and one decision, at a named or described employer]. [Outcome in words]."
- **Skill / LLM:** "[How I use it]. [Where it shipped: employer workflow or my own AI products]. [What the step did]."
- **Work style:** "[How I work]. [One proof]."
- **Open-ended:** "I'm a [archetype]. [One proof]. This role [one JD fact]."
- **Factual:** one sentence from `profile.yml` (numbers/dates only here).

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
