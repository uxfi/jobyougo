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
- AI tools and levels → `cv.md` → **Skills** (AI & Technical)
- Products / projects → `cv.md` Independent products + Professional Experience, and `_profile.md` Evidence order
- Management / leadership → `article-digest.md` **Management, agents, and 1-to-100**, then `cv.md` Agence V0 and OneAsset (one PO)
- Agents / AI flows → employer methods first (OneAsset Git/Cursor hand-off, GitHub). Do not use Jarvos, Creads, or Flemme as the reference. Figmol is OneAsset's internal tool, not a tool to name beside GitHub or Cursor.
- 1-to-100 / startup product → Agence V0, Vloggy, OneAsset (+ OTC). Creads.io is not the reference. Arlequin is help only: no dates or metrics.
- Strategy / UX method / AI facilitation → `article-digest.md` **Strategy, UX method, AI facilitation, collaboration**. Prototypes in Cursor/Claude Code. GitHub flow. Figmol is OneAsset's internal review tool, not a tool in that list. Marcel Sprint Design / Lean UX. UpViral interviews.
- Collaboration → OneAsset (PO + engineering PRs), UpViral (CPO + developers), LVMH (15+ maisons), Renault (workshops)
- Compliance → OneAsset (VARA, KYB/KYC, reporting, OTC). Société Générale MIF2 is adjacent.
- Engineering pairing → OneAsset (Cursor/Claude Code + GitHub) and UpViral (implementation with developers). Not every production backend line.
- Business / data → LVMH data marketing platform (customer data, campaign performance, monitoring). Do not retitle BA/DA.
- International → Renault Renew, multi-country FO/BO and design system
- Numbers → `article-digest.md` Facts table first
- Work authorization → `profile.yml` `authorized_in` (France, EU/EEA, Thailand). **Yes** only if the job country is on that list or the role is remote from those bases. **No** for US, UK, GCC, etc. Sponsorship: **No** inside `authorized_in`; **Yes** (`needs_sponsorship: true`) outside it.
- Notice / start → `profile.yml` availability: "To be confirmed". Do not write Immediate.
- Location → `_profile.md` / `profile.yml`: Paris CET or Bangkok ICT, per offer.

If a tool, project, or metric is asked about and you cannot find it, say so. Do not invent.

## Step 3 — Classify the question

| Type | Examples | Primary source |
|------|----------|---------------|
| **Motivation** | "Why us?", "Pourquoi ce rôle ?" | Report A (JD detail) + one proof from B / digest / cv |
| **Experience / project** | "Describe a project", "Parlez d'une réalisation" | One employer or client. Prefer brand weight (LVMH, Renault, Société Générale) and tenure (multi-year over a 6-month role). Not a personal project. |
| **Leadership / management** | "Have you managed people?", "How do you lead a team?" | Agence V0 (up to 7 designers, 2020–2024) then OneAsset with one PO. No engineering line-management claim |
| **Agents / AI flow** | "Experience with agents?", "AI workflows", "LLMs" | Employer workflow only (OneAsset Cursor/Claude, GitHub). Figmol is internal to OneAsset, not part of this tool list. Personal tools are not the reference. |
| **1-to-100 / startup** | "0-to-1", "scale a product", "startup experience" | Agence V0, Vloggy, OneAsset (+ OTC). Not Creads as the credential. Arlequin as product/design help only |
| **Strategy / UX method** | "How do you work?", "product strategy", "UX process" | OneAsset strategy + UpViral interviews + Marcel Sprint Design / Lean UX. Users and journeys first |
| **AI facilitation / new process** | "How do you use AI in design?", "prototyping", "GitHub" | Prototypes in Cursor and Claude Code. GitHub PRs with engineering. If the question is about OneAsset, Figmol is the internal review tool, not a peer of GitHub or Cursor. |
| **Collaboration** | "How do you work with PMs / engineers / stakeholders?" | OneAsset PO + GitHub; UpViral CPO + developers; LVMH maisons; Renault workshops |
| **Compliance** | "regulated", "KYC", "fintech compliance" | OneAsset first (VARA, KYB/KYC, reporting). Société Générale MIF2 adjacent |
| **Business / data** | "business analysis", "data", "insights" | LVMH data marketing platform. Do not claim a BA/DA job title |
| **International** | "global", "multi-market", "localisation" | Renault Renew: multi-country FO/BO and design system |
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

**Voice:** first person as the candidate, answering a form. Short sentences. One idea per sentence. Proof first. Readable out loud. Not a landing page, not ChatGPT, not a pitch.

**Hard rules:**

1. Answer the question first. Then stop. No motivational coda. No "that's the work I do / that's what I'd bring".
2. First person, active. Lead with a documented action or method: "I [did X with Y]", not "I'm great at X", and not a product-name open.
3. If the question has sub-questions, cover them in the same order.
4. Default: 2–4 short sentences. Longer only if the form asks for a narrative. Still one idea per sentence, max ~25 words.
5. One JD detail + one real proof point. Describe the method and scope. Do not catalogue projects. Do not paste headcounts, %, revenue, month counts, or year ranges into free-text answers.
6. Experience: one employer or client reference. Rank by **brand importance** (LVMH, Renault, Société Générale before smaller names) and **tenure** (multi-year before a 6-month role or a prototype). OneAsset is the current job, not the automatic lead. Describe the method inside that job. Never invent users, metrics, emotion, or employers.
6b. **Personal projects (UXfi, Flemme OS, Creads.io, Panfy, Jarvos, Ancient World, JobYouGo) are not references.** Do not use them to answer experience, skill, or AI/LLM questions. Motivation only: one short clause of interest, not a brand drop ("On Creads.io…", "At Flemme OS…"). If the question is not about motivation, leave them out.
7. Missing exact experience: say so in one short clause, then the closest adjacent fact. Never recast adjacent as direct.
8. No vague bridges: "maps closely to", "this experience translates to", "similar infrastructure field".
9. If the form asks product + users + problem + impact together → method/what you built first, then users/problem in plain terms. Still no famous-brand framing for side projects. Skip numeric impact unless the field is explicitly about metrics or salary.
10. Language of the question (FR or EN).
11. **No em dash (—). No en dash as a pause.** Period or comma. Numeric ranges use a hyphen (`70-110K`) only on salary/comp fields. No semicolon as a fancy comma.
12. No not-X-but-Y. No forced triads. No staged openers ("I'm excited to", "Throughout my career", "Here's the thing").
13. Banned unless they are a product name: delve, leverage, utilize, robust, seamless, cutting-edge, passionate, thrilled, unique blend, meaningful impact, game-changer.
14. Yes / No / URL: the short value only. Do not dress them up.
15. Factual (salary, notice, visa, remote): `profile.yml`, one sentence. No persuasive closing. Dates and numbers belong here, not in motivation/experience prose.
16. AI / LLM tools: the reference is an employer workflow (OneAsset Cursor/Claude Code, GitHub), with concrete practices (API calls, prompt design, validation, structured JSON). Figmol is OneAsset's internal tool. Do not list it with Cursor, Claude, GitHub, or Figma. Do not cite a personal product as the credential. Do not dump buzzwords.
17. If the facts cannot answer honestly, leave the field empty. Do not pad.
18. Optional form fields: skip unless the user asked to fill them anyway.
19. Contractions are fine ("I've", "I'm") when they match Writing Style. Do not add slang or fake typos.
20. Free-text description fields: pragmatic methods only. No "in the first N months", no "15+ maisons", no "EUR…", no "since 2022" as proof.

**Checks before returning:**

- [ ] No `—` or clause `–`
- [ ] No sentence over ~25 words without a period
- [ ] No banned word, staged opener, or restating closer
- [ ] Every claim is in cv.md / article-digest.md / _profile.md / profile.yml
- [ ] The reference is an employer or client, weighted by brand and tenure
- [ ] Personal projects appear only as motivation support, never as the proof
- [ ] The question is actually answered

**Shapes (facts only, not slogans):**

- **Motivation:** "[JD detail]. At [employer] I [method]. [Optional one clause: I also practice this on personal tools.]"
- **Experience:** "At [strongest fitting brand / longest relevant role] I [action]. [Method / collaboration]."
- **Skill / LLM:** "At [employer] I [concrete practice]. [What the step did]."
- **Work style:** "At [employer] I [how I work]."
- **Open-ended:** "I'm a [archetype]. At [employer] I [one proof]. This role [one JD fact]."
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
